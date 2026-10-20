from pathlib import Path
import tempfile
import unittest

from tools.whole_game.single_rom.special_registry import audit_assembler_roots


class SpecialRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.donor = self.root / 'donor'
        (self.donor / 'data').mkdir(parents=True)
        (self.donor / 'src').mkdir()
        (self.donor / 'data/specials.inc').write_text('def_special Foo\ndef_special NullFieldSpecial\ndef_special Foo\ndef_special Bar\n')
        (self.donor / 'data/event_scripts.s').write_text(' special Foo\n')
        (self.donor / 'src/scrcmd.c').write_text('extern void *gSpecials[];\n')
        self.source = self.root / 'expanded.s'
        self.listing = self.root / 'listing.txt'

    def test_actual_macro_expansion_binds_root_and_callsite(self):
        self.source.write_text('# 21 "data/maps/FRTest/scripts.inc"\n FR_famechecker 15, 0\n')
        self.listing.write_text(' 2              > FR_special Foo\n 2 0001 0200 >> .2byte FR_SPECIAL_Foo\n')
        report = audit_assembler_roots(self.donor, self.source, self.listing)
        self.assertEqual(report['status'], 'static-operands-bound')
        self.assertFalse(report['pruningAuthorized'])
        self.assertEqual(report['callsites'][0]['callsite']['line'], 21)
        self.assertEqual(report['callsites'][0]['lineage'][0]['macro'], 'FR_famechecker')
        self.assertEqual(report['callsites'][0]['lineage'][-1]['arguments'], 'Foo')
        self.assertEqual(report['proposedStaticOnlyRemap']['sourceSlotsToCompactSlots'], {'0': 0, '2': 0})

    def test_unknown_bound_operand_prevents_static_proof(self):
        self.source.write_text(' FR_special Missing\n')
        self.listing.write_text(' 1 0001 0000 > .2byte FR_SPECIAL_Missing\n')
        report = audit_assembler_roots(self.donor, self.source, self.listing)
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual(report['unknownOperands'][0]['operand'], 'Missing')

    def test_direct_native_pointer_and_ambiguous_raw_opcode_are_retained(self):
        self.source.write_text(' FR_callnative FR_Foo\n')
        self.listing.write_text(' 1 0001 00000000 > .4byte FR_Foo\n')
        (self.donor / 'data/event_scripts.s').write_text(' .byte 0x25\n')
        report = audit_assembler_roots(self.donor, self.source, self.listing)
        self.assertEqual(report['directNativeCalls'][0]['name'], 'FR_Foo')
        self.assertEqual(len(report['ambiguousRawOpcodes']), 1)
        self.assertFalse(report['pruningAuthorized'])


if __name__ == '__main__':
    unittest.main()
