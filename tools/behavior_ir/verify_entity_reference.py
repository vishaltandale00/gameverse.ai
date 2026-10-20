"""Narrow source-pointer regressions; reads the pinned Minish original L0."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import time
from entity_reference import validate_contracts, validate_access, validate_adapter, resolve
from lift import Unsupported, const

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'local/ir/fleet-next/legend-of-zelda-the-the-minish-cap/script-command-ex050/l0/0807f078.json'
CONTRACT = dict(id='script_cursor', cell_argument='r1', cell_offset=0,
                cell_extent=28, target_extent=6,
                readable_ranges=[dict(offset=2, size=4)],
                storage='readonly_during_call_ram', separation='distinct_accessed_views',
                evidence=['Pinned original Minish L0 0807f078 op0 context r1 cursor; op3/op6 u16 reads +2/+4'])


def run():
    started = time.perf_counter()
    source = json.loads(SOURCE.read_text())
    argument = dict(entity_references=[CONTRACT])
    positive, negative = 0, 0

    def accept(l0=source, ac=argument):
        nonlocal positive
        assert validate_contracts(l0, ac) == ac['entity_references']
        positive += 1

    def reject(l0=source, ac=argument):
        nonlocal negative
        try:
            validate_contracts(l0, ac)
        except Unsupported:
            negative += 1
        else:
            raise AssertionError('unsafe entity pointer source accepted')

    accept()
    assert validate_contracts(source, {}) == []
    # Shape-preserving COPY and constant PTRADD/PTRSUB are generic SSA support.
    for opcode in ('COPY', 'PTRADD', 'PTRSUB'):
        l0 = deepcopy(source)
        ops = l0['blocks'][0]['ops']
        if opcode == 'COPY':
            ops[2]['opcode'] = 'COPY'
        elif opcode == 'PTRSUB':
            ops[1]['opcode'] = 'PTRSUB'
        else:
            l0['varnodes'].append(dict(id='scale', size=4, space='const', offset='1', constant=True, input=False))
            ops[1].update(opcode='PTRADD', inputs=['v0', 'v4', 'scale'])
        accept(l0)
    lifter = SimpleNamespace(l0=source, argument_contract=argument,
                             v={v['id']: v for v in source['varnodes']})
    found = resolve(lifter, ('entity', 'r1', const(0)), source['blocks'][0]['ops'][0])
    assert found == ('script_cursor', CONTRACT)
    assert resolve(lifter, ('entity', 'r0', const(0)), source['blocks'][0]['ops'][0]) is None
    assert resolve(lifter, ('global', 0x02000000, const(0)), source['blocks'][0]['ops'][0]) is None
    assert not hasattr(lifter, 'object_refs')
    # Every consumer is audited, including otherwise dead scalar/address escapes.
    for opcode, inputs in [
        ('INT_EQUAL', ['v0', 'v4']),
        ('RETURN', ['v0']),
        ('CALL', ['v13', 'v0']),
        ('CALLIND', ['v0']),
        ('STORE', ['v1', 'v5', 'v6']),
        ('STORE', ['v1', 'v2', 'v6']),
        ('STORE', ['v1', 'v2', 'v0']),
        ('MULTIEQUAL', ['v0', 'v0']),
        ('INT_ADD', ['v0', 'v6']),
        ('INT_SUB', ['v0', 'v4']),
        ('INDIRECT', ['v0', 'v4']),
    ]:
        l0 = deepcopy(source)
        l0['varnodes'].append(dict(id='extra', size=4, space='unique', offset='0', constant=False, input=False))
        l0['blocks'][0]['ops'].append(dict(id='bad', opcode=opcode, inputs=inputs, output='extra'))
        reject(l0)
    for change in [
        {'evidence': []}, {'cell_extent': 3}, {'target_extent': 8193},
        {'cell_offset': 25}, {'cell_offset': -1}, {'target_extent': 5},
        {'storage': 'rom'}, {'separation': 'unknown'},
        {'readable_ranges': [{'offset': 2, 'size': 3}]},
        {'readable_ranges': [{'offset': 2, 'size': 4}, {'offset': 3, 'size': 1}]},
        {'readable_ranges': [{'offset': -1, 'size': 4}]},
        {'readable_ranges': [{'offset': 2, 'size': 0}]},
    ]:
        ac = deepcopy(argument)
        ac['entity_references'][0].update(change)
        reject(ac=ac)
    ac = deepcopy(argument)
    ac['entity_references'].append(deepcopy(CONTRACT))
    reject(ac=ac)
    for var in ('v0', 'v2', 'v3'):
        l0 = deepcopy(source)
        next(v for v in l0['varnodes'] if v['id'] == var)['size'] = 8
        reject(l0)
    l0 = deepcopy(source)
    next(v for v in l0['varnodes'] if v['id'] == 'v4')['offset'] = '4294967295'
    reject(l0)
    for start, size, write in [(2, 2, False), (4, 2, False), (2, 4, False)]:
        assert validate_access(CONTRACT, start, size, write)
        positive += 1
    for start, size, write in [(-1, 2, False), (0, 2, False), (4, 4, False),
                               (2, 2, True), (0xffffffff, 2, False), (2, 0, False)]:
        try:
            validate_access(CONTRACT, start, size, write)
        except Unsupported:
            negative += 1
        else:
            raise AssertionError('unsafe target read/write accepted')
    adapter = dict(argument_contract=argument, entity_references=[dict(CONTRACT, name='script_cursor')],
                   fields=[dict(owner='reference', reference='script_cursor', offset=2, width=16)], collections=[])
    assert validate_adapter(adapter) == [CONTRACT]
    positive += 1
    bad_adapters = []
    for field in [dict(owner='entity', argument='r1', offset=0, width=32),
                  dict(owner='reference', reference='script_cursor', offset=0, width=16),
                  dict(owner='reference', reference='unknown', offset=2, width=16)]:
        bad = deepcopy(adapter)
        bad['fields'].append(field)
        bad_adapters.append(bad)
    for collection in [dict(owner='reference', reference='script_cursor', offset=2, size=2, count=2),
                       dict(owner='entity', argument='r1', offset=0, size=2, count=2)]:
        bad = deepcopy(adapter)
        bad['collections'].append(collection)
        bad_adapters.append(bad)
    bad = deepcopy(adapter)
    bad['object_references'] = [dict(name='other', cell=0x02000000)]
    bad_adapters.append(bad)
    bad = deepcopy(adapter)
    bad['entity_references'][0]['target_extent'] = 8
    bad_adapters.append(bad)
    for bad in bad_adapters:
        try:
            validate_adapter(bad)
        except Unsupported:
            negative += 1
        else:
            raise AssertionError('unsafe standalone adapter accepted')
    print(json.dumps(dict(outcome='pass', positive=positive, rejected=negative,
                          source=str(SOURCE.relative_to(ROOT)),
                          scope='source/descriptor audit; no native execution or CI added',
                          wall_s=time.perf_counter()-started)))


if __name__ == '__main__':
    run()
