"""Narrow world-service staging regressions; no full ROM build."""
import tempfile
from pathlib import Path
import unittest

from tools.whole_game.single_rom.world_services import stage_world_services


ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


class WorldServicesTests(unittest.TestCase):
    def _fixture(self, root: Path) -> Path:
        output = root / 'stage'
        paths = ('include/pokemon_storage_system.h', 'src/safari_zone.c',
                 'src/overworld.c', 'src/battle_main.c', 'src/item.c',
                 'src/load_save.c', 'src/new_game.c')
        for relative in paths:
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            text = (BASE / relative).read_text()
            if relative == 'include/pokemon_storage_system.h':
                text = text.replace('    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];',
                                    '    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];\n'
                                    '    struct {\n        u8 rivalName[8];\n    } wholeGameKanto;')
            target.write_text(text)
        header = output / 'include/constants/whole_game_fr_state.h'
        header.parent.mkdir(parents=True, exist_ok=True)
        header.write_text('#define FR_VAR_REPEL_STEP_COUNT 0x5020\n'
                          '#define FR_FLAG_SYS_WHITE_FLUTE_ACTIVE 0x1803\n'
                          '#define FR_FLAG_SYS_BLACK_FLUTE_ACTIVE 0x1804\n')
        items = output / 'src/data/items.h'
        items.parent.mkdir(parents=True, exist_ok=True)
        items.write_text('[ITEM_TM_CASE] = { .fieldUseFunc = ItemUseOutOfBattle_CannotUse },\n'
                         '[ITEM_BERRY_POUCH] = { .fieldUseFunc = ItemUseOutOfBattle_CannotUse },\n')
        return output

    def test_port_retains_donor_roamer_and_native_safari_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = self._fixture(root)
            ledger = stage_world_services(BASE, DONOR, output, root / 'report')
            roamer = (output / 'src/firered_world_roamer.c').read_text()
            safari = (output / 'src/firered_world_safari.c').read_text()
            self.assertIn('MAP_FR_ROUTE25', roamer)
            self.assertIn('FR_TryStartRoamerEncounter', roamer)
            self.assertIn('wholeGameKanto.frRoamerHistory', roamer)
            self.assertIn('FR_SafariZone_EventScript_TimesUp', safari)
            self.assertIn('frSafariSteps = 600', safari)
            self.assertIn('FR_CB2_EndSafariBattle', (output / 'src/safari_zone.c').read_text())
            self.assertIn('FR_UpdateRoamerHPStatus', (output / 'src/battle_main.c').read_text())
            self.assertIn('FR_VAR_REPEL_STEP_COUNT VAR_REPEL_STEP_COUNT',
                          (output / 'include/constants/whole_game_fr_state.h').read_text())
            items = (output / 'src/data/items.h').read_text()
            self.assertIn('.fieldUseFunc = FR_ItemUseOutOfBattle_TMCase', items)
            self.assertIn('.fieldUseFunc = FR_ItemUseOutOfBattle_BerryPouch', items)
            bag = (output / 'src/firered_world_bag.c').read_text()
            self.assertIn('RemoveBagItem(container, 1)', bag)
            self.assertIn('GoToBagMenu(ITEMMENULOCATION_LAST, TMHM_POCKET, NULL)', bag)
            self.assertIn('return FR_AddBagItem(itemId, count)', (output / 'src/item.c').read_text())
            tower = (output / 'src/firered_world_trainer_tower.c').read_text()
            self.assertIn('frTrainerTower[challenge].spokeToOwner', tower)
            self.assertIn('WholeGameFR_GetTrainerTowerRecords', tower)
            self.assertIn('WholeGameFR_GetTowerChallengeIdPtr', tower)
            self.assertIn('215999 ^ gSaveBlock2Ptr->encryptionKey', tower)
            self.assertIn('FR_DisableTowerTimer();', tower)
            self.assertIn('FR_ApplyNewEncryptionKeyToTrainerTower',
                          (output / 'src/load_save.c').read_text())
            self.assertIn('FR_ResetTrainerTowerState();',
                          (output / 'src/new_game.c').read_text())
            self.assertIn('sizeof(struct FR_TrainerTower) == 12',
                          (output / 'include/pokemon_storage_system.h').read_text())
            storage = (output / 'include/pokemon_storage_system.h').read_text()
            self.assertIn('u32 frEReaderTrainer[47];', storage)
            self.assertIn('void *WholeGameFR_GetEReaderTrainer(void)', tower)
            self.assertIn('FR_ResetEReaderTrainer();', (output / 'src/new_game.c').read_text())
            self.assertEqual(ledger['saveLayout']['addedBytes'], 280)
            self.assertFalse(ledger['buildEligible'])

    def test_refuses_canonical_output(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'isolated'):
                stage_world_services(BASE, DONOR, DONOR, Path(directory))

    def test_shared_state_aliases_accept_current_native_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = self._fixture(root)
            constants = output / 'include/constants/whole_game_fr_state.h'
            constants.write_text(constants.read_text().replace('0x5020', '0x4021')
                                 .replace('0x1803', '0x8AD').replace('0x1804', '0x8AE'))
            stage_world_services(BASE, DONOR, output, root / 'report')
            aliases = constants.read_text()
            self.assertIn('FR_VAR_REPEL_STEP_COUNT VAR_REPEL_STEP_COUNT', aliases)
            self.assertIn('FR_FLAG_SYS_WHITE_FLUTE_ACTIVE FLAG_SYS_ENC_UP_ITEM', aliases)


if __name__ == '__main__':
    unittest.main()
