// Fighter rig: a 2D skeleton (hips, torso, neck, head, upper/lower arms and legs) drawn in code
// on canvas with dark outlines and two-tone cel shading. Poses are keyframes of joint angles;
// the renderer picks keyframes from the fighter's state and move phase and interpolates them.
//
// Local units: an average fighter is 100 tall, faces +x, feet on y = 0 with y DOWN (canvas).
// Limb angles are degrees from straight down; positive swings forward (toward +x).

import { HEIGHT } from './moves.js';

const D2R = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
export const ease = t => t * t * (3 - 2 * t);

// ---------- poses ----------
const BASE = { x: 0, y: 0, lean: 6, head: -4, sN: 52, eN: 96, sF: 36, eF: 112, hN: 22, kN: 22, hF: -22, kF: 14, rot: 0, plant: 1, open: 0 };
const P = o => ({ ...BASE, ...o });
export const POSES = {
  guard: P({}),
  crouch: P({ y: 0, lean: 22, head: -10, sN: 60, eN: 110, sF: 45, eF: 120, hN: 88, kN: 128, hF: 30, kF: 120 }),
  block: P({ lean: -8, head: 10, sN: 82, eN: 128, sF: 70, eF: 136, hN: 14, kN: 26, hF: -26, kF: 18 }),
  blockLow: P({ lean: 14, head: 6, sN: 70, eN: 132, sF: 58, eF: 138, hN: 86, kN: 128, hF: 30, kF: 120 }),
  prejump: P({ lean: 16, sN: 30, eN: 70, sF: 20, eF: 80, hN: 60, kN: 90, hF: 10, kF: 80 }),
  jumpUp: P({ lean: 4, head: -8, sN: 130, eN: 40, sF: 100, eF: 60, hN: 70, kN: 110, hF: 40, kF: 100, plant: 0 }),
  jumpFall: P({ lean: 0, head: 0, sN: 70, eN: 50, sF: 40, eF: 60, hN: 30, kN: 40, hF: -10, kF: 20, plant: 0 }),
  land: P({ lean: 20, sN: 40, eN: 80, sF: 30, eF: 90, hN: 60, kN: 90, hF: 14, kF: 80 }),
  dash: P({ lean: 26, head: -14, sN: -30, eN: 60, sF: 70, eF: 80, hN: 50, kN: 40, hF: -40, kF: 50 }),
  backdash: P({ lean: -16, head: 6, sN: 70, eN: 120, sF: 50, eF: 120, hN: 40, kN: 50, hF: -10, kF: 60, plant: 0 }),
  hit: P({ x: -4, lean: -22, head: -22, sN: 20, eN: 40, sF: -10, eF: 30, hN: 12, kN: 30, hF: -24, kF: 10 }),
  hitCrouch: P({ x: -3, lean: -6, head: -24, sN: 30, eN: 40, sF: 10, eF: 40, hN: 80, kN: 120, hF: 30, kF: 120 }),
  launch: P({ lean: -40, head: -30, sN: 150, eN: 30, sF: 110, eF: 20, hN: 40, kN: 50, hF: 10, kF: 30, rot: -30, plant: 0 }),
  down: P({ y: 0, lean: 0, head: 6, sN: 160, eN: 20, sF: 120, eF: 30, hN: 10, kN: 30, hF: -6, kF: 6, rot: -90, plant: 0, lie: 1 }),
  dazed: P({ lean: -4, head: 18, sN: 6, eN: 14, sF: -4, eF: 10, hN: 12, kN: 18, hF: -12, kF: 10 }),
  fall: P({ lean: -10, head: -10, sN: 160, eN: 30, sF: 140, eF: 40, hN: 30, kN: 60, hF: -20, kF: 40, plant: 0 }),
  thrown: P({ lean: -30, head: -20, sN: 120, eN: 40, sF: 100, eF: 30, hN: 30, kN: 60, hF: 10, kF: 70, plant: 0 }),
  ledge: P({ lean: 0, head: -20, sN: 172, eN: 6, sF: 168, eF: 10, hN: 6, kN: 20, hF: -6, kF: 30, plant: 0 }),
  win0: P({ lean: 0, head: -16, sN: 172, eN: 8, sF: 20, eF: 120, hN: 10, kN: 6, hF: -10, kF: 4, open: 0 }),
  win1: P({ lean: -4, head: -10, sN: 80, eN: 140, sF: 70, eF: 145, hN: 12, kN: 4, hF: -12, kF: 4 }),
  win2: P({ lean: 40, head: 20, sN: 30, eN: 90, sF: 20, eF: 100, hN: 4, kN: 4, hF: -4, kF: 4 }),
  win3: P({ lean: 0, head: -8, sN: 120, eN: 120, sF: 110, eF: 130, hN: 30, kN: 30, hF: -30, kF: 30 }),
  flourish: P({ lean: -8, head: -14, sN: 150, eN: 10, sF: 110, eF: 20, hN: 36, kN: 30, hF: -34, kF: 20, open: 1 }),
};
// Moves: wind-up and strike keyframes (and an optional custom recovery).
export const MOVE_POSES = {
  jab: { wind: P({ sN: 60, eN: 120, lean: 8 }), hit: P({ x: 4, sN: 90, eN: 0, sF: 40, eF: 120, lean: 14, head: -2 }) },
  kick: { wind: P({ lean: -6, hN: 92, kN: 130, sN: 70, eN: 100 }), hit: P({ lean: -24, head: 6, hN: 100, kN: 2, hF: -8, kF: 4, sN: 30, eN: 80, sF: 10, eF: 70 }) },
  cjab: { wind: { ...POSES.crouch, sN: 55, eN: 120 }, hit: { ...POSES.crouch, x: 4, sN: 88, eN: 0, lean: 26 } },
  sweep: { wind: { ...POSES.crouch, lean: 30, hN: 70, kN: 140 }, hit: { ...POSES.crouch, lean: 36, head: -18, hN: 88, kN: 0, hF: 60, kF: 145, sN: 10, eN: 40, sF: -20, eF: 30 } },
  jpunch: { wind: { ...POSES.jumpUp, sN: 60, eN: 120 }, hit: { ...POSES.jumpUp, sN: 50, eN: 0, lean: 10, hN: 60, kN: 100 } },
  jkick: { wind: { ...POSES.jumpUp, hN: 80, kN: 130 }, hit: { ...POSES.jumpUp, lean: -12, hN: 52, kN: 0, hF: 10, kF: 110, sN: 110, eN: 40 } },
  throw: { wind: P({ sN: 85, eN: 20, sF: 80, eF: 30, lean: 16, open: 1 }), hit: P({ sN: 150, eN: 30, sF: 130, eF: 40, lean: -20, head: -10 }) },
  fireball: { wind: P({ lean: -6, sN: -30, eN: 100, sF: -20, eF: 110, hN: 40, kN: 40, hF: -36, kF: 20, open: 1 }), hit: P({ x: 4, lean: 16, sN: 88, eN: 0, sF: 84, eF: 6, hN: 44, kN: 30, hF: -40, kF: 8, open: 1, shout: 1 }) },
  ground_wave: { wind: P({ lean: -10, sN: 165, eN: 20, sF: 140, eF: 30, open: 1 }), hit: { ...POSES.crouch, lean: 40, sN: 50, eN: 0, sF: 40, eF: 10, open: 1, shout: 1 } },
  uppercut: { wind: { ...POSES.crouch, sN: -20, eN: 80 }, hit: P({ lean: 4, head: -18, sN: 176, eN: 4, sF: 40, eF: 100, hN: 80, kN: 96, hF: -10, kF: 6, plant: 0, shout: 1 }) },
  spin_kick: { wind: P({ hN: 70, kN: 110, sN: 100, eN: 30, sF: 100, eF: 30 }), hit: P({ lean: -6, sN: 95, eN: 10, sF: 95, eF: 10, hN: 94, kN: 0, hF: 20, kF: 110, plant: 0, spin: 1 }) },
  charge_dash: { wind: P({ lean: -10, sN: 40, eN: 120, hN: 50, kN: 60 }), hit: P({ lean: 58, head: -40, sN: 100, eN: 70, sF: 60, eF: 90, hN: -10, kN: 40, hF: -55, kF: 30, shout: 1 }) },
  slide: { wind: { ...POSES.crouch }, hit: P({ y: -6, lean: -42, head: 20, sN: -40, eN: 30, sF: -50, eF: 20, hN: 88, kN: 0, hF: 40, kF: 130, plant: 0 }) },
  command_grab: { wind: P({ lean: 10, sN: 105, eN: 10, sF: 110, eF: 10, open: 1 }), hit: P({ lean: 20, sN: 80, eN: 70, sF: 80, eF: 80, open: 1, shout: 1 }) },
  teleport: { wind: P({ lean: 0, sN: 100, eN: 140, sF: 90, eF: 140, hN: 4, kN: 4, hF: -4, kF: 4 }), hit: P({ lean: 0, sN: 100, eN: 140, sF: 90, eF: 140, hN: 4, kN: 4, hF: -4, kF: 4 }) },
  counter: { wind: P({ lean: -4, sN: 90, eN: 30, sF: 130, eF: 90, hN: 40, kN: 30, hF: -40, kF: 20, open: 1 }), hit: P({ lean: -4, sN: 90, eN: 30, sF: 130, eF: 90, hN: 40, kN: 30, hF: -40, kF: 20, open: 1 }), strike: P({ x: 6, lean: 18, sN: 92, eN: 0, sF: 30, eF: 110, hN: 46, kN: 30, hF: -40, kF: 8, open: 1, shout: 1 }) },
  air_dive: { wind: { ...POSES.jumpUp }, hit: P({ rot: 34, lean: 0, head: -20, hN: 18, kN: 0, hF: 60, kF: 120, sN: -40, eN: 30, sF: -60, eF: 20, plant: 0 }) },
  flurry: { wind: P({ sN: 60, eN: 120, lean: 10 }), hit: P({ x: 3, lean: 14, sN: 92, eN: 4, sF: 60, eF: 120, hN: 36, kN: 30, hF: -34, kF: 10, shout: 1, flurry: 1 }) },
  axe_kick: { wind: P({ lean: -16, hN: 172, kN: 10, sN: 60, eN: 90, sF: 30, eF: 100, plant: 0 }), hit: P({ lean: 22, hN: 62, kN: 0, sN: 20, eN: 80, sF: 10, eF: 90, plant: 0 }) },
  super_beam: { wind: P({ lean: -10, sN: -40, eN: 110, sF: -30, eF: 120, hN: 50, kN: 60, hF: -40, kF: 30, open: 1 }), hit: P({ x: 5, lean: 18, sN: 90, eN: 0, sF: 86, eF: 4, hN: 52, kN: 40, hF: -44, kF: 8, open: 1, shout: 1 }) },
  super_rush: { wind: P({ lean: 20, sN: -20, eN: 80, hN: 50, kN: 60 }), hit: P({ x: 3, lean: 22, sN: 92, eN: 4, sF: 60, eF: 120, hN: 40, kN: 30, hF: -40, kF: 10, shout: 1, flurry: 1 }) },
  super_rising: { wind: { ...POSES.crouch, sN: -30, eN: 90 }, hit: P({ lean: 0, head: -20, sN: 178, eN: 2, sF: 160, eF: 10, hN: 60, kN: 80, hF: -10, kF: 6, plant: 0, shout: 1, spin: 1 }) },
  super_grab: { wind: P({ lean: 12, sN: 105, eN: 10, sF: 110, eF: 10, open: 1 }), hit: P({ lean: 24, sN: 85, eN: 60, sF: 85, eF: 70, open: 1, shout: 1 }) },
};

