#!/usr/bin/env python3
"""Bounded qualification of own-ROM gameplay bundles, separate from ROM builds.

Requires the indexed Sonic USA cart and (for actor bundles) a private checkpoint
created by sonic_rom_probe.py. Each native call has an instruction cap in its
checked-in oracle driver; each process has a15second wall cap. No CI campaign,
network, public assets, accepted game save or ROM mutation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
BASE_SHA1='d842afa7dd1e84de08addb94a51506f1bcafd551'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(component,out,checkpoint):
    rom=ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba'
    if hashlib.sha1(rom.read_bytes()).hexdigest()!=BASE_SHA1:raise ValueError('USA ROM mismatch')
    if not checkpoint.is_file():raise ValueError('Private native checkpoint required')
    out.mkdir(parents=True,exist_ok=False)
    report={'id':out.name,'kind':'own_rom_gameplay_component_qualification',
        'component':component,'rom_sha1':BASE_SHA1,'rom_sha256':sha(rom),
        'checkpoint_sha256':sha(checkpoint),'queue_s':None,
        'build_mode':'clean','cache':'none','environment':platform.platform(),
        'limits':{'per_stage_wall_s':15,'oracle_scope':'Finitevectors; per-call instructioncaps in source'},
        'runner_sha256':sha(__file__),'stages':[],'outcome':'running'}
    start=time.monotonic()
    def stage(name,command):
        t=time.monotonic()
        try:
            r=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=15)
            row={'label':name,'wall_s':round(time.monotonic()-t,6),
                 'exit_code':r.returncode,'command':command,'stdout':r.stdout,'stderr':r.stderr}
            report['stages'].append(row)
            (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            if r.returncode:raise RuntimeError(name+' failed')
            return r.stdout
        except subprocess.TimeoutExpired:
            report['stages'].append({'label':name,'wall_s':round(time.monotonic()-t,6),'outcome':'timeout','command':command})
            raise
    def driver(name):
        source=ROOT/'research/requests'/name
        report['sources'][str(source.relative_to(ROOT))]=sha(source)
        exe=out/source.stem
        stage('compile_'+source.stem,['cc','-std=c11','-O1','-Wall','-Wextra','-Werror',
            '-I/opt/homebrew/include',str(source),'-L/opt/homebrew/lib',
            '-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',str(exe)])
        return str(exe)
    def image(source,address):
        obj=out/(source.stem+'.o');elf=out/(source.stem+'-'+hex(address)+'.elf')
        binary=elf.with_suffix('.bin');script=elf.with_suffix('.ld')
        if not obj.exists():stage('compile_arm',['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi',
            '-mthumb','-ffreestanding','-fno-builtin','-Os','-Wall','-Wextra','-Werror',
            '-c',str(source),'-o',str(obj)])
        script.write_text('SECTIONS { . = '+hex(address)+'; .text : { *(.text*) } /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }\n')
        stage('link_'+hex(address),['arm-none-eabi-ld','-T',str(script),str(obj),'-o',str(elf)])
        stage('emit_'+hex(address),['arm-none-eabi-objcopy','-O','binary',str(elf),str(binary)])
        symbols={}
        for line in stage('symbols_'+hex(address),['arm-none-eabi-nm','-n',str(elf)]).splitlines():
            fields=line.split()
            if len(fields)==3:symbols[fields[2]]='0x'+fields[0]
        return str(binary),symbols
    try:
        report['source_commit']=stage('source_context',['git','rev-parse','HEAD']).strip()
        name={'jump':'sonic-recovered-jump.c','air':'sonic-recovered-air-control.c',
              'contact':'sonic-recovered-contact.c'}[component]
        source=ROOT/'research/requests'/name;report['sources']={str(source.relative_to(ROOT)):sha(source)}
        if component=='contact':
            included=ROOT/'research/requests/sonic-recovered-terrain.c'
            report['sources'][str(included.relative_to(ROOT))]=sha(included)
            binary,symbols=image(source,0x02010000);exe=driver('sonic_contact_differential.c')
            stage('qualify_scanner',[exe,str(rom),binary,symbols['sonic_native_scan_distance']])
        binary,symbols=image(source,0x0203f000)
        if component=='jump':
            exe=driver('sonic_jump_differential.c')
            stage('qualify_jump',[exe,str(rom),str(checkpoint),binary,symbols['sonic_native_jump']])
        elif component=='air':
            exe=driver('sonic_air_differential.c')
            for symbol,extra in [('sonic_recovered_air_control',[]),('sonic_native_release',['release'])]:
                stage('qualify_'+symbol,[exe,str(rom),str(checkpoint),binary,symbols[symbol]]+extra)
        else:
            exe=driver('sonic_contact_actor_differential.c')
            for symbol,mode in [('sonic_native_head_clearance','head'),('sonic_native_attached_contact','contact')]:
                stage('qualify_'+mode,[exe,str(rom),str(checkpoint),binary,symbols[symbol],mode])
        report['outcome']='pass'
    except Exception as e:
        report.update(outcome='failed',error=str(e))
    finally:
        report['wall_s']=round(time.monotonic()-start,6)
        report['accounting']='stagewalltimes nested in total; no queue measurement available'
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component',choices=['jump','air','contact'],required=True)
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();r=run(args.component,args.out.resolve(),args.checkpoint.resolve())
    print(json.dumps({'outcome':r['outcome'],'wall_s':r['wall_s'],'report':str(args.out/'report.json')}))
    raise SystemExit(0 if r['outcome']=='pass' else 1)
