import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createImprovementApi } from '../scripts/improvement-api.mjs';
const root = process.cwd();
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'improvement-contract-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureRoot = resolve(directory, 'workspace'); await mkdir(fixtureRoot);
  const realCaps = await createImprovementApi({ root }).capabilities();
  await mkdir(resolve(fixtureRoot,'contracts'));await writeFile(resolve(fixtureRoot,'contracts/improvement-profile-registry.json'),await readFile(resolve(root,'contracts/improvement-profile-registry.json')));
  for (const ref of [...new Map(realCaps.mechanisms.filter(row => /^(scripts|tools)\//.test(row.path) && /\.(mjs|py|c)$/.test(row.path)).map(row=>[row.path,row])).values()]) { const path = resolve(fixtureRoot, ref.path); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, await readFile(resolve(root, ref.path))); }
  const rom = { path: 'fixture.bin', sha256: createHash('sha256').update('fixture').digest('hex') }; await writeFile(resolve(fixtureRoot, rom.path), 'fixture');
  for (const recipe of realCaps.recipes) { const path = resolve(fixtureRoot, recipe.file); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify({ schema: 'synthetic-contract-fixture/1', rom })); }
  const profilePath = resolve(fixtureRoot,'tools/prefab_pipeline/profiles/aria-soulstride-iteration.json'); await mkdir(resolve(profilePath,'..'),{recursive:true});
  await writeFile(profilePath,JSON.stringify({schema:'prefab-iteration/1',environment_version:'fixture-env/1',adapter_version:'fixture-adapter/1',limits:{attempts:2,model_calls:4,native_frames:120,wall_seconds:1,cost_usd:null},experiment:{policy_ref:{path:'tools/re/session/bridge.py',sha256:'0'.repeat(64)},confidence:0.65,margin:0.2}}));
  const sonicProfile=resolve(fixtureRoot,'tools/prefab_pipeline/profiles/sonic-coast-prefix-iteration.json');await mkdir(resolve(sonicProfile,'..'),{recursive:true});const sonicConfig=JSON.parse(await readFile(profilePath));sonicConfig.runtime_manifest={version_basis:'recipe-readset/1',recipe_id:'sonic-metroid-coast-campaign'};await writeFile(sonicProfile,JSON.stringify(sonicConfig));
  let child;
  const api = createImprovementApi({ root: fixtureRoot, directory, spawnImpl: (_command, args) => {
    child = new EventEmitter(); child.kill = () => {}; child.pid = undefined;
    child.args = args; return child;
  } });
  const caps = await api.capabilities(); const recipe = caps.recipes.find(r => r.id === 'aria-double-xp');
  const body = { schema: 'gameverse.improvement-request/1', request_id: randomUUID(), operation: 'native-mod', intent: 'Double defeat XP',
    target: { role: 'subgame', game_id: recipe.game_id, game_version: 'aria-usa-1', artifact_sha256: recipe.baseline_artifact_sha256, base_game_version: 'host-1', base_artifact_sha256: 'a'.repeat(64) },
    environment: { version: 'test-host/1', config_sha256: 'b'.repeat(64) }, loop_version: caps.loop_version, plan: { recipe_id: recipe.id, request_sha256: recipe.request_sha256 } };
  return { api, body, recipe, directory, child: () => child };
}
test('reports precise supported recipes and unsupported reconstruction/activation', async t => {
  const { api } = await fixture(t); const caps = await api.capabilities();
  assert.equal(caps.supports.reconstruction, false); assert.equal(caps.supports.player_activation, false);
  assert.equal(caps.recipes.find(r => r.id === 'aria-soulstride').quality, 'build-only');
});
test('rejects unsupported operation, target and stale immutable pins before dispatch', async t => {
  const { api, body, child } = await fixture(t);
  for (const change of [{ operation: 'reconstruct' }, { plan: { ...body.plan, request_sha256: 'c'.repeat(64) } }, { target: { ...body.target, game_id: 'pokemon-firered-version' } }]) {
    await assert.rejects(api.submit({ ...body, ...change }), error => [409, 422].includes(error.status));
  }
  assert.equal(child(), undefined);
});
test('durable receipt deduplicates and preserves backend evidence', async t => {
  const { api, body, recipe, directory, child } = await fixture(t);
  if (!recipe.installed) { t.skip('Private pinned recipe prerequisites unavailable'); return; }
  await api.submit(body); assert.equal((await api.submit(structuredClone(body))).request_id, body.request_id);
  await assert.rejects(api.submit({ ...body, intent: 'different' }), { status: 409 });
  const output = resolve(directory, body.request_id, 'result.json');
  const artifact = resolve(directory, body.request_id, 'candidate.gba'); await writeFile(artifact, 'candidate');
  await writeFile(output, JSON.stringify({ artifact, artifact_sha256: createHash('sha256').update('candidate').digest('hex'), status: 'qualified-bounded-modification', coverage: 'bounded', witnesses: { modified_xp: 2 }, stages: [{ name: 'build-modified', wall_s: 0.1 }] }));
  child().emit('close', 0);
  let done; for (let i=0;i<100;i++) { done = await api.status(body.request_id); if (done.status !== 'running') break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(done.status, 'completed'); assert.equal(done.quality.whole_game_equivalent, null); assert.equal(done.quality.reconstruction_qc, 'unavailable'); assert.equal(done.timings.build_s, 0.1);
  const restarted = createImprovementApi({ directory }); assert.equal((await restarted.status(body.request_id)).status, 'completed');
});
test('restart never advertises an orphan worker as running', async t => {
  const { api, body, recipe, directory, child } = await fixture(t); if (!recipe.installed) { t.skip('Private prerequisites unavailable'); return; }
  await api.submit(body); const restarted = createImprovementApi({ directory }); assert.equal((await restarted.status(body.request_id)).status, 'interrupted'); child().emit('close', 2);
  await new Promise(r => setTimeout(r, 20));
});
test('cancelled worker retains terminal receipt and never claims activation', async t => {
  const { api, body, child } = await fixture(t); await api.submit(body);
  const request = { method: 'DELETE', headers: { host: 'localhost:4175' } };
  let response; const res = { writeHead(code) { this.code = code; return this; }, end(bytes) { response = JSON.parse(bytes); } };
  assert.equal(await api.handle(request, res, `/api/improvement/runs/${body.request_id}`), true);
  assert.equal(response.cancellation_requested, true); child().emit('close', null);
  let run; for (let i=0;i<100;i++) { run=await api.status(body.request_id); if(run.status!=='running')break; await new Promise(r=>setTimeout(r,5)); }
  assert.equal(run.status, 'cancelled'); assert.equal(run.candidate_only, true); assert.equal(run.timings.build_s, null);
});
test('cross-origin HTTP requests fail before capability disclosure or dispatch', async t => {
  const { api } = await fixture(t); let response;
  const res = { writeHead(code) { this.code = code; return this; }, end(bytes) { response=JSON.parse(bytes); } };
  await api.handle({ method:'GET', headers:{host:'localhost:4175',origin:'https://external.example'} },res,'/api/improvement/capabilities');
  assert.equal(res.code,403); assert.equal(response.error.code,'local_origin_required');
});
test('reviewed provider readset gates runtime inputs without requiring historical captures', async t => {
  const { api, directory } = await fixture(t); const fixtureRoot = resolve(directory, 'workspace');
  let caps = await api.capabilities(); const recipe = caps.recipes.find(row => row.id === 'aria-soulstride');
  const requestPath = resolve(fixtureRoot, recipe.file), request = JSON.parse(await readFile(requestPath));
  request.historical_video = { path: '/private/prior-machine/capture.mp4', sha256: 'a'.repeat(64) };
  const requestBytes = JSON.stringify(request); await writeFile(requestPath, requestBytes);
  const manifest = { schema:'gameverse.improvement-provider-pack/1', recipes:[{id:recipe.id,request_path:recipe.file,request_sha256:createHash('sha256').update(requestBytes).digest('hex')}], files:[{path:request.rom.path,sha256:request.rom.sha256,recipes:[recipe.id]}], closure:{provenance_warnings:[{recipe:recipe.id,code:'historical-capture-unavailable'}]} };
  await mkdir(resolve(fixtureRoot,'contracts'),{recursive:true}); await writeFile(resolve(fixtureRoot,'contracts/improvement-provider-pack.json'),JSON.stringify(manifest));
  caps=await api.capabilities(); const installed=caps.recipes.find(row=>row.id===recipe.id);
  assert.equal(installed.installed,true); assert.equal(installed.prerequisite_basis,'reviewed-provider-runtime-readset');
  assert.equal(installed.provenance_warnings[0].code,'historical-capture-unavailable');
  assert.ok(caps.mechanisms.some(row=>row.path==='contracts/improvement-provider-pack.json'));
  await writeFile(resolve(fixtureRoot,request.rom.path),'tampered');
  const stale=(await api.capabilities()).recipes.find(row=>row.id===recipe.id);
  assert.equal(stale.installed,false); assert.deepEqual(stale.missing_inputs,[request.rom.path]);
  assert.notEqual((await api.capabilities()).loop_version,caps.loop_version);
});
test('native-improve dispatches registered profile and exposes checkpoint-bound continuation', async t => {
  const {api,body,directory,child}=await fixture(t); const caps=await api.capabilities();
  const profile=caps.iteration_profiles.find(row=>row.id==='aria-soulstride-iteration'),recipe=caps.recipes.find(row=>row.id===profile.recipe_id);
  const input={...body,operation:'native-improve',loop_version:caps.loop_version,plan:{recipe_id:recipe.id,request_sha256:recipe.request_sha256,profile_id:profile.id,profile_sha256:profile.profile_sha256}};
  await api.submit(input); assert.equal(child().args[3],'run-profile'); assert.ok(child().args.includes('--template'));
  const runDir=resolve(directory,input.request_id); await mkdir(resolve(runDir,'output'));
  const artifact={path:resolve(runDir,'output/candidate.gba'),sha256:createHash('sha256').update('candidate').digest('hex')}; await writeFile(artifact.path,'candidate');
  const report={schema:'prefab-iteration/1',status:'artifact-built-with-diagnostics',experiment_outcome:'budget',artifact,attempts:[{attempt:1}],stages:[{name:'experiment',status:'completed',wall_seconds:0.2}],usage:{model_calls:2,native_frames:60,cost_usd:null},usage_complete:true,checkpoint:{state:{path:'private-state',sha256:'a'.repeat(64)}},qualification:{native_objective:'pending'}};
  await writeFile(resolve(runDir,'output/iteration.json'),JSON.stringify(report)); await writeFile(resolve(runDir,'result.json'),JSON.stringify(report));
  const stillRunning=await api.status(input.request_id); assert.equal(stillRunning.status,'running'); assert.ok(stillRunning.artifacts.rom);
  child().emit('close',0); let prior;
  for(let i=0;i<100;i++){prior=await api.status(input.request_id);if(prior.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(prior.status,'completed');assert.equal(prior.experiment_outcome,'budget');assert.equal(prior.qualification.native_objective,'pending');assert.equal(prior.progress.usage.model_calls,2);
  const next={...input,request_id:randomUUID(),prior_report_sha256:prior.report_sha256};
  await assert.rejects(api.continueRun(input.request_id,{...next,prior_report_sha256:'b'.repeat(64)}),{status:409});
  const codePath=resolve(directory,'workspace/scripts/improvement-api.mjs'), originalCode=await readFile(codePath);
  await writeFile(codePath,Buffer.concat([originalCode,Buffer.from('\n// changed runtime revision\n')]));
  const changedRuntime=await api.capabilities();
  await assert.rejects(api.continueRun(input.request_id,{...next,loop_version:changedRuntime.loop_version}),{code:'continuation_context_conflict'});
  await writeFile(codePath,originalCode);
  const continued=await api.continueRun(input.request_id,next); assert.equal(continued.continuation_of,input.request_id);assert.equal(child().args[3],'continue-profile');
  child().emit('close',2);await new Promise(r=>setTimeout(r,20));
});
test('native-improve rejects modified profile before spawning a model-capable worker', async t => {
  const {api,body,child}=await fixture(t),caps=await api.capabilities(),profile=caps.iteration_profiles.find(row=>row.id==='aria-soulstride-iteration'),recipe=caps.recipes.find(row=>row.id===profile.recipe_id);
  await assert.rejects(api.submit({...body,operation:'native-improve',loop_version:caps.loop_version,plan:{recipe_id:recipe.id,request_sha256:recipe.request_sha256,profile_id:profile.id,profile_sha256:'c'.repeat(64)}}),{status:409});
  assert.equal(child(),undefined);
});
const stableJson=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stableJson(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stableJson(value[key]))])):value);
const configPin=value=>createHash('sha256').update(stableJson(value)).digest('hex');
async function campaignFixture(t) {
  const f=await fixture(t),caps=await f.api.capabilities(),recipe=caps.recipes.find(row=>row.id==='sonic-metroid-coast-campaign'),profile=caps.iteration_profiles.find(row=>row.id==='sonic-coast-prefix-iteration');
  const loop_config={schema:'prefab-campaign/1',config_version:'synthetic-policy/1',limits:{chunks:2,repairs:1,model_calls:4,native_frames:120,wall_seconds:5,cost_usd:null}};
  return {...f,input:{...f.body,operation:'native-campaign',target:{...f.body.target,game_id:recipe.game_id,artifact_sha256:recipe.baseline_artifact_sha256},loop_version:profile.loop_version,version_basis:profile.version_basis,loop_config,plan:{recipe_id:recipe.id,request_sha256:recipe.request_sha256,profile_id:profile.id,profile_sha256:profile.profile_sha256,loop_config_sha256:configPin(loop_config)}}};
}
test('campaign policy is finite pinned loop input and rejects client paths or cap overrides',async t=>{
  const {api,input,child}=await campaignFixture(t);
  assert.doesNotThrow(()=>createImprovementApi({env:{IMPROVEMENT_CAMPAIGN_MAX_REPAIRS:'0'}}));
  const invalid={...input,loop_config:{...input.loop_config,initial_report_ref:{path:'/private/arbitrary'}}};invalid.plan={...invalid.plan,loop_config_sha256:configPin(invalid.loop_config)};
  await assert.rejects(api.submit(invalid),{code:'invalid_campaign_config'});
  const excessive={...input,loop_config:{...input.loop_config,limits:{...input.loop_config.limits,model_calls:10001}}};excessive.plan={...input.plan,loop_config_sha256:configPin(excessive.loop_config)};
  await assert.rejects(api.submit(excessive),{code:'campaign_limit_exceeded'});assert.equal(child(),undefined);
});
test('campaign worker chains through controller and cooperatively cancels/resumes exact job',async t=>{
  const {api,input,child,directory}=await campaignFixture(t);await api.submit(input);
  assert.equal(child().args[2],'tools.prefab_pipeline.campaign');assert.ok(!child().args.includes('--resume'));
  const output=resolve(directory,input.request_id,'output'),reportPath=resolve(output,'campaign.json');
  await writeFile(reportPath,JSON.stringify({schema:'prefab-campaign/1',status:'running',chunks:[{number:1,status:'completed'}],usage:{model_calls:2,native_frames:60,repairs:0,cost_usd:null},usage_complete:true,qualification:{native_objective:'pending'}}));
  const response={writeHead(code){this.code=code;return this;},end(bytes){this.body=JSON.parse(bytes);}};
  await api.handle({method:'DELETE',headers:{host:'localhost:4175'}},response,`/api/improvement/runs/${input.request_id}`);
  assert.equal(await readFile(resolve(output,'cancel.request'),'utf8'),'requested\n');
  const report={schema:'prefab-campaign/1',status:'cancelled',reason:'cancel_requested',chunks:[{number:1,status:'completed'}],usage:{model_calls:2,native_frames:60,repairs:0,cost_usd:null},usage_complete:true,qualification:{native_objective:'pending'}};
  await writeFile(reportPath,JSON.stringify(report));child().emit('close',0);let cancelled;
  for(let i=0;i<100;i++){cancelled=await api.status(input.request_id);if(cancelled.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.progress.chunks.length,1);assert.equal(cancelled.resume_available,true);
  await assert.rejects(api.resumeCampaign(input.request_id,{loop_version:'f'.repeat(64),campaign_report_sha256:cancelled.report_sha256}),{code:'stale_campaign_resume'});
  await api.resumeCampaign(input.request_id,{loop_version:input.loop_version,campaign_report_sha256:cancelled.report_sha256});assert.ok(child().args.includes('--resume'));
  await assert.rejects(readFile(resolve(output,'cancel.request')),{code:'ENOENT'});
  await writeFile(reportPath,JSON.stringify({...report,status:'blocked',reason:'interrupted_stage_usage_unknown',usage_complete:false}));child().emit('close',1);await new Promise(r=>setTimeout(r,20));
  const blocked=await api.status(input.request_id);await assert.rejects(api.resumeCampaign(input.request_id,{loop_version:input.loop_version,campaign_report_sha256:blocked.report_sha256}),{code:'campaign_resume_unavailable'});
});
test('campaign adopts exact retained prefix request and usage receipt without arbitrary client paths',async t=>{
  const {api,input,child,directory}=await campaignFixture(t);
  const prefixInput={...input,request_id:randomUUID(),operation:'native-improve'};delete prefixInput.loop_config;prefixInput.plan={...input.plan};delete prefixInput.plan.loop_config_sha256;
  await api.submit(prefixInput);const folder=resolve(directory,prefixInput.request_id);await mkdir(resolve(folder,'output'));
  const request=JSON.parse(await readFile(resolve(folder,'request.json'))),artifact={path:resolve(folder,'output/candidate.gba'),sha256:createHash('sha256').update('native').digest('hex')};await writeFile(artifact.path,'native');
  const report={schema:'prefab-iteration/1',request,status:'artifact-built-with-diagnostics',artifact,checkpoint:{state:{path:'private',sha256:'a'.repeat(64)}},usage:{model_calls:2,native_frames:60,cost_usd:null},usage_complete:true,stages:[]};
  await writeFile(resolve(folder,'output/iteration.json'),JSON.stringify(report));await writeFile(resolve(folder,'result.json'),JSON.stringify(report));child().emit('close',0);
  let prefix;for(let i=0;i<100;i++){prefix=await api.status(prefixInput.request_id);if(prefix.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  await api.submit({...input,plan:{...input.plan,adopt_from:{request_id:prefix.request_id,report_sha256:prefix.report_sha256}}});
  const retainedRequest=JSON.parse(await readFile(resolve(directory,input.request_id,'request.json'))),config=JSON.parse(await readFile(resolve(directory,input.request_id,'campaign-config.json')));
  assert.deepEqual(retainedRequest,request);assert.notEqual(retainedRequest.request_id,input.request_id);assert.equal(config.initial_report_ref.sha256,prefix.report_sha256);
  child().emit('close',1);await new Promise(r=>setTimeout(r,20));
});
test('campaign status preserves unknown watchdog usage and rejects stale worker receipt as success',async t=>{
  const {api,input,child,directory}=await campaignFixture(t);await api.submit(input);
  const folder=resolve(directory,input.request_id),reportPath=resolve(folder,'output/campaign.json');
  await writeFile(reportPath,JSON.stringify({schema:'prefab-campaign/1',status:'cancelled',usage:{model_calls:2,native_frames:60},usage_complete:true,chunks:[]}));
  child().emit('close',1);let failed;
  for(let i=0;i<100;i++){failed=await api.status(input.request_id);if(failed.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(failed.status,'failed');
  const metaPath=resolve(folder,'run.json'),meta=JSON.parse(await readFile(metaPath));meta.error={code:'watchdog_usage_unknown'};meta.usage_complete=false;await writeFile(metaPath,JSON.stringify(meta));
  await writeFile(reportPath,JSON.stringify({schema:'prefab-campaign/1',status:'running',usage:{model_calls:2,native_frames:60},usage_complete:true,chunks:[]}));
  const knownLowerBound=await api.status(input.request_id);assert.equal(knownLowerBound.usage_complete,false);assert.equal(knownLowerBound.progress.usage_complete,false);assert.equal(knownLowerBound.resume_available,false);
});
test('new profile authority ignores unrelated provider additions and rejects shared engine drift',async t=>{
  const {api,input,directory}=await campaignFixture(t),before=await api.capabilities(),profile=before.iteration_profiles.find(row=>row.id==='sonic-coast-prefix-iteration');
  assert.equal(profile.version_basis,'recipe-readset/1');assert.equal(input.loop_version,profile.loop_version);
  const fixtureRoot=resolve(directory,'workspace'),registryPath=resolve(fixtureRoot,'contracts/improvement-profile-registry.json'),registry=JSON.parse(await readFile(registryPath));
  await mkdir(resolve(fixtureRoot,'fixtures'));
  await writeFile(resolve(fixtureRoot,'fixtures/rpg-request.json'),JSON.stringify({schema:'synthetic/1',rom:{path:'fixture.bin',sha256:createHash('sha256').update('fixture').digest('hex')}}));
  await writeFile(resolve(fixtureRoot,'fixtures/rpg-profile.json'),JSON.stringify({schema:'prefab-iteration/1',limits:{wall_seconds:1},experiment:{},runtime_manifest:{version_basis:'recipe-readset/1',recipe_id:'unrelated-rpg'}}));
  registry.recipes.push({id:'unrelated-rpg',file:'fixtures/rpg-request.json'});registry.iteration_profiles.push({id:'unrelated-rpg-profile',recipe_id:'unrelated-rpg',file:'fixtures/rpg-profile.json',version_basis:'recipe-readset/1'});
  await writeFile(registryPath,JSON.stringify(registry));const extended=await api.capabilities();
  assert.notEqual(extended.loop_version,before.loop_version);assert.equal(extended.iteration_profiles.find(row=>row.id===profile.id).loop_version,profile.loop_version);
  const runner=resolve(fixtureRoot,'tools/prefab_pipeline/iteration.py');await writeFile(runner,`${await readFile(runner,'utf8')}\n# shared engine change\n`);
  assert.notEqual((await api.capabilities()).iteration_profiles.find(row=>row.id===profile.id).loop_version,profile.loop_version);
});
test('original artifact traversal stays partial and never fabricates build or changed-mechanic quality',async t=>{
  const {api,body,child,directory}=await fixture(t),fixtureRoot=resolve(directory,'workspace'),registryPath=resolve(fixtureRoot,'contracts/improvement-profile-registry.json'),registry=JSON.parse(await readFile(registryPath));
  await mkdir(resolve(fixtureRoot,'fixtures'));
  const artifact={path:'fixture.bin',sha256:createHash('sha256').update('fixture').digest('hex')},request={schema:'native-artifact-traversal-request/1',role:'original',game_id:'pokemon-emerald-version',source_revision:'synthetic-original/1',artifact};
  await writeFile(resolve(fixtureRoot,'fixtures/rpg-request.json'),JSON.stringify(request));
  await writeFile(resolve(fixtureRoot,'fixtures/rpg-profile.json'),JSON.stringify({schema:'prefab-iteration/1',limits:{wall_seconds:1},experiment:{},runtime_manifest:{version_basis:'recipe-readset/1',recipe_id:'original-rpg'}}));
  registry.recipes.push({id:'original-rpg',game_id:request.game_id,file:'fixtures/rpg-request.json',baseline_artifact_sha256:artifact.sha256,operations:['native-improve','native-campaign'],quality:'traversal-only'});registry.iteration_profiles.push({id:'original-rpg-profile',recipe_id:'original-rpg',file:'fixtures/rpg-profile.json',version_basis:'recipe-readset/1'});await writeFile(registryPath,JSON.stringify(registry));
  const caps=await api.capabilities(),recipe=caps.recipes.find(row=>row.id==='original-rpg'),profile=caps.iteration_profiles.find(row=>row.id==='original-rpg-profile');
  const input={...body,operation:'native-improve',version_basis:profile.version_basis,loop_version:profile.loop_version,target:{...body.target,game_id:request.game_id,artifact_sha256:artifact.sha256},plan:{recipe_id:recipe.id,request_sha256:recipe.request_sha256,profile_id:profile.id,profile_sha256:profile.profile_sha256}};
  await assert.rejects(api.submit({...input,operation:'native-mod'}),{code:'unsupported_recipe_operation'});
  await api.submit(input);const folder=resolve(directory,input.request_id);assert.deepEqual(JSON.parse(await readFile(resolve(folder,'request.json'))),request);await mkdir(resolve(folder,'output'));const retained={path:resolve(folder,'output/original.gba'),sha256:artifact.sha256};await writeFile(retained.path,'fixture');
  const report={schema:'prefab-iteration/1',status:'partial',artifact_status:'artifact-reused',artifact:retained,stages:[{name:'artifact-reference',status:'completed',wall_seconds:0.01}],usage:{model_calls:1,native_frames:2,cost_usd:null},usage_complete:true};await writeFile(resolve(folder,'output/iteration.json'),JSON.stringify(report));await writeFile(resolve(folder,'result.json'),JSON.stringify(report));child().emit('close',0);
  let done;for(let i=0;i<100;i++){done=await api.status(input.request_id);if(done.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(done.status,'partial');assert.equal(done.artifact_status,'artifact-reused');assert.equal(done.timings.build_s,null);assert.equal(done.quality.kind,'artifact-traversal-only');
});
test('capabilities separate public fixtures from unqualified local original inputs', async t => {
  const {api}=await fixture(t),caps=await api.capabilities();
  for(const row of [...caps.recipes,...caps.iteration_profiles]){
    assert.equal(row.availability.input_mode,'original-required');assert.equal(row.availability.executable,false);
    if(row.request_template)assert.equal(row.request_template.schema,'gameverse.improvement-request/1');
  }
  assert.equal(caps.unsupported_modes[0].availability.executable,false);
  assert.equal(caps.unsupported_modes[0].ir_regeneration,false);
  assert.equal(caps.fixtures[0].availability.executable,false);
});
test('public fixture executes existing engine without original material and retains pinned JSON evidence', async t => {
  const {directory}=await fixture(t),fixtureRoot=resolve(directory,'workspace');
  const real=(await createImprovementApi({root}).capabilities()).fixtures[0];
  for(const ref of real.executor_pins){const path=resolve(fixtureRoot,ref.path);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,await readFile(resolve(root,ref.path)));}
  const api=createImprovementApi({root:fixtureRoot,directory:resolve(directory,'public-runs')});
  const caps=await api.capabilities(),publicFixture=caps.fixtures[0];
  assert.equal(publicFixture.availability.executable,true);assert.equal(publicFixture.request.limits.max_repairs,0);
  const body={...publicFixture.request_template,request_id:randomUUID()};
  await assert.rejects(api.submit({...body,plan:{...body.plan,executor_sha256:'a'.repeat(64)}}),{status:409});
  await api.submit(body);assert.equal((await api.submit(structuredClone(body))).request_id,body.request_id);
  let done;for(let i=0;i<200;i++){done=await api.status(body.request_id);if(done.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(done.status,'completed');assert.equal(done.result.action_count,18);assert.equal(done.quality.model_calls,0);assert.equal(done.quality.gba_generation,false);assert.equal(done.artifacts.rom,undefined);assert.ok(done.artifacts.result);
  const result=JSON.parse(await readFile(done.result_path));assert.equal(result.schema,'gameverse.reference-fixture-result/1');assert.equal(result.game_material_required,false);
});
