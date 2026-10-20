"""Opt-in finite pointer-pool lowering using canonical address-free handles.
Only an explicit adapter contract introduces the native identity bijection.
The existing SSA lifter still recovers every branch, load snapshot and write.
"""
from copy import deepcopy
from lift import Lifter, Unsupported, const, node


def _codec_domain(base,stride,capacity):
    if type(base)is not int or type(stride)is not int or type(capacity)is not int or base<1 or base%4 or stride<4 or stride%4 or not 1<=capacity<=64 or base+(capacity-1)*stride>0xffffffff:
        raise ValueError('invalid exact pointer codec domain')


def encode_pointer(pointer, *, base, stride, capacity, nullable=True):
    """Native pointer -> handle; reject every address outside the exact domain."""
    _codec_domain(base,stride,capacity)
    if type(pointer) is not int or not 0 <= pointer <= 0xffffffff:
        raise ValueError('pointer outside u32')
    if pointer == 0:
        if nullable:return 0
        raise ValueError('nonnull node required')
    delta=pointer-base
    if delta < 0 or delta % stride or delta//stride >= capacity:
        raise ValueError('unknown, misaligned or outside pointer pool')
    return delta//stride+1


def decode_handle(handle, *, base, stride, capacity, nullable=True):
    """Handle -> exact native identity; null is never a record index."""
    _codec_domain(base,stride,capacity)
    if type(handle) is not int or not (0 if nullable else 1) <= handle <= capacity:
        raise ValueError('handle outside pointer pool domain')
    return 0 if handle == 0 else base+(handle-1)*stride


def checked_contract(contract):
    c=deepcopy(contract)
    required={'id','capacity','node_argument','head_cells','link_lanes','native_base','record_stride','evidence','list_domain'}
    if set(c)!=required:raise Unsupported('pointer pool contract fields mismatch')
    if not isinstance(c['id'],str) or not c['id'].isidentifier():raise Unsupported('invalid pointer pool identity')
    if type(c['capacity']) is not int or not 1<=c['capacity']<=64:raise Unsupported('pointer pool capacity1..64 required')
    if c['node_argument'] not in ('r0','r1','r2','r3'):raise Unsupported('pointer pool node ABI unsupported')
    if not c['evidence']:raise Unsupported('pointer pool source evidence required')
    base,stride=c['native_base'],c['record_stride']
    if type(stride)is not int or not 4<=stride<=4096 or stride%4:raise Unsupported('pointer pool aligned stride required')
    if type(base)is not int or base%4 or not 0x02000000<=base<base+stride*c['capacity']<=0x02040000:raise Unsupported('pointer pool requires bounded canonical EWRAM')
    if stride*c['capacity']>4096:raise Unsupported('pointer pool native backing budget4096')
    cells=c['head_cells']
    if not isinstance(cells,list)or not cells or len(cells)>8 or len(set(cells))!=len(cells):raise Unsupported('pointer pool head cells invalid')
    if any(type(cell)is not int or cell%4 or not 0x02000000<=cell<=0x0203fffc or base<=cell<base+stride*c['capacity'] for cell in cells):raise Unsupported('head cell outside canonical separate storage')
    lanes=c['link_lanes']
    if not isinstance(lanes,list)or not lanes or len(lanes)>16:raise Unsupported('pointer pool lane budget')
    offsets=[]
    for lane in lanes:
        if set(lane)!={'offset','width'}or lane['width']!=4 or type(lane['offset'])is not int or lane['offset']%4 or not 0<=lane['offset']<=stride-4:raise Unsupported('pointer pool exact aligned u32 links required')
        offsets.append(lane['offset'])
    if len(set(offsets))!=len(offsets):raise Unsupported('duplicate/overlapping pointer pool lanes')
    domain=c['list_domain']
    if set(domain)!={'head_cell','older_offset','newer_offset','node_membership'}or domain['head_cell']not in cells or domain['older_offset']not in offsets or domain['newer_offset']not in offsets or domain['older_offset']==domain['newer_offset']or domain['node_membership']not in ('present','absent'):raise Unsupported('explicit acyclic intrusive-list domain required')
    return c


