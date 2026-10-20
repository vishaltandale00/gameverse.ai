"""Focused Oak source/dispatch checks; no ROM or campaign qualification."""
from pathlib import Path
import re
import tempfile
import unittest

from tools.whole_game.single_rom.battle_tutorial import (
    CONTROLLER, FONTS, TARGET, _declaration, stage_battle_tutorial,
)
from tools.whole_game.single_rom.native_services import functions

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local source inputs unavailable')
class OakTutorialTests(unittest.TestCase):
    def test_original_controller_closure_and_native_region_split(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            report = stage_battle_tutorial(BASE, DONOR, out)
            source = (out / TARGET).read_text()
            original = functions((DONOR / CONTROLLER).read_text(), CONTROLLER)
            emitted = {f.name: f for f in functions(source, TARGET)}
            self.assertEqual(len(original), 107)
            for function in original:
                self.assertIn('FR_' + function.name, emitted)
            self.assertNotIn('BATTLE_TYPE_FIRST_BATTLE', source)
            self.assertNotIn('BATTLE_TYPE_OLD_MAN_TUTORIAL', source)
            self.assertNotIn('gBattleStruct->simulatedInputState', source)
            self.assertIn('FR_TRAINER_BACK_PIC_OLD_MAN', source)
            self.assertIn('FR_InitOldManBag();', source)
            self.assertIn('WholeGame_IsFireRedOldManTutorialBattle()', source)
            self.assertIn('FR_sOakSimulatedInputState[2] |= mask;', source)
            self.assertIn('FR_ContextNpcGetTextColor()', source)
            self.assertNotIn('u8 FR_ContextNpcGetTextColor(void)\n{', source)
            for font in FONTS.values():
                self.assertIn(font, source)
            native = (out / 'src/battle_controllers.c').read_text()
            self.assertIn('= SetControllerToWally;', native)
            self.assertIn('= FR_SetControllerToOakOrOldMan;', native)
            self.assertIn('CreateMon(&gEnemyParty[0], SPECIES_ZIGZAGOON', native)
            self.assertFalse(report['ready'])
            self.assertIsNone(report['measurements']['buildSeconds'])

    def test_hooks_preserve_rng_and_original_engine_flag_behavior(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            stage_battle_tutorial(BASE, DONOR, out)
            commands = (out / 'src/battle_script_commands.c').read_text()
            function = next(f.source for f in functions(commands, 'x') if f.name == 'Cmd_accuracycheck')
            self.assertLess(function.index('WholeGame_IsFireRedTutorialBattle()'), function.index('if (move == NO_ACC_CALC'))
            self.assertIn('FR_BtlCtrl_OakOldMan_TestState2Flag(1)', function)
            self.assertIn('FR_BtlCtrl_OakOldMan_TestState2Flag(2)', function)
            critical = next(f.source for f in functions(commands, 'x') if f.name == 'Cmd_critcalc')
            self.assertLess(critical.index('Random()'), critical.index('WholeGame_IsFireRedTutorialBattle()'))
            self.assertIn('BATTLE_TYPE_WALLY_TUTORIAL | BATTLE_TYPE_FIRST_BATTLE', critical)
            bg = (out / 'src/battle_bg.c').read_text()
            self.assertIn('WholeGame_IsFireRedOldManTutorialBattle()) ? sWholeGameOakWindowTemplates : gBattleWindowTemplates', bg)
            donor_template = _declaration((DONOR / 'src/battle_bg.c').read_text(), 'sStandardBattleWindowTemplates')
            self.assertIn(donor_template.replace('sStandardBattleWindowTemplates', 'sWholeGameOakWindowTemplates').replace('[B_WIN_OAK_OLD_MAN]', '[24]'), bg)
            self.assertIn('gDisplayedStringBattle[0] = EOS;', (out / TARGET).read_text())
            main = (out / 'src/battle_main.c').read_text()
            finish = next(f.source for f in functions(main, 'x') if f.name == 'HandleEndTurn_FinishBattle')
            self.assertIn('&& !WholeGame_IsFireRedTutorialBattle()', finish)

    def test_staging_is_repeatable_and_refuses_canonical_output(self):
        with self.assertRaisesRegex(ValueError, 'canonical'):
            stage_battle_tutorial(BASE, DONOR, BASE)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            stage_battle_tutorial(BASE, DONOR, out)
            first = {str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()}
            stage_battle_tutorial(BASE, DONOR, out)
            self.assertEqual(first, {str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()})

    def test_command_and_message_ids_bind_to_native_meanings(self):
        def command_ids(root):
            text = (root / 'include/battle_controllers.h').read_text()
            start = text.index('CONTROLLER_GETMONDATA')
            stop = text.index('CONTROLLER_CMDS_COUNT', start)
            return {name: i for i, name in enumerate(re.findall(r'\bCONTROLLER_\w+', text[start:stop]))}
        donor, base = command_ids(DONOR), command_ids(BASE)
        aliases = {'CONTROLLER_UNKNOWNYESNOBOX': 'CONTROLLER_YESNOBOX',
                   'CONTROLLER_PLAYFANFARE': 'CONTROLLER_PLAYFANFAREORBGM'}
        for name, opcode in donor.items():
            self.assertEqual(base[aliases.get(name, name)], opcode)
        headers = [(root / 'include/constants/battle_string_ids.h').read_text() for root in (DONOR, BASE)]
        get_id = lambda header, name: int(re.search(r'#define\s+' + name + r'\s+(\d+)', header)[1])
        self.assertEqual([get_id(header, 'STRINGID_DONTLEAVEBIRCH') for header in headers], [227, 227])
        self.assertEqual([get_id(header, 'STRINGID_TRAINER1WINTEXT') for header in headers], [383, 379])



if __name__ == '__main__':
    unittest.main()
