"""Read-only bounded L0 dependency expansion for the optional automatic queue."""
from pathlib import Path
import argparse,datetime,json,os,subprocess,time
from pipeline import ROOT,save,sha

def expand(queue_path,game,entries,wall_s=75):
 q=json.loads(queue_path.read_text());item=next(i for i in q['items']if i['id']==game);entries=list(dict.fromkeys(f'{int(e,16):08x}'for e in entries));stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f');out=ROOT/'local/ir/dependency-exports'/stamp/game;out.mkdir(parents=True,exist_ok=False);start=time.perf_counter();attempt={'run_id':stamp,'kind':'mechanics_dependency_expansion','requested_entries':entries,'outcome':'running','rom_sha256':sha(ROOT/item['rom']),'exporter_sha256':sha(ROOT/'tools/behavior_ir/ExportBehavior.java'),'stages':[]};item['attempts'].append(attempt);save(queue_path,q)
 try:
  if not 1<=len(entries)<=64:raise ValueError('dependency expansion entry cap is1..64')
  selection=out/'selection.json';selection_data={'priority_entries':entries,'limit':len(entries),'budget_s':min(45,wall_s)}
  evidence_path=ROOT/'research/deep-extraction/mario/sma4-actor-dispatch.json'
  if evidence_path.exists():
   evidence=json.loads(evidence_path.read_text())
   if evidence['game']==game and evidence['rom_sha256']==attempt['rom_sha256']:
    abi=evidence['walking_hopping_cluster']['pair_call_abi'];span=abi['instruction_range'];offset=int(span['address'],16)-0x08000000;raw=(ROOT/item['rom']).read_bytes()
    if __import__('hashlib').sha256(raw[offset:offset+span['size']]).hexdigest()!=span['sha256']:raise ValueError('ABI instruction proof identity mismatch')
    selection_data['signature_overrides']={abi['callee_entry']:{'arguments':['u32','u32','u16'],'return':'void','evidence':[str(evidence_path.relative_to(ROOT)),'instruction_sha256:'+span['sha256']]}}
  save(selection,selection_data)
  env=dict(os.environ,JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',JAVA_TOOL_OPTIONS='-Duser.home='+str(ROOT/'local/re/ghidra-user'))
  cmd=['/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless',str(ROOT/item['project_dir']),'gba','-process',item['program'],'-noanalysis','-readOnly','-scriptPath',str(ROOT/'tools/behavior_ir'),'-postScript','ExportBehavior.java',str(out/'l0'),'QUEUE',str(selection)]
  with(out/'export.log').open('w')as log:p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=wall_s)
  attempt['stages'].append({'name':'l0_dependency_export','wall_s':time.perf_counter()-start,'exit_code':p.returncode})
  if p.returncode or not(out/'l0/export-summary.json').exists():raise RuntimeError('dependency export failed; inspect retained export.log')
  attempt.update(outcome='dependency_export_complete',artifacts=str(out.relative_to(ROOT)),exported_entries=[e for e in entries if(out/'l0'/(e+'.json')).exists()]);attempt['missing_entries']=[e for e in entries if e not in attempt['exported_entries']]
 except Exception as error:attempt.update(outcome='failed',error=str(error))
 finally:
  attempt['wall_s']=time.perf_counter()-start;save(out/'receipt.json',attempt);save(queue_path,q)
 return attempt
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('queue',type=Path);p.add_argument('game');p.add_argument('entries',nargs='+');p.add_argument('--wall-s',type=float,default=75);a=p.parse_args();print(json.dumps(expand(a.queue,a.game,a.entries,a.wall_s),indent=2))
