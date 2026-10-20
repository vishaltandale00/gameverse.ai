"""Bounded Thumb scalar-word call-frame corroboration against original SSA.

Only exact register/stack scalar arguments are admitted. This is not a general
stack-pointer, by-reference, variadic or dynamic-frame model.
"""
import hashlib,json

UNKNOWN=None

def prove(l0,call,nodes,rom,arguments,prefix_bytes):
    blocks={b['id']:b for b in l0['blocks']};ops=[o for b in blocks.values()for o in b['ops']];defs={o['output']:o for o in ops if o.get('output')}
    matches=[b for b in blocks.values()if any(o==call for o in b['ops'])]
    if len(matches)!=1:raise ValueError('stack call must match unique original source CALL')
    goal=matches[0]['id'];ancestors={goal};pending=[goal]
    while pending:
        b=pending.pop()
        for p in blocks[b]['predecessors']:
            if p not in ancestors:ancestors.add(p);pending.append(p)
    entry=min(blocks)
    if entry not in ancestors:raise ValueError('stack call source entry cannot reach call')
    original_nodes={v['id']:v for v in l0['varnodes']}
    if any(nodes.get(v)!=original_nodes.get(v)for v in call['inputs']):raise ValueError('stack ABI source varnode identity changed')
    bypc={}
    work=[0]
    for o in ops:bypc.setdefault(int(o['pc'],16),[]).append(o)
    def half(pc):
        off=pc-0x08000000
        if pc&1 or not 0<=off<=len(rom)-2:raise ValueError('stack ABI source instruction outside ROM')
        return int.from_bytes(rom[off:off+2],'little')
    def constbits(value):return tuple((value>>i)&1 for i in range(32))
    def scalar(v,active=()):
        z=nodes[v];width=z['size']*8
        if width>32 or v in active:raise ValueError('stack ABI scalar width/cycle unsupported')
        if z.get('constant'):return constbits(int(z['offset']))
        o=defs.get(v);bits=tuple(('ssa',v,i)for i in range(width))+(0,)*(32-width)
        if o and o['opcode']in('COPY','CAST','INDIRECT','INT_ZEXT'):
            b=scalar(o['inputs'][0],active+(v,));return b[:width]+(0,)*(32-width)
        if o and o['opcode']=='INT_AND':
            for a in o['inputs']:
                if nodes[a].get('constant'):
                    mask=int(nodes[a]['offset']);return tuple(bits[i]if mask&(1<<i)else 0 for i in range(32))
        return bits
    def anchored(pc,opcodes,rd,width=32):
        candidates=[o for o in bypc.get(pc,[])if o['opcode']in opcodes and o.get('output')and nodes[o['output']]['size']*8<=width and nodes[o['output']].get('register','r'+str(rd))=='r'+str(rd)]
        register_candidates=[o for o in candidates if nodes[o['output']].get('register')=='r'+str(rd)]
        if register_candidates:candidates=register_candidates
        if len(candidates)!=1:return UNKNOWN # Unused/unmatched values may never justify a call operand.
        return scalar(candidates[0]['output'])
    def integer(bits):
        return sum(v<<i for i,v in enumerate(bits))if bits is not None and all(isinstance(v,int)for v in bits)else None
    def walk(bid,regs,sp,stack,saved,path):
        if bid in path or len(path)>32:raise ValueError('stack ABI requires bounded acyclic caller prefix')
        b=blocks[bid];pc=int(b['start'],16);end=int(b['stop'],16)
        if not pc<=end<=pc+1024:raise ValueError('stack ABI source block extent unsupported')
        while pc<=end:
            work[0]+=1
            if work[0]>512:raise ValueError('stack ABI source proof work bound exceeded')
            if pc==int(call['pc'],16):
                expected=[scalar(i)for i in call['inputs'][1:]]
                if sp%4 or not -4096<=sp<0:raise ValueError('stack ABI caller frame alignment/extent invalid')
                for index,(value,a)in enumerate(zip(expected,arguments)):
                    actual=regs[index]if index<4 else stack.get(sp+a['stack_offset'])
                    bits=int(a['type'][1:])
                    if actual is None or actual!=value:raise ValueError('stack ABI argument SSA differs from original machine slot')
                if len(results)>=16:raise ValueError('stack ABI source proof path bound exceeded')
                if any(sp+a['stack_offset']in saved for a in arguments[4:]):raise ValueError('stack ABI argument overlaps saved register frame')
                results.append({'sp_delta':sp,'stack_offsets':[a['stack_offset']for a in arguments[4:]],'source_inputs':call['inputs'][1:]});return
            h=half(pc);rd=h&7
            if h&0xfe00==0xb400:
                mask=(h&255)|((h&256)<<6);pushed=[i for i in range(15)if mask&(1<<i)];sp-=4*len(pushed)
                for j,r in enumerate(pushed):stack[sp+4*j]=regs[r];saved.add(sp+4*j)
            elif h&0xff00==0xb000:
                change=(h&127)*4;sp+=-change if h&128 else change
            elif h&0xf800==0x4800:
                rd=(h>>8)&7;address=((pc+4)&~3)+(h&255)*4;off=address-0x08000000
                if not 0<=off<=len(rom)-4:raise ValueError('stack ABI literal outside ROM')
                regs[rd]=constbits(int.from_bytes(rom[off:off+4],'little'))
            elif h&0xf800==0x2000:regs[(h>>8)&7]=constbits(h&255)
            elif h&0xfc00==0x4400:
                operation=(h>>8)&3;rd=(h&7)|((h>>4)&8);rm=(h>>3)&15
                if rd in(13,15)or rm in(13,15)or operation==3:raise ValueError('stack ABI unsupported SP/PC/high-register control')
                if operation==2:regs[rd]=regs[rm]
                elif operation==0:regs[rd]=UNKNOWN
                elif operation!=1:raise ValueError('stack ABI unknown high-register instruction')
            elif h&0xf000==0x9000:
                r=(h>>8)&7;offset=(h&255)*4
                if h&0x800:regs[r]=stack.get(sp+offset)
                else:
                    if not sp<=sp+offset<0 or sp+offset in saved:raise ValueError('stack ABI write escapes outgoing local frame')
                    stack[sp+offset]=regs[r]
            elif h&0xe000==0 and h&0x1800!=0x1800:
                operation=(h>>11)&3;count=(h>>6)&31;rs=(h>>3)&7
                if operation==3:raise ValueError('stack ABI unsupported shift')
                value=regs[rs]
                if value is None:regs[rd]=UNKNOWN
                elif operation==0:regs[rd]=((0,)*count+value)[:32]
                elif operation==1:regs[rd]=(value+(0,)*32)[count or 32:(count or 32)+32]
                else:regs[rd]=UNKNOWN
            elif h&0xf800==0x1800:
                rs=(h>>3)&7;operand=(h>>6)&7
                if h&0x400 and operand==0:regs[rd]=regs[rs]
                else:regs[rd]=UNKNOWN
            elif h&0xe000==0x2000:
                operation=(h>>11)&3;r=(h>>8)&7
                if operation in(2,3):
                    value=integer(regs[r]);regs[r]=constbits((value+(h&255)*(1 if operation==2 else-1))&0xffffffff)if value is not None else UNKNOWN
                elif operation!=1:raise ValueError('stack ABI unsupported immediate operation')
            elif h&0xfc00==0x4000:
                operation=(h>>6)&15
                if operation in(8,10,11):pass
                elif operation==0:regs[rd]=anchored(pc,('INT_AND',),rd)
                elif operation in(1,2,3,4,5,6,7,9,12,13,14,15):regs[rd]=UNKNOWN
                else:raise ValueError('stack ABI unsupported ALU operation')
            elif h&0xe000==0x6000 or h&0xf000==0x8000 or h&0xf000==0x5000:
                # No SP-derived low-register addresses are admitted; source memory
                # is conditionally disjoint from the native saved/outgoing frame.
                if h&0xf000==0x5000:
                    operation=(h>>9)&7;load=operation in(3,4,5,6,7);width=8 if operation in(3,6)else 16 if operation in(5,7)else 32
                else:load=bool(h&0x800);width=16 if h&0xf000==0x8000 else 8 if h&0x1000 else 32
                if load:regs[rd]=anchored(pc,('LOAD',),rd,width)
            elif h&0xf000==0xd000:
                if (h>>8)&15>=14:raise ValueError('stack ABI SWI/unknown conditional unsupported')
                if pc!=end:raise ValueError('stack ABI branch must terminate source basic block')
                displacement=h&255;displacement-=256 if displacement&128 else 0
                if {int(blocks[q]['start'],16)for q in b['successors']}!={pc+2,pc+4+displacement*2}:raise ValueError('stack ABI source CFG differs from machine conditional')
            elif h&0xf800==0xe000:
                if pc!=end:raise ValueError('stack ABI branch must terminate source basic block')
                displacement=h&2047;displacement-=2048 if displacement&1024 else 0
                if {int(blocks[q]['start'],16)for q in b['successors']}!={pc+4+displacement*2}:raise ValueError('stack ABI source CFG differs from machine branch')
            else:raise ValueError('stack ABI unsupported caller instruction '+hex(h))
            pc+=2
        for successor in b['successors']:
            if successor in ancestors:walk(successor,list(regs),sp,dict(stack),set(saved),path+(bid,))
    results=[];walk(entry,[UNKNOWN]*16,0,{},set(),())
    if not results or len(results)>16 or len({r['sp_delta']for r in results})!=1:raise ValueError('stack ABI call frame missing/ambiguous')
    layout=callee_layout(rom,int(nodes[call['inputs'][0]]['offset']),arguments,prefix_bytes)
    return {'kind':'source_thumb_scalar_word_stack_call','call':call['id'],'caller_l0_sha256':hashlib.sha256(json.dumps(l0,sort_keys=True).encode()).hexdigest(),'caller_frame_bytes':-results[0]['sp_delta'],'callee_frame_bytes':layout['callee_frame_bytes'],'arguments':len(arguments),'source_instructions':work[0],'source_inputs':call['inputs'][1:],'callee_stack_loads':layout['callee_stack_loads'],'assumptions':['Non-stack source storage is disjoint from the native saved/outgoing call frame','Declared scalar service ABI preserves caller frame and callee-saved registers; native source qualification remains separate']}


