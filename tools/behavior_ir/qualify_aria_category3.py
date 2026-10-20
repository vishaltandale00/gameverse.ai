"""One bounded automatic category3 soul transaction; ROM/HighFunction inputs only.
Prepared source-derived expectations are validation fixtures, never behavior C.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / 'local/ir/aria-category3-closure-20261016'
L0 = ROOT / 'local/ir/queue-runs/20261016T090315/castlevania-aria-of-sorrow/l0'
ROM = ROOT / 'local/roms/Castlevania - Aria of Sorrow (USA).gba'
PLAN = ROOT / 'research/automatic-ir/aria-soul-next-round/acceptance-plan.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def profiles():
    meaning = {'quantity': 'packed_four_bit_inventory', 'unit': {'numerator': 1, 'denominator': 1},
               'frame': 'inventory.soul.category3', 'confidence': 0.95,
               'evidence': ['research/automatic-ir/aria-soul-next-round/acceptance-plan.json'],
               'naming_status': 'source_derived_inventory_layout_not_behavior_input'}
    common = {'role': 'progression', 'semantics': {},
              'source_evidence': {'record': str(PLAN.relative_to(ROOT)), 'scope': 'category3 only; not cast/pickup/equip/gameplay closure'},
              'limitations': ['Exact category3 invocation precondition; other categories remain unqualified by this package',
                              'Index0..7 only; low-level source functions do not enforce capacity',
                              'One four-byte packed collection backs both source banks; acquisition rereads after rollback',
                              'No cast, enemy, pickup, equip or complete progression lifecycle claim']}
    result = []
    for entry, name, title in [('08032588', 'adjust', 'Adjust category3 packed soul count'),
                               ('080326b8', 'count', 'Count category3 aliased soul-bank quantity'),
                               ('0803278c', 'acquire', 'Acquire category3 packed soul quantity with alias-preserving rollback')]:
        p = dict(common, entry=entry, id='aria.progress.category3_' + name, title=title)
        p['domains'] = ({'r0': {'unsigned_min': 0, 'unsigned_max': 1},
                         'r1': {'unsigned_min': 3, 'unsigned_max': 3},
                         'r2': {'unsigned_min': 0, 'unsigned_max': 7}}
                        if name == 'adjust' else
                        {'r0': {'unsigned_min': 3, 'unsigned_max': 3},
                         'r1': {'unsigned_min': 0, 'unsigned_max': 7}})
        if name in ('adjust','count'):
            p['discovery_only'] = True  # Linked helper, not a separate promoted target.
        if name != 'adjust':
            p['public_collections'] = {'collection_0': meaning}
            p['causal_fixture'] = str((RUN / 'fixtures' / (entry + '.json')).relative_to(ROOT))
        if name == 'count':
            evidence = RUN / 'count-return-abi.json'
            p['argument_contract'] = {'return_abi': {'unsigned_extension': 'u32',
                'evidence': [str(evidence.relative_to(ROOT))],
                'source_evidence_sha256': sha(evidence) if evidence.exists() else None}}
        result.append(p)
    return result


def fixtures(entry, adapter):
    plan = json.loads(PLAN.read_text())
    source = [r for r in plan['cases'] if r['entry'] == entry and r['args'][0] == 3]
    rows = []
    # The prepared first/last-byte cases are extended to every byte in this
    # category using identical parity/value expectations; no behavior is authored.
    for index in range(8):
        for row in source:
            if row['args'][1] != index % 2:
                continue
            row = dict(row, args=list(row['args']), id=row['id'] + '-index' + str(index))
            row['args'][1] = index
            old = next(iter(row['memory']))
            address = f'{0x02013392 + index // 2:08x}'
            row['memory'] = {address: row['memory'][old]}
            if 'expected_memory' in row:
                row['expected_memory'] = {address: row['expected_memory'][old]}
            rows.append(row)
    data = {'parameter_values': [], 'collection_values': [], 'expected_collections': [],
            'global_collection_canary_bytes': 8,
            'context': {'kind': 'source-derived category3 alias and full-return cases',
                        'plan': str(PLAN.relative_to(ROOT)), 'plan_sha256': sha(PLAN),
                        'case_ids': [r['id'] for r in rows], 'scope': 'all8 indices; both nibble parities; canonical alias rollback/reread; not gameplay'}}
    if entry == '080326b8':
        data['expected_returns'] = []
    for row in rows:
        data['parameter_values'].append({p['name']: row['args'][int(p['register'][1:])]
                                         for p in adapter['parameters']})
        before, after = {}, {}
        for c in adapter['collections']:
            assert c['address'] == 0x02013392 and c['size'] == 1 and c['count'] == 4
            values = [0x31, 0x53, 0x75, 0x97]
            for address, value in row['memory'].items():
                values[int(address, 16) - c['address']] = value
            before[c['name']] = values
            expected = list(values)
            for address, value in row.get('expected_memory', row['memory']).items():
                expected[int(address, 16) - c['address']] = value
            after[c['name']] = expected
        data['collection_values'].append(before)
        data['expected_collections'].append(after)
        if entry == '080326b8':
            data['expected_returns'].append(row['expected_return_r0'])
    return data


def run(out, vectors):
    from lift import Lifter
    from contract import validate
    from lower import lower
    from qualify import qualify
    out.mkdir(parents=True, exist_ok=False)
    RUN.mkdir(parents=True, exist_ok=True)
    raw = ROM.read_bytes()
    tail = raw[0x32780:0x3278c]
    assert tail == bytes.fromhex('08180006000e30bc02bc0847')
    abi = {'kind': 'own_ROM_explicit_unsigned_return_extension', 'rom_sha256': sha(ROM),
           'span': {'address': '08032780', 'bytes': 12, 'sha256': hashlib.sha256(tail).hexdigest()},
           'instructions': ['ADD r0,r1,r0', 'LSL r0,r0,24', 'LSR r0,r0,24', 'POP r4,r5', 'POP r1', 'BX r1'],
           'result': 'full32bit r0 is zero-extended low8 result; two masked nibbles sum0..30',
           'evidence_input': 'ROM bytes and cached HighFunction, never recovered C'}
    (RUN / 'count-return-abi.json').write_text(json.dumps(abi, indent=2) + '\n')
    compiled, reports = {}, []
    started = time.perf_counter()
    for p in profiles():
        entry = p['entry']
        source = L0 / (entry + '.json')
        t = time.perf_counter()
        x, a = Lifter(json.loads(source.read_text()), raw, compiled, p['domains'],
                      argument_contract=p.get('argument_contract')).build()
        x['limitations'].extend(p['limitations'])
        validate(x)
        compiled[entry] = (x, a)
        destination = out / entry
        destination.mkdir()
        for name, value in [('l1.json', x), ('validation-adapter.json', a)]:
            (destination / name).write_text(json.dumps(value, indent=2) + '\n')
        (destination / 'generated.c').write_text(lower(x))
        report = {'entry': entry, 'l0_sha256': sha(source), 'lift_wall_s': time.perf_counter()-t,
                  'schema': 'gameverse.aria-category3-target/1', 'outcome': 'linked_helper_only'}
        if entry!='08032588':
            data = fixtures(entry, a)
            envelope = {'schema': 'gameverse.ir.causal-port-fixtures/1',
                        'adapter_sha256': sha(destination / 'validation-adapter.json'),
                        'l0_sha256': a['l0_sha256'], 'fixture_data': data}
            fixture_path = ROOT / p['causal_fixture']
            fixture_path.parent.mkdir(parents=True, exist_ok=True)
            fixture_path.write_text(json.dumps(envelope, indent=2) + '\n')
            (destination / 'fixtures.json').write_text(json.dumps(data, indent=2) + '\n')
            receipt = qualify(destination, ROM, vectors, fixtures=data)
            report.update(outcome=receipt['outcome'], error=receipt.get('error'),
                          fixture_cases=len(data['parameter_values']), vectors=vectors,
                          qualification_wall_s=receipt['wall_s'])
        reports.append(report)
    result = {'run_id': out.name, 'outcome': 'pass' if all(r['outcome'] in ('pass', 'linked_helper_only') for r in reports) else 'failed',
              'rows': reports, 'wall_s': time.perf_counter()-started,
              'source_input': 'own ROM + original HighFunction only', 'promotion': 'none until independent semantic review'}
    (out / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--vectors', type=int, default=1024)
    args = parser.parse_args()
    print(json.dumps(run(args.out.resolve(), args.vectors), indent=2))
