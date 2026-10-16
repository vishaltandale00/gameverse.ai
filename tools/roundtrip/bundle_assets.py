"""Evidence-backed asset overlays; object names never establish asset type."""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def _pinned(path, expected):
    data = Path(path).read_bytes()
    if len(data) > 32*1024*1024 or sha(data) != expected:
        raise ValueError('missing, stale or oversized asset source evidence')
    return data


def _source_data(candidate, source_root, include_roots):
    source_path = (ROOT/candidate['source_declaration']).resolve()
    asset_path = (ROOT/candidate['source_asset']).resolve()
    if not source_path.is_relative_to(source_root) or not asset_path.is_relative_to(source_root):
        raise ValueError('asset evidence escapes source root')
    text = _pinned(source_path, candidate['source_file_sha256']).decode()
    data = _pinned(asset_path, candidate['source_asset_sha256'])
    symbol = re.escape(candidate['asset_symbol'])
    if candidate['kind'] == 'palette, u16 little-endian colors':
        match = re.search(r'const\s+u16\s+'+symbol+r'\s*\[([0-9 *]+)\]\s*=\s*\{\s*#include\s+"([^"\n]+)"\s*\};', text)
        roots = [(source_root/path).resolve() for path in include_roots]
        if (any(not root.is_relative_to(source_root) for root in roots)
                or not match or not any((root/match[2]).resolve() == asset_path for root in roots)):
            raise ValueError('palette lacks exact typed source declaration/include')
        if not re.fullmatch(r'\s*\d+(?:\s*\*\s*\d+)*\s*', match[1]):
            raise ValueError('unsupported palette extent expression')
        count = math.prod(int(x.strip()) for x in match[1].split('*'))
        tokens = data.decode().strip().split(',')
        if any(not re.fullmatch(r'\s*(?:0x[0-9a-fA-F]+|[0-9]+)[uU]?\s*', value) for value in tokens):
            raise ValueError('palette contains nonliteral values')
        values = [int(value.strip().rstrip('uU'), 0) for value in tokens]
        if count != len(values) or not 0 < count <= 65536 or any(not 0 <= value <= 0xffff for value in values):
            raise ValueError('palette source extent/value mismatch')
        data = struct.pack('<'+'H'*count, *values)
        category = 'gba-palette-u16'
    elif candidate['kind'] == 'direct sound sample incbin':
        match = re.search(r'(?m)^'+symbol+r':\s*\n\s*\.incbin\s+"([^"\n]+)"', text)
        sections = list(re.finditer(r'(?m)^\s*(?:\.section\s+(\.[A-Za-z0-9_.]+)|(\.text|\.data|\.rodata|\.bss))\b', text[:match.start()])) if match else []
        active = next((value for value in sections[-1].groups() if value), None) if sections else None
        if not match or (source_root/match[1]).resolve() != asset_path or active != '.rodata':
            raise ValueError('audio sample lacks exact read-only incbin declaration')
        category = 'gba-directsound-sample'
    else:
        raise ValueError('unsupported asset category; code/scripts remain unclassified')
    if len(data) != candidate['exact_size_bytes'] or sha(data) != candidate['span_sha256']:
        raise ValueError('serialized source bytes differ from proposed asset')
    return data, category