export function blend(a, b, t) {
  const out = {};
  for (const k of Object.keys(BASE)) out[k] = lerp(a[k] ?? BASE[k], b[k] ?? BASE[k], t);
  for (const k of ['shout', 'flurry', 'spin', 'lie']) out[k] = t < 0.5 ? (a[k] || 0) : (b[k] || 0);
  return out;
}

/** Walk cycle at phase ph (radians); dir +1 forward, -1 back. */
export function walkPose(ph, dir) {
  const s = Math.sin(ph), c = Math.cos(ph);
  return P({ lean: dir > 0 ? 10 : 0, hN: 18 + s * 22 * dir, kN: 18 + Math.max(0, -c) * 40, hF: -18 - s * 22 * dir, kF: 14 + Math.max(0, c) * 40, sN: 52 - s * 6, sF: 36 + s * 6 });
}

/** Pose for a fighter: kind is the pose key or move anim, with phase progress. */
export function poseFor(view) {
  const { st, t, anim, phase, prog, crouch, walk, winPose, jumpVy, idleT } = view;
  const bob = Math.sin(idleT * 0.12) * 1.6;
  const breathe = (p) => ({ ...p, y: p.y + bob, sN: p.sN + bob * 1.5, sF: p.sF + bob });
  switch (st) {
    case 'idle': return breathe(POSES.guard);
    case 'walk': return walkPose(t * 0.22, walk);
    case 'crouch': return breathe(POSES.crouch);
    case 'guard': case 'block': return crouch ? POSES.blockLow : POSES.block;
    case 'prejump': return POSES.prejump;
    case 'air': return blend(POSES.jumpUp, POSES.jumpFall, clamp01((4 - jumpVy) / 10));
    case 'land': return POSES.land;
    case 'dash': return POSES.dash;
    case 'backdash': return POSES.backdash;
    case 'hit': return crouch ? POSES.hitCrouch : blend(POSES.hit, POSES.guard, clamp01(t / 20) * 0.4);
    case 'launch': return blend(POSES.launch, POSES.fall, clamp01((2 - jumpVy) / 12));
    case 'knockdown': case 'ko': return POSES.down;
    case 'wakeup': return t < 8 ? blend(POSES.down, POSES.crouch, ease(t / 8)) : blend(POSES.crouch, POSES.guard, ease((t - 8) / 8));
    case 'thrown': return POSES.thrown;
    case 'throw': return blend(MOVE_POSES.throw.wind, MOVE_POSES.throw.hit, ease(clamp01((t - 12) / 12)));
    case 'dazed': return { ...POSES.dazed, lean: -4 + Math.sin(idleT * 0.08) * 10, head: 18 + Math.sin(idleT * 0.11) * 10 };
    case 'win': return blend(POSES.guard, POSES[`win${winPose % 4}`], ease(clamp01(t / 14)));
    case 'flourish': return blend(POSES.guard, POSES.flourish, ease(clamp01(t / 18)));
    case 'flourished': return POSES.dazed;
    case 'fall': return POSES.fall;
    case 'ledge': return POSES.ledge;
    case 'climb': return blend(POSES.ledge, POSES.crouch, ease(clamp01(t / 14)));
    case 'respawn': return breathe(POSES.guard);
    case 'attack': {
      const mp = MOVE_POSES[anim] || MOVE_POSES.jab;
      const rest = view.air ? POSES.jumpFall : anim === 'cjab' || anim === 'sweep' ? POSES.crouch : POSES.guard;
      let p;
      if (phase === 'startup') p = prog < 0.65 ? blend(rest, mp.wind, ease(prog / 0.65)) : blend(mp.wind, mp.hit, ease((prog - 0.65) / 0.35));
      else if (phase === 'active') p = view.counterStrike ? mp.strike || mp.hit : mp.hit;
      else p = view.counterStrike && mp.strike ? blend(mp.strike, rest, ease(prog)) : blend(mp.hit, rest, ease(prog));
      if (p.flurry && phase === 'active') { const k = Math.floor(t / 3) % 2; p = k ? { ...p, sN: 60, eN: 120, sF: 92, eF: 4 } : p; }
      return p;
    }
    default: return POSES.guard;
  }
}

