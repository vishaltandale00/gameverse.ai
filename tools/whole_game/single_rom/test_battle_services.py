"""Source service ABI and actual emitted entry/validator fixtures."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from .battle_services import stage_battle_services
from .encounters import source_function
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'local/decomps/pokeemerald';F=ROOT/'local/decomps/pokefirered'
METRICS={}

class BattleServicesTest(unittest.TestCase):
    def test_refuse_canonical_tree(self):
        with self.assertRaises(ValueError):stage_battle_services(E,F,E)

    def test_original_entries_and_card_validator(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'stage';r=stage_battle_services(E,F,out);METRICS['transform_seconds']=r['transform_wall_seconds']
            self.assertEqual(len(r['providers']),13)
            self.assertEqual(r['specialBattleCallsiteProof']['inactiveLegacySelectors'],[0,1])
            self.assertFalse(r['specialBattleCallsiteProof']['unknownSpecialTargets'])
            setup=(out/'src/battle_setup.c').read_text();core=(out/'src/firered_battle_services.c').read_text()
            self.assertIn('gMain.savedCallback = FR_CB2_EndOldManTutorialBattle;',setup)
            self.assertIn('sFROldManBattle = TRUE;',setup)
            self.assertNotIn('BATTLE_TYPE_OLD_MAN_TUTORIAL',source_function(setup,'FR_StartOldManTutorialBattle'))
            self.assertNotIn('BATTLE_TYPE_GHOST',source_function(setup,'FR_StartMarowakBattle'))
            self.assertIn('FR_SetGhostBattleMode(2);',source_function(setup,'FR_StartMarowakBattle'))
            self.assertIn('FR_MUS_VS_MEWTWO',source_function(setup,'FR_StartLegendaryBattle'))
            self.assertNotIn('FillBattleTowerTrainerParty',core)
            self.assertIn('gSpecialVar_Result = 0xFFFF',core)
            self.assertIn('(*FR_GetEReaderTrainer())',core)
            if not shutil.which('cc'):return
            harness=r'''#include <stdint.h>
#include <assert.h>
#include <string.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;typedef int32_t s32;typedef u8 bool8;
#define FALSE 0
#define TRUE 1
#define SPECIES_WEEDLE 13
#define SPECIES_MAROWAK 105
#define SPECIES_MEWTWO 150
#define SPECIES_DEOXYS 410
#define SPECIES_MOLTRES 146
#define SPECIES_ARTICUNO 144
#define SPECIES_ZAPDOS 145
#define SPECIES_HO_OH 250
#define SPECIES_LUGIA 249
#define BATTLE_TYPE_LEGENDARY 8192
#define B_TRANSITION_SLICE 3
#define B_TRANSITION_BLUR 4
#define FR_MUS_VS_MEWTWO 501
#define FR_MUS_VS_DEOXYS 502
#define FR_MUS_VS_LEGEND 503
#define FR_MUS_RS_VS_TRAINER 504
#define MON_DATA_SPECIES 1
#define MON_DATA_NICKNAME 2
#define ITEM_SILPH_SCOPE 359
#define MON_FEMALE 254
#define NATURE_SERIOUS 12
#define FR_GAME_STAT_TOTAL_BATTLES 1
#define FR_GAME_STAT_WILD_BATTLES 2
struct Pokemon {u16 species;u8 level;}gEnemyParty[6];
static struct {void(*savedCallback)(void);}gMain;
static u32 gBattleTypeFlags;
static bool8 sFROldManBattle,sFRLegendaryBattle;
static u8 sFRGhostMode,scope,createdGender,createdLevel;
static u16 transition,music,stats[3],createdSpecies;
static int locked,cleared,flagWrites;
static const u8 FR_gText_Ghost[]={0};
static void FR_CB2_EndOldManTutorialBattle(void){}
static void FR_CB2_EndMarowakBattle(void){}
static void FR_CB2_EndLegendaryBattle(void){}
static void FR_ClearSpecialBattleModes(void){sFROldManBattle=sFRLegendaryBattle=sFRGhostMode=0;cleared++;}
static void FR_SetGhostBattleMode(u8 n){sFRGhostMode=n;}
static void LockPlayerFieldControls(void){locked++;}
static void CreateBattleStartTask(u8 t,u16 m){transition=t;music=m;}
static void CreateMaleMon(struct Pokemon*m,u16 s,u8 l){createdGender=0;createdSpecies=s;createdLevel=l;}
static void CreateMonWithGenderNatureLetter(struct Pokemon*m,u16 s,u8 l,u8 iv,u8 g,u8 n,u8 letter){createdGender=g;createdSpecies=s;createdLevel=l;assert(iv==31&&n==12&&letter==0);}
static u8 CheckBagHasItem(u16 i,u16 n){return scope;}
static u8 GetWildBattleTransition(void){return 9;}
static void SetMonData(struct Pokemon*m,u8 id,const void*v){}
static u32 GetMonData(struct Pokemon*m,u8 id){return m->species;}
static void FR_IncrementGameStat(u8 n){stats[n]++;}
static u16 gSpecialVar_Result,gSpecialVar_0x8004;
struct BattleTowerPokemon {u32 words[11];};
struct FR_BattleTowerEReaderTrainer {u8 unk0,trainerClass;u16 winStreak;u8 name[8],trainerId[4];u16 greeting[6],farewellPlayerLost[6],farewellPlayerWon[6];struct BattleTowerPokemon party[3];u32 checksum;};
static struct FR_BattleTowerEReaderTrainer card;
static struct FR_BattleTowerEReaderTrainer *FR_GetEReaderTrainer(void){return &card;}
'''
            for name in ('FR_StartOldManTutorialBattle','FR_StartMarowakBattle','FR_StartLegendaryBattle'):
                harness+=source_function(setup,name)+'\n'
            for name in ('FR_ClearEReaderTrainer','FR_ValidateEReaderTrainer'):
                harness+=source_function(core,name)+'\n'
            harness+=r'''
#define BATTLE_TYPE_EREADER_TRAINER 2048
#define BATTLE_TYPE_TRAINER 8
#define B_OUTCOME_WON 1
#define B_OUTCOME_LOST 2
#define B_OUTCOME_DREW 3
#define EOS 255
static bool8 sFREReaderBattle;
static u16 gTrainerBattleOpponent_A;
static int tasks,creates,farewell;
static u8 gBattleOutcome,gStringVar4[20];
static const u16 *lastSpeech;
static void FR_Task_WaitBT(u8 id){}
static void CreateTask(void(*fn)(u8),u8 priority){tasks++;assert(fn==FR_Task_WaitBT&&priority==1);}
static void ZeroEnemyPartyMons(void){memset(gEnemyParty,0,sizeof(gEnemyParty));}
static void CreateBattleTowerMon(struct Pokemon *m,struct BattleTowerPokemon *src){creates++;m->species=src->words[0];}
static void PlayMapChosenOrBattleBGM(u16 music){}
static u8 FR_BS_GetTransition(void){return 7;}
static void BattleTransition_StartOnField(u8 n){assert(n==7);}
static void CB2_ReturnToFieldContinueScriptPlayMapMusic(void){}
static void SetMainCallback2(void(*fn)(void)){assert(fn==CB2_ReturnToFieldContinueScriptPlayMapMusic);}
static void FR_BufferBattleTowerTrainerMessage(const u16 *message){lastSpeech=message;farewell++;}
'''
            for name in ('FR_StartSpecialBattle','FR_PrintEReaderTrainerFarewellMessage','FR_CB2_FinishEReaderBattle'):
                harness+=source_function(core,name)+'\n'
            harness+=r'''int main(void){
u32 i,sum,*words=(u32*)&card;
FR_StartOldManTutorialBattle();assert(sFROldManBattle&&gBattleTypeFlags==0&&createdSpecies==13&&createdLevel==5&&locked==1&&transition==3);
scope=0;FR_StartMarowakBattle();assert(sFRGhostMode==1&&gBattleTypeFlags==0);
scope=1;FR_StartMarowakBattle();assert(sFRGhostMode==2&&gBattleTypeFlags==8192&&createdSpecies==105&&createdLevel==30&&createdGender==254);
gEnemyParty[0].species=150;FR_StartLegendaryBattle();assert(sFRLegendaryBattle&&sFRGhostMode==0&&music==501&&transition==4);
gEnemyParty[0].species=410;FR_StartLegendaryBattle();assert(music==502);
gEnemyParty[0].species=145;FR_StartLegendaryBattle();assert(music==503);
gEnemyParty[0].species=1;FR_StartLegendaryBattle();assert(music==504);
assert(stats[1]==6&&stats[2]==6);
assert(sizeof(card)==188);
gSpecialVar_0x8004=0;FR_StartSpecialBattle();assert(gSpecialVar_Result==65535&&tasks==0&&creates==0&&!sFREReaderBattle);
gSpecialVar_0x8004=1;FR_StartSpecialBattle();assert(gSpecialVar_Result==65535&&tasks==0&&creates==0);
card.party[0].words[0]=25;card.party[1].words[0]=26;card.party[2].words[0]=27;
gSpecialVar_0x8004=2;FR_StartSpecialBattle();assert(tasks==1&&creates==3&&sFREReaderBattle&&gBattleTypeFlags==(2048|8)&&gEnemyParty[2].species==27);
gBattleOutcome=1;FR_CB2_FinishEReaderBattle();assert(!sFREReaderBattle&&gSpecialVar_Result==1&&lastSpeech==card.farewellPlayerWon);
gBattleOutcome=2;FR_CB2_FinishEReaderBattle();assert(gSpecialVar_Result==2&&lastSpeech==card.farewellPlayerLost);
gBattleOutcome=3;FR_CB2_FinishEReaderBattle();assert(gSpecialVar_Result==3&&gStringVar4[0]==255);
FR_ClearEReaderTrainer(&card);FR_ValidateEReaderTrainer();assert(gSpecialVar_Result==1);
for(i=0,sum=0;i<46;i++){words[i]=i+1;sum+=words[i];}card.checksum=sum;
FR_ValidateEReaderTrainer();assert(gSpecialVar_Result==0&&card.checksum==sum);
card.checksum++;FR_ValidateEReaderTrainer();assert(gSpecialVar_Result==1);
for(i=0;i<47;i++)assert(words[i]==0);
return 0;}
'''
            p=Path(temp)/'check.c';p.write_text(harness);start=time.monotonic();compile=subprocess.run(['cc','-std=c99',str(p),'-o',str(Path(temp)/'check')],capture_output=True,timeout=10);METRICS['fixture_compile_seconds']=time.monotonic()-start
            self.assertEqual(compile.returncode,0,compile.stderr.decode());start=time.monotonic();run=subprocess.run([str(Path(temp)/'check')],capture_output=True,timeout=5);METRICS['fixture_execution_seconds']=time.monotonic()-start;self.assertEqual(run.returncode,0,run.stderr.decode())

    def test_indirect_macro_or_numeric_target_cannot_evade_domain_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);donor=root/'donor'
            for name in ('src/battle_setup.c','src/battle_tower.c','src/easy_chat.c','data/specials.inc','data/maps/SevenIsland_House_Room2/scripts.inc'):
                p=donor/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((F/name).read_bytes())
            p=donor/'data/hidden.inc';p.write_text('.macro invoke function\n special \\function\n.endm\n invoke StartSpecialBattle\n')
            with self.assertRaisesRegex(ValueError,'callsite proof changed'):stage_battle_services(E,donor,root/'badmacro')
            p.write_text(' specialvar VAR_RESULT, 246\n')
            with self.assertRaisesRegex(ValueError,'callsite proof changed'):stage_battle_services(E,donor,root/'badnumeric')

if __name__=='__main__':unittest.main()
