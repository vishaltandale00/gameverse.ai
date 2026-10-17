"""Public, authored grid engine demonstration; no original-game material or models."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

from tools.playtester.adapters import GridAdapter
from tools.playtester.core import FrontierPolicy, Limits, Playtester

ROOT = Path(__file__).resolve().parents[2]
LIMITS = {"max_actions": 32, "max_wall_s": 5, "max_repairs": 0}
DEPENDENCIES = (
    "tools/prompts/__init__.py",
    "tools/prefab_pipeline/reference_fixture.py", "tools/prefab_pipeline/__init__.py",
    "tools/playtester/__init__.py", "tools/playtester/adapters.py", "tools/playtester/core.py",
    "tools/playtester/examples/key-door.json",
)


def _pin(path):
    path = Path(path)
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _save(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n")


def run_reference_fixture(request: dict, output_dir: Path) -> dict:
    """Exercise the existing offline engine, then reconstruct an action-log checkpoint.

    Only the registered authored fixture is accepted. The optional limits must
    equal the fixed public bounds; callers cannot inject paths, actions or code.
    GridAdapter has observe/act, not native checkpoint/restore or repair hooks.
    """
    allowed = {"schema", "request_id", "fixture_id", "operation", "limits"}
    if (not isinstance(request, dict) or set(request) - allowed
            or request.get("schema") != "gameverse.reference-fixture-request/1"
            or request.get("fixture_id") != "reference-key-door"
            or request.get("operation") != "engine-demonstration"
            or not isinstance(request.get("request_id"), str)
            or not 1 <= len(request["request_id"]) <= 128
            or request.get("limits", LIMITS) != LIMITS):
        raise ValueError("unsupported_reference_fixture_request")
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {"schema": "gameverse.reference-fixture-result/1", "request_id": request["request_id"],
              "fixture_id": "reference-key-door", "operation": "engine-demonstration", "status": "failed",
              "artifact_kind": "authored-grid-reference", "game_material_required": False,
              "gba_generation": False, "model_calls": 0, "repairs": 0, "limits": dict(LIMITS),
              "repair_scope": "No automated repair dispatcher used; existing offline FrontierPolicy drives the registered fixture.",
              "checkpoint_scope": "Action-log reconstruction in a fresh isolated GridAdapter; not adapter snapshot/restore support.",
              "stages": [], "actions": [], "queue_s": None, "build_s": None,
              "sourcepins": [{"path": name, "sha256": _pin(ROOT / name)["sha256"]} for name in DEPENDENCIES]}
    replay = None
    try:
        game = json.loads((ROOT / DEPENDENCIES[-1]).read_text())
        _save(output / "request.json", request)
        _save(output / "game.json", game)
        report["artifact"] = _pin(output / "game.json")
        stage_started = time.monotonic()
        profile = {"schema_version": 1, "game_id": game["game_id"], "objective": "Find key, open door, reach goal",
                   "awareness": {"perspective": "top_down", "locomotion": "grid"}}
        engine = Playtester(GridAdapter(game), profile, FrontierPolicy(),
            limits=Limits(max_steps=LIMITS["max_actions"] // 2, max_frames=LIMITS["max_actions"] // 2,
                          max_seconds=LIMITS["max_wall_s"], max_decisions=0, max_escalations=0,
                          max_model_calls=0, max_system2_repairs=0, max_action_frames=1), output=output / "engine")
        result = engine.run()
        report["stages"].append({"name": "existing-engine-observe-act", "status": result["status"],
                                 "wall_s": time.monotonic() - stage_started})
        report["engine_report"] = _pin(output / "engine/report.json")
        report["engine_events"] = _pin(output / "engine/events.jsonl")
        report["source_context"] = result["source"]
        transitions = result["transitions"]
        report["actions"] = [{"phase": "engine", "action_id": row["action_id"],
                              "before": row["before_progress"], "after": row["after_progress"]} for row in transitions]
        if result["status"] != "success" or not transitions:
            raise ValueError("existing_engine_did_not_reach_goal")
        index = next(i for i, row in enumerate(transitions) if "brass-key" in row["after_progress"]["inventory"])
        checkpoint = {"schema": "gameverse.reference-action-log-checkpoint/1", "kind": "action-log-replay",
                      "game_version": result["adapter"]["game_version"], "adapter_version": result["adapter"]["adapter_version"],
                      "actions": [row["action_id"] for row in transitions[:index + 1]],
                      "expected_progress": transitions[index]["after_progress"], "expected_state_key": transitions[index]["to"]}
        _save(output / "checkpoint.json", checkpoint)
        report["checkpoint"] = _pin(output / "checkpoint.json")
        stage_started = time.monotonic()
        replay = GridAdapter(game)
        if replay.hello()["game_version"] != checkpoint["game_version"]:
            raise ValueError("checkpoint_game_identity_mismatch")
        checkpoint_matched = False
        for i, row in enumerate(transitions):
            if len(report["actions"]) >= LIMITS["max_actions"] or time.monotonic() - started >= LIMITS["max_wall_s"]:
                raise ValueError("reference_fixture_budget_exhausted")
            before = replay.observe()
            action = next((a for a in before["options"] if a["id"] == row["action_id"]), None)
            if action is None:
                raise ValueError("replay_action_not_available")
            replay.act(action, max_frames=1)
            after = replay.observe()
            report["actions"].append({"phase": "replay", "action_id": action["id"],
                                      "before": before["progress"], "after": after["progress"]})
            if i == index:
                checkpoint_matched = after["progress"] == checkpoint["expected_progress"] and after["state_key"] == checkpoint["expected_state_key"]
            if after["progress"] != row["after_progress"]:
                raise ValueError("replay_transition_differed")
        final = replay.observe()
        _save(output / "replay.json", {"checkpoint_matched": checkpoint_matched, "final_observation": final,
                                      "fresh_session": replay.session_id != result["adapter"]["session_id"]})
        report["stages"].append({"name": "action-log-checkpoint-replay", "status": "passed" if checkpoint_matched and final["success"] else "failed",
                                 "wall_s": time.monotonic() - stage_started})
        report["replay"] = _pin(output / "replay.json")
        report["tests"] = {"key_collected": "brass-key" in final["facts"]["inventory"],
                           "door_opened": "east-door" in final["facts"]["opened_doors"],
                           "goal_reached": final["success"], "checkpoint_reconstructed": checkpoint_matched,
                           "transition_replay_equal": True, "independent_session": replay.session_id != result["adapter"]["session_id"]}
        report["status"] = "passed" if all(report["tests"].values()) else "failed"
        report["outcome"] = "existing authored grid engine traversed and checkpoint replay matched"
    except (ValueError, KeyError, OSError) as error:
        report["outcome"] = str(error)
    finally:
        if replay is not None:
            replay.close()
        report["action_count"] = len(report["actions"])
        report["total_wall_s"] = time.monotonic() - started
        report["timing_note"] = "Stages nested within total; engine observation/action/policy times retained in engine/report.json. Queue/build unavailable; no providers invoked."
        _save(output / "result.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New isolated output directory")
    args = parser.parse_args()
    try:
        result = run_reference_fixture(json.loads(args.request.read_text()), args.output)
    except (ValueError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}))
        return 2
    print(json.dumps({"status": result["status"], "result": str(args.output.resolve() / "result.json")}))
    return 0 if result["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
