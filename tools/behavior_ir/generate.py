"""Real request -> package selection -> L2 -> clean ROM -> native qualification.
The UI calls this CLI and serves its persisted status/artifacts; no simulated output.
"""
from pathlib import Path
import argparse,copy,datetime,hashlib,json,re,time,traceback
from compose import build
from qualify_composition import run as qualify_route
ROOT=Path(__file__).resolve().parents[2]
SCHEMA='gameverse.ir.generation-request/0.1'
OPTIONS={
 'movement':[{'id':'movement.hybrid-sonic-mzm','label':'Zero Mission steering with Sonic gravity and integration','packages':['mzm.motion.accelerate','sonic.motion.gravity','sonic.motion.integrate'],'status':'available'},{'id':'movement.aria-mzm','label':'Aria accelerated integration with Zero Mission steering','packages':['aria.motion.integrate_x','aria.motion.integrate_y','mzm.motion.accelerate'],'status':'available'},{'id':'movement.mario-sma2-sonic-mzm','label':'Mario World signed subpixel movement with Sonic gravity and Zero Mission steering','packages':['sma-2-super-mario-world.motion.sma2_integrate_x','sma-2-super-mario-world.motion.sma2_integrate_y','sonic.motion.gravity','mzm.motion.accelerate'],'status':'available'}],
 'combat':[{'id':'combat.mzm-impact','label':'Zero Mission damage and enemy lethal lifecycle','packages':['mzm.combat.impact'],'status':'available'}],
 'progression':[{'id':'progression.mzm-equipment','label':'Zero Mission equipment ownership and event flags','packages':['mzm.progress.acquire'],'status':'available'},{'id':'progression.minish-skills','label':'Minish persistent inventory and derived sword skills','packages':['tmc.progress.inventory_write','tmc.progress.derive_skills'],'status':'available'}]}

for profile,label in [('mario','Mario source jump/gravity'),('peach','Peach source jump/finite-hover')]:
 OPTIONS['movement'].append({'id':'movement.sma1-'+profile+'-policies','label':label+' with Zero Mission steering and Sonic integration','packages':['sma.motion.sma1_jump_onset','sma.motion.sma1_gravity_hover','mzm.motion.accelerate','sonic.motion.integrate'],'status':'available'})

