import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPokemonNativeVerifier} from '../scripts/pokemon-native-verify.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t,mode){
 const root=await mkdtemp(join(tmpdir(),'pokemon-native-wrapper-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace=join(root,'workspace'),directory=join(root,'evidence'),artifact=join(root,'game.gba');await mkdir(workspace);await mkdir(directory);
 await writeFile(artifact,'candidate');await writeFile(join(workspace,'sprite-coverage.json'),'coverage');
 const verifier=createPokemonNativeVerifier({root,child:async()=>{
  if(mode==='no-receipt')throw Error('native_failed');
  await writeFile(join(directory,'native-verification.json'),JSON.stringify({schema:'gameverse.pokemon-native-verification/1',outcome:'pass',request_satisfied:true,artifact:{sha256:sha(mode==='wrong-artifact'?'other':'candidate')},coverage_sha256:sha('coverage')}));
  if(mode==='nonzero')throw Error('native_failed');
 }});
 return {verifier,artifact,workspace,directory};
}
test('matching native receipt accepted',async t=>{const f=await fixture(t);assert.equal((await f.verifier(f)).outcome,'pass');});
test('failed process cannot reuse successful receipt',async t=>{const f=await fixture(t,'nonzero');const r=await f.verifier(f);assert.equal(r.outcome,'fail');assert.equal(r.request_satisfied,false);});
test('wrong candidate identity rejected',async t=>{const f=await fixture(t,'wrong-artifact');await assert.rejects(f.verifier(f),/identity_mismatch/);});
test('old receipt removed before failed invocation',async t=>{const f=await fixture(t,'no-receipt');await writeFile(join(f.directory,'native-verification.json'),JSON.stringify({outcome:'pass'}));await assert.rejects(f.verifier(f),/native_failed/);});
