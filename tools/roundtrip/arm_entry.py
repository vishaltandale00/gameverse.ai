"""Registered no-argument ARM entry transfer and installed-effect proof.

No recovered behavior is implemented here. The portable body remains generated
from pinned IR. This mechanical path is deliberately narrower than AAPCS32.
"""
from __future__ import annotations
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

SCHEMA='gameverse.arm-global-void-entry/1'
BACKEND='arm-global-void/1'
ROOT=Path(__file__).resolve().parents[2]

def sha(data):return hashlib.sha256(data).hexdigest()

def contract(adapter, original=None):
    a=adapter.get('native_abi',{})
    if (a.get('schema')!='gameverse.native-abi/0.1' or a.get('mode')!='arm'
        or a.get('exit',{}).get('kind')!='arm_saved_lr'
        or adapter.get('parameters')!=[] or adapter.get('return_type')!='void'
        or adapter.get('collections') or adapter.get('retained_services')
        or any(adapter.get(k) for k in ('native_sequence','continuation_tokens','object_references','entity_references','argument_views'))):
        raise ValueError('ARM entry requires registered saved-LR noargs void global-only context')
    if (set(a.get('preserve',[]))!={'r'+str(i) for i in range(3,13)}
        or set(a.get('clobbers',[]))!={'r0','r1','r2'} or a.get('liveouts') or a.get('expected_exit')
        or set(a.get('registers',{}))!={'r'+str(i) for i in range(13)}
        or any(type(v) is not int or not 0<=v<=0xffffffff for v in a['registers'].values())):
        raise ValueError('ARM entry requires exact r3-r12 preservation and dead r0-r2 inputs')
    if not 1<=len(adapter.get('fields',[]))<=4096:
        raise ValueError('ARM entry canonical field budget')
    occupied=set()
    for f in adapter['fields']:
        if (f.get('owner')!='global' or f.get('width') not in (8,16,32)
            or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',f.get('name',''))
            or type(f.get('address')) is not int or type(f.get('offset')) is not int or f.get('domain')):
            raise ValueError('ARM entry requires typed canonical global scalar state')
        address=f['address']+f['offset'];width=f['width']//8
        if address%width:raise ValueError('ARM entry wide state requires natural alignment')
        if not (0x02000000<=address<=0x02040000-width or 0x03000000<=address<=0x03007a00-width):
            raise ValueError('ARM entry state outside canonical RAM or inside proof stack arena')
        cells=set(range(address,address+width))
        if cells&occupied:raise ValueError('ARM entry canonical state aliases')
        occupied|=cells
    if len(occupied)>4096:raise ValueError('ARM entry state byte budget')
    entry=int(adapter['entry'],16)
    result={'schema':SCHEMA,'mode':'arm','bytes':12,'transfer':'ldr_r0_literal_bx_r0',
            'incoming_arguments':0,'return_type':'void','clobbers':['r0'],
            'preserves':['r1-r12','lr','sp','nzcv'],
            'binding_preserves_extra_aapcs':['r3','r12'],
            'stack_save_bytes':16,'source_rom_sha256':a['rom_sha256'],
            'scope':'registered source-proven noargs/void global-state entry; installed proof required'}
    if original is not None:
        sys.path.insert(0,str(ROOT/'tools/behavior_ir'))
        from native_abi import validate
        proven=validate(adapter,original)
        off=entry-0x08000000
        # Source PUSH LR cannot consume r0; the following unconditional literal
        # load kills it before every possible original use. Never infer r0-dead
        # merely from its caller-scratch designation.
        if (int.from_bytes(original[off:off+4],'little')!=0xe92d4000
            or int.from_bytes(original[off+4:off+8],'little')&0xfffff000!=0xe59f0000):
            raise ValueError('ARM entry source must kill incoming r0 with immediate unconditional PC literal load')
        result['source_return_proof']=proven['arm_return_proof']
        result['source_overwrite_sha256']=sha(original[off:off+12])
        result['source_overwrite_bytes']=12
        result['source_r0_dead']='entry STMDB SP!,LR then unconditional PC-relative LDR r0 before any r0 use'
    return result

def veneer(target):
    if type(target) is not int or target&3 or not 0x08000000<=target<0x0a000000:
        raise ValueError('ARM veneer requires aligned ARM ROM destination')
    return bytes.fromhex('00009fe510ff2fe1')+target.to_bytes(4,'little')

def binding(adapter,label,storage_moves):
    contract(adapter)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',label):raise ValueError('ARM binding label')
    loads,stores=storage_moves(adapter)
    body=('\n__attribute__((noinline,used)) void native_body_'+label+'(void){\nState_'+label+' s;\n'
          +'\n'.join(loads)+'\nlifted_'+label+'(&s);\n'+'\n'.join(stores)+'\n}\n')
    # r2 is padding, keeping SP 8-byte aligned across the ordinary C call.
    # Source-preserved r3/r12 are caller-scratch under AAPCS, so save them too.
    assembly=('.arm\n.align 2\n.global native_'+label+'\n.type native_'+label+',%function\nnative_'+label+':\n'
              'stmdb sp!,{r2,r3,r12,lr}\nbl native_body_'+label+'\nldmia sp!,{r2,r3,r12,lr}\nbx lr\n'
              '.size native_'+label+',.-native_'+label+'\n')
    return body+'__asm__('+json.dumps(assembly)+');\n'

