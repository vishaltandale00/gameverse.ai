// verify(content, { seed, budgetMs }) (CONTRACT.md §5, KIT_CONTRACT.md "Verification"):
//   1. content validation;
//   2. map checks (every exit, trainer and item reachable) and world reachability with badge gates
//      in story order: gym g is reachable with g−1 badges, the league only with all of them;
//   3. a battle-balance sim: a greedy party leveled on the curve beats each leader in ≥ 70% of
//      seeded runs for every starter, and wins level-matched wild battles ≥ 95%;
//   4. a scripted critical-path playthrough by the input-driven bot, when the budget allows.
import { validate, gymOrder, levelCurve, areaStages, difficultyOffset, settingsOf } from '../content.js';
import { generateMaps, checkMap, neighbors } from '../world/maps.js';
import { T } from '../world/tiles.js';
import { createCreature, statsOf, startBattle, chooseAction, resolveTurn, needsInput, battleResult, bestMove, bestMatchup, moveScore, moveOf, lookup, effectiveness } from '../rules/index.js';
import { evolvedAt } from '../world/story.js';
import { createGame } from '../game.js';
import { createBot } from './bot.js';

export const VERIFY_VERSION = 'creature-verify/0.1';
const now = () => (globalThis.performance?.now?.() ?? Date.now());

/** World reachability through warps, with guards closed until their badge count is met. */
export function worldReach(content, world, badges) {
  const { maps, spawns } = world;
  const seenTiles = new Map(), mapsReached = new Set();
  const queue = [[spawns.start.map, spawns.start.x, spawns.start.y]];
  while (queue.length) {
    const [id, sx, sy] = queue.shift();
    const map = maps[id];
    if (!map) continue;
    const key = `${id}:${sx},${sy}`;
    if (seenTiles.has(key)) continue;
    mapsReached.add(id);
    const blocked = new Set(map.entities.filter(e => e.kind !== 'item' && e.kind !== 'starter' && !(e.kind === 'guard' && (e.gate?.badge || 0) <= badges && !e.gate?.flag)).map(e => `${e.x},${e.y}`));
    const open = map.puzzle ? { ...map, tiles: map.tiles.map(r => r.replaceAll(T.barrier, T.floor)) } : map;
    const dist = new Set([`${sx},${sy}`]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      seenTiles.set(`${id}:${x},${y}`, true);
      const w = map.warps.find(v => v.x === x && v.y === y);
      if (w) { queue.push([w.to, w.tx, w.ty]); if (x !== sx || y !== sy) continue; }
      for (const [nx, ny] of neighbors(open, x, y, blocked)) { const k = `${nx},${ny}`; if (!dist.has(k)) { dist.add(k); q.push([nx, ny]); } }
    }
  }
  return mapsReached;
}

function gateProblems(content, world) {
  const problems = [], gyms = gymOrder(content), league = content.areas.find(a => a.kind === 'league');
  for (let b = 0; b <= gyms.length; b++) {
    const reached = worldReach(content, world, b);
    if (b < gyms.length && !reached.has(gyms[b].id)) problems.push({ code: 'gym_unreachable', message: `gym ${b + 1} '${gyms[b].id}' can't be reached with ${b} badges` });
    if (b + 1 < gyms.length && reached.has(gyms[b + 1].id)) problems.push({ code: 'gym_open_early', message: `gym ${b + 2} is reachable with only ${b} badges` });
    if (league && b < gyms.length && reached.has(league.id)) problems.push({ code: 'league_open_early', message: `the league is reachable with ${b} badges` });
    if (league && b === gyms.length && !reached.has(league.id)) problems.push({ code: 'league_unreachable', message: 'the league can\'t be reached with every badge' });
  }
  return problems;
}

// ---------------------------------------------------------------- battle sim

