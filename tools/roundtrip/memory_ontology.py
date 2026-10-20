"""Pinned GBA allocation ontology and bounded property-to-ROM compiler.

No source tree or toolchain is read during planning. This is a byte-layout IR
backend, not a behavioral ARM compiler or proof that a data edit is playable.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import platform
import re
import struct
import time
import uuid
from pathlib import Path

SCHEMA = 'gameverse.gba-memory-ontology/1'
TYPES = {'u8': ('B', 1), 's8': ('b', 1), 'u16': ('H', 2), 's16': ('h', 2),
         'u32': ('I', 4), 's32': ('i', 4)}
HARDWARE_SPACES = [
    {'id': 'ewram', 'start': 0x02000000, 'size': 0x40000, 'mutable': True},
    {'id': 'iwram', 'start': 0x03000000, 'size': 0x8000, 'mutable': True},
    {'id': 'io', 'start': 0x04000000, 'size': 0x400, 'mutable': True},
    {'id': 'palette', 'start': 0x05000000, 'size': 0x400, 'mutable': True},
    {'id': 'vram', 'start': 0x06000000, 'size': 0x18000, 'mutable': True},
    {'id': 'oam', 'start': 0x07000000, 'size': 0x400, 'mutable': True},
    {'id': 'rom', 'start': 0x08000000, 'size': 0x2000000, 'mutable': False},
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def integer(value, label):
    if type(value) is not int:
        raise ValueError(f'{label} must be an integer')
    return value


def span(offset, size, limit, label):
    integer(offset, label); integer(size, label)
    if offset < 0 or size < 0 or offset + size > limit:
        raise ValueError(f'{label} outside bounded ROM')


def encode(value, typ):
    integer(value, 'property')
    if typ not in TYPES:
        raise ValueError(f'unsupported scalar type: {typ}')
    try:
        return struct.pack('<' + TYPES[typ][0], value)
    except struct.error as exc:
        raise ValueError(f'property outside {typ} range: {value}') from exc




def validate_property(field, value):
    encode(value, field['type'])
    if value < field.get('min', value) or value > field.get('max', value):
        raise ValueError('property outside semantic bounds')
    if 'allowed_values' in field:
        allowed = field['allowed_values']
        if not isinstance(allowed, list) or not allowed:
            raise ValueError('allowed_values requires nonempty captured scalar domain')
        for item in allowed:
            encode(item, field['type'])
        if value not in allowed:
            raise ValueError('property outside allowed_values domain')


def validate_termination(table):
    """Check a captured flag-terminated record chain without inventing a count."""
    termination = table.get('expansion', {}).get('sentinel_termination')
    if termination is None:
        return False
    fields = {field['name']: field for field in table['fields']}
    name = termination.get('field')
    if name not in fields:
        raise ValueError('sentinel termination requires captured scalar field')
    typ = fields[name]['type']
    mask = integer(termination.get('mask'), 'sentinel mask')
    continuation = integer(termination.get('continuation_value'), 'sentinel continuation value')
    terminal = integer(termination.get('terminal_value'), 'sentinel terminal value')
    encode(mask, typ)
    if mask <= 0 or continuation & ~mask or terminal & ~mask or continuation == terminal:
        raise ValueError('invalid sentinel termination flag contract')
    if not table['rows']:
        raise ValueError('sentinel chain must contain terminal row')
    for index, row in enumerate(table['rows']):
        expected = terminal if index == len(table['rows']) - 1 else continuation
        if row[name] & mask != expected:
            raise ValueError('sentinel termination flag disagrees with record chain')
    return True


def validate_manifest(manifest, rom):
    if len(rom) > 0x2000000:
        raise ValueError('ROM exceeds primary GBA cartridge window')
    if manifest.get('schema') != SCHEMA:
        raise ValueError('unsupported ontology schema')
    if manifest.get('rom') != {'sha256': sha(rom), 'size': len(rom)}:
        # Additional identity fields are permitted.
        identity = manifest.get('rom', {})
        if identity.get('sha256') != sha(rom) or identity.get('size') != len(rom):
            raise ValueError('stale ROM identity')
    allocations = {}
    for allocation in manifest.get('allocations', []):
        ident = allocation['id']
        if ident in allocations:
            raise ValueError('duplicate allocation identity')
        if allocation.get('kind') not in ('data', 'code', 'mixed', 'unclassified'):
            raise ValueError('allocation requires explicit kind')
        if 'rom_offset' in allocation:
            span(allocation['rom_offset'], allocation['size'], len(rom), ident)
        allocations[ident] = allocation
    partition(manifest)
    ids = set()
    for table in manifest.get('tables', []):
        if table['id'] in ids:
            raise ValueError('duplicate table identity')
        ids.add(table['id'])
        allocation = allocations.get(table['allocation_id'])
        if not allocation or allocation['kind'] != 'data':
            raise ValueError('editable table requires classified data allocation')
        stride, capacity = table['stride'], table['capacity']
        prefix = integer(table.get('backing_prefix_size', 0), 'backing prefix size')
        if prefix < 0:
            raise ValueError('negative backing prefix size')
        integer(stride, 'stride'); integer(capacity, 'capacity')
        if stride < 1 or capacity < 1 or len(table['rows']) > capacity:
            raise ValueError('invalid table stride/capacity')
        span(table['rom_offset'] - prefix, prefix + stride * capacity, len(rom), table['id'])
        if table['rom_offset'] - prefix < 0xc0:
            raise ValueError('editable table touches cartridge header')
        if table['rom_offset'] - prefix < allocation['rom_offset'] or table['rom_offset'] + stride * capacity > allocation['rom_offset'] + allocation['size']:
            raise ValueError('table exceeds classified allocation')
        occupied, fields = set(), set()
        for field in table['fields']:
            if field['name'] in fields or field['type'] not in TYPES:
                raise ValueError('duplicate field or unsupported scalar type')
            fields.add(field['name'])
            start, size = field['offset'], TYPES[field['type']][1]
            span(start, size, stride, 'field')
            cells = set(range(start, start + size))
            if occupied & cells:
                raise ValueError('overlapping typed fields')
            occupied |= cells
        original = rom[table['rom_offset']:table['rom_offset'] + capacity * stride]
        if 'snapshot_hex' in table and bytes.fromhex(table['snapshot_hex']) != original:
            raise ValueError('stale captured table bytes')
        for index, row in enumerate(table['rows']):
            if set(row) != fields:
                raise ValueError('row properties do not match captured fields')
            for field in table['fields']:
                validate_property(field, row[field['name']])
                raw = encode(row[field['name']], field['type'])
                pos = index * stride + field['offset']
                if original[pos:pos + len(raw)] != raw:
                    raise ValueError('captured property differs from ROM')
        validate_termination(table)
        for binding in table.get('bindings', []):
            if 'table_relative_offset' in binding:
                relative = integer(binding['table_relative_offset'], 'binding table-relative offset')
                if binding['rom_offset'] != table['rom_offset'] + relative:
                    raise ValueError('stale table-relative binding location')
                span(relative + prefix, TYPES.get(binding['type'], ('', 0))[1], prefix + capacity * stride, 'table-relative binding')
            if binding['role'] not in ('count', 'pointer', 'capacity', 'length_bytes'):
                raise ValueError('unsupported dependent binding')
            if binding['rom_offset'] < 0xc0:
                raise ValueError('dependent binding touches cartridge header')
            if binding['role'] == 'count' and binding['expected'] != len(table['rows']):
                raise ValueError('count binding disagrees with captured record count')
            if binding['role'] == 'pointer':
                addend = integer(binding.get('target_addend', 0), 'pointer addend')
                # Original captures may describe a known out-of-backing descriptor.
                # Expansion must resolve that defect inside declared fixed capacity.
                bound = max(capacity, table.get('expansion', {}).get('fixed_consumer_capacity', capacity)) * stride
                if binding['type'] != 'u32' or not -prefix <= addend < bound:
                    raise ValueError('pointer addend/type outside declared backing capacity')
                if binding['expected'] != 0x08000000 + table['rom_offset'] + addend:
                    raise ValueError('pointer binding does not reference captured backing')
            raw = encode(binding['expected'], binding['type'])
            span(binding['rom_offset'], len(raw), len(rom), 'binding')
            owner = next((a for a in allocations.values() if 'rom_offset' in a and a['rom_offset'] <= binding['rom_offset'] and binding['rom_offset'] + len(raw) <= a['rom_offset'] + a['size']), None)
            if owner is None or owner['kind'] != 'data':
                raise ValueError('dependent binding requires classified data allocation; instruction encoding unsupported')
            if rom[binding['rom_offset']:binding['rom_offset'] + len(raw)] != raw:
                raise ValueError('stale dependent binding')
    return allocations


def partition(manifest):
    """Expose uncovered ROM bytes; never infer semantic closure from ownership."""
    limit = manifest['rom']['size']
    intervals = sorted((a['rom_offset'], a['rom_offset'] + a['size'], a['id'])
                       for a in manifest.get('allocations', []) if 'rom_offset' in a)
    cursor, gaps = 0, []
    for start, end, ident in intervals:
        if start < cursor:
            raise ValueError(f'overlapping allocation: {ident}')
        if start > cursor:
            gaps.append({'rom_offset': cursor, 'size': start - cursor, 'kind': 'unclassified'})
        cursor = end
    if cursor < limit:
        gaps.append({'rom_offset': cursor, 'size': limit - cursor, 'kind': 'unclassified'})
    return {'unclassified_gaps': gaps, 'unclassified_gap_bytes': sum(x['size'] for x in gaps),
            'semantic_closure': 'unknown', 'hardware_spaces': copy.deepcopy(HARDWARE_SPACES)}


def validate_graphics(manifest, rom):
    """Resolve explicit ROM/table asset references; validate only declared consumers."""
    from .graphics_contracts import validate_graphics_contract, decode_palette
    tables = {table['id']: table for table in manifest.get('tables', [])}
    results = []
    for record in manifest.get('graphics_contracts', []):
        assets = {}
        for name, ref in record['assets'].items():
            if 'table' in ref:
                table = tables[ref['table']]
                first = ref.get('row_start', 0)
                count = ref.get('row_count', len(table['rows']) - first)
                span(first, count, len(table['rows']), 'graphics rows')
                offset, size = table['rom_offset'] + first * table['stride'], count * table['stride']
            else:
                offset, size = ref['rom_offset'], ref['size']
            span(offset, size, len(rom), 'graphics asset')
            assets[name] = bytes(rom[offset:offset + size])
        if record['contract']['kind'] == 'gba-palette/1':
            colors = decode_palette(assets[record['contract']['palette']])
            results.append({'id': record['contract']['id'], 'status': 'passed', 'colors': len(colors),
                            'visual_appearance_verified': False})
        else:
            results.append(validate_graphics_contract(record['contract'], assets))
    return results


def compile_edit(manifest, rom, request):
    """Plan and emit guarded ROM, captured byte-layout IR and standalone C bytes.

    Relocation is available only inside an explicit hash-bound free region and
    complete declared reference closure. Hardware RAM never expands implicitly.
    """
    validate_manifest(manifest, rom)
    if request.get('manifest_sha256') != sha(canonical(manifest)):
        raise ValueError('stale manifest identity')
    if not request.get('operations'):
        raise ValueError('no property operations')
    result = copy.deepcopy(manifest)
    tables = {table['id']: table for table in result['tables']}
    changed, old_counts = set(), {key: len(value['rows']) for key, value in tables.items()}
    for operation in request['operations']:
        ident = operation['table']
        if ident not in tables:
            raise ValueError(f'unknown table: {ident}')
        table = tables[ident]
        if operation['op'] == 'set':
            index = integer(operation['index'], 'row index')
            if not 0 <= index < len(table['rows']):
                raise ValueError('row index outside table')
            fields = {field['name']: field for field in table['fields']}
            if operation['field'] not in fields:
                raise ValueError('unknown property')
            encode(operation['value'], fields[operation['field']]['type'])
            table['rows'][index][operation['field']] = operation['value']
        elif operation['op'] == 'append':
            expected = {field['name'] for field in table['fields']}
            if set(operation['row']) != expected:
                raise ValueError('append requires all captured properties')
            for field in table['fields']:
                encode(operation['row'][field['name']], field['type'])
            table['rows'].append(copy.deepcopy(operation['row']))
        else:
            raise ValueError('unsupported property operation')
        changed.add(ident)
    for table in tables.values():
        for row in table['rows']:
            for field in table['fields']:
                value = row[field['name']]
                validate_property(field, value)
                if 'references_table' in field:
                    target = tables.get(field['references_table'])
                    if target is None or not 0 <= value < len(target['rows']):
                        raise ValueError('property references absent backing row')
        validate_termination(table)
    writes = []
    output_limit = len(rom)
    extension_fill = 255
    def write(offset, after, reason):
        span(offset, len(after), output_limit, reason)
        for previous in writes:
            if offset < previous['rom_offset'] + previous['size'] and previous['rom_offset'] < offset + len(after):
                raise ValueError('overlapping generated writes')
        writes.append({'rom_offset': offset, 'size': len(after), 'before_sha256': sha(rom[offset:offset + len(after)]),
                       'after_sha256': sha(after), 'after_hex': after.hex(), 'reason': reason})
    generated = []
    for ident in sorted(changed):
        table = tables[ident]
        count, old_count, stride = len(table['rows']), old_counts[ident], table['stride']
        old_offset, old_capacity = table['rom_offset'], table['capacity']
        prefix = table.get('backing_prefix_size', 0)
        data = bytearray(rom[old_offset - prefix:old_offset + old_capacity * stride])
        growing = count != old_count
        if growing:
            expansion = table.get('expansion', {})
            if expansion.get('status') != 'closed' or expansion.get('reference_closure') != 'complete':
                raise ValueError(f'{ident}: expansion blocked: ' + expansion.get('reason', 'unknown consumers'))
            if not expansion.get('closure_evidence'):
                raise ValueError('expansion requires captured consumer closure evidence')
            fixed = expansion.get('fixed_consumer_capacity')
            if fixed is not None and count > integer(fixed, 'fixed consumer capacity'):
                raise ValueError('expanded rows exceed fixed consumer capacity')
            if fixed is None and not expansion.get('sentinel_termination') and not any(binding['role'] == 'count' for binding in table.get('bindings', [])):
                raise ValueError('expansion requires explicit count consumer binding or captured sentinel termination')
            if count > old_capacity:
                region = expansion.get('free_region', {})
                offset, size = region.get('rom_offset', -1), region.get('size', 0)
                if region.get('mode') == 'rom_extension':
                    if offset != len(rom) or output_limit != len(rom):
                        raise ValueError('extension must begin exactly at ROM end; one extension per edit')
                    span(offset, size, 0x2000000, 'GBA ROM extension')
                    if region.get('expected_sha256') != sha(b''):
                        raise ValueError('extension requires empty baseline digest')
                    extension_fill = region.get('fill', 255)
                    encode(extension_fill, 'u8')
                    output_limit = offset + size
                else:
                    span(offset, size, len(rom), 'relocation region')
                if offset < 0xc0:
                    raise ValueError('relocation into cartridge header forbidden')
                for allocation in result['allocations']:
                    if 'rom_offset' in allocation and offset < allocation['rom_offset'] + allocation['size'] and allocation['rom_offset'] < offset + size:
                        raise ValueError('relocation overlaps owned allocation')
                if size < prefix + count * stride or (offset + prefix) % table.get('alignment', 4):
                    raise ValueError('relocation capacity/alignment insufficient')
                if sha(rom[offset:offset + size]) != region.get('expected_sha256'):
                    raise ValueError('stale relocation region')
                if offset < old_offset + old_capacity * stride and old_offset - prefix < offset + size:
                    raise ValueError('relocation overlaps original table')
                if not any(binding['role'] == 'pointer' for binding in table.get('bindings', [])):
                    raise ValueError('relocation requires pointer consumer bindings')
                # Tail bytes remain explicit captured free-region bytes.
                data = bytearray(bytes([extension_fill]) * size if region.get('mode') == 'rom_extension' else rom[offset:offset + size])
                data[:prefix + old_capacity * stride] = rom[old_offset - prefix:old_offset + old_capacity * stride]
                table['rom_offset'], table['capacity'] = offset + prefix, (size - prefix) // stride
                data = data[:prefix + table['capacity'] * stride]
                # Relocation updates only the declared allocation; source provenance stays immutable.
                allocation = next(a for a in result['allocations'] if a['id'] == table['allocation_id'])
                original_allocation = copy.deepcopy(allocation)
                original_allocation['id'] += f':retained-before-relocation:{old_offset - prefix:x}'
                original_allocation['kind'] = 'unclassified'
                original_allocation['reason'] = 'retained old table; ownership after relocation unresolved'
                result['allocations'].append(original_allocation)
                allocation['rom_offset'], allocation['size'] = offset, len(data)
        for index, row in enumerate(table['rows']):
            for field in table['fields']:
                raw = encode(row[field['name']], field['type'])
                pos = prefix + index * stride + field['offset']
                data[pos:pos + len(raw)] = raw
        table['snapshot_hex'] = bytes(data[prefix:]).hex()
        binding_writes = []
        for binding in table.get('bindings', []):
            value = {'count': count, 'capacity': table['capacity'], 'length_bytes': count * stride,
                     'pointer': 0x08000000 + table['rom_offset'] + binding.get('target_addend', 0)}[binding['role']]
            # Scalar edits do not reinterpret bindings whose lengths include sentinel/padding.
            if not growing:
                continue
            if binding['role'] == 'pointer' and not -prefix <= binding.get('target_addend', 0) < len(data) - prefix:
                raise ValueError('generated pointer outside expanded backing')
            if 'table_relative_offset' in binding:
                binding['rom_offset'] = table['rom_offset'] + binding['table_relative_offset']
                position = prefix + binding['table_relative_offset']
                raw = encode(value, binding['type'])
                # Prefix dependencies and row properties cannot silently disagree.
                if position < prefix and position + len(raw) > prefix:
                    raise ValueError('binding straddles backing prefix and row data')
                if position >= prefix and data[position:position + len(raw)] != raw:
                    raise ValueError('table-relative binding conflicts with typed row properties')
                data[position:position + len(raw)] = raw
            else:
                binding_writes.append((binding['rom_offset'], encode(value, binding['type']), f"{ident}: dependent {binding['role']}"))
            binding['expected'] = value
        write(table['rom_offset'] - prefix, bytes(data), f'{ident}: typed property table and relative dependencies')
        for binding_write in binding_writes:
            write(*binding_write)
        symbol = table.get('symbol', ident)
        if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', symbol):
            raise ValueError('generated C symbol is not a C identifier')
        generated.append({'table': ident, 'symbol': symbol, 'bytes_hex': bytes(data).hex(),
                          'rom_offset': table['rom_offset'], 'backing_rom_offset': table['rom_offset'] - prefix, 'backing_prefix_size': prefix, 'rows': table['rows'], 'fields': table['fields'],
                          'stride': stride, 'count': count, 'capacity': table['capacity'],
                          'original_placement': {'rom_offset': old_offset, 'capacity': old_capacity, 'count': old_count},
                          'relocation': {'changed': old_offset != table['rom_offset'], 'target_allocation': table['allocation_id']},
                          'references': [dict(binding, target_table=ident, expression=(f'rom_address({ident}) + {binding.get("target_addend", 0)}' if binding['role'] == 'pointer' else f'{binding["role"]}({ident})')) for binding in table.get('bindings', [])],
                          'constraints': table.get('expansion', {}), 'semantic': table.get('semantic', {}),
                          'source': next(a.get('source') for a in result['allocations'] if a['id'] == table['allocation_id'])})
    output = bytearray(rom) + bytearray([extension_fill]) * (output_limit - len(rom))
    for change in writes:
        output[change['rom_offset']:change['rom_offset'] + change['size']] = bytes.fromhex(change['after_hex'])
    result.setdefault('baseline_rom_provenance', copy.deepcopy(manifest['rom']))
    result['source_provenance_scope'] = 'captured baseline source/ELF; candidate is generated byte-layout data, not a rebuilt ELF'
    result['rom']['sha256'] = sha(output)
    if 'sha1' in result['rom']:
        result['rom']['sha1'] = hashlib.sha1(output).hexdigest()
    for allocation in result['allocations']:
        if 'rom_offset' in allocation and 'sha256' in allocation:
            allocation.setdefault('baseline_sha256', allocation['sha256'])
            allocation['sha256'] = sha(output[allocation['rom_offset']:allocation['rom_offset'] + allocation['size']])
    result['rom']['size'] = len(output)
    result['parent_manifest_sha256'] = sha(canonical(manifest))
    result['last_request_sha256'] = sha(canonical(request))
    graphics_checks = validate_graphics(result, output)
    # Revalidate generated table/binding layout against actual emitted ROM.
    validate_manifest(result, output)
    ir = {'schema': 'gameverse.gba-property-ir/1', 'kind': 'typed-data-layout', 'behavior_ir': False,
          'input_manifest_sha256': sha(canonical(manifest)), 'request_sha256': sha(canonical(request)),
          'tables': generated, 'writes': writes, 'graphics_checks': graphics_checks, 'semantic_closure': 'unknown'}
    c_source = ['/* Generated captured data bytes; integration uses the recorded ROM writes. */', '#include <stdint.h>']
    for item in generated:
        raw = bytes.fromhex(item['bytes_hex'])
        c_source.append(f"const uint8_t {item['symbol']}[{len(raw)}] = {{")
        c_source.extend('  ' + ', '.join(f'0x{value:02x}' for value in raw[pos:pos + 16]) + ',' for pos in range(0, len(raw), 16))
        c_source.append('};')
    c_source.append('struct GameverseRomWrite { uint32_t offset; uint32_t size; const uint8_t *bytes; };')
    for index, change in enumerate(writes):
        values = ', '.join(f'0x{value:02x}' for value in bytes.fromhex(change['after_hex']))
        c_source.append(f'static const uint8_t gameverse_write_{index}[] = {{{values}}};')
    c_source.append(f'const struct GameverseRomWrite gameverse_rom_writes[{len(writes)}] = {{')
    c_source.extend(f'  {{0x{change["rom_offset"]:08x}, {change["size"]}, gameverse_write_{index}}},' for index, change in enumerate(writes))
    c_source.append('};')
    return {'manifest': result, 'ir': ir, 'rom': bytes(output), 'source': '\n'.join(c_source) + '\n'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--rom', required=True)
    parser.add_argument('--request', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    started, run_id = time.perf_counter(), str(uuid.uuid4())
    directory = Path(args.output)
    directory.mkdir(parents=True, exist_ok=False)
    receipt = {'schema': 'gameverse.gba-property-run/1', 'run_id': run_id, 'outcome': 'failed',
               'queue_seconds': None, 'build_seconds': None, 'simulation_seconds': None, 'evaluation_seconds': None,
               'attempts': 1, 'repairs': 0, 'cache': 'not-used', 'source_tree_read': False,
               'tool_version': 'gba-memory-ontology/1', 'environment': {'python': platform.python_version(), 'platform': platform.platform()}}
    try:
        manifest = json.loads(Path(args.manifest).read_text())
        request = json.loads(Path(args.request).read_text())
        receipt.update(game_id=manifest.get('game_id'), source_revision=manifest.get('source_revision'),
                       manifest_sha256=sha(canonical(manifest)), request_sha256=sha(canonical(request)))
        result = compile_edit(manifest, Path(args.rom).read_bytes(), request)
        (directory / 'candidate.gba').write_bytes(result['rom'])
        (directory / 'generated.c').write_text(result['source'])
        for key in ('manifest', 'ir'):
            (directory / (key + '.json')).write_text(json.dumps(result[key], indent=2) + '\n')
        receipt.update(outcome='emitted', output_rom_sha256=sha(result['rom']), writes=len(result['ir']['writes']),
                       proof_scope='typed byte-layout consistency only; native play unverified')
    except (ValueError, KeyError, TypeError, OSError) as exc:
        receipt['error'] = str(exc)
    finally:
        receipt['total_seconds'] = time.perf_counter() - started
        (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    return 0 if receipt['outcome'] == 'emitted' else 2


if __name__ == '__main__':
    raise SystemExit(main())
