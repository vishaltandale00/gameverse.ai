#!/usr/bin/env python3
"""Stage a pinned FireRed source merge into one Emerald source tree.

Preparation retains complete clean source copies and a binary-capable git patch.
Strict builds require every transform to clear its semantic coverage gate;
development builds compile complete stage outputs with blockers retained.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
RUNS = ROOT / "local/whole-game-mashup/emerald-firered/single-rom"
SOURCES = {
    "emerald": (ROOT / "local/decomps/pokeemerald", "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881"),
    "firered": (ROOT / "local/decomps/pokefirered", "037335f4c725d7c9aecdac87066f2002b4bd7e14"),
}
STAGES = ("world_assets", "state", "battle_modes", "encounters", "audio", "map_runtime", "map_events", "map_semantics", "field_movement", "opcodes", "scripts", "fonts", "native_ui", "daycare", "battle_tutorial", "old_man_bag", "quest_log", "story_services", "utility_services", "field_services", "vs_seeker", "fame_checker", "world_services", "trainer_tower", "battle_services", "ghost_battle", "progression", "credits", "native_services", "campaign", "travel", "region_map", "save_runtime")
HELPER_MODULES = ("script_constants", "save_codec")
PENDING_COMPONENTS = ()
ECLECTIC_SOURCE_FILES = (
    "tools/prefab_pipeline/eclectic_strategy.py",
    "tools/behavior_ir/lower.py",
    "tools/behavior_ir/contract.py",
    "tools/behavior_ir/domain.py",
)
LINK_WITNESSES = {
    "state": ("WholeGame_IsKanto", "src/event_data.c"),
    "battle_modes": ("WholeGame_IsFireRedTrainerBattle", "src/battle_setup.c"),
    "encounters": ("FR_SeedWildEncounterRng", "src/firered_wild_encounter.c"),
    "audio": ("WholeGame_RemapAudio", "src/whole_game_audio.c"),
    "map_runtime": ("WholeGameObjectGraphicsInfo", "src/event_object_movement.c"),
    "map_events": ("WholeGame_MapEventsSemanticsVersion", "src/event_object_movement.c"),
    "map_semantics": ("WholeGameFireRedBehavior", "src/metatile_behavior.c"),
    "field_movement": ("WGFR_DoStairWarp", "src/field_screen_effect.c"),
    "field_services": ("FR_DoSeagallopFerryScene", "src/firered_native/field_seagallop.c"),
    "opcodes": ("FR_ScrCmd_comparestat", "src/scrcmd.c"),
    "scripts": ("FR_Text_WouldYouLikeToMixRecords", "data/firered/data/event_scripts.s"),
    "fonts": ("FR_GetGlyphWidth_Male", "src/text.c"),
    "native_ui": ("FR_CreateHelpMessageWindow", "src/firered_native/ui_help.c"),
    "daycare": ("FR_PutMonInRoute5Daycare", "src/firered_native/daycare.c"),
    "fame_checker": ("FR_UseFameChecker", "src/firered_native/fame_checker.c"),
    "battle_tutorial": ("FR_OakOldManHandleInputChooseMove", "src/whole_game_battle_tutorial.c"),
    "old_man_bag": ("FR_InitOldManBag", "src/item_menu.c"),
    "vs_seeker": ("FR_GetRematchTrainerId", "src/firered_vs_seeker.c"),
    "quest_log": ("FR_QuestLog_RecordEnteredMap", "src/firered_quest_log/quest_log_events.c"),
    "story_services": ("FR_DoDeoxysTriangleInteraction", "src/firered_native/story_services.c"),
    "utility_services": ("FR_Field_AskSaveTheGame", "src/firered_native/utility_save.c"),
    "native_services": ("FR_GetStarterSpecies", "src/firered_native/campaign_services.c"),
    "world_services": ("FR_AddBagItem", "src/firered_world_bag.c"),
    "trainer_tower": ("FR_CallTrainerTowerFunc", "src/firered_trainer_tower.c"),
    "battle_services": ("FR_StartLegendaryBattle", "src/battle_setup.c"),
    "ghost_battle": ("WholeGame_FireRedGhostBattleVersion", "src/battle_gfx_sfx_util.c"),
    "campaign": ("WholeGame_InitializeKanto", "src/whole_game_campaign.c"),
    "travel": ("WholeGame_TravelHealToKanto", "src/whole_game_travel.c"),
    "region_map": ("FR_ShowTownMap", "src/firered_town_map.c"),
    "progression": ("WholeGame_HasRegionalBadge", "src/whole_game_progression.c"),
    "credits": ("FR_DoCredits", "src/whole_game_fr_credits.c"),
    "save_runtime": ("WgSnapshotSave", "src/wg_save_runtime.c"),
    "eclectic": ("WholeGameEclecticDamage", "src/whole_game_eclectic.c"),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def freeze_eclectic_inputs(request_source: Path, run_dir: Path) -> tuple[dict, list[dict]]:
    """Retain the optional recipe and every Python/package input it can read."""
    request_copy = run_dir / "eclectic-request.json"
    shutil.copy2(request_source, request_copy)
    request = json.loads(request_copy.read_text())
    if request.get("schema") != "gameverse.pokemon-eclectic-request/1":
        raise ValueError("unsupported eclectic request schema")
    pins = []
    for relative in ECLECTIC_SOURCE_FILES:
        source = ROOT / relative
        retained = run_dir / "eclectic-inputs" / relative
        retained.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, retained)
        pins.append({"path": str(source), "sha256": sha256(retained),
                     "retainedPath": str(retained)})
    packages = request.get("packages")
    if not isinstance(packages, dict) or len(packages) != 6:
        raise ValueError("eclectic request must pin six packages")
    for alias, row in sorted(packages.items()):
        identifier = row.get("id") if isinstance(row, dict) else None
        if not isinstance(alias, str) or not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", identifier):
            raise ValueError("unsafe eclectic package identifier")
        source_dir = ROOT / "local/ir/packages" / identifier
        retained_dir = run_dir / "eclectic-inputs/packages" / alias
        shutil.copytree(source_dir, retained_dir)
        for retained in sorted(retained_dir.rglob("*")):
            if retained.is_symlink():
                raise ValueError("eclectic package contains unsupported symlink")
            if retained.is_file():
                relative = retained.relative_to(retained_dir)
                pins.append({"path": str(source_dir / relative), "sha256": sha256(retained),
                             "retainedPath": str(retained)})
    return {"path": str(request_copy), "sha256": sha256(request_copy)}, pins


def changed_pins(pins: list[dict]) -> list[str]:
    return [pin["path"] for pin in pins
            if not Path(pin["path"]).is_file() or sha256(Path(pin["path"])) != pin["sha256"]
            or sha256(Path(pin["retainedPath"])) != pin["sha256"]]


def git(directory: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(directory), *args], text=True).strip()


def archive(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True)
    process = subprocess.Popen(["git", "-C", str(source), "archive", "--format=tar", "HEAD"],
                               stdout=subprocess.PIPE)
    assert process.stdout is not None
    with tarfile.open(fileobj=process.stdout, mode="r|") as members:
        for member in members:
            target = (destination / member.name).resolve()
            if destination not in target.parents and target != destination:
                raise RuntimeError(f"unsafe source archive member: {member.name}")
            if member.issym() or member.islnk():
                raise RuntimeError(f"source archive link unsupported: {member.name}")
            members.extract(member, destination)
    if process.wait() != 0:
        raise RuntimeError(f"source archive failed: {source}")


def source_pin(name: str) -> dict:
    source, expected = SOURCES[name]
    actual = git(source, "rev-parse", "HEAD")
    if actual != expected:
        raise RuntimeError(f"{name} source commit mismatch: {actual}")
    if git(source, "status", "--porcelain"):
        raise RuntimeError(f"canonical {name} source is dirty: {source}")
    return {"id": name, "commit": actual, "treeHash": git(source, "rev-parse", "HEAD^{tree}"),
            "canonicalSourceDirectory": str(source)}


def stage_module(package: str, name: str):
    return importlib.import_module(f"{package}.{name}")


def call_stage(name: str, base: Path, donor: Path, output: Path, report_dir: Path,
               earlier: dict[str, dict], package: str, request_path: Path | None = None) -> dict:
    module = stage_module(package, name)
    if name == "world_assets":
        return module.stage_world_assets(base, donor, output, report_dir)
    if name == "state":
        return module.apply(output, donor)
    if name == "battle_modes":
        return module.stage_battle_modes(base, donor, output, report_dir)
    if name == "audio":
        return module.import_audio(donor, output, report_dir)
    if name == "encounters":
        return module.stage_encounters(base, donor, output, report_dir)
    if name == "map_runtime":
        return module.stage_map_runtime(base, donor, output, report_dir)
    if name == "map_events":
        return module.stage_map_events(base, donor, output, report_dir)
    if name == "map_semantics":
        return module.stage_map_semantics(base, donor, output, report_dir)
    if name == "field_movement":
        return module.stage_field_movement(base, donor, output, report_dir)
    if name == "field_services":
        return module.stage_field_services(base, donor, output, report_dir)
    if name == "opcodes":
        symbols = earlier.get("world_assets", {}).get("symbols")
        return module.stage_native_opcodes(base, donor, output, report_dir, symbol_map=symbols)
    if name == "scripts":
        symbols = earlier.get("world_assets", {}).get("symbols")
        return module.import_scripts(donor, base, output, symbol_map=symbols,
                                     opcode_overrides=earlier["opcodes"]["handlerOpcodeMap"])
    if name == "native_ui":
        symbols = earlier.get("scripts", {}).get("symbolMap")
        return module.stage_native_ui(base, donor, output, report_dir, symbol_map=symbols)
    if name == "daycare":
        return module.stage_daycare(base, donor, output, report_dir)
    if name == "fonts":
        return module.stage_fonts(base, donor, output, report_dir)
    if name == "battle_tutorial":
        return module.stage_battle_tutorial(base, donor, output, report_dir)
    if name == "old_man_bag":
        return module.stage_old_man_bag(base, donor, output, report_dir)
    if name == "vs_seeker":
        return module.stage_vs_seeker(base, donor, output, report_dir)
    if name == "quest_log":
        symbols = earlier.get("scripts", {}).get("symbolMap")
        return module.stage_quest_log(base, donor, output, report_dir, symbol_map=symbols)
    if name == "story_services":
        return module.stage_story_services(base, donor, output, report_dir)
    if name == "utility_services":
        return module.stage_utility_services(base, donor, output, report_dir)
    if name == "fame_checker":
        return module.stage_fame_checker(base, donor, output, report_dir)
    if name == "world_services":
        return module.stage_world_services(base, donor, output, report_dir)
    if name == "trainer_tower":
        return module.stage_trainer_tower(base, donor, output, report_dir)
    if name == "battle_services":
        return module.stage_battle_services(base, donor, output, report_dir)
    if name == "ghost_battle":
        return module.stage_ghost_battle(base, donor, output, report_dir)
    if name == "native_services":
        symbols = earlier.get("scripts", {}).get("symbolMap")
        return module.stage_native_services(base, donor, output, report_dir,
                                            symbol_map=symbols,
                                            provider_ledgers=[earlier["native_ui"], earlier["daycare"], earlier["old_man_bag"],
                                                              earlier["field_services"],
                                                              earlier["quest_log"], earlier["story_services"], earlier["utility_services"],
                                                              earlier["fame_checker"], earlier["trainer_tower"],
                                                              earlier["battle_services"], earlier["ghost_battle"],
                                                              earlier["progression"], earlier["credits"]])
    if name == "campaign":
        return module.stage_campaign(base, donor, output, report_dir)
    if name == "travel":
        return module.stage_travel(base, donor, output, report_dir)
    if name == "region_map":
        return module.stage_region_map(base, donor, output, report_dir)
    if name == "progression":
        return module.stage_progression(base, donor, output, report_dir)
    if name == "credits":
        return module.stage_credits(base, donor, output, report_dir)
    if name == "save_runtime":
        return module.apply(output, codec_source=base)
    if name == "eclectic":
        return module.stage_eclectic(base, donor, output, report_dir,
                                    request_path=request_path, repo_root=ROOT)
    raise RuntimeError(f"unknown stage {name}")


def normalize_blockers(name: str, ledger: dict) -> list[dict]:
    results = []
    for key in ("unresolved", "blockers", "unsupported", "unresolvedSymbols"):
        source = ledger.get(key) or []
        if isinstance(source, dict):
            source = [{"id": entry, "reason": str(reason)} for entry, reason in source.items()]
        for index, item in enumerate(source):
            if isinstance(item, dict):
                result = dict(item)
                result.setdefault("id", f"{name}.{key}.{index}")
                result.setdefault("reason", str(result.get("detail", result["id"])))
            else:
                result = {"id": f"{name}.{key}.{index}", "reason": str(item)}
            result.setdefault("owner", name)
            results.append(result)
    if ledger.get("semantic_coverage_complete") is False:
        results.append({"id": f"{name}.semantic_coverage_incomplete", "owner": name,
                        "reason": "stage reports incomplete semantic coverage"})
    status = str(ledger.get("status", "unknown")).lower()
    if ledger.get("ready") is False or ledger.get("build_ready") is False or ledger.get("buildEligible") is False:
        results.append({"id": f"{name}.not_build_ready", "owner": name,
                        "reason": "stage explicitly reports build readiness false"})
    elif ledger.get("buildEligible") is not True and ledger.get("build_ready") is not True and ledger.get("ready") is not True and status not in {"complete", "ready", "passed"}:
        results.append({"id": f"{name}.not_complete", "owner": name,
                        "reason": f"stage status is {status}; complete coverage not asserted"})
    return results


def diagnostic_owners(lines: list[str], stages: list[dict]) -> list[dict]:
    file_owners: dict[str, list[str]] = {}
    for stage in stages:
        ledger = stage.get("ledger", {})
        for key in ("changedFiles", "changed_files", "patched_files", "files", "stagedFiles"):
            for item in ledger.get(key, []) if isinstance(ledger.get(key, []), list) else []:
                path = item if isinstance(item, str) else item.get("target", item.get("destination", item.get("path"))) if isinstance(item, dict) else None
                if isinstance(path, str):
                    file_owners.setdefault(path, []).append(stage["name"])
    diagnostics = []
    for line in lines:
        match = re.search(r"(?:^|\s)((?:src|data|include|asm|sound|graphics)/[^:\s]+)", line)
        path = match.group(1) if match else None
        diagnostics.append({"line": line, "path": path,
                            "candidateStages": file_owners.get(path, []) if path else []})
    return diagnostics


def linked_postconditions(output: Path, changed: list[dict], world: dict,
                          stages: tuple[str, ...]) -> tuple[list[dict], list[dict]]:
    by_path = {entry["path"]: entry for entry in changed if entry["change"] == "present"}
    requested = [(stage, symbol, path, 0 if stage == "scripts" else 1)
                 for stage, (symbol, path) in LINK_WITNESSES.items() if stage in stages]
    requested += [("world_assets", row["destination"],
                   f'data/maps/{row["destination"]}/map.json', 0)
                  for row in world.get("maps", [])]
    requested += [
        ("scripts", "FR_PalletTown_MapScripts", "data/maps/FRPalletTown/scripts.inc", 0),
        ("scripts", "FR_EventScript_ResetAllMapFlags", "data/firered/data/event_scripts.s", 0),
        ("scripts", "FR_Std_ObtainItem", "data/firered/data/scripts/obtain_item.inc", 0),
    ]
    requested.append(("world_assets", "FR_gTileset_General",
                      "src/data/firered/tilesets/headers.h", 1))
    witnesses, blockers = [], []
    for category, symbol, path, minimum in requested:
        entry = by_path.get(path)
        if entry is None or symbol not in (output / path).read_text(errors="replace"):
            blockers.append({"id": f"link.witness_source_missing.{category}.{symbol}", "owner": category,
                             "reason": f"linked symbol witness {symbol} lacks changed source anchor {path}"})
            continue
        witnesses.append({"kind": "elf-symbol", "symbol": symbol, "category": category,
                          "sourcePath": path, "sourceSha256": entry["sha256"], "minBytes": minimum})
    return witnesses, blockers


def changed_files(source: Path) -> list[dict]:
    raw = subprocess.check_output(["git", "-C", str(source), "diff", "--cached",
                                   "--no-renames", "--name-only", "-z", "HEAD"])
    files = []
    for encoded in (part for part in raw.split(b"\0") if part):
        relative = os.fsdecode(encoded)
        path = source / relative
        if path.is_symlink():
            raise RuntimeError(f"merged source contains unsupported symlink: {relative}")
        if path.is_file():
            files.append({"path": relative, "sha256": sha256(path),
                          "bytes": path.stat().st_size, "change": "present"})
        else:
            files.append({"path": relative, "sha256": None, "bytes": None,
                          "change": "deleted"})
    return files


def patch_applies_to_baseline(output: Path, patch: Path, run_dir: Path) -> tuple[bool, str]:
    """Check the isolated baseline index without touching staged output files."""
    with tempfile.TemporaryDirectory(prefix="patch-check-", dir=run_dir) as check_dir:
        check_env = dict(os.environ, GIT_INDEX_FILE=str(Path(check_dir) / "index"))
        subprocess.run(["git", "-C", str(output), "read-tree", "HEAD"],
                       env=check_env, capture_output=True, text=True, check=True)
        check = subprocess.run(["git", "-C", str(output), "apply", "--cached", "--check",
                                str(patch)], env=check_env, capture_output=True, text=True)
    return check.returncode == 0, check.stderr[-2000:]


def module_hash(name: str) -> str | None:
    path = Path(__file__).parent / f"{name}.py"
    return sha256(path) if path.is_file() else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "build", "build-development"))
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=300, help="per build command seconds")
    parser.add_argument("--eclectic-request", type=Path,
                        help="explicit pinned optional source recipe JSON")
    parser.add_argument("--reuse-build-receipt", type=Path,
                        help="incremental development diagnostic cache from a retained failed build")
    args = parser.parse_args()
    if not 1 <= args.jobs <= 4 or args.timeout < 1:
        parser.error("jobs must be 1..4 and timeout must be positive")
    if args.eclectic_request and not args.eclectic_request.is_file():
        parser.error("eclectic request file is missing")
    if args.reuse_build_receipt and args.operation != "build-development":
        parser.error("--reuse-build-receipt is only valid for build-development")
    if args.reuse_build_receipt and not args.reuse_build_receipt.is_file():
        parser.error("reuse build receipt is missing")
    stages = STAGES + (("eclectic",) if args.eclectic_request else ())
    run_id = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:12]}"
    run_dir = RUNS / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    coordinator_copy = run_dir / "coordinator.py"
    shutil.copy2(Path(__file__), coordinator_copy)
    frozen_dir = run_dir / "frozen_modules"
    frozen_dir.mkdir()
    frozen_modules = {}
    for name in (*stages, *HELPER_MODULES):
        original = Path(__file__).parent / f"{name}.py"
        if original.is_file():
            retained = frozen_dir / f"{name}.py"
            shutil.copy2(original, retained)
            frozen_modules[name] = {"path": str(retained), "sha256": sha256(retained)}
        else:
            frozen_modules[name] = None
    frozen_package_name = f"_single_rom_run_{uuid.uuid4().hex}"
    frozen_package = types.ModuleType(frozen_package_name)
    frozen_package.__path__ = [str(frozen_dir)]
    sys.modules[frozen_package_name] = frozen_package
    receipt_path = run_dir / "merge-receipt.json"
    start = time.monotonic()
    receipt = {
        "schema": "single-rom-merge/1", "runId": run_id, "startedAt": utc_now(),
        "coordinatorSha256": sha256(coordinator_copy),
        "frozenModules": frozen_modules,
        "requiredStageNames": list(stages),
        "requestConfig": None, "recipeSourcePins": [],
        "outstandingComponents": list(PENDING_COMPONENTS),
        "status": "preparing", "base": None, "donor": None,
        "outputSourceDirectory": str(run_dir / "merged-emerald-source"),
        "outputPatchPath": str(run_dir / "emerald-firered.patch"),
        "outputPatchSha256": None, "outputTreeHash": None, "patchAppliesToPinnedBase": None,
        "changedFiles": [], "linkedPostconditions": [], "coverage": {}, "unresolved": [], "buildEligible": False,
        "stages": [], "sourceBuildReceipt": None, "runtimeDependencies": [],
        "limits": {"jobs": args.jobs, "perCommandTimeoutSec": args.timeout},
        "reuseBuildReceipt": ({"path": str(args.reuse_build_receipt.resolve()),
                               "sha256": sha256(args.reuse_build_receipt)}
                              if args.reuse_build_receipt else None),
        "machine": {"system": platform.system(), "release": platform.release(),
                    "machine": platform.machine(), "python": platform.python_version()},
    }
    def save() -> None:
        receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True, default=str) + "\n")

    save()
    try:
        recipe_path = None
        if args.eclectic_request:
            receipt["requestConfig"], receipt["recipeSourcePins"] = freeze_eclectic_inputs(
                args.eclectic_request.resolve(), run_dir)
            recipe_path = Path(receipt["requestConfig"]["path"])
        receipt["base"] = source_pin("emerald")
        receipt["donor"] = source_pin("firered")
        base = run_dir / "base-emerald-source"
        donor = run_dir / "donor-firered-source"
        output = run_dir / "merged-emerald-source"
        prep_start = time.monotonic()
        archive(SOURCES["emerald"][0], base)
        archive(SOURCES["firered"][0], donor)
        archive(SOURCES["emerald"][0], output)
        receipt["sourcePreparationMs"] = round((time.monotonic() - prep_start) * 1000)
        subprocess.run(["git", "init", "-q", str(output)], check=True)
        subprocess.run(["git", "-C", str(output), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(output), "-c", "user.name=Gameverse Build",
                        "-c", "user.email=build@localhost", "commit", "-q", "-m", "pinned emerald baseline"], check=True)
        earlier = {}
        for component in PENDING_COMPONENTS:
            receipt["unresolved"].append({"id": f"{component}.pending_transform", "owner": component,
                                          "reason": f"mandatory source transform {component} is pending integration"})
        for name in stages:
            stage_dir = run_dir / "stage-reports" / name
            stage_dir.mkdir(parents=True)
            stage_start = time.monotonic()
            module_pin = frozen_modules[name]
            stage = {"name": name, "moduleSha256": module_pin["sha256"] if module_pin else None,
                     "startedAt": utc_now(), "status": "running", "wallMs": None}
            receipt["stages"].append(stage)
            try:
                if module_pin is None:
                    stage["status"] = "missing"
                    receipt["unresolved"].append({"id": f"{name}.missing_transform", "owner": name,
                                                  "reason": f"mandatory transform {name}.py was absent from frozen run inputs"})
                    continue
                frozen_module = stage_dir / "transform.py"
                shutil.copy2(Path(module_pin["path"]), frozen_module)
                if sha256(frozen_module) != stage["moduleSha256"]:
                    raise RuntimeError(f"frozen transform source failed hash check: {name}")
                stage["retainedModulePath"] = str(frozen_module)
                if name == "eclectic" and changed_pins(receipt["recipeSourcePins"]):
                    raise RuntimeError("pinned eclectic lowerer or package changed before stage")
                ledger = call_stage(name, base, donor, output, stage_dir, earlier,
                                    frozen_package_name, recipe_path)
                if name == "eclectic" and changed_pins(receipt["recipeSourcePins"]):
                    raise RuntimeError("pinned eclectic lowerer or package changed during stage")
                if not isinstance(ledger, dict):
                    raise RuntimeError("stage must return a JSON ledger object")
                earlier[name] = ledger
                stage["ledger"] = ledger
                stage["status"] = str(ledger.get("status", "unknown"))
                receipt["coverage"][name] = ledger.get("coverage", {})
                receipt["unresolved"].extend(normalize_blockers(name, ledger))
                (stage_dir / "stage-ledger.json").write_text(json.dumps(ledger, indent=2, sort_keys=True, default=str) + "\n")
            except Exception as error:
                stage["status"] = "failed"
                stage["error"] = str(error)
                receipt["unresolved"].append({"id": f"{name}.stage_failed", "owner": name,
                                              "reason": str(error)})
                continue
            finally:
                stage["wallMs"] = round((time.monotonic() - stage_start) * 1000)
                stage["finishedAt"] = utc_now()
                save()
        receipt["constantRefresh"] = {"status": "skipped"}
        if "scripts" in earlier:
            refresh_start = time.monotonic()
            try:
                refreshed = stage_module(frozen_package_name, "scripts").refresh_constants(
                    donor, base, output, symbol_map=earlier["scripts"].get("symbolMap"))
                earlier["scripts"]["constantPorts"] = refreshed
                script_stage = next(s for s in receipt["stages"] if s["name"] == "scripts")
                script_stage["ledger"] = earlier["scripts"]
                script_dir = run_dir / "stage-reports" / "scripts"
                (script_dir / "stage-ledger.json").write_text(json.dumps(earlier["scripts"], indent=2,
                                                                  sort_keys=True, default=str) + "\n")
                report_path = output / "data/firered/scripts-port.json"
                receipt["constantRefresh"] = {"status": "passed", "wallMs": round((time.monotonic() - refresh_start) * 1000),
                                              "moduleSha256": frozen_modules["scripts"]["sha256"],
                                              "reportPath": str(report_path), "reportSha256": sha256(report_path),
                                              "aliasCount": len(refreshed.get("aliases", [])),
                                              "unresolvedCount": len(refreshed.get("unresolved", []))}
            except Exception as error:
                receipt["constantRefresh"] = {"status": "failed", "wallMs": round((time.monotonic() - refresh_start) * 1000),
                                              "error": str(error)}
                receipt["unresolved"].append({"id": "scripts.constant_refresh_failed", "owner": "scripts",
                                              "reason": str(error)})
        save()
        if len(receipt["stages"]) != len(stages):
            for missing in stages[len(receipt["stages"]):]:
                receipt["unresolved"].append({"id": f"{missing}.not_run", "owner": missing,
                                              "reason": "earlier stage failed"})
        for name, module_pin in frozen_modules.items():
            if module_pin and sha256(Path(module_pin["path"])) != module_pin["sha256"]:
                receipt["unresolved"].append({"id": f"{name}.frozen_source_changed", "owner": "build",
                                              "reason": "retained transform input changed during merge preparation"})
        if receipt["recipeSourcePins"]:
            for changed in changed_pins(receipt["recipeSourcePins"]):
                receipt["unresolved"].append({"id": "eclectic.recipe_source_changed", "owner": "eclectic",
                                              "reason": f"pinned recipe source changed: {changed}"})
        subprocess.run(["git", "-C", str(output), "add", "-A"], check=True)
        patch = subprocess.check_output(["git", "-C", str(output), "diff", "--cached",
                                         "--binary", "--no-renames", "HEAD"])
        patch_path = Path(receipt["outputPatchPath"])
        patch_path.write_bytes(patch)
        receipt["outputPatchSha256"] = sha256(patch_path)
        # Checking from the archive directory could discover the outer repo.
        patch_valid, patch_error = patch_applies_to_baseline(output, patch_path, run_dir)
        receipt["patchAppliesToPinnedBase"] = patch_valid
        if not patch_valid:
            receipt["unresolved"].append({"id": "merge.patch_not_applicable", "owner": "build",
                                          "reason": patch_error})
        receipt["outputTreeHash"] = git(output, "write-tree")
        receipt["changedFiles"] = changed_files(output)
        receipt["linkedPostconditions"], witness_blockers = linked_postconditions(
            output, receipt["changedFiles"], earlier.get("world_assets", {}), stages)
        receipt["unresolved"].extend(witness_blockers)
        # Emerald itself carries three original multiboot .gba source assets.
        # Only ROM payloads introduced or changed by this merge are external inputs.
        external_roms = [entry["path"] for entry in receipt["changedFiles"]
                         if entry["change"] == "present" and entry["path"].lower().endswith(".gba")]
        if external_roms:
            receipt["unresolved"].append({"id": "merge.external_rom_payload", "owner": "build",
                                          "reason": f"source merge adds or changes ROM payloads: {external_roms[:8]}"})
        if not receipt["changedFiles"]:
            receipt["unresolved"].append({"id": "merge.empty", "owner": "build",
                                          "reason": "staged merge changed no Emerald source files"})
        receipt["buildEligible"] = not receipt["unresolved"] and len(receipt["stages"]) == len(stages)
        receipt["status"] = "staged_ready" if receipt["buildEligible"] else "staged_blocked"
        development_ready = (args.operation == "build-development" and len(receipt["stages"]) == len(stages)
                             and all(s["status"] not in {"failed", "missing"} for s in receipt["stages"])
                             and receipt["constantRefresh"]["status"] == "passed")
        if args.operation in {"build", "build-development"} and (receipt["buildEligible"] or development_ready):
            if not receipt["changedFiles"]:
                raise RuntimeError("cannot compile an empty single-ROM patch")
            build_command = [sys.executable, str(ROOT / "tools/whole_game/build_sources.py"),
                             "--game", "emerald", "--patch", str(patch_path),
                             "--patch-sha256", receipt["outputPatchSha256"],
                             "--expected-tree-hash", receipt["outputTreeHash"],
                             "--jobs", str(args.jobs), "--timeout", str(args.timeout)]
            if args.operation == "build-development":
                build_command.append("--diagnostic-keep-going")
            if args.reuse_build_receipt:
                if sha256(args.reuse_build_receipt) != receipt["reuseBuildReceipt"]["sha256"]:
                    raise RuntimeError("reuse build receipt changed during source preparation")
                build_command += ["--reuse-build-receipt", str(args.reuse_build_receipt.resolve()),
                                  "--reuse-build-receipt-sha256", receipt["reuseBuildReceipt"]["sha256"]]
            build_start = time.monotonic()
            result = subprocess.run(build_command, capture_output=True, text=True, check=False)
            receipt["sourceBuildWallMs"] = round((time.monotonic() - build_start) * 1000)
            candidates = [line.strip() for line in result.stdout.splitlines() if line.strip().endswith("receipt.json")]
            if candidates:
                source_receipt_path = Path(candidates[-1])
                receipt["sourceBuildReceipt"] = {"path": str(source_receipt_path),
                                                 "sha256": sha256(source_receipt_path)}
                source_receipt = json.loads(source_receipt_path.read_text())
                receipt["compileErrors"] = source_receipt.get("compilerErrors", [])
                receipt["compileErrorsTotal"] = source_receipt.get("compilerErrorsTotal", len(receipt["compileErrors"]))
                receipt["compileErrorsTruncated"] = source_receipt.get("compilerErrorsTruncated", False)
                receipt["compileDiagnostics"] = diagnostic_owners(receipt["compileErrors"], receipt["stages"])
                if source_receipt.get("status") == "passed" and result.returncode == 0:
                    receipt["status"] = "built" if args.operation == "build" and receipt["buildEligible"] else "built_development"
                else:
                    receipt["status"] = "build_failed_development" if args.operation == "build-development" else "build_failed"
            else:
                receipt["status"] = "build_failed_development" if args.operation == "build-development" else "build_failed"
            if receipt["status"].startswith("build_failed"):
                receipt["buildError"] = result.stderr[-4000:]
        return 0 if args.operation == "prepare" or receipt["status"] in {"built", "built_development"} else 2
    except Exception as error:
        receipt["status"] = "failed"
        receipt["error"] = str(error)
        print(str(error), file=sys.stderr)
        return 1
    finally:
        receipt["finishedAt"] = utc_now()
        receipt["totalWallMs"] = round((time.monotonic() - start) * 1000)
        save()
        print(receipt_path)


if __name__ == "__main__":
    raise SystemExit(main())
