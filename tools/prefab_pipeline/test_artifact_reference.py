"""Synthetic pinned input checks; no provider imports, emulator or model calls."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .contract import file_ref
from . import artifact_reference as provider
from .iteration import IterationStages, VERSION, run_iteration


class ArtifactReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        def write(name, value):
            path = self.root/name;path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value) if isinstance(value, dict) else value)
            return {'path': name, 'sha256': file_ref(path)['sha256']}
        self.write = write
        rom = write('private/rom.gba', 'synthetic-rom')
        elf = write('private/rom.elf', 'synthetic-elf')
        save = write('private/start.sav', 'synthetic-save')
        source = write('provider/source.py', 'raise RuntimeError("must not import")')
        manifest = {'schema': 'gameverse.sid-rpg-provider/1', 'provider_root': str(self.root/'provider'),
                    'game_id': 'fixture-rpg', 'rom': file_ref(self.root/rom['path']),
                    'elf': file_ref(self.root/elf['path']), 'initial_save': file_ref(self.root/save['path']),
                    'sources': {'fixture': file_ref(self.root/source['path'])}, 'tools': {}, 'source_inputs': {}}
        install = write('private/provider.json', manifest)
        profile = write('profile.json', {'game_id': 'fixture-rpg'})
        quality = write('scenario.json', {'schema': 'native-scenario-graph/1', 'id': 'route',
            'nodes': [{'id': 'goal', 'conditions': [{'field': 'x', 'op': 'ge', 'value': 1}]}], 'goals': ['goal']})
        self.request = {'schema': provider.SCHEMA, 'request_id': 'fixture', 'role': 'original',
            'game_id': 'fixture-rpg', 'source_revision': 'source-v1', 'source_rom': rom,
            'artifact': rom, 'elf': elf, 'save': save, 'provider_manifest': install,
            'game_profile': profile, 'quality': quality}
        self.config = {'runtime_manifest': {'path': 'authority.json', 'recipe_id': 'fixture-recipe'},
                       'adapter_version': 'fixture-adapter/1'}
        self.publish()

    def publish(self):
        request = self.write('request.json', self.request)
        pins = [request] + [value for value in self.request.values() if isinstance(value, dict) and 'sha256' in value]
        self.write('authority.json', {'recipes': [{'id': 'fixture-recipe', 'request_path': request['path'],
                    'request_sha256': request['sha256']}],
            'files': [{**pin, 'recipes': ['fixture-recipe']} for pin in pins]})

    def test_original_equal_source_is_copied_without_fake_compile_or_edit(self):
        result = provider.reference_artifact(self.request, self.config, self.root/'out', root=self.root)
        self.assertEqual(result['artifact']['sha256'], self.request['source_rom']['sha256'])
        self.assertEqual(result['status'], 'artifact-reused-copy-verified')
        self.assertIsNone(result['build_seconds'])
        self.assertNotIn('intended_edit_witness', result)
        self.assertEqual(result['qualification']['coverage']['candidate'], 'unavailable')

    def test_registration_and_data_changes_fail_closed(self):
        changed = {**self.request, 'request_id': 'client-invented'}
        with self.assertRaisesRegex(provider.ArtifactReferenceError, 'request_identity'):
            provider.validate_artifact_reference(changed, self.config, root=self.root)
        (self.root/'private/rom.gba').write_text('changed')
        with self.assertRaisesRegex(provider.ArtifactReferenceError, 'pin_mismatch'):
            provider.validate_artifact_reference(self.request, self.config, root=self.root)

    def test_candidate_cannot_use_original_only_scenario_as_mod_quality(self):
        self.request['role'] = 'candidate';self.publish()
        with self.assertRaisesRegex(ValueError, 'invalid_mod_quality'):
            provider.validate_artifact_reference(self.request, self.config, root=self.root)

    def test_iteration_prebuilt_partial_preserves_operation_and_na_build(self):
        from . import iteration
        config = {**self.config, 'schema': VERSION, 'run_id': 'prebuilt', 'source_commit': 'test',
            'environment_version': 'test/1', 'loop_config_ref': 'fixture',
            'mechanism_sha256': file_ref(iteration.__file__)['sha256'],
            'base_rom_sha256': self.request['source_rom']['sha256'],
            'limits': {'attempts': 2, 'model_calls': 2, 'native_frames': 2, 'wall_seconds': 10, 'cost_usd': None}}
        def experiment(artifact, context):
            return {'native': True, 'success': False, 'reason': 'step_limit',
                    'usage': {'model_calls': 1, 'native_frames': 1, 'cost_usd': None},
                    'decisions': [{'unit_stub': True}], 'evidence': [file_ref(self.root/'scenario.json')]}
        with patch.object(provider, 'ROOT', self.root):
            registered = provider.artifact_stages()
            stages = IterationStages(registered.admit, registered.build, experiment, registered.diagnose, registered.repair)
            result = run_iteration(self.request, config, self.root/'run', stages)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['artifact_status'], 'artifact-reused')
        self.assertIsNone(result['build_seconds'])
        self.assertEqual(result['repairs'], [])
        self.assertIn('artifact-reference', [row['name'] for row in result['stages']])
        self.assertNotIn('build', [row['name'] for row in result['stages']])

    def test_zero_model_navigation_requires_sid_source_policy_records(self):
        from . import iteration
        def experiment(artifact, context):
            evidence=[file_ref(self.root/'scenario.json')]
            return {'native': True, 'success': False, 'reason': 'step_limit', 'control_basis': 'source-defined-navigation',
                'usage': {'model_calls': 0, 'native_frames': 1, 'cost_usd': None}, 'decisions': [], 'evidence': evidence,
                'deterministic_navigation': {'decisions': [{'event': 'decision', 'result': {'accepted': True,
                    'action_id': 'follow-observed-path', 'record': {'policy': 'single_available_action'}}}], 'evidence': evidence}}
        for adapter, expected in [('sid-rpg-navigation/1', 'partial'), ('other-adapter/1', 'blocked')]:
            config={**self.config, 'schema': VERSION, 'run_id': adapter, 'adapter_version': adapter,
                'source_commit': 'test', 'environment_version': 'test/1', 'loop_config_ref': 'fixture',
                'mechanism_sha256': file_ref(iteration.__file__)['sha256'],
                'base_rom_sha256': self.request['source_rom']['sha256'],
                'limits': {'attempts': 1, 'model_calls': 2, 'native_frames': 2, 'wall_seconds': 10, 'cost_usd': None}}
            with patch.object(provider, 'ROOT', self.root):
                selected=provider.artifact_stages()
                stages=IterationStages(selected.admit,selected.build,experiment,selected.diagnose,selected.repair)
                result=run_iteration(self.request,config,self.root/('run-'+adapter.split('/')[0]),stages)
            self.assertEqual(result['status'],expected)
            self.assertEqual(result['usage']['model_calls'],0)


if __name__ == '__main__':
    unittest.main()
