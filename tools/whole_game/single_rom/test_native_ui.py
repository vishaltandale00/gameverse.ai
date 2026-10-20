"""Focused provider/source contracts, without a ROM build or UI simulation."""
from pathlib import Path
import tempfile
import unittest

from .native_ui import stage_native_ui, UI_SYMBOLS, EXTRACT

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local immutable decomp inputs unavailable')
class NativeUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp.name)
        cls.report = stage_native_ui(BASE, DONOR, cls.output)
        cls.source = (cls.output / 'src/firered_native/ui_services.c').read_text()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_real_providers_have_translation_unit(self):
        rows = {row['name']: row for row in self.report['providers']}
        self.assertTrue(set(UI_SYMBOLS).issubset(rows))
        for name in (*EXTRACT, 'GetPCBoxToSendMon'):
            self.assertEqual(rows[name]['status'], 'source-ported')
            self.assertIn('FR_' + name + '(void)', self.source)
            self.assertTrue((self.output / rows[name]['translationUnit']).is_file())

    def test_donor_gender_branch_and_host_buffers_preserved(self):
        self.assertIn('StringCopy(gStringVar1, gText_Daughter);', self.source)
        self.assertIn('StringCopy(gStringVar1, gText_Son);', self.source)
        self.assertIn('MON_DATA_NICKNAME, gStringVar1', self.source)
        self.assertNotIn('FR_gStringVar', self.source)
        self.assertEqual([row['hostBytes'] for row in self.report['sharedBuffers']], [256, 256, 256, 1000])

    def test_no_fake_screen_or_quest_log_success(self):
        self.assertFalse(self.report['buildEligible'])
        self.assertEqual(len(self.report['unresolved']), 7)
        for row in self.report['providers']:
            if row['status'] == 'unresolved':
                self.assertNotIn('FR_' + row['name'] + '(', self.source)
        self.assertIsNone(self.report['qualification']['runtime'])

    def test_pc_uses_capture_owned_backing(self):
        self.assertIn('return GetPCBoxToSendMon();', self.source)
        self.assertNotIn('sPCBoxToSendMon', self.source)

    def test_help_storage_teardown_and_signpost_consumer_connected(self):
        help_source = (self.output / 'src/firered_native/ui_help.c').read_text()
        consumer = (self.output / 'src/field_message_box.c').read_text()
        menu = (self.output / 'src/menu.c').read_text()
        self.assertIn('RemoveWindow(FR_sHelpMessageWindowId);', help_source)
        self.assertIn('FR_sHelpMessageWindowId = WINDOW_NONE;', help_source)
        self.assertIn('FR_ResetNativeUiWindows();', menu)
        self.assertIn('if (FR_IsMsgSignpost() && FR_gQuestLogState != 2)', consumer)
        self.assertIn('FR_LoadSignpostWindowGfx(0, 0x200, BG_PLTT_ID(15))', consumer)
        for asset in self.report['helpAndSignpost']['assets']:
            self.assertTrue((self.output / asset['target']).is_file())

    def test_pc_menu_has_real_result_resume_and_player_name_branch(self):
        source = (self.output / 'src/firered_native/ui_pc_menu.c').read_text()
        self.assertIn('gSpecialVar_Result = input;', source)
        self.assertIn('gSpecialVar_Result = SCR_MENU_CANCEL;', source)
        self.assertIn('DestroyTask(taskId);', source)
        self.assertIn('ScriptContext_Enable();', source)
        self.assertIn('if (i != 5)', source)
        self.assertIn('AddTextPrinterParameterized5', source)
        self.assertIn('FR_FLAG_SYS_POKEDEX_GET', source)
        self.assertNotIn('MultiChoicePrintHelpDescription(', source)

    def test_tutorial_party_runs_real_message_and_fade_tasks(self):
        source = (self.output / 'src/party_menu.c').read_text()
        self.assertIn('FR_OpenPartyMenuInTutorialBattle(partyAction);', source)
        self.assertIn('FR_EnterPartyFromItemMenuInBattle();', source)
        self.assertIn('FR_FONT_MALE', source)
        self.assertNotIn('#define FR_FONT_MALE FONT_NORMAL', source)
        self.assertIn('FR_FirstBattleEnterParty_DestroyVoiceoverWindow((u8)data[0]);', source)
        self.assertIn('gTasks[taskId].func = Task_HandleChooseMonInput;', source)
        self.assertEqual(len(self.report['tutorialParty']['taskCallbacks']), 11)

    def test_npc_text_color_uses_selected_object_and_donor_table(self):
        source = (self.output / 'src/firered_native/ui_npc_text.c').read_text()
        self.assertIn('gObjectEvents[gSelectedObjectEvent].graphicsId', source)
        self.assertIn('gSpecialVar_TextColor != NPC_TEXT_COLOR_DEFAULT', source)
        self.assertIn('FR_GetColorFromTextColorTable(gfxId)', source)
        self.assertIn('VarGet(FR_VAR_OBJ_GFX_ID_0 + gfxId - 240)', source)
        reset = (self.output / 'src/field_control_avatar.c').read_text()
        self.assertIn('FR_ResetContextNpcTextColor();', reset)
        self.assertIn('FR_MsgSetNotSignpost();', reset)

    def test_museum_fossil_has_original_resources_and_deferred_teardown(self):
        source = (self.output / 'src/firered_native/ui_pc_menu.c').read_text()
        self.assertIn('SPECIES_KABUTOPS', source)
        self.assertIn('SPECIES_AERODACTYL', source)
        self.assertIn('DestroySprite(&gSprites[task->tSpriteId]);', source)
        self.assertIn('FreeSpriteTilesByTag(GFXTAG_FOSSIL);', source)
        self.assertIn('gTasks[taskId].tState++;', source)
        for asset in self.report['storyMenus']['assets']:
            self.assertTrue((self.output / asset['target']).is_file())

    def test_elevator_cursor_is_consumed_by_actual_list_and_freed(self):
        source = (self.output / 'src/firered_native/ui_elevator.c').read_text()
        self.assertIn('task->data[7] = FR_UI_sElevatorScroll;', source)
        self.assertIn('task->data[8] = FR_UI_sElevatorCursorPos;', source)
        self.assertIn('DestroyListMenuTask(task->data[14], NULL, NULL);', source)
        self.assertIn('Free(FR_UI_sListMenuItems);', source)
        self.assertIn('InstallCameraPanAheadCallback();', source)
        self.assertNotIn('struct FR_ListMenu', source)

    def test_original_eReader_char_wrap_is_retained(self):
        source = (self.output / 'src/firered_native/ui_text_buffers.c').read_text()
        self.assertIn('FR_EC_DoesEasyChatStringFitOnLine(greeting, 3, 2, 18)', source)
        self.assertNotIn('FrontierSpeechToString(', source)
        self.assertIn('gSaveBlock2Ptr->frontier.ereaderTrainer.greeting', source)
        self.assertIn('WholeGame_GetRivalName()', source)

    def test_refuses_canonical_mutation(self):
        with self.assertRaises(ValueError):
            stage_native_ui(BASE, DONOR, BASE)
        with self.assertRaises(ValueError):
            stage_native_ui(BASE, DONOR, DONOR / 'staged')


if __name__ == '__main__':
    unittest.main()
