"""Small source-contract checks; no ROM builds or emulation."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokemon_pipeline'))
from assets import palette_map, remap_4bpp, validate_frames, mapping, closure, INFO

class SpriteContractTests(unittest.TestCase):
    def test_opaque_never_becomes_transparent(self):
        host=[(0,0,0)]*16
        donor=[(31,31,31)]*16
        indices=palette_map(donor,host)
        self.assertEqual(indices[0],0)
        self.assertTrue(all(x>0 for x in indices[1:]))
        self.assertEqual(remap_4bpp(bytes([0x10,0x01,0xF0]),indices),bytes([0x10,0x01,0x10]))

    def test_exact_color_index_transfer(self):
        host=[(i,i,i) for i in range(16)]
        donor=[host[0]]+host[1:][::-1]
        indices=palette_map(donor,host)
        self.assertEqual(indices,[0]+list(range(15,0,-1)))
        self.assertEqual(remap_4bpp(bytes([0x21]),indices),bytes([0xEF]))

    def test_invalid_transparency_map_rejected(self):
        with self.assertRaises(ValueError):remap_4bpp(b'\x01',[1]*16)
        with self.assertRaises(ValueError):remap_4bpp(b'\x01',[0]*16)

    def test_dependency_closure_is_topological(self):
        defs={'root':'const int root = frames + anim;', 'frames':'const int frames = pixels;', 'pixels':'const int pixels = 1;', 'anim':'const int anim = 0;'}
        self.assertEqual(closure(defs,['root']),['pixels','frames','anim','root'])

    def test_species_identity_not_guessed(self):
        host={INFO+'Pidgey':'',INFO+'RedNormal':'',INFO+'Mew':''}
        donor={INFO+'Zigzagoon':'',INFO+'BrendanNormal':'',INFO+'Mew':''}
        pairs=mapping(host,donor)
        self.assertNotIn(INFO+'Pidgey',pairs)
        self.assertEqual(pairs[INFO+'Mew'],INFO+'Mew')
        self.assertEqual(pairs[INFO+'RedNormal'],INFO+'BrendanNormal')

    def test_animation_cannot_read_past_frame_table(self):
        defs={'info':'.width = 16,\n.height = 32,\n.images = frames,\n.anims = anim,', 'frames':'overworld_frame(pic, 2, 4, 0)', 'anim':'ANIMCMD_FRAME(1, 8)'}
        with self.assertRaisesRegex(ValueError,'animation_frame_out_of_range'):validate_frames(defs,'info')
        defs['anim']='ANIMCMD_FRAME(0, 8)'
        self.assertEqual(validate_frames(defs,'info'),[('pic',2,4,0)])
        defs['info']=defs['info'].replace('16','32')
        with self.assertRaisesRegex(ValueError,'frame_geometry_mismatch'):validate_frames(defs,'info')

if __name__=='__main__':unittest.main()
