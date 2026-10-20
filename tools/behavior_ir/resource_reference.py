"""Source-pinned, non-dereferenced immutable resource identity storage.

The symbolic token is not a source address. Native bindings must explicitly
encode/decode the authenticated resource identity, with zero reserved for null.
"""
import copy,hashlib,re

def validate_contract(contract,rom,evidence):
 c=copy.deepcopy(contract)
 required={'id','token','native_value','rom_sha256','span_size','span_sha256','literal_load_pc','store_pc','literal_address','entry','destination','source_evidence'}
 if not isinstance(c,dict)or set(c)-{'field'}!=required:raise ValueError('resource reference exact contract required')
 if not isinstance(c['id'],str)or not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',c['id'])or type(c['token'])is not int or not 1<=c['token']<=0xffffffff:raise ValueError('resource reference symbolic identity/token invalid')
 for key in('native_value','literal_load_pc','store_pc','literal_address','entry','destination'):
  if type(c[key])is not int:raise ValueError('resource source coordinates require exact integers')
 if c['rom_sha256']!=hashlib.sha256(rom).hexdigest():raise ValueError('resource reference ROM identity mismatch')
 off=c['native_value']-0x08000000;size=c['span_size']
 if type(size)is not int or not 0<size<=65536 or not 0<=off<=len(rom)-size or hashlib.sha256(rom[off:off+size]).hexdigest()!=c['span_sha256']:raise ValueError('resource reference immutable source span mismatch')
 if not 0x02000000<=c['destination']<0x04000000 or c['destination']%4:raise ValueError('resource reference destination must be aligned RAM cell')
 def half(pc):
  start=pc-0x08000000
  if pc%2 or not 0<=start<=len(rom)-2:raise ValueError('resource source instruction outside ROM')
  return int.from_bytes(rom[start:start+2],'little')
 h=half(c['literal_load_pc']);s=half(c['store_pc']);pool=((c['literal_load_pc']+4)&~3)+(h&255)*4
 if h&0xf800!=0x4800 or c['store_pc']!=c['literal_load_pc']+2 or s&0xf800!=0x6000 or (s&7)!=(h>>8)&7:raise ValueError('resource requires adjacent literal LOAD and exact word STORE')
 if pool!=c['literal_address']or not 0<=pool-0x08000000<=len(rom)-4 or int.from_bytes(rom[pool-0x08000000:pool-0x08000000+4],'little')!=c['native_value']:raise ValueError('resource original literal does not identify source object')
 if not isinstance(c['source_evidence'],list)or not c['source_evidence']:raise ValueError('resource source evidence required')
 for item in c['source_evidence']:
  if set(item)!={'sha256','role'}or not isinstance(item['role'],str)or item['sha256']not in evidence or hashlib.sha256(evidence[item['sha256']]).hexdigest()!=item['sha256']:raise ValueError('resource source evidence identity mismatch')
 return c

def bind(lifter,contracts,evidence):
 stores={};bound=[]
 for contract in contracts:
  c=validate_contract(contract,lifter.rom,evidence)
  if c['entry']!=int(lifter.l0['entry'],16):continue
  operations=[o for b in lifter.blocks.values()for o in b['ops']if o['opcode']=='STORE'and int(o['pc'],16)==c['store_pc']]
  if len(operations)!=1:raise ValueError('resource source STORE missing or ambiguous')
  o=operations[0];kind,owner,start,size=lifter.access[o['id']]
  v=lifter.v[o['inputs'][2]]
  if (kind,owner,start,size)!=('state',('global',0),c['destination'],4)or v['space']!='ram'or v['size']!=4 or int(v['offset'])!=c['literal_address']:raise ValueError('resource source SSA/field STORE differs from authenticated literal')
  field=lifter.fields.get((owner,start))
  if not field or field['size']!=4:raise ValueError('resource field must be one complete u32 storage lane')
  for other in lifter.access:
   if other==o['id']:continue
   k,own,a,width=lifter.access[other]
   if k=='state'and own==owner and a<start+4 and start<a+width:raise ValueError('resource field has other scalar read/write use')
  if o['id']in stores or any(x['token']==c['token']and x['id']!=c['id']or x['id']==c['id']and x['token']!=c['token']for x in bound):raise ValueError('resource reference identity conflict')
  c['field']=field['name'];stores[o['id']]=c;bound.append(c)
 return stores,bound
