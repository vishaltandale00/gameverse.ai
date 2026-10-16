"""Canonical bounded global byte views; never duplicate overlapping mutable RAM.
Contiguous bounded global views share byte storage. Own scalar/collection reads
and writes preserve little-endian widths; unsupported callee lane views reject.
"""
def _const(n):return {'op':'const','type':'u32','value':n}
def _add(e,n):return e if not n else {'op':'add_wrap','type':'u32','args':[e,_const(n)]}


def canonicalize_byte_collections(lifter,max_bytes=4096):
    groups=[]
    for key,c in list(lifter.collections.items()):
        if c.get('address') is None or c['size']not in(1,2,4)or c.get('stride',c['size'])!=c['size']or c.get('canonical_pool'):continue
        lo,hi=c['address'],c['address']+c['count']*c['size']
        if not (0x02000000<=lo<hi<=0x02040000 or 0x03000000<=lo<hi<=0x03008000):continue
        touching=[g for g in groups if lo<g['hi'] and g['lo']<hi]
        g={'lo':lo,'hi':hi,'members':[(key,c)]}
        for old in touching:g['lo']=min(g['lo'],old['lo']);g['hi']=max(g['hi'],old['hi']);g['members']+=old['members'];groups.remove(old)
        groups.append(g)
    proofs=[]
    for g in groups:
        lo,hi=g['lo'],g['hi']
        if hi-lo>max_bytes:raise ValueError('canonical byte region budget exceeded')
        globals_used=[(start,size)for kind,owner,start,size in lifter.access.values()if kind=='state'and owner==('global',0)]+[(c['address'],c['size']*c['count'])for c in lifter.collections.values()if c.get('address')is not None]
        if any(0x02000000<=start<0x04000000 and not (0x02000000<=start<start+size<=0x02040000 or 0x03000000<=start<start+size<=0x03008000)for start,size in globals_used):raise ValueError('canonical byte region cannot combine uncanonicalized RAM mirror views')
        # Callee scalar/mixed-width collection bindings need their own lane ABI.
        # Own LOAD/STORE views can safely use ordered little-endian byte lanes.
        overlapping=[(key,kind,owner,start,size)for key,(kind,owner,start,size)in lifter.access.items()if kind=='state' and owner==('global',0) and lo<start+size and start<hi]
        if len(g['members'])<2 and not overlapping:continue
        mixed=any(c['size']!=1 for _,c in g['members'])or any(size!=1 for _,_,_,_,size in overlapping)
        if mixed and not lifter.argument_contract.get('experimental_mixed_width_regions',False):raise ValueError('mixed-width global byte regions are experimental; native OAM mismatch remains unresolved')
        if any(start<lo or start+size>hi for _,_,_,start,size in overlapping):raise ValueError('canonical byte region scalar straddles backing boundary')
        if any(c['size']!=1 and c['name'].startswith('dependency_')for _,c in g['members']):raise ValueError('canonical byte region callee width conversion unresolved')
        if any(lifter.state_domain(owner,start)for key,_,owner,start,size in overlapping):raise ValueError('canonical byte region scalar domain propagation unresolved')
        if any(size not in(1,2,4)or key.startswith('call/') for key,_,_,_,size in overlapping):raise ValueError('canonical byte region scalar/callee lane conversion unresolved')
        key=('byte_region',lo);name='byte_region_'+str(len(proofs));refs=[]
        for old,c in g['members']:
            refs.extend(c.get('refs',[]))
            for access,value in list(lifter.access.items()):
                kind,owner,index,size=value
                if kind=='collection' and owner==old:
                    byte_index=index if c['size']==1 else {'op':'mul_wrap','type':'u32','args':[index,_const(c['size'])]}
                    lifter.access[access]=('byte_region',key,_add(byte_index,c['address']-lo),size)
            del lifter.collections[old]
        for access,_,_,start,size in overlapping:lifter.access[access]=('byte_region',key,_const(start-lo),size)
        lifter.collections[key]={'name':name,'size':1,'count':hi-lo,'refs':refs,'address':lo,'canonical_byte_region':True}
        proofs.append({'kind':'canonical_mutable_byte_region','address':lo,'bytes':hi-lo,'views':[{'address':c['address'],'bytes':c['count']*c['size'],'width':c['size']}for _,c in g['members']],'basis':'Exact overlapping global byte intervals share one backing; no memory copies or writes introduced'})
    return proofs


