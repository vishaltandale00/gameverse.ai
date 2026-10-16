import copy
import json
from pathlib import Path
import tempfile
import unittest
from .mod_quality import evaluate, validate, VERSION
from .rpg_adapter import pin


def spec():
    start = {'kind':'ordinary_save', 'reference':{'sha256':'same'}, 'boundary':{'map_group':1,'map_number':2,'x':0,'y':0}, 'provenance':'copied source save'}
    version = {'game_id':'rpg', 'game_version':'v1', 'source_revision':'source', 'adapter_version':'adapter', 'startpoint':start}
    scenario = {'schema':'native-scenario-graph/1', 'id':'objective', 'nodes':[{'id':'goal','conditions':[{'field':'x','op':'ge','value':10}]}], 'goals':['goal']}
    invariant = copy.deepcopy(scenario); invariant['nodes'][0]['conditions'][0]['value']=0
    result = {'schema':VERSION, 'id':'mod-quest', 'original':copy.deepcopy(version), 'candidate':copy.deepcopy(version),
        'comparison':{'inputs':'same','reason':'same copied save at matching overworld boundary'},
        'checks':[{'id':kind,'kind':kind,'expectations':{'original':copy.deepcopy(invariant if kind=='invariant' else scenario),
                    'candidate':copy.deepcopy(invariant if kind=='invariant' else scenario)}} for kind in ('objective','invariant','reachability','changed_mechanic')]}
    result['candidate']['game_version'] = 'v2'
    result['checks'][-1]['expectations']['candidate']['nodes'][0]['conditions'][0]['value'] = 12
    return result


class QualityTests(unittest.TestCase):
    def evidence(self, root, config, xs=(0,10)):
        result={}
        for side in ('original','candidate'):
            report=root/(side+'.json');events=root/(side+'.jsonl')
            expected=config[side]
            report.write_text(json.dumps({'run_id':side,'adapter':{key:expected[key] for key in ('game_id','game_version','adapter_version')},'status':'stopped','reason':'frame_limit'}))
            events.write_text('\n'.join(json.dumps({'event':'observation','observation':{'frame':i,'state_key':str(i),'facts':{'x':x,'y':0,'map_group':1,'map_number':2}}}) for i,x in enumerate(tuple(v + 2 if v >= 10 and side == 'candidate' else v for v in xs))))
            bound_report=json.loads(report.read_text());bound_report['events_sha256']=pin(events)['sha256'];report.write_text(json.dumps(bound_report))
            result[side]={'report':pin(report),'events':pin(events),'startpoint':expected['startpoint'],'source_revision':expected['source_revision']}
        return result
    def test_matching_boundary_declared_checks_only(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();result=evaluate(config,self.evidence(Path(temp),config))
            self.assertEqual(result['status'],'passed');self.assertFalse(result['full_campaign_qualified'])
    def test_same_artifact_cannot_be_awarded_mod_quality(self):
        config=spec();config['candidate']['game_version']=config['original']['game_version']
        with self.assertRaisesRegex(ValueError,'baseline_not_mod_quality'):validate(config)
    def test_identical_changed_predicates_rejected(self):
        config=spec();config['checks'][-1]['expectations']['candidate']=copy.deepcopy(config['checks'][-1]['expectations']['original'])
        with self.assertRaisesRegex(ValueError,'distinct_source_expectations'):validate(config)
    def test_absent_reachability_is_unknown_not_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();result=evaluate(config,self.evidence(Path(temp),config,(0,2)))
            self.assertEqual(result['status'],'unknown')
    def test_observed_invariant_violation_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();result=evaluate(config,self.evidence(Path(temp),config,(-1,10)))
            self.assertEqual(result['status'],'failed')
    def test_native_snapshot_not_equated_with_ordinary_save(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();config['candidate']['startpoint']['kind']='native_checkpoint'
            result=evaluate(config,self.evidence(Path(temp),config))
            self.assertFalse(result['boundary_comparable']);self.assertEqual(result['status'],'unknown')
    def test_missing_changed_behavior_expectation_rejected(self):
        config=spec();config['checks'][-1]['expectations'].pop('original')
        with self.assertRaisesRegex(ValueError,'original_and_candidate'):validate(config)
    def test_independently_hashed_unrelated_event_stream_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();runs=self.evidence(Path(temp),config)
            runs['candidate']['events']=runs['original']['events']
            with self.assertRaisesRegex(ValueError,'unbound_events'):evaluate(config,runs)
    def test_legacy_report_without_event_binding_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();runs=self.evidence(Path(temp),config)
            report=Path(runs['original']['report']['path']);data=json.loads(report.read_text());data.pop('events_sha256');report.write_text(json.dumps(data));runs['original']['report']=pin(report)
            with self.assertRaisesRegex(ValueError,'unbound_events'):evaluate(config,runs)
    def test_run_identity_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            config=spec();runs=self.evidence(Path(temp),config);config['candidate']['game_version']='different'
            with self.assertRaisesRegex(ValueError,'version_mismatch'):evaluate(config,runs)


if __name__ == '__main__':unittest.main()
