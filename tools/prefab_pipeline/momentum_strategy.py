"""Lower a connected cast/motion/reward graph into recovered Aria prefabs.

This bounded, versioned operator set authors gameplay rules over exact native
ports. It reuses the recovered cast, projectile and acquisition transactions;
it does not infer a controller, collision engine, save layout or arbitrary C.
"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
from tools.prefab_pipeline.reward_strategy import generate_strategy

ROOT=Path(__file__).resolve().parents[2]
BASE='research/deep-extraction/castlevania'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pin(path):return {'path':str(path.relative_to(ROOT)), 'sha256':sha(path)}
def replace_once(text, before, after):
    if text.count(before)!=1:raise ValueError('recovered insertion contract changed: '+before[:80])
    return text.replace(before,after,1)

def lower_momentum_strategy(spec, output_dir):
    if spec.get('schema')!='gameverse.connected-strategy/1' or spec.get('operator_set')!='aria-soulstride/1':
        raise ValueError('unsupported connected strategy operators')
    expected=['sample_owned_soul_tier','directional_successful_skeleton_birth_lunge','inherit_projectile_momentum','moving_defeat_first_soul','moving_defeat_mp_refund']
    if spec.get('operators')!=expected:raise ValueError('unsupported connected strategy ordering')
    generators=spec.get('source_generators',[])
    if {row.get('path') for row in generators} != {'tools/prefab_pipeline/soulstride_movement.py','tools/prefab_pipeline/soulstride_progression.py'} or len(generators)!=2:
        raise ValueError('exact pinned movement and progression source generators required')
    for row in generators:
        source=(ROOT/row['path']).resolve();source.relative_to(ROOT)
        if sha(source)!=row['sha256']:raise ValueError('pinned source generator changed')
    cfg=spec['parameters']
    bounds={'tier_every':(1,6),'tier_cap':(1,3),'lunge_speed_q16':(65536,262144),'tier_speed_q16':(0,65536),'lift_q16':(0,196608),'moving_threshold_q16':(32768,131072),'mp_refund':(1,16),'tier_refund':(0,8),'projectile_inherit_divisor':(1,4)}
    if set(cfg)!=set(bounds) or any(type(cfg[k]) is not int or not lo<=cfg[k]<=hi for k,(lo,hi) in bounds.items()):
        raise ValueError('connected parameters outside bounded domains')
    output=Path(output_dir).resolve();output.relative_to(ROOT)
    output.mkdir(parents=True,exist_ok=False)
    route=spec['native_route'];route_path=(ROOT/route['path']).resolve();route_path.relative_to(ROOT)
    if sha(route_path)!=route['sha256']:raise ValueError('native route witness changed')
    (output/'native-route-evidence.json').write_bytes(route_path.read_bytes())
    # Existing eligibility verifier checks exact source ROM/callback records.
    reward_spec=copy.deepcopy(spec['reward_strategy'])
    generated=generate_strategy(reward_spec,output/'first-soul')
    reward_package_path=ROOT/generated['outputs']['package']['path']
    reward=json.loads(reward_package_path.read_text())
    ability_path=ROOT/BASE/'ability.package.json'; ability=json.loads(ability_path.read_text())
    for row in ability['lowering']['native_v1']['sources']:
        if sha(ROOT/row['ref'])!=row['sha256']:raise ValueError('recovered ability source changed')
    # Inventory access is the recovered host service. Read-only ownership feeds
    # both control and reward rules; collection/save remain sole native writers.
    from tools.prefab_pipeline.soulstride_progression import generate_soulstride_source
    _, progression_metadata=generate_soulstride_source(ROOT)
    owned=sorted((row['kind'],row['index']) for row in progression_metadata['owned_pairs'])
    helper='#ifndef GV_SOULSTRIDE_H\n#define GV_SOULSTRIDE_H\n#include <stdint.h>\n'
    helper+='static inline unsigned ss_tier(void){unsigned n=0;\n'
    for kind,index in owned:helper+=f'n+=!!(((uint32_t(*)(uint32_t,uint32_t))0x080326b9u)({kind}u,{index}u)&255u);\n'
    helper+=f'n/={cfg["tier_every"]}u;return n>{cfg["tier_cap"]}u?{cfg["tier_cap"]}u:n;}}\n'
    helper+=f'static inline int ss_moving(const uint8_t *p){{uintptr_t a=(uintptr_t)p;if((a&3u)||a<0x02000000u||a>0x0203ff7cu)return 0;int32_t v=*(const int32_t*)(p+0x48);return v>={cfg["moving_threshold_q16"]} || v<=-{cfg["moving_threshold_q16"]};}}\n'
    helper+='static inline int ss_normal(const uint8_t *r){return !(r[0x4cc]&3)&&!r[0x13266];}\n#endif\n'
    (output/'soulstride.h').write_text(helper)
    from tools.prefab_pipeline.soulstride_movement import generate_movement_source
    movement_source,movement_metadata=generate_movement_source(ROOT)
    (output/'movement.c').write_text(movement_source)
    # Ordinary Soma's native caster remains unchanged. The recovered Skeleton
    # entity birth is the success boundary: native MP debit/slot publication and
    # collision-partner allocation precede our authored parent-velocity commit.
    cast=(ROOT/BASE/'cast-host.c').read_text()
    (output/'cast-host.c').write_text(cast)
    (output/'cast-policy.c').write_text((ROOT/BASE/'cast-policy.c').read_text())
    (output/'cast-policy.h').write_text((ROOT/BASE/'cast-policy.h').read_text())
    bone=(ROOT/BASE/'bone-policy.c').read_text()
    bone=replace_once(bone,'#include <stdint.h>','#include <stdint.h>\n#include "soulstride.h"\n#include "state-layout.h"')
    needle='  CALL(0x080d7910,void(*)(uint32_t))(0xe4);'
    inherit=f'''  /* Successful native Skeleton birth enables the authored soul lunge. */
  volatile struct gv_state_ability_player_motion *motion=gv_access_ability_player_motion(a);
  uint32_t held=H(r,0x1c);
  if(motion&&ss_normal(r)&&(held&0x40u)&&((held&0x30u)==0x10u||(held&0x30u)==0x20u)){{
   unsigned tier=ss_tier();int32_t speed={cfg['lunge_speed_q16']}+(int32_t)tier*{cfg['tier_speed_q16']};
   motion->field_0=(held&0x20u)?-speed:speed;motion->field_1=-{cfg['lift_q16']};
  }}
  /* Authored momentum transfer only at real projectile birth. */
  int32_t inherited=motion?motion->field_0/{cfg['projectile_inherit_divisor']}:0;
  if(inherited>0x40000)inherited=0x40000;if(inherited< -0x40000)inherited= -0x40000;
  I(a,0x48)+=inherited;
'''
    bone=replace_once(bone,needle,inherit+needle)
    (output/'bone-policy.c').write_text(bone)
    host_path=ROOT/generated['outputs']['host']['path'];host=host_path.read_text()
    host=replace_once(host,'#include "first-soul-policy.h"','#include "first-soul-policy.h"\n#include "soulstride.h"')
    host=replace_once(host,' gv_aos_first_soul(&s,&e,&def,&v,scale);',f''' uint8_t *player=(uint8_t*)*(uint32_t*)(r+0x13110);
 int moving=player&&ss_normal(r)&&ss_moving(player);int fresh=!(e.flags&2);
 gv_aos_first_soul(&s,&e,&def,&v,moving?scale:0);
 if(moving&&fresh){{
  int32_t mp=*(int16_t*)(r+0x1327c),maximum=*(uint16_t*)(r+0x13280);
  if(mp>=0&&maximum<=32767){{
   mp+={cfg['mp_refund']}+(int32_t)ss_tier()*{cfg['tier_refund']};
   if(mp>maximum)mp=maximum;*(uint16_t*)(r+0x1327c)=(uint16_t)mp;
  }}
 }}''')
    host_path.write_text(host)
    def finalize(package, name, files, units):
        p=copy.deepcopy(package);p['id']='castlevania.aria.soulstride.'+name;p['version']='1.0.0'
        p['native_implementation']['origin']='new_bridge'
        p['native_implementation']['recovery']['semantic_status']='authored_connected_variant_pending_native_qualification'
        p['native_implementation']['recovery']['lift_ref']=str((output/units[0]).relative_to(ROOT))
        p['native_implementation']['recovery']['lift_sha256']=sha(output/units[0])
        n=p['lowering']['native_v1'];n['sources']=[{'ref':str((output/f).relative_to(ROOT)),'sha256':sha(output/f)} for f in files]
        n['translation_units']=[str((output/f).relative_to(ROOT)) for f in units]
        if name in ('reward','ability'):n['state_bindings'].append({'id':'player_magic','storage':'host-global','region':'player_magic','bytes':6,'lifetime':'campaign','allocation':None,'fields':[{'offset':0,'width':16,'type':'i16','quantity':'current_mp','access':'read-write'},{'offset':4,'width':16,'type':'u16','quantity':'maximum_mp','access':'read'}]})
        if name=='ability':n['state_bindings'].append({'id':'player_motion','storage':'host-projected-actor','region':'player_motion','bytes':8,'lifetime':'native-entity','allocation':None,'fields':[{'offset':0,'width':32,'type':'i32','quantity':'velocity_x','access':'read-write'},{'offset':4,'width':32,'type':'i32','quantity':'velocity_y','access':'read-write'}]})
        p['connected_strategy']={'spec':spec,'owned_tuples':owned,'progression_evidence':progression_metadata,'movement_evidence':movement_metadata,'state_accesses':[{'owner':'native_campaign','field':'MP','offset':0x1327c,'width':16,'access':'bounded-refund-write'},{'owner':'native_campaign','field':'maxMP','offset':0x13280,'width':16,'access':'read'},{'owner':'native_player','field':'velocity_x','offset':0x48,'width':32,'access':'read-write-via-guarded-native-player-parent-projection'},{'owner':'native_inventory','field':'source-reviewed-owned-souls','access':'read-via-retained-service'}],'new_ram_bytes':0,'lifecycle':'input -> successful native cast -> velocity/projectile -> moving defeat -> real pickup -> native collection/save -> future cast tier','source_packages':[pin(ROOT/BASE/'defeat.package.json'),pin(ability_path),pin(ROOT/BASE/'acquisition.package.json')],'native_route':spec['native_route'],'authored_commit_boundary':'ordinary Soma Winged Skeleton birth state0 after successful native partner allocation','controller_and_collision':'retained original engine; native trajectory qualification required'}
        p['qualification']={'scenarios':[],'required_witnesses':['successful lunge moves player in original engine','failed cast leaves velocity and MP unchanged','projectile terrain/contact/slot lifecycle retained','moving defeat native pickup/MP refund','native inventory tier changes lunge'],'known_limits':['Original campaign retained; authored rules require native fixtures; no full campaign qualification']}
        path=output/(name+'.package.json');path.write_text(json.dumps(p,indent=2)+'\n');return pin(path)
    reward_pin=finalize(reward,'reward',['first-soul-policy.c','first-soul-policy.h','first-soul-host.c','soulstride.h'],['first-soul-policy.c','first-soul-host.c'])
    ability_pin=finalize(ability,'ability',['cast-policy.c','cast-policy.h','cast-host.c','bone-policy.c','soulstride.h','movement.c'],['cast-policy.c','cast-host.c','bone-policy.c'])
    ability_document=json.loads((ROOT/ability_pin['path']).read_text())
    owned_service=next(row for row in reward['lowering']['native_v1']['host_calls'] if row['service']=='soul.owned_count')
    ability_document['lowering']['native_v1']['host_calls'].append(owned_service)
    (ROOT/ability_pin['path']).write_text(json.dumps(ability_document,indent=2)+'\n');ability_pin=pin(ROOT/ability_pin['path'])
    result={'schema':'gameverse.connected-strategy-lowering/1','status':'generated-awaiting-native-proof','package_replacements':[{'instance':'reward','package':reward_pin},{'instance':'ability','package':ability_pin}], 'hook_edits':[{'host_hook':'enemy_defeat','symbol':'gv_aos_first_soul_native','constant_arguments':{'1':1}}], 'outputs':{path.name:pin(path) for path in sorted(output.iterdir()) if path.is_file()},'new_ram_bytes':0,'lowerer_sha256':sha(Path(__file__))}
    receipt=output/'lowering-receipt.json';receipt.write_text(json.dumps(result,indent=2)+'\n');result['receipt']=pin(receipt)
    return result