def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def package(name):return ROOT/'local/ir/packages'/name/'package.json'
def materialize(request):
 if request.get('schema')!=SCHEMA:raise ValueError('unsupported generation request schema')
 if set(request)-{'schema','request_id','title','selections','qualification','expected_catalog_sha256'}:raise ValueError('unknown generation request field')
 if not isinstance(request.get('request_id'),str)or not 1<=len(request['request_id'])<=128:raise ValueError('request_id must be1..128 characters')
 if 'expected_catalog_sha256'in request:
  actual=hashlib.sha256((ROOT/'ontology/executable-components/index.json').read_bytes()).hexdigest()
  if request['expected_catalog_sha256']!=actual:raise ValueError('catalog changed since this request was prepared')
 if not isinstance(request.get('qualification',{}).get('run',True),bool):raise ValueError('qualification.run must be boolean')
 selections=request.get('selections',{})
 if not isinstance(selections,dict)or set(selections)!={'movement','combat','progression'}:raise ValueError('selections must contain exactly movement,combat,progression')
 supported={role:{v['id']:v for v in values}for role,values in OPTIONS.items()}
 for role in supported:
  if selections.get(role)not in supported[role]:raise ValueError('unsupported '+role+' component selection')
  if supported[role][selections[role]]['status']!='available':raise ValueError('selected combination is awaiting semantic adapter qualification')
 plan=json.loads((ROOT/'research/automatic-ir/asterion-relay.composition.json').read_text())
 for c in plan['components'].values():c['package']=str((ROOT/'research/automatic-ir'/c['package']).resolve())
 if selections['movement']=='movement.aria-mzm':
  del plan['components']['gravity'];del plan['components']['integration']
  plan['state']['aria_accel_x']={'storage_type':'u32','semantic_type':{'quantity':'acceleration','unit':{'numerator':1,'denominator':65536},'frame':'world.x.right'}}
  plan['state']['aria_accel_y']={'storage_type':'u32','semantic_type':{'quantity':'acceleration','unit':{'numerator':1,'denominator':65536},'frame':'world.y.down'}}
  def bound(slot,minimum,maximum,shift):return {'slot':slot,'domain':{'signed_min':minimum,'signed_max':maximum},'quantization':{'rounding':'arithmetic_shift','shift':shift,'exactness_evidence':'Incoming scale and configured acceleration preserve divisibility before the explicit output shift'}}
  plan['components']['aria_x']={'package':str(package('aria.motion.integrate_x')),'bindings':{'field_0':bound('player_x',0,1080*256,8),'field_1':bound('player_vx',-104,104,11),'field_2':{'slot':'aria_accel_x'}}}
  plan['components']['aria_y']={'package':str(package('aria.motion.integrate_y')),'bindings':{'field_0':bound('player_y',-256*256,256*256,8),'field_1':bound('player_vy',-1536,2048,8),'field_2':{'slot':'aria_accel_y'}}}
  plan['initialize'].append({'op':'assign_slot','slot':'aria_accel_y','value':{'op':'const','type':'u32','value':12288}})
  def replace_motion(x):
   if isinstance(x,list):
    result=[]
    for v in x:
     if isinstance(v,dict)and v.get('op')=='invoke'and v.get('component')=='gravity':continue
     if isinstance(v,dict)and v.get('op')=='invoke'and v.get('component')=='integration':result.extend([{'op':'invoke','component':'aria_x','arguments':{'param_0':{'op':'const','type':'u32','value':0}}},{'op':'invoke','component':'aria_y','arguments':{'param_0':{'op':'const','type':'u32','value':524288}}}])
     else:result.append(replace_motion(v))
    return result
   if isinstance(x,dict):return{k:replace_motion(v)for k,v in x.items()}
   return x
  plan['update']=replace_motion(plan['update']);plan['constraints'].append('Aria32bit Q16 acceleration/integration uses sign extension before input scaling and explicitly ordered arithmetic output shifts; negative movement is qualified in the native scenario.')
 if selections['movement']=='movement.mario-sma2-sonic-mzm':
  del plan['components']['integration']
  def value(op,t,*args,**kw):return dict(op=op,type=t,args=list(args),**kw)
  def constant(v,t='u32'):return {'op':'const','type':t,'value':v}
  def slot(n,t):return {'op':'slot','name':n,'type':t}
  invokes=[];prepare=[];merge=[]
  for axis,frame,velocity_shift in [('x','world.x.right',1),('y','world.y.down',4)]:
   for suffix,t,q,den in [('pixel','u16','position',1),('fraction','u8','subpixel_remainder',256)]:
    name='sma2_'+axis+'_'+suffix;plan['state'][name]={'storage_type':t,'semantic_type':{'quantity':q,'unit':{'numerator':1,'denominator':den},'frame':frame}}
    source=slot('player_'+axis,'u32');part=value('shift_right','u32',source,constant(8))if suffix=='pixel'else source;prepare.append({'op':'assign_slot','slot':name,'value':value('extract',t,part,constant(0))})
   name='sma2_'+axis;plan['components'][name]={'package':str(package('sma-2-super-mario-world.motion.sma2_integrate_'+axis)),'bindings':{'field_0':{'slot':'player_v'+axis,'domain':{'signed_min':-1536 if axis=='y'else-104,'signed_max':2032 if axis=='y'else 104},'quantization':{'rounding':'arithmetic_shift','shift':velocity_shift,'exactness_evidence':'Explicit quantization before original signed-byte velocity integration; position fraction is preserved separately'}},'field_1':{'slot':'sma2_'+axis+'_pixel'},'field_2':{'slot':'sma2_'+axis+'_fraction'}}}
   invokes.append({'op':'invoke','component':name,'arguments':{}})
   pixel=value('sext','u32',slot('sma2_'+axis+'_pixel','u16'));fraction=value('zext','u32',slot('sma2_'+axis+'_fraction','u8'));merge.append({'op':'assign_slot','slot':'player_'+axis,'value':value('bit_or','u32',value('shift_left','u32',pixel,constant(8)),fraction)})
  clamp={'op':'if','condition':value('less_signed','u8',constant(2032,'u16'),slot('player_vy','u16')),'then':[{'op':'assign_slot','slot':'player_vy','value':constant(2032,'u16')}],'else':[]}
  def rewrite_mario(x):
   if isinstance(x,list):
    result=[]
    for v in x:
     if isinstance(v,dict)and v.get('op')=='invoke'and v.get('component')=='integration':result.extend([clamp]+prepare+invokes+merge)
     else:result.append(rewrite_mario(v))
    return result
   if isinstance(x,dict):return{k:rewrite_mario(v)for k,v in x.items()}
   return x
  plan['update']=rewrite_mario(plan['update']);plan['authorship']['recovered_behavior'].append('Mario World signed velocity/subpixel-carry pixel integration');plan['constraints'].append('Explicit L2 adapter splits and rejoins pixel/fraction storage, quantizes incoming velocity to1/16px and clamps downward speed to the signed-byte integration domain. Mario jump/gravity/control are not claimed; Sonic gravity and MZM steering remain selected.')
 if selections['movement']in('movement.sma1-mario-policies','movement.sma1-peach-policies'):
  def value(op,t,*args):return dict(op=op,type=t,args=list(args))
  def constant(v,t='u32'):return {'op':'const','type':t,'value':v}
  def slot(n,t):return {'op':'slot','name':n,'type':t}
  configuration='source_profile_1'if selections['movement']=='movement.sma1-peach-policies'else'source_profile_0'
  for name,t,q,frame in [('sma1_keys','u16','input','gba.buttons'),('sma1_frame','u8','counter','clock.invocation'),('sma1_hover','u8','counter','hover.invocations'),('sma1_airmode','u8','enum','player.air_mode'),('sma1_jump_request','u8','boolean','controls.jump_request')]:plan['state'][name]={'storage_type':t,'semantic_type':{'quantity':q,'unit':{'numerator':1,'denominator':1},'frame':frame}}
  def velocity(slot_name,minimum,maximum,shift):return {'slot':slot_name,'domain':{'signed_min':minimum,'signed_max':maximum},'quantization':{'rounding':'arithmetic_shift','shift':shift,'exactness_evidence':'SMA1 invocation velocity is1/1048576px; native profile onset/gravity steps preserve explicit scale divisibility'}}
  plan['components']['gravity']={'package':str(package('sma.motion.sma1_gravity_hover')),'configuration_id':configuration,'bindings':{'field_0':{'slot':'sma1_keys'},'field_1':{'slot':'sma1_frame'},'field_2':velocity('player_vy',-2048,8192,12),'field_3':{'slot':'sma1_airmode'},'field_4':{'slot':'sma1_hover'}}}
  plan['components']['sma1_jump']={'package':str(package('sma.motion.sma1_jump_onset')),'configuration_id':configuration,'bindings':{'field_0':velocity('player_vx',-104,104,15),'field_1':velocity('player_vy',-2048,8192,12),'field_3':{'slot':'sma1_airmode'},'field_4':{'slot':'sma1_hover'}}}
  prepare=[{'op':'assign_slot','slot':'sma1_keys','value':value('extract','u16',slot('keys','u32'),constant(0))},{'op':'assign_slot','slot':'sma1_frame','value':value('extract','u8',slot('ticks','u32'),constant(0))}]
  apply_jump={'op':'if','condition':slot('sma1_jump_request','u8'),'then':[{'op':'invoke','component':'sma1_jump','arguments':{}},{'op':'assign_slot','slot':'sma1_jump_request','value':constant(0,'u8')}],'else':[]}
  def rewrite_sma1(x):
   if isinstance(x,list):
    result=[]
    for v in x:
     if isinstance(v,dict)and v.get('op')=='assign_slot'and v.get('slot')=='player_vy'and v.get('value',{}).get('value')==64000:result.append({'op':'assign_slot','slot':'sma1_jump_request','value':constant(1,'u8')})
     elif isinstance(v,dict)and v.get('op')=='invoke'and v.get('component')=='gravity':result.extend(prepare+[v,apply_jump])
     else:result.append(rewrite_sma1(v))
    return result
   if isinstance(x,dict):return{k:rewrite_sma1(v)for k,v in x.items()}
   return x
  plan['update']=rewrite_sma1(plan['update']);plan['observations'].append('sma1_hover');plan['authorship']['recovered_behavior']+=['SMA1 complete local jump-onset and gravity/finite-hover policies plus observed source character profile data'];plan['constraints'].append('SMA1 gravity precedes jump-onset then integration. Grounded permission, air-mode0, crouch-charge0/no carried actor are explicit authored environment inputs; original full controller/contact/lifecycle is not claimed. Mario/Peach differ by extracted source configuration selection; no behavior C edits.')
 if selections['progression']=='progression.minish-skills':
  del plan['components']['acquisition']
  inventory_sem={'quantity':'packed_two_bit_inventory','unit':{'numerator':1,'denominator':1},'frame':'campaign'}
  plan['state']['learned_inventory']={'storage_type':'u8','count':64,'semantic_type':inventory_sem}
  plan['state']['ability_mask']={'storage_type':'u16','semantic_type':{'quantity':'bitset','unit':{'numerator':1,'denominator':1},'frame':'abilities.derived'}}
  plan['components']['learning']={'package':str(package('tmc.progress.inventory_write')),'bindings':{},'collection_bindings':{'collection_0':'learned_inventory'}}
  plan['components']['skill_refresh']={'package':str(package('tmc.progress.derive_skills')),'bindings':{'field_0':{'slot':'ability_mask'}},'collection_bindings':{'dependency_0_collection_0':'learned_inventory'}}
  def rewrite(x):
   if isinstance(x,list):
    result=[]
    for v in x:
     if isinstance(v,dict)and v.get('op')=='invoke'and v.get('component')=='acquisition':
      result.extend([{'op':'invoke','component':'learning','arguments':{'param_0':{'op':'const','type':'u32','value':72},'param_1':{'op':'const','type':'u32','value':1}}},{'op':'invoke','component':'skill_refresh','arguments':{}}])
     else:result.append(rewrite(v))
    return result
   if not isinstance(x,dict):return x
   result={k:rewrite(v)for k,v in x.items()}
   if result.get('op')=='slot'and result.get('name')=='ability_mask':result['type']='u16'
   return result
  plan['update']=rewrite(plan['update']);plan['authorship']['recovered_behavior']=[v for v in plan['authorship']['recovered_behavior']if'equipment acquisition'not in v]+['Minish packed inventory mutation and derived skill refresh'];plan['constraints'].append('Persistent inventory state exactly1 enables derived skill bits; other packed states are not learned. World-route consumption is authored IR, not original Minish campaign logic.')
 title=request.get('title','ASTERION IR')
 if not isinstance(title,str)or not re.fullmatch('[A-Za-z0-9 _-]{1,12}',title):raise ValueError('title must be1..12 simple ASCII characters')
 plan['title']=title;plan['request_selections']=selections;return plan