// ---------- skeleton ----------
function bones(build) {
  const w = { lean: 0.85, average: 1, heavy: 1.22, towering: 1.3 }[build] || 1;
  return { hip: 46, torso: 32, neck: 4, head: 10.5, upper: 17, fore: 16, thigh: 24.5, shin: 23.5, chest: 15 * w, waist: 10 * w, limb: 8.6 * Math.sqrt(w), leg: 9.8 * Math.sqrt(w), fist: 5.8 * Math.sqrt(w) };
}
const dir = a => [Math.sin(a * D2R), Math.cos(a * D2R)];
const add = (p, a, l) => { const [dx, dy] = dir(a); return [p[0] + dx * l, p[1] + dy * l]; };

/** Joint positions for a pose (local units, y down, feet planted when pose.plant). */
export function solve(pose, build) {
  const B = bones(build);
  let hip = [pose.x, -B.hip + pose.y];
  const legs = side => { const h = pose[`h${side}`], k = pose[`k${side}`]; const knee = add(hip, h, B.thigh); const foot = add(knee, h - k, B.shin); return { knee, foot }; };
  let lN = legs('N'), lF = legs('F');
  if (pose.plant) { const low = Math.max(lN.foot[1], lF.foot[1]); hip = [hip[0], hip[1] - low]; lN = legs('N'); lF = legs('F'); }
  const up = pose.lean;
  const neck = [hip[0] + Math.sin(up * D2R) * B.torso, hip[1] - Math.cos(up * D2R) * B.torso];
  const head = [neck[0] + Math.sin((up + pose.head) * D2R) * (B.neck + B.head * 0.8), neck[1] - Math.cos((up + pose.head) * D2R) * (B.neck + B.head * 0.8)];
  const sh = [lerp(hip[0], neck[0], 0.88), lerp(hip[1], neck[1], 0.88)];
  const arm = side => { const s = pose[`s${side}`] + up * 0.5, e = pose[`e${side}`]; const elbow = add(sh, s, B.upper); const hand = add(elbow, s + e, B.fore); return { elbow, hand, s, e }; };
  return { B, hip, neck, head, sh, lean: up, headTilt: pose.head, aN: arm('N'), aF: arm('F'), lN, lF };
}

