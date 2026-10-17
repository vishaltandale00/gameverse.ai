#!/usr/bin/env python3
"""Installed research compiler adapter. Every job gets a private source closure."""
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
from mashup_stagnation import VERSION as POLICY_VERSION, closed_gate, blocked_movement

def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,d): Path(p).write_text(json.dumps(d,indent=2)+'\n')
def prepare(runtime,out):
    runtime=runtime.resolve(); out.mkdir(parents=True,exist_ok=False)
    captured=runtime/'local/composition-builds/sonic-metroid-signal-descent-25'
    lock=json.loads((captured/'composition.lock.json').read_text())
    if lock['output_sha256']!='f1faa36558ae5d7ccacfc94292201b63c7a870803464a2f4d2699c6654bf6bf1': raise ValueError('unreviewed_baseline')
    # Existing compiler, native adapter and two-stage model policy; no dependencies installed.
    for folder in ['tools/composition','tools/gba_mashup','tools/re/session','tools/playtester','tools/decisions','tools/whole_game','research/requests']:
        shutil.copytree(runtime/folder,out/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc'),dirs_exist_ok=True)
    for folder in ['sources','packages']:
        for p in (captured/folder).rglob('*'):
            if p.is_file():
                rel=p.relative_to(captured/folder)
                if folder=='packages': rel=Path('tools/composition/packages')/rel
                target=out/rel; target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    # Package snapshots use instance filenames; retain original pinned package paths.
    for instance,pin in lock['packages'].items():
        original=captured/'packages'/(instance+'.json')
        target=out/pin['ref'];target.parent.mkdir(parents=True,exist_ok=True)
        if original.exists():shutil.copy2(original,target)
        if digest(target)!=pin['sha256']:raise ValueError('captured_package_identity:'+instance)
    for ref,expected in lock['source_files'].items():
        if digest(out/ref)!=expected:raise ValueError('captured_source_identity:'+ref)
    host=out/lock['host']['ref'];host.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(captured/'host.json',host)
    plan=out/'tools/composition/plans/sonic-metroid-signal-descent.json';shutil.copy2(captured/'plan.json',plan)
    seen=set()
    def closure(value):
        if isinstance(value,list):
            for child in value:closure(child)
        elif isinstance(value,dict):
            ref=value.get('ref') or value.get('path')
            if isinstance(ref,str) and not Path(ref).is_absolute() and '..' not in Path(ref).parts and ref not in seen:
                source=out/ref
                if not source.exists() and (runtime/ref).is_file():
                    source.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(runtime/ref,source)
                seen.add(ref)
                if source.is_file() and source.suffix=='.json':
                    try:closure(json.loads(source.read_text()))
                    except (UnicodeDecodeError,json.JSONDecodeError):pass
            for child in value.values():closure(child)
    closure(json.loads(plan.read_text()))
    for ref in ['local/roms/Sonic Advance (USA) (En,Ja).gba','local/roms/Metroid - Zero Mission (USA).gba']:
        target=out/ref;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copy2(runtime/ref,target)
    profile=runtime/'research/ir-workshop/prefab-model-verification-20261016/sonic-profile.json'
    shutil.copy2(profile,out/'model-profile.json')
    subprocess.run(['git','init','-q'],cwd=out,check=True)
    subprocess.run(['git','-c','user.name=Gameverse','-c','user.email=local@gameverse.invalid','commit','--allow-empty','-qm','Isolated captured mashup runtime'],cwd=out,check=True)
    write(out/'baseline.json',{'schema':'mashup-captured-baseline/1','baseline_rom_sha256':lock['output_sha256'],'plan_sha256':digest(plan),'world_sha256':digest(out/'tools/composition/worlds/sonic-metroid-signal-descent.json'),'source_games':['sonic-advance','metroid-zero-mission'],'runtime_root':str(runtime),'source_files':lock['source_files'],'scope':'Original Sonic campaign/controller with recovered MZM arithmetic, impact and Ripper/assets; other enemies, prefab ecology and inter-system glue authored. Late campaign unqualified.'})
    return {'workspace':str(out),'baseline':str(out/'baseline.json')}

def build(work):
    subprocess.run([sys.executable,'-B','tools/composition/components/sonic_metroid/assemble.py'],cwd=work,check=True,timeout=15)
    subprocess.run([sys.executable,'-B','-m','tools.gba_mashup.build','--plan','tools/composition/plans/sonic-metroid-signal-descent.json','--rom','local/roms/Sonic Advance (USA) (En,Ja).gba','--out','build'],cwd=work,check=True,timeout=60)
    return json.loads((work/'build/receipt.json').read_text())

def model(work,seconds,calls,frames):
    model_out=Path(os.environ.get('GAMEVERSE_MODEL_OUTPUT_ROOT',str(work)));model_out.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(work));os.chdir(work)
    from tools.playtester.sonic_adapter import SonicTraversalAdapter
    from tools.playtester.core import Playtester, Limits
    from tools.playtester.models import DecisionPolicy, ChatPolicy
    from tools.decisions import ProviderConfig
    from tools.whole_game.model_config import load_sid_reference
    if os.environ.get('GAMEVERSE_SID_ENV_FILE'):load_sid_reference(os.environ['GAMEVERSE_SID_ENV_FILE'])
    else:
        key=os.environ.get('SID_LLM_KEY');base=os.environ.get('SID_LLM_URL','http://rrh-llm-1:4000')
        if not key:raise ValueError('missing_SID_LLM_KEY')
        for name,value in {'LITELLM_BASE':base,'LITELLM_API_KEY':key,'PLAYTEST_LLM_BASE_URL':base,'PLAYTEST_LLM_API_KEY':key,'PLAYTEST_LLM_MODEL':'ramblerun/Multimodal-AI','PLAYTEST_LLM_ENABLE_THINKING':'false','PLAYTEST_LLM_JSON_MODE':'json_object'}.items():os.environ.setdefault(name,value)
    # Setup is a native cold-boot input replay, separate from model decisions.
    sys.path.insert(0,str(work/'research/requests'))
    from sonic_metroid_game_probe import run
    setup=json.loads((work/'boot/report.json').read_text())
    objective=json.loads((work/'acceptance.json').read_text())
    minimum=objective.get('minimum',{})
    allowed={'relics_collected','gates_opened','alien_kills','shots_hit','upgrades','relay_trips','mzm_impact_calls'}
    if len(minimum)<2 or set(minimum)-allowed or any(type(v) is not int or v<1 for v in minimum.values()):raise ValueError('invalid_linked_mechanics_acceptance')
    if minimum.get('relics_collected',0)<2 or minimum.get('gates_opened',0)<1:raise ValueError('require_acquisition_and_gate_observation')
    class GoalAdapter(SonicTraversalAdapter):
        def close(self): pass
        def observe(self):
            obs=super().observe();facts=obs['facts']
            passed=all(facts.get(k,-1)>=v for k,v in minimum.items())
            obs['success']=passed;obs['terminal']=passed
            world_spec=json.loads((work/'tools/composition/worlds/sonic-metroid-signal-descent.json').read_text());spec=world_spec['stages'][facts.get('stage',0)]
            facts['source_closed_gate']=closed_gate(world_spec,facts)
            required={'missile':2,'bomb':4,'high_jump':8,'ice_platform':16,'speed':64,'screw':128}
            contradictions=[]
            for prefab in spec['prefabs']:
                need=required.get(prefab['component'],0)
                if prefab['kind'] in ['gate','freeze_gateway'] and need and facts.get('opened',[0]*18)[facts.get('stage',0)]&(1<<prefab['id']) and facts.get('upgrades',0)&need!=need:contradictions.append({'kind':'opened_without_required_capability','prefab':prefab,'facts':facts})
            if contradictions:self.source_defects=contradictions
            return obs
    adapter=GoalAdapter(work/'build/game.gba',model_out/'model-native',Path(os.environ.get('GAMEVERSE_MODEL_RESUME_STATE',str(work/'boot/checkpoint-29.ss'))))
    profile=json.loads((work/'model-profile.json').read_text());profile['game_version']=digest(work/'build/game.gba');profile['objective']=objective['objective']
    extra=[('right_beam',['RIGHT','B'],'Move right and fire beam'),('missile',['R','B'],'Fire acquired missile; consumes ammo'),('right_missile',['RIGHT','R','B'],'Move right and fire acquired missile'),('bomb',['DOWN','B'],'Morph and lay acquired bomb'),('ice_aim',['L','UP','RIGHT','B'],'Aim diagonal Ice beam and fire')]
    for ident,keys,description in extra:profile['actions'].append({'id':ident,'keys':keys,'frames':24,'description':description})
    limits=Limits(max_steps=40,max_model_calls=calls,max_decisions=calls,max_escalations=None,max_frames=frames,max_seconds=seconds,model_timeout_s=10,confidence_threshold=.65,margin_threshold=.2)
    class SourceGuardPolicy(DecisionPolicy):
        def choose(self,context,options,timeout_s):
            result=super().choose(context,options,timeout_s)
            blocked=blocked_movement(context,result.get('action_id')) if result.get('accepted') else None
            if blocked:return dict(result,accepted=False,reason=blocked['reason'],source_stagnation=blocked)
            return result
    policy=SourceGuardPolicy(ProviderConfig.from_env('d1',timeout_s=10),confidence=.65,margin=.2)
    tester=Playtester(adapter,profile,policy,system2=ChatPolicy.from_env(),limits=limits,output=model_out/'model-playtest')
    previous_usage={'model_calls':0,'frames':0,'steps':0,'wall_s':0}
    resume_context=os.environ.get('GAMEVERSE_MODEL_RESUME_CONTEXT')
    if resume_context:
        from collections import Counter
        learned=json.loads(Path(resume_context).read_text())
        if learned['artifact_sha256']!=digest(work/'build/game.gba') or learned['profile_sha256']!=hashlib.sha256(json.dumps(profile,sort_keys=True).encode()).hexdigest():raise ValueError('resume_model_context_identity_mismatch')
        if learned['harness_sha256']!=digest(__file__) or learned['native_binary_sha256']!=adapter.inner.binary_sha256 or learned['emulator']!=adapter.inner.emulator:raise ValueError('resume_harness_identity_mismatch')
        if learned.get('source_policy_sha256')!=digest(Path(__file__).with_name('mashup_stagnation.py')):raise ValueError('resume_source_policy_identity_mismatch')
        if learned['adapter_version']!='sonic-native-traversal/1':raise ValueError('resume_adapter_identity_mismatch')
        for key in ['states','attempts','stationary','stationary_frames']:
            setattr(tester,key,Counter({tuple(k) if isinstance(k,list) else k:v for k,v in learned[key]}))
        for key in ['events','barriers','transitions','active_target','system2_plan','safe_wait_callback','continue_action_id','awareness','run_id','decisions','escalations','frames','steps']:setattr(tester,key,learned[key])
        for key,value in learned['policy_state'].items():setattr(policy,key,tuple(value) if key=='last_classification_key' and isinstance(value,list) else value)
        previous_usage={'model_calls':tester.decisions+tester.escalations,'frames':tester.frames,'steps':tester.steps,'wall_s':learned['total_wall_s']}
        from dataclasses import replace
        limits=replace(limits,max_model_calls=limits.max_model_calls+previous_usage['model_calls'],max_decisions=limits.max_decisions+tester.decisions,max_frames=limits.max_frames+tester.frames,max_steps=limits.max_steps+tester.steps);tester.limits=limits
        adapter.inner.frame=learned['native_checkpoint_frame']+1

    try:
        report=tester.run();report['checkpoint']=adapter.checkpoint()
        learning={key:getattr(tester,key) for key in ['events','barriers','transitions','active_target','system2_plan','safe_wait_callback','continue_action_id','awareness','run_id','decisions','escalations','frames','steps']}
        for key in ['states','attempts','stationary','stationary_frames']:learning[key]=[[k,v] for k,v in getattr(tester,key).items()]
        learning['policy_state']={key:getattr(policy,key) for key in ['classified','classified_phase','last_classification_key']}
        learning.update(source_policy_version=POLICY_VERSION,source_policy_sha256=digest(Path(__file__).with_name('mashup_stagnation.py')),schema='mashup-native-model-learning/1',artifact_sha256=digest(work/'build/game.gba'),profile_sha256=hashlib.sha256(json.dumps(profile,sort_keys=True).encode()).hexdigest(),adapter_version='sonic-native-traversal/1',harness_sha256=digest(__file__),native_binary_sha256=adapter.inner.binary_sha256,emulator=adapter.inner.emulator,native_checkpoint_frame=report['checkpoint']['frame'],total_wall_s=previous_usage['wall_s']+report['timing']['total_wall_s'])
        write(model_out/'model-learning.json',learning);report['checkpoint']['learning_context']={'path':str(model_out/'model-learning.json'),'sha256':digest(model_out/'model-learning.json')}
        report['continuation']={'restored_model_context':bool(resume_context),'prior_usage':previous_usage,'chunk_usage':{'model_calls':report['decision_calls']+report['system2_calls']-previous_usage['model_calls'],'native_frames':report['frames']-previous_usage['frames']},'source_policy_version':POLICY_VERSION,'restore_render_frames':1 if resume_context else 0}
        report['source_defects']=getattr(adapter,'source_defects',[]);report['evidence_root']=str(model_out);report['confidence_policy']={'confidence':.65,'margin':.2,'basis':'uncalibrated_provider_score','calibration_artifact':None,'lineage':'Existing sonic-traversal-template.json experiment confidence/margin; DecisionPolicy score/margin/top-probability gate and ChatPolicy escalation unchanged'};report['acceptance']=objective;report['artifact_sha256']=digest(work/'build/game.gba');write(model_out/'model-report.json',report);return report
    finally: adapter.inner.close()

