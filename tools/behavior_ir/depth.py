"""Prioritized mechanics closure -> bounded native qualification -> publication.
Failures stay pending with machine-readable missing dependencies and categories.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,time,traceback
from lift import Lifter,Unsupported
from lower import lower
from contract import validate
from qualify import qualify
from publish import effects
from catalog import export_catalog
from seeds import discover
from configuration import configurations
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

def work(queue_path,game,max_targets=8,max_closure=32,wall_budget=120,only_entries=None):
 queue=json.loads(queue_path.read_text());prior_path=ROOT/'local/ir/depth-status'/(game+'.json');prior_rows={r['id']:r for r in json.loads(prior_path.read_text()).get('rows',[])}if prior_path.exists()else{};item=next(i for i in queue['items']if i['id']==game);started=time.perf_counter();profiles=PROFILES.get(game,[]);pool={};compiled={};active=[];rows=[];needed=set();exports=[]
 for attempt in item['attempts']:
  if attempt.get('artifacts'):exports.append(ROOT/attempt['artifacts']/'l0')
 for path in exports:
  for p in path.glob('0*.json'):pool[p.stem]=p
 if not profiles:profiles=discover(game,ROOT/item['rom'])
 out=ROOT/'local/ir/depth-runs'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')/game;out.mkdir(parents=True,exist_ok=False);rom=ROOT/item['rom'];raw=rom.read_bytes();profile_by_entry={p['entry']:p for p in profiles}
 compiler_signature={p:sha(ROOT/'tools/behavior_ir'/p)for p in('lift.py','inline.py','lower.py','contract.py','qualify.py','oracle.c.in')}
 signatures={p['id']:hashlib.sha256(json.dumps({'profile':p,'compiler':compiler_signature,'exports':[str(e)for e in exports]},sort_keys=True).encode()).hexdigest()for p in profiles}
 def target_rank(p):
  old=prior_rows.get(p['id'],{})
  if not old or old.get('outcome')=='pending_unattempted':return 0
  if old.get('input_signature')!=signatures[p['id']]:return 1 if old.get('outcome')!='native_qualified'else 2
  return 3
 selected=sorted([p for p in profiles if target_rank(p)<3 and(only_entries is None or p['entry']in only_entries)],key=target_rank)[:max_targets]
 def compile_entry(entry):
  if entry in compiled:return compiled[entry]
  if time.perf_counter()-started>wall_budget:raise Unsupported('depth wall budget')
  if entry in active:raise Unsupported('recursive dependency closure')
  if len(compiled)+len(active)>=max_closure:raise Unsupported('dependency closure function budget')
  if entry not in pool:needed.add(entry);raise Unsupported('missing L0 dependency '+entry)
  active.append(entry);profile=profile_by_entry.get(entry,{})
  try:
   while True:
    try:l1,adapter=Lifter(json.loads(pool[entry].read_text()),raw,compiled,profile.get('domains',{}),profile.get('object_contract',{}),profile.get('state_domains',{})).build();break
    except Unsupported as error:
     message=str(error)
     if not message.startswith('unresolved callee closure '):raise
     callee=message.rsplit(' ',1)[-1];compile_entry(callee)
   for field in l1['state']:
    if field['name']in profile.get('semantics',{}):field['semantic_type']=profile['semantics'][field['name']]
   for f in adapter['fields']:
    identity=next(f"{ref['cell']:08x}"for ref in adapter.get('object_references',[])if ref['name']==f['reference'])if f['owner']=='reference'else str(f.get('argument')or f.get('address')or 0);key=f['owner']+':'+identity+':'+str(f['offset'])
    if key in profile.get('field_annotations',{}):next(x for x in l1['state']if x['name']==f['name'])['semantic_type']=profile['field_annotations'][key]
   validate(l1);compiled[entry]=(l1,adapter);return l1,adapter
  finally:active.pop()
 for profile in selected:
  t=time.perf_counter();row={'id':profile['id'],'role':profile['role'],'entry':profile['entry'],'outcome':'pending','input_signature':signatures[profile['id']],'attempt_count':prior_rows.get(profile['id'],{}).get('attempt_count',0)+1};destination=out/profile['id'];destination.mkdir()
  try:
   l1,adapter=compile_entry(profile['entry']);save(destination/'l1.json',l1);save(destination/'validation-adapter.json',adapter);(destination/'generated.c').write_text(lower(json.loads((destination/'l1.json').read_text())));(destination/'l0.json').write_bytes(pool[profile['entry']].read_bytes());prior=ROOT/'local/ir/packages'/profile['id'];reuse_started=time.perf_counter();result=None
   if(prior/'receipt.json').exists():
    old=json.loads((prior/'receipt.json').read_text())
    if old.get('outcome')=='pass'and old.get('rom_sha256')==sha(rom)and old.get('harness_sha256')==sha(ROOT/'tools/behavior_ir/oracle.c.in')and old['artifacts']['generated.c']['sha256']==sha(destination/'generated.c')and old['artifacts']['validation-adapter.json']['sha256']==sha(destination/'validation-adapter.json'):
     result=dict(old,build_mode='reused-qualified-executable',cache='hit',reuse={'parent_receipt_sha256':sha(prior/'receipt.json'),'reason':'Identical generated C, original ROM, layout/ABI adapter and native oracle; semantic annotations only changed','new_native_calls':0},stages=[],wall_s=time.perf_counter()-reuse_started);result['artifacts']=dict(old['artifacts']);result['artifacts']['l1.json']={'sha256':sha(destination/'l1.json'),'bytes':(destination/'l1.json').stat().st_size};save(destination/'native-proof-parent.json',old);save(destination/'receipt.json',result)
   if result is None:
    object_bytes=max([256]+[f['offset']+f['width']//8 for f in adapter['fields']if f['owner']in('entity','reference')])*max(1,len(adapter.get('object_references',[])));vectors=min(16384,max(1024,8388608//object_bytes));result=qualify(destination,rom,vectors,profile['role']=='progression')
   if result['outcome']!='pass':raise Unsupported('native qualification failed: '+result.get('error','unknown'))
   meaning={f['name']:f['semantic_type']for f in l1['state']};ready=any(f['semantic_type']['quantity']!='unknown'for f in l1['state'])or bool(profile.get('public_collections'))
   manifest={'schema':'gameverse.executable-component/0.2','id':profile['id'],'version':'0.1.0','title':profile['title'],'source_game':game,'origin':'automatic_highfunction_lift','behavior':'l1.json','behavior_sha256':sha(destination/'l1.json'),'qualification':{'status':'pass','receipt':'receipt.json','vectors':result['parity']['vectors'],'scope':result['fixture_scope']},'effects':effects(l1),'field_meanings':meaning,'collection_meanings':profile.get('public_collections',{}),'owned_collections':l1['collections'],'lifecycle':{'storage':'component_or_entity_instance','clock':'explicit_invocation','phase':'selected_by_composition','ordering':'declared_graph_edges'},'gaps':l1['limitations']+['Input domains are explicit component preconditions; no unsupported alias/service is silently replaced'],'configurations':configurations(l1,adapter,raw,profile),'source_evidence':profile.get('source_evidence'),'mechanics_role':profile['role'],'ports_ready':ready,'closure_ready':ready,'dependency_closure':'closed'}
   save(destination/'package.json',manifest);published=ROOT/'local/ir/packages'/profile['id'];published.mkdir(parents=True,exist_ok=True)
   import shutil
   for f in('l0.json','l1.json','validation-adapter.json','generated.c','receipt.json','package.json'):shutil.copy2(destination/f,published/f)
   row.update(outcome='native_qualified',ports_ready=ready,closure_ready=ready,dependency_closure='closed',vectors=result['parity']['vectors'],artifacts=str(destination.relative_to(ROOT)))
  except Exception as error:row.update(outcome='pending_dependency_or_compiler',reason=str(error));save(destination/'failure.json',row)
  finally:row['wall_s']=time.perf_counter()-t;rows.append(row);save(out/'progress.json',{'game':game,'rows':rows,'missing_l0':sorted(needed)})
 for r in rows:r['closure_ready']=bool(r.get('ports_ready'))
 last_batch_rows=list(rows)
 for profile in profiles:
  if not any(r['id']==profile['id']for r in rows):rows.append(prior_rows.get(profile['id'],{'id':profile['id'],'role':profile['role'],'entry':profile['entry'],'outcome':'pending_unattempted'}))
 for r in rows:r['closure_ready']=bool(r.get('ports_ready'))
 report={'schema':'gameverse.ir.depth-status/0.3','game':game,'outcome':'continuation_required','wall_s':time.perf_counter()-started,'limits':{'max_targets':max_targets,'max_closure_functions':max_closure,'wall_s':wall_budget,'maximum_vectors_per_target':16384,'minimum_vectors_large_state':1024,'nominal_owned_byte_vector_budget':8388608},'counts':{'native_qualified':sum(r['outcome']=='native_qualified'for r in rows),'composable_ports_ready':sum(r.get('ports_ready',False)for r in rows),'mechanics_closure_ready':sum(r.get('closure_ready',False)for r in rows)},'missing_l0':sorted(needed|{e for e in json.loads(prior_path.read_text()).get('missing_l0',[])if e not in pool})if prior_path.exists()else sorted(needed),'selected_targets':[p['id']for p in selected],'unattempted_targets':[p['id']for p in profiles if prior_rows.get(p['id'],{}).get('outcome','pending_unattempted')=='pending_unattempted'and p not in selected],'rows':rows,'last_batch_rows':last_batch_rows,'continuation':'Publish newly usable packages/site catalog, qualify alternative compositions, then resolve pending closure/alias/service gaps and advance more ROMs.'};save(out/'summary.json',report);save(ROOT/'local/ir/depth-status'/(game+'.json'),report);export_catalog();return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('queue',type=Path);p.add_argument('game');p.add_argument('--max-targets',type=int,default=8);a=p.parse_args();r=work(a.queue,a.game,a.max_targets);print(json.dumps(r,indent=2))
