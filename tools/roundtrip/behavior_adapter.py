"""Source-pinned donor L1 plus declarative host bindings -> bounded native adapter.

Game addresses and semantics live in recipes. This compiler does not certify
native play or portable host-service semantics. Captured bundles contain their
compiler, immutable inputs, opaque host and evidence for source-independent replay.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import time

SCHEMA = 'gameverse.behavior-adapter-recipe/1'
NAME = re.compile(r'[A-Za-z_][A-Za-z_0-9]*\Z')
BASE = 0x08000000
TYPES = {8:'uint8_t',16:'uint16_t',32:'uint32_t'}
MAX_ROM = 32*1024*1024


def sha(data): return hashlib.sha256(data).hexdigest()
def canonical(value): return sha(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode())
def write_json(path, value): Path(path).write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
def read_pin(root, pin):
    p = Path(pin['path']); target=(Path(root)/p).resolve()
    if p.is_absolute() or '..' in p.parts or not target.is_relative_to(Path(root).resolve()) or not target.is_file():
        raise ValueError('adapter input must be a local pinned file')
    data=target.read_bytes()
    if sha(data)!=pin['sha256']: raise ValueError('adapter input pin mismatch: '+str(p))
    return data

def symbol(value):
    if not isinstance(value,str) or not NAME.fullmatch(value): raise ValueError('unsafe adapter symbol')
    return value

def cell(value):
    if not isinstance(value,dict) or set(value)!={'address','width'}: raise ValueError('typed RAM cell required')
    a,w=value['address'],value['width']
    if type(a)is not int or w not in TYPES or a%(w//8) or not(0x02000000<=a<=0x02040000-w//8 or 0x03000000<=a<=0x03007c00-w//8):
        raise ValueError('unaligned/out-of-bounds adapter RAM cell')
    return f'(*(volatile {TYPES[w]}*)(uintptr_t)UINT32_C({a}))'


class Generator:
    def __init__(self, recipe, root, host, lower):
        if recipe.get('schema')!=SCHEMA: raise ValueError('unsupported behavioral recipe')
        self.recipe,self.root,self.host,self.lower=recipe,Path(root),host,lower
        for key in ('phase','source_evidence','state_lifecycle'):
            if not recipe.get(key): raise ValueError('missing adapter '+key)
        if not {'ownership','lifetime','reset','reentry','restore','save_effects'} <= set(recipe['state_lifecycle']):
            raise ValueError('incomplete adapter state lifecycle')
        for p in recipe['source_evidence']: read_pin(root,p)
        self.services={}
        for name,c in recipe.get('services',{}).items():
            symbol(name)
            if set(c)!={'entry','size','sha256','return','arguments','source_evidence','mode','standard'}: raise ValueError('incomplete host service ABI contract')
            if c['mode']!='thumb' or c['standard']!='AAPCS32': raise ValueError('unsupported host service ISA/ABI contract')
            a,n=c['entry'],c['size']
            if type(a)is not int or a&1 or type(n)is not int or not 2<=n<=65536 or not BASE<=a<a+n<=BASE+len(host) or sha(host[a-BASE:a-BASE+n])!=c['sha256']:
                raise ValueError('host service byte pin mismatch')
            if c['return'] not in ('void','u8','u16','u32') or not isinstance(c['arguments'],list) or len(c['arguments'])>7 or any(t not in('u8','u16','u32','rom_ptr','ram_ptr') for t in c['arguments']):
                raise ValueError('unsupported typed host service ABI')
            if not c['source_evidence']: raise ValueError('host service needs source ABI/effects evidence')
            for pin in c['source_evidence']: read_pin(root,pin)
            self.services[name]=c
        self.locals={}

    def call(self,name,args):
        c=self.services.get(name)
        if c is None or len(args)!=len(c['arguments']): raise ValueError('unresolved host service signature')
        ret='void' if c['return']=='void' else TYPES[int(c['return'][1:])]
        at=['uint32_t' if t.endswith('_ptr') else TYPES[int(t[1:])] for t in c['arguments']]
        return f'(({ret}(*)('+(','.join(at) or 'void')+f'))(uintptr_t)UINT32_C({c["entry"]|1}))('+','.join(args)+')'

    def service_expression(self,name,expressions,arguments=None):
        service=self.services.get(name)
        if service is None or len(expressions)!=len(service['arguments']): raise ValueError('unresolved host service signature')
        for typ,value in zip(service['arguments'],expressions):
            if typ.endswith('_ptr'):
                if value.get('op')!='const': raise ValueError('host pointers require pinned fixed-address references')
                address=value['value']
                if typ=='rom_ptr' and not BASE<=address<BASE+len(self.host): raise ValueError('host ROM pointer outside pinned host')
                if typ=='ram_ptr' and not(0x02000000<=address<0x02040000 or 0x03000000<=address<0x03007c00): raise ValueError('host RAM pointer outside canonical state')
            elif value.get('op')=='const' and not 0<=value['value']<1<<int(typ[1:]): raise ValueError('host scalar argument narrowing forbidden')
        return self.call(name,[self.expression(a,arguments) for a in expressions])

    def expression(self,e,arguments=None):
        if not isinstance(e,dict): raise ValueError('binding expression required')
        op=e.get('op')
        if op=='installed_object':
            label=symbol(e['label']);addend=e.get('addend',0)
            objects={o['label']:o for o in self.recipe['installation'].get('objects',[])}
            if label not in objects or type(addend)is not int or not 0<=addend<=object_size(objects[label]): raise ValueError('installed object reference outside declared object')
            return '((uint32_t)(uintptr_t)(adapter_object_'+label+'+'+str(addend)+'))'
        if op=='self_callback':
            if set(e)!={'op'}: raise ValueError('invalid self callback reference')
            return '((uint32_t)(uintptr_t)&'+symbol(self.recipe['callback']['symbol'])+')'
        if op=='const':
            if set(e)!={'op','value'} or type(e['value'])is not int or not 0<=e['value']<=0xffffffff: raise ValueError('invalid binding constant')
            return f'UINT32_C({e["value"]})'
        if op=='ram': return cell(e['cell'])
        if op=='argument':
            i=e['index']
            if type(i)is not int or arguments is None or not 0<=i<len(arguments): raise ValueError('unresolved source call argument')
            return arguments[i]
        if op=='service': return self.service_expression(e['service'],e['arguments'],arguments)
        if op in ('all','any'):
            if not 1<=len(e['arguments'])<=16: raise ValueError('bounded input predicates required')
            return '('+(' && ' if op=='all' else ' || ').join(self.expression(a,arguments) for a in e['arguments'])+')'
        if op in ('equal','not_equal','less','less_equal','bit_and','bit_or'):
            a,b=e['arguments']; sign={'equal':'==','not_equal':'!=','less':'<','less_equal':'<=','bit_and':'&','bit_or':'|'}[op]
            return '('+self.expression(a,arguments)+sign+self.expression(b,arguments)+')'
        if op=='select': return '('+self.expression(e['condition'],arguments)+'?'+self.expression(e['then'],arguments)+':'+self.expression(e['else'],arguments)+')'
        if op=='field':
            if e['name'] not in self.locals: raise ValueError('unresolved donor state field')
            return 's->'+e['name']
        raise ValueError('unsupported binding expression '+str(op))

    def actions(self,actions,arguments=None):
        out=[]
        for a in actions:
            if a['op']=='call': out.append(self.service_expression(a['service'],a['arguments'],arguments)+';')
            elif a['op']=='write': out.append(cell(a['cell'])+'='+self.expression(a['value'],arguments)+';')
            elif a['op']=='assert': out.append('if(!('+self.expression(a['condition'],arguments)+'))__builtin_trap();')
            elif a['op']=='if': out.append('if('+self.expression(a['condition'],arguments)+'){'+self.actions(a['then'],arguments)+'}else{'+self.actions(a.get('else',[]),arguments)+'}')
            else: raise ValueError('unsupported binding action')
        return '\n'.join(out)

    def sync(self):
        loads=[];stores=[]
        for name,b in self.bindings.items():
            def no_state(value):
                if isinstance(value,dict):
                    if value.get('op')=='field': raise ValueError('binding loads cannot depend on uninitialized donor state')
                    for item in value.values(): no_state(item)
                elif isinstance(value,list):
                    for item in value: no_state(item)
            no_state(b['load'])
            target=b['store']; kind=target['kind'];resource=self.resource_fields.get(name)
            value=self.expression(b['load'])
            if resource and kind not in('ram','resource-ram'): raise ValueError('resource effects require persistent token or canonical native storage')
            if kind=='resource-ram':
                native=resource['native_value'];size=resource['span_size']
                if resource['rom_sha256']!=sha(self.host) or type(size)is not int or not 1<=size<=65536 or not BASE<=native<native+size<=BASE+len(self.host) or sha(self.host[native-BASE:native-BASE+size])!=resource['span_sha256']: raise ValueError('native resource codec requires exact pinned original host ROM resource')
                if resource is None or target.get('resource')!=resource['id'] or b['load']!={'op':'ram','cell':target['cell']}: raise ValueError('resource storage codec must match captured resource identity and cell')
                value='adapter_resource_to_token('+cell(target['cell'])+','+str(resource['native_value'])+'u,'+str(resource['token'])+'u)'
            loads.append('s->'+name+'='+value+';')
            if resource: loads.append('if(s->'+name+'!=0u&&s->'+name+'!='+str(resource['token'])+'u)__builtin_trap();')
            if kind=='ram': stores.append(cell(target['cell'])+'=s->'+name+';')
            elif kind=='resource-ram': stores.append(cell(target['cell'])+'=adapter_resource_to_native(s->'+name+','+str(resource['native_value'])+'u,'+str(resource['token'])+'u);')
            elif kind=='discard':
                if not target.get('role') or not target.get('evidence'): raise ValueError('discarded presentation state requires source evidence/role')
                for pin in target['evidence']: read_pin(self.root,pin)
            elif kind=='flag-bit':
                mask=target['mask']
                if type(mask)is not int or not 0<mask<1<<int(self.locals[name][1:]) or mask&(mask-1): raise ValueError('single donor persistence bit required')
                before=self.expression(b['load']); after=f'(s->{name}&UINT32_C({mask}))'
                # Ownership grants are monotonic; a clearing donor result is a contradiction.
                stores.append(f'if(({before})&UINT32_C({mask})){{if(!{after})__builtin_trap();}}else if({after}){{'+self.actions(target['grant'])+'}')
            else: raise ValueError('unsupported storage mapping')
        barrier='__asm__ volatile("" ::: "memory");'
        return '\n'.join(loads+[barrier]),'\n'.join(stores+[barrier])

    def validate_module(self,x):
        if x!=self.behavior: raise ValueError('host emitter module identity mismatch')
        declared={s['id']:s for s in x.get('retained_services',[])}
        if set(declared)!=set(self.recipe.get('service_mappings',{})): raise ValueError('donor native boundary inventory mismatch')
        self.sync()  # Validate complete resource/state mapping before lowering.

    def __call__(self,statement,*,render_expr,context):
        mapping=self.recipe['service_mappings'][statement['service']]
        args=[render_expr(a) for a in statement['arguments']]
        checks=mapping.get('checks',[])
        if not mapping.get('source_evidence'): raise ValueError('mapped donor service lacks semantic evidence')
        for pin in mapping['source_evidence']: read_pin(self.root,pin)
        # Every source input is classified, including intentionally translated coordinates.
        if sorted(mapping.get('argument_roles',{}))!=[str(i) for i in range(len(args))]: raise ValueError('mapped service arguments unclassified')
        loads,stores=self.sync()
        out=['{']+[f'uint32_t adapter_arg_{i}={a};' for i,a in enumerate(args)]
        args=[f'adapter_arg_{i}' for i in range(len(args))]
        for c in checks: out.append('if(!('+self.expression(c,args)+'))__builtin_trap();')
        out.extend([stores,self.actions(mapping['actions'],args),loads])
        if 'result'in statement:
            if 'result'not in mapping: raise ValueError('mapped service return unresolved')
            out.append(statement['result']+'='+self.expression(mapping['result'],args)+';')
        return '\n'.join(out+['}'])

    def generate(self):
        modules=self.recipe['modules']
        if not isinstance(modules,list) or len(modules)!=1: raise ValueError('one source-closed dispatcher module required')
        m=modules[0];label=symbol(m['label'])
        x=json.loads(read_pin(self.root,m['ir'])); adapter=json.loads(read_pin(self.root,m['adapter']))
        if x.get('parameters') or x.get('return_type','void')!='void' or adapter.get('return_type','void')!='void' or adapter.get('native_abi') or adapter.get('native_sequence'): raise ValueError('callback requires source no-argument dispatcher ABI')
        if x.get('collections') or adapter.get('object_references') or adapter.get('entity_references'): raise ValueError('callback storage collections/references unresolved')
        self.resource_fields={}
        resources={r['id']:r for r in adapter.get('resource_references',[])}
        if {r['id']:r['token'] for r in x.get('resource_references',[])}!={name:r['token'] for name,r in resources.items()}: raise ValueError('source resource reference inventory mismatch')
        for f in x['state']:
            if f.get('resource_reference'):
                resource=resources.get(f['resource_reference'])
                if resource is None or resource.get('field')!=f['name'] or f['storage_type']!='u32': raise ValueError('source resource field binding mismatch')
                native,token=resource['native_value'],resource['token']
                if type(native)is not int or not BASE<=native<BASE+MAX_ROM or type(token)is not int or not 1<=token<=0xffffffff: raise ValueError('unsupported resource reference native/token identity')
                self.resource_fields[f['name']]=resource
        if {r['id'] for r in self.resource_fields.values()}!=set(resources): raise ValueError('unbound source resource reference')
        self.behavior=x;self.locals={symbol(f['name']):f['storage_type'] for f in x['state']};self.bindings=m['bindings']
        for v in x['locals']: symbol(v['name'])
        if set(self.locals)!=set(self.bindings): raise ValueError('full donor state mapping required')
        if {f['name'] for f in adapter['fields']}!=set(self.locals): raise ValueError('donor adapter state inventory mismatch')
        spans=[]
        for name,b in self.bindings.items():
            if b['store']['kind'] in('ram','resource-ram'):
                target=b['store']['cell'];cell(target);a=target['address'];n=target['width']//8
                if self.locals[name]!='u'+str(target['width']): raise ValueError('implicit storage narrowing/width conversion forbidden')
                if any(a<end and start<a+n for start,end in spans): raise ValueError('overlapping host state storage')
                spans.append((a,a+n))
        for f in adapter['fields']:
            if f['owner']!='global' or self.locals.get(f['name'])!='u'+str(f['width']): raise ValueError('donor canonical storage type mismatch')
        self.validate_module(x)
        source_services={c['id']:c for c in adapter.get('retained_services',[])}
        if set(source_services)!={c['id'] for c in x.get('retained_services',[])}: raise ValueError('donor captured service inventory mismatch')
        for service in x.get('retained_services',[]):
            native=source_services[service['id']]
            if service['arguments']!=[a['type'] for a in native['abi']['arguments']] or service['return_type']!=native['abi']['return']: raise ValueError('donor captured service signature mismatch')
        code=self.lower(x,native_service_emitter=self if x.get('retained_services') or x.get('resource_references') else None)
        code=code.replace('behavior_0','donor_'+label).replace('void donor_'+label+'(', '__attribute__((noinline)) void donor_'+label+'(')
        cb=self.recipe['callback']; name=symbol(cb['symbol'])
        loads,stores=self.sync(); init=cb['initialize']
        # The sentinel is adapter-owned script scratch, reset by native InitScriptContext.
        initcode='if(!'+cell(init['sentinel'])+'){'+self.actions(init['actions'])+'}'
        call='donor_'+label+'(s'+(',native_ctx' if x.get('retained_services') or x.get('resource_references') else '')+');'
        context='LiftedNativeContext context={{0,0,0,0}}; const LiftedNativeContext*native_ctx=&context;' if x.get('retained_services') or x.get('resource_references') else ''
        if any(a.get('op')!='assert' for a in cb.get('guards',[])): raise ValueError('pre-initialization guards must be assertions')
        declarations='\n'+''.join('extern const uint8_t adapter_object_'+symbol(o['label'])+'[];\n' for o in self.recipe['installation'].get('objects',[]))
        wrapper=declarations+'\nuint8_t '+name+'(void){'+context+'LiftedState state;LiftedState*s=&state;\n'+self.actions(cb.get('guards',[]))+'\n'+initcode+'\n'+self.actions(cb.get('before',[]))+'\n'+loads+'\n'+call+'\n'+stores+'\nif('+self.expression(cb['complete'])+'){'+self.actions(cb.get('finish',[]))+'return 1;}return 0;}\n'
        helpers=('#include <stdint.h>\nstatic uint32_t adapter_resource_to_token(uint32_t v,uint32_t native,uint32_t token){if(v==0)return 0;if(v==native)return token;__builtin_trap();}\nstatic uint32_t adapter_resource_to_native(uint32_t v,uint32_t native,uint32_t token){if(v==0)return 0;if(v==token)return native;__builtin_trap();}\n') if self.resource_fields else ''
        return helpers+code+wrapper


def object_size(obj):
    size=0
    for piece in obj['pieces']:
        if set(piece)=={'hex'}: size+=len(bytes.fromhex(piece['hex']))
        elif set(piece)=={'symbol_u32'}: symbol(piece['symbol_u32']);size+=4
        else: raise ValueError('unsupported appended object piece')
    if not 1<=size<=65536: raise ValueError('appended object extent outside bounds')
    return size


def load_lower(compiler):
    sys.path.insert(0,str(compiler))
    spec=importlib.util.spec_from_file_location('adapter_pinned_lower',compiler/'lower.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.lower


def capture(recipe_path,root,bundle,adapter_request=None):
    root=Path(root).resolve(); recipe_source=Path(recipe_path).read_bytes();recipe=json.loads(recipe_source); bundle=Path(bundle).resolve();bundle.mkdir(parents=True,exist_ok=False)
    (bundle/'source-recipe.json').write_bytes(recipe_source)
    request_pin=None
    if adapter_request is not None:
        request_bytes=Path(adapter_request).read_bytes(); request=json.loads(request_bytes)
        if request.get('schema')!='gameverse.behavior-adapter-request/1' or request.get('contradictions') or request.get('classification')=='incompatible': raise ValueError('behavior request contradictions must be resolved before native generation')
        if request.get('adapter_recipe',{}).get('sha256')!=sha(recipe_source) or request.get('adapter_recipe_sha256')!=canonical(recipe): raise ValueError('behavior request does not pin this exact recipe')
        for side in ('host','donor'):
            if canonical(request[side])!=request.get(side+'_sha256'): raise ValueError('behavior request node identity mismatch')
        (bundle/'adapter-request.json').write_bytes(request_bytes)
        request_pin={'path':'adapter-request.json','sha256':sha(request_bytes),'canonical_sha256':canonical(request),'request_id':request['request_id'],'host_node_sha256':request['host_sha256'],'donor_node_sha256':request['donor_sha256'],'classification':request['classification'],'missing_contracts':request.get('missing_contracts',[])}
    # Collect only explicit immutable recipe references, never donor source discovery at replay.
    def rewrite(value):
        if isinstance(value,list): return [rewrite(v) for v in value]
        if not isinstance(value,dict): return value
        if 'path'in value and 'sha256'in value:
            raw=read_pin(root,value); dest='inputs/'+sha(raw)+Path(value['path']).suffix
            target=bundle/dest;target.parent.mkdir(exist_ok=True);target.write_bytes(raw)
            return dict(value,path=dest)
        return {k:rewrite(v) for k,v in value.items()}
    recipe=rewrite(recipe)
    compiler=bundle/'compiler';compiler.mkdir()
    source=Path(__file__).resolve().parents[1]/'behavior_ir'
    for name in ('lower.py','contract.py','domain.py'):
        shutil.copyfile(source/name,compiler/name)
    shutil.copyfile(__file__,bundle/'behavior_adapter.py')
    write_json(bundle/'recipe.json',recipe)
    receipt={'request':request_pin,'source_recipe_sha256':sha(recipe_source),'source_recipe_canonical_sha256':canonical(json.loads(recipe_source)),'source_root':str(root),'schema':'gameverse.behavior-adapter-capture/1','recipe_sha256':sha((bundle/'recipe.json').read_bytes()),'compiler':{p.name:sha(p.read_bytes()) for p in compiler.iterdir()},'generator_sha256':sha((bundle/'behavior_adapter.py').read_bytes())}
    write_json(bundle/'capture.json',receipt)
    return receipt


def capture_request(request_path,root,bundle):
    request=json.loads(Path(request_path).read_bytes())
    if request.get('schema')!='gameverse.behavior-adapter-request/1' or request.get('contradictions') or request.get('classification')=='incompatible': raise ValueError('unresolved behavioral request contradictions')
    reference=request.get('adapter_recipe')
    if not isinstance(reference,dict): raise ValueError('behavioral request requires a pinned adapter recipe')
    read_pin(root,reference)
    return capture(Path(root)/reference['path'],root,bundle,request_path)


def source_read_guard(source_root,bundle,output):
    denied=Path(source_root).resolve();allowed=(bundle.resolve(),output.resolve())
    def guard(event,args):
        if event!='open' or not args or not isinstance(args[0],(str,bytes)): return
        path=Path(args[0].decode(sys.getfilesystemencoding()) if isinstance(args[0],bytes) else args[0]).resolve()
        if path.is_relative_to(denied) and not any(path.is_relative_to(root) for root in allowed):
            raise PermissionError('captured replay denies original/source workspace reads: '+str(path))
    sys.addaudithook(guard)
    probe=denied/'AGENTS.md'
    try: probe.read_bytes()
    except PermissionError: pass
    else: raise ValueError('source read denial negative control failed')
    return {'mechanism':'Python open audit hook with bundle/output exceptions','denied_source_root':str(denied),'negative_control':'pass','compiler_subprocess_os_confined':False}


def build(bundle,output,deny_source_reads=False):
    bundle=Path(bundle).resolve();output=Path(output).resolve();output.mkdir(parents=True,exist_ok=False)
    started=time.perf_counter(); stages=[];recipe=json.loads((bundle/'recipe.json').read_text())
    report={'schema':'gameverse.behavior-adapter-build/1','outcome':'fail','native_play_verified':False,'semantic_closure':'OPEN','queue_seconds':None,'recipe_sha256':sha((bundle/'recipe.json').read_bytes()),'stages':stages}
    def run(name,command):
        t=time.perf_counter();p=subprocess.run(command,capture_output=True,text=True,timeout=30,cwd=output)
        stages.append({'name':name,'wall_seconds':time.perf_counter()-t,'outcome':'pass'if not p.returncode else'fail','command':list(map(str,command)),'stdout':p.stdout,'stderr':p.stderr});write_json(output/'build-report.json',report);p.check_returncode();return p.stdout
    try:
        capture_receipt=json.loads((bundle/'capture.json').read_text())
        if sha((bundle/'source-recipe.json').read_bytes())!=capture_receipt['source_recipe_sha256']: raise ValueError('source recipe capture pin mismatch')
        if capture_receipt['recipe_sha256']!=report['recipe_sha256'] or capture_receipt['generator_sha256']!=sha(Path(__file__).read_bytes()): raise ValueError('captured recipe/generator identity mismatch')
        if capture_receipt.get('request'):
            read_pin(bundle,capture_receipt['request']);report['request']=capture_receipt['request']
        if deny_source_reads: report['source_read_guard']=source_read_guard(capture_receipt['source_root'],bundle,output)
        for name,digest in capture_receipt['compiler'].items():
            if sha((bundle/'compiler'/name).read_bytes())!=digest: raise ValueError('captured compiler identity mismatch')
        host=read_pin(bundle,recipe['host_rom']);gen=Generator(recipe,bundle,host,load_lower(bundle/'compiler'))
        code=gen.generate();(output/'generated.c').write_text(code)
        payload_address=BASE+len(host)
        if len(host)%4 or len(host)>=MAX_ROM: raise ValueError('unsupported append arena')
        object_symbols=''
        for obj in recipe['installation'].get('objects',[]):
            alignment=obj.get('alignment',4)
            if alignment not in(1,2,4): raise ValueError('unsupported appended object alignment')
            object_symbols+=' . = ALIGN('+str(alignment)+'); adapter_object_'+symbol(obj['label'])+' = ABSOLUTE(.); . += '+str(object_size(obj))+'; '
        (output/'native.ld').write_text(f'SECTIONS {{ . = 0x{payload_address:x}; .text : {{ *(.text*) *(.rodata*) }} .data : {{ *(.data*) }} .bss : {{ *(.bss*) *(COMMON) }} ASSERT(SIZEOF(.data) == 0, "mutable data forbidden") ASSERT(SIZEOF(.bss) == 0, "mutable bss forbidden") {object_symbols} /DISCARD/ : {{ *(.ARM.exidx*) *(.comment*) *(.note*) }} }}\n')
        run('compile',['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fno-builtin','-Os','-c','generated.c','-o','generated.o'])
        run('link',['arm-none-eabi-ld','-T','native.ld','-e',recipe['callback']['symbol'],'generated.o','-o','native.elf'])
        symbols=run('symbols',['arm-none-eabi-nm','-S','native.elf'])
        symbol_records=[{'name':p[3],'address':int(p[0],16),'bytes':int(p[1],16),'kind':p[2]} for line in symbols.splitlines() if len(p:=line.split())==4]
        if any(row['kind'] in 'BbDdCcGgSs' for row in symbol_records): raise ValueError('unowned mutable linked storage')
        entries={row['name']:row['address']&~1 for row in symbol_records}
        run('binary',['arm-none-eabi-objcopy','-O','binary','native.elf','native.bin']);payload=(output/'native.bin').read_bytes()
        if not 0<len(payload)<=recipe['limits']['max_payload_bytes']: raise ValueError('behavioral adapter payload resource limit exceeded')
        linked_objects={p[2]:int(p[0],16) for line in symbols.splitlines() if len(p:=line.split())==3 and p[1]in('A','a')}
        objects={}
        for obj in recipe['installation'].get('objects',[]):
            label=symbol(obj['label']);alignment=obj.get('alignment',4)
            if alignment not in(1,2,4) or label in objects: raise ValueError('invalid appended script object')
            payload+=b'\xff'*((-len(payload))%alignment); objects[label]=payload_address+len(payload)
            if linked_objects.get('adapter_object_'+label)!=objects[label]: raise ValueError('linked script object reference differs from actual placement')
            for piece in obj['pieces']:
                if 'hex'in piece: payload+=bytes.fromhex(piece['hex'])
                elif 'symbol_u32'in piece: payload+=struct.pack('<I',entries[symbol(piece['symbol_u32'])]|1)
                else: raise ValueError('unsupported appended object piece')
        if len(payload)>recipe['limits']['max_payload_bytes']: raise ValueError('behavioral script/payload resource limit exceeded')
        rebuilt=bytearray(host);replacements=[]
        for patch in recipe['installation']['patches']:
            offset=patch['address']-BASE;pre=bytes.fromhex(patch['preimage'])
            if not pre or not 0<=offset<=len(host)-len(pre) or host[offset:offset+len(pre)]!=pre: raise ValueError('host entry preimage mismatch')
            data=bytearray()
            for piece in patch['pieces']:
                if 'hex'in piece: data.extend(bytes.fromhex(piece['hex']))
                elif 'symbol_u32'in piece: data.extend(struct.pack('<I',entries[symbol(piece['symbol_u32'])]|1))
                elif 'object_u32'in piece: data.extend(struct.pack('<I',objects[symbol(piece['object_u32'])]))
                else: raise ValueError('unsupported script relocation piece')
            if len(data)!=len(pre) or any(offset<end and start<offset+len(pre) for start,end in replacements): raise ValueError('overlapping/width-changing host script patch')
            rebuilt[offset:offset+len(pre)]=data;replacements.append((offset,offset+len(pre)))
        (output/'installed-payload.bin').write_bytes(payload)
        rebuilt.extend(payload)
        if len(rebuilt)>MAX_ROM: raise ValueError('GBA cartridge bound exceeded')
        (output/'candidate.gba').write_bytes(rebuilt)
        report.update(outcome='pass',capture=capture_receipt,toolchain={tool:subprocess.check_output([tool,'--version'],text=True).splitlines()[0] for tool in ('cc','arm-none-eabi-ld','arm-none-eabi-objcopy')},native_symbols=symbol_records,code_payload_bytes=len((output/'native.bin').read_bytes()),code_payload_sha256=sha((output/'native.bin').read_bytes()),generated_c_sha256=sha(code.encode()),host_sha256=sha(host),candidate_sha256=sha(rebuilt),payload_sha256=sha(payload),payload_bytes=len(payload),symbols=entries,objects=objects,installation=recipe['installation'],state_lifecycle=recipe['state_lifecycle'],phase=recipe['phase'],source_independent=True,scope='Captured source-derived donor control/state and declarative host ABI; native services remain native and OPEN')
        return report
    except Exception as error:
        report['error']=str(error);raise
    finally:
        report.update(total_seconds=time.perf_counter()-started,cache='clean native compilation from captured IR',machine=platform.platform(),queue_seconds=None)
        write_json(output/'build-report.json',report)


def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='operation',required=True)
    c=sub.add_parser('capture');c.add_argument('recipe');c.add_argument('root');c.add_argument('bundle');c.add_argument('--request')
    r=sub.add_parser('capture-request');r.add_argument('request');r.add_argument('root');r.add_argument('bundle')
    b=sub.add_parser('build');b.add_argument('bundle');b.add_argument('output');b.add_argument('--deny-source-reads',action='store_true');a=p.parse_args()
    result=capture(a.recipe,a.root,a.bundle,a.request) if a.operation=='capture' else capture_request(a.request,a.root,a.bundle) if a.operation=='capture-request' else build(a.bundle,a.output,a.deny_source_reads)
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()
