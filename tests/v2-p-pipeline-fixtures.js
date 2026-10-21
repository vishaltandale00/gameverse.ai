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
 * primitive the mechanic is offered (picks: mechanic id -> ids), else "none".
 */
export function buildAnswer(req, { space = [], picks = {} } = {}) {
  const name = String(req.schema?.name || '');
  const props = req.schema?.schema?.properties || {};
  if (name === 'pick_space') { const offered = props.space.enum; return JSON.stringify({ space: space.find(s => offered.includes(s)) || offered[0], why: 'scripted' }); }
  if (name === 'pick_primitive') {
    const mechanic = /\nMechanic (\S+) \(/.exec(req.user)?.[1];
    const offered = props.pick.enum;
    return JSON.stringify({ pick: (picks[mechanic] || []).find(id => offered.includes(id)) || 'none', why: 'scripted', spec: '' });
  }
  return null;
}

export const decomposition = (mechanics, extra = {}) => ({
  version: 'test', title: 'Test Game', premise: 'A test premise. Second sentence.', tone: 'brisk', references: [], views: [], spaces: [], acts: 2, zones: 4,
  mechanics: mechanics.map((m, i) => ({ id: `m${i}`, verb: m.split(' ')[0], description: m, from: '', importance: 'core' })), ...extra,
});
