// gameplay.combat.stealth: detection meters. Every watcher (an entity with
// components.stealth, or any hostile with an ai component) fills a meter toward
// the player while it can see them (range, field of view, line of sight; slower
// when the player crouches, faster in light or with stat.visibility, slower with
// stat.stealth) and when it hears noise events nearby. A full meter detects;
// an emptied meter after detection loses the target. Unaware watchers can be
// taken down from behind.
import { v3, sub, norm, dot, len, posOf, facingOf, spaceOf, distance, hostile, statOf, resolveWho, combat, err } from './combat-lib.js';

const KEY = 'gameplay.combat.stealth';

export default {
  id: KEY,
  card: {
    intent: 'Stealth detection: watchers fill a detection meter while they see (range, view cone, line of sight, crouching, light) or hear the player; full meters detect, emptied ones lose the target; silent takedowns from behind on unaware watchers.',
    views: ['3p', '1p', 'td', 'side'],
    params: {
      sightRange: { type: 'number', default: 30, min: 0.5, max: 1000, unit: 'units' },
      fov: { type: 'number', default: 110, min: 1, max: 360, unit: 'deg' },
      crouchFactor: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'visibility while crouching (held crouch, or body.crouch)' },
      fillRate: { type: 'number', default: 1.5, min: 0, max: 100, unit: '/s', effect: 'meter fill at full visibility; nearer is faster' },
      decayRate: { type: 'number', default: 0.35, min: 0, max: 100, unit: '/s' },
      suspicious: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'meter level that raises suspicion' },
      noise: { type: 'list', default: [{ event: 'fired', radius: 15, amount: 0.6 }, { event: 'attack_started', radius: 6, amount: 0.4 }, { event: 'jumped', radius: 4, amount: 0.2 }, { event: 'blast', radius: 25, amount: 1 }], of: { type: 'object', fields: { event: { type: 'string', required: true }, radius: { type: 'number', default: 8, min: 0 }, amount: { type: 'number', default: 0.6, min: 0, max: 1 } } }, effect: 'events that make noise around the player' },
      takedown: { type: 'boolean', default: true },
      takedownRange: { type: 'number', default: 1.5, min: 0.1, max: 20, unit: 'units' },
    },
    provides: { events: ['detected', 'detected:*', 'suspicious', 'lost_target', 'takedown', 'noise_heard'], vars: ['stealth.alert', 'stealth.detected'], services: ['stealth'], actions: ['takedown'] },
    requires: { primitives: ['gameplay.combat.health'] },
  },
  logic(logic) {
    logic.predicate('detected', { test: (p, rt, c) => {
      const s = rt.service('stealth'), who = p.detected;
      if (who === undefined || who === true || who === 'any' || who === 'player') return s.watchers().some(w => s.detected(w));
      const w = resolveWho(rt, who, c); if (w) return s.detected(w);
      return s.watchers().some(x => x.archetype === who && s.detected(x));
    } });
  },
  validate(config) {
    const errors = [], seen = new Set();
    config.noise.forEach((n, i) => { if (seen.has(n.event)) errors.push(err('stealth_noise_duplicate', `with.noise[${i}].event`, `duplicate noise event '${n.event}'`)); seen.add(n.event); });
    return errors;
  },
  install(rt, config) {
    const watchers = () => { const p = rt.player(); return Object.values(rt.state.entities).filter(e => e.id !== 'player' && (e.components.stealth || (e.components.ai && p && hostile(rt, e, p))) && !e.components.health?.dead); };
    const st = e => { const s = (e.components.stealth = typeof e.components.stealth === 'object' && e.components.stealth ? e.components.stealth : {}); s.meter ??= 0; s.detected ??= false; s.heard ??= 0; return s; };
    const sees = (w, p) => {
      const s = st(w), range = s.sight ?? config.sightRange, fov = s.fov ?? config.fov, a = posOf(w), b = posOf(p);
      if (!a || !b || w.space !== p.space) return 0;
      const d = len(sub(b, a)); if (d > range) return 0;
      if (d > 1e-6 && Math.acos(Math.max(-1, Math.min(1, dot(facingOf(w), norm(sub(b, a)))))) * 180 / Math.PI > fov / 2) return 0;
      const api = spaceOf(rt, w);
      if (api?.los && !api.los(w.at, p.at).clear) return 0;
      if (!api?.los && api?.raycast && d > 1e-6) { const r = api.raycast(w.at, sub(b, a), d); if (r.hit !== 'none' && r.dist < d - 0.5) return 0; }
      const crouch = rt.input?.held?.crouch || p.components.body?.crouch ? config.crouchFactor : 1;
      const vis = Math.max(0, 1 + statOf(rt, p, 'stat.visibility')) * Math.max(0, 1 - statOf(rt, p, 'stat.stealth'));
      return (1 - 0.5 * d / range) * crouch * vis;
    };
    const api = {
      watchers,
      meter: w => st(w).meter,
      detected: w => Boolean(st(w).detected),
      alert(w, amount = 1) { const s = st(w); s.meter = Math.min(1, s.meter + amount); },
    };
    rt.provide('stealth', api);
    for (const n of config.noise) rt.on(n.event, d => {
      const p = rt.player(); if (!p || (d.who && d.who !== 'player' && d.by !== 'player')) return;
      for (const w of watchers()) { const s = st(w), r = (s.hearing ?? n.radius); if (distance(rt, w, p) <= r) { s.heard = Math.max(s.heard, n.amount ?? 0.6); rt.emit('noise_heard', { who: w.id, event: n.event }); } }
    });
    rt.action('takedown', (v, rt) => {
      const p = rt.player(); if (!p || !config.takedown) return;
      const pp = posOf(p); if (!pp) return;
      const w = watchers().filter(w => !st(w).detected && distance(rt, w, p) <= config.takedownRange && dot(facingOf(w), norm(sub(pp, posOf(w)))) < 0)
        .sort((a, b) => distance(rt, a, p) - distance(rt, b, p))[0];
      if (!w) return;
      combat(rt)?.kill(w, { by: 'player', source: 'takedown' });
      rt.emit('takedown', { who: 'player', target: w.id, archetype: w.archetype });
    });
    rt.system('ai', rt => {
      const p = rt.player(); if (!p) return;
      let alert = 0, n = 0;
      for (const w of watchers()) {
        const s = st(w), vis = sees(w, p);
        const before = s.meter;
        if (vis > 0 || s.heard > 0) s.meter = Math.min(1, s.meter + vis * config.fillRate / 60 + s.heard);
        else s.meter = Math.max(0, s.meter - config.decayRate / 60);
        s.heard = 0;
        if (before < config.suspicious && s.meter >= config.suspicious && !s.detected) rt.emit('suspicious', { who: w.id, target: p.id });
        if (s.meter >= 1 && !s.detected) { s.detected = true; rt.emitTyped('detected', w.archetype, { who: w.id, target: p.id }); }
        if (s.detected && s.meter <= 0) { s.detected = false; rt.emit('lost_target', { who: w.id, target: p.id }); }
        alert = Math.max(alert, s.meter); if (s.detected) n++;
      }
      rt.state.vars['stealth.alert'] = Math.round(alert * 1000) / 1000; rt.state.vars['stealth.detected'] = n;
    }, KEY);
  },
};
