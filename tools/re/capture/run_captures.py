"""Run the GBA capture harness over the ROM set and aggregate results.

Usage (from the repo root):
  make -C tools/re/capture
  python3 tools/re/capture/run_captures.py [--jobs 8] [--ids id1,id2] [--harness-args "--mp4"]

Reads local/re/roms.json, expands tools/re/capture/scripts/{default,<id>}.json
into harness input specs, runs one harness process per ROM (N in parallel),
writes local/captures/<id>/summary.json, local/captures/index.json and appends
a run record to local/captures/runs.jsonl (failures included).
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
HARNESS = HERE / "build" / "gba-capture"
SCRIPTS = HERE / "scripts"
FPS = 59.7275
GROUPS = ["dispcnt_bgcnt", "bg_scroll", "bg_affine", "window", "mosaic", "blend", "palette", "other"]
# A raster flag needs >= HDMA_MIN_FRAMES frames in which that register group was
# rewritten on >= 32 visible scanlines (HBlank DMA) / >= 4 scanlines (CPU, mid-frame).
HDMA_MIN_FRAMES = 10
CPU_RASTER_MIN_FRAMES = 10


def sh(cmd):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return (result.stdout.strip() or None) if result.returncode == 0 else None
    except Exception:
        return None


def context():
    src = hashlib.sha1()
    for p in sorted([HERE / "capture.c", HERE / "Makefile", HERE / "run_captures.py", *SCRIPTS.glob("*.json")]):
        src.update(p.name.encode())
        src.update(p.read_bytes())
    ver = json.loads(sh([str(HARNESS), "--version"]) or "{}")
    dirty = sh(["git", "-C", str(REPO), "status", "--porcelain", "--", "tools/re/capture"])
    memory = sh(["sysctl", "-n", "hw.memsize"])
    return {
        "source_commit": sh(["git", "-C", str(REPO), "rev-parse", "HEAD"]),
        "capture_tree_dirty": bool(dirty),
        "harness": {
            "version": ver.get("harness_version"),
            "binary_src_sha1": ver.get("harness_src_sha1"),
            "tree_sha1": src.hexdigest()[:12],
        },
        "libmgba": {"version": ver.get("libmgba_version"), "git": ver.get("libmgba_git"),
                    "path": "/opt/homebrew/lib/libmgba.dylib", "bios": "mGBA HLE BIOS, skip-BIOS boot"},
        "machine": {
            "cpu": sh(["sysctl", "-n", "machdep.cpu.brand_string"]),
            "model": sh(["sysctl", "-n", "hw.model"]),
            "logical_cpus": os.cpu_count(),
            "memory_bytes": int(memory) if memory is not None else None,
            "os": f"{platform.system()} {platform.release()} ({sh(['sw_vers', '-productVersion'])})",
            "compiler": (sh(["cc", "--version"]) or "").splitlines()[0:1],
            "python": platform.python_version(),
        },
    }


def load_script(rom_id):
    base = json.loads((SCRIPTS / "default.json").read_text())
    templates = dict(base.get("templates", {}))
    phases = {p["name"]: p for p in base["phases"]}
    order = [p["name"] for p in base["phases"]]
    override = SCRIPTS / f"{rom_id}.json"
    used = ["default.json"]
    if override.exists():
        ov = json.loads(override.read_text())
        templates.update(ov.get("templates", {}))
        for p in ov.get("phases", []):
            if p["name"] not in phases:
                order.append(p["name"])
            phases[p["name"]] = {**phases.get(p["name"], {}), **p}
        used.append(override.name)
    for p in phases.values():
        p["_templates"] = templates
    return [phases[n] for n in order], used


def expand(phase):
    """Expand a phase into the harness input spec.

    A phase has explicit `events` ({frame, keys, hold}) and `repeat`, which is
    one block or a list of blocks ({from_frame, until_frame, period_frames,
    events | template}). Each block event has an `offset`. Named templates come
    from the `templates` maps in default.json and <id>.json.
    """
    frames = int(phase["frames"])
    templates = phase.get("_templates", {})
    events = [(int(e["frame"]), int(e.get("hold", 6)), e["keys"]) for e in phase.get("events", [])]
    reps = phase.get("repeat") or []
    if isinstance(reps, dict):
        reps = [reps]
    for rep in reps:
        rep_events = rep["events"] if "events" in rep else templates[rep["template"]]["events"]
        period = int(rep.get("period_frames") or templates[rep["template"]]["period_frames"])
        f = int(rep.get("from_frame", 0))
        until = min(int(rep.get("until_frame", frames)), frames)
        while f < until:
            for e in rep_events:
                if f + int(e["offset"]) < until:
                    events.append((f + int(e["offset"]), int(e.get("hold", 6)), e["keys"]))
            f += period
    events.sort()
    return frames, ",".join(f"{f}:{h}:{'+'.join(k)}" for f, h, k in events) or "-"


def derive(phases):
    """Short derived summary across phases (frame counts summed)."""
    modes, flags = {}, {}
    swi, max_vis, max_aff = {}, 0, 0
    raster = {g: {"hdma_frames_ge32": 0, "cpu_frames": 0} for g in GROUPS}
    blend = {"alpha": 0, "brighten": 0, "darken": 0}
    ds_rates, psg_trig, psg_play, ds = {}, [0] * 4, [0] * 4, {"A": 0, "B": 0}
    tot = {k: 0 for k in ["affine_bg_frames", "affine_bg_transformed_frames", "obj_affine_frames", "mosaic_frames",
                          "win0_frames", "win1_frames", "objwin_frames", "bitmap_page_flips"]}
    irq = {"hblank_irq_frames": 0, "vcount_irq_frames": 0}
    wav_s, hdma_cfg = 0.0, set()
    for p in phases:
        v, r, s = p["video"], p["raster"], p["sound"]
        for m, n in enumerate(v["mode_frames"]):
            if n:
                modes[m] = modes.get(m, 0) + n
        max_vis = max(max_vis, v["max_obj_visible"])
        max_aff = max(max_aff, v["max_obj_affine"])
        for k in tot:
            tot[k] += v[k]
        for k in blend:
            blend[k] += v["blend_frames"][k]
        for k in irq:
            irq[k] += r[k]
        for g in GROUPS:
            raster[g]["hdma_frames_ge32"] += r["groups"][g]["hdma_frames_ge32_lines"]
            raster[g]["cpu_frames"] += r["groups"][g]["cpu_midframe_frames"]
        for c in r["dma_configs"]:
            if c["timing"] == "hblank":
                hdma_cfg.add((c["ch"], c["dst"], c["dst_group"]))
        for k, n in p["swi"]["counts"].items():
            if "mgba_hle_internal" not in k:
                swi[k] = swi.get(k, 0) + n
        for k in ds:
            ds[k] += s["directsound_frames"][k]
        for hz, n in s["directsound_rates_hz"].items():
            ds_rates[int(hz)] = ds_rates.get(int(hz), 0) + n
        for i in range(4):
            psg_trig[i] += s["psg_triggers"][i]
            psg_play[i] += s["psg_playing_frames"][i]
        wav_s += s["wav"]["duration_s"]
    hdma = {g: raster[g]["hdma_frames_ge32"] >= HDMA_MIN_FRAMES for g in GROUPS}
    cpur = {g: raster[g]["cpu_frames"] >= CPU_RASTER_MIN_FRAMES for g in GROUPS}
    flags = {
        "bitmap_mode": any(m in modes for m in (3, 4, 5)),
        "bitmap_page_flipping": tot["bitmap_page_flips"] > 10,
        "affine_bg": tot["affine_bg_frames"] > 0,
        "affine_bg_transformed": tot["affine_bg_transformed_frames"] > 0,
        "affine_obj": tot["obj_affine_frames"] > 0,
        "hdma_line_scroll": hdma["bg_scroll"],
        "hdma_per_line_affine": hdma["bg_affine"],
        "hdma_window_shape": hdma["window"],
        "hdma_palette_gradient": hdma["palette"],
        "hdma_blend": hdma["blend"],
        "hdma_bg_control": hdma["dispcnt_bgcnt"],
        "cpu_raster_scroll": cpur["bg_scroll"],
        "cpu_raster_affine": cpur["bg_affine"],
        "cpu_raster_window": cpur["window"],
        "cpu_raster_palette": cpur["palette"],
        "cpu_raster_blend": cpur["blend"],
        "cpu_raster_bg_control": cpur["dispcnt_bgcnt"],
        "hblank_irq": irq["hblank_irq_frames"] > 0,
        "vcount_irq": irq["vcount_irq_frames"] > 0,
        "alpha_blend": blend["alpha"] > 0,
        "brightness_fade": blend["brighten"] + blend["darken"] > 0,
        "mosaic": tot["mosaic_frames"] > 0,
        "windows": tot["win0_frames"] + tot["win1_frames"] > 0,
        "obj_window": tot["objwin_frames"] > 0,
        "directsound": ds["A"] + ds["B"] > 0,
        "psg": any(psg_trig) or any(psg_play),
    }
    flags["any_raster"] = any(v for k, v in flags.items() if k.startswith(("hdma_", "cpu_raster_")))
    return {
        "video_modes_frames": {str(k): v for k, v in sorted(modes.items())},
        "max_sprites_visible": max_vis,
        "max_affine_sprites": max_aff,
        "flags": flags,
        "raster_frames": raster,
        "hblank_dma_targets": sorted({f"ch{c}->{d} ({g})" for c, d, g in hdma_cfg}),
        "sound": {
            "directsound_frames": ds,
            "directsound_rates_hz": dict(sorted(ds_rates.items(), key=lambda kv: -kv[1])),
            "psg_channels_triggered": [i + 1 for i in range(4) if psg_trig[i]],
            "psg_playing_frames": psg_play,
            "wav_duration_s": round(wav_s, 3),
        },
        "swi_top10": sorted(swi.items(), key=lambda kv: -kv[1])[:10],
        "thresholds": {"hdma_min_frames_ge32_lines": HDMA_MIN_FRAMES, "cpu_raster_min_frames_ge4_lines": CPU_RASTER_MIN_FRAMES},
    }


def coverage_union(out_dir, phase_names):
    funcs, blocks, uniq = set(), set(), 0
    for n in phase_names:
        p = out_dir / n / "coverage.json"
        if not p.exists():
            continue
        c = json.loads(p.read_text())
        for region in c["regions"].values():
            funcs.update(f[0] for f in region["functions"])
            blocks.update(b[0] for b in region["blocks"])
    rom_funcs = sum(1 for f in funcs if f.startswith("0x08"))
    return {"call_targets_union": len(funcs), "rom_call_targets_union": rom_funcs, "block_starts_union": len(blocks)}


def run_rom(rom, ctx, args, out_root):
    rid = rom["id"]
    out_dir = out_root / rid
    out_dir.mkdir(parents=True, exist_ok=True)
    phases, scripts_used = load_script(rid)
    cmd = [str(HARNESS), "--rom", str(REPO / "local" / "roms" / rom["file"]), "--out", str(out_dir)]
    cmd += args.harness_args.split() if args.harness_args else []
    cmd += ["--asset-trace-limit", str(args.asset_trace_limit),
            "--asset-snapshot-max-bytes", str(args.asset_snapshot_max_bytes)]
    input_phases = []
    for p in phases:
        frames, spec = expand(p)
        input_phases.append({"name": p["name"], "frames": frames, "inputs": spec,
                             "inputs_sha256": hashlib.sha256(spec.encode()).hexdigest()})
        cmd += ["--phase", p["name"], "--frames", str(frames), "--inputs", spec]
    t0 = time.time()
    start = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    outcome, error = "ok", None
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout)
        (out_dir / "capture.log").write_text(proc.stdout + proc.stderr)
        if proc.returncode != 0:
            outcome, error = "failed", f"harness exit {proc.returncode}: {proc.stderr.strip()[-500:]}"
    except subprocess.TimeoutExpired:
        outcome, error = "timeout", f"exceeded {args.timeout}s"
    wall = time.time() - t0
    phase_data, phase_errors = [], []
    spec_by_name = {p["name"]: p for p in phases}
    for p in phases:
        pj = out_dir / p["name"] / "phase.json"
        if pj.exists():
            d = json.loads(pj.read_text())
            phase_data.append(d)
            phase_errors += d.get("errors", [])
        else:
            outcome = "failed" if outcome == "ok" else outcome
            error = (error or "") + f" missing {p['name']}/phase.json"
    if outcome == "ok" and phase_errors:
        outcome = "ok_with_emulator_errors"
    summary = {
        "id": rid,
        "sha1": rom["sha1"],
        "title": rom["title"],
        "game_code": rom["game_code"],
        "run_id": args.run_id,
        "started_at": start,
        "outcome": outcome,
        "error": error,
        "wall_s": round(wall, 3),
        "scripts": scripts_used,
        "script_sha256": {name: hashlib.sha256((SCRIPTS / name).read_bytes()).hexdigest()
                          for name in scripts_used},
        "input_phases": input_phases,
        "asset_trace_config": {"entry_limit_per_phase": args.asset_trace_limit,
                               "snapshot_max_bytes_per_entry": args.asset_snapshot_max_bytes},
        "phases": [
            {
                "name": d["phase"],
                "frames": d["frames"],
                "emulated_s": round(d["frames"] / FPS, 2),
                "wall_s": d["timing"]["wall_s"],
                "emulated_fps": d["timing"]["emulated_fps"],
                "capture_overhead_s": d["timing"]["capture_overhead_s"],
                "keyframes": d["video"]["keyframes"],
                "wav": d["sound"]["wav"],
                "audio_flags": {
                    "directsound_A": d["sound"]["directsound_frames"]["A"] > 0,
                    "directsound_B": d["sound"]["directsound_frames"]["B"] > 0,
                    "directsound_rates_hz": d["sound"]["directsound_rates_hz"],
                    "psg_channels_triggered": [i + 1 for i, n in enumerate(d["sound"]["psg_triggers"]) if n],
                    "silent": d["sound"]["wav"]["peak"] == 0,
                },
                "coverage": d.get("coverage"),
                "asset_trace": d.get("asset_trace"),
                "log_counts": d["log_counts"],
                "errors": d["errors"],
                "detail": f"{d['phase']}/phase.json",
                # Frame where player-controlled play begins, set by hand in the script after checking keyframes.
                "play_starts_frame": spec_by_name.get(d["phase"], {}).get("play_starts_frame"),
                "gameplay_s": (round((d["frames"] - spec_by_name[d["phase"]]["play_starts_frame"]) / FPS, 1)
                               if spec_by_name.get(d["phase"], {}).get("play_starts_frame") is not None else None),
            }
            for d in phase_data
        ],
        "frames_emulated": sum(d["frames"] for d in phase_data),
        "derived": derive(phase_data) if phase_data else None,
        "coverage_union": coverage_union(out_dir, [d["phase"] for d in phase_data]),
        "context": ctx,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(f"[{outcome}] {rid} {wall:.1f}s", flush=True)
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--ids", default="")
    ap.add_argument("--out", default=str(REPO / "local" / "captures"))
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--harness-args", default="")
    ap.add_argument("--asset-trace-limit", type=int, default=64,
                    help="maximum unique BIOS LZ77 uses per phase; 0 disables (default64, max4096)")
    ap.add_argument("--asset-snapshot-max-bytes", type=int, default=0,
                    help="optional post-HLE snapshot cap per entry; default0 disables, max1048576")
    ap.add_argument("--no-index", action="store_true", help="do not rewrite index.json (still appends runs.jsonl)")
    args = ap.parse_args()
    if not 0 <= args.asset_trace_limit <= 4096 or not 0 <= args.asset_snapshot_max_bytes <= 1048576:
        ap.error("asset trace/snapshot limits outside supported bounds")
    if not HARNESS.exists():
        sys.exit(f"harness not built: make -C {HERE.relative_to(REPO)}")
    roms = json.loads((REPO / "local" / "re" / "roms.json").read_text())
    if args.ids:
        want = set(args.ids.split(","))
        roms = [r for r in roms if r["id"] in want]
        missing = want - {r["id"] for r in roms}
        if missing:
            sys.exit(f"unknown ids: {sorted(missing)}")
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    args.run_id = dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
    ctx = context()
    started = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    t0 = time.time()
    summaries = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(run_rom, r, ctx, args, out_root): r for r in roms}
        for f in cf.as_completed(futs):
            try:
                summaries.append(f.result())
            except Exception as e:  # runner bug: still record the ROM as failed
                r = futs[f]
                summaries.append({"id": r["id"], "sha1": r["sha1"], "outcome": "runner_error", "error": repr(e)})
                print(f"[runner_error] {r['id']}: {e!r}", flush=True)
    total = time.time() - t0
    summaries.sort(key=lambda s: s["id"])
    durations = {s["id"]: s.get("wall_s") for s in summaries}
    ok_d = [d for d in durations.values() if d is not None]
    run = {
        "run_id": args.run_id,
        "started_at": started,
        "ended_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "total_wall_s": round(total, 2),
        "jobs": args.jobs,
        "rom_count": len(summaries),
        "harness_args": args.harness_args,
        "asset_trace_config": {"entry_limit_per_phase": args.asset_trace_limit,
                               "snapshot_max_bytes_per_entry": args.asset_snapshot_max_bytes},
        "per_rom_wall_s": durations,
        "per_rom_wall_range_s": [min(ok_d), max(ok_d)] if ok_d else None,
        "aggregate_rom_wall_s": round(sum(ok_d), 2),
        "frames_emulated": sum(s.get("frames_emulated", 0) for s in summaries),
        "failures": [{"id": s["id"], "outcome": s["outcome"], "error": s.get("error")}
                     for s in summaries if s["outcome"] not in ("ok", "ok_with_emulator_errors")],
        "emulator_error_roms": [s["id"] for s in summaries if s["outcome"] == "ok_with_emulator_errors"],
        "context": ctx,
        "notes": "per-ROM wall includes process start, all phases and finalisation; ROMs run concurrently so aggregate > total",
    }
    with open(out_root / "runs.jsonl", "a") as f:
        f.write(json.dumps(run) + "\n")
    if not args.no_index:
        (out_root / "index.json").write_text(json.dumps({"run": run, "roms": summaries}, indent=1) + "\n")
    print(f"run {args.run_id}: {len(summaries)} ROMs in {total:.1f}s, failures: {len(run['failures'])}")


if __name__ == "__main__":
    main()
