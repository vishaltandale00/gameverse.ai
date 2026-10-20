// Simulation-tuned difficulty for generated content (the last step of the balance pass): for each
// gym leader, a curve-level greedy party (verify's model of a sensible player) fights a few seeded
// battles per starter; while the worst starter wins less than the target, the leader's levels come
// down (staying within the curve's ±3 band) and then their weakest-for-the-player creature leaves.
import { gymOrder, levelCurve, difficultyOffset } from '../content.js';
import { createCreature, bestMatchup } from '../rules/index.js';
import { simBattle, curveParty } from '../verify/index.js';
import { evolvedAt } from '../world/story.js';

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
      if (simBattle(content, { kind: 'leader', player: party, foe, trainer: { id: L.id, name: L.name, prize: 0 }, rng, heals: 2 + 2 * g }) === 'win') wins++;
    }
    worst = Math.min(worst, wins / runs);
  }
  return worst;
}

/** Tune leaders in place; returns the fixes made. */
export function tuneLeaders(content, { target = 0.8, runs = 30 } = {}) {
  const fixes = [];
  gymOrder(content).forEach((gym, i) => {
    const L = gym.leader, curve = levelCurve(i + 1, content) + difficultyOffset(content);
    for (let step = 0; step < 6; step++) {
      const rate = leaderWinRate(content, i, runs);
      if (rate >= target) break;
      const ace = Math.max(...L.party.map(m => m.level));
      if (ace > curve - 3) {
        for (const m of L.party) { m.level = Math.max(2, m.level - 1); m.species = evolvedAt(content, rootOf(content, m.species), m.level); }
        fixes.push({ code: 'leader_level', path: `areas.${gym.id}.leader.party`, note: `ace ${ace} → ${ace - 1} (sim win rate ${Math.round(rate * 100)}%)` });
      } else if (L.party.length > 2) {
        const drop = L.party.slice(0, -1).reduce((best, m, j, all) => (m.level >= all[best].level ? j : best), 0);
        fixes.push({ code: 'leader_party', path: `areas.${gym.id}.leader.party`, note: `dropped ${L.party[drop].species} (sim win rate ${Math.round(rate * 100)}%)` });
        L.party.splice(drop, 1);
      } else break;
    }
  });
  return fixes;
}

function rootOf(content, id) {
  let cur = id;
  for (let i = 0; i < 4; i++) { const p = content.species.find(s => s.evolves?.to === cur); if (!p) break; cur = p.id; }
  return cur;
}
