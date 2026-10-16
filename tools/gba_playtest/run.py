"""Bounded real-GBA exploration recorder. No browser automation or JS simulation.

Source-linked RAM is objective evidence; image changes alone never count as
progress. The configured route policy is a declared hypothesis, not blind play.
"""
from __future__ import annotations
import argparse
from dataclasses import replace
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import time

from tools.re.session.bridge import NativeSession
from tools.decisions import ProviderConfig
from tools.playtester.models import DecisionPolicy, ChatPolicy

ACTIONS = [
 {'id':'left','keys':['LEFT'],'frames':24,'description':'Walk left toward the initial room exit or configured encounter; compare source position'},
 {'id':'right','keys':['RIGHT'],'frames':24,'description':'Walk right to test the alternative route or avoid a barrier'},
 {'id':'left_jump','keys':['LEFT','A'],'frames':18,'description':'Jump left across a visible step or barrier'},
 {'id':'right_jump','keys':['RIGHT','A'],'frames':18,'description':'Jump right across a visible step or barrier'},
 {'id':'attack_left','keys':['LEFT','B'],'frames':24,'description':'Face left and fire the current native weapon toward a barrier or enemy'},
 {'id':'attack','keys':['B'],'frames':6,'description':'Fire current weapon; observe source state and actual pixels'},
 {'id':'wait','keys':[],'frames':24,'description':'Release input briefly for a transition or recovery'}]


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def configure_env(path):
    if not path: return
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        name, value = line.removeprefix('export ').split('=', 1)
        if name in {'OPENAI_API_KEY','LITELLM_API_KEY','LITELLM_BASE','PLAYTEST_LLM_BASE_URL','PLAYTEST_LLM_MODEL','PLAYTEST_LLM_API_KEY'}:
            os.environ[name] = value.strip().strip('"\'')


def control_ready(facts):
    # Pose30 is source SamusFacingTheForeground: LEFT/RIGHT exits this pose.
    return (facts.get('game_mode') == 4 and facts.get('sub_mode') == 2 and
            facts.get('movement_lock_timer') == 0 and facts.get('drawing_disabled') == 0 and
            facts.get('standing_status') not in (3, 4) and facts.get('pose') in list(range(29)) + [30,31])


def state_progress(facts):
    keys = ('area','room','x_native','y_native','beam_flags','suit_flags','gv_active','gv_result','gv_turn')
    return {k:facts[k] for k in keys if k in facts}


def battle_options(facts, metadata):
    if facts.get('gv_result'):
        return [{'id':'battle_continue','description':'Accept the native battle result and restore the source exploration room','frames':1,'keys':[]}]
    i=facts['gv_player_index']; options=[]
    if facts.get('gv_player_%d_hp'%i,0):
        for slot in range(4):
            move_id=facts['gv_player_%d_move%d'%(i,slot)];m=metadata['moves'].get(str(move_id),{})
            if facts['gv_player_%d_pp%d'%(i,slot)]>0:
                options.append({'id':'battle_move_'+str(slot),'description':'Use %s, native type%s/power%s, PP%d'%(m.get('name',move_id),m.get('type'),m.get('power'),facts['gv_player_%d_pp%d'%(i,slot)]),'frames':1,'keys':[]})
    for j in range(3):
        if j!=i and facts.get('gv_player_%d_hp'%j,0)>0:
            options.append({'id':'battle_switch_'+str(j),'description':'Switch to healthy party member%d, species%s, HP%d'%(j,facts.get('gv_player_%d_species'%j),facts['gv_player_%d_hp'%j]),'frames':1,'keys':[]})
    return options


def battle_probe_choice(facts, metadata, options):
    if facts.get('gv_result'):return options[0]
    p,e=facts['gv_player_index'],facts['gv_enemy_index']
    types=set(facts['gv_enemy_%d_type%d'%(e,j)] for j in range(2))
    scored=[]
    for option in options:
        if option['id'].startswith('battle_move_'):
            slot=int(option['id'].rsplit('_',1)[1]);m=metadata['moves'].get(str(facts['gv_player_%d_move%d'%(p,slot)]),{})
            score=m.get('power',1)*m.get('accuracy',100)/100
            for attack,defend,multiplier in metadata['type_chart']:
                if attack==m.get('type') and defend in types:score*=multiplier
            scored.append((score,option))
    # Declared simple source-table heuristic, not exact native damage prediction.
    return max(scored,key=lambda row:row[0])[1] if scored else options[0]


