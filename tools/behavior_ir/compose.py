"""Declarative L2 component graph -> generated C -> clean GBA ROM.
Composition sees only symbolic packages. Machine validation adapters are unused.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,time,platform
from lower import HELPERS,T,expr as l1_expr,lower

def bits(t):return int(t[1:])
def adapter(e,src,dst,domain=None):
    """Exact scale synthesis. Quantizing conversions require an explicit policy."""
    if all(src.get(k)==dst.get(k)for k in('storage_type','quantity','unit','frame')):return e
    if src['quantity']!=dst['quantity']or src['frame']!=dst['frame']:raise ValueError('semantic port incompatibility: quantity/frame')
    a=src['unit'];b=dst['unit'];num=a['numerator']*b['denominator'];den=a['denominator']*b['numerator']
    import math
    g=math.gcd(num,den);num//=g;den//=g
    if den!=1:raise ValueError('quantizing conversion needs explicit rounding/order contract')
    if num>1:
        if not domain:raise ValueError('expanding conversion requires an evidenced signed source domain')
        lo,hi=domain['signed_min'],domain['signed_max'];width=int(dst['storage_type'][1:])
        if lo*num<-(1<<(width-1))or hi*num>=(1<<(width-1)):raise ValueError('semantic conversion overflows declared destination domain')
    return {'op':'mul_wrap','type':dst['storage_type'],'args':[e,{'op':'const','type':dst['storage_type'],'value':num}],'derivation':{'kind':'unit_ratio','factor':num,'rounding':'none','narrowing':'destination_width_after_multiply','source_domain':domain}}

class Composer:
 def __init__(self,plan,base):
    self.p=plan;self.base=base;self.packages={};self.conversions=[];self.invocations=0
    for name,c in plan['components'].items():
        manifest_path=(base/c['package']).resolve();m=json.loads(manifest_path.read_text());p=(manifest_path.parent/m['behavior']).resolve();x=json.loads(p.read_text())
        if hashlib.sha256(p.read_bytes()).hexdigest()!=m['behavior_sha256']:raise ValueError('behavior identity mismatch')
        receipt_path=manifest_path.parent/m['qualification']['receipt'];receipt=json.loads(receipt_path.read_text())
        if m['qualification']['status']!='pass'or receipt.get('outcome')!='pass':raise ValueError('unqualified package')
        if receipt['artifacts']['l1.json']['sha256']!=m['behavior_sha256']:raise ValueError('stale qualification does not cover behavior')
        self.packages[name]=(c,m,x)
 def expr(self,e):
    op=e['op']
    if op=='slot':return 'g->'+e['name']+('['+self.expr(e['index'])+']'if'index'in e else'')
    if op=='index':return 'index_'+e['name']
    if op=='component_field':return 'g->'+e['component']+('['+self.expr(e['instance'])+']'if'instance'in e else'')+'.'+e['field']
    # Reuse exactly the L1 integer operators while substituting named ports.
    children=[]
    def substitute(x):
        if isinstance(x,list):return[substitute(y)for y in x]
        if not isinstance(x,dict):return x
        if x.get('op')in('slot','index','component_field'):
            name='ir_port_'+str(len(children));children.append((name,self.expr(x)));return{'op':'local','type':x['type'],'name':name}
        return{k:substitute(v)for k,v in x.items()}
    value=l1_expr(substitute(e))
    for name,code in reversed(children):value=value.replace(name,code)
    return value
 def target(self,s):return self.expr(dict(op='slot',type='u32',name=s['slot'],**({'index':s['index']}if'index'in s else{})))
 def statements(self,ss,indent=' '):
    out=''
    for s in ss:
        op=s['op']
        if op=='assign_slot':out+=indent+self.target(s)+' = '+self.expr(s['value'])+';\n'
        elif op=='if':out+=indent+'if ('+self.expr(s['condition'])+') {\n'+self.statements(s['then'],indent+' ')+indent+'} else {\n'+self.statements(s.get('else',[]),indent+' ')+indent+'}\n'
        elif op=='repeat':
            if not 1<=s['count']<=64:raise ValueError('loop bound exceeds runtime budget')
            out+=indent+'for (unsigned index_'+s['index']+'=0;index_'+s['index']+'<'+str(s['count'])+';index_'+s['index']+'++) {\n'+self.statements(s['body'],indent+' ')+indent+'}\n'
        elif op=='invoke':
            name=s['component'];c,m,x=self.packages[name];path='g->'+name+('['+self.expr(s['instance'])+']'if c.get('instances')else'')
            reads=set(m['effects']['reads']);writes=set(m['effects']['writes'])
            for f,b in c.get('bindings',{}).items():
                if m['field_meanings'][f]['quantity']=='unknown':raise ValueError('unannotated state cannot be promoted to a semantic port')
                if f in reads:
                    var=self.p['state'][b['slot']];src=dict(var['semantic_type'],storage_type=var['storage_type']);dst=dict(m['field_meanings'][f],storage_type=next(z['storage_type']for z in x['state']if z['name']==f));e={'op':'slot','name':b['slot'],'type':var['storage_type']}
                    if 'index'in b:e['index']=b['index']
                    converted=adapter(e,src,dst,b.get('domain'))
                    if converted!=e:self.conversions.append({'component':name,'field':f,'direction':'in','conversion':converted['derivation']})
                    out+=indent+path+'.'+f+' = '+self.expr(converted)+';\n'
            args=[self.expr(s['arguments'][p['name']])for p in x.get('parameters',[])]
            call=name+'_run(&'+path+(' ,'+','.join(args)if args else'')+')'
            out+=indent+(self.target(s['result'])+' = 'if'result'in s else'')+call+';\n'
            for f,b in c.get('bindings',{}).items():
                if f in writes:
                    var=self.p['state'][b['slot']];src=dict(m['field_meanings'][f],storage_type=next(z['storage_type']for z in x['state']if z['name']==f));dst=dict(var['semantic_type'],storage_type=var['storage_type']);e={'op':'component_field','type':src['storage_type'],'component':name,'field':f}
                    if c.get('instances'):e['instance']=s['instance']
                    converted=adapter(e,src,dst,b.get('domain'))
                    if converted!=e:self.conversions.append({'component':name,'field':f,'direction':'out','conversion':converted['derivation']})
                    out+=indent+self.target(b)+' = '+self.expr(converted)+';\n'
            self.invocations+=1
        elif op=='effect':
            allowed={'input_keys','floor_query','rect','text','clear','line','number'}
            if s['service']not in allowed:raise ValueError('unknown runtime capability')
            args=[self.expr(a)if isinstance(a,dict)else json.dumps(a)for a in s['arguments']]
            call='runtime_'+s['service']+'('+','.join(args)+')';out+=indent+(self.target(s['result'])+' = 'if'result'in s else'')+call+';\n'
        else:raise ValueError('unknown L2 statement '+op)
    return out
 def generate(self):
    c=HELPERS+'#include "runtime.h"\n'
    c+='const RuntimeRect world_terrain[]={'+','.join('{'+','.join(map(str,r))+'}'for r in self.p['terrain'])+'};\nconst unsigned world_terrain_count='+str(len(self.p['terrain']))+';\n'
    for name,(config,m,x)in self.packages.items():
        src=lower(x)[len(HELPERS):].replace('LiftedState',name+'_State').replace('behavior_0',name+'_run')
        for a in x.get('assets',[]):src=src.replace(a['name'],name+'_'+a['name'])
        c+=src+'\n'
    c+='typedef struct {\n'
    for name,v in self.p['state'].items():c+=' '+T[v['storage_type']]+' '+name+('['+str(v['count'])+']'if'count'in v else'')+';\n'
    for name,(cfg,m,x)in self.packages.items():c+=' '+name+'_State '+name+('['+str(cfg['instances'])+']'if cfg.get('instances')else'')+';\n'
    c+='} GameState;\nstatic GameState game;\nvolatile uint32_t gv_observable[32];\nvoid game_initialize(GameState*g){\n'+self.statements(self.p['initialize'])+'}\nvoid game_tick(GameState*g){\n'+self.statements(self.p['update'])+'}\nvoid game_draw(GameState*g){\n'+self.statements(self.p['render'])+'}\n'
    c+='void main(void){runtime_initialize();game_initialize(&game);for(;;){runtime_wait_frame();game_tick(&game);game_draw(&game);'
    c+=''.join('gv_observable['+str(i)+']='+self.expr(dict(op='slot',type=self.p['state'][name]['storage_type'],name=name)).replace('g->','game.')+';'for i,name in enumerate(self.p['observations']))
    c+='}}\n';return c

def _build_impl(plan_path,out):
    plan=json.loads(plan_path.read_text());out.mkdir(parents=True,exist_ok=False);start=time.perf_counter();compiler=Composer(plan,plan_path.parent);c=compiler.generate();(out/'generated.c').write_text(c)
    root=Path(__file__).resolve().parent;stages=[]
    def stage(name,cmd):
        t=time.perf_counter();p=subprocess.run(list(map(str,cmd)),capture_output=True,text=True,timeout=30);stages.append({'name':name,'wall_s':time.perf_counter()-t,'outcome':'pass'if not p.returncode else'failed','stderr':p.stderr})
        if p.returncode:raise RuntimeError(p.stderr)
    receipt={'schema':'gameverse.new-rom-build/0.1','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'environment':platform.platform(),'compiler_version':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'adapter_version':'behavior-ir-0.2','queue_s':None,'build_mode':'clean','cache':'none','parent_rom_used':False,'composition_sha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'stages':stages,'conversions':compiler.conversions,'limits':{'stage_timeout_s':30,'runtime_loop_max_iterations':64}}
    try:
        flags=['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fno-builtin','-Os','-I',root/'runtime']
        stage('compile_l1_l2',flags+['-c',out/'generated.c','-o',out/'generated.o'])
        stage('compile_runtime',flags+['-c',root/'runtime/runtime.c','-o',out/'runtime.o'])
        stage('compile_startup',['arm-none-eabi-as','-mcpu=arm7tdmi',root/'runtime/startup.s','-o',out/'startup.o'])
        stage('link_clean_rom',['arm-none-eabi-ld','-T',root/'runtime/gba.ld',out/'startup.o',out/'generated.o',out/'runtime.o','-o',out/'game.elf'])
        stage('emit',['arm-none-eabi-objcopy','-O','binary',out/'game.elf',out/'game.gba'])
        data=bytearray((out/'game.gba').read_bytes());data[0xa0:0xac]=plan['title'].encode('ascii')[:12].ljust(12,b' ');data[0xac:0xb0]=b'GVIR';data[0xb0:0xb2]=b'00';data[0xb2]=0x96;data[0xbd]=(-sum(data[0xa0:0xbd])-0x19)&255;data.extend(bytes(max(0,65536-len(data))));(out/'game.gba').write_bytes(data)
        symbols=subprocess.check_output(['arm-none-eabi-nm',str(out/'game.elf')],text=True);(out/'symbols.txt').write_text(symbols);observable=int(next(x.split()[0]for x in symbols.splitlines()if x.split()[-1]=='gv_observable'),16)
        (out/'memory-profile.json').write_text(json.dumps({'rom_sha256':hashlib.sha256(data).hexdigest(),'fields':[{'name':name,'address':hex(observable+i*4),'bytes':4,'signed':False}for i,name in enumerate(plan['observations'])]},indent=2)+'\n')
        receipt.update(outcome='pass',rom_sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),packages={k:m['behavior_sha256']for k,(cfg,m,x)in compiler.packages.items()})
    except Exception as e:receipt.update(outcome='failed',error=str(e));raise
    finally:receipt['source_artifacts']={str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}for p in[root/'compose.py',root/'lower.py',root/'runtime/runtime.c',root/'runtime/runtime.h',root/'runtime/startup.s',root/'runtime/gba.ld']};receipt['generated_c_sha256']=hashlib.sha256(c.encode()).hexdigest();receipt['wall_s']=time.perf_counter()-start;(out/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt
def build(plan_path,out):
    existed=out.exists();start=time.perf_counter()
    try:return _build_impl(plan_path,out)
    except Exception as error:
        if not existed and out.exists() and not(out/'build-receipt.json').exists():
            (out/'build-receipt.json').write_text(json.dumps({'schema':'gameverse.new-rom-build/0.1','outcome':'failed','stage':'preflight','queue_s':None,'error':str(error),'wall_s':time.perf_counter()-start,'composition_sha256':hashlib.sha256(plan_path.read_bytes()).hexdigest()},indent=2)+'\n')
        raise

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('plan',type=Path);p.add_argument('out',type=Path);a=p.parse_args();print(json.dumps(build(a.plan.resolve(),a.out.resolve()),indent=2))
