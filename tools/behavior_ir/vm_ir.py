"""Source raw p-code to the ordinary serialized L1, with explicit VM ports.

The first admitted boundary is a straight-line native-return transaction. Raw
register writes are retained; HighFunction exports are deliberately rejected
because a platform calling convention can eliminate VM live-outs before export.
"""
from copy import deepcopy
import hashlib
import json
from lift import Lifter, Unsupported, const, node, typ

FORMAT = 'gameverse.l0.raw-pcode/0.1'


def _number(x):
    return int(x, 16) if isinstance(x, str) and (x.startswith('0x') or any(c in x.lower() for c in 'abcdef')) else int(x)


def normalize(raw, rom, registers, liveouts):
    """Convert exact ordered storage writes to SSA without interpreting game code."""
    if raw.get('format') != FORMAT:
        raise Unsupported('VM lowering requires raw instruction p-code; HighFunction loses VM outputs')
    if raw.get('language')!='ARM:LE:32:v4t':raise Unsupported('VM raw source language must be ARM LE v4t')
    instructions = raw.get('instructions', [])
    if not 1 <= len(instructions) <= 128:
        raise Unsupported('VM instruction boundary budget1..128')
    entry = int(raw['entry'], 16)
    if raw.get('rom_sha256') != hashlib.sha256(rom).hexdigest():
        raise Unsupported('VM raw source ROM identity mismatch')
    variables, operations, environment, final = [], [], {}, {}
    written_registers=set()
    storage_shapes={}
    register_names={}
    def var(value, pc, write=False):
        if value is None: return None
        z = deepcopy(value); space=z['space']; size=z['size']; offset=_number(z['offset'])
        if write and space not in ('register','unique'):
            raise Unsupported('VM direct storage effect requires explicit memory operation')
        if write and z.get('register') in ('pc','lr'):raise Unsupported('VM in-transaction PC/LR write requires closed control contract')
        if write and z.get('register'):written_registers.add(z['register'])
        typ(size)
        if space=='register':
            name=z.get('register')
            if not isinstance(name,str)or not name:raise Unsupported('VM raw register identity missing')
            identity=(offset,size)
            if identity in register_names and register_names[identity]!=name:raise Unsupported('VM inconsistent raw register identity')
            register_names[identity]=name
        if space in ('register','unique'):
            scope=(space,pc if space=='unique'else None)
            windows=storage_shapes.setdefault(scope,set())
            if any(offset<hi and lo<offset+size and (lo,hi)!=(offset,offset+size) for lo,hi in windows):
                raise Unsupported('VM partial or overlapping storage aliases require byte-lane SSA')
            windows.add((offset,offset+size))
        key=(space, offset, size, pc if space=='unique' else None)
        if z.get('constant') or space=='const':
            key=('const', offset, size)
        if not write and key in environment:return environment[key]
        identifier='v'+str(len(variables))
        row=dict(id=identifier,size=size,space=space,offset=str(offset),constant=space=='const' or z.get('constant',False),input=not write)
        if z.get('register'):row['register']=z['register']
        if not write and not row['constant']:
            register=row.get('register')
            if space!='register' or register not in registers:
                raise Unsupported('VM undeclared entry storage '+str(key))
        variables.append(row);environment[key]=identifier
        if z.get('register'):final[z['register']]=identifier
        return identifier
    end=int(raw['end_exclusive'],16)
    if end<=entry or raw.get('source_span_sha256')!=hashlib.sha256(rom[entry-0x08000000:end-0x08000000]).hexdigest():raise Unsupported('VM source span identity mismatch')
    expected=entry;returned=False
    for instruction in instructions:
        pc=int(instruction['pc'],16)
        if str(instruction.get('TMode'))!='1':raise Unsupported('VM source instruction Thumb context missing')
        data=bytes.fromhex(instruction['bytes'])
        if returned or pc!=expected or not data or pc-entry>=512:
            raise Unsupported('VM boundary is not one contiguous closed transaction')
        at=pc-0x08000000
        if at<0 or rom[at:at+len(data)]!=data:raise Unsupported('VM instruction bytes differ from ROM')
        expected=pc+len(data)
        pcode=instruction.get('pcode',instruction.get('ops',[]))
        if not pcode:raise Unsupported('VM instruction has no raw semantics')
        # BX LR is the evidenced external boundary, including its PC/mode
        # transition. It is not an opaque in-transaction CALLOTHER service.
        if pc==int(instructions[-1]['pc'],16) and data==bytes.fromhex('7047'):
            if registers.get('lr')!=0x08000001 or 'lr'in written_registers:
                raise Unsupported('VM native-return endpoint requires unchanged incoming Thumb sentinel LR')
            if not any(o['opcode']=='RETURN'for o in pcode):raise Unsupported('VM source BX LR lacks raw return')
            operations.append(dict(id='op'+str(len(operations)),pc=f'{pc:08x}',opcode='RETURN',inputs=[]))
            returned=True
            continue
        for operation in pcode:
            opcode=operation['opcode']
            inputs=[var(z,pc) for z in operation['inputs']]
            if opcode=='RETURN':
                if pc!=int(instructions[-1]['pc'],16) or data!=bytes.fromhex('7047'):
                    raise Unsupported('VM return is not terminal source BX LR')
                returned=True
                operations.append(dict(id='op'+str(len(operations)),pc=f'{pc:08x}',opcode='RETURN',inputs=[]))
                continue
            if opcode in ('BRANCH','CBRANCH','BRANCHIND','CALL','CALLIND','CALLOTHER'):
                raise Unsupported('VM control requires an explicit closed CFG/call continuation contract: '+opcode)
            allowed={'COPY','LOAD','STORE','INT_ADD','INT_SUB','INT_MULT','INT_AND','INT_OR','INT_XOR','INT_EQUAL','INT_NOTEQUAL','INT_LESS','INT_SLESS','INT_LESSEQUAL','INT_SLESSEQUAL','INT_LEFT','INT_RIGHT','INT_SRIGHT','INT_ZEXT','INT_SEXT','INT_2COMP','INT_NEGATE','BOOL_NEGATE','BOOL_AND','BOOL_OR','BOOL_XOR','SUBPIECE','PIECE','INT_CARRY','INT_SCARRY','INT_SBORROW'}
            if opcode not in allowed:raise Unsupported('VM unsupported raw effect '+opcode)
            output=var(operation.get('output'),pc,True)
            operations.append(dict(id='op'+str(len(operations)),pc=f'{pc:08x}',opcode=opcode,inputs=inputs,**({'output':output}if output else{})))
    if not returned:raise Unsupported('VM transaction missing proven native return')
    if expected!=end:raise Unsupported('VM source boundary does not cover the exact pinned span')
    unrepresented=written_registers.intersection({'r'+str(i)for i in range(4,12)})-set(liveouts)
    if unrepresented:raise Unsupported('VM written persistent registers lack liveout ports: '+str(sorted(unrepresented)))
    for register in liveouts:
        if register not in final:raise Unsupported('VM liveout absent from raw source '+register)
        if variables[int(final[register][1:])]['size']!=4:raise Unsupported('VM liveout must preserve exact full register')
    l0=dict(format='gameverse.l0.highfunction/0.2',entry=raw['entry'],varnodes=variables,blocks=[dict(id=0,start=raw['entry'],stop=instructions[-1]['pc'],successors=[],predecessors=[],ops=operations)],jump_tables=[])
    return l0, {register:final[register]for register in liveouts}


