"""Focused native C movement contracts, without a ROM build or emulator."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from .field_movement import stage_field_movement
from .native_services import functions

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'
FILES = ['src/event_object_movement.c','src/data/object_events/movement_action_func_tables.h',
         'src/data/object_events/object_event_anims.h','src/field_player_avatar.c','src/bike.c',
         'src/field_control_avatar.c','src/field_screen_effect.c','include/global.fieldmap.h',
         'include/constants/event_object_movement.h','data/field_effect_scripts.s']

@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local source inputs unavailable')
class FieldMovementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.temp.name)
        cls.original = {}
        for rel in FILES:
            cls.original[rel] = (BASE / rel).read_bytes()
            (cls.out / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BASE / rel, cls.out / rel)
        cls.ledger = stage_field_movement(BASE,DONOR,cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_isolation_and_native_dispatch(self):
        for rel,data in self.original.items():
            self.assertEqual((BASE/rel).read_bytes(),data)
        with self.assertRaises(ValueError):
            stage_field_movement(BASE,DONOR,BASE)
        text=(self.out/'src/field_player_avatar.c').read_text()
        self.assertIn('!WGFR_TryUpdatePlayerSpinDirection()',text)
        self.assertIn('WGFR_PlayerApplyTileForcedMovement(gPlayerAvatar.wholeGameLastSpinTile)',text)
        self.assertIn('WGFR_COLLISION_DIRECTIONAL_STAIR_WARP',text)
        header=(self.out/'include/global.fieldmap.h').read_text()
        a=header.index('struct PlayerAvatar\n{'); b=header.index('};',a)
        self.assertTrue(header[a:b].rstrip().endswith('u8 wholeGameLastSpinTile;'))
        control=(self.out/'src/field_control_avatar.c').read_text()
        self.assertIn('FR_TryStandardWildEncounterAtPlayer()',control)
        self.assertIn('FR_ResetEncounterRateModifiers()',control)
        self.assertIn('FlagClear(WGFR_GetBoulderRevealFlagByLocalIdAndMap(',control)
        self.assertNotIn('WGFR_TranslateBoulderFlag',control)
        screen=(self.out/'src/field_screen_effect.c').read_text()
        self.assertIn('IsWeatherNotFadingIn() == TRUE && FR_ForestMapPreviewScreenIsRunning()',screen)
        self.assertIn('FR_gExitStairsMovementDisabled = FALSE;',screen)
        self.assertFalse(self.ledger['semantic_coverage_complete'])

    def test_unique_action_ids_and_native_animation(self):
        values=list(self.ledger['action_id_map'].values())
        self.assertEqual(len(values),21)
        self.assertEqual(len(set(values)),21)
        self.assertTrue(all(157 < v < 254 for v in values))
        tables=(self.out/'src/data/object_events/movement_action_func_tables.h').read_text()
        self.assertIn('[FR_MOVEMENT_ACTION_WALK_SLOWER_DOWN] = wgfrActionWalkSlowerDown',tables)
        self.assertIn('[FR_MOVEMENT_ACTION_PLAYER_RUN_RIGHT_SLOW] = wgfrActionRunRightSlow',tables)
        anims=(self.out/'src/data/object_events/object_event_anims.h').read_text()
        self.assertIn('[24] = wgfrAnimSpinSouth',anims)
        self.assertIn('ANIMCMD_LOOP(1)',anims)

    @unittest.skipUnless(shutil.which('clang'), 'host clang unavailable')
    def test_compiled_native_vs_responses_and_emote_lifecycle(self):
        obj=(self.out/'src/event_object_movement.c').read_text()
        icons=(self.out/'src/firered_native/movement_icons.c').read_text()
        index={f.name:f.source for text in (obj,icons) for f in functions(text,'')}
        names=['WGFR_MovementAction_RaiseHand_Step0','WGFR_MovementAction_RaiseHandAndStop_Step1',
               'WGFR_MovementAction_RaiseHandAndJump_Step1','WGFR_MovementAction_RaiseHandAndSwim_Step1',
               'WGFR_FldEff_XIcon','WGFR_FldEff_DoubleExclMarkIcon','WGFR_SetIconSpriteData','WGFR_SpriteCB_TrainerIcons']
        bodies=[index[n] for n in names]
        sine=re.search(r'const s16 gSineTable\[\]\s*=\s*\{.*?\};',(BASE/'src/trig.c').read_text(),re.S)[0]
        src=r"""
