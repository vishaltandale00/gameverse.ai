// Actors: the drawn form of entities in a space. A renderer calls syncActors()
// each frame for its bound space; this creates actors from the model library,
// places them at interpolated poses and runs the animation pipeline:
// locomotion blend tree -> one-shot clip layers (from gameplay events) ->
// bones -> post passes registered by graphics.anim.ik / secondary / ragdoll.
// Without any graphics.anim.* instance, characters still get the default
// locomotion and event clips (polish by default).
import { locomotionBlend, presetClip, sampleClip, clipEvents, blendPoses, layerPose, UPPER_BODY } from './three-anim.js';
import { applyPose } from './three-rig.js';
import { syncAttachments } from './three-models.js';
import { lerpAngle } from './three-stage.js';

export const DEFAULT_LOCOMOTION = { idleWalkRun: [0.2, 3, 6], turnLean: 0.25, strafe: false, states: ['grounded', 'airborne', 'swim', 'climb', 'glide', 'ride', 'drive', 'crouch', 'lockon'] };
/** Gameplay event -> clip (who field) defaults; graphics.anim.clips `triggers` extends this. */
export const DEFAULT_TRIGGERS = [
  { event: 'attack', clip: 'attack', who: 'who' }, { event: 'swing', clip: 'attack', who: 'who' }, { event: 'melee_swing', clip: 'attack', who: 'who' },
  { event: 'hurt', clip: 'hurt', who: 'who' }, { event: 'damaged', clip: 'hurt', who: 'target' },
  { event: 'hit', clip: 'hurt', who: 'target' }, { event: 'defeated', clip: 'die', who: 'target' }, { event: 'defeated', clip: 'die', who: 'who' }, { event: 'died', clip: 'die', who: 'who' },
  { event: 'jump', clip: 'jump', who: 'who' }, { event: 'jumped', clip: 'jump', who: 'who' }, { event: 'land', clip: 'land', who: 'who' }, { event: 'landed', clip: 'land', who: 'who' },
  { event: 'block_mined', clip: 'mine', who: 'by' }, { event: 'block_mined', clip: 'mine', who: 'who' }, { event: 'block_placed', clip: 'place', who: 'by' }, { event: 'block_placed', clip: 'place', who: 'who' },
  { event: 'shoot', clip: 'shoot', who: 'who' }, { event: 'fired', clip: 'shoot', who: 'who' }, { event: 'projectile_fired', clip: 'shoot', who: 'who' },
  { event: 'talked', clip: 'talk', who: 'character' }, { event: 'dialogue_start', clip: 'talk', who: 'speaker' }, { event: 'dodged', clip: 'dodge_roll', who: 'who' }, { event: 'dodge', clip: 'dodge_roll', who: 'who' },
  { event: 'parried', clip: 'parry', who: 'who' }, { event: 'blocked', clip: 'block_idle', who: 'who' }, { event: 'crafted', clip: 'cook', who: 'who' }, { event: 'item_used', clip: 'drink', who: 'who' },
  { event: 'mounted', clip: 'mount', who: 'who' }, { event: 'dismounted', clip: 'dismount', who: 'who' }, { event: 'interacted', clip: 'interact', who: 'who' }, { event: 'used', clip: 'interact', who: 'who' },
  { event: 'cast', clip: 'sign_cast', who: 'who' }, { event: 'reach_goal', clip: 'victory', who: 'who' },
];
const STATE_MAP = { air: 'airborne', jump: 'airborne', fall: 'airborne', dive: 'swim', swim: 'swim', climb: 'climb', ledge: 'climb', wall: 'climb', glide: 'glide', fly: 'glide', ride: 'ride', ship: 'drive', drive: 'drive', crouch: 'crouch', lockon: 'lockon', grapple: 'airborne' };
const ATTACK_CHAIN = ['light_attack_1', 'light_attack_2', 'light_attack_3'];

function ensureAnimator(stage) {
  if (stage.animator) return stage.animator;
  const animator = stage.animator = { pending: [], clips: new Map(), custom: new Map() };
  stage.rt.on('*', ev => {
    const triggers = [...(stage.anim.clips?.triggers || []), ...DEFAULT_TRIGGERS];
    const base = ev.name.includes(':') ? null : ev.name;
    if (!base) return;
    for (const t of triggers) if (t.event === base) {
      const who = ev[t.who] ?? (t.who === 'who' ? ev.id : null);
      if (typeof who === 'string') animator.pending.push({ who, clip: t.clip, event: base });
    }
  });
  return animator;
}