class _FrameLifter(Lifter):
    def __init__(self,l0,rom,registers,outputs,argument_contract=None):
        self.frame_registers=registers;self.frame_outputs=outputs
        super().__init__(l0,rom,argument_contract=argument_contract)
    def literal(self,v):
        z=self.v[v]
        if z.get('input') and z.get('register') in self.frame_registers:
            value=self.frame_registers[z['register']]
            if type(value)is int:return value
            raise Unsupported('VM symbolic register is not a constant address')
        return super().literal(v)
    def _ptr(self,v):
        z=self.v[v]
        if z.get('input') and z.get('register') in self.frame_registers:
            value=self.literal(v)
            if 0x02000000<=value<0x04000000:return ('global',value,const(0))
            if 0x08000000<=value<0x08000000+len(self.rom):return ('asset',value,const(0))
        return super()._ptr(v)
    def expr(self,v):
        z=self.v[v];o=self.defs.get(v);t=typ(z['size'])
        if z.get('input') and z.get('register') in self.frame_registers:
            value=self.frame_registers[z['register']]
            if isinstance(value,dict):return dict(op='local',type=t,name='entry_'+value['field'])
            return const(self.literal(v),t)
        if o and o['opcode']=='INT_CARRY':
            a,b=[self.expr(i)for i in o['inputs']]
            return node('less_unsigned',t,node('add_wrap',a['type'],a,b),a,provenance=o['id'])
        if o and o['opcode']=='BOOL_XOR':return node('not_equal',t,*[self.expr(i)for i in o['inputs']],provenance=o['id'])
        if o and o['opcode']=='PIECE':
            a,b=[self.expr(i)for i in o['inputs']]
            return node('bit_or',t,node('shift_left',t,node('zext',t,a),const(self.v[o['inputs'][1]]['size']*8)),node('zext',t,b),provenance=o['id'])
        return super().expr(v)
    def collect(self):
        super().collect()
        self.frame_values={r:self.expr(v)for r,v in self.frame_outputs.items()}
    def build(self):
        l1,adapter=super().build()
        assignments=[]
        snapshots=[]
        for value in self.frame_registers.values():
            if isinstance(value,dict):
                name=value['field'];l1['locals'].append(dict(name='entry_'+name,storage_type='u32'))
                snapshots.append(dict(op='assign_local',local='entry_'+name,value=dict(op='field',type='u32',name=name)))
        l1['body'][:0]=snapshots
        ports={r:(v['field'] if isinstance(v,dict) else 'vm_'+r)for r,v in self.frame_registers.items()if isinstance(v,dict)or r in self.frame_values}
        if len(set(ports.values()))!=len(ports):raise Unsupported('VM register port names overlap')
        existing_names={field['name']for field in l1['state']}
        if existing_names.intersection(ports.values()):raise Unsupported('VM register port shadows recovered state')
        for register,name in ports.items():
            l1['state'].append(dict(name=name,owner='vm_register_frame',storage_type='u32',semantic_type=dict(quantity='unknown',unit='unknown',frame='unknown',confidence=0.0,evidence=[])))
            adapter['fields'].append(dict(name=name,width=32,owner='register',register=register,address=None,argument=None,offset=0))
            if register in self.frame_values:assignments.append(dict(op='assign_field',field=name,value=self.frame_values[register]))
        # Source loads already remain ordered snapshots, including pre-store reads.
        l1['body'][-1:-1]=assignments
        l1['return_type']='void';adapter['return_type']='void'
        return l1,adapter


