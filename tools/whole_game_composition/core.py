"""Whole-ROM ownership references plus evidenced semantic overlays.

This is a static contract compiler, never a behavioral equivalence verifier.
The four compatibility labels apply only to the reported contract scope.
"""
from __future__ import annotations
import copy
import hashlib
import json
import time

SCHEMA = 'gameverse.whole-game-composition/1'
REQUEST_SCHEMA = 'gameverse.composition-request/1'
EFFECT_SCHEMA = 'gameverse.component-effects/1'
MAX_NODES = 20000
MAX_CANDIDATES = 128
SPACES = {'ewram': 0x40000, 'iwram': 0x8000, 'vram': 0x18000,
          'palette': 0x400, 'oam': 0x400, 'io': 0x400, 'rom': 0x2000000}


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def _int(value):
    return type(value) is int


def _pin(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def _partition(manifest):
    """Audit canonical ownership, without copying artifact bytes or claiming parity."""
    if manifest.get('schema') != 'gameverse.rom-roundtrip/1':
        raise ValueError('unsupported partition schema')
    original = manifest.get('original', {})
    size = original.get('size')
    if not _int(size) or not 0 < size <= SPACES['rom'] or not _pin(original.get('sha256')):
        raise ValueError('partition requires bounded size and immutable ROM hash')
    rows = manifest.get('components', [])
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_NODES:
        raise ValueError('invalid component count')
    ids, intervals = set(), []
    for row in rows:
        ident, start, length = row.get('id'), row.get('offset'), row.get('size')
        if not isinstance(ident, str) or not ident or ident in ids:
            raise ValueError('duplicate or absent canonical component identity')
        ids.add(ident)
        if not _int(start) or not _int(length) or start < 0 or length <= 0 or start + length > size:
            raise ValueError('component outside ROM: ' + ident)
        if not _pin(row.get('sha256')):
            raise ValueError('component hash missing: ' + ident)
        intervals.append((start, start + length, ident))
    cursor = 0
    for start, end, ident in sorted(intervals):
        if start != cursor:
            raise ValueError(('overlap' if start < cursor else 'gap') + ' in canonical ownership: ' + ident)
        cursor = end
    if cursor != size:
        raise ValueError('canonical ownership does not cover ROM end')
    return {'rom_bytes': size, 'owned_bytes': cursor, 'coverage_fraction': 1.0,
            'component_count': len(rows), 'artifact_bytes_verified': False}


def _unknown_effects(reason):
    return {'schema': EFFECT_SCHEMA, 'status': 'unknown', 'reads': [], 'writes': [],
            'calls': [], 'emits': [], 'requires': [], 'provides': [],
            'phase': None, 'lifetime': None, 'state_ownership': None,
            'save_schema': None, 'evidence': [], 'unknowns': [reason]}


def import_game(partition_manifest, memory_manifest=None, partition_ref=None, memory_ref=None):
    """Import complete ownership at existing grain; never duplicate a byte catalog.

    References carry canonical JSON hashes (separate from optional file hashes).
    Table rows/snapshots remain only in the existing memory manifest.
    """
    _partition(partition_manifest)
    p = partition_manifest
    nodes = [{'id': 'game', 'parent': None, 'kind': 'game',
              'contract': {'scope': 'whole-game', 'effects': _unknown_effects('Whole-game behavior unresolved')}}]
    edges = []
    for component in p['components']:
        ident = 'component:' + component['id']
        nodes.append({'id': ident, 'parent': 'game', 'kind': 'component',
                      'component_ref': component['id'],
                      'contract': {'scope': 'native-component',
                          'closure': copy.deepcopy(component.get('closure', {'status': 'unknown'})),
                          'native': copy.deepcopy(component.get('contract', {})),
                          'effects': _unknown_effects('Native effects require captured evidence')},
                      'provenance': {'partition_component': component['id'],
                                     'sha256': component['sha256'], 'stratum': component.get('stratum')}})
        for dep in component.get('dependencies', []):
            target = dep.get('id', dep.get('component_id')) if isinstance(dep, dict) else dep
            if target:
                edges.append({'source': ident, 'target': 'component:' + target,
                              'kind': 'requires', 'evidence': copy.deepcopy(dep)})
    memory_pin = None
    if memory_manifest is not None:
        m = memory_manifest
        if m.get('schema') != 'gameverse.gba-memory-ontology/1' or m.get('rom') != {
                'sha256': p['original']['sha256'], 'size': p['original']['size']}:
            # Additional ROM metadata is permitted; identity is still exact.
            if (m.get('schema') != 'gameverse.gba-memory-ontology/1' or
                any(m.get('rom', {}).get(k) != p['original'][k] for k in ('sha256', 'size'))):
                raise ValueError('memory overlay ROM identity disagrees with partition')
        allocation_rows = m.get('allocations', [])
        allocations = {a['id']: a for a in allocation_rows}
        if len(allocations) != len(allocation_rows):
            raise ValueError('duplicate memory allocation identity')
        previous_end = 0
        for allocation in sorted((a for a in allocation_rows if 'rom_offset' in a), key=lambda a: a['rom_offset']):
            start, size = allocation['rom_offset'], allocation['size']
            if not _int(start) or not _int(size) or start < previous_end or size <= 0 or start + size > p['original']['size']:
                raise ValueError('invalid or overlapping memory allocation')
            previous_end = start + size
        memory_pin = {'canonical_sha256': canonical_hash(m), 'ref': memory_ref,
                      'source_revision': copy.deepcopy(m.get('source_revision')),
                      'provenance': copy.deepcopy(m.get('provenance', {}))}
        tables = m.get('tables', [])
        for table in tables:
            allocation = allocations.get(table['allocation_id'])
            if allocation is None:
                raise ValueError('table allocation missing')
            node = memory_table_node(m, table['id'], memory_ref)
            prefix = table.get('backing_prefix_size', 0)
            start, length = table['rom_offset'] - prefix, prefix + table['stride'] * table['capacity']
            if start < allocation['rom_offset'] or start + length > allocation['rom_offset'] + allocation['size']:
                raise ValueError('table outside allocation')
            owner_ids = [c['id'] for c in p['components'] if c['offset'] < start + length
                         and start < c['offset'] + c['size']]
            if not owner_ids:
                raise ValueError('table outside canonical ownership')
            fields = node['contract']['fields']
            nodes.append(node)
            edges.extend({'source': node['id'], 'target': 'component:' + ident, 'kind': 'stored-in'} for ident in owner_ids)
            for field in fields:
                if field.get('references_table'):
                    edges.append({'source': node['id'], 'target': 'table:' + field['references_table'],
                                  'kind': 'references', 'field': field['name']})
        # Retain producer crossedges verbatim as evidence, without inventing endpoints.
        memory_pin['declared_edges'] = copy.deepcopy(m.get('edges', m.get('consumer_dependencies', [])))
    game = {'schema': SCHEMA, 'game_id': p.get('game_id'),
            'rom': {k: p['original'][k] for k in ('sha256', 'size')},
            'partition': {'canonical_sha256': canonical_hash(p), 'ref': partition_ref},
            'memory': memory_pin, 'nodes': nodes, 'edges': edges,
            'claims': {'whole_game_ownership': True, 'whole_game_behavior_understood': False,
                       'native_play_verified': False}}
    validate_game(game, p)
    return game


def memory_table_node(manifest, table_id, memory_ref=None):
    """Capture one candidate table contract without inventing ROM ownership.

    Caller must retain this manifest and use exact-ROM backend validation later.
    This helper does not validate rows against ROM bytes or prove source closure.
    """
    m = manifest
    if m.get('schema') != 'gameverse.gba-memory-ontology/1':
        raise ValueError('unsupported memory manifest schema')
    matches = [t for t in m.get('tables', []) if t.get('id') == table_id]
    if len(matches) != 1:
        raise ValueError('missing or duplicate candidate table')
    table = matches[0]
    graphics = [copy.deepcopy(g['contract']) for g in m.get('graphics_contracts', [])
                if any(ref.get('table') == table['id'] for ref in g.get('assets', {}).values())]
    fields = copy.deepcopy(table['fields'])
    contract = {'scope': 'typed-data-layout', 'format': 'typed-table/1',
                'endian': 'little', 'pointer_width': 32, 'stride': table['stride'],
                'count': len(table['rows']), 'capacity': table['capacity'], 'fields': fields,
                'backing_prefix_size': table.get('backing_prefix_size', 0),
                'bindings': copy.deepcopy(table.get('bindings', [])),
                'expansion': copy.deepcopy(table.get('expansion', {})), 'graphics': graphics,
                'effects': _unknown_effects('Captured data consumers do not close runtime behavior')}
    node = {'id': 'table:' + table['id'], 'parent': 'game', 'kind': 'asset-table',
            'memory_table_ref': table['id'], 'contract': contract,
            'provenance': {'memory_manifest_sha256': canonical_hash(m),
                           'source_revision': copy.deepcopy(m.get('source_revision')),
                           'allocation_id': table['allocation_id']}}
    node['provenance']['game_id'] = m.get('game_id')
    node['provenance']['memory_ref'] = memory_ref
    node['provenance']['rom'] = copy.deepcopy(m.get('rom'))
    node['provenance']['parent_manifest_sha256'] = m.get('parent_manifest_sha256')
    errors, _ = _check_contract(node['contract'])
    if errors:
        raise ValueError('; '.join(errors))
    return node


def _acyclic(ids, pairs, label):
    adjacency = {key: [] for key in ids}
    degree = {key: 0 for key in ids}
    for source, target in pairs:
        if source not in ids or target not in ids:
            raise ValueError(label + ' references missing node')
        adjacency[source].append(target)
        degree[target] += 1
    queue = [key for key, count in degree.items() if count == 0]
    visited = 0
    while queue:
        node = queue.pop(); visited += 1
        for target in adjacency[node]:
            degree[target] -= 1
            if degree[target] == 0:
                queue.append(target)
    if visited != len(ids):
        raise ValueError(label + ' cycle')


def validate_game(game, partition_manifest):
    """Return ownership and semantic audits; reject contradictory graph structure."""
    audit = _partition(partition_manifest)
    if game.get('schema') != SCHEMA or game.get('partition', {}).get('canonical_sha256') != canonical_hash(partition_manifest):
        raise ValueError('stale or unsupported composition partition')
    if game.get('rom') != {k: partition_manifest['original'][k] for k in ('sha256', 'size')}:
        raise ValueError('composition ROM identity mismatch')
    nodes = game.get('nodes', [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= MAX_NODES:
        raise ValueError('composition exceeds node bound')
    ids = [n.get('id') for n in nodes]
    if any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('duplicate or invalid node id')
    id_set = set(ids)
    roots = [n for n in nodes if n.get('parent') is None]
    if len(roots) != 1 or roots[0].get('kind') != 'game':
        raise ValueError('exactly one game root required')
    _acyclic(set(ids), [(n['parent'], n['id']) for n in nodes if n.get('parent') is not None], 'object tree')
    owners = [n['component_ref'] for n in nodes if 'component_ref' in n]
    expected = {c['id'] for c in partition_manifest['components']}
    if len(set(owners)) != len(owners) or set(owners) != expected:
        raise ValueError('each canonical component must be owned exactly once')
    edges = game.get('edges', [])
    if not isinstance(edges, list) or len(edges) > 100000:
        raise ValueError('graph exceeds edge bound')
    for edge in edges:
        if edge.get('source') not in id_set or edge.get('target') not in id_set:
            raise ValueError('crossedge references missing node')
        if edge.get('kind') not in ('requires', 'references', 'stored-in', 'calls', 'emits', 'before', 'initializes', 'aliases'):
            raise ValueError('unsupported edge kind')
    # Calls/references may recurse. Only strict runtime order is acyclic.
    _acyclic(set(ids), [(e['source'], e['target']) for e in edges if e['kind'] == 'before'], 'runtime phase order')
    for node in nodes:
        errors, _ = _check_contract(node.get('contract', {}))
        if errors:
            raise ValueError(node['id'] + ': ' + '; '.join(errors))
    unknown = [n['id'] for n in nodes if n.get('contract', {}).get('effects', {}).get('status') != 'closed']
    opaque_bytes = sum(c['size'] for c in partition_manifest['components']
                       if c.get('stratum') in ('opaque-preserved', 'raw-captured', 'object-captured'))
    audit.update({'ownership_valid': True, 'semantic_closure': 'unknown',
                  'opaque_or_captured_bytes': opaque_bytes,
                  'effect_unknown_node_count': len(unknown), 'effect_unknown_nodes': unknown,
                  'typed_overlay_count': sum(n.get('kind') == 'asset-table' for n in nodes),
                  'runtime_schedule_proved': False, 'native_play_verified': False})
    return audit


def _check_contract(contract):
    errors, unknown = [], []
    if not isinstance(contract, dict):
        return ['contract must be an object'], []
    if contract.get('endian') not in (None, 'little', 'big'):
        errors.append('unsupported endian')
    if contract.get('pointer_width') not in (None, 16, 32, 64):
        errors.append('unsupported pointer width')
    if contract.get('scope') == 'typed-data-layout':
        prefix = contract.get('backing_prefix_size', 0)
        if not _int(prefix) or prefix < 0:
            errors.append('invalid backing prefix size')
        for field in ('stride', 'count', 'capacity'):
            if not _int(contract.get(field)) or contract[field] < (1 if field != 'count' else 0):
                errors.append('invalid table ' + field)
        if not errors and contract['count'] > contract['capacity']:
            errors.append('table count exceeds candidate capacity')
        occupied = set()
        widths = {'u8': 1, 's8': 1, 'u16': 2, 's16': 2, 'u32': 4, 's32': 4}
        names = set()
        for field in contract.get('fields', []):
            offset, width, name = field.get('offset'), widths.get(field.get('type')), field.get('name')
            if name in names or not name or not _int(offset) or width is None or offset < 0 or offset + width > contract.get('stride', 0):
                errors.append('invalid typed field'); continue
            names.add(name); cells = set(range(offset, offset + width))
            if occupied & cells:
                errors.append('overlapping typed fields')
            occupied |= cells
    effects = contract.get('effects', {})
    if effects.get('status') == 'closed' and not effects.get('evidence'):
        unknown.append('closed effects lack evidence')
    accesses = effects.get('reads', []) + effects.get('writes', [])
    for access in accesses:
        space, start, size = access.get('space'), access.get('start'), access.get('size')
        if space not in SPACES or not _int(start) or not _int(size) or start < 0 or size <= 0 or start + size > SPACES.get(space, 0):
            errors.append('memory effect exceeds declared address space')
        width = access.get('width')
        if width is not None and (width not in (8, 16, 32) or _int(start) and start % (width // 8)):
            errors.append('memory access width/alignment invalid')
    for graphics in contract.get('graphics', []):
        if graphics.get('bpp') not in (None, 4, 8):
            errors.append('unsupported graphics bpp')
        for dma in graphics.get('dma', []):
            bits = dma.get('bits')
            if bits not in (16, 32) or any(not _int(dma.get(k)) or dma[k] < 0 or dma[k] % (bits // 8) for k in ('source', 'destination', 'bytes')) or dma.get('bytes') == 0:
                errors.append('DMA width/alignment/count invalid')
        if graphics.get('kind') == 'gba-tile-transfer/1':
            start, size = graphics.get('destination_offset'), graphics.get('copy_bytes')
            if not _int(start) or not _int(size) or start < 0 or size <= 0 or start + size > 0x10000:
                errors.append('BG transfer exceeds VRAM')
    return errors, unknown


def classify_access_patterns(node):
    """Evidence-linked search proposals; these never change admission readiness."""
    contract = node.get('contract', {})
    proposals = []
    fields = contract.get('fields', [])
    if contract.get('stride') == 32 and len(fields) == 16 and all(f.get('type') == 'u16' for f in fields):
        proposals.append({'label': 'possible-16-color-palette', 'confidence': 'shape-only',
                          'evidence': ['stride=32', 'sixteen u16 fields'], 'verified': False})
    effects = contract.get('effects', {})
    writes = effects.get('writes', [])
    if any(a.get('space') == 'vram' for a in writes):
        proposals.append({'label': 'graphics-memory-writer', 'confidence': 'declared-access-pattern',
                          'evidence': copy.deepcopy(effects.get('evidence', [])), 'verified': False})
    return {'proposals': proposals, 'readiness_changed': False}


def plan_substitution(host_node, candidate_node, context=None):
    """Prune contradictions; list bounded obligations, never mark a ROM runnable.

    Unknown outranks adapter proposals. `adaptable` means a bounded plan exists
    within declared typed-data constraints, not that the adapter has executed.
    """
    context = context or {}
    host, candidate = host_node.get('contract', {}), candidate_node.get('contract', {})
    errors, unknown, adapters = [], [], []
    for label, contract in (('host', host), ('candidate', candidate)):
        errs, gaps = _check_contract(contract)
        errors.extend(label + ': ' + x for x in errs)
        unknown.extend(label + ': ' + x for x in gaps)
    scope = host.get('scope')
    if not scope or not candidate.get('scope'):
        unknown.append('missing contract scope')
    elif scope != candidate.get('scope'):
        errors.append('contract scopes disagree')
    for key in ('format', 'endian', 'pointer_width', 'isa', 'abi', 'save_schema', 'state_ownership'):
        left, right = host.get(key), candidate.get(key)
        if left is not None and right is not None and left != right:
            errors.append(key + ' mismatch')
        elif (left is None) != (right is None):
            unknown.append(key + ' is not captured on both sides')
    if scope == 'typed-data-layout':
        for key in ('stride', 'fields', 'backing_prefix_size'):
            if host.get(key) != candidate.get(key):
                errors.append(key + ' mismatch requires unsupported layout conversion')
        if not errors and candidate.get('count') != host.get('count'):
            expansion = host.get('expansion', {})
            fixed = expansion.get('fixed_consumer_capacity')
            if fixed is not None and candidate['count'] > fixed:
                errors.append('candidate exceeds fixed consumer capacity')
            if candidate['count'] < host['count']:
                unknown.append('shrinking requires consumer index/lifetime proof')
            elif (expansion.get('status') != 'closed' or expansion.get('reference_closure') != 'complete'
                  or not expansion.get('closure_evidence')):
                unknown.append('growth reference closure unresolved')
            else:
                roles = {b.get('role') for b in host.get('bindings', [])}
                if 'count' not in roles and fixed is None:
                    unknown.append('growth has no captured count consumer or fixed capacity')
                if not errors and not unknown:
                    adapters.append({'kind': 'typed-table-growth', 'from_count': host['count'],
                        'to_count': candidate['count'], 'binding_roles': sorted(roles),
                        'backend': 'tools.roundtrip.memory_ontology:compile_edit',
                        'requirements': ['validate exact ROM and memory-manifest hashes',
                            'allocate guarded backing', 'rewrite captured pointer/count/length consumers',
                            'run captured graphics validators', 'retain all untouched components']})
        # A changing graphics descriptor must never be silently accepted.
        hg, cg = host.get('graphics', []), candidate.get('graphics', [])
        if hg != cg:
            for left, right in zip(hg, cg):
                for key in ('kind', 'bpp', 'transparent_index', 'region'):
                    if left.get(key) is not None and right.get(key) is not None and left[key] != right[key]:
                        errors.append('graphics ' + key + ' mismatch')
            unknown.append('graphics consumer contract changes require explicit asset/consumer lowering')
        if not host.get('fields') or not candidate.get('fields'):
            unknown.append('typed field contract missing')
    else:
        for key in ('isa', 'abi'):
            if host.get(key) is None or candidate.get(key) is None:
                unknown.append('native ' + key + ' unknown')
        he, ce = host.get('effects', {}), candidate.get('effects', {})
        if any(e.get('status') != 'closed' or not e.get('evidence') for e in (he, ce)):
            unknown.append('behavioral effects or dependency closure unresolved')
        for key in ('phase', 'lifetime', 'state_ownership', 'save_schema'):
            if he.get(key) is not None and ce.get(key) is not None and he[key] != ce[key]:
                errors.append('effect ' + key + ' mismatch')
            elif he.get(key) is None or ce.get(key) is None:
                unknown.append('effect ' + key + ' unknown')
        # Set containment is deliberately exact token matching, not theorem proving.
        for need in ce.get('requires', []):
            if need not in context.get('provides', []):
                unknown.append('unresolved candidate precondition: ' + str(need))
        for promised in he.get('provides', []):
            if promised not in ce.get('provides', []):
                (errors if ce.get('status') == 'closed' and ce.get('evidence') else unknown).append('candidate does not declare required postcondition: ' + str(promised))
        for write in ce.get('writes', []):
            if write not in he.get('writes', []):
                (errors if he.get('status') == 'closed' and he.get('evidence') else unknown).append('candidate writes outside host effect allowance')
        for read in ce.get('reads', []):
            if read not in he.get('reads', []):
                unknown.append('additional read requires lifetime/alias evidence')
        for call in ce.get('calls', []):
            if call not in context.get('services', []) and call not in he.get('calls', []):
                unknown.append('unresolved service: ' + str(call))
    if host.get('access_requirements'):
        if candidate.get('access_summary'):
            from .effects import compare_effect_constraints
            comparison = compare_effect_constraints(candidate['access_summary'], host['access_requirements'])
            errors.extend('access constraint: ' + json.dumps(item, sort_keys=True) for item in comparison['contradictions'])
            unknown.extend('access evidence: ' + str(item) for item in comparison['unknowns'])
        else:
            unknown.append('required access summary missing')
    if not candidate_node.get('provenance') or not host_node.get('provenance'):
        unknown.append('component provenance missing')
    classification = 'incompatible' if errors else 'unknown' if unknown else 'adaptable' if adapters else 'interchangeable'
    return {'schema': 'gameverse.static-substitution-plan/1', 'classification': classification,
            'scope': scope, 'target': host_node.get('id'), 'candidate': candidate_node.get('id'),
            'prune': bool(errors), 'contradictions': sorted(set(errors)),
            'unknowns': sorted(set(unknown)), 'required_adapters': adapters,
            'candidate_classification': classify_access_patterns(candidate_node),
            'executable': False, 'semantic_equivalence_verified': False,
            'native_play_verified': False,
            'next_gate': 'exact artifacts, backend admission and bounded native qualification'}


def subtree_boundary(game, node_id):
    """Describe containment plus every crossing edge without flattening aliases."""
    by_id = {n['id']: n for n in game['nodes']}
    if node_id not in by_id:
        raise ValueError('unknown subtree root')
    descendants = {node_id}
    children = {}
    for node in game['nodes']:
        children.setdefault(node.get('parent'), []).append(node['id'])
    pending = [node_id]
    while pending:
        for child in children.get(pending.pop(), []):
            if child not in descendants:
                descendants.add(child); pending.append(child)
    crossing = [copy.deepcopy(e) for e in game.get('edges', [])
                if (e['source'] in descendants) != (e['target'] in descendants)]
    return {'root': node_id, 'nodes': sorted(descendants), 'crossing_edges': crossing,
            'ownership_refs': sorted(by_id[i]['component_ref'] for i in descendants if 'component_ref' in by_id[i]),
            'unknown_effect_nodes': sorted(i for i in descendants
                if by_id[i].get('contract', {}).get('effects', {}).get('status') != 'closed')}


def compile_request(game, partition_manifest, request):
    """Compile a bounded request; graph validity precedes all branch work."""
    started = time.perf_counter()
    audit = validate_game(game, partition_manifest)
    if request.get('schema') != REQUEST_SCHEMA or request.get('game_sha256') != canonical_hash(game):
        raise ValueError('stale or unsupported composition request')
    substitutions = request.get('substitutions', [])
    bound = request.get('max_candidates', MAX_CANDIDATES)
    if not _int(bound) or not 1 <= bound <= MAX_CANDIDATES or not isinstance(substitutions, list) or not 1 <= len(substitutions) <= bound:
        raise ValueError('candidate request exceeds explicit bound')
    nodes = {n['id']: n for n in game['nodes']}
    plans, targets = [], set()
    for sub in substitutions:
        target = sub.get('target')
        if target not in nodes or target in targets:
            raise ValueError('unknown or duplicate substitution target')
        targets.add(target)
        plan = plan_substitution(nodes[target], sub['candidate'], request.get('context'))
        plan['host_boundary'] = subtree_boundary(game, target)
        if len(plan['host_boundary']['nodes']) > 1 and plan['classification'] != 'incompatible':
            plan['classification'] = 'unknown'
            plan['unknowns'].append('subtree replacement requires closed descendant and crossing-edge interface proof')
        plans.append(plan)
    # Individually allowed effects must also coexist. Lifetimes are exact tokens;
    # absent/different tokens do not prove disjointness.
    writes = []
    conflicts, joint_unknowns = [], []
    for sub in substitutions:
        effects = sub['candidate'].get('contract', {}).get('effects', {})
        for write in effects.get('writes', []):
            if any(not _int(write.get(key)) for key in ('start', 'size')):
                continue
            for target, previous, lifetime in writes:
                if write.get('space') == previous.get('space') and max(write['start'], previous['start']) < min(write['start'] + write['size'], previous['start'] + previous['size']):
                    if effects.get('concurrency') == 'exclusive-concurrent' and lifetime == 'exclusive-concurrent':
                        conflicts.append(f'concurrent write overlap: {target} / {sub["target"]}')
                    else:
                        joint_unknowns.append(f'write alias lifetime unresolved: {target} / {sub["target"]}')
            writes.append((sub['target'], write, effects.get('concurrency')))
    classifications = {p['classification'] for p in plans}
    result = ('incompatible' if conflicts or 'incompatible' in classifications else
              'unknown' if joint_unknowns or 'unknown' in classifications else
              'adaptable' if 'adaptable' in classifications else 'interchangeable')
    return {'schema': 'gameverse.composition-plan/1', 'game_sha256': canonical_hash(game),
            'classification': result, 'audit': audit, 'substitutions': plans,
            'contradictions': conflicts, 'unknowns': joint_unknowns, 'executable': False,
            'timing': {'static_analysis_seconds': time.perf_counter() - started,
                       'queue_seconds': None, 'build_seconds': None, 'simulation_seconds': None,
                       'nested_stages': [], 'outcome': result}}
