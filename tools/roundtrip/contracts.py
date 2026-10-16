"""Fail-closed component dependency and like-for-like admission contracts.

Preserving an unknown range is useful reconstruction, not semantic closure.
Neither JSON declarations nor a matching function signature constitute a proof.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from collections.abc import Mapping

SCHEMA = 'gameverse.rom-roundtrip/1'
STRATA = {'opaque-preserved', 'raw-captured', 'object-captured', 'source-regenerated',
          'ir-regenerated', 'native-relocated', 'data-regenerated'}
BOUNDARIES = ('entrypoints', 'call_targets', 'native_abi', 'state_ownership',
              'address_assumptions', 'asset_mode', 'dispatch', 'scheduling',
              'authority', 'literal_pools', 'compression')


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def _sha(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _artifact(ref, root):
    if not isinstance(ref, Mapping) or not isinstance(ref.get('path'), str) or not _sha(ref.get('sha256')):
        return False
    try:
        path = Path(ref['path'])
        base = Path(root or '.').resolve()
        resolved = (base / path).resolve()
        if path.is_absolute() or '..' in path.parts or '\\' in ref['path'] or not resolved.is_relative_to(base):
            return False
        return hashlib.sha256(resolved.read_bytes()).hexdigest() == ref['sha256']
    except (OSError, ValueError):
        return False


def validate_manifest(manifest, root=None, verify_files=True):
    """Validate ownership/edges/artifacts, allowing declared unknowns.

    Original.path is provenance only; the reassembler/comparator must verify the
    actual original input bytes against original.sha256 before claiming parity.
    """
    errors = []
    if not isinstance(manifest, Mapping):
        return ['manifest must be an object']
    if manifest.get('schema') != SCHEMA:
        errors.append('unsupported manifest schema')
    original = manifest.get('original', {})
    size = original.get('size') if isinstance(original, Mapping) else None
    if not _integer(size) or size <= 0 or not _sha(original.get('sha256')):
        errors.append('original requires positive size and SHA-256')
        size = 0
    components = manifest.get('components')
    if not isinstance(components, list) or not components:
        return errors + ['components must be nonempty']
    index = {}
    intervals = []
    for component in components:
        if not isinstance(component, Mapping):
            errors.append('component must be an object')
            continue
        ident = component.get('id')
        if not isinstance(ident, str) or not ident or ident in index:
            errors.append('component ID must be unique and nonempty')
            continue
        index[ident] = component
        offset, length = component.get('offset'), component.get('size')
        if not _integer(offset) or not _integer(length) or offset < 0 or length <= 0:
            errors.append(f'{ident}: invalid original range')
        else:
            intervals.append((offset, offset + length, ident))
        if not component.get('version') or not _sha(component.get('sha256')):
            errors.append(f'{ident}: immutable version and original SHA-256 required')
        if component.get('stratum') not in STRATA:
            errors.append(f'{ident}: invalid stratum')
        if not isinstance(component.get('contract'), Mapping):
            errors.append(f'{ident}: explicit contract required')
        if not isinstance(component.get('dependencies'), list):
            errors.append(f'{ident}: dependencies must be explicit')
        if component.get('relocations', []) != []:
            errors.append(f'{ident}: relocation application is unsupported')
        artifact = component.get('artifact', {})
        if verify_files and not _artifact(artifact, root):
            errors.append(f'{ident}: artifact missing or stale')
        if component.get('stratum') in ('opaque-preserved', 'raw-captured', 'object-captured'):
            if not isinstance(artifact, Mapping) or artifact.get('sha256') != component.get('sha256'):
                errors.append(f'{ident}: preserved artifact must match original range SHA-256')
            if verify_files and isinstance(artifact, Mapping) and isinstance(artifact.get('path'), str):
                try:
                    if (Path(root or '.') / artifact['path']).stat().st_size != length:
                        errors.append(f'{ident}: preserved artifact length differs from original range')
                except OSError:
                    pass
    frontier = 0
    for start, end, ident in sorted(intervals):
        if start != frontier:
            errors.append(f'{ident}: byte ownership has gap or overlap at {frontier}')
        frontier = end
    if frontier != size:
        errors.append('components must own entire original including header and padding')
    errors.extend(_edge_errors(index))
    prefabs = manifest.get('prefabs', [])
    if not isinstance(prefabs, list):
        errors.append('prefabs must be a list')
        return errors
    prefab_index = {p.get('id'): p for p in prefabs if isinstance(p, Mapping)}
    if len(prefab_index) != len(prefabs) or None in prefab_index or len(set(prefab_index) & set(index)):
        errors.append('prefab IDs must be unique and distinct from components')
    def visit(ident, active):
        if ident in active:
            errors.append(f'{ident}: cyclic prefab containment')
            return
        prefab = prefab_index[ident]
        if not isinstance(prefab.get('dependencies'), list):
            errors.append(f'{ident}: prefab dependencies must be explicit')
        contained = prefab.get('components', [])
        nested = prefab.get('prefabs', [])
        if not isinstance(contained, list) or not isinstance(nested, list) or not (contained or nested):
            errors.append(f'{ident}: prefab must declare contained components/prefabs')
            return
        for child in contained:
            if child not in index:
                errors.append(f'{ident}: dangling contained component {child}')
        for child in nested:
            if child not in prefab_index:
                errors.append(f'{ident}: dangling contained prefab {child}')
            else:
                visit(child, active | {ident})
        errors.extend(_edge_errors({ident: prefab}, targets=index))
    for ident in prefab_index:
        visit(ident, set())
    return errors


def _edge_errors(index, targets=None):
    targets = index if targets is None else targets
    errors = []
    for ident, component in index.items():
        edges = component.get('dependencies', [])
        if not isinstance(edges, list):
            errors.append(f'{ident}: invalid dependency list')
            continue
        for edge in edges:
            if not isinstance(edge, Mapping):
                errors.append(f'{ident}: dependency must be an object')
                continue
            target = targets.get(edge.get('target'))
            if target is None:
                errors.append(f'{ident}: dangling dependency {edge.get("target")}')
            elif edge.get('sha256') != target.get('sha256'):
                errors.append(f'{ident}: dependency pin mismatch {edge.get("target")}')
            elif 'version' in edge and edge['version'] != target.get('version'):
                errors.append(f'{ident}: dependency version mismatch {edge.get("target")}')
            if not edge.get('kind') or edge.get('status') not in ('resolved', 'unknown'):
                errors.append(f'{ident}: dependency kind/status required')
            if edge.get('status') == 'unknown' and not edge.get('reason'):
                errors.append(f'{ident}: unknown dependency needs reason')
    return errors


def dependency_closure(manifest):
    """Report transitive semantic closure; cycles are allowed, dangling pins aren't."""
    index = {c['id']: c for c in manifest.get('components', [])}
    report = {}
    for ident in index:
        seen, pending, gaps = set(), [ident], []
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            component = index.get(current)
            if component is None:
                gaps.append(f'dangling:{current}')
                continue
            if component.get('closure', {}).get('status') != 'closed':
                gaps.append(f'unknown-boundaries:{current}')
            for edge in component.get('dependencies', []):
                target = index.get(edge.get('target'))
                if target is None or edge.get('sha256') != target.get('sha256'):
                    gaps.append(f'unsatisfied-link:{current}:{edge.get("target")}')
                if edge.get('status') != 'resolved':
                    gaps.append(f'unknown-edge:{current}:{edge.get("target")}')
                pending.append(edge.get('target'))
        report[ident] = {'closed': not gaps, 'reachable': sorted(seen, key=str),
                         'unresolved': sorted(set(gaps))}
    return report


