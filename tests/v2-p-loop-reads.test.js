// Every registered card that declares a win or a lose (card.loop / card.mode, v2/kernel/loop.js) declares what that
// end reads (`reads`: a component, an event or a var, with `by`: what changes it), and every name in it is one the
// primitive's code actually uses. The check is derived from the code: each primitive's source file (and the local
// modules it imports) is read, and each declared name must be something that source writes, emits, registers or
// subscribes to, and that the card (or the primitive it names) declares. The same holds for the encounter outcomes
// (card.loop.outcome) loops declare for engine.adapt.nested: every result names an effects param that exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, outcomeOf } from '../v2/kernel/loop.js';
import { ownersOf } from '../v2/planner/loop-check.js';

const { registry, logic } = buildCatalogue();
const ROOT = fileURLToPath(new URL('../v2/primitives/', import.meta.url));

/** id -> source text of the module that declares it (`id: '<id>'`, or the `ID`/`KEY` constant it uses), with the local modules it imports. */
const FILES = readdirSync(ROOT, { recursive: true }).map(String).filter(f => f.endsWith('.js')).map(f => ({ file: join(ROOT, f), text: readFileSync(join(ROOT, f), 'utf8') }));
const sources = new Map();
for (const card of registry.cards()) {
  const decl = new RegExp(`(?:\\bid:|\\b(?:ID|KEY) =)\\s*'${card.id.replace(/\./g, '\\.')}'`);
  const hit = FILES.filter(f => decl.test(f.text));
  if (hit.length !== 1) continue;
  const { file, text } = hit[0];
  const local = [...text.matchAll(/from '(\.\.?\/[^']+\.js)'/g)].map(m => readFileSync(resolve(dirname(file), m[1]), 'utf8'));
  sources.set(card.id, [text, ...local].join('\n'));
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The source of a primitive and of the host its loop plays through (card.mode.via). */
const codeOf = id => [sources.get(id), sources.get(cardLoop(registry.get(id)?.card)?.via)].filter(Boolean).join('\n');
const covers = (list, name) => (list || []).some(x => x === name || x === `${name.split(':')[0]}:*` || (x.endsWith('.*') && name.startsWith(x.slice(0, -1))));
const literal = (src, name) => new RegExp(`['"\`]${esc(name)}['"\`:$]`).test(src);

const ENDS = registry.cards().flatMap(card => { const l = cardLoop(card); return ['win', 'lose'].filter(side => l?.[side]).map(side => ({ id: card.id, card, side, end: l[side], via: l.via })); });

/** Problems of declared loop ends' reads against their primitives' code. */
function problemsOf(ends) {
  const problems = [];
  for (const { id, card, side, end, via } of ends) {
    const at = `${id} ${side}.reads`, r = end.reads, src = codeOf(id);
    assert.ok(sources.has(id), `${id}: its source module was found`);
    if (!r || typeof r !== 'object') { problems.push(`${at}: missing`); continue; }
    const kinds = ['component', 'event', 'var'].filter(k => typeof r[k] === 'string');
    if (kinds.length !== 1) { problems.push(`${at}: names ${kinds.length} of component/event/var (exactly one)`); continue; }
    const host = via ? registry.get(via)?.card : null;
    const from = r.from ? registry.get(r.from)?.card : null;
    if (r.from && !from) problems.push(`${at}.from: '${r.from}' is not registered`);
    const writer = from || card, writerSrc = from ? sources.get(r.from) || '' : src;
    if (r.component) {
      // A component some registered card owns (card.components), read by this primitive's code.
      if (!ownersOf(registry, r.component).length) problems.push(`${at}.component: no card owns '${r.component}'`);
      if (!new RegExp(`components\\??\\.${esc(r.component)}\\b|['"]${esc(r.component)}['"]`).test(src)) problems.push(`${at}.component: the code never reads components.${r.component}`);
      if (r.of && !['opponents', 'player'].includes(r.of)) problems.push(`${at}.of: '${r.of}' (opponents | player)`);
    }
    if (r.event) {
      if (!covers(writer.provides?.events, r.event)) problems.push(`${at}.event: ${writer.id} does not provide '${r.event}'`);
      if (!literal(writerSrc, r.event)) problems.push(`${at}.event: ${writer.id}'s code never emits '${r.event}'`);
    }
    if (r.var) {
      if (!covers(writer.provides?.vars, r.var)) problems.push(`${at}.var: ${writer.id} does not provide '${r.var}'`);
      if (!literal(writerSrc, r.var) && !new RegExp(`vars\\.${esc(r.var)}\\b`).test(writerSrc)) problems.push(`${at}.var: ${writer.id}'s code never writes '${r.var}'`);
    }
    const by = r.by || {};
    for (const k of Object.keys(by)) if (!['actions', 'effects', 'events', 'movement'].includes(k)) problems.push(`${at}.by.${k}: unknown`);
    for (const a of by.actions || []) {
      if (!covers([...(card.provides?.actions || []), ...(host?.provides?.actions || [])], a)) problems.push(`${at}.by.actions: '${a}' is not an action ${id} provides`);
      if (!literal(src, a)) problems.push(`${at}.by.actions: the code never registers '${a}'`);
    }
    // Effects: registered by the primitive, one it requires or plays through, the component's owner or `from`.
    const allowed = new Set([id, via, r.from, ...(card.requires?.primitives || []), ...(r.component ? ownersOf(registry, r.component) : [])].filter(Boolean));
    for (const e of by.effects || []) {
      const owner = logic.owners.effect.get(e);
      if (!owner || !allowed.has(owner)) problems.push(`${at}.by.effects: '${e}' is registered by ${owner || 'nothing'}, not ${[...allowed].join(' / ')}`);
    }
    for (const e of by.events || []) if (!new RegExp(`\\.on\\(\\s*['"\`]${esc(e)}`).test(src)) problems.push(`${at}.by.events: the code never subscribes to '${e}'`);
    if (by.movement !== undefined && (by.movement !== true || !(card.requires?.capabilities || []).length)) problems.push(`${at}.by.movement: only true, and only for a primitive that reads the space (requires capabilities)`);
  }
  return problems;
}

test('every card that declares a win or lose declares what it reads, and its code uses every name in it', () => {
  assert.ok(ENDS.length >= 30, `${ENDS.length} declared wins and losses`);
  assert.deepEqual(problemsOf(ENDS), []);
});

test('the check catches what the code does not use: wrong names, owners and changers are each reported', () => {
  const real = id => ENDS.find(e => e.id === id && e.side === 'win');
  const broken = (id, reads) => { const e = real(id); return { ...e, end: { ...e.end, reads } }; };
  const found = problemsOf([
    { ...real('gameplay.turns'), end: { param: 'onVictory' } },
    broken('gameplay.turns', { component: 'stamina', of: 'opponents' }),
    broken('gameplay.race', { event: 'lapped_out' }),
    broken('gameplay.slide.merge', { var: 'slide.min' }),
    broken('gameplay.farming', { event: 'harvested', by: { actions: ['plough'], effects: ['craft'], events: ['rained'] } }),
    broken('gameplay.launcher', { event: 'destroyed' }),
  ]);
  for (const what of ['gameplay.turns win.reads: missing', "no card owns 'stamina'", "does not provide 'lapped_out'", "never writes 'slide.min'", "'plough' is not an action", "'craft' is registered by gameplay.crafting", "never subscribes to 'rained'", "gameplay.launcher does not provide 'destroyed'"])
    assert.ok(found.some(p => p.includes(what)), `${what} in ${JSON.stringify(found, null, 1)}`);
});

test('every encounter outcome a loop declares names an effects param of the loop (or the host it plays through)', () => {
  const declared = registry.cards().filter(c => c.loop?.outcome);
  assert.deepEqual(declared.map(c => c.id).sort(), ['gameplay.cards', 'gameplay.creature.battle', 'gameplay.minigame', 'gameplay.race', 'gameplay.rounds', 'gameplay.turns']);
  for (const card of declared) {
    const o = outcomeOf(card.loop.outcome);
    assert.ok(o, `${card.id}: card.loop.outcome is well formed`);
    const l = cardLoop(card), host = l.via ? registry.get(l.via)?.card : null;
    for (const [result, r] of Object.entries(o.results)) {
      const [p, field] = r.param.split('.');
      const spec = card.params?.[p] ?? host?.params?.[p];
      const type = field ? spec?.of?.fields?.[field]?.type : spec?.type;
      assert.equal(type, 'effects', `${card.id} outcome ${result}: ${r.param} is an effects param`);
      assert.ok(literal(codeOf(card.id), field || p) || codeOf(card.id).includes(`.${field || p}`), `${card.id} outcome ${result}: its code runs ${r.param}`);
    }
    // The loop's own win and lose are among its results.
    for (const side of ['win', 'lose']) if (l[side]?.param) assert.ok(Object.values(o.results).some(r => r.param === l[side].param), `${card.id}: its ${side} param is an outcome result`);
  }
});
