import importlib.util,unittest
from pathlib import Path
module=Path(__file__).resolve().parents[1]/'scripts/mashup_stagnation.py'
spec=importlib.util.spec_from_file_location('stagnation',module);policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
class Cases(unittest.TestCase):
 def make(self,positions,opened=0):
  world={'stages':[{'prefabs':[{'kind':'gate','id':3,'component':'missile','x':600}]}]}
  facts={'stage':0,'x':positions[-1],'opened':[opened],'upgrades':3,'grounded':True}
  facts['source_closed_gate']=policy.closed_gate(world,facts)
  transitions=[{'action_id':'right','frame_before':i*24,'frame_after':(i+1)*24,'before_progress':{'x':a,'stage':0,'plane':1},'after_progress':{'x':b,'stage':0,'plane':1},'from':str(i),'to':str(i+1)} for i,(a,b) in enumerate(zip(positions,positions[1:]))]
  return {'observation':{'facts':facts},'memory':{'recent_transitions':transitions}}
 def test_animation_and_subpixel_jitter_cannot_hide_blocked_movement(self):
  context=self.make([586.1,586.3,586.0,586.375]);result=policy.blocked_movement(context,'right');self.assertEqual(result['reason'],'source_closed_gate_stagnation');self.assertEqual(result['observed_frames'],72)
 def test_real_progress_is_not_rejected(self):self.assertIsNone(policy.blocked_movement(self.make([574,578,582,586]),'right'))
 def test_open_gate_is_not_a_blocker(self):self.assertIsNone(policy.blocked_movement(self.make([586,586.1,586,586.1],1<<3),'right'))
 def test_guard_does_not_select_or_reject_firing(self):self.assertIsNone(policy.blocked_movement(self.make([586,586.1,586,586.1]),'missile'))
if __name__=='__main__':unittest.main()
