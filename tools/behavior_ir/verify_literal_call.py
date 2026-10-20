"""Small synthetic literal-veneer proof checks; no native/game qualification."""
import json
import time

from literal_call import BASE, Unproven, prove_literal_call


def run():
    started = time.perf_counter()
    target, veneer = BASE + 0x101, BASE + 0x80

    def fixture(words, reg=1):
        rom = bytearray(0x200)
        for index, word in enumerate(words):
            rom[index*2:index*2+2] = word.to_bytes(2, 'little')
        rom[0x80:0x84] = ((0x4700 | reg << 3).to_bytes(2, 'little') + b'\xc0\x46')
        rom[0x40:0x44] = target.to_bytes(4, 'little')
        return rom

    def bl(offset, destination):
        delta = destination - (BASE + offset + 4)
        return [0xf000 | ((delta >> 12) & 0x7ff), 0xf800 | ((delta >> 1) & 0x7ff)]

    base = [0x490f] + bl(2, veneer)  # LDR r1, [PC, #60].
    l0 = {'entry': f'{BASE:08x}'}
    accepted = 0
    for words, goal, reg in [
        (base, 2, 1),
        ([0x490f, 0x460d] + bl(4, veneer), 4, 5),  # COPY r5,r1.
        ([0xb500, 0x4d0f] + bl(4, BASE+0x90) + bl(8, veneer), 8, 5),
        ([0xd001, 0x490f, 0xe000, 0x490e] + bl(8, veneer), 8, 1),
        ([0x490f, 0x3901, 0x3101] + bl(6, veneer), 6, 1),
        ([0xb500, 0xd002, 0x490e] + bl(6, veneer) + [0xbd00], 6, 1),
    ]:
        proof = prove_literal_call(l0, fixture(words, reg), BASE+goal, veneer, reg, target)
        assert proof['register_constants'][f'r{reg}'] == target
        assert proof['link_semantics']['bl_lr'] == f'{(BASE+goal+4)|1:08x}'
        assert proof['link_semantics']['veneer_preserves_lr']
        accepted += 1

    failures = []
    def rejected(name, words=base, reg=1, goal=2, mutation=None, **kwargs):
        rom = fixture(words, reg)
        if mutation:
            mutation(rom)
        try:
            prove_literal_call(l0, rom, BASE+goal, veneer, reg, target, **kwargs)
        except Unproven:
            failures.append(name)
        else:
            raise AssertionError(name)

    rejected('edited literal', mutation=lambda rom: rom.__setitem__(slice(0x40,0x44), (target+2).to_bytes(4,'little')))
    rejected('wrong BX', mutation=lambda rom: rom.__setitem__(0x80, 0x28))
    rejected('LR altering veneer', mutation=lambda rom: rom.__setitem__(slice(0x82,0x84), b'\x8e\x46'))
    rejected('wrong BL', words=[0x490f]+bl(2, veneer+4))
    rejected('conflicting branch', words=[0x490f, 0xd000, 0x2100]+bl(6, veneer), goal=6)
    rejected('unreachable', words=[0x4770]+base, goal=4)
    rejected('call clobbers r1', words=[0xb500, 0x490f]+bl(4, BASE+0x90)+bl(8, veneer), goal=8)
    rejected('indirect control', words=[0x4710]+base, goal=4)
    rejected('unknown instruction', words=[0xbe00]+base, goal=4)
    rejected('stack escape', words=[0x4668, 0x6008, 0x490e]+bl(6,veneer), goal=6)
    rejected('unknown write drops saved constant', words=[0xb500,0x490f,0xb402,0x6002,0xbc02]+bl(10,veneer), goal=10)
    rejected('state cap', max_states=1)
    rejected('span cap', max_span=2)
    print(json.dumps({'outcome':'pass', 'accepted':accepted, 'rejected':len(failures),
                      'wall_s':time.perf_counter()-started,
                      'scope':'synthetic source proof only; native qualification unavailable'}))


if __name__ == '__main__':
    run()
