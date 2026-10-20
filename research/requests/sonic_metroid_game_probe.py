#!/usr/bin/env python3
"""Game-specific native first-draft scenarios. Only actual inputs and RAM reads.
Named savestates contain real emulator state, never invented progression bytes.
"""
import argparse,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(rom,out,sequence=None):
 started=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session');events=[]
 def step(keys,frames):
  while frames:
   n=min(120,frames);s.act({'keys':keys,'frames':n},120);frames-=n
 def u(a,n=4):return int.from_bytes(s.read_memory(a,n),'little')
 def snapshot(name):
  p=s.read_memory(0x03005a20,144);t=u(0x03001220);state=0;tasks=[]
  for i in range(128):
   if not 0x03000000<=t<0x03008000:break
   raw=s.read_memory(t,20);off=int.from_bytes(raw[6:8],'little');tasks.append({'task':hex(t),'callback':hex(int.from_bytes(raw[8:12],'little')),'data':hex(0x3000000+off),'priority':int.from_bytes(raw[16:18],'little'),'flags':int.from_bytes(raw[18:20],'little')})
   if int.from_bytes(raw[18:20],'little')==2 and int.from_bytes(raw[16:18],'little')==0xff00 and off and u(0x3000000+off)==0x324d5647:state=0x3000000+off
   t=0x03000000+int.from_bytes(raw[4:6],'little')
   if t==0x03000000:break
  v=lambda a,n=2,sg=False:int.from_bytes(p[a:a+n],'little',signed=sg)
  e={'name':name,'frame':s.frame,'x':v(0,4,True)/256,'y':v(4,4,True)/256,'vx':v(8,2,True),'vy':v(10,2,True),'speed':v(12,2,True),'flags':hex(v(16,4)),'pose':v(64,1),'plane':v(39,1),'player_task':hex(v(96,4)),'level':u(0x300514c,1),'tasks':tasks,'state_address':hex(state)}
  if state:
   b=s.read_memory(state,188);q=lambda a,n=2:int.from_bytes(b[a:a+n],'little')
   e['state']={**{k:q(a,n) for k,a,n in [('frame',4,4),('upgrades',8,4),('visited',12,4),('tiles',20,4),('energy',24,2),('max_energy',26,2),('missiles',28,2),('max_missiles',30,2),('charge',34,2),('cooldown',36,2),('iframes',38,2),('shots_fired',44,2),('shots_hit',46,2),('native_kills',48,2),('alien_kills',50,2),('gates_opened',52,2),('relics_collected',54,2),('damage_taken',56,2),('deaths',58,2),('stage',176,1),('morph',177,1),('ledge',178,1),('wall_kicks',182,1),('ledge_grabs',183,1),('momentum',180,1),('active',185,1),('message',187,1)]},'picked':[q(60+i*2) for i in range(18)],'opened':[q(96+i*2) for i in range(18)]}
   def arrays(base,stride,count):
    return [s.read_memory(state+base+i*stride,stride).hex() for i in range(count)]
   e['state']['relay']={'trips':u(state+1000,2),'from':u(state+1002,1),'to':u(state+1003,1)}
   e['state']['mzm_impact']={'calls':u(state+1246,2),'deaths':u(state+1248,2),'context_counter':u(state+1244,1),'native':arrays(1004,10,16),'alien':arrays(1164,10,8)}
   e['state']['mzm_ecology']={'steps':u(state+1514,2),'draws':u(state+1516,2),'tiles':u(state+1476,4),'palette':u(state+1512,1)}
   e['rippers']=arrays(1252,28,8)
   e['shots']=arrays(188,16,8);e['aliens']=arrays(316,28,8);e['prefabs']=arrays(932,8,8)
  for task in tasks:
   callback=int(task['callback'],0);data=int(task['data'],0)
   if callback==0x08087641:
    task['handle_data']=s.read_memory(data,184).hex()
    task['handle_screen_xy']=[u(data+162,2),u(data+164,2)]
    task['handle_attached_mask']=u(data+180,1)
   if 0x08025000<=callback<0x0803b000 and 0x030023a0<=data<0x03007f00:
    task['boss_candidate_data']=s.read_memory(data,192).hex()
  events.append(e);return e
 report={'rom_sha256':sha(rom),'probe_sha256':sha(__file__),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'adapter':'mgba-session/2','actions':(sequence or {}).get('actions'),'initial_state':({'ref':sequence['initial_state'],'sha256':sha(sequence['initial_state'])} if sequence and sequence.get('initial_state') else None),'emulator':s.emulator,'events':events,'observations':[],'queue_s':None,'scope':'Actual game-specific input/observable feature scenarios; no claim of full campaign traversal'}
 try:
  if sequence and sequence.get('initial_state'):
   import shutil
   shutil.copyfile(sequence['initial_state'],out/'checkpoint-0.ss');s._command('load 0');step([],1)
  else:
   step([],180)
   for i in range(38):step(['START'] if i%2==0 else ['A'],6);step([],54)
  snapshot('game-start');s._command('save 1');report['checkpoint']=str(out/'checkpoint-1.ss');s.start_recording(2)
  for event in (sequence or {}).get('actions',[{'name':'beam-at-start','keys':['B'],'frames':18},{'name':'approach-creature','keys':['RIGHT','B'],'frames':24},{'name':'beam-contact','keys':['B'],'frames':48},{'name':'morph-cache','keys':['RIGHT','B'],'frames':45},{'name':'ball','keys':['DOWN'],'frames':1},{'name':'ball-hold','keys':[],'frames':15},{'name':'stand','keys':['UP'],'frames':1}]):
   step(event['keys'],event['frames']);snapshot(event['name']);report['observations'].append({'name':event['name'],**s.observe()})
   if event.get('save'):
    s._command('save %d'%event['save']);report.setdefault('checkpoints',{})[event['name']]=str(out/('checkpoint-%d.ss'%event['save']))
  report['video']=s.stop_recording();report['outcome']='observed'
 except BaseException as e:report.update(outcome='failed',error=str(e));raise
 finally:
  s.close();report['wall_s']=time.monotonic()-started;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 return report
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--rom',type=Path,required=True);a.add_argument('--out',type=Path,required=True);a.add_argument('--sequence',type=Path);p=a.parse_args();r=run(p.rom.resolve(),p.out.resolve(),json.loads(p.sequence.read_text()) if p.sequence else None);print(json.dumps({'outcome':r['outcome'],'wall_s':r['wall_s'],'events':[{k:e[k] for k in ['name','x','y','state_address','state'] if k in e} for e in r['events']]}))
