"""Validate user-wired symbolic mechanic assemblies without building/running games."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import re
import time
import sys
from compose import Composer
from lower import lower
from domain import accepts

ROOT=Path(__file__).resolve().parents[2]
SCHEMA='gameverse.mechanic-assembly/0.1'
IDENT=re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}$')


def record_result_use(component, slot, config, users, writers):
    """Results are real state writes, including alias/ownership accounting."""
    bound_slots={binding['slot'] for binding in config.get('bindings',{}).values()} | set(config.get('collection_bindings',{}).values())
    if slot in bound_slots:
        raise ValueError('result cannot alias a bound source port of the same component: '+component)
    users[slot].add(component)
    writers[slot].add(component)


def validate(graph):
    started=time.perf_counter()
    result={'schema':'gameverse.mechanic-assembly-validation/0.1','validator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'python':sys.version.split()[0],'valid':False,'status':'invalid','errors':[],'warnings':[], 'interfaces':{},'conversions':[],'validation_scope':'Symbolic package identity, state ownership, ordered invocation, semantic binding and code lowering only; no native execution or full source-subsystem closure.'}
    def require(test,message):
        if not test:raise ValueError(message)
    try:
        require(isinstance(graph,dict),'assembly must be an object')
        result['request_sha256']=hashlib.sha256(json.dumps(graph,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        require(graph.get('schema')==SCHEMA,'unsupported assembly schema')
        require(not(set(graph)-{'schema','components','state','invocations','initialize','services','adapters','schedule'}),'unknown assembly field')
        components=graph.get('components');state=graph.get('state');calls=graph.get('invocations');adapters=graph.get('adapters',{})
        require(isinstance(components,dict) and 1<=len(components)<=32,'components must contain 1..32 named instances')
        require(isinstance(adapters,dict) and len(adapters)<=16,'adapters must be an object with at most 16 authored nodes')
        require(not(set(adapters)&set(components)),'adapter and component names must be distinct')
        require(all(isinstance(name,str) and IDENT.fullmatch(name) for name in adapters),'invalid authored adapter identifier')
        require(isinstance(state,dict) and len(state)<=128,'state must be an object with at most 128 slots')
        require(isinstance(calls,list) and 1<=len(calls)<=128,'invocations must contain 1..128 ordered calls')
        require(graph.get('services',[])==[],'unsupported runtime service: this validator accepts symbolic package calls only')
        catalog=json.loads((ROOT/'ontology/executable-components/index.json').read_text())
        catalog_entries={entry['id']:entry for entry in catalog['entries'] if entry.get('qualified')}
        catalog_ids=set(catalog_entries)
        plan={'components':{},'state':copy.deepcopy(state)}
        for name,slot in state.items():
            require(bool(IDENT.fullmatch(name)),'invalid state identifier: '+name)
            require(isinstance(slot,dict) and not(set(slot)-{'storage_type','semantic_type','count','owner','shared'}),'unsupported state slot field: '+name)
            require(slot.get('storage_type') in ('u8','u16','u32','u64'),'unsupported state storage type: '+name)
            require(slot.get('owner') in {'external',*components,*adapters},'state owner must name a component, authored adapter or external: '+name)
            require(isinstance(slot.get('shared',False),bool),'shared must be boolean: '+name)
            require('count' not in slot or type(slot['count']) is int and 1<=slot['count']<=4096,'invalid state count: '+name)
            sem=slot.get('semantic_type',{});unit=sem.get('unit')
            require(sem.get('quantity') not in (None,'unknown') and sem.get('frame') not in (None,'unknown'),'state requires known quantity/frame: '+name)
            require(isinstance(unit,dict) and set(unit)=={'numerator','denominator'} and all(type(v) is int and v>0 for v in unit.values()),'state requires positive rational unit: '+name)
        require(sum(s.get('count',1)*int(s['storage_type'][1:])//8 for s in state.values())<=65536,'state exceeds 64KiB resource limit')
        users={name:set() for name in state};writers={name:set() for name in state}
        for name,config in components.items():
            require(bool(IDENT.fullmatch(name)),'invalid component instance identifier: '+name)
            require(isinstance(config,dict) and not(set(config)-{'package_id','behavior_sha256','package_sha256','bindings','collection_bindings','configuration_id'}),'unsupported component field: '+name)
            package_id=config.get('package_id');require(package_id in catalog_ids,'unknown or unqualified package: '+str(package_id))
            path=ROOT/'local/ir/packages'/package_id/'package.json';manifest=json.loads(path.read_text());behavior=json.loads((path.parent/manifest['behavior']).read_text())
            require(catalog_entries[package_id]['behavior_sha256']==manifest['behavior_sha256'],'catalog identity mismatch: '+name)
            require(config.get('behavior_sha256')==manifest['behavior_sha256'],'stale package behavior identity: '+name)
            manifest_sha256=hashlib.sha256(path.read_bytes()).hexdigest()
            require(config.get('package_sha256',manifest_sha256)==manifest_sha256,'stale package semantic contract identity: '+name)
            spec={k:copy.deepcopy(v) for k,v in config.items() if k not in ('package_id','behavior_sha256','package_sha256')};spec['package']=str(path)
            fields={v['name']:v for v in behavior['state']};
            bound_targets=[b.get('slot') for b in spec.get('bindings',{}).values() if isinstance(b,dict)]+list(spec.get('collection_bindings',{}).values())
            require(len(bound_targets)==len(set(bound_targets)),'distinct source ports within one component cannot alias one slot: '+name)
            collections={v['name']:v for v in behavior.get('collections',[])}
            for field,binding in spec.get('bindings',{}).items():
                require(field in fields,'unknown source field: '+name+'.'+field)
                require(isinstance(binding,dict) and not(set(binding)-{'slot','domain','quantization'}),'unsupported field binding: '+name+'.'+field)
                target=binding.get('slot');require(target in state,'unknown bound slot: '+str(target))
                require('count' not in state[target],'scalar field cannot bind collection: '+target)
                require(manifest['field_meanings'][field]['quantity']!='unknown','private opaque field cannot be a public binding: '+name+'.'+field)
                encoding=state[target]['semantic_type'].get('signed_encoding')
                source_encoding=manifest['field_meanings'][field].get('signed_encoding')
                require(encoding==source_encoding,'signed encoding mismatch: '+name+'.'+field)
                if 'quantization' in binding:
                    q=binding['quantization'];require(isinstance(q,dict) and not(set(q)-{'rounding','shift','exactness_evidence'}) and q.get('rounding')=='arithmetic_shift' and type(q.get('shift')) is int and 0<=q['shift']<64,'unsupported quantization policy: '+name+'.'+field)
                users[target].add(name)
                if field in manifest['effects']['writes']:writers[target].add(name)
                if 'domain' in binding:
                    d=binding['domain'];require(isinstance(d,dict) and {'signed_min','signed_max'}<=set(d) and type(d['signed_min']) is int and type(d['signed_max']) is int and d['signed_min']<=d['signed_max'],'invalid binding domain: '+name+'.'+field)
                slot_meaning=state[target]['semantic_type'];field_meaning=manifest['field_meanings'][field]
                if slot_meaning['unit']!=field_meaning['unit']:
                    require(slot_meaning['quantity'] in ('position','velocity','acceleration','counter','energy'),'unit scaling is unsupported for packed/encoded or nonnumeric semantics: '+name+'.'+field)
                    a=slot_meaning['unit'];b=field_meaning['unit'];ratio_num=a['numerator']*b['denominator'];ratio_den=a['denominator']*b['numerator']
                    if (field in set(manifest['effects']['reads'])|set(manifest['effects']['writes']) and ratio_num<ratio_den) or (field in manifest['effects']['writes'] and ratio_num>ratio_den):
                        require(encoding=='twos_complement','arithmetic quantization requires explicit source twos_complement encoding: '+name+'.'+field)
                initial=graph.get('initialize',{}).get(target,0)
                width=int(state[target]['storage_type'][1:]);destination_width=int(fields[field]['storage_type'][1:])
                require(type(initial) is int and 0<=initial<(1<<width),'invalid scalar initial value: '+target)
                signed_initial=initial-(1<<width) if initial&(1<<(width-1)) else initial
                domain=binding.get('domain')
                if domain:
                    require(-(1<<(width-1))<=domain['signed_min']<=domain['signed_max']<(1<<(width-1)),'binding domain exceeds source signed storage: '+name+'.'+field)
                    require(domain['signed_min']<=signed_initial<=domain['signed_max'],'initial value contradicts claimed binding domain: '+name+'.'+field)
                if field in manifest['effects']['reads'] and width>destination_width:
                    require(domain is not None and -(1<<(destination_width-1))<=domain['signed_min']<=domain['signed_max']<(1<<(destination_width-1)),'narrowing conversion requires fitting explicit source domain: '+name+'.'+field)
                if field in manifest['effects']['writes'] and destination_width>width:
                    source_domain=fields[field].get('domain',{})
                    fits_unsigned='unsigned_min' in source_domain and 0<=source_domain['unsigned_min']<=source_domain.get('unsigned_max',1<<destination_width)<(1<<width)
                    fits_signed='signed_min' in source_domain and -(1<<(width-1))<=source_domain['signed_min']<=source_domain.get('signed_max',1<<destination_width)<(1<<(width-1))
                    require(fits_unsigned or fits_signed,'output narrowing requires qualified source field domain: '+name+'.'+field)
                require(width==destination_width,'storage width conversion is unsupported until explicit source encoding/range adapters are available: '+name+'.'+field)
            for collection,target in spec.get('collection_bindings',{}).items():
                require(collection in collections and target in state,'unknown collection binding: '+name+'.'+collection)
                users[target].add(name)
                if collection in manifest['effects'].get('collection_writes',[]):writers[target].add(name)
            plan['components'][name]=spec
            result['interfaces'][name]={'package_id':package_id,'package_sha256':manifest_sha256,'behavior_sha256':manifest['behavior_sha256'],'fields':[{**v,'meaning':manifest['field_meanings'].get(v['name']), 'reads':v['name'] in manifest['effects']['reads'],'writes':v['name'] in manifest['effects']['writes']} for v in behavior['state']], 'parameters':behavior.get('parameters',[]),'return_type':behavior.get('return_type'),'return_meaning':manifest.get('return_meaning'),'collections':[{**v,'meaning':manifest.get('collection_meanings',{}).get(v['name'])} for v in behavior.get('collections',[])], 'effects':manifest['effects'],'configurations':manifest.get('configurations',[]),'lifecycle':manifest.get('lifecycle'),'gaps':manifest.get('gaps',[])}
            private=[f for f in manifest['effects']['reads'] if f not in spec.get('bindings',{})]
            if private:result['warnings'].append(name+': unbound source state remains private with zero/default configuration: '+', '.join(private))
            lower(behavior)  # Exercise actual source-package lowering, entirely in memory.
        from assembly_adapters import prepare,check_order
        result['adapter_interfaces']=prepare(adapters,state,components,result['interfaces'],users,writers)
        normalized_calls=[];seen=set()
        for call in calls:
            if isinstance(call,dict) and 'adapter' in call:
                require(not(set(call)-{'adapter','id','phase','when','requires'}) and call['adapter'] in adapters,'unsupported or unknown authored adapter invocation')
                normalized_calls.append(dict(op='map_u16_bits',**adapters[call['adapter']]))
                continue
            require(isinstance(call,dict) and not(set(call)-{'component','arguments','result','id','phase','when','requires'}),'unsupported invocation field')
            name=call.get('component');require(name in components,'invocation refers to unknown component: '+str(name));seen.add(name)
            interface=result['interfaces'][name];arguments=call.get('arguments',{})
            require(isinstance(arguments,dict) and set(arguments)=={p['name'] for p in interface['parameters']},'invocation parameters do not match source interface: '+name)
            for parameter in interface['parameters']:
                value=arguments[parameter['name']]
                require(isinstance(value,dict) and set(value)=={'op','type','value'} and value['op']=='const' and value['type']==parameter['storage_type'] and type(value['value']) is int and 0<=value['value']<1<<int(parameter['storage_type'][1:]),'parameters require correctly typed finite constants: '+name+'.'+parameter['name'])
            if 'result' in call:
                require(interface.get('return_meaning') is not None,'source result semantic contract unavailable: '+name)
                target=call['result'];require(isinstance(target,dict) and set(target)=={'slot'} and target['slot'] in state,'unknown result slot: '+name)
                require(target['slot'] not in {slot for adapter in adapters.values() for slot in (adapter['source_slot'],adapter['target_slot'])},'result writes cannot target authored adapter source or target slots: '+name)
                require(all(state[target['slot']]['semantic_type'].get(k)==interface['return_meaning'].get(k) for k in ('quantity','unit','frame','signed_encoding')),'source result semantic mismatch: '+name)
                require(interface['return_type']!='void' and state[target['slot']]['storage_type']==interface['return_type'] and 'count' not in state[target['slot']],'result type mismatch: '+name)
                require(state[target['slot']]['owner']==name or state[target['slot']].get('shared',False),'result slot ownership mismatch: '+name)
                record_result_use(name,target['slot'],components[name],users,writers)
            normalized_calls.append(dict(op='invoke',**call))
        check_order(calls,adapters,components,result['interfaces'])
        from assembly_schedule import materialize
        normalized_calls,schedule_proof=materialize(graph,components,result['interfaces'],adapters,users,writers)
        for name,slot in state.items():
            require(len(users[name])<=1 or slot.get('shared',False),'state used by multiple components requires shared=true: '+name)
            require(not writers[name] or slot.get('shared',False) or writers[name]=={slot['owner']},'state writer does not own slot: '+name)
            require(not slot.get('shared',False) or slot['owner']=='external' or slot['owner'] in users[name],'shared slot owner must participate: '+name)
        require(seen==set(components),'every component must have an explicit invocation in the ordered graph')
        initialized=graph.get('initialize',{});require(isinstance(initialized,dict),'initialize must be an object')
        for name,value in initialized.items():
            require(name in state,'initialize refers to unknown slot: '+name)
            slot=state[name];values=value if isinstance(value,list) else [value]
            require(len(values)==slot.get('count',1) and (isinstance(value,list)==('count'in slot)) and all(type(v) is int and 0<=v<1<<int(slot['storage_type'][1:]) for v in values),'invalid typed initial state: '+name)
        # Check known initial values against qualified source field preconditions.
        for name,spec in plan['components'].items():
            manifest=json.loads(Path(spec['package']).read_text());behavior=json.loads((Path(spec['package']).parent/manifest['behavior']).read_text())
            configuration=next((c for c in manifest.get('configurations',[]) if c['id']==spec.get('configuration_id')),{}).get('fields',{})
            for field in behavior['state']:
                if not field.get('domain'):continue
                binding=spec.get('bindings',{}).get(field['name'])
                if binding:
                    target=binding['slot'];initial=initialized.get(target,0)
                    require(state[target]['storage_type']==field['storage_type'] and all(state[target]['semantic_type'].get(k)==manifest['field_meanings'][field['name']].get(k) for k in ('quantity','unit','frame')),'restricted source field needs exact storage/semantic binding: '+name+'.'+field['name'])
                else:initial=configuration.get(field['name'],0)
                require(accepts(field['domain'],initial,int(field['storage_type'][1:])),'initial state violates qualified source field domain: '+name+'.'+field['name'])
        compiler=Composer(plan,ROOT)
        generated=compiler.statements(normalized_calls)
        result['schedule']=schedule_proof
        result.update(valid=True,status='binding_valid_obligations_unproven',normalized_graph=copy.deepcopy(graph),conversions=compiler.conversions,invocation_count=compiler.invocations,ordered_components=[c['component'] for c in calls if 'component'in c],ordered_nodes=[{'kind':'authored_adapter'if 'adapter'in c else'qualified_component','id':c.get('adapter',c.get('component'))}for c in calls],adapter_invocation_count=sum('adapter'in c for c in calls),materialized_statements=normalized_calls,statement_sha256=hashlib.sha256(generated.encode()).hexdigest(),catalog_sha256=hashlib.sha256((ROOT/'ontology/executable-components/index.json').read_bytes()).hexdigest())
        for name,interface in result['interfaces'].items():result['normalized_graph']['components'][name]['package_sha256']=interface['package_sha256']
        if adapters:result['warnings'].append('Bit mappings are explicit authored control policy. Package qualification does not prove original-game button identity or native parity of the cross-game assembly; unmapped target bits are cleared.')
        result['warnings'].append('Declared domains and invocation schedule are caller assumptions; this check does not prove runtime reachability, full lifecycle closure, or native parity of the composed graph.')
    except (ValueError,KeyError,TypeError,AttributeError,StopIteration,OSError) as error:
        result['errors'].append({'code':'assembly_contract','message':str(error)})
    result['wall_s']=time.perf_counter()-started
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--request',required=True,type=Path);parser.add_argument('--out',required=True,type=Path);args=parser.parse_args()
    if args.request.stat().st_size>262144:parser.error('assembly payload exceeds 256KiB')
    try:graph=json.loads(args.request.read_text());response=validate(graph)
    except (ValueError,OSError) as error:response={'schema':'gameverse.mechanic-assembly-validation/0.1','valid':False,'errors':[{'code':'assembly_json','message':str(error)}]}
    args.out.write_text(json.dumps(response,indent=2)+'\n')
