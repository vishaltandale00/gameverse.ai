"""Lean provenance rejection and coverage regression fixtures; no emulator/model."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from .reconstruction_gaps import compare, pin


class ReconstructionFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = Path(self.tmp.name) / 'evidence.json'
        p.write_text(json.dumps({'fixture': 'unit evidence, not runtime proof'}))
        self.ref = pin(p)
        self.trace = dict(schema='gameverse.reconstruction-trace/1', run_id='original', game_id='fixture',
            source_commit='pinned', loop_version='pinned', adapter_version='native/1', environment_version='mgba/pinned',
            setup={'kind': 'source_controlled_fixture', 'boundary': 'before grant', 'provenance': self.ref,
                   'render_integration_frames': 1},
            observations=[{'frame': 1, 'facts': {'event': 0}}, {'frame': 3, 'facts': {'event': 1}}])
        for key in ('artifact', 'checkpoint', 'observation_profile', 'action_profile', 'raw_events', 'raw_diff', 'closure', 'recipe', 'inputs'):
            self.trace[key] = self.ref
        self.scope = {'event': {'components': ['acquire', 'events'], 'dependency_kinds': ['state', 'scheduler'], 'source_refs': [self.ref]}}

    def test_matching_is_explicitly_bounded(self):
        result = compare(self.trace, copy.deepcopy(self.trace), self.scope)
        self.assertEqual(result['outcome'], 'bounded_observations_match')
        self.assertFalse(result['whole_game_parity'])

    def test_divergence_links_source_without_inventing_cause(self):
        candidate = copy.deepcopy(self.trace)
        candidate['observations'][1]['facts']['event'] = 0
        gap = compare(self.trace, candidate, self.scope)['gaps'][0]
        self.assertEqual((gap['frame'], gap['original'], gap['candidate']), (3, 1, 0))
        self.assertEqual(gap['source_link']['components'], ['acquire', 'events'])
        self.assertEqual(gap['status'], 'needs_source_owner_diagnosis')

    def test_receipt_survives_later_caller_mutation(self):
        candidate = copy.deepcopy(self.trace)
        result = compare(self.trace, candidate, self.scope)
        candidate['observations'][0]['facts']['event'] = 9
        self.scope['event']['components'].append('later')
        self.assertEqual(result['candidate']['observations'][0]['facts']['event'], 0)
        self.assertEqual(result['scope']['event']['components'], ['acquire', 'events'])

    def test_missing_both_sides_is_coverage_gap(self):
        self.scope['unobserved_parent'] = copy.deepcopy(self.scope['event'])
        result = compare(self.trace, self.trace, self.scope)
        self.assertEqual(result['gaps'][0]['missing_in'], ['original', 'candidate'])
        self.assertEqual(result['outcome'], 'source_review_required')

    def test_different_inputs_and_frames_fail_before_comparison(self):
        candidate = copy.deepcopy(self.trace)
        candidate['setup']['boundary'] = 'after grant'
        with self.assertRaisesRegex(ValueError, 'unmatched_trace_provenance:setup'):
            compare(self.trace, candidate, self.scope)
        candidate = copy.deepcopy(self.trace)
        candidate['observations'][1]['frame'] = 4
        with self.assertRaisesRegex(ValueError, 'unmatched_observation_schedule'):
            compare(self.trace, candidate, self.scope)

    def test_mutated_evidence_is_rejected(self):
        Path(self.ref['path']).write_text('changed after pinning')
        with self.assertRaisesRegex(ValueError, 'evidence_pin_mismatch'):
            compare(self.trace, self.trace, self.scope)


if __name__ == '__main__':
    unittest.main()
