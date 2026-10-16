"""One portable contract, two native Decisions protocols; Python stdlib only."""
from __future__ import annotations

import base64
import datetime as dt
from dataclasses import dataclass, field
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import time
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = "1"
MAX_BYTES = 8 * 1024 * 1024
PROVIDERS = {"d1", "openai"}


class DecisionError(ValueError):
    """Only static error codes: exception text never includes inputs or secrets."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise DecisionError(code)


def numeric(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def probability(value):
    require(numeric(value) and 0 <= value <= 1, "invalid_probability")
    return value


def typed(value):
    require(type(value) in (str, bool), "invalid_choice_value")
    return (type(value).__name__, value)


def endpoint(base: str) -> str:
    require(isinstance(base, str), "invalid_base_url")
    parsed = urllib.parse.urlsplit(base)
    require(parsed.scheme in ("http", "https") and bool(parsed.hostname)
            and not parsed.username and not parsed.password and not parsed.query
            and not parsed.fragment and parsed.path.rstrip("/") in ("", "/v1"), "invalid_base_url")
    return base.rstrip("/") + ("/decisions" if parsed.path.rstrip("/") == "/v1" else "/v1/decisions")


@dataclass(frozen=True)
class ProviderConfig:
    provider: str = "d1"
    api_key: str = field(default="", repr=False)
    base_url: str | None = None
    model: str | None = None
    timeout_s: float = 75

    def __post_init__(self):
        require(self.provider in PROVIDERS, "unknown_provider")
        require(isinstance(self.api_key, str) and bool(self.api_key)
                and not any(c.isspace() for c in self.api_key), "missing_or_invalid_api_key")
        require(numeric(self.timeout_s) and 0 < self.timeout_s <= 300, "invalid_timeout")
        base = self.base_url or ("http://rrh-llm-1:4000" if self.provider == "d1" else "https://api.openai.com")
        endpoint(base)
        model = self.model or ("ramblerun/Decision-AI" if self.provider == "d1" else "gpt-6-luna")
        require(isinstance(model, str) and bool(model), "invalid_model")
        if self.provider == "openai":
            require(model == "gpt-6-luna", "unsupported_openai_decisions_model")
            require(urllib.parse.urlsplit(base).scheme == "https", "openai_requires_https")
        object.__setattr__(self, "base_url", base)
        object.__setattr__(self, "model", model)

    @classmethod
    def from_env(cls, provider="d1", *, base_url=None, model=None, timeout_s=75):
        require(provider in PROVIDERS, "unknown_provider")
        key_name = "LITELLM_API_KEY" if provider == "d1" else "OPENAI_API_KEY"
        base_name = "LITELLM_BASE" if provider == "d1" else "OPENAI_DECISIONS_BASE_URL"
        return cls(provider, os.environ.get(key_name, ""), base_url or os.environ.get(base_name), model, timeout_s)


def image_data_url(path: str | Path) -> str:
    """Read a bounded local PNG/JPEG/WebP/GIF; never fetch URLs implicitly."""
    try:
        with Path(path).open("rb") as handle:
            raw = handle.read(MAX_BYTES + 1)
    except OSError:
        raise DecisionError("image_read_failed") from None
    require(0 < len(raw) <= MAX_BYTES, "image_size_limit")
    mime = None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif raw.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif raw[:6] in (b"GIF87a", b"GIF89a"):
        mime = "image/gif"
    elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        mime = "image/webp"
    require(mime is not None, "unsupported_image_format")
    return "data:" + mime + ";base64," + base64.b64encode(raw).decode("ascii")


def validate_request(request: dict) -> None:
    require(isinstance(request, dict), "invalid_request")
    require(set(request) <= {"schema_version", "state", "images", "questions", "context"}, "unknown_request_field")
    require(type(request.get("schema_version")) is int and request["schema_version"] == 1, "unsupported_schema_version")
    require(request.get("state") is None or isinstance(request["state"], str), "invalid_state")
    images = request.get("images", [])
    require(isinstance(images, list) and len(images) <= 128, "invalid_images")
    # Portable contract deliberately uses data URLs; local proxy need not fetch remote URLs.
    for image in images:
        require(isinstance(image, str) and len(image) <= MAX_BYTES * 2, "invalid_image")
        prefix, sep, encoded = image.partition(",")
        require(sep == "," and prefix in {"data:image/" + t + ";base64" for t in ("png", "jpeg", "webp", "gif")}, "invalid_image")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error):
            raise DecisionError("invalid_image") from None
        require(0 < len(raw) <= MAX_BYTES, "image_size_limit")
    require(bool(request.get("state")) or bool(images), "empty_evidence")
    questions = request.get("questions")
    require(isinstance(questions, list) and 1 <= len(questions) <= 200, "invalid_question_count")
    names = set()
    for question in questions:
        require(isinstance(question, dict), "invalid_question")
        name = question.get("name")
        require(isinstance(name, str) and bool(name) and name not in names, "invalid_or_duplicate_question_name")
        names.add(name)
        kind = question.get("type")
        require(kind in ("predicate", "choice", "score"), "invalid_question_type")
        require(isinstance(question.get("instructions"), str) and bool(question["instructions"]), "invalid_instructions")
        allowed = {"name", "type", "instructions"}
        if kind == "predicate":
            allowed |= {"true_description", "false_description"}
            for key in ("true_description", "false_description"):
                require(key not in question or isinstance(question[key], str), "invalid_predicate_criteria")
        else:
            key = "choices" if kind == "choice" else "levels"
            allowed.add(key)
            rows = question.get(key)
            # Portable scores share d1's documented 2..10-level limit.
            require(isinstance(rows, list) and 2 <= len(rows) <= (255 if kind == "choice" else 10), "invalid_option_count")
            identities = set()
            for row in rows:
                value_key = "value" if kind == "choice" else "label"
                require(isinstance(row, dict) and set(row) <= {value_key, "description"}, "invalid_option")
                value = row.get(value_key)
                identity = typed(value) if kind == "choice" else value
                require(kind == "choice" or isinstance(value, str), "invalid_level_label")
                require(identity not in identities, "duplicate_option")
                identities.add(identity)
                require("description" not in row or isinstance(row["description"], str), "invalid_option_description")
        require(set(question) <= allowed, "unknown_question_field")
    require(isinstance(request.get("context", {}), dict), "invalid_context")
    try:
        serialized = json.dumps(request, allow_nan=False).encode()
    except (TypeError, ValueError):
        raise DecisionError("request_not_json") from None
    require(len(serialized) <= MAX_BYTES * 2, "request_size_limit")


def to_wire(request: dict, config: ProviderConfig) -> dict:
    validate_request(request)
    if config.provider == "openai":
        questions = []
        for question in request["questions"]:
            q = {k: v for k, v in question.items() if k not in ("true_description", "false_description")}
            if question["type"] == "predicate":
                criteria = [f"{side}: {question[side + '_description']}" for side in ("true", "false")
                            if side + "_description" in question]
                if criteria:
                    q["instructions"] += "\n" + "\n".join(criteria)
            questions.append(q)
        if request.get("images"):
            parts = ([{"type": "input_text", "text": request["state"]}] if request.get("state") else [])
            parts += [{"type": "input_image", "image_url": url} for url in request["images"]]
            evidence = [{"role": "user", "content": parts}]
        else:
            evidence = request["state"]
        return {"model": config.model, "input": evidence, "questions": questions}
    questions = {}
    for question in request["questions"]:
        q = {"type": "noul" if question["type"] == "predicate" else question["type"],
             "instructions": question["instructions"]}
        if question["type"] == "predicate":
            criteria = {side: question[side + "_description"] for side in ("true", "false")
                        if side + "_description" in question}
            if criteria:
                q["criteria"] = criteria
        elif question["type"] == "choice":
            # Preserve ordinary named labels. Encode every option only when typed bools
            # are present, avoiding collisions between true and "true" in JSON maps.
            q["criteria"] = {label: option.get("description", str(option["value"]))
                             for label, option in zip(d1_labels(question), question["choices"])}
        else:
            q["criteria"] = [level.get("description", level["label"]) for level in question["levels"]]
        questions[question["name"]] = q
    # The existing LiteLLM route selects the d1 alias; it does not accept model here.
    return {"state": request.get("state"), "questions": questions, "images": request.get("images", [])}


def d1_labels(question):
    options = question["choices"]
    if all(type(row["value"]) is str for row in options):
        return [row["value"] for row in options]
    return [f"option_{index}" for index in range(len(options))]


def distribution(rows, expected, *, score=False):
    require(isinstance(rows, list) and len(rows) == len(expected), "invalid_distribution")
    out = []
    seen = set()
    for row in rows:
        require(isinstance(row, dict), "invalid_distribution")
        value = row.get("value")
        if score:
            require(type(value) is int and 0 <= value < len(expected), "invalid_level_index")
            require(row.get("label") == expected[value], "invalid_level_label")
            identity = value
        else:
            identity = typed(value)
            require(identity in expected, "unknown_choice_value")
        require(identity not in seen, "duplicate_probability")
        seen.add(identity)
        item = {"value": value, "probability": probability(row.get("probability"))}
        if score:
            item["label"] = expected[value]
        out.append(item)
    require(abs(sum(row["probability"] for row in out) - 1) <= 0.02, "invalid_probability_total")
    return out


def from_wire(response: dict, request: dict, provider: str) -> list:
    require(isinstance(response, dict), "invalid_response")
    questions = request["questions"]
    raw = response.get("answers")
    if provider == "openai":
        require(isinstance(raw, list) and len(raw) == len(questions), "invalid_answer_count")
        require(all(isinstance(row, dict) for row in raw), "invalid_answer")
        require([row.get("name") for row in raw] == [q["name"] for q in questions], "answer_name_or_order_mismatch")
        answers = raw
    else:
        require(isinstance(raw, dict) and set(raw) == {q["name"] for q in questions}, "answer_name_mismatch")
        answers = [raw[q["name"]] for q in questions]
    normalized = []
    for question, answer in zip(questions, answers):
        require(isinstance(answer, dict), "invalid_answer")
        kind = question["type"]
        item = {"name": question["name"], "type": kind}
        if answer.get("type") == "refusal":
            normalized.append({"name": question["name"], "type": "refusal"})
            continue
        if provider == "openai":
            require(answer.get("type") == kind, "answer_type_mismatch")
        elif "type" in answer:
            require(answer["type"] == ("noul" if kind == "predicate" else kind), "answer_type_mismatch")
        if kind == "predicate":
            item["probability"] = probability(answer.get("probability" if provider == "openai" else "noul"))
        else:
            item["confidence"] = probability(answer.get("confidence"))
            rows = answer.get("probabilities")
            if kind == "choice":
                expected = {typed(row["value"]) for row in question["choices"]}
                chosen = answer.get("choice")
                if provider == "d1":
                    labels = d1_labels(question)
                    require(type(chosen) is str and chosen in labels, "unknown_choice_value")
                    require(isinstance(rows, dict) and set(rows) == set(labels), "invalid_distribution")
                    chosen = question["choices"][labels.index(chosen)]["value"]
                    rows = [{"value": option["value"], "probability": rows[label]}
                            for label, option in zip(labels, question["choices"])]
                require(typed(chosen) in expected, "unknown_choice_value")
                item.update(choice=chosen, probabilities=distribution(rows, expected))
            else:
                labels = [row["label"] for row in question["levels"]]
                score = answer.get("score")
                require(numeric(score) and 0 <= score <= len(labels) - 1, "invalid_score")
                if provider == "d1":
                    # d1's native score distributions are indexed from zero.
                    if isinstance(rows, dict):
                        require(set(rows) == {str(i) for i in range(len(labels))}, "invalid_distribution")
                        rows = [rows[str(i)] for i in range(len(labels))]
                    require(isinstance(rows, list) and len(rows) == len(labels), "invalid_distribution")
                    rows = [{"value": i, "label": labels[i], "probability": p} for i, p in enumerate(rows)]
                rows = distribution(rows, labels, score=True)
                expected_score = sum(row["value"] * row["probability"] for row in rows)
                require(abs(score - expected_score) <= 0.02 * max(1, len(labels) - 1), "score_distribution_mismatch")
                item.update(score=score, probabilities=rows)
        normalized.append(item)
    return normalized


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class WireResponse:
    data: dict
    request_id: str | None = None


def http_post(url: str, key: str, body: dict, timeout_s: float) -> WireResponse:
    request = urllib.request.Request(url, data=json.dumps(body, allow_nan=False).encode(),
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout_s) as response:
        raw = response.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "response_size_limit")
        return WireResponse(json.loads(raw), response.headers.get("x-request-id"))


def source_context() -> dict:
    root = Path(__file__).resolve().parents[2]
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root,
                                         stderr=subprocess.DEVNULL, timeout=3, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        commit = None
    return {"source_commit": commit, "client_version": VERSION,
            "client_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "python": platform.python_version(), "platform": platform.platform()}


def redact(value, key: str):
    if isinstance(value, str):
        return value.replace(key, "[REDACTED]")
    if isinstance(value, list):
        return [redact(row, key) for row in value]
    if isinstance(value, dict):
        return {redact(k, key): redact(v, key) for k, v in value.items()}
    return value


def normalized_usage(usage):
    if not isinstance(usage, dict):
        return None
    out = {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        value = usage.get(key)
        if type(value) is int and value >= 0:
            out[key] = value
    for key, fields in (("input_tokens_details", ("cached_tokens", "cache_write_tokens")),
                        ("output_tokens_details", ("reasoning_tokens",))):
        if isinstance(usage.get(key), dict):
            out[key] = {name: usage[key][name] for name in fields
                        if type(usage[key].get(name)) is int and usage[key][name] >= 0}
    return out or None


def http_error_details(error: urllib.error.HTTPError) -> dict:
    """Read at most 8 KiB, retain only known codes; never return provider prose."""
    result = {"code": "http_error", "http_status": error.code}
    allowed = {"insufficient_quota", "rate_limit_exceeded", "invalid_api_key", "model_not_found",
               "access_denied", "authentication_error", "permission_error", "invalid_request_error",
               "server_error", "billing_hard_limit_reached", "credit_balance_exhausted", "quota_exceeded", "requests", "tokens"}
    try:
        raw = error.read(8193)
        if len(raw) > 8192:
            return result
        payload = json.loads(raw)
        detail = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(detail, dict):
            for field in ("code", "type"):
                value = detail.get(field)
                if isinstance(value, str) and value in allowed:
                    result["provider_error_" + field] = value
    except Exception:
        pass
    return result


class DecisionClient:
    def __init__(self, config: ProviderConfig, *, transport: Callable = http_post):
        self.config = config
        self.transport = transport
        # Resolve inexpensive machine/source metadata once per client, not every frame.
        self.source = source_context()

    def decide(self, request: dict, *, run_id: str | None = None) -> dict:
        started = time.perf_counter()
        config = self.config
        report = {"schema_version": 1, "run_id": run_id or uuid.uuid4().hex,
                  "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                  "provider": config.provider, "model": config.model,
                  "model_identity": "configured alias; unresolved revision" if config.provider == "d1" else "requested model",
                  "endpoint": endpoint(config.base_url), "timeout_s": config.timeout_s,
                  "client": self.source, "context": {}, "status": "failed", "answers": [],
                  "attempts": 0, "retries": 0, "usage": None, "provider_request_id": None,
                  "timing": {"total_wall_s": None, "request_wall_s": None, "queue_s": None},
                  "cost_usd": None,
                  "unavailable": {"queue_s": "provider does not expose queue timing",
                                  "provider_execution_s": "request wall time includes network and queue",
                                  "cost_usd": "billing not reported; token counts are not a bill",
                                  "model_revision": "configured model name does not pin serving revision",
                                  "build_simulation_s": "not performed by this client"}}
        try:
            body = to_wire(request, config)
            # Size diagnostics only: never persist request bodies or credentials.
            report["input_size"] = {
                "wire_bytes": len(json.dumps(body, allow_nan=False).encode()),
                "state_utf8_bytes": len((request.get("state") or "").encode()),
                "image_data_url_bytes": sum(len(image.encode()) for image in request.get("images", [])),
                "image_count": len(request.get("images", [])),
                "question_count": len(request["questions"]),
                "choice_counts": {q["name"]: len(q["choices"]) for q in request["questions"] if q["type"] == "choice"}}
            report["context"] = request.get("context", {})
            report["request_sha256"] = hashlib.sha256(json.dumps(request, sort_keys=True, allow_nan=False).encode()).hexdigest()
            report["attempts"] = 1
            request_started = time.perf_counter()
            try:
                wire = self.transport(report["endpoint"], config.api_key, body, config.timeout_s)
            finally:
                report["timing"]["request_wall_s"] = round(time.perf_counter() - request_started, 6)
            report["provider_request_id"] = wire.request_id if isinstance(wire.request_id, str) else None
            report["answers"] = from_wire(wire.data, request, config.provider)
            report["usage"] = normalized_usage(wire.data.get("usage"))
            returned_model = wire.data.get("model")
            if isinstance(returned_model, str):
                report["reported_model"] = returned_model
            refusals = sum(row["type"] == "refusal" for row in report["answers"])
            report["status"] = ("refused" if refusals == len(report["answers"]) else "partial_refusal") if refusals else "success"
        except KeyboardInterrupt:
            report["status"] = "cancelled"
            report["error"] = {"code": "cancelled"}
        except urllib.error.HTTPError as error:
            report["error"] = http_error_details(error)
        except (TimeoutError, socket.timeout):
            report["error"] = {"code": "timeout"}
        except urllib.error.URLError as error:
            report["error"] = {"code": "timeout" if isinstance(error.reason, TimeoutError) else "transport_error"}
        except DecisionError as error:
            report["error"] = {"code": str(error)}
        except (ValueError, UnicodeError):
            report["error"] = {"code": "invalid_json_response"}
        except Exception:
            # Includes unexpected proxy errors. Do not expose messages or response bodies.
            report["error"] = {"code": "transport_or_response_error"}
        report["timing"]["total_wall_s"] = round(time.perf_counter() - started, 6)
        return redact(report, config.api_key)
