"""L0-aware closure linking finishes BEFORE publishing address-free L1.
Dependency bodies remain serialized expression trees, not opaque C snippets.
"""
import copy,hashlib,json

def contains_service(value):
    if isinstance(value,list):return any(contains_service(z)for z in value)
    if isinstance(value,dict):return value.get('op')=='retained_native_service'or any(contains_service(z)for z in value.values())
    return False

def merge_services(contracts):
    """Deduplicate exact authenticated contracts, never merely matching IDs."""
    by_id={};by_entry={}
    for c in contracts:
        if c['id']in by_id and by_id[c['id']]!=c:raise ValueError('retained service symbolic identity conflict')
        if c['entry']in by_entry and by_entry[c['entry']]!=c:raise ValueError('retained service source entry conflict')
        by_id[c['id']]=c;by_entry[c['entry']]=c
    return list(by_id.values())

def imported_services(dep,adapter,rom=None,service_evidence=None,validate_body=True):
    """Require byte-authenticated source inventory and exact address-free ABI.

    The caller uses this before specialization, and the linker repeats it at
    materialization. No service effect is inferred from the inlined scalar body.
    """
    bearing=bool(dep.get('retained_services')or adapter.get('retained_services')or contains_service(dep.get('body',[])))
    if not bearing:return []
    from retained_services import validate_service,signature
    if rom is None:raise ValueError('retained service import requires source ROM/evidence')
    signatures=dep.get('retained_services');contracts=adapter.get('retained_services')
    if not isinstance(signatures,list)or not signatures or not isinstance(contracts,list)or not contracts:raise ValueError('retained service import missing inventory')
    normalized=[validate_service(c,rom,service_evidence)for c in contracts]
    if len(merge_services(normalized))!=len(normalized):raise ValueError('duplicate imported retained service inventory')
    expected={c['id']:signature(c)for c in normalized}
    if len(signatures)!=len(expected)or any(not isinstance(s,dict)or s.get('id')not in expected or s!=expected[s['id']]for s in signatures)or len({s['id']for s in signatures})!=len(signatures):raise ValueError('retained service L1/adapter signature mismatch')
    if dep.get('execution_scope')!='source_pinned_native_only'or dep.get('semantic_closure')!='OPEN':raise ValueError('retained service import must remain native-only OPEN')
    for document in(dep,adapter):
        if any(document.get(k)for k in('state_owners','object_references','entity_references','argument_views','state_domains','readonly_entry_reads')):raise ValueError('retained service import cannot assume reference stability or state domains')
        if any(p.get('domain')for p in document.get('state',[])+document.get('fields',[])):raise ValueError('retained service import cannot assume state domains')
        if any(document.get('argument_contract',{}).get(k)for k in('entity_references','shared_views','readonly_entry_reads')):raise ValueError('retained service import cannot assume stable argument references')
    if validate_body:
        from contract import validate
        validate(dep)
    return normalized

def merge_resources(contracts,check_fields=True):
    """Resource identity excludes its renamed canonical field, never source pins."""
    identities={};tokens={};native={};fields={};out=[]
    for c in contracts:
        identity={k:v for k,v in c.items()if k!='field'}
        for namespace,key in((identities,c['id']),(tokens,c['token']),(native,c['native_value'])):
            if key in namespace and namespace[key]!=identity:raise ValueError('resource identity/token/native source conflict')
            namespace[key]=identity
        if check_fields and c['field']in fields and fields[c['field']]!=c:raise ValueError('resource canonical field conflict')
        if c not in out:out.append(c)
        fields[c['field']]=c
    return out

def imported_resources(dep,adapter,rom=None,evidence=None,validate_body=True):
    inventory=dep.get('resource_references',[]);fields=dep.get('resource_fields',{});contracts=adapter.get('resource_references',[])
    def contains(value):
        if isinstance(value,list):return any(contains(v)for v in value)
        if isinstance(value,dict):return value.get('op')=='resource_reference'or any(contains(v)for v in value.values())
        return False
    if not(inventory or fields or contracts or any(f.get('resource_reference')for f in dep.get('state',[]))or contains(dep.get('body',[]))):return []
    from resource_reference import validate_contract
    if rom is None or not isinstance(inventory,list)or not inventory or not isinstance(fields,dict)or not fields or not isinstance(contracts,list)or not contracts:raise ValueError('resource import requires source ROM and exact inventories')
    normalized=[validate_contract(c,rom,evidence or {})for c in contracts]
    if len(merge_resources(normalized))!=len(normalized):raise ValueError('duplicate resource adapter inventory')
    expected={c['id']:c['token']for c in normalized}
    if len(inventory)!=len(expected)or any(not isinstance(r,dict)or set(r)!={'id','token'}or expected.get(r['id'])!=r['token']for r in inventory)or len({r['id']for r in inventory})!=len(inventory):raise ValueError('resource L1/adapter inventory mismatch')
    if fields!={c['field']:c['id']for c in normalized}:raise ValueError('resource L1/adapter field mismatch')
    state={f['name']:f for f in dep['state']}
    if any(name not in state or state[name].get('storage_type')!='u32'or state[name].get('resource_reference')!=identity for name,identity in fields.items()):raise ValueError('resource field requires matching typed state declaration')
    if any(f.get('resource_reference')and fields.get(f['name'])!=f['resource_reference']for f in dep['state']):raise ValueError('unlisted resource state declaration')
    if validate_body:
        from contract import validate
        validate(dep)
    return normalized

