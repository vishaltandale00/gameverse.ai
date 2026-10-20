import json
import tempfile
import unittest
from pathlib import Path

from tools.roundtrip.native_provider import capture_native_layout, assemble_native_layout, sha


class NativeProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = bytes(range(32))
        self.generated = self.original[:4]+b'veneer!!'+self.original[12:]+b'payload!'+b'\xff'*8
        self.lock = {'output_sha256': sha(self.generated), 'retained_foundation_sha256': sha(self.original),
                     'payload_address': '0x08000020', 'payload_bytes': 8, 'payload_sha256': sha(b'payload!'),
                     'hook_lowering': [{'hook': {'id': 'defeat', 'address': '0x08000004', 'preimage': self.original[4:12].hex()},
                                       'output_bytes': b'veneer!!'.hex()}]}

    def capture(self):
        return capture_native_layout(self.original, self.generated, self.lock, self.root/'pieces',
                                     original_path=self.root/'unavailable-original.gba', evidence=[{'path': 'proof', 'sha256': 'a'*64}])

    def test_artifact_only_reassembly_preserves_honest_source_mapping(self):
        manifest, layout = self.capture()
        self.assertEqual(manifest['original']['size'], 32)
        self.assertEqual(layout['artifact']['size'], 48)
        output = self.root/'reconstructed.gba'
        assemble_native_layout(self.root/'pieces/layout.json', output)
        self.assertEqual(output.read_bytes(), self.generated)
        self.assertNotEqual(output.read_bytes(), self.original)
        self.assertEqual(sum(c['size'] for c in manifest['components'] if c['stratum']=='native-relocated'), 8)
        self.assertEqual(sum(c['size'] for c in layout['components'] if c['sourceComponent'] is None), 16)
        self.assertTrue(next(c for c in manifest['components'] if c['stratum']=='native-relocated')['dependencies'])

    def test_opaque_change_is_rejected_even_with_self_consistent_output_hash(self):
        self.generated = b'X'+self.generated[1:]
        self.lock['output_sha256'] = sha(self.generated)
        with self.assertRaisesRegex(ValueError, 'opaque original bytes'):
            self.capture()

    def test_stale_generated_piece_cannot_produce_cartridge(self):
        self.capture()
        (self.root/'pieces/generated/native-payload.bin').write_bytes(b'changed!')
        with self.assertRaisesRegex(ValueError, 'stale'):
            assemble_native_layout(self.root/'pieces/layout.json', self.root/'bad.gba')
        self.assertFalse((self.root/'bad.gba').exists())

    def test_payload_or_hook_identity_mismatch_rejected(self):
        self.lock['payload_sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'payload identity'):
            self.capture()

    def test_layout_gap_or_escaping_artifact_rejected(self):
        _, layout = self.capture()
        layout['components'][0]['artifact']['path'] = '../../outside.bin'
        (self.root/'pieces/layout.json').write_text(json.dumps(layout))
        with self.assertRaisesRegex(ValueError, 'escapes'):
            assemble_native_layout(self.root/'pieces/layout.json', self.root/'bad.gba')

    def test_reassembly_keeps_sealed_input_layout_byte_identical(self):
        self.capture()
        layout_path = self.root/'pieces/layout.json'
        # Formatting and the original artifact destination are producer-owned
        # bytes, not incidental metadata an independent verifier may normalize.
        layout = json.loads(layout_path.read_text())
        layout['artifact']['path'] = 'sealed-producer.gba'
        layout_path.write_text(json.dumps(layout, separators=(',', ':'))+'  \n')
        sealed = layout_path.read_bytes()
        first = assemble_native_layout(layout_path, self.root/'first.gba')
        second = assemble_native_layout(layout_path, self.root/'second.gba')
        self.assertEqual(layout_path.read_bytes(), sealed)
        self.assertEqual(first['artifact']['path'], str((self.root/'first.gba').resolve()))
        self.assertEqual(second['artifact']['path'], str((self.root/'second.gba').resolve()))
        self.assertEqual((self.root/'first.gba').read_bytes(), self.generated)
        self.assertEqual((self.root/'second.gba').read_bytes(), self.generated)

    def test_existing_output_and_input_layout_preserved_on_rejection(self):
        self.capture()
        layout_path = self.root/'pieces/layout.json'
        sealed = layout_path.read_bytes()
        output = self.root/'existing.gba'
        output.write_bytes(b'accepted artifact')
        with self.assertRaises(FileExistsError):
            assemble_native_layout(layout_path, output)
        self.assertEqual(output.read_bytes(), b'accepted artifact')
        self.assertEqual(layout_path.read_bytes(), sealed)


if __name__ == '__main__':
    unittest.main()
