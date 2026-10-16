"""Source-audited, opt-in bounded pointers loaded from entity argument cells.

Only adapter storage owns native addresses. This module recognizes original SSA
pointer provenance; it does not supply behavior, mutate the lifter, or erase calls.
"""
from copy import deepcopy
from lift import Unsupported


_FIELDS = {'id', 'cell_argument', 'cell_offset', 'cell_extent', 'target_extent',
           'readable_ranges', 'storage', 'separation', 'evidence'}
_LIMIT = 8192


def _integer(value, low, high):
    return type(value) is int and low <= value <= high


def validate_access(contract, start, size, is_write):
    """Check an entire nonwrapping target read, with no implicit readable gaps."""
    if is_write:
        raise Unsupported('entity reference target is readonly during call')
    if not _integer(start, 0, _LIMIT) or not _integer(size, 1, _LIMIT):
        raise Unsupported('entity reference access must have finite nonnegative bounds')
    end = start + size
    if end > contract['target_extent'] or end > 0xffffffff:
        raise Unsupported('entity reference access exceeds target extent')
    if not any(r['offset'] <= start and end <= r['offset'] + r['size']
               for r in contract['readable_ranges']):
        raise Unsupported('entity reference access outside readable ranges')
    return True


def _checked_contracts(argument_contract):
    raw = argument_contract.get('entity_references', [])
    if not isinstance(raw, list) or len(raw) > 1:
        raise Unsupported('entity reference contract budget is one')
    result = deepcopy(raw)
    names, cells = set(), set()
    for c in result:
        if not isinstance(c, dict) or set(c) != _FIELDS:
            raise Unsupported('entity reference contract fields mismatch')
        if not isinstance(c['id'], str) or not c['id'].isidentifier() or c['id'] in names:
            raise Unsupported('entity reference identity must be unique')
        names.add(c['id'])
        if c['cell_argument'] not in ('r0', 'r1', 'r2', 'r3'):
            raise Unsupported('entity reference cell argument ABI unsupported')
        if not _integer(c['cell_offset'], 0, _LIMIT - 4) or not _integer(c['cell_extent'], 4, _LIMIT) or c['cell_offset'] + 4 > c['cell_extent']:
            raise Unsupported('entity reference complete pointer cell must fit context extent')
        if not _integer(c['target_extent'], 1, _LIMIT):
            raise Unsupported('entity reference finite target extent required')
        if c['storage'] != 'readonly_during_call_ram' or c['separation'] != 'distinct_accessed_views':
            raise Unsupported('entity reference stable RAM and separation contract required')
        if not isinstance(c['evidence'], list) or not c['evidence'] or any(not isinstance(e, str) or not e.strip() for e in c['evidence']):
            raise Unsupported('entity reference source evidence required')
        ranges = c['readable_ranges']
        if not isinstance(ranges, list) or not ranges or len(ranges) > 32:
            raise Unsupported('entity reference readable range budget1..32')
        prior_end = -1
        for r in sorted(ranges, key=lambda r: r.get('offset', -1) if isinstance(r, dict) else -1):
            if not isinstance(r, dict) or set(r) != {'offset', 'size'} or not _integer(r['offset'], 0, _LIMIT) or not _integer(r['size'], 1, _LIMIT) or r['offset'] + r['size'] > c['target_extent']:
                raise Unsupported('entity reference readable range exceeds extent')
            if r['offset'] < prior_end:
                raise Unsupported('entity reference readable ranges overlap')
            prior_end = r['offset'] + r['size']
        cell = c['cell_argument'], c['cell_offset']
        if any(arg == cell[0] and off < cell[1] + 4 and cell[1] < off + 4 for arg, off in cells):
            raise Unsupported('entity reference pointer cells overlap')
        cells.add(cell)
    return result


