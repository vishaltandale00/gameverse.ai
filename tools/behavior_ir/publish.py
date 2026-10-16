"""Publish symbolic, qualified artifacts and executable ontology from L0 inputs.
Entry identifiers below belong to internal L0 selection, never a composition.
"""
from pathlib import Path
import json,hashlib,shutil,time
from lift import Lifter
from lower import lower
from qualify import qualify
ROOT=Path(__file__).resolve().parents[2]
RUN=ROOT/'local/re/experiments/automatic-ir-m1-01'
OUT=ROOT/'local/ir/packages'
def meaning(quantity,den=1,frame='world',num=1):return {'quantity':quantity,'unit':{'numerator':num,'denominator':den},'frame':frame,'confidence':0.85,'evidence':['own_rom_state_usage_and_existing_motion_unit_review'],'naming_status':'analysis_annotation_not_a_behavior_input'}
DEFS=[
 ('sonic.motion.integrate','080470b4','sonic-advance','Integrate signed motion',{'field_0':meaning('position',256,'world.x.right'),'field_1':meaning('position',256,'world.y.down'),'field_2':meaning('velocity',256,'world.x.right'),'field_3':meaning('velocity',256,'world.y.down'),'field_4':meaning('bitset',1,'stage'),'field_5':meaning('bitset',1,'stage')}),
 ('sonic.motion.gravity','08047100','sonic-advance','Context-dependent acceleration',{'field_0':meaning('velocity',256,'world.y.down'),'field_1':meaning('bitset',1,'actor')}),
 ('sonic.motion.surface_projection','08047078','sonic-advance','Ground momentum projected through a surface',{}),
 ('sonic.motion.slope_acceleration','08046f78','sonic-advance','Gravity along attached slopes',{}),
 ('sonic.motion.surface_detach','080471a0','sonic-advance','Low-speed steep-surface release',{}),
 ('mzm.motion.accelerate','mzm/08008278','metroid-zero-mission','Directional acceleration with signed saturation',{'field_0':meaning('bitset',1,'controls'),'field_1':meaning('velocity',32,'world.x.right')}),
 ('mzm.combat.impact','mzm/08050424','metroid-zero-mission','Damage, lethal transition and reaction state',{'field_0':meaning('energy',1,'enemy'),'field_2':meaning('pose',1,'enemy'),'field_7':meaning('bitset',1,'enemy'),'field_8':meaning('counter',1,'world')}),
 ('mzm.progress.events','mzm/080608bc','metroid-zero-mission','Persistent event query and mutation',{}),
 ('mzm.progress.acquire','mzm/080138d8','metroid-zero-mission','Acquire equipment and campaign event flags',{'field_0':meaning('bitset',1,'weapons.owned'),'field_1':meaning('bitset',1,'abilities.owned')})]
def effects(x):
 reads=set();writes=set()
 def visit(z):
  if isinstance(z,list):
   for y in z:visit(y)
  elif isinstance(z,dict):
   if z.get('op')=='field':reads.add(z['name'])
   if z.get('op')=='assign_field':writes.add(z['field'])
   for y in z.values():visit(y)
 visit(x['body']);return {'reads':sorted(reads),'writes':sorted(writes)}
def publish():
 OUT.mkdir(parents=True,exist_ok=True);dependencies={};reports=[]
 for name,entry,game,title,meanings in DEFS:
  start=time.perf_counter();rom=ROOT/'local/roms'/('Sonic Advance (USA) (En,Ja).gba'if game=='sonic-advance'else'Metroid - Zero Mission (USA).gba');l0=json.loads((RUN/(entry+'.json')).read_text());x,a=Lifter(l0,rom.read_bytes(),dependencies).build();destination=OUT/name;destination.mkdir(exist_ok=True)
  # Attach descriptive/evidential type annotations without altering expression behavior.
  for f in x['state']:
   if f['name']in meanings:f['semantic_type']=meanings[f['name']]
  (destination/'l0.json').write_text(json.dumps(l0,indent=2)+'\n');(destination/'l1.json').write_text(json.dumps(x,indent=2)+'\n');(destination/'validation-adapter.json').write_text(json.dumps(a,indent=2)+'\n');(destination/'generated.c').write_text(lower(json.loads((destination/'l1.json').read_text())))
  depsentry=entry.rsplit('/',1)[-1];dependencies[depsentry]=(x,a)
  if(destination/'receipt.json').exists():shutil.copy2(destination/'receipt.json',destination/('receipt-prior-'+str(time.time_ns())+'.json'))
  result=qualify(destination,rom,65536 if name.endswith('events')else 4096 if name.endswith('acquire')else 16384,name.endswith(('events','acquire')))
  manifest={'schema':'gameverse.executable-component/0.2','id':name,'version':'0.1.0','title':title,'source_game':game,'origin':'automatic_highfunction_lift','behavior':'l1.json','behavior_sha256':hashlib.sha256((destination/'l1.json').read_bytes()).hexdigest(),'qualification':{'status':result['outcome'],'receipt':'receipt.json','vectors':result.get('parity',{}).get('vectors'),'scope':result['fixture_scope']},'effects':effects(x),'field_meanings':{f['name']:f['semantic_type']for f in x['state']},'owned_collections':x.get('collections',[]),'lifecycle':{'storage':'component_or_entity_instance','clock':'explicit_invocation','phase':'selected_by_composition','ordering':'declared_graph_edges'},'gaps':x['limitations']+(['Semantic annotation has not been independently scored against game rendering']if meanings else[])}
  (destination/'package.json').write_text(json.dumps(manifest,indent=2)+'\n');reports.append({'id':name,'outcome':result['outcome'],'wall_s':time.perf_counter()-start,'receipt':str(destination/'receipt.json')})
  print(name,result['outcome'],result.get('parity'),flush=True)
  if result['outcome']!='pass':raise RuntimeError(result.get('error'))
 (RUN/'published.json').write_text(json.dumps(reports,indent=2)+'\n')
 return reports
if __name__=='__main__':publish()
