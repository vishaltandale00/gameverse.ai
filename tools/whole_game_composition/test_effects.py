"""Small static checks; no native compiler, model or game execution."""
import copy
import json
from pathlib import Path
import unittest
from tools.whole_game_composition.effects import summarize_effects, compare_effect_constraints, query_effects

ROOT = Path(__file__).resolve().parents[2]


def fixture(name):
    root = ROOT / 'local/ir/packages' / name
    if not (root / 'l1.json').exists():
        raise unittest.SkipTest('Private local IR fixture unavailable: ' + name)
    return (json.loads((root / 'l1.json').read_text()),
            json.loads((root / 'validation-adapter.json').read_text()))


class EffectsTests(unittest.TestCase):
    def test_actual_event_bank_stride_and_dynamic_index(self):
        ir, adapter = fixture('mzm.progress.events')
        s = summarize_effects(ir, adapter)
        obj = s['objects'][0]
        self.assertEqual((obj['space'], obj['width_bytes'], obj['element_stride_bytes'], obj['capacity']), ('EWRAM', 4, 4, 8))
        self.assertGreater(obj['writes'], 0)
        self.assertIn('dynamic_indices_not_range_proven', s['unknowns'])
        for requirement in [{'element_stride_bytes': 8}, {'space': 'IO'}, {'access': 'read_only'}]:
            self.assertEqual(compare_effect_constraints(s, {'objects': [{'name': obj['name'], **requirement}]})['status'], 'contradicted')
        self.assertEqual(compare_effect_constraints(s, {'objects': [{'name': obj['name'], 'index': 'constant'}]})['status'], 'unknown')

    def test_actual_firered_argument_relative_not_concrete(self):
        ir, adapter = fixture('firered.text.timed_acknowledgement')
        s = summarize_effects(ir, adapter)
        objs = {o['name']: o for o in s['objects']}
        self.assertIsNone(objs['field_0']['address_range'])
        self.assertEqual(objs['field_0']['relative_offset'], 22)
        self.assertEqual(objs['field_1']['space'], 'EWRAM')
        self.assertEqual(s['compatibility'], 'unproven')

    def test_actual_table_candidate_and_query(self):
        ir, adapter = fixture('crash.input.direction_lookup')
        s = summarize_effects(ir, adapter)
        self.assertEqual(len(query_effects([s], pattern='bounded_table_lookup')), 1)
        self.assertFalse(any(o['writes'] for o in s['objects']))
        asset = next(o for o in s['objects'] if o['kind'] == 'asset')
        self.assertEqual(asset['capacity'], 16)
        self.assertEqual(compare_effect_constraints(s, {'objects': [{'name': asset['name'], 'access': 'write_required'}]})['status'], 'contradicted')

    def test_native_and_budget_preserve_unknown(self):
        ir, _ = fixture('aria.motion.integrate_x')
        ir = copy.deepcopy(ir)
        ir['body'].append({'op': 'retained_native_service', 'service': 'opaque'})
        s = summarize_effects(ir)
        self.assertFalse(s['complete_access_scan'])
        self.assertIn('external_or_native_effects_unknown', s['unknowns'])
        s = summarize_effects(ir, max_nodes=2)
        self.assertIn('node_budget_exhausted', s['unknowns'])

    def test_unresolved_ssa_and_register_not_addresses(self):
        s = summarize_effects({'id': 'opaque', 'body': [{'op': 'LOAD', 'inputs': ['v1', 'v2']}]})
        self.assertEqual(s['objects'], [])
        self.assertFalse(s['complete_access_scan'])
        self.assertEqual(s['pointer_chasing'], 'unknown_no_pointer_dataflow_analysis')

    def test_hardware_destination_is_shape_only(self):
        ir = {'id': 'pal', 'state': [{'name': 'p', 'storage_type': 'u16'}], 'body': [{'op': 'assign_field', 'field': 'p', 'value': {'op': 'const', 'value': 1}}]}
        s = summarize_effects(ir, {'fields': [{'name': 'p', 'address': 0x05000000}]})
        self.assertEqual(s['patterns'][1]['pattern'], 'palette_upload')
        self.assertEqual(s['patterns'][1]['semantic_equivalence'], 'unproven')



class BehaviorOverlayTests(unittest.TestCase):
    def setUp(self):
        self.game = {'schema': 'gameverse.whole-game-composition/1', 'nodes': [
            {'id': 'game', 'parent': None, 'kind': 'game'},
            {'id': 'component:native', 'parent': 'game', 'kind': 'component', 'component_ref': 'native'}],
            'edges': [], 'claims': {'whole_game_behavior_understood': False}}
        self.ir = {'schema': 'gameverse.l1.behavior/0.2', 'id': 'generic_ir_id', 'body': []}
        self.provenance = {'package_id': 'actual.package', 'source_game': 'source',
                           'behavior_ref': {'path': 'private/l1.json', 'sha256': 'a' * 64},
                           'package_ref': {'path': 'private/package.json', 'sha256': 'b' * 64}}

    def test_pins_identity_unplaced_and_input_unchanged(self):
        from tools.whole_game_composition.effects import import_behavior_overlay
        result = import_behavior_overlay(self.game, self.ir, provenance=self.provenance)
        node = result['nodes'][-1]
        self.assertEqual(node['id'], 'behavior:actual.package')
        self.assertEqual(node['contract']['effects']['status'], 'unknown')
        self.assertEqual(node['provenance']['native_component_mapping'], 'unplaced_unknown')
        self.assertEqual(len(node['provenance']['parsed_behavior_canonical_sha256']), 64)
        self.assertEqual(result['claims'], self.game['claims'])
        self.assertEqual(len(self.game['nodes']), 2)
        self.assertEqual(result['edges'], [])
        with self.assertRaises(ValueError): import_behavior_overlay(result, self.ir, provenance=self.provenance)

    def test_missing_pin_adapter_pin_and_join_evidence(self):
        from tools.whole_game_composition.effects import import_behavior_overlay
        for provenance in [None, {}, {**self.provenance, 'behavior_ref': {'path': 'x'}}]:
            with self.assertRaises(ValueError): import_behavior_overlay(self.game, self.ir, provenance=provenance)
        with self.assertRaises(ValueError): import_behavior_overlay(self.game, self.ir, bindings={}, provenance=self.provenance)
        with self.assertRaises(ValueError): import_behavior_overlay(self.game, self.ir, provenance=self.provenance, component_ids=['absent'])
        with self.assertRaises(ValueError): import_behavior_overlay(self.game, self.ir, provenance=self.provenance, component_ids=['native'])
        provenance = {**self.provenance, 'component_mapping_evidence': [{'path': 'source-owner-join.json', 'sha256': 'c' * 64}]}
        result = import_behavior_overlay(self.game, self.ir, provenance=provenance, component_ids=['native'])
        self.assertEqual(result['edges'][0]['target'], 'component:native')

    def test_unsupported_representation_remains_unknown(self):
        from tools.whole_game_composition.effects import import_behavior_overlay
        node = import_behavior_overlay(self.game, {'id': 'opaque'}, provenance=self.provenance)['nodes'][-1]
        self.assertFalse(node['contract']['access_summary']['complete_access_scan'])
        self.assertEqual(node['contract']['effects']['status'], 'unknown')


if __name__ == '__main__': unittest.main()