// ---------- palette ----------
function hexRgb(h) { const n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgbHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => { const A = hexRgb(a), Bc = hexRgb(b); return rgbHex(A.map((v, i) => v + (Bc[i] - v) * t)); };
export const shadeHex = (c, k) => mixHex(c, '#000000', k);
export const lightHex = (c, k) => mixHex(c, '#ffffff', k);
function hueRotate(c, deg) {
  let [r, g, b] = hexRgb(c).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  h = (h + deg + 360) % 360;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbHex([f(0), f(8), f(4)].map(v => v * 255));
}

/** Colors and parts for a fighter: content look, optionally steered by an art-direction look. */
export function paletteFor(look, { mirror = false, direction = null } = {}) {
  const c = { ...look };
  if (direction?.colors) {
    // The art director's look nudges the content palette toward the game's locked style.
    c.primary = mixHex(c.primary, direction.colors.primary, 0.25);
    c.accent = mixHex(c.accent, direction.colors.accent, 0.2);
  }
  if (mirror) for (const k of ['primary', 'secondary', 'accent', 'hairColor']) c[k] = hueRotate(c[k], 150);
  const outline = mixHex(shadeHex(c.primary, 0.75), '#0a0a14', 0.6);
  return { ...c, outline, skinShade: shadeHex(c.skin, 0.22), primaryShade: shadeHex(c.primary, 0.26), secondaryShade: shadeHex(c.secondary, 0.26), accentShade: shadeHex(c.accent, 0.25) };
}

// ---------- drawing ----------
function limb(ctx, pts, w, color, shadeColor, O, ol) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.strokeStyle = O; ctx.lineWidth = w + ol * 2; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  // Cel shadow along the lower edge, then a crisp light rim.
  ctx.beginPath(); ctx.moveTo(pts[0][0] + w * 0.18, pts[0][1] + w * 0.16); for (const p of pts.slice(1)) ctx.lineTo(p[0] + w * 0.18, p[1] + w * 0.16);
  ctx.strokeStyle = shadeColor; ctx.lineWidth = w * 0.42; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pts[0][0] - w * 0.2, pts[0][1] - w * 0.2); for (const p of pts.slice(1)) ctx.lineTo(p[0] - w * 0.2, p[1] - w * 0.2);
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = w * 0.22; ctx.stroke();
}
function blob(ctx, x, y, r, fill, O, ol, shadeColor) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  if (shadeColor) { ctx.save(); ctx.clip(); ctx.beginPath(); ctx.arc(x + r * 0.45, y + r * 0.4, r * 0.95, 0, Math.PI * 2); ctx.fillStyle = shadeColor; ctx.fill(); ctx.restore(); }
  ctx.lineWidth = ol; ctx.strokeStyle = O; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}
function poly(ctx, pts, fill, O, ol) {
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); if (O) { ctx.lineWidth = ol; ctx.strokeStyle = O; ctx.lineJoin = 'round'; ctx.stroke(); }
}

