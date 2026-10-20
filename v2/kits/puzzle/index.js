// Block-and-match puzzle kit (see ../KIT_CONTRACT.md). One kit, four modes chosen by content.mode:
// falling (Tetris guideline), chain (Puyo-like pairs or the Dr. Mario-like virus variant),
// swap (match-3 with specials) and slide (2048-like).
import { SCHEMA, PROMPT, validate, goalText } from './content.js';
import { FALLING_SAMPLE } from './sample.js';
import { createFalling } from './falling.js';
import { createChain } from './chain.js';
import { createSwap } from './swap.js';
import { createSlide } from './slide.js';
import { verifyContent } from './verify.js';
import { createPuzzleRenderer } from './render.js';

const CREATE = { falling: createFalling, chain: createChain, swap: createSwap, slide: createSlide };
const normalized = content => {
  const v = validate(content);
  if (!v.ok) throw Object.assign(Error(`puzzle content failed validation: ${v.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ')}`), { errors: v.errors });
  return v.content;
};

const HOW = {
  falling: 'Arrows move, Down soft-drops, Up hard-drops. A rotates right, B rotates left, A+B together holds.',
  chain: 'Arrows move, Down drops faster, Up drops at once. A and B rotate the pair.',
  virus: 'Arrows move, Down drops faster, Up drops at once. A and B rotate the capsule.',
  swap: 'Move the cursor, press A to pick a gem, then push a direction to swap. B cancels.',
  slide: 'Push a direction to slide every tile; equal tiles merge.',
};

export default {
  id: 'puzzle',
  name: 'Block and match puzzle',
  version: '0.1.0',
  summary: 'Falling blocks with SRS rotation, hold and T-spins; chain-popping pairs and virus capsules; match-3 swaps with specials and level goals; 2048-style sliding merges.',
  examples: ['Tetris', 'Puyo Puyo', 'Dr. Mario', 'Bejeweled', 'Candy Crush', '2048', 'Threes'],
  content: { schema: SCHEMA, prompt: PROMPT, sample: FALLING_SAMPLE },
  validate,
  cast(content) {
    const c = content.cast || {};
    return {
      brief: { player: { name: c.hero || 'Mascot' }, enemy: { name: c.rival || 'Rival' }, pickup: { name: c.item || 'Gem' }, hazard: { name: c.blocker || 'Block' }, goal: { name: c.prize || 'Trophy' } },
      entities: { hero: { tags: ['player'] }, rival: { tags: ['enemy'] }, item: { tags: ['collectible'] }, blocker: { tags: ['hazard'] }, prize: { tags: ['goal'] } },
    };
  },
  createGame(content, { seed = 1 } = {}) {
    const c = normalized(content);
    return CREATE[c.mode](c, { seed });
  },
  createRenderer(game, { art } = {}) { return createPuzzleRenderer(game, { art: art || {} }); },
  verify(content, { seed = 1, budgetMs = 2000 } = {}) {
    const v = validate(content);
    if (!v.ok) return { ok: false, problems: v.errors, report: { proven: [], ms: 0 } };
    return verifyContent(v.content, { seed, budgetMs });
  },
  controls: [
    { input: 'move', label: 'Move / drop / slide' },
    { input: 'a', label: 'Rotate / select' },
    { input: 'b', label: 'Rotate back / cancel' },
  ],
  goal(content) {
    const c = validate(content).content;
    if (!c) return '';
    const key = c.mode === 'chain' && c.rules.variant === 'virus' ? 'virus' : c.mode;
    return `${goalText(c, c.levels[0])}. ${HOW[key]}`;
  },
  stats(state) {
    if (state.mode === 'falling') return [['Lines', String(state.lines)], ['Level', String(state.level + 1)], ['Tetrises', String(state.stats.tetrises)], ['T-spins', String(state.stats.tspins)]];
    if (state.mode === 'chain') return [['Level', String(state.level + 1)], ['Best chain', String(state.stats.bestChain)], ...(state.variant === 'virus' ? [['Cleared', String(state.stats.viruses)]] : [])];
    if (state.mode === 'swap') return [['Level', String(state.level + 1)], ['Best cascade', String(state.stats.bestCascade)], ['Specials', String(state.stats.specials)]];
    if (state.mode === 'slide') return [['Biggest tile', String(state.maxTile)], ['Moves', String(state.stats.moves)]];
    return [];
  },
};
