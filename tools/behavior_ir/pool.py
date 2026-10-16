"""Canonical typed record lanes for evidenced actor/world aliases.
Machine record layout is used only here and in the native validation adapter.
Executable L1 contains lane collections and bounded record handles.
"""
from lift import Unsupported, const, typ


def canonicalize(lifter):
    claimed_roots = set()
    for view in lifter.argument_contract.get('shared_views', []):
        if view.get('representation') != 'canonical_typed_pool':
            continue
        if view.get('base_offset',0):raise Unsupported('canonical pool nonzero base offset unsupported')
        count, stride = view['count'], view['stride']
        if not view.get('evidence') or not 1 <= count <= 64 or not 1 <= stride <= 4096:
            raise Unsupported('canonical pool domain or evidence missing')
        reference = lifter.object_refs.get(int(view['root_cell'], 16))
        if reference is None:
            raise Unsupported('canonical pool root unresolved')
        if reference in claimed_roots:
            raise Unsupported('multiple canonical handles require joint lane partition')
        claimed_roots.add(reference)
        entity = ('entity', view['argument'])
        world = ('reference', reference)
        if any(c.get('reference') == reference or c.get('argument') == view['argument']
               for c in lifter.collections.values()):
            raise Unsupported('canonical pool dynamic collection needs record-index proof')
        accesses = []
        for key, (kind, owner, start, size) in lifter.access.items():
            if kind != 'state':
                continue
            world_start = start - (1 << 32) if start >= 1 << 31 else start
            if owner == world and world_start < 0 < world_start + size:
                raise Unsupported('canonical pool access straddles backing boundary')
            if owner == entity:
                index, lane = None, start
            elif owner == world and 0 <= start < count * stride:
                index, lane = divmod(start, stride)
            else:
                continue
            if not 0 <= lane < lane + size <= stride:
                raise Unsupported('canonical pool access escapes record')
            if lifter.state_domain(owner, start):
                raise Unsupported('canonical pool lane domain propagation unresolved')
            if key.startswith('call/'):
                raise Unsupported('canonical pool callee lane binding unresolved')
            accesses.append((key, index, lane, size))
        if not accesses:
            continue
        if any(owner == entity and kind == 'state' for kind, owner, _, _ in lifter.access.values()):
            name = 'record_handle_' + view['argument']
            lifter.params['pool/' + view['argument']] = {
                'name': name, 'type': 'u32', 'register': view['argument'],
                'domain': {'unsigned_min': 0, 'unsigned_max': count - 1},
                'derived_pool_slot': True,
            }
        boundaries = sorted({x for _, _, lane, size in accesses for x in (lane, lane + size)})
        lanes = []
        for lo, hi in zip(boundaries, boundaries[1:]):
            if not any(lane <= lo < hi <= lane + size for _, _, lane, size in accesses):
                continue
            typ(hi - lo)  # Reject an irregular partition rather than pad/copy it.
            key = ('pool', reference, lo, hi - lo)
            collection = dict(name='pool_lane_' + str(len(lifter.collections)),
                              size=hi - lo, count=count, refs=[], address=None,
                              owner='reference', argument=None, reference=reference,
                              offset=lo, stride=stride, canonical_pool=True)
            lifter.collections[key] = collection
            lanes.append((lo, hi, key))
        for key, index, lane, size in accesses:
            handle = ({'op': 'parameter', 'type': 'u32', 'name': name}
                      if index is None else const(index))
            pieces = [(lo - lane, hi - lo, lane_key) for lo, hi, lane_key in lanes
                      if lane <= lo < hi <= lane + size]
            for _, _, lane_key in pieces:
                lifter.collections[lane_key]['refs'].append(key)
            lifter.access[key] = ('pool', pieces, handle, size)
        lifter.canonical_pool_arguments.add(view['argument'])