/** Run one battle to the end with the greedy policy for the player. Returns the outcome. */
export function simBattle(content, { kind, player, foe, trainer, rng, heals = 0 }) {
  const b = startBattle(content, { kind, player, foe, foeTrainer: trainer || null, rng });
  const potion = (content.items || []).filter(i => i.kind === 'heal').sort((x, y) => x.price - y.price)[0];
  for (let turn = 0; turn < 120; turn++) {
    const need = needsInput(b);
    if (!need) { if (battleResult(b)) break; }
    if (need?.kind === 'learn') { chooseAction(b, { kind: 'learn', forget: null }); continue; }
    if (need?.kind === 'switch') { const i = bestMatchup(content, b.player.party, b.foe.party[b.foe.active]); chooseAction(b, { kind: 'switch', index: i < 0 ? b.player.party.findIndex(c => c.hp > 0) : i }); continue; }
    if (b.over) break;
    const me = b.player.party[b.player.active];
    if (heals > 0 && potion && me.hp < statsOf(content, me).hp * 0.35) { heals--; chooseAction(b, { kind: 'item', item: potion.id, target: b.player.active }); }
    else chooseAction(b, { kind: 'move', index: bestMove(content, b.player, b.foe) });
    resolveTurn(content, b, rng);
  }
  return battleResult(b)?.outcome || 'timeout';
}

/** The party a sensible player brings to gym g: their starter line plus the two best catches so far. */
export function curveParty(content, starter, g, rng) {
  const stages = areaStages(content), L = levelCurve(g, content);
  const leader = gymOrder(content)[g - 1]?.leader;
  const pool = [...new Set(content.areas.filter(a => (a.kind === 'route' || a.kind === 'cave') && stages.get(a.id) < g).flatMap(a => (a.encounters || []).map(e => e.species)))];
  const vsLeader = id => { const sp = lookup(content).species.get(id); return leader ? Math.max(...sp.learnset.map(l => moveOf(content, l.move)).filter(m => m.power).map(m => m.power * effectiveness(content, m.type, [leader.type]) * (sp.types.includes(m.type) ? 1.5 : 1)), 0) - 30 * Math.max(...sp.types.map(t => effectiveness(content, leader.type, [t]))) : 0; };
  const picks = pool.sort((a, b) => vsLeader(b) - vsLeader(a) || a.localeCompare(b)).slice(0, 2);
  const party = [createCreature(content, evolvedAt(content, starter, L - 1), L - 1, rng)];
  for (const id of picks) party.push(createCreature(content, evolvedAt(content, id, L - 3), L - 3, rng));
  return party;
}

function balanceSim(content, seed, runsPerGym) {
  const gyms = gymOrder(content), report = { leaders: [], wild: null, runsPerGym };
  const problems = [];
  const rng = { rng: (seed >>> 0) || 1 };
  const off = difficultyOffset(content);
  gyms.forEach((gym, i) => {
    const g = i + 1, L = gym.leader;
    const per = {};
    for (const starter of content.starters) {
      let wins = 0;
      const n = Math.max(1, Math.round(runsPerGym / content.starters.length));
      for (let r = 0; r < n; r++) {
        const party = curveParty(content, starter, g, rng);
        const foe = L.party.map(m => createCreature(content, m.species, m.level, rng));
        // Lead with the best matchup against the leader's first creature, as a sensible player would.
        const lead = bestMatchup(content, party, foe[0]);
        if (lead > 0) party.unshift(...party.splice(lead, 1));
        // Healing items on hand: the mentor's two plus what the mart money buys by then.
        if (simBattle(content, { kind: 'leader', player: party, foe, trainer: { id: L.id, name: L.name, prize: 0 }, rng, heals: 2 + 2 * g }) === 'win') wins++;
      }
      per[starter] = Math.round(wins / n * 100) / 100;
    }
    const worst = Math.min(...Object.values(per));
    report.leaders.push({ gym: gym.id, leader: L.name, level: levelCurve(g, content) + off, winRate: per, worst });
    if (worst < 0.7) problems.push({ code: 'leader_too_hard', message: `${L.name} (gym ${g}) beats a curve-level party too often: worst starter wins ${Math.round(worst * 100)}%` });
  });
  // Level-matched wild battles on every route: a party at the route's top level against each species.
  let wins = 0, total = 0;
  const stages = areaStages(content);
  for (const a of content.areas) {
    if (!a.encounters?.length) continue;
    for (const e of a.encounters) for (const starter of content.starters) {
      const lv = Math.max(5, e.maxLevel);
      const party = curveParty(content, starter, (stages.get(a.id) || 0) + 1, rng).map(c => createCreature(content, evolvedAt(content, c.species, lv), lv, rng));
      const foe = createCreature(content, e.species, e.maxLevel, rng);
      const lead = bestMatchup(content, party, foe);
      if (lead > 0) party.unshift(...party.splice(lead, 1));
      if (simBattle(content, { kind: 'wild', player: party, foe: [foe], rng }) === 'win') wins++;
      total++;
    }
  }
  report.wild = { winRate: total ? Math.round(wins / total * 100) / 100 : 1, battles: total };
  if (total && wins / total < 0.95) problems.push({ code: 'wild_too_hard', message: `level-matched wild battles are won only ${Math.round(wins / total * 100)}% of the time` });
  return { problems, report };
}

