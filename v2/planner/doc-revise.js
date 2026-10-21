// Layer 5 of ARCHITECTURE.md §4 plus targeted revisions, for kernel documents.
// - tweakDocument: parameter patches with no model and no code (<1 s). Requests
//   are matched against the cards' own params (name, effect text, unit) of the
//   instances in the document, so it works for any primitive; values are
//   clamped to each param's declared range. A decision model, when present,
//   confirms which candidate params the request means.
// - reviseDocument: a writer proposes targeted ops (set/add/remove at
//   identity-aware paths); nothing else in the document can change.
// - reviewChange: the one review of a change; blocks only a game that cannot run,
//   everything else (removals, look changes, finishability, applied-or-not) is a note.
import { regressed } from './verify-adapter.js';
import { cardText, vocabulary, dataShapes } from './catalog.js';
import { tokens } from './select.js';
import { parsePath } from './repair.js';
import { contentDiff, changeSummary, shrunkLists, asksToRemove, checkRevision } from './revision-check.js';
import { parseReply } from './writer.js';

export const REVISE_VERSION = 'doc-revise/0.1';

const UP = /\b(more|faster|quicker|bigger|larger|higher|longer|stronger|harder|tougher|increase\w*|boost\w*|extra|double|wider|taller|heavier|louder|denser|busier|raise|max)\b/;
const DOWN = /\b(less|fewer|slower|smaller|lower|shorter|weaker|easier|gentler|decrease\w*|reduc\w*|half|lighter|narrower|quieter|sparser|calmer|min)\b/;
// What comparative adjectives are about, as param vocabulary (not primitive ids).
const IMPLIED = [
  [/\b(fast|faster|quick|quicker|slow|slower|speed)\b/, 'speed velocity rate pace accel run move'],
  [/\b(hard|harder|tough|tougher|easy|easier|difficult\w*|gentler)\b/, 'damage difficulty aggression spawn enemy count rate'],
  [/\b(big|bigger|large|larger|small|smaller|wide|wider|size)\b/, 'size width height radius scale count zones'],
  [/\b(long|longer|short|shorter)\b/, 'duration seconds time length'],
  [/\b(strong|stronger|weak|weaker)\b/, 'damage strength power force'],
  [/\b(busy|busier|dense|denser|sparse|sparser|crowd\w*)\b/, 'density count spawn population per'],
  [/\b(high|higher|low|lower|jump\w*)\b/, 'height jump gravity'],
];
const ENABLE = /\b(enable|turn on|add|allow|let me|with)\b/, DISABLE = /\b(disable|turn off|no|without|remove|stop|don'?t)\b/;

function instancesOf(doc) {
  const out = [];
  (doc.spaces || []).forEach((s, i) => { out.push({ inst: s, path: `spaces[${i}]` }); (s.generators || []).forEach((g, j) => out.push({ inst: g, path: `spaces[${i}].generators[${j}]` })); });
  (doc.systems || []).forEach((s, i) => out.push({ inst: s, path: `systems[${i}]` }));
  (doc.graphics || []).forEach((g, i) => out.push({ inst: g, path: `graphics[${i}]` }));
  return out;
}

/** Candidate params for a request: numeric and boolean params of the document's instances, scored by vocabulary overlap. */
export function tweakCandidates(doc, request, registry) {
  const text = request.toLowerCase();
  const want = new Set([...tokens(text), ...IMPLIED.filter(([re]) => re.test(text)).flatMap(([, w]) => tokens(w))]);
  const out = [];
  for (const { inst, path } of instancesOf(doc)) {
    const p = registry.get(inst.use); if (!p) continue;
    const idTokens = new Set(tokens(inst.use.split('.').slice(1).join(' ')));
    for (const [name, s] of Object.entries(p.card.params || {})) {
      if (!['number', 'integer', 'boolean'].includes(s.type)) continue;
      const own = new Set(tokens(`${name.replace(/([a-z])([A-Z])/g, '$1 $2')} ${s.effect || ''} ${s.unit || ''}`));
      const nameHits = tokens(name.replace(/([a-z])([A-Z])/g, '$1 $2')).filter(t => want.has(t)).length;
      const hits = [...own].filter(t => want.has(t)).length + nameHits + [...idTokens].filter(t => want.has(t)).length * 0.5;
      if (hits > 0) out.push({ path: `${path}.with.${name}`, use: inst.use, param: name, schema: s, score: hits, current: inst.with?.[name] ?? s.default });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

const round = v => Math.round(v * 1000) / 1000;
function nextValue(c, direction, request) {
  const s = c.schema, cur = c.current;
  if (s.type === 'boolean') return DISABLE.test(request) ? false : ENABLE.test(request) ? true : !cur;
  const number = request.match(/\b(\d+(?:\.\d+)?)\b/);
  let v;
  if (number && /\b(to|=|at|of)\s+\d/.test(request)) v = Number(number[1]);
  else if (typeof cur !== 'number') v = s.min ?? 1;
  else if (/\bdouble|twice\b/.test(request)) v = cur * 2 * (direction < 0 ? 0.25 : 1);
  else if (/\bhalf|halve\b/.test(request)) v = cur / 2;
  else v = cur === 0 ? (direction > 0 ? (s.max !== undefined ? Math.min(s.max, 1) : 1) : 0) : cur * (direction > 0 ? 1.35 : 0.74);
  v = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v));
  return s.type === 'integer' ? Math.round(v) : round(v);
}

function setPath(doc, path, value) {
  const keys = parsePath(path); let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

const TWEAK_Q = 'Would changing this parameter in the stated direction carry out the request? Answer no if it is about a different thing than the request names.';

/**
 * tweakDocument(doc, request, { registry, decisions? }) -> { doc, ops: [{ path, use, param, from, to }], matched, ms, source }
 * Only parameter values change; never code, never content lists.
 */
export async function tweakDocument(input, request, { registry, decisions = null, limit = 4 } = {}) {
  const started = performance.now();
  const text = String(request || '').toLowerCase();
  const direction = UP.test(text) && !DOWN.test(text) ? 1 : DOWN.test(text) && !UP.test(text) ? -1 : (/\b(harder|tougher)\b/.test(text) ? 1 : /\beasier\b/.test(text) ? -1 : 0);
  let candidates = tweakCandidates(input, text, registry).filter(c => c.schema.type === 'boolean' ? (ENABLE.test(text) || DISABLE.test(text)) && c.score >= 2 : direction !== 0 || /\b(to|=)\s+\d/.test(text));
  let source = 'rules';
  if (decisions && candidates.length > 1) {
    try {
      const top = candidates.slice(0, 8);
      const { answers, provider } = await decisions.decide({ state: { request, direction: direction > 0 ? 'increase' : direction < 0 ? 'decrease' : 'set' }, questions: Object.fromEntries(top.map((c, i) => [`p${i}`, { type: 'noul', instructions: `${TWEAK_Q}\nParameter: ${c.use} → ${c.param} (${c.schema.effect || c.schema.type}${c.schema.unit ? ', ' + c.schema.unit : ''})` }])) });
      const bar = provider === 'd1' ? 0.6 : 0.5;
      candidates = top.filter((_, i) => (answers[`p${i}`]?.noul ?? 0) >= bar);
      source = provider;
    } catch { /* rules decide */ }
  } else candidates = candidates.filter(c => c.score >= Math.max(1, (candidates[0]?.score || 0) * 0.6));
  const doc = structuredClone(input), ops = [];
  for (const c of candidates.slice(0, limit)) {
    const to = nextValue(c, direction || 1, text);
    if (to === c.current || to === undefined) continue;
    setPath(doc, c.path, to);
    ops.push({ path: c.path, use: c.use, param: c.param, from: c.current, to });
  }
  return { doc, ops, matched: ops.length > 0, ms: Math.round(performance.now() - started), source };
}

// ---------- model revisions as targeted ops ----------
const OPS_SCHEMA_TEXT = `{ "ops": [ { "op": "set"|"add"|"remove", "path": "...", "value": ... } ], "unsupported": [ { "request": "...", "why": "..." } ], "summary": "..." }`;

/** Resolve an identity-aware path: [n] indexes, [id] finds by id, then by `use` (instances). Returns { parent, key } or null. */
export function resolvePath(doc, path, { create = false } = {}) {
  const parts = String(path).match(/[^.[\]]+|\[[^\]]+\]/g) || [];
  let o = doc;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i], sel = raw.startsWith('[') ? raw.slice(1, -1) : null, last = i === parts.length - 1;
    let key = raw;
    if (sel !== null) {
      if (!Array.isArray(o)) return null;
      key = /^\d+$/.test(sel) ? Number(sel) : o.findIndex(x => x?.id === sel) >= 0 ? o.findIndex(x => x?.id === sel) : o.findIndex(x => x?.use === sel);
      if (key < 0) return null;
    }
    if (last) return { parent: o, key };
    if (o[key] === undefined) { if (!create) return null; o[key] = {}; }
    o = o[key];
  }
  return null;
}

