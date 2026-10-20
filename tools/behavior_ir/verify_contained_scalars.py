"""Exact existing typed collection lane checks, no native execution."""
import copy,json,time
from types import SimpleNamespace
from pointer_regions import canonicalize_contained_scalars

def run():
    t=time.perf_counter();names=[]
    def fixture(offset=304,size=1):
        return SimpleNamespace(access={'op0':('state',('entity','r0'),offset,size)},collections={('ring',):{'name':'ring','owner':'entity','argument':'r0','address':None,'offset':304,'size':1,'count':64}},state_domain=lambda owner,start:{})
    for offset,size,base,count in((304,1,304,64),(367,1,304,64),(368,4,368,2),(372,4,368,2)):
        f=fixture(offset,size);f.collections[('ring',)].update(offset=base,size=size,count=count);before=copy.deepcopy(f.collections);p=canonicalize_contained_scalars(f)
        assert dict(f.collections[('ring',)],refs=[])==dict(before[('ring',)],refs=[]) and f.collections[('ring',)]['refs']==['op0'] and f.access['op0']==('collection',('ring',),{'op':'const','type':'u32','value':(offset-base)//size},size)and len(p)==1
        names.append('exact_lane_'+str(offset))
    def reject(name,change):
        f=fixture();change(f);before=copy.deepcopy(f.access)
        try:canonicalize_contained_scalars(f)
        except ValueError:assert f.access==before;names.append(name);return
        raise AssertionError(name)
    reject('cross_boundary',lambda f:f.access.update(op0=('state',('entity','r0'),367,2)))
    reject('unaligned',lambda f:(f.collections[('ring',)].update(size=4,count=16),f.access.update(op0=('state',('entity','r0'),305,4))))
    reject('mixed_width',lambda f:f.access.update(op0=('state',('entity','r0'),304,2)))
    reject('gapped_stride',lambda f:f.collections[('ring',)].update(stride=2))
    reject('domain_not_erased',lambda f:setattr(f,'state_domain',lambda *_:{'unsigned_min':0,'unsigned_max':1}))
    reject('imported_scalar_not_rebound',lambda f:f.access.update({'call/0':f.access.pop('op0')}))
    reject('ambiguous_collection',lambda f:f.collections.update({('other',):dict(f.collections[('ring',)],name='other')}))
    f=fixture();f.access['op0']=('state',('entity','r1'),304,1);old=copy.deepcopy(f.access);assert canonicalize_contained_scalars(f)==[] and f.access==old;names.append('different_owner_unchanged')
    f=fixture();f.access['op0']=('state',('entity','r0'),368,1);assert canonicalize_contained_scalars(f)==[];names.append('adjacent_not_joined')
    f=fixture();f.collections[('ring',)].update(owner='reference',reference='context');f.access['op0']=('state',('reference','context'),304,1);assert canonicalize_contained_scalars(f);names.append('reference_owner_exact_lane')
    f=fixture();f.access['op1']=('state',('entity','r0'),367,2);old=copy.deepcopy(f.access)
    try:canonicalize_contained_scalars(f)
    except ValueError:assert old==f.access;names.append('all_accesses_validated_before_mutation')
    else:raise AssertionError('partial mutation')
    return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-t,'native_calls':0}
if __name__=='__main__':print(json.dumps(run()))
