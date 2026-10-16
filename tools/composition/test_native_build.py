"""Contract rejection checks; no ROM corpus, native compiler or emulator needed."""
import copy
import hashlib
import json
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
