"""Prove a narrowly declared ARM caller discards a callee's r0 value.

This licenses a state-effects projection, never an invented return value.
"""
import hashlib


def prove(l0, rom, context):
    if context.get('kind') != 'caller_ignored_r0':
        raise ValueError('unsupported return projection')
    call = int(context['callsite'], 16)
    following = int(context['next_callsite'], 16)
    if following != call + 4 or call % 4:
        raise ValueError('ignored return requires adjacent aligned ARM calls')

    def word(pc):
        offset = pc - 0x08000000
        if pc % 4 or not 0 <= offset <= len(rom) - 4:
            raise ValueError('ignored-return proof outside aligned ROM')
        return int.from_bytes(rom[offset:offset + 4], 'little')

    def target(pc):
        instruction = word(pc)
        if instruction >> 24 != 0xeb:
            raise ValueError('ignored return requires unconditional ARM BL')
        displacement = instruction & 0xffffff
        if displacement & 0x800000:
            displacement -= 0x1000000
        return (pc + 8 + displacement * 4) & 0xffffffff

    if target(call) != int(l0['entry'], 16):
        raise ValueError('ignored-return caller targets another entry')
    next_entry = target(following)
    # This exact prefix neither reads r0 nor branches before overwriting it.
    if word(next_entry) != 0xe92d4000:
        raise ValueError('next callee lacks supported r0-independent prologue')
    load = word(next_entry + 4)
    if load & 0xfffff000 != 0xe59f0000:
        raise ValueError('next callee does not unconditionally overwrite r0')
    literal = next_entry + 12 + (load & 0xfff)
    word(literal)

    def span(pc, size):
        data = rom[pc - 0x08000000:pc - 0x08000000 + size]
        return {'address': f'{pc:08x}', 'size': size,
                'sha256': hashlib.sha256(data).hexdigest()}

    return {'kind': 'caller_scoped_state_effects_projection',
            'return_semantics': 'unavailable_original_r0_discarded_by_declared_caller',
            'callsite': f'{call:08x}', 'next_entry': f'{next_entry:08x}',
            'spans': [span(call, 8), span(next_entry, 8), span(literal, 4)],
            'basis': 'Adjacent unconditional ARM BLs; next entry saves LR only then loads ROM literal into r0 before any r0 read',
            'limitations': ['No allocator result or full original function ABI claim',
                            'All memory and declared register liveouts remain required']}
