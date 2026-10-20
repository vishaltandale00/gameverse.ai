// Animation data and math shared by graphics.anim.* (no three.js).
// A pose maps bone name -> [rx, ry, rz] (radians, euler XYZ, offsets from the
// rest pose) and the special key '$root' -> [x, y, z] (metres, hips offset).
// Characters face +z with their left side at +x. Rotating a limb that hangs
// along -y by a negative rx swings it forward.
//
// A clip is data: { id, dur (s), loop, keys: { bone: [[t, rx, ry, rz], ...] },
// events: [{ t, event, data? }] }. Procedural presets are generated as keyframe
// data from analytic gait functions, so authored clips and presets are sampled
// by the same code.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = t => t * t * (3 - 2 * t);

/** Sample a clip at time t (seconds). Linear interpolation, wrapping when loop. */
export function sampleClip(clip, t) {
  const pose = {};
  const dur = clip.dur || 1;
  const tt = clip.loop ? ((t % dur) + dur) % dur : clamp(t, 0, dur);
  for (const [bone, keys] of Object.entries(clip.keys || {})) {
    if (!keys.length) continue;
    let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= tt) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    let f = 0;
    if (b !== a) { const span = b[0] - a[0]; f = span > 0 ? (tt - a[0]) / span : 0; }
    else if (clip.loop && keys.length > 1) {
      // Interpolate across the loop seam back to the first key.
      const first = keys[0], span = dur - a[0] + first[0];
      f = span > 0 ? (tt - a[0]) / span : 0;
      pose[bone] = [0, 1, 2].map(k => a[k + 1] + (first[k + 1] - a[k + 1]) * f);
      continue;
    }
    pose[bone] = [0, 1, 2].map(k => a[k + 1] + (b[k + 1] - a[k + 1]) * f);
  }
  return pose;
}

/** Events whose time lies in (t0, t1] for a clip advanced from t0 to t1, handling loop wrap. */
export function clipEvents(clip, t0, t1) {
  const out = [], dur = clip.dur || 1;
  if (!clip.events?.length || t1 <= t0) return out;
  if (!clip.loop) { for (const e of clip.events) if (e.t > t0 && e.t <= t1) out.push(e); return out; }
  const c0 = Math.floor(t0 / dur), c1 = Math.floor(t1 / dur);
  for (let c = c0; c <= c1; c++) for (const e of clip.events) { const at = c * dur + e.t; if (at > t0 && at <= t1) out.push(e); }
  return out;
}

/** Weighted sum of poses: [{pose, w}] -> pose. */
export function blendPoses(list) {
  const out = {};
  let total = 0; for (const { w } of list) total += Math.max(0, w);
  if (total <= 0) return out;
  for (const { pose, w } of list) {
    if (w <= 0) continue; const k = w / total;
    for (const [bone, r] of Object.entries(pose)) { const o = (out[bone] ??= [0, 0, 0]); o[0] += r[0] * k; o[1] += r[1] * k; o[2] += r[2] * k; }
  }
  return out;
}

/** Overlay pose b onto a with weight w, optionally only for a bone mask (upper body for attacks while walking). */
export function layerPose(a, b, w, mask = null) {
  const out = { ...a };
  for (const [bone, r] of Object.entries(b)) {
    if (mask && !mask.has(bone)) continue;
    const base = a[bone] || [0, 0, 0];
    out[bone] = [base[0] + (r[0] - base[0]) * w, base[1] + (r[1] - base[1]) * w, base[2] + (r[2] - base[2]) * w];
  }
  return out;
}

