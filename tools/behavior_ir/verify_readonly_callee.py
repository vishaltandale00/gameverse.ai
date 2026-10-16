"""Immutable exact scalar callee views; no native execution."""
import copy,json,time
from types import SimpleNamespace
from readonly_callee import bind_field

def run():
 t=time.perf_counter();names=[]
 body={'schema':'gameverse.l1.behavior/0.2','id':'test','parameters':[],'return_type':'u16','state':[{'name':'f','storage_type':'u16','semantic_type':{'quantity':'unknown','unit':'unknown','frame':'unknown','confidence':0,'evidence':[]}}],'locals':[],'assets':[],'collections':[],'body':[{'op':'return','value':{'op':'field','type':'u16','name':'f'}}],'preconditions':[],'limitations':[]}
 field={'name':'f','owner':'entity','argument':'r0','offset':2,'width':16};adapter={'fields':[field],'collections':[]};delta={'op':'const','type':'u32','value':0}
 def fixture():return SimpleNamespace(rom=bytes(range(32)),assets={})
 l=fixture();b=bind_field(l,body,adapter,field,0x08000000,delta,'call/op0/f');assert b['value']['type']=='u16'and b['pieces']==[]and next(iter(l.assets.values()))['start']==0x08000002;names.append('exact_source_u16_view')
 bind_field(l,body,adapter,field,0x08000000,delta,'call/op1/f');assert len(l.assets)==1 and len(next(iter(l.assets.values()))['refs'])==2;names.append('identical_view_storage_reused')
 def reject(name,change):
  b,a,f,d=copy.deepcopy((body,adapter,field,delta));l=fixture();base=0x08000000
  result=change(b,a,f,d)
  if result is not None:base=result
  try:bind_field(l,b,a,f,base,d,'call/op0/f')
  except ValueError:assert l.assets=={};names.append(name);return
  raise AssertionError(name)
 reject('rom_write',lambda b,a,f,d:b['body'].insert(0,{'op':'assign_field','field':'f','value':{'op':'const','type':'u16','value':0}}))
 reject('rom_collection',lambda b,a,f,d:a['collections'].append({'owner':'entity','argument':'r0'}))
 reject('dynamic_offset',lambda b,a,f,d:d.update(op='parameter',name='x'))
 reject('width_mismatch',lambda b,a,f,d:f.update(width=32))
 reject('outside_rom',lambda b,a,f,d:f.update(offset=32))
 reject('ram_not_rom',lambda b,a,f,d:0x02000000)
 reject('negative_offset',lambda b,a,f,d:f.update(offset=-1))
 reject('domain_violation',lambda b,a,f,d:f.update(domain={'unsigned_min':0,'unsigned_max':1}))
 reject('l1_adapter_domain_mismatch',lambda b,a,f,d:b['state'][0].update(domain={'unsigned_min':0,'unsigned_max':1}))
 reject('ambiguous_declaration',lambda b,a,f,d:b['state'].append(copy.deepcopy(b['state'][0])))
 reject('reference_effect',lambda b,a,f,d:a.update(object_references=[{}]))
 reject('native_effect',lambda b,a,f,d:a.update(retained_services=[{}]))
 return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-t,'native_calls':0}
if __name__=='__main__':print(json.dumps(run()))
