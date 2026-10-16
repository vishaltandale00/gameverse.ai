"""Canonical overlapping own-ROM byte windows with checked read rebasing.

Only source reads whose bounds were checked during access collection may move.
Derived assets and disjoint/merely adjacent source windows keep their identity.
"""
import copy


def _shape(value):
    if isinstance(value,list):return [_shape(v)for v in value]
    if isinstance(value,dict):return {k:_shape(v)for k,v in value.items()if not(k=='args'and v==[])}
    return value


def canonicalize(l1,adapter,rom,read_views,max_window=65536):
    if type(max_window)is not int or not 1<=max_window<=65536:raise ValueError('invalid immutable window budget')
    assets={a['name']:a for a in l1['assets']}
    metadata={a['name']:a for a in adapter['assets']}
    if len(assets)!=len(l1['assets'])or len(metadata)!=len(adapter['assets']):raise ValueError('duplicate immutable asset identity')
    groups=[]
    for name,asset in assets.items():
        info=metadata.get(name)
        if info is None:raise ValueError('immutable asset lacks source adapter identity')
        address=info.get('address')
        if address is None:continue
        if type(address)is not int or not 0x08000000<=address<0x08000000+len(rom):raise ValueError('asset canonicalization requires immutable own-ROM storage')
        if asset.get('mutable')or info.get('mutable'):raise ValueError('mutable asset canonicalization unsupported')
        size=len(asset['data'])
        if asset.get('storage_type')!='u8'or size<=0 or info.get('bytes')!=size or address+size>0x08000000+len(rom):raise ValueError('invalid immutable byte window')
        group={'lo':address,'hi':address+size,'names':[name]}
        touching=[g for g in groups if address<g['hi']and g['lo']<address+size]
        for old in touching:
            group['lo']=min(group['lo'],old['lo']);group['hi']=max(group['hi'],old['hi']);group['names']+=old['names'];groups.remove(old)
        groups.append(group)
    groups=[g for g in groups if len(g['names'])>1]
    if not groups:return l1,adapter
    # Validate everything before changing either output.
    aliases={};merged={};proofs=[]
    for group in groups:
        size=group['hi']-group['lo']
        if size>max_window:raise ValueError('canonical immutable window budget exceeded')
        names=[a['name']for a in l1['assets']if a['name']in group['names']]
        canonical=names[0];provenance=[];views=[]
        for name in names:
            source=assets[name];info=metadata[name];offset=info['address']-group['lo'];start=info['address']-0x08000000
            if source['data']!=list(rom[start:start+len(source['data'])]):raise ValueError('immutable window bytes differ from own ROM')
            aliases[name]=(canonical,offset,len(source['data']))
            provenance+=source.get('provenance',[])
            views.append({'name':name,'address':info['address'],'bytes':len(source['data']),'offset':offset})
        start=group['lo']-0x08000000
        merged[canonical]={'name':canonical,'storage_type':'u8','data':list(rom[start:start+size]),'provenance':list(dict.fromkeys(provenance))}
        proofs.append({'kind':'canonical_immutable_rom_window','canonical':canonical,'address':group['lo'],'bytes':size,'views':views,'basis':'Exact overlapping own-ROM byte intervals; every original read keeps its width and source-bounded index plus a constant byte offset'})
    def check(value):
        if isinstance(value,list):
            for child in value:check(child)
        elif isinstance(value,dict):
            if value.get('op')=='asset_read'and value['asset']in aliases:
                name=value['asset'];width=int(value['type'].removeprefix('u'))//8
                view=read_views.get(value.get('provenance'))
                if value['type']not in('u8','u16','u32','u64')or value['index'].get('type')!='u32':raise ValueError('unsupported canonical asset read width/index')
                if not view or view['asset']!=name or view['width']!=width or _shape(view['index'])!=_shape(value['index']):raise ValueError('canonical asset read lacks exact source access proof')
                canonical,offset,old_size=aliases[name]
                if not 0<=view['minimum']<=view['maximum'] or view['maximum']+width>old_size:raise ValueError('canonical source read exceeds original byte window')
                if value['index']['op']=='const'and not view['minimum']<=value['index']['value']<=view['maximum']:raise ValueError('constant asset index contradicts source access proof')
                if view['maximum']+offset+width>len(merged[canonical]['data']):raise ValueError('rebased immutable read exceeds canonical byte window')
            for child in value.values():check(child)
    check(l1['body'])
    result=copy.deepcopy(l1);adapted=copy.deepcopy(adapter)
    def rewrite(value):
        if isinstance(value,list):
            for child in value:rewrite(child)
        elif isinstance(value,dict):
            for child in list(value.values()):rewrite(child)
            if value.get('op')=='asset_read'and value['asset']in aliases:
                canonical,offset,_=aliases[value['asset']];value['asset']=canonical
                if offset:value['index']={'op':'add_wrap','type':'u32','args':[value['index'],{'op':'const','type':'u32','value':offset}]}
    rewrite(result['body'])
    result['assets']=[merged.get(a['name'],a)for a in result['assets']if a['name']not in aliases or aliases[a['name']][0]==a['name']]
    by_name={p['canonical']:p for p in proofs}
    adapted['assets']=[dict(a,address=by_name[a['name']]['address'],bytes=by_name[a['name']]['bytes'])if a['name']in by_name else a for a in adapted['assets']if a['name']not in aliases or aliases[a['name']][0]==a['name']]
    adapted.setdefault('assumptions',[]).extend(proofs)
    adapted['immutable_asset_windows']=proofs
    return result,adapted
