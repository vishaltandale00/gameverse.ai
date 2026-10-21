// Node maps: sector maps, level selects, act maps, badge-gated region chains.
// Three layouts, all data-driven by templates (kind, weight, layer range,
// count limits, optional doc zone to bind):
// - layered: floors of nodes walked by `paths` non-crossing upward paths
//   (Slay the Spire style), one-way exits, a start below and an end above;
// - web: scattered points joined by a spanning tree plus non-crossing extra
//   edges (FTL style), two-way;
// - linear: a chain with optional side branches (route/badge progression).
// Gates (predicates) attach to every edge entering a layer/position. Proof at
// generation: every node reachable from the start, the end reachable from
// every node (no dead ends on layered/web), no crossing edges on layered maps,
// template limits met. Failures retry sub-seeds, then fall back to a plain
// chain. Nodes become zones of the bound space (graph or any space with zones).
import { withDefaults, drawSeed, stream, spaceOf, addZones, patchZones, publish, spawnAt, problem } from './generate2d-lib.js';

const ID = 'engine.generate.graph.world';

const template = { type: 'object', fields: {
  kind: { type: 'string', required: true }, weight: { type: 'number', min: 0, default: 1 },
  zone: { type: 'ref', to: 'zone', effect: 'bind this existing zone as the (single) node of this kind' },
  layers: { type: 'list', of: { type: 'number', min: 0, max: 1 }, min: 2, max: 2, default: [0, 1], effect: 'allowed progression range (fractions of start→end)' },
  min: { type: 'integer', min: 0, default: 0 }, max: { type: 'integer', min: 0 },
  archetype: { type: 'string', effect: 'spawned at each node of this kind' },
  name: { type: 'string', effect: 'node name prefix' },
  tags: { type: 'list', of: { type: 'string' }, default: [] },
} };