def _unknown(value):
    if value is None or (isinstance(value, str) and value in ('unknown', 'unresolved')):
        return True
    if isinstance(value, Mapping):
        return value.get('status') in ('unknown', 'unresolved') or any(_unknown(v) for v in value.values())
    return isinstance(value, list) and any(_unknown(v) for v in value)


def substitution_errors(manifest, component_id, candidate, root=None, proof_verifier=None):
    """Admit exact identity or a verifier-backed, explicitly scoped replacement.

The verifier must validate retained source/native evidence and return True. It is
never replaced by trusting candidate-provided status or matching port names.
"""
    errors = validate_manifest(manifest, root, verify_files=True)
    index = {c['id']: c for c in manifest.get('components', [])}
    original = index.get(component_id)
    if original is None:
        return errors + ['unknown replacement component']
    if not isinstance(candidate, Mapping):
        return errors + ['candidate must be an object']
    for key in ('offset', 'size', 'sha256', 'contract', 'dependencies', 'relocations'):
        if candidate.get(key, [] if key == 'relocations' else None) != original.get(key, [] if key == 'relocations' else None):
            errors.append(f'replacement changes pinned {key}')
    if candidate.get('source_rom_sha256') != manifest['original']['sha256']:
        errors.append('replacement wrong ROM identity')
    if not _artifact(candidate.get('artifact'), root):
        errors.append('replacement artifact missing or stale')
    # Identical retained bytes can preserve unknown semantics at the same address.
    if candidate.get('artifact', {}).get('sha256') == original.get('artifact', {}).get('sha256'):
        return errors
    contract = original.get('contract', {})
    for key in BOUNDARIES:
        if key not in contract or _unknown(contract[key]):
            errors.append(f'semantic substitution has unknown {key}')
    proof = candidate.get('proof', {})
    closure = dependency_closure(manifest).get(component_id, {})
    if not closure.get('closed'):
        errors.extend(_retained_prerequisite_errors(manifest, component_id, proof))
    expected = {'source_rom_sha256': manifest['original']['sha256'], 'component_id': component_id,
                'original_artifact_sha256': original.get('artifact', {}).get('sha256'),
                'candidate_artifact_sha256': candidate.get('artifact', {}).get('sha256'),
                'contract_sha256': canonical_hash(contract)}
    if not isinstance(proof, Mapping) or any(proof.get(k) != v for k, v in expected.items()):
        errors.append('substitution proof does not bind exact ROM, component, artifacts and contract')
    if not isinstance(proof, Mapping) or not proof.get('scope'):
        errors.append('substitution proof requires explicit scope')
    if proof_verifier is None:
        errors.append('retained source/native proof verifier required')
    elif not errors:
        try:
            if proof_verifier(proof, original, candidate, root) is not True:
                errors.append('source/native proof rejected')
        except Exception as exc:
            errors.append(f'source/native proof verifier failed: {type(exc).__name__}')
    return errors