// ---------------------------------------------------------------- playthrough

/**
 * The bot walks the critical path: each gym's town, its trainers and leader, then the league and the
 * champion, grinding in grass when under-leveled, healing at centers and catching one creature per
 * route. Stops at the frame or time budget.
 */
export function playthrough(content, { seed = 1, deadline = Infinity, maxFrames = 600000, starter = 0 } = {}) {
  const t0 = now();
  const game = createGame(content, { seed });
  const s = game.createState();
  const bot = createBot(game, s, { catchSpecies: 'any', starter, maxFrames });
  const out = { cleared: false, badges: 0, frames: 0, battles: 0, losses: 0, steps: [], stuck: false };
  const timeUp = () => now() > deadline || bot.frames > maxFrames;
  const stages = areaStages(content);
  const healAt = areaId => { const center = Object.values(game.maps).find(m => m.area === areaId && m.room === 'center'); if (!center) return; bot.goTo(center.id); bot.talkTo(`${center.id}:nurse`); bot.settle(); };
  const lead = () => Math.max(...s.party.map(c => c.level));
  const tired = () => s.party.reduce((a, c) => a + c.hp, 0) < 0.5 * s.party.reduce((a, c) => a + statsOf(content, c).hp, 0);
  // Level the team, not just one carry: the weakest of the three strongest leads each grind battle.
  const team = () => s.party.map((c, i) => ({ c, i })).sort((a, b) => b.c.level - a.c.level).slice(0, 3);
  const grindTo = (level, mapId) => {
    let guard = 0;
    while (team().some(({ c }) => c.level < level - 2) || lead() < level) {
      if (guard++ > 120 || timeUp()) return;
      if (tired()) healAt(lastTown);
      if (!bot.goTo(mapId)) return;
      const weakest = team().filter(({ c }) => c.hp > 0).sort((a, b) => a.c.level - b.c.level)[0];
      if (weakest && weakest.i > 0 && weakest.c.level < level) bot.swapToFront(weakest.i);
      bot.grind(150);
    }
  };
  let lastTown = content.areas[0].id;
  bot.settle();
  const gyms = gymOrder(content);
  try {
    for (let i = 0; i <= gyms.length && !timeUp(); i++) {
      const target = i < gyms.length ? gyms[i] : content.areas.find(a => a.kind === 'league');
      // Walk the areas between here and the target in order, catching on each new route.
      const route = content.areas.filter(a => stages.get(a.id) === i && (a.kind === 'route' || a.kind === 'cave' || a.kind === 'town'));
      for (const a of route) {
        if (timeUp()) break;
        if (!bot.goTo(a.id)) { if (timeUp()) break; out.stuck = true; out.steps.push(`stuck before ${a.id}: ${bot.fail}`); break; }
        if (a.kind === 'town') { lastTown = a.id; healAt(a.id); }
        else if (!s.box.length && s.party.length < 3) { bot.catchSpecies = 'any'; bot.grind(200); }
      }
      if (out.stuck || timeUp()) break;
      const L = levelCurve(i + 1, content) + difficultyOffset(content);
      const grindMap = [...route].reverse().find(a => a.kind === 'route' || a.kind === 'cave');
      if (grindMap) grindTo(i < gyms.length ? L - 1 : L + 6, grindMap.id);
      if (lastTown) healAt(lastTown);
      const map = game.maps[target.id];
      if (!bot.goTo(target.id)) { if (timeUp()) break; out.stuck = true; out.steps.push(`stuck before ${target.id}: ${bot.fail}`); break; }
      if (map.puzzle) bot.goTo(target.id, map.puzzle.switch);
      const boss = map.entities.find(e => e.kind === 'leader' || e.kind === 'champion');
      for (let tries = 0; tries < 10 && !timeUp(); tries++) {
        const before = s.badges.length;
        bot.goTo(target.id);
        bot.talkTo(boss.id); bot.settle();
        if (s.status === 'won' || s.badges.length > before) break;
        out.losses++;
        if (grindMap) grindTo(lead() + 2, grindMap.id);
        healAt(lastTown);
      }
      out.badges = s.badges.length;
      out.steps.push(`${target.id}: ${s.status === 'won' ? 'champion beaten' : `${s.badges.length} badges`} @${bot.frames}`);
      if (s.status === 'won') break;
    }
    // Finish the ending.
    for (let i = 0; i < 1200 && s.mode === 'ending' && s.status === 'playing'; i++) bot.tap('a');
  } catch (error) { out.error = String(error?.stack || error).slice(0, 400); }
  out.cleared = s.status === 'won';
  out.final = { mode: s.mode, map: s.player.map, x: s.player.x, y: s.player.y, status: s.status, last: bot.battles.slice(-2) };
  out.frames = bot.frames; out.battles = bot.battles.length; out.losses += bot.battles.filter(b => b.outcome === 'lose').length;
  out.caught = Object.keys(s.caught).length; out.party = s.party.map(c => `${c.name} L${c.level}`);
  out.ms = Math.round(now() - t0);
  out.timedOut = !out.cleared && timeUp();
  return out;
}

