"""Private qualified-IR replay: fresh C/payload plus an explicitly retained host.

The fixed bounded recipe accepts three already-qualified MZM modules. It does
not lift original machine code, admit arbitrary IR edits, or reconstruct an
entire game from semantic IR. Unknown host bytes remain mixed_unknown.
"""
from __future__ import annotations
import argparse
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
SCHEMA='gameverse.private-qualified-ir-bundle/1'
LABELS=('behavior','wait','timer')
MAX_BYTES=32*1024*1024


def sha(data):return hashlib.sha256(data).hexdigest()


def read_ref(root,ref):
    relative=Path(ref['path']);path=(root/relative).resolve()
    if relative.is_absolute() or '..' in relative.parts or not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('IR bundle requires existing local artifact')
    data=path.read_bytes()
    if len(data)>MAX_BYTES or sha(data)!=ref['sha256']:raise ValueError('IR bundle artifact pin mismatch')
    return data


def write_json(path,value):
    data=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    with Path(path).open('xb') as f:f.write(data)
    return {'path':Path(path).name,'sha256':sha(data)}


def admit_ir(packet,bundle):
    """Import semantic inputs once into an already-exported private container.

    No host bytes are recaptured. Expected old emitted-C identities are read
    from the sealed producer receipt, never from the old C files themselves.
    """
    started=time.perf_counter();packet=Path(packet).resolve();bundle=Path(bundle).resolve()
    parent_bytes=(bundle/'bundle.json').read_bytes();parent=json.loads(parent_bytes)
    report_bytes=(packet/'provider-report.json').read_bytes();report=json.loads(report_bytes)
    if (parent.get('schema')!='gameverse.private-component-bundle/1' or parent.get('capability')!='rebuild_only'
            or report.get('outcome')!='pass' or report['rebuilt_sha256']!=parent['expected_artifact']['sha256']
            or tuple(t[0] for t in report['profile']['targets'])!=LABELS
            or report['profile'].get('arena_append') is not True):
        raise ValueError('qualified three-consumer appended MZM container required')
    target=bundle/'ir-inputs';target.mkdir()
    def capture(name,data):
        path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        return {'path':str(path.relative_to(bundle)),'sha256':sha(data)}
    modules=[]
    for label,package,entry in report['profile']['targets']:
        refs={}
        for name in ('l1.json','validation-adapter.json','original-proof.json','rebuilt-proof.json'):
            relative=label+'/'+name
            data=read_ref(packet,{'path':relative,'sha256':report['producer_pins'][relative]})
            refs[name]=capture(relative,data)
        x=json.loads(read_ref(bundle,refs['l1.json']));adapter=json.loads(read_ref(bundle,refs['validation-adapter.json']))
        if x.get('retained_services') or adapter.get('retained_services'):
            raise ValueError('retained native services need a separate registered IR recipe')
        for proof_name,rom in (('original-proof.json',report['original_sha256']),('rebuilt-proof.json',report['rebuilt_sha256'])):
            proof=json.loads(read_ref(bundle,refs[proof_name]))
            if (proof.get('outcome')!='pass' or proof.get('rom_sha256')!=rom or proof.get('parity',{}).get('outcome')!='pass'
                    or proof['parity'].get('vectors')!=4096 or proof['artifacts']['l1.json']['sha256']!=refs['l1.json']['sha256']
                    or proof['artifacts']['generated.c']['sha256']!=report['producer_pins'][label+'/generated.c']):
                raise ValueError('qualified L1/native receipt identity mismatch')
        modules.append({'label':label,'package':package,'entry':entry,'inputs':refs,
                        'expected_generated_c_sha256':report['producer_pins'][label+'/generated.c'],
                        'expected_bound_c_sha256':report['producer_pins'][label+'/bound.c']})
    compiler={}
    for name in ('lower.py','contract.py','domain.py'):
        compiler[name]=capture('compiler/'+name,(ROOT/'tools/behavior_ir'/name).read_bytes())
    compiler['binding_source']=capture('compiler/ir_provider.py',(ROOT/'tools/roundtrip/ir_provider.py').read_bytes())
    compiler['assembler_source']=capture('compiler/native_provider.py',(ROOT/'tools/roundtrip/native_provider.py').read_bytes())
    linker=read_ref(packet,{'path':'native.ld','sha256':report['producer_pins']['native.ld']})
    if re.search(rb'\b(INCLUDE|INPUT|GROUP|SEARCH_DIR|STARTUP|OUTPUT)\b',linker):
        raise ValueError('external linker input unsupported')
    linker_ref=capture('native.ld',linker)
    tools={}
    for name in ('cc','arm-none-eabi-ld','arm-none-eabi-objcopy','arm-none-eabi-nm'):
        path=shutil.which(name)
        if not path:raise ValueError('required existing toolchain unavailable: '+name)
        resolved=Path(path).resolve()
        tools[name]={'path':str(resolved),'sha256':sha(resolved.read_bytes()),
                     'version':subprocess.check_output([path,'--version'],text=True).splitlines()[0]}
    resource=Path(subprocess.check_output([tools['cc']['path'],'-print-resource-dir'],text=True).strip())
    header=resource/'include/stdint.h'
    tools['stdint_header']={'path':str(header.resolve()),'sha256':sha(header.read_bytes())}
    layout=json.loads(read_ref(bundle,parent['layout']))
    generated=[];mixed=[]
    for row in layout['components']:
        descriptor={k:copy.deepcopy(row[k]) for k in ('id','offset','size','sha256','artifact')}
        if row.get('providerKind')=='ir_generated':generated.append(descriptor)
        else:mixed.append(descriptor)
    denied=[str(ROOT/name) for name in ('local/roms','local/game-builds','local/whole-game-mashup','local/decomps','local/decomp','local/source-builds')]
    denied.extend([str(packet),str(bundle/'retained-c')])
    denied_files=[str(packet/label/'generated.c') for label in LABELS]+[str(packet/label/'bound.c') for label in LABELS]
    original=json.loads((packet/'manifest.json').read_text()).get('original',{}).get('path')
    if original:denied_files.append(str(Path(original).resolve()))
    recipe={'schema':SCHEMA,'capability':'qualified_ir_native_payload_replay','container':{'path':'bundle.json','sha256':sha(parent_bytes)},
            'layout':parent['layout'],'modules':modules,'compiler':compiler,'tools':tools,'linker':linker_ref,
            'recipe':'qualified-three-unit-arm7tdmi/1','limits':{'units':3,'stage_timeout_seconds':15,'max_rom_bytes':MAX_BYTES},
            'expected_payload':{'sha256':report['producer_pins']['native.bin'],'size':report['generated_native_bytes']},
            'expected_artifact':parent['expected_artifact'],'native_entries':report['native_entries'],
            'byte_accounting':{'lifted_function_symbols':report['generated_behavior_function_bytes'],
                               'mechanical_binding_symbols':report['mechanical_binding_function_bytes'],
                               'embedded_asset_bytes':report.get('embedded_asset_bytes',0),
                               'alignment_bytes':report['generated_native_bytes']-report['generated_behavior_function_bytes']-report['mechanical_binding_function_bytes']-report.get('embedded_asset_bytes',0)},
            'typed_manifest':{'executable_ir':modules,'asset_data':[], 'retained_native_code':[], 'mixed_unknown':mixed,
                              'mechanical_and_ir_placements':generated,
                              'unresolved_dependencies':['Retained host code/data/scripts are not semantically classified',
                                  'Original scheduler, allocation, lifecycle, rendering/audio and complete gameplay semantics remain native/open',
                                  'Qualification is inherited only for byte-identical payload; arbitrary IR edits require new qualification']},
            'access_policy':{'denied_roots':denied,'denied_files':denied_files,
                             'negative_controls':[str(packet/'provider-report.json'),str(packet/'behavior/generated.c'),str(bundle/'retained-c/behavior/bound.c'),
                                                  str(ROOT/'local/game-builds/__ir_bundle_denied__'),str(ROOT/'local/roms/__ir_bundle_denied__')]},
            'provenance':{'provider_report_sha256':sha(report_bytes),'paths_in_receipts':'provenance only; not executable dependencies',
                          'source_recovery':'retained qualified automatic L1; no new L0 lifting'},
            'claims':{'whole_game_ir_only':False,'complete_ir_assets_game':False,'private_original_derived_host':True,
                      'asset_classification':'No authoritative separate asset records in this three-root scope; object capture remains mixed_unknown'},
            'timing':{'import_seconds':time.perf_counter()-started,'build_seconds':None,'queue_seconds':None}}
    write_json(bundle/'ir-bundle.json',recipe)
    return recipe


