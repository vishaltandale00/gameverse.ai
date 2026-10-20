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
    def __init__(self,l0,rom,callees=None,param_domains=None,object_contract=None,state_domains=None,argument_contract=None,project_load_lanes=False,retained_services=None,service_evidence=None,resource_references=None):
        from bounded_cfg import expand
        try:working,self.cfg_proofs=expand(l0)
        except ValueError as error:raise Unsupported('bounded CFG: '+str(error))from error
        self.l0=l0; self.rom=rom; self.callees=callees or {};self.dependencies={};self.param_domains=param_domains or {};self.call_results={}; self.v={v['id']:v for v in working['varnodes']}
        self.blocks={b['id']:b for b in working['blocks']}
        self.path_facts={};self.operation_blocks={};self.active_access=None
        self.defs={o['output']:o for b in self.blocks.values()for o in b['ops']if o.get('output')}
        self.loads={};self.phis={};self.access={};self.fields={};self.assets={};self.assumptions=list(self.cfg_proofs);self.expanded=0;self.load_views={};self.project_load_lanes=project_load_lanes;self.params={};self.collections={};self.object_refs={};self.object_contract=object_contract or {};self.state_domains=state_domains or {};self.argument_contract=argument_contract or {};self.reference_loads=set();self.return_value=None;self.expression_nodes=0;self.bound_active=set();self.call_bindings={};self.call_asset_bindings={};self.call_collections={};self.canonical_pool_arguments=set();self.pointer_phis={}
        self.retained_services={};self.service_calls={};self.service_statements={};self.service_evidence=service_evidence or {};self.service_frame_proofs=[];self.resource_contracts=resource_references or [];self.resource_stores={};self.bound_resources=[]
        if retained_services:
            from retained_services import validate_service
            if self.state_domains or self.object_contract or self.argument_contract.get('entity_references')or self.argument_contract.get('shared_views')or self.argument_contract.get('readonly_entry_reads'):raise Unsupported('retained host service invalidates state domains and stable reference contracts')
            for entry,contract in retained_services.items():
                c=validate_service(contract,rom,self.service_evidence);key=f'{c["entry"]:08x}'
                if key!=entry or key in self.retained_services:raise Unsupported('retained service entry identity mismatch')
                if any(old['id']==c['id']for old in self.retained_services.values()):raise Unsupported('duplicate retained service symbolic identity')
                self.retained_services[key]=c
        # Authenticate service-bearing source callees before CFG specialization or
        # range proofs can consume caller state/reference assumptions.
        from inline import imported_services,merge_services
        inventory=list(self.retained_services.values())
        for block in self.blocks.values():
            for operation in block['ops']:
                if operation['opcode']!='CALL'or not operation.get('inputs'):continue
                target=self.v[operation['inputs'][0]];entry=f'{int(target["offset"]):08x}'
                if entry not in self.callees:continue
                try:inventory.extend(imported_services(*self.callees[entry],rom,self.service_evidence))
                except ValueError as error:raise Unsupported('retained service dependency: '+str(error))from error
        try:self.service_inventory=merge_services(inventory)
        except ValueError as error:raise Unsupported(str(error))from error
        if self.service_inventory and(self.state_domains or self.object_contract or any(self.argument_contract.get(k)for k in('entity_references','shared_views','readonly_entry_reads'))):raise Unsupported('retained host service dependency invalidates state domains and stable reference contracts')
        self.entity_reference_contracts=[];self.entity_refs={}
        if self.argument_contract.get('entity_references'):
            from entity_reference import validate_contracts
            self.entity_reference_contracts=validate_contracts(self.l0,self.argument_contract)
        self.ignored_return_proof=None
        if self.argument_contract.get('return_projection'):
            from ignored_return import prove
            self.ignored_return_proof=prove(self.l0,self.rom,self.argument_contract['return_projection'])
            self.assumptions.append(self.ignored_return_proof)
        self.callee_range_cache={};self.callee_range_proofs={}
        self.readonly_entry_proofs=[];self.readonly_entry_values={}
        if self.argument_contract.get('readonly_entry_reads'):
            from readonly_entry import certify
            self.readonly_entry_proofs=certify(self,self.argument_contract['readonly_entry_reads'])
            self.readonly_entry_values={p['load_output']:p['exact_value']for p in self.readonly_entry_proofs}
            self.literal_cache={};self.assumptions.extend(self.readonly_entry_proofs)
    def literal(self,v):
        # CFG reduction replaces defs after each pass. Cache only within that
        # immutable SSA generation; repeated diamond queries otherwise explode.
        if getattr(self,'literal_defs',None)is not self.defs:
            self.literal_defs=self.defs;self.literal_cache={}
        if v in self.literal_cache:
            ok,value=self.literal_cache[v]
            if ok:return value
            raise Unsupported(value)
        active=getattr(self,'literal_active',set())
        if v in active:raise Unsupported('cyclic value requires loop induction proof')
        self.literal_active=active;active.add(v)
        try:
            value=self._literal(v);self.literal_cache[v]=(True,value);return value
        except Unsupported as error:
            self.literal_cache[v]=(False,str(error));raise
        finally:active.remove(v)
    def _literal(self,v):
        if v in getattr(self,'readonly_entry_values',{}):return self.readonly_entry_values[v]
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
        if z['input']and z.get('register')in self.param_domains:
            domain=self.param_domains[z['register']]
            if domain.get('unsigned_min')==domain.get('unsigned_max')and'unsigned_min'in domain:return domain['unsigned_min']
        if o and o['opcode']=='LOAD':
            address=self.literal(o['inputs'][1]);start=address-0x08000000
            if 0<=start<=len(self.rom)-z['size']:return int.from_bytes(self.rom[start:start+z['size']],'little')
        if o:
            op=o['opcode'];ins=o['inputs'];mask=(1<<(z['size']*8))-1
            supported=('INT_SUB','INT_MULT','INT_AND','INT_OR','INT_XOR','INT_EQUAL','INT_NOTEQUAL','INT_LESS','INT_LESSEQUAL','INT_SLESS','INT_SLESSEQUAL','INT_LEFT','INT_RIGHT','INT_SRIGHT','INT_ZEXT','INT_SEXT','SUBPIECE','INT_2COMP','INT_NEGATE','BOOL_NEGATE','BOOL_AND','BOOL_OR')
            if op in supported:
                xs=[self.literal(i)for i in ins];a=xs[0];b=xs[1]if len(xs)>1 else 0
                def signed(value,source):
                    width=self.v[source]['size']*8;value&=(1<<width)-1;return value-(1<<width)if value&(1<<(width-1))else value
                if op=='INT_SUB':value=a-b
                elif op=='INT_MULT':value=a*b
                elif op=='INT_AND':value=a&b
                elif op=='INT_OR':value=a|b
                elif op=='INT_XOR':value=a^b
                elif op=='INT_EQUAL':value=int(a==b)
                elif op=='INT_NOTEQUAL':value=int(a!=b)
                elif op=='INT_LESS':value=int(a<b)
                elif op=='INT_LESSEQUAL':value=int(a<=b)
                elif op=='INT_SLESS':value=int(signed(a,ins[0])<signed(b,ins[1]))
                elif op=='INT_SLESSEQUAL':value=int(signed(a,ins[0])<=signed(b,ins[1]))
                elif op=='INT_LEFT':value=0 if b>=self.v[ins[0]]['size']*8 else a<<b
                elif op=='INT_RIGHT':value=a>>b
                elif op=='INT_SRIGHT':value=signed(a,ins[0])>>b
                elif op=='INT_ZEXT':value=a
                elif op=='INT_SEXT':value=signed(a,ins[0])
                elif op=='SUBPIECE':value=a>>(b*8)
                elif op=='INT_2COMP':value=-a
                elif op=='INT_NEGATE':value=~a
                elif op=='BOOL_NEGATE':value=int(not a)
                elif op=='BOOL_AND':value=int(bool(a)and bool(b))
                elif op=='BOOL_OR':value=int(bool(a)or bool(b))
                return value&mask
        raise Unsupported('not constant '+v)
    def ptr(self,v):
        if getattr(self,'pointer_defs',None)is not self.defs:
            self.pointer_defs=self.defs;self.pointer_cache={}
        # Path facts are consumption-site specific; never reuse a pointer proof
        # from a different LOAD/STORE or the context-free CALL argument phase.
        key=(v,self.active_access)
        if key in self.pointer_cache:
            ok,value=self.pointer_cache[key]
            if ok:return value
            raise Unsupported(value)
        active=getattr(self,'pointer_active',set())
        if v in active:raise Unsupported('cyclic pointer requires typed loop-carried view')
        self.pointer_active=active;active.add(v)
        try:
            value=self._ptr(v);self.pointer_cache[key]=(True,value);return value
        except Unsupported as error:
            self.pointer_cache[key]=(False,str(error));raise
        finally:active.remove(v)
    def _ptr(self,v):
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
            if ps[0][0]=='asset'and all(p[:2]==ps[0][:2]for p in ps):
                self.pointer_phis[v]=[p[2]for p in ps]
                return(ps[0][0],ps[0][1],{'op':'local','type':'u32','name':'table_index_'+v[1:]})
            from pointer_regions import fixed_rom_phi_offsets
            region=fixed_rom_phi_offsets(ps,len(self.rom),bounds=self.bounds)
            if region is not None:
                if v in self.phis:raise Unsupported('immutable pointer phi also used as scalar')
                base,offsets=region;self.pointer_phis[v]=offsets
                self.assumptions.append({'kind':'canonical_immutable_rom_pointer_phi','provenance':o['id'],'base':base,'offsets':offsets,'basis':'Source predecessor selects an exact offset in one immutable ROM byte asset; final access bounds and widths remain checked'})
                return('asset',base,{'op':'local','type':'u32','name':'table_index_'+v[1:]})
            from pointer_regions import fixed_ram_phi_offsets
            region=fixed_ram_phi_offsets(ps,bounds=self.bounds)
            if region is not None:
                base,offsets=region;self.pointer_phis[v]=offsets
                self.assumptions.append({'kind':'canonical_fixed_ram_pointer_phi','provenance':o['id'],'base':base,'offsets':offsets,'precondition':'Canonical RAM alternatives share one bounded byte address space; overlapping accesses still require alias partition'})
                return('global',base,{'op':'local','type':'u32','name':'table_index_'+v[1:]})
            raise Unsupported('unresolved pointer phi '+v)
        if o and o['opcode'] in ('INT_ADD','PTRADD','PTRSUB'):
            a,b=o['inputs'][:2]
            if o['opcode']=='PTRADD':
                p=self.ptr(a);delta=node('mul_wrap','u32',self.expr(b),self.expr(o['inputs'][2]))
            else:
                try:p=self.ptr(a);delta=self.expr(b)
                except Unsupported:p=self.ptr(b);delta=self.expr(a)
            from pointer_regions import rebase_constant_bias
            return rebase_constant_bias((p[0],p[1],self.fold(node('add_wrap','u32',p[2],delta))))
        if o and o['opcode']=='LOAD' and z['size']==4:
            source=self.ptr(o['inputs'][1])
            if source[0]=='asset':
                from rom_rows import table
                descriptor=table(self,source,o)
                self.reference_loads.add(o['id']);return('rom_rows',descriptor,const(0))
            if source[0]=='entity':
                from entity_reference import resolve
                resolved=resolve(self,source,o)
                if resolved:
                    name,descriptor=resolved;self.entity_refs[name]=descriptor;self.reference_loads.add(o['id']);return('reference',name,const(0))
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
        from path_bounds import bounds as guarded_bounds
        facts=self.path_facts.get(self.operation_blocks.get(self.active_access),{})
        narrowed=guarded_bounds(e,self.bounds,facts)
        ordinary=self._bounds(e)
        if narrowed is None:return ordinary
        result=max(ordinary[0],narrowed[0]),min(ordinary[1],narrowed[1])
        if result[0]>result[1]:raise Unsupported('contradictory source range facts')
        return result
    def _bounds(self,e):
        op=e['op'];width=int(e['type'][1:])
        if op=='const':return(e['value'],e['value'])
        if op=='asset_read':
            asset=next((a for a in self.assets.values()if a['name']==e['asset']),None)
            if asset and asset.get('value_range')is not None:return asset['value_range']
        if op=='local':
            if e['name'].startswith('table_index_'):
                values=[self.bounds(z)for z in self.pointer_phis['v'+e['name'].removeprefix('table_index_')]];return(min(v[0]for v in values),max(v[1]for v in values))
            key='v'+e['name'].removeprefix('value_')if e['name'].startswith('value_')else'';definition=self.defs.get(key)
            if definition and definition['opcode']=='CALL':
                entry=f'{int(self.v[definition["inputs"][0]]["offset"]):08x}'
                if entry in getattr(self,'callees',{}):
                    from callee_ranges import derive,digest,result_interval,parameter_abi_matches
                    dep,adapter=self.callees[entry]
                    if entry not in self.callee_range_cache:self.callee_range_cache[entry]=derive(dep)
                    proof=self.callee_range_cache[entry]
                    if proof is not None and not getattr(self,'service_inventory',[])and parameter_abi_matches(dep,adapter):
                        interval=result_interval(proof,adapter,e['type'])
                        if interval is not None:
                            if entry not in self.callee_range_proofs:
                                self.callee_range_proofs[entry]=dict(proof,callee_entry=entry,adapter_model_sha256=digest(adapter))
                            return interval
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
        if op=='shift_arithmetic'and e['args'][1]['op']=='const':
            lo,hi=self.bounds(e['args'][0]);n=e['args'][1]['value']
            if hi<1<<(width-1):return(lo>>n,hi>>n)
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
    def demanded_load_views(self):
        # A conservative backwards bit-demand slice, rooted in every observable
        # store/branch/call/return. Only unused LOAD lanes may be discarded.
        demands={};pending=[]
        def demand(v,mask):
            mask&=(1<<(self.v[v]['size']*8))-1;old=demands.get(v,0)
            if mask&~old:demands[v]=old|mask;pending.append(v)
        for b in self.blocks.values():
            for o in b['ops']:
                if o['opcode']in('LOAD','STORE'):demand(o['inputs'][1],(1<<(self.v[o['inputs'][1]]['size']*8))-1)
                if o['opcode']=='STORE':demand(o['inputs'][2],(1<<(self.v[o['inputs'][2]]['size']*8))-1)
                elif o['opcode']=='CBRANCH':demand(o['inputs'][1],255)
                elif o['opcode']in('CALL','CALLIND','RETURN','BRANCHIND'):
                    for v in o['inputs'][1:]if o['opcode']!='BRANCHIND'else o['inputs']:demand(v,(1<<(self.v[v]['size']*8))-1)
        while pending:
            v=pending.pop();o=self.defs.get(v);mask=demands[v]
            if not o or o['opcode']=='LOAD':continue
            op=o['opcode'];ins=o['inputs']
            if op in('COPY','CAST','INDIRECT','INT_ZEXT'):demand(ins[0],mask)
            elif op=='INT_SEXT':
                source_bits=self.v[ins[0]]['size']*8;demand(ins[0],mask|((1<<(source_bits-1))if mask>>source_bits else 0))
            elif op=='SUBPIECE':demand(ins[0],mask<<(self.literal(ins[1])*8))
            elif op in('INT_LEFT','INT_RIGHT','INT_SRIGHT')and self.v[ins[1]]['constant']:
                n=self.literal(ins[1]);source_bits=self.v[ins[0]]['size']*8
                bits=mask>>n if op=='INT_LEFT'else mask<<n
                if op=='INT_SRIGHT'and(n>=source_bits or mask>>(source_bits-n)):bits|=1<<(source_bits-1)
                demand(ins[0],bits)
            elif op=='INT_AND'and self.v[ins[1]]['constant']:demand(ins[0],mask&self.literal(ins[1]))
            elif op=='INT_OR'and self.v[ins[1]]['constant']:demand(ins[0],mask&~self.literal(ins[1]))
            elif op in('INT_ADD','INT_SUB','INT_MULT','INT_2COMP'):
                for source in ins:demand(source,(1<<mask.bit_length())-1)
            elif op=='MULTIEQUAL':
                for source in ins:demand(source,mask)
            else:
                for source in ins:demand(source,(1<<(self.v[source]['size']*8))-1)
        for v,mask in demands.items():
            o=self.defs.get(v)
            if o and o['opcode']=='LOAD'and mask:
                low=((mask&-mask).bit_length()-1)//8;size=(mask.bit_length()+7)//8-low
                if size in(1,2,4,8)and size<self.v[v]['size']:self.load_views[o['id']]=(low,size)

    def state_domain(self,owner,start):
        if owner[0]=='reference'and owner[1]in self.entity_refs:return self.state_domains.get('reference:'+owner[1]+':'+str(start),{})
        if owner[0]=='reference':identity=next(f'{cell:08x}'for cell,name in self.object_refs.items()if name==owner[1])
        else:identity=str(owner[1])
        return self.state_domains.get(owner[0]+':'+identity+':'+str(start),{})
    def resolve_access(self,o):
        previous=self.active_access;self.active_access=o['id']
        try:return self._resolve_access(o)
        finally:self.active_access=previous
    def _resolve_access(self,o):
        p=self.ptr(o['inputs'][1]);size=self.v[o['output']if o['opcode']=='LOAD'else o['inputs'][2]]['size']
        if p[2]['op']!='const':
            lo,hi=self.bounds(p[2])
            if lo==hi:p=(p[0],p[1],const(lo))
        if o['opcode']=='LOAD'and o['id']in self.load_views and p[0]!='asset':
            low,size=self.load_views[o['id']];p=(p[0],p[1],self.fold(node('add_wrap','u32',p[2],const(low))))
        if p[0]=='reference'and p[1]in self.entity_refs:
            from entity_reference import validate_access
            if p[2]['op']!='const':raise Unsupported('dynamic entity reference access unsupported')
            validate_access(self.entity_refs[p[1]],p[2]['value'],size,o['opcode']=='STORE')
        if p[0]=='rom_rows':
            from rom_rows import access
            result=access(self,p[1],p[2],size,o['opcode']=='STORE',o);self.access[o['id']]=result;return result
        if p[0]=='asset':
            if o['opcode']=='STORE':raise Unsupported('write to ROM asset')
            lo,hi=self.bounds(p[2]);start=p[1]-0x08000000
            if hi>65536 or not 0<=start+lo<=start+hi+size<=len(self.rom):raise Unsupported('unbounded read-only asset index')
            key=(p[1],size);asset=self.assets.setdefault(key,{'name':'asset_'+str(len(self.assets)),'start':p[1],'width':size,'end':0,'refs':[]})
            asset['end']=max(asset['end'],hi+size);asset['refs'].append(o['id']);asset.setdefault('read_views',{})[o['id']]={'asset':asset['name'],'index':p[2],'minimum':lo,'maximum':hi,'width':size};result=('asset',key,p[2],size)
        else:
            if p[2]['op']!='const':
                lo,hi=self.bounds(p[2])
                def aligned(e,n):
                    if n==1:return True
                    if e['op']=='const':return e['value']%n==0
                    if e['op']=='local'and e['name'].startswith('table_index_'):return all(aligned(z,n)for z in self.pointer_phis['v'+e['name'][12:]])
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
        from specialize import reduce_cfg
        for v in self.v.values():
            domain=self.param_domains.get(v.get('register'),{})
            if v.get('input')and'unsigned_min'in domain and domain['unsigned_min']==domain.get('unsigned_max'):self.expr(v['id'])
        reduce_cfg(self)
        from path_bounds import analyze
        analysis=analyze(dict(self.l0,varnodes=list(self.v.values()),blocks=list(self.blocks.values())))
        self.path_facts=analysis['facts_by_block'];self.assumptions.extend(analysis['proofs'])
        self.operation_blocks={o['id']:b['id']for b in self.blocks.values()for o in b['ops']}
        if self.project_load_lanes:self.demanded_load_views()
        for b in self.blocks.values():
            for o in b['ops']:
                if o['opcode']in('LOAD','STORE'):self.resolve_access(o)
                if o['opcode']=='CALLIND':
                    if b['successors']:raise Unsupported('unresolved indirect call')
                    from returnproof import prove,Unproven
                    try:proof=prove(self.l0,self.rom,o['pc'])
                    except Unproven as error:raise Unsupported('unresolved indirect call: '+str(error))from error
                    self.assumptions.append(dict(proof,provenance=o['id']))
                if o['opcode']=='CALL':
                    target=self.v[o['inputs'][0]]
                    entry=f'{int(target["offset"]):08x}'
                    if entry in self.retained_services:
                        self.service_calls[o['id']]=self.retained_services[entry]
                        if o.get('output'):self.call_results[o['output']]=o
                        continue
                    if entry not in self.callees:raise Unsupported('unresolved callee closure '+entry)
                    from inline import imported_services
                    try:imported_services(*self.callees[entry],self.rom,self.service_evidence)
                    except ValueError as error:raise Unsupported('retained service dependency: '+str(error))from error
                    if o.get('output'):self.call_results[o['output']]=o
                    self.dependencies[entry]=self.callees[entry]
                    dep,da=self.callees[entry];bindings={};asset_bindings={}
                    if da.get('entity_references'):raise Unsupported('callee entity reference import not supported')
                    entity_arguments={f['argument']for f in da['fields']if f['owner']=='entity'}
                    if len(o['inputs'])==1 and entity_arguments=={'r0'}and not da['parameters']and (da.get('return_type','void')=='void'or (da.get('return_type')in('u8','u16','u32')and o.get('output'))):
                        from returnproof import prove,Unproven
                        candidates=[v['id']for v in self.v.values()if v.get('input')and v.get('register')=='r0'and v['size']==4]
                        if len(candidates)!=1:raise Unsupported('missing call pointer has ambiguous entry SSA')
                        try:proof=prove(self.l0,self.rom,o['pc'],call_register=0,expected_callee=int(entry,16))
                        except Unproven as error:raise Unsupported('missing call pointer ABI: '+str(error))from error
                        o['inputs'].append(candidates[0]);self.assumptions.append(dict(proof,provenance=o['id'],ssa_argument=candidates[0]))
                    for f in da['fields']:
                        if f['owner']=='global':owner=('global',0);start=f['address']+f['offset']
                        elif f['owner']=='reference':
                            ref=next(r for r in da['object_references']if r['name']==f['reference']);cell=ref['cell'];name=self.object_refs.setdefault(cell,'context_object_'+str(len(self.object_refs)));owner=('reference',name);start=f['offset']
                        elif f['owner']=='entity':
                            slot=int(f['argument'][1:])+1
                            if slot>=len(o['inputs']):raise Unsupported('callee object ABI argument missing')
                            root,identity,delta=self.ptr(o['inputs'][slot])
                            if root=='asset':
                                from readonly_callee import bind_field
                                asset_bindings[f['name']]=bind_field(self,dep,da,f,identity,delta,'call/'+o['id']+'/'+f['name'])
                                continue
                            if delta['op']!='const':raise Unsupported('callee dynamic object view unresolved')
                            owner=(root,0 if root=='global'else identity);start=delta['value']+f['offset']+(identity if root=='global'else 0)
                        else:raise Unsupported('callee state owner unsupported')
                        if f.get('domain'):
                            if self.state_domain(owner,start)!=f['domain']:raise Unsupported('callee field domain not proven by caller state contract')
                        size=f['width']//8;bindings[f['name']]=(owner,start,size);self.access['call/'+o['id']+'/'+f['name']]=('state',owner,start,size)
                    def written(ss):
                        for s in ss:
                            if s['op']=='assign_field':yield s['field']
                            for key in('body','then','else','default'):
                                if key in s:yield from written(s[key])
                            for case in s.get('cases',[]):yield from written(case['body'])
                            for block in s.get('blocks',[]):yield from written(block['body'])
                    for name in written(dep['body']):
                        owner,start,size=bindings[name]
                        if owner[0]=='reference':
                            cell=next(cell for cell,name in self.object_refs.items()if name==owner[1])
                            if self.object_contract.get(f'{cell:08x}',{}).get('storage')in('readonly_rom','readonly_during_call_ram'):raise Unsupported('callee write violates readonly reference contract')
                    self.call_asset_bindings[o['id']]=asset_bindings
                    self.call_bindings[o['id']]=bindings
                    self.call_collections[o['id']]={}
                    for c in da.get('collections',[]):
                        bound=dict(c)
                        if c['address']is None:
                            if c.get('owner')!='entity' or c.get('stride',c['size'])!=c['size']:raise Unsupported('callee owned collection binding requires contiguous entity view')
                            slot=int(c['argument'][1:])+1
                            if slot>=len(o['inputs']):raise Unsupported('callee collection ABI argument missing')
                            root,identity,delta=self.ptr(o['inputs'][slot])
                            if delta['op']!='const' or root not in('global','entity'):raise Unsupported('callee owned collection requires exact global or entity caller binding')
                            start=delta['value']+c.get('offset',0)+(identity if root=='global'else 0)
                            end=start+c['count']*c['size']
                            if root=='global':
                                if not (0x02000000<=start<end<=0x02040000 or 0x03000000<=start<end<=0x03008000):raise Unsupported('callee collection binding outside canonical RAM')
                                bound.update(address=start,owner='global',argument=None,reference=None,offset=0)
                            else:
                                if not 0<=start<end<=8192:raise Unsupported('callee entity collection exceeds bounded object window')
                                bound.update(address=None,owner='entity',argument=identity,reference=None,offset=start)
                        key=('global',bound['address'],0,bound['size'])if bound['address']is not None else('entity',bound['argument'],bound['offset'],bound['size'])
                        existing=self.collections.setdefault(key,dict(bound,name='dependency_'+str(list(self.dependencies).index(entry))+'_'+c['name']))
                        existing['count']=max(existing['count'],bound['count'])
                        if c['address']is None:self.call_collections[o['id']][c['name']]=key
                if o['opcode']=='CALLOTHER':raise Unsupported('unsupported effect/control '+o['opcode'])
        self.entity_roots={owner[1]for kind,owner,start,size in self.access.values()if kind=='state'and owner[0]=='entity'}|{c['argument']for c in self.collections.values()if c.get('owner')=='entity'}
        if len(self.entity_roots)>1 and not(self.argument_contract.get('separation')=='distinct_accessed_views'and self.argument_contract.get('evidence')):raise Unsupported('multiple entity argument alias contract unresolved')
        from pool import canonicalize
        canonicalize(self)
        # A single stable context object is a typed ownership precondition.
        # Multiple unknown references or rebinding would require alias analysis.
        if self.object_refs:
            if any(kind=='state'and owner[0]=='entity'for kind,owner,start,size in self.access.values())or any(c.get('owner')=='entity'for c in self.collections.values()):
                views=self.argument_contract.get('shared_views',[])
                if not views:raise Unsupported('object/reference argument alias closure unresolved')
                for register in self.entity_roots-self.canonical_pool_arguments:
                    view=next((v for v in views if v['argument']==register),None)
                    if not view or not view.get('evidence')or not 1<=view['count']<=64:raise Unsupported('entity shared-view contract missing')
                    if not 0<=view.get('base_offset',0)<=8192:raise Unsupported('shared-view base offset outside adapter bound')
                    root=int(view['root_cell'],16);reference=self.object_refs.get(root)
                    if not reference:raise Unsupported('entity shared-view root unresolved')
                    entity_access=[(start,start+size)for kind,owner,start,size in self.access.values()if kind=='state'and owner==('entity',register)]
                    entity_access +=[(c['offset'],c['offset']+(c['count']-1)*c.get('stride',c['size'])+c['size'])for c in self.collections.values()if c.get('owner')=='entity'and c['argument']==register]
                    shared_access=[(start,start+size)for kind,owner,start,size in self.access.values()if kind=='state'and owner==('reference',reference)]
                    shared_access +=[(c['offset'],c['offset']+c['count']*c['size'])for c in self.collections.values()if c.get('reference')==reference]
                    if any(a<0 or b>view['stride']for a,b in entity_access):raise Unsupported('entity view escapes bounded record')
                    for index in range(view['count']):
                        if any(a+view.get('base_offset',0)+index*view['stride']<d and c<b+view.get('base_offset',0)+index*view['stride']for a,b in entity_access for c,d in shared_access):raise Unsupported('shared entity/pool alias requires canonical typed pool handles')
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
                        for target in contract['observed_targets']:windows.append((('reference',c['reference']),target+c['offset'],target+c['offset']+(c['count']-1)*c.get('stride',c['size'])+c['size']))
                for i,(owner,a,b)in enumerate(windows):
                    if any(owner!=other and a<d and c<b for other,c,d in windows[i+1:]):raise Unsupported('observed accessed object/global views may alias')
            for b in self.blocks.values():
                for o in b['ops']:
                    if o['opcode']=='STORE':
                        kind,owner,start,size=self.access[o['id']]
                        if kind=='state'and owner[0]=='global'and any(start<cell+4 and cell<start+size for cell in self.object_refs):raise Unsupported('mutable object reference lifetime unresolved')
                        ref_name=owner[1]if kind=='state'and owner[0]=='reference'else self.collections[owner].get('reference')if kind=='collection'else None
                        if kind=='pool':ref_name=self.collections[owner[0][2]]['reference']
                        if ref_name:
                            cell=next(cell for cell,name in self.object_refs.items()if name==ref_name)
                            if self.object_contract.get(f'{cell:08x}',{}).get('storage')in('readonly_rom','readonly_during_call_ram'):raise Unsupported('write violates read-only object access contract')
            for key in self.reference_loads:self.access.pop(key,None)
        if self.entity_refs:
            if self.object_refs or self.argument_contract.get('shared_views'):raise Unsupported('entity reference cannot combine other reference aliases')
            for key in self.reference_loads:self.access.pop(key,None)
        for key in self.reference_loads:self.access.pop(key,None)
        from pointer_regions import canonicalize_byte_collections,canonicalize_contained_scalars
        self.assumptions.extend(canonicalize_contained_scalars(self))
        self.assumptions.extend(canonicalize_byte_collections(self))
        # Unresolved aliasing blocks promotion. Collections are typed, bounded
        # regions, not an excuse to duplicate overlapping mutable memory.
        regions=[(('global',0)if c['address']is not None else(c['owner'],c.get('reference')or c.get('argument')),c['address']if c['address']is not None else c['offset'],(c['address']if c['address']is not None else c['offset'])+c['size']*c['count'])for c in self.collections.values()if not c.get('canonical_pool')]
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
        if v in self.pointer_phis:raise Unsupported('pointer phi used as scalar')
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
            if o['id']in self.reference_loads:raise Unsupported('object reference pointer escaped as scalar')
            self.loads[v]=o
            return dict(op='local',type=t,name='value_'+v[1:],**ref)
        if op=='MULTIEQUAL':
            self.phis[v]=o
            return dict(op='local',type=t,name='value_'+v[1:],**ref)
        if op in('COPY','CAST','INDIRECT'):return self.expr(ins[0])
        if op=='SUBPIECE':return node('extract',t,self.expr(ins[0]),const(self.literal(ins[1])*8),**ref)
        if op=='PTRSUB'and len(ins)==2 and self.v[ins[0]].get('constant')and int(self.v[ins[0]]['offset'])==0 and self.v[ins[1]].get('constant'):
            value=self.literal(v)
            if 0<=value<0x02000000:return const(value,t)
            raise Unsupported('pointer-like constant PTRSUB escaped as scalar')
        if op=='INT_SCARRY':
            a,b=[self.expr(i)for i in ins]
            if a['type']!=b['type']or a['type']not in('u8','u16','u32'):raise Unsupported('signed carry operand widths unsupported')
            width=int(a['type'][1:]);summed=node('add_wrap',a['type'],a,b)
            same_sign=node('bit_not',a['type'],node('bit_xor',a['type'],a,b))
            changed_sign=node('bit_xor',a['type'],a,summed)
            sign=node('shift_right',a['type'],node('bit_and',a['type'],same_sign,changed_sign),const(width-1))
            return node('extract',t,sign,const(0),**ref)
        operators={'INT_ADD':'add_wrap','INT_SUB':'sub_wrap','INT_MULT':'mul_wrap','INT_AND':'bit_and','INT_OR':'bit_or','INT_XOR':'bit_xor','INT_EQUAL':'equal','INT_NOTEQUAL':'not_equal','INT_LESS':'less_unsigned','INT_SLESS':'less_signed','INT_LESSEQUAL':'less_equal_unsigned','INT_SLESSEQUAL':'less_equal_signed','INT_LEFT':'shift_left','INT_RIGHT':'shift_right','INT_SRIGHT':'shift_arithmetic','INT_ZEXT':'zext','INT_SEXT':'sext','INT_2COMP':'neg_wrap','INT_NEGATE':'bit_not','BOOL_NEGATE':'bool_not','BOOL_AND':'bool_and','BOOL_OR':'bool_or'}
        if op in operators:return node(operators[op],t,*[self.expr(i)for i in ins],**ref)
        raise Unsupported('unsupported scalar opcode '+op)
    def read(self,o):
        kind,owner,start,size=self.access[o['id']]
        if kind=='pool':
            result=None
            for shift,width,key in owner:
                e=dict(op='collection_read',type=typ(width),collection=self.collections[key]['name'],index=start,provenance=o['id'])
                if width!=size:e=node('zext',typ(size),e)
                if shift:e=node('shift_left',typ(size),e,const(shift*8))
                result=e if result is None else node('bit_or',typ(size),result,e)
            if o['id']in self.load_views:
                low,_=self.load_views[o['id']];result=node('zext',typ(self.v[o['output']]['size']),result)
                if low:result=node('shift_left',result['type'],result,const(low*8))
            return result
        if kind=='byte_region':
            result=None
            for byte in range(size):
                index=start if not byte else node('add_wrap','u32',start,const(byte))
                value=dict(op='collection_read',type='u8',collection=self.collections[owner]['name'],index=index,provenance=o['id'])
                if size!=1:value=node('zext',typ(size),value)
                if byte:value=node('shift_left',typ(size),value,const(byte*8))
                result=value if result is None else node('bit_or',typ(size),result,value)
            if o['id']in self.load_views:
                low,_=self.load_views[o['id']];result=node('zext',typ(self.v[o['output']]['size']),result)
                if low:result=node('shift_left',result['type'],result,const(low*8))
            return result
        if kind=='collection':return dict(op='collection_read',type=typ(size),collection=self.collections[owner]['name'],index=start,provenance=o['id'])
        if kind=='asset':return dict(op='asset_read',type=typ(size),asset=self.assets[owner]['name'],index=start,provenance=o['id'])
        result=self.field_expr(owner,start,size)
        if o['id']in self.load_views:
            low,_=self.load_views[o['id']];result=node('zext',typ(self.v[o['output']]['size']),result)
            if low:result=node('shift_left',result['type'],result,const(low*8))
        return result
    def store(self,o):
        kind,owner,start,size=self.access[o['id']]
        if o['id']in self.resource_stores:
            c=self.resource_stores[o['id']]
            return [{'op':'assign_field','field':c['field'],'value':{'op':'resource_reference','type':'u32','resource':c['id'],'token':c['token']},'provenance':o['id']}]
        e=self.expr(o['inputs'][2]);ss=[]
        if kind=='pool':
            temporary='pool_store_'+str(len(self.pool_store_locals));self.pool_store_locals.append({'name':temporary,'storage_type':e['type']})
            ss=[{'op':'assign_local','local':temporary,'value':e,'provenance':o['id']}]
            for shift,width,key in owner:
                value=node('extract',typ(width),{'op':'local','type':e['type'],'name':temporary},const(shift*8))
                ss.append({'op':'assign_collection','collection':self.collections[key]['name'],'index':start,'value':value,'provenance':o['id']})
            return ss
        if kind=='byte_region':
            temporary='pool_store_'+str(len(self.pool_store_locals));self.pool_store_locals.append({'name':temporary,'storage_type':e['type']})
            ss=[{'op':'assign_local','local':temporary,'value':e,'provenance':o['id']}]
            for byte in range(size):
                index=start if not byte else node('add_wrap','u32',start,const(byte))
                value=node('extract','u8',{'op':'local','type':e['type'],'name':temporary},const(byte*8))
                ss.append({'op':'assign_collection','collection':self.collections[owner]['name'],'index':index,'value':value,'provenance':o['id']})
            return ss
        if kind=='collection':return [{'op':'assign_collection','collection':self.collections[owner]['name'],'index':start,'value':e,'provenance':o['id']}]
        if kind!='state':raise Unsupported('mutable asset')
        for (own,a),f in self.fields.items():
            if own==owner and start<=a<a+f['size']<=start+size:
                value=e if size==f['size']else node('extract',typ(f['size']),e,const((a-start)*8))
                ss.append({'op':'assign_field','field':f['name'],'value':value,'provenance':o['id']})
        return ss
    def build(self):
        self.pool_store_locals=[]
        self.collect()
        if self.resource_contracts:
            from resource_reference import bind
            self.resource_stores,self.bound_resources=bind(self,self.resource_contracts,self.service_evidence)
        # Root the scalar slice in observable stores and branches. Preserve loads
        # as snapshots at their original ordered position, including before writes.
        for b in self.blocks.values():
            for o in b['ops']:
                if o['opcode']=='STORE'and o['id']not in self.resource_stores:self.expr(o['inputs'][2])
                elif o['opcode']=='CBRANCH':self.expr(o['inputs'][1])
                elif o['opcode']=='CALLIND'and len(o['inputs'])==2 and not self.ignored_return_proof:self.return_value=self.expr(o['inputs'][1])
                elif o['opcode']=='RETURN'and len(o['inputs'])==2 and not self.ignored_return_proof:self.return_value=self.expr(o['inputs'][1])
                elif o['opcode']=='BRANCHIND':self.expr(o['inputs'][0])
                elif o['opcode']=='CALL':
                    entry=format(int(self.v[o['inputs'][0]]['offset']),'08x')
                    if o['id']in self.service_calls:
                        from retained_services import derive_call
                        self.service_statements[o['id']]=derive_call(o,self.v,self.service_calls[o['id']],self.expr,self.rom,self.service_evidence,result='value_'+o['output'][1:]if o.get('output')else None,source_l0=self.l0,proofs=self.service_frame_proofs)
                        continue
                    for p in self.dependencies[entry][1]['parameters']:
                        slot=int(p['register'][1:])+1
                        if slot>=len(o['inputs']):raise Unsupported('callee ABI argument missing')
                        self.expr(o['inputs'][slot])
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
        basic_flow=self.argument_contract.get('control_flow')=='acyclic_basic_blocks/0.1'
        def edge(target,pred,provenance):
            snapshots=[];assignments=[]
            block=self.blocks[target]
            if pred not in block['predecessors']:raise Unsupported('basic-block edge predecessor mismatch')
            for operation in block['ops']:
                out=operation.get('output')
                if operation['opcode']!='MULTIEQUAL':continue
                if out in self.pointer_phis:
                    value=self.pointer_phis[out][block['predecessors'].index(pred)];name='table_index_'+out[1:]
                elif out in self.phis:
                    value=self.expr(operation['inputs'][block['predecessors'].index(pred)]);name='value_'+out[1:]
                else:continue
                temporary='edge_phi_'+str(len(self.pool_store_locals));self.pool_store_locals.append({'name':temporary,'storage_type':value['type']})
                snapshots.append({'op':'assign_local','local':temporary,'value':value,'provenance':operation['id']})
                assignments.append({'op':'assign_local','local':name,'value':{'op':'local','type':value['type'],'name':temporary},'provenance':operation['id']})
            return snapshots+assignments+[{'op':'jump','label':'block_'+str(target),'provenance':str(provenance)}]
        def region(bid,pred,path,stop=None):
            if bid==stop and pred is None:return [] # No block/phi statements are expanded.
            if bid in path:raise Unsupported('loop CFG not yet structured')
            b=self.blocks[bid];ss=[]
            if bid==stop:
                if pred is not None:
                    for o in b['ops']:
                        out=o.get('output')
                        if o['opcode']=='MULTIEQUAL'and out in self.pointer_phis:
                            ss.append({'op':'assign_local','local':'table_index_'+out[1:],'value':self.pointer_phis[out][b['predecessors'].index(pred)],'provenance':o['id']})
                        if o['opcode']=='MULTIEQUAL'and out in self.phis:
                            ss.append({'op':'assign_local','local':'value_'+out[1:],'value':self.expr(o['inputs'][b['predecessors'].index(pred)]),'provenance':o['id']})
                if ss:
                    self.expanded+=1
                    if self.expanded>2048:raise Unsupported('structured expansion budget')
                return ss
            self.expanded+=1
            if self.expanded>2048:raise Unsupported('structured expansion budget')
            for o in b['ops']:
                op=o['opcode'];out=o.get('output')
                if op=='MULTIEQUAL'and out in self.pointer_phis:
                    if pred is not None:ss.append({'op':'assign_local','local':'table_index_'+out[1:],'value':self.pointer_phis[out][b['predecessors'].index(pred)],'provenance':o['id']})
                if op=='MULTIEQUAL'and out in self.phis:
                    if pred is None:continue
                    if pred not in b['predecessors']:raise Unsupported('phi predecessor mismatch')
                    e=self.expr(o['inputs'][b['predecessors'].index(pred)])
                    ss.append({'op':'assign_local','local':'value_'+out[1:],'value':e,'provenance':o['id']})
                elif op=='LOAD'and out in self.loads:ss.append({'op':'assign_local','local':'value_'+out[1:],'value':self.read(o),'provenance':o['id']})
                elif op=='STORE':ss.extend(self.store(o))
                elif op=='CBRANCH':
                    if basic_flow:
                        ss.append({'op':'if','condition':self.expr(o['inputs'][1]),'then':edge(b['true_successor'],bid,o['id']),'else':edge(b['false_successor'],bid,o['id']),'provenance':o['id']});return ss
                    join=joins.get(bid)
                    ss.append({'op':'if','condition':self.expr(o['inputs'][1]),'then':region(b['true_successor'],bid,path+[bid],join),'else':region(b['false_successor'],bid,path+[bid],join),'provenance':o['id']})
                    if join is not None:ss.extend(region(join,None,path+[bid],stop))
                    return ss
                elif op=='CALL':
                    if o['id']in self.service_statements:
                        ss.append(self.service_statements[o['id']]);continue
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
                    if any(key not in self.collections for key in self.call_collections[o['id']].values()):raise Unsupported('callee collection canonical remap unresolved')
                    bindings={name:{'value':self.field_expr(owner,start,size),'pieces':[{'field':f['name'],'type':typ(f['size']),'shift':(a-start)*8}for(own,a),f in self.fields.items()if own==owner and start<=a<a+f['size']<=start+size]}for name,(owner,start,size)in self.call_bindings[o['id']].items()}
                    bindings.update(self.call_asset_bindings[o['id']])
                    ss.append(dict(op='call',dependency=list(self.dependencies).index(entry),arguments=arguments,field_bindings=bindings,collection_bindings={name:self.collections[key]['name']for name,key in self.call_collections[o['id']].items()},provenance=o['id'],**({'result':'value_'+out[1:]}if out else{})))
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
                    ss.append({'op':'switch','selector':self.expr(o['inputs'][0]),'cases':[{'values':values,'body':edge(target,bid,o['id'])if basic_flow else region(target,bid,path+[bid])}for target,values in cases.items()],'default':edge(default,bid,o['id'])if basic_flow else region(default,bid,path+[bid]),'provenance':o['id']});return ss
                elif op=='CALLIND' and len(o['inputs'])==2:
                    ss.append(dict(op='return',provenance=o['id'],**({'value':self.expr(o['inputs'][1])}if not self.ignored_return_proof else{})));return ss
                elif op=='RETURN':
                    if len(o['inputs'])>2:raise Unsupported('multiple return values ABI not qualified')
                    ss.append(dict(op='return',provenance=o['id'],**({'value':self.expr(o['inputs'][1])}if len(o['inputs'])==2 and not self.ignored_return_proof else{})));return ss
            if len(b['successors'])==1:ss.extend(edge(b['successors'][0],bid,'edge_'+str(bid))if basic_flow else region(b['successors'][0],bid,path+[bid],stop))
            elif b['successors']:raise Unsupported('unresolved control flow')
            return ss
        self.loads={v:o for v,o in self.loads.items()if o['id']not in self.reference_loads}
        body=[{'op':'control_flow','form':'acyclic_basic_blocks/0.1','start':'block_'+str(min(self.blocks)),'blocks':[{'label':'block_'+str(bid),'body':region(bid,None,[])}for bid in sorted(self.blocks)],'provenance':'bounded_source_cfg'}]if basic_flow else region(min(self.blocks),None,[])
        # Only parameters referenced by the emitted observable slice form the ABI.
        # Address-analysis temporaries must not overwrite native pointer arguments.
        used_parameters=set()
        def parameters_used(value):
            if isinstance(value,list):
                for child in value:parameters_used(child)
            elif isinstance(value,dict):
                if value.get('op')=='parameter':used_parameters.add(value['name'])
                for child in value.values():parameters_used(child)
        parameters_used(body)
        pointer_arguments={c['argument']for c in self.collections.values()if c.get('owner')=='entity'}|{owner[1]for owner,start in self.fields if owner[0]=='entity'}
        self.params={key:p for key,p in self.params.items()if p['name']in used_parameters or p.get('domain')}
        if any(p['register']in pointer_arguments and not p.get('derived_pool_slot')for p in self.params.values()):raise Unsupported('native pointer argument also escapes as scalar')
        used_assets=set()
        def referenced_assets(value):
            if isinstance(value,list):
                for child in value:referenced_assets(child)
            elif isinstance(value,dict):
                if value.get('op')=='asset_read':used_assets.add(value['asset'])
                for child in value.values():referenced_assets(child)
        referenced_assets(body)
        self.assets={key:asset for key,asset in self.assets.items()if asset['name']in used_assets}
        for key,a in self.assets.items():
            if 'derived_data'in a:a['data']=a['derived_data']
            else:
                start=a['start']-0x08000000;end=a['end'];a['data']=list(self.rom[start:start+end])
        def field(f):return dict({'name':f['name'],'owner':f['owner'],'storage_type':typ(f['size']),'semantic_type':{'quantity':'unknown','unit':'unknown','frame':'unknown','confidence':0.0,'evidence':[]}},**({'domain':self.state_domain(next(owner for(owner,start),z in self.fields.items()if z is f),f['start'])}if self.state_domain(next(owner for(owner,start),z in self.fields.items()if z is f),f['start'])else{}))
        l1={'schema':'gameverse.l1.behavior/0.2','id':'behavior_0','parameters':[{'name':p['name'],'storage_type':p['type'],'domain':p.get('domain',{})}for p in self.params.values()],'return_type':self.return_value['type']if self.return_value else'void','collections':[{'name':c['name'],'storage_type':typ(c['size']),'count':c['count'],'provenance':c['refs']}for c in self.collections.values()],'state':[field(f)for f in self.fields.values()],'locals':[{'name':'value_'+v[1:],'storage_type':typ(self.v[v]['size'])}for v in sorted(set(self.loads)|set(self.phis)|set(self.call_results),key=lambda x:int(x[1:]))],'assets':[{'name':a['name'],'storage_type':'u8','data':a['data'],'provenance':a['refs']}for a in self.assets.values()],'body':body,'phase':{'name':'unknown','ordering':[],'confidence':0.0},'verification':{'status':'pending','receipt':None},'preconditions':['Entity objects occupy mutable RAM and are disjoint from immutable ROM assets','No unresolved pointer alias escapes the recovered state views']+(['Entity argument accessed views are distinct for this component invocation; original caller evidence and validation domain are required']if len(self.entity_roots)>1 else[])+(['Declared context object references remain stable during invocation, have evidenced disjoint accessed views; named global storage is disjoint from those accessed views']if self.object_refs else[]),'limitations':['Acyclic structured CFG only','Semantic units and human names remain unknown unless separately evidenced']}
        if any(p['register']in self.canonical_pool_arguments and not p.get('derived_pool_slot')for p in self.params.values()):raise Unsupported('canonical pointer escaped as scalar')
        l1['locals'].extend(self.pool_store_locals)
        l1['locals'].extend({'name':'table_index_'+v[1:],'storage_type':'u32'}for v in self.pointer_phis)
        for c in l1['collections']:
            source=next(z for z in self.collections.values()if z['name']==c['name'])
            if source.get('canonical_pool'):c['owner']=source['reference'];c['index_role']='bounded_record_handle'
        adapter={'schema':'gameverse.l0.validation-adapter/0.2','entry':self.l0['entry'],'parameters':[dict(p)for p in self.params.values()],'return_type':l1['return_type'],'collections':[dict(c)for c in self.collections.values()],'fields':[dict(name=f['name'],width=f['size']*8,owner=owner[0],argument=owner[1]if owner[0]=='entity'else None,address=None if owner[0]in('entity','reference')else owner[1],offset=start,**({'domain':self.state_domain(owner,start)}if self.state_domain(owner,start)else{}),**({'reference':owner[1]}if owner[0]=='reference'else{}))for(owner,start),f in self.fields.items()],'assets':[{'name':a['name'],'address':a['start'],'bytes':a['end'],**({'derivation':a['derivation']}if a.get('derivation')else{})}for a in self.assets.values()],'assumptions':self.assumptions,'l0_sha256':hashlib.sha256(json.dumps(self.l0,sort_keys=True).encode()).hexdigest()}
        if self.bound_resources:
            l1['resource_references']=[{'id':c['id'],'token':c['token']}for c in self.bound_resources]
            l1['resource_fields']={c['field']:c['id']for c in self.bound_resources}
            for f in l1['state']:
                if f['name']in l1['resource_fields']:f['resource_reference']=l1['resource_fields'][f['name']]
            adapter['resource_references']=self.bound_resources
        if self.object_refs:l1['state_owners']=[{'id':name,'identity':self.object_contract.get(f'{cell:08x}',{}).get('identity',name),'ownership':'distinct_owned_object','lifetime':'invocation','separation':'accessed_views_disjoint_with_evidenced_context_layouts','evidence':self.object_contract.get(f'{cell:08x}',{}).get('evidence',[])}for cell,name in self.object_refs.items()]
        if basic_flow:adapter['cfg_lowering']={'kind':'acyclic_basic_blocks/0.1','blocks':len(self.blocks),'source_ops':sum(len(b['ops'])for b in self.blocks.values()),'phi_edges':'all predecessor inputs snapshotted before any destination assignment','source_l0_unchanged':True}
        if self.ignored_return_proof:adapter['return_projection']=self.ignored_return_proof
        if self.domain_reductions:adapter['domain_reductions']=self.domain_reductions
        if self.project_load_lanes:adapter['load_lane_projection']={'method':'backwards_observable_bit_demand','roots':['stores','branches','calls','returns','memory_addresses'],'views':{key:{'first_byte':v[0],'bytes':v[1]}for key,v in self.load_views.items()}}
        if self.argument_contract.get('shared_views'):
            l1.setdefault('state_owners',[])
            for view in self.argument_contract['shared_views']:l1['state_owners'].append({'id':'entity_'+view['argument'],'identity':'current_record_view','ownership':'shared_record_view','lifetime':'invocation','separation':'canonical_typed_record_lanes'if view['argument']in self.canonical_pool_arguments else'only_proven_disjoint_accessed_slices_scalarized','container':self.object_refs[int(view['root_cell'],16)],'capacity':view['count'],'evidence':view['evidence']})
        if self.argument_contract:adapter['argument_contract']=self.argument_contract
        if self.argument_contract.get('return_abi'):adapter['return_abi']=self.argument_contract['return_abi']
        if self.argument_contract.get('shared_views'):adapter['argument_views']=[dict(v,reference=self.object_refs[int(v['root_cell'],16)])for v in self.argument_contract['shared_views']]
        if self.object_refs:adapter['object_references']=[{'name':name,'cell':cell,'lifetime':'stable_for_invocation','alias_contract':'distinct_owned_object','evidence':self.object_contract.get(f'{cell:08x}',{}).get('evidence',[]),'identity':self.object_contract.get(f'{cell:08x}',{}).get('identity',name)}for cell,name in self.object_refs.items()]
        if self.entity_refs:
            adapter['entity_references']=[dict(descriptor,name=name)for name,descriptor in self.entity_refs.items()]
            l1.setdefault('state_owners',[]).extend({'id':name,'identity':name,'ownership':'caller_owned_readonly_region','lifetime':'invocation','separation':'explicit_distinct_accessed_views','evidence':descriptor['evidence']}for name,descriptor in self.entity_refs.items())
        if self.assets:
            from readonly_assets import canonicalize
            l1,adapter=canonicalize(l1,adapter,self.rom,{key:value for asset in self.assets.values()for key,value in asset.get('read_views',{}).items()})
        if self.service_inventory and(self.object_refs or self.entity_refs):raise Unsupported('retained service cannot assume reference stability')
        if self.service_calls:
            from retained_services import module_metadata
            contracts=list({c['id']:c for c in self.service_calls.values()}.values());metadata=module_metadata(contracts)
            l1['limitations'].extend(metadata.pop('limitations'));l1.update(metadata);adapter['retained_services']=contracts
        if self.service_frame_proofs:adapter['retained_service_call_frames']=list(self.service_frame_proofs)
        if self.dependencies:
            if self.callee_range_proofs:
                from callee_ranges import digest
                for entry,proof in self.callee_range_proofs.items():
                    dep,dependency_adapter=self.callees[entry]
                    if digest(dep)!=proof['callee_model_sha256']or digest(dependency_adapter)!=proof['adapter_model_sha256']:raise Unsupported('callee return range source changed before inline')
                    adapter.setdefault('assumptions',[]).append(proof)
                    adapter.setdefault('callee_return_ranges',[]).append(proof)
            from inline import inline_dependencies
            l1,adapter=inline_dependencies(l1,adapter,list(self.dependencies.values()),rom=self.rom,service_evidence=self.service_evidence)
        if self.readonly_entry_proofs:
            from readonly_entry import validate_materialized
            l1['preconditions'].extend(validate_materialized(self.readonly_entry_proofs,l1,adapter))
            adapter['readonly_entry_reads']=self.readonly_entry_proofs
        return l1,adapter

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('l0',type=Path);p.add_argument('rom',type=Path);p.add_argument('out',type=Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    try:
        x,adapter=Lifter(json.loads(a.l0.read_text()),a.rom.read_bytes()).build()
        (a.out/'l1.json').write_text(json.dumps(x,indent=2)+'\n');(a.out/'validation-adapter.json').write_text(json.dumps(adapter,indent=2)+'\n')
    except Unsupported as e:
        (a.out/'failure.json').write_text(json.dumps({'status':'unsupported','reason':str(e)},indent=2)+'\n');raise
