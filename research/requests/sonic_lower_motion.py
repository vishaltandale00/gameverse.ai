#!/usr/bin/env python3
"""Lower independently recovered Sonic motion leaves to native ARM7TDMI code.

This component backend produces an ELF/object, not a game. Qualification runs
the original cart's Thumb instructions and the emitted Thumb code in separate
private RAM contexts, retaining every stage and failure. No community source,
ROM modification, network, accepted player state or game asset download.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(out):
    out.mkdir(parents=True,exist_ok=False)
    receipt=out/'receipt.json'
    source=ROOT/'research/requests/sonic-recovered-motion.c'
    driver=ROOT/'research/requests/sonic_motion_differential.c'
    rom=ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba'
    if hashlib.sha1(rom.read_bytes()).hexdigest()!='d842afa7dd1e84de08addb94a51506f1bcafd551':
        raise ValueError('ROM mismatch')
    report={'kind':'self_recovered_native_component_lowering','game_id':'sonic-advance',
        'rom_sha1':hashlib.sha1(rom.read_bytes()).hexdigest(),'rom_sha256':digest(rom),
        'source_sha256':digest(source),'oracle_driver_sha256':digest(driver),
        'backend_sha256':digest(__file__),'build_mode':'clean','cache':'none',
        'queue_s':None,'environment':platform.platform(),'stages':[],
        'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],
        'outcome':'running','limits':{'stage_timeout_s':15,'vectors':18774,'instructions_per_call':256},
        'scope':'Five motion leaves only; no whole game or native mashup ROM generated'}
    start=time.monotonic()
    def stage(label,command):
        before=time.monotonic()
        result=subprocess.run(command,capture_output=True,text=True,timeout=15,cwd=ROOT)
        row={'label':label,'command':command,'wall_s':round(time.monotonic()-before,6),
             'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
        report['stages'].append(row);receipt.write_text(json.dumps(report,indent=2)+'\n')
        if result.returncode:raise RuntimeError(label+' failed')
        return result.stdout
    try:
        obj=out/'motion.o';elf=out/'motion.elf';binary=out/'motion.bin'
        stage('compile_arm7tdmi',['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb',
            '-ffreestanding','-fno-builtin','-Os','-Wall','-Wextra','-c',str(source),'-o',str(obj)])
        script=out/'component.ld'
        script.write_text('SECTIONS { . = 0x02010000; .text : { *(.text*) } /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }\n')
        stage('link_component',['arm-none-eabi-ld','-T',str(script),'-e','sonic_recovered_integrate',str(obj),'-o',str(elf)])
        stage('emit_native_text',['arm-none-eabi-objcopy','-O','binary',str(elf),str(binary)])
        symbols={}
        for line in stage('symbols',['arm-none-eabi-nm','-n',str(elf)]).splitlines():
            fields=line.split()
            if len(fields)==3:symbols[fields[2]]=int(fields[0],16)
        pairs=[(0x08046f78,'sonic_recovered_slope_acceleration'),(0x08047078,'sonic_recovered_surface_projection'),
               (0x080470b4,'sonic_recovered_integrate'),(0x08047100,'sonic_recovered_gravity'),
               (0x080471a0,'sonic_recovered_surface_detach')]
        text=driver.read_text()
        text=text.replace('#include "sonic-recovered-motion.c"','#include "'+str(source)+'"')
        text=text.replace('static unsigned long calls, instructions;',
            'static unsigned long calls, instructions;\nstatic unsigned long lowered_calls;')
        text=text.replace('    struct ARMCore *cpu=core->cpu;',
            '    SonicRecoveredMotion input=*state;\n    struct ARMCore *cpu=core->cpu;')
        text=text.replace('cpu->gprs[0]=ram;cpu->gprs[ARM_SP]',
            'cpu->gprs[0]=ram;cpu->gprs[1]=flags;cpu->gprs[2]=previous;cpu->gprs[ARM_SP]')
        needle='    return 1;\n}\nstatic void compare'
        addition='''    if(entry>=0x08000000) {
        uint32_t target=0;
        switch(entry){PAIRS}
        SonicRecoveredMotion nativeResult=*state;
        *state=input;
        uint32_t arg1=(entry==0x08046f78 || entry==0x08047078)?0x0809b3f0:flags;
        if(!original(core,target,state,arg1,previous))return 0;
        if(memcmp(state,&nativeResult,sizeof(*state))){fprintf(stderr,"emitted Thumb mismatch at%08x\\n",entry);return 0;}
        lowered_calls++;
    }
    return 1;
}
static void compare'''.replace('PAIRS',''.join('case 0x%x:target=0x%x;break;'%(a,symbols[n]) for a,n in pairs))
        assert needle in text;text=text.replace(needle,addition)
        text=text.replace('if(argc!=2 ||','if(argc!=3 ||')
        needle='    core->reset(core);'
        addition=needle+'''\n    FILE *native=fopen(argv[2],"rb");if(!native)return 8;
    unsigned nativeByte=0;int byte;
    while((byte=fgetc(native))!=EOF){if(nativeByte>=4096)return 9;core->busWrite8(core,0x02010000+nativeByte++,byte);}
    fclose(native);'''
        text=text.replace(needle,addition)
        generated=out/'native_differential.c';generated.write_text(text)
        report['generated_driver_sha256']=digest(generated)
        exe=out/'native-differential'
        stage('compile_oracle',['cc','-std=c11','-O1','-Wall','-Wextra','-I/opt/homebrew/include',
            str(generated),'-L/opt/homebrew/lib','-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',str(exe)])
        output=stage('qualify_original_and_emitted_thumb',[str(exe),str(rom),str(binary)])
        report['differential']=json.loads(output)
        report['differential']['emitted_thumb_calls']=report['differential']['vectors']
        report['differential']['note']='Driver original_rom_calls aggregates original+emitted calls in this extended run; each side executes the reported vector count.'
        report['artifacts']={str(p.name):{'sha256':digest(p),'bytes':p.stat().st_size} for p in [obj,elf,binary]}
        report['symbols']={name:hex(symbols[name]) for _,name in pairs}
        report['outcome']='qualified_component_subset'
    except Exception as exc:
        report.update(outcome='failed',error=str(exc));raise
    finally:
        report['wall_s']=round(time.monotonic()-start,6)
        receipt.write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();result=run(args.out.resolve())
    print(json.dumps({'outcome':result['outcome'],'wall_s':result['wall_s'],'artifacts':result['artifacts']}))
