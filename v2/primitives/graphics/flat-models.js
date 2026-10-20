// Entity looks for every flat renderer. An entity's look comes from its
// archetype's `model` component (an id into content.models or an inline spec):
//   pixel  → flat-pixel part sprites          vector → flat-vector presets/shapes
//   rig    → flat-rig fighter or bone rigs    art    → v2/art character or prop
//   voxel/lowpoly (3D specs) → an art character in the spec's palette
// With no model, the archetype's role, words and tags choose generated art.
// drawEntity() adds the presentation state machine (idle, run, jump, fall,
// land, dash, attack, hurt, die, wallslide), squash and stretch, trails,
// hurt flashes, invulnerability blinking, spawn pops, pickup bob and shimmer,
// goal beacons, shadows and small glows, reading state but never writing it.
import { TAU, clamp, clamp01, lerp, easeOutBack, rgba, light, col, surface, ctx2d, seedOf, hash } from './flat-util.js';
import { pixelFrame, resolveAnim, animInfo, frameIndex } from './flat-pixel.js';
import { drawVector, glow } from './flat-vector.js';
import { drawFighter, paletteFor, fighterPose, fighterLook, faceFor, bonePose, drawBones, rigFrom, isFighterSpec, RIG_HEIGHT } from './flat-rig.js';
import { roleOf, lookFor, propFor, characterImage, propImage, poseFor } from './flat-art.js';

export const STATES = ['idle', 'run', 'walk', 'jump', 'fall', 'land', 'dash', 'attack', 'hurt', 'die', 'wallslide', 'crouch', 'block', 'win', 'dazed'];

/** The model spec for an entity: its own components.model, else its archetype's. */
export function modelSpec(doc, e) {
  const arch = doc.content?.archetypes?.find(a => a.id === e.archetype) || {};
  const m = e.components?.model ?? arch.components?.model;
  if (typeof m === 'string') return { key: m, spec: doc.content?.models?.[m] || null, arch };
  if (m && typeof m === 'object') return { key: `${e.archetype}#inline`, spec: m, arch };
  return { key: `${e.archetype}#auto`, spec: null, arch };
}

const VECTOR_WORDS = [['rock', /rock|asteroid|meteor|boulder/], ['saucer', /ufo|saucer/], ['invader-crab', /invader|crab/], ['invader-squid', /squid/], ['invader-octopus', /octopus/], ['moth', /moth/], ['bug', /bug|beetle|insect|wasp|bee/], ['fighter', /fighter|jet|interceptor/], ['ship', /ship|player/], ['orb', /orb|eye|mine/], ['drone', /drone|turret|sentry/], ['ghost', /ghost|phantom|spook/], ['chomp', /chomp|pac|muncher/], ['gem', /gem|jewel/], ['virus', /virus|germ/], ['capsule', /capsule|pill/], ['blob', /blob|slime|bubble/], ['diamond', /diamond|crystal/], ['pinwheel', /pinwheel|spinner/], ['coin', /coin/], ['star', /star/], ['heart', /heart/], ['key', /key/], ['bomb', /bomb/], ['crate', /crate|box/], ['bullet', /bullet|shot|laser|bolt|missile|projectile/]];
const ROLE_COLOR = { player: '#4fd8ff', enemy: '#ff5a7a', boss: '#c84aff', npc: '#7adf8a', pickup: '#ffd23f', hazard: '#ff6a2a', goal: '#5fe36a', projectile: '#ffe066', prop: '#c0a080', vehicle: '#3a7ad8', mount: '#a0683a' };

