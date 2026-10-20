"""Small compiler fixtures for edge-sensitive interval proof soundness."""
import copy
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time
from path_bounds import analyze, bounds

ROOT = Path(__file__).resolve().parents[2]


def fixture(code='INT_LESS', constant=7, reverse=True, bits=8):
    def v(name, size, **kw):
        return dict(id=name, size=size, constant=False, input=False, space='unique', offset=0, **kw)
    variables = [v('v0', bits//8), v('v1', bits//8), v('v2', 1), v('v3', 4)]
    variables[1].update(constant=True, space='const', offset=constant)
    return {'entry': '08000000', 'varnodes': variables, 'blocks': [
        {'id': 0, 'predecessors': [], 'successors': [1, 2], 'true_successor': 1, 'false_successor': 2,
         'ops': [{'id': 'cmp', 'pc': '08000000', 'opcode': code, 'output': 'v2', 'inputs': ['v1', 'v0'] if reverse else ['v0', 'v1']},
                 {'id': 'branch', 'pc': '08000002', 'opcode': 'CBRANCH', 'inputs': ['v1', 'v2']}]},
        {'id': 1, 'predecessors': [0], 'successors': [3], 'ops': []},
        {'id': 2, 'predecessors': [0], 'successors': [3], 'ops': []},
        {'id': 3, 'predecessors': [1, 2], 'successors': [], 'ops': []}]}


def run():
    started = time.perf_counter()
    checks = []
    x = fixture()
    snapshot = copy.deepcopy(x)
    facts = analyze(x)['facts_by_block']
    assert facts[1]['v0'] == (8, 255) and facts[2]['v0'] == (0, 7)
    assert facts[0] == facts[3] == {} and x == snapshot
    checks += ['true/false unsigned edges', 'merge and pre-guard context isolation', 'raw L0 unchanged']
    # Exhaustively check every 8-bit signed and unsigned predicate/edge.
    for code in ('INT_LESS', 'INT_LESSEQUAL', 'INT_SLESS', 'INT_SLESSEQUAL', 'INT_EQUAL', 'INT_NOTEQUAL'):
        for reverse in (False, True):
            for c in (0, 7, 127, 128, 255):
                f = analyze(fixture(code, c, reverse))['facts_by_block']
                def signed(n):
                    return n-256 if n >= 128 else n
                for value in range(256):
                    a, b = (c, value) if reverse else (value, c)
                    if code in ('INT_SLESS', 'INT_SLESSEQUAL'):
                        a, b = signed(a), signed(b)
                    condition = a == b if code == 'INT_EQUAL' else a != b if code == 'INT_NOTEQUAL' else a <= b if code.endswith('LESSEQUAL') else a < b
                    lo, hi = f[1 if condition else 2].get('v0', (0, 255))
                    assert lo <= value <= hi, (code, reverse, c, value, lo, hi)
    checks += ['exhaustive signed/unsigned polarity and boundary soundness']
    # Back propagation through extension narrows the existing SSA LOAD result,
    # never another load of the same address or a value on a sibling path.
    x = fixture(bits=32)
    x['varnodes'].append(dict(id='v4', size=1, constant=False, input=False, space='unique', offset=1))
    x['blocks'][0]['ops'].insert(0, {'id': 'extend', 'opcode': 'INT_ZEXT', 'inputs': ['v4'], 'output': 'v0'})
    f = analyze(x)['facts_by_block']
    assert f[1]['v4'] == (8, 255) and f[2]['v4'] == (0, 7)
    e = {'op': 'sub_wrap', 'type': 'u32', 'args': [{'op': 'local', 'type': 'u32', 'name': 'value_0'}, {'op': 'const', 'type': 'u32', 'value': 8}]}
    def interval(expr, fs):
        def fallback(child):
            return interval(child, fs)
        result = bounds(expr, fallback, fs)
        if result is not None:
            return result
        if expr['op'] == 'const':
            return expr['value'], expr['value']
        return 0, (1 << int(expr['type'][1:]))-1
    assert interval(e, {'v0': (8, 255)}) == (0, 247)
    assert bounds(e, lambda z: interval(z, {}), {}) is None
    assert bounds(e, lambda z: interval(z, {'v0': (0, 7)}), {}) is None
    checks += ['ZEXT SSA constraint propagation', 'nonwrapping subtraction', 'underflow rejection']
    x = fixture()
    x['blocks'][0]['ops'].insert(1, {'id': 'negate', 'opcode': 'BOOL_NEGATE', 'inputs': ['v2'], 'output': 'v3'})
    x['blocks'][0]['ops'][-1]['inputs'][1] = 'v3'
    assert analyze(x)['facts_by_block'][1]['v0'] == (0, 7)
    checks += ['boolean negation polarity']
    # A bypass into a guarded body destroys edge dominance.
    x = fixture()
    x['blocks'][2]['successors'] = [1]
    x['blocks'][1]['predecessors'].append(2)
    assert analyze(x)['facts_by_block'][1] == {}
    checks += ['bypass edge rejection']
    source_path = ROOT/'local/ir/dependency-exports/20261016T100738790136/super-mario-advance-2-super-mario-world/l0/0803e4b0.json'
    real = None
    if source_path.exists():
        raw = source_path.read_bytes()
        source = json.loads(raw)
        proof = analyze(source)
        assert proof['facts_by_block'][4]['v32'] == (8, 255)
        assert 'v32' not in proof['facts_by_block'][6]
        assert proof['facts_by_block'][3].get('v32') is None
        real = {'path': str(source_path.relative_to(ROOT)), 'file_sha256': hashlib.sha256(raw).hexdigest(),
                'entry': source['entry'], 'use_op': 'op32', 'use_pc': '0803e52a',
                'proven_interval': [0, 247], 'proof': next(p for p in proof['proofs'] if p['branch']=='op28' and p['condition'])}
        checks += ['SMA2 lifetime source guard at op32; no fact survives merge']
    return {'outcome': 'pass', 'checks': checks, 'real_source': real,
            'wall_s': time.perf_counter()-started, 'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'machine': platform.platform(), 'python': platform.python_version(),
            'timing_context': {'mode': 'focused in-process verifier', 'queue_s': None, 'build_s': None, 'native_qualification': 'owned by integration lead', 'before_measurement': None}}


if __name__ == '__main__':
    result = run()
    destination = ROOT/'local/ir/path-bounds-20261016'
    destination.mkdir(parents=True, exist_ok=True)
    (destination/'verification.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))