/** Clip for a name on a rig: authored clips (graphics.anim.clips) first, then presets. */
export function clipFor(stage, name, rigKind) {
  const key = `${rigKind}:${name}`, a = ensureAnimator(stage);
  if (a.clips.has(key)) return a.clips.get(key);
  const authored = stage.anim.clips?.authored?.find(c => c.id === name && (!c.rig || c.rig === rigKind));
  let clip = authored || presetClip(name, rigKind === 'quadruped' ? 'quadruped' : 'humanoid');
  if (!clip && rigKind === 'quadruped') clip = presetClip(/run|sprint/.test(name) ? 'run' : 'idle', 'quadruped');
  a.clips.set(key, clip);
  return clip;
}

/**
 * Create/update/remove actors for entities in a space and animate them.
 * opts: { drawDistance, animDistance }
 */
export function syncActors(stage, spaceId, root, opts = {}) {
  const { rt } = stage;
  const animator = ensureAnimator(stage);
  stage.actors ??= new Map();
  const drawDistance = opts.drawDistance ?? stage.settings.drawDistance ?? 300;
  const animDistance = opts.animDistance ?? 90;
  const seen = new Set(), dt = stage.dt * (stage.timeScale ?? 1); // hit-stop / slow-mo (graphics.fx.feedback)
  const pending = animator.pending.splice(0);
  for (const e of Object.values(rt.state.entities)) {
    if (e.space !== spaceId || e.components?.model === false || e.components?.hidden) continue;
    seen.add(e.id);
    let actor = stage.actors.get(e.id);
    if (!actor) {
      try { actor = stage.models.actor(e); } catch (err) { console.warn('three: model failed', e.archetype, err); continue; }
      actor.space = spaceId; root.add(actor.root); stage.actors.set(e.id, actor);
      actor.anim = { phase: hash(e.id), time: hash(e.id) * 5, layers: [], yaw: null, attack: 0, alive: true };
    }
    const pose = stage.pose(e.id);
    if (!pose) continue;
    const a = actor.anim;
    a.yaw = a.yaw == null ? pose.yaw : lerpAngle(a.yaw, pose.yaw, 1 - Math.exp(-dt * 14));
    actor.root.position.set(pose.at[0], pose.at[1] + (actor.spec.float || 0), pose.at[2]);
    actor.root.rotation.y = a.yaw;
    const d = stage.viewCenter().distanceTo(actor.root.position);
    const firstPerson = (stage.cameras[stage.activeCamera] || stage.cameras[0])?.view === '1p';
    actor.root.visible = d < drawDistance && !(firstPerson && e.id === 'player');
    actor.entity = e;
    if (!actor.root.visible) continue;
    // Animate near actors every frame, far ones at a reduced rate.
    a.skip = d > animDistance ? ((a.skip || 0) + 1) % 4 : 0;
    if (a.skip) continue;
    const step = d > animDistance ? dt * 4 : dt;
    for (const p of pending) if (p.who === e.id) trigger(stage, actor, p.clip);
    // health.dead (KERNEL_API §2 shared fields) starts the death even without an event.
    if (e.components?.health?.dead && !a.dead) trigger(stage, actor, 'die');
    animate(stage, actor, e, pose, step);
  }
  for (const [id, actor] of stage.actors) {
    if (actor.space !== spaceId || seen.has(id)) continue;
    // Despawned: let a death play out (or ragdoll) before removing.
    const a = actor.anim;
    if (a.dying || pending.some(p => p.who === id && p.clip === 'die')) {
      if (!a.dying) { trigger(stage, actor, 'die'); a.dying = 0; }
      a.dying += dt;
      const hold = stage.anim.ragdoll?.fadeSec ?? 2.5;
      animate(stage, actor, null, { at: actor.root.position.toArray(), yaw: a.yaw, vel: [0, 0, 0], speed: 0, grounded: true }, dt);
      if (a.dying > hold) { const s = 1 - Math.min(1, (a.dying - hold) / 0.6); actor.body.scale.setScalar((actor.template.scale || 1) * Math.max(0.001, s)); }
      if (a.dying < hold + 0.6) continue;
    }
    removeActor(stage, actor);
  }
  stage.stats.actors = stage.actors.size;
}

export function removeActor(stage, actor) {
  actor.root.removeFromParent();
  actor.skeleton?.dispose?.();
  stage.actors.delete(actor.id);
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; }

