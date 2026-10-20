// Standalone local provider API and narrowly scoped recipe workbench.
import http from 'node:http';
import { createImprovementApi } from './improvement-api.mjs';
import { createImprovementUi } from './improvement-ui.mjs';
const api = createImprovementApi({ timeoutMs: Number(process.env.IMPROVEMENT_TIMEOUT_MS || 90000) });
const handleUi = createImprovementUi();
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let path; try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400).end(); return; }
  void api.handle(request, response, path).then(async handled => { if (!handled && !await handleUi(request, response, path)) response.writeHead(404).end(); }).catch(() => { if (!response.headersSent) response.writeHead(500).end(); });
});
server.listen(Number(process.env.PORT || 4175), '127.0.0.1', () => console.log(`Improvement recipes: http://127.0.0.1:${server.address().port}/improvement`));

let shuttingDown=false;
async function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  server.close();
  try{await api.shutdown();}finally{process.exit(0);}
}
process.on('SIGTERM',()=>{void shutdown();});
process.on('SIGINT',()=>{void shutdown();});
