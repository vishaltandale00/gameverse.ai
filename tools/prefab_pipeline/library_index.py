"""Read the publisher's capability grouping index, never a readiness catalog."""
from __future__ import annotations

import re

INDEX = "ontology/ir-capability-groups/index.json"
INDEX_SCHEMA = "gameverse.ir-capability-library/1"
RECORD_SCHEMA = "gameverse.ir-library-capability-proposal/1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def pinned_refs(value):
    if isinstance(value, dict):
        if 'path' in value and 'sha256' in value:
            yield value
        for item in value.values():
            yield from pinned_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from pinned_refs(item)


def load_groups(reader, game_id):
    """Return verified group records; preserve invalid index rows as gap records.

    Reader enforces the same file/byte/containment budget as package extraction.
    Absence is optional and pinned, so publication later invalidates cached data.
    All record evidence pins are checked; their semantic claims remain scoped
    declarations rather than permission to promote a runtime or whole game.
    """
    index, _ = reader.read(INDEX, optional=True)
    if index is None:
        return [], []
    if not isinstance(index, dict) or index.get('schema') != INDEX_SCHEMA or not isinstance(index.get('entries'), list):
        return [], ['Unsupported capability library index schema: ' + INDEX]
    groups, gaps, seen = [], [], set()
    for row in index['entries']:
        if not isinstance(row, dict) or row.get('game_id') != game_id:
            continue
        identity = row.get('id')
        if not isinstance(identity, str) or not identity or identity in seen:
            gaps.append('Invalid or duplicate capability library identity: ' + str(identity))
            continue
        seen.add(identity)
        ref = row.get('record', {})
        record, path = reader.read(ref.get('path')) if isinstance(ref, dict) else (None, None)
        if not isinstance(record, dict) or not record or not SHA256.fullmatch(str(ref.get('sha256', ''))) or reader.pins.get(path) != ref['sha256']:
            gaps.append('Missing or stale capability library record: ' + identity)
            continue
        if (record.get('schema') != RECORD_SCHEMA
                or any(record.get(k) != row.get(k) for k in ('id', 'game_id', 'module_id'))
                or not isinstance(record.get('module_id'), str) or not record['module_id']
                or not isinstance(record.get('package_ids'), list)
                or any(not isinstance(p, str) or not p for p in record['package_ids'])):
            gaps.append('Capability library record identity/schema mismatch: ' + identity)
            continue
        errors, refs = [], []
        for evidence in pinned_refs(record):
            _, evidence_path = reader.read(evidence.get('path'))
            expected = evidence.get('sha256')
            if not SHA256.fullmatch(str(expected)) or not evidence_path or reader.pins.get(evidence_path) != expected:
                errors.append('Missing or stale capability evidence: ' + str(evidence.get('path')))
            elif evidence_path not in {r['path'] for r in refs}:
                refs.append({'path': evidence_path, 'sha256': expected})
        groups.append({'record': record, 'ref': {'path': path, 'sha256': ref['sha256']},
                       'evidence_refs': refs, 'integrity_valid': not errors,
                       'gaps': sorted(set(errors))})
    return groups, gaps


def registered_descriptors(reader, game_id):
    """Include source-only deliveries that have no row in the ready allowlist."""
    path = 'ontology/game-system-prefabs/deliveries.json'
    registry, _ = reader.read(path, optional=True)
    if registry is None:
        return [], []
    if (not isinstance(registry, dict)
            or registry.get('schema') != 'gameverse.game-prefab-deliveries/1'
            or not isinstance(registry.get('deliveries'), list)):
        return [], ['Unsupported registered delivery index: ' + path]
    refs, gaps = [], []
    for row in registry['deliveries']:
        if not isinstance(row, dict):
            gaps.append('Invalid registered delivery row')
            continue
        descriptor, ref = reader.read(row.get('ref'))
        if not descriptor or not SHA256.fullmatch(str(row.get('sha256', ''))) or reader.pins.get(ref) != row['sha256']:
            gaps.append('Missing or stale registered delivery: ' + str(row.get('ref')))
            continue
        if isinstance(descriptor, dict) and descriptor.get('gameId') == game_id:
            refs.append(ref)
    return sorted(set(refs)), gaps
