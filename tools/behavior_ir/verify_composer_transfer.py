"""Focused host checks of canonical source-state transfer; no ROM/native rerun."""
import copy,hashlib,json,platform,subprocess,sys,time
from pathlib import Path
from compose import Composer
from lower import HELPERS,T,lower
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'local/ir/composer-transfer-20261016'


def package(name):return str(ROOT/'local/ir/packages'/name/'package.json')
def constant(value):return {'op':'const','type':'u32','value':value}
def emit(plan,calls,harness):
    compiler=Composer(plan,ROOT);code=HELPERS
    for name,(_,_,behavior) in compiler.packages.items():code+=lower(behavior)[len(HELPERS):].replace('LiftedState',name+'_State').replace('behavior_0',name+'_run')+'\n'
    code+='typedef struct {\n'
    for slot,spec in plan['state'].items():code+=' '+T[spec['storage_type']]+' '+slot+('['+str(spec['count'])+']' if 'count'in spec else'')+';\n'
    for name in compiler.packages:code+=' '+name+'_State '+name+';\n'
    code+='} TestState;\n'
    for name,call in calls.items():code+='void '+name+'(TestState*g){\n'+compiler.statements([dict(op='invoke',**call)])+'}\n'
    return code+'\n#include <assert.h>\n'+harness,compiler


def run(label):
    started=time.perf_counter();OUT.mkdir(parents=True,exist_ok=True);records=[]
    def check(name,plan,calls,harness):
        t=time.perf_counter();source,compiler=emit(plan,calls,harness);path=OUT/(label+'-'+name+'.c');binary=path.with_suffix('');path.write_text(source)
        build=time.perf_counter();compilation=subprocess.run(['cc','-std=c11','-O1',str(path),'-o',str(binary)],capture_output=True,text=True,timeout=15);compile_s=time.perf_counter()-build
        assert compilation.returncode==0,compilation.stderr
        execute=time.perf_counter();execution=subprocess.run([str(binary)],capture_output=True,text=True,timeout=5);execute_s=time.perf_counter()-execute
        records.append({'name':name,'outcome':'pass'if execution.returncode==0 else'failed','returncode':execution.returncode,'compile_s':compile_s,'host_check_s':execute_s,'wall_s':time.perf_counter()-t,'stderr':execution.stderr,'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'behavior_sha256':{n:m['behavior_sha256']for n,(_,m,_)in compiler.packages.items()}})
    m=json.loads(Path(package('kirby-amazing-mirror.actor.callback_phase_reset')).read_text());plan={'state':{'phase':{'storage_type':'u8','semantic_type':m['field_meanings']['field_3']}},'components':{n:{'package':package(m['id']),'bindings':{'field_3':{'slot':'phase'}}}for n in ['first','second']}}
    calls={n:{'component':instance,'arguments':{'param_0':constant(value),'param_1':constant(0x08023d69)}}for n,instance,value in [('preserve_first','first',65535),('set_first','first',1),('preserve_second','second',65535)]}
    check('conditional-phase-alias',plan,calls,'int main(void){TestState state={0},*g=&state;g->phase=5;preserve_first(g);assert(g->phase==5);set_first(g);assert(g->phase==1);g->phase=7;preserve_second(g);assert(g->phase==7);return 0;}')
    graph=json.loads((ROOT/'local/ir/mashup-coverage/grand-theft-auto/graph-request.json').read_text());plan={'state':graph['state'],'components':{n:{**{k:copy.deepcopy(v)for k,v in c.items()if k in ('bindings','collection_bindings')},'package':package(c['package_id'])}for n,c in graph['components'].items()}}
    calls={operation+str(handle):{'component':component,'arguments':{'param_0':constant(handle)}}for operation,component in [('activate','insert_head'),('deactivate','unlink')]for handle in range(1,5)}
    check('shared-list-non-head-preserve',plan,calls,'int main(void){TestState state={0},*g=&state;activate1(g);assert(g->head==1);activate2(g);assert(g->head==2&&g->older[1]==1&&g->newer[0]==2);deactivate1(g);assert(g->head==2&&g->older[1]==0&&g->newer[0]==2);activate1(g);assert(g->head==1&&g->older[0]==2&&g->newer[1]==1);deactivate2(g);assert(g->head==1&&g->older[0]==0&&g->newer[1]==1);deactivate1(g);assert(g->head==0);activate4(g);assert(g->head==4);return 0;}')
    report={'schema':'gameverse.composer-transfer-checks/0.1','run_id':'composer-transfer-20261016','label':label,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'environment':platform.platform(),'python':sys.version.split()[0],'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'composer_sha256':hashlib.sha256((ROOT/'tools/behavior_ir/compose.py').read_bytes()).hexdigest(),'outcome':'pass'if all(c['outcome']=='pass'for c in records)else'failed','checks':records,'wall_s':time.perf_counter()-started,'queue_s':None,'native_runs':0,'game_or_rom_builds':0}
    (OUT/(label+'.json')).write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':print(json.dumps(run(sys.argv[1]if len(sys.argv)>1 else'canonical'),indent=2))
