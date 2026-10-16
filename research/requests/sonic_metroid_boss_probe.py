#!/usr/bin/env python3
"""Native first-boss tactic: target the actual source-owned cockpit, use beams,
charge/release, react to approach. Read-only state, real input, no HP/RAM writes.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def run(rom,state,out):
 start=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session',initial_state=state);records=[];obs=[]
 def u(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
 def boss():
  t=u(0x3001220)
  for i in range(128):
   if not 0x3000000<=t<0x3008000:return
   cb=u(t+8)
   if cb in [0x80260ed,0x8026499,0x8026ea1,0x8027839]:
    d=0x3000000+u(t+6,2);b=s.read_memory(d,160);v=lambda o,n=2,sg=False:int.from_bytes(b[o:o+n],'little',signed=sg)
    ptr=v(0,4);y=u(ptr+1,1)*8+v(6)*256
    return {'task':hex(t),'callback':hex(cb),'x':v(8,1)*8+v(4)*256+v(0x8c,4,True)/256,'y':y,'hits':v(0x9a,1),'invulnerability':v(0x9b,1),'primary':b[0x34:0x3c].hex(),'secondary':b[0x3c:0x44].hex()}
   t=0x3000000+u(t+4,2)
 def pstate():
  b=s.read_memory(0x3005a20,144);v=lambda o,n=2,sg=False:int.from_bytes(b[o:o+n],'little',signed=sg)
  return {'x':v(0,4,True)/256,'y':v(4,4,True)/256,'flags':v(16,4),'pose':v(64,1),'vx':v(8,2,True),'vy':v(10,2,True)}
 report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'state_sha256':hashlib.sha256(state.read_bytes()).hexdigest(),'emulator':s.emulator,'records':records,'observations':obs,'outcome':'running','max_frames':2400,'state_policy':'native checkpoints and input only; no RAM writes','source_contract':'USA080260EC task+9A hit counter,+9B invulnerability,0752 cockpit baseY, original phase2/defeat callbacks'}
 maxhits=0;missing=0
 try:
  s.start_recording(2)
  for i in range(200):
   b=boss();p=pstate();keys=['L'];r={'frame':s.frame,'boss':b,'player':p}
   if b:
    maxhits=max(maxhits,b['hits']);missing=0;dx=b['x']-p['x'];dy=(b['y']-28)-(p['y']-4)
    facing=bool(p['flags']&1);left=dx<0
    if facing!=left and not p['flags']&0x80:s.act({'keys':['LEFT' if left else 'RIGHT'],'frames':1},120)
    if i%5!=4:keys.append('B')
    if abs(dx)<140 and i%8<4:keys.append('A')
    if abs(dy)>max(20,abs(dx)*.5):
     keys.append('UP' if dy<0 else 'DOWN')
     if abs(dy)<abs(dx)*2:keys.append('LEFT' if left else 'RIGHT')
    if b['hits']>=8:keys=['L']
   elif maxhits>=8:
    missing+=1
    if missing>=3 and not p['flags']&0x80:report['outcome']='native_boss_defeated_and_removed';break
   elif not p['flags']&0x80:keys=['RIGHT']
   s.act({'keys':keys,'frames':12},120);r['keys']=keys;records.append(r)
   if i%10==0 or (b and b['hits']!=records[-2]['boss']['hits'] if len(records)>1 and records[-2]['boss'] else False):obs.append(s.observe())
  report['max_native_hits']=maxhits;s._command('save 30');report['checkpoint']=str(out/'checkpoint-30.ss');report['video']=s.stop_recording()
  if report['outcome']=='running':report['outcome']='bounded_route_not_completed'
 finally:s.close();report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['outcome','wall_s','max_native_hits','checkpoint']}))
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--rom',type=Path,required=True);a.add_argument('--state',type=Path,required=True);a.add_argument('--out',type=Path,required=True);p=a.parse_args();run(p.rom.resolve(),p.state.resolve(),p.out.resolve())
