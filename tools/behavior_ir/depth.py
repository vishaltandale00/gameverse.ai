"""Prioritized mechanics closure -> bounded native qualification -> publication.
Failures stay pending with machine-readable missing dependencies and categories.
"""
from pathlib import Path
import argparse,ast,datetime,hashlib,json,sys,sysconfig,time,traceback
from lift import Lifter,Unsupported
from lower import lower
from contract import validate
from qualify import qualify
from publish import effects
from catalog import export_catalog
from seeds import discover
from configuration import configurations
from causal import load as causal_fixtures,digest as fixture_digest
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(path,x):path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(x,indent=2)+'\n');temporary.replace(path)
def semantic(quantity,denominator=1,frame='campaign'):
 return {'quantity':quantity,'unit':{'numerator':1,'denominator':denominator},'frame':frame,'confidence':0.85,'evidence':['own_rom_usage_and_native_component_oracle'],'naming_status':'analysis_annotation_not_behavior_input'}
PROFILES={
 'legend-of-zelda-the-the-minish-cap':[
  {'entry':'0807ca84','id':'tmc.progress.inventory_read','title':'Read persistent packed equipment state','role':'progression','domains':{'r0':{'unsigned_min':0,'unsigned_max':255}},'public_collections':{'collection_0':semantic('packed_two_bit_inventory')},'semantics':{}},
  {'entry':'0807caa0','id':'tmc.progress.inventory_write','title':'Acquire or update persistent equipment state','role':'progression','domains':{'r0':{'unsigned_min':0,'unsigned_max':255},'r1':{'unsigned_min':0,'unsigned_max':3}},'public_collections':{'collection_0':semantic('packed_two_bit_inventory')},'semantics':{}},
  {'entry':'0807aee4','id':'tmc.progress.derive_skills','title':'Derive legal sword skills from learned inventory','role':'progression','domains':{},'public_collections':{'dependency_0_collection_0':semantic('packed_two_bit_inventory')},'semantics':{'field_0':semantic('bitset',1,'abilities.derived')}},
  {'entry':'08075580','id':'tmc.combat.charge_initialization','title':'Initialize held sword charge with learned skill gates','role':'combat','domains':{'r1':{'unsigned_min':0,'unsigned_max':1}},'semantics':{}},
  {'entry':'08018308','id':'tmc.combat.contact_transaction','title':'Resolve typed attack contact and bilateral reaction','role':'combat','domains':{},'semantics':{}},
  {'entry':'080aef88','id':'tmc.motion.entity_step','title':'Apply enemy movement and contact constraints','role':'movement','domains':{},'semantics':{}}],
 'castlevania-aria-of-sorrow':[
  {'entry':'0806d430','id':'aria.motion.integrate_x','title':'Horizontal acceleration, speed cap and integration','role':'movement','domains':{},'semantics':{'field_0':semantic('position',65536,'world.x.right'),'field_1':semantic('velocity',65536,'world.x.right'),'field_2':semantic('acceleration',65536,'world.x.right')}},
  {'entry':'0806d460','id':'aria.motion.integrate_y','title':'Vertical acceleration, speed cap and integration','role':'movement','domains':{},'semantics':{'field_0':semantic('position',65536,'world.y.down'),'field_1':semantic('velocity',65536,'world.y.down'),'field_2':semantic('acceleration',65536,'world.y.down')}},
  {'entry':'08034624','id':'aria.combat.soul_cast','title':'Resource and capacity guarded soul casting','role':'combat','domains':{},'semantics':{}},
  {'entry':'08026008','id':'aria.combat.bone_projectile','title':'Bone projectile complete lifecycle','role':'combat','domains':{},'semantics':{}},
  {'entry':'08025f70','id':'aria.combat.bone_contact_partner','title':'Linked projectile collision partner lifecycle','role':'combat','domains':{},'semantics':{}},
  {'entry':'080683bc','id':'aria.progress.defeat_rewards','title':'Once-only defeat, bestiary, experience and reward choice','role':'progression','domains':{},'semantics':{}}]}

FINGERPRINT_VERSION='static-local-import-ast/1'

