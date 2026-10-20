"""Narrow source/dispatch checks; native UI and campaign behavior are not certified."""
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.whole_game.single_rom.opcodes import (
    COMMANDS, PROVIDERS, stage_native_opcodes,
)
from tools.whole_game.single_rom.native_services import functions
from tools.whole_game.single_rom.scripts import compile_macros, rewrite_tokens

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local decompositions unavailable')
class OpcodeTests(unittest.TestCase):
    def stage(self, root):
        stage = root / 'stage'
        for name in ('src/scrcmd.c', 'data/script_cmd_table.inc'):
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BASE / name, path)
        path = stage / 'include/whole_game_state.h'
        path.parent.mkdir(parents=True)
        path.write_text('extern u16 gSpecialVar_TextColor;\nextern u16 gSpecialVar_PrevTextColor;\n')
        return stage

    def test_exact_source_preservation_dispatch_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            before_source = (BASE / 'src/scrcmd.c').read_bytes()
            before_donor = (DONOR / 'src/scrcmd.c').read_bytes()
            report = stage_native_opcodes(BASE, DONOR, stage)
            self.assertEqual(list(report['opcodeMap'].values()), list(range(0xe3, 0xed)))
            self.assertEqual(report['appendedOpcodeCount'], 10)
            original = {f.name: f for f in functions(before_donor.decode(), 'src/scrcmd.c')}
            emitted = {f.name: f for f in functions((stage / 'src/scrcmd.c').read_text(), 'src/scrcmd.c')}
            names = {name: 'FR_' + name for name in PROVIDERS}
            names.update({'ScrCmd_' + name: 'FR_ScrCmd_' + name for name in COMMANDS})
            for name in COMMANDS:
                self.assertEqual(emitted['FR_ScrCmd_' + name].source.strip(),
                                 rewrite_tokens(original['ScrCmd_' + name].source, names).strip())
            first = {name: (stage / name).read_bytes() for name in report['files']}
            second = stage_native_opcodes(BASE, DONOR, stage)
            self.assertEqual(report['handlerOpcodeMap'], second['handlerOpcodeMap'])
            self.assertEqual(first, {name: (stage / name).read_bytes() for name in second['files']})
            self.assertEqual(before_source, (BASE / 'src/scrcmd.c').read_bytes())
            self.assertEqual(before_donor, (DONOR / 'src/scrcmd.c').read_bytes())

    def test_provider_absence_gates_real_handlers(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            report = stage_native_opcodes(BASE, DONOR, stage)
            self.assertFalse(report['ready'])
            self.assertFalse(report['buildEligible'])
            self.assertEqual({row['donorSymbol'] for row in report['unresolved']}, set(PROVIDERS))
            self.assertIn('FR_QuestLog_RecordEnteredMap(value);', (stage / 'src/scrcmd.c').read_text())
            self.assertIn('FR_DrawHelpMessageWindowWithText(msg);', (stage / 'src/scrcmd.c').read_text())

    def test_macro_compiler_consumes_exact_handler_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            report = stage_native_opcodes(BASE, DONOR, stage)
            text, ports = compile_macros(DONOR, BASE, {}, opcode_overrides=report['handlerOpcodeMap'])
            by_name = {row['name']: row for row in ports}
            for name in COMMANDS:
                self.assertEqual(by_name[name]['status'], 'emerald-handler-reencoded')
                self.assertNotIn('unported FireRed command ' + name + ':', text)
            self.assertIn('.byte 227', text)

    def test_overflow_and_canonical_destination_fail_before_write(self):
        with self.assertRaisesRegex(ValueError, 'immutable'):
            stage_native_opcodes(BASE, DONOR, BASE)
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            table = stage / 'data/script_cmd_table.inc'
            text = table.read_text()
            # 227 native entries + 20 additions + 10 new handlers exceeds 256.
            text = text.replace('gScriptCmdTableEnd::', ''.join(
                f'script_cmd_table_entry EXTRA_{i} ScrCmd_nop\n' for i in range(20)) + 'gScriptCmdTableEnd::')
            table.write_text(text)
            source = (stage / 'src/scrcmd.c').read_bytes()
            with self.assertRaisesRegex(ValueError, 'one-byte'):
                stage_native_opcodes(BASE, DONOR, stage)
            self.assertEqual(source, (stage / 'src/scrcmd.c').read_bytes())


if __name__ == '__main__':
    unittest.main()
