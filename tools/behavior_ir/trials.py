"""Bounded recurring native mashup viability trials, not a routine CI matrix."""
from pathlib import Path
import argparse,hashlib,itertools,json,datetime,time,copy,collections
from generate import OPTIONS,materialize,generate
from compose import build,Composer
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def preflight_diagnostics():
 root=ROOT/'local/ir/composition-trials';root.mkdir(parents=True,exist_ok=True);out=root/('preflight-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'));out.mkdir();request={'schema':'gameverse.ir.generation-request/0.1','request_id':'negative-preflight','selections':{'movement':'movement.aria-mzm','combat':'combat.mzm-impact','progression':'progression.minish-skills'}};base=materialize(request);rows=[]
 for case,expected in [('coordinate_frame','quantity/frame'),('quantization_order','explicit shift/order'),('inventory_shape','collection port contract mismatch')]:
  p=copy.deepcopy(base)
  if case=='coordinate_frame':p['state']['player_x']['semantic_type']['frame']='screen.x.left'
  elif case=='quantization_order':del p['components']['aria_x']['bindings']['field_0']['quantization']
  else:p['state']['learned_inventory']['count']=63
  start=time.perf_counter();diagnostic=None
  try:Composer(p,ROOT).generate()
  except Exception as error:diagnostic=str(error)
  rows.append({'case':case,'expected_diagnostic_fragment':expected,'diagnostic':diagnostic,'outcome':'pass'if diagnostic and expected in diagnostic else'failed','wall_s':time.perf_counter()-start,'scope':'preflight_only_no_compile_or_emulation'});(out/(case+'.composition.json')).write_text(json.dumps(p,indent=2)+'\n')
 report={'schema':'gameverse.ir.incompatibility-check/0.1','rows':rows,'outcome':'pass'if all(r['outcome']=='pass'for r in rows)else'failed'};(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return report

def run(max_trials=2,wall_s=45):
 start=time.perf_counter();root=ROOT/'local/ir/composition-trials';root.mkdir(parents=True,exist_ok=True);ledger=root/'index.json';prior=json.loads(ledger.read_text())if ledger.exists()else{'schema':'gameverse.ir.composition-trials/0.1','runs':[]};attempted={r['signature']for r in prior['runs']if r['outcome']=='pass'};count=0;results=[]
 choices={role:[v['id']for v in values if v['status']=='available']for role,values in OPTIONS.items()}
 for movement,combat,progression in itertools.product(choices['movement'],choices['combat'],choices['progression']):
  if count>=max_trials or time.perf_counter()-start>=wall_s:break
  request={'schema':'gameverse.ir.generation-request/0.1','request_id':'automatic-composition-trial','title':'IR VIABILITY','selections':dict(movement=movement,combat=combat,progression=progression),'qualification':{'run':True}};plan=materialize(request);identity={'plan':plan,'compiler':{p:sha(ROOT/'tools/behavior_ir'/p)for p in('compose.py','lower.py','runtime/runtime.c','runtime/runtime.h','runtime/startup.s','runtime/gba.ld')},'scenario':sha(ROOT/'tools/behavior_ir/qualify_composition.py'),'packages':{name:json.loads(Path(c['package']).read_text())['behavior_sha256']for name,c in plan['components'].items()}};signature=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
  if signature in attempted or sum(r['signature']==signature for r in prior['runs'])>=3:continue
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f');request_path=root/(stamp+'.request.json');request_path.write_text(json.dumps(request,indent=2)+'\n');out=root/stamp;result=generate(request_path,out);row={'signature':signature,'outcome':result['outcome'],'selections':request['selections'],'status':str(out/'status.json'),'rom_sha256':result.get('artifacts',{}).get('rom_sha256'),'wall_s':result['wall_s'],'identity':identity,'diagnostic':result.get('diagnostic')};prior['runs'].append(row);results.append(row);count+=1;ledger.write_text(json.dumps(prior,indent=2)+'\n');print(row['selections'],row['outcome'],row['rom_sha256'],flush=True)
 return results
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--preflight',action='store_true');p.add_argument('--max-trials',type=int,default=2);p.add_argument('--wall-s',type=float,default=45);a=p.parse_args();preflight_diagnostics()if a.preflight else run(a.max_trials,a.wall_s)
