"""Read-only special-root proof from actual GNU assembler macro expansion.

No table is pruned here. Incoming RAM-script protocol ownership is a separate
capability obligation; a static listing alone cannot prove those operands.
"""
from __future__ import annotations
from collections import Counter
import hashlib
from pathlib import Path
import re

from .scripts import source_closure


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _lines(path: Path):
    with path.open() as stream:
        yield from stream


def _lineage(physical: int, provenance: dict, chains: dict) -> list[dict]:
    statement = provenance.get(physical, {}).get('statement', '')
    root = re.match(r'(FR_[A-Za-z_]\w*)\s*(.*)', statement)
    prefix = [{'macro': root[1], 'arguments': root[2]}] if root else []
    return prefix + list(chains.get(physical, []))


def audit_assembler_roots(donor: Path, expanded_source: Path, listing: Path,
                          *, runtime_source: Path | None = None) -> dict:
    donor, expanded_source, listing = map(Path, (donor, expanded_source, listing))
    registry = re.findall(r'(?m)^\s*def_special\s+(\w+)', (donor / 'data/specials.inc').read_text())
    # Physical source lines are retained in -alm output even for nested macro
    # expansions; CPP #line records recover the exact staged source callsite.
    provenance = {}
    path, logical = str(expanded_source), 1
    for physical, line in enumerate(expanded_source.read_text().splitlines(), 1):
        marker = re.match(r'\s*#\s+(\d+)\s+"([^"]+)"', line)
        if marker:
            logical, path = int(marker[1]), marker[2]
        else:
            provenance[physical] = {'path': path, 'line': logical, 'statement': line.strip()}
            logical += 1
    calls, native_calls, unknown, chains = [], [], [], {}
    for line in _lines(listing):
        row = re.match(r'^\s*(\d+)\s+(.*)', line)
        if not row:
            continue
        physical, rest = int(row[1]), row[2]
        direct = re.match(r'FR_(callnative|gotonative)\s+', provenance.get(physical, {}).get('statement', ''))
        pointer = re.match(r'[0-9a-fA-F]+\s+[0-9a-fA-F]{2,}\s+.*?\.4byte\s+(\S+)', rest)
        if direct and pointer:
            operand = pointer[1]
            if re.fullmatch(r'[A-Za-z_]\w*', operand):
                native_calls.append({'name': operand, 'physicalLine': physical, 'callsite': provenance.get(physical),
                                     'lineage': [{'macro': 'FR_' + direct[1], 'arguments': operand}]})
            else:
                unknown.append({'kind': 'dynamic-native-pointer', 'operand': operand, 'physicalLine': physical})
        macro = re.search(r'>+\s+(FR_[A-Za-z_]\w*)\s*(.*)', rest)
        if macro:
            chains.setdefault(physical, []).append({'macro': macro[1], 'arguments': macro[2].strip()})
            if macro[1] in ('FR_callnative', 'FR_gotonative'):
                operand = macro[2].strip()
                if not re.fullmatch(r'[A-Za-z_]\w*', operand):
                    unknown.append({'kind': 'dynamic-native-pointer', 'operand': operand, 'physicalLine': physical})
                else:
                    native_calls.append({'name': operand, 'physicalLine': physical, 'callsite': provenance.get(physical), 'lineage': _lineage(physical, provenance, chains)})
        # Require encoded bytes, excluding the macro definition's unbound
        # SPECIAL_\function and all .set registry declarations.
        emitted = re.match(r'[0-9a-fA-F]+\s+[0-9a-fA-F]{2,}\s+.*?\.2byte\s+FR_SPECIAL_(\S+)', rest)
        if not emitted:
            continue
        operand = emitted[1]
        if not re.fullmatch(r'[A-Za-z_]\w*', operand) or operand not in registry:
            unknown.append({'kind': 'unresolved-special-operand', 'operand': operand, 'physicalLine': physical})
            continue
        calls.append({'name': operand, 'physicalLine': physical, 'callsite': provenance.get(physical),
                      'lineage': _lineage(physical, provenance, chains)})
    counts = Counter(call['name'] for call in calls)
    source_native_sites, raw_opcode_sites = [], []
    for relative, text in source_closure(donor).items():
        for number, line in enumerate(text.splitlines(), 1):
            if re.match(r'\s*(callnative|gotonative)\b', line):
                source_native_sites.append({'path': relative, 'line': number, 'statement': line.strip()})
            if re.match(r'\s*\.(?:byte|1byte)\s+(?:0x(?:25|26)|37|38)\b', line):
                raw_opcode_sites.append({'path': relative, 'line': number, 'statement': line.strip(),
                                         'status': 'ambiguous-raw-opcode-needs-source-domain-proof'})
    native_consumers = []
    for path in sorted((donor / 'src').rglob('*.c')):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if re.search(r'\bgSpecials\b', line):
                native_consumers.append({'path': str(path.relative_to(donor)), 'line': number,
                                         'statement': line.strip()})
    last_index = {name: index for index, name in enumerate(registry)}
    retained = sorted(counts, key=lambda name: last_index[name])
    proposed = {name: index for index, name in enumerate(retained)}
    runtime = Path(runtime_source) if runtime_source is not None else donor
    boundary_rows = []
    for relative, expressions in {
        'src/mystery_event_script.c': ('MEScrCmd_runscript', 'RunScriptImmediately(script)', 'MEScrCmd_initramscript', 'InitRamScript('),
        'src/script.c': ('void RunScriptImmediately', 'InitScriptContext(&sImmediateScriptContext', 'GetRamScript', 'CalculateRamScriptChecksum'),
        'src/scrcmd.c': ('bool8 ScrCmd_special(', 'bool8 ScrCmd_specialvar(', 'gSpecials[ScriptReadHalfword'),
    }.items():
        source_path = runtime / relative
        if not source_path.exists(): continue
        for number, line in enumerate(source_path.read_text().splitlines(), 1):
            if any(expression in line for expression in expressions):
                boundary_rows.append({'path': relative, 'line': number, 'statement': line.strip()})
    return {'schema': 'single-rom-special-registry-proof/1',
            'status': 'static-operands-bound' if calls and not unknown and not raw_opcode_sites else 'blocked',
            'pruningAuthorized': False,
            'inputs': {'expandedSource': {'path': str(expanded_source), 'sha256': _digest(expanded_source)},
                       'assemblerListing': {'path': str(listing), 'sha256': _digest(listing)},
                       'donorRegistrySha256': _digest(donor / 'data/specials.inc')},
            'originalSlots': len(registry), 'originalUniqueFunctions': len(set(registry)),
            'staticSpecialRoots': len(counts), 'staticSpecialEmissions': len(calls),
            'specialCounts': dict(sorted(counts.items())), 'callsites': calls,
            'directNativeCalls': native_calls, 'sourceNativeSites': source_native_sites,
            'unknownOperands': unknown, 'ambiguousRawOpcodes': raw_opcode_sites,
            'nativeRegistryConsumers': native_consumers, 'runtimeDispatchEvidence': boundary_rows,
            'proposedStaticOnlyRemap': {'order': 'ascending original last symbol index',
                'namesToCompactSlots': proposed,
                'sourceSlotsToCompactSlots': {str(i): proposed[name] for i, name in enumerate(registry) if name in proposed},
                'unreferencedFunctions': sorted(set(registry) - set(counts)),
                'nullFieldSpecial': {'sourceSlots': [i for i, name in enumerate(registry) if name == 'NullFieldSpecial'],
                                     'staticEmissions': counts.get('NullFieldSpecial', 0),
                                     'policy': 'retain exact genuine implementation if a root; no replacement stub'}},
            'capabilityObligations': [{'id': 'received-ram-script-special-abi', 'status': 'requires-native-protocol-ownership-proof',
                'meaning': 'Prove received bytecode is native Emerald ABI with original native prefix unchanged. Unknown raw FireRed RAM bytecode needs explicit rejection or opcode-aware validation/remapping before donor compaction. Static imported donor names use FR_SPECIAL_ symbols.',
                'runtimeSource': str(runtime), 'evidence': boundary_rows}]}
