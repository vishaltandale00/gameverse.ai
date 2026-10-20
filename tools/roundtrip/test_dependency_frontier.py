"""Cheap contract checks; no compiler, emulator, model or cartridge reads."""
import json
from pathlib import Path
import tempfile
import unittest
from .dependency_frontier import digest, mine, validate_profile_frontier


class FrontierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'leaf').mkdir()
        self.write('leaf/l0.json', {'entry': '08000100', 'varnodes': [], 'blocks': [
            {'ops': [{'opcode': 'CALLIND', 'pc': '08000102', 'inputs': ['dynamic']}]}]})
        self.write('leaf/l1.json', {'limitations': ['bounded only']})
        self.write('prefab-graph.json', {'schema': 'gameverse.ir-prefab-graph/1', 'id': 'fixture',
            'components': [{'id': 'leaf', 'original_entry': '08000100',
                            'portable_ir': {'path':'leaf/l1.json', 'sha256': digest(self.root/'leaf/l1.json')}}],
            'dependencies': [], 'unknowns': ['scheduler']})
        self.write('manifest.json', {'original': {'sha256': 'rom-A'}, 'components': []})
        self.write('provider-report.json', {'original_sha256': 'rom-A', 'rebuilt_sha256': 'rebuilt',
            'modules': {'leaf': {'l0_sha256': digest(self.root/'leaf/l0.json'),
                                'l1_sha256': digest(self.root/'leaf/l1.json'), 'adapter': {}}}})

    def write(self, name, value):
        (self.root/name).write_text(json.dumps(value))

    def alter(self, name, fn):
        value = json.loads((self.root/name).read_text())
        fn(value)
        self.write(name, value)

    def run_miner(self, **kwargs):
        return mine(self.root/'provider-report.json', **kwargs)

    def test_version_mismatch_rejected(self):
        self.alter('manifest.json', lambda x: x['original'].update(sha256='rom-B'))
        with self.assertRaisesRegex(ValueError, 'ROM version mismatch'):
            self.run_miner()

    def test_dangling_dependency_rejected(self):
        self.alter('prefab-graph.json', lambda x: x.update(dependencies=[{'from':'leaf', 'to':'missing'}]))
        with self.assertRaisesRegex(ValueError, 'Dangling'):
            self.run_miner()

    def test_ir_tamper_rejected(self):
        self.write('leaf/l1.json', {'altered': True})
        with self.assertRaisesRegex(ValueError, 'IR version mismatch'):
            self.run_miner()

    def test_observation_does_not_close_indirect_static_gap(self):
        self.write('bot.json', {'calls_seen': [], 'success': True})
        result = self.run_miner(observations=[self.root/'bot.json'])
        self.assertEqual(result['observations'][0]['evidence_kind'], 'observed-only')
        self.assertEqual(result['indirect_control_transfers'][0]['status'], 'unknown')
        self.assertFalse(result['coverage']['complete_dependency_graph'])
        self.assertEqual(result['candidate_group']['closure'], 'open')

    def test_profile_consumes_pinned_frontier_as_discovery_only(self):
        self.write('frontier.json', self.run_miner())
        profile = {'original_sha256': 'rom-A', 'dependency_frontier':
                   {'path': 'frontier.json', 'sha256': digest(self.root/'frontier.json')}}
        receipt = validate_profile_frontier(profile, self.root)
        self.assertFalse(receipt['semantic_closure_admitted'])
        self.assertEqual(receipt['role'], 'pinned-discovery-context')
        profile['original_sha256'] = 'rom-B'
        with self.assertRaisesRegex(ValueError, 'ROM version mismatch'):
            validate_profile_frontier(profile, self.root)

    def test_profile_pin_tamper_rejected(self):
        self.write('frontier.json', self.run_miner())
        profile = {'original_sha256': 'rom-A', 'dependency_frontier':
                   {'path': 'frontier.json', 'sha256': 'wrong'}}
        with self.assertRaisesRegex(ValueError, 'pin mismatch'):
            validate_profile_frontier(profile, self.root)

    def test_inlined_seed_is_not_installed_root(self):
        seed = self.root/'dependencies/events'
        seed.mkdir(parents=True)
        self.write('dependencies/events/l0.json', {'entry':'08000200', 'varnodes':[], 'blocks':[]})
        self.write('dependencies/events/l1.json', {})
        l1pin = digest(seed/'l1.json')
        self.alter('provider-report.json', lambda x: x.update(dependency_seeds={
            'events': {'entry':0x08000200, 'package':'fixture.events',
                       'l1_sha256':l1pin, 'installed':False, 'adapter':{}}}))
        self.alter('prefab-graph.json', lambda x: x['components'].append({
            'id':'events', 'original_entry':'08000200', 'installed':False,
            'inlined_dependency':True,
            'portable_ir':{'path':'dependencies/events/l1.json', 'sha256':l1pin}}))
        result = self.run_miner()
        self.assertEqual(result['coverage']['installed_generated_body_count'], 1)
        self.assertEqual(result['coverage']['inlined_only_body_count'], 1)
        self.assertEqual(result['candidate_group']['roots'], ['leaf'])
        self.assertFalse(result['inlined_dependency_bodies'][0]['installed'])


if __name__ == '__main__':
    unittest.main()
