"""Small source-patch and compiled runtime boundary checks; no ROM build."""
import json
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from .map_runtime import stage_map_runtime, extract_attribute, border_index

ROOT = Path(__file__).resolve().parents[3]
EMERALD = ROOT / 'local/decomps/pokeemerald'
FIRERED = ROOT / 'local/decomps/pokefirered'
FILES = ['include/global.fieldmap.h', 'include/fieldmap.h', 'include/event_object_movement.h',
         'src/fieldmap.c', 'src/field_camera.c', 'src/shop.c', 'src/field_effect_helpers.c', 'src/event_object_movement.c',
         'tools/mapjson/mapjson.cpp']


class MapRuntimeTests(unittest.TestCase):
    def test_raw_attributes_preserve_all_bits(self):
        for bit in range(32):
            raw = 1 << bit
            reconstructed = 0
            for field, (shift, width) in enumerate(((0,9),(9,5),(14,4),(18,6),(24,3),(27,2),(29,2),(31,1))):
                reconstructed |= extract_attribute(raw, field) << shift
            self.assertEqual(reconstructed, raw)
            self.assertEqual(extract_attribute(raw, 255), raw)

    def test_border_period_and_negative_coords(self):
        for width, height in ((2,2),(4,4),(1,2)):
            for x in range(-20, 20):
                for y in range(-20,20):
                    index = border_index(x,y,width,height)
                    self.assertTrue(0 <= index < width*height)
                    self.assertEqual(index, border_index(x+width,y+height,width,height))

    def test_staged_source_is_deterministic_and_compiled_helpers(self):
        canonical = {rel:(EMERALD/rel).read_bytes() for rel in FILES}
        with tempfile.TemporaryDirectory(prefix='whole-game-map-runtime-') as directory:
            reports = []
            for name in ('first','second'):
                out = Path(directory)/name
                for rel in FILES:
                    dest = out/rel
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    dest.write_bytes(canonical[rel])
                (out/'src/data/firered/object_events').mkdir(parents=True)
                (out/'src/data/firered/object_events/all.h').write_text('#include "data/firered/object_events/palette_tags.h"\n')
                reports.append(stage_map_runtime(EMERALD,FIRERED,out))
            self.assertEqual(reports[0],reports[1])
            self.assertFalse(reports[0]['semantic_coverage_complete'])
            self.assertTrue(reports[0]['unsupported'])
            source = (Path(directory)/'first/src/fieldmap.c').read_text()
            helpers = source[source.index('u16 WholeGamePrimaryMetatileCount'):source.index('struct ConnectionFlags')]
            harness = '''#include <stdint.h>
#include <assert.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32;
struct Tileset {const u32 *fireRedMetatileAttributes;};
struct MapLayout {const struct Tileset *primaryTileset,*secondaryTileset;};
''' + helpers + '''
int main(void) {
 u32 primary[640]={0},secondary[384]={0};
 struct Tileset native={0},a={primary},b={secondary};
 struct MapLayout hoenn={&native,&native},kanto={&a,&b};
 primary[639]=0xdeadbeef; secondary[0]=0x12345678;
 assert(WholeGamePrimaryTileCount(&hoenn)==512);
 assert(WholeGamePrimaryTileCount(&kanto)==640);
 assert(WholeGamePrimaryPaletteCount(&hoenn)==6);
 assert(WholeGamePrimaryPaletteCount(&kanto)==7);
 assert(WholeGameFireRedAttribute(&kanto,639,255)==0xdeadbeef);
 assert(WholeGameFireRedAttribute(&kanto,640,255)==0x12345678);
 assert(WholeGameFireRedAttribute(&kanto,639,0)==(0xdeadbeef&0x1ff));
 assert(WholeGameFireRedAttribute(&kanto,639,1)==((0xdeadbeef>>9)&31));
 assert(WholeGameFireRedAttribute(&kanto,639,4)==((0xdeadbeef>>24)&7));
 assert(WholeGameFireRedAttribute(&kanto,639,6)==((0xdeadbeef>>29)&3));
 assert(WholeGameFireRedAttribute(&kanto,1024,255)==0xffffffff);
 return 0;
}
'''
            test = Path(directory)/'probe.c'; test.write_text(harness)
            subprocess.run(['cc','-std=c99','-Wall','-Werror',str(test),'-o',str(test.with_suffix(''))],check=True,capture_output=True)
            subprocess.run([str(test.with_suffix(''))],check=True,capture_output=True)
            bank_header=(Path(directory)/'first/src/data/firered/object_events/all.h').read_text()
            self.assertIn('#include "palette_tags.h"',bank_header)
            self.assertIn('#include "constants/firered_object_anims.h"',bank_header)
            self.assertIn('FR_ANIM_SPIN_SOUTH',(Path(directory)/'first/include/constants/firered_object_anims.h').read_text())
            objects = (Path(directory)/'first/src/event_object_movement.c').read_text()
            self.assertIn('VarGet(FR_VAR_OBJ_GFX_ID_0 + graphicsId - 240)',objects)
            self.assertIn('object->mapGroup, object->localId',objects)
            self.assertIn('localId == LOCALID_PLAYER ? sWholeGamePlayerGraphicsBank',objects)
            self.assertIn('FR_gObjectEventGraphicsInfoPointers[graphicsId]',objects)
            self.assertIn('u8 FR_CreateFameCheckerObject(u8 graphicsId, u8 localId, s16 x, s16 y)',objects)
            self.assertIn('CopyObjectGraphicsInfoToSpriteTemplate(0x100 | graphicsId, SpriteCallbackDummy',objects)
            self.assertIn('void ResetObjectEvents(void)\n{\n    WholeGameSetPlayerGraphicsBank(FALSE);',objects)
            fame_palette = objects.split('void FR_InitFameCheckerObjectPalettes(u8 reflectionType)',1)[1]
            self.assertIn('sWholeGameKantoObjectPaletteTagSets[sCurrentReflectionType]',fame_palette)
            self.assertNotIn('WholeGameObjectPaletteTags(',fame_palette)
            # Compile the emitted bank dispatcher and object-origin helper, including
            # the equal-ID native Bard trap and donor dynamic variable bank.
            getter_start = objects.index('const struct ObjectEventGraphicsInfo *GetObjectEventGraphicsInfo(u16 graphicsId)')
            getter_end = objects.index('static void SetObjectEventDynamicGraphicsId', getter_start)
            token_start = objects.index('EWRAM_DATA static bool8 sWholeGamePlayerGraphicsBank')
            token_end = objects.index('static const struct SpritePalette sObjectEventSpritePalettes[]', token_start)
            bank_harness = """#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint8_t bool8;
#define EWRAM_DATA
#define FALSE 0
#define TRUE 1
#define ARRAY_COUNT(a) (sizeof(a)/sizeof((a)[0]))
#define LOCALID_PLAYER 255
#define FR_VAR_OBJ_GFX_ID_0 0x5010
#define OBJ_EVENT_GFX_VARS 240
#define OBJ_EVENT_GFX_BARD 50
#define NUM_OBJ_EVENT_GFX 239
#define OBJ_EVENT_GFX_NINJA_BOY 1
#define OBJ_EVENT_GFX_FR_LITTLE_BOY 16
struct ObjectEventGraphicsInfo { int identity; };
struct ObjectEvent {u8 graphicsId,mapGroup,localId;};
static struct ObjectEventGraphicsInfo native,donor[152],bard;
static const struct ObjectEventGraphicsInfo *gObjectEventGraphicsInfoPointers[256];
static const struct ObjectEventGraphicsInfo *FR_gObjectEventGraphicsInfoPointers[152];
static const struct ObjectEventGraphicsInfo *gMauvilleOldManGraphicsInfoPointers[1]={&bard};
static u8 GetCurrentMauvilleOldMan(void) {return 0;}
static u8 VarGetObjectEventGraphicsId(u8 i) {assert(i==0);return 20;}
static u16 VarGet(u16 id) {assert(id==0x5010);return 0x114;}
""" + objects[getter_start:getter_end] + objects[token_start:token_end] + """
int main(void) {
 unsigned i; struct ObjectEvent object={20,34,1};
 for(i=0;i<256;i++)gObjectEventGraphicsInfoPointers[i]=&native;
 for(i=0;i<152;i++)FR_gObjectEventGraphicsInfoPointers[i]=&donor[i];
 assert(WholeGameObjectGraphicsInfo(&object)==&donor[20]);
 object.localId=LOCALID_PLAYER;
 assert(WholeGameObjectGraphicsInfo(&object)==&native);
 WholeGameSetPlayerGraphicsBank(TRUE);
 assert(WholeGameObjectGraphicsInfo(&object)==&donor[20]);
 WholeGameSetPlayerGraphicsBank(FALSE);
 assert(WholeGameObjectGraphicsInfo(&object)==&native);
 object.localId=1; object.mapGroup=33;
 assert(WholeGameObjectGraphicsInfo(&object)==&native);
 assert(GetObjectEventGraphicsInfo(0x100|50)==&donor[50]);
 assert(GetObjectEventGraphicsInfo(50)==&bard);
 assert(GetObjectEventGraphicsInfo(0x100|240)==&donor[20]);
 assert(GetObjectEventGraphicsInfo(240)==&native);
 assert(GetObjectEventGraphicsInfo(0x100|152)==&donor[16]);
 return 0;
}
"""
            bank_test = Path(directory)/'bank-probe.c'; bank_test.write_text(bank_harness)
            subprocess.run(['cc','-std=c99','-Wall','-Werror',str(bank_test),'-o',str(bank_test.with_suffix(''))],check=True,capture_output=True)
            subprocess.run([str(bank_test.with_suffix(''))],check=True,capture_output=True)
            self.assertIn('sprite->sVirtualObjGraphicsBank = graphicsId & 0x100',objects)
            self.assertIn('graphicsId | sprite->sVirtualObjGraphicsBank',objects)
            self.assertIn('FR_gObjectEventPal_NpcBlue',objects)
            self.assertIn('FR_sPlayerReflectionPaletteTags',objects)
            tags = (Path(directory)/'first/src/data/firered/object_events/palette_tags.h').read_text()
            self.assertIn('#define FR_OBJ_EVENT_PAL_TAG_NPC_BLUE 0x3103',tags)
            for rel in FILES:
                self.assertEqual((Path(directory)/'first'/rel).read_bytes(),(Path(directory)/'second'/rel).read_bytes())
        self.assertEqual(canonical,{rel:(EMERALD/rel).read_bytes() for rel in FILES})

    def test_reject_canonical_output(self):
        with self.assertRaises(ValueError):
            stage_map_runtime(EMERALD,FIRERED,EMERALD)
        with tempfile.TemporaryDirectory(prefix='whole-game-map-unsafe-stage-') as directory:
            stage = Path(directory)
            (stage/'include').mkdir()
            (stage/'include/global.fieldmap.h').symlink_to(EMERALD/'include/global.fieldmap.h')
            with self.assertRaisesRegex(ValueError, 'canonical source'):
                stage_map_runtime(EMERALD,FIRERED,stage)


if __name__ == '__main__': unittest.main()
