"""Conservative all-path unsigned return intervals for small pure L1 callees.
No native samples or caller-specific parameter narrowing establish these facts.
Unsupported bodies/expressions retain their full type range or yield no proof.
"""
import hashlib
import json


class Unproven(ValueError):pass


def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()


def derive(body,max_states=64,max_work=1024):
    if not 1<=max_states<=64 or not 1<=max_work<=1024:return None
    if body.get('return_type')not in('u8','u16','u32')or any(body.get(k)for k in('state','collections','assets','retained_services')):return None
    from contract import validate
    try:validate(body)
    except ValueError:return None
    types={('parameter',p['name']):p['storage_type']for p in body['parameters']}
    types.update({('local',p['name']):p['storage_type']for p in body['locals']})
    work=0;returns=[]
    def mask(t):return(1<<int(t[1:]))-1
    def cast(interval,t):
        lo,hi=interval;m=mask(t)
        return(lo&m,hi&m)if lo//(m+1)==hi//(m+1)else(0,m)
    def tick():
        nonlocal work
        work+=1
        if work>max_work:raise Unproven('callee return range work budget')
    def value(e,env):
        tick();op=e['op'];t=e['type'];full=(0,mask(t));args=e.get('args',[])
        if op=='const':return(e['value']&full[1],)*2
        if op in('parameter','local'):
            key=(op,e['name'])
            if key not in env:raise Unproven('callee return uses uninitialized local')
            return env[key]
        if op in('zext','extract'):
            interval=value(args[0],env)
            if op=='extract':
                shift=value(args[1],env)
                if shift[0]!=shift[1]or shift[0]>0xffffffff:return full
                if shift[0]>=int(args[0]['type'][1:]):return(0,0)
                interval=tuple(n>>shift[0]for n in interval)
            return cast(interval,t)
        if op in('equal','not_equal','less_unsigned','less_equal_unsigned','less_signed','less_equal_signed','bool_and','bool_or','bool_not'):
            if op=='bool_not':
                a=value(args[0],env)
                return(1,1)if a[1]==0 else(0,0)if a[0]>0 else(0,1)
            a,b=[value(x,env)for x in args]
            if op=='less_unsigned':return(1,1)if a[1]<b[0]else(0,0)if a[0]>=b[1]else(0,1)
            if op=='less_equal_unsigned':return(1,1)if a[1]<=b[0]else(0,0)if a[0]>b[1]else(0,1)
            if op in('equal','not_equal'):
                interval=(0,0)if a[1]<b[0]or b[1]<a[0]else(1,1)if a[0]==a[1]==b[0]==b[1]else(0,1)
                return(1-interval[1],1-interval[0])if op=='not_equal'else interval
            return(0,1)
        if op in('add_wrap','sub_wrap','mul_wrap','bit_and'):
            a,b=[value(x,env)for x in args]
            if op=='add_wrap':return cast((a[0]+b[0],a[1]+b[1]),t)
            if op=='sub_wrap':return cast((a[0]-b[1],a[1]-b[0]),t)
            if op=='mul_wrap':return cast((a[0]*b[0],a[1]*b[1]),t)
            if a[0]==a[1]and b[0]==b[1]:return cast((a[0]&b[0],)*2,t)
            if a[0]==a[1]:return(0,min(a[0],b[1],full[1]))
            if b[0]==b[1]:return(0,min(b[0],a[1],full[1]))
        for argument in args:value(argument,env)
        return full
    def refined(condition,env,truth):
        op=condition['op'];args=condition.get('args',[]);result=dict(env)
        if op not in('less_unsigned','less_equal_unsigned','equal','not_equal')or len(args)!=2:return result
        left,right=args
        if left['type']!=right['type']:return result
        reversed=False
        if left['op']=='const':left,right=right,left;reversed=True
        if left['op']not in('parameter','local')or right['op']!='const':return result
        key=(left['op'],left['name']);lo,hi=result[key];constant=right['value']&mask(right['type'])
        if op=='not_equal':op='equal';truth=not truth
        if op=='equal':
            if truth:lo,hi=max(lo,constant),min(hi,constant)
            elif lo==constant:lo+=1
            elif hi==constant:hi-=1
        elif op=='less_unsigned':
            if reversed:
                if truth:lo=max(lo,constant+1)
                else:hi=min(hi,constant)
            elif truth:hi=min(hi,constant-1)
            else:lo=max(lo,constant)
        elif op=='less_equal_unsigned':
            if reversed:
                if truth:lo=max(lo,constant)
                else:hi=min(hi,constant-1)
            elif truth:hi=min(hi,constant)
            else:lo=max(lo,constant+1)
        if lo>hi:return None
        result[key]=(lo,hi);return result
    def execute(statements,states):
        for statement in statements:
            following=[]
            for env in states:
                tick();op=statement['op']
                if op=='assign_local':
                    key=('local',statement['local']);updated=dict(env);updated[key]=cast(value(statement['value'],env),types[key]);following.append(updated)
                elif op=='return':
                    if 'value'not in statement:raise Unproven('callee return value absent')
                    if statement['value']['type']!=body['return_type']:raise Unproven('callee return expression type mismatch')
                    returns.append(cast(value(statement['value'],env),body['return_type']))
                elif op=='if':
                    possible=value(statement['condition'],env)
                    for truth,branch in((True,'then'),(False,'else')):
                        if(truth and possible[1]==0)or(not truth and possible[0]>0):continue
                        narrowed=refined(statement['condition'],env,truth)
                        if narrowed is not None:following+=execute(statement[branch],[narrowed])
                else:raise Unproven('callee return range supports only pure structured locals/if/return')
            if len(following)>max_states:raise Unproven('callee return range path budget')
            states=following
        return states
    try:
        env={}
        for parameter in body['parameters']:
            interval=(0,mask(parameter['storage_type'])) # Never assume L1-only domains at a caller boundary.
            env[('parameter',parameter['name'])]=interval
        if execute(body['body'],[env])or not returns:raise Unproven('callee may finish without a return value')
    except (Unproven,KeyError):return None
    return {'kind':'all_path_pure_callee_return_interval','callee_model_sha256':digest(body),'return_type':body['return_type'],'unsigned_min':min(r[0]for r in returns),'unsigned_max':max(r[1]for r in returns),'return_paths':len(returns),'work':work,'basis':'Conservative unsigned intervals through every reachable structured return under full storage-width callee parameter ranges; no sampled native values'}


def result_interval(proof,adapter,output_type):
    if output_type not in('u8','u16','u32'):return None
    source=int(proof['return_type'][1:]);destination=int(output_type[1:]);lo,hi=proof['unsigned_min'],proof['unsigned_max']
    if destination>source:
        abi=adapter.get('return_abi',{})
        extension=abi.get('unsigned_extension')
        if not abi.get('evidence')or extension not in('u8','u16','u32')or int(extension[1:])<destination:return None
    if destination<source:
        span=1<<destination
        return(lo%span,hi%span)if lo//span==hi//span else(0,span-1)
    return lo,hi


def parameter_abi_matches(body,adapter):
    """Caller constructs low-lane extracts from adapter types; match those to L1."""
    parameters=body.get('parameters',[]);actual=adapter.get('parameters',[])
    return(len(parameters)==len(actual)and len({p['name']for p in parameters})==len(parameters)
           and all(p['name']==a.get('name')and p['storage_type']==a.get('type')
                   and a.get('register')in('r0','r1','r2','r3')for p,a in zip(parameters,actual)))
