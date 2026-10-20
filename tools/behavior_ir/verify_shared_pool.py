"""Small compiler regression: overlapping actor/world lanes and live scalar ABI.
Runs synthetic HighFunction-shaped inputs through the real lift/lower path.
This is compiler verification, never source-game recovery evidence.
"""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import time
from contract import validate
from lift import Lifter, Unsupported
from lower import lower


def fixture():
    nodes = []
    ops = []
    def var(size=4, **kw):
        name = 'v' + str(len(nodes))
        nodes.append(dict(id=name, size=size, constant=False, input=False,
                          space='unique', offset=0, **kw))
        return name
    def literal(value, size=4):
        name = var(size)
        nodes[-1].update(constant=True, space='const', offset=value)
        return name
    def argument(register):
        name = var()
        nodes[-1].update(input=True, space='register', register=register)
        return name
    def op(code, inputs, size=None):
        out = var(size) if size else None
        ops.append(dict(id='o' + str(len(ops)), opcode=code, inputs=inputs,
                        **({'output': out} if out else {})))
        return out
    actor, scalar = argument('r0'), argument('r2')
    space = literal(0)
    world = op('LOAD', [space, literal(0x03007848)], 4)
    world1 = op('INT_ADD', [world, literal(1)], 4)
    world2 = op('INT_ADD', [world, literal(2)], 4)
    actor3 = op('INT_ADD', [actor, literal(3)], 4)
    op('STORE', [space, actor, scalar])
    snapshot = op('LOAD', [space, world1], 2)
    op('STORE', [space, world2, literal(0x7f, 1)])
    high = op('SUBPIECE', [snapshot, literal(1)], 1)
    op('STORE', [space, actor3, high])
    result = op('LOAD', [space, world], 4)
    op('RETURN', [literal(0), result])
    return dict(entry='00000000', varnodes=nodes,
                blocks=[dict(id=0, predecessors=[], successors=[], ops=ops)])


def run():
    started = time.perf_counter()
    contract = {'shared_views': [dict(argument='r0', root_cell='03007848',
                  stride=112, count=18, representation='canonical_typed_pool',
                  evidence=['synthetic_compiler_regression'])]}
    l1, adapter = Lifter(fixture(), b'', argument_contract=contract).build()
    validate(l1)
    assert len(l1['collections']) == 4
    assert all(c['storage_type'] == 'u8' and c['count'] == 18 for c in l1['collections'])
    assert [(p['register'], p.get('derived_pool_slot', False)) for p in adapter['parameters']] == [('r0', True), ('r2', False)]
    lanes = {c['offset']: c['name'] for c in adapter['collections']}
    source = lower(l1) + '\n#include <assert.h>\nint main(void){\n'
    source += 'for(unsigned slot=0;slot<18;slot++){LiftedState s={0};\n'
    for lane, name in lanes.items():
        source += f'for(unsigned j=0;j<18;j++)s.{name}[j]=(uint8_t)(0x10+j*4+{lane});\n'
    source += 'uint32_t result=behavior_0(&s,slot,0xa1b2c3d4u);\n'
    # Snapshot sees the new actor word only when the actor aliases record zero.
    source += 'assert(result==(slot==0?0xb27fc3d4u:0x137f1110u));\n'
    for lane, name in lanes.items():
        source += f'for(unsigned j=0;j<18;j++){{unsigned expected=0x10+j*4+{lane};'
        source += f'if(j==slot)expected=(0xa1b2c3d4u>>{lane*8})&255;'
        if lane == 2:
            source += 'if(j==0)expected=0x7f;'
        if lane == 3:
            source += 'if(j==slot)expected=slot==0?0xb2:0x12;'
        source += f'assert(s.{name}[j]==expected);}}\n'
    source += '}return 0;}\n'
    with tempfile.TemporaryDirectory(prefix='ir-pool-') as directory:
        path = Path(directory)
        (path / 'check.c').write_text(source)
        subprocess.run(['cc', '-std=c11', '-O1', path / 'check.c', '-o', path / 'check'], check=True, capture_output=True)
        subprocess.run([path / 'check'], check=True, capture_output=True)
    # Missing evidence, invalid capacity and record escapes must not promote.
    for field, value in [('count', 0), ('count', 65), ('stride', 3), ('evidence', [])]:
        bad = copy.deepcopy(contract)
        bad['shared_views'][0][field] = value
        try:
            Lifter(fixture(), b'', argument_contract=bad).build()
        except Unsupported:
            pass
        else:
            raise AssertionError('unproved pool domain promoted: ' + field)
    try:
        Lifter(fixture(), b'', argument_contract=contract,
               object_contract={'03007848': {'storage': 'readonly_during_call_ram'}}).build()
    except Unsupported:
        pass
    else:
        raise AssertionError('canonical write bypassed readonly owner')
    boundary = fixture()
    world_add = next(o for o in boundary['blocks'][0]['ops'] if o['opcode']=='INT_ADD')
    next(v for v in boundary['varnodes'] if v['id']==world_add['inputs'][1])['offset']=0xffffffff
    try:
        Lifter(boundary, b'', argument_contract=contract).build()
    except Unsupported as error:
        assert 'straddles backing boundary' in str(error)
    else:
        raise AssertionError('world access straddling record backing promoted')
    print(json.dumps(dict(outcome='pass', shared_slots=18, mixed_width_lanes=4,
                          rejected_contracts=6, live_scalar_register='r2',
                          wall_s=time.perf_counter()-started)))


if __name__ == '__main__':
    run()
