"""One adapter-driven original vs generated native oracle; bounded local run."""
from pathlib import Path
from domain import native_interval,accepts
from boundary import boundary_values
from returnproof import oracle_stack_overlap
from causal import digest
import argparse,subprocess,time,json,hashlib,platform
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def qualify(out,rom,vectors=16384,parameter_grid=False,fixtures=None):
 if not 1<=vectors<=131072:raise ValueError('native vector budget must be1..131072')
 start=time.perf_counter();a=json.loads((out/'validation-adapter.json').read_text());r={'schema':'gameverse.ir.qualification/0.2','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'machine':platform.platform(),'queue_s':None,'build_mode':'clean','cache':'none','limits':{'vectors':vectors,'instructions_per_call':2048,'stage_timeout_s':30},'stages':[],'rom_sha256':sha(rom),'fixture_scope':'deterministic boundary and random synthetic fields; not gameplay traces','parameter_grid_low8':parameter_grid,'assumptions':a['assumptions']}
 r['fixture_input_sha256']=digest(fixtures)
 r['harness_sha256']=sha(ROOT/'tools/behavior_ir/oracle.c.in');r['harness_version']='automatic-native-oracle/0.2';r['abi_checks']=['callee_saved_r4_r11','stack_balance','qualified_return_width'];r['compiler_version']=subprocess.check_output(['cc','--version'],text=True).splitlines()[0]
 def stage(label,cmd):
  t=time.perf_counter();p=subprocess.run(list(map(str,cmd)),text=True,capture_output=True,timeout=30,cwd=ROOT);r['stages'].append({'label':label,'wall_s':time.perf_counter()-t,'exit_code':p.returncode,'stderr':p.stderr,'stdout':p.stdout})
  if p.returncode:raise RuntimeError(label+': '+p.stderr)
  return p.stdout
 try:
  if a.get('retained_services'):raise RuntimeError('retained native services require an explicit separate-core native effect qualifier')
  if a.get('resource_references'):raise RuntimeError('resource references require an explicit native identity codec qualifier')
  if a.get('entity_references'):
   from entity_reference import validate_adapter
   validate_adapter(a)
  if any(f['owner']=='register'for f in a['fields'])and not a.get('native_abi'):raise RuntimeError('register-owned state requires explicit native ABI contract')
  for f in a['fields']:
   if f['owner']=='register'and (f['width']!=32 or a['native_abi'].get('registers',{}).get(f.get('register'))!={'field':f['name']}):raise RuntimeError('register field requires matching explicit native input field binding')
  if a.get('native_abi'):
   register_fields={(f['name'],f['register'])for f in a['fields']if f['owner']=='register'}
   liveout_fields={(v['field'],v['register'])for v in a['native_abi'].get('liveouts',[])}
   if register_fields!=liveout_fields:raise RuntimeError('native register fields must exactly match explicit liveouts')
  if a.get('native_abi')and a.get('native_sequence'):raise RuntimeError('custom native ABI cannot combine declared native sequence')
  if any(f['width']>32 for f in a['fields']):raise RuntimeError('oracle scalar fixture width exceeds32bits')
  from oracle_layout import select_layout,validate_image
  layout=select_layout(json.loads((out/'l1.json').read_text()),a,lambda:rom.read_bytes())
  r['code_layout']=layout
  stage('compile',['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fno-builtin','-Os','-c',out/'generated.c','-o',out/'generated.o'])
  (out/'generated.ld').write_text('SECTIONS { . = '+hex(layout['base'])+'; .text : { *(.text*) *(.rodata*) } /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }\n')
  stage('link',['arm-none-eabi-ld','-T',out/'generated.ld','-e','behavior_0',out/'generated.o','-o',out/'generated.elf'])
  nm=stage('symbols',['arm-none-eabi-nm',out/'generated.elf']);entry=int(next(line.split()[0]for line in nm.splitlines()if line.split()[-1]=='behavior_0'),16)&~1
  stage('emit',['arm-none-eabi-objcopy','-O','binary',out/'generated.elf',out/'generated.bin'])
  r['code_layout']=validate_image(layout,(out/'generated.bin').stat().st_size,entry)
  entity_refs=a.get('entity_references',[]);all_refs=a.get('object_references',[])+entity_refs
  reference_origins={}
  shared_references={v['reference']for v in a.get('argument_views',[])}
  for ref in all_refs:
   offsets=[f['offset']for f in a['fields']if f['owner']=='reference'and f['reference']==ref['name']]+[z.get('offset',0)for z in a.get('collections',[])if z.get('owner')=='reference'and z['reference']==ref['name']]
   if offsets and min(offsets)<0:raise RuntimeError('negative reference access offset unsupported')
   origin=(min(offsets)//32)*32 if offsets and min(offsets)>=8192 and ref['name']not in shared_references else 0
   reference_origins[ref['name']]=origin
  def machine_offset(view):return view.get('offset',0)-reference_origins.get(view.get('reference'),0)
  r['reference_window_origins']=reference_origins
  span=max([256]+[ref['cell_extent']for ref in entity_refs]+[machine_offset(f)+f['width']//8 for f in a['fields']if f['owner']in('entity','reference')]+[machine_offset(z)+z.get('stride',z['size'])*(z['count']-1)+z['size']for z in a.get('collections',[])if z.get('address')is None]);entity_bytes=(span+31)//32*32
  if entity_bytes>16384:raise RuntimeError('entity span exceeds oracle16384byte absolute bound')
  refs={ref['name']:i for i,ref in enumerate(all_refs)};entities={ref['cell_argument']for ref in entity_refs}|{v['argument']for v in a.get('argument_views',[])}|{f['argument']for f in a['fields']if f['owner']=='entity'}|{z['argument']for z in a.get('collections',[])if z.get('owner')=='entity'};view_by_argument={v['argument']:v for v in a.get('argument_views',[])};independent=[name for name in sorted(entities)if name not in view_by_argument];entity_indices={name:len(refs)+i for i,name in enumerate(independent)};entity_indices.update({name:refs[v['reference']]for name,v in view_by_argument.items()});object_count=max(1,len(refs)+len(independent))
  entity_limit=16384 if object_count==1 else 8192
  if entity_bytes>entity_limit:raise RuntimeError('entity span exceeds oracle per-object bound')
  if view_by_argument:
   entity_bytes=max(entity_bytes,max(v.get('base_offset',0)+v['stride']*v['count']for v in view_by_argument.values()))
   if entity_bytes>entity_limit:raise RuntimeError('entity view backing span exceeds oracle per-object bound')
  if object_count>4:raise RuntimeError('oracle object count exceeds4')
  if a.get('object_references')and any(f['owner']=='entity'and f['argument']not in view_by_argument for f in a['fields']):raise RuntimeError('object/entity alias precondition unproved')
  object_bases=[0x02010000+i*8192 for i in range(object_count)]
  for ref in all_refs:
   index=refs[ref['name']];origin=reference_origins[ref['name']]
   required=max(0,0x02000000+origin-object_bases[index])
   object_bases[index]+=((required+8191)//8192)*8192
   if not 0x02000000<=object_bases[index]-origin<0x02040000:raise RuntimeError('reference relocation root outside canonical EWRAM')
  object_windows=[(base,base+entity_bytes)for base in object_bases]
  if any(lo<0x02010000 or hi>0x02018000 for lo,hi in object_windows):raise RuntimeError('reference window exceeds reserved oracle backing')
  if any(a<d and c<b for i,(a,b)in enumerate(object_windows)for c,d in object_windows[i+1:]):raise RuntimeError('relocated oracle object windows overlap')
  r['object_bases']=object_bases

  global_spans=[((f['address']or 0)+f['offset'],f['width']//8)for f in a['fields']if f['owner']=='global']+[(z['address'],z.get('stride',z['size'])*(z['count']-1)+z['size'])for z in a.get('collections',[])if z.get('address')is not None]+[(z['cell'],4)for z in a.get('object_references',[])]
  for address,width in global_spans:
   if not 0x02000000<=address<0x03000000:continue
   if width>0x40000:raise RuntimeError('source global span exceeds EWRAM mirror period')
   normalized=0x02000000+((address-0x02000000)%0x40000);end=normalized+width
   spans=[(normalized,min(end,0x02040000))]+([(0x02000000,0x02000000+end-0x02040000)]if end>0x02040000 else[])
   if any(lo<target_hi and target_lo<hi for lo,hi in spans for target_lo,target_hi in object_windows):raise RuntimeError('oracle object allocation aliases source global/collection or EWRAM mirror')
  # Return provenance assumes externally owned state cannot overwrite the
  # oracle's saved return frame. Objects live in EWRAM, SP is03007e00.
  for address,width in [(f['address']+f['offset'],f['width']//8)for f in a['fields']if f['owner']=='global']+[(z['address'],z['size']*z['count'])for z in a.get('collections',[])if z.get('address')is not None]:
   if oracle_stack_overlap(address,width):raise RuntimeError('source state overlaps oracle return-proof stack frame or IWRAM mirror')
  r['limits'].update(entity_bytes=entity_bytes,object_count=object_count,entity_span_limit=entity_limit,object_stride=8192,reserved_object_bytes=32768)
  if entity_bytes+(object_count-1)*8192>32768:raise RuntimeError('object backing exceeds reserved validation region')
  c=(ROOT/'tools/behavior_ir/oracle.c.in').read_text().replace('@GENERATED_BASE@',hex(layout['base'])).replace('@FIELDS@',','.join('{'+str((f['address']or 0)+f['offset']if f['owner']=='global'else 0)+','+str(machine_offset(f)+view_by_argument.get(f.get('argument'),{}).get('base_offset',0))+',offsetof(LiftedState,'+f['name']+'),'+str(f['width']//8)+','+str(refs[f['reference']]if f['owner']=='reference'else entity_indices[f['argument']]if f['owner']=='entity'else 0)+','+str(native_interval(f.get('domain',{}),f['width'])[0])+'u,'+str(native_interval(f.get('domain',{}),f['width'])[1])+'u,'+str(view_by_argument.get(f.get('argument'),{}).get('stride',0))+','+str(view_by_argument.get(f.get('argument'),{}).get('count',1))+','+str(int(f['register'][1:])+1 if f['owner']=='register'else 0)+'}'for f in a['fields'])).replace('@VECTORS@',str(vectors)).replace('@ORIGINAL_ENTRY@','0x'+a['entry']).replace('@GENERATED_ENTRY@',hex(entry))
  entities={ref['cell_argument']for ref in entity_refs}|{v['argument']for v in a.get('argument_views',[])}|{f['argument']for f in a['fields']if f['owner']=='entity'}|{z['argument']for z in a.get('collections',[])if z.get('owner')=='entity'}
  if len(entities)>1 and a.get('argument_contract',{}).get('separation')!='distinct_accessed_views':raise RuntimeError('oracle multiple entity separation contract missing')
  if len(a.get('parameters',[]))>3:raise RuntimeError('generated scalar ABI exceeds registers')
  if sum(c['size']*c['count']for c in a.get('collections',[]))>4096:raise RuntimeError('oracle collection byte budget')
  if a.get('native_sequence'):
   sequence=a['native_sequence']
   if not 1<=len(sequence)<=8:raise RuntimeError('native sequence call budget')
   calls=[];source=rom.read_bytes()
   for step in sequence:
    pc=int(step['entry'],16);span=step['instruction_span'];rom_offset=pc-0x08000000
    if pc&1 or span['size']<=0 or not 0<=rom_offset<=len(source)-span['size'] or hashlib.sha256(source[rom_offset:rom_offset+span['size']]).hexdigest()!=span['sha256']:raise RuntimeError('native sequence ROM span identity mismatch')
    arguments=step['arguments']
    if set(arguments)-{'r0','r1','r2','r3'} or any(value not in entities for value in arguments.values()):raise RuntimeError('native sequence only accepts declared entity arguments')
    values=['original_args['+arguments['r'+str(i)][1:]+']'if'r'+str(i)in arguments else'0'for i in range(4)]
    calls.append('call(c,'+hex(pc)+',(uint32_t[]){'+','.join(values)+'},&original_result)')
   c=c.replace('call(c,0x'+a['entry']+',original_args,&original_result)','('+'&&'.join(calls)+')')
   r['native_sequence']=sequence
  if a.get('native_abi'):
   from native_abi import render_call,liveout_checks,register_input_setup
   helper,expression,metadata=render_call(a,rom.read_bytes())
   c=c.replace('int main(',helper+'\nint main(',1)
   c=c.replace('call(c,0x'+a['entry']+',original_args,&original_result)',expression.replace('@ORIGINAL_ENTRY@','0x'+a['entry']))
   c=c.replace('if(!native_original_call(',register_input_setup(a)+'if(!native_original_call(',1)
   c=c.replace('rd(c,0x02024000,&state,sizeof(state));','rd(c,0x02024000,&state,sizeof(state));'+liveout_checks(a),1)
   r['native_abi']=metadata;r['abi_checks']=['explicit_source_pinned_native_abi','declared_preserves','declared_liveouts','qualified_return_width'];r['limits']['original_instructions_per_call']=metadata['contract']['instruction_cap']
  if a.get('continuation_tokens'):
   from native_tokens import render as render_tokens
   token_helper,token_metadata=render_tokens(a,rom.read_bytes())
   c=c.replace('int main(',token_helper+'\nint main(',1)
   marker='memcpy((uint8_t*)&state+fields[j].generated,&v,fields[j].bytes);'
   c=c.replace(marker,marker+'uint32_t native_v;if(!continuation_encode(j,v,&native_v)){fprintf(stderr,"invalid continuation entry token test%u\\n",test);return 17;}')
   c=c.replace(',&v,fields[j].bytes);else if(fields[j].address)wr(c,fields[j].address,&v,fields[j].bytes);',' ,&native_v,fields[j].bytes);else if(fields[j].address)wr(c,fields[j].address,&native_v,fields[j].bytes);')
   marker='if(fields[j].address)rd(c,fields[j].address,globals[j],fields[j].bytes);'
   c=c.replace(marker,'if(fields[j].address){rd(c,fields[j].address,globals[j],fields[j].bytes);uint32_t native_v=0,token_v;memcpy(&native_v,globals[j],fields[j].bytes);if(!continuation_decode(j,native_v,&token_v)){fprintf(stderr,"unknown continuation output test%u\\n",test);return 18;}memcpy(globals[j],&token_v,fields[j].bytes);}')
   r['continuation_tokens']=token_metadata
  c=c.replace('@ENTITY_ARGS@',''.join('original_args['+f[1:]+']='+str(object_bases[entity_indices[f]]+view_by_argument.get(f,{}).get('base_offset',0))+('+(test%'+str(view_by_argument[f]['count'])+')*'+str(view_by_argument[f]['stride'])if f in view_by_argument else'')+';'for f in entities)).replace('@PARAMETERS@',','.join('{'+p['register'][1:]+','+str(int(p['type'][1:])//8)+','+str(native_interval(p.get('domain',{}),int(p['type'][1:]))[0])+'u,'+str(native_interval(p.get('domain',{}),int(p['type'][1:]))[1])+'u,'+str(int(p.get('derived_pool_slot',False)))+'}'for p in a.get('parameters',[]))).replace('@COLLECTIONS@',','.join('{'+str(z['address']or 0)+',offsetof(LiftedState,'+z['name']+'),'+str(z['size']*z['count'])+','+str(refs[z['reference']]if z.get('owner')=='reference'else entity_indices[z['argument']]if z.get('owner')=='entity'else 0)+','+str(machine_offset(z))+','+str(z['size'])+','+str(z['count'])+','+str(z.get('stride',z['size']))+'}'for z in a.get('collections',[])))
  reference_setup=''.join('c->busWrite32(c,'+str(ref['cell'])+','+str(object_bases[refs[ref['name']]]-reference_origins[ref['name']])+');'for ref in a.get('object_references',[]))
  for ref in entity_refs:
   reference_setup+='uint32_t entity_ref_'+ref['name']+'='+str(object_bases[refs[ref['name']]])+'u;memcpy(raw['+str(entity_indices[ref['cell_argument']])+']+'+str(ref['cell_offset'])+',&entity_ref_'+ref['name']+',4);'
  c=c.replace('@ENTITY_BYTES@',str(entity_bytes)).replace('@OBJECT_COUNT@',str(object_count)).replace('@REFERENCE_SETUP@',reference_setup)
  c=c.replace('@PARAMETER_VALUE@',('((random32()&0xffffff00u)|((test>>(j*8))&255u))&((parameters[j].bytes==4)?UINT_MAX:((1u<<(parameters[j].bytes*8))-1))')if parameter_grid else'value(test,j+17,parameters[j].bytes)')
  rows=fixtures.get('states',[])if fixtures else[]
  expected_rows=fixtures.get('expected_states',[])if fixtures else[]
  if expected_rows and len(expected_rows)!=len(rows):raise RuntimeError('expected fixture rows must match entry rows')

  c=c.replace('0x02010000+oi*8192','object_bases[oi]').replace('0x02010000+collections[j].object*8192','object_bases[collections[j].object]')
  data='static const uint32_t object_bases[]={'+','.join(str(base)+'u'for base in object_bases)+'};\n'
  data+='#define FIXTURE_COUNT '+str(len(rows))+'\n#define FIXTURE_FIELDS '+str(len(a['fields']))+'\nstatic const uint32_t fixture_values['+str(max(1,len(rows)))+']['+str(max(1,len(a['fields'])))+']={'+','.join('{'+','.join(str(row[f['name']])+'u'for f in a['fields'])+'}'for row in rows)+'};\n'
  data+='#define FIXTURE_EXPECTED_COUNT '+str(len(expected_rows))+'\nstatic const uint32_t fixture_expected['+str(max(1,len(expected_rows)))+']['+str(max(1,len(a['fields'])))+']={'+','.join('{'+','.join(str(row[f['name']]&((1<<f['width'])-1))+'u'for f in a['fields'])+'}'for row in expected_rows)+'};\n'
  boundaries=boundary_values(json.loads((out/'l1.json').read_text()));columns=[boundaries.get(f['name'],[])for f in a['fields']];max_width=max([1]+[len(v)for v in columns]);data+='static const unsigned field_boundary_counts[]={'+','.join(str(len(v))for v in columns)+'};\nstatic const uint32_t field_boundary_values['+str(max(1,len(columns)))+']['+str(max_width)+']={'+','.join('{'+','.join(str(v)+'u'for v in values)+'}'for values in columns)+'};\n';r['branch_constant_field_values']=boundaries;r['fixture_scope']+='; first256cases stratify direct branch comparison constants and neighbors where symbolic field origin is unambiguous'
  parameter_rows=fixtures.get('parameter_values',[])if fixtures else[]
  collection_rows=fixtures.get('collection_values',[])if fixtures else[]
  expected_collection_rows=fixtures.get('expected_collections',[])if fixtures else[]
  expected_returns=fixtures.get('expected_returns',[])if fixtures else[]
  expected_field_subsets=fixtures.get('expected_field_subsets',[])if fixtures else[]
  sizes=[len(z)for z in(parameter_rows,collection_rows,expected_collection_rows,expected_returns,expected_field_subsets,rows)if z]
  if sizes and len(set(sizes))!=1:raise RuntimeError('fixture channels must have identical case counts')
  if max(sizes,default=0)>vectors:raise RuntimeError('fixture count exceeds native vector budget')
  def array2(name,ctype,values,width):return 'static const '+ctype+' '+name+'['+str(max(1,len(values)))+']['+str(max(1,width))+']={'+','.join('{'+','.join(str(v)+'u'for v in row)+'}'for row in values)+'};\n'
  parameter_values=[]
  for row in parameter_rows:
   values=[]
   for p in a.get('parameters',[]):
    v=row[p['name']]&((1<<int(p['type'][1:]))-1);lo,hi=native_interval(p.get('domain',{}),int(p['type'][1:]))
    if not accepts(p.get('domain',{}),v,int(p['type'][1:])):raise RuntimeError('parameter fixture outside qualified domain')
    values.append(v)
   parameter_values.append(values)
  def packed_collections(rows):
   result=[]
   for row in rows:
    values=[]
    for collection in a.get('collections',[]):
     items=row[collection['name']]
     if len(items)!=collection['count']:raise RuntimeError('collection fixture extent mismatch')
     for value in items:
      if not 0<=value<1<<(collection['size']*8):raise RuntimeError('collection fixture value outside exact width')
      values.extend(value.to_bytes(collection['size'],'little'))
    result.append(values)
   return result
  packed=packed_collections(collection_rows);expected_packed=packed_collections(expected_collection_rows)
  collection_bytes=sum(z['size']*z['count']for z in a.get('collections',[]))
  data+='#define PARAMETER_FIXTURE_COUNT '+str(len(parameter_rows))+'\n#define COLLECTION_FIXTURE_COUNT '+str(len(packed))+'\n#define EXPECTED_COLLECTION_FIXTURE_COUNT '+str(len(expected_packed))+'\n#define EXPECTED_RETURN_FIXTURE_COUNT '+str(len(expected_returns))+'\n'
  data+=array2('parameter_fixture_values','uint32_t',parameter_values,len(a.get('parameters',[])))
  data+=array2('collection_fixture_values','uint8_t',packed,collection_bytes)
  data+=array2('expected_collection_fixture_values','uint8_t',expected_packed,collection_bytes)
  data+='static const uint32_t expected_return_fixture_values['+str(max(1,len(expected_returns)))+']={'+','.join(str(v&0xffffffff)+'u'for v in expected_returns)+'};\n'
  data+='#define EXPECTED_FIELD_SUBSET_COUNT '+str(len(expected_field_subsets))+'\n'
  field_names={f['name']for f in a['fields']}
  if any(set(row)-field_names for row in expected_field_subsets):raise RuntimeError('expected subset references unknown field')
  data+=array2('expected_field_subset_mask','uint8_t',[[int(f['name']in row)for f in a['fields']]for row in expected_field_subsets],len(a['fields']))
  data+=array2('expected_field_subset_values','uint32_t',[[row.get(f['name'],0)for f in a['fields']]for row in expected_field_subsets],len(a['fields']))
  r['expected_field_subset_cases']=len(expected_field_subsets)
  r['parameter_collection_fixture_cases']=max(sizes,default=0);r['expected_return_cases']=len(expected_returns);r['expected_collection_cases']=len(expected_packed)
  guard_width=fixtures.get('global_collection_canary_bytes',0)if fixtures else 0
  if not 0<=guard_width<=16:raise RuntimeError('global canary width exceeds16byte bound')
  ranges=[(f['address']+f['offset'],f['address']+f['offset']+f['width']//8)for f in a['fields']if f['owner']=='global']+[(z['address'],z['address']+z['size']*z['count'])for z in a.get('collections',[])if z.get('address')is not None]+[(z['cell'],z['cell']+4)for z in a.get('object_references',[])]
  guards=sorted({address for z in a.get('collections',[])if z.get('address')is not None for address in list(range(z['address']-guard_width,z['address']))+list(range(z['address']+z['size']*z['count'],z['address']+z['size']*z['count']+guard_width))if not any(lo<=address<hi for lo,hi in ranges)})
  if any(not(0x02000000<=address<0x02040000 or 0x03000000<=address<0x03008000)or oracle_stack_overlap(address,1)for address in guards):raise RuntimeError('collection canary requires canonical source RAM outside return frame')
  data+='static const uint32_t global_collection_guards[]={'+','.join(str(address)+'u'for address in guards)+'};\n'
  r['global_collection_guard_bytes']=len(guards)
  c=c.replace('@FIXTURE_DATA@',data)
  r['capture_fixtures']=fixtures.get('context')if fixtures else None
  r['expected_state_cases']=len(expected_rows)
  return_bits=int(a['return_type'][1:])if a.get('return_type','void')!='void'else 0
  if expected_returns and not return_bits:raise RuntimeError('expected returns require qualified return ABI')
  c=c.replace('@EXPECTED_RETURN_CHECK@',('if(test<EXPECTED_RETURN_FIXTURE_COUNT&&(generated_result!=expected_return_fixture_values[test]||original_result!=expected_return_fixture_values[test])){fprintf(stderr,"expected return mismatch test%u\\n",test);return 12;}')if expected_returns else'')
  c=c.replace('@RETURN_CHECK@',('if(((original_result^generated_result)&'+hex((1<<return_bits)-1)+'u)!=0){fprintf(stderr,"return mismatch test%u original%u generated%u\\n",test,original_result,generated_result);return 9;}')if return_bits else'')
  (out/'validation-adapter.c').write_text(c)
  stage('compile_oracle',['cc','-std=c11','-O1','-I/opt/homebrew/include',out/'validation-adapter.c','-L/opt/homebrew/lib','-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',out/'oracle'])
  r['parity']=json.loads(stage('native_parity',[out/'oracle',rom,out/'generated.bin']));r['outcome']='pass'
 except Exception as e:r['outcome']='failed';r['error']=str(e)
 finally:
  r['wall_s']=time.perf_counter()-start;r['artifacts']={p.name:{'sha256':sha(p),'bytes':p.stat().st_size}for p in[out/'l1.json',out/'validation-adapter.json',out/'generated.c',out/'generated.bin',out/'validation-adapter.c']if p.exists()};(out/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
 return r
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('out',type=Path);p.add_argument('rom',type=Path);p.add_argument('--vectors',type=int,default=16384);a=p.parse_args();r=qualify(a.out.resolve(),a.rom.resolve(),a.vectors);print(json.dumps(r));raise SystemExit(r['outcome']!='pass')
