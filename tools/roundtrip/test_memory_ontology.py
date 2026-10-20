import copy
import unittest
from tools.roundtrip.memory_ontology import SCHEMA, canonical, compile_edit, encode, sha, validate_manifest


def fixture():
    rom = bytearray(512)
    rom[256:260] = b'\x01\xaa\x02\xbb'
    rom[272:276] = encode(0x08000100, 'u32')
    rom[276] = 2
    manifest = dict(schema=SCHEMA, game_id='bounded-fixture', source_revision='fixture-v1',
                    rom=dict(size=len(rom), sha256=sha(rom)), allocations=[
                        dict(id='table', rom_offset=256, size=4, kind='data', source=dict(path='removed/source.c', sha256='captured', symbol='table')),
                        dict(id='references', rom_offset=272, size=5, kind='data')], tables=[
                        dict(id='table', symbol='fixtureTable', allocation_id='table', rom_offset=256, stride=2, capacity=2,
                             rows=[dict(value=1), dict(value=2)], fields=[dict(name='value', offset=0, type='u8', min=0, max=10)],
                             bindings=[dict(role='pointer',rom_offset=272,type='u32',expected=0x08000100),
                                       dict(role='count',rom_offset=276,type='u8',expected=2)],
                             expansion=dict(status='closed', reference_closure='complete', closure_evidence={'scope':'fixture exact consumers'},
                                            free_region=dict(mode='rom_extension',rom_offset=512,size=8,fill=255,expected_sha256=sha(b''))))])
    return manifest, bytes(rom)


def edit(manifest, rom, operations):
    return compile_edit(manifest, rom, dict(manifest_sha256=sha(canonical(manifest)),operations=operations))


