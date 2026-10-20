from pathlib import Path
import tempfile
import unittest
import json

from tools.whole_game.single_rom.script_constants import definitions, emit_constants
from tools.whole_game.single_rom.scripts import constant_operand_sources


class ScriptConstantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.donor, self.base, self.output = [self.root / n for n in ('donor', 'base', 'out')]
        self.write(self.donor, 'event_object_movement.h', '#define MOVEMENT_ACTION_DELAY_4 0x1a\n#define MOVEMENT_ACTION_WALK_SLOWER_UP 9\n')
        self.write(self.base, 'event_object_movement.h', '#define MOVEMENT_ACTION_DELAY_4 0x12\n')
        self.write(self.donor, 'battle_setup.h', '#define TRAINER_BATTLE_EARLY_RIVAL 9\n')
        self.write(self.base, 'battle_setup.h', '#define TRAINER_BATTLE_PYRAMID 9\n')
        self.write(self.donor, 'global.h', '#define NESTED (LOCALID_PLAYER + 1)\n#define LOCALID_PLAYER 255\n')

    @staticmethod
    def write(root, filename, content):
        path = root / 'include/constants' / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def test_source_expression_and_host_movement_reencoding(self):
        report = emit_constants(self.donor, self.base, self.output, ['NESTED MOVEMENT_ACTION_DELAY_4'], {})
        records = {a['name']: a for a in report['aliases']}
        self.assertEqual(records['NESTED']['emittedValue'], 256)
        self.assertEqual(records['MOVEMENT_ACTION_DELAY_4']['donorValue'], 26)
        self.assertEqual(records['MOVEMENT_ACTION_DELAY_4']['emittedValue'], 18)
        self.assertEqual(report['status'], 'passed')

    def test_missing_runtime_constants_fail_explicitly(self):
        report = emit_constants(self.donor, self.base, self.output, ['MOVEMENT_ACTION_WALK_SLOWER_UP TRAINER_BATTLE_EARLY_RIVAL'], {})
        self.assertEqual(len(report['unresolved']), 2)
        header = (self.output / report['header']).read_text()
        self.assertIn('#error "unresolved FireRed operand FR_TRAINER_BATTLE_EARLY_RIVAL', header)
        self.assertNotIn('#define FR_TRAINER_BATTLE_EARLY_RIVAL 9', header)

    def test_staged_runtime_provider_resolves_distinct_mode(self):
        self.write(self.output, 'whole_game_fr_battle_modes.h', '#define FR_TRAINER_BATTLE_EARLY_RIVAL 13\n')
        self.write(self.output, 'whole_game_fr_scripts.h', '#define FR_TRAINER_BATTLE_EARLY_RIVAL 9\n')
        report = emit_constants(self.donor, self.base, self.output, ['TRAINER_BATTLE_EARLY_RIVAL'], {})
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['aliases'][0]['emittedValue'], 13)
        self.assertEqual(report['aliases'][0]['resolution'], 'staged-runtime-provider-value')

    def test_clean_source_generated_local_ids_and_layout_holes(self):
        path = self.donor / 'data/maps/Test/map.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'object_events': [{}, {'local_id': 'LOCALID_TEST'}]}))
        layout = self.donor / 'data/layouts/layouts.json'
        layout.parent.mkdir(parents=True, exist_ok=True)
        layout.write_text(json.dumps({'layouts': [{}, {'id': 'LAYOUT_TEST'}]}))
        parsed = definitions(self.donor)
        self.assertEqual(parsed['LOCALID_TEST']['expression'], '2')
        self.assertEqual(parsed['LAYOUT_TEST']['expression'], '2')

    def test_variable_domain_bounds_are_emitted_by_state_provider_rules(self):
        self.write(self.donor, 'vars.h', '#define VARS_START 0x4000\n#define VARS_END 0x40FF\n#define SPECIAL_VARS_START 0x8000\n#define SPECIAL_VARS_END 0x8014\n')
        report = emit_constants(self.donor, self.base, self.output, ['VARS_START VARS_END SPECIAL_VARS_START SPECIAL_VARS_END'], {})
        aliases = {a['name']: a['emittedValue'] for a in report['aliases']}
        self.assertEqual(aliases, {'VARS_START': 0x5000, 'VARS_END': 0x50FF, 'SPECIAL_VARS_START': 0x8000, 'SPECIAL_VARS_END': 0x8017})

    def test_map_only_npc_movement_type_requires_actual_runtime_provider(self):
        self.write(self.donor, 'event_object_movement.h', '#define MOVEMENT_TYPE_WANDER_AROUND_SLOWER 80\n')
        path = self.donor / 'data/maps/Test/map.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'object_events': [{'movement_type': 'MOVEMENT_TYPE_WANDER_AROUND_SLOWER'}]}))
        operands = constant_operand_sources(self.donor, {}, {}, set())
        report = emit_constants(self.donor, self.base, self.output, operands, {})
        self.assertEqual(report['unresolved'][0]['name'], 'MOVEMENT_TYPE_WANDER_AROUND_SLOWER')
        self.write(self.output, 'whole_game_fr_movement.h', '#define FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER 84\n')
        report = emit_constants(self.donor, self.base, self.output, operands, {})
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['aliases'][0]['emittedValue'], 84)

    def test_header_location_does_not_delegate_unrelated_color_and_cry_domains(self):
        self.write(self.donor, 'vars.h', '#define VAR_TEST 0x4000\n#define NPC_TEXT_COLOR_MALE 0\n')
        self.write(self.donor, 'sound.h', '#define SE_TEST 8\n#define CRY_MODE_ENCOUNTER 2\n')
        report = emit_constants(self.donor, self.base, self.output, ['VAR_TEST NPC_TEXT_COLOR_MALE SE_TEST CRY_MODE_ENCOUNTER'], {})
        self.assertEqual({a['name']: a['emittedValue'] for a in report['aliases']}, {'NPC_TEXT_COLOR_MALE': 0, 'CRY_MODE_ENCOUNTER': 2})
        self.assertEqual({a['name'] for a in report['ownerProvided']}, {'VAR_TEST', 'SE_TEST'})


if __name__ == '__main__':
    unittest.main()
