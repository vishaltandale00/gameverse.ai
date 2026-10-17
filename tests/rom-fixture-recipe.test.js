import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareRomFixture} from '../scripts/rom-fixture-recipe.mjs';
const rows=JSON.parse(await readFile(new URL('../games/rom-identities.json',import.meta.url))).originals;
const identity=rows.find(r=>r.id==='metroid-zero-mission');
async function workspace(t){const directory=await mkdtemp(join(tmpdir(),'rom-recipe-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
test('unregistered metadata cannot create a recipe',async t=>{
 const directory=await workspace(t);
 await assert.rejects(prepareRomFixture({identity:{...identity,sha1:'0'.repeat(40)},directory,romPath:join(directory,'missing')}),/pinned recipe identity/);
 assert.deepEqual(await readdir(directory),[]);
});
test('size guard rejects partial originals before extraction',async t=>{
 const directory=await workspace(t),romPath=join(directory,'input.gba');await writeFile(romPath,Buffer.alloc(192));
 await assert.rejects(prepareRomFixture({identity,directory,romPath}),/size or file type/);
 assert.deepEqual(await readdir(directory),['input.gba']);
});
test('exact-size modified ROM cannot masquerade as original',async t=>{
 const directory=await workspace(t),romPath=join(directory,'input.gba'),bytes=Buffer.alloc(identity.size_bytes);
 bytes.write(identity.title,0xa0);bytes.write(identity.game_code,0xac);bytes.write(identity.maker_code,0xb0);await writeFile(romPath,bytes);
 await assert.rejects(prepareRomFixture({identity,directory,romPath}),/hash or header/);
 assert.deepEqual(await readdir(directory),['input.gba']);
});
test('symlinks are refused',async t=>{
 const directory=await workspace(t),romPath=join(directory,'input.gba'),target=join(directory,'target');await writeFile(target,Buffer.alloc(192));await symlink(target,romPath);
 await assert.rejects(prepareRomFixture({identity,directory,romPath}),/size or file type/);
});
test('cancelled work produces no output',async t=>{
 const directory=await workspace(t),controller=new AbortController();controller.abort();
 await assert.rejects(prepareRomFixture({identity,directory,romPath:'unused',signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(await readdir(directory),[]);
});
