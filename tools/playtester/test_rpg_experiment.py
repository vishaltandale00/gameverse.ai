"""Registered experiment integration with fake native/provider boundaries only."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from . import rpg_experiment as module
from .core import digest
from .experiment import pin


class FakePolicy:
    requires_model = True
    def __init__(self, config, **kwargs):
        self.thresholds = kwargs
    def choose(self, context, options, timeout):
        return {'accepted': True, 'action_id': options[0]['id'], 'record': {'provider': 'fake-provider'}}


class FakeAdapter:
    def __init__(self, output, manifest, *, initial_state=None, semantic=False, fault=False):
        self.output = Path(output)
        self.output.mkdir(parents=True)
        self.session = SimpleNamespace(native_counter=1 if initial_state else 0, metrics={'command_count': {}})
        self.preparation = None
        self.version = manifest['rom']['sha256']
        self.story = 1 if initial_state else 0
        self.semantic, self.fault = semantic, fault
        self.closed = False
        self.prepare_calls = 0
        self.navigation = copy.deepcopy(initial_state.get('navigation_state', {})) if initial_state else {'blocked_edges': [], 'route_steps': 0}
    def hello(self):
        return {'schema_version': 1, 'isolated': True, 'capabilities': ['observe', 'act'],
            'game_id': 'siddarth-emerald', 'game_version': self.version, 'adapter_version': 'sid-rpg-navigation/1',
            'max_action_frames': 10, 'emulator': {'name': 'fake-native', 'version': '1'}}
    def prepare(self, actions, *, max_frames):
        self.prepare_calls += 1
        frames = sum(row['frames'] for row in actions)
        self.session.native_counter += frames
        self.preparation = {'frames': frames}
    def observe(self):
        options = [{'id': 'route', 'description': 'Source route', 'keys': [], 'frames': 10}]
        if self.semantic:
            options.append({'id': 'battle', 'description': 'Battle move', 'keys': [], 'frames': 10})
        return {'frame': self.session.native_counter, 'state_key': str(self.story), 'phase': 'overworld',
                'facts': {'quest': self.story}, 'progress': {'quest': self.story}, 'options': options}
    def act(self, action, *, max_frames):
        if self.fault:
            raise ValueError('fake-native-fault')
        self.session.native_counter += 10
        self.story += 1
        self.navigation['route_steps'] += 1
        return {'frames': 10}
    def checkpoint(self):
        path = self.output/'checkpoint.ss'
        path.write_text('native-state')
        return {'state_path': str(path), 'navigation_state': copy.deepcopy(self.navigation)}
    def close(self):
        self.closed = True


class RPGExperimentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'rom').write_text('exact-candidate')
        (self.root/'binary').write_text('fake-native')
        self.artifact = pin(self.root/'rom')
        profile = {'schema_version': 1, 'game_id': 'siddarth-emerald', 'objective': 'Source quest reaches two',
                   'navigation_targets': [{'id': 'route', 'map': 'map', 'position': [1, 2]}]}
        manifest = {'game_id': 'siddarth-emerald', 'rom': self.artifact}
        recipe = {'setup_actions': [{'keys': ['A'], 'frames': 3}], 'setup_max_frames': 3}
        scenario = {'schema': 'native-scenario-graph/1', 'id': 'quest', 'objective': 'Native quest two',
                    'nodes': [{'id': 'two', 'conditions': [{'field': 'quest', 'op': 'ge', 'value': 2}]}], 'goals': ['two']}
        for name, value in [('profile', profile), ('manifest', manifest), ('recipe', recipe), ('scenario', scenario)]:
            (self.root/(name+'.json')).write_text(json.dumps(value))
        self.config = {'adapter_version': 'sid-rpg-navigation/1', 'environment_version': 'fake-native/1',
            'experiment': {'provider_manifest_ref': pin(self.root/'manifest.json'), 'profile': pin(self.root/'profile.json'),
                          'fixture_recipe': pin(self.root/'recipe.json'), 'scenario_ref': pin(self.root/'scenario.json'),
                          'native_binary_ref': pin(self.root/'binary'), 'sid_env_file': '/fake/credential-reference',
                          'max_frames': 30, 'max_steps': 3, 'max_model_calls': 3, 'max_seconds': 10,
                          'native_option': {'max_frames': 10}}}
        self.context = SimpleNamespace(config=self.config, output=self.root/'first', checkpoint=None,
            remaining=lambda: {'model_calls': 3, 'native_frames': 100, 'wall_seconds': 10})
        self.adapters = []
        self.open_kwargs = []
        self.semantic, self.fault = False, False
        def open_adapter(manifest, output, **kwargs):
            adapter = FakeAdapter(output, manifest, initial_state=kwargs.get('initial_state'),
                                  semantic=self.semantic, fault=self.fault)
            self.open_kwargs.append(copy.deepcopy(kwargs))
            self.adapters.append(adapter)
            return adapter
        patches = [patch.object(module, 'load_sid_reference'),
                   patch.object(module.ProviderConfig, 'from_env', return_value=SimpleNamespace(provider='fake', model='d1', base_url='local://d1')),
                   patch.object(module.ChatPolicy, 'from_env', return_value=SimpleNamespace(model='s2', endpoint='local://s2')),
                   patch.object(module, 'DecisionPolicy', FakePolicy),
                   patch.object(module.RPGNavigationAdapter, 'open', side_effect=open_adapter)]
        for item in patches:
            item.start(); self.addCleanup(item.stop)

    def run_experiment(self):
        return module.experiment_rpg_candidate(self.artifact, self.context)

    def test_source_defined_actions_zero_calls_actual_receipts_and_native_goal(self):
        result = self.run_experiment()
        self.assertTrue(result['success'])
        self.assertEqual(result['usage'], {'model_calls': 0, 'native_frames': 23, 'cost_usd': None})
        self.assertEqual(result['control_basis'], 'source-defined-navigation')
        self.assertEqual(len(result['deterministic_navigation']['decisions']), 2)
        self.assertEqual(result['deterministic_navigation']['decisions'][0]['result']['record']['policy'], 'single_available_action')
        self.assertEqual(result['decisions'], [])
        self.assertEqual(result['timing']['setup_native_frames'], 3)
        self.assertEqual(result['timing']['play_native_frames'], 20)
        self.assertEqual(result['checkpoint']['navigation_state']['route_steps'], 2)
        self.assertIn('two', result['checkpoint']['scenario_state']['reached'])
        self.assertEqual(result['objective_witness']['source'], 'native-observation')
        self.assertTrue(self.adapters[0].closed)

    def test_resume_restores_navigation_learning_and_current_observation_without_setup(self):
        self.config['experiment']['max_steps'] = 1
        first = self.run_experiment()
        self.assertFalse(first['success'])
        self.context.checkpoint = first['checkpoint']
        self.context.output = self.root/'resume'
        result = self.run_experiment()
        self.assertEqual(self.adapters[1].prepare_calls, 0)
        self.assertEqual(self.open_kwargs[1]['initial_state']['navigation_state'], first['checkpoint']['navigation_state'])
        self.assertEqual(result['usage']['native_frames'], 11)
        self.assertEqual(result['timing']['setup_native_frames'], 1)
        observation = json.loads(Path(result['checkpoint']['observation']['path']).read_text())
        self.assertEqual(observation['facts']['quest'], 2)
        learning = json.loads(Path(result['checkpoint']['learning_context']['path']).read_text())
        self.assertGreaterEqual(sum(learning['state_visits'].values()), 3)
        self.assertTrue(result['success'])

    def test_semantic_choice_uses_existing_policy_and_records_actual_model_calls(self):
        self.semantic = True
        result = self.run_experiment()
        self.assertEqual(result['usage']['model_calls'], 2)
        self.assertEqual(len(result['decisions']), 2)
        self.assertNotIn('control_basis', result)
        self.assertNotIn('deterministic_navigation', result)
        self.assertEqual(result['configuration']['confidence_threshold'], .65)
        self.assertEqual(result['configuration']['margin_threshold'], .20)

    def test_fault_before_executed_action_has_no_deterministic_proof(self):
        self.fault = True
        result = self.run_experiment()
        self.assertFalse(result['success'])
        self.assertEqual(result['reason'], 'adapter_or_policy_error')
        self.assertEqual(result['deterministic_actions'], [])
        self.assertNotIn('control_basis', result)

    def test_changed_model_endpoint_rejects_resume_before_native(self):
        self.config['experiment']['max_steps'] = 1
        first = self.run_experiment()
        self.context.checkpoint = first['checkpoint']
        self.context.checkpoint['runtime_identity']['model_binding']['system1']['endpoint'] = 'other://endpoint'
        self.context.output = self.root/'resume'
        with self.assertRaisesRegex(ValueError, 'runtime_mismatch'):
            self.run_experiment()
        self.assertEqual(len(self.adapters), 1)

    def test_changed_state_bytes_rejects_resume_before_native(self):
        self.config['experiment']['max_steps'] = 1
        first = self.run_experiment()
        self.context.checkpoint = first['checkpoint']
        Path(first['checkpoint']['state']['path']).write_text('changed')
        self.context.output = self.root/'resume'
        with self.assertRaisesRegex(ValueError, 'pin_mismatch'):
            self.run_experiment()
        self.assertEqual(len(self.adapters), 1)

    def test_setup_cannot_spend_frame_budget(self):
        self.context.remaining = lambda: {'model_calls': 3, 'native_frames': 3, 'wall_seconds': 10}
        with self.assertRaisesRegex(ValueError, 'fixture_native_frame_budget'):
            self.run_experiment()
        self.assertEqual(self.adapters, [])

    def test_unsupported_wait_record_not_deterministic_proof(self):
        events = [{'event': 'decision', 'step': 0, 'result': {'action_id': 'wait', 'record': {'policy': 'continue_model_wait'}}},
                  {'event': 'action_receipt', 'step': 1, 'action': {'id': 'wait'}, 'receipt': {'frames': 1}}]
        self.assertEqual(module._deterministic_actions(events, {}, {}), [])

    def test_navigation_policy_forwarded_and_identity_pinned(self):
        path = self.root/'profile.json'
        profile = json.loads(path.read_text())
        profile['navigation_policy'] = 'source-live-pois/1'
        path.write_text(json.dumps(profile))
        self.config['experiment']['profile'] = pin(path)
        self.run_experiment()
        self.assertEqual(self.open_kwargs[0]['navigation_policy'], 'source-live-pois/1')


if __name__ == '__main__':
    unittest.main()
