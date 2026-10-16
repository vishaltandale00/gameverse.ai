"""Versioned fail-closed structural contract for executable L1."""
import re
TYPES={'u8','u16','u32','u64'}
UNARY={'zext','sext','neg_wrap','bit_not','bool_not'}
BINARY={'add_wrap','sub_wrap','mul_wrap','bit_and','bit_or','bit_xor','equal','not_equal','less_unsigned','less_equal_unsigned','less_signed','less_equal_signed','bool_and','bool_or','shift_left','shift_right','shift_arithmetic','extract'}
BANNED_KEYS={'address','offset','entry','pc','pointer','native_offset','machine_address'}

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
 def statements(ss):
  for s in ss:
   op=s['op']
   if op in('assign_local','assign_field'):
    namespace=locals if op=='assign_local'else fields;key='local'if op=='assign_local'else'field'
    if s[key]not in namespace:raise ValueError('unresolved assignment target')
    expression(s['value'])
    if namespace[s[key]]!=s['value']['type']:raise ValueError('implicit narrowing not permitted')
   elif op=='assign_collection':
    if s['collection']not in collections:raise ValueError('unresolved collection target')
    expression(s['index']);expression(s['value'])
   elif op=='if':expression(s['condition']);statements(s['then']);statements(s['else'])
   elif op=='switch':
    expression(s['selector']);seen=set()
    for c in s['cases']:
     if seen.intersection(c['values']):raise ValueError('overlapping switch labels')
     seen.update(c['values']);statements(c['body'])
    statements(s['default'])
   elif op=='scope':statements(s['body'])
   elif op=='return':
    if'value'in s:expression(s['value'])
   else:raise ValueError('unresolved effect/control '+op)
 for n,t in list(fields.items())+list(locals.items())+list(params.items()):
  if not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',n)or t not in TYPES:raise ValueError('invalid symbolic declaration')
 for p in document.get('parameters',[])+document['state']:
  d=p.get('domain',{});lo=d.get('unsigned_min',0);hi=d.get('unsigned_max',(1<<int(p['storage_type'][1:]))-1)
  if not 0<=lo<=hi<(1<<int(p['storage_type'][1:])):raise ValueError('invalid parameter domain')
 statements(document['body']);return True
