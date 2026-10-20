// Rig helpers shared by graphics.rig.* and graphics.anim.*.
// A rig is plain data: { kind, bones: [{ name, parent, head:[x,y,z] }], height, ... }
// where `head` is the joint's rest position in model space (feet at y=0,
// facing +z, left at +x) and rest rotations are identity, so a pose (bone ->
// euler offsets) is applied directly as each bone's local rotation.

/** Validate a bone list: unique names, parents defined before children. Returns problems. */
export function checkRig(rig) {
  const seen = new Set(), problems = [];
  for (const b of rig.bones) {
    if (seen.has(b.name)) problems.push(`duplicate bone ${b.name}`);
    if (b.parent && !seen.has(b.parent)) problems.push(`bone ${b.name} parent ${b.parent} not defined before it`);
    seen.add(b.name);
  }
  return problems;
}

export function boneIndex(rig) { return new Map(rig.bones.map((b, i) => [b.name, i])); }
export function childrenOf(rig, name) { return rig.bones.filter(b => b.parent === name).map(b => b.name); }
/** Chain from `from` down to `to` (inclusive) following parents of `to`. */
export function chain(rig, from, to) {
  const byName = new Map(rig.bones.map(b => [b.name, b])), out = [];
  for (let b = byName.get(to); b; b = byName.get(b.parent)) { out.unshift(b.name); if (b.name === from) return out; }
  return null;
}

// 3x3 rotation from euler XYZ (three.js order: R = Rx * Ry * Rz applied to column vectors).
export function eulerMatrix([x, y, z]) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}
const mul = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const apply = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

/**
 * Forward kinematics without three.js: world joint positions for a pose.
 * pose: { bone: [rx,ry,rz], $root: [x,y,z] }. Returns Map name -> { pos, rot (3x3) }.
 */
export function forwardKinematics(rig, pose = {}) {
  const out = new Map(), root = pose.$root || [0, 0, 0];
  for (const b of rig.bones) {
    const R = eulerMatrix(pose[b.name] || [0, 0, 0]);
    if (!b.parent) { out.set(b.name, { pos: [b.head[0] + root[0], b.head[1] + root[1], b.head[2] + root[2]], rot: R }); continue; }
    const p = out.get(b.parent), pb = rig.bones.find(x => x.name === b.parent);
    const local = [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]];
    const off = apply(p.rot, local);
    out.set(b.name, { pos: [p.pos[0] + off[0], p.pos[1] + off[1], p.pos[2] + off[2]], rot: mul(p.rot, R) });
  }
  return out;
}

/** Build a THREE.Bone hierarchy. Returns { root, bones: Map name -> Bone, list: Bone[] (rig order) }. */
export function buildBones(THREE, rig) {
  const map = new Map(), list = [];
  for (const b of rig.bones) {
    const bone = new THREE.Bone(); bone.name = b.name;
    const parent = b.parent ? rig.bones.find(x => x.name === b.parent) : null;
    bone.position.set(b.head[0] - (parent?.head[0] || 0), b.head[1] - (parent?.head[1] || 0), b.head[2] - (parent?.head[2] || 0));
    bone.userData.rest = bone.position.clone();
    if (b.parent) map.get(b.parent).add(bone);
    map.set(b.name, bone); list.push(bone);
  }
  return { root: list[0], bones: map, list };
}

/** Apply a pose to THREE bones (rotations are offsets from identity rest). */
export function applyPose(bones, pose) {
  for (const [name, bone] of bones) {
    const r = pose[name];
    if (r) bone.rotation.set(r[0], r[1], r[2]); else bone.rotation.set(0, 0, 0);
  }
  const root = pose.$root, first = bones.values().next().value;
  if (first) {
    const rest = first.userData.rest;
    if (root) first.position.set(rest.x + root[0], rest.y + root[1], rest.z + root[2]); else first.position.copy(rest);
  }
}

/**
 * Custom rig for creatures without a standard body plan (catalog graphics.rig.custom):
 * a spine chain along the model's long axis plus limb chains from part names.
 * parts: lowpoly parts with at/size and optional bone; returns a rig and bone tags.
 */
export function customRig(parts, { bones: wanted = 8 } = {}) {
  const box = parts.reduce((b, p) => {
    const a = p.at || [0, 0, 0], s = p.size || [1, 1, 1];
    for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], a[i] - s[i] / 2); b.max[i] = Math.max(b.max[i], a[i] + s[i] / 2); }
    return b;
  }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  if (!Number.isFinite(box.min[0])) { box.min = [-0.5, 0, -0.5]; box.max = [0.5, 1, 0.5]; }
  const axis = (box.max[2] - box.min[2]) >= (box.max[0] - box.min[0]) ? 2 : 0;
  const n = Math.max(3, Math.min(16, Math.round(wanted * 0.6)));
  const midY = (box.min[1] + box.max[1]) / 2, bones = [{ name: 'hips', parent: null, head: [0, midY, 0] }];
  // Spine toward +axis (head), tail toward -axis.
  const half = (box.max[axis] - box.min[axis]) / 2, c = (box.max[axis] + box.min[axis]) / 2;
  const front = Math.ceil(n / 2), back = n - front;
  let prev = 'hips';
  for (let i = 1; i <= front; i++) { const h = [0, midY, 0]; h[axis] = c + half * i / front; const name = i === front ? 'head' : `spine_${i}`; bones.push({ name, parent: prev, head: h }); prev = name; }
  prev = 'hips';
  for (let i = 1; i <= back; i++) { const h = [0, midY, 0]; h[axis] = c - half * i / back; const name = `tail_${i}`; bones.push({ name, parent: prev, head: h }); prev = name; }
  // Wings / limbs from named parts on the sides.
  for (const p of parts) {
    if (!p.name || p.bone) continue;
    if (/wing|arm|leg|fin|claw/.test(p.name)) {
      const at = p.at || [0, 0, 0], side = Math.sign(at[0]) || 1;
      const rootPt = [side * Math.max(0.05, Math.abs(at[0]) - (p.size?.[0] || 0) / 2), at[1], at[2]];
      bones.push({ name: p.name, parent: 'hips', head: rootPt });
      bones.push({ name: `${p.name}_tip`, parent: p.name, head: [at[0] + side * (p.size?.[0] || 0) / 4, at[1], at[2]] });
    }
  }
  return { kind: 'custom', bones, axis, height: box.max[1] - Math.min(0, box.min[1]) };
}

