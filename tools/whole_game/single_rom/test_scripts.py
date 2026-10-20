"""Fast source-transform checks; these do not qualify campaign playability."""
from pathlib import Path
import tempfile
import unittest
import shutil
import subprocess

from tools.whole_game.single_rom.scripts import (
    analyze_scripts, compile_macros, import_scripts, namespace, rewrite_tokens, source_closure,
    validate_report, rewrite_font_controls,
)


class ScriptPortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.donor = self.root / "donor"
        self.base = self.root / "base"
        for tree in (self.donor, self.base):
            self.write(tree, "data/event_scripts.s", 'gStdScripts::\n .4byte Std_Msg\ngStdScriptsEnd::\n .include "data/maps/PalletTown/scripts.inc"\n')
            self.write(tree, "data/maps/PalletTown/scripts.inc", 'PalletTown_Script::\n special DoThing\n msgbox PalletTown_Text\n walk_down\n end\nPalletTown_Text::\n .string "PalletTown_Script$"\n')
            self.write(tree, "asm/macros/event.inc", '.macro special function:req\n .byte 0x25\n .2byte SPECIAL_\\function\n.endm\n.macro msgbox text:req\n special HiddenNative\n.endm\n.macro end\n .byte 2\n.endm\n')
            self.write(tree, "asm/macros/movement.inc", 'create_movement_action walk_down, MOVEMENT_ACTION_WALK_DOWN\n')
            self.write(tree, "asm/macros.inc", '.include "asm/macros/movement.inc"\n')
            self.write(tree, "data/specials.inc", ' def_special DoThing\n def_special HiddenNative\n')
            self.write(tree, "data/script_cmd_table.inc", ' .4byte ScrCmd_end\n')
            self.write(tree, "include/constants/flags.h", '#define FLAG_TEST 1\n')
            self.write(tree, "src/test.c", 'void DoThing(void)\n{\n}\n')
            self.write(tree, "charmap.txt", "'A' = BB\n")

    @staticmethod
    def write(root, relative, text):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_namespace_and_literal_safety(self):
        self.assertEqual(namespace("MAP_PALLET_TOWN"), "MAP_FR_PALLET_TOWN")
        text = 'Label::\n goto Label @ Label\n .string "Label$"\n'
        self.assertEqual(rewrite_tokens(text, {"Label": "FR_Label"}), 'FR_Label::\n goto FR_Label @ Label\n .string "Label$"\n')
        self.assertEqual(rewrite_tokens('map \\map', {'map': 'FR_map'}), 'FR_map \\map')

    def test_inventory_reaches_convenience_native_and_movement(self):
        report = analyze_scripts(self.donor, self.base)
        self.assertEqual(report["unknownCommands"], {})
        native = {row["name"]: row for row in report["nativeDependencies"]}
        self.assertTrue(native["HiddenNative"]["references"])
        self.assertTrue(native["DoThing"]["definitions"])
        with self.assertRaisesRegex(ValueError, "not executable-port qualified"):
            validate_report(report)

    def test_full_include_import_is_deterministic_and_build_gated(self):
        first = self.root / "first"
        second = self.root / "second"
        self.assertEqual(import_scripts(self.donor, self.base, first), import_scripts(self.donor, self.base, second))
        paths = sorted(p.relative_to(first) for p in first.rglob("*") if p.is_file())
        for path in paths:
            self.assertEqual((first / path).read_bytes(), (second / path).read_bytes())
        script = (first / "data/maps/FRPalletTown/scripts.inc").read_text()
        self.assertIn("FR_PalletTown_Script::", script)
        self.assertIn('"PalletTown_Script$"', script)
        self.assertIn("WHOLE_GAME_FR_SCRIPT_SOURCE_IMPORTED", (first / "data/firered/PORTABILITY_GATE.h").read_text())
        root_source = (first / "data/firered/data/event_scripts.s").read_text()
        self.assertNotIn("gStdScripts::", root_source)
        self.assertIn('.include "asm/macros/fr_event.inc"', root_source)
        self.assertIn('.include "data/firered/native_special_ids.inc"', root_source)
        self.assertNotIn('data/firered/data/firered', root_source)
        self.assertIn('#include "constants/whole_game_fr_state.h"', root_source)
        self.assertIn('#include "constants/whole_game_fr_encounters.h"', root_source)

    def test_donor_write_and_include_escape_rejected(self):
        with self.assertRaises(ValueError):
            import_scripts(self.donor, self.base, self.donor / "bad")
        self.write(self.donor, "data/event_scripts.s", '.include "../escape.inc"\n')
        with self.assertRaisesRegex(ValueError, "escapes"):
            source_closure(self.donor)

    def test_command_reencoding_and_unimplemented_commands_fail_closed(self):
        self.write(self.donor, "data/script_cmd_table.inc", ' .4byte ScrCmd_nop\n .4byte ScrCmd_special\n .4byte ScrCmd_end\n')
        self.write(self.base, "data/script_cmd_table.inc", 'script_cmd_table_entry SCR_OP_END ScrCmd_end\nscript_cmd_table_entry SCR_OP_SPECIAL ScrCmd_special\n')
        self.write(self.donor, "asm/macros/event.inc", '.macro special function:req\n .byte 0x01\n .2byte SPECIAL_\\function\n.endm\n.macro absent\n .byte 0x00\n.endm\n')
        text, ports = compile_macros(self.donor, self.base, {"special": "FR_special", "absent": "FR_absent"})
        self.assertIn('.2byte FR_SPECIAL_\\function', text)
        self.assertIn('.error "unported FireRed command absent', text)
        self.assertEqual({p['name']: p['status'] for p in ports}['special'], 'emerald-handler-reencoded')

    def test_standard_script_dispatch_uses_donor_labels(self):
        self.write(self.donor, "asm/macros/event.inc", '.macro callstd_if condition:req, function:req\n .byte 0x0b\n.endm\n')
        text, ports = compile_macros(self.donor, self.base, {"callstd_if": "FR_callstd_if", "call_if": "FR_call_if"})
        self.assertIn('FR_call_if \\condition, FR_Std_Msg', text)
        self.assertNotIn('.byte 0x0b', text)
        self.assertIn('unsupported FireRed standard script index', text)

    def test_donor_font_controls_use_donor_native_font_bank(self):
        self.assertEqual(rewrite_font_controls('.string "{FONT_MALE}Hi{FONT_NORMAL_COPY_1}$"'), '.string "{FR_FONT_MALE}Hi{FR_FONT_NORMAL_COPY_1}$"')
        self.assertEqual(rewrite_font_controls('.string "{PLAY_BGM MUS_ENCOUNTER_ROCKET}{LEFT_PAREN}$"'), '.string "{PLAY_BGM FR_MUS_ENCOUNTER_ROCKET}{ROUND_LEFT_PAREN}$"')

    def test_top_level_assembly_constants_and_default_arguments_are_preserved(self):
        self.write(self.donor, 'asm/macros/event.inc', 'MSGBOX_DEFAULT = 4\n.macro msgbox text:req, type=MSGBOX_DEFAULT\n .byte \\type\n.endm\n')
        text, _ = compile_macros(self.donor, self.base, {'MSGBOX_DEFAULT': 'FR_MSGBOX_DEFAULT', 'msgbox': 'FR_msgbox'})
        self.assertIn('FR_MSGBOX_DEFAULT = 4', text)
        self.assertIn('type=FR_MSGBOX_DEFAULT', text)
        self.assertIn('\\type', text)

    def test_generated_macros_assemble_when_toolchain_available(self):
        assembler = shutil.which('arm-none-eabi-as')
        if assembler is None:
            self.skipTest('existing ARM assembler unavailable')
        text, _ = compile_macros(self.donor, self.base, {})
        source = self.root / 'macros.s'
        source.write_text(text)
        result = subprocess.run([assembler, '-mcpu=arm7tdmi', '-o', str(self.root / 'macros.o'), str(source)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
