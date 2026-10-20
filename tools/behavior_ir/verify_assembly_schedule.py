"""Focused graph rejection and actual compiled source-path checks; no ROM work."""
import copy
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from assembly import ROOT,validate
from assembly_schedule import materialize
from compose import Composer
from lower import HELPERS,T,lower

OUT=ROOT/'research/ir-workshop/playable-mashups-20261016/schedule'
FIXTURES=ROOT/'research/ir-workshop/mashup-experiments-20261016'


def predicate(slot,typ,value=0):
    return {'op':'not_equal','type':'u8','args':[{'op':'slot','type':typ,'name':slot},{'op':'const','type':typ,'value':value}]}


def host_source(graph,result):
    plan={'components':{},'state':graph['state']}
    for name,config in graph['components'].items():
        spec={k:copy.deepcopy(v) for k,v in config.items() if k not in ('package_id','behavior_sha256','package_sha256')}
        spec['package']=str(ROOT/'local/ir/packages'/config['package_id']/'package.json');plan['components'][name]=spec
    compiler=Composer(plan,ROOT);code=HELPERS
    for name,(_,_,behavior) in compiler.packages.items():
        code+=lower(behavior)[len(HELPERS):].replace('LiftedState',name+'_State').replace('behavior_0',name+'_run')+'\n'
    code+='typedef struct {\n'
    for name,slot in graph['state'].items():code+=T[slot['storage_type']]+' '+name+('['+str(slot['count'])+']' if 'count' in slot else '')+';\n'
    for name in compiler.packages:code+=name+'_State '+name+';\n'
    code+='} Experiment;\nstatic void step(Experiment*g){\n'+compiler.statements(result['materialized_statements'])+'}\n'
    return code