def validate_list_domain(head,lanes,node_handle,contract):
    """Reject malformed entry state before executing a qualified list operation."""
    c=checked_contract(contract);capacity=c['capacity'];d=c['list_domain']
    decode_handle(node_handle,base=c['native_base'],stride=c['record_stride'],capacity=capacity,nullable=False)
    if set(lanes)!={x['offset']for x in c['link_lanes']}or any(len(v)!=capacity for v in lanes.values()):raise ValueError('list lane extent mismatch')
    for handle in [head,*[h for values in lanes.values()for h in values]]:decode_handle(handle,base=c['native_base'],stride=c['record_stride'],capacity=capacity)
    seen=set();current=head;newer=0
    while current:
        if current in seen:raise ValueError('cyclic list')
        seen.add(current)
        if lanes[d['newer_offset']][current-1]!=newer:raise ValueError('inconsistent reciprocal/newer link')
        newer,current=current,lanes[d['older_offset']][current-1]
    if (node_handle in seen)!=(d['node_membership']=='present'):raise ValueError('node membership precondition violated')
    return True


class PointerPoolLifter(Lifter):
    """Source-directed pointer recognition; no function-address special cases."""
    def __init__(self,l0,rom,*,pointer_pool_contract,**kwargs):
        self.pointer_pool_contract=checked_contract(pointer_pool_contract)
        c=self.pointer_pool_contract
        domains=dict(kwargs.pop('param_domains',{}));domains[c['node_argument']]={'unsigned_min':1,'unsigned_max':c['capacity']}
        super().__init__(l0,rom,param_domains=domains,**kwargs)
        self.pool_lanes={lane['offset']:lane for lane in c['link_lanes']}
        self.pool_handle_vars=set()
        self._nonnull_facts=None

    def _root(self,v):
        o=self.defs.get(v)
        return self._root(o['inputs'][0])if o and o['opcode']in('COPY','CAST','INDIRECT')else v

    def _nonnull(self,bid):
        if self._nonnull_facts is None:
            # Source branch facts, intersected at joins. Unreachable/bypassed
            # checks cannot grant a nonnull fact to a dereference.
            entry=min(self.blocks);facts={entry:set()};pending=[entry];edge={}
            while pending:
                b=pending.pop(0);block=self.blocks[b];base=set(facts[b]);guard=None
                branch=next((o for o in block['ops']if o['opcode']=='CBRANCH'),None)
                if branch:
                    comparison=self.defs.get(self._root(branch['inputs'][1]))
                    if comparison and comparison['opcode']in('INT_EQUAL','INT_NOTEQUAL'):
                        a,z=comparison['inputs']
                        for handle,zero in [(a,z),(z,a)]:
                            try:iszero=self.literal(zero)==0
                            except Unsupported:iszero=False
                            if iszero:guard=(self._root(handle),comparison['opcode']=='INT_NOTEQUAL');break
                for target in block['successors']:
                    value=set(base)
                    if guard and target==block.get('true_successor'if guard[1]else'false_successor'):value.add(guard[0])
                    edge[b,target]=value
                    if all((pred,target)in edge for pred in self.blocks[target]['predecessors']):
                        joined=set.intersection(*(edge[pred,target]for pred in self.blocks[target]['predecessors']))
                        if target not in facts or facts[target]!=joined:facts[target]=joined;pending.append(target)
            self._nonnull_facts=facts
        return self._nonnull_facts.get(bid,set())

    def _ptr(self,v):
        z=self.v[v];o=self.defs.get(v);c=self.pointer_pool_contract
        if z.get('input')and z.get('register')==c['node_argument']:
            self.pool_handle_vars.add(self._root(v));return('pointer_pool',(self.expr(v),self._root(v)),const(0))
        if o and o['opcode']in('COPY','CAST','INDIRECT'):return self.ptr(o['inputs'][0])
        if o and o['opcode']in('INT_ADD','PTRSUB'):
            a,b=o['inputs']
            for pointer,delta in [(a,b),(b,a)]:
                try:p=self.ptr(pointer);n=self.literal(delta)
                except Unsupported:continue
                if p[0]=='pointer_pool':return(p[0],p[1],self.fold(node('add_wrap','u32',p[2],const(n))))
        if o and o['opcode']=='LOAD'and z['size']==4:
            access=self.resolve_access(o)
            if self._is_handle_access(access):
                self.pool_handle_vars.add(self._root(v));return('pointer_pool',(self.expr(v),self._root(v)),const(0))
        return super()._ptr(v)

    def _is_handle_access(self,access):
        kind,owner,start,size=access
        return size==4 and ((kind=='collection'and owner[0]=='pointer_pool')or(kind=='state'and owner==('global',0)and start in self.pointer_pool_contract['head_cells']))

    def _resolve_access(self,o):
        p=self.ptr(o['inputs'][1]);c=self.pointer_pool_contract
        if p[0]!='pointer_pool':
            access=super()._resolve_access(o)
            if not self._is_handle_access(access):raise Unsupported('pointer pool operation accesses undeclared storage')
            return access
        size=self.v[o['output']if o['opcode']=='LOAD'else o['inputs'][2]]['size']
        if p[2]['op']!='const'or p[2]['value']not in self.pool_lanes or size!=4:raise Unsupported('pointer pool access is not an exact declared link lane')
        handle,var=p[1];z=self.v[var]
        node_input=z.get('input')and z.get('register')==c['node_argument']
        facts=self._nonnull(self.operation_blocks[o['id']])
        if not node_input and var not in facts and not self._guarded_reload(var,facts):raise Unsupported('nullable pointer pool dereference lacks dominating nonnull source guard')
        offset=p[2]['value'];key=('pointer_pool',c['id'],offset)
        collection=self.collections.setdefault(key,{'name':'pointer_lane_'+str(offset//4),'size':4,'count':c['capacity'],'refs':[],'address':None,'owner':'pointer_pool','argument':None,'reference':c['id'],'offset':offset,'stride':c['record_stride'],'canonical_pool':True})
        collection['refs'].append(o['id']);result=('collection',key,node('sub_wrap','u32',handle,const(1)),4)
        self.access[o['id']]=result;return result

    def _direct_node_offset(self,v):
        v=self._root(v);z=self.v[v];o=self.defs.get(v)
        if z.get('input')and z.get('register')==self.pointer_pool_contract['node_argument']:return 0
        if o and o['opcode']in ('INT_ADD','PTRSUB'):
            for base,delta in [o['inputs'],list(reversed(o['inputs']))]:
                offset=self._direct_node_offset(base)
                if offset is not None:
                    try:return offset+self.literal(delta)
                    except Unsupported:pass
        return None

    def _node_neighbor(self,v):
        o=self.defs.get(self._root(v))
        if not o or o['opcode']!='LOAD':return False
        p=self.ptr(o['inputs'][1])
        if p[0]!='pointer_pool' or p[2]['op']!='const':return False
        root=p[1][1];z=self.v[root]
        if any(self._direct_node_offset(store['inputs'][1])==p[2]['value']for block in self.blocks.values()for store in block['ops']if store['opcode']=='STORE'):return False
        return bool(z.get('input')and z.get('register')==self.pointer_pool_contract['node_argument']and p[2]['value']in (self.pointer_pool_contract['list_domain']['older_offset'],self.pointer_pool_contract['list_domain']['newer_offset']))

    def _guarded_reload(self,var,facts):
        if self.pointer_pool_contract['list_domain']['node_membership']!='present':return False
        o=self.defs.get(var)
        if not o or o['opcode']!='LOAD':return False
        p=self.ptr(o['inputs'][1])
        if p[0]!='pointer_pool':return False
        z=self.v[p[1][1]]
        if not(z.get('input')and z.get('register')==self.pointer_pool_contract['node_argument']):return False
        for prior in facts:
            load=self.defs.get(prior)
            if not load or load['opcode']!='LOAD':continue
            q=self.ptr(load['inputs'][1])
            if q!=p:continue
            safe=True
            for block in self.blocks.values():
                for store in block['ops']:
                    if store['opcode']!='STORE':continue
                    target=self.ptr(store['inputs'][1])
                    if target[0]!='pointer_pool' or target[2]!=p[2]:continue
                    # In an acyclic wellformed list, either neighbor differs
                    # from the current node. All identities still share lanes.
                    if not self._node_neighbor(target[1][1]):safe=False
            if safe:
                self.assumptions.append({'kind':'guarded_pointer_lane_reload','provenance':o['id'],'guarded_value':prior,'basis':'Same current-node lane; all possible writes to this lane belong to a distinct acyclic-list neighbor under validated entry domain'})
                return True
        return False

    def _is_handle(self,v):
        root=self._root(v);z=self.v[root];o=self.defs.get(root)
        if z.get('constant'):return int(z['offset'])==0
        if z.get('input')and z.get('register')==self.pointer_pool_contract['node_argument']:return True
        return bool(o and o['opcode']=='LOAD'and self._is_handle_access(self.resolve_access(o)))

    def store(self,o):
        if self._is_handle_access(self.access[o['id']])and not self._is_handle(o['inputs'][2]):raise Unsupported('non-handle value escapes into pointer pool')
        return super().store(o)

    def collect(self):
        # Audit an isolated original-CFG view before exact handle domains can
        # prune source blocks. Probe state never enters emitted artifacts.
        probe=deepcopy(self);probe.param_domains={}
        probe.operation_blocks={o['id']:b['id']for b in probe.blocks.values()for o in b['ops']}
        for block in probe.blocks.values():
            for operation in block['ops']:
                if operation['opcode']in ('LOAD','STORE'):probe.resolve_access(operation)
        probe._audit_pointer_uses()
        super().collect()

    def _audit_pointer_uses(self):
        # The bijection preserves nullness/identity, not native numeric address
        # arithmetic. Audit every SSA consumer, including otherwise dead uses.
        kinds={v['id']:'handle'for v in self.v.values()if v.get('input')and v.get('register')==self.pointer_pool_contract['node_argument']}
        operations=[o for b in self.blocks.values()for o in b['ops']]
        for o in operations:
            if o['opcode']=='LOAD'and self._is_handle_access(self.access[o['id']]):kinds[o['output']]='handle'
        changed=True
        while changed:
            changed=False
            for o in operations:
                out=o.get('output');op=o['opcode'];ins=o['inputs'];kind=None
                if not out:continue
                if op in ('COPY','CAST','INDIRECT')and ins[0]in kinds:kind=kinds[ins[0]]
                elif op in ('INT_ADD','PTRSUB'):
                    tagged=[i for i in ins if i in kinds]
                    if len(tagged)==1:
                        delta=next(i for i in ins if i not in kinds)
                        try:self.literal(delta);kind='address'
                        except Unsupported:pass
                if kind is not None and kinds.get(out)!=kind:kinds[out]=kind;changed=True
        for o in operations:
            op=o['opcode'];ins=o['inputs'];out=o.get('output')
            for index,value in enumerate(ins):
                kind=kinds.get(value)
                if kind is None:continue
                if self.v[value]['size']!=4:raise Unsupported('pointer pool source pointer width must be32bits')
                if op in ('COPY','CAST','INDIRECT')and index==0 and out and self.v[out]['size']==4:continue
                if op in ('INT_ADD','PTRSUB')and kinds.get(out)=='address' and self.v[out]['size']==4:continue
                if op=='LOAD'and index==1 and kind=='address':continue
                if op=='STORE'and ((index==1 and kind=='address')or(index==2 and kind=='handle'and self._is_handle_access(self.access[o['id']]))):continue
                if op in ('INT_EQUAL','INT_NOTEQUAL')and kind=='handle':
                    other=ins[1-index]
                    try:zero=self.literal(other)==0
                    except Unsupported:zero=False
                    if zero and self.v[other]['size']==4:continue
                raise Unsupported('unsupported pointer scalar use '+op+' at '+o['id'])

    def build(self):
        l1,adapter=super().build();c=deepcopy(self.pointer_pool_contract)
        c['collections']=[{'name':z['name'],'offset':z['offset'],'width':z['size']}for z in adapter['collections']if z.get('owner')=='pointer_pool']
        c['fields']=[{'name':f['name'],'cell':f['address']+f['offset']}for f in adapter['fields']if f['owner']=='global'and f['address']+f['offset']in c['head_cells']]
        for parameter in adapter['parameters']:
            if parameter['register']==c['node_argument']:parameter['derived_pointer_handle']=True
        adapter['pointer_pools']=[c]
        l1['preconditions']=['Node handle is1..capacity; nullable link/head handles are0..capacity','All head/node/link aliases share one canonical arena; source list membership and neighbor consistency hold at invocation']
        l1['state_owners']=[{'id':c['id'],'identity':c['id'],'ownership':'canonical_shared_pointer_pool','lifetime':'across_calls','evidence':c['evidence']}]
        adapter['assumptions'].append({'kind':'explicit_finite_pointer_pool','identity':c['id'],'capacity':c['capacity'],'basis':'Source identity-preserving pointer codec, bounded qualification domain; not inferred game allocation capacity','evidence':c['evidence']})
        return l1,adapter
