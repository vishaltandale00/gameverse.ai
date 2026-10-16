"""Fail-closed p-code SSA to structured, symbolic behavior IR (acyclic subset).
No pseudo-C or recovered source is consumed. Machine layout is adapter-only.
"""
from pathlib import Path
import argparse, collections, hashlib, json, struct

class Unsupported(ValueError): pass

def typ(size):
    if size not in (1,2,4,8): raise Unsupported('unsupported storage width '+str(size))
    return 'u'+str(size*8)
def const(value,t='u32'): return {'op':'const','type':t,'value':value}
def node(op,t,*args,**kw): return dict(op=op,type=t,args=list(args),**kw)

class Lifter:
    def __init__(self,l0,rom,callees=None,param_domains=None,object_contract=None,state_domains=None):
        self.l0=l0; self.rom=rom; self.callees=callees or {};self.dependencies={};self.param_domains=param_domains or {};self.call_results={}; self.v={v['id']:v for v in l0['varnodes']}
        self.blocks={b['id']:b for b in l0['blocks']}
        self.defs={o['output']:o for b in l0['blocks']for o in b['ops']if o.get('output')}
        self.loads={};self.phis={};self.access={};self.fields={};self.assets={};self.assumptions=[];self.expanded=0;self.params={};self.collections={};self.object_refs={};self.object_contract=object_contract or {};self.state_domains=state_domains or {};self.reference_loads=set();self.return_value=None;self.expression_nodes=0;self.bound_active=set()
    def literal(self,v):
        z=self.v[v]
        if z['constant']:return int(z['offset'])
        if z['space']=='ram':
            off=int(z['offset'])-0x08000000
            if not 0<=off<=len(self.rom)-z['size']:raise Unsupported('non-ROM direct memory value '+v)
            # Direct ROM varnodes denote values, not addresses; INDIRECT preserves
            # these only under the explicit nonaliasing RAM-state precondition.
            return int.from_bytes(self.rom[off:off+z['size']],'little')
        o=self.defs.get(v)
        if o and o['opcode']in('COPY','CAST','INDIRECT'):return self.literal(o['inputs'][0])
        if o and o['opcode']in('INT_ADD','PTRSUB','PTRADD'):
            xs=[self.literal(i)for i in o['inputs']];return(xs[0]+xs[1]*(xs[2]if len(xs)>2 else 1))&((1<<(z['size']*8))-1)
        if o and o['opcode']=='MULTIEQUAL':
            xs=[self.literal(i)for i in o['inputs']]
            if len(set(xs))==1:return xs[0]
        raise Unsupported('not constant '+v)
    def ptr(self,v):
        z=self.v[v]
        if z['input']and z['space']=='register':
            if z.get('register')not in ('r0','r1','r2','r3'):raise Unsupported('unknown pointer ABI '+v)
            return ('entity',z['register'],const(0))
        o=self.defs.get(v)
        try:
            n=self.literal(v)
            if 0x02000000<=n<0x04000000:return('global',n,const(0))
            if 0x08000000<=n<0x08000000+len(self.rom):return('asset',n,const(0))
        except Unsupported:pass
        if o and o['opcode']in('COPY','CAST','INDIRECT'):return self.ptr(o['inputs'][0])
        if o and o['opcode']=='MULTIEQUAL':
            ps=[self.ptr(i)for i in o['inputs']]
            if all(p==ps[0]for p in ps):return ps[0]
            raise Unsupported('unresolved pointer phi '+v)
        if o and o['opcode'] in ('INT_ADD','PTRADD','PTRSUB'):
            a,b=o['inputs'][:2]
            if o['opcode']=='PTRADD':
                p=self.ptr(a);delta=node('mul_wrap','u32',self.expr(b),self.expr(o['inputs'][2]))
            else:
                try:p=self.ptr(a);delta=self.expr(b)
                except Unsupported:p=self.ptr(b);delta=self.expr(a)
            return (p[0],p[1],self.fold(node('add_wrap','u32',p[2],delta)))
        if o and o['opcode']=='LOAD' and z['size']==4:
            source=self.ptr(o['inputs'][1])
            if source[0]!='global' or source[2]['op']!='const':raise Unsupported('dynamic or nested object reference unresolved')
            cell=source[1]+source[2]['value'];name=self.object_refs.setdefault(cell,'context_object_'+str(len(self.object_refs)));self.reference_loads.add(o['id']);return('reference',name,const(0))
        n=self.literal(v)
        if 0x02000000<=n<0x04000000:return('global',n,const(0))
        if 0x08000000<=n<0x08000000+len(self.rom):return('asset',n,const(0))
        raise Unsupported('unresolved pointer '+v)
    def fold(self,e):
        if e['op']=='const':return e
        a=[self.fold(z) for z in e.get('args',[])];e=dict(e, args=a)
        if e['op']=='sub_wrap'and a[1]['op']=='const'and a[0]['op']=='add_wrap':
            for i,z in enumerate(a[0]['args']):
                if z['op']=='const'and z['value']==a[1]['value']:return a[0]['args'][1-i]
        if a and all(z['op']=='const'for z in a):
            x,y=[z['value']for z in a]
            if e['op']=='add_wrap':return const((x+y)&0xffffffff)
            if e['op']=='mul_wrap':return const((x*y)&0xffffffff)
        return e
    def bounds(self,e):
        op=e['op'];width=int(e['type'][1:])
        if op=='const':return(e['value'],e['value'])
        if op=='local':
            key='v'+e['name'].removeprefix('value_')if e['name'].startswith('value_')else'';definition=self.defs.get(key)
            if definition and definition['opcode']=='LOAD':
                access=self.access.get(definition['id'])or self.resolve_access(definition)
                if access[0]=='state':
                    d=self.state_domain(access[1],access[2])
                    if d:return(d['unsigned_min'],d['unsigned_max'])
            if definition and definition['opcode']=='MULTIEQUAL'and key not in self.bound_active:
                self.bound_active.add(key)
                try:
                    ranges=[self.bounds(self.expr(v))for v in definition['inputs']];return(min(r[0]for r in ranges),max(r[1]for r in ranges))
                finally:self.bound_active.remove(key)
            return(0,(1<<width)-1)
        if op=='field':return(0,(1<<width)-1)
        if op=='zext':return self.bounds(e['args'][0])
        if op=='sext':
            lo,hi=self.bounds(e['args'][0]);source_width=int(e['args'][0]['type'][1:])
            if hi<1<<(source_width-1):return lo,hi
            if lo>=1<<(source_width-1):return lo|(((1<<width)-1)^((1<<source_width)-1)),hi|(((1<<width)-1)^((1<<source_width)-1))
        if op=='parameter':
            p=next(p for p in self.params.values()if p['name']==e['name']);d=p.get('domain',{});return(d.get('unsigned_min',0),d.get('unsigned_max',(1<<width)-1))
        if op=='shift_right' and e['args'][1]['op']=='const':
            a,b=self.bounds(e['args'][0]);n=e['args'][1]['value'];return(a>>n,b>>n)
        if op in('add_wrap','mul_wrap'):
            a,b=map(self.bounds,e['args']);lo,hi=(a[0]+b[0],a[1]+b[1])if op=='add_wrap'else(a[0]*b[0],a[1]*b[1])
            if hi<1<<width:return lo,hi
        if op=='shift_left'and e['args'][1]['op']=='const':
            a,b=self.bounds(e['args'][0]);n=e['args'][1]['value']
            if n<width and b<<n<1<<width:return(a<<n,b<<n)
        if op=='extract':return(0,min((1<<width)-1,self.bounds(e['args'][0])[1]>>e['args'][1]['value']))
        if op=='bit_and'and e['args'][1]['op']=='const':return(0,min(self.bounds(e['args'][0])[1],e['args'][1]['value']))
        if op=='bit_or':
            a,b=map(self.bounds,e['args'])
            if(a[1]-a[0]+1)*(b[1]-b[0]+1)<=256:
                xs=[x|y for x in range(a[0],a[1]+1)for y in range(b[0],b[1]+1)];return min(xs),max(xs)
        return(0,(1<<width)-1)
    def state_domain(self,owner,start):
        if owner[0]=='reference':identity=next(f'{cell:08x}'for cell,name in self.object_refs.items()if name==owner[1])
        else:identity=str(owner[1])
        return self.state_domains.get(owner[0]+':'+identity+':'+str(start),{})
    def resolve_access(self,o):
        p=self.ptr(o['inputs'][1]);size=self.v[o['output']if o['opcode']=='LOAD'else o['inputs'][2]]['size']
        if p[0]=='asset':
            if o['opcode']=='STORE':raise Unsupported('write to ROM asset')
            lo,hi=self.bounds(p[2]);start=p[1]-0x08000000
            if hi>65536 or not 0<=start+lo<=start+hi+size<=len(self.rom):raise Unsupported('unbounded read-only asset index')
            key=(p[1],size);asset=self.assets.setdefault(key,{'name':'asset_'+str(len(self.assets)),'start':p[1],'width':size,'end':0,'refs':[]})
            asset['end']=max(asset['end'],hi+size);asset['refs'].append(o['id']);result=('asset',key,p[2],size)
        else:
            if p[2]['op']!='const':
                lo,hi=self.bounds(p[2])
                def aligned(e,n):
                    if n==1:return True
                    if e['op']=='const':return e['value']%n==0
                    if e['op']=='add_wrap':return all(aligned(z,n)for z in e['args'])
                    if e['op']=='mul_wrap':return any(aligned(z,n)for z in e['args'])
                    return False
                if hi-lo>4096 or lo%size or not aligned(p[2],size):raise Unsupported('unbounded or unaligned state collection')
                key=(p[0],p[1],lo,size)
                metadata={'address':p[1]+lo}if p[0]=='global'else{'address':None,'owner':p[0],'argument':p[1]if p[0]=='entity'else None,'reference':p[1]if p[0]=='reference'else None,'offset':lo}
                c=self.collections.setdefault(key,dict(name='collection_'+str(len(self.collections)),size=size,count=0,refs=[],**metadata))
                c['count']=max(c['count'],(hi-lo)//size+1);c['refs'].append(o['id']);delta=self.fold(node('sub_wrap','u32',p[2],const(lo)))if lo else p[2];result=('collection',key,node('shift_right','u32',delta,const(size.bit_length()-1)),size)
            else:
                start=p[2]['value']+(p[1]if p[0]=='global'else 0);owner=(p[0],0 if p[0]=='global'else p[1]);result=('state',owner,start,size)
        self.access[o['id']]=result;return result
    def collect(self):
        for b in self.blocks.values():
            for o in b['ops']:
                if o['opcode']in('LOAD','STORE'):self.resolve_access(o)
                if o['opcode']=='CALLIND':
                    v=self.v[o['inputs'][0]]
                    if not(v.get('input')and v.get('register')=='lr'and not b['successors']):raise Unsupported('unresolved indirect call')
                    self.assumptions.append({'kind':'terminal_incoming_lr_boundary','provenance':o['id'],'status':'requires_differential_check'})
                if o['opcode']=='CALL':
                    target=self.v[o['inputs'][0]]
                    entry=f'{int(target["offset"]):08x}'
                    if entry not in self.callees:raise Unsupported('unresolved callee closure '+entry)
                    if o.get('output'):self.call_results[o['output']]=o
                    self.dependencies[entry]=self.callees[entry]
                if o['opcode']=='CALLOTHER':raise Unsupported('unsupported effect/control '+o['opcode'])
        # A single stable context object is a typed ownership precondition.
        # Multiple unknown references or rebinding would require alias analysis.
        if self.object_refs:
            if any(kind=='state'and owner[0]=='entity'for kind,owner,start,size in self.access.values()):raise Unsupported('object/reference argument alias closure unresolved')
            if len(self.object_refs)>1:
                contracts=[self.object_contract.get(f'{cell:08x}')for cell in self.object_refs]
                if not all(c and c.get('ownership')=='distinct_access_windows'and c.get('evidence')for c in contracts):raise Unsupported('multiple object reference alias closure unresolved')
                if len({c['identity']for c in contracts})!=len(contracts):raise Unsupported('object alias identity contract unresolved')
                windows=[]
                for kind,owner,start,size in self.access.values():
                    if kind!='state':continue
                    if owner[0]=='global':windows.append((owner,start,start+size))
                    elif owner[0]=='reference':
                        cell=next(cell for cell,name in self.object_refs.items()if name==owner[1]);contract=self.object_contract[f'{cell:08x}']
                        if not contract.get('observed_targets'):raise Unsupported('object window separation lacks observed roots')
                        for target in contract['observed_targets']:windows.append((owner,target+start,target+start+size))
                for c in self.collections.values():
                    if c['address']is not None:windows.append((('global',0),c['address'],c['address']+c['count']*c['size']))
                    elif c['owner']=='reference':
                        cell=next(cell for cell,name in self.object_refs.items()if name==c['reference']);contract=self.object_contract[f'{cell:08x}']
                        for target in contract['observed_targets']:windows.append((('reference',c['reference']),target+c['offset'],target+c['offset']+c['count']*c['size']))
                for i,(owner,a,b)in enumerate(windows):
                    if any(owner!=other and a<d and c<b for other,c,d in windows[i+1:]):raise Unsupported('observed accessed object/global views may alias')
            for b in self.blocks.values():
                for o in b['ops']:
                    if o['opcode']=='STORE':
                        kind,owner,start,size=self.access[o['id']]
                        if kind=='state'and owner[0]=='global'and any(start<cell+4 and cell<start+size for cell in self.object_refs):raise Unsupported('mutable object reference lifetime unresolved')
                        ref_name=owner[1]if kind=='state'and owner[0]=='reference'else self.collections[owner].get('reference')if kind=='collection'else None
                        if ref_name:
                            cell=next(cell for cell,name in self.object_refs.items()if name==ref_name)
                            if self.object_contract.get(f'{cell:08x}',{}).get('storage')in('readonly_rom','readonly_during_call_ram'):raise Unsupported('write violates read-only object access contract')
            for key in self.reference_loads:self.access.pop(key,None)
        # Unresolved aliasing blocks promotion. Collections are typed, bounded
        # regions, not an excuse to duplicate overlapping mutable memory.
        regions=[(('global',0)if c['address']is not None else(c['owner'],c.get('reference')or c.get('argument')),c['address']if c['address']is not None else c['offset'],(c['address']if c['address']is not None else c['offset'])+c['size']*c['count'])for c in self.collections.values()]
        for i,(owner,a,b)in enumerate(regions):
            if any(owner==other and a<d and c<b for other,c,d in regions[i+1:]):raise Unsupported('overlapping state collections')
            if any(kind=='state'and own==owner and a<start+size and start<b for kind,own,start,size in self.access.values()):raise Unsupported('collection/field alias unresolved')
        # Partition overlap into nonoverlapping symbolic storage. Access views are
        # concatenations/slices, never independent aliased fields.
        owners=collections.defaultdict(list)
        for kind,owner,start,size in self.access.values():
            if kind=='state':owners[owner].append((start,start+size))
        for owner,ranges in sorted(owners.items()):
            bounds=sorted({i for a,b in ranges for i in(a,b)})
            for a,b in zip(bounds,bounds[1:]):
                if any(x<=a and b<=y for x,y in ranges):
                    if b-a not in(1,2,4,8):raise Unsupported('irregular overlapping storage partition')
                    self.fields[(owner,a)]={'name':'field_'+str(len(self.fields)),'size':b-a,'owner':'entity_'+owner[1]if owner[0]=='entity'else owner[1]if owner[0]=='reference'else'context','start':a}
    def field_expr(self,owner,start,size):
        pieces=[(a,f)for (own,a),f in self.fields.items()if own==owner and start<=a<a+f['size']<=start+size]
        if sum(f['size']for a,f in pieces)!=size:raise Unsupported('unresolved storage view')
        result=None
        for a,f in pieces:
            e={'op':'field','type':typ(f['size']),'name':f['name']}
            if f['size']!=size:e=node('zext',typ(size),e)
            if a!=start:e=node('shift_left',typ(size),e,const((a-start)*8))
            result=e if result is None else node('bit_or',typ(size),result,e)
        return result
    def expr(self,v):
        self.expression_nodes+=1
        if self.expression_nodes>100000:raise Unsupported('expression expansion budget')
        z=self.v[v];t=typ(z['size']);o=self.defs.get(v)
        if z['constant']:return const(int(z['offset']),t)
        if z['space']=='ram':
            value=self.literal(v)
            if 0x02000000<=value<0x08000000+len(self.rom):raise Unsupported('pointer-like ROM literal escaped as scalar')
            return const(value,t)
        if not o:
            if z['input']and z['space']=='register'and z.get('register')in('r0','r1','r2','r3'):
                if v not in self.params:self.params[v]={'name':'param_'+str(len(self.params)),'type':t,'register':z['register'],'domain':self.param_domains.get(z['register'],{})}
                return {'op':'parameter','type':t,'name':self.params[v]['name']}
            raise Unsupported('unresolved scalar argument '+v)
        op=o['opcode'];ins=o['inputs'];ref={'provenance':o['id']}
        if op=='CALL':
            if v not in self.call_results:raise Unsupported('unresolved return-valued callee')
            return dict(op='local',type=t,name='value_'+v[1:],**ref)
        if op=='LOAD':
            self.loads[v]=o
            return dict(op='local',type=t,name='value_'+v[1:],**ref)
        if op=='MULTIEQUAL':
            self.phis[v]=o
            return dict(op='local',type=t,name='value_'+v[1:],**ref)
        if op in('COPY','CAST','INDIRECT'):return self.expr(ins[0])
        if op=='SUBPIECE':return node('extract',t,self.expr(ins[0]),const(self.literal(ins[1])*8),**ref)
        operators={'INT_ADD':'add_wrap','INT_SUB':'sub_wrap','INT_MULT':'mul_wrap','INT_AND':'bit_and','INT_OR':'bit_or','INT_XOR':'bit_xor','INT_EQUAL':'equal','INT_NOTEQUAL':'not_equal','INT_LESS':'less_unsigned','INT_SLESS':'less_signed','INT_LESSEQUAL':'less_equal_unsigned','INT_SLESSEQUAL':'less_equal_signed','INT_LEFT':'shift_left','INT_RIGHT':'shift_right','INT_SRIGHT':'shift_arithmetic','INT_ZEXT':'zext','INT_SEXT':'sext','INT_2COMP':'neg_wrap','INT_NEGATE':'bit_not','BOOL_NEGATE':'bool_not','BOOL_AND':'bool_and','BOOL_OR':'bool_or'}
        if op in operators:return node(operators[op],t,*[self.expr(i)for i in ins],**ref)
        raise Unsupported('unsupported scalar opcode '+op)
    def read(self,o):
        kind,owner,start,size=self.access[o['id']]
        if kind=='collection':return dict(op='collection_read',type=typ(size),collection=self.collections[owner]['name'],index=start,provenance=o['id'])
        if kind=='asset':return dict(op='asset_read',type=typ(size),asset=self.assets[owner]['name'],index=start,provenance=o['id'])
        return self.field_expr(owner,start,size)
    def store(self,o):
        kind,owner,start,size=self.access[o['id']]
        e=self.expr(o['inputs'][2]);ss=[]
        if kind=='collection':return [{'op':'assign_collection','collection':self.collections[owner]['name'],'index':start,'value':e,'provenance':o['id']}]
        if kind!='state':raise Unsupported('mutable asset')
        for (own,a),f in self.fields.items():
            if own==owner and start<=a<a+f['size']<=start+size:
                value=e if size==f['size']else node('extract',typ(f['size']),e,const((a-start)*8))
                ss.append({'op':'assign_field','field':f['name'],'value':value,'provenance':o['id']})
        return ss
    def build(self):
        self.collect()
        # Root the scalar slice in observable stores and branches. Preserve loads
        # as snapshots at their original ordered position, including before writes.
        for b in self.blocks.values():
            for o in b['ops']:
                if o['opcode']=='STORE':self.expr(o['inputs'][2])
                elif o['opcode']=='CBRANCH':self.expr(o['inputs'][1])
                elif o['opcode']=='CALLIND'and len(o['inputs'])==2:self.return_value=self.expr(o['inputs'][1])
                elif o['opcode']=='RETURN'and len(o['inputs'])==2:self.return_value=self.expr(o['inputs'][1])
                elif o['opcode']=='BRANCHIND':self.expr(o['inputs'][0])
                elif o['opcode']=='CALL':
                    for v in o['inputs'][1:]:self.expr(v)
        pending=set()
        while set(self.phis)-pending:
            for v in list(set(self.phis)-pending):
                pending.add(v)
                for i in self.phis[v]['inputs']:self.expr(i)
        # Asset-index expressions may introduce additional loads.
        # Compute immediate postdominators so sequential reconverging branches
        # remain linear-sized structured code instead of duplicating all tails.
        all_ids=set(self.blocks);post={i:({i}if not b['successors']else set(all_ids))for i,b in self.blocks.items()}
        changed=True
        while changed:
            changed=False
            for i,b in self.blocks.items():
                if b['successors']:
                    value={i}|set.intersection(*(post[j]for j in b['successors']))
                    if value!=post[i]:post[i]=value;changed=True
        joins={}
        for i in self.blocks:
            candidates=post[i]-{i}
            closest=[c for c in candidates if all(d==c or d in post[c]for d in candidates)]
            if len(closest)==1:joins[i]=closest[0]
        def region(bid,pred,path,stop=None):
            self.expanded+=1
            if self.expanded>2048:raise Unsupported('structured expansion budget')
            if bid in path:raise Unsupported('loop CFG not yet structured')
            b=self.blocks[bid];ss=[]
            if bid==stop:
                if pred is not None:
                    for o in b['ops']:
                        out=o.get('output')
                        if o['opcode']=='MULTIEQUAL'and out in self.phis:
                            ss.append({'op':'assign_local','local':'value_'+out[1:],'value':self.expr(o['inputs'][b['predecessors'].index(pred)]),'provenance':o['id']})
                return ss
            for o in b['ops']:
                op=o['opcode'];out=o.get('output')
                if op=='MULTIEQUAL'and out in self.phis:
                    if pred is None:continue
                    if pred not in b['predecessors']:raise Unsupported('phi predecessor mismatch')
                    e=self.expr(o['inputs'][b['predecessors'].index(pred)])
                    ss.append({'op':'assign_local','local':'value_'+out[1:],'value':e,'provenance':o['id']})
                elif op=='LOAD'and out in self.loads:ss.append({'op':'assign_local','local':'value_'+out[1:],'value':self.read(o),'provenance':o['id']})
                elif op=='STORE':ss.extend(self.store(o))
                elif op=='CBRANCH':
                    join=joins.get(bid)
                    ss.append({'op':'if','condition':self.expr(o['inputs'][1]),'then':region(b['true_successor'],bid,path+[bid],join),'else':region(b['false_successor'],bid,path+[bid],join),'provenance':o['id']})
                    if join is not None:ss.extend(region(join,None,path+[bid],stop))
                    return ss
                elif op=='CALL':
                    entry=format(int(self.v[o["inputs"][0]]["offset"]),"08x");dep,da=self.dependencies[entry]
                    arguments={}
                    for p in da['parameters']:
                        slot=int(p['register'][1:])+1
                        if slot>=len(o['inputs']):raise Unsupported('callee ABI argument missing')
                        argument=self.expr(o['inputs'][slot]);domain=p.get('domain',{})
                        if domain:
                            lo,hi=self.bounds(argument)
                            if lo<domain.get('unsigned_min',0)or hi>domain.get('unsigned_max',(1<<int(p['type'][1:]))-1):raise Unsupported('callee parameter domain unproven')
                        arguments[p['name']]=node('extract',p['type'],argument,const(0))
                    ss.append(dict(op='call',dependency=list(self.dependencies).index(entry),arguments=arguments,provenance=o['id'],**({'result':'value_'+out[1:]}if out else{})))
                elif op=='BRANCHIND':
                    table=next((t for t in self.l0.get('jump_tables',[])if t['pc']==o['pc']),None)
                    if not table:raise Unsupported('unresolved jump table')
                    guards=table.get('prior_conditional_guards',[])
                    targets={g['target_block']for g in guards if g['target_block']in b['successors']}
                    if len(targets)!=1:raise Unsupported('switch default guard unresolved')
                    default=next(iter(targets))
                    if default not in b['successors']:raise Unsupported('switch guard not CFG successor')
                    self.assumptions.append({'kind':'default_edge_from_unique_prior_machine_guard','provenance':o['id'],'status':'requires_exhaustive_selector_differential_check'})
                    cases=collections.defaultdict(list)
                    for c in table['cases']:
                        if 'label'not in c:raise Unsupported('unlabeled switch destination')
                        if c['block']<0 or c['block']not in b['successors']:raise Unsupported('unresolved switch target')
                        if c['block']!=default:cases[c['block']].append(c['label'])
                    ss.append({'op':'switch','selector':self.expr(o['inputs'][0]),'cases':[{'values':values,'body':region(target,bid,path+[bid])}for target,values in cases.items()],'default':region(default,bid,path+[bid]),'provenance':o['id']});return ss
                elif op=='CALLIND' and len(o['inputs'])==2:
                    ss.append({'op':'return','value':self.expr(o['inputs'][1]),'provenance':o['id']});return ss
                elif op=='RETURN':
                    if len(o['inputs'])>2:raise Unsupported('multiple return values ABI not qualified')
                    ss.append(dict(op='return',provenance=o['id'],**({'value':self.expr(o['inputs'][1])}if len(o['inputs'])==2 else{})));return ss
            if len(b['successors'])==1:ss.extend(region(b['successors'][0],bid,path+[bid],stop))
            elif b['successors']:raise Unsupported('unresolved control flow')
            return ss
        body=region(min(self.blocks),None,[])
        for key,a in self.assets.items():
            start=a['start']-0x08000000;end=a['end'];a['data']=list(self.rom[start:start+end])
        def field(f):return dict({'name':f['name'],'owner':f['owner'],'storage_type':typ(f['size']),'semantic_type':{'quantity':'unknown','unit':'unknown','frame':'unknown','confidence':0.0,'evidence':[]}},**({'domain':self.state_domain(next(owner for(owner,start),z in self.fields.items()if z is f),f['start'])}if self.state_domain(next(owner for(owner,start),z in self.fields.items()if z is f),f['start'])else{}))
        l1={'schema':'gameverse.l1.behavior/0.2','id':'behavior_0','parameters':[{'name':p['name'],'storage_type':p['type'],'domain':p.get('domain',{})}for p in self.params.values()],'return_type':self.return_value['type']if self.return_value else'void','collections':[{'name':c['name'],'storage_type':typ(c['size']),'count':c['count'],'provenance':c['refs']}for c in self.collections.values()],'state':[field(f)for f in self.fields.values()],'locals':[{'name':'value_'+v[1:],'storage_type':typ(self.v[v]['size'])}for v in sorted(set(self.loads)|set(self.phis)|set(self.call_results),key=lambda x:int(x[1:]))],'assets':[{'name':a['name'],'storage_type':'u8','data':a['data'],'provenance':a['refs']}for a in self.assets.values()],'body':body,'phase':{'name':'unknown','ordering':[],'confidence':0.0},'verification':{'status':'pending','receipt':None},'preconditions':['Entity objects occupy mutable RAM and are disjoint from immutable ROM assets','No unresolved pointer alias escapes the recovered state views']+(['Declared context object references remain stable during invocation, have evidenced disjoint accessed views; named global storage is disjoint from those accessed views']if self.object_refs else[]),'limitations':['Acyclic structured CFG only','Semantic units and human names remain unknown unless separately evidenced']}
        adapter={'schema':'gameverse.l0.validation-adapter/0.2','entry':self.l0['entry'],'parameters':[dict(p)for p in self.params.values()],'return_type':l1['return_type'],'collections':[dict(c)for c in self.collections.values()],'fields':[dict(name=f['name'],width=f['size']*8,owner=owner[0],argument=owner[1]if owner[0]=='entity'else None,address=None if owner[0]in('entity','reference')else owner[1],offset=start,**({'domain':self.state_domain(owner,start)}if self.state_domain(owner,start)else{}),**({'reference':owner[1]}if owner[0]=='reference'else{}))for(owner,start),f in self.fields.items()],'assets':[{'name':a['name'],'address':a['start'],'bytes':a['end']}for a in self.assets.values()],'assumptions':self.assumptions,'l0_sha256':hashlib.sha256(json.dumps(self.l0,sort_keys=True).encode()).hexdigest()}
        if self.object_refs:l1['state_owners']=[{'id':name,'identity':self.object_contract.get(f'{cell:08x}',{}).get('identity',name),'ownership':'distinct_owned_object','lifetime':'invocation','separation':'accessed_views_disjoint_with_evidenced_context_layouts','evidence':self.object_contract.get(f'{cell:08x}',{}).get('evidence',[])}for cell,name in self.object_refs.items()]
        if self.object_refs:adapter['object_references']=[{'name':name,'cell':cell,'lifetime':'stable_for_invocation','alias_contract':'distinct_owned_object','evidence':self.object_contract.get(f'{cell:08x}',{}).get('evidence',[]),'identity':self.object_contract.get(f'{cell:08x}',{}).get('identity',name)}for cell,name in self.object_refs.items()]
        if self.dependencies:
            from inline import inline_dependencies
            l1,adapter=inline_dependencies(l1,adapter,list(self.dependencies.values()))
        return l1,adapter

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('l0',type=Path);p.add_argument('rom',type=Path);p.add_argument('out',type=Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    try:
        x,adapter=Lifter(json.loads(a.l0.read_text()),a.rom.read_bytes()).build()
        (a.out/'l1.json').write_text(json.dumps(x,indent=2)+'\n');(a.out/'validation-adapter.json').write_text(json.dumps(adapter,indent=2)+'\n')
    except Unsupported as e:
        (a.out/'failure.json').write_text(json.dumps({'status':'unsupported','reason':str(e)},indent=2)+'\n');raise
