"""Derive targeted field values from L1 branch constants, without inventing meaning."""
def boundary_values(l1):
 definitions={};result={f['name']:set()for f in l1['state']};widths={f['name']:int(f['storage_type'][1:])for f in l1['state']}
 def visit(x,callback):
  if isinstance(x,list):
   for v in x:visit(v,callback)
  elif isinstance(x,dict):
   callback(x)
   for v in x.values():visit(v,callback)
 def define(x):
  if x.get('op')=='assign_local':definitions.setdefault(x['local'],[]).append(x['value'])
 visit(l1['body'],define)
 origin_cache={};active=set()
 def origin(e):
  if e['op']=='field':return e['name']
  if e['op']=='local':
   name=e['name']
   if name in origin_cache:return origin_cache[name]
   # This optional fixture heuristic must not explode on SSA diamonds or
   # interpret cycles/deep graphs as a proven scalar field origin.
   if name in active or len(active)>=256:return None
   active.add(name)
   try:
    values={origin(v)for v in definitions.get(name,[])}
    value=next(iter(values))if len(values)==1 else None
    origin_cache[name]=value;return value
   finally:active.remove(name)
  if e['op']in('zext','sext'):return origin(e['args'][0])
  if e['op']=='extract'and e['args'][1].get('value')==0:return origin(e['args'][0])
  return None
 def compare(e):
  if e.get('op')not in('equal','not_equal','less_signed','less_unsigned','less_equal_signed','less_equal_unsigned'):return
  for a,b in(e['args'],list(reversed(e['args']))):
   field=origin(a)
   if field and b.get('op')=='const':
    maximum=(1<<widths[field])-1;value=b['value']&maximum;result[field].update((value,(value-1)&maximum,(value+1)&maximum))
 visit(l1['body'],compare)
 return{f:sorted(values)for f,values in result.items()if values}
