"""L0-aware closure linking finishes BEFORE publishing address-free L1.
Dependency bodies remain serialized expression trees, not opaque C snippets.
"""
import copy,hashlib,json

def inline_dependencies(l1,adapter,dependencies):
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
    return l1,adapter
