"""Exact donor font closure checks with native compiled glyph verification."""
from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest

from tools.whole_game.single_rom.fonts import FONT_SPECS, _array, stage_fonts, verify_fonts

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless((DONOR / 'src/text.c').is_file(), 'pinned local sources unavailable')
class FontTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='font-source-test-')
        cls.out = Path(cls.directory.name)
        for rel in ('charmap.txt', 'src/text.c', 'include/text.h', 'tools/gbagfx/font.c', 'tools/gbagfx/font.h', 'tools/gbagfx/main.c'):
            target = cls.out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BASE / rel, target)
        cls.ledger = stage_fonts(BASE, DONOR, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_native_indices_and_fontinfo_preserved(self):
        source = (self.out / 'src/text.c').read_text()
        original = (BASE / 'src/text.c').read_text()
        # Each original indexed entry remains an exact text substring.
        for table in ('sFontInfos', 'sGlyphWidthFuncs', 'sMenuCursorDimensions'):
            original_body = _array(original, table).split('{', 1)[1].rsplit('}', 1)[0].strip().rstrip(',')
            self.assertIn(original_body, _array(source, table))
        header = (self.out / 'include/text.h').read_text()
        for suffix, constant, index in FONT_SPECS:
            self.assertIn(f'FR_FONT_{constant} = {index}', header)
            self.assertIn(f'case FR_FONT_{constant}:\n            FR_DecompressGlyph_{suffix}', source)
            self.assertIn(f'FR_GetGlyphWidth_{suffix}', source)
        self.assertEqual(self.ledger['coverage']['nativeIdsPreserved'], list(range(10)))
        charmap = (self.out / 'charmap.txt').read_text()
        self.assertIn('FR_FONT_MALE = FC 06 0A', charmap)
        self.assertIn('FR_FONT_SMALL = FC 06 0E', charmap)
        self.assertIn("'‥' = B0", charmap)
        self.assertIn('LEFT_PAREN = F9 13', charmap)
        self.assertIn('RIGHT_PAREN = F9 14', charmap)
        self.assertIn('DPAD_ANY = F8 0C', charmap)

    def test_original_assets_and_distinct_reader_implementations(self):
        self.assertEqual(self.ledger['coverage']['originalAssets'], 9)
        for item in self.ledger['assetProvenance']:
            self.assertEqual(hashlib.sha256((self.out / item['destination']).read_bytes()).hexdigest(), item['sha256'])
        functions = (self.out / 'src/data/firered/font_functions.h').read_text()
        self.assertNotIn('gGlyphInfo.', functions)
        self.assertNotIn('subUnion', functions)
        self.assertIn('FR_sFontMaleLatinGlyphWidths[glyphId]', functions)
        self.assertIn('FR_sFontFemaleLatinGlyphWidths[glyphId]', functions)
        self.assertIn('FR_sFontNormalCopy1LatinGlyphWidths[glyphId]', functions)
        self.assertIn('FR_sFontSmallLatinGlyphWidths[glyphId]', functions)
        self.assertTrue(self.ledger['buildEligible'])
        self.assertFalse(self.ledger['unresolved'])

    def test_all_original_pixels_and_widths_compiled(self):
        result = verify_fonts(BASE, DONOR, self.out)
        self.assertEqual(result['glyphCases'], 4424)
        self.assertEqual(result['fonts'], 5)
        self.assertEqual(result['originalAssets'], 9)
        self.assertEqual(result['outcome'], 'passed')

    def test_repeat_transform_identical(self):
        before = {rel: hashlib.sha256((self.out / rel).read_bytes()).hexdigest() for rel in self.ledger['changedFiles']}
        second = stage_fonts(BASE, DONOR, self.out)
        self.assertEqual(second, self.ledger)
        self.assertEqual(before, {rel: hashlib.sha256((self.out / rel).read_bytes()).hexdigest() for rel in second['changedFiles']})

    def test_no_mutable_canonical_target(self):
        with self.assertRaisesRegex(ValueError, 'isolated'):
            stage_fonts(BASE, DONOR, BASE)


if __name__ == '__main__':
    unittest.main()