def run():
    started=time.perf_counter();OUT.mkdir(parents=True,exist_ok=True);checks=[]
    def check(name,graph,expected,fragment=None):
        result=validate(graph)
        assert result['valid']==expected,(name,result['errors'])
        if fragment:assert fragment in str(result['errors']),(name,result['errors'])
        checks.append({'name':name,'outcome':'pass','validation_wall_s':result['wall_s']})
        return result
    graph=json.loads((FIXTURES/'progression/minish/graph.json').read_text())
    old=check('legacy straight-line graph remains admitted',graph,True)
    old_reordered=copy.deepcopy(graph);old_reordered['invocations'].reverse()
    check('legacy consumer-first remains binding-only admission without declared temporal obligations',old_reordered,True)
    graph['schedule']={'phases':['learn','refresh','action']};graph['state']['skills']['shared']=True
    for call,phase in zip(graph['invocations'],graph['schedule']['phases']):call.update(id=phase+'_call',phase=phase)
    guard=predicate('skills','u16');guard['args'][0]={'op':'bit_and','type':'u16','args':[guard['args'][0],{'op':'const','type':'u16','value':1}]}
    graph['invocations'][-1].update(when=guard,requires=[{'slot':'skills','producer':'refresh_call','after_writes':['inventory']}])
    result=check('declared refresh-to-action schedule accepted',graph,True)
    (OUT/'minish-conditional.assembly.json').write_text(json.dumps(graph,indent=2)+'\n')
    (OUT/'minish-conditional.validation.json').write_text(json.dumps(result,indent=2)+'\n')
    def reject(name,change,error):
        bad=copy.deepcopy(graph);change(bad);check(name,bad,False,error)
    reject('consumer-first stale cache rejected',lambda g:g['invocations'].reverse(),'must precede consumer')
    reject('consumer-first without phases still rejected',lambda g:(g.pop('schedule'),[c.pop('phase') for c in g['invocations']],g['invocations'].reverse()),'must precede consumer')
    reject('skipped refresh cannot establish permission',lambda g:g['invocations'][1].update(when=predicate('item','u16')),'may be skipped')
    reject('dependency changes invalidate cached skills',lambda g:g['invocations'].insert(2,{'component':'learn','arguments':{},'id':'revoke','phase':'refresh'}),'dependency changed')
    reject('another producer invalidates exact producer requirement',lambda g:g['invocations'].insert(2,{'component':'refresh','arguments':{},'id':'other_refresh','phase':'refresh'}),'stale or overwritten')
    reject('guard must declare producer freshness',lambda g:g['invocations'][-1].pop('requires'),'explicit freshness')
    reject('conditional guard needs shared ownership',lambda g:g['state']['skills'].update(shared=False),'shared=true')
    reject('type mismatch rejected',lambda g:g['invocations'][-1]['when']['args'][0]['args'][0].update(type='u32'),'exact storage type')
    reject('raw expression rejected',lambda g:g['invocations'][-1].update(when={'op':'raw','type':'u8','args':[],'code':'bad'}),'unsupported condition expression')
    reject('integer truthiness rejected',lambda g:g['invocations'][-1].update(when={'op':'slot','type':'u16','name':'skills'}),'boolean predicate')
    reject('nonexistent dependency rejected',lambda g:g['invocations'][-1]['requires'][0].update(after_writes=['missing']),'state slots')
    reject('unrelated dependency cannot masquerade as freshness',lambda g:g['invocations'][-1]['requires'][0].update(after_writes=['item']),'not read by producer')
    reject('producer must actually write required slot',lambda g:g['invocations'][-1]['requires'][0].update(producer='learn_call'),'does not write slot')
    reject('duplicate id rejected',lambda g:g['invocations'][1].update(id='learn_call'),'distinct identifier')
    reject('explicit null id rejected',lambda g:g['invocations'][1].update(id=None),'distinct identifier')
    reject('explicit null schedule rejected',lambda g:g.update(schedule=None),'schedule supports only phases')
    deep=predicate('item','u16')
    for _ in range(14):deep={'op':'bool_not','type':'u8','args':[deep]}
    reject('condition depth budget rejected',lambda g:g['invocations'][-1].update(when=deep),'depth 12')
    # Guard-only external state needs no fake component binding, but does count
    # as a real reader for ownership and the generator uses the actual guard.
    code=host_source(graph,result)+r'''
#include <assert.h>
#include <string.h>
int main(void){
 Experiment value={0};Experiment*g=&value;
 const uint8_t actions[]={2,9,5,7},battlers[]={3,0,2,1};
 memcpy(g->actions,actions,4);memcpy(g->battlers,battlers,4);g->item=72;g->item_state=0;
 g->skills=65535;step(g);assert(g->skills==0);assert(!memcmp(g->actions,actions,4));assert(!memcmp(g->battlers,battlers,4));
 g->item_state=1;step(g);assert(g->skills==1);assert(g->actions[0]==9&&g->actions[1]==2);assert(g->battlers[0]==0&&g->battlers[1]==3);
 g->item_state=2;step(g);assert(g->skills==0);assert(g->actions[0]==9&&g->actions[1]==2);assert(g->battlers[0]==0&&g->battlers[1]==3);
 g->item=115;g->item_state=1;step(g);assert(g->skills==512);assert(g->actions[0]==9&&g->actions[1]==2);assert(g->battlers[0]==0&&g->battlers[1]==3);
 /* No event identity claim: repeat is deliberately an observable second swap. */
 g->item=72;g->item_state=1;step(g);assert(!memcmp(g->actions,actions,4));assert(!memcmp(g->battlers,battlers,4));
 return 0;
}
'''
    source=OUT/'minish-conditional.c';source.write_text(code)
    build_start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='gv-schedule-') as tmp:
        binary=Path(tmp)/'check';compiled=subprocess.run(['cc','-std=c99','-O1',str(source),'-o',str(binary)],capture_output=True,text=True,timeout=15)
        assert not compiled.returncode,compiled.stderr
        build_s=time.perf_counter()-build_start;execute_start=time.perf_counter();ran=subprocess.run([str(binary)],capture_output=True,text=True,timeout=5);execute_s=time.perf_counter()-execute_start
        assert not ran.returncode,ran.stderr
    checks.append({'name':'actual generated conditional true/false/revocation paths preserve paired canonical state','outcome':'pass'})
    # Adapter ordering must account for the path where producer or mapper skips.
    adapter=json.loads((ROOT/'research/ir-workshop/reconstruction-interoperability-20261016/minish-input-bridge/input-to-equipped-item.assembly.json').read_text())
    input_slot=next(iter(adapter['state']));typ=adapter['state'][input_slot]['storage_type']
    for index in (0,1):
        bad=copy.deepcopy(adapter);bad['invocations'][index]['when']=predicate(input_slot,typ)
        check('conditionally skipped adapter chain node '+str(index),bad,False,'may be skipped')
    # Result writes participate in version accounting, independent of fields.
    # Aria post-count must follow acquisition and must be the latest count.
    aria=json.loads((FIXTURES/'progression/aria/graph.json').read_text());aria['state']['owned']['shared']=True
    for i,call in enumerate(aria['invocations']):call['id']='call_'+str(i)
    aria['invocations'][-1].update(when=predicate('owned','u8'),requires=[{'slot':'owned','producer':'call_3','after_writes':['souls']}])
    check('return result establishes current permission',aria,True)
    ambiguous=copy.deepcopy(aria);ambiguous['invocations'][3]['requires']=[{'slot':'souls','producer':'call_2','after_writes':['souls']}]
    check('producer read-write dependency chronology rejected',ambiguous,False,'producer also writes dependency')
    aria['invocations'][-1]['requires'][0]['producer']='call_0';check('stale invocation result rejected',aria,False,'stale or overwritten')
    # Source callback graph has explicit caller-selected death/retry phases;
    # this does not prove the source dispatcher or fixed-point reconstruction.
    callback=json.loads((ROOT/'research/ir-workshop/blueprint-completion-20261016/recovery/sma1-selected-retry.assembly.json').read_text())
    callback['schedule']={'phases':['death','retry_callback']}
    for call,phase in zip(callback['invocations'],callback['schedule']['phases']):call['phase']=phase
    check('explicit source death then selected retry callback order accepted',callback,True)
    callback['invocations'].reverse();check('reversed callback phase rejected',callback,False,'phase order')
    report={'schema':'gameverse.assembly-schedule-checks/0.1','run_id':'playable-mashups-schedule-20261016','outcome':'pass','checks':checks,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'environment':platform.platform(),'python':sys.version.split()[0],'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'queue_s':None,'build_mode':'clean_host_binary','cache':'unavailable','build_s':build_s,'simulation_s':execute_s,'wall_s':time.perf_counter()-started,'timing_scope':'build and simulation nested in total; validation timings nested in total; no game build, model evaluation or native qualification','limits':{'compile_timeout_s':15,'execution_timeout_s':5,'calls':128,'condition_nodes':64,'condition_depth':12},'artifacts':{name:hashlib.sha256((ROOT/'tools/behavior_ir'/name).read_bytes()).hexdigest() for name in ('assembly.py','assembly_schedule.py','compose.py','verify_assembly_schedule.py','mechanic-assembly-schedule.schema.json')},'generated_c_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'native_runs':0}
    (OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n');return report


if __name__=='__main__':print(json.dumps(run(),indent=2))
