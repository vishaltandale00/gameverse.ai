"""Public synthetic contracts; no native ROM payloads required."""
import copy
import unittest
from .core import (SCHEMA, REQUEST_SCHEMA, canonical_hash, import_game,
                   validate_game, plan_substitution, compile_request, subtree_boundary)


def partition():
    return {'schema': 'gameverse.rom-roundtrip/1', 'game_id': 'synthetic',
            'original': {'sha256': '0' * 64, 'size': 512},
            'components': [{'id': name, 'offset': offset, 'size': 256, 'sha256': str(i) * 64,
                'stratum': 'opaque-preserved', 'dependencies': [], 'contract': {}}
                for i, (name, offset) in enumerate((('a', 0), ('b', 256)), 1)]}


def table():
    return {'id': 'table:t', 'kind': 'asset-table', 'provenance': {'memory_manifest_sha256': '3' * 64},
            'contract': {'scope': 'typed-data-layout', 'format': 'typed-table/1', 'endian': 'little',
                'pointer_width': 32, 'stride': 2, 'count': 2, 'capacity': 2,
                'fields': [{'name': 'value', 'offset': 0, 'type': 'u16'}],
                'bindings': [{'role': 'pointer'}], 'graphics': [],
                'expansion': {'status': 'closed', 'reference_closure': 'complete',
                    'closure_evidence': ['synthetic captured consumer'], 'fixed_consumer_capacity': 4}}}


def behavior():
    return {'id': 'behavior', 'provenance': {'sha256': '4' * 64},
            'contract': {'scope': 'native-component', 'isa': 'thumb', 'abi': 'synthetic',
                'effects': {'status': 'closed', 'evidence': ['synthetic'],
                    'phase': 'vblank', 'lifetime': 'frame', 'state_ownership': 'engine',
                    'save_schema': 'none', 'requires': [], 'provides': [], 'calls': [],
                    'reads': [], 'writes': []}}}


