"""One bounded, source-aware real-ROM wild encounter qualification and recording.

This is a declared native-state probe policy, not an LLM or blind-play claim.
The policy never writes game RAM, injects encounters, or uses SELECT to enter.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import platform
import time

from tools.re.session.bridge import NativeSession
from tools.gba_playtest.run import control_ready, sha


def identity(facts, sprite):
    return facts['area']<<24 | facts['room']<<16 | sprite['room_slot']<<8 | sprite['sprite_id']


def party_snapshot(facts):
    return [{key:facts.get('gv_player_%d_%s'%(i,key)) for key in
       ('species','hp','max_hp','move0','move1','move2','move3','pp0','pp1','pp2','pp3')} for i in range(3)]


def typed_score(facts, metadata, party_index, slot):
    move=metadata['moves'].get(str(facts.get('gv_player_%d_move%d'%(party_index,slot))),{})
    if not facts.get('gv_player_%d_pp%d'%(party_index,slot)):return 0
    score=move.get('power',0)*move.get('accuracy',100)/100
    defending=set(facts.get('gv_enemy_0_type%d'%j) for j in range(2))
    for attack,defend,multiplier in metadata['type_chart']:
        if attack==move.get('type') and defend in defending:score*=multiplier
    if move.get('type') in {facts.get('gv_player_%d_type%d'%(party_index,j)) for j in range(2)}:score*=1.5
    return score


def battle_choice(facts, metadata):
    active=facts['gv_player_index'];best=[]
    for i in range(3):
        if facts.get('gv_player_%d_hp'%i,0)>0:
            scores=[typed_score(facts,metadata,i,j) for j in range(4)]
            best.append((max(scores),i,scores.index(max(scores))))
    if not best:return {'kind':'continue','reason':'No healthy player; observe actual defeat result'}
    current=next((x for x in best if x[1]==active),None)
    strongest=max(best,key=lambda row:row[0])
    if current is None or (strongest[1]!=active and strongest[0]>current[0]*1.5):
        return {'kind':'switch','index':strongest[1],'reason':'Source move/type table offensive score; not exact native damage prediction'}
    return {'kind':'move','index':current[2],'reason':'Highest available source move power×accuracy×type×STAB score for active party member'}


def run(args):
    out=args.out.resolve()
    if out.exists():raise ValueError('Output directory must be new')
    started=time.monotonic();report={'schema_version':1,'run_id':dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns())[-8:],
      'game_id':args.game_id,'kind':'candidate','qualification_scope':'native-wild-'+args.scenario,
      'rom':{'path':str(args.rom.resolve()),'sha256':sha(args.rom),'bytes':args.rom.stat().st_size},
      'source_commit':args.source_commit,'build_receipt':{'path':str(args.build_receipt.resolve()),'sha256':sha(args.build_receipt)},
      'profile':{'path':str(args.profile.resolve()),'sha256':sha(args.profile)},
      'limits':{'policy_iterations':args.max_iterations,'total_frames':args.max_frames,'wall_s':args.max_wall_s,'max_action_frames':120,'model_calls':0,
        'boot_iterations':60,'max_menu_adjustment_taps':6,'note':'Policy iteration bound excludes bounded boot/menu substeps; every input is also bounded by total frames/wall time'},
      'environment':{'platform':platform.platform(),'python':platform.python_version()},'source_policy':'read-only native-state exploration and source move/type table heuristic; no model playing claim',
      'scenario':args.scenario,'outcome':'running','success':False,'witnesses':{},'observations':[],'actions':[],'choices':[],'targets':[],
      'queue_s':None,'initial_state_source_run':str(args.initial_state_source_run.resolve()) if args.initial_state_source_run else None,
      'limitations':['Only one encounter coupling is qualified; full campaign and all mapped species remain unqualified','No SRAM party extension or save-migration claim','Field sprite pixels require visual review, separate from native render counters']}
    session=trace=None;recording=False
    try:
        session=NativeSession(args.rom,out,'tools/re/session/build/gba-session',memory_profile=args.profile,initial_state=args.initial_state)
        profile=session.memory_profile
        if not profile.get('native_sprite_array') or not profile.get('battle_metadata',{}).get('wild_mapping'):
            raise RuntimeError('wild_profile_missing')
        report['emulator']=session.emulator;report['adapter']={'version':'mgba-session/2','bridge_sha256':sha('tools/re/session/bridge.py'),
          'native_source_sha256':sha('tools/re/session/session.c'),'native_binary_sha256':sha('tools/re/session/build/gba-session'),'runner_sha256':sha(__file__)}
        trace=(out/'trace.jsonl').open('w')
        def observe(stage):
            o=session.observe();report['observations'].append({'stage':stage,**o});trace.write(json.dumps({'kind':'observation','stage':stage,**o})+'\n');trace.flush();return o
        def act(action,stage):
            if not(1<=action['frames']<=120) or session.frame+action['frames']>args.max_frames or time.monotonic()-started>args.max_wall_s:raise RuntimeError('resource_limit')
            start=session.frame;session.act(action,120);r={'stage':stage,'start_frame':start,'end_frame':session.frame,'action':action};report['actions'].append(r);trace.write(json.dumps({'kind':'action',**r})+'\n');trace.flush()
        def tap(key,release=24):
            act({'id':'tap_'+key,'keys':[key],'frames':6},'battle_input');act({'id':'release','keys':[],'frames':release},'battle_input')
        def execute(choice):
            f=session.read_facts()
            if choice['kind']=='continue':tap('A',90);return
            if choice['kind']=='retreat':tap('SELECT',90);return
            party=choice['kind']=='switch';target=choice['index']
            for _ in range(3):
                if bool(f['gv_party_menu'])==party:break
                tap('B');f=session.read_facts()
            for _ in range(6):
                if f['gv_selection']==target:break
                tap('RIGHT');f=session.read_facts()
            if f['gv_selection']!=target or bool(f['gv_party_menu'])!=party:raise RuntimeError('menu_target_unreached')
            tap('A',42)
        o=observe('boot');boot_start=time.monotonic()
        for i in range(60):
            if control_ready(o['facts']):break
            if o['facts'].get('game_mode')==4:act({'id':'boot_wait','keys':[],'frames':90},'boot')
            else:
                act({'id':'boot_menu','keys':['START'] if i%2==0 else ['A'],'frames':6},'boot')
                act({'id':'boot_release','keys':[],'frames':84},'boot')
            o=observe('boot')
        report['boot']={'wall_s':round(time.monotonic()-boot_start,6),'end_frame':session.frame}
        if not control_ready(o['facts']):raise RuntimeError('boot_control_unavailable')
        session._command('save 0');report['ready_checkpoint']={'path':str(out/'checkpoint-0.ss'),'frame':session.frame,'sha256':sha(out/'checkpoint-0.ss')}
        session.start_recording(2);recording=True
        witness={'real_native_gameplay':False,'field_entity_observed':False,'field_render_species_observed':False,
          'contact_triggered_without_select':False,'field_species_matches_encounter':False,'player_party_three_present':False,'native_party_switch':False,
          'single_wild_enemy_only':False,'native_player_attack':False,'native_victory':False,'same_entity_death_applied':False,
          'defeated_ledger_incremented':False,'exploration_control_restored':False,'party_preserved_across_return':False,'retreat_entity_alive':False}
        mapping={int(k):int(v) for k,v in profile['battle_metadata']['wild_mapping'].items()}
        target_before=None;encounter=None;party_before_return=None;pre_ledger=0;world_frozen=True;stalled=0;attack_turns=0;observed_entities={}
        for iteration in range(args.max_iterations):
            f=o['facts'];in_battle=bool(f.get('gv_active'));before=o
            if in_battle:
                if encounter is None:
                    # RAM entry is set before the CPU finishes drawing Mode3.
                    # Advance actual neutral frames before input, rather than
                    # treating an intermediate white frame as battle-ready.
                    act({'id':'battle_render_settle','keys':[],'frames':24},'battle_settle')
                    o=observe('battle_ready');f=o['facts']
                    encounter={k:f.get('gv_wild_'+k) for k in ('identity','species','x','y','ram_slot','native_sprite_id','area','room')}
                    encounter.update(player_world={'x':f['x_native'],'y':f['y_native'],'area':f['area'],'room':f['room']})
                    report['encounter']=encounter;pre_ledger=f.get('gv_defeated_count',0)
                    actual=f['native_sprites'][encounter['ram_slot']]
                    report['pre_contact_entity']=observed_entities.get(encounter['identity'])
                    witness['contact_triggered_without_select']=not any('SELECT' in a['action']['keys'] for a in report['actions'])
                    expected=mapping.get(encounter['native_sprite_id'])
                    witness['field_species_matches_encounter']=(expected==encounter['species']==f.get('gv_enemy_0_species') and
                      identity(f,actual)==encounter['identity'] and encounter['identity'] in observed_entities)
                    witness['player_party_three_present']=all(f.get('gv_player_%d_max_hp'%i,0)>0 for i in range(3))
                    witness['single_wild_enemy_only']=(f.get('gv_enemy_index')==0 and f.get('gv_enemy_0_hp',0)>0 and
                      all(f.get('gv_enemy_%d_hp'%i)==0 and f.get('gv_enemy_%d_max_hp'%i)==0 for i in (1,2)))
                    report['witnesses']=dict(witness,world_frozen_during_battle=world_frozen)
                if f.get('gv_result'):
                    witness['native_victory']=f['gv_result']==1
                    party_before_return=party_snapshot(f)
                    choice={'kind':'continue','reason':'Accept actual native battle result'}
                elif args.scenario=='retreat' and attack_turns>=1:
                    party_before_return=party_snapshot(f);choice={'kind':'retreat','reason':'Explicit retreat preserves native wild entity'}
                elif args.scenario=='retreat':
                    choice={'kind':'move','index':0,'reason':'Configured low-power neutral probe before retreat, rather than the victory policy high-power finisher'}
                else:choice=battle_choice(f,profile['battle_metadata'])
                report['choices'].append({'frame':session.frame,'choice':choice});execute(choice);o=observe('battle_or_return');now=o['facts']
                witness['native_party_switch']=witness['native_party_switch'] or now.get('gv_player_index')!=f.get('gv_player_index')
                world_frozen=world_frozen and (now['x_native']==f['x_native'] and now['y_native']==f['y_native']) if now.get('gv_active') else world_frozen
                pp_changed=any(now.get('gv_player_%d_pp%d'%(i,j))!=f.get('gv_player_%d_pp%d'%(i,j)) for i in range(3) for j in range(4))
                if now.get('gv_last_player_move',0)>0 and pp_changed:witness['native_player_attack']=True;attack_turns+=1
            else:
                candidates=[s for s in f.get('native_sprites',[]) if s['status']&3==3 and not s['status']&4 and s['health']>0 and s['sprite_id'] in mapping and not s['properties']&128]
                for sprite in candidates:
                    observed_entities[identity(f,sprite)]={**sprite,'identity':identity(f,sprite),'expected_species':mapping[sprite['sprite_id']],'frame':session.frame,'image':o['image']}
                if candidates:
                    target=min(candidates,key=lambda s:abs(s['x_native']-f['x_native'])+abs(s['y_native']-f['y_native']))
                    target_before={**target,'identity':identity(f,target),'expected_species':mapping[target['sprite_id']],'frame':session.frame}
                    report['targets'].append(target_before);witness['field_entity_observed']=True
                    if f.get('gv_world_draw_species') in mapping.values() and f.get('gv_world_draw_count',0)>0:
                        witness['field_render_species_observed']=True
                    dx=target['x_native']-f['x_native'];dy=target['y_native']-f['y_native'];direction='LEFT' if dx<0 else 'RIGHT'
                    keys=[direction];duration=12
                    if dy<-40 or stalled>=2:keys.append('A');duration=18
                    action={'id':'contact_target_'+str(target_before['identity']),'keys':keys,'frames':duration,'target':target_before}
                else:action={'id':'explore_left','keys':['LEFT','A'] if stalled>=2 else ['LEFT'],'frames':24}
                act(action,'approach_contact');o=observe('world');now=o['facts']
                moved=now['x_native']!=f['x_native'] or now['y_native']!=f['y_native'];stalled=0 if moved else stalled+1
                if moved and now['area']==f['area'] and now['room']==f['room']:witness['real_native_gameplay']=True
                if (encounter and not now.get('gv_active') and control_ready(now) and moved and
                        now['area']==encounter['area'] and now['room']==encounter['room']):
                    witness['exploration_control_restored']=True
                    if party_before_return is not None:witness['party_preserved_across_return']=party_snapshot(now)==party_before_return
                    if args.scenario=='victory':
                        witness['defeated_ledger_incremented']=(now.get('gv_defeated_count',0)>pre_ledger and
                          encounter['identity'] in now.get('gv_defeated_identities',[]))
                        same=next((s for s in now['native_sprites'] if identity(now,s)==encounter['identity']),None)
                        native_dead=same is None or not(same['status']&1) or same['health']==0 or bool(same['properties']&16)
                        witness['same_entity_death_applied']=now.get('gv_wild_resolution')==1 and native_dead
                    else:
                        same=next((s for s in now['native_sprites'] if identity(now,s)==encounter['identity']),None)
                        witness['retreat_entity_alive']=now.get('gv_wild_resolution')==3 and same is not None and bool(same['status']&1) and same['health']>0
                    break
            report['witnesses']=dict(witness,world_frozen_during_battle=world_frozen)
        report['witnesses']=dict(witness,world_frozen_during_battle=world_frozen,
          actual_source_contact=witness['contact_triggered_without_select'] and witness['field_species_matches_encounter'],
          matching_single_wild=witness['field_species_matches_encounter'] and witness['single_wild_enemy_only'],
          pokemon_field_rendered=witness['field_render_species_observed'],party_persisted=witness['party_preserved_across_return'],
          exact_actor_resolved=witness['same_entity_death_applied'] and witness['defeated_ledger_incremented'])
        required=['real_native_gameplay','field_entity_observed','contact_triggered_without_select','field_species_matches_encounter',
          'player_party_three_present','single_wild_enemy_only','native_player_attack','exploration_control_restored','party_preserved_across_return']
        required+=['native_victory','same_entity_death_applied','defeated_ledger_incremented'] if args.scenario=='victory' else ['retreat_entity_alive']
        report['success']=all(report['witnesses'][k] for k in required);report['required_witnesses']=required
        report['outcome']='qualified_native_wild_'+args.scenario if report['success'] else 'incomplete_native_wild_'+args.scenario
        report['video']=session.stop_recording();recording=False
    except Exception as exc:
        report['outcome']='failed';report['error']={'type':type(exc).__name__,'code':str(exc) if isinstance(exc,RuntimeError) else 'bounded_wild_run_failure'}
        if session and recording:
            try:report['video']=session.stop_recording()
            except Exception:report['video']={'outcome':'encode_failed'}
    finally:
        if session:session.close()
        if trace:trace.close()
        report['wall_s']=round(time.monotonic()-started,6);report['timing_note']='Total includes nested boot/emulator/menu/encoding work; do not add nested stages. Queue unavailable.'
        out.mkdir(parents=True,exist_ok=True);(out/'run.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('rom','profile','out','build-receipt'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--source-commit',required=True);p.add_argument('--game-id',default='mzm-emerald-wild-v2')
    p.add_argument('--scenario',choices=['victory','retreat'],default='victory');p.add_argument('--initial-state',type=Path);p.add_argument('--initial-state-source-run',type=Path)
    p.add_argument('--max-iterations',type=int,default=60);p.add_argument('--max-frames',type=int,default=12000);p.add_argument('--max-wall-s',type=float,default=120)
    a=p.parse_args()
    if not(1<=a.max_iterations<=60 and 1<=a.max_frames<=12000 and 1<=a.max_wall_s<=120):p.error('Invalid bounded limits')
    r=run(a);print(json.dumps({'run_id':r['run_id'],'outcome':r['outcome'],'success':r['success'],'out':str(a.out),'wall_s':r['wall_s'],'witnesses':r['witnesses']}))
if __name__=='__main__':main()
