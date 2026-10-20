#!/usr/bin/env python3
"""Lossless, evidence-addressed view of recovered source systems; no promotion."""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FIELDS = {
    'inputs': {'inputs', 'input_contract', 'input_alias_evidence'},
    'outputs': {'outputs', 'events_outputs', 'output_contract', 'returns'},
    'state': {'state', 'state_owner', 'state_bindings', 'referenced_state', 'symbolic_state', 'state_views', 'owned_state', 'symbolic_state_requirements', 'symbolic_contract', 'symbolic_requirements'},
    'events': {'events', 'events_outputs', 'event_contract', 'source_transitions', 'source_observed_transitions'},
    'callOrder': {'callOrder', 'call_order', 'source_order', 'lifecycle_order', 'loop_order', 'ordering', 'ordering_requirements', 'order', 'causal_chain', 'static_causal_chain', 'chain', 'causal_edges', 'dependency_edges', 'trigger_edges', 'services_and_order', 'transitions', 'source_transitions', 'transition_rules', 'schedule'},
    'units': {'units'},
    'aliases': {'aliases', 'alias', 'alias_rule', 'ownership_and_aliasing', 'alias_contract', 'alias_requirements', 'alias_rules'},
    'dependencies': {'dependencies', 'exact_open_dependencies', 'open_dependencies', 'dependency_edges', 'dependency_targets', 'prioritized_dependency_targets', 'prioritized_targets', 'prioritized_lift_targets', 'lift_priority', 'targets'},
    'serviceEffects': {'services', 'service_effects', 'serviceEffects', 'services_and_order'},
    'preconditions': {'preconditions', 'domain', 'domains'},
    'automaticUnits': {'l1_units', 'qualified_L1_parts', 'components', 'executable_members', 'executableSubsets', 'qualified_subsets', 'executable_roots', 'automatic_attempts', 'privateAttempts'},
}

def walk(value, pointer=''):
    if isinstance(value, dict):
        for key, child in value.items():
            ptr = pointer + '/' + key.replace('~', '~0').replace('/', '~1')
            yield key, child, ptr
            yield from walk(child, ptr)
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from walk(child, pointer + '/' + str(i))

def game_id(data):
    value = data.get('game_id', data.get('gameId', data.get('game')))
    return value.get('id') if isinstance(value, dict) else value

