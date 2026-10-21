#!/usr/bin/env node
// The schema sampler over the live catalogue (v2/planner/schema-sampler.js), for one card, a family prefix or all:
//   node v2/tools/sample-schemas.mjs [<id or prefix> ...] [--json]
// Prints each finding (form_rejected, rule_undeclared, validator_crashed), the declared rules no sample reached and the
// cards no template document hosts; exits 1 when there is any. The catalogue conformance test runs the same sampling.
import { TEMPLATES } from '../templates/registry.js';
import { liveCatalogue } from '../planner/catalog.js';
import { sampleCatalogue } from '../planner/schema-sampler.js';

const args = process.argv.slice(2), json = args.includes('--json'), wanted = args.filter(a => !a.startsWith('--'));
const { registry, logic } = await liveCatalogue();
const ids = registry.ids().filter(id => !wanted.length || wanted.some(w => id === w || id.startsWith(`${w}.`) || id.startsWith(w)));
const t0 = performance.now();
const r = sampleCatalogue({ corpus: TEMPLATES.map(t => ({ id: t.id, doc: t.doc })), registry, logic, ids });
const ms = Math.round(performance.now() - t0);
if (json) console.log(JSON.stringify({ ms, ...r }));
else {
  const seen = new Set();
  for (const f of r.findings) {
    const key = `${f.use}|${f.code}|${f.form}.${f.field}|${f.message.split(':')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`${f.code}  ${f.use}  ${f.form}.${f.field} = ${f.value.slice(0, 80)}\n    at ${f.path}: ${f.message}`);
  }
  for (const u of r.unreached) console.log(`rule_unreached  ${u.use}  ${u.code}: no form-allowed answer (nor a declared example) emits it`);
  for (const u of r.unhosted) console.log(`card_unhosted  ${u.use}: ${u.why}`);
  console.log(`${ids.length} cards, ${r.cards.reduce((a, c) => a + c.samples, 0)} samples in ${ms} ms: ${seen.size} distinct findings (${r.findings.length} in all), ${r.unreached.length} unreached rules, ${r.unhosted.length} unhosted cards`);
}
process.exit(r.findings.length || r.unreached.length || r.unhosted.length ? 1 : 0);
