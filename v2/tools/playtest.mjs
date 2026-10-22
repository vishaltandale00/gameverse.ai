#!/usr/bin/env node
// Preflight + compose + headless playtest a spec, printing a JSON report.
//   node v2/tools/playtest.mjs v2/examples/coin-cavern.json [--budget-ms 1500]
import { readFile } from 'node:fs/promises';
import { defaultRegistry } from '../modules/index.js';
import { preflight } from '../engine/spec.js';
import { compose } from '../engine/compose.js';
import { playtest } from '../engine/playtest.js';

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('usage: playtest.mjs <spec.json> [--budget-ms N]'); process.exit(2); }
const budgetMs = Number(rest[rest.indexOf('--budget-ms') + 1]) || 1500;
const t0 = performance.now();
const registry = defaultRegistry();
const checked = preflight(JSON.parse(await readFile(file, 'utf8')), registry);
const preflightMs = performance.now() - t0;
if (!checked.ok) { console.log(JSON.stringify({ stage: "preflight", preflightMs, errors: checked.errors }, null, 2)); process.exitCode = 1; } else {
const game = compose(checked.spec, registry);
const report = playtest(game, { budgetMs });
console.log(JSON.stringify({ preflightMs: +preflightMs.toFixed(2), warnings: checked.warnings, ...report }, null, 2));
process.exitCode = report.ok ? 0 : 1; }
