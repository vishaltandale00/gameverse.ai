"""Bounded authenticated resource-linker checks; no native execution."""
import copy,hashlib,json,time
from inline import inline_dependencies,imported_resources,merge_resources
from contract import validate


def run():
    start=time.perf_counter();names=[]
    rom=bytearray(64);rom[:4]=bytes.fromhex('01480860');rom[8:12]=(0x08000020).to_bytes(4,'little');rom[32:36]=b'OAM!'
    proof=b'synthetic reviewed immutable OAM identity';digest=hashlib.sha256(proof).hexdigest();evidence={digest:proof}
    c={'id':'idle_oam','token':1,'native_value':0x08000020,'rom_sha256':hashlib.sha256(rom).hexdigest(),'span_size':4,'span_sha256':hashlib.sha256(rom[32:36]).hexdigest(),'literal_load_pc':0x08000000,'store_pc':0x08000002,'literal_address':0x08000008,'entry':0x08000000,'destination':0x03000000,'source_evidence':[{'role':'identity','sha256':digest}],'field':'source_oam'}
    def module():return {'schema':'gameverse.l1.behavior/0.2','id':'behavior','parameters':[],'return_type':'void','state':[],'locals':[],'assets':[],'collections':[],'body':[],'preconditions':[],'limitations':[]}
    dep=module();dep['state']=[{'name':'source_oam','storage_type':'u32','resource_reference':'idle_oam'}];dep['resource_references']=[{'id':'idle_oam','token':1}];dep['resource_fields']={'source_oam':'idle_oam'};dep['body']=[{'op':'assign_field','field':'source_oam','value':{'op':'resource_reference','type':'u32','resource':'idle_oam','token':1},'provenance':'source_store'},{'op':'return','provenance':'source_return'}]
    da={'fields':[],'collections':[],'resource_references':[c]}
    def call():return {'op':'call','dependency':0,'arguments':{},'field_bindings':{'source_oam':{'value':{'op':'field','type':'u32','name':'canonical_oam'},'pieces':[{'field':'canonical_oam','type':'u32','shift':0}]}},'provenance':'call'}
    def caller():
        b=module();b['state']=[{'name':'canonical_oam','storage_type':'u32'}];b['body']=[call()];return b
    linked,adapter=inline_dependencies(caller(),{'fields':[],'collections':[]},[(dep,da)],rom=rom,service_evidence=evidence)
    store=linked['body'][0]['body'][0];assert store['field']=='canonical_oam'and store['value']==dep['body'][0]['value']and store['provenance']=='dependency_0/source_store';assert linked['locals']==[];validate(linked);names.append('direct_resource_store_without_scalar_temporary')
    assert linked['resource_references']==dep['resource_references']and linked['resource_fields']=={'canonical_oam':'idle_oam'}and linked['state'][0]['resource_reference']=='idle_oam';assert adapter['resource_references']==[dict(c,field='canonical_oam')];names.append('canonical_field_metadata_and_source_pins_preserved')
    second=caller();second['body'].append(copy.deepcopy(call()));_,repeated=inline_dependencies(second,{'fields':[],'collections':[]},[(dep,da)],rom=rom,service_evidence=evidence);assert len(repeated['resource_references'])==1;names.append('repeated_source_identity_deduplicated')
    outer=module();outer['state']=[{'name':'outer_oam','storage_type':'u32'}];outer['body']=[{'op':'call','dependency':0,'arguments':{},'field_bindings':{'canonical_oam':{'value':{'op':'field','type':'u32','name':'outer_oam'},'pieces':[{'field':'outer_oam','type':'u32','shift':0}]}},'provenance':'outer_call'}]
    nested,na=inline_dependencies(outer,{'fields':[],'collections':[]},[(linked,adapter)],rom=rom,service_evidence=evidence);assert nested['body'][0]['body'][0]['body'][0]['field']=='outer_oam'and na['resource_references'][0]['field']=='outer_oam';names.append('nested_resource_store_canonical_remap')
    def reject(name,fn):
        try:fn()
        except(ValueError,KeyError):names.append(name);return
        raise AssertionError(name)
    def mutate_dep(key,value):
        d=copy.deepcopy(dep);d[key]=value;return imported_resources(d,da,rom,evidence)
    reject('missing_inventory',lambda:mutate_dep('resource_references',[]))
    reject('missing_fields',lambda:mutate_dep('resource_fields',{}))
    reject('token_mismatch',lambda:mutate_dep('resource_references',[{'id':'idle_oam','token':2}]))
    reject('field_mismatch',lambda:mutate_dep('resource_fields',{'different':'idle_oam'}))
    reject('state_type_mismatch',lambda:mutate_dep('state',[{'name':'source_oam','storage_type':'u16','resource_reference':'idle_oam'}]))
    reject('missing_state_marker',lambda:mutate_dep('state',[{'name':'source_oam','storage_type':'u32'}]))
    reject('forged_evidence',lambda:imported_resources(dep,da,rom,{digest:b'forged'}))
    reject('missing_evidence',lambda:imported_resources(dep,da,rom))
    reject('changed_source_rom',lambda:imported_resources(dep,da,bytes(64),evidence))
    reject('source_identity_conflict',lambda:merge_resources([c,dict(c,span_sha256='f'*64)]))
    reject('token_identity_conflict',lambda:merge_resources([c,dict(c,id='other')]))
    reject('native_identity_conflict',lambda:merge_resources([c,dict(c,id='other',token=2)]))
    def change_binding(change):
        b=caller();change(b['body'][0]['field_bindings']['source_oam']);return inline_dependencies(b,{'fields':[],'collections':[]},[(dep,da)],rom=rom,service_evidence=evidence)
    reject('split_binding',lambda:change_binding(lambda b:b.update(pieces=[{'field':'canonical_oam','type':'u16','shift':0},{'field':'other','type':'u16','shift':16}])))
    reject('shifted_binding',lambda:change_binding(lambda b:b['pieces'][0].update(shift=8)))
    reject('arithmetic_binding',lambda:change_binding(lambda b:b.update(value={'op':'const','type':'u32','value':0})))
    null_dep=copy.deepcopy(dep);null_dep['body'][0]['value']={'op':'const','type':'u32','value':0};null_result,_=inline_dependencies(caller(),{'fields':[],'collections':[]},[(null_dep,da)],rom=rom,service_evidence=evidence);assert null_result['body'][0]['body'][0]['value']=={'op':'const','type':'u32','value':0};names.append('null_store_preserved_without_scalar_temporary')
    bad=copy.deepcopy(dep['body']);bad[0]['value']={'op':'const','type':'u32','value':1};reject('scalar_store_into_resource_field',lambda:mutate_dep('body',bad))
    bad=copy.deepcopy(dep['body']);bad[0]['value']={'op':'add_wrap','type':'u32','args':[copy.deepcopy(dep['body'][0]['value']),{'op':'const','type':'u32','value':1}]};reject('resource_arithmetic',lambda:mutate_dep('body',bad))
    bad=copy.deepcopy(dep['body']);bad[-1]['value']={'op':'field','type':'u32','name':'source_oam'};reject('resource_field_scalar_read',lambda:mutate_dep('body',bad))
    from lower import lower
    reject('portable_lower_rejects_resource',lambda:lower(linked))
    from compose import Composer
    composer=object.__new__(Composer);composer.p={'terrain':[]};composer.packages={'resource':({}, {},linked)};reject('default_composer_rejects_resource',composer.generate)
    return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-start,'native_calls':0,'qualification':'synthetic structural only; no native resource interpretation or parity claim'}

if __name__=='__main__':print(json.dumps(run()))
