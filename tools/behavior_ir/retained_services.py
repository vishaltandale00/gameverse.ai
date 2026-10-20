"""Pinned native service boundary; deliberately not a portable semantic closure.

Contracts belong to native adapter metadata. L1 retains only symbolic service
names/types, never machine addresses. This module neither recovers a C service
nor supplies an implementation: generated code calls the original ROM entry.
ABI/effect declarations require separately reviewed source evidence; hashing
that evidence authenticates identity, not the truth of the declarations.
"""
import copy
import hashlib
import re

SCHEMA = 'gameverse.retained-native-service/0.1'
STACK_SCHEMA = 'gameverse.retained-native-service/0.2'
BASE = 0x08000000
TYPES = {'u8': 'uint8_t', 'u16': 'uint16_t', 'u32': 'uint32_t'}
NAME = re.compile(r'[A-Za-z_][A-Za-z_0-9]*\Z')


def _uint(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError('retained service integer required')
    n = int(value, 16) if isinstance(value, str) else value
    if not 0 <= n <= 0xffffffff:
        raise ValueError('retained service integer outside u32')
    return n


def _digest(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('retained service SHA-256 required')
    return value


def validate_service(contract, rom, evidence=None):
    """Authenticate bytes and reject unsupported ABI/authority combinations.

    evidence maps source evidence SHA-256 to actual bytes. The adapter must
    retain those artifacts; callers must not treat an unchecked digest as proof.
    Unknown transitive host dependencies remain OPEN even after native parity.
    """
    c = copy.deepcopy(contract)
    required = {'schema', 'id', 'rom_sha256', 'entry', 'mode', 'span_size',
                'span_sha256', 'abi', 'effects', 'source_evidence'}
    if not isinstance(c, dict) or set(c) != required or c['schema'] not in (SCHEMA, STACK_SCHEMA):
        raise ValueError('unsupported retained service contract')
    if not isinstance(c['id'], str) or not NAME.fullmatch(c['id']):
        raise ValueError('retained service symbolic identifier required')
    if _digest(c['rom_sha256']) != hashlib.sha256(rom).hexdigest():
        raise ValueError('retained service ROM identity mismatch')
    entry = _uint(c['entry']); size = c['span_size']
    if c['mode'] != 'thumb' or entry & 1 or not isinstance(size, int) or isinstance(size, bool) or not 2 <= size <= 65536 or size % 2:
        raise ValueError('retained service requires bounded aligned Thumb span')
    start = entry - BASE
    if start < 0 or start + size > len(rom) or hashlib.sha256(rom[start:start+size]).hexdigest() != _digest(c['span_sha256']):
        raise ValueError('retained service source span mismatch')
    abi = c['abi']
    stack_schema=c['schema']==STACK_SCHEMA
    abi_keys={'standard','arguments','return','stack_arguments','variadic','by_reference'}|({'stack_prefix_bytes','stack_frame_bytes','preserve'}if stack_schema else set())
    if not isinstance(abi,dict)or set(abi)!=abi_keys or abi['standard']not in(('AAPCS32','APCS32_scalar_words')if stack_schema else('AAPCS32',))or abi['variadic']is not False or abi['by_reference']is not False:
        raise ValueError('retained service unsupported ABI/stack/by-reference escape')
    args=abi['arguments']
    if not isinstance(args,list)or len(args)>(7 if stack_schema else 4)or type(abi['stack_arguments'])is not int or abi['stack_arguments']!=max(0,len(args)-4):raise ValueError('retained service scalar argument layout/count unsupported')
    if stack_schema and(not 5<=len(args)<=7 or abi['preserve']!=['r'+str(i)for i in range(4,12)]+['sp']):raise ValueError('stack service requires explicit bounded scalar words/preserved frame')
    for index,arg in enumerate(args):
        expected={'type':arg.get('type'),'kind':'scalar',**({'register':'r'+str(index)}if index<4 else{'stack_offset':4*(index-4)})}if isinstance(arg,dict)else None
        if expected is None or arg!=expected or arg['type']not in TYPES or index>=4 and type(arg['stack_offset'])is not int:raise ValueError('retained service requires exact typed register/contiguous stack scalar words')
    if stack_schema:
        if type(abi['stack_prefix_bytes'])is not int or not abi['stack_prefix_bytes']<=size or type(abi['stack_frame_bytes'])is not int:raise ValueError('stack service source prefix/frame bound invalid')
        from stack_call import callee_layout
        layout=callee_layout(rom,entry,args,abi['stack_prefix_bytes'])
        if layout['callee_frame_bytes']!=abi['stack_frame_bytes']:raise ValueError('stack service callee frame differs from source prologue')
    if abi['return'] not in ('void', 'u32'):
        raise ValueError('retained service requires void or full r0 u32 return')
    effects = c['effects']
    if not isinstance(effects, dict) or set(effects) != {'authority', 'synchronization', 'dependency_closure', 'dependencies', 'lifetime'} or effects['authority'] != 'canonical_native_host' or effects['synchronization'] != 'flush_reload_all_bound_state' or effects['dependency_closure'] != 'OPEN' or not isinstance(effects['dependencies'], list) or not effects['dependencies'] or any(not isinstance(v, str) or not v.strip() for v in effects['dependencies']) or not isinstance(effects['lifetime'], str) or not effects['lifetime'].strip():
        raise ValueError('retained service requires canonical authority, full sync and OPEN host dependencies')
    if not isinstance(c['source_evidence'], list) or not c['source_evidence']:
        raise ValueError('retained service source ABI/effects evidence required')
    for pin in c['source_evidence']:
        if not isinstance(pin, dict) or set(pin) != {'role', 'sha256'} or pin['role'] not in ('abi', 'effects'):
            raise ValueError('retained service invalid source evidence')
        digest = _digest(pin['sha256'])
        if evidence is None or digest not in evidence or hashlib.sha256(evidence[digest]).hexdigest() != digest:
            raise ValueError('retained service source evidence identity mismatch')
    if {pin['role'] for pin in c['source_evidence']} != {'abi', 'effects'}:
        raise ValueError('retained service requires both ABI and effects source evidence')
    c['entry'] = entry
    return c


def signature(contract):
    """Address-free signature suitable for an explicitly native-only L1 module."""
    return {'id': contract['id'], 'implementation': 'preserved_native_opaque',
            'binding_scope': 'source_pinned_native_only', 'arguments': [a['type'] for a in contract['abi']['arguments']],
            'return_type': contract['abi']['return'], 'dependency_closure': 'OPEN',
            'synchronization': 'flush_reload_all_bound_state',
            'memory_effects': {'reads': 'unknown', 'writes': 'unknown',
                               'optimization_barrier': 'all_host_memory',
                               'reference_stability': 'unknown'}}


def module_metadata(contracts):
    """Address-free, explicit native/open provenance for a containing L1 module.

    Core schema/validation must require these meanings when accepting the op;
    this helper does not enable generic portable lowering or publication.
    """
    services = [signature(c) for c in contracts]
    if not services or len({c['id'] for c in services}) != len(services):
        raise ValueError('retained service module requires unique nonempty services')
    return {'retained_services': services,
            'execution_scope': 'source_pinned_native_only',
            'semantic_closure': 'OPEN',
            'limitations': ['Retained service implementations are preserved native opaque host dependencies, not regenerated IR',
                            'Automatically lifted control/state coverage does not certify portable service semantics or interchangeability']}


def derive_call(call, varnodes, contract, resolve_argument, rom, evidence=None, result=None, source_l0=None, proofs=None):
    """Derive a symbolic statement only from the exact original direct CALL.

    resolve_argument is the lifter's expression resolver, called here with each
    exact CALL input SSA identity, after pointer/stack escape rejection. Arbitrary
    substituted expression lists and missing argument recovery are unsupported.
    """
    c = validate_service(contract, rom, evidence)
    nodes = varnodes if isinstance(varnodes, dict) else {v['id']: v for v in varnodes}
    inputs = call.get('inputs', [])
    target = nodes.get(inputs[0], {}) if inputs else {}
    if call.get('opcode') != 'CALL' or target.get('space') != 'ram' or int(target.get('offset', -1)) != c['entry']:
        raise ValueError('retained service requires matching original direct CALL')
    pc = _uint(call.get('pc', -1)); off = pc - BASE
    if pc & 1 or off < 0 or off + 4 > len(rom):
        raise ValueError('retained service callsite outside aligned original ROM')
    first = int.from_bytes(rom[off:off+2], 'little')
    second = int.from_bytes(rom[off+2:off+4], 'little')
    delta = ((first & 0x7ff) << 12) | ((second & 0x7ff) << 1)
    if delta & (1 << 22):
        delta -= 1 << 23
    if first & 0xf800 != 0xf000 or second & 0xf800 != 0xf800 or pc + 4 + delta != c['entry']:
        raise ValueError('retained service original Thumb BL does not match target')
    if len(inputs) != len(c['abi']['arguments']) + 1:
        raise ValueError('retained service argument count/missing source ABI input')
    if not isinstance(call.get('id'), str) or not call['id']:
        raise ValueError('retained service CALL provenance required')
    if not callable(resolve_argument):
        raise ValueError('retained service requires exact input SSA resolver')
    stack_proof=None
    if c['abi']['stack_arguments']:
        if source_l0 is None:raise ValueError('stack service requires original source L0 call frame')
        from stack_call import prove
        stack_proof=prove(source_l0,call,nodes,rom,c['abi']['arguments'],c['abi']['stack_prefix_bytes'])
        if proofs is not None:proofs.append(stack_proof)
    arguments = []
    for source, declared in zip(inputs[1:], c['abi']['arguments']):
        arg = resolve_argument(source)
        if arg.get('type') not in TYPES or nodes[source]['size'] != int(arg['type'][1:]) // 8:
            raise ValueError('retained service argument/source SSA type mismatch')
        if int(arg['type'][1:]) < int(declared['type'][1:]):
            raise ValueError('retained service argument source is narrower than ABI')
        arguments.append(copy.deepcopy(arg) if arg['type'] == declared['type'] else
                         {'op': 'extract', 'type': declared['type'], 'args': [copy.deepcopy(arg), {'op': 'const', 'type': 'u32', 'value': 0}]})
    if c['abi']['return'] == 'void':
        if call.get('output') or result is not None:
            raise ValueError('retained service void call has an unproven return use')
    elif not call.get('output') or nodes.get(call['output'], {}).get('size') != 4 or not isinstance(result, str) or not NAME.fullmatch(result):
        raise ValueError('retained service full-r0 u32 source return binding required')
    return {'op': 'retained_native_service', 'service': c['id'],
            'arguments': copy.deepcopy(arguments), 'provenance': call['id'],
            **({'result': result} if result is not None else {})}


def render_call(statement, contract, render_expr, flush, reload):
    """Emit native C only after adapter validation, with canonical state sync.

    flush/reload are compiler-generated code covering *all* canonical bound
    fields, object references and collections. Neither may be an empty string.
    The core integration owns coverage/alias validation; this interface cannot
    prove a supplied snippet complete. No unknown-effect disjointness shortcut.
    """
    if statement.get('op') != 'retained_native_service' or statement.get('service') != contract['id']:
        raise ValueError('retained service statement/signature mismatch')
    if not isinstance(flush, str) or not flush.strip() or not isinstance(reload, str) or not reload.strip():
        raise ValueError('retained service canonical flush/reload required')
    args = contract['abi']['arguments']
    if len(statement['arguments']) != len(args):
        raise ValueError('retained service statement argument count')
    parts = ['{']
    for index, (arg, decl) in enumerate(zip(statement['arguments'], args)):
        if arg.get('type') != decl['type']:
            raise ValueError('retained service statement argument type')
        parts.append(TYPES[decl['type']]+' ir_service_arg_'+str(index)+' = '+render_expr(arg)+';')
    parts.append(flush)
    typ = contract['abi']['return']; result = statement.get('result')
    if (typ == 'void') != (result is None) or result is not None and not NAME.fullmatch(result):
        raise ValueError('retained service statement return binding')
    # uintptr_t, exact original Thumb bit, and a typed function pointer preserve
    # a real ABI call; no generated wrapper can impersonate the host service.
    call = '((%s (*)(%s))(uintptr_t)UINT32_C(%d))(%s);' % (
        'void' if typ == 'void' else TYPES[typ],
        ','.join(TYPES[a['type']] for a in args) or 'void',
        _uint(contract['entry']) | 1,
        ','.join('ir_service_arg_'+str(i) for i in range(len(args))))
    parts.append((result+' = ' if result is not None else '')+call)
    parts.extend([reload, '}'])
    return '\n'.join(parts)+'\n'


def call_frame_proof(call,varnodes,contract,rom,source_l0):
    if not contract['abi']['stack_arguments']:return None
    from stack_call import prove
    return prove(source_l0,call,varnodes,rom,contract['abi']['arguments'],contract['abi']['stack_prefix_bytes'])
