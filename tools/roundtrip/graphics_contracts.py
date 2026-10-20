"""Exact, uncompressed GBA graphics IR; structural checks never certify appearance.

Tile streams are tile-major, each tile row-major with the left pixel in the low
nibble for 4bpp. Text maps are *screenblock-order* streams, not image row order.
Only explicitly described consumers are checked: no inference from byte length.
Affine maps, compression, OBJ 2D mapping and bitmap modes are unsupported.
"""
from __future__ import annotations

import hashlib
import struct
from pathlib import Path


def _uint(value, bits, name):
    if type(value) is not int or not 0 <= value < 1 << bits:
        raise ValueError(f'{name} must be an unsigned {bits}-bit integer')
    return value


def decode_tiles(data: bytes, bpp: int) -> list[list[int]]:
    if bpp not in (4, 8):
        raise ValueError('only 4bpp/8bpp tile streams supported')
    size = 8 * bpp
    if not data or len(data) % size:
        raise ValueError('tile stream must contain complete 8x8 tiles')
    if bpp == 8:
        return [list(data[i:i + size]) for i in range(0, len(data), size)]
    return [[p for byte in data[i:i + size] for p in (byte & 15, byte >> 4)]
            for i in range(0, len(data), size)]


def encode_tiles(tiles: list[list[int]], bpp: int) -> bytes:
    if bpp not in (4, 8) or not tiles:
        raise ValueError('nonempty 4bpp/8bpp tiles required')
    result = bytearray()
    for tile in tiles:
        if len(tile) != 64:
            raise ValueError('tile must contain exactly 64 row-major pixels')
        pixels = [_uint(p, bpp, 'pixel') for p in tile]
        result.extend(pixels if bpp == 8 else
                      (pixels[i] | pixels[i + 1] << 4 for i in range(0, 64, 2)))
    return bytes(result)


