"""Small parser/closure regressions; no ROM build, emulator, or model calls."""
import tempfile
from pathlib import Path
import unittest

from tools.whole_game.single_rom.native_services import functions, source_dependency_closure, stage_native_services, direct_constant_evidence


class NativeSourceTests(unittest.TestCase):
    def test_balanced_source_preserves_strings_comments_and_nested_scopes(self):
        source = 'static u16 helper(u16 x) { /* } */ if (x) { return x; } return 0; }\nvoid root(void) { const char *s="}"; helper(1); }'
        found = functions(source, 'src/a.c')
        self.assertEqual([f.name for f in found], ['helper', 'root'])
        self.assertEqual(found[0].source, source[:source.index('\n')])

    def test_function_pointer_return_does_not_invent_void_service(self):
        found = functions('static void (*GetGfxFunc(void))(void) { return sGfx->func; }', 'src/a.c')
        self.assertEqual([f.name for f in found], ['GetGfxFunc'])

    def test_transitive_callbacks_and_translation_local_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'src').mkdir()
            (root / 'src/a.c').write_text('static void helper(void) {}\nvoid root(void) { SetCallback(helper); }')
            (root / 'src/b.c').write_text('static void helper(void) { Wrong(); }')
            closure = source_dependency_closure(root, ['root', 'Missing'])
            self.assertEqual({f['key'] for f in closure['functions']}, {'src/a.c:root', 'src/a.c:helper'})
            self.assertEqual(closure['missingRoots'], ['Missing'])

    def test_numeric_donor_define_and_host_enum_field_ids_must_agree(self):
        with tempfile.TemporaryDirectory() as directory:
            roots = [Path(directory) / name for name in ('donor', 'host')]
            for root in roots:
                (root / 'include/constants').mkdir(parents=True)
                (root / 'include/constants/pokemon.h').write_text('')
                (root / 'include/constants/species.h').write_text('#define SPECIES_SQUIRTLE 7\n')
                (root / 'include/constants/global.h').write_text('')
                (root / 'include/pokemon.h').write_text('')
            (roots[0] / 'include/constants/pokemon.h').write_text('#define MON_DATA_SPECIES_OR_EGG 65\n')
            (roots[1] / 'include/pokemon.h').write_text('enum { MON_DATA_SPECIES_OR_EGG = 65 };')
            evidence = direct_constant_evidence(*roots, 'MON_DATA_SPECIES_OR_EGG SPECIES_SQUIRTLE')
            self.assertTrue(all(row['matches'] for row in evidence))
            (roots[1] / 'include/pokemon.h').write_text('enum { MON_DATA_SPECIES_OR_EGG = 66 };')
            with self.assertRaisesRegex(ValueError, 'nonidentical'):
                direct_constant_evidence(*roots, 'MON_DATA_SPECIES_OR_EGG')

    def test_canonical_source_cannot_be_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'canonical'):
                stage_native_services(root / 'emerald', root / 'firered', root / 'firered/stage')


if __name__ == '__main__':
    unittest.main()
