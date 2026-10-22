// graphics.fx.feedback — game feel on events: hit-stop (a short freeze of the
// displayed world), camera shake (smooth noise, decaying), white or damage
// flashes, slow-motion on big moments, zoom punches and floating damage/score
// numbers. Reduced-motion turns shake and flashes off. The live state is
// published at rt.caches.flat.feedback for every renderer (2D and 3D). Hosts
// that implement view.setTimeScale(s) get true slow-mo and hit-stop; without
// it the freeze and slow-mo are presentational (see kernel/requests/flat.md).
import { hubOf, ORDER, subjectOf } from './flat-stage.js';
import { eventPoint } from './particles.js';
import { label, rgba, clamp, clamp01, lerp } from './flat-util.js';
import { color } from './model-lib.js';

export const DEFAULT_SHAKE = { hurt: 0.55, damaged: 0.45, stomp: 0.35, defeated: 0.4, explode: 1, hit: 0.22, boss_defeated: 1, crash: 0.7 };
const DEFAULT_STOP = ['hit', 'stomp', 'defeated', 'damaged'];

export function installFeedback(rt, config, instance = {}) {
  const H = hubOf(rt);
  if (H.cfg.feedback) return;
  H.cfg.feedback = config;
  const fb = H.feedback, reduced = () => config.reducedMotion !== 'ignore' && H.reduced;
  const timers = { slowmo: 0, zoom: 0, zoomAmt: 0 };
  const popups = [];
  const matches = (list, name) => list.some(e => e === name || (e.endsWith(':*') && name.startsWith(e.slice(0, -1))));
  rt.on('*', ev => {
    const name = String(ev.name || ''), base = name.split(':')[0];
    if (name !== base && !matches([...config.slowmoOn, ...config.zoomOn, ...config.flashOn], name)) return;
    const victim = subjectOf(ev, 'victim'), mine = victim === 'player' || subjectOf(ev, 'actor') === 'player';
    const amt = config.shakeOn[base] ?? config.shakeOn[name];
    if (amt && !reduced()) fb.shake = Math.min(1, fb.shake + amt * config.shake * (mine ? 1 : 0.6));
    if (config.hitStop > 0 && matches(config.hitStopOn, base)) fb.hitStop = Math.max(fb.hitStop, config.hitStop * (base === 'defeated' ? 1.4 : 1));
    if (config.damageFlash && victim === 'player' && /^(hurt|damaged|hit)$/.test(base) && !reduced()) { fb.flash = 0.55; fb.flashColor = config.damageColor; }
    if (matches(config.flashOn, name) && !reduced()) { fb.flash = 0.7; fb.flashColor = '#ffffff'; }
    if (matches(config.slowmoOn, name)) timers.slowmo = config.slowmoMs / 1000;
    if (matches(config.zoomOn, name)) { timers.zoom = 0.45; timers.zoomAmt = config.zoomAmount; }
    // Floating numbers: damage on victims, gains on the player.
    if (config.popups) {
      const n = ev.amount ?? ev.damage ?? ev.dmg ?? ev.points ?? ev.value;
      if (Number.isFinite(n) && n !== 0 && /^(hurt|damaged|damage|hit|score|add_score|scored|points|heal|healed|money|gold_gained)$/.test(base)) {
        const pt = eventPoint(H, ev, /^(hurt|damaged|damage|hit|heal|healed)$/.test(base) ? 'target' : 'self') || eventPoint(H, ev, 'player');
        if (pt && H.stages.has(pt.space)) popups.push({ p: [pt.p[0], pt.p[1] + 0.6], space: pt.space, text: `${/score|points|money|gold|heal/.test(base) ? '+' : ''}${Math.round(Math.abs(n))}`, color: /heal/.test(base) ? '#7af08a' : /score|points|money|gold/.test(base) ? '#ffe066' : victim === 'player' ? '#ff6a6a' : '#ffffff', t0: H.clock, big: Math.abs(n) >= 10 || ev.crit });
      }
    }
  });
  H.update(dt => {
    fb.shake = Math.max(0, fb.shake * Math.exp(-dt * 6.5) - dt * 0.05);
    fb.flash = Math.max(0, fb.flash - dt * 2.6);
    fb.hitStop = Math.max(0, fb.hitStop - dt * 1000);
    timers.slowmo = Math.max(0, timers.slowmo - dt);
    const wantSlow = timers.slowmo > 0 ? config.slowmoScale : 1;
    fb.slowmo = lerp(fb.slowmo, wantSlow, clamp01(dt * (wantSlow < 1 ? 14 : 4)));
    timers.zoom = Math.max(0, timers.zoom - dt);
    fb.zoom = reduced() ? 1 : 1 + timers.zoomAmt * Math.sin(clamp01(timers.zoom / 0.45) * Math.PI) * (timers.zoom > 0 ? 1 : 0);
    // A host that can scale simulation time gets real slow-mo and hit-stop.
    const scale = fb.hitStop > 0 ? 0 : fb.slowmo;
    if (typeof H.view?.setTimeScale === 'function' && H.lastScale !== scale) { H.lastScale = scale; H.view.setTimeScale(scale); }
    for (let i = popups.length - 1; i >= 0; i--) if (H.clock - popups[i].t0 > 0.9) popups.splice(i, 1);
  });
  H.layer(ORDER.feedback, F => {
    if (fb.flash > 0.01) { F.ctx.fillStyle = rgba(fb.flashColor, fb.flash * (fb.flashColor === '#ffffff' ? 0.6 : 0.35)); F.ctx.fillRect(0, 0, F.w, F.h); if (fb.flashColor !== '#ffffff' && F.ctx.createRadialGradient) { const g = F.ctx.createRadialGradient(F.w / 2, F.h / 2, Math.min(F.w, F.h) * 0.3, F.w / 2, F.h / 2, Math.max(F.w, F.h) * 0.7); g.addColorStop(0, rgba(fb.flashColor, 0)); g.addColorStop(1, rgba(fb.flashColor, fb.flash * 0.9)); F.ctx.fillStyle = g; F.ctx.fillRect(0, 0, F.w, F.h); } }
    if (fb.slowmo < 0.95) { F.ctx.fillStyle = rgba('#0a0814', (1 - fb.slowmo) * 0.25); F.ctx.fillRect(0, 0, F.w, F.h); }
  }, { space: instance.space || null, name: 'feedback' });
  H.layer(ORDER.popups, F => {
    for (const p of popups) {
      if (p.space !== F.stage.space) continue;
      const k = clamp01((H.clock - p.t0) / 0.9), [x, y] = F.toScreen([p.p[0], p.p[1] + k * 0.9]);
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
      label(F.ctx, p.text, x, y, { size: clamp(F.unit * 0.42, 11, 30) * pop * (p.big ? 1.35 : 1), color: p.color, font: F.font, alpha: 1 - k * k, weight: 900 });
    }
  }, { name: 'popups' });
}