#include <stdint.h>
#include <assert.h>
#include <string.h>
typedef uint8_t u8;typedef uint16_t u16;typedef int16_t s16;typedef uint8_t bool8;
#define TRUE 1
#define FALSE 0
#define ANIM_STD_FACE_SOUTH 0
#define Q_8_8(n) ((s16)((n)*256))
#define MAX_SPRITES 64
#define FR_FLDEFF_X_ICON 67
#define FR_FLDEFF_DOUBLE_EXCL_MARK_ICON 68
struct ObjectEvent {u8 disableAnim,singleMovementActive,spriteId;};
struct Sprite {s16 data[8],x,y,x2,y2;u8 animPaused,animEnded,coordOffsetEnabled,animNum;struct {u8 priority;} oam;};
struct SpriteTemplate {int unused;};
static const struct SpriteTemplate wgfr_sSpriteTemplate_Emoticons={0};
struct ObjectEvent gObjectEvents[1];struct Sprite gSprites[2];int gFieldEffectArguments[3]={4,5,6};
static int stopped,missing,createdAnim,createdPriority;
static u8 CreateSpriteAtEnd(const struct SpriteTemplate *t,int x,int y,u8 priority){createdPriority=priority;return 0;}
static void StartSpriteAnim(struct Sprite *s,u8 n){s->animNum=n;createdAnim=n;}
static bool8 TryGetObjectEventIdByLocalIdAndMap(int id,int map,int group,u8 *result){assert(id==4&&map==5&&group==6);*result=0;return missing;}
static void FieldEffectStop(struct Sprite *s,u8 id){stopped=id;}
"""
        src+=sine+'\n'+'\n'.join(b.split('{',1)[0].strip()+';' for b in bodies)+'\n'+'\n'.join(bodies)
        src+=r"""
int main(void){struct ObjectEvent o={0};struct Sprite s={0};int frames;
 assert(!WGFR_MovementAction_RaiseHand_Step0(&o,&s));assert(s.data[2]==1&&s.animNum==20);
 assert(!WGFR_MovementAction_RaiseHandAndStop_Step1(&o,&s));s.animEnded=1;assert(WGFR_MovementAction_RaiseHandAndStop_Step1(&o,&s));
 WGFR_MovementAction_RaiseHand_Step0(&o,&s);
 for(frames=1;frames<200;frames++)if(WGFR_MovementAction_RaiseHandAndJump_Step1(&o,&s))break;
 assert(frames==124&&s.y2==0&&!o.singleMovementActive);
 WGFR_MovementAction_RaiseHand_Step0(&o,&s);
 for(frames=1;frames<64;frames++)assert(!WGFR_MovementAction_RaiseHandAndSwim_Step1(&o,&s));
 assert(WGFR_MovementAction_RaiseHandAndSwim_Step1(&o,&s)&&s.x2==0);
 gObjectEvents[0].spriteId=1;gSprites[1].x=80;gSprites[1].y=100;gSprites[1].x2=2;gSprites[1].y2=3;
 assert(WGFR_FldEff_XIcon()==0&&createdAnim==2&&createdPriority==0x52);
 assert(gSprites[0].data[0]==4&&gSprites[0].data[1]==5&&gSprites[0].data[2]==6&&gSprites[0].data[7]==67);
 WGFR_SpriteCB_TrainerIcons(&gSprites[0]);assert(gSprites[0].x==80&&gSprites[0].y==84&&gSprites[0].x2==2&&gSprites[0].y2==-2);
 gSprites[0].animEnded=1;WGFR_SpriteCB_TrainerIcons(&gSprites[0]);assert(stopped==67);
 memset(&gSprites[0],0,sizeof(gSprites[0]));WGFR_FldEff_DoubleExclMarkIcon();assert(createdAnim==1&&gSprites[0].data[7]==68);
 missing=1;WGFR_SpriteCB_TrainerIcons(&gSprites[0]);assert(stopped==68);
 return 0;}