def lower_vm(raw,rom,contract):
    """Return ordinary (L1,adapter); no native machine layout enters L1."""
    if set(contract)!={'registers','liveouts','evidence'} or not contract['evidence']:
        raise Unsupported('VM requires exact register frame, liveout and source evidence contract')
    allowed={'r'+str(i)for i in range(13)}|{'lr','NG','ZR','CY','OV'}
    if set(contract['registers'])-allowed:raise Unsupported('VM register frame contains unsupported CPU or native storage')
    if any(contract['registers'].get(flag,0)!=0 for flag in ('NG','ZR','CY','OV')):raise Unsupported('VM native boundary requires NZCV zero')
    for value in contract['registers'].values():
        if isinstance(value,dict):
            if set(value)!={'field'}or not isinstance(value['field'],str)or not value['field'].isidentifier():raise Unsupported('VM symbolic scalar register field invalid')
        elif type(value)is not int or not 0<=value<=0xffffffff:raise Unsupported('VM register frame value outside u32')
    names=[v['field']for v in contract['registers'].values()if isinstance(v,dict)]
    if len(names)!=len(set(names)):raise Unsupported('VM register input fields must be distinct')
    l0,outputs=normalize(raw,rom,contract['registers'],contract['liveouts'])
    l1,adapter=_FrameLifter(l0,rom,contract['registers'],outputs).build()
    adapter['raw_pcode_sha256']=hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest()
    adapter['vm_contract']=deepcopy(contract)
    adapter['assumptions'].append(dict(kind='source_bx_lr_external_endpoint',basis='Exact terminal Thumb BX LR bytes; unchanged incoming LR=08000001; PC/mode transition checked by native ABI exit',source_dispatch=raw['instructions'][-1]['pc']))
    l1['preconditions'].append('The explicitly bound VM register frame and native-return transaction are the invocation boundary')
    from contract import validate
    validate(l1)
    return l1,adapter


class _ControlLifter(_FrameLifter):
    """State ports introduced by the compiler, never mapped to native memory."""
    def __init__(self,l0,rom,registers,ports,known,domains,argument_contract=None):
        self.control_ports=ports;self.control_known=known
        super().__init__(l0,rom,registers,{},argument_contract=argument_contract)
        self.state_domains=domains
    def literal(self,v):
        if v in self.control_known:return self.control_known[v]
        definition=self.defs.get(v)
        if definition and definition['opcode']in ('INT_CARRY','INT_SCARRY','INT_SBORROW'):
            a,b=[self.literal(i)for i in definition['inputs']];bits=self.v[definition['inputs'][0]]['size']*8;mask=(1<<bits)-1
            if definition['opcode']=='INT_CARRY':return int(a+b>mask)
            sign=1<<(bits-1);result=(a+b if definition['opcode']=='INT_SCARRY'else a-b)&mask
            return int(bool((~(a^b) if definition['opcode']=='INT_SCARRY'else(a^b))&(a^result)&sign))
        return super().literal(v)
    def _resolve_access(self,o):
        if o['id']in self.control_ports:
            register=self.control_ports[o['id']]
            result=('state',('register',register),0,4)
            self.access[o['id']]=result
            return result
        return super()._resolve_access(o)
    def expr(self,v):
        o=self.defs.get(v)
        if o and o['opcode']!='LOAD':
            try:return const(self.literal(v),typ(self.v[v]['size']))
            except Unsupported:pass
        if o and o['opcode']in ('BOOL_AND','BOOL_OR'):
            for index,source in enumerate(o['inputs']):
                try:value=self.literal(source)
                except Unsupported:continue
                if o['opcode']=='BOOL_AND'and not value:return const(0,typ(self.v[v]['size']))
                if o['opcode']=='BOOL_OR'and value:return const(1,typ(self.v[v]['size']))
        if o and o['opcode']in ('INT_SCARRY','INT_SBORROW'):
            t=typ(self.v[v]['size']);a,b=[self.expr(i)for i in o['inputs']];zero=const(0,a['type'])
            sa=node('less_signed','u8',a,zero);sb=node('less_signed','u8',b,zero)
            result=node('add_wrap'if o['opcode']=='INT_SCARRY'else'sub_wrap',a['type'],a,b)
            sr=node('less_signed','u8',result,zero)
            return node('bool_and',t,node('equal'if o['opcode']=='INT_SCARRY'else'not_equal','u8',sa,sb),node('not_equal','u8',sr,sa),provenance=o['id'])
        try:return super().expr(v)
        except Unsupported as error:
            if 'pointer-like ROM literal' in str(error):raise Unsupported(str(error)+' <- '+v+':'+str(o and(o['pc'],o['opcode'])))from error
            raise
    def build(self):
        # The parent adds no final output assignments; per-exit compiler ports
        # were explicit SSA effects before structured CFG lowering.
        l1,adapter=super().build()
        native_fields={f['name']:f for f in adapter['fields']if f['owner']=='register'}
        # _FrameLifter already added bound input fields. Merge source port fields
        # into the same logical register instead of duplicating entry and exit.
        remap={};port_owners={}
        memory_names={field['name']for field in adapter['fields']if field['owner']!='register'}
        for field in adapter['fields']:
            if field['owner']=='register':
                register=field.get('register')or field['address']
                binding=self.frame_registers.get(register)
                name=binding['field']if isinstance(binding,dict)else'vm_'+register
                if name in memory_names or(name in port_owners and port_owners[name]!=register):raise Unsupported('VM control register port identity overlaps state')
                port_owners[name]=register
        for field in adapter['fields']:
            if field['owner']!='register' or field.get('register'):continue
            register=field['address'];name='vm_'+register
            if register in self.frame_registers and isinstance(self.frame_registers[register],dict):name=self.frame_registers[register]['field']
            remap[field['name']]=name
            field.update(name=name,register=register,address=None,argument=None,offset=0)
        def rewrite(value):
            if isinstance(value,list):
                for child in value:rewrite(child)
            elif isinstance(value,dict):
                if value.get('op')=='field'and value['name']in remap:value['name']=remap[value['name']]
                if value.get('op')=='assign_field'and value['field']in remap:value['field']=remap[value['field']]
                for child in value.values():rewrite(child)
        rewrite(l1['body'])
        for field in l1['state']:
            if field['name']in remap:field.update(name=remap[field['name']],owner='vm_register_frame')
        l1['state']=list({f['name']:f for f in l1['state']}.values())
        adapter['fields']=list({f['name']:f for f in adapter['fields']}.values())
        return l1,adapter


