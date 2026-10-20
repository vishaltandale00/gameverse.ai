import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from .battle_modes import stage_battle_modes
from .encounters import source_function, array_span

ROOT = Path(__file__).resolve().parents[3]
BASE, DONOR = [ROOT / 'local/decomps' / n for n in ('pokeemerald', 'pokefirered')]

class BattleModesTests(unittest.TestCase):
    def stage(self, root):
        out = root / 'merged'
        for name in ('src/battle_setup.c', 'src/battle_main.c', 'include/constants/battle_setup.h', 'data/battle_scripts_1.s', 'src/battle_message.c', 'src/battle_script_commands.c', 'include/constants/battle_string_ids.h'):
            (out/name).parent.mkdir(parents=True, exist_ok=True)
            value = (BASE/name).read_text()
            if name == 'src/battle_setup.c':
                value = value.replace('TRAINER_FLAGS_START + gTrainerBattleOpponent_A', 'WholeGame_TrainerFlag(gTrainerBattleOpponent_A)')
            (out/name).write_text(value)
        ledger = stage_battle_modes(BASE, DONOR, out)
        return out, ledger

    def test_canonical_refused(self):
        with self.assertRaises(ValueError): stage_battle_modes(BASE, DONOR, BASE)

    def test_modes_and_loss_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, ledger = self.stage(Path(tmp))
            self.assertEqual(ledger['modeMap']['TRAINER_BATTLE_EARLY_RIVAL'], 13)
            self.assertEqual(len(ledger['descriptorAudit']), 5)
            self.assertEqual(ledger['status'], 'partial')
            source = (out/'src/battle_setup.c').read_text()
            self.assertIn('case TRAINER_BATTLE_PYRAMID:', source)
            self.assertNotIn('gBattleTypeFlags |= BATTLE_TYPE_FIRST_BATTLE', source_function(source, 'BattleSetup_StartTrainerBattle'))
            script = (out/'data/battle_scripts_1.s').read_text()
            self.assertIn('FR_BattleScript_RivalBattleLostSkipMonRecall::', script)
            self.assertIn('jumpifbyte CMP_EQUAL, cMULTISTRING_CHOOSER, 2, FR_BattleScript_LocalBattleLostPrintWhiteOut', script)
            with self.assertRaises(ValueError): stage_battle_modes(BASE, DONOR, out)

    def test_compiled_source_parser_and_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, _ = self.stage(Path(tmp))
            source = (out/'src/battle_setup.c').read_text()
            # Source-native descriptors and loader are compiled exactly. Pointer
            # payloads are GBA32 literals; only continuation uses a host pointer.
            declarations = '''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
#include <string.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef int32_t s32; typedef int bool8; typedef int bool32;
#define TRUE 1
#define FALSE 0
#define LOCALID_NONE 0
#define BATTLE_TYPE_TRAINER 8
#define TRAINER_SECRET_BASE 1024
#define PYRAMID_LOCATION_NONE 0
#define B_OUTCOME_WON 1
#define B_OUTCOME_LOST 2
#define B_OUTCOME_DREW 3
#define T1_READ_8(p) (*(p))
#define T1_READ_16(p) ((p)[0] | ((p)[1]<<8))
#define T1_READ_32(p) ((u32)T1_READ_16(p) | ((u32)T1_READ_16((p)+2)<<16))
'''
            declarations += (BASE/'include/constants/battle_setup.h').read_text()
            declarations += (out/'include/constants/whole_game_fr_battle_modes.h').read_text()
            declarations += '''enum {TRAINER_PARAM_LOAD_VAL_8BIT,TRAINER_PARAM_LOAD_VAL_16BIT,TRAINER_PARAM_LOAD_VAL_32BIT,TRAINER_PARAM_CLEAR_VAL_8BIT,TRAINER_PARAM_CLEAR_VAL_16BIT,TRAINER_PARAM_CLEAR_VAL_32BIT,TRAINER_PARAM_LOAD_SCRIPT_RET_ADDR};
struct TrainerBattleParameter {void *varPtr; u8 ptrType;};
static u16 sTrainerBattleMode,sWholeGameRivalBattleFlags,gTrainerBattleOpponent_A,gTrainerBattleOpponent_B,sTrainerObjectEventLocalId;
static u8 *sTrainerAIntroSpeech,*sTrainerBIntroSpeech,*sTrainerADefeatSpeech,*sTrainerBDefeatSpeech,*sTrainerVictorySpeech,*sTrainerCannotBattleSpeech,*sTrainerBattleEndScript,*sTrainerABattleScriptRetAddr,*sTrainerBBattleScriptRetAddr;
static u8 gApproachingTrainerId,gNoOfApproachingTrainers; u16 gSpecialVar_LastTalked;
static int ql,rematch,heals,flags,registered,callback,gSpecialVar_Result,gBattleOutcome;
u32 gBattleTypeFlags;
static const u8 EventScript_DoNoIntroTrainerBattle[]={1},EventScript_TryDoDoubleTrainerBattle[]={2},EventScript_TryDoNormalTrainerBattle[]={3},EventScript_TryDoDoubleRematchBattle[]={4},EventScript_TryDoRematchBattle[]={5};
bool8 WholeGame_IsFireRedTrainerBattle(void);
bool8 WholeGame_IsKanto(void){return gTrainerBattleOpponent_A>4096;}
void SetMapVarsToTrainer(void){}
void FR_QL_FinishRecordingScene(void){ql++;}
int FR_GetRematchTrainerId(u16 id){rematch++;return id+1;}
u16 GetRematchTrainerId(u16 id){return id+2;}
u16 LocalIdToPyramidTrainerId(u16 id){return 333;}
u16 LocalIdToHillTrainerId(u16 id){return 444;}
void CB2_WhiteOut(void){} void CB2_ReturnToFieldContinueScriptPlayMapMusic(void){}
void SetMainCallback2(void (*cb)(void)){callback=cb==CB2_WhiteOut?1:2;}
void HealPlayerParty(void){heals++;}
void SetTrainerFlag(u16 trainer){assert(trainer>4096);flags++;}
void SetBattledTrainersFlags(void){flags++;}
void FR_QuestLogEvents_HandleEndTrainerBattle(void){ql++;}
void FR_ClearRematchStateOfLastTalked(void){rematch++;}
void FR_ResetDeferredLinkEvent(void){rematch++;}
int CurrentBattlePyramidLocation(void){return 0;}
int InTrainerHillChallenge(void){return 0;}
void RegisterTrainerInMatchCall(void){registered++;}
void HandleRematchVarsOnBattleEnd(void){registered++;}
bool32 IsPlayerDefeated(u32 outcome){return outcome==2||outcome==3;}
'''
            arrays = ['sOrdinaryBattleParams', 'sContinueScriptBattleParams', 'sDoubleBattleParams', 'sOrdinaryNoIntroBattleParams', 'sContinueScriptDoubleBattleParams', 'sTrainerBOrdinaryBattleParams', 'sTrainerBContinueScriptBattleParams', 'sWholeGameEarlyRivalBattleParams']
            for name in arrays:
                a,b = array_span(source,name)
                declarations += 'static const struct TrainerBattleParameter '+name+'[]={'+source[a:b]+'};\n'
            functions = ['TrainerBattleLoadArg8','TrainerBattleLoadArg16','TrainerBattleLoadArg32','SetU8','SetU16','SetU32','SetPtr','TrainerBattleLoadArgs','InitTrainerBattleVariables','BattleSetup_ConfigureTrainerBattle','GetRivalBattleFlags','WholeGame_IsFireRedTrainerBattle','WholeGame_IsFireRedTutorialBattle','CB2_EndTrainerBattle','CB2_EndRematchBattle']
            body = '\n'.join(source_function(source,n) for n in functions)
            main = '''int main(void){
 u8 data[32]={13,1,16,3,0,0x11,0,0,0,0x22,0,0,0};
 gTrainerBattleOpponent_B=700;gApproachingTrainerId=1;gNoOfApproachingTrainers=2;
 assert(BattleSetup_ConfigureTrainerBattle(data)==EventScript_DoNoIntroTrainerBattle);
 assert(gTrainerBattleOpponent_A==4097);assert(gTrainerBattleOpponent_B==0);assert(GetRivalBattleFlags()==3);
 assert((uintptr_t)sTrainerADefeatSpeech==0x11);assert((uintptr_t)sTrainerVictorySpeech==0x22);assert(sTrainerBattleEndScript==data+13);assert(sTrainerObjectEventLocalId==0);
 assert(!WholeGame_IsFireRedTutorialBattle());gBattleTypeFlags=8;assert(WholeGame_IsFireRedTutorialBattle());
 for(int f=0;f<4;f++) for(int outcome=1;outcome<=3;outcome++) {
  sTrainerBattleMode=13;sWholeGameRivalBattleFlags=f;gBattleOutcome=outcome;heals=flags=ql=callback=registered=0;
  CB2_EndTrainerBattle();assert(registered==0);
  if(outcome==1){assert(gSpecialVar_Result==0);assert(callback==2);assert(flags==1&&ql==1&&heals==0);}
  else if(f&1){assert(gSpecialVar_Result==1);assert(callback==2);assert(flags==1&&ql==1&&heals==1);}
  else{assert(gSpecialVar_Result==1);assert(callback==1);assert(flags==0&&ql==0&&heals==0);}
 }
 data[0]=9;gApproachingTrainerId=0;assert(BattleSetup_ConfigureTrainerBattle(data)==EventScript_TryDoNormalTrainerBattle);assert(gTrainerBattleOpponent_A==333);assert(GetRivalBattleFlags()==0);
 data[0]=5;gApproachingTrainerId=0;gTrainerBattleOpponent_A=4097;ql=rematch=0;
 assert(BattleSetup_ConfigureTrainerBattle(data)==EventScript_TryDoRematchBattle);assert(gTrainerBattleOpponent_A==4098);assert(ql==1&&rematch==1);
 gBattleOutcome=1;flags=rematch=registered=0;CB2_EndRematchBattle();assert(flags==1&&rematch==2&&registered==0);
 return 0;
}'''
            check=out/'check.c';check.write_text(declarations+body+main)
            result=subprocess.run(['cc','-std=c99','-Werror',str(check),'-o',str(out/'check')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'check')],check=True,capture_output=True)

    def test_firered_money_operand_and_loss_side_effects(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, ledger = self.stage(Path(tmp))
            body=source_function((out/'src/battle_script_commands.c').read_text(),'Cmd_FR_GetMoneyReward')
            preamble='''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;
#define B_OUTCOME_WON 1
#define TRAINER_SECRET_BASE 1024
#define BATTLE_TYPE_DOUBLE 1
#define F_TRAINER_PARTY_CUSTOM_MOVESET 1
#define F_TRAINER_PARTY_HELD_ITEM 2
#define PREPARE_WORD_NUMBER_BUFFER(b,n,value) (buffered=(value))
#define T1_READ_PTR(p) ((const u8*)(uintptr_t)((u32)(p)[0]|((u32)(p)[1]<<8)|((u32)(p)[2]<<16)|((u32)(p)[3]<<24)))
struct TrainerMonNoItemDefaultMoves {u8 lvl;};
struct TrainerMonNoItemCustomMoves {u8 lvl;};
struct TrainerMonItemDefaultMoves {u8 lvl;};
struct TrainerMonItemCustomMoves {u8 lvl;};
struct Trainer {u8 partyFlags,partySize,trainerClass;union {const struct TrainerMonNoItemDefaultMoves *NoItemDefaultMoves;const struct TrainerMonNoItemCustomMoves *NoItemCustomMoves;const struct TrainerMonItemDefaultMoves *ItemDefaultMoves;const struct TrainerMonItemCustomMoves *ItemCustomMoves;} party;};
struct Trainer gTrainers[4098];
struct {u8 classId,value;} gTrainerMoneyTable[]={{1,2},{255,0}};
struct {u32 money;} save;
#define gSaveBlock1Ptr (&save)
struct {u32 moneyMultiplier;} battleStruct;
#define gBattleStruct (&battleStruct)
struct {u8 levels[6];} party;
struct {struct {u8 levels[6];} party;} secret;
struct {void *unused;} dummy;
struct {typeof(secret) *secretBase;} resources;
#define gBattleResources (&resources)
u8 gBattleOutcome;u16 gTrainerBattleOpponent_A;u32 gBattleTypeFlags;
u8 gBattleTextBuff1[32];const u8 *gBattlescriptCurrInstr;
u32 loss,buffered;
u32 FR_ComputeWhiteOutMoneyLoss(void){return loss;}
void AddMoney(u32 *money,u32 value){*money+=value;}
'''
            main='''int main(void){u8 data[]={0xF9,0x56,0x34,0,0};
 gBattleOutcome=2;save.money=100;
 loss=50;gBattlescriptCurrInstr=data;Cmd_FR_GetMoneyReward();assert(gBattlescriptCurrInstr==data+5);assert(buffered==50);assert(save.money==100);
 loss=0;gBattlescriptCurrInstr=data;Cmd_FR_GetMoneyReward();assert((uintptr_t)gBattlescriptCurrInstr==0x3456);assert(buffered==0);assert(save.money==100);
 struct TrainerMonNoItemDefaultMoves mon={5};gTrainers[4097].party.NoItemDefaultMoves=&mon;gTrainers[4097].partySize=1;gTrainers[4097].trainerClass=1;
 gTrainerBattleOpponent_A=4097;gBattleStruct->moneyMultiplier=1;gBattleOutcome=1;gBattlescriptCurrInstr=data;Cmd_FR_GetMoneyReward();assert(buffered==40&&save.money==140&&gBattlescriptCurrInstr==data+5);
 return 0;}'''
            path=out/'money-check.c';path.write_text(preamble+body+main)
            result=subprocess.run(['cc','-std=gnu99','-Werror',str(path),'-o',str(out/'money-check')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'money-check')],check=True,capture_output=True)
            script=(out/'data/battle_scripts_1.s').read_text()
            self.assertIn('wholegame_fr_getmoneyreward FR_BattleScript_LocalBattleLostPrintTrainersWinText',script)
            self.assertIn('    .byte 0xF9\n    .4byte \\target',script)
            header=(out/'include/constants/battle_string_ids.h').read_text()
            self.assertIn('#define FR_STRINGID_PLAYERPAIDPRIZEMONEY 384',header)

if __name__=='__main__': unittest.main()
