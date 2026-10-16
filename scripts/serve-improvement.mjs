// Minimal standalone API entrypoint for Vishal's agent integration; no UI or model credentials.
import http from 'node:http';
import { createImprovementApi } from './improvement-api.mjs';
const api = createImprovementApi({ timeoutMs: Number(process.env.IMPROVEMENT_TIMEOUT_MS || 90000) });
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let path; try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400).end(); return; }
  void api.handle(request, response, path).then(handled => { if (!handled) response.writeHead(404).end(); }).catch(() => { if (!response.headersSent) response.writeHead(500).end(); });
});
server.listen(Number(process.env.PORT || 4175), '127.0.0.1', () => console.log(`Improvement API: http://127.0.0.1:${server.address().port}`));