def decode_palette(data: bytes) -> list[list[int]]:
    if not data or len(data) % 2 or len(data) > 512:
        raise ValueError('palette must contain 1..256 little-endian BGR555 colors')
    colors = struct.unpack('<' + 'H' * (len(data) // 2), data)
    if any(c & 0x8000 for c in colors):
        raise ValueError('canonical BGR555 palette requires unused bit 15 clear')
    return [[c & 31, c >> 5 & 31, c >> 10 & 31] for c in colors]


def encode_palette(colors: list[list[int]]) -> bytes:
    if not 1 <= len(colors) <= 256 or any(len(c) != 3 for c in colors):
        raise ValueError('palette requires 1..256 RGB triples')
    words = [sum(_uint(channel, 5, 'color channel') << (5 * i)
                 for i, channel in enumerate(color)) for color in colors]
    return struct.pack('<' + 'H' * len(words), *words)


def decode_text_map(data: bytes) -> list[dict]:
    if not data or len(data) % 2:
        raise ValueError('text map must contain whole little-endian u16 entries')
    return [{'tile': w & 1023, 'hflip': bool(w & 1024),
             'vflip': bool(w & 2048), 'palette_bank': w >> 12}
            for w in struct.unpack('<' + 'H' * (len(data) // 2), data)]


def encode_text_map(entries: list[dict]) -> bytes:
    if not entries:
        raise ValueError('nonempty text map required')
    words = []
    for entry in entries:
        if type(entry['hflip']) is not bool or type(entry['vflip']) is not bool:
            raise ValueError('flip fields must be booleans')
        words.append(_uint(entry['tile'], 10, 'tile index') |
                     int(entry['hflip']) << 10 | int(entry['vflip']) << 11 |
                     _uint(entry['palette_bank'], 4, 'palette bank') << 12)
    return struct.pack('<' + 'H' * len(words), *words)


def insert_tiles(tiles: bytes, tilemap: bytes, bpp: int, index: int,
                 additions: bytes, loaded_tile_start: int = 0) -> tuple[bytes, bytes]:
    """Explicit asset edit IR: insert and remap every reference in this map.

    Caller must enumerate *all* other maps/OAM/frame offsets/consumer byte counts
    in its dependency closure. This function cannot discover those consumers.
    """
    decoded = decode_tiles(tiles, bpp)
    extra = decode_tiles(additions, bpp)
    if type(index) is not int or not 0 <= index <= len(decoded):
        raise ValueError('insertion index outside tile stream')
    _uint(loaded_tile_start, 10, 'loaded tile start')
    entries = decode_text_map(tilemap)
    for entry in entries:
        if not loaded_tile_start <= entry['tile'] < loaded_tile_start + len(decoded):
            raise ValueError('map reference outside original loaded tile stream')
        if entry['tile'] >= loaded_tile_start + index:
            entry['tile'] += len(extra)
    return encode_tiles(decoded[:index] + extra + decoded[index:], bpp), encode_text_map(entries)


def validate_graphics_contract(contract: dict, assets: dict[str, bytes]) -> dict:
    """Fail closed for one explicitly wired text BG or contiguous OBJ frame.

    ``copy_bytes`` describes the source consumer's transfer extent, so expanding
    a tile stream without updating that consumer is rejected. Evidence pins are
    supplied separately; passing here is structural validation only.
    """
    kind = contract['kind']
    if kind not in ('gba-text-bg/1', 'gba-obj-frame-1d/1', 'gba-tile-transfer/1'):
        raise ValueError('unsupported graphics consumer kind')
    bpp = contract['bpp']
    tiles = decode_tiles(assets[contract['tiles']], bpp)
    colors = (decode_palette(assets[contract['palette']])
              if kind != 'gba-tile-transfer/1' else [])
    if colors and (len(colors) % 16 or (bpp == 8 and len(colors) != 256)):
        raise ValueError('palette extent must contain whole 16-color banks or 256 colors for 8bpp')
    size = len(assets[contract['tiles']])
    if contract['copy_bytes'] != size:
        raise ValueError('consumer copy byte count disagrees with tile stream')
    if kind != 'gba-tile-transfer/1' and contract.get('transparent_index') != 0:
        raise ValueError('GBA indexed BG/OBJ transparency requires local index zero')
    ranges = []
    if kind == 'gba-text-bg/1':
        char_base = _uint(contract['character_base'], 2, 'character base') * 0x4000
        screen_base = _uint(contract['screen_base'], 5, 'screen base') * 0x800
        tile_start = _uint(contract['loaded_tile_start'], 10, 'loaded tile start')
        start = char_base + tile_start * 8 * bpp
        width, height = contract['map_width_tiles'], contract['map_height_tiles']
        if width not in (32, 64) or height not in (32, 64):
            raise ValueError('only 32/64 tile text BG screenblock maps supported')
        map_data = assets[contract['tilemap']]
        if len(map_data) != width * height * 2:
            raise ValueError('map geometry/consumer extent mismatch')
        if contract['map_copy_bytes'] != len(map_data):
            raise ValueError('consumer map byte count disagrees with map')
        if tile_start + len(tiles) > 1024 or start + size > 0x10000:
            raise ValueError('tile stream exceeds BG addressing/VRAM capacity')
        if screen_base + len(map_data) > 0x10000:
            raise ValueError('screen blocks exceed BG VRAM capacity')
        if max(start, screen_base) < min(start + size, screen_base + len(map_data)):
            raise ValueError('tile and map VRAM allocations overlap')
        entries = decode_text_map(map_data)
        for entry in entries:
            relative = entry['tile'] - tile_start
            if not 0 <= relative < len(tiles):
                raise ValueError('tilemap references an unloaded tile')
            # In 8bpp the bank bits are ignored by hardware; require canonical zero.
            if bpp == 8 and entry['palette_bank']:
                raise ValueError('8bpp text map bank bits must be canonical zero')
            bank = entry['palette_bank'] * 16 if bpp == 4 else 0
            if bpp == 4 and bank + 16 > len(colors):
                raise ValueError('tilemap palette color bank is not loaded')
            if any(p and bank + p >= len(colors) for p in tiles[relative]):
                raise ValueError('tilemap pixel references an unloaded palette color')
        ranges = [{'kind': 'bg-characters', 'start': start, 'end': start + size},
                  {'kind': 'bg-screenblocks', 'start': screen_base, 'end': screen_base + len(map_data)}]
    elif kind == 'gba-obj-frame-1d/1':
        width, height = contract['width'], contract['height']
        if (width, height) not in ((8, 8), (16, 16), (32, 32), (64, 64),
                (16, 8), (32, 8), (32, 16), (64, 32),
                (8, 16), (8, 32), (16, 32), (32, 64)):
            raise ValueError('unsupported OAM shape/size geometry')
        if len(tiles) * 64 != width * height:
            raise ValueError('OAM dimensions disagree with frame byte count')
        unit = _uint(contract['oam_tile_number'], 10, 'OAM tile number')
        if bpp == 8 and unit % 2:
            raise ValueError('8bpp OAM tile number must use even 32-byte units')
        start = unit * 32
        if start + size > 0x8000:
            raise ValueError('OBJ frame exceeds text-mode OBJ VRAM capacity')
        bank = _uint(contract['palette_bank'], 4, 'palette bank')
        if bpp == 8 and bank:
            raise ValueError('8bpp OBJ palette bank must be canonical zero')
        if bpp == 4 and bank * 16 + 16 > len(colors):
            raise ValueError('OBJ palette color bank is not loaded')
        if any(p and p + (16 * bank if bpp == 4 else 0) >= len(colors)
               for tile in tiles for p in tile):
            raise ValueError('OBJ pixel references an unloaded palette color')
        ranges = [{'kind': 'obj-frame', 'start': 0x10000 + start, 'end': 0x10000 + start + size}]
    else:
        # No map, palette or OAM relationship is inferred for an animated BG copy.
        if contract['region'] != 'bg':
            raise ValueError('tile transfer supports text BG VRAM only')
        start = contract['destination_offset']
        if type(start) is not int or start < 0 or start % (8 * bpp) or start + size > 0x10000:
            raise ValueError('tile transfer destination alignment/capacity invalid')
        ranges = [{'kind': 'bg-tile-transfer', 'start': start, 'end': start + size}]
    for dma in contract.get('dma', []):
        bits = dma['bits']
        if bits not in (16, 32):
            raise ValueError('unsupported DMA transfer width')
        unit = bits // 8
        # Reject zero: on GBA count zero represents a maximum-size transfer.
        if any(type(dma[k]) is not int or dma[k] < 0 or dma[k] % unit
               for k in ('source', 'destination', 'bytes')) or dma['bytes'] == 0:
            raise ValueError('DMA alignment/extent invalid')
        channel = _uint(dma['channel'], 2, 'DMA channel')
        if dma['bytes'] // unit > (0x10000 if channel == 3 else 0x4000):
            raise ValueError('DMA transfer exceeds channel count capacity')
        role = dma.get('role')
        if role not in ('tiles', 'tilemap') or (role == 'tilemap' and kind != 'gba-text-bg/1'):
            raise ValueError('DMA must identify a supported asset copy role')
        allocation = ranges[1 if role == 'tilemap' else 0]
        if (dma['destination'] != 0x06000000 + allocation['start'] or
                dma['bytes'] != allocation['end'] - allocation['start']):
            raise ValueError('DMA extent/destination disagrees with declared asset copy')
        source_address = contract.get(role + '_source_address')
        if source_address is not None and dma['source'] != source_address:
            raise ValueError('DMA source disagrees with declared asset address')
    return {'status': 'passed', 'kind': kind, 'tile_count': len(tiles),
            'tile_bytes': size, 'palette_colors': len(colors), 'vram_ranges': ranges,
            'visual_quality_verified': False, 'consumer_execution_verified': False,
            'dependency_closure_verified': False,
            'dma_source_binding_verified': bool(contract.get('dma')) and all(
                contract.get(d['role'] + '_source_address') is not None
                for d in contract.get('dma', []))}


def graphics_graph(contract: dict) -> dict:
    """Typed links for a planner; edges require its independently pinned sources."""
    consumer = contract['id']
    edges = [{'from': consumer, 'to': contract['tiles'], 'type': 'copies_tile_bytes',
              'constraints': ['copy_bytes', 'bpp', 'vram_capacity']}]
    if contract['kind'] != 'gba-tile-transfer/1':
        edges.append({'from': consumer, 'to': contract['palette'], 'type': 'indexes_palette',
                      'constraints': ['palette_bank', 'transparent_index']})
    if contract['kind'] == 'gba-text-bg/1':
        edges += [{'from': contract['tilemap'], 'to': contract['tiles'],
                   'type': 'indexes_tiles', 'constraints': ['loaded_tile_start', '10_bit_index']},
                  {'from': consumer, 'to': contract['tilemap'],
                   'type': 'copies_screenblocks', 'constraints': ['screen_base', 'map_copy_bytes']}]
    return {'schema': 'gameverse.graphics-constraints/1', 'consumer': consumer,
            'edges': edges, 'edit_propagation': ['tile_indices', 'copy_byte_counts',
                'palette_references', 'vram_allocations', 'other_consumers'],
            'limits': ['structural-only', 'uncompressed-only', 'closure-requires-source-evidence']}


def source_pin(path: str | Path) -> dict:
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def prove_firered_icon(profile: dict) -> dict:
    """Optional local proof against the existing pinned source/ELF icon pack.

    No payload is returned. This deliberately proves only Bulbasaur's existing
    first frame and palette selection, not arbitrary sprites or edited runtime.
    """
    from .asset_batch import identify_icons, pinned, elf_bytes
    from .elf_provider import load_segments
    from tools.whole_game.elf_symbols import symbols
    import re
    assets = identify_icons(profile)  # Checks pinned build/ELF/source/table lanes.
    icon = next(a for a in assets if a['id'] == 'gMonIcon_Bulbasaur')
    source = pinned(profile['consumer']).decode()
    if not re.search(r'\[SPECIES_BULBASAUR\]\s*=\s*1\s*,', source):
        raise ValueError('unsupported Bulbasaur palette selection')
    if not re.search(r'\[ST_OAM_SQUARE\]\s*=\s*\{[^}]*\[ST_OAM_SIZE_2\]\s*=\s*0x200\b', source):
        raise ValueError('source square 32x32 frame extent is not 512 bytes')
    root = Path(profile['source_root'])
    species = root / 'include/constants/species.h'
    if not re.search(r'#define\s+SPECIES_BULBASAUR\s+1\b', species.read_text()):
        raise ValueError('unsupported species ordinal')
    palette_path = root / 'graphics/pokemon/icon_palettes/icon_palette_1.gbapal'
    palette = palette_path.read_bytes()
    elf = pinned(profile['elf'])
    index = symbols(Path(profile['elf']['path']), detailed=True)
    segments = load_segments(elf)
    palettes, indices = index['gMonIconPalettes'], index['gMonIconPaletteIndices']
    if len(palettes) != 1 or len(indices) != 1:
        raise ValueError('ambiguous palette source symbols')
    if (palette != elf_bytes(elf, segments, palettes[0]['address'] + 32, 32) or
            elf_bytes(elf, segments, indices[0]['address'] + 1, 1) != b'\x01'):
        raise ValueError('linked palette selection disagrees with source')
    frame = icon['_data'][:512]
    if encode_tiles(decode_tiles(frame, 4), 4) != frame:
        raise ValueError('existing icon frame failed exact codec roundtrip')
    contract = dict(id='firered.Bulbasaur.first-frame', kind='gba-obj-frame-1d/1',
        bpp=4, tiles='frame', palette='palette', copy_bytes=512,
        transparent_index=0, width=32, height=32, oam_tile_number=0, palette_bank=0)
    result = validate_graphics_contract(contract, {'frame': frame, 'palette': palette})
    return {'schema': 'gameverse.graphics-source-proof/1', 'status': 'passed',
        'game': 'firered', 'source_consumer': profile['consumer'],
        'source_inputs': [profile['declarations'], profile['elf'], profile['build_receipt'],
                          source_pin(species), source_pin(palette_path), icon['source'],
                          *[source_pin(root / 'include/gba' / name) for name in
                            ('defines.h', 'types.h', 'macro.h', 'io_reg.h')]],
        'icon_asset_id': icon['id'], 'frame_bytes': len(frame),
        'frame_sha256': hashlib.sha256(frame).hexdigest(), 'frame_codec_roundtrip': True,
        'palette_sha256': hashlib.sha256(palette).hexdigest(), 'palette_source_index': 1,
        'source_consumer_copy_bytes': 512, 'linked_source_palette_verified': True,
        'validated_contract': contract, 'validation': result,
        'limits': ['existing-frame-only', 'runtime-OAM-allocation-unverified',
                   'visual-quality-unverified', 'no-whole-game-closure',
                   'source-build-evidence-reused-no-build-run']}
