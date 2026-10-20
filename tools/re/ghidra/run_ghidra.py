#!/usr/bin/env python3
"""Run the headless Ghidra GBA pipeline (GbaSetup -> analysis -> GbaDiscover -> GbaExport)
over ROMs listed in local/re/roms.json, a few JVMs at a time, and append a run record
to local/re/index.json.

Usage (from the repo root):
  python3 tools/re/ghidra/run_ghidra.py pokemon-emerald-version driv3r
  python3 tools/re/ghidra/run_ghidra.py --all --jobs 5
  python3 tools/re/ghidra/run_ghidra.py driv3r --export-only     # re-export from saved project
See tools/re/ghidra/README.md.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import math
import os
import platform
import signal
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DEFAULT_GHIDRA = "/opt/homebrew/opt/ghidra/libexec"
DEFAULT_JAVA = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def script_hash():
    h = hashlib.sha256()
    for f in sorted(HERE.glob("*.java")) + [Path(__file__).resolve()]:
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def sh(cmd):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return (result.stdout.strip() or None) if result.returncode == 0 else None
    except Exception:
        return None


def machine_context(ghidra_home, java_home):
    props = {}
    app = Path(ghidra_home) / "Ghidra" / "application.properties"
    if app.exists():
        for line in app.read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                props[k.strip()] = v.strip()
    java_v = subprocess.run([str(Path(java_home) / "bin" / "java"), "-version"], capture_output=True, text=True).stderr
    mem = sh(["sysctl", "-n", "hw.memsize"])
    return {
        "host": platform.node(),
        "platform": platform.platform(),
        "cpu": sh(["sysctl", "-n", "machdep.cpu.brand_string"]),
        "ncpu": os.cpu_count(),
        "mem_gb": round(int(mem) / 2**30) if mem and mem.isdigit() else None,
        "java": next((line for line in java_v.splitlines() if "version" in line.lower()), None),
        "ghidra_version": props.get("application.version"),
        "load_avg_at_start": os.getloadavg(),
    }


def source_commit():
    head = sh(["git", "-C", str(REPO), "rev-parse", "HEAD"])
    dirty = sh(["git", "-C", str(REPO), "status", "--porcelain", "--", "tools/re"])
    return {"commit": head, "tools_re_dirty": bool(dirty)}


INDEX_LOCK = threading.Lock()


def write_index(index_path, record):
    with INDEX_LOCK:
        index_path.parent.mkdir(parents=True, exist_ok=True)
        data = {"runs": []}
        if index_path.exists():
            try:
                data = json.loads(index_path.read_text())
            except json.JSONDecodeError:
                index_path.rename(index_path.with_suffix(".corrupt.json"))
        runs = [r for r in data.get("runs", []) if r.get("run_id") != record["run_id"]]
        runs.append(record)
        data["runs"] = runs
        tmp = index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n")
        tmp.replace(index_path)


def find_seed_file(rom_id, explicit, out_dir, capture_root=None, max_seeds=None):
    if explicit:
        if not Path(explicit).is_file():
            raise FileNotFoundError(f"configured seed file is missing: {explicit}")
        return explicit
    cap = (Path(capture_root) if capture_root else REPO / "local" / "captures") / rom_id
    if cap.is_dir():
        # Preserve explicit consolidated seed files supplied by the researcher.
        for pat in ("coverage*.json", "*coverage*.json", "seeds*.json"):
            hits = sorted(cap.glob(pat))
            if hits:
                return str(hits[0])
        # The capture harness stores coverage beneath each phase. Seed only
        # observed call targets: basic-block entries are not function entries.
        paths = sorted(cap.glob("*/coverage.json"))
        if paths:
            entries, sources, observed_calls = {}, [], {}
            for path in paths:
                raw = path.read_bytes()
                coverage = json.loads(raw)
                functions = coverage["regions"]["rom"]["functions"]
                if not isinstance(functions, list):
                    raise ValueError(f"capture ROM functions must be a list in {path}")
                for entry in functions:
                    if not isinstance(entry, list) or len(entry) < 2:
                        raise ValueError(f"invalid capture function entry in {path}: {entry!r}")
                    addr = int(entry[0], 0) if isinstance(entry[0], str) else int(entry[0])
                    mode = str(entry[1]).lower()
                    if mode not in ("a", "arm", "t", "thumb"):
                        raise ValueError(f"unknown capture instruction mode in {path}: {entry[1]!r}")
                    mode = "thumb" if mode.startswith("t") else "arm"
                    addr &= ~1 if mode == "thumb" else ~3
                    key = (addr, mode)
                    entries[key] = {"addr": addr, "mode": mode}
                    observed_calls[key] = observed_calls.get(key, 0) + (int(entry[2]) if len(entry) > 2 else 1)
                sources.append({"path": str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path),
                                "sha256": hashlib.sha256(raw).hexdigest(),
                                "rom_call_targets": len(functions)})
            target = Path(out_dir) / "capture_seeds.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            keys = sorted(entries)
            total = len(keys)
            if max_seeds is not None and total > max_seeds:
                keys = sorted(sorted(keys, key=lambda key: (-observed_calls[key], key))[:max_seeds])
            target.write_text(json.dumps({"sources": sources,
                                          "available_call_targets": total,
                                          "selected_call_targets": len(keys),
                                          "selection": "highest summed observed call counts when capped; otherwise all phase call targets",
                                          "max_capture_seeds": max_seeds,
                                          "entries": [entries[k] for k in keys]}, indent=2) + "\n")
            return str(target)
    return None


def wait_headless(cmd, log, env, timeout):
    """A bounded run must also stop the Java child behind Ghidra's launcher."""
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env,
                            start_new_session=True)
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        # A launcher can exit before its Java child; kill the remaining group.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
        raise


