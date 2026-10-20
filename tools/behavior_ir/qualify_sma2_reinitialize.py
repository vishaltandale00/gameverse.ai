"""One existing-export SMA2 actor-reset/descriptor transaction, automatic L1.
Expected bytes/table lookups are independent native fixtures, never behavior C.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / 'local/ir/sma2-reinitialize-20261016'
SOURCE = ROOT / 'research/deep-extraction/mario/parallel-sma2/l0-export-20261016T1033-retry1/l0'
EVIDENCE = ROOT / 'research/deep-extraction/mario/parallel-sma2/dependency-contracts.json'
ROM = ROOT / 'local/roms/Super Mario Advance 2 - Super Mario World (USA, Australia).gba'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def profiles():
    entries = [('0802eb64', 'actor_descriptor_fields'), ('0802eb44', 'actor_descriptor_begin'),
               ('0802ea54', 'actor_transient_reset'), ('0802ebec', 'actor_reinitialize')]
    result = []
    for entry, name in entries:
        p = {'entry': entry, 'id': 'sma2.'+name, 'title': name.replace('_', ' ').capitalize(),
             'role': 'combat', 'domains': {}, 'semantics': {}, 'discovery_only': entry != '0802ebec',
             'source_evidence': {'record': str(EVIDENCE.relative_to(ROOT)), 'sha256': sha(EVIDENCE)},
             'limitations': ['Normal12-slot actor pool only; one shared scene backing, no independent actor copies',
                 'Native cases cover all256 types times two selected lifecycle states1/11 times12 slots, not every possible state value',
                 'Descriptor channels retain exact original byte identities; individual flag meanings remain unknown',
                 'Other pools, actor controller/fire/pickup/terrain/save/scene lifecycle remain open']}
        if entry in ('0802ea54', '0802ebec'):
            p['argument_contract'] = {'shared_views': [{'argument': 'r0', 'root_cell': '03003f98',
                'base_offset': 0x6cc, 'stride': 100, 'count': 12, 'evidence': [str(EVIDENCE.relative_to(ROOT))]}]}
        if entry == '0802ebec':
            def meaning(quantity, frame, label):
                return {'quantity': quantity, 'unit': {'numerator': 1, 'denominator': 1},
                        'frame': frame, 'label': label, 'confidence': 0.95,
                        'evidence': [str(EVIDENCE.relative_to(ROOT))],
                        'naming_status': 'source_derived_field_identity_not_behavior_input'}
            p['field_annotations'] = {
                'entity:r0:26': meaning('enum', 'sma2.actor.type', 'Original actor type'),
                'entity:r0:28': meaning('enum', 'sma2.actor.lifecycle', 'Original actor lifecycle state')}
            for i, offset in enumerate([62, 63, 64, 65, 66, 67, 68, 53]):
                p['field_annotations']['entity:r0:'+str(offset)] = meaning(
                    'bitset', 'sma2.actor.descriptor.channel_'+str(i), 'Original descriptor channel '+str(i))
            p['causal_fixture'] = str((RUN/'fixtures.json').relative_to(ROOT))
        result.append(p)
    return result


def fixtures(adapter):
    evidence = json.loads(EVIDENCE.read_text())
    raw = ROM.read_bytes()
    for span in evidence['instruction_spans'] + evidence['descriptor_tables']:
        start = int(span['address'], 16)-0x08000000
        assert hashlib.sha256(raw[start:start+span['size']]).hexdigest() == span['sha256']
    fields = adapter['fields']
    entity = {f['offset']: f for f in fields if f['owner'] == 'entity'}
    world = next(f for f in fields if f['owner'] == 'reference' and f['offset'] == 0x1194)
    tables = {int(t['actor_field'], 16): bytes.fromhex(t['bytes_hex']) for t in evidence['descriptor_tables']}
    rows, expected, ids = [], [], []
    # Slot is the innermost dimension, matching the oracle's test%count view.
    for actor_type in range(256):
        for state in (1, 11):
            for slot in range(12):
                sequence = len(rows)
                assert sequence % 12 == slot
                initial = {f['name']: ((0x9e3779b9*(sequence+1)+i*0x10203+0x5a) & ((1<<f['width'])-1))
                           for i, f in enumerate(fields)}
                initial[entity[26]['name']] = actor_type
                initial[entity[28]['name']] = state
                initial[world['name']] = 0x10203040 ^ (actor_type << 8) ^ slot
                expected_row = {entity[26]['name']: actor_type, entity[28]['name']: state}
                index = actor_type - 0x2d if actor_type >= 0xf9 else actor_type
                for offset in (62, 63, 64, 65, 66, 67):
                    expected_row[entity[offset]['name']] = tables[offset][index]
                expected_row[entity[68]['name']] = tables[68][actor_type]
                expected_row[entity[53]['name']] = tables[64][actor_type] & 15
                expected_row[entity[96]['name']] = (initial[entity[96]['name']] if state == 11 else initial[world['name']])
                expected_row[world['name']] = initial[world['name']]
                rows.append(initial)
                expected.append(expected_row)
                ids.append('type'+str(actor_type)+'-state'+str(state)+'-slot'+str(slot))
    return {'states': rows, 'expected_field_subsets': expected,
            'context': {'source_evidence': str(EVIDENCE.relative_to(ROOT)), 'source_sha256': sha(EVIDENCE),
                        'case_ids': ids, 'scope': 'full256types x selectedstates1/11 x12slots; original type/state, descriptor remap/original tables, cleared high nibble and conditional scene copy; full backing canary comparison, not exhaustive other state',
                        'positions_and_unadmitted_bytes': 'fixed a5 canaries; not exhaustive position values'}}


def run(out):
    from lift import Lifter
    from contract import validate
    from lower import lower
    from qualify import qualify
    out.mkdir(parents=True, exist_ok=False)
    RUN.mkdir(parents=True, exist_ok=True)
    compiled = {}
    reports = []
    started = time.perf_counter()
    for p in profiles():
        t = time.perf_counter()
        source = SOURCE/(p['entry']+'.json')
        original = json.loads(source.read_text())
        x, a = Lifter(original, ROM.read_bytes(), compiled,
                      argument_contract=p.get('argument_contract')).build()
        assert original == json.loads(source.read_text())
        x['limitations'].extend(p['limitations'])
        for f in a['fields']:
            key = f['owner']+':'+str(f.get('argument'))+':'+str(f['offset'])
            if key in p.get('field_annotations', {}):
                next(z for z in x['state'] if z['name'] == f['name'])['semantic_type'] = p['field_annotations'][key]
        validate(x)
        compiled[p['entry']] = x, a
        destination = out/p['entry']
        destination.mkdir()
        for name, value in [('l1.json', x), ('validation-adapter.json', a)]:
            (destination/name).write_text(json.dumps(value, indent=2)+'\n')
        (destination/'generated.c').write_text(lower(x))
        report = {'entry': p['entry'], 'l0_sha256': sha(source),
                  'outcome': 'linked_helper_only', 'lift_wall_s': time.perf_counter()-t}
        if p['entry'] == '0802ebec':
            view = a['argument_views'][0]
            assert view['base_offset'] == 0x6cc and view['stride'] == 100 and view['count'] == 12
            data = fixtures(a)
            envelope = {'schema': 'gameverse.ir.causal-port-fixtures/1', 'adapter_sha256': sha(destination/'validation-adapter.json'),
                        'l0_sha256': a['l0_sha256'], 'fixture_data': data}
            (RUN/'fixtures.json').write_text(json.dumps(envelope, indent=2)+'\n')
            receipt = qualify(destination, ROM, 6144, fixtures=data)
            report.update(outcome=receipt['outcome'], error=receipt.get('error'),
                          vectors=6144, exact_cases_included=len(data['states']),
                          qualification_wall_s=receipt['wall_s'])
        reports.append(report)
    result = {'run_id': out.name, 'outcome': reports[-1]['outcome'], 'rows': reports,
              'wall_s': time.perf_counter()-started, 'promotion': 'none until semantic review',
              'scope': 'full product256 types x two states1/11 x12slots; not all state/position/scene values'}
    (out/'summary.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.out.resolve()), indent=2))
