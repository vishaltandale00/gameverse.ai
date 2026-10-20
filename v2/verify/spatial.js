// Spatial checks: are zone entrances, plot targets, portals, interactables
// and other declared places reachable with the player's movement, in gate
// order? Stages are the states along the plot solver's critical path (or its
// most advanced path): at each stage the player's abilities and the gates
// are whatever the plot has unlocked by then. Reachability comes only from
// each space's `reachable` capability, given the abilities and the merged
// movement envelope that movement primitives document as card `envelope`.
import { maker, settle, applyOption, optionLabels } from './drive.js';
import { plotZones } from './objective.js';
import { instancesOf, memberOf, problem, padCell } from './util.js';
import { entityPath } from './strategies/common.js';
import { movementEnvelope, abilityIds, navOptions, navFrom } from './movement.js';
import { withTravel } from './macros.js';

export { movementEnvelope };

/** Targets to check: zones, plot-referenced zones, defined places (portals, interactables...) and live entities. */
function targetsOf(doc, registry) {
  const out = [], required = plotZones(doc);
  (doc.spaces || []).forEach((s, i) => (s.zones || []).forEach((z, j) => out.push({ kind: 'zone', id: z.id, space: s.id, zone: z.id, path: `spaces[${i}].zones[${j}]`, required: required.get(z.id) || null })));
  for (const x of instancesOf(doc)) for (const d of registry.get(x.inst?.use)?.card.defines || []) {
    if (!d.in || ['zone', 'ability'].includes(d.kind)) continue;
    (x.inst.with?.[d.in] || []).forEach((t, k) => {
      const where = t?.from || t;
      if (!where || (where.zone === undefined && where.at === undefined)) return;
      out.push({ kind: d.kind, id: t.id, space: where.space ?? x.space, zone: where.zone, at: where.at, path: `${x.path}.with.${d.in}[${k}]` });
    });
  }
  return out;
}

/** Stage snapshots along a path of option labels: the start and the state after each option. */
function stages(make, seed, path, settleSteps, maxStages) {
  const rt = make(seed);
  settle(rt, settleSteps);
  const out = [{ at: 0, snap: rt.snapshot() }];
  for (let i = 0; i < path.length && rt.state.status === 'playing'; i++) {
    const options = rt.availableOptions(), j = optionLabels(options).indexOf(path[i]);
    if (j < 0) break;
    applyOption(rt, options[j]); settle(rt, settleSteps);
    if (rt.state.status !== 'playing') break;
    out.push({ at: i + 1, snap: rt.snapshot(), label: path[i] });
  }
  if (out.length <= maxStages) return out;
  const step = (out.length - 1) / (maxStages - 1);
  return Array.from({ length: maxStages }, (_, k) => out[Math.round(k * step)]);
}

/**
 * verifySpatial(doc, registry, logic, { plot, seed, settleSteps, maxStages })
 * plot: a solver result (its shortest ending path, else its best path, gives the gate order).
 */