def shim_bytes(shim,body):
    delta=body-(shim+12) # BL resides at shim+4; its architectural PC is +8.
    if shim&3 or body&3 or delta%4 or not -(1<<25)<=delta<(1<<25):
        raise ValueError('ARM binding call branch range/alignment')
    words=[0xe92d500c,0xeb000000|((delta//4)&0xffffff),0xe8bd500c,0xe12fff1e]
    return b''.join(w.to_bytes(4,'little')for w in words)

def validate_install(adapter,original,rebuilt,shim,body):
    result=contract(adapter,original)
    entry=int(adapter['entry'],16);off=entry-0x08000000
    if rebuilt[off:off+12]!=veneer(shim):raise ValueError('installed ARM veneer bytes mismatch')
    at=shim-0x08000000
    if at<0 or rebuilt[at:at+16]!=shim_bytes(shim,body):raise ValueError('installed ARM preserved-register shim mismatch')
    if not 0<=body-0x08000000<len(rebuilt):raise ValueError('installed ARM body outside artifact')
    return dict(result,original_sha256=sha(original),rebuilt_sha256=sha(rebuilt),
                original_entry=entry,shim=shim,body=body,hook_sha256=sha(rebuilt[off:off+12]),
                shim_sha256=sha(rebuilt[at:at+16]))

def qualify_installed(directory,original_path,rebuilt_path,adapter,shim,body,vectors,fixtures):
    """Finite original-v-installed CPU effect comparison, distinct from L1 parity."""
    started=time.perf_counter();directory=Path(directory)
    original=Path(original_path).read_bytes();rebuilt=Path(rebuilt_path).read_bytes()
    meta=validate_install(adapter,original,rebuilt,shim,body)
    if type(vectors) is not int or not 1<=vectors<=16384:raise ValueError('ARM installed vector cap')
    fields=adapter['fields'];rows=(fixtures or {}).get('states',[]);expected=(fixtures or {}).get('expected_states',[])
    if len(rows)>vectors or len(expected)!=len(rows):raise ValueError('ARM installed complete expected fixture rows required')
    packed=[];expected_packed=[];addresses=[]
    for f in fields:addresses.extend(range(f['address']+f['offset'],f['address']+f['offset']+f['width']//8))
    for source,target in ((rows,packed),(expected,expected_packed)):
        for row in source:
            if set(row)!={f['name']for f in fields}:raise ValueError('ARM installed fixture field coverage')
            data=[]
            for f in fields:
                value=row[f['name']]
                if type(value) is not int or not 0<=value<1<<f['width']:raise ValueError('ARM installed fixture scalar width')
                data.extend(value.to_bytes(f['width']//8,'little'))
            target.append(data)
    occupied=set(addresses);guards=sorted({at for address in addresses for at in range(address-16,address+17) if at not in occupied
                                         and (0x02000000<=at<0x02040000 or 0x03000000<=at<0x03007a00)})
    if len(guards)>8192:raise ValueError('ARM installed canary budget')
    # Original helper validates original source/prologue and checks the declared
    # saved-LR frame. Installed helper checks the *new* pinned ARM transfer/shim;
    # it never re-labels the rebuilt bytes as an original PUSH-LR prologue.
    from native_abi import render_call
    original_helper,_,_=render_call(adapter,original)
    a=adapter['native_abi'];assign=''.join('cpu->gprs['+str(i)+']='+str(a['registers']['r'+str(i)])+'u;'for i in range(13))
    preserved=''.join('if((uint32_t)cpu->gprs['+str(i)+']!='+str(a['registers']['r'+str(i)])+'u)return 0;'for i in range(3,13))
    installed='''
static int installed_call(struct mCore*c){struct ARMCore*cpu=c->cpu;for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;ASSIGN
cpu->gprs[13]=0x03007e00;cpu->gprs[14]=0x08000000;cpu->cpsr.i=1;cpu->cpsr.f=1;cpu->cpsr.n=cpu->cpsr.z=cpu->cpsr.c=cpu->cpsr.v=0;cpu->cycles=0;cpu->nextEvent=INT_MAX;
_ARMSetMode(cpu,MODE_ARM);cpu->gprs[15]=ENTRY;ARMWritePC(cpu);unsigned n=0;uint32_t last=0;unsigned seen_shim=0;
while(native_pc(cpu)!=0x08000000u&&n<CAP){last=native_pc(cpu);if(n<2&&(cpu->cpsr.t||last!=ENTRY+n*4u))return 0;if(last==SHIM&&!cpu->cpsr.t)seen_shim++;ARMRun(cpu);n++;}
instructions+=n;if(n==CAP||cpu->cpsr.t||last!=TERMINAL||seen_shim!=1||(uint32_t)cpu->gprs[13]!=0x03007e00u)return 0;PRESERVED return 1;}
'''.replace('ASSIGN',assign).replace('ENTRY',str(int(adapter['entry'],16))+'u').replace('CAP',str(a.get('instruction_cap',2048))).replace('SHIM',str(shim)+'u').replace('TERMINAL',str(shim+12)+'u').replace('PRESERVED',preserved)
    def matrix(name,values):return 'static const uint8_t '+name+'['+str(max(1,len(values)))+']['+str(len(addresses))+']={'+','.join('{'+','.join(map(str,row))+'}'for row in values)+'};\n'
    prefix='''#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdint.h>
#include <stdio.h>
#include <limits.h>
static unsigned long instructions;
'''
    data='static const uint32_t addresses[]={'+','.join(map(str,addresses))+'};\nstatic const uint32_t guards[]={'+','.join(map(str,guards))+'};\n'+matrix('inputs',packed)+matrix('expected',expected_packed)
    main='''
static struct mCore*load(const char*path){struct mCore*c=GBACoreCreate();if(!c||!c->init(c))return NULL;mCoreInitConfig(c,NULL);mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);mCoreConfigSetDefaultIntValue(&c->config,"useBios",0);mCoreLoadConfig(c);if(!mCoreLoadFile(c,path))return NULL;c->reset(c);return c;}
int main(int argc,char**argv){if(argc!=3)return 2;struct mCore*o=load(argv[1]),*r=load(argv[2]);if(!o||!r)return 3;uint32_t rng=0x173ac591,args[4]={0},result;
for(unsigned test=0;test<VECTORS;test++){for(unsigned j=0;j<sizeof(addresses)/sizeof(addresses[0]);j++){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;uint8_t value=test<FIXTURES?inputs[test][j]:(uint8_t)rng;o->busWrite8(o,addresses[j],value);r->busWrite8(r,addresses[j],value);}for(unsigned j=0;j<sizeof(guards)/sizeof(guards[0]);j++){unsigned value=(test+j*17+0x5a)&255;o->busWrite8(o,guards[j],value);r->busWrite8(r,guards[j],value);}
if(!native_original_call(o,ENTRY,args,&result)){fprintf(stderr,"source ABI failed case%u\\n",test);return 4;}if(!installed_call(r)){fprintf(stderr,"installed ABI failed case%u\\n",test);return 5;}
for(unsigned j=0;j<sizeof(addresses)/sizeof(addresses[0]);j++){unsigned x=o->busRead8(o,addresses[j]),y=r->busRead8(r,addresses[j]);if(x!=y||(test<FIXTURES&&x!=expected[test][j])){fprintf(stderr,"installed state mismatch case%u byte%u original%u rebuilt%u\\n",test,j,x,y);return 6;}}
for(unsigned j=0;j<sizeof(guards)/sizeof(guards[0]);j++)if(o->busRead8(o,guards[j])!=((test+j*17+0x5a)&255)||r->busRead8(r,guards[j])!=((test+j*17+0x5a)&255)){fprintf(stderr,"installed canary mismatch case%u\\n",test);return 7;}}
printf("{\\"outcome\\":\\"pass\\",\\"vectors\\":VECTORS,\\"instructions_total\\":%lu}\\n",instructions);o->deinit(o);r->deinit(r);return 0;}
'''.replace('VECTORS',str(vectors)).replace('FIXTURES',str(len(rows))).replace('ENTRY',str(int(adapter['entry'],16))+'u')
    source=directory/'installed-entry-oracle.c';binary=directory/'installed-entry-oracle';source.write_text(prefix+original_helper+installed+data+main)
    report={'schema':'gameverse.arm-installed-entry-proof/1','outcome':'failed','rom_sha256':sha(rebuilt),'original_rom_sha256':sha(original),
            'entry_contract':meta,'limits':{'vectors':vectors,'instructions_per_call':a.get('instruction_cap',2048),'stage_timeout_s':30},
            'fixture_cases':len(rows),'observable_state_bytes':len(addresses),'canary_bytes':len(guards),'stages':[],
            'scope':'original source versus installed generated body at original ARM entry; complete declared global state, fixtures, canaries and source-preserved registers; no gameplay/lifecycle claim'}
    try:
        for name,cmd in [('compile_installed_oracle',['cc','-std=c11','-O1','-I/opt/homebrew/include',str(source),'-L/opt/homebrew/lib','-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',str(binary)]),('installed_native_parity',[str(binary),str(original_path),str(rebuilt_path)])]:
            start=time.perf_counter();proc=subprocess.run(cmd,text=True,capture_output=True,timeout=30)
            report['stages'].append({'label':name,'wall_s':time.perf_counter()-start,'exit_code':proc.returncode,'stdout':proc.stdout,'stderr':proc.stderr})
            if proc.returncode:raise ValueError(name+' failed: '+proc.stderr)
        report.update(outcome='pass',parity=json.loads(proc.stdout))
    except Exception as exc:report['error']=str(exc)
    report['wall_s']=time.perf_counter()-started
    report['artifacts']={name:{'sha256':sha((directory/name).read_bytes())}for name in ['l1.json','validation-adapter.json','generated.c','installed-entry-oracle.c']if(directory/name).exists()}
    (directory/'rebuilt-proof.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
