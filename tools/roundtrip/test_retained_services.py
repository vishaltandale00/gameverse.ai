"""Focused native binding/proof-dispatch validation; no native service is mocked."""
import copy
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.behavior_ir.retained_services import module_metadata
from .retained_services import NativeServiceEmitter, load_evidence, validate_registered_proof, validate_native_cases


class RetainedBinding(unittest.TestCase):
    def inputs(self):
        rom=bytes.fromhex('7047')+bytes(62)
        source=b'reviewed source ABI/effects witness'
        sha=hashlib.sha256(source).hexdigest()
        c={'schema':'gameverse.retained-native-service/0.1','id':'sound','rom_sha256':hashlib.sha256(rom).hexdigest(),
           'entry':'08000000','mode':'thumb','span_size':2,'span_sha256':hashlib.sha256(rom[:2]).hexdigest(),
           'abi':{'standard':'AAPCS32','arguments':[{'register':'r0','type':'u16','kind':'scalar'}],
                  'return':'void','stack_arguments':0,'variadic':False,'by_reference':False},
           'effects':{'authority':'canonical_native_host','synchronization':'flush_reload_all_bound_state','dependency_closure':'OPEN',
                      'dependencies':['unknown native sound state'],'lifetime':'original native host'},
           'source_evidence':[{'role':role,'sha256':sha} for role in ('abi','effects')]}
        a={'retained_services':[c],'fields':[{'name':'entity','owner':'entity','argument':'r0','offset':4,'width':8},
                                           {'name':'policy','owner':'global','address':0x03000000,'offset':0,'width':8}],
           'collections':[{'name':'bytes','address':0x02000100,'size':1,'count':4}],
           'parameters':[],'return_type':'u32'}
        x=dict(module_metadata([c]),state=[{'name':f['name'],'storage_type':'u8'} for f in a['fields']],
               collections=[{'name':'bytes','storage_type':'u8','count':4}])
        return x,a,rom,{sha:source}

    def test_complete_canonical_sync_and_real_call_compile(self):
        x,a,rom,evidence=self.inputs();emitter=NativeServiceEmitter(x,a,rom,evidence)
        statement={'op':'retained_native_service','service':'sound','arguments':[{'op':'const','type':'u16','value':5}],'provenance':'op4'}
        code=emitter(statement,render_expr=lambda _: '5u')
        self.assertLess(code.index('ir_service_arg_0 ='),code.index('=(*s).entity'))
        self.assertLess(code.index('=(*s).entity'),code.index('(uintptr_t)UINT32_C'))
        self.assertLess(code.index('(uintptr_t)UINT32_C'),code.index('(*s).entity='))
        self.assertIn('(*s).policy=',code);self.assertIn('(*s).bytes[i]=',code)
        source=('#include <stdint.h>\ntypedef struct {uint32_t r[4];} LiftedNativeContext;\n'
                'typedef struct {uint8_t entity,policy,bytes[4];} State_wait;\n'
                'uint32_t lifted_wait(State_wait*s,const LiftedNativeContext*native_ctx){\n'+code+'return 1;}\n'+emitter.binding('wait'))
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bound.c';path.write_text(source)
            result=subprocess.run(['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fsyntax-only',str(path)],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_reject_incomplete_or_aliased_state(self):
        for mutate in [lambda x,a:a['fields'][1].update(address=0x08000000),
                       lambda x,a:a['fields'].append(dict(a['fields'][0],name='alias')),
                       lambda x,a:x['state'].pop(),
                       lambda x,a:a.update(object_references=[{'name':'unknown'}]),
                       lambda x,a:x.update(semantic_closure='closed'),
                       lambda x,a:a['fields'][0].update(offset=0xffffffff),
                       lambda x,a:a['fields'][1].update(address=0x03007df0),
                       lambda x,a:a.update(parameters=[{'register':'r3'}]),
                       lambda x,a:a['collections'][0].update(stride=2)]:
            x,a,rom,evidence=self.inputs();mutate(x,a)
            with self.assertRaises(ValueError):NativeServiceEmitter(x,a,rom,evidence)

    def test_resource_references_require_native_codec_even_after_construction(self):
        mutations=(lambda x,a:x.update(resource_references=[{'id':'tiles'}]),
                   lambda x,a:a.update(resource_references=[{'id':'tiles'}]),
                   lambda x,a:x['state'][0].update(resource_reference='tiles'),
                   lambda x,a:a['fields'][0].update(resource_reference='tiles'))
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                x,a,rom,evidence=self.inputs();mutate(x,a)
                with self.assertRaisesRegex(ValueError,'explicit native codec'):
                    NativeServiceEmitter(x,a,rom,evidence)
                x,a,rom,evidence=self.inputs()
                emitter=NativeServiceEmitter(x,a,rom,evidence)
                self.assertTrue(emitter.validate_module(x))
                mutate(x,a)
                with self.assertRaisesRegex(ValueError,'explicit native codec'):
                    emitter.validate_module(x)

    def test_native_cases_require_complete_typed_observations(self):
        cases=[]
        for auto in range(2):
            for keys in range(4):
                for playback in range(2):
                    for disabled in range(2):
                        for counter in range(2):
                            c={'test':len(cases),'auto':auto,'keys':keys,'playback':playback,'disabled':disabled,
                               'counter_before_threshold':counter,'canonical_ram_differences':0,'excluded_dead_stack_differences':0,
                               'original_observed_audio_ram_changes':1,'defined_audio_mmio_differences':0,'pass':1,'raw_ram_differences':[]}
                            for side in ('original','rebuilt'):
                                for key,value in {'r0':1,'abi_pass':1,'instructions':20,'min_sp':0x03007df0,
                                                  'playse_visits':1,'songstart_visits':1,'play_arg':5,'song_arg':5}.items():
                                    c[side+'_'+key]=value
                            cases.append(c)
        native={'outcome':'pass','vectors':64,'failures':0,'boot_frames':120,'instruction_cap_per_call':2048,
                'original_playse_visits':64,'original_songstart_visits':64,'max_original_instructions':20,
                'max_rebuilt_instructions':20,'cases':cases}
        self.assertTrue(validate_native_cases(native))
        for mutate in (lambda x:x['cases'][0].pop('original_r0'),
                       lambda x:x['cases'][0].pop('canonical_ram_differences'),
                       lambda x:x['cases'][0].update(rebuilt_min_sp=0x03007000),
                       lambda x:x['cases'][0].update(original_r0=True),
                       lambda x:x['cases'][0].update(test=1),
                       lambda x:x.update(original_playse_visits=1),
                       lambda x:x['cases'][0].update(raw_ram_differences=[{}])):
            bad=copy.deepcopy(native);mutate(bad)
            with self.assertRaises(ValueError):validate_native_cases(bad)

    def test_no_arbitrary_proof_or_fabricated_generic_receipt(self):
        with self.assertRaises(ValueError):load_evidence({'proof':'python:evil.callback','evidence':{}})
        with self.assertRaises(ValueError):validate_registered_proof({'schema':'gameverse.native-parity/1','outcome':'pass'},'/missing','/missing')


if __name__=='__main__':unittest.main()