/**
 * Draw a fighter at the current transform (origin at the feet, facing +x, y down, 1 unit = 1).
 * opts: { pal, outfit, hair, headwear, build, face: 'calm'|'fight'|'hurt'|'ko'|'shout', time, flash, alpha, aura }
 */
export function drawFighter(ctx, pose, o) {
  const J = solve(pose, o.build), B = J.B, pal = o.pal, O = pal.outline, ol = 1.9;
  ctx.save();
  if (pose.rot) { ctx.translate(J.hip[0], J.hip[1]); ctx.rotate(pose.rot * D2R); ctx.translate(-J.hip[0], -J.hip[1]); }
  if (pose.lie) ctx.translate(-8, B.hip - 9);
  const outfit = o.outfit, sleeve = outfit === 'vest' ? pal.skin : pal.primary, sleeveShade = outfit === 'vest' ? pal.skinShade : pal.primaryShade;
  const foreC = ['bodysuit', 'robe', 'jacket', 'armor'].includes(outfit) ? pal.primary : pal.skin, foreS = foreC === pal.skin ? pal.skinShade : pal.primaryShade;
  const handC = outfit === 'gi' || outfit === 'robe' ? pal.skin : pal.accent;
  const footC = outfit === 'gi' ? pal.skin : shadeHex(pal.secondary, 0.45);
  const far = c => shadeHex(c, 0.2);
  const drawArm = (a, isFar) => {
    const k = isFar ? far : c => c;
    limb(ctx, [J.sh, a.elbow], B.limb, k(sleeve), k(sleeveShade), O, ol);
    limb(ctx, [a.elbow, a.hand], B.limb * 0.92, k(foreC), k(foreS), O, ol);
    if (outfit === 'armor') blob(ctx, J.sh[0], J.sh[1] + 1, B.limb * 0.95, k(pal.accent), O, ol, k(pal.accentShade));
    if (outfit === 'gi' && !isFar) { ctx.strokeStyle = pal.primaryShade; ctx.lineWidth = 1.2; }
    blob(ctx, a.hand[0], a.hand[1], B.fist * (pose.open ? 0.95 : 1.05), k(handC), O, ol, k(shadeHex(handC, 0.22)));
  };
  const drawLeg = (l, isFar) => {
    const k = isFar ? far : c => c;
    limb(ctx, [J.hip, l.knee], B.leg, k(pal.secondary), k(pal.secondaryShade), O, ol);
    limb(ctx, [l.knee, l.foot], B.leg * 0.88, k(pal.secondary), k(pal.secondaryShade), O, ol);
    // Foot: a rounded wedge pointing forward.
    const [fx, fy] = l.foot;
    ctx.save(); ctx.translate(fx, fy);
    ctx.beginPath(); ctx.moveTo(-3, -3); ctx.quadraticCurveTo(-4, 3, 2, 3); ctx.lineTo(9, 3); ctx.quadraticCurveTo(10, -1, 5, -4); ctx.closePath();
    ctx.fillStyle = k(footC); ctx.fill(); ctx.lineWidth = ol; ctx.strokeStyle = O; ctx.stroke();
    ctx.restore();
    if (outfit === 'armor' || outfit === 'jacket') { ctx.beginPath(); ctx.moveTo(l.foot[0] - 3, l.foot[1] - 7); ctx.lineTo(l.foot[0] + 4, l.foot[1] - 7); ctx.strokeStyle = k(pal.accent); ctx.lineWidth = 2.4; ctx.stroke(); }
  };
  // Back to front: far arm, far leg, robe back, torso, near leg, head, near arm.
  drawArm(J.aF, true);
  drawLeg(J.lF, true);
  drawTorso(ctx, J, B, pal, outfit, O, ol, pose, o.time);
  drawLeg(J.lN, false);
  if (outfit === 'robe') robeFront(ctx, J, B, pal, O, ol, o.time);
  drawHead(ctx, J, B, pal, o, O, ol);
  drawArm(J.aN, false);
  ctx.restore();
  return J;
}

function torsoPts(J, B, shrink = 1) {
  const a = J.lean * D2R, ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux;  // up vector and its perpendicular
  const hx = J.hip[0], hy = J.hip[1], nx = J.neck[0], ny = J.neck[1];
  const W1 = B.chest * shrink, W0 = B.waist * shrink;
  return { pts: [[hx - px * W0, hy - py * W0], [hx + px * W0, hy + py * W0], [nx + px * W1 - ux * 2, ny + py * W1 - uy * 2], [nx - px * W1 * 0.8 - ux * 2, ny - py * W1 * 0.8 - uy * 2]], ux, uy, px, py };
}

