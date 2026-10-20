"""Authored synthetic data only; no cartridge assets required by routine tests."""
import copy
import unittest

from tools.roundtrip.graphics_contracts import (decode_tiles, encode_tiles,
    decode_palette, encode_palette, decode_text_map, encode_text_map,
    insert_tiles, validate_graphics_contract, graphics_graph)


def entry(tile=0, bank=0):
    return dict(tile=tile, hflip=False, vflip=False, palette_bank=bank)


def fixture(bpp=4):
    contract = dict(id='synthetic-bg', kind='gba-text-bg/1', bpp=bpp,
        tiles='tiles', palette='palette', tilemap='map', copy_bytes=16 * bpp,
        map_copy_bytes=2048, transparent_index=0, character_base=0,
        screen_base=31, loaded_tile_start=4, map_width_tiles=32, map_height_tiles=32)
    assets = dict(tiles=encode_tiles([[1] * 64, [2] * 64], bpp),
        palette=encode_palette([[i % 32, 0, 0] for i in range(16 if bpp == 4 else 256)]),
        map=encode_text_map([entry(4), entry(5)] * 512))
    return contract, assets


class GraphicsContractsTests(unittest.TestCase):
    def test_nibble_order_and_roundtrips(self):
        pixels = list(range(16)) * 4
        packed = encode_tiles([pixels], 4)
        self.assertEqual(packed[:4], bytes([0x10, 0x32, 0x54, 0x76]))
        self.assertEqual(decode_tiles(packed, 4), [pixels])
        self.assertEqual(decode_tiles(encode_tiles([list(range(64))], 8), 8), [list(range(64))])
        colors = [[31, 0, 0], [0, 31, 0], [0, 0, 31]]
        self.assertEqual(encode_palette(colors), bytes.fromhex('1f00e003007c'))
        self.assertEqual(decode_palette(encode_palette(colors)), colors)
        value = dict(tile=1023, hflip=True, vflip=True, palette_bank=15)
        self.assertEqual(encode_text_map([value]), b'\xff\xff')
        self.assertEqual(decode_text_map(b'\xff\xff'), [value])

    def test_invalid_packing_color_and_bitfields(self):
        for data, bpp in [(b'x' * 31, 4), (b'x' * 63, 8), (b'x' * 32, 2)]:
            with self.subTest(bpp=bpp), self.assertRaises(ValueError):
                decode_tiles(data, bpp)
        for tile in [[16] * 64, [1] * 63]:
            with self.assertRaises(ValueError): encode_tiles([tile], 4)
        for colors in [[[32, 0, 0]], [[1, 2]]]:
            with self.assertRaises(ValueError): encode_palette(colors)
        with self.assertRaises(ValueError): decode_palette(b'\x00\x80')
        with self.assertRaises(ValueError): encode_text_map([entry(1024)])
        with self.assertRaises(ValueError): encode_text_map([entry(0, 16)])
        with self.assertRaises(ValueError): decode_text_map(b'x')

    def test_expansion_remaps_indices_and_requires_consumer_byte_update(self):
        contract, assets = fixture()
        validate_graphics_contract(contract, assets)
        assets['tiles'], assets['map'] = insert_tiles(assets['tiles'], assets['map'],
            4, 1, encode_tiles([[3] * 64], 4), loaded_tile_start=4)
        self.assertEqual([e['tile'] for e in decode_text_map(assets['map'])[:2]], [4, 6])
        self.assertEqual(decode_tiles(assets['tiles'], 4)[1], [3] * 64)
        with self.assertRaisesRegex(ValueError, 'copy byte count'):
            validate_graphics_contract(contract, assets)
        contract['copy_bytes'] = 96
        result = validate_graphics_contract(contract, assets)
        self.assertEqual(result['tile_count'], 3)
        self.assertFalse(result['visual_quality_verified'])
        self.assertIn('indexes_tiles', [e['type'] for e in graphics_graph(contract)['edges']])

    def test_invalid_map_palette_and_geometry(self):
        for change, message in [('tile', 'unloaded tile'), ('bank', 'palette color'),
                                ('map', 'geometry'), ('palette', 'whole 16-color')]:
            contract, assets = fixture()
            if change == 'tile': assets['map'] = encode_text_map([entry(6)] * 1024)
            if change == 'bank': assets['map'] = encode_text_map([entry(4, 1)] * 1024)
            if change == 'map': assets['map'] = assets['map'][:-2]
            if change == 'palette': assets['palette'] = assets['palette'][:-2]
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                validate_graphics_contract(contract, assets)

    def test_bg_vram_overlap_and_capacity(self):
        for overrides, message in [({'screen_base': 0}, 'overlap'),
                ({'character_base': 3, 'loaded_tile_start': 1023}, 'capacity'),
                ({'screen_base': 31, 'map_width_tiles': 64}, 'capacity')]:
            contract, assets = fixture()
            contract.update(overrides)
            if overrides.get('map_width_tiles') == 64:
                assets['map'] *= 2
                contract['map_copy_bytes'] *= 2
            with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, message):
                validate_graphics_contract(contract, assets)

    def test_8bpp_palette_and_bank(self):
        contract, assets = fixture(8)
        validate_graphics_contract(contract, assets)
        assets['map'] = encode_text_map([entry(4, 1)] * 1024)
        with self.assertRaisesRegex(ValueError, 'canonical zero'):
            validate_graphics_contract(contract, assets)

    def test_obj_geometry_tile_units_and_palette(self):
        contract = dict(id='obj', kind='gba-obj-frame-1d/1', bpp=8,
            tiles='tiles', palette='palette', copy_bytes=256, transparent_index=0,
            width=16, height=16, oam_tile_number=0, palette_bank=0)
        assets = dict(tiles=encode_tiles([[255] * 64] * 4, 8),
            palette=encode_palette([[0, 0, 0]] * 256))
        validate_graphics_contract(contract, assets)
        for overrides, message in [({'oam_tile_number': 1}, 'even'),
                ({'oam_tile_number': 1022}, 'capacity'),
                ({'width': 32}, 'dimensions'), ({'palette_bank': 1}, 'canonical')]:
            changed = {**contract, **overrides}
            with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, message):
                validate_graphics_contract(changed, assets)

    def test_transfer_only_does_not_infer_palette_or_map(self):
        contract = dict(id='mzm-shaped-synthetic', kind='gba-tile-transfer/1',
            bpp=4, tiles='tiles', copy_bytes=128, region='bg', destination_offset=0x4000,
            dma=[dict(role='tiles', channel=3, bits=16, source=0x2000000, destination=0x6004000, bytes=128)])
        assets = {'tiles': encode_tiles([[i] * 64 for i in range(4)], 4)}
        result = validate_graphics_contract(contract, assets)
        self.assertEqual(result['palette_colors'], 0)
        self.assertEqual(len(graphics_graph(contract)['edges']), 1)
        for dma in [dict(channel=3, bits=32, source=1, destination=4, bytes=128),
                    dict(channel=3, bits=16, source=2, destination=4, bytes=0),
                    dict(channel=0, bits=16, source=2, destination=4, bytes=0x8002),
                    dict(role='tiles', channel=3, bits=16, source=2, destination=0x6004000, bytes=64),
                    dict(role='tiles', channel=3, bits=16, source=2, destination=0x6004002, bytes=128)]:
            changed = copy.deepcopy(contract); changed['dma'] = [dma]
            with self.subTest(dma=dma), self.assertRaises(ValueError):
                validate_graphics_contract(changed, assets)
        contract['destination_offset'] = 0xffa0
        with self.assertRaisesRegex(ValueError, 'capacity'):
            validate_graphics_contract(contract, assets)


if __name__ == '__main__':
    unittest.main()
