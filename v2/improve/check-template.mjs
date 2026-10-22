#!/usr/bin/env node
// Host-owned gate for a template promotion (target 'template'), run by the job in its own process so the contract's
// bots never block the server:
//   node v2/improve/check-template.mjs --template <template.json>
// Runs the whole template contract (v2/templates/contract.js checkTemplate) against this checkout's live catalogue
// (registered and promoted primitives), on the candidate whose derived tune keeps only the params proven playable over
// their whole range. Prints one JSON line { ok, problems, evidence, template, tuneDropped, catalogHash } and exits 1 on
// any problem.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { liveCatalogue, catalogHash } from '../planner/catalog.js';
import { checkTemplate } from '../templates/contract.js';
import { provenTune } from './template.js';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const file = arg('template');
const done = out => { console.log(JSON.stringify(out)); process.exit(out.ok ? 0 : 1); };
if (!file) done({ ok: false, problems: [{ code: 'usage', message: 'usage: --template <template.json>' }] });
const candidate = JSON.parse(readFileSync(resolve(file), 'utf8'));
const catalogue = await liveCatalogue();
// The derived tune keeps only the candidates proven playable over their whole range (improve/template.js provenTune).
const proven = provenTune(candidate, catalogue), template = { ...candidate, tune: proven.tune };
const r = await checkTemplate(template, catalogue);
done({ ...r, template, tuneDropped: proven.dropped, catalogHash: catalogHash(catalogue.registry) });