/** Pick the bone a part belongs to: explicit bone tag, part name, or the nearest joint. */
export function boneForPart(rig, part, aliases = {}) {
  const names = new Set(rig.bones.map(b => b.name));
  if (part.bone && names.has(part.bone)) return part.bone;
  if (part.bone && aliases[part.bone] && names.has(aliases[part.bone])) return aliases[part.bone];
  if (part.name && names.has(part.name)) return part.name;
  if (part.name && aliases[part.name] && names.has(aliases[part.name])) return aliases[part.name];
  const at = part.at || [0, 0, 0];
  let best = rig.bones[0].name, bd = Infinity;
  for (const b of rig.bones) { const d = Math.hypot(b.head[0] - at[0], b.head[1] - at[1], b.head[2] - at[2]); if (d < bd) { bd = d; best = b.name; } }
  return best;
}

/**
 * Add spring chains for secondary parts (capes, long hair, banners): a chain of
 * `n` bones named `${base}_1..n` (+ `${base}_end`) hanging from the part's bone
 * along its height. base = part name, else its color key ('cape'). Pure.
 * Returns { rig, chains: [{ base, bones, part }] }.
 */
export function addSecondaryChains(rig, parts, n = 3) {
  const names = new Set(rig.bones.map(b => b.name)), bones = rig.bones.slice(), chains = [];
  for (const p of parts) {
    if (!p.secondary || p.from) continue;
    const raw = p.name || (typeof p.c === 'string' && !p.c.startsWith('#') ? p.c : 'chain');
    const base = raw.replace(/_\d+$/, '');
    if (names.has(`${base}_1`)) continue;
    const at = p.at || [0, 0, 0], size = p.size || [0.2, 0.6, 0.05];
    const top = at[1] + size[1] / 2, bottom = at[1] - size[1] / 2;
    const parent = p.bone && names.has(p.bone) ? p.bone : rig.bones[0].name;
    let prev = parent; const list = [];
    for (let i = 1; i <= n; i++) {
      const y = top - (top - bottom) * (i - 1) / n, name = `${base}_${i}`;
      bones.push({ name, parent: prev, head: [at[0], +y.toFixed(5), at[2]] }); names.add(name); list.push(name); prev = name;
    }
    bones.push({ name: `${base}_end`, parent: prev, head: [at[0], +bottom.toFixed(5), at[2]] }); names.add(`${base}_end`);
    chains.push({ base, bones: list, part: p, top, bottom });
  }
  return { rig: { ...rig, bones }, chains };
}

// --- three.js pose helpers for IK / spring bones / ragdoll -----------------------

let T = null;
function tmp(THREE) {
  if (!T) T = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qc: new THREE.Quaternion() };
  return T;
}
/** World position of a bone as [x,y,z] (matrices must be current). */
export function worldPos(THREE, bone) { const t = tmp(THREE); bone.getWorldPosition(t.a); return [t.a.x, t.a.y, t.a.z]; }

/**
 * Rotate `bone` so the direction from it to `childWorld` turns toward
 * `targetWorld` (world space), by weight w. Updates world matrices below it.
 */
export function aimBone(THREE, bone, childWorld, targetWorld, w = 1) {
  const t = tmp(THREE);
  bone.getWorldPosition(t.a);
  t.b.set(childWorld[0] - t.a.x, childWorld[1] - t.a.y, childWorld[2] - t.a.z);
  t.c.set(targetWorld[0] - t.a.x, targetWorld[1] - t.a.y, targetWorld[2] - t.a.z);
  if (t.b.lengthSq() < 1e-10 || t.c.lengthSq() < 1e-10) return;
  t.qa.setFromUnitVectors(t.b.normalize(), t.c.normalize());          // world-space delta
  if (w < 1) t.qa.slerp(t.qb.identity(), 1 - w);
  bone.getWorldQuaternion(t.qb);
  t.qc.copy(t.qa).multiply(t.qb);                                     // desired world rotation
  if (bone.parent) { bone.parent.getWorldQuaternion(t.qb); t.qb.invert(); t.qc.premultiply(t.qb); }
  bone.quaternion.copy(t.qc);
  bone.updateMatrixWorld(true);
}

/** Move a bone (usually hips) by a world-space offset. */
export function offsetBoneWorld(THREE, bone, delta) {
  const t = tmp(THREE);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(t.qa); t.qa.invert(); bone.parent.getWorldScale(t.b);
    t.a.set(delta[0], delta[1], delta[2]).applyQuaternion(t.qa).divide(t.b);
  } else t.a.set(delta[0], delta[1], delta[2]);
  bone.position.add(t.a); bone.updateMatrixWorld(true);
}
