"""Negative contracts for generic bounded native graph modification."""
import copy
import hashlib
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from tools.prefab_pipeline import native_mod
from tools.prefab_pipeline.native_mod import ROOT, prepare_native_mod_request

class NativeModRequestTests(unittest.TestCase):
    def setUp(self):
        def pin(path):
            return {'path': path, 'sha256': hashlib.sha256((ROOT/path).read_bytes()).hexdigest()}
        self.request = {'schema': 'native-prefab-mod-request/1', 'request_id': 'contract-check',
                        'plan': pin('research/deep-extraction/castlevania/acquisition-parity.plan.json'),
                        'rom': pin('local/roms/Castlevania - Aria of Sorrow (USA).gba'),
                        'hook_edits': [{'host_hook': 'enemy_defeat', 'constant_arguments': {'1': 2}}]}

    def test_runtime_argument_cannot_be_rebound(self):
        request = copy.deepcopy(self.request)
        request['hook_edits'][0]['constant_arguments'] = {'0': 42}
        with self.assertRaisesRegex(ValueError, 'existing scalar'):
            prepare_native_mod_request(request)

    def test_unreviewed_hook_cannot_be_added(self):
        request = copy.deepcopy(self.request)
        request['hook_edits'][0]['host_hook'] = 'new_unreviewed_entry'
        with self.assertRaisesRegex(ValueError, 'unknown'):
            prepare_native_mod_request(request)

    def test_changed_plan_rejected_before_compilation(self):
        request = copy.deepcopy(self.request)
        request['plan']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'changed pinned'):
            prepare_native_mod_request(request)

    def test_duplicate_hook_authority_rejected(self):
        request = copy.deepcopy(self.request)
        request['hook_edits'] *= 2
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            prepare_native_mod_request(request)


