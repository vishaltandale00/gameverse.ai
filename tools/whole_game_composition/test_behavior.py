"""Focused safety checks for semantic declarations, pins and native gates."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from .behavior import FACETS, SCHEMA, inspect_behavior, resolve_behavior, attach_native_feedback, normalize_behavior, place_behavior_overlay


class BehaviorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'source.c').write_text('void Grant(void) {}\n')
        self.pin = {'path': 'source.c', 'sha256': hashlib.sha256(
            (self.root / 'source.c').read_bytes()).hexdigest(),
            'start_line': 1, 'end_line': 1}
        self.node = {'id': 'grant', 'kind': 'behavior-system',
                     'contract': {'behavior': {'schema': SCHEMA, 'semantic': 'permanent-unlock',
                         **{f: [{'id': f, 'evidence': [self.pin]}] for f in FACETS},
                         'unknowns': []}}, 'provenance': {'source_pins': [self.pin]}}
        self.mapping = {'id': 'persist', 'kind': 'persistence',
                        'host': {'facet': 'state', 'id': 'state'},
                        'donor': {'facet': 'state', 'id': 'state'}, 'evidence': [self.pin]}
        recipe = {'schema': 'gameverse.behavior-adapter-recipe/1', 'modules': ['Grant'],
                  'phase': 'one-shot', 'source_evidence': [self.pin],
                  'state_lifecycle': {key: 'explicitly-retained' for key in
                      ('ownership', 'lifetime', 'reset', 'reentry', 'restore', 'save_effects')}}
        raw = json.dumps(recipe).encode()
        (self.root / 'recipe.json').write_bytes(raw)
        self.recipe = {'path': 'recipe.json', 'sha256': hashlib.sha256(raw).hexdigest()}

    def test_pinned_semantics_can_request_adapter_but_not_execution(self):
        result = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run', self.recipe)
        self.assertEqual(result['classification'], 'unknown')
        self.assertEqual(result['declaration_status'], 'source-pinned')
        self.assertFalse(result['executable'])
        self.assertFalse(result['whole_game_closure'])
        self.assertEqual(result['missing_contracts'], [])

    def test_unknowns_are_not_overridden_by_recipe(self):
        self.node['contract']['behavior']['unknowns'] = ['native-call-boundary']
        result = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run', self.recipe)
        self.assertEqual(result['classification'], 'unknown')
        self.assertTrue(any('native-call-boundary' in item for item in result['missing_contracts']))

    def test_stale_source_pin_rejects_and_cannot_use_feedback_flag(self):
        (self.root / 'source.c').write_text('changed\n')
        result = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run', self.recipe)
        self.assertEqual(result['classification'], 'incompatible')
        feedback = attach_native_feedback(result, {**self.pin, 'native_play_verified': True}, self.root)
        self.assertFalse(feedback['native_play_verified'])
        self.assertFalse(feedback['native_feedback']['receipt_pin_verified'])

    def test_mapping_must_reference_actual_semantic_record(self):
        self.mapping['donor']['id'] = 'invented'
        result = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run', self.recipe)
        self.assertEqual(result['classification'], 'incompatible')

    def test_missing_facets_and_recipe_remain_unknown(self):
        del self.node['contract']['behavior']['preconditions']
        result = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run')
        self.assertEqual(result['classification'], 'unknown')
        self.assertIn('adapter_recipe', result['missing_contracts'])

    def test_feedback_rejects_receipt_for_another_request(self):
        request = resolve_behavior(self.node, self.node, [self.mapping], self.root, 'run', self.recipe)
        raw = json.dumps({'request_sha256': 'f' * 64, 'native_play_verified': True}).encode()
        (self.root / 'native.json').write_bytes(raw)
        feedback = attach_native_feedback(request, {'path': 'native.json',
            'sha256': hashlib.sha256(raw).hexdigest()}, self.root)
        self.assertFalse(feedback['native_feedback']['receipt_pin_verified'])
        self.assertFalse(feedback['native_play_verified'])
        self.assertTrue(feedback['feedback_nodes'])

    def test_overlay_preserves_canonical_ownership_and_rejects_wrong_rom(self):
        from .test_core import partition
        from .core import import_game, validate_game
        original = partition()
        self.node['provenance']['rom_sha256'] = '0' * 64
        self.node['provenance']['native_entries'] = {'Grant': {'address': 0x08000110}}
        game = place_behavior_overlay(import_game(original), original, self.node)
        self.assertEqual(validate_game(game, original)['owned_bytes'], 512)
        self.assertEqual(game['nodes'][-1]['placement']['canonical_owner_count'], 1)
        self.assertFalse(game['claims']['whole_game_behavior_understood'])
        self.node['provenance']['rom_sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'ROM pin'):
            place_behavior_overlay(import_game(original), original, self.node)

    def test_normalization_does_not_invent_dependency_evidence(self):
        self.node['contract']['behavior']['dependencies'] = ['NativeService']
        normalized = normalize_behavior(self.node)
        record = normalized['contract']['behavior']['dependencies'][0]
        self.assertEqual(record['status'], 'unknown')
        self.assertEqual(record['evidence'], [])
        self.assertTrue(inspect_behavior(normalized, self.root)['missing_contracts'])

    def test_duplicate_mapping_ids_are_rejected(self):
        result = resolve_behavior(self.node, self.node, [self.mapping, self.mapping],
                                  self.root, 'run', self.recipe)
        self.assertEqual(result['classification'], 'incompatible')

    def test_evidence_cannot_escape_root(self):
        self.node['provenance']['source_pins'] = [{'path': '../outside', 'sha256': '0' * 64}]
        self.assertIn('evidence path escapes root', inspect_behavior(self.node, self.root)['contradictions'])


if __name__ == '__main__':
    unittest.main()