def generate(request_path,out):
 started=time.perf_counter();out.mkdir(parents=True,exist_ok=False);request=json.loads(request_path.read_text());save(out/'request.json',request);status={'schema':'gameverse.ir.generation-result/0.1','request_id':request.get('request_id'),'state':'running','phase':'resolve','started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'request_sha256':hashlib.sha256(request_path.read_bytes()).hexdigest(),'stages':[],'artifacts':{},'authorship_notice':'Recovered L1 mechanics composed with explicitly authored world, input, projectile, gate and rendering IR; thin hardware runtime.'};save(out/'status.json',status)
 try:
  t=time.perf_counter();plan=materialize(request);save(out/'resolved.composition.json',plan);status['stages'].append({'phase':'resolve','outcome':'pass','wall_s':time.perf_counter()-t});status['phase']='build';save(out/'status.json',status)
  result=build(out/'resolved.composition.json',out/'build');status['build']=result;status['artifacts'].update(rom=str(out/'build/game.gba'),rom_sha256=result['rom_sha256'],build_receipt=str(out/'build/build-receipt.json'),composition=str(out/'resolved.composition.json'));status['stages'].append({'phase':'build','outcome':result['outcome'],'wall_s':result['wall_s']});status['phase']='qualify';save(out/'status.json',status)
  if request.get('qualification',{}).get('run',True):
   route=qualify_route(out/'build',out/'native',probe_negative=request.get('selections',{}).get('movement')in('movement.aria-mzm','movement.mario-sma2-sonic-mzm'));status['qualification']={'outcome':route['outcome'],'receipt':str(out/'native/route-receipt.json'),'wall_s':route['wall_s'],'final':route.get('final'),'error':route.get('error')};status['stages'].append({'phase':'qualify','outcome':route['outcome'],'wall_s':route['wall_s']});status['artifacts']['screenshots']=[x['image']for x in route.get('checkpoints',{}).values()];status['artifacts']['video']=route.get('video',{}).get('path')
   if route['outcome']!='pass':raise ValueError('native connected-route qualification failed: '+route.get('error','missing proof'))
  else:status['qualification']={'outcome':'not_requested','notice':'Built artifact is not automatically promoted as gameplay-qualified.'}
  status.update(state='completed',phase='complete',outcome='pass')
 except Exception as error:status.update(state='failed',phase=status['phase'],outcome='failed',diagnostic=str(error));(out/'failure.txt').write_text(traceback.format_exc())
 finally:status['wall_s']=time.perf_counter()-started;save(out/'status.json',status)
 return status
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--request',type=Path);p.add_argument('--out',type=Path);p.add_argument('--options',action='store_true');a=p.parse_args()
 if a.options:print(json.dumps({'schema':'gameverse.ir.generation-options/0.1','roles':OPTIONS},indent=2))
 else:
  if not a.request or not a.out:p.error('--request and --out are required')
  result=generate(a.request.resolve(),a.out.resolve());print(json.dumps(result,indent=2));raise SystemExit(result['state']=='failed')
