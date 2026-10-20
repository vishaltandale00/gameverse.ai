"""Bounded source-raw VM proof, generated L1, and fail-closed regressions."""
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import platform
import ctypes
import tempfile
import subprocess
import time
from lift import Unsupported
from lower import lower
from vm_ir import lower_vm, FORMAT, _FrameLifter


def verify_input_snapshots():
    """Synthetic compiler regression only; no game/source evidence is claimed."""
    v=[dict(id='v0',size=4,space='register',offset='64',constant=False,input=True,register='r8'),dict(id='v1',size=4,space='register',offset='68',constant=False,input=False,register='r9'),dict(id='v2',size=4,space='register',offset='64',constant=False,input=False,register='r8'),dict(id='v3',size=4,space='const',offset='1',constant=True,input=False)]
    ops=[dict(id='op0',pc='08000000',opcode='COPY',output='v1',inputs=['v0']),dict(id='op1',pc='08000002',opcode='INT_ADD',output='v2',inputs=['v0','v3']),dict(id='op2',pc='08000004',opcode='RETURN',inputs=[])]
    l0=dict(format='gameverse.l0.highfunction/0.2',entry='08000000',varnodes=v,blocks=[dict(id=0,predecessors=[],successors=[],ops=ops)],jump_tables=[])
    l1,_=_FrameLifter(l0,b'',dict(r8={'field':'vm_r8'},r9={'field':'vm_r9'}),dict(r8='v2',r9='v1')).build()
    with tempfile.TemporaryDirectory(prefix='vm-snapshot-')as directory:
        path=Path(directory);(path/'proof.c').write_text(lower(l1))
        subprocess.run(['cc','-shared','-fPIC',str(path/'proof.c'),'-o',str(path/'proof.dylib')],check=True,capture_output=True,timeout=10)
        class State(ctypes.Structure):_fields_=[('vm_r8',ctypes.c_uint32),('vm_r9',ctypes.c_uint32)]
        function=ctypes.CDLL(str(path/'proof.dylib')).behavior_0;function.argtypes=[ctypes.POINTER(State)];function.restype=None
        for value in [0,7,0x7fffffff,0xffffffff]:
            state=State(value,99);function(ctypes.byref(state))
            if (state.vm_r8,state.vm_r9)!=((value+1)&0xffffffff,value):raise AssertionError('register entry snapshot was overwritten before another liveout read')
    return 4


def verify(raw,rom,out,entry='08134918',stop='0813492c'):
    started=time.perf_counter();out=Path(out);out.mkdir(parents=True,exist_ok=True)
    source=rom.read_bytes();working=deepcopy(raw)
    if working.get('format') != FORMAT:raise Unsupported('raw exporter format mismatch')
    working['excerpt_provenance']=dict(raw_sha256=hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest(),source_entry=raw['entry'],source_end_exclusive=raw['end_exclusive'])
    working['entry']=entry
    working['end_exclusive']=stop
    working['source_span_sha256']=hashlib.sha256(source[int(entry,16)-0x08000000:int(stop,16)-0x08000000]).hexdigest()
    if working.get('rom_sha256') != hashlib.sha256(source).hexdigest():raise Unsupported('raw exporter ROM mismatch')
    working['instructions']=[i for i in raw['instructions']if int(entry,16)<=int(i['pc'],16)<int(stop,16)]
    registers={f'r{i}':0 for i in range(13)}
    registers.update(r4=0x03007120,r5=0x03007000,r6=0x03007100,r7=0x03007200,r8={'field':'vm_r8'})
    contract=dict(registers=dict(registers,lr=0x08000001,CY=0,NG=0,ZR=0,OV=0),liveouts=['r8'],evidence=['Exact instruction raw p-code and ROM bytes for the closed VM transaction'])
    l1,adapter=lower_vm(working,source,contract)
    adapter['native_abi']=dict(schema='gameverse.native-abi/0.1',mode='thumb',rom_sha256=working['rom_sha256'],registers=registers,preserve=['r4','r5','r6','r7','r9','r10','r11'],clobbers=[],liveouts=[dict(register='r8',field='vm_r8')],expected_exit={},instruction_cap=128,exit=dict(kind='incoming_lr',dispatches=[f'{int(stop,16)-2:08x}']))
    rejected=[]
    def reject(label,changed,bindings=contract):
        try:lower_vm(changed,source,bindings)
        except (Unsupported,ValueError):rejected.append(label)
        else:raise AssertionError('VM unsound admission '+label)
    bad=deepcopy(working);bad['format']='gameverse.l0.highfunction/0.2';reject('HighFunction missing VM liveouts',bad)
    bad=deepcopy(working);bad['rom_sha256']='0'*64;reject('wrong source ROM',bad)
    bad=deepcopy(working);bad['instructions'][0]['bytes']='0000';reject('wrong instruction bytes',bad)
    bad=deepcopy(working);bad['instructions']=bad['instructions'][:-1];reject('missing source return',bad)
    bad=deepcopy(working);bad['instructions'][0]['pcode'][0]['opcode']='CALLIND';reject('uncontracted continuation control',bad)
    missing=deepcopy(contract);del missing['registers']['r4'];reject('undeclared register-frame port',working,missing)
    missing=deepcopy(contract);missing['liveouts']=['r12'];reject('unrepresented liveout',working,missing)
    bad=deepcopy(working);bad['instructions'][0]['pcode'][0]['output']=dict(space='register',offset='48',size=2,constant=False,register='r4');reject('overlapping register storage lanes',bad)
    snapshot_cases=verify_input_snapshots()
    (out/'source-raw.json').write_text(json.dumps(working,indent=2)+'\n')
    (out/'l1.json').write_text(json.dumps(l1,indent=2)+'\n')
    (out/'validation-adapter.json').write_text(json.dumps(adapter,indent=2)+'\n')
    (out/'generated.c').write_text(lower(l1))
    result=dict(schema='gameverse.vm-ir.verification/0.1',outcome='passed',source_commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),machine=platform.platform(),rom_sha256=working['rom_sha256'],boundary=[entry,stop],raw_pcode_sha256=adapter['raw_pcode_sha256'],negative_checks=rejected,synthetic_snapshot_regression_cases=snapshot_cases,wall_s=time.perf_counter()-started,native_parity='separate qualification required')
    (out/'vm-proof.json').write_text(json.dumps(result,indent=2)+'\n')
    return result



