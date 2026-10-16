#!/usr/bin/env python3
"""Bounded game-specific exploration using native inputs/checkpoints only."""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def run(rom,state,out,limit,stop_x=None):
 start=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session',initial_state=state);events=[];obs=[]
 def read(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
 def find():
  t=read(0x3001220)
  for i in range(128):
   if not 0x3000000<=t<0x3008000:break
   if read(t+18,2)==2 and read(t+16,2)==65280:return 0x3000000+read(t+6,2)
   t=0x3000000+read(t+4,2)
   if t==0x3000000:break
  return 0
 def sample():
  p=s.read_memory(0x3005a20,144);v=lambda a,n=2,sg=False:int.from_bytes(p[a:a+n],'little',signed=sg);a=find()
  r={'frame':s.frame,'x':v(0,4,True)/256,'y':v(4,4,True)/256,'vx':v(8,2,True),'vy':v(10,2,True),'speed':v(12,2,True),'angle':v(20,1),'flags':v(16,4),'pose':v(64,1),'level':read(0x300514c,1),'state':hex(a)}
  if a:r.update(upgrades=read(a+8),energy=read(a+24,2),kills=read(a+48,2),deaths=read(a+58,2),visited=read(a+12),active=read(a+185,1))
  events.append(r);return r
 report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state':{'path':str(state),'sha256':hashlib.sha256(state.read_bytes()).hexdigest()},'probe_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'limit_frames':limit,'events':events,'observations':obs,'outcome':'running'}
 try:
  s.start_recording(6);last=sample();stuck=0;jump=0;lastlevel=last['level'];best=last['x'];stalled=0
  for i in range(limit//20):
   keys=['RIGHT']
   if i%3!=2:keys.append('B')
   if jump:keys.append('A');jump-=1
   # Observe the real new seal, then use its required player action. This is a
   # game-specific play policy, not a write to progression or entity state.
   state=int(last['state'],0);target=None
   if state and last.get('active'):
    opened=read(state+96+last['level']*2,2)
    for slot in range(8):
     f=s.read_memory(state+932+slot*8,8);x=int.from_bytes(f[:2],'little',signed=True)
     if f[7] and f[4]==2 and not opened&(1<<f[6]) and abs(x-last['x'])<120:
      target=(x,f[5]);break
    if target and target[1]==2:
     keys=['RIGHT','R']+(['B'] if i%3!=2 else [])
    elif target and target[1]==3:
     keys=['RIGHT','DOWN']+(['B'] if i%3!=2 else [])
    elif read(state+177,1):keys.append('UP')
   # Repeating native spring bounces are not progress even when x moves.
   # Bounded novelty fallback jumps over them without any state mutation.
   s.act({'keys':keys,'frames':20},120);r=sample()
   if abs(r['x']-last['x'])<5 and r['active']:stuck+=1
   else:stuck=0
   if r['x']>best+8:best=r['x'];stalled=0
   else:stalled+=1
   if (stuck>=4 or stalled>=12) and not jump:jump=3;stuck=0;stalled=0
   if i%15==0 or r['level']!=lastlevel or r.get('deaths')!=last.get('deaths'):
    obs.append(s.observe());slot=12+(len(obs)-1)%18;s._command('save %d'%slot);report['checkpoint']=str(out/('checkpoint-%d.ss'%slot))
   if stop_x is not None and r['x']>=stop_x and r.get('active') and not r['flags']&128:
    s._command('save 31');report['checkpoint']=str(out/'checkpoint-31.ss');report['stop']='requested native route coordinate';break
   if r['level']!=lastlevel:
    s._command('save 11');report['stage_transition_state']=str(out/'checkpoint-11.ss')
    if r.get('active') and r['level']!=0:break
   lastlevel=r['level'];last=r
  report['video']=s.stop_recording();report['outcome']='observed'
 finally:s.close();report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'outcome':report['outcome'],'wall_s':report['wall_s'],'last':events[-1],'checkpoint':report.get('checkpoint')}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--frames',type=int,default=3600);p.add_argument('--stop-x',type=int);a=p.parse_args();assert 1<=a.frames<=7200;run(a.rom.resolve(),a.state.resolve(),a.out.resolve(),a.frames,a.stop_x)