/** Start a one-shot clip on an actor (attacks cycle through a combo chain). */
export function trigger(stage, actor, name) {
  const rigKind = actor.rig?.kind;
  if (!rigKind || rigKind === 'custom') { actor.anim.pulse = { name, t: 0 }; return; }
  let clipName = name;
  if (name === 'attack') {
    const presets = stage.anim.clips?.presets || [];
    const chain = ATTACK_CHAIN.filter(c => presets.includes(c));
    if (rigKind === 'quadruped') clipName = 'attack';
    else if (chain.length) { clipName = chain[actor.anim.attack % chain.length]; actor.anim.attack++; }
    else clipName = presets.includes('swing') || !presets.length ? 'swing' : presets.find(p => /attack|swing|strike/.test(p)) || 'swing';
  }
  const clip = clipFor(stage, clipName, rigKind);
  if (!clip) return;
  const layers = actor.anim.layers;
  if (name !== 'hurt') for (const l of layers) if (!l.clip.loop) l.out = true; // a new action interrupts the old
  layers.push({ clip, t: 0, w: 0, full: ['die', 'dodge_roll', 'jump', 'land', 'sit', 'meditate', 'mount', 'dismount', 'victory', 'cook'].includes(clip.source || clip.id), hold: name === 'die' });
  if (name === 'die') actor.anim.dead = true;
}

function animate(stage, actor, entity, pose, dt) {
  const a = actor.anim, rigKind = actor.rig?.kind;
  a.time += dt;
  if (!actor.bones) { animateRigid(stage, actor, entity, pose, dt); return; }
  if (rigKind === 'custom') { animateCustom(stage, actor, pose, dt); return; }
  const cfg = stage.anim.locomotion || DEFAULT_LOCOMOTION;
  const yaw = a.yaw ?? pose.yaw, v = pose.vel || [0, 0, 0];
  const speed = Math.hypot(v[0], v[2]);
  const angle = speed > 0.05 ? Math.atan2(v[0], v[2]) - yaw : 0;
  const lockon = entity?.components?.target?.locked || entity?.components?.lockOn;
  const state = STATE_MAP[pose.state] || (lockon ? 'lockon' : null);
  const loco = locomotionBlend({ speed, angle, grounded: pose.grounded !== false, vy: v[1], state, turnRate: pose.turnRate || 0 }, rigKind === 'quadruped' ? { ...cfg, strafe: false } : cfg);
  a.loco = loco;
  const prevPhase = a.phase;
  a.phase += speed * loco.strideRate * dt * (rigKind === 'quadruped' ? 0.8 : 1);
  const parts = [];
  for (const [name, w] of Object.entries(loco.weights)) {
    const clip = clipFor(stage, name, rigKind); if (!clip) continue;
    const gaitClip = /walk|run|sprint|strafe|crouch|climb_up|ride|swim/.test(name);
    const t = gaitClip ? (a.phase % 1) * clip.dur : a.time;
    parts.push({ pose: sampleClip(clip, t), w });
    if (gaitClip && w > 0.5) for (const ev of clipEvents(clip, (prevPhase % 1) * clip.dur, (prevPhase % 1) * clip.dur + (a.phase - prevPhase) * clip.dur)) stage.emitAnim(ev.event, actor.id, { ...ev.data, at: actor.root.position.toArray(), speed });
  }
  let out = blendPoses(parts);
  // Lean into speed and turns.
  const spine = out.spine || [0, 0, 0], hips = out.hips || [0, 0, 0];
  out.spine = [spine[0] + loco.lean[0], spine[1], spine[2]];
  out.hips = [hips[0], hips[1], hips[2] + loco.lean[1]];
  // One-shot layers.
  const moving = speed > (cfg.idleWalkRun?.[0] ?? 0.2) * 2;
  for (const l of a.layers) {
    const t0 = l.t; l.t += dt;
    const fadeIn = Math.min(0.12, l.clip.dur * 0.25), fadeOut = Math.min(0.2, l.clip.dur * 0.3);
    l.w = l.out ? Math.max(0, l.w - dt / 0.12) : l.hold && l.t >= l.clip.dur ? 1 : Math.min(1, l.t / fadeIn, l.clip.loop ? 1 : Math.max(0, (l.clip.dur - l.t) / fadeOut));
    const p = sampleClip(l.clip, Math.min(l.t, l.clip.dur));
    out = layerPose(out, p, l.w, l.full || !moving ? null : UPPER_BODY);
    for (const ev of clipEvents(l.clip, t0, l.t)) stage.emitAnim(ev.event, actor.id, { ...ev.data, clip: l.clip.id, at: actor.root.position.toArray() });
  }
  a.layers = a.layers.filter(l => l.hold || (l.clip.loop ? !l.out || l.w > 0 : l.t < l.clip.dur && !(l.out && l.w <= 0)));
  if (a.dead && entity && !entity.components?.health?.dead && Number.isFinite(entity.components?.health?.hp) && entity.components.health.hp > 0 && !a.dying) { a.dead = false; a.layers = a.layers.filter(l => !l.hold); }
  a.pose = out;
  applyPose(actor.bones, out);
  syncAttachments(stage, actor, entity || actor.entity || {});
  for (const post of stage.anim.post || []) post(actor, entity, pose, dt);
}

