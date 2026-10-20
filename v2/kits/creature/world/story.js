// Story rules (CONTRACT.md §4): predicates over game state and effects that become script ops.
// Default beats are added when the content doesn't define them: rival battles on the first route,
// after the first badge and before the league. The mentor's starter choice, badge gates and the
// champion's ending are built into the game itself.
import { areaStages, gymOrder, levelCurve, STARTER_LEVEL } from '../content.js';
import { lookup } from '../rules/stats.js';
import { seedFrom, random } from '../../../kernel/rng.js';

/** Evaluate a predicate against the game state. */
export function test(p, state, game) {
  if (!p) return true;
  const [k] = Object.keys(p), v = p[k];
  switch (k) {
    case 'flag': return !!state.flags[v];
    case 'badges': return state.badges.length >= (v?.gte ?? 0);
    case 'area': return game.maps[state.player.map]?.area === v;
    case 'defeated': return v === 'rival' ? state.rivalBattles > 0 : !!state.defeated[v];
    case 'owns': return [...state.party, ...state.box].some(c => c.species === v);
    case 'caught': return Object.keys(state.caught).length >= (v?.gte ?? 0);
    case 'all': return v.every(q => test(q, state, game));
    case 'any': return v.some(q => test(q, state, game));
    case 'not': return !test(v, state, game);
    default: return false;
  }
}

/** Display name for a speaker id. */
export function speakerName(content, who) {
  if (who === 'player') return content.player?.name || 'You';
  if (who === 'rival') return content.rival?.name || 'Rival';
  if (who === 'mentor') return content.mentor?.name || 'Professor';
  if (who === 'champion') return content.champion?.name || 'Champion';
  const t = lookup(content).trainers.get(who);
  if (t) return t.class ? `${t.class} ${t.name}` : t.name;
  for (const a of content.areas) for (const n of a.npcs || []) if (n.id === who) return n.name;
  return who;
}

/** Text with {player}, {rival} and {mentor} filled in. */
export const fill = (content, text) => String(text || '').replace(/\{(player|rival|mentor)\}/g, (_, k) => content[k]?.name || k);

/** Effects → script ops. Rival speech and battles bring the rival on screen for the rule. */
export function opsFor(content, rule) {
  const ops = [];
  const rival = rule.then.some(e => (e.do === 'say' && e.who === 'rival') || (e.do === 'battle' && e.trainer === 'rival'));
  if (rival) ops.push({ op: 'rival', show: true });
  for (const e of rule.then) {
    switch (e.do) {
      case 'say': ops.push({ op: 'say', who: e.who, name: speakerName(content, e.who), text: fill(content, e.text) }); break;
      case 'give_item': ops.push({ op: 'give_item', item: e.item, count: e.count || 1 }); break;
      case 'give_creature': ops.push({ op: 'give_creature', species: e.species, level: e.level || STARTER_LEVEL }); break;
      case 'set_flag': ops.push({ op: 'flag', flag: e.flag }); break;
      case 'battle': ops.push(e.trainer ? { op: 'battle', trainer: e.trainer } : { op: 'battle', party: e.party, name: 'Challenger' }); break;
      case 'heal': ops.push({ op: 'heal' }); break;
      case 'warp': ops.push({ op: 'warp', area: e.area }); break;
      case 'end_game': ops.push({ op: 'end_game' }); break;
      default: break;
    }
  }
  if (rival) ops.push({ op: 'rival', show: false });
  ops.push({ op: 'fired', rule: rule.id });
  return ops;
}

/** Content rules plus the default rival beats when the content has none. */
export function storyRules(content) {
  const rules = (content.story || []).map((r, i) => ({ ...r, id: r.id || `rule-${i}` }));
  const hasRival = rules.some(r => r.then.some(e => e.do === 'battle' && e.trainer === 'rival'));
  if (hasRival) return rules;
  const stages = areaStages(content), gyms = gymOrder(content);
  const wild = content.areas.filter(a => (a.kind === 'route' || a.kind === 'cave') && stages.has(a.id));
  const first = wild.find(a => stages.get(a.id) === 0);
  const second = wild.find(a => stages.get(a.id) === 1);
  const league = content.areas.find(a => a.kind === 'league');
  const last = [...wild].reverse().find(a => a.connects.some(c => c.to === league?.id)) || wild[wild.length - 1];
  const rival = content.rival?.name || 'Rival';
  const beat = (id, area, gte, text) => area && ({ id, when: { all: [{ area: area.id }, { badges: { gte } }, { not: { flag: id } }] }, then: [{ do: 'say', who: 'rival', text }, { do: 'battle', trainer: 'rival' }, { do: 'set_flag', flag: id }] });
  return [...rules, ...[
    beat('rival-1', first, 0, `Hey, {player}! I'm ${rival}. Let's see whose partner is stronger!`),
    beat('rival-2', second !== first ? second : null, 1, 'You got a badge? So did I. Round two!'),
    beat('rival-3', last !== first && last !== second ? last : null, gyms.length, 'Before you face the champion, you face me!'),
  ].filter(Boolean)];
}

/** The starter whose type beats the given one (the rival's pick). */
export function counterStarter(content, starter) {
  const t = id => lookup(content).species.get(id).types[0];
  const beats = (a, b) => (content.chart?.[t(a)]?.[t(b)] ?? 1) > 1;
  return content.starters.find(s => s !== starter && beats(s, starter)) || content.starters.find(s => s !== starter);
}

/** Follow a line's evolutions up to a level. */
export function evolvedAt(content, speciesId, level) {
  const { species } = lookup(content);
  let cur = speciesId;
  for (let i = 0; i < 4; i++) { const s = species.get(cur); if (s?.evolves && level >= s.evolves.level && species.get(s.evolves.to)) cur = s.evolves.to; else break; }
  return cur;
}

/** The rival's party for their nth battle: their starter line plus fillers on the level curve. */
export function rivalParty(content, rivalStarter, badges, n) {
  const stages = areaStages(content);
  const ace = badges === 0 ? STARTER_LEVEL : levelCurve(badges + 1) - 3;
  const party = [{ species: evolvedAt(content, rivalStarter, ace), level: ace }];
  const pool = [...new Set(content.areas.filter(a => stages.has(a.id) && stages.get(a.id) <= badges).flatMap(a => (a.encounters || []).map(e => e.species)))];
  const s = { rng: seedFrom(`${content.id}:rival:${n}`) };
  const extra = Math.min(badges, 3, pool.length);
  for (let i = 0; i < extra; i++) {
    const idx = Math.floor(random(s) * pool.length);
    const sp = pool.splice(idx, 1)[0];
    const lv = Math.max(2, ace - 2 - Math.floor(random(s) * 2));
    party.unshift({ species: evolvedAt(content, sp, lv), level: lv });
  }
  return party;
}
