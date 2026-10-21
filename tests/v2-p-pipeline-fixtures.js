// Test-only primitives for the pipeline tests: a space whose capabilities depend on a param,
// gameplay primitives with capability requirements, and fakes for writers and decisions.
// None of them is registered in the catalogue.
import { testSpace } from '../v2/kernel/testing.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const ALL = testSpace.card.provides.capabilities;
export const flatSpace = {
  id: 'engine.space.flatx',
  card: {
    intent: 'A flat field of cells and boxes, top-down or seen from the side (side view adds gravity).',
    views: ['td', 'side'],
    params: {
      mode: { type: 'string', options: ['topdown', 'side'], default: 'topdown', effect: 'side view adds gravity' },
      size: { type: 'list', of: { type: 'integer', min: 1, max: 512 }, default: [160, 16, 1], effect: 'cells along x, y, z' },
    },
    provides: { capabilities: ALL, events: ['enter_zone', 'leave_zone'] },
  },
  capabilities: c => (c.mode === 'side' ? ALL : ALL.filter(x => x !== 'gravity')),
  install: (rt, c, inst) => testSpace.install(rt, { size: c.size, gravity: 0, solid: [] }, inst),
};
export const dash = {
  id: 'gameplay.test.dash',
  card: {
    intent: 'Dash: a burst of speed through enemies in the facing direction, with a cooldown.',
    views: ['side', 'td'],
    params: {
      speed: { type: 'number', default: 12, min: 1, max: 40, unit: 'cells/s', effect: 'dash speed' },
      cooldown: { type: 'number', default: 1, min: 0.1, max: 10, unit: 's', effect: 'time between dashes' },
    },
    provides: { actions: ['dash'], events: ['dashed'], vars: ['dashes'] },
    requires: { capabilities: ['overlap', 'gravity'] },
  },
  install(rt) { rt.action('dash', (v, rt) => { rt.state.vars.dashes = (rt.state.vars.dashes || 0) + 1; rt.emit('dashed', {}); }); },
};
export const warp = {
  id: 'gameplay.test.warp',
  card: { intent: 'Warp travel through wormholes between distant stars.', params: {}, provides: { actions: ['warp'] }, requires: { capabilities: ['wormholes'] } },
  install() {},
};
export const broken = {
  id: 'gameplay.test.broken',
  card: { intent: 'Juggling flaming torches for a crowd.', params: {} },
  install() { throw Error('boom'); },
};
/** A primitive whose own validate() returns a code no generic repair knows (only the model can fix it). */
export const picky = {
  id: 'gameplay.test.picky',
  card: { intent: 'Insists that the title starts with "The".', params: {} },
  validate(config, doc) { return /^The /.test(doc.title || '') ? [] : [{ code: 'picky_title', path: 'title', message: 'the title must start with "The"', hint: 'rename the game' }]; },
  install() {},
};
export const tunnels = {
  id: 'gameplay.test.tunnels',
  card: { intent: 'Tunnels: leaving the board on one edge comes back on the other, with units occupying cells.', params: {}, requires: { capabilities: ['occupancy', 'wrap'] } },
  install() {},
};
export const extras = [flatSpace, dash, warp, tunnels];
// Unit tests use a fixed slice of the real catalogue, so they don't change meaning as workstreams add
// primitives; the server/e2e tests and the benchmark run against the full catalogue.
export const BASE_IDS = ['engine.space.graph', 'engine.space.grid', 'engine.space.tilemap', 'plot.storyboard', 'gameplay.inventory', 'graphics.ui.story'];
export const basePrimitives = () => BASE_IDS.map(id => PRIMITIVES.find(p => p.id === id)).filter(Boolean);
export const testCatalogue = (more = []) => buildCatalogue([...extras, ...more], basePrimitives());

/** A writer that replays scripted replies (strings or functions of the request) and records every call. */
export function fakeWriter(replies, { model = 'fake-writer' } = {}) {
  const calls = [];
  return {
    provider: 'fake', model, calls,
    async complete(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      const text = typeof r === 'function' ? r(req, calls.length - 1) : typeof r === 'string' ? r : JSON.stringify(r);
      return { text, ms: 1, model };
    },
  };
}

/** Decisions that answer from a function of the questions. */
export function fakeDecisions(answer, provider = 'fake') {
  const calls = [];
  return { provider, calls, async decide(req) { calls.push(req); return { provider, answers: answer(req.questions, req) }; } };
}

/**
 * Answers the iterative build's questions (v2/planner/build.js) from preferences, or null for any other request:
 * pick_space takes the first preferred space on offer (else the first offered), pick_primitive the first preferred
 * primitive the mechanic is offered (picks: mechanic id -> ids), else "none". The loop steps (build-steps.js:
 * pick_win, pick_lose, pick_driver, pick_coverage) take the first of `steps[kind]` on offer, else "none"; a kind
 * `steps` does not list takes the best-ranked option (the first offered).
 */
