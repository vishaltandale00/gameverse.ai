"""Registered SID RPG experiment using the existing Decision-AI/System2 loop.

Provider-owned navigation supplies options; ScenarioAdapter alone observes goal
facts. Ordinary save boot is explicit setup, never reported as model gameplay.
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import time

from tools.decisions import ProviderConfig
from tools.whole_game.model_config import load_sid_reference
from .core import Limits, Playtester, digest
from .experiment import ROOT, RetainedAdapter, checked, pin, sha
from .learning import capture, restore
from .models import ChatPolicy, DecisionPolicy
from .rpg_adapter import RPGNavigationAdapter
from .scenario import ScenarioAdapter, validate as validate_scenario


def _json(ref):
    return json.loads(checked(ref).read_text())


def _write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def _deterministic_actions(events, manifest_ref, runtime):
    """Join actual core choices to actual adapter receipts; no invented calls."""
    allowed = {'single_available_action', 'continue_adapter_target', 'continue_model_wait'}
    choices = {event['step'] + 1: event for event in events
               if event.get('event') == 'decision'
               and event.get('result', {}).get('record', {}).get('policy') in allowed
               and (event['result']['record']['policy'] != 'continue_model_wait'
                    or event['result']['record'].get('basis') == 'source_proven_noninteractive_callback_unchanged')}
    result = []
    for event in events:
        if event.get('event') != 'action_receipt':
            continue
        decision = choices.get(event['step'])
        if (decision and decision['result'].get('action_id') == event.get('action', {}).get('id')
                and event.get('receipt', {}).get('frames', 0) > 0):
            result.append({'decision': decision, 'action_receipt': event,
                           'provider_manifest_ref': manifest_ref,
                           'runtime_identity_sha256': digest(runtime),
                           'provenance': 'pinned SID source-defined options executed by RPGNavigationAdapter; existing core deterministic policy'})
    return result


def experiment_rpg_candidate(artifact, context):
    """Execute a pinned candidate with exact native/navigation/model continuation."""
    started = time.monotonic()
    config = context.config['experiment']
    remaining = context.remaining()
    out = Path(context.output)
    out.mkdir(parents=True, exist_ok=True)
    checked(artifact)
    manifest_path = checked(config['provider_manifest_ref'])
    manifest = json.loads(manifest_path.read_text())
    if manifest['rom']['sha256'] != artifact['sha256']:
        raise ValueError('rpg_experiment_provider_artifact_mismatch')
    checked(manifest['rom'])
    profile = _json(config['profile'])
    recipe = _json(config['fixture_recipe'])
    scenario_path = checked(config['scenario_ref'])
    scenario = validate_scenario(json.loads(scenario_path.read_text()))
    if profile['game_id'] != manifest['game_id']:
        raise ValueError('rpg_experiment_game_profile_mismatch')
    if profile.get('game_version') not in (None, artifact['sha256']):
        raise ValueError('rpg_experiment_game_version_mismatch')
    profile['game_version'] = artifact['sha256']
    targets = copy.deepcopy(profile.get('navigation_targets', config.get('targets', [])))
    native_option = copy.deepcopy(config.get('native_option', {}))
    option_frames = native_option.get('max_frames', 600)
    if type(option_frames) is not int or not 1 <= option_frames <= 3600:
        raise ValueError('invalid_rpg_experiment_option_limit')
    observation_profile = {'provider_manifest_ref': pin(manifest_path), 'navigation_targets': targets,
                           'native_option': native_option}
    if config.get('memory_profile'):
        observation_profile['memory_profile'] = _json(config['memory_profile'])
    binary_ref = config.get('native_binary_ref') or pin(ROOT/'tools/re/session/build/gba-session')
    checked(binary_ref)
    credential_ref = config.get('sid_env_file') or os.environ.get(config.get('sid_env_file_env', 'GAMEVERSE_SID_ENV_FILE'))
    if not credential_ref:
        raise ValueError('missing_model_credential_reference')
    load_sid_reference(credential_ref)
    s1 = ProviderConfig.from_env('d1', timeout_s=min(config.get('model_timeout', 10), 300))
    slow = ChatPolicy.from_env()
    model_binding = {'system1': {'provider': s1.provider, 'model': s1.model, 'endpoint': s1.base_url},
                     'system2': {'provider': 'explicit_chat', 'model': slow.model, 'endpoint': slow.endpoint}}
    if config.get('models'):
        for name in ('system1', 'system2'):
            for key in ('provider', 'model', 'endpoint'):
                if key in config['models'][name] and config['models'][name][key] != model_binding[name][key]:
                    raise ValueError('experiment_model_identity_mismatch')
    runtime = {'model_binding': model_binding, 'native_option': native_option,
               'native_sha256': sha(checked(binary_ref)), 'provider_manifest_ref': pin(manifest_path),
               'profile_ref': pin(checked(config['profile'])), 'fixture_recipe_ref': pin(checked(config['fixture_recipe'])),
               'scenario_ref': pin(scenario_path), 'effective_profile_sha256': digest(profile),
               'observation_profile_sha256': digest(observation_profile),
               'source_sha256': {name: sha(ROOT/name) for name in (
                   'tools/re/session/bridge.py', 'tools/playtester/rpg_adapter.py',
                   'tools/playtester/rpg_experiment.py', 'tools/playtester/core.py',
                   'tools/playtester/models.py', 'tools/playtester/scenario.py',
                   'tools/playtester/learning.py')}}
    prior = getattr(context, 'checkpoint', None)
    if prior:
        if prior.get('artifact_sha256') != artifact['sha256']:
            raise ValueError('experiment_checkpoint_artifact_mismatch')
        if prior.get('runtime_identity') != runtime:
            raise ValueError('experiment_checkpoint_runtime_mismatch')
        if (prior.get('profile_sha256') != digest(profile)
                or prior.get('observation_profile_sha256') != digest(observation_profile)):
            raise ValueError('experiment_checkpoint_profile_mismatch')
        if not prior.get('learning_context') or not isinstance(prior.get('navigation_state'), dict):
            raise ValueError('rpg_experiment_checkpoint_learning_navigation_required')
        checked(prior['state'])
        checked(prior['learning_context'])
    elif recipe.get('artifact_sha256') not in (None, artifact['sha256']):
        raise ValueError('experiment_fixture_artifact_mismatch')
    actions = recipe.get('setup_actions', [])
    setup_max = recipe.get('setup_max_frames')
    if (not isinstance(actions, list) or type(setup_max) is not int or setup_max < 0
            or any(not isinstance(row, dict) or type(row.get('frames')) is not int or row['frames'] <= 0
                   or not isinstance(row.get('keys', []), list) for row in actions)):
        raise ValueError('invalid_rpg_fixture_recipe')
    requested_setup = 0 if prior else sum(row['frames'] for row in actions)
    if requested_setup > setup_max or requested_setup + (1 if prior else 0) >= remaining['native_frames']:
        raise ValueError('rpg_fixture_native_frame_budget')
    _write(out/'effective-profile.json', profile)
    _write(out/'effective-observation-profile.json', observation_profile)
    initial = None
    if prior:
        initial = dict(prior['state'], game_version=artifact['sha256'], navigation_state=copy.deepcopy(prior['navigation_state']))
    navigation_kwargs = {}
    if profile.get('navigation_policy'):
        navigation_kwargs['navigation_policy'] = profile['navigation_policy']
    base = RPGNavigationAdapter.open(manifest, out/'native-session', binary=binary_ref, targets=targets,
                                     initial_state=initial, max_option_frames=option_frames, **navigation_kwargs)
    adapter = base
    try:
        # Each open creates an isolated native process whose command frame counter
        # begins at zero. Restore's one real render frame is therefore included.
        opened_frames = base.session.native_counter
        if not prior:
            base.prepare(actions, max_frames=setup_max)
        setup_frames = base.session.native_counter
        fixture = {'scope': 'exact checkpoint resume; setup not replayed' if prior else 'ordinary-save source-defined boot; excluded from measured play',
                   'artifact_sha256': artifact['sha256'], 'recipe': pin(checked(config['fixture_recipe'])),
                   'model_calls': 0, 'setup_frames': setup_frames,
                   'resume_render_integration_frames': opened_frames if prior else 0,
                   'preparation': copy.deepcopy(base.preparation), 'wall_s': round(time.monotonic() - started, 6)}
        _write(out/'fixture.json', fixture)
        adapter = ScenarioAdapter(base, scenario, prior.get('scenario_state') if prior else None)
        meta = adapter.hello()
        environment = meta['emulator']['name'] + '/' + meta['emulator']['version']
        if (meta['adapter_version'] != context.config['adapter_version']
                or environment != context.config['environment_version']):
            raise ValueError('experiment_config_environment_mismatch')
        if prior and (prior.get('adapter_version') != meta['adapter_version'] or prior.get('environment_version') != environment):
            raise ValueError('experiment_checkpoint_environment_mismatch')
        frames = min(config.get('max_frames', 6000), remaining['native_frames'] - setup_frames)
        seconds = min(config.get('max_seconds', 60), context.remaining()['wall_seconds'])
        if frames < 1 or seconds <= 0:
            raise ValueError('rpg_experiment_resource_budget')
        calls = min(config.get('max_model_calls', 40), remaining['model_calls'])
        limits = Limits(max_steps=config.get('max_steps', 100), max_model_calls=calls,
                        max_decisions=calls, max_escalations=None, max_frames=frames,
                        max_seconds=seconds, model_timeout_s=min(config.get('model_timeout', 10), seconds),
                        max_action_frames=option_frames, stationary_min_frames=60,
                        confidence_threshold=.65, margin_threshold=.20)
        policy = DecisionPolicy(s1, confidence=.65, margin=.20)
        tester = Playtester(RetainedAdapter(adapter), profile, policy, system2=slow, limits=limits, output=out/'playtest')
        if prior:
            restore(tester, _json(prior['learning_context']), runtime)
        report = tester.run()
        checkpoint = adapter.checkpoint()
        _write(out/'learning-context.json', capture(tester, runtime))
        # Observe restored/current state, never substitute prior observation facts.
        _write(out/'checkpoint-observation.json', adapter.observe())
        calls = report['decision_calls'] + report['system2_calls']
        native_frames = base.session.native_counter
        if native_frames < setup_frames:
            raise ValueError('rpg_native_frame_counter_regressed')
        decisions = [event for event in tester.events if event.get('event') in ('decision', 'system2')
                     and event.get('result', {}).get('record', {}).get('provider')]
        deterministic = _deterministic_actions(tester.events, pin(manifest_path), runtime)
        evidence_paths = ('learning-context.json', 'checkpoint-observation.json', 'fixture.json',
                          'effective-profile.json', 'effective-observation-profile.json',
                          'playtest/report.json', 'playtest/events.jsonl')
        result = {'native': True, 'success': report['status'] == 'success', 'reason': report['reason'],
                  'playtest_status': report['status'], 'configuration': {'models': model_binding,
                      'confidence_threshold': .65, 'margin_threshold': .20,
                      'confidence_basis': 'existing provider confidence/margin policy; no action-class bypass'},
                  'usage': {'model_calls': calls, 'native_frames': native_frames, 'cost_usd': None},
                  'decisions': decisions, 'deterministic_actions': deterministic,
                  'evidence': [pin(out/name) for name in evidence_paths],
                  'timing': dict(report['timing'], fixture_wall_s=fixture['wall_s'],
                      setup_native_frames=setup_frames, play_native_frames=native_frames - setup_frames,
                      native_session_metrics=copy.deepcopy(base.session.metrics),
                      total_experiment_wall_s=round(time.monotonic() - started, 6),
                      accounting='Setup, policy, observation, and native action stages are nested; command metrics overlap their parent stages, never sum them.'),
                  'checkpoint': {'artifact_sha256': artifact['sha256'], 'adapter_version': meta['adapter_version'],
                      'environment_version': environment, 'state': pin(checkpoint['state_path']),
                      'learning_context': pin(out/'learning-context.json'), 'observation': pin(out/'checkpoint-observation.json'),
                      'scenario_state': copy.deepcopy(checkpoint['scenario_state']),
                      'navigation_state': copy.deepcopy(checkpoint['navigation_state']), 'runtime_identity': runtime,
                      'profile_sha256': digest(profile), 'observation_profile_sha256': digest(observation_profile)}}
        if calls == 0 and native_frames > 0 and deterministic:
            result['control_basis'] = 'source-defined-navigation'
            result['deterministic_navigation'] = {'decisions': [row['decision'] for row in deterministic],
                'evidence': [pin(out/'playtest/events.jsonl'), pin(out/'playtest/report.json')]}
        if result['success']:
            if not adapter.objective_witness:
                raise ValueError('native_objective_witness_required')
            result['objective_witness'] = {'source': 'native-observation', 'artifact_sha256': artifact['sha256'],
                'observed_predicate': adapter.objective_witness['observed_predicate'],
                'evidence': [pin(out/'playtest/events.jsonl')], 'facts': copy.deepcopy(adapter.objective_witness)}
        _write(out/'experiment.json', result)
        return result
    finally:
        adapter.close()
