#!/usr/bin/env python3
"""Target the original capsule switch from its own native task/geometry.
Uses real controller input; never changes task data, coordinates, or stage flags.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def run(rom,state,out):
 start=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session',initial_state=state);records=[];obs=[]
 def u(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
 def capsule():
  t=u(0x3001220)
  for i in range(128):
   if not 0x3000000<=t<0x3008000:return
   cb=u(t+8)
   if cb in [0x8016111,0x8016445,0x8016605]:
    d=0x3000000+u(t+6,2)
    return {'task':hex(t),'callback':hex(cb),'x':u(d+0x6c,2,True),'y':u(d+0x6e,2,True),'body':s.read_memory(d+0x2c,4).hex(),'button':s.read_memory(d+0x5c,4).hex()}
   t=0x3000000+u(t+4,2)
 def player():
  b=s.read_memory(0x3005a20,144);v=lambda a,n=2,sg=False:int.from_bytes(b[a:a+n],'little',signed=sg)
  return {'x':v(0,4,True)/256,'y':v(4,4,True)/256,'vy':v(10,2,True),'flags':v(16,4),'oy':v(15,1)}
 def step(keys,n):
  while n:
   k=min(n,120);s.act({'keys':keys,'frames':k},120);n-=k
 report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state_sha256':hashlib.sha256(state.read_bytes()).hexdigest(),'source':'USA08016444; capsule task data+6C/+6E center; native body/button boxes and original result flow','records':records,'observations':obs,'max_frames':2400,'outcome':'running'}
 try:
  s.start_recording(3);step([],240);jump=0;lastx=None;stuck=0
  for i in range(400):
   c=capsule();p=player();keys=[]
   if c and c['callback']=='0x8016605':report['outcome']='native_switch_pressed';obs.append(s.observe());break
   if not c:step([],6);continue
   dx=c['x']-p['x']
   if jump:
    keys=['A'];jump-=1
    if abs(dx)>10:keys+=['LEFT' if dx<0 else 'RIGHT']
    else:keys+=['L']
   elif abs(dx)>42 and stuck<4:keys=['LEFT' if dx<0 else 'RIGHT']
   elif not p['flags']&2:step(['L'],1);keys=['A','LEFT' if dx<0 else 'RIGHT'];jump=25;stuck=0
   else:keys=['L']
   records.append({'frame':s.frame,'capsule':c,'player':p,'keys':keys})
   step(keys,3)
   if lastx is not None and abs(p['x']-lastx)<1:stuck+=1
   else:stuck=0
   lastx=p['x']
   if i%20==0:obs.append(s.observe())
  if report['outcome']=='native_switch_pressed':step([],720);step(['A'],1);step([],480)
  s._command('save 25');report['checkpoint']=str(out/'checkpoint-25.ss');report['final_level']=u(0x300514c,1);obs.append(s.observe());report['video']=s.stop_recording()
  if report['outcome']=='running':report['outcome']='bounded_switch_not_completed'
 finally:s.close();report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['outcome','final_level','wall_s','checkpoint']}));return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.state.resolve(),a.out.resolve())