/** Resolve (and cache) how an archetype looks. */
export function lookOf(H, e, view = 'side') {
  const doc = H.rt.doc;
  const found = modelSpec(doc, e);
  const { key, arch } = found, spec = found.spec || H.vectorModels?.[e.archetype] || (H.cfg.rig?.archetypes?.[e.archetype] ? { kind: 'rig', rig: H.cfg.rig.archetypes[e.archetype] } : null);
  const ck = `${key}|${view}|${e.id === 'player' ? 'p' : ''}`;
  H.looks ??= new Map();
  if (H.looks.has(ck)) return H.looks.get(ck);
  const role = e.id === 'player' ? 'player' : roleOf(arch, e.archetype);
  const text = [arch.id, arch.name, arch.kind, ...(arch.tags || [])].join(' ').toLowerCase();
  const light2 = arch.components?.light || e.components?.light;
  let L;
  const kind = spec?.kind;
  if (kind === 'pixel' && spec.size) L = { type: 'pixel', spec };
  else if (kind === 'vector') L = { type: 'vector', spec, preset: spec.preset || (spec.shapes ? 'shapes' : 'blob'), color: spec.color || spec.palette?.[Object.keys(spec.palette || {})[0]] };
  else if (kind === 'rig' || kind === 'bones') {
    const named = H.cfg.rig?.rigs || {}, def = named[spec.rig];
    const fighter = def ? def.preset === 'fighter' && !def.bones?.length : isFighterSpec(spec) && !spec.bones;
    if (fighter) L = { type: 'fighter', look: fighterLook(key, { ...(def?.look || {}), ...(spec.look || {}) }) };
    else { const rig = rigFrom(spec, named); L = rig ? { type: 'bones', rig } : { type: 'fighter', look: fighterLook(key, spec.look || {}) }; }
  } else if (kind === 'art' && spec.prop) L = { type: 'prop', prop: spec.prop, color: spec.color };
  else if (kind === 'art') L = { type: 'character', look: spec.look || lookFor(arch, role) };
  else if (spec && (kind === 'voxel' || kind === 'lowpoly' || spec.palette)) {
    // A 3D (or unknown) spec in a 2D space: an art character in its own palette.
    const p = Object.values(spec.palette || {});
    const named = spec.palette || {};
    const colors = { primary: named.cloth || named.body || named.t || p[2] || p[0], secondary: named.skin || named.s || p[0], accent: named.trim || named.accent || p[3] || p[1], hair: named.hair || named.h };
    L = ['pickup', 'hazard', 'goal', 'prop'].includes(role) ? { type: 'prop', prop: propFor(arch, role), color: colors.primary } : { type: 'character', look: lookFor(arch, role, colors) };
  } else {
    // No art: pick from role and view.
    const vword = (VECTOR_WORDS.find(([, re]) => re.test(text)) || [])[0];
    if (view === 'top' && ['player', 'enemy', 'boss', 'projectile', 'pickup'].includes(role)) L = { type: 'vector', preset: role === 'player' ? 'ship' : role === 'projectile' ? 'bullet' : role === 'pickup' ? (vword || 'gem') : (vword && vword !== 'ship' ? vword : ['bug', 'moth', 'fighter', 'drone', 'saucer'][Math.floor(hash(seedOf(e.archetype)) * 5)]), color: ROLE_COLOR[role] };
    else if (role === 'projectile') L = { type: 'vector', preset: 'bullet', color: ROLE_COLOR.projectile };
    else if (vword && /rock|asteroid|meteor|gem|virus|capsule|bomb|crate|coin|chomp|ghost|blob|invader/.test(vword) && !/^(player|npc)$/.test(role)) L = { type: 'vector', preset: vword, color: ROLE_COLOR[role] };
    else if (/fighter|brawler|martial|boxer|wrestler/.test(text) || arch.components?.versus) L = { type: 'fighter', look: fighterLook(e.archetype) };
    else if (['pickup', 'hazard', 'goal', 'prop'].includes(role)) L = { type: 'prop', prop: propFor(arch, role) };
    else L = { type: 'character', look: lookFor(arch, role) };
  }
  L.role = role; L.key = key; L.glow = spec?.glow || (light2 ? { color: light2.color || '#ffd890', radius: 0.5 } : null);
  L.boss = role === 'boss';
  H.looks.set(ck, L);
  return L;
}

