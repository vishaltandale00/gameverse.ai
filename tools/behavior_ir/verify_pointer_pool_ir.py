"""Focused finite pointer codec/lowering regression checks; no native calls."""
import argparse,copy,hashlib,json,platform,time
from pathlib import Path
from pointer_pool_ir import encode_pointer,decode_handle,checked_contract,validate_list_domain,PointerPoolLifter
from contract import validate
from lower import lower

def verify(l0_dir=None,rom=None,out=None):
    start=time.perf_counter();checks=[]
    c={'id':'example_arena','capacity':4,'node_argument':'r0','head_cells':[0x02016280],'link_lanes':[{'offset':20,'width':4},{'offset':24,'width':4}],'native_base':0x02010000,'record_stride':64,'evidence':['explicit test source contract'],'list_domain':{'head_cell':0x02016280,'older_offset':20,'newer_offset':24,'node_membership':'present'}}
    codec={'base':c['native_base'],'stride':c['record_stride'],'capacity':c['capacity']}
    def rejected(name,fn):
        try:fn()
        except (ValueError,KeyError):checks.append(name);return
        raise AssertionError('expected rejection: '+name)
    for handle in range(5):assert encode_pointer(decode_handle(handle,**codec),**codec)==handle
    checks.append('codec_all_nullable_identities_roundtrip')
    for bad in [-1,5,0x02010000,True,1.5]:rejected('invalid_handle_'+str(bad),lambda bad=bad:decode_handle(bad,**codec))
    for bad in [0x0200ffff,0x02010001,0x02010100,0x02010020,True]:rejected('invalid_pointer_'+str(bad),lambda bad=bad:encode_pointer(bad,**codec))
    rejected('null_node_encode',lambda:encode_pointer(0,nullable=False,**codec));rejected('null_node_decode',lambda:decode_handle(0,nullable=False,**codec))
    rejected('zero_stride',lambda:encode_pointer(c['native_base'],base=c['native_base'],stride=0,capacity=4))
    valid={20:[2,0,4,3],24:[0,1,4,3]}
    assert validate_list_domain(1,valid,2,c);checks.append('valid_live_list_and_stale_unlinked_cycle')
    rejected('nonmember_unlink',lambda:validate_list_domain(1,valid,3,c))
    absent=copy.deepcopy(c);absent['list_domain']['node_membership']='absent';assert validate_list_domain(1,valid,3,absent);checks.append('absent_insert_with_stale_lanes')
    rejected('duplicate_insert',lambda:validate_list_domain(1,valid,2,absent))
    rejected('live_cycle',lambda:validate_list_domain(1,{20:[2,1,0,0],24:[2,1,0,0]},1,c))
    rejected('broken_reciprocal',lambda:validate_list_domain(1,{20:[2,0,0,0],24:[0,0,0,0]},1,c))
    rejected('unknown_lane_handle',lambda:validate_list_domain(1,{20:[9,0,0,0],24:[0,1,0,0]},1,c))
    rejected('missing_lane',lambda:validate_list_domain(1,{20:[0]*4},1,c))
    for label,mutate in [('head_alias_arena',lambda x:x.update(head_cells=[0x02010000])),('overlap_lanes',lambda x:x['link_lanes'].append({'offset':20,'width':4})),('mixed_width_lane',lambda x:x['link_lanes'][0].update(width=2)),('oversized_domain',lambda x:x.update(capacity=65)),('missing_evidence',lambda x:x.update(evidence=[]))]:
        bad=copy.deepcopy(c);mutate(bad);rejected(label,lambda bad=bad:checked_contract(bad))
    lifted=[]
    if l0_dir:
        raw=rom.read_bytes()
        for entry,member in [('0800d838','absent'),('0800d85c','present')]:
            source=l0_dir/(entry+'.json');l0=json.loads(source.read_text());config=copy.deepcopy(c);config['list_domain']['node_membership']=member
            x,a=PointerPoolLifter(l0,raw,pointer_pool_contract=config).build();assert validate(x);assert lower(x)
            assert len(x['collections'])==2 and len(x['state'])==1 and a['parameters'][0]['derived_pointer_handle']
            assert all(z['storage_type']=='u32'and z['count']==4 for z in x['collections'])
            lifted.append({'entry':entry,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'behavior_canonical_sha256':hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()})
            checks.append(entry+'_automatic_cfg_lowering')
            if member=='present':
                bad=copy.deepcopy(l0);bad['blocks'][0]['ops'][3]['opcode']='INT_NOTEQUAL'
                rejected('null_guard_inversion',lambda:PointerPoolLifter(bad,raw,pointer_pool_contract=config).build())
                absent_config=copy.deepcopy(config);absent_config['list_domain']['node_membership']='absent'
                rejected('stale_absent_node_cannot_prove_neighbor_distinct',lambda:PointerPoolLifter(l0,raw,pointer_pool_contract=absent_config).build())
                clobber=copy.deepcopy(l0);clobber['blocks'][6]['ops'][4]['inputs'][1]='v37'
                rejected('current_lane_clobber_invalidates_reload_proof',lambda:PointerPoolLifter(clobber,raw,pointer_pool_contract=config).build())
                foreign=copy.deepcopy(l0)
                literal=next(v for v in foreign['varnodes']if v['id']=='v21');literal.update(space='const',constant=True,offset=str(0x02016284))
                rejected('undeclared_global_storage',lambda:PointerPoolLifter(foreign,raw,pointer_pool_contract=config).build())
            pointer=next(v['id']for v in l0['varnodes']if v.get('input')and v.get('register')=='r0')
            for opcode,width,inputs in [('INT_SUB',4,[pointer,pointer]),('INT_LESS',1,[pointer,pointer]),('SUBPIECE',1,[pointer,'v7'if member=='present'else'v5']),('INT_ZEXT',8,[pointer])]:
                escaped=copy.deepcopy(l0);escaped['varnodes'].append({'id':'pointer_escape','space':'unique','offset':'900001','size':width,'constant':False,'input':False,'register':None});escaped['blocks'][0]['ops'].insert(0,{'id':'escape_op','opcode':opcode,'pc':entry,'output':'pointer_escape','inputs':inputs})
                rejected(entry+'_'+opcode+'_pointer_escape',lambda escaped=escaped:PointerPoolLifter(escaped,raw,pointer_pool_contract=config).build())
            for opcode,width,inputs in [('INT_EQUAL',1,[pointer,'native_constant']),('CAST',1,[pointer]),('MULTIEQUAL',4,[pointer,pointer])]:
                escaped=copy.deepcopy(l0);escaped['varnodes'].append({'id':'native_constant','space':'const','offset':str(c['native_base']),'size':4,'constant':True,'input':False,'register':None});escaped['varnodes'].append({'id':'pointer_escape','space':'unique','offset':'900001','size':width,'constant':False,'input':False,'register':None});escaped['blocks'][0]['ops'].insert(0,{'id':'escape_op','opcode':opcode,'pc':entry,'output':'pointer_escape','inputs':inputs})
                singleton=copy.deepcopy(config);singleton['capacity']=1
                rejected(entry+'_'+opcode+'_pre_specialization_escape',lambda escaped=escaped:PointerPoolLifter(escaped,raw,pointer_pool_contract=singleton).build())


    result={'schema':'gameverse.pointer-pool-verification/0.1','outcome':'pass','machine':platform.platform(),'checks':checks,'check_count':len(checks),'lifted':lifted,'native_calls':0,'module_sha256':hashlib.sha256((Path(__file__).parent/'pointer_pool_ir.py').read_bytes()).hexdigest(),'verifier_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'wall_s':time.perf_counter()-start}
    if out:out.write_text(json.dumps(result,indent=2)+'\n')
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--l0-dir',type=Path);p.add_argument('--rom',type=Path);p.add_argument('--out',type=Path);a=p.parse_args();print(json.dumps(verify(a.l0_dir,a.rom,a.out),indent=2))
