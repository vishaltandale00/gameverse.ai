import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { root, runtimeDirectory, runtimeIdentity } from './runtime.mjs';
import { gameCatalog, customArtifacts } from './catalog.mjs';
import { createCodexAgent } from './codex-agent.mjs';
import { createChatgptAuthApi } from './chatgpt-auth-api.mjs';
import { createMashupPipeline } from './mashup-pipeline.mjs';
import { createRomLibrary } from './rom-library.mjs';
import { prepareRomFixture } from './rom-fixture-recipe.mjs';
import { createCreationCatalog } from './creation-catalog.mjs';
import { createCreationRouter } from './creation-router.mjs';
import { createPokemonPipeline } from './pokemon-pipeline.mjs';
import { createPokemonNativeVerifier } from './pokemon-native-verify.mjs';
import { createMashupApi } from './mashup-api.mjs';
import { createVoiceApi } from './voice-api.mjs';
import { attachVoiceStream, realtimeTranscriptionProviders } from './voice-stream.mjs';

const appRoot = fileURLToPath(root);
for (const name of ['.env.local','.env']) { try { loadEnvFile(fileURLToPath(new URL(name, root))); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.gba': 'application/octet-stream' };
const runtime = await runtimeIdentity();
let sourceCommit = null;
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8', timeout: 1000 }).trim(); } catch {}
const instance = { schema: 'gameverse.local-instance/1', checkout_id: createHash('sha256').update(appRoot).digest('hex'), source_commit: sourceCommit, entry_path: '/v1', capabilities: ['chatgpt-auth', 'mashup-creation', 'source-routed-creation', 'native-checkpoint-resume', 'immutable-artifact-player'] };
const handleVoice = createVoiceApi({ liveProviders: realtimeTranscriptionProviders });
const agent = createCodexAgent({cwd:appRoot});
const chatgpt = createChatgptAuthApi({agent});
const researchRoot=process.env.GAMEVERSE_POKEMON_RUNTIME_ROOT||'/Users/shishirtandale/Projects/gameverse.ai';
const romLibrary=createRomLibrary({root:appRoot,runtimeRoot:researchRoot,prepareRecipe:prepareRomFixture});
const originalResolver=id=>romLibrary.resolveOriginal(id);
const catalog = createCreationCatalog({root:appRoot,runtimeRoot:process.env.GAMEVERSE_LIBRARY_ROOT||researchRoot});
const mashup = createMashupApi({root:appRoot,agent,catalog,romLibrary,pipeline:createCreationRouter({catalog,sonic:createMashupPipeline({root:appRoot,agent,catalog,originalResolver}),pokemon:createPokemonPipeline({root:appRoot,agent,originalResolver,nativeVerifier:createPokemonNativeVerifier({root:appRoot})})}),timeoutMs:Number(process.env.MASHUP_TIMEOUT_MS || 1800000)});
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/api/local/instance' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': mime['.json'] }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(instance)); return;
    }
    if (path === '/create') {
      const target = new URL(req.url, 'http://localhost'); target.pathname = '/v1'; target.searchParams.set('create', '1');
      res.writeHead(302, { Location: target.pathname + target.search }).end(); return;
    }
    if (await chatgpt.handle(req,res,path)) return;
    if (await mashup.handle(req,res,path)) return;
    if (await handleVoice(req, res, path)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (path === '/runtime/identity.json') {
      res.setHeader('Content-Type', mime['.json']); res.end(JSON.stringify(runtime)); return;
    }
    if (path === '/games/catalog.json') {
      const games = await gameCatalog();
      res.setHeader('Content-Type', mime['.json']); res.end(JSON.stringify(games)); return;
    }
    const custom = path.match(/^\/custom\/([a-f0-9]{64})\/([a-z.-]+\.js)$/);
    if (custom) {
      if (!customArtifacts.has(custom[1])) await gameCatalog();
      const bytes = customArtifacts.get(custom[1])?.get(custom[2]);
      if (!bytes) { res.writeHead(404).end('This game version is unavailable. Reload the catalog.'); return; }
      res.setHeader('Content-Type', mime['.js']); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(req.method === 'HEAD' ? undefined : bytes); return;
    }
    let file;
    if (path === '/create' || path === '/conversation.html') file = new URL('conversation.html', root);
    else if (path === '/result-player.css') file = new URL('result-player.css', root);
    else if (path === '/conversation.css') file = new URL('conversation.css', root);
    else if (/^\/artifacts\/[a-f0-9]{64}\.gba$/.test(path)) file = new URL(`local-data/games/${path.split('/').pop()}`, root);
    else if (/^\/runtime\/mgba\.(js|wasm)$/.test(path)) file = new URL(path.split('/').pop(), runtimeDirectory);
    else if (/^\/runtime\/three\/three\.(module|core)\.js$/.test(path)) file = new URL(`node_modules/three/build/${path.split('/').pop()}`, root);
    else if (path === '/runtime/three/LICENSE') file = new URL('node_modules/three/LICENSE', root);
    else if (['/', '/index.html', '/v0', '/v0/', '/v0/index.html', '/v1', '/v1/', '/v1/index.html'].includes(path)) file = new URL('index.html', root);
    else if (/^\/games\/configs\/gameverse-v[01]\.json$/.test(path)) file = new URL(path.slice(1), root);
    else if (path === '/style.css' || path === '/src/neighborhood-certified.generated.js' || /^\/src\/[a-z-]+\.js$/.test(path)) file = new URL(path.slice(1), root);
    else { res.writeHead(404).end('Not found'); return; }
    const actual = await realpath(file);
    // Dependencies may be shared through a worktree's node_modules symlink. Only
    // the exact runtime files selected above may resolve outside the checkout.
    const dependencyAsset = /^\/runtime\/mgba\.(js|wasm)$/.test(path) || /^\/runtime\/three\/three\.(module|core)\.js$/.test(path) || path === '/runtime/three/LICENSE';
    if (!actual.startsWith(resolve(appRoot) + sep) && !dependencyAsset) throw Error('Path outside workspace');
    const bytes = await readFile(actual);
    res.setHeader('Content-Type', mime[actual.slice(actual.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Resource unavailable'); }
});
const port = Number(process.env.PORT || 4173);
attachVoiceStream(server);
server.listen(port, '127.0.0.1', () => console.log(`Gameverse: http://127.0.0.1:${port}`));

for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{void mashup.shutdown(); agent.close(); server.close();});