def canonicalize_contained_scalars(lifter):
    """Reuse one existing contiguous typed object collection for exact own lanes.

    No new storage, width conversion, dynamic indexing or imported scalar ABI is
    introduced. Unsupported overlaps remain subject to the caller's alias gate.
    """
    changes=[]
    for access,(kind,owner,start,size)in list(lifter.access.items()):
        if kind!='state' or owner[0]not in('entity','reference'):continue
        candidates=[]
        for key,c in lifter.collections.items():
            if c.get('address')is not None or c.get('canonical_pool'):continue
            collection_owner=(c.get('owner'),c.get('reference')or c.get('argument'))
            if collection_owner!=owner:continue
            base=c['offset'];end=base+(c['count']-1)*c.get('stride',c['size'])+c['size']
            if base<start+size and start<end:candidates.append((key,c,base,end))
        if not candidates:continue
        if len(candidates)!=1:raise ValueError('scalar overlaps multiple typed collections')
        key,c,base,end=candidates[0]
        if access.startswith('call/'):raise ValueError('callee scalar to collection binding unresolved')
        if size!=c['size'] or c.get('stride',size)!=size:raise ValueError('scalar collection width or stride mismatch')
        if not base<=start<start+size<=end or (start-base)%size:raise ValueError('scalar collection lane not aligned and contained')
        if lifter.state_domain(owner,start):raise ValueError('scalar collection domain propagation unresolved')
        changes.append((access,key,(start-base)//size,size,owner,start))
    # Validate every overlap before mutating the source access map.
    for access,key,index,size,owner,start in changes:
        lifter.access[access]=('collection',key,_const(index),size)
        refs=lifter.collections[key].setdefault('refs',[])
        if access not in refs:refs.append(access)
    return [{'kind':'existing_typed_collection_scalar_lane','access':access,'collection':lifter.collections[key]['name'],'index':index,'width':size,'owner':list(owner),'offset':start,'basis':'Same owner, exact width, contiguous existing collection, aligned contained lane; original access order unchanged'}for access,key,index,size,owner,start in changes]


def rebase_constant_bias(pointer):
    """Exact modular pointer algebra: base + (index - 8) -> (base-8)+index.
    This changes neither bitvector arithmetic nor memory ownership. It only
    exposes a bounded variable offset when an immutable/global base is literal.
    """
    kind,base,offset=pointer
    if kind not in ('asset','global') or not isinstance(base,int):return pointer
    mask=(1<<32)-1
    def split(e):
        if e.get('type')!='u32':return e,0
        if e['op']=='const':return None,e['value']&mask
        if e['op']=='add_wrap':
            a,x=split(e['args'][0]);b,y=split(e['args'][1])
            return (b if a is None else a if b is None else {'op':'add_wrap','type':'u32','args':[a,b]}),(x+y)&mask
        if e['op']=='sub_wrap' and e['args'][1]['op']=='const':
            a,x=split(e['args'][0]);return a,(x-e['args'][1]['value'])&mask
        if e['op']=='mul_wrap':
            for index in (0,1):
                if e['args'][index]['op']=='const':
                    value=e['args'][index]['value'];a,x=split(e['args'][1-index])
                    return (None if a is None else {'op':'mul_wrap','type':'u32','args':[a,_const(value)]}),(x*value)&mask
        return e,0
    variable,bias=split(offset)
    if not bias:return pointer
    adjusted=(base+bias)&mask
    if kind=='asset' and not 0x08000000<=adjusted<0x0e000000:return pointer
    if kind=='global' and not (0x02000000<=adjusted<0x02040000 or 0x03000000<=adjusted<0x03008000):return pointer
    return kind,adjusted,variable if variable is not None else _const(0)


def fixed_ram_phi_offsets(pointers,max_span=4096,bounds=None):
    """One canonical RAM owner for finite, source-bounded pointer alternatives.
    Every offset must be nonwrapping and the complete accessed base span remain
    in one canonical RAM window. Overlapping widths still need alias partition.
    """
    if not pointers or any(p[0]!='global'for p in pointers):return None
    ranges=[]
    for _,base,offset in pointers:
        interval=(offset['value'],offset['value'])if offset['op']=='const'else bounds(offset)if bounds else None
        if interval is None or not 0<=interval[0]<=interval[1]<=max_span:return None
        ranges.append((base+interval[0],base+interval[1]))
    base=min(p[1]for p in pointers);hi=max(end for _,end in ranges)
    if hi-base>max_span:return None
    if not (0x02000000<=base<=hi<0x02040000 or 0x03000000<=base<=hi<0x03008000):return None
    return base,[_add(p[2],p[1]-base)for p in pointers]


def fixed_rom_phi_offsets(pointers,rom_size,max_span=65536,bounds=None):
    """Rebase immutable source alternatives onto one bounded ROM byte asset.

    Only pointer offsets change representation. The original predecessor picks
    the offset; ordinary access validation still checks width and final index.
    Mixed owners, modular intervals and targets outside this ROM fail closed.
    """
    if not pointers or any(p[0]!='asset'for p in pointers):return None
    base=min(p[1]for p in pointers)
    if not 0x08000000<=base<0x08000000+rom_size:return None
    for _,address,offset in pointers:
        if offset.get('type')!='u32':return None
        interval=(offset['value'],offset['value'])if offset['op']=='const'else bounds(offset)if bounds else None
        if interval is None or not 0<=interval[0]<=interval[1]<=max_span:return None
        if not base<=address+interval[0]<=address+interval[1]<0x08000000+rom_size:return None
        if address+interval[1]-base>max_span:return None
    return base,[_add(p[2],p[1]-base)for p in pointers]