def _consumer_contract(category, candidate, source_root, contract):
    """Check configured identifiers against fixed supported source constructs."""
    ref = contract['source']
    path = (source_root/ref['path']).resolve()
    if not path.is_relative_to(source_root):
        raise ValueError('consumer contract escapes source root')
    raw = _pinned(path, ref['sha256'])
    text = raw.decode()
    keys = ('binding_variable', 'transfer_variable', 'sink_function', 'sink_array', 'sink_parameter', 'sink_index') if category == 'gba-palette-u16' else ('inner_macro', 'pointer_parameter')
    for key in keys:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', contract.get(key, '')):
            raise ValueError('consumer contract identifiers must be explicit')
    lanes = {}
    if category == 'gba-palette-u16':
        if contract.get('kind') != 'typed-u16-palette-copy/1':
            raise ValueError('unknown typed palette consumer contract')
        binding, transfer, sink, array, parameter, index = [re.escape(contract[key]) for key in keys]
        if (not re.search(r'const\s+u16\s*\*\s*'+binding+r'\s*;', text)
                or not re.search(binding+r'\s*=\s*'+re.escape(candidate['asset_symbol'])+r'\s*;', text)
                or not re.search(transfer+r'\s*=\s*'+binding+r'\s*;', text)
                or not re.search(sink+r'\s*\(\s*'+transfer+r'\s*,', text)
                or not re.search(r'void\s+'+sink+r'\(const\s+u16\s*\*\s*'+parameter+r'\s*,[^)]*\)\s*\{[^}]*'+array+r'\['+index+r'\]\s*=\s*\*'+parameter+r'\+\+;', text, re.S)):
            raise ValueError('palette source consumer does not reach typed palette copy')
    else:
        if contract.get('kind') != 'voice-sample-pointer-macro/1':
            raise ValueError('unknown audio consumer contract')
        macros = contract.get('public_macros', [])
        if not macros or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) for name in macros):
            raise ValueError('explicit audio consumer macros required')
        inner, pointer = re.escape(contract['inner_macro']), re.escape(contract['pointer_parameter'])
        body = re.search(r'\.macro\s+'+inner+r'\s+([^\n]+)\n(.*?)\.endm', text, re.S)
        inner_parameters = [value.strip() for value in body[1].split(',')] if body else []
        if not body or contract['pointer_parameter'] not in inner_parameters or not re.search(r'\.4byte\s+\\'+pointer+r'\b', body[2]):
            raise ValueError('audio consumer lacks typed sample data pointer')
        inner_lane = inner_parameters.index(contract['pointer_parameter'])
        for name in macros:
            definition = re.search(r'\.macro\s+'+re.escape(name)+r'\s+([^\n]+)\n(.*?)\.endm', text, re.S)
            parameters = [value.strip() for value in definition[1].split(',')] if definition else []
            invocation = re.search(r'(?m)^\s*'+inner+r'\s+([^\n@]+)', definition[2]) if definition else None
            arguments = [value.strip() for value in invocation[1].split(',')] if invocation else []
            if (contract['pointer_parameter'] not in parameters or inner_lane >= len(arguments)
                    or arguments[inner_lane] != '\\'+contract['pointer_parameter']):
                raise ValueError('audio consumer macro does not forward sample pointer')
            lanes[name] = parameters.index(contract['pointer_parameter'])
    return {'source': ref['path'], 'sha256': sha(raw), 'contract': contract, 'pointer_lanes': lanes}


def _sample_consumer(line, symbol, proof):
    line = line.split('@', 1)[0].strip()
    for name, lane in proof['pointer_lanes'].items():
        match = re.fullmatch(re.escape(name)+r'\s+(.+)', line)
        arguments = [value.strip() for value in match[1].split(',')] if match else []
        if lane < len(arguments) and arguments[lane] == symbol:
            return True
    return False


