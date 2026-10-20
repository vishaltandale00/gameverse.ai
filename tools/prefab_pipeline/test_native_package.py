import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools.prefab_pipeline.native_package import extract_native_package


class NativePackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        (self.root / 'policy.c').write_text('void policy(void) {}\n')
        pin = hashlib.sha256((self.root / 'policy.c').read_bytes()).hexdigest()
        receipt = {'outcome': 'passed', 'rom_sha256': 'a' * 64,
                   'source_pins': {'policy.c': pin}, 'scope': 'bounded only'}
        (self.root / 'receipt.json').write_text(json.dumps(receipt))
        self.package = {'kind': 'component_package', 'id': 'example.native',
            'native_implementation': {'origin': 'self_decompilation', 'game_id': 'example',
                'compiler_ref': 'receipt.json', 'recovery': {'rom_sha256': 'a' * 64}},
            'lowering': {'native_v1': {'sources': [{'ref': 'policy.c', 'sha256': pin}],
                'exports': [{'symbol': 'policy', 'constant_choices': {'1': [1, 2]}}],
                'host_calls': [{'service': 'random', 'address': '0x8000001', 'abi': 'u32(void)'}]}},
            'states': [{'id': 'actor', 'type': 'native', 'lifetime': 'entity'}]}
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / 'package.json').write_text(json.dumps(self.package))

    def capsule(self):
        return extract_native_package(self.root, 'package.json')['candidates'][0]

    def test_native_scope_preserves_services_and_no_automatic_origin(self):
        c = self.capsule()
        self.assertTrue(c['maturity']['native_subset_qualified'])
        self.assertFalse(c['maturity']['automatic_highfunction_l1'])
        self.assertFalse(c['maturity']['whole_game'])
        self.assertEqual(c['backend'], 'native-rom-patch')
        self.assertFalse(c['dependencies'][0]['resolved'])
        self.assertEqual(c['domain']['exports'][0]['constant_choices'], {'1': [1, 2]})

    def test_modified_source_does_not_reuse_native_pass(self):
        (self.root / 'policy.c').write_text('void changed(void) {}')
        c = self.capsule()
        self.assertFalse(c['maturity']['native_subset_qualified'])
        self.assertIn('source-pin-mismatch', [g['id'] for g in c['gaps']])

    def test_wrong_host_rom_does_not_reuse_native_pass(self):
        self.package['native_implementation']['recovery']['rom_sha256'] = 'b' * 64
        self.save()
        self.assertFalse(self.capsule()['maturity']['native_subset_qualified'])

    def test_budgets_and_escaped_inputs_fail(self):
        with self.assertRaises(ValueError):
            extract_native_package(self.root, 'package.json', max_bytes=1)
        self.package['lowering']['native_v1']['sources'][0]['ref'] = '../outside.c'
        self.save()
        with self.assertRaises(ValueError):
            self.capsule()


if __name__ == '__main__':
    unittest.main()
