#!/usr/bin/env python3
"""Bounded own-ROM Factory2 wall/grip/handle route, actual native inputs only."""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from sonic_metroid_game_probe import run as game
from sonic_metroid_campaign_probe import run as campaign
from tools.re.session.bridge import NativeSession

def run(rom,initial,out):
 out.mkdir(parents=True,exist_ok=False);started=time.monotonic();stages=[]
 report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state':str(initial),'initial_state_sha256':hashlib.sha256(initial.read_bytes()).hexdigest(),'probe_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'stages':stages,'outcome':'running','scope':'Natural Factory2 wall kick/powergrip/native moving-handle authority, not finale proof'}
 def actions(name,state,items):
  now=time.monotonic();r=game(rom,out/name,{'initial_state':str(state),'actions':[dict(name=n,keys=k,frames=f,save=20+i) for i,(n,k,f) in enumerate(items)]});stages.append({'id':name,'wall_s':time.monotonic()-now,'outcome':'observed'});return Path(r['checkpoints'][items[-1][0]])
 def handle(state):
  dest=out/'native-handle-transfer';s=NativeSession(rom,dest,ROOT/'tools/re/session/build/gba-session',initial_state=state);events=[];acts=[];now=time.monotonic()
  def read(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
  def snap(name):
   e={'name':name,'frame':s.frame,'x':read(0x3005a20,4,True)/256,'y':read(0x3005a24,4,True)/256,'vx':read(0x3005a28,2,True),'vy':read(0x3005a2a,2,True),'flags':read(0x3005a30),'pose':read(0x3005a60,1),'momentum':read(0x3002c10+180,1)};events.append(e);return e
  def act(keys,frames):acts.append({'keys':keys,'frames':frames});s.act({'keys':keys,'frames':frames},120)
  try:
   s.start_recording(2);e=snap('initial-original-handle');assert e['flags']&0x400008==0x400008 and e['momentum']==1
   previous=e['x']
   for i in range(32):
    e=snap('seek-returning-left-window')
    if e['x']<2210 and e['x']>previous:break
    previous=e['x'];act([],8)
   else:raise AssertionError('Native handle did not reach left transfer window within256frames')
   s.observe();act(['LEFT','A'],2);e=snap('native-release-impulse');s.observe();assert e['vy']<=-1200 and not e['flags']&0x400000
   for i in range(8):
    act(['LEFT','A'],8);e=snap('transfer-left');s.observe()
    if e['flags']&0x400008==0x400008:break
   assert e['flags']&0x400008==0x400008 and e['x']<2150, 'First original handle was not caught'
   s.observe()
   for i in range(32):
    act([],8);e=snap('first-handle-left-window')
    if e['x']<2068:break
   else:raise AssertionError('First handle did not reach upperwest release window')
   act(['LEFT','A'],48);snap('upperwest-approach');s.observe();act(['L'],16);e=snap('upperwest-native-floor');s.observe()
   assert e['x']<2016 and e['y']<914 and not e['flags']&2, 'Upper route was not landed'
   s._command('save 25');report['handle_checkpoint']=str(dest/'checkpoint-25.ss');video=s.stop_recording()
  finally:s.close();(dest/'report.json').write_text(json.dumps({'rom_sha256':report['rom_sha256'],'initial_state':str(state),'events':events,'actions':acts,'wall_s':time.monotonic()-now,'video':locals().get('video')},indent=2)+'\n')
  return dest/'checkpoint-25.ss'
 try:
  now=time.monotonic();campaign(rom,initial,out/'lower-route',2400,2140);stages.append({'id':'lower-route','wall_s':time.monotonic()-now,'outcome':'observed'});state=Path(json.loads((out/'lower-route/report.json').read_text())['checkpoint'])
  state=actions('spring-wall',state,[('coast-to-wall',['RIGHT','B'],40),('brake',['L'],30),('wait-spring',['L','RIGHT','A'],24),('spring-return',['RIGHT','A'],24)])
  state=actions('first-wall-kick',state,[('reset-edge',['L','RIGHT'],1),('wall-kick-low',['L','RIGHT','A'],12)])
  state=actions('second-wall-kick',state,[('return-to-wall',['RIGHT','A'],12),('reset-edge',['L','RIGHT'],1),('second-wall-kick',['L','RIGHT','A'],6),('rise-over-corner',['RIGHT','A'],24),('grip-contact',['RIGHT','B'],36)])
  state=actions('powergrip-pullup',state,[('reset-grip-edge',['RIGHT'],1),('pull-up',['RIGHT','A'],8),('cross-corner',['RIGHT','A'],26)])
  state=actions('brake-edge',state,[('land-at-edge',['L'],12)])
  state=actions('original-handle-grab',state,[('wait-swing-phase',['L'],72),('jump-to-handle',['LEFT','A'],32),('native-handle-ride',[],32)])
  report['checkpoint']=str(handle(state));report['outcome']='wall_grip_two_original_handles_upperwest_route_passed'
 except BaseException as e:report.update(outcome='failed',error=str(e));raise
 finally:report['wall_s']=time.monotonic()-started;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.state.resolve(),a.out.resolve())
