"""One bounded real-input native route, with immutable-ROM evidence and no RAM writes."""
from pathlib import Path
import sys,json,time,hashlib,argparse
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/re/session'))
from bridge import NativeSession

def run(build,out):
 start=time.perf_counter();session=NativeSession(build/'game.gba',out,ROOT/'tools/re/session/build/gba-session',memory_profile=build/'memory-profile.json');report={'schema':'gameverse.new-rom-route/0.1','rom_sha256':session.game_version,'queue_s':None,'limits':{'max_frames':4200,'action_frames':30,'wall_timeout_s':30},'actions':[],'checkpoints':{},'outcome':'running','state_writes':False,'emulator':session.emulator,'harness_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'build_receipt_sha256':hashlib.sha256((build/'build-receipt.json').read_bytes()).hexdigest()}
 def step(keys,n=30,label=None):
  if session.frame+n>4200 or time.perf_counter()-start>30:raise RuntimeError('route budget exhausted')
  session.act({'keys':keys,'frames':n},120);facts=session.read_facts();report['actions'].append({'frame':session.frame,'keys':keys,'facts':facts})
  if label:report['checkpoints'][label]=session.observe()
  return facts
 try:
  session.start_recording(2);facts=step([],2,'boot')
  # Approach each guardian, stop short, and let actual shots land.
  for i,x in enumerate((264,440,574)):
   while facts['player_x']//256<x-90:facts=step(['RIGHT','B'],10)
   target=i+1
   while facts['kills']<target:facts=step(['B'],20)
   report['checkpoints']['guardian_'+str(i)]=session.observe()
  while facts['player_x']//256<586:facts=step(['RIGHT','B'],8)
  facts=step(['A','RIGHT'],8)
  facts=step(['RIGHT'],4)
  while not facts['pickup_taken']:
   facts=step([],4)
   if facts['player_y']//256>=128:facts=step(['A'],4)
  report['checkpoints']['acquired']=session.observe()
  while not facts['won']:facts=step(['RIGHT'],20)
  report['checkpoints']['completed']=session.observe();report['video']=session.stop_recording();report['outcome']='pass';report['final']=facts
  if not(facts['kills']==3 and facts['ability_mask']&1 and facts['gate_open']==1 and facts['won']==1):raise RuntimeError('connected route evidence missing')
 except Exception as e:
  report['outcome']='failed';report['error']=str(e)
  try:report['failure_observation']=session.observe();report['video']=session.stop_recording()
  except Exception:pass
 finally:
  session.close();report['wall_s']=time.perf_counter()-start;(out/'route-receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('build',type=Path);p.add_argument('out',type=Path);a=p.parse_args();r=run(a.build.resolve(),a.out.resolve());print(json.dumps({k:r[k]for k in('outcome','wall_s')},indent=2));print(r.get('error',r.get('final')));raise SystemExit(r['outcome']!='pass')
