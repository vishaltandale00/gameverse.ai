// Mods: mechanics from one genre switched on inside another ("Pac-Man with guns").
// A mod is written once against a kit's world adapter (kit.world, see
// KIT_CONTRACT.md); any kit that provides the capabilities a mod requires can
// use it. The composer wraps a kit's game and renderer with its mods, so every
// host (studio, overworld) and the pipeline treat a modded game exactly like a
// plain kit game.
import { MODS } from './index.js';

const BUTTONS = ['a', 'b'];

/** Mods a kit can run: its world provides every capability the mod requires and a button is free if needed. */
export function modsFor(kit) {
  const world = kit.world;
  if (!world) return [];
  const free = BUTTONS.filter(b => !(world.buttons || []).includes(b));
  return MODS.filter(m => m.requires.every(c => (world.capabilities || []).includes(c)) && (!m.button || free.length));
}

/** The strict JSON schema fragment the content model fills for a kit's mods: one fixed property per available mod. */
export function modsSchema(kit) {
  const list = modsFor(kit);
  return { type: 'object', additionalProperties: false, required: list.map(m => m.id), properties: Object.fromEntries(list.map(m => [m.id, m.schema])) };
}
export function modsPrompt(kit) {
  const list = modsFor(kit);
  if (!list.length) return '';
  return `\n\nmods: mechanics from other genres you can switch on inside this one, to mix concepts. Turn one on only when the idea or change asks for it (e.g. guns, shooting, bombs in a game that doesn't have them); otherwise leave it off.\n${list.map(m => `- ${m.id}: ${m.summary}`).join('\n')}`;
}

/** Normalize a mods object for a kit; returns the enabled mods with their configs and buttons. */
export function activeMods(kit, mods = {}) {
  const free = BUTTONS.filter(b => !(kit.world?.buttons || []).includes(b));
  const out = [];
  for (const mod of modsFor(kit)) {
    const cfg = mod.normalize(mods?.[mod.id]);
    if (!mod.enabled(cfg)) continue;
    const button = mod.button ? free.shift() : null;
    if (mod.button && !button) continue;
    out.push({ mod, cfg, button });
  }
  return out;
}

/** A kit game with its mods: { createState, step } plus controls, exactly like kit.createGame's result. */
export function composeGame(kit, content, { seed = 1, mods = {} } = {}) {
  const game = kit.createGame(content, { seed });
  const active = activeMods(kit, mods);
  // Controls can depend on content (a runner's flap mode has one button, lanes has four directions).
  const base = kit.controlsFor?.(content) || kit.controls || [];
  if (!active.length) return Object.assign(game, { mods: [], controls: base });
  const world = kit.world.adapter(game);
  const createState = (...args) => {
    const s = game.createState(...args);
    s.mods = {}; s.modHeld = { a: false, b: false };
    for (const { mod, cfg } of active) s.mods[mod.id] = mod.init(cfg, world, s);
    return s;
  };
  const step = (s, input = {}) => {
    // The kit never sees a button a mod owns.
    const kitInput = { ...input };
    for (const { button } of active) if (button) kitInput[button] = false;
    const next = game.step(s, kitInput) || s;
    const emit = (name, data = {}) => next.events.push({ name, ...data });
    for (const { mod, cfg, button } of active) {
      const held = button ? !!input[button] : false;
      mod.step(next.mods[mod.id], { held, pressed: held && !next.modHeld[button], x: input.x || 0, y: input.y || 0 }, cfg, { world, state: next, events: [...next.events], emit });
    }
    next.modHeld = { a: !!input.a, b: !!input.b };
    return next;
  };
  const controls = [...base, ...active.filter(a => a.button).map(({ mod, cfg, button }) => ({ input: button, label: mod.label(cfg) }))];
  return { ...game, createState, step, mods: active, controls };
}

/** The kit's renderer with each mod drawn on top in world coordinates (kit renderers expose render.view). */
export function composeRenderer(kit, game, { art } = {}) {
  const render = kit.createRenderer(game, { art });
  if (!game.mods?.length) return render;
  const fx = {};
  const wrapped = (ctx, state, frame = {}) => {
    render(ctx, state, frame);
    const view = render.view;
    if (!view || !state?.mods) return;
    ctx.save();
    for (const { mod, cfg } of game.mods) mod.render?.(ctx, state.mods[mod.id], cfg, view, (fx[mod.id] ??= {}), frame);
    ctx.restore();
  };
  wrapped.fx = render.fx; wrapped.inner = render;
  return wrapped;
}

// ---------- shared by native mods and sandboxed experiments (v2/kits/EXTENDING.md) ----------
const OP_CAPABILITY = { spawn: 'spawn', setBlocked: 'terrain', score: 'score', hurt: 'hurt', defeat: 'defeat', stun: 'stun', emit: null };

/** Plain-JSON view of the world for a sandbox. Grid kits with size() also get a blocked bitmap. */
export function snapshot(kit, world, state, events = []) {
  const caps = new Set(kit.world?.capabilities || []);
  const size = world.size?.(state) || null;
  let blocked = null;
  if (size && size.w * size.h <= 20000) {
    let bits = '';
    for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) bits += world.blocked(state, x, y) ? '1' : '0';
    blocked = { w: size.w, h: size.h, bits };
  }
  return {
    frame: state.frame ?? null, active: !!world.active(state), size,
    player: caps.has('player') ? world.player(state) : null,
    enemies: caps.has('enemies') ? world.enemies(state).map(({ id, name, x, y, radius, hittable }) => ({ id, name, x, y, radius, hittable })) : [],
    blocked, lives: world.lives?.(state) ?? null,
    events: events.map(e => ({ ...e })),
    capabilities: [...caps],
  };
}

/** Apply operations through the adapter, honoring declared capabilities. Returns { applied, dropped }. */
export function applyOps(kit, world, state, ops = [], emit = () => {}) {
  const caps = new Set(kit.world?.capabilities || []);
  let applied = 0, dropped = 0;
  for (const o of Array.isArray(ops) ? ops.slice(0, 64) : []) {
    const cap = OP_CAPABILITY[o?.op];
    if (cap === undefined || (cap && !caps.has(cap))) { dropped++; continue; }
    const num = v => Number.isFinite(v) ? v : 0;
    try {
      if (o.op === 'spawn' && world.spawn) world.spawn(state, { x: num(o.x), y: num(o.y), kind: typeof o.kind === 'string' ? o.kind.slice(0, 24) : undefined, hp: o.hp });
      else if (o.op === 'setBlocked' && world.setBlocked) world.setBlocked(state, Math.round(num(o.x)), Math.round(num(o.y)), !!o.on);
      else if (o.op === 'score' && world.addScore) world.addScore(state, Math.max(-1e6, Math.min(1e6, Math.round(num(o.n)))));
      else if (o.op === 'hurt' && world.hurtPlayer) world.hurtPlayer(state, { by: String(o.by || 'experiment').slice(0, 40) });
      else if (o.op === 'defeat') world.defeat(state, o.id, { by: 'experiment' });
      else if (o.op === 'stun' && world.stun) world.stun(state, o.id, Math.max(1, Math.min(600, Math.round(num(o.frames) || 60))));
      else if (o.op === 'emit') emit(String(o.name || 'experiment').slice(0, 32), typeof o.data === 'object' && o.data ? o.data : {});
      else { dropped++; continue; }
      applied++;
    } catch { dropped++; }
  }
  return { applied, dropped };
}
