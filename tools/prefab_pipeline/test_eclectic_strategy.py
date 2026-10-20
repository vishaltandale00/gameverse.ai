"""Cheap host semantic checks; these do not qualify native Pokemon scheduling."""
import ctypes as C
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from tools.prefab_pipeline.eclectic_strategy import ROOT, PACKAGES, generate_eclectic_source

class Racer(C.Structure):
    _fields_=[('speed_q16',C.c_uint32),('heading',C.c_uint16),('turn',C.c_uint16),('velocity_x',C.c_int16),('velocity_y',C.c_int16)]
class Hp(C.Structure):
    _fields_=[('hp',C.c_uint16),('damage',C.c_uint16),('pending_status',C.c_uint16),('lethal_latch',C.c_uint8)]

class EclecticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler=shutil.which('cc')
        if not compiler: raise unittest.SkipTest('host C compiler unavailable')
        cls.temp=tempfile.TemporaryDirectory()
        source,header,cls.metadata=generate_eclectic_source()
        cls.source=source
        path=Path(cls.temp.name)/'mechanics.c'; path.write_text(source)
        lib=Path(cls.temp.name)/'mechanics.so'
        subprocess.run([compiler,'-std=c89','-Werror=declaration-after-statement','-shared','-fPIC','-O1',str(path),'-o',str(lib)],check=True,capture_output=True)
        cls.lib=C.CDLL(str(lib))
        cls.lib.GvEclecticSkills.argtypes=[C.POINTER(C.c_uint8)];cls.lib.GvEclecticSkills.restype=C.c_uint16
        cls.lib.GvEclecticBeam.argtypes=[C.c_uint8,C.c_uint8,C.c_uint16];cls.lib.GvEclecticBeam.restype=C.c_uint32
        cls.lib.GvEclecticHp.argtypes=[C.c_uint16]*6+[C.c_uint8];cls.lib.GvEclecticHp.restype=Hp
        cls.lib.GvEclecticKartStep.argtypes=[C.POINTER(Racer),C.c_uint16,C.c_uint16,C.POINTER(C.c_int16)]
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def test_pinned_source_and_assets(self):
        self.assertEqual(len(self.metadata['sources']),6)
        self.assertEqual(self.metadata['new_persistent_bytes'],0)
        self.assertIn('gv_ir_speed_asset_0',self.source)
        self.assertNotIn('void behavior_0(',self.source)
    def test_minish_bank_exact_owned_state(self):
        bank=(C.c_uint8*64)()
        self.assertEqual(self.lib.GvEclecticSkills(bank),0)
        # Original inventory entries 72..79 encode ownership as exactly1.
        for item in range(72,80): bank[item//4] |= 1 << (2*(item%4))
        self.assertEqual(self.lib.GvEclecticSkills(bank)&255,255)
        bank[18]=255 # value3 is not owned, unlike value1.
        self.assertEqual(self.lib.GvEclecticSkills(bank)&15,0)
        for hp,maximum,skill,want in [(50,50,16,15),(49,50,16,0),(8,50,128,22),(9,50,128,0),(8,8,144,15),(0,50,0,0)]:
            self.assertEqual(self.lib.GvEclecticBeam(hp,maximum,skill),want)
    def test_ffvi_resource_bridge(self):
        apply=self.lib.GvEclecticHp
        self.assertEqual(apply(50,64,12,0,0,0,0).hp,38)
        self.assertEqual(apply(60,64,0,20,0,0,0).hp,64)
        lethal=apply(5,64,12,0,0,0x1200,0)
        self.assertEqual((lethal.hp,lethal.pending_status,lethal.lethal_latch),(0,0x1280,0))
        protected=apply(5,64,12,0,2,0x1200,0)
        self.assertEqual(protected.pending_status,0x1200)
        excluded=apply(50,64,12,0,0,0,1)
        self.assertEqual((excluded.hp,excluded.damage),(50,0))
        self.assertEqual(apply(50,64,65535,65535,0,0,0).hp,50)
        self.assertEqual(apply(64,64,65535,1,0,0,0).hp,64)
        self.assertEqual(apply(50,64,65535,1,0,0,0).hp,51)
    def test_all_retained_ffvi_independent_fixtures(self):
        package=ROOT/'local/ir/packages/ffvi.combat.hp_effect_actor0'
        ir=json.loads((package/'l1.json').read_text())
        fields=[(f['name'],{'u8':C.c_uint8,'u16':C.c_uint16,'u32':C.c_uint32}[f['storage_type']]) for f in ir['state']]
        State=type('State',(C.Structure,),{'_fields_':fields})
        fn=self.lib.gv_ir_hp_behavior_0;fn.argtypes=[C.POINTER(State)];fn.restype=None
        fixtures=json.loads((package/'fixtures.json').read_text())
        self.assertEqual(len(fixtures['states']),len(fixtures['expected_field_subsets']))
        for row,expected in zip(fixtures['states'],fixtures['expected_field_subsets']):
            state=State(**row);fn(C.byref(state))
            for key,value in expected.items(): self.assertEqual(getattr(state,key),value,(key,row))
    def test_kart_accumulates_releases_and_clamps(self):
        bands=(C.c_int16*16)(*([192]*16))
        racer=Racer()
        for _ in range(10):self.lib.GvEclecticKartStep(C.byref(racer),0x100,0,bands)
        self.assertGreater(racer.turn,0);self.assertGreater(racer.speed_q16,0)
        before=racer.turn
        self.lib.GvEclecticKartStep(C.byref(racer),0,0,bands)
        self.assertLess(racer.turn,before)
        racer.speed_q16=0x7e00000
        self.lib.GvEclecticKartStep(C.byref(racer),0,0,bands)
        self.assertEqual(racer.speed_q16,0x7e00000)
    def test_kart_packed_carry_signed_braking_and_flag(self):
        accelerate=(C.c_int16*16)(*([128]*16))
        brake=(C.c_int16*16)(*([-512]*16))
        racer=Racer(speed_q16=0xffff)
        self.lib.GvEclecticKartStep(C.byref(racer),0,0,accelerate)
        self.assertEqual(racer.speed_q16,0x17fff) # low-half carry preserved
        self.lib.GvEclecticKartStep(C.byref(racer),0,0,accelerate)
        self.assertEqual(racer.speed_q16,0x1ffff)
        racer.speed_q16=0x30000
        self.lib.GvEclecticKartStep(C.byref(racer),0x100,0,brake)
        self.assertEqual(racer.speed_q16,0x10000)
        self.lib.GvEclecticKartStep(C.byref(racer),0,0,brake)
        self.assertEqual(C.c_int32(racer.speed_q16).value,-0x10000)
        # Original source has no lower clamp; consumer must treat speed signed.
        racer.speed_q16=0x10000
        self.lib.GvEclecticKartStep(C.byref(racer),0,1,brake)
        self.assertEqual(racer.speed_q16,0x1c000) # flag1 forces +0.75, not brake
    def test_kart_steering_does_not_imply_forward_drag(self):
        accelerate=(C.c_int16*16)(*([128]*16))
        straight=Racer(speed_q16=0x20000)
        corner=Racer(speed_q16=0x20000)
        self.lib.GvEclecticKartStep(C.byref(straight),0,0,accelerate)
        self.lib.GvEclecticKartStep(C.byref(corner),0x100,0,accelerate)
        self.assertEqual(straight.speed_q16,corner.speed_q16)
        self.assertNotEqual(straight.turn,corner.turn)
        self.assertNotEqual(straight.heading,corner.heading)

    def test_native_integer_header(self):
        source,header,_=generate_eclectic_source(native_types=True)
        self.assertNotIn('#include <stdint.h>',source)
        self.assertNotIn('#include <stdint.h>',header)
        self.assertNotIn('typedef u8 uint8_t',source)
        self.assertNotIn('typedef u64 uint64_t',source)
        self.assertIn('UINT64_C(0x80000000)',source)
        self.assertIn('#define UINT64_C(value) value##ULL',source)
        folder=Path(self.temp.name)
        (folder/'global.h').write_text('#include <stdint.h>\n#undef UINT64_C\n#undef UINT64_MAX\n')
        path=folder/'native.c';path.write_text(source)
        subprocess.run([shutil.which('cc'),'-std=c89','-Werror=declaration-after-statement','-Werror=implicit-function-declaration','-I'+str(folder),'-c',str(path),'-o',str(folder/'native.o')],check=True,capture_output=True)

    def test_stale_package_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);ident,_=PACKAGES['steering'];p=root/'local/ir/packages'/ident
            p.mkdir(parents=True);(p/'package.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'pinned eclectic package changed'):generate_eclectic_source(root)

if __name__=='__main__': unittest.main()
