"""Complete donor collector source/assets and compiled progress-state checks."""
from pathlib import Path
import hashlib
import tempfile
import unittest

from .fame_checker import PUBLIC, stage_fame_checker, verify_progress_state
from .native_services import functions

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless((DONOR / 'src/fame_checker.c').is_file(), 'immutable sources unavailable')
class FameCheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='fame-source-test-')
        cls.out = Path(cls.directory.name)
        cls.ledger = stage_fame_checker(BASE, DONOR, cls.out)
        cls.source = (cls.out / 'src/firered_native/fame_checker.c').read_text()

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_complete_original_task_and_script_helper_closure(self):
        original = {f.name for f in functions((DONOR / 'src/fame_checker.c').read_text(), '')}
        ported = {f.name for f in functions(self.source, '')}
        self.assertEqual(len(original), 64)
        self.assertTrue({'FR_' + name for name in original}.issubset(ported))
        self.assertEqual({row['name'] for row in self.ledger['providers']}, set(PUBLIC))
        self.assertIn('gTasks[taskId].func = FR_Task_TopMenuHandleInput;', self.source)
        self.assertIn('SetMainCallback2(FR_sFameCheckerData->savedCallback)', self.source)
        self.assertIn('FR_AddTextPrinterParameterized2(', self.source)
        self.assertIn('FR_FONT_NORMAL', self.source)
        self.assertIn('FR_FONT_SMALL', self.source)
        self.assertIn('FR_InitFameCheckerObjectPalettes(0)', self.source)
        self.assertTrue(self.ledger['buildEligible'])
        self.assertFalse(self.ledger['unresolved'])
        self.assertNotIn('gSaveBlock1Ptr->fameChecker', self.source)

    def test_original_assets_and_text_resource_identity(self):
        self.assertEqual(len(self.ledger['assets']), 13)
        for row in self.ledger['assets']:
            self.assertEqual(hashlib.sha256((self.out / row['destination']).read_bytes()).hexdigest(), row['sha256'])
        self.assertIn('FR_gFameCheckerFlavorText_ProfOak0', self.source)
        self.assertIn('FR_gFameCheckerPersonQuote_Giovanni', self.source)
        self.assertIn('FR_TRAINER_PIC_LEADER_BROCK', self.source)
        self.assertIn('FR_TRAINER_LEADER_BROCK', self.source)
        self.assertIn('FR_SE_M_SWIFT', self.source)
        self.assertIn('".4bpp", "-num_tiles 165 -Wnum_tiles"', self.source)

    def test_real_item_bag_and_registered_entry_and_durable_progress(self):
        item = (self.out / 'src/firered_native/fame_checker_item.c').read_text()
        self.assertIn('FR_SetQuestLogEvent(FR_QL_EVENT_USED_ITEM', item)
        self.assertIn('Task_FadeAndCloseBagMenu(taskId)', item)
        self.assertIn('gTasks[taskId].func = FR_Task_UseFameCheckerFromField', item)
        self.assertIn('FR_UseFameChecker(CB2_ReturnToField)', item)
        self.assertIn('FR_FieldUseFunc_FameChecker', (self.out / 'src/data/items.h').read_text())
        state = (self.out / 'src/firered_native/fame_checker_state.c').read_text()
        self.assertIn('gPokemonStoragePtr->wholeGameKanto.fameChecker', state)
        self.assertNotIn('FR_FullyUnlockFameChecker(', item)
        result = verify_progress_state(self.out)
        self.assertEqual((result['flavorCases'], result['pickCases'], result['savedBytes']), (144, 270, 64))

    def test_repeated_source_stage_is_identical(self):
        before = {relative: hashlib.sha256((self.out / relative).read_bytes()).hexdigest() for relative in self.ledger['changedFiles']}
        second = stage_fame_checker(BASE, DONOR, self.out)
        self.assertEqual(second['changedFiles'], self.ledger['changedFiles'])
        self.assertEqual(before, {relative: hashlib.sha256((self.out / relative).read_bytes()).hexdigest() for relative in second['changedFiles']})

    def test_canonical_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'isolated'):
            stage_fame_checker(BASE, DONOR, BASE)


if __name__ == '__main__':
    unittest.main()
