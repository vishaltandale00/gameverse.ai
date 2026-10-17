"""Short-horizon control; observations are evidence, model interpretations hypotheses."""
from __future__ import annotations

from tools.prompts import load as load_prompts, render as render_prompt

from collections import Counter
from dataclasses import asdict, dataclass
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import time
import uuid

from . import VERSION


class PlaytestError(ValueError):
    """Static diagnostic codes, never provider bodies/credential-bearing arguments."""


def require(value, code):
    if not value:
        raise PlaytestError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


KEYS = {"A", "B", "SELECT", "START", "RIGHT", "LEFT", "UP", "DOWN", "R", "L"}


def actions_checked(actions, max_frames):
    require(isinstance(actions, list) and 1 <= len(actions) <= 254, "invalid_action_count")
    seen = set()
    for action in actions:
        require(isinstance(action, dict), "invalid_action")
        name = action.get("id")
        require(isinstance(name, str) and 0 < len(name) <= 128 and name != "STOP" and name not in seen,
                "invalid_action_id")
        seen.add(name)
        require(isinstance(action.get("description"), str) and len(action["description"]) <= 2000,
                "invalid_action_description")
        require(type(action.get("frames")) is int and 0 < action["frames"] <= max_frames, "invalid_action_frames")
        keys = action.get("keys", [])
        require(isinstance(keys, list) and len(keys) == len(set(keys)) and all(k in KEYS for k in keys),
                "invalid_action_keys")
    return actions


def observation_checked(obs):
    require(isinstance(obs, dict), "invalid_observation")
    require(isinstance(obs.get("state_key"), str) and 0 < len(obs["state_key"]) <= 256, "invalid_state_key")
    require(type(obs.get("frame")) is int and obs["frame"] >= 0, "invalid_observation_frame")
    require(isinstance(obs.get("facts", {}), dict) and isinstance(obs.get("progress", {}), dict),
            "invalid_observation_facts")
    require(isinstance(obs.get("phase", "unknown"), str), "invalid_phase")
    require(type(obs.get("terminal", False)) is bool and type(obs.get("success", False)) is bool,
            "invalid_terminal")
    require(obs.get("image") is None or isinstance(obs["image"], str), "invalid_image_reference")
    require(len(json.dumps(obs, allow_nan=False).encode()) <= 1024 * 1024, "observation_size_limit")
    return obs


@dataclass(frozen=True)
class Limits:
    max_steps: int = 80
    max_frames: int = 9600
    max_seconds: float = 120
    max_decisions: int = 20
    max_escalations: int | None = 3
    max_model_calls: int | None = None
    max_system2_repairs: int = 1
    max_action_frames: int = 120
    model_timeout_s: float = 20
    stationary_min_frames: int = 0
    stationary_threshold: int = 3
    confidence_threshold: float = .65
    margin_threshold: float = .20

    def __post_init__(self):
        for key in ("max_steps", "max_frames", "max_decisions", "max_system2_repairs", "stationary_min_frames"):
            require(type(getattr(self, key)) is int and getattr(self, key) >= 0, "invalid_limit_" + key)
        require(self.max_model_calls is None or (type(self.max_model_calls) is int and self.max_model_calls >= 0), "invalid_limit_max_model_calls")
        require(self.max_escalations is None or (type(self.max_escalations) is int and self.max_escalations >= 0), "invalid_limit_max_escalations")
        for key in ("max_action_frames", "stationary_threshold"):
            require(type(getattr(self, key)) is int and getattr(self, key) > 0, "invalid_limit_" + key)
        for key in ("max_seconds", "model_timeout_s"):
            v = getattr(self, key)
            require(type(v) in (int, float) and math.isfinite(v) and v > 0, "invalid_limit_" + key)
        for key in ("confidence_threshold", "margin_threshold"):
            require(0 <= getattr(self, key) <= 1, "invalid_limit_" + key)


class FrontierPolicy:
    """Explicit offline baseline; ranks adapter targets using observed visit counts."""
    requires_model = False

    def choose(self, context, options, timeout_s):
        visits = context["memory"]["state_visits"]
        attempts = context["memory"]["action_attempts"]
        # target_state_key is an adapter prediction, never fabricated by this controller.
        pick = min(options, key=lambda a: (0 if a.get("objective_hint") else 1,
                                          visits.get(a.get("target_state_key", ""), 0),
                                          attempts.get(a["id"], 0), a["id"]))
        return {"action_id": pick["id"], "accepted": True, "record": {"policy": "frontier_baseline"}}


