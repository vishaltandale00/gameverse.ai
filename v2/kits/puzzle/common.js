// Shared simulation helpers for every puzzle mode: input edges, auto-shift,
// seeded randomness kept in state, events and level bookkeeping.
import { random } from '../../kernel/rng.js';
import { boardDims, maxViruses } from './content.js';

export const DT = 1 / 60;
export const DAS = 10, ARR = 2; // frames: delayed auto-shift and auto-repeat rate

/** Held input → this frame's held values plus presses (edges). Keeps the previous input in state. */
export function edges(state, input) {
  const p = state.prev || { x: 0, y: 0, a: false, b: false };
  const i = { x: Math.sign(input?.x || 0), y: Math.sign(input?.y || 0), a: !!input?.a, b: !!input?.b };
  state.prev = i;
  return { ...i, left: i.x < 0 && p.x >= 0, right: i.x > 0 && p.x <= 0, up: i.y < 0 && p.y >= 0, down: i.y > 0 && p.y <= 0, aP: i.a && !p.a, bP: i.b && !p.b };
}

/** Auto-shift for a held axis: −1/0/1 steps this frame (once on press, then every ARR after DAS). */
export function autoShift(rep, dir, das = DAS, arr = ARR) {
  if (!dir) { rep.dir = 0; rep.t = 0; return 0; }
  if (dir !== rep.dir) { rep.dir = dir; rep.t = 0; return dir; }
  rep.t++;
  return rep.t >= das && (rep.t - das) % arr === 0 ? dir : 0;
}

export const rint = (state, n) => Math.floor(random(state) * n);
export function shuffleInPlace(state, list) {
  for (let i = list.length - 1; i > 0; i--) { const j = rint(state, i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
export const emit = (state, name, data) => { state.events.push(data ? { ...data, name } : { name }); };

export function baseState(mode, seed) {
  return { mode, status: 'playing', score: 0, events: [], reason: '', rng: (Number(seed) >>> 0) || 1, prev: { x: 0, y: 0, a: false, b: false }, frame: 0, time: 0, level: 0, levelT: 0, levelScore: 0, phase: 'intro', phaseT: 0 };
}

export function lose(state, reason) {
  if (state.status !== 'playing') return;
  state.status = 'lost'; state.reason = reason; state.phase = 'over';
  emit(state, 'hurt'); emit(state, 'lost', { reason });
}
export function win(state) {
  if (state.status !== 'playing') return;
  state.status = 'won'; state.phase = 'over';
  emit(state, 'reach_goal'); emit(state, 'won');
}

/** Level i, continuing past the last written level when the game is endless. */
export function levelAt(content, i) {
  const list = content.levels, last = list[list.length - 1];
  if (i < list.length) return list[i];
  const extra = i - list.length + 1;
  return { ...last, name: `${last.name} ${extra + 1}`, intro: 'Endless: keep going!', speed: Math.min(20, last.speed + extra), target: last.goal === 'tile' ? last.target * 2 ** extra : last.goal === 'score' ? Math.round(last.target * (1 + extra * 0.5)) : last.target, obstacles: content.mode === 'chain' && content.rules.variant === 'virus' ? Math.min(maxViruses(boardDims(content)), last.obstacles + 3 * extra) : last.obstacles };
}
export const isLastLevel = (content, i) => i >= content.levels.length - 1 && !content.rules.endless;

/** Stars earned for a level score against its thresholds. */
export const starsFor = (level, score) => level.stars.filter(t => score >= t).length;