export default {
  id: ID,
  card: {
    intent: 'Generates node maps (layered act maps, web sector maps, linear gated chains) as zones with exits, typed by weighted templates, and proves every node reachable and the end reachable from everywhere.',
    views: ['map', 'ui', 'text'],
    spaces: ['engine.space.graph'],
    params: {
      nodes: { type: 'integer', min: 2, max: 400, default: 15, scale: 'world', effect: 'node count (web, linear); layered derives it from layers × paths' },
      layout: { type: 'string', options: ['layered', 'web', 'linear'], default: 'layered' },
      layers: { type: 'integer', min: 2, max: 60, default: 8, scale: 'world', effect: 'layered: floors between start and end' },
      width: { type: 'integer', min: 1, max: 16, default: 5, effect: 'layered: columns per floor' },
      paths: { type: 'integer', min: 1, max: 16, default: 4, effect: 'layered: upward walks that make the map' },
      branching: { type: 'number', min: 0, max: 1, default: 0.3, effect: 'web: extra edges; linear: side branches' },
      templates: { type: 'list', of: template, default: [{ kind: 'battle', weight: 5 }, { kind: 'event', weight: 2 }, { kind: 'shop', weight: 1, layers: [0.2, 0.9] }, { kind: 'rest', weight: 1, layers: [0.3, 1] }, { kind: 'elite', weight: 1, layers: [0.35, 1] }] },
      start: { type: 'object', default: {}, fields: { kind: { type: 'string', default: 'start' }, zone: { type: 'ref', to: 'zone' } } },
      end: { type: 'object', default: {}, fields: { kind: { type: 'string', default: 'boss' }, zone: { type: 'ref', to: 'zone' }, archetype: { type: 'string' } } },
      gates: { type: 'list', default: [], of: { type: 'object', fields: { at: { type: 'number', min: 0, max: 1, required: true, effect: 'progression fraction; edges entering it are gated' }, gate: { type: 'predicate', required: true }, label: { type: 'string' } } } },
      noRepeat: { type: 'list', of: { type: 'string' }, default: ['elite', 'rest', 'shop'], effect: 'kinds that may not follow themselves along an edge' },
      twoWay: { type: 'string', options: ['auto', 'yes', 'no'], default: 'auto', effect: 'auto: layered one-way, web/linear two-way' },
      prefix: { type: 'string', default: 'node' },
      placePlayer: { type: 'boolean', default: true },
      attempts: { type: 'integer', min: 0, max: 16, default: 6 },
    },
    provides: { content: ['zones'], extent: 'space', events: ['generated', 'generated:*', 'generate_problem'], services: ['generation', 'worldgraph'] },
    requires: { capabilities: ['position'] },
    problems: ['node_unreachable', 'node_dead_end', 'edge_crossing', 'template_min', 'repeat_kind', 'graph_fallback'],
    validates: ['template_zone_reused', 'template_range_invalid', 'graph_too_small'],
  },
  /**
   * Planner hook (v2/planner/world.js), graph spaces: a linear, two-way chain through the space's own zones in order
   * (the first is the start node, the last the end, each one between bound once), or a default chain with no zones.
   */
  scaffold(space) {
    if (!this.card.spaces.includes(space.use)) return null;
    const zones = (space.zones || []).filter(z => z?.id);
    if (!zones.length) return { with: { layout: 'linear', nodes: 6, branching: 0, twoWay: 'yes' } };
    const mid = zones.slice(1, -1);
    return { with: {
      layout: 'linear', branching: 0, twoWay: 'yes', nodes: Math.max(2, zones.length), noRepeat: [],
      start: { zone: zones[0].id }, ...(zones.length > 1 ? { end: { zone: zones.at(-1).id } } : {}),
      templates: mid.length ? mid.map(z => ({ kind: z.id, zone: z.id, min: 1, max: 1 })) : [{ kind: 'path', weight: 1 }],
    } };
  },
  validate(raw) {
    const config = withDefaults(this.card, raw);
    const errors = [], zones = new Set();
    config.templates.forEach((t, i) => {
      if (t.layers[0] > t.layers[1]) errors.push(problem('template_range_invalid', `templates[${i}].layers`, 'layers must be [low, high]'));
      if (t.max !== undefined && t.max < t.min) errors.push(problem('template_range_invalid', `templates[${i}].max`, 'max is below min'));
      if (t.zone) { if (zones.has(t.zone)) errors.push(problem('template_zone_reused', `templates[${i}].zone`, `zone '${t.zone}' is bound twice`)); zones.add(t.zone); }
    });
    const total = config.layout === 'layered' ? config.layers * config.width : config.nodes;
    const need = config.templates.reduce((n, t) => n + t.min, 0);
    if (need > total) errors.push(problem('graph_too_small', 'templates', `templates need ${need} nodes; the map holds at most ${total}`));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const out = generateGraph(config, seed);
    const existing = new Set(space.zones().map(z => z.id));
    const fresh = out.nodes.filter(n => !existing.has(n.id)), bound = Object.fromEntries(out.nodes.filter(n => existing.has(n.id)).map(n => [n.id, { exits: [...(space.zone(n.id).exits || []), ...n.exits], tags: [...new Set([...(space.zone(n.id).tags || []), ...n.tags])] }]));
    addZones(rt, space, fresh);
    if (Object.keys(bound).length) patchZones(rt, space, bound);
    for (const n of out.nodes) if (n.archetype) spawnAt(rt, space, n.archetype, n.id, { node: { kind: n.kind } });
    if (config.placePlayer) rt.on('spawn', d => { if (d.id !== 'player') return; const p = rt.player(); if (p?.space === space.sid && p.at !== out.start) space.api.setPos(p, out.start, rt); });
    const st = () => rt.store(instance.key);
    publish(rt, instance, space, ID, out, { worldgraph: {
      nodes: () => st().nodes, start: () => st().start, end: () => st().end, node: id => st().nodes.find(n => n.id === id) || null,
      ofKind: kind => st().nodes.filter(n => n.kind === kind).map(n => n.id), problems: () => st().problems,
    } });
  },
};

