export { DevManagerState } from './dev-manager-state.js';
import {devManagerRoute} from './dev-manager-api.js';
export { ProjectState } from './project-state.js';
export { AgentConnections } from './agent-connections.js';
export { IdentityState } from './identity-state.js';
export { AccountJobs } from './account-jobs.js';
export { SandboxAdmission } from './sandbox-admission.js';
import { platformRoute } from './platform-api.js';
import { phoneConfigured } from './phone-sign-in.js';

const PROJECT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const projectRoute = new RegExp(`^/api/admin/projects/(${PROJECT_ID})$`);
const objectRoute = new RegExp(`^/api/admin/projects/(${PROJECT_ID})/objects/([0-9a-f]{64})$`);
const encoder = new TextEncoder();
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

function json(value, status = 200) {
  return Response.json(value, { status, headers: securityHeaders });
}

function error(code, status) {
  return json({ error: { code } }, status);
}

async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  if (supplied.length > 512) return false;
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${secret}`)),
  ]);
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readBoundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ service: 'gameverse-host', environment: env.APP_ENV, status: 'ok' });
  }
  const developer=await devManagerRoute(request,env);if(developer)return developer;
  const platform=await platformRoute(request,env);if(platform)return platform;
  if(env.ASSETS&&!url.pathname.startsWith('/api/')) {
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','no-referrer');
    const discoveryOrigin=url.pathname.startsWith('/account')?' http://127.0.0.1:4177':'';
    headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'${discoveryOrigin}; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
    if(url.pathname.startsWith('/account'))headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }
  if (!url.pathname.startsWith('/api/admin/')) return error('not_found', 404);
  if (!await authorized(request, env.STAGING_API_TOKEN)) return error('unauthorized', 401);
  if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return error('origin_rejected', 403);

  if (url.pathname === '/api/admin/status' && request.method === 'GET') {
    return json({
      environment: env.APP_ENV,
      project_storage: 'durable-object-sqlite',
      artifact_storage: 'private-r2',
      daytona_key_configured: !!env.DAYTONA_API_KEY,
      job_dispatch_enabled: phoneConfigured(env)&&!!env.AGENT_CREDENTIAL_KEY,
      job_scope: phoneConfigured(env)&&!!env.AGENT_CREDENTIAL_KEY?'invited-connected-agent-probe':'disabled',
      player_authentication: phoneConfigured(env)?'phone-sms-pilot':'not-configured',
    });
  }

  const projectMatch = url.pathname.match(projectRoute);
  if (projectMatch) {
    const project = env.PROJECTS.getByName(projectMatch[1]);
    if (request.method === 'PUT') {
      // This bootstrap endpoint accepts no client metadata or game-version changes.
      if (request.body && (await readBoundedBody(request, 0)) === null) return error('body_not_allowed', 400);
      const result = await project.createProject(projectMatch[1]);
      return json(result.project, result.created ? 201 : 200);
    }
    if (request.method === 'GET') {
      const value = await project.getProject();
      return value ? json(value) : error('project_not_found', 404);
    }
    return error('method_not_allowed', 405);
  }

  const objectMatch = url.pathname.match(objectRoute);
  if (objectMatch) {
    if (!['PUT', 'GET', 'HEAD'].includes(request.method)) return error('method_not_allowed', 405);
    const [, projectId, digest] = objectMatch;
    if (!await env.PROJECTS.getByName(projectId).getProject()) return error('project_not_found', 404);
    const key = `projects/${projectId}/objects/${digest}`;
    if (request.method === 'PUT') {
      const configuredLimit = Number(env.MAX_OBJECT_BYTES);
      const limit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 1048576) : 1048576;
      const bytes = await readBoundedBody(request, limit);
      if (!bytes) return error('object_too_large', 413);
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
      if (actual !== digest) return error('digest_mismatch', 422);
      const stored = await env.ARTIFACTS.put(key, bytes, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/octet-stream' },
      });
      return json({ project_id: projectId, sha256: digest, bytes: bytes.byteLength }, stored ? 201 : 200);
    }
    const object = request.method === 'HEAD' ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
    if (!object) return error('object_not_found', 404);
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        ...securityHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
        'Content-Length': String(object.size),
        ETag: object.httpEtag,
      },
    });
  }
  return error('not_found', 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch(cause) {
      const code=cause.message;
      if(/^(invalid_[a-z_]+|request_conflict|connection_[a-z_]+|login_[a-z_]+|provider_[a-z_]+|pilot_daily_limit)$/.test(code))return error(code,409);
      return error('infrastructure_unavailable', 503);
    }
  },
};
