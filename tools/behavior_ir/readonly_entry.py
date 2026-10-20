"""Bounded exact entry-byte snapshots through proven non-clobbering calls.
The original CFG and SSA stay intact; facts only specialize certified reads.
"""
import hashlib,json
class Unproven(ValueError):pass

def disjoint(writes,root,offset,width,view):
    """Reject unknown ownership, dynamic widths, or any admitted-slot overlap."""
    for w in writes:
        if w.get('root')!=root:raise Unproven('foreign or unknown write root')
        if type(w.get('offset'))is not int or type(w.get('bytes'))is not int or w['bytes']<=0:raise Unproven('unbounded write footprint')
        for slot in range(view['count']):
            lo=view['base_offset']+slot*view['stride']+offset
            if lo<w['offset']+w['bytes']and w['offset']<lo+width:raise Unproven('prefix write may overlap constrained read')
    return True

def _prove(lifter,request,dependencies):
    # Exact input is a declared precondition, not inferred state ownership.
    if request.get('width_bits')!=8:raise Unproven('unsupported exact domain width')
    width=request['width_bits']//8;value=request['value']
    if type(value)is not int or not 0<=value<1<<request['width_bits']:raise Unproven('invalid exact input value')
    l0=lifter.l0
    canonical=hashlib.sha256(json.dumps(l0,sort_keys=True).encode()).hexdigest()
    if canonical!=request['l0_canonical_sha256']:raise Unproven('stale source L0 pin')
    blocks={b['id']:b for b in l0['blocks']}
    if lifter.blocks!=blocks or {v['id']:v for v in l0['varnodes']}!=lifter.v:raise Unproven('current CFG/varnodes differ from original source')
    incoming={bid:[]for bid in blocks}
    for bid,b in blocks.items():
        for dst in b['successors']:
            if dst not in blocks:raise Unproven('source CFG edge outside original blocks')
            incoming[dst].append(bid)
    if any(sorted(incoming[bid])!=sorted(b['predecessors'])for bid,b in blocks.items()):raise Unproven('source CFG predecessor mismatch')
    found=[(b,o)for b in blocks.values()for o in b['ops']if o['opcode']=='LOAD'and o['pc']==request['load_pc']]
    if len(found)!=1:raise Unproven('exact read instruction not unique')
    target,load=found[0]
    if lifter.defs.get(load['output'])!=load:raise Unproven('current target SSA definition differs from original load')
    if lifter.v[load['output']]['size']!=width:raise Unproven('load width mismatch')
    owner,arg,delta=lifter.ptr(load['inputs'][1])
    if owner!='entity'or arg!=request['argument']or delta!={'op':'const','type':'u32','value':request['offset']}:raise Unproven('read is not exact declared entity field')
    views=[v for v in lifter.argument_contract.get('shared_views',[])if v['argument']==arg]
    if len(views)!=1:raise Unproven('one evidenced shared actor view required')
    view=views[0];root=int(view['root_cell'],16)
    if not view.get('evidence')or not 1<=view['count']<=64 or not 0<=request['offset']<request['offset']+width<=view['stride']:raise Unproven('view bounds/evidence missing')
    # All predecessors that can reach this particular read, not one chosen path.
    prefix=set();pending=[target['id']]
    while pending:
        bid=pending.pop()
        if bid in prefix:continue
        if len(prefix)>=16:raise Unproven('read prefix block cap')
        prefix.add(bid);pending+=blocks[bid]['predecessors']
    if min(blocks)not in prefix:raise Unproven('read not reachable from entry')
    # Any backedge/cycle in the prefix is unsupported.
    visiting=set();done=set()
    def visit(bid):
        if bid in visiting:raise Unproven('cyclic read prefix')
        if bid in done:return
        visiting.add(bid)
        for dst in blocks[bid]['successors']:
            if dst in prefix:visit(dst)
        visiting.remove(bid);done.add(bid)
    visit(min(blocks))
    calls=[];writes=[];ops=0
    for bid in sorted(prefix):
        for o in blocks[bid]['ops']:
            if bid==target['id']and o['id']==load['id']:break
            ops+=1
            if ops>1024:raise Unproven('read prefix operation cap')
            if o['opcode']=='STORE':raise Unproven('own prefix STORE needs explicit alias proof')
            if o['opcode']in('CALLIND','CALLOTHER'):raise Unproven('unknown indirect or other prefix call')
            if o['opcode']!='CALL':continue
            target_node=lifter.v[o['inputs'][0]]
            if target_node['space']!='ram':raise Unproven('prefix CALL target is not direct source RAM-space code address')
            address=int(target_node['offset']);entry=f'{address:08x}'
            if entry not in dependencies:raise Unproven('unknown prefix callee effects '+entry)
            d=dependencies[entry]
            if entry not in lifter.callees:raise Unproven('callee absent from actual imported pair')
            actual_l1,a=lifter.callees[entry]
            if actual_l1!=d['l1'] or a!=d['adapter']:raise Unproven('declared helper differs from actual imported callee pair')
            from publish import effects as derive_actual_effects
            effects=derive_actual_effects(actual_l1)
            if effects!=d['effects']:raise Unproven('declared helper effects differ from actual imported L1')
            from publish import effects as derive_effects
            def model_sha(x):return hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()
            for key,model in [('l1',d['l1']),('adapter',a),('effects',effects)]:
                if model_sha(model)!=d['pins'][key+'_model_sha256']:raise Unproven('stale imported helper '+key+' footprint identity')
            if derive_effects(d['l1'])!=effects:raise Unproven('incomplete imported helper effects')
            if d['l1'].get('collections'):raise Unproven('prefix imported collection effects need joint alias proof')
            if any(r.get('lifetime')!='stable_for_invocation'for r in a.get('object_references',[])):raise Unproven('prefix mutable reference lifetime')
            if effects.get('collection_writes'):raise Unproven('prefix collection writes unsupported')
            fields={f['name']:f for f in a['fields']};callee_writes=[]
            for name in effects['writes']:
                f=fields[name]
                if f['owner']!='reference':raise Unproven('prefix non-reference write needs alias proof')
                refs={r['name']:r['cell']for r in a['object_references']}
                callee_writes.append({'root':refs[f['reference']],'offset':f['offset'],'bytes':f['width']//8})
            disjoint(callee_writes,root,request['offset'],width,view);writes+=callee_writes;calls.append({'entry':entry,'pc':o['pc'],'pins':dict(d['pins'],actual_imported_l1_canonical_sha256=model_sha(actual_l1),actual_imported_adapter_canonical_sha256=model_sha(a),actual_derived_effects_sha256=model_sha(effects)),'write_windows':callee_writes})
    domainkey='entity:'+arg+':'+str(request['offset']);domain=lifter.state_domains.get(domainkey)
    if domain!={'unsigned_min':value,'unsigned_max':value}:raise Unproven('exact declared input domain missing')
    return {'kind':'certified_exact_entry_byte_read','source_l0_canonical_sha256':canonical,'entry':l0['entry'],'load_pc':load['pc'],'load_output':load['output'],'exact_value':value,'argument':arg,'offset':request['offset'],'width_bits':request['width_bits'],'shared_view':view,'prefix_blocks':sorted(prefix),'prefix_calls':calls,'assumption':'Entry state field equals exact value. Reachability and external caller enforcement remain preconditions.','native_requirement':'Constrained input field MUST remain in adapter/oracle setup even after branch reduction.'}


def certify(lifter,requests):
    if not isinstance(requests,list)or len(requests)!=1:raise Unproven('one exact entry read supported')
    from publish import effects
    def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
    dependencies={}
    for entry,(body,adapter)in lifter.callees.items():
        derived=effects(body)
        dependencies[entry]={'l1':body,'adapter':adapter,'effects':derived,'pins':{
            'l1_model_sha256':digest(body),'adapter_model_sha256':digest(adapter),'effects_model_sha256':digest(derived)}}
    return [_prove(lifter,requests[0],dependencies)]


def validate_materialized(proofs,l1,adapter):
    """Keep the actual native entry byte, and prohibit later clobbers too.

    The field domain also feeds ordinary range analysis, so this first version
    requires the constrained byte remain invariant throughout the admitted body.
    """
    from publish import effects
    fields={f['name']:f for f in adapter['fields']}
    references={r['name']:r['cell']for r in adapter.get('object_references',[])}
    writes=effects(l1)
    if writes['collection_writes']:raise Unproven('entry invariant collection writes unsupported')
    constraints=[]
    for proof in proofs:
        offset=proof['offset'];argument=proof['argument'];value=proof['exact_value']
        constrained=[f for f in fields.values()if f['owner']=='entity'and f.get('argument')==argument and f['offset']==offset and f['width']==8]
        if len(constrained)!=1 or constrained[0].get('domain')!={'unsigned_min':value,'unsigned_max':value}:raise Unproven('certified native entry byte/domain was not retained')
        constraints.append('Certified entry byte '+constrained[0]['name']+' must equal '+str(value)+'; the admitted body preserves this byte and source reachability remains conditional.')
        root=int(proof['shared_view']['root_cell'],16)
        for name in writes['writes']:
            field=fields[name];size=field['width']//8
            if field['owner']=='entity'and field.get('argument')==argument:
                if field['offset']<offset+1 and offset<field['offset']+size:raise Unproven('admitted body clobbers exact entry byte')
            elif field['owner']=='reference':
                disjoint([{'root':references[field['reference']],'offset':field['offset'],'bytes':size}],root,offset,1,proof['shared_view'])
            else:raise Unproven('admitted body write requires entry-invariant alias proof')
    return constraints
