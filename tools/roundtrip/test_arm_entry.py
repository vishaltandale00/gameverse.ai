"""Narrow source/transfer/extra-preservation checks; no ROM or emulator campaign."""
import copy
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from .arm_entry import contract,veneer,binding,shim_bytes,validate_install
from .ir_provider import storage_moves

class ArmEntry(unittest.TestCase):
    def fixture(self):
        words=[0xe92d4000,0xe59f0014,0xe3a01000,0xe3a02001,0xe4c01001,0xe2522001,0x1afffffc,0xe8bd8000,0x02000100]
        source=b''.join(w.to_bytes(4,'little')for w in words)
        adapter={'entry':'08000000','parameters':[],'return_type':'void','fields':[{'name':'value','width':8,'owner':'global','address':0x02000100,'offset':0}],
                 'native_abi':{'schema':'gameverse.native-abi/0.1','mode':'arm','rom_sha256':hashlib.sha256(source).hexdigest(),
                 'registers':{'r'+str(i):i*12345 for i in range(13)},'preserve':['r'+str(i)for i in range(3,13)],
                 'clobbers':['r0','r1','r2'],'liveouts':[],'expected_exit':{},'instruction_cap':2048,'exit':{'kind':'arm_saved_lr','dispatches':['0800001c']}}}
        return adapter,source

    def test_source_kills_veneer_scratch_before_use(self):
        adapter,source=self.fixture();proof=contract(adapter,source)
        self.assertEqual(proof['source_overwrite_bytes'],12)
        self.assertEqual(proof['binding_preserves_extra_aapcs'],['r3','r12'])
        for word in (0x159f0014,0xe1a00001,0xe5900000):
            bad=bytearray(source);bad[4:8]=word.to_bytes(4,'little');a=copy.deepcopy(adapter);a['native_abi']['rom_sha256']=hashlib.sha256(bad).hexdigest()
            with self.assertRaisesRegex(ValueError,'kill incoming r0'):
                contract(a,bad)

    def test_unsupported_live_inputs_and_returns_rejected(self):
        adapter,source=self.fixture()
        for mutate in [lambda a:a.update(parameters=[{'register':'r0','type':'u32'}]),lambda a:a.update(return_type='u32'),
                       lambda a:a['fields'][0].update(owner='entity',argument='r0'),lambda a:a['native_abi'].update(mode='thumb'),
                       lambda a:a['native_abi']['preserve'].remove('r12'),lambda a:a['native_abi'].update(liveouts=[{'register':'r0','field':'value'}]),
                       lambda a:a['fields'][0].update(address=0x03007dfc),lambda a:a.update(native_sequence=[{}]),lambda a:a['fields'][0].update(domain={'unsigned_min':0,'unsigned_max':1})]:
            bad=copy.deepcopy(adapter);mutate(bad)
            with self.assertRaises(ValueError):contract(bad,source)

    def test_wide_state_requires_natural_alignment(self):
        adapter,source=self.fixture()
        for width,offset in ((16,1),(32,1),(32,2)):
            bad=copy.deepcopy(adapter);bad['fields'][0].update(width=width,offset=offset)
            with self.assertRaisesRegex(ValueError,'natural alignment'):
                contract(bad,source)
        for width in (16,32):
            good=copy.deepcopy(adapter);good['fields'][0].update(width=width)
            contract(good,source)

    def test_exact_mode_width_and_preserved_shim(self):
        adapter,source=self.fixture();rebuilt=bytearray(source+bytes(256));shim=0x08000040;body=0x08000080
        rebuilt[:12]=veneer(shim);rebuilt[64:80]=shim_bytes(shim,body)
        proof=validate_install(adapter,source,rebuilt,shim,body)
        self.assertEqual(proof['bytes'],12)
        self.assertEqual(int.from_bytes(rebuilt[8:12],'little'),shim) # even ARM target
        for at,word in ((0,0xe59f0004),(64,0xe92d4000),(72,0xe8bd4000),(76,0xe1a0f00e)):
            wrong=bytearray(rebuilt);wrong[at:at+4]=word.to_bytes(4,'little')
            with self.assertRaises(ValueError):validate_install(adapter,source,wrong,shim,body)
        for target in (0x08000041,0x08000042,0x02000040):
            with self.assertRaises(ValueError):veneer(target)

    def test_mechanical_binding_assembles_extra_saved_registers(self):
        adapter,_=self.fixture()
        source='#include <stdint.h>\ntypedef struct {uint8_t value;} State_test;\nvoid lifted_test(State_test*s);\n'+binding(adapter,'test',storage_moves)
        self.assertIn('stmdb sp!,{r2,r3,r12,lr}',source)
        self.assertIn('ldmia sp!,{r2,r3,r12,lr}',source)
        with tempfile.TemporaryDirectory()as directory:
            p=Path(directory)/'bound.c';p.write_text(source)
            result=subprocess.run(['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-marm','-ffreestanding','-c',str(p),'-o',str(p.with_suffix('.o'))],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