/** Creatures without a standard skeleton: wing flaps, slithering spines, scuttling legs. */
function animateCustom(stage, actor, pose, dt) {
  const a = actor.anim, speed = pose.speed || 0, t = a.time;
  const pose2 = {};
  for (const [name] of actor.bones) {
    if (/^wing/.test(name)) { const side = /R/.test(name) ? -1 : 1; const flap = (pose.grounded === false || actor.spec.flier ? 1 : 0.15) * Math.sin(t * (actor.spec.flier ? 11 : 3)); pose2[name] = [0, 0, side * 0.7 * flap]; }
    else if (/^(spine|tail|seg)_(\d+)/.test(name)) { const i = +name.split('_')[1]; pose2[name] = [0, Math.sin(t * (2 + speed * 1.5) - i * 0.9) * (0.08 + Math.min(0.3, speed * 0.08)), 0]; }
    else if (/^leg/.test(name)) { const i = parseInt(name.replace(/\D/g, '') || '0', 10); pose2[name] = [Math.sin(t * (4 + speed * 3) + i * 2.1) * Math.min(0.5, speed * 0.2), 0, 0]; }
    else if (name === 'head') pose2[name] = [Math.sin(t * 1.3) * 0.05, Math.sin(t * 0.7) * 0.1, 0];
  }
  if (a.pulse) { a.pulse.t += dt; const k = Math.sin(Math.PI * Math.min(1, a.pulse.t / 0.4)); pose2.head = [(pose2.head?.[0] || 0) - (a.pulse.name === 'attack' ? 0.5 : -0.3) * k, 0, 0]; if (a.pulse.t > 0.4) a.pulse = null; }
  applyPose(actor.bones, pose2);
  for (const post of stage.anim.post || []) post(actor, null, pose, dt);
}

/** Unrigged models: vehicles spin wheels, pickups bob and spin, blobs squash, glows flicker, hit flashes. */
function animateRigid(stage, actor, entity, pose, dt) {
  const a = actor.anim, s = actor.spec, speed = pose.speed || 0, t = a.time;
  const scale = actor.template.scale || 1;
  for (const sp of actor.spin) {
    const r = Math.max(0.1, (sp.geometry.boundingSphere?.radius || 0.3) * 0.8);
    if (sp.axis === 'x') sp.mesh.rotation.x += speed * dt / r * Math.sign(Math.cos(Math.atan2(pose.vel?.[0] || 0, pose.vel?.[2] || 0) - (a.yaw || 0)) || 1);
    else sp.mesh.rotation[sp.axis] += dt * (speed > 0.1 || entity?.components?.vehicle?.engine ? 30 : 0);
    if (/^wheelF/.test(sp.name)) sp.mesh.rotation.y = Math.max(-0.5, Math.min(0.5, (pose.turnRate || 0) * 0.15));
  }
  if (s.spin) actor.body.rotation.y = t * 1.8;
  if (s.bob) actor.body.position.y = 0.12 + Math.sin(t * 2.6) * 0.08;
  if (s.squash) { const k = 1 + Math.sin(t * (3 + speed * 2)) * (0.05 + Math.min(0.12, speed * 0.04)); actor.body.scale.set(scale / Math.sqrt(k), scale * k, scale / Math.sqrt(k)); }
  if (s.swim) actor.body.rotation.y = Math.sin(t * 6) * 0.15;
  if (s.vehicle && pose.vel) { a.pitch = (a.pitch || 0) * 0.9 + (-(pose.vel[1] || 0) * 0.02) * 0.1; actor.body.rotation.x = a.pitch; actor.body.rotation.z = Math.max(-0.08, Math.min(0.08, -(pose.turnRate || 0) * speed * 0.004)); }
  if (a.pulse) { a.pulse.t += dt; const k = Math.sin(Math.PI * Math.min(1, a.pulse.t / 0.3)); actor.body.scale.setScalar(scale * (1 + 0.15 * k)); if (a.pulse.t > 0.3) { a.pulse = null; actor.body.scale.setScalar(scale); } }
  for (const post of stage.anim.post || []) post(actor, entity, pose, dt);
}
