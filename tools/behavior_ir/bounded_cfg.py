"""Bounded source-CFG expansion with edge-specific SSA renaming.

Only pure, exact SSA values may discharge a branch. Mutable loads, calls and
INDIRECT values never justify a bound. Every remaining runtime edge is explored;
reaching a budget rejects the complete transform, rather than truncating a path.
No game addresses, recovered C, or handwritten behavior are used.
"""
import copy
import hashlib
import json


class UnsupportedLoop(ValueError):
    pass


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def expand(l0, max_iterations=64, max_expanded_ops=4096):
    """Return independent acyclic SSA source and replayable expansion evidence.

    max_iterations bounds visits to any original block on an execution path.
    max_expanded_ops includes retained side effects and cloned phi copies.
    These limits can be tightened, but cannot exceed the compiler hard caps.
    """
    blocks = {b['id']: b for b in l0['blocks']}
    if not blocks:
        return copy.deepcopy(l0), []
    entry = min(blocks)
    def cyclic(bid):
        # Explicit DFS frames preserve the same active-path/backedge test while
        # avoiding Python recursion limits on long instruction-level source DAGs.
        active={bid};done=set();frames=[(bid,iter(blocks[bid]['successors']))]
        while frames:
            current,successors=frames[-1]
            successor=next(successors,None)
            if successor is None:
                frames.pop();active.remove(current);done.add(current);continue
            if successor in active:return True
            if successor in done:continue
            active.add(successor);frames.append((successor,iter(blocks[successor]['successors'])))
        return False

    if not cyclic(entry):
        return copy.deepcopy(l0), []
    if not 1 <= max_iterations <= 64 or not 1 <= max_expanded_ops <= 4096:
        raise UnsupportedLoop('bounded CFG limits must be within 64 visits and 4096 operations')
    if l0.get('jump_tables'):
        raise UnsupportedLoop('bounded CFG jump-table remapping is unproved')
    variables = {v['id']: copy.deepcopy(v) for v in l0['varnodes']}
    defined = {o['output'] for b in blocks.values() for o in b['ops'] if o.get('output')}
    exact = {v['id']: int(v['offset']) & ((1 << (v['size'] * 8)) - 1)
             for v in variables.values() if v['constant']}
    vnext = max(int(v[1:]) for v in variables) + 1
    onext = max((int(o['id'][2:]) for b in blocks.values() for o in b['ops']), default=-1) + 1
    # Liveness makes equivalent branch tails share a clone, without merging
    # different snapshots of loads or different loop-carried SSA values.
    defs, uses, phis = {}, {}, {}
    for bid, block in blocks.items():
        ds, us = set(), set()
        phis[bid] = [o for o in block['ops'] if o['opcode'] == 'MULTIEQUAL']
        for op in block['ops']:
            if op['opcode'] != 'MULTIEQUAL':
                us.update(i for i in op['inputs'] if i not in ds)
            if op.get('output'):
                ds.add(op['output'])
        defs[bid], uses[bid] = ds, us
    live = {bid: set(us) for bid, us in uses.items()}
    changed = True
    while changed:
        changed = False
        for bid, block in blocks.items():
            out = set()
            for succ in block['successors']:
                out.update(live[succ])
                sb = blocks[succ]
                if bid not in sb['predecessors']:
                    raise UnsupportedLoop('CFG predecessor mismatch')
                index = sb['predecessors'].index(bid)
                for phi in phis[succ]:
                    if len(phi['inputs']) != len(sb['predecessors']):
                        raise UnsupportedLoop('phi predecessor arity mismatch')
                    out.add(phi['inputs'][index])
            value = uses[bid] | (out - defs[bid])
            if value != live[bid]:
                live[bid] = value
                changed = True

    arithmetic_wraps = []

    def pure_value(op):
        code, ins = op['opcode'], op['inputs']
        # Memory, INDIRECT annotations and calls are intentionally absent.
        supported = {'COPY', 'CAST', 'INT_ADD', 'INT_SUB', 'INT_MULT',
                     'INT_EQUAL', 'INT_NOTEQUAL', 'INT_LESS', 'INT_LESSEQUAL',
                     'INT_SLESS', 'INT_SLESSEQUAL', 'INT_AND', 'INT_OR',
                     'INT_XOR', 'INT_ZEXT', 'INT_SEXT', 'SUBPIECE',
                     'INT_LEFT', 'INT_RIGHT', 'INT_SRIGHT', 'BOOL_NEGATE',
                     'BOOL_AND', 'BOOL_OR'}
        if code not in supported or not op.get('output') or any(i not in exact for i in ins):
            return None
        xs = [exact[i] for i in ins]
        a, b = xs[0], xs[1] if len(xs) > 1 else 0
        bits = variables[op['output']]['size'] * 8
        mask = (1 << bits) - 1

        def signed(value, var):
            width = variables[var]['size'] * 8
            value &= (1 << width) - 1
            return value - (1 << width) if value & (1 << (width - 1)) else value

        if code in ('COPY', 'CAST', 'INT_ZEXT'): value = a
        elif code == 'INT_ADD': value = a + b
        elif code == 'INT_SUB': value = a - b
        elif code == 'INT_MULT': value = a * b
        elif code == 'INT_EQUAL': value = int(a == b)
        elif code == 'INT_NOTEQUAL': value = int(a != b)
        elif code == 'INT_LESS': value = int(a < b)
        elif code == 'INT_LESSEQUAL': value = int(a <= b)
        elif code == 'INT_SLESS': value = int(signed(a, ins[0]) < signed(b, ins[1]))
        elif code == 'INT_SLESSEQUAL': value = int(signed(a, ins[0]) <= signed(b, ins[1]))
        elif code == 'INT_AND': value = a & b
        elif code == 'INT_OR': value = a | b
        elif code == 'INT_XOR': value = a ^ b
        elif code == 'INT_SEXT': value = signed(a, ins[0]) & mask
        elif code == 'SUBPIECE': value = a >> (8 * b)
        elif code == 'INT_LEFT': value = a << b if b < bits else 0
        elif code == 'INT_RIGHT': value = a >> b
        elif code == 'INT_SRIGHT': value = (signed(a, ins[0]) >> b) & mask
        elif code == 'BOOL_NEGATE': value = int(not a)
        elif code == 'BOOL_AND': value = int(bool(a) and bool(b))
        elif code == 'BOOL_OR': value = int(bool(a) or bool(b))
        if not 0 <= value <= mask:
            # P-code integers are finite bitvectors. Retain the exact modulo
            # result, including signed -1 sentinels; this does not prove a loop
            # bound by itself. All runtime edges must still terminate in the
            # expanded DAG within the unchanged resource limits.
            arithmetic_wraps.append({'source_op': op.get('source_op'),
                                     'output': op['output'], 'opcode': code,
                                     'width_bits': bits, 'inputs': xs,
                                     'unmasked_value': value, 'exact_value': value & mask})
        return value & mask

    output, memo, expanding = [], {}, set()
    op_count = 0
    clones, decisions = [], []
    imports_by_clone = {}
    aliases = {}
    pending_imports = {}
    defops = {o['output']: o['id'] for b in blocks.values() for o in b['ops'] if o.get('output')}

    def resolved(var, env):
        if var in env:
            return env[var]
        if var in defined:
            raise UnsupportedLoop('SSA definition does not dominate use: ' + var)
        return var

    def add_op(clone, op, source):
        nonlocal onext, op_count
        op_count += 1
        if op_count > max_expanded_ops:
            raise UnsupportedLoop('expanded operation budget exceeded')
        op['source_op'] = source
        op['id'] = 'op' + str(onext)
        onext += 1
        clone['ops'].append(op)
        clones.append({'op': op['id'], 'source_op': source, 'block': clone['id'],
                       'source_block': clone['source_block']})
        return op

    def fresh(old):
        nonlocal vnext
        new = 'v' + str(vnext)
        vnext += 1
        variables[new] = dict(variables[old], id=new, input=False)
        return new

    def visit(bid, pred, parent, env, visits):
        block = blocks[bid]
        incoming = {v: resolved(v, env) for v in live[bid]}
        for phi in phis[bid]:
            if pred not in block['predecessors']:
                raise UnsupportedLoop('phi entry predecessor missing')
            incoming[phi['output']] = resolved(phi['inputs'][block['predecessors'].index(pred)], env)
        # Runtime values may merge through explicit phis. Exact induction values
        # remain separate contexts, so no incoming edge can invalidate a proof.
        key = (bid, tuple((v, exact.get(value)) for v, value in sorted(incoming.items())))
        if key in expanding:
            raise UnsupportedLoop('cyclic SSA state has no exact terminating induction proof')
        if key in memo:
            clone_id = memo[key]
            clone = output[clone_id]
            if parent is not None:
                clone['predecessors'].append(parent)
                for var, op in imports_by_clone[clone_id].items():
                    op['inputs'].append(incoming[var])
                    if op['output'] in aliases and len(set(op['inputs'])) > 1:
                        # Until a genuinely different predecessor value arrives,
                        # this import is only an SSA alias, not an emitted op.
                        aliases.pop(op['output'])
                        add_op(clone, op, op['source_op'])
                        clone['ops'].remove(op)
                        clone['ops'].insert(0, op)
            return clone_id
        counts = dict(visits)
        counts[bid] = counts.get(bid, 0) + 1
        if counts[bid] > max_iterations:
            raise UnsupportedLoop('uncertain loop or iteration budget exceeded')
        expanding.add(key)
        clone_id = len(output)
        clone = {k: copy.deepcopy(v) for k, v in block.items()
                 if k not in ('ops', 'id', 'predecessors', 'successors', 'true_successor', 'false_successor')}
        clone.update(id=clone_id, predecessors=[] if parent is None else [parent], successors=[], ops=[], source_block=bid)
        output.append(clone)
        local = {}
        imports = {}
        for var, value in sorted(incoming.items()):
            if var not in defined:
                local[var] = value
                continue
            new = fresh(var)
            source = defops[var]
            imports[var] = {'opcode': 'MULTIEQUAL', 'output': new,
                            'inputs': [value], 'pc': next(o['pc'] for b in blocks.values() for o in b['ops'] if o['id'] == source),
                            'compiler_join': True, 'source_op': source}
            aliases[new] = value
            pending_imports[new] = imports[var]
            local[var] = new
            if value in exact:
                exact[new] = exact[value]
        imports_by_clone[clone_id] = imports
        branch = None
        for original in block['ops']:
            if original['opcode'] == 'MULTIEQUAL':
                continue  # Its incoming selection is represented above.
            op = copy.deepcopy(original)
            op['source_op'] = original.get('source_op', original['id'])
            op['inputs'] = [resolved(i, local) for i in original['inputs']]
            if original.get('output'):
                old = original['output']
                new = fresh(old)
                op['output'] = new
                local[old] = new
                value = pure_value(op)
                if value is not None:
                    exact[new] = value
            add_op(clone, op, original.get('source_op', original['id']))
            if op['opcode'] == 'CBRANCH':
                if branch is not None:
                    raise UnsupportedLoop('multiple conditional terminators')
                branch = op
        successors = list(block['successors'])
        if branch is not None:
            if set(successors) != {block.get('true_successor'), block.get('false_successor')}:
                raise UnsupportedLoop('conditional successor mismatch')
            condition = exact.get(branch['inputs'][1])
            if condition is not None:
                successors = [block['true_successor'] if condition else block['false_successor']]
                clone['ops'].remove(branch)
                decisions.append({'source_op': branch['source_op'], 'cloned_op': branch['id'],
                                  'condition_var': branch['inputs'][1], 'exact_value': condition,
                                  'source_target': successors[0], 'block': clone_id,
                                  'basis': 'pure_exact_width_masked_SSA_no_memory'})
        if len(successors) > 1 and branch is None:
            raise UnsupportedLoop('unproved multiway successor')
        for successor in successors:
            child = visit(successor, bid, clone_id, local, counts)
            clone['successors'].append(child)
            if branch is not None and len(successors) > 1:
                if successor == block['true_successor']:
                    clone['true_successor'] = child
                if successor == block['false_successor']:
                    clone['false_successor'] = child
        expanding.remove(key)
        memo[key] = clone_id
        return clone_id

    try:
        visit(entry, None, None, {}, {})
    except RecursionError as error:
        raise UnsupportedLoop('bounded CFG recursion resource limit') from error
    # Check the true longest per-source-block path after context merging; a
    # previously cached tail may be reached through a longer prefix.
    indegree = {b['id']: len(b['predecessors']) for b in output}
    pending = [b['id'] for b in output if not b['predecessors']]
    paths = {b['id']: {} for b in output}
    max_visits = {}
    visited = 0
    while pending:
        bid = pending.pop()
        visited += 1
        block = output[bid]
        counts = paths[bid]
        source = block['source_block']
        counts[source] = counts.get(source, 0) + 1
        for original, count in counts.items():
            max_visits[original] = max(max_visits.get(original, 0), count)
            if count > max_iterations:
                raise UnsupportedLoop('iteration budget exceeded after join merging')
        for child in block['successors']:
            for original, count in counts.items():
                paths[child][original] = max(paths[child].get(original, 0), count)
            indegree[child] -= 1
            if not indegree[child]:
                pending.append(child)
    if visited != len(output):
        raise UnsupportedLoop('expanded CFG is cyclic')
    def unalias(var):
        chain = set()
        while var in aliases:
            if var in chain:
                raise UnsupportedLoop('cyclic SSA import alias')
            chain.add(var)
            var = aliases[var]
        return var

    for block in output:
        for op in block['ops']:
            op['inputs'] = [unalias(var) for var in op['inputs']]
    alias_proofs = [{'output': var, 'input': unalias(var),
                     'source_op': pending_imports[var]['source_op']}
                    for var in sorted(aliases)]
    result = copy.deepcopy(l0)
    result['blocks'] = output
    result['varnodes'] = list(variables.values())
    proof = {'kind': 'bounded_source_cfg_expansion', 'version': 3,
             'basis': 'all_runtime_edges_exhaustively_expanded_with_edge_selected_SSA_phis',
             'source_sha256': _digest(l0), 'derived_sha256': _digest(result),
             'max_iterations': max_iterations, 'max_expanded_ops': max_expanded_ops,
             'expanded_ops': op_count, 'source_ops': sum(len(b['ops']) for b in blocks.values()),
             'block_visits': {str(k): v for k, v in sorted(max_visits.items())},
             'clones': clones, 'exact_branches': decisions, 'ssa_import_aliases': alias_proofs,
             'arithmetic_wraps': arithmetic_wraps,
             'termination_policy': 'exact_modulo_values_are_not_bounds; all_runtime_edges_must_form_finite_DAG_within_caps',
             'memory_policy': 'loads_calls_stores_and_indirect_values_never_prove_branch_conditions'}
    return result, [proof]