def migrate_learning(work):
    """One-time zero-model migration of the retained pre-learning development smoke."""
    from collections import Counter
    sys.path.insert(0,str(work))
    from tools.playtester.core import digest as core_digest
    report=json.loads((work/'model-report.json').read_text())
    events=[json.loads(line) for line in (work/'model-playtest/events.jsonl').read_text().splitlines()]
    observations=[e['observation'] for e in events if e['event']=='observation']
    actions=[e for e in events if e['event']=='action_receipt']
    decisions=[e for e in events if e['event']=='decision']
    escalations=[e for e in events if e['event']=='system2']
    if len(observations)!=len(actions)+1 or len(actions)!=report['steps']:raise ValueError('incomplete_event_history')
    if any(e['action'].get('target') or e['action'].get('continue_until_target') for e in actions):raise ValueError('legacy_target_context_not_recoverable')
    if any(o['facts'].get('source_callback2') is not None or o['facts'].get('noninteractive_wait_safe') for o in observations):raise ValueError('legacy_callback_context_not_recoverable')
    if any('awareness' in e.get('result',{}) for e in decisions):raise ValueError('legacy_classification_context_not_recoverable')
    if any(e.get('result',{}).get('record',{}).get('policy')=='single_available_action' for e in decisions):raise ValueError('legacy_model_call_counter_ambiguous')
    if len(decisions)!=report['decision_calls'] or len(escalations)!=report['system2_calls']:raise ValueError('legacy_usage_counter_mismatch')
    # This old smoke's known-awareness source profile never asked classification.
    if any(report['awareness'].get(k) in ('unknown','menu_only',None) for k in ['perspective','locomotion']):raise ValueError('legacy_classification_state_unknown')
    states=Counter(o['state_key'] for o in observations);attempts=Counter();stationary=Counter();stationary_frames=Counter()
    for t in report['transitions']:
        attempts[(t['from'],t['action_id'])]+=1;k=tuple(t['stationary_key'])
        stationary[k]=stationary[k]+1 if t['unchanged'] else 0
        stationary_frames[k]=stationary_frames[k]+t['frame_after']-t['frame_before'] if t['unchanged'] else 0
    if len(states)!=report['states_observed'] or sum(e['receipt']['frames'] for e in actions)!=report['frames']:raise ValueError('legacy_graph_or_frame_mismatch')
    plan=None
    for event in escalations:
        result=event['result']
        if result.get('accepted') and result.get('action_id')!='STOP':plan={'selected_action':result['action_id'],'hypothesis':result.get('reason'),'escalation_reason':event['reason'],'planned_at_step':event['step'],'basis':'System2 hypothesis; validate against subsequent observations'}
    profile=json.loads((work/'model-profile.json').read_text());profile['game_version']=report['artifact_sha256'];profile['objective']=report['acceptance']['objective']
    extra=[('right_beam',['RIGHT','B'],'Move right and fire beam'),('missile',['R','B'],'Fire acquired missile; consumes ammo'),('right_missile',['RIGHT','R','B'],'Move right and fire acquired missile'),('bomb',['DOWN','B'],'Morph and lay acquired bomb'),('ice_aim',['L','UP','RIGHT','B'],'Aim diagonal Ice beam and fire')]
    for ident,keys,description in extra:profile['actions'].append({'id':ident,'keys':keys,'frames':24,'description':description})
    if core_digest(profile)!=report['profile_sha256']:raise ValueError('legacy_profile_identity_mismatch')
    if digest(work/'build/game.gba')!=report['artifact_sha256'] or digest(report['checkpoint']['path'])!=report['checkpoint']['sha256']:raise ValueError('legacy_native_identity_mismatch')
    learning={'schema':'mashup-native-model-learning/1','artifact_sha256':report['artifact_sha256'],'profile_sha256':hashlib.sha256(json.dumps(profile,sort_keys=True).encode()).hexdigest(),'adapter_version':'sonic-native-traversal/1','harness_sha256':digest(__file__),'native_binary_sha256':report['adapter']['native_sha256'],'emulator':report['adapter']['emulator'],'native_checkpoint_frame':report['checkpoint']['frame'],'total_wall_s':report['timing']['total_wall_s'],'events':events,'barriers':report['barrier_candidates'],'transitions':report['transitions'],'active_target':report['active_target'],'system2_plan':plan,'safe_wait_callback':None,'continue_action_id':None,'awareness':report['awareness'],'run_id':report['run_id'],'decisions':report['decision_calls'],'escalations':report['system2_calls'],'frames':report['frames'],'steps':report['steps'],'policy_state':{'classified':False,'classified_phase':None,'last_classification_key':None}}
    for key,value in [('states',states),('attempts',attempts),('stationary',stationary),('stationary_frames',stationary_frames)]:learning[key]=[[k,v] for k,v in value.items()]
    folder=work/'learning-migration';folder=folder if not folder.exists() else work/('learning-migration-'+str(time.time_ns()));folder.mkdir(exist_ok=False);write(folder/'learning.json',learning)
    checkpoint=dict(report['checkpoint'],learning_context={'path':str(folder/'learning.json'),'sha256':digest(folder/'learning.json')})
    receipt={'schema':'mashup-learning-migration/1','outcome':'exact_context_recovered','source_report':{'path':str(work/'model-report.json'),'sha256':digest(work/'model-report.json')},'source_events':{'path':str(work/'model-playtest/events.jsonl'),'sha256':digest(work/'model-playtest/events.jsonl')},'checkpoint':checkpoint,'recovered':['state_visits','action_attempts','stationary_counts_and_frames','events','transitions','barriers','target','S2_plan','awareness','policy_classification_state','run_id','S1_S2_call_counts','frame_step_wall_usage'],'required_unavailable_fields':[],'informational_unavailable':['Legacy wrapper source hash was not recorded; current wrapper plus exact pinned original policy/profile/native decoder binds continuation.'],'model_calls':0,'native_frames':0,'original_evidence_modified':False}
    write(folder/'receipt.json',receipt);return receipt

