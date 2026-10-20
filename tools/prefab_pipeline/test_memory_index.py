"""Authored ROM fixture verifies real extraction -> request -> compiler -> discovery."""
import copy
from tools.prefab_pipeline import test_extraction as fixtures
from tools.prefab_pipeline.memory_index import query_memory, property_plan
from tools.prefab_pipeline.contract import validate_capsule
from tools.roundtrip.memory_ontology import SCHEMA, sha, compile_edit


class MemoryDiscoveryTests(__import__("unittest").TestCase):
    write = fixtures.ExtractionTests.write
    run_extract = fixtures.ExtractionTests.run_extract
    def setUp(self):
        fixtures.ExtractionTests.setUp(self)
        self.rom = bytes(256) + bytes([3, 0]) + bytes(254)
        self.manifest = {'schema': SCHEMA, 'game_id': 'game', 'source_revision': 'fixture-v1',
            'rom': {'sha256': sha(self.rom), 'size': len(self.rom)},
            'allocations': [{'id': 'partition:table', 'kind': 'data', 'rom_offset': 256, 'size': 2,
                             'package_ids': ['a'], 'source': {'symbol': 'FixtureTable'}}],
            'tables': [{'id': 'fixture-table', 'symbol': 'FixtureTable', 'allocation_id': 'partition:table', 'rom_offset': 256,
                        'stride': 1, 'capacity': 2, 'rows': [{'value': 3}],
                        'fields': [{'name': 'value', 'type': 'u8', 'offset': 0}],
                        'expansion': {'status': 'closed', 'reference_closure': 'complete',
                                      'fixed_consumer_capacity': 2, 'closure_evidence': {'fixture': 'bounded authored consumer'}}}],
            'edges': [{'source': 'consumer', 'target': 'partition:table', 'kind': 'reads', 'confidence': 'source-exact'}]}
        self.write('memory.json', self.manifest)

    def run_memory(self):
        return self.run_extract(memory_manifests=['memory.json'])

    def test_updated_compiler_manifest_changes_actual_discovery(self):
        first = self.run_memory()
        candidate = next(c for c in first['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(candidate['editable_properties'][0]['row_count'], 1)
        self.assertEqual(candidate['memory_graphs'][0]['allocation_ids'], ['partition:table'])
        self.assertEqual(validate_capsule(candidate, self.root), [])
        recipe = property_plan(first, 'fixture-table', [{'op': 'append', 'table': 'fixture-table', 'row': {'value': 7}}])
        rebuilt = compile_edit(self.manifest, self.rom, recipe['request'])
        self.write('memory.json', rebuilt['manifest'])
        second = self.run_memory()
        changed = next(c for c in second['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(changed['editable_properties'][0]['row_count'], 2)
        self.assertEqual(changed['editable_properties'][0]['captured_rows'][1]['value'], 7)
        self.assertNotEqual(first['games'][0]['cache_key'], second['games'][0]['cache_key'])
        self.assertEqual(candidate['maturity'], changed['maturity'])
        followup = property_plan(second, 'fixture-table', [{'op': 'set', 'table': 'fixture-table', 'index': 1, 'field': 'value', 'value': 9}])
        again = compile_edit(rebuilt['manifest'], rebuilt['rom'], followup['request'])
        self.assertEqual(again['rom'][257], 9)
        self.assertFalse(changed['maturity']['whole_game'])

    def test_unknowns_and_declared_dependents_remain_visible(self):
        extraction = self.run_memory()
        query = query_memory(extraction, node='partition:table')['results'][0]
        self.assertEqual(query['dependent_ids'], ['consumer', 'fixture-table'])
        self.assertGreater(query_memory(extraction, uncategorized=True)['results'][0]['coverage']['unclassified_gap_bytes'], 0)
        self.assertEqual(len(extraction['candidates']), 2)

    def test_blocked_append_is_discoverable_but_compiler_rejects(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['tables'][0]['expansion'] = {'status': 'blocked', 'reason': 'unknown count consumer'}
        self.write('memory.json', manifest)
        extraction = self.run_memory()
        c = next(c for c in extraction['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(c['editable_properties'][0]['unsupported_closure_reasons'], ['unknown count consumer'])
        recipe = property_plan(extraction, 'fixture-table', [{'op': 'append', 'table': 'fixture-table', 'row': {'value': 7}}])
        with self.assertRaisesRegex(ValueError, 'unknown count consumer'):
            compile_edit(manifest, self.rom, recipe['request'])

    def test_unmatched_explicit_family_is_source_only_and_multitable_recipe_is_pinned(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['module_id'] = 'source.asset-family'
        manifest['allocations'][0].pop('package_ids')
        manifest['allocations'].append({'id': 'another', 'kind': 'data', 'rom_offset': 258, 'size': 1})
        table = copy.deepcopy(manifest['tables'][0])
        table.update(id='second-table', allocation_id='another', rom_offset=258, capacity=1, rows=[{'value': 0}], symbol='OtherTable')
        manifest['tables'].append(table)
        self.write('memory.json', manifest)
        extraction = self.run_memory()
        derived = next(c for c in extraction['candidates'] if c['id'] == 'source.asset-family')
        self.assertEqual(derived['level'], 'L0')
        self.assertFalse(derived['maturity']['L1_qualified'])
        self.assertEqual(len(derived['editable_properties']), 2)
        operations = [{'op': 'set', 'table': 'fixture-table', 'index': 0, 'field': 'value', 'value': 4},
                      {'op': 'set', 'table': 'second-table', 'index': 0, 'field': 'value', 'value': 1}]
        recipe = property_plan(extraction, 'fixture-table', operations)
        self.assertEqual(recipe['affected_table_ids'], ['fixture-table', 'second-table'])
        output = compile_edit(manifest, self.rom, recipe['request'])
        self.assertEqual(output['rom'][256], 4)
        self.assertEqual(output['rom'][258], 1)

    def test_indexed_manifest_is_consumed_and_stale_pin_fails_closed(self):
        import hashlib
        pin = hashlib.sha256((self.root / 'memory.json').read_bytes()).hexdigest()
        self.write('producer.json', {'memory_manifest_refs': [{'path': 'memory.json', 'sha256': pin}]})
        extracted = self.run_extract(memory_indexes=['producer.json'])
        self.assertEqual(len(extracted['games'][0]['memory_graphs']), 1)
        self.assertIn('producer.json', [p['path'] for p in extracted['games'][0]['input_pins']])
        self.write('memory.json', {**self.manifest, 'source_revision': 'changed'})
        stale = self.run_extract(memory_indexes=['producer.json'])
        self.assertEqual(stale['games'][0]['memory_graphs'], [])
        self.assertTrue(any('Stale or missing indexed memory manifest' in gap for gap in stale['games'][0]['gaps']))
        self.assertNotEqual(extracted['games'][0]['cache_key'], stale['games'][0]['cache_key'])

    def test_index_paths_share_extraction_limits_and_containment(self):
        from tools.prefab_pipeline.extraction import ExtractionLimitError
        self.write('producer.json', {'memory_manifest_refs': [{'path': '../external.json', 'sha256': '0' * 64}]})
        result = self.run_extract(memory_indexes=['producer.json'])
        self.assertTrue(any('Refused unsafe reference' in gap for gap in result['games'][0]['gaps']))
        self.write('producer.json', {'memory_manifest_refs': []})
        with self.assertRaises(ExtractionLimitError):
            self.run_extract(memory_indexes=['producer.json'], limits={'max_files': 1})


    def test_index_roles_pin_continuations_without_duplicate_discovery(self):
        import hashlib
        self.write('continuation.json', self.manifest)
        entries = [{'path': path, 'sha256': hashlib.sha256((self.root/path).read_bytes()).hexdigest(), 'role': role}
                   for path, role in [('memory.json', 'baseline'), ('continuation.json', 'append')]]
        self.write('producer.json', {'memory_manifest_refs': entries})
        result = self.run_extract(memory_indexes=['producer.json'])
        self.assertEqual(len(result['games'][0]['memory_graphs']), 1)
        self.assertIn('continuation.json', [p['path'] for p in result['games'][0]['input_pins']])
