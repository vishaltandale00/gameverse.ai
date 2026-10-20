"""Exact ROM-window mapping and fail-closed checks; no emulator campaign."""
import copy
import json
import time
from readonly_assets import canonicalize


def fixture():
    rom=bytes((i*37)&255 for i in range(256));assets=[];metadata=[];reads=[];views={}
    # Reversed source order proves the retained canonical name can need rebasing.
    for name,start,size,width in [('upper',36,8,2),('lower',32,8,4),('adjacent',44,4,1),('separate',80,8,1)]:
        assets.append({'name':name,'storage_type':'u8','data':list(rom[start:start+size]),'provenance':[name]})
        metadata.append({'name':name,'address':0x08000000+start,'bytes':size})
        index={'op':'const','type':'u32','value':2}
        reads.append({'op':'asset_read','asset':name,'index':index,'type':'u'+str(width*8),'provenance':name})
        views[name]={'asset':name,'index':copy.deepcopy(index),'minimum':2,'maximum':2,'width':width}
    return {'assets':assets,'body':reads},{'assets':metadata,'assumptions':[]},rom,views


def index(e):return e['value']if e['op']=='const'else sum(index(x)for x in e['args'])
def evaluate(read,assets):
    start=index(read['index']);size=int(read['type'][1:])//8
    return sum(assets[read['asset']]['data'][start+i]<<(8*i)for i in range(size))


def run():
    started=time.perf_counter();original,adapter,rom,views=fixture();old=copy.deepcopy(original);saved=copy.deepcopy(adapter)
    result,output=canonicalize(original,adapter,rom,views);checks=[]
    assert original==old and adapter==saved;checks.append('inputs_immutable')
    assert [a['name']for a in result['assets']]==['upper','adjacent','separate'];checks.append('overlap_only_stable_name')
    assert len(result['assets'][0]['data'])==12;checks.append('one_exact_union')
    before={a['name']:a for a in original['assets']};after={a['name']:a for a in result['assets']}
    assert [evaluate(e,before)for e in original['body']]==[evaluate(e,after)for e in result['body']];checks.append('widths_and_reads_preserved')
    assert result['body'][0]['index']['args'][1]['value']==4 and result['body'][1]['asset']=='upper';checks.append('both_directions_rebased')
    assert [v['name']for v in output['immutable_asset_windows'][0]['views']]==['upper','lower'];checks.append('original_alias_lineage_retained')
    # Every byte in each old window resolves to the same canonical physical byte.
    for view in output['immutable_asset_windows'][0]['views']:
        for i,byte in enumerate(before[view['name']]['data']):assert after['upper']['data'][view['offset']+i]==byte
    checks.append('all_alias_bytes_exact')
    def rejects(name,mutate,limit=65536):
        x,a,r,v=fixture();mutate(x,a,v)
        try:canonicalize(x,a,r,v,limit)
        except ValueError:checks.append(name)
        else:raise AssertionError('unsafe ROM join accepted: '+name)
    rejects('ram_storage',lambda x,a,v:a['assets'][0].update(address=0x02000024))
    rejects('mutable_storage',lambda x,a,v:a['assets'][0].update(mutable=True))
    rejects('inexact_rom_bytes',lambda x,a,v:x['assets'][0]['data'].__setitem__(0,255))
    rejects('metadata_span',lambda x,a,v:a['assets'][0].update(bytes=7))
    rejects('missing_access_proof',lambda x,a,v:v.pop('upper'))
    rejects('wrong_read_width',lambda x,a,v:v['upper'].update(width=4))
    rejects('wrong_index_expression',lambda x,a,v:v['upper']['index'].update(value=3))
    rejects('width_straddles_old_window',lambda x,a,v:v['upper'].update(maximum=7))
    rejects('negative_old_index',lambda x,a,v:v['upper'].update(minimum=-1))
    rejects('wrapping_old_index',lambda x,a,v:v['upper'].update(maximum=0xffffffff))
    rejects('constant_proof_contradiction',lambda x,a,v:v['upper'].update(minimum=3,maximum=3))
    rejects('union_budget',lambda x,a,v:None,11)
    rejects('budget_raise',lambda x,a,v:None,65537)
    # Address-free ordinal/row assets are never folded into a physical ROM owner.
    x,a,r,v=fixture();a['assets'][0]['address']=None
    unchanged,_=canonicalize(x,a,r,v);assert unchanged==x;checks.append('derived_asset_not_joined')
    # Preserve a strided source index verbatim inside the added byte bias.
    x,a,r,v=fixture();stride={'op':'mul_wrap','type':'u32','args':[{'op':'local','type':'u32','name':'i'},{'op':'const','type':'u32','value':2}]}
    x['body'][0]['index']=copy.deepcopy(stride);v['upper'].update(index=copy.deepcopy(stride),minimum=0,maximum=6)
    changed,_=canonicalize(x,a,r,v);assert changed['body'][0]['index']['args'][0]==stride;checks.append('strided_index_preserved')
    print(json.dumps({'outcome':'pass','checks':len(checks),'names':checks,'wall_s':time.perf_counter()-started,'native_calls':0}))


if __name__=='__main__':run()
