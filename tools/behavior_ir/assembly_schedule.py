"""Bounded authored invocation guards and explicit schedule obligations.

This proves declared dataflow obligations, not that a game's declared policy is
complete. A guard cannot authorize arbitrary code or a callback address.
"""
import copy
import hashlib
import re
from pathlib import Path

IDENT=re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}$')
META={'id','phase','when','requires'}


def require(test,message):
    if not test:raise ValueError('assembly schedule: '+message)


def condition(value,state):
    """Return scalar slots read by a well-typed, at most 64-node predicate."""
    budget=[64];reads=set()
    def walk(e,depth=0):
        budget[0]-=1
        require(budget[0]>=0 and depth<=12,'condition exceeds 64 nodes or depth 12')
        require(isinstance(e,dict),'condition expression must be an object')
        op=e.get('op');t=e.get('type')
        require(t in ('u8','u16','u32','u64'),'condition needs an integer storage type')
        if op=='slot':
            require(set(e)=={'op','type','name'} and e['name'] in state,'unknown or unsupported condition slot')
            slot=state[e['name']]
            require('count' not in slot and slot['storage_type']==t,'condition slot must be scalar with exact storage type')
            reads.add(e['name']);return t,False,slot['semantic_type']
        if op=='const':
            require(set(e)=={'op','type','value'} and type(e['value']) is int and 0<=e['value']<1<<int(t[1:]),'condition constant outside typed range')
            return t,False,None
        require(set(e)=={'op','type','args'} and isinstance(e['args'],list),'unsupported condition expression')
        boolean=op in ('bool_and','bool_or','bool_not')
        compare=op in ('equal','not_equal','less_unsigned','less_equal_unsigned','less_signed','less_equal_signed')
        bitwise=op in ('bit_and','bit_or','bit_xor')
        require(boolean or compare or bitwise,'unsupported condition operator: '+str(op))
        require(len(e['args'])==(1 if op=='bool_not' else 2),'condition operator arity mismatch')
        args=[walk(a,depth+1) for a in e['args']]
        if boolean:
            require(t=='u8' and all(a[1] for a in args),'boolean operators require predicate operands and u8 result')
        else:
            require(not any(a[1] for a in args) and args[0][0]==args[1][0],'condition operands require matching integer types')
            meanings=[{k:a[2].get(k) for k in ('quantity','unit','frame','signed_encoding')} for a in args if a[2] is not None]
            require(not meanings or all(m==meanings[0] for m in meanings),'condition operands have incompatible semantic types')
            require(t==('u8' if compare else args[0][0]),'condition result type mismatch')
            if op in ('less_signed','less_equal_signed'):
                require(meanings and all(m.get('signed_encoding')=='twos_complement' for m in meanings),'signed comparison requires explicit twos_complement slots')
        return t,boolean or compare,next((a[2] for a in args if a[2] is not None),None) if bitwise else None
    require(walk(value)[1],'when must be a boolean predicate, not an integer truthiness test')
    return reads


def access(call,components,interfaces,adapters):
    if 'adapter' in call:
        spec=adapters[call['adapter']];return {spec['source_slot']},{spec['target_slot']}
    name=call['component'];config=components[name];effects=interfaces[name]['effects'];reads=set();writes=set()
    for field,binding in config.get('bindings',{}).items():
        if field in effects['reads']:reads.add(binding['slot'])
        if field in effects['writes']:writes.add(binding['slot'])
    for field,slot in config.get('collection_bindings',{}).items():
        if field in effects.get('collection_reads',[]):reads.add(slot)
        if field in effects.get('collection_writes',[]):writes.add(slot)
    if 'result' in call:writes.add(call['result']['slot'])
    return reads,writes


