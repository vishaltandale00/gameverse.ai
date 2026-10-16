import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from tools.playtester import test_mod_quality as quality_fixtures
from .contract import file_ref
from .quality_dispatch import attach_quality

class QualityDispatchTests(unittest.TestCase):
    def test_missing_contract_is_explicit_not_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            context=SimpleNamespace(output=Path(temp),checkpoint=None)
            result=attach_quality({}, {'experiment':{}}, {}, {'evidence':[],'success':True},context)
            self.assertEqual(result['mod_quality']['status'],'unsupported')
            self.assertTrue(result['mod_quality']['native_objective_observed'])
    def test_original_baseline_never_becomes_mod_comparison(self):
        with tempfile.TemporaryDirectory() as temp:
            result=attach_quality({'role':'original'}, {'experiment':{}}, {}, {'evidence':[]},SimpleNamespace(output=Path(temp),checkpoint=None))
            self.assertEqual(result['mod_quality']['status'],'not-evaluated')
    def test_actual_candidate_and_bound_baseline_dispatch_existing_evaluator(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);contract=quality_fixtures.spec();runs=quality_fixtures.QualityTests().evidence(root,contract)
            plan=root/'quality.json';plan.write_text(json.dumps(contract))
            play=root/'play';play.mkdir()
            for key,name in [('report','report.json'),('events','events.jsonl')]:
                shutil.copyfile(runs['candidate'][key]['path'],play/name)
            observed={'evidence':[file_ref(play/'report.json'),file_ref(play/'events.jsonl')],'success':True}
            result=attach_quality({'source_revision':'source','save':{'sha256':'same'}},
                {'experiment':{'mod_quality_ref':file_ref(plan),'mod_quality_runs':{'original':runs['original']}}},
                {'sha256':'v2'},observed,SimpleNamespace(output=root,checkpoint=None))
            self.assertEqual(result['mod_quality']['status'],'passed')
            self.assertTrue((root/'mod-quality.json').is_file())
    def test_resumed_checkpoint_cannot_be_labelled_ordinary_save(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);contract=quality_fixtures.spec();runs=quality_fixtures.QualityTests().evidence(root,contract)
            plan=root/'quality.json';plan.write_text(json.dumps(contract));play=root/'play';play.mkdir()
            for key,name in [('report','report.json'),('events','events.jsonl')]:shutil.copyfile(runs['candidate'][key]['path'],play/name)
            result=attach_quality({'source_revision':'source','save':{'sha256':'same'}},
                {'experiment':{'mod_quality_ref':file_ref(plan),'mod_quality_runs':{'original':runs['original']}}},{'sha256':'v2'},
                {'evidence':[file_ref(play/'report.json'),file_ref(play/'events.jsonl')]},
                SimpleNamespace(output=root,checkpoint={'state':{'sha256':'native-checkpoint'}}))
            self.assertEqual(result['mod_quality']['status'],'failed')

    def test_missing_baseline_retains_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);contract=quality_fixtures.spec();runs=quality_fixtures.QualityTests().evidence(root,contract)
            plan=root/'quality.json';plan.write_text(json.dumps(contract));play=root/'play';play.mkdir()
            for key,name in [('report','report.json'),('events','events.jsonl')]:shutil.copyfile(runs['candidate'][key]['path'],play/name)
            result=attach_quality({'source_revision':'source','save':{'sha256':'same'}},
                {'experiment':{'mod_quality_ref':file_ref(plan)}},{'sha256':'v2'},
                {'evidence':[file_ref(play/'report.json'),file_ref(play/'events.jsonl')]},SimpleNamespace(output=root,checkpoint=None))
            self.assertEqual(result['mod_quality']['status'],'unknown')
