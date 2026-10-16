import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { root, runtimeDirectory, runtimeIdentity } from './runtime.mjs';
import { gameCatalog, customArtifacts } from './catalog.mjs';
import { createVoiceApi } from './voice-api.mjs';
import { attachVoiceStream, realtimeTranscriptionProviders } from './voice-stream.mjs';

const appRoot = fileURLToPath(root);
try { loadEnvFile(fileURLToPath(new URL('.env', root))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.gba': 'application/octet-stream' };
const runtime = await runtimeIdentity();
const handleVoice = createVoiceApi({ liveProviders: realtimeTranscriptionProviders });
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
    if (/^\/artifacts\/[a-f0-9]{64}\.gba$/.test(path)) file = new URL(`local-data/games/${path.split('/').pop()}`, root);
    else if (/^\/runtime\/mgba\.(js|wasm)$/.test(path)) file = new URL(path.split('/').pop(), runtimeDirectory);
    else if (/^\/runtime\/three\/three\.(module|core)\.js$/.test(path)) file = new URL(`node_modules/three/build/${path.split('/').pop()}`, root);
    else if (path === '/runtime/three/LICENSE') file = new URL('node_modules/three/LICENSE', root);
    else if (['/', '/v0', '/v0/', '/v1', '/v1/'].includes(path)) file = new URL('index.html', root);
    else if (/^\/games\/configs\/gameverse-v[01]\.json$/.test(path)) file = new URL(path.slice(1), root);
    else if (path === '/style.css' || path === '/src/neighborhood-certified.generated.js' || /^\/src\/[a-z-]+\.js$/.test(path)) file = new URL(path.slice(1), root);
    else { res.writeHead(404).end('Not found'); return; }
    const actual = await realpath(file);
    if (!actual.startsWith(resolve(appRoot) + sep)) throw Error('Path outside workspace');
    const bytes = await readFile(actual);
    res.setHeader('Content-Type', mime[actual.slice(actual.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Resource unavailable'); }
});
const port = Number(process.env.PORT || 4173);
attachVoiceStream(server);
server.listen(port, '127.0.0.1', () => console.log(`Gameverse: http://127.0.0.1:${port}`));