export function applyOps(input, ops) {
  const doc = structuredClone(input), applied = [], failed = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    const at = resolvePath(doc, op.path, { create: op.op !== 'remove' });
    if (!at) { failed.push({ ...op, why: 'path not found' }); continue; }
    const { parent, key } = at;
    // Setting an index past the end of a list appends (never leaves holes in the list).
    if (op.op === 'set') { if (Array.isArray(parent) && typeof key === 'number' && key >= parent.length) parent.push(structuredClone(op.value)); else parent[key] = structuredClone(op.value); applied.push(op); }
    else if (op.op === 'add') {
      if (parent[key] === undefined) parent[key] = Array.isArray(op.value) ? [] : {};
      const target = parent[key];
      if (Array.isArray(target)) { target.push(...(Array.isArray(op.value) ? structuredClone(op.value) : [structuredClone(op.value)])); applied.push(op); }
      else if (target && typeof target === 'object' && op.value && typeof op.value === 'object') { Object.assign(target, structuredClone(op.value)); applied.push(op); }
      else failed.push({ ...op, why: 'add needs a list or object' });
    } else if (op.op === 'remove') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; applied.push(op); }
    else failed.push({ ...op, why: `unknown op '${op.op}'` });
  }
  return { doc, applied, failed };
}

export function reviseSystem(registry, logic, doc) {
  const v = vocabulary(logic), used = new Set([...doc.spaces.map(s => s.use), ...(doc.systems || []).map(s => s.use), ...(doc.graphics || []).map(g => g.use)]);
  return `You make one targeted change to a game document (schema ${doc.schema}), as a list of ops:
${OPS_SCHEMA_TEXT}
Paths are dotted with selectors: [n] is an index, [id] selects by id (or, for spaces/systems/graphics, by primitive "use"). Examples:
  {"op":"set","path":"systems[gameplay.inventory].with.slots","value":12}
  {"op":"add","path":"content.items","value":{"id":"lamp","name":"Lamp"}}
  {"op":"add","path":"plot.storyboard.acts[act_1].beats","value":{"id":"x","when":{"zone":"hall"},"do":[...]}}
  {"op":"set","path":"spaces[manor].zones[hall].name","value":"Great Hall"}
  {"op":"add","path":"systems","value":{"use":"<primitive id from the catalogue>","with":{}}}
Rules:
- Change only what the request asks; everything else stays exactly as it is. Never remove content unless the request asks for fewer or removal.
- Don't change graphics or content.models unless the request is about looks.
- Mechanics come only from catalogue primitives. If the request needs a mechanic no primitive provides, list it in "unsupported" with a short why and don't fake it (renaming or restyling is not the mechanic).
- Predicates: ${v.predicates.join(', ')}. Effects: ${v.effects.join(', ')}.
Primitives in this game:
${[...used].filter(id => registry.has(id)).map(id => cardText({ id, ...registry.get(id).card }, { full: true })).join('\n')}
Other primitives:
${registry.cards().filter(c => !used.has(c.id)).map(c => cardText(c)).join('\n') || '(none)'}
Shapes of the sections the game's primitives read:
${dataShapes(registry, [...used]).join('\n')}`;
}

