"""Small QC adapter over existing artifact, comparison and closure validators.

There is deliberately no overall 'game works' verdict. A producer verifier is
trusted owner code, not a boolean read from an uploaded receipt. It must inspect
the actual compiler/lowerer inputs, outputs and retained receipt for a component.
"""
from __future__ import annotations

import platform
import time
from pathlib import Path

from .contracts import dependency_closure, validate_manifest
from .reassemble import local_artifact, sha
from ..prefab_pipeline.reconstruction_compare import compare_reconstruction

SCHEMA = 'gameverse.reconstruction-qc/1'
REGENERATED = {'source-regenerated', 'ir-regenerated', 'data-regenerated', 'native-relocated'}


def reconstruction_qc(original, rebuilt, manifest, layout, root, *,
                      producer_verifier=None, evidence_verifier=None,
                      certificates=None, policy_masks=None):
    """Check one bounded artifact packet without compiling or playing again.

    ``producer_verifier(component, root)`` returns exactly True only after owner
    verification of real generation provenance. Missing/rejected verification
    retains the declaration but gives it zero verified regeneration credit.
    ``evidence_verifier`` has the existing comparator's (kind, record) contract.
    For appended output rows it may instead return ``verified: True`` plus
    integer ``behavior_bytes``, ``binding_bytes``, ``alignment_bytes`` and optional
    ``asset_bytes`` (default zero) whose sum is the row size. These owner-verified
    counts keep bindings and immutable assets out of the
    actual lifted behavior total. Source and output coverage stay separate.
    Inputs and report must be retained together by the caller; caller-supplied
    JSON is never treated as a proof verifier.
    """
    began = time.perf_counter()
    if not isinstance(manifest, dict) or not isinstance(manifest.get('components'), list):
        raise ValueError('QC requires a manifest object with a component list')
    if max(len(original), len(rebuilt)) > 32 * 1024 * 1024:
        raise ValueError('QC supports cartridge images up to 32 MiB')
    if len(manifest.get('components', [])) > 4096:
        raise ValueError('QC supports up to 4096 components')
    errors = validate_manifest(manifest, root=Path(root), verify_files=True)
    for row in (layout or {}).get('components', []):
        if 'artifact' not in row:
            if row.get('role') == 'generated-output':
                errors.append(f"{row.get('id')}: generated output artifact reference missing")
            continue
        try:
            data = local_artifact(Path(root), row['artifact']).read_bytes()
            if len(data) != row['size'] or sha(data) != row['sha256'] or sha(data) != row['artifact']['sha256']:
                errors.append(f"{row.get('id')}: output artifact missing or stale")
        except (KeyError, OSError, ValueError, TypeError):
            errors.append(f"{row.get('id')}: output artifact missing, stale or escaping")
    comparison = compare_reconstruction(original, rebuilt, manifest, layout,
        policy_masks, certificates, evidence_verifier=evidence_verifier)
    valid = not errors and comparison['validation']['valid']
    components = manifest.get('components', [])
    declarations, verified, unverified = [], [], []
    declared_ir = verified_ir = 0
    # Invalid packet layouts/pins must never accumulate verified coverage.
    for component in components:
        if component.get('stratum') not in REGENERATED:
            continue
        ident = component['id']
        declarations.append(ident)
        is_ir = component['stratum'] == 'ir-regenerated'
        if is_ir:
            declared_ir += component['size']
        accepted, reason = False, 'owner producer verifier unavailable'
        if valid and producer_verifier is not None:
            try:
                accepted = producer_verifier(component, Path(root)) is True
                reason = 'owner producer verifier rejected evidence'
            except Exception as exc:
                reason = 'producer verifier failed: ' + type(exc).__name__
        elif not valid:
            reason = 'packet integrity or comparison validation failed'
        if accepted:
            verified.append(ident)
            if is_ir:
                verified_ir += component['size']
        else:
            unverified.append({'component': ident, 'reason': reason})
    output_declared = output_verified = output_behavior = 0
    output_details = []
    for row in (layout or {}).get('components', []):
        if row.get('role') != 'generated-output' or row.get('stratum') != 'ir-regenerated':
            continue
        output_declared += row['size']
        checked = False
        if valid and producer_verifier is not None:
            try:
                checked = producer_verifier(row, Path(root))
            except Exception:
                checked = False
        accounting = None
        if isinstance(checked, dict) and checked.get('verified') is True:
            keys = ('behavior_bytes', 'binding_bytes', 'alignment_bytes', 'asset_bytes')
            counts = {k: checked.get(k, 0 if k == 'asset_bytes' else None) for k in keys}
            if all(type(counts[k]) is int and counts[k] >= 0 for k in keys) and sum(counts.values()) == row['size']:
                accounting = counts
                output_behavior += checked['behavior_bytes']
        accepted = checked is True or accounting is not None
        if accepted:
            output_verified += row['size']
        output_details.append({'component': row['id'], 'verified': accepted, 'accounting': accounting})
    closure = dependency_closure(manifest) if valid else {}
    evidence = comparison['semantic_evidence']['certificates']
    report = {
        'schema': SCHEMA,
        'context': comparison['context'],
        'dimensions': {
            'artifact_integrity': {'status': 'passed' if valid else 'failed',
                'errors': errors + comparison['validation']['errors']},
            'byte_parity': {'raw_exact': comparison['raw']['exact'],
                'different_bytes': comparison['raw']['different_bytes'],
                'comparison_valid': comparison['validation']['valid'],
                'raw_original_sha256': comparison['raw']['original_sha256'],
                'raw_rebuilt_sha256': comparison['raw']['rebuilt_sha256']},
            'source_provenance': {'declared_components': declarations,
                'verified_components': verified, 'unverified_components': unverified},
            'actual_ir_coverage': {'declared_bytes': declared_ir,
                'verified_bytes': verified_ir, 'source_bytes': len(original),
                'output_declared_bytes': output_declared, 'output_verified_bytes': output_verified,
                'output_verified_behavior_bytes': output_behavior,
                'generated_output': output_details,
                'scope': 'source-span generation and appended output are separate; output may include bindings; no whole-game semantic claim'},
            'dependency_closure': {'valid_pins': valid,
                'scope': 'pinned graph and declared boundaries; not an independent semantic proof',
                'closed_components': [k for k, v in closure.items() if v['closed']],
                'unknown_components': [k for k, v in closure.items() if not v['closed']],
                'components': closure},
            'scoped_native_equivalence': {
                'admitted_certificates': [v for v in evidence if v['admitted']],
                'unadmitted_certificates': [v for v in evidence if not v['admitted']]},
        },
        'whole_game_equivalent': None,
        'comparison': comparison,
        'timing': {'total_wall_s': time.perf_counter() - began,
            'comparison_wall_s': comparison['timing']['comparison_wall_s'],
            'comparison_nested_in_total': True, 'queue_s': None,
            'build_s': None, 'simulation_s': None,
            'machine': platform.platform(), 'python': platform.python_version()},
    }
    return report
