// The browser loads only what the dev and hosted servers serve (v2/server/index.mjs STATIC): every module a page's
// module graph reaches (its <script type="module"> entries, then every relative import, static or dynamic, transitively)
// is a served path, so no page reaches code that stays on the server (the planner). One unserved import breaks every
// page that loads it: the studio could not load when graphics/ui-defaults.js imported planner/loop.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC } from '../v2/server/index.mjs';

const V2 = fileURLToPath(new URL('../v2/', import.meta.url));
const served = file => STATIC.test(`/v2/${relative(V2, file).split('\\').join('/')}`);
// Static and dynamic imports and re-exports with a relative or /v2/ specifier.
const IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]((?:\.{1,2}|\/v2)\/[^'"]+)['"]|import\s*\(\s*['"]((?:\.{1,2}|\/v2)\/[^'"]+)['"]\s*\)|import\s*['"]((?:\.{1,2}|\/v2)\/[^'"]+)['"]/g;
const SCRIPT = /<script[^>]*type="module"[^>]*src="(\/v2\/[^"]+)"/g;
const at = (from, spec) => (spec.startsWith('/v2/') ? join(V2, spec.slice(4)) : resolve(dirname(from), spec));

test('every module a v2 page reaches is one the servers serve', () => {
  const pages = readdirSync(join(V2, 'web')).filter(f => f.endsWith('.html')).map(f => join(V2, 'web', f));
  const queue = pages.flatMap(p => [...readFileSync(p, 'utf8').matchAll(SCRIPT)].map(m => ({ file: join(V2, m[1].slice(4)), from: relative(V2, p) })));
  assert.ok(queue.length > 0, 'the pages load module scripts');
  const seen = new Set(), bad = [];
  while (queue.length) {
    const { file, from } = /** @type {{ file: string, from: string }} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    if (!served(file)) { bad.push(`${from} reaches v2/${relative(V2, file)}, which is not served`); continue; }
    // A module that does not exist is an optional one its importer guards (a catalogue's promoted primitives).
    if (!existsSync(file)) continue;
    // Comments carry JSDoc type imports (`import('./types.js')`), which load nothing.
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(IMPORT)) {
      const target = at(file, m[1] ?? m[2] ?? m[3]);
      if (target.startsWith(V2)) queue.push({ file: target, from: relative(V2, file) });
    }
  }
  assert.ok(seen.size > 100, `${seen.size} modules reached`);
  assert.deepEqual(bad, []);
});
