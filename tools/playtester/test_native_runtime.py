"""Offline causal audit and continuation integrity checks; no ROM/model calls."""
import unittest
from .aria_adapter import AriaRewardAdapter
from .core import Playtester
from .learning import capture, restore


class NativeRuntimeTests(unittest.TestCase):
    def tester(self):
        return Playtester(None,{'schema_version':1,'game_id':'synthetic','game_version':'rom'},None)

    def test_learning_roundtrip_preserves_graph_and_hypothesis(self):
        first=self.tester();first.attempts[('state','jump')]=2;first.system2_plan={'hypothesis':'old'}
        first.transitions=[{'frame_before':3,'frame_after':4}]
        retained=capture(first,{'native':'binary'})
        second=self.tester();restore(second,retained,{'native':'binary'})
        self.assertEqual(second.attempts[('state','jump')],2)
        self.assertEqual(second.transitions,first.transitions)
        self.assertEqual(second.resume_origin['parent_run_id'],first.run_id)

    def test_learning_rejects_changed_runtime_or_profile(self):
        first=self.tester();retained=capture(first,{'native':'binary'})
        with self.assertRaisesRegex(ValueError,'identity'):restore(self.tester(),retained,{'native':'other'})
        changed=self.tester();changed.profile=dict(changed.profile,objective='different')
        with self.assertRaisesRegex(ValueError,'identity'):restore(changed,retained,{'native':'binary'})

    def adapter(self):
        player=0x02001000;bone=0x02002000
        class Native:
            def _request(self,op,address,length):
                data=bytearray(length)
                if address==0x02013110:data[:4]=player.to_bytes(4,'little')
                elif address==0x02013124:data[:4]=bone.to_bytes(4,'little')
                elif address==bone:
                    data[:4]=(0x08026009).to_bytes(4,'little');data[10]=1;data[20:24]=player.to_bytes(4,'little')
                elif address==player+0x48:data[:4]=(196608).to_bytes(4,'little')
                elif address==0x0201327c:data[:2]=(68).to_bytes(2,'little')
                return {'hex':data.hex(),'frame':7}
        a=AriaRewardAdapter.__new__(AriaRewardAdapter);a.inner=Native();a.bone_seen=set();a.native_events=[]
        a.target_abs_velocity_q16=196608;a.objective_witness=None
        return a

    def test_preexisting_bone_is_seeded_without_fake_birth(self):
        a=self.adapter();a._audit_birth(80,seed=True);a._audit_birth(80)
        self.assertEqual(a.native_events,[]);self.assertIsNone(a.objective_witness)

    def test_new_bone_requires_callback_parent_and_records_actual_frame(self):
        a=self.adapter();event=a._audit_birth(80)
        self.assertEqual(event['frame'],7);self.assertEqual(event['MP_after_frame'],68)
        self.assertEqual(event['velocity_x_q16'],196608);self.assertIsNotNone(a.objective_witness)


if __name__=='__main__':unittest.main()
