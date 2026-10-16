"""Bounded real-input held/released hover witness in generated clean ROMs."""
from pathlib import Path
import argparse,datetime,json,hashlib,sys,time
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/re/session'))
from bridge import NativeSession

def qualify(build,out):
 start=time.perf_counter();out.mkdir(parents=True,exist_ok=False);result={'schema':'gameverse.ir.sma1-mode-qualification/0.1','queue_s':None,'state_writes':False,'limits':{'max_frames_per_episode':430,'episodes':2,'wall_s':15},'rom_sha256':hashlib.sha256((build/'game.gba').read_bytes()).hexdigest(),'episodes':[],'outcome':'running'}
 try:
  for mode in('held','released'):
   session=NativeSession(build/'game.gba',out/mode,ROOT/'tools/re/session/build/gba-session',memory_profile=build/'memory-profile.json');rows=[]
   try:
    session.start_recording(2)
    for _ in range(10):
     session.act({'keys':[],'frames':3},120);facts=session.read_facts()
     if facts['ticks']>0:break
    session.act({'keys':['A'],'frames':4},120);rows.append(session.read_facts())
    for _ in range(12):
     if time.perf_counter()-start>15:raise RuntimeError('mode qualification wall cap')
     session.act({'keys':['A']if mode=='held'else[],'frames':30},120);rows.append(session.read_facts())
    observation=session.observe();video=session.stop_recording();result['episodes'].append({'mode':mode,'frames':session.frame,'observations':rows,'airborne_samples':sum(r['player_y']<128*256 for r in rows),'peak_hover':max(r['sma1_hover']for r in rows),'minimum_y':min(r['player_y']for r in rows),'image':observation['image'],'video':video})
   finally:session.close()
  held,released=result['episodes']
  if not(held['peak_hover']==48 and held['airborne_samples']>released['airborne_samples']and held['observations'][-1]['sma1_hover']==0):raise RuntimeError('finite held-hover/release consequence not witnessed')
  result['outcome']='pass'
 except Exception as error:result.update(outcome='failed',diagnostic=str(error))
 finally:result['wall_s']=time.perf_counter()-start;(out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('build',type=Path);p.add_argument('out',type=Path);a=p.parse_args();r=qualify(a.build.resolve(),a.out.resolve());print(json.dumps({k:r[k]for k in('outcome','wall_s')},indent=2));print(r.get('diagnostic'));raise SystemExit(r['outcome']!='pass')
