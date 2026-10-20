"""Source-linked feedback from matched native traces; never whole-game parity.

A trace is an immutable JSON receipt, not an adapter or fabricated observation.
The caller obtains both traces from actual isolated native sessions. This module
checks pinned evidence and matched setup/input provenance before comparing facts.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

SCHEMA = 'gameverse.reconstruction-trace/1'


def pin(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def checked(ref, root):
    if not isinstance(ref, dict) or not {'path', 'sha256'} <= set(ref):
        raise ValueError('invalid_evidence_pin')
    path = Path(ref['path'])
    path = path if path.is_absolute() else Path(root) / path
    if hashlib.sha256(path.read_bytes()).hexdigest() != ref['sha256']:
        raise ValueError('evidence_pin_mismatch')
    return path


def validate(trace, root):
    if trace.get('schema') != SCHEMA:
        raise ValueError('invalid_trace_schema')
    for key in ('run_id', 'game_id', 'source_commit', 'loop_version', 'adapter_version', 'environment_version'):
        if not isinstance(trace.get(key), str) or not trace[key]:
            raise ValueError('missing_trace_identity:' + key)
    for key in ('artifact', 'checkpoint', 'observation_profile', 'action_profile', 'raw_events', 'raw_diff', 'closure'):
        checked(trace[key], root)
    setup = trace['setup']
    if setup.get('kind') not in ('natural_checkpoint', 'source_controlled_fixture'):
        raise ValueError('invalid_setup_kind')
    checked(setup['provenance'], root)
    if not setup.get('boundary') or not isinstance(setup.get('render_integration_frames'), int) or setup['render_integration_frames'] < 0:
        raise ValueError('invalid_setup_boundary')
    # A recipe pins semantic initialization; snapshots remain artifact-specific.
    for key in ('recipe', 'inputs'):
        checked(trace[key], root)
    observations = trace['observations']
    if not observations or any(type(row.get('frame')) is not int or row['frame'] < 0 or not isinstance(row.get('facts'), dict) for row in observations):
        raise ValueError('invalid_trace_observations')
    if [row['frame'] for row in observations] != sorted(set(row['frame'] for row in observations)):
        raise ValueError('nonmonotonic_trace_frames')
    return trace


def compare(original, candidate, scope, *, root='.'):
    """Return bounded observations + source-linked mining requests, no auto repair.

    Scope maps each observable to component IDs, dependency kinds and source
    references. Missing observations are coverage gaps, not equal null values.
    """
    original, candidate, scope = copy.deepcopy((original, candidate, scope))
    validate(original, root); validate(candidate, root)
    for key in ('game_id', 'adapter_version', 'environment_version', 'loop_version',
                'recipe', 'inputs', 'observation_profile', 'action_profile', 'setup'):
        if original[key] != candidate[key]:
            raise ValueError('unmatched_trace_provenance:' + key)
    if [r['frame'] for r in original['observations']] != [r['frame'] for r in candidate['observations']]:
        raise ValueError('unmatched_observation_schedule')
    if not scope or not isinstance(scope, dict):
        raise ValueError('empty_observation_scope')
    for name, owner in scope.items():
        if not owner.get('components') or not owner.get('dependency_kinds') or not owner.get('source_refs'):
            raise ValueError('unlinked_observable:' + name)
        for ref in owner['source_refs']:
            checked(ref, root)
    gaps = []
    compared = 0
    for before, after in zip(original['observations'], candidate['observations']):
        for name, owner in scope.items():
            missing = [label for label, row in (('original', before), ('candidate', after)) if name not in row['facts']]
            different = not missing and before['facts'][name] != after['facts'][name]
            if not missing:
                compared += 1
            if missing or different:
                gaps.append({'frame': before['frame'], 'observable': name,
                    'kind': 'observation_coverage_gap' if missing else 'observed_divergence',
                    'missing_in': missing,
                    'original': before['facts'].get(name), 'candidate': after['facts'].get(name),
                    'source_link': owner, 'status': 'needs_source_owner_diagnosis',
                    'interpretation': 'No cause, prerequisite or semantic parity inferred from this difference.'})
    return {'schema': 'gameverse.reconstruction-gap-feedback/1',
        'outcome': 'bounded_observations_match' if not gaps else 'source_review_required',
        'original_run': original['run_id'], 'candidate_run': candidate['run_id'],
        'original': original, 'candidate': candidate, 'scope': scope,
        'compared_fact_samples': compared, 'gaps': gaps,
        'unresolved_coverage': ['Unobserved frames, paths, fields and scheduler contexts remain unqualified.',
            'Model interpretations remain hypotheses; divergence requires source-backed diagnosis.',
            'A controlled fixture does not establish natural reachability.'],
        'whole_game_parity': False,
        'evidence_kind': 'observed-only',
        'claim_scope': 'Bounded observable comparison only; no dependency closure or cause inference.'}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--original', type=Path, required=True)
    ap.add_argument('--candidate', type=Path, required=True)
    ap.add_argument('--scope', type=Path, required=True)
    ap.add_argument('--root', type=Path, default=Path('.'))
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    if args.output.exists():
        raise ValueError('output_exists')
    report = compare(*(json.loads(p.read_text()) for p in (args.original, args.candidate, args.scope)), root=args.root)
    report['trace_receipts'] = {'original': pin(args.original), 'candidate': pin(args.candidate), 'scope': pin(args.scope)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