const cross = (a, b, c, d) => { // segments ab and cd properly intersect (shared endpoints do not count)
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  if ([a, b].some(p => p === c || p === d)) return false;
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/** Pure generation with proof and retries: { nodes, start, end, problems, attempts, fallback }. */
export function generateGraph(config, seed) {
  let best = null;
  for (let attempt = 0; attempt <= config.attempts; attempt++) {
    const fallback = attempt === config.attempts, r = stream(seed, 'graph', attempt);
    const g = fallback ? linear({ ...config, branching: 0 }, r) : config.layout === 'layered' ? layered(config, r) : config.layout === 'web' ? web(config, r) : linear(config, r);
    assignKinds(config, g, r);
    const problems = prove(config, g);
    if (fallback) problems.unshift(problem('graph_fallback', 'layout', `layout '${config.layout}' failed its proof ${config.attempts} times; using a plain chain`));
    if (!best || problems.length < best.problems.length) best = { g, problems, attempts: attempt + 1, fallback };
    if (!problems.length) break;
  }
  const { g } = best, oneWay = config.twoWay === 'no' || (config.twoWay === 'auto' && config.layout === 'layered' && !best.fallback);
  // Gates on edges entering a progression fraction (both directions for two-way maps).
  const gateOf = (a, b) => config.gates.filter(x => g.nodes[a].t < x.at && g.nodes[b].t >= x.at).map(x => x.gate);
  const exits = g.nodes.map(() => []);
  for (const [a, b] of g.edges) {
    const gates = gateOf(a, b), gate = gates.length > 1 ? { all: gates } : gates[0];
    exits[a].push({ to: g.nodes[b].id, ...(gate ? { gate } : {}) });
    if (!oneWay) exits[b].push({ to: g.nodes[a].id });
  }
  const nodes = g.nodes.map((n, i) => ({ id: n.id, name: n.name, kind: n.kind, tags: [n.kind, ...(n.tags || [])], layer: n.layer, t: +n.t.toFixed(4), pos: n.pos.map(v => +v.toFixed(4)), exits: exits[i], ...(n.archetype ? { archetype: n.archetype } : {}), optional: Boolean(n.optional) }));
  return { nodes, start: nodes[g.start].id, end: nodes[g.end].id, problems: best.problems, attempts: best.attempts, fallback: best.fallback, oneWay };
}

const nodeAt = (config, i, t, pos, layer = 0) => ({ id: `${config.prefix}_${i}`, t, pos, layer, kind: null });

function layered(config, r) {
  const L = config.layers, Wd = config.width, nodes = [], index = new Map(), edges = new Set();
  const start = nodeAt(config, 0, 0, [0.5, 0], 0); nodes.push(start);
  const get = (l, c) => { const k = `${l},${c}`; if (!index.has(k)) { index.set(k, nodes.length); nodes.push(nodeAt(config, nodes.length, (l + 1) / (L + 1), [Wd > 1 ? c / (Wd - 1) : 0.5, (l + 1) / (L + 1)], l + 1)); } return index.get(k); };
  const used = new Map(); // `${l}` → list of [c, nc] steps taken between floors l and l+1, to forbid crossings
  for (let p = 0; p < config.paths; p++) {
    let c = p < 2 && Wd > 1 ? (p === 0 ? r.int(Math.ceil(Wd / 2)) : Math.floor(Wd / 2) + r.int(Math.ceil(Wd / 2))) : r.int(Wd);
    edges.add(`0>${get(0, c)}`);
    for (let l = 0; l < L - 1; l++) {
      const steps = used.get(l) || [];
      const options = [c - 1, c, c + 1].filter(n => n >= 0 && n < Wd && !steps.some(([a, b]) => (a < c && b > n) || (a > c && b < n)));
      const n = options.length ? r.pick(options) : c;
      steps.push([c, n]); used.set(l, steps);
      edges.add(`${get(l, c)}>${get(l + 1, n)}`);
      c = n;
    }
  }
  const end = nodes.length; nodes.push({ ...nodeAt(config, end, 1, [0.5, 1], L + 1) });
  for (const [k, i] of index) if (Number(k.split(',')[0]) === L - 1) edges.add(`${i}>${end}`);
  return { nodes, edges: [...edges].map(e => e.split('>').map(Number)), start: 0, end };
}

function web(config, r) {
  const N = config.nodes, pts = [], minD = 0.6 / Math.sqrt(N);
  for (let tries = 0; pts.length < N && tries < N * 200; tries++) { const p = [r(), r()]; if (pts.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= minD)) pts.push(p); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const nodes = pts.map((p, i) => nodeAt(config, i, p[0], p, 0)), edges = [], has = (a, b) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const crosses = (a, b) => edges.some(([c, d]) => cross(pts[a], pts[b], pts[c], pts[d]));
  // Spanning tree (Prim, shortest non-crossing link first), then extra short links by `branching`.
  const inTree = new Set([0]);
  while (inTree.size < nodes.length) {
    let bestE = null, bestD = Infinity;
    for (const a of inTree) for (let b = 0; b < nodes.length; b++) if (!inTree.has(b)) { const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]); if (d < bestD && !crosses(a, b)) { bestD = d; bestE = [a, b]; } }
    if (!bestE) for (const a of inTree) for (let b = 0; b < nodes.length; b++) if (!inTree.has(b)) { const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]); if (d < bestD) { bestD = d; bestE = [a, b]; } }
    edges.push(bestE); inTree.add(bestE[1]);
  }
  for (let a = 0; a < nodes.length; a++) {
    const near = nodes.map((_, b) => b).filter(b => b !== a).sort((x, y) => Math.hypot(pts[a][0] - pts[x][0], pts[a][1] - pts[x][1]) - Math.hypot(pts[a][0] - pts[y][0], pts[a][1] - pts[y][1])).slice(0, 3);
    for (const b of near) if (!has(a, b) && !crosses(a, b) && r.chance(config.branching)) edges.push([a, b]);
  }
  // Edges point from lower to higher progression so the end (rightmost) is downstream.
  return { nodes, edges: edges.map(([a, b]) => (a < b ? [a, b] : [b, a])), start: 0, end: nodes.length - 1, undirected: true };
}