def normalize(path, data, ordinal, source_hash):
    game = game_id(data) or next((p for p in path.parts if (ROOT / 'ontology/portraits' / (p + '.json')).exists()), None)
    if not game:
        raise ValueError(f'{path}: missing original game identity')
    ref = str(path.relative_to(ROOT))
    mechanic = next((data[k] for k in ('mechanic_closure', 'mechanic', 'closure', 'causal_closure') if isinstance(data.get(k), dict)), {})
    name = data.get('name') or mechanic.get('name') or mechanic.get('title') or mechanic.get('label') or mechanic.get('id') or data.get('id') or data.get('subsystem_id') or data.get('subsystem') or ('Source analysis: ' + game)
    if not isinstance(name, str):
        name = 'Source analysis: ' + game
    system = {
        'id': data.get('id') or f'{game}.source-system.' + hashlib.sha256(ref.encode()).hexdigest()[:10], 'gameId': game, 'name': name,
        'capabilities': [] if name.startswith('Source analysis: ') else [name], 'readiness': 'source-backed-system' if 'next-extraction' in path.parts else 'static',
        'evidenceLevel': 'static-own-rom-analysis', 'executable': False, 'complete': False,
        'recordKind': 'source-system-contract' if 'next-extraction' in path.parts else 'prior-source-analysis',
        'provenance': [{'ref': ref, 'sha256': source_hash, 'sourceCommit': data.get('source_commit')}],
    }
    flattened = list(walk(data))
    for field, keys in FIELDS.items():
        system[field] = [{'value': value, 'provenance': {'ref': ref, 'pointer': ptr}}
                         for key, value, ptr in flattened if key in keys and value not in (None, [], {}, '')
                         and not (field == 'callOrder' and isinstance(value, (int, float, bool)))]
    gaps = [{'value': value, 'provenance': {'ref': ref, 'pointer': ptr}}
            for key, value, ptr in flattened if key in {'blockers', 'gaps', 'next_closure_boundary', 'closure_boundary', 'closure', 'next_action', 'assembly_blockers', 'open_dependencies', 'limits', 'native_limits', 'service_limit', 'claims_excluded', 'not_claimed', 'notClaimed'}]
    missing = [field for field in FIELDS if not system[field]]
    system['coverage'] = {
        'scope': mechanic.get('scope', mechanic.get('closure_kind', data.get('scope'))),
        'originalStatus': data.get('status', data.get('readiness')), 'gaps': gaps,
        'unavailableFields': missing,
        'interpretation': 'Facts are source assertions with exact packet pointers, not newly verified execution. Empty fields mean unavailable, not absent effects. Dependencies may be unresolved targets. Call-order evidence may explicitly include unproven edges.',
    }
    # Only explicit source edges become graph edges; prose chains are not guessed.
    edges = []
    for key, value, ptr in flattened:
        if key not in {'causal_edges', 'dependency_edges', 'trigger_edges', 'edges', 'transitions'} or not isinstance(value, list):
            continue
        for i, edge in enumerate(value):
            if not isinstance(edge, dict) or not edge.get('from') or not edge.get('to'):
                continue
            text = json.dumps(edge).lower()
            uncertain = any(word in text for word in ('unverified', 'unproven', 'unresolved', 'not proven', 'frontier', 'not yet recovered', 'requires further', 'inferred', 'not established', 'not closed', 'unknown', 'missing', 'pending', 'unqualified'))
            edges.append({'from': edge['from'], 'to': edge['to'], 'kind': edge.get('kind', 'source-dependency'),
                          'support': 'unresolved' if uncertain else 'source-assertion-unqualified',
                          'executable': False, 'claim': edge,
                          'provenance': {'ref': ref, 'pointer': ptr + '/' + str(i)}})
    node_ids = sorted({str(e[k]) for e in edges for k in ('from', 'to')})
    system['graph'] = {'nodes': [{'id': n, 'kind': 'source-symbol'} for n in node_ids], 'edges': edges,
                       'scope': 'Explicit packet edges only; prose order is preserved separately. All edges are unqualified source assertions, never executable connections. Unresolved is a conservative text flag, not a complete semantic validation.'}
    system['qualificationEvidence'] = [{'value': value, 'provenance': {'ref': ref, 'pointer': ptr}}
                                       for key, value, ptr in flattened if key in {'qualification', 'evidence_levels', 'evidence_layers', 'native_limits'}]
    system['automaticArtifactRefs'] = [
        {'value': value, 'provenance': {'ref': ref, 'pointer': ptr}, 'status': 'source-reference-not-requalified'}
        for key, value, ptr in flattened
        if (isinstance(value, dict) and isinstance(value.get('path'), str) and value['path'].endswith('/l1.json'))
        or (isinstance(value, str) and value.endswith('/l1.json'))
    ]
    system['sourceEvidence'] = [
        {'value': value, 'provenance': {'ref': ref, 'pointer': '/' + key}}
        for key, value in data.items()
        if key in {'provenance', 'source', 'source_provenance', 'source_refs', 'source_pins', 'source_context'}
    ]
    # Preserve every original field, including qualification boundaries and evidence pins.
    system['sourceFacts'] = data
    return system

