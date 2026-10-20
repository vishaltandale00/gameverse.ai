"""Pinned semantic behavior declarations and conservative adapter preflight.

Declarations describe bounded systems. Source evidence is checked locally;
checking its hash does not prove the producer's semantic interpretation.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .core import canonical_hash

SCHEMA = 'gameverse.behavior-system/1'
FACETS = ('lifecycle', 'inputs', 'state', 'side_effects', 'phase',
          'preconditions', 'postconditions', 'asset_notifications',
          'services', 'dependencies')
MAPPING_KINDS = ('input', 'enum', 'unit', 'storage', 'event', 'persistence',
                 'transition', 'reset', 'callback', 'return-code', 'notification')


def _evidence_errors(record, root):
    errors = []
    if not isinstance(record, dict):
        return ['evidence must be an object']
    path, sha = record.get('path'), record.get('sha256')
    if not isinstance(path, str) or not path or not isinstance(sha, str) or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha):
        return ['evidence requires path and sha256']
    base = Path(root).resolve()
    source = (base / path).resolve()
    if not source.is_relative_to(base):
        return ['evidence path escapes root']
    try:
        raw = source.read_bytes()
    except OSError:
        return ['evidence file unavailable: ' + str(path)]
    if hashlib.sha256(raw).hexdigest() != sha:
        errors.append('stale evidence: ' + str(path))
    start, end = record.get('start_line'), record.get('end_line')
    if start is not None or end is not None:
        if (type(start) is not int or type(end) is not int or
                start < 1 or end < start or end > len(raw.splitlines())):
            errors.append('invalid evidence line range: ' + str(path))
    return errors


def inspect_behavior(node, root):
    """Verify pins and report missing semantic facets; never infer closure."""
    behavior = node.get('contract', {}).get('behavior', {})
    errors, missing, resolved = [], [], []
    if node.get('kind') != 'behavior-system' or behavior.get('schema') != SCHEMA:
        errors.append('not a versioned behavior-system node')
    if not behavior.get('semantic'):
        missing.append('semantic')
    for facet in FACETS:
        entries = behavior.get(facet)
        if not isinstance(entries, list) or not entries:
            missing.append(facet)
            continue
        identities = set()
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict) or not entry.get('id'):
                errors.append(f'{facet}[{index}] requires an id')
                continue
            if entry['id'] in identities:
                errors.append(f'{facet}: duplicate record id')
            identities.add(entry['id'])
            evidence = entry.get('evidence', [])
            if not evidence:
                missing.append(f'{facet}:{entry["id"]}:evidence')
            if not isinstance(evidence, list):
                errors.append(f'{facet}: evidence must be an array')
                evidence = []
            for pin in evidence:
                errors.extend(_evidence_errors(pin, root))
            if evidence and entry.get('status') != 'unknown' and not any(
                    _evidence_errors(pin, root) for pin in evidence):
                resolved.append({'facet': facet, 'id': entry['id'],
                                 'status': 'source-pinned-declaration',
                                 'evidence': copy.deepcopy(evidence)})
            if entry.get('status') == 'unknown':
                missing.append(f'{facet}:{entry["id"]}')
    pins = node.get('provenance', {}).get('source_pins', [])
    if not pins:
        missing.append('source_pins')
    for pin in pins:
        errors.extend(_evidence_errors(pin, root))
    missing.extend(str(item) for item in behavior.get('unknowns', []))
    return {'node': node.get('id'), 'node_sha256': canonical_hash(node),
            'contradictions': sorted(set(errors)),
            'missing_contracts': sorted(set(missing)),
            'resolved_contracts': resolved,
            'source_pins_verified': bool(pins) and not errors,
            'semantic_interpretation_machine_proved': False}


def resolve_behavior(host, donor, mappings, root, request_id, adapter_recipe=None):
    """Emit a pinned adapter request; caller flags cannot discharge obligations.

    Each mapping identifies exact host/donor facet records and captures evidence.
    Native qualification remains a separate consumer gate even with complete
    source declarations. Empty facets require an explicit evidenced 'none' record.
    """
    inspected = [inspect_behavior(node, root) for node in (host, donor)]
    missing = [f'{result["node"]}:{gap}' for result in inspected
               for gap in result['missing_contracts']]
    errors = [error for result in inspected for error in result['contradictions']]
    resolved = []
    mapping_ids = set()
    for mapping in mappings:
        identity = mapping.get('id')
        if not isinstance(identity, str) or not identity or identity in mapping_ids:
            errors.append('mapping requires unique nonempty id')
        mapping_ids.add(identity)
        if mapping.get('kind') not in MAPPING_KINDS:
            errors.append('unsupported mapping kind: ' + str(mapping.get('kind')))
            continue
        for side, node in (('host', host), ('donor', donor)):
            reference = mapping.get(side, {})
            facet, identity = reference.get('facet'), reference.get('id')
            entries = node.get('contract', {}).get('behavior', {}).get(facet, [])
            if facet not in FACETS or not any(e.get('id') == identity for e in entries):
                errors.append(f'mapping {mapping.get("id")}: {side} record unavailable')
        evidence = mapping.get('evidence', [])
        if not evidence:
            missing.append('mapping:' + str(mapping.get('id')) + ':evidence')
        for pin in evidence:
            errors.extend(_evidence_errors(pin, root))
        resolved.append(copy.deepcopy(mapping))
    if not mappings:
        missing.append('semantic mappings absent')
    recipe_content = None
    if adapter_recipe is None:
        missing.append('adapter_recipe')
    else:
        recipe_errors = _evidence_errors(adapter_recipe, root)
        errors.extend(recipe_errors)
        if not recipe_errors:
            try:
                recipe_content = json.loads((Path(root) / adapter_recipe['path']).read_text())
            except (ValueError, OSError):
                errors.append('adapter_recipe is not valid JSON')
            if not isinstance(recipe_content, dict):
                errors.append('adapter_recipe must be an object')
                recipe_content = None
        if recipe_content is not None:
            if recipe_content.get('schema') != 'gameverse.behavior-adapter-recipe/1':
                errors.append('adapter_recipe schema unsupported')
            for key in ('modules', 'state_lifecycle', 'phase', 'source_evidence'):
                if not recipe_content.get(key):
                    missing.append('adapter_recipe:' + key)
            for key in ('ownership', 'lifetime', 'reset', 'reentry', 'restore', 'save_effects'):
                if key not in recipe_content.get('state_lifecycle', {}):
                    missing.append('adapter_recipe:state_lifecycle:' + key)
            for pin in recipe_content.get('source_evidence', []):
                errors.extend(_evidence_errors(pin, root))
    requirements = [
        {'id': 'native-consumer', 'status': 'required',
         'detail': 'Execute generated adapter in each pinned actual native consumer.'},
        {'id': 'boundary-services', 'status': 'required',
         'detail': 'Retain or explicitly lower each declared native service boundary.'},
        {'id': 'lifecycle-proof', 'status': 'required',
         'detail': 'Exercise first transition, repeat veto, reset, persistence and notification paths.'},
    ]
    return {'schema': 'gameverse.behavior-adapter-request/1', 'request_id': request_id,
            'host': copy.deepcopy(host), 'donor': copy.deepcopy(donor),
            'host_sha256': canonical_hash(host), 'donor_sha256': canonical_hash(donor),
            'classification': 'incompatible' if errors else 'unknown',
            'declaration_status': 'incomplete' if missing or errors else 'source-pinned',
            'classification_scope': 'source-declaration-preflight',
            'semantic_mapping_validation': 'native-backend-required',
            'missing_contracts': sorted(set(missing)), 'contradictions': sorted(set(errors)),
            'resolved_evidence': inspected, 'mappings': resolved,
            'adapter_recipe': copy.deepcopy(adapter_recipe),
            'adapter_recipe_sha256': canonical_hash(recipe_content) if recipe_content is not None else None,
            'adapter_requirements': requirements + [{'id': 'typed-mapping-lowering',
                'status': 'required', 'detail': 'Backend must validate typed mapping operations, interfaces and actual generated IR.'}],
            'executable': False,
            'native_play_verified': False, 'whole_game_closure': False,
            'eligibility_scope': 'bounded-declared-behavior-system-only'}


def attach_native_feedback(request, receipt, root):
    """Join a pinned backend receipt without upgrading static/global readiness."""
    result = copy.deepcopy(request)
    errors = _evidence_errors(receipt, root)
    claims = None
    if not errors:
        try:
            claims = json.loads((Path(root) / receipt['path']).read_text())
        except (ValueError, OSError):
            errors.append('native feedback receipt is not JSON')
    if isinstance(claims, dict):
        for key, expected in (('request_sha256', canonical_hash(request)),
                              ('host_sha256', request['host_sha256']),
                              ('donor_sha256', request['donor_sha256'])):
            if key in claims and claims[key] != expected:
                errors.append('native feedback ' + key + ' disagrees with request')
    result['native_feedback'] = {'receipt': copy.deepcopy(receipt),
                                 'contradictions': errors,
                                 'receipt_pin_verified': not errors,
                                 'backend_claims': claims,
                                 'scope': 'receipt-content-only-until-native-proof-admission'}
    result['feedback_nodes'] = []
    for side in ('host', 'donor'):
        node = copy.deepcopy(request[side])
        node['proof_feedback'] = {'request_sha256': canonical_hash(request),
                                  'node_sha256': request[side + '_sha256'],
                                  'receipt': copy.deepcopy(receipt),
                                  'receipt_pin_verified': not errors,
                                  'scope': 'bounded-declared-behavior-system-only',
                                  'native_eligibility': 'requires-native-proof-admission',
                                  'whole_game_closure_changed': False}
        result['feedback_nodes'].append(node)
    # No flags from a receipt are trusted as a proof or a closure override.
    result['native_play_verified'] = False
    return result


def normalize_behavior(node):
    """Normalize producer syntax without inventing semantic or source evidence.

    String-only dependencies remain explicitly unknown. Their names are useful
    boundaries, but they cannot acquire evidence from neighboring declarations.
    """
    result = copy.deepcopy(node)
    behavior = result.get('contract', {}).get('behavior', {})
    for facet in FACETS:
        entries = []
        for index, original in enumerate(behavior.get(facet, [])):
            entry = copy.deepcopy(original) if isinstance(original, dict) else {
                'description': str(original), 'status': 'unknown', 'evidence': []}
            entry.setdefault('id', entry.get('name') or f'{facet}:{index + 1:02d}')
            if isinstance(entry.get('evidence'), dict):
                entry['evidence'] = [entry['evidence']]
            entries.append(entry)
        behavior[facet] = entries
    return result



def place_behavior_overlay(game, partition, node):
    """Join semantic overlay to canonical owners by pinned source/entry witnesses.

    This creates references only, never a second byte owner or a closed cluster.
    Entry-only edges prove placement of the entry, not all reachable behavior.
    """
    from .core import validate_game
    result = copy.deepcopy(game)
    validate_game(result, partition)
    provenance = node.get('provenance', {})
    rom_sha = provenance.get('rom_sha256') or provenance.get('rom', {}).get('sha256')
    if rom_sha != game['rom']['sha256']:
        raise ValueError('behavior node ROM pin disagrees with ownership tree')
    overlay = copy.deepcopy(node)
    overlay['parent'] = 'game'
    if any(existing['id'] == overlay['id'] for existing in result['nodes']):
        raise ValueError('behavior overlay id already exists')
    sources = {pin['sha256'] for pin in provenance.get('source_pins', [])}
    entries = []
    for entry in provenance.get('native_entries', {}).values():
        if isinstance(entry.get('address'), int):
            entries.append(entry['address'])
    for record in node.get('contract', {}).get('behavior', {}).get('lifecycle', []):
        if record.get('entry'):
            entries.append(int(record['entry'], 16))
    owners = {}
    for component in partition['components']:
        reasons = []
        if component.get('contract', {}).get('source_sha256') in sources:
            reasons.append('exact-source-file-pin')
        if any(component['offset'] <= address - 0x08000000 < component['offset'] + component['size']
               for address in entries):
            reasons.append('captured-native-entry-placement')
        if reasons:
            owners[component['id']] = reasons
    if not owners:
        raise ValueError('behavior overlay has no pinned canonical owner witness')
    overlay['placement'] = {'scope': 'source-and-entry-witnesses-only',
                            'reachable_behavior_closure': False,
                            'canonical_owner_count': len(owners)}
    result['nodes'].append(overlay)
    result['edges'].extend({'source': overlay['id'], 'target': 'component:' + identity,
                            'kind': 'stored-in', 'evidence': reasons}
                           for identity, reasons in sorted(owners.items()))
    validate_game(result, partition)
    return result

def main(argv=None):
    """Run local bounded preflight, retaining unknown/rejected request receipts."""
    import argparse
    import platform
    import subprocess
    import time
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--host', required=True)
    parser.add_argument('--donor', required=True)
    parser.add_argument('--mappings', required=True)
    parser.add_argument('--recipe')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--request-id', required=True)
    args = parser.parse_args(argv)
    started = time.perf_counter()
    inputs = {}
    parsed = []
    baseline = time.perf_counter()
    for path in (args.host, args.donor, args.mappings):
        raw = (args.root / path).read_bytes()
        inputs[path] = hashlib.sha256(raw).hexdigest()
        parsed.append(json.loads(raw))
    baseline_seconds = time.perf_counter() - baseline
    recipe = None
    if args.recipe:
        raw = (args.root / args.recipe).read_bytes()
        recipe = {'path': args.recipe, 'sha256': hashlib.sha256(raw).hexdigest()}
        inputs[args.recipe] = recipe['sha256']
    analysis_started = time.perf_counter()
    result = resolve_behavior(*parsed, args.root, args.request_id, recipe)
    analysis_seconds = time.perf_counter() - analysis_started
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=args.root,
                            capture_output=True, text=True, check=False)
    receipt = {'schema': 'gameverse.behavior-static-receipt/1',
               'request_id': args.request_id, 'outcome': result['classification'],
               'request_sha256': canonical_hash(result), 'source_commit': commit.stdout.strip() or None,
               'inputs': inputs, 'tool': {'path': str(Path(__file__).resolve()),
                    'sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
               'environment': {'python': platform.python_version(), 'platform': platform.platform()},
               'timing': {'parse_baseline_seconds': baseline_seconds,
                    'resolution_seconds': analysis_seconds, 'total_seconds': time.perf_counter() - started,
                    'queue_seconds': None, 'build_seconds': None, 'simulation_seconds': None,
                    'evaluation_seconds': None, 'ci_seconds': None,
                    'stage_relationship': 'parse and resolution disjoint; total includes both plus receipt setup',
                    'comparison': 'single local parse baseline vs additional evidence validation; not a build comparison',
                    'attempt_count': 1, 'repair_count': 0}}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'request.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'classification': result['classification'],
                      'missing_contracts': len(result['missing_contracts']),
                      'contradictions': len(result['contradictions']), 'timing': receipt['timing']}))
    return 2 if result['contradictions'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