class MemoryOntologyTests(unittest.TestCase):
    def test_scalar_preserves_padding_and_repeat_uses_no_source(self):
        manifest, rom = fixture()
        result = edit(manifest, rom, [dict(op='set',table='table',index=1,field='value',value=3)])
        self.assertEqual(result['rom'][256:260],b'\x01\xaa\x03\xbb')
        again = edit(result['manifest'],result['rom'],[dict(op='set',table='table',index=0,field='value',value=4)])
        self.assertEqual(again['rom'][256:260],b'\x04\xaa\x03\xbb')
        self.assertIn('fixtureTable',again['source'])

    def test_append_relocates_and_updates_count_pointer_capacity(self):
        manifest, rom = fixture()
        result=edit(manifest,rom,[dict(op='append',table='table',row=dict(value=7))])
        self.assertEqual(result['rom'][512:518], b'\x01\xaa\x02\xbb\x07\xff')
        self.assertEqual(result['rom'][272:277],encode(0x08000200,'u32')+b'\x03')
        self.assertEqual(result['rom'][256:260],rom[256:260])
        self.assertEqual(result['manifest']['tables'][0]['capacity'],4)
        self.assertEqual(len(result['ir']['writes']),3)

    def test_prefixed_count_relocates_with_records_and_repeats(self):
        manifest, rom = fixture()
        table = manifest['tables'][0]
        table['backing_prefix_size'] = 2
        table['alignment'] = 2
        table['bindings'][0]['target_addend'] = -2
        table['bindings'][0]['expected'] -= 2
        table['bindings'][1].update(rom_offset=254, type='u16', table_relative_offset=-2)
        manifest['allocations'][0].update(rom_offset=254, size=6)
        rom = bytearray(rom)
        rom[254:256] = encode(2, 'u16')
        rom[272:276] = encode(0x080000fe, 'u32')
        rom = bytes(rom)
        manifest['rom']['sha256'] = sha(rom)
        result = edit(manifest, rom, [dict(op='append', table='table', row=dict(value=7))])
        self.assertEqual(result['rom'][512:520], b'\x03\x00\x01\xaa\x02\xbb\x07\xff')
        self.assertEqual(result['rom'][272:276], encode(0x08000200, 'u32'))
        self.assertEqual(result['manifest']['tables'][0]['rom_offset'], 514)
        self.assertEqual(result['manifest']['tables'][0]['bindings'][1]['rom_offset'], 512)
        repeated = edit(result['manifest'], result['rom'], [dict(op='set', table='table', index=2, field='value', value=8)])
        self.assertEqual(repeated['rom'][512:520], b'\x03\x00\x01\xaa\x02\xbb\x08\xff')
        table['bindings'][1]['table_relative_offset'] = -1
        with self.assertRaisesRegex(ValueError, 'stale table-relative'):
            validate_manifest(manifest, rom)

    def test_primary_cartridge_window_is_bounded_on_capture(self):
        manifest, _ = fixture()
        with self.assertRaisesRegex(ValueError, 'primary GBA cartridge window'):
            validate_manifest(manifest, bytes(0x2000001))

    def test_flag_terminated_records_append_without_fabricated_count(self):
        manifest, rom = fixture()
        table = manifest['tables'][0]
        table['fields'][0]['max'] = 255
        table['rows'][0]['value'] = 129
        table['bindings'] = table['bindings'][:1]
        table['expansion']['sentinel_termination'] = dict(field='value', mask=128, continuation_value=128, terminal_value=0)
        rom = bytearray(rom)
        rom[256] = 129
        rom = bytes(rom)
        manifest['rom']['sha256'] = sha(rom)
        with self.assertRaisesRegex(ValueError, 'sentinel termination flag'):
            edit(manifest, rom, [dict(op='append', table='table', row=dict(value=7))])
        result = edit(manifest, rom, [dict(op='set', table='table', index=1, field='value', value=130),
                                      dict(op='append', table='table', row=dict(value=7))])
        self.assertEqual(result['rom'][512:518], b'\x81\xaa\x82\xbb\x07\xff')
        self.assertEqual(len(result['manifest']['tables'][0]['rows']), 3)
        self.assertNotIn('fixed_consumer_capacity', result['manifest']['tables'][0]['expansion'])

    def test_repeated_relocation_retains_unique_allocation_history(self):
        manifest, rom = fixture()
        result = edit(manifest, rom, [dict(op='append', table='table', row=dict(value=7))])
        result = edit(result['manifest'], result['rom'], [dict(op='append', table='table', row=dict(value=8))])
        result['manifest']['tables'][0]['expansion']['free_region'].update(rom_offset=len(result['rom']), size=12)
        result = edit(result['manifest'], result['rom'], [dict(op='append', table='table', row=dict(value=9))])
        ids = [allocation['id'] for allocation in result['manifest']['allocations']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(result['manifest']['tables'][0]['rows']), 5)
        self.assertEqual(result['rom'][276], 5)

    def test_count_binding_must_match_logical_rows(self):
        manifest, rom = fixture()
        manifest['tables'][0]['bindings'][1]['expected'] = 1
        rom = bytearray(rom)
        rom[276] = 1
        rom = bytes(rom)
        manifest['rom']['sha256'] = sha(rom)
        with self.assertRaisesRegex(ValueError, 'count binding disagrees'):
            validate_manifest(manifest, rom)

    def test_enumerated_field_domain_guards_capture_and_edit(self):
        manifest, rom = fixture()
        manifest['tables'][0]['fields'][0]['allowed_values'] = [1, 2, 7]
        with self.assertRaisesRegex(ValueError, 'allowed_values'):
            edit(manifest, rom, [dict(op='set', table='table', index=0, field='value', value=3)])
        result = edit(manifest, rom, [dict(op='append', table='table', row=dict(value=7))])
        self.assertEqual(result['manifest']['tables'][0]['rows'][-1]['value'], 7)
        manifest['tables'][0]['fields'][0]['allowed_values'] = [1]
        with self.assertRaisesRegex(ValueError, 'allowed_values'):
            validate_manifest(manifest, rom)

    def test_unknown_expansion_blocks_only_growth(self):
        manifest,rom=fixture();manifest['tables'][0]['expansion']['reference_closure']='unknown'
        edit(manifest,rom,[dict(op='set',table='table',index=0,field='value',value=2)])
        with self.assertRaisesRegex(ValueError,'expansion blocked'):
            edit(manifest,rom,[dict(op='append',table='table',row=dict(value=7))])

    def test_stale_rom_manifest_and_range(self):
        manifest,rom=fixture()
        with self.assertRaisesRegex(ValueError,'stale ROM'):
            edit(manifest,rom+b'X',[dict(op='set',table='table',index=0,field='value',value=2)])
        with self.assertRaisesRegex(ValueError,'semantic bounds'):
            edit(manifest,rom,[dict(op='set',table='table',index=0,field='value',value=11)])
        with self.assertRaisesRegex(ValueError,'stale manifest'):
            compile_edit(manifest,rom,dict(manifest_sha256='wrong',operations=[dict(op='set')]))

    def test_binding_code_and_overlapping_ownership_fail(self):
        manifest,rom=fixture();manifest['allocations'][1]['kind']='code'
        with self.assertRaisesRegex(ValueError,'instruction encoding unsupported'):
            validate_manifest(manifest,rom)
        manifest,rom=fixture();manifest['allocations'].append(dict(id='overlap',rom_offset=257,size=2,kind='mixed'))
        with self.assertRaisesRegex(ValueError,'overlapping allocation'):
            validate_manifest(manifest,rom)

    def test_pointer_target_and_header_fail(self):
        manifest,rom=fixture();manifest['tables'][0]['bindings'][0]['target_addend']=1000
        with self.assertRaisesRegex(ValueError,'pointer addend'):
            validate_manifest(manifest,rom)
        manifest,rom=fixture();manifest['tables'][0]['rom_offset']=0
        with self.assertRaisesRegex(ValueError,'cartridge header'):
            validate_manifest(manifest,rom)

    def test_graphics_validator_gates_emission(self):
        manifest,rom=fixture()
        manifest['graphics_contracts']=[dict(contract=dict(kind='gba-palette/1',id='palette',palette='colors'),
                                             assets=dict(colors=dict(table='table')))]
        # Existing padding high bit makes this an invalid canonical BGR555 palette.
        with self.assertRaisesRegex(ValueError,'bit 15'):
            edit(manifest,rom,[dict(op='set',table='table',index=0,field='value',value=2)])

    def test_output_identity_and_dependency_c_are_current(self):
        manifest,rom=fixture();manifest['rom']['sha1']='baseline'
        manifest['allocations'][0]['sha256']=sha(rom[256:260])
        result=edit(manifest,rom,[dict(op='append',table='table',row=dict(value=7))])
        self.assertNotEqual(result['manifest']['rom']['sha1'],'baseline')
        self.assertEqual(result['manifest']['baseline_rom_provenance']['sha1'],'baseline')
        table=next(a for a in result['manifest']['allocations'] if a['id']=='table')
        self.assertEqual(table['sha256'],sha(result['rom'][512:520]))
        self.assertIn('0x00000114, 1, gameverse_write_2',result['source'])

    def test_fixed_consumers_and_interior_aliases(self):
        manifest,rom=fixture();table=manifest['tables'][0]
        table['bindings']=table['bindings'][:1];table['bindings'][0]['target_addend']=2
        table['bindings'][0]['expected']+=2
        rom=bytearray(rom);rom[272:276]=encode(0x08000102,'u32');rom=bytes(rom);manifest['rom']['sha256']=sha(rom)
        table['expansion']['fixed_consumer_capacity']=3
        result=edit(manifest,rom,[dict(op='append',table='table',row=dict(value=5))])
        self.assertEqual(result['rom'][272:276],encode(0x08000202,'u32'))
        with self.assertRaisesRegex(ValueError,'fixed consumer capacity'):
            edit(manifest,rom,[dict(op='append',table='table',row=dict(value=5)),dict(op='append',table='table',row=dict(value=6))])


if __name__=='__main__': unittest.main()
