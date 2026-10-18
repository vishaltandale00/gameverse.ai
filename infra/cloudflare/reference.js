import manifest from './reference-manifest.json';
export { manifest };
export const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
export async function hash(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), x=>x.toString(16).padStart(2,'0')).join(''); }
export function decode(value) { return Uint8Array.from(atob(value), x=>x.charCodeAt(0)); }

export async function validateSource(bundle) {
  if (bundle.schema !== 'gameverse.hosted-reference-source/1' || !Array.isArray(bundle.files) || bundle.files.length !== manifest.files.length) throw Error('invalid_reference_source');
  for (let i=0;i<manifest.files.length;i++) {
    const file=bundle.files[i], pin=manifest.files[i];
    if (file.path!==pin.path || file.sha256!==pin.sha256 || await hash(decode(file.content_base64))!==pin.sha256) throw Error('reference_source_pin_mismatch');
  }
}

export function executionCommand(bundle, runId) {
  // The only shell interpolation is base64 of validated public source and a UUID.
  const encoded=btoa(JSON.stringify(bundle));
  return `python3 - <<'GAMEVERSE_REFERENCE_PY'
import base64,hashlib,json,pathlib,platform,subprocess,sys,time
bundle=json.loads(base64.b64decode('${encoded}'))
root=pathlib.Path('/tmp/gameverse-reference-${runId}')
root.mkdir(exist_ok=False)
t=time.monotonic()
for item in bundle['files']:
    data=base64.b64decode(item['content_base64'],validate=True)
    if hashlib.sha256(data).hexdigest()!=item['sha256']: raise ValueError('source_digest_mismatch')
    path=root/item['path'];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
request=${JSON.stringify({...manifest.request,request_id:runId}).replaceAll('false','False').replaceAll('true','True').replaceAll('null','None')}
(root/'request.json').write_text(json.dumps(request))
hydration=time.monotonic()-t
t=time.monotonic()
process=subprocess.run([sys.executable,'-B','-m','tools.prefab_pipeline.reference_fixture','--request',str(root/'request.json'),'--output',str(root/'output')],cwd=root,capture_output=True,timeout=8)
names=['result.json','request.json','game.json','checkpoint.json','replay.json','engine/report.json','engine/events.jsonl']
files=[]
for name in names:
    path=root/'output'/name
    if path.exists():
        data=path.read_bytes();files.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'content_base64':base64.b64encode(data).decode()})
result={'schema':'gameverse.hosted-reference-output/1','request_id':'${runId}','exit_code':process.returncode,'files':files,'machine':{'python':platform.python_version(),'system':platform.system(),'machine':platform.machine()},'timings':{'hydration_s':hydration,'fixture_process_s':time.monotonic()-t}}
text=json.dumps(result,separators=(',',':'))
if len(text)>524288: raise ValueError('output_too_large')
(root/'transfer.tmp').write_text(text);(root/'transfer.tmp').replace(root/'transfer.json')
print(text)
GAMEVERSE_REFERENCE_PY`;
}

export async function validateOutput(output,runId) {
  if(output.schema!=='gameverse.hosted-reference-output/1'||output.request_id!==runId||output.exit_code!==0||!Array.isArray(output.files)||output.files.length!==7) throw Error('reference_execution_failed');
  const files=new Map();
  for(const item of output.files) {
    if(files.has(item.path)) throw Error('duplicate_output_file');
    const bytes=decode(item.content_base64);
    if(await hash(bytes)!==item.sha256) throw Error('output_digest_mismatch');
    files.set(item.path,{...item,bytes});
  }
  const read = name => JSON.parse(new TextDecoder().decode(files.get(name)?.bytes));
  const report=read('result.json'), replay=read('replay.json'), engine=read('engine/report.json');
  const required=['key_collected','door_opened','goal_reached','checkpoint_reconstructed','transition_replay_equal','independent_session'];
  if(report.schema!=='gameverse.reference-fixture-result/1'||report.request_id!==runId||report.fixture_id!==manifest.fixture_id||report.status!=='passed'||report.model_calls!==0||report.repairs!==0||report.action_count!==18||report.game_material_required!==false||report.gba_generation!==false||required.some(k=>report.tests?.[k]!==true)) throw Error('invalid_reference_evidence');
  if(canonical(report.sourcepins)!==canonical(manifest.files)||engine.status!=='success'||engine.decision_calls!==0||replay.checkpoint_matched!==true||replay.fresh_session!==true||replay.final_observation?.success!==true) throw Error('invalid_reference_replay');
  for(const name of ['engine_report','engine_events','checkpoint','replay','artifact']) {
    const pin=report[name];
    const suffix=pin?.path?.split('/output/')[1];
    if(!suffix||files.get(suffix)?.sha256!==pin.sha256) throw Error('invalid_nested_output_pin');
  }
  return {status:'passed',action_count:report.action_count,tests:report.tests,model_calls:0,repairs:0,fixture_wall_s:report.total_wall_s};
}
