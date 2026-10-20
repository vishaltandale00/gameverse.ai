"""Finite immutable pointer alternatives; subsecond, no emulator campaign."""
import json
import time
from pointer_regions import fixed_rom_phi_offsets
from lift import Lifter, Unsupported
from types import SimpleNamespace


def run():
    started=time.perf_counter();checks=0
    c=lambda n:{'op':'const','type':'u32','value':n}
    p=lambda base,n=0:('asset',base,c(n))
    region=fixed_rom_phi_offsets([p(0x08000200),p(0x08000100,6)],4096)
    assert region[0]==0x08000100;checks+=1
    for source,offset in zip([0x08000200,0x08000106],region[1]):
        value=offset['value']if offset['op']=='const'else sum(x['value']for x in offset['args'])
        assert region[0]+value==source;checks+=1
    dynamic={'op':'local','type':'u32','name':'index'}
    assert fixed_rom_phi_offsets([('asset',0x08000100,dynamic),p(0x08000200)],4096,bounds=lambda e:(0,30));checks+=1
    for alternatives,size,bound in [
        ([],4096,None),
        ([p(0x08000100),('global',0x02000000,c(0))],4096,None),
        ([p(0x08000000),p(0x08010001)],0x20000,None),
        ([p(0x08001000)],4096,None),
        ([p(0x08000000,-1)],4096,None),
        ([('asset',0x08000100,dynamic)],4096,lambda e:(0,0xffffffff)),
        ([('asset',0x08000100,dynamic)],4096,lambda e:(-1,2)),
        ([('asset',0x08000100,dict(c(0),type='u16'))],4096,None),
    ]:
        assert fixed_rom_phi_offsets(alternatives,size,bounds=bound)is None;checks+=1
    # Both discovery orders reject a numeric use of a selected native address.
    fake=SimpleNamespace(pointer_phis={'v3':[c(0),c(256)]})
    try:Lifter.expr(fake,'v3')
    except Unsupported:checks+=1
    else:raise AssertionError('pointer-first scalar escape accepted')
    def unknown(v):raise Unsupported('not constant')
    fake=SimpleNamespace(v={'v3':{'input':False}},defs={'v3':{'opcode':'MULTIEQUAL','inputs':['a','b'],'id':'phi'}},literal=unknown,ptr=lambda v:p(0x08000100 if v=='a'else 0x08000200),rom=bytes(4096),bounds=lambda e:(0,0),phis={'v3':{}},pointer_phis={})
    try:Lifter._ptr(fake,'v3')
    except Unsupported:checks+=1
    else:raise AssertionError('scalar-first pointer escape accepted')
    # Decompiler PTRSUB(0, numeric constant) is an integer literal, while
    # address-range constants must still never become portable scalar values.
    for value in (1024,0x02000000,0x08000100):
        fake=SimpleNamespace(pointer_phis={},expression_nodes=0,v={
            'a':{'constant':True,'offset':'0'},'b':{'constant':True,'offset':str(value)},
            'v3':{'constant':False,'space':'unique','size':4}},
            defs={'v3':{'id':'literal','opcode':'PTRSUB','inputs':['a','b']}},literal=lambda v:value)
        try:result=Lifter.expr(fake,'v3')
        except Unsupported:assert value>=0x02000000
        else:assert value==1024 and result==c(1024)
        checks+=1
    fake.defs['v3']['inputs'].append('b')
    try:Lifter.expr(fake,'v3')
    except Unsupported:checks+=1
    else:raise AssertionError('malformed scaled PTRSUB accepted')
    print(json.dumps({'outcome':'pass','checks':checks,'wall_s':time.perf_counter()-started}))


if __name__=='__main__':run()
