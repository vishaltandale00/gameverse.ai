"""Narrow recipe rejection tests; native consumer proof is a separate gate."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from .behavior_adapter import Generator, cell, read_pin, canonical, capture_request


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.evidence=self.pin('source.txt',b'source identity and bounded lifecycle authority')
        self.ir={'schema':'gameverse.l1.behavior/0.2','parameters':[],'return_type':'void','collections':[],
                 'state':[{'name':'field_0','storage_type':'u16'}],'locals':[],'assets':[],
                 'body':[{'op':'return'}]}
        self.adapter={'fields':[{'name':'field_0','owner':'global','width':16}]}
        self.recipe={'schema':'gameverse.behavior-adapter-recipe/1','source_evidence':[self.evidence],
                     'phase':'exclusive native script poll','state_lifecycle':dict.fromkeys(('ownership','lifetime','reset','reentry','restore','save_effects'),'explicit source declaration'),
                     'services':{},'service_mappings':{},'installation':{},'modules':[{'label':'dispatcher','ir':self.pin('l1.json',json.dumps(self.ir).encode()),'adapter':self.pin('adapter.json',json.dumps(self.adapter).encode()),'bindings':{'field_0':{'load':{'op':'ram','cell':{'address':0x03000f00,'width':16}},'store':{'kind':'ram','cell':{'address':0x03000f00,'width':16}}}}}],
                     'callback':{'symbol':'native_callback','initialize':{'sentinel':{'address':0x03000f08,'width':8},'actions':[]},'complete':{'op':'equal','arguments':[{'op':'field','name':'field_0'},{'op':'const','value':0}]}}}
    def tearDown(self): self.tmp.cleanup()
    def pin(self,name,data):
        (self.root/name).write_bytes(data);return {'path':name,'sha256':hashlib.sha256(data).hexdigest()}
    def generator(self,recipe=None):
        return Generator(recipe or self.recipe,self.root,b'host',lambda x,**kwargs:'typedef struct {unsigned short field_0;} LiftedState;void donor_dispatcher(LiftedState*s){}\n')
    def test_complete_scalar_mapping_generates(self):
        code=self.generator().generate();self.assertIn('uint8_t native_callback(void)',code);self.assertIn('donor_dispatcher(s);',code)
    def test_bad_ram_and_layout_conversion_rejected(self):
        for c in ({'address':0x08000000,'width':16},{'address':0x03000f01,'width':16}):
            with self.assertRaises(ValueError):cell(c)
        self.recipe['modules'][0]['bindings']['field_0']['store']['cell']['width']=8
        with self.assertRaisesRegex(ValueError,'narrowing'):self.generator().generate()
    def test_missing_full_state_rejected(self):
        self.recipe['modules'][0]['bindings']={}
        with self.assertRaisesRegex(ValueError,'full donor'):self.generator().generate()
    def test_pin_tamper_and_escape_rejected(self):
        (self.root/'source.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'pin mismatch'):self.generator()
        with self.assertRaisesRegex(ValueError,'local pinned'):read_pin(self.root,{'path':'../outside','sha256':'0'*64})
    def test_unknown_expression_and_uninitialized_load_rejected(self):
        g=self.generator()
        with self.assertRaisesRegex(ValueError,'unsupported binding'):g.expression({'op':'raw_c','value':'danger()'})
        self.recipe['modules'][0]['bindings']['field_0']['load']={'op':'field','name':'field_0'}
        with self.assertRaisesRegex(ValueError,'uninitialized'):self.generator().generate()
    def test_resource_codec_requires_exact_host_resource(self):
        self.host=b'host bytes with resource span and more'
        self.ir['state'][0].update(storage_type='u32',resource_reference='idle')
        self.ir['resource_references']=[{'id':'idle','token':1}]
        native=0x08000004
        resource={'id':'idle','token':1,'native_value':native,'field':'field_0','rom_sha256':hashlib.sha256(self.host).hexdigest(),'span_size':4,'span_sha256':hashlib.sha256(self.host[4:8]).hexdigest()}
        self.adapter['fields'][0]['width']=32;self.adapter['resource_references']=[resource]
        module=self.recipe['modules'][0];module['ir']=self.pin('l1.json',json.dumps(self.ir).encode());module['adapter']=self.pin('adapter.json',json.dumps(self.adapter).encode())
        target={'address':0x03000f00,'width':32}
        module['bindings']['field_0']={'load':{'op':'ram','cell':target},'store':{'kind':'resource-ram','cell':target,'resource':'idle'}}
        g=Generator(self.recipe,self.root,self.host,lambda x,**kwargs:'typedef struct {unsigned field_0;} LiftedState;void donor_dispatcher(LiftedState*s){}\n')
        self.assertIn('adapter_resource_to_native(s->field_0',g.generate())
        resource['rom_sha256']='0'*64;module['adapter']=self.pin('adapter.json',json.dumps(self.adapter).encode())
        with self.assertRaisesRegex(ValueError,'exact pinned'):Generator(self.recipe,self.root,self.host,g.lower).generate()
        module['bindings']['field_0']['store']={'kind':'ram','cell':target}
        self.assertIn('s->field_0!=1u',Generator(self.recipe,self.root,self.host,g.lower).generate())

    def test_request_recipe_identity_and_contradictions_rejected(self):
        recipe_bytes=json.dumps(self.recipe).encode(); recipe_pin=self.pin('recipe.json',recipe_bytes)
        request={'schema':'gameverse.behavior-adapter-request/1','request_id':'fixture','classification':'unknown','contradictions':[],
                 'host':{'id':'host','meaning':'→'},'donor':{'id':'donor'},'adapter_recipe':recipe_pin,
                 'adapter_recipe_sha256':'0'*64}
        request['host_sha256']=canonical(request['host']);request['donor_sha256']=canonical(request['donor'])
        request_path=self.root/'request.json';request_path.write_text(json.dumps(request))
        with self.assertRaisesRegex(ValueError,'exact recipe'):capture_request(request_path,self.root,self.root/'failed-identity')
        request['adapter_recipe_sha256']=canonical(self.recipe);request['contradictions']=['unresolved state width']
        request_path.write_text(json.dumps(request))
        with self.assertRaisesRegex(ValueError,'contradictions'):capture_request(request_path,self.root,self.root/'failed-contradiction')

    def test_missing_lifecycle_and_service_contract_rejected(self):
        del self.recipe['state_lifecycle']['restore']
        with self.assertRaisesRegex(ValueError,'lifecycle'):self.generator()
        with self.assertRaisesRegex(ValueError,'signature'):self.generator(copy.deepcopy({**self.recipe,'state_lifecycle':dict.fromkeys(('ownership','lifetime','reset','reentry','restore','save_effects'),'explicit')})).call('unbound',[])

if __name__=='__main__':unittest.main()
