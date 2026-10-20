"""Full-domain pure return bounds and ABI/unknown-path rejection; no native run."""
import copy
import json
from pathlib import Path
import time
from callee_ranges import derive,result_interval,parameter_abi_matches


def run():
    started=time.perf_counter();root=Path(__file__).resolve().parents[2]
    actual=json.loads((root/'local/ir/fleet-next/pokemon-emerald-version/automatic-lift-1/080d745c/l1.json').read_text());names=[]
    proof=derive(actual);assert(proof['unsigned_min'],proof['unsigned_max'])==(0,376);names.append('actual_full_u16_source_clamp')
    def clamp(limit):
        body=copy.deepcopy(actual)
        def change(value):
            if isinstance(value,list):
                for child in value:change(child)
            elif isinstance(value,dict):
                for key in('type','storage_type'):
                    if value.get(key)=='u16':value[key]='u8'
                if value.get('op')=='const'and value['value']==376:value['value']=limit
                for child in value.values():change(child)
        change(body);body['return_type']='u8';return body
    for limit in(0,1,127,254,255):
        body=clamp(limit);p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,limit);names.append('strict_clamp_'+str(limit))
        body['body'][0]['condition']['op']='less_equal_unsigned';p=derive(body)
        assert(p['unsigned_min'],p['unsigned_max'])==(0,max(0,limit-1));names.append('inclusive_guard_'+str(limit))
    for op in('equal','not_equal'):
        body=clamp(127);branch=body['body'][0];branch['condition']['op']=op
        if op=='equal':branch['then'],branch['else']=branch['else'],branch['then']
        p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,127);names.append('singleton_guard_'+op)
    body=clamp(127);branch=body['body'][0];branch['condition']['args'].reverse();branch['then'],branch['else']=branch['else'],branch['then']
    p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,126);names.append('reversed_unsigned_guard')
    body=clamp(127);body['body'][0]['else']=[];assert derive(body)is None;names.append('uninitialized_return_rejected')
    body=clamp(127);body['body'].pop();assert derive(body)is None;names.append('fallthrough_rejected')
    body=clamp(127);body['retained_services']=[{'id':'opaque'}];assert derive(body)is None;names.append('retained_service_barrier')
    body=clamp(127);body['state']=[{'name':'x','storage_type':'u8'}];assert derive(body)is None;names.append('stateful_callee_rejected')
    body=clamp(255);body['parameters'][0]['domain']={'unsigned_min':0,'unsigned_max':3};p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,255);names.append('l1_domain_cannot_narrow_full_storage_theorem')
    body=clamp(127);body['body']=[{'op':'return','value':{'op':'const','type':'u16','value':256}}];assert derive(body)is None;names.append('return_expression_width_mismatch_rejected')
    body=clamp(127);body['body']=[{'op':'if','condition':{'op':'equal','type':'u8','args':[{'op':'bit_and','type':'u8','args':[{'op':'const','type':'u16','value':256}]*2},{'op':'const','type':'u8','value':0}]},'then':[{'op':'return','value':{'op':'const','type':'u8','value':1}}],'else':[{'op':'return','value':{'op':'const','type':'u8','value':0}}]}];p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(1,1);names.append('singleton_and_casts_to_output_width')
    body=clamp(127);body['body']=[{'op':'return','value':{'op':'extract','type':'u8','args':[{'op':'const','type':'u64','value':1},{'op':'const','type':'u64','value':4294967296}]}}];p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,255);names.append('oversized_c_unsigned_shift_not_narrowed')
    abi={'parameters':[{'name':'param_0','type':'u16','register':'r0','domain':{}}]};assert parameter_abi_matches(actual,abi);names.append('matching_parameter_abi')
    bad=copy.deepcopy(abi);bad['parameters'][0]['type']='u32';assert not parameter_abi_matches(actual,bad);names.append('mismatched_parameter_width_rejected')
    bad=copy.deepcopy(abi);bad['parameters'][0]['name']='other';assert not parameter_abi_matches(actual,bad);names.append('mismatched_parameter_identity_rejected')
    bad=copy.deepcopy(abi);bad['parameters'][0]['register']='stack';assert not parameter_abi_matches(actual,bad);names.append('unknown_parameter_slot_rejected')
    body=clamp(127);body['body']=[{'op':'return','value':{'op':'add_wrap','type':'u8','args':[{'op':'parameter','name':'param_0','type':'u8'},{'op':'const','type':'u8','value':1}]}}]
    p=derive(body);assert(p['unsigned_min'],p['unsigned_max'])==(0,255);names.append('wrap_does_not_narrow')
    assert derive(actual,max_work=1)is None;names.append('work_cap_rejects')
    assert derive(actual,max_states=1)is None;names.append('path_cap_rejects')
    assert derive(actual,max_work=1025)is None;names.append('no_budget_raise')
    assert result_interval(proof,{},'u32')is None;names.append('unsigned_extension_needs_evidence')
    assert result_interval(proof,{'return_abi':{'unsigned_extension':'u32'}},'u32')is None;names.append('unsigned_extension_without_pin_rejected')
    assert result_interval(proof,{'return_abi':{'unsigned_extension':'u32','evidence':['synthetic ABI witness']}},'u32')==(0,376);names.append('explicit_extension_accepted')
    assert result_interval(proof,{},'u8')==(0,255);names.append('truncation_crossing_wrap_full_range')
    print(json.dumps({'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-started,'native_calls':0}))


if __name__=='__main__':run()
