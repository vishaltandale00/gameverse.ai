#!/usr/bin/env node
// Static composition matrix (v2/planner/compose-check.js): every space kind × every gameplay/plot primitive,
// and the planner's common bundles × every space kind, decided from card declarations alone. No simulation,
// no model calls; tens of milliseconds. Prints a markdown report (or JSON with --json).
//
//   node v2/tools/composition-matrix.mjs [--strict] [--json] [--out file.md] [--overlay declarations.json] [--doc game.json]
// --strict    also list every type hole by card, and exit 1 when any card lacks the declarations needed
//             to decide its compositions.
// --overlay   preview card declarations before they land: { "<primitive id>": { needs, spaces, provides, adapts... } }.
// --doc       also check one document as written (no resolution: it must be complete).
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCatalogue, dataShapes } from '../planner/catalog.js';
import { compositionMatrix, checkComposition, documentedBy, withDeclarations, COMPOSE_CHECK_VERSION } from '../planner/compose-check.js';
import { buildLogic } from '../kernel/world.js';
import { Logic } from '../kernel/logic.js';

const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = name => process.argv.includes(`--${name}`);

const started = performance.now();
let { registry, logic } = await loadCatalogue();
const overlayPath = arg('overlay');
if (overlayPath) { registry = withDeclarations(registry, JSON.parse(readFileSync(overlayPath, 'utf8'))); logic = buildLogic(registry, Logic); }
const loadMs = +(performance.now() - started).toFixed(1);
const documented = documentedBy(dataShapes);
const m = compositionMatrix(registry, { logic, documented });

const VERDICTS = ['compatible', 'compatible-via-adapter', 'incompatible-needs-adapter', 'incompatible', 'undeclared'];
const count = list => Object.fromEntries(VERDICTS.map(v => [v, list.filter(r => r.verdict === v).length]));
const CHECKS = ['capabilities', 'services', 'primitives', 'conflicts', 'content', 'engage', 'data', 'adapter'];
const STATES = ['ok', 'fail', 'needs-adapter', 'undeclared'];
const checkCounts = list => Object.fromEntries(CHECKS.map(c => [c, Object.fromEntries(STATES.map(s => [s, list.filter(r => r.checks[c] === s).length]))]));
/** One matrix cell: ok, via(adapter), A(missing...), X(reason), ? (holes). */
const cell = r => r.verdict === 'compatible' ? 'ok'
  : r.verdict === 'compatible-via-adapter' ? `via ${r.adapters.map(a => a.split('.').slice(1).join('.')).join('+')}`
  : r.verdict === 'incompatible-needs-adapter' ? `A:${[...r.signature.card.adapts.provides.capabilities, ...r.signature.card.adapts.provides.content.map(c => 'content ' + c), ...r.signature.card.adapts.provides.services.map(s => 'svc ' + s)].join(',')}`
  : r.verdict === 'incompatible' ? `X:${[...new Set(r.failures.filter(f => !f.adaptable).map(f => f.code))].join(',')}`
  : '?';
// Which holes block the most decisions (cells left undeclared by each card field).
const blame = new Map();
for (const r of [...m.pairs, ...m.bundles]) if (r.verdict === 'undeclared') for (const h of r.holes) { const k = `${h.card} ${h.field}`; blame.set(k, { ...h, cells: (blame.get(k)?.cells || 0) + 1 }); }
const topHoles = [...blame.values()].sort((a, b) => b.cells - a.cells || a.card.localeCompare(b.card));
// Adapters most often needed: the same (space, signature) across cells.
const wanted = new Map();
for (const r of [...m.pairs, ...m.bundles]) if (r.signature && r.verdict === 'incompatible-needs-adapter') { const a = r.signature.card.adapts, k = JSON.stringify([a.from.spaces, a.provides]); const w = wanted.get(k) || { signature: r.signature, cells: 0, neededBy: new Set() }; w.cells++; r.signature.neededBy.forEach(x => w.neededBy.add(x)); wanted.set(k, w); }
const topAdapters = [...wanted.values()].sort((a, b) => b.cells - a.cells);

let doc = null;
if (arg('doc')) doc = checkComposition(JSON.parse(readFileSync(arg('doc'), 'utf8')), registry, { logic, documented });
const totalMs = +(performance.now() - started).toFixed(1);

const out = { version: COMPOSE_CHECK_VERSION, timing: { loadCatalogueMs: loadMs, matrixMs: m.ms, totalMs }, overlay: overlayPath || null,
  counts: { pairs: count(m.pairs), bundles: count(m.bundles), holes: m.holes.length, cardsWithHoles: new Set(m.holes.map(h => h.card)).size },
  checks: { pairs: checkCounts(m.pairs) }, topHoles: topHoles.slice(0, 25), topAdapters: topAdapters.slice(0, 10).map(w => ({ cells: w.cells, ...w.signature, neededBy: [...w.neededBy].sort() })),
  bundles: m.bundles.map(({ bundle, space, native, verdict, reason, adapters, added }) => ({ bundle, space, native, verdict, reason, adapters, added })), holes: m.holes, doc };

