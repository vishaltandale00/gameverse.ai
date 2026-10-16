"""Bounded static compiler coverage census. No function is qualified by this."""
from pathlib import Path
import argparse,collections,json,time,hashlib,signal,subprocess,platform
from lift import Lifter
from contract import validate

def census(source,rom,out,budget=45):
 out.mkdir(parents=True,exist_ok=False);raw=rom.read_bytes();start=time.perf_counter();rows=[];categories=collections.Counter();opcodes=collections.Counter();passed_opcodes=collections.Counter();export=json.loads((source/'export-summary.json').read_text());paths=sorted(source.glob('0*.json'))
 def timeout(*args):raise TimeoutError('per-function static lift budget')
 previous=signal.signal(signal.SIGALRM,timeout)
 for p in paths:
  if time.perf_counter()-start>budget:break
  row={'l0':p.name,'l0_sha256':hashlib.sha256(p.read_bytes()).hexdigest()};t=time.perf_counter()
  try:
   if p.stat().st_size>4*1024*1024:raise ValueError('L0 serialization exceeds4MiB analysis budget')
   signal.setitimer(signal.ITIMER_REAL,1)
   x=json.loads(p.read_text());ops=collections.Counter(o['opcode']for b in x['blocks']for o in b['ops']);opcodes.update(ops)
   l1,a=Lifter(x,raw).build();validate(l1);serialized=json.dumps(l1)
   if len(serialized)>2*1024*1024:raise ValueError('L1 serialization exceeds2MiB output budget')
   name='candidate_'+str(len(rows));destination=out/name;destination.mkdir();(destination/'l1.json').write_text(serialized);(destination/'validation-adapter.json').write_text(json.dumps(a));row.update(outcome='static_lift_only',candidate=name,operations=sum(ops.values()),blocks=len(x['blocks']),verification='unqualified');passed_opcodes.update(ops)
  except Exception as e:
   reason=str(e)or type(e).__name__;category=reason.split(' ')[0:5];category=' '.join(category);row.update(outcome='unsupported',reason=reason);categories[category]+=1
  finally:signal.setitimer(signal.ITIMER_REAL,0);row['wall_s']=time.perf_counter()-t;rows.append(row)
 signal.signal(signal.SIGALRM,previous);passed=sum(r['outcome']=='static_lift_only'for r in rows);denominator=export['requested']
 report={'schema':'gameverse.ir.compiler-census/0.2','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'environment':platform.platform(),'rom_sha256':hashlib.sha256(raw).hexdigest(),'queue_s':None,'limits':{'total_s':budget,'per_function_s':1,'max_l0_bytes':4*1024*1024,'max_l1_bytes':2*1024*1024,'expression_node_budget':100000,'structured_expansion_budget':2048},'denominator':denominator,'denominator_meaning':'existing candidate function entries; not complete ROM instruction coverage','l0_exported':export['exported'],'l0_percent':100*export['exported']/denominator,'l1_static_lifted':passed,'l1_static_percent':100*passed/denominator,'l1_qualified_sonic_known_functions':5,'l1_qualified_percent':100*5/denominator,'qualification_note':'Only selected native-qualified Sonic functions are composable. Static candidates are not promoted or considered ontology mechanics.','visited':len(rows),'budget_exhausted':len(rows)<len(paths),'unsupported_categories':dict(categories.most_common()),'pcode_ops_visited':dict(opcodes),'pcode_ops_in_successful_lifts':dict(passed_opcodes),'wall_s':time.perf_counter()-start,'export_stage':export,'rows':rows}
 (out/'census.json').write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('rom',type=Path);p.add_argument('out',type=Path);a=p.parse_args();r=census(a.source,a.rom,a.out);print(json.dumps({k:v for k,v in r.items()if k!='rows'},indent=2))
