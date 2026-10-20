"""Focused source-native Route5 daycare verification, no full ROM build."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from .daycare import stage_daycare, ROUTE5, HELPERS
from .native_services import functions
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'local/decomps/pokeemerald';DONOR=ROOT/'local/decomps/pokefirered'

@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(),'local source inputs unavailable')
class DaycareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.out=Path(cls.temp.name)
        for rel in ('include/pokemon_storage_system.h','src/daycare.c'):
            (cls.out/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(BASE/rel,cls.out/rel)
        p=cls.out/'include/pokemon_storage_system.h';text=p.read_text();text=text.replace('    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];','    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];\n    struct {\n        u32 schema;\n    } wholeGameKanto;');p.write_text(text)
        cls.ledger=stage_daycare(BASE,DONOR,cls.out)
        cls.unit=(cls.out/'src/firered_native/daycare.c').read_text()
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_native_private_bank_and_shared_breeding_policy(self):
        self.assertEqual(self.ledger['abi']['route5DaycareMon'],140)
        self.assertEqual(self.ledger['abi']['mail'],36)
        self.assertIn('struct FR_Route5DaycareMon route5Daycare;',(self.out/'include/pokemon_storage_system.h').read_text())
        expected='#include "whole_game_fr_daycare.h"\n'+(BASE/'src/daycare.c').read_text().replace('bool8 ShouldEggHatch(void)\n{\n','bool8 ShouldEggHatch(void)\n{\n    FR_AdvanceRoute5DaycareStep();\n')
        self.assertEqual((self.out/'src/daycare.c').read_text(),expected)
        self.assertNotIn('WholeGameIsFireRedMap',self.unit)
        self.assertIn('route5Daycare.steps++',self.unit)
        self.assertIn('StoreSelectedPokemonInDaycare();',self.unit)
        with self.assertRaises(ValueError): stage_daycare(BASE,DONOR,DONOR)
        rows={row['name']:row for row in self.ledger['providers']}
        self.assertTrue(all(rows[n]['status']=='source-ported' for n in ROUTE5))
        self.assertEqual(rows['ShowDaycareLevelMenu']['status'],'unified-native-system-binding')

    @unittest.skipUnless(shutil.which('clang'),'host compiler unavailable')
    def test_compiled_native_deposit_withdraw_level_cost_and_step_semantics(self):
        selected=ROUTE5+HELPERS+('FR_AdvanceRoute5DaycareStep',)
        names=['FR_'+n if not n.startswith('FR_') else n for n in selected]
        index={f.name:f.source for f in functions(self.unit,'')};bodies=[index[n] for n in names]
        declarations='\n'.join(b.split('{',1)[0].strip()+';' for b in bodies)
        types=(self.out/'include/whole_game_fr_daycare_types.h').read_text()
        types=re.sub(r'^#include[^\n]*\n','',types,flags=re.M)
        preamble=r'''
#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdarg.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;typedef int32_t s32;typedef uint8_t bool8;
#define TRUE 1
#define FALSE 0
#define PLAYER_NAME_LENGTH 7
#define POKEMON_NAME_LENGTH 10
#define PARTY_SIZE 6
#define MAX_LEVEL 100
#define SPECIES_NONE 0
#define MON_HAS_MAX_MOVES 65535
#define STR_CONV_MODE_LEFT_ALIGN 0
#define MON_DATA_SPECIES 1
#define MON_DATA_NICKNAME 2
#define MON_DATA_MAIL 3
#define MON_DATA_LEVEL 4
#define MON_DATA_EXP 5
#define MON_DATA_SANITY_HAS_SPECIES 6
struct BoxPokemon {u16 species;u8 level,pp;u32 exp;u8 nickname[11],opaque[61];};
struct Pokemon {struct BoxPokemon box;u8 runtime[20];};
struct __attribute__((aligned(4))) Mail {u16 words[9];u8 playerName[8],trainerId[4];u16 species,itemId;};
'''
        stubs=r'''
struct {struct {struct FR_Route5DaycareMon route5Daycare;} wholeGameKanto;} storage,*gPokemonStoragePtr=&storage;
struct {struct Mail mail[16];} save1,*gSaveBlock1Ptr=&save1;
struct {u8 playerName[8];} save2,*gSaveBlock2Ptr=&save2;
struct Pokemon gPlayerParty[6];u8 gPlayerPartyCount;u16 gSpecialVar_0x8005,gMoveToLearn=99;
u8 gStringVar1[64],gStringVar2[64];int cursor,mailRestores,learned,statUpdates;u8 hoennDaycareSentinel[280];
static u32 GetBoxMonData(struct BoxPokemon *mon,int field,...) {
 if(field==MON_DATA_NICKNAME){va_list ap;va_start(ap,field);memcpy(va_arg(ap,u8 *),mon->nickname,11);va_end(ap);return 0;}
 if(field==MON_DATA_SPECIES||field==MON_DATA_SANITY_HAS_SPECIES)return mon->species;
 if(field==MON_DATA_EXP)return mon->exp;
 return 0;
}
static u32 GetMonData(struct Pokemon *mon,int field,...) {
 if(field==MON_DATA_NICKNAME){va_list ap;va_start(ap,field);memcpy(va_arg(ap,u8 *),mon->box.nickname,11);va_end(ap);return 0;}
 if(field==MON_DATA_LEVEL)return mon->box.level;
 if(field==MON_DATA_MAIL)return mon->runtime[0];
 return GetBoxMonData(&mon->box,field);
}
static void SetBoxMonData(struct BoxPokemon *mon,int f,const void *v){if(f==MON_DATA_EXP)mon->exp=*(const u32*)v;}
static void SetMonData(struct Pokemon *mon,int f,const void *v){SetBoxMonData(&mon->box,f,v);}
static u8 *StringCopy_Nickname(u8 *to,const u8 *from){memcpy(to,from,11);return to;}
static u8 *StringCopy(u8 *to,const u8 *from){return (u8*)strcpy((char*)to,(const char*)from);}
static u8 *ConvertIntToDecimalStringN(u8 *to,u32 v,int mode,int len){to[0]=v&255;return to;}
static bool8 MonHasMail(struct Pokemon *mon){return mon->runtime[1];}
static void TakeMailFromMon(struct Pokemon *mon){mon->runtime[1]=0;}
static u8 GiveMailToMon(struct Pokemon *mon,struct Mail *mail){mon->runtime[1]=1;mailRestores++;return 0;}
static void ClearMail(struct Mail *mail){memset(mail,0,sizeof(*mail));}
static void BoxMonRestorePP(struct BoxPokemon *mon){mon->pp=35;}
static void ZeroMonData(struct Pokemon *mon){memset(mon,0,sizeof(*mon));}
static void ZeroBoxMonData(struct BoxPokemon *mon){memset(mon,0,sizeof(*mon));}
static void CompactPartySlots(void){int i,j=0;for(i=0;i<6;i++)if(gPlayerParty[i].box.species){if(i!=j){gPlayerParty[j]=gPlayerParty[i];ZeroMonData(&gPlayerParty[i]);}j++;}}
static u8 CalculatePlayerPartyCount(void){int i;gPlayerPartyCount=0;for(i=0;i<6;i++)if(gPlayerParty[i].box.species)gPlayerPartyCount++;return gPlayerPartyCount;}
static void BoxMonToMon(struct BoxPokemon *box,struct Pokemon *mon){ZeroMonData(mon);mon->box=*box;}
static u8 GetLevelFromBoxMonExp(struct BoxPokemon *box){return box->exp/100>100?100:box->exp/100;}
static bool8 TryIncrementMonLevel(struct Pokemon *mon){if(mon->box.level<100&&mon->box.exp>=(mon->box.level+1)*100){mon->box.level++;return 1;}return 0;}
static u16 MonTryLearningNewMove(struct Pokemon *mon,bool8 first){return first?MON_HAS_MAX_MOVES:0;}
static void DeleteFirstMoveAndGiveMoveToMon(struct Pokemon *mon,u16 move){assert(move==99);learned++;}
static void CalculateMonStats(struct Pokemon *mon){statUpdates++;}
static u8 GetCursorSelectionMonId(void){return cursor;}
'''
        main=r'''
int main(void){
 struct FR_Route5DaycareMon *day=&storage.wholeGameKanto.route5Daycare;
 struct Pokemon original;u8 hoenn[280];int i;
 memset(hoennDaycareSentinel,0xCA,sizeof(hoenn));memcpy(hoenn,hoennDaycareSentinel,sizeof(hoenn));
 gPlayerParty[0].box.species=25;gPlayerParty[0].box.level=2;gPlayerParty[0].box.exp=200;
 memcpy(gPlayerParty[0].box.nickname,"SPARK",6);memset(gPlayerParty[0].box.opaque,0xA5,61);
 gPlayerParty[0].runtime[1]=1;save1.mail[0].itemId=121;memcpy(save2.playerName,"OWNER",6);
 gPlayerParty[1].box.species=1;original=gPlayerParty[0];CalculatePlayerPartyCount();
 assert(!FR_IsThereMonInRoute5Daycare());FR_PutMonInRoute5Daycare();
 assert(FR_IsThereMonInRoute5Daycare()&&gPlayerPartyCount==1&&gPlayerParty[0].box.species==1);
 assert(day->steps==0&&day->mon.species==25&&day->mon.pp==35);
 assert(!memcmp(day->mon.opaque,original.box.opaque,61)&&day->mail.message.itemId==121);
 assert(!memcmp(day->mail.OT_name,"OWNER",6));
 FR_GetCostToWithdrawRoute5DaycareMon();assert(gSpecialVar_0x8005==100);
 for(i=0;i<500;i++)FR_AdvanceRoute5DaycareStep();assert(day->steps==500);
 assert(FR_GetNumLevelsGainedForRoute5DaycareMon()==5);assert(!memcmp(gStringVar1,"SPARK",6));
 FR_GetCostToWithdrawRoute5DaycareMon();assert(gSpecialVar_0x8005==600);
 assert(FR_TakePokemonFromRoute5Daycare()==25);assert(gPlayerPartyCount==2&&learned==5&&statUpdates==1);
 assert(gPlayerParty[1].box.level==7&&gPlayerParty[1].runtime[1]&&mailRestores==1);
 assert(!FR_IsThereMonInRoute5Daycare()&&day->steps==0&&day->mail.message.itemId==0);
 FR_AdvanceRoute5DaycareStep();assert(day->steps==0);assert(!memcmp(hoenn,hoennDaycareSentinel,sizeof(hoenn)));
 day->mon.species=25;day->steps=0xFFFFFFFFu;FR_AdvanceRoute5DaycareStep();assert(day->steps==0);
 day->mon.level=100;day->mon.exp=10000;day->steps=1000;FR_GetCostToWithdrawRoute5DaycareMon();assert(gSpecialVar_0x8005==100);
 i=learned;FR_TakePokemonFromRoute5Daycare();assert(learned==i);
 return 0;
}
'''
        source=self.out/'daycare-harness.c';source.write_text(preamble+types+stubs+declarations+'\n'+'\n'.join(bodies)+main)
        binary=self.out/'daycare-harness'
        compile=subprocess.run(['clang','-std=c99','-Werror',str(source),'-o',str(binary)],capture_output=True,text=True)
        self.assertEqual(compile.returncode,0,compile.stderr)
        run=subprocess.run([str(binary)],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)

if __name__=='__main__':unittest.main()
