"""Exact immutable ROM scalar views imported through a serialized callee ABI."""

def bind_field(lifter,body,adapter,field,base,delta,provenance):
    from contract import validate
    from domain import accepts
    validate(body)
    argument=field['argument']
    writes=set()
    def scan(value):
        if isinstance(value,list):
            for child in value:scan(child)
        elif isinstance(value,dict):
            if value.get('op')=='assign_field':writes.add(value['field'])
            if value.get('op')in('call','retained_native_service'):raise ValueError('ROM callee view cannot retain unknown effects')
            for child in value.values():scan(child)
    scan(body['body'])
    if body.get('retained_services')or adapter.get('retained_services')or adapter.get('object_references')or adapter.get('entity_references'):raise ValueError('ROM callee view cannot import reference or native effects')
    if any(f.get('owner')=='entity'and f.get('argument')==argument and f['name']in writes for f in adapter['fields']):raise ValueError('callee writes immutable ROM argument')
    if any(c.get('owner')=='entity'and c.get('argument')==argument for c in adapter.get('collections',[])):raise ValueError('ROM callee collection binding unsupported')
    declarations=[f for f in body['state']if f['name']==field['name']]
    if len(declarations)!=1 or [f for f in adapter['fields']if f['name']==field['name']]!=[field]:raise ValueError('ROM callee scalar declaration identity ambiguous')
    declaration=declarations[0]
    if declaration.get('domain',{})!=field.get('domain',{}):raise ValueError('ROM callee scalar input domain disagreement')
    width=field['width']//8
    if field['width']not in(8,16,32)or declaration is None or declaration['storage_type']!='u'+str(field['width']):raise ValueError('ROM callee scalar declaration width mismatch')
    if delta.get('op')!='const'or delta.get('type')!='u32':raise ValueError('ROM callee view requires exact constant object offset')
    start=base+delta['value']+field['offset'];end=start+width
    if not 0x08000000<=base<=start<end<=0x08000000+len(lifter.rom)or end-base>65536:raise ValueError('ROM callee scalar view escapes bounded own-ROM span')
    value=int.from_bytes(lifter.rom[start-0x08000000:end-0x08000000],'little')
    if not accepts(field.get('domain',{}),value,field['width']):raise ValueError('ROM callee scalar violates declared input domain')
    key=('callee_rom',start,width)
    asset=lifter.assets.setdefault(key,{'name':'asset_'+str(len(lifter.assets)),'start':start,'width':width,'end':width,'refs':[]})
    if provenance not in asset['refs']:asset['refs'].append(provenance)
    index={'op':'const','type':'u32','value':0}
    asset.setdefault('read_views',{})[provenance]={'asset':asset['name'],'index':index,'minimum':0,'maximum':0,'width':width}
    expression={'op':'asset_read','type':declaration['storage_type'],'asset':asset['name'],'index':index,'provenance':provenance}
    return {'value':expression,'pieces':[],'storage':'immutable_rom_scalar_view'}
