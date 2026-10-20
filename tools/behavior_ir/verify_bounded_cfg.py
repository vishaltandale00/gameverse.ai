"""Dependency-free focused semantic regressions for bounded CFG expansion.

Runs in a fraction of a second. It compares original and transformed execution
(including ordered memory events), then checks uncertainty/resource rejections.
Actual ROM/native qualification is a separate compiler integration check.
"""
import copy
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time

from bounded_cfg import UnsupportedLoop, expand

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'local/ir/mashup-coverage/bounded-cfg'
RAW = ROOT / 'local/ir/dependency-exports/20261016T100738790136/super-mario-advance-2-super-mario-world/l0/08071514.json'


def fixture(count=3):
    variables = []
    def var(size=4, constant=False, offset=0):
        name = 'v' + str(len(variables))
        variables.append(dict(id=name, size=size, constant=constant, offset=offset,
                              input=False, space='const' if constant else 'unique'))
        return name
    initial, zero, minus, addr, flagaddr = [var(constant=True, offset=x) for x in (count, 0, 0xffffffff, 4, 8)]
    seed, iv, acc, flag, choose, left, right, merged, nxt, cond, seedacc, loadleft, loadright = [var() for _ in range(13)]
    operations = []
    def op(code, inputs, output=None):
        value = dict(id='op'+str(len(operations)), opcode=code, inputs=inputs, pc='08000000')
        if output is not None:
            value['output'] = output
        operations.append(value)
        return value
    return dict(entry='08000000', varnodes=variables, blocks=[
        dict(id=0, predecessors=[], successors=[1], ops=[op('COPY', [initial], seed), op('LOAD', [zero, addr], seedacc)]),
        dict(id=1, predecessors=[0, 4], successors=[2, 3], true_successor=2, false_successor=3,
             ops=[op('MULTIEQUAL', [seed, nxt], iv), op('MULTIEQUAL', [seedacc, merged], acc),
                  op('LOAD', [zero, flagaddr], flag), op('INT_NOTEQUAL', [flag, zero], choose),
                  op('CBRANCH', [zero, choose])]),
        dict(id=2, predecessors=[1], successors=[4],
             ops=[op('STORE', [zero, addr, iv]), op('LOAD', [zero, addr], loadleft), op('INT_ADD', [acc, loadleft], left)]),
        dict(id=3, predecessors=[1], successors=[4],
             ops=[op('STORE', [zero, flagaddr, iv]), op('LOAD', [zero, addr], loadright), op('INT_ADD', [acc, loadright], right)]),
        dict(id=4, predecessors=[2, 3], successors=[1, 5], true_successor=1, false_successor=5,
             ops=[op('MULTIEQUAL', [left, right], merged), op('INT_ADD', [iv, minus], nxt),
                  op('INT_NOTEQUAL', [nxt, zero], cond), op('CBRANCH', [zero, cond])]),
        dict(id=5, predecessors=[4], successors=[], ops=[op('RETURN', [zero, merged])]),
    ])


def swap_fixture():
    """Both header phis read predecessor values before either is assigned."""
    variables = [dict(id='v'+str(i), size=4, constant=i < 5,
                      offset=[3, 0, 0xffffffff, 4, 8][i] if i < 5 else 0,
                      input=False, space='const' if i < 5 else 'unique') for i in range(13)]
    def op(i, code, ins, out=None):
        return dict(id='op'+str(i), opcode=code, inputs=['v'+str(v) for v in ins],
                    pc='08000000', **({'output': 'v'+str(out)} if out is not None else {}))
    return dict(entry='08000000', varnodes=variables, blocks=[
        dict(id=0, predecessors=[], successors=[1], ops=[
            op(0, 'LOAD', [1, 3], 5), op(1, 'LOAD', [1, 4], 6)]),
        dict(id=1, predecessors=[0, 1], successors=[1, 2], true_successor=1, false_successor=2, ops=[
            op(2, 'MULTIEQUAL', [0, 10], 7), op(3, 'MULTIEQUAL', [5, 9], 8),
            op(4, 'MULTIEQUAL', [6, 8], 9), op(5, 'STORE', [1, 3, 8]),
            op(6, 'STORE', [1, 4, 9]), op(7, 'INT_ADD', [7, 2], 10),
            op(8, 'INT_NOTEQUAL', [10, 1], 11), op(9, 'CBRANCH', [1, 11])]),
        dict(id=2, predecessors=[1], successors=[], ops=[op(10, 'RETURN', [1, 8])]),
    ])


