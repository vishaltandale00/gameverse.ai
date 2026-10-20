// The physics-toy game: level flow (intro, play, clear, fail), lives and
// scoring around the four modes. createGame(content, { seed }) returns
// { createState(), step(state, input) }; state is plain JSON.
import { seedFrom } from '../../kernel/rng.js';
import { emit } from './flow.js';
import * as breakout from './modes/breakout.js';
import * as peggle from './modes/peggle.js';
import * as slingshot from './modes/slingshot.js';
import * as pinball from './modes/pinball.js';

export const MODE_IMPL = { breakout, peggle, slingshot, pinball };
export const INTRO_TIME = 2.2, CLEAR_TIME = 2.6, FAIL_TIME = 1.8;
const DT = 1 / 60;
const NEUTRAL = { x: 0, y: 0, a: false, b: false };

export function createGame(content, { seed = 1 } = {}) {
  const levels = content.levels;

  function startLevel(S, index, { retry = false } = {}) {
    const level = levels[index];
    S.level = index; S.mode = level.mode; S.phase = 'intro'; S.phaseT = retry ? INTRO_TIME * 0.55 : 0;
    S.levelScore = 0; S.timeScale = 1; S.banner = null; S.note = '';
    S.levelSeed = seedFrom(`${seed}:${index}`);
    if (!retry) S.attempt = 0; else S.attempt++;
    MODE_IMPL[level.mode].build(S, level, { seed, index });
    emit(S, 'level_start', { level: index, mode: level.mode, title: level.name });
  }

  function createState() {
    const S = {
      status: 'playing', score: 0, events: [], reason: '', lives: content.lives, level: 0, mode: levels[0].mode,
      phase: 'intro', phaseT: 0, frame: 0, rng: seedFrom(`physics:${seed}`), prev: { ...NEUTRAL }, timeScale: 1,
      levelScore: 0, levelSeed: 0, attempt: 0, banner: null, note: '', cast: content.cast, world: null, m: null,
      stats: { cleared: 0, lifeLost: 0 },
    };
    startLevel(S, 0);
    S.events = [];
    return S;
  }

  function step(S, input = NEUTRAL) {
    S.events = [];
    if (S.status !== 'playing') return S;
    const inp = { x: Math.sign(input.x || 0), y: Math.sign(input.y || 0), a: !!input.a, b: !!input.b };
    const press = { a: inp.a && !S.prev.a, b: inp.b && !S.prev.b, up: inp.y < 0 && S.prev.y >= 0, down: inp.y > 0 && S.prev.y <= 0, left: inp.x < 0 && S.prev.x >= 0, right: inp.x > 0 && S.prev.x <= 0 };
    S.prev = inp;
    S.frame++;
    S.phaseT += DT;
    if (S.banner) { S.banner.t += DT; if (S.banner.t > 2) S.banner = null; }
    const level = levels[S.level], impl = MODE_IMPL[level.mode];
    if (S.phase === 'intro') {
      impl.ambient?.(S, level);
      if (S.phaseT >= INTRO_TIME || (press.a && S.phaseT > 0.4)) { S.phase = 'play'; S.phaseT = 0; emit(S, 'go', {}); }
      return S;
    }
    if (S.phase === 'play') {
      const livesBefore = S.lives;
      impl.step(S, level, inp, press);
      if (S.lives < livesBefore) S.stats.lifeLost += livesBefore - S.lives;
      return S;
    }
    // Clear and fail phases keep the world moving so debris settles.
    impl.ambient?.(S, level);
    if (S.phase === 'clear' && S.phaseT >= CLEAR_TIME) {
      S.stats.cleared++;
      if (S.level + 1 >= levels.length) { S.status = 'won'; S.phase = 'over'; emit(S, 'won', {}); }
      else startLevel(S, S.level + 1);
    } else if (S.phase === 'fail' && S.phaseT >= FAIL_TIME) startLevel(S, S.level, { retry: true });
    return S;
  }

  return { content, seed, levels, createState, step, startLevel: (S, i) => { startLevel(S, i); return S; } };
}
