"""Standalone source-merge artifact contract. Paired-engine bundles are not accepted.

Verification establishes pinned build/provenance identity, never a completed
campaign or successful playtest. The source merger owns integration closure.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import platform
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

from .pipeline import ROOT, check_pin, digest, identity, local_file, pin, run_stage, save

FORMAT = "whole-source-single-rom/1"
COMPOSITION_ID = "emerald-firered-single-rom"
GAME_ID = "pokemon-firered-emerald-single-rom"
ADAPTER = {"id": "whole-game-single-rom", "version": "1"}
COMMITS = {"emerald": "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881",
           "firered": "037335f4c725d7c9aecdac87066f2002b4bd7e14"}
REQUIRED_STAGES = {"world_assets", "state", "audio", "encounters", "map_runtime", "map_semantics",
                   "opcodes", "scripts", "native_ui", "native_services", "campaign",
                   "battle_modes", "field_movement", "world_services"}


def source_closure(merge, root=ROOT):
    """Required integration lanes and their inventories cannot be replaced by one boolean."""
    stages = merge.get("stages", [])
    declared = merge.get("requiredStageNames", sorted(REQUIRED_STAGES))
    required = set(declared)
    if len(declared) != len(required) or not REQUIRED_STAGES <= required:
        raise ValueError("single_rom_required_source_recipe_incomplete")
    if len(stages) != len(required) or {stage.get("name") for stage in stages} != required:
        raise ValueError("single_rom_required_source_categories_missing")
    if not required <= set(merge.get("coverage", {})):
        raise ValueError("single_rom_required_source_coverage_missing")
    for stage in stages:
        ledger = stage.get("ledger", {})
        status = stage.get("status")
        explicit_ready = any(ledger.get(key) is True for key in ("ready", "buildEligible", "build_ready"))
        if (not ledger or status in ("blocked", "partial", "failed", "skipped", "running")
                or (status not in ("complete", "ready", "passed") and not explicit_ready)):
            raise ValueError("single_rom_source_stage_not_complete")
        if not re.fullmatch(r"[a-f0-9]{64}", stage.get("moduleSha256", "")):
            raise ValueError("single_rom_source_stage_implementation_unpinned")
        retained = local_file(stage.get("retainedModulePath", ""), root)
        if digest(retained) != stage["moduleSha256"]:
            raise ValueError("single_rom_source_transform_changed")
        if any(ledger.get(key) for key in ("unresolved", "blockers", "unsupported", "unknownCommands", "unresolvedSymbols")):
            raise ValueError("single_rom_source_stage_has_unresolved_dependencies")
        if any(ledger.get(key) is False for key in ("ready", "buildEligible", "build_ready", "semantic_coverage_complete", "campaignComplete")):
            raise ValueError("single_rom_source_stage_declares_partial_coverage")
        evidence_keys = {"maps", "layouts", "files", "sourceFiles", "nativeDependencies", "sourceClosure", "handlers",
                         "providers", "source_hashes", "source_pins", "translationUnits", "patched_files", "changed_files", "initialization", "songs", "resources"}
        if not any(isinstance(ledger.get(key), (dict, list)) and ledger[key] for key in evidence_keys):
            raise ValueError("single_rom_source_stage_evidence_missing")
        name = stage["name"]
        if name == "world_assets" and any(not ledger.get(key) for key in ("maps", "layouts", "files")):
            raise ValueError("single_rom_map_layout_asset_inventory_missing")
        if name == "scripts":
            if not ledger.get("sourceFiles") or not ledger.get("nativeDependencies"):
                raise ValueError("single_rom_script_native_inventory_missing")
            if any(row.get("status") != "ported-and-verified" for row in ledger["nativeDependencies"]):
                raise ValueError("single_rom_native_services_not_verified")
        if name in ("map_runtime", "state") and not ledger.get("coverage"):
            raise ValueError("single_rom_runtime_state_coverage_missing")
        inventories = {"audio": ("songs", "resources"), "encounters": ("trainer_ids", "source_hashes", "files"),
                       "map_semantics": ("supported", "source_hashes", "predicate_dispatch"),
                       "opcodes": ("handlers", "providers"), "native_ui": ("providers", "translationUnits"),
                       "native_services": ("nativeDependencies", "sourceClosure", "specialTable"),
                       "campaign": ("initialization", "policy", "source_pins")}
        if name in inventories and any(not ledger.get(key) for key in inventories[name]):
            raise ValueError("single_rom_required_source_inventory_missing:" + name)
    return True


def verify_merge(merge, root=ROOT, *, require_complete=True):
    if merge.get("schema") != "single-rom-merge/1":
        raise ValueError("unsupported_single_rom_merge_receipt")
    if not isinstance(merge.get("unresolved"), list):
        raise ValueError("single_rom_merge_blocker_ledger_missing")
    if require_complete and (merge.get("buildEligible") is not True or merge.get("unresolved") != []):
        raise ValueError("single_rom_source_merge_incomplete")
    if require_complete:
        source_closure(merge, root)
    for role, game in (("base", "emerald"), ("donor", "firered")):
        source = merge.get(role, {})
        if not {"id", "commit", "treeHash"} <= set(source) or source.get("id") != game or source.get("commit") != COMMITS[game]:
            raise ValueError("single_rom_source_lineage_mismatch")
        if not re.fullmatch(r"[a-f0-9]{40}", source.get("treeHash", "")):
            raise ValueError("single_rom_source_tree_identity_missing")
    if not re.fullmatch(r"[a-f0-9]{64}", merge.get("outputPatchSha256", "")):
        raise ValueError("single_rom_merge_patch_identity_missing")
    patch = local_file(merge.get("outputPatchPath", ""), root)
    if digest(patch) != merge["outputPatchSha256"]:
        raise ValueError("single_rom_merge_patch_changed")
    if not merge.get("outputSourceDirectory"):
        raise ValueError("single_rom_merged_source_directory_missing")
    if not merge.get("outputTreeHash") or not isinstance(merge.get("coverage"), dict) or not merge["coverage"]:
        raise ValueError("single_rom_merge_provenance_missing")
    changed = merge.get("changedFiles")
    if not isinstance(changed, list) or not changed:
        raise ValueError("single_rom_merge_has_no_source_changes")
    paths = set()
    for record in changed:
        path = Path(record["path"])
        if path.is_absolute() or ".." in path.parts or str(path) in paths:
            raise ValueError("invalid_merged_source_file_path")
        paths.add(str(path))
        if record.get("sha256") is None and record.get("bytes") is None and record.get("change") in ("deleted", "delete", "removed"):
            if merge.get("outputSourceDirectory") and (Path(merge["outputSourceDirectory"]) / path).exists():
                raise ValueError("deleted_merged_source_file_still_exists")
            continue
        if not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")) or type(record.get("bytes")) is not int or record["bytes"] < 0:
            raise ValueError("invalid_merged_source_file_identity")
        if merge.get("outputSourceDirectory"):
            file = local_file(str(Path(merge["outputSourceDirectory"]) / path), root)
            if digest(file) != record["sha256"] or file.stat().st_size != record["bytes"]:
                raise ValueError("merged_source_file_changed")
    return merge


def verify_build(build, merge, root=ROOT):
    if build.get("schema") != "whole-source-build/1" or build.get("status") != "passed" or build.get("build", {}).get("outcome") != "passed":
        raise ValueError("standalone_source_build_not_successful")
    if build.get("game") != "emerald" or build.get("sourceCommit") != merge["base"]["commit"] or build.get("sourceTreeHash") != merge["base"]["treeHash"]:
        raise ValueError("standalone_build_base_source_mismatch")
    if build.get("patchSha256") != merge["outputPatchSha256"]:
        raise ValueError("standalone_build_merge_patch_mismatch")
    if build.get("appliedSourceTreeHash") != merge["outputTreeHash"] or build.get("expectedTreeHash") != merge["outputTreeHash"]:
        raise ValueError("standalone_build_source_application_unproven")
    if build.get("appliedChangedFiles") != len(merge["changedFiles"]):
        raise ValueError("standalone_build_changed_file_set_mismatch")
    if build.get("sourceBridgeSha256") is not None:
        raise ValueError("paired_engine_bridge_is_not_standalone")
    if not build.get("sourceSnapshotSha256"):
        raise ValueError("standalone_build_source_snapshot_missing")
    for kind in ("rom", "elf"):
        record = build.get("artifacts", {}).get(kind, {})
        check_pin({"path": record["path"], "sha256": record["sha256"]}, root)
    # Inspect the actual compilation source directory, not only the merger's
    # separate staged tree. A patch hash does not prove git applied the patch.
    source = local_file(build["artifacts"]["rom"]["path"], root).parent
    if local_file(build["artifacts"]["elf"]["path"], root).parent != source:
        raise ValueError("standalone_build_artifacts_source_directory_mismatch")
    for record in merge["changedFiles"]:
        path = source / record["path"]
        if record["sha256"] is None:
            if path.exists():
                raise ValueError("standalone_deleted_source_file_still_present")
            continue
        actual = local_file(str(path), root)
        if digest(actual) != record["sha256"] or actual.stat().st_size != record["bytes"]:
            raise ValueError("standalone_compiled_source_file_mismatch")
    return build


def verify_linked_artifact(build, merge, root=ROOT, *, require_complete=True):
    """Check producer-declared source anchors against real linked ROM/ELF bytes."""
    from .elf_symbols import symbols
    rows = merge.get("linkedPostconditions", [])
    if not isinstance(rows, list):
        raise ValueError("standalone_link_postconditions_invalid")
    if not rows:
        if require_complete:
            raise ValueError("standalone_link_postconditions_missing")
        return {"status": "unavailable", "checks": [], "failures": ["No linked artifact witnesses declared."]}
    elf = local_file(build["artifacts"]["elf"]["path"], root)
    rom_path = local_file(build["artifacts"]["rom"]["path"], root)
    rom = rom_path.read_bytes()
    index = symbols(elf, detailed=True)
    changed = {record["path"]: record for record in merge["changedFiles"]}
    checks, failures, categories = [], [], set()
    for row in rows:
        label = row.get("symbol")
        try:
            category = row["category"]
            source = changed.get(row["sourcePath"])
            if not source or not source["sha256"] or source["sha256"] != row.get("sourceSha256"):
                raise ValueError("link_witness_source_anchor_mismatch")
            matches = index.get(label, [])
            if len(matches) != 1:
                raise ValueError("link_witness_symbol_missing_or_ambiguous")
            linked = matches[0]
            address, size = linked["address"], linked["size"]
            effective_address = (address & ~1) if linked["type"] == 2 or row.get("thumb") is True else address
            offset = effective_address - 0x08000000
            minimum = row.get("minBytes", 0)
            if type(minimum) is not int or minimum < 0 or not 0 <= offset < len(rom) or size < minimum or offset + size > len(rom):
                raise ValueError("link_witness_outside_rom_or_size_mismatch")
            if (not linked.get("sectionFlags") or not linked["sectionFlags"] & 2 or linked.get("sectionType") == 8
                    or not linked["sectionAddress"] <= effective_address < linked["sectionAddress"] + linked["sectionSize"]):
                raise ValueError("link_witness_not_in_allocated_rom_section")
            proof = {"symbol": label, "category": category, "sourcePath": row["sourcePath"],
                     "sourceSha256": source["sha256"], "address": address, "size": size,
                     "section": linked["section"], "kind": row.get("kind")}
            if row.get("kind") == "rom-bytes":
                relative_asset = Path(row["artifactPath"])
                if relative_asset.is_absolute() or ".." in relative_asset.parts:
                    raise ValueError("link_witness_asset_outside_compilation_tree")
                asset = local_file(str(rom_path.parent / relative_asset), root)
                if digest(asset) != row.get("artifactSha256"):
                    raise ValueError("link_witness_expected_asset_changed")
                expected = asset.read_bytes()
                delta = row.get("offset", 0)
                if type(delta) is not int or delta < 0 or not expected or rom[offset + delta:offset + delta + len(expected)] != expected:
                    raise ValueError("link_witness_rom_asset_bytes_mismatch")
                proof.update(bytesSha256=row["artifactSha256"], bytes=len(expected), offset=delta)
            elif row.get("kind") != "elf-symbol":
                raise ValueError("unsupported_link_witness_kind")
            checks.append(proof)
            categories.add(category)
        except (ValueError, KeyError, TypeError) as error:
            failures.append({"symbol": label, "reason": str(error)})
    required = set(merge.get("requiredStageNames", REQUIRED_STAGES))
    missing = sorted(required - categories)
    if missing:
        failures.append({"reason": "linked_source_categories_missing", "categories": missing})
    if require_complete and failures:
        raise ValueError("standalone_link_postconditions_failed:" + json.dumps(failures, sort_keys=True))
    return {"status": "verified" if not failures else "failed", "checks": checks, "failures": failures}


def verify_manifest(manifest, root=ROOT, *, require_source_closed=False):
    if manifest.get("format") != FORMAT or manifest.get("compositionId") != COMPOSITION_ID:
        raise ValueError("unsupported_standalone_composition")
    if manifest.get("gameId") != GAME_ID or manifest.get("baseEngine") != "emerald" or manifest.get("adapter") != ADAPTER:
        raise ValueError("unsupported_standalone_runtime")
    if manifest.get("runtimeDependencies") != []:
        raise ValueError("standalone_rom_cannot_require_external_game_payloads")
    merge_path = check_pin(manifest["sourceMerge"], root)
    integration = manifest.get("integrationStatus")
    if integration not in ("development", "source-closed"):
        raise ValueError("standalone_integration_status_required")
    if require_source_closed and integration != "source-closed":
        raise ValueError("development_artifact_cannot_close_source_integration")
    merge = verify_merge(json.loads(merge_path.read_text()), root, require_complete=integration == "source-closed")
    build_path = check_pin(manifest["buildReceipt"], root)
    build = verify_build(json.loads(build_path.read_text()), merge, root)
    linked = verify_linked_artifact(build, merge, root, require_complete=integration == "source-closed")
    if manifest.get("linkedArtifactEvidence") != linked:
        raise ValueError("standalone_link_evidence_mismatch")
    if manifest.get("sources") != [merge["base"], merge["donor"]]:
        raise ValueError("standalone_manifest_lineage_mismatch")
    artifacts = manifest.get("artifacts", {})
    if set(artifacts) != {"rom", "elf"}:
        raise ValueError("standalone_requires_exactly_one_rom_and_elf")
    for kind in ("rom", "elf"):
        expected = build["artifacts"][kind]
        if artifacts[kind] != {"path": expected["path"], "sha256": expected["sha256"]}:
            raise ValueError("standalone_artifact_build_mismatch")
        check_pin(artifacts[kind], root)
    if "observationProfile" in manifest:
        check_pin(manifest["observationProfile"], root)
    expected_hash = identity({key: value for key, value in manifest.items() if key != "manifestSha256"})
    if manifest.get("manifestSha256") != expected_hash:
        raise ValueError("standalone_manifest_identity_mismatch")
    return manifest


def compose(merge_receipt, build_receipt, *, observation_profile=None, development=False, root=ROOT):
    merge_path, build_path = (local_file(str(path), root) for path in (merge_receipt, build_receipt))
    merge = verify_merge(json.loads(merge_path.read_text()), root, require_complete=not development)
    build = verify_build(json.loads(build_path.read_text()), merge, root)
    linked = verify_linked_artifact(build, merge, root, require_complete=not development)
    manifest = {"format": FORMAT, "compositionId": COMPOSITION_ID, "gameId": GAME_ID,
                "baseEngine": "emerald", "sources": [merge["base"], merge["donor"]],
                "sourceMerge": pin(merge_path, root), "buildReceipt": pin(build_path, root),
                "artifacts": {kind: {"path": build["artifacts"][kind]["path"],
                                      "sha256": build["artifacts"][kind]["sha256"]} for kind in ("rom", "elf")},
                "adapter": ADAPTER.copy(), "runtimeDependencies": [],
                "integrationStatus": "development" if development else "source-closed",
                "linkedArtifactEvidence": linked}
    if observation_profile is not None:
        manifest["observationProfile"] = pin(observation_profile, root)
    manifest["manifestSha256"] = identity(manifest)
    return verify_manifest(manifest, root)


def resume_inputs(manifest, profile, checkpoint, learning, *, from_profile=None, root=ROOT):
    if (checkpoint is None) != (learning is None):
        raise ValueError("single_resume_requires_state_and_learning")
    if checkpoint is None:
        if from_profile is not None:
            raise ValueError("single_profile_migration_requires_resume")
        return None
    from tools.playtester.core import digest as profile_digest
    folder = (root / checkpoint).resolve()
    metadata = local_file(str(folder / "state.json"), root)
    state = json.loads(metadata.read_text())
    if (state.get("format") != "whole-game-single-rom-state/1" or state.get("gameId") != manifest["gameId"]
            or state.get("gameVersion") != manifest["artifacts"]["rom"]["sha256"]
            or state.get("manifestSha256") != manifest["manifestSha256"]):
        raise ValueError("single_resume_artifact_identity_mismatch")
    native = local_file(str(folder / "state.ss"), root)
    image = local_file(str(folder / "observation.png"), root)
    if digest(native) != state.get("state", {}).get("sha256") or native.stat().st_size != state["state"]["bytes"]:
        raise ValueError("single_resume_native_state_corrupt")
    if digest(image) != state.get("imageSha256"):
        raise ValueError("single_resume_observation_corrupt")
    runtime = state.get("runtimeIdentity", {})
    for key, path in (("native_sha256", "tools/re/session/build/gba-session"),
                      ("adapter_sha256", "tools/whole_game/single_adapter.py"),
                      ("bridge_sha256", "tools/re/session/bridge.py")):
        if runtime.get(key) != digest(root / path):
            raise ValueError("single_resume_native_runtime_changed")
    if not runtime.get("emulator"):
        raise ValueError("single_resume_emulator_identity_missing")
    learning_path = local_file(str(learning), root)
    retained = json.loads(learning_path.read_text())
    prior = profile
    migration = None
    if from_profile is not None:
        old_path = local_file(str(from_profile), root)
        prior = json.loads(old_path.read_text())
        if (prior.get("game_id") != profile.get("game_id") or prior.get("game_version") != profile.get("game_version")
                or prior.get("objective") != profile.get("objective")):
            raise ValueError("single_resume_profile_migration_changes_target")
        migration = {"fromProfile": pin(old_path, root), "fromProfileSha256": profile_digest(prior),
                     "toProfileSha256": profile_digest(profile)}
    if retained.get("game_version") != profile["game_version"] or retained.get("profile_sha256") != profile_digest(prior):
        raise ValueError("single_resume_learning_identity_mismatch")
    return {"checkpoint": pin(metadata, root), "nativeState": pin(native, root), "image": pin(image, root),
            "learning": pin(learning_path, root), "parentFrame": state.get("frame"),
            "profileMigration": migration, "runtimeIdentity": runtime}


def playtest(manifest_path, profile_path, loop_path, output, *, observation_profile=None,
             sid_env_file=None, resume_checkpoint=None, resume_learning=None, resume_from_profile=None):
    manifest_path, profile_path, loop_path = (local_file(str(path)) for path in (manifest_path, profile_path, loop_path))
    manifest = verify_manifest(json.loads(manifest_path.read_text()))
    loop = json.loads(loop_path.read_text())
    keys = {"max_steps": "--max-steps", "max_frames": "--max-frames", "max_seconds": "--max-seconds",
            "max_decisions": "--max-decisions", "max_escalations": "--max-escalations",
            "max_action_frames": "--max-action-frames", "model_timeout": "--model-timeout",
            "adapter_timeout": "--adapter-timeout", "stationary_min_frames": "--stationary-min-frames"}
    if (loop.get("schema") != "whole-source-playtest-loop/1" or loop.get("policy") != "d1"
            or loop.get("system2") != "chat" or type(loop.get("fullScenario", False)) is not bool
            or set(loop) - {"schema", "policy", "system2", "fullScenario", "limits"}):
        raise ValueError("unsupported_single_rom_loop_config")
    limits = loop.get("limits", {})
    required = set(keys) - {"stationary_min_frames"}
    if not required <= set(limits) <= set(keys) or any(type(value) not in (int, float) or not 0 < value <= 100000 for value in limits.values()):
        raise ValueError("invalid_single_rom_loop_limits")
    for name in ("max_steps", "max_frames", "max_decisions", "max_escalations", "max_action_frames"):
        if type(limits[name]) is not int:
            raise ValueError("single_rom_integer_loop_limit_required")
    profile = json.loads(profile_path.read_text())
    rom_hash = manifest["artifacts"]["rom"]["sha256"]
    if profile.get("game_id") != GAME_ID or profile.get("game_version") not in (None, rom_hash):
        raise ValueError("single_rom_profile_artifact_mismatch")
    profile["game_version"] = rom_hash
    continuation = resume_inputs(manifest, profile, resume_checkpoint, resume_learning, from_profile=resume_from_profile)
    observation = pin(local_file(str(observation_profile))) if observation_profile else manifest.get("observationProfile")
    if observation is not None:
        check_pin(observation)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    effective = output / "effective-profile.json"
    effective.write_text(json.dumps(profile, indent=2) + "\n")
    report = {"format": "single-rom-pipeline-run/1", "runId": str(uuid.uuid4()), "status": "running",
              "startedAt": datetime.now(timezone.utc).isoformat(), "stages": [], "manifest": pin(manifest_path),
              "manifestSha256": manifest["manifestSha256"], "romSha256": rom_hash,
              "integrationStatus": manifest["integrationStatus"], "profile": pin(profile_path),
              "effectiveProfile": pin(effective), "loopConfig": pin(loop_path), "continuation": continuation,
              "observationProfile": observation, "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "pipelineSha256": digest(Path(__file__)), "pilotSha256": digest(ROOT / "tools/whole_game/pilot.py"),
              "adapterSha256": digest(ROOT / "tools/whole_game/single_adapter.py"),
              "observationImplementationSha256": digest(ROOT / "tools/whole_game/observations.py") if observation else None,
              "environment": {"platform": platform.platform(), "python": platform.python_version()},
              "timing": {"queueS": None, "totalS": None, "buildS": None, "pilotS": None},
              "timingNote": "Pilot includes model/network, emulator, evidence and checkpoint replay; nested timings are not additive."}
    receipt = output / "run.json"
    save(receipt, report)
    argv = [sys.executable, "-m", "tools.whole_game.pilot", "--profile", str(effective), "--output", str(output / "playtest"),
            "--policy", "d1", "--system2", "chat"]
    for name, value in limits.items():
        argv += [keys[name], str(value)]
    if loop.get("fullScenario"):
        argv += ["--full-scenario"]
    if sid_env_file is not None:
        argv += ["--sid-env-file", str(sid_env_file)]
    if continuation:
        argv += ["--resume-context", str(check_pin(continuation["learning"]))]
        if continuation["profileMigration"]:
            argv += ["--resume-from-profile", str(check_pin(continuation["profileMigration"]["fromProfile"]))]
    argv += ["--adapter-command", sys.executable, "-m", "tools.whole_game.single_adapter", "--manifest", str(manifest_path), "--out", str(output / "session")]
    if observation:
        argv += ["--observation-profile", str(check_pin(observation))]
    if continuation:
        argv += ["--resume-checkpoint", str(check_pin(continuation["checkpoint"]).parent)]
    start = time.monotonic()
    try:
        code = run_stage(report, receipt, "single-rom-model-pilot", argv, output / "pilot.log",
                         limits["max_seconds"] + limits["model_timeout"] + limits["adapter_timeout"] + 15)
        result_path, pilot_path = output / "playtest/report.json", output / "playtest/pilot.json"
        if not result_path.is_file() or not pilot_path.is_file():
            raise ValueError("single_rom_pilot_evidence_missing")
        result, pilot = json.loads(result_path.read_text()), json.loads(pilot_path.read_text())
        report.update(status=result.get("status", "failed"), reason=result.get("reason"),
                      playtestReport=pin(result_path), pilotReport=pin(pilot_path),
                      scenarioOutcome=pilot.get("scenario_outcome"), checkpointReplayOutcome=pilot.get("replay", {}).get("status"))
        if result.get("adapter", {}).get("game_version") != rom_hash:
            raise ValueError("single_rom_pilot_version_mismatch")
        if code != 0 or report["checkpointReplayOutcome"] == "mismatch":
            report.update(status="failed", reason="single_rom_pilot_or_checkpoint_replay_failed")
        report["timing"]["pilotS"] = result.get("timing", {}).get("total_wall_s")
        return report
    except KeyboardInterrupt:
        report["status"] = "cancelled"
        raise
    except Exception as error:
        report.update(status="failed", reason=str(error))
        raise
    finally:
        report["timing"]["totalS"] = round(time.monotonic() - start, 6)
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        save(receipt, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("manifest", type=Path)
    verify.add_argument("--source-closed", action="store_true")
    create = commands.add_parser("compose")
    create.add_argument("--merge-receipt", type=Path, required=True)
    create.add_argument("--build-receipt", type=Path, required=True)
    create.add_argument("--observation-profile", type=Path)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--development", action="store_true", help="Retain partial integration classification; never closes source blockers")
    play = commands.add_parser("playtest")
    for name in ("manifest", "profile", "loop-config", "output"):
        play.add_argument("--" + name, type=Path, required=True)
    for name in ("observation-profile", "sid-env-file", "resume-checkpoint", "resume-learning", "resume-from-profile"):
        play.add_argument("--" + name, type=Path)
    args = parser.parse_args()
    if args.operation == "playtest":
        result = playtest(args.manifest, args.profile, args.loop_config, args.output,
                          observation_profile=args.observation_profile, sid_env_file=args.sid_env_file,
                          resume_checkpoint=args.resume_checkpoint, resume_learning=args.resume_learning,
                          resume_from_profile=args.resume_from_profile)
        print(json.dumps({"status": result["status"], "reason": result.get("reason"), "runId": result["runId"],
                          "integrationStatus": result["integrationStatus"]}))
        if result["status"] == "failed":
            raise SystemExit(2)
        return
    if args.operation == "verify":
        manifest = verify_manifest(json.loads(args.manifest.read_text()), require_source_closed=args.source_closed)
    else:
        manifest = compose(args.merge_receipt, args.build_receipt, observation_profile=args.observation_profile,
                           development=args.development)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x") as stream:
            stream.write(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "standalone_artifact_pins_verified", "manifestSha256": manifest["manifestSha256"],
                      "romSha256": manifest["artifacts"]["rom"]["sha256"],
                      "integrationStatus": manifest["integrationStatus"],
                      "qualification": "source/build identity only; native gameplay qualification required"}))


if __name__ == "__main__":
    main()