def compiler_fingerprint(tool_root=None,entrypoints=('depth.py',),assets=('oracle.c.in',),external_modules=()):
 """Hash static local import closure without executing modules or reading ROMs.

 Unknown non-stdlib imports fail closed. Third-party imports must be explicitly
 named by the caller; this compiler currently needs only the standard library.
 Function-scope imports count even if a particular profile does not execute them.
 """
 root=(Path(tool_root)if tool_root is not None else Path(__file__).resolve().parent).resolve()
 sources={};asset_hashes={};external=set(external_modules);seen_external=set()
 stdlib=set(getattr(sys,'stdlib_module_names',()))or(set(sys.builtin_module_names)|{p.stem if p.suffix=='.py'else p.name for p in Path(sysconfig.get_path('stdlib')).iterdir()if p.suffix=='.py'or p.is_dir()and p.name not in('site-packages','dist-packages','__pycache__')})
 def local_file(path):
  if path.with_suffix('.py').is_file():return path.with_suffix('.py')
  if(path/'__init__.py').is_file():return path/'__init__.py'
  return None
 def visit(path):
  path=path.resolve()
  try:name=path.relative_to(root).as_posix()
  except ValueError as error:raise Unsupported('compiler fingerprint local source escapes root: '+str(path))from error
  if name in sources:return
  try:raw=path.read_bytes();tree=ast.parse(raw,filename=name)
  except(OSError,SyntaxError,UnicodeError)as error:raise Unsupported('compiler fingerprint unreadable or invalid source '+name+': '+str(error))from error
  sources[name]=hashlib.sha256(raw).hexdigest()
  def imported(module,relative=0):
   parts=module.split('.')if module else[]
   base=path.parent if relative else root
   for _ in range(max(0,relative-1)):base=base.parent
   target=base.joinpath(*parts)
   file=local_file(target)
   if file is not None:
    # Package initializers can import helpers too; include each local parent.
    parent=target.parent
    while parent!=root and root in parent.parents:
     init=parent/'__init__.py'
     if init.is_file():visit(init)
     parent=parent.parent
    visit(file);return target
   top=parts[0]if parts else''
   if not relative and top in stdlib|external and not(root/top).exists()and not(root/(top+'.py')).exists():
    seen_external.add(top);return None
   raise Unsupported('compiler fingerprint missing local import '+('.'*relative+module)+' in '+name)
  for node in ast.walk(tree):
   if isinstance(node,ast.Import):
    for alias in node.names:imported(alias.name)
   elif isinstance(node,ast.ImportFrom):
    if node.module:
     target=imported(node.module,node.level)
     if target is not None and target.is_dir():
      # Distinguish explicitly bound package values from absent child modules.
      # Dynamic package exports have no static proof and fail closed.
      package_tree=ast.parse((target/'__init__.py').read_bytes())
      bound={z.id for z in ast.walk(package_tree)if isinstance(z,ast.Name)and isinstance(z.ctx,ast.Store)}
      bound.update(z.name for z in ast.walk(package_tree)if isinstance(z,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)))
      for z in ast.walk(package_tree):
       if isinstance(z,(ast.Import,ast.ImportFrom)):
        bound.update(a.asname or a.name.split('.')[0]for a in z.names)
      for alias in node.names:
       child=local_file(target/alias.name)
       if child is not None:visit(child)
       elif alias.name not in bound:raise Unsupported('compiler fingerprint missing package import '+alias.name+' in '+name)
    else:
     for alias in node.names:imported(alias.name,node.level)
 for name in sorted(set(entrypoints)):
  path=root/name
  if not path.is_file():raise Unsupported('compiler fingerprint missing entrypoint '+name)
  visit(path)
 for name in sorted(set(assets)):
  path=(root/name).resolve()
  if root not in path.parents:raise Unsupported('compiler fingerprint asset escapes root '+name)
  try:asset_hashes[name]=sha(path)
  except OSError as error:raise Unsupported('compiler fingerprint missing asset '+name)from error
 return {'version':FINGERPRINT_VERSION,'sources':dict(sorted(sources.items())),'assets':asset_hashes,'external_modules':sorted(seen_external)}

def profile_cache_inputs(profile,root=None):
 """Pin explicit noncode JSON inputs; absence is data, never a cache hit."""
 root=(Path(root)if root is not None else ROOT).resolve()
 paths=profile.get('cache_input_paths',[])
 if not isinstance(paths,list):raise Unsupported('cache_input_paths must be JSON path list')
 paths=list(paths)+([profile['causal_fixture']]if profile.get('causal_fixture')else[])
 result={}
 for name in paths:
  if not isinstance(name,str)or not name or Path(name).is_absolute()or Path(name).suffix.lower()!='.json':raise Unsupported('profile cache input must be root-relative JSON path')
  path=(root/name).resolve()
  if root not in path.parents:raise Unsupported('profile cache input escapes root')
  key=path.relative_to(root).as_posix()
  if not path.exists():result[key]={'state':'missing','sha256':None};continue
  try:result[key]={'state':'present','sha256':sha(path)}
  except OSError as error:raise Unsupported('profile cache input unreadable '+key)from error
 return dict(sorted(result.items()))

