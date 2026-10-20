"""Focused resolver guards; native behavior proof is the explicit mod-ROM run."""
import copy
import json
import unittest
from tools.prefab_pipeline.mod_rom import ROOT, prepare_mod_request

class ModRequestTests(unittest.TestCase):
    def setUp(self):
        self.request = json.loads((ROOT/'tools/prefab_pipeline/requests/aria-double-xp.json').read_text())

    def test_unsupported_prefab_rejected(self):
        request = copy.deepcopy(self.request)
        request['prefab_id'] = 'unknown.gameplay'
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            prepare_mod_request(request)

    def test_unqualified_parameter_rejected(self):
        request = copy.deepcopy(self.request)
        request['modification']['value'] = 3
        with self.assertRaisesRegex(ValueError, 'qualified'):
            prepare_mod_request(request)

    def test_changed_input_rejected(self):
        request = copy.deepcopy(self.request)
        request['package']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'pinned input'):
            prepare_mod_request(request)

if __name__ == '__main__':
    unittest.main()
