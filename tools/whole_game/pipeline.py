"""Optional whole-source composition handoff; no game code or policy is generated here.

Pins full source-engine build receipts and validates every artifact before a native
adapter can consume the bundle. A bundle is a candidate, never qualification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import os
import platform
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
FORMAT = "whole-source-composition/1"
COMPOSITION_ID = "emerald-firered"
GAME_ID = "pokemon-emerald-firered-whole-source"
ADAPTER = {"id": "whole-game-native-composition", "version": "1"}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def local_file(ref, root=ROOT):
    path = (root / ref).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("artifact_outside_workspace_or_missing")
    return path


def pin(path, root=ROOT):
    path = local_file(str(path), root)
    return {"path": str(path.relative_to(root.resolve())), "sha256": digest(path)}


def check_pin(record, root=ROOT):
    if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
        raise ValueError("invalid_artifact_pin")
    path = local_file(record["path"], root)
    if record["sha256"] != digest(path):
        raise ValueError("artifact_hash_mismatch")
    return path


def source_entry(receipt_path, root=ROOT):
    receipt_path = local_file(str(receipt_path), root)
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("schema") != "whole-source-build/1":
        raise ValueError("unsupported_source_build_receipt")
    if receipt.get("status") != "passed":
        raise ValueError("source_build_not_successful")
    if receipt.get("build", {}).get("outcome") != "passed":
        raise ValueError("source_compile_not_successful")
    entry = {"id": receipt["game"], "commit": receipt["sourceCommit"],
             "treeHash": receipt["sourceTreeHash"],
             "snapshotSha256": receipt["sourceSnapshotSha256"],
             "patchSha256": receipt.get("patchSha256"),
             "sourceBridgeSha256": receipt.get("sourceBridgeSha256"),
             "buildReceipt": pin(receipt_path, root)}
    for kind in ("rom", "elf"):
        record = receipt["artifacts"][kind]
        # Builder artifact paths are workspace-relative or absolute, never cwd-relative.
        entry[kind] = {"path": record["path"], "sha256": record["sha256"]}
        check_pin(entry[kind], root)
    return entry


def verify_manifest(manifest, root=ROOT):
    if manifest.get("format") != FORMAT or manifest.get("compositionId") != COMPOSITION_ID:
        raise ValueError("unsupported_composition")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or {s.get("id") for s in sources} != {"emerald", "firered"} or len(sources) != 2:
        raise ValueError("composition_requires_both_full_source_engines")
    for source in sources:
        receipt_path = check_pin(source["buildReceipt"], root)
        if source_entry(receipt_path, root) != source:
            raise ValueError("source_receipt_identity_mismatch")
        if not source["commit"] or not source["treeHash"] or not source["snapshotSha256"]:
            raise ValueError("missing_source_identity")
    bridge = manifest.get("bridge", {})
    if bridge.get("schemaVersion") != 1:
        raise ValueError("unsupported_bridge_schema")
    bridge_contract = json.loads(check_pin(bridge["manifest"], root).read_text())
    expected_abi = {"schemaVersion": 1, "mailboxSymbol": "gWholeGameBridge", "mailboxBytes": 648,
                    "sharedStateSchema": 1, "transitionSchema": 1}
    if any(bridge_contract.get(k) != v for k, v in expected_abi.items()):
        raise ValueError("unsupported_source_bridge_abi")
    bridge_hash = bridge_contract.get("sourceBridgeSha256")
    if not isinstance(bridge_hash, str) or len(bridge_hash) != 64:
        raise ValueError("missing_source_bridge_digest")
    if any(source.get("sourceBridgeSha256") != bridge_hash for source in sources):
        raise ValueError("source_bridge_build_mismatch")
    if manifest.get("stateCompatibility") != "exact-artifact-bundle-hash":
        raise ValueError("unsupported_state_compatibility")
    adapter = manifest.get("adapter", {})
    if not isinstance(adapter.get("id"), str) or not adapter.get("version"):
        raise ValueError("missing_adapter_identity")
    capabilities = manifest.get("capabilities")
    if not isinstance(capabilities, dict) or any(type(v) is not bool for v in capabilities.values()):
        raise ValueError("invalid_capability_declaration")
    expected = identity({k: v for k, v in manifest.items() if k != "bundleSha256"})
    if manifest.get("bundleSha256") != expected:
        raise ValueError("bundle_identity_mismatch")
    return manifest


def compose(receipts, bridge, *, adapter_id, adapter_version, capabilities, root=ROOT):
    manifest = {"format": FORMAT, "compositionId": COMPOSITION_ID,
                "sources": sorted((source_entry(path, root) for path in receipts), key=lambda x: x["id"]),
                "bridge": {"schemaVersion": 1, "manifest": pin(bridge, root)},
                "adapter": {"id": adapter_id, "version": adapter_version},
                "stateCompatibility": "exact-artifact-bundle-hash", "capabilities": capabilities}
    manifest["bundleSha256"] = identity(manifest)
    verify_manifest(manifest, root)
    # Keep prior candidate versions runnable when the editable source ABI evolves.
    # A source-tree filename is not an immutable dependency reference.
    original = check_pin(manifest["bridge"]["manifest"], root)
    snapshot = root / "local/whole-game-mashup/emerald-firered/bridge-manifests" / (digest(original) + ".json")
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    try:
        with snapshot.open("xb") as stream:
            stream.write(original.read_bytes())
    except FileExistsError:
        pass
    if digest(snapshot) != manifest["bridge"]["manifest"]["sha256"]:
        raise ValueError("immutable_bridge_snapshot_mismatch")
    manifest["bridge"]["manifest"] = pin(snapshot, root)
    manifest["bundleSha256"] = identity({k: v for k, v in manifest.items() if k != "bundleSha256"})
    return verify_manifest(manifest, root)


def save(path, record):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(record, indent=2) + "\n")
    temporary.replace(path)


def run_stage(report, report_path, name, command, output, timeout):
    """Trusted argv only; retain failed/cancelled stages and bound descendants."""
    stage = {"name": name, "startedAt": datetime.now(timezone.utc).isoformat(),
             "outcome": "running", "wallS": None, "exitCode": None,
             "log": str(output), "timeoutS": timeout}
    report["stages"].append(stage)
    save(report_path, report)
    start = time.monotonic()
    process = None
    try:
        with output.open("xb") as stream:
            process = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                stage["outcome"] = "cancelled" if isinstance(error, KeyboardInterrupt) else "timeout"
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise
        stage["exitCode"] = code
        stage["outcome"] = "passed" if code == 0 else "failed"
        return code
    except BaseException:
        if stage["outcome"] == "running":
            stage["outcome"] = "failed"
        raise
    finally:
        stage["wallS"] = round(time.monotonic() - start, 6)
        save(report_path, report)


def build_pair(output, *, patches=None, source_bridge_sha256=None, jobs=2, timeout=300):
    """Optional local recipe invocation; never accepts command strings from data."""
    if type(jobs) is not int or not 1 <= jobs <= 16 or not 1 <= timeout <= 1800:
        raise ValueError("invalid_build_limits")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    patches = patches or {}
    report = {"format": "whole-source-pipeline-run/1", "runId": str(uuid.uuid4()),
              "compositionId": COMPOSITION_ID, "status": "running", "stages": [],
              "startedAt": datetime.now(timezone.utc).isoformat(),
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "pipelineSha256": digest(Path(__file__)),
              "builderSha256": digest(ROOT / "tools/whole_game/build_sources.py"),
              "environment": {"platform": platform.platform(), "python": platform.python_version()},
              "limits": {"jobs": jobs, "perBuildTimeoutS": timeout},
              "timing": {"queueS": None, "totalS": None, "buildS": None,
                         "simulationS": None, "evaluationS": None},
              "timingNote": "Stage wall times include builder setup; buildS uses nested compiler durations only.",
              "receipts": []}
    report_path = output / "run.json"
    started = time.monotonic()
    save(report_path, report)
    try:
        for game in ("emerald", "firered"):
            argv = [sys.executable, str(ROOT / "tools/whole_game/build_sources.py"),
                    "--game", game, "--jobs", str(jobs), "--timeout", str(timeout)]
            if game in patches:
                path = check_pin(patches[game])
                argv += ["--patch", str(path), "--patch-sha256", patches[game]["sha256"]]
            if source_bridge_sha256:
                argv += ["--source-bridge", "--source-bridge-sha256", source_bridge_sha256]
            log = output / (game + ".log")
            code = run_stage(report, report_path, game + "-source-build", argv, log, timeout + 30)
            # The registered builder emits the durable receipt path as its final stdout line,
            # including failures; never infer build success from its process exit alone.
            lines = log.read_text().splitlines()
            receipt_path = local_file(lines[-1]) if lines else None
            if receipt_path:
                report["receipts"].append(pin(receipt_path))
            if code != 0:
                raise ValueError("source_builder_failed")
            source_entry(receipt_path)
        report["status"] = "built_unqualified"
        return report
    except KeyboardInterrupt:
        report["status"] = "cancelled"
        raise
    except Exception:
        report["status"] = "failed"
        raise
    finally:
        report["timing"]["totalS"] = round(time.monotonic() - started, 6)
        durations = [json.loads(check_pin(p).read_text()).get("build", {}).get("wallMs") for p in report["receipts"]]
        report["timing"]["buildS"] = sum(durations) / 1000 if durations and all(v is not None for v in durations) else None
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        save(report_path, report)


def resume_inputs(manifest, profile, checkpoint, learning, *, from_profile=None, root=ROOT):
    """Preflight portable paired native state and retained model learning, without loading either."""
    if (checkpoint is None) != (learning is None):
        raise ValueError("resume_requires_checkpoint_and_learning")
    if checkpoint is None:
        if from_profile is not None:
            raise ValueError("profile_migration_requires_resume")
        return None
    from tools.playtester.core import digest as profile_digest
    folder = (root / checkpoint).resolve()
    metadata = local_file(str(folder / "state.json"), root)
    state = json.loads(metadata.read_text())
    if state.get("format") != "whole-game-session-state/1" or state.get("bundleSha256") != manifest["bundleSha256"]:
        raise ValueError("resume_checkpoint_bundle_mismatch")
    if set(state.get("files", {})) != {"emerald", "firered"}:
        raise ValueError("resume_requires_paired_native_state")
    files = {}
    for region in ("emerald", "firered"):
        path = local_file(str(folder / (region + ".ss")), root)
        record = state["files"][region]
        if digest(path) != record.get("sha256") or path.stat().st_size != record.get("bytes"):
            raise ValueError("resume_native_state_corrupt")
        files[region] = pin(path, root)
    if "observation" in state:
        image = local_file(str(folder / "observation.png"), root)
        if digest(image) != state.get("observationSha256"):
            raise ValueError("resume_observation_corrupt")
        files["observation"] = pin(image, root)
    runtime = state.get("runtimeIdentity", {})
    if runtime.get("adapterVersion") != "whole-game-native-composition/1" or not runtime.get("sessionSourceSha256"):
        raise ValueError("resume_missing_native_runtime_identity")
    if runtime["sessionSourceSha256"] != digest(root / "tools/whole_game/session.py"):
        raise ValueError("resume_native_session_version_mismatch")
    binary_hash = digest(root / "tools/re/session/build/gba-session")
    if set(runtime.get("engines", {})) != {"emerald", "firered"} or any(
            entry.get("nativeBinarySha256") != binary_hash or not entry.get("emulator")
            for entry in runtime["engines"].values()):
        raise ValueError("resume_native_binary_version_mismatch")
    learning_path = local_file(str(learning), root)
    context = json.loads(learning_path.read_text())
    prior_profile = profile
    migration = None
    if from_profile is not None:
        prior_path = local_file(str(from_profile), root)
        prior_profile = json.loads(prior_path.read_text())
        if prior_profile.get("game_id") != profile.get("game_id") or prior_profile.get("game_version") != manifest["bundleSha256"]:
            raise ValueError("resume_profile_migration_game_mismatch")
        if prior_profile.get("objective") != profile.get("objective"):
            raise ValueError("resume_profile_migration_objective_changed")
        migration = {"fromProfile": pin(prior_path, root), "fromProfileSha256": profile_digest(prior_profile),
                     "toProfileSha256": profile_digest(profile), "policy": "explicit-same-artifact-profile-migration"}
    if context.get("game_version") != manifest["bundleSha256"] or context.get("profile_sha256") != profile_digest(prior_profile):
        raise ValueError("resume_learning_identity_mismatch")
    return {"checkpoint": pin(metadata, root), "files": files,
            "learning": pin(learning_path, root), "parentFrame": state.get("frame"),
            "runtimeIdentity": runtime, "profileMigration": migration}


def playtest(manifest_path, profile_path, loop_path, output, *, sid_env_file=None,
             resume_checkpoint=None, resume_learning=None, resume_from_profile=None):
    """Dispatch the existing model/controller stack against the registered native adapter."""
    manifest_path, profile_path, loop_path = (local_file(str(p)) for p in (manifest_path, profile_path, loop_path))
    manifest = verify_manifest(json.loads(manifest_path.read_text()))
    if manifest["adapter"] != ADAPTER:
        raise ValueError("unregistered_composition_adapter")
    loop = json.loads(loop_path.read_text())
    allowed = {"schema", "policy", "system2", "limits", "fullScenario"}
    if not {"schema", "policy", "system2", "limits"} <= set(loop) <= allowed or loop["schema"] != "whole-source-playtest-loop/1":
        raise ValueError("unsupported_loop_config")
    if loop["policy"] != "d1" or loop["system2"] != "chat":
        raise ValueError("whole_source_test_requires_explicit_model_policy")
    limit_options = {"max_steps": "--max-steps", "max_frames": "--max-frames",
                     "max_seconds": "--max-seconds", "max_decisions": "--max-decisions",
                     "max_escalations": "--max-escalations", "max_action_frames": "--max-action-frames",
                     "model_timeout": "--model-timeout", "adapter_timeout": "--adapter-timeout"}
    limits = loop["limits"]
    if set(limits) != set(limit_options) or any(type(v) not in (int, float) or not 0 < v <= 100000 for v in limits.values()):
        raise ValueError("invalid_explicit_loop_limits")
    for key in ("max_steps", "max_frames", "max_decisions", "max_escalations", "max_action_frames"):
        if type(limits[key]) is not int:
            raise ValueError("integer_loop_limit_required")
    if type(loop.get("fullScenario", False)) is not bool:
        raise ValueError("invalid_full_scenario_policy")
    profile = json.loads(profile_path.read_text())
    if profile.get("game_id") != GAME_ID:
        raise ValueError("composition_profile_game_mismatch")
    if profile.get("game_version") not in (None, manifest["bundleSha256"]):
        raise ValueError("composition_profile_version_mismatch")
    profile["game_version"] = manifest["bundleSha256"]
    continuation = resume_inputs(manifest, profile, resume_checkpoint, resume_learning, from_profile=resume_from_profile)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    effective = output / "effective-profile.json"
    effective.write_text(json.dumps(profile, indent=2) + "\n")
    report = {"format": "whole-source-pipeline-run/1", "runId": str(uuid.uuid4()),
              "operation": "model-native-playtest", "compositionId": COMPOSITION_ID,
              "startedAt": datetime.now(timezone.utc).isoformat(), "status": "running", "stages": [],
              "manifest": pin(manifest_path), "bundleSha256": manifest["bundleSha256"],
              "profile": pin(profile_path), "effectiveProfile": pin(effective), "loopConfig": pin(loop_path),
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "pipelineSha256": digest(Path(__file__)),
              "pilotSha256": digest(ROOT / "tools/whole_game/pilot.py"),
              "adapterSha256": digest(ROOT / "tools/whole_game/adapter.py"),
              "environment": {"platform": platform.platform(), "python": platform.python_version()},
              "timing": {"queueS": None, "totalS": None, "buildS": None, "simulationS": None, "evaluationS": None},
              "timingNote": "Pilot wall time includes emulator, model/network and evidence. Nested stages must not be added to total."}
    report["continuation"] = continuation
    report_path = output / "run.json"
    save(report_path, report)
    argv = [sys.executable, "-m", "tools.whole_game.pilot", "--profile", str(effective),
            "--output", str(output / "playtest"), "--policy", loop["policy"], "--system2", loop["system2"]]
    for key, flag in limit_options.items():
        argv += [flag, str(limits[key])]
    if loop.get("fullScenario"):
        argv += ["--full-scenario"]
    if sid_env_file is not None:
        argv += ["--sid-env-file", str(sid_env_file)]
    if continuation:
        argv += ["--resume-context", str(check_pin(continuation["learning"]))]
        if continuation["profileMigration"]:
            argv += ["--resume-from-profile", str(check_pin(continuation["profileMigration"]["fromProfile"]))]
    argv += ["--adapter-command", sys.executable, "-m", "tools.whole_game.adapter",
             "--manifest", str(manifest_path), "--out", str(output / "session")]
    if continuation:
        argv += ["--resume-checkpoint", str(check_pin(continuation["checkpoint"]).parent)]
    start = time.monotonic()
    try:
        code = run_stage(report, report_path, "native-model-pilot", argv, output / "pilot.log",
                         limits["max_seconds"] + limits["model_timeout"] + limits["adapter_timeout"] + 15)
        result_path = output / "playtest/report.json"
        if not result_path.exists():
            raise ValueError("pilot_did_not_retain_result")
        result = json.loads(result_path.read_text())
        report["playtestReport"] = pin(result_path)
        report["status"] = result.get("status", "failed")
        report["reason"] = result.get("reason")
        report["pilotExitCode"] = code
        pilot_path = output / "playtest/pilot.json"
        if not pilot_path.exists():
            raise ValueError("pilot_did_not_retain_checkpoint_result")
        pilot = json.loads(pilot_path.read_text())
        report["pilotReport"] = pin(pilot_path)
        report["scenarioOutcome"] = pilot.get("scenario_outcome")
        report["checkpointReplayOutcome"] = pilot.get("replay", {}).get("status")
        if code != 0 or report["checkpointReplayOutcome"] == "mismatch":
            report["status"] = "failed"
            report["reason"] = "pilot_failed_or_checkpoint_replay_mismatch"
        report["timing"]["simulationS"] = result.get("timing", {}).get("total_wall_s")
        if result.get("adapter", {}).get("game_version") != manifest["bundleSha256"]:
            raise ValueError("pilot_artifact_version_mismatch")
        return report
    except KeyboardInterrupt:
        report["status"] = "cancelled"
        raise
    except Exception as error:
        report["status"] = "failed"
        report["reason"] = str(error)
        raise
    finally:
        report["timing"]["totalS"] = round(time.monotonic() - start, 6)
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        save(report_path, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("manifest", type=Path)
    create = sub.add_parser("compose")
    create.add_argument("--receipt", type=Path, action="append", required=True)
    create.add_argument("--bridge", type=Path, required=True)
    create.add_argument("--adapter-id", required=True)
    create.add_argument("--adapter-version", required=True)
    create.add_argument("--output", type=Path, required=True)
    build = sub.add_parser("build")
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--jobs", type=int, default=2)
    build.add_argument("--timeout", type=int, default=300)
    build.add_argument("--source-bridge-sha256")
    for game in ("emerald", "firered"):
        build.add_argument("--" + game + "-patch", type=Path)
        build.add_argument("--" + game + "-patch-sha256")
    play = sub.add_parser("playtest")
    play.add_argument("--manifest", type=Path, required=True)
    play.add_argument("--profile", type=Path, required=True)
    play.add_argument("--loop-config", type=Path, required=True)
    play.add_argument("--output", type=Path, required=True)
    play.add_argument("--sid-env-file", type=Path)
    play.add_argument("--resume-checkpoint", type=Path)
    play.add_argument("--resume-learning", "--resume-context", dest="resume_learning", type=Path)
    play.add_argument("--resume-from-profile", type=Path)
    args = parser.parse_args()
    if args.operation == "playtest":
        report = playtest(args.manifest, args.profile, args.loop_config, args.output, sid_env_file=args.sid_env_file,
                          resume_checkpoint=args.resume_checkpoint, resume_learning=args.resume_learning,
                          resume_from_profile=args.resume_from_profile)
        print(json.dumps({"status": report["status"], "reason": report.get("reason"), "runId": report["runId"]}))
        if report["status"] == "failed":
            raise SystemExit(2)
        return
    if args.operation == "build":
        patches = {}
        for game in ("emerald", "firered"):
            path, sha = getattr(args, game + "_patch"), getattr(args, game + "_patch_sha256")
            if bool(path) != bool(sha):
                raise ValueError("patch_requires_explicit_sha256")
            if path:
                patches[game] = {"path": str(path), "sha256": sha}
        report = build_pair(args.output, patches=patches, source_bridge_sha256=args.source_bridge_sha256,
                            jobs=args.jobs, timeout=args.timeout)
        print(json.dumps({"status": report["status"], "receipts": report["receipts"]}))
        return
    if args.operation == "verify":
        manifest = verify_manifest(json.loads(args.manifest.read_text()))
    else:
        manifest = compose(args.receipt, args.bridge, adapter_id=args.adapter_id,
                           adapter_version=args.adapter_version, capabilities={})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x") as stream:
            stream.write(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "artifact_pins_verified", "bundleSha256": manifest["bundleSha256"],
                      "qualification": "unqualified candidate; native integration/play evidence required"}))


if __name__ == "__main__":
    main()
