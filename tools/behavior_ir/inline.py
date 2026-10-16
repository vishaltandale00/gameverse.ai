"""L0-aware closure linking finishes BEFORE publishing address-free L1.
Dependency bodies remain serialized expression trees, not opaque C snippets.
"""
import copy,hashlib,json

def inline_dependencies(l1,adapter,dependencies):
    imported=[];links=[]
    for i,(dep,da)in enumerate(dependencies):
        prefix=f'dependency_{i}_';renames={};parameters={p['name']for p in dep['parameters']}
        def rename(kind,old):return renames[(kind,old)]
        for f in da['fields']:
            if f['owner']!='global':raise ValueError('callee entity reference mapping unsupported')
            equivalent=next((x for x in adapter['fields']if x['owner']=='global'and x['address']+x['offset']==f['address']+f['offset']and x['width']==f['width']),None)
            name=equivalent['name']if equivalent else prefix+f['name'];renames[('field',f['name'])]=name
            if not equivalent:
                adapter['fields'].append(dict(f,name=name));lf=next(x for x in dep['state']if x['name']==f['name']);l1['state'].append(dict(lf,name=name))
        for c in da.get('collections',[]):
            equivalent=next((x for x in adapter['collections']if x['address']==c['address']and x['size']==c['size']and x['count']==c['count']),None)
            name=equivalent['name']if equivalent else prefix+c['name'];renames[('collection',c['name'])]=name
            if not equivalent:
                adapter['collections'].append(dict(c,name=name));lc=next(x for x in dep['collections']if x['name']==c['name']);l1['collections'].append(dict(lc,name=name))
        for a in dep['assets']:
            name=prefix+a['name'];renames[('asset',a['name'])]=name;l1['assets'].append(dict(a,name=name))
        for v in dep['locals']:
            name=prefix+v['name'];renames[('local',v['name'])]=name;l1['locals'].append(dict(v,name=name))
        imported.append((dep,renames))
        links.append({'id':prefix[:-1],'behavior_sha256':hashlib.sha256(json.dumps(dep,sort_keys=True).encode()).hexdigest(),'provenance_namespace':prefix[:-1],'status':'inlined_from_serialized_l1'})
    def expand(ss):
        out=[]
        for s in ss:
            if s['op']=='call':
                i=s['dependency'];dep,renames=imported[i]
                def rewrite(x):
                    if isinstance(x,list):return[rewrite(z)for z in x if not(isinstance(z,dict)and z.get('op')=='return')]
                    if not isinstance(x,dict):return x
                    if x.get('op')=='parameter':return copy.deepcopy(s['arguments'][x['name']])
                    y={k:rewrite(v)for k,v in x.items()}
                    if y.get('op')in('field','local'):y['name']=renames[(y['op'],y['name'])]
                    if 'field'in y:y['field']=renames[('field',y['field'])]
                    if 'local'in y:y['local']=renames[('local',y['local'])]
                    if 'collection'in y:y['collection']=renames[('collection',y['collection'])]
                    if 'asset'in y:y['asset']=renames[('asset',y['asset'])]
                    if 'provenance'in y:y['provenance']=f'dependency_{i}/'+str(y['provenance'])
                    return y
                out.append({'op':'scope','body':rewrite(dep['body']),'provenance':s['provenance'],'dependency':links[i]['id']})
            elif s['op']=='if':out.append(dict(s,then=expand(s['then']),**{'else':expand(s['else'])}))
            elif s['op']=='switch':out.append(dict(s,cases=[dict(c,body=expand(c['body']))for c in s['cases']],default=expand(s['default'])))
            else:out.append(s)
        return out
    l1['body']=expand(l1['body']);l1['dependencies']=links
    return l1,adapter
