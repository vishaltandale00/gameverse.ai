"""Focused native tile-boundary and ownership parser checks; no ROM assets."""
import importlib.util
import struct
import unittest
from pathlib import Path

SPEC=importlib.util.spec_from_file_location('sonic_enemy_assets',Path(__file__).resolve().parents[1]/'tools/sonic_pokemon_pipeline/enemy_assets.py')
assets=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)


class SonicEnemyArtTests(unittest.TestCase):
    def test_indexed_tiles_roundtrip_across_native_subsprite_boundaries(self):
        pixels=[[(x+3*y)%16 for x in range(64)] for y in range(32)]
        self.assertEqual(assets.decode_tiles(assets.encode_tiles(pixels),64,32),pixels)

    def test_palette_maps_opaque_black_to_nontransparent_index(self):
        black=[(0,0,0)]*16
        mapping=assets.remap_palette(black,black)
        self.assertEqual(mapping[0],0)
        self.assertTrue(all(1<=value<16 for value in mapping[1:]))

    def test_union_fit_uses_entire_sprite_not_original_enemy_opacity(self):
        source=[[0]*32 for _ in range(32)]
        for y in range(4,28):
            for x in range(4,28):source[y][x]=2
        oam={'x':0,'y':0,'shape':0,'size':2,'affineMode':0,'objMode':0,'bpp':0,'matrixNum':8,'tileNum':0}
        canvas,receipt=assets.fit_into_union(source,[oam],{})
        encoded=assets.pack_oam(canvas,[oam],512,list(range(16)))
        self.assertEqual(set(value for row in assets.decode_tiles(encoded,32,32) for value in row),{2})
        self.assertFalse(receipt['native_enemy_opacity_mask_used'])

    def test_native_command_decode_keeps_hitboxes_and_load_offsets(self):
        words=[-2,15,16|(192<<16),-1,1000,20,-6,0,0x05010203,8,2,-3,12]
        rom=struct.pack('<'+'i'*len(words),*words)
        parsed=assets.native_stream(rom,0x08000000)
        self.assertEqual(parsed['frames'][0],{'duration':8,'frame':2,'tiles':[1000,20],'palette':[15,16,192]})
        self.assertEqual(parsed['commands'][2],[-6,0,0x05010203])
        self.assertEqual(parsed['length'],len(rom))

    def test_invalid_native_command_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'unknown_native_animation_command'):
            assets.native_stream(struct.pack('<i',-99),0x08000000)


if __name__=='__main__':
    unittest.main()
