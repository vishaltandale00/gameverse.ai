"""Registered native experiment callback for the bounded prefab iteration loop.

Fixture inputs initialize this exact candidate cartridge. All experiment inputs
are chosen by the existing Decision-AI/System2 controller, never the fixture.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from tools.decisions import ProviderConfig
from tools.re.session.bridge import NativeSession
from tools.whole_game.model_config import load_sid_reference
from .aria_adapter import AriaRewardAdapter
from .core import Limits, Playtester
from .models import DecisionPolicy, ChatPolicy
from .core import digest
from .learning import capture, restore

ROOT=Path(__file__).resolve().parents[2]


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pin(path):return {'path':str(Path(path).resolve()),'sha256':sha(path)}
def checked(record):
    path=Path(record['path']);path=(path if path.is_absolute() else ROOT/path).resolve()
    if sha(path)!=record['sha256']:raise ValueError('experiment_input_pin_mismatch')
    return path


def prepare_input_ready(session, spec, frame_budget):
    """Witness opposite native directional responses during labeled setup."""
    if spec.get('kind')!='aria-soma-directional-response/1':raise ValueError('unsupported_fixture_readiness')
    maximum=spec['max_frames'];batch=spec['batch_frames']
    if type(maximum) is not int or not 1<=maximum<=600 or type(batch) is not int or not 1<=batch<=8:
        raise ValueError('invalid_fixture_readiness_budget')
    maximum=min(maximum,frame_budget);rows=[];advanced=0;phase='LEFT';pressed=False
    while True:
        actor=int.from_bytes(session.read_memory(0x02013110,4),'little')
        row={'advanced_frames':advanced,'actor':actor,'setup_direction':phase}
        if actor%4==0 and 0x02000000<=actor<=0x02040000-0x60:
            raw=session.read_memory(actor,0x60)
            row.update(callback=int.from_bytes(raw[:4],'little'),x_q16=int.from_bytes(raw[0x40:0x44],'little',signed=True),
                       velocity_x_q16=int.from_bytes(raw[0x48:0x4c],'little',signed=True),
                       facing_negative_x=bool(raw[0x58]&0x40),state=raw[10],flags=int.from_bytes(raw[0x10:0x14],'little'))
            row['global_cast_block']=bool(int.from_bytes(session.read_memory(0x02000344,4),'little')&0x200000)
            row['active_cast_block']=bool(int.from_bytes(session.read_memory(0x020131b8,2),'little')&0x100)
            if pressed and row['callback']&~1==0x0801b0d8:
                if phase=='LEFT' and row['velocity_x_q16']<0 and row['facing_negative_x']:
                    phase='RIGHT';pressed=False;row['directional_response']='LEFT accepted'
                elif phase=='RIGHT' and row['velocity_x_q16']>0 and not row['facing_negative_x'] and row['state']==0 and not row['flags']&0x540 and not row['global_cast_block'] and not row['active_cast_block']:
                    rows.append(row)
                    return {'ready':True,'frames':advanced,'predicate':'opposite native LEFT then RIGHT velocity/facing responses, idle pose and known source cast blockers clear; not a guaranteed cast','observations':rows}
        rows.append(row)
        if advanced>=maximum:return {'ready':False,'frames':advanced,'predicate':'opposite native directional response not observed within fixture budget','observations':rows}
        receipt=session.act({'keys':[phase],'frames':min(batch,maximum-advanced)},120)
        advanced+=receipt['frames'];pressed=True


class RetainedAdapter:
    def __init__(self,adapter):self.adapter=adapter
    def __getattr__(self,key):return getattr(self.adapter,key)
    def close(self):pass


def experiment_native_candidate(artifact, context):
    config=context.config['experiment'];remaining=context.remaining();out=Path(context.output)
    out.mkdir(parents=True,exist_ok=True)
    rom=Path(artifact['path']).resolve()
    if sha(rom)!=artifact['sha256']:raise ValueError('experiment_candidate_hash_mismatch')
    profile_path=checked(config['profile']);memory_path=checked(config['memory_profile']);recipe_path=checked(config['fixture_recipe'])
    profile=json.loads(profile_path.read_text());memory=json.loads(memory_path.read_text());recipe=json.loads(recipe_path.read_text())
    adapter_id=config.get('adapter_id','aria-readonly-reward-fragment/1')
    if adapter_id not in ('aria-readonly-reward-fragment/1','sonic-native-traversal/1'):raise ValueError('unsupported_experiment_adapter')
    expected_game='sonic-metroid-signal-descent' if adapter_id=='sonic-native-traversal/1' else 'castlevania-aria-of-sorrow-double-xp'
    if profile['game_id']!=expected_game:raise ValueError('unsupported_experiment_game_profile')
    profile['game_version']=artifact['sha256'];memory['rom_sha256']=artifact['sha256']
    effective_profile=out/'effective-profile.json';effective_memory=out/'effective-memory.json'
    effective_profile.write_text(json.dumps(profile,indent=2)+'\n');effective_memory.write_text(json.dumps(memory,indent=2)+'\n')
    binary=ROOT/'tools/re/session/build/gba-session'
    if not binary.is_file():raise ValueError('native_session_binary_unavailable: run make -C tools/re/session')
    credential_ref=config.get('sid_env_file') or os.environ.get(config.get('sid_env_file_env','GAMEVERSE_SID_ENV_FILE'))
    if not credential_ref:raise ValueError('missing_model_credential_reference: set GAMEVERSE_SID_ENV_FILE')
    # Validate the explicit external mechanism before expensive fixture work; never retain values.
    load_sid_reference(credential_ref)
    s1_config=ProviderConfig.from_env('d1',timeout_s=min(config.get('model_timeout',10),300))
    slow=ChatPolicy.from_env()
    model_binding={'system1':{'provider':s1_config.provider,'model':s1_config.model,'endpoint':s1_config.base_url},
        'system2':{'provider':'explicit_chat','model':slow.model,'endpoint':slow.endpoint}}
    declared=config.get('models')
    if declared:
        for name in ('system1','system2'):
            for key in ('provider','model'):
                if declared[name][key]!=model_binding[name][key]:raise ValueError('experiment_model_identity_mismatch')
    runtime={'model_binding':model_binding,'native_sha256':sha(binary),'bridge_sha256':sha(ROOT/'tools/re/session/bridge.py'),
        'adapter_sha256':sha(ROOT/('tools/playtester/sonic_adapter.py' if adapter_id=='sonic-native-traversal/1' else 'tools/playtester/aria_adapter.py')),
        'core_sha256':sha(ROOT/'tools/playtester/core.py'),'policy_sha256':sha(ROOT/'tools/playtester/models.py'),
        'experiment_sha256':sha(Path(__file__))}
    prior=getattr(context,'checkpoint',None)
    if prior and prior.get('runtime_identity')!=runtime:raise ValueError('experiment_checkpoint_runtime_mismatch')
    if prior and (prior.get('profile_sha256')!=digest(profile) or prior.get('observation_profile_sha256')!=digest(memory)):
        raise ValueError('experiment_checkpoint_profile_mismatch')
    setup_start=time.monotonic();setup_frames=0
    if prior:
        if prior.get('artifact_sha256')!=artifact['sha256']:raise ValueError('experiment_checkpoint_artifact_mismatch')
        state=checked(prior['state'])
        fixture={'scope':'resume exact candidate checkpoint','rom_sha256':artifact['sha256'],'state':pin(state),'model_calls':0}
    elif adapter_id=='sonic-native-traversal/1':
        if recipe.get('artifact_sha256')!=artifact['sha256']:raise ValueError('experiment_fixture_artifact_mismatch')
        state=checked(recipe['state'])
        for ref in recipe.get('ancestry',[]):checked(ref)
        fixture={'scope':'Exact candidate source-guided native input replay checkpoint; setup is not model gameplay',
                 'rom_sha256':artifact['sha256'],'state':pin(state),'recipe':pin(recipe_path),
                 'setup_precomputed':True,'ancestry':recipe.get('ancestry',[]),'model_calls':0}
    else:
        until=recipe['boot_until_frame']
        if until+1>remaining['native_frames']:return {'native':True,'success':False,'reason':'fixture_native_frame_budget','usage':{'model_calls':0,'native_frames':0,'cost_usd':None},'decisions':[],'evidence':[]}
        session=NativeSession(rom,out/'fixture',binary)
        try:
            masks=[set() for _ in range(until)]
            for event in recipe['boot_inputs'].split(','):
                frame,hold,keys=event.split(':')
                for index in range(int(frame),min(int(frame)+int(hold),until)):masks[index].update(keys.split('+'))
            frame=0
            while frame<until:
                end=frame+1
                while end<min(frame+120,until) and masks[end]==masks[frame]:end+=1
                session.act({'keys':sorted(masks[frame]),'frames':end-frame},120);frame=end
            setup_frames=until
            readiness=None
            if recipe.get('fixture_readiness'):
                readiness=prepare_input_ready(session,recipe['fixture_readiness'],remaining['native_frames']-until-1)
                setup_frames+=readiness['frames']
            session._command('save 0');state=session.out/'checkpoint-0.ss'
            fixture={'scope':'scripted fixture initialization only; all subsequent experiment actions model-selected',
                     'rom_sha256':artifact['sha256'],'recipe':pin(recipe_path),'state':pin(state),'frames':setup_frames,'readiness':readiness,'model_calls':0}
        finally:session.close()
    fixture['wall_s']=round(time.monotonic()-setup_start,6);fixture_path=out/'fixture.json';fixture_path.write_text(json.dumps(fixture,indent=2)+'\n')
    if fixture.get('readiness') and not fixture['readiness']['ready']:
        return {'native':True,'success':False,'reason':'fixture_input_readiness_unobserved',
                'usage':{'model_calls':0,'native_frames':setup_frames,'cost_usd':None},'decisions':[],'evidence':[pin(fixture_path)]}
    calls=min(config.get('max_model_calls',40),remaining['model_calls'])
    frames=min(config.get('max_frames',960),remaining['native_frames']-setup_frames-1)
    seconds=min(config.get('max_seconds',60),remaining['wall_seconds']-(time.monotonic()-setup_start))
    if calls<1 or frames<1 or seconds<=0:return {'native':True,'success':False,'reason':'experiment_resource_budget','usage':{'model_calls':0,'native_frames':setup_frames,'cost_usd':None},'decisions':[],'evidence':[pin(fixture_path)]}
    limits=Limits(max_steps=config.get('max_steps',40),max_model_calls=calls,max_decisions=calls,max_escalations=None,
                  max_frames=frames,max_seconds=seconds,model_timeout_s=min(config.get('model_timeout',10),seconds),
                  stationary_min_frames=60,confidence_threshold=config.get('confidence',.65),margin_threshold=config.get('margin',.20))
    confidence,margin=limits.confidence_threshold,limits.margin_threshold
    policy=DecisionPolicy(s1_config,confidence=confidence,margin=margin)
    if adapter_id=='sonic-native-traversal/1':
        from .sonic_adapter import SonicTraversalAdapter
        adapter=SonicTraversalAdapter(rom,out/'native-session',state)
    else:
        adapter=AriaRewardAdapter([sys.executable,'-B',str(ROOT/'tools/re/session/bridge.py'),'--rom',str(rom),
            '--game-id',profile['game_id'],'--out',str(out/'native-session'),'--initial-state',str(state),
            '--memory-profile',str(effective_memory)],expected_rom_sha256=artifact['sha256'],goal=config.get('goal','soul_acquisition'),native_event_audit=config.get('native_event_audit',False),
            target_abs_velocity_q16=config.get('target_abs_velocity_q16',196608))
    if adapter_id=='aria-readonly-reward-fragment/1' and prior and prior.get('scenario_state'):
        old=prior['scenario_state'];adapter.initial_xp=old.get('initial_xp');adapter.initial_inventory=old.get('initial_inventory')
        adapter.reward_frame=1 if old.get('reward_frame') is not None else None;adapter.objective_witness=old.get('objective_witness');adapter.native_events=old.get('native_events',[]);adapter.bone_seen=set(old.get('bone_seen',[]))
    try:
        meta=adapter.hello()
        if prior and (prior.get('adapter_version')!=meta['adapter_version'] or prior.get('environment_version')!=meta['emulator']['name']+'/'+meta['emulator']['version']):
            raise ValueError('experiment_checkpoint_environment_mismatch')
        tester=Playtester(RetainedAdapter(adapter),profile,policy,system2=slow,limits=limits,output=out/'playtest')
        if prior:
            if not prior.get('learning_context'):raise ValueError('experiment_checkpoint_learning_context_required')
            retained=json.loads(checked(prior['learning_context']).read_text())
            restore(tester,retained,runtime)
        report=tester.run()
        for event in getattr(adapter,'native_events',[]):event.setdefault('observed_in_run',tester.run_id)
        checkpoint=adapter.checkpoint()
        learning_path=out/'learning-context.json';learning_path.write_text(json.dumps(capture(tester,runtime),indent=2)+'\n')
        observation_path=out/'checkpoint-observation.json'
        observation_path.write_text(json.dumps(adapter.observe(),indent=2)+'\n')
        observations=[event['observation'] for event in tester.events if event['event']=='observation']
        decisions=[event for event in tester.events if event['event'] in ('decision','system2') and event.get('result',{}).get('record',{}).get('provider')]
        refs=[pin(learning_path),pin(observation_path),pin(fixture_path),pin(effective_profile),pin(effective_memory),pin(out/'playtest/report.json'),pin(out/'playtest/events.jsonl')]
        result={'native':True,'success':report['status']=='success','reason':report['reason'],
                'configuration':{'models':model_binding,'confidence_threshold':confidence,'margin_threshold':margin,
                    'confidence_basis':'existing provider confidence plus margin/consistency; uncalibrated, no action-class bypass',
                    'credential_reference_environment':config.get('sid_env_file_env'), 'observation_profile_sha256':digest(memory)},
                'usage':{'model_calls':report['decision_calls']+report['system2_calls'],'native_frames':setup_frames+1+report['frames'],'cost_usd':None},
                'decisions':decisions,'evidence':refs,'timing':dict(report['timing'],fixture_wall_s=fixture['wall_s']),
                'checkpoint':{'artifact_sha256':artifact['sha256'],'adapter_version':meta['adapter_version'],
                    'environment_version':meta['emulator']['name']+'/'+meta['emulator']['version'],
                    'runtime_identity':runtime,'profile_sha256':digest(profile),'observation_profile_sha256':digest(memory),
                    'learning_context':pin(learning_path),'observation':pin(observation_path),
                    'state':pin(checkpoint['state_path']),'scenario_state':checkpoint.get('scenario_state',{})},
                'diagnosis':{'source_outcome':observations[-1]['facts'] if observations else {},
                    'system2_hypotheses':[event['result'].get('reason') for event in decisions if event['event']=='system2'][-3:],
                    'repair_recommendation':'No supported code variant selected by model; retain source evidence for diagnosis.'}}
        if config.get('native_event_audit'):
            result['diagnosis'].update(native_events=adapter.native_events,source_target={'kind':'skeleton_birth_impulse',
                'target_abs_velocity_q16':adapter.target_abs_velocity_q16,'events_observed':len(adapter.native_events),
                'predicate_satisfied':bool(adapter.objective_witness)})
        action_wall=report['timing']['action_wall_s'];nominal=meta['emulator']['frequency_hz']/meta['emulator']['frame_cycles']
        result['timing'].update(native_unthrottled=True,simulated_action_seconds=report['frames']/nominal,
            native_step_fps=(report['frames']/action_wall if action_wall else None),native_nominal_fps=nominal,
            resume_render_integration_frames=1,precomputed_setup_not_double_counted=bool(fixture.get('setup_precomputed')))
        if result['success']:
            predicates={'soul_acquisition':'Native soul inventory acquired an unowned entry, then game advanced',
                'reward':'Native XP increased by at least2 and game advanced',
                'skeleton_birth_impulse':'Source native initialized Skeleton birth observed with player horizontal impulse meeting configured threshold'}
            goal=config.get('goal','soul_acquisition')
            if goal not in predicates:raise ValueError('unregistered_native_objective_witness')
            result['objective_witness']={'source':'native-observation','artifact_sha256':artifact['sha256'],
                'observed_predicate':predicates[goal],
                'evidence':[pin(out/'playtest/events.jsonl')], 'facts':adapter.objective_witness}
        (out/'experiment.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    finally:adapter.close()
