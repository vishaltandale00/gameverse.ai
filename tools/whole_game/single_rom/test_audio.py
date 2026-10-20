"""Focused source-only audio closure checks; no toolchain or full ROM build."""
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.whole_game.single_rom.audio import analyze_audio, import_audio, SONG

ROOT = Path(__file__).resolve().parents[3]
DONOR = ROOT / 'local/decomps/pokefirered'
BASE = ROOT / 'local/decomps/pokeemerald'


@unittest.skipUnless(DONOR.is_dir() and BASE.is_dir(), 'local decompositions unavailable')
class AudioImportTests(unittest.TestCase):
    def stage(self, root):
        stage = root / 'staged-emerald'
        for relative in ('sound/song_table.inc', 'sound/music_player_table.inc',
                         'asm/macros/music_voice.inc', 'include/gba/m4a_internal.h', 'data/sound_data.s', 'Makefile',
                         'include/constants/songs.h', 'ld_script.ld', 'charmap.txt', 'src/m4a.c', 'src/sound.c', 'src/pokemon.c'):
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BASE / relative, target)
        shutil.copytree(BASE / 'tools/mid2agb', stage / 'tools/mid2agb')
        (stage / 'sound/songs/midi').mkdir(parents=True)
        return stage

    def test_complete_original_audio_inventory(self):
        report = analyze_audio(DONOR, BASE)
        self.assertTrue(report['ready'], report['unresolved'])
        self.assertEqual(report['counts']['songs'], 347)
        self.assertEqual(report['counts']['resources'], 488)
        self.assertEqual(report['constants']['MUS_PALLET'], 'FR_MUS_PALLET')
        self.assertEqual(report['constants']['MUS_NONE'], 'MUS_NONE')
        self.assertIsNone(report['measurements']['build_seconds'])

    def test_transform_preserves_original_table_and_instrument_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            old_rows = SONG.findall((stage / 'sound/song_table.inc').read_text())
            report = import_audio(DONOR, stage)
            self.assertTrue(report['ready'], report['unresolved'])
            rows = SONG.findall((stage / 'sound/song_table.inc').read_text())
            self.assertEqual(rows[:len(old_rows)], old_rows)
            self.assertEqual(len(rows), len(old_rows) + 347)
            for resource in report['resources'].values():
                self.assertEqual((DONOR / resource['source']).read_bytes(),
                                 (stage / ('sound/fr/' + resource['source'][6:])).read_bytes())
            for song in report['songs']:
                self.assertEqual((DONOR / 'sound/songs/midi' / (song['source'] + '.mid')).read_bytes(),
                                 (stage / 'sound/songs/midi' / (song['target'] + '.mid')).read_bytes())
            self.assertEqual((stage / 'sound/fr/MPlayDef.s').read_bytes(),
                             (DONOR / 'sound/MPlayDef.s').read_bytes())
            self.assertIn('voicegroupFR_000::', (stage / 'sound/fr/voice_groups.inc').read_text())
            self.assertEqual(len(report['runtime']['fanfares']), 14)
            aliases = report['charmap']['aliases']
            self.assertEqual(aliases['FR_MUS_LEVEL_UP'], '63 03')
            self.assertEqual(len(aliases), 347)
            self.assertEqual((stage / 'charmap.txt').read_text().count('FR_MUS_LEVEL_UP ='), 1)
            self.assertIn('WholeGame_RemapAudio(n)', (stage / 'src/m4a.c').read_text())
            self.assertIn('FR_Cry_Bulbasaur', (stage / 'sound/fr/cry_tables.inc').read_text())
            rules = (stage / 'sound/fr/audio_rules.mk').read_text()
            self.assertTrue('-GFR_159 -LFR_mus_pallet' in rules)
            first = {str(p.relative_to(stage)): p.read_bytes() for p in stage.rglob('*') if p.is_file()}
            again = import_audio(DONOR, stage)
            self.assertEqual(again['songs'], report['songs'])
            self.assertEqual(first, {str(p.relative_to(stage)): p.read_bytes() for p in stage.rglob('*') if p.is_file()})

    def test_service_drift_blocks_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = self.stage(Path(directory))
            path = stage / 'asm/macros/music_voice.inc'
            path.write_text(path.read_text().replace('\\base_midi_key', '1', 1))
            report = import_audio(DONOR, stage)
            self.assertFalse(report['ready'])
            self.assertIn('audio-service-mismatch', {x['kind'] for x in report['unresolved']})
            self.assertFalse((stage / 'sound/fr').exists())

    def test_canonical_destination_rejected(self):
        with self.assertRaises(ValueError):
            import_audio(DONOR, BASE)


if __name__ == '__main__':
    unittest.main()