function drawTorso(ctx, J, B, pal, outfit, O, ol, pose, time) {
  const { pts, ux, uy, px, py } = torsoPts(J, B);
  const bodyC = outfit === 'vest' ? pal.skin : pal.primary, bodyS = outfit === 'vest' ? pal.skinShade : pal.primaryShade;
  if (outfit === 'robe') {
    // Robe skirt behind the legs.
    const sway = Math.sin(time * 0.1) * 3;
    poly(ctx, [[J.hip[0] - 12, J.hip[1] - 2], [J.hip[0] + 12, J.hip[1] - 2], [J.hip[0] + 16 + sway, J.hip[1] + 26], [J.hip[0] - 18 + sway, J.hip[1] + 24]], shadeHex(pal.primary, 0.15), O, ol);
  }
  poly(ctx, pts, bodyC, O, ol);
  // Cel shadow on the back half.
  ctx.save(); ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.clip();
  poly(ctx, [pts[0], [lerp(pts[0][0], pts[1][0], 0.38), lerp(pts[0][1], pts[1][1], 0.38)], [lerp(pts[3][0], pts[2][0], 0.3), lerp(pts[3][1], pts[2][1], 0.3)], pts[3]], bodyS);
  if (outfit === 'vest') {
    poly(ctx, [pts[0], [lerp(pts[0][0], pts[1][0], 0.3), lerp(pts[0][1], pts[1][1], 0.3)], [lerp(pts[3][0], pts[2][0], 0.25), lerp(pts[3][1], pts[2][1], 0.25)], pts[3]], pal.primary);
    poly(ctx, [[lerp(pts[0][0], pts[1][0], 0.85), lerp(pts[0][1], pts[1][1], 0.85)], pts[1], pts[2], [lerp(pts[3][0], pts[2][0], 0.8), lerp(pts[3][1], pts[2][1], 0.8)]], pal.primary);
  }
  if (outfit === 'gi') {
    // Crossed lapels.
    const n = J.neck, m = [lerp(J.hip[0], n[0], 0.45), lerp(J.hip[1], n[1], 0.45)];
    ctx.beginPath(); ctx.moveTo(n[0] + px * B.chest * 0.7, n[1] + py * B.chest * 0.7); ctx.lineTo(m[0] + px * 2, m[1] + py * 2); ctx.lineTo(n[0] - px * B.chest * 0.4, n[1] - py * B.chest * 0.4);
    ctx.strokeStyle = shadeHex(pal.primary, 0.35); ctx.lineWidth = 1.6; ctx.stroke();
    poly(ctx, [[n[0] + px * 3, n[1] + py * 3], [m[0] + px * 2, m[1] + py * 2], [n[0] - px * 1, n[1] - py * 1]], pal.skin);
  }
  if (outfit === 'armor') {
    const c = [lerp(J.hip[0], J.neck[0], 0.62), lerp(J.hip[1], J.neck[1], 0.62)];
    ctx.beginPath(); ctx.ellipse(c[0] + px * 2, c[1] + py * 2, B.chest * 0.75, 7, J.lean * D2R, 0, Math.PI * 2); ctx.fillStyle = lightHex(pal.primary, 0.18); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.accent; ctx.stroke();
  }
  if (outfit === 'bodysuit') {
    ctx.beginPath(); ctx.moveTo(J.neck[0] + px * 6, J.neck[1] + py * 6); ctx.lineTo(J.hip[0] + px * 4, J.hip[1] + py * 4);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 3; ctx.stroke();
  }
  if (outfit === 'jacket') {
    ctx.beginPath(); ctx.moveTo(J.neck[0] + px * 2, J.neck[1] + py * 2); ctx.lineTo(J.hip[0] + px * 3, J.hip[1] + py * 3);
    ctx.strokeStyle = shadeHex(pal.primary, 0.45); ctx.lineWidth = 1.4; ctx.stroke();
    poly(ctx, [[J.neck[0] - px * 6 - ux * 1, J.neck[1] - py * 6 - uy * 1], [J.neck[0] + px * 7 - ux * 1, J.neck[1] + py * 7 - uy * 1], [J.neck[0] + px * 3 - ux * 6, J.neck[1] + py * 3 - uy * 6]], pal.accent, O, 1.2);
  }
  ctx.restore();
  // Belt or sash at the waist.
  const wy = 0.12, b0 = [lerp(pts[0][0], pts[3][0], wy), lerp(pts[0][1], pts[3][1], wy)], b1 = [lerp(pts[1][0], pts[2][0], wy), lerp(pts[1][1], pts[2][1], wy)];
  ctx.beginPath(); ctx.moveTo(...b0); ctx.lineTo(...b1); ctx.strokeStyle = O; ctx.lineWidth = 6.4; ctx.stroke();
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 4; ctx.stroke();
  if (outfit === 'gi') {
    const t = Math.sin(time * 0.15) * 3;
    ctx.beginPath(); ctx.moveTo(b0[0] + 2, b0[1]); ctx.lineTo(b0[0] - 6, b0[1] + 10 + t * 0.4); ctx.moveTo(b0[0] + 2, b0[1]); ctx.lineTo(b0[0] - 2, b0[1] + 12);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2.6; ctx.stroke();
  }
}

function robeFront(ctx, J, B, pal, O, ol, time) {
  const sway = Math.sin(time * 0.1 + 1) * 3, k = J.lN.knee;
  poly(ctx, [[J.hip[0] - 4, J.hip[1]], [J.hip[0] + 11, J.hip[1]], [k[0] + 10 + sway, k[1] + 6], [k[0] - 6 + sway, k[1] + 8]], pal.primary, O, ol);
  ctx.beginPath(); ctx.moveTo(k[0] - 6 + sway, k[1] + 6); ctx.lineTo(k[0] + 10 + sway, k[1] + 4); ctx.strokeStyle = pal.accent; ctx.lineWidth = 2.4; ctx.stroke();
}

