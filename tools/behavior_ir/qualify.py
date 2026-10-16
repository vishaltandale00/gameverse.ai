"""One adapter-driven original vs generated native oracle; bounded local run."""
from pathlib import Path
import argparse,subprocess,time,json,hashlib,platform
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def qualify(out,rom,vectors=16384,parameter_grid=False,fixtures=None):
 if not 1<=vectors<=131072:raise ValueError('native vector budget must be1..131072')
 start=time.perf_counter();a=json.loads((out/'validation-adapter.json').read_text());r={'schema':'gameverse.ir.qualification/0.2','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'machine':platform.platform(),'queue_s':None,'build_mode':'clean','cache':'none','limits':{'vectors':vectors,'instructions_per_call':2048,'stage_timeout_s':30},'stages':[],'rom_sha256':sha(rom),'fixture_scope':'deterministic boundary and random synthetic fields; not gameplay traces','parameter_grid_low8':parameter_grid,'assumptions':a['assumptions']}
 r['harness_sha256']=sha(ROOT/'tools/behavior_ir/oracle.c.in');r['harness_version']='automatic-native-oracle/0.2';r['abi_checks']=['callee_saved_r4_r11','stack_balance','qualified_return_width'];r['compiler_version']=subprocess.check_output(['cc','--version'],text=True).splitlines()[0]
 def stage(label,cmd):
  t=time.perf_counter();p=subprocess.run(list(map(str,cmd)),text=True,capture_output=True,timeout=30,cwd=ROOT);r['stages'].append({'label':label,'wall_s':time.perf_counter()-t,'exit_code':p.returncode,'stderr':p.stderr,'stdout':p.stdout})
  if p.returncode:raise RuntimeError(label+': '+p.stderr)
  return p.stdout
 try:
  if any(f['width']>32 for f in a['fields']):raise RuntimeError('oracle scalar fixture width exceeds32bits')
  stage('compile',['cc','-target','armv4t-none-eabi','-mcpu=arm7tdmi','-mthumb','-ffreestanding','-fno-builtin','-Os','-c',out/'generated.c','-o',out/'generated.o'])
  (out/'generated.ld').write_text('SECTIONS { . = 0x02020000; .text : { *(.text*) *(.rodata*) } /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }\n')
  stage('link',['arm-none-eabi-ld','-T',out/'generated.ld','-e','behavior_0',out/'generated.o','-o',out/'generated.elf'])
  nm=stage('symbols',['arm-none-eabi-nm',out/'generated.elf']);entry=int(next(line.split()[0]for line in nm.splitlines()if line.split()[-1]=='behavior_0'),16)&~1
  stage('emit',['arm-none-eabi-objcopy','-O','binary',out/'generated.elf',out/'generated.bin'])
  if(out/'generated.bin').stat().st_size>16384:raise RuntimeError('generated code/asset image exceeds16KiB oracle code region')
  span=max([256]+[f['offset']+f['width']//8 for f in a['fields']if f['owner']in('entity','reference')]+[z['offset']+z['size']*z['count']for z in a.get('collections',[])if z.get('address')is None]);entity_bytes=(span+31)//32*32
  if entity_bytes>8192:raise RuntimeError('entity span exceeds oracle8192byte bound')
  refs={ref['name']:i for i,ref in enumerate(a.get('object_references',[]))};object_count=max(1,len(refs))
  if object_count>4:raise RuntimeError('oracle object count exceeds4')
  if a.get('object_references')and any(f['owner']=='entity'for f in a['fields']):raise RuntimeError('object/entity alias precondition unproved')
  for f in a['fields']:
   if f['owner']=='global'and f['offset']<0x02018000 and 0x02010000<f['offset']+f['width']//8:raise RuntimeError('oracle object allocation aliases source global')
  r['limits'].update(entity_bytes=entity_bytes,object_count=object_count)
  c=(ROOT/'tools/behavior_ir/oracle.c.in').read_text().replace('@FIELDS@',','.join('{'+str((f['address']or 0)+f['offset']if f['owner']=='global'else 0)+','+str(f['offset'])+',offsetof(LiftedState,'+f['name']+'),'+str(f['width']//8)+','+str(refs[f['reference']]if f['owner']=='reference'else 0)+','+str(f.get('domain',{}).get('unsigned_min',0))+'u,'+str(f.get('domain',{}).get('unsigned_max',0xffffffff))+'u}'for f in a['fields'])).replace('@VECTORS@',str(vectors)).replace('@ORIGINAL_ENTRY@','0x'+a['entry']).replace('@GENERATED_ENTRY@',hex(entry))
  entities={f['argument']for f in a['fields']if f['owner']=='entity'}|{z['argument']for z in a.get('collections',[])if z.get('owner')=='entity'}
  if len(entities)>1:raise RuntimeError('oracle currently supports one entity object')
  if len(a.get('parameters',[]))>3:raise RuntimeError('generated scalar ABI exceeds registers')
  if sum(c['size']*c['count']for c in a.get('collections',[]))>4096:raise RuntimeError('oracle collection byte budget')
  c=c.replace('@ENTITY_ARGS@',''.join('original_args['+f[1:]+']=0x02010000;'for f in entities)).replace('@PARAMETERS@',','.join('{'+p['register'][1:]+','+str(int(p['type'][1:])//8)+','+str(p.get('domain',{}).get('unsigned_min',0))+'u,'+str(p.get('domain',{}).get('unsigned_max',0xffffffff))+'u}'for p in a.get('parameters',[]))).replace('@COLLECTIONS@',','.join('{'+str(z['address']or 0)+',offsetof(LiftedState,'+z['name']+'),'+str(z['size']*z['count'])+','+str(refs[z['reference']]if z.get('owner')=='reference'else 0)+','+str(z.get('offset',0))+'}'for z in a.get('collections',[])))
  c=c.replace('@ENTITY_BYTES@',str(entity_bytes)).replace('@OBJECT_COUNT@',str(object_count)).replace('@REFERENCE_SETUP@',''.join('c->busWrite32(c,'+str(ref['cell'])+','+str(0x02010000+refs[ref['name']]*8192)+');'for ref in a.get('object_references',[])))
  c=c.replace('@PARAMETER_VALUE@',('((random32()&0xffffff00u)|((test>>(j*8))&255u))&((parameters[j].bytes==4)?UINT_MAX:((1u<<(parameters[j].bytes*8))-1))')if parameter_grid else'value(test,j+17,parameters[j].bytes)')
  rows=fixtures.get('states',[])if fixtures else[]
  if fixtures and(a.get('parameters')or a.get('collections')):raise RuntimeError('capture fixture adapter currently supports leaf entity/global fields only')
  data='#define FIXTURE_COUNT '+str(len(rows))+'\n#define FIXTURE_FIELDS '+str(len(a['fields']))+'\nstatic const uint32_t fixture_values['+str(max(1,len(rows)))+']['+str(max(1,len(a['fields'])))+']={'+','.join('{'+','.join(str(row[f['name']])+'u'for f in a['fields'])+'}'for row in rows)+'};\n'
  c=c.replace('@FIXTURE_DATA@',data)
  r['capture_fixtures']=fixtures.get('context')if fixtures else None
  return_bits=int(a['return_type'][1:])if a.get('return_type','void')!='void'else 0
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