if (flag('json')) process.stdout.write(JSON.stringify({ ...out, pairs: m.pairs.map(({ space, primitive, verdict, reason }) => ({ space, primitive, verdict, reason })) }, null, 1) + '\n');
else {
  const L = [];
  const row = cells => L.push(`| ${cells.join(' | ')} |`);
  L.push(`# Composition matrix (${COMPOSE_CHECK_VERSION})`, '');
  L.push(`Static: card declarations only, no simulation. ${m.kinds.length} space kinds × ${m.primitives.length} gameplay/plot primitives = ${m.pairs.length} pairs; ${Object.keys(out.bundles.reduce((o, b) => (o[b.bundle] = 1, o), {})).length} bundles × ${m.kinds.length} space kinds = ${m.bundles.length}. Matrix ${m.ms} ms (catalogue load ${loadMs} ms, total ${totalMs} ms).${overlayPath ? ` Overlay: ${overlayPath}.` : ''}`, '');
  L.push('Pairs resolve the catalogue: a primitive brings what it requires (required primitives, a service provider, the spawner, a content generator, an adapter) when one is registered and fits the space.', '');
  L.push('## Summary', '');
  row(['', ...VERDICTS]); row(['---', ...VERDICTS.map(() => '---:')]);
  row(['pairs', ...VERDICTS.map(v => out.counts.pairs[v])]);
  row(['bundles', ...VERDICTS.map(v => out.counts.bundles[v])]);
  const onlyContent = m.pairs.filter(r => r.verdict === 'undeclared' && CHECKS.every(c => c === 'content' || r.checks[c] === 'ok')).length;
  L.push('', `Type holes: ${m.holes.length} across ${out.counts.cardsWithHoles} cards. An undeclared cell is never counted as compatible. ${onlyContent} of the ${out.counts.pairs.undeclared} undeclared pairs pass every other check and wait only on content declarations (space card.needs.content, generator card.spaces / provides.content).`, '');
  L.push('### Check states over all pairs', '');
  row(['check', ...STATES]); row(['---', ...STATES.map(() => '---:')]);
  for (const c of CHECKS) row([c, ...STATES.map(s => out.checks.pairs[c][s])]);
  L.push('', '## Bundles × space kinds', '', 'Legend: `ok` compatible; `via x` compatible through adapter x; `A:...` needs an adapter providing those capabilities/content/services; `X:code` incompatible; `?` undeclared (a type hole). The bundle\'s own space kind is in **bold**.', '');
  row(['bundle', ...m.kinds.map(k => k.key)]); row(['---', ...m.kinds.map(() => '---')]);
  for (const name of [...new Set(m.bundles.map(b => b.bundle))]) row([name, ...m.kinds.map(k => { const b = m.bundles.find(x => x.bundle === name && x.space === k.key); return b.native ? `**${cell(b)}**` : cell(b); })]);
  L.push('', '### Bundles on their own space kind', '');
  for (const b of out.bundles.filter(b => b.native)) L.push(`- **${b.bundle}** on ${b.space}: ${b.verdict}. ${b.reason}${b.added.length ? ` (adds ${b.added.join(', ')})` : ''}`);
  L.push('', '## Adapters most needed', '', 'The signature `adapterSignature()` returns: what an adapter would have to provide, and the space it projects from.', '');
  row(['cells', 'from space', 'provides', 'needed by']); row(['---:', '---', '---', '---']);
  for (const w of out.topAdapters) { const a = w.card.adapts; row([w.cells, a.from.spaces.join(','), [...a.provides.capabilities, ...a.provides.content.map(c => `content:${c}`), ...a.provides.services.map(s => `service:${s}`)].join(', '), w.neededBy.slice(0, 6).join(', ') + (w.neededBy.length > 6 ? ` +${w.neededBy.length - 6}` : '')]); }
  L.push('', '## Top type holes', '', 'Card fields whose absence leaves the most cells undeclared.', '');
  row(['cells', 'card', 'field', 'hole']); row(['---:', '---', '---', '---']);
  for (const h of topHoles.slice(0, 25)) row([h.cells, h.card, h.field, h.message]);
  if (flag('strict')) {
    L.push('', '## Strict: every card lacking declarations', '');
    const byCard = new Map(); for (const h of m.holes) byCard.set(h.card, [...(byCard.get(h.card) || []), h]);
    row(['card', 'missing']); row(['---', '---']);
    for (const [card, hs] of [...byCard].sort(([a], [b]) => a.localeCompare(b))) row([card, hs.map(h => `${h.field} (${h.code})`).join('; ')]);
  }
  L.push('', '## Pairs: primitives × space kinds', '');
  row(['primitive', ...m.kinds.map(k => k.key)]); row(['---', ...m.kinds.map(() => '---')]);
  for (const p of m.primitives) row([p, ...m.kinds.map(k => cell(m.pairs.find(r => r.primitive === p && r.space === k.key)))]);
  if (doc) L.push('', '## Document', '', `${arg('doc')}: **${doc.verdict}**. ${doc.reason}`, ...doc.failures.map(f => `- ${f.check} ${f.code}: ${f.message}${f.hint ? ` (${f.hint})` : ''}`));
  const text = L.join('\n') + '\n';
  if (arg('out')) writeFileSync(arg('out'), text); else process.stdout.write(text);
}
if (flag('strict') && m.holes.length) process.exitCode = 1;