def verify_control(raw_regions,rom,contract,out):
    """Source-driven bounded control/lane/unknown-effect rejection campaign."""
    from vm_ir import lower_vm_control
    started=time.perf_counter();source=rom.read_bytes();out=Path(out);out.mkdir(parents=True,exist_ok=True)
    l1,adapter=lower_vm_control(raw_regions,source,contract)
    rejected=[]
    def reject(label,regions=raw_regions,boundary=contract):
        try:lower_vm_control(regions,source,boundary)
        except (Unsupported,ValueError):rejected.append(label)
        else:raise AssertionError('VM control unsound admission '+label)
    bad=deepcopy(raw_regions);bad[0]['rom_sha256']='0'*64;reject('wrong raw source ROM',bad)
    bad=deepcopy(raw_regions);bad[0]['source_span_sha256']='0'*64;reject('wrong raw source span',bad)
    # The actual source root invokes at least one independently pinned helper.
    helpers=[raw for raw in raw_regions if raw['entry']!=contract['entry']]
    if helpers:reject('missing direct source callee',[raw for raw in raw_regions if raw['entry']==contract['entry']])
    bad=deepcopy(contract);bad['exit_dispatches']=[];reject('missing source continuation endpoint',boundary=bad)
    bad=deepcopy(contract);bad['memory_constants']=[dict(item, value=0)if item['role']=='continuation'else item for item in bad['memory_constants']];reject('unproven continuation word',boundary=bad)
    bad=deepcopy(contract);bad['clobbers']=[];reject('unclassified persistent source writes',boundary=bad)
    bad=deepcopy(contract);bad['registers']['sp']=0x03007e00;reject('unmodelled native frame storage',boundary=bad)
    bad=deepcopy(contract);bad['memory_constants'].append(dict(bad['memory_constants'][0]));reject('overlapping entry memory facts',boundary=bad)
    bad=deepcopy(raw_regions)
    first=next(raw for raw in bad if raw['entry']==contract['entry'])['instructions'][0]
    first['pcode'][0]['opcode']='FLOAT_ADD';reject('unknown raw effect',bad)
    bad=deepcopy(raw_regions);bad[0]['entry']='00000000';bad[0]['end_exclusive']='00000002';bad[0]['source_span_sha256']=hashlib.sha256(b'').hexdigest();reject('raw source span outside ROM',bad)
    bad=deepcopy(raw_regions);bad[0]['instructions'][0]['pcode']=[];reject('empty raw instruction semantics',bad)
    bad=deepcopy(raw_regions);bad[0]['instructions'][0]['bytes']='';reject('empty raw instruction bytes',bad)
    if 'r9'in contract['registers']and isinstance(contract['registers']['r9'],dict):
        bad=deepcopy(contract);bad['registers']['r9']=dict(bad['registers']['r8']);reject('aliased register input ports',boundary=bad)
    bad=deepcopy(contract);bad['registers']['r8']={'field':'field_0'};reject('register input shadows memory state',boundary=bad)
    bad=deepcopy(raw_regions)
    store_instruction=next(instruction for region in bad for instruction in region['instructions']if any(operation['opcode']=='STORE'for operation in instruction['pcode']))
    store_instruction['pcode'].append(dict(opcode='STORE',output=None,inputs=[dict(space='const',offset='417',size=8,constant=True),dict(space='const',offset=str(0x0300f000),size=4,constant=True),dict(space='const',offset='0',size=4,constant=True)]))
    reject('mirrored continuation-memory alias',bad)
    codec=adapter.get('continuation_tokens',[])
    if codec:
        def code_address(value):
            if isinstance(value,list):return any(code_address(child)for child in value)
            if isinstance(value,dict):return(value.get('op')=='const'and 0x08000000<=value.get('value',0)<0x0a000000)or any(code_address(child)for child in value.values())
            return False
        if code_address(l1['body']):raise AssertionError('native code address escaped portable continuation codec')
    bundle=dict(format='gameverse.l0.raw-pcode-bundle/0.1',entry=contract['entry'],rom_sha256=hashlib.sha256(source).hexdigest(),regions=raw_regions,control_contract=contract)
    for name,value in [('l0.json',bundle),('l1.json',l1),('validation-adapter.json',adapter),('control-contract.json',contract)]:
        (out/name).write_text(json.dumps(value,indent=2)+'\n')
    (out/'generated.c').write_text(lower(l1))
    report=dict(schema='gameverse.vm-control.verification/0.1',outcome='passed',source_commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),machine=platform.platform(),rom_sha256=hashlib.sha256(source).hexdigest(),entry=contract['entry'],raw_source_sha256s=adapter['raw_source_sha256s'],normalized_l0_sha256=adapter['normalized_l0_sha256'],control_contract_sha256=hashlib.sha256(json.dumps(contract,sort_keys=True).encode()).hexdigest(),compiler_sha256=hashlib.sha256(Path(__file__).with_name('vm_ir.py').read_bytes()).hexdigest(),negative_checks=rejected,continuation_token_fields=[item['field']for item in codec],wall_s=time.perf_counter()-started,queue_s=None,native_parity='separate qualification required')
    (out/'control-proof.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def verify_conditional_simplification(out,control_flow=None):
    """Compiler-only branch fixtures, distinct from actual game/native evidence."""
    from vm_ir import lower_vm_control
    started=time.perf_counter();out=Path(out);out.mkdir(parents=True,exist_ok=True)
    base=0x08000020
    def reg(name):return dict(space='register',offset=str({'r0':32,'r1':36,'r2':40,'ZR':97,'lr':88}[name]),size=1 if name=='ZR'else 4,constant=False,register=name)
    def number(value):return dict(space='const',offset=str(value),size=4,constant=True)
    def operation(op,inputs,output=None):return dict(opcode=op,inputs=inputs,output=output)
    def branch(target):return dict(space='ram',offset=str(target),size=4,constant=False)
    def fixture(stale=False):
        rows=[]
        def row(pc,word,*ops):rows.append(dict(pc=f'{pc:08x}',bytes=word.to_bytes(2,'little').hex(),TMode='1',pcode=list(ops)))
        row(base,0x2800,operation('INT_EQUAL',[reg('r0'),number(0)],reg('ZR')))
        row(base+2,0xd001,operation('CBRANCH',[branch(base+8),reg('ZR')]))
        destination='r2'if stale else'r1'
        row(base+4,0x2201 if stale else 0x210b,operation('COPY',[number(1 if stale else 11)],reg(destination)))
        row(base+6,0xe001,operation('BRANCH',[branch(base+12)]))
        row(base+8,0x2200 if stale else 0x2116,operation('COPY',[number(0 if stale else 22)],reg(destination)))
        row(base+10,0xe7ff,operation('BRANCH',[branch(base+12)]))
        end=base+12
        if stale:
            row(end,0x2a00,operation('INT_EQUAL',[reg('r2'),number(0)],reg('ZR')))
            row(end+2,0xd001,operation('CBRANCH',[branch(end+8),reg('ZR')]))
            row(end+4,0x210b,operation('COPY',[number(11)],reg('r1')))
            row(end+6,0xe001,operation('BRANCH',[branch(end+12)]))
            row(end+8,0x2116,operation('COPY',[number(22)],reg('r1')))
            row(end+10,0xe7ff,operation('BRANCH',[branch(end+12)]))
            end+=12
        row(end,0x4770,operation('RETURN',[reg('lr')]))
        rom=bytes(32)+b''.join(bytes.fromhex(row['bytes'])for row in rows)
        raw=dict(format=FORMAT,entry=f'{base:08x}',end_exclusive=f'{end+2:08x}',rom_sha256=hashlib.sha256(rom).hexdigest(),source_span_sha256=hashlib.sha256(rom[32:]).hexdigest(),language='ARM:LE:32:v4t',instructions=rows)
        contract=dict(entry=raw['entry'],registers=dict(r0={'field':'selector'},r1=0,r2=0,r5=0x03007000,lr=0x08000001),liveouts=['r1'],clobbers=[],memory_constants=[],exit_dispatches=[f'{end:08x}'],evidence=['Synthetic primitive branch fixture: not game source/native qualification'])
        if control_flow is not None:contract['control_flow']=control_flow
        return raw,rom,contract
    cases=[]
    for label,input_value,selectors,wanted in [('constant_true',0,[0],[22]),('constant_false',1,[0],[11]),('unknown_keeps_both',{'field':'selector'},[0,1,0xffffffff],[22,11,11])]:
        raw,rom,contract=fixture();contract['registers']['r0']=input_value
        l1,adapter=lower_vm_control([raw],rom,contract)
        proofs=[proof for assumption in adapter['assumptions']if assumption['kind']=='exact_entry_context_conditional_edges'for proof in assumption['conditions']]
        if label=='unknown_keeps_both'and proofs:raise AssertionError('unknown selector branch was pruned')
        if label!='unknown_keeps_both'and(len(proofs)!=1 or bool(proofs[0]['value'])!=(label=='constant_true')):raise AssertionError('constant branch proof missing or reversed')
        with tempfile.TemporaryDirectory(prefix='vm-conditional-')as directory:
            path=Path(directory);(path/'proof.c').write_text(lower(l1))
            subprocess.run(['cc','-shared','-fPIC',str(path/'proof.c'),'-o',str(path/'proof.dylib')],check=True,capture_output=True,timeout=10)
            types={'u8':ctypes.c_uint8,'u16':ctypes.c_uint16,'u32':ctypes.c_uint32,'u64':ctypes.c_uint64}
            class State(ctypes.Structure):_fields_=[(field['name'],types[field['storage_type']])for field in l1['state']]
            function=ctypes.CDLL(str(path/'proof.dylib')).behavior_0;function.argtypes=[ctypes.POINTER(State)];function.restype=None
            for selector,expected in zip(selectors,wanted):
                state=State();state.vm_r1=99
                if isinstance(input_value,dict):state.selector=selector
                function(ctypes.byref(state))
                if state.vm_r1!=expected:raise AssertionError('conditional behavior mismatch '+label)
        cases.append(dict(case=label,host_vectors=len(selectors),pruned_edges=len(proofs),outcome='passed'))
    raw,rom,contract=fixture(True)
    try:lower_vm_control([raw],rom,contract)
    except Unsupported as error:
        if 'conditional fact changed after incoming state merge'not in str(error):raise
        cases.append(dict(case='mixed_predecessors_invalidate_stale_constant',outcome='rejected',reason=str(error)))
    else:raise AssertionError('stale first-predecessor branch proof admitted')
    result=dict(schema='gameverse.vm-conditional.verification/0.1',outcome='passed',scope='Synthetic compiler-only source control fixtures; actual FFVI proof is separate',control_flow=control_flow or 'structured_default',cases=cases,wall_s=time.perf_counter()-started,compiler_sha256=hashlib.sha256(Path(__file__).with_name('vm_ir.py').read_bytes()).hexdigest())
    (out/'conditional-proof.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('raw',type=Path);p.add_argument('rom',type=Path);p.add_argument('out',type=Path);p.add_argument('--entry',default='08134918');p.add_argument('--stop',default='0813492c');a=p.parse_args()
    document=json.loads(a.raw.read_text())
    if document.get('format')=='gameverse.l0.raw-pcode-bundle/0.1':
        result=verify_control(document['regions'],a.rom,document['control_contract'],a.out)
    else:result=verify(document,a.rom,a.out,a.entry,a.stop)
    print(json.dumps(result,indent=2))
