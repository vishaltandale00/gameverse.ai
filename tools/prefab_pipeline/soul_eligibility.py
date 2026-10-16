"""Pinned finite Aria native soul eligibility certificate.

The source review is a bounded admission decision, not a general enemy classifier.
ROM call/pointer paths are checked without executing a campaign or installing tools.
"""
from pathlib import Path
import hashlib
import json
import struct

BASE = Path('research/deep-extraction/castlevania/soul-eligibility')
ROM_SHA256 = '910f88d3701e6c9f99c0d63660c14c61d8b79b0c17bfd7b35a15185be36430a5'
# Set by the source audit; modifying evidence requires a new reviewed certificate.
EVIDENCE_SHA256 = '75378e40c0fbc50f84ff997ccf17a9d54a98a1d4885ea7ea155f367c06269d37'


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _targets(raw, start):
    """Thumb-1 BL targets and aligned native callback literals in one function."""
    targets = set()
    for off in range(0, len(raw) - 3, 2):
        hi, lo = struct.unpack_from('<HH', raw, off)
        if hi & 0xf800 == 0xf000 and lo & 0xf800 == 0xf800:
            delta = ((hi & 0x7ff) << 12) | ((lo & 0x7ff) << 1)
            if delta & 0x400000:
                delta -= 0x800000
            targets.add(start + off + 4 + delta)
        if (start + off) % 4 == 0:
            pointer = struct.unpack_from('<I', raw, off)[0]
            if pointer & 1:
                targets.add(pointer & ~1)
    return targets


def verify_eligibility(root, rom=None):
    """Return the pinned source-reviewed finite certificate, failing closed.

    root: repository root. rom: exact cartridge bytes or path (defaults to local ROM).
    No source table extent, creature name, nonzero rarity, or successful gameplay
    witness alone can expand the ordinary species set.
    """
    root = Path(root)
    evidence_bytes = (root / BASE / 'source-evidence.json').read_bytes()
    if _sha(evidence_bytes) != EVIDENCE_SHA256:
        raise ValueError('soul eligibility source evidence changed without review')
    evidence = json.loads(evidence_bytes)
    if rom is None:
        rom = root / 'local/roms/Castlevania - Aria of Sorrow (USA).gba'
    data = bytes(rom) if isinstance(rom, (bytes, bytearray)) else Path(rom).read_bytes()
    if _sha(data) != ROM_SHA256:
        raise ValueError('soul eligibility requires pinned original USA ROM')
    functions = {f['name']: f for f in evidence['functions']}
    native_targets = {}
    for name, f in functions.items():
        raw = data[f['address'] - 0x08000000:f['end'] - 0x08000000]
        if _sha(raw) != f['rom_range_sha256'] or _sha(f['assembly'].encode()) != f['assembly_sha256']:
            raise ValueError('source/native eligibility function pin mismatch')
        native_targets[name] = _targets(raw, f['address'])
    rows = evidence['rows']
    if [r['species'] for r in rows] != list(range(11)):
        raise ValueError('finite reviewed species set changed')
    for row in rows:
        offset = 0xe9644 + 36 * row['species']
        record = data[offset:offset + 36]
        if _sha(record) != row['record_sha256']:
            raise ValueError('eligibility descriptor mismatch')
        if struct.unpack_from('<II', record) != (int(row['init'], 16), int(row['update'], 16)):
            raise ValueError('eligibility callback mismatch')
        k, i = record[23:25]
        if not record[18] or not 0 <= k < 4 or not 1 <= i <= (56, 26, 36, 8)[k]:
            raise ValueError('soul descriptor unavailable or outside inventory capacity')
        path = row['source_reward_path']
        if functions[path[0]]['address'] | 1 not in (int(row['init'], 16), int(row['update'], 16)):
            raise ValueError('reward path does not start at native descriptor callback')
        for caller, callee in zip(path, path[1:]):
            if functions[callee]['address'] not in native_targets[caller]:
                raise ValueError('source reward path edge absent from original native ROM')
        if 0x080683bc not in native_targets[row['reward_caller']]:
            raise ValueError('source reward call absent from original native ROM')
    return {
        'schema': 'gameverse.soul-eligibility/1', 'rom_sha256': ROM_SHA256,
        'ordinary_species': [r['species'] for r in rows],
        'active_species': [r['species'] for r in rows if r['soul_kind'] in (0, 1)],
        'red_active_species': [r['species'] for r in rows if r['soul_kind'] == 0],
        'source_pins': [{'path': str(BASE / 'source-evidence.json'), 'sha256': EVIDENCE_SHA256}],
        'proof': {'method': 'finite-source-review-with-native-callback-and-call-edge-pins',
                  'runtime_guards': ['first reward call: actor+0x3e &2 ==0', 'normal mode: RAM+0x4cc &3 ==0', 'Soma: RAM+0x13266 ==0', 'exact allowlisted descriptor tuple', 'owned count(kind,id-1)==0'],
                  'action': 'request native pickup at enemy position; retain homing, collision, collection and inventory services',
                  'owned': 'original reward RNG and remaining reward order retained',
                  'gameplay_scope': 'Only prior Zombie species1 acquisition witness exists; source admission is not an all-species gameplay test',
                  'limits': ['Species11..105 remain unreviewed for ordinary/scripted distinction', 'Species33 CreakingSkull demonstrably has actor+0x30-dependent scripted progression guard; nonzero soul rarity does not imply ordinary', 'Static source/native call reachability does not prove every branch executes', 'Native pickup allocation failure and missed/expired pickups do not grant inventory; guarantee is spawn request until actual collection']},
        'excluded': [
            {'species': list(range(11, 106)), 'reason': 'ordinary/scripted classification unreviewed; keep original behavior'},
            {'species': list(range(106, 110)), 'reason': 'source descriptor soul rarity zero; scripted boss reward path retained'},
            {'species': list(range(110, 113)), 'reason': 'no descriptor soul; native campaign/scripted logic retained'},
            {'species': [113, 114], 'reason': 'outside source table ending0x080ea628; interpreted prior rows are sentinel/non-descriptor data'}]}


# Explicit alias for compiler callers.
verify_soul_eligibility = verify_eligibility
