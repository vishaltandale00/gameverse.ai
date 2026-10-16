#!/usr/bin/env python3
"""Qualify recovered casting policy against original and emitted Thumb execution.

No game/source download, accepted save, dependency installation or CI campaign.
Private output directories are immutable attempts; each subprocess is capped.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ROM_SHA1 = "abd71fe01ebb201bcc133074db1dd8c5253776c7"


def qualify(rom, out):
    rom = rom.resolve()
    data = rom.read_bytes()
    if hashlib.sha1(data).hexdigest() != ROM_SHA1:
        raise ValueError("Exact USA cartridge required")
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {"run_id": out.name, "queue_s": None, "environment": platform.platform(),
              "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "rom_sha1": ROM_SHA1, "rom_sha256": hashlib.sha256(data).hexdigest(),
              "inputs": {str(f.relative_to(ROOT)): hashlib.sha256(f.read_bytes()).hexdigest()
                         for f in [HERE / "cast-policy.c", HERE / "cast-policy.h", HERE / "cast-differential.c"]},
              "limits": {"per_stage_timeout_s": 30, "vectors": 5376},
              "scope": "Casting policy; declared allocator/animation service stubs; not projectile, gameplay or cartridge integration qualification",
              "stages": [], "outcome": "running"}
    started = time.monotonic()

    def stage(name, command):
        before = time.monotonic()
        try:
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=30, cwd=ROOT)
            (out / (name + ".log")).write_text(result.stdout + result.stderr)
            report["stages"].append({"stage": name, "wall_s": round(time.monotonic()-before, 6),
                                     "exit_code": result.returncode, "outcome": "passed" if result.returncode == 0 else "failed"})
            if result.returncode:
                raise RuntimeError(name + " failed; retained log " + str(out / (name + ".log")))
            return result.stdout
        except subprocess.TimeoutExpired:
            report["stages"].append({"stage": name, "wall_s": round(time.monotonic()-before, 6),
                                     "exit_code": None, "outcome": "timeout"})
            raise

    try:
        script = out / "component.ld"
        script.write_text("SECTIONS { . = 0x02010000; .text : { *(.text*) *(.rodata*) } /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }")
        stage("arm_compile", ["cc", "-target", "armv4t-none-eabi", "-mcpu=arm7tdmi", "-mthumb",
                             "-ffreestanding", "-fno-builtin", "-Os", "-Wall", "-c", str(HERE/"cast-policy.c"), "-o", str(out/"cast.o")])
        stage("arm_link", ["arm-none-eabi-ld", "-T", str(script), "-e", "gv_aos_cast_step", str(out/"cast.o"), "-o", str(out/"cast.elf")])
        stage("arm_emit", ["arm-none-eabi-objcopy", "-O", "binary", str(out/"cast.elf"), str(out/"cast.bin")])
        symbols = stage("native_symbols", ["arm-none-eabi-nm", "-n", str(out/"cast.elf")])
        entry = next(int(line.split()[0], 16) for line in symbols.splitlines() if line.endswith(" gv_aos_cast_step"))
        stage("host_compile", ["cc", "-O2", "-Wall", "-I/opt/homebrew/include", str(HERE/"cast-differential.c"), str(HERE/"cast-policy.c"),
                               "-L/opt/homebrew/lib", "-Wl,-rpath,/opt/homebrew/lib", "-lmgba", "-o", str(out/"oracle")])
        report["native_result"] = json.loads(stage("original_and_emitted_compare", [str(out/"oracle"), str(rom), str(out/"cast.bin"), hex(entry)]))
        report["emitted_bytes"] = (out/"cast.bin").stat().st_size
        report["emitted_sha256"] = hashlib.sha256((out/"cast.bin").read_bytes()).hexdigest()
        report["outcome"] = "passed"
    except Exception as exc:
        report.update(outcome="failed", error=str(exc))
        raise
    finally:
        report["total_wall_s"] = round(time.monotonic()-started, 6)
        (out/"report.json").write_text(json.dumps(report, indent=2)+"\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(qualify(args.rom, args.out), indent=2))
