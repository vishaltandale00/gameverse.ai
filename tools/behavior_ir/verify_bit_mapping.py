"""Bounded adapter contract checks using the real qualified DB→Minish graph."""
import copy,hashlib,json,platform,sys,time
from pathlib import Path
from assembly import ROOT,validate

FIXTURE=ROOT/'research/ir-workshop/reconstruction-interoperability-20261016/minish-input-bridge/input-to-equipped-item.assembly.json'


def run():
    started=time.perf_counter();graph=json.loads(FIXTURE.read_text());checks=[]
    def check(name,value,valid,fragment=None):
        result=validate(value);assert result['valid']==valid,(name,result['errors'])
        if fragment:assert fragment in str(result['errors']),(name,result['errors'])
        checks.append({'name':name,'outcome':'pass','wall_s':result['wall_s']});return result
    result=check('actual qualified producer→authored adapter→qualified consumer materializes',graph,True)
    assert result['invocation_count']==2 and result['adapter_invocation_count']==1
    assert [s['op']for s in result['materialized_statements']]==['invoke','map_u16_bits','invoke']
    assert result['adapter_interfaces']['map_buttons']['authorship']=='authored_not_original_game_behavior'
    assert result['adapter_interfaces']['map_buttons']['target_domain']['allowed_bits']==3
    alias=copy.deepcopy(graph);del alias['adapters'];alias['invocations']=[s for s in alias['invocations']if 'component'in s];alias['components']['held_equipped_query']['bindings']['field_3']['slot']='actor_field_2';alias['state']['tmc_held']['owner']='external'
    check('implicit direct frame/quantity relabeling still rejects',alias,False,'quantity/frame')
    cases=[('bit index16',lambda g:g['adapters']['map_buttons']['mapping'][0].update(source_bit=16),'bit indices'),('duplicate target bit',lambda g:g['adapters']['map_buttons']['mapping'][1].update(target_bit=0),'duplicate source or target'),('wrong target owner',lambda g:g['state']['tmc_held'].update(owner='external'),'target state must be owned'),('stale source signature',lambda g:g['adapters']['map_buttons']['source_signature'].update(frame='invented.buttons'),'stale source semantic signature'),('width change',lambda g:g['state']['tmc_held'].update(storage_type='u32'),'narrowing conversion'),('preserve unmapped bits unsupported',lambda g:g['adapters']['map_buttons'].update(unmapped_target_bits='preserve'),'unmapped target bits'),('recovered provenance claim rejects',lambda g:g['adapters']['map_buttons']['provenance'].update(kind='recovered'),'declared authored'),('consumer before adapter',lambda g:g['invocations'].reverse(),'fresh preceding adapter'),('adapter before producer',lambda g:g['invocations'].insert(0,g['invocations'].pop(1)),'producer must run before'),('source snapshot stale after producer reruns',lambda g:g['invocations'].insert(2,copy.deepcopy(g['invocations'][0])),'fresh preceding adapter'),('missing explicit adapter call',lambda g:g['invocations'].pop(1),'fresh preceding adapter'),('adapter field injection',lambda g:g['adapters']['map_buttons'].update(code='unsafe'),'unsupported or missing adapter contract'),('source slot missing shared declaration',lambda g:g['state']['actor_field_2'].update(shared=False),'shared=true')]
    for name,change,error in cases:
        value=copy.deepcopy(graph);change(value);check(name,value,False,error)
    for endpoint in ['actor_field_2','tmc_held']:
        value=copy.deepcopy(graph);value['invocations'][-1]['result']={'slot':endpoint}
        check('result writes cannot bypass adapter endpoint ownership/freshness: '+endpoint,value,False,'result writes cannot target authored adapter')
    reverse=copy.deepcopy(graph['adapters']['map_buttons']);reverse.update(source_slot='tmc_held',target_slot='actor_field_2',source_signature=copy.deepcopy(reverse['target_signature']),target_signature=copy.deepcopy(reverse['source_signature']))
    cyclic=copy.deepcopy(graph);cyclic['adapters']['reverse']=reverse;cyclic['state']['actor_field_2']['owner']='reverse';check('adapter dependency cycle rejects',cyclic,False,'dependency cycle')
    report={'schema':'gameverse.authored-bit-mapping-checks/0.1','outcome':'pass','checks':checks,'wall_s':time.perf_counter()-started,'python':sys.version.split()[0],'environment':platform.platform(),'fixture_sha256':hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),'source_artifacts':{name:hashlib.sha256((ROOT/'tools/behavior_ir'/name).read_bytes()).hexdigest()for name in ['assembly.py','assembly_adapters.py','bit_mapping.py','compose.py']},'native_runs':0,'game_or_rom_builds':0}
    return report
if __name__=='__main__':print(json.dumps(run(),indent=2))
