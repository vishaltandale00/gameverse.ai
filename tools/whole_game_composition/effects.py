"""Bounded, evidence-carrying memory shape hints; never behavioral compatibility.

Only explicit L1 operations and validation-adapter bindings are interpreted.
SSA names and annotations never become addresses. Counts are storage capacities,
not invocation counts; a stride is element layout, not observed traversal.
"""
from __future__ import annotations

SCHEMA = 'gameverse.effect-shape/1'
REGIONS = ((0x02000000, 0x02040000, 'EWRAM'), (0x03000000, 0x03008000, 'IWRAM'),
           (0x04000000, 0x04000400, 'IO'), (0x05000000, 0x05000400, 'palette'),
           (0x06000000, 0x06018000, 'VRAM'), (0x07000000, 0x07000400, 'OAM'),
           (0x08000000, 0x0e000000, 'GamePakROM'))


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _space(start, end):
    return next((name for low, high, name in REGIONS if low <= start <= end < high), 'unknown')


def summarize_effects(behavior, bindings=None, *, component_id=None, max_nodes=100000):
    """Summarize an already parsed L1; bindings are an optional validation adapter.

    Unknown/unrecognized operations make completeness false. Bound exhaustion
    returns partial evidence with unknowns rather than silently accepting it.
    """
    bindings = bindings or {}
    objects = {}
    for kind, key in [('field', 'state'), ('collection', 'collections'), ('asset', 'assets')]:
        bound = {x['name']: x for x in bindings.get('fields' if kind == 'field' else key, [])}
        for item in behavior.get(key, []):
            name = item['name']; binding = bound.get(name, {})
            width = int(item.get('storage_type', 'u0')[1:]) // 8
            count = len(item.get('data', [])) if kind == 'asset' else item.get('count', 1)
            stride = binding.get('size', width) if kind != 'field' else None
            start = binding.get('address')
            # Adapter fields explicitly encode base plus offset (base zero is valid).
            if kind == 'field' and _integer(start):
                start += binding.get('offset', 0)
            extent = ((count - 1) * stride + width) if kind != 'field' and _integer(count) and _integer(stride) and count > 0 else width
            end = start + extent - 1 if _integer(start) and width > 0 else None
            objects[(kind, name)] = {
                'kind': kind, 'name': name, 'width_bytes': width or None,
                'element_stride_bytes': stride, 'capacity': count,
                'space': _space(start, end) if end is not None else 'unknown',
                'address_range': [start, end] if end is not None else None,
                'relative_base': binding.get('argument'), 'relative_offset': binding.get('offset'),
                'ownership': 'unknown', 'symbolic_owner': item.get('owner'),
                'evidence': [f'l1.{key}.{name}'] + ([f'validation-adapter.{name}'] if binding else []),
                'reads': 0, 'writes': 0, 'indices': [],
            }
    unknowns = []; calls = []; visited = 0; accesses = []
    if behavior.get('schema') != 'gameverse.l1.behavior/0.2':
        unknowns.append('unsupported_or_opaque_representation')
    supported = {'assign_local', 'if', 'return', 'const', 'local', 'parameter', 'field',
                 'assign_field', 'collection_read', 'assign_collection', 'asset_read',
                 'retained_native_service', 'switch', 'case', 'repeat', 'break',
                 'add_wrap', 'sub_wrap', 'mul_wrap', 'bit_and', 'bit_or', 'bit_xor',
                 'shift_left', 'shift_right', 'shift_arithmetic', 'neg_wrap', 'bit_not',
                 'bool_not', 'equal', 'not_equal', 'less_unsigned', 'less_equal_unsigned',
                 'less_signed', 'less_equal_signed', 'zext', 'sext', 'truncate', 'select',
                 'div_unsigned', 'mod_unsigned'}
    stack = [(behavior.get('body', []), 'body')]
    while stack:
        node, path = stack.pop(); visited += 1
        if visited > max_nodes:
            unknowns.append('node_budget_exhausted'); break
        if isinstance(node, list):
            stack.extend((v, f'{path}[{i}]') for i, v in enumerate(node)); continue
        if not isinstance(node, dict):
            continue
        op = node.get('op')
        if op and op not in supported:
            unknowns.append('unrecognized_operation:' + str(op))
        kind = 'field' if op in ('field', 'assign_field') else 'collection' if op in ('collection_read', 'assign_collection') else 'asset' if op == 'asset_read' else None
        if kind:
            name = node.get('name') if op == 'field' else node.get(kind)
            obj = objects.get((kind, name))
            if obj is None:
                unknowns.append('undeclared_access:' + str(name))
            else:
                mode = 'write' if op.startswith('assign_') else 'read'
                obj[mode + 's'] += 1
                idx = node.get('index')
                index = {'kind': 'scalar'} if idx is None else {'kind': 'constant', 'value': idx['value']} if idx.get('op') == 'const' else {'kind': 'dynamic', 'bounds': 'unknown'}
                if index not in obj['indices']: obj['indices'].append(index)
                accesses.append({'object': name, 'kind': kind, 'mode': mode, 'index': index,
                                 'evidence': path, 'provenance': node.get('provenance')})
        if op == 'retained_native_service' or (op and ('call' in op.lower() or 'native' in op.lower())):
            calls.append({'operation': op, 'evidence': path, 'effects': 'unknown'})
            unknowns.append('external_or_native_effects_unknown')
        stack.extend((v, path + '.' + k) for k, v in node.items() if isinstance(v, (dict, list)))
    used = [o for o in objects.values() if o['reads'] or o['writes']]
    if any(o['space'] == 'unknown' for o in used): unknowns.append('physical_address_or_space_unknown')
    if used: unknowns.append('alias_relations_not_proven')
    if any(i['kind'] == 'dynamic' for o in used for i in o['indices']):
        unknowns.append('dynamic_indices_not_range_proven')
    patterns = []
    def candidate(name, evidence, confidence):
        patterns.append({'pattern': name, 'status': 'candidate', 'confidence': confidence,
                         'evidence': evidence, 'semantic_equivalence': 'unproven'})
    for o in used:
        if o['kind'] == 'asset' and o['reads']:
            candidate('bounded_table_lookup', o['evidence'], 'shape_only_storage_bound_index_safety_unknown')
        if o['kind'] == 'field' and o['writes']:
            candidate('entity_state_update', o['evidence'], 'shape_only_owner_semantics_unknown')
        if o['writes'] and o['space'] in ('IO', 'VRAM', 'palette', 'OAM'):
            candidate({'palette': 'palette_upload', 'VRAM': 'graphics_copy', 'OAM': 'graphics_copy', 'IO': 'hardware_io_update'}[o['space']], o['evidence'], 'destination_shape_only_transfer_semantics_unknown')
    complete = not calls and 'unsupported_or_opaque_representation' not in unknowns and 'node_budget_exhausted' not in unknowns and not any(x.startswith(('unrecognized_operation:', 'undeclared_access:')) for x in unknowns)
    return {'schema': SCHEMA, 'component_id': component_id or behavior.get('id'),
            'scope': 'supplied_L1_only', 'complete_access_scan': complete,
            'objects': used, 'accesses': accesses, 'calls': calls, 'patterns': patterns,
            'pointer_chasing': 'unknown_no_pointer_dataflow_analysis',
            'unknowns': sorted(set(unknowns)), 'visited_nodes': visited,
            'compatibility': 'unproven', 'game_readiness': 'unchanged'}