class Playtester:
    def __init__(self, adapter, profile, policy, *, system2=None, limits=None, output=None):
        self.adapter, self.profile, self.policy, self.system2 = adapter, profile, policy, system2
        self.limits = limits or Limits()
        self.output = Path(output) if output else None
        require(isinstance(profile, dict) and profile.get("schema_version") == 1, "invalid_profile")
        require(isinstance(profile.get("game_id"), str), "invalid_profile_game")
        self.states, self.attempts, self.stationary = Counter(), Counter(), Counter()
        self.stationary_frames = Counter()
        self.events, self.barriers, self.transitions = [], [], []
        self.active_target = None
        self.system2_plan = None
        self.safe_wait_callback = None
        self.continue_action_id = None
        self.model_wall_s = {'system1': 0., 'system2': 0.}
        self.decisions = self.escalations = self.frames = self.steps = 0
        self.awareness = profile.get("awareness", {"perspective": "unknown", "locomotion": "unknown"})
        self.run_id = uuid.uuid4().hex

    def _event(self, event):
        self.events.append(event)
        if self.output:
            with (self.output / "events.jsonl").open("a") as f:
                f.write(json.dumps(event, allow_nan=False) + "\n")

    def _context(self, obs, options):
        attempts = {a["id"]: self.attempts[(obs["state_key"], a["id"])] for a in options}
        return {"objective": self.profile.get("objective", "Explore and identify mechanics and barriers"),
                "awareness": self.awareness, "observation": obs, "step": self.steps,
                "context_assembled_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "memory": {"state_visits": dict(self.states), "action_attempts": attempts,
                           "recent_transitions": self.transitions[-6:], "barrier_candidates": self.barriers[-6:],
                           "active_target": self.active_target, "system2_plan": self.system2_plan,
                           "resume_origin":getattr(self,"resume_origin",None)},
                "game_id": self.profile["game_id"], "run_id": self.run_id,
                "game_version": self.metadata["game_version"], "adapter_version": self.metadata.get("adapter_version"),
                "profile_sha256": digest(self.profile)}

    def _stationary_key(self, obs, action_id):
        partial = self.awareness.get("progress_evidence_scope") == "partial"
        basis = digest({"progress":obs["progress"],"visual":obs["state_key"]}) if partial and obs.get("progress") else digest(obs["progress"]) if obs.get("progress") else obs["state_key"]
        return basis, action_id

    def _timeout(self):
        return max(.001, min(self.limits.model_timeout_s, self.deadline - time.monotonic()))

    def _escalate(self, context, options, reason):
        if self.system2 is None:
            return None, "needs_system2:" + reason
        if self.limits.max_escalations is not None and self.escalations >= self.limits.max_escalations:
            return None, "escalation_limit"
        if time.monotonic() >= self.deadline:
            return None, "wall_time_limit"
        result = None
        repair = None
        for attempt in range(self.limits.max_system2_repairs + 1):
            if time.monotonic() >= self.deadline:
                return None, "wall_time_limit"
            if self.limits.max_escalations is not None and self.escalations >= self.limits.max_escalations:
                return None, "escalation_limit"
            if self.limits.max_model_calls is not None and self.decisions + self.escalations >= self.limits.max_model_calls:
                return None, "model_call_limit"
            self.escalations += 1
            request_context = dict(context, escalation_reason=reason)
            if repair:
                request_context["invalid_response_repair"] = repair
            model_started = time.monotonic()
            result = self.system2.choose(request_context, options, self._timeout())
            self.model_wall_s['system2'] += time.monotonic() - model_started
            self._event({"event": "system2", "step": self.steps, "reason": reason,
                         "repair_attempt": attempt, "result": result})
            error = result.get("record", {}).get("error")
            if result.get("accepted") or error not in ("invalid_llm_action_id", "invalid_llm_choice", "invalid_llm_choice_json"):
                break
            repair = {"error": error, "proposed_action_id": result.get("record", {}).get("proposed_action_id"),
                      "allowed_action_ids": [a["id"] for a in options] + ["STOP"],
                      "instruction": render_prompt(getattr(self.system2, "prompt_lock", None) or load_prompts(), "s2-response-repair")[0]}
        if not result.get("accepted") and time.monotonic() >= self.deadline:
            return None, "wall_time_limit"
        if result.get("action_id") == "STOP":
            return None, "system2_stop"
        if not result.get("accepted") or result.get("action_id") not in {a["id"] for a in options}:
            return None, "system2_unresolved"
        self.system2_plan = {"selected_action": result["action_id"], "hypothesis": result.get("reason"),
                             "escalation_reason": reason, "planned_at_step": self.steps,
                             "basis": "System2 hypothesis; validate against subsequent observations"}
        return result["action_id"], None

    def run(self):
        started = time.monotonic()
        started_utc = dt.datetime.now(dt.timezone.utc).isoformat()
        self.deadline = started + self.limits.max_seconds
        if self.output:
            self.output.mkdir(parents=True, exist_ok=False)
        meta = None
        outcome, reason = "stopped", "unknown"
        observe_s = action_s = policy_s = 0.
        try:
            meta = self.adapter.hello()
            self.metadata = meta
            require(meta.get("isolated") is True, "adapter_must_be_isolated")
            require({"observe", "act"} <= set(meta.get("capabilities", [])), "unsupported_adapter_capabilities")
            require(meta.get("schema_version") == 1, "unsupported_adapter_schema")
            require(meta.get("game_id") == self.profile["game_id"], "profile_adapter_game_mismatch")
            require(isinstance(meta.get("game_version"), str) and bool(meta["game_version"]), "missing_game_version")
            expected = self.profile.get("game_version")
            require(expected is None or meta["game_version"] == expected, "profile_game_version_mismatch")
            t = time.monotonic()
            obs = observation_checked(self.adapter.observe())
            observe_s += time.monotonic() - t
            self.states[obs["state_key"]] += 1
            self._event({"event": "observation", "step": 0, "observation": obs})
            while True:
                if obs.get("terminal"):
                    outcome, reason = ("success", "objective_observed") if obs.get("success") else ("terminal", "adapter_terminal")
                    break
                if time.monotonic() >= self.deadline:
                    reason = "wall_time_limit"
                    break
                if self.steps >= self.limits.max_steps:
                    reason = "step_limit"
                    break
                if self.frames >= self.limits.max_frames:
                    reason = "frame_limit"
                    break
                cap = min(self.limits.max_action_frames, meta.get("max_action_frames", self.limits.max_action_frames))
                options = actions_checked(obs.get("options", self.profile.get("actions", [])), cap)
                options = [a for a in options if a["frames"] <= self.limits.max_frames - self.frames]
                if not options:
                    reason = "remaining_frame_budget_too_small"
                    break
                context = self._context(obs, options)
                t = time.monotonic()
                stalled = [a for a in options if self.stationary[self._stationary_key(obs, a["id"])] >= self.limits.stationary_threshold
                           and self.stationary_frames[self._stationary_key(obs, a["id"])] >= self.limits.stationary_min_frames
                           and not (a["id"] == "wait" and not a.get("keys") and obs.get("facts", {}).get("noninteractive_wait_safe") is True)]
                if len(stalled) == len(options):
                    chosen, stop = self._escalate(context, options, "all_actions_stationary")
                    if stop:
                        reason = stop
                        policy_s += time.monotonic() - t
                        break
                else:
                    candidates = [a for a in options if a not in stalled]
                    callback = obs.get("facts", {}).get("source_callback2")
                    safe_wait = (obs.get("facts", {}).get("noninteractive_wait_safe") is True and
                                 callback == self.safe_wait_callback)
                    continuation = next((a for a in candidates if a["id"] == self.continue_action_id or
                                         (safe_wait and a["id"] == "wait" and not a.get("keys"))), None)
                    if continuation is not None:
                        result = {"accepted": True, "action_id": continuation["id"],
                                  "record": {"policy": "continue_model_wait" if safe_wait else "continue_adapter_target",
                                             "basis": "source_proven_noninteractive_callback_unchanged" if safe_wait else "structured_progress_advanced"}}
                    elif len(candidates) == 1:
                        result = {"accepted": True, "action_id": candidates[0]["id"],
                                  "record": {"policy": "single_available_action"}}
                    elif self.policy.requires_model and self.limits.max_model_calls is not None and self.decisions+self.escalations >= self.limits.max_model_calls:
                        reason = "model_call_limit"
                        break
                    elif self.policy.requires_model and self.decisions >= self.limits.max_decisions:
                        reason = "decision_limit"
                        break
                    else:
                        if self.policy.requires_model:
                            self.decisions += 1
                        model_started = time.monotonic()
                        result = self.policy.choose(context, candidates, self._timeout())
                        if self.policy.requires_model:
                            self.model_wall_s['system1'] += time.monotonic() - model_started
                    self._event({"event": "decision", "step": self.steps, "result": result})
                    if result.get("awareness"):
                        self.awareness = result["awareness"]
                    chosen = result.get("action_id")
                    if chosen == "STOP":
                        reason = "policy_stop"
                        policy_s += time.monotonic() - t
                        break
                    if not result.get("accepted") or chosen not in {a["id"] for a in candidates}:
                        chosen, stop = self._escalate(context, candidates, result.get("reason", "uncertain_decision"))
                        if stop:
                            reason = stop
                            policy_s += time.monotonic() - t
                            break
                policy_s += time.monotonic() - t
                if time.monotonic() >= self.deadline:
                    reason = "wall_time_limit"
                    break
                action = next(a for a in options if a["id"] == chosen)
                if action.get("target") and (self.active_target is None or self.active_target["action_id"] != chosen):
                    self.active_target = {"action_id": chosen, "target": action["target"], "selected_at_step": self.steps,
                                          "status": "pursuing", "objective": context["objective"]}
                    self._event({"event": "target_selected", **self.active_target})
                elif self.active_target is not None and self.active_target["action_id"] != chosen:
                    self._event({"event": "target_replanned", "previous_target": self.active_target, "next_action_id": chosen})
                    self.active_target = None
                t = time.monotonic()
                receipt = self.adapter.act(action, max_frames=min(self.limits.max_frames - self.frames, cap + meta.get("max_integration_frames", 0)))
                action_s += time.monotonic() - t
                spent = receipt.get("frames")
                integration = receipt.get("integration_frames", 0)
                require(type(integration) is int and 0 <= integration <= meta.get("max_integration_frames", 0), "invalid_integration_receipt")
                require(type(spent) is int and 0 < spent <= action["frames"] + integration
                        and spent <= self.limits.max_frames - self.frames, "invalid_action_receipt")
                self.frames += spent
                self.steps += 1
                self._event({"event": "action_receipt", "step": self.steps, "action": action, "receipt": receipt})
                t = time.monotonic()
                after = observation_checked(self.adapter.observe())
                observe_s += time.monotonic() - t
                require(after["frame"] - obs["frame"] == spent, "frame_accounting_mismatch")
                self._record_transition(obs, action, after)
                self.safe_wait_callback = (after.get("facts", {}).get("source_callback2")
                    if chosen == "wait" and not action.get("keys") and
                       after.get("facts", {}).get("noninteractive_wait_safe") is True and
                       obs.get("facts", {}).get("source_callback2") == after.get("facts", {}).get("source_callback2")
                    else None)
                self.continue_action_id = chosen if (action.get("continue_until_target") is True
                    and bool(obs.get("progress")) and bool(after.get("progress")) and obs["progress"] != after["progress"]
                    and obs.get("phase") == after.get("phase") and not after.get("requires_decision", False)) else None
                self._event({"event": "observation", "step": self.steps, "observation": after})
                obs = after
        except KeyboardInterrupt:
            outcome, reason = "cancelled", "cancelled"
        except PlaytestError as e:
            outcome, reason = "failed", str(e)
        except Exception:
            outcome, reason = "failed", "adapter_or_policy_error"
        finally:
            try:
                self.adapter.close()
            except Exception:
                self._event({"event": "cleanup_failed", "reason": "adapter_cleanup_error"})
                outcome = "failed"
                reason = "adapter_cleanup_error"
        elapsed = time.monotonic() - started
        report = {"schema_version": 1, "run_id": self.run_id, "started_utc": started_utc,
                  "status": outcome, "reason": reason, "adapter": meta, "loop_version": VERSION,
                  "profile_sha256": digest(self.profile), "limits": asdict(self.limits),
                  "awareness": self.awareness, "source": source_context(), "steps": self.steps,
                  "active_target": self.active_target,
                  "frames": self.frames, "decision_calls": self.decisions, "system2_calls": self.escalations,
                  "states_observed": len(self.states), "transitions": self.transitions,
                  "barrier_candidates": self.barriers,
                  "timing": {"total_wall_s": round(elapsed, 6), "observation_wall_s": round(observe_s, 6),
                             "action_wall_s": round(action_s, 6), "model_wall_s": self.model_wall_s,
                             "frames_per_action": self.frames/self.steps if self.steps else None,
                             "frames_per_model_call": self.frames/(self.decisions+self.escalations) if self.decisions+self.escalations else None, "policy_wall_s": round(policy_s, 6),
                             "deadline_overshoot_s": round(max(0., elapsed - self.limits.max_seconds), 6),
                             "queue_s": None, "build_s": None},
                  "timing_note": "Stages are nested in total; policy includes model/network/queue. Deadline checked between operations; socket/adapter timeouts bound individual operations.",
                  "evidence_note": "Observed transitions and provisional barriers, not proof of game rules. No-change may mean animation, wrong input timing, cooldown, collision or a prerequisite. Model confidence is uncalibrated."}
        if self.output:
            report["events_sha256"] = hashlib.sha256((self.output / "events.jsonl").read_bytes()).hexdigest() if (self.output / "events.jsonl").is_file() else None
            (self.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        return report

    def _record_transition(self, before, action, after):
        pair = before["state_key"], action["id"]
        stationary_key = self._stationary_key(before, action["id"])
        self.attempts[pair] += 1
        self.states[after["state_key"]] += 1
        # Ignore camera pixels and animation when a structured progress channel is available.
        partial = self.awareness.get("progress_evidence_scope") == "partial"
        structured = bool(before.get("progress")) and bool(after.get("progress")) and not partial
        unchanged = (before["progress"] == after["progress"]) if structured else (before.get("progress") == after.get("progress") and before["state_key"] == after["state_key"]) if partial else before["state_key"] == after["state_key"]
        previous_stationary_frames = self.stationary_frames[stationary_key]
        self.stationary[stationary_key] = self.stationary[stationary_key] + 1 if unchanged else 0
        self.stationary_frames[stationary_key] = self.stationary_frames[stationary_key] + after["frame"] - before["frame"] if unchanged else 0
        transition = {"from": before["state_key"], "action_id": action["id"], "to": after["state_key"],
                      "frame_before": before["frame"], "frame_after": after["frame"], "unchanged": unchanged,
                      "stationary_key": list(stationary_key),
                      "progress_basis": "adapter_structured" if structured else "partial_structured_plus_visual" if partial else "state_key_only",
                      "before_evidence_sha256": digest(before), "after_evidence_sha256": digest(after),
                      "target": action.get("target"),
                      "before_progress": before.get("progress", {}), "after_progress": after.get("progress", {})}
        self.transitions.append(transition)
        self._event({"event": "transition", "step": self.steps, **transition})
        if (self.stationary[stationary_key] >= self.limits.stationary_threshold and
                self.stationary_frames[stationary_key] >= self.limits.stationary_min_frames and
                (self.stationary[stationary_key] == self.limits.stationary_threshold or
                 previous_stationary_frames < self.limits.stationary_min_frames)):
            barrier = {"status": "candidate", "state_key": before["state_key"], "action_id": action["id"],
                       "attempts_without_progress": self.stationary[stationary_key], "step": self.steps,
                       "basis": transition["progress_basis"],
                       "evidence": [t for t in self.transitions if t["stationary_key"] == list(stationary_key) and t["unchanged"]][-self.limits.stationary_threshold:],
                       "unknowns": ["collision vs prerequisite vs wrong timing", "whether a different action succeeds"]}
            self.barriers.append(barrier)
            self._event({"event": "barrier_candidate", **barrier})


def source_context():
    root = Path(__file__).resolve().parents[2]
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, stderr=subprocess.DEVNULL,
                                         timeout=2, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        commit = None
    return {"commit": commit, "package_sha256": digest({p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                                     for p in Path(__file__).parent.glob("*.py")}),
            "python": platform.python_version(), "machine": platform.platform()}
