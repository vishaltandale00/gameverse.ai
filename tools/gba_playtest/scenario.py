"""Replay semantic acceptance scenarios from private native save states.

Uses the existing persistent mGBA worker. No browser, model call or new runtime.
One scenario proves only its declared feature; suite success requires every
declared feature to have an executing, passing scenario.
"""
import argparse
import copy
import hashlib
import json
import operator
from pathlib import Path
import subprocess
import time

from tools.re.session.bridge import NativeSession, VERSION as ADAPTER_VERSION

ROOT = Path(__file__).resolve().parents[2]
VERSION = "native-semantic-scenario/1"
OPS = {"eq": operator.eq, "ne": operator.ne, "lt": operator.lt,
       "lte": operator.le, "gt": operator.gt, "gte": operator.ge}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def field(facts, path):
    value = facts
    for key in path.split("."):
        value = value[int(key)] if isinstance(value, list) else value[key]
    if type(value) not in (int, bool, str):
        raise ValueError("Expectation must address a scalar observed field: " + path)
    return value


def run(scenario_path, rom, out, expected_rom_sha256, *, state=None, memory_profile=None, wall_limit=None):
    scenario_path, rom, out = map(lambda p: Path(p).resolve(), (scenario_path, rom, out))
    spec = json.loads(scenario_path.read_text())
    if sha(rom) != expected_rom_sha256 or spec.get("rom_sha256", expected_rom_sha256) != expected_rom_sha256:
        raise ValueError("Exact candidate ROM identity required")
    limits = spec.get("limits", {})
    max_frames, max_wall = limits.get("frames", 20000), limits.get("wall_s", 120)
    if wall_limit is not None:
        max_wall = min(max_wall, wall_limit)
    steps = spec.get("steps", [])
    if (type(max_frames) is not int or not 1 <= max_frames <= 100000 or
            not 0 < max_wall <= 300 or not 1 <= len(steps) <= 512 or
            not any("expect" in step for step in steps) or not spec.get("feature")):
        raise ValueError("A named feature, semantic expectations and finite limits are required")
    initial = spec.get("initial_state")
    if not state and initial:
        state = (scenario_path.parent / initial["path"]).resolve()
    if state and initial and sha(state) != initial["sha256"]:
        raise ValueError("Initial-state hash differs from scenario")
    if not memory_profile and spec.get("memory_profile"):
        memory_profile = (scenario_path.parent / spec["memory_profile"]).resolve()
    if not memory_profile:
        raise ValueError("Version-pinned semantic observation profile required")
    profile = Path(memory_profile).resolve()
    started = time.monotonic()
    session = NativeSession(rom, out, ROOT / "tools/re/session/build/gba-session",
                            initial_state=state, memory_profile=profile)
    report = {"version": VERSION, "feature": spec["feature"], "scenario": str(scenario_path),
              "scenario_sha256": sha(scenario_path), "rom_sha256": expected_rom_sha256,
              "profile_sha256": sha(profile), "adapter_version": ADAPTER_VERSION,
              "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "emulator": session.emulator, "initial_state": session.initial_state,
              "queue_s": None, "limits": {"frames": max_frames, "wall_s": max_wall},
              "steps": [], "observations": [], "success": False, "outcome": "running"}
    marks = {}
    try:
        if spec.get("record", True):
            session.start_recording(2)
        for step in steps:
            if time.monotonic() - started >= max_wall or session.frame > max_frames:
                raise ValueError("Scenario resource limit reached")
            if len(step) != 1:
                raise ValueError("Each step must have one action")
            if "act" in step:
                action = step["act"]
                frames = action["frames"]
                if type(frames) is not int or frames < 1 or session.frame + frames > max_frames:
                    raise ValueError("Action exceeds frame budget")
                while frames:
                    count = min(120, frames)
                    session.act({"keys": action["keys"], "frames": count}, 120)
                    frames -= count
                    if time.monotonic() - started >= max_wall:
                        raise ValueError("Scenario wall limit reached")
                report["steps"].append({"act": action, "frame": session.frame})
            elif "mark" in step:
                marks[step["mark"]] = copy.deepcopy(session.read_facts())
                report["steps"].append({"mark": step["mark"], "facts": marks[step["mark"]], "frame": session.frame})
            elif "expect" in step:
                expectation = step["expect"]
                current = field(session.read_facts(), expectation["field"])
                actual = current
                if "since" in expectation:
                    actual -= field(marks[expectation["since"]], expectation["field"])
                passed = OPS[expectation["op"]](actual, expectation["value"])
                report["steps"].append({"expect": expectation, "actual": actual,
                                        "current": current, "passed": passed, "frame": session.frame})
                if not passed:
                    raise AssertionError("Gameplay expectation failed: " + json.dumps(expectation))
            elif "capture" in step:
                report["observations"].append({"label": step["capture"], **session.observe()})
            else:
                raise ValueError("Unknown scenario step")
        report.update(outcome="passed", success=True)
    except Exception as exc:
        report.update(outcome="failed", error=str(exc))
        try:
            report["observations"].append({"label": "failure", **session.observe()})
        except Exception:
            pass
    finally:
        if session.recording:
            try:
                report["video"] = session.stop_recording()
            except Exception as exc:
                report.update(outcome="failed", success=False, recording_error=str(exc))
        session.close()
        report["wall_s"] = round(time.monotonic() - started, 6)
        report["frames"] = session.frame
        (out / "scenario.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def suite(path, rom, out, expected_rom_sha256):
    path, out = Path(path).resolve(), Path(out).resolve()
    spec = json.loads(path.read_text())
    required, cases = set(spec["required_features"]), spec["scenarios"]
    wall_limit = spec.get("limits", {}).get("wall_s", 180)
    if not required or len(cases) > 64 or not 0 < wall_limit <= 1800:
        raise ValueError("Finite explicit acceptance scope required")
    out.mkdir(parents=True, exist_ok=False)
    report = {"version": VERSION, "rom_sha256": expected_rom_sha256,
              "suite_sha256": sha(path), "success": False, "cases": []}
    started = time.monotonic()
    covered = set()
    for i, ref in enumerate(cases):
        try:
            remaining = wall_limit - (time.monotonic() - started)
            if remaining <= 0:
                raise ValueError("Suite wall limit reached")
            case = run(path.parent / ref, rom, out / ("case-%02d" % i), expected_rom_sha256, wall_limit=remaining)
        except Exception as exc:
            case = {"success": False, "outcome": "failed", "error": str(exc)}
        report["cases"].append(case)
        if case["success"]:
            covered.add(case["feature"])
    report["missing_features"] = sorted(required - covered)
    report["success"] = bool(cases) and not report["missing_features"] and all(c["success"] for c in report["cases"])
    report["wall_s"] = round(time.monotonic() - started, 6)
    (out / "suite.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--scenario", type=Path)
    source.add_argument("--suite", type=Path)
    parser.add_argument("--rom", type=Path, required=True)
    parser.add_argument("--rom-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--initial-state", type=Path)
    parser.add_argument("--memory-profile", type=Path)
    args = parser.parse_args()
    result = (suite(args.suite, args.rom, args.out, args.rom_sha256) if args.suite else
              run(args.scenario, args.rom, args.out, args.rom_sha256,
                  state=args.initial_state, memory_profile=args.memory_profile))
    print(json.dumps({k: result[k] for k in ("success", "wall_s")}, indent=2))
    raise SystemExit(0 if result["success"] else 2)
