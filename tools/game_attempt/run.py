"""Generate data-only reference candidates and evaluate through the shared tester."""
from __future__ import annotations

import copy
from dataclasses import asdict, dataclass
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import uuid

from tools.decisions.client import endpoint, http_error_details, http_post, redact, source_context
from . import VERSION

ROOT = Path(__file__).resolve().parents[2]
MAX_REQUEST_BYTES = 64 * 1024
GAME_FIELDS = {"title", "width", "height", "start", "goal", "walls", "keys", "doors", "max_episode_steps"}


class AttemptError(ValueError):
    """Static errors, with no provider responses or credentials in their text."""


def require(condition, code):
    if not condition:
        raise AttemptError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, allow_nan=False).encode()


def scrub(value):
    for name in ("LITELLM_API_KEY", "OPENAI_API_KEY"):
        if os.environ.get(name):
            value = redact(value, os.environ[name])
    return value


def validate_request(request):
    require(isinstance(request, dict) and request.get("schema_version") == 1, "invalid_request_version")
    require(set(request) <= {"schema_version", "candidate_id", "title", "intent", "components", "constraints"}, "unknown_request_field")
    require(isinstance(request.get("candidate_id"), str)
            and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", request["candidate_id"]), "invalid_candidate_id")
    for field in ("title", "intent"):
        require(isinstance(request.get(field), str) and 0 < len(request[field]) <= (200 if field == "title" else 4000), "invalid_" + field)
    rows = request.get("components")
    require(isinstance(rows, list) and 1 <= len(rows) <= 8, "invalid_component_count")
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and set(row) == {"game_id", "component_id", "adaptation"}, "invalid_component_selection")
        require(isinstance(row["game_id"], str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,100}", row["game_id"]), "invalid_source_game")
        require(isinstance(row["component_id"], str) and re.fullmatch(r"[a-z0-9_]{1,120}", row["component_id"]), "invalid_source_component")
        require(isinstance(row["adaptation"], str) and 0 < len(row["adaptation"]) <= 1500, "invalid_adaptation")
        identity = row["game_id"], row["component_id"]
        require(identity not in seen, "duplicate_component_selection")
        seen.add(identity)
    constraints = request.get("constraints", {})
    require(isinstance(constraints, dict) and set(constraints) <= {"max_width", "max_height", "max_episode_steps"}, "invalid_constraints")
    for name, maximum in (("max_width", 64), ("max_height", 64), ("max_episode_steps", 1000)):
        value = constraints.get(name, maximum)
        require(type(value) is int and 1 <= value <= maximum, "invalid_constraint")
    require(len(canonical(request)) <= MAX_REQUEST_BYTES, "request_size_limit")


def pin_components(request, *, repository=ROOT):
    """Snapshot exact component blocks; this is an anchor scanner, not a YAML parser.

    Canonical repository records place components at top-level '- id: NAME'.
    We do not interpret parameter values or automatically compile their rules.
    """
    results = []
    for row in request["components"]:
        relative = Path("ontology/games") / (row["game_id"] + ".yaml")
        path = repository / relative
        try:
            raw = path.read_bytes()
            text = raw.decode("utf-8")
        except (OSError, UnicodeError):
            raise AttemptError("component_source_unavailable") from None
        markers = list(re.finditer(r"(?m)^- id: ([a-z0-9_]+)\s*$", text))
        matching = [index for index, marker in enumerate(markers) if marker.group(1) == row["component_id"]]
        require(len(matching) == 1, "component_anchor_missing_or_ambiguous")
        index = matching[0]
        start = markers[index].start()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        # End of the final components sequence may precede later top-level fields.
        suffix = text[start:end]
        boundary = re.search(r"(?m)^[A-Za-z_][A-Za-z_0-9]*:", suffix)
        if boundary:
            end = start + boundary.start()
        block = text[start:end]
        refs = [line.strip() for line in block.splitlines() if re.match(r"\s+ref:", line)]
        results.append(dict(row, source_ref=relative.as_posix() + "#" + row["component_id"],
                            source_sha256=sha(block.encode()), source_file_sha256=sha(raw),
                            start_line=text.count("\n", 0, start) + 1,
                            end_line=text.count("\n", 0, end),
                            source_reference_lines=refs, snapshot_text=block))
    return results


def template(request, sources):
    """Hand-authored mechanic template, not automatic compilation of source rules."""
    width, height = 9, 5
    walls = [[x, y] for y in range(height) for x in range(width)
             if x in (0, width - 1) or y in (0, height - 1)] + [[4, 1], [4, 3]]
    return {"schema_version": 1, "game_id": request["candidate_id"], "title": request["title"],
            "width": width, "height": height, "start": [1, 2], "goal": [7, 2], "walls": walls,
            "keys": [{"id": "field-key", "position": [2, 1]}],
            "doors": [{"id": "ability-gate", "position": [4, 2], "requires": "field-key"}],
            "max_episode_steps": 80,
            "source_components": [{name: source[name] for name in ("game_id", "component_id", "source_ref", "source_sha256")}
                                  for source in sources],
            "notes": "Reference grid game using simplified tile movement and key-gate mechanic templates. "
                     "Ontology selections are source-linked design analogies, not automatically compiled ROM rules, transplanted assets, or GBA regeneration."}


@dataclass(frozen=True)
class GeneratorConfig:
    provider: str = "template"
    model: str | None = None
    timeout_s: float = 30
    max_tokens: int = 1024

    def __post_init__(self):
        require(self.provider in ("template", "local", "openai"), "invalid_generator")
        require(type(self.timeout_s) in (float, int) and math.isfinite(self.timeout_s) and 0 < self.timeout_s <= 60, "invalid_generator_timeout")
        require(type(self.max_tokens) is int and 64 <= self.max_tokens <= 4096, "invalid_generation_token_limit")
        require(self.model is None or isinstance(self.model, str) and 0 < len(self.model) <= 200, "invalid_generation_model")


def propose(request, base, config, *, transport=http_post, proposal_sink=None):
    if config.provider == "template":
        return base, {"provider": "template", "model": None, "requests": 0, "retries": 0, "usage": None}
    local = config.provider == "local"
    key = os.environ.get("LITELLM_API_KEY" if local else "OPENAI_API_KEY", "")
    require(bool(key) and not any(c.isspace() for c in key), "missing_generation_api_key")
    model = config.model or os.environ.get("LITELLM_GENERATION_MODEL" if local else "OPENAI_GENERATION_MODEL")
    if local and not model:
        model = "ramblerun/Multimodal-AI"
    require(isinstance(model, str) and bool(model), "generation_model_required")
    base_url = os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000") if local else os.environ.get("OPENAI_GENERATION_BASE_URL", "https://api.openai.com")
    url = endpoint(base_url).removesuffix("/decisions") + "/chat/completions"
    require(local or urllib.parse.urlsplit(url).scheme == "https", "openai_requires_https")
    prompt = {"intent": request["intent"], "constraints": request.get("constraints", {}),
              "selected_components": request["components"],
              "source_anchors": base["source_components"],
              "reference_template": {k: base[k] for k in sorted(GAME_FIELDS)},
              "semantics": "Grid coordinates x,y. Wall blocks movement. Enter key cell to collect. "
                           "Interact while adjacent to open a door after collecting its required key. Enter goal cell to win."}
    body = {"model": model, "messages": [
        {"role": "system", "content": "Return only a JSON object with exactly the reference_template fields. "
         "Propose a small playable reference grid game for the requested intent. Use only data, never code. "
         "Keep at least one key and required door. Do not add source citations or claim ROM regeneration. "
         "Only the supplied source anchors exist; adaptation is a design analogy. Ensure start, keys and goal are accessible in the intended order."},
        {"role": "user", "content": json.dumps(prompt, allow_nan=False)}],
        "response_format": {"type": "json_object"}, "stream": False,
        "max_tokens" if local else "max_completion_tokens": config.max_tokens}
    thinking = os.environ.get("LITELLM_GENERATION_ENABLE_THINKING") if local else None
    if thinking is not None:
        require(thinking.lower() in ("true", "false"), "invalid_generation_thinking_flag")
        body["chat_template_kwargs"] = {"enable_thinking": thinking.lower() == "true"}
    response = transport(url, key, body, config.timeout_s)
    try:
        choices = response.data["choices"]
        require(isinstance(choices, list) and len(choices) == 1 and choices[0].get("finish_reason") == "stop", "generation_incomplete")
        message = choices[0]["message"]
        require(not message.get("refusal") and not message.get("tool_calls"), "generation_refused_or_tool_call")
        content = message["content"]
        require(isinstance(content, str) and len(content.encode()) <= 64 * 1024, "invalid_generation_content")
        if proposal_sink:
            proposal_sink({"untrusted_model_text": content})
        data = json.loads(content)
    except (KeyError, TypeError, ValueError):
        raise AttemptError("invalid_generation_response") from None
    require(isinstance(data, dict) and set(data) == GAME_FIELDS, "invalid_generation_fields")
    # Provider data cannot replace identity, provenance or runtime selection.
    candidate = dict(base, **data)
    usage = response.data.get("usage")
    usage = {k: v for k, v in usage.items() if k in ("prompt_tokens", "completion_tokens", "total_tokens")
             and type(v) is int and v >= 0} if isinstance(usage, dict) else None
    return candidate, {"provider": config.provider, "model": model, "requests": 1, "retries": 0,
                       "usage": usage, "provider_request_id": response.request_id,
                       "prompt_sha256": sha(canonical(prompt)), "response_content_sha256": sha(content.encode())}


def check_constraints(candidate, request):
    require(bool(candidate.get("keys")) and bool(candidate.get("doors")), "key_gate_objects_required")
    for field, constraint in (("width", "max_width"), ("height", "max_height"), ("max_episode_steps", "max_episode_steps")):
        bound = request.get("constraints", {}).get(constraint, 64 if field != "max_episode_steps" else 1000)
        require(type(candidate.get(field)) is int and candidate[field] <= bound, "candidate_exceeds_request_constraint")


def evaluate(candidate, output, *, limits=None, policy="frontier"):
    from tools.playtester.adapters import GridAdapter, validate_game
    from tools.playtester.core import FrontierPolicy, Limits, Playtester
    validate_game(candidate)
    profile = {"schema_version": 1, "game_id": candidate["game_id"],
               "objective": "Collect the required key, open the gate and reach the goal.",
               "awareness": {"perspective": "top_down", "locomotion": "grid", "basis": "candidate manifest"}}
    require(policy in ("frontier", "d1", "openai"), "invalid_playtest_policy")
    if policy == "frontier":
        controller = FrontierPolicy()
    else:
        from tools.decisions import ProviderConfig
        from tools.playtester.models import DecisionPolicy
        controller = DecisionPolicy(ProviderConfig.from_env(policy, timeout_s=20))
    tester = Playtester(GridAdapter(candidate), profile, controller,
                        limits=limits or Limits(max_steps=80, max_frames=4800, max_seconds=10,
                                                max_decisions=20, max_escalations=0), output=output)
    report = tester.run()
    # This attempt template requires a witnessed key/gate sequence, beyond the
    # generic adapter's goal-cell terminal condition. The first manifest door is
    # the explicitly selected required gate; other doors may be optional.
    gate = candidate["doors"][0]
    observations = [event["observation"] for event in tester.events if event.get("event") == "observation"]
    prior = []
    goal_observed = False
    for observation in observations:
        if observation.get("terminal") and observation.get("success"):
            goal_observed = True
            break
        prior.append(observation)
    checks = {"required_gate_id": gate["id"], "required_key_id": gate["requires"],
              "key_collected_before_goal": any(gate["requires"] in obs.get("facts", {}).get("inventory", []) for obs in prior),
              "gate_opened_before_goal": any(gate["id"] in obs.get("facts", {}).get("opened_doors", []) for obs in prior),
              "goal_observed": goal_observed,
              "basis": "actual adapter observations, not model claims; first manifest door is required"}
    report["attempt_objective_checks"] = checks
    report["adapter_objective_status"] = report["status"]
    if report["status"] == "success" and not all(checks[field] for field in
            ("key_collected_before_goal", "gate_opened_before_goal", "goal_observed")):
        report.update(status="objective_unmet", reason="required_key_gate_not_observed")
    (Path(output) / "report.json").write_text(json.dumps(scrub(report), indent=2, allow_nan=False) + "\n")
    return report


def run_attempt(request, output_root, *, generator=None, limits=None, repository=ROOT, transport=http_post, evaluator=evaluate, policy="frontier"):
    from tools.playtester.core import Limits
    started = time.monotonic()
    generator = generator or GeneratorConfig()
    limits = limits or Limits(max_steps=80, max_frames=4800, max_seconds=10, max_decisions=20, max_escalations=0)
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    output_root = Path(output_root)
    directory = output_root / run_id
    directory.mkdir(parents=True, exist_ok=False)
    report = {"schema_version": 1, "attempt_id": run_id, "attempt_version": VERSION,
              "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "failed", "outcome": "failed",
              "source": dict(source_context(), attempt_code_sha256=sha(Path(__file__).read_bytes())),
              "generator": {"provider": generator.provider, "model": generator.model, "requests": 0, "retries": 0,
                            "max_tokens": generator.max_tokens, "timeout_s": generator.timeout_s},
              "attempts": 1, "repairs": 0, "artifacts": {"directory": str(directory)},
              "playtest_policy": policy,
              "playtest_limits": asdict(limits),
              "timing": {"total_wall_s": None, "generation_s": None, "validation_s": None, "playthrough_s": None,
                         "queue_s": None, "build_s": None},
              "unavailable": {"queue_s": "not exposed", "build_s": "data-only candidate; no build", "cost_usd": "billing not exposed"},
              "limitations": ["Reference grid game, not ROM reconstruction or GBA game generation",
                              "Mechanic templates adapt design analogies; source rules are not automatically compiled",
                              "Observed playthrough establishes this candidate's behavior only; source-game claims remain separately qualified"]}
    def save(name, value):
        (directory / name).write_text(json.dumps(scrub(value), indent=2, allow_nan=False) + "\n")
    save("attempt.json", report)
    try:
        validate_request(request)
        save("request.json", request)
        report["request_sha256"] = sha(canonical(request))
        report["intent"] = request["intent"]
        report["constraints"] = request.get("constraints", {})
        sources = pin_components(request, repository=repository)
        snapshot_dir = directory / "components"
        snapshot_dir.mkdir()
        for index, source in enumerate(sources):
            snapshot = snapshot_dir / f"{index}.yaml"
            snapshot.write_text(source.pop("snapshot_text"))
            source["snapshot_ref"] = str(snapshot)
        report["selected_components"] = sources
        save("sources.json", sources)
        t = time.monotonic()
        def counted_transport(*args, **kwargs):
            report["generator"]["requests"] += 1
            report["generator"].update(model=args[2]["model"], endpoint=args[0])
            if "chat_template_kwargs" in args[2]:
                report["generator"]["enable_thinking"] = args[2]["chat_template_kwargs"]["enable_thinking"]
            response = transport(*args, **kwargs)
            if isinstance(response.data, dict) and isinstance(response.data.get("usage"), dict):
                report["generator"]["usage"] = {k: v for k, v in response.data["usage"].items()
                    if k in ("prompt_tokens", "completion_tokens", "total_tokens") and type(v) is int and v >= 0}
            return response
        try:
            candidate, generation = propose(request, template(request, sources), generator, transport=counted_transport,
                                             proposal_sink=lambda value: save("proposal.json", value))
            report["generator"].update(generation)
        finally:
            report["timing"]["generation_s"] = round(time.monotonic() - t, 6)
        # Retain data-only proposals, including invalid ones, for diagnosing failed attempts.
        save("candidate.json", candidate)
        report["artifacts"]["candidate"] = str(directory / "candidate.json")
        report["candidate_sha256"] = sha(canonical(candidate))
        t = time.monotonic()
        try:
            from tools.playtester.adapters import validate_game
            validate_game(candidate)
            check_constraints(candidate, request)
        finally:
            report["timing"]["validation_s"] = round(time.monotonic() - t, 6)
        t = time.monotonic()
        try:
            play = evaluator(candidate, directory / "playthrough", limits=limits, policy=policy)
        finally:
            report["timing"]["playthrough_s"] = round(time.monotonic() - t, 6)
        report["playthrough"] = {"run_id": play["run_id"], "status": play["status"], "reason": play["reason"],
                                 "steps": play["steps"], "frames": play["frames"],
                                 "barrier_candidates": play["barrier_candidates"],
                                 "objective_checks": play.get("attempt_objective_checks")}
        report["artifacts"]["playthrough"] = str(directory / "playthrough" / "report.json")
        report["status"] = report["outcome"] = ("success" if play["status"] == "success" else
                                                "objective_unmet" if play["status"] == "objective_unmet" else "playthrough_failed")
    except KeyboardInterrupt:
        report["status"] = report["outcome"] = "cancelled"
        report["error"] = {"code": "cancelled"}
    except urllib.error.HTTPError as error:
        report["error"] = http_error_details(error)
    except AttemptError as error:
        report["error"] = {"code": str(error)}
    except Exception as error:
        # Allow only the tester's static diagnostic codes, never provider prose.
        from tools.playtester.core import PlaytestError
        report["error"] = {"code": str(error) if isinstance(error, PlaytestError) else "generation_or_evaluation_failed"}
    finally:
        report["timing"]["total_wall_s"] = round(time.monotonic() - started, 6)
        report["timing_note"] = "Generation, validation and playthrough are sequential stages nested inside total. Build and queue unavailable, not zero."
        report = scrub(report)
        save("attempt.json", report)
        with (output_root / "attempts.jsonl").open("a") as handle:
            handle.write(json.dumps(report, allow_nan=False) + "\n")
    return report
