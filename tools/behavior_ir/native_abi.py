"""Explicit bounded original CPU entry contracts, independent of generated AAPCS.

No game semantics are implemented here. Continuation exits require pinned native
LDMIA/BX bytes and the corresponding two observed CPU steps, not just a sentinel.
"""
import hashlib
import re

SCHEMA = 'gameverse.native-abi/0.1'
SENTINEL = 0x08000000


def _reg(value):
    if not isinstance(value, str) or not re.fullmatch(r'r(?:[0-9]|1[0-2])', value):
        raise ValueError('native ABI requires r0..r12')
    return int(value[1:])


def _int(value):
    if isinstance(value, bool):
        raise ValueError('native ABI integer required')
    if not isinstance(value, (int, str)):
        raise ValueError('native ABI integer required')
    result = int(value, 0) if isinstance(value, str) and value.startswith('0x') else int(value)
    if not 0 <= result <= 0xffffffff:
        raise ValueError('native ABI value outside u32')
    return result


def validate(adapter, rom):
    """Return a normalized contract; reject unsupported exits/modes/frame shapes."""
    a = adapter['native_abi']
    if set(a) - {'schema','mode','rom_sha256','interrupts','registers','preserve','clobbers','liveouts','expected_exit','instruction_cap','exit'}:
        raise ValueError('unsupported native ABI contract keys')
    if a.get('schema') != SCHEMA or a.get('mode') not in ('thumb', 'arm'):
        raise ValueError('unsupported native ABI schema/CPU mode')
    if a.get('interrupts', 'disabled') != 'disabled':
        raise ValueError('native ABI interrupt entry unsupported')
    mode = a['mode']; entry = int(adapter['entry'], 16)
    if entry % (2 if mode == 'thumb' else 4) or not 0x08000000 <= entry < 0x08000000 + len(rom):
        raise ValueError('native ABI entry mode alignment/ROM range')
    if a.get('rom_sha256') != hashlib.sha256(rom).hexdigest():
        raise ValueError('native ABI source ROM identity mismatch')
    registers = a.get('registers', {})
    if set(registers) != {'r' + str(i) for i in range(13)}:
        raise ValueError('native ABI requires explicit r0..r12 frame')
    fields = {f['name']: f for f in adapter['fields']}
    normalized = {}
    for name, value in registers.items():
        _reg(name)
        if isinstance(value, dict):
            if set(value) == {'argument'}:
                if value['argument'] not in ('r0', 'r1', 'r2', 'r3'):
                    raise ValueError('unsupported native ABI argument binding')
            elif set(value) == {'field'}:
                field = fields.get(value['field'])
                if not field or field['width'] != 32 or field.get('owner') != 'register' or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',value['field']):
                    raise ValueError('native ABI input binding requires u32 register field')
            else:
                raise ValueError('unsupported native ABI register binding')
            normalized[name] = value
        else:
            normalized[name] = _int(value)
    preserve = a.get('preserve', [])
    clobbers = a.get('clobbers', [])
    liveouts = a.get('liveouts', [])
    expected = a.get('expected_exit', {})
    groups = [preserve, clobbers, [v['register'] for v in liveouts], list(expected)]
    seen = set()
    for group in groups:
        for name in group:
            _reg(name)
            if name in seen:
                raise ValueError('native ABI register classification overlaps')
            seen.add(name)
    if not {'r'+str(i) for i in range(4, 12)} <= seen:
        raise ValueError('native ABI requires classification of r4..r11')
    fields = {f['name']: f for f in adapter['fields']}
    for output in liveouts:
        if set(output) != {'register', 'field'} or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',output['field']) or output['field'] not in fields or fields[output['field']]['width'] != 32:
            raise ValueError('native ABI liveout requires declared u32 state field')
    for name, value in expected.items():
        if set(value) != {'entry_delta'} or not isinstance(value['entry_delta'], int) or abs(value['entry_delta']) > 4096:
            raise ValueError('unsupported native ABI exit register constraint')
    cap = a.get('instruction_cap', 2048)
    if not isinstance(cap, int) or not 1 <= cap <= 16384:
        raise ValueError('native ABI instruction budget must be1..16384')
    exit = a['exit']; dispatches = []; seed_covered = False; arm_return_proof = None
    if exit.get('kind') == 'continuation_stack':
        if mode != 'thumb' or set(exit) != {'kind', 'stack_register', 'target_register', 'dispatches'}:
            raise ValueError('unsupported continuation mode/contract')
        stack, target = _reg(exit['stack_register']), _reg(exit['target_register'])
        if stack > 7 or target > 7 or stack == target or not 1 <= len(exit['dispatches']) <= 8:
            raise ValueError('unsupported continuation register/dispatch bounds')
        address = normalized[exit['stack_register']]
        if not isinstance(address, int) or address % 4 or not 0x03000000 <= address <= 0x030079fc:
            raise ValueError('continuation seed must be canonical IWRAM outside oracle frame')
        # A declared state view already initializes original and generated
        # inputs. Never silently overwrite it with harness context afterward.
        covered = set()
        spans = [(f['address']+f.get('offset',0),f['width']//8) for f in adapter['fields'] if f.get('owner')=='global']
        spans.extend((ref['cell'],4) for ref in adapter.get('object_references',[]))
        for collection in adapter.get('collections',[]):
            if collection.get('address') is not None:
                if collection['count'] > 4096:
                    raise ValueError('native ABI context collection extent budget')
                spans.extend((collection['address']+i*collection.get('stride',collection['size']),collection['size']) for i in range(collection['count']))
        for start,width in spans:
            if not 0x03000000 <= start < 0x04000000:
                continue
            if width >= 0x8000:
                covered.update(range(4)); continue
            for byte in range(4):
                if ((address+byte-start)&0x7fff) < width:
                    covered.add(byte)
        if covered and covered != set(range(4)):
            raise ValueError('continuation seed partially overlaps declared state')
        seed_covered = bool(covered)
        if expected.get(exit['stack_register']) != {'entry_delta': 4}:
            raise ValueError('continuation requires exactly one caller frame pop')
        for value in exit['dispatches']:
            pc = int(value, 16); offset = pc - 0x08000000
            expected_bytes = (0xc800 | stack << 8 | 1 << target).to_bytes(2, 'little') + (0x4700 | target << 3).to_bytes(2, 'little')
            if pc & 1 or offset < 2 or offset + 2 > len(rom) or rom[offset-2:offset+2] != expected_bytes:
                raise ValueError('continuation exit is not source LDMIA/BX pair')
            dispatches.append(pc)
    elif exit.get('kind') == 'arm_saved_lr':
        if mode!='arm' or set(exit)!={'kind','dispatches'} or not 1<=len(exit['dispatches'])<=8:
            raise ValueError('ARM saved LR requires ARM mode and bounded exits')
        dispatches=[int(value,16) for value in exit['dispatches']]
        arm_return_proof=_prove_arm_saved_lr(rom,entry,dispatches)
        spans=[(f['address']+f.get('offset',0),f['width']//8) for f in adapter['fields'] if f.get('owner')=='global']
        spans.extend((ref['cell'],4) for ref in adapter.get('object_references',[]))
        for collection in adapter.get('collections',[]):
            if collection.get('address') is not None:
                spans.append((collection['address'],collection.get('stride',collection['size'])*(collection['count']-1)+collection['size']))
        if any(0x03000000<=address<0x04000000 and any(((0x03007dfc+byte-address)&0x7fff)<width for byte in range(4)) for address,width in spans):
            raise ValueError('ARM saved LR frame overlaps declared state')
    elif exit.get('kind') == 'incoming_lr':
        if set(exit) != {'kind', 'dispatches'} or not 1 <= len(exit['dispatches']) <= 8:
            raise ValueError('incoming LR exit requires bounded source dispatches')
        opcode = bytes.fromhex('7047') if mode == 'thumb' else bytes.fromhex('1eff2fe1')
        for value in exit['dispatches']:
            pc = int(value, 16); offset = pc - 0x08000000
            if pc % len(opcode) or offset < 0 or rom[offset:offset+len(opcode)] != opcode:
                raise ValueError('incoming LR exit is not source BX LR')
            dispatches.append(pc)
    else:
        raise ValueError('unsupported native ABI continuation/interrupt exit')
    return dict(a, registers=normalized, instruction_cap=cap, dispatch_pcs=dispatches, seed_covered=seed_covered, arm_return_proof=arm_return_proof)


def render_call(adapter, rom):
    """Return (C helpers, original-call expression, receipt metadata).

    Insert helpers after the existing ordinary call(); replace only the original
    call expression. Insert liveout_checks() after generated state is read back.
    """
    a = validate(adapter, rom)
    assignments = []
    for name, value in a['registers'].items():
        if isinstance(value, dict):
            expression = 'args['+value['argument'][1:]+']' if 'argument' in value else 'native_register_inputs['+name[1:]+']'
        else:
            expression = hex(value)+'u'
        assignments.append('cpu->gprs['+name[1:]+']='+expression+';')
    checks = ['if((uint32_t)cpu->gprs[13]!=0x03007e00u)return 0;']
    for name in a.get('preserve', []):
        checks.append('if((uint32_t)cpu->gprs['+name[1:]+']!=initial['+name[1:]+'])return 0;')
    for name, value in a.get('expected_exit', {}).items():
        checks.append('if((uint32_t)cpu->gprs['+name[1:]+']!=initial['+name[1:]+']+('+str(value['entry_delta'])+'))return 0;')
    continuation = a['exit']['kind'] == 'continuation_stack'
    setup = ''; terminal = '('+'||'.join('last=='+hex(pc)+'u' for pc in a['dispatch_pcs'])+')&&(uint32_t)cpu->gprs[14]==0x08000001u'
    if continuation:
        stack, target = a['exit']['stack_register'][1:], a['exit']['target_register'][1:]
        setup = 'if(c->busRead32(c,initial['+stack+'])!=0x08000001u)return 0;' if a['seed_covered'] else 'c->busWrite32(c,initial['+stack+'],0x08000001u);'
        terminal = '('+'||'.join('last=='+hex(pc)+'u&&before=='+hex(pc-2)+'u' for pc in a['dispatch_pcs'])+')&&(uint32_t)cpu->gprs['+target+']==0x08000001u'
    saved_lr = a['exit']['kind']=='arm_saved_lr'
    lr_value = '0x08000000' if saved_lr else '0x08000001'
    exit_mode = '!cpu->cpsr.t' if saved_lr else 'cpu->cpsr.t'
    step_checks = ''
    if saved_lr:
        terminal = '('+'||'.join('last=='+hex(pc)+'u' for pc in a['dispatch_pcs'])+')'
        step_checks = 'if(n==1){if(last!=pc||(uint32_t)cpu->gprs[13]!=0x03007dfcu||c->busRead32(c,0x03007dfc)!=0x08000000u)return 0;}else if(native_pc(cpu)!=0x08000000u&&((uint32_t)cpu->gprs[13]!=0x03007dfcu||c->busRead32(c,0x03007dfc)!=0x08000000u))return 0;'
        checks.append('if(c->busRead32(c,0x03007dfc)!=0x08000000u)return 0;')
    mode = 'MODE_THUMB' if a['mode'] == 'thumb' else 'MODE_ARM'
    writepc = 'ThumbWritePC(cpu)' if a['mode'] == 'thumb' else 'ARMWritePC(cpu)'
    helper = '''\nstatic uint32_t native_register_inputs[13];
static uint32_t native_liveouts[13];
static uint32_t native_pc(struct ARMCore*cpu){return (uint32_t)cpu->gprs[ARM_PC]-(cpu->cpsr.t?2u:4u);}
static int native_original_call(struct mCore*c,uint32_t pc,const uint32_t*args,uint32_t*result){
struct ARMCore*cpu=c->cpu;for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
ASSIGN
uint32_t initial[13];for(unsigned i=0;i<13;i++)initial[i]=cpu->gprs[i];
cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=LRVALUE;cpu->cpsr.i=1;cpu->cpsr.f=1;cpu->cpsr.n=0;cpu->cpsr.z=0;cpu->cpsr.c=0;cpu->cpsr.v=0;cpu->cycles=0;cpu->nextEvent=INT_MAX;
_ARMSetMode(cpu,MODE);cpu->gprs[ARM_PC]=pc;WRITEPC;SETUP
unsigned n=0;uint32_t last=0,before=0;
while(native_pc(cpu)!=0x08000000u&&n<CAP){before=last;last=native_pc(cpu);ARMRun(cpu);n++;STEPCHECKS}
instructions+=n;if(n==CAP||!(EXITMODE)||!(TERMINAL))return 0;
CHECKS
for(unsigned i=0;i<13;i++)native_liveouts[i]=cpu->gprs[i];*result=cpu->gprs[0];return 1;}
'''.replace('LRVALUE',lr_value).replace('EXITMODE',exit_mode).replace('STEPCHECKS',step_checks).replace('ASSIGN',''.join(assignments)).replace('MODE',mode).replace('WRITEPC',writepc).replace('SETUP',setup).replace('CAP',str(a['instruction_cap'])).replace('TERMINAL',terminal).replace('CHECKS',''.join(checks))
    return helper, 'native_original_call(c,@ORIGINAL_ENTRY@,original_args,&original_result)', {'schema': SCHEMA, 'contract': a, 'source_rom_sha256': a['rom_sha256'], 'initial_nzcv': 0, 'interrupt_masks': 'IRQ and FIQ disabled', 'exit_proof': 'source-pinned adjacent pop/dispatch and observed terminal steps' if continuation else 'source CFG single saved LR, protected stack word and observed LDM PC terminal' if saved_lr else 'source-pinned BX LR and observed terminal step; declared register frame'}


def liveout_checks(adapter):
    return ''.join('if(state.'+v['field']+'!=native_liveouts['+v['register'][1:]+']){fprintf(stderr,"native register liveout mismatch test%u '+v['register']+'\\n",test);return 16;}' for v in adapter['native_abi'].get('liveouts', []))


def register_input_setup(adapter):
    """Populate explicit register-field bindings immediately before original call."""
    return ''.join('native_register_inputs['+name[1:]+']=state.'+value['field']+';' for name,value in adapter['native_abi']['registers'].items() if isinstance(value,dict) and 'field' in value)


def _prove_arm_saved_lr(rom, entry, exits, max_instructions=4096):
    """Small source CFG proof for a single saved-LR stack word.

    Interior instructions cannot observe SP/LR, call, change ISA, or write PC.
    Dynamic checks additionally protect the word against arbitrary data aliases.
    """
    base=0x08000000
    def word(pc):
        off=pc-base
        if pc&3 or off<0 or off+4>len(rom):
            raise ValueError('ARM return CFG leaves aligned source ROM')
        return int.from_bytes(rom[off:off+4],'little')
    if word(entry)!=0xe92d4000:
        raise ValueError('ARM saved LR requires unconditional entry STMDB SP!,{LR}')
    if any(word(pc)!=0xe8bd8000 for pc in exits):
        raise ValueError('ARM saved LR requires unconditional terminal LDMIA SP!,{PC}')
    pending=[entry+4];seen=set();reached=set()
    while pending:
        pc=pending.pop()
        if pc in seen:continue
        seen.add(pc)
        if len(seen)>max_instructions or abs(pc-entry)>16384:
            raise ValueError('ARM return source proof budget')
        w=word(pc);cond=w>>28
        if pc in exits:
            reached.add(pc);continue
        if cond==15:raise ValueError('ARM unconditional extension unsupported')
        group=(w>>25)&7
        def ordinary_register(r):
            if r in (13,14):raise ValueError('ARM interior accesses saved-frame SP/LR')
        if group==5:
            if w&(1<<24):raise ValueError('ARM saved LR proof does not permit calls')
            delta=w&0xffffff
            if delta&0x800000:delta-=1<<24
            target=pc+8+delta*4
            if target==entry:raise ValueError('ARM return CFG re-enters save prologue')
            pending.append(target)
            if cond!=14:pending.append(pc+4)
            continue
        if group in (2,3): # word/byte single transfer
            rn=(w>>16)&15;rd=(w>>12)&15
            ordinary_register(rn);ordinary_register(rd)
            if rd==15:raise ValueError('ARM indirect load/store PC unsupported')
            if rn==15 and (not(w&(1<<20)) or w&(1<<21) or not(w&(1<<24))):
                raise ValueError('ARM PC base only supported for literal loads')
            if group==3:
                if w&16:raise ValueError('ARM register-transfer extension unsupported')
                ordinary_register(w&15)
        elif group in (0,1):
            if group==0 and w&0x90==0x90:
                if ((w>>5)&3)!=1:
                    raise ValueError('ARM extra transfer/multiply unsupported')
                rn=(w>>16)&15;rd=(w>>12)&15
                ordinary_register(rn);ordinary_register(rd)
                if rn==15 or rd==15:raise ValueError('ARM halfword PC unsupported')
                if not w&(1<<22):ordinary_register(w&15)
            else:
                op=(w>>21)&15;rn=(w>>16)&15;rd=(w>>12)&15
                # Reject PSR transfer/BX/misc aliases of test instructions.
                if op in (8,9,10,11) and not w&(1<<20):
                    raise ValueError('ARM PSR/misc operation unsupported')
                if op not in (13,15):ordinary_register(rn)
                if op not in (8,9,10,11):
                    ordinary_register(rd)
                    if rd==15:raise ValueError('ARM computed PC unsupported')
                if group==0:
                    ordinary_register(w&15)
                    if w&16:ordinary_register((w>>8)&15)
        else:
            raise ValueError('ARM return proof unsupported instruction class')
        pending.append(pc+4)
    if reached!=set(exits):raise ValueError('ARM declared return not source reachable')
    return {'reachable_instructions':len(seen)+1,'stack_delta_before_exit':-4,'saved_lr_offset':-4,'source_sha256':hashlib.sha256(b''.join(pc.to_bytes(4,'little')+word(pc).to_bytes(4,'little') for pc in sorted(seen|{entry}))).hexdigest()}