export default {
  id: 'graphics.fx.feedback',
  card: {
    intent: 'Game feel on events: hit-stop, decaying camera shake, damage and white flashes, slow-motion moments, zoom punches and floating damage/score numbers; reduced-motion aware; shared with 3D renderers.',
    views: ['any'],
    params: {
      hitStop: { type: 'number', default: 60, min: 0, max: 300, unit: 'ms', effect: 'freeze length on hits (defeats hold longer)' },
      hitStopOn: { type: 'list', default: DEFAULT_STOP, of: { type: 'string' }, effect: 'events that hit-stop' },
      shake: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'overall shake strength' },
      shakeOn: { type: 'object', default: DEFAULT_SHAKE, values: { type: 'number', min: 0, max: 1 }, effect: 'event → shake amount 0..1 (stacking, decays)' },
      damageFlash: { type: 'boolean', default: true, effect: 'edge flash when the player is hurt' },
      damageColor: color({ default: '#ff2a3a', effect: 'damage flash color' }),
      flashOn: { type: 'list', default: [], of: { type: 'string' }, effect: 'events that flash the screen white' },
      slowmoOn: { type: 'list', default: [], of: { type: 'string' }, effect: "events that trigger slow motion ('prefix:*' allowed)" },
      slowmoScale: { type: 'number', default: 0.3, min: 0.05, max: 1, effect: 'time scale during slow motion' },
      slowmoMs: { type: 'number', default: 700, min: 50, max: 5000, unit: 'ms' },
      zoomOn: { type: 'list', default: [], of: { type: 'string' }, effect: 'events that punch the camera in' },
      zoomAmount: { type: 'number', default: 0.12, min: 0, max: 1, effect: 'zoom punch strength' },
      popups: { type: 'boolean', default: true, effect: 'floating damage, heal and score numbers' },
      reducedMotion: { type: 'string', default: 'respect', options: ['respect', 'ignore'], effect: "honor the viewer's reduced-motion setting" },
    },
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    installFeedback(rt, config, instance);
    const has3d = (rt.doc.spaces || []).some(s => /voxel|mesh3d/.test(s.use || ''));
    if (has3d) { let done = false; const tryAdapt = () => { const a = rt.caches.three?.adapters?.['graphics.fx.feedback']; if (a && !done) { done = true; H.adapters3d.push(a(rt, config, instance)); } }; tryAdapt(); if (!done) H.update(tryAdapt); }
  },
};
