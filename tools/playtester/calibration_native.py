"""Bounded archived-proposal counterfactual diagnostics; never creates independent trials.

Run only on the exact archived cartridge/checkpoint. Reconstruct old transitions
without changing their historical input semantics, then branch corrected inputs
from verified original decision states. No model calls and no player saves.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid

from .aria_adapter import AriaRewardAdapter


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    started = time.monotonic()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    events = [json.loads(line) for line in args.events.read_text().splitlines()]
    observations = {e['step']: e['observation'] for e in events if e['event'] == 'observation'}
    decisions = {e['step']: e['result']['record'] for e in events if e['event'] == 'decision'}
    receipts = {e['step']: e['action'] for e in events if e['event'] == 'action_receipt'}
    system2 = {e['step']: e['result']['action_id'] for e in events if e['event'] == 'system2'}
    profile = json.loads(args.profile.read_text())
    actions = {a['id']: a for a in profile['actions']}
    initial = observations[0]['evidence']['initial_state']
    rom_hash = observations[0]['evidence']['memory_profile']['rom_sha256']
    if sha(args.rom) != rom_hash or sha(args.state) != initial['sha256']:
        raise ValueError('archived_input_identity_mismatch')
    steps = sorted(set(args.steps))
    if len(steps) > 4 or not steps or any(s not in decisions for s in steps) or args.horizon != 120:
        raise ValueError('diagnostic_scope_limit')
    report = {'run_id': uuid.uuid4().hex, 'kind': 'archived_proposal_differential_diagnostic',
              'status': 'running', 'calibration_status': 'insufficient_independent_evidence',
              'source_commit': subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'machine': platform.platform(), 'python': platform.python_version(),
              'rom_sha256': rom_hash, 'initial_state_sha256': sha(args.state),
              'events_sha256': sha(args.events), 'action_profile_sha256': sha(args.profile),
              'adapter_source_sha256': sha(Path(__file__).with_name('aria_adapter.py')),
              'script_sha256': sha(__file__), 'model_calls': 0, 'queue_s': None, 'build_s': None,
              'independent_scenario_groups': 1, 'selected_steps': steps, 'horizon_frames': args.horizon,
              'label_definition': 'True only if candidate XP delta exceeds neutral-control XP delta and HP delta is no worse. False only if candidate is Pareto-dominated by neutral on XP and HP. Otherwise unknown; movement/information utility is unmeasured.',
              'limitations': ['All states share one trajectory; no fit/heldout independence.',
                  'Archived score was produced before the action-edge correction; no direct calibrated transfer.',
                  'Neutral continuation measures this 120-frame local consequence, not optimal play or long-term usefulness.'],
              'trials': []}
    (out/'protocol.json').write_text(json.dumps(report, indent=2)+'\n')
    adapter = AriaRewardAdapter([sys.executable,'-B','tools/re/session/bridge.py','--rom',str(args.rom.resolve()),
        '--game-id',profile['game_id'],'--out',str(out/'session'),'--initial-state',str(args.state.resolve()),
        '--memory-profile',str(args.memory.resolve())],expected_rom_sha256=rom_hash)
    advanced = 0
    try:
        report['environment'] = adapter.hello()
        for step in range(max(steps)+1):
            if time.monotonic()-started > 30:
                raise TimeoutError('diagnostic_wall_budget')
            if step:
                # Reproduce historical held-button behavior; corrected semantics apply only to branches.
                action = receipts[step]
                advanced += adapter.inner.act(action,max_frames=120)['frames']
            obs = adapter.observe()
            expected = observations[step]
            if (obs['frame'] != expected['frame'] or
                obs['evidence']['image_sha256'] != expected['evidence']['image_sha256'] or
                any(obs['facts'][k] != expected['facts'][k] for k in ('XP','HP','level'))):
                raise ValueError('original_decision_state_replay_mismatch')
            if step not in steps:
                continue
            checkpoint = adapter.checkpoint()['checkpoint']
            answer = next(a for a in decisions[step]['answers'] if a['name']=='action')
            trial = {'step': step, 'raw_score': answer['confidence'], 's1_action': answer['choice'],
                     's2_action': system2[step], 'original_state_verified': True,
                     'before': {k: obs['facts'][k] for k in ('XP','HP','level')}, 'branches': {}}
            branch_ids = list(dict.fromkeys([answer['choice'], system2[step], 'neutral_control']))
            for action_id in branch_ids:
                adapter.restore(checkpoint)
                if action_id == 'STOP':
                    trial['branches'][action_id] = {'unavailable': 'STOP has no native action outcome'}
                    continue
                action = {'id':'neutral_control','keys':[],'frames':120} if action_id=='neutral_control' else actions[action_id]
                advanced += adapter.act(action,max_frames=120)['frames']
                remaining = 120-action['frames']
                if remaining:
                    advanced += adapter.act({'id':'neutral_tail','keys':[],'frames':remaining},max_frames=120)['frames']
                after = adapter.observe()
                trial['branches'][action_id] = {'after': {k:after['facts'][k] for k in ('XP','HP','level')},
                    'XP_delta':after['facts']['XP']-obs['facts']['XP'],
                    'HP_delta':after['facts']['HP']-obs['facts']['HP'],
                    'image_sha256':after['evidence']['image_sha256']}
            candidate, neutral = trial['branches'][answer['choice']], trial['branches']['neutral_control']
            label = None
            if 'XP_delta' in candidate:
                cx,ch,nx,nh = candidate['XP_delta'],candidate['HP_delta'],neutral['XP_delta'],neutral['HP_delta']
                if cx>nx and ch>=nh: label=True
                elif cx<=nx and ch<=nh and (cx<nx or ch<nh): label=False
            trial['label'] = label
            report['trials'].append(trial)
            adapter.restore(checkpoint)
        report['status'] = 'completed'
    except Exception as exc:
        report['status'] = 'failed'
        report['error'] = str(exc)
        raise
    finally:
        adapter.close()
        report['native_frames_advanced'] = advanced + 1
        report['wall_s'] = round(time.monotonic()-started,6)
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('rom','state','events','profile','memory','out'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--steps',type=int,nargs='+',default=[0,5,10])
    parser.add_argument('--horizon',type=int,default=120)
    args=parser.parse_args()
    report=run(args)
    print(json.dumps({k:report[k] for k in ('run_id','status','wall_s','native_frames_advanced','model_calls','calibration_status')}))


if __name__=='__main__':
    main()
