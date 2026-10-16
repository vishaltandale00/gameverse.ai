"""Generate a stateless Aria Soulstride progression helper from pinned source evidence.

The generated Thumb C reads Soma/maxMP from the original EWRAM record and counts
the finite set of source-reviewed active early souls through Aria's native API.
It allocates no state and makes no changes to the existing ROM services.
"""
from pathlib import Path
import json

from tools.prefab_pipeline.soul_eligibility import BASE, EVIDENCE_SHA256, verify_eligibility


def generate_soulstride_source(root, rom=None):
    """Return (C source, metadata) after validating the pinned ROM and certificate.

    The helper API is `uint32_t gv_aos_soulstride_context_native(
    uint32_t *current_mp, uint32_t *max_mp, uint32_t *tier)`; it returns 1 only
    for ordinary Soma. Tier is min(distinct owned early active souls / 3, 2).
    """
    root = Path(root)
    certificate = verify_eligibility(root, rom=rom)
    evidence = json.loads((root / BASE / 'source-evidence.json').read_text())
    active = set(certificate['active_species'])
    capacities = (56, 26, 36, 8)
    entries = []
    seen = set()
    for row in evidence['rows']:
        if row['species'] not in active:
            continue
        kind = int(row['soul_kind'])
        index = int(row['soul_id_one_based']) - 1
        if not 0 <= kind < len(capacities) or not 0 <= index < capacities[kind]:
            raise ValueError('reviewed active soul exceeds native inventory capacity')
        if (kind, index) not in seen:
            entries.append((kind, index))
            seen.add((kind, index))
    if len(entries) != 9:
        raise ValueError('reviewed active early-soul set changed; requires source review')

    rows = ',\n'.join(f'    {{{kind}u, {index}u}}' for kind, index in entries)
    source = f'''/* Generated from {BASE / 'source-evidence.json'} ({EVIDENCE_SHA256}).
 * Native USA service: gv_aos_soul_count_native @ 0x080326B8, u32(kind,index).
 * No new persistent storage; count each distinct source-reviewed active soul once.
 */
#include <stdint.h>
typedef uint32_t (*GvAosSoulCountFn)(uint32_t, uint32_t);
static const uint8_t sEarlySoulPairs[{len(entries)}][2] = {{
{rows}
}};

uint32_t gv_aos_soulstride_context_native(uint32_t *current_mp,
                                          uint32_t *max_mp,
                                          uint32_t *tier) {{
    volatile uint8_t *ewram = *(volatile uint8_t * volatile *)0x084f0b14u;
    if (ewram == 0 || ewram[0x13266u] != 0u) return 0u; /* Soma only */
    uint16_t mp = (uint16_t)ewram[0x1327cu] |
                  (uint16_t)((uint16_t)ewram[0x1327du] << 8);
    uint16_t mp_max = (uint16_t)ewram[0x13280u] |
                      (uint16_t)((uint16_t)ewram[0x13281u] << 8);
    GvAosSoulCountFn count = (GvAosSoulCountFn)(uintptr_t)0x080326b9u;
    uint32_t distinct = 0u;
    for (uint32_t i = 0u; i < {len(entries)}u; ++i) {{
        if (count(sEarlySoulPairs[i][0], sEarlySoulPairs[i][1]) != 0u)
            ++distinct;
    }}
    if (current_mp) *current_mp = mp;
    if (max_mp) *max_mp = mp_max;
    if (tier) {{
        uint32_t value = distinct / 3u;
        *tier = value > 2u ? 2u : value;
    }}
    return 1u;
}}
'''
    metadata = {
        'schema': 'gameverse.soulstride-progression/1',
        'rom_sha256': certificate['rom_sha256'],
        'source_evidence': str(BASE / 'source-evidence.json'),
        'source_evidence_sha256': EVIDENCE_SHA256,
        'native_count_service': {'address': '0x080326B8', 'abi': 'u32(kind,index)',
                                 'call_pointer': '0x080326B9'},
        'soma_current_character_address': 'EWRAM+0x13266',
        'current_mp_address': 'EWRAM+0x1327C',
        'max_mp_address': 'EWRAM+0x13280',
        'owned_pairs': [{'kind': k, 'index': i} for k, i in entries],
        'tier_rule': 'min(distinct_owned_pairs / 3, 2)',
        'new_storage_bytes': 0,
    }
    return source, metadata