def input_signature(profile,compiler,source_closure,profile_inputs):
 return hashlib.sha256(json.dumps({'profile':profile,'compiler':compiler,'source_closure':source_closure,'profile_inputs':profile_inputs},sort_keys=True).encode()).hexdigest()

def reusable_native_proof(old,*,qualification_runtime_signature,fixture_input_sha256,rom_sha256,harness_sha256,generated_c_sha256,adapter_sha256,parameter_grid,requested_vectors):
 """Metadata-only changes may reuse a proof; qualifier implementation may not."""
 artifacts=old.get('artifacts',{})
 return bool(qualification_runtime_signature)and old.get('outcome')=='pass'and old.get('qualification_runtime_signature')==qualification_runtime_signature and old.get('parameter_grid_low8') is parameter_grid and old.get('limits',{}).get('vectors')==requested_vectors and old.get('fixture_input_sha256')==fixture_input_sha256 and old.get('rom_sha256')==rom_sha256 and old.get('harness_sha256')==harness_sha256 and artifacts.get('generated.c',{}).get('sha256')==generated_c_sha256 and artifacts.get('validation-adapter.json',{}).get('sha256')==adapter_sha256

def readiness_fields(ports_ready,source_dependency_closed=False):
 """A typed primitive and source closure do not prove a complete mechanic."""
 return {'ports_ready':bool(ports_ready),'typed_ports_ready':bool(ports_ready),'source_dependency_closed':bool(source_dependency_closed),'dependency_closure_scope':'source_functions_only','closure_ready':False,'closure_ready_deprecated':True,'system_closure_status':'unproven'}

def target_rank(profile,prior_rows,signatures):
 old=prior_rows.get(profile['id'],{})
 if not old or old.get('outcome')=='pending_unattempted':return 0
 if old.get('input_signature')!=signatures[profile['id']]:return 1 if old.get('outcome')!='native_qualified'else 2
 return 3

