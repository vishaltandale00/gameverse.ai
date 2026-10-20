import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {extendRecoveredPrefab, selectRecoveredPrefabPhase} from '../src/game-system-phase-extension.js';
import {createVerifiedLifecycleAdapter} from '../src/game-system-lifecycle-adapters.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = reference => {
  if (!reference || typeof reference.path !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw Error('Expected pinned JSON reference {path,sha256}.');
  const filename = path.resolve(root, reference.path);
  const bytes = fs.readFileSync(filename);
  if (bytes.length > 2 * 1024 * 1024) throw Error(`JSON input exceeds 2 MiB: ${reference.path}`);
  if (digest(bytes) !== reference.sha256) throw Error(`Stale file byte pin: ${reference.path}`);
  return JSON.parse(bytes);
};
const same = (a, b) => {
  const sort = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(sort) : Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,sort(item)])) : value;
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
};
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--request','--output-dir'].includes(args[index]) || !args[index + 1]) throw Error('Usage: node scripts/extend-prefab-phase.mjs --request FILE --output-dir DIRECTORY');
  options[args[index]] = args[index + 1];
}
if (!options['--request'] || !options['--output-dir']) throw Error('Missing --request or --output-dir.');
const started = performance.now(), output = path.resolve(options['--output-dir']);
fs.mkdirSync(output, {recursive: false});
const receipt = {schema:'gameverse.prefab-phase-extension-result/1',status:'failed',queue_s:null,environment:{platform:os.platform(),arch:os.arch(),node:process.version},stages:[],scope:'Actual agent command: verified file inputs, lifecycle extension, phase selection and symbolic assembly validation. No application UI wiring, source acquisition, game build or native/ROM parity.'};
const write = (name, value) => { const bytes = JSON.stringify(value,null,2)+'\n'; const filename=path.join(output,name); fs.writeFileSync(filename,bytes); return {path:filename,sha256:digest(bytes)}; };
try {
  const requestBytes=fs.readFileSync(path.resolve(options['--request']));
  if (requestBytes.length > 2*1024*1024) throw Error('Request exceeds 2 MiB.');
  const request=JSON.parse(requestBytes);
  receipt.request_id=request.request_id; receipt.request_sha256=digest(requestBytes);
  if (request.schema !== 'gameverse.prefab-phase-extension-request/1' || typeof request.request_id !== 'string' || !request.request_id.trim()) throw Error('Unsupported phase extension request schema or missing request_id.');
  receipt.inputs=request;
  write('request.json',request);
  const beforePins=performance.now();
  const graph=read(request.baseGraph), target=read(request.targetGraph), descriptor=read(request.descriptor), adapter=read(request.lifecycleAdapter);
  for (const prefix of ['source','target']) {
    const snapshot=read(adapter[prefix+'GraphRef']);
    if (!same(snapshot,adapter[prefix+'Graph'])) throw Error(`Lifecycle ${prefix} graph snapshot differs from pinned source bytes.`);
  }
  if (!same(target,adapter.targetGraph) || request.targetGraph.sha256 !== adapter.targetGraphRef.sha256) throw Error('Target graph differs from pinned lifecycle target.');
  receipt.stages.push({name:'input_pin_verification',wall_s:(performance.now()-beforePins)/1000,outcome:'pass'});
  const before=performance.now();
  const extended=extendRecoveredPrefab(graph,target,{...descriptor,lifecycleAdapter:createVerifiedLifecycleAdapter(adapter)});
  const selected=selectRecoveredPrefabPhase(extended.graph,{module:extended.module,phaseId:descriptor.phaseId});
  // Exercise round-trip selection through the production API. Transient captured
  // outputs are absent after retirement; canonical input/cache values survive.
  const back=selectRecoveredPrefabPhase(selected,{module:extended.module,phaseId:descriptor.existingModule.phaseId});
  const again=selectRecoveredPrefabPhase(back,{module:extended.module,phaseId:descriptor.phaseId});
  for (const slot of Object.values(descriptor.existingModule.stateMap)) {
    if (!same(graph.initialize?.[slot],again.initialize?.[slot])) throw Error(`Round-trip changed retained initialization: ${slot}`);
  }
  receipt.stages.push({name:'lifecycle_extension_and_selection',wall_s:(performance.now()-before)/1000,outcome:'pass'});
  const beforeValidation=performance.now();
  const validation=JSON.parse(execFileSync('python3',['-c','import json,sys;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;graphs=json.load(sys.stdin);out=[validate(g) for g in graphs];print(json.dumps(out));sys.exit(not all(r["valid"] for r in out))'],{cwd:root,input:JSON.stringify([selected,back,again]),encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}));
  receipt.stages.push({name:'assembly_validation',wall_s:(performance.now()-beforeValidation)/1000,outcome:'pass'});
  receipt.outputs={graph:write('extended-graph.json',selected),module:write('module.json',extended.module),backGraph:write('back-graph.json',back),reselectedGraph:write('reselected-graph.json',again),validation:write('validation.json',validation)};
  receipt.componentMap=extended.componentMap;receipt.stateMap=extended.stateMap;receipt.input_file_bytes_verified=true;
  receipt.adapterVersion=adapter.schema;receipt.sourceVersions={source:adapter.sourceVersion,target:adapter.targetVersion};
  receipt.implementation=Object.fromEntries(['scripts/extend-prefab-phase.mjs','src/game-system-lifecycle-adapters.js','src/game-system-phase-extension.js','tools/behavior_ir/assembly.py'].map(name=>[name,digest(fs.readFileSync(path.join(root,name)))]));
  receipt.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  receipt.status='passed';
} catch (error) {
  receipt.error=error.message;
  if (error.stdout) receipt.validation_output=String(error.stdout);
  process.exitCode=2;
} finally {
  receipt.wall_s=(performance.now()-started)/1000;
  write('receipt.json',receipt);
  process.stdout.write(JSON.stringify(receipt)+'\n');
}