def execute(source, memory):
    """Small independent interpreter for this test's original p-code subset."""
    variables = {v['id']: v for v in source['varnodes']}
    values = {v['id']: int(v['offset']) & ((1 << (v['size'] * 8)) - 1)
              for v in variables.values() if v['constant']}
    blocks = {b['id']: b for b in source['blocks']}
    memory, events = dict(memory), []
    bid, previous = min(blocks), None
    for _ in range(10000):
        block = blocks[bid]
        # All phi operands read the same predecessor snapshot.
        phi_values = {o['output']: values[o['inputs'][block['predecessors'].index(previous)]]
                      for o in block['ops'] if o['opcode'] == 'MULTIEQUAL'}
        values.update(phi_values)
        successor = block['successors'][0] if block['successors'] else None
        for op in block['ops']:
            code = op['opcode']
            if code == 'MULTIEQUAL':
                continue
            xs = [values[i] for i in op['inputs']]
            if code == 'COPY': result = xs[0]
            elif code == 'INT_ADD': result = xs[0] + xs[1]
            elif code == 'INT_NOTEQUAL': result = int(xs[0] != xs[1])
            elif code == 'INT_SLESS':
                def signed(value, variable):
                    bits = 8 * variables[variable]['size']
                    return value - (1 << bits) if value & (1 << (bits - 1)) else value
                result = int(signed(xs[0], op['inputs'][0]) < signed(xs[1], op['inputs'][1]))
            elif code == 'LOAD':
                result = memory.get(xs[1], 0)
                events.append(('load', xs[1], result))
            elif code == 'STORE':
                memory[xs[1]] = xs[2]
                events.append(('store', xs[1], xs[2]))
            elif code == 'CBRANCH':
                successor = block['true_successor'] if xs[1] else block['false_successor']
            elif code == 'RETURN':
                return xs[1] if len(xs) > 1 else None, memory, events
            else:
                raise AssertionError('unimplemented test interpreter opcode: ' + code)
            if op.get('output'):
                values[op['output']] = result & ((1 << (8 * variables[op['output']]['size'])) - 1)
        if successor is None:
            return None, memory, events
        previous, bid = bid, successor
    raise AssertionError('test interpreter execution budget')


