// Instant tweaks: map common requests ("floatier", "faster", "harder", "more
// enemies", "double jump", "add a timer", "let me shoot") to tunable or level
// patches without a model. Values are clamped to each tunable's declared
// range, so a tweak can never produce an invalid spec. Unmatched requests are
// left for a model (Haiku) by the caller.
import { random, seedFrom } from '../engine/rng.js';

const RULES = [
  { re: /float|floaty|moon|low gravity|lighter/, set: [['platformer', 'gravity', 0.65], ['platformer', 'maxFall', 0.75]] },
  { re: /heav|weight|snappier|less floaty/, set: [['platformer', 'gravity', 1.35], ['platformer', 'maxFall', 1.2]] },
  { re: /higher jump|jump higher|bigger jump|jumpier/, set: [['platformer', 'jumpSpeed', 1.18]] },
  { re: /lower jump|jump lower|smaller jump/, set: [['platformer', 'jumpSpeed', 0.85]] },
  { re: /faster|speedy|quick|zoom|speed up/, set: [['platformer', 'runSpeed', 1.35], ['platformer', 'accel', 1.3], ['topdown', 'speed', 1.35], ['topdown', 'accel', 1.3]] },
  { re: /slower|slow down|relaxed|chill/, set: [['platformer', 'runSpeed', 0.75], ['topdown', 'speed', 0.75]] },
  { re: /slippery|ice|icy|slide/, set: [['platformer', 'friction', 0.25], ['topdown', 'friction', 0.25]] },
  { re: /harder|difficult|challenging|tougher/, set: [['patrol', 'speed', 1.4], ['health', 'hp', -1, 'add'], ['timer', 'seconds', 0.75]] },
  { re: /easier|easy|forgiving|kid/, set: [['patrol', 'speed', 0.7], ['health', 'hp', 2, 'add'], ['timer', 'seconds', 1.5], ['platformer', 'coyoteTime', 1.5]] },
  { re: /double jump|jump twice|air jump/, set: [['platformer', 'airJumps', 1, 'assign']] },
  { re: /triple jump/, set: [['platformer', 'airJumps', 2, 'assign']] },
  { re: /no stomp|can'?t stomp/, set: [['patrol', 'stomp', false, 'assign']] },
];

function clamp(t, value) {
  if (t.type) return value;
  return Math.min(t.max, Math.max(t.min, Math.round(value * 1000) / 1000));
}

function moduleEntry(spec, id) { return spec.modules.find(m => m.use === id); }

function addModule(spec, registry, use, values = {}) {
  if (moduleEntry(spec, use) || !registry.get(use)) return false;
  spec.modules.push({ use, with: values }); return true;
}

// Place more copies of the enemy kind on empty tiles that sit on solid ground.
function addEnemies(spec, factor, seed) {
  const legend = spec.level.legend;
  const enemyChar = Object.keys(legend).find(ch => (spec.entities[legend[ch]]?.tags || []).includes('enemy'));
  if (!enemyChar) return 0;
  const solidChars = new Set(Object.keys(legend).filter(ch => spec.entities[legend[ch]]?.solid));
  const playerChar = Object.keys(legend).find(ch => (spec.entities[legend[ch]]?.tags || []).includes('player'));
  const rows = spec.level.rows.map(r => [...r]);
  const player = rows.flatMap((r, y) => r.map((c, x) => c === playerChar ? [x, y] : null)).find(Boolean) || [0, 0];
  const current = rows.flat().filter(c => c === enemyChar).length;
  const wanted = Math.max(1, Math.round(current * (factor - 1)) || 2);
  const topdown = spec.modules.some(m => m.use === 'topdown');
  const candidates = [];
  rows.forEach((r, y) => r.forEach((c, x) => {
    if (c !== '.' || Math.abs(x - player[0]) + Math.abs(y - player[1]) < 6) return;
    if (topdown || (rows[y + 1] && solidChars.has(rows[y + 1][x]))) candidates.push([x, y]);
  }));
  const state = { rng: seedFrom(seed) };
  let placed = 0;
  while (placed < wanted && candidates.length) {
    const [x, y] = candidates.splice(Math.floor(random(state) * candidates.length), 1)[0];
    rows[y][x] = enemyChar; placed++;
  }
  spec.level.rows = rows.map(r => r.join(''));
  return placed;
}

/** Apply rule-based tweaks. Returns { spec, patch, matched }. Never mutates the input. */
export function tweakSpec(input, request, registry) {
  const spec = structuredClone(input), text = request.toLowerCase(), patch = [];
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    for (const [use, key, amount, mode = 'scale'] of rule.set) {
      const entry = moduleEntry(spec, use), t = registry.get(use)?.card.tunables?.[key];
      if (!entry || !t) continue;
      const before = entry.with?.[key] ?? t.default;
      const after = clamp(t, mode === 'assign' ? amount : mode === 'add' ? before + amount : before * amount);
      if (after === before) continue;
      entry.with = { ...(entry.with || {}), [key]: after };
      patch.push({ op: 'set', module: use, tunable: key, from: before, to: after });
    }
  }
  const more = text.match(/more (enemies|monsters|baddies|robots|bugs|beetles|zombies|ghosts|aliens)|(\d+)x enemies|double the enemies/);
  if (more) { const n = addEnemies(spec, text.includes('double') ? 2 : 1.6, request); if (n) patch.push({ op: 'add_entities', tag: 'enemy', count: n }); }
  const seconds = text.match(/(\d+)\s*(?:s|sec|secs|seconds)\b/);
  if (/timer|clock|time limit|hurry|countdown|against the clock/.test(text) && !moduleEntry(spec, 'timer')) {
    const value = clamp(registry.get('timer').card.tunables.seconds, seconds ? Number(seconds[1]) : 60);
    addModule(spec, registry, 'timer', { seconds: value });
    const lose = { count: 'time_up', gte: 1 };
    spec.lose = spec.lose ? { any: [spec.lose, lose] } : lose;
    patch.push({ op: 'add_module', module: 'timer', with: { seconds: value } });
  }
  if (/shoot|blast|laser|gun|zap|projectile|bullet/.test(text) && !moduleEntry(spec, 'shooter') && Object.values(spec.entities).some(d => (d.tags || []).includes('enemy'))) {
    const aim = spec.modules.some(m => m.use === 'topdown') ? 'stick' : 'facing';
    addModule(spec, registry, 'shooter', { aim });
    patch.push({ op: 'add_module', module: 'shooter', with: { aim } });
  }
  return { spec, patch, matched: patch.length > 0 };
}