def inline_dependencies(l1,adapter,dependencies,*,rom=None,service_evidence=None):
    # Validate resource source pins before full imported service/body validation.
    resources=imported_resources(l1,adapter,rom,service_evidence,validate_body=False)
    dependency_resources=[imported_resources(dep,da,rom,service_evidence)for dep,da in dependencies]
    merge_resources(resources+[c for contracts in dependency_resources for c in contracts],check_fields=False)
    # Validate all imported inventories before mutating caller declarations.
    contracts=imported_services(l1,adapter,rom,service_evidence,validate_body=False)
    for dep,da in dependencies:contracts.extend(imported_services(dep,da,rom,service_evidence))
    contracts=merge_services(contracts)
    if contracts:
        for document in(l1,adapter):
            if any(document.get(k)for k in('state_owners','object_references','entity_references','argument_views','state_domains','readonly_entry_reads')):raise ValueError('retained service caller cannot assume reference stability or state domains')
            if any(p.get('domain')for p in document.get('state',[])+document.get('fields',[])):raise ValueError('retained service caller cannot assume state domains')
            if any(document.get('argument_contract',{}).get(k)for k in('entity_references','shared_views','readonly_entry_reads')):raise ValueError('retained service caller cannot assume stable argument references')
    imported=[];links=[]
    for i,(dep,da)in enumerate(dependencies):
        prefix=f'dependency_{i}_';renames={};parameters={p['name']for p in dep['parameters']}
        def rename(kind,old):return renames[(kind,old)]
        # Scalar state views were bound and partitioned in the caller before L1
        # serialization. A callee never allocates another copy of aliased state.
        for c in da.get('collections',[]):
            if c['address']is None:continue # Bound separately at each actual callsite.
            equivalent=next((x for x in adapter['collections']if x['address']==c['address']and x['size']==c['size']and x['count']==c['count']),None)
            if equivalent is None and c['address']is not None and c['size']==1:
                equivalent=next((x for x in adapter['collections']if x.get('canonical_byte_region')and x['address']<=c['address']and c['address']+c['count']<=x['address']+x['count']),None)
            name=equivalent['name']if equivalent else prefix+c['name'];renames[('collection',c['name'])]=name
            renames[('collection_offset',c['name'])]=(c['address']-equivalent['address'])if equivalent and c['address']is not None else 0
            if not equivalent:
                adapter['collections'].append(dict(c,name=name));lc=next(x for x in dep['collections']if x['name']==c['name']);l1['collections'].append(dict(lc,name=name))
        for a in dep['assets']:
            name=prefix+a['name'];renames[('asset',a['name'])]=name;l1['assets'].append(dict(a,name=name))
        for v in dep['locals']:
            name=prefix+v['name'];renames[('local',v['name'])]=name;l1['locals'].append(dict(v,name=name))
        imported.append((dep,renames,da))
        for proof in da.get('retained_service_call_frames',[]):
            retained=copy.deepcopy(proof)
            namespace=retained.get('provenance_namespace')
            retained['provenance_namespace']=prefix[:-1]+('/'+namespace if namespace else '')
            # Source SSA/call IDs remain original, under the explicit link scope.
            adapter.setdefault('retained_service_call_frames',[]).append(retained)
        for key in('preconditions','limitations'):
            for obligation in dep.get(key,[]):
                value=prefix+obligation
                if value not in l1[key]:l1[key].append(value)
        links.append({'id':prefix[:-1],'behavior_sha256':hashlib.sha256(json.dumps(dep,sort_keys=True).encode()).hexdigest(),'provenance_namespace':prefix[:-1],'status':'inlined_from_serialized_l1'})
    def expand(ss):
        out=[]
        for s in ss:
            if s['op']=='call':
                i=s['dependency'];dep,renames,da=imported[i]
                resource_bindings={}
                for resource in dependency_resources[i]:
                    binding=s['field_bindings'].get(resource['field'],{});pieces=binding.get('pieces',[])
                    if len(pieces)!=1 or pieces[0].get('type')!='u32'or pieces[0].get('shift')!=0:raise ValueError('resource import requires one full u32 field binding')
                    target=pieces[0]['field']
                    if binding.get('value')!={'op':'field','type':'u32','name':target}:raise ValueError('resource import requires exact canonical field binding')
                    declaration=next((f for f in l1['state']if f['name']==target),None)
                    if declaration is None or declaration.get('storage_type')!='u32':raise ValueError('resource import destination must be full u32 state')
                    if declaration.get('resource_reference',resource['id'])!=resource['id']:raise ValueError('resource state identity conflict')
                    declaration['resource_reference']=resource['id'];resource_bindings[resource['field']]=target
                    resources.append(dict(copy.deepcopy(resource),field=target))
                    merge_resources(resources)
                def rewrite(x):
                    if isinstance(x,list):
                        result=[]
                        for z in x:
                            if isinstance(z,dict)and z.get('op')=='return':
                                if 'result'in s:
                                    if 'value'not in z:raise ValueError('callee return value missing')
                                    value=rewrite(z['value']);destination=next(v['storage_type']for v in l1['locals']if v['name']==s['result'])
                                    if value['type']!=destination:
                                        if int(value['type'][1:])<int(destination[1:]):
                                            abi=da.get('return_abi',{})
                                            if not abi.get('evidence')or int(abi.get('unsigned_extension','u0')[1:])<int(destination[1:]):raise ValueError('callee unsigned return extension lacks evidence')
                                            value={'op':'zext','type':destination,'args':[value]}
                                        else:value={'op':'extract','type':destination,'args':[value,{'op':'const','type':'u32','value':0}]}
                                    result.append({'op':'assign_local','local':s['result'],'value':value,'provenance':s['provenance']})
                                result.append({'op':'leave_scope','provenance':s['provenance']})
                            elif isinstance(z,dict)and z.get('op')=='assign_field':
                                if z['field']in resource_bindings:
                                    value=z['value'];resource=next(r for r in dependency_resources[i]if r['field']==z['field'])
                                    if value!={'op':'resource_reference','type':'u32','resource':resource['id'],'token':resource['token']}and value!={'op':'const','type':'u32','value':0}:raise ValueError('resource import permits only direct typed resource or null stores')
                                    result.append({'op':'assign_field','field':resource_bindings[z['field']],'value':copy.deepcopy(value),'provenance':f'dependency_{i}/'+str(z['provenance'])});continue
                                binding=s['field_bindings'][z['field']];value=rewrite(z['value']);temporary='call_store_'+str(len(l1['locals']));l1['locals'].append({'name':temporary,'storage_type':value['type']});result.append({'op':'assign_local','local':temporary,'value':value,'provenance':s['provenance']})
                                for piece in binding['pieces']:
                                    result.append({'op':'assign_field','field':piece['field'],'value':{'op':'extract','type':piece['type'],'args':[{'op':'local','type':value['type'],'name':temporary},{'op':'const','type':'u32','value':piece['shift']}]},'provenance':s['provenance']})
                            else:result.append(rewrite(z))
                        return result
                    if not isinstance(x,dict):return x
                    if x.get('op')=='parameter':return copy.deepcopy(s['arguments'][x['name']])
                    if x.get('op')=='field':return copy.deepcopy(s['field_bindings'][x['name']]['value'])
                    y={k:rewrite(v)for k,v in x.items()}
                    if y.get('op')=='local':y['name']=renames[('local',y['name'])]
                    if 'local'in y:y['local']=renames[('local',y['local'])]
                    if y.get('op')=='retained_native_service'and 'result'in y:y['result']=renames[('local',y['result'])]
                    if 'collection'in y:
                        old_collection=y['collection'];offset=renames.get(('collection_offset',old_collection),0);y['collection']=s.get('collection_bindings',{}).get(old_collection,renames.get(('collection',old_collection)))
                        if y['collection']is None:raise ValueError('callee collection has no callsite binding')
                        if offset:y['index']={'op':'add_wrap','type':'u32','args':[y['index'],{'op':'const','type':'u32','value':offset}]}
                    if 'asset'in y:y['asset']=renames[('asset',y['asset'])]
                    if 'provenance'in y:y['provenance']=f'dependency_{i}/'+str(y['provenance'])
                    return y
                out.append({'op':'scope','body':rewrite(dep['body']),'provenance':s['provenance'],'dependency':links[i]['id']})
            elif s['op']=='control_flow':out.append(dict(s,blocks=[dict(b,body=expand(b['body']))for b in s['blocks']]))
            elif s['op']=='if':out.append(dict(s,then=expand(s['then']),**{'else':expand(s['else'])}))
            elif s['op']=='switch':out.append(dict(s,cases=[dict(c,body=expand(c['body']))for c in s['cases']],default=expand(s['default'])))
            else:out.append(s)
        return out
    l1['body']=expand(l1['body']);l1['dependencies']=links
    if resources:
        resources=merge_resources(resources)
        l1['resource_references']=list({r['id']:{'id':r['id'],'token':r['token']}for r in resources}.values())
        l1['resource_fields']={r['field']:r['id']for r in resources}
        adapter['resource_references']=copy.deepcopy(resources)
    if contracts:
        from retained_services import module_metadata
        metadata=module_metadata(contracts)
        for limitation in metadata.pop('limitations'):
            if limitation not in l1['limitations']:l1['limitations'].append(limitation)
        l1.update(metadata);adapter['retained_services']=copy.deepcopy(contracts)
    if contracts or resources:
        from contract import validate
        validate(l1)
    return l1,adapter
