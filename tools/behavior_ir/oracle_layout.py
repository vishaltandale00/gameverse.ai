"""Disjoint native oracle image placement for source-pure immutable modules."""
DEFAULT_BASE=0x02020000
DEFAULT_BYTES=16384
PURE_BASE=0x02028000
PURE_BYTES=0x02040000-PURE_BASE


def select_layout(l1,adapter,rom):
    default={'kind':'default_16k','base':DEFAULT_BASE,'capacity':DEFAULT_BYTES}
    if sum(len(a.get('data',[]))for a in l1.get('assets',[]))<=DEFAULT_BYTES:return default
    # This arena never hosts modules with source RAM/reference/service effects.
    if any(l1.get(k)for k in('state','collections','retained_services')):return default
    if any(adapter.get(k)for k in('fields','collections','object_references','entity_references','argument_views','native_abi','native_sequence','continuation_tokens','retained_services')):return default
    from contract import validate
    try:validate(l1)
    except ValueError:return default
    def pure(ss):
        for s in ss:
            op=s['op']
            if op=='if':
                if not pure(s['then'])or not pure(s['else']):return False
            elif op=='scope':
                if not pure(s['body']):return False
            elif op not in('assign_local','return','leave_scope'):return False
        return True
    if not pure(l1['body']):return default
    declared=adapter.get('assets',[])
    if len(declared)!=len(l1['assets'])or len({a['name']for a in declared})!=len(declared):return default
    rom=rom()if callable(rom)else rom
    for asset in l1['assets']:
        matches=[a for a in declared if a['name']==asset['name']]
        if len(matches)!=1 or asset['storage_type']!='u8':return default
        view=matches[0];address=view.get('address');data=asset['data']
        if not isinstance(address,int)or view.get('bytes')!=len(data)or not 0x08000000<=address<=address+len(data)<=0x08000000+len(rom):return default
        if bytes(data)!=rom[address-0x08000000:address-0x08000000+len(data)]:return default
    return {'kind':'source_pure_immutable_upper_ewram','base':PURE_BASE,'capacity':PURE_BYTES,'basis':'Validated scalar/local structured IR, no source mutable storage or native/reference effects; every asset byte equals its declared own-ROM span','reserved_state_base':0x02024000,'reserved_object_window':[0x02010000,0x02018000]}


def validate_image(layout,size,entry):
    base=layout['base'];end=base+size
    if not 0<size<=layout['capacity']or not base<=entry<end:raise ValueError('generated image or entry escapes selected oracle code region')
    if layout['kind']=='source_pure_immutable_upper_ewram'and not PURE_BASE<=base<end<=0x02040000:raise ValueError('pure oracle image outside disjoint upper EWRAM')
    return dict(layout,bytes=size,end=end,entry=entry)