def compare_effect_constraints(summary, requirements):
    """Check explicit object constraints, never infer substitutability.

    requirements: {objects: [{name, width_bytes?, element_stride_bytes?, space?,
    access?: read_only|write_required, index?: constant|dynamic}]}. A contradiction
    is a mismatch of known facts, not a missing binding or unresolved effect.
    """
    contradictions = []; unknowns = []
    by_name = {o['name']: o for o in summary['objects']}
    for req in requirements.get('objects', []):
        obj = by_name.get(req['name'])
        if obj is None:
            unknowns.append({'object': req['name'], 'reason': 'no_access_evidence'}); continue
        for key in ('width_bytes', 'element_stride_bytes', 'space', 'capacity'):
            if key not in req: continue
            actual = obj.get(key)
            if actual in (None, 'unknown'):
                unknowns.append({'object': req['name'], 'constraint': key})
            elif actual != req[key]:
                contradictions.append({'object': req['name'], 'constraint': key, 'required': req[key], 'actual': actual})
        if req.get('access') == 'read_only' and obj['writes']:
            contradictions.append({'object': req['name'], 'constraint': 'read_only', 'actual': 'explicit_write'})
        if req.get('access') == 'write_required' and not obj['writes']:
            (contradictions if summary['complete_access_scan'] else unknowns).append({'object': req['name'], 'constraint': 'write_required', 'actual': 'no_explicit_write'})
        if req.get('index'):
            kinds = {x['kind'] for x in obj['indices']}
            if req['index'] == 'constant' and 'dynamic' in kinds:
                unknowns.append({'object': req['name'], 'constraint': 'constant_index', 'reason': 'dynamic_expression_not_resolved'})
    if not summary['complete_access_scan']: unknowns.append({'reason': 'partial_or_external_effects'})
    if not requirements.get('objects'): unknowns.append({'reason': 'no_explicit_access_requirements'})
    return {'status': 'contradicted' if contradictions else 'unknown' if unknowns else 'shape_constraints_satisfied',
            'contradictions': contradictions, 'unknowns': unknowns, 'behavioral_compatibility': 'unproven'}


