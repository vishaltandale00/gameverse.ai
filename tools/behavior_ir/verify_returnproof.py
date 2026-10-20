"""Small synthetic rejection/return-payload regressions; no game evidence."""
import json
import time
from contract import validate
from lift import Lifter, Unsupported
from returnproof import prove, Unproven, oracle_stack_overlap

BASE = 0x08000000


def image(words):
    return b''.join(w.to_bytes(2, 'little') for w in words)


def run():
    started = time.perf_counter()
    l0 = {'entry': '08000000'}
    # Saved incoming LR travels through r1; semantic return remains in r0.
    accepted = [
        [0xb500, 0x2007, 0xbc02, 0x4708],
        [0xb510, 0x2400, 0xbc10, 0xbc02, 0x4708],
        [0xb500, 0xb082, 0x9000, 0xb002, 0xbc02, 0x4708],
        [0xb500, 0xd001, 0x2007, 0x2008, 0xbc02, 0x4708],
        [0xb500, 0xf000, 0xf800, 0xbc02, 0x4708],
    ]
    for words in accepted:
        prove(l0, image(words), BASE + (len(words)-1)*2)
    rejected = [
        [0x4708],  # Genuine BX r1 dispatch.
        [0x4710],  # Genuine BX r2 dispatch.
        [0x4718],  # Genuine BX r3 dispatch.
        [0x4720],  # Genuine BX r4 dispatch.
        [0xb500, 0x2000, 0x9000, 0xbc02, 0x4708],  # LR overwritten.
        [0xb500, 0xbc02, 0x2100, 0x4708],  # Restored token clobbered.
        [0xb500, 0xbc02, 0xb081, 0x4708],  # SP imbalance.
        [0xb510, 0xbc10, 0xbc02, 0x2400, 0x4708],  # r4 not preserved.
        [0xb500, 0xd001, 0xbc02, 0x4708, 0x2100, 0x4708],  # One bad branch.
        [0xb500, 0x4668, 0x3000, 0x2100, 0x6001, 0xbc02, 0x4708],  # Derived SP survives add0.
        [0xb500, 0x4668, 0x3001, 0x2100, 0x6001, 0xbc02, 0x4708],  # Unknown derived offset rejects.
        [0xb500, 0x4668, 0x6010, 0x6810, 0x2100, 0x6001, 0xbc02, 0x4708],  # SP escapes/reloads.
        [0xb500, 0x4668, 0xf000, 0xf800, 0xbc02, 0x4708],  # Byref call needs noescape.
        [0x46f4, 0xf000, 0xf800, 0x4760],  # AAPCS calls clobber r12/IP.
        [0xb500, 0x4668, 0xb401, 0x2000, 0xf000, 0xf800, 0xb001, 0xbc02, 0x4708],  # Outgoing stack arg escape.
        [0xb500, 0x4788],  # BLX must not be read as BX.
    ]
    for words in rejected:
        try:
            prove(l0, image(words), BASE + (len(words)-1)*2)
        except Unproven:
            pass
        else:
            raise AssertionError('unproved indirect transfer accepted: ' + repr(words))
    # Call goals bind the live entry pointer to the actual decoded callee.
    call_cases = [
        ([0xf000, 0xf800], 0, BASE+4, True),
        ([0xb510, 0x1c04, 0xf000, 0xf800, 0x1c20, 0xf000, 0xf800], 10, BASE+14, True),
        ([0x2001, 0xf000, 0xf800], 2, BASE+6, False),
        ([0x2001, 0x4770], 2, BASE+6, False),  # BX cannot satisfy call goal.
        ([0xf000, 0xf800], 0, BASE+6, False),  # Wrong actual BL destination.
        ([0xd000, 0x2001, 0xf000, 0xf800], 4, BASE+8, False),  # One clobbered path.
        ([0xf000, 0xf800, 0xf000, 0xf800], 4, BASE+8, False),
    ]
    for words, offset, callee, expected in call_cases:
        try:
            proof = prove(l0, image(words), BASE+offset, call_register=0, expected_callee=callee)
        except Unproven:
            assert not expected, words
        else:
            assert expected and proof['callee_entry'] == f'{callee:08x}', words

    # Use the actual Lifter boundary. Keep the semantic r0 payload supplied by
    # HighFunction, rather than synthesizing a guessed return value from BX r1.
    l0.update(varnodes=[
        dict(id='v0', size=4, space='register', offset=88, input=True, constant=False, register='lr'),
        dict(id='v1', size=4, space='const', offset=7, input=False, constant=True),
        dict(id='v2', size=4, space='const', offset=1, input=False, constant=True)],
        blocks=[dict(id=0, predecessors=[], successors=[], ops=[
            dict(id='op0', opcode='CALLIND', pc='08000006', inputs=['v0', 'v1']),
            dict(id='op1', opcode='RETURN', pc='08000006', inputs=['v2'])])])
    result, adapter = Lifter(l0, image(accepted[0])).build()
    validate(result)
    assert result['return_type'] == 'u32' and result['body'][0]['value']['value'] == 7
    assert adapter['assumptions'][0]['kind'] == 'rom_proven_incoming_lr_return'
    try:
        Lifter(l0, image([0xb500, 0x2007, 0xbc02, 0x4720])).build()
    except Unsupported:
        pass
    else:
        raise AssertionError('input-lr SSA label overrode actual BX r4 dispatch')
    for address,width,expected in [(0x030079ff,2,True),(0x0300fa00,4,True),(0x03fffa00,4,True),(0x03007800,4,False),(0x03007e00,4,False),(0x03007fff,0x7a02,True),(0x02007a00,4,False)]:
        assert oracle_stack_overlap(address,width)==expected
    print(json.dumps(dict(outcome='pass', accepted=len(accepted), rejected=len(rejected)+1,
                          highfunction_return_payload_preserved=True, call_goal_cases=len(call_cases),
                          wall_s=time.perf_counter()-started)))


if __name__ == '__main__':
    run()
