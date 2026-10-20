from pathlib import Path
import tempfile
import unittest

from .extract import extract
from .reassemble import assemble, sha
from .qc import reconstruction_qc


class ReconstructionQCTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = bytes(range(256)) * 2
        path = self.root / 'original.gba'
        path.write_bytes(self.original)
        self.packet = self.root / 'packet'
        self.manifest = extract(path, self.packet, 'fixture', chunk_bytes=256)
        self.rebuilt, self.layout = assemble(self.packet / 'manifest.json')

    def report(self, **kwargs):
        return reconstruction_qc(self.original, self.rebuilt, self.manifest,
                                 self.layout, self.packet, **kwargs)

    def test_capture_exact_is_not_ir_or_semantic_equivalence(self):
        report = self.report()
        self.assertEqual(report['dimensions']['artifact_integrity']['status'], 'passed')
        self.assertTrue(report['dimensions']['byte_parity']['raw_exact'])
        self.assertEqual(report['dimensions']['actual_ir_coverage']['verified_bytes'], 0)
        self.assertIsNone(report['whole_game_equivalent'])
        self.assertEqual(len(report['dimensions']['dependency_closure']['unknown_components']), 2)

    def test_declared_ir_needs_owner_producer_verification(self):
        self.manifest['components'][0]['stratum'] = 'ir-regenerated'
        self.manifest['components'][0]['provider']['kind'] = 'ir_generated'
        self.assertEqual(self.report()['dimensions']['actual_ir_coverage']['verified_bytes'], 0)
        verified = self.report(producer_verifier=lambda component, root: True)
        self.assertEqual(verified['dimensions']['actual_ir_coverage']['verified_bytes'], 256)
        self.assertIsNone(verified['whole_game_equivalent'])

    def test_bad_layout_blocks_verified_ir_even_when_raw_equal(self):
        self.manifest['components'][0]['stratum'] = 'ir-regenerated'
        self.manifest['components'][0]['provider']['kind'] = 'ir_generated'
        self.layout['components'][0]['offset'] += 1
        report = self.report(producer_verifier=lambda component, root: True)
        self.assertTrue(report['dimensions']['byte_parity']['raw_exact'])
        self.assertEqual(report['dimensions']['artifact_integrity']['status'], 'failed')
        self.assertEqual(report['dimensions']['actual_ir_coverage']['verified_bytes'], 0)

    def test_wrong_dependency_version_cannot_claim_closed(self):
        a, b = self.manifest['components']
        a['dependencies'] = [{'target': b['id'], 'sha256': b['sha256'],
            'version': 'wrong-version', 'kind': 'call', 'status': 'resolved'}]
        for component in (a, b):
            component['closure'] = {'status': 'closed'}
        report = self.report()
        self.assertFalse(report['dimensions']['dependency_closure']['valid_pins'])
        self.assertEqual(report['dimensions']['dependency_closure']['closed_components'], [])

    def test_wrong_rom_and_stale_artifact_fail_without_overwriting_raw(self):
        self.manifest['original']['sha256'] = '0' * 64
        artifact = self.packet / self.manifest['components'][0]['artifact']['path']
        artifact.write_bytes(b'x' * 256)
        report = self.report()
        self.assertTrue(report['dimensions']['byte_parity']['raw_exact'])
        self.assertFalse(report['dimensions']['byte_parity']['comparison_valid'])
        self.assertEqual(report['dimensions']['artifact_integrity']['status'], 'failed')

    def test_self_asserted_native_certificate_is_unadmitted(self):
        report = self.report(certificates=[{'outcome': 'pass', 'whole_game_equivalent': True}])
        native = report['dimensions']['scoped_native_equivalence']
        self.assertEqual(native['admitted_certificates'], [])
        self.assertEqual(len(native['unadmitted_certificates']), 1)
        self.assertIsNone(report['whole_game_equivalent'])

    def test_appended_behavior_accounting_does_not_promote_source_coverage(self):
        payload = b'code'
        (self.packet / 'payload.bin').write_bytes(payload)
        self.layout['components'].append({'id': 'payload', 'sourceComponent': None,
            'role': 'generated-output', 'offset': len(self.rebuilt), 'size': len(payload),
            'sha256': sha(payload), 'stratum': 'ir-regenerated', 'evidence': ['fixture'],
            'artifact': {'path': 'payload.bin', 'sha256': sha(payload)}})
        self.rebuilt += payload
        self.layout['artifact'] = {'sha256': sha(self.rebuilt), 'size': len(self.rebuilt)}
        self.layout['artifactSha256'] = sha(self.rebuilt)
        report = self.report(producer_verifier=lambda row, root: {
            'verified': True, 'behavior_bytes': 2, 'binding_bytes': 1, 'alignment_bytes': 1})
        coverage = report['dimensions']['actual_ir_coverage']
        self.assertEqual(report['dimensions']['artifact_integrity']['status'], 'passed')
        self.assertEqual(coverage['verified_bytes'], 0)
        self.assertEqual(coverage['output_verified_bytes'], 4)
        self.assertEqual(coverage['output_verified_behavior_bytes'], 2)
        self.assertFalse(report['dimensions']['byte_parity']['raw_exact'])
        with_assets = self.report(producer_verifier=lambda row, root: {
            'verified': True, 'behavior_bytes': 1, 'binding_bytes': 1,
            'alignment_bytes': 0, 'asset_bytes': 2})
        accounting = with_assets['dimensions']['actual_ir_coverage']['generated_output'][0]['accounting']
        self.assertEqual(accounting['asset_bytes'], 2)
        self.assertEqual(accounting['alignment_bytes'], 0)
        invalid_counts = self.report(producer_verifier=lambda row, root: {
            'verified': True, 'behavior_bytes': 2, 'binding_bytes': 1,
            'alignment_bytes': 1, 'asset_bytes': 2})
        self.assertEqual(invalid_counts['dimensions']['actual_ir_coverage']['output_verified_bytes'], 0)
        (self.packet / 'payload.bin').write_bytes(b'evil')
        stale = self.report(producer_verifier=lambda row, root: True)
        self.assertEqual(stale['dimensions']['artifact_integrity']['status'], 'failed')
        self.assertEqual(stale['dimensions']['actual_ir_coverage']['output_verified_bytes'], 0)


if __name__ == '__main__':
    unittest.main()