class CompositionTests(unittest.TestCase):
    def test_full_ownership_not_semantics(self):
        p = partition(); game = import_game(p); audit = validate_game(game, p)
        self.assertEqual(audit['owned_bytes'], 512)
        self.assertFalse(game['claims']['whole_game_behavior_understood'])
        self.assertEqual(audit['semantic_closure'], 'unknown')
        self.assertEqual(audit['effect_unknown_node_count'], 3)
        self.assertNotIn('offset', game['nodes'][1])

    def test_gap_overlap_and_stale_pins(self):
        for offset in (255, 257):
            p = partition(); p['components'][1]['offset'] = offset
            with self.assertRaises(ValueError): import_game(p)
        p = partition(); game = import_game(p); p['components'][0]['sha256'] = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'stale'): validate_game(game, p)

    def test_duplicate_owner_and_missing_crossedge(self):
        p = partition(); game = import_game(p)
        game['nodes'][2]['component_ref'] = 'a'
        with self.assertRaises(ValueError): validate_game(game, p)
        game = import_game(p); game['edges'] = [{'source': 'component:a', 'target': 'absent', 'kind': 'calls'}]
        with self.assertRaises(ValueError): validate_game(game, p)

    def test_call_cycles_allowed_phase_cycles_rejected(self):
        p = partition(); game = import_game(p)
        game['edges'] = [{'source': 'component:a', 'target': 'component:b', 'kind': 'calls'},
                         {'source': 'component:b', 'target': 'component:a', 'kind': 'calls'}]
        validate_game(game, p)
        for edge in game['edges']: edge['kind'] = 'before'
        with self.assertRaisesRegex(ValueError, 'phase order cycle'): validate_game(game, p)

    def test_subtree_keeps_external_edges(self):
        game = import_game(partition())
        game['edges'] = [{'source': 'component:a', 'target': 'component:b', 'kind': 'references'}]
        boundary = subtree_boundary(game, 'component:a')
        self.assertEqual(boundary['crossing_edges'], game['edges'])
        self.assertEqual(boundary['ownership_refs'], ['a'])

    def test_static_equivalence_is_not_execution(self):
        plan = plan_substitution(table(), table())
        self.assertEqual(plan['classification'], 'interchangeable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['semantic_equivalence_verified'])

    def test_growth_plan_and_fixed_capacity(self):
        host = table(); candidate = table(); candidate['contract'].update(count=4, capacity=4)
        plan = plan_substitution(host, candidate)
        self.assertEqual(plan['classification'], 'adaptable')
        self.assertEqual(len(plan['required_adapters']), 1)
        candidate['contract'].update(count=5, capacity=5)
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'incompatible')
        host['contract']['expansion']['reference_closure'] = 'unknown'
        candidate['contract'].update(count=4, capacity=4)
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'unknown')

    def test_shape_differences_prune(self):
        for key, value in [('endian', 'big'), ('stride', 4), ('pointer_width', 64)]:
            candidate = table(); candidate['contract'][key] = value
            self.assertTrue(plan_substitution(table(), candidate)['prune'])

    def test_graphics_and_dma_prune(self):
        host = table(); candidate = table()
        host['contract']['graphics'] = [{'kind': 'gba-tile-transfer/1', 'bpp': 4, 'region': 'bg', 'destination_offset': 0, 'copy_bytes': 32}]
        candidate['contract']['graphics'] = copy.deepcopy(host['contract']['graphics'])
        candidate['contract']['graphics'][0]['bpp'] = 8
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'incompatible')
        candidate['contract']['graphics'][0]['dma'] = [{'bits': 16, 'source': 0, 'destination': 0, 'bytes': 0}]
        self.assertIn('candidate: DMA width/alignment/count invalid', plan_substitution(host, candidate)['contradictions'])

    def test_unknown_effects_do_not_become_negative_facts(self):
        host = behavior(); candidate = behavior()
        host['contract']['effects']['status'] = 'unknown'
        candidate['contract']['effects']['writes'] = [{'space': 'ewram', 'start': 0, 'size': 4, 'width': 32}]
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'unknown')
        host['contract']['effects']['status'] = 'closed'
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'incompatible')
        host = behavior(); candidate = behavior()
        host['contract']['effects']['provides'] = ['done']
        candidate['contract']['effects']['status'] = 'unknown'
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'unknown')

    def test_phase_abi_save_constraints(self):
        for key, value in [('phase', 'main'), ('save_schema', 'new-save'), ('state_ownership', 'foreign')]:
            host = behavior(); candidate = behavior(); candidate['contract']['effects'][key] = value
            self.assertEqual(plan_substitution(host, candidate)['classification'], 'incompatible')

    def test_request_bound_and_subtree_unknown(self):
        p = partition(); game = import_game(p)
        request = {'schema': REQUEST_SCHEMA, 'game_sha256': canonical_hash(game),
                   'substitutions': [{'target': 'game', 'candidate': copy.deepcopy(game['nodes'][0])}]}
        self.assertEqual(compile_request(game, p, request)['classification'], 'unknown')
        request['max_candidates'] = 0
        with self.assertRaises(ValueError): compile_request(game, p, request)

    def test_alias_same_lifetime_is_unknown_not_concurrent(self):
        p = partition(); game = import_game(p)
        for node in game['nodes'][1:]:
            node['contract'] = behavior()['contract']
            node['contract']['effects']['writes'] = [{'space': 'ewram', 'start': 0, 'size': 4}]
        request = {'schema': REQUEST_SCHEMA, 'game_sha256': canonical_hash(game), 'substitutions':
            [{'target': n['id'], 'candidate': copy.deepcopy(n)} for n in game['nodes'][1:]]}
        plan = compile_request(game, p, request)
        self.assertEqual(plan['classification'], 'unknown')
        self.assertFalse(plan['contradictions'])

    def test_access_constraints_route_into_pruning(self):
        from .effects import summarize_effects
        host = table(); candidate = table()
        host['contract']['access_requirements'] = {'objects': [{'name': 'x', 'width_bytes': 4}]}
        candidate['contract']['access_summary'] = summarize_effects({'schema': 'gameverse.l1.behavior/0.2',
            'state': [{'name': 'x', 'storage_type': 'u16'}], 'body': [{'op': 'field', 'name': 'x'}]})
        self.assertEqual(plan_substitution(host, candidate)['classification'], 'incompatible')


if __name__ == '__main__': unittest.main()
