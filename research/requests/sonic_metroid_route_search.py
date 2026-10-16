#!/usr/bin/env python3
"""Bounded game-specific checkpoint search; native save/load, never RAM mutation.
Every retained node is an actual emulator state plus its exact input history.
Not a general acceptance gate; replay the found route on the exact cartridge.
"""
import argparse,hashlib,heapq,json,shutil,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def run(rom,initial,out,limit):
 start=time.monotonic();s=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session',initial_state=initial)
 def r(a,n=4,sg=False):return int.from_bytes(s.read_memory(a,n),'little',signed=sg)
 def sample():
  return {'x':r(0x3005a20,4,True)/256,'y':r(0x3005a24,4,True)/256,'vx':r(0x3005a28,2,True),'vy':r(0x3005a2a,2,True),'flags':r(0x3005a30),'plane':r(0x3005a47,1),'angle':r(0x3005a34,1),'stage':r(0x300514c,1),'pose':r(0x3005a60,1),'native_frame':r(0x3005120)}
 def key(e):return (int(e['x']//24),int(e['y']//16),e['plane'],bool(e['flags']&2),e['vx']//512,e['vy']//512)
 def score(e):return e['y']+abs(e['x']-1560)*0.08
 actions=[('right',[(['RIGHT'],16)]),('left',[(['LEFT'],16)]),('right-jump',[(['RIGHT'],1),(['RIGHT','A'],20)]),('left-jump',[(['LEFT'],1),(['LEFT','A'],20)]),('right-wall',[(['L','RIGHT'],1),(['L','RIGHT','A'],6),(['RIGHT','A'],16)]),('left-wall',[(['L','LEFT'],1),(['L','LEFT','A'],6),(['LEFT','A'],16)]),('brake',[(['L'],10)])]
 events=[];front=[];seen={};count=0;best=sample();root={'id':0,'state':best,'parent':None,'action':None,'depth':0};nodes=[root];seen[key(best)]=0;s._command('save 1');shutil.copyfile(out/'checkpoint-1.ss',out/'node-0.ss');heapq.heappush(front,(score(best),0));found=None
 report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state':str(initial),'initial_state_sha256':hashlib.sha256(initial.read_bytes()).hexdigest(),'limit_transitions':limit,'max_wall_s':20,'nodes':nodes,'transitions':events,'outcome':'searching','scope':'Factory2 upper route x1000..2450,y450..1250; targetx>1450,y<760; actual input branches only','queue_s':None}
 try:
  while front and count<limit and time.monotonic()-start<20:
   _,idx=heapq.heappop(front);node=nodes[idx]
   if node['depth']>=18:continue
   for name,sequence in actions:
    if count>=limit:break
    shutil.copyfile(out/f'node-{idx}.ss',out/'checkpoint-0.ss');s._command('load 0')
    for keys,frames in sequence:s.act({'keys':keys,'frames':frames},120)
    e=sample();count+=1;event={'parent':idx,'action':name,'state':e};events.append(event)
    if e['stage']!=3 or e['flags']&128 or not 1000<e['x']<2450 or not 450<e['y']<1250:continue
    k=key(e);depth=node['depth']+1
    if k in seen and nodes[seen[k]]['depth']<=depth:continue
    j=len(nodes);new={'id':j,'state':e,'parent':idx,'action':name,'depth':depth};nodes.append(new);seen[k]=j
    s._command('save 1');shutil.copyfile(out/'checkpoint-1.ss',out/f'node-{j}.ss');heapq.heappush(front,(score(e),j))
    if score(e)<score(best):best=e;report['best_node']=j
    if e['x']>1450 and e['y']<760:found=j;break
   if found is not None:break
  target=found if found is not None else report.get('best_node',0);path=[];j=target
  while nodes[j]['parent'] is not None:path.append(nodes[j]['action']);j=nodes[j]['parent']
  path.reverse();report.update(outcome='route_found' if found is not None else 'bounded_no_route',selected_node=target,selected_state=nodes[target]['state'],route=[{'name':n,'actions':[{'keys':k,'frames':f} for k,f in dict(actions)[n]]} for n in path],actual_transitions=count)
  shutil.copyfile(out/f'node-{target}.ss',out/'selected.ss')
 finally:s.close();report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k not in ['nodes','transitions']}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--limit',type=int,default=300);a=p.parse_args();assert 1<=a.limit<=300;run(a.rom.resolve(),a.state.resolve(),a.out.resolve(),a.limit)
