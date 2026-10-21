// Named requirements (plot.gates): { id, requires: pred, hint, locks?: [target] }.
// A gate is open when an `unlock` effect forced it open, or when it is not
// force-locked and `requires` holds. Targets name the locked thing as
// `<kind>:<id>`: exit:<zone>><zone>, portal:<id>, zone:<id>, beat:<id>,
// interactable:<id>, quest:<id> (any other kind is allowed and is checked
// against that kind's index when one is defined).
//
// Locks are enforced by whichever primitive owns the locked thing: it asks the
// `gates` service — allows(target, {who, notify}) — before letting the player
// through. plot.storyboard (beat:) and plot.quest (quest:) do so here; spaces,
// portals and interactables do it in their own files (see
// v2/kernel/requests/story.md). The `gate` predicate works anywhere a
// predicate does (an exit's `gate`, a mechanism's `gate`, a beat's `when`).
import { err, checkPred, checkKeys, cached } from './story-lib.js';

const ID = 'plot.gate';
const st = rt => { const s = rt.store(ID); s.forced ??= {}; s.open ??= {}; return s; };
const index = rt => cached(rt, 'plot.gate.index', doc => {
  const gates = new Map((doc.plot?.gates || []).map(g => [g.id, g])), locks = new Map();
  for (const g of gates.values()) for (const t of g.locks || []) { if (!locks.has(t)) locks.set(t, []); locks.get(t).push(g.id); }
  return { gates, locks };
});
/** Parse 'exit:a>b' -> { kind: 'exit', id: 'a>b', from: 'a', to: 'b' }. */
export function parseTarget(t) {
  const i = typeof t === 'string' ? t.indexOf(':') : -1;
  if (i <= 0) return null;
  const kind = t.slice(0, i), id = t.slice(i + 1);
  if (!id) return null;
  if (kind === 'exit') { const [from, to, extra] = id.split('>'); if (!from || !to || extra !== undefined) return null; return { kind, id, from, to }; }
  return { kind, id };
}
const TARGET_KINDS = { zone: 'zone', beat: 'beat', quest: 'quest', portal: 'portal', interactable: 'interactable', mechanism: 'mechanism', ending: 'ending', dialogue: 'dialogue', character: 'character' };

export function gateOpen(rt, id) {
  const g = index(rt).gates.get(id); if (!g) return false;
  const f = st(rt).forced[id];
  if (f === 'open') return true;
  if (f === 'locked') return false;
  return g.requires ? rt.test(g.requires) : true;
}

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: [], progress: ['gate_opened'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "plot.gates", "min": 1, "why": "gates are named requirements that lock exits, portals or beats", "example": {"id": "lamp_door", "requires": {"item": "brass_key"}, "hint": "The lamp room is locked."}},
    ],
    intent: 'Named requirement predicates (plot.gates) that lock exits, portals, zones, beats, interactables and quests; owners of those things ask the gates service before letting the player through. unlock/lock force a gate open or shut.',
    views: ['any'],
    params: {
      announce: { type: 'boolean', default: true, effect: 'emit gate_opened:<id> / gate_closed:<id> when a gate changes state' },
    },
    provides: { events: ['gate_opened', 'gate_opened:*', 'gate_closed', 'gate_closed:*', 'gate_blocked', 'gate_blocked:*'], services: ['gates'] },
    reads: ['plot.gates'],
    defines: [{ kind: 'gate', at: 'plot.gates' }],
  },
  logic(logic) {
    logic.predicate('gate', { refs: p => [['gate', p.gate]], test: (p, rt) => gateOpen(rt, p.gate) === (p.open ?? true) });
    logic.effect('unlock', { refs: e => [['gate', e.gate]], run: (e, rt) => { st(rt).forced[e.gate] = 'open'; } });
    logic.effect('lock', { refs: e => [['gate', e.gate]], run: (e, rt) => { st(rt).forced[e.gate] = 'locked'; } });
    logic.effect('release_gate', { refs: e => [['gate', e.gate]], run: (e, rt) => { delete st(rt).forced[e.gate]; } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.gates;
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [err('param_type', 'plot.gates', 'must be a list of gates')];
    list.forEach((g, i) => {
      const path = `plot.gates[${i}]`;
      checkKeys(g, ['id', 'requires', 'hint', 'locks', 'title'], path, errors);
      if (g.requires === undefined) errors.push(err('gate_invalid', `${path}.requires`, 'gate needs a requires predicate'));
      checkPred(g.requires, `${path}.requires`, errors, ctx);
      if (g.locks !== undefined && !Array.isArray(g.locks)) { errors.push(err('param_type', `${path}.locks`, 'must be a list of targets')); return; }
      (g.locks || []).forEach((t, j) => {
        const lp = `${path}.locks[${j}]`, p = parseTarget(t);
        if (!p) { errors.push(err('gate_target_invalid', lp, `'${t}' is not <kind>:<id> (exit:<zone>><zone> for exits)`)); return; }
        if (p.kind === 'exit') { for (const z of [p.from, p.to]) if (ctx.indexes.zone && !ctx.indexes.zone.has(z)) errors.push(err('ref_unknown', lp, `unknown zone '${z}'`)); return; }
        const kind = TARGET_KINDS[p.kind] ?? p.kind;
        if (ctx.indexes[kind] && !ctx.indexes[kind].has(p.id)) errors.push(err('ref_unknown', lp, `unknown ${kind} '${p.id}'`));
      });
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const api = {
      open: id => gateOpen(rt, id),
      /** Gate ids that lock a target string (e.g. 'portal:forge_door'). */
      gatesFor: target => index(rt).locks.get(target) || [],
      /** True when some gate locking the target is shut. */
      locked: target => api.gatesFor(target).some(id => !gateOpen(rt, id)),
      /** May `who` pass `target`? Emits gate_blocked:<gate> (with its hint) when refused and notify is set. */
      allows(target, { who = 'player', notify = true } = {}) {
        const shut = api.gatesFor(target).filter(id => !gateOpen(rt, id));
        if (!shut.length) return true;
        if (notify) for (const id of shut) rt.emitTyped('gate_blocked', id, { gate: id, target, who, hint: index(rt).gates.get(id)?.hint ?? null });
        return false;
      },
      /** For exits: allows('exit:a>b'). */
      exit: (from, to, opts) => api.allows(`exit:${from}>${to}`, opts),
      hint: id => index(rt).gates.get(id)?.hint ?? null,
      targets: () => [...index(rt).locks.keys()],
    };
    rt.provide('gates', api);
    rt.system('plot', rt => {
      const s = st(rt);
      for (const id of index(rt).gates.keys()) {
        const now = gateOpen(rt, id), was = Boolean(s.open[id]);
        if (now === was) continue;
        s.open[id] = now;
        if (config.announce) rt.emitTyped(now ? 'gate_opened' : 'gate_closed', id, { gate: id });
      }
    }, ID);
  },
};

export function solverKey(rt) { const s = rt.store(ID); return { forced: s.forced || {}, open: Object.keys(s.open || {}).filter(k => s.open[k]).sort() }; }
