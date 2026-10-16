"""Contract rejection checks; no ROM corpus, native compiler or emulator needed."""
import copy
import hashlib
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.composition import native_build as native


class NativeContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.root_patch = patch.object(native, 'ROOT', self.root)
        self.root_patch.start()
        self.rom = bytes(range(32))
        self.write('leaf.c', b'void leaf(void *p) {(void)p;}\n')
        recovery = {'rom_sha256': native.sha(self.rom), 'ranges': [],
                    'dependency_closure': {'status': 'closed'}}
        self.package = {'kind': 'component_package', 'ir_version': '0.1', 'id': 'leaf', 'version': '1',
                        'native_implementation': {'origin': 'self_decompilation', 'recovery': recovery},
                        'lowering': {'native_v1': {'version': 'freestanding-c-thumb/1',
                            'sources': [self.pin('leaf.c')], 'translation_units': ['leaf.c'],
                            'exports': [{'symbol': 'leaf', 'return': 'void', 'args': ['ptr']}],
                            'requires': [], 'state_bindings': []}}}
        self.write('package.json', self.package)
        self.host = {'version': 'gba-thumb-host/1', 'game_id': 'fixture',
                     'rom_sha256': native.sha(self.rom), 'rom_sha1': hashlib.sha1(self.rom).hexdigest(),
                     'rom_bytes': 32, 'append_address': '0x08000020', 'output_bytes': 1<<23,
                     'abi': 'aapcs-arm7tdmi-thumb-leaf-replacement', 'campaign': {},
                     'hooks': [{'id': 'tick', 'address': '0x08000004', 'preimage': self.rom[4:12].hex(),
                                'cardinality': 1, 'abi': 'r0-actor-void-thumb', 'phase': 'tick', 'writes': ['actor']}]}
        self.write('host.json', self.host)
        self.plan = {'ir_version': '0.1', 'kind': 'composition_plan', 'id': 'fixture',
                     'execution': {'modes': ['play'], 'phases': ['tick']},
                     'states': [{'id': 'actor'}],
                     'components': [{'id': 'motion', 'implementation': {'status': 'lowered'},
                                     'accesses': [{'state': 'actor', 'phase': 'tick', 'op': 'write', 'modes': ['play']}]}],
                     'native_build': {'version': native.VERSION, 'host': self.pin('host.json'),
                                      'packages': [{'instance': 'motion', 'package': self.pin('package.json')}],
                                      'hooks': [{'host_hook': 'tick', 'instance': 'motion', 'symbol': 'leaf', 'args': [{'arg': 0}]}],
                                      'max_payload_bytes': 1024, 'timeout_s': 5}}

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def write(self, ref, content):
        (self.root/ref).write_bytes(content if isinstance(content, bytes) else json.dumps(content).encode())

    def pin(self, ref):
        return {'ref': ref, 'sha256': native.sha((self.root/ref).read_bytes())}

    def package_update(self):
        self.write('package.json', self.package)
        self.plan['native_build']['packages'][0]['package'] = self.pin('package.json')

    def global_fixture(self):
        self.rom = self.rom[:24] + bytes.fromhex('00000002') + self.rom[28:]
        self.package['native_implementation']['recovery']['rom_sha256'] = native.sha(self.rom)
        self.host.update(rom_sha256=native.sha(self.rom), rom_sha1=hashlib.sha1(self.rom).hexdigest())
        fields = [{'offset': 0, 'width': 16, 'type': 'i16', 'quantity': 'current_mp', 'access': 'read-write'},
                  {'offset': 4, 'width': 16, 'type': 'u16', 'quantity': 'maximum_mp', 'access': 'read'}]
        self.region = {'id': 'magic', 'address': '0x02000010', 'bytes': 6, 'owner': 'actor', 'phases': ['tick'],
                       'fields': fields, 'source_evidence': [self.pin('leaf.c')],
                       'address_source': {'address': '0x08000018', 'preimage': '00000002', 'offset': 16}}
        self.host['campaign']['global_regions'] = [self.region]
        self.lease = {'id': 'magic', 'storage': 'host-global', 'region': 'magic', 'bytes': 6,
                      'lifetime': 'campaign', 'fields': copy.deepcopy(fields), 'allocation': None}
        self.package['lowering']['native_v1']['state_bindings'] = [self.lease]
        self.global_update()

    def global_update(self):
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        self.package_update()

    def test_missing_tools_preflight_has_actionable_list_without_processes(self):
        self.write('fixture.gba', self.rom)
        empty_path = self.root / 'empty-path';empty_path.mkdir()
        with patch.dict(os.environ, {'PATH': str(empty_path)}), patch.object(native.platform, 'platform', return_value='hermetic-test'), patch.object(native.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Missing native build tools on PATH: git, cc, arm-none-eabi-ld, arm-none-eabi-objcopy, arm-none-eabi-nm'):
                native.build(self.plan, self.root/'fixture.gba', self.root/'output')
        run.assert_not_called()
        receipt=json.loads((self.root/'output/receipt.json').read_text())
        self.assertEqual(receipt['outcome'],'failed')
        self.assertIn('update PATH',receipt['error'])
        self.assertEqual(receipt['stages'],[])

    def test_tool_resolution_preserves_selected_real_binary_provenance(self):
        # Use the real Python executable as data; execute no compiler or stub.
        executable=Path(sys.executable).absolute()
        empty_path=self.root/'empty-path';empty_path.mkdir()
        with patch.dict(os.environ, {'PATH':str(empty_path)}):
            result=native.resolve_tools((str(executable),))
        self.assertEqual(result[str(executable)]['path'],str(executable))
        self.assertEqual(result[str(executable)]['sha256'],native.sha(executable.resolve().read_bytes()))

    def test_global_typed_existing_ram_no_allocation(self):
        self.global_fixture()
        _, _, packages, _, _, _ = native.validate(self.plan, self.rom)
        header = native.state_header(packages)
        self.assertIn('int16_t field_0;', header)
        self.assertIn('uint16_t field_1;', header)
        self.assertNotIn('static struct', header)
        self.lease['fields'] = self.lease['fields'][:1]
        self.global_update()
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)

    def test_global_mmio_overlap_alignment_and_bounds_rejected(self):
        for address in ('0x04000010', '0x02000011', '0x0203fffe', '0x03007ffe'):
            with self.subTest(address=address):
                self.global_fixture()
                self.region['address'] = address
                self.global_update()
                with self.assertRaises(ValueError):
                    native.validate(self.plan, self.rom)
        self.global_fixture()
        duplicate = copy.deepcopy(self.region)
        duplicate['id'] = 'other'
        self.host['campaign']['global_regions'].append(duplicate)
        self.global_update()
        with self.assertRaisesRegex(ValueError, 'overlapping'):
            native.validate(self.plan, self.rom)

    def test_global_unclaimed_signedness_access_and_allocation_rejected(self):
        for mutation in (lambda lease: lease.update(region='unknown'),
                         lambda lease: lease.update(allocation={'bytes': 6}),
                         lambda lease: lease['fields'][0].update(type='u16'),
                         lambda lease: lease['fields'][1].update(access='read-write'),
                         lambda lease: lease['fields'][1].update(offset=2)):
            self.global_fixture()
            mutation(self.lease)
            self.global_update()
            with self.assertRaises(ValueError):
                native.validate(self.plan, self.rom)

    def test_global_source_and_rom_pointer_pins_required(self):
        self.global_fixture()
        self.region['source_evidence'][0]['sha256'] = '0'*64
        self.global_update()
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            native.validate(self.plan, self.rom)
        self.global_fixture()
        self.region['address_source']['offset'] = 18
        self.global_update()
        with self.assertRaisesRegex(ValueError, 'pointer origin'):
            native.validate(self.plan, self.rom)

    def test_global_owner_and_phase_must_match_resolved_hook(self):
        for key, value in (('owner', 'unclaimed'), ('phases', ['other'])):
            self.global_fixture()
            self.region[key] = value
            self.global_update()
            with self.assertRaisesRegex(ValueError, 'logical owner authority'):
                native.validate(self.plan, self.rom)

    def projected_fixture(self):
        self.global_fixture()
        fields = [{'offset': 0, 'width': 32, 'type': 'i32', 'quantity': 'velocity_x', 'access': 'read-write'},
                  {'offset': 4, 'width': 32, 'type': 'i32', 'quantity': 'velocity_y', 'access': 'read-write'}]
        self.projected = {'id': 'player_motion', 'bytes': 8, 'owner': 'actor', 'phases': ['tick'], 'fields': fields,
                          'source_evidence': [self.pin('leaf.c')],
                          'projection': {'kind': 'canonical-actor-parent/1',
                                         'root_source': {'address': '0x08000018', 'preimage': '00000002'},
                                         'pointer_slot_offset': 16, 'subject_parent_offset': 20, 'field_offset': 72}}
        self.host['campaign']['projected_regions'] = [self.projected]
        self.lease = {'id': 'player_motion', 'storage': 'host-projected-actor', 'region': 'player_motion',
                      'bytes': 8, 'lifetime': 'native-entity', 'fields': copy.deepcopy(fields), 'allocation': None}
        self.package['lowering']['native_v1']['state_bindings'] = [self.lease]
        self.global_update()

    def test_projected_actor_emits_guarded_signed_accessor(self):
        self.projected_fixture()
        _, host, packages, _, _, _ = native.validate(self.plan, self.rom)
        header = native.state_header(packages, native.validate_projected_regions(host, self.rom))
        self.assertIn('gv_access_motion_player_motion(void *subject)', header)
        self.assertIn('int32_t field_0;', header)
        self.assertIn('int32_t field_1;', header)
        # Both actor extents and parent identity are checked before a pointer to
        # writable velocity is returned; no actor allocation/default is emitted.
        self.assertLess(header.index('gv_existing_ram_span(actor,24u)'), header.index('actor+20u'))
        self.assertLess(header.index('gv_existing_ram_span(player,80u)'), header.index('actor+20u'))
        self.assertLess(header.index('actor+20u) != player'), header.index('player+72u'))

    def test_projected_actor_rejects_unpinned_or_unsafe_pointer_chain(self):
        for mutation in (lambda p: p.update(kind='arbitrary-chain'),
                         lambda p: p['root_source'].update(preimage='01000002'),
                         lambda p: p.update(pointer_slot_offset=0x02000000),
                         lambda p: p.update(pointer_slot_offset=17),
                         lambda p: p.update(subject_parent_offset=21),
                         lambda p: p.update(field_offset=4096)):
            self.projected_fixture()
            mutation(self.projected['projection'])
            self.global_update()
            with self.assertRaises(ValueError):
                native.validate(self.plan, self.rom)

    def test_projected_actor_requires_exact_owner_field_and_phase(self):
        for mutate in (lambda: self.projected.update(owner='not_actor'),
                       lambda: self.projected.update(phases=['effect']),
                       lambda: self.lease['fields'][0].update(type='u32')):
            self.projected_fixture()
            mutate()
            self.global_update()
            with self.assertRaises(ValueError):
                native.validate(self.plan, self.rom)

    def test_projected_actor_rejects_overlapping_divergent_owner(self):
        self.projected_fixture()
        other = copy.deepcopy(self.projected)
        other.update(id='second_name', owner='another_authority')
        self.host['campaign']['projected_regions'].append(other)
        self.global_update()
        with self.assertRaisesRegex(ValueError, 'overlapping projected actor authority'):
            native.validate(self.plan, self.rom)
        other['owner'] = self.projected['owner']
        self.global_update()
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)

    def test_typed_second_register_and_empty_callback_contract(self):
        hook = self.host['hooks'][0]
        hook.update(abi='aapcs-thumb', args=['ptr', 'u32'], **{'return': 'void'})
        self.package['lowering']['native_v1']['exports'][0]['args'] = ['ptr', 'u32']
        self.plan['native_build']['hooks'][0]['args'] = [{'arg': 0}, {'arg': 1}]
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        self.package_update()
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)
        self.package['lowering']['native_v1']['exports'][0]['args'][1] = 'ptr'
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'typed incompatibly'):
            native.validate(self.plan, self.rom)
        hook['args'] = []
        self.package['lowering']['native_v1']['exports'][0]['args'] = []
        self.plan['native_build']['hooks'][0]['args'] = []
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        self.package_update()
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)

    def test_fourth_argument_requires_register_preserving_entry_extent(self):
        hook = self.host['hooks'][0]
        hook.update(abi='aapcs-thumb', args=['ptr', 'u32', 'i16', 'ptr'], **{'return': 'void'})
        self.package['lowering']['native_v1']['exports'][0]['args'] = hook['args'][:]
        self.plan['native_build']['hooks'][0]['args'] = [{'arg': n} for n in range(4)]
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'preimage/alignment'):
            native.validate(self.plan, self.rom)
        hook['preimage'] = self.rom[4:20].hex()
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)


    def test_campaign_state_needs_persistent_native_task_owner(self):
        lease = {'id': 'inventory', 'storage': 'native-task-data', 'bytes': 64,
                 'lifetime': 'campaign', 'writes': [{'offset': 0, 'width': 32, 'quantity': 'ability_bits'}],
                 'allocation': {'service': 'task_create', 'bytes': 64, 'alignment': 4,
                                'flags': 2, 'priority': 65280, 'locator': 'task-list + magic'}}
        native.validate_states([lease])
        lease['allocation']['flags'] = 0
        with self.assertRaisesRegex(ValueError, 'persistent-task flag'):
            native.validate_states([lease])


    def test_matching_contract_resolves(self):
        self.assertEqual(len(native.validate(self.plan, self.rom)[4]), 1)

    def test_rom_identity_and_hook_preimage_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            native.validate(self.plan, self.rom[:-1]+b'\xff')
        self.host['hooks'][0]['preimage'] = 'ff'*8
        self.write('host.json', self.host)
        self.plan['native_build']['host'] = self.pin('host.json')
        with self.assertRaisesRegex(ValueError, 'preimage'):
            native.validate(self.plan, self.rom)

    def test_source_edit_requires_package_repin(self):
        self.write('leaf.c', b'void leaf(void *p) {*(int *)p=7;}\n')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            native.validate(self.plan, self.rom)

    def test_undeclared_dependencies_and_cycles_rejected(self):
        self.package['lowering']['native_v1']['requires'] = [{'id': 'other', 'version': '1'}]
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'Missing native dependency'):
            native.validate(self.plan, self.rom)
        self.package['lowering']['native_v1']['requires'] = [{'id': 'leaf', 'version': '1'}]
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'cycle'):
            native.validate(self.plan, self.rom)

    def test_hook_overlap_and_state_writer_rejected(self):
        self.plan['native_build']['hooks'].append(copy.deepcopy(self.plan['native_build']['hooks'][0]))
        with self.assertRaisesRegex(ValueError, 'overlapping'):
            native.validate(self.plan, self.rom)
        self.plan['native_build']['hooks'].pop()
        self.plan['components'][0]['accesses'] = []
        with self.assertRaisesRegex(ValueError, 'state authority'):
            native.validate(self.plan, self.rom)

    def test_return_abi_and_parameter_domain_rejected(self):
        export = self.package['lowering']['native_v1']['exports'][0]
        export['return'] = 'i32'
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'return ABI'):
            native.validate(self.plan, self.rom)
        export['return'] = 'void'
        export['args'].append('i32')
        export['constant_choices'] = {'1': [0, 1]}
        self.package_update()
        self.plan['native_build']['hooks'][0]['args'].append({'constant': 2})
        with self.assertRaisesRegex(ValueError, 'semantic choices'):
            native.validate(self.plan, self.rom)

    def test_unlowered_transform_and_overlapping_state_rejected(self):
        self.plan['transforms'] = [{'id': 'unimplemented'}]
        with self.assertRaisesRegex(ValueError, 'not lowered'):
            native.validate(self.plan, self.rom)
        self.plan.pop('transforms')
        self.package['lowering']['native_v1']['state_bindings'] = [{
            'id': 'actor', 'storage': 'host-r0-actor', 'bytes': 16,
            'lifetime': 'native-entity', 'allocation': 'none',
            'writes': [{'offset': 0, 'width': 32, 'quantity': 'x'},
                       {'offset': 2, 'width': 16, 'quantity': 'overlap'}]}]
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'Overlapping'):
            native.validate(self.plan, self.rom)

    def test_unknown_abi_and_global_read_rejected(self):
        self.package['lowering']['native_v1']['exports'][0]['args'] = ['float']
        self.package_update()
        with self.assertRaisesRegex(ValueError, 'export ABI'):
            native.validate(self.plan, self.rom)
        self.package['lowering']['native_v1']['exports'][0]['args'] = ['ptr']
        self.package_update()
        self.plan['native_build']['hooks'][0]['args'] = [{'read': {'address': '0x03000000', 'width': 16}}]
        with self.assertRaisesRegex(ValueError, 'Undeclared native global'):
            native.validate(self.plan, self.rom)


if __name__ == '__main__':
    unittest.main()
