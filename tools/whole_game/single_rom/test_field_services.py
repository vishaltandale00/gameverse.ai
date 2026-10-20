"""Source-native field task lifecycle checks; no ROM campaign."""
from pathlib import Path
import hashlib
import shutil
import subprocess
import tempfile
import unittest
from .field_movement import stage_field_movement
from .field_services import ROOTS, stage_field_services
from .test_field_movement import BASE, DONOR, FILES

@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local donor inputs unavailable')
class FieldServicesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.out=Path(cls.temp.name)
        cls.original={}
        for rel in FILES+['src/field_tasks.c','src/field_camera.c','src/overworld.c']:
            cls.original[rel]=(BASE/rel).read_bytes()
            target=cls.out/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(cls.original[rel])
        stage_field_movement(BASE,DONOR,cls.out)
        cls.ledger=stage_field_services(BASE,DONOR,cls.out)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def test_source_closure_and_isolation(self):
        self.assertEqual(set(self.ledger['symbolMap']),set(ROOTS))
        for rel,data in self.original.items():self.assertEqual((BASE/rel).read_bytes(),data)
        for asset in self.ledger['assets']:
            self.assertEqual(hashlib.sha256((self.out/asset['staged']).read_bytes()).hexdigest(),asset['sourceSha256'])
        self.assertEqual(len(self.ledger['assets']),9)
        self.assertEqual(list(self.ledger['nativeMovementActions'].values()),[179,180,181,182])
        fall=(self.out/'src/firered_native/field_fall.c').read_text()
        self.assertIn('landingJump = TRUE',fall)
        self.assertIn('FR_SetHelpContext(22)',fall)
        boat=(self.out/'src/firered_native/field_seagallop.c').read_text()
        self.assertIn('FR_GetTextWindowPalette(2)',boat)
        self.assertIn('MAP_FR_VERMILION_CITY',boat)
        self.assertIn('FR_HelpSystem_Enable()',boat)
        self.assertFalse(self.ledger['semantic_coverage_complete'])
        with self.assertRaises(ValueError):stage_field_services(BASE,DONOR,BASE)

    @unittest.skipUnless(shutil.which('clang'), 'host compiler unavailable')
    def test_native_teleporter_and_ice_task_lifecycles(self):
        # Compile the emitted original task bodies. Doubles expose observable
        # tile writes, delay boundaries, cleanup and banked flag/var effects.
        sources=[]
        for rel in ['field_teleporter.c','field_icefall.c']:
            sources.append('\n'.join(line for line in (self.out/'src/firered_native'/rel).read_text().splitlines() if not line.startswith('#include')))
        pre=r'''
#include <assert.h>
#include <string.h>
typedef unsigned char u8;typedef unsigned short u16;typedef short s16;typedef int s32;typedef unsigned char bool8;
#define TRUE 1
#define FALSE 0
#define MAPGRID_COLLISION_MASK 0xC00
#define MAP_OFFSET 7
#define ARRAY_COUNT(a) (sizeof(a)/sizeof((a)[0]))
#define FR_VAR_TEMP_1 0x5001
#define FR_SE_ICE_CRACK 1
#define FR_SE_ICE_BREAK 2
struct Task {void (*func)(u8);s16 data[16];} gTasks[1];
u16 gSpecialVar_0x8004;static s16 px=100,py=100;static int active,draws,writes,lastx,lasty,lasttile,behavior,flag,var;
u8 CreateTask(void (*f)(u8),u8 p){(void)p;memset(gTasks,0,sizeof(gTasks));gTasks[0].func=f;active=1;return 0;}
void DestroyTask(u8 id){(void)id;active=0;}
void PlayerGetDestCoords(s16 *x,s16 *y){*x=px;*y=py;}
void MapGridSetMetatileIdAt(s16 x,s16 y,u16 tile){lastx=x;lasty=y;lasttile=tile;writes++;}
void CurrentMapDrawMetatileAt(s16 x,s16 y){(void)x;(void)y;draws++;}
u8 MapGridGetMetatileBehaviorAt(s16 x,s16 y){(void)x;(void)y;return behavior;}
bool8 WGFR_MetatileBehavior_IsThinIce(u8 b){return b==1;}
bool8 WGFR_MetatileBehavior_IsCrackedIce(u8 b){return b==2;}
void FlagSet(u16 n){flag=n;}bool8 FlagGet(u16 n){return flag==n;}
void VarSet(u16 n,u16 value){assert(value==1);var=n;}
void PlaySE(u16 se){(void)se;}
'''
        main=r'''
int main(void){int i;
FR_AnimateTeleporterHousing();assert(gTasks[0].data[2]==106 && gTasks[0].data[3]==95);
for(i=0;i<207;i++)gTasks[0].func(0);assert(active);gTasks[0].func(0);assert(!active && draws==28 && writes==28);
assert(lasttile==(WGFS_METATILE_SeaCottage_Teleporter_Door|MAPGRID_COLLISION_MASK));
gSpecialVar_0x8004=1;FR_AnimateTeleporterHousing();assert(gTasks[0].data[2]==99);
FR_AnimateTeleporterCable();for(i=0;i<16;i++)gTasks[0].func(0);assert(active);gTasks[0].func(0);assert(!active && lastx==101);
memset(gTasks,0,sizeof(gTasks));px=14;py=10;FR_IcefallCaveIcePerStepCallback(0);px=15;behavior=1;
FR_IcefallCaveIcePerStepCallback(0);assert(flag==0x1001);writes=0;
for(i=0;i<4;i++)FR_IcefallCaveIcePerStepCallback(0);assert(!writes);FR_IcefallCaveIcePerStepCallback(0);
assert(writes==1 && lasttile==WGFS_METATILE_SeafoamIslands_CrackedIce);
px=16;behavior=2;FR_IcefallCaveIcePerStepCallback(0);for(i=0;i<5;i++)FR_IcefallCaveIcePerStepCallback(0);
assert(var==0x5001 && lasttile==WGFS_METATILE_SeafoamIslands_IceHole);
return 0;}
'''
        c=self.out/'tasks.c';c.write_text(pre+'\n'.join(sources)+main)
        subprocess.run(['clang','-std=c99','-Werror','-Wno-unused-function',str(c),'-o',str(self.out/'tasks')],check=True,capture_output=True)
        subprocess.run([str(self.out/'tasks')],check=True,capture_output=True)
