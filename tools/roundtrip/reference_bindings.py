"""Mechanical scalar storage binding for explicitly authorized object references.

This is a binding generator, not a pointer discovery or source-proof engine.
Invalid runtime objects call the required observable rejection callback before
returning without committing state. Source allocation/lifetime proof is required.
"""
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[2]
RAM = ((0x02000000, 0x02040000), (0x03000000, 0x03008000))


def _ram(start, end):
    return any(lo <= start < end <= hi for lo, hi in RAM)


def binding(adapter, label):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', label):
        raise ValueError('Unsafe binding label')
    authority = adapter.get('reference_binding_authority', {})
    if (authority.get('schema') != 'gameverse.reference-binding-authority/1'
            or authority.get('stable_for_invocation') is not True
            or authority.get('distinct_owned_objects') is not True):
        raise ValueError('Explicit reference authority and lifetime assumptions required')
    evidence = authority.get('evidence', [])
    if not evidence:
        raise ValueError('Pinned reference source evidence required')
    for row in evidence:
        path = (ROOT / row['path']).resolve()
        if not path.is_relative_to(ROOT) or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Stale or external reference authority evidence')
    refs = adapter.get('object_references', [])
    declared = authority.get('references', [])
    if not refs or len({r['name'] for r in refs}) != len(refs) or len(declared) != len(refs):
        raise ValueError('Unresolved or duplicate reference inventory')
    by_name = {r['name']: r for r in declared}
    if len(by_name) != len(declared):
        raise ValueError('Duplicate reference authorities')
    cells = set()
    for ref in refs:
        row = by_name.get(ref['name'], {})
        cell = ref['cell']
        if (not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', ref['name'])
                or not isinstance(ref.get('identity'), str) or not ref['identity'].strip()
                or row.get('cell') != cell or row.get('identity') != ref.get('identity')
                or row.get('alignment') != 4 or type(row.get('allocation_bytes')) is not int
                or not 0 < row['allocation_bytes'] <= 16384
                or row.get('source_evidence') not in evidence or type(cell) is not int
                or cell % 4 or not _ram(cell, cell+4) or cell in cells
                or ref.get('lifetime') != 'stable_for_invocation'
                or ref.get('alias_contract') != 'distinct_owned_object'):
            raise ValueError('Reference authority does not match canonical pointer cell')
        cells.add(cell)
    if adapter.get('collections') or adapter.get('entity_references'):
        raise ValueError('Reference binder supports scalar object fields only')
    spans = []
    for field in adapter['fields']:
        name, width, offset = field['name'], field['width'], field['offset']
        if (not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name)
                or field['owner'] != 'reference' or field.get('reference') not in by_name
                or width not in (8, 16, 32) or type(offset) is not int
                or offset < 0 or offset+width//8 > by_name.get(field.get('reference'), {}).get('allocation_bytes', 0) or offset % (width//8)):
            raise ValueError('Unsupported or unaligned reference scalar')
        span = (field['reference'], offset, offset+width//8)
        if any(span[0] == r and span[1] < hi and lo < span[2] for r, lo, hi in spans):
            raise ValueError('Overlapping projected scalar spans')
        spans.append(span)
    if not spans:
        raise ValueError('Empty reference projection')
    ret = adapter['return_type']
    if ret not in ('void', 'u8', 'u16', 'u32'):
        raise ValueError('Unsupported reference return ABI')
    c_ret = 'void' if ret == 'void' else 'uint32_t'
    reject = 'reference_binding_reject(1u);' + ('return;' if ret == 'void' else 'return 0;')
    guards, loads, stores = [], [], []
    lines = ['\nextern void reference_binding_reject(uint32_t code);', f'{c_ret} native_{label}(uint32_t r0,uint32_t r1,uint32_t r2,uint32_t r3){{']
    for ref in refs:
        lines.append(f"uint32_t {ref['name']}=*(volatile uint32_t*)0x{ref['cell']:x}u;")
        size = by_name[ref['name']]['allocation_bytes']
        name = ref['name']
        guards.append('(' + '||'.join(f'({name}>=0x{start:x}u&&{name}<=0x{end-size:x}u)' for start, end in RAM) + ')')
        guards.append(f'({name}%4u==0)')
        for cell in cells:
            guards.append(f'({name}+{size}u<=0x{cell:x}u||0x{cell+4:x}u<={name})')
    for i, ref in enumerate(refs):
        for other in refs[:i]:
            name, peer = ref['name'], other['name']
            size, other_size = by_name[name]['allocation_bytes'], by_name[peer]['allocation_bytes']
            guards.append(f'({name}+{size}u<={peer}||{peer}+{other_size}u<={name})')
    for field, (ref, lo, hi) in zip(adapter['fields'], spans):
        # Bound the base before adding offsets, avoiding wrapping-address checks.
        guards.append('(' + '||'.join(f'({ref}>=0x{start:x}u&&{ref}<=0x{end-hi:x}u)' for start, end in RAM) + ')')
        guards.append(f'(({ref}+{lo}u)%{field["width"]//8}u==0)')
        for cell in cells:
            guards.append(f'({ref}+{hi}u<=0x{cell:x}u||0x{cell+4:x}u<={ref}+{lo}u)')
        location = f'*(volatile uint{field["width"]}_t*)({ref}+{lo}u)'
        loads.append(f's.{field["name"]}={location};')
        stores.append(f'{location}=s.{field["name"]};')
    for i, (ref, lo, hi) in enumerate(spans):
        for other, start, end in spans[:i]:
            if ref != other:
                guards.append(f'({ref}+{hi}u<={other}+{start}u||{other}+{end}u<={ref}+{lo}u)')
    lines += ['if(!('+'&&'.join(guards)+')){'+reject+'}', f'State_{label} s;', *loads]
    args = []
    for parameter in adapter['parameters']:
        register = parameter['register']
        if register not in ('r0', 'r1', 'r2', 'r3'):
            raise ValueError('Unsupported argument register')
        args.append(','+register)
    lines.append(('' if ret == 'void' else 'uint32_t result=')+f'lifted_{label}(&s'+''.join(args)+');')
    unchanged = '&&'.join(f"*(volatile uint32_t*)0x{r['cell']:x}u=={r['name']}" for r in refs)
    lines += ['if(!('+unchanged+')){'+reject+'}', *stores, 'return;' if ret == 'void' else 'return result;', '}\n']
    return '\n'.join(lines)
