// Simulation-tuned difficulty: the last step of the balance pass, so a fair-but-unlucky draw from
// the model never comes back to it as a problem. A curve-level greedy party (verify's model of a
// sensible player) fights seeded battles against each leader. While the worst starter wins less
// than the target, repairs go from least to most invasive:
//   1. add an earlier wild creature that counters the gym's type (a catch that fills the type gap);
//   2. lower the leader's levels, staying inside the level curve's ±3 band;
//   3. take away the leader's healing item;
//   4. drop the leader's strongest backup creature (down to two);
//   5. field pre-evolved forms;
//   6. soften the leader's AI.
// Wild encounters get the same treatment (lower the route's top level) for level-matched battles.
import { gymOrder, levelCurve, difficultyOffset, areaStages } from '../content.js';
import { createCreature, bestMatchup, effectiveness, lookup } from '../rules/index.js';
import { simBattle, curveParty } from '../verify/index.js';
import { evolvedAt } from '../world/story.js';

export const TUNE_TARGET = 0.88;

export function leaderWinRate(content, gymIndex, runs = 30, seed = 7) {
  const gym = gymOrder(content)[gymIndex], L = gym.leader, g = gymIndex + 1;
  const rng = { rng: seed };
  let worst = 1;
  for (const starter of content.starters) {
    let wins = 0;
    for (let r = 0; r < runs; r++) {
      const party = curveParty(content, starter, g, rng);
      const foe = L.party.map(m => createCreature(content, m.species, m.level, rng));
      const lead = bestMatchup(content, party, foe[0]);
      if (lead > 0) party.unshift(...party.splice(lead, 1));
      if (simBattle(content, { kind: 'leader', player: party, foe, trainer: { id: L.id, name: L.name, prize: 0, noHeal: L.noHeal, ai: L.ai }, rng, heals: 2 + 2 * g }) === 'win') wins++;
      // Early exit once the target is clearly out of reach or met for this starter.
      if (wins + (runs - r - 1) < runs * TUNE_TARGET * 0.5) break;
    }
    worst = Math.min(worst, wins / runs);
  }
  return worst;
}

const rootOf = (content, id) => { let cur = id; for (let i = 0; i < 4; i++) { const p = content.species.find(s => s.evolves?.to === cur); if (!p) break; cur = p.id; } return cur; };

/** Add a base-form counter to the gym type on the last wild area before the gym. Returns true if added. */
function addCounter(content, gymIndex) {
  const gym = gymOrder(content)[gymIndex], type = gym.leader.type;
  const stages = areaStages(content);
  const before = content.areas.filter(a => a.encounters?.length && stages.get(a.id) <= gymIndex);
  const target = [...before].reverse().find(a => stages.get(a.id) === gymIndex) || before[before.length - 1];
  if (!target) return false;
  const pool = new Set(before.flatMap(a => a.encounters.map(e => e.species)));
  const counters = content.species.filter(s => !content.starters.includes(rootOf(content, s.id)) && rootOf(content, s.id) === s.id && s.types.some(t => effectiveness(content, t, [type]) > 1) && !pool.has(s.id));
  if (!counters.length) return false;
  const pick = counters.sort((a, b) => effectiveness(content, type, a.types) - effectiveness(content, type, b.types) || a.id.localeCompare(b.id))[0];
  const e = target.encounters[0];
  target.encounters.push({ species: evolvedAt(content, pick.id, e.maxLevel), minLevel: e.minLevel, maxLevel: e.maxLevel, weight: 25 });
  return pick.id;
}

/** Tune leaders in place; returns the fixes made. */
export function tuneLeaders(content, { target = TUNE_TARGET, runs = 60 } = {}) {
  const fixes = [];
  gymOrder(content).forEach((gym, i) => {
    const L = gym.leader, curve = levelCurve(i + 1, content) + difficultyOffset(content);
    const path = `areas.${gym.id}.leader`;
    for (let step = 0; step < 16; step++) {
      const rate = leaderWinRate(content, i, runs);
      if (rate >= target) break;
      const pct = `sim win rate ${Math.round(rate * 100)}%`;
      const ace = Math.max(...L.party.map(m => m.level));
      let added;
      if (!L.counterAdded && (added = addCounter(content, i))) { L.counterAdded = true; fixes.push({ code: 'counter_added', path, note: `${added} now appears before the gym (${pct})` }); }
      else if (ace > curve - 3) {
        for (const m of L.party) { m.level = Math.max(2, m.level - 1); m.species = evolvedAt(content, rootOf(content, m.species), m.level); }
        fixes.push({ code: 'leader_level', path, note: `ace ${ace} → ${ace - 1} (${pct})` });
      } else if (!L.noHeal) { L.noHeal = true; fixes.push({ code: 'leader_no_heal', path, note: pct }); }
      else if (L.party.length > 2) {
        const drop = L.party.slice(0, -1).reduce((best, m, j, all) => (m.level >= all[best].level ? j : best), 0);
        fixes.push({ code: 'leader_party', path, note: `dropped ${L.party[drop].species} (${pct})` });
        L.party.splice(drop, 1);
      } else if (L.party.some(m => rootOf(content, m.species) !== m.species)) {
        for (const m of L.party) m.species = rootOf(content, m.species);
        fixes.push({ code: 'leader_unevolved', path, note: pct });
      } else if (L.ai !== 'easy') { L.ai = 'easy'; fixes.push({ code: 'leader_ai', path, note: pct }); }
      else break;
    }
    delete L.counterAdded;
  });
  return fixes;
}

/** Level-matched wild battles: lower a route's top level until a curve party wins them. */
export function tuneWild(content, { runs = 3 } = {}) {
  const fixes = [], stages = areaStages(content), rng = { rng: 11 };
  for (const a of content.areas) {
    if (!a.encounters?.length) continue;
    for (let step = 0; step < 4; step++) {
      let wins = 0, total = 0;
      for (const e of a.encounters) for (const starter of content.starters) for (let r = 0; r < runs; r++) {
        const lv = Math.max(5, e.maxLevel);
        const party = curveParty(content, starter, (stages.get(a.id) || 0) + 1, rng).map(c => createCreature(content, evolvedAt(content, c.species, lv), lv, rng));
        const foe = createCreature(content, e.species, e.maxLevel, rng);
        const lead = bestMatchup(content, party, foe);
        if (lead > 0) party.unshift(...party.splice(lead, 1));
        if (simBattle(content, { kind: 'wild', player: party, foe: [foe], rng }) === 'win') wins++;
        total++;
      }
      if (wins / total >= 0.97) break;
      for (const e of a.encounters) { e.maxLevel = Math.max(e.minLevel, e.maxLevel - 1); e.minLevel = Math.max(2, Math.min(e.minLevel, e.maxLevel)); }
      fixes.push({ code: 'wild_level', path: `areas.${a.id}.encounters`, note: `wild win rate ${Math.round(wins / total * 100)}%` });
    }
  }
  void lookup;
  return fixes;
}
