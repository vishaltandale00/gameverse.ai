// Direction matches the view (ARCHITECTURE.md §6.3): pressing a direction through the controls a person has moves the
// player, or the vehicle it is seated in, the way the screen shows it. What the screen shows comes from declarations:
// the document's primary view and the projection the renderer or camera the host mounts declares for that view
// (card.projection, an object or a function of the space's config):
//   { kind: 'plane', right, up }        the space's axes the screen's right and up show (top-down, board, side views):
//                                       holding right moves along `right`, up along `up` (side views: right only, and
//                                       the jump verb rises along `up`);
//   { kind: 'chase', forward, right }   a camera behind the player looking along `forward` with `right` to the screen's
//                                       right: holding up moves forward, holding right as well bends the path toward
//                                       `right`, left toward the other side.
// Axes are '+x' '-x' '+y' '-y' '+z' '-z'. Each direction is pressed from several states play reaches (the start once
// the player can move, and the states each direction leads to), against idling from the same state; a direction that
// moves the subject the wrong way in any of them is direction_mismatch; no direction moving it at all is
// direction_inert; a renderer or camera declaring no projection for the view is projection_undeclared.
import { posOf } from './drive.js';

export const DIRECTION_CODES = Object.freeze(['projection_undeclared', 'direction_mismatch', 'direction_inert']);
const EPS = 0.05;
const vec = a => { const v = [0, 0, 0]; v['xyz'.indexOf(a[1])] = a[0] === '-' ? -1 : 1; return v; };
const sub = (a, b) => [0, 1, 2].map(i => (a[i] ?? 0) - (b[i] ?? 0));
const dot = (a, b) => [0, 1, 2].reduce((s, i) => s + (a[i] ?? 0) * (b[i] ?? 0), 0);

/**
 * The projection the host mounts for a space in the document's primary view: a camera's (when one is mounted for the
 * space and declares the view), else its renderer's. -> { view, use, projection | null }
 */
export function viewProjection(doc, registry, spaceId) {
  const view = doc.views?.primary ?? null, space = (doc.spaces || []).find(s => s.id === spaceId);
  const mounted = (doc.graphics || []).filter(g => /^graphics\.(render|camera)\./.test(g.use) && (!g.space || g.space === spaceId));
  const ordered = [...mounted.filter(g => g.use.startsWith('graphics.camera.')), ...mounted.filter(g => g.use.startsWith('graphics.render.'))];
  for (const g of ordered) {
    const card = registry.get(g.use)?.card, p = typeof card?.projection === 'function' ? card.projection(space?.with || {}) : card?.projection;
    if (p?.[view]) return { view, use: g.use, projection: p[view] };
  }
  return { view, use: ordered.find(g => g.use.startsWith('graphics.render.'))?.use ?? null, projection: null };
}

/** What the player steers: the vehicle it sits in, else the player. */
const subjectOf = rt => { const p = rt.player(); const seat = p?.components.seat; return seat ? rt.entity(seat.vehicle) ?? p : p; };
const where = rt => { const e = subjectOf(rt); return e ? (Array.isArray(e.at) ? posOf(rt, e) : null) : null; };

/**
 * Press each direction through the controls of a controlled runtime factory and check it against the view.
 * @param {any} doc the preflighted host document @param {any} registry @param {(seed: number) => any} make a controlledMaker
 * @param {number} seed @returns {{ problems: Array<{ code: string, message: string }>, evidence: any }}
 */
