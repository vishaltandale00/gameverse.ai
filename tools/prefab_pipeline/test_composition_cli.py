"""Bounded public caller checks; no native builds, models or remote execution."""
import copy
import json
from pathlib import Path
from tools.prefab_pipeline import test_memory_index as fixtures
from tools.prefab_pipeline.composition_cli import import_extraction, canonical_hash, query_composition, plan_composition_request
from tools.prefab_pipeline.__main__ import main


class CompositionCallerTests(__import__("unittest").TestCase):
    write = fixtures.MemoryDiscoveryTests.write
    run_extract = fixtures.MemoryDiscoveryTests.run_extract
    run_memory = fixtures.MemoryDiscoveryTests.run_memory
    def setUp(self):
        fixtures.MemoryDiscoveryTests.setUp(self)
        self.partition = {'schema': 'gameverse.rom-roundtrip/1', 'game_id': 'game',
                          'original': self.manifest['rom'],
                          'components': [{'id': 'canonical-owner', 'offset': 0, 'size': len(self.rom),
                                          'sha256': self.manifest['rom']['sha256'], 'stratum': 'opaque-preserved'}]}
        self.write('partition.json', self.partition)
        self.extraction = self.run_memory()
        self.document = import_extraction(self.extraction, self.partition, 'game', self.root, {'path': 'partition.json'})
        self.game = self.document['game']

    def test_registry_and_unknown_ownership_survive_import(self):
        self.assertEqual(self.document['audit']['owned_bytes'], len(self.rom))
        self.assertFalse(self.document['audit']['native_play_verified'])
        registry = next(r for r in self.game['dependency_registry'] if r['candidate_id'] == 'same-owner')
        self.assertEqual(registry['package_ids'], ['a'])
        self.assertEqual(registry['memory_joins'][0]['table_ids'], ['fixture-table'])
        query = query_composition(self.game, node='table:fixture-table', candidates=self.game)
        self.assertEqual(query['compatibility'][0]['plan']['classification'], 'interchangeable')
        self.assertFalse(query['execution_allowed'])

    def test_actual_cli_static_reject_and_stale_request(self):
        candidate = copy.deepcopy(next(n for n in self.game['nodes'] if n['kind'] == 'asset-table'))
        candidate['provenance'].pop('memory_ref', None)
        candidate['contract']['stride'] = 0
        request = {'schema': 'gameverse.composition-request/1', 'game_sha256': canonical_hash(self.game),
                   'substitutions': [{'target': candidate['id'], 'candidate': candidate}]}
        self.write('game.json', self.document)
        self.write('request.json', request)
        output = self.root / 'plan.json'
        code = main(['composition-plan', '--game-dsl', str(self.root/'game.json'),
                     '--partition', str(self.root/'partition.json'), '--root', str(self.root), '--request', str(self.root/'request.json'),
                     '--output', str(output)])
        self.assertEqual(code, 2)
        result = json.loads(output.read_text())
        self.assertEqual(result['classification'], 'incompatible')
        self.assertFalse(result['execution_allowed'])
        self.assertGreaterEqual(result['pipeline_timing']['static_analysis_wall_s'], 0)
        request['game_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'stale'):
            plan_composition_request(self.game, self.partition, request)

    def test_stale_discovery_pin_rejected_before_import(self):
        self.write('memory.json', {**self.manifest, 'source_revision': 'changed'})
        with self.assertRaisesRegex(ValueError, 'stale extraction'):
            import_extraction(self.extraction, self.partition, 'game', self.root, {'path': 'partition.json'})


    def test_candidate_file_pin_and_parent_lineage_are_admission_inputs(self):
        from tools.prefab_pipeline.composition_cli import memory_candidate_document
        from tools.roundtrip.memory_ontology import canonical, sha
        evolved = copy.deepcopy(self.manifest)
        evolved['parent_manifest_sha256'] = sha(canonical(self.manifest))
        self.write('candidate.json', evolved)
        candidate = memory_candidate_document(self.root/'candidate.json', 'fixture-table')['nodes'][0]
        request = {'schema': 'gameverse.composition-request/1', 'game_sha256': canonical_hash(self.game),
                   'substitutions': [{'target': candidate['id'], 'candidate': candidate}]}
        self.assertEqual(plan_composition_request(self.game, self.partition, request, self.root)['status'], 'planned')
        candidate['contract']['count'] = 0
        with self.assertRaisesRegex(ValueError, 'contract disagrees'):
            plan_composition_request(self.game, self.partition, request, self.root)
        candidate['contract']['count'] = 1
        candidate['provenance']['parent_manifest_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'provenance disagrees'):
            plan_composition_request(self.game, self.partition, request, self.root)
        candidate['provenance']['parent_manifest_sha256'] = evolved['parent_manifest_sha256']
        self.write('candidate.json', {**evolved, 'source_revision': 'changed'})
        with self.assertRaisesRegex(ValueError, 'stale candidate'):
            plan_composition_request(self.game, self.partition, request, self.root)
