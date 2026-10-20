"""Narrow immutable-resource literal STORE checks; synthetic, no native calls."""
import copy,hashlib,json,time
from types import SimpleNamespace
from resource_reference import validate_contract,bind

def run():
 start=time.perf_counter();names=[];rom=bytearray(64);rom[:4]=bytes.fromhex('01480860');rom[8:12]=(0x08000020).to_bytes(4,'little');rom[32:36]=b'OAM!';source=b'reviewed synthetic stored immutable resource';sha=hashlib.sha256(source).hexdigest();ev={sha:source}
 c={'id':'oam','token':1,'native_value':0x08000020,'rom_sha256':hashlib.sha256(rom).hexdigest(),'span_size':4,'span_sha256':hashlib.sha256(rom[32:36]).hexdigest(),'literal_load_pc':0x08000000,'store_pc':0x08000002,'literal_address':0x08000008,'entry':0x08000000,'destination':0x03000000,'source_evidence':[{'role':'stored_resource','sha256':sha}]}
 store={'id':'s','opcode':'STORE','pc':'08000002','inputs':['space','pointer','value']};owner=('global',0);field={'name':'oam_field','size':4}
 f=SimpleNamespace(rom=rom,l0={'entry':'08000000'},blocks={0:{'ops':[store]}},access={'s':('state',owner,0x03000000,4)},v={'value':{'space':'ram','size':4,'offset':str(0x08000008)}},fields={(owner,0x03000000):field})
 stores,bound=bind(f,[c],ev);assert stores['s']['field']=='oam_field'and bound[0]['native_value']==0x08000020;names.append('exact_original_literal_word_store')
 def reject(name,fn):
  try:fn()
  except(ValueError,KeyError,TypeError):names.append(name);return
  raise AssertionError(name)
 for name,mut in [('wrong_rom',lambda b:b.update(rom_sha256='0'*64)),('wrong_asset_bytes',lambda b:b.update(span_sha256='0'*64)),('outside_asset',lambda b:b.update(span_size=64)),('zero_reserved_token',lambda b:b.update(token=0)),('bool_token',lambda b:b.update(token=True)),('unaligned_destination',lambda b:b.update(destination=0x03000001)),('wrong_literal_identity',lambda b:b.update(native_value=0x08000024)),('wrong_literal_slot',lambda b:b.update(literal_address=0x0800000c)),('nonadjacent_store',lambda b:b.update(store_pc=0x08000004)),('missing_evidence',lambda b:b.update(source_evidence=[]))]:
  b=copy.deepcopy(c);mut(b);reject(name,lambda b=b:validate_contract(b,rom,ev))
 reject('changed_evidence_bytes',lambda:validate_contract(c,rom,{sha:b'wrong'}))
 for name,mut in [('partial_state_lane',lambda g:g.fields[(owner,0x03000000)].update(size=2)),('wrong_destination_ssa',lambda g:g.access.update(s=('state',owner,0x03000004,4))),('literal_not_original_varnode',lambda g:g.v['value'].update(offset=str(0x0800000c))),('scalar_read_overlap',lambda g:g.access.update(other=('state',owner,0x03000000,4))),('partial_write_overlap',lambda g:g.access.update(other=('state',owner,0x03000003,1))),('missing_store',lambda g:g.blocks[0].update(ops=[]))]:
  g=copy.deepcopy(f);mut(g);reject(name,lambda g=g:bind(g,[c],ev))
 from contract import validate
 from lower import lower
 x={'schema':'gameverse.l1.behavior/0.2','id':'r','parameters':[],'return_type':'void','state':[{'name':'oam_field','storage_type':'u32','resource_reference':'oam'}],'locals':[],'assets':[],'collections':[],'resource_references':[{'id':'oam','token':1}],'resource_fields':{'oam_field':'oam'},'body':[{'op':'assign_field','field':'oam_field','value':{'op':'resource_reference','type':'u32','resource':'oam','token':1},'provenance':'s'}]}
 validate(x);names.append('address_free_typed_inventory')
 class E:
  def validate_module(self,y):assert y==x
 e=E();assert 'UINT32_C(1)'in lower(x,native_service_emitter=e);names.append('explicit_emitter_token_lowering')
 return {'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-start,'native_calls':0}
if __name__=='__main__':print(json.dumps(run()))
