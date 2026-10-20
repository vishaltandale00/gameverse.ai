"""Pure ROM-only arena admission and exact disjoint image limits, no native run."""
import copy,json,time
from oracle_layout import select_layout,validate_image,DEFAULT_BASE,PURE_BASE,PURE_BYTES

def run():
    start=time.perf_counter();names=[]
    rom=bytes((i%256 for i in range(17000)))
    l1={'schema':'gameverse.l1.behavior/0.2','id':'test','parameters':[],'return_type':'u8','state':[],'collections':[],'locals':[],'assets':[{'name':'table','storage_type':'u8','data':list(rom),'provenance':['source']}],'body':[{'op':'return','value':{'op':'asset_read','type':'u8','asset':'table','index':{'op':'const','type':'u32','value':0},'provenance':'source'}}],'phase':{'name':'unknown','ordering':[],'confidence':0},'verification':{'status':'pending','receipt':None},'preconditions':[],'limitations':[]}
    adapter={'fields':[],'collections':[],'assets':[{'name':'table','address':0x08000000,'bytes':len(rom)}]}
    chosen=select_layout(l1,adapter,rom);assert chosen['base']==PURE_BASE;names.append('pure_exact_rom_span_upper_arena')
    assert validate_image(chosen,16569,PURE_BASE)['end']==PURE_BASE+16569;names.append('actual_getter_image_size_disjoint')
    for key in('fields','collections','object_references','entity_references','argument_views','native_abi','native_sequence','continuation_tokens','retained_services'):
        a=copy.deepcopy(adapter);a[key]=[{'opaque':True}];assert select_layout(l1,a,rom)['base']==DEFAULT_BASE;names.append('reject_'+key)
    a=copy.deepcopy(adapter);a['assets'][0]['address']+=1;assert select_layout(l1,a,rom)['base']==DEFAULT_BASE;names.append('wrong_source_span')
    a=copy.deepcopy(adapter);a['assets'][0]['bytes']-=1;assert select_layout(l1,a,rom)['base']==DEFAULT_BASE;names.append('wrong_asset_extent')
    b=copy.deepcopy(l1);b['assets'][0]['data'][0]^=1;assert select_layout(b,adapter,rom)['base']==DEFAULT_BASE;names.append('changed_rom_byte')
    b=copy.deepcopy(l1);b['state']=[{'name':'x','storage_type':'u8','provenance':[]}];assert select_layout(b,adapter,rom)['base']==DEFAULT_BASE;names.append('mutable_ir_rejected')
    b=copy.deepcopy(l1);b['retained_services']=[{}];assert select_layout(b,adapter,rom)['base']==DEFAULT_BASE;names.append('host_effect_rejected')
    b=copy.deepcopy(l1);b['assets'][0]['data']=[];assert select_layout(b,adapter,lambda:(_ for _ in()).throw(AssertionError('ROM read')) )['base']==DEFAULT_BASE;names.append('default_does_not_read_rom')
    for size,entry in((PURE_BYTES+1,PURE_BASE),(0,PURE_BASE),(17000,PURE_BASE-2),(17000,PURE_BASE+17000)):
        try:validate_image(chosen,size,entry)
        except ValueError:names.append('image_range_rejected_'+str(size)+'_'+str(entry))
        else:raise AssertionError('image escape')
    assert validate_image(chosen,PURE_BYTES,PURE_BASE)['end']==0x02040000;names.append('exact_upper_boundary')
    return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-start,'native_calls':0}
if __name__=='__main__':print(json.dumps(run()))
