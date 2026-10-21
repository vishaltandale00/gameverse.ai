// gameplay.combat.health: hit points and the one damage pipeline every combat
// primitive uses. Owns components.health and the `combat` service.
//
// Hit pipeline (combat.hit(target, hit)):
//   alive and tangible -> team check (friendlyFire) -> i-frames / invulnerable stat
//   -> interceptors (block, parry, shields, cover, guard...) -> resist, armor and
//   damage stats -> hp -> i-frames, hit stun, knockback push -> death rules.
// Death rules per entity (components.health.respawn): none (corpse or despawn),
// home (intangible, walks home via move_to, revives there: maze eyes), spawn
// (revives at home after a delay), plus splitOnDeath (asteroid rocks).
// Physics impacts (`impact {who, speed}` events) and contact damage from
// components.touch also go through the pipeline.
import { boxOf, frames, grantInvuln, invulnFrames, FPS, v3, add, sub, mul, len, norm, posOf, like, distance, statOf, teamOf, hostile, resolveWho, targetsOf, targetRefs, hooks, overlapping, displace, round, err, archetypes, touchDefeats } from './combat-lib.js';

const KEY = 'gameplay.combat.health';
const RESPAWN = ['none', 'home', 'spawn'];
const PUSH_DECAY = 0.8; // per frame; total travel = push / (1 - decay)

