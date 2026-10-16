"""Cheap runner safety checks; fake stages do not qualify any native cartridge."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .contract import file_ref
from .iteration import VERSION, IterationError, IterationStages, checkpoint_compatible, default_stages, run_iteration


class IterationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('rom', 'evidence', 'state'):
            (self.root/name).write_text(name)
        self.artifact = file_ref(self.root/'rom')
        self.request = {'request_id': 'test', 'variant': 1}
        self.config = {'schema': VERSION, 'run_id': 'test', 'source_commit': 'commit',
                       'environment_version': 'env/1', 'adapter_version': 'adapter/1',
                       'loop_config_ref': 'test/1', 'mechanism_sha256': 'a'*64, 'base_rom_sha256': 'b'*64,
                       'limits': {'attempts': 2, 'model_calls': 3, 'native_frames': 30, 'wall_seconds': 10, 'cost_usd': None}}
        self.calls = []
        self.stages = IterationStages(lambda request, ctx: {'admitted': True}, self.build,
                                      self.experiment, lambda *args: {'success': True, 'trust': 'untrusted'},
                                      lambda *args: {'blocked': True})

    def build(self, request, ctx):
        self.calls.append('build')
        return {'artifact': self.artifact, 'parent_sha256': 'b'*64,
                'cheap_guard_passed': True, 'intended_edit_witness': {'changed': True}}

    def experiment(self, artifact, ctx):
        self.calls.append('experiment')
        return {'native': True, 'success': False, 'decisions': [{'request_sha256': 'actual-record'}],
                'evidence': [file_ref(self.root/'evidence')],
                'usage': {'model_calls': 1, 'native_frames': 10, 'cost_usd': None}}

    def run_loop(self, **kwargs):
        return run_iteration(self.request, self.config, self.root/'run', self.stages, **kwargs)

    def test_required_quality_cannot_be_omitted_by_callback(self):
        self.config['require_mod_quality'] = True
        result = self.run_loop()
        self.assertEqual(result['reason'], 'declared_mod_quality_not_passed')
        self.assertNotEqual(result['status'], 'success')

    def test_diagnosis_cannot_claim_success(self):
        result = self.run_loop()
        self.assertEqual(result['status'], 'artifact-built-with-diagnostics')
        self.assertEqual(result['experiment_outcome'], 'blocked')
        self.assertEqual(result['reason'], 'no_supported_repair')
        self.assertIsNone(result['usage']['cost_usd'])
        self.assertEqual(result['activation'], 'never_performed')

    def test_resume_identity_and_no_double_spend(self):
        first = self.run_loop()
        self.assertEqual(self.run_loop(resume=True), first)
        self.assertEqual(self.calls, ['build', 'experiment'])
        self.config['adapter_version'] = 'different'
        with self.assertRaisesRegex(IterationError, 'identity_mismatch'):
            self.run_loop(resume=True)

    def test_interrupted_stage_cannot_be_replayed(self):
        result = self.run_loop()
        result['status'] = 'running'
        (self.root/'run/iteration.json').write_text(json.dumps(result))
        resumed = self.run_loop(resume=True)
        self.assertEqual(resumed['reason'], 'interrupted_stage_usage_unknown')
        self.assertEqual(len(self.calls), 2)

    def test_checkpoint_rejects_different_rom_or_changed_bytes(self):
        state = {'artifact_sha256': self.artifact['sha256'], 'adapter_version': 'adapter/1',
                 'environment_version': 'env/1', 'state': file_ref(self.root/'state')}
        self.assertTrue(checkpoint_compatible(state, self.artifact, self.config))
        self.assertFalse(checkpoint_compatible(state, {'sha256': 'c'*64}, self.config))
        (self.root/'state').write_text('changed')
        self.assertFalse(checkpoint_compatible(state, self.artifact, self.config))

    def test_usage_overrun_retained_and_stopped(self):
        self.config['limits']['native_frames'] = 5
        result = self.run_loop()
        self.assertEqual(result['usage']['native_frames'], 10)
        self.assertEqual(result['reason'], 'callback_exceeded_native_frames')
        self.assertEqual(result['stages'][-1]['status'], 'failed')

    def test_finite_cost_requires_reported_billing(self):
        self.config['limits']['cost_usd'] = 1
        self.assertEqual(self.run_loop()['reason'], 'cost_budget_unverifiable')

    def test_repair_must_be_exact_supported_variant_and_readmitted(self):
        variant = {**self.request, 'variant': 2}
        self.config['supported_requests'] = [self.request, variant]
        self.stages = IterationStages(self.stages.admit, self.build, self.experiment,
                                      self.stages.diagnose, lambda *args: {'request': variant})
        result = self.run_loop()
        self.assertEqual(result['reason'], 'attempt_budget_exhausted')
        self.assertEqual([row['name'] for row in result['stages']].count('admit'), 2)
        self.assertEqual(result['usage']['model_calls'], 2)

    def test_success_needs_native_objective_witness(self):
        def experiment(artifact, context):
            result = self.experiment(artifact, context)
            result['success'] = True
            return result
        self.stages = IterationStages(self.stages.admit, self.build, experiment,
                                      self.stages.diagnose, self.stages.repair)
        self.assertEqual(self.run_loop()['reason'], 'native_objective_witness_required')

    def test_cancelled_callback_retains_unknown_consumption(self):
        def cancelled(artifact, context):
            raise KeyboardInterrupt()
        self.stages = IterationStages(self.stages.admit, self.build, cancelled,
                                      self.stages.diagnose, self.stages.repair)
        result = self.run_loop()
        self.assertEqual(result['status'], 'artifact-built-with-diagnostics')
        self.assertEqual(result['experiment_outcome'], 'cancelled')
        self.assertFalse(result['usage_complete'])
        self.assertEqual(result['unreported_usage_stages'][0]['name'], 'experiment')

    def test_default_repair_requires_causal_recommendation(self):
        from . import iteration
        from .contract import canonical_hash
        self.config['mechanism_sha256'] = file_ref(iteration.__file__)['sha256']
        self.config['supported_requests'] = [self.request]
        stages = default_stages({'schema': 'native-prefab-mod-request/1'}, self.config)
        class Context:
            config = self.config
        context = Context()
        self.assertTrue(stages.repair(self.request, {'native_diagnosis': {}}, context)['blocked'])
        diagnosis = {'native_diagnosis': {'recommended_variant_sha256': canonical_hash(self.request),
                    'reason': 'Observed unsupported mechanic; use reviewed variant',
                    'evidence': [file_ref(self.root/'evidence')]}}
        self.assertEqual(stages.repair(self.request, diagnosis, context)['request'], self.request)

    def test_cached_build_exact_request_and_generated_bytes(self):
        from . import iteration
        from .contract import canonical_hash
        request = {'schema': 'native-prefab-mod-request/1', 'request_id': 'cached',
                   'rom': {'sha256': 'b'*64}}
        self.config['mechanism_sha256'] = file_ref(iteration.__file__)['sha256']
        ref = file_ref(self.root/'evidence')
        retained = {'status': 'candidate-built', 'request': request,
                    'request_sha256': canonical_hash(request),
                    'qualification': {'native_abi_and_preservation': True},
                    'build_receipt': ref, 'lock': ref, 'derived_plan': ref,
                    'artifact': self.artifact['path'], 'artifact_sha256': self.artifact['sha256'],
                    'strategy_lowering': {'outputs': {'modules': [{'policy': ref}]}}, 'changes': [{'edit': True}]}
        receipt = self.root/'build.json';receipt.write_text(json.dumps(retained))
        self.config['cached_build_report'] = file_ref(receipt)
        stages = default_stages(request, self.config)
        class Context:
            config = self.config
        context = Context()
        self.assertTrue(stages.admit(request, context)['cache'])
        built = stages.build(request, context)
        self.assertTrue(built['cheap_guard_passed'])
        with self.assertRaisesRegex(IterationError, 'request_or_guard'):
            stages.admit({**request, 'request_id': 'different'}, context)
        (self.root/'evidence').write_text('changed source or receipt')
        with self.assertRaisesRegex(IterationError, 'artifact_or_source'):
            stages.build(request, context)

    def test_prepare_config_preserves_limits_and_records_refresh(self):
        from . import iteration, native_mod
        root = self.root.resolve()
        paths = ['tools/prefab_pipeline/iteration.py', 'tools/prefab_pipeline/native_mod.py',
                 'tools/composition/native_build.py', 'tools/playtester/experiment.py',
                 'tools/playtester/aria_adapter.py', 'tools/playtester/core.py',
                 'tools/playtester/models.py', 'tools/re/session/bridge.py', 'derived/actual.host.json']
        for name in paths:
            path = root/name;path.parent.mkdir(parents=True, exist_ok=True);path.write_text(name)
        host = file_ref(root/'derived/actual.host.json')
        plan = root/'plan.json';plan.write_text(json.dumps({'native_build': {'host': {'ref': 'derived/actual.host.json', 'sha256': host['sha256']}}}))
        template = json.loads(json.dumps(self.config))
        template['experiment'] = {name: file_ref(root/'evidence') for name in ('profile', 'memory_profile', 'fixture_recipe')}
        template['experiment']['policy_ref'] = {'path': str(root/'tools/playtester/models.py'), 'sha256': 'old-policy'}
        template['initial_checkpoint'] = {'old': True}
        template['cached_build_report'] = {'old': True}
        request = {'request_id': 'fresh', 'plan': file_ref(plan), 'rom': {'sha256': 'b'*64}}
        with patch.object(native_mod, 'ROOT', root), patch.object(native_mod, 'validate_native_mod_request', return_value={'lowering': None}), patch.object(iteration, '__file__', str(root/'tools/prefab_pipeline/iteration.py')), patch.object(iteration.subprocess, 'check_output', return_value='commit'):
            prepared = iteration.prepare_iteration_config(request, template, 'new-run')
        self.assertEqual(prepared['limits'], template['limits'])
        self.assertNotIn('initial_checkpoint', prepared)
        self.assertNotIn('cached_build_report', prepared)
        self.assertIn('initial_checkpoint', template)
        self.assertTrue(any(ref['path'] == str(root/'derived/actual.host.json') for ref in prepared['mechanism_refs']))
        manifest = prepared['preparation']['refreshed_pins']
        self.assertTrue(any(row['field'] == 'experiment.policy_ref' and row['before_sha256'] == 'old-policy' and row['changed'] for row in manifest))

    def test_prepare_never_repins_invalid_request(self):
        from . import iteration, native_mod
        with patch.object(native_mod, 'validate_native_mod_request', side_effect=ValueError('stale request source')):
            with self.assertRaisesRegex(ValueError, 'stale request'):
                iteration.prepare_iteration_config({'request_id': 'bad'}, self.config, 'new-run')

    def test_explicit_pause_keeps_checkpoint_without_repair(self):
        self.config['pause_after_experiment'] = True
        result = self.run_loop()
        self.assertEqual(result['experiment_outcome'], 'partial')
        self.assertEqual(result['reason'], 'awaiting_explicit_continuation')
        self.assertEqual([s['name'] for s in result['stages']], ['admit', 'build', 'experiment'])

    def test_continuation_exact_native_learning_state_and_fresh_identity(self):
        from . import iteration
        config = json.loads(json.dumps(self.config))
        config['experiment'] = {name: file_ref(self.root/'evidence') for name in ('profile', 'memory_profile', 'fixture_recipe')}
        learning = self.root/'learning.json';learning.write_text('{}')
        checkpoint = {'artifact_sha256': self.artifact['sha256'], 'adapter_version': config['adapter_version'],
                      'environment_version': config['environment_version'], 'state': file_ref(self.root/'state'),
                      'learning_context': file_ref(learning)}
        prior = {'status': 'artifact-built-with-diagnostics', 'reason': 'awaiting_explicit_continuation',
                 'run_id': 'prior', 'usage_complete': True, 'artifact': self.artifact, 'checkpoint': checkpoint,
                 'config': config, 'usage': {'model_calls': 1, 'native_frames': 10, 'cost_usd': None},
                 'final_request': self.request, 'build_report': file_ref(self.root/'evidence')}
        report = self.root/'prior.json';report.write_text(json.dumps(prior))
        with patch.object(iteration, 'prepare_iteration_config', return_value=json.loads(json.dumps(config))):
            prepared = iteration.prepare_continuation_config(file_ref(report), config, 'next')
        self.assertEqual(prepared['continuation_request'], self.request)
        self.assertEqual(prepared['initial_checkpoint'], checkpoint)
        self.assertFalse(prepared['pause_after_experiment'])
        self.assertEqual(prepared['limits'], config['limits'])
        learning.write_text('changed')
        with self.assertRaisesRegex(IterationError, 'checkpoint_mismatch'):
            iteration.prepare_continuation_config(file_ref(report), config, 'next')

    def test_reviewed_variant_rebuild_never_reuses_other_request_cache(self):
        from . import iteration
        from .contract import canonical_hash
        request = {'schema': 'native-prefab-mod-request/1', 'request_id': 'baseline', 'rom': {'sha256': 'b'*64}}
        variant = {**request, 'request_id': 'repair'}
        self.config['mechanism_sha256'] = file_ref(iteration.__file__)['sha256']
        self.config['supported_requests'] = [request, variant]
        receipt = self.root/'cached.json';receipt.write_text(json.dumps({'request_sha256': canonical_hash(request)}))
        self.config['cached_build_report'] = file_ref(receipt)
        stages = default_stages(request, self.config)
        class Context:
            config = self.config
        with patch('tools.prefab_pipeline.native_mod.validate_native_mod_request') as admission:
            admission.return_value = {}
            self.assertTrue(stages.admit(variant, Context())['admitted'])
            admission.assert_called_once_with(variant)

    def test_experiment_checkpoint_mutation_cannot_change_input_provenance(self):
        from .contract import canonical_hash
        initial = {'artifact_sha256': self.artifact['sha256'], 'adapter_version': self.config['adapter_version'],
                   'environment_version': self.config['environment_version'], 'state': file_ref(self.root/'state'),
                   'scenario_state': {'native_events': [{'frame': 1}]}}
        self.config['initial_checkpoint'] = initial
        def experiment(artifact, context):
            context.checkpoint['scenario_state']['native_events'].append({'frame': 2})
            return self.experiment(artifact, context)
        self.stages = IterationStages(self.stages.admit, self.build, experiment,
                                      self.stages.diagnose, self.stages.repair)
        result = self.run_loop()
        self.assertEqual(len(result['config']['initial_checkpoint']['scenario_state']['native_events']), 1)
        self.assertEqual(result['input_sha256'], canonical_hash({'request': result['request'], 'config': result['config']}))
        persisted = json.loads((self.root/'run/inputs.json').read_text())
        self.assertEqual(persisted['config'], result['config'])

    def test_recipe_readset_ignores_unrelated_manifest_addition(self):
        from . import iteration, native_mod
        from .contract import canonical_hash
        root = self.root.resolve()
        for name in ('tools/prefab_pipeline/iteration.py', 'models.py', 'derived/host.json'):
            path=root/name;path.parent.mkdir(parents=True, exist_ok=True);path.write_text(name)
        host=file_ref(root/'derived/host.json')
        plan=root/'plan.json';plan.write_text(json.dumps({'native_build': {'host': {'ref': 'derived/host.json', 'sha256': host['sha256']}}}))
        request={'plan': file_ref(plan), 'rom': {'sha256': 'b'*64}}
        template=json.loads(json.dumps(self.config));template['runtime_manifest']={'path': 'manifest.json', 'recipe_id': 'selected', 'version_basis': 'recipe-readset/1'}
        template['experiment']={name: file_ref(root/'evidence') for name in ('profile','memory_profile','fixture_recipe')}
        template['experiment']['policy_ref']=file_ref(root/'models.py')
        paths=['tools/prefab_pipeline/iteration.py','models.py','derived/host.json','plan.json','evidence']
        files=[{'path': name, 'sha256': file_ref(root/name)['sha256'], 'recipes': ['selected']} for name in paths]
        inventory={'files': files};manifest=root/'manifest.json';manifest.write_text(json.dumps(inventory))
        patches=(patch.object(native_mod,'ROOT',root),patch.object(native_mod,'validate_native_mod_request',return_value={'lowering': None}),patch.object(iteration,'__file__',str(root/'tools/prefab_pipeline/iteration.py')),patch.object(iteration.subprocess,'check_output',return_value='commit'))
        with patches[0],patches[1],patches[2],patches[3]:
            first=iteration.prepare_iteration_config(request,template,'one')
            inventory['files'].append({'path':'unrelated-uninstalled-rpg.rom','sha256':'f'*64,'recipes':['other']})
            manifest.write_text(json.dumps(inventory))
            second=iteration.prepare_iteration_config(request,template,'two')
            self.assertEqual(first['runtime_readset_pin'],second['runtime_readset_pin'])
            self.assertNotEqual(first['runtime_manifest_pin'],second['runtime_manifest_pin'])
            self.assertNotIn(str(manifest),[row['path'] for row in first['mechanism_refs']])
            self.assertEqual(first['runtime_readset_pin']['sha256'],canonical_hash({key:value for key,value in first['runtime_readset_pin'].items() if key!='sha256'}))
            (root/'models.py').write_text('selected runtime changed')
            with self.assertRaisesRegex(IterationError,'manifest_input_changed'):
                iteration.prepare_iteration_config(request,template,'three')


if __name__ == '__main__':
    unittest.main()
