"""Per-mod qualification contract over retained playtester scenario evidence.

This selects applicable checks and compares pinned original/candidate runs. It
adds no simulator, model policy, universal metric, or automatic full-game claim.
"""
from __future__ import annotations
import json
from pathlib import Path
from .core import digest, require
from .rpg_adapter import checked
from .scenario import validate as scenario_validate, matches

VERSION = 'gameverse.mod-quality/1'
KINDS = {'objective', 'invariant', 'reachability', 'changed_mechanic'}


def validate(spec):
    require(spec.get('schema') == VERSION and isinstance(spec.get('id'), str), 'invalid_mod_quality_spec')
    for side in ('original', 'candidate'):
        version = spec.get(side, {})
        require(all(isinstance(version.get(key), str) and version[key] for key in
                    ('game_id', 'game_version', 'source_revision', 'adapter_version')), 'missing_mod_quality_version_pin')
        start = version.get('startpoint', {})
        require(start.get('kind') in ('native_checkpoint', 'ordinary_save', 'fresh_boot')
                and isinstance(start.get('boundary'), dict) and bool(start['boundary'])
                and isinstance(start.get('provenance'), str) and bool(start['provenance']), 'invalid_mod_quality_startpoint')
        require(isinstance(start.get('reference'), dict) and bool(start['reference'].get('sha256')), 'unpinned_mod_quality_startpoint')
    require(spec['original']['game_version'] != spec['candidate']['game_version'],
            'unchanged_artifact_is_baseline_not_mod_quality')
    comparison = spec.get('comparison', {})
    require(comparison.get('inputs') in ('same', 'mapped', 'different')
            and isinstance(comparison.get('reason'), str) and bool(comparison['reason']), 'invalid_mod_quality_comparison')
    if comparison['inputs'] == 'mapped':
        require(isinstance(comparison.get('mapping_reference'), dict)
                and bool(comparison['mapping_reference'].get('sha256')), 'missing_mod_quality_mapping')
    checks = spec.get('checks')
    require(isinstance(checks, list) and 1 <= len(checks) <= 128, 'invalid_mod_quality_checks')
    seen = set()
    for check in checks:
        require(isinstance(check.get('id'), str) and check['id'] not in seen and check.get('kind') in KINDS,
                'invalid_mod_quality_check')
        seen.add(check['id'])
        require(isinstance(check.get('expectations'), dict) and bool(check['expectations'])
                and set(check['expectations']) <= {'original', 'candidate'}, 'invalid_mod_quality_expectations')
        for scenario in check['expectations'].values(): scenario_validate(scenario)
    require(KINDS <= {row['kind'] for row in checks}, 'missing_mod_quality_check_categories')
    require(any(row['kind'] == 'changed_mechanic' and set(row['expectations']) == {'original', 'candidate'} for row in checks),
            'changed_mechanic_requires_original_and_candidate_expectations')
    changed = [row for row in checks if row['kind'] == 'changed_mechanic' and set(row['expectations']) == {'original', 'candidate'}]
    def predicates(scenario):
        return [[condition for condition in node['conditions']] for node in scenario['nodes']]
    require(any(digest(predicates(row['expectations']['original'])) != digest(predicates(row['expectations']['candidate']))
                for row in changed), 'changed_mechanic_requires_distinct_source_expectations')
    return spec


def _scenario_witness(scenario, observations, *, invariant=False):
    """Replay only retained source observations using the existing predicate DAG."""
    if not observations: return None
    reached = {}
    for observation in observations:
        facts = observation.get('facts', {})
        for node in scenario['nodes']:
            prerequisites = all(parent in reached for parent in node.get('after', []))
            present = all(matches(facts, row) for row in node['conditions'])
            if invariant and prerequisites and not present:
                return {'status': 'failed', 'frame': observation['frame'], 'node': node['id'],
                        'reason': 'observed_invariant_violation'}
            if node['id'] not in reached and prerequisites and present:
                reached[node['id']] = {'frame': observation['frame'], 'state_key': observation['state_key']}
    if all(goal in reached for goal in scenario['goals']):
        return {'status': 'passed', 'nodes': reached,
                'scope': 'retained observation boundaries only; intermediate frames not inferred'}
    return {'status': 'unknown', 'nodes': reached, 'reason': 'required_source_predicate_not_observed'}