// ---------- presentation state ----------
const deadOf = e => { const h = e.components?.health; return Boolean(h && typeof h === 'object' && (h.dead || (Number.isFinite(h.hp) && h.hp <= 0))); };
const stunned = e => Object.entries(e.components?.status || {}).some(([k, v]) => v > 0 && /stun|daze|dizzy|confus|sleep|frozen|freeze/.test(k));
/** Presentation state of an entity this frame: { state, age, speed }. Updates the tracker (cache only). */
export function presentState(F, item, tr, view) {
  const e = item.e, now = F.t, body = e.components?.body || {}, vel = item.vel || [0, 0];
  const speed = view === 'side' ? Math.abs(vel[0]) : Math.hypot(vel[0], vel[1] || 0);
  let state;
  if (item.ghost) return { state: item.ghost.cause === 'die' ? 'die' : 'idle', age: item.k * item.ghost.dur, speed: 0 };
  if (deadOf(e)) state = 'die';
  else if (now - tr.hurt < 0.32) state = 'hurt';
  else if (now - tr.attack < 0.36) state = 'attack';
  else if (now - tr.dash < 0.22 || body.dashing) state = 'dash';
  else if (view === 'side' && body.grounded === false) state = body.wall || body.onWall ? 'wallslide' : (vel[1] > 0.3 ? 'jump' : 'fall');
  else if (stunned(e)) state = 'dazed';
  else if (body.crouch) state = 'crouch';
  else if (body.guard || body.blocking) state = 'block';
  else if (now - tr.land < 0.12) state = 'land';
  else if (speed > 0.35) state = 'run';
  else state = 'idle';
  if (tr.state !== state) { tr.state = state; tr.since = now; }
  // Squash and stretch: land squashes, takeoff stretches; a damped spring settles it.
  if (view === 'side' && body.grounded !== undefined) {
    if (tr.grounded === false && body.grounded) { tr.land = now; tr.squashV -= 2.5 + Math.min(4, Math.abs(tr.vy || 0) * 0.25); }
    if (tr.grounded === true && !body.grounded && vel[1] > 0.5) tr.squashV += 4.2;
    tr.grounded = body.grounded; tr.vy = vel[1];
  }
  const dt = Math.min(0.05, F.dt || 1 / 60);
  tr.squashV += (-220 * tr.squash - 15 * tr.squashV) * dt; tr.squash = clamp(tr.squash + tr.squashV * dt, -0.4, 0.4);
  if (Number.isFinite(body.facing) && body.facing) tr.facing = Math.sign(body.facing);
  else if (Math.abs(vel[0]) > 0.2) tr.facing = Math.sign(vel[0]);
  if (speed > 0.2) tr.dir = view === 'side' ? [Math.sign(vel[0]) || tr.facing, 0] : [vel[0] / speed, -(vel[1] || 0) / speed];
  return { state, age: now - tr.since, speed };
}

