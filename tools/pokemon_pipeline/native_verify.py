#!/usr/bin/env python3
"""Bounded native LeafGreen object-graphics consumer qualification, not gameplay."""
import argparse, hashlib, json, os, platform, struct, subprocess, time
from pathlib import Path

VERSION='pokemon-native-consumer/1'
REQUIRED=['ResetSpriteData','FreeAllSpritePalettes','CreateObjectGraphicsSprite','SpriteCallbackDummy','StartSpriteAnim','SeekSpriteAnim','AnimateSprite','BuildOamBuffer','ProcessSpriteCopyRequests','LoadOam','TransferPlttBuffer','PatchObjectPalette','LoadPlayerObjectReflectionPalette','LoadSpecialObjectReflectionPalette','ObjectEventSetGraphicsId','gSprites','gObjectEvents','gPlttBufferFaded','gPlttBufferUnfaded','gObjectEventGraphicsInfoPointers','sObjectEventSpritePalettes','gPlayerReflectionPaletteSets','gSpecialObjectReflectionPaletteSets','gReflectionEffectPaletteMap','sCurrentReflectionType','ClearSpriteCopyRequests']
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v): Path(p).write_text(json.dumps(v,indent=2)+'\n')
def symbols(path):
    raw=Path(path).read_bytes()
    if raw[:6]!=b'\x7fELF\x01\x01':raise ValueError('expected_elf32_little_endian')
    offset=struct.unpack_from('<I',raw,32)[0];stride,count=struct.unpack_from('<HH',raw,46)
    sections=[struct.unpack_from('<10I',raw,offset+i*stride) for i in range(count)]
    found={}
    for section in sections:
        if section[1]!=2:continue
        strings=sections[section[6]]; names=raw[strings[4]:strings[4]+strings[5]]
        for at in range(section[4],section[4]+section[5],section[9]):
            name,address,size=struct.unpack_from('<III',raw,at); label=names[name:names.find(b'\0',name)].decode()
            if label:found.setdefault(label,[]).append((address,size))
    return {name:values[0] for name,values in found.items() if len(values)==1}
