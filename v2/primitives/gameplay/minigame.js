// gameplay.minigame: sub-modes launched from the main game (fishing,
// lockpicking, hacking, a card duel or a bullet-hell battle in its own space).
// Starting one can move the player into a separate space (rt.moveToSpace) and
// freezes the main world: entities outside the minigame are held exactly where
// they were (state restored each step) and the 'pause' service / flag tells
// cooperating primitives to idle. Built-in kinds give real mechanics as data:
//  - timing: a cursor sweeps a bar; press inside the sweet spot (fishing
//    tension, lockpick pins, golf swings); the spot can drift after each hit;
//  - sequence: repeat a random verb sequence against a per-key clock (hacking, QTEs);
//  - mash: press fast enough to fill a decaying meter (struggles, tug of war);
//  - custom: other primitives play it; win/lose predicates decide.
// The kernel has no system-level pause (requested in v2/kernel/requests/modes.md).
import { compare } from '../../kernel/logic.js';
import { pushModal, popModal, err, runBound, r6, sortedEntities } from './modes-lib-util.js';

const ID = 'gameplay.minigame';
const KINDS = ['custom', 'timing', 'sequence', 'mash'];
const RESULTS = ['won', 'lost', 'quit'];

export default {
  id: ID,
  card: {
    loop: { shows: [], verbs: ['mg_press', 'mg_input'], progress: ['minigame_hit', 'minigame_end'], win: { param: 'games.onWin', scope: 'encounter', reads: { var: 'minigame.progress', by: { actions: ['mg_press', 'mg_input'] } } },
      lose: { param: 'games.onLose', scope: 'encounter', once: true, reads: { event: 'minigame_end', by: { actions: ['mg_press', 'mg_input'] } } },
      // As an encounter: beating the game beats whoever posed it; failing it is the player's loss.
      outcome: { sides: ['player', 'opponent'], results: { won: { param: 'games.onWin', player: 'keeps', opponent: 'defeated' }, lost: { param: 'games.onLose', player: 'defeated', opponent: 'keeps' } } } },
    intent: 'Sub-mode launcher: starts a minigame (timing bar, input sequence, button mash, or a custom mode in its own space), freezes the main world while it runs, and returns the player with win/lose effects. Fishing, lockpicking, hacking, QTEs, card duels and battle screens.',
    views: ['any'],
    params: {
      games: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, kind: { type: 'string', options: KINDS, default: 'custom' },
        space: { type: 'ref', to: 'space', effect: 'move the player here for the minigame' }, zone: { type: 'ref', to: 'zone' }, at: { type: 'json' },
        timeSec: { type: 'number', default: 0, min: 0, max: 3600, unit: 's', effect: 'time limit (0 = none); timing out loses' },
        win: { type: 'predicate' }, lose: { type: 'predicate' },
        onStart: { type: 'effects', default: [] }, onWin: { type: 'effects', default: [] }, onLose: { type: 'effects', default: [] }, onEnd: { type: 'effects', default: [] },
        freeze: { type: 'boolean', default: true, effect: 'hold the main world still while it runs' },
        returnPlayer: { type: 'boolean', default: true },
        timing: { type: 'object', default: { speed: 1, width: 0.2, hits: 3, misses: 3, drift: 0, center: 0.5, accel: 0 }, fields: { speed: { type: 'number', default: 1, min: 0.05, max: 20, unit: 'sweeps/s' }, width: { type: 'number', default: 0.2, min: 0.01, max: 1 }, hits: { type: 'integer', default: 3, min: 1, max: 99 }, misses: { type: 'integer', default: 3, min: 1, max: 99 }, drift: { type: 'number', default: 0, min: 0, max: 1, effect: 'the sweet spot jumps up to this far after a hit' }, center: { type: 'number', default: 0.5, min: 0, max: 1 }, accel: { type: 'number', default: 0, min: 0, max: 5, effect: 'sweep speeds up by this fraction per hit' } } },
        sequence: { type: 'object', default: { length: 4, verbs: ['up', 'down', 'left', 'right'], timePerKey: 1.5, mistakes: 0 }, fields: { length: { type: 'integer', default: 4, min: 1, max: 64 }, verbs: { type: 'list', of: { type: 'string' }, min: 2, default: ['up', 'down', 'left', 'right'] }, timePerKey: { type: 'number', default: 1.5, min: 0.1, max: 30, unit: 's' }, mistakes: { type: 'integer', default: 0, min: 0, max: 64 } } },
        mash: { type: 'object', default: { target: 20, decay: 2, perPress: 1 }, fields: { target: { type: 'number', default: 20, min: 1, max: 1000 }, decay: { type: 'number', default: 2, min: 0, max: 100, unit: '/s' }, perPress: { type: 'number', default: 1, min: 0.1, max: 100 } } },
      } } },
    },
    provides: {
      events: ['minigame_start', 'minigame_start:*', 'minigame_end', 'minigame_end:*', 'minigame_hit', 'minigame_miss', 'minigame_key'],
      vars: ['minigame.active', 'minigame.progress', 'minigame.cursor', 'minigame.spot', 'minigame.next', 'minigame.time'],
      services: ['pause'],
      actions: ['mg_press', 'mg_input', 'mg_quit'],
    },
    actionSpace: { mg_input: { type: 'choice', of: 'a key of the running sequence' }, mg_press: { kind: 'impulse', params: {} } },
    requires: {},
    defines: [{ kind: 'minigame', in: 'games' }],
    // As an encounter's inner loop: the encounter starts its first game.
    engage: { encounter: { start: [{ do: 'start_minigame', game: '$first:with.games' }] } },
    reads: [],
  },
  logic(logic) {
    logic.predicate('minigame', {
      refs: p => (typeof p.minigame === 'string' ? [['minigame', p.minigame]] : []),
      check: (p, path, errors) => { if (p.state !== undefined && !['active', 'idle', ...RESULTS].includes(p.state)) errors.push(err('minigame_state', `${path}.state`, 'state must be active|idle|won|lost|quit')); },
      test: (p, rt) => {
        const s = rt.state.prim[ID]; if (!s) return p.state === 'idle';
        const id = typeof p.minigame === 'string' ? p.minigame : null;
        if (p.state === 'active' || p.state === undefined) { const on = Boolean(s.active) && (!id || s.active.game === id); if (p.state === undefined && ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined)) return compare(s.plays?.[id] ?? 0, p); return on; }
        if (p.state === 'idle') return !s.active || (id && s.active.game !== id);
        return (id ? s.results?.[id] : s.last) === p.state;
      },
    });
    logic.effect('start_minigame', { refs: e => [['minigame', e.game]], run: (e, rt) => { rt.store(ID).request = { start: e.game }; } });
    logic.effect('end_minigame', { check: (e, path, errors) => { if (e.result !== undefined && !RESULTS.includes(e.result)) errors.push(err('effect_invalid', `${path}.result`, 'result must be won|lost|quit')); }, run: (e, rt) => { rt.store(ID).request = { end: e.result ?? 'won' }; } });
  },
  validate(config) {
    const errors = [], ids = new Set();
    config.games.forEach((g, i) => {
      if (ids.has(g.id)) errors.push(err('minigame_duplicate', `with.games[${i}].id`, `duplicate minigame '${g.id}'`)); ids.add(g.id);
      if (g.kind === 'custom' && !g.win && !g.lose && !g.timeSec) errors.push(err('minigame_kind', `with.games[${i}]`, 'a custom minigame needs win, lose or timeSec to end', 'or end it with end_minigame'));
      if ((g.zone || g.at !== undefined) && !g.space) errors.push(err('minigame_place', `with.games[${i}].space`, 'zone/at need the minigame space'));
    });
    return errors;
  },
  install(rt, config) {
    const GAME = new Map(config.games.map(g => [g.id, g])), F = sec => Math.round(sec * 60);
    const st = () => { const s = rt.store(ID); s.results ??= {}; s.plays ??= {}; return s; };
    rt.provide('pause', { paused: space => { const a = st().active; return Boolean(a?.freeze) && (!space || space !== a.space); }, active: () => st().active?.game ?? null });

    function start(s, id) {
      const g = GAME.get(id); if (!g || s.active) return;
      const p = rt.player();
      const a = s.active = { game: id, kind: g.kind, t: 0, freeze: g.freeze, space: g.space ?? p?.space ?? null, ret: p ? { space: p.space, at: structuredClone(p.at) } : null, hits: 0, misses: 0, progress: 0 };
      if (g.freeze) {
        a.frozen = {};
        for (const e of sortedEntities(rt)) if (e.id !== 'player' && (!g.space || e.space !== g.space)) a.frozen[e.id] = structuredClone(e);
      }
      if (p && g.space && g.space !== p.space) rt.moveToSpace(p, g.space, g.at ?? null, g.zone);
      else if (p && (g.zone || g.at !== undefined)) rt.space(p.space).teleport(p, { zone: g.zone, at: g.at }, rt);
      if (g.kind === 'timing') { a.cursor = 0; a.dir = 1; a.spot = g.timing.center; a.speed = g.timing.speed; }
      if (g.kind === 'sequence') { a.keys = Array.from({ length: g.sequence.length }, () => g.sequence.verbs[Math.floor(rt.random() * g.sequence.verbs.length)]); a.k = 0; a.keyT = 0; }
      if (g.kind === 'mash') a.meter = 0;
      s.plays[id] = (s.plays[id] ?? 0) + 1;
      rt.state.flags.paused = Boolean(g.freeze);
      pushModal(rt, s, ID, ['mg_press', 'mg_input', 'mg_quit'], 'minigame');
      rt.emitTyped('minigame_start', id, { game: id, kind: g.kind, keys: a.keys ?? null });
      runBound(rt, g.onStart, { actor: 'player' });
    }
    function end(s, result) {
      const a = s.active; if (!a) return;
      const g = GAME.get(a.game), p = rt.player();
      s.active = null; s.results[a.game] = result; s.last = result;
      if (a.frozen) thaw(a);
      if (p && g.returnPlayer && a.ret) { if (p.space !== a.ret.space) rt.moveToSpace(p, a.ret.space, a.ret.at); else rt.space(p.space).setPos(p, a.ret.at, rt); }
      delete rt.state.flags.paused; popModal(rt, s, ID);
      rt.emitTyped('minigame_end', a.game, { game: a.game, result, hits: a.hits, misses: a.misses });
      runBound(rt, result === 'won' ? g.onWin : result === 'lost' ? g.onLose : [], { actor: 'player' });
      runBound(rt, g.onEnd, { actor: 'player' });
    }
    /** Hold frozen entities exactly as they were (positions, components; despawned ones come back). */
    function thaw(a) {
      for (const [id, snap] of Object.entries(a.frozen)) {
        const e = rt.state.entities[id];
        if (!e) rt.state.entities[id] = structuredClone(snap);
        else { e.at = structuredClone(snap.at); e.components = structuredClone(snap.components); e.zone = snap.zone; }
      }
    }
    const inside = (a, g) => { const w = g.timing.width / 2; return Math.abs(a.cursor - a.spot) <= w; };

    rt.action('mg_press', () => {
      const s = st(), a = s.active; if (!a) return;
      const g = GAME.get(a.game);
      if (a.kind === 'timing') {
        if (inside(a, g)) {
          a.hits++; rt.emit('minigame_hit', { game: a.game, hits: a.hits });
          a.speed = r6(a.speed * (1 + g.timing.accel));
          if (g.timing.drift) a.spot = r6(Math.min(1 - g.timing.width / 2, Math.max(g.timing.width / 2, a.spot + (rt.random() * 2 - 1) * g.timing.drift)));
          if (a.hits >= g.timing.hits) end(s, 'won');
        } else { a.misses++; rt.emit('minigame_miss', { game: a.game, misses: a.misses }); if (a.misses >= g.timing.misses) end(s, 'lost'); }
      } else if (a.kind === 'mash') { a.meter = r6(a.meter + g.mash.perPress); if (a.meter >= g.mash.target) end(s, 'won'); }
    });
    rt.action('mg_input', v => {
      const s = st(), a = s.active; if (!a || a.kind !== 'sequence') return;
      const g = GAME.get(a.game);
      if (v === a.keys[a.k]) { a.k++; a.hits++; a.keyT = 0; rt.emit('minigame_key', { game: a.game, key: v, ok: true }); if (a.k >= a.keys.length) end(s, 'won'); }
      else { a.misses++; rt.emit('minigame_key', { game: a.game, key: v, ok: false }); if (a.misses > g.sequence.mistakes) end(s, 'lost'); }
    });
    rt.action('mg_quit', () => { const s = st(); if (s.active) end(s, 'quit'); });

    rt.system('input', rt => {
      const s = st();
      if (s.request?.start) { const id = s.request.start; s.request = null; start(s, id); }
    }, ID);
    rt.system('late', rt => {
      const s = st();
      if (s.request?.end) { const r = s.request.end; s.request = null; end(s, r); }
      const a = s.active, v = rt.state.vars;
      if (!a) { v['minigame.active'] = 0; return; }
      const g = GAME.get(a.game);
      a.t++;
      if (a.kind === 'timing') {
        a.cursor = r6(a.cursor + a.dir * a.speed * 2 * rt.dt);
        if (a.cursor >= 1) { a.cursor = r6(2 - a.cursor); a.dir = -1; } else if (a.cursor <= 0) { a.cursor = r6(-a.cursor); a.dir = 1; }
        a.progress = r6(a.hits / g.timing.hits);
      } else if (a.kind === 'sequence') {
        if (++a.keyT > F(g.sequence.timePerKey)) end(s, 'lost');
        a.progress = r6(a.k / a.keys.length);
      } else if (a.kind === 'mash') { a.meter = r6(Math.max(0, a.meter - g.mash.decay * rt.dt)); a.progress = r6(a.meter / g.mash.target); }
      if (s.active && g.win && rt.test(g.win)) end(s, 'won');
      else if (s.active && g.lose && rt.test(g.lose)) end(s, 'lost');
      else if (s.active && g.timeSec && a.t >= F(g.timeSec)) end(s, 'lost');
      if (s.active?.frozen) thaw(s.active);
      const cur = s.active;
      v['minigame.active'] = cur ? 1 : 0;
      v['minigame.progress'] = cur?.progress ?? 0; v['minigame.cursor'] = cur?.cursor ?? 0; v['minigame.spot'] = cur?.spot ?? 0;
      v['minigame.next'] = cur?.keys?.[cur.k] ?? ''; v['minigame.time'] = cur && g.timeSec ? Math.max(0, Math.ceil((F(g.timeSec) - cur.t) / 60)) : 0;
    }, ID);

    rt.options(rt => {
      const a = st().active; if (!a) return [];
      if (a.kind === 'timing' || a.kind === 'mash') return [{ label: 'minigame press', actions: { mg_press: true } }, { label: 'minigame wait', actions: {}, modal: ID }];
      if (a.kind === 'sequence') return GAME.get(a.game).sequence.verbs.map(k => ({ label: `minigame ${k}`, actions: { mg_input: k } }));
      return [];
    });
  },
};
