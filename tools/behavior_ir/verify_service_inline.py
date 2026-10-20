"""Fast source-service inventory/linker gates; no native or model execution."""
import copy,hashlib,json,time
from inline import inline_dependencies,imported_services,merge_services
from retained_services import SCHEMA,validate_service,module_metadata
from contract import validate
from lift import Lifter,Unsupported


def run():
    started=time.perf_counter();names=[]
    rom=bytes.fromhex('70477047')+bytes(60);source=b'reviewed synthetic ABI and unknown host effects';digest=hashlib.sha256(source).hexdigest();evidence={digest:source}
    service={'schema':SCHEMA,'id':'host','rom_sha256':hashlib.sha256(rom).hexdigest(),'entry':0x08000000,'mode':'thumb','span_size':2,'span_sha256':hashlib.sha256(rom[:2]).hexdigest(),'abi':{'standard':'AAPCS32','arguments':[{'register':'r0','type':'u32','kind':'scalar'}],'return':'u32','stack_arguments':0,'variadic':False,'by_reference':False},'effects':{'authority':'canonical_native_host','synchronization':'flush_reload_all_bound_state','dependency_closure':'OPEN','dependencies':['opaque host state'],'lifetime':'original host'},'source_evidence':[{'role':role,'sha256':digest}for role in('abi','effects')]}
    c=validate_service(service,rom,evidence)
    def module():return {'schema':'gameverse.l1.behavior/0.2','id':'behavior','parameters':[],'return_type':'void','state':[],'collections':[],'assets':[],'locals':[],'body':[],'preconditions':[],'limitations':[]}
    dep=module();dep['parameters']=[{'name':'p','storage_type':'u32'}];dep['locals']=[{'name':'r','storage_type':'u32'}];dep['body']=[{'op':'retained_native_service','service':'host','arguments':[{'op':'add_wrap','type':'u32','args':[{'op':'parameter','type':'u32','name':'p'},{'op':'const','type':'u32','value':1}]}],'result':'r','provenance':'source_call'},{'op':'return','value':{'op':'local','type':'u32','name':'r'},'provenance':'ret'}];dep['return_type']='u32';dep.update(module_metadata([c]))
    da={'retained_services':[c],'collections':[],'fields':[],'parameters':[]}
    validate(dep);assert imported_services(dep,da,rom,evidence)==[c];names.append('authenticated_import')
    caller=module();caller['locals']=[{'name':'out','storage_type':'u32'}]
    call={'op':'call','dependency':0,'arguments':{'p':{'op':'const','type':'u32','value':9}},'field_bindings':{},'result':'out','provenance':'caller_call'};caller['body']=[call]
    linked,adapter=inline_dependencies(caller,{'collections':[],'fields':[]},[(dep,da)],rom=rom,service_evidence=evidence)
    statement=linked['body'][0]['body'][0];assert statement['result']=='dependency_0_r'and statement['service']=='host'and statement['provenance']=='dependency_0/source_call';assert statement['arguments'][0]['args'][0]['value']==9
    assert linked['body'][0]['body'][1]['value']['name']=='dependency_0_r';validate(linked);names.append('result_arguments_and_provenance_renamed')
    assert linked['retained_services']==dep['retained_services']and adapter['retained_services']==[c]and linked['semantic_closure']=='OPEN';names.append('inventory_and_unknown_barrier_preserved')
    direct=module();direct['locals']=[{'name':'direct','storage_type':'u32'},{'name':'out','storage_type':'u32'}];direct.update(module_metadata([c]));direct['body']=[{'op':'retained_native_service','service':'host','arguments':[{'op':'const','type':'u32','value':0}],'result':'direct','provenance':'direct_call'},copy.deepcopy(call)]
    with_direct,direct_adapter=inline_dependencies(direct,dict(da),[(dep,da),(dep,da)],rom=rom,service_evidence=evidence)
    assert len(direct_adapter['retained_services'])==1;names.append('direct_and_multiple_child_exact_deduplication')
    proof_adapter=copy.deepcopy(da);proof_adapter['retained_service_call_frames']=[{'kind':'source_thumb_scalar_word_stack_call','call':'source_call','source_inputs':['v7']}]
    proof_caller=module();proof_caller['locals']=[{'name':'out','storage_type':'u32'}];proof_caller['body']=[copy.deepcopy(call)]
    _,proof_result=inline_dependencies(proof_caller,{'collections':[],'fields':[]},[(dep,proof_adapter)],rom=rom,service_evidence=evidence)
    assert proof_result['retained_service_call_frames']==[{'kind':'source_thumb_scalar_word_stack_call','call':'source_call','source_inputs':['v7'],'provenance_namespace':'dependency_0'}];names.append('source_frame_proof_link_namespace')
    # A second generation preserves nested scopes and deduplicates common services.
    outer=module();outer['locals']=[{'name':'out','storage_type':'u32'}];outer['body']=[dict(call,arguments={})]
    linked['parameters']=[];linked['return_type']='void';outer['body'][0].pop('result')
    nested,na=inline_dependencies(outer,{'collections':[],'fields':[]},[(linked,adapter)],rom=rom,service_evidence=evidence)
    assert nested['body'][0]['body'][0]['body'][0]['result']=='dependency_0_dependency_0_r';assert len(na['retained_services'])==1;names.append('transitive_nested_service_result')
    def reject(name,fn):
        try:fn()
        except(ValueError,KeyError):names.append(name);return
        raise AssertionError(name)
    def changed(key,value,where='dep'):
        b=copy.deepcopy(dep);a=copy.deepcopy(da);(b if where=='dep'else a)[key]=value;return imported_services(b,a,rom,evidence)
    reject('missing_l1_inventory',lambda:changed('retained_services',[]))
    reject('missing_adapter_inventory',lambda:changed('retained_services',[],'adapter'))
    altered=copy.deepcopy(dep['retained_services']);altered[0]['arguments']=['u16'];reject('signature_disagreement',lambda:changed('retained_services',altered))
    reject('forged_evidence_bytes',lambda:imported_services(dep,da,rom,{digest:b'forged'}))
    reject('wrong_rom_bytes',lambda:imported_services(dep,da,b'X'+rom[1:],evidence))
    unknown=copy.deepcopy(dep['body']);unknown.insert(0,{'op':'opaque_unknown_effect'});reject('unknown_effect_statement',lambda:changed('body',unknown))
    reject('missing_source_rom',lambda:imported_services(dep,da))
    reject('closed_claim',lambda:changed('semantic_closure','closed'))
    reject('reference_stability',lambda:changed('object_references',[{}],'adapter'))
    reject('entry_read_stability',lambda:changed('readonly_entry_reads',[{}],'adapter'))
    reject('state_domain',lambda:changed('fields',[{'domain':{'unsigned_min':0}}],'adapter'))
    bad=copy.deepcopy(c);bad['effects']['lifetime']='different';reject('same_id_different_contract',lambda:merge_services([c,bad]))
    bad=copy.deepcopy(c);bad['id']='other';reject('same_entry_different_contract',lambda:merge_services([c,bad]))
    assert merge_services([c,copy.deepcopy(c)])==[c];names.append('exact_contract_deduplication')
    duplicate=copy.deepcopy(da);duplicate['retained_services']*=2;reject('duplicate_inventory',lambda:imported_services(dep,duplicate,rom,evidence))
    # Constructor must reject assumptions before any CFG specialization/proofs.
    l0={'entry':'08000004','varnodes':[{'id':'v0','space':'ram','offset':str(0x08000008)}],'blocks':[{'id':0,'successors':[],'ops':[{'id':'op0','opcode':'CALL','inputs':['v0']}]}]}
    for label,kwargs in [('state_domain',{'state_domains':{'x':{}}}),('object_contract',{'object_contract':{'x':{}}}),('readonly_entry',{'argument_contract':{'readonly_entry_reads':[{}]}}),('shared_view',{'argument_contract':{'shared_views':[{}]}}),('entity_reference',{'argument_contract':{'entity_references':[{}]}})]:
        reject('pre_specialization_'+label,lambda kwargs=kwargs:Lifter(l0,rom,callees={'08000008':(dep,da)},service_evidence=evidence,**kwargs))
    # Direct and imported services share one source identity namespace.
    other=copy.deepcopy(c);other['id']='different';reject('direct_import_identity_conflict',lambda:Lifter(l0,rom,callees={'08000008':(dep,da)},retained_services={'08000000':other},service_evidence=evidence))
    from lower import lower
    reject('default_portable_lower_fails_closed',lambda:lower(nested))
    from compose import Composer
    composer=object.__new__(Composer);composer.p={'terrain':[]};composer.packages={'service':({}, {},nested)}
    reject('default_composer_fails_closed',composer.generate)
    return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-started,'native_calls':0,'model_calls':0,'qualification':'synthetic structural only; actual source cluster and native parity not exercised'}

if __name__=='__main__':print(json.dumps(run()))
