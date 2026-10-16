"""Bounded own-ROM Thumb/AAPCS return provenance, independent of pseudo-C.
Only a reachable BX of the actual incoming LR with balanced SP and restored
callee-saved registers proves a return. Unknown instructions/indirect control
flow fail closed. Calls are modeled with the normal AAPCS preservation rule;
callee memory effects and native ABI checks remain separate obligations.
"""
import hashlib


class Unproven(ValueError):
    pass


def oracle_stack_overlap(address, width):
    """GBA IWRAM is mirrored every32KiB; oracle frame occupies7a00..7e00."""
    if not 0x03000000 <= address < 0x04000000:
        return False
    start = address & 0x7fff
    end = start + width
    return (width >= 0x8000 or (start < 0x7e00 and 0x7a00 < end)
            or (end > 0x8000 and 0x7a00 < end - 0x8000))


def prove(l0, rom, target, max_states=8192, max_span=65536, call_register=None, expected_callee=None):
    entry = int(l0['entry'], 16)
    base = 0x08000000
    target = int(target, 16) if isinstance(target, str) else target
    if entry & 1 or target & 1 or not base <= entry <= target < base + len(rom):
        raise Unproven('return entry/target outside aligned ROM')
    if target - entry >= max_span:
        raise Unproven('return proof span budget')
    def half(pc):
        if not entry<=pc<=target+(2 if call_register is not None else 0)or pc+2>base+len(rom):
            raise Unproven('return proof control flow escapes bounded function')
        return int.from_bytes(rom[pc-base:pc-base+2], 'little')
    def signed(value, bits):
        return value - (1 << bits) if value & (1 << (bits-1)) else value
    from return_switch import prove_tables
    try:switches=prove_tables(l0,rom,entry,target)
    except ValueError as error:raise Unproven('unproved internal switch: '+str(error))from error
    switch_compares={t['compare_pc']:t for t in switches.values()}
    switch_guards={t['guard_pc']:t for t in switches.values()}
    initial = tuple(('entry', r) for r in range(15))
    pending = [(entry, 0, initial, (),None)]
    seen = set()
    covered = set()
    proven = False
    goal_callee = None
    while pending:
        pc, sp, registers, saved,switch_phase = pending.pop()
        key = (pc, sp, registers, saved,switch_phase)
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > max_states:
            raise Unproven('return proof state budget')
        registers, stack = list(registers), dict(saved)
        word = half(pc)
        if switch_phase is not None and pc!=switch_phase[1]:raise Unproven('internal switch guard provenance lost')
        covered.add(pc)
        next_pc = pc + 2
        def get(r):
            return ('stack', sp) if r == 13 else registers[r]
        def write(r, value=None):
            if r in (13, 15):
                raise Unproven('unmodeled write to SP/PC')
            registers[r] = value
        def memory(load, register, address, width):
            if address is None:
                if not load and get(register)and get(register)[0]=='stack':
                    raise Unproven('stack-derived pointer escapes through memory')
                if load:
                    write(register)
                return
            # Exact SP-relative words may transport LR; partial writes invalidate
            # every overlapping saved value. Never infer LR from numeric bytes.
            if load:
                write(register, stack.get(address) if width == 4 else None)
            else:
                for old in list(stack):
                    if old < address + width and address < old + 4:
                        del stack[old]
                if width == 4 and get(register) is not None:
                    stack[address] = get(register)
        if word & 0xff00 == 0xb500 or word & 0xfe00 == 0xb400:
            regs = [r for r in range(8) if word & (1 << r)]
            if word & 0x100:
                regs.append(14)
            if not regs:
                raise Unproven('empty push')
            sp -= 4 * len(regs)
            for i, r in enumerate(regs):
                stack[sp + i*4] = get(r)
        elif word & 0xfe00 == 0xbc00:
            if word & 0x100:
                raise Unproven('POP PC return not modeled by BX proof')
            regs = [r for r in range(8) if word & (1 << r)]
            if not regs:
                raise Unproven('empty pop')
            for i, r in enumerate(regs):
                write(r, stack.pop(sp + i*4, None))
            sp += 4 * len(regs)
        elif word & 0xff00 == 0xb000:
            amount = (word & 0x7f) * 4
            sp += -amount if word & 0x80 else amount
        elif word & 0xfc00 == 0x4400:
            op = (word >> 8) & 3
            destination = (word & 7) | ((word >> 4) & 8)
            source = (word >> 3) & 15
            if op == 3:
                if word & 0x87:
                    raise Unproven('BLX or malformed BX unsupported')
                if pc == target and call_register is None:
                    if get(source) != initial[14] or sp != 0:
                        raise Unproven('BX is not balanced incoming-LR return')
                    if any(registers[r] != initial[r] for r in range(4, 12)):
                        raise Unproven('return callee-saved register provenance lost')
                    proven = True
                elif get(source) != initial[14] or sp != 0:
                    raise Unproven('other indirect control flow is not proven return')
                continue
            if op == 2:
                if destination==15 and pc in switches:
                    table=switches[pc]
                    if switch_phase!=(pc,pc,'dispatch'):raise Unproven('internal switch bypasses source guard')
                    for destination in table['targets']:pending.append((destination,sp,tuple(registers),tuple(sorted(stack.items())),None))
                    continue
                write(destination, get(source))
            elif op == 0:
                if any(v and v[0]=='stack' for v in (get(destination),get(source))):
                    raise Unproven('stack-derived arithmetic unsupported')
                write(destination)
            # CMP changes flags only.
        elif word & 0xf800 == 0xf000:
            suffix = half(pc + 2)
            if suffix & 0xf800 != 0xf800:
                raise Unproven('unknown long branch encoding')
            covered.add(pc + 2)
            if pc==target and call_register is not None:
                goal_callee=(pc+4+signed(word&0x7ff,11)*4096+(suffix&0x7ff)*2)&0xffffffff
                if expected_callee is None or goal_callee!=expected_callee:raise Unproven('call target does not match known callee')
                if call_register!=0 or get(call_register)!=initial[call_register]:raise Unproven('call pointer is not proven entry r0')
                proven=True
                continue
            if any(get(r)and get(r)[0]=='stack'for r in range(4))or any(v and v[0]=='stack'for v in stack.values()):
                raise Unproven('stack-derived call argument needs no-escape proof')
            for r in (0, 1, 2, 3, 12, 14):
                write(r)
            next_pc = pc + 4
        elif word & 0xf000 == 0xd000:
            if (word >> 8) & 15 >= 14:
                raise Unproven('software interrupt/reserved branch unsupported')
            destination = pc + 4 + signed(word & 255, 8) * 2
            branch_phase=switch_phase
            if pc in switch_guards:
                table=switch_guards[pc]
                if switch_phase!=(table['pc'],pc,'guard'):raise Unproven('internal switch guard lacks adjacent source CMP')
                branch_phase=(table['pc'],table['prefix_pc'],'dispatch');switch_phase=None
            pending.append((destination, sp, tuple(registers), tuple(sorted(stack.items())),branch_phase))
        elif word & 0xf800 == 0xe000:
            next_pc = pc + 4 + signed(word & 0x7ff, 11) * 2
        elif word & 0xf000 == 0x9000:
            memory(bool(word & 0x800), (word >> 8) & 7, sp + (word & 255)*4, 4)
        elif word & 0xf000 == 0xa000:
            write((word >> 8) & 7, ('stack', sp + (word & 255)*4) if word & 0x800 else None)
        elif word & 0xe000 == 0x6000 or word & 0xf000 == 0x8000:
            width = 2 if word & 0xf000 == 0x8000 else 1 if word & 0x1000 else 4
            displacement = ((word >> 6) & 31) * width
            pointer = get((word >> 3) & 7)
            address = pointer[1] + displacement if pointer and pointer[0] == 'stack' else None
            memory(bool(word & 0x800), word & 7, address, width)
        elif word & 0xf000 == 0x5000:
            op = (word >> 9) & 7
            pointer, index = get((word >> 3) & 7), get((word >> 6) & 7)
            if any(v and v[0] == 'stack' for v in (pointer, index)):
                raise Unproven('dynamic stack memory operand unresolved')
            if op>=3:write(word&7)
            elif get(word&7)and get(word&7)[0]=='stack':raise Unproven('stack-derived pointer escapes through indexed store')
        elif word & 0xf000 == 0xc000:
            pointer = get((word >> 8) & 7)
            if pointer and pointer[0] == 'stack':
                raise Unproven('multiple stack transfer unsupported')
            if not word&0x800 and any(word&(1<<r)and get(r)and get(r)[0]=='stack'for r in range(8)):
                raise Unproven('stack-derived pointer escapes through multiple store')
            if word & 0x800:
                for r in range(8):
                    if word & (1 << r):
                        write(r)
            write((word >> 8) & 7)
        elif word & 0xf800 == 0x4800:
            write((word >> 8) & 7)
        elif word & 0xfc00 == 0x4000:
            if (word >> 6) & 15 not in (8, 10, 11):
                if any(v and v[0]=='stack' for v in (get(word&7),get((word>>3)&7))):
                    raise Unproven('stack-derived arithmetic unsupported')
                write(word & 7)
        elif word & 0xe000 == 0x2000:
            op=(word>>11)&3;destination=(word>>8)&7
            if op in(2,3)and get(destination)and get(destination)[0]=='stack':
                if word&255:raise Unproven('stack-derived arithmetic unsupported')
            elif op!=1:write(destination)
        elif word & 0xf800 == 0x1800:
            source = (word >> 3) & 7
            copy = bool(word & 0x400) and not word & 0x200 and not word & 0x1c0
            operands=[get(source)]+([]if word&0x400 else[get((word>>6)&7)])
            if not copy and any(v and v[0]=='stack'for v in operands):raise Unproven('stack-derived arithmetic unsupported')
            write(word & 7, get(source) if copy else None)
        elif word & 0xe000 == 0:
            source=get((word>>3)&7);copy=word&0xffc0==0
            if not copy and source and source[0]=='stack':raise Unproven('stack-derived arithmetic unsupported')
            write(word&7,source if copy else None)
        else:
            raise Unproven('unsupported Thumb instruction in return proof')
        if not -1024 <= sp <= 0:
            raise Unproven('return proof stack bound/balance violated')
        if pc in switch_compares:
            table=switch_compares[pc];switch_phase=(table['pc'],table['guard_pc'],'guard')
        elif switch_phase is not None and switch_phase[2]=='dispatch':switch_phase=(switch_phase[0],next_pc,'dispatch')
        pending.append((next_pc, sp, tuple(registers), tuple(sorted(stack.items())),switch_phase))
    if not proven:
        raise Unproven('return target unreachable')
    if call_register is not None:
        return {'kind':'rom_proven_entry_pointer_call_argument','entry':f'{entry:08x}','call_pc':f'{target:08x}','callee_entry':f'{goal_callee:08x}','register_sources':{'r0':'r0'},'instruction_count':len(covered),'state_count':len(seen),'instruction_sha256':hashlib.sha256(b''.join(pc.to_bytes(4,'little')+rom[pc-base:pc-base+2]for pc in sorted(covered))).hexdigest(),**({'internal_switches':[t['proof']for t in switches.values()]}if switches else{}),'assumptions':['Normal AAPCS preservation and no internally derived stack pointer escapes on preceding calls'],'status':'requires_native_differential_qualification'}
    return {'kind': 'rom_proven_incoming_lr_return', 'machine': 'thumb_aapcs',
            'method': 'bounded_path_stack_and_register_provenance',
            'entry': f'{entry:08x}', 'return_pc': f'{target:08x}',
            'instruction_count': len(covered), 'state_count': len(seen),
            'instruction_sha256': hashlib.sha256(b''.join(pc.to_bytes(4, 'little') + rom[pc-base:pc-base+2] for pc in sorted(covered))).hexdigest(),
            **({'internal_switches':[t['proof']for t in switches.values()]}if switches else{}),
            'assumptions': ['Calls preserve AAPCS callee-saved registers/SP and caller saved-return slots',
                            'Non-stack memory accesses do not alias saved return-frame storage'],
            'status': 'requires_native_differential_qualification'}
