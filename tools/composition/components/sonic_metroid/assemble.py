#!/usr/bin/env python3
"""Resolve the native campaign assembly registry into immutable package/host pins.
This prepares manifests, not ROM patches. Native lowering is exclusively the
shared composition backend, and variants select component graphs/exports.
"""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def pin(ref):return {'ref':ref,'sha256':hashlib.sha256((ROOT/ref).read_bytes()).hexdigest()}
def write(ref,d):
 p=ROOT/ref;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2)+'\n');return pin(ref)
def main():
 import sys
 sys.path.insert(0,str(Path(__file__).parent))
 from compile_world import compile_world,compile_schedule
 world='tools/composition/worlds/sonic-metroid-signal-descent.json'
 d=json.loads((ROOT/world).read_text());(Path(__file__).parent/'world_data.c').write_text(compile_world(d));(Path(__file__).parent/'frame_graph.c').write_text(compile_schedule(d))
 rom=(ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba').read_bytes()
 # The first recovery pass supplies function extents. Rebuilders can use the
 # already reviewed/committed contract extents without a local Ghidra project;
 # every byte range is still rehashed against the exact user's USA ROM.
 export=ROOT/'local/re/experiments/20261016-sonic-self-decompile/sonic-advance/functions.jsonl'
 funcs={}
 if export.exists():funcs={int(x['entry'],0):x for x in map(json.loads,export.read_text().splitlines())}
 else:
  prior=ROOT/'tools/composition/native/sonic-usa-whole-game.host.json'
  if prior.exists():
   for service in json.loads(prior.read_text())['services']:
    if service.get('range_size'):funcs[int(service['address'],0)]={'size':service['range_size']}
  for prior in (ROOT/'tools/composition/packages').glob('sonic-metroid-draft-*.json'):
   for row in json.loads(prior.read_text()).get('native_implementation',{}).get('recovery',{}).get('ranges',[]):
    funcs[int(row['address'],0)]={'size':row['size']}

 host=json.loads((ROOT/'tools/composition/native/sonic-usa-jump.host.json').read_text())
 host['campaign']['preserve']='Entire original campaign/geometry/parallax/bosses/task scheduler retained with declared controller/combat/render service bridges; no source checkout'
 rows=[('player',0x80454d8,[],'void','kernel','player_control'),('enemy',0x800b4f8,['ptr','i16','i16'],'i32','combat','enemy_contact'),('boss_dual',0x800bcbc,['ptr','i16','i16','ptr'],'i32','boss','boss_dual_contact'),('boss_shielded',0x800ba5c,['ptr','i16','i16','ptr'],'i32','boss','boss_shielded_contact'),('boss',0x800b8b4,['ptr','i16','i16','ptr'],'i32','boss','boss_contact'),('boss_attack',0x800c0e0,['ptr','i16','i16','ptr'],'i32','boss','boss_attack'),('hurt',0x800c558,['ptr'],'i32','resources','contact_damage'),('vram_reset',0x8006c0c,[],'void','kernel','scene_reset'),('air_control',0x804456c,['ptr'],'void','movement','air_control'),('release',0x804463c,['ptr'],'void','movement','release'),('jump',0x804421c,['ptr'],'i32','movement','jump'),('integrate',0x80470b4,['ptr'],'void','movement','integrate'),('gravity',0x8047100,['ptr'],'void','movement','gravity')]
 host['hooks']=[]
 for name,a,args,ret,owner,phase in rows:host['hooks'].append(dict(id=name,address=hex(a),preimage=rom[a-0x8000000:a-0x8000000+(16 if len(args)==4 else 8)].hex(),cardinality=1,abi='aapcs-thumb',args=args,return_=ret,phase=phase,writes=['actor_motion' if owner=='movement' else 'campaign']))
 for h in host['hooks']:h['return']=h.pop('return_')
 services=[('task_teardown',0x8001954,'void(u16,u16)'),('scene_fresh',0x803ce20,'void()'),('vram_free',0x8006c34,'void(ptr)'),('task_create',0x8001588,'ptr(callback,u16,u16,u16,destructor)'),('oam_allocate',0x80047fc,'ptr(u32)'),('vram_allocate',0x8006b54,'ptr(u32)'),('sprite_draw',0x8004158,'void(sprite_ptr)'),('enemy_fx',0x801fea0,'void(i32,i32)'),('enemy_drop_fx',0x8054920,'void(i32,i32)'),('enemy_score',0x80095cc,'void(i32,i32)'),('replay_input',0x804d108,'void(u16)'),('water_parameters',0x8044a38,'void(actor_ptr)'),('sonic_controller',0x8047378,'void(actor_ptr)'),('tails_controller',0x8047b6c,'void(actor_ptr)'),('knuckles_controller',0x8048fcc,'void(actor_ptr)'),('amy_controller',0x8049778,'void(actor_ptr)'),('player_animation',0x8045fd4,'void(actor_ptr,sprite_ptr)'),('player_render',0x80462c8,'void(actor_ptr,sprite_ptr)'),('player_secondary_render',0x8046ac0,'void(actor_ptr,sprite_ptr)'),('stop_sound',0x80978b0,'void(u16)'),('restore_music',0x8098764,'void(ptr,u16)'),('sonic_air_ability',0x80478ac,'void(actor_ptr)'),('tails_air_ability',0x8047ff0,'void(actor_ptr)'),('knuckles_air_ability',0x8048114,'void(actor_ptr)')]
 for sid,a,abi in services:
  size=funcs[a]['size'] if a in funcs else 8
  host['services'].append(dict(id=sid,address=hex(a),isa='thumb',abi=abi,preimage=rom[a-0x8000000:a-0x8000000+8].hex(),range_size=size,range_sha256=hashlib.sha256(rom[a-0x8000000:a-0x8000000+size]).hexdigest()))
 hp=write('tools/composition/native/sonic-usa-whole-game.host.json',host)
 base='tools/composition/components/sonic_metroid/'
 names=['state','geometry','resources','impact_bridge','combat','boss','ecology','progression','movement','world','render','travel','schedule','kernel']
 dependencies={'state':[],'geometry':[],'resources':['state'],'impact_bridge':['state','impact_ir'],'combat':['state','resources','geometry','impact_bridge'],'boss':['combat','resources'],'ecology':['combat','geometry','resources'],'progression':['combat','geometry','resources','world'],'movement':['state','geometry','recovered','air'],'world':[],'render':['state','world'],'travel':['state','render','progression'],'schedule':['resources','combat','progression','ecology','render','travel'],'kernel':['state','movement','schedule']}
 roles={'impact_ir':'combat.automatically_lifted_mzm_impact','impact_bridge':'combat.symbolic_impact_to_native_entity_adapter','state':'campaign.task_owned_state','geometry':'world.terrain_queries','resources':'resource.energy_ammo_drops','combat':'combat.realtime_projectiles_native_entity_lifecycle','boss':'combat.projectile_to_native_staged_boss_hit_contract','ecology':'ecology.patrol_dive_aim_guardian','progression':'progression.ability_caches_typed_locks','movement':'movement.ordinary_mzm_surface_sonic_authority','world':'world.campaign_prefab_story_asset_data','render':'presentation.native_obj_hud_prefabs_projectiles','travel':'campaign.visited_stage_relay','schedule':'composition.typed_event_frame_graph','kernel':'host.native_control_scene_event_schedule','air':'movement.recovered_sonic_air_control_release','recovered':'movement.recovered_sonic_mzm_bundle'}
 phases=[r[-1] for r in rows]+['resources_tick','weapons_tick','progression_tick','ecology_tick','render_tick','campaign_travel_tick']
 phase_owner={r[-1]:r[-2] for r in rows};phase_owner.update(resources_tick='resources',weapons_tick='combat',progression_tick='progression',ecology_tick='ecology',render_tick='render',campaign_travel_tick='travel')
 syms={'boss_dual':('gv_native_boss_dual',[{'arg':0},{'arg':1},{'arg':2},{'arg':3}]),'boss_shielded':('gv_native_boss_shielded',[{'arg':0},{'arg':1},{'arg':2},{'arg':3}]),'boss':('gv_native_boss',[{'arg':0},{'arg':1},{'arg':2},{'arg':3}]),'boss_attack':('gv_native_boss_attack',[{'arg':0},{'arg':1},{'arg':2},{'arg':3}]),'player':('gv_native_player',[]),'enemy':('gv_native_enemy',[{'arg':0},{'arg':1},{'arg':2}]),'hurt':('gv_native_hurt',[{'arg':0}]),'vram_reset':('gv_native_vram_reset',[]),'air_control':('gv_native_air_control',[{'arg':0}]),'release':('gv_native_release',[{'arg':0}]),'jump':('gv_native_jump',[{'arg':0}]),'integrate':('gv_native_integrate',[{'arg':0},{'read':{'address':'0x03005004','width':16}},{'read':{'address':'0x0300502c','width':16}}]),'gravity':('gv_native_gravity',[{'arg':0},{'read':{'address':'0x03005004','width':16}}])}
 packages=[];components=[]
 # Versioned recovered bundles remain immutable. New graph binds them through
 # explicit per-system adapters rather than editing their C for this variant.
 old=json.loads((ROOT/'tools/composition/packages/sonic-metroid-motion-jump.json').read_text())
 packages.append({'instance':'recovered','package':pin('tools/composition/packages/sonic-metroid-motion-jump.json')})
 def comp(name):return {'id':name,'provides':[roles[name]+'@1'],'requires':[],'requires_components':dependencies.get(name,[]),'ports':[],'accesses':[{'state':'actor_motion' if name=='movement' else 'campaign','phase':ph,'modes':['play'],'op':'write'} for ph,o in phase_owner.items() if o==name],'implementation':{'status':'lowered','recovery_evidence_ref':'research/requests/sonic-self-decomp-evidence.json','evidence_refs':['research/deep-extraction/metroid/first-draft-combat-evidence.json']}}
 components.append(comp('recovered'))
 # A pure exact-ROM recovery package is an explicit dependency of the authority
 # adapter, while geometry closure supplies head-clearance with no native call.
 air_sources=[pin('research/requests/sonic-recovered-air-control.c')]
 air={'ir_version':'0.1','kind':'component_package','id':'composition.sonic_air_recovered','version':'1.0.0','concept':{'role':roles['air']},'native_implementation':{'origin':'self_decompilation','recovery':dict(old['native_implementation']['recovery'])},'lowering':{'native_v1':{'version':'freestanding-c-thumb/1','sources':air_sources,'translation_units':[air_sources[0]['ref']],'requires':[],'exports':[],'state_bindings':[],'host_calls':[{'service':n,'address':hex(a),'abi':abi} for n,a,abi in services if n.endswith('air_ability')]}}}
 ap=write('tools/composition/packages/sonic-metroid-draft-air.json',air);packages.append({'instance':'air','package':ap});components.append(comp('air'))
 # This behavior TU is emitted exclusively from serialized address-free L1.
 # Unknown split fields remain durable entity sidecars; machine offsets belong
 # only to the original validation adapter, never to the executable behavior.
 generated=base+'generated/mzm_impact/'
 impact_sources=[pin(generated+n) for n in ['component.c','component.h','l1.json','package.json','abi-receipt.json','native-proof.json','receipt.json','validation-adapter.json']]
 abi=json.loads((ROOT/(generated+'abi-receipt.json')).read_text())
 impact={'ir_version':'0.1','kind':'component_package','id':'composition.mzm_automatic_impact','version':'0.1.0','concept':{'role':roles['impact_ir']},'native_implementation':{'origin':'self_decompilation','game_id':'metroid-zero-mission','recovery':{'rom_sha1':'5de8536afe1f0078ee6fe1089f890e8c7aa0a6e8','rom_sha256':'fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37','entry':'0x08050424','semantic_status':'automatically_lifted_address_free_L1_with_original_instruction_differential_qualification','lift_ref':generated+'l1.json','lift_sha256':abi['behavior_sha256'],'ranges':[],'dependency_closure':{'status':'closed','calls':[],'data':[],'ram':['explicit symbolic entity fields and shared context counter; bridge owns allocation'],'hardware':[],'relocations':[]},'dynamic_witness_refs':[generated+'native-proof.json'],'unknowns':abi['limitations']}},'typed_abi':abi,'lowering':{'native_v1':{'version':'freestanding-c-thumb/1','sources':impact_sources,'translation_units':[generated+'component.c'],'requires':[],'exports':[],'state_bindings':[],'host_calls':[]}}}
 ip=write('tools/composition/packages/sonic-metroid-draft-impact-ir.json',impact);packages.append({'instance':'impact_ir','package':ip});components.append(comp('impact_ir'))
 identities={n:('composition.sonic_metroid_'+n,'0.1.0-draft') for n in names};identities['recovered']=(old['id'],old['version']);identities['air']=(air['id'],air['version']);identities['impact_ir']=(impact['id'],impact['version'])
 for n in names:
  source=base+('world_data.c' if n=='world' else 'frame_graph.c' if n=='schedule' else n+'.c');sources=[pin(source),pin(base+'game.h'),pin(generated+'component.h')]
  if n=='geometry':sources+=[pin('research/requests/sonic-recovered-contact.c'),pin('research/requests/sonic-recovered-terrain.c')]
  if n in ['geometry','movement']:sources+=[pin('research/requests/sonic-native-traversal-contract.json')]
  if n in ['world','schedule']:sources+=[pin(world),pin(base+'compile_world.py')]
  exports=[]
  for h in host['hooks']:
   row=next(r for r in rows if r[0]==h['id'])
   if row[-2]==n:
    sym,args=syms[h['id']];types=[a for a in h['args']]
    if h['id']=='integrate':types+=['u32','u32']
    elif h['id']=='gravity':types+=['u32']
    exports.append({'symbol':sym,'return':h['return'],'args':types})
  recovery={'rom_sha1':host['rom_sha1'],'rom_sha256':host['rom_sha256'],'ranges':[],'lift_ref':source,'lift_sha256':pin(source)['sha256'],'semantic_status':'new_authored_bridge_using_recovered_mechanics','dependency_closure':{'status':'closed','calls':dependencies[n],'data':[world] if n in ['world','progression'] else [],'ram':['GvPlayer pinned native prefix','GvState native TaskCreate1536 bytes,flag2,priorityFF00'],'hardware':['native OAM/VRAM/palette services'] if n=='render' else [],'relocations':['all component function/data addresses resolved by native ARM linker; engine services pinned exact USA ROM']},'dynamic_witness_refs':[],'unknowns':['Whole campaign route/loop/boss acceptance is separate from compilation; no unsupported claim of full dynamic proof']}
  states=[]
  if n=='state':states=[{'id':'campaign','storage':'native-task-data','bytes':1536,'lifetime':'campaign','writes':[{'offset':0,'width':32,'quantity':'magic'},{'offset':4,'width':32,'quantity':'native_frame'},{'offset':8,'width':32,'quantity':'ability_bits'},{'offset':24,'width':16,'quantity':'current_energy'},{'offset':28,'width':16,'quantity':'current_missiles'}],'allocation':{'service':'task_create','bytes':1536,'alignment':4,'flags':2,'priority':65280,'locator':'bounded native task-list scan magic GV_MAGIC; never arbitrary free RAM'}}]
  behavior={'state':'native task GvState fields in game.h','events':{'combat':['fire','charge_release','projectile_hit','freeze','native_enemy_death'],'progression':['cache_collect','typed_gate_hit','ability_gate_cross','stage_change','guardian_defeat'],'resources':['damage','pickup','death','respawn']}.get(n,[]),'phase_authority':[p for p,o in phase_owner.items() if o==n]}
  if n=='movement':behavior['motion_authority']={'modes':['precision','surface_flow','external_attachment','inherited_launch'],'transfers':[{'guard':'actorflags&0x400008==0x400008','to':'external_attachment','effect':'campaign.momentum=1; nativeexternalobjectownsposition'},{'guard':'nativeobjectfreshAedge clearsattachment','to':'inherited_launch','effect':'preserve Sonicgravity/integration/release'},{'guard':'flatground abs(tangent)<64','to':'precision'},{'guard':'explicitL+A,zero tangent,vx<128,true staticwall,noattachment','to':'precision','effect':'wallkick may occur'}],'evidence_ref':'research/requests/sonic-native-traversal-contract.json'}
  package={'ir_version':'0.1','kind':'component_package','id':identities[n][0],'version':identities[n][1],'concept':{'role':roles[n],'facets':['mechanics','world','story']},'native_implementation':{'game_id':'sonic-advance','origin':'new_bridge','recovery':recovery},'ports':[{'id':'world_position','direction':'in','required':False,'type':{'scalar':'i32x2','quantity':'position','unit':'1/256px','frame':'sonic-world-y-down'}}],'behaviors':[behavior],'authorship':{'new':'native host adaptation, ecology/placements/art/story explicitly authored','recovered_references':['research/requests/metroid-recovered-motion.package.json','research/deep-extraction/metroid/first-draft-combat-evidence.json','research/requests/sonic-self-decomp-evidence.json']},'lowering':{'native_v1':{'version':'freestanding-c-thumb/1','sources':sources,'translation_units':[source],'exports':exports,'requires':[{'id':identities[x][0],'version':identities[x][1]} for x in dependencies[n]],'state_bindings':states,'host_calls':[]}}}
  used={'state':['task_create'],'resources':['pose_hitbox','play_sound'],'combat':['sprite_draw','enemy_fx','enemy_drop_fx','enemy_score','play_sound'],'ecology':['play_sound'],'progression':['play_sound'],'movement':['pose_hitbox','play_sound'],'render':['oam_allocate','vram_allocate'],'travel':['task_teardown','scene_fresh','vram_free'],'kernel':['replay_input','water_parameters','sonic_controller','tails_controller','knuckles_controller','amy_controller','player_animation','player_render','player_secondary_render','stop_sound','restore_music','play_sound']}
  package['lowering']['native_v1']['host_calls']=[{'service':svc['id'],'address':svc['address'],'abi':svc['abi']} for svc in host['services'] if svc['id'] in used.get(n,[])]
  for hook in host['hooks']:
   row=next(r for r in rows if r[0]==hook['id'])
   if row[-2]==n:
    a=int(hook['address'],0);size=funcs[a]['size'];recovery['ranges'].append({'address':hex(a),'size':size,'isa':'thumb','instruction_sha256':hashlib.sha256(rom[a-0x8000000:a-0x8000000+size]).hexdigest(),'name':hook['id'],'boundary_status':'statically_reviewed','name_status':'structural_role_reviewed'})
  pp=write('tools/composition/packages/sonic-metroid-draft-'+n+'.json',package);packages.append({'instance':n,'package':pp});components.append(comp(n))
 hooks=[{'host_hook':r[0],'instance':r[-2],'symbol':syms[r[0]][0],'args':syms[r[0]][1]} for r in rows]
 plan={'ir_version':'0.1','kind':'composition_plan','id':'sonic-metroid-signal-descent-first-draft','target':{'platform':'gba','foundation_game':'sonic-advance','preserve_campaign':True,'authoritative_origin':'self_decompilation'},'intent':{'request_ref':'/Users/shishirtandale/Downloads/gameverse-mashup-request.json','clarification':'Preserve Sonic momentum on loops and ramps','campaign_ir':world},'execution':{'clock':'native-simulation-frame','modes':['play'],'phases':phases,'transitions':[]},'states':[{'id':'actor_motion','lifetime':'entity'},{'id':'campaign','lifetime':'campaign'}],'components':components,'bindings':[],'transforms':[],'route_obligations':[{'id':'whole-campaign','detail':str(sum(len(stage['prefabs']) for stage in d['stages']))+' prefabs across18 native world definitions;14 campaign/special definitions plus4 multiplayer definitions; native campaign/boss/loop geometry retained. Actual route witnesses required.'}],'obligations':[{'id':'first-draft-acceptance','detail':'Compilation is not player-facing acceptance; require native visible combat/upgrades/gates/resources and scene persistence witnesses on exact artifact.'}],'native_build':{'version':'gba-component-native/1','host':hp,'packages':packages,'hooks':hooks,'max_payload_bytes':131072,'timeout_s':15,'max_build_s':60}}
 write('tools/composition/plans/sonic-metroid-signal-descent.json',plan)
 print(json.dumps({'packages':len(packages),'hooks':len(hooks),'prefabs':sum(len(s['prefabs']) for s in d['stages'])}))
if __name__=='__main__':main()
