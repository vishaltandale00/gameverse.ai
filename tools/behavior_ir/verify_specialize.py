"""Tiny compiler regressions for exact-domain CFG/phi reduction and ABI guards."""
import copy
import json
import time
from contract import validate
from lift import Lifter, Unsupported
from specialize import reduce_cfg
from qualify_aria_category3 import ROOT, L0, ROM, profiles


def source():
    variables = [
        dict(id='v0', size=4, space='const', offset=0x08000000, constant=True, input=False),
        dict(id='v1', size=4, space='const', offset=0, constant=True, input=False),
        dict(id='v2', size=4, space='unique', offset=0, constant=False, input=False),
        dict(id='v3', size=4, space='register', register='r0', offset=32, constant=False, input=True),
        dict(id='v4', size=4, space='const', offset=3, constant=True, input=False),
        dict(id='v5', size=1, space='unique', offset=1, constant=False, input=False),
        dict(id='v6', size=4, space='const', offset=0x13392, constant=True, input=False),
        dict(id='v7', size=4, space='unique', offset=2, constant=False, input=False),
        dict(id='v8', size=4, space='unique', offset=3, constant=False, input=False),
        dict(id='v9', size=4, space='unique', offset=4, constant=False, input=False),
        dict(id='v10', size=1, space='unique', offset=5, constant=False, input=False),
    ]
    def op(i, code, inputs, out=None):
        return dict(id='op'+str(i), opcode=code, pc='08000004', inputs=inputs,
                    **({'output': out} if out else {}))
    return dict(entry='08000004', varnodes=variables, blocks=[
        dict(id=0, predecessors=[], successors=[1, 2], true_successor=1, false_successor=2,
             ops=[op(0, 'LOAD', ['v1', 'v0'], 'v2'), op(1, 'INT_EQUAL', ['v3', 'v4'], 'v5'), op(2, 'CBRANCH', ['v1', 'v5'])]),
        dict(id=1, predecessors=[0], successors=[3], ops=[op(3, 'INT_ADD', ['v2', 'v6'], 'v7')]),
        dict(id=2, predecessors=[0], successors=[3], ops=[op(4, 'COPY', ['v1'], 'v8')]),
        dict(id=3, predecessors=[1, 2], successors=[], ops=[op(5, 'MULTIEQUAL', ['v7', 'v8'], 'v9'), op(6, 'LOAD', ['v1', 'v9'], 'v10'), op(7, 'RETURN', ['v1', 'v10'])]),
    ])


def run():
    started = time.perf_counter()
    original = source()
    snapshot = copy.deepcopy(original)
    rom = (0x02000000).to_bytes(4, 'little')
    result, adapter = Lifter(original, rom, param_domains={'r0': {'unsigned_min': 3, 'unsigned_max': 3}}).build()
    validate(result)
    assert original == snapshot
    assert len(result['parameters']) == 1 and result['parameters'][0]['domain']['unsigned_min'] == 3
    assert adapter['fields'][0]['offset'] == 0x02013392 and result['assets'] == []
    assert len(adapter['domain_reductions']) == 1
    for domain in ({'unsigned_min': 0, 'unsigned_max': 3}, {'unsigned_min': 2, 'unsigned_max': 2}):
        try:
            Lifter(original, rom, param_domains={'r0': domain}).build()
        except Unsupported:
            pass
        else:
            raise AssertionError('unproved/null pointer path promoted')
    # A branch fed by mutable RAM must not become a compile-time decision.
    mutable = source()
    mutable['blocks'][0]['ops'][1]['inputs'][0] = 'v2'
    mutable['varnodes'][0]['offset'] = 0x03000000
    lifter = Lifter(mutable, b'', param_domains={'r0': {'unsigned_min': 3, 'unsigned_max': 3}})
    reduce_cfg(lifter)
    assert len(lifter.blocks) == 4 and not lifter.domain_reductions
    # A widened callee result needs explicit evidence; u8 storage alone is not
    # permission to guess the original full register's unsigned extension.
    compiled = {}
    p = profiles()
    raw = ROM.read_bytes()
    for profile in p:
        entry = profile['entry']
        args = dict(profile.get('argument_contract', {}))
        if entry == '080326b8':
            args.pop('return_abi', None)
        try:
            value = Lifter(json.loads((L0/(entry+'.json')).read_text()), raw, compiled,
                           profile['domains'], argument_contract=args).build()
        except ValueError as error:
            assert entry == '0803278c' and 'return extension lacks evidence' in str(error)
            break
        compiled[entry] = value
    else:
        raise AssertionError('ambiguous unsigned return silently widened')
    print(json.dumps({'outcome': 'pass', 'checks': ['exact-domain and phi predecessor pruning',
          'fixed ABI precondition retained', 'input source unchanged', 'dead literal-address asset removed',
          'unknown/null paths fail closed', 'mutable branch preserved', 'unproved return extension rejected'],
          'wall_s': time.perf_counter()-started}))


if __name__ == '__main__':
    run()