export const UPPER_BODY = new Set(['spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'lowerArmL', 'handL', 'shoulderR', 'upperArmR', 'lowerArmR', 'handR', 'back']);

// --- Procedural clip library ------------------------------------------------

/** Build keyframes by sampling f(phase 0..1) -> pose at n points over dur. */
function sampled(id, dur, loop, n, f, events = []) {
  const keys = {};
  for (let i = 0; i <= n; i++) {
    if (loop && i === n) break;
    const p = i / n, pose = f(p);
    for (const [bone, r] of Object.entries(pose)) (keys[bone] ??= []).push([+(p * dur).toFixed(4), +r[0].toFixed(4), +r[1].toFixed(4), +r[2].toFixed(4)]);
  }
  return { id, dur, loop, keys, events };
}

const gait = (amp, knee, arm, elbow, bob, lean) => p => {
  const s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  const kneeL = knee * Math.max(0, Math.sin(TAU * p + Math.PI / 2 + 0.6)), kneeR = knee * Math.max(0, Math.sin(TAU * p - Math.PI / 2 + 0.6));
  return {
    $root: [0, -bob * Math.cos(2 * TAU * p) - bob, 0],
    hips: [0, 0.08 * amp * s, 0], spine: [lean, -0.12 * amp * s, 0], chest: [0, -0.1 * amp * s, 0], head: [-lean * 0.6, 0.06 * amp * s, 0],
    upperLegL: [-amp * s, 0, 0], lowerLegL: [kneeL, 0, 0], footL: [amp * 0.4 * s - kneeL * 0.3, 0, 0],
    upperLegR: [amp * s, 0, 0], lowerLegR: [kneeR, 0, 0], footR: [-amp * 0.4 * s - kneeR * 0.3, 0, 0],
    upperArmL: [arm * s, 0, -0.08], lowerArmL: [-elbow - elbow * 0.5 * Math.max(0, -s), 0, 0],
    upperArmR: [-arm * s, 0, 0.08], lowerArmR: [-elbow - elbow * 0.5 * Math.max(0, s), 0, 0],
    $c: [c, 0, 0],
  };
};
const strip = f => p => { const o = f(p); delete o.$c; return o; };
const steps = [{ t: 0, event: 'step', data: { foot: 'L' } }, { t: 0.5, event: 'step', data: { foot: 'R' } }];
const atDur = (evs, dur) => evs.map(e => ({ ...e, t: +(e.t * dur).toFixed(4) }));

/** Swing: wind-up (0..a), strike (a..b), recover (b..1). side 'R'|'L', dir 'h' horizontal|'v' overhead|'thrust'. */
function swingPose(side, dir, power) {
  const S = side, O = side === 'R' ? 'L' : 'R', sgn = side === 'R' ? -1 : 1;
  return p => {
    const wind = smooth(clamp(p / 0.3, 0, 1)), strike = smooth(clamp((p - 0.3) / 0.2, 0, 1)), rec = smooth(clamp((p - 0.55) / 0.45, 0, 1));
    const k = (1 - rec);
    const pose = { spine: [0.1 * power * k, sgn * (0.5 * wind - 1.0 * strike) * power * k, 0], chest: [0, sgn * (0.3 * wind - 0.5 * strike) * k, 0] };
    if (dir === 'v') pose[`upperArm${S}`] = [(-2.6 * wind + 2.2 * strike) * k - 0.2, 0, 0];
    else if (dir === 'thrust') pose[`upperArm${S}`] = [(-0.4 * wind - 1.1 * strike) * k, 0, sgn * 0.2 * k];
    else pose[`upperArm${S}`] = [(-1.4 * wind - 0.3 * strike) * k, 0, sgn * (-1.2 * wind + 1.9 * strike) * k];
    pose[`lowerArm${S}`] = [(-1.0 * wind + 0.9 * strike) * k - 0.2, 0, 0];
    pose[`upperArm${O}`] = [-0.5 * k, 0, -sgn * 0.3 * k];
    pose[`lowerArm${O}`] = [-0.8 * k, 0, 0];
    pose.upperLegL = [-0.3 * strike * k, 0, 0]; pose.upperLegR = [0.25 * strike * k, 0, 0]; pose.lowerLegR = [0.3 * strike * k, 0, 0];
    pose.$root = [0, -0.05 * strike * k, 0.08 * strike * k * power];
    return pose;
  };
}

const still = pose => () => pose;
const HUMANOID = {
  idle: () => sampled('idle', 3, true, 12, p => {
    const b = Math.sin(TAU * p);
    return { $root: [0, -0.008 + 0.008 * b, 0], spine: [0.02 * b, 0, 0], chest: [0.03 * b, 0, 0], head: [-0.02 * b, 0.05 * Math.sin(TAU * p * 0.5), 0],
      upperArmL: [0.02 * b, 0, -0.06 - 0.02 * b], upperArmR: [0.02 * b, 0, 0.06 + 0.02 * b], lowerArmL: [-0.12, 0, 0], lowerArmR: [-0.12, 0, 0] };
  }),
  walk: () => sampled('walk', 1.0, true, 16, strip(gait(0.5, 0.75, 0.42, 0.25, 0.02, 0.04)), atDur(steps, 1.0)),
  run: () => sampled('run', 0.66, true, 16, strip(gait(0.85, 1.5, 0.9, 1.0, 0.05, 0.22)), atDur(steps, 0.66)),
  sprint: () => sampled('sprint', 0.56, true, 16, strip(gait(1.05, 1.8, 1.2, 1.3, 0.06, 0.38)), atDur(steps, 0.56)),
  crouch_walk: () => sampled('crouch_walk', 1.1, true, 16, p => ({ ...strip(gait(0.4, 0.6, 0.2, 0.4, 0.01, 0.4))(p), $root: [0, -0.32, 0], upperLegL: [-0.9 - 0.4 * Math.sin(TAU * p), 0, 0], upperLegR: [-0.9 + 0.4 * Math.sin(TAU * p), 0, 0], lowerLegL: [1.5, 0, 0], lowerLegR: [1.5, 0, 0] }), atDur(steps, 1.1)),
  strafe_left: () => sampled('strafe_left', 0.9, true, 12, p => { const s = Math.sin(TAU * p); return { upperLegL: [0, 0, 0.35 * s], upperLegR: [0, 0, 0.35 * s], lowerLegL: [0.3 * Math.max(0, s), 0, 0], lowerLegR: [0.3 * Math.max(0, -s), 0, 0], $root: [0, -0.02 * Math.abs(s), 0], spine: [0.05, 0, 0] }; }, atDur(steps, 0.9)),
  strafe_right: () => sampled('strafe_right', 0.9, true, 12, p => { const s = Math.sin(TAU * p); return { upperLegL: [0, 0, -0.35 * s], upperLegR: [0, 0, -0.35 * s], lowerLegL: [0.3 * Math.max(0, -s), 0, 0], lowerLegR: [0.3 * Math.max(0, s), 0, 0], $root: [0, -0.02 * Math.abs(s), 0], spine: [0.05, 0, 0] }; }, atDur(steps, 0.9)),
  walk_back: () => sampled('walk_back', 1.1, true, 16, p => strip(gait(-0.4, 0.6, 0.3, 0.25, 0.02, -0.04))(1 - p), atDur(steps, 1.1)),
  jump: () => sampled('jump', 0.35, false, 6, p => ({ $root: [0, -0.15 * (1 - p), 0], upperLegL: [-0.6 * p, 0, 0], lowerLegL: [1.0 * p, 0, 0], upperLegR: [0.1 * p, 0, 0], lowerLegR: [0.4 * p, 0, 0], upperArmL: [-2.2 * p, 0, -0.3 * p], upperArmR: [-2.2 * p, 0, 0.3 * p], spine: [-0.1 * p, 0, 0] }), [{ t: 0.05, event: 'takeoff' }]),
  fall: () => sampled('fall', 0.8, true, 8, p => { const s = Math.sin(TAU * p); return { upperLegL: [-0.4, 0, 0.05], lowerLegL: [0.7, 0, 0], upperLegR: [0.1, 0, -0.05], lowerLegR: [0.4, 0, 0], upperArmL: [-0.6 + 0.15 * s, 0, -0.9], upperArmR: [-0.6 - 0.15 * s, 0, 0.9], spine: [0.05, 0, 0] }; }),
  land: () => sampled('land', 0.35, false, 6, p => { const k = Math.sin(Math.PI * clamp(p * 1.4, 0, 1)); return { $root: [0, -0.22 * k, 0], upperLegL: [-0.8 * k, 0, 0], upperLegR: [-0.8 * k, 0, 0], lowerLegL: [1.4 * k, 0, 0], lowerLegR: [1.4 * k, 0, 0], spine: [0.35 * k, 0, 0], upperArmL: [-0.4 * k, 0, -0.3 * k], upperArmR: [-0.4 * k, 0, 0.3 * k] }; }, [{ t: 0.02, event: 'land' }]),
  swing: () => sampled('swing', 0.5, false, 10, swingPose('R', 'h', 1), [{ t: 0.2, event: 'hit' }]),
  light_attack_1: () => sampled('light_attack_1', 0.45, false, 10, swingPose('R', 'h', 1), [{ t: 0.18, event: 'hit' }]),
  light_attack_2: () => sampled('light_attack_2', 0.45, false, 10, p => { const f = swingPose('R', 'h', 1)(1 - p * 0.999); return f; }, [{ t: 0.2, event: 'hit' }]),
  light_attack_3: () => sampled('light_attack_3', 0.6, false, 12, swingPose('R', 'thrust', 1.3), [{ t: 0.3, event: 'hit' }]),
  heavy_attack: () => sampled('heavy_attack', 1.0, false, 16, swingPose('R', 'v', 1.6), [{ t: 0.5, event: 'hit' }]),
  mine: () => sampled('mine', 0.45, true, 10, swingPose('R', 'v', 0.8), [{ t: 0.22, event: 'hit' }]),
  place: () => sampled('place', 0.3, false, 6, p => { const k = Math.sin(Math.PI * p); return { upperArmR: [-1.3 * k, 0, 0.1], lowerArmR: [-0.3 * k, 0, 0], spine: [0.1 * k, 0, 0] }; }, [{ t: 0.15, event: 'release' }]),
  shoot: () => sampled('shoot', 0.25, false, 5, p => { const k = 1 - p; return { upperArmR: [-1.55 + 0.3 * k * k, 0, 0.05], lowerArmR: [-0.05, 0, 0], upperArmL: [-1.4, 0, -0.45], lowerArmL: [-0.5, 0, 0], chest: [-0.05 * k, -0.25, 0], head: [0, 0.2, 0] }; }, [{ t: 0.01, event: 'release' }]),
  aim: () => sampled('aim', 1, true, 2, still({ upperArmR: [-1.55, 0, 0.05], lowerArmR: [-0.05, 0, 0], upperArmL: [-1.4, 0, -0.45], lowerArmL: [-0.5, 0, 0], chest: [0, -0.25, 0], head: [0, 0.2, 0] })),
  bow_draw: () => sampled('bow_draw', 0.7, false, 8, p => { const k = smooth(p); return { upperArmL: [-1.55, 0, -0.1], lowerArmL: [0, 0, 0], upperArmR: [-1.5, 0, 0.3 + 0.9 * k], lowerArmR: [-1.9 * k, 0, 0], chest: [0, -0.5, 0], head: [0, 0.45, 0] }; }),
  bow_release: () => sampled('bow_release', 0.35, false, 6, p => { const k = 1 - smooth(p); return { upperArmL: [-1.55 * k, 0, -0.1], upperArmR: [-1.4 * k, 0, 1.3 * k], lowerArmR: [-0.6 * k, 0, 0], chest: [0, -0.5 * k, 0] }; }, [{ t: 0.01, event: 'release' }]),
  sign_cast: () => sampled('sign_cast', 0.6, false, 8, p => { const k = Math.sin(Math.PI * p); return { upperArmL: [-1.5 * k, 0, -0.2], lowerArmL: [-0.9 * k, 0.4 * k, 0], upperArmR: [-0.3 * k, 0, 0.2], chest: [0, 0.3 * k, 0], head: [0, -0.2 * k, 0] }; }, [{ t: 0.3, event: 'release' }]),
  block_idle: () => sampled('block_idle', 1.5, true, 6, p => ({ upperArmL: [-1.3, 0.5, -0.2], lowerArmL: [-1.3, 0, 0], upperArmR: [-0.7, 0, 0.2], lowerArmR: [-0.9, 0, 0], spine: [0.15 + 0.02 * Math.sin(TAU * p), 0, 0], upperLegL: [-0.3, 0, 0], lowerLegL: [0.4, 0, 0], upperLegR: [0.25, 0, 0], lowerLegR: [0.3, 0, 0], $root: [0, -0.08, 0] })),
  parry: () => sampled('parry', 0.4, false, 8, p => { const k = Math.sin(Math.PI * clamp(p * 1.5, 0, 1)); return { upperArmL: [-1.6 * k, 0.8 * k, -0.2], lowerArmL: [-1.2 * k, 0, 0], spine: [0, 0.4 * k, 0], $root: [0, 0, -0.08 * k] }; }, [{ t: 0.12, event: 'hit' }]),
  dodge_roll: () => sampled('dodge_roll', 0.6, false, 12, p => { const k = Math.sin(Math.PI * p); return { $root: [0, -0.6 * k, 0], hips: [TAU * smooth(p), 0, 0], spine: [0.8 * k, 0, 0], head: [0.6 * k, 0, 0], upperLegL: [-1.6 * k, 0, 0], upperLegR: [-1.6 * k, 0, 0], lowerLegL: [2.0 * k, 0, 0], lowerLegR: [2.0 * k, 0, 0], upperArmL: [-1.2 * k, 0, 0], upperArmR: [-1.2 * k, 0, 0] }; }),
  hurt: () => sampled('hurt', 0.4, false, 8, p => { const k = Math.sin(Math.PI * Math.min(1, p * 1.6)) * (1 - p * 0.5); return { spine: [-0.35 * k, 0.15 * k, 0], chest: [-0.2 * k, 0, 0], head: [-0.4 * k, 0, 0.1 * k], upperArmL: [-0.4 * k, 0, -0.6 * k], upperArmR: [-0.4 * k, 0, 0.6 * k], $root: [0, 0, -0.12 * k] }; }),
  die: () => sampled('die', 1.2, false, 12, p => { const k = smooth(clamp(p * 1.2, 0, 1)); return { $root: [0, -0.85 * k, -0.3 * k], hips: [-1.45 * k, 0, 0.15 * k], spine: [-0.15 * k, 0, 0], head: [-0.4 * k, 0.4 * k, 0], upperLegL: [0.15 * k, 0, 0], lowerLegL: [0.6 * k, 0, 0], upperLegR: [-0.2 * k, 0, 0], lowerLegR: [0.3 * k, 0, 0], upperArmL: [-0.4 * k, 0, -1.2 * k], upperArmR: [-2.4 * k, 0, 0.6 * k] }; }, [{ t: 0.9, event: 'thud' }]),
  talk: () => sampled('talk', 2.4, true, 12, p => { const s = Math.sin(TAU * p), s2 = Math.sin(TAU * p * 2); return { head: [0.06 * s2, 0.12 * s, 0], upperArmR: [-0.5 - 0.25 * Math.max(0, s), 0, 0.25], lowerArmR: [-1.1 - 0.3 * s2, 0, 0], upperArmL: [-0.1, 0, -0.1], chest: [0, 0.06 * s, 0] }; }),
  talk_gesture: () => sampled('talk_gesture', 2.0, true, 12, p => { const s = Math.sin(TAU * p); return { head: [0.05 * s, 0.1 * s, 0], upperArmR: [-0.7 - 0.3 * Math.max(0, s), 0, 0.3], lowerArmR: [-1.0, 0, 0], upperArmL: [-0.6 - 0.3 * Math.max(0, -s), 0, -0.3], lowerArmL: [-1.0, 0, 0] }; }),
  wave: () => sampled('wave', 1.0, true, 10, p => ({ upperArmR: [-2.6, 0, 0.3], lowerArmR: [0, 0, 0.5 * Math.sin(TAU * p * 2)], head: [0, 0.1, 0] })),
  sit: () => sampled('sit', 2, true, 2, still({ $root: [0, -0.48, 0.05], upperLegL: [-1.55, 0, 0.05], upperLegR: [-1.55, 0, -0.05], lowerLegL: [1.55, 0, 0], lowerLegR: [1.55, 0, 0], spine: [-0.05, 0, 0], upperArmL: [-0.4, 0, 0], upperArmR: [-0.4, 0, 0], lowerArmL: [-0.6, 0, 0], lowerArmR: [-0.6, 0, 0] })),
  meditate: () => sampled('meditate', 4, true, 8, p => ({ $root: [0, -0.78 + 0.01 * Math.sin(TAU * p), 0], upperLegL: [-1.5, 0.9, 0.5], upperLegR: [-1.5, -0.9, -0.5], lowerLegL: [2.4, 0, 0], lowerLegR: [2.4, 0, 0], upperArmL: [-0.5, 0, -0.2], upperArmR: [-0.5, 0, 0.2], lowerArmL: [-1.0, 0, 0], lowerArmR: [-1.0, 0, 0], chest: [0.03 * Math.sin(TAU * p), 0, 0], head: [0.15, 0, 0] })),
  drive: () => sampled('drive', 2, true, 4, p => ({ $root: [0, -0.48, 0], upperLegL: [-1.45, 0, 0.1], upperLegR: [-1.45, 0, -0.1], lowerLegL: [1.3, 0, 0], lowerLegR: [1.3, 0, 0], upperArmL: [-1.0, 0, -0.1], upperArmR: [-1.0, 0, 0.1], lowerArmL: [-0.5, 0.1 * Math.sin(TAU * p), 0], lowerArmR: [-0.5, 0.1 * Math.sin(TAU * p), 0] })),
  ride_walk: () => sampled('ride_walk', 1.0, true, 8, p => ({ $root: [0, -0.45 + 0.03 * Math.sin(2 * TAU * p), 0], upperLegL: [-1.1, 0, 0.6], upperLegR: [-1.1, 0, -0.6], lowerLegL: [1.2, 0, 0], lowerLegR: [1.2, 0, 0], upperArmL: [-0.7, 0, 0], upperArmR: [-0.7, 0, 0], lowerArmL: [-0.8, 0, 0], lowerArmR: [-0.8, 0, 0], spine: [0.05 * Math.sin(TAU * p), 0, 0] })),
  ride_gallop: () => sampled('ride_gallop', 0.5, true, 8, p => ({ $root: [0, -0.4 + 0.08 * Math.sin(TAU * p), 0.05], upperLegL: [-1.0, 0, 0.6], upperLegR: [-1.0, 0, -0.6], lowerLegL: [1.4, 0, 0], lowerLegR: [1.4, 0, 0], upperArmL: [-0.9, 0, 0], upperArmR: [-0.9, 0, 0], lowerArmL: [-0.6, 0, 0], lowerArmR: [-0.6, 0, 0], spine: [0.35 + 0.1 * Math.sin(TAU * p), 0, 0] })),
  mount: () => sampled('mount', 0.8, false, 8, p => { const k = Math.sin(Math.PI * p); return { $root: [0, 0.6 * smooth(p) - 0.45 * smooth(p), 0], upperLegR: [-1.4 * k, 0, -0.8 * k], lowerLegR: [1.2 * k, 0, 0], upperArmL: [-2.0 * k, 0, 0], upperArmR: [-2.0 * k, 0, 0] }; }),
  dismount: () => sampled('dismount', 0.7, false, 8, p => { const k = Math.sin(Math.PI * p); return { upperLegL: [-1.0 * k, 0, 0.8 * k], lowerLegL: [1.0 * k, 0, 0], upperArmL: [-1.5 * k, 0, 0], $root: [0, -0.2 * k, 0] }; }, [{ t: 0.65, event: 'land' }]),
  climb_up: () => sampled('climb_up', 0.9, true, 12, p => { const s = Math.sin(TAU * p); return { upperArmL: [-2.6 + 0.6 * s, 0, -0.15], upperArmR: [-2.6 - 0.6 * s, 0, 0.15], lowerArmL: [-0.4 - 0.5 * Math.max(0, -s), 0, 0], lowerArmR: [-0.4 - 0.5 * Math.max(0, s), 0, 0], upperLegL: [-0.9 - 0.5 * s, 0, 0], upperLegR: [-0.9 + 0.5 * s, 0, 0], lowerLegL: [1.2, 0, 0], lowerLegR: [1.2, 0, 0], spine: [-0.1, 0, 0] }; }, atDur(steps, 0.9)),
  climb_idle: () => sampled('climb_idle', 2, true, 4, p => ({ upperArmL: [-2.5, 0, -0.15], upperArmR: [-2.5, 0, 0.15], lowerArmL: [-0.5, 0, 0], lowerArmR: [-0.5, 0, 0], upperLegL: [-0.7, 0, 0], upperLegR: [-0.9, 0, 0], lowerLegL: [1.1, 0, 0], lowerLegR: [1.2, 0, 0], spine: [-0.1 + 0.02 * Math.sin(TAU * p), 0, 0] })),
  swim: () => sampled('swim', 1.2, true, 12, p => { const s = Math.sin(TAU * p), c = Math.cos(TAU * p); return { hips: [1.3, 0, 0], head: [-1.0, 0, 0], upperArmL: [-2.6 + 1.2 * s, 0, -0.5 - 0.5 * c], upperArmR: [-2.6 + 1.2 * s, 0, 0.5 + 0.5 * c], lowerArmL: [-0.3, 0, 0], lowerArmR: [-0.3, 0, 0], upperLegL: [0.3 * s, 0, 0.1], upperLegR: [-0.3 * s, 0, -0.1], lowerLegL: [0.3, 0, 0], lowerLegR: [0.3, 0, 0] }; }),
  glide_pose: () => sampled('glide_pose', 1.5, true, 6, p => ({ hips: [0.9, 0, 0], head: [-0.7, 0, 0], upperArmL: [0, 0, -1.4 + 0.05 * Math.sin(TAU * p)], upperArmR: [0, 0, 1.4 - 0.05 * Math.sin(TAU * p)], upperLegL: [0.2, 0, 0.1], upperLegR: [0.25, 0, -0.1], lowerLegL: [0.3, 0, 0], lowerLegR: [0.3, 0, 0] })),
  drink: () => sampled('drink', 1.2, false, 10, p => { const k = Math.sin(Math.PI * p); return { upperArmR: [-1.0 * k, 0, 0.6 * k], lowerArmR: [-2.0 * k, 0, 0], head: [-0.4 * k, 0, 0] }; }, [{ t: 0.6, event: 'release' }]),
  cook: () => sampled('cook', 1.6, true, 10, p => ({ $root: [0, -0.5, 0], upperLegL: [-1.6, 0, 0.2], upperLegR: [-1.6, 0, -0.2], lowerLegL: [2.2, 0, 0], lowerLegR: [2.2, 0, 0], upperArmR: [-1.2, 0, 0.2], lowerArmR: [-0.6 + 0.3 * Math.sin(TAU * p), 0, 0], upperArmL: [-0.9, 0, -0.2], lowerArmL: [-0.8, 0, 0], spine: [0.3, 0, 0], head: [0.3, 0, 0] })),
  interact: () => sampled('interact', 0.5, false, 6, p => { const k = Math.sin(Math.PI * p); return { upperArmR: [-1.4 * k, 0, 0], lowerArmR: [-0.2, 0, 0], spine: [0.15 * k, 0, 0] }; }, [{ t: 0.25, event: 'release' }]),
  victory: () => sampled('victory', 1.2, true, 10, p => { const b = Math.abs(Math.sin(TAU * p)); return { $root: [0, 0.12 * b, 0], upperArmL: [-2.8, 0, -0.3], upperArmR: [-2.8, 0, 0.3], head: [-0.2, 0, 0] }; }),
};

const QUADRUPED_LEGS = ['FL', 'FR', 'BL', 'BR'];
const quadGait = (offsets, amp, knee, bob, spine) => p => {
  const pose = { $root: [0, -bob * (1 - Math.cos(2 * TAU * p)) * 0.5, 0], spine: [spine * Math.sin(TAU * p), 0, 0], neck: [-spine * 0.6 * Math.sin(TAU * p), 0, 0], tail_1: [0.15 * Math.sin(TAU * p), 0.2 * Math.sin(TAU * p * 0.5), 0] };
  for (const leg of QUADRUPED_LEGS) {
    const q = TAU * (p + offsets[leg]), s = Math.sin(q);
    pose[`upperLeg${leg}`] = [-amp * s, 0, 0];
    pose[`lowerLeg${leg}`] = [(leg[0] === 'F' ? -1 : 1) * knee * Math.max(0, Math.cos(q)), 0, 0];
  }
  return pose;
};
const QUADRUPED = {
  idle: () => sampled('idle', 3, true, 8, p => ({ spine: [0.01 * Math.sin(TAU * p), 0, 0], neck: [0.04 * Math.sin(TAU * p), 0.08 * Math.sin(TAU * p * 0.5), 0], head: [0.05 * Math.sin(TAU * p), 0, 0], tail_1: [0, 0.25 * Math.sin(TAU * p), 0] })),
  walk: () => sampled('walk', 1.1, true, 16, quadGait({ BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 }, 0.32, 0.5, 0.02, 0.03), atDur([{ t: 0, event: 'step' }, { t: 0.25, event: 'step' }, { t: 0.5, event: 'step' }, { t: 0.75, event: 'step' }], 1.1)),
  run: () => sampled('run', 0.6, true, 16, quadGait({ FL: 0, BR: 0, FR: 0.5, BL: 0.5 }, 0.55, 0.8, 0.05, 0.05), atDur([{ t: 0, event: 'step' }, { t: 0.5, event: 'step' }], 0.6)),
  sprint: () => sampled('sprint', 0.45, true, 16, quadGait({ FL: 0, FR: 0.1, BL: 0.5, BR: 0.6 }, 0.85, 1.1, 0.1, 0.18), atDur([{ t: 0, event: 'step' }, { t: 0.5, event: 'step' }], 0.45)),
  jump: () => sampled('jump', 0.5, false, 8, p => { const k = Math.sin(Math.PI * p); return { spine: [-0.2 * k, 0, 0], upperLegFL: [-0.9 * k, 0, 0], upperLegFR: [-0.9 * k, 0, 0], upperLegBL: [0.8 * k, 0, 0], upperLegBR: [0.8 * k, 0, 0] }; }),
  hurt: () => sampled('hurt', 0.4, false, 6, p => { const k = Math.sin(Math.PI * p); return { spine: [0.15 * k, 0.2 * k, 0], neck: [0.4 * k, 0, 0], $root: [0, -0.05 * k, -0.1 * k] }; }),
  die: () => sampled('die', 1.0, false, 10, p => { const k = smooth(p); return { hips: [0, 0, 1.5 * k], $root: [0, -0.45 * k, 0], neck: [0.5 * k, 0, 0], upperLegFL: [-0.3 * k, 0, 0], upperLegBL: [0.3 * k, 0, 0] }; }, [{ t: 0.8, event: 'thud' }]),
  eat: () => sampled('eat', 2.0, true, 8, p => ({ neck: [1.0 + 0.1 * Math.sin(TAU * p * 2), 0, 0], head: [0.3, 0, 0] })),
  attack: () => sampled('attack', 0.6, false, 10, p => { const k = Math.sin(Math.PI * p); return { $root: [0, 0.1 * k, 0.35 * k], spine: [-0.2 * k, 0, 0], neck: [-0.3 * k, 0, 0], upperLegFL: [-1.0 * k, 0, 0], upperLegFR: [-1.0 * k, 0, 0] }; }, [{ t: 0.3, event: 'hit' }]),
};

// Words that map an unknown clip name onto a preset (planner-invented names).
const ALIASES = [
  [/attack|strike|slash|combo|punch|kick|bite|claw|smash/, 'light_attack_1'], [/heavy|slam|overhead|charge/, 'heavy_attack'],
  [/cast|spell|sign|magic|channel/, 'sign_cast'], [/shoot|fire|throw|release/, 'shoot'], [/aim|draw/, 'aim'],
  [/roll|dodge|evade|dash/, 'dodge_roll'], [/block|guard|shield/, 'block_idle'], [/parry|deflect/, 'parry'],
  [/hurt|hit|stagger|flinch/, 'hurt'], [/die|death|dead|faint/, 'die'], [/talk|speak|chat|gesture/, 'talk'],
  [/sit|rest|bench/, 'sit'], [/climb/, 'climb_up'], [/swim|dive/, 'swim'], [/glide|fly|soar/, 'glide_pose'],
  [/ride|gallop/, 'ride_walk'], [/drive|steer/, 'drive'], [/mine|dig|chop|hammer|smith/, 'mine'], [/place|build|plant/, 'place'],
  [/drink|eat|potion/, 'drink'], [/cook|craft|brew/, 'cook'], [/pray|meditat|kneel/, 'meditate'], [/wave|greet|emote|cheer/, 'wave'],
  [/victory|celebrat|win/, 'victory'], [/sprint/, 'sprint'], [/run|jog/, 'run'], [/walk|stroll/, 'walk'], [/jump|leap/, 'jump'],
  [/land/, 'land'], [/fall/, 'fall'], [/use|interact|open|pick/, 'interact'], [/idle|stand|breath/, 'idle'],
];

export const PRESETS = { humanoid: Object.keys(HUMANOID), quadruped: Object.keys(QUADRUPED) };

/** Resolve a clip name for a rig to a library preset id, or null when nothing fits. */
export function resolvePreset(name, rig = 'humanoid') {
  const lib = rig === 'quadruped' ? QUADRUPED : HUMANOID;
  if (lib[name]) return name;
  for (const [re, id] of ALIASES) if (re.test(name)) {
    if (lib[id]) return id;
    if (rig === 'quadruped') return /attack|strike|bite|claw|heavy/.test(name) ? 'attack' : /run|sprint|gallop|dash/.test(name) ? 'run' : null;
  }
  return null;
}

const cache = new Map();
/** Build (memoized) the clip for a preset name; `as` renames it (so 'light_attack_2' keeps its id). */
export function presetClip(name, rig = 'humanoid') {
  const key = `${rig}:${name}`;
  if (cache.has(key)) return cache.get(key);
  const id = resolvePreset(name, rig);
  if (!id) return null;
  const lib = rig === 'quadruped' ? QUADRUPED : HUMANOID;
  const clip = { ...lib[id](), id: name, source: id };
  cache.set(key, clip);
  return clip;
}

// --- Locomotion ---------------------------------------------------------------

/**
 * Blend weights over idle / walk / run (/ sprint) from horizontal speed.
 * thresholds = [idleMax, walkSpeed, runSpeed] m/s (graphics.anim.locomotion idleWalkRun).
 * Returns weights that sum to 1.
 */
export function speedWeights(speed, thresholds = [0.2, 3, 6], sprintSpeed = null) {
  const [idleMax, walk, run] = thresholds;
  const w = { idle: 0, walk: 0, run: 0, sprint: 0 };
  if (speed <= idleMax) { w.idle = 1; return w; }
  if (speed < walk) { const t = (speed - idleMax) / Math.max(1e-6, walk - idleMax); w.idle = 1 - t; w.walk = t; return w; }
  if (speed < run) { const t = (speed - walk) / Math.max(1e-6, run - walk); w.walk = 1 - t; w.run = t; return w; }
  const sp = sprintSpeed ?? run * 1.35;
  if (speed < sp) { const t = (speed - run) / Math.max(1e-6, sp - run); w.run = 1 - t; w.sprint = t; return w; }
  w.sprint = 1; return w;
}

/** Direction weights for strafing from the velocity angle relative to facing (radians, 0 = forward, +π/2 = left). */
export function directionWeights(angle) {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const fwd = Math.max(0, Math.cos(a)), back = Math.max(0, -Math.cos(a)), left = Math.max(0, Math.sin(a)), right = Math.max(0, -Math.sin(a));
  const total = fwd + back + left + right || 1;
  return { forward: fwd / total, back: back / total, left: left / total, right: right / total };
}

/**
 * The full locomotion blend: state + weights over clips, plus the gait phase rate.
 * input: { speed, angle (velocity vs facing), grounded, vy, state ('swim'|'climb'|'glide'|'ride'|'drive'|'crouch'|'lockon'), turnRate }
 * cfg: { idleWalkRun, strafe, states, turnLean }
 * Returns { state, weights: { clipId: w }, lean: [pitch, roll], strideRate (cycles per metre) }.
 */
export function locomotionBlend(input, cfg = {}) {
  const thresholds = cfg.idleWalkRun || [0.2, 3, 6];
  const allowed = new Set(cfg.states || ['grounded', 'airborne']);
  const state = input.state && allowed.has(input.state) ? input.state : (input.grounded === false && allowed.has('airborne') ? 'airborne' : 'grounded');
  const weights = {};
  const sw = speedWeights(input.speed, thresholds);
  const lean = [0, clamp(-(input.turnRate || 0) * (cfg.turnLean ?? 0.2) * Math.min(1, input.speed / Math.max(1e-6, thresholds[2])), -0.5, 0.5)];
  if (state === 'airborne') { if ((input.vy ?? 0) > 0.5) weights.jump = 1; else weights.fall = 1; }
  else if (state === 'swim') weights.swim = 1;
  else if (state === 'climb') weights[input.speed > thresholds[0] ? 'climb_up' : 'climb_idle'] = 1;
  else if (state === 'glide') weights.glide_pose = 1;
  else if (state === 'ride') weights[input.speed > thresholds[2] ? 'ride_gallop' : 'ride_walk'] = 1;
  else if (state === 'drive') weights.drive = 1;
  else if (state === 'crouch') { weights.crouch_walk = 1 - sw.idle; weights.idle = sw.idle; }
  else {
    const moving = 1 - sw.idle;
    weights.idle = sw.idle;
    const strafing = (cfg.strafe || state === 'lockon') && input.speed > thresholds[0];
    if (strafing) {
      const d = directionWeights(input.angle || 0);
      const fwdGait = { walk: sw.walk, run: sw.run, sprint: sw.sprint };
      for (const [k, v] of Object.entries(fwdGait)) if (v) weights[k] = (weights[k] || 0) + v * d.forward;
      if (d.back) weights.walk_back = moving * d.back;
      if (d.left) weights.strafe_left = moving * d.left;
      if (d.right) weights.strafe_right = moving * d.right;
    } else { if (sw.walk) weights.walk = sw.walk; if (sw.run) weights.run = sw.run; if (sw.sprint) weights.sprint = sw.sprint; }
    lean[0] = clamp(input.speed / Math.max(1e-6, thresholds[2]) * 0.06, 0, 0.12);
  }
  for (const k of Object.keys(weights)) if (weights[k] <= 1e-6) delete weights[k];
  // Stride: cycles per metre so feet don't slide (walk ~1.4 m per cycle, run ~2.6 m).
  const strideLen = 1.4 * (sw.idle + sw.walk) + 2.6 * sw.run + 3.2 * sw.sprint;
  return { state, weights, lean, strideRate: 1 / Math.max(0.5, strideLen) };
}