def lower_vm_control(raw_regions,rom,contract):
    """Bounded source-PC expansion of raw calls, branches and symbolic exits.

    No game algorithm is recognized. Direct CALL is only a PC transfer; the raw
    COPY to LR supplies its native return token. An explicit byte shadow proves
    indirect targets from ROM, fixed entry domains and source stores. Unknown
    code pointers, mode changes, writes that could invalidate the shadow, cycles
    and all unsupported effects fail closed.
    """
    required={'entry','registers','liveouts','clobbers','memory_constants','exit_dispatches','evidence'}
    if not required<=set(contract)or set(contract)-required-{'control_flow'}or not contract['evidence']:raise Unsupported('VM control exact boundary contract required')
    if 'control_flow'in contract and contract['control_flow']!='acyclic_basic_blocks/0.1':raise Unsupported('VM control unsupported control_flow form')
    registers=contract['registers'];liveouts=contract['liveouts']
    allowed={'r'+str(i)for i in range(13)}|{'lr','NG','ZR','CY','OV'}
    if set(registers)-allowed or registers.get('lr')!=0x08000001:raise Unsupported('VM control incoming register frame unsupported')
    for name,value in registers.items():
        if isinstance(value,dict):
            if set(value)!={'field'}or not isinstance(value['field'],str)or not value['field'].isidentifier():raise Unsupported('VM control symbolic input field invalid')
        elif type(value)is not int or not 0<=value<=0xffffffff:raise Unsupported('VM control register outside u32')
        if name in ('NG','ZR','CY','OV')and value!=0:raise Unsupported('VM control NZCV entry must be zero')
    field_names=[value['field']for value in registers.values()if isinstance(value,dict)]
    if len(field_names)!=len(set(field_names)):raise Unsupported('VM control register input fields must be distinct')
    for group in (liveouts,contract['clobbers']):
        if not isinstance(group,list)or len(group)!=len(set(group))or any(name not in {'r'+str(i)for i in range(13)}or name not in registers for name in group):raise Unsupported('VM control invalid full-register output classification')
    if set(liveouts)&set(contract['clobbers']):raise Unsupported('VM control overlapping output classifications')
    source={};source_hashes=[];userops={}
    for raw in raw_regions:
        if raw.get('format')!=FORMAT or raw.get('language')!='ARM:LE:32:v4t' or raw.get('rom_sha256')!=hashlib.sha256(rom).hexdigest():raise Unsupported('VM control raw source identity mismatch')
        for number,name in raw.get('user_defined_operations',{}).items():
            if number in userops and userops[number]!=name:raise Unsupported('VM control inconsistent user-op language map')
            userops[number]=name
        lo=int(raw['entry'],16);hi=int(raw['end_exclusive'],16)
        if not 0x08000000<=lo<hi<=0x08000000+len(rom)or lo&1 or hi&1:raise Unsupported('VM control source span outside canonical Thumb ROM')
        expected_pc=lo
        if not raw.get('instructions'):raise Unsupported('VM control empty raw region')
        if raw.get('source_span_sha256')!=hashlib.sha256(rom[lo-0x08000000:hi-0x08000000]).hexdigest():raise Unsupported('VM control source span hash mismatch')
        for instruction in raw['instructions']:
            pc=int(instruction['pc'],16);data=bytes.fromhex(instruction['bytes'])
            if pc!=expected_pc or len(data)not in (2,4)or pc+len(data)>hi:raise Unsupported('VM control raw instructions do not exactly cover pinned span')
            expected_pc=pc+len(data)
            operations=instruction.get('pcode',[])
            if not operations:raise Unsupported('VM control instruction has no raw semantics')
            if any(operation['opcode']in ('CALL','BRANCH','CBRANCH','RETURN','BRANCHIND')for operation in operations[:-1]):raise Unsupported('VM control has trailing effects after control transfer')
            if str(instruction.get('TMode'))!='1' or rom[pc-0x08000000:pc-0x08000000+len(data)]!=data:raise Unsupported('VM control instruction source mismatch')
            if pc in source and source[pc]!=instruction:raise Unsupported('VM conflicting source decode')
            source[pc]=instruction
        if expected_pc!=hi:raise Unsupported('VM control raw region omits pinned source bytes')
        source_hashes.append(hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest())
    if not 1<=len(source)<=512:raise Unsupported('VM control source instruction budget512')
    variables=[];v={};defs={};blocks=[];known={};ports={};memory={};domains={};memory_roles={}
    names={};shapes={};visited_steps=[0];exit_proofs=[];mode_proofs=[];written_registers=set()
    for item in contract['memory_constants']:
        if set(item)!={'address','width','value','role'}or item['width']not in (1,2,4)or item['role']not in ('continuation','entry_domain'):raise Unsupported('VM control initial memory fact invalid')
        address=item['address'];width=item['width'];value=item['value']
        if type(value)is not int or not 0<=value<1<<(width*8)or not(0x02000000<=address<address+width<=0x02040000 or 0x03000000<=address<address+width<=0x03007900):raise Unsupported('VM control memory fact outside canonical RAM')
        for byte in range(width):
            if address+byte in memory:raise Unsupported('VM control overlapping entry memory facts')
            memory[address+byte]=(value>>(byte*8))&255;memory_roles[address+byte]=item['role']
        if item['role']=='entry_domain':domains['global:0:'+str(address)]={'unsigned_min':value,'unsigned_max':value}
    def make(z,scope,environment,write=False):
        if z is None:return None
        space=z['space'];offset=_number(z['offset']);size=z['size'];typ(size)
        if space=='register':
            name=z.get('register')
            if not name:raise Unsupported('VM control missing raw register identity')
            key=(offset,size)
            if key in names and names[key]!=name:raise Unsupported('VM control inconsistent register identity')
            names[key]=name
            if write:written_registers.add(name)
        if space in ('register','unique'):
            storage_scope=(space,scope if space=='unique'else None)
            windows=shapes.setdefault(storage_scope,set())
            if any(offset<b and a<offset+size and(a,b)!=(offset,offset+size)for a,b in windows):raise Unsupported('VM control overlapping storage requires byte-lane SSA')
            windows.add((offset,offset+size))
        key=(space,offset,size,scope if space=='unique'else None)
        if not write and key in environment:return environment[key]
        constant=space=='const' or z.get('constant',False)
        rom_value=space=='ram'and 0x08000000<=offset<=0x08000000+len(rom)-size
        if not write and not constant and not rom_value and(space!='register'or z.get('register')not in registers):raise Unsupported('VM control undeclared entry storage '+str(key))
        if write and space not in ('register','unique'):raise Unsupported('VM control direct storage effect unsupported')
        identifier='v'+str(len(variables));row=dict(id=identifier,size=size,space=space,offset=str(offset),constant=constant,input=not write)
        if z.get('register'):row['register']=z['register']
        variables.append(row);v[identifier]=row;environment[key]=identifier
        if constant:known[identifier]=offset
        elif not write and space=='register'and type(registers[z['register']])is int:known[identifier]=registers[z['register']]
        return identifier
    class Evaluator(Lifter):
        def literal(self,value):
            seen=set()
            while value not in known:
                definition=defs.get(value)
                if value in seen:raise Unsupported('VM cyclic value')
                seen.add(value)
                if definition and definition['opcode']in ('COPY','MULTIEQUAL')and len(definition['inputs'])==1:value=definition['inputs'][0]
                else:break
            if value in known:return known[value]
            return super().literal(value)
    evaluator=object.__new__(Evaluator);evaluator.v=v;evaluator.defs=defs;evaluator.rom=rom;evaluator.param_domains={}
    def literal(identifier):
        try:return evaluator.literal(identifier)
        except Unsupported:return None
    def add(block,opcode,inputs,output=None,pc='00000000'):
        operation=dict(id='op'+str(sum(len(b['ops'])for b in blocks)),opcode=opcode,pc=pc,inputs=inputs)
        if output:operation['output']=output;defs[output]=operation
        block['ops'].append(operation)
        return operation
    def terminal(block,environment,pc):
        for register in liveouts:
            candidates=[identifier for key,identifier in environment.items()if key[0]=='register'and v[identifier].get('register')==register and key[2]==4]
            if len(candidates)!=1:raise Unsupported('VM control missing full-width liveout '+register)
            # A STORE is an internal typed state-port effect, resolved by the
            # subclass directly to register ownership, never to a RAM address.
            operation=add(block,'STORE',[c_zero,c_zero,candidates[0]],pc=f'{pc:08x}')
            ports[operation['id']]=register
        add(block,'RETURN',[],pc=f'{pc:08x}')
    c_zero=make(dict(space='const',offset='0',size=4,constant=True),None,{})
    # Join source tails by control context. Register phis retain data from every
    # predecessor; branches do not duplicate already recovered continuation code.
    register_inventory={}
    for instruction in source.values():
        for operation in instruction['pcode']:
            for z in operation['inputs']+([operation['output']]if operation.get('output')else[]):
                if z['space']=='register':register_inventory[('register',_number(z['offset']),z['size'],None)]=z
    initial={}
    for key,z in register_inventory.items():
        if z.get('register')in registers:initial[key]=make(z,None,initial)
        else:
            identifier='v'+str(len(variables));row=dict(id=identifier,size=z['size'],space='register',offset=str(_number(z['offset'])),constant=False,input=True,register=z.get('register'))
            variables.append(row);v[identifier]=row;initial[key]=identifier
    memo={};control_checks=[];fact_load_checks=[];conditional_proofs=[]
    stack_base=registers.get('r5')
    if type(stack_base)is not int:raise Unsupported('VM control fixed continuation frame required')
    entry_fact_addresses={address for address,role in memory_roles.items()if role=='entry_domain'}
    def control_shadow(address):return stack_base-256<=address<stack_base+256 or address in entry_fact_addresses
    def checked_access(address,size,write=False):
        if address is None:return
        canonical=(0x02000000<=address<address+size<=0x02040000 or 0x03000000<=address<address+size<=0x03008000)
        readonly=not write and 0x08000000<=address<address+size<=0x08000000+len(rom)
        if not canonical and not readonly:raise Unsupported('VM control memory access outside canonical RAM/ROM; mirror aliases unsupported')
    def reg_value(environment,name):
        ids=[value for key,value in environment.items()if key[0]=='register'and v[value].get('register')==name]
        return literal(ids[0])if len(ids)==1 else None
    def connect(node,incoming,predecessor):
        block=blocks[node['id']]
        if predecessor in block['predecessors']:raise Unsupported('VM duplicate source edge requires distinct phi lanes')
        block['predecessors'].append(predecessor)
        for key,operation in node['phis'].items():operation['inputs'].append(incoming.get(key,initial[key]))
        evaluator.literal_cache={}
    def graph(pc,incoming,shadow,path,predecessor=None):
        evaluator.literal_cache={}
        control_key=(pc,reg_value(incoming,'lr'),reg_value(incoming,'r5'),tuple(sorted((address,value)for address,value in shadow.items()if control_shadow(address))))
        if control_key in path:raise Unsupported('VM control cyclic source context requires loop proof')
        if control_key in memo:
            node=memo[control_key];connect(node,incoming,predecessor);return node['id']
        if len(blocks)>=1024:raise Unsupported('VM joined CFG budget1024')
        if pc not in source:raise Unsupported('VM joined target outside pinned source '+f'{pc:08x}')
        block=dict(id=len(blocks),start=f'{pc:08x}',stop=f'{pc:08x}',successors=[],predecessors=[],ops=[]);blocks.append(block)
        identifier=block['id'];environment={};node=dict(id=identifier,phis={});memo[control_key]=node
        if predecessor is None:environment=dict(initial)
        else:
            source_writes=set(written_registers)
            for key,z in register_inventory.items():
                output=make(z,None,environment,True)
                operation=add(block,'MULTIEQUAL',[],output,f'{pc:08x}');node['phis'][key]=operation
            written_registers.intersection_update(source_writes)
            connect(node,incoming,predecessor)
        visited_steps[0]+=1
        if visited_steps[0]>4096:raise Unsupported('VM joined source-step budget4096')
        instruction=source[pc];next_pc=pc+len(bytes.fromhex(instruction['bytes']));scope=visited_steps[0];condition=None;destination=None
        for raw_operation in instruction['pcode']:
            opcode=raw_operation['opcode'];ins=raw_operation['inputs'];pc_text=f'{pc:08x}'
            if opcode=='CALLOTHER':
                userop=raw_operation.get('userop_name',userops.get(str(_number(ins[0]['offset']))))
                if userop!='setISAMode'or len(ins)!=2:raise Unsupported('VM joined unknown source service')
                value=make(ins[1],scope,environment)
                if literal(value)!=1:raise Unsupported('VM joined non-Thumb mode transition')
                control_checks.append((value,1,'mode'));mode_proofs.append(pc_text);continue
            if opcode in ('CALL','BRANCH'):
                if len(ins)!=1 or ins[0]['space']!='ram':raise Unsupported('VM joined direct target unsupported')
                next_pc=_number(ins[0]['offset']);continue
            if opcode=='CBRANCH':
                if ins[0]['space']!='ram'or condition is not None:raise Unsupported('VM joined intra-instruction control unsupported')
                condition=make(ins[1],scope,environment);destination=_number(ins[0]['offset']);continue
            if opcode in ('RETURN','BRANCHIND'):
                value=make(ins[0],scope,environment);target=literal(value)
                if target is None:raise Unsupported('VM joined unresolved indirect target')
                control_checks.append((value,target,'indirect'))
                if target&0xfffffffe==0x08000000:
                    if pc_text not in contract['exit_dispatches']:raise Unsupported('VM joined uncontracted exit')
                    terminal(block,environment,pc);exit_proofs.append(dict(dispatch=pc_text,target='incoming_caller_continuation'));return identifier
                next_pc=target&0xfffffffe;continue
            allowed_ops={'COPY','LOAD','STORE','INT_ADD','INT_SUB','INT_MULT','INT_AND','INT_OR','INT_XOR','INT_EQUAL','INT_NOTEQUAL','INT_LESS','INT_SLESS','INT_LESSEQUAL','INT_SLESSEQUAL','INT_LEFT','INT_RIGHT','INT_SRIGHT','INT_ZEXT','INT_SEXT','INT_2COMP','INT_NEGATE','BOOL_NEGATE','BOOL_AND','BOOL_OR','BOOL_XOR','SUBPIECE','PIECE','INT_CARRY','INT_SCARRY','INT_SBORROW'}
            if opcode not in allowed_ops:raise Unsupported('VM joined unknown raw operation '+opcode)
            inputs=[make(z,scope,environment)for z in ins];output=make(raw_operation.get('output'),scope,environment,True)
            operation=add(block,opcode,inputs,output,pc_text);evaluator.literal_cache={}
            if opcode=='LOAD':
                address=literal(inputs[1]);size=v[output]['size'];checked_access(address,size)
                if address is not None and all(address+i in shadow for i in range(size)):
                    known[output]=sum(shadow[address+i]<<(8*i)for i in range(size));fact_load_checks.append((inputs[1],address))
            elif opcode=='STORE':
                address=literal(inputs[1]);value=literal(inputs[2]);size=v[inputs[2]]['size'];checked_access(address,size,True)
                if address is None:shadow.clear()
                else:
                    control_checks.append((inputs[1],address,'store address'))
                    if value is not None and any(control_shadow(address+i)for i in range(size)):control_checks.append((inputs[2],value,'control spill value'))
                    for i in range(size):
                        shadow.pop(address+i,None)
                        if value is not None and control_shadow(address+i):shadow[address+i]=(value>>(8*i))&255
        next_path=set(path);next_path.add(control_key)
        if condition is not None:
            evaluator.literal_cache={}
            condition_value=literal(condition)
            if condition_value is not None:
                # This is a proof under the declared entry context, not a loop
                # bound or a guessed branch policy. Recheck after every incoming
                # SSA edge has been connected; stale first-predecessor facts fail.
                control_checks.append((condition,condition_value,'conditional'))
                selected=destination if condition_value else next_pc
                excluded=next_pc if condition_value else destination
                conditional_proofs.append(dict(pc=f'{pc:08x}',condition=condition,value=condition_value,selected=f'{selected:08x}',excluded=f'{excluded:08x}'))
                block['successors']=[graph(selected,dict(environment),dict(shadow),next_path,identifier)]
                return identifier
            add(block,'CBRANCH',[c_zero,condition],pc=f'{pc:08x}')
            true=graph(destination,dict(environment),dict(shadow),next_path,identifier)
            false=graph(next_pc,dict(environment),dict(shadow),next_path,identifier)
            if true==false:raise Unsupported('VM joined duplicate conditional edge needs reduction')
            block.update(successors=[true,false],true_successor=true,false_successor=false)
        else:block['successors']=[graph(next_pc,dict(environment),dict(shadow),next_path,identifier)]
        return identifier
    graph(int(contract['entry'],16),initial,dict(memory),set())
    evaluator.literal_cache={}
    for value,expected,role in control_checks:
        if literal(value)!=expected:raise Unsupported('VM joined '+role+' fact changed after incoming state merge')
    for value,expected in fact_load_checks:
        if literal(value)!=expected:raise Unsupported('VM joined memory address fact changed after merge')
    unrepresented=written_registers.intersection({'r'+str(i)for i in range(4,12)})-set(liveouts)-set(contract['clobbers'])
    if unrepresented:raise Unsupported('VM control persistent writes lack output/clobber classification '+str(sorted(unrepresented)))
    if set(liveouts)&set(contract['clobbers']):raise Unsupported('VM control overlapping liveout/clobber classifications')
    l0=dict(format='gameverse.l0.highfunction/0.2',entry=contract['entry'],varnodes=variables,blocks=blocks,jump_tables=[])
    trivial={o['output']:o['inputs'][0]for b in blocks for o in b['ops']if o['opcode']=='MULTIEQUAL'and len(o['inputs'])==1}
    def root(value):
        seen=set()
        while value in trivial:
            if value in seen:raise Unsupported('VM cyclic trivial phi')
            seen.add(value);value=trivial[value]
        return value
    for block in blocks:
        for operation in block['ops']:operation['inputs']=[root(value)for value in operation['inputs']]
        block['ops']=[operation for operation in block['ops']if operation.get('output')not in trivial]
    known={root(value):constant for value,constant in known.items()}
    argument_contract={'control_flow':contract['control_flow']}if 'control_flow'in contract else None
    lifter=_ControlLifter(l0,rom,registers,ports,known,domains,**({'argument_contract':argument_contract}if argument_contract else{}))
    l1,adapter=lifter.build()
    for field in adapter['fields']:
        if field['owner']=='global':checked_access(field['address']+field['offset'],field['width']//8,True)
    for collection in adapter.get('collections',[]):
        if collection.get('address')is not None:checked_access(collection['address'],collection['size']*collection['count'],True)
    referenced_fields=set()
    def references(value):
        if isinstance(value,list):
            for child in value:references(child)
        elif isinstance(value,dict):
            if value.get('op')=='field':referenced_fields.add(value['name'])
            if value.get('op')=='assign_field':referenced_fields.add(value['field'])
            for child in value.values():references(child)
    references(l1['body'])
    control_only=set()
    for item in contract['memory_constants']:
        if item['role']!='continuation':continue
        matches=[field for field in adapter['fields']if field['owner']=='global'and field['address']+field['offset']==item['address']and field['width']==item['width']*8]
        for field in matches:
            if field['name']in referenced_fields:raise Unsupported('VM continuation token escaped control-only boundary; typed token codec required')
            control_only.add(field['name'])
    l1['state']=[field for field in l1['state']if field['name']not in control_only]
    adapter['fields']=[field for field in adapter['fields']if field['name']not in control_only]
    # Continuation seed facts are control preconditions. Other memory constants
    # must be represented by exactly fixed domains in native-visible input state.
    for item in contract['memory_constants']:
        if item['role']!='entry_domain':continue
        matches=[field for field in adapter['fields']if field['owner']=='global'and field['address']+field['offset']==item['address']and field['width']==item['width']*8]
        if len(matches)!=1 or matches[0].get('domain')!={'unsigned_min':item['value'],'unsigned_max':item['value']}:raise Unsupported('VM entry memory fact did not retain exact native-visible state domain')
    # Source-proven continuation spills are a finite control identity domain.
    # Numeric code addresses stay in the adapter; portable state stores tokens.
    continuation_tokens=[]
    for field in adapter['fields']:
        if field['owner']!='global'or field['width']!=32:continue
        address=field['address']+field['offset']
        if not stack_base-256<=address<stack_base+256:continue
        writes=[];reads=[]
        def token_uses(value):
            if isinstance(value,list):
                for child in value:token_uses(child)
            elif isinstance(value,dict):
                if value.get('op')=='field'and value['name']==field['name']:reads.append(value)
                if value.get('op')=='assign_field'and value['field']==field['name']:writes.append(value)
                for child in value.values():token_uses(child)
        token_uses(l1['body'])
        if not writes:continue
        if reads:raise Unsupported('VM continuation spill data use requires explicit token algebra')
        values=sorted({write['value']['value']for write in writes if write['value']['op']=='const'})
        if len(values)!=len({json.dumps(write['value'],sort_keys=True)for write in writes})or any(not(value&1)or(value&0xfffffffe)not in source for value in values):raise Unsupported('VM continuation spill is not an exact source code token')
        mapping={value:index+1 for index,value in enumerate(values)}
        for write in writes:write['value']=const(mapping[write['value']['value']])
        field['domain']={'unsigned_min':0,'unsigned_max':0}
        next(item for item in l1['state']if item['name']==field['name'])['domain']=dict(field['domain'])
        continuation_tokens.append(dict(field=field['name'],initial_token=0,tokens=[dict(token=token,native_value=value)for value,token in mapping.items()],source_evidence=dict(raw_source_sha256s=source_hashes,store_provenance=sorted({write['provenance']for write in writes}),basis='Exact raw source stores to bounded continuation spill; code target is a pinned Thumb instruction; portable entry spill is null')))
    if continuation_tokens:adapter['continuation_tokens']=continuation_tokens
    if conditional_proofs:
        adapter['assumptions'].append(dict(kind='exact_entry_context_conditional_edges',method='Literal p-code condition under declared frame/memory facts; revalidated after all incoming SSA joins',conditions=[dict(proof,condition=root(proof['condition']))for proof in conditional_proofs]))
    adapter['vm_control_contract']=deepcopy(contract)
    bundle=dict(format='gameverse.l0.raw-pcode-bundle/0.1',entry=contract['entry'],rom_sha256=hashlib.sha256(rom).hexdigest(),regions=raw_regions,control_contract=contract)
    adapter['normalized_l0_sha256']=adapter['l0_sha256']
    adapter['l0_sha256']=hashlib.sha256(json.dumps(bundle,sort_keys=True).encode()).hexdigest()
    adapter['l0_format']=bundle['format']
    adapter['raw_source_sha256s']=source_hashes
    adapter['assumptions'].append(dict(kind='bounded_raw_pc_register_frame_expansion',source_instructions=len(source),expanded_steps=visited_steps[0],expanded_blocks=len(blocks),source_mode_transitions=sorted(set(mode_proofs)),exits=exit_proofs))
    l1['preconditions'].append('Exact declared entry memory facts and register frame; source-proven caller continuation ends this transaction')
    from contract import validate
    validate(l1)
    return l1,adapter
