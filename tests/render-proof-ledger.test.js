import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRenderProofLedger} from '../scripts/render-proof-ledger.mjs';
const hash='a'.repeat(64),manifest='b'.repeat(64);
const rows=[
 ['core','sonic but the enemies are pokemon'],
 ['host','Keep Sonic Advance USA as the native host, preserving Sonic, its world, level structure, movement, enemy AI and collisions.'],
 ['fit','Fit Pokemon silhouettes proportionally into native enemy sprite allocations, preserving transparency and documenting palette adaptation.'],
 ['coverage','Account explicitly for enemies and frames left unchanged, including bosses and shared projectile artwork.'],
 ['native','Produce a transformed native GBA artifact and separately record native boot, sprite-consumer verification and natural gameplay verification.'],
 ['names','Rename all enemies with Pokemon names'],['intro','Add a Pokemon intro'],['mechanics','Implement capture mechanics']
].map(([id,text])=>({id,text}));
const args={plan:{requirements:rows},core_clauses:[rows[0].text],claimedIds:rows.map(r=>r.id),artifact:{sha256:hash},designScope:'Ordinary enemy source-art transfer.',provenance:{operation:'pokemon-enemies',transfer_manifest_sha256:manifest,coverage:{ordinary_enemy_families:20,native_animation_ids:21,native_variants:46,unique_modified_ranges:104,changed_bytes:30697}},qualification:{schema:'gameverse.sonic-enemy-native-verification/1',outcome:'pass',artifact:{sha256:hash},transfer_manifest_sha256:manifest,patch_scope:{all_other_rom_bytes_identical:true,changed_bytes:30697},candidate:{cold_boot_frames:600,visible_ticks:2944},native_animation_hitbox_oam_parity:true,rendered_changed_frames:184}};
test('partial evidence for preservation, fit, native proof and exclusions; names and mechanics unmet',()=>{
 const result=buildRenderProofLedger(args).requirements;
 assert.deepEqual(result.map(r=>r.status),['partial','partial','partial','partial','partial','unmet','unmet','unmet']);
 assert.match(result[1].scope,/natural gameplay behavior was not verified/);
 assert.match(result[4].scope,/Natural gameplay encounters.*unverified/);
 assert.equal(result[2].evidence[0].coverage.native_variants,46);
 assert.ok(result.every(r=>r.status!=='applied'));
});
test('wrong or missing proof identity grants nothing, even for claimed IDs',()=>{
 for(const qualification of [{...args.qualification,artifact:{sha256:'c'.repeat(64)}},{...args.qualification,transfer_manifest_sha256:undefined},{...args.qualification,outcome:'fail'}])
  assert.ok(buildRenderProofLedger({...args,qualification}).requirements.every(r=>r.status==='unmet'&&r.evidence.length===0));
});
test('absent native evidence cannot certify native-verification clause',()=>{
 const qualification={...args.qualification,native_animation_hitbox_oam_parity:false};
 assert.equal(buildRenderProofLedger({...args,qualification}).requirements.find(r=>r.id==='native').status,'unmet');
});
test('applies_to_requirements and misleading IDs never grant names proof',()=>{
 const plan={requirements:[{id:'host-preservation',text:'Rename every enemy to a Pokemon name'}]};
 assert.equal(buildRenderProofLedger({...args,plan,claimedIds:['host-preservation']}).requirements[0].status,'unmet');
});

test('negated preservation claims never receive the opposite proof',()=>{const r=buildRenderProofLedger({...args,plan:{requirements:[{id:'negative',text:'Do not preserve Sonic movement or world'}]}});assert.equal(r.requirements[0].status,'unmet');});