def load_recipe(bundle):
    recipe=json.loads((bundle/'ir-bundle.json').read_text())
    if recipe.get('schema')!=SCHEMA or recipe.get('recipe')!='qualified-three-unit-arm7tdmi/1' or tuple(m.get('label') for m in recipe['modules'])!=LABELS:
        raise ValueError('unsupported qualified IR recipe')
    parent=json.loads(read_ref(bundle,recipe['container']))
    if parent.get('expected_artifact')!=recipe['expected_artifact']:raise ValueError('IR/container output identity mismatch')
    for module in recipe['modules']:
        for ref in module['inputs'].values():read_ref(bundle,ref)
    for ref in recipe['compiler'].values():read_ref(bundle,ref)
    read_ref(bundle,recipe['linker']);read_ref(bundle,recipe['layout'])
    for tool in recipe['tools'].values():
        if sha(Path(tool['path']).read_bytes())!=tool['sha256']:raise ValueError('pinned toolchain changed')
    return recipe


def load_asset_partition(overlay,bundle,recipe):
    """Admit a sealed separated-data layout without reopening source/ELF inputs."""
    overlay=Path(overlay).resolve()
    raw=(overlay/'asset-overlay.json').read_bytes();record=json.loads(raw)
    receipt_raw=(overlay/'asset-rebuild-receipt.json').read_bytes();receipt=json.loads(receipt_raw)
    if (record.get('schema')!='gameverse.private-bundle-assets/1' or record.get('status')!='passed'
            or record.get('bundle_manifest_sha256')!=recipe['container']['sha256']
            or receipt.get('schema')!='gameverse.private-assets-rebuild/1' or receipt.get('status')!='passed'
            or receipt.get('consumed_by_rebuild') is not True or receipt.get('asset_overlay_sha256')!=sha(raw)
            or receipt.get('artifact',{}).get('sha256')!=recipe['expected_artifact']['sha256']):
        raise ValueError('asset partition is not admitted for this exact IR container')
    layout_path=Path(receipt['layout']['path']).resolve()
    if not layout_path.is_relative_to(overlay):raise ValueError('asset partition layout escapes its root')
    layout_ref={'path':str(layout_path.relative_to(overlay)),'sha256':receipt['layout']['sha256']}
    layout=json.loads(read_ref(overlay,layout_ref))
    if layout.get('artifact',{}).get('sha256')!=recipe['expected_artifact']['sha256'] or layout['artifact']['size']!=recipe['expected_artifact']['size']:
        raise ValueError('asset partition candidate identity mismatch')
    assets=record.get('assets');rows=layout.get('components')
    if not isinstance(assets,list) or not 0<len(assets)<=32 or not isinstance(rows,list) or len(rows)>4096:
        raise ValueError('bounded explicit asset partition required')
    if len({a.get('id') for a in assets})!=len(assets):raise ValueError('duplicate asset identity')
    extents={};last=0
    for a in sorted(assets,key=lambda a:a['original_offset']):
        start,size=a['original_offset'],a['size']
        if (type(start) is not int or type(size) is not int or start<last or size<=0
                or start+size>recipe['expected_artifact']['size'] or a.get('type')!='asset_data'
                or not a.get('source_pins') or not a.get('consumers') or not a.get('elf_symbol')):
            raise ValueError('asset partition lacks exact nonoverlapping proven extents')
        extents[(start,size)]=a;last=start+size
    seen=set();cursor=0
    for row in sorted(rows,key=lambda r:r['offset']):
        if (type(row.get('offset')) is not int or type(row.get('size')) is not int
                or row['offset']!=cursor or row['size']<=0):
            raise ValueError('asset partition coverage gap or overlap')
        cursor+=row['size']
        if row.get('content_type')=='asset_data':
            key=(row['offset'],row['size']);a=extents.get(key)
            if a is None or row.get('sha256')!=a['sha256'] or key in seen:
                raise ValueError('asset partition differs from authoritative asset records')
            seen.add(key)
        elif any(row['offset']<start+size and start<cursor for start,size in extents):
            raise ValueError('asset partition left an asset hidden in mixed host bytes')
    total=sum(size for _,size in extents)
    if (seen!=set(extents) or cursor!=recipe['expected_artifact']['size'] or total!=record.get('asset_data_bytes')
            or total!=receipt.get('asset_bytes')):raise ValueError('asset partition typed byte coverage mismatch')
    final_pin=None
    final_path=overlay/'asset-final-validation.json'
    if final_path.is_file():
        final_raw=final_path.read_bytes();final=json.loads(final_raw)
        if (final.get('schema')!='gameverse.private-assets-final-validation/1' or final.get('status')!='passed'
                or final.get('consumed_overlay',{}).get('sha256')!=sha(raw)
                or final.get('consumed_layout',{}).get('sha256')!=layout_ref['sha256']
                or final.get('actual_artifact_rebuild',{}).get('sha256')!=sha(receipt_raw)):
            raise ValueError('asset strict-validation supplement differs from consumed partition')
        final_pin={'path':str(final_path),'sha256':sha(final_raw)}
    return {'root':str(overlay),'assembly_root':str(layout_path.parent),'layout':layout,
            'strict_validation':final_pin,
            'pins':{'overlay':{'path':str(overlay/'asset-overlay.json'),'sha256':sha(raw)},
                    'receipt':{'path':str(overlay/'asset-rebuild-receipt.json'),'sha256':sha(receipt_raw)},
                    'layout':{'path':str(layout_path),'sha256':layout_ref['sha256']}},
            'asset_bytes':total,'asset_ids':[a['id'] for a in assets],'assets':assets}


