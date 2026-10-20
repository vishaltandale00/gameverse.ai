"""Bounded extract → artifact-only reassembly → original comparison command."""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import time
import uuid
from .extract import extract
from .reassemble import reassemble


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="operation", required=True)
    for operation in ("extract", "roundtrip", "mzm-source-roundtrip"):
        command = subs.add_parser(operation)
        command.add_argument("--source", required=True)
        command.add_argument("--output", required=True)
        command.add_argument("--game-id", required=True)
        command.add_argument("--profile")
        command.add_argument("--chunk-bytes", type=int, default=1024 * 1024)
        if operation == "mzm-source-roundtrip":
            command.add_argument("--source-tree", required=True)
    command = subs.add_parser("reassemble")
    command.add_argument("--manifest", required=True)
    command.add_argument("--output", required=True)
    command.add_argument("--layout")
    command = subs.add_parser("elf-roundtrip")
    command.add_argument("--provider-profile", required=True)
    command.add_argument("--output", required=True)
    args = parser.parse_args()
    start = time.perf_counter()
    if args.operation == "reassemble":
        layout = reassemble(args.manifest, args.output, args.layout)
        print(json.dumps({"sha256": layout["artifactSha256"], "size": layout["artifact"]["size"]}))
        return
    profile = getattr(args, "profile", None)
    build_receipt = None
    provider_receipt = None
    if args.operation == "elf-roundtrip":
        from .elf_provider import prepare_elf_profile
        profile, provider_receipt = prepare_elf_profile(args.provider_profile, Path(args.output + "-elf-provider"))
        args.source = provider_receipt["original"]["path"]
        args.game_id = provider_receipt["game_id"]
        args.chunk_bytes = 1024 * 1024
    if args.operation == "mzm-source-roundtrip":
        from .source_provider import regenerate_mzm
        profile, build_receipt = regenerate_mzm(args.source_tree, args.source, Path(args.output + "-source-provider"))
    build_finished = time.perf_counter()
    manifest = extract(args.source, args.output, args.game_id, profile, args.chunk_bytes)
    extracted = time.perf_counter()
    output = Path(args.output)
    if args.operation == "extract":
        print(str(output / "manifest.json"))
        return
    layout = reassemble(output / "manifest.json", output / "rebuilt.gba", output / "layout.json")
    assembled = time.perf_counter()
    from tools.prefab_pipeline.reconstruction_compare import compare_reconstruction
    report = compare_reconstruction(Path(args.source).read_bytes(), (output / "rebuilt.gba").read_bytes(), manifest, rebuilt_layout=layout)
    with (output / "comparison.json").open("x") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip() or None
    timing = {"schema": "gameverse.rom-roundtrip-timing/1", "run_id": str(uuid.uuid4()), "source_commit": commit,
              "source_sha256": manifest["original"]["sha256"], "profile_sha256": manifest["provenance"]["profile_sha256"],
              "game_id": args.game_id, "environment": {"platform": platform.platform(), "python": platform.python_version()},
              "mode": "extracted-artifact-reconstruction", "cache": "unavailable", "queue_seconds": None,
              "build_seconds": build_receipt["build_seconds"] if build_receipt else None,
              "build_receipt": str(Path(args.output + "-source-provider/build-receipt.json")) if build_receipt else None,
              "provider_seconds": provider_receipt["provider_seconds"] if provider_receipt else None,
              "provider_receipt": str(Path(args.output + "-elf-provider/provider-receipt.json")) if provider_receipt else None,
              "simulation_seconds": None, "evaluation_seconds": time.perf_counter() - assembled,
              "extraction_seconds": extracted - build_finished, "reassembly_seconds": assembled - extracted,
              "total_seconds": time.perf_counter() - start, "attempts": 1, "repairs": 0,
              "outcome": report.get("status"), "nested_stages": "total includes optional source provider, extraction, reassembly and comparison; build is nested within optional source provider"}
    with (output / "timing.json").open("x") as stream:
        json.dump(timing, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps({"output": str(output), "status": report.get("status"), "total_seconds": timing["total_seconds"]}))
    if report.get("status") not in ("pass", "passed"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
