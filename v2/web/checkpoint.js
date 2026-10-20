// Checkpoints for the player host: remember the last safe ground and, after
// a fall into a pit with health to spare, respawn there on a cloned state.
// Engine rules are untouched: a fall still ends the run in the engine; the
// host restores the position and costs one hp. Pure and deterministic.

const solidAt = (state, width, height, tx, ty) => tx < 0 || tx >= width ? true : ty < 0 || ty >= height ? false : state.solid[ty * width + tx] === 1;

/**
 * Update the checkpoint after a step. A spot is safe when the player stands
 * on solid ground under both feet (a landing, or settled footing) with no
 * hazard or enemy close by and no invulnerability running.
 */
export function updateCheckpoint(checkpoint, state, { width, height }) {
  if (state.status !== 'playing') return checkpoint;
  const p = state.entities.find(e => e.tags.includes('player'));
  if (!p) return checkpoint;
  const landed = state.events.some(e => e.name === 'land');
  if (!p.data?.grounded && !landed) return checkpoint;
  if ((state.modules.health?.invuln || 0) > 0) return checkpoint;
  const fy = Math.floor(p.y + p.h + 0.05);
  if (!solidAt(state, width, height, Math.floor(p.x + 0.05), fy) || !solidAt(state, width, height, Math.floor(p.x + p.w - 0.05), fy)) return checkpoint;
  const near = state.entities.some(e => (e.tags.includes('hazard') || e.tags.includes('enemy')) && Math.abs(e.x + e.w / 2 - (p.x + p.w / 2)) < 2.2 && Math.abs(e.y + e.h / 2 - (p.y + p.h / 2)) < 2.2);
  if (near) return checkpoint;
  if (checkpoint && checkpoint.x === p.x && checkpoint.y === p.y) return checkpoint;
  return { x: p.x, y: p.y, frame: state.frame };
}

/** The player's starting spot is the first checkpoint. */
export function initialCheckpoint(state) {
  const p = state.entities.find(e => e.tags.includes('player'));
  return p ? { x: p.x, y: p.y, frame: state.frame } : null;
}

/** True when this step was a pit fall that a checkpoint can absorb. */
export const canRespawn = (state, checkpoint) => !!checkpoint && state.status === 'lost'
  && state.events.some(e => e.name === 'fell') && (state.vars.hp ?? 0) > 1;

/** A cloned state with the player back at the checkpoint, one hp fewer, briefly invulnerable. */
export function respawn(state, checkpoint, { invuln = 1.2 } = {}) {
  const next = structuredClone(state);
  const p = next.entities.find(e => e.tags.includes('player'));
  Object.assign(p, { x: checkpoint.x, y: checkpoint.y, vx: 0, vy: 0 });
  p.data = { ...p.data, grounded: true, buffer: 0, coyote: 0 };
  next.vars.hp -= 1;
  if (next.modules.health) next.modules.health.invuln = Math.max(next.modules.health.invuln || 0, invuln);
  next.status = 'playing';
  next.events = [...next.events, { name: 'respawn' }];
  return next;
}
