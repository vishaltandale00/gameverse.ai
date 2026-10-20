"""Subsecond positive/negative checks for canonical byte regions and exact bias."""
from types import SimpleNamespace
import json
import time
from pointer_regions import canonicalize_byte_collections,rebase_constant_bias,fixed_ram_phi_offsets


def c(n):return {'op':'const','type':'u32','value':n}
def fake(domain=False,mirror=False):
    return SimpleNamespace(collections={'a':{'name':'a','address':0x0201331c,'size':1,'count':56,'refs':[]},'b':{'name':'b','address':0x02013338,'size':1,'count':28,'refs':[]}},access={'read':('collection','b',c(3),1),**({'mirror':('state',('global',0),0x02053320,1)}if mirror else{}),**({'scalar':('state',('global',0),0x0201331d,1)}if domain else{})},argument_contract={},state_domain=lambda owner,start:{'unsigned_min':0,'unsigned_max':1}if domain else{})


def run():
    start=time.perf_counter();f=fake();proof=canonicalize_byte_collections(f);assert len(f.collections)==1 and proof[0]['bytes']==56
    assert f.access['read'][2]['args'][1]['value']==28
    for kw in ({'domain':True},{'mirror':True}):
        try:canonicalize_byte_collections(fake(**kw))
        except ValueError:pass
        else:raise AssertionError('unsupported view silently canonicalized')
    for address in (0x0201331b,0x02013353):
        f=fake();f.argument_contract={'experimental_mixed_width_regions':True};f.access['straddle']=('state',('global',0),address,2)
        try:canonicalize_byte_collections(f)
        except ValueError:pass
        else:raise AssertionError('straddling scalar accepted')
    variable={'op':'local','type':'u32','name':'value_1'}
    p=rebase_constant_bias(('asset',0x0812b24d,{'op':'sub_wrap','type':'u32','args':[variable,c(8)]}));assert p==('asset',0x0812b245,variable)
    narrow={'op':'sub_wrap','type':'u8','args':[dict(variable,type='u8'),dict(c(8),type='u8')]}
    assert rebase_constant_bias(('asset',0x0812b24d,{'op':'add_wrap','type':'u32','args':[c(0),narrow]}))==('asset',0x0812b24d,{'op':'add_wrap','type':'u32','args':[c(0),narrow]})
    for value in [0,1,7,8,9,255,0xffffffff]:assert (0x0812b24d+((value-8)&0xffffffff))&0xffffffff==(p[1]+value)&0xffffffff
    region=fixed_ram_phi_offsets([('global',0x03002c28,c(0)),('global',0x03002e28,variable)],bounds=lambda _: (0,2040));assert region[0]==0x03002c28 and region[1][1]['args'][1]['value']==512
    assert fixed_ram_phi_offsets([('global',0x03002c28,c(0)),('global',0x0300ac28,c(0))])is None
    assert fixed_ram_phi_offsets([('global',0x03002c28,variable)],bounds=lambda _: (0,0xffffffff))is None
    assert fixed_ram_phi_offsets([('global',0x03007ffe,variable)],bounds=lambda _: (0,4))is None
    print(json.dumps({'outcome':'pass','checks':['one canonical backing','callee offset retained','domain reject','mirror reject','exact modular bias including negative index','bounded dynamic OAM alternatives','unbounded/cross-window reject'],'wall_s':time.perf_counter()-start}))


if __name__=='__main__':run()
