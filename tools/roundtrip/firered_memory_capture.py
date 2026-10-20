"""Capture pinned FireRed Rev1 icon-memory semantics once; emit private data IR.

No dependencies beyond existing ELF readers. This captures a bounded data family,
not behavior IR or whole-game equivalence. See --help for private output defaults.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import platform
import struct
import time
from pathlib import Path
from .asset_batch import elf_bytes, pinned, validate_icon_consumer
from .elf_provider import load_segments
from .memory_ontology import canonical, sha, validate_manifest
from tools.whole_game.elf_symbols import symbols


def capture(profile_path, output):
    started = time.perf_counter()
    profile = json.loads(Path(profile_path).read_text())
    root = Path(profile['source_root'])
    elf = pinned(profile['elf']); pinned(profile['map'])
    source = pinned(profile['consumer']).decode()
    validate_icon_consumer(source, profile['contract'])
    build = json.loads(pinned(profile['build_receipt']))
    rom = pinned(build['artifacts']['rom'])
    if hashlib.sha1(rom).hexdigest() != 'dd5945db9b930750cb39d00c84da8571feebf417':
        raise ValueError('expected exact USA Europe Rev1 ROM')
    syms = symbols(profile['elf']['path'], detailed=True)
    segments = load_segments(elf)
    def symbol(name):
        found = syms[name]
        if len(found) != 1:
            raise ValueError('ambiguous symbol '+name)
        return found[0]
    def ref(path):
        raw = (root / path).read_bytes()
        return {'path': str(root / path), 'sha256': sha(raw)}
    witnesses = {}
    for path in ['src/pokemon_icon.c', 'src/trainer_card.c', 'src/rom_header_gf.c',
                 'src/pokemon_storage_system_graphics.c', 'src/pokemon_storage_system_misc.c',
                 'src/sprite.c', 'include/constants/species.h', 'ld_script.ld']:
        raw = (root / path).read_bytes()
        witnesses[path] = {**ref(path), 'text': raw.decode()}
    ownership = []
    for name, values in syms.items():
        for item in values:
            if item['size'] and 0x02000000 <= item['address'] < 0x03008000 and item['sectionType'] == 8:
                ownership.append({'symbol': name, **item, 'initialization': 'NOLOAD; runtime initialization not proved'})
    allocations, tables = [], []
    names = ['gMonIconPalettes', 'gMonIconTable', 'gMonIconPaletteIndices', 'gMonIconPaletteTable']
    for name in names:
        item = symbol(name); offset = item['address'] - 0x08000000
        raw = elf_bytes(elf, segments, item['address'], item['size'])
        if rom[offset:offset+len(raw)] != raw:
            raise ValueError('ELF/ROM mismatch '+name)
        allocations.append({'id': name, 'rom_offset': offset, 'size': len(raw), 'kind': 'data',
                            'elf_symbol': item, 'sha256': sha(raw),
                            'component_id': 'pokemon-firered-version-rev1.object.src_pokemon_icon.o.rodata.003d37b0',
                            'source': {**profile['consumer'], 'symbol': name}})
        if name == 'gMonIconPaletteTable':
            continue  # Descriptor pointers are generated relocation bindings, not independent editable rows.
        stride = 32 if name == 'gMonIconPalettes' else (4 if name == 'gMonIconTable' else 1)
        fields = ([{'name': f'color{i}', 'offset': 2*i, 'type': 'u16', 'min': 0, 'max': 32767} for i in range(16)]
                  if stride == 32 else [{'name': 'pointer' if stride == 4 else 'palette', 'offset': 0, 'type': 'u32' if stride == 4 else 'u8'}])
        if name == 'gMonIconPaletteIndices':
            fields[0]['references_table'] = 'gMonIconPalettes'
        fmt = 'H' if stride == 32 else ('I' if stride == 4 else 'B')
        rows = [{f['name']: struct.unpack_from('<'+fmt, raw, at+f['offset'])[0] for f in fields} for at in range(0, len(raw), stride)]
        tables.append({'id': name, 'symbol': name, 'allocation_id': name, 'rom_offset': offset,
                       'stride': stride, 'capacity': len(rows), 'rows': rows, 'fields': fields,
                       'snapshot_hex': raw.hex(), 'bindings': [], 'expansion': {'status': 'blocked',
                       'reference_closure': 'unknown', 'reason': 'species extension needs global enum/save/consumer audit'}})
    base = symbol('gMonIconPalettes')['address']
    descriptors = symbol('gMonIconPaletteTable')['address'] - 0x08000000
    descriptor_rows = []
    bindings = []
    for index in range(6):
        at = descriptors + index*8
        pointer, tag = struct.unpack_from('<IH', rom, at)
        if pointer != base+index*32:
            raise ValueError('unexpected original descriptor backing')
        descriptor_rows.append({'index': index, 'pointer': pointer, 'tag': tag,
                                'within_source_array': index < 3, 'actual_target': 'palette RGB555' if index < 3 else 'gMonIconTable pointer bytes'})
        bindings.append({'role': 'pointer', 'rom_offset': at, 'type': 'u32', 'expected': pointer,
                         'target_addend': index*32, 'source_consumer': f'gMonIconPaletteTable[{index}].data'})
    direct = 0x8ab54
    if struct.unpack_from('<I', rom, direct)[0] != base:
        raise ValueError('trainer-card palette literal differs')
    bindings.append({'role': 'pointer', 'rom_offset': direct, 'type': 'u32', 'expected': base,
                     'target_addend': 0, 'source_consumer': 'trainer_card.c LoadMonIconGfx CpuCopy16',
                     'binding_storage': 'literal_pool_data_inside_code_symbol'})
    allocations.append({'id': 'trainer-card-icon-palette-literal', 'rom_offset': direct, 'size': 4,
                        'kind': 'data', 'source': {**ref('src/trainer_card.c'), 'symbol': 'LoadMonIconGfx'},
                        'storage': 'Thumb PC-relative literal; neighboring instructions excluded'})
    scanned = []
    for index in range(6):
        needle = struct.pack('<I', base+index*32); at = rom.find(needle)
        while at >= 0:
            if at % 4 == 0:
                scanned.append({'rom_offset': at, 'target_addend': index*32,
                                'action': 'relocate' if at in {b['rom_offset'] for b in bindings} else 'preserve distinct gMonIconTable alias'})
            at = rom.find(needle, at+1)
    if {v['rom_offset'] for v in scanned} != {b['rom_offset'] for b in bindings} | {0x138, 0x97064}:
        raise ValueError('unreviewed aligned backing reference')
    # Check actual Thumb instructions, not just source ARRAY_COUNT or table length.
    counts = {0x970a4: '052c', 0x9713e: '052c', 0x971b8: '0525', 0x971b2: 'a02c', 0x971be: '2022'}
    for offset, expected in counts.items():
        if rom[offset:offset+2].hex() != expected:
            raise ValueError('consumer instruction witness differs')
    palette = tables[0]
    palette['bindings'] = bindings
    palette['expansion'] = {'status': 'closed', 'reference_closure': 'complete',
        'closure_scope': 'selected palette backing references only; native gameplay unverified',
        'fixed_consumer_capacity': 6,
        'closure_evidence': {'aligned_pointer_scan': scanned, 'instruction_witnesses': counts,
          'source_consumers': ['pokemon_icon.c six descriptors and load/free loops', 'trainer_card.c LoadMonIconGfx copy192B'],
          'computed_reference_caveat': 'Exact selected source family reviewed; numeric scan alone is not pointer provenance'},
        'free_region': {'mode': 'rom_extension', 'rom_offset': len(rom), 'size': 192, 'fill': 255, 'expected_sha256': sha(b'')},
        'reason': 'Append three32B palettes; preserve existing3; relocate only seven source-classified references; fixed consumers already handle6'}
    manifest = {'schema': 'gameverse.gba-memory-ontology/1', 'game_id': 'pokemon-firered-version-rev1',
        'module_id': 'firered.icon-palette-family',
        'source_revision': build['sourceCommit'], 'rom': {'sha256': sha(rom), 'size': len(rom), 'sha1': hashlib.sha1(rom).hexdigest()},
        'allocations': allocations, 'tables': tables, 'elf': profile['elf'], 'map': profile['map'],
        'elf_provenance_scope': 'historical exact-original ELF/map; generated candidate has no regenerated ELF/map',
        'graphics_contracts': [{'contract': {'kind': 'gba-palette/1', 'id': 'firered-icon-palettes', 'palette': 'palettes'},
                                'assets': {'palettes': {'table': 'gMonIconPalettes'}}}],
        'source_witnesses': witnesses, 'ram_allocations': ownership,
        'semantic': {'family': 'indexed-4bpp-icon-with-RGB555-palette', 'descriptor_rows': descriptor_rows,
          'source_array_count': 3, 'descriptor_capacity': 6, 'species_slots': 440, 'safe_species_max': 412,
          'icon_frame_stride': 512, 'ordinary_icon_frames': 2, 'deoxys_extra_byte_offset': 1024,
          'limits': ['u16 species; save species format unchanged', 'u8 palette indices and load/free loop counter',
                     'six original palette tags; sixteen OBJ palette slots globally shared',
                     '32B 4bpp palette loads; trainer-card copy192B and six BG slots5..10',
                     'sprite copies u16 byte lengths, queue capacity64; palette expansion leaves frame copy512B unchanged',
                     'no new species, sprites, VRAM or EWRAM allocations'],
          'existing_asset_pack': 'local/roundtrip/coverage-next-firered-icon-assets-002/asset-pack.json',
          'roundtrip_manifest': 'research/ir-workshop/roundtrip-20261016/firered/rev1-roundtrip-001/manifest.json',
          'existing_behavior_relation': {'id': 'firered.text.wait_initialize', 'relationship': 'same exact-ROM host only; no icon behavior prefab recovered'},
          'native_validation': 'not performed; source and linked instruction witnesses only'}}
    validate_manifest(manifest, rom)
    out = Path(output); out.mkdir(parents=True, exist_ok=False)
    (out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    # New palettes derive from retained typed rows; no fresh source read during compilation.
    extras = []
    for index in range(3):
        row = dict(palette['rows'][index])
        row['color1'] = (row['color1'] & ~31) | ((row['color1']+8) & 31)
        extras.append({'op': 'append', 'table': 'gMonIconPalettes', 'row': row})
    request = {'manifest_sha256': sha(canonical(manifest)), 'operations': extras +
               [{'op': 'set', 'table': 'gMonIconPaletteIndices', 'index': 1, 'field': 'palette', 'value': 3}]}
    identity = {'manifest_sha256': sha(canonical(manifest)), 'operations':
                [{'op': 'set', 'table': 'gMonIconPaletteIndices', 'index': 1, 'field': 'palette', 'value': tables[2]['rows'][1]['palette']}]}
    for name, value in [('expand-request.json', request), ('identity-request.json', identity)]:
        (out/name).write_text(json.dumps(value, indent=2)+'\n')
    receipt = {'schema': 'gameverse.firered-memory-capture/1', 'outcome': 'captured',
        'source_revision': build['sourceCommit'], 'rom_sha256': sha(rom), 'elf_sha256': sha(elf),
        'manifest_sha256': sha(canonical(manifest)), 'ram_symbols': len(ownership),
        'typed_table_bytes': sum(t['stride']*t['capacity'] for t in tables),
        'descriptor_bytes': 48, 'relocation_binding_count': 7, 'preserved_numeric_alias_count': 2,
        'elapsed_seconds': time.perf_counter()-started, 'queue_seconds': None, 'build_seconds': None,
        'native_seconds': None, 'attempts': 1, 'repairs': 0, 'cache': 'existing pinned ELF/map/source; no build',
        'environment': {'python': platform.python_version(), 'platform': platform.platform()},
        'scope': 'source-backed typed data extraction; no native equivalence claim'}
    (out/'capture-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default='research/ir-workshop/coverage-wave-next/assets/firered-icons-profile.json')
    parser.add_argument('--output', required=True, help='New private directory under local/')
    args = parser.parse_args()
    print(json.dumps(capture(args.profile, args.output)))


if __name__ == '__main__':
    main()
