"""Serialized symbolic L1 -> portable bit-exact C. No L0/ROM reads."""
from pathlib import Path
import argparse,json
T={'u8':'uint8_t','u16':'uint16_t','u32':'uint32_t','u64':'uint64_t'}
def expr(e):
 op=e['op'];t=T[e['type']];bits=int(e['type'][1:]);a=e.get('args',[])
 if op=='const':return f'(({t})UINT64_C({e["value"]}))'
 if op=='field':return 's->'+e['name']
 if op in('parameter','local'):return e['name']
 if op=='collection_read':return 's->'+e['collection']+'['+expr(e['index'])+']'
 if op=='asset_read':
  i=expr(e['index']);n=bits//8
  return '('+' | '.join(f'(({t}){e["asset"]}[({i})+{j}] << {j*8})'for j in range(n))+')'
 xs=[expr(v)for v in a]
 if op in('add_wrap','sub_wrap','mul_wrap','bit_and','bit_or','bit_xor'):
  operator={'add_wrap':'+','sub_wrap':'-','mul_wrap':'*','bit_and':'&','bit_or':'|','bit_xor':'^'}[op]
  wide='uint32_t' if bits<=32 else 'uint64_t'
  return f'(({t})(({wide})({xs[0]}) {operator} ({wide})({xs[1]})))'
 if op in('equal','not_equal','less_unsigned','less_equal_unsigned','bool_and','bool_or'):
  operator={'equal':'==','not_equal':'!=','less_unsigned':'<','less_equal_unsigned':'<=','bool_and':'&&','bool_or':'||'}[op]
  return f'(({t})(({xs[0]}) {operator} ({xs[1]})))'
 if op in('less_signed','less_equal_signed'):
  bit=1<<(int(a[0]['type'][1:])-1);operator='<'if op=='less_signed'else'<='
  return f'(({t})(((uint64_t)({xs[0]}) ^ UINT64_C({bit})) {operator} ((uint64_t)({xs[1]}) ^ UINT64_C({bit}))))'
 if op in('shift_left','shift_right','shift_arithmetic','extract'):
  fn={'shift_left':'ir_shl','shift_right':'ir_lsr','shift_arithmetic':'ir_asr','extract':'ir_lsr'}[op];srcbits=int(a[0]['type'][1:])
  return f'(({t}){fn}({xs[0]},{xs[1]},{srcbits}))'
 if op=='zext':return f'(({t})({xs[0]}))'
 if op=='sext':return f'(({t})ir_sext({xs[0]},{int(a[0]["type"][1:])},{bits}))'
 if op=='neg_wrap':return f'(({t})(UINT64_C(0)-(uint64_t)({xs[0]})))'
 if op in('bit_not','bool_not'):return f'(({t})({"~"if op=="bit_not"else"!"}({xs[0]})))'
 raise ValueError('unsupported L1 expression '+op)
def statements(ss,indent=' '):
 out=''
 for s in ss:
  op=s['op']
  if op in('assign_field','assign_local'):out+=indent+('s->'+s['field']if op=='assign_field'else s['local'])+' = '+expr(s['value'])+';\n'
  elif op=='assign_collection':out+=indent+'s->'+s['collection']+'['+expr(s['index'])+'] = '+expr(s['value'])+';\n'
  elif op=='return':out+=indent+'return'+(' '+expr(s['value'])if 'value'in s else'')+';\n'
  elif op=='scope':out+=indent+'{\n'+statements(s['body'],indent+' ')+indent+'}\n'
  elif op=='switch':
   out+=indent+'switch ('+expr(s['selector'])+') {\n'
   for c in s['cases']:out+=''.join(indent+' case '+str(v)+':\n'for v in c['values'])+statements(c['body'],indent+'  ')+indent+' break;\n'
   out+=indent+' default:\n'+statements(s['default'],indent+'  ')+indent+'}\n'
  elif op=='if':out+=indent+'if ('+expr(s['condition'])+') {\n'+statements(s['then'],indent+' ')+indent+'} else {\n'+statements(s['else'],indent+' ')+indent+'}\n'
  else:raise ValueError('unsupported L1 statement '+op)
 return out
HELPERS='''#include <stdint.h>
static uint64_t ir_mask(unsigned w){return w==64?UINT64_MAX:(UINT64_C(1)<<w)-1;}
static uint64_t ir_shl(uint64_t v,unsigned n,unsigned w){return n>=w?0:(v<<n)&ir_mask(w);}
static uint64_t ir_lsr(uint64_t v,unsigned n,unsigned w){return n>=w?0:(v&ir_mask(w))>>n;}
static uint64_t ir_asr(uint64_t v,unsigned n,unsigned w){uint64_t m=ir_mask(w);v&=m;uint64_t sign=(v>>(w-1))&1;if(n>=w)return sign?m:0;if(!n)return v;return (v>>n)|(sign?(m^(m>>n)):0);}
static uint64_t ir_sext(uint64_t v,unsigned src,unsigned dst){uint64_t m=ir_mask(src);v&=m;return v& (UINT64_C(1)<<(src-1))?v|(ir_mask(dst)^m):v;}
'''
def lower(x):
 from contract import validate
 validate(x)
 if x['schema']!='gameverse.l1.behavior/0.2':raise ValueError('unsupported L1 version')
 return HELPERS+'typedef struct {\n'+''.join(' '+T[f['storage_type']]+' '+f['name']+';\n'for f in x['state'])+''.join(' '+T[c['storage_type']]+' '+c['name']+'['+str(c['count'])+'];\n'for c in x.get('collections',[]))+'} LiftedState;\n'+''.join('static const uint8_t '+a['name']+'[]={'+','.join(map(str,a['data']))+'};\n'for a in x['assets'])+(T[x.get('return_type','void')]if x.get('return_type','void')!='void'else'void')+' behavior_0(LiftedState*s'+''.join(','+T[p['storage_type']]+' '+p['name']for p in x.get('parameters',[]))+'){\n'+''.join(' '+T[v['storage_type']]+' '+v['name']+';\n'for v in x['locals'])+statements(x['body'])+'}\n'
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('l1',type=Path);p.add_argument('output',type=Path);a=p.parse_args();a.output.write_text(lower(json.loads(a.l1.read_text())))
