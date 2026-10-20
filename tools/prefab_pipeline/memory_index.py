"""Add pinned memory semantics to existing prefab discovery without promotion.

Explicit manifests remain private inputs. Byte ownership belongs to roundtrip;
this adapter exposes references, properties and unknowns, never a second catalog.
"""
from __future__ import annotations
import copy
from tools.roundtrip.memory_ontology import SCHEMA, canonical, sha, partition, span


def resolve_memory_indexes(reader, indexes):
    """Resolve small producer indexes/receipts through the same bounded reader.

    Indexes contain references, never duplicate table payloads. Every included
    manifest requires a file pin; stale producer output is a visible gap.
    """
    refs, documents = [], []
    for index_ref in sorted(set(indexes or [])):
        index, _ = reader.read(index_ref)
        if isinstance(index, dict) and index.get('schema') == 'gameverse.crossgame-ontology-wave-results/1':
            for game in index.get('games', []):
                producer = game.get('producer', {})
                document, path = reader.read(producer.get('path'))
                if not document or reader.pins.get(path) != producer.get('sha256'):
                    reader.gaps.append('Stale or missing memory producer: ' + str(producer.get('path')))
                else:
                    documents.append((document, path))
        else:
            documents.append((index, index_ref))
    for index, index_ref in documents:
        if not isinstance(index, dict) or not isinstance(index.get('memory_manifest_refs'), list):
            reader.gaps.append('Missing memory_manifest_refs in memory index: ' + str(index_ref))
            continue
        for entry in index['memory_manifest_refs']:
            if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or not isinstance(entry.get('sha256'), str):
                reader.gaps.append('Memory index requires pinned manifest references: ' + str(index_ref))
                continue
            manifest, path = reader.read(entry['path'])
            if manifest is None or reader.pins.get(path) != entry['sha256']:
                reader.gaps.append('Stale or missing indexed memory manifest: ' + entry['path'])
                continue
            # Keep all receipt pins while exposing the producer's current baseline.
            if entry.get('role', entry.get('stage', 'baseline')) in ('baseline', 'current'):
                refs.append(path)
    return sorted(set(refs))


def load_memory(reader, game_id, manifest_refs):
    graphs, gaps = [], []
    for ref in sorted(set(manifest_refs or [])):
        manifest, path = reader.read(ref)
        if not isinstance(manifest, dict) or manifest.get('schema') != SCHEMA:
            gaps.append('Missing or unsupported memory ontology: ' + str(ref))
            continue
        if manifest.get('game_id') != game_id:
            continue
        try:
            allocations = manifest.get('allocations', [])
            tables = manifest.get('tables', [])
            if not isinstance(allocations, list) or not isinstance(tables, list):
                raise ValueError('allocations and tables must be lists')
            for allocation in allocations:
                if 'rom_offset' in allocation:
                    span(allocation['rom_offset'], allocation['size'], manifest['rom']['size'], allocation['id'])
            ids = [a['id'] for a in allocations]
            if len(set(ids)) != len(ids):
                raise ValueError('duplicate allocation identity')
            if len({t['id'] for t in tables}) != len(tables):
                raise ValueError('duplicate table identity')
            if any(t['allocation_id'] not in ids for t in tables):
                raise ValueError('table references unknown allocation')
            coverage = partition(manifest)
        except (ValueError, KeyError, TypeError) as exc:
            gaps.append('Invalid memory ontology ' + str(ref) + ': ' + str(exc))
            continue
        graphs.append({'schema': SCHEMA, 'manifest_ref': {'path': path, 'sha256': reader.pins[path]},
                       'manifest_sha256': sha(canonical(manifest)), 'manifest': manifest,
                       'coverage': coverage, 'verification': 'pinned-inventory; ROM bytes unverified during discovery',
                       'whole_game': False})
    return graphs, gaps


def _owners(value):
    result = set()
    for field in ('package_ids', 'prefab_ids', 'module_ids'):
        result.update(x for x in value.get(field, []) if isinstance(x, str))
    for field in ('component_id', 'package_id', 'module_id', 'prefab_id'):
        if isinstance(value.get(field), str):
            result.add(value[field])
    return result