function linear(config, r) {
  const main = Math.max(2, config.layout === 'linear' ? Math.round(config.nodes / (1 + config.branching)) : config.nodes), nodes = [], edges = [];
  for (let i = 0; i < main; i++) { nodes.push(nodeAt(config, i, i / (main - 1), [i / (main - 1), 0.5], i)); if (i) edges.push([i - 1, i]); }
  const end = main - 1;
  for (let i = 1; i < main - 1 && nodes.length < config.nodes; i++) if (r.chance(config.branching)) { const j = nodes.length; nodes.push({ ...nodeAt(config, j, nodes[i].t, [nodes[i].pos[0], r.chance(0.5) ? 0.15 : 0.85], i), optional: true }); edges.push([i, j]); }
  return { nodes, edges, start: 0, end, undirected: true };
}

/** Kinds from weighted templates within their progression range, honouring min/max and noRepeat; bound zones replace node ids. */
function assignKinds(config, g, r) {
  const counts = new Map(), succ = g.nodes.map(() => []), pred = g.nodes.map(() => []);
  for (const [a, b] of g.edges) { succ[a].push(b); pred[b].push(a); if (g.undirected) { succ[b].push(a); pred[a].push(b); } }
  g.nodes[g.start].kind = config.start.kind; g.nodes[g.end].kind = config.end.kind;
  if (config.end.archetype) g.nodes[g.end].archetype = config.end.archetype;
  const order = g.nodes.map((_, i) => i).filter(i => i !== g.start && i !== g.end);
  const fits = (t, i) => g.nodes[i].t >= t.layers[0] - 1e-9 && g.nodes[i].t <= t.layers[1] + 1e-9 && (t.max === undefined || (counts.get(t.kind) || 0) < t.max)
    && !(config.noRepeat.includes(t.kind) && [...succ[i], ...pred[i]].some(j => g.nodes[j].kind === t.kind));
  const give = (i, t) => { const n = g.nodes[i]; n.kind = t.kind; n.tags = t.tags; if (t.archetype) n.archetype = t.archetype; counts.set(t.kind, (counts.get(t.kind) || 0) + 1); };
  // Minimums first (spread by seed), then weighted fill.
  for (const t of config.templates) for (let k = 0; k < t.min; k++) { const free = r.shuffle(order.filter(i => !g.nodes[i].kind && fits(t, i))); if (free.length) give(free[0], t); }
  for (const i of order) if (!g.nodes[i].kind) { const ok = config.templates.filter(t => t.weight > 0 && fits(t, i)); if (ok.length) give(i, r.weighted(ok)); else g.nodes[i].kind = config.templates[0]?.kind ?? 'node'; }
  for (const t of config.templates) if (t.zone) { const i = [g.start, g.end, ...order].find(j => g.nodes[j].kind === t.kind); if (i !== undefined) g.nodes[i].id = t.zone; }
  if (config.start.zone) g.nodes[g.start].id = config.start.zone;
  if (config.end.zone) g.nodes[g.end].id = config.end.zone;
  g.nodes.forEach((n, i) => { n.name ??= `${config.templates.find(t => t.kind === n.kind)?.name ?? n.kind} ${i}`; });
  g.counts = Object.fromEntries(counts);
}

