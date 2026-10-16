// Local agent seam. Registered native recipes remain the authority for supported edits.
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, realpath, copyFile, unlink, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerState, stopOwner } from './improvement-worker.mjs';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const fail = (status, code, message) => Object.assign(Error(message), { status, code });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const recipes = [
  { id: 'aria-soulstride-controlled-lunge', command: 'build-mod', file: 'tools/prefab_pipeline/requests/aria-soulstride-controlled-lunge.json', quality:'build-only', description:'Explicit controlled repair fixture: legal 1px native lunge baseline with a reviewed 3px repair variant; not the original Soulstride baseline.' },
  { id: 'aria-double-xp', command: 'mod-rom', file: 'tools/prefab_pipeline/requests/aria-double-xp.json', quality: 'bounded-native-corridor', description: 'Double defeat XP; 14,720 differential vectors and original/parity/modified native corridor are repeated.' },
  { id: 'aria-soulstride', command: 'build-mod', file: 'tools/prefab_pipeline/requests/aria-soulstride.json', quality: 'build-only', description: 'Connected native bone birth/lunge, moving-defeat MP refund and soul progression. Build does not certify gameplay or campaign.' },
];
const iterationProfiles = [{ id: 'aria-soulstride-iteration', recipe_id: 'aria-soulstride-controlled-lunge', file: 'tools/prefab_pipeline/profiles/aria-soulstride-iteration.json' }];
const mechanismFiles = ['scripts/improvement-api.mjs', 'scripts/improvement-worker.mjs', 'tools/prefab_pipeline/native_cli.py', 'tools/prefab_pipeline/mod_rom.py', 'tools/prefab_pipeline/native_mod.py', 'tools/composition/native_build.py', 'tools/composition/resolve.py', 'tools/prefab_pipeline/contract.py', 'tools/prefab_pipeline/momentum_strategy.py', 'tools/prefab_pipeline/reward_strategy.py', 'tools/prefab_pipeline/soulstride_movement.py', 'tools/prefab_pipeline/soulstride_progression.py', 'tools/prefab_pipeline/soul_eligibility.py', 'tools/re/session/bridge.py', 'tools/re/session/session.c'];
const referenceRequest={schema:'gameverse.reference-fixture-request/1',fixture_id:'reference-key-door',operation:'engine-demonstration',limits:{max_actions:32,max_wall_s:5,max_repairs:0}};
const referenceFiles=['scripts/improvement-worker.mjs','tools/prefab_pipeline/reference_fixture.py','tools/prefab_pipeline/__init__.py','tools/playtester/__init__.py','tools/playtester/adapters.py','tools/playtester/core.py','tools/playtester/examples/key-door.json'];
let pythonProbe;
function pythonAvailable(){return pythonProbe??=new Promise(resolveProbe=>execFile('python3',['--version'],{timeout:1000,maxBuffer:1024},(error,stdout,stderr)=>resolveProbe(!error&&/^Python 3\./.test(`${stdout}${stderr}`))));}
const safeMissing=values=>(values||[]).map(value=>typeof value==='string'&&!value.startsWith('/')&&!value.split('/').includes('..')&&!/[\r\n]/.test(value)?value:'A configured local input is unavailable.');
function decorateCapabilities(capabilities){
  const decorate=(row,recipe,profile)=>{
    const missing=safeMissing([...(recipe.missing_inputs||[]),...(profile?.missing_inputs||[])]),installed=recipe.installed&&(!profile||profile.installed);
    row.availability={status:installed?'setup-required':'original-required',input_mode:'original-required',execution_ready:false,executable:false,missing_inputs:missing,
      prerequisites:[{kind:'provider-inputs',status:installed?'present':'missing',label:'Exact local original-game inputs',detail:installed?'Declared content pins are installed; this is not a runtime qualification.':'Original game material and reviewed native/provider inputs are not bundled with this public checkout.'},
        {kind:'runtime',status:'unverified',label:profile?'Native session and configured S1/S2 provider':'Native toolchain',detail:'The capabilities read does not boot a game, compile a cartridge or contact a model provider.'}],
      setup:['For native recipes, supply the exact user-authorized original and reviewed provider inputs.','Check/install from an authorized checkout: node scripts/improvement-provider.mjs --manifest contracts/improvement-provider-pack.json --source AUTHORIZED_CHECKOUT --check (then --install).',profile?'Configure the local native session bridge and GAMEVERSE_SID_ENV_FILE; no key values are sent to this API.':'Verify the documented ARM-capable Clang and GNU ARM binutils setup.','See contracts/IMPROVEMENT_HANDOFF.md; exported request context must come from the environment harness.']};
    const operation=profile?'native-improve':(recipe.operations||['native-mod']).includes('native-mod')?'native-mod':null;
    row.request_template=operation?{schema:'gameverse.improvement-request/1',request_id:null,operation,intent:null,target:{role:'subgame',game_id:recipe.game_id,game_version:null,artifact_sha256:recipe.baseline_artifact_sha256,base_game_version:null,base_artifact_sha256:null},environment:{version:null,config_sha256:null},loop_version:profile?.loop_version||capabilities.loop_version,
      ...(profile?.version_basis?{version_basis:profile.version_basis}:{}),plan:{recipe_id:recipe.id,request_sha256:recipe.request_sha256,...(profile?{profile_id:profile.id,profile_sha256:profile.profile_sha256}:{})}}:null;
    row.required_context=['intent','target.game_version','target.base_game_version','target.base_artifact_sha256','environment.version','environment.config_sha256'];
    row.result_routes={status:'/api/improvement/runs/{request_id}',result:'/api/improvement/runs/{request_id}/artifacts/result'};
  };
  for(const recipe of capabilities.recipes)decorate(recipe,recipe,null);
  for(const profile of capabilities.iteration_profiles){const recipe=capabilities.recipes.find(row=>row.id===profile.recipe_id);if(recipe)decorate(profile,recipe,profile);}
  capabilities.unsupported_modes=[{id:'private-bundle-reassembly',scope:'rebuild-only artifact reassembly after private bundle admission',original_game_material_in_bundle:true,external_original_file_required_after_import:false,source_checkout_required_after_import:false,ir_regeneration:false,modification:false,
    availability:{status:'unsupported',input_mode:'self-contained-components',execution_ready:false,executable:false,prerequisites:[{kind:'backend',status:'missing',label:'Private bundle API backend',detail:'Research CLI capability is not shipped or registered in this API build.'}],setup:['No upload or execution route is available in this API release.'],missing_inputs:[]}}];
  return capabilities;
}
async function atomic(path, value) { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, path); }
export function createImprovementApi({ root = workspace, directory = resolve(root, 'local-data/improvement-runs'), timeoutMs = 90000, spawnImpl = spawn, env = process.env } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw Error('Invalid improvement worker timeout.');
  let active = null, submitting = false;
  const campaignCeilings = Object.fromEntries(Object.entries({chunks:128,repairs:32,model_calls:10000,native_frames:10000000,wall_seconds:86400}).map(([key,fallback])=>{
    const value=Number(env[`IMPROVEMENT_CAMPAIGN_MAX_${key.toUpperCase()}`]??fallback);
    if(!Number.isSafeInteger(value)||value<(key==='repairs'?0:1))throw Error('Invalid operator campaign ceiling');return [key,value];
  }));
  function campaignConfig(body) {
    const config=body.loop_config;
    if(config?.schema!=='prefab-campaign/1'||typeof config.config_version!=='string'||!config.config_version.trim()||Object.keys(config).some(key=>!['schema','config_version','limits'].includes(key)))throw fail(400,'invalid_campaign_config','Provide a versioned campaign loop_config; no paths or executable selectors are accepted.');
    if(body.plan?.loop_config_sha256!==sha(canonical(config)))throw fail(409,'stale_campaign_config','Pin the exact canonical campaign loop_config digest.');
    if(!config.limits||Object.keys(config.limits).sort().join(',')!=='chunks,cost_usd,model_calls,native_frames,repairs,wall_seconds')throw fail(400,'invalid_campaign_limits','Supply every finite campaign resource cap and explicit nullable cost.');
    for(const [key,ceiling]of Object.entries(campaignCeilings)){const value=config.limits[key];if(!Number.isFinite(value)||(key!=='wall_seconds'&&!Number.isInteger(value))||value<(key==='repairs'?0:1)||value>ceiling)throw fail(422,'campaign_limit_exceeded','Campaign loop configuration exceeds an operator ceiling or contains invalid resource caps.');}
    if(config.limits.cost_usd!==null)throw fail(422,'cost_budget_unverifiable','This provider requires explicit null cost usage; enforceable model/frame/time caps remain mandatory.');
    return {...config,run_id:body.request_id};
  }
  const dir = id => resolve(directory, id);
  const ownerPath=id=>resolve(dir(id),'worker-owner.json');
  async function spawnWorker(id,args,deadline){
    if(spawnImpl!==spawn)return spawnImpl('python3',args,{cwd:root,detached:true,stdio:['ignore','ignore','ignore']});
    const token=randomUUID();await atomic(ownerPath(id),{schema:'gameverse.worker-owner/1',state:'starting',token});
    return spawn(process.execPath,[fileURLToPath(new URL('./improvement-worker.mjs',import.meta.url)),ownerPath(id),'python3',...args],{cwd:root,detached:true,stdio:'ignore',env:{...process.env,GAMEVERSE_WORKER_TOKEN:token,GAMEVERSE_WORKER_TIMEOUT_MS:String(deadline)}});
  }
  async function assertNoRecoveredWorker(){
    for(const id of await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
      if(!uuid(id)||active?.id===id)continue;
      const owner=await ownerState(ownerPath(id));
      if(owner&&owner.state!=='terminal')throw fail(409,'worker_ownership_pending','A retained worker is alive or its ownership is unresolved; cancel/reconcile it before another dispatch.');
    }
  }
  async function shutdown(){
    for(const id of await readdir(directory).catch(()=>[]))if(uuid(id)){
      const owner=await ownerState(ownerPath(id));if(owner&&owner.state!=='terminal')await stopOwner(ownerPath(id),'shutdown');
    }
  }

  async function recipeInfo(recipe) {
    const bytes = await readFile(resolve(root, recipe.file)), request = JSON.parse(bytes), missing = [], runtimePins = [], visited = new Set(), actualRoot = await realpath(root);
    async function inspect(value) {
      if (!value || typeof value !== 'object') return;
      const reference = typeof value.path === 'string' ? value.path : value.ref;
      if (typeof reference === 'string' && digest(value.sha256) && !visited.has(reference)) {
        visited.add(reference);
        try {
          const file = await realpath(resolve(root, reference)), content = await readFile(file);
          if (file.startsWith(actualRoot+sep) && !reference.startsWith('/')) runtimePins.push({path:reference,sha256:sha(content)});
          if (!file.startsWith(actualRoot + sep) || sha(content) !== value.sha256) missing.push(reference);
          else if (file.endsWith('.json')) await inspect(JSON.parse(content));
        } catch { missing.push(reference); }
      }
      if (value.source_pins && typeof value.source_pins === 'object' && !Array.isArray(value.source_pins)) {
        for (const [path, sha256] of Object.entries(value.source_pins)) if (digest(sha256) && !path.endsWith('.plan.json')) await inspect({ path, sha256 }); // Historical qualification plans are independently repinned by backend admission.
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') await inspect(child);
    }
    let providerManifest;
    try { providerManifest = await readJson(resolve(root, 'contracts/improvement-provider-pack.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (providerManifest) {
      const declaredRecipe = providerManifest.recipes?.find(row => row.id === recipe.id);
      if (providerManifest.schema !== 'gameverse.improvement-provider-pack/1' || !Array.isArray(providerManifest.files)
        || declaredRecipe?.request_path !== recipe.file || declaredRecipe?.request_sha256 !== sha(bytes)) throw Error('Invalid provider manifest');
      const rows = providerManifest.files.filter(row => row.recipes?.includes(recipe.id));
      if (!rows.length) throw Error('Empty provider readset');
      for (const row of rows) {
        // The reviewed runtime readset excludes historical captures. Never follow
        // a metadata-only historical path or expose arbitrary absolute paths.
        if (typeof row.path !== 'string' || !row.path || row.path.startsWith('/') || row.path.split('/').includes('..') || !digest(row.sha256)) throw Error('Unsafe provider readset');
        try { const path = await realpath(resolve(root, row.path)), actual=sha(await readFile(path)); if(path.startsWith(actualRoot+sep)) runtimePins.push({path:row.path,sha256:actual}); if (!path.startsWith(actualRoot + sep) || actual !== row.sha256) missing.push(row.path); }
        catch { missing.push(row.path); }
      }
    } else await inspect(request);
    return { ...recipe, request, request_sha256: sha(bytes), runtime_pins:runtimePins, installed: !missing.length, missing_inputs: [...new Set(missing)],
      prerequisite_basis: providerManifest ? 'reviewed-provider-runtime-readset' : 'recursive-declared-pins', provenance_warnings: providerManifest?.closure?.provenance_warnings?.filter(row => row.recipe === recipe.id) || [],
      game_id:recipe.game_id||request.game_id||'castlevania-aria-of-sorrow', baseline_artifact_sha256: recipe.baseline_artifact_sha256||request.rom?.sha256||request.artifact?.sha256, source_rom_sha256:request.rom?.sha256||request.source_rom?.sha256||request.artifact?.sha256||null };
  }
  async function profileInfo(profile) {
    try {
      const bytes = await readFile(resolve(root, profile.file)), config = JSON.parse(bytes), missing = [], pins = [], visited = new Set(), actualRoot = await realpath(root);
      async function inspect(value) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.path === 'string' && digest(value.sha256) && !visited.has(value.path)) {
          const path = value.path; visited.add(path);
          if (path.startsWith('/') || path.split('/').includes('..')) { missing.push('profile_contains_nonportable_pin'); return; }
          try { const file = await realpath(resolve(root,path)), actual = sha(await readFile(file)); pins.push({path,sha256:actual}); if (!file.startsWith(actualRoot+sep) || (value.sha256 !== '0'.repeat(64) && actual !== value.sha256)) missing.push(path); }
          catch { missing.push(path); }
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') await inspect(child);
      }
      await inspect(config);
      if(profile.version_basis&&config.runtime_manifest?.version_basis!==profile.version_basis)missing.push('profile_runtime_version_basis_mismatch');
      if (config.schema !== 'prefab-iteration/1' || !config.limits || !Number.isFinite(config.limits.wall_seconds)) throw Error('Invalid profile');
      return { ...profile, profile_sha256:sha(bytes), installed:!missing.length, missing_inputs:[...new Set(missing)], limits:config.limits,
        environment_version:config.environment_version, adapter_version:config.adapter_version, model_policy: { confidence:config.experiment?.confidence, margin:config.experiment?.margin, confidence_basis:config.experiment?.confidence_basis, system2:'confidence-gated-existing-playtester' }, input_pins:pins };
    } catch { return {...profile,installed:false,missing_inputs:[profile.file]}; }
  }
  async function referenceInfo(){
    const pins=[],missing=[];
    for(const path of referenceFiles){try{pins.push({path,sha256:sha(await readFile(resolve(root,path)))});}catch{missing.push(path);}}
    const python=await pythonAvailable(),ready=python&&!missing.length;
    const request_sha256=sha(canonical(referenceRequest)),executor_sha256=sha(canonical(pins));
    return {id:'reference-key-door',operation:'reference-fixture',scope:'Authored GridAdapter observe/act loop and action-log replay only; not original-game reconstruction, GBA generation or model-driven repair.',artifact_kind:'authored-grid-reference',game_material_required:false,gba_generation:false,model_calls:false,repair:false,checkpoint_kind:'action-log-replay',request:referenceRequest,request_sha256,executor_sha256,executor_pins:pins,
      availability:{status:ready?'ready':missing.length?'missing-inputs':'setup-required',input_mode:'authored-fixture',execution_ready:ready,executable:ready,missing_inputs:missing,
        prerequisites:[{kind:'public-inputs',status:missing.length?'missing':'present',label:'Tracked authored reference fixture',detail:'Standard-library executor, existing Playtester/GridAdapter/FrontierPolicy and key-door JSON.'},{kind:'python',status:python?'present':'missing',label:'Python 3',detail:'Interpreter availability only; no original ROM, source checkout or provider credentials required.'}],setup:ready?['Ready to run this authored reference fixture without private game inputs.']:['Restore missing tracked fixture files and install Python 3.']},
      request_template:{schema:'gameverse.improvement-request/1',request_id:null,operation:'reference-fixture',plan:{fixture_id:'reference-key-door',request_sha256,executor_sha256}},required_context:[],result_routes:{status:'/api/improvement/runs/{request_id}',result:'/api/improvement/runs/{request_id}/artifacts/result'}};
  }
  async function capabilities() {
    let registry={recipes:[],iteration_profiles:[]};
    try {
      registry=await readJson(resolve(root,'contracts/improvement-profile-registry.json'));
      if(registry.schema!=='gameverse.improvement-profile-registry/1'||!Array.isArray(registry.recipes)||!Array.isArray(registry.iteration_profiles))throw Error('Invalid data registry');
      for(const row of [...registry.recipes,...registry.iteration_profiles])if(!/^[a-z0-9._-]{1,100}$/.test(row.id)||typeof row.file!=='string'||row.file.startsWith('/')||row.file.split('/').includes('..'))throw Error('Unsafe data registry');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const recipeDeclarations=[...recipes,...registry.recipes],profileDeclarations=[...iterationProfiles,...registry.iteration_profiles];
    if(new Set(recipeDeclarations.map(row=>row.id)).size!==recipeDeclarations.length||new Set(profileDeclarations.map(row=>row.id)).size!==profileDeclarations.length)throw Error('Duplicate registration');
    const registered = await Promise.all(recipeDeclarations.map(async recipe => { try { return await recipeInfo(recipe); } catch { return { ...recipe, installed: false, missing_inputs: [recipe.file] }; } }));
    const profiles = await Promise.all(profileDeclarations.map(profileInfo));
    const mechanisms = await Promise.all(mechanismFiles.map(async path => ({ path, sha256: sha(await readFile(resolve(root, path))) })));
    try { mechanisms.push({ path: 'contracts/improvement-provider-pack.json', sha256: sha(await readFile(resolve(root, 'contracts/improvement-provider-pack.json'))) }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const recipe of registered) mechanisms.push(...(recipe.runtime_pins||[]));
    for (const profile of profiles) { if(profile.profile_sha256) mechanisms.push({path:profile.file,sha256:profile.profile_sha256}); mechanisms.push(...(profile.input_pins||[])); }
    for (const path of ['tools/prefab_pipeline/__main__.py','tools/prefab_pipeline/iteration.py','tools/prefab_pipeline/campaign.py']) { try { mechanisms.push({path,sha256:sha(await readFile(resolve(root,path)))}); } catch(error) { if(error.code!=='ENOENT')throw error; } }
    const uniquePins=pins=>[...new Map(pins.map(row=>[row.path,{path:row.path,sha256:row.sha256}])).values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const corePaths=['scripts/improvement-api.mjs','scripts/improvement-worker.mjs','tools/prefab_pipeline/__main__.py','tools/prefab_pipeline/iteration.py','tools/prefab_pipeline/campaign.py'];
    for(const profile of profiles.filter(row=>row.version_basis==='recipe-readset/1')) {
      const recipe=registered.find(row=>row.id===profile.recipe_id),files=uniquePins((recipe?.runtime_pins||[]).filter(row=>!['contracts/improvement-provider-pack.json','contracts/improvement-profile-registry.json'].includes(row.path)));
      const readset={schema:'gameverse.runtime-readset/1',recipe_id:profile.recipe_id,files};
      profile.runtime_readset_pin={...readset,sha256:sha(canonical(readset))};
      const registration=recipeDeclarations.find(row=>row.id===profile.recipe_id);
      const authority={schema:'gameverse.profile-loop-version/1',version_basis:'recipe-readset/1',recipe:registration,request_sha256:recipe?.request_sha256||null,
        profile:profileDeclarations.find(row=>row.id===profile.id),profile_sha256:profile.profile_sha256||null,runtime_readset_sha256:profile.runtime_readset_pin.sha256,
        input_pins:uniquePins(profile.input_pins||[]),core:uniquePins(mechanisms.filter(row=>corePaths.includes(row.path)))};
      profile.loop_version=sha(canonical(authority));profile.version_authority=authority;
    }
    const fixtures=[await referenceInfo()];
    return decorateCapabilities({ schema: 'gameverse.improvement-capabilities/1', adapter_version: 'native-recipe/1', loop_version: sha(canonical(mechanisms)), mechanisms,
      operations: ['native-mod', 'native-improve', 'native-campaign','reference-fixture'],fixtures, recipes: registered, iteration_profiles:profiles, campaign_policy:{schema:'prefab-campaign/1',loop_config_input:'versioned policy supplied by loop owner; voice intent does not select budgets',hard_ceilings:campaignCeilings,automatic_checkpoint_chunks:true}, supports: { free_text_planning: false, whole_game_ir: false, reconstruction: false, player_activation: false, save_migration: false, cancel: true, continuation:true, model_playtesting:true, campaign_resume:true },
      resources: { concurrent_runs: 1, worker_timeout_ms: timeoutMs, queue: 'reject-when-busy', model_calls: 'native-mod: 0; native-improve: registered profile limits; native-campaign: exact versioned loop_config caps' },
      boundary: 'Shishir produces candidate artifacts and evidence. Vishal owns hosting, discovery, accepted versions, saves and activation.' });
  }
  async function status(id) {
    if (!uuid(id)) throw fail(404, 'not_found', 'Run not found.');
    let record; try { record = await readJson(resolve(dir(id), 'run.json')); } catch (e) { if (e.code === 'ENOENT') throw fail(404, 'not_found', 'Run not found.'); throw e; }
    if(['native-improve','native-campaign'].includes(record.input?.operation)) {
      try {
        const isCampaign=record.input.operation==='native-campaign';
        const bytes=await readFile(resolve(dir(id),isCampaign?'output/campaign.json':'output/iteration.json')), engine=JSON.parse(bytes);
        record.report_sha256=sha(bytes); record.engine_status=engine.status; record.engine_reason=engine.reason||null; record.experiment_outcome=engine.experiment_outcome||null; record.qualification=engine.qualification||null;
        record.progress={chunks:engine.chunks||[],attempts:engine.attempts?.length||0,stages:engine.stages?.map(row=>({name:row.name,attempt:row.attempt,status:row.status,wall_seconds:row.wall_seconds}))||[],usage:engine.usage,usage_complete:engine.usage_complete};
        record.checkpoint_available=!!(engine.checkpoint||engine.latest_iteration); record.resume_available=isCampaign&&['cancelled','running'].includes(engine.status)&&engine.usage_complete===true&&record.error?.code!=='watchdog_usage_unknown'; record.usage=engine.usage; record.usage_complete=record.error?.code==='watchdog_usage_unknown'?false:engine.usage_complete;
        if(record.error?.code==='watchdog_usage_unknown')record.progress.usage_complete=false;
        record.artifacts[isCampaign?'campaign':'iteration']=`/api/improvement/runs/${id}/artifacts/${isCampaign?'campaign':'iteration'}`;
        if(engine.artifact?.path && digest(engine.artifact.sha256)) {
          const candidate=await realpath(engine.artifact.path), ownDirectory=await realpath(dir(id));
          if(candidate.startsWith(ownDirectory+sep) && sha(await readFile(candidate))===engine.artifact.sha256) {
            record.artifact_ref=engine.artifact;record.artifact_sha256=engine.artifact.sha256;
            record.artifacts.rom=`/api/improvement/runs/${id}/artifacts/rom`;
          }
        }
        record.engine_observations={qualification:engine.qualification||null,objective_witness:engine.objective_witness||null,attempts:engine.attempts||[],continuation:engine.config?.continuation||null};
        if(isCampaign) {
          const row=engine.chunks?.at(-1), childPath=row?.output?resolve(row.output,'iteration.json'):null;
          if(childPath) {
            const own=await realpath(dir(id)),actual=await realpath(childPath).catch(()=>null);
            if(actual&&actual.startsWith(own+sep)) {
              const childBytes=await readFile(actual),child=JSON.parse(childBytes);
              record.campaign_progress={chunk:row.number,report_sha256:sha(childBytes),status:child.status,qualification:child.qualification||null,scenario_state:child.checkpoint?.scenario_state||null,objective_witness:child.objective_witness||null,usage:child.usage,usage_complete:child.usage_complete};
            }
          }
        }
      } catch(error) {if(error.code!=='ENOENT')throw error;}
    }
    const owner=await ownerState(ownerPath(id));
    if(owner?.state==='running'&&active?.id!==id)return {...record,status:'running',worker_ownership:'recovered',resume_available:false};
    if(owner&&owner.state!=='terminal'&&active?.id!==id)return {...record,status:'interrupted',worker_ownership:'unknown',resume_available:false,error:{code:'worker_ownership_unknown',message:'Retained worker identity cannot be authenticated; dispatch/resume blocked.'}};
    if(owner?.state==='terminal'&&owner.stop_reason&&active?.id!==id)return {...record,status:owner.stop_reason==='cancelled'?'cancelled':'interrupted',worker_ownership:'stopped',resume_available:false,usage_complete:false,error:{code:`worker_${owner.stop_reason}`,message:'Owned worker stopped; retained evidence and usage must be reconciled before continuation.'}};
    if (record.status === 'running' && active?.id !== id) return { ...record, status: 'interrupted', error: { code: 'worker_interrupted', message: record.input.operation==='native-campaign'?'Campaign worker unavailable; explicit resume reconciles existing receipts and blocks unknown usage.':'Worker unavailable after server restart; evidence retained. Use a new request ID.' } };
    return record;
  }
  async function submitReference(body){
    const fixture=await referenceInfo(),id=body.request_id,fingerprint=sha(canonical(body));
    if(body.plan?.fixture_id!==fixture.id)throw fail(422,'unsupported_fixture','Choose a registered authored reference fixture.');
    if(body.plan.request_sha256!==fixture.request_sha256||body.plan.executor_sha256!==fixture.executor_sha256)throw fail(409,'stale_fixture','Refresh the exact public fixture configuration/executor pins.');
    try{const prior=await status(id);if(prior.request_sha256!==fingerprint)throw fail(409,'idempotency_conflict','Request ID belongs to different input.');return prior;}catch(error){if(error.code!=='not_found')throw error;}
    if(!fixture.availability.execution_ready)throw fail(422,'fixture_setup_required','The public fixture executor or Python interpreter is unavailable.');
    if(active||submitting)throw fail(409,'busy','A worker is already running.');
    await assertNoRecoveredWorker();
    if(active||submitting)throw fail(409,'busy','A worker is already running.');
    submitting=true;
    try{
      await mkdir(directory,{recursive:true});await mkdir(dir(id));
      const record={schema:'gameverse.improvement-run/1',request_id:id,request_sha256:fingerprint,status:'running',phase:'reference-fixture',received_at:new Date().toISOString(),input:body,resolved_fixture:fixture,candidate_only:true,artifacts:{},timings:{queue_s:null,execution_wall_s:null,build_s:null,simulation_s:null,evaluation_s:null,accounting:'Reference executor wall time is nested within worker execution; no native build or provider calls.'}};
      await atomic(resolve(dir(id),'run.json'),record);await atomic(resolve(dir(id),'request.json'),{...referenceRequest,request_id:id});
      const child=await spawnWorker(id,['-B','-m','tools.prefab_pipeline.reference_fixture','--request',resolve(dir(id),'request.json'),'--output',resolve(dir(id),'output')],10000),started=performance.now();let stopped=null,finished=false;
      const stop=reason=>{stopped=reason;if(spawnImpl===spawn)return stopOwner(ownerPath(id),reason);try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};active={id,stop};const timer=setTimeout(()=>{void Promise.resolve(stop('timeout')).catch(()=>{});},10000);
      const finish=async(code,error)=>{if(finished)return;finished=true;clearTimeout(timer);try{
        stopped??=(await ownerState(ownerPath(id)))?.stop_reason;
        const path=resolve(dir(id),'output/result.json'),bytes=await readFile(path).catch(()=>null),result=bytes?JSON.parse(bytes):null;
        record.status=stopped==='cancelled'?'cancelled':!stopped&&!error&&code===0&&result?.status==='passed'?'completed':'failed';record.phase='terminal';record.finished_at=new Date().toISOString();record.timings.execution_wall_s=(performance.now()-started)/1000;
        record.result=result;record.engine_status=result?.status||null;record.error=record.status==='failed'?{code:stopped||'reference_fixture_failed',message:'The authored reference fixture did not pass; inspect retained evidence.'}:null;
        record.quality={scope:'reference_grid_engine',artifact_kind:'authored-grid-reference',game_material_required:false,gba_generation:false,model_calls:0,repair:false,checkpoint_kind:'action-log-replay',whole_game_equivalent:null};
        if(bytes){record.result_path=path;record.result_sha256=sha(bytes);record.artifacts.result=`/api/improvement/runs/${id}/artifacts/result`;}
        await atomic(resolve(dir(id),'run.json'),record);
      }catch{record.status='failed';record.error={code:'invalid_fixture_result',message:'Reference fixture result could not be verified.'};await atomic(resolve(dir(id),'run.json'),record);}finally{if(active?.id===id)active=null;}};
      child.on('error',error=>{void finish(null,error);});child.on('close',code=>{void finish(code);});return record;
    }finally{submitting=false;}
  }
  async function launchCampaign(record, resume) {
    const id=record.request_id,folder=resolve(dir(id),'output'),reportPath=resolve(folder,'campaign.json');
    await mkdir(folder,{recursive:true});
    if(resume)await unlink(resolve(folder,'cancel.request')).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const priorWall=record.timings.execution_wall_s||0,started=performance.now();
    record.status='running';record.error=null;record.phase='automatic-native-campaign';record.resume_count=(record.resume_count||0)+(resume?1:0);await atomic(resolve(dir(id),'run.json'),record);
    const child=await spawnWorker(id,['-B','-m','tools.prefab_pipeline.campaign','--request',resolve(dir(id),'request.json'),'--template',resolve(root,record.resolved_profile.file),'--config',resolve(dir(id),'campaign-config.json'),'--output',folder,...(resume?['--resume']:[])],Math.max(timeoutMs,Math.ceil(record.campaign_config.limits.wall_seconds*1000)+15000));
    let forced=null,finished=false;
    const force=()=>{forced='watchdog_usage_unknown';if(spawnImpl===spawn){void stopOwner(ownerPath(id),'timeout').catch(()=>{});return;}try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
    active={id,stop:async()=>{await writeFile(resolve(folder,'cancel.request'),'requested\n',{mode:0o600});}};
    const timer=setTimeout(force,Math.max(timeoutMs,Math.ceil(record.campaign_config.limits.wall_seconds*1000)+15000));
    const finish=async(code,error)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      try {
        const stopReason=(await ownerState(ownerPath(id)))?.stop_reason;if(stopReason)forced=`${stopReason}_usage_unknown`;
        const bytes=await readFile(reportPath).catch(()=>null),result=bytes?JSON.parse(bytes):null;
        record.status=forced||error||!result||(code!==0&&result.status!=='blocked')?'failed':({success:'completed',partial:'partial',cancelled:'cancelled',blocked:'blocked'})[result.status]||'failed';
        record.phase='terminal';record.finished_at=new Date().toISOString();record.timings.execution_wall_s=priorWall+(performance.now()-started)/1000;record.timings.backend_total_s=result?.total_wall_seconds??null;
        record.timings.accounting='Campaign total includes resume downtime and retained prefix; active wall nests chunk stages. Composite experiment includes model calls; queue unavailable.';
        record.result=result;record.result_path=reportPath;record.engine_status=result?.status||null;record.engine_reason=result?.reason||forced;record.usage=result?.usage||null;record.usage_complete=forced?false:result?.usage_complete??false;record.qualification=result?.qualification||null;
        record.error=record.status==='failed'?{code:forced||'campaign_worker_failed',message:'Campaign worker stopped; unknown usage must be reconciled before any resume.'}:null;
        record.attempts=null;record.chunk_count=result?.chunks?.length??0;record.repair_count=result?.usage?.repairs??null;
        record.quality={kind:'native-campaign-traversal',scope:'native-section-scenario-dag',coverage:record.resolved_recipe.description,whole_game_equivalent:null,save_compatibility:'unverified',reconstruction_qc:'unavailable'};
        if(bytes){record.result_sha256=sha(bytes);record.artifacts.result=`/api/improvement/runs/${id}/artifacts/result`;record.artifacts.campaign=`/api/improvement/runs/${id}/artifacts/campaign`;}
        const artifact=result?.artifact;
        if(artifact?.path&&digest(artifact.sha256)) {
          let file=await realpath(artifact.path);if(sha(await readFile(file))!==artifact.sha256)throw Error('Invalid campaign artifact');
          if(!file.startsWith(await realpath(dir(id))+sep)) {
            if(!record.adopted_prefix)throw Error('Artifact outside campaign lineage');
            const parent=await status(record.adopted_prefix),retained=parent.artifact_ref;
            if(!retained||retained.sha256!==artifact.sha256)throw Error('Invalid prefix artifact');
            file=resolve(dir(id),'candidate.gba');await copyFile(retained.path,file);
          }
          record.artifact_ref={path:file,sha256:artifact.sha256};record.artifact_sha256=artifact.sha256;record.artifacts.rom=`/api/improvement/runs/${id}/artifacts/rom`;
        }
        await atomic(resolve(dir(id),'run.json'),record);
      } catch {record.status='failed';record.error={code:'invalid_campaign_result',message:'Campaign receipt or candidate artifact could not be verified.'};await atomic(resolve(dir(id),'run.json'),record);}
      finally{if(active?.id===id)active=null;}
    };
    child.on('error',error=>{void finish(null,error);});child.on('close',code=>{void finish(code);});return record;
  }
  async function resumeCampaign(id,body) {
    const prior=await status(id);
    if(prior.input.operation!=='native-campaign')throw fail(422,'unsupported_resume','Only a registered campaign can resume in place.');
    if(active?.id===id)return prior;
    await assertNoRecoveredWorker();
    if(active||submitting)throw fail(409,'busy','A native worker is already running.');
    const caps=await capabilities(),profile=caps.iteration_profiles.find(row=>row.id===prior.input.plan.profile_id),selectedVersion=profile?.version_basis==='recipe-readset/1'?profile.loop_version:caps.loop_version;
    if(body.loop_version!==prior.input.loop_version||body.loop_version!==selectedVersion||body.campaign_report_sha256!==prior.report_sha256)throw fail(409,'stale_campaign_resume','Campaign resume requires the exact prior/current engine and report pins.');
    const report=await readJson(resolve(dir(id),'output/campaign.json'));
    if(!['running','cancelled'].includes(report.status)||report.usage_complete!==true)throw fail(409,'campaign_resume_unavailable','Only a known-usage cancelled/interrupted campaign may be explicitly reconciled and resumed; exhausted caps do not reset.');
    if(active||submitting)throw fail(409,'busy','A worker is already running.');
    submitting=true;try{return await launchCampaign(prior,true);}finally{submitting=false;}
  }
  async function submit(body, continuation = null) {
    if (!uuid(body?.request_id) || body.schema !== 'gameverse.improvement-request/1') throw fail(400, 'invalid_request', 'Versioned request and UUID request_id required.');
    if(body.operation==='reference-fixture')return submitReference(body);
    if (!['native-mod','native-improve','native-campaign'].includes(body.operation)) throw fail(422, 'unsupported_operation', 'Choose native-mod, a registered native-improve profile or a native-campaign configuration.');
    if (typeof body.intent !== 'string' || !body.intent.trim() || body.intent.length > 4000) throw fail(400, 'invalid_intent', 'Reviewed intent text required (1–4,000 characters).');
    if (body.target?.role !== 'subgame' || typeof body.target.game_id !== 'string' || !body.target.game_version || !body.target.base_game_version || !digest(body.target.base_artifact_sha256)) throw fail(422, 'unsupported_target', 'Pin the supported subgame version and host base version/artifact.');
    if (typeof body.environment?.version !== 'string' || !digest(body.environment?.config_sha256)) throw fail(400, 'invalid_environment', 'Pin environment version and config digest.');
    const fingerprint = sha(canonical(body));
    try { const prior = await status(body.request_id); if (prior.request_sha256 !== fingerprint) throw fail(409, 'idempotency_conflict', 'Request ID already belongs to different input.'); return prior; } catch (e) { if (e.code !== 'not_found') throw e; }
    if (active || submitting) throw fail(409, 'busy', 'A bounded worker is already running.');
    await assertNoRecoveredWorker();
    if(active||submitting)throw fail(409,'busy','A worker is already running.');
    submitting = true;
    try {
      const caps = await capabilities(), recipe = caps.recipes.find(r => r.id === body.plan?.recipe_id);
      if (!recipe || body.target.game_id!==recipe.game_id) throw fail(422, 'unsupported_recipe', 'Choose a registered recipe; text is not interpreted as an executable plan.');
      if(recipe.operations&&!recipe.operations.includes(body.operation))throw fail(422,'unsupported_recipe_operation','This recipe supports traversal only; it cannot build or claim a changed mechanic.');
      if (body.plan.request_sha256 !== recipe.request_sha256 || body.target.artifact_sha256 !== recipe.baseline_artifact_sha256) throw fail(409, 'stale_pins', 'Recipe, loop or target artifact pin changed. Refresh capabilities and review the plan.');
      if (!recipe.installed) throw fail(422, 'missing_inputs', 'Registered recipe inputs are missing or stale. Inspect capabilities.missing_inputs.');
      const profile = ['native-improve','native-campaign'].includes(body.operation) ? caps.iteration_profiles.find(row => row.id === body.plan?.profile_id && row.recipe_id === recipe.id) : null;
      if (['native-improve','native-campaign'].includes(body.operation) && !profile) throw fail(422,'unsupported_profile','Choose a registered iteration profile for this native recipe.');
      if (profile && (profile.profile_sha256 !== body.plan.profile_sha256 || !profile.installed)) throw fail(409,'stale_profile','Iteration profile or its pinned inputs are unavailable or changed.');
      const selectedVersion=profile?.version_basis==='recipe-readset/1'?profile.loop_version:caps.loop_version;
      if(body.loop_version!==selectedVersion||(profile?.version_basis==='recipe-readset/1'&&body.version_basis!=='recipe-readset/1'))throw fail(409,'stale_pins','Pin the current selected profile runtime authority; legacy jobs retain their original global basis.');
      if (continuation && (!profile || continuation.input.plan.profile_id !== profile.id || continuation.input.loop_version !== body.loop_version || continuation.input.plan.profile_sha256 !== body.plan.profile_sha256 || canonical(continuation.input.target) !== canonical(body.target) || canonical(continuation.input.environment) !== canonical(body.environment))) throw fail(409,'continuation_context_conflict','Continuation must retain the prior exact target, environment, loop version and registered profile.');
      if (body.voice_request_id) {
        if (!uuid(body.voice_request_id)) throw fail(400, 'invalid_voice_request', 'Invalid voice receipt ID.');
        let voice; try { voice = await readJson(resolve(root, 'local-data/voice-requests', `${body.voice_request_id}.json`)); } catch { throw fail(409, 'voice_unavailable', 'Durable voice receipt not found.'); }
        if (voice.status !== 'received' || voice.text !== body.intent || voice.context?.gameId !== body.target.game_id || voice.context?.role !== body.target.role || voice.context?.artifactSha256 !== body.target.artifact_sha256 || voice.context?.gameVersion !== body.target.game_version) throw fail(409, 'voice_context_conflict', 'Voice receipt text/target differs or is cancelled.');
      }
      let campaign=null, adopted=null;
      if(body.operation==='native-campaign') {
        campaign=campaignConfig(body);
        const pin=body.plan.adopt_from;
        if(pin) {
          adopted=await status(pin.request_id);
          if(adopted.input.operation!=='native-improve'||!['completed','partial','blocked'].includes(adopted.status)||adopted.input.loop_version!==body.loop_version||adopted.input.plan.profile_sha256!==body.plan.profile_sha256||canonical(adopted.input.target)!==canonical(body.target)||canonical(adopted.input.environment)!==canonical(body.environment))throw fail(409,'prefix_context_conflict','Adopt only a completed exact-runtime/profile/target prefix.');
          const path=resolve(dir(pin.request_id),'output/iteration.json'),bytes=await readFile(path),report=JSON.parse(bytes);
          if(sha(bytes)!==pin.report_sha256||['running','cancelled','interrupted'].includes(report.status)||report.usage_complete!==true||!report.checkpoint)throw fail(409,'stale_prefix','Prefix report or known checkpoint usage is unavailable.');
          const withoutId=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='request_id'));
          if(canonical(withoutId(report.request))!==canonical(withoutId(recipe.request)))throw fail(409,'prefix_request_conflict','Prefix is not the exact registered native request.');
          campaign.initial_report_ref={path,sha256:pin.report_sha256};adopted.engine_request=report.request;
        }
      }
      const id = body.request_id; await mkdir(directory, { recursive: true }); await mkdir(dir(id));
      const record = { schema: 'gameverse.improvement-run/1', request_id: id, request_sha256: fingerprint, status: 'running', phase: 'native-worker', received_at: new Date().toISOString(), input: body, resolved_recipe: recipe, ...(profile ? {resolved_profile:profile} : {}), ...(continuation ? {continuation_of:continuation.request_id,prior_report_sha256:continuation.report_sha256} : {}),
        candidate_only: true, attempts: 1, repair_count: 0, timings: { queue_s: null, execution_wall_s: null, build_s: null, simulation_s: null, evaluation_s: null, accounting: 'Backend stages are nested in worker execution; queue unavailable (direct dispatch).' }, artifacts: {} };
      await atomic(resolve(dir(id), 'run.json'), record);
      await atomic(resolve(dir(id), 'request.json'), campaign||recipe.request.schema==='native-artifact-traversal-request/1' ? (adopted?.engine_request||recipe.request) : { ...recipe.request, request_id: id });
      if(campaign){record.attempts=null;record.campaign_config=campaign;record.adopted_prefix=adopted?.request_id||null;await atomic(resolve(dir(id),'campaign-config.json'),campaign);await atomic(resolve(dir(id),'run.json'),record);return launchCampaign(record,false);}
      const output = resolve(dir(id), 'result.json'), started = performance.now();
      const args = profile ? ['-B','-m','tools.prefab_pipeline',continuation ? 'continue-profile' : 'run-profile', '--template',resolve(root,profile.file),'--run-id',id,
        ...(continuation ? ['--prior-report',continuation.report_path,'--prior-report-sha256',continuation.report_sha256] : ['--request',resolve(dir(id),'request.json')]),
        '--output-dir',resolve(dir(id),'output'),'--output',output]
        : ['-B', '-m', 'tools.prefab_pipeline.native_cli', recipe.command, '--request', resolve(dir(id), 'request.json'), '--output-dir', resolve(dir(id), 'output'), '--output', output];
      const child = await spawnWorker(id,args,profile?Math.max(timeoutMs,Math.ceil(profile.limits.wall_seconds*1000)+15000):timeoutMs);
      let reason = null, finished = false;
      const stop = why => { reason = why; if(spawnImpl===spawn)return stopOwner(ownerPath(id),why); try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
      active = { id, stop };
      const workerTimeoutMs = profile ? Math.max(timeoutMs, Math.ceil(profile.limits.wall_seconds*1000)+15000) : timeoutMs;
      const timer = setTimeout(() => {void Promise.resolve(stop('timeout')).catch(()=>{});}, workerTimeoutMs);
      const finish = async (code, error) => {
        if (finished) return; finished = true; clearTimeout(timer);
        try {
          reason??=(await ownerState(ownerPath(id)))?.stop_reason;
          const result = await readJson(output).catch(() => null);
          record.status = reason === 'cancelled' ? 'cancelled' : !reason && !error && code === 0 && ['candidate-built', 'qualified-bounded-modification','success','artifact-built-with-diagnostics'].includes(result?.status) ? 'completed' : 'failed';
          if(profile && !reason && !error && result && ['budget','blocked','cancelled','partial'].includes(result.status)) record.status=result.status;
          record.phase = 'terminal'; record.finished_at = new Date().toISOString(); record.timings.execution_wall_s = (performance.now() - started) / 1000;
          const stages = result?.stages || [];
          const sum = predicate => { const rows = stages.filter(predicate); return rows.length ? rows.reduce((n, row) => n + (row.wall_s ?? row.wall_seconds ?? 0), 0) : null; };
          record.timings.build_s = sum(row => row.name === 'build' || row.name?.startsWith('build-'));
          record.timings.simulation_s = sum(row => row.name?.startsWith('native-play-') || row.name === 'experiment');
          record.timings.evaluation_s = sum(row => ['compile-native-oracle', 'instruction-differential','diagnose'].includes(row.name));
          record.timings.backend_total_s = result?.total_wall_s ?? result?.total_wall_seconds ?? null;
          record.attempts = Array.isArray(result?.attempts) ? result.attempts.length : 1; record.repair_count = stages.filter(row=>row.name==='repair' && row.status==='completed').length;
          if(profile) { record.artifact_status=result?.artifact_status||null;record.engine_status=result?.status || null; record.usage=result?.usage || null; record.usage_complete=result?.usage_complete ?? null; record.engine_reason=result?.reason || null; record.experiment_outcome=result?.experiment_outcome || null; record.qualification=result?.qualification || null; record.checkpoint_available=!!result?.checkpoint; }
          const artifact = typeof result?.artifact === 'string' ? {path:result.artifact,sha256:result.artifact_sha256} : result?.artifact;
          record.result = result; record.error = record.status === 'failed' ? { code: reason || 'backend_failed', message: 'Native recipe did not complete. Inspect retained result evidence.' } : null;
          record.quality = { kind:recipe.request.schema==='native-artifact-traversal-request/1'?'artifact-traversal-only':'native-modification',scope: profile ? 'native-model-iteration-scoped' : recipe.quality, coverage: result?.coverage || null, witnesses: result?.witnesses || null, gaps: result?.gaps || (profile ? ['Only the reported native objective is scoped; whole campaign and save migration remain unverified.'] : recipe.quality === 'build-only' ? ['Gameplay objective and full campaign untested; native build/ABI preservation only.'] : []), reconstruction_qc: 'unavailable', whole_game_equivalent: null, save_compatibility: 'unverified' };
          if (result) { record.result_sha256=sha(await readFile(output)); record.artifacts.result = `/api/improvement/runs/${id}/artifacts/result`; }
          if (record.status === 'completed' && (!artifact?.path || !digest(artifact.sha256))) throw Error('Missing artifact');
          if (artifact?.path && digest(artifact.sha256)) {
            let file = await realpath(artifact.path);
            if(sha(await readFile(file)) !== artifact.sha256) throw Error('Invalid artifact');
            if(!file.startsWith(await realpath(dir(id))+sep)) {
              if(!continuation || artifact.sha256!==continuation.artifact_sha256) throw Error('Artifact outside lineage');
              const parentFile=await realpath(continuation.artifact_ref?.path || continuation.result.artifact?.path || continuation.result.artifact);
              if(!parentFile.startsWith(await realpath(dir(continuation.request_id))+sep) || sha(await readFile(parentFile))!==artifact.sha256) throw Error('Invalid prior artifact');
              const retained=resolve(dir(id),'candidate.gba');await copyFile(parentFile,retained);file=retained;
            }
            record.artifacts.rom = `/api/improvement/runs/${id}/artifacts/rom`; record.artifact_sha256 = artifact.sha256; record.artifact_ref={...artifact,path:file};
          }
          await atomic(resolve(dir(id), 'run.json'), record);
        } catch { record.status = 'failed'; record.error = { code: 'invalid_backend_result', message: 'Backend result could not be verified.' }; await atomic(resolve(dir(id), 'run.json'), record); }
        finally { if (active?.id === id) active = null; }
      };
      child.on('error', error => { void finish(null, error); }); child.on('close', code => { void finish(code); });
      return record;
    } finally { submitting = false; }
  }
  async function continueRun(id, body) {
    const prior=await status(id);
    if(prior.status==='running' || prior.input.operation!=='native-improve' || prior.status==='cancelled' || prior.status==='interrupted') throw fail(409,'continuation_unavailable','Only a terminal iteration with known usage and checkpoint may continue.');
    const report_path=resolve(dir(id),'output/iteration.json'); let bytes;
    try {bytes=await readFile(report_path);} catch {throw fail(409,'continuation_unavailable','Prior iteration report unavailable.');}
    const report_sha256=sha(bytes), report=JSON.parse(bytes);
    if(report.status==='running' || report.usage_complete!==true || !report.checkpoint || report.qualification?.native_objective==='observed') throw fail(409,'continuation_unavailable','Prior iteration must have known usage, a checkpoint and an unfulfilled objective.');
    if(body.prior_report_sha256!==report_sha256) throw fail(409,'stale_prior_report','Pin the prior report digest from run status.');
    return submit(body,{...prior,report_path,report_sha256});
  }
  async function handle(req, res, path) {
    if (!path.startsWith('/api/improvement/')) return false;
    const json = (code, value) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    try {
      let host; try { host = new URL(`http://${req.headers.host}`).hostname; } catch { /* fail below */ }
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'local_origin_required', 'Use the local app origin.');
      const match = /^\/api\/improvement\/runs\/([^/]+)(?:\/(?:artifacts\/(rom|result|iteration|campaign)|(continue|resume)))?$/.exec(path);
      if (req.method === 'GET' && path === '/api/improvement/capabilities') json(200, await capabilities());
      else if (req.method === 'GET' && match) {
        const run = await status(match[1]);
        if (!match[2] && !match[3]) json(200, run);
        else {
          if (!run.artifacts[match[2]]) throw fail(404, 'not_found', 'Artifact unavailable.');
          const file = await realpath(match[2] === 'campaign' ? resolve(dir(match[1]), 'output/campaign.json') : match[2] === 'iteration' ? resolve(dir(match[1]), 'output/iteration.json') : match[2] === 'result' ? (run.result_path||resolve(dir(match[1]), 'result.json')) : (run.artifact_ref?.path || run.result.artifact));
          if (!file.startsWith(await realpath(dir(match[1])) + sep)) throw fail(403, 'invalid_artifact', 'Artifact outside run.');
          const bytes = await readFile(file); if ((match[2] === 'rom' && sha(bytes) !== run.artifact_sha256) || (match[2] === 'result' && run.result_sha256 && sha(bytes) !== run.result_sha256) || (['iteration','campaign'].includes(match[2]) && sha(bytes)!==run.report_sha256)) throw fail(409, 'artifact_changed', 'Artifact digest changed.');
          res.writeHead(200, { 'Content-Type': match[2] !== 'rom' ? 'application/json' : 'application/octet-stream' }).end(bytes);
        }
      } else if (req.method === 'DELETE' && match && !match[2] && !match[3]) { const run = await status(match[1]); const requested=active?.id===match[1]?(await active.stop('cancelled'),true):await stopOwner(ownerPath(match[1]),'cancelled'); json(202, { ...run, cancellation_requested: requested }); }
      else if (req.method === 'POST' && (path === '/api/improvement/runs' || ['continue','resume'].includes(match?.[3]))) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'json_required', 'Send JSON.');
        let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 32768) throw fail(413, 'too_large', 'Request exceeds 32 KiB.'); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, 'invalid_json', 'Invalid JSON.'); }
        json(202, match?.[3] === 'resume' ? await resumeCampaign(match[1],body) : match?.[3] === 'continue' ? await continueRun(match[1],body) : await submit(body));
      } else throw fail(404, 'not_found', 'Improvement endpoint not found.');
    } catch (error) { json(error.status || 500, { error: { code: error.status ? error.code : 'service_error', message: error.status ? error.message : 'Improvement service could not complete this operation.' } }); }
    return true;
  }
  return { handle, capabilities, submit, status, continueRun, resumeCampaign, shutdown };
}
