// Test fixtures for the modes workstream (imported by tests/v2-p-modes-*.test.js only).
// - waterSpace: engine.space.test plus a flat ground plane and a water rectangle,
//   so boats and terrain-following vehicles can be tested before real spaces land.
// - stubHealth: a minimal stand-in for gameplay.combat.health (damage/heal/kill
//   over components.health {max, hp}), for primitives whose actions deal damage.
// - doc(): a document skeleton on the test space.
import { testSpace } from '../../kernel/testing.js';
import { checkFields } from '../../kernel/params.js';

export const waterSpace = {
  id: 'engine.space.water-test',
  card: {
    intent: 'Test space: engine.space.test with flat ground at groundY and water over a rectangle.',
    params: {
      ...testSpace.card.params,
      groundY: { type: 'number', default: 0 },
      water: { type: 'list', default: [], of: { type: 'json' }, effect: '[x0, z0, x1, z1, depth]' },
      ramps: { type: 'list', default: [], of: { type: 'json' }, effect: '[x0, z0, x1, z1, height] raised ground' },
    },
    provides: testSpace.card.provides,
  },
  install(rt, config, instance) {
    testSpace.install(rt, config, instance);
    const api = rt.space(instance.id);
    const inRect = (r, x, z) => x >= r[0] && z >= r[1] && x < r[2] && z < r[3];
    api.groundAt = (x, z) => { const r = config.ramps.find(q => inRect(q, x, z)); const w = config.water.find(q => inRect(q, x, z)); return { y: config.groundY + (r ? r[4] : 0) - (w ? w[4] : 0), normal: [0, 1, 0], material: r ? 'ramp' : w ? 'sand' : 'asphalt' }; };
    api.waterDepthAt = (x, z) => { const w = config.water.find(q => inRect(q, x, z)); return w ? w[4] : 0; };
    api.slide = (e, delta, rt) => { api.setPos(e, e.at.map((v, i) => v + (delta[i] ?? 0)), rt); return { moved: true, blocked: { x: false, y: false, z: false }, grounded: true }; };
  },
};

export const stubHealth = {
  id: 'gameplay.combat.health',
  card: { intent: 'test stub: hp in components.health', ambient: true, provides: { events: ['damaged', 'defeated', 'defeated:*', 'died'] } },
  logic(logic) {
    const hp = (rt, e, c) => { const t = rt.resolve(e.who, c); if (!t) return null; const h = (t.components.health ??= { max: 10 }); h.hp ??= h.max; return { t, h }; };
    logic.effect('damage', { run: (e, rt, c) => { const r = hp(rt, e, c); if (!r || r.h.hp <= 0) return; r.h.hp = Math.max(0, r.h.hp - (e.amount ?? 1)); rt.emit('damaged', { who: r.t.id, amount: e.amount ?? 1 }); if (r.h.hp === 0) { rt.emit('died', { who: r.t.id }); rt.emitTyped('defeated', r.t.archetype, { who: r.t.id }); } } });
    logic.effect('heal', { run: (e, rt, c) => { const r = hp(rt, e, c); if (r) r.h.hp = Math.min(r.h.max, r.h.hp + (e.amount ?? r.h.max)); } });
    logic.effect('kill', { run: (e, rt, c) => { const r = hp(rt, e, c); if (r && r.h.hp > 0) { r.h.hp = 0; rt.emit('died', { who: r.t.id }); rt.emitTyped('defeated', r.t.archetype, { who: r.t.id }); } } });
  },
};

export function doc({ space = 'engine.space.test', with: w = { size: [32, 8, 1] }, zones = [], systems = [], archetypes = [], player = { archetype: 'hero', at: [1, 1, 0] }, content = {}, extraSpaces = [], plot } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'modes-test', title: 'Modes test', seed: 11,
    spaces: [{ id: 'world', use: space, with: w, zones }, ...extraSpaces],
    systems,
    content: { archetypes: [{ id: 'hero', components: {} }, ...archetypes], ...content },
    ...(plot ? { plot } : {}),
    ...(player ? { player } : {}),
  };
}

/** Param errors for every instance of the given primitives in parsed game documents. */
export function gameInstanceErrors(games, primitives) {
  const byId = new Map(primitives.map(p => [p.id, p])), out = [];
  for (const [name, d] of games) (d.systems || []).forEach((s, i) => {
    const p = byId.get(s.use); if (!p) return;
    const errors = []; checkFields(p.card.params || {}, s.with || {}, `${name}.systems[${i}].with`, errors, null);
    out.push({ name, use: s.use, errors: errors.filter(e => e.code !== 'ref_unknown') });
  });
  return out;
}

/** Run n steps with input from fn(i). */
export function drive(rt, n, fn) { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(typeof fn === 'function' ? fn(i) : (fn || {})); return rt; }
