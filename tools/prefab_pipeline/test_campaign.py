"""Bounded controller tests; synthetic receipts provide no native qualification."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from . import campaign, iteration
from .contract import file_ref


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('rom', 'state', 'learning', 'build', 'evidence'):
            (self.root/name).write_text(name)
        self.artifact = file_ref(self.root/'rom')
        self.request = {'request_id': 'campaign-test'}
        self.template = {'schema': iteration.VERSION, 'run_id': 'template', 'source_commit': 'commit',
            'environment_version': 'env/1', 'adapter_version': 'adapter/1', 'loop_config_ref': 'test',
            'mechanism_sha256': 'a'*64, 'base_rom_sha256': 'b'*64,
            'experiment': {name: file_ref(self.root/'evidence') for name in ('profile', 'memory_profile', 'fixture_recipe')},
            'limits': {'attempts': 1, 'model_calls': 2, 'native_frames': 20, 'wall_seconds': 10, 'cost_usd': None}}
        self.config = {'schema': campaign.VERSION, 'run_id': 'test', 'limits': {
            'chunks': 4, 'repairs': 0, 'model_calls': 5, 'native_frames': 50, 'wall_seconds': 30, 'cost_usd': None}}
        self.seen = []
        self.success_at = None
        self.cancel_at = None
        self.unknown = False
        self.experiment_reason = 'model_call_limit'
        def prepare(request, template, run_id):
            result = copy.deepcopy(template)
            result['run_id'] = run_id
            return result
        self.patch = patch.object(iteration, 'prepare_iteration_config', side_effect=prepare)
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.patch2 = patch.object(campaign, 'prepare_iteration_config', side_effect=prepare)
        self.patch2.start(); self.addCleanup(self.patch2.stop)

    def stages(self, request, config):
        self.seen.append(copy.deepcopy(config))
        def build(request, ctx):
            return {'artifact': self.artifact, 'build_report': file_ref(self.root/'build'),
                    'parent_sha256': 'b'*64, 'cheap_guard_passed': True, 'intended_edit_witness': {'edit': True}}
        def experiment(artifact, ctx):
            if self.unknown:
                raise KeyboardInterrupt()
            used = min(ctx.remaining()['model_calls'], 2)
            frames = min(ctx.remaining()['native_frames'], 20)
            evidence = [file_ref(self.root/'evidence')]
            result = {'native': True, 'success': len(self.seen) == self.success_at, 'reason': self.experiment_reason,
                      'decisions': [{'decision': 'synthetic'}], 'evidence': evidence,
                      'usage': {'model_calls': used, 'native_frames': frames, 'cost_usd': None},
                      'checkpoint': {'artifact_sha256': artifact['sha256'], 'adapter_version': 'adapter/1',
                       'environment_version': 'env/1', 'state': file_ref(self.root/'state'),
                       'learning_context': file_ref(self.root/'learning')}}
            if result['success']:
                result['objective_witness'] = {'source': 'native-observation', 'artifact_sha256': artifact['sha256'],
                    'observed_predicate': 'synthetic-only', 'evidence': evidence}
            if len(self.seen) == self.cancel_at:
                (self.root/'run/cancel.request').write_text('cancel')
            return result
        return iteration.IterationStages(lambda *args: {'admitted': True}, build, experiment,
            lambda *args: {}, lambda *args: {'blocked': True})

    def run_campaign(self, **kwargs):
        return campaign.run_campaign(self.request, self.template, self.config, self.root/'run',
                                     stages_factory=self.stages, **kwargs)

    def test_chains_exact_checkpoint_and_clamps_cumulative_caps(self):
        result = self.run_campaign()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['usage']['model_calls'], 5)
        self.assertEqual(result['usage']['native_frames'], 50)
        self.assertEqual(len(self.seen), 3)
        self.assertEqual(self.seen[-1]['limits']['model_calls'], 1)
        self.assertEqual(self.seen[-1]['limits']['native_frames'], 10)
        self.assertEqual(self.seen[1]['initial_checkpoint']['artifact_sha256'], self.artifact['sha256'])
        self.assertEqual(self.seen[1]['initial_checkpoint']['learning_context'], file_ref(self.root/'learning'))
        self.assertEqual(self.seen[1]['cached_build_report'], file_ref(self.root/'build'))
        self.assertEqual(self.template['limits']['model_calls'], 2)
        self.assertEqual(result['qualification']['native_objective'], 'pending')

    def test_masked_adapter_fault_stops_after_one_chunk(self):
        self.experiment_reason = 'adapter_or_policy_error'
        result = self.run_campaign()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['reason'], 'experiment_adapter_or_policy_error')
        self.assertEqual(result['chunks'][0]['reason'], 'attempt_budget_exhausted')
        self.assertEqual(len(self.seen), 1)

    def test_policy_stop_is_not_resource_exhaustion(self):
        self.experiment_reason = 'policy_stop'
        result = self.run_campaign()
        self.assertEqual(result['reason'], 'experiment_policy_stop')
        self.assertEqual(len(self.seen), 1)

    def test_goal_stops_before_budget(self):
        self.success_at = 2
        result = self.run_campaign()
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['usage']['model_calls'], 4)
        self.assertEqual(len(self.seen), 2)
        self.assertEqual(result['activation'], 'never_performed')
        self.assertEqual(self.run_campaign(resume=True)['usage'], result['usage'])

    def test_cancel_between_stages_resumes_same_state_cumulative_usage(self):
        self.cancel_at = 1
        first = self.run_campaign()
        self.assertEqual(first['status'], 'cancelled')
        self.assertTrue(first['usage_complete'])
        self.assertEqual(first['usage']['model_calls'], 2)
        self.assertEqual(self.run_campaign(resume=True)['status'], 'cancelled')
        (self.root/'run/cancel.request').unlink()
        self.cancel_at = None
        resumed = self.run_campaign(resume=True)
        self.assertEqual(resumed['usage']['model_calls'], 5)
        self.assertEqual(self.seen[1]['initial_checkpoint']['state'], file_ref(self.root/'state'))

    def test_real_interruption_unknown_usage_blocks_without_replay(self):
        self.unknown = True
        first = self.run_campaign()
        self.assertEqual(first['status'], 'blocked')
        self.assertFalse(first['usage_complete'])
        self.run_campaign(resume=True)
        self.assertEqual(len(self.seen), 1)

    def test_recover_completed_pending_child_once(self):
        self.cancel_at = 1
        self.run_campaign()
        path = self.root/'run/campaign.json'
        report = json.loads(path.read_text())
        report.update(status='running', usage={'model_calls': 0, 'native_frames': 0, 'cost_usd': 0., 'repairs': 0})
        report['chunks'][0]['status'] = 'running'
        path.write_text(json.dumps(report))
        first = self.run_campaign(resume=True)
        self.assertEqual(first['usage']['model_calls'], 2)
        (self.root/'run/cancel.request').unlink()
        self.cancel_at = None
        result = self.run_campaign(resume=True)
        self.assertEqual(result['usage']['model_calls'], 5)

    def test_pending_child_mismatches_never_adopt_usage_or_success(self):
        from .contract import canonical_hash
        for mismatch in ('request', 'config', 'input_sha256'):
            with self.subTest(mismatch=mismatch):
                run_path = self.root/'run'
                if run_path.exists():
                    import shutil
                    shutil.rmtree(run_path)
                self.cancel_at = len(self.seen) + 1
                self.run_campaign()
                path = run_path/'campaign.json'
                report = json.loads(path.read_text())
                report.update(status='running', usage={'model_calls': 0, 'native_frames': 0, 'cost_usd': 0., 'repairs': 0})
                report['chunks'][0]['status'] = 'running'
                path.write_text(json.dumps(report))
                child_path = run_path/'chunk-0001/iteration.json'
                child = json.loads(child_path.read_text())
                if mismatch == 'input_sha256':
                    child['input_sha256'] = '0'*64
                else:
                    child[mismatch]['unexpected'] = True
                    child['input_sha256'] = canonical_hash({'request': child['request'], 'config': child['config']})
                child['status'] = 'success'
                child_path.write_text(json.dumps(child))
                child_bytes = child_path.read_bytes()
                count = len(self.seen)
                result = self.run_campaign(resume=True)
                self.assertEqual(result['reason'], 'pending_child_identity_mismatch')
                self.assertEqual(result['usage']['model_calls'], 0)
                self.assertEqual(result['chunks'][0]['status'], 'running')
                self.assertEqual(len(self.seen), count)
                self.assertEqual(child_path.read_bytes(), child_bytes)

    def test_pending_missing_receipt_never_replayed(self):
        (self.root/'run/cancel.request').parent.mkdir()
        (self.root/'run/cancel.request').write_text('cancel')
        self.run_campaign()
        path = self.root/'run/campaign.json'
        report = json.loads(path.read_text())
        report['status'] = 'running'
        report['chunks'] = [{'status': 'running', 'output': str(self.root/'missing')}]
        path.write_text(json.dumps(report))
        result = self.run_campaign(resume=True)
        self.assertEqual(result['reason'], 'interrupted_chunk_usage_unknown')
        self.assertEqual(self.seen, [])

    def test_running_child_recovery_blocks_unknown_usage(self):
        self.cancel_at = 1
        self.run_campaign()
        path = self.root/'run/campaign.json'
        report = json.loads(path.read_text())
        report.update(status='running', usage={'model_calls': 0, 'native_frames': 0, 'cost_usd': 0., 'repairs': 0})
        report['chunks'][0]['status'] = 'running'
        path.write_text(json.dumps(report))
        child_path = self.root/'run/chunk-0001/iteration.json'
        child = json.loads(child_path.read_text())
        child['status'] = 'running'
        child_path.write_text(json.dumps(child))
        result = self.run_campaign(resume=True)
        self.assertEqual(result['reason'], 'interrupted_stage_usage_unknown')
        self.assertFalse(result['usage_complete'])
        self.assertEqual(result['usage']['model_calls'], 2)
        self.assertEqual(len(self.seen), 1)

    def test_cancel_before_experiment_resumes_without_unknown_state(self):
        original = self.stages
        def cancelling_stages(request, config):
            stages = original(request, config)
            def admit(*args):
                (self.root/'run/cancel.request').write_text('cancel')
                return {'admitted': True}
            return iteration.IterationStages(admit, stages.build, stages.experiment, stages.diagnose, stages.repair)
        with patch.object(self, 'stages', side_effect=cancelling_stages):
            first = self.run_campaign()
        self.assertEqual(first['status'], 'cancelled')
        self.assertTrue(first['usage_complete'])
        self.assertEqual(first['usage']['model_calls'], 0)
        (self.root/'run/cancel.request').unlink()
        result = self.run_campaign(resume=True)
        self.assertEqual(result['usage']['model_calls'], 5)
        self.assertNotIn('initial_checkpoint', self.seen[1])

    def test_expired_deadline_never_spends_on_resume(self):
        self.cancel_at = 1
        self.run_campaign()
        (self.root/'run/cancel.request').unlink()
        path = self.root/'run/campaign.json'
        report = json.loads(path.read_text())
        report['deadline_utc'] = '2000-01-01T00:00:00+00:00'
        path.write_text(json.dumps(report))
        result = self.run_campaign(resume=True)
        self.assertEqual(result['reason'], 'campaign_wall_seconds_budget_exhausted')
        self.assertEqual(len(self.seen), 1)

    def test_changed_learning_bytes_fail_closed(self):
        self.cancel_at = 1
        self.run_campaign()
        (self.root/'run/cancel.request').unlink()
        (self.root/'learning').write_text('changed')
        result = self.run_campaign(resume=True)
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('checkpoint_mismatch', result['reason'])
        self.assertEqual(len(self.seen), 1)

    def test_invalid_unbounded_limit_rejected(self):
        self.config['limits']['chunks'] = float('inf')
        with self.assertRaises(campaign.CampaignError):
            self.run_campaign()

    def test_input_identity_change_rejected(self):
        self.run_campaign()
        self.config['limits']['model_calls'] += 1
        with self.assertRaisesRegex(campaign.CampaignError, 'identity_mismatch'):
            self.run_campaign(resume=True)

    def prefix(self):
        return iteration.run_iteration(self.request, self.template, self.root/'prefix',
                                       self.stages(self.request, self.template))

    def test_initial_prefix_counts_known_usage_and_preserves_exact_receipt(self):
        prefix = self.prefix()
        prefix_path = self.root/'prefix/iteration.json'
        original = prefix_path.read_bytes()
        self.config['initial_report_ref'] = file_ref(prefix_path)
        result = self.run_campaign()
        self.assertEqual(result['usage']['model_calls'], 5)
        self.assertEqual(result['usage']['native_frames'], 50)
        self.assertEqual(len(result['chunks']), 3)
        self.assertEqual(result['chunks'][0]['origin'], 'retained-prefix')
        self.assertEqual(result['chunks'][0]['report'], file_ref(prefix_path))
        self.assertEqual(result['retained_prefix_wall_seconds'], prefix['total_wall_seconds'])
        self.assertEqual(self.seen[1]['initial_checkpoint']['learning_context'], file_ref(self.root/'learning'))
        self.assertEqual(prefix_path.read_bytes(), original)
        self.assertEqual(self.run_campaign(resume=True)['usage'], result['usage'])

    def test_initial_prefix_bad_pin_blocks_before_execution(self):
        self.prefix()
        self.config['initial_report_ref'] = file_ref(self.root/'prefix/iteration.json')
        self.config['initial_report_ref']['sha256'] = '0'*64
        result = self.run_campaign()
        self.assertEqual(result['reason'], 'initial_report_pin_mismatch')
        self.assertEqual(len(self.seen), 1)

    def test_initial_prefix_input_identity_cannot_be_rewritten(self):
        self.prefix()
        prefix_path = self.root/'prefix/iteration.json'
        value = json.loads(prefix_path.read_text())
        value['config']['limits']['model_calls'] = 100
        prefix_path.write_text(json.dumps(value))
        self.config['initial_report_ref'] = file_ref(prefix_path)
        result = self.run_campaign()
        self.assertEqual(result['reason'], 'initial_report_identity_or_usage_unknown')
        self.assertEqual(len(self.seen), 1)

    def test_initial_prefix_consumes_wall_budget(self):
        self.prefix()
        prefix_path = self.root/'prefix/iteration.json'
        value = json.loads(prefix_path.read_text())
        value['total_wall_seconds'] = 31.
        prefix_path.write_text(json.dumps(value))
        self.config['initial_report_ref'] = file_ref(prefix_path)
        result = self.run_campaign()
        self.assertEqual(result['reason'], 'campaign_wall_seconds_budget_exhausted')
        self.assertEqual(result['usage']['model_calls'], 2)
        self.assertEqual(len(self.seen), 1)

    def test_successful_prefix_over_wall_cap_retains_fact_without_campaign_success(self):
        self.success_at = 1
        self.prefix()
        prefix_path = self.root/'prefix/iteration.json'
        value = json.loads(prefix_path.read_text())
        self.assertEqual(value['status'], 'success')
        value['total_wall_seconds'] = 31.
        prefix_path.write_text(json.dumps(value))
        self.config['initial_report_ref'] = file_ref(prefix_path)
        result = self.run_campaign()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['reason'], 'campaign_wall_seconds_budget_exhausted')
        self.assertEqual(result['qualification']['native_objective'], 'observed')
        self.assertEqual(result['objective_witness'], value['objective_witness'])
        self.assertEqual(len(self.seen), 1)

    def test_finite_cost_fails_before_native_or_provider(self):
        self.config['limits']['cost_usd'] = 1
        result = self.run_campaign()
        self.assertEqual(result['reason'], 'cost_budget_unverifiable')
        self.assertEqual(self.seen, [])


if __name__ == '__main__':
    unittest.main()
