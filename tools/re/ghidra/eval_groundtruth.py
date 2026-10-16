#!/usr/bin/env python3
"""Score Ghidra function discovery against pret/pokeemerald's pokeemerald.sym.

Usage:
  python3 tools/re/ghidra/eval_groundtruth.py [local/re/pokemon-emerald-version/functions.jsonl]
      [--sym local/re/groundtruth/pokeemerald.sym] [--json out.json] [--misses N]

Fetch the symbol file once (symbols branch of pret/pokeemerald):
  curl -sSfL -o local/re/groundtruth/pokeemerald.sym \\
    https://raw.githubusercontent.com/pret/pokeemerald/symbols/pokeemerald.sym

The .sym has no symbol-type column (lines are "addr l|g size name"; objdump's F/O
flags are stripped) and Thumb functions are listed at even addresses (odd ROM
addresses are script/data labels). Ground-truth functions are therefore:
ROM symbols below the first .rodata marker, even address, non-zero size, not a
section marker and not a pret data name (s/g + Capital, e.g. sGFRomHeader).
Size-0 code labels in hand-written asm (crt0, IntrMain, ...) are reported
separately ("asm labels") because they mix function entries and local labels.
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def load_truth(sym_path):
    rows = []
    for line in Path(sym_path).read_text().splitlines():
        parts = line.split()
        if len(parts) == 4:
            rows.append((int(parts[0], 16), parts[1], int(parts[2], 16), parts[3]))
    rodata = min(a for a, _, _, n in rows if n == ".rodata" and a >= 0x08000000)
    funcs, asm = {}, {}
    for a, _, size, name in rows:
        if not (0x08000000 <= a < rodata) or a & 1 or name.startswith("."):
            continue
        if re.match(r"^[sg][A-Z]", name):
            continue
        if size > 0:
            funcs.setdefault(a, (name, size))
        elif a < 0x08000400 or a >= 0x082DF000:  # hand-written asm areas (crt0; m4a/libagb/libgcc)
            asm.setdefault(a, name)
    return funcs, asm, rodata


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("functions", nargs="?", default=str(REPO / "local/re/pokemon-emerald-version/functions.jsonl"))
    ap.add_argument("--sym", default=str(REPO / "local/re/groundtruth/pokeemerald.sym"))
    ap.add_argument("--json", help="write metrics JSON here")
    ap.add_argument("--misses", type=int, default=0, help="print N example misses / false positives")
    args = ap.parse_args()

    truth, asm, rodata = load_truth(args.sym)
    found = {}
    for line in open(args.functions):
        r = json.loads(line)
        found[int(r["entry"], 16)] = r
    rom_found = {a for a in found if 0x08000000 <= a < 0x0A000000}
    text_found = {a for a in rom_found if a < rodata}
    tp = rom_found & truth.keys()
    # A found entry is "explained" if it is a truth entry or an asm label; anything else is a false positive.
    fp = text_found - truth.keys() - asm.keys()
    fp_rodata = rom_found - text_found
    # Size agreement for true positives.
    size_exact = sum(1 for a in tp if found[a]["size"] == truth[a][1])
    size_close = sum(1 for a in tp if abs(found[a]["size"] - truth[a][1]) <= 4)
    m = {
        "truth_functions": len(truth),
        "found_rom_functions": len(rom_found),
        "true_positives": len(tp),
        "recall": round(len(tp) / len(truth), 4),
        "precision_text": round(len(tp | (text_found & asm.keys())) / max(1, len(text_found)), 4),
        "precision_all_rom": round(len(tp | (text_found & asm.keys())) / max(1, len(rom_found)), 4),
        "false_positives_in_text": len(fp),
        "found_beyond_text_end": len(fp_rodata),
        "asm_labels": len(asm),
        "asm_labels_found": len(text_found & asm.keys()),
        "size_exact_frac": round(size_exact / max(1, len(tp)), 4),
        "size_within4_frac": round(size_close / max(1, len(tp)), 4),
        "text_end": hex(rodata),
    }
    print(json.dumps(m, indent=2))
    if args.misses:
        miss = sorted(truth.keys() - rom_found)
        print("misses:", [(hex(a), truth[a][0], truth[a][1]) for a in miss[: args.misses]])
        print("false positives:", [(hex(a), found[a]["name"], found[a]["size"]) for a in sorted(fp)[: args.misses]])
    if args.json:
        Path(args.json).write_text(json.dumps(m, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
