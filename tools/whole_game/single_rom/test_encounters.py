"""Narrow source-transform checks; no ROM build or external dependencies."""
import json
from pathlib import Path
import tempfile
import re
import shutil
import subprocess
import time
import unittest
from tools.whole_game.single_rom.encounters import stage_encounters, rewrite, array_span, source_function

ROOT = Path(__file__).resolve().parents[3]
E = ROOT / 'local/decomps/pokeemerald'
F = ROOT / 'local/decomps/pokefirered'

LAST_METRICS = {}

class EncountersTest(unittest.TestCase):
    def test_lexical_rewrite(self):
        self.assertEqual(rewrite('A _("A") // A\n/* A */ A', {'A':'FR_A'}), 'FR_A _("A") // A\n/* A */ FR_A')
    def test_array_braces_in_text(self):
        text = 'const int a[]={ {1}, _("}"), /* } */ 2 };'
        a,b=array_span(text,'a'); self.assertEqual(text[a:b], ' {1}, _("}"), /* } */ 2 ')
    @unittest.skipUnless(E.exists() and F.exists(), 'local canonical source unavailable')
    def test_original_data_and_idempotence(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)
            for rel in ('src/data/trainers.h','include/constants/trainers.h','src/battle_main.c'):
                target=out/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((E/rel).read_bytes())
            report=stage_encounters(E,F,out)
            LAST_METRICS['first_transform_wall_seconds']=report['transform_wall_seconds']
            self.assertEqual(report['counts']['trainers'],743)
            self.assertEqual(report['counts']['trainer_pictures'],148)
            self.assertEqual(report['trainer_ids']['TRAINER_NONE'],0)
            self.assertEqual(report['trainer_ids']['TRAINER_CUE_BALL_PAXTON'],4838)
            trainers=(out/'src/data/trainers.h').read_text()
            self.assertNotIn('[FR_TRAINER_NONE]',trainers)
            self.assertIn('[FR_TRAINER_CUE_BALL_PAXTON]',trainers)
            self.assertIn('FR_sParty_',trainers)
            self.assertIn('.aiFlags = AI_SCRIPT_CHECK_BAD_MOVE',trainers)
            self.assertIn('AI_SCRIPT_CHECK_VIABILITY',trainers)
            self.assertIn('AI_SCRIPT_TRY_TO_FAINT',trainers)
            fr_ai=(F/'include/constants/battle_ai.h').read_text()
            em_ai=(E/'include/constants/battle_ai.h').read_text()
            self.assertRegex(fr_ai,r'AI_SCRIPT_CHECK_VIABILITY\s+\(1 << 1\)')
            self.assertRegex(em_ai,r'AI_SCRIPT_CHECK_VIABILITY\s+\(1 << 2\)')
            merged=json.loads((out/'src/data/wild_encounters.json').read_text())['wild_encounter_groups'][0]['encounters']
            donor=json.loads((F/'src/data/wild_encounters.json').read_text())['wild_encounter_groups'][0]['encounters']
            active=[x for x in donor if 'FireRed' in x['base_label']]
            self.assertEqual(len(active),132)
            self.assertEqual(len(merged),124+132)
            for original,actual in zip(active,merged[124:]):
                expected=json.loads(json.dumps(original));expected['map']=expected['map'].replace('MAP_','MAP_FR_',1);expected['base_label']='FR_'+expected['base_label']
                self.assertEqual(expected,actual)
            self.assertIn('#define FR_ITEM_POKE_FLUTE ITEM_POKE_FLUTE',(out/'include/constants/whole_game_fr_encounters.h').read_text())
            self.assertIn('[FR_TRAINER_PIC_RED]',(out/'src/data/trainer_graphics/front_pic_tables.h').read_text())
            self.assertTrue(report['build_ready'])
            code=(out/'src/firered_wild_encounter.c').read_text()
            self.assertIn('sWildEncounterData.encounterRateBuff', code)
            self.assertIn('MAX_ENCOUNTER_RATE 1600', code)
            self.assertIn('WholeGameFR_TryStartRoamerEncounter()', code)
            self.assertIn('WholeGameFR_GetRoamer()', code)
            self.assertIn('FR_IncrementGameStat(FR_GAME_STAT_FISHING_CAPTURES)', code)
            self.assertNotIn('FR_MAP_UNDEFINED', code)
            self.assertIn('return FR_TryStandardWildEncounterAtPlayer()', (out/'src/wild_encounter.c').read_text())
            self.assertIn('FR_MUS_ENCOUNTER_ROCKET', (out/'src/battle_setup.c').read_text())
            self.assertIn('value = WholeGame_IsKanto() ? VERSION_FIRE_RED : gGameVersion;', (out/'src/pokemon.c').read_text())
            self.assertIn('MON_DATA_MET_LOCATION, &value', (out/'src/pokemon.c').read_text())
            self.assertIn('sFireRedItemPrices[SanitizeItemId(itemId)]', (out/'src/item.c').read_text())
            self.assertIn('ARRAY_COUNT(gSaveBlock2Ptr->apprentices)', (out/'src/recorded_battle.c').read_text())
            self.assertIn('[FR_ITEM_RETRO_MAIL] = 50', (out/'src/data/firered/item_prices.h').read_text())
            if shutil.which('cc'):
                harness = r'''#include <stdint.h>
#include <assert.h>
typedef uint8_t u8; typedef uint8_t bool8; typedef uint16_t u16; typedef uint32_t u32;
#define TRUE 1
#define FALSE 0
#define HEADER_NONE 65535
#define MAP_UNDEFINED 65535
#define MAP_GROUP(x) ((x)>>8)
#define MAP_NUM(x) ((x)&255)
#define NUM_ALTERING_CAVE_TABLES 9
#define FR_VAR_ALTERING_CAVE_WILD_SET 1
#define FR_FLAG_SYS_UNLOCKED_TANOBY_RUINS 2
static int setting, unlocked;
static u16 VarGet(u16 id) {return setting;}
static bool8 FlagGet(u16 id) {return unlocked;}
struct Saved {struct {u8 mapGroup,mapNum;} location;} saved;
static struct Saved *gSaveBlock1Ptr=&saved;
struct WildPokemonHeader {u8 mapGroup,mapNum;};
static const struct WildPokemonHeader gWildMonHeaders[]={
{35,10},{35,8},{35,8},{35,8},{35,8},{35,8},{35,8},{35,8},{35,8},{35,8},{255,255}};
'''
                maps=['MONEAN','LIPTOO','WEEPTH','DILFORD','SCUFIB','RIXY','VIAPOIS']
                for i,name in enumerate(maps): harness+=f'#define MAP_FR_SEVEN_ISLAND_TANOBY_RUINS_{name}_CHAMBER ((35<<8)|{10+i})\n'
                harness+='#define MAP_FR_SIX_ISLAND_ALTERING_CAVE ((35<<8)|8)\n'
                harness+=source_function(code,'UnlockedTanobyOrAreNotInTanoby')+'\n'
                harness+=source_function(code,'GetCurrentMapWildMonHeaderId')+'\n'
                harness+=re.search(r'enum \{\s*FR_METATILE_ATTRIBUTE_BEHAVIOR.*?};',code,re.S)[0]+'\n'
                for table in ('sMetatileAttrMasks','sMetatileAttrShifts'):
                    harness+=re.search(r'static const u(?:8|32) '+table+r'.*?\n};',code,re.S)[0]+'\n'
                harness+=source_function(code,'FR_ExtractMetatileAttribute')+'\n'
                harness+=r'''int main(void) {
assert(FR_ExtractMetatileAttribute(0xffffffff,FR_METATILE_ATTRIBUTE_BEHAVIOR)==511);
assert(FR_ExtractMetatileAttribute(0xffffffff,FR_METATILE_ATTRIBUTE_ENCOUNTER_TYPE)==7);
assert(FR_ExtractMetatileAttribute(0xffffffff,FR_METATILE_ATTRIBUTE_LAYER_TYPE)==3);
assert(FR_ExtractMetatileAttribute(0x12345678,FR_METATILE_ATTRIBUTES_ALL)==0x12345678);
saved.location.mapGroup=35; saved.location.mapNum=10;
assert(GetCurrentMapWildMonHeaderId()==65535);
unlocked=1; assert(GetCurrentMapWildMonHeaderId()==0);
saved.location.mapNum=8; setting=0; assert(GetCurrentMapWildMonHeaderId()==1);
setting=8; assert(GetCurrentMapWildMonHeaderId()==9);
setting=9; assert(GetCurrentMapWildMonHeaderId()==1);
saved.location.mapNum=99; assert(GetCurrentMapWildMonHeaderId()==65535);
return 0;
}
'''
                source=out/'probe.c'; source.write_text(harness)
                compile_started=time.monotonic()
                compiled=subprocess.run(['cc','-std=c99',str(source),'-o',str(out/'probe')],capture_output=True,timeout=10)
                LAST_METRICS['host_fixture_compile_wall_seconds']=time.monotonic()-compile_started
                self.assertEqual(compiled.returncode,0,compiled.stderr.decode())
                execution_started=time.monotonic()
                subprocess.run([str(out/'probe')],check=True,capture_output=True,timeout=5)
                LAST_METRICS['host_fixture_execution_wall_seconds']=time.monotonic()-execution_started
            before={p.relative_to(out):p.read_bytes() for p in out.rglob('*') if p.is_file()}
            second=stage_encounters(E,F,out)
            LAST_METRICS['repeat_transform_wall_seconds']=second['transform_wall_seconds']
            after={p.relative_to(out):p.read_bytes() for p in out.rglob('*') if p.is_file()}
            self.assertEqual(before,after)

if __name__=='__main__': unittest.main()
