"""Bounded source/native destination checks, no ROM or campaign simulation."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from . import travel, state, campaign
ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


def minimal_stage(out):
    for relative in ('include/pokemon_storage_system.h', 'src/overworld.c', 'data/event_scripts.s'):
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / relative, target)
    storage = out / 'include/pokemon_storage_system.h'
    storage.write_text(storage.read_text().replace('    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];',
        '    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];\n    struct { struct WarpData lastHeal[2]; u32 healSchema; } wholeGameKanto;'))
    path = out / 'data/scripts/whole_game_campaign.inc'
    path.parent.mkdir(parents=True)
    path.write_text(campaign.TRAVEL)


class TravelTests(unittest.TestCase):
    def test_all_actual_heals_have_distinct_ids_and_original_npcs(self):
        native, rows = travel.heal_records(BASE, DONOR)
        self.assertEqual((len(native),len(rows)),(22,20))
        self.assertEqual([r['idValue'] for r in rows],list(range(23,43)))
        self.assertEqual(rows[0]['respawn_map'],'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F')
        self.assertEqual(rows[9]['respawn_map'],'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F')
        self.assertTrue(all(0 < r['npcValue'] < 16 for r in rows))

    def test_stage_preserves_native_ids_and_inserts_actual_lifecycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            out=Path(temporary); minimal_stage(out)
            ledger=travel.stage_travel(BASE,DONOR,out)
            combined=json.loads((out/'src/data/heal_locations.json').read_text())['heal_locations']
            self.assertEqual(combined[:22],travel.heal_records(BASE,DONOR)[0])
            self.assertEqual(len(combined),42)
            self.assertEqual(combined[22]['map'],'MAP_FR_PALLET_TOWN')
            over=(out/'src/overworld.c').read_text()
            self.assertIn('RemoveMoney(&gSaveBlock1Ptr->money, FR_ComputeWhiteOutMoneyLoss())',over)
            self.assertIn('FR_SetWhiteoutRespawnWarpAndHealerNpc(&sWarpDestination)',over)
            self.assertIn('(GetPlayerFacingDirection() != DIR_SOUTH)',over)
            self.assertIn('MAP_FR_VIRIDIAN_FOREST',over)
            # Teleport remains exterior; only blackout uses original nurse/mom interiors.
            self.assertIn('void SetWarpDestinationToLastHealLocation(void)\n{\n    sWarpDestination = gSaveBlock1Ptr->lastHealLocation;\n}',over)
            self.assertEqual(over.count('VarSet(FR_VAR_MAP_SCENE_ROUTE16, 0)'),4)
            self.assertFalse(ledger['buildEligible'])
            self.assertEqual(ledger['donorHealCount'],20)
            with self.assertRaisesRegex(ValueError,'already applied'):
                travel.stage_travel(BASE,DONOR,out)

    def test_runtime_contains_original_tasks_and_no_success_fallbacks(self):
        _,rows=travel.heal_records(BASE,DONOR)
        source=travel.runtime_source(DONOR,rows)
        for name in ('FR_Task_RushInjuredPokemonToCenter','FR_ComputeWhiteOutMoneyLoss','FR_SetCB2WhiteOut'):
            self.assertIn(name,source)
        self.assertIn('FR_TrainerTowerSpokeToOwner()',source)
        self.assertIn('FR_ForestMapPreviewScreenIsRunning()',source)
        self.assertIn('FR_EventScript_AfterWhiteOutMomHeal',source)
        self.assertNotIn('‥', source)
        self.assertIn('windowId, FR_FONT_NORMAL,', source)
        self.assertNotIn('ZeroPlayerPartyMons',source)

    def test_canonical_output_rejected(self):
        with self.assertRaisesRegex(ValueError,'isolated'):
            travel.stage_travel(BASE,DONOR,BASE)

    @unittest.skipUnless(shutil.which('clang'),'clang unavailable')
    def test_emitted_original_respawns_execute_all_twenty_points(self):
        """Actual emitted table+source functions execute against native ABI fixture."""
        _,rows=travel.heal_records(BASE,DONOR)
        emitted=travel.runtime_source(DONOR,rows)
        functions={f.name:f.source for f in travel.functions(emitted,'emitted.c')}
        text='''#include <assert.h>
#include <stddef.h>
typedef unsigned char u8; typedef signed char s8; typedef unsigned short u16; typedef unsigned u32; typedef int s32;
#define ARRAY_COUNT(a) (sizeof(a)/sizeof(a[0]))
#define NELEMS(a) ARRAY_COUNT(a)
#define MAP_GROUP(m) ((m)>>8)
#define MAP_NUM(m) ((m)&255)
#define WARP_ID_NONE (-1)
#define FR_HEAL_LOCATION_NONE 0
struct HealLocation { s8 mapGroup,mapNum; u16 x,y; };
struct WarpData { s8 mapGroup,mapNum,warpId; short x,y; };
struct Save { struct WarpData lastHealLocation; unsigned money; } save,*gSaveBlock1Ptr=&save;
unsigned gSpecialVar_LastTalked, tower, reset;
unsigned VarGet(unsigned n) { return tower; }
void VarSet(unsigned n,unsigned v) { reset++; }
unsigned FR_TrainerTowerSpokeToOwner(void) { return 0; }
static void FR_SetWhiteoutRespawnHealerNpcAsLastTalked(u32);
static u8 FR_CountBadgesForOverworldWhiteOutLossCalculation(void);
static u8 FR_GetPlayerPartyHighestLevel(void);
struct Pokemon { unsigned hasSpecies, egg, level; } gPlayerParty[6];
#define PARTY_SIZE 6
#define MON_DATA_SANITY_HAS_SPECIES 0
#define MON_DATA_SANITY_IS_EGG 1
#define MON_DATA_LEVEL 2
unsigned badgeCount;
unsigned FlagGet(unsigned n) { return n < badgeCount; }
unsigned GetMoney(unsigned *p) { return *p; }
unsigned GetMonData(struct Pokemon *p,unsigned field,void *unused) { return field==0?p->hasSpecies:field==1?p->egg:p->level; }
#define FR_FLAG_BADGE01_GET 0
#define FR_FLAG_BADGE02_GET 1
#define FR_FLAG_BADGE03_GET 2
#define FR_FLAG_BADGE04_GET 3
#define FR_FLAG_BADGE05_GET 4
#define FR_FLAG_BADGE06_GET 5
#define FR_FLAG_BADGE07_GET 6
#define FR_FLAG_BADGE08_GET 7

'''
        maps=set(re.findall(r'\bMAP_FR_[A-Z_0-9]+\b',emitted))
        # Numeric map fixture is distinct per original map; group semantics exercised.
        numeric={name:((34+i//128)<<8)|(i%128) for i,name in enumerate(sorted(maps))}
        text+='\n'.join(f'#define {name} {value}' for name,value in numeric.items())+'\n'
        text+='#define FR_VAR_MAP_SCENE_TRAINER_TOWER 0x508A\n'
        for pattern in (r'static const struct HealLocation sFRHealLocations\[\].*?\n\};',
                        r'static const u16 sFRRespawnMaps\[\]\[2\].*?\n\};',
                        r'static const u8 sFRRespawnNpcs\[\].*?;',
                        r'static const u8 sFRMoneyMultipliers\[\].*?\n\};',
                        r'static const u16 sFRBadgeFlags\[\].*?\n\};'):
            text+=re.search(pattern,emitted,re.S)[0]+'\n'
        for name in ('FR_GetHealLocationIndexFromMapGroupAndNum','FR_SetWhiteoutRespawnHealerNpcAsLastTalked','FR_SetWhiteoutRespawnWarpAndHealerNpc', 'FR_GetPlayerPartyHighestLevel', 'FR_CountBadgesForOverworldWhiteOutLossCalculation', 'FR_ComputeWhiteOutMoneyLoss'):
            text+=functions[name]+'\n'
        text+='int main(void) { struct WarpData out; unsigned i,b,level,expected,multipliers[]={2,4,6,9,12,16,20,25,30};\n'
        for index,row in enumerate(rows):
            mapname='MAP_FR_'+row['map'][4:]; respawn='MAP_FR_'+row['respawn_map'][4:]
            if index==0: xy=(8,5)
            elif index==9:xy=(13,12)
            elif index==13:xy=(5,4)
            else:xy=(7,4)
            text+=f'save.lastHealLocation.mapGroup=MAP_GROUP({mapname}); save.lastHealLocation.mapNum=MAP_NUM({mapname});\n'
            text+=f'FR_SetWhiteoutRespawnWarpAndHealerNpc(&out); assert(out.mapGroup==MAP_GROUP({respawn}) && out.mapNum==MAP_NUM({respawn}) && out.x=={xy[0]} && out.y=={xy[1]} && out.warpId==-1 && gSpecialVar_LastTalked=={row["npcValue"]});\n'
        text+='tower=1; FR_SetWhiteoutRespawnWarpAndHealerNpc(&out); assert(out.mapGroup==MAP_GROUP(MAP_FR_TRAINER_TOWER_LOBBY) && out.mapNum==MAP_NUM(MAP_FR_TRAINER_TOWER_LOBBY) && out.x==4 && out.y==11 && reset==1);\n'
        text+='gPlayerParty[0].hasSpecies=1;gPlayerParty[1].hasSpecies=1;gPlayerParty[1].egg=1;gPlayerParty[1].level=100;save.money=5000;\n'
        text+='for(b=0;b<=8;b++)for(level=1;level<=100;level++){badgeCount=b;gPlayerParty[0].level=level;expected=level*4*multipliers[b];if(expected>5000)expected=5000;assert(FR_ComputeWhiteOutMoneyLoss()==expected);assert(save.money==5000);assert(gPlayerParty[0].level==level && gPlayerParty[1].egg==1);}return 0; }\n'
        with tempfile.TemporaryDirectory() as temporary:
            out=Path(temporary); (out/'test.c').write_text(text)
            result = subprocess.run(['clang','-std=c99','-Werror',str(out/'test.c'),'-o',str(out/'test')],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            subprocess.run([str(out/'test')],capture_output=True,check=True,timeout=5)


if __name__=='__main__':unittest.main()
