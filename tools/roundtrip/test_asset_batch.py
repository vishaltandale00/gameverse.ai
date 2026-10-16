import copy
import tempfile
import unittest
from pathlib import Path
from tools.roundtrip.asset_batch import validate_icon_consumer, elf_bytes, pinned, sha

CONTRACT = dict(kind='indexed-4bpp-icon-sprite/1', table='icons', selector='selectIcon', selector_result='image',
                creator='createIcon', frame_updater='updateIcon', sprite_creator='createSprite')
SOURCE = '''
const u8 *const icons[] = {[ONE] = graphicOne,};
const u8 *selectIcon(u16 species) { const u8 *image = icons[species]; return image; }
u8 createIcon(void) { iconTemplate.image = selectIcon(species); return createSprite(&iconTemplate, x); }
u8 createSprite(void) { gSprites[id].images = (const struct SpriteFrameImage *)iconTemplate->image; }
void updateIcon(void) { RequestSpriteCopy((u8 *)sprite->images + frame, OBJ_VRAM0 + TILE_SIZE_4BPP, size); }
const struct OamData oam = {.bpp = ST_OAM_4BPP, .size = SPRITE_SIZE(32x32)};
'''


class BatchAssetTests(unittest.TestCase):
    def test_exact_semantic_path_and_comment_spoof(self):
        self.assertEqual(validate_icon_consumer(SOURCE, CONTRACT), {'graphicOne'})
        wrong = SOURCE.replace('OBJ_VRAM0 + TILE_SIZE_4BPP', 'someMemory')+'// OBJ_VRAM0 TILE_SIZE_4BPP'
        with self.assertRaisesRegex(ValueError, 'copy sink'):
            validate_icon_consumer(wrong, CONTRACT)

    def test_table_selector_and_transfer_must_match(self):
        for before, after in [('icons[species]', 'other[species]'), ('iconTemplate.image = selectIcon', 'other.image = selectIcon'),
                              ('iconTemplate->image;', 'other->image;')]:
            with self.subTest(before=before), self.assertRaises(ValueError):
                validate_icon_consumer(SOURCE.replace(before,after), CONTRACT)

    def test_unknown_category_cannot_label_code(self):
        contract = copy.deepcopy(CONTRACT); contract['kind']='script-bytes'
        with self.assertRaisesRegex(ValueError, 'unsupported consumer'):
            validate_icon_consumer(SOURCE, contract)

    def test_elf_extent_must_be_file_backed(self):
        segment = dict(virtual=0x08000000, physical=0x08000000, file_offset=2, size=4)
        self.assertEqual(elf_bytes(b'XXabcd', [segment], 0x08000001, 2), b'bc')
        with self.assertRaisesRegex(ValueError, 'file-backed'):
            elf_bytes(b'XXabcd', [segment], 0x08000003, 2)

    def test_stale_input_ref_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source.c';path.write_bytes(b'original')
            ref={'path':str(path),'sha256':sha(b'original')}
            self.assertEqual(pinned(ref),b'original')
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'stale input pin'):
                pinned(ref)


if __name__=='__main__': unittest.main()