// ---------------------------------------------------------------- entry

export function verify(input, { seed = 1, budgetMs = 2000, runsPerGym = 200, playthrough: wantPlay = true } = {}) {
  const t0 = now(), problems = [];
  const v = validate(input);
  if (!v.ok) return { ok: false, problems: v.errors.map(e => ({ code: e.code, message: `${e.path}: ${e.message}` })), report: { version: VERIFY_VERSION, proven: [], ms: Math.round(now() - t0) } };
  const content = v.content;
  const report = { version: VERIFY_VERSION, proven: ['content validates'], settings: settingsOf(content), timings: {} };
  let t = now();
  const world = generateMaps(content, seed);
  const mapProblems = Object.values(world.maps).flatMap(m => checkMap(m).map(p => ({ code: p.code, message: `${p.map}: ${p.code}${p.id ? ` (${p.id})` : ''}` })));
  problems.push(...mapProblems, ...gateProblems(content, world));
  report.maps = { count: Object.keys(world.maps).length, problems: mapProblems.length };
  report.timings.maps = Math.round(now() - t);
  if (!problems.length) report.proven.push('every exit, trainer and item is reachable', 'gyms open in badge order and the league opens last');
  t = now();
  const sim = balanceSim(content, seed, runsPerGym);
  problems.push(...sim.problems);
  report.balance = sim.report;
  report.timings.balance = Math.round(now() - t);
  if (!sim.problems.length) report.proven.push(`a curve-level greedy party beats every leader (${runsPerGym} runs per gym, every starter)`, 'level-matched wild battles are won');
  // The playthrough proves the whole path, once per starter while the budget allows.
  const runs = [];
  for (let starter = 0; wantPlay && starter < content.starters.length; starter++) {
    const left = budgetMs - (now() - t0);
    if (left < 150) break;
    const play = playthrough(content, { seed, starter, deadline: now() + left - 20 });
    runs.push({ starter: content.starters[starter], ...play });
    if (play.error) problems.push({ code: 'playthrough_error', message: play.error });
    else if (play.stuck) problems.push({ code: 'playthrough_stuck', message: `${content.starters[starter]}: ${play.steps.join('; ')}` });
  }
  report.playthrough = runs.length ? runs : { skipped: true, reason: 'budget' };
  const cleared = runs.filter(r => r.cleared);
  if (cleared.length) report.proven.push(`the bot played the critical path to the ending with ${cleared.map(r => r.starter).join(', ')} (${cleared.map(r => r.frames).join(', ')} frames)`);
  report.ms = Math.round(now() - t0);
  report.bot = runs.length ? { cleared: cleared.length === runs.length, runs: runs.length, time: Math.round(runs.reduce((a, r) => a + r.frames, 0) / 60), deaths: runs.reduce((a, r) => a + r.losses, 0) } : null;
  return { ok: !problems.length, problems, report };
}
