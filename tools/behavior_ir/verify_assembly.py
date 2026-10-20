"""Small contract checks; no build, native execution, or generated game."""
import copy
import json
import time
import platform
import subprocess
import sys
import hashlib
from pathlib import Path
from assembly import SCHEMA, ROOT, validate, record_result_use

def pin(graph):
    for component in graph['components'].values():
        component['behavior_sha256']=json.loads((ROOT/'local/ir/packages'/component['package_id']/'package.json').read_text())['behavior_sha256']
    return graph


def example():
    meaning={'quantity':'packed_countdown','unit':{'numerator':1,'denominator':1},'frame':'mzm.enemy.reaction_invocation_and_contact_marker'}
    return {'schema':SCHEMA,'components':{name:{'package_id':'mzm.combat.minimum_reaction'+str(n),'bindings':{'field_0':{'slot':'reaction'}}} for name,n in [('minimum2',2),('minimum3',3)]},'state':{'reaction':{'storage_type':'u8','semantic_type':meaning,'owner':'minimum2','shared':True}},'initialize':{'reaction':0},'invocations':[{'component':'minimum2','arguments':{}},{'component':'minimum3','arguments':{}}],'services':[]}


def run():
    started=time.perf_counter();checks=[]
    def check(name,graph,valid,fragment=None):
        result=validate(graph);assert result['valid']==valid,(name,result)
        if fragment:assert fragment in str(result['errors']),(name,result)
        checks.append({'name':name,'outcome':'pass','validation_wall_s':result['wall_s']})
        return result
    result_users={'answer':{'consumer'}};result_writers={'answer':set()}
    record_result_use('producer','answer',{},result_users,result_writers)
    assert result_users['answer']=={'producer','consumer'} and result_writers['answer']=={'producer'}
    checks.append({'name':'result producer participates in shared-slot ownership accounting','outcome':'pass'})
    for label,config in [('field',{'bindings':{'field_0':{'slot':'answer'}}}),('collection',{'collection_bindings':{'collection_0':'answer'}})]:
        try:record_result_use('producer','answer',config,{'answer':set()},{'answer':set()})
        except ValueError as error:assert 'result cannot alias' in str(error)
        else:raise AssertionError('result/source '+label+' alias accepted')
        checks.append({'name':'result cannot alias same-instance '+label+' copyout','outcome':'pass'})
    graph=pin(example());result=check('new packages actually lowered and invoked in explicit order',graph,True)
    assert result['ordered_components']==['minimum2','minimum3'] and result['invocation_count']==2
    assert {x['package_id'] for x in result['interfaces'].values()}=={'mzm.combat.minimum_reaction2','mzm.combat.minimum_reaction3'}
    reversed_graph=copy.deepcopy(graph);reversed_graph['invocations'].reverse();rev=check('order is editable and affects emitted statement identity',reversed_graph,True)
    assert rev['statement_sha256']!=result['statement_sha256']
    mutations=[('wrong semantic frame',lambda g:g['state']['reaction']['semantic_type'].update(frame='world'),'quantity/frame'),('implicit shared alias rejected',lambda g:g['state']['reaction'].update(shared=False),'shared=true'),('unknown owner rejected',lambda g:g['state']['reaction'].update(owner='missing'),'state owner'),('stale behavior rejected',lambda g:g['components']['minimum2'].update(behavior_sha256='0'*64),'stale package'),('arbitrary path rejected',lambda g:g['components']['minimum2'].update(package='/tmp/behavior.json'),'unsupported component'),('unknown source field rejected',lambda g:g['components']['minimum2'].update(bindings={'field_999':{'slot':'reaction'}}),'unknown source field'),('missing invocation rejected',lambda g:g['invocations'].pop(),'every component'),('unsupported service rejected',lambda g:g.update(services=['native_terrain']),'unsupported runtime service'),('expression parameters rejected',lambda g:g['invocations'][0].update(arguments={'bad':{'op':'raw','code':'evil'}}),'parameters do not match'),('wrong collection scalar rejected',lambda g:g['state']['reaction'].update(count=3),'scalar field cannot bind')]
    for name,change,fragment in mutations:
        g=copy.deepcopy(graph);change(g);check(name,g,False,fragment)
    stale_contract=copy.deepcopy(graph);stale_contract['components']['minimum2']['package_sha256']='0'*64;check('stale semantic package contract hash rejects',stale_contract,False,'stale package semantic contract identity')
    missing=copy.deepcopy(graph);del missing['components']['minimum2']['behavior_sha256'];check('explicit package hash required',missing,False,'stale package')
    alias=copy.deepcopy(graph);alias['components']['minimum2']['bindings']['field_1']={'slot':'reaction'};check('intra-node aliases reject',alias,False,'cannot alias')
    narrow=copy.deepcopy(graph);narrow['state']['reaction']['storage_type']='u32';check('implicit narrowing reject',narrow,False,'narrowing conversion')
    narrow['components']['minimum2']['bindings']['field_0']['quantization']={'rounding':'arithmetic_shift','shift':0};check('inert quantization cannot bypass narrowing guard',narrow,False,'narrowing conversion')
    contradiction=copy.deepcopy(graph);contradiction['initialize']['reaction']=7;contradiction['components']['minimum2']['bindings']['field_0']['domain']={'signed_min':0,'signed_max':3};check('known initial domain contradiction rejects',contradiction,False,'contradicts claimed binding domain')
    packed_scale=copy.deepcopy(graph);packed_scale['state']['reaction']['semantic_type']['unit']['numerator']=2;check('encoded packed timer cannot be numerically scaled',packed_scale,False,'unit scaling is unsupported')
    output_narrow=copy.deepcopy(graph);output_narrow['components']={'impact':{'package_id':'mzm.combat.impact','bindings':{'field_0':{'slot':'hp'}}}};pin(output_narrow)
    output_narrow['state']={'hp':{'storage_type':'u8','owner':'impact','semantic_type':{'quantity':'energy','unit':{'numerator':1,'denominator':1},'frame':'enemy'}}};output_narrow['initialize']={'hp':10};output_narrow['invocations']=[{'component':'impact','arguments':{'param_0':{'op':'const','type':'u16','value':2}}}]
    check('output narrowing without qualified source range rejects',output_narrow,False,'output narrowing requires qualified source field domain')
    result_graph=pin({'schema':SCHEMA,'components':{'query':{'package_id':'crash.progress.query_flag5','bindings':{}}},'state':{'answer':{'storage_type':'u32','owner':'query','semantic_type':{'quantity':'position','unit':{'numerator':1,'denominator':1},'frame':'world'}}},'invocations':[{'component':'query','arguments':{},'result':{'slot':'answer'}}]})
    check('unsourced scalar result cannot become position',result_graph,False,'source result semantic contract unavailable')
    restricted=pin({'schema':SCHEMA,'components':{'terrain':{'package_id':'ffta.terrain.cell_flags_stride16','bindings':{}}},'state':{},'invocations':[{'component':'terrain','arguments':{}}]})
    # Domain rejection is exercised independently of the function's exact parameters.
    interface=json.loads((ROOT/'local/ir/packages/ffta.terrain.cell_flags_stride16/package.json').read_text());behavior=json.loads((ROOT/'local/ir/packages/ffta.terrain.cell_flags_stride16'/interface['behavior']).read_text())
    restricted['invocations'][0]['arguments']={p['name']:{'op':'const','type':p['storage_type'],'value':p.get('domain',{}).get('unsigned_min',0)} for p in behavior.get('parameters',[])}
    check('known private default violates source field domain',restricted,False,'initial state violates qualified source field domain')
    mirror_id='kirby-amazing-mirror.actor.callback_phase_reset'
    mirror_manifest=json.loads((ROOT/'local/ir/packages'/mirror_id/'package.json').read_text())
    mirror_behavior=json.loads((ROOT/'local/ir/packages'/mirror_id/mirror_manifest['behavior']).read_text())
    mirror=pin({'schema':SCHEMA,'components':{'phase':{'package_id':mirror_id,'bindings':{'field_3':{'slot':'phase_state'}}}},'state':{'phase_state':{'storage_type':next(f['storage_type'] for f in mirror_behavior['state'] if f['name']=='field_3'),'semantic_type':mirror_manifest['field_meanings']['field_3'],'owner':'phase'}},'initialize':{'phase_state':3},'invocations':[{'component':'phase','arguments':{p['name']:{'op':'const','type':p['storage_type'],'value':65535} for p in mirror_behavior['parameters']}}]})
    preserved=check('conditional write-only bound state enters invocation',mirror,True)
    # The statement digest covers the newly seeded field; inspect actual adapter text
    # through a one-call capture to ensure external phase is copied before source call.
    import assembly
    original=assembly.Composer.statements;capture=[]
    def capturing(self,ss,indent=' '):
        code=original(self,ss,indent);capture.append(code);return code
    assembly.Composer.statements=capturing
    try:assert validate(mirror)['valid']
    finally:assembly.Composer.statements=original
    assert 'g->phase.field_3 = g->phase_state;' in capture[-1]
    assert capture[-1].index('g->phase.field_3 = g->phase_state;')<capture[-1].index('phase_run(')
    # New Aria transaction exercises qualified domain and collection binding.
    aria={'schema':SCHEMA,'components':{'soul':{'package_id':'aria.progress.category3_acquire','collection_bindings':{'collection_0':'inventory'}}},'state':{'inventory':{'storage_type':'u8','count':4,'semantic_type':{'quantity':'packed_four_bit_inventory','unit':{'numerator':1,'denominator':1},'frame':'inventory.soul.category3'},'owner':'soul'}},'invocations':[{'component':'soul','arguments':{f'param_{i}':{'op':'const','type':'u32','value':v} for i,v in enumerate([3,0,1])}}]}
    pin(aria);check('new Aria collection transaction lowers',aria,True)
    aria['invocations'][0]['arguments']['param_1']['value']=8;check('Aria out of source index domain rejected',aria,False,'parameter domain')
    return {'schema':'gameverse.mechanic-assembly-checks/0.1','run_id':'mashup-assembly-20261016','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'environment':platform.platform(),'python':sys.version.split()[0],'validator_sha256':hashlib.sha256((ROOT/'tools/behavior_ir/assembly.py').read_bytes()).hexdigest(),'queue_s':None,'outcome':'pass','checks':checks,'wall_s':time.perf_counter()-started,'build':'not_run','native':'not_run','game_generation':'not_run'}


if __name__=='__main__':print(json.dumps(run(),indent=2))
