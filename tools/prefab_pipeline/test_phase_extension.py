"""Focused agent boundary regressions; no ROM builds or broad campaign."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from tools.prefab_pipeline.phase_extension import ROOT, extend_phase_request

REQUEST = ROOT / 'research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/minish-request.json'


class PhaseExtensionTests(unittest.TestCase):
    def test_real_request_persists_valid_same_module_graph_and_roundtrip(self):
        request = json.loads(REQUEST.read_text())
        with tempfile.TemporaryDirectory(prefix='phase-cli-test-') as folder:
            receipt = extend_phase_request(request, Path(folder) / 'attempt')
            self.assertEqual(receipt['status'], 'passed', receipt.get('error'))
            graph = json.loads(Path(receipt['outputs']['graph']['path']).read_text())
            back = json.loads(Path(receipt['outputs']['backGraph']['path']).read_text())
            again = json.loads(Path(receipt['outputs']['reselectedGraph']['path']).read_text())
            cache, bank, result = [receipt['stateMap'][name] for name in ('skillCache', 'inventoryBank', 'beamEligibility')]
            self.assertEqual(graph['initialize'][bank][0], 165)
            self.assertEqual(graph['initialize'][cache], 2048)
            self.assertEqual(receipt['componentMap']['refresh'], graph['state'][cache]['owner'])
            self.assertNotIn(result, back['state'])
            self.assertNotIn(result, again['initialize'])
            self.assertTrue(all(row['valid'] for row in json.loads(Path(receipt['outputs']['validation']['path']).read_text())))

    def test_stale_pin_fails_with_retained_receipt_and_no_composed_graph(self):
        request = copy.deepcopy(json.loads(REQUEST.read_text()))
        request['lifecycleAdapter']['sha256'] = '0' * 64
        with tempfile.TemporaryDirectory(prefix='phase-cli-pin-') as folder:
            output = Path(folder) / 'attempt'
            receipt = extend_phase_request(request, output)
            self.assertEqual(receipt['status'], 'failed')
            self.assertIn('Stale file byte pin', receipt['error'])
            self.assertTrue((output / 'receipt.json').is_file())
            self.assertFalse((output / 'extended-graph.json').exists())