def query_effects(summaries, *, pattern=None, space=None, writes=None, width_bytes=None):
    """Candidate index query. Results retain evidence and imply no compatibility."""
    return [s for s in summaries if
            (pattern is None or any(p['pattern'] == pattern for p in s['patterns'])) and
            any((space is None or o['space'] == space) and
                (writes is None or bool(o['writes']) == writes) and
                (width_bytes is None or o['width_bytes'] == width_bytes) for o in s['objects'])]


def import_behavior_overlay(game, behavior, bindings=None, provenance=None, component_ids=None):
    """Attach pinned L1 evidence without claiming native placement or closure.

    The caller verifies referenced file hashes before parsing. This helper adds
    the parsed behavior's canonical hash independently of those raw-file pins.
    Native placement requires explicit canonical component IDs and join evidence;
    physical address inference is never used to select a containing component.
    """
    import copy
    import hashlib
    import json

    def pin(record, label):
        if not isinstance(record, dict) or not isinstance(record.get('path'), str) or not record['path']:
            raise ValueError(label + ' requires path and sha256')
        digest = record.get('sha256')
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError(label + ' requires immutable sha256')

    if not isinstance(provenance, dict) or not provenance.get('source_game'):
        raise ValueError('behavior overlay requires explicit source provenance')
    pin(provenance.get('behavior_ref'), 'behavior_ref')
    pin(provenance.get('package_ref'), 'package_ref')
    if not isinstance(behavior, dict) or not behavior.get('id'):
        raise ValueError('behavior overlay requires identified behavior evidence')
    if bindings is not None:
        pin(provenance.get('adapter_ref', provenance.get('validation_adapter_ref')), 'adapter_ref')
    if game.get('schema') != 'gameverse.whole-game-composition/1':
        raise ValueError('unsupported whole-game schema')
    if not any(n.get('id') == 'game' and n.get('parent') is None for n in game.get('nodes', [])):
        raise ValueError('whole-game root missing')
    ids = list(component_ids or [])
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate canonical component join')
    components = {n.get('component_ref'): n['id'] for n in game['nodes'] if n.get('kind') == 'component' and n.get('component_ref')}
    if any(ident not in components for ident in ids):
        raise ValueError('behavior references absent canonical component')
    if ids and not provenance.get('component_mapping_evidence'):
        raise ValueError('explicit component join requires component_mapping_evidence')
    identity = provenance.get('package_id', behavior['id'])
    if not isinstance(identity, str) or not identity:
        raise ValueError('invalid behavior identity')
    node_id = 'behavior:' + identity
    if any(n['id'] == node_id for n in game['nodes']):
        raise ValueError('duplicate behavior overlay: ' + node_id)
    parsed_hash = hashlib.sha256(json.dumps(behavior, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    source = copy.deepcopy(provenance)
    source.update({'parsed_behavior_canonical_sha256': parsed_hash,
                   'ir_id': behavior['id'],
                   'native_component_mapping': 'explicit_evidence_join' if ids else 'unplaced_unknown'})
    summary = summarize_effects(behavior, bindings, component_id=identity)
    effects = {'schema': 'gameverse.component-effects/1', 'status': 'unknown',
               'reads': [], 'writes': [], 'calls': [], 'emits': [], 'requires': [], 'provides': [],
               'phase': None, 'lifetime': None, 'state_ownership': None, 'save_schema': None,
               'evidence': [copy.deepcopy(provenance['behavior_ref'])],
               'unknowns': ['Native effect closure is not established by a supplied L1 subset',
                            'Original source owner and caller schedule remain unproven']}
    result = copy.deepcopy(game)
    result['nodes'].append({'id': node_id, 'parent': 'game', 'kind': 'behavior',
                            'contract': {'scope': 'native-component', 'effects': effects,
                                         'access_summary': summary,
                                         'closure': {'status': 'unknown'},
                                         'source_contract_refs': copy.deepcopy(provenance.get('source_contract_refs', []))},
                            'provenance': source})
    result.setdefault('edges', []).extend({'source': node_id, 'target': components[ident],
                                         'kind': 'stored-in',
                                         'evidence': copy.deepcopy(provenance['component_mapping_evidence'])}
                                        for ident in ids)
    return result
