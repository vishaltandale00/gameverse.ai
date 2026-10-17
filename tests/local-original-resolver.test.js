import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {createLocalOriginalResolver} from '../scripts/local-original-resolver.mjs';
test('validated local original fallback works without an upload or trusted filename and notices mutation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'local-original-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'games'));await mkdir(join(root,'local/roms'),{recursive:true});
 const bytes=Buffer.alloc(192);bytes.write('AXPE',0xac);const path=join(root,'local/roms/arbitrary-name.gba');await writeFile(path,bytes);await writeFile(join(root,'games/rom-identities.json'),JSON.stringify({originals:[{id:'pokemon-sapphire-version',size_bytes:192,sha1:createHash('sha1').update(bytes).digest('hex'),game_code:'AXPE',version:0}]}));
 const resolve=createLocalOriginalResolver({root,runtimeRoot:root,romLibrary:{resolveOriginal:async()=>null}});const original=await resolve('pokemon-sapphire');assert.equal(original.path,await realpath(path));assert.equal(original.source,'validated-local-original');
 bytes[0]=1;await writeFile(path,bytes);assert.equal(await resolve('pokemon-sapphire'),null);
});
