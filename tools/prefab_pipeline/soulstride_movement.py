"""Pinned exact-host movement projection for authored Aria prefab composition.

This adapter projects velocity into the existing player tick. It does not replace
the controller, integrate position, invent grounded state, or allocate new RAM.
"""
import hashlib
import json
from pathlib import Path

BASE = Path('research/deep-extraction/castlevania/movement-contact')
EVIDENCE_SHA256 = '9204aadead4d957aef3c15ddda9ecf67f6db1122509f5ced8cdac0961aa81390'


def generate_movement_source(root, rom=None):
    """Return guarded velocity adapter C and exact source/native provenance."""
    root = Path(root)
    raw = (root / BASE / 'source-evidence.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != EVIDENCE_SHA256:
        raise ValueError('movement evidence changed without review')
    evidence = json.loads(raw)
    if rom is None:
        rom = root / 'local/roms/Castlevania - Aria of Sorrow (USA).gba'
    data = bytes(rom) if isinstance(rom, (bytes, bytearray)) else Path(rom).read_bytes()
    if hashlib.sha256(data).hexdigest() != evidence['rom_sha256']:
        raise ValueError('movement adapter requires exact original USA cartridge')
    for row in evidence['ranges']:
        start, end = row['address'] - 0x08000000, row['end'] - 0x08000000
        if hashlib.sha256(data[start:end]).hexdigest() != row['rom_sha256']:
            raise ValueError('movement native range mismatch')
        if hashlib.sha256((root / row['assembly']).read_bytes()).hexdigest() != row['assembly_sha256']:
            raise ValueError('movement assembly evidence mismatch')
    source = '''/* Exact USA native actor projection; reviewed source/native ranges
 * are retained in movement-contact/source-evidence.json. Authored composition
 * chooses velocity; the original engine owns integration/contact/pose/lifetime.
 */
#include <stdint.h>
static uint32_t gv_aos_soulstride_actor_valid(void *actor) {
    uint8_t *r = *(uint8_t * volatile *)0x084f0b14u;
    if (!r || r[0x13266u] != 0u) return 0u;
    uintptr_t p = (uintptr_t)actor;
    if ((p & 3u) || p < 0x02000000u || p > 0x0203ff7cu) return 0u;
    return *(uint32_t *)(r + 0x13110u) == (uint32_t)p;
}
uint32_t gv_aos_soulstride_motion_native(void *actor, int32_t *vx,
                                        int32_t *vy, uint32_t *left) {
    if (!gv_aos_soulstride_actor_valid(actor)) return 0u;
    uint8_t *a = actor;
    if (vx) *vx = *(int32_t *)(a + 0x48u);
    if (vy) *vy = *(int32_t *)(a + 0x4cu);
    if (left) *left = (a[0x58u] & 0x40u) != 0u;
    return 1u;
}
void gv_aos_soulstride_velocity_native(void *actor, int32_t vx, int32_t vy) {
    if (!gv_aos_soulstride_actor_valid(actor)) return;
    uint8_t *a = actor;
    *(int32_t *)(a + 0x48u) = vx;
    *(int32_t *)(a + 0x4cu) = vy;
}
'''
    return source, {
        'schema': 'gameverse.soulstride-native-movement/1',
        'source_evidence': str(BASE / 'source-evidence.json'),
        'source_evidence_sha256': EVIDENCE_SHA256,
        'rom_sha256': evidence['rom_sha256'],
        'new_storage_bytes': 0,
        'write_offsets': [0x48, 0x4c],
        'native_next_tick': '0x0801B0D8',
        'native_soma_cast': '0x08019478',
        'native_movement_hook': '0x08026008',
        'qualification': 'source-reviewed adapter; gameplay witness separate',
        'limitations': evidence['limitations'],
    }
