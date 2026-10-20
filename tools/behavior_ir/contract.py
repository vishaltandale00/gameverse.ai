"""Versioned fail-closed structural contract for executable L1."""
import re
from domain import checked
TYPES={'u8','u16','u32','u64'}
UNARY={'zext','sext','neg_wrap','bit_not','bool_not'}
BINARY={'add_wrap','sub_wrap','mul_wrap','bit_and','bit_or','bit_xor','equal','not_equal','less_unsigned','less_equal_unsigned','less_signed','less_equal_signed','bool_and','bool_or','shift_left','shift_right','shift_arithmetic','extract'}
BANNED_KEYS={'address','offset','entry','pc','pointer','native_offset','machine_address'}
LABEL=re.compile(r'[A-Za-z_][A-Za-z_0-9]*\Z')
MAX_BASIC_BLOCKS=4096
MAX_BASIC_BLOCK_STATEMENTS=4096

def validate(document):
 if document['schema']!='gameverse.l1.behavior/0.2':raise ValueError('unsupported behavior version')
 fields={f['name']:f['storage_type']for f in document['state']};locals={v['name']:v['storage_type']for v in document['locals']};params={p['name']:p['storage_type']for p in document.get('parameters',[])};collections={c['name']:c for c in document.get('collections',[])};assets={a['name']:a for a in document['assets']}
 def walk(x):
  if isinstance(x,list):
   for z in x:walk(z)
  elif isinstance(x,dict):
   if set(x)&BANNED_KEYS:raise ValueError('machine layout escaped L0')
   for z in x.values():walk(z)
 walk(document)
 services={};used_services=set()
 for service in document.get('retained_services',[]):
  required={'id','implementation','binding_scope','arguments','return_type','dependency_closure','synchronization','memory_effects'}
  if set(service)!=required or not isinstance(service['id'],str)or not LABEL.fullmatch(service['id'])or service['id']in services:raise ValueError('invalid retained service signature identity')
  if service['implementation']!='preserved_native_opaque'or service['binding_scope']!='source_pinned_native_only'or service['dependency_closure']!='OPEN'or service['synchronization']!='flush_reload_all_bound_state':raise ValueError('retained service must remain native-only OPEN with full sync')
  if not isinstance(service['arguments'],list)or len(service['arguments'])>4 or any(t not in('u8','u16','u32')for t in service['arguments'])or service['return_type']not in('void','u32'):raise ValueError('unsupported retained service scalar ABI')
  if service['memory_effects']!={'reads':'unknown','writes':'unknown','optimization_barrier':'all_host_memory','reference_stability':'unknown'}:raise ValueError('retained service unknown host barrier required')
  services[service['id']]=service
 if services and(document.get('execution_scope')!='source_pinned_native_only'or document.get('semantic_closure')!='OPEN'):raise ValueError('retained service containing module must remain native-only OPEN')
 def expression(e):
  op=e['op'];t=e['type']
  if t not in TYPES:raise ValueError('invalid exact storage type')
  if op=='const':
   if not isinstance(e['value'],int)or not 0<=e['value']<1<<int(t[1:]):raise ValueError('constant outside exact bit width')
  elif op in('field','local','parameter'):
   namespace={'field':fields,'local':locals,'parameter':params}[op]
   if namespace.get(e['name'])!=t:raise ValueError('unresolved or incorrectly typed symbolic value')
  elif op in UNARY|BINARY:
   if len(e['args'])!=(1 if op in UNARY else 2):raise ValueError('incorrect operator arity')
   for a in e['args']:expression(a)
  elif op in('asset_read','collection_read'):
   namespace=assets if op=='asset_read'else collections;key='asset'if op=='asset_read'else'collection'
   if e[key]not in namespace:raise ValueError('unresolved named collection')
   expression(e['index'])
  else:raise ValueError('unsupported expression '+op)
 def block_outcomes(ss,scope_depth):
  """Possible exits from a block path; nested scope exits resume locally."""
  outcomes={('fallthrough',None)}
  for s in ss:
   if ('fallthrough',None) not in outcomes:raise ValueError('unreachable basic-block statement')
   outcomes.remove(('fallthrough',None));op=s['op']
   if op=='jump':next_outcomes={('jump',s['label'])}
   elif op=='return':next_outcomes={('return',None)}
   elif op=='leave_scope':next_outcomes={('leave',scope_depth)}
   elif op=='if':next_outcomes=block_outcomes(s['then'],scope_depth)|block_outcomes(s['else'],scope_depth)
   elif op=='switch':
    next_outcomes=block_outcomes(s['default'],scope_depth)
    for case in s['cases']:next_outcomes|=block_outcomes(case['body'],scope_depth)
   elif op=='scope':
    nested=block_outcomes(s['body'],scope_depth+1)
    next_outcomes={('fallthrough',None) if result in {('fallthrough',None),('leave',scope_depth+1)} else result for result in nested}
   else:next_outcomes={('fallthrough',None)}
   outcomes|=next_outcomes
  return outcomes
 def statements(ss,scope_depth=0,flow_labels=None,counter=None):
  for s in ss:
   op=s['op']
   if counter is not None:
    counter[0]+=1
    if counter[0]>MAX_BASIC_BLOCK_STATEMENTS:raise ValueError('basic-block statement limit exceeded')
   if op in('assign_local','assign_field'):
    namespace=locals if op=='assign_local'else fields;key='local'if op=='assign_local'else'field'
    if s[key]not in namespace:raise ValueError('unresolved assignment target')
    expression(s['value'])
    if namespace[s[key]]!=s['value']['type']:raise ValueError('implicit narrowing not permitted')
   elif op=='retained_native_service':
    if set(s)-{'op','service','arguments','provenance','result'}or not {'op','service','arguments','provenance'}<=set(s)or not isinstance(s['provenance'],str)or not s['provenance']:raise ValueError('invalid retained service statement')
    service=services.get(s['service'])
    if service is None or not isinstance(s['arguments'],list)or len(s['arguments'])!=len(service['arguments']):raise ValueError('unresolved retained service signature')
    for argument,t in zip(s['arguments'],service['arguments']):
     expression(argument)
     if argument['type']!=t:raise ValueError('retained service argument type mismatch')
    if service['return_type']=='void':
     if 'result'in s:raise ValueError('void retained service result exposed')
    elif locals.get(s.get('result'))!='u32':raise ValueError('retained service requires full u32 local result')
    used_services.add(s['service'])
   elif op=='assign_collection':
    if s['collection']not in collections:raise ValueError('unresolved collection target')
    expression(s['index']);expression(s['value'])
   elif op=='if':expression(s['condition']);statements(s['then'],scope_depth,flow_labels,counter);statements(s['else'],scope_depth,flow_labels,counter)
   elif op=='switch':
    expression(s['selector']);seen=set()
    for c in s['cases']:
     if seen.intersection(c['values']):raise ValueError('overlapping switch labels')
     seen.update(c['values']);statements(c['body'],scope_depth,flow_labels,counter)
    statements(s['default'],scope_depth,flow_labels,counter)
   elif op=='scope':statements(s['body'],scope_depth+1,flow_labels,counter)
   elif op=='control_flow':
    if flow_labels is not None:raise ValueError('nested basic-block control flow')
    if set(s)!={'op','form','start','blocks','provenance'} or s['form']!='acyclic_basic_blocks/0.1' or not isinstance(s['provenance'],str):raise ValueError('invalid basic-block control form')
    blocks=s['blocks']
    if not isinstance(blocks,list) or not 1<=len(blocks)<=MAX_BASIC_BLOCKS:raise ValueError('basic-block count outside limit')
    labels=set()
    for block in blocks:
     if not isinstance(block,dict) or set(block)!={'label','body'} or not isinstance(block['label'],str) or not LABEL.fullmatch(block['label']) or not isinstance(block['body'],list):raise ValueError('invalid basic block')
     if block['label'] in labels:raise ValueError('duplicate basic-block label')
     labels.add(block['label'])
    if not isinstance(s['start'],str) or not LABEL.fullmatch(s['start']) or s['start'] not in labels:raise ValueError('unresolved basic-block start')
    count=[0];edges={block['label']:set() for block in blocks}
    for block in blocks:
     statements(block['body'],scope_depth,labels,count)
     outcomes=block_outcomes(block['body'],scope_depth)
     if ('fallthrough',None) in outcomes:raise ValueError('basic-block path falls through')
     edges[block['label']]={label for kind,label in outcomes if kind=='jump'}
    visited=set();active=set();stack=[(s['start'],False)]
    while stack:
     label,leaving=stack.pop()
     if leaving:
      active.remove(label);visited.add(label);continue
     if label in active:raise ValueError('cyclic basic-block jump')
     if label in visited:continue
     active.add(label);stack.append((label,True))
     stack.extend((target,False) for target in edges[label])
    if visited!=labels:raise ValueError('unreachable basic block')
   elif op=='jump':
    if flow_labels is None:raise ValueError('jump outside basic-block control flow')
    if set(s)!={'op','label','provenance'} or not isinstance(s['label'],str) or s['label'] not in flow_labels or not isinstance(s['provenance'],str):raise ValueError('unresolved basic-block jump')
   elif op=='leave_scope':
    if not scope_depth:raise ValueError('dependency return outside invocation scope')
   elif op=='return':
    if'value'in s:expression(s['value'])
   else:raise ValueError('unresolved effect/control '+op)
 for n,t in list(fields.items())+list(locals.items())+list(params.items()):
  if not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',n)or t not in TYPES:raise ValueError('invalid symbolic declaration')
 for p in document.get('parameters',[])+document['state']:
  checked(p.get('domain',{}),int(p['storage_type'][1:]))
 statements(document['body'])
 if set(services)!=used_services:raise ValueError('unused retained service signature')
 return True