export function buildAnswer(req, { space = [], picks = {}, steps = {} } = {}) {
  const name = String(req.schema?.name || '');
  const props = req.schema?.schema?.properties || {};
  if (name === 'pick_space') { const offered = props.space.enum; return JSON.stringify({ space: space.find(s => offered.includes(s)) || offered[0], why: 'scripted' }); }
  if (name === 'pick_primitive') {
    const mechanic = /\nMechanic (\S+) \(/.exec(req.user)?.[1];
    const offered = props.pick.enum;
    return JSON.stringify({ pick: (picks[mechanic] || []).find(id => offered.includes(id)) || 'none', why: 'scripted', spec: '' });
  }
  const step = /^pick_(win|lose|driver|coverage)$/.exec(name)?.[1];
  if (step) {
    const offered = props.pick.enum;
    const want = steps[step];
    return JSON.stringify({ pick: want ? want.find(id => offered.includes(id)) || 'none' : offered[0], why: 'scripted', spec: '' });
  }
  return null;
}

/** A writer that only answers the build's questions (buildAnswer), e.g. for a selection with a model. */
export const buildWriter = (options = {}) => fakeWriter([req => buildAnswer(req, options) ?? '{}']);

export const decomposition = (mechanics, extra = {}) => ({
  version: 'test', title: 'Test Game', premise: 'A test premise. Second sentence.', tone: 'brisk', references: [], views: [], spaces: [], acts: 2, zones: 4,
  mechanics: mechanics.map((m, i) => ({ id: `m${i}`, verb: m.split(' ')[0], description: m, from: '', importance: 'core' })), ...extra,
});

const DECOMPOSE_FORMS = { idea_concepts: 'concepts', concept_mechanics: 'mechanics', play_spec: 'spec', idea_about: 'about', idea_spaces: 'where', idea_story: 'story' };
const DECOMPOSE_DEFAULTS = {
  about: { title: 'Test Game', premise: 'A test premise. Second sentence.', tone: 'brisk' },
  where: { spaces: [{ role: 'world', kind: 'locations', description: 'a world' }], views: ['text'], movement: 'ground' },
  story: { acts: 2, zones: 4 },
};

/**
 * Answers the iterative decomposition's small forms (v2/planner/decompose.js) from a plan, or returns null for any other
 * request. plan: { concepts: Concept[], mechanics: { [conceptId]: mechanic[] }, spec, about?, where?, story? }. Any plan
 * entry may be a function (req, n, concept) returning that form's whole reply object (or raw text), n counting that
 * form's asks (its field re-asks included), to script re-asks. A field re-ask is answered from the same reply, per slot.
 */
export function decomposer(plan) {
  const asked = new Map();
  return req => {
    const name = String(req.schema?.name || '');
    const key = DECOMPOSE_FORMS[name.replace(/_fields$/, '')];
    if (!key) return null;
    const concept = key === 'mechanics' ? /\nConcept: (\S+) \(/.exec(req.user)?.[1] : undefined;
    const tag = concept ? `${key}:${concept}` : key;
    const n = asked.get(tag) || 0;
    asked.set(tag, n + 1);
    const given = plan[key] ?? DECOMPOSE_DEFAULTS[key];
    let v = typeof given === 'function' ? given(req, n, concept)
      : key === 'concepts' ? { concepts: given } : key === 'mechanics' ? { mechanics: given[concept] || [] } : given;
    if (typeof v === 'string') return v;
    // Step 1 names its references: unless the plan scripts them, one per concept, by its name.
    if (key === 'concepts' && !v.references) v = { references: v.concepts.map(c => ({ name: c.name, concept: c.id })), ...v };
    if (name.endsWith('_fields')) return JSON.stringify(Object.fromEntries(Object.entries(req.schema.schema.properties).map(([k, p]) => [k, v[p.description.split(':')[0]]])));
    return JSON.stringify(v);
  };
}

/**
 * A plan from a one-shot decomposition (the shape the model used to write in one call): one concept per mechanic.from
 * ('' = one concept, 'idea'); the concept holding core.loop brings the loop, and core.loop's mechanic has role loop.
 * `concepts` overrides fields of the derived concepts by id.
 */
export function planFrom(d, concepts = {}) {
  const idOf = from => (String(from || '').toLowerCase().match(/[a-z0-9]+/g) || ['idea']).join('_');
  const ids = [...new Set(d.mechanics.map(m => idOf(m.from)))];
  return {
    concepts: ids.map(id => ({ id, name: id.replace(/_/g, ' '), quote: '', kind: 'game', brings: d.mechanics.some(m => idOf(m.from) === id && m.id === d.core.loop) ? 'loop' : 'content', keeps: [], ...concepts[id] })),
    mechanics: Object.fromEntries(ids.map(id => [id, d.mechanics.filter(m => idOf(m.from) === id).map(m => ({ id: m.id, verb: m.verb, description: m.description, from: id, role: m.id === d.core.loop ? 'loop' : m.importance }))])),
    spec: { loop: d.core.loop, interaction: d.core.interaction, opponent: d.core.opponent, win: d.core.win, lose: d.core.lose ?? '', theme: d.core.theme ?? '', narrative: d.core.narrative ?? false, mashup: d.core.mashup ?? [] },
    about: { title: d.title, premise: d.premise, tone: d.tone ?? '' },
    where: { spaces: d.spaces, views: d.views, movement: d.movement ?? 'ground' },
    story: { acts: d.acts ?? 2, zones: d.zones ?? 4 },
  };
}