def callee_layout(rom,target,arguments,prefix_bytes):
    def half(pc):
        off=pc-0x08000000
        if pc&1 or not 0<=off<=len(rom)-2:raise ValueError('stack ABI callee prefix outside ROM')
        return int.from_bytes(rom[off:off+2],'little')
    sp=0;loads=[]
    if not 2<=prefix_bytes<=64 or prefix_bytes%2:raise ValueError('stack ABI callee prefix bound invalid')
    if half(target)&0xff00!=0xb500:raise ValueError('stack ABI callee must save incoming LR')
    for pc in range(target,target+prefix_bytes,2):
        h=half(pc)
        if h&0xfe00==0xb400:sp-=4*(bin(h&255).count('1')+bool(h&256))
        elif h&0xff00==0xb000:sp+=-(h&127)*4 if h&128 else(h&127)*4
        elif h&0xfc00==0x4400 and (h>>8)&3==2 and ((h&7)|((h>>4)&8))not in(13,15)and ((h>>3)&15)not in(13,15):pass
        elif h&0xf800==0x9800:loads.append(((h&255)*4+sp,pc))
        else:raise ValueError('stack ABI callee prefix instruction unsupported')
    if len(loads)!=len(arguments)-4 or set(offset for offset,pc in loads)!={a['stack_offset']for a in arguments[4:]}:raise ValueError('stack ABI callee load slots do not match complete declared stack ABI')
    for a in arguments[4:]:
        if sum(offset==a['stack_offset']for offset,pc in loads)!=1:raise ValueError('stack ABI callee does not load exact incoming scalar slot')
    return {'callee_frame_bytes':-sp,'callee_stack_loads':[{'offset':offset,'pc':format(pc,'08x')}for offset,pc in loads]}
