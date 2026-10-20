"""Bounded synthetic source stack-ABI checks; no cartridge or native execution."""
import copy,hashlib,json,time
from stack_call import prove,callee_layout
from retained_services import STACK_SCHEMA,validate_service,derive_call

def run():
 start=time.perf_counter();checks=[]
 # Caller PUSH lr; SUB sp8; MOV r0..r3; MOV r4,5; STR sp0;
 # MOV r4,6; STR sp4; BL service. Callee saves20 bytes then loads slots.
 rom=bytearray(128);rom[:24]=bytes.fromhex('00b582b00120022103220423052400940624019400f014f8')
 rom[64:70]=bytes.fromhex('f0b5059c069d')
 nodes=[{'id':'target','space':'ram','offset':str(0x08000040),'size':4}]+[{'id':'v'+str(i),'space':'const','offset':str(i+1),'size':4,'constant':True}for i in range(6)]
 call={'id':'call','opcode':'CALL','pc':'08000014','inputs':['target']+['v'+str(i)for i in range(6)]}
 l0={'entry':'08000000','varnodes':nodes,'blocks':[{'id':0,'start':'08000000','stop':'08000014','predecessors':[],'successors':[],'ops':[call]}]}
 args=[{'register':'r'+str(i),'type':'u32','kind':'scalar'}for i in range(4)]+[{'stack_offset':i*4,'type':'u32','kind':'scalar'}for i in range(2)]
 def proof(l=l0,r=rom,a=args):return prove(l,next(o for b in l['blocks']for o in b['ops']if o['opcode']=='CALL'),{v['id']:v for v in l['varnodes']},r,a,6)
 assert proof()['caller_frame_bytes']==12;assert proof()['callee_frame_bytes']==20;checks.append('six_original_scalar_words')
 def reject(name,fn):
  try:fn()
  except(ValueError,KeyError,TypeError):checks.append(name);return
  raise AssertionError(name)
 for name,offset,half in [('wrong_stack_source',16,0x2407),('saved_slot_overlap',10,0x9402),('missing_slot',18,0x46c0),('register_clobber',12,0x2009),('stack_escape',10,0x94ff),('unknown_call_prefix',4,0xdf00)]:
  bad=bytearray(rom);bad[offset:offset+2]=half.to_bytes(2,'little');reject(name,lambda bad=bad:proof(r=bad))
 bad=copy.deepcopy(l0);bad['varnodes'][1]['offset']='9';reject('source_operand_disagreement',lambda:proof(l=bad))
 bad=copy.deepcopy(l0);bad['blocks'][0]['predecessors']=[0];bad['blocks'][0]['successors']=[0]
 # Call-reaching source with an actual cycle is rejected before reaching call only
 # when cycle is traversed, so a cycle after call is irrelevant to this prefix.
 bad=copy.deepcopy(l0);bad['blocks'][0]['stop']='08000012';bad['blocks'][0]['ops']=[];bad['blocks'][0]['successors']=[0,1];bad['blocks'][1:]=[{'id':1,'start':'08000014','stop':'08000014','predecessors':[0],'successors':[],'ops':[call]}];bad['blocks'][0]['predecessors']=[0]
 reject('cyclic_call_prefix',lambda:proof(l=bad))
 changed=copy.deepcopy(args);changed[4]['stack_offset']=4;reject('duplicate_declared_slots',lambda:callee_layout(rom,0x08000040,changed,6))
 reject('truncated_callee_prefix',lambda:callee_layout(rom,0x08000040,args,4))
 bad=bytearray(rom);bad[66:68]=(0x9c06).to_bytes(2,'little');reject('callee_wrong_slot',lambda:proof(r=bad))
 source=b'synthetic reviewed scalar ABI/effects';sha=hashlib.sha256(source).hexdigest();evidence={sha:source}
 c={'schema':STACK_SCHEMA,'id':'spawn','rom_sha256':hashlib.sha256(rom).hexdigest(),'entry':'08000040','mode':'thumb','span_size':6,'span_sha256':hashlib.sha256(rom[64:70]).hexdigest(),'abi':{'standard':'APCS32_scalar_words','arguments':args,'return':'void','stack_arguments':2,'variadic':False,'by_reference':False,'stack_prefix_bytes':6,'stack_frame_bytes':20,'preserve':['r'+str(i)for i in range(4,12)]+['sp']},'effects':{'authority':'canonical_native_host','synchronization':'flush_reload_all_bound_state','dependency_closure':'OPEN','dependencies':['opaque host'],'lifetime':'original host'},'source_evidence':[{'role':role,'sha256':sha}for role in('abi','effects')]}
 validate_service(c,rom,evidence);checks.append('version02_exact_contract')
 for name,mutation in [('by_reference',lambda x:x['abi'].update(by_reference=True)),('variadic',lambda x:x['abi'].update(variadic=True)),('false_frame',lambda x:x['abi'].update(stack_frame_bytes=16)),('missing_preserves',lambda x:x['abi'].update(preserve=[])),('bool_slot',lambda x:x['abi']['arguments'][4].update(stack_offset=False)),('wrong_count',lambda x:x['abi'].update(stack_arguments=1))]:
  bad=copy.deepcopy(c);mutation(bad);reject(name,lambda bad=bad:validate_service(bad,rom,evidence))
 byid={v['id']:v for v in nodes};seen=[]
 def resolve(v):seen.append(v);return {'op':'const','type':'u32','value':int(byid[v]['offset'])}
 reject('missing_original_source',lambda:derive_call(call,byid,c,resolve,rom,evidence))
 frames=[];stmt=derive_call(call,byid,c,resolve,rom,evidence,source_l0=l0,proofs=frames)
 assert seen==call['inputs'][1:]and len(stmt['arguments'])==6 and len(frames)==1;checks.append('all_exact_ssa_arguments_preserved')
 return {'outcome':'pass','checks':len(checks),'names':checks,'wall_s':time.perf_counter()-start,'native_calls':0}
if __name__=='__main__':print(json.dumps(run()))
