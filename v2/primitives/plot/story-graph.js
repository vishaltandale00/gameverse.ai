// Static plot dependency analysis (no simulation). From a game document it
// builds a producer/requirement graph over beats, quests and objectives,
// dialogue nodes and choices, gates and their locks, zones (graph exits,
// portals, locked entries), characters, endings, cutscenes, journal entries,
// clues, random events, recipes and every effect anywhere in the document,
// then runs a monotone fixpoint from the starting state.
//
//   plotGraph(doc, logic) -> { nodes, edges, problems, reachable, unreachable, facts, ms }
//
// Facts are strings: flag:x item:x ability:x quest:x (complete) qstart:x
// obj:q:o beat:x gate:x zone:x char:x met:x dialogue:d said:d:n chose:d:k
// entry:x clue:x deduced:x cutscene:x ending:x revent:x. A node fires when its
// requirement holds over the facts produced so far; firing adds its facts.
//
// The approximation is optimistic (it over-approximates what is reachable):
// `not`, comparisons that allow zero, and predicate kinds the analysis does not
// model (owned by gameplay primitives: boss, used, status...) count as
// satisfiable; effects outside doc.plot (interactables, bosses, items' use
// effects) count as available unless something locks their owner. So every
// problem reported is real under these assumptions: an ending marked
// unreachable cannot be reached by any play, an item with no producer cannot
// be obtained, a gate cycle can never open. Ordering hazards that need
// simulation (consumed-then-required items) are reported as warnings.
import { parseTarget } from './gate.js';
import { isPlayerCharacter } from './character.js';
import { offerOf } from './quest.js';
import { allEffects, isObj, walk } from './story-lib.js';

const CMP = ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'];
const allowsZero = p => (p.lte !== undefined && p.lte >= 0) || (p.lt !== undefined && p.lt > 0) || p.eq === 0 || (p.ne !== undefined && p.ne !== 0);
const PREDICATE_SKIP = new Set(['when', 'if', 'gate', 'requires', 'until', 'fail', 'inputs', 'objectives']);