def install_read_guard(bundle,output,recipe,partition=None):
    """Inspectable Python-process allowlist, not a claim of OS confinement."""
    allowed=[bundle.resolve(),output.resolve(),Path(sys.base_prefix).resolve(),Path('/System'),Path('/usr'),Path('/Library/Developer'),Path('/opt/homebrew')]
    denied=[Path(p).resolve() for p in recipe['access_policy']['denied_roots']+recipe['access_policy']['denied_files']]
    if partition:allowed.append(Path(partition['root']).resolve())
    # Old emitted payload bytes and generated veneers are expected hashes only.
    layout=json.loads(read_ref(bundle,recipe['layout']))
    denied.extend((bundle/r['artifact']['path']).resolve() for r in layout['components'] if r.get('providerKind')=='ir_generated')
    denied.extend([bundle/'retained-c.json'])
    if partition:
        # The combined proof must consume separated assets/fragments, never the
        # old unsplit host component or copied old generated payload/veneers.
        denied.extend((bundle/r['artifact']['path']).resolve() for r in layout['components'])
        generated_offsets={r['offset'] for r in layout['components'] if r.get('providerKind')=='ir_generated'}
        denied.extend((Path(partition['assembly_root'])/r['artifact']['path']).resolve() for r in partition['layout']['components'] if r['offset'] in generated_offsets)
    # Canonical file denials retain the previous prefix semantics through the
    # resolved incoming path's ancestor lineage (including hypothetical children
    # beneath a denied file path). Work is O(path depth), not O(component count).
    denied_roots=frozenset(Path(p).resolve() for p in recipe['access_policy']['denied_roots'])
    denied_files=frozenset(denied)-denied_roots
    allowed_roots=frozenset(allowed)
    def guard(event,args):
        if event!='open' or isinstance(args[0],int):return
        path=Path(os.fsdecode(args[0])).resolve()
        mode=args[1];flags=args[2]
        reading=not isinstance(mode,str) or 'r' in mode or '+' in mode
        if isinstance(mode,str) and mode in ('w','wb','x','xb','a','ab'):reading=False
        if not reading:return
        lineage=(path,*path.parents)
        if not denied_files.isdisjoint(lineage) or not denied_roots.isdisjoint(lineage) or allowed_roots.isdisjoint(lineage):
            raise PermissionError('IR bundle read policy denied: '+str(path))
    sys.addaudithook(guard)
    controls=[]
    control_names=list(recipe['access_policy']['negative_controls'])
    if partition:
        for row in layout['components']:
            if row.get('providerKind')=='ir_generated' or any(row['offset']<=a['original_offset']<row['offset']+row['size'] for a in partition['assets']):
                control_names.append(str((bundle/row['artifact']['path']).resolve()))
    for name in control_names:
        try:Path(name).read_bytes()
        except PermissionError:controls.append({'path':name,'result':'denied'})
        else:raise ValueError('forbidden-read control was allowed')
    # Positive bundle/compiler reads remain admitted after guard installation.
    for ref in recipe['compiler'].values():read_ref(bundle,ref)
    return {'mechanism':'Python audit hook allowlist plus inspected fixed compiler recipe',
            'operating_system_sandbox':'unavailable: sandbox-exec sandbox_apply Operation not permitted (exit 71)',
            'compiler_subprocess_os_confined':False,'lookup':'precomputed canonical file/root sets checked against resolved path ancestor lineage','allowed_roots':[str(p) for p in allowed],
            'denied_paths':[str(p) for p in denied],'negative_controls':controls}