export async function reviseDocument({ writer, doc, change, registry, logic, errors = null, previous = null }) {
  const user = `Document:\n${JSON.stringify(doc).slice(0, 60000)}\n\nChange request: ${change}${errors ? `\n\nYour previous ops produced a document that failed checks:\n${errors}\nPrevious ops: ${JSON.stringify(previous).slice(0, 6000)}\nReturn corrected ops.` : ''}`;
  const reply = await writer.complete({ system: reviseSystem(registry, logic, doc), user });
  const out = parseReply(reply.text);
  return { ops: Array.isArray(out.ops) ? out.ops : [], unsupported: Array.isArray(out.unsupported) ? out.unsupported.slice(0, 6) : [], summary: String(out.summary || '').slice(0, 300), ms: reply.ms, model: reply.model };
}

const LOOKS = /\b(look|looks|color|colour|art|style|sprite|model|graphic\w*|theme|palette|visual\w*|draw\w*|paint\w*|night|day|lighting|font|ui)\b/i;
const artOf = doc => ({ graphics: doc.graphics || [], models: doc.content?.models || {}, art: doc.art || null });

/**
 * Review of a change (one place for every revision guard). The user's request is the authority:
 * a change is blocked only when the changed game cannot run (invalid document, or the playtest crashes).
 * Everything else the review notices is a note on the published version, never a refusal:
 * - content the request didn't ask to remove; look changes on a request that isn't about looks;
 * - a game that could be finished and no longer provably can;
 * - the decision model doubting the request was fully carried out.
 * -> { block: null | { code, message }, notes: [string], dropped, artChanged, revisionCheck, changes, diff, lines }
 */
