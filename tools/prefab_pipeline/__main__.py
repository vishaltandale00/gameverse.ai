"""Standalone registered native build and improvement entry point."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys


def read(path):
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError("expected JSON object")
    return value


def write(path, value, *, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x" if exclusive else "w") as stream:
        stream.write(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="command", required=True)
    for name in ("build-mod", "mod-rom", "iterate", "prepare-iteration", "run-profile", "continue-profile"):
        command = commands.add_parser(name)
        command.add_argument("--output", type=Path, required=True)
        if name != "continue-profile":
            command.add_argument("--request", type=Path, required=True)
        if name in ("prepare-iteration", "run-profile", "continue-profile"):
            command.add_argument("--template", type=Path, required=True)
            command.add_argument("--run-id", required=True)
        if name != "prepare-iteration":
            command.add_argument("--output-dir", type=Path, required=True)
        if name == "iterate":
            command.add_argument("--config", type=Path, required=True)
            command.add_argument("--resume", action="store_true")
        if name == "continue-profile":
            command.add_argument("--prior-report", type=Path, required=True)
            command.add_argument("--prior-report-sha256", required=True)
    return cli


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "build-mod":
            from .native_mod import build_native_mod_request
            result = build_native_mod_request(read(args.request), args.output_dir.resolve())
        elif args.command == "mod-rom":
            from .mod_rom import execute_mod_request
            result = execute_mod_request(read(args.request), args.output_dir.resolve())
        elif args.command == "prepare-iteration":
            from .iteration import prepare_iteration_config
            result = prepare_iteration_config(read(args.request), read(args.template), args.run_id)
        else:
            from .iteration import run_iteration
            if args.command == "iterate":
                request, config = read(args.request), read(args.config)
            else:
                if args.output_dir.exists() and any(args.output_dir.iterdir()):
                    raise ValueError("profile run requires a fresh output directory")
                if args.command == "run-profile":
                    from .iteration import prepare_iteration_config
                    request = read(args.request)
                    config = prepare_iteration_config(request, read(args.template), args.run_id)
                else:
                    from .iteration import prepare_continuation_config
                    config = prepare_continuation_config({"path": str(args.prior_report.resolve()), "sha256": args.prior_report_sha256}, read(args.template), args.run_id)
                    request = config.pop("continuation_request")
                write(args.output_dir / "prepared-config.json", config, exclusive=True)
            result = run_iteration(request, config, args.output_dir.resolve(), resume=getattr(args, "resume", False))
        write(args.output, result, exclusive=args.command == "prepare-iteration")
        status = result.get("status", "prepared")
        print(json.dumps({"status": status, "evidence": str(args.output.resolve())}))
        return 2 if status in {"blocked", "failed", "rejected", "error", "budget", "cancelled"} else 0
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        # Provider/adapter errors can contain sensitive response bodies. Durable
        # stage diagnostics carry safe local details; CLI only identifies class.
        result = {"schema": "gameverse.prefab-cli-error/1", "status": "failed", "error_type": type(error).__name__}
        if type(error).__module__ == "tools.prefab_pipeline.iteration" and type(error).__name__ == "IterationError":
            result["error_code"] = str(error)
        if not (args.command == "prepare-iteration" and isinstance(error, FileExistsError)):
            write(args.output, result)
        print(json.dumps(result), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
