import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterGames } from '../src/workshop-model.js';
import { createMashupRequest, defaultChoices } from '../src/mashup-model.js';
const catalog=JSON.parse(await readFile(new URL('../games/research.json',import.meta.url)));
const parentIds=['metroid-zero-mission','pokemon-emerald-version'];
const choices=()=>defaultChoices(parentIds.map(id=>catalog.games.find(g=>g.id===id)));
const request=(designChoices=choices(),intent='Preserve the native world and add tactical encounters.',parents=parentIds)=>createMashupRequest(catalog,parents,designChoices,intent,parents[0]);
test('eight broad design choices produce a source-linked native GBA brief without limiting raw components',()=>{
  const result=request();
  assert.equal(result.schema_version,2);assert.equal(result.kind,'gameverse_mashup_request');assert.equal(result.runtime_target,'gba');
  assert.equal(result.design_choices.length,8);assert.equal(result.parent_games.length,2);
  assert.deepEqual(result.foundation,{game_id:'metroid-zero-mission',preserve_world_and_campaign:true});
  assert.equal(result.constraints.max_design_choices,8);assert.equal(result.constraints.target_platform,'gba');
  assert.ok(!('max_width' in result.constraints));assert.ok(!('max_height' in result.constraints));
  const rawComponents=result.design_choices.flatMap(d=>d.bundles.flatMap(b=>b.component_ids));assert.ok(rawComponents.length>8,'Bundles may include more than eight raw components.');
  for(const dimension of result.design_choices)for(const bundle of dimension.bundles){const game=catalog.games.find(g=>g.id===bundle.game_id);assert.ok(bundle.component_ids.every(id=>game.components.some(c=>c.id===id)));}
  assert.equal(result.status,'build_brief');assert.ok(result.design_choices.every(d=>d.implementation_status==='requested'));
  // Both requested parent worlds use a primary side view. A foreign movement
  // donor alone must not manufacture a perspective conversion or tactical pause.
  const sonicParents=['metroid-zero-mission','sonic-advance'];
  const sonicChoices=defaultChoices(sonicParents.map(id=>catalog.games.find(g=>g.id===id)));
  for(const id of ['traversal','combat','progression','world','resources','opposition'])sonicChoices[id]={...sonicChoices[id],mode:'parent',parent_game_id:'metroid-zero-mission'};
  const sonicBrief=createMashupRequest(catalog,sonicParents,sonicChoices,'Implement Zero Mission movement, physics and ecology inside Sonic Advance.','sonic-advance');
  assert.ok(!sonicBrief.dependency_decisions.some(n=>n.id==='view_conversion'));
  const fieldCombat=sonicBrief.dependency_decisions.find(n=>n.id==='combat_seam');
  assert.match(fieldCombat.text,/hitboxes.*damage.*invulnerability/);assert.doesNotMatch(fieldCombat.text,/pause|tactical|turn-based/i);
  const topDownChoices=choices();topDownChoices.traversal.parent_game_id='pokemon-emerald-version';
  assert.ok(request(topDownChoices).dependency_decisions.some(n=>n.id==='view_conversion'),'Known side-view/top-down families require review.');
  assert.match(result.dependency_decisions.find(n=>n.id==='combat_seam').text,/turn-based/);
  sonicChoices.traversal.mode='bridge';sonicChoices.traversal.bridge_id='field_and_hubs';
  assert.ok(createMashupRequest(catalog,sonicParents,sonicChoices,'Deliberately add separate hub and field views.','sonic-advance').dependency_decisions.some(n=>n.id==='view_seam'),'An explicit hybrid bridge remains a requested design choice.');
  sonicChoices.traversal.mode='parent';
  const unknownProjection=structuredClone(catalog);unknownProjection.games.find(g=>g.id==='sonic-advance').components=unknownProjection.games.find(g=>g.id==='sonic-advance').components.filter(c=>c.facet!=='projection');
  assert.ok(!createMashupRequest(unknownProjection,sonicParents,sonicChoices,'Review unknown projection before adapting.','sonic-advance').dependency_decisions.some(n=>n.id==='view_conversion'));
});
test('GBA brief rejects missing parents, stale choices and unbounded intent or notes',()=>{
  assert.throws(()=>request(choices(),'Explore',['metroid-zero-mission','missing-parent']),/absent/);
  assert.throws(()=>request(choices(),'Explore',['metroid-zero-mission']),/two parent/);
  assert.throws(()=>request(choices(),'Explore',['metroid-zero-mission','metroid-zero-mission']),/distinct/);
  assert.throws(()=>request(choices(),' '.repeat(10)),/Describe/);
  assert.throws(()=>request(choices(),'x'.repeat(4001)),/4,000/);
  const longNote=choices();longNote.story.notes='x'.repeat(1501);assert.throws(()=>request(longNote),/1,500/);
  const staleParent=choices();staleParent.combat.parent_game_id='missing-parent';assert.throws(()=>request(staleParent),/removed parent/);
  const ninth=choices();ninth.extra_dimension={mode:'bridge'};assert.throws(()=>request(ninth),/eight broad/);
  const staleId=choices();delete staleId.story;staleId.obsolete_story={mode:'bridge'};assert.throws(()=>request(staleId),/unknown design dimension/);
  const staleBridge=choices();staleBridge.story.bridge_id='removed-bridge';assert.throws(()=>request(staleBridge),/available bridge/);
});
test('research export contains the full corpus with finite compact projections and no private machine paths',()=>{
  assert.equal(catalog.games.length,33);assert.equal(new Set(catalog.games.map(g=>g.id)).size,33);
  const text=JSON.stringify(catalog);assert.ok(!/\/Users\/|\bsk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY|LITELLM_API_KEY/.test(text),'Research export must exclude credentials and private machine paths.');
  for(const [axis,view] of Object.entries(catalog.views))for(const game of catalog.games){
    assert.ok(view.xy[game.id].every(Number.isFinite),axis);
    assert.equal(view.xy[game.id].length,2);
    assert.ok(view.neighbors[game.id].near.every(n=>n.id!==game.id&&n.distance>=0&&n.distance<=1));
    assert.ok(view.neighbors[game.id].far.every(n=>n.id!==game.id&&n.distance>=0&&n.distance<=1));
  }
});
test('research discovery searches display titles and keeps the evidence filter separate from playability',()=>{
  const emerald=filterGames(catalog.games,'emerald');assert.equal(emerald.length,1);assert.equal(emerald[0].id,'pokemon-emerald-version');
  const withRecords=filterGames(catalog.games,'',true);assert.ok(withRecords.length>1);assert.ok(withRecords.every(g=>g.components.length));
  assert.equal(filterGames(catalog.games,'no such title').length,0);
});
