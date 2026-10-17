"""Small checks for the indexed-pixel transfer boundary; no ROM distribution."""
import sys
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1] / 'tools/pokemon_pipeline'
sys.path.insert(0, str(PIPELINE))
from character_assets import encode_tiles, fit_frame, tile_pixels


class CharacterTileTransferTests(unittest.TestCase):
    def test_gba_tile_order_preserves_all_palette_indices(self):
        pixels = [[(x + y * 3) % 16 for x in range(32)] for y in range(64)]
        self.assertEqual(tile_pixels(encode_tiles(pixels), 32, 64), pixels)

    def test_fit_preserves_indices_and_transparency_without_color_quantization(self):
        pixels = [[0] * 40 for _ in range(48)]
        for y in range(5, 39):
            for x in range(7, 30):
                pixels[y][x] = 1 + (x + y) % 15
        result, receipt = fit_frame(pixels)
        output = tile_pixels(result, 32, 32)
        self.assertEqual(receipt['opaque_bounds'], [7, 5, 30, 39])
        self.assertTrue(receipt['resampled'])
        self.assertEqual(len(result), 512)
        self.assertEqual(set(v for row in output for v in row), set(range(16)))
        self.assertTrue(all(row[0] == row[-1] == 0 for row in output))

    def test_rejects_inconsistent_geometry_and_empty_art(self):
        with self.assertRaisesRegex(ValueError, 'tile_geometry_mismatch'):
            tile_pixels(b'\0' * 31, 8, 8)
        with self.assertRaisesRegex(ValueError, 'empty_donor_frame'):
            fit_frame([[0] * 8 for _ in range(8)])


if __name__ == '__main__':
    unittest.main()