def work(queue_path,game,max_targets=8,max_closure=32,wall_budget=120,only_entries=None):
 queue=json.loads(queue_path.read_text());prior_path=ROOT/'local/ir/depth-status'/(game+'.json');prior_rows={r['id']:r for r in json.loads(prior_path.read_text()).get('rows',[])}if prior_path.exists()else{};item=next(i for i in queue['items']if i['id']==game);started=time.perf_counter();profiles=PROFILES.get(game,[]);pool={};compiled={};dependency_edges={};active=[];rows=[];needed=set();exports=[]
 if game=='castlevania-aria-of-sorrow':
  from qualify_aria_category3 import profiles as category3_profiles
  profiles=list(profiles)+category3_profiles()
 for attempt in item['attempts']:
  if attempt.get('artifacts'):exports.append(ROOT/attempt['artifacts']/'l0')
 for path in exports:
  for p in path.glob('0*.json'):pool[p.stem]=p
 if not profiles:profiles=discover(game,ROOT/item['rom'])
 if game=='super-mario-advance-2-super-mario-world':
  from qualify_sma2_reinitialize import profiles as reinitialize_profiles
  additions=reinitialize_profiles();entries={p['entry']for p in additions};profiles=[p for p in profiles if p['entry']not in entries]+additions
 out=ROOT/'local/ir/depth-runs'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')/game;out.mkdir(parents=True,exist_ok=False);rom=ROOT/item['rom'];raw=rom.read_bytes();profile_by_entry={p['entry']:p for p in profiles}
 compiler_signature=compiler_fingerprint()
 qualification_runtime_signature=hashlib.sha256(json.dumps(compiler_fingerprint(entrypoints=('qualify.py',)),sort_keys=True).encode()).hexdigest()
 profile_inputs={p['id']:profile_cache_inputs(p)for p in profiles}
 signatures={p['id']:input_signature(p,compiler_signature,{entry:(sha(pool[entry])if entry in pool else None)for entry in set(prior_rows.get(p['id'],{}).get('source_entries',[])+[p['entry']])},profile_inputs[p['id']])for p in profiles}
 selected=sorted([p for p in profiles if target_rank(p,prior_rows,signatures)<3 and(only_entries is None or p['entry']in only_entries)and not p.get('discovery_only')],key=lambda p:target_rank(p,prior_rows,signatures))[:max_targets]
 def compile_entry(entry):
  if entry in compiled:return compiled[entry]
  if time.perf_counter()-started>wall_budget:raise Unsupported('depth wall budget')
  if entry in active:raise Unsupported('recursive dependency closure')
  if len(compiled)+len(active)>=max_closure:raise Unsupported('dependency closure function budget')
  if entry not in pool:needed.add(entry);raise Unsupported('missing L0 dependency '+entry)
  active.append(entry);profile=profile_by_entry.get(entry,{})
  try:
   while True:
    try:l1,adapter=Lifter(json.loads(pool[entry].read_text()),raw,compiled,profile.get('domains',{}),profile.get('object_contract',{}),profile.get('state_domains',{}),profile.get('argument_contract',{}),profile.get('project_load_lanes',False)).build();break
    except Unsupported as error:
     message=str(error)
     if not message.startswith('unresolved callee closure '):raise
     callee=message.rsplit(' ',1)[-1];dependency_edges.setdefault(entry,set()).add(callee);compile_entry(callee)
   for field in l1['state']:
    if field['name']in profile.get('semantics',{}):field['semantic_type']=profile['semantics'][field['name']]
   for f in adapter['fields']:
    identity=next(f"{ref['cell']:08x}"for ref in adapter.get('object_references',[])if ref['name']==f['reference'])if f['owner']=='reference'else str(f.get('argument')or f.get('address')or 0);key=f['owner']+':'+identity+':'+str(f['offset'])
    if key in profile.get('field_annotations',{}):next(x for x in l1['state']if x['name']==f['name'])['semantic_type']=profile['field_annotations'][key]
   l1['limitations'].extend(profile.get('limitations',[]));validate(l1);compiled[entry]=(l1,adapter);return l1,adapter
  finally:active.pop()
 for profile in selected:
  t=time.perf_counter();row={'id':profile['id'],'role':profile['role'],'entry':profile['entry'],'outcome':'pending','input_signature':signatures[profile['id']],'attempt_count':prior_rows.get(profile['id'],{}).get('attempt_count',0)+1};destination=out/profile['id'];destination.mkdir()
  try:
   l1,adapter=compile_entry(profile['entry']);save(destination/'l1.json',l1);save(destination/'validation-adapter.json',adapter);(destination/'generated.c').write_text(lower(json.loads((destination/'l1.json').read_text())));(destination/'l0.json').write_bytes(pool[profile['entry']].read_bytes());prior=ROOT/'local/ir/packages'/profile['id'];reuse_started=time.perf_counter();result=None
   fixtures=causal_fixtures(ROOT/profile['causal_fixture'],adapter)if profile.get('causal_fixture')else None
   object_bytes=max([256]+[f['offset']+f['width']//8 for f in adapter['fields']if f['owner']in('entity','reference')])*max(1,len(adapter.get('object_references',[])));vectors=min(16384,max(1024,8388608//object_bytes))
   if(prior/'receipt.json').exists():
    old=json.loads((prior/'receipt.json').read_text())
    if reusable_native_proof(old,qualification_runtime_signature=qualification_runtime_signature,fixture_input_sha256=fixture_digest(fixtures),rom_sha256=sha(rom),harness_sha256=sha(ROOT/'tools/behavior_ir/oracle.c.in'),generated_c_sha256=sha(destination/'generated.c'),adapter_sha256=sha(destination/'validation-adapter.json'),parameter_grid=profile['role']=='progression',requested_vectors=vectors):
     result=dict(old,build_mode='reused-qualified-executable',cache='hit',reuse={'parent_receipt_sha256':sha(prior/'receipt.json'),'reason':'Identical generated C, original ROM, layout/ABI adapter and native oracle; semantic annotations only changed','new_native_calls':0},stages=[],wall_s=time.perf_counter()-reuse_started);result['artifacts']=dict(old['artifacts']);result['artifacts']['l1.json']={'sha256':sha(destination/'l1.json'),'bytes':(destination/'l1.json').stat().st_size};save(destination/'native-proof-parent.json',old)
   if result is None:
    result=qualify(destination,rom,vectors,profile['role']=='progression',fixtures)
   result['qualification_runtime_signature']=qualification_runtime_signature;save(destination/'receipt.json',result)
   if result['outcome']!='pass':raise Unsupported('native qualification failed: '+result.get('error','unknown'))
   meaning={f['name']:f['semantic_type']for f in l1['state']};ready=any(f['semantic_type']['quantity']!='unknown'for f in l1['state'])or bool(profile.get('public_collections'))
   manifest={'schema':'gameverse.executable-component/0.2','id':profile['id'],'version':'0.1.0','title':profile['title'],'source_game':game,'origin':'automatic_highfunction_lift','behavior':'l1.json','behavior_sha256':sha(destination/'l1.json'),'qualification':{'status':'pass','receipt':'receipt.json','vectors':result['parity']['vectors'],'scope':result['fixture_scope']},'effects':effects(l1),'field_meanings':meaning,'collection_meanings':profile.get('public_collections',{}),'owned_collections':l1['collections'],'lifecycle':{'storage':'component_or_entity_instance','clock':'explicit_invocation','phase':'selected_by_composition','ordering':'declared_graph_edges'},'gaps':l1['limitations']+['Input domains are explicit component preconditions; no unsupported alias/service is silently replaced'],'configurations':configurations(l1,adapter,raw,profile),'source_evidence':profile.get('source_evidence'),'mechanics_role':profile['role'],**readiness_fields(ready,True),'dependency_closure':'closed'}
   save(destination/'package.json',manifest);published=ROOT/'local/ir/packages'/profile['id'];published.mkdir(parents=True,exist_ok=True)
   import shutil
   for f in('l0.json','l1.json','validation-adapter.json','generated.c','receipt.json','package.json'):shutil.copy2(destination/f,published/f)
   row.update(readiness_fields(ready,True));row.update(outcome='native_qualified',dependency_closure='closed',vectors=result['parity']['vectors'],artifacts=str(destination.relative_to(ROOT)))
  except Exception as error:row.update(outcome='pending_dependency_or_compiler',reason=str(error));save(destination/'failure.json',row)
  finally:
   entries={profile['entry']};pending=[profile['entry']]
   while pending:
    for callee in dependency_edges.get(pending.pop(),set()):
     if callee not in entries:entries.add(callee);pending.append(callee)
   row['source_entries']=sorted(entries);row['input_signature']=input_signature(profile,compiler_signature,{entry:(sha(pool[entry])if entry in pool else None)for entry in entries},profile_inputs[profile['id']]);row['wall_s']=time.perf_counter()-t;rows.append(row);save(out/'progress.json',{'game':game,'rows':rows,'missing_l0':sorted(needed)})
 for r in rows:r.update(readiness_fields(r.get('typed_ports_ready',r.get('ports_ready',False)),r.get('source_dependency_closed',r.get('outcome')=='native_qualified'and r.get('dependency_closure')=='closed')))
 last_batch_rows=list(rows)
 for profile in profiles:
  if not any(r['id']==profile['id']for r in rows):rows.append(prior_rows.get(profile['id'],{'id':profile['id'],'role':profile['role'],'entry':profile['entry'],'outcome':'pending_causal_analysis'if profile.get('discovery_only')else'pending_unattempted','discovery_only':bool(profile.get('discovery_only'))}))
 for r in rows:r.update(readiness_fields(r.get('typed_ports_ready',r.get('ports_ready',False)),r.get('source_dependency_closed',r.get('outcome')=='native_qualified'and r.get('dependency_closure')=='closed')))
 report={'schema':'gameverse.ir.depth-status/0.3','game':game,'outcome':'continuation_required','wall_s':time.perf_counter()-started,'limits':{'max_targets':max_targets,'max_closure_functions':max_closure,'wall_s':wall_budget,'maximum_vectors_per_target':16384,'minimum_vectors_large_state':1024,'nominal_owned_byte_vector_budget':8388608},'discovery_cohort_functions':sum(bool(p.get('discovery_only'))for p in profiles),'counts':{'native_qualified':sum(r['outcome']=='native_qualified'for r in rows),'composable_ports_ready':sum(r.get('ports_ready',False)for r in rows),'typed_ports_ready':sum(r.get('typed_ports_ready',False)for r in rows),'source_dependency_closed':sum(r.get('source_dependency_closed',False)for r in rows),'mechanics_closure_ready':0},'missing_l0':sorted(needed|{e for e in json.loads(prior_path.read_text()).get('missing_l0',[])if e not in pool})if prior_path.exists()else sorted(needed),'selected_targets':[p['id']for p in selected],'unattempted_targets':[p['id']for p in profiles if prior_rows.get(p['id'],{}).get('outcome','pending_unattempted')=='pending_unattempted'and p not in selected],'rows':rows,'last_batch_rows':last_batch_rows,'continuation':'Publish newly usable packages/site catalog, qualify alternative compositions, then resolve pending closure/alias/service gaps and advance more ROMs.'};save(out/'summary.json',report);save(ROOT/'local/ir/depth-status'/(game+'.json'),report);export_catalog();return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('queue',type=Path);p.add_argument('game');p.add_argument('--max-targets',type=int,default=8);a=p.parse_args();r=work(a.queue,a.game,a.max_targets);print(json.dumps(r,indent=2))
