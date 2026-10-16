#!/usr/bin/env python3
"""Use the actual renewable factory specimen as an ice platform to open its gate.
Bounded native inputs/observations only. No ability, freeze or progression writes.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def run(rom,state,out):
 start=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session',initial_state=state);records=[];obs=[]
 def u(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
 def find():
  t=u(0x3001220)
  for i in range(128):
   if u(t+18,2)&2 and u(t+16,2)==65280:return 0x3000000+u(t+6,2)
   t=0x3000000+u(t+4,2)
   if t==0x3000000:break
  raise ValueError('campaign state missing')
 a=find();jump=0;shot_cooldown=0;stage=u(a+176,1);gate_id=7 if stage==0 else 2;gate_x=1190 if stage==0 else 210;ground=435 if stage==0 else 141;report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state_sha256':hashlib.sha256(state.read_bytes()).hexdigest(),'max_frames':1800,'records':records,'observations':obs,'outcome':'running'}
 try:
  s.start_recording(2)
  for i in range(450):
   p=s.read_memory(0x3005a20,144);v=lambda o,n=2,sg=False:int.from_bytes(p[o:o+n],'little',signed=sg)
   px=v(0,4,True)/256;py=v(4,4,True)/256;flags=v(16,4);aliens=[s.read_memory(a+316+n*28,28) for n in range(8)];b=next((b for b in aliens if b[22]==2 and b[24]==gate_id),aliens[0]);q=lambda o,n=2,sg=False:int.from_bytes(b[o:o+n],'little',signed=sg)
   ax=q(0,4,True)/256;ay=q(4,4,True)/256;freeze=q(20);active=q(25,1);hp=q(16);support=u(a+181,1);opened=u(a+96+stage*2,2)
   r={'frame':s.frame,'player':{'x':px,'y':py,'flags':hex(flags),'vy':v(10,2,True)},'specimen':{'x':ax,'y':ay,'hp':hp,'freeze':freeze,'active':active,'phase':q(23,1)},'upgrades':u(a+8),'energy':u(a+24,2),'frozen_support':support,'opened_stage2':opened}
   if opened&(1<<gate_id):report['outcome']='frozen_creature_platform_opened_gate';records.append(r);obs.append(s.observe());break
   keys=['L'];shot_cooldown=max(0,shot_cooldown-4)
   if active and freeze:
    dx=ax-px
    if not jump and not flags&2:
     if abs(dx)>32:keys=['LEFT' if dx<0 else 'RIGHT']
     else:jump=1;keys=['A','LEFT' if dx<0 else 'RIGHT']
    elif jump:
     keys=['A'] if jump<44 else []
     keys+=['LEFT' if dx<0 else 'RIGHT'] if abs(dx)>8 else ['L'];jump+=4
     if jump>60 and not flags&2:jump=0
   elif active and not flags&2:
    jump=0;dy=ay-(py-4);left=ax<px;desired=ax+abs(dy) if left else ax-abs(dy)
    if abs(px-desired)>8:keys=['LEFT' if px>desired else 'RIGHT']
    elif ground-42<=ay<=ground-25 and gate_x-80<=ax<=gate_x+5 and not shot_cooldown:
     keys=['L','UP','LEFT' if left else 'RIGHT','B'];shot_cooldown=16
   r['keys']=keys;records.append(r);s.act({'keys':keys,'frames':4},120)
   if i%20==0:obs.append(s.observe())
  if report['outcome']=='running':report['outcome']='bounded_ice_route_not_completed'
  s._command('save 29');report['checkpoint']=str(out/'checkpoint-29.ss');report['video']=s.stop_recording()
 finally:s.close();report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['outcome','wall_s','checkpoint']}));return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.state.resolve(),a.out.resolve())
