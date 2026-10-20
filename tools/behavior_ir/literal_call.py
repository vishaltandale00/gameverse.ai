"""Bounded original-Thumb proof for a literal-register BL/BX veneer.

This is source evidence only. It does not rewrite HighFunction arguments, infer
pointer arguments, qualify callees, or fabricate a return. Preceding direct
calls are modeled under the explicitly reported standard AAPCS assumption.
"""
import hashlib

from returnproof import Unproven

BASE = 0x08000000


def prove_literal_call(l0, rom, call_pc, veneer_entry, register, expected_target,
                       max_states=8192, max_span=65536):
    def address(value):
        return int(value, 16) if isinstance(value, str) else value
    entry, call_pc, veneer_entry, expected_target = map(
        address, (l0['entry'], call_pc, veneer_entry, expected_target))
    if isinstance(register, str):
        register = int(register.removeprefix('r'))
    if not 0 <= register <= 12 or max_states <= 0 or max_span <= 0:
        raise Unproven('literal call register/budget unsupported')
    if any(pc & 1 or not BASE <= pc < BASE + len(rom)
           for pc in (entry, call_pc, veneer_entry)):
        raise Unproven('literal call entry outside aligned ROM')
    if not expected_target & 1 or not BASE <= expected_target - 1 < BASE + len(rom):
        raise Unproven('literal call expected target must be own-ROM Thumb address')
    if not entry <= call_pc < entry + max_span:
        raise Unproven('literal call span budget')
    evidence = {}

    def read(pc, width):
        if not BASE <= pc or pc + width > BASE + len(rom):
            raise Unproven('literal call ROM read out of range')
        data = bytes(rom[pc-BASE:pc-BASE+width])
        evidence[(pc, width)] = data
        return int.from_bytes(data, 'little')

    def half(pc):
        if pc & 1 or not entry <= pc < entry + max_span:
            raise Unproven('literal call control escapes bounded function')
        return read(pc, 2)

    def signed(value, bits):
        return value - (1 << bits) if value & (1 << (bits-1)) else value

    # Exact four-byte veneer: no instruction can overwrite the BL link token.
    if read(veneer_entry, 2) != 0x4700 | (register << 3) or read(veneer_entry+2, 2) != 0x46c0:
        raise Unproven('literal call veneer must be exact BX register; NOP')
    initial = tuple(('entry', r) for r in range(15))
    pending = [(entry, 0, initial, ())]
    seen, covered, literals, preceding_calls = set(), set(), set(), set()
    proven_paths = 0
    while pending:
        pc, sp, registers, saved = pending.pop()
        key = pc, sp, registers, saved
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > max_states:
            raise Unproven('literal call state budget')
        registers, stack = list(registers), dict(saved)
        word = half(pc)
        covered.add(pc)
        next_pc = pc + 2

        def get(r):
            if r == 13:
                return ('stack', sp)
            if r == 15:
                return ('const', (pc + 4) & 0xffffffff)
            return registers[r]

        def write(r, value=None):
            if r in (13, 15):
                raise Unproven('unmodeled write to SP/PC')
            registers[r] = value

        def scalar(value):
            return value[1] if value and value[0] == 'const' else None

        def arithmetic(a, b, subtract=False):
            if any(v and v[0] == 'stack' for v in (a, b)):
                raise Unproven('stack-derived arithmetic unsupported')
            x, y = scalar(a), scalar(b)
            return None if x is None or y is None else ('const', (x-y if subtract else x+y) & 0xffffffff)

        def memory(load, reg, pointer, displacement, width):
            slot = pointer[1] + displacement if pointer and pointer[0] == 'stack' else None
            if load:
                write(reg, stack.get(slot) if slot is not None and width == 4 else None)
            elif slot is not None:
                for old in list(stack):
                    if old < slot + width and slot < old + 4:
                        del stack[old]
                if width == 4 and get(reg) is not None:
                    stack[slot] = get(reg)
            else:
                if get(reg) and get(reg)[0] == 'stack':
                    raise Unproven('stack-derived pointer escapes through store')
                # Unknown-address writes may alias saved local constants.
                stack.clear()

        def returned(value):
            if value != initial[14] or sp != 0:
                raise Unproven('indirect transfer is not balanced incoming-LR return')

        if word & 0xfe00 == 0xb400:
            regs = [r for r in range(8) if word & (1 << r)] + ([14] if word & 0x100 else [])
            if not regs:
                raise Unproven('empty PUSH')
            sp -= 4 * len(regs)
            for i, r in enumerate(regs):
                stack[sp + i*4] = get(r)
        elif word & 0xfe00 == 0xbc00:
            regs = [r for r in range(8) if word & (1 << r)]
            values = [stack.pop(sp + i*4, None) for i in range(len(regs) + bool(word & 0x100))]
            if not values:
                raise Unproven('empty POP')
            for r, value in zip(regs, values):
                write(r, value)
            sp += 4 * len(values)
            if word & 0x100:
                returned(values[-1])
                continue
        elif word & 0xff00 == 0xb000:
            sp += (-(word & 0x7f) if word & 0x80 else word & 0x7f) * 4
        elif word & 0xfc00 == 0x4400:
            op, dst, src = (word >> 8) & 3, (word & 7) | ((word >> 4) & 8), (word >> 3) & 15
            if op == 3:
                if word & 0x87:
                    raise Unproven('BLX or malformed BX unsupported')
                returned(get(src))
                continue
            if op == 2:
                write(dst, get(src))
            elif op == 0:
                write(dst, arithmetic(get(dst), get(src)))
        elif word & 0xf800 == 0xf000:
            suffix = half(pc + 2)
            covered.add(pc + 2)
            if suffix & 0xf800 != 0xf800:
                raise Unproven('unknown long branch encoding')
            callee = (pc + 4 + signed(word & 0x7ff, 11)*4096 + (suffix & 0x7ff)*2) & 0xffffffff
            if pc == call_pc:
                if callee != veneer_entry or get(register) != ('const', expected_target):
                    raise Unproven('literal call target/register differs on reachable path')
                proven_paths += 1
                continue
            if any(get(r) and get(r)[0] == 'stack' for r in range(4)) or any(v and v[0] == 'stack' for v in stack.values()):
                raise Unproven('stack-derived call argument needs no-escape proof')
            preceding_calls.add(pc)
            for r in (0, 1, 2, 3, 12, 14):
                write(r)
            next_pc = pc + 4
        elif pc == call_pc:
            raise Unproven('literal call goal is not BL')
        elif word & 0xf000 == 0xd000:
            if (word >> 8) & 15 >= 14:
                raise Unproven('software interrupt/reserved branch unsupported')
            pending.append((pc + 4 + signed(word & 255, 8)*2, sp, tuple(registers), tuple(sorted(stack.items()))))
        elif word & 0xf800 == 0xe000:
            next_pc = pc + 4 + signed(word & 0x7ff, 11)*2
        elif word & 0xf800 == 0x4800:
            literal = ((pc + 4) & ~3) + (word & 255)*4
            write((word >> 8) & 7, ('const', read(literal, 4)))
            literals.add(literal)
        elif word & 0xf000 == 0x9000:
            memory(bool(word & 0x800), (word >> 8) & 7, ('stack', sp), (word & 255)*4, 4)
        elif word & 0xf000 == 0xa000:
            write((word >> 8) & 7, ('stack', sp + (word & 255)*4) if word & 0x800 else ('const', ((pc+4) & ~3) + (word & 255)*4))
        elif word & 0xe000 == 0x6000 or word & 0xf000 == 0x8000:
            width = 2 if word & 0xf000 == 0x8000 else 1 if word & 0x1000 else 4
            memory(bool(word & 0x800), word & 7, get((word >> 3) & 7), ((word >> 6) & 31)*width, width)
        elif word & 0xf000 == 0x5000:
            op = (word >> 9) & 7
            pointer, index = get((word >> 3) & 7), get((word >> 6) & 7)
            if any(v and v[0] == 'stack' for v in (pointer, index)):
                raise Unproven('dynamic stack access unsupported')
            memory(op >= 3, word & 7, None, 0, 4)
        elif word & 0xf000 == 0xc000:
            pointer = get((word >> 8) & 7)
            if pointer and pointer[0] == 'stack':
                raise Unproven('multiple stack transfer unsupported')
            if word & 0x800:
                for r in range(8):
                    if word & (1 << r):
                        write(r)
            else:
                for r in range(8):
                    if word & (1 << r):
                        memory(False, r, None, 0, 4)
            write((word >> 8) & 7)
        elif word & 0xfc00 == 0x4000:
            if (word >> 6) & 15 not in (8, 10, 11):
                if any(v and v[0] == 'stack' for v in (get(word & 7), get((word >> 3) & 7))):
                    raise Unproven('stack arithmetic unsupported')
                write(word & 7)
        elif word & 0xe000 == 0x2000:
            op, dst = (word >> 11) & 3, (word >> 8) & 7
            if op == 0:
                write(dst, ('const', word & 255))
            elif op != 1:
                write(dst, arithmetic(get(dst), ('const', word & 255), op == 3))
        elif word & 0xf800 == 0x1800:
            b = ('const', (word >> 6) & 7) if word & 0x400 else get((word >> 6) & 7)
            a = get((word >> 3) & 7)
            write(word & 7, a if b == ('const', 0) else arithmetic(a, b, bool(word & 0x200)))
        elif word & 0xe000 == 0:
            src = get((word >> 3) & 7)
            if word & 0xffc0 == 0:
                write(word & 7, src)
            else:
                if src and src[0] == 'stack':
                    raise Unproven('stack shift unsupported')
                write(word & 7)
        else:
            raise Unproven('unsupported Thumb instruction in literal call proof')
        if not -1024 <= sp <= 0:
            raise Unproven('literal call stack bound violated')
        pending.append((next_pc, sp, tuple(registers), tuple(sorted(stack.items()))))
    if not proven_paths:
        raise Unproven('literal call target unreachable')
    digest = hashlib.sha256(b''.join(pc.to_bytes(4, 'little') + width.to_bytes(2, 'little') + data
                                    for (pc, width), data in sorted(evidence.items()))).hexdigest()
    return {'kind': 'rom_proven_literal_register_veneer_call', 'machine': 'thumb_aapcs',
            'entry': f'{entry:08x}', 'call_pc': f'{call_pc:08x}', 'veneer_entry': f'{veneer_entry:08x}',
            'callee_entry': f'{expected_target & ~1:08x}', 'register': f'r{register}',
            'register_constants': {f'r{register}': expected_target},
            'instruction_count': len(covered), 'state_count': len(seen), 'goal_state_count': proven_paths,
            'literal_addresses': [f'{pc:08x}' for pc in sorted(literals)],
            'preceding_calls': [f'{pc:08x}' for pc in sorted(preceding_calls)],
            'source_sha256': digest, 'rom_sha256': hashlib.sha256(rom).hexdigest(),
            'link_semantics': {'bl_lr': f'{(call_pc+4)|1:08x}', 'veneer_preserves_lr': True,
                               'transfer': 'tail_bx', 'fabricated_return': False},
            'assumptions': ['Preceding direct calls obey standard AAPCS: r4-r11 and SP preserved; r0-r3/r12/LR clobbered',
                            'Pinned ROM instruction and literal bytes remain immutable during execution'],
            'status': 'requires_native_differential_qualification'}
