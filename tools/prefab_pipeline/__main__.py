"""Command-line entry point; implementation lives in the pipeline modules."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def _read(path: Path) -> dict:
    result = json.loads(path.read_text())
    if not isinstance(result, dict):
        raise ValueError(f"expected JSON object: {path}")
    return result


def _write(path: Path, result: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Extract pinned prefabs, plan composition, and execute registered backends.")
    commands = result.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract", help="Inspect existing evidence; no compilation or native execution")
    extract.add_argument("--root", type=Path, default=Path.cwd())
    extract.add_argument("--game", action="append", required=True)
    extract.add_argument("--memory-manifest", action="append", default=[], help="Repository-relative pinned private memory ontology")
    extract.add_argument("--memory-index", action="append", default=[], help="Bounded producer index with pinned memory_manifest_refs")
    extract.add_argument("--source-receipt", type=Path, action="append", default=[])
    extract.add_argument("--cache-dir", type=Path, required=True)
    extract.add_argument("--max-files", type=_positive_int, default=4096)
    extract.add_argument("--max-bytes", type=_positive_int, default=67108864)
    extract.add_argument("--max-requests", type=_positive_int, default=16)
    extract.add_argument("--output", type=Path, required=True)
    plan = commands.add_parser("plan", help="Validate a request and record executable blockers")
    plan.add_argument("--root", type=Path, default=Path.cwd())
    plan.add_argument("--request", type=Path, required=True)
    plan.add_argument("--extraction", type=Path, help="Use candidates from this extraction report as request prefabs")
    plan.add_argument("--output", type=Path, required=True)
    execute = commands.add_parser("execute", help="Run a registered backend with its recorded bounds")
    execute.add_argument("--plan", type=Path, required=True)
    execute.add_argument("--output-dir", type=Path, required=True)
    execute.add_argument("--output", type=Path, required=True)
    execute.add_argument("--allow-execute", action="store_true", help="Explicitly permit the bounded backend subprocess")
    mod = commands.add_parser("mod-rom", help="Apply a supported request through qualified IR to a full original ROM")
    mod.add_argument("--request", type=Path, required=True)
    mod.add_argument("--output-dir", type=Path, required=True)
    mod.add_argument("--output", type=Path, required=True)
    build_mod = commands.add_parser("build-mod", help="Build a supported native prefab candidate for immediate decision experiments")
    build_mod.add_argument("--request", type=Path, required=True)
    build_mod.add_argument("--output-dir", type=Path, required=True)
    build_mod.add_argument("--output", type=Path, required=True)
    iterate = commands.add_parser("iterate", help="Run a bounded build/decision/diagnosis/repair loop with checkpoints")
    iterate.add_argument("--request", type=Path, required=True)
    iterate.add_argument("--config", type=Path, required=True)
    iterate.add_argument("--output-dir", type=Path, required=True)
    iterate.add_argument("--output", type=Path, required=True)
    iterate.add_argument("--resume", action="store_true", help="Resume from the attempt directory's recorded checkpoint")
    phase = commands.add_parser("phase-extend", help="Extend a pinned prefab graph through its explicit lifecycle adapter")
    phase.add_argument("--request", type=Path, required=True)
    phase.add_argument("--output-dir", type=Path, required=True)
    phase.add_argument("--output", type=Path, required=True)
    prepare = commands.add_parser("prepare-iteration", help="Prepare a fresh pinned iteration configuration without building or calling a model")
    prepare.add_argument("--request", type=Path, required=True)
    prepare.add_argument("--template", type=Path, required=True)
    prepare.add_argument("--run-id", required=True)
    prepare.add_argument("--output", type=Path, required=True)
    query = commands.add_parser("memory-query", help="Inspect discovered memory regions and declared dependents")
    query.add_argument("--extraction", type=Path, required=True)
    query.add_argument("--game")
    query.add_argument("--node")
    query.add_argument("--uncategorized", action="store_true")
    query.add_argument("--output", type=Path, required=True)
    properties = commands.add_parser("property-plan", help="Emit a pinned property compiler request without editing ROM")
    properties.add_argument("--extraction", type=Path, required=True)
    properties.add_argument("--game")
    properties.add_argument("--root", type=Path, default=Path.cwd())
    properties.add_argument("--rom", type=Path, required=True, help="Exact baseline ROM path for the emitted compiler command")
    properties.add_argument("--table", required=True)
    properties.add_argument("--operations", type=Path, required=True, help="JSON object containing operations list")
    properties.add_argument("--output", type=Path, required=True)
    composition_import = commands.add_parser("composition-import", help="Import pinned extraction into canonical whole-game composition DSL")
    composition_import.add_argument("--extraction", type=Path, required=True)
    composition_import.add_argument("--partition", type=Path, required=True)
    composition_import.add_argument("--game", required=True)
    composition_import.add_argument("--memory-sha256")
    composition_import.add_argument("--root", type=Path, default=Path.cwd())
    composition_import.add_argument("--output", type=Path, required=True)
    composition_query = commands.add_parser("composition-query", help="Inspect nodes and bounded static candidate compatibility")
    composition_query.add_argument("--game-dsl", type=Path, required=True)
    composition_query.add_argument("--node")
    composition_query.add_argument("--kind")
    composition_query.add_argument("--search")
    composition_query.add_argument("--candidates", type=Path)
    composition_query.add_argument("--candidate-memory", type=Path)
    composition_query.add_argument("--candidate-table")
    composition_query.add_argument("--max-candidates", type=_positive_int, default=128)
    composition_query.add_argument("--output", type=Path, required=True)
    composition_plan = commands.add_parser("composition-plan", help="Consume a pinned DSL request through the fail-fast static gate")
    composition_plan.add_argument("--game-dsl", type=Path, required=True)
    composition_plan.add_argument("--partition", type=Path, required=True)
    plan_input = composition_plan.add_mutually_exclusive_group(required=True)
    plan_input.add_argument("--request", type=Path)
    plan_input.add_argument("--candidate-memory", type=Path)
    composition_plan.add_argument("--root", type=Path, default=Path.cwd())
    composition_plan.add_argument("--target")
    composition_plan.add_argument("--candidate-table")
    composition_plan.add_argument("--output", type=Path, required=True)
    for name in ("run-profile", "continue-profile"):
        profile = commands.add_parser(name)
        profile.add_argument("--output", type=Path, required=True)
        profile.add_argument("--output-dir", type=Path, required=True)
        profile.add_argument("--template", type=Path, required=True)
        profile.add_argument("--run-id", required=True)
        if name == "run-profile":
            profile.add_argument("--request", type=Path, required=True)
        else:
            profile.add_argument("--prior-report", type=Path, required=True)
            profile.add_argument("--prior-report-sha256", required=True)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "prepare-iteration" and args.output.exists():
        print(json.dumps({"status": "failed", "error": "prepared configuration output already exists; use a fresh path"}), file=sys.stderr)
        return 2
    try:
        if args.command == "extract":
            from .extraction import extract
            result = extract(root=args.root.resolve(), game_ids=args.game,
                             cache_dir=args.cache_dir.resolve(),
                             limits={"max_files": args.max_files, "max_bytes": args.max_bytes,
                                     "max_requests": args.max_requests},
                             source_receipts=[str(path) for path in args.source_receipt], memory_manifests=args.memory_manifest, memory_indexes=args.memory_index)
        elif args.command in ("memory-query", "property-plan"):
            from .memory_index import query_memory, property_plan
            extraction = _read(args.extraction)
            if extraction.get("schema") != "gameverse.prefab-extraction/1":
                raise ValueError("unsupported extraction schema")
            if args.command == "memory-query":
                result = query_memory(extraction, args.game, args.node, args.uncategorized)
            else:
                result = property_plan(extraction, args.table, _read(args.operations)["operations"], args.game)
                from .contract import verify_file_ref
                if not verify_file_ref(result["manifest_ref"], args.root.resolve()):
                    raise ValueError("memory manifest changed since extraction")
                request_path = args.output.resolve().with_suffix(".request.json")
                if request_path == args.output.resolve():
                    raise ValueError("plan and compiler request paths must differ")
                _write(request_path, result["request"])
                artifact_dir = args.output.resolve().with_suffix(".artifacts")
                result["request_ref"] = {"path": str(request_path), "sha256": hashlib.sha256(request_path.read_bytes()).hexdigest()}
                result["compiler_argv"] = [sys.executable, "-B", "-m", "tools.roundtrip.memory_ontology",
                    "--manifest", str(args.root.resolve() / result["manifest_ref"]["path"]),
                    "--rom", str(args.rom.resolve()), "--request", str(request_path), "--output", str(artifact_dir)]
        elif args.command == "composition-import":
            from .composition_cli import import_extraction, file_ref
            result = import_extraction(_read(args.extraction), _read(args.partition), args.game,
                                       args.root, file_ref(args.partition), args.memory_sha256)
        elif args.command in ("composition-query", "composition-plan"):
            from .composition_cli import query_composition, plan_composition_request, memory_candidate_document, canonical_hash
            document = _read(args.game_dsl)
            game = document.get("game", document)
            if args.command == "composition-query":
                candidates = _read(args.candidates) if args.candidates else None
                if candidates:
                    candidates = candidates.get("game", candidates)
                if args.candidate_memory:
                    if candidates:
                        raise ValueError("use either --candidates or --candidate-memory")
                    candidates = memory_candidate_document(args.candidate_memory, args.candidate_table)
                result = query_composition(game, args.node, args.kind, args.search, candidates, args.max_candidates)
            else:
                if args.candidate_memory:
                    if not args.target:
                        raise ValueError("--candidate-memory requires --target")
                    candidate = memory_candidate_document(args.candidate_memory, args.candidate_table or args.target.removeprefix("table:"))
                    if len(candidate["nodes"]) != 1:
                        raise ValueError("candidate memory must select exactly one table")
                    request = {"schema": "gameverse.composition-request/1", "game_sha256": canonical_hash(game),
                               "substitutions": [{"target": args.target, "candidate": candidate["nodes"][0]}], "max_candidates": 1}
                else:
                    request = _read(args.request)
                result = plan_composition_request(game, _read(args.partition), request, args.root.resolve())
                result["request"] = request
        elif args.command == "plan":
            from .composition import plan_composition
            request = _read(args.request)
            if args.extraction:
                if "prefabs" in request:
                    raise ValueError("request already has prefabs; omit --extraction or remove prefabs")
                extraction = _read(args.extraction)
                if extraction.get("schema") != "gameverse.prefab-extraction/1":
                    raise ValueError("unsupported extraction schema")
                request["prefabs"] = extraction["candidates"]
            result = plan_composition(request, root=args.root.resolve(), verify_files=True)
        elif args.command == "execute":
            if not args.allow_execute:
                raise ValueError("execution requires --allow-execute")
            from .backends import execute_backend
            plan = _read(args.plan)
            if plan.get("schema") != "gameverse.prefab-composition-plan/1":
                raise ValueError("unsupported composition plan schema")
            if not plan.get("preparation_allowed") and not plan.get("executable_ready"):
                raise ValueError("plan has no admissible registered backend")
            if not plan.get("backend_plan"):
                raise ValueError("plan has no backend plan")
            if plan["backend_plan"].get("mode") != "prepare" and not plan.get("executable_ready"):
                raise ValueError("qualified build requires an executable-ready composition plan")
            result = execute_backend(plan["backend_plan"], args.output_dir.resolve())
        elif args.command == "mod-rom":
            from .mod_rom import execute_mod_request
            result = execute_mod_request(_read(args.request), args.output_dir.resolve())
        elif args.command == "build-mod":
            from .native_mod import build_native_mod_request
            result = build_native_mod_request(_read(args.request), args.output_dir.resolve())
        elif args.command in ("run-profile", "continue-profile"):
            from .iteration import run_iteration, prepare_iteration_config, prepare_continuation_config
            if args.output_dir.exists() and any(args.output_dir.iterdir()):
                raise ValueError("profile run requires a fresh output directory")
            if args.command == "run-profile":
                request = _read(args.request)
                config = prepare_iteration_config(request, _read(args.template), args.run_id)
            else:
                config = prepare_continuation_config({"path": str(args.prior_report.resolve()), "sha256": args.prior_report_sha256}, _read(args.template), args.run_id)
                request = config.pop("continuation_request")
            args.output_dir.mkdir(parents=True, exist_ok=True)
            with (args.output_dir / "prepared-config.json").open("x") as prepared:
                prepared.write(json.dumps(config, indent=2, sort_keys=True, allow_nan=False) + "\n")
            result = run_iteration(request, config, args.output_dir.resolve())
        elif args.command == "iterate":
            from .iteration import run_iteration
            result = run_iteration(_read(args.request), _read(args.config),
                                   args.output_dir.resolve(), resume=args.resume)
        elif args.command == "phase-extend":
            from .phase_extension import extend_phase_request
            result = extend_phase_request(_read(args.request), args.output_dir.resolve())
        else:
            from .iteration import prepare_iteration_config
            result = prepare_iteration_config(_read(args.request), _read(args.template), args.run_id)
        if args.command == "prepare-iteration":
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x") as prepared:
                prepared.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
        else:
            _write(args.output, result)
        display_status = result.get("status") or ("prepared" if args.command == "prepare-iteration" else None)
        print(json.dumps({"status": display_status, "evidence": str(args.output.resolve())}, sort_keys=True))
        return 2 if result.get("status") in {"blocked", "failed", "rejected", "error", "budget", "cancelled"} else 0
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        # Provider/adapter errors may contain sensitive response bodies.
        result = {"schema": "gameverse.prefab-cli-error/1", "status": "failed", "error_type": type(error).__name__}
        if type(error).__module__ == "tools.prefab_pipeline.iteration" and type(error).__name__ == "IterationError":
            result["error_code"] = str(error)
        if args.command in ("extract", "plan", "execute", "phase-extend", "memory-query", "property-plan", "composition-import", "composition-query", "composition-plan"):
            result["error"] = str(error)
        if isinstance(error, subprocess.TimeoutExpired):
            result["error"] = "backend timed out"
        if hasattr(args, "output_dir"):
            result["attempt_directory"] = str(args.output_dir.resolve())
        if not (args.command == "prepare-iteration" and isinstance(error, FileExistsError)):
            _write(args.output, result)
        print(json.dumps(result, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
