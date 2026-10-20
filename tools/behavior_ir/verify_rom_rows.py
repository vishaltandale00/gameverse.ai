"""Focused readonly-row proof checks; no native run or ROM mutation."""
import copy
import hashlib
import json
from pathlib import Path
import time
from lift import Lifter, Unsupported, const, node
from rom_rows import table, access


def run():
    started = time.perf_counter(); checks = 0
    class Fixture:
        def __init__(self):
            self.rom = bytearray(2048)
            self.v = {'out': {'size': 4}}
            self.assets = {}; self.assumptions = []
            self.maximum = 3
            for index, address in enumerate([0x08000200, 0x08000300, 0x08000200, 0x08000400]):
                self.rom[index * 4:index * 4 + 4] = address.to_bytes(4, 'little')
            for index in range(512, 1280): self.rom[index] = (index * 29) & 255
        def bounds(self, e):
            if e['op'] == 'const': return e['value'], e['value']
            if e['op'] == 'parameter': return 0, self.maximum
            if e['op'] == 'mul_wrap':
                a, b = map(self.bounds, e['args']); return a[0] * b[0], a[1] * b[1]
            raise Unsupported('fixture unknown bound')
    operation = {'id': 'load_pointer', 'output': 'out', 'opcode': 'LOAD'}
    selector = {'op': 'parameter', 'type': 'u32', 'name': 'selector'}
    source = ('asset', 0x08000000, node('mul_wrap', 'u32', selector, const(4)))
    fixture = Fixture(); descriptor = table(fixture, source, operation)
    assert descriptor['unique'] == [0x08000200, 0x08000300, 0x08000400]; checks += 1
    result = access(fixture, descriptor, const(15), 1, False, {'id': 'read_byte'})
    mapping, rows = list(fixture.assets.values())
    for i, address in enumerate(descriptor['targets']):
        for byte in range(16):
            assert rows['derived_data'][mapping['derived_data'][i] * 16 + byte] == fixture.rom[address - 0x08000000 + byte]
    checks += 1
    def rejects(fn):
        nonlocal checks
        try: fn()
        except Unsupported: checks += 1
        else: raise AssertionError('invalid row contract accepted')
    rejects(lambda: access(fixture, descriptor, const(0), 1, True, {'id': 'write'}))
    rejects(lambda: access(fixture, descriptor, const(0), 2, False, {'id': 'wide'}))
    rejects(lambda: access(fixture, descriptor, const(4096), 1, False, {'id': 'large'}))
    rejects(lambda: access(fixture, descriptor, const(-1), 1, False, {'id': 'negative'}))
    bad = Fixture(); bad.maximum = 256
    rejects(lambda: table(bad, source, operation))
    rejects(lambda: table(Fixture(), ('asset', 0x08000001, source[2]), operation))
    rejects(lambda: table(Fixture(), ('asset', 0x08000000, selector), operation))
    for invalid in [0, 0x02000000, 0x08000800]:
        bad = Fixture(); bad.rom[0:4] = invalid.to_bytes(4, 'little')
        rejects(lambda: table(bad, source, operation))
    bad = Fixture(); bad.v['out']['size'] = 2
    rejects(lambda: table(bad, source, operation))
    bad = Fixture(); bad.rom[:4] = (0x080007ff).to_bytes(4, 'little')
    d = table(bad, source, operation)
    rejects(lambda: access(bad, d, const(1), 1, False, {'id': 'straddle'}))
    big = Fixture(); big.maximum = 255; big.rom = bytearray(0x11000)
    for i in range(256):big.rom[i*4:i*4+4]=(0x08000400+i*256).to_bytes(4,'little')
    d=table(big,source,operation)
    rejects(lambda: access(big,d,const(255),1,False,{'id':'map_plus_exact_cap'}))
    prior=Fixture(); prior.assets['prior']={'derived_data':[0]*65500}
    d=table(prior,source,operation)
    rejects(lambda: access(prior,d,const(15),1,False,{'id':'aggregate_cap'}))
    root = Path(__file__).resolve().parents[2]
    rom = (root/'local/roms/Kirby - Nightmare in Dream Land (USA).gba').read_bytes()
    p = root/'local/ir/queue-runs/20261016T091004/kirby-nightmare-in-dream-land/l0/080219b0.json'
    raw = json.loads(p.read_text()); kwargs = {'param_domains': {'r0': {'unsigned_min': 0, 'unsigned_max': 255}},
        'state_domains': {'global:0:50353416': {'unsigned_min': 0, 'unsigned_max': 255}}}
    l1, adapter = Lifter(raw, rom, **kwargs).build()
    assert sum(len(a['data']) for a in l1['assets']) == 3840; checks += 1
    # Every byte of all256 selectors exactly equals the original table-chosen row.
    values = [a['data'] for a in l1['assets']]
    ordinal = next(v for v in values if len(v) == 256); data = next(v for v in values if len(v) == 3584)
    address = 0x08733ff0 - 0x08000000
    for shape in range(256):
        target = int.from_bytes(rom[address + shape * 4:address + shape * 4 + 4], 'little') - 0x08000000
        assert data[ordinal[shape] * 256:(ordinal[shape] + 1) * 256] == list(rom[target:target + 256])
    checks += 1
    escaped = copy.deepcopy(raw)
    for block in escaped['blocks']:
        for op in block['ops']:
            if op['opcode'] == 'RETURN': op['inputs'][-1] = 'v8'
    rejects(lambda: Lifter(escaped, rom, **kwargs).build())
    print(json.dumps({'outcome': 'pass', 'checks': checks, 'all_selector_row_bytes_checked': 65536,
        'wall_s': time.perf_counter() - started, 'new_native_calls': 0,
        'scope': 'Synthetic negative mechanisms plus exact immutable ROM row equivalence; not native sampler qualification.'}))

if __name__ == '__main__': run()