const health = {
  id: KEY,
  card: {
    // The participants an event names (role -> data field): who was hurt and who hurt it (a touch, a blow).
    loop: { verbs: [], progress: ['damaged', 'defeated'], involves: { damaged: { hurt: 'who', by: 'by' } } },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: {
      // The shared fields (KERNEL_API §2: hp, max, invulnerable, dead) and the authored death, regen and mitigation rules.
      health: { type: 'object', fields: {
        max: { type: 'number', min: 0.01, required: true, effect: 'hit points' },
        hp: { type: 'number', min: 0, effect: 'current hit points (set at spawn from start, else max)' },
        start: { type: 'number', min: 0, effect: 'hit points at spawn (default max)' },
        invulnerable: { type: 'number', min: 0, unit: 's', effect: 'seconds of invulnerability left (0 when vulnerable)' },
        dead: { type: 'boolean', effect: 'out of play (set by the death rules)' },
        regen: { type: 'number', effect: 'hp per second' },
        regenDelay: { type: 'number', min: 0, unit: 's', effect: 'seconds without damage before regen resumes (default the regenDelay param)' },
        iframeSec: { type: 'number', min: 0, unit: 's' },
        respawn: { type: 'object', fields: { mode: { type: 'string', options: RESPAWN, effect: 'none: corpse or despawn; home: walks home and revives there; spawn: revives at home after sec' }, sec: { type: 'number', min: 0, max: 600, unit: 's' } }, effect: 'death rule (default the respawn param)' },
        resist: { type: 'object', values: { type: 'number' }, effect: 'damage type -> fraction resisted (1 immune, negative weak)' },
        armor: { type: 'object', values: { type: 'number' }, effect: 'damage type -> flat damage removed' },
        corpse: { type: 'boolean', effect: 'stays as a corpse when it dies (respawn none)' },
        team: { type: 'string', effect: 'its side: hits between entities of one team need friendlyFire' },
        splitOnDeath: { type: 'object', fields: {
          into: { type: 'ref', to: 'archetype', effect: 'what it splits into (default its own archetype)' }, count: { type: 'integer', min: 1, effect: 'pieces (default 2)' },
          speed: { type: 'number', min: 0 }, speedMult: { type: 'number', min: 0 }, speedAdd: { type: 'number' }, spread: { type: 'number', min: 0, max: 360, unit: 'deg' }, jitter: { type: 'number', min: 0 },
          maxGenerations: { type: 'integer', min: 0, effect: 'how many times pieces split again (default 8)' },
        }, effect: 'splits into pieces when it dies (asteroid rocks)' },
      }, effect: 'hit points' },
      resist: { type: 'object', values: { type: 'number' }, effect: 'damage type -> fraction resisted, when health.resist does not name the type' },
      touch: { type: 'object', fields: { damage: { type: 'number', min: 0, required: true }, type: { type: 'string' }, knockback: { type: 'number', min: 0 }, stomp: { type: 'boolean', effect: 'a hostile body falling onto it from above (with the space gravity) defeats it instead of being hurt' } }, effect: 'contact damage to hostile entities it overlaps' },
    },
    // The effect that takes a holder of a component it owns out of play (an encounter's defeated participant, planner/presets.js).
    defeats: { health: 'kill' },
    // The player can be hurt (and so lose and win fights) from the first frame.
    engage: { player: { components: { health: { max: 10 } } } },
    intent: 'Hit points for any entity with a health component: damage types with resistances and armor (from components and equipment stat vars), i-frames, hit stun, knockback, contact damage, physics impact damage, and death rules (corpse, despawn, respawn at home or spawn, split on death). Every other combat primitive deals damage through it.',
    views: ['any'],
    params: {
      types: { type: 'list', of: { type: 'string' }, default: ['phys', 'fire', 'ice', 'shock', 'poison', 'void'], min: 1, effect: 'damage types; resistances, armor and statuses refer to these' },
      iframes: { type: 'number', default: 0.5, min: 0, max: 10, unit: 's', effect: 'invulnerability after taking damage (components.health.iframeSec overrides; health.invulnerable holds the seconds left)' },
      regenDelay: { type: 'number', default: 0, min: 0, max: 120, unit: 's', effect: 'seconds without damage before health.regen resumes' },
      friendlyFire: { type: 'boolean', default: false, effect: 'allow damage between entities of the same team' },
      knockback: { type: 'number', default: 0, min: 0, max: 100, unit: 'units', effect: 'default push distance for hits that do not set their own' },
      corpse: { type: 'boolean', default: false, effect: 'dead NPCs stay as corpses instead of despawning' },
      corpseSec: { type: 'number', default: 0, min: 0, max: 3600, unit: 's', effect: 'corpse lifetime; 0 keeps it forever' },
      minDamage: { type: 'number', default: 0, min: 0, max: 1000, effect: 'floor for hits that get through resistances (0 allows full mitigation)' },
      vulnerableBonus: { type: 'number', default: 0.5, min: 0, max: 10, effect: 'extra damage per point of stat.vulnerable' },
      contact: { type: 'boolean', default: true, effect: 'entities with components.touch {damage,type,knockback} hurt hostile entities they overlap' },
      impactDamage: { type: 'object', default: { enabled: false, events: ['impact'], minSpeed: 8, perSpeed: 2, type: 'phys' }, fields: {
        enabled: { type: 'boolean', default: false }, events: { type: 'list', of: { type: 'string' }, default: ['impact'] },
        minSpeed: { type: 'number', default: 8, min: 0 }, perSpeed: { type: 'number', default: 2, min: 0 }, type: { type: 'string', default: 'phys' },
      }, effect: 'damage from physics impacts: (speed - minSpeed) * perSpeed for `impact {who|a|b, speed}` events' },
      respawn: { type: 'object', default: { mode: 'none', sec: 3 }, fields: {
        mode: { type: 'string', options: RESPAWN, default: 'none' }, sec: { type: 'number', default: 3, min: 0, max: 600, unit: 's' },
      }, effect: 'default NPC death rule; components.health.respawn overrides per archetype' },
      playerDeath: { type: 'string', options: ['lose', 'none'], default: 'lose', effect: 'without gameplay.death: lose ends the game when the player dies' },
    },
    provides: {
      events: ['damaged', 'damaged:*', 'healed', 'died', 'died:*', 'defeated', 'defeated:*', 'revived', 'revived:*', 'immune', 'knockback', 'split', 'returning', 'stomped'],
      vars: ['hp', 'hp.max'], services: ['combat'],
    },
    reads: ['content.archetypes'],
    rules: {
      health_types_invalid: { fields: ['types'], message: 'damage types are unique' },
      health_type_unknown: { fields: ['content.archetypes[].components.health.resist', 'content.archetypes[].components.health.armor', 'content.archetypes[].components.resist', 'content.archetypes[].components.touch.type', 'types'], message: 'every damage type a resist, armor or touch names is one of the types param' },
    },
  },
  logic(logic) {
    logic.predicate('health', {
      test: (p, rt, c) => { const e = resolveWho(rt, p.health === true ? 'player' : p.health, c); if (!e?.components.health) return false; const h = e.components.health, hp = h.hp ?? h.max ?? 0; return cmp(p.frac ? hp / Math.max(1e-9, maxOf(rt, e)) : hp, p); },
    });
    // `alive` is owned by plot.character (it reads died {id}); health keeps components.health.dead.
    const amountCheck = (e, path, errors) => { if (e.amount !== undefined && !Number.isFinite(e.amount)) errors.push(err('effect_invalid', `${path}.amount`, 'amount must be a number')); };
    logic.effect('damage', { refs: targetRefs, check: amountCheck, run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) { const src = e.from ?? e.by, by = src ? resolveWho(rt, src, c)?.id : c.by ?? (c.self !== t.id ? c.self : null); /* frozen: damage {who, amount, type?, from?} */ rt.service('combat').hit(t, { amount: e.amount ?? 1, type: e.type, by: by ?? undefined, source: 'effect', knockback: e.knockback, ignoreIframes: e.ignoreIframes }); } } });
    logic.effect('heal', { refs: targetRefs, check: amountCheck, run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) rt.service('combat').heal(t, e.amount ?? Infinity, c.self); } });
    logic.effect('kill', { refs: targetRefs, run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) rt.service('combat').kill(t, { by: c.self, source: 'effect' }); } });
    logic.effect('revive', { refs: targetRefs, run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) rt.service('combat').revive(t, { frac: e.frac ?? 1 }); } });
  },
  validate(config, doc) {
    const errors = [], types = new Set(config.types);
    if (types.size !== config.types.length) errors.push(err('health_types_invalid', 'with.types', 'damage types must be unique'));
    archetypes(doc).forEach((a, i) => {
      const h = a.components?.health, path = `content.archetypes[${i}].components.health`;
      if (h && typeof h === 'object') for (const [k, src] of [['resist', h.resist], ['armor', h.armor]]) for (const t of Object.keys(src && typeof src === 'object' ? src : {})) if (!types.has(t)) errors.push(err('health_type_unknown', `${path}.${k}.${t}`, `unknown damage type '${t}'`, `types: ${config.types.join(', ')}`));
      const resist = a.components?.resist;
      for (const t of Object.keys(resist && typeof resist === 'object' ? resist : {})) if (!types.has(t)) errors.push(err('health_type_unknown', `content.archetypes[${i}].components.resist.${t}`, `unknown damage type '${t}'`, `types: ${config.types.join(', ')}`));
      const touch = a.components?.touch;
      if (touch && typeof touch === 'object' && touch.type && !types.has(touch.type)) errors.push(err('health_type_unknown', `content.archetypes[${i}].components.touch.type`, `unknown damage type '${touch.type}'`));
    });
    return errors;
  },
  install(rt, config) {
    const types = new Set(config.types);
    const init = e => {
      const h = e?.components?.health; if (!h || h.hp !== undefined) return;
      h.max ??= 1; h.hp = h.start ?? h.max; h.dead = false; h.invulnerable = h.invulnerable ?? 0; h.stun = 0; h.regenT = 0; h.push = null;
      if (isPos(e.at)) h.home ??= e.at.slice();
    };
    rt.on('spawn', ({ id }) => init(rt.entity(id)));

    const iframesOf = e => frames(e.components.health.iframeSec ?? config.iframes); // health.invulnerable is the live counter (seconds left)
    const tangible = e => { const h = e?.components?.health; return Boolean(h) && !h.dead && h.state !== 'returning'; };
    const syncPlayer = () => { const p = rt.player(); if (p?.components.health) { init(p); rt.state.vars.hp = round(p.components.health.hp); rt.state.vars['hp.max'] = round(maxOf(rt, p)); } };

    const api = {
      types: () => [...types],
      maxHp: e => maxOf(rt, e),
      hp: e => (init(e), e?.components.health?.hp ?? 0),
      alive: e => tangible(e),
      canHit: (a, b) => tangible(b) && (!a || hostile(rt, a, b, config.friendlyFire)),
      /** Apply a hit. Returns { applied, damage, blocked?, killed?, reason? }. */
      hit(target, hit = {}) {
        if (!target) return { applied: false, reason: 'none' };
        init(target);
        const h = target.components.health;
        if (!h || !tangible(target)) return { applied: false, reason: 'intangible' };
        const by = hit.by ? rt.entity(hit.by) : null;
        if (by && !hostile(rt, by, target, config.friendlyFire || hit.friendly)) return { applied: false, reason: 'friendly' };
        if (!hit.ignoreIframes && invulnFrames(target) > 0) return { applied: false, reason: 'iframes' };
        if (statOf(rt, target, 'stat.invulnerable') > 0) { rt.emit('immune', { who: target.id, by: hit.by, type: hit.type, reason: 'invulnerable' }); return { applied: false, reason: 'invulnerable' }; }
        let x = { amount: 0, type: 'phys', source: 'effect', ...hit, type: hit.type && types.has(hit.type) ? hit.type : (hit.type ? hit.type : config.types[0]) };
        for (const { fn } of hooks(rt).intercept) {
          const r = fn(target, x, rt);
          if (r?.cancel) return { applied: false, ...r };
          if (r) x = r;
          if (!tangible(target)) return { applied: false, reason: 'intangible' };
        }
        const dmg = api.mitigate(target, x, by);
        if (dmg <= 0 && x.amount > 0) rt.emit('immune', { who: target.id, by: x.by, type: x.type });
        h.hp = round(Math.max(0, h.hp - dmg));
        if (dmg > 0 && !x.noIframes && x.source !== 'status') grantInvuln(target, x.iframes ?? iframesOf(target));
        if (dmg > 0) h.regenT = frames(h.regenDelay ?? config.regenDelay);
        if (x.stun) { h.stun = Math.max(h.stun, x.stun); h.stunKind = x.stunKind || 'hit'; }
        if (x.source !== 'status') api.push(target, x, by);
        h.lastBy = x.by ?? null;
        const data = { who: target.id, by: x.by ?? null, amount: dmg, type: x.type, source: x.source, hp: h.hp, at: target.at };
        if (x.move) data.move = x.move;
        rt.emitTyped('damaged', target.archetype, data);
        for (const fn of hooks(rt).damaged) fn(target, x, dmg, rt);
        if (target.id === 'player') syncPlayer();
        let killed = false;
        if (h.hp <= 0 && !h.dead && !x.nonLethal) { api.kill(target, { by: x.by, source: x.source, type: x.type }); killed = true; }
        else if (h.hp <= 0 && x.nonLethal) h.hp = Math.min(1, maxOf(rt, target));
        return { applied: true, damage: dmg, killed, hit: x };
      },
      /** Damage after resistances, armor and attack stats; no side effects. */
      mitigate(target, x, by = x.by ? rt.entity(x.by) : null) {
        const h = target.components.health, t = x.type;
        const resist = (h.resist?.[t] ?? target.components.resist?.[t] ?? 0) + statOf(rt, target, `stat.${t}_resist`) + statOf(rt, target, 'stat.resist');
        const armor = (h.armor?.[t] ?? 0) + statOf(rt, target, `stat.def.${t}`) + statOf(rt, target, 'stat.def');
        let out = (x.amount || 0) * (x.mult ?? 1);
        if (by && !x.raw) { out *= 1 + statOf(rt, by, 'stat.damage'); for (const tag of x.tags || []) out *= 1 + statOf(rt, by, `stat.${tag}_damage`); }
        out *= 1 + statOf(rt, target, 'stat.vulnerable') * config.vulnerableBonus;
        for (const fn of hooks(rt).dmgMult) out *= fn(target, x, by, rt) ?? 1;
        out = out * (1 - Math.min(1, resist)) - Math.max(0, armor);
        if (resist >= 1) return 0;
        return round(Math.max(out, x.amount > 0 ? Math.min(config.minDamage, x.amount) : 0));
      },
      /** Knockback push away from the attacker (or along hit.dir). */
      push(target, x, by) {
        const k = (x.knockback ?? config.knockback) * (1 + (by ? statOf(rt, by, 'stat.knockback_out') : 0)) * Math.max(0, 1 - statOf(rt, target, 'stat.knockback_resist'));
        if (!(k > 0)) return;
        const pt = posOf(target), pb = posOf(by);
        const dir = x.dir ? norm(v3(x.dir)) : pt && pb ? norm(sub(pt, pb), [1, 0, 0]) : [1, 0, 0];
        const h = target.components.health;
        h.push = add(v3(h.push), mul(dir, k * (1 - PUSH_DECAY)));
        rt.emit('knockback', { who: target.id, by: x.by ?? null, amount: k, dir });
      },
      heal(target, amount, by = null) {
        init(target); const h = target?.components.health; if (!h || h.dead) return 0;
        const before = h.hp; h.hp = round(Math.min(maxOf(rt, target), h.hp + Math.max(0, amount)));
        if (h.hp > before) rt.emit('healed', { who: target.id, amount: round(h.hp - before), by });
        if (target.id === 'player') syncPlayer();
        return h.hp - before;
      },
      kill(target, { by = null, source = 'effect', type = null } = {}) {
        init(target); const h = target?.components.health; if (!h || h.dead || h.state === 'returning') return false;
        h.hp = 0; h.dead = true; h.invulnerable = 0; h.stun = 0; h.push = null; h.diedAt = rt.state.frame;
        const data = { id: target.id, who: target.id, by, source, type, archetype: target.archetype, at: target.at };
        rt.emitTyped('died', target.archetype, data);
        if (target.id !== 'player') rt.emitTyped('defeated', target.archetype, data);
        if (target.id === 'player') syncPlayer();
        api.afterDeath(target);
        return true;
      },
      revive(target, { frac = 1, at = null } = {}) {
        init(target); const h = target?.components.health; if (!h) return false;
        if (!h.dead && h.state !== 'returning') return false;
        if (at && rt.space(target.space).setPos) rt.space(target.space).setPos(target, at, rt);
        Object.assign(h, { dead: false, state: 'alive', hp: round(maxOf(rt, target) * frac), invulnerable: iframesOf(target) / FPS, stun: 0, push: null, despawnAt: null, respawnAt: null });
        if (target.components.moveTo?.combatHome) delete target.components.moveTo;
        rt.emitTyped('revived', target.archetype, { who: target.id });
        if (target.id === 'player') syncPlayer();
        return true;
      },
      afterDeath(e) {
        const h = e.components.health;
        if (h.splitOnDeath) split(e);
        if (e.id === 'player') { if (!rt.hasService('death') && config.playerDeath === 'lose') rt.run([{ do: 'end_game', outcome: 'lost' }]); return; }
        const rule = { ...config.respawn, ...(h.respawn || {}) };
        const mode = rule.mode ?? 'none', sec = rule.sec ?? config.respawn.sec;
        if (mode === 'home') {
          h.dead = false; h.state = 'returning'; h.respawnAt = rt.state.frame + Math.max(1, frames(sec));
          if (h.home) e.components.moveTo = { zone: null, at: h.home.slice(), run: true, combatHome: true };
          rt.emit('returning', { who: e.id, archetype: e.archetype, home: h.home ?? null });
        } else if (mode === 'spawn') h.respawnAt = rt.state.frame + frames(sec);
        else if (!config.corpse && !h.corpse) h.despawnAt = rt.state.frame;
        else if (config.corpseSec > 0) h.despawnAt = rt.state.frame + frames(config.corpseSec);
      },
    };
    const split = e => {
      const s = e.components.health.splitOnDeath, n = s.count ?? 2, into = s.into ?? e.archetype;
      if ((s.generation ?? 0) >= (s.maxGenerations ?? 8)) return;
      const base = v3(e.components.body?.vel), speed = (len(base) || s.speed || 1) * (s.speedMult ?? 1.35) + (s.speedAdd ?? 0);
      const heading = Math.atan2(base[1], base[0]);
      const ids = [];
      for (let i = 0; i < n; i++) {
        const spread = (s.spread ?? 60) * Math.PI / 180, a = heading + (n === 1 ? 0 : -spread / 2 + spread * i / (n - 1)) + (rt.random() - 0.5) * (s.jitter ?? 0.4);
        const child = rt.spawn(into, { space: e.space, at: Array.isArray(e.at) ? e.at.slice() : e.at });
        const b = (child.components.body ??= {});
        b.vel = like(Array.isArray(b.vel) ? b.vel : [0, 0], [Math.cos(a) * speed, Math.sin(a) * speed, 0]);
        if (into === e.archetype && child.components.health) child.components.health.splitOnDeath = { ...s, generation: (s.generation ?? 0) + 1 };
        ids.push(child.id);
      }
      rt.emit('split', { who: e.id, archetype: e.archetype, into, children: ids });
    };
    rt.provide('combat', api);

    // Physics impacts.
    if (config.impactDamage.enabled) for (const name of config.impactDamage.events) rt.on(name, d => {
      const sp = Math.abs(d.speed ?? 0) - config.impactDamage.minSpeed; if (!(sp > 0)) return;
      for (const id of [d.who, d.a, d.b].filter(Boolean)) { const e = rt.entity(id); if (e?.components.health) api.hit(e, { amount: sp * config.impactDamage.perSpeed, type: d.type ?? config.impactDamage.type, source: 'impact', noIframes: true }); }
    });

    rt.system('rules', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const h = e.components.health; if (!h) continue; init(e);
        if (h.invulnerable > 0) h.invulnerable = Math.max(0, Math.round((h.invulnerable - 1 / FPS) * 1e6) / 1e6);
        if (h.stun > 0) h.stun--;
        const max = maxOf(rt, e); if (h.hp > max) h.hp = round(max);
        if (!h.dead && h.state !== 'returning') {
          if (h.regenT > 0) h.regenT--;
          else if (h.regen && h.hp < max) h.hp = round(Math.min(max, h.hp + h.regen / 60));
        }
        if (h.state === 'returning' && (rt.state.frame >= h.respawnAt || (h.home && distance(rt, e, { at: h.home, space: e.space }) <= 0.5))) {
          if (h.home && distance(rt, e, { at: h.home, space: e.space }) > 0.5) rt.space(e.space).setPos?.(e, h.home.slice(), rt);
          api.revive(e);
        } else if (h.dead && h.respawnAt != null && rt.state.frame >= h.respawnAt) api.revive(e, { at: h.home ? h.home.slice() : null });
      }
      syncPlayer();
    }, KEY);
    // Knockback push and contact damage.
    rt.system('physics', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const h = e.components.health; if (!h?.push) continue;
        if (len(v3(h.push)) < 1e-3) { h.push = null; continue; }
        displace(rt, e, h.push); h.push = mul(v3(h.push), PUSH_DECAY).map(v => round(v));
      }
    }, KEY);
    // A stomp (components.touch.stomp): the toucher's body moves with the space gravity and its feet were, a frame ago,
    // above the middle of the stompable body (it fell onto it, not into its side).
    const stompsOn = (o, e, eb) => {
      const sp = rt.space(e.space), g = typeof sp?.gravityAt === 'function' ? v3(sp.gravityAt(posOf(e)) || []) : null;
      if (!g || !g.some(Boolean)) return false;
      const ax = g.reduce((m, v, i) => (Math.abs(v) > Math.abs(g[m]) ? i : m), 0), down = Math.sign(g[ax]);
      const v = o.components.body?.vel?.[ax] ?? 0;
      if (!(v * down > 0)) return false;
      const ob = boxOf(rt, o), feet = (down < 0 ? ob.min[ax] : ob.max[ax]) - v * rt.dt, mid = (eb.min[ax] + eb.max[ax]) / 2;
      return down < 0 ? feet >= mid : feet <= mid;
    };
    if (config.contact) rt.system('interaction', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const t = e.components.touch; if (!t || !tangible(e) || !e.space) continue;
        if (e.components.health.stun > 0 && e.components.health.stunKind === 'dazed') continue; // dazed bosses are harmless
        if (!(t.damage > 0) && !touchDefeats(rt, e)) continue;
        const bx = boxOf(rt, e), shape = { kind: 'aabb', at: bx.min, size: sub(bx.max, bx.min) };
        for (const id of overlapping(rt, e.space, shape, o => o.id !== e.id && o.components.health)) {
          const o = rt.entity(id); if (!o || !tangible(o) || !tangible(e)) continue;
          if (touchDefeats(rt, e)) {
            // Frightened or edible: whoever touches it defeats it (maze power pellets).
            if (hostile(rt, o, e, false) && o.id === 'player') api.kill(e, { by: o.id, source: 'contact' });
            continue;
          }
          if (!hostile(rt, e, o, config.friendlyFire)) continue;
          if (t.stomp && stompsOn(o, e, bx)) { api.kill(e, { by: o.id, source: 'stomp' }); rt.emit('stomped', { who: e.id, by: o.id }); break; }
          api.hit(o, { amount: t.damage, type: t.type, by: e.id, source: 'contact', knockback: t.knockback, dir: posOf(o) && posOf(e) ? sub(posOf(o), posOf(e)) : undefined });
        }
      }
    }, KEY);
    rt.system('late', rt => {
      for (const e of Object.values(rt.state.entities)) { const h = e.components.health; if (h?.dead && h.despawnAt != null && rt.state.frame >= h.despawnAt && e.id !== 'player') rt.despawn(e.id); }
    }, KEY);
  },
};

export function maxOf(rt, e) { const h = e?.components?.health; return h ? Math.max(1e-9, (h.max ?? 1) + statOf(rt, e, 'hp.max')) : 0; }
const isPos = at => Array.isArray(at) && at.every(Number.isFinite);
function cmp(value, p) {
  for (const k of ['gte', 'lte', 'gt', 'lt', 'eq', 'ne']) if (p[k] !== undefined) return k === 'gte' ? value >= p[k] : k === 'lte' ? value <= p[k] : k === 'gt' ? value > p[k] : k === 'lt' ? value < p[k] : k === 'eq' ? value === p[k] : value !== p[k];
  return value > 0;
}
export { teamOf };
export default health;
