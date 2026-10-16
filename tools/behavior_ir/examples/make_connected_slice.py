"""Author world/glue as inspectable L2 JSON, not replacement recovered C."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
def C(v,t='u32'):return {'op':'const','type':t,'value':v&((1<<int(t[1:]))-1)}
def S(n,t='u32',i=None):
 x={'op':'slot','type':t,'name':n}
 if i is not None:x['index']=i
 return x
def E(op,*args,t='u32'):return {'op':op,'type':t,'args':list(args)}
def A(n,e,i=None):
 x={'op':'assign_slot','slot':n,'value':e}
 if i is not None:x['index']=i
 return x
def IF(c,yes,no=()):return {'op':'if','condition':c,'then':list(yes),'else':list(no)}
def effect(service,args,result=None):
 x={'op':'effect','service':service,'arguments':args}
 if result:x['result']={'slot':result}
 return x
def call(component,args=None,instance=None,result=None):
 x={'op':'invoke','component':component,'arguments':args or{}}
 if instance is not None:x['instance']=instance
 if result:x['result']={'slot':result}
 return x
def add(a,b):return E('add_wrap',a,b)
def sub(a,b):return E('sub_wrap',a,b)
def AND(a,b):return E('bit_and',a,b)
def eq(a,b):return E('equal',a,b,t='u8')
def ne(a,b):return E('not_equal',a,b,t='u8')
def lt(a,b):return E('less_signed',a,b,t='u8')
def both(a,b):return E('bool_and',a,b,t='u8')
def nonzero(a):return ne(a,C(0,a['type']))
def world(n):return E('shift_arithmetic',S(n),C(8))
def rect(x,y,w,h,color):return effect('rect',[x,y,C(w)if isinstance(w,int)else w,C(h)if isinstance(h,int)else h,C(color)if isinstance(color,int)else color])
def sem(q,den=1,frame='world'):return {'quantity':q,'unit':{'numerator':1,'denominator':den},'frame':frame}
state={}
def slot(n,t='u32',q='counter',den=1,frame='world',count=None):
 state[n]={'storage_type':t,'semantic_type':sem(q,den,frame)}
 if count:state[n]['count']=count
for n in ['ticks','keys','previous_keys','pressed','grounded','floor','previous_bottom','camera','bullet_active','bullet_x','bullet_y','bullet_dir','bullet_life','bullet_cooldown','shot_count','kills','last_kill','pickup_taken','gate_open','won','player_iframes','enemy_touch','player_death','render_color']:
 slot(n)
slot('player_x','u32','position',256,'world.x.right');slot('player_y','u32','position',256,'world.y.down');slot('player_vx','u16','velocity',32,'world.x.right');slot('player_vy','u16','velocity',256,'world.y.down')
slot('direction','u16','bitset',1,'controls');slot('facing','u32');slot('actor_flags','u32','bitset',1,'actor');slot('stage_flags','u16','bitset',1,'stage');slot('previous_stage_flags','u16','bitset',1,'stage')
slot('ability_mask','u8','bitset',1,'abilities.owned');slot('weapon_mask','u8','bitset',1,'weapons.owned');slot('player_hp','u16','energy',1,'enemy');slot('world_alert','u8','counter',1,'world')
slot('enemy_x','u32',count=3);slot('enemy_y','u32',count=3);slot('enemy_hp','u16','energy',1,'enemy',3);slot('enemy_pose','u8','pose',1,'enemy',3);slot('enemy_flags','u8','bitset',1,'enemy',3)
idx={'op':'index','name':'enemy','type':'u32'}
def bind(slot,index=None):
 r={'slot':slot}
 if index is not None:r['index']=index
 return r
components={
 'steering':{'package':'../../local/ir/packages/mzm.motion.accelerate/package.json','bindings':{'field_0':bind('direction'),'field_1':bind('player_vx')}},
 'gravity':{'package':'../../local/ir/packages/sonic.motion.gravity/package.json','bindings':{'field_0':bind('player_vy'),'field_1':bind('actor_flags')}},
 'integration':{'package':'../../local/ir/packages/sonic.motion.integrate/package.json','bindings':{'field_0':bind('player_x'),'field_1':bind('player_y'),'field_2':dict(bind('player_vx'),domain={'signed_min':-104,'signed_max':104,'evidence':'Configured acceleration6 and cap104 from zero; plus/minus6 cannot wrap before signed clamp'}),'field_3':bind('player_vy'),'field_4':bind('stage_flags'),'field_5':bind('previous_stage_flags')}},
 'impact':{'package':'../../local/ir/packages/mzm.combat.impact/package.json','instances':3,'bindings':{'field_0':bind('enemy_hp',idx),'field_2':bind('enemy_pose',idx),'field_7':bind('enemy_flags',idx),'field_8':bind('world_alert')}},
 'hurt':{'package':'../../local/ir/packages/mzm.combat.impact/package.json','bindings':{'field_0':bind('player_hp'),'field_8':bind('world_alert')}},
 'acquisition':{'package':'../../local/ir/packages/mzm.progress.acquire/package.json','bindings':{'field_0':bind('weapon_mask'),'field_1':bind('ability_mask')}}}
initialize=[A('player_x',C(24*256)),A('player_y',C(128*256)),A('player_hp',C(12,'u16')),A('grounded',C(1)),A('facing',C(1)),A('direction',C(16,'u16'))]
for i,(x,hp)in enumerate([(264,6),(440,8),(574,10)]):initialize +=[A('enemy_x',C(x),C(i)),A('enemy_y',C(128),C(i)),A('enemy_hp',C(hp,'u16'),C(i))]
update=[A('ticks',add(S('ticks'),C(1))),effect('input_keys',[],'keys'),A('pressed',AND(S('keys'),E('bit_not',S('previous_keys')))),A('previous_keys',S('keys')),IF(nonzero(S('bullet_cooldown')),[A('bullet_cooldown',sub(S('bullet_cooldown'),C(1)))]),IF(nonzero(S('player_iframes')),[A('player_iframes',sub(S('player_iframes'),C(1)))])]
move=[A('previous_bottom',world('player_y')),IF(nonzero(AND(S('keys'),C(16))),[A('direction',C(16,'u16')),A('facing',C(1)),call('steering',{'param_0':C(6,'u16'),'param_1':C(104,'u16')})], [IF(nonzero(AND(S('keys'),C(32))),[A('direction',C(0,'u16')),A('facing',C(0xffffffff)),call('steering',{'param_0':C(6,'u16'),'param_1':C(104,'u16')})],[A('player_vx',C(0,'u16'))])]),IF(both(nonzero(AND(S('pressed'),C(1))),nonzero(S('grounded'))),[A('player_vy',C(-1536,'u16')),A('grounded',C(0))]),call('gravity'),call('integration'),effect('floor_query',[world('player_x'),S('previous_bottom'),world('player_y')],'floor'),IF(ne(S('floor'),C(0x7fffffff)),[A('player_y',E('shift_left',S('floor'),C(8))),A('player_vy',C(0,'u16')),A('grounded',C(1))],[A('grounded',C(0))]),IF(lt(world('player_x'),C(8)),[A('player_x',C(8*256))])]
shoot=[IF(both(nonzero(AND(S('keys'),C(2))),both(eq(S('bullet_active'),C(0)),eq(S('bullet_cooldown'),C(0)))),[A('bullet_active',C(1)),A('bullet_x',add(world('player_x'),E('mul_wrap',S('facing'),C(9)))),A('bullet_y',sub(world('player_y'),C(8))),A('bullet_dir',S('facing')),A('bullet_life',C(32)),A('bullet_cooldown',C(12)),A('shot_count',add(S('shot_count'),C(1)))]),IF(nonzero(S('bullet_active')),[A('bullet_x',add(S('bullet_x'),E('mul_wrap',S('bullet_dir'),C(7)))),A('bullet_life',sub(S('bullet_life'),C(1))),IF(eq(S('bullet_life'),C(0)),[A('bullet_active',C(0))])])]
ex=S('enemy_x',i=idx);ey=S('enemy_y',i=idx);eh=S('enemy_hp','u16',idx)
near=lambda a,b,d:both(lt(sub(a,b),C(d)),lt(sub(b,a),C(d)))
hit_condition = both(nonzero(S('bullet_active')), both(near(S('bullet_x'), ex, 10), near(S('bullet_y'), sub(ey,C(8)),12)))
touch_condition = both(eq(S('player_iframes'),C(0)), both(near(world('player_x'),ex,12),near(world('player_y'),ey,16)))
enemy_body = [
 IF(nonzero(eh), [IF(hit_condition, [
  call('impact', {'param_0':C(2,'u16')}, idx, 'last_kill'),
  A('bullet_active',C(0)),
  IF(nonzero(S('last_kill')), [A('kills',add(S('kills'),C(1)))])
 ])]),
 IF(nonzero(eh), [IF(touch_condition, [
  call('hurt', {'param_0':C(2,'u16')}, result='player_death'),
  A('player_iframes',C(50)),
  IF(nonzero(S('player_death')), [A('player_x',C(24*256)),A('player_y',C(128*256)),A('player_hp',C(12,'u16'))])
 ])])
]
pickup_condition = both(eq(S('pickup_taken'), C(0)), both(eq(S('enemy_hp','u16',C(2)),C(0,'u16')), both(near(world('player_x'),C(610),15),near(world('player_y'),C(98),20))))
progress = [
 IF(pickup_condition, [call('acquisition',{'param_0':C(0x2d,'u8')}),A('pickup_taken',C(1))]),
 A('gate_open',E('zext',AND(S('ability_mask','u8'),C(1,'u8')),t='u32')),
 IF(both(eq(S('gate_open'),C(0)),lt(C(806),world('player_x'))), [A('player_x',C(806*256)),A('player_vx',C(0,'u16'))]),
 IF(both(nonzero(S('gate_open')),lt(C(1000),world('player_x'))), [A('won',C(1))])
]
update +=[IF(eq(S('won'),C(0)),move+shoot+[{'op':'repeat','index':'enemy','count':3,'body':enemy_body}]+progress),A('camera',C(0)),IF(lt(C(105),world('player_x')),[A('camera',sub(world('player_x'),C(105)))]),IF(lt(C(840),S('camera')),[A('camera',C(840))])]
# Rendering is another declarative phase: the runtime only supplies primitives.
screenx=lambda x:sub(x,S('camera'))
render=[effect('clear',[C(1)]),rect(C(0),C(54),240,65,2),rect(C(0),C(94),240,34,3)]
for x,w,h in[(30,42,55),(120,64,70),(260,25,42),(350,75,60),(480,50,74),(620,70,49),(760,52,68),(900,68,54),(1020,40,76)]:
 render +=[rect(sub(C(x),E('shift_right',S('camera'),C(1))),C(128-h),w,h,10)]
terrain=[[0,128,1080,32],[155,103,42,8],[355,92,48,8],[590,106,44,8],[880,101,52,8]]
for x,y,w,h in terrain:render +=[rect(screenx(C(x)),C(y),w,h,4),rect(screenx(C(x)),C(y),w,2,13)]
render +=[IF(eq(S('gate_open'),C(0)),[rect(screenx(C(816)),C(66),8,62,8),rect(screenx(C(814)),C(64),12,3,7)],[rect(screenx(C(816)),C(120),8,8,5)]),rect(screenx(C(1010)),C(82),20,46,5),rect(screenx(C(1013)),C(85),14,43,2),IF(both(eq(S('pickup_taken'),C(0)),eq(S('enemy_hp','u16',C(2)),C(0,'u16'))),[rect(screenx(C(606)),C(94),9,9,7),rect(screenx(C(609)),C(91),3,15,12)])]
render +=[{'op':'repeat','index':'enemy','count':3,'body':[IF(nonzero(eh),[rect(screenx(sub(ex,C(7))),sub(ey,C(13)),14,13,9),rect(screenx(sub(ex,C(9))),sub(ey,C(9)),18,6,8),rect(screenx(sub(ex,C(5))),sub(ey,C(11)),3,2,12),rect(screenx(add(ex,C(2))),sub(ey,C(11)),3,2,12),rect(screenx(sub(ex,C(7))),sub(ey,C(18)),E('mul_wrap',E('zext',eh,t='u32'),C(2)),2,7)])]}]
render +=[IF(nonzero(S('bullet_active')),[rect(screenx(sub(S('bullet_x'),C(4))),S('bullet_y'),9,2,12)]),A('render_color',C(5)),IF(nonzero(S('player_iframes')),[A('render_color',C(8))]),rect(screenx(sub(world('player_x'),C(4))),sub(world('player_y'),C(13)),8,13,S('render_color')),rect(screenx(sub(world('player_x'),C(3))),sub(world('player_y'),C(15)),7,6,7),rect(screenx(world('player_x')),sub(world('player_y'),C(13)),4,2,12),rect(screenx(add(world('player_x'),E('mul_wrap',S('facing'),C(5)))),sub(world('player_y'),C(9)),5,3,6),rect(C(0),C(0),240,27,0),effect('text',[C(8),C(6),'ASTERION RELAY',C(12)]),effect('text',[C(8),C(17),'ENERGY',C(13)]),effect('number',[C(36),C(17),E('zext',S('player_hp','u16'),t='u32'),C(7)]),effect('text',[C(74),C(17),'WARDENS',C(13)]),effect('number',[C(108),C(17),S('kills'),C(7)]),IF(nonzero(S('gate_open')),[effect('text',[C(142),C(17),'RELAY ONLINE',C(5)])],[effect('text',[C(142),C(17),'SEEK THE CORE',C(7)])]),rect(C(0),C(150),240,10,0),effect('text',[C(8),C(153),'A JUMP   B BEAM   ARROWS MOVE',C(13)]),IF(nonzero(S('won')),[rect(C(34),C(54),172,44,0),rect(C(36),C(56),168,40,3),effect('text',[C(62),C(65),'RELAY RESTORED',C(12)]),effect('text',[C(51),C(80),'THE PATH IS OPEN AGAIN',C(5)])])]
p={'schema':'gameverse.l2.composition/0.2','id':'asterion-relay','title':'ASTERION IR','scope':'Connected clean-ROM compiler vertical slice, not the Sonic campaign','components':components,'state':state,'terrain':terrain,'initialize':initialize,'update':update,'render':render,'observations':['ticks','player_x','player_y','shot_count','kills','pickup_taken','gate_open','won','player_hp','ability_mask'],'authorship':{'recovered_behavior':['directional acceleration','gravity','signed integration','enemy damage and lethal lifecycle','equipment acquisition and campaign event bank'],'authored_ir':['input and jump policy','projectile lifecycle and contact dispatch','world geometry and collision response','world capability gate and objective','side-scroll presentation'],'hardware_runtime':['frame clock','input sampling','geometry queries','Mode4 palette and draw primitives']},'constraints':['MZM horizontal velocity converted to Sonic integration units by synthesized exact x8 adapter','No machine addresses or parent-ROM code are read by composition','Acquired capability ownership opens an authored world gate; original equip/active refresh is not claimed','No unknown rendering primitive or semantic mismatch silently falls back']}
out=ROOT/'research/automatic-ir/asterion-relay.composition.json';out.write_text(json.dumps(p,indent=2)+'\n');print(out)
