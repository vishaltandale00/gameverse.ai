// Shared by the headless check (node:vm) and the browser runtime (Worker): the
// harness that hosts an experiment module (v2/kits/EXTENDING.md, tier 3), the
// realm hardening it runs first, and the validators the host applies to what
// comes back. Nothing here touches Node or DOM APIs, so both sides load it.
import { snapshot } from '../kits/mods/compose.js';
import { LIMITS, FORBIDDEN_GLOBALS, moduleBody, harnessSource, cleanDraws, DRAW_TYPES } from './harness.js';
export { LIMITS, FORBIDDEN_GLOBALS, moduleBody, harnessSource, cleanDraws, DRAW_TYPES };

export const EXPERIMENT_SCHEMA = 'gameverse.v2.experiment/0.1';
export const BUTTONS = ['a', 'b'];

// ---------- validation of what an experiment returns (the host trusts none of it) ----------
const num = v => typeof v === 'number' && Number.isFinite(v);
const color = v => typeof v === 'string' && v.length > 0 && v.length <= 40;
const OPS = {
  spawn: o => num(o.x) && num(o.y) && (o.kind === undefined || typeof o.kind === 'string') && (o.hp === undefined || num(o.hp)),
  setBlocked: o => num(o.x) && num(o.y) && typeof o.on === 'boolean',
  score: o => num(o.n),
  hurt: o => o.by === undefined || typeof o.by === 'string',
  defeat: o => o.id !== undefined && o.id !== null && (typeof o.id === 'number' || typeof o.id === 'string'),
  stun: o => o.id !== undefined && o.id !== null && num(o.frames),
  emit: o => typeof o.name === 'string' && o.name.length > 0 && (o.data === undefined || (o.data && typeof o.data === 'object' && !Array.isArray(o.data))),
};
export const OP_NAMES = Object.keys(OPS);

/** Keep the well-formed operations. Returns { ops, malformed, problems }. */
export function cleanOps(ops) {
  if (ops === null || ops === undefined) return { ops: [], malformed: 0, problems: [] };
  if (!Array.isArray(ops)) return { ops: [], malformed: 1, problems: ['ops must be an array'] };
  const out = [], problems = [];
  let malformed = 0;
  for (const o of ops.slice(0, LIMITS.opsPerStep)) {
    const ok = o && typeof o === 'object' && OPS[o.op]?.(o);
    if (ok) out.push(o);
    else { malformed++; if (problems.length < 3) problems.push(`malformed op ${JSON.stringify(o)?.slice(0, 120)}${OPS[o?.op] ? '' : ` (op must be one of ${OP_NAMES.join(', ')})`}`); }
  }
  if (ops.length > LIMITS.opsPerStep) { malformed += ops.length - LIMITS.opsPerStep; problems.push(`${ops.length} ops in one step; at most ${LIMITS.opsPerStep}`); }
  return { ops: out, malformed, problems };
}

/** The world an experiment sees: the kit's adapter, or a read-only stand-in for kits without one (snapshots then carry no player or enemies). */
export function experimentWorld(kit, game) {
  if (kit.world?.adapter) return kit.world.adapter(game);
  return { active: s => s?.status === 'playing', blocked: () => false, defeat: () => 0, lives: s => (Number.isFinite(s?.lives) ? s.lives : null) };
}

/** Buttons an experiment may take: not used by the kit, nor by an active mod. */
export function freeButtons(kit, game) {
  const taken = new Set([...(kit.world?.buttons || (kit.world ? [] : BUTTONS)), ...(game?.mods || []).map(m => m.button).filter(Boolean)]);
  return BUTTONS.filter(b => !taken.has(b));
}

/** Experiment input from host input: movement plus the experiment's own button as held/pressed. */
export function experimentInput(input, button, previous) {
  const held = button ? !!input?.[button] : false;
  return { x: Math.sign(Number(input?.x) || 0), y: Math.sign(Number(input?.y) || 0), held, pressed: held && !previous };
}

/** compose.js's snapshot(), but never throws: some adapters can't report a player outside play (fighting before the bout). */
export function safeSnapshot(kit, world, state, events = []) {
  try { return snapshot(kit, world, state, events); }
  catch {
    let active = false, lives = null;
    try { active = !!world.active(state); } catch {}
    try { lives = world.lives?.(state) ?? null; } catch {}
    return { frame: state?.frame ?? null, active, size: null, player: null, enemies: [], blocked: null, lives, events: events.map(e => ({ ...e })), capabilities: [...(kit.world?.capabilities || [])] };
  }
}
