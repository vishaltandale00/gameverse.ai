"""Bounded, credential-safe smoke probe for the local model proxy (stdlib only).

LITELLM_API_KEY=... python3 tools/re/probe_models.py --frame /absolute/frame.png
Makes at most three requests, without retries; preserves existing capture outputs.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
PROBE_VERSION = 1
MAX_BYTES = 2 * 1024 * 1024
SEGMENTS = {
    "gameplay": "In-world action, racing, platforming, or exploration",
    "battle_or_tactics": "Player-facing turn-based battle, card battle, or tactical board",
    "menu_or_title": "Title, file select, options, or other front-end menu",
    "story_or_dialogue": "Story scene or dialogue, rather than an active battle",
    "logo_or_transition": "Logo, legal screen, blank screen, loading, or transition",
    "uncertain": "Cannot distinguish the segment from this image",
}
QUESTIONS = {
    "segment": {
        "type": "choice",
        "instructions": "Classify the visible GBA screen. An image cannot establish live control versus a demo.",
        "criteria": SEGMENTS,
    },
    "gameplay": {
        "type": "noul",
        "instructions": "Is this Game Boy Advance screenshot showing active gameplay, where the player controls a "
                        "character or vehicle in the game world?",
        "criteria": {
            "true": "active gameplay in the game world (a HUD or small pause overlay is fine)",
            "false": "a menu, title screen, file/name select, logo, legal notice, story cutscene, "
                     "narration text, or blank/transition screen",
        },
    },
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def git(*args: str) -> str | None:
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, stderr=subprocess.DEVNULL,
                                       timeout=5, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        return None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirect target.


def request(base: str, path: str, key: str, timeout: float, body=None):
    req = urllib.request.Request(base + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key,
                                          "Content-Type": "application/json"})
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(req, timeout=timeout) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("response limit")
        return json.loads(raw)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def decision_summary(response) -> dict:
    if not isinstance(response, dict):
        return {"valid": False, "response_type": type(response).__name__}
    answers = response.get("answers", {})
    out = {"response_keys": sorted(response), "answer_keys": sorted(answers) if isinstance(answers, dict) else [],
           "answers": {}}
    for name in QUESTIONS:
        answer = answers.get(name, {}) if isinstance(answers, dict) else {}
        if not isinstance(answer, dict):
            continue
        item = {"fields": sorted(answer)}
        if name == "segment":
            item["choice"] = answer.get("choice") if answer.get("choice") in SEGMENTS else None
            item["confidence"] = number(answer.get("confidence"))
            probs = answer.get("probabilities", {})
            item["probabilities"] = {label: number(probs.get(label)) for label in SEGMENTS} if isinstance(probs, dict) else {}
        else:
            item["noul"] = number(answer.get("noul"))
        out["answers"][name] = item
    segment = out["answers"].get("segment", {})
    probs = segment.get("probabilities", {})
    p_gameplay = out["answers"].get("gameplay", {}).get("noul")
    out["valid"] = (segment.get("choice") in SEGMENTS
                    and all(probs.get(label) is not None and 0 <= probs[label] <= 1 for label in SEGMENTS)
                    and abs(sum(probs.values()) - 1) < 0.02
                    and p_gameplay is not None and 0 <= p_gameplay <= 1)
    return out


def embedding_summary(response) -> dict:
    data = response.get("data", []) if isinstance(response, dict) else []
    if not isinstance(data, list) or len(data) != 2:
        return {"valid": False, "count": len(data) if isinstance(data, list) else None}
    indexed = {row.get("index"): row.get("embedding") for row in data if isinstance(row, dict)}
    if set(indexed) != {0, 1}:
        return {"valid": False, "index_mapping_valid": False}
    vectors = [indexed[i] for i in (0, 1)]
    dimensions = [len(v) if isinstance(v, list) else None for v in vectors]
    finite = [isinstance(v, list) and bool(v) and all(number(n) is not None for n in v) for v in vectors]
    norms = [math.sqrt(sum(n * n for n in v)) if ok else None for v, ok in zip(vectors, finite)]
    comparable = all(finite) and dimensions[0] == dimensions[1] and all(n and math.isfinite(n) for n in norms)
    cosine = sum(a * b for a, b in zip(*vectors)) / (norms[0] * norms[1]) if comparable else None
    max_difference = max(abs(a - b) for a, b in zip(*vectors)) if comparable else None
    return {"valid": bool(comparable and max_difference > 1e-7), "count": 2,
            "dimensions": dimensions, "finite": finite, "norms": [number(n) for n in norms],
            "cosine_similarity": number(cosine), "max_absolute_difference": number(max_difference),
            "note": "Distinct vectors test transport only; this does not establish semantic quality."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000"))
    parser.add_argument("--frame", type=Path, required=True)
    parser.add_argument("--embedding-model", default="ramblerun/TextEmbedding-AI")
    parser.add_argument("--decision-model", default="ramblerun/Decision-AI",
                        help="Recorded alias; /v1/decisions is routed by the proxy without a model field")
    parser.add_argument("--timeout", type=float, default=75)
    args = parser.parse_args()
    key = os.environ.get("LITELLM_API_KEY")
    if not key:
        parser.error("LITELLM_API_KEY must be set in the environment")
    base = args.base.rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("--base must be an HTTP(S) URL without credentials, query, or fragment")
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 75:
        parser.error("--timeout must be greater than zero and at most 75 seconds")
    frame = args.frame.expanduser().resolve()
    if not frame.is_file() or frame.stat().st_size > MAX_BYTES:
        parser.error("--frame must be an existing PNG of at most 2 MiB")
    raw = frame.read_bytes()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        parser.error("--frame must have a PNG signature")
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    output = ROOT / "local/re/model-probes" / (run_id + ".json")
    output.parent.mkdir(parents=True, exist_ok=True)
    status = git("status", "--porcelain")
    report = {"run_id": run_id, "probe_version": PROBE_VERSION, "started_utc": utc_now(),
              "source_commit": git("rev-parse", "HEAD"), "source_dirty": None if status is None else bool(status),
              "tool_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "environment": {"python": platform.python_version(), "platform": platform.platform()},
              "config": {"base": base, "embedding_model": args.embedding_model,
                         "decision_model_alias": args.decision_model, "timeout_s": args.timeout,
                         "max_requests": 3, "retries": 0},
              "frame": {"path": str(frame), "sha256": hashlib.sha256(raw).hexdigest()},
              "unavailable": {"queue_time": "proxy does not expose queue timing",
                              "provider_execution": "request wall time includes transport and queue",
                              "resolved_model_revision": "aliases do not establish underlying revisions",
                              "game_version": "not inferred from a frame path", "adapter_version": "not applicable",
                              "build_simulation_evaluation": "not performed by this transport probe"},
              "stages": [], "outcome": "running"}
    started = time.perf_counter()

    def save():
        report["total_wall_s"] = round(time.perf_counter() - started, 6)
        # Never persist an echoed secret, including unexpected response field names.
        text = json.dumps(report, indent=2, allow_nan=False).replace(key, "[REDACTED]")
        output.write_text(text + "\n")

    def stage(name, path, body, summarize):
        entry = {"name": name, "request_id": run_id + ":" + name,
                 "started_utc": utc_now(), "attempts": 1, "outcome": "running"}
        report["stages"].append(entry)
        save()
        t0 = time.perf_counter()
        try:
            response = request(base, path, key, args.timeout, body)
            entry["result"] = summarize(response)
            entry["outcome"] = "success" if entry["result"].get("valid") else "invalid_response"
        except KeyboardInterrupt:
            entry["outcome"] = "cancelled"
            raise
        except Exception as error:
            entry["outcome"] = "failed"
            entry["error_type"] = type(error).__name__
            if isinstance(error, urllib.error.HTTPError):
                entry["http_status"] = error.code
            # No exception messages or server response bodies: either may echo secrets.
        finally:
            entry["wall_s"] = round(time.perf_counter() - t0, 6)
            save()

    def model_summary(response):
        rows = response.get("data", []) if isinstance(response, dict) else []
        ids = [r["id"] for r in rows if isinstance(r, dict) and isinstance(r.get("id"), str)] if isinstance(rows, list) else []
        return {"valid": bool(ids), "model_ids": [s[:200] for s in ids[:100]],
                "model_count": len(ids), "embedding_alias_listed": args.embedding_model in ids,
                "decision_alias_listed": args.decision_model in ids}

    save()
    try:
        stage("models", "/v1/models", None, model_summary)
        image = "data:image/png;base64," + base64.b64encode(raw).decode()
        stage("decisions", "/v1/decisions", {"state": None, "questions": QUESTIONS, "images": [image]}, decision_summary)
        stage("embeddings", "/v1/embeddings",
              {"model": args.embedding_model,
               "input": ["task: clustering | query: A Game Boy Advance title menu with selectable options.", {"image": image}]},
              embedding_summary)
        report["outcome"] = "success" if all(s["outcome"] == "success" for s in report["stages"]) else "failed"
    except KeyboardInterrupt:
        report["outcome"] = "cancelled"
    finally:
        report["finished_utc"] = utc_now()
        save()
    print(str(output))
    return 0 if report["outcome"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
