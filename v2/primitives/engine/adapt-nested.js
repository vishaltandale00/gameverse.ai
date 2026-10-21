// engine.adapt.nested: a nested encounter adapter (ARCHITECTURE.md §1.3). An event in the outer loop starts
// another loop, in a sub-space or overlay, and its outcome comes back to the outer loop as effects: a chess
// capture decided by a creature battle, touching an enemy on the overworld starting a turn battle, a door that
// starts a race. The inner loop is any primitive of the document whose loop can be started by effects
// (start_battle, start_minigame, start_race, start_turns...); this adapter only wires it:
//  - trigger: `on` (an outer event) and `when` (a predicate with the roles bound);
//  - roles: participant ids read from the trigger event's data (`roles: {attacker: 'attacker'}`), usable as
//    '$attacker' anywhere in effects and predicates (who-like fields also take the bare role name);
//  - start: the effects that start the inner loop; `fill` writes participant data into them (the defender's
//    skinned species into start_battle's foe) with an optional value map;
//  - carry: participants moved into the inner space (`space`) and back afterwards;
//  - hold: while inside, the outer loop is held: the systems of its primitives (hold, default every other mode
//    primitive in the document) are skipped (rt.hold), the outer world's entities are restored after every step
//    (freeze: whatever else moves them), and a modal admits only the inner loop's verbs (its cards'
//    provides.actions, or `verbs`);
//  - outcomes: the first inner event (`on`, with optional `when`) that matches ends the encounter and runs its
//    outer effects (`do`), e.g. battle_end:win -> kill '$defender', battle_end:lose -> kill '$attacker';
//  - fates: what an outcome means for each participant, from the inner loop's declaration (card.loop.outcome): each
//    inner side ('player': the side the player plays, 'opponent': the other) keeps its place or is defeated. A role is
//    on the player's side when it is the player, or a member of the outer loop's player groups (`player`: the
//    component field holding a participant's group and the groups the player controls); every other role is the
//    opponent's. With fates, `do` runs once for each defeated participant ('$loser', with '$winner' the first one
//    that keeps its place), and `take` moves the winner into the place of the participant it defeated.
import { bindRoles, runBound, err, sortedEntities } from '../gameplay/modes-lib-util.js';

const ID = 'engine.adapt.nested';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FATES = ['keeps', 'defeated'];
const getPath = (obj, path) => String(path).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
/** Write value at a dotted path ('0.foe.0.species') of a JSON tree; false when the path does not exist. */
function setPath(obj, path, value) {
  const keys = String(path).split('.').filter(Boolean); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o == null || typeof o !== 'object' || !(keys[i] in o)) return false; o = o[keys[i]]; }
  if (o == null || typeof o !== 'object' || !keys.length) return false;
  o[keys[keys.length - 1]] = value; return true;
}

