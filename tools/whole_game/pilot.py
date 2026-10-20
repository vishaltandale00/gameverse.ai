"""Bounded real System1/System2 playtester plus replay of its actual chosen inputs."""
import argparse
import json
from pathlib import Path
import time

from tools.decisions import ProviderConfig
from tools.playtester.adapters import SubprocessAdapter
from tools.playtester.core import Limits, Playtester, digest
from tools.playtester.models import DecisionPolicy, ChatPolicy
from .model_config import load_sid_reference


class RetainedAdapter:
    def __init__(self, adapter):
        self.adapter = adapter
    def __getattr__(self, key):
        return getattr(self.adapter, key)
    def close(self):
        pass  # Pilot owns final disposal after exact checkpoint replay.


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--policy', choices=['d1'], default='d1')
    ap.add_argument('--system2', choices=['chat'], default='chat')
    ap.add_argument('--max-action-frames', type=int, default=120)
    ap.add_argument('--adapter-timeout', type=float, default=30)
    ap.add_argument('--full-scenario', action='store_true', help='System2 rounds continue under global limits; retain partial checkpoint on any stop')
    ap.add_argument('--profile', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--resume-from-profile', type=Path, help='Explicitly transfer same-game retained learning from this exact prior profile revision')
    ap.add_argument('--stationary-min-frames', type=int, default=60)
    ap.add_argument('--resume-context', type=Path, help='Pinned retained model plan and observed transition memory from a prior chunk')
    ap.add_argument('--sid-env-file', type=Path)
    ap.add_argument('--max-model-calls',type=int)
    ap.add_argument('--max-steps', type=int, default=3)
    ap.add_argument('--max-decisions', type=int, default=3)
    ap.add_argument('--max-escalations', type=int, default=1)
    ap.add_argument('--max-frames', type=int, default=360)
    ap.add_argument('--max-seconds', type=float, default=90)
    ap.add_argument('--model-timeout', type=float, default=20)
    ap.add_argument('--confidence', type=float, default=.65)
    ap.add_argument('--margin', type=float, default=.2)
    ap.add_argument('--adapter-command', nargs=argparse.REMAINDER, required=True)
    args = ap.parse_args()
    config = load_sid_reference(args.sid_env_file) if args.sid_env_file else {'mechanism': 'explicit process environment'}
    limits = Limits(max_model_calls=args.max_model_calls,max_steps=args.max_steps, max_decisions=args.max_decisions, max_escalations=None if args.full_scenario else args.max_escalations,
                    max_action_frames=args.max_action_frames, max_frames=args.max_frames, max_seconds=args.max_seconds, model_timeout_s=args.model_timeout,
                    stationary_min_frames=args.stationary_min_frames if args.full_scenario else 0, confidence_threshold=args.confidence, margin_threshold=args.margin)
    policy = DecisionPolicy(ProviderConfig.from_env('d1', timeout_s=args.model_timeout),
                            confidence=args.confidence, margin=args.margin)
    slow = ChatPolicy.from_env()
    adapter = SubprocessAdapter(args.adapter_command, timeout_s=args.adapter_timeout)
    replay = {'scope': 'replay actual model-selected inputs; no new policy decisions', 'status': 'unavailable'}
    try:
        metadata = adapter.hello()
        checkpoint = adapter._request('checkpoint') if {'checkpoint','restore'} <= set(metadata.get('capabilities', [])) else None
        tester = Playtester(RetainedAdapter(adapter), json.loads(args.profile.read_text()), policy,
                            system2=slow, limits=limits, output=args.output)
        if args.resume_context:
            retained = json.loads(args.resume_context.read_text())
            if retained['game_version'] != metadata['game_version']:
                raise ValueError('resume_context_game_identity_mismatch')
            if retained['profile_sha256'] != digest(tester.profile):
                if not args.resume_from_profile or retained['profile_sha256'] != digest(json.loads(args.resume_from_profile.read_text())):
                    raise ValueError('resume_context_profile_identity_mismatch')
                config['learning_profile_migration'] = {'prior_profile_sha256':retained['profile_sha256'],
                    'current_profile_sha256':digest(tester.profile),
                    'basis':'explicit same-game input-duration/observation-policy revision; native save/runtime unchanged'}
            if retained.get('observation_profile_sha256') != metadata.get('observation_profile_sha256'):
                config['observation_schema_migration'] = {'prior':retained.get('observation_profile_sha256'), 'current':metadata.get('observation_profile_sha256'), 'basis':'read-only source profile, verified exact ROM/ELF, native checkpoint/runtime unchanged'}
            tester.states.update(retained['state_visits'])
            tester.attempts.update({tuple(key): value for key, value in retained['attempts']})
            tester.stationary.update({tuple(key): value for key, value in retained['stationary']})
            tester.stationary_frames.update({tuple(key): value for key, value in retained.get('stationary_frames',[])})
            tester.transitions = retained['transitions']
            tester.barriers = retained['barriers']
            tester.awareness = retained['awareness']
            tester.system2_plan = retained['system2_plan']
        report = tester.run()
        retained = {'game_version':metadata['game_version'],'profile_sha256':digest(tester.profile),
                    'observation_profile_sha256':metadata.get('observation_profile_sha256'),
                    'state_visits':dict(tester.states),'attempts':list(tester.attempts.items()),
                    'stationary':list(tester.stationary.items()),'stationary_frames':list(tester.stationary_frames.items()),'transitions':tester.transitions,
                    'barriers':tester.barriers,'awareness':tester.awareness,'system2_plan':tester.system2_plan}
        (args.output / 'resume-context.json').write_text(json.dumps(retained,indent=2)+'\n')
        try:
            final_checkpoint = adapter._request('checkpoint') if checkpoint else None
        except Exception:
            final_checkpoint = {'status':'unavailable','reason':'adapter_checkpoint_failed'}
        if final_checkpoint:
            final_checkpoint['adapter_command'] = args.adapter_command
        replay_deadline = time.monotonic() + min(30, args.max_seconds)
        if checkpoint and report['status'] != 'failed':
            started = time.monotonic()
            adapter._request('restore', checkpoint=checkpoint['checkpoint'])
            matches = []
            replay_frames = 0
            for event in tester.events:
                if time.monotonic() >= replay_deadline:
                    replay['status'] = 'partial_replay_time_limit'
                    break
                if event['event'] == 'action_receipt':
                    receipt = adapter.act(event['action'], max_frames=min(limits.max_frames-replay_frames, limits.max_action_frames + metadata.get('max_integration_frames',0)))
                    replay_frames += receipt['frames']
                elif event['event'] == 'observation':
                    actual = adapter.observe()
                    expected = event['observation']
                    matches.append({'frame_match': actual['frame'] == expected['frame'],
                                    'state_match': actual['state_key'] == expected['state_key'],
                                    'image_match': actual.get('evidence', {}).get('image_sha256') == expected.get('evidence', {}).get('image_sha256'),
                                    'facts_match': actual.get('facts') == expected.get('facts')})
            replay = dict(replay, status=('partial_replay_time_limit' if replay['status']=='partial_replay_time_limit' else 'verified' if all(all(m.values()) for m in matches) else 'mismatch'),
                          observations=matches, wall_s=round(time.monotonic()-started,6),
                          model_calls=0, replay_frames=replay_frames)
        summary = {'run_id':report['run_id'],'status':report['status'],'reason':report['reason'],
                   'frames':report['frames'],'decision_calls':report['decision_calls'],'system2_calls':report['system2_calls'],
                   'timing':report['timing'],'configuration':config,'replay':replay,
                   'partial_checkpoint':final_checkpoint if report['status'] != 'success' else None,
                   'scenario_outcome':'observed_success' if report['status']=='success' else 'partial_requires_resume',
                   'billing_usd':None,'billing_basis':'provider does not report billing; no numeric spend claimed'}
        (args.output / 'pilot.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps(summary))
        return 2 if report['status']=='failed' or replay['status']=='mismatch' else 0
    finally:
        adapter.close()


if __name__ == '__main__':
    raise SystemExit(main())
