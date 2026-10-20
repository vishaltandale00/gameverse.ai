"""Subsecond contract/renderer checks; no emulated service or native parity claim."""
import copy
import hashlib
import json
import time
from retained_services import SCHEMA, validate_service, derive_call, signature, render_call, module_metadata


def run():
    start = time.perf_counter()
    rom = bytearray(64)
    # Original Thumb BL 08000000 -> 08000020; retained service BX LR.
    rom[:4] = bytes.fromhex('00f00ef8')
    rom[32:34] = bytes.fromhex('7047')
    source = b'source reviewed scalar AAPCS ABI and opaque canonical host effects'
    digest = hashlib.sha256(source).hexdigest()
    evidence = {digest: source}
    c = {'schema': SCHEMA, 'id': 'audio', 'rom_sha256': hashlib.sha256(rom).hexdigest(),
         'entry': '08000020', 'mode': 'thumb', 'span_size': 2,
         'span_sha256': hashlib.sha256(rom[32:34]).hexdigest(),
         'abi': {'standard': 'AAPCS32', 'arguments': [{'register': 'r0', 'type': 'u16', 'kind': 'scalar'}],
                 'return': 'void', 'stack_arguments': 0, 'variadic': False, 'by_reference': False},
         'effects': {'authority': 'canonical_native_host', 'synchronization': 'flush_reload_all_bound_state',
                     'dependency_closure': 'OPEN', 'dependencies': ['unknown native audio driver'], 'lifetime': 'original host scheduler'},
         'source_evidence': [{'role': role, 'sha256': digest} for role in ('abi', 'effects')]}
    call = {'id': 'op4', 'opcode': 'CALL', 'pc': '08000000', 'inputs': ['v0', 'v1']}
    nodes = {'v0': {'space': 'ram', 'offset': str(0x08000020)}, 'v1': {'size': 2}, 'v4': {'size': 4}}
    args = [{'op': 'const', 'type': 'u16', 'value': 5}]
    seen = []
    def resolve(source):
        seen.append(source)
        return args[0]
    op = derive_call(call, nodes, c, resolve, rom, evidence)
    assert seen == ['v1']
    assert signature(c)['memory_effects'] == {'reads': 'unknown', 'writes': 'unknown', 'optimization_barrier': 'all_host_memory', 'reference_stability': 'unknown'}
    normalized = validate_service(c, rom, evidence)
    meta = module_metadata([c])
    assert meta['execution_scope'] == 'source_pinned_native_only' and meta['semantic_closure'] == 'OPEN'
    assert meta['retained_services'][0]['implementation'] == 'preserved_native_opaque'
    assert 'entry' not in signature(c) and signature(c)['dependency_closure'] == 'OPEN'
    code = render_call(op, normalized, lambda _: '5u', 'flush_all(s);', 'reload_all(s);')
    assert 'UINT32_C(134217761)' in code
    assert code.index('ir_service_arg_0 =') < code.index('flush_all') < code.index('(uintptr_t)') < code.index('reload_all')
    assert 'void (*)(uint16_t)' in code and 'ir_service_arg_0);' in code
    rejected = 0
    def reject(fn):
        nonlocal rejected
        try: fn()
        except (ValueError, KeyError, TypeError): rejected += 1
        else: raise AssertionError('unsupported retained service admitted')
    for mutate in [lambda x: x.update(rom_sha256='0'*64), lambda x: x.update(span_sha256='0'*64),
                   lambda x: x.update(mode='arm'), lambda x: x['abi'].update(by_reference=True),
                   lambda x: x['abi'].update(stack_arguments=1), lambda x: x['abi'].update(variadic=True),
                   lambda x: x['abi'].update(return_type='void'), lambda x: x['abi'].update({'return':'u16'}),
                   lambda x: x['abi']['arguments'][0].update(kind='pointer'),
                   lambda x: x['abi']['arguments'][0].update(register='r1'),
                   lambda x: x['effects'].update(dependency_closure='closed'),
                   lambda x: x['effects'].update(synchronization='none'),
                   lambda x: x['effects'].update(authority='generated_snapshot'),
                   lambda x: x.update(source_evidence=[])]:
        bad = copy.deepcopy(c); mutate(bad)
        reject(lambda: validate_service(bad, rom, evidence))
    reject(lambda: validate_service(c, rom, {}))
    reject(lambda: module_metadata([c, c]))
    reject(lambda: derive_call(call, nodes, c, args, rom, evidence))
    reject(lambda: derive_call(dict(call, output='v4'), nodes, c, resolve, rom, evidence))
    reject(lambda: derive_call(dict(call, opcode='CALLIND'), nodes, c, resolve, rom, evidence))
    reject(lambda: derive_call(dict(call, inputs=['v0']), nodes, c, resolve, rom, evidence))
    reject(lambda: derive_call(dict(call, pc='08000004'), nodes, c, resolve, rom, evidence))
    reject(lambda: derive_call(call, nodes, c, lambda _: dict(args[0], type='u32'), rom, evidence))
    reject(lambda: render_call(op, normalized, lambda _: '5u', '', 'reload_all(s);'))
    reject(lambda: render_call(op, normalized, lambda _: '5u', 'flush_all(s);', ''))
    returning = copy.deepcopy(c); returning['abi']['return'] = 'u32'
    narrow_nodes = dict(nodes, v4={'size': 2})
    reject(lambda: derive_call(dict(call, output='v4'), narrow_nodes, returning, resolve, rom, evidence, result='value_4'))
    output = derive_call(dict(call, output='v4'), nodes, returning, resolve, rom, evidence, result='value_4')
    assert 'value_4 = ((uint32_t (*)(uint16_t))' in render_call(output, returning, lambda _: '5u', 'flush_all(s);', 'reload_all(s);')
    print(json.dumps({'outcome': 'pass', 'negative_controls': rejected,
                      'scope': 'isolated contract/derivation/renderer only; no core integration or native service qualification',
                      'wall_seconds': time.perf_counter()-start}))


if __name__ == '__main__':
    run()
