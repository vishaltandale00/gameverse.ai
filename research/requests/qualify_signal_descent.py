#!/usr/bin/env python3
"""One bounded exact-cartridge first-draft qualification prefix, with real states.
No browser, no writable RAM helpers, no source-variant patches. Keeps every
scenario/session/video/checkpoint and failures. Individual stages are nested
inside this qualification duration; do not add them again to the total.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.path.insert(0,str(Path(__file__).parent))
from sonic_metroid_game_probe import run as game
from sonic_metroid_campaign_probe import run as campaign
from sonic_metroid_boss_probe import run as boss
from sonic_metroid_capsule_probe import run as capsule
from sonic_metroid_ice_probe import run as ice

def run(rom,out):
 out.mkdir(parents=True,exist_ok=False);(out/'qualifier-source.py').write_bytes(Path(__file__).read_bytes());start=time.monotonic();report={'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'stages':[],'outcome':'running','limits':{'first_act_frames':3600,'second_act_route_frames':6000,'boss_frames':2400,'capsule_frames':2400}}
 def stage(name,fn):
  began=time.monotonic()
  try:r=fn();report['stages'].append({'stage':name,'wall_s':time.monotonic()-began,'outcome':'observed'});return r
  except BaseException as e:report['stages'].append({'stage':name,'wall_s':time.monotonic()-began,'outcome':'failed','error':str(e)});raise
 try:
  seq=json.loads((ROOT/'tools/composition/components/sonic_metroid/scenarios/coast.json').read_text())
  r=stage('coast',lambda:game(rom,out/'coast',seq));assert r['events'][-1]['state']['upgrades']==23 and r['events'][-1]['state']['gates_opened']==2
  r=stage('ice_platform',lambda:ice(rom,out/'coast/checkpoint-7.ss',out/'ice-platform'));assert r['outcome']=='frozen_creature_platform_opened_gate'
  stage('first_act',lambda:campaign(rom,Path(r['checkpoint']),out/'first-act',3600));r=json.loads((out/'first-act/report.json').read_text());initial=r.get('stage_transition_state',r['checkpoint'])
  stage('native_stage_transition',lambda:game(rom,out/'transition',{'initial_state':initial,'actions':[{'name':'settle-native-stage','keys':[],'frames':720,'save':12}]}))
  r=stage('high_speed',lambda:game(rom,out/'high-speed',{'initial_state':str(out/'transition/checkpoint-12.ss'),'actions':[{'name':'high-jump-cache','keys':['RIGHT'],'frames':65},{'name':'high-gate-blocks-ground','keys':['RIGHT'],'frames':60},{'name':'high-jump-opens-route','keys':['RIGHT','A'],'frames':22},{'name':'land','keys':['RIGHT','B'],'frames':90},{'name':'speed-cache','keys':['RIGHT','B'],'frames':90,'save':16}]}))
  speed_state=out/'high-speed/checkpoint-16.ss'
  if r['events'][-1]['state']['upgrades']==31:
   # Candidate26's authored habitat keeps its invulnerable source Ripper on
   # the route. Use acquired Ice through actual aim/fire input, then pass it.
   r=stage('ripper_ice_passage',lambda:game(rom,out/'ripper-ice-passage',{'initial_state':str(speed_state),'actions':[{'name':'close-diagonal-range','keys':['RIGHT'],'frames':7},{'name':'ice-diagonal','keys':['L','UP','RIGHT','B'],'frames':8},{'name':'cross-frozen-patrol','keys':['RIGHT'],'frames':70},{'name':'reach-speed-cache','keys':['RIGHT','B'],'frames':50,'save':22}]}))
   speed_state=out/'ripper-ice-passage/checkpoint-22.ss'
  assert r['events'][-1]['state']['upgrades']==95
  stage('second_act',lambda:campaign(rom,speed_state,out/'second-act',6000,10700));r=json.loads((out/'second-act/report.json').read_text())
  stage('native_boss',lambda:boss(rom,Path(r['checkpoint']),out/'native-boss'));r=json.loads((out/'native-boss/report.json').read_text());assert r['outcome']=='native_boss_defeated_and_removed'
  r=stage('native_switch',lambda:capsule(rom,Path(r['checkpoint']),out/'native-switch'));assert r['outcome']=='native_switch_pressed' and r['final_level']==2
  report['factory_checkpoint']=r['checkpoint'];report['outcome']='prefix_passed_actual_native_flow'
 except BaseException as e:report.update(outcome='failed',error=str(e));raise
 finally:report['wall_s']=time.monotonic()-start;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.rom.resolve(),a.out.resolve())