def validate_contracts(l0, argument_contract):
    """Audit every original SSA consumer, including dead and unselected paths."""
    contracts = _checked_contracts(argument_contract)
    if not contracts:
        return []
    v = {z['id']: z for z in l0['varnodes']}
    ops = [o for b in l0['blocks'] for o in b['ops']]
    # Tags are (context argument or reference id, constant byte offset, is target).
    tags = {}
    contexts = {c['cell_argument']: c['cell_extent'] for c in contracts}
    for arg in contexts:
        if len({c['cell_extent'] for c in contracts if c['cell_argument'] == arg}) != 1:
            raise Unsupported('entity reference context extents disagree')
        roots = [z for z in v.values() if z.get('input') and z.get('space') == 'register' and z.get('register') == arg]
        if not roots or any(z['size'] != 4 for z in roots):
            raise Unsupported('entity reference original source argument must be32bits')
        tags.update({z['id']: (arg, 0, False) for z in roots})
    by_id = {c['id']: c for c in contracts}
    seen = set()

    def literal(key):
        z = v[key]
        if not z.get('constant') or z['size'] != 4:
            raise Unsupported('entity reference address requires original u32 constant')
        n = int(z['offset'])
        if not 0 <= n <= 0xffffffff:
            raise Unsupported('entity reference address constant outside u32')
        return n

    def derive(o):
        ins, opcode = o['inputs'], o['opcode']
        tagged = [i for i, key in enumerate(ins) if key in tags]
        if not tagged:
            return None
        out = o.get('output')
        if opcode in ('COPY', 'CAST') and len(ins) == 1:
            result = tags[ins[0]]
        elif opcode in ('INT_ADD', 'PTRSUB', 'PTRADD') and len(tagged) == 1:
            index = tagged[0]
            if opcode in ('PTRSUB', 'PTRADD') and index != 0:
                raise Unsupported('entity reference pointer must be address base')
            expected = 3 if opcode == 'PTRADD' else 2
            if len(ins) != expected:
                raise Unsupported('entity reference address arity invalid')
            delta = literal(ins[1-index]) if opcode != 'PTRADD' else literal(ins[1]) * literal(ins[2])
            owner, start, target = tags[ins[index]]
            extent = by_id[owner]['target_extent'] if target else contexts[owner]
            if delta > 0xffffffff or start + delta > extent:
                raise Unsupported('entity reference address wraps or exceeds extent')
            result = owner, start + delta, target
        elif opcode == 'LOAD' and tagged == [1] and len(ins) == 2:
            owner, start, target = tags[ins[1]]
            size = v[out]['size']
            if target:
                validate_access(by_id[owner], start, size, False)
                return None
            if start + size > contexts[owner]:
                raise Unsupported('entity reference context read exceeds extent')
            matches = [c for c in contracts if c['cell_argument'] == owner and c['cell_offset'] == start]
            if matches:
                if size != 4:
                    raise Unsupported('entity reference pointer cell load must be32bits')
                c = matches[0]
                seen.add(c['id'])
                result = c['id'], 0, True
            else:
                # Reading any part of a cell numerically would leak its address.
                if any(c['cell_argument'] == owner and start < c['cell_offset'] + 4 and c['cell_offset'] < start + size for c in contracts):
                    raise Unsupported('entity reference pointer cell scalar read')
                return None
        elif opcode == 'STORE' and tagged == [1] and len(ins) == 3:
            owner, start, target = tags[ins[1]]
            size = v[ins[2]]['size']
            if target:
                validate_access(by_id[owner], start, size, True)
            if start + size > contexts[owner] or any(c['cell_argument'] == owner and start < c['cell_offset'] + 4 and c['cell_offset'] < start + size for c in contracts):
                raise Unsupported('entity reference pointer cell write or context extent violation')
            return None
        else:
            raise Unsupported('entity reference unsupported pointer use ' + opcode + ' at ' + o['id'])
        if not out or v[out]['size'] != 4 or any(v[ins[i]]['size'] != 4 for i in tagged):
            raise Unsupported('entity reference original source pointer must be32bits')
        return result

    # Monotone provenance propagation does not assume source list/CFG order.
    changed = True
    while changed:
        changed = False
        for o in ops:
            result = derive(o)
            if result is not None:
                out = o['output']
                if out in tags and tags[out] != result:
                    raise Unsupported('entity reference conflicting source provenance')
                if out not in tags:
                    tags[out] = result
                    changed = True
    if seen != set(by_id):
        raise Unsupported('entity reference lacks exact original source cell load')
    return contracts


def resolve(lifter, sourceptrtuple, loadop):
    """Return a named descriptor for an exact audited pointer-cell LOAD only."""
    if sourceptrtuple[0] != 'entity' or sourceptrtuple[2].get('op') != 'const':
        return None
    contracts = getattr(lifter, 'entity_reference_contracts', None)
    if contracts is None:
        contracts = validate_contracts(lifter.l0, lifter.argument_contract)
    for c in contracts:
        if sourceptrtuple[1] == c['cell_argument'] and sourceptrtuple[2]['value'] == c['cell_offset']:
            if loadop['opcode'] != 'LOAD' or lifter.v[loadop['output']]['size'] != 4:
                raise Unsupported('entity reference pointer cell load must be32bits')
            return c['id'], deepcopy(c)
    return None


def validate_adapter(adapter):
    """Recheck standalone adapter descriptors without trusting an L0 sidecar."""
    contracts = _checked_contracts(adapter.get('argument_contract', {}))
    refs = adapter.get('entity_references', [])
    if not isinstance(refs, list) or len(refs) != len(contracts):
        raise Unsupported('entity reference adapter descriptors mismatch')
    if not contracts:
        return []
    if adapter.get('object_references'):
        raise Unsupported('entity and global object references cannot coexist')
    by_name = {}
    for ref, c in zip(refs, contracts):
        if not isinstance(ref, dict) or ref != dict(c, name=c['id']):
            raise Unsupported('entity reference adapter descriptor differs from contract')
        by_name[ref['name']] = c
    for f in adapter.get('fields', []):
        if f.get('owner') == 'reference':
            c = by_name.get(f.get('reference'))
            if c is None or not _integer(f.get('width'), 8, 64) or f['width'] not in (8, 16, 32, 64):
                raise Unsupported('entity reference adapter field invalid')
            validate_access(c, f.get('offset'), f['width'] // 8, False)
        if f.get('owner') == 'entity':
            for c in contracts:
                if f.get('argument') != c['cell_argument']:
                    continue
                start, width = f.get('offset'), f.get('width')
                if not _integer(start, 0, _LIMIT) or width not in (8, 16, 32, 64) or start + width // 8 > c['cell_extent']:
                    raise Unsupported('entity reference adapter context field extent invalid')
                if start < c['cell_offset'] + 4 and c['cell_offset'] < start + width // 8:
                    raise Unsupported('entity reference pointer cell overlaps scalar field')
    for z in adapter.get('collections', []):
        if z.get('owner') == 'reference' or z.get('reference') in by_name:
            raise Unsupported('entity reference target collections unsupported')
        for c in contracts:
            if z.get('owner') != 'entity' or z.get('argument') != c['cell_argument']:
                continue
            start, size, count = z.get('offset'), z.get('size'), z.get('count')
            stride = z.get('stride', size)
            if not all(_integer(n, 1, _LIMIT) for n in (size, count, stride)) or not _integer(start, 0, _LIMIT):
                raise Unsupported('entity reference context collection extent invalid')
            end = start + stride * (count - 1) + size
            if end > c['cell_extent'] or start < c['cell_offset'] + 4 and c['cell_offset'] < end:
                raise Unsupported('entity reference pointer cell overlaps context collection')
    return contracts