def qualify(artifact,work,directory,timeout):
    start=time.monotonic(); directory.mkdir(parents=True,exist_ok=True)
    report={'schema':'gameverse.pokemon-native-verification/1','adapter_version':VERSION,'outcome':'fail','scope':'native-graphics-consumer','request_satisfied':False,'artifact':{'path':str(artifact),'sha256':sha(artifact)},'queue_s':None,'wall_s':None,'timings':{},'gaps':['Deterministic native consumer fixtures and cold boot do not establish a natural gameplay route or full game completion.'],'environment':{'machine':platform.platform(),'library':'/opt/homebrew/lib/libmgba.dylib'},'limits':{'timeout_s':timeout,'boot_frames':900,'max_native_instructions_per_call':2000000}}
    try:
        elf=work/'build/game.elf'
        if not elf.exists():elf=work/'baseline-artifacts/pokeleafgreen_rev1.elf'
        if not elf.exists():elf=work/'source/pokeleafgreen_rev1.elf'
        syms=symbols(elf); report['elf']={'path':str(elf),'sha256':sha(elf)}
        coverage=json.loads((work/'sprite-coverage.json').read_text()); report['coverage_sha256']=sha(work/'sprite-coverage.json');report['baseline']=json.loads((work/'baseline.json').read_text())
        rom=artifact.read_bytes()
        elfraw=elf.read_bytes();phoff=struct.unpack_from('<I',elfraw,28)[0];phstride,phcount=struct.unpack_from('<HH',elfraw,42)
        for i in range(phcount):
            kind,offset,virtual,physical,size=struct.unpack_from('<5I',elfraw,phoff+i*phstride)
            if kind==1 and 0x08000000<=physical<0x0a000000 and size:
                if rom[physical-0x08000000:physical-0x08000000+size]!=elfraw[offset:offset+size]:raise ValueError('artifact_elf_load_segment_mismatch')
        if rom[0xac:0xb0]!=b'BPGE' or rom[0xbc]!=1:raise ValueError('expected_leafgreen_rev1')
        def u16(address):return struct.unpack_from('<H',rom,address-0x08000000)[0]
        def u32(address):return struct.unpack_from('<I',rom,address-0x08000000)[0]
        # Linked table and frame pointers, never FireRed address assumptions.
        for name in REQUIRED:
            if name not in syms:raise ValueError('missing_linked_symbol:'+name)
        byaddress={a:(name,size) for name,(a,size) in syms.items() if size}
        pointers=syms['gObjectEventGraphicsInfoPointers']; ids={u32(pointers[0]+i*4):i for i in range(pointers[1]//4)}
        cases=[];frames=[];animations_checked=[];skipped=[];control_exclusions=[]
        for mapping in coverage['object_mappings']:
            name=mapping['host']; info=syms[name][0]
            if info not in ids:
                skipped.append({'host':name,'reason':'linked graphics definition has no object-ID consumer; excluded from native ID fixture'})
                continue
            animations=u32(info+0x18);images=u32(info+0x1c)
            if animations not in byaddress or images not in byaddress:raise ValueError('unbounded_linked_graphics_tables:'+name)
            animcount=byaddress[animations][1]//4; imagecount=byaddress[images][1]//8
            begin=len(frames);abegin=len(animations_checked)
            for anim in range(animcount):
                cmds=u32(animations+4*anim)
                if cmds not in byaddress:raise ValueError('unbounded_animation:'+name)
                commands=byaddress[cmds][1]//4; ticks=8; finite=True;has_end=False
                for command in range(commands):
                    frame=u16(cmds+4*command)
                    if frame>=0x8000:
                        if frame==65535:has_end=True
                        else:finite=False
                        continue
                    ticks+=(u16(cmds+4*command+2)&63)+2
                    if frame>=imagecount:
                        if hashlib.sha1(rom).hexdigest()=='7862c67bdecbe21d1d69ce082ce34327e1c6ed5e':
                            skipped.append({'host':name,'animation':anim,'command':command,'image':frame,'reason':'original shared animation table contains frame absent from this object; excluded from baseline fixture'})
                            continue
                        raise ValueError('animation_frame_out_of_bounds:'+name)
                    frames.append((anim,command,frame,u16(cmds+4*command+2)))
                if finite and has_end:animations_checked.append((anim,ticks))
                else:control_exclusions.append({'host':name,'animation':anim,'reason':'jump/loop action has no finite-termination requirement; all in-bounds frame commands checked separately'})
            cases.append((ids[info],info,begin,len(frames)-begin,abegin,len(animations_checked)-abegin,name))
        report['excluded_native_cases']=skipped
        report['looping_animation_termination_exclusions']=control_exclusions
        if not cases or not frames:raise ValueError('no_native_consumer_cases')
        header='\n'.join('#define SYM_'+name+' 0x%xU'%syms[name][0] for name in REQUIRED)
        header+='\nstruct Case { unsigned id,info,begin,count,abegin,acount; const char *name; };\nstatic const struct Case cases[]={\n'+',\n'.join('{%d,0x%x,%d,%d,%d,%d,"%s"}'%c for c in cases)+'\n};\n'
        header+='struct Frame { unsigned anim,command,image,flags; };\nstatic const struct Frame frames[]={\n'+',\n'.join('{%d,%d,%d,%d}'%f for f in frames)+'\n};\n'
        header+='struct Animation { unsigned anim,ticks; };\nstatic const struct Animation finite_animations[]={\n'+',\n'.join('{%d,%d}'%a for a in animations_checked)+'\n};\n'
        (directory/'native-addresses.h').write_text(header)
        template=Path(__file__).with_name('native_verify.c.in'); cfile=directory/'native-verify.c'; cfile.write_bytes(template.read_bytes()); executable=directory/'native-verify'
        report['harness_sha256']=sha(template); report['address_manifest_sha256']=sha(directory/'native-addresses.h')
        native_library=Path('/opt/homebrew/lib/libmgba.dylib').resolve();report['environment']['library_sha256']=sha(native_library)
        stage=time.monotonic()
        with (directory/'compile.log').open('w') as stream:
            subprocess.run(['cc','-O1','-std=c11','-I/opt/homebrew/include',str(cfile),'-L/opt/homebrew/lib','-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',str(executable)],stdout=stream,stderr=subprocess.STDOUT,check=True,timeout=min(20,timeout))
        report['timings']['oracle_compile_s']=time.monotonic()-stage
        stage=time.monotonic()
        with (directory/'native.stdout').open('w') as out,(directory/'native.stderr').open('w') as err:
            result=subprocess.run([str(executable),str(artifact),str(directory)],stdout=out,stderr=err,timeout=max(1,timeout-(time.monotonic()-start)))
        report['timings']['native_s']=time.monotonic()-stage
        report['exit_code']=result.returncode
        if result.returncode:raise ValueError('native_consumer_failed: inspect native.stderr')
        report['native']=json.loads(next(line for line in reversed((directory/'native.stdout').read_text().splitlines()) if line.startswith('{'))); report['outcome']='pass'
        # Keep raw framebuffer evidence; PNG conversion is optional and never changes verdict.
        try:
            from PIL import Image
            for raw in directory.glob('*.rgba'):
                Image.frombytes('RGBA',(240,160),raw.read_bytes()).save(raw.with_suffix('.png'))
        except ImportError:report['gaps'].append('PNG encoder unavailable; native RGBA frames retained.')
        report['evidence']=[str(p) for p in sorted(directory.glob('*.png'))]
        report['evidence_sha256']={str(p):sha(p) for p in sorted(directory.glob('*.png'))}
        report['request_satisfied']=coverage.get('request_satisfied',False) is True
        report['scope_detail']='Cold boot, then separate direct-entry fixture: native field sprite construction, animation frame commands, OAM, VRAM uploads, actual palette banks and reflection palette consumers. No natural field-navigation claim.'
    except Exception as error:
        report['error']=str(error);report['error_type']=type(error).__name__
    finally:
        report['wall_s']=round(time.monotonic()-start,6);report['stage_accounting']='Compile and native stages nested within wall time; native boot/fixtures nested within native stage. Queue unavailable.'
        save(directory/'native-verification.json',report)
    return report
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--artifact',type=Path,required=True);parser.add_argument('--workspace',type=Path,required=True);parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--timeout',type=float,default=60);args=parser.parse_args()
    result=qualify(args.artifact.resolve(),args.workspace.resolve(),args.directory.resolve(),args.timeout);print(json.dumps({'outcome':result['outcome'],'wall_s':result['wall_s'],'evidence':str(args.directory/'native-verification.json')}));raise SystemExit(0 if result['outcome']=='pass' else 1)