export function plotGraph(doc, logic) {
  const t0 = performance.now();
  const plot = doc.plot || {};
  const nodes = new Map();      // id -> { id, kind, path, req: pred-like requirement, out: Set<fact> }
  const producers = new Map();  // fact -> Set<node id>
  const readers = new Map();    // fact -> first path that requires it
  const consumed = new Map();   // item -> [paths]
  const problems = [];
  const kindOf = p => (logic?.kindOf ? logic.kindOf(p) : undefined) ?? (isObj(p) ? Object.keys(p)[0] : undefined);
  const problem = (severity, code, path, message, hint) => problems.push({ severity, code, path, message, ...(hint ? { hint } : {}) });

  // Requirements are small trees: { all: [...] } | { any: [...] } | { fact } | { pred, ctx } | true.
  const node = (id, kind, path, req, out = []) => {
    if (nodes.has(id)) { const n = nodes.get(id); n.req = { any: [n.req, req] }; for (const f of out) addOut(n, f); return n; }
    const n = { id, kind, path, req: req ?? true, out: new Set() };
    nodes.set(id, n); for (const f of out) addOut(n, f);
    return n;
  };
  const addOut = (n, f) => { n.out.add(f); if (!producers.has(f)) producers.set(f, new Set()); producers.get(f).add(n.id); };
  const fact = f => ({ fact: f });
  const all = (...r) => ({ all: r.filter(x => x !== true && x !== undefined) });
  const any = (...r) => ({ any: r.filter(x => x !== undefined) });
  const pred = (p, path) => (p === undefined ? true : { pred: p, path });

  // ---------- indexes ----------
  const quests = new Map((plot.quests || []).map(q => [q.id, q]));
  const characters = new Map((plot.characters || []).map(c => [c.id, c]));
  const dialogues = plot.dialogue || {};
  const cutscenes = plot.cutscenes || {};
  const gates = new Map((plot.gates || []).map(g => [g.id, g]));
  const locksOf = new Map();
  for (const g of gates.values()) for (const t of g.locks || []) { if (!locksOf.has(t)) locksOf.set(t, []); locksOf.get(t).push(g.id); }
  const lockReq = target => (locksOf.has(target) ? all(...locksOf.get(target).map(g => fact(`gate:${g}`))) : true);
  const scripted = new Set(allEffects(doc).filter(x => x.e.do === 'start_quest').map(x => x.e.quest));
  const entries = plot.entries || [];
  const zoneSpace = new Map();
  for (const s of doc.spaces || []) for (const z of s.zones || []) zoneSpace.set(z.id, s);

  // ---------- effects -> facts (and nested producers) ----------
  const effectFacts = (list, path) => {
    const out = [];
    (list || []).forEach((e, i) => {
      const p = `${path}[${i}]`;
      switch (e?.do) {
        case 'set_flag': if (e.value !== false) out.push(`flag:${e.flag}`); break;
        case 'give_item': out.push(`item:${e.item}`); break;
        case 'take_item': (consumed.get(e.item) ?? consumed.set(e.item, []).get(e.item)).push(p); break;
        case 'start_quest': out.push(`qstart:${e.quest}`); break;
        case 'complete_quest': out.push(`quest:${e.quest}`); break;
        case 'fail_quest': out.push(`qfail:${e.quest}`); break;
        case 'set_objective': if ((e.state ?? 'done') === 'done') out.push(`obj:${e.quest}:${e.objective}`); break;
        case 'unlock': out.push(`gate:${e.gate}`); break;
        case 'start_dialogue': out.push(`dialogue:${e.dialogue}`); break;
        case 'add_entry': out.push(`entry:${e.entry}`); break;
        case 'add_clue': out.push(`clue:${e.clue}`); break;
        case 'deduce': out.push(`deduced:${e.deduction}`); break;
        case 'unlock_ability': out.push(`ability:${e.ability}`); break;
        case 'play_cutscene': out.push(`cutscene:${e.cutscene}`); break;
        case 'trigger_event': out.push(`revent:${e.event}`); break;
        case 'end_game': if (e.ending) out.push(`ending:${e.ending}`); break;
        case 'teleport': if (!e.who || e.who === 'player') { if (e.zone) out.push(`zentry:${e.zone}`); if (e.space) out.push(`space:${e.space}`); } break;
        case 'set_alive': if (e.alive) out.push(`revived:${e.character}`); break;
        default: break;
      }
    });
    return out;
  };

  // ---------- start ----------
  const start = [];
  for (const it of doc.player?.inventory || []) start.push(`item:${it.item}`);
  for (const a of doc.player?.abilities || []) start.push(`ability:${a}`);
  for (const [i, s] of (doc.systems || []).entries()) {
    for (const it of Array.isArray(s.with?.start) ? s.with.start : []) {
      if (isObj(it) && typeof it.item === 'string') start.push(`item:${it.item}`);
      else if (typeof it === 'string' && /abilit/.test(s.use || '')) start.push(`ability:${it}`);
    }
    void i;
  }
  // Ambient item sources outside the plot: loot tables, block drops, shop stock, pickups, spawns.
  const ambient = new Set();
  const scanItems = (root, base) => walk(root, (v, path) => {
    if (!isObj(v) || typeof v.item !== 'string' || typeof v.do === 'string') return;
    if (path.split(/[.[]/).some(seg => PREDICATE_SKIP.has(seg))) return;
    ambient.add(v.item);
  }, base);
  scanItems(doc.content ? { ...doc.content, items: undefined, recipes: undefined } : {}, 'content');
  scanItems(doc.systems || [], 'systems');
  scanItems(doc.spaces || [], 'spaces');
  // Currency; block items (mining the block yields them); pickup/prop archetypes named after an item.
  const blocks = new Set((doc.content?.blocks || []).map(b => b.id));
  const archetypeIds = new Set((doc.content?.archetypes || []).filter(a => ['pickup', 'prop'].includes(a.kind)).map(a => a.id));
  for (const it of doc.content?.items || []) if (it.kind === 'currency' || (it.block && blocks.has(it.block)) || archetypeIds.has(it.id)) ambient.add(it.id);
  for (const id of ambient) start.push(`item:${id}`);
  node('start', 'start', '$', true, start);

  // ---------- zones ----------
  const playerSpace = doc.player?.space ?? doc.spaces?.[0]?.id;
  addOut(nodes.get('start'), `space:${playerSpace}`);
  const entriesInto = new Map(); // zone -> list of entry requirements (locked entries only matter)
  const addEntry = (zone, req) => { if (!entriesInto.has(zone)) entriesInto.set(zone, []); entriesInto.get(zone).push(req); };
  for (const s of doc.spaces || []) {
    const graph = s.use === 'engine.space.graph';
    for (const [j, z] of (s.zones || []).entries()) {
      for (const [k, x] of (z.exits || []).entries()) {
        const t = `exit:${z.id}>${x.to}`;
        node(`edge:${z.id}>${x.to}`, 'exit', `spaces[${doc.spaces.indexOf(s)}].zones[${j}].exits[${k}]`, all(fact(`zone:${z.id}`), pred(x.gate), lockReq(t)), [`zentry:${x.to}`]);
        addEntry(x.to, 'edge');
      }
      if (!graph) {
        // Continuous spaces: zones are open unless every declared entry into them is locked.
        const locked = [...locksOf.keys()].map(parseTarget).filter(p => p?.kind === 'exit' && p.to === z.id);
        for (const p of locked) node(`edge:${p.from}>${p.to}`, 'exit', `plot.gates`, all(fact(`zone:${p.from}`), lockReq(`exit:${p.from}>${p.to}`)), [`zentry:${z.id}`]);
        // Zones of other spaces (interiors, undercrofts) open once their space is entered (portal, teleport).
        if (!locked.length) { if (s.id === playerSpace) addOut(nodes.get('start'), `zentry:${z.id}`); else node(`inspace:${z.id}`, 'zone', `spaces[${doc.spaces.indexOf(s)}].zones[${j}]`, fact(`space:${s.id}`), [`zentry:${z.id}`]); }
      }
    }
    if (graph && s.id === playerSpace) {
      const at = typeof doc.player?.at === 'string' ? doc.player.at : s.zones?.[0]?.id;
      if (at) addOut(nodes.get('start'), `zentry:${at}`);
    }
  }
  // Portals: any `portals` list in system params ({id, from:{zone}, to:{zone}, gate?}).
  (doc.systems || []).forEach((s, i) => (Array.isArray(s.with?.portals) ? s.with.portals : []).forEach((p, j) => {
    if (!p?.to?.zone && !p?.to?.space) return;
    const g = typeof p.gate === 'string' ? fact(`gate:${p.gate}`) : pred(p.gate);
    const toSpace = p.to.space ?? (p.to.zone ? zoneSpace.get(p.to.zone)?.id : undefined);
    node(`portal:${p.id}`, 'portal', `systems[${i}].with.portals[${j}]`, all(p.from?.zone ? fact(`zone:${p.from.zone}`) : true, g, lockReq(`portal:${p.id}`)), [...(p.to.zone ? [`zentry:${p.to.zone}`] : []), ...(toSpace ? [`space:${toSpace}`] : [])]);
  }));
  for (const z of zoneSpace.keys()) node(`zone:${z}`, 'zone', `zones.${z}`, all(fact(`zentry:${z}`), lockReq(`zone:${z}`)), [`zone:${z}`]);

  // ---------- characters ----------
  for (const [i, c] of (plot.characters || []).entries()) {
    const path = `plot.characters[${i}]`;
    const where = isPlayerCharacter(c, doc) ? true : c.home ? fact(`zone:${c.home}`) : true;
    node(`char:${c.id}`, 'character', path, where, [`char:${c.id}`, `met:${c.id}`, `talked:${c.id}`]);
    (c.dialogue || []).forEach((d, j) => node(`chdlg:${c.id}:${j}`, 'character-dialogue', `${path}.dialogue[${j}]`, all(fact(`char:${c.id}`), pred(d.when, `${path}.dialogue[${j}].when`)), [`dialogue:${d.id}`]));
  }

  // ---------- dialogue ----------
  for (const [id, d] of Object.entries(dialogues)) {
    const path = `plot.dialogue.${id}`;
    node(`dlg:${id}`, 'dialogue', path, fact(`dialogue:${id}`), [`at:${id}:${d.start}`]);
    for (const [nid, n] of Object.entries(d.nodes || {})) {
      const np = `${path}.nodes.${nid}`;
      const out = [`said:${id}:${nid}`, `said:${id}`, ...effectFacts(n.do, `${np}.do`)];
      if (n.next !== undefined && !n.choices?.length) out.push(`at:${id}:${n.next}`);
      node(`dn:${id}:${nid}`, 'dialogue-node', np, all(fact(`at:${id}:${nid}`), pred(n.if, `${np}.if`)), out);
      if (n.else !== undefined) node(`dnelse:${id}:${nid}`, 'dialogue-node', `${np}.else`, fact(`at:${id}:${nid}`), [`at:${id}:${n.else}`]);
      (n.choices || []).forEach((c, k) => {
        const cp = `${np}.choices[${k}]`, key = c.id ?? `${nid}.${k}`;
        const cout = [`chose:${id}:${key}`, ...(c.next !== undefined ? [`chose:${id}:${c.next}`, `at:${id}:${c.next}`] : []), ...effectFacts(c.do, `${cp}.do`)];
        node(`dc:${id}:${nid}:${k}`, 'dialogue-choice', cp, all(fact(`said:${id}:${nid}`), pred(c.if, `${cp}.if`)), cout);
        if (c.check) node(`dcfail:${id}:${nid}:${k}`, 'dialogue-choice', `${cp}.check`, all(fact(`said:${id}:${nid}`), pred(c.if)), [...(c.check.fail !== undefined ? [`at:${id}:${c.check.fail}`] : []), ...effectFacts(c.check.failDo, `${cp}.check.failDo`)]);
      });
    }
  }

  // ---------- storyboard ----------
  const sb = (doc.systems || []).find(s => s.use === 'plot.storyboard');
  const sequential = sb ? (sb.with?.sequentialActs ?? true) : true;
  const acts = plot.storyboard?.acts || [];
  acts.forEach((a, i) => (a.beats || []).forEach((b, j) => {
    const path = `plot.storyboard.acts[${i}].beats[${j}]`;
    const prevAct = sequential && i > 0 ? all(...(acts[i - 1].beats || []).filter(x => !x.optional).map(x => fact(`beat:${x.id}`))) : true;
    node(`beat:${b.id}`, 'beat', path, all(...(b.after || []).map(x => fact(`beat:${x}`)), pred(b.when, `${path}.when`), lockReq(`beat:${b.id}`), prevAct), [`beat:${b.id}`, ...effectFacts(b.do, `${path}.do`)]);
  }));

  // ---------- quests ----------
  const objReq = (q, o, path) => {
    switch (o.kind) {
      case 'reach': return o.zone ? fact(`zone:${o.zone}`) : true;
      case 'collect': if (o.consume) (consumed.get(o.item) ?? consumed.set(o.item, []).get(o.item)).push(path); return fact(`item:${o.item}`);
      case 'deliver': if (o.consume !== false) (consumed.get(o.item) ?? consumed.set(o.item, []).get(o.item)).push(path); return all(fact(`item:${o.item}`), characters.has(o.to) ? fact(`char:${o.to}`) : fact(`zone:${o.to}`));
      case 'defeat': return o.zone ? fact(`zone:${o.zone}`) : true;
      case 'talk': return all(fact(`char:${o.character}`), o.node !== undefined ? fact(`said:${o.dialogue}:${o.node}`) : o.dialogue ? fact(`said:${o.dialogue}`) : true);
      case 'escort': return fact(`zone:${o.to}`);
      case 'survive': return all(o.zone ? fact(`zone:${o.zone}`) : true, o.seconds === undefined ? pred(o.until, `${path}.until`) : true);
      case 'build': case 'discover': return o.zone ? fact(`zone:${o.zone}`) : true;
      case 'drive': return o.to ? fact(`zone:${o.to}`) : true;
      case 'craft': { const r = (doc.content?.recipes || []).find(x => x.id === o.recipe); return r ? fact(`crafted:${r.id}`) : true; }
      case 'use': return o.interactable ? lockReq(`interactable:${o.interactable}`) : true;
      case 'until': return pred(o.when, `${path}.when`);
      default: return true;
    }
  };
  (plot.quests || []).forEach((q, i) => {
    const path = `plot.quests[${i}]`, offer = offerOf(q, scripted);
    const giver = offer === 'accept' && q.giver && characters.has(q.giver) ? fact(`char:${q.giver}`) : true;
    node(`qoffer:${q.id}`, 'quest-offer', path, all(...(q.prereq || []).map(p => fact(`quest:${p}`)), pred(q.gate, `${path}.gate`), lockReq(`quest:${q.id}`), giver), offer === 'script' ? [`qavail:${q.id}`] : [`qavail:${q.id}`, `qstart:${q.id}`]);
    node(`qon:${q.id}`, 'quest-start', `${path}.onStart`, fact(`qstart:${q.id}`), effectFacts(q.onStart, `${path}.onStart`));
    const required = [];
    let prev = null;
    (q.objectives || []).forEach((o, j) => {
      const op = `${path}.objectives[${j}]`;
      const order = q.order !== 'any' && !o.optional && prev ? fact(`obj:${q.id}:${prev}`) : true;
      node(`obj:${q.id}:${o.id}`, 'objective', op, all(fact(`qstart:${q.id}`), order, objReq(q, o, op)), [`obj:${q.id}:${o.id}`]);
      if (!o.optional) { required.push(fact(`obj:${q.id}:${o.id}`)); prev = o.id; }
    });
    node(`qdone:${q.id}`, 'quest-complete', path, all(fact(`qstart:${q.id}`), ...required), [`quest:${q.id}`]);
    const rewards = [...(q.rewards?.items || []).map(it => `item:${it.item}`), ...effectFacts(q.rewards?.do, `${path}.rewards.do`), ...effectFacts(q.onComplete, `${path}.onComplete`), ...(q.branches || []).flatMap((b, j) => effectFacts(b.do, `${path}.branches[${j}].do`))];
    node(`qreward:${q.id}`, 'quest-reward', `${path}.rewards`, fact(`quest:${q.id}`), rewards);
    const canFail = q.fail || q.timeLimit || (q.objectives || []).some(o => ['escort', 'survive', 'drive'].includes(o.kind));
    if (canFail) node(`qfail:${q.id}`, 'quest-fail', `${path}.fail`, fact(`qstart:${q.id}`), [`qfail:${q.id}`]);
    if (q.onFail?.length) node(`qfailfx:${q.id}`, 'quest-fail', `${path}.onFail`, fact(`qfail:${q.id}`), effectFacts(q.onFail, `${path}.onFail`));
  });

  // ---------- gates, endings, cutscenes, journal, clues, random events, recipes ----------
  (plot.gates || []).forEach((g, i) => node(`gate:${g.id}`, 'gate', `plot.gates[${i}]`, pred(g.requires, `plot.gates[${i}].requires`), [`gate:${g.id}`]));
  // An ending without `when` is reached only by an end_game effect naming it.
  (plot.endings || []).forEach((e, i) => { if (e.when !== undefined) node(`ending:${e.id}`, 'ending', `plot.endings[${i}]`, pred(e.when, `plot.endings[${i}].when`), [`ending:${e.id}`]); if (e.cutscene) node(`endingcs:${e.id}`, 'ending', `plot.endings[${i}].cutscene`, fact(`ending:${e.id}`), [`cutscene:${e.cutscene}`]); });
  for (const [id, c] of Object.entries(cutscenes)) node(`cs:${id}`, 'cutscene', `plot.cutscenes.${id}`, fact(`cutscene:${id}`), (c.steps || []).flatMap((s, j) => [...effectFacts(s.fx, `plot.cutscenes.${id}.steps[${j}].fx`), ...(s.move?.who === 'player' && typeof s.move.to === 'string' ? [`zentry:${s.move.to}`] : [])]));
  entries.forEach((e, i) => { if (e.when) node(`entrywhen:${e.id}`, 'entry', `plot.entries[${i}]`, pred(e.when, `plot.entries[${i}].when`), [`entry:${e.id}`]); });
  (plot.clues || []).forEach((c, i) => { if (c.when) node(`cluewhen:${c.id}`, 'clue', `plot.clues[${i}]`, pred(c.when, `plot.clues[${i}].when`), [`clue:${c.id}`]); });
  (plot.deductions || []).forEach((d, i) => node(`deduce:${d.id}`, 'deduction', `plot.deductions[${i}]`, all(...(d.clues || []).map(c => fact(`clue:${c}`)), pred(d.when, `plot.deductions[${i}].when`)), [`deduced:${d.id}`, ...effectFacts(d.do, `plot.deductions[${i}].do`)]));
  (plot.randomEvents || []).forEach((e, i) => {
    const path = `plot.randomEvents[${i}]`;
    node(`rev:${e.id}`, 'random-event', path, all(e.draw === false ? fact(`revent:${e.id}`) : true, pred(e.when, `${path}.when`)), [`reventseen:${e.id}`, ...effectFacts(e.do, `${path}.do`)]);
    if (e.draw !== false) addOut(nodes.get(`rev:${e.id}`), `revent:${e.id}`);
    (e.choices || []).forEach((c, j) => node(`revc:${e.id}:${j}`, 'random-event-choice', `${path}.choices[${j}]`, all(fact(`reventseen:${e.id}`), pred(c.if)), [...effectFacts(c.do, `${path}.choices[${j}].do`), ...(c.then ? [`revent:${c.then}`] : [])]));
  });
  (doc.content?.recipes || []).forEach((r, i) => {
    const inputs = (r.inputs || []).filter(x => typeof x.item === 'string').map(x => fact(`item:${x.item}`));
    node(`recipe:${r.id}`, 'recipe', `content.recipes[${i}]`, all(...inputs), [`crafted:${r.id}`, ...(r.output?.item ? [`item:${r.output.item}`] : [])]);
  });

  // ---------- effects anywhere else (interactables, mechanisms, bosses, item use) ----------
  for (const { e, path } of allEffects({ ...doc, plot: undefined })) {
    const out = effectFacts([e], path); if (!out.length) continue;
    let req = true;
    const m = /^content\.items\[(\d+)\]/.exec(path);
    if (m) req = fact(`item:${doc.content.items[Number(m[1])]?.id}`);
    else {
      // Owner = nearest ancestor with an id; a plot.gate lock on it gates these effects.
      const owners = ownerIds(doc, path);
      const lock = owners.flatMap(id => ['interactable', 'mechanism', 'portal'].map(k => `${k}:${id}`)).filter(t => locksOf.has(t));
      if (lock.length) req = all(...lock.map(lockReq));
    }
    node(`fx:${path}`, 'effect', path, req, out);
  }

  // ---------- requirement evaluation ----------
  const has = new Set();
  const noteRead = (f, path) => { if (path && !readers.has(f)) readers.set(f, path); };
  // Returns the facts still missing ([] = satisfied). `any` returns the union of its branches' needs.
  const missing = (r, path) => {
    if (r === true || r === undefined) return [];
    if (r.fact) { noteRead(r.fact, path); return has.has(r.fact) ? [] : [r.fact]; }
    if (r.all) return r.all.flatMap(x => missing(x, path));
    if (r.any) { if (!r.any.length) return []; const each = r.any.map(x => missing(x, path)); return each.some(m => !m.length) ? [] : each.flat(); }
    if (r.pred !== undefined) return predMissing(r.pred, r.path ?? path);
    return [];
  };
  const need = (f, path) => { noteRead(f, path); return has.has(f) ? [] : [f]; };
  const predMissing = (p, path) => {
    if (!isObj(p)) return [];
    switch (kindOf(p)) {
      case 'all': return (p.all || []).flatMap(q => predMissing(q, path));
      case 'any': { const each = (p.any || []).map(q => predMissing(q, path)); return !each.length || each.some(m => !m.length) ? [] : each.flat(); }
      case 'not': return [];
      case 'flag': return p.eq === false ? [] : need(`flag:${p.flag}`, path);
      case 'item': return allowsZero(p) ? [] : need(`item:${p.item}`, path);
      case 'ability': return need(`ability:${p.ability}`, path);
      case 'zone': return p.who && p.who !== 'player' ? [] : need(`zone:${p.zone}`, path);
      case 'beat': return need(`beat:${p.beat}`, path);
      case 'act': { const a = acts.find(x => x.id === p.act); return (p.state ?? 'done') === 'done' && a ? (a.beats || []).filter(b => !b.optional).flatMap(b => need(`beat:${b.id}`, path)) : []; }
      case 'gate': return p.open === false ? [] : need(`gate:${p.gate}`, path);
      case 'quest': {
        if (p.objective !== undefined) return (p.state ?? 'done') === 'done' ? need(`obj:${p.quest}:${p.objective}`, path) : p.state === 'active' ? need(`qstart:${p.quest}`, path) : [];
        const s = p.state ?? 'complete';
        return s === 'complete' ? need(`quest:${p.quest}`, path) : s === 'active' ? need(`qstart:${p.quest}`, path) : s === 'available' ? need(`qavail:${p.quest}`, path) : s === 'failed' ? need(`qfail:${p.quest}`, path) : [];
      }
      case 'objective': return (p.state ?? 'done') === 'done' ? need(`obj:${p.quest}:${p.objective}`, path) : p.state === 'active' ? need(`qstart:${p.quest}`, path) : [];
      case 'said': return need(p.node === undefined ? `said:${p.said}` : `said:${p.said}:${p.node}`, path);
      case 'chose': return p.choice === undefined ? need(`dialogue:${p.chose}`, path) : need(`chose:${p.chose}:${p.choice}`, path);
      case 'met': return need(`met:${p.met}`, path);
      case 'known': return need(`entry:${p.known}`, path);
      case 'entries': {
        if (allowsZero(p)) return [];
        const want = p.gte ?? (p.gt !== undefined ? p.gt + 1 : p.eq ?? 1);
        const tagged = entries.filter(e => p.entries === '*' || e.tag === p.entries).map(e => `entry:${e.id}`);
        const got = tagged.filter(f => has.has(f)).length;
        if (got >= want) return [];
        if (tagged.length < want) return [`entries:${p.entries}>=${want}`];
        return tagged.filter(f => !has.has(f));
      }
      case 'clue': return need(`clue:${p.clue}`, path);
      case 'deduced': return need(`deduced:${p.deduced}`, path);
      case 'cutscene': return (p.state ?? 'done') === 'done' ? need(`cutscene:${p.cutscene}`, path) : [];
      case 'random_event': return allowsZero(p) ? [] : need(`reventseen:${p.random_event}`, path);
      case 'used': { const t = `interactable:${p.used}`; return locksOf.has(t) ? locksOf.get(t).flatMap(g => need(`gate:${g}`, path)) : []; }
      case 'ending_available': return need(`ending:${p.ending_available}`, path);
      default: return []; // gameplay-owned or comparative state: assumed satisfiable
    }
  };

  // ---------- fixpoint ----------
  const fired = new Set();
  for (let changed = true, guard = 0; changed && guard < nodes.size + 5; guard++) {
    changed = false;
    for (const n of nodes.values()) {
      if (fired.has(n.id) || missing(n.req, n.path).length) continue;
      fired.add(n.id); changed = true;
      for (const f of n.out) has.add(f);
    }
  }

  // ---------- blocker graph (unfired nodes and missing facts) ----------
  const block = new Map(); // vertex -> Set of vertices it waits on; vertices: 'n:<node>' | 'f:<fact>'
  const addB = (a, b) => { if (!block.has(a)) block.set(a, new Set()); block.get(a).add(b); };
  for (const n of nodes.values()) if (!fired.has(n.id)) for (const f of missing(n.req, n.path)) addB(`n:${n.id}`, `f:${f}`);
  for (const [, set] of [...block]) for (const v of set) {
    const f = v.slice(2);
    for (const pid of producers.get(f) || []) if (!fired.has(pid)) addB(v, `n:${pid}`);
  }
  const sccs = tarjan(block);
  const label = v => v.slice(2);
  const gateCycles = [];
  for (const comp of sccs) {
    const loop = comp.length > 1 || block.get(comp[0])?.has(comp[0]);
    if (!loop) continue;
    // A real deadlock: every fact in the loop can only come from nodes inside the loop.
    const inComp = new Set(comp);
    if (!comp.filter(v => v.startsWith('f:')).every(v => [...(producers.get(label(v)) || [])].filter(id => !fired.has(id)).every(id => inComp.has(`n:${id}`)))) continue;
    const gatesIn = comp.filter(v => v.startsWith('n:gate:') || v.startsWith('f:gate:')).map(v => label(v).replace(/^gate:/, ''));
    const cyclePath = shortestCycle(block, comp);
    if (gatesIn.length) {
      const ids = [...new Set(gatesIn)];
      gateCycles.push(ids);
      problem('error', 'gate_cycle', `plot.gates[${(plot.gates || []).findIndex(g => g.id === ids[0])}]`, `gate${ids.length > 1 ? 's' : ''} ${ids.join(', ')} can only open after ${ids.length > 1 ? 'one another' : 'itself'}: ${cyclePath.map(label).join(' -> ')}`, 'break the loop: give the required item/flag a source outside the locked area, or unlock the gate from earlier content');
    } else problem('error', 'dependency_cycle', nodes.get(label(comp.find(v => v.startsWith('n:')) || comp[0]))?.path ?? 'plot', `circular requirement: ${cyclePath.map(label).join(' -> ')}`);
  }

  // Facts something waits on that nothing in the document can produce.
  const rootCode = f => ({ item: 'item_unobtainable', flag: 'flag_unobtainable', ability: 'ability_unobtainable', entry: 'entry_unobtainable', entries: 'entries_insufficient', clue: 'clue_unobtainable', zone: 'zone_unreachable', zentry: 'zone_unreachable', char: 'character_unreachable', dialogue: 'dialogue_unreachable', said: 'line_unreachable', chose: 'choice_unreachable', qstart: 'quest_never_started', gate: 'gate_never_opens', cutscene: 'cutscene_never_played' })[f.split(':')[0]] ?? 'requirement_unproducible';
  const unproducible = new Set();
  for (const set of block.values()) for (const v of set) if (v.startsWith('f:') && !(producers.get(label(v))?.size) && !v.startsWith('f:qfail:')) unproducible.add(label(v));
  const reaches = from => { const seen = new Set([from]), q = [from]; while (q.length) for (const w of block.get(q.shift()) || []) if (!seen.has(w)) { seen.add(w); q.push(w); } return seen; };

  // ---------- reachability summary ----------
  const endingIds = (plot.endings || []).map(e => e.id);
  const reachableEndings = endingIds.filter(e => has.has(`ending:${e}`));
  const blockingRoots = new Set();
  (plot.endings || []).forEach((e, i) => {
    if (has.has(`ending:${e.id}`)) return;
    const roots = [...reaches(`n:ending:${e.id}`)].filter(v => v.startsWith('f:') && unproducible.has(label(v))).map(label);
    roots.forEach(r => blockingRoots.add(r));
    problem('error', 'ending_unreachable', `plot.endings[${i}]`, `ending '${e.id}' can never be reached${roots.length ? `: needs ${roots.slice(0, 6).join(', ')}, which nothing provides` : ' (blocked by a cycle)'}`, 'see the gate_cycle / *_unobtainable problems');
  });
  if (endingIds.length && !reachableEndings.length) problem('error', 'plot_uncompletable', 'plot.endings', 'no ending is reachable from the start');
  for (const f of unproducible) {
    const sev = blockingRoots.has(f) ? 'error' : 'warning';
    if (f.startsWith('flag:') && sev === 'warning') continue; // the kernel already warns flag_never_set
    problem(sev, rootCode(f), readers.get(f) ?? 'plot', `'${f.slice(f.indexOf(':') + 1)}' is required but nothing in the document provides it`, f.startsWith('item:') ? 'give it with give_item, a quest reward, a recipe, loot table, shop stock or the starting inventory' : undefined);
  }
  acts.forEach((a, i) => (a.beats || []).forEach((b, j) => { if (!fired.has(`beat:${b.id}`)) problem(b.optional ? 'info' : 'warning', 'beat_unreachable', `plot.storyboard.acts[${i}].beats[${j}]`, `beat '${b.id}' can never fire`); }));
  (plot.quests || []).forEach((q, i) => {
    if (!has.has(`qstart:${q.id}`)) problem(q.kind === 'main' ? 'error' : 'warning', 'quest_never_starts', `plot.quests[${i}]`, `quest '${q.id}' can never start`);
    else if (!has.has(`quest:${q.id}`)) {
      const stuck = (q.objectives || []).filter(o => !o.optional && !fired.has(`obj:${q.id}:${o.id}`)).map(o => o.id);
      problem(q.kind === 'main' ? 'error' : 'warning', 'quest_uncompletable', `plot.quests[${i}]`, `quest '${q.id}' starts but can never complete (stuck at ${stuck[0] ?? '?'})`);
    }
  });
  // Conversation traps: a node from which no ending line can be reached by unconditional moves.
  for (const [id, d] of Object.entries(dialogues)) {
    const nodesOf = d.nodes || {}, canEnd = new Set();
    const exits = n => [...(n.choices?.length ? n.choices.filter(c => !c.if).map(c => (c.end || c.next === undefined ? null : c.next)) : [n.end || n.next === undefined ? null : n.next])];
    for (let changed = true; changed;) { changed = false; for (const [nid, n] of Object.entries(nodesOf)) if (!canEnd.has(nid) && exits(n).some(x => x === null || canEnd.has(x) || !(x in nodesOf))) { canEnd.add(nid); changed = true; } }
    const seen = new Set(), q = [d.start];
    while (q.length) { const nid = q.shift(); if (seen.has(nid) || !(nid in nodesOf)) continue; seen.add(nid); const n = nodesOf[nid]; for (const x of [...(n.choices || []).map(c => c.next), n.next, n.else, ...(n.choices || []).map(c => c.check?.fail)]) if (x !== undefined) q.push(x); }
    for (const nid of seen) if (!canEnd.has(nid)) { problem('warning', 'dialogue_trap', `plot.dialogue.${id}.nodes.${nid}`, `from '${nid}' the conversation can only end through a conditional choice: a player without it is stuck`, 'add an unconditional choice that ends the conversation'); break; }
  }
  for (const id of Object.keys(dialogues)) if (!has.has(`dialogue:${id}`)) problem('warning', 'dialogue_unreachable', `plot.dialogue.${id}`, `dialogue '${id}' is never started (no character entry or start_dialogue reaches it)`);
  (plot.gates || []).forEach((g, i) => { if (!has.has(`gate:${g.id}`) && !gateCycles.some(c => c.includes(g.id))) problem('warning', 'gate_never_opens', `plot.gates[${i}]`, `gate '${g.id}' never opens`); });
  for (const id of Object.keys(cutscenes)) if (!producers.get(`cutscene:${id}`)?.size) problem('info', 'cutscene_unused', `plot.cutscenes.${id}`, `cutscene '${id}' is never played`);

  // Consumed items that something else still needs, with a single source.
  for (const [item, paths] of consumed) {
    if (ambient.has(item)) continue; // world sources (drops, mining, pickups) can be farmed again
    const f = `item:${item}`, sources = [...(producers.get(f) || [])];
    const readersOf = [...nodes.values()].filter(n => n.kind !== 'objective' && mentions(n.req, f));
    if (sources.length <= 1 && readersOf.length) problem('warning', 'item_consumed_then_required', paths[0], `'${item}' is consumed here, has ${sources.length} source${sources.length === 1 ? '' : 's'}, and is still required by ${readersOf.slice(0, 3).map(n => n.id).join(', ')}`, 'set consume:false, give a second copy, or drop the later requirement');
  }

  const edges = [];
  for (const n of nodes.values()) {
    for (const f of n.out) edges.push({ from: n.id, to: f, kind: 'produces' });
    for (const f of reqFacts(n.req)) edges.push({ from: f, to: n.id, kind: 'requires' });
  }
  const factsAll = new Set([...producers.keys(), ...edges.filter(e => e.kind === 'requires').map(e => e.from)]);
  const list = kind => [...nodes.values()].filter(n => n.kind === kind).map(n => n.id.slice(n.id.indexOf(':') + 1));
  return {
    nodes: [...[...nodes.values()].map(n => ({ id: n.id, kind: n.kind, path: n.path, reached: fired.has(n.id) })), ...[...factsAll].map(f => ({ id: f, kind: 'fact', reached: has.has(f) }))],
    edges,
    problems,
    reachable: { endings: reachableEndings, beats: list('beat').filter(b => fired.has(`beat:${b}`)), quests: (plot.quests || []).map(q => q.id).filter(q => has.has(`quest:${q}`)), gates: (plot.gates || []).map(g => g.id).filter(g => has.has(`gate:${g}`)), zones: [...zoneSpace.keys()].filter(z => has.has(`zone:${z}`)) },
    unreachable: { endings: endingIds.filter(e => !has.has(`ending:${e}`)), beats: list('beat').filter(b => !fired.has(`beat:${b}`)), quests: (plot.quests || []).map(q => q.id).filter(q => !has.has(`quest:${q}`)), zones: [...zoneSpace.keys()].filter(z => !has.has(`zone:${z}`)) },
    facts: [...has].sort(),
    approximation: 'optimistic-monotone',
    ms: +(performance.now() - t0).toFixed(2),
  };

  function reqFacts(r) {
    if (r === true || !r) return [];
    if (r.fact) return [r.fact];
    if (r.all) return r.all.flatMap(reqFacts);
    if (r.any) return r.any.flatMap(reqFacts);
    if (r.pred !== undefined) return predFacts(r.pred);
    return [];
  }
  function predFacts(p) { const saved = [...has]; has.clear(); const out = predMissing(p); saved.forEach(f => has.add(f)); return out; }
  function mentions(r, f) { return reqFacts(r).includes(f); }
}

/** Ids of the objects enclosing `path` (nearest first). */
function ownerIds(doc, path) {
  const segs = path.match(/[^.[\]]+/g) || [], out = [];
  let cur = doc;
  for (const s of segs) { cur = cur?.[/^\d+$/.test(s) ? Number(s) : s]; if (isObj(cur) && typeof cur.id === 'string') out.unshift(cur.id); }
  return out;
}

function tarjan(graph) {
  let index = 0; const idx = new Map(), low = new Map(), on = new Set(), stack = [], out = [];
  const verts = new Set([...graph.keys(), ...[...graph.values()].flatMap(s => [...s])]);
  const strong = v => {
    // iterative Tarjan
    const work = [[v, [...(graph.get(v) || [])], 0]];
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    while (work.length) {
      const top = work[work.length - 1], [u, succ] = top;
      if (top[2] < succ.length) {
        const w = succ[top[2]++];
        if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; stack.push(w); on.add(w); work.push([w, [...(graph.get(w) || [])], 0]); }
        else if (on.has(w)) low.set(u, Math.min(low.get(u), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(u))); }
        if (low.get(u) === idx.get(u)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== u); out.push(comp); }
      }
    }
  };
  for (const v of verts) if (!idx.has(v)) strong(v);
  return out;
}

function shortestCycle(graph, comp) {
  const inComp = new Set(comp), startV = comp.find(v => v.startsWith('n:gate:')) ?? comp.find(v => v.startsWith('f:gate:')) ?? comp[0];
  const prev = new Map([[startV, null]]), q = [startV];
  while (q.length) {
    const u = q.shift();
    for (const w of graph.get(u) || []) {
      if (!inComp.has(w)) continue;
      if (w === startV) { const path = [startV]; for (let x = u; x !== null && x !== startV; x = prev.get(x)) path.splice(1, 0, x); path.push(startV); return path; }
      if (!prev.has(w)) { prev.set(w, u); q.push(w); }
    }
  }
  return comp;
}
