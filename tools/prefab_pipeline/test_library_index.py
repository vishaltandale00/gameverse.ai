"""Focused discovery/admission regressions; no native, compiler, or UI work."""
import json
import unittest
from tools.prefab_pipeline import test_extraction as fixtures


class LibraryDiscoveryTests(unittest.TestCase):
    write = fixtures.ExtractionTests.write
    run_extract = fixtures.ExtractionTests.run_extract
    def setUp(self):
        fixtures.ExtractionTests.setUp(self)
        catalog = json.loads((self.root / 'ontology/executable-components/index.json').read_text())
        catalog['entries'][0].update(source_game='game', qualified=True)
        self.write('ontology/executable-components/index.json', catalog)

    def publish(self, **changes):
        proof = self.write('native-proof.json', {'outcome': 'pass', 'scope': 'direct original entry only'})
        record = {'schema': 'gameverse.ir-library-capability-proposal/1',
                  'id': 'native-capability.v1', 'game_id': 'game', 'module_id': 'same-owner',
                  'package_ids': ['a'], 'source_roots': ['08001234'],
                  'exactpins': {'native': {'path': 'native-proof.json', 'sha256': proof}},
                  'canonicalstate': {'owner': 'same original actor'},
                  'event_order': ['source event only'],
                  'originalhostprerequisites': ['original scheduler'],
                  'runtime_capabilities': {'actual_source_entry_replacement': True, 'whole_game': True},
                  'gaps': ['Original scheduler remains unqualified']}
        record.update(changes)
        pin = self.write('library/group-v1.json', record)
        self.write('ontology/ir-capability-groups/index.json', {
            'schema': 'gameverse.ir-capability-library/1',
            'entries': [{'id': record['id'], 'game_id': 'game', 'module_id': record['module_id'],
                         'record': {'path': 'library/group-v1.json', 'sha256': pin}}]})

    def test_catalog_without_ready_descriptor_is_discoverable(self):
        self.write('ontology/game-system-prefabs/manifest.json', {'prefabs': []})
        c = self.run_extract()['candidates'][0]
        self.assertEqual(c['package_ids'], ['a'])
        self.assertTrue(c['maturity']['L1_qualified'])
        self.assertFalse(c['maturity']['L2_binding_valid'])
        self.assertTrue(c['discovery']['catalog_fallback'])
        self.assertTrue(c['provides'][0]['finite_native_qualified'])
        self.assertFalse(c['maturity']['whole_game'])

    def test_library_joins_existing_owner_without_duplicate_package(self):
        self.publish()
        out = self.run_extract()
        self.assertEqual(len(out['candidates']), 2)
        c = next(c for c in out['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(c['package_ids'], ['a'])
        self.assertEqual(c['source_roots'], ['08001234'])
        self.assertEqual(c['host_prerequisites'], ['original scheduler'])
        self.assertTrue(c['runtime_capability_declarations'][0]['evidence_pins_valid'])
        self.assertFalse(c['maturity']['whole_game'])
        self.assertEqual(c['closure']['status'], 'open')

    def test_source_only_unknown_package_and_stale_evidence_stay_explicit(self):
        self.publish(module_id='unpublished', package_ids=['not-central'])
        self.write('native-proof.json', {'outcome': 'failed'})
        c = next(c for c in self.run_extract()['candidates'] if c['id'] == 'unpublished')
        self.assertFalse(c['maturity']['L1_qualified'])
        self.assertFalse(c['runtime_capability_declarations'][0]['evidence_pins_valid'])
        self.assertTrue(any('stale capability evidence' in g for g in c['gaps']))

    def test_missing_optional_index_then_published_invalidates_cache(self):
        before = self.run_extract()['games'][0]
        self.publish()
        after = self.run_extract()['games'][0]
        self.assertNotEqual(before['cache_key'], after['cache_key'])
        self.assertFalse(after['cache_hit'])

    def test_stale_group_identity_not_admitted(self):
        self.publish()
        self.write('library/group-v1.json', {'id': 'replacement'})
        out = self.run_extract()
        self.assertTrue(any('stale capability library record' in g for g in out['games'][0]['gaps']))
        self.assertFalse(any(c['library_capabilities'] for c in out['candidates']))

    def test_source_only_registered_owner_joins_library_without_fallback_copy(self):
        self.write('ontology/game-system-prefabs/manifest.json', {'prefabs': []})
        ref = 'registered.json'
        digest = self.write(ref, {'gameId': 'game', 'bundles': [
            {'id': 'older-source-only', 'moduleId': 'same-owner', 'packageIds': ['a'],
             'availability': 'source-only', 'canonicalState': {'identity': 'same actor'},
             'gaps': ['Original lifecycle open']}], 'coreLoop': {}})
        self.write('ontology/game-system-prefabs/deliveries.json', {
            'schema': 'gameverse.game-prefab-deliveries/1',
            'deliveries': [{'ref': ref, 'sha256': digest}]})
        self.publish()
        out = self.run_extract()
        self.assertEqual(len(out['candidates']), 1)
        c = out['candidates'][0]
        self.assertEqual(c['id'], 'same-owner')
        self.assertEqual(c['package_ids'], ['a'])
        self.assertEqual(c['descriptor_refs'], [ref])
        self.assertFalse(c['maturity']['L2_binding_valid'])
        self.assertEqual(len(c['bundles']), 2)

    def test_snakecase_dependency_links_preserve_private_dependency(self):
        self.publish(dependency_links=[{'id': 'private-clamp', 'central_package_present': False,
                                       'status': 'inlined-private-source'}])
        c = next(c for c in self.run_extract()['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(c['dependency_links'][0]['id'], 'private-clamp')
        self.assertFalse(c['dependency_links'][0]['central_package_present'])

    def test_structured_gap_flags_and_single_host_prerequisite(self):
        self.publish(gaps={'whole_game_ready': False, 'reason': 'scheduler missing'},
                     originalhostprerequisites='Exact host with source scheduling')
        c = next(c for c in self.run_extract()['candidates'] if c['id'] == 'same-owner')
        self.assertEqual(c['host_prerequisites'], ['Exact host with source scheduling'])
        self.assertIn('whole_game_ready: false', c['gaps'])
        self.assertEqual(c['library_capabilities'][0]['record']['gaps']['whole_game_ready'], False)
        self.assertFalse(c['maturity']['whole_game'])

    def test_reference_only_source_contract_remains_uninterpreted(self):
        package = json.loads((self.root / 'pkg/package.json').read_text())
        package['source_contract'] = 'source/system.json'
        self.write('source/system.json', {'sourceOnly': True, 'domains': {'unscored': True}})
        package_hash = self.write('pkg/package.json', package)
        record = json.loads((self.root / 'ontology/executable-components/a.json').read_text())
        record['package_sha256'] = package_hash
        self.write('ontology/executable-components/a.json', record)
        c = next(c for c in self.run_extract()['candidates'] if c['id'] == 'same-owner')
        interface = c['packages'][0]['interface']
        self.assertEqual(interface['source_contract']['reference'], 'source/system.json')
        self.assertEqual(interface['domains'], {})
        self.assertTrue(c['maturity']['L1_qualified'])
        self.assertFalse(c['maturity']['whole_game'])

    def test_unsupported_gap_type_fails_closed(self):
        self.publish(gaps=True)
        with self.assertRaises(ValueError):
            self.run_extract()
