"""Scoped campaign service source and emitted-C state invariants."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from .campaign_services import stage_campaign_services
from .native_services import functions
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'local/decomps/pokeemerald';DONOR=ROOT/'local/decomps/pokefirered'


class CampaignServices(unittest.TestCase):
    def test_isolated_stage_and_provider_scope(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t);r=stage_campaign_services(BASE,DONOR,out)
            self.assertEqual(len(r['providers']),25)
            targets={p['target'] for p in r['providers']}
            self.assertIn('FR_EggHatch',targets)
            self.assertNotIn('FR_CalculatePlayerPartyCount',targets)
            party=(out/'src/firered_native/campaign_party.c').read_text()
            self.assertNotIn('VarSet(FR_VAR_FRONTIER_FACILITY',party)
            self.assertIn('AllocZeroed(3 * sizeof(struct Pokemon))',party)
            self.assertIn('InitChooseHalfPartyForBattle(0)',party)
            dex=(out/'src/firered_native/campaign_pokedex.c').read_text()
            self.assertNotIn('nationalMagic = 0xB9',dex)
            self.assertIn('FR_PokedexRating_Text_Complete',dex)
            self.assertIn('FLAG_GET_CAUGHT',dex)
            self.assertNotIn('FR_FLAG_GET_CAUGHT',dex)
            size=(out/'src/firered_native/campaign_size_records.c').read_text()
            self.assertIn('FR_VAR_MAGIKARP_SIZE_RECORD',size)
            self.assertIn('FR_VAR_HERACROSS_SIZE_RECORD',size)
            self.assertFalse(r['buildEligible'])
        with self.assertRaisesRegex(ValueError,'isolated'):
            stage_campaign_services(BASE,DONOR,BASE)

    def test_compiled_shared_dex_and_regional_gate(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t);stage_campaign_services(BASE,DONOR,out)
            generated=(out/'src/firered_native/campaign_pokedex.c').read_text()
            funcs={f.name:f.source for f in functions(generated,'generated')}
            native={f.name:f.source for f in functions((BASE/'src/event_data.c').read_text(),'native')}
            code='''#include <assert.h>
#include <stdint.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef u32 bool32;
#define TRUE 1
#define FALSE 0
#define VAR_NATIONAL_DEX 0
#define FLAG_SYS_NATIONAL_DEX 0
#define FR_VAR_NATIONAL_DEX 1
#define FR_FLAG_SYS_NATIONAL_DEX 1
#define DEX_MODE_NATIONAL 1
struct Save { struct { unsigned nationalMagic,mode,order; } pokedex; unsigned trainerSentinel; } save,*gSaveBlock2Ptr=&save;
unsigned flags[2],resets;u16 vars[2];
u16 *GetVarPointer(unsigned id){return &vars[id];}
unsigned VarGet(unsigned id){return vars[id];}
void VarSet(unsigned id,unsigned v){vars[id]=v;}
unsigned FlagGet(unsigned id){return flags[id];}
void FlagSet(unsigned id){flags[id]=1;}
void ResetPokedexScrollPositions(void){resets++;}
'''
            code+='\n'.join(native[n] for n in ('EnableNationalPokedex','IsNationalPokedexEnabled'))+'\n'
            code+='\n'.join(funcs[n] for n in ('FR_EnableNationalPokedex','FR_IsNationalPokedexEnabled'))+'\n'
            code+='''int main(void){
 save.trainerSentinel=12345;
 assert(!FR_IsNationalPokedexEnabled());
 EnableNationalPokedex();
 assert(IsNationalPokedexEnabled() && !FR_IsNationalPokedexEnabled());
 assert(save.pokedex.nationalMagic==0xDA && vars[0]==0x302);
 FR_EnableNationalPokedex();
 assert(IsNationalPokedexEnabled() && FR_IsNationalPokedexEnabled());
 assert(save.pokedex.nationalMagic==0xDA && vars[0]==0x302 && vars[1]==0x6258);
 assert(flags[0]==1 && flags[1]==1 && save.trainerSentinel==12345);
 flags[1]=0;assert(!FR_IsNationalPokedexEnabled() && IsNationalPokedexEnabled());
 flags[1]=1;vars[1]=0;assert(!FR_IsNationalPokedexEnabled());
 vars[1]=0x6258;flags[0]=0;assert(!FR_IsNationalPokedexEnabled());return 0;}
'''
            (out/'gate.c').write_text(code)
            result=subprocess.run(['clang','-std=c99','-Werror',str(out/'gate.c'),'-o',str(out/'gate')],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'gate')],check=True,capture_output=True,timeout=5)

    def test_compiled_three_selected_party_slots(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t);stage_campaign_services(BASE,DONOR,out)
            generated=(out/'src/firered_native/campaign_party.c').read_text()
            reduce=next(f.source for f in functions(generated,'generated') if f.name=='FR_ReducePlayerPartyToThree')
            code='''#include <assert.h>
#include <stdlib.h>
#include <string.h>
struct Pokemon { unsigned id; char rest[96]; } gPlayerParty[6];
unsigned gSelectedOrderFromParty[4],gPlayerPartyCount;
void *AllocZeroed(unsigned n){return calloc(1,n);}
void Free(void *p){free(p);}
#define CpuFill32(v,d,n) memset((d),(v),(n))
void CalculatePlayerPartyCount(void){unsigned i;for(i=0;i<6&&gPlayerParty[i].id;i++){}gPlayerPartyCount=i;}
'''+reduce+'''
int main(void){unsigned i;for(i=0;i<6;i++)gPlayerParty[i].id=i+1;
gSelectedOrderFromParty[0]=6;gSelectedOrderFromParty[1]=2;gSelectedOrderFromParty[2]=4;gSelectedOrderFromParty[3]=5;
FR_ReducePlayerPartyToThree();assert(gPlayerParty[0].id==6&&gPlayerParty[1].id==2&&gPlayerParty[2].id==4&&gPlayerPartyCount==3);
for(i=3;i<6;i++)assert(!gPlayerParty[i].id);
return 0;}
'''
            (out/'party.c').write_text(code)
            result=subprocess.run(['clang','-std=c99','-Werror',str(out/'party.c'),'-o',str(out/'party')],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'party')],check=True,capture_output=True,timeout=5)

    def test_compiled_private_cable_club_validation(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t);stage_campaign_services(BASE,DONOR,out)
            native=(out/'src/party_menu.c').read_text()
            fs={f.name:f.source for f in functions(native,'native')}
            names=['GetBattleEntryLevelCap','GetMaxBattleEntries','GetMinBattleEntries','GetBattleEntryEligibility','CheckBattleEntriesAndGetMessage','WholeGame_SetFRPartySelection']
            code='''#include <assert.h>
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef u8 bool8;
#define TRUE 1
#define FALSE 0
#define MON_DATA_IS_EGG 0
#define MON_DATA_LEVEL 1
#define MON_DATA_HELD_ITEM 2
#define MON_DATA_HP 3
#define MON_DATA_SPECIES 4
#define ITEM_NONE 0
#define VAR_FRONTIER_FACILITY 0
#define FACILITY_MULTI_OR_EREADER 10
#define FACILITY_UNION_ROOM 11
#define MAX_LEVEL 100
#define MULTI_PARTY_SIZE 3
#define UNION_ROOM_PARTY_SIZE 2
#define UNION_ROOM_MAX_LEVEL 30
#define FRONTIER_LVL_50 0
#define FRONTIER_MAX_LEVEL_50 50
#define FRONTIER_MAX_LEVEL_OPEN 100
#define PARTY_MSG_NO_MON_FOR_BATTLE 1
#define PARTY_MSG_X_MONS_ARE_NEEDED 2
#define PARTY_MSG_MONS_CANT_BE_SAME 3
#define PARTY_MSG_NO_SAME_HOLD_ITEMS 4
#define STR_CONV_MODE_LEFT_ALIGN 0
#define MAP_BATTLE_FRONTIER_BATTLE_PYRAMID_LOBBY 0xffff
#define MAP_GROUP(m) ((m)>>8)
#define MAP_NUM(m) ((m)&255)
struct Pokemon {unsigned data[5];}gPlayerParty[6];
struct Save{struct{unsigned mapGroup,mapNum;}location;}save,*gSaveBlock1Ptr=&save;
u16 gFrontierBannedSpecies[]={150,0xffff};u8 gSelectedOrderFromParty[4];unsigned gSpecialVar_0x8004,gSpecialVar_0x8005=2;
u8 gStringVar1[16];static bool8 sFR_CableSelection;unsigned originalFacility;
unsigned VarGet(unsigned n){return originalFacility;}
unsigned GetMonData(struct Pokemon *m,unsigned field){return m->data[field];}
void ConvertIntToDecimalStringN(u8 *s,unsigned n,unsigned mode,unsigned count){}
static u8 GetBattleEntryLevelCap(void);static u8 GetMaxBattleEntries(void);static u8 GetMinBattleEntries(void);
'''
            code+='\n'.join(fs[n] for n in names)+'''
int main(void){
 struct Pokemon *mon=&gPlayerParty[0];originalFacility=77;mon->data[4]=150;mon->data[1]=20;mon->data[3]=1;
 WholeGame_SetFRPartySelection(1);
 assert(GetBattleEntryEligibility(mon));assert(GetMaxBattleEntries()==3&&GetMinBattleEntries()==1&&GetBattleEntryLevelCap()==100);
 assert(CheckBattleEntriesAndGetMessage()==PARTY_MSG_NO_MON_FOR_BATTLE);
 gSelectedOrderFromParty[0]=1;assert(CheckBattleEntriesAndGetMessage()==0xff);
 mon->data[0]=1;assert(!GetBattleEntryEligibility(mon));mon->data[0]=0;
 mon->data[3]=0;assert(!GetBattleEntryEligibility(mon));mon->data[3]=1;
 assert(originalFacility==77);WholeGame_SetFRPartySelection(0);assert(!GetBattleEntryEligibility(mon));assert(originalFacility==77);
 return 0;}
'''
            (out/'validation.c').write_text(code)
            result=subprocess.run(['clang','-std=c99','-Werror',str(out/'validation.c'),'-o',str(out/'validation')],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'validation')],check=True,capture_output=True,timeout=5)


if __name__=='__main__':unittest.main()
