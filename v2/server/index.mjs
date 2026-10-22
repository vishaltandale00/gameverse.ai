// @ts-check
// v2 routes for the dev server: static files under /v2 and the /api/v2 API.
// scripts/serve.mjs delegates here; v2 work stays inside v2/.
import { readFile } from 'node:fs/promises';
import { defaultRegistry } from '../modules/index.js';
import { preflight } from '../engine/spec.js';
import { createGameService } from './api.mjs';
import { messageOf, num, prop } from '../kernel/guards.js';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const V2 = new URL('../', import.meta.url);
/** @type {Record<string, string>} */
const MIME = { '.html': 'text/html', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
export const STATIC = /^\/v2\/(art|experiments|kits(\/[a-z0-9-]+){0,2}|engine|modules|web|presets|examples|kernel|verify(\/[a-z0-9-]+)?|games|primitives\/(engine|plot|graphics|gameplay|promoted)|primitives)\/[a-z0-9][a-z0-9.-]*\.(js|css|json|html)$/;
/** @type {ReturnType<typeof createGameService> | null} */
let service = null;
export const gameService = () => (service ??= createGameService());
const registry = defaultRegistry();

// Additional API routes register here: { 'POST /api/v2/create': async (body, req) => result }.
/** @typedef {(body: unknown, req: IncomingMessage) => Promise<unknown>} ApiRoute the request body is `unknown`: routes narrow it */
/** @type {Map<string, ApiRoute>} */
export const apiRoutes = new Map(/** @type {[string, ApiRoute][]} */ ([
  ['GET /api/v2/cards', async () => ({ modules: registry.cards() })],
  ['POST /api/v2/preflight', async body => { const t = performance.now(); const r = preflight(prop(body, 'spec'), registry); return { ...r, ms: +(performance.now() - t).toFixed(2) }; }],
]));

/** The request body as JSON (unknown: routes narrow it), null when empty. @param {IncomingMessage} req @returns {Promise<unknown>} */
async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(Error('Request too large.'), { status: 413 }); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

/** An error response: a thrown error with a status says why; anything else is a generic failure. @param {ServerResponse} res @param {unknown} error */
const failed = (res, error) => {
  const status = num(prop(error, 'status'));
  res.writeHead(status || 500, { 'Content-Type': MIME['.json'] }).end(JSON.stringify({ error: status ? messageOf(error) : 'The v2 service failed.' }));
};

/** @param {IncomingMessage} req @param {ServerResponse} res @param {string} path */
export async function handleV2(req, res, path) {
  if (path.startsWith('/api/v2/')) {
    try { if (await gameService().handle(req, res, path, readJson)) return true; }
    catch (error) { failed(res, error); return true; }
    const route = apiRoutes.get(`${req.method} ${path}`);
    if (!route) { res.writeHead(404, { 'Content-Type': MIME['.json'] }).end(JSON.stringify({ error: `No v2 API route ${req.method} ${path}.` })); return true; }
    try {
      const body = req.method === 'POST' ? await readJson(req) : null;
      const result = await route(body, req);
      res.writeHead(200, { 'Content-Type': MIME['.json'] }).end(JSON.stringify(result));
    } catch (error) {
      failed(res, error);
    }
    return true;
  }
  let file = null;
  if (path === '/v2' || path === '/v2/') file = new URL('web/index.html', V2);
  else if (STATIC.test(path)) file = new URL(path.slice('/v2/'.length), V2);
  if (!file) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return true; }
  try {
    const bytes = await readFile(file);
    res.setHeader('Content-Type', MIME[path === '/v2' || path === '/v2/' ? '.html' : path.slice(path.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) { res.writeHead(prop(error, 'code') === 'ENOENT' ? 404 : 500).end('Resource unavailable'); }
  return true;
}
