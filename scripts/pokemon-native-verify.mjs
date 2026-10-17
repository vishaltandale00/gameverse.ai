import {mkdir,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {runChild} from './mashup-pipeline.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export function createPokemonNativeVerifier({root,python=process.env.GAMEVERSE_PYTHON||'/opt/homebrew/bin/python3',child=runChild}={}) {
 if(!root)throw Error('native_verifier_root_required');
 return async function nativeVerifier({artifact,workspace,directory,signal,onEvent,budget}={}) {
  await mkdir(directory,{recursive:true});
  const path=typeof artifact==='string'?artifact:artifact?.path;
  if(!path)throw Error('native_verifier_artifact_required');
  const timeout=Math.max(1,Math.min(60,Number(budget?.native_seconds)||60));
  const [artifactBytes,coverageBytes]=await Promise.all([readFile(path),readFile(join(workspace,'sprite-coverage.json'))]);
  const expected={artifact:sha(artifactBytes),coverage:sha(coverageBytes)};
  onEvent?.({type:'pipeline-stage',stage:'native',phase:'native',message:'Checking actual LeafGreen sprite, animation, palette and reflection consumers in native mGBA'});
  await rm(join(directory,'native-verification.json'),{force:true});
  let childError;
  try {
   await child(python,[join(root,'tools/pokemon_pipeline/native_verify.py'),'--artifact',path,'--workspace',workspace,'--directory',directory,'--timeout',String(timeout)],{cwd:root,signal,timeoutMs:(timeout+2)*1000});
  } catch(error) {
   if(signal?.aborted)throw error;
   childError=error;
  }
  let report;
  try{report=JSON.parse(await readFile(join(directory,'native-verification.json'),'utf8'));}catch(error){throw childError||error;}
  if(report.schema!=='gameverse.pokemon-native-verification/1'||report.artifact?.sha256!==expected.artifact||report.coverage_sha256!==expected.coverage)throw Error('native_verification_identity_mismatch');
  if(childError&&report.outcome==='pass')return {...report,outcome:'fail',request_satisfied:false,error:'native_verifier_process_failed_after_receipt'};
  return report;
 };
}
