#!/usr/bin/env python3
"""Build an isolated full Metroid Zero Mission ROM, optionally with native bridges.

Uses local, hash-identified ROM inputs. Never modifies the source survey checkout,
fetches ROMs, runs an emulator, or publishes binary assets.
"""
import argparse
import difflib
import hashlib
import io
import json
import os
import platform
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import time
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE_COMMIT = "9caaefc0ee570f3399d86acf140fdeada9692836"
ROM_SHA1 = "5de8536afe1f0078ee6fe1089f890e8c7aa0a6e8"
COMPILER_COMMIT = "59b966ed1b8f371856dcf99f1546c2fe89c678ca"
NES_OFFSET = 0x7D8000

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")

def stage(report, receipt, label, command, cwd, timeout, log):
    entry = {"stage": label, "command": command, "cwd": str(cwd),
             "started_at_unix": time.time(), "timeout_s": timeout,
             "log": str(log), "outcome": "running"}
    report["stages"].append(entry)
    save(receipt, report)
    started = time.monotonic()
    with log.open("w") as stream:
        process = subprocess.Popen(command, cwd=cwd, stdout=stream,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
            entry.update(exit_code=code, outcome="ok" if code == 0 else "failed")
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            entry.update(exit_code=None, outcome="timeout")
    entry["wall_s"] = round(time.monotonic() - started, 4)
    save(receipt, report)
    if entry["outcome"] != "ok":
        raise RuntimeError("%s %s; see %s" % (label, entry["outcome"], log))

def install_native(work, native):
    required = ["gv_native.c", "gv_native.h", "emerald_bridge.c", "emerald_bridge.h"]
    for name in required:
        if not (native / name).is_file():
            raise ValueError("Native bridge missing: " + str(native / name))
    target = work / "src/gv_mashup"
    shutil.copytree(native, target, dirs_exist_ok=True)
    sources = sorted(target.rglob("*.c"))
    objects = [str(p.relative_to(work).with_suffix(".o")) for p in sources]
    # Keep original source order; append new code/data in the source ROM's slack.
    linker = work / "linker.ld"
    text = linker.read_text()
    marker = "        . = 0x00007ff8; gInterruptCheckFlag = .;"
    writable = "".join("        %s(iwram_data .bss);\n" % p for p in objects)
    text = text.replace(marker, writable + marker)
    marker = "    nes_metroid_data __nes_metroid_load_address : ALIGN(2) {"
    addition = "    .gameverse : ALIGN(4) {\n" + "".join(
        "        %s(.text .rodata .data);\n" % p for p in objects) + "    } >rom\n\n"
    if marker not in text:
        raise ValueError("Pinned linker insertion marker missing")
    linker.write_text(text.replace(marker, addition + marker))
    main = work / "src/agbmain.c"
    text = '#include "gv_native.h"\n' + main.read_text()
    marker = "            case GM_MAP_SCREEN:\n"
    addition = (marker + "                if (gGvEncounterPending)\n"
                "                {\n"
                "                    if (GvNativeBattleHandler())\n"
                "                    {\n"
                "                        gMainGameMode = GM_INGAME;\n"
                "                        gSubGameMode1 = 0;\n"
                "                        gSubGameMode2 = 0;\n"
                "                        gSubGameModeStage = 0;\n"
                "                    }\n"
                "                    break;\n"
                "                }\n")
    if marker not in text:
        raise ValueError("Pinned main-loop insertion marker missing")
    main.write_text(text.replace(marker, addition, 1))
    game = work / "src/in_game.c"
    text = '#include "gv_native.h"\n' + game.read_text()
    marker = "                if ((gChangedInput & gButtonAssignments.pause || gPauseScreenFlag != PAUSE_SCREEN_NONE) && ProcessPauseButtonPress())"
    addition = ("                if (GvNativePollEncounter())\n"
                "                    gSubGameMode1++;\n"
                "                else " + marker.strip())
    if marker not in text:
        raise ValueError("Pinned gameplay insertion marker missing")
    game.write_text(text.replace(marker, addition, 1))
    return {str(p.relative_to(native)): digest(p) for p in sorted(native.rglob("*")) if p.is_file()}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=ROOT / "local/decomps/mzm")
    parser.add_argument("--compiler", type=Path, default=ROOT / "local/game-builds/toolchains/agbcc-mzm")
    parser.add_argument("--rom", type=Path, default=ROOT / "local/roms/Metroid - Zero Mission (USA).gba")
    parser.add_argument("--native", type=Path, help="Native source directory; omit for exact baseline")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()
    work = args.work_dir.resolve()
    if not 1 <= args.jobs <= 8 or not 1 <= args.timeout <= 600:
        raise ValueError("jobs must be1..8, timeout1..600 seconds")
    if work.exists():
        raise ValueError("Choose a new work directory; existing source/builds are preserved: " + str(work))
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != ROM_SHA1:
        raise ValueError("USA baserom SHA1 mismatch; no files modified")
    compiler = args.compiler.resolve()
    if not all((compiler / p).is_file() for p in ["agbcc", "libgcc.a", "libc.a"]):
        raise ValueError("Build the pinned compiler first: " + str(compiler))
    actual = subprocess.check_output(["git", "-C", str(compiler), "rev-parse", "HEAD"], text=True).strip()
    if actual != COMPILER_COMMIT:
        raise ValueError("Compiler source pin mismatch")
    work.mkdir(parents=True)
    receipt = work.parent / (work.name + "-receipt.json")
    report = {"schema_version": 1, "candidate": bool(args.native), "source_commit": SOURCE_COMMIT,
              "source": str(args.source.resolve()), "work_dir": str(work),
              "baserom_sha1": ROM_SHA1, "baserom_sha256": hashlib.sha256(rom).hexdigest(),
              "compiler_commit": actual, "compiler_binary_sha256": digest(compiler / "agbcc"),
              "build_mode": "clean", "cache_state": "compiled compiler warm; source objects cold",
              "jobs": args.jobs, "queue_s": None, "queue_note": "direct local invocation",
              "context": {"python": sys.version.split()[0], "machine": platform.platform(),
                          "app_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                          "binutils": subprocess.check_output(["arm-none-eabi-as", "--version"], text=True).splitlines()[0]},
              "compiler_libraries_sha256": {name: digest(compiler / name) for name in ["libc.a", "libgcc.a"]},
              "stages": [], "qualification": "build and identity only; gameplay not evaluated by builder"}
    total = time.monotonic()
    try:
        data = subprocess.check_output(["git", "-C", str(args.source), "archive", SOURCE_COMMIT])
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for item in archive.getmembers():
                path = (work / item.name).resolve()
                if work not in path.parents:
                    raise ValueError("Unsafe archive member")
            archive.extractall(work)
        (work / "mzm_us_baserom.gba").write_bytes(rom)
        stage(report, receipt, "install_compiler", ["bash", "install.sh", str(work)], compiler,
              30, work.parent / (work.name + "-compiler.log"))
        stage(report, receipt, "extract_data", ["python3", "tools/extractor.py", "-r", "us", "-q"], work,
              60, work.parent / (work.name + "-extract.log"))
        payload = rom[NES_OFFSET:]
        (work / "data/nes_metroid.bin").write_bytes(payload)
        inc = work / "include/extracted/data/nes_metroid.bin.inc"
        inc.parent.mkdir(parents=True, exist_ok=True)
        inc.write_text(",".join(str(n) + "u" for n in payload))
        makefile = work / "Makefile"
        text = makefile.read_text()
        start = text.index("src/data/nes_metroid.s: src/data/nes_metroid.c\n")
        end = text.index("\n\nsrc/dma.s:", start)
        text = text[:start] + text[end:] + "\nCPPFLAGS += -Isrc/gv_mashup\n"
        old_compile = "\t$Q$(PREPROC) $< $(PREPROCFLAGS) | $(CPP) $(CPPFLAGS) | $(CC) -o $@ $(CFLAGS) && printf '\\t.align 2, 0 @ dont insert nops\\n' >> $@"
        if old_compile not in text:
            raise ValueError("Pinned compile recipe marker missing")
        text = text.replace(old_compile, "\t$Q$(PYTHON) tools/compile-checked.py $< $@ $(CPPFLAGS) -- $(CFLAGS)")
        makefile.write_text(text)
        checked = work / "tools/compile-checked.py"
        checked.write_text("""import subprocess,sys
from pathlib import Path
source,target=sys.argv[1:3]
args=sys.argv[3:]; split=args.index('--'); cpp=args[:split]; flags=args[split+1:]
a=subprocess.run([sys.executable,'tools/preproc.py',source,'charmap.txt'],stdout=subprocess.PIPE,check=True).stdout
b=subprocess.run(['cc','-E','-x','c']+cpp+['-'],input=a,stdout=subprocess.PIPE,check=True).stdout
subprocess.run(['tools/agbcc/bin/agbcc','-o',target]+flags,input=b,check=True)
with Path(target).open('a') as f: f.write('\\t.align 2, 0 @ dont insert nops\\n')
""")
        report["preprocessor_errors_are_fatal"] = True
        report["embedded_nes"] = {"offset": hex(NES_OFFSET), "bytes": len(payload),
                                  "sha256": hashlib.sha256(payload).hexdigest(),
                                  "reuse": "unchanged unlockable payload from exact baserom; core MZM source rebuilt"}
        wrapper = work / "tools/cpp-wrapper"
        wrapper.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\na=sys.argv[1:]\nos.execvp("cc",["cc","-E","-x","c"]+a+([] if any(Path(x).is_file() for x in a if not x.startswith("-")) else ["-"]))\n')
        wrapper.chmod(0o755)
        if args.native:
            original = {name: (work / name).read_text() for name in ["src/agbmain.c", "src/in_game.c", "linker.ld", "Makefile"]}
            report["native_source_sha256"] = install_native(work, args.native.resolve())
            patch = work.parent / (work.name + "-source.patch")
            chunks = []
            records = []
            for name, before in original.items():
                after = (work / name).read_text()
                chunks.extend(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                                   fromfile="a/" + name, tofile="b/" + name))
                records.append({"path": name, "before_native_sha256": hashlib.sha256(before.encode()).hexdigest(),
                                "candidate_sha256": digest(work / name)})
            patch.write_text("".join(chunks))
            report["native_source_patch"] = {"path": str(patch), "sha256": digest(patch), "files": records}
        stage(report, receipt, "make", ["make", "-j%d" % args.jobs, "REGION=us", "CPP=tools/cpp-wrapper"],
              work, args.timeout, work.parent / (work.name + "-make.log"))
        output = work / "mzm_us.gba"
        binary = output.read_bytes()
        report["output"] = {"path": str(output), "bytes": len(binary), "sha1": hashlib.sha1(binary).hexdigest(),
                            "sha256": digest(output), "elf": str(work / "mzm_us.elf"), "map": str(work / "mzm_us.map"),
                            "byte_identical_to_baseline": binary == rom}
        if not args.native and binary != rom:
            raise RuntimeError("Baseline build differs from input ROM; see receipt")
        report["outcome"] = "built"
    except Exception as exc:
        report.update(outcome="failed", error=str(exc))
        raise
    finally:
        report["total_wall_s"] = round(time.monotonic() - total, 4)
        save(receipt, report)
        print(json.dumps({"receipt": str(receipt), "outcome": report.get("outcome"), "output": report.get("output")}))

if __name__ == "__main__":
    main()
