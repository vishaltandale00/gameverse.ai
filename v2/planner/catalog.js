// The catalogue as the planner sees it: every registered primitive (the
// family indexes, promoted primitives, experiment primitives) read through
// registry.cards(), never a fixed list. Nothing here knows any primitive id.
import { readFileSync } from 'node:fs';
import { Registry } from '../kernel/registry.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import { checkFields } from '../kernel/params.js';
import { PRIMITIVES } from '../primitives/index.js';
import { hashOf } from '../server/store.js';

/**
 * Primitives promoted by the improvement loop (v2/improve, target 'primitive') live in
 * v2/primitives/promoted/index.js once one has been applied. Loaded when present; the
 * integrator may also fold them into primitives/index.js, so ids are de-duplicated.
 */
export async function promotedPrimitives() {
  try { const m = await import('../primitives/promoted/index.js'); return m.default || m.PRIMITIVES || []; }
  catch (error) { if (error?.code === 'ERR_MODULE_NOT_FOUND' && /promoted/.test(error.message)) return []; throw error; }
}

export function buildCatalogue(extra = [], base = PRIMITIVES) {
  const ids = new Set(base.map(p => p.id));
  const registry = new Registry([...base, ...extra.filter(p => !ids.has(p.id) && (ids.add(p.id), true))]);
  return { registry, logic: buildLogic(registry, Logic) };
}

export async function loadCatalogue({ extra = [] } = {}) {
  return buildCatalogue([...(await promotedPrimitives()), ...extra]);
}

export const catalogHash = registry => hashOf(registry.cards());

/** A card's params with every default applied (required params without defaults stay missing). */
export function defaultsOf(card) { return checkFields(card.params || {}, {}, '', [], null); }

export const isSpace = id => id.startsWith('engine.space.');
export const isGenerator = id => id.startsWith('engine.generate.');
export const isGraphics = id => id.startsWith('graphics.');
export const slotOf = id => isSpace(id) ? 'space' : isGenerator(id) ? 'generator' : isGraphics(id) ? 'graphics' : 'system';

/**
 * Configurations of a space worth trying when its capabilities depend on params
 * (e.g. a tilemap provides gravity only in side mode): defaults plus every option
 * of each enumerated string param and each boolean, one param at a time.
 */
export function spaceVariants(registry, id) {
  const p = registry.get(id); if (!p) return [];
  const base = defaultsOf(p.card);
  const caps = config => new Set(p.capabilities ? safe(() => p.capabilities(config), []) : p.card.provides?.capabilities || []);
  const out = [{ with: {}, caps: caps(base) }];
  if (!p.capabilities) return out;
  for (const [name, schema] of Object.entries(p.card.params || {})) {
    const values = schema.type === 'string' && schema.options ? schema.options : schema.type === 'boolean' ? [true, false] : [];
    for (const v of values) {
      if (v === base[name]) continue;
      const c = caps({ ...base, [name]: v });
      if (![...c].every(x => out[0].caps.has(x)) || c.size !== out[0].caps.size) out.push({ with: { [name]: v }, caps: c });
    }
  }
  return out;
}
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/** Capability, primitive and service requirements of a primitive. */
export function requirementsOf(registry, id) {
  const r = registry.get(id)?.card.requires || {};
  return { capabilities: r.capabilities || [], primitives: r.primitives || [], services: r.services || [] };
}

/** The registered id satisfying a `requires.primitives` entry (exact or a child id). */
export function satisfying(registry, req, prefer = []) {
  if (registry.has(req)) return req;
  return prefer.find(id => id.startsWith(req + '.')) || registry.ids().find(id => id.startsWith(req + '.')) || null;
}

const fmt = (name, s) => {
  const range = s.min !== undefined || s.max !== undefined ? `[${s.min ?? ''}..${s.max ?? ''}]` : '';
  const opts = s.options ? `(${s.options.join('|')})` : '';
  const def = s.default !== undefined ? `=${JSON.stringify(s.default).slice(0, 40)}` : '';
  const type = s.type === 'ref' ? `ref:${s.to}` : s.type === 'list' ? `list<${s.of?.type === 'ref' ? 'ref:' + s.of.to : s.of?.type || 'json'}>` : s.type;
  return `${name}:${type}${range}${opts}${s.unit ? ' ' + s.unit : ''}${def}${s.required ? ' req' : ''}${s.effect ? ` (${String(s.effect).slice(0, 90)})` : ''}`;
};