export function verifySpatial(doc, registry, logic, { plot = null, seed, settleSteps = 2, maxStages = 24 } = {}) {
  // Replay the plot path with the same travel macros the solver used.
  const make = plot?.travel ? withTravel(maker(doc, registry, logic), registry, { mode: plot.travel }).make : maker(doc, registry, logic);
  const ending = plot && Object.entries(plot.endings || {}).filter(([k]) => (plot.outcomes?.[k] ?? (k === 'lost' ? 'lost' : 'won')) !== 'lost').sort((a, b) => a[1].length - b[1].length)[0];
  const path = ending ? ending[1] : plot?.bestPath || [];
  const order = ending ? 'critical-path' : path.length ? 'best-path' : 'start-only';
  const rt = make(seed);
  const ids = abilityIds(doc, registry);
  const targets = targetsOf(doc, registry);
  const reached = new Map(targets.map(t => [t, null]));
  const entityReach = new Map(), entityInfo = new Map(); // entity id → first stage; id → { id, archetype }
  const visitedSpaces = new Set(), unsupported = new Set(), bypasses = [];
  const st = stages(make, seed, path, settleSteps, maxStages);
  let envelopeSources = 0;
  for (const stage of st) {
    rt.restore(stage.snap);
    const p = rt.player();
    if (!p?.space) continue;
    visitedSpaces.add(p.space);
    const api = rt.space(p.space);
    if (typeof api.reachable !== 'function') { unsupported.add(p.space); continue; }
    const nav = navOptions(rt, registry, p, ids);
    envelopeSources = nav.sources;
    const set = api.reachable(navFrom(api, p), rt, nav.opts);
    const zones = new Set(), keys = new Set();
    let dims = 0;
    for (const m of set) {
      const n = memberOf(m);
      if (n.cell) { dims = n.cell.length; keys.add(n.cell.join(',')); const z = api.zoneAt?.(typeof m === 'string' && api.cellOf ? m : n.cell, rt); /* spaces with cellOf speak cell keys */ if (z != null) zones.add(z); }
      else { keys.add(String(n.zone)); const z = api.zoneAt?.(n.zone, rt) ?? n.zone; if (z != null) zones.add(z); }
    }
    const has = at => { if (at == null) return false; if (!Array.isArray(at)) return keys.has(String(at)) || zones.has(at); return keys.has(padCell(at.map(Math.floor), dims || at.length).join(',')); };
    for (const t of targets) {
      if (reached.get(t) !== null || (t.space ?? p.space) !== p.space) continue;
      const ok = t.zone !== undefined && t.at === undefined ? zones.has(t.zone) : has(t.at) || (t.zone !== undefined && zones.has(t.zone));
      if (ok) reached.set(t, stage.at);
    }
    for (const e of Object.values(rt.state.entities)) {
      if (e.id === 'player' || e.space !== p.space || typeof entityReach.get(e.id) === 'number') continue;
      if (!(e.components.interact || e.components.collectible || e.components.pickup || rt.doc.plot?.characters?.some(c => c.id === e.id))) continue;
      const k = api.cellOf?.(e);
      entityInfo.set(e.id, { id: e.id, archetype: e.archetype });
      if (k != null ? keys.has(String(k)) || has(memberOf(k).cell) : has(e.at)) entityReach.set(e.id, stage.at);
      else entityReach.set(e.id, undefined);
    }
    // Gate bypass: a zone behind a closed gate is still reachable through another route.
    (rt.doc.spaces || []).forEach((s, i) => s.id === p.space && (s.zones || []).forEach((z, j) => (z.exits || []).forEach((x, k) => {
      if (!x.gate || !zones.has(x.to) || !zones.has(z.id) || p.at === x.to) return;
      let open; try { open = rt.test(x.gate); } catch { return; }
      const path = `spaces[${i}].zones[${j}].exits[${k}]`;
      if (!open && !bypasses.some(b => b.path === path)) bypasses.push({ path, to: x.to, stage: stage.at });
    })));
  }

  const problems = [];
  for (const [t, at] of reached) {
    if (at !== null) continue;
    if (!visitedSpaces.has(t.space)) continue; // reported per space below
    if (unsupported.has(t.space)) continue;
    if (t.kind === 'zone') problems.push(t.required
      ? problem('target_unreachable', t.path, `zone '${t.id}' is needed by ${t.required} but is not reachable at any stage of the ${order}`, { hint: 'connect it, lower its gate, or grant the movement ability earlier', severity: ending ? 'warning' : 'error' })
      : problem('zone_unreachable', t.path, `zone '${t.id}' is never reachable along the ${order}`, { hint: 'connect it or remove it', severity: 'warning' }));
    else problems.push(problem(`${t.kind}_unreachable`, t.path, `${t.kind} '${t.id}' is never reachable along the ${order}`, { hint: 'move it inside reachable space or open a route to it', severity: 'warning' }));
  }
  for (const [id, at] of entityReach) if (at === undefined) {
    const ci = rt.doc.plot?.characters?.findIndex(c => c.id === id) ?? -1;
    problems.push(problem('entity_unreachable', ci >= 0 ? `plot.characters[${ci}]` : entityPath(doc, entityInfo.get(id)), `'${id}' is never reachable along the ${order}`, { severity: 'warning', hint: 'place it in reachable space' }));
  }
  for (const b of bypasses) problems.push(problem('gate_bypassed', b.path, `zone '${b.to}' is reachable while the gate on this exit is still closed (stage ${b.stage})`, { severity: 'warning', hint: 'gate every route into the zone, or drop this gate' }));
  for (const s of unsupported) problems.push(problem('spatial_unsupported', `spaces[${doc.spaces.findIndex(x => x.id === s)}]`, `space '${s}' has no reachable capability; spatial checks there rely on the playtest`, { severity: 'info' }));
  (doc.spaces || []).forEach((s, i) => { if (!visitedSpaces.has(s.id)) problems.push(problem('space_unvisited', `spaces[${i}]`, `the player never enters space '${s.id}' along the ${order}`, { severity: 'info' })); });
  return {
    order, stages: st.length, exhaustive: false,
    targets: targets.map(t => ({ kind: t.kind, id: t.id, space: t.space, path: t.path, firstStage: reached.get(t) })),
    entities: Object.fromEntries([...entityReach].map(([k, v]) => [k, v ?? null])),
    envelopeSources, problems,
  };
}
