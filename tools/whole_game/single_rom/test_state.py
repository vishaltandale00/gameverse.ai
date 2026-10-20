import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from tools.whole_game.single_rom import state
from tools.whole_game.single_rom.encounters import source_function

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'

class StateTests(unittest.TestCase):
    def test_namespace_boundaries(self):
        self.assertEqual([state.donor_flag(x) for x in (0, 1, 0x8ff, 0x4000)], [0, 0x1001, 0x18ff, 0x4000])
        for bad in (0x900, 0xfff, 0x4080):
            with self.assertRaises(ValueError): state.donor_flag(bad)
        self.assertEqual([state.donor_var(x) for x in (0x4000, 0x40ff, 0x8010, 0x8011, 0x8012, 0x8013)], [0x5000, 0x50ff, 0x8012, 0x8013, 0x8016, 0x8017])

    def test_trainers_sparse_and_disjoint(self):
        self.assertEqual(state.trainer_flag(863), 0x85f)
        self.assertEqual(state.trainer_flag(4096), 0)
        self.assertEqual(state.trainer_flag(4097), 0x1501)
        self.assertEqual(state.trainer_flag(4863), 0x17ff)
        for bad in (864, 1022, 1023, 1024, 2047, 2048, 4095, 4864):
            with self.assertRaises(ValueError): state.trainer_flag(bad)
        self.assertFalse(set(state.trainer_flag(x) for x in range(864)) & set(state.trainer_flag(x) for x in range(4096, 4864)))

    def test_all_source_constants(self):
        header = state.namespace_header(DONOR)
        self.assertIn('#define FR_FLAG_BADGE01_GET 0x1820', header)
        self.assertIn('#define FR_VAR_MON_BOX_ID 0x8012', header)
        self.assertIn('#define FR_VAR_TEXT_COLOR 0x8016', header)
        self.assertIn('#define FR_VAR_REPEL_STEP_COUNT 0x4021', header)
        self.assertIn('#define FR_FLAG_SYS_WHITE_FLUTE_ACTIVE 0x8AD', header)
        self.assertIn('#define FR_FLAG_SYS_BLACK_FLUTE_ACTIVE 0x8AE', header)
        self.assertNotIn('#define FR_TRAINER_', header)
        self.assertEqual(header, state.namespace_header(DONOR))

    def test_canonical_refused(self):
        with self.assertRaises(ValueError): state.apply(BASE, DONOR)

    def test_staged_patch_and_c_storage_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / 'staged'
            names = ['include/pokemon_storage_system.h', 'src/event_data.c', 'src/battle_setup.c', 'src/party_menu.c', 'src/field_control_avatar.c', 'src/overworld.c', 'src/save.c', 'include/constants/game_stat.h', 'data/maps/map_groups.json']
            for name in names:
                (stage / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(BASE / name, stage / name)
            receipt = state.apply(stage, DONOR)
            self.assertEqual(receipt['save_layout']['newStorageBytes'], 0x88BC)
            self.assertEqual(receipt['save_layout']['capacityBytes'], 0x8b80)
            self.assertEqual(receipt['status'], 'partial')
            text = (stage / 'src/event_data.c').read_text()
            # Compile the exact patched dispatch/get/set functions with bounded
            # source-shaped host storage; no emulator/full-ROM build required.
            start = text.index('u16 *GetVarPointer(')
            stop = text.index('// Fail compilation', start)
            body = text[start:stop]
            begin = body.index('u8 VarGetObjectEventGraphicsId')
            end = body.index('u8 *GetFlagPointer', begin)
            body = body[:begin] + body[end:]
            init = text[text.index('void InitEventData(void)'):text.index('void ClearTempFieldEventData(void)')]
            body = init + body
            preamble = '''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
#include <string.h>
typedef uint16_t u16; typedef uint8_t u8; typedef uint8_t bool8; typedef uint32_t u32; typedef int32_t s32;
#define TEMP_FLAGS_SIZE 4
#define FALSE 0
#define TRUE 1
#define VARS_START 0x4000
#define VARS_END 0x40ff
#define FLAGS_COUNT 0x960
#define SPECIAL_VARS_START 0x8000
#define SPECIAL_VARS_END 0x8015
#define SPECIAL_FLAGS_START 0x4000
#define SPECIAL_FLAGS_END 0x407f
struct {u8 flags[0x960/8]; u16 vars[256]; u32 gameStats[64];} native;
struct {struct {u8 flags[288];u16 vars[256];u32_placeholder;} unused;} dummy;
struct {struct {u8 flags[288]; u16 vars[256]; uint32_t schema, campaignInitialized; u8 rivalName[8]; u32 gameStats[64];} wholeGameKanto;} pc;
#define gSaveBlock1Ptr (&native)
#define gPokemonStoragePtr (&pc)
u16 special[22], *gSpecialVars[22], gSpecialVar_TextColor, gSpecialVar_PrevTextColor;
u8 sSpecialFlags[16];
struct {u32 encryptionKey;} native2;
#define gSaveBlock2Ptr (&native2)
#define NUM_GAME_STATS 64
#define NUM_USED_GAME_STATS 52
static int isKanto;
bool8 WholeGame_IsKanto(void){return isKanto;}
u32 FR_GetGameStat(u8); void FR_SetGameStat(u8,u32); void FR_ResetGameStats(void);
u32 GetGameStat(u8); void SetGameStat(u8,u32);
void ApplyNewEncryptionKeyToWord(u32 *word,u32 key){*word ^= native2.encryptionKey ^ key;}

'''.replace('struct {struct {u8 flags[288];u16 vars[256];u32_placeholder;} unused;} dummy;\n','')
            stats = (stage / 'src/overworld.c').read_text()
            body += '\n' + '\n'.join(source_function(stats, n) for n in ['FR_GetGameStat', 'FR_SetGameStat', 'FR_IncrementGameStat', 'FR_ResetGameStats', 'GetGameStat', 'SetGameStat', 'IncrementGameStat', 'ApplyNewEncryptionKeyToGameStats'])
            preamble += (stage / 'include/constants/whole_game_fr_state.h').read_text()
            main = '''int main(void) {
 for (int i=0;i<22;i++) gSpecialVars[i]=&special[i];
 memset(&pc, 0xff, sizeof(pc)); InitEventData();
 assert(pc.wholeGameKanto.schema==0x57470101); assert(pc.wholeGameKanto.campaignInitialized==0); assert(pc.wholeGameKanto.rivalName[0]==0);
 for (int i=1;i<0x900;i++) {FlagSet(i+0x1000); assert(FlagGet(i+0x1000)); assert(!FlagGet(i)); FlagClear(i+0x1000); assert(!FlagGet(i+0x1000));}
 for (int i=0;i<256;i++) {assert(VarSet(0x5000+i, i+100)); assert(VarGet(0x5000+i)==i+100); assert(VarGet(0x4000+i)==0);}
 assert(!GetFlagPointer(0)); assert(!GetFlagPointer(0x1900)); assert(!GetVarPointer(0x5100)); assert(!GetVarPointer(0x8018));
 VarSet(0x8012,71); assert(special[18]==71); assert(special[16]==0);
 VarSet(0x8016,3); assert(gSpecialVar_TextColor==3); assert(special[18]==71);
 assert(!VarSet(0x7000,1));
 InitEventData(); assert(VarGet(0x5001)==0); assert(pc.wholeGameKanto.campaignInitialized==0);
 VarSet(0x4021,200); assert(VarGet(FR_VAR_REPEL_STEP_COUNT)==200);
 VarSet(FR_VAR_REPEL_STEP_COUNT,199); assert(VarGet(0x4021)==199);
 FlagSet(0x8AD); assert(FlagGet(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE)); FlagClear(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE); assert(!FlagGet(0x8AD));
 FlagSet(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE); assert(FlagGet(0x8AE)); FlagClear(0x8AE); assert(!FlagGet(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE));
 SetGameStat(12,4);SetGameStat(32,8);SetGameStat(51,9);
 FR_SetGameStat(12,20);FR_SetGameStat(32,30);FR_SetGameStat(51,50);
 isKanto=1;assert(GetGameStat(12)==4);assert(GetGameStat(32)==8);assert(GetGameStat(51)==9);
 SetGameStat(5,100);IncrementGameStat(5);assert(FR_GetGameStat(5)==101);assert(native.gameStats[5]==0);
 FR_SetGameStat(7,0xFFFFFE);FR_IncrementGameStat(7);FR_IncrementGameStat(7);assert(FR_GetGameStat(7)==0xFFFFFF);
 FR_SetGameStat(255,99);assert(FR_GetGameStat(255)==0);
 ApplyNewEncryptionKeyToGameStats(0x87654321);native2.encryptionKey=0x87654321;
 assert(FR_GetGameStat(12)==20);assert(FR_GetGameStat(32)==30);assert(FR_GetGameStat(51)==50);assert(FR_GetGameStat(5)==101);
 assert(GetGameStat(12)==4);isKanto=0;assert(GetGameStat(5)==0);
 FR_ResetGameStats();assert(FR_GetGameStat(12)==0);assert(FR_GetGameStat(51)==0);
 return 0;
}'''
            c = stage / 'check.c'; c.write_text(preamble + body + main)
            subprocess.run(['cc', '-std=c99', '-Wall', '-Werror', str(c), '-o', str(stage / 'check')], check=True, capture_output=True)
            subprocess.run([str(stage / 'check')], check=True, capture_output=True)

    def test_partial_save_includes_only_tail_sector(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / 'staged'
            for name in ['include/pokemon_storage_system.h', 'src/event_data.c', 'src/battle_setup.c', 'src/party_menu.c', 'src/field_control_avatar.c', 'src/overworld.c', 'src/save.c', 'include/constants/game_stat.h', 'data/maps/map_groups.json']:
                (stage/name).parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(BASE/name,stage/name)
            state.apply(stage,DONOR)
            body=source_function((stage/'src/save.c').read_text(),'HandleSavingData')
            preamble = '''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef uint8_t u8;typedef uint32_t u32;
enum {SAVE_NORMAL,SAVE_LINK,SAVE_EREADER,SAVE_HALL_OF_FAME,SAVE_HALL_OF_FAME_ERASE_BEFORE,SAVE_OVERWRITE_DIFFERENT_FILE};
#define SECTOR_ID_HOF_1 28
#define SECTOR_ID_HOF_2 29
#define SECTORS_COUNT 32
#define SECTOR_ID_SAVEBLOCK2 0
#define SECTOR_ID_SAVEBLOCK1_END 4
#define SECTOR_ID_PKMN_STORAGE_END 13
#define FULL_SAVE_SLOT 0xffff
#define SECTOR_DATA_SIZE 3968
#define GAME_STAT_ENTERED_HOF 10
u32 *gTrainerHillVBlankCounter;
u8 gDecompressionBuffer[7936];
int gRamSaveSectorLocations[14],writes,signatures,full,copied;
int order[32],count;
void UpdateSaveAddresses(void){}
void EraseFlashSector(int n){}
int GetGameStat(int n){return 1;}
void IncrementGameStat(int n){}
void CopyPartyAndObjectsToSave(void){copied++;}
void WriteSaveSectorOrSlot(int n,void *p){assert(n==0xffff);full++;}
void HandleWriteSectorNBytes(int n,void *p,int size){}
void HandleReplaceSector(int n,void *p){order[count++]=n;writes++;}
void WriteSectorSignatureByte_NoOffset(int n,void *p){order[count++]=100+n;signatures++;}
'''
            main='''int main(void){u32 sentinel=0;gTrainerHillVBlankCounter=&sentinel;
for(int mode=SAVE_LINK;mode<=SAVE_EREADER;mode++){
 writes=signatures=full=copied=count=0;HandleSavingData(mode);
 assert(writes==6&&signatures==6&&full==0&&copied==1);assert(gTrainerHillVBlankCounter==&sentinel);
 for(int i=0;i<5;i++){assert(order[i]==i);assert(order[6+i]==100+i);}
 assert(order[5]==13);assert(order[11]==113);
}
writes=signatures=full=0;HandleSavingData(SAVE_NORMAL);assert(full==1&&writes==0&&signatures==0);return 0;}'''
            path=stage/'save-check.c';path.write_text(preamble+body+main)
            result=subprocess.run(['cc','-std=c99','-Werror',str(path),'-o',str(stage/'save-check')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(stage/'save-check')],check=True,capture_output=True)

if __name__ == '__main__': unittest.main()
