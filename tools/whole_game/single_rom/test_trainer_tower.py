"""Focused source composition and actual Tower lifecycle C fixtures."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from .trainer_tower import stage_trainer_tower
from .encounters import source_function,body

ROOT=Path(__file__).resolve().parents[3]
E=ROOT/'local/decomps/pokeemerald';F=ROOT/'local/decomps/pokefirered'
METRICS={}

class TowerTests(unittest.TestCase):
    def test_canonical_output_rejected(self):
        with self.assertRaises(ValueError):stage_trainer_tower(E,F,E)

    @unittest.skipUnless(E.exists() and F.exists(),'canonical sources unavailable')
    def test_complete_source_and_actual_lifecycle(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);out=root/'a'
            result=stage_trainer_tower(E,F,out)
            METRICS['transform_seconds']=result['transform_wall_seconds']
            self.assertEqual(result['counts']['source_floor_definitions'],32)
            self.assertEqual(result['counts']['dispatcher_functions'],21)
            self.assertTrue(result['build_ready'])
            code=(out/'src/firered_trainer_tower.c').read_text()
            data=(out/'src/firered_trainer_tower_sets.c').read_text()
            self.assertNotIn('BATTLE_TYPE_TRAINER_TOWER',code)
            self.assertIn('sFRTowerBattle = TRUE',code)
            self.assertIn('u16 objGfx;',code)
            self.assertIn('WholeGameFR_GetTrainerTowerRecords()',code)
            self.assertIn('return FALSE;',source_function(code,'FR_ReadTrainerTowerAndValidate'))
            self.assertIn('FR_TRAINER_PIC_',code)
            self.assertNotIn('gSaveBlock1Ptr->trainerTower',code)
            self.assertEqual(data.count('static const struct FR_TrainerTowerFloor'),32)
            self.assertIn('FR_BattleScript_TrainerTowerLost',(out/'src/battle_main.c').read_text())
            self.assertIn('FR_GetTrainerTowerOpponentLoseText(gStringVar4, 1)',(out/'src/battle_message.c').read_text())
            self.assertIn('FR_InitTrainerTowerBattleStruct();',(out/'src/battle_util2.c').read_text())
            self.assertNotIn('\tgetbattlersforrecall',(out/'data/whole_game_trainer_tower_battle.inc').read_text())
            self.assertIn('returnopponentmon1toball BS_ATTACKER',(out/'data/whole_game_trainer_tower_battle.inc').read_text())
            self.assertNotIn('giveprizemoney',(out/'data/whole_game_trainer_tower_battle.inc').read_text())
            other=root/'b';again=stage_trainer_tower(E,F,other)
            METRICS['comparable_repeat_transform_seconds']=again['transform_wall_seconds']
            hashes=lambda d:{str(p.relative_to(d)):hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob('*') if p.is_file()}
            self.assertEqual(hashes(out),hashes(other))
            with self.assertRaises(ValueError):stage_trainer_tower(E,F,out)
            if not shutil.which('cc'):return
            harness=r'''#include <stdint.h>
#include <assert.h>
#include <string.h>
typedef uint8_t u8; typedef uint8_t bool8; typedef uint16_t u16; typedef uint32_t u32; typedef int32_t s32;
#define TRUE 1
#define FALSE 0
#define PARTY_SIZE 6
#define SPECIES_NONE 0
#define SPECIES_EGG 412
#define MON_DATA_SPECIES 1
#define MON_DATA_SPECIES_OR_EGG 2
#define MON_DATA_LEVEL 3
#define FR_MAX_TRAINER_TOWER_FLOORS 8
#define FR_CHALLENGE_TYPE_SINGLE 0
#define FR_CHALLENGE_TYPE_DOUBLE 1
#define FR_CHALLENGE_TYPE_KNOCKOUT 2
#define FR_CHALLENGE_STATUS_LOST 0
#define FR_CHALLENGE_STATUS_UNK 1
#define FR_CHALLENGE_STATUS_NORMAL 2
struct FR_TrainerTower {u32 timer,bestTime;u8 floorsCleared,unk9;bool8 receivedPrize:1,checkedFinalTime:1,spokeToOwner:1,hasLost:1,unkA_4:1,validated:1;};
struct BattleTowerPokemon {u16 species;u8 level;};
struct Pokemon {u16 species;u8 level;};
struct Trainer {struct BattleTowerPokemon mons[6];};
struct Floor {u8 challengeType,prize;struct Trainer trainers[3];};
struct State {u8 floorIdx;struct {struct Floor floors[8];}data;} state;
static struct State *sTrainerTowerState=&state;
static struct FR_TrainerTower records[4];static u32 challenge;
static struct FR_TrainerTower *WholeGameFR_GetTrainerTowerRecords(void){return records;}
static u32 *WholeGameFR_GetTowerChallengeIdPtr(void){return &challenge;}
#define TRAINER_TOWER WholeGameFR_GetTrainerTowerRecords()[(*WholeGameFR_GetTowerChallengeIdPtr())]
#define CURR_FLOOR sTrainerTowerState->data.floors[sTrainerTowerState->floorIdx]
static struct Pokemon gPlayerParty[6],gEnemyParty[6];
static u16 trainerIndex,gSpecialVar_Result;
#define FR_VAR_TEMP_1 1
static u16 VarGet(u16 n){return trainerIndex;}
static u32 GetMonData(struct Pokemon *m,u8 field,void *unused){return field==MON_DATA_LEVEL?m->level:m->species;}
static void ZeroEnemyPartyMons(void){memset(gEnemyParty,0,sizeof(gEnemyParty));}
static void CreateBattleTowerMon(struct Pokemon *m,struct BattleTowerPokemon *src){m->species=src->species;m->level=src->level;}
static struct {u32 encryptionKey;} saved2={0x12345678};
#define gSaveBlock2Ptr (&saved2)
static u8 sFRTowerTimerIndex=255;
static u8 gStringVar2[20];static int bagSpace,bagCalls;
static const u16 sPrizeList[]={1,2,3};
static bool8 AddBagItem(u16 item,u16 count){bagCalls++;return bagSpace;}
static void CopyItemName(u16 item,u8 *dest){dest[0]=item;}
'''
            for name in ('sSingleBattleChallengeMonIdxs','sDoubleBattleChallengeMonIdxs','sKnockoutChallengeMonIdxs'):
                harness+='static const u8 '+name+'[8]['+('3' if 'Knockout' in name else '2')+']={'+body(code,name)+'};\n'
            funcs=('GetPartyMaxLevel','GetTrainerTowerRecordTime','SetTrainerTowerRecordTime','BuildEnemyParty','GiveChallengePrize','CheckFinalTime','GetOwnerState','TrainerTowerSetPlayerLost','GetTrainerTowerChallengeStatus','FR_SetTowerTimer','FR_DisableTowerTimer','FR_TrainerTowerVBlank')
            # Owner state calls the timer-stop service declared before source use.
            harness+='void FR_DisableTowerTimer(void);\n'
            for name in funcs:harness+=source_function(code,name)+'\n'
            commands=(out/'src/battle_script_commands.c').read_text()
            recall=commands[commands.index('    case VARIOUS_FR_TOWER_GET_BATTLERS_FOR_RECALL:'):commands.index('    case VARIOUS_RETURN_OPPONENT_MON1:')]
            harness+='''\n#define VARIOUS_FR_TOWER_GET_BATTLERS_FOR_RECALL 27
#define MULTISTRING_CHOOSER 0
#define MAX_BATTLERS_COUNT 4
static u8 gBattleCommunication[8],gActiveBattler,gBattlersCount;
static struct {u16 hp;}gBattleMons[4];
static const u32 gBitTable[]={1,2};
static void RecallCase(void){s32 i;switch(27){\n'''+recall+'}}\n'
            harness+=r'''int main(void){
int floor,type,t,i;
for(i=0;i<4;i++){gBattlersCount=4;gBattleMons[1].hp=(i&1)?1:0;gBattleMons[3].hp=(i&2)?1:0;RecallCase();assert(gBattleCommunication[0]==i);}
gBattlersCount=2;gBattleMons[1].hp=1;gBattleMons[3].hp=1;RecallCase();assert(gBattleCommunication[0]==1);
assert(sizeof(struct FR_TrainerTower)==12);
gPlayerParty[0].species=1;gPlayerParty[0].level=12;
gPlayerParty[1].species=SPECIES_EGG;gPlayerParty[1].level=100;
gPlayerParty[2].species=2;gPlayerParty[2].level=37;
for(floor=0;floor<8;floor++){
 state.floorIdx=floor;records[0].floorsCleared=floor;
 for(t=0;t<3;t++)for(i=0;i<6;i++)CURR_FLOOR.trainers[t].mons[i].species=100*t+i+1;
 for(type=0;type<3;type++){
  CURR_FLOOR.challengeType=type;
  for(t=0;t<(type==2?3:1);t++){
   trainerIndex=t;BuildEnemyParty();
   assert(gEnemyParty[0].level==37);
   if(type==0){assert(gEnemyParty[0].species==sSingleBattleChallengeMonIdxs[floor][0]+1);assert(gEnemyParty[1].species==sSingleBattleChallengeMonIdxs[floor][1]+1);}
   if(type==1){assert(gEnemyParty[0].species==sDoubleBattleChallengeMonIdxs[floor][0]+1);assert(gEnemyParty[1].species==101+sDoubleBattleChallengeMonIdxs[floor][1]);}
   if(type==2){assert(gEnemyParty[0].species==100*t+sKnockoutChallengeMonIdxs[floor][t]+1);assert(gEnemyParty[1].species==0);}
  }
 }
}
state.floorIdx=0;CURR_FLOOR.prize=1;bagSpace=0;GiveChallengePrize();assert(gSpecialVar_Result==1&&!records[0].receivedPrize);
bagSpace=1;GiveChallengePrize();assert(gSpecialVar_Result==0&&records[0].receivedPrize&&bagCalls==2);
GiveChallengePrize();assert(gSpecialVar_Result==2&&bagCalls==2);
SetTrainerTowerRecordTime(&records[0].bestTime,1000);records[0].timer=750;CheckFinalTime();assert(gSpecialVar_Result==0&&GetTrainerTowerRecordTime(&records[0].bestTime)==750);
CheckFinalTime();assert(gSpecialVar_Result==2);
FR_SetTowerTimer(&records[2].timer);FR_TrainerTowerVBlank();assert(records[2].timer==1);
FR_DisableTowerTimer();FR_TrainerTowerVBlank();assert(records[2].timer==1);
GetOwnerState();assert(records[0].spokeToOwner);
TrainerTowerSetPlayerLost();GetTrainerTowerChallengeStatus();assert(gSpecialVar_Result==0&&!records[0].hasLost);
GetTrainerTowerChallengeStatus();assert(gSpecialVar_Result==2);
return 0;}
'''
            fixture=root/'tower.c';fixture.write_text(harness)
            start=time.monotonic();compiled=subprocess.run(['cc','-std=c99',str(fixture),'-o',str(root/'tower')],capture_output=True,timeout=10)
            METRICS['fixture_compile_seconds']=time.monotonic()-start
            self.assertEqual(compiled.returncode,0,compiled.stderr.decode())
            start=time.monotonic();run=subprocess.run([str(root/'tower')],capture_output=True,timeout=5);METRICS['fixture_execution_seconds']=time.monotonic()-start
            self.assertEqual(run.returncode,0,run.stderr.decode())

if __name__=='__main__':unittest.main()