function drawHead(ctx, J, B, pal, o, O, ol) {
  const [hx, hy] = J.head, R = B.head, tilt = (J.lean + J.headTilt) * D2R, t = o.time;
  const hairC = pal.hairColor, hairS = shadeHex(hairC, 0.3);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(tilt);
  // Hair behind the head.
  if (o.hair === 'long') { poly(ctx, [[-4, -8], [-R - 2, -2], [-R - 6 + Math.sin(t * 0.1) * 2, R + 14], [-2, R + 6]], hairC, O, ol); }
  if (o.hair === 'ponytail') { const w = Math.sin(t * 0.14) * 4; ctx.beginPath(); ctx.moveTo(-R + 2, -R * 0.4); ctx.quadraticCurveTo(-R - 12, -R * 0.2 + w, -R - 10, R * 0.9 + w); ctx.lineCap = 'round'; ctx.strokeStyle = O; ctx.lineWidth = 8.5; ctx.stroke(); ctx.strokeStyle = hairC; ctx.lineWidth = 5.5; ctx.stroke(); }
  if (o.headwear === 'hood') blob(ctx, -1, -1, R + 3.4, pal.primary, O, ol, pal.primaryShade);
  // Neck and face.
  ctx.beginPath(); ctx.moveTo(-2, R * 0.6); ctx.lineTo(-2, R * 1.2); ctx.strokeStyle = O; ctx.lineWidth = 8.6; ctx.stroke(); ctx.strokeStyle = pal.skinShade; ctx.lineWidth = 5.4; ctx.stroke();
  blob(ctx, 0, 0, R, pal.skin, O, ol, pal.skinShade);
  // Jaw and nose toward the front.
  ctx.beginPath(); ctx.moveTo(R * 0.55, -R * 0.1); ctx.lineTo(R * 1.12, R * 0.12); ctx.lineTo(R * 0.7, R * 0.3); ctx.fillStyle = pal.skin; ctx.fill(); ctx.lineWidth = ol * 0.8; ctx.strokeStyle = O; ctx.stroke();
  face(ctx, R, pal, o.face, O, t);
  if (o.headwear === 'mask') { poly(ctx, [[-R * 0.2, R * 0.08], [R * 1.08, R * 0.0], [R * 0.8, R * 0.9], [-R * 0.3, R * 0.85]], pal.accent, O, ol * 0.8); }
  // Hair on top.
  const H = { short: [[-R * 1.05, -R * 0.1], [-R * 0.9, -R * 0.9], [0, -R * 1.18], [R * 0.85, -R * 0.75], [R * 0.6, -R * 0.4], [-R * 0.3, -R * 0.55], [-R * 0.6, 0]],
    spiky: [[-R * 1.1, 0], [-R * 1.6, -R * 0.6], [-R * 0.85, -R * 0.85], [-R * 1.0, -R * 1.55], [-R * 0.2, -R * 1.1], [R * 0.2, -R * 1.7], [R * 0.6, -R * 0.95], [R * 1.25, -R * 1.05], [R * 0.8, -R * 0.45], [-R * 0.2, -R * 0.55], [-R * 0.55, R * 0.05]],
    long: [[-R * 1.08, R * 0.2], [-R * 0.95, -R * 0.9], [0, -R * 1.2], [R * 0.9, -R * 0.7], [R * 0.75, -R * 0.35], [-R * 0.2, -R * 0.6], [-R * 0.55, R * 0.25]],
    ponytail: [[-R * 1.05, -R * 0.1], [-R * 0.9, -R * 0.9], [0, -R * 1.15], [R * 0.85, -R * 0.7], [R * 0.7, -R * 0.4], [-R * 0.3, -R * 0.55], [-R * 0.6, 0]],
    mohawk: [[-R * 0.9, -R * 0.55], [-R * 0.7, -R * 1.5], [-R * 0.2, -R * 1.25], [R * 0.1, -R * 1.75], [R * 0.4, -R * 1.2], [R * 0.75, -R * 1.45], [R * 0.7, -R * 0.75]],
    topknot: [[-R * 1.02, -R * 0.15], [-R * 0.85, -R * 0.9], [0, -R * 1.12], [R * 0.82, -R * 0.72], [R * 0.6, -R * 0.4], [-R * 0.3, -R * 0.55], [-R * 0.6, 0]],
  }[o.hair];
  if (H && o.headwear !== 'hood' && o.headwear !== 'helmet') {
    poly(ctx, H, hairC, O, ol);
    ctx.beginPath(); ctx.moveTo(H[1][0] * 0.7, H[1][1] * 0.7); ctx.lineTo(H[2][0] * 0.8, H[2][1] * 0.8); ctx.strokeStyle = lightHex(hairC, 0.3); ctx.lineWidth = 1.4; ctx.stroke();
    if (o.hair === 'topknot') blob(ctx, -R * 0.2, -R * 1.35, R * 0.38, hairC, O, ol, hairS);
  }
  switch (o.headwear) {
    case 'headband': {
      ctx.beginPath(); ctx.moveTo(-R * 1.02, -R * 0.38); ctx.lineTo(R * 0.98, -R * 0.48); ctx.strokeStyle = O; ctx.lineWidth = 5.6; ctx.stroke(); ctx.strokeStyle = pal.accent; ctx.lineWidth = 3.4; ctx.stroke();
      const w = Math.sin(t * 0.2) * 3, w2 = Math.sin(t * 0.2 + 1.2) * 3;
      for (const [len, ww] of [[16, w], [12, w2]]) { ctx.beginPath(); ctx.moveTo(-R * 0.98, -R * 0.38); ctx.quadraticCurveTo(-R - len * 0.5, -R * 0.2 + ww, -R - len, R * 0.1 + ww * 1.5); ctx.strokeStyle = O; ctx.lineWidth = 4.4; ctx.stroke(); ctx.strokeStyle = pal.accent; ctx.lineWidth = 2.4; ctx.stroke(); }
      break;
    }
    case 'helmet': poly(ctx, [[-R * 1.1, R * 0.1], [-R * 1.05, -R * 0.8], [0, -R * 1.25], [R * 0.95, -R * 0.75], [R * 1.05, -R * 0.25], [R * 0.2, -R * 0.3], [-R * 0.3, R * 0.2]], pal.accent, O, ol);
      ctx.beginPath(); ctx.moveTo(-R * 0.6, -R * 1.05); ctx.lineTo(R * 0.4, -R * 1.1); ctx.strokeStyle = lightHex(pal.accent, 0.4); ctx.lineWidth = 1.6; ctx.stroke(); break;
    case 'horns': for (const s of [0, 1]) { const bx = s ? R * 0.35 : -R * 0.45; poly(ctx, [[bx - 3, -R * 0.85], [bx + 3, -R * 0.9], [bx + (s ? 10 : -6), -R * 1.9], [bx + (s ? 5 : -8), -R * 1.2]], s ? '#f2e6c8' : '#cfc2a2', O, ol * 0.9); } break;
    case 'circlet': ctx.beginPath(); ctx.moveTo(-R * 1.0, -R * 0.45); ctx.lineTo(R * 0.95, -R * 0.55); ctx.strokeStyle = O; ctx.lineWidth = 3.6; ctx.stroke(); ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.stroke(); blob(ctx, R * 0.55, -R * 0.55, 2.2, lightHex(pal.accent, 0.4), O, 1); break;
    case 'hood': ctx.beginPath(); ctx.arc(-1, -1, R + 3.4, Math.PI * 0.95, Math.PI * 1.85); ctx.strokeStyle = pal.primaryShade; ctx.lineWidth = 3; ctx.stroke(); break;
  }
  ctx.restore();
}