def create_asset_overlay(bundle_dir, inventory_path, output_dir):
    """Verify three bounded source-backed asset spans and separate private files."""
    from .private_bundle import _read
    from .elf_provider import input_sections, load_segments
    from tools.whole_game.elf_symbols import symbols
    started = time.perf_counter()
    bundle, inventory_path, output = Path(bundle_dir).resolve(), Path(inventory_path).resolve(), Path(output_dir).resolve()
    config = json.loads(inventory_path.read_text())
    pins = config['baseline_pins']
    source_root = (ROOT/config['source_root']).resolve()
    metadata = json.loads((bundle/'bundle.json').read_text())
    layout = json.loads(_read(bundle, metadata['layout']))
    original_hash = metadata['original']['sha256']
    if pins['rom_sha256'] != original_hash:
        raise ValueError('asset source version differs from imported bundle')
    elf_pin = {'path': pins['elf'], 'sha256': pins['elf_sha256']}
    map_pin = {'path': pins['map'], 'sha256': pins['map_sha256']}
    elf_path = (ROOT/elf_pin['path']).resolve()
    elf = _pinned(elf_path, elf_pin['sha256'])
    mapping = _pinned(ROOT/map_pin['path'], map_pin['sha256']).decode()
    symbol_index, sections, segments = symbols(elf_path, detailed=True), input_sections(mapping), load_segments(elf)
    candidates = config['source_backed_candidates']
    if not isinstance(candidates, list) or not 0 < len(candidates) <= 32:
        raise ValueError('bounded source-backed asset candidates required')
    prepared, last = [], 0
    for candidate in sorted(candidates, key=lambda c: int(c['original_rom_offset_hex'], 0)):
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', candidate['asset_symbol']):
            raise ValueError('invalid asset symbol identity')
        data, category = _source_data(candidate, source_root, config['include_roots'])
        offset, size = int(candidate['original_rom_offset_hex'], 0), len(data)
        if offset < last or offset+size > metadata['original']['size']:
            raise ValueError('asset span overlaps or exceeds original')
        last = offset+size
        entries = symbol_index.get(candidate['asset_symbol'], [])
        if len(entries) != 1:
            raise ValueError('asset ELF symbol absent or ambiguous')
        symbol = entries[0]
        if (symbol['address'] != 0x08000000+offset or symbol['sectionType'] != 1
                or symbol['sectionFlags'] & 5 or not symbol['sectionFlags'] & 2
                or category == 'gba-palette-u16' and (symbol['type'] != 1 or symbol['size'] != size)):
            raise ValueError('asset symbol is not exact read-only linked data')
        if category == 'gba-directsound-sample' and symbol['type'] not in (0, 1):
            raise ValueError('code symbol cannot be an audio sample')
        matching = [row for row in layout['components'] if row.get('sourceComponent') == candidate['containing_component']
                    and row['offset'] <= offset and offset+size <= row['offset']+row['size']]
        if len(matching) != 1:
            raise ValueError('asset is not wholly inside its retained bundle component')
        row = matching[0]
        raw = _read(bundle, row['artifact'])
        if row['sha256'] != candidate['component_hash'] or raw[offset-row['offset']:offset-row['offset']+size] != data:
            raise ValueError('asset differs from exact retained component bytes')
        owners = [section for section in sections if section['section'] == '.rodata'
                  and section['address'] <= symbol['address'] and symbol['address']+size <= section['address']+section['size']]
        if len(owners) != 1:
            raise ValueError('asset ELF map ownership is absent or ambiguous')
        expected_owner = str((ROOT/candidate['source_declaration']).resolve().relative_to(source_root).with_suffix('.o'))
        if owners[0]['owner'] != expected_owner:
            raise ValueError('linked object does not own the typed source declaration')
        linked = [seg for seg in segments if seg['physical'] <= symbol['address'] and symbol['address']+size <= seg['physical']+seg['size']]
        linked_start = linked[0]['file_offset']+symbol['address']-linked[0]['physical'] if len(linked) == 1 else -1
        if len(linked) != 1 or elf[linked_start:linked_start+size] != data:
            raise ValueError('asset source bytes do not match file-backed ELF bytes')
        consumer_proof = _consumer_contract(category, candidate, source_root, config['consumer_contracts'][category])
        consumer_pins = []
        for reference in candidate['consumer_source']:
            relative, line = reference.rsplit(':', 1)
            path = (source_root/relative).resolve()
            if not path.is_relative_to(source_root):
                raise ValueError('consumer source escapes authoritative root')
            raw_consumer = _pinned(path, config['consumer_source_pins'][relative])
            lines = raw_consumer.decode().splitlines()
            if not 1 <= int(line) <= len(lines) or candidate['asset_symbol'] not in lines[int(line)-1]:
                raise ValueError('asset consumer source reference is stale')
            if category == 'gba-directsound-sample' and not _sample_consumer(lines[int(line)-1], candidate['asset_symbol'], consumer_proof):
                raise ValueError('sample consumer is not a typed sound voice')
            consumer_pins.append({'source': relative, 'line': int(line), 'sha256': sha(raw_consumer)})
        if not consumer_pins:
            raise ValueError('source consumer evidence required')
        consumer_pins.append(consumer_proof)
        prepared.append((candidate, data, category, owners[0], consumer_pins))
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    assets = []
    for index, (candidate, data, category, owner, consumers) in enumerate(prepared):
        path = output/(f'{index:02d}-'+candidate['asset_symbol']+'.bin')
        path.write_bytes(data)
        assets.append({'id': candidate['asset_symbol'], 'type': 'asset_data', 'category': category,
                       'original_offset': int(candidate['original_rom_offset_hex'], 0), 'size': len(data), 'sha256': sha(data),
                       'artifact': {'path': path.name, 'sha256': sha(data)}, 'source_component': candidate['containing_component'],
                       'source_pins': {'declaration_sha256': candidate['source_file_sha256'], 'asset_source_sha256': candidate['source_asset_sha256']},
                       'elf_symbol': candidate['asset_symbol'], 'linked_object': owner['owner'], 'consumers': consumers})
    total = sum(asset['size'] for asset in assets)
    partition, cursor = [], 0
    for asset in assets:
        if cursor < asset['original_offset']:
            partition.append({'offset': cursor, 'size': asset['original_offset']-cursor, 'type': 'existing_ir_or_native_mixed_unknown'})
        partition.append({'offset': asset['original_offset'], 'size': asset['size'], 'type': 'asset_data', 'asset': asset['id']})
        cursor = asset['original_offset']+asset['size']
    if cursor < metadata['original']['size']:
        partition.append({'offset': cursor, 'size': metadata['original']['size']-cursor, 'type': 'existing_ir_or_native_mixed_unknown'})
    result = {'schema': 'gameverse.private-bundle-assets/1', 'status': 'passed', 'asset_data_bytes': total,
              'categories': {category: sum(len(data) for _, data, kind, _, _ in prepared if kind == category) for category in sorted({p[2] for p in prepared})},
              'assets': assets, 'original_sha256': original_hash,
              'original_byte_partition': partition,
              'bundle_manifest_sha256': sha((bundle/'bundle.json').read_bytes()), 'bundle_layout': metadata['layout'],
              'inventory_sha256': sha(inventory_path.read_bytes()), 'elf_sha256': elf_pin['sha256'], 'map_sha256': map_pin['sha256'],
              'remaining_original_bytes': metadata['original']['size']-total,
              'remaining_type': 'native_code_or_mixed_unknown_except_existing_qualified_IR',
              'source_gameplay_semantics_revalidated': False, 'original_delivery_modified': False,
              'private_original_derived_bytes': True, 'redistribution': 'not_authorized',
              'wall_s': round(time.perf_counter()-started, 6), 'queue_s': None}
    (output/'asset-overlay.json').write_text(json.dumps(result, indent=2, sort_keys=True)+'\n')
    return result