def main():
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['prepare','build','model','prefix','boot','migrate']);p.add_argument('--runtime',type=Path);p.add_argument('--workspace',required=True,type=Path);p.add_argument('--seconds',type=int,default=60);p.add_argument('--calls',type=int,default=24);p.add_argument('--frames',type=int,default=960);a=p.parse_args();started=time.monotonic();report_dir=Path(os.environ.get('GAMEVERSE_STAGE_REPORT_ROOT',str(a.workspace)))
    try:
        if a.stage=='prepare':result=prepare(a.runtime,a.workspace)
        elif a.stage=='migrate':result=migrate_learning(a.workspace.resolve())
        elif a.stage=='build':result=build(a.workspace.resolve())
        elif a.stage=='boot':
            sys.path.insert(0,str(a.workspace.resolve()/'research/requests'));sys.path.insert(0,str(a.workspace.resolve()))
            from sonic_metroid_game_probe import run
            result=run(a.workspace.resolve()/'build/game.gba',a.workspace.resolve()/'boot',{'actions':[{'name':'cold-boot-ready','keys':[],'frames':1,'save':29}]})
            if not result['events'][-1].get('state',{}).get('active'):raise ValueError('native_campaign_not_active')
        elif a.stage=='model':result=model(a.workspace.resolve(),a.seconds,a.calls,a.frames)
        else:
            subprocess.run([sys.executable,'-B','research/requests/qualify_signal_descent.py','--rom',str(a.workspace.resolve()/'build/game.gba'),'--out',str(a.workspace.resolve()/'native-prefix')],cwd=a.workspace,check=True,timeout=30);result=json.loads((a.workspace/'native-prefix/report.json').read_text())
        write(report_dir/(a.stage+'-stage.json'),{'outcome':'completed','wall_s':time.monotonic()-started,'result':result})
    except Exception as e:
        if a.workspace.exists():write(report_dir/(a.stage+'-stage.json'),{'outcome':'blocked','wall_s':time.monotonic()-started,'error':str(e)})
        print(json.dumps({'stage':a.stage,'error':str(e)}));sys.exit(1)
if __name__=='__main__':main()