def build(extra):
    start = time.perf_counter()
    paths = sorted((ROOT / 'research/deep-extraction/resume').glob('*/packet.json'))
    manifest = OUT / 'additional-sources.json'
    if manifest.exists():
        paths += [ROOT / p for p in json.loads(manifest.read_text())]
    paths += [ROOT / p for p in extra]
    paths = sorted(set(paths))
    systems, ordinals = [], {}
    for path in paths:
        raw = path.read_bytes()
        data = json.loads(raw)
        game = game_id(data) or next((p for p in path.parts if (ROOT / 'ontology/portraits' / (p + '.json')).exists()), None)
        ordinals[game] = ordinals.get(game, 0) + 1
        systems.append(normalize(path, data, ordinals[game], hashlib.sha256(raw).hexdigest()))
    executable = json.loads((ROOT / 'ontology/executable-components/index.json').read_text())
    components = executable['entries']
    games = []
    for path in sorted((ROOT / 'ontology/portraits').glob('*.json')):
        portrait = json.loads(path.read_text())
        game = portrait['game_id']
        linked = [s['id'] for s in systems if s['gameId'] == game]
        has_contract = any(s['gameId'] == game and s['recordKind'] == 'source-system-contract' for s in systems)
        full_components = []
        for component in components:
            if component['source_game'] == game:
                record_path = ROOT / 'ontology/executable-components' / component['record']
                contract_raw = record_path.read_bytes()
                contract = json.loads(contract_raw)
                full_components.append({'indexEntry': component, 'contract': contract,
                                        'readiness': 'native-qualified' if contract.get('qualification', {}).get('status') == 'pass' else 'automatic-executable',
                                        'builderEligibility': {
                                            'typedPortsReady': contract.get('assembly_status') == 'qualified_typed_ports',
                                            'assemblyStatus': contract.get('assembly_status', 'unavailable'),
                                            'bindingStatus': 'published-typed-component-available-for-binding' if contract.get('assembly_status') == 'qualified_typed_ports' else 'semantic-binding-unresolved',
                                            'presetGeneratorSupport': 'not-evaluated',
                                            'unboundSelection': 'source-selection-only',
                                            'validationRequired': ['port types and units', 'dependency closure', 'source preconditions and qualification domain', 'state aliases and lifecycle', 'call order and service effects'],
                                            'scope': 'Published contract readiness only; selection never establishes a complete mechanic or executable source system.'},
                                        'provenance': {'ref': str(record_path.relative_to(ROOT)), 'sha256': hashlib.sha256(contract_raw).hexdigest()}})
        games.append({'gameId': game, 'name': portrait.get('title', game), 'systems': linked,
                      'complete': False, 'readiness': 'source-backed-system' if has_contract else ('static' if linked else 'partial-evidence'),
                      'automaticComponents': full_components})
    published = [c for game in games for c in game['automaticComponents']]
    origins = {}
    for component in published:
        origin = component['contract'].get('origin', 'unavailable')
        origins[origin] = origins.get(origin, 0) + 1
    payload = {'schema': 'gameverse.recovered-systems-index/1', 'scope': 'Partial source systems across original games; no generated games or authored demo L2.',
               'systems': systems, 'games': games,
               'counts': {'originalGames': len(games), 'analysisRecords': len(systems),
                          'sourceSystems': sum(s['recordKind'] == 'source-system-contract' for s in systems),
                          'priorSourceAnalysisRecords': sum(s['recordKind'] == 'prior-source-analysis' for s in systems),
                          'gamesWithSourceAnalysis': len(ordinals),
                          'gamesWithSourceSystemContracts': len({s['gameId'] for s in systems if s['recordKind'] == 'source-system-contract'}),
                          'completeGames': 0,
                          'recoveredExecutableL2': 0, 'automaticComponentPackages': len(components),
                          'automaticTypedPortPackages': sum(c['builderEligibility']['typedPortsReady'] for c in published),
                          'automaticPackageOrigins': origins},
               'readinessDefinitions': {'raw': 'Retained ROM or export only', 'static': 'Static facts only',
                   'source-backed-system': 'Causal/state/dependency source analysis, possibly unresolved; not executable',
                   'automatic-executable': 'Automatically lifted executable body, requires qualification evidence',
                   'native-qualified': 'Finite native comparison within declared domain; not complete game'},
               'limitations': ['No source system is promoted to executable by ingestion.', 'Automatic component package counts include declared sequences; inspect original qualification records.',
                               'Authored games and demos are excluded.', 'No source mining, build, emulator, LLM or qualification runs occur in this view builder.']}
    staging = OUT / '.index.json.tmp'
    staging.write_text(json.dumps(payload, indent=2) + '\n')
    staging.replace(OUT / 'index.json')
    elapsed = time.perf_counter() - start
    print(json.dumps({'outcome': 'pass', 'sourcePackets': len(paths), 'systems': len(systems), 'wallSeconds': elapsed,
                      'queueSeconds': None, 'buildSeconds': None, 'simulationSeconds': None,
                      'scope': 'Local JSON normalization and write only; source assertions unchanged'}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', action='append', default=[], help='Additional repo-relative system JSON')
    args = parser.parse_args()
    build(args.source)