def rebuild_with_asset_overlay(bundle_dir, overlay_dir, output_path):
    """Consume separated asset files in a new, byte-identical output layout.

    This changes storage ownership only. Existing IR compilation/qualification
    is retained evidence; this operation performs artifact-only assembly.
    """
    from .private_bundle import _read
    from .native_provider import assemble_native_layout
    started = time.perf_counter()
    bundle, overlay, output = Path(bundle_dir).resolve(), Path(overlay_dir).resolve(), Path(output_path).resolve()
    metadata = json.loads((bundle/'bundle.json').read_text())
    record_path = overlay/'asset-overlay.json'
    record = json.loads(record_path.read_text())
    if record['bundle_manifest_sha256'] != sha((bundle/'bundle.json').read_bytes()):
        raise ValueError('asset overlay belongs to a different bundle')
    layout = json.loads(_read(bundle, metadata['layout']))
    if layout.get('reconstruction_mode') != 'native-relocated':
        raise ValueError('asset split currently requires an admitted native/IR output layout')
    assets = sorted(record['assets'], key=lambda row: row['original_offset'])
    last = 0
    for asset in assets:
        if asset['original_offset'] < last or asset['size'] <= 0:
            raise ValueError('asset overlay ranges overlap')
        last = asset['original_offset']+asset['size']
        data = _read(overlay, asset['artifact'])
        if len(data) != asset['size'] or sha(data) != asset['sha256']:
            raise ValueError('separated asset file identity differs')
    assembly = overlay/'assembly'
    assembly.mkdir()
    (assembly/'assets').mkdir()
    (assembly/'components').mkdir()
    placements, consumed = [], []
    for source in layout['components']:
        data = _read(bundle, source['artifact'])
        selected = [asset for asset in assets if source['offset'] <= asset['original_offset']
                    and asset['original_offset']+asset['size'] <= source['offset']+source['size']]
        boundaries = sorted({source['offset'], source['offset']+source['size'],
                             *(boundary for asset in selected for boundary in (asset['original_offset'], asset['original_offset']+asset['size']))})
        for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
            asset = next((asset for asset in selected if asset['original_offset'] == start), None)
            span = data[start-source['offset']:end-source['offset']]
            identity = source['id']+f'.asset-split-{index}' if selected else source['id']
            if asset:
                asset_data = _read(overlay, asset['artifact'])
                if span != asset_data:
                    raise ValueError('separated asset no longer matches retained host')
                relative = 'assets/'+asset['artifact']['path']
                (assembly/relative).write_bytes(asset_data)
                consumed.append(asset['id'])
            else:
                relative = f'components/{len(placements):04d}.bin'
                (assembly/relative).write_bytes(span)
            placements.append({'id': identity, 'version': 'sha256:'+sha(span), 'sourceComponent': source.get('sourceComponent'),
                               'offset': start, 'size': end-start, 'sha256': sha(span),
                               'artifact': {'path': relative, 'sha256': sha(span)},
                               'content_type': 'asset_data' if asset else 'existing_ir_or_native_mixed_unknown',
                               'source_component': source['id'], 'transform': 'identity-byte-span-split'})
    if sorted(consumed) != sorted(asset['id'] for asset in assets):
        raise ValueError('some assets are outside retained output component ranges')
    derived = {**layout, 'components': placements}
    layout_path = assembly/'layout.json'
    layout_path.write_text(json.dumps(derived, indent=2, sort_keys=True)+'\n')
    result = assemble_native_layout(layout_path, output)
    if result['artifact']['sha256'] != metadata['expected_artifact']['sha256']:
        raise ValueError('asset-separated assembly changed admitted candidate identity')
    receipt = {'schema': 'gameverse.private-assets-rebuild/1', 'status': 'passed', 'consumed_by_rebuild': True,
               'asset_ids': consumed, 'asset_bytes': sum(asset['size'] for asset in assets),
               'artifact': result['artifact'], 'layout': {'path': str(layout_path), 'sha256': sha(layout_path.read_bytes())},
               'asset_overlay_sha256': sha(record_path.read_bytes()), 'replay_regenerated_ir_bytes': 0,
               'frozen_ir_recipe_modified': False, 'semantic_qualification_replayed': False,
               'wall_s': round(time.perf_counter()-started, 6), 'queue_s': None}
    (overlay/'asset-rebuild-receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n')
    return receipt