function prove(config, g) {
  const problems = [], N = g.nodes.length, succ = g.nodes.map(() => []), pred = g.nodes.map(() => []);
  for (const [a, b] of g.edges) { succ[a].push(b); pred[b].push(a); if (g.undirected) { succ[b].push(a); pred[a].push(b); } }
  const walk = (from, next) => { const seen = new Set([from]), q = [from]; while (q.length) for (const n of next[q.shift()]) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen; };
  const fwd = walk(g.start, succ), back = walk(g.end, pred);
  for (let i = 0; i < N; i++) {
    if (!fwd.has(i)) problems.push(problem('node_unreachable', 'layout', `node '${g.nodes[i].id}' cannot be reached from the start`));
    else if (!back.has(i) && !g.nodes[i].optional) problems.push(problem('node_dead_end', 'layout', `the end cannot be reached from '${g.nodes[i].id}'`));
  }
  if (config.layout === 'layered' && !g.undirected) for (let i = 0; i < g.edges.length; i++) for (let j = i + 1; j < g.edges.length; j++) {
    const [a, b] = g.edges[i], [c, d] = g.edges[j];
    if (cross(g.nodes[a].pos, g.nodes[b].pos, g.nodes[c].pos, g.nodes[d].pos)) problems.push(problem('edge_crossing', 'layout', `edge ${g.nodes[a].id}→${g.nodes[b].id} crosses ${g.nodes[c].id}→${g.nodes[d].id}`));
  }
  for (const t of config.templates) if ((g.counts[t.kind] || 0) < t.min) problems.push(problem('template_min', `templates`, `only ${g.counts[t.kind] || 0} '${t.kind}' nodes; ${t.min} required`));
  for (const k of config.noRepeat) for (const [a, b] of g.edges) if (g.nodes[a].kind === k && g.nodes[b].kind === k) { problems.push(problem('repeat_kind', 'noRepeat', `'${k}' follows '${k}' along ${g.nodes[a].id}→${g.nodes[b].id}`)); break; }
  return problems;
}
