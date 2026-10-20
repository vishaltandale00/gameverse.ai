"""Bounded, fail-closed source/SSA audit of FireRed Rev1's text wait parents.

This discovery profile does not credit an unlowered parent, copy its behavior
from the original ROM, or silently omit graphics/audio calls. Existing native
proofs are retained evidence; this command does not rerun them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from .dependency_frontier import mine, pin, validate_profile_frontier
from .source_provider import elf_range

ROOT = Path(__file__).resolve().parents[2]
ROM_SHA256 = "729041b940afe031302d630fdbe57c0c145f3f7b6d9b8eca5e98678d0ca4d059"
ROM_SHA1 = "dd5945db9b930750cb39d00c84da8571feebf417"
SOURCE = ROOT / "research/ir-workshop/roundtrip-20261016/firered/rev1-build-001/source"
L0_ROOT = ROOT / "local/ir/queue-runs/20261016T091004/pokemon-firered-version/l0"
PRIOR = ROOT / "local/roundtrip/firered-rev1-ir-20261016-002/provider-report.json"
BASELINE = ROOT / "research/ir-workshop/roundtrip-20261016/firered/rev1-roundtrip-001/manifest.json"
TARGETS = (
    ("initialize", "080054dc", "TextPrinterInitDownArrowCounters"),
    ("acknowledge", "0800561c", "TextPrinterWaitAutoMode"),
    ("draw_arrow", "0800550c", "TextPrinterDrawDownArrow"),
    ("wait_with_arrow", "08005648", "TextPrinterWaitWithDownArrow"),
    ("wait", "08005694", "TextPrinterWait"),
    ("dispatch", "080057a4", "RenderText"),
)


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def wait_service_profile():
    """JSON-safe automatic parent lift with an explicit native audio boundary."""
    contract_path = ROOT / "research/ir-workshop/roundtrip-20261016/wave2/firered-text/playse-retained-service.json"
    contract = json.loads(contract_path.read_text())
    source_path = SOURCE / "src/sound.c"
    source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if {row["sha256"] for row in contract["source_evidence"]} != {source_hash}:
        raise ValueError("Pinned PlaySE source ABI/effects evidence changed")
    frontier = ROOT / "local/roundtrip/firered-text-audit-20261016-002/dependency-frontier.json"
    return {
        "id": "firered-rev1-text-wait-retained-service-ir/1",
        "original_sha256": ROM_SHA256, "original_sha1": ROM_SHA1,
        "targets": [("wait", "firered.text.wait_with_retained_playse", "08005694")],
        "l0_paths": {"wait": "local/roundtrip/firered-text-wait-export-EX095/l0/08005694.json"},
        "dependency_seeds": [{"label": "acknowledge", "entry": "0800561c",
                              "package": "firered.text.timed_acknowledgement",
                              "l0_path": "local/ir/packages/firered.text.timed_acknowledgement/l0.json"}],
        "lifter_kwargs": {"wait": {"retained_services": {"080722e0": contract}}},
        "native_service_backend": {"proof": "firered-text-wait/1",
                                   "evidence": {source_hash: str(source_path.relative_to(ROOT))}},
        "arena_append": True, "arena_address": 0x09000000, "arena_capacity": 4096,
        "arena_entry": None, "dependency_frontier": pin(frontier),
        "scope": "Automatic text wait parent and inlined automatic wait dependency with retained real native PlaySE; finite immediate-effect proof, not a complete text controller",
        "system_contract": "research/deep-extraction/resume/pokemon-firered-version/next-extraction/system.json",
        "open_dependencies": [
            "Original RenderText dispatcher080057a4 and caller scheduling remain retained",
            "Original PlaySE080722e0/m4aSongNumStart081dd164 and audio driver authority/lifetime remain opaque OPEN dependencies",
            "Canonical caller-owned TextPrinter context; qualifier uses disjoint02010000 synthetic backing",
            "Original policy03003e50, input0300311e and quest state0203adfa producers remain retained",
            "IRQ/event advancement, rendered audio timing and full gameplay caller/lifetime are unqualified",
            "Arrow renderer/window/glyph subsystems remain retained and unregenerated"],
    }


def qualify_native_service(original, rebuilt, output):
    """Compare actual Wait entries from identical initialized native state.

    This deliberately does not use the scalar-only generic oracle: a real host
    service must execute against its restored native audio state. Successful
    parity remains an immediate-call fixture, not a portable audio certificate.
    """
    started = time.perf_counter()
    original, rebuilt, output = (Path(p).resolve() for p in (original, rebuilt, output))
    raw = original.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ROM_SHA256:
        raise ValueError("Exact FireRed Rev1 original required")
    output.mkdir(parents=True, exist_ok=False)
    template = ROOT / "research/ir-workshop/roundtrip-20261016/wave2/firered-text/service-boundary/native_service_oracle.c.in"
    (output / "oracle.c").write_bytes(template.read_bytes())
    (output / "profile-snapshot.py").write_bytes(Path(__file__).read_bytes())
    stages = []
    report = {"schema": "gameverse.firered-native-service-parity/1", "outcome": "running",
              "original": pin(original), "rebuilt": pin(rebuilt), "tool": pin(output / "profile-snapshot.py"),
              "oracle_template": pin(template), "machine": platform.platform(),
              "native_runtime": pin(Path("/opt/homebrew/lib/libmgba.dylib").resolve()),
              "compiler_version": subprocess.check_output(["cc", "--version"], text=True).splitlines()[0],
              "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "kind": "original-self-comparison" if hashlib.sha256(raw).hexdigest() == pin(rebuilt)["sha256"] else "candidate-service-parity",
              "limits": {"vectors": 64, "boot_frames": 120, "instructions_per_call": 2048, "stage_timeout_seconds": 30},
              "canonical_state": "Original full native savestate restored into distinct original/candidate cores before each fixture",
              "comparison": "Full R0, AAPCS/SP, all canonical EWRAM/IWRAM excluding bounded dead return-stack, actual PlaySE/m4a visits/arguments and defined audio MMIO",
              "excluded_dead_stack": {"start": "03007c00", "end_exclusive": "03007e00", "reason": "AAPCS caller-dead stack storage; both calls must restore SP and stay within this bound; all excluded raw deltas retained"},
              "scope": "Immediate source-pinned Wait/service effects on 64 synthetic native fixtures; no rendered sample, IRQ/concurrency or general lifetime equivalence",
              "audio_changed_ranges": "Observed source-owned driver spans only; not an exhaustive service write-set claim",
              "whole_game_equivalent": None, "ir_regenerated_byte_credit": 0,
              "stages": stages, "queue_seconds": None, "cache": "clean oracle compilation; retained original host"}
    commands = [("compile", ["cc", "-std=c11", "-O1", "-I/opt/homebrew/include", str(output / "oracle.c"),
                            "-L/opt/homebrew/lib", "-Wl,-rpath,/opt/homebrew/lib", "-lmgba", "-o", str(output / "oracle")]),
                ("native", [str(output / "oracle"), str(original), str(rebuilt), str(output / "native.json")])]
    try:
        for label, command in commands:
            step = time.perf_counter()
            process = subprocess.run(command, capture_output=True, text=True, timeout=30)
            (output / (label + ".stdout.log")).write_text(process.stdout)
            (output / (label + ".stderr.log")).write_text(process.stderr)
            stages.append({"name": label, "seconds": time.perf_counter()-step, "command": command,
                           "returncode": process.returncode, "stdout": pin(output / (label + ".stdout.log")),
                           "stderr": pin(output / (label + ".stderr.log"))})
            save(output / "parity-report.json", report)
            if process.returncode:
                raise ValueError(label + " failed; retained native.json and logs are diagnostic, not passing parity")
        native = json.loads((output / "native.json").read_text())
        if (native["outcome"] != "pass" or native["vectors"] != 64 or native["failures"]
                or not native["original_playse_visits"] or not native["original_songstart_visits"]):
            raise ValueError("Real source services not exercised or native parity failed")
        report.update(outcome="pass", native=pin(output / "native.json"),
                      original_playse_visits=native["original_playse_visits"],
                      original_songstart_visits=native["original_songstart_visits"])
    except (ValueError, subprocess.TimeoutExpired) as error:
        report.update(outcome="fail", reason=str(error))
    finally:
        report["timing"] = {"total_seconds": time.perf_counter()-started, "stages_nested_in_total": True,
                            "queue_seconds": None, "comparable_before_seconds": None}
        save(output / "parity-report.json", report)
    return report


def audit(original, output, source=SOURCE, l0_root=L0_ROOT, prior=PRIOR, baseline=BASELINE):
    """Retain six bounded attempts, source-byte witnesses and shared frontier."""
    started = time.perf_counter()
    original, output, source = Path(original).resolve(), Path(output).resolve(), Path(source).resolve()
    raw = original.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ROM_SHA256 or hashlib.sha1(raw).hexdigest() != ROM_SHA1:
        raise ValueError("Exact FireRed USA/Europe Rev1 original required")
    output.mkdir(parents=True, exist_ok=False)
    elf_path = source / "pokefirered_rev1.elf"
    elf = elf_path.read_bytes()
    symbol_text = subprocess.check_output(["arm-none-eabi-nm", "-S", str(elf_path)], text=True, timeout=30)
    (output / "source-symbols.txt").write_text(symbol_text)
    symbols = {p[3]: (int(p[0], 16), int(p[1], 16))
               for line in symbol_text.splitlines() if len(p := line.split()) == 4}
    sys.path.insert(0, str(ROOT / "tools/behavior_ir"))
    from lift import Lifter
    from lower import lower
    dependencies, attempts, parent_paths = {}, [], []
    for label, entry, symbol in TARGETS:
        step = time.perf_counter()
        address, size = symbols[symbol]
        if address != int(entry, 16):
            raise ValueError("Unexpected Rev1 source symbol placement: " + symbol)
        span = raw[address-0x08000000:address-0x08000000+size]
        if elf_range(elf, address, size) != span:
            raise ValueError("ELF source bytes differ from original: " + symbol)
        (output / (entry + ".source-span.bin")).write_bytes(span)
        disassembly = subprocess.check_output([
            "arm-none-eabi-objdump", "-d", "--start-address=" + hex(address),
            "--stop-address=" + hex(address + size), str(elf_path)], text=True, timeout=30)
        (output / (entry + ".disassembly.txt")).write_text(disassembly)
        row = {"label": label, "entry": entry, "symbol": symbol, "source_span_size": size,
               "source_span_sha256": hashlib.sha256(span).hexdigest(), "elf_matches_original": True,
               "generated_native_bytes": 0, "native_proof_run": False}
        l0path = Path(l0_root) / (entry + ".json")
        if l0path.is_file():
            row["l0"] = pin(l0path)
            l0 = json.loads(l0path.read_text())
            save(output / (entry + ".l0.json"), l0)
            if label not in ("initialize", "acknowledge"):
                parent_paths.append(l0path)
            try:
                behavior, adapter = Lifter(l0, raw, dependencies).build()
                dependencies[entry] = (behavior, adapter)
                save(output / (entry + ".l1.json"), behavior)
                save(output / (entry + ".adapter.json"), adapter)
                (output / (entry + ".generated.c")).write_text(lower(behavior))
                row.update(outcome="static-lowering-pass", qualification="not-run",
                           dependency_entries=list(behavior.get("dependencies", [])))
            except ValueError as error:
                row.update(outcome="blocked", error_type=type(error).__name__, reason=str(error))
        else:
            row.update(outcome="blocked", reason="No retained L0 at selected path; source ELF/disassembly only")
        row["seconds"] = time.perf_counter() - step
        attempts.append(row)
        save(output / "attempts.json", attempts)
    frontier = mine(prior, baseline, parent_paths)
    save(output / "dependency-frontier.json", frontier)
    profile = {"id": "firered-rev1-text-wait-frontier/1", "original_sha256": ROM_SHA256,
               "original_sha1": ROM_SHA1, "dependency_frontier": pin(output / "dependency-frontier.json"),
               "scope": "Source-backed text wait parent audit; graphics/audio/dispatcher closure remains open"}
    save(output / "profile.json", profile)
    validate_profile_frontier(profile)
    service_address, service_size = symbols["PlaySE"]
    service_span = raw[service_address-0x08000000:service_address-0x08000000+service_size]
    if service_address != 0x080722e0 or elf_range(elf, service_address, service_size) != service_span:
        raise ValueError("PlaySE source service differs from pinned ROM")
    (output / "080722e0.source-span.bin").write_bytes(service_span)
    result = {"schema": "gameverse.firered-text-audit/1", "outcome": "blocked-parent-closure",
              "original": pin(original), "original_sha1": ROM_SHA1,
              "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "source_elf": pin(elf_path), "source_text": pin(source / "src/text.c"),
              "source_layout": pin(source / "include/text.h"), "tool": pin(Path(__file__)),
              "compiler": pin(ROOT / "tools/behavior_ir/lift.py"), "prior_native_report": pin(prior),
              "attempts": attempts, "profile": profile,
              "source_contract": {
                  "state_authority": "Original caller-owned TextPrinter; synchronous call boundaries; lifecycle and IRQ concurrency unproven",
                  "shared_storage": ["r0+0x15 packed arrow delay/index", "r0+0x16 autoScrollDelay", "03003e50 bit2 autoScroll", "0203adfa quest log state"],
                  "scheduling": "RenderText states 2 and 3 consume WaitWithDownArrow; state1 consumes Wait; 0xfa/0xfb initialize before later wait invocations",
                  "auto_only_domain_admitted": False,
                  "domain_reason": "Mutable global policy; field_message_box initializes false, battle_message selects true or false, playback may select true; no general parent invariant",
                  "policy_sources": [pin(source / "src" / name) for name in ("field_message_box.c", "battle_message.c", "new_menu_helpers.c")],
                  "smallest_next_parent": {"entry": "08005694", "argument": "r0 caller-owned TextPrinter pointer", "return": "bool16 normalized 0/1",
                      "calls": ["0800561c auto wait", "080722e0 PlaySE with r0=5 on new A/B input"],
                      "reads": ["03003e50 byte bit2", "0300311e halfword &3"],
                      "service_gap": "No supported retained-host call IR/binding; PlaySE reads02031dd8/0203adfa and may call081dd164 m4aSongNumStart with observable audio state effects",
                      "retained_service_work_item": {
                          "entry": "080722e0", "symbol": "PlaySE", "source": pin(source / "src/sound.c"),
                          "source_span_size": service_size, "source_span_sha256": hashlib.sha256(service_span).hexdigest(),
                          "original_sha256": ROM_SHA256, "input_abi": "r0 low16 soundId; this caller passes5 (SE_SELECT)",
                          "return_abi": "void; caller ignores R0", "state_authority": "Original native sound driver owns audio state; generated storage must not snapshot/overwrite that state",
                          "effects": "Conditional original m4aSongNumStart081dd164; audio state and scheduling effects remain unknown, not pure or optional",
                          "required_backend": "Explicit source-pinned native host-service statement plus call-boundary state synchronization and ABI checks",
                          "required_proof": "Original and rebuilt parent state/return parity AND real service invocation/observable side-effect parity; do not mock return or no-op sound",
                          "lifetime": "Original audio task/interrupt scheduler retained; timing/concurrency closure remains unknown"}}},
              "new_rom": None, "new_native_proofs": 0, "new_ir_regenerated_bytes": 0,
              "source_coverage": {"new_parent_bytes_regenerated": 0, "whole_text_system_closed": False},
              "raw_comparison": "No new ROM; prior raw comparison remains separate and unchanged",
              "whole_game_equivalent": None,
              "limitations": ["ELF byte witnesses do not independently authenticate historical L0 export provenance", "Static lowering of existing leaves is not a fresh native proof", "No original behavior fallback or service stubs emitted"],
              "timing": {"total_seconds": time.perf_counter()-started, "queue_seconds": None,
                  "build_seconds": None, "native_seconds": None, "mode": "static-source-SSA-audit",
                  "stages_nested_in_total": True, "machine": platform.platform(), "python": platform.python_version(),
                  "comparable_before_seconds": None}}
    save(output / "audit-report.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--rebuilt", type=Path, help="Run bounded real-service native parity instead of static audit")
    operation.add_argument("--build-service", action="store_true", help="Fresh automatic Wait lift/build with retained real PlaySE and registered native proof")
    parser.add_argument("--baseline", type=Path, default=BASELINE)
    args = parser.parse_args()
    if args.build_service:
        from .ir_provider import run
        report = run(wait_service_profile(), args.original, args.baseline, args.output, 64)
        print(json.dumps({"outcome": report["outcome"], "report": str(args.output / "provider-report.json"),
                          "rebuilt_sha256": report["rebuilt_sha256"], "timing": report["timing"]}, indent=2))
        return
    if args.rebuilt:
        result = qualify_native_service(args.original, args.rebuilt, args.output)
        print(json.dumps({"outcome": result["outcome"], "kind": result["kind"],
                          "report": str(args.output / "parity-report.json"), "timing": result["timing"]}, indent=2))
        if result["outcome"] != "pass":
            raise SystemExit(1)
        return
    result = audit(args.original, args.output)
    print(json.dumps({"outcome": result["outcome"], "report": str(args.output / "audit-report.json"),
                      "new_ir_regenerated_bytes": 0, "timing": result["timing"]}, indent=2))


if __name__ == "__main__":
    main()
