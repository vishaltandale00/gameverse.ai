#!/usr/bin/env python3
"""One game-specific, bounded native Factory route; no RAM writes.
Route decisions are source-terrain switchbacks/pipe loops, not a generic right
button macro declared to be campaign success. Stage outputs retain provenance.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession
from sonic_metroid_game_probe import run as game
from sonic_metroid_campaign_probe import run as campaign

def run(rom,initial,out):
 out.mkdir(parents=True,exist_ok=False);(out/'qualifier-source.py').write_bytes(Path(__file__).read_bytes());start=time.monotonic();report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state':str(initial),'initial_state_sha256':hashlib.sha256(initial.read_bytes()).hexdigest(),'scope':'Source-guided native FactoryAct1→Act2 Varia/heat route; not full campaign proof','stages':[],'outcome':'running'}
 def stage(name,fn):
  now=time.monotonic()
  try:v=fn();report['stages'].append({'id':name,'outcome':'observed','wall_s':time.monotonic()-now});return v
  except BaseException as e:report['stages'].append({'id':name,'outcome':'failed','wall_s':time.monotonic()-now,'error':str(e)});raise
 def actions(name,state,items):return stage(name,lambda:game(rom,out/name,{'initial_state':str(state),'actions':items}))
 def route(name,state,frames,target=None):
  stage(name,lambda:campaign(rom,state,out/name,frames,target));r=json.loads((out/name/'report.json').read_text());return Path(r.get('stage_transition_state',r['checkpoint']))
 def shaft(state):
  dest=out/'lower-shaft';s=NativeSession(rom,dest,ROOT/'tools/re/session/build/gba-session',initial_state=state);events=[];acts=[];now=time.monotonic()
  def act(keys,n):acts.append({'keys':keys,'frames':n});s.act({'keys':keys,'frames':n},120)
  def snap(name):
   b=s.read_memory(0x3005a20,68);v=lambda a,n=2,sg=False:int.from_bytes(b[a:a+n],'little',signed=sg);e={'name':name,'frame':s.frame,'x':v(0,4,True)/256,'y':v(4,4,True)/256,'vx':v(8,2,True),'vy':v(10,2,True),'flags':v(16,4)};events.append(e);return e
  try:
   s.start_recording(3);snap('initial');act(['RIGHT'],120);act(['L'],1)
   for i in range(80):
    if snap('seek-center')['x']<5420:break
    act(['LEFT'],4)
   act(['RIGHT'],8);act(['L'],60);e=snap('actual-shaft-floor');assert 5350<e['x']<5460 and 590<e['y']<630 and not e['flags']&2
   s.observe();act(['RIGHT'],120);snap('native-lower-route');s.observe();s._command('save 25');video=s.stop_recording()
  finally:s.close();(dest/'report.json').write_text(json.dumps({'rom_sha256':report['rom_sha256'],'initial_state':str(state),'events':events,'actions':acts,'wall_s':time.monotonic()-now,'video':locals().get('video')},indent=2)+'\n')
  return dest/'checkpoint-25.ss'
 try:
  actions('pipe-switchback',initial,[{'name':'ride-first-pipe','keys':['RIGHT','B'],'frames':140},{'name':'return-switchback','keys':['LEFT'],'frames':180},{'name':'ride-out','keys':['RIGHT'],'frames':240,'save':15}])
  state=route('midroute',out/'pipe-switchback/checkpoint-15.ss',3000,5540)
  state=stage('source-shaft-route',lambda:shaft(state))
  state=route('native-loop-route',state,3600,7945)
  state=route('upper-passage',state,1400)
  actions('wall-kick-passage',state,[{'name':'land-at-wall','keys':['RIGHT'],'frames':100},{'name':'brake','keys':['L'],'frames':1},{'name':'precision','keys':[],'frames':1},{'name':'jump-to-corner','keys':['RIGHT','A'],'frames':30},{'name':'release','keys':['RIGHT'],'frames':1},{'name':'wallkick-over-top','keys':['RIGHT','A'],'frames':30},{'name':'run-clear','keys':['RIGHT'],'frames':120,'save':25}])
  state=route('native-varia-entry',out/'wall-kick-passage/checkpoint-25.ss',2400)
  r=actions('varia-heat',state,[{'name':'native-entry-settle','keys':[],'frames':600},{'name':'approach-wall','keys':['RIGHT'],'frames':64},{'name':'high-over-wall','keys':['RIGHT','A'],'frames':40},{'name':'into-heat','keys':['RIGHT'],'frames':30},{'name':'heat-resistance','keys':['L'],'frames':180,'save':26}])
  first,last=r['events'][0],r['events'][-1];assert last['level']==3 and last['state']['upgrades']&32 and last['state']['max_energy']==149
  assert abs(last['x']-360)<100 and last['state']['energy']==first['state']['energy'] and last['state']['damage_taken']==first['state']['damage_taken']
  report['checkpoint']=r['checkpoints']['heat-resistance'];report['outcome']='natural_factory_varia_and_heat_passed'
 except BaseException as e:report.update(outcome='failed',error=str(e));raise
 finally:report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.state.resolve(),a.out.resolve())
