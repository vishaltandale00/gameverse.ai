// Runner renderer: picks the mode's camera and drawing, then layers shared
// effects, HUD, intro and toasts on top. Behind the title screen (attract)
// the game plays itself with the lookahead bot on a private demo state.
import { createLook, createFx, stepFx, drawParticles, shake, onEvents, drawOverlays, drawHud, drawIntro, drawMissions, drawVignette, clamp } from './common.js';
import { sideView, drawSide, drawFlap, drawDash } from './side.js';
import { climbView, drawClimb } from './climb.js';
import { hopView, drawHop } from './hop.js';
import { lanesView, drawLanes } from './lanes.js';
import { DASH } from '../modes/dash.js';
import { plan } from '../verify.js';

const LW = 1.7;

export function createRenderer(game, { art = {} } = {}) {
  const look = createLook(game, art || {});
  const mode = game.content.mode;
  let fx = createFx(game.seed || 1), cam = {}, last = null, lastFrame = -1, demo = null, demoPlan = [];

  function heroAndView(state, w, h) {
    const p = state.p;
    if (mode === 'lanes') {
      const v = lanesView(state, look, w, h, cam, !!state.mods);
      const q = v.proj(p.x * LW, p.y, p.z) || [w / 2, h * 0.8, h / 6];
      return { v, hero: { x: q[0], y: q[1] }, unit: q[2], shift: [0, 0] };
    }
    if (mode === 'climb') {
      const before = cam.y; const v = climbView(state, look, w, h, cam);
      return { v, hero: { x: v.X(p.x), y: v.Y(p.y) }, unit: v.U, shift: [0, before == null ? 0 : -(cam.y - before) * v.U] };
    }
    if (mode === 'hop') {
      const before = cam.r; const v = hopView(state, look, w, h, cam);
      return { v, hero: { x: v.X(p.x), y: v.Y(v.hopR) }, unit: v.U, shift: [0, before == null ? 0 : -(cam.r - before) * v.U] };
    }
    const bx = cam.x, by = cam.y;
    const v = sideView(state, look, w, h, cam);
    const feet = mode === 'rhythm-dash' ? p.y - DASH.half * p.grav : mode === 'flap' ? p.y : p.y;
    return { v, hero: { x: v.X(p.x), y: v.Y(feet) }, unit: v.U, shift: [bx == null ? 0 : (cam.x - bx) * v.U, by == null || cam.y == null ? 0 : -(cam.y - by) * v.U] };
  }

  function demoStep() {
    if (!demo || demo.status !== 'playing' || demo.time > 40) { demo = game.createState(); demoPlan = []; }
    const sv = game.impl.solver;
    if (demo.frame % sv.every === 0) {
      if (demoPlan.length <= 2) demoPlan = plan(game, demo, { depth: mode === 'flap' ? 10 : mode === 'rhythm-dash' ? 16 : 6, beam: 4 });
      demo.demoAct = sv.actions[demoPlan.shift() ?? 0];
    }
    const a = demo.demoAct || {};
    game.step(demo, a.tap && demo.frame % sv.every !== 0 ? {} : a);
  }

  const render = (ctx, input, frame) => {
    const w = frame.cssWidth, h = frame.cssHeight, reduced = !!frame.reducedMotion;
    const dt = frame.paused ? 0 : Math.min(0.05, frame.dt || 1 / 60);
    let state = input;
    if (frame.attract) { if (!frame.paused) demoStep(); state = demo || input; }
    // A new run (or a restart) resets the visual state.
    if (state !== last && (last === null || state.frame < lastFrame || state.frame === 0)) { fx = createFx(game.seed || 1); cam = {}; }
    last = state; lastFrame = state.frame;
    fx.clock += dt;
    fx.squash = Math.max(0, (fx.squash || 0) - dt * 6);
    const events = frame.attract ? state.events || [] : frame.events || [];
    if (events.some(e => e.name === 'land' || (mode === 'climb' && (e.name === 'jump' || e.name === 'spring')))) fx.squash = 1;

    const { v, hero, unit, shift } = heroAndView(state, w, h);
    ctx.save();
    ctx.fillStyle = look.pal.background; ctx.fillRect(0, 0, w, h);
    const [sx, sy] = shake(fx, reduced);
    ctx.translate(sx, sy);
    if (mode === 'lanes') drawLanes(ctx, state, look, fx, w, h, v, frame);
    else if (mode === 'side') drawSide(ctx, state, look, fx, w, h, v, frame);
    else if (mode === 'flap') drawFlap(ctx, state, look, fx, w, h, v, frame);
    else if (mode === 'rhythm-dash') drawDash(ctx, state, look, fx, w, h, v, frame);
    else if (mode === 'climb') drawClimb(ctx, state, look, fx, w, h, v, frame);
    else drawHop(ctx, state, look, fx, w, h, v, frame);
    onEvents(fx, events, look, { hero, unit, reduced });
    stepFx(fx, dt, shift[0], shift[1]);
    drawParticles(ctx, fx);
    ctx.restore();
    // Near-miss slow-mo: a cool vignette while the clock is slowed.
    drawVignette(ctx, fx, w, h, Math.max(state.slowT > 0 ? 1 : 0, clamp(1 - (fx.clock - fx.nearAt) / 0.4, 0, 1)));
    if (!frame.attract) {
      const dist = Math.floor(state.distance);
      const label = mode === 'hop' ? `${dist} rows` : mode === 'flap' ? `${state.p.gates} gates · ${dist} m` : `${dist} m`;
      drawHud(ctx, state, look, fx, w, h, { distanceLabel: label, progress: mode === 'rhythm-dash' ? clamp(state.p.x / game.level.end, 0, 1) : game.content.rules.goalDistance > 0 ? clamp(state.distance / game.content.rules.goalDistance, 0, 1) : null });
      drawIntro(ctx, state, look, w, h, reduced);
      drawMissions(ctx, state, look, w, h, state.time < 4 ? clamp((4 - state.time) / 0.6, 0, 1) : 0);
      drawOverlays(ctx, fx, look, w, h, reduced);
    }
    // World-to-screen mapping for mods (v2/kits/mods/compose.js), in the adapter's units.
    const p = state.p;
    if (mode === 'lanes') {
      const depth = p.z + 6, at = (x, z) => v.proj(x, 0.9, z);
      render.view = { X: x => (at((p.x + x) * LW, depth)?.[0] ?? w / 2) + sx, Y: y => (at(p.x * LW, p.z + Math.max(0.2, y))?.[1] ?? h / 2) + sy, s: unit * 0.9, hud: { x: w / 2, y: h - 28 } };
    } else if (mode === 'climb') render.view = { X: x => v.X(x) + sx, Y: y => v.Y(y) + sy, s: v.U, clip: { x: v.ox, y: 0, w: v.FW, h }, hud: { x: w / 2, y: h - 28 } };
    else if (mode === 'hop') render.view = { X: x => v.X(x) + sx, Y: r => v.Y(r) + sy, s: v.U, hud: { x: w / 2, y: h - 28 } };
    else render.view = { X: x => v.X(p.x + x) + sx, Y: y => v.Y(y) + sy, s: v.U, hud: { x: w / 2, y: h - 28 } };
  };
  render.fx = () => fx;
  return render;
}