def _retained_prerequisite_errors(manifest, component_id, proof):
    """Bounded native substitutions may rely on unchanged, pinned opaque hosts.

    This never changes dependency_closure or certifies portable interchangeability.
    The native verifier must check no output changes/relocations in these spans.
    """
    index = {c['id']: c for c in manifest.get('components', [])}
    component = index[component_id]
    errors = []
    if component.get('closure', {}).get('status') != 'closed':
        errors.append('replacement local boundaries are not closed')
    closure = dependency_closure(manifest)[component_id]
    for ident in closure['reachable']:
        current = index.get(ident)
        if current is None:
            errors.append('retained prerequisite has dangling target')
            continue
        if any(e.get('status') != 'resolved' for e in current.get('dependencies', [])):
            errors.append('retained prerequisite requires resolved pinned dependency edges')
    scope = proof.get('scope', {}) if isinstance(proof, Mapping) else {}
    if not isinstance(scope, Mapping) or scope.get('mode') != 'bounded-retained-host':
        return errors + ['semantic substitution has unsatisfied dependency closure']
    prerequisites = scope.get('unchanged_prerequisites', [])
    if not isinstance(prerequisites, list):
        return errors + ['unchanged prerequisites must be an explicit list']
    by_id = {p.get('target'): p for p in prerequisites if isinstance(p, Mapping)}
    if len(by_id) != len(prerequisites):
        errors.append('duplicate or invalid retained prerequisite')
    for ident in closure['reachable']:
        target = index.get(ident)
        if ident == component_id or target is None or target.get('closure', {}).get('status') == 'closed':
            continue
        declaration = by_id.get(ident, {})
        expected = {key: target.get(key) for key in ('version', 'offset', 'size', 'sha256')}
        expected.update(artifact_sha256=target.get('artifact', {}).get('sha256'),
                        no_output_changes=True, relocations=[])
        if any(declaration.get(key) != value for key, value in expected.items()):
            errors.append(f'unknown prerequisite not pinned unchanged: {ident}')
        if target.get('stratum') not in ('opaque-preserved', 'raw-captured', 'object-captured'):
            errors.append(f'unknown prerequisite lacks preserved byte provider: {ident}')
    if not prerequisites:
        errors.append('bounded retained host needs explicit unchanged prerequisites')
    return errors
