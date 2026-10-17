// Summarize trusted native adapter evidence, never recipe claims as evidence.
// A partial contribution does not certify the complete requirement text.
export function buildRenderProofLedger({plan,core_clauses=[],claimedIds=[],qualification={},artifact={},provenance={},designScope,covered}={}) {
 const requirements=Array.isArray(plan?.requirements)?plan.requirements:[];
 const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
 const bound=qualification.outcome==='pass'&&qualification.schema==='gameverse.sonic-enemy-native-verification/1'
  &&hash(artifact.sha256)&&qualification.artifact?.sha256===artifact.sha256
  &&hash(provenance.transfer_manifest_sha256)&&qualification.transfer_manifest_sha256===provenance.transfer_manifest_sha256;
 const coverage=provenance.coverage||{};
 const source=bound&&provenance.operation==='pokemon-enemies'&&coverage.ordinary_enemy_families>0&&coverage.native_variants>0&&coverage.unique_modified_ranges>0;
 const preserved=source&&qualification.patch_scope?.all_other_rom_bytes_identical===true&&qualification.patch_scope.changed_bytes>0;
 const native=source&&qualification.native_animation_hitbox_oam_parity===true&&qualification.candidate?.cold_boot_frames>0&&qualification.candidate?.visible_ticks>0&&qualification.rendered_changed_frames>0;
 const summary={ordinary_enemy_families:coverage.ordinary_enemy_families,native_animation_ids:coverage.native_animation_ids,native_variants:coverage.native_variants,unique_modified_ranges:coverage.unique_modified_ranges,changed_bytes:coverage.changed_bytes};
 return {requirements:requirements.map(r=>{
  const text=String(r.text||'');const contributions=[];
  const affirmative=!/\b(?:no|not|never|without)\b|\bdon['’]?t\b/i.test(text);
  // IDs are labels. Neither arbitrary IDs nor applies_to_requirements establish meaning.
  const core=typeof covered==='function'?covered(r):core_clauses.includes(text);
  if(affirmative&&source&&core)contributions.push({kind:'source-enemy-render',scope:designScope||'Source Pokemon artwork transferred into ordinary Sonic enemy render roles; broader behavior remains unverified.'});
  if(affirmative&&preserved&&/\b(?:keep|preserv\w*|retain\w*)\b/i.test(text)&&/\bsonic\b/i.test(text)&&/\b(?:native host|world|level structure|movement|enemy ai|collisions?)\b/i.test(text))
   contributions.push({kind:'host-byte-preservation',scope:'All ROM bytes outside declared enemy artwork ranges are identical to original Sonic USA. Native code, maps, movement, enemy AI and collision data are retained; natural gameplay behavior was not verified.'});
  if(affirmative&&source&&/\b(?:fit|fitting|silhouettes?|sprite allocations?)\b/i.test(text)&&/\b(?:proportional\w*|transparency|palette adaptation)\b/i.test(text))
   contributions.push({kind:'source-sprite-fit',scope:'The source transfer manifest records proportional icon fitting, transparent pixels and adaptation to existing native enemy palettes. In-stage encounter legibility remains unverified.'});
  if(affirmative&&source&&/\b(?:account|document|report|list)\b/i.test(text)&&/\b(?:unchanged|excluded|left unchanged)\b/i.test(text)&&/\b(?:enemies|frames|bosses|projectile)\b/i.test(text))
   contributions.push({kind:'enemy-coverage-accounting',scope:'The source transfer manifest records ordinary enemy coverage and explicit retained artwork exclusions, including bosses and shared/projectile consumers. This is bounded coverage accounting, not proof that every requested enemy changed.'});
  if(affirmative&&native&&/\b(?:native|gba)\b/i.test(text)&&/\b(?:boot|sprite.consumer)\b/i.test(text))
   contributions.push({kind:'native-sprite-consumer',scope:'Native boot and original sprite animation/OAM/render consumers passed. Animation, hitbox and OAM traces match the baseline. Natural gameplay encounters and full game completion remain unverified.'});
  return {...r,status:contributions.length?'partial':'unmet',evidence:contributions.map(c=>({...c,artifact_sha256:artifact.sha256,transfer_manifest_sha256:provenance.transfer_manifest_sha256,coverage:summary})),scope:contributions.length?contributions.map(c=>c.scope).join(' '):'No verified transformation was applied for this requirement.'};
 })};
}