def evaluate(spec, runs):
    """runs[side] contains hashed report/events refs and actual start boundary.

    Missing coverage stays unknown; a run limit or absent event is never itself
    evidence that the game's objective is unreachable or its mechanic is broken.
    """
    spec = validate(spec)
    retained, inputs, boundary_proofs = {}, {}, {}
    for side in ('original', 'candidate'):
        run = runs.get(side)
        if run is None: continue
        report_path, events_path = checked(run['report']), checked(run['events'])
        report = json.loads(report_path.read_text())
        require(report.get('events_sha256') == run['events']['sha256'], 'mod_quality_unbound_events')
        expected = spec[side]
        adapter = report.get('adapter', {})
        require(all(adapter.get(key) == expected[key] for key in ('game_id', 'game_version', 'adapter_version')),
                'mod_quality_run_version_mismatch')
        require(run.get('source_revision') == expected['source_revision'], 'mod_quality_run_source_mismatch')
        require(run.get('startpoint') == expected['startpoint'], 'mod_quality_run_startpoint_mismatch')
        observations = []
        for line in events_path.read_text().splitlines():
            event = json.loads(line)
            if event.get('event') == 'observation': observations.append(event['observation'])
        retained[side] = observations
        boundary_proofs[side] = bool(observations) and all(matches(observations[0].get('facts', {}),
            {'field': field, 'op': 'eq', 'value': value}) for field, value in expected['startpoint']['boundary'].items())
        inputs[side] = {'report': run['report'], 'events': run['events'], 'run_id': report.get('run_id'),
                        'startpoint': run['startpoint'], 'boundary_observed': boundary_proofs[side],
                        'outcome': report.get('status'), 'reason': report.get('reason')}
    original, candidate = spec['original']['startpoint'], spec['candidate']['startpoint']
    comparable = (spec['comparison']['inputs'] != 'different'
                  and original['boundary'] == candidate['boundary']
                  and all(boundary_proofs.get(side, False) for side in ('original', 'candidate')))
    if spec['comparison']['inputs'] == 'same':
        comparable = comparable and original['kind'] == candidate['kind'] and original['reference']['sha256'] == candidate['reference']['sha256']
    rows = []
    for check in spec['checks']:
        results = {}
        for side, scenario in check['expectations'].items():
            witness = _scenario_witness(scenario, retained.get(side, []), invariant=check['kind'] == 'invariant')
            results[side] = witness or {'status': 'unknown', 'reason': 'run_observations_unavailable'}
        states = [result['status'] for result in results.values()]
        status = 'failed' if 'failed' in states else 'passed' if all(s == 'passed' for s in states) else 'unknown'
        rows.append({'id': check['id'], 'kind': check['kind'], 'status': status, 'results': results})
    status = 'failed' if any(row['status'] == 'failed' for row in rows) else (
        'passed' if comparable and len(retained) == 2 and all(row['status'] == 'passed' for row in rows) else 'unknown')
    return {'schema': VERSION, 'spec_sha256': digest(spec), 'status': status,
        'boundary_comparable': comparable, 'runs': inputs, 'checks': rows,
        'scope': spec.get('scope', 'Declared per-mod scenario checks only'),
        'full_campaign_qualified': False,
        'limitations': ['No conclusion outside declared checkpoints/objectives and retained source observations',
                       'Native checkpoint and ordinary save are distinct startpoint kinds',
                       'Absent reachability witness is unknown, not a proof of unreachable content']}
