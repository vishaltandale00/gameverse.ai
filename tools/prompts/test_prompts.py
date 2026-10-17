import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.prompts import load, render, provenance
from tools.playtester.models import ChatPolicy, DecisionPolicy

class PromptPinsTest(unittest.TestCase):
    def test_frozen_lock_takes_precedence_and_rejects_tamper(self):
        frozen=load()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'prompt-lock.json').write_text(json.dumps(frozen))
            self.assertEqual(load(root),frozen) # no registry exists in the frozen workspace
            frozen['prompts'][0]['content']+=' '
            (root/'prompt-lock.json').write_text(json.dumps(frozen))
            with self.assertRaisesRegex(ValueError,'prompt_identity_mismatch'):load(root)

    def test_model_call_retains_exact_text_and_policy_is_frozen(self):
        first=load(); second=copy.deepcopy(first)
        observed=[]
        def transport(endpoint,key,payload,timeout):
            observed.append(payload)
            return {'choices':[{'message':{'content':'{"action_id":"walk","reason":"probe"}'}}]}
        context={'run_id':'test','game_id':'game','objective':'explore','memory':{},'observation':{'facts':{},'progress':{},'frame':1}}
        options=[{'id':'walk','description':'walk'}]
        with patch('tools.playtester.models.load_prompts',return_value=first):
            policy=ChatPolicy(base_url='http://localhost',model='offline',api_key='fake',transport=transport)
        with patch('tools.playtester.models.load_prompts',side_effect=AssertionError('must not reload active registry')):
            result=policy.choose(context,options,.1)
        self.assertTrue(result['accepted'])
        snapshot=result['record']['resolved_prompt_snapshot']
        self.assertEqual(snapshot['system'],observed[0]['messages'][0]['content'])
        self.assertEqual(snapshot['user_text'],observed[0]['messages'][1]['content'][0]['text'])
        self.assertEqual(result['record']['prompts'],provenance(first))
        self.assertNotIn('fake',json.dumps(result['record']))

if __name__=='__main__':unittest.main()