def run_one(rom, args, run_id, shash, out_root):
    rom_id = rom["id"]
    out = out_root / rom_id
    proj = out / "ghidra_project"
    rom_path = REPO / "local" / "roms" / rom["file"]
    no_auto_analysis = getattr(args, "no_auto_analysis", False)
    repair_returns = getattr(args, "repair_returns", False)
    rec = {"id": rom_id, "file": rom["file"], "sha1": rom.get("sha1"), "size_bytes": rom.get("size_bytes"),
           "started": now(), "mode": "export-only" if args.export_only else "seeded-no-auto-analysis" if no_auto_analysis else "full"}
    if repair_returns:
        # Opt-in views must not erase the export used for their comparison.
        prior = [out / name for name in ("functions.jsonl", "strings.json", "summary.json", "returns.json")
                 if (out / name).is_file()]
        if prior:
            backup_start = time.perf_counter()
            backup = out / "prior-exports" / run_id
            backup.mkdir(parents=True, exist_ok=False)
            for path in prior:
                shutil.copy2(path, backup / path.name)
            rec["prior_export_backup"] = {"path": str(backup), "bytes": sum(p.stat().st_size for p in prior),
                                          "wall_s": round(time.perf_counter() - backup_start, 6),
                                          "note": "Previous export may itself be repaired; inspect its summary."}
    common_export = [f"out={out}", f"run_id={run_id}", f"script_hash={shash}",
                     f"decompile={0 if args.no_decompile else 1}", f"decomp_threads={args.decomp_threads}",
                     f"decomp_timeout={args.decomp_timeout}",
                     f"auto_analysis={0 if no_auto_analysis or args.export_only else 1}",
                     f"repair_returns={1 if repair_returns else 0}",
                     f"reuse_project={1 if args.export_only else 0}"]
    headless = str(Path(args.ghidra) / "support" / "analyzeHeadless")
    if args.export_only:
        if not proj.exists():
            rec.update(status="failed", error="no saved project; run without --export-only first")
            return rec
        for f in ("functions.jsonl", "strings.json", "summary.json", "returns.json"):
            (out / f).unlink(missing_ok=True)
        cmd = [headless, str(proj), "gba", "-process", rom["file"], "-noanalysis", "-readOnly",
               "-scriptPath", str(HERE)]
    else:
        if proj.exists():
            shutil.rmtree(proj)
        for f in ("functions.jsonl", "strings.json", "summary.json", "setup.json", "discover.json", "returns.json"):
            (out / f).unlink(missing_ok=True)
        proj.mkdir(parents=True)
        seed = find_seed_file(rom_id, args.seed_file if args.seed_file and len(args.ids) == 1 else None,
                              out, getattr(args, "capture_root", None), getattr(args, "max_capture_seeds", None))
        rec["seed_file"] = seed
        setup_args = [f"out={out}", f"seed_oddptr={args.seed_oddptr}"] + ([f"seed_file={seed}"] if seed else [])
        # This analyzer previously ran for >20 min on Emerald; retain the
        # documented lean default, while allowing an explicit --opt override.
        setup_args.append("opt:Non-Returning Functions - Discovered=false")
        setup_args += [f"opt:{o}" for o in args.opt]
        cmd = [headless, str(proj), "gba", "-import", str(rom_path), "-overwrite",
               "-loader", "BinaryLoader", "-loader-baseAddr", "0x08000000", "-loader-blockName", "ROM",
               "-processor", "ARM:LE:32:v4t", "-cspec", "default",
               "-scriptPath", str(HERE), "-preScript", "GbaSetup.java", *setup_args]
        if no_auto_analysis:
            cmd.append("-noanalysis")
        if not args.no_discover:
            cmd += ["-postScript", "GbaDiscover.java", f"out={out}", f"gap_arm={1 if args.gap_arm and getattr(args, 'discover_mode', 'gaps') != 'calls' else 0}",
                    f"max_rounds={args.discover_rounds}",
                    f"gap_thumb={0 if getattr(args, 'discover_mode', 'gaps') == 'calls' else 1}",
                    f"call_targets={1 if getattr(args, 'discover_mode', 'gaps') in ('calls', 'both') else 0}",
                    f"analyze_changes={0 if getattr(args, 'discover_no_analysis', False) else 1}",
                    f"candidate_limit={getattr(args, 'discover_candidate_limit', 10000)}",
                    f"budget_ms={int(getattr(args, 'discover_scan_timeout', 60) * 1000)}"]
    if repair_returns:
        cmd += ["-postScript", "GbaReturns.java", f"out={out}", f"run_id={run_id}"]
    cmd += ["-postScript", "GbaExport.java", *common_export]
    cmd += ["-max-cpu", str(args.max_cpu), "-log", str(out / "ghidra.log"), "-scriptlog", str(out / "script.log")]
    env = dict(os.environ)
    env.setdefault("JAVA_HOME", args.java_home)
    env["GHIDRA_HEADLESS_MAXMEM"] = args.xmx
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    try:
        with open(out / "headless.log", "w") as log:
            rec["exit_code"] = wait_headless(cmd, log, env, args.rom_timeout)
        timed_out = False
    except subprocess.TimeoutExpired:
        rec["exit_code"] = None
        timed_out = True
    rec["wall_s"] = round(time.time() - t0, 1)
    rec["ended"] = now()
    summary = None
    sp = out / "summary.json"
    if sp.exists():
        try:
            summary = json.loads(sp.read_text())
        except json.JSONDecodeError:
            summary = None
    seed_error = None
    repair_error = None
    if repair_returns:
        try:
            returns = json.loads((out / "returns.json").read_text())
            if returns.get("run_id") != run_id or returns.get("heuristic") is not True or "flow_overrides" not in returns:
                repair_error = "requested return repair lacks valid current-run metadata"
        except (OSError, json.JSONDecodeError):
            repair_error = "no valid returns.json confirming requested return repair"
    if not args.export_only and rec.get("seed_file"):
        try:
            setup = json.loads((out / "setup.json").read_text())
            seed_stats = setup.get("seeds_file")
            if not isinstance(seed_stats, dict) or seed_stats.get("error") or "thumb" not in seed_stats or "arm" not in seed_stats:
                seed_error = "configured seeds were not successfully loaded by GbaSetup"
        except (OSError, json.JSONDecodeError):
            seed_error = "no valid setup.json confirming configured seeds"
    if summary and summary.get("run_id") == run_id and not seed_error and not repair_error:
        tm = summary.get("timings", {})
        rec.update(status="ok" if rec["exit_code"] == 0 else "partial",
                   function_count=summary.get("function_count"),
                   thumb_functions=summary.get("thumb_functions"),
                   decompiled=summary.get("decompiled_count"),
                   decompile_failures=summary.get("decompile_failures"),
                   decompile_timeouts=summary.get("decompile_timeouts"),
                   analysis_ms=tm.get("analysis_total_ms"), auto_analysis_ms=tm.get("auto_analysis_ms"),
                   discover_ms=tm.get("discover_ms"), decompile_ms=tm.get("decompile_ms"),
                   return_repair_ms=tm.get("return_repair_ms"),
                   return_repair_overrides=(summary.get("return_repair") or {}).get("flow_overrides"),
                   export_ms=tm.get("export_total_ms"))
    else:
        err = "timeout after %ss" % args.rom_timeout if timed_out else seed_error or repair_error or "no summary.json from this run"
        tail = (out / "headless.log").read_text(errors="replace").splitlines()[-15:]
        errs = [l for l in tail if "ERROR" in l or "Exception" in l]
        rec.update(status="failed", error=err, log_tail=errs or tail[-5:])
        # A hard cap can interrupt final export after many useful functions were
        # generated. Retain the separate journal as partial evidence, without
        # converting a failed ROM run into a successful final export.
        progress_path = out / "partial-progress.json"
        journal_path = out / "partial-functions.jsonl"
        try:
            progress = json.loads(progress_path.read_text())
            if progress.get("run_id") == run_id and journal_path.is_file():
                rec["partial_journal"] = {
                    "path": str(journal_path),
                    "sha256": hashlib.sha256(journal_path.read_bytes()).hexdigest(),
                    "progress": progress,
                    "note": "Incomplete process-cap checkpoint, not final function/whole-game coverage",
                }
        except (OSError, ValueError):
            pass
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", help="ROM ids from local/re/roms.json")
    ap.add_argument("--all", action="store_true", help="run every ROM in roms.json")
    ap.add_argument("--jobs", type=int, default=5, help="concurrent Ghidra JVMs (default 5)")
    ap.add_argument("--xmx", default="4G", help="max heap per JVM (default 4G)")
    ap.add_argument("--max-cpu", type=int, default=3, help="Ghidra -max-cpu per JVM (default 3)")
    ap.add_argument("--decomp-threads", type=int, default=3, help="decompiler processes per JVM (default 3)")
    ap.add_argument("--decomp-timeout", type=int, default=30, help="seconds per function (default 30)")
    ap.add_argument("--no-decompile", action="store_true", help="export facts only, skip pseudo-C")
    ap.add_argument("--no-discover", action="store_true", help="skip the GbaDiscover gap pass")
    ap.add_argument("--no-auto-analysis", action="store_true",
                    help="skip default auto-analyzers; explicitly disassemble seeds then export (use --no-discover or --discover-no-analysis)")
    ap.add_argument("--repair-returns", action="store_true",
                    help="opt-in heuristic POP/BX saved-LR return overrides; writes returns.json; does not recover ABI types")
    ap.add_argument("--discover-rounds", type=int, default=3)
    ap.add_argument("--discover-mode", choices=["gaps", "calls", "both"], default="gaps",
                    help="gap prologues, direct call targets, or both")
    ap.add_argument("--discover-no-analysis", action="store_true",
                    help="create discovered functions without invoking analyzeChanges")
    ap.add_argument("--discover-candidate-limit", type=int, default=10000)
    ap.add_argument("--discover-scan-timeout", type=float, default=60,
                    help="cooperative scan budget in seconds; ROM process timeout remains the hard cap")
    ap.add_argument("--gap-arm", action="store_true", help="also seed ARM stmdb prologues in gaps")
    ap.add_argument("--seed-oddptr", default="valid", choices=["off", "push", "valid"])
    ap.add_argument("--seed-file", help="coverage/seed JSON (single ROM only; default: auto from local/captures/<id>/)")
    ap.add_argument("--capture-root", type=Path,
                    help="capture directory for automatic seed merging (default: local/captures)")
    ap.add_argument("--max-capture-seeds", type=int,
                    help="cap merged phase call targets by summed observed calls; explicit/consolidated seed files remain unchanged")
    ap.add_argument("--opt", action="append", default=[], help='Ghidra analysis option override "Name=value"')
    ap.add_argument("--export-only", action="store_true", help="reuse saved project; rerun GbaExport only")
    ap.add_argument("--rom-timeout", type=int, default=3 * 3600, help="kill a ROM's JVM after N seconds")
    ap.add_argument("--out-root", default=str(REPO / "local" / "re"))
    ap.add_argument("--ghidra", default=os.environ.get("GHIDRA_HOME", DEFAULT_GHIDRA))
    ap.add_argument("--java-home", default=os.environ.get("JAVA_HOME", DEFAULT_JAVA))
    ap.add_argument("--note", default="", help="free-text note stored in the run record")
    args = ap.parse_args()
    if args.no_auto_analysis and not args.no_discover and not args.export_only and not args.discover_no_analysis:
        ap.error("--no-auto-analysis requires --no-discover or --discover-no-analysis")
    if args.discover_rounds < 1 or args.discover_candidate_limit < 1 or not math.isfinite(args.discover_scan_timeout) or args.discover_scan_timeout <= 0:
        ap.error("discovery round, candidate and scan-time limits must be positive")
    if args.max_capture_seeds is not None and args.max_capture_seeds < 1:
        ap.error("--max-capture-seeds must be positive")

    out_root = Path(args.out_root)
    roms = json.loads((REPO / "local" / "re" / "roms.json").read_text())
    by_id = {r["id"]: r for r in roms}
    if args.all:
        selected = roms
    else:
        unknown = [i for i in args.ids if i not in by_id]
        if unknown or not args.ids:
            ap.error("unknown or missing ids: %s (see local/re/roms.json)" % unknown)
        selected = [by_id[i] for i in args.ids]
    if args.seed_file and len(selected) != 1:
        ap.error("--seed-file requires exactly one selected ROM")
    # Largest ROMs first so the long poles start early.
    selected = sorted(selected, key=lambda r: -r.get("size_bytes", 0))

    run_id = dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
    shash = script_hash()
    record = {
        "run_id": run_id, "started": now(), "ended": None, "status": "running",
        "scope": "all" if args.all else args.ids, "note": args.note,
        "config": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items() if k not in ("ids", "all", "note")},
        "script_hash": shash, "source": source_commit(),
        "machine": machine_context(args.ghidra, args.java_home), "roms": [],
    }
    index_path = out_root / "index.json"
    write_index(index_path, record)
    t0 = time.time()
    print(f"run {run_id}: {len(selected)} ROM(s), {args.jobs} jobs, xmx {args.xmx}", flush=True)
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futs = {pool.submit(run_one, r, args, run_id, shash, out_root): r for r in selected}
        for fut in cf.as_completed(futs):
            try:
                rec = fut.result()
            except Exception as e:  # runner bug: record, keep going
                rec = {"id": futs[fut]["id"], "status": "failed", "error": f"runner exception: {e!r}"}
            record["roms"].append(rec)
            write_index(index_path, record)
            print(f"  {rec['id']}: {rec['status']} {rec.get('wall_s')}s funcs={rec.get('function_count')} "
                  f"decomp={rec.get('decompiled')} fail={rec.get('decompile_failures')} {rec.get('error', '')}",
                  flush=True)
    record["ended"] = now()
    record["total_wall_s"] = round(time.time() - t0, 1)
    record["aggregate_rom_wall_s"] = round(sum(r.get("wall_s") or 0 for r in record["roms"]), 1)
    failed = [r["id"] for r in record["roms"] if r.get("status") != "ok"]
    record["failures"] = failed
    record["status"] = "ok" if not failed else "completed_with_failures"
    record["roms"].sort(key=lambda r: r["id"])
    write_index(index_path, record)
    print(f"run {run_id} done in {record['total_wall_s']}s; failures: {failed or 'none'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
