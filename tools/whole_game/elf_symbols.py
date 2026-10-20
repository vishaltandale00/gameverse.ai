"""Read exact ELF32 little-endian source symbol bounds without dependencies."""
from pathlib import Path
import struct


def symbols(path, *, detailed=False, _wanted=None):
    """Index symbol bounds once; retain duplicates so callers reject ambiguity."""
    raw = Path(path).read_bytes()
    if raw[:6] != b'\x7fELF\x01\x01':
        raise ValueError('expected_elf32_little_endian')
    offset = struct.unpack_from('<I', raw, 32)[0]
    stride, count = struct.unpack_from('<HH', raw, 46)
    sections = [struct.unpack_from('<10I', raw, offset + i * stride) for i in range(count)]
    found = {}
    for section in sections:
        if section[1] != 2:
            continue
        strings = sections[section[6]]
        names = raw[strings[4]:strings[4] + strings[5]]
        for at in range(section[4], section[4] + section[5], section[9]):
            name, address, size = struct.unpack_from('<III', raw, at)
            end = names.find(b'\0', name)
            label = names[name:end].decode('ascii', errors='replace')
            if _wanted is not None and label != _wanted:
                continue
            value = (address, size)
            if detailed:
                info, _, section_index = struct.unpack_from('<BBH', raw, at + 12)
                owner = sections[section_index] if 0 < section_index < len(sections) else None
                value = {'address': address, 'size': size, 'type': info & 15, 'section': section_index,
                         'sectionAddress': owner[3] if owner else None, 'sectionSize': owner[5] if owner else None,
                         'sectionFlags': owner[2] if owner else None, 'sectionType': owner[1] if owner else None}
            found.setdefault(label, []).append(value)
    return found


def symbol(path, wanted):
    found = symbols(path, _wanted=wanted).get(wanted, [])
    if len(found) != 1:
        raise ValueError('missing_or_ambiguous_source_symbol')
    return found[0]