class RegisteredStrategyTests(unittest.TestCase):
    """Small synthetic inputs exercise frontend authority, never compile ROMs."""
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.root_patch = patch.object(native_mod, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.package = {'kind': 'component_package', 'lowering': {'native_v1': {
            'version': 'freestanding-c-thumb/1', 'sources': []}}}
        package_pin = self.write('base.package.json', self.package)
        plan = {'target': {'preserve_campaign': True}, 'native_build': {
            'version': 'gba-component-native/1', 'packages': [
                {'instance': name, 'package': {'ref': package_pin['path'], 'sha256': package_pin['sha256']}}
                for name in ('reward', 'movement')],
            'hooks': [{'host_hook': name, 'instance': instance, 'symbol': 'old', 'args': [{'constant': 1}]}
                      for name, instance in (('enemy_defeat', 'reward'), ('player_update', 'movement'))]}}
        self.request = {'schema': native_mod.SCHEMA, 'request_id': 'multi',
                        'plan': self.write('plan.json', plan), 'rom': self.write('base.gba', b'original'),
                        'strategy_lowering': {'backend': 'connected-strategy/1',
                                             'strategy': self.write('strategy.json', {'schema': 'test/1'}),
                                             'lowerer': self.write('tools/prefab_pipeline/momentum_strategy.py', b'raise RuntimeError("not during admission")')}}
        self.output = self.root/'attempt/strategy'

    def write(self, relative, value):
        path = self.root/relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value if isinstance(value, bytes) else json.dumps(value).encode())
        return {'path': str(path.relative_to(self.root)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    def result(self):
        one = self.write('attempt/strategy/reward.package.json', self.package)
        two = self.write('attempt/strategy/movement.package.json', self.package)
        receipt = self.write('attempt/strategy/receipt.json', {'status': 'generated-awaiting-native-proof'})
        return {'package_replacements': [{'instance': 'reward', 'package': one}, {'instance': 'movement', 'package': two}],
                'hook_edits': [{'host_hook': 'enemy_defeat', 'symbol': 'reward_new'},
                               {'host_hook': 'player_update', 'symbol': 'movement_new'}],
                'outputs': {'packages': [one, two]}, 'receipt': receipt}

    def test_registered_admission_does_not_execute_lowerer(self):
        admitted = native_mod.validate_native_mod_request(self.request)
        self.assertEqual(admitted['lowering']['backend'], 'connected-strategy/1')
        self.assertFalse(self.output.exists())

    def test_stale_or_unregistered_lowerer_rejected(self):
        request = copy.deepcopy(self.request)
        request['strategy_lowering']['lowerer']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'changed pinned'):
            native_mod.validate_native_mod_request(request)
        request['strategy_lowering']['lowerer'] = self.write('other.py', b'# not registered')
        with self.assertRaisesRegex(ValueError, 'registered implementation'):
            native_mod.validate_native_mod_request(request)

    def test_atomic_multi_output_merge(self):
        original = copy.deepcopy(self.request)
        merged = native_mod.merge_strategy_changes(self.request, self.result(), self.output)
        plan, _, changes = native_mod.prepare_native_mod_request(merged)
        self.assertEqual(len(changes), 4)
        self.assertEqual([hook['symbol'] for hook in plan['native_build']['hooks']], ['reward_new', 'movement_new'])
        self.assertEqual(self.request, original)
        self.assertNotIn('strategy_lowering', merged)

    def test_conflicting_or_duplicate_authority_rejected_atomically(self):
        result = self.result()
        for field in ('package_replacements', 'hook_edits'):
            request = copy.deepcopy(self.request)
            request[field] = [copy.deepcopy(result[field][0])]
            before = copy.deepcopy(request)
            with self.assertRaisesRegex(ValueError, 'conflict or duplicate'):
                native_mod.merge_strategy_changes(request, result, self.output)
            self.assertEqual(request, before)
            duplicate = copy.deepcopy(result)
            duplicate[field].append(copy.deepcopy(duplicate[field][0]))
            with self.assertRaisesRegex(ValueError, 'conflict or duplicate'):
                native_mod.merge_strategy_changes(self.request, duplicate, self.output)

    def test_stale_or_escaped_generated_artifacts_rejected(self):
        result = self.result()
        (self.root/result['package_replacements'][0]['package']['path']).write_text('changed')
        with self.assertRaisesRegex(ValueError, 'changed pinned'):
            native_mod.merge_strategy_changes(self.request, result, self.output)
        result = self.result()
        result['receipt'] = self.write('outside/receipt.json', {})
        with self.assertRaisesRegex(ValueError, 'isolated output'):
            native_mod.merge_strategy_changes(self.request, result, self.output)

    def test_generation_failure_retains_report_and_partial_diagnostics(self):
        request = copy.deepcopy(self.request)
        request['strategy_lowering']['lowerer'] = self.write('tools/prefab_pipeline/momentum_strategy.py', b'''def lower_momentum_strategy(spec, out):
    out.mkdir(parents=True)
    (out/'diagnostic.txt').write_text('retained')
    raise ValueError('generation failed')
''')
        output = self.root/'failed-attempt'
        with patch.object(native_mod.platform, 'platform', return_value='test'), patch.object(native_mod.subprocess, 'check_output', return_value='commit\n'):
            with self.assertRaisesRegex(ValueError, 'generation failed'):
                native_mod.build_native_mod_request(request, output)
        report = json.loads((output/'report.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['stages'][-1]['name'], 'strategy-lowering')
        self.assertEqual(report['stages'][-1]['outcome'], 'failed')
        self.assertTrue((output/'strategy/diagnostic.txt').is_file())
        self.assertFalse((output/'modified.plan.json').exists())

    def test_preparation_failure_retains_report(self):
        request = copy.deepcopy(self.request)
        request['plan']['sha256'] = '0'*64
        output = self.root/'failed-admission'
        with self.assertRaises(ValueError):
            native_mod.build_native_mod_request(request, output)
        report = json.loads((output/'report.json').read_text())
        self.assertEqual(report['stages'][0]['outcome'], 'failed')
        self.assertEqual(report['stages'][0]['name'], 'admit')
        self.assertGreaterEqual(report['total_wall_s'], 0)

if __name__ == '__main__':
    unittest.main()
