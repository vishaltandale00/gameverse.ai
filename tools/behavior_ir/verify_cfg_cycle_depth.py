"""Deep finite DAG regression; no raised recursion or compiler resource limits."""
import copy
import json
import time
from bounded_cfg import expand


def run():
    source={'entry':'08000000','varnodes':[],'blocks':[{'id':i,'ops':[],'predecessors':[]if i==0 else[i-1],'successors':[i+1]if i<1499 else[]}for i in range(1500)]}
    original=copy.deepcopy(source);blocks={b['id']:b for b in source['blocks']};active=set();done=set()
    def previous(bid):
        if bid in active:return True
        if bid in done:return False
        active.add(bid);found=any(previous(s)for s in blocks[bid]['successors']);active.remove(bid);done.add(bid);return found
    before=time.perf_counter()
    try:previous(0)
    except RecursionError:baseline='recursion_error'
    else:baseline='completed'
    before_s=time.perf_counter()-before
    start=time.perf_counter();derived,proofs=expand(source);after_s=time.perf_counter()-start
    assert source==original and derived==source and not proofs
    print(json.dumps({'outcome':'pass','blocks':1500,'checks':3,'before_outcome':baseline,'before_wall_s':before_s,'after_outcome':'exact_unchanged_dag','after_wall_s':after_s,'limits':{'max_iterations':64,'max_expanded_ops':4096},'native_calls':0,'scope':'Synthetic source-depth regression, not native target qualification'}))


if __name__=='__main__':run()