// ---------- caches ----------
function pixelCanvas(H, key, spec, anim, f, outline, white) {
  H.pixelCache ??= new Map();
  const k = `${key}|${anim}|${f}|${outline}|${white ? 1 : 0}`;
  if (H.pixelCache.has(k)) return H.pixelCache.get(k);
  const fr = pixelFrame(spec, anim, f, { outline, shading: H.cfg.sprite?.shading !== false, flash: white ? 1 : 0 });
  const c = surface(fr.w, fr.h), g = ctx2d(c);
  let out = null;
  if (g) {
    const img = typeof ImageData !== 'undefined' ? new ImageData(fr.data, fr.w, fr.h) : g.createImageData?.(fr.w, fr.h);
    if (img && img.data !== fr.data) img.data.set?.(fr.data);
    if (img) g.putImageData?.(img, 0, 0);
    out = { c, w: fr.w, h: fr.h, pivot: fr.pivot };
  }
  if (H.pixelCache.size > 4000) H.pixelCache.clear();
  H.pixelCache.set(k, out);
  return out;
}
const whites = new WeakMap();
function whiteOf(img) {
  if (whites.has(img)) return whites.get(img);
  const w = img.naturalWidth || img.width || 64, h = img.naturalHeight || img.height || 64, c = surface(w, h), g = ctx2d(c);
  if (g) { g.drawImage(img, 0, 0, w, h); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
  whites.set(img, g ? c : null);
  return g ? c : null;
}

// ---------- drawing ----------
/**
 * Draw one entity. P: { x, y (screen feet), w, h (screen px body box), view ('side'|'td'|'iso'|'board'|'top'|'track'),
 *   ppu? (art pixels per world unit), unit (px per world unit), alpha?, rot? (radians), shadow? (bool), noState? }
 */
export function drawEntity(F, item, P) {
  const H = F.hub, g = F.ctx, e = item.e, tr = H.tracker(item.id);
  const L = lookOf(H, e, P.view);
  const S = presentState(F, item, tr, P.view === 'top' || P.view === 'track' ? 'td' : P.view === 'side' ? 'side' : 'td');
  const animCfg = H.cfg.anim || {};
  let { x, y } = P, alpha = P.alpha ?? 1, sx = 1, sy = 1, rot = P.rot || 0;
  const t = F.t;
  // Despawn ghosts: death pop and fade, pickup flight.
  if (item.ghost) {
    const k = item.k;
    if (item.ghost.cause === 'collect') { y -= P.unit * 1.1 * k; sx = sy = 1 + 0.7 * k; alpha *= 1 - k * k; }
    else if (item.ghost.cause === 'die') { const pop = Math.sin(Math.min(1, k * 2.2) * Math.PI) * 0.22; sx = 1 + pop; sy = 1 + pop * 0.6 - k * 0.35; alpha *= 1 - k * k; rot += (tr.facing || 1) * -0.4 * k; }
    else alpha *= 1 - k;
  }
  // Spawn pop.
  const born = t - tr.born;
  if (born < 0.28 && !item.ghost) { const s = easeOutBack(born / 0.28); sx *= s; sy *= s; }
  // Squash/stretch (on by default; anim.sprite can turn it off).
  if (animCfg.squash !== false && P.view === 'side') { const s = tr.squash; sy *= 1 + s; sx *= 1 - s * 0.55; }
  // Idle breathing and run lean for non-frame looks.
  if (S.state === 'idle' && L.type !== 'pixel' && L.type !== 'fighter') sy *= 1 + Math.sin(t * 2.4 + hash(seedOf(item.id)) * 6) * 0.025;
  if ((S.state === 'run' || S.state === 'dash') && P.view === 'side' && L.type === 'character') rot += (tr.facing || 1) * (S.state === 'dash' ? 0.18 : 0.07) * (animCfg.lean ?? 1);
  // Pickups bob and goals pulse.
  if (L.role === 'pickup' && !item.ghost) y -= (Math.sin(t * 3 + hash(seedOf(item.id)) * 6) * 0.5 + 0.5) * P.unit * 0.12;
  // Invulnerability blinking after a hit.
  const hp = e.components?.health, inv = (hp && hp.invulnerable > 0) || e.components?.status?.invulnerable > 0;
  if (inv && Math.floor(t * 16) % 2 === 0 && !item.ghost) alpha *= 0.3;
  const flash = S.state === 'hurt' ? clamp01(1 - S.age / 0.14) : item.ghost?.cause === 'die' ? clamp01(1 - item.k * 4) : 0;
  // Shadow on the ground plane.
  if (P.shadow !== false && H.cfg.sprite?.shadow !== false && P.view !== 'top') {
    const lift = clamp01(P.lift || 0);
    g.save(); g.globalAlpha = alpha * (P.view === 'side' ? 0.18 : 0.28) * (1 - lift * 0.6); g.fillStyle = '#000';
    g.beginPath(); g.ellipse(P.gx ?? x, P.gy ?? y, Math.max(2, P.w * 0.42 * (1 - lift * 0.4)), Math.max(1, P.w * 0.12 * (1 - lift * 0.4)), 0, 0, TAU); g.fill(); g.restore();
  }
  // Trails while in a trail state.
  const trailStates = animCfg.trail || ['dash'];
  if (trailStates.includes(S.state) && !F.reduced) {
    if (H.frameNo % 2 === 0) tr.trail.push({ x, y, t });
  }
  tr.trail = tr.trail.filter(p => t - p.t < 0.2);
  for (const p of tr.trail) { const a = (1 - (t - p.t) / 0.2) * 0.35 * alpha; drawLook(F, L, item, tr, S, { ...P, x: p.x, y: p.y }, { sx, sy, rot, alpha: a, flash: 0, tint: true }); }
  drawLook(F, L, item, tr, S, P, { x, y, sx, sy, rot, alpha, flash });
  // Stunned: stars circle the head.
  if (S.state === 'dazed' && !item.ghost) for (let i = 0; i < 3; i++) {
    const a = (F.reduced ? 0 : t * 5) + (i * TAU) / 3, R = P.w * 0.45;
    g.save(); g.translate(x + Math.cos(a) * R, y - P.h * 1.08 + Math.sin(a) * R * 0.3); g.fillStyle = '#ffe14a'; g.beginPath();
    for (let k = 0; k < 8; k++) { const b = (k / 8) * TAU, rr = k % 2 ? R * 0.12 : R * 0.3; g.lineTo(Math.cos(b) * rr, Math.sin(b) * rr); }
    g.closePath(); g.fill(); g.restore();
  }
  // Halo for glowing models and light carriers.
  if (L.glow && !item.ghost) glow(g, x, y - P.h * 0.55, Math.max(P.w, P.h) * (L.glow.radius > 3 ? 0.9 : 0.75), col(L.glow.color, '#ffd890'), 0.55 + Math.sin(t * 5) * 0.08);
  if (L.role === 'goal' && !item.ghost) { const pulse = 0.5 + 0.5 * Math.sin(t * 3); glow(g, x, y - P.h * 0.5, Math.max(P.w, P.h) * (1.1 + pulse * 0.3), '#fff2a0', 0.35 + pulse * 0.2); }
  return S;
}

function drawLook(F, L, item, tr, S, P, o) {
  const g = F.ctx, H = F.hub, t = F.t;
  const x = o.x ?? P.x, y = o.y ?? P.y, facing = tr.facing || 1;
  g.save();
  g.globalAlpha *= clamp01(o.alpha);
  g.translate(x, y); if (o.rot) g.rotate(o.rot); g.scale(o.sx, o.sy);
  if (o.tint) g.globalCompositeOperation = 'lighter';
  switch (L.type) {
    case 'pixel': {
      const spec = L.spec, anim = resolveAnim(spec, S.state, H.cfg.anim?.map || {}), info = animInfo(spec, anim);
      const f = frameIndex(info, info.loop === false ? S.age : t);
      const outline = H.cfg.sprite?.outline === undefined ? undefined : H.cfg.sprite.outline || '';
      const fr = pixelCanvas(H, L.key, spec, anim, f, outline, false);
      if (!fr) break;
      const s = P.ppu ? P.unit / P.ppu : P.h / Math.max(1, spec.size[1]);
      g.scale(facing * s, s);
      g.drawImage(fr.c, -fr.pivot[0], -fr.pivot[1]);
      if (o.flash > 0) { const wf = pixelCanvas(H, L.key, spec, anim, f, outline, true); if (wf) { g.globalAlpha *= o.flash; g.drawImage(wf.c, -wf.pivot[0], -wf.pivot[1]); } }
      break;
    }
    case 'vector': {
      const R = Math.max(P.w, P.h) * 0.5;
      g.translate(0, -P.h * 0.5);
      const dir = P.view === 'side' ? [facing, 0] : tr.dir || [1, 0];
      const vcfg = H.cfg.vector || {};
      if (vcfg.glow ?? (P.view === 'top')) glow(g, 0, 0, R * 2.2, col(L.color || L.spec?.color, '#ff5a7a'), 0.3);
      drawVector(g, L.preset, R, L.color || ROLE_COLOR[L.role], { t, dir, flash: o.flash, seed: seedOf(item.id) % 997, idx: L.spec?.idx ?? seedOf(item.e.archetype), shapes: L.spec?.shapes, mood: item.e.components?.ai?.mood || (S.state === 'hurt' ? 'hurt' : undefined), accent: L.spec?.accent, pixel: F.style === 'pixel', variant: L.spec?.variant });
      break;
    }
    case 'fighter': {
      const sc = (P.h * 1.02) / RIG_HEIGHT;
      g.scale(facing * sc, sc);
      L.pal ??= paletteFor(L.look);
      const pose = fighterPose({ state: S.state, age: S.age, t, vy: item.vel?.[1] || 0, walk: 1, air: item.e.components?.body?.grounded === false, move: H.trackers.get(item.id)?.move, combo: Math.floor(tr.attack * 7) });
      drawFighter(g, pose, { pal: L.pal, outfit: L.look.outfit, hair: L.look.hair, headwear: L.look.headwear, build: L.look.build, face: faceFor(S.state), time: t * 60 });
      if (o.flash > 0) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = o.flash * 0.8; g.fillStyle = '#ffffff'; g.fillRect(-70, -125, 140, 130); }
      break;
    }
    case 'bones': {
      const sc = (P.h * 1.02) / RIG_HEIGHT;
      g.scale(facing * sc, sc);
      drawBones(g, L.rig, bonePose(L.rig, S.state, t, S.age), { time: t, flash: o.flash, face: faceFor(S.state) });
      break;
    }
    case 'character': {
      const img = characterImage(L.look, poseFor(S.state, t, S.speed / 3), F.style === 'pixel');
      const hh = P.h * (L.boss ? 1.15 : 1.08);
      if (!img) { placeholder(g, P, L.look.colors?.primary || ROLE_COLOR[L.role], t); break; }
      const [bx0, by0, bx1, by1] = img.box || [0, 0, 1, 1];
      const s = hh / Math.max(0.05, by1 - by0);
      g.scale(facing, 1);
      if (S.state === 'attack') { const k = clamp01(S.age / 0.36); g.translate(Math.sin(k * Math.PI) * P.w * 0.25, 0); }
      const dx = -((bx0 + bx1) / 2) * s, dy = -by1 * s;
      g.drawImage(img.img, dx, dy, s, s);
      if (o.flash > 0) { const w = whiteOf(img.img); if (w) { g.globalAlpha *= o.flash; g.drawImage(w, dx, dy, s, s); } }
      if (S.state === 'attack' && !o.tint) slash(g, P, clamp01(S.age / 0.36));
      break;
    }
    case 'prop': {
      const img = propImage(L.prop, L.color, F.style === 'pixel');
      const size = Math.max(P.w, P.h) * (L.role === 'pickup' ? 1.0 : 1.05);
      if (!img) { g.translate(0, -size * 0.5); drawVector(g, L.role === 'pickup' ? 'coin' : L.role === 'hazard' ? 'diamond' : 'crate', size * 0.45, ROLE_COLOR[L.role], { t }); break; }
      const [bx0, , bx1, by1] = img.box || [0, 0, 1, 1];
      const s = size / Math.max(0.2, Math.max(bx1 - bx0, by1 - (img.box?.[1] ?? 0)));
      if (L.role === 'pickup' && /coin|ring/.test(L.prop)) g.scale(Math.max(0.2, Math.abs(Math.cos(t * 3 + hash(seedOf(item.id)) * 6))), 1);
      g.drawImage(img.img, -((bx0 + bx1) / 2) * s, -by1 * s, s, s);
      if (L.role === 'pickup') shimmer(g, size, t + hash(seedOf(item.id)) * 4);
      if (o.flash > 0) { const w = whiteOf(img.img); if (w) { g.globalAlpha *= o.flash; g.drawImage(w, -((bx0 + bx1) / 2) * s, -by1 * s, s, s); } }
      break;
    }
    default: placeholder(g, P, ROLE_COLOR[L.role], t);
  }
  g.restore();
}