function face(ctx, R, pal, mode, O, t) {
  const ex = R * 0.52, ey = -R * 0.12;
  ctx.lineCap = 'round';
  if (mode === 'ko') {
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(ex - 2.4, ey - 2.4 * d); ctx.lineTo(ex + 2.4, ey + 2.4 * d); ctx.strokeStyle = O; ctx.lineWidth = 1.6; ctx.stroke(); }
  } else if (mode === 'hurt') {
    ctx.beginPath(); ctx.moveTo(ex - 3, ey - 1.5); ctx.lineTo(ex + 1, ey); ctx.lineTo(ex - 3, ey + 1.5); ctx.strokeStyle = O; ctx.lineWidth = 1.7; ctx.stroke();
  } else {
    const blink = Math.floor(t) % 170 < 5 && mode === 'calm';
    if (blink) { ctx.beginPath(); ctx.moveTo(ex - 2.6, ey); ctx.lineTo(ex + 2.6, ey); ctx.strokeStyle = O; ctx.lineWidth = 1.5; ctx.stroke(); }
    else {
      ctx.beginPath(); ctx.ellipse(ex, ey, 2.1, 2.7, 0, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 0.7; ctx.strokeStyle = O; ctx.stroke();
      ctx.beginPath(); ctx.arc(ex + 0.8, ey + 0.2, 1.4, 0, Math.PI * 2); ctx.fillStyle = '#16121e'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 0.4, ey - 0.7, 0.55, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }
  // Brow: angled down toward the nose when fighting.
  const angry = mode === 'fight' || mode === 'shout';
  ctx.beginPath(); ctx.moveTo(ex - 3.4, ey - (angry ? 5.4 : 4.8)); ctx.lineTo(ex + 3.2, ey - (angry ? 3.4 : 4.6)); ctx.strokeStyle = shadeHex(pal.hairColor, 0.2); ctx.lineWidth = 1.9; ctx.stroke();
  // Mouth.
  const my = R * 0.5, mx = R * 0.55;
  if (mode === 'shout' || mode === 'hurt') { ctx.beginPath(); ctx.ellipse(mx, my, 2.2, mode === 'shout' ? 2.6 : 1.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#4a1418'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = O; ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(mx - 2.6, my); ctx.lineTo(mx + 2.2, my - (mode === 'calm' ? 0.6 : -0.4)); ctx.strokeStyle = O; ctx.lineWidth = 1.2; ctx.stroke(); }
}

/** A head-and-shoulders bust for portraits, centered at the transform origin. */
export function drawBust(ctx, look, pal, time = 0, face = 'calm') {
  ctx.save(); ctx.translate(0, 62);
  drawFighter(ctx, { ...POSES.guard, sN: 20, eN: 30, sF: 10, eF: 30, lean: 2, head: -6 }, { pal, outfit: look.outfit, hair: look.hair, headwear: look.headwear, build: look.build, face, time });
  ctx.restore();
}

export const RIG_HEIGHT = HEIGHT;
