import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { componentKey, createAttempt, filterGames } from '../src/workshop-model.js';
const catalog=JSON.parse(await readFile(new URL('../games/research.json',import.meta.url)));
const keys=new Set(['pokemon-emerald-version:grid_step_locomotion','metroid-zero-mission:ability_gating_graph']);
test('actual reference components produce the game-attempt boundary without browser metadata',()=>{
  const result=createAttempt(catalog,keys,'Find a key and open a new route.');
  assert.equal(result.schema_version,1);assert.equal(result.components.length,2);
  assert.deepEqual(result.constraints,{max_width:12,max_height:8,max_episode_steps:80});
  assert.equal(result.components[0].game_id,'metroid-zero-mission');
  assert.ok(result.components.every(c=>c.adaptation));
  assert.deepEqual(Object.keys(result).sort(),['candidate_id','components','constraints','intent','schema_version','title']);
});
test('export rejects missing anchors, single-game requests and unbounded text',()=>{
  assert.throws(()=>createAttempt(catalog,new Set([...keys,'stale:component']),'Explore'),/absent/);
  assert.throws(()=>createAttempt(catalog,new Set([keys.values().next().value]),'Explore'),/two games/);
  assert.throws(()=>createAttempt(catalog,keys,' '.repeat(10)),/Describe/);
  assert.throws(()=>createAttempt(catalog,keys,'x'.repeat(4001)),/4,000/);
  assert.throws(()=>createAttempt(catalog,keys,'Explore',{'pokemon-emerald-version:grid_step_locomotion':'x'.repeat(1501)}),/1,500/);
  const tooMany=new Set(catalog.games.flatMap(g=>g.components.map(c=>componentKey(g.id,c.id))).slice(0,9));
  assert.throws(()=>createAttempt(catalog,tooMany,'Explore'),/8 components/);
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