function placeholder(g, P, color, t) {
  const R = Math.min(P.w, P.h) * 0.5;
  g.translate(0, -R);
  drawVector(g, 'blob', R, color, { t });
}
function shimmer(g, size, t) {
  const k = (t * 0.6) % 2.2; if (k > 0.5) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha *= 0.7;
  const x = lerp(-size * 0.5, size * 0.5, k / 0.5), y = -size * 0.55;
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, y - size * 0.18); g.lineTo(x + size * 0.05, y); g.lineTo(x, y + size * 0.18); g.lineTo(x - size * 0.05, y); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x - size * 0.18, y); g.lineTo(x, y + size * 0.04); g.lineTo(x + size * 0.18, y); g.lineTo(x, y - size * 0.04); g.closePath(); g.fill();
  g.restore();
}
function slash(g, P, k) {
  if (k < 0.3 || k > 0.75) return;
  const a = (k - 0.3) / 0.45, R = P.h * 0.62;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - a) * 0.85;
  g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = Math.max(2, P.h * 0.07);
  g.beginPath(); g.arc(P.w * 0.2, -P.h * 0.55, R, -1.5 + a * 0.6, -1.5 + a * 0.6 + 2.1 * Math.min(1, a * 2)); g.stroke();
  g.strokeStyle = rgba(light('#ffe9a0', 0.1), 0.7); g.lineWidth = Math.max(1, P.h * 0.03); g.stroke();
  g.restore();
}