def run():
    started = time.perf_counter()
    checks, timings = [], []
    def check(name, action):
        before = time.perf_counter()
        action()
        checks.append(name)
        timings.append(dict(check=name, wall_s=time.perf_counter()-before, outcome='pass'))
    def rejected(source, **limits):
        try:
            expand(source, **limits)
        except UnsupportedLoop:
            return
        raise AssertionError('unproved loop accepted')
    def differential():
        for count in (1, 3, 8, 64):
            original = fixture(count)
            snapshot = copy.deepcopy(original)
            derived, proofs = expand(original)
            assert original == snapshot
            assert proofs[0]['block_visits']['1'] == count
            for flag in (0, 1, 7):
                # flag=0 changes after the first STORE: later iterations switch
                # branch, exposing misplaced/repeated load or store snapshots.
                assert execute(original, {8: flag}) == execute(derived, {8: flag})
            assert expand(original) == (derived, proofs)
    check('ordered mutable loads/stores, branch joins, loop-carried phi, 1/3/8/64 iterations', differential)
    def simultaneous():
        original = swap_fixture()
        derived, proofs = expand(original)
        assert proofs[0]['block_visits']['1'] == 3
        for x, y in ((3, 7), (0xffff, 1), (0, 42)):
            assert execute(original, {4: x, 8: y}) == execute(derived, {4: x, 8: y})
    check('simultaneous mutually dependent phi swap preserves predecessor snapshot', simultaneous)
    def increasing():
        original = fixture(0)
        original['varnodes'][2]['offset'] = 1
        bound = 'v'+str(len(original['varnodes']))
        original['varnodes'].append(dict(id=bound, size=4, constant=True, offset=3, input=False, space='const'))
        original['blocks'][4]['ops'][2]['inputs'][1] = bound
        derived, proofs = expand(original)
        assert proofs[0]['block_visits']['1'] == 3
        for flag in (0, 1):
            assert execute(original, {8: flag}) == execute(derived, {8: flag})
    check('positive-step induction0→1→2 preserves effects', increasing)
    repeating = fixture(3)
    repeating['varnodes'][2]['offset'] = 0
    check('unchanging cyclic SSA state rejected', lambda: rejected(repeating))
    def signed_sentinel():
        for size, signed_literal in ((1, False), (2, False), (4, False), (4, True)):
            original = fixture(3)
            for variable in original['varnodes']:
                variable['size'] = size
            original['varnodes'][2]['offset'] = -1 if signed_literal else (1 << (size * 8)) - 1
            test = original['blocks'][4]['ops'][2]
            test['opcode'], test['inputs'] = 'INT_SLESS', ['v2', 'v13']
            derived, proofs = expand(original)
            assert proofs[0]['block_visits']['1'] == 4
            assert proofs[0]['arithmetic_wraps']
            for flag in (0, 1):
                assert execute(original, {8: flag}) == execute(derived, {8: flag})
    check('signed countdown3→2→1→0→minus1 sentinel at8/16/32bit preserves effects', signed_sentinel)
    def wrapping_cycle():
        original = fixture(0)
        for variable in original['varnodes']:
            variable['size'] = 1
        original['varnodes'][2]['offset'] = 64
        unreachable = 'v'+str(len(original['varnodes']))
        original['varnodes'].append(dict(id=unreachable, size=1, constant=True, offset=1, input=False, space='const'))
        original['blocks'][4]['ops'][2]['inputs'][1] = unreachable
        rejected(original)
    check('exact wrapping0→64→128→192→0 cycle rejected', wrapping_cycle)
    check('iteration65 rejected', lambda: rejected(fixture(65)))
    check('operation budget rejected', lambda: rejected(fixture(), max_expanded_ops=8))
    check('modular countdown exceeding64visits rejected', lambda: rejected(fixture(0)))
    uncertain = fixture()
    uncertain['blocks'][0]['ops'][0].update(opcode='LOAD', inputs=['v1', 'v4'])
    check('mutable induction seed rejected', lambda: rejected(uncertain))
    induction = fixture()
    induction['blocks'][4]['ops'][2]['inputs'][0] = 'v8'
    check('mutable termination guard rejected', lambda: rejected(induction))
    acyclic = fixture(1)
    acyclic['blocks'][4]['successors'] = [5]
    acyclic['blocks'][4]['ops'] = acyclic['blocks'][4]['ops'][:-1]
    acyclic['blocks'][1]['predecessors'] = [0]
    def unchanged():
        result, proofs = expand(acyclic)
        assert result == acyclic and result is not acyclic and not proofs
    check('acyclic source independently copied', unchanged)
    def raw_source():
        original = json.loads(RAW.read_text())
        snapshot = copy.deepcopy(original)
        t = time.perf_counter()
        derived, proofs = expand(original)
        elapsed = time.perf_counter() - t
        assert original == snapshot
        assert proofs[0]['block_visits']['1'] == 2
        assert len(proofs[0]['exact_branches']) == 2
        assert [b['exact_value'] for b in proofs[0]['exact_branches']] == [1, 0]
        assert len([o for b in derived['blocks'] for o in b['ops'] if o.get('source_op') == 'op11']) == 2
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT/'08071514.expanded.json').write_text(json.dumps(derived, indent=2)+'\n')
        (OUT/'08071514.proofs.json').write_text(json.dumps(proofs, indent=2)+'\n')
        timings.append(dict(check='actual ROM-source CFG expansion only', wall_s=elapsed, outcome='pass',
                            source= str(RAW.relative_to(ROOT)), source_sha256=hashlib.sha256(RAW.read_bytes()).hexdigest(),
                            expanded_ops=proofs[0]['expanded_ops'], native_differential='unavailable_in_this_script'))
    if RAW.exists():
        check('original SMA2 source allocation scan9→8 with both LOADop11 copies', raw_source)
    coverage_sources = [
        ('tekken-08011ea4', ROOT/'local/ir/queue-runs/20261016T091004/tekken-advance/l0/08011ea4.json', {'1': 4}),
        ('tekken-080130e8', ROOT/'local/ir/queue-runs/20261016T091004/tekken-advance/l0/080130e8.json', {'5': 4, '7': 16, '21': 16}),
        ('leafgreen-0803e3fc', ROOT/'local/ir/fleet-next/pokemon-leafgreen-version/ex030-secure-record/l0/0803e3fc.json', {'1': 6, '3': 6, '5': 6, '7': 6}),
    ]
    for name, path, visits in coverage_sources:
        if not path.exists():
            continue
        def actual_source(name=name, path=path, visits=visits):
            original = json.loads(path.read_text())
            snapshot = copy.deepcopy(original)
            before = time.perf_counter()
            derived, proofs = expand(original)
            elapsed = time.perf_counter()-before
            assert original == snapshot
            assert all(proofs[0]['block_visits'][block] == count for block, count in visits.items())
            assert proofs[0]['arithmetic_wraps']
            (OUT/(name+'.expanded.json')).write_text(json.dumps(derived, indent=2)+'\n')
            (OUT/(name+'.proofs.json')).write_text(json.dumps(proofs, indent=2)+'\n')
            timings.append(dict(check=name+' original source expansion only', outcome='pass', wall_s=elapsed,
                                source=str(path.relative_to(ROOT)), source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                expanded_ops=proofs[0]['expanded_ops'], native_differential='separate worker qualification'))
        check(name+' original source finite signed countdowns', actual_source)
    report = dict(run_id='bounded-cfg-coverage-wave', outcome='pass', checks=checks, timings=timings,
                  total_wall_s=time.perf_counter()-started, queue_s=None,
                  source_commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  machine=platform.platform(), python=platform.python_version(),
                  harness='bounded_cfg.expand/v3', scope='source compiler regression; no game template',
                  timing_context={'build_mode': 'not_applicable', 'cache': 'not_applicable',
                                  'baseline': 'see before-after.json for same-source signed-only versus SSA-alias measurements',
                                  'nested': 'actual source expansion included in its check wall time; check times included in total'})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    run()