export function directionProblems(doc, registry, make, seed, { frames = 30, settleMax = 900 } = {}) {
  const rt = make(seed), problems = [];
  const axes = rt.controls.controls.map?.axes?.move;
  if (!axes?.length) return { problems, evidence: { skipped: 'no move axis: no direction is a control here' } };
  if (!where(rt)) for (let i = 0; i < 10 && !where(rt); i++) rt.step({});
  if (!where(rt)) return { problems, evidence: { skipped: 'no avatar to steer' } };
  const { view, use, projection } = viewProjection(doc, registry, subjectOf(rt).space);
  if (!projection) return { problems: [{ code: 'projection_undeclared', message: `${use ?? 'no renderer'} declares no projection for view '${view}' (card.projection)` }], evidence: { view, use } };
  const jump = rt.controls.presses('jump').includes(true);
  // A probe: from a snapshot, the subject's displacement under `input` for n frames, minus idling's from the same state.
  const delta = (snap, input, n = frames) => {
    rt.restore(snap); const a = where(rt); for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); const b = where(rt);
    rt.restore(snap); for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step({}); const c = where(rt);
    rt.restore(snap);
    return a && b && c ? sub(sub(b, a), sub(c, a)) : null;
  };
  const peak = (snap, input) => { // the highest the subject rises along `up` under input (jump), above idling
    rt.restore(snap); const up = vec(projection.up), a = dot(where(rt), up); let top = a, idle = a;
    for (let i = 0; i < frames && rt.state.status === 'playing'; i++) { rt.step(i === 0 ? input : { held: input.actions }); top = Math.max(top, dot(where(rt) ?? [], up)); }
    rt.restore(snap); for (let i = 0; i < frames && rt.state.status === 'playing'; i++) { rt.step({}); idle = Math.max(idle, dot(where(rt) ?? [], up)); }
    rt.restore(snap); return top - idle;
  };
  // The checks: each names its input, the reference input it is measured against, and the axis it must move along.
  const plane = projection.kind === 'plane', side = view === 'side';
  const checks = plane
    ? [['right', [1, 0], '+', projection.right], ['left', [-1, 0], '-', projection.right], ...(side ? [] : [['up', [0, 1], '+', projection.up], ['down', [0, -1], '-', projection.up]])]
    : [['forward', [0, 1], '+', projection.forward, null], ['right', [1, 1], '+', projection.right, [0, 1]], ['left', [-1, 1], '-', projection.right, [0, 1]]];
  // Settle until a direction moves the subject (countdowns, intros).
  let snap = rt.snapshot();
  for (let f = 0; f < settleMax && rt.state.status === 'playing'; f += 30) {
    snap = rt.snapshot();
    if (checks.some(([, mv]) => { const d = delta(snap, { axes: { move: mv } }); return d && Math.hypot(...d) > EPS; })) break;
    rt.restore(snap); for (let i = 0; i < 30 && rt.state.status === 'playing'; i++) rt.step({});
  }
  const probes = [snap];
  for (const [, mv] of checks) { rt.restore(snap); for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step({ axes: { move: mv } }); if (rt.state.status === 'playing') probes.push(rt.snapshot()); }
  const results = [];
  for (const [name, mv, sign, axis, ref] of checks) {
    const want = vec(axis).map(v => (sign === '-' ? -v : v));
    let moved = 0, wrong = 0;
    for (const s of probes) {
      let d = delta(s, { axes: { move: mv } });
      if (d && ref) { const r = delta(s, { axes: { move: ref } }); d = r ? sub(d, r) : null; }
      if (!d || Math.hypot(...d) <= EPS) continue;
      const along = dot(d, want), across = Math.hypot(...sub(d, want.map(v => v * along)));
      // A chase turn bends the path toward a side; it may also shorten it along forward, so only the side is judged.
      if (along > EPS && (ref || along >= across)) moved++; else wrong++;
    }
    results.push({ direction: name, move: mv, axis: sign === '-' ? `opposite ${axis}` : axis, moved, wrong });
    if (wrong) problems.push({ code: 'direction_mismatch', message: `pressing ${name} (move ${JSON.stringify(mv)}) did not move ${subjectOf(rt).id} along ${sign === '-' ? 'the opposite of ' : ''}${axis}, as ${use} draws view '${view}' (${wrong} of ${probes.length} states)` });
  }
  if (plane && side && jump) {
    const rises = probes.map(s => peak(s, { actions: { jump: true } }));
    results.push({ direction: 'jump', axis: projection.up, rises: rises.filter(x => x > EPS).length, sinks: rises.filter(x => x < -EPS).length });
    if (rises.some(x => x < -EPS) || !rises.some(x => x > EPS)) problems.push({ code: 'direction_mismatch', message: `pressing jump did not raise ${subjectOf(rt).id} along ${projection.up}, as ${use} draws view '${view}'` });
  }
  if (!results.some(r => r.moved || r.rises)) problems.push({ code: 'direction_inert', message: `no direction moved ${subjectOf(rt).id} in view '${view}' from ${probes.length} states` });
  return { problems, evidence: { view, use, projection, subject: subjectOf(rt).id, results } };
}
