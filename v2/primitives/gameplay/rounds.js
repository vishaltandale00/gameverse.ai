// gameplay.rounds: match structure for any versus game (fighting, arena
// shooters, sports duels, boss rushes): intro, a round timer, KO detection
// (health from combat.health, or any predicate such as falling out of a blast
// zone), double KOs, time-over decisions by remaining health, perfect rounds,
// best-of-N with draws extending the match, and stock mode (lives per match
// with respawns). Phase timings and scoring follow the fighting kit
// (sim.js phaseClock / timeOver / scoreRound / endRound).
import { ENTITY_KINDS } from '../../kernel/params.js';
import { alive, hpOf, matchesAny, sortedEntities, err, runBound, bindRoles } from './modes-lib-util.js';

const ID = 'gameplay.rounds';
const PHASES = ['waiting', 'intro', 'fight', 'ko', 'round_end', 'match_end'];

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['ko', 'round_end', 'match_end'],
      // As an encounter: the first fighter (the player's) wins or loses the match; a draw leaves both.
      outcome: { sides: ['player', 'opponent'], results: { won: { param: 'onWin', player: 'keeps', opponent: 'defeated' }, lost: { param: 'onLose', player: 'defeated', opponent: 'keeps' }, draw: { param: 'onDraw', player: 'keeps', opponent: 'keeps' } } } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "fighters", "min": 2, "why": "a match needs the player and an opponent (entity ids or archetypes)", "example": ["player", "rival"]},
    ],
    // Versus mode: rounds against AI fighters, won on the match result.
    mode: { loop: 'versus', interaction: 'avatar-realtime', opponent: 'ai-rival', space: ['engine.space.arena2d', ['position', 'distance', 'overlap']], needs: { content: ['content.archetypes'], participants: 'fighters' }, win: { param: 'onWin', end: 'endGame', reads: { component: 'health', of: 'opponents', by: { effects: ['damage'] } } }, lose: { param: 'onLose', end: 'endGame', reads: { component: 'health', of: 'player', by: { effects: ['damage'] } } }, bot: 'versus' },
    intent: 'Versus match rules: round intro, round timer, KO (health or a predicate), double KO, time over decided by health, perfect rounds, best-of-N rounds with draws, or stock mode with respawns; match result effects and scoring. Fighting, arena and duel games of any space use it.',
    views: ['any'],
    params: {
      fighters: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: ['player'], effect: 'entity ids, archetypes or tags; the first match is side 1 (the player)' },
      bestOf: { type: 'integer', default: 3, min: 1, max: 99, effect: 'rounds: first to ceil(bestOf/2) wins' },
      maxRounds: { type: 'integer', default: 0, min: 0, max: 199, effect: 'hard cap including draw rounds (0 = bestOf + 2)' },
      roundSec: { type: 'number', default: 99, min: 0, max: 3600, unit: 's', effect: 'round timer (0 = untimed)' },
      stocks: { type: 'integer', default: 0, min: 0, max: 99, effect: 'stock mode: lives per match (0 = round mode)' },
      timeOver: { type: 'string', options: ['health', 'stocks', 'draw'], default: 'health', effect: 'who wins when time runs out' },
      perfect: { type: 'boolean', default: true, effect: 'announce and score perfect rounds' },
      koWhen: { type: 'predicate', effect: 'extra KO condition evaluated per fighter (self = fighter), e.g. out of the blast zone' },
      introSec: { type: 'number', default: 1.67, min: 0, max: 30, unit: 's' },
      fightCallSec: { type: 'number', default: 1.17, min: 0, max: 30, unit: 's', effect: 'when the FIGHT call (event fight) happens in the intro' },
      koSec: { type: 'number', default: 1.83, min: 0, max: 30, unit: 's', effect: 'KO slow-down before the round ends' },
      roundEndSec: { type: 'number', default: 2.83, min: 0, max: 30, unit: 's' },
      respawnSec: { type: 'number', default: 2, min: 0, max: 30, unit: 's', effect: 'stock mode respawn delay' },
      spawns: { type: 'list', of: { type: 'json', scale: 'world' }, default: [], effect: 'positions for fighters at round start (by fighter order), in the space\'s coordinates' },
      onRoundStart: { type: 'effects', default: [], effect: 'run per fighter at each round start (actor = fighter), e.g. heal/revive' },
      onRespawn: { type: 'effects', default: [], effect: 'stock mode: run for a fighter that respawns (actor = fighter)' },
      scoring: { type: 'object', default: { var: 'score', win: 1000, perSecond: 50, health: 1000, perfect: 5000 }, fields: { var: { type: 'string', default: 'score' }, win: { type: 'number', default: 1000 }, perSecond: { type: 'number', default: 50 }, health: { type: 'number', default: 1000 }, perfect: { type: 'number', default: 5000 } }, effect: 'points to the first fighter for won rounds' },
      onWin: { type: 'effects', default: [] }, onLose: { type: 'effects', default: [] }, onDraw: { type: 'effects', default: [] },
      endGame: { type: 'boolean', default: false, effect: 'end the game with the match result' },
      autoStart: { type: 'boolean', default: true, effect: 'start a match when two fighters exist (otherwise start_match)' },
    },
    provides: {
      events: ['match_start', 'round_start', 'fight', 'ko', 'double_ko', 'perfect', 'time_over', 'round_end', 'match_end', 'stock_lost', 'respawn'],
      vars: ['round', 'round.timer', 'round.live', 'round.wins.*', 'round.stocks.*'],
    },
    requires: {},
    reads: [],
    // As an encounter's inner loop: the match waits (autoStart off) and the encounter starts it.
    engage: { encounter: { start: [{ do: 'start_match' }], config: { autoStart: false } } },
  },
  logic(logic) {
    logic.predicate('round', {
      check: (p, path, errors) => { if (typeof p.round === 'string' && !PHASES.includes(p.round) && !['won', 'lost', 'draw'].includes(p.round)) errors.push(err('round_phase', path, `round must be a phase (${PHASES.join('|')}) or won|lost|draw`)); },
      test: (p, rt) => {
        const s = rt.state.prim[ID]; if (!s) return false;
        if (p.round === true) return s.phase !== 'waiting';
        if (['won', 'lost', 'draw'].includes(p.round)) return s.phase === 'match_end' && s.result === p.round;
        return s.phase === p.round;
      },
    });
    logic.effect('start_match', { run: (e, rt) => { rt.store(ID).request = 'start'; } });
    logic.effect('end_round', { run: (e, rt) => { rt.store(ID).request = { end: e.winner ?? null }; } });
  },
  validate(config) {
    const errors = [];
    if (config.stocks === 0 && config.timeOver === 'stocks') errors.push(err('rounds_time_over', 'with.timeOver', "timeOver 'stocks' needs stocks > 0"));
    if (config.maxRounds && config.maxRounds < Math.ceil(config.bestOf / 2)) errors.push(err('rounds_max', 'with.maxRounds', 'maxRounds is below the rounds needed to win'));
    if (config.fightCallSec > config.introSec) errors.push(err('rounds_timing', 'with.fightCallSec', 'the FIGHT call must come within the intro'));
    return errors;
  },
  /** Solver progress: rounds (or opponent stocks) won by the first fighter. */
  progress(rt, config) { const s = rt.state.prim[ID]; if (!s?.fighters) return 0; const [a, b] = s.fighters; return config.stocks ? config.stocks - (s.stocks?.[b] ?? config.stocks) : s.wins?.[a] ?? 0; },
  install(rt, config) {
    const F = sec => Math.round(sec * 60), toWin = Math.ceil(config.bestOf / 2), maxRounds = config.maxRounds || config.bestOf + 2;
    const st = () => { const s = rt.store(ID); s.phase ??= 'waiting'; s.pt ??= 0; return s; };
    const find = () => { const out = []; for (const sel of config.fighters) { const e = rt.entity(sel) ?? sortedEntities(rt).find(x => matchesAny(x, [sel]) && !out.includes(x.id)); if (e && !out.includes(e.id)) out.push(e.id); } return out; };
    const set = (s, phase) => { s.phase = phase; s.pt = 0; rt.state.vars['round.live'] = phase === 'fight' ? 1 : 0; rt.state.flags.round_live = phase === 'fight'; };
    const vars = s => {
      const v = rt.state.vars; v.round = s.round ?? 0; v['round.timer'] = s.timer === null ? 0 : Math.max(0, Math.ceil((s.timer ?? 0) / 60));
      for (const id of s.wins ? s.fighters || [] : []) { v[`round.wins.${id}`] = s.wins[id] ?? 0; if (config.stocks) v[`round.stocks.${id}`] = s.stocks?.[id] ?? 0; }
    };
    function startMatch(s) {
      // A match needs two fighters; with fewer, nothing is recorded (a half-started match left wins/stocks undefined for vars()).
      const found = find(); if (found.length < 2) return false;
      s.fighters = found;
      s.wins = Object.fromEntries(s.fighters.map(id => [id, 0])); s.stocks = Object.fromEntries(s.fighters.map(id => [id, config.stocks]));
      s.round = 0; s.rounds = []; s.result = null; s.winner = null; s.respawn = {};
      rt.emit('match_start', { fighters: s.fighters.slice(), bestOf: config.bestOf, stocks: config.stocks });
      startRound(s); return true;
    }
    function startRound(s) {
      s.round++; s.timer = config.roundSec > 0 ? F(config.roundSec) : null; s.koed = []; s.pendingWinner = undefined;
      set(s, 'intro');
      s.fighters.forEach((id, i) => {
        const e = rt.entity(id); if (!e) return;
        if (config.spawns[i] !== undefined && e.space) rt.space(e.space).setPos(e, structuredClone(config.spawns[i]), rt);
        runBound(rt, config.onRoundStart, { actor: id, owner: id, target: s.fighters[1 - i] ?? id });
      });
      rt.emit('round_start', { round: s.round, fighters: s.fighters.slice() });
    }
    const ko = (s, id) => { const e = rt.entity(id); return !e || !alive(e) || Boolean(config.koWhen && rt.test(bindRoles(config.koWhen, { actor: id }), { self: id })); };
    function scoreRound(s, w, how) {
      s.rounds.push({ winner: w, how, timer: s.timer === null ? null : Math.ceil(s.timer / 60) });
      if (w !== null) s.wins[w]++;
      if (w !== null && w === s.fighters[0]) {
        const f = hpOf(rt.entity(w)), sc = config.scoring;
        rt.state.vars[sc.var] = (rt.state.vars[sc.var] ?? 0) + sc.win + (s.timer === null ? 0 : Math.ceil(s.timer / 60) * sc.perSecond) + Math.round(f.frac * sc.health) + (how === 'perfect' ? sc.perfect : 0);
      }
      rt.emit('round_end', { round: s.round, winner: w, how, wins: { ...s.wins } });
    }
    function timeOver(s) {
      let w = null;
      if (config.timeOver === 'stocks' || (config.stocks && config.timeOver !== 'draw')) {
        const [a, b] = s.fighters, sa = s.stocks[a], sb = s.stocks[b];
        w = sa !== sb ? (sa > sb ? a : b) : null;
        if (w === null) { const fa = hpOf(rt.entity(a)).frac, fb = hpOf(rt.entity(b)).frac; w = fa === fb ? null : fa > fb ? a : b; }
      } else if (config.timeOver === 'health') {
        const ranked = s.fighters.map(id => ({ id, f: hpOf(rt.entity(id)).frac })).sort((x, y) => y.f - x.f);
        w = ranked.length > 1 && ranked[0].f === ranked[1].f ? null : ranked[0].id;
      }
      rt.emit('time_over', { round: s.round, winner: w });
      if (config.stocks) { endMatch(s, w); return; }
      set(s, 'round_end'); scoreRound(s, w, w === null ? 'draw' : 'time');
    }
    function endMatch(s, w) {
      s.winner = w; s.result = w === null ? 'draw' : w === s.fighters[0] ? 'won' : 'lost';
      set(s, 'match_end');
      rt.emit('match_end', { winner: w, result: s.result, wins: { ...s.wins }, rounds: s.rounds.length });
      runBound(rt, s.result === 'won' ? config.onWin : s.result === 'lost' ? config.onLose : config.onDraw, { actor: s.fighters[0], target: s.fighters[1] });
      if (config.endGame && rt.state.status === 'playing') rt.run([{ do: 'end_game', outcome: s.result === 'won' ? 'won' : s.result === 'lost' ? 'lost' : 'neutral' }]);
    }

    rt.system('rules', rt => {
      const s = st();
      if (s.request === 'start') { s.request = null; startMatch(s); }
      if (s.phase === 'waiting') { if (config.autoStart && !s.auto && startMatch(s)) s.auto = true; vars(s); return; }
      if (s.request?.end !== undefined && s.phase === 'fight') { const w = s.request.end; s.request = null; s.pendingWinner = w; set(s, 'ko'); }
      s.pt++;
      switch (s.phase) {
        case 'intro':
          if (s.pt === F(config.fightCallSec)) rt.emit('fight', { round: s.round });
          if (s.pt >= F(config.introSec)) { if (!F(config.fightCallSec) || F(config.fightCallSec) > F(config.introSec)) rt.emit('fight', { round: s.round }); set(s, 'fight'); }
          break;
        case 'fight': {
          // Stock respawns.
          for (const [id, t] of Object.entries(s.respawn)) if (--s.respawn[id] <= 0) { delete s.respawn[id]; runBound(rt, config.onRespawn, { actor: id, owner: id }); const i = s.fighters.indexOf(id); if (config.spawns[i] !== undefined) rt.space(rt.entity(id).space).setPos(rt.entity(id), structuredClone(config.spawns[i]), rt); rt.emit('respawn', { who: id, stocks: s.stocks[id] }); }
          const down = s.fighters.filter(id => s.respawn[id] === undefined && ko(s, id));
          if (down.length) {
            if (config.stocks) {
              for (const id of down) { s.stocks[id]--; rt.emit('stock_lost', { who: id, stocks: s.stocks[id] }); rt.emit('ko', { who: id, round: s.round }); if (s.stocks[id] > 0) s.respawn[id] = Math.max(1, F(config.respawnSec)); }
              const left = s.fighters.filter(id => s.stocks[id] > 0);
              if (left.length <= 1) { endMatch(s, left[0] ?? null); break; }
            } else {
              const standing = s.fighters.filter(id => !down.includes(id));
              for (const id of down) rt.emit('ko', { who: id, round: s.round });
              if (down.length > 1 && !standing.length) rt.emit('double_ko', { round: s.round });
              s.pendingWinner = standing.length === 1 ? standing[0] : null;
              set(s, 'ko'); break;
            }
          }
          if (s.timer !== null && --s.timer <= 0) timeOver(s);
          break;
        }
        case 'ko':
          if (s.pt > F(config.koSec)) {
            const w = s.pendingWinner ?? null; s.pendingWinner = undefined;
            const perfect = w !== null && config.perfect && hpOf(rt.entity(w)).frac === 1;
            if (perfect) rt.emit('perfect', { who: w, round: s.round });
            set(s, 'round_end'); scoreRound(s, w, w === null ? 'double_ko' : perfect ? 'perfect' : 'ko');
          }
          break;
        case 'round_end':
          if (s.pt > F(config.roundEndSec)) {
            const done = Object.values(s.wins).some(n => n >= toWin) || s.round >= maxRounds;
            if (done) { const ranked = s.fighters.slice().sort((a, b) => s.wins[b] - s.wins[a]); endMatch(s, s.wins[ranked[0]] === s.wins[ranked[1]] ? null : ranked[0]); }
            else startRound(s);
          }
          break;
      }
      vars(s);
    }, ID);
  },
};