def materialize(graph,components,interfaces,adapters,users,writers):
    """Validate all paths conservatively, then wrap actual calls in Composer ifs.

    Writes are may-writes (source stores may be conditional). Fresh means the
    canonical slot was synchronized by that invocation, not that its value changed.
    Conditional producers cannot establish a required value on all paths.
    """
    state=graph['state'];calls=graph['invocations'];schedule=graph.get('schedule')
    phases=[]
    if 'schedule' in graph:
        require(isinstance(schedule,dict) and set(schedule)=={'phases'},'schedule supports only phases')
        phases=schedule['phases']
        require(isinstance(phases,list) and 1<=len(phases)<=32 and all(isinstance(p,str) and IDENT.fullmatch(p) for p in phases) and len(set(phases))==len(phases),'phases must be 1..32 distinct identifiers')
    seen={};latest={};versions={name:0 for name in state};phase_index=-1;out=[];proof=[];mapped={}
    targets={spec['target_slot']:name for name,spec in adapters.items()}
    for index,call in enumerate(calls):
        identity=call.get('id')
        if 'id' in call:
            require(isinstance(identity,str) and IDENT.fullmatch(identity) and identity not in seen,'invocation id must be a distinct identifier')
        if phases:
            require(call.get('phase') in phases,'every scheduled call needs a declared phase')
            current=phases.index(call['phase']);require(current>=phase_index,'phase order regressed at invocation '+str(index));phase_index=current
        else:require('phase' not in call,'phase requires schedule.phases')
        reads,writes=access(call,components,interfaces,adapters)
        if 'adapter' in call:
            source=adapters[call['adapter']]['source_slot']
            require(source in latest and latest[source] is not None,'adapter source producer may be skipped: '+source)
            mapped[call['adapter']]=(versions[source], 'when' in call)
        else:
            for slot in reads & set(targets):
                adapter=targets[slot];source=adapters[adapter]['source_slot']
                require(adapter in mapped and not mapped[adapter][1] and mapped[adapter][0]==versions[source],'adapter producer may be skipped or stale: '+adapter)
        guard_reads=condition(call['when'],state) if 'when' in call else set()
        node=call.get('component',call.get('adapter'))
        for slot in guard_reads:users[slot].add(node)
        obligations=call.get('requires',[])
        require(isinstance(obligations,list) and len(obligations)<=128,'requires must be a bounded list')
        required=set()
        for obligation in obligations:
            require(isinstance(obligation,dict) and {'slot','producer'}<=set(obligation) and not(set(obligation)-{'slot','producer','after_writes'}),'unsupported freshness requirement')
            slot=obligation['slot'];producer=obligation['producer'];deps=obligation.get('after_writes',[])
            require(isinstance(slot,str) and slot in state and slot in reads|guard_reads,'required slot must be read by call or guard')
            require(slot not in required,'duplicate freshness requirement');required.add(slot)
            require(isinstance(producer,str) and producer in seen,'required producer must precede consumer: '+str(producer))
            produced=seen[producer]
            require(slot in produced['writes'],'required producer does not write slot: '+slot)
            require(not produced['conditional'],'required producer may be skipped: '+producer)
            require(latest.get(slot)==producer,'required producer is stale or overwritten: '+slot)
            require(isinstance(deps,list) and len(deps)<=128 and all(isinstance(d,str) and d in state for d in deps) and len(set(deps))==len(deps),'after_writes must name distinct state slots')
            for dependency in deps:
                require(dependency in produced['reads'],'freshness dependency is not read by producer: '+dependency)
                require(dependency not in produced['writes'],'producer also writes dependency; output chronology is ambiguous: '+dependency)
                require(produced['versions'][dependency]==versions[dependency],'dependency changed after producer: '+dependency)
            proof.append({'consumer_index':index,**copy.deepcopy(obligation)})
        for slot in guard_reads:
            if state[slot]['owner']!='external' and writers[slot]:
                require(slot in required,'condition on produced state needs explicit freshness requirement: '+slot)
            else:
                require(state[slot]['owner']=='external' or slot in graph.get('initialize',{}) or slot in latest,'condition reads state with no explicit initialization or producer: '+slot)
        statement={k:copy.deepcopy(v) for k,v in call.items() if k not in META}
        if 'adapter' in statement:statement=dict(op='map_u16_bits',**adapters[statement['adapter']])
        else:statement=dict(op='invoke',**statement)
        if 'when' in call:statement={'op':'if','condition':copy.deepcopy(call['when']),'then':[statement],'else':[]}
        out.append(statement)
        for slot in writes:
            versions[slot]+=1;latest[slot]=(identity or ('@'+str(index))) if 'when' not in call else None
        if identity is not None:seen[identity]={'reads':reads,'writes':writes,'conditional':'when' in call,'versions':dict(versions)}
    return out,{'validator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'phases':phases,'freshness_requirements':proof,'conditional_invocations':sum('when' in c for c in calls),'scope':'Explicit authored phase order and declared producer freshness only; source lifecycle completeness, callback validity and runtime domain closure remain unproven.'}
