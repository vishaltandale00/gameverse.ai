#!/usr/bin/env python3
"""Real-input return reward, seal counterfactual, and spin/contact witnesses."""
import argparse,hashlib,json,time
from pathlib import Path
from sonic_metroid_game_probe import run as game
ROOT=Path(__file__).resolve().parents[2]
def run(rom,state,out):
 out.mkdir(parents=True,exist_ok=False);(out/'qualifier-source.py').write_bytes(Path(__file__).read_bytes());start=time.monotonic();report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'initial_state':str(state),'initial_state_sha256':hashlib.sha256(state.read_bytes()).hexdigest(),'stages':[],'outcome':'running'}
 def play(name,initial,actions):
  began=time.monotonic();r=game(rom,out/name,{'initial_state':str(initial),'actions':actions});report['stages'].append({'id':name,'wall_s':time.monotonic()-began,'report':str(out/name/'report.json')});return r
 try:
  actions=json.loads((ROOT/'tools/composition/components/sonic_metroid/scenarios/return-discovery.json').read_text())['actions'];r=play('discovery',state,actions);e=r['events'];assert e[1]['state']['upgrades']==31 and e[3]['level']==0 and e[5]['state']['upgrades']==159 and e[-1]['state']['opened'][0]&16384
  startstate=out/'discovery/checkpoint-21.ss';r=play('spin-contact',startstate,[{'name':'approach-prey','keys':['RIGHT'],'frames':85},{'name':'screw-body-contact','keys':['RIGHT','A'],'frames':40,'save':22}]);a,b=r['events'][0]['state'],r['events'][-1]['state'];assert not a['upgrades']&64 and a['shots_fired']==b['shots_fired'] and b['alien_kills']>a['alien_kills']
  r=play('forward-relay',out/'discovery/checkpoint-20.ss',[{'name':'forward-return','keys':['SELECT','RIGHT','DOWN'],'frames':1},{'name':'native-forward-scene','keys':[],'frames':720,'save':23}]);assert r['events'][-1]['level']==1 and r['events'][-1]['state']['upgrades']==159 and r['events'][-1]['state']['relay']['trips']==2
  actions=[{'name':'high-cache','keys':['RIGHT'],'frames':55},{'name':'brake','keys':['L'],'frames':1},{'name':'return','keys':['SELECT','LEFT','DOWN'],'frames':1},{'name':'native-return-scene','keys':[],'frames':720},{'name':'before-cache','keys':['RIGHT'],'frames':48},{'name':'precision-brake','keys':['L'],'frames':1},{'name':'avoid-upgrade-cache','keys':['RIGHT','A'],'frames':48},{'name':'land-beyond-cache','keys':['RIGHT'],'frames':70},{'name':'seal-without-upgrade','keys':['RIGHT','A'],'frames':40,'save':24}]
  r=play('seal-without-screw',state,actions);e=r['events'][-1];assert e['state']['upgrades']==31 and not e['state']['opened'][0]&16384 and e['x']<560
  r=play('acquire-and-open',out/'seal-without-screw/checkpoint-24.ss',[{'name':'backtrack-to-matrix','keys':['LEFT'],'frames':130},{'name':'brake','keys':['L'],'frames':1},{'name':'return-to-seal','keys':['RIGHT'],'frames':100},{'name':'spin-through-seal','keys':['RIGHT','A'],'frames':40,'save':25}]);assert r['events'][-1]['state']['upgrades']==159 and r['events'][-1]['state']['opened'][0]&16384
  report['outcome']='return_discovery_body_contact_and_seal_dependency_passed'
 except BaseException as e:report.update(outcome='failed',error=str(e));raise
 finally:report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.state.resolve(),a.out.resolve())
