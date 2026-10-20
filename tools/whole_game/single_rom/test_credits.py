"""Focused source closure and callback dispatch checks for original FR credits."""
from pathlib import Path
import tempfile
import unittest

from tools.whole_game.single_rom.credits import TARGET, MONS, stage_credits
from tools.whole_game.single_rom.native_services import functions

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'local/decomps/pokeemerald'
DONOR = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'original source inputs unavailable')
class CreditsTests(unittest.TestCase):
    def test_original_credits_and_region_specific_callback_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            report = stage_credits(BASE, DONOR, out)
            self.assertEqual(report['source']['functions'], 16)
            emitted = (out / TARGET).read_text()
            names = {f.name for f in functions(emitted, TARGET)}
            for function in functions((DONOR / 'src/credits.c').read_text(), 'src/credits.c'):
                self.assertIn('FR_DoCredits' if function.name == 'DoCredits' else 'FR_Credits_' + function.name, names)
            self.assertIn('SoftReset(RESET_ALL);', emitted)
            self.assertIn('FR_FONT_NORMAL_COPY_1', emitted)
            self.assertIn('FR_gDisableMapMusicChangeOnMapLoad = FR_CREDITS_MUSIC_DISABLE_OFF;', emitted)
            self.assertNotIn('EWRAM_DATA bool8 gHasHallOfFameRecords =', emitted)
            hof = (out / 'src/hall_of_fame.c').read_text()
            self.assertIn('if (WholeGame_IsKanto())\n        FR_SetWarpsToRollCredits();\n    else\n        SetMainCallback2(CB2_StartCreditsSequence);', hof)
            self.assertIn('FR_VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR', hof)
            self.assertIn('MAP_GROUP(MAP_FR_INDIGO_PLATEAU_EXTERIOR)', hof)
            self.assertEqual(len(report['sceneMaps']), 14)
            self.assertFalse(report['ready'])
            self.assertIn('missing-original-indigo-credits-script', {x['kind'] for x in report['unresolved']})
            indigo = out / 'data/maps/FRIndigoPlateau_Exterior/scripts.inc'
            indigo.parent.mkdir(parents=True)
            original = (DONOR / 'data/maps/IndigoPlateau_Exterior/scripts.inc').read_text()
            indigo.write_text(original.replace('special DoCredits', 'FR_special DoCredits').replace('MUS_CREDITS', 'FR_MUS_CREDITS').replace('VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR', 'FR_VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR'))
            refreshed = stage_credits(BASE, DONOR, out)
            self.assertNotIn('missing-original-indigo-credits-script', {x['kind'] for x in refreshed['unresolved']})

    def test_exact_editable_art_and_four_original_mon_pictures(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            report = stage_credits(BASE, DONOR, out)
            self.assertEqual(len(report['assets']), 40)
            for asset in report['assets']:
                self.assertEqual((DONOR / asset['source']).read_bytes(), (out / asset['target']).read_bytes())
            source = (out / TARGET).read_text()
            for mon in MONS:
                self.assertIn('FR_Credits_gMonFrontPic_' + mon, source)
                self.assertIn('FR_Credits_gMonPalette_' + mon, source)
            self.assertIn('sFR_Credits_gMonFrontPicTable[species]', source)
            self.assertIn('FR_gCreditsString_Director', source)
            self.assertIn('FR_gString_PokemonFireRed_Staff', source)

    def test_original_scroll_and_audio_guards_and_repeatability(self):
        with self.assertRaisesRegex(ValueError, 'isolated'):
            stage_credits(BASE, DONOR, BASE)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            report = stage_credits(BASE, DONOR, out)
            source = (out / 'src/overworld.c').read_text()
            self.assertIn('FR_Credits_CameraCB_CreditsPan', source)
            self.assertIn('camera->movementSpeedX = sFR_CreditsOverworld_Script', source)
            self.assertEqual(source.count('if (FR_gDisableMapMusicChangeOnMapLoad == FR_CREDITS_MUSIC_DISABLE_KEEP)'), 3)
            self.assertIn('AddCameraTileOffset(&sFieldCameraOffset, deltaX * 2, deltaY * 2);', (out / 'src/field_camera.c').read_text())
            self.assertIn('BeginNormalPaletteFade(selectedPalettes', (out / 'src/field_weather.c').read_text())
            snapshot = {str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()}
            stage_credits(BASE, DONOR, out)
            self.assertEqual(snapshot, {str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()})
            self.assertEqual(report['providers'][0]['target'], 'FR_DoCredits')


if __name__ == '__main__':
    unittest.main()
