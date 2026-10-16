"""Decode bounded, observed BIOS LZ77 uses and compare post-HLE snapshots.

No ROM scanning: inputs are the capture's loaded_assets.jsonl records only.
All payload outputs must remain under ignored local/ or another local directory.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[3]
VERSION = 1


def decode_lz77(rom: bytes, offset: int, max_output: int, max_input: int) -> tuple[bytes, int]:
    """GBA 0x10 LZ77; return bytes and consumed input size, rejecting malformed runs."""
    if offset < 0 or offset + 4 > len(rom) or rom[offset] != 0x10:
        raise ValueError("invalid_lz77_header")
    length = int.from_bytes(rom[offset + 1:offset + 4], "little")
    if not 0 < length <= max_output:
        raise ValueError("output_limit_or_zero_length")
    cursor = offset + 4
    output = bytearray()

    def take(n):
        nonlocal cursor
        if cursor + n > len(rom) or cursor + n - offset > max_input:
            raise ValueError("input_limit_or_truncated_stream")
        value = rom[cursor:cursor + n]
        cursor += n
        return value

    while len(output) < length:
        flags = take(1)[0]
        for bit in range(7, -1, -1):
            if len(output) == length:
                break
            if flags & (1 << bit):
                pair = int.from_bytes(take(2), "big")
                count, distance = (pair >> 12) + 3, (pair & 0xFFF) + 1
                if distance > len(output):
                    raise ValueError("back_reference_precedes_output")
                if len(output) + count > length:
                    raise ValueError("run_exceeds_header_length")
                for _ in range(count):
                    output.append(output[-distance])
            else:
                output.extend(take(1))
    return bytes(output), cursor - offset


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--capture-root", type=Path, required=True)
    ap.add_argument("--out-root", type=Path, required=True)
    ap.add_argument("--ids", default="")
    ap.add_argument("--max-records", type=int, default=1024)
    ap.add_argument("--max-output-bytes", type=int, default=65536)
    ap.add_argument("--max-input-bytes", type=int, default=1048576)
    ap.add_argument("--max-total-output-bytes", type=int, default=16777216)
    ap.add_argument("--write-output", action="store_true")
    args = ap.parse_args()
    if not (0 < args.max_records <= 65536 and 0 < args.max_output_bytes <= 1048576
            and 0 < args.max_input_bytes <= 4194304 and 0 < args.max_total_output_bytes <= 268435456):
        ap.error("decode limits outside bounded supported ranges")
    args.out_root.mkdir(parents=True, exist_ok=True)
    roms = {r["id"]: r for r in json.loads((ROOT / "local/re/roms.json").read_text())}
    ids = args.ids.split(",") if args.ids else sorted(p.name for p in args.capture_root.iterdir() if p.name in roms)
    if set(ids) - set(roms):
        ap.error("unknown ROM IDs")
    started = time.perf_counter()
    report = {"decoder_version": VERSION, "recorded_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "capture_root": str(args.capture_root), "tool_sha256": sha(Path(__file__).read_bytes()),
              "limits": {k: v for k, v in vars(args).items() if k.startswith("max_")},
              "write_output": args.write_output, "decoded_unique_bytes": 0, "records": [], "games": [],
              "limitations": ["Only BIOS LZ77 calls reached by the retained scripts are represented.",
                              "Destination class is evidence of use location, not proof of tile, palette, story, audio or code content.",
                              "A post-HLE match verifies these output bytes at first recorded use, not later rendering or all repeated calls.",
                              "RLE, Huffman, software decompression and raw/DMA loads are outside this decoder."]}
    cache = {}
    seen_records = 0
    for gid in ids:
        game = {"id": gid, "outcome": "ok", "trace_files": []}
        report["games"].append(game)
        summary_file = args.capture_root / gid / "summary.json"
        if not summary_file.exists():
            game.update(outcome="missing_capture_summary")
            continue
        summary = json.loads(summary_file.read_text())
        rom_path = ROOT / "local/roms" / roms[gid]["file"]
        rom = rom_path.read_bytes()
        rom_sha1 = hashlib.sha1(rom).hexdigest()
        game.update(rom_sha1=rom_sha1, capture_run_id=summary.get("run_id"),
                    capture_summary_sha256=sha(summary_file.read_bytes()), capture_context=summary.get("context"))
        if rom_sha1 != summary.get("sha1") or rom_sha1 != roms[gid]["sha1"]:
            game.update(outcome="rom_identity_mismatch")
            continue
        for trace in sorted((args.capture_root / gid).glob("*/loaded_assets.jsonl")):
            raw = trace.read_bytes()
            game["trace_files"].append({"path": str(trace), "sha256": sha(raw)})
            for line_number, line in enumerate(raw.splitlines(), 1):
                if seen_records >= args.max_records:
                    game.update(outcome="record_limit")
                    break
                seen_records += 1
                event = json.loads(line)
                row = {"id": gid, "trace": str(trace), "line": line_number, "use": event,
                       "status": "unprocessed", "kind": "observed_compressed_payload_candidate"}
                report["records"].append(row)
                if not event.get("source_rom_valid") or not event.get("header_valid"):
                    row["status"] = "unsupported_source_or_header"
                    continue
                key = (rom_sha1, event["rom_offset"])
                try:
                    if key not in cache:
                        output, consumed = decode_lz77(rom, event["rom_offset"], args.max_output_bytes, args.max_input_bytes)
                        if report["decoded_unique_bytes"] + len(output) > args.max_total_output_bytes:
                            row["status"] = "total_output_limit"
                            continue
                        report["decoded_unique_bytes"] += len(output)
                        cache[key] = output, consumed
                    output, consumed = cache[key]
                    row.update(status="decoded", output_length=len(output), compressed_consumed_bytes=consumed,
                               output_sha256=sha(output), compressed_sha256=sha(rom[event["rom_offset"]:event["rom_offset"] + consumed]))
                    region = int(event["destination"], 16) >> 24
                    row["destination_class"] = {2: "ewram_working_memory", 3: "iwram_working_memory", 6: "video_memory"}.get(region, "other")
                    if args.write_output:
                        target = args.out_root / "decoded" / gid / (row["output_sha256"] + ".bin")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if not target.exists():
                            target.write_bytes(output)
                        row["output_file"] = str(target)
                    row["snapshot_comparison"] = "unavailable"
                    if event.get("snapshot_status") == "saved":
                        snapshot = (trace.parent / event["snapshot"]).resolve()
                        if snapshot.parent != trace.parent.resolve():
                            raise ValueError("snapshot_path_outside_phase")
                        if snapshot.stat().st_size > args.max_output_bytes:
                            raise ValueError("snapshot_exceeds_output_limit")
                        actual = snapshot.read_bytes()
                        row.update(snapshot_comparison="match" if actual == output else "mismatch",
                                   snapshot_sha256=sha(actual), snapshot_file=str(snapshot))
                except (ValueError, OSError) as error:
                    row.update(status="failed", error_type=type(error).__name__, error=str(error))
        if not game["trace_files"]:
            game.update(outcome="no_trace_files")
    report["wall_s"] = round(time.perf_counter() - started, 6)
    report["counts"] = {"records": len(report["records"]), "unique_decodes": len(cache),
                        "decoded": sum(r["status"] == "decoded" for r in report["records"]),
                        "snapshot_matches": sum(r.get("snapshot_comparison") == "match" for r in report["records"]),
                        "snapshot_mismatches": sum(r.get("snapshot_comparison") == "mismatch" for r in report["records"])}
    target = args.out_root / "loaded_asset_manifest.json"
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"manifest": str(target), "wall_s": report["wall_s"], **report["counts"]}))
    return int(any(g["outcome"] != "ok" for g in report["games"])
               or any(r["status"] == "failed" or r.get("snapshot_comparison") == "mismatch" for r in report["records"]))


if __name__ == "__main__":
    raise SystemExit(main())
