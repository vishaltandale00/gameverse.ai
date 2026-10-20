import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.prefab_pipeline.reconstruction_compare import byte_diff, compare_reconstruction, sha256


class ReconstructionCompareTests(unittest.TestCase):
    def fixture(self, data=b'\x00\xffhello\x00'):
        components = [{"id": "header", "version": "v1", "offset": 0, "size": 2,
                       "sha256": sha256(data[:2]), "stratum": "raw-captured", "provider": {"kind": "opaque_bytes"}},
                      {"id": "body", "version": "v1", "offset": 2, "size": len(data) - 2,
                       "sha256": sha256(data[2:]), "stratum": "opaque-preserved", "provider": {"kind": "opaque_bytes"}}]
        manifest = {"schema": "gameverse.rom-roundtrip/1", "original": {"sha256": sha256(data), "size": len(data)},
                    "components": components, "constraints": {"preserve_layout": True}}
        layout = {"schema": "gameverse.rom-roundtrip-layout/1", "originalSha256": sha256(data),
                  "artifact": {"sha256": sha256(data), "size": len(data)},
                  "components": [{key: row[key] for key in ("id", "version", "offset", "size", "sha256")} for row in components]}
        return data, manifest, layout

    def test_exact_capture_is_not_semantic_reconstruction(self):
        data, manifest, layout = self.fixture()
        result = compare_reconstruction(data, data, manifest, layout)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['coverage']['classification'], 'capture-only')
        self.assertEqual(result['coverage']['semantic_unknown_bytes'], len(data))
        self.assertIsNone(result['semantic_evidence']['whole_game_equivalent'])
        manifest['components'][0]['stratum'] = 'object-captured'
        captured = compare_reconstruction(data, data, manifest, layout)
        self.assertEqual(captured['coverage']['classification'], 'capture-only')
        self.assertEqual(captured['coverage']['declared_regenerated_bytes'], 0)
        self.assertEqual(captured['coverage']['stratum_bytes']['object-captured'], 2)

    def test_header_filler_and_unknown_bytes_never_auto_ignored(self):
        data, manifest, layout = self.fixture()
        changed = bytearray(data)
        changed[0] = 1
        changed[-1] = 1
        result = compare_reconstruction(data, bytes(changed), manifest, layout)
        self.assertEqual(result['raw']['different_bytes'], 2)
        self.assertEqual(result['policy_masked']['ignored_bytes'], 0)
        self.assertFalse(result['components'][0]['original_address']['exact'])
        self.assertEqual(result['status'], 'failed')

    def test_stale_pins_versions_overlaps_gaps_and_bounds_fail_with_raw_retained(self):
        data, manifest, layout = self.fixture()
        for mutation, expected in [
            (lambda m, l: m['original'].update(sha256='bad'), 'original ROM hash'),
            (lambda m, l: l['components'][0].update(version='v2'), 'version mismatch'),
            (lambda m, l: m['components'][1].update(offset=1), 'overlapping'),
            (lambda m, l: m['components'][1].update(size=1), 'uncovered'),
            (lambda m, l: m['components'][1].update(size=999), 'out-of-bounds'),
            (lambda m, l: l['artifact'].update(sha256='bad'), 'artifact hash'),
        ]:
            with self.subTest(expected=expected):
                m, l = copy.deepcopy(manifest), copy.deepcopy(layout)
                mutation(m, l)
                result = compare_reconstruction(data, data, m, l)
                self.assertTrue(result['raw']['exact'])
                self.assertEqual(result['status'], 'failed')
                self.assertTrue(any(expected in error for error in result['validation']['errors']))

    def test_masks_require_producer_proof_and_separate_raw_result(self):
        data, manifest, layout = self.fixture()
        changed = b'\x01' + data[1:]
        mask = {"offset": 0, "size": 1, "reason": "bounded fixture policy", "provenance": "test-owner", "producerProof": {"id": "proof"}}
        rejected = compare_reconstruction(data, changed, manifest, layout, [mask])
        self.assertEqual(rejected['policy_masked']['ignored_bytes'], 0)
        admitted = compare_reconstruction(data, changed, manifest, layout, [mask, mask],
                                         evidence_verifier=lambda kind, record: kind == 'mask' and record == mask)
        self.assertEqual(admitted['policy_masked']['ignored_bytes'], 1)
        self.assertTrue(admitted['policy_masked']['matches_under_policy'])
        self.assertEqual(admitted['raw']['different_bytes'], 1)
        self.assertEqual(admitted['status'], 'failed')

    def test_moved_exact_component_is_separate_from_original_address(self):
        data = b'abcd'
        data, manifest, layout = self.fixture(data)
        manifest['constraints']['preserve_layout'] = False
        rebuilt = b'cdab'
        layout['artifact'] = {'sha256': sha256(rebuilt), 'size': 4}
        for row in layout['components']:
            row['offset'] = 2 if row['id'] == 'header' else 0
        report = compare_reconstruction(data, rebuilt, manifest, layout)
        self.assertTrue(report['validation']['valid'])
        self.assertFalse(report['raw']['exact'])
        self.assertTrue(all(row['mapped_output']['exact'] for row in report['components']))
        self.assertTrue(all(not row['original_address']['exact'] for row in report['components']))
        self.assertIsNone(report['semantic_evidence']['whole_game_equivalent'])

    def test_arbitrary_certificate_does_not_establish_equivalence(self):
        data, manifest, layout = self.fixture()
        cert = {'status': 'passed', 'verified': True, 'opcode_similarity': 1, 'strings_match': True}
        report = compare_reconstruction(data, data, manifest, layout, certificates=[cert])
        self.assertFalse(report['semantic_evidence']['certificates'][0]['admitted'])
        self.assertIsNone(report['semantic_evidence']['whole_game_equivalent'])

    def test_bounded_ranges_count_all_differences_and_length_changes(self):
        report = byte_diff(b'abcdefghi', b'aXcXeXgXi!', max_ranges=2)
        self.assertEqual(report['different_bytes'], 5)
        self.assertEqual(report['difference_range_count'], 5)
        self.assertEqual(len(report['difference_ranges']), 2)
        self.assertTrue(report['ranges_truncated'])
        self.assertEqual(byte_diff(b'x' * 131072, b'x' * 65535 + b'y' + b'x' * 65536)['different_bytes'], 1)
        self.assertEqual(byte_diff(b'abcd', b'ab')['different_bytes'], 2)

    def test_canonical_dependency_target_hash_and_optional_version(self):
        data, manifest, layout = self.fixture()
        manifest['components'][0]['dependencies'] = [{'target': 'body', 'sha256': manifest['components'][1]['sha256'], 'kind': 'call', 'status': 'resolved'}]
        self.assertTrue(compare_reconstruction(data, data, manifest, layout)['validation']['valid'])
        manifest['components'][0]['dependencies'][0]['sha256'] = 'stale'
        report = compare_reconstruction(data, data, manifest, layout)
        self.assertTrue(any('dependency hash mismatch' in error for error in report['validation']['errors']))

    def test_appended_generated_output_has_explicit_independent_layout(self):
        data, manifest, layout = self.fixture()
        rebuilt = data + b'payload'
        layout['artifact'] = {'sha256': sha256(rebuilt), 'size': len(rebuilt)}
        layout['components'].append({'id': 'payload', 'sourceComponent': None, 'role': 'generated-output',
            'offset': len(data), 'size': 7, 'sha256': sha256(b'payload'), 'stratum': 'native-relocated',
            'evidence': [{'kind': 'producer', 'sha256': 'fixture'}]})
        report = compare_reconstruction(data, rebuilt, manifest, layout)
        self.assertTrue(report['validation']['valid'])
        self.assertEqual(report['raw']['different_bytes'], 7)
        self.assertEqual(len(report['generated_output_regions']), 1)
        self.assertTrue(all(row['original_address']['exact'] for row in report['components']))

    def test_cli_retains_failure_and_rejects_overwrite(self):
        data, manifest, layout = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'original').write_bytes(data)
            (root / 'rebuilt').write_bytes(b'X' + data[1:])
            (root / 'manifest.json').write_text(json.dumps(manifest))
            (root / 'layout.json').write_text(json.dumps(layout))
            cmd = [sys.executable, '-B', '-m', 'tools.prefab_pipeline.reconstruction_compare']
            for key, filename in [('manifest', 'manifest.json'), ('layout', 'layout.json'), ('original', 'original'), ('rebuilt', 'rebuilt'), ('output', 'report.json')]:
                cmd.extend(['--' + key, str(root / filename)])
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 1)
            before = (root / 'report.json').read_bytes()
            self.assertEqual(json.loads(before)['raw']['different_bytes'], 1)
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 2)
            self.assertEqual((root / 'report.json').read_bytes(), before)
            (root / 'manifest.json').write_text('{broken-json')
            cmd[-1] = str(root / 'malformed-report.json')
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 1)
            malformed = json.loads((root / 'malformed-report.json').read_text())
            self.assertEqual(malformed['raw']['different_bytes'], 1)
            self.assertFalse(malformed['validation']['valid'])


if __name__ == '__main__':
    unittest.main()
