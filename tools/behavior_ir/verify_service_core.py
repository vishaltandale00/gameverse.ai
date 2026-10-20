"""Native-only service contract/core gates; no native execution or service mock proof."""
import copy,json,time
from pathlib import Path
from contract import validate
from lower import lower

def run():
    t=time.perf_counter();root=Path(__file__).resolve().parents[2];names=[]
    l1=json.loads((root/'local/ir/shared-retained-services-20261016/static01/l1.json').read_text())
    validate(l1);names.append('actual_wait_symbolic_native_open_contract')
    def reject(name,change,lowering=False):
        b=copy.deepcopy(l1);change(b)
        try:(lower if lowering else validate)(b)
        except ValueError:names.append(name);return
        raise AssertionError(name)
    reject('generic_lower_requires_native_backend',lambda _:None,True)
    reject('missing_inventory',lambda b:b.pop('retained_services'))
    reject('portable_scope_rejected',lambda b:b.update(execution_scope='portable'))
    reject('closed_claim_rejected',lambda b:b.update(semantic_closure='closed'))
    reject('missing_unknown_effect_barrier',lambda b:b['retained_services'][0].update(memory_effects={}))
    reject('missing_full_sync',lambda b:b['retained_services'][0].update(synchronization='none'))
    reject('implementation_not_recovered',lambda b:b['retained_services'][0].update(implementation='regenerated_ir'))
    def service(value):
        if isinstance(value,list):
            for child in value:
                found=service(child)
                if found is not None:return found
        elif isinstance(value,dict):
            if value.get('op')=='retained_native_service':return value
            for child in value.values():
                found=service(child)
                if found is not None:return found
        return None
    reject('service_argument_exact_type',lambda b:service(b['body'])['arguments'][0].update(type='u32'))
    reject('unknown_service_identity',lambda b:service(b['body']).update(service='missing'))
    reject('void_service_result_not_exposed',lambda b:service(b['body']).update(result='value_0'))
    reject('source_provenance_required',lambda b:service(b['body']).pop('provenance'))
    reject('machine_address_in_l1_rejected',lambda b:service(b['body']).update(entry=0x080722e0))
    reject('duplicate_inventory_rejected',lambda b:b['retained_services'].append(copy.deepcopy(b['retained_services'][0])))
    reject('unused_inventory_rejected',lambda b:b['retained_services'].append(dict(b['retained_services'][0],id='unused')))
    try:lower(l1,native_service_emitter=lambda *_:'')
    except ValueError:names.append('unvalidated_emitter_rejected')
    else:raise AssertionError('emitter identity')
    from lift import Lifter,Unsupported
    raw=(root/'local/roms/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba').read_bytes()
    original=json.loads((root/'local/roundtrip/firered-text-wait-export-EX095/l0/08005694.json').read_text())
    contract=json.loads((root/'research/ir-workshop/roundtrip-20261016/wave2/firered-text/playse-retained-service.json').read_text())
    for label,kwargs in [('state_domain',{'state_domains':{'global:0:1':{'unsigned_min':0,'unsigned_max':0}}}),('object_contract',{'object_contract':{'x':{}}}),('readonly_entry',{'argument_contract':{'readonly_entry_reads':[{}]}}),('entity_reference',{'argument_contract':{'entity_references':[{}]}}),('shared_view',{'argument_contract':{'shared_views':[{}]}})]:
        try:Lifter(original,raw,retained_services={'080722e0':contract},**kwargs)
        except Unsupported:names.append('host_barrier_rejects_'+label)
        else:raise AssertionError(label)
    # A source service cannot use the sequential scalar oracle, even if native C exists.
    import tempfile
    from qualify import qualify
    with tempfile.TemporaryDirectory(prefix='retained-service-guard-')as folder:
        target=Path(folder);(target/'validation-adapter.json').write_text((root/'local/ir/shared-retained-services-20261016/static01/validation-adapter.json').read_text())
        result=qualify(target,root/'local/roms/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba',vectors=1)
        assert result['outcome']=='failed'and 'separate-core'in result['error']and result['stages']==[]
        names.append('sequential_generic_oracle_rejects_host_service')
    # Default portable emitter remains byte-identical for an actually frozen module.
    prior=root/'local/roundtrip/firered-rev1-ir-20261016-001/acknowledge'
    old=json.loads((prior/'l1.json').read_text());assert lower(old)==(prior/'generated.c').read_text();names.append('portable_default_c_unchanged')
    schema=json.loads((root/'tools/behavior_ir/l1.schema.json').read_text());assert any(z.get('properties',{}).get('op',{}).get('const')=='retained_native_service'for z in schema['$defs']['statement']['oneOf']);names.append('json_schema_service_form_present')
    return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-t,'native_calls':0,'json_schema_validator':'unavailable; JSON parsed and service form checked, Python contract validates actual module'}
if __name__=='__main__':print(json.dumps(run()))
