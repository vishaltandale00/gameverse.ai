import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.roundtrip import bundle_assets as assets


class AssetSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        patcher = patch.object(assets, 'ROOT', self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        (self.root/'include').mkdir()

    def fixture(self, source, data, kind, size, expected):
        (self.root/'source.c').write_text(source)
        path = self.root/('include/pal.inc' if kind.startswith('palette') else 'sample.bin')
        path.write_bytes(data)
        return {'asset_symbol': 'testData', 'kind': kind, 'exact_size_bytes': size,
                'span_sha256': assets.sha(expected), 'source_declaration': 'source.c',
                'source_file_sha256': assets.sha(source.encode()), 'source_asset': str(path.relative_to(self.root)),
                'source_asset_sha256': assets.sha(data)}

    def test_palette_requires_exact_typed_count_and_literal_serialization(self):
        c = self.fixture('const u16 testData[2 * 2] = {\n#include "pal.inc"\n};', b'1u,2u,3u,4u',
                         'palette, u16 little-endian colors', 8, b'\x01\0\x02\0\x03\0\x04\0')
        data, kind = assets._source_data(c, self.root, ['include'])
        self.assertEqual(len(data), 8)
        self.assertEqual(kind, 'gba-palette-u16')
        c['exact_size_bytes'] = 10
        with self.assertRaises(ValueError):
            assets._source_data(c, self.root, ['include'])

    def test_code_or_script_kind_cannot_be_named_into_assets(self):
        c = self.fixture('const u8 testData[3] = {0,0,0};', b'abc', 'script bytecode', 3, b'abc')
        with self.assertRaisesRegex(ValueError, 'code/scripts remain unclassified'):
            assets._source_data(c, self.root, ['include'])

    def test_audio_incbin_requires_readonly_directive_and_exact_file_extent(self):
        c = self.fixture('.section .rodata\ntestData:\n.incbin "sample.bin"\n.align 2', b'abc',
                         'direct sound sample incbin', 3, b'abc')
        self.assertEqual(assets._source_data(c, self.root, ['include'])[0], b'abc')
        c['exact_size_bytes'] = 4  # Alignment is not sample content.
        with self.assertRaises(ValueError):
            assets._source_data(c, self.root, ['include'])
        c = self.fixture('.section .text\ntestData:\n.incbin "sample.bin"', b'abc',
                         'direct sound sample incbin', 3, b'abc')
        with self.assertRaisesRegex(ValueError, 'read-only incbin'):
            assets._source_data(c, self.root, ['include'])
        c = self.fixture('.section .rodata\n.section .text\ntestData:\n.incbin "sample.bin"', b'abc',
                         'direct sound sample incbin', 3, b'abc')
        with self.assertRaisesRegex(ValueError, 'read-only incbin'):
            assets._source_data(c, self.root, ['include'])

    def test_audio_consumer_requires_pointer_argument_not_comment(self):
        proof = {'pointer_lanes': {'play_sample': 2}}
        self.assertTrue(assets._sample_consumer('play_sample 60, 0, sampleData, 255 @ sample', 'sampleData', proof))
        self.assertFalse(assets._sample_consumer('play_sample sampleData, 0, other, 255', 'sampleData', proof))
        self.assertFalse(assets._sample_consumer('play_sample 60, 0, other, 255 @ sampleData', 'sampleData', proof))

    def test_stale_source_and_include_escape_rejected(self):
        c = self.fixture('const u16 testData[1] = {\n#include "pal.inc"\n};', b'1u',
                         'palette, u16 little-endian colors', 2, b'\1\0')
        bad = copy.deepcopy(c)
        bad['source_file_sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'stale'):
            assets._source_data(bad, self.root, ['include'])
        bad = copy.deepcopy(c)
        bad['source_asset'] = '../outside.inc'
        with self.assertRaisesRegex(ValueError, 'escapes'):
            assets._source_data(bad, self.root, ['include'])

    def test_configured_palette_consumer_rejects_wrong_sink(self):
        source = '''const u16* chosen;
chosen = testData; temporary = chosen; CopyColors(temporary, 0, 16);
void CopyColors(const u16* input, int offset, int count) {
for (index=offset; index<count; index++) colors[index] = *input++;
}
'''
        (self.root/'consumer.c').write_text(source)
        contract = {'kind': 'typed-u16-palette-copy/1',
                    'source': {'path': 'consumer.c', 'sha256': assets.sha(source.encode())},
                    'binding_variable': 'chosen', 'transfer_variable': 'temporary',
                    'sink_function': 'CopyColors', 'sink_array': 'colors', 'sink_parameter': 'input', 'sink_index': 'index'}
        assets._consumer_contract('gba-palette-u16', {'asset_symbol': 'testData'}, self.root, contract)
        contract['sink_array'] = 'unrelated'
        with self.assertRaisesRegex(ValueError, 'typed palette copy'):
            assets._consumer_contract('gba-palette-u16', {'asset_symbol': 'testData'}, self.root, contract)


if __name__ == '__main__':
    unittest.main()
