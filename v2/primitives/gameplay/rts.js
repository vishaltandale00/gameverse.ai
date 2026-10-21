// gameplay.rts: real-time strategy over any space with positions (paths when
// the space can find them). Factions with resources; units and buildings are
// entities with components.rts:
//   { faction, speed (units/s), sight, worker?, carry?, gatherRate?, dropoff?,
//     attack?: {range, cooldown s, effects}, produces?: [{archetype, cost, time}],
//     builds?: [{archetype, cost, time}], node?: {resource, amount}, supply?, supplyCap? }
// Selection (ids, box, archetype), orders (move, attack, attack-move, gather,
// build, stop, hold, patrol) with queueing, worker gather/return loops,
// production queues with rally points, construction, supply caps, automatic
// target acquisition, fog of war through the space's line of sight, a simple
// opponent AI, and faction defeat/victory.
import { alive, matchesAny, sortedEntities, has, spaceOf, dist, err, runBound, r6, r6v, v3, sub, len, cellKey } from './modes-lib-util.js';

const ID = 'gameplay.rts';
const ORDERS = ['move', 'attack', 'attack_move', 'gather', 'build', 'stop', 'hold', 'patrol'];

export default {
  id: ID,
  card: {
    loop: { verbs: ['select', 'order', 'produce', 'rally'], progress: ['unit_produced', 'gathered', 'building_complete', 'unit_attack'] },
    // RTS mode: the player's faction against AI factions; won when only the player's faction stands.
    mode: { loop: 'rts', interaction: 'cursor-board', opponent: 'ai-side', space: ['engine.space.grid', 'engine.space.tilemap', ['position']], needs: { content: ['content.archetypes'], participants: 'factions' }, win: { param: 'onVictory', reads: { event: 'faction_defeated', by: { actions: ['order', 'produce'] } } }, lose: { param: 'onDefeat', reads: { event: 'faction_defeated', by: { actions: ['order', 'produce'] } } }, bot: 'turn-board' },
    intent: 'Real-time strategy: factions and resources, unit selection and orders (move, attack, attack-move, gather, build, stop, hold, patrol, queued), worker gathering loops, production queues with rally points and supply, construction, auto-targeting, fog of war over line of sight, a simple AI opponent, and faction defeat.',
    views: ['td', 'iso'],
    params: {
      factions: { type: 'list', min: 1, default: [{ id: 'player', control: 'player', start: {} }], of: { type: 'object', fields: { id: { type: 'string', required: true }, control: { type: 'string', options: ['player', 'ai', 'external'], default: 'ai' }, start: { type: 'object', open: true, default: {} } } } },
      resources: { type: 'list', of: { type: 'string' }, default: ['minerals'], min: 1 },
      fog: { type: 'boolean', default: true, effect: 'track visible and explored cells per faction (needs los or distance)' },
      sight: { type: 'number', default: 6, min: 0, max: 1000, effect: 'default sight radius' },
      fogEvery: { type: 'integer', default: 15, min: 1, max: 600, unit: 'frames' },
      selectionMax: { type: 'integer', default: 24, min: 1, max: 500 },
      repathEvery: { type: 'integer', default: 30, min: 1, max: 600, unit: 'frames' },
      supply: { type: 'boolean', default: false, effect: 'units cost supply; buildings with supplyCap raise the cap' },
      gatherRange: { type: 'number', default: 1.5, min: 0, max: 100 },
      ai: { type: 'object', default: { attackAt: 6, workers: 6 }, fields: { attackAt: { type: 'integer', default: 6, min: 1, max: 500, effect: 'army size before attacking' }, workers: { type: 'integer', default: 6, min: 0, max: 200 } } },
      onVictory: { type: 'effects', default: [] }, onDefeat: { type: 'effects', default: [] },
    },
    provides: {
      events: ['selected', 'order_given', 'unit_attack', 'unit_produced', 'unit_produced:*', 'production_queued', 'building_complete', 'building_complete:*', 'gathered', 'deposited', 'node_depleted', 'faction_defeated', 'rts_invalid', 'spotted'],
      vars: ['rts.*', 'rts.selected'],
      services: ['rts'],
      actions: ['select', 'order', 'produce', 'rally'],
    },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  logic(logic) {
    logic.predicate('rts_visible', {
      test: (p, rt, c) => { const svc = rt.service('rts'); const e = p.who ? rt.resolve(p.who, c) : null; return svc.visible(p.faction ?? 'player', e ? e.at : p.at, e?.space); },
    });
    logic.effect('give_resource', { check: (e, path, errors) => { if (!e.resource) errors.push(err('effect_invalid', path, 'give_resource needs resource')); }, run: (e, rt) => rt.service('rts').give(e.faction ?? 'player', e.resource, e.amount ?? 1) });
    logic.effect('rts_order', { run: (e, rt, c) => { const u = rt.resolve(e.who, c); if (u) rt.service('rts').order([u.id], e.order ?? { kind: 'stop' }); } });
  },
  validate(config, doc) {
    const errors = [], ids = new Set(config.factions.map(f => f.id));
    (doc.content?.archetypes || []).forEach((a, i) => {
      const r = a.components?.rts; if (!r) return;
      const path = `content.archetypes[${i}].components.rts`;
      if (r.faction && !ids.has(r.faction)) errors.push(err('rts_faction', `${path}.faction`, `unknown faction '${r.faction}'`, [...ids].join(', ')));
      for (const k of ['produces', 'builds']) (r[k] || []).forEach((p, j) => {
        if (!(doc.content.archetypes || []).some(x => x.id === p.archetype)) errors.push(err('ref_unknown', `${path}.${k}[${j}].archetype`, `unknown archetype '${p.archetype}'`));
        for (const res of Object.keys(p.cost || {})) if (!config.resources.includes(res)) errors.push(err('rts_resource', `${path}.${k}[${j}].cost.${res}`, `unknown resource '${res}'`, config.resources.join(', ')));
      });
      if (r.node && !config.resources.includes(r.node.resource)) errors.push(err('rts_resource', `${path}.node.resource`, `unknown resource '${r.node.resource}'`));
      if (r.attack && !(r.attack.range > 0)) errors.push(err('rts_unit', `${path}.attack.range`, 'attack needs range > 0'));
    });
    config.factions.forEach((f, i) => { for (const r of Object.keys(f.start)) if (!config.resources.includes(r)) errors.push(err('rts_resource', `with.factions[${i}].start.${r}`, `unknown resource '${r}'`)); });
    return errors;
  },
  /**
   * Solver progress for the player's faction: enemy factions defeated (10 each), enemy units
   * removed or worn down, own units standing (0.5 each), banked resources (0.001 each).
   */
  progress(rt, config) {
    const s = rt.state.prim[ID], mine = config.factions.find(f => f.control === 'player')?.id; if (!s?.res || !mine) return 0;
    const fac = e => e.components.rts?.faction ?? (e.id === 'player' ? config.factions[0].id : null);
    let v = 0;
    for (const e of Object.values(rt.state.entities)) {
      const r = e.components.rts; if (!r || r.node || !alive(e)) continue;
      const f = fac(e), h = e.components.health, frac = h?.max ? (h.hp ?? h.max) / h.max : 1;
      if (f === mine) v += 0.5; else if (f) v -= frac;
    }
    for (const f of config.factions) if (f.id !== mine && s.defeated?.[f.id]) v += 10;
    for (const n of Object.values(s.res[mine] || {})) v += 0.001 * n;
    return v;
  },
  install(rt, config) {
    const FAC = new Map(config.factions.map(f => [f.id, f])), F = s => Math.max(1, Math.round(s * 60));
    const st = () => {
      const s = rt.store(ID);
      if (!s.res) { s.res = Object.fromEntries(config.factions.map(f => [f.id, Object.fromEntries(config.resources.map(r => [r, f.start[r] ?? 0]))])); s.orders = {}; s.sel = []; s.queue = {}; s.fog = {}; s.cd = {}; s.carry = {}; s.nodes = {}; s.rally = {}; s.defeated = {}; s.built = {}; }
      return s;
    };
    const R = e => e?.components.rts;
    const factionOf = e => R(e)?.faction ?? (e?.id === 'player' ? config.factions[0].id : null);
    // Per-step memo of live units (invalidated by spawns/despawns within the step).
    let memo = { key: null, all: [] };
    const units = (fac = null) => {
      const ents = rt.state.entities, key = `${rt.state.frame}:${rt.state.nextId}:${Object.keys(ents).length}`;
      // Keyed on the entities object too: after restore() the same frame/id counters can name different entity objects.
      if (memo.key !== key || memo.ents !== ents) memo = { key, ents, all: sortedEntities(rt).filter(e => R(e) && !R(e).node) };
      return memo.all.filter(e => ents[e.id] === e && alive(e) && (!fac || factionOf(e) === fac));
    };
    const isBuilding = e => Boolean(R(e)?.produces || R(e)?.dropoff || R(e)?.supplyCap || R(e)?.building);
    const api = e => spaceOf(rt, e);
    const sightOf = e => R(e)?.sight ?? config.sight;
    const supplyUsed = fac => units(fac).reduce((t, e) => t + (R(e).supply ?? (isBuilding(e) ? 0 : 1)), 0);
    const supplyCap = fac => units(fac).reduce((t, e) => t + (R(e).supplyCap ?? 0), 0);
    const afford = (s, fac, cost = {}) => Object.entries(cost).every(([r, n]) => (s.res[fac]?.[r] ?? 0) >= n);
    const pay = (s, fac, cost = {}) => { for (const [r, n] of Object.entries(cost)) s.res[fac][r] -= n; };
    const invalid = (who, reason) => { rt.emit('rts_invalid', { who, reason }); return false; };

    // ----- visibility -----
    function visible(fac, at, space) {
      if (!at) return false;
      for (const u of units(fac)) {
        if (space && u.space !== space) continue;
        const a = api(u), d = has(a, 'distance') ? a.distance(u.at, at) : len(sub(v3(u.at), v3(at)));
        if (d > sightOf(u)) continue;
        if (!has(a, 'los') || a.los(u.at, at).clear) return true;
      }
      return false;
    }
    // Visible cells per unit are cached (derived data) and recomputed only when the unit changes cell.
    const visCache = () => (rt.caches[`${ID}:vis`] ??= new Map());
    rt.onRestore(() => visCache().clear());
    function cellsSeenBy(u) {
      const a = api(u), k = `${u.space}|${cellKey(u.at)}|${sightOf(u)}`, c = visCache().get(u.id);
      if (c?.k === k) return c.cells;
      const cells = (has(a, 'visibleFrom') ? a.visibleFrom(u.at, Math.floor(sightOf(u))) : has(a, 'cellsInRange') ? a.cellsInRange(u.at, Math.floor(sightOf(u))) : []).map(cellKey);
      visCache().set(u.id, { k, cells }); return cells;
    }
    function updateFog(s) {
      for (const f of config.factions) {
        const fog = (s.fog[f.id] ??= { seen: {} }), vis = new Set();
        for (const u of units(f.id)) { if (!Array.isArray(u.at)) continue; for (const k of cellsSeenBy(u)) { vis.add(k); fog.seen[k] = 1; } }
        fog.visible = vis.size;
        for (const e of units()) if (factionOf(e) && factionOf(e) !== f.id && !(fog.spotted ??= {})[e.id] && (vis.size ? vis.has(cellKey(e.at)) : visible(f.id, e.at, e.space))) { fog.spotted[e.id] = 1; rt.emit('spotted', { faction: f.id, who: e.id }); }
      }
    }

    // ----- orders -----
    function order(s, ids, o) {
      if (!ORDERS.includes(o.kind)) return invalid(ids[0], 'bad_order');
      for (const id of ids) {
        const e = rt.entity(id); if (!R(e) || R(e).node) continue;
        if (o.kind === 'gather' && !R(e).worker) continue;
        if (o.kind === 'build') {
          const b = (R(e).builds || []).find(x => x.archetype === o.archetype); if (!b) { invalid(id, 'cannot_build'); continue; }
          if (!afford(s, factionOf(e), b.cost)) { invalid(id, 'resources'); continue; }
          pay(s, factionOf(e), b.cost);
        }
        const next = { ...o, path: null, i: 0, acc: 0, t: 0, from: o.kind === 'patrol' ? structuredClone(e.at) : undefined };
        if (o.queue && s.orders[id] && s.orders[id].kind !== 'stop') (s.orders[id].then ??= []).push(next);
        else s.orders[id] = next;
      }
      rt.emit('order_given', { who: ids.slice(0, 8), order: o.kind });
      return true;
    }
    function pathTo(e, at) {
      const a = api(e);
      if (has(a, 'path')) { const p = a.path(e.at, at); if (p) return cellKey(p[0]) === cellKey(e.at) ? p.slice(1) : p; return null; }
      return [at];
    }
    /** Advance along o.path; returns true when the destination is reached. */
    function walk(s, e, o, dest) {
      if (!o.path || (rt.state.frame % config.repathEvery === 0 && o.i > 0)) { o.path = pathTo(e, dest); o.i = 0; if (!o.path) return true; }
      const a = api(e), discrete = a.anchor === 'cell' || a.anchor === 'slot';
      let budget = (R(e).speed ?? 3) * rt.dt + o.acc;
      while (o.i < o.path.length) {
        const target = o.path[o.i], step = discrete ? 1 : len(sub(v3(target), v3(e.at)));
        if (budget + 1e-9 >= step) {
          if (discrete && has(a, 'entitiesAt') && a.entitiesAt(target).some(x => x !== e.id && R(rt.entity(x)) && o.i === o.path.length - 1)) { o.i = o.path.length; break; }
          a.setPos(e, structuredClone(target), rt); budget -= step; o.i++;
        } else {
          if (!discrete && step > 0) { const d = sub(v3(target), v3(e.at)), k = budget / step; a.setPos(e, r6v(v3(e.at).map((x, j) => x + d[j] * k)).slice(0, e.at.length), rt); budget = 0; }
          break;
        }
      }
      o.acc = discrete ? r6(budget) : 0;
      return o.i >= o.path.length;
    }
    const near = (a, b, r) => dist(rt, a, b) <= r + 1e-9;
    function strike(s, e, t) {
      const atk = R(e).attack; if (!atk) return;
      if ((s.cd[e.id] ?? 0) > 0) return;
      s.cd[e.id] = F(atk.cooldown ?? 1);
      rt.emit('unit_attack', { who: e.id, target: t.id });
      runBound(rt, atk.effects || [], { actor: e.id, target: t.id });
    }
    function nearestEnemy(e, range) {
      let best = null, bd = Infinity;
      for (const o of units()) {
        if (factionOf(o) === factionOf(e) || !factionOf(o) || o.space !== e.space) continue;
        const d = dist(rt, e, o); if (d <= range && d < bd && visible(factionOf(e), o.at, o.space)) { bd = d; best = o; }
      }
      return best;
    }
    const nearestOf = (e, pred) => { let best = null, bd = Infinity; for (const o of sortedEntities(rt)) if (o !== e && o.space === e.space && pred(o)) { const d = dist(rt, e, o); if (d < bd) { bd = d; best = o; } } return best; };
    function finish(s, id) { const o = s.orders[id]; const next = o?.then?.shift(); if (next) { next.then = o.then; s.orders[id] = next; } else delete s.orders[id]; }

    function stepUnit(s, e) {
      const o = s.orders[e.id], atk = R(e).attack;
      if (s.cd[e.id] > 0) s.cd[e.id]--;
      if (!o) { // idle: auto-acquire in range
        if (atk && !isBuilding(e)) { const t = nearestEnemy(e, Math.max(atk.range, Math.min(sightOf(e), atk.range * 2))); if (t) { if (near(e, t, atk.range)) strike(s, e, t); else s.orders[e.id] = { kind: 'attack', target: t.id, auto: true, path: null, i: 0, acc: 0 }; } }
        else if (atk && isBuilding(e)) { const t = nearestEnemy(e, atk.range); if (t) strike(s, e, t); }
        return;
      }
      switch (o.kind) {
        case 'stop': delete s.orders[e.id]; break;
        case 'hold': if (atk) { const t = nearestEnemy(e, atk.range); if (t) strike(s, e, t); } break;
        case 'move': if (walk(s, e, o, o.at)) finish(s, e.id); break;
        case 'patrol': if (walk(s, e, o, o.at)) { const back = o.from; o.from = structuredClone(o.at); o.at = back; o.path = null; } if (atk) { const t = nearestEnemy(e, atk.range); if (t) strike(s, e, t); } break;
        case 'attack': {
          const t = rt.entity(o.target);
          if (!t || !alive(t)) { finish(s, e.id); break; }
          if (atk && near(e, t, atk.range)) strike(s, e, t);
          else if (!isBuilding(e)) { if (o.lastAt !== cellKey(v3(t.at)) && (o.repath ?? 0) <= rt.state.frame) { o.path = null; o.lastAt = cellKey(v3(t.at)); o.repath = rt.state.frame + 10; } walk(s, e, o, t.at); }
          break;
        }
        case 'attack_move': {
          const t = atk ? nearestEnemy(e, sightOf(e)) : null;
          if (t) {
            if (near(e, t, atk.range)) strike(s, e, t);
            else { const fresh = !o.chase || o.chase.target !== t.id || (o.chase.cell !== cellKey(v3(t.at)) && o.chase.until <= rt.state.frame); const ch = fresh ? (o.chase = { target: t.id, cell: cellKey(v3(t.at)), until: rt.state.frame + 10, path: null, i: 0, acc: 0 }) : o.chase; walk(s, e, ch, t.at); }
          }
          else if (walk(s, e, o, o.at)) finish(s, e.id);
          break;
        }
        case 'gather': gather(s, e, o); break;
        case 'build': {
          if (!near(e, { ...e, at: o.at }, config.gatherRange + 0.5) && !o.arrived) { if (walk(s, e, o, o.at)) o.arrived = true; break; }
          o.arrived = true;
          const b = (R(e).builds || []).find(x => x.archetype === o.archetype);
          if (++o.t >= F(b.time ?? 5)) {
            const spot = has(api(e), 'entitiesAt') && api(e).entitiesAt(o.at).includes(e.id) ? null : o.at;
            const nb = rt.spawn(o.archetype, { space: e.space, at: structuredClone(spot ?? o.at), components: { rts: { ...(rt.archetype(o.archetype)?.components?.rts || {}), faction: factionOf(e) } } });
            rt.emitTyped('building_complete', o.archetype, { who: nb.id, by: e.id, faction: factionOf(e) });
            finish(s, e.id);
          }
          break;
        }
      }
    }
    function gather(s, e, o) {
      const c = (s.carry[e.id] ??= { res: null, n: 0 }), cap = R(e).carry ?? 5;
      if (o.phase === 'return' || c.n >= cap) {
        o.phase = 'return';
        const drop = nearestOf(e, x => R(x)?.dropoff && factionOf(x) === factionOf(e) && alive(x));
        if (!drop) { finish(s, e.id); return; }
        if (near(e, drop, config.gatherRange)) {
          if (c.n > 0) { s.res[factionOf(e)][c.res] = r6((s.res[factionOf(e)][c.res] ?? 0) + c.n); rt.emit('deposited', { who: e.id, resource: c.res, amount: c.n, faction: factionOf(e) }); }
          c.n = 0; o.phase = 'go'; o.path = null; return;
        }
        if (o.dest !== drop.id) { o.dest = drop.id; o.path = null; }
        walk(s, e, o, drop.at); return;
      }
      let node = rt.entity(o.node);
      if (!node || (s.nodes[node.id] ?? R(node).node.amount) <= 0) {
        node = nearestOf(e, x => R(x)?.node && (!c.res || R(x).node.resource === c.res) && (s.nodes[x.id] ?? R(x).node.amount) > 0);
        if (!node) { if (c.n > 0) o.phase = 'return'; else finish(s, e.id); return; }
        o.node = node.id; o.path = null;
      }
      if (near(e, node, config.gatherRange)) {
        const left = s.nodes[node.id] ?? R(node).node.amount, take = Math.min(left, (R(e).gatherRate ?? 1) * rt.dt, cap - c.n);
        c.res = R(node).node.resource; c.n = r6(c.n + take); s.nodes[node.id] = r6(left - take);
        if (s.nodes[node.id] <= 0) { rt.emit('node_depleted', { who: node.id, resource: c.res }); rt.despawn(node.id); }
        if (c.n >= cap - 1e-9) { rt.emit('gathered', { who: e.id, resource: c.res, amount: c.n }); o.phase = 'return'; o.path = null; }
        return;
      }
      if (o.dest !== node.id) { o.dest = node.id; o.path = null; }
      walk(s, e, o, node.at);
    }
    function produce(s, bid, archetype) {
      const b = rt.entity(bid), spec = (R(b)?.produces || []).find(p => p.archetype === archetype);
      if (!spec || !alive(b)) return invalid(bid, 'cannot_produce');
      const fac = factionOf(b);
      if (!afford(s, fac, spec.cost)) return invalid(bid, 'resources');
      const need = rt.archetype(archetype)?.components?.rts?.supply ?? 1;
      if (config.supply && supplyUsed(fac) + need + (s.queue[bid]?.length ?? 0) > supplyCap(fac)) return invalid(bid, 'supply');
      pay(s, fac, spec.cost);
      (s.queue[bid] ??= []).push({ archetype, t: 0, time: F(spec.time ?? 5) });
      rt.emit('production_queued', { who: bid, archetype, faction: fac });
      return true;
    }
    function stepProduction(s) {
      for (const [bid, q] of Object.entries(s.queue)) {
        const b = rt.entity(bid); if (!b || !alive(b)) { delete s.queue[bid]; continue; }
        if (!q.length) continue;
        const item = q[0]; if (++item.t < item.time) continue;
        q.shift();
        const a = api(b), offsets = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
        let at = null;
        for (const [dx, dy] of offsets) {
          const p = structuredClone(b.at); if (!Array.isArray(p)) break; p[0] += dx; if (p.length === 3 && has(a, 'groundAt')) p[2] += dy; else p[1] += dy;
          if (!has(a, 'entitiesAt') || !a.entitiesAt(p).length) { at = p; break; }
        }
        const u = rt.spawn(item.archetype, { space: b.space, at: at ?? structuredClone(b.at), components: { rts: { ...(rt.archetype(item.archetype)?.components?.rts || {}), faction: factionOf(b) } } });
        rt.emitTyped('unit_produced', item.archetype, { who: u.id, by: bid, faction: factionOf(b) });
        if (s.rally[bid]) s.orders[u.id] = { kind: R(u).worker && s.rally[bid].node ? 'gather' : 'move', at: s.rally[bid].at, node: s.rally[bid].node, path: null, i: 0, acc: 0 };
      }
    }
    // Opponent AI: keep workers gathering, keep producing, attack when the army is big enough.
    function stepAI(s, fac) {
      if (rt.state.frame % 30 !== 0) return;
      const mine = units(fac);
      for (const w of mine.filter(e => R(e).worker && !s.orders[e.id])) order(s, [w.id], { kind: 'gather' });
      const workers = mine.filter(e => R(e).worker).length;
      for (const b of mine.filter(e => R(e).produces?.length && !(s.queue[e.id]?.length))) {
        const choice = R(b).produces.find(p => (rt.archetype(p.archetype)?.components?.rts?.worker ? workers < config.ai.workers : true) && afford(s, fac, p.cost));
        if (choice) produce(s, b.id, choice.archetype);
      }
      const army = mine.filter(e => R(e).attack && !R(e).worker && !isBuilding(e));
      if (army.length >= config.ai.attackAt) {
        const target = units().find(e => factionOf(e) && factionOf(e) !== fac);
        if (target) order(s, army.filter(e => !s.orders[e.id]).map(e => e.id), { kind: 'attack_move', at: structuredClone(target.at) });
      }
    }
    function checkDefeat(s) {
      for (const f of config.factions) {
        if (s.defeated[f.id]) continue;
        const has = units(f.id).length;
        if (has) s.seen = { ...(s.seen || {}), [f.id]: true };
        else if (s.seen?.[f.id]) {
          s.defeated[f.id] = true; rt.emit('faction_defeated', { faction: f.id });
          if (f.control === 'player') runBound(rt, config.onDefeat, {});
          const left = config.factions.filter(x => !s.defeated[x.id] && s.seen?.[x.id]);
          if (left.length === 1 && left[0].control === 'player') runBound(rt, config.onVictory, {});
        }
      }
    }

    const playerFaction = () => config.factions.find(f => f.control === 'player')?.id ?? null;
    const service = {
      order: (ids, o) => order(st(), ids, o), produce: (b, a) => produce(st(), b, a), give: (f, r, n) => { const s = st(); if (s.res[f]) s.res[f][r] = (s.res[f][r] ?? 0) + n; },
      visible: (f, at, space) => visible(f, at, space), resources: f => ({ ...st().res[f] }), selection: () => st().sel.slice(),
      explored: (f, at) => Boolean(st().fog[f]?.seen?.[cellKey(at)]),
    };
    rt.provide('rts', service);
    rt.action('select', v => {
      const s = st(), fac = playerFaction();
      let ids;
      if (Array.isArray(v)) ids = v; else if (typeof v === 'string') ids = [v];
      else if (v?.box) { const [a, b] = v.box.map(v3); ids = units(fac).filter(e => Array.isArray(e.at) && v3(e.at).every((x, i) => x >= Math.min(a[i], b[i]) && x <= Math.max(a[i], b[i]))).map(e => e.id); }
      else if (v?.archetype) ids = units(fac).filter(e => matchesAny(e, [v.archetype])).map(e => e.id);
      else ids = [];
      s.sel = ids.filter(id => factionOf(rt.entity(id)) === fac && R(rt.entity(id))).slice(0, config.selectionMax);
      rt.emit('selected', { ids: s.sel.slice() });
    });
    rt.action('order', v => { const s = st(); const ids = v.who ? [].concat(v.who) : s.sel; order(s, ids.filter(id => factionOf(rt.entity(id)) === playerFaction()), v); });
    rt.action('produce', v => { const s = st(); const b = rt.entity(v.building); if (factionOf(b) === playerFaction()) produce(s, v.building, v.archetype); });
    rt.action('rally', v => { const s = st(); if (factionOf(rt.entity(v.building)) === playerFaction()) s.rally[v.building] = { at: v.at, node: v.node }; });

    rt.system('ai', rt => { const s = st(); for (const f of config.factions) if (f.control === 'ai' && !s.defeated[f.id]) stepAI(s, f.id); }, ID);
    rt.system('movement', rt => { const s = st(); for (const e of units()) stepUnit(s, e); stepProduction(s); }, ID);
    rt.system('rules', rt => {
      const s = st();
      if (config.fog && rt.state.frame % config.fogEvery === 0) updateFog(s);
      checkDefeat(s);
      for (const f of config.factions) { for (const r of config.resources) rt.state.vars[`rts.${f.id}.${r}`] = r6(s.res[f.id][r]); rt.state.vars[`rts.${f.id}.units`] = units(f.id).length; if (config.supply) { rt.state.vars[`rts.${f.id}.supply`] = supplyUsed(f.id); rt.state.vars[`rts.${f.id}.supplyCap`] = supplyCap(f.id); } }
      s.sel = s.sel.filter(id => alive(rt.entity(id))); rt.state.vars['rts.selected'] = s.sel.length;
    }, ID);

    rt.options(rt => {
      const s = st(), fac = playerFaction(); if (!fac) return [];
      const out = [], mine = units(fac);
      const idle = mine.filter(e => R(e).worker && !s.orders[e.id]);
      if (idle.length) out.push({ label: `rts gather ${idle.length} idle`, actions: { order: { kind: 'gather', who: idle.map(e => e.id) } } });
      for (const b of mine) for (const p of R(b).produces || []) if (afford(s, fac, p.cost)) out.push({ label: `rts ${b.id} produce ${p.archetype}`, actions: { produce: { building: b.id, archetype: p.archetype } } });
      const army = mine.filter(e => R(e).attack && !R(e).worker && !isBuilding(e) && !s.orders[e.id]);
      const target = units().find(e => factionOf(e) && factionOf(e) !== fac && visible(fac, e.at, e.space));
      if (army.length && target) out.push({ label: `rts attack ${target.id}`, actions: { order: { kind: 'attack_move', at: structuredClone(target.at), who: army.map(e => e.id) } } });
      else if (army.length && config.fog && Array.isArray(army[0].at) && Array.isArray(api(army[0])?.size)) {
        // No enemy in sight: scout (attack-move) toward the nearest unexplored point of a 3x3 lattice over the space.
        const size = api(army[0]).size, at0 = army[0].at, pts = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push(at0.map((v, k) => (k < 2 ? Math.floor((size[k] * ((k ? j : i) + 0.5)) / 3) : v)));
        const c = army.reduce((m, e) => m.map((x, k) => x + v3(e.at)[k] / army.length), [0, 0, 0]);
        const open = pts.filter(p => !service.explored(fac, p)).sort((a, b) => len(sub(v3(a), c)) - len(sub(v3(b), c)) || cellKey(a).localeCompare(cellKey(b)));
        if (open[0]) out.push({ label: `rts scout ${cellKey(open[0])}`, actions: { order: { kind: 'attack_move', at: open[0], who: army.map(e => e.id) } } });
      }
      return out;
    });
  },
};