def memory_edges(manifest):
    """Normalize declared table bindings while retaining original graph edges."""
    edges = copy.deepcopy(manifest.get('edges', manifest.get('consumer_dependencies', manifest.get('graph', {}).get('edges', []))))
    for table in manifest.get('tables', []):
        if table['id'] != table['allocation_id']:
            edges.append({'source': table['id'], 'target': table['allocation_id'], 'kind': 'stored-in', 'confidence': 'declared-layout'})
        for field in table.get('fields', []):
            if field.get('references_table'):
                edges.append({'source': table['id'], 'target': field['references_table'], 'kind': 'references', 'field': field['name'], 'confidence': 'declared-typed-reference'})
        for binding in table.get('bindings', []):
            allocation = next((a['id'] for a in manifest.get('allocations', []) if 'rom_offset' in a and a['rom_offset'] <= binding['rom_offset'] < a['rom_offset'] + a['size']), None)
            source = binding.get('source_consumer') or allocation or 'rom-binding:' + str(binding['rom_offset'])
            edges.append({'source': source, 'target': table['id'], 'kind': binding['role'], 'rom_offset': binding['rom_offset'], 'confidence': 'declared-compiler-binding', 'allocation_id': allocation})
    return edges


def attach_memory(candidate, graphs):
    owners = {candidate['id'], *candidate.get('package_ids', [])}
    candidate['memory_graphs'], candidate['editable_properties'] = [], []
    for graph in graphs:
        manifest = graph['manifest']
        allocations = {a['id']: a for a in manifest.get('allocations', [])}
        joined = {key for key, allocation in allocations.items() if owners & _owners(allocation) or owners & _owners(manifest)}
        joined.update(t['allocation_id'] for t in manifest.get('tables', []) if t['id'] in candidate.get('memory_table_ids', []))
        tables = [t for t in manifest.get('tables', [])
                  if t['allocation_id'] in joined or owners & _owners(t)]
        if not joined and not tables:
            continue
        candidate['memory_graphs'].append({
            'manifest_ref': graph['manifest_ref'], 'manifest_sha256': graph['manifest_sha256'],
            'allocation_ids': sorted(joined | {t['allocation_id'] for t in tables}),
            'reference_edges': memory_edges(manifest),
            'table_ids': [t['id'] for t in tables], 'verification': graph['verification']})
        candidate['source']['refs'].append(graph['manifest_ref'])
        for table in tables:
            expansion = copy.deepcopy(table.get('expansion', {}))
            reason = expansion.get('reason') or 'Expansion reference closure has not been established'
            candidate['editable_properties'].append({
                'schema': 'gameverse.prefab-memory-properties/1', 'table_id': table['id'],
                'allocation_id': table['allocation_id'], 'manifest_ref': graph['manifest_ref'],
                'manifest_sha256': graph['manifest_sha256'], 'fields': copy.deepcopy(table.get('fields', [])),
                'row_count': len(table.get('rows', [])), 'captured_rows': copy.deepcopy(table.get('rows', [])), 'capacity': table.get('capacity'),
                'stride': table.get('stride'), 'bindings': copy.deepcopy(table.get('bindings', [])),
                'expansion': expansion, 'set_entrypoint': 'tools.roundtrip.memory_ontology:compile_edit',
                'validation_required': 'exact-ROM validation and compiler admission; native play unverified',
                'unsupported_closure_reasons': [] if expansion.get('status') == 'closed' else [reason]})
            if expansion.get('status') != 'closed':
                candidate['gaps'].append('Memory table expansion ' + table['id'] + ': ' + reason)


def query_memory(extraction, game_id=None, node=None, uncategorized=False):
    results = []
    for game in extraction.get('games', []):
        if game_id and game['game_id'] != game_id:
            continue
        for graph in game.get('memory_graphs', []):
            manifest = graph['manifest']
            allocations = manifest.get('allocations', [])
            edges = memory_edges(manifest)
            result = {'game_id': game['game_id'], 'manifest_ref': graph['manifest_ref'],
                      'manifest_sha256': graph['manifest_sha256'], 'coverage': graph['coverage']}
            if uncategorized:
                result['allocations'] = [a for a in allocations if a.get('kind') in ('unclassified', 'mixed') or a.get('semantic', {}).get('status') == 'unknown']
            elif node:
                impacted, changed = {node}, True
                # A -> B denotes A depends on/reads/references B; include reverse consumers.
                while changed:
                    changed = False
                    for edge in edges:
                        source, target = edge.get('source', edge.get('from')), edge.get('target', edge.get('to'))
                        if target in impacted and source and source not in impacted:
                            impacted.add(source); changed = True
                result.update(node=node, dependent_ids=sorted(impacted - {node}),
                              edges=[e for e in edges if e.get('source', e.get('from')) in impacted or e.get('target', e.get('to')) in impacted])
            else:
                result.update(allocations=allocations, tables=manifest.get('tables', []), edges=edges)
            results.append(result)
    return {'schema': 'gameverse.prefab-memory-query/1', 'results': results,
            'scope': 'declared dependency inventory only; unknown edges and native closure remain open'}


