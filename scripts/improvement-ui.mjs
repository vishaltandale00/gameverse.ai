import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const files = new Map([
  ['/improvement', ['improvement.html', 'text/html; charset=utf-8']],
  ['/improvement/', ['improvement.html', 'text/html; charset=utf-8']],
  ['/improvement.css', ['improvement.css', 'text/css; charset=utf-8']],
  ...['improvement-page', 'improvement-workbench', 'improvement-workbench-model'].map(name => [`/src/${name}.js`, [`src/${name}.js`, 'text/javascript; charset=utf-8']]),
]);

export function createImprovementUi({ root = workspace } = {}) {
  return async function handleImprovementUi(request, response, path) {
    const file = files.get(path);
    if (!file) return false;
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return true; }
    const bytes = await readFile(resolve(root, file[0]));
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.writeHead(200, { 'Content-Type': file[1] });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return true;
  };
}
