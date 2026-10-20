"""Focused, dependency-free checks for finite acyclic L1 basic blocks."""
import copy
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

from contract import validate
from lower import lower


def ref(name):
    return {'op': 'local', 'name': name, 'type': 'u32'}


def constant(value):
    return {'op': 'const', 'type': 'u32', 'value': value}


def assign(name, value):
    return {'op': 'assign_local', 'local': name, 'value': value}


def jump(label):
    return {'op': 'jump', 'label': label, 'provenance': 'synthetic-edge'}


def block(label, body):
    return {'label': label, 'body': body}


def graph(blocks, start='block_0'):
    return {'op': 'control_flow', 'form': 'acyclic_basic_blocks/0.1',
            'start': start, 'blocks': blocks, 'provenance': 'synthetic-graph'}


def document(body):
    return {'schema': 'gameverse.l1.behavior/0.2', 'id': 'synthetic-basic-blocks',
            'parameters': [{'name': 'flag', 'storage_type': 'u32'}],
            'return_type': 'u32', 'state': [{'name': 'unused', 'storage_type': 'u32',
                                          'owner': 'synthetic', 'semantic_type': 'integer'}],
            'locals': [{'name': name, 'storage_type': 'u32'}
                       for name in ('a', 'b', 'tmp_a', 'tmp_b')],
            'collections': [], 'assets': [], 'body': body, 'phase': {},
            'verification': {}, 'preconditions': [], 'limitations': []}


def rejected(value):
    try:
        validate(value)
    except ValueError:
        return
    raise AssertionError('invalid basic-block graph accepted')


def run():
    start = time.perf_counter()
    diamond = graph([
        block('block_0', [{'op': 'if', 'condition': {'op': 'parameter', 'name': 'flag', 'type': 'u32'},
                           'then': [jump('block_1')], 'else': [jump('block_2')]}]),
        block('block_1', [assign('tmp_a', ref('a')), assign('tmp_b', ref('b')),
                          assign('a', ref('tmp_b')), assign('b', ref('tmp_a')),
                          jump('block_3')]),
        block('block_2', [assign('a', constant(10)), jump('block_3')]),
        block('block_3', [{'op': 'return', 'value': {'op': 'add_wrap', 'type': 'u32',
                                                   'args': [ref('a'), ref('b')]}}]),
    ])
    valid = document([assign('a', constant(2)), assign('b', constant(5)), diamond])
    assert validate(valid)
    source = lower(valid)
    assert source.count('ir_cf_0_block_3:;') == 1
    with tempfile.TemporaryDirectory() as directory:
        cfile = Path(directory) / 'basic_blocks.c'
        binary = Path(directory) / 'basic_blocks'
        cfile.write_text(source + '\nint main(void) { LiftedState s = {0}; '
                         'return behavior_0(&s, 1) == 7 && behavior_0(&s, 0) == 15 ? 0 : 1; }\n')
        subprocess.run(['cc', '-std=c11', '-Wall', '-Werror', '-Wno-unused-function', str(cfile), '-o', str(binary)], check=True,
                       stdout=subprocess.DEVNULL)
        subprocess.run([str(binary)], check=True)

    bad = copy.deepcopy(valid)
    bad['body'][-1]['blocks'][1]['body'][-1]['label'] = 'missing'
    rejected(bad)
    bad = copy.deepcopy(valid)
    bad['body'][-1]['blocks'][3]['body'] = [jump('block_0')]
    rejected(bad)
    bad = copy.deepcopy(valid)
    bad['body'][-1]['blocks'][3]['body'] = [assign('a', constant(1))]
    rejected(bad)
    bad = copy.deepcopy(valid)
    bad['body'][-1]['blocks'][3]['label'] = 'block_2'
    rejected(bad)
    bad = copy.deepcopy(valid)
    bad['body'][-1]['blocks'][3]['label'] = 'bad-label'
    rejected(bad)
    rejected(document([jump('block_0')]))
    chain = [block('block_'+str(i), [jump('block_'+str(i+1))])
             for i in range(4095)]
    chain.append(block('block_4095', [{'op': 'return', 'value': constant(0)}]))
    assert validate(document([graph(chain)]))
    rejected(document([graph(chain + [block('block_4096', [jump('block_0')])])]))

    nested = graph([block('block_0', [jump('block_1')]),
                    block('block_1', [{'op': 'leave_scope'}])])
    scoped = document([
        {'op': 'scope', 'dependency': 'first', 'body': [copy.deepcopy(nested)]},
        {'op': 'scope', 'dependency': 'second', 'body': [copy.deepcopy(nested)]},
        {'op': 'return', 'value': constant(0)},
    ])
    scoped['locals'] = []
    assert validate(scoped)
    generated = lower(scoped)
    labels = re.findall(r'\b(ir_cf_\d+_block_\d+):;', generated)
    assert len(labels) == len(set(labels)) == 4
    with tempfile.TemporaryDirectory() as directory:
        cfile = Path(directory) / 'nested.c'
        cfile.write_text(generated)
        subprocess.run(['cc', '-std=c11', '-Wall', '-Werror', '-Wno-unused-function', '-fsyntax-only', str(cfile)],
                       check=True, stdout=subprocess.DEVNULL)
    print(json.dumps({'outcome': 'pass', 'checks': ['diamond-and-edge-snapshots',
           'malformed-graphs', '4096-block-limit', 'nested-dependency-labels'],
           'wall_s': time.perf_counter()-start}))


if __name__ == '__main__':
    run()