/** Model-facing card text. `full` lists every param with its effect; otherwise one line per primitive. */
export function cardText(card, { full = false } = {}) {
  const pr = card.provides || {}, rq = card.requires || {};
  const bits = [`${card.id} — ${card.intent}`];
  if (card.views?.length) bits.push(`views: ${card.views.join(',')}`);
  if (pr.capabilities?.length) bits.push(`provides capabilities: ${pr.capabilities.join(',')}`);
  if (pr.actions?.length) bits.push(`actions: ${pr.actions.join(',')}`);
  if (full && pr.events?.length) bits.push(`events: ${pr.events.join(',')}`);
  if (full && pr.vars?.length) bits.push(`vars: ${pr.vars.join(',')}`);
  if (rq.capabilities?.length) bits.push(`needs capabilities: ${rq.capabilities.join(',')}`);
  if (rq.primitives?.length) bits.push(`needs primitives: ${rq.primitives.join(',')}`);
  if (full && card.reads?.length) bits.push(`reads: ${card.reads.join(',')}`);
  if (full && card.defines?.length) bits.push(`defines: ${card.defines.map(d => `${d.kind} at ${d.at || 'with.' + d.in}`).join(', ')}`);
  const params = Object.entries(card.params || {});
  if (full && params.length) bits.push(`params: ${params.map(([n, s]) => fmt(n, s)).join('; ')}`);
  else if (params.length) bits.push(`params: ${params.map(([n]) => n).join(',')}`);
  return bits.join(' | ');
}

/** The predicate and effect vocabulary currently registered (kernel built-ins plus primitives'). */
export function vocabulary(logic) {
  return { predicates: [...logic.predicates.keys()], effects: [...logic.effects.keys()] };
}

// ---------- data shapes for document sections ----------
// Cards describe params, not the document sections primitives read (plot.dialogue, plot.quests,
// content.items...). Until cards carry those schemas (kernel request in v2/kernel/requests/pipeline.md),
// the shapes come from PRIMITIVE_CATALOG.md §4.1, §4.2 and §8, parsed once.
let shapes = null;
function loadShapes() {
  if (shapes) return shapes;
  shapes = {};
  let text = '';
  try { text = readFileSync(new URL('../PRIMITIVE_CATALOG.md', import.meta.url), 'utf8'); } catch { return shapes; }
  const block = (heading, prefix) => {
    const at = text.indexOf(heading); if (at < 0) return;
    const start = text.indexOf('```', at), end = text.indexOf('```', start + 3); if (start < 0 || end < 0) return;
    let key = null;
    for (const line of text.slice(start + 3, end).split('\n')) {
      const m = /^([a-zA-Z]+)(\[\]|\{\})?\s/.exec(line);
      if (m) { key = `${prefix}.${m[1]}`; shapes[key] = line.trim(); }
      else if (key && line.trim()) shapes[key] += ' ' + line.trim();
    }
  };
  block('### 4.1 Plot data shapes', 'plot');
  block('## 8. Content schemas', 'content');
  const q = text.indexOf('### 4.2 Quest objective kinds'), qe = text.indexOf('\n## ', q + 5);
  if (q >= 0 && shapes['plot.quests']) shapes['plot.quests'] += '\n  objective kinds: ' + text.slice(q, qe).split('\n').filter(l => /^\| `/.test(l)).map(l => l.split('|').slice(1, 3).map(x => x.trim()).join(' ')).join('; ');
  return shapes;
}

/** Shapes of the document sections the given primitives read (the kernel's own sections included). */
export function dataShapes(registry, ids) {
  const all = loadShapes(), out = [];
  const reads = new Set(['plot.characters', 'plot.storyboard', 'plot.endings', 'content.items', 'content.archetypes']);
  for (const id of ids) for (const r of registry.get(id)?.card.reads || []) reads.add(r);
  for (const r of reads) if (all[r]) out.push(all[r]);
  return out;
}