export default {
  id: ID,
  card: {
    intent: 'Nested encounter adapter: an outer event (a capture, touching an enemy, entering a door) starts another loop (a creature battle, a turn battle, a race, a minigame) in a sub-space or overlay with the participants carried in; the outer loop is held meanwhile, and the inner outcome comes back as outer effects.',
    views: ['any'],
    params: {
      id: { type: 'string', default: 'nested', effect: 'encounter id (events nested_start:<id> / nested_end:<id>)' },
      on: { type: 'string', required: true, effect: 'outer event that triggers the encounter' },
      when: { type: 'predicate', effect: 'trigger only when this holds (roles bound: $attacker...)' },
      roles: { type: 'object', open: true, default: {}, effect: "role -> trigger event data field holding an entity id ('player' for the player); default: every data field naming an entity" },
      inner: { type: 'list', of: { type: 'string' }, min: 1, required: true, effect: 'primitive ids of the inner loop (in this document)' },
      space: { type: 'ref', to: 'space', effect: 'inner sub-space carried participants move into' },
      carry: { type: 'list', default: [], of: { type: 'object', fields: { role: { type: 'string', required: true }, at: { type: 'json' }, zone: { type: 'ref', to: 'zone' }, back: { type: 'boolean', default: true } } }, effect: 'participants moved into the inner space and (back) returned afterwards' },
      start: { type: 'effects', default: [], effect: 'effects that start the inner loop (roles bound)' },
      fill: { type: 'list', default: [], of: { type: 'object', fields: {
        path: { type: 'string', required: true, effect: "where in start to write, e.g. '0.foe.0.species'" },
        role: { type: 'string', required: true }, field: { type: 'string', required: true, effect: "dotted entity path, e.g. 'archetype' or 'components.skin.id'" },
        map: { type: 'object', open: true, default: {}, effect: 'value -> value written (unmapped values are written as read)' },
      } }, effect: "participant data written into the start effects (the defender's species into the foe)" },
      outcomes: { type: 'list', min: 1, required: true, of: { type: 'object', fields: {
        on: { type: 'string', required: true, effect: 'inner event that ends the encounter' }, when: { type: 'predicate' },
        result: { type: 'string', default: 'done' }, do: { type: 'effects', default: [], effect: 'outer effects (roles bound; with fates, once per defeated participant as $loser)' },
        fates: { type: 'object', fields: { player: { type: 'string', options: FATES }, opponent: { type: 'string', options: FATES } }, effect: "each inner side's fate for this result (the inner card's card.loop.outcome)" },
      } }, effect: 'inner outcome -> outer effects; the first match ends the encounter' },
      player: { type: 'object', fields: { component: { type: 'string', required: true }, field: { type: 'string', required: true }, is: { type: 'list', of: { type: 'string' }, default: [] } },
        effect: "the outer participants on the player's side: entities whose components[component][field] is one of `is` (the player always is)" },
      take: { type: 'boolean', default: false, effect: 'the winner takes the place of the participant it defeated in the outer space' },
      hold: { type: 'list', of: { type: 'string' }, default: [], effect: 'outer primitives whose systems are held while inside (default: every other mode primitive in the document)' },
      freeze: { type: 'boolean', default: true, effect: 'hold outer entities too (those not carried and not in the inner space)' },
      modal: { type: 'boolean', default: true, effect: 'while inside, only the inner loop verbs are accepted' },
      verbs: { type: 'list', of: { type: 'string' }, default: [], effect: "inner verbs (default: the inner cards' provides.actions)" },
      onStart: { type: 'effects', default: [] }, onEnd: { type: 'effects', default: [] },
    },
    provides: { events: ['nested_start', 'nested_start:*', 'nested_end', 'nested_end:*'], vars: ['nested.active'] },
    requires: {},
    adapts: {
      provides: { capabilities: [], content: [], services: [] },
      from: {},
      projection: 'an outer event starts an inner loop with its participants carried in; the outer loop is held; the inner outcome maps back to outer effects',
      relation: 'nested',
    },
  },
  logic(logic) {
    // { nested: id, active?: bool } or { nested: id, result: 'won' }: inside the encounter, or how it last ended.
    logic.predicate('nested', { test: (p, rt) => { const s = rt.state.prim[`${ID}:${typeof p.nested === 'string' ? p.nested : 'nested'}`]; return typeof p.result === 'string' ? s?.last === p.result : Boolean(s?.active) === (p.active !== false); } });
  },
  validate(config, doc, ctx, inst) {
    const errors = [], used = new Set([...(doc.systems || []), ...(doc.graphics || [])].map(s => s?.use));
    if (!SLUG.test(config.id || '')) errors.push(err('nested_id', 'with.id', 'id must be a lowercase slug'));
    config.inner.forEach((id, i) => {
      if (!ctx.registry.get(id)) errors.push(err('nested_inner_unknown', `with.inner[${i}]`, `'${id}' is not a registered primitive`));
      else if (!used.has(id)) errors.push(err('nested_inner_unknown', `with.inner[${i}]`, `'${id}' is not in this document`, `add { "use": "${id}" } to systems (the inner loop must not start by itself)`));
    });
    const roles = Object.keys(config.roles || {});
    const roleOk = r => !roles.length || roles.includes(r) || r === 'player';
    config.carry.forEach((c, i) => {
      if (!config.space) errors.push(err('nested_space', `with.carry[${i}]`, 'carrying participants needs the inner space (with.space)'));
      if (!roleOk(c.role)) errors.push(err('nested_role_unknown', `with.carry[${i}].role`, `unknown role '${c.role}'`, `roles: ${roles.join(', ')}`));
    });
    config.fill.forEach((f, i) => {
      if (!roleOk(f.role)) errors.push(err('nested_role_unknown', `with.fill[${i}].role`, `unknown role '${f.role}'`, `roles: ${roles.join(', ')}`));
      const probe = structuredClone(config.start);
      if (!setPath(probe, f.path, getPath(probe, f.path))) { errors.push(err('nested_fill_path', `with.fill[${i}].path`, `'${f.path}' is not a field of with.start`, 'write a placeholder value there; fill replaces it')); return; }
      // Every mapped value must make valid start effects (references checked like any document effect).
      for (const [k, v] of Object.entries(f.map || {})) {
        const filled = structuredClone(config.start); setPath(filled, f.path, v);
        filled.forEach((e, j) => ctx.checkEffect(e, `${inst?.path ?? 'systems'}.with.fill[${i}].map.${k}[${j}]`, errors));
      }
    });
    const ids = (doc.systems || []).filter(s => s?.use === ID).map(s => s.with?.id ?? 'nested');
    if (ids.filter(x => x === config.id).length > 1) errors.push(err('nested_duplicate', 'with.id', `two nested encounters share id '${config.id}'`));
    return errors;
  },
  install(rt, config, instance) {
    const key = `${ID}:${config.id}`, st = () => rt.store(key);
    const card = id => rt.registry.get(id)?.card;
    const verbs = config.verbs.length ? config.verbs : [...new Set(config.inner.flatMap(id => card(id)?.provides?.actions || []))];
    const hold = config.hold.length ? config.hold
      : [...new Set((rt.doc.systems || []).map(s => s.use).filter(id => id !== ID && !config.inner.includes(id) && card(id)?.mode))];

    const rolesOf = data => {
      const out = {};
      const spec = Object.keys(config.roles || {}).length ? config.roles : Object.fromEntries(Object.entries(data || {}).filter(([, v]) => typeof v === 'string' && rt.entity(v)).map(([k]) => [k, k]));
      for (const [role, field] of Object.entries(spec)) { const v = field === 'player' ? 'player' : getPath(data, field); if (typeof v === 'string') out[role] = v; }
      return out;
    };
    function snapshotHold(n) {
      const a = st().active; if (!a || a.n !== n) return;
      a.held = { entities: {} };
      if (config.freeze) for (const e of sortedEntities(rt)) if (!a.carried.includes(e.id) && (!config.space || e.space !== config.space)) a.held.entities[e.id] = structuredClone(e);
    }
    function restoreHold(a) {
      if (!a?.held) return;
      for (const [id, snap] of Object.entries(a.held.entities)) {
        const e = rt.state.entities[id];
        if (!e) { rt.state.entities[id] = structuredClone(snap); continue; }
        if (e.space !== snap.space) continue; // moved by the inner loop (into its battle space): its own business
        e.at = structuredClone(snap.at); e.components = structuredClone(snap.components); e.zone = snap.zone;
      }
    }
    function begin(roles) {
      const s = st();
      s.count = (s.count ?? 0) + 1;
      const a = s.active = { n: s.count, roles, carried: [], ret: {}, outer: rt.modal ? structuredClone(rt.modal) : null, held: null };
      for (const c of config.carry) {
        const e = rt.entity(c.role === 'player' ? 'player' : roles[c.role]); if (!e || !config.space) continue;
        a.carried.push(e.id); a.ret[e.id] = { space: e.space, at: structuredClone(e.at), zone: e.zone ?? null, back: c.back };
        rt.moveToSpace(e, config.space, c.at ?? null, c.zone ?? undefined);
      }
      if (config.modal && verbs.length) rt.openModal(ID, { actions: verbs, kind: 'encounter' });
      if (hold.length) rt.hold(key, hold);
      rt.state.vars['nested.active'] = 1;
      rt.emitTyped('nested_start', config.id, { roles });
      runBound(rt, config.onStart, roles);
      const start = structuredClone(config.start);
      for (const f of config.fill) {
        let v = getPath(rt.entity(f.role === 'player' ? 'player' : roles[f.role]), f.field);
        if (v === undefined) continue;
        if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(f.map, v)) v = f.map[v];
        setPath(start, f.path, structuredClone(v));
      }
      runBound(rt, start, roles);
      // Outer entities are frozen from the end of this step (after the outer action that triggered us settled).
      if (st().active?.n === a.n) rt.defer(() => snapshotHold(a.n));
    }
    function end(o) {
      const s = st(), a = s.active; if (!a) return;
      restoreHold(a);
      s.active = null; s.last = o.result;
      rt.release(key);
      if (rt.modal?.owner === ID) { rt.closeModal(ID); if (a.outer) rt.openModal(a.outer.owner, { actions: a.outer.actions, kind: a.outer.kind }); }
      for (const id of a.carried) { const e = rt.entity(id), r = a.ret[id]; if (e && r?.back && r.space && e.space !== r.space) rt.moveToSpace(e, r.space, r.at, r.zone || undefined); }
      rt.state.vars['nested.active'] = 0;
      rt.emitTyped('nested_end', config.id, { result: o.result, roles: a.roles });
      if (o.fates) settle(o, a.roles); else runBound(rt, o.do, a.roles);
      runBound(rt, config.onEnd, a.roles);
    }
    /** The inner side a participant played: the player's when it is the player or in one of the outer player groups. */
    function sideOf(id) {
      const e = rt.entity(id); if (!e) return null;
      if (e.id === rt.player()?.id) return 'player';
      const p = config.player, v = p ? e.components?.[p.component]?.[p.field] : undefined;
      return p && typeof v === 'string' && p.is.includes(v) ? 'player' : 'opponent';
    }
    /** Apply an outcome's fates: `do` once per defeated participant ($loser), the winner taking its place with `take`. */
    function settle(o, roles) {
      const ids = [...new Set(Object.values(roles))].filter(id => rt.entity(id));
      const fate = id => o.fates[sideOf(id)];
      const losers = ids.filter(id => fate(id) === 'defeated'), winner = ids.find(id => fate(id) === 'keeps');
      for (const loser of losers) {
        const e = rt.entity(loser), place = e ? { space: e.space, at: structuredClone(e.at), zone: e.zone } : null;
        runBound(rt, o.do, { ...roles, loser, ...(winner ? { winner } : {}) });
        const w = winner ? rt.entity(winner) : null;
        if (!config.take || !w || !place?.space || place.at == null) continue;
        if (w.space !== place.space) rt.moveToSpace(w, place.space, place.at, place.zone || undefined);
        else rt.space(place.space).setPos(w, place.at, rt);
      }
    }

    rt.on(config.on, data => {
      if (st().active) return;
      const roles = rolesOf(data);
      if (config.when && !rt.test(bindRoles(config.when, roles), { self: Object.values(roles)[0] })) return;
      begin(roles);
    });
    for (const o of config.outcomes) rt.on(o.on, () => {
      const a = st().active; if (!a) return;
      if (o.when && !rt.test(bindRoles(o.when, a.roles), { self: Object.values(a.roles)[0] })) return;
      end(o);
    });
    // Freeze the outer world: undo whatever moved its entities this step, after every system has run.
    rt.system('late', rt => { const a = st().active; if (a?.held) { const n = a.n; rt.defer(() => { const b = st().active; if (b?.n === n) restoreHold(b); }); } }, ID);
  },
};