"""
        source=self.out/'vs-movement-harness.c';source.write_text(src);binary=self.out/'vs-movement-harness'
        build=subprocess.run(['clang','-std=c99','-Werror',str(source),'-o',str(binary)],capture_output=True,text=True)
        self.assertEqual(build.returncode,0,build.stderr)
        run=subprocess.run([str(binary)],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        header=(self.out/'include/constants/whole_game_fr_movement.h').read_text()
        self.assertIn('#define FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER 84',header)
        self.assertIn('#define FR_MOVEMENT_ACTION_EMOTE_X 177',header)
        self.assertIn('[FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER] = TRUE',obj)
        self.assertIn('WGFR_MovementType_WanderAround_Step5Slower',obj)

    @unittest.skipUnless(shutil.which('clang'), 'host clang unavailable')
    def test_compiled_native_spinner_cycling_and_stair_contracts(self):
        start=time.monotonic()
        field=(self.out/'src/field_player_avatar.c').read_text()
        bike=(self.out/'src/bike.c').read_text()
        stairs=(self.out/'src/field_screen_effect.c').read_text()
        control=(self.out/'src/field_control_avatar.c').read_text()
        obj=(self.out/'src/event_object_movement.c').read_text()
        def selected(source,names):
            index={f.name:f.source for f in functions(source,'')}
            rows=[index[n] for n in names]
            return '\n'.join(r[:r.index('{')].strip()+';' for r in rows)+'\n'+'\n'.join(rows)
        predicates=(DONOR/'src/metatile_behavior.c').read_text()
        predicates=re.sub(r'^#include[^\n]*\n','',predicates,flags=re.M)
        predicates=re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],predicates)
        # Native complete predicate TU needs its own forward declarations.
        protos='\n'.join(f.source[:f.source.index('{')].strip()+';' for f in functions(predicates,''))
        src='''#include <assert.h>
#include <stddef.h>
#include <stdint.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32;
typedef int16_t s16; typedef int32_t s32; typedef uint8_t bool8; typedef uint32_t bool32;
#define TRUE 1
#define FALSE 0
#define DIR_NONE 0
#define DIR_SOUTH 1
#define DIR_NORTH 2
#define DIR_WEST 3
#define DIR_EAST 4
#define PLAYER_AVATAR_FLAG_FORCED_MOVE 64
#define PLAYER_AVATAR_FLAG_CONTROLLABLE 32
#define B_BUTTON 2
#define JOY_HELD(k) (heldKeys & (k))
#define MOVING 2
#define NOT_MOVING 0
#define TURN_DIRECTION 1
#define BIKE_STATE_NORMAL 0
#define BIKE_STATE_TURNING 1
#define BIKE_STATE_SLOPE 2
#define BIKE_TRANS_FACE_DIRECTION 0
#define BIKE_TRANS_TURNING 1
#define BIKE_TRANS_MOVE 2
#define BIKE_TRANS_DOWNHILL 3
#define BIKE_TRANS_UPHILL 4
struct ObjectEvent {u8 currentMetatileBehavior, heldMovementFinished;};
struct Sprite {s16 data[8], x2, y2;};
struct {u8 flags,wholeGameLastSpinTile,objectEventId,acroBikeState,bikeFrameCounter,runningState,newDirBackup;} gPlayerAvatar;
struct ObjectEvent gObjectEvents[1], *wgfrPlayerObjectPtr;
static int applied, cleared, directionNow=1;
static void ObjectEventClearHeldMovement(struct ObjectEvent *o) {cleared++;}
static void WGFR_PlayerApplyTileForcedMovement(u8 b) {applied=b;}
static u8 GetPlayerMovementDirection(void) {return directionNow;}
static void WGFR_Bike_SetBikeStill(void) {}
static void Step1(struct Sprite *s,u8 d) {s->x2++;}
static void Step2(struct Sprite *s,u8 d) {s->x2+=2;}
'''
        src+=(DONOR/'include/constants/metatile_behaviors.h').read_text()+'\n'+protos+'\n'+predicates
        src+=selected(field,['WGFR_TryUpdatePlayerSpinDirection'])
        src+=selected(control,['WGFR_IsDirectionalStairWarpMetatileBehavior'])
        src+=selected(stairs,['WGFR_GetStairsMovementDirection'])
        names=['WGFR_GetBikeTransitionId','WGFR_BikeInputHandler_Normal','WGFR_BikeInputHandler_Turning','WGFR_BikeInputHandler_Slope']
        index={f.name:f.source for f in functions(bike,'')}
        rows=[index[n] for n in names]
        src+='\n'+'\n'.join(r[:r.index('{')].strip()+';' for r in rows)
        src+='\nstatic u8 (*const wgfrBikeInputHandlers[])(u8 *, u16, u16) = {WGFR_BikeInputHandler_Normal,WGFR_BikeInputHandler_Turning,WGFR_BikeInputHandler_Slope};\n'+'\n'.join(rows)
        src+=selected(obj,['WGFR_SetWalkSlowerSpriteData','WGFR_UpdateWalkSlowerAnim','WGFR_SetRunSlowSpriteData','WGFR_UpdateRunSlowAnim','WGFR_SetWalkSlowSpriteData','WGFR_UpdateWalkSlowAnim'])
        src+='''
int main(void) {
 u8 d; s16 x,y; int i; struct Sprite sprite={0};
 gPlayerAvatar.flags=64; gPlayerAvatar.wholeGameLastSpinTile=MB_SPIN_RIGHT;
 gObjectEvents[0].currentMetatileBehavior=MB_NORMAL;
 assert(WGFR_TryUpdatePlayerSpinDirection()==1 && cleared==0);
 gObjectEvents[0].heldMovementFinished=1;
 assert(WGFR_TryUpdatePlayerSpinDirection()==1 && applied==MB_SPIN_RIGHT);
 gObjectEvents[0].currentMetatileBehavior=MB_SPIN_UP;
 assert(WGFR_TryUpdatePlayerSpinDirection()==1 && applied==MB_SPIN_UP);
 gObjectEvents[0].currentMetatileBehavior=MB_STOP_SPINNING; i=cleared;
 assert(WGFR_TryUpdatePlayerSpinDirection()==0 && cleared==i);
 for (i=0;i<256;i++) {int direction; for(direction=0;direction<5;direction++)
 assert(WGFR_IsDirectionalStairWarpMetatileBehavior(i,direction)==((direction==DIR_WEST&&(i==MB_UP_LEFT_STAIR_WARP||i==MB_DOWN_LEFT_STAIR_WARP))||(direction==DIR_EAST&&(i==MB_UP_RIGHT_STAIR_WARP||i==MB_DOWN_RIGHT_STAIR_WARP))));}
 WGFR_GetStairsMovementDirection(MB_UP_RIGHT_STAIR_WARP,&x,&y); assert(x==16&&y==-10);
 WGFR_GetStairsMovementDirection(MB_DOWN_LEFT_STAIR_WARP,&x,&y); assert(x==-17&&y==3);
 gObjectEvents[0].currentMetatileBehavior=MB_CYCLING_ROAD_PULL_DOWN;
 d=DIR_NONE; assert(WGFR_BikeInputHandler_Normal(&d,0,0)==BIKE_TRANS_DOWNHILL);
 assert(gPlayerAvatar.acroBikeState==BIKE_STATE_SLOPE);
 d=DIR_NORTH; assert(WGFR_BikeInputHandler_Normal(&d,0,0)==BIKE_TRANS_UPHILL);
 d=DIR_NONE; assert(WGFR_BikeInputHandler_Normal(&d,0,B_BUTTON)==BIKE_TRANS_FACE_DIRECTION);
 WGFR_SetWalkSlowerSpriteData(&sprite,DIR_SOUTH);
 for(i=0;i<30;i++) assert(WGFR_UpdateWalkSlowerAnim(&sprite)==0);
 assert(WGFR_UpdateWalkSlowerAnim(&sprite)==1 && sprite.x2==16);
 sprite.x2=0; WGFR_SetRunSlowSpriteData(&sprite,DIR_SOUTH);
 for(i=0;i<10;i++) assert(WGFR_UpdateRunSlowAnim(&sprite)==0);
 assert(WGFR_UpdateRunSlowAnim(&sprite)==1 && sprite.x2==16);
 sprite.x2=0; WGFR_SetWalkSlowSpriteData(&sprite,DIR_SOUTH);
 for(i=0;i<22;i++) assert(WGFR_UpdateWalkSlowAnim(&sprite)==0);
 assert(WGFR_UpdateWalkSlowAnim(&sprite)==1 && sprite.x2==16);
 return 0;
}
'''
        source=self.out/'movement-harness.c'; source.write_text(src)
        executable=self.out/'movement-harness'
        build=subprocess.run(['clang','-std=c99','-Werror',str(source),'-o',str(executable)],capture_output=True,text=True)
        self.assertEqual(build.returncode,0,build.stderr)
        run=subprocess.run([str(executable)],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        self.duration=time.monotonic()-start

if __name__=='__main__': unittest.main()
