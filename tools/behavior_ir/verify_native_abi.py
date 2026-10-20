"""Narrow no-dependency native ABI contract and generated-harness checks."""
import copy
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path
from native_abi import validate, render_call, liveout_checks, register_input_setup


def main():
    start = time.perf_counter()
    rom = bytearray(64)
    rom[14:18] = bytes.fromhex('02cd0847')
    adapter = {'entry':'08000004','fields':[{'name':'vm_nz','width':32}], 'native_abi':{
        'schema':'gameverse.native-abi/0.1','mode':'thumb',
        'rom_sha256':hashlib.sha256(rom).hexdigest(),
        'registers':{'r'+str(i):0 for i in range(13)},
        'preserve':['r6','r7','r10','r11'],'clobbers':['r4','r9'],
        'liveouts':[{'register':'r8','field':'vm_nz'}],
        'expected_exit':{'r5':{'entry_delta':4}},
        'exit':{'kind':'continuation_stack','stack_register':'r5','target_register':'r1','dispatches':['08000010']}}}
    adapter['native_abi']['registers']['r5']=0x03007000
    helper, expression, receipt = render_call(adapter, rom)
    assert expression.startswith('native_original_call(')
    assert 'state.vm_nz!=native_liveouts[8]' in liveout_checks(adapter)
    register_adapter = copy.deepcopy(adapter)
    register_adapter['fields'][0]['owner']='register'
    register_adapter['native_abi']['registers']['r8']={'field':'vm_nz'}
    validate(register_adapter, rom)
    assert register_input_setup(register_adapter)=='native_register_inputs[8]=state.vm_nz;'
    assert 'cpu->gprs[8]=native_register_inputs[8];' in render_call(register_adapter,rom)[0]
    rejected = 0
    def reject(change):
        nonlocal rejected
        bad = copy.deepcopy(adapter); change(bad['native_abi'])
        try: validate(bad, rom)
        except (ValueError, KeyError, TypeError): rejected += 1
        else: raise AssertionError('invalid contract accepted')
    reject(lambda a:a.update(mode='arm'))
    reject(lambda a:a.update(interrupts='enabled'))
    reject(lambda a:a.update(rom_sha256='0'*64))
    reject(lambda a:a['exit'].update(dispatches=['08000012']))
    reject(lambda a:a['expected_exit']['r5'].update(entry_delta=0))
    reject(lambda a:a['registers'].pop('r12'))
    reject(lambda a:a['liveouts'][0].update(field='missing'))
    reject(lambda a:a['clobbers'].append('r8'))
    reject(lambda a:a['registers'].update(r8={'field':'vm_nz'}))
    covered = copy.deepcopy(adapter)
    covered['collections']=[{'name':'stack','address':0x03006ffc,'size':1,'count':8}]
    assert validate(covered,rom)['seed_covered']
    assert 'busRead32(c,initial[5])!=0x08000001u' in render_call(covered,rom)[0]
    partial = copy.deepcopy(adapter)
    partial['fields'].append({'name':'alias','owner':'global','address':0x0300f000,'offset':0,'width':16})
    try: validate(partial,rom)
    except ValueError: rejected += 1
    else: raise AssertionError('partial mirrored seed overlap accepted')
    arm_rom = bytearray(64); arm_rom[32:36] = bytes.fromhex('1eff2fe1')
    arm = copy.deepcopy(adapter)
    arm['native_abi'].update(mode='arm',rom_sha256=hashlib.sha256(arm_rom).hexdigest(),exit={'kind':'incoming_lr','dispatches':['08000020']})
    arm_helper, _, _ = render_call(arm, arm_rom)
    saved_rom=bytearray(64)
    for offset,word in [(4,0xe92d4000),(8,0xe3500000),(12,0x0a000000),(16,0xe3a00001),(20,0xe8bd8000)]:
        saved_rom[offset:offset+4]=word.to_bytes(4,'little')
    saved=copy.deepcopy(arm)
    saved['native_abi'].update(rom_sha256=hashlib.sha256(saved_rom).hexdigest(),exit={'kind':'arm_saved_lr','dispatches':['08000014']})
    saved_helper,_,saved_receipt=render_call(saved,saved_rom)
    assert saved_receipt['contract']['arm_return_proof']['stack_delta_before_exit']==-4
    assert 'cpu->gprs[ARM_LR]=0x08000000;' in saved_helper
    for offset,word in [(4,0x192d4000),(8,0xe1a0000d),(8,0xe1a0d000),(8,0xeb000000),(8,0xe12fff1e),(8,0xe58d0000),(8,0xe1a0000e),(8,0xe10f0000),(8,0xe8b00001),(20,0xe8bd4000)]:
        bad_rom=bytearray(saved_rom);bad_rom[offset:offset+4]=word.to_bytes(4,'little')
        bad=copy.deepcopy(saved);bad['native_abi']['rom_sha256']=hashlib.sha256(bad_rom).hexdigest()
        try:validate(bad,bad_rom)
        except ValueError:rejected+=1
        else:raise AssertionError('unproven ARM return instruction accepted: '+hex(word))
    frame_alias=copy.deepcopy(saved)
    frame_alias['fields'].append({'name':'frame_alias','owner':'global','address':0x0300fdfc,'offset':0,'width':32})
    try:validate(frame_alias,saved_rom)
    except ValueError:rejected+=1
    else:raise AssertionError('mirrored saved LR frame overlap accepted')
    # Compile exactly the generated helper against the installed emulator API.
    prefix = '#include <mgba/core/core.h>\n#include <mgba/internal/arm/arm.h>\n#include <mgba/internal/arm/isa-inlines.h>\n#include <limits.h>\n#include <stdint.h>\nstatic unsigned long instructions;\n'
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'native.c'; path.write_text(prefix+helper+arm_helper.replace('native_liveouts','arm_liveouts').replace('native_pc','arm_pc').replace('native_original_call','arm_original_call')+saved_helper.replace('native_liveouts','saved_liveouts').replace('native_pc','saved_pc').replace('native_original_call','saved_original_call'))
        subprocess.run(['cc','-std=c11','-fsyntax-only','-I/opt/homebrew/include',str(path)],check=True,capture_output=True,timeout=30)
    result={'schema':'gameverse.native-abi-verification/0.1','outcome':'pass','checks':{'valid_continuation':1,'register_field_input_binding':1,'covered_seed_preserves_input':1,'negative_contracts':rejected,'generated_thumb_and_arm_helpers_compile':3,'saved_lr_cfg':1},'wall_s':time.perf_counter()-start,'scope':'contract rejection and C/API validation; no original/emitted game parity claim'}
    print(json.dumps(result,indent=2))
    return result

if __name__=='__main__': main()