def import_snapshot(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module);return module


def binding_from_snapshot(source):
    tree=ast.parse(source)
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('storage_moves','binding')]
    if {n.name for n in nodes}!={'storage_moves','binding'}:raise ValueError('mechanical binding closure unavailable')
    namespace={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<pinned mechanical binding>','exec'),namespace)
    return namespace['binding']


def worker(bundle,output,asset_partition=None):
    started=time.perf_counter();bundle=Path(bundle).resolve();output=Path(output).resolve()
    recipe=load_recipe(bundle);stages=[]
    partition=load_asset_partition(asset_partition,bundle,recipe) if asset_partition else None
    receipt={'schema':'gameverse.qualified-ir-replay-result/1','status':'failed','queue_seconds':None,'stages':stages,
             'native_qualification_rerun':False,'new_l0_lifting':False,'model_calls':0,
             'scope':'Three qualified unchanged IR modules plus retained mixed native host; not whole-game IR reconstruction'}
    def run(name,command):
        begin=time.perf_counter();p=subprocess.run(command,cwd=output,capture_output=True,text=True,timeout=15)
        stages.append({'name':name,'seconds':time.perf_counter()-begin,'outcome':'pass' if p.returncode==0 else 'fail','command':command})
        (output/(name+'.stdout')).write_text(p.stdout);(output/(name+'.stderr')).write_text(p.stderr)
        p.check_returncode();return p.stdout
    try:
        receipt['input_recipe_sha256']=sha((bundle/'ir-bundle.json').read_bytes())
        receipt['read_policy']=install_read_guard(bundle,output,recipe,partition)
        # Snapshot compiler modules are the only semantic lowering dependency.
        compiler=bundle/recipe['compiler']['lower.py']['path'];sys.path.insert(0,str(compiler.parent))
        lower=import_snapshot('qualified_bundle_lower',compiler).lower
        binding=binding_from_snapshot(read_ref(bundle,recipe['compiler']['binding_source']).decode())
        objects=[];module_receipts=[]
        for module in recipe['modules']:
            begin=time.perf_counter();label=module['label'];x=json.loads(read_ref(bundle,module['inputs']['l1.json']));adapter=json.loads(read_ref(bundle,module['inputs']['validation-adapter.json']))
            code=lower(x)
            if sha(code.encode())!=module['expected_generated_c_sha256']:raise ValueError('fresh lowered C differs from qualified identity')
            for line in code.splitlines():
                if re.match(r'\s*#\s*(include|include_next|import)',line) and not re.fullmatch(r'\s*#\s*include\s*<stdint\.h>\s*',line):
                    raise ValueError('fresh C external include closure unsupported')
            native=code.replace('LiftedState','State_'+label).replace('behavior_0','lifted_'+label)
            native=re.sub(r'(?m)^(void|uint(?:8|16|32|64)_t) (lifted_\w+\()',r'__attribute__((noinline)) \1 \2',native)+binding(adapter,label)
            if sha(native.encode())!=module['expected_bound_c_sha256']:raise ValueError('fresh mechanical binding differs from qualified identity')
            folder=output/label;folder.mkdir();(folder/'generated.c').write_text(code);(folder/'bound.c').write_text(native)
            module_receipts.append({'label':label,'l1_sha256':module['inputs']['l1.json']['sha256'],'adapter_sha256':module['inputs']['validation-adapter.json']['sha256'],
                                    'generated_c_sha256':sha(code.encode()),'bound_c_sha256':sha(native.encode()),'lower_and_bind_seconds':time.perf_counter()-begin})
            obj=label+'/bound.o';run('compile-'+label,[recipe['tools']['cc']['path'],'-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fno-builtin','-Os','-c',label+'/bound.c','-o',obj]);objects.append(obj)
        (output/'native.ld').write_bytes(read_ref(bundle,recipe['linker']))
        run('link',[recipe['tools']['arm-none-eabi-ld']['path'],'-T','native.ld','-e','native_behavior',*objects,'-o','native.elf'])
        symbols=run('symbols',[recipe['tools']['arm-none-eabi-nm']['path'],'-S','native.elf'])
        entries={p[3]:int(p[0],16)&~1 for line in symbols.splitlines() if len(p:=line.split())==4}
        run('objcopy',[recipe['tools']['arm-none-eabi-objcopy']['path'],'-O','binary','native.elf','native.bin'])
        payload=(output/'native.bin').read_bytes()
        if sha(payload)!=recipe['expected_payload']['sha256'] or len(payload)!=recipe['expected_payload']['size']:raise ValueError('IR-native payload changed; native qualification closure missing')
        if any(entries.get(k)!=v for k,v in recipe['native_entries'].items()):raise ValueError('fresh native entry layout differs from qualified identity')
        original_layout=json.loads(read_ref(bundle,recipe['layout']))
        layout=copy.deepcopy(partition['layout']) if partition else original_layout
        input_root=Path(partition['assembly_root']) if partition else bundle
        parts=output/'components';parts.mkdir()
        if partition:(output/'assets').mkdir()
        payload_offsets={r['offset'] for r in original_layout['components'] if r.get('role')=='generated-output'}
        hooks={int(m['entry'],16)-0x08000000:struct.pack('<HHI',0x4b00,0x4718,entries['native_'+m['label']]|1) for m in recipe['modules']}
        copied=0;asset_copied=0;typed_rows=[]
        for index,row in enumerate(layout['components']):
            if row['offset'] in payload_offsets:data=payload
            elif row['offset'] in hooks:data=hooks[row['offset']]
            elif row.get('providerKind')=='ir_generated':raise ValueError('missing IR-generated placement closure')
            else:
                data=read_ref(input_root,row['artifact'])
                if row.get('content_type')=='asset_data':asset_copied+=len(data)
                else:copied+=len(data)
            if len(data)!=row['size'] or sha(data)!=row['sha256']:raise ValueError('fresh payload/hook does not match admitted placement')
            relative=('assets/' if row.get('content_type')=='asset_data' else 'components/')+str(index)+'.bin'
            (output/relative).write_bytes(data);row['artifact']={'path':relative,'sha256':sha(data)}
            typed_rows.append({'id':row['id'],'offset':row['offset'],'size':len(data),'sha256':sha(data),'artifact':row['artifact'],
                'type':'executable_ir_and_mechanical_binding' if row['offset'] in payload_offsets or row['offset'] in hooks else 'asset_data' if row.get('content_type')=='asset_data' else 'mixed_unknown'})
        if partition and asset_copied!=partition['asset_bytes']:raise ValueError('combined IR replay did not consume every separated asset byte')
        write_json(output/'layout.json',layout)
        assembler=import_snapshot('qualified_bundle_assembler',bundle/recipe['compiler']['assembler_source']['path'])
        assembled=assembler.assemble_native_layout(output/'layout.json',output/'rebuilt.gba')
        if assembled['artifact']['sha256']!=recipe['expected_artifact']['sha256']:raise ValueError('artifact-only rebuilt game identity changed')
        receipt.update(status='passed',modules=module_receipts,artifact=assembled['artifact'],payload={'path':str(output/'native.bin'),'sha256':sha(payload),'size':len(payload)},
                       inherited_native_qualification='Exact unchanged C/payload/layout identities match retained qualified receipts; no new native run',
                       byte_accounting=dict(recipe['byte_accounting'],fresh_payload_bytes=len(payload),fresh_entry_veneer_bytes=sum(map(len,hooks.values())),copied_mixed_host_bytes=copied),
                       original_rom_read=False,old_generated_c_read=False,original_source_read=False,whole_game_ir_only=False,
                       toolchain=recipe['tools'],machine=platform.platform())
        if partition:
            receipt['asset_partition']={k:v for k,v in partition.items() if k in ('pins','asset_bytes','asset_ids','strict_validation')}
            receipt['byte_accounting']['separated_asset_data_bytes']=asset_copied
            receipt['typed_manifest']={'placements':typed_rows,'known_asset_source_records':partition['assets'],
                'unresolved_dependencies':recipe['typed_manifest']['unresolved_dependencies'],
                'whole_game_ir_only':False,'complete_ir_assets_game':False}
            write_json(output/'typed-manifest.json',receipt['typed_manifest'])
    except BaseException as error:
        receipt.update(error=str(error),error_type=type(error).__name__);raise
    finally:
        receipt['total_seconds']=time.perf_counter()-started;receipt['stages_nested_in_total']=True
        write_json(output/'receipt.json',receipt)
    return receipt


def rebuild_ir(bundle,output,asset_partition=None):
    bundle=Path(bundle).resolve();output=Path(output).resolve()
    if output.is_relative_to(bundle) or asset_partition and output.is_relative_to(Path(asset_partition).resolve()):raise ValueError('IR rebuild output must be isolated from input bundle/asset partition')
    output.mkdir(parents=True,exist_ok=False)
    harness=output/'audit-harness.py';harness.write_bytes(Path(__file__).read_bytes())
    began=time.perf_counter();command=[sys.executable,'-B',str(harness),'worker','--bundle',str(bundle),'--output',str(output)]
    if asset_partition:command.extend(['--asset-partition',str(Path(asset_partition).resolve())])
    process=subprocess.run(command,capture_output=True,text=True,timeout=60,env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'))
    (output/'worker.stdout').write_text(process.stdout);(output/'worker.stderr').write_text(process.stderr)
    parent={'schema':'gameverse.qualified-ir-isolation/1','command':command,'harness_sha256':sha(harness.read_bytes()),'returncode':process.returncode,
            'wall_seconds':time.perf_counter()-began,'subprocess':'fresh Python interpreter; retained audit-harness source','os_hermetic':False}
    write_json(output/'isolation-proof.json',parent)
    if process.returncode:raise ValueError('isolated IR rebuild failed; retained receipt/stderr')
    return json.loads((output/'receipt.json').read_text())


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=('admit','rebuild','worker'))
    parser.add_argument('--bundle',type=Path,required=True);parser.add_argument('--packet',type=Path);parser.add_argument('--output',type=Path)
    parser.add_argument('--asset-partition',type=Path,help='Admitted separated-asset overlay directory; consumes derived layout asset files')
    a=parser.parse_args(argv)
    result=admit_ir(a.packet,a.bundle) if a.command=='admit' else rebuild_ir(a.bundle,a.output,a.asset_partition) if a.command=='rebuild' else worker(a.bundle,a.output,a.asset_partition)
    print(json.dumps({'status':result.get('status','admitted'),'schema':result['schema'],'artifact':result.get('artifact'),'capability':result.get('capability')},sort_keys=True))


if __name__=='__main__':main()
