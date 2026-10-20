"""Bounded source-transform and native host initialization checks; no ROM build."""
from __future__ import annotations
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from . import campaign, scripts, state

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


class CampaignTests(unittest.TestCase):
    def test_real_initial_state(self):
        value = campaign.initial_world_state(DONOR)
        self.assertEqual(len(value['operations']), 50)
        self.assertEqual(value['operations'][-1], ['var', 'VAR_MASSAGE_COOLDOWN_STEP_COUNTER', 500])
        self.assertIn('FLAG_HIDDEN_ITEM_ROUTE20_STARDUST', value['renewableFlags'])
        self.assertFalse(any('BADGE' in op[1] for op in value['operations']))

    def test_source_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            donor = Path(temporary)
            (donor / 'data').mkdir()
            (donor / 'data/event_scripts.s').write_text('EventScript_ResetAllMapFlags::\n\tspecial Unexpected\n\tend\n')
            with self.assertRaisesRegex(ValueError, 'unsupported donor initialization'):
                campaign.initial_world_state(donor)

    def test_oak_adaptation_preserves_choice_and_story(self):
        original = (DONOR / 'data/maps/PalletTown_ProfessorOaksLab/scripts.inc').read_text()
        tokens = set(re.findall(r'\b[A-Za-z_]\w*\b', original))
        imported = scripts.rewrite_tokens(original, {token: 'FR_' + token for token in tokens})
        changed = campaign.adapt_oak_starter(imported)
        entry = changed.split('FR_PalletTown_ProfessorOaksLab_EventScript_ChoseStarter::\n')[1]
        self.assertLess(entry.index('getpartysize'), entry.index('FR_removeobject'))
        self.assertIn('FR_copyvar FR_VAR_0x8004, FR_VAR_TEMP_5', changed)
        self.assertIn('FR_givemon FR_PLAYER_STARTER_SPECIES, 5', changed)
        self.assertEqual(changed.count('FR_trainerbattle_earlyrival'), 3)
        self.assertEqual(changed.count('FR_copyvar FR_VAR_STARTER_MON, FR_PLAYER_STARTER_NUM'), 1)
        self.assertNotIn('ZeroPlayerParty', changed)

    def test_repeat_or_wrong_namespace_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Oak gift entry'):
            campaign.adapt_oak_starter('bad')
        with self.assertRaisesRegex(ValueError, 'isolated'):
            campaign.stage_campaign(BASE, DONOR, BASE)

    def test_staged_native_maps_and_first_arrival(self):
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary) / 'staged'
            (out / 'include/constants').mkdir(parents=True)
            (out / 'include/constants/whole_game_fr_state.h').write_text(state.namespace_header(DONOR))
            (out / 'include/pokemon_storage_system.h').write_text('campaignInitialized rivalName')
            for source, destination in [(BASE / 'data/maps/LittlerootTown/map.json', 'data/maps/LittlerootTown/map.json'),
                                        (DONOR / 'data/maps/PalletTown/map.json', 'data/maps/FRPalletTown/map.json'),
                                        (BASE / 'data/event_scripts.s', 'data/event_scripts.s'),
                                        (BASE / 'src/naming_screen.c', 'src/naming_screen.c'),
                                        (BASE / 'include/naming_screen.h', 'include/naming_screen.h')]:
                target = out / destination
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            original = (DONOR / 'data/maps/PalletTown_ProfessorOaksLab/scripts.inc').read_text()
            tokens = set(re.findall(r'\b[A-Za-z_]\w*\b', original))
            imported = scripts.rewrite_tokens(original, {token: 'FR_' + token for token in tokens})
            lab = out / 'data/maps/FRPalletTown_ProfessorOaksLab/scripts.inc'
            lab.parent.mkdir(parents=True)
            lab.write_text(imported)
            report = campaign.stage_campaign(BASE, DONOR, out)
            self.assertFalse(report['buildEligible'])
            self.assertEqual(len(report['changed_files']), 10)
            guides = [json.loads((out / f'data/maps/{name}/map.json').read_text())['object_events'][-1]
                      for name in ('LittlerootTown', 'FRPalletTown')]
            self.assertEqual([obj['script'] for obj in guides], ['WholeGame_EventScript_HoennGuide', 'WholeGame_EventScript_KantoGuide'])
            travel = (out / 'data/scripts/whole_game_campaign.inc').read_text()
            self.assertEqual(travel.count('callnative WholeGame_InitializeKanto'), 1)
            self.assertIn('warp MAP_FR_PALLET_TOWN', travel)
            self.assertIn('warp MAP_LITTLEROOT_TOWN', travel)
            self.assertNotIn('setflag FLAG_BADGE', travel)
            with self.assertRaisesRegex(ValueError, 'already applied'):
                campaign.stage_campaign(BASE, DONOR, out)

    @unittest.skipUnless(shutil.which('clang'), 'host clang unavailable')
    def test_generated_c_initializes_once_and_preserves_native_state(self):
        """Execute actual emitted bootstrap against production FR numeric constants."""
        value = campaign.initial_world_state(DONOR)
        constants = state._constants(DONOR)
        expected_flags = {state.donor_flag(constants[op[1]]) for op in value['operations'] + value['compatibilityOperations'] if op[0] == 'flag'}
        expected_flags.update(state.donor_flag(constants[name]) for name in value['renewableFlags'])
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            (work / 'constants').mkdir()
            (work / 'constants/whole_game_fr_state.h').write_text(state.namespace_header(DONOR))
            (work / 'global.h').write_text('#include <stdint.h>\ntypedef uint8_t bool8; typedef uint8_t u8;\n#define FALSE 0\n#define TRUE 1\n#define _(s) s\n')
            (work / 'event_data.h').write_text('extern unsigned gSpecialVar_Result; void FlagSet(unsigned); void VarSet(unsigned,unsigned);\n')
            (work / 'constants/characters.h').write_text('#define EOS 0xff\n')
            (work / 'whole_game_fr_encounters.h').write_text('void FR_SeedWildEncounterRng(unsigned short);\n')
            (work / 'whole_game_world_services.h').write_text('void FR_ResetTrainerTowerState(void); void FR_ResetEReaderTrainer(void);\n')
            (work / 'firered_fame_checker.h').write_text('void FR_ResetFameChecker(void);\n')
            (work / 'whole_game_campaign.h').write_text('const u8 *WholeGame_GetRivalName(void);\n')
            (work / 'random.h').write_text('unsigned short Random(void);\n')
            (work / 'string_util.h').write_text('void StringCopy(unsigned char *, const unsigned char *);\n')
            (work / 'pokemon_storage_system.h').write_text('struct Storage { unsigned nativeSentinel; struct { unsigned campaignInitialized; unsigned char rivalName[8]; } wholeGameKanto; }; extern struct Storage *gPokemonStoragePtr;\n')
            (work / 'init.c').write_text(campaign._init_source(value))
            flags = ','.join(map(str, sorted(expected_flags)))
            (work / 'test.c').write_text('''#include <assert.h>
#include <string.h>
#include "global.h"
#include "pokemon_storage_system.h"
struct Storage storage = {123456}; struct Storage *gPokemonStoragePtr = &storage;
unsigned char flags[0x1900]; unsigned vars[0x100]; unsigned writes; unsigned gSpecialVar_Result; unsigned seeds, fameResets, towerResets, ereaderResets;
void FR_ResetEReaderTrainer(void) { assert(storage.wholeGameKanto.campaignInitialized == 0); ereaderResets++; }
void FR_ResetFameChecker(void) { assert(storage.wholeGameKanto.campaignInitialized == 0); fameResets++; }
void FR_ResetTrainerTowerState(void) { assert(storage.wholeGameKanto.campaignInitialized == 0); towerResets++; }
unsigned short Random(void) { return 4242; }
void FR_SeedWildEncounterRng(unsigned short seed) { assert(seed==4242); seeds++; }
void FlagSet(unsigned n) { assert(n >= 0x1000 && n < 0x1900); flags[n] = 1; writes++; }
void VarSet(unsigned n,unsigned v) { assert(n >= 0x5000 && n < 0x5100); vars[n-0x5000] = v; writes++; }
void StringCopy(unsigned char *d,const unsigned char *s) { strcpy((char *)d,(const char *)s); }
bool8 WholeGame_InitializeKanto(void);
const u8 *WholeGame_GetRivalName(void);
int main(void) {
    unsigned i, firstWrites, expected[] = {''' + flags + '''};
    assert(WholeGame_InitializeKanto() == 0);
    for (i=0; i<sizeof(expected)/sizeof(expected[0]); i++) assert(flags[expected[i]]);
    assert(storage.nativeSentinel == 123456);
    assert(storage.wholeGameKanto.campaignInitialized == 0x4B414E31);
    assert(storage.wholeGameKanto.rivalName[0] == 0xff && gSpecialVar_Result == 1);
    assert(seeds == 1 && fameResets == 1 && towerResets == 1 && ereaderResets == 1);
    assert(WholeGame_GetRivalName() == storage.wholeGameKanto.rivalName);
    firstWrites = writes;
    memset(flags,0,sizeof(flags)); vars[0] = 4321;
    strcpy((char *)storage.wholeGameKanto.rivalName,"GARY");
    WholeGame_InitializeKanto();
    assert(writes == firstWrites && vars[0] == 4321 && storage.nativeSentinel == 123456 && gSpecialVar_Result == 0);
    assert(!strcmp((char *)storage.wholeGameKanto.rivalName,"GARY") && seeds == 1 && fameResets == 1 && towerResets == 1 && ereaderResets == 1);
    return 0;
}
''')
            subprocess.run(['clang', '-std=c99', '-Werror', '-I', str(work), str(work / 'init.c'), str(work / 'test.c'), '-o', str(work / 'test')], check=True, timeout=20, capture_output=True)
            subprocess.run([str(work / 'test')], check=True, timeout=5, capture_output=True)


if __name__ == '__main__':
    unittest.main()
