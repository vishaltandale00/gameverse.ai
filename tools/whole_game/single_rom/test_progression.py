"""Focused progression source-transform checks; no ROM build or game replay."""
import shutil
import tempfile
from pathlib import Path
import unittest

from tools.whole_game.single_rom.progression import stage_progression


ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


class ProgressionTests(unittest.TestCase):
    def _fixture(self, directory):
        out = Path(directory) / 'merged'
        for name in ('battle_util.c', 'battle_main.c', 'pokemon.c', 'battle_setup.c',
                     'main_menu.c', 'menu.c', 'trainer_card.c',
                     'post_battle_event_funcs.c', 'hall_of_fame.c', 'credits.c',
                     'field_control_avatar.c'):
            target = out / 'src' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BASE / 'src' / name, target)
        state = out / 'include/constants/whole_game_fr_state.h'
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text('\n'.join(
            f'#define FR_FLAG_BADGE0{i}_GET 0x{0x181f+i:04X}' for i in range(1, 9))
            + '\n#define FR_FLAG_SYS_GAME_CLEAR 0x182C\n'
            + '#define FR_FLAG_SYS_RIBBON_GET 0x183B\n')
        (out / 'include/whole_game_state.h').write_text('bool8 WholeGame_IsKanto(void);\n')
        return out

    def test_combat_badges_and_shared_displays_use_region_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self._fixture(directory)
            ledger = stage_progression(BASE, DONOR, out, Path(directory) / 'report')
            policy = (out / 'src/whole_game_progression.c').read_text()
            self.assertIn('FR_FLAG_BADGE08_GET', policy)
            self.assertIn('if (WholeGame_IsKanto())', policy)
            self.assertIn('FlagGet(sKantoBadgeFlags[badge])', policy)
            self.assertIn('bool8 FR_EnterHallOfFame(void)', policy)
            self.assertIn('FlagSet(FR_FLAG_SYS_GAME_CLEAR)', policy)
            self.assertIn('FR_HEAL_LOCATION_PALLET_TOWN', policy)
            for name in ('battle_util.c', 'battle_main.c', 'pokemon.c', 'battle_setup.c',
                         'main_menu.c', 'menu.c', 'trainer_card.c'):
                self.assertIn('WholeGame_HasRegionalBadge', (out / 'src' / name).read_text())
            post_battle = (out / 'src/post_battle_event_funcs.c').read_text()
            self.assertIn('gHasHallOfFameRecords = FlagGet(FLAG_SYS_GAME_CLEAR) || FlagGet(FR_FLAG_SYS_GAME_CLEAR)',
                          post_battle)
            self.assertIn('FlagSet(FLAG_SYS_GAME_CLEAR)', post_battle)
            self.assertFalse(ledger['buildEligible'])
            self.assertEqual(ledger['providers'][0]['target'], 'FR_EnterHallOfFame')
            for name in ('battle_util.c', 'battle_main.c', 'battle_setup.c', 'pokemon.c'):
                self.assertEqual(ledger['audit'].get(name, {}).get('remainingHoennBadgeReads', 0), 0)

    def test_rejects_canonical_output(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'isolated'):
                stage_progression(BASE, DONOR, BASE, Path(directory))


if __name__ == '__main__':
    unittest.main()
