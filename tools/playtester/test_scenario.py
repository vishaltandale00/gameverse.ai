import copy
import unittest
from .scenario import ScenarioAdapter, matches, validate

SPEC = {'schema':'native-scenario-graph/1','id':'level','objective':'native stage transition after acquisition',
        'nodes':[{'id':'start','conditions':[{'field':'stage','op':'eq','value':0}]},
                 {'id':'acquired','after':['start'],'conditions':[{'field':'upgrades','op':'mask_all','value':3}]},
                 {'id':'next','after':['acquired'],'conditions':[{'field':'stage','op':'eq','value':1}]}],
        'goals':['next']}

class Adapter:
    def __init__(self): self.facts={'stage':0,'upgrades':0}; self.frame=0
    def observe(self): self.frame+=1; return {'frame':self.frame,'facts':copy.deepcopy(self.facts)}
    def checkpoint(self): return {'state_path':'state', 'checkpoint':'token'}
    def restore(self, token): return {'checkpoint':token}

class ScenarioTests(unittest.TestCase):
    def test_native_sequence_and_checkpoint_resume(self):
        inner=Adapter(); adapter=ScenarioAdapter(inner,SPEC)
        self.assertFalse(adapter.observe().get('terminal',False))
        inner.facts.update(upgrades=3)
        adapter.observe(); checkpoint=adapter.checkpoint()['scenario_state']; before=copy.deepcopy(checkpoint)
        resumed=ScenarioAdapter(inner,SPEC,checkpoint)
        inner.facts.update(stage=1)
        self.assertTrue(resumed.observe()['success'])
        self.assertEqual(checkpoint,before)
        self.assertEqual(set(resumed.objective_witness['nodes']),{'start','acquired','next'})
    def test_speculative_restore_discards_speculative_progress(self):
        inner=Adapter(); adapter=ScenarioAdapter(inner,SPEC);adapter.observe()
        token=adapter.checkpoint()['checkpoint']
        inner.facts.update(upgrades=3);adapter.observe()
        self.assertIn('acquired',adapter.reached)
        adapter.restore(token)
        self.assertEqual(set(adapter.reached),{'start'})

    def test_missing_stage_does_not_manufacture_progress(self):
        inner=Adapter();inner.facts={'stage':1,'upgrades':3}
        adapter=ScenarioAdapter(inner,SPEC)
        for _ in range(20):self.assertFalse(adapter.observe().get('success',False))
    def test_changed_graph_checkpoint_rejected(self):
        inner=Adapter();adapter=ScenarioAdapter(inner,SPEC);adapter.observe()
        changed=copy.deepcopy(SPEC);changed['objective']='different'
        with self.assertRaisesRegex(ValueError,'identity'):ScenarioAdapter(inner,changed,adapter.checkpoint()['scenario_state'])
    def test_inner_success_cannot_complete_outer_graph(self):
        inner=Adapter(); original=inner.observe
        inner.observe=lambda: dict(original(),terminal=True,success=True)
        adapter=ScenarioAdapter(inner,SPEC)
        self.assertFalse(adapter.observe()['terminal'])
        self.assertIsNone(adapter.objective_witness)

    def test_inner_checkpoint_state_preserved_separately(self):
        inner=Adapter(); inner.checkpoint=lambda: {'state_path':'state','scenario_state':{'initial_xp':7}}
        adapter=ScenarioAdapter(inner,SPEC);adapter.observe()
        checkpoint=adapter.checkpoint()
        self.assertEqual(checkpoint['native_adapter_scenario_state'],{'initial_xp':7})
        self.assertEqual(checkpoint['scenario_state']['reached']['start']['facts']['stage'],0)

    def test_unknown_and_missing_fields_false(self):
        self.assertFalse(matches({}, {'field':'stage','op':'eq','value':0}))
        self.assertFalse(matches({'stage':None},{'field':'stage','op':'ge','value':0}))
    def test_forward_dependency_rejected(self):
        changed=copy.deepcopy(SPEC);changed['nodes'][0]['after']=['next']
        with self.assertRaisesRegex(ValueError,'dependency'):validate(changed)
