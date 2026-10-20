import copy
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from .reference_bindings import ROOT, binding


class ReferenceBindingTests(unittest.TestCase):
    def adapter(self):
        evidence = {'path': 'tools/roundtrip/reference_bindings.py',
                    'sha256': hashlib.sha256((ROOT/'tools/roundtrip/reference_bindings.py').read_bytes()).hexdigest()}
        # Fixture identity only: these tests do not certify source allocations.
        return {'parameters': [], 'return_type': 'void', 'collections': [],
                'fields': [{'name': 'value', 'width': 16, 'owner': 'reference', 'reference': 'object_0', 'offset': 8}],
                'object_references': [{'name': 'object_0', 'cell': 0x02000100, 'identity': 'fixture',
                                       'lifetime': 'stable_for_invocation', 'alias_contract': 'distinct_owned_object'}],
                'reference_binding_authority': {'schema': 'gameverse.reference-binding-authority/1',
                    'stable_for_invocation': True, 'distinct_owned_objects': True, 'evidence': [evidence],
                    'references': [{'name': 'object_0', 'cell': 0x02000100, 'identity': 'fixture', 'alignment': 4,
                                    'allocation_bytes': 32, 'source_evidence': evidence}]}}

    def test_actual_arm_compilation_requires_rejection_callback(self):
        source = '#include <stdint.h>\ntypedef struct {uint16_t value;} State_example;\nvoid lifted_example(State_example*s){s->value++;}\n'+binding(self.adapter(), 'example')
        with tempfile.TemporaryDirectory() as tmp:
            src, obj = Path(tmp)/'binding.c', Path(tmp)/'binding.o'
            src.write_text(source)
            subprocess.run(['cc', '-target', 'armv4t-none-eabi', '-mcpu=arm7tdmi', '-mthumb', '-ffreestanding', '-Os', '-c', str(src), '-o', str(obj)], check=True, capture_output=True)
            symbols = subprocess.run(['arm-none-eabi-nm', str(obj)], check=True, capture_output=True, text=True).stdout
            self.assertIn('U reference_binding_reject', symbols)

    def test_missing_and_stale_authority_rejected(self):
        for key in ('stable_for_invocation', 'distinct_owned_objects', 'evidence'):
            adapter = self.adapter()
            del adapter['reference_binding_authority'][key]
            with self.assertRaises(ValueError): binding(adapter, 'example')
        adapter = self.adapter()
        adapter['reference_binding_authority']['evidence'][0]['sha256'] = '0'*64
        with self.assertRaises(ValueError): binding(adapter, 'example')

    def test_unproven_allocation_and_identity_rejected(self):
        for key, value in [('allocation_bytes', 8), ('source_evidence', {}), ('identity', 'other'), ('cell', 0x08000000)]:
            adapter = self.adapter()
            adapter['reference_binding_authority']['references'][0][key] = value
            with self.assertRaises(ValueError): binding(adapter, 'example')

    def test_overlapping_scalars_and_unresolved_mixed_owners_rejected(self):
        adapter = self.adapter()
        adapter['fields'].append(dict(adapter['fields'][0], name='duplicate'))
        with self.assertRaises(ValueError): binding(adapter, 'example')
        adapter = self.adapter()
        adapter['fields'][0]['owner'] = 'global'
        with self.assertRaises(ValueError): binding(adapter, 'example')

    def test_unsupported_collections_rejected(self):
        adapter = self.adapter()
        adapter['collections'] = [{'name': 'unresolved'}]
        with self.assertRaises(ValueError): binding(adapter, 'example')

    def test_missing_identity_rejected_even_when_both_absent(self):
        adapter = self.adapter()
        del adapter['object_references'][0]['identity']
        del adapter['reference_binding_authority']['references'][0]['identity']
        with self.assertRaises(ValueError): binding(adapter, 'example')


if __name__ == '__main__':
    unittest.main()
