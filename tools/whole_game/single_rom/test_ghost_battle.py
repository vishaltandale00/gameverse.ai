"""Focused FireRed ghost-stage checks; full ROM qualification is separate."""
import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from .battle_services import stage_battle_services
from .ghost_battle import stage_ghost_battle


ROOT = Path(__file__).resolve().parents[3]
EMERALD = ROOT / 'local/decomps/pokeemerald'
FIRERED = ROOT / 'local/decomps/pokefirered'


class GhostBattleStageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='wg-ghost-')
        cls.out = Path(cls.scratch.name) / 'source'
        cls.pins = {str(root / rel): hashlib.sha256((root / rel).read_bytes()).hexdigest()
                    for root, rel in ((EMERALD, 'src/battle_setup.c'),
                                      (FIRERED, 'src/battle_setup.c'),
                                      (FIRERED, 'graphics/pokemon/ghost/front.png'))}
        shutil.copytree(EMERALD, cls.out, ignore=shutil.ignore_patterns('.git', '*.o', '*.gba', '*.elf'))
        stage_battle_services(EMERALD, FIRERED, cls.out)
        cls.report = stage_ghost_battle(EMERALD, FIRERED, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_typed_mode_and_source_rules(self):
        setup = (self.out / 'src/battle_setup.c').read_text()
        self.assertIn('mapId >= MAP_FR_POKEMON_TOWER_1F', setup)
        self.assertIn('mapId <= MAP_FR_POKEMON_TOWER_7F', setup)
        self.assertIn('!CheckBagHasItem(ITEM_SILPH_SCOPE, 1)', setup)
        self.assertIn('FR_SetGhostBattleMode(1);', setup)
        self.assertIn('FR_SetGhostBattleMode(0);', setup)
        self.assertNotIn('BATTLE_TYPE_GHOST', setup[setup.index('void BattleSetup_StartWildBattle'):setup.index('void BattleSetup_StartBattlePikeWildBattle')])
        commands = (self.out / 'src/battle_script_commands.c').read_text()
        self.assertIn('WholeGame_IsFireRedGhostBattle()', commands)
        self.assertIn('BALL_FR_GHOST_DODGE', commands)
        util = (self.out / 'src/battle_util.c').read_text()
        self.assertIn('CANCELER_GHOST', util)
        self.assertIn('BattleScript_FR_TooScaredToMove', util)
        self.assertIn('BattleScript_FR_GhostGetOutGetOut', util)
        self.assertIn('WholeGame_IsFireRedGhostWithoutScope()', util)

    def test_visual_and_metadata_paths(self):
        self.assertEqual((self.out / 'graphics/pokemon/ghost/front.png').read_bytes(),
                         (FIRERED / 'graphics/pokemon/ghost/front.png').read_bytes())
        graphics = (self.out / 'src/graphics.c').read_text()
        self.assertIn('gWholeGameFireRedGhostPic', graphics)
        self.assertIn('gWholeGameFireRedGhostPalette', graphics)
        self.assertIn('WholeGame_FireRedGhostBattleVersion',
                      (self.out / 'src/battle_gfx_sfx_util.c').read_text())
        self.assertIn('General_FR_SilphScoped', (self.out / 'data/battle_anim_scripts.s').read_text())
        self.assertIn('AnimTask_FR_GhostGetOut_Step3', (self.out / 'src/battle_anim_ghost.c').read_text())
        self.assertIn('WholeGame_IsFireRedGhostBattle()', (self.out / 'src/battle_interface.c').read_text())
        self.assertIn('WholeGame_IsFireRedGhostWithoutScope()', (self.out / 'src/reshow_battle_screen.c').read_text())
        self.assertIn('WholeGame_IsFireRedGhostWithScope()', (self.out / 'src/battle_main.c').read_text())
        self.assertEqual(self.report['witnessSymbol'], 'WholeGame_FireRedGhostBattleVersion')
        self.assertFalse(self.report['emulatedFlagBit15'])
        for path, pin in self.pins.items():
            self.assertEqual(hashlib.sha256(Path(path).read_bytes()).hexdigest(), pin)

    def test_rejects_canonical_output(self):
        with self.assertRaises(ValueError):
            stage_ghost_battle(EMERALD, FIRERED, EMERALD)


if __name__ == '__main__':
    unittest.main()