export async function reviewChange({ before, after, change, decisions = null, unsupported = [], verifyBefore = null, verifyAfter = null }) {
  const notes = [];
  let block = null;
  if (verifyAfter && !verifyAfter.ok) block = { code: 'invalid', message: 'The changed game failed its document checks.' };
  else if (verifyAfter && verifyAfter.viable === false) block = { code: 'not_playable', message: `That change leaves a game that crashes: ${verifyAfter.viability}` };
  const shrunk = [...shrunkLists(before.plot || {}, after.plot || {}, 'plot'), ...shrunkLists(before.content || {}, after.content || {}, 'content'), ...shrunkLists({ spaces: before.spaces, systems: before.systems }, { spaces: after.spaces, systems: after.systems })];
  const dropped = shrunk.length && !(await asksToRemove(decisions, change, shrunk)) ? shrunk : [];
  if (dropped.length) notes.push(`removed ${dropped.map(d => d.path).join(', ')}`);
  const artChanged = JSON.stringify(artOf(before)) !== JSON.stringify(artOf(after));
  if (artChanged && !LOOKS.test(change)) notes.push('changed the look');
  if (verifyBefore && verifyAfter && regressed(verifyBefore, verifyAfter)) notes.push('the game could be finished before this change and no longer provably can');
  const diff = contentDiff(strip(before), strip(after));
  const revisionCheck = await checkRevision(decisions, { change, engine: 'gameverse kernel document', before: strip(before), after: strip(after), unsupported });
  if (revisionCheck?.notApplied) notes.push('the checker is not sure the change fully does what was asked');
  return { block, notes, dropped, artChanged, revisionCheck, changes: changeSummary(diff), diff: diff.length, lines: diff.slice(0, 20) };
}
/** Kept for callers of the old name: a review without verification results. */
export const guardRevision = args => reviewChange(args).then(r => ({ ...r, ok: true }));
const strip = doc => { const { experiments, ...rest } = doc; return rest; };
