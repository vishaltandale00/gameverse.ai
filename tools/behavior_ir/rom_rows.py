"""Address-free lowering of bounded immutable ROM pointer-row reads.

The original table bytes choose each row. Only byte reads whose complete finite
row range is present in the same ROM are admitted; no RAM or callback identity is
converted. Native addresses remain adapter provenance, never portable asset data.
"""
import hashlib


def aligned(expression, width):
    if width == 1:
        return True
    if expression.get('type') != 'u32':
        return False
    op, args = expression['op'], expression.get('args', [])
    if op == 'const':
        return expression['value'] % width == 0
    if op == 'add_wrap':
        return all(aligned(x, width) for x in args)
    if op == 'mul_wrap':
        return any(aligned(x, width) for x in args)
    if op == 'shift_left' and args[1]['op'] == 'const':
        return args[1]['value'] < 32 and (1 << args[1]['value']) % width == 0
    return False


def table(lifter, source, operation):
    """Recognize the source u32 LOAD as a bounded table of immutable data rows."""
    from lift import Unsupported
    if source[0] != 'asset':
        return None
    if lifter.v[operation['output']]['size'] != 4:
        raise Unsupported('ROM row pointer load must be32bits')
    lo, hi = lifter.bounds(source[2])
    if not 0 <= lo <= hi <= 1020 or lo % 4 or hi % 4 or (lo != hi and not aligned(source[2], 4)):
        raise Unsupported('ROM pointer table index is not bounded aligned256entries')
    first = source[1] + lo
    count = (hi - lo) // 4 + 1
    if first % 4 or not 0x08000000 <= first <= 0x08000000 + len(lifter.rom) - count * 4:
        raise Unsupported('ROM pointer table span outside source ROM')
    raw = lifter.rom[first - 0x08000000:first - 0x08000000 + count * 4]
    targets = [int.from_bytes(raw[i:i + 4], 'little') for i in range(0, len(raw), 4)]
    if any(not 0x08000000 <= address < 0x08000000 + len(lifter.rom) for address in targets):
        raise Unsupported('ROM pointer table includes mutable or unresolved target')
    unique = list(dict.fromkeys(targets))
    from lift import const, node
    index = source[2]
    if lo:
        index = node('sub_wrap', 'u32', index, const(lo))
    index = node('shift_right', 'u32', index, const(2))
    key = (first, count)
    descriptor = {'table': first, 'count': count, 'targets': targets, 'unique': unique,
                  'selector': index, 'table_sha256': hashlib.sha256(raw).hexdigest(),
                  'source_load': operation['id']}
    # The selector expression is invocation-specific, even when source table is
    # shared. Keep it in the pointer descriptor rather than a global registry.
    return descriptor


def access(lifter, descriptor, offset, size, is_write, operation):
    """Materialize a dense ordinal asset and exact ROM row byte copies."""
    from lift import Unsupported, const, node
    if is_write or size != 1:
        raise Unsupported('ROM row lowering supports readonly byte accesses only')
    lo, hi = lifter.bounds(offset)
    if not 0 <= lo <= hi < 4096:
        raise Unsupported('ROM row byte index exceeds bounded4096byte extent')
    extent = hi + 1
    addresses = descriptor['unique']
    if len(addresses) * extent > 65536:
        raise Unsupported('ROM row assets exceed65536byte static budget')
    if any(address - 0x08000000 + extent > len(lifter.rom) for address in addresses):
        raise Unsupported('ROM row complete access span outside source ROM')
    ordinal = {address: i for i, address in enumerate(addresses)}
    mapping = [ordinal[address] for address in descriptor['targets']]
    table_key = ('rom_row_ordinals', descriptor['table'], descriptor['count'])
    data_key = ('rom_row_bytes', descriptor['table'], descriptor['count'], extent)
    retained=sum(len(a['derived_data'])for a in lifter.assets.values()if 'derived_data'in a)
    added=(0 if table_key in lifter.assets else len(mapping))+(0 if data_key in lifter.assets else len(addresses)*extent)
    if retained+added>65536:
        raise Unsupported('ROM row aggregate derived assets exceed65536byte static budget')
    def asset(key, data, provenance, value_range=None):
        if key not in lifter.assets:
            lifter.assets[key] = {'name': 'asset_' + str(len(lifter.assets)), 'start': None,
                                  'width': 1, 'end': len(data), 'derived_data': data,
                                  'refs': [provenance], 'value_range': value_range,
                                  'derivation': 'immutable_rom_pointer_rows'}
        return lifter.assets[key]
    map_asset = asset(table_key, mapping, descriptor['source_load'], (0, len(addresses) - 1))
    data = [byte for address in addresses for byte in lifter.rom[address - 0x08000000:address - 0x08000000 + extent]]
    data_asset = asset(data_key, data, operation['id'])
    selected = {'op': 'asset_read', 'type': 'u8', 'asset': map_asset['name'],
                'index': descriptor['selector'], 'provenance': descriptor['source_load']}
    index = node('add_wrap', 'u32', node('mul_wrap', 'u32', node('zext', 'u32', selected), const(extent)), offset)
    lifter.assumptions.append({'kind': 'immutable_rom_pointer_rows', 'provenance': operation['id'],
                              'table': descriptor['table'], 'entries': descriptor['count'],
                              'table_sha256': descriptor['table_sha256'], 'row_extent': extent,
                              'rows': [{'address': address, 'sha256': hashlib.sha256(lifter.rom[address - 0x08000000:address - 0x08000000 + extent]).hexdigest()} for address in addresses],
                              'lowering': 'source table ordinals select deduplicated immutable row bytes; pointer values not exposed'})
    return ('asset', data_key, index, 1)
