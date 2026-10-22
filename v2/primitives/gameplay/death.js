// gameplay.death: what happens when the player dies. Lives (finite or not),
// extra lives at score thresholds, a respawn point (last checkpoint, a hospital
// or named zone, the start, or where they fell), a respawn delay with
// invulnerability, and penalties: drop a share of every currency (optionally
// into a corpse/shade that must be reached or defeated to get it back before
// the next death or a timer), lose XP, lose items. Running out of lives runs
// the game-over effects and ends the game. Provides the `death` service so
// gameplay.combat.health hands player deaths over instead of ending the game.
import { frames, grantInvuln, v3, posOf, distance, combat, service, round, err, hasArchetype } from './combat-lib.js';

const KEY = 'gameplay.death';
const RESPAWN = ['checkpoint', 'hospital', 'zone', 'start', 'here', 'none'];

export default {
  id: KEY,
  card: {
    loop: { shows: [], verbs: [], progress: ['respawned', 'extra_life'], lose: { param: 'gameOver', reads: { var: 'lives', by: { events: ['died'] } } } },
    intent: 'Player death rules: lives and extra lives at score thresholds, respawn at checkpoint/hospital/zone/start with a delay and invulnerability, penalties (drop currency into a corpse to retrieve, lose XP or items), and game over.',
    views: ['any'],
    params: {
      respawn: { type: 'string', options: RESPAWN, default: 'checkpoint', effect: 'where the player comes back (checkpoint falls back to start)' },
      zone: { type: 'ref', to: 'zone', effect: 'zone for respawn hospital|zone' },
      respawnSec: { type: 'number', default: 1.5, min: 0, max: 60, unit: 's' },
      invulnSec: { type: 'number', default: 2, min: 0, max: 30, unit: 's' },
      restoreHp: { type: 'number', default: 1, min: 0.01, max: 1, effect: 'fraction of max hp on respawn' },
      refill: { type: 'boolean', default: true, effect: 'refill resource pools on respawn' },
      penalty: { type: 'object', default: { dropCurrency: 0, corpse: false, keepItems: true, loseXp: 0 }, fields: {
        dropCurrency: { type: 'number', default: 0, min: 0, max: 1, effect: 'share of each currency lost on death' },
        corpse: { type: 'boolean', default: false, effect: 'dropped currency waits at the death spot until retrieved' },
        keepItems: { type: 'boolean', default: true },
        loseXp: { type: 'number', default: 0, min: 0, max: 1 },
      } },
      currency: { type: 'list', of: { type: 'string' }, default: ['money.*'], effect: 'currency vars; a trailing * matches a prefix' },
      corpseArchetype: { type: 'ref', to: 'archetype', effect: 'spawned to hold dropped currency; if it has health it must be defeated' },
      retrieveRange: { type: 'number', default: 1.5, min: 0.1, max: 50, unit: 'units' },
      retrieveSec: { type: 'number', default: 0, min: 0, max: 36000, unit: 's', effect: 'the corpse disappears after this long (0 = until the next death)' },
      lives: { type: 'integer', default: 0, min: 0, max: 99, effect: 'tries before game over (0 = unlimited)' },
      maxLives: { type: 'integer', default: 9, min: 1, max: 99 },
      extraLifeAt: { type: 'list', of: { type: 'number', min: 0 }, default: [], effect: 'score thresholds that give a life' },
      extraLifeEvery: { type: 'number', default: 0, min: 0, effect: 'a life every N points (0 = none)' },
      scoreVar: { type: 'string', default: 'score' },
      gameOver: { type: 'effects', default: [], effect: 'run when the last life is lost (before the game ends)' },
      gameOverEnding: { type: 'ref', to: 'ending' },
    },
    provides: { events: ['player_died', 'respawned', 'game_over', 'extra_life', 'retrieved', 'corpse_lost', 'checkpoint_used'], vars: ['lives', 'deaths'], services: ['death'] },
    requires: { primitives: ['gameplay.combat.health'] },
    rules: {
      death_zone_missing: { fields: ['respawn', 'zone'], message: "respawn 'zone' names its zone" },
      death_thresholds_order: { fields: ['extraLifeAt'], message: 'extra life thresholds increase' },
      death_corpse_unused: { fields: ['corpseArchetype', 'penalty.corpse'], message: 'a corpseArchetype goes with penalty.corpse true' },
    },
  },
  logic(logic) {
    logic.effect('set_respawn', { run: (e, rt, c) => rt.service('death').setRespawn({ space: e.space ?? rt.player()?.space, at: e.at ?? null, zone: e.zone ?? null }) });
    logic.effect('give_life', { run: (e, rt) => rt.service('death').addLife(e.count ?? 1) });
  },
  validate(config, doc) {
    const errors = [];
    if (config.respawn === 'zone' && !config.zone) errors.push(err('death_zone_missing', 'with.zone', 'respawn zone needs a zone'));
    if (config.extraLifeAt.some((v, i, a) => i && v <= a[i - 1])) errors.push(err('death_thresholds_order', 'with.extraLifeAt', 'extra life thresholds must increase'));
    if (config.corpseArchetype && !config.penalty.corpse) errors.push(err('death_corpse_unused', 'with.corpseArchetype', 'corpseArchetype needs penalty.corpse true'));
    return errors;
  },
  install(rt, config) {
    const S = () => { const s = rt.store(KEY); s.lives ??= config.lives; s.deaths ??= 0; s.next ??= 0; s.pending ??= null; s.corpse ??= null; return s; };
    const sync = () => { const s = S(); rt.state.vars.lives = config.lives ? s.lives : -1; rt.state.vars.deaths = s.deaths; };
    const currencies = () => Object.keys(rt.state.vars).filter(k => config.currency.some(c => (c.endsWith('*') ? k.startsWith(c.slice(0, -1)) : k === c))).sort();
    const nextThreshold = () => { const s = S(); return config.extraLifeAt[s.next] ?? (config.extraLifeEvery ? (Math.floor((s.everyAt ?? 0) / config.extraLifeEvery) + 1) * config.extraLifeEvery : Infinity); };
    const api = {
      lives: () => S().lives,
      addLife(n = 1) { const s = S(); if (!config.lives) return; s.lives = Math.min(config.maxLives, s.lives + n); rt.emit('extra_life', { lives: s.lives }); sync(); },
      setRespawn(point) { S().checkpoint = point; rt.emit('checkpoint_used', point); },
      pending: () => S().pending,
    };
    rt.provide('death', api);
    rt.on('checkpoint_set', d => { S().checkpoint = { space: d.space ?? rt.player()?.space, at: d.at ?? null, zone: d.zone ?? null }; });
    rt.on('game_start', () => { const p = rt.player(); if (p) S().start ??= { space: p.space, at: Array.isArray(p.at) ? p.at.slice() : p.at, zone: p.zone ?? null }; sync(); });

    const dropCorpse = (p, amounts) => {
      const s = S();
      if (s.corpse) { const old = rt.entity(s.corpse.id); if (old) rt.despawn(old.id); rt.emit('corpse_lost', { amounts: s.corpse.amounts }); s.corpse = null; }
      if (!Object.values(amounts).some(v => v > 0)) return;
      const arch = config.corpseArchetype ?? 'corpse';
      const c = rt.spawn(arch, { space: p.space, at: Array.isArray(p.at) ? p.at.slice() : p.at });
      (c.components.corpse = { owner: 'player', amounts });
      s.corpse = { id: c.id, amounts, at: c.at, left: config.retrieveSec ? frames(config.retrieveSec) : null, hostile: Boolean(c.components.health) };
    };
    const retrieve = () => {
      const s = S(); if (!s.corpse) return;
      for (const [k, v] of Object.entries(s.corpse.amounts)) rt.state.vars[k] = round((rt.state.vars[k] ?? 0) + v);
      rt.emit('retrieved', { amounts: s.corpse.amounts });
      if (rt.entity(s.corpse.id) && !rt.entity(s.corpse.id).components.health?.dead) rt.despawn(s.corpse.id);
      s.corpse = null;
    };
    rt.on('died', ({ who, by }) => {
      const s = S();
      if (s.corpse?.hostile && who === s.corpse.id && by === 'player') { retrieve(); return; }
      if (who !== 'player' || s.pending) return;
      const p = rt.player();
      s.deaths++;
      const amounts = {};
      if (config.penalty.dropCurrency > 0) for (const k of currencies()) { const v = rt.state.vars[k] ?? 0, lose = Math.floor(v * config.penalty.dropCurrency * 1e6) / 1e6; if (lose > 0) { rt.state.vars[k] = round(v - lose); amounts[k] = lose; } }
      if (config.penalty.corpse) dropCorpse(p, amounts);
      if (config.penalty.loseXp > 0 && rt.state.vars.xp) rt.state.vars.xp = Math.floor(rt.state.vars.xp * (1 - config.penalty.loseXp));
      if (!config.penalty.keepItems && rt.canRun('take_item')) {
        const bag = rt.state.prim['gameplay.inventory']?.player || {};
        rt.run(Object.entries(bag).map(([item, count]) => ({ do: 'take_item', item, count })));
      }
      if (config.lives) s.lives--;
      rt.emit('player_died', { at: p?.at ?? null, by: by ?? null, lives: config.lives ? s.lives : -1, deaths: s.deaths });
      sync();
      if (config.lives && s.lives <= 0) {
        rt.emit('game_over', { deaths: s.deaths });
        rt.run(config.gameOver, { self: 'player' });
        if (rt.state.status === 'playing') rt.run([{ do: 'end_game', outcome: 'lost', ...(config.gameOverEnding ? { ending: config.gameOverEnding } : {}) }]);
        return;
      }
      if (config.respawn === 'none') return;
      s.pending = { at: rt.state.frame + frames(config.respawnSec), where: p ? { space: p.space, at: Array.isArray(p.at) ? p.at.slice() : p.at } : null };
    });
    const respawn = () => {
      const s = S(), p = rt.player(); if (!p) return;
      const point = config.respawn === 'here' ? s.pending.where : config.respawn === 'checkpoint' ? s.checkpoint ?? s.start : config.respawn === 'start' ? s.start : config.zone ? { space: p.space, zone: config.zone } : s.checkpoint ?? s.start;
      s.pending = null;
      if (point) {
        if (point.space && point.space !== p.space) rt.moveToSpace(p, point.space, point.at ?? null, point.zone ?? undefined);
        else if (point.zone) rt.space(p.space).teleport(p, { zone: point.zone }, rt);
        else if (point.at != null) rt.space(p.space).setPos?.(p, Array.isArray(point.at) ? point.at.slice() : point.at, rt);
      }
      combat(rt)?.revive(p, { frac: config.restoreHp });
      grantInvuln(p, frames(config.invulnSec));
      if (config.refill) service(rt, 'resources')?.refill(p);
      rt.emit('respawned', { at: p.at, zone: p.zone ?? null });
    };
    rt.system('rules', rt => {
      const s = S();
      if (s.pending && rt.state.frame >= s.pending.at) respawn();
      if (s.corpse) {
        const c = rt.entity(s.corpse.id), p = rt.player();
        if (!c) s.corpse = null;
        else if (s.corpse.left != null && --s.corpse.left <= 0) { rt.despawn(c.id); rt.emit('corpse_lost', { amounts: s.corpse.amounts }); s.corpse = null; }
        else if (!s.corpse.hostile && p && !s.pending && !p.components.health?.dead && distance(rt, p, c) <= config.retrieveRange) retrieve();
      }
      if (config.lives && (config.extraLifeAt.length || config.extraLifeEvery)) {
        const score = rt.state.vars[config.scoreVar] ?? 0;
        for (let guard = 0; guard < 20 && score >= nextThreshold(); guard++) {
          if (s.next < config.extraLifeAt.length) s.next++; else s.everyAt = nextThreshold();
          api.addLife(1);
        }
      }
      sync();
    }, KEY);
  },
};
export { v3, posOf, hasArchetype };
