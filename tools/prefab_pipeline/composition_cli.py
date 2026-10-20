"""Agent-facing whole-game inventory and static substitution planning.

Uses canonical partition owners and pinned discovery. No compilation, emulator,
provider call, readiness promotion or guessed adapter is performed here.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import time


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_ref(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def _check_extraction(extraction, root):
    if extraction.get('schema') != 'gameverse.prefab-extraction/1':
        raise ValueError('unsupported extraction schema')
    from .contract import verify_file_ref
    for game in extraction.get('games', []):
        for ref in game.get('input_pins', []):
            if ref.get('sha256') is not None and not verify_file_ref(ref, root):
                raise ValueError('stale extraction input: ' + ref['path'])


def import_extraction(extraction, partition, game_id, root, partition_ref, memory_sha256=None):
    from tools.whole_game_composition.core import import_game, validate_game
    root = Path(root).resolve()
    _check_extraction(extraction, root)
    matches = [g for g in extraction.get('games', []) if g['game_id'] == game_id]
    if len(matches) != 1:
        raise ValueError('game must select exactly one extracted inventory')
    source = matches[0]
    graphs = source.get('memory_graphs', [])
    if memory_sha256:
        graphs = [g for g in graphs if g['manifest_sha256'] == memory_sha256]
    if len(graphs) > 1:
        raise ValueError('multiple memory manifests: select --memory-sha256 explicitly')
    graph = graphs[0] if graphs else None
    game = import_game(partition, graph['manifest'] if graph else None,
                       partition_ref=partition_ref, memory_ref=graph['manifest_ref'] if graph else None)
    # Registry joins are source declarations, not new byte ownership or closure.
    game['dependency_registry'] = [{
        'candidate_id': c['id'], 'module_id': c.get('module_id'),
        'package_ids': c.get('package_ids', []), 'provides': copy.deepcopy(c.get('provides', [])),
        'dependencies': copy.deepcopy(c.get('dependencies', [])),
        'dependency_links': copy.deepcopy(c.get('dependency_links', [])),
        'memory_joins': copy.deepcopy(c.get('memory_graphs', [])),
        'library_refs': [x['ref'] for x in c.get('library_capabilities', [])],
        'source_refs': copy.deepcopy(c.get('source', {}).get('refs', [])),
        'maturity': copy.deepcopy(c.get('maturity', {})),
        'scope': 'declared source joins; no inferred consumer or gameplay closure'
    } for c in source.get('candidates', [])]
    game['extraction_context'] = {'game_id': game_id, 'cache_key': source.get('cache_key'),
                                  'tool_sha256': extraction.get('tool_sha256')}
    game = _attach_behavior_inventory(game, extraction, source, root)
    audit = validate_game(game, partition)
    return {'schema': 'gameverse.prefab-composition-import/1', 'status': 'imported',
            'game': game, 'game_sha256': canonical_hash(game), 'audit': audit,
            'execution_allowed': False}


def query_composition(game, node=None, kind=None, search=None, candidates=None, max_candidates=128):
    from tools.whole_game_composition.core import plan_substitution, classify_access_patterns
    if game.get('schema') != 'gameverse.whole-game-composition/1':
        raise ValueError('unsupported composition schema')
    if type(max_candidates) is not int or not 1 <= max_candidates <= 128:
        raise ValueError('max_candidates must be between 1 and 128')
    nodes = game.get('nodes', [])
    selected = [n for n in nodes if (not node or n['id'] == node)
                and (not kind or n.get('kind') == kind)
                and (not search or search.lower() in json.dumps(n, sort_keys=True).lower())]
    if node and not selected:
        raise ValueError('unknown composition node: ' + node)
    result = {'schema': 'gameverse.prefab-composition-query/1', 'status': 'inspected',
              'game_sha256': canonical_hash(game), 'nodes': selected,
              'access_pattern_classifications': {n['id']: classify_access_patterns(n) for n in selected},
              'dependency_registry': game.get('dependency_registry', []),
              'edges': [e for e in game.get('edges', []) if not node or node in (e.get('source'), e.get('target'))],
              'scope': 'static inventory and declared dependencies; no whole-game compatibility claim',
              'execution_allowed': False}
    if candidates is not None:
        if len(selected) != 1:
            raise ValueError('compatibility search requires exactly one target --node')
        if candidates.get('schema') != 'gameverse.whole-game-composition/1':
            raise ValueError('unsupported candidate composition schema')
        eligible = [n for n in candidates.get('nodes', []) if n.get('kind') == selected[0].get('kind')]
        result['candidate_evidence'] = {k: candidates.get(k) for k in ('partition', 'memory', 'extraction_context')}
        result['candidate_count'] = len(eligible)
        result['truncated'] = len(eligible) > max_candidates
        result['compatibility'] = [{'candidate_id': n['id'], 'candidate_game_sha256': canonical_hash(candidates),
                                    'plan': plan_substitution(selected[0], n)} for n in eligible[:max_candidates]]
    return result


def plan_composition_request(game, partition, request, root=None):
    from tools.whole_game_composition.core import compile_request
    start = time.perf_counter()
    if root is not None:
        from .contract import verify_file_ref
        for substitution in request.get('substitutions', []):
            provenance = substitution.get('candidate', {}).get('provenance', {})
            ref = provenance.get('memory_ref') or provenance.get('memory_manifest_ref')
            if ref:
                if not verify_file_ref(ref, root):
                    raise ValueError('stale candidate memory manifest')
                from tools.whole_game_composition.core import memory_table_node
                source = Path(ref['path'])
                if not source.is_absolute():
                    source = Path(root) / source
                manifest = json.loads(source.read_text())
                candidate = substitution['candidate']
                expected = memory_table_node(manifest, candidate.get('memory_table_ref'), ref)
                if candidate.get('contract') != expected['contract']:
                    raise ValueError('candidate contract disagrees with pinned memory table')
                for key in ('memory_manifest_sha256', 'rom', 'parent_manifest_sha256'):
                    if provenance.get(key) != expected['provenance'].get(key):
                        raise ValueError('candidate provenance disagrees with pinned memory table')
                parent = manifest.get('parent_manifest_sha256')
                if parent and manifest.get('game_id') == (game.get('game_id') or game.get('extraction_context', {}).get('game_id')):
                    if parent != (game.get('memory') or {}).get('canonical_sha256'):
                        raise ValueError('candidate memory parent disagrees with host manifest')
    result = compile_request(game, partition, request)
    result['pipeline_timing'] = {'static_analysis_wall_s': time.perf_counter() - start,
                                 'build_wall_s': None, 'simulation_wall_s': None,
                                 'scope': 'static gate only; no build or simulation launched'}
    result['status'] = 'blocked' if result.get('classification') in ('incompatible', 'unknown') else 'planned'
    result['execution_allowed'] = False
    return result


def memory_candidate_document(path, table_id=None):
    """Read explicit candidate table metadata; do not fabricate ROM ownership."""
    from tools.whole_game_composition.core import memory_table_node
    path = Path(path)
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('candidate memory manifest exceeds 64 MiB')
    manifest = json.loads(path.read_text())
    tables = manifest.get('tables', [])
    if len(tables) > 128:
        raise ValueError('candidate memory manifest exceeds 128 tables; select a bounded manifest')
    selected = [t for t in tables if not table_id or t['id'] == table_id]
    if table_id and not selected:
        raise ValueError('candidate table not found: ' + table_id)
    nodes = [memory_table_node(manifest, t['id'], file_ref(path)) for t in selected]
    for node in nodes:
        node['provenance']['game_id'] = manifest.get('game_id')
    return {'schema': 'gameverse.whole-game-composition/1',
            'nodes': nodes,
            'memory': {'ref': file_ref(path), 'canonical_sha256': canonical_hash(manifest)},
            'scope': 'candidate table overlay only; no address ownership assertion'}


def _attach_behavior_inventory(game, extraction, selected, root):
    from tools.whole_game_composition.effects import import_behavior_overlay
    seen = set()
    pins = {p['path']: p['sha256'] for g in extraction['games'] for p in g.get('input_pins', [])}
    for inventory in extraction['games']:
        for candidate in inventory.get('candidates', []):
            for package in candidate.get('packages', []):
                if package['id'] in seen:
                    continue
                behavior_ref = package.get('behavior_ref')
                receipt_ref = package.get('receipt_ref')
                if not behavior_ref or not pins.get(behavior_ref) or pins[behavior_ref] != package.get('behavior_sha256'):
                    continue
                receipt = json.loads((root / receipt_ref).read_text()) if receipt_ref and pins.get(receipt_ref) else {}
                same_inventory = inventory['game_id'] == selected['game_id']
                rom_match = receipt.get('rom_sha256') == game['rom']['sha256']
                if not same_inventory and not rom_match:
                    continue
                seen.add(package['id'])
                behavior = json.loads((root / behavior_ref).read_text())
                if not behavior.get('id'):
                    behavior['id'] = package['id']
                provenance = {'package_id': package['id'], 'source_game': inventory['game_id'],
                              'behavior_ref': {'path': behavior_ref, 'sha256': pins[behavior_ref]},
                              'behavior_sha256': pins[behavior_ref],
                              'package_ref': {'path': package['manifest_ref'], 'sha256': pins[package['manifest_ref']]},
                              'source_rom_identity': 'exact-receipt-hash-match' if rom_match else 'unresolved',
                              'native_component_mapping': 'unplaced; no explicit canonical component join'}
                if package.get('manifest', {}).get('source_contract'):
                    provenance['source_contract_refs'] = [{
                        'path': package['manifest_ref'], 'sha256': pins[package['manifest_ref']],
                        'json_pointer': '/source_contract',
                        'scope': 'retained raw package source contract; not inferred physical layout'}]
                if receipt_ref and pins.get(receipt_ref):
                    provenance['receipt_ref'] = {'path': receipt_ref, 'sha256': pins[receipt_ref]}
                    provenance['receipt_rom_sha256'] = receipt.get('rom_sha256')
                game = import_behavior_overlay(game, behavior, provenance=provenance)
    return game
