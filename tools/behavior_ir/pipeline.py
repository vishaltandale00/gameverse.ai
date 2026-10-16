"""Optional resumable local queue for bounded ROM -> executable IR work.
This CLI is not required by either project's development/build workstream.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,platform,subprocess,time
from census import census
ROOT=Path(__file__).resolve().parents[2]
PRIORITY={
 'legend-of-zelda-the-the-minish-cap':{'progression':['0807ca84','0807caa0','0807aee4'],'combat':['08075314','08075580','08018308','08017874'],'movement':['080aef88']},
 'castlevania-aria-of-sorrow':{'combat':['08034624','08026008','08025f70','080683bc'],'progression':['08032588','080326b8','080441f8','080446d4'],'movement':['0806d430','0806d460']}}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(path,x):
 temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(x,indent=2)+'\n');temporary.replace(path)
def initialize(path):
 if path.exists():raise ValueError('queue already exists; advance it instead of replacing history')
 path.parent.mkdir(parents=True,exist_ok=True);inventory=json.loads((ROOT/'local/re/roms.json').read_text());items=[]
 for r in inventory:
  base=ROOT/'local/re/experiments/20261016-binary-corpus-round2'/r['id']/r['id'];project=base/'ghidra_project/gba.gpr'
  if r['id']=='sonic-advance':base=ROOT/'local/re/experiments/20261016-sonic-self-decompile/sonic-advance';project=base/'ghidra_project/gba.gpr'
  items.append({'id':r['id'],'rom':str((ROOT/'local/roms'/r['file']).relative_to(ROOT)),'project_dir':str(project.parent.relative_to(ROOT)),'functions':str((base/'functions.jsonl').relative_to(ROOT)),'program':r['file'],'state':'queued'if project.exists()else'blocked_missing_project','priority_targets':PRIORITY.get(r['id'],{}),'counts':{'exported':0,'static_candidates':0,'native_qualified':0,'composable_ports_ready':0,'mechanics_closure_ready':0},'attempts':[]})
 order={'legend-of-zelda-the-the-minish-cap':0,'castlevania-aria-of-sorrow':1,'metroid-zero-mission':98,'sonic-advance':99};items.sort(key=lambda x:(order.get(x['id'],2),x['id']))
 q={'schema':'gameverse.automatic-ir.queue/0.3','created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'environment':platform.platform(),'policy':{'exclude_mario':False,'max_roms_per_invocation':2,'total_wall_s':900,'export_script_budget_s':45,'export_process_timeout_s':75,'static_lift_budget_s':45,'candidate_functions_per_rom':800,'native_targets_per_depth_batch':8,'native_vectors_per_target':16384,'native_promotion':'explicit mechanics target plus qualified complete closure and semantic ports; never every static candidate'},'items':items,'runs':[]};save(path,q);return q

def advance(path,max_roms=None,total_s=None):
 q=json.loads(path.read_text());policy=q['policy'];started=time.perf_counter();run_id=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S');cap=max_roms or policy['max_roms_per_invocation'];budget=total_s or policy['total_wall_s'];completed=0
 run={'id':run_id,'outcome':'running','queue_s':None,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'policy':dict(policy,max_roms_per_invocation=cap,total_wall_s=budget),'items':[]};q['runs'].append(run);save(path,q)
 try:
  for item in q['items']:
   if completed>=cap or time.perf_counter()-started>=budget:break
   if item['state']not in('queued','retry_requested'):continue
   destination=ROOT/'local/ir/queue-runs'/run_id/item['id'];destination.mkdir(parents=True,exist_ok=False);attempt={'run_id':run_id,'outcome':'running','stages':[],'rom_sha256':sha(ROOT/item['rom']),'exporter_sha256':sha(ROOT/'tools/behavior_ir/ExportBehavior.java'),'source_functions_sha256':sha(ROOT/item['functions'])if(ROOT/item['functions']).exists()else None};item['attempts'].append(attempt);run['items'].append(item['id']);item['state']='exporting';save(path,q);t=time.perf_counter()
   try:
    target_entries=list(dict.fromkeys(e for values in item['priority_targets'].values()for e in values));selection={'priority_entries':target_entries,'limit':policy['candidate_functions_per_rom'],'budget_s':policy['export_script_budget_s']};selection_path=destination/'selection.json';save(selection_path,selection)
    env=dict(os.environ,JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',JAVA_TOOL_OPTIONS='-Duser.home='+str(ROOT/'local/re/ghidra-user'))
    cmd=['/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless',str(ROOT/item['project_dir']),'gba','-process',item['program'],'-noanalysis','-readOnly','-scriptPath',str(ROOT/'tools/behavior_ir'),'-postScript','ExportBehavior.java',str(destination/'l0'),'QUEUE',str(selection_path)]
    with(destination/'export.log').open('w')as log:process=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=min(policy['export_process_timeout_s'],max(1,budget-(time.perf_counter()-started))))
    attempt['stages'].append({'name':'l0_export_process','wall_s':time.perf_counter()-t,'exit_code':process.returncode});summary=destination/'l0/export-summary.json'
    if process.returncode or not summary.exists():raise RuntimeError('export process failed; inspect retained export.log')
    exported=json.loads(summary.read_text());item['counts']['exported']=exported['exported'];item['state']='lifting';save(path,q)
    r=census(destination/'l0',ROOT/item['rom'],destination/'l1-candidates',min(policy['static_lift_budget_s'],max(1,budget-(time.perf_counter()-started))))
    item['counts']['static_candidates']=r['l1_static_lifted'];attempt['stages'].append({'name':'static_l1_census','wall_s':r['wall_s'],'outcome':'completed'});attempt['artifacts']=str(destination.relative_to(ROOT));attempt['outcome']='discovery_complete';item['state']='depth_pending';completed+=1
    print(item['id'],item['counts'],flush=True)
   except Exception as error:attempt['outcome']='failed';attempt['error']=str(error);item['state']='failed_discovery';print(item['id'],'FAILED',str(error),flush=True)
   finally:attempt['wall_s']=time.perf_counter()-t;save(path,q)
  run['outcome']='bounded_invocation_complete'
 finally:run['wall_s']=time.perf_counter()-started;save(path,q)
 return q
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('operation',choices=['init','advance','status']);p.add_argument('queue',type=Path);p.add_argument('--max-roms',type=int);p.add_argument('--total-s',type=float);a=p.parse_args();q=initialize(a.queue)if a.operation=='init'else advance(a.queue,a.max_roms,a.total_s)if a.operation=='advance'else json.loads(a.queue.read_text());print(json.dumps({'states':{s:sum(i['state']==s for i in q['items'])for s in sorted({i['state']for i in q['items']})},'items':len(q['items'])},indent=2))
