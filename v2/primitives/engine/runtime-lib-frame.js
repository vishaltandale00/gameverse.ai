// The coordinate frame of a space, from its card (card.frame, an object or a function of the space's config):
//   up       the index of the axis pointing up (gravity pulls along -up), or null for a plane seen from above (top-down
//            grids and maps: up is toward the viewer);
//   handed   'right' when (x, y, z) — or (x, y, toward the viewer) for a plane seen from above — is a right-handed frame,
//            'left' when it is left-handed (a track's lanes are numbered left to right as you face along its progress).
// Spaces without geometry (graph, none) declare frame null. Gameplay that turns or aims relative to the player
// (vehicles steering, verbs acting on the cell the player faces) reads it here, never assumes one.

/** A space card's frame for one config; undefined when the card declares none (a type hole the conformance reports). */
export function frameOfCard(card, config = {}) {
  if (!card || !('frame' in card)) return undefined;
  return typeof card.frame === 'function' ? card.frame(config) : card.frame;
}

/** The frame of a space in a runtime (its card's frame for the instance config). Throws when the card declares none. */
export function spaceFrame(rt, spaceId) {
  const inst = (rt.doc.spaces || []).find(s => s.id === spaceId), card = inst && rt.registry?.get(inst.use)?.card;
  const f = frameOfCard(card, inst?.with || {});
  if (f === undefined) throw Error(`space '${spaceId}' (${inst?.use}) declares no card.frame`);
  return f;
}

/** The vertical axis of a frame for a plane: the declared up axis, else the axis no plane coordinate uses (toward the viewer). */
const upAxis = (frame, plane) => (frame.up ?? [0, 1, 2].find(i => !plane.includes(i)));

/**
 * Seen from above, which way a positive heading change in the plane (u, w) turns: +1 counterclockwise, -1 clockwise.
 * A turn to the right is clockwise seen from above, so a steering input `s` (right positive) changes the heading by
 * -s * turnSign. plane: 'xy' (u = x, w = y) or 'xz' (u = x, w = z).
 */
export function turnSign(frame, plane) {
  const [u, w] = plane === 'xz' ? [0, 2] : [0, 1], up = upAxis(frame, [u, w]);
  // e_u × e_w in a right-handed frame: e0×e1 = e2, e1×e2 = e0, e2×e0 = e1 (and the reverse order negates).
  const k = 3 - u - w, cyc = (u + 1) % 3 === w ? 1 : -1;
  const s = (k === up ? cyc : 0) * (frame.handed === 'left' ? -1 : 1);
  return s || 1;
}
