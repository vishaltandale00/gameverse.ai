import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.roundtrip.private_bundle import export_bundle, rebuild_bundle


def sha(data):
    return hashlib.sha256(data).hexdigest()


class PrivateBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.packet, self.bundle = self.root/'packet', self.root/'bundle'
        self.packet.mkdir()
        self.data = b'private captured bytes'
        (self.packet/'piece.bin').write_bytes(self.data)
        row = {'id': 'one', 'version': 'v1', 'offset': 0, 'size': len(self.data), 'sha256': sha(self.data),
               'stratum': 'object-captured', 'artifact': {'path': 'piece.bin', 'sha256': sha(self.data)},
               'provider': {'kind': 'opaque_bytes'}, 'contract': {}, 'dependencies': [], 'relocations': []}
        self.manifest = {'schema': 'gameverse.rom-roundtrip/1', 'game_id': 'fixture',
                         'original': {'path': '/unavailable/original.gba', 'sha256': sha(self.data), 'size': len(self.data)},
                         'components': [row]}
        self.layout = {'schema': 'gameverse.rom-roundtrip-layout/1', 'originalSha256': sha(self.data),
                       'artifact': {'path': '/unavailable/rebuilt.gba', 'sha256': sha(self.data), 'size': len(self.data)},
                       'components': [{'id': 'one', 'sourceComponent': 'one', 'version': 'v1', 'offset': 0,
                                       'size': len(self.data), 'sha256': sha(self.data)}]}
        for name, value in (('manifest.json', self.manifest), ('layout.json', self.layout),
                            ('comparison.json', {'validation': {'valid': True, 'errors': []}, 'raw': {
                                'rebuilt_sha256': sha(self.data), 'original_sha256': sha(self.data), 'original_size': len(self.data)}})):
            (self.packet/name).write_text(json.dumps(value))

    def test_import_once_rebuild_after_original_packet_removed(self):
        bundle = export_bundle(self.packet, self.bundle)
        shutil.rmtree(self.packet)
        moved = self.root/'isolated'/'import'
        moved.parent.mkdir()
        self.bundle.rename(moved)
        output = self.root/'isolated'/'reconstructed.gba'
        report = rebuild_bundle(moved, output)
        self.assertEqual(output.read_bytes(), self.data)
        self.assertEqual(report['capability'], 'rebuild_only')
        self.assertFalse(report['ir_regeneration'])
        self.assertEqual(report['replay_regenerated_bytes'], 0)
        self.assertNotIn('/unavailable', (moved/'bundle.json').read_text())
        self.assertEqual(bundle['provenance']['output_stratum_bytes'], {'object-captured': len(self.data)})

    def test_stale_source_piece_fails_without_original_fallback(self):
        (self.packet/'piece.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'pin mismatch'):
            export_bundle(self.packet, self.bundle)
        self.assertFalse(self.bundle.exists())

    def test_stale_private_piece_prevents_output(self):
        export_bundle(self.packet, self.bundle)
        (self.bundle/'components/0000.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'pin mismatch'):
            rebuild_bundle(self.bundle, self.root/'bad.gba')
        self.assertFalse((self.root/'bad.gba').exists())

    def test_component_path_escape_rejected(self):
        self.manifest['components'][0]['artifact']['path'] = '../piece.bin'
        (self.packet/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'escaping'):
            export_bundle(self.packet, self.bundle)

    def test_existing_output_unchanged(self):
        export_bundle(self.packet, self.bundle)
        output = self.root/'accepted.gba'
        output.write_bytes(b'accepted')
        with self.assertRaises(FileExistsError):
            rebuild_bundle(self.bundle, output)
        self.assertEqual(output.read_bytes(), b'accepted')

    def test_layout_version_and_comparison_source_identity_must_match(self):
        self.layout['components'][0]['version'] = 'stale'
        (self.packet/'layout.json').write_text(json.dumps(self.layout))
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            export_bundle(self.packet, self.bundle)
        self.layout['components'][0]['version'] = 'v1'
        (self.packet/'layout.json').write_text(json.dumps(self.layout))
        report = json.loads((self.packet/'comparison.json').read_text())
        report['raw']['original_sha256'] = '0'*64
        (self.packet/'comparison.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'comparison'):
            export_bundle(self.packet, self.bundle)


if __name__ == '__main__':
    unittest.main()