def run(args):
    configure_env(args.env_file)
    started = time.monotonic(); out = args.out.resolve()
    if out.exists():raise ValueError('output_directory_must_be_fresh')
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(time.time_ns())[-8:]
    report = {'schema_version':1,'run_id':run_id,'kind':args.kind,'game_id':args.game_id,
      'started_at':dt.datetime.now(dt.timezone.utc).isoformat(),'rom':{'path':str(args.rom.resolve()),'sha256':sha(args.rom),'bytes':args.rom.stat().st_size},
      'build_receipt':{'path':str(args.build_receipt.resolve()),'sha256':sha(args.build_receipt)} if args.build_receipt else None,
      'profile':{'path':str(args.profile.resolve()),'sha256':sha(args.profile)},
      'limits':{'actions':args.max_actions,'total_frames':args.max_frames,'decision_calls':args.max_decision_calls,'llm_calls':args.max_llm_calls,'wall_s':args.max_wall_s},
      'qualification_scope':args.qualification_scope,
      'source_commit':args.source_commit,'environment':{'platform':platform.platform(),'python':platform.python_version()},
      'stages':{},'observations':[],'actions':[],'barriers':[],'models':[],
      'success':False,'success_scope':'Native player control and reachable encounter transition only; not full-game completion',
      'objective':args.objective,'outcome':'running','queue_s':None}
    session = None; trace = None; recording = False; decision_calls = llm_calls = 0
    try:
        session = NativeSession(args.rom,out,'tools/re/session/build/gba-session',memory_profile=args.profile,initial_state=args.initial_state)
        report['emulator'] = session.emulator
        report['adapter'] = {'source_sha256':sha('tools/re/session/bridge.py'),'native_source_sha256':sha('tools/re/session/session.c'),
                             'native_sha256':sha('tools/re/session/build/gba-session'),'runner_sha256':sha(__file__),'version':'mgba-session/2'}
        trace = (out/'trace.jsonl').open('w')
        def observe(stage):
            o=session.observe(); report['observations'].append({'stage':stage,**o});trace.write(json.dumps({'kind':'observation','stage':stage,**o})+'\n');trace.flush();return o
        def act(action,stage):
            if session.frame + action['frames'] > args.max_frames or time.monotonic()-started > args.max_wall_s: raise RuntimeError('resource_limit')
            before=session.frame; session.act(action,120); r={'stage':stage,'start_frame':before,'end_frame':session.frame,'action':action};report['actions'].append(r);trace.write(json.dumps({'kind':'action',**r})+'\n');trace.flush()
        def tap(key,release=6):
            act({'id':'tap_'+key.lower(),'keys':[key],'frames':6},'native_battle_input')
            act({'id':'release','keys':[],'frames':release},'native_battle_input')
        def execute_battle(option):
            f=session.read_facts()
            if option['id']=='battle_continue':tap('A',90);return
            if option['id']=='battle_retreat':tap('SELECT',90);return
            party=option['id'].startswith('battle_switch_');target=int(option['id'].rsplit('_',1)[1])
            if bool(f['gv_party_menu'])!=party:tap('B');f=session.read_facts()
            # Read native selection after every short tap. Native input cadence
            # can miss an edge; a predicted tap count is not observed selection.
            for _ in range(6):
                if f['gv_selection']==target:break
                tap('RIGHT');f=session.read_facts()
            if f['gv_selection']!=target or bool(f['gv_party_menu'])!=party:
                raise RuntimeError('battle_menu_target_unreached')
            tap('A',30)
        boot_start=time.monotonic()
        o=observe('boot')
        for i in range(60):
            if control_ready(o['facts']) or o['facts'].get('gv_active'):break
            # Adapted existing cold-boot script. Never press START once native gameplay is active.
            if o['facts'].get('game_mode')==4:act({'id':'boot_wait','keys':[],'frames':90},'boot')
            else:
                act({'id':'boot_menu','keys':['START'] if i%2==0 else ['A'],'frames':6},'boot')
                act({'id':'boot_release','keys':[],'frames':84},'boot')
            o=observe('boot')
        report['stages']['boot']={'wall_s':round(time.monotonic()-boot_start,6),'end_frame':session.frame,'control_ready_hypothesis':control_ready(o['facts'])}
        if not control_ready(o['facts']) and not o['facts'].get('gv_active'):raise RuntimeError('navigation_failed')
        session._command('save 0')
        report['ready_checkpoint']={'path':str(out/'checkpoint-0.ss'),'sha256':sha(out/'checkpoint-0.ss'),'frame':session.frame,'scope':'Private native state, not assumed compatible with browser WASM'}
        session.start_recording(args.video_stride);recording=True
        decision = DecisionPolicy(ProviderConfig.from_env(args.decision_provider,timeout_s=15), confidence=.55,margin=.1) if args.decision_provider!='none' else None
        llm = ChatPolicy.from_env() if args.max_llm_calls else None
        stalled=0; right_seen=left_seen=jump_seen=False; battle_seen=False; restored=False;returned=False;switch_seen=False;turn_seen=False;frozen_seen=False;attack_seen=False
        for index in range(args.max_actions):
            previous=o;f=o['facts'];battle_seen=battle_seen or bool(f.get('gv_active'))
            context={'run_id':run_id,'game_id':args.game_id,'game_version':session.game_version,'adapter_version':'mgba-session/2',
                     'objective':args.objective,'awareness':{'perspective':'side_view','locomotion':'platform','basis':'source-linked MZM adaptation'},
                     'observation':o,'recent_actions':report['actions'][-4:], 'barriers':report['barriers'][-3:]}
            # Source-native short probes, not a global pathfinding claim.
            is_battle=bool(f.get('gv_active'))
            options=battle_options(f,session.memory_profile['battle_metadata']) if is_battle else ACTIONS
            chosen=battle_probe_choice(f,session.memory_profile['battle_metadata'],options) if is_battle else ACTIONS[0]
            selection='source_table_combat_probe' if is_battle else 'configured_leftward_route_hypothesis'
            if is_battle and args.qualification_scope=='encounter-return' and not f.get('gv_result'):
                if not switch_seen:
                    switches=[a for a in options if a['id'].startswith('battle_switch_')]
                    if switches:chosen=switches[-1];selection='native_party_switch_probe'
                elif turn_seen and attack_seen:
                    chosen={'id':'battle_retreat','description':'Use native SELECT retreat and observe exploration restoration','keys':[],'frames':1};selection='native_encounter_return_probe'
            if not is_battle and index==0:chosen=ACTIONS[1];selection='control_probe_right'
            elif not is_battle and index==1:chosen=ACTIONS[0];selection='control_probe_left'
            elif not is_battle and index==2:chosen=ACTIONS[2];selection='control_probe_jump'
            elif not is_battle and args.kind=='candidate' and index==3 and 'gv_active' in f:
                chosen={'id':'request_encounter','keys':['SELECT'],'frames':1,'description':'Use the candidate native SELECT encounter trigger'};selection='declared_candidate_encounter_probe'
            elif not is_battle and f.get('gv_pending'):chosen={'id':'encounter_transition','keys':[],'frames':60};selection='wait_native_encounter_fade'
            elif not is_battle and stalled>=2:chosen=ACTIONS[4] if index%2 else ACTIONS[2];selection='barrier_probe'
            if decision and decision_calls<args.max_decision_calls and index>=4 and len(options)>1 and (is_battle or not f.get('gv_pending')) and selection not in ('native_party_switch_probe','native_encounter_return_probe'):
                decision_calls+=1;r=decision.choose(context,options,15);report['models'].append({'kind':'system1',**r})
                if r.get('accepted'):chosen=next(a for a in options if a['id']==r['action_id']);selection='decision_model'
                elif llm and llm_calls<args.max_llm_calls:
                    llm_calls+=1;r=llm.choose(context,options,20);report['models'].append({'kind':'system2',**r})
                    if r.get('accepted'):chosen=next(a for a in options if a['id']==r['action_id']);selection='llm_escalation'
            elif stalled>=3 and llm and llm_calls<args.max_llm_calls:
                llm_calls+=1;r=llm.choose(context,options,20);report['models'].append({'kind':'system2',**r})
                if r.get('accepted'):chosen=next(a for a in options if a['id']==r['action_id']);selection='llm_barrier_escalation'
            if is_battle:
                report.setdefault('battle_choices',[]).append({'frame':session.frame,'choice':chosen,'selection':selection})
                execute_battle(chosen)
            else:act(dict(chosen,selection=selection),'explore')
            o=observe('explore');now=o['facts']
            dx=now.get('x_native',0)-f.get('x_native',0);dy=now.get('y_native',0)-f.get('y_native',0)
            same_room=now.get('area')==f.get('area') and now.get('room')==f.get('room')
            if is_battle:
                switch_seen=switch_seen or now.get('gv_player_index')!=f.get('gv_player_index')
                turn_seen=turn_seen or now.get('gv_turn',0)>f.get('gv_turn',0)
                frozen_seen=frozen_seen or (dx==0 and dy==0 and same_room)
                attack_seen=attack_seen or now.get('gv_last_player_move',0)>0
            if same_room and chosen['id']=='right' and dx>0:right_seen=True
            if same_room and chosen['id']=='left' and dx<0:left_seen=True
            if same_room and 'A' in chosen['keys'] and dy<0:jump_seen=True
            unchanged=state_progress(f)==state_progress(now);stalled=stalled+1 if unchanged else 0
            if stalled==2:report['barriers'].append({'frame':session.frame,'status':'hypothesis','basis':'Two consecutive actions without selected source-state change; not collision proof','facts':state_progress(now),'source_refs':session.memory_profile['source_files']})
            if (battle_seen and not now.get('gv_active') and now.get('gv_result')==1 and control_ready(now)
                    and same_room and chosen['id'] in ('left','right') and dx!=0):restored=True
            if (battle_seen and not now.get('gv_active') and control_ready(now) and same_room
                    and chosen['id'] in ('left','right') and dx!=0):returned=True
            report['witnesses']={'right_control':right_seen,'left_control':left_seen,'jump_rise':jump_seen,'encounter':battle_seen,
                'native_party_switch':switch_seen,'native_turn_resolved':turn_seen,'native_player_attack':attack_seen,'world_frozen_during_battle':frozen_seen,
                'exploration_control_restored':returned,'victory_and_exploration_restored':restored}
            if restored or (args.qualification_scope=='encounter-return' and returned):break
        candidate_ok=(returned and switch_seen and turn_seen and attack_seen) if args.qualification_scope=='encounter-return' else restored
        report['success']=right_seen and left_seen and jump_seen and (args.kind=='baseline' or candidate_ok)
        report['outcome']='recorded_native_gameplay' if report['success'] else 'partial_or_unclear_control'
        report['video']=session.stop_recording();recording=False;trace.close()
    except Exception as exc:
        # Deliberately keep exception text out of reports: transport errors can include credentials.
        report['outcome']='failed'; report['error']={'type':type(exc).__name__,'code':str(exc) if isinstance(exc,RuntimeError) and str(exc) in ('resource_limit','navigation_failed','battle_menu_target_unreached') else 'bounded_run_failure'}
        if session and recording:
            try:report['video']=session.stop_recording()
            except Exception:report['video']={'outcome':'recording_finalize_failed'}
    finally:
        if session:session.close()
        if trace:trace.close()
        report['wall_s']=round(time.monotonic()-started,6);report['decision_calls']=decision_calls;report['llm_calls']=llm_calls
        report['stages']['total']={'wall_s':report['wall_s'],'overlap_note':'Includes boot, model calls, emulator work and encoding; nested timings must not be summed'}
        out.mkdir(parents=True,exist_ok=True);(out/'run.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('rom','profile','out'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--build-receipt',type=Path);p.add_argument('--source-commit',required=True);p.add_argument('--game-id',default='metroid-zero-mission')
    p.add_argument('--kind',choices=['baseline','candidate'],required=True);p.add_argument('--initial-state',type=Path);p.add_argument('--env-file',type=Path)
    p.add_argument('--qualification-scope',choices=['encounter-return','battle-victory'],default='encounter-return')
    p.add_argument('--objective',default='Verify native movement and jump, explore left toward a reachable encounter, and record barriers and uncertainty.')
    p.add_argument('--decision-provider',choices=['none','d1','openai'],default='none');p.add_argument('--max-decision-calls',type=int,default=4);p.add_argument('--max-llm-calls',type=int,default=0)
    p.add_argument('--max-actions',type=int,default=24);p.add_argument('--max-frames',type=int,default=6000);p.add_argument('--max-wall-s',type=float,default=120);p.add_argument('--video-stride',type=int,default=2)
    a=p.parse_args()
    if not(1<=a.max_actions<=80 and 1<=a.max_frames<=12000 and 0<=a.max_decision_calls<=12 and 0<=a.max_llm_calls<=2 and 1<=a.video_stride<=6 and 1<=a.max_wall_s<=180):p.error('invalid bounded resource limits')
    r=run(a);print(json.dumps({'run_id':r['run_id'],'outcome':r['outcome'],'success':r['success'],'out':str(a.out),'wall_s':r['wall_s'],'witnesses':r.get('witnesses')}))

if __name__=='__main__':main()
