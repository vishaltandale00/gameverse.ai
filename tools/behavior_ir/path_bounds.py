"""Source-pinned dominating-edge SSA bounds, without changing executable paths.

Intervals describe unsigned bit-pattern storage. Signed predicates are converted
through two's-complement segments before intersection; a disjoint result is
conservatively represented by its hull. No facts cross distinct memory loads.
"""
import hashlib
import json


def _hull(parts, default):
    return (min(p[0] for p in parts), max(p[1] for p in parts)) if parts else default


def _signed_segments(lo, hi, bits):
    modulus = 1 << bits
    return ([(lo + modulus, min(hi, -1) + modulus)] if lo < 0 else []) + ([(max(lo, 0), hi)] if hi >= 0 else [])


def analyze(l0):
    """Return only facts proved by an edge dominating the consuming block.

    Unreachable blocks receive no facts. Cycles need no guessed iteration count:
    removing a dominating edge must disconnect the consumer from the entry.
    Malformed CFGs fail closed with no facts, rather than trusting predecessor
    lists or block numbering as a source of path conditions.
    """
    blocks = {b['id']: b for b in l0['blocks']}
    variables = {v['id']: v for v in l0['varnodes']}
    definitions = {o['output']: o for b in blocks.values() for o in b['ops'] if o.get('output')}
    empty = {'facts_by_block': {key: {} for key in blocks}, 'proofs': []}
    if not blocks:
        return empty
    roots = [b['id'] for b in blocks.values() if not b.get('predecessors')]
    if len(roots) != 1 or any(s not in blocks for b in blocks.values() for s in b['successors']):
        return empty
    entry = roots[0]
    def reachable(skip=None):
        seen, pending = set(), [entry]
        while pending:
            key = pending.pop()
            if key in seen:
                continue
            seen.add(key)
            pending.extend(s for s in blocks[key]['successors'] if (key, s) != skip)
        return seen
    live = reachable()
    def full(v):
        return 0, (1 << (variables[v]['size'] * 8)) - 1
    def literal(v, active=frozenset()):
        if v in active:
            return None
        z = variables[v]
        if z.get('constant'):
            return int(z['offset']) & full(v)[1]
        o = definitions.get(v)
        if o and o['opcode'] in ('COPY', 'CAST') and variables[o['inputs'][0]]['size'] == z['size']:
            return literal(o['inputs'][0], active | {v})
        return None
    def constrain(facts, v, segments, active=frozenset()):
        if v in active:
            return
        lo, hi = facts.get(v, full(v))
        pieces = [(max(lo, a), min(hi, b)) for a, b in segments if max(lo, a) <= min(hi, b)]
        # An impossible guard does not authorize deleting a path or inventing
        # an interval. Ignore its constraint; downstream qualification still
        # sees the original path.
        if not pieces:
            return
        result = _hull(pieces, (lo, hi))
        if result != full(v):
            facts[v] = result
        o = definitions.get(v)
        if not o:
            return
        source = o['inputs'][0] if o['inputs'] else None
        if source and ((o['opcode'] in ('COPY', 'CAST') and variables[source]['size'] == variables[v]['size']) or (o['opcode'] == 'INT_ZEXT' and variables[source]['size'] < variables[v]['size'])):
            limit = full(source)[1]
            constrain(facts, source, [(max(0, result[0]), min(limit, result[1]))], active | {v})
    candidates = []
    for key, block in blocks.items():
        branches = [o for o in block['ops'] if o['opcode'] == 'CBRANCH']
        if key not in live or len(branches) != 1:
            continue
        branch = branches[0]
        true, false = block.get('true_successor'), block.get('false_successor')
        if true == false or set(block['successors']) != {true, false}:
            continue
        for taken, successor in ((True, true), (False, false)):
            condition, truth, seen = branch['inputs'][1], taken, set()
            while condition not in seen:
                seen.add(condition)
                op = definitions.get(condition)
                if not op:
                    break
                if op['opcode'] in ('COPY', 'CAST', 'BOOL_NEGATE'):
                    if op['opcode'] in ('COPY', 'CAST') and variables[op['inputs'][0]]['size'] != variables[condition]['size']:
                        break
                    if op['opcode'] == 'BOOL_NEGATE':
                        truth = not truth
                    condition = op['inputs'][0]
                    continue
                break
            if not op or op['opcode'] not in ('INT_LESS', 'INT_LESSEQUAL', 'INT_SLESS', 'INT_SLESSEQUAL', 'INT_EQUAL', 'INT_NOTEQUAL'):
                continue
            a, b = op['inputs']
            if variables[a]['size'] != variables[b]['size']:
                continue
            ca, cb = literal(a), literal(b)
            if (ca is None) == (cb is None):
                continue
            v, c, reversed_ = (a, cb, False) if cb is not None else (b, ca, True)
            bits = variables[v]['size'] * 8
            signed = op['opcode'] in ('INT_SLESS', 'INT_SLESSEQUAL')
            minimum, maximum = (-(1 << (bits-1)), (1 << (bits-1))-1) if signed else full(v)
            if signed and c >= 1 << (bits-1):
                c -= 1 << bits
            code = op['opcode']
            if code in ('INT_EQUAL', 'INT_NOTEQUAL'):
                equality = truth == (code == 'INT_EQUAL')
                parts = [(c, c)] if equality else [(minimum, c-1), (c+1, maximum)]
            else:
                inclusive = code.endswith('LESSEQUAL')
                if reversed_:
                    parts = [(c + (not inclusive), maximum)] if truth else [(minimum, c - inclusive)]
                else:
                    parts = [(minimum, c - (not inclusive))] if truth else [(c + inclusive, maximum)]
            parts = [(max(minimum, lo), min(maximum, hi)) for lo, hi in parts if max(minimum, lo) <= min(maximum, hi)]
            if signed:
                parts = [p for lo, hi in parts for p in _signed_segments(lo, hi, bits)]
            facts = {}
            constrain(facts, v, parts)
            consumers = sorted(live - reachable((key, successor)))
            if facts and consumers:
                candidates.append((branch, key, successor, taken, consumers, facts))
    source = {k: v for k, v in l0.items() if k != 'wall_s'}
    digest = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    result = empty
    for branch, key, successor, taken, consumers, facts in candidates:
        for consumer in consumers:
            for v, interval in facts.items():
                old = result['facts_by_block'][consumer].get(v, full(v))
                intersection = max(old[0], interval[0]), min(old[1], interval[1])
                if intersection[0] <= intersection[1]:
                    result['facts_by_block'][consumer][v] = intersection
        result['proofs'].append({'kind': 'dominating_ssa_predicate_edge', 'source_sha256': digest,
            'entry': l0.get('entry'), 'branch': branch['id'], 'pc': branch.get('pc'),
            'edge': [key, successor], 'condition': taken, 'consuming_blocks': consumers,
            'facts': facts, 'method': 'entry_reachability_with_edge_removed'})
    return result


def bounds(expr, fallback, facts):
    """Optional Lifter.bounds hook; fallback recursively handles other nodes.

    The caller supplies facts for the actual consuming operation's block. The
    callback must be the ordinary bounds dispatcher (including this hook for
    children), and must not call itself with this same expression.
    """
    op = expr['op']
    if op == 'local' and expr.get('name', '').startswith('value_'):
        return facts.get('v' + expr['name'][6:])
    if op == 'sub_wrap':
        a, b = map(fallback, expr['args'])
        if a[0] >= b[1]:
            return a[0] - b[1], a[1] - b[0]
    return None