def property_plan(extraction, table_id, operations, game_id=None):
    matches = [(g, graph, t) for g in extraction.get('games', []) if not game_id or g['game_id'] == game_id
               for graph in g.get('memory_graphs', []) for t in graph['manifest'].get('tables', []) if t['id'] == table_id]
    if len(matches) != 1:
        raise ValueError('table identity must select exactly one pinned memory manifest')
    game, graph, table = matches[0]
    known_tables = {t['id'] for t in graph['manifest'].get('tables', [])}
    if not isinstance(operations, list) or not operations or any(not isinstance(op, dict) or op.get('table') not in known_tables for op in operations) or not any(op['table'] == table_id for op in operations):
        raise ValueError('operations must include selected table and use only tables from its pinned manifest')
    return {'schema': 'gameverse.prefab-memory-edit-plan/1', 'status': 'planned',
            'game_id': game['game_id'], 'manifest_ref': graph['manifest_ref'],
            'affected_table_ids': sorted({op['table'] for op in operations}),
            'baseline_rom': copy.deepcopy(graph['manifest']['rom']),
            'request': {'manifest_sha256': graph['manifest_sha256'], 'operations': operations},
            'compiler': 'python3 -B -m tools.roundtrip.memory_ontology',
            'required_inputs': ['exact ROM matching manifest.rom', 'request saved as JSON'],
            'compiler_arguments': {'--manifest': graph['manifest_ref']['path'], '--rom': '<exact-ROM>', '--request': '<request.json>', '--output': '<fresh-directory>'},
            'expansion': table.get('expansion', {}), 'execution_allowed': False,
            'scope': 'reviewable compiler request only; no allocation, ROM validation or native qualification performed'}


def memory_candidates(graphs, existing, game_id):
    """Derive source-only asset families for unmatched tables, never catalog rows."""
    derived = []
    occupied = {c['id'] for c in existing}
    for graph in graphs:
        manifest = graph['manifest']
        allocations = {a['id']: a for a in manifest.get('allocations', [])}
        unmatched = []
        for table in manifest.get('tables', []):
            claims = _owners(table) | _owners(allocations[table['allocation_id']]) | _owners(manifest)
            if not any(claims & {c['id'], *c.get('package_ids', [])} for c in existing):
                unmatched.append(table)
        if not unmatched:
            continue
        ident = manifest.get('module_id') or game_id + '.memory.' + unmatched[0]['allocation_id']
        if ident in occupied:
            continue
        occupied.add(ident)
        gaps = ['Source memory asset family has no admitted native lifecycle or gameplay prefab closure.',
                'Property compiler validates exact bytes and typed layout only; native gameplay is unverified.']
        derived.append({'schema_version': 1, 'id': ident, 'prefab_id': ident, 'module_id': ident,
            'game_id': game_id, 'name': manifest.get('name') or manifest.get('semantic', {}).get('family') or ', '.join(t.get('symbol', t['id']) for t in unmatched),
            'level': 'L0', 'backend': 'source-engine-import',
            'source': {'kind': 'memory-asset-family', 'refs': [], 'sha256': None, 'commit': manifest.get('source_revision') if isinstance(manifest.get('source_revision'), str) else None},
            'provides': [{'id': t['id'], 'type': 'typed-memory-asset', 'semantic': t.get('symbol', t['id'])} for t in unmatched],
            'requires': [], 'state': [], 'lifecycle': {'entry': None, 'exit': None, 'tick': None, 'save': None},
            'dependencies': [], 'assets': [{'id': t['allocation_id'], 'type': 'source-memory-allocation'} for t in unmatched],
            'resources': [], 'domain': {}, 'schedule': {}, 'progression': {},
            'closure': {'status': 'open', 'missing': gaps.copy()}, 'gaps': gaps, 'evidence': [],
            'descriptor_refs': [], 'package_ids': [], 'memory_table_ids': [t['id'] for t in unmatched],
            'maturity': {'source_only': True, 'L1_qualified': False, 'L2_binding_valid': False, 'full_rom': False, 'whole_game': False},
            'discovery': {'derived_from': graph['manifest_ref'], 'catalog_registration': False}})
    return derived
