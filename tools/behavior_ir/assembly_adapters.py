"""Contract and scheduling checks for explicit authored assembly nodes."""
from bit_mapping import validate_mapping
from domain import accepts


def prepare(adapters,state,components,interfaces,users,writers):
    def require(test,message):
        if not test:raise ValueError('authored adapter: '+message)
    result={};edges={};targets=set()
    contracts={name:validate_mapping(spec,state) for name,spec in adapters.items()}
    for spec in adapters.values():edges.setdefault(spec['source_slot'],set()).add(spec['target_slot'])
    visiting=set();visited=set()
    def visit(slot):
        require(slot not in visiting,'adapter dependency cycle')
        if slot in visited:return
        visiting.add(slot)
        for following in edges.get(slot,set()):visit(following)
        visiting.remove(slot);visited.add(slot)
    for slot in edges:visit(slot)
    for name,spec in adapters.items():
        contract=contracts[name];source=spec['source_slot'];target=spec['target_slot']
        require(target not in targets,'multiple adapters cannot write one target slot');targets.add(target)
        require(state[target]['owner']==name,'target state must be owned by its adapter: '+target)
        require(not writers[target],'target slot already has a component writer: '+target)
        producers=[];consumers=[]
        for node,config in components.items():
            interface=interfaces[node]
            for field,binding in config.get('bindings',{}).items():
                if binding['slot']==source and field in interface['effects']['writes']:
                    producers.append({'component':node,'field':field,'package_id':interface['package_id'],'behavior_sha256':interface['behavior_sha256'],'package_sha256':interface['package_sha256']})
                if binding['slot']==target and field in interface['effects']['reads']:
                    consumers.append({'component':node,'field':field,'package_id':interface['package_id'],'behavior_sha256':interface['behavior_sha256'],'package_sha256':interface['package_sha256']})
                    definition=next(v for v in interface['fields'] if v['name']==field)
                    domain=definition.get('domain',{})
                    mask=contract['target_domain']['allowed_bits']
                    # All possible output words lie between these signed/unsigned
                    # extrema. Reject any known incompatible target precondition.
                    extrema={0,mask,mask&32767,mask&32768}
                    require(all(accepts(domain,value,16) for value in extrema),'mapped output violates qualified target field domain: '+node+'.'+field)
        require(producers,'source slot needs a bound qualified component writer: '+source)
        require(consumers,'target slot needs a bound qualified component reader: '+target)
        users[source].add(name);users[target].add(name);writers[target].add(name)
        edges.setdefault(source,set()).add(target)
        result[name]={**contract,'source_slot':source,'target_slot':target,'producers':producers,'consumers':consumers,'mapping':spec['mapping'],'unmapped_target_bits':'clear'}
    return result


def check_order(calls,adapters,components,interfaces):
    def require(test,message):
        if not test:raise ValueError('authored adapter order: '+message)
    produced={};mapped={};seen=set();consumed=set()
    target_adapter={spec['target_slot']:name for name,spec in adapters.items()}
    for call in calls:
        if 'adapter' in call:
            name=call['adapter'];spec=adapters[name];source=spec['source_slot']
            require(source in produced,'qualified source producer must run before '+name)
            mapped[name]=produced[source];seen.add(name)
        else:
            node=call['component'];interface=interfaces[node]
            for field,binding in components[node].get('bindings',{}).items():
                slot=binding['slot']
                if field in interface['effects']['reads'] and slot in target_adapter:
                    adapter=target_adapter[slot];source=adapters[adapter]['source_slot']
                    require(adapter in mapped and mapped[adapter]==produced.get(source),'consumer needs a fresh preceding adapter invocation: '+node+'.'+field)
                    consumed.add(adapter)
            for field,binding in components[node].get('bindings',{}).items():
                if field in interface['effects']['writes']:
                    slot=binding['slot'];produced[slot]=produced.get(slot,0)+1
    require(seen==set(adapters),'every authored adapter needs an explicit ordered invocation')
    require(consumed==set(adapters),'every authored adapter output needs a later qualified consumer invocation')
