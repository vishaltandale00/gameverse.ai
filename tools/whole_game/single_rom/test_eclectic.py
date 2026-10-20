"""Cheap host policy witness with native services replaced by observable doubles.

This executes exact foreign IR and authored hooks, never a native-game claim.
"""
import json,re,shutil,subprocess,tempfile,unittest
from pathlib import Path
from tools.prefab_pipeline.eclectic_strategy import generate_eclectic_source
from tools.whole_game.single_rom.eclectic import HOST,ROOT,POLICY,RECIPE_ID,sha,stage_eclectic

class EclecticPolicyTests(unittest.TestCase):
 def test_explicit_request_and_stage_pin(self):
  request=json.loads((ROOT/'tools/prefab_pipeline/requests/pokemon-eclectic.json').read_text())
  self.assertEqual(request['recipe'],RECIPE_ID)
  self.assertEqual(request['policy'],POLICY)
  self.assertEqual(request['stage_sha256'],sha(ROOT/'tools/whole_game/single_rom/eclectic.py'))
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaisesRegex(ValueError,'explicit recipe'):
    stage_eclectic(ROOT/'local/decomps/pokeemerald',ROOT/'local/decomps/pokefirered',Path(d)/'output',d)
 def test_rally_policy_against_exact_source_algorithms(self):
  cc=shutil.which('cc')
  if not cc:self.skipTest('host compiler unavailable')
  source,_,_=generate_eclectic_source()
  host=re.sub(r'^#include.*$','',HOST,flags=re.M)
  prelude=r'''
#include <stdint.h>
#include <string.h>
#include <assert.h>
#include "constants/battle.h"
#include "constants/flags.h"
#include "constants/songs.h"
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef int32_t s32; typedef int16_t s16; typedef u8 bool8;
#define _(x) x
#define EWRAM_DATA
#define TRUE 1
#define FALSE 0
#define L_BUTTON 0x200
#define STR_CONV_MODE_LEFT_ALIGN 0
#define FR_FLAG_BADGE01_GET 0x1020
#define FR_FLAG_BADGE04_GET 0x1023
struct {u16 hp,maxHP;u32 status2;} gBattleMons[4];
struct {u8 power;} gBattleMoves[512];
u8 gBattlerAttacker,gBattlerTarget;u16 gCurrentMove;u32 gHitMarker,gMoveResultFlags,gBattleTypeFlags;
struct {u16 heldKeys;} gMain;
u8 gStringVar1[16],gStringVar2[16],gStringVar4[1024];
static unsigned feedback,move_calls;static u8 native_flags[65536];
static u8 GetBattlerSide(u8 b){return b&1;}
static u8 FlagGet(u16 f){return native_flags[f];}
static void PlayerWalkNormal(u8 d){(void)d;move_calls++;}
static void PlayerWalkFast(u8 d){(void)d;move_calls++;}
static void PlayerRideWaterCurrent(u8 d){(void)d;move_calls++;}
static void StringCopy(u8 *d,const u8*s){strcpy((char*)d,(const char*)s);}
static void ConvertIntToDecimalStringN(u8*d,unsigned n,unsigned a,unsigned b){(void)n;(void)a;(void)b;d[0]=0;}
static void StringExpandPlaceholders(u8*d,const u8*s){StringCopy(d,s);}
static void BattlePutTextOnWindow(const u8*t,u8 w){(void)t;(void)w;feedback++;}
static void PlaySE(unsigned s){(void)s;}
'''
  harness=r'''
static void fresh(void){
 memset(native_flags,0,sizeof(native_flags));memset(gBattleMons,0,sizeof(gBattleMons));
 sRally=0;WholeGameEclecticResetMotion();gBattlerAttacker=0;gBattlerTarget=1;
 gBattleMons[0].hp=80;gBattleMons[0].maxHP=80;gBattleMons[1].hp=80;gBattleMons[1].maxHP=80;
 gCurrentMove=1;gBattleMoves[1].power=40;gHitMarker=0;gMoveResultFlags=0;gBattleTypeFlags=0;feedback=0;
}
int main(void){unsigned i;u16 before;
 fresh();for(i=0;i<8;i++){WholeGameEclecticBikeStep(1);WholeGameEclecticEarnTile();}
 assert(sRally==5);assert(sRallyRacer.speed_q16==0x30000);
 before=sRally;assert(WholeGameEclecticBikeStep(2)==1);WholeGameEclecticEarnTile();assert(sRally==before);
 WholeGameEclecticBikeStep(1);assert(sRallyRacer.speed_q16==0); /* signed clamp, never wrap to fast */
 assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==before); /* no badges */
 native_flags[FLAG_BADGE01_GET]=1;assert(WholeGameEclecticDamage(1,10)==15);assert(sRally==0);assert(feedback==1);
 sRally=64;gBattleMons[0].hp=713;gBattleMons[0].maxHP=714;assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==64);
 gBattleMons[0].hp=714;assert(WholeGameEclecticDamage(1,10)==18);assert(sRally==56);
 gBattleTypeFlags=BATTLE_TYPE_LINK;before=sRally;assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==before);
 gBattleTypeFlags=0;gHitMarker=HITMARKER_PASSIVE_HP_UPDATE;assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==before);
 gHitMarker=0;gMoveResultFlags=MOVE_RESULT_FOE_ENDURED;assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==before);
 gMoveResultFlags=0;gBattleMoves[1].power=1;assert(WholeGameEclecticDamage(1,10)==10);assert(sRally==before);
 fresh();native_flags[FR_FLAG_BADGE04_GET]=1;sRally=64;gBattlerAttacker=1;gBattlerTarget=0;gBattleMons[0].hp=10;
 assert(WholeGameEclecticDamage(0,20)==4);assert(sRally==48);assert(feedback==1);
 gBattleMons[0].hp=11;assert(WholeGameEclecticDamage(0,20)==20);assert(sRally==48);
 gBattleMons[0].hp=10;sRally=5;assert(WholeGameEclecticDamage(0,20)==15);assert(sRally==0);
 sRally=64;WholeGameEclecticResetMotion();assert(sRally==64); /* transport/stop resets motion only */
 for(i=0;i<100;i++){WholeGameEclecticBikeStep(1);WholeGameEclecticEarnTile();}assert(sRally==64);
 return 0;
}
'''
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'policy.c';path.write_text(source+prelude+host+harness);binary=Path(d)/'policy'
   built=subprocess.run([cc,'-std=c89','-Werror=declaration-after-statement','-I',str(ROOT/'local/decomps/pokeemerald/include'),str(path),'-o',str(binary)],capture_output=True,text=True)
   self.assertEqual(built.returncode,0,built.stderr)
   executed=subprocess.run([str(binary)],capture_output=True,text=True)
   self.assertEqual(executed.returncode,0,executed.stderr)

if __name__=='__main__':unittest.main()
