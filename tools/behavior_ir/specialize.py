"""Exact-domain, source-preserving CFG reduction before pointer classification.
Only branches whose SSA condition is immutable/exact are removed. Phi operands
keep original predecessor correspondence. Unknown runtime paths remain intact.
"""
import copy


def reduce_cfg(lifter):
    lifter.blocks = {key: copy.deepcopy(value) for key, value in lifter.blocks.items()}
    reductions = []
    while True:
        changed = False
        for block in lifter.blocks.values():
            branch = next((op for op in block['ops'] if op['opcode'] == 'CBRANCH'), None)
            if branch is None:
                continue
            try:
                taken = bool(lifter.literal(branch['inputs'][1]))
            except ValueError:
                continue
            target = block['true_successor'] if taken else block['false_successor']
            block['successors'] = [target]
            block['ops'].remove(branch)
            reductions.append({'provenance': branch['id'], 'condition': taken,
                               'basis': 'exact_input_domain_or_immutable_SSA'})
            changed = True
        if not changed:
            break
        reachable = set()
        pending = [min(lifter.blocks)]
        while pending:
            key = pending.pop()
            if key in reachable:
                continue
            reachable.add(key)
            pending.extend(lifter.blocks[key]['successors'])
        lifter.blocks = {key: block for key, block in lifter.blocks.items() if key in reachable}
        for block in lifter.blocks.values():
            predecessors = block['predecessors']
            keep = [i for i, key in enumerate(predecessors)
                    if key in reachable and block['id'] in lifter.blocks[key]['successors']]
            for op in block['ops']:
                if op['opcode'] == 'MULTIEQUAL':
                    op['inputs'] = [op['inputs'][i] for i in keep]
                    if len(op['inputs']) == 1:
                        op['opcode'] = 'COPY'
            block['predecessors'] = [predecessors[i] for i in keep]
        lifter.defs = {op['output']: op for block in lifter.blocks.values()
                       for op in block['ops'] if op.get('output')}
    lifter.domain_reductions = reductions
