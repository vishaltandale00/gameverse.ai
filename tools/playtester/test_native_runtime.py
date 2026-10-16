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


    def test_sonic_restore_rewinds_logical_frame_but_preserves_native_counter(self):
        from tools.playtester.sonic_adapter import SonicTraversalAdapter
        from tools.re.session.bridge import NativeSession
        native=NativeSession.__new__(NativeSession)
        native.frame=40;native.native_counter=40;native.max_frames=120
        native.mailbox_profile=None;native.callback_profile=None
        commands=[];native._command=lambda command:commands.append(command) or 'state'
        native.configure_watches=lambda watches:setattr(native,'watches',watches)
        native._step=lambda mask,count:(native.native_counter+count,None)
        adapter=SonicTraversalAdapter.__new__(SonicTraversalAdapter);adapter.inner=native
        saved={'frame':10,'state_key':'saved'};watches=[{'name':'stage','address':0x0300514c,'bytes':1,'mask':255}]
        adapter.tokens={'saved':(1,10,10,saved,watches,True)}
        adapter.restore('saved')
        self.assertEqual(native.frame,10);self.assertEqual(native.native_counter,40)
        self.assertEqual(native.watches,watches)
        self.assertEqual(native.act({'keys':['RIGHT'],'frames':7},120)['frames'],7)
        self.assertEqual(native.frame,17);self.assertEqual(native.native_counter,47)

    def test_initial_save_conflict_and_bad_hash_fail_before_creating_session(self):
        from tools.re.session.bridge import NativeSession
        from tempfile import TemporaryDirectory
        from pathlib import Path
        with TemporaryDirectory() as temp:
            root=Path(temp);save=root/'input.sav';save.write_bytes(b'private synthetic battery')
            before=save.read_bytes();out=root/'session'
            with self.assertRaisesRegex(ValueError,'conflicting_initial_state_and_save'):
                NativeSession(root/'no-rom',out,root/'no-binary',initial_save=save,initial_state=root/'state')
            with self.assertRaisesRegex(ValueError,'initial_save_sha256_mismatch'):
                NativeSession(root/'no-rom',out,root/'no-binary',initial_save=save,expected_initial_save_sha256='0'*64)
            self.assertFalse(out.exists());self.assertEqual(save.read_bytes(),before)

    def test_source_watch_rejects_invalid_ram_and_mask_before_mutating(self):
        from tools.re.session.bridge import NativeSession
        native=NativeSession.__new__(NativeSession); calls=[]; native._command=lambda command:calls.append(command)
        for watch in [dict(name='io',address=0x04000000,bytes=4,mask=1),dict(name='bad',address=0x02000000,bytes=1,mask=256)]:
            with self.assertRaises(ValueError):native.configure_watches([watch])
        self.assertEqual(calls,[])
        native.configure_watches([dict(name='stage',address=0x0300514c,bytes=1,mask=255)])
        self.assertEqual(calls,['unwatch','watch 50352460 1 255'])

    def test_source_watch_stops_even_at_exact_requested_last_frame(self):
        from tools.re.session.bridge import NativeSession
        native=NativeSession.__new__(NativeSession); native.max_frames=600; native.native_counter=0; native.frame=0
        native.mailbox_profile=None; native.callback_profile=None
        native._step=lambda keys,frames:(frames,'upgrades')
        self.assertEqual(native.act({'keys':['RIGHT'],'frames':120},120),
            {'frames':120,'source_breakpoint':True,'decision_boundary':'upgrades'})

    def test_sonic_option_stops_on_source_event_and_keeps_jump_release(self):
        from tools.playtester.sonic_adapter import SonicTraversalAdapter
        class Native:
            def __init__(self):self.calls=[]
            def read_memory(self,*args):return bytes(8)
            def act(self,action,limit):
                self.calls.append(action)
                return {'frames':1 if len(self.calls)==1 else 7,'decision_boundary':None if len(self.calls)==1 else 'deaths'}
        adapter=SonicTraversalAdapter.__new__(SonicTraversalAdapter);adapter.inner=Native()
        adapter.max_option_frames=600;adapter.motion_sample_frames=120;adapter.option_source_ready=True
        receipt=adapter.act({'keys':['RIGHT','A','B'],'frames':600},600)
        self.assertEqual(receipt['frames'],8);self.assertEqual(receipt['decision_boundary'],'deaths')
        self.assertEqual(adapter.inner.calls[0]['keys'],['RIGHT','B'])
        self.assertEqual(adapter.inner.calls[1]['keys'],['RIGHT','A','B'])


if __name__=='__main__':unittest.main()
