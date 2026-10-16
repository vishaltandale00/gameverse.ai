"""Offline native proof that a cancelled child's inherited checkpoint wins over its source save.

No model client is imported or called. Inputs are exact retained private receipts;
only a sanitized metadata summary is written to the requested public receipt.
This verifies native/scenario replay, while controller branch tests verify the
campaign's choice of the inherited pinned parent.
"""
from __future__ import annotations
import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path
import platform
import time

from .core import require
from .rpg_adapter import RPGNavigationAdapter, checked, pin
from .scenario import ScenarioAdapter


def read(ref):
    return json.loads(checked(ref).read_text())


def boundary(observation):
    facts = observation['facts']
    return {key: facts.get(key) for key in ('map', 'map_group', 'map_number', 'x', 'y')}, copy.deepcopy(facts.get('story', {}))


def verify(cancelled_report, binary, output, receipt):
    began = time.monotonic()
    cancelled_ref = pin(cancelled_report)
    child = read(cancelled_ref)
    require(child.get('reason') == 'campaign_cancel_requested' and child.get('usage_complete') is True,
            'checkpoint_proof_requires_settled_cancellation')
    require(not child.get('checkpoint') and not any(row.get('name') == 'experiment' and row.get('status') == 'completed'
                for row in child.get('stages', [])), 'checkpoint_proof_child_already_experimented')
    checkpoint = child['config']['initial_checkpoint']
    parent_ref = child['config']['continuation']['prior_report']
    parent = read(parent_ref)
    require(parent.get('checkpoint') == checkpoint and parent.get('final_request') == child.get('request'),
            'checkpoint_proof_parent_lineage_mismatch')
    require(not child.get('artifact') or child['artifact']['sha256'] == checkpoint['artifact_sha256'],
            'checkpoint_proof_changed_artifact')
    config = child['config']['experiment']
    manifest = read(config['provider_manifest_ref'])
    recipe = read(config['fixture_recipe'])
    profile = read(config['profile'])
    expected = read(checkpoint['observation'])
    require(manifest['rom']['sha256'] == checkpoint['artifact_sha256'], 'checkpoint_proof_provider_artifact_mismatch')
    binary_ref = pin(binary)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    base_args = dict(binary=binary_ref, targets=profile.get('navigation_targets', []),
                     navigation_policy=profile.get('navigation_policy'),
                     max_option_frames=config.get('native_option', {}).get('max_frames', 600))
    fresh_started = time.monotonic()
    fresh = RPGNavigationAdapter.open(manifest, output/'ordinary-save', **base_args)
    try:
        fresh.prepare(recipe['setup_actions'], max_frames=recipe['setup_max_frames'])
        source = fresh.observe()
        setup_frames = fresh.preparation['frames']
    finally:
        fresh.close()
    fresh_wall = time.monotonic() - fresh_started
    initial = dict(checkpoint['state'], game_version=checkpoint['artifact_sha256'],
                   navigation_state=copy.deepcopy(checkpoint['navigation_state']))
    resumed_started = time.monotonic()
    resumed = RPGNavigationAdapter.open(manifest, output/'retained-checkpoint', initial_state=initial, **base_args)
    try:
        require(resumed.preparation is None, 'checkpoint_proof_source_boot_replayed')
        scenario = read(config['scenario_ref'])
        wrapped = ScenarioAdapter(resumed, scenario, checkpoint['scenario_state'])
        observed = wrapped.observe()
        expected_boundary, expected_story = boundary(expected)
        actual_boundary, actual_story = boundary(observed)
        source_boundary, source_story = boundary(source)
        require(actual_boundary == expected_boundary and actual_story == expected_story,
                'checkpoint_proof_retained_source_state_not_restored')
        require((source_boundary, source_story) != (actual_boundary, actual_story),
                'checkpoint_proof_source_save_and_checkpoint_indistinguishable')
        navigation = checkpoint['navigation_state']
        require(resumed.boundary == navigation['boundary'] and resumed.route_steps == navigation['route_steps']
                and resumed.planner.blocked_edges == {(tuple(p), d) for p, d in navigation['blocked_edges']}
                and resumed.field_free_settle_remaining == navigation.get('field_free_settle_remaining', 0),
                'checkpoint_proof_navigation_not_restored')
        require(set(checkpoint['scenario_state']['reached']) <= set(wrapped.reached), 'checkpoint_proof_scenario_not_restored')
        render_frames = resumed.session.initial_state['render_integration_frames']
        require(render_frames == resumed.session.frame == 1, 'checkpoint_proof_render_frame_accounting')
        proof = {
            'native_boundary_and_story_equal_retained': True,
            'native_boundary_and_story_differ_from_ordinary_save': True,
            'navigation_boundary_steps_blocked_edges_settle_restored': True,
            'scenario_reached_nodes_preserved': True,
            'retained_scenario_node_count': len(checkpoint['scenario_state']['reached']),
            'ordinary_save_weekend_stage': source_story.get('VAR_SID_OC_WEEKEND'),
            'checkpoint_weekend_stage': actual_story.get('VAR_SID_OC_WEEKEND'),
            'map_differs': source_boundary['map'] != actual_boundary['map'],
            'position_differs': (source_boundary['x'], source_boundary['y']) != (actual_boundary['x'], actual_boundary['y']),
            'resume_source_setup_frames': 0, 'resume_render_integration_frames': render_frames,
            'native_actions_after_resume': 0, 'new_model_calls': 0,
        }
        emulator = resumed.session.emulator
    finally:
        resumed.close()
    resumed_wall = time.monotonic() - resumed_started
    result = {'schema': 'gameverse.rpg-cancelled-checkpoint-verification/1',
        'recorded_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope': 'Offline actual native/scenario replay from an actual pre-experiment-cancelled child. No new model campaign or complete controller-resume qualification.',
        'outcome': 'passed', 'cancelled_run_id': child['run_id'], 'retained_parent_run_id': parent['run_id'],
        'cancelled_child_usage_preserved': child['usage'], 'cancelled_child_has_no_new_checkpoint': True,
        'exact_parent_lineage_verified': True, 'artifact_sha256': checkpoint['artifact_sha256'],
        'source_save_sha256': manifest['initial_save']['sha256'],
        'retained_checkpoint_sha256': checkpoint['state']['sha256'],
        'retained_observation_sha256': checkpoint['observation']['sha256'],
        'parent_report_sha256': parent_ref['sha256'], 'cancelled_report_sha256': cancelled_ref['sha256'],
        'provider_manifest_sha256': config['provider_manifest_ref']['sha256'],
        'runtime_sha256': {'adapter': pin(Path(__file__).with_name('rpg_adapter.py'))['sha256'],
            'native_binary': binary_ref['sha256'], 'helper': pin(__file__)['sha256'],
            'campaign_controller': pin(Path(__file__).parents[1]/'prefab_pipeline/campaign.py')['sha256']},
        'proof': proof,
        'timing': {'ordinary_save_setup_frames': setup_frames, 'ordinary_save_open_setup_observe_wall_s': round(fresh_wall, 6),
            'checkpoint_open_observe_wall_s': round(resumed_wall, 6), 'total_wall_s': round(time.monotonic()-began, 6),
            'queue_wall_s': None, 'build_wall_s': None,
            'note': 'Independent native-session initializations; elapsed setup includes source admission/parser work. Resume includes one explicit real render frame.'},
        'environment': {'python': platform.python_version(), 'machine': platform.machine(), 'emulator': emulator},
        'qualification': {'live_campaign_resumed': False, 'model_calls': 0, 'whole_quest_completed': False,
            'changed_rom_restore_permitted': False, 'controller_branch_tests_owned_separately': True},
        'excluded': ['Private paths', 'Screenshots', 'RAM dumps', 'Transcripts', 'Game/save/snapshot bytes', 'Credentials']}
    Path(receipt).parent.mkdir(parents=True, exist_ok=True)
    Path(receipt).write_text(json.dumps(result, indent=2)+'\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cancelled-report', type=Path, required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.cancelled_report, args.binary, args.output, args.receipt)
    print(json.dumps({'outcome': result['outcome'], 'proof': result['proof'], 'timing': result['timing']}))


if __name__ == '__main__': main()
