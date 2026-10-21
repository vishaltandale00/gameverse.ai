#!/usr/bin/env node
// `npm run typecheck`: strict TypeScript checking of the JavaScript in the typed directories, no build step.
// 1. Every .js/.mjs file in a typed directory must start with `// @ts-check` (after an optional shebang):
//    tsconfig.json keeps checkJs off globally so untyped workstreams' modules only contribute inferred types,
//    which makes the header the opt-in. A file without it would silently escape checking, so it fails here.
// 2. tsc -p tsconfig.json (noEmit, strict). Prints the wall time; exit code is tsc's.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const TYPED_DIRS = ['v2/kernel', 'v2/planner', 'v2/server'];
const HEADER = /^(#![^\n]*\n)?\/\/ @ts-check\n/;

const started = performance.now();
const missing = [];
for (const dir of TYPED_DIRS) for (const f of readdirSync(join(root, dir), { recursive: true })) {
  const file = String(f);
  if (!/\.m?js$/.test(file)) continue;
  if (!HEADER.test(readFileSync(join(root, dir, file), 'utf8'))) missing.push(`${dir}/${file}`);
}
if (missing.length) {
  console.error(`typecheck: ${missing.length} file(s) in typed directories lack the '// @ts-check' first line:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
const tsc = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), ...process.argv.slice(2)], { stdio: 'inherit' });
console.log(`typecheck: ${tsc.status === 0 ? 'ok' : 'failed'} in ${Math.round(performance.now() - started)} ms (${TYPED_DIRS.join(', ')})`);
process.exit(tsc.status ?? 1);
