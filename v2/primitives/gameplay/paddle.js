// gameplay.paddle: a breakout paddle for any 2D space.
// The paddle (the player or any entity) moves along its tangent; balls bounce
// off it at an angle set by where they hit (off-centre ±1 -> ±1.05 rad, plus a
// little of the paddle's own velocity); free balls keep the ramped speed and
// never fly too flat. Balls are served held on the paddle and launched with a
// verb; catch mode holds them again on contact (auto-launch after 3 s). The
// speed ramps per broken brick/event and over time (base·(1+ramp), ramp ≤ 0.55).
// In physics spaces the space moves the balls and reports `contact`; with
// motion 'self' the paddle integrates its balls (collide-and-slide) and can
// break the cells they hit, so a breakout runs on any tile or grid space.
import { centerOf, placeCenter, sizeOf, velOf, setVel, stepSelf } from './puzzle-lib-body.js';

const ID = 'gameplay.paddle';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default {
  id: ID,
  card: {
    loop: { verbs: ['launch', 'paddle_left', 'paddle_right'], progress: ['paddle_hit', 'cell_broken'], lose: { param: 'onNoLives' } },
    intent: 'Breakout paddle: angle-from-hit bounces, serve and catch, multiball, ramping ball speed, lost balls; works in physics spaces or moves its own balls through any 2D space (breaking cells they hit).',
    views: ['side', 'td'],
    params: {
      paddle: { type: 'string', default: 'player', effect: 'entity id of the paddle' },
      ball: { type: 'ref', to: 'archetype', required: true, effect: 'ball archetype' },
      up: { type: 'list', default: [0, 1], min: 2, max: 2, of: { type: 'number', min: -1, max: 1 }, effect: 'unit direction balls leave the paddle' },
      move: { type: 'number', default: 19, min: 0, max: 200, unit: 'u/s', effect: 'paddle speed along its tangent (axes.move[0] or paddle_left/right)' },
      bounds: { type: 'list', default: [], max: 2, of: { type: 'number' }, effect: '[min, max] of the paddle centre along the tangent' },
      width: { type: 'number', default: 0, min: 0, max: 100, effect: 'paddle width (0 = body.size[0])' },
      speed: { type: 'number', default: 10, min: 0.5, max: 200, unit: 'u/s', effect: 'base ball speed' },
      angle: { type: 'number', default: 1.05, min: 0, max: 1.5, unit: 'rad', effect: 'deflection at the paddle edge' },
      influence: { type: 'number', default: 0.012, min: 0, max: 0.2, effect: 'paddle velocity added to the bounce angle' },
      minUp: { type: 'number', default: 0.26, min: 0, max: 0.9, effect: 'smallest |component along up| of a free ball direction' },
      rampPerEvent: { type: 'number', default: 0.012, min: 0, max: 0.2, effect: 'ramp per rampEvents event' },
      rampPerSec: { type: 'number', default: 0.0025, min: 0, max: 0.1, effect: 'ramp per second' },
      rampMax: { type: 'number', default: 0.55, min: 0, max: 3, effect: 'speed cap is base·(1+rampMax)' },
      rampEvents: { type: 'list', default: ['destroyed', 'cell_broken'], of: { type: 'string' }, effect: 'events that ramp the speed' },
      serve: { type: 'string', default: 'hold', options: ['hold', 'auto'], effect: 'hold: ball rides the paddle until launch; auto: launched at once' },
      catch: { type: 'boolean', default: false, effect: 'balls stick to the paddle on contact' },
      catchSec: { type: 'number', default: 3, min: 0, max: 60, unit: 's', effect: 'caught balls launch by themselves after this' },
      lives: { type: 'integer', default: 0, min: 0, max: 99, effect: 'reserve serves (0 = unlimited); var paddle.balls' },
      loseLine: { type: 'number', default: 1, min: 0, max: 100, effect: 'distance behind the paddle at which a ball is lost' },
      onOut: { type: 'effects', default: [], effect: 'run when the last ball is lost' },
      onNoLives: { type: 'effects', default: [{ do: 'end_game', outcome: 'lost' }], effect: 'run when a ball is lost with no serves left' },
      motion: { type: 'string', default: 'space', options: ['space', 'self'], effect: 'space: the space integrates balls; self: this primitive moves them (non-physics spaces)' },
      breakCells: { type: 'boolean', default: false, effect: 'self motion: cells hit by a ball are removed (cell_broken)' },
      unbreakable: { type: 'list', default: [], of: { type: 'string' }, effect: 'cell tokens balls never break' },
    },
    provides: { events: ['ball_served', 'ball_launched', 'paddle_hit', 'ball_caught', 'ball_lost', 'balls_out', 'cell_broken', 'cell_broken:*', 'contact', 'multiball'], vars: ['paddle.balls', 'paddle.speed'], actions: ['launch', 'paddle_left', 'paddle_right'] },
    requires: { capabilities: ['position'] },
    actionSpace: { launch: { type: 'number', min: -1, max: 1 } },
    reads: [],
  },
  logic(logic) {
    logic.effect('paddle_multiball', { run: (e, rt) => rt.emit('paddle_request', { kind: 'multiball', count: e.count ?? 2 }) });
    logic.effect('paddle_mode', {
      check: (e, path, errors) => { if (!['catch', 'wide', 'slow'].includes(e.mode)) errors.push({ code: 'effect_invalid', path: `${path}.mode`, message: 'mode is catch|wide|slow' }); },
      run: (e, rt) => rt.emit('paddle_request', { kind: e.mode, sec: e.sec ?? 16 }),
    });
  },
  validate(config) {
    const errors = [];
    if (Math.abs(Math.hypot(...config.up) - 1) > 0.01) errors.push({ code: 'paddle_up', path: 'with.up', message: 'up must be a unit vector', hint: '[0,1]' });
    if (config.bounds.length === 1 || (config.bounds.length === 2 && config.bounds[0] >= config.bounds[1])) errors.push({ code: 'paddle_bounds', path: 'with.bounds', message: 'bounds is [min, max] with min < max' });
    if (config.breakCells && config.motion !== 'self') errors.push({ code: 'paddle_break_cells', path: 'with.breakCells', message: "breakCells needs motion 'self' (physics spaces report wall contacts instead)" });
    return errors;
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const up = config.up, tan = [up[1], -up[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const paddle = () => rt.entity(config.paddle);
    const api = () => rt.space(paddle().space);
    const widthOf = p => config.width || sizeOf(p)[0] * (st().wide > 0 ? 1.5 : 1);
    const speedOf = s => Math.min(config.speed * (1 + config.rampMax), config.speed * (1 + s.ramp)) * (s.slow > 0 ? 0.72 : 1);
    function init() {
      const s = st(); if (s.ramp !== undefined) return;
      Object.assign(s, { ramp: 0, balls: [], held: null, lastPos: null, lives: config.lives, wide: 0, slow: 0, catchT: 0, memo: {} });
    }
    function serve(s) {
      const p = paddle(); if (!p) return;
      const a = api(), c = centerOf(a, p), ps = sizeOf(p);
      const ball = rt.spawn(config.ball, { space: p.space, at: null });
      const bs = sizeOf(ball), off = 0.3;
      placeCenter(rt, a, ball, [c[0] + tan[0] * off * widthOf(p) / 2 + up[0] * (ps[1] / 2 + bs[1] / 2 + 0.02), c[1] + tan[1] * off * widthOf(p) / 2 + up[1] * (ps[1] / 2 + bs[1] / 2 + 0.02)]);
      setVel(rt, a, ball, [0, 0]);
      s.balls.push(ball.id); s.held = { id: ball.id, off, t: 0 };
      rt.emit('ball_served', { ball: ball.id });
      if (config.serve === 'auto') launch(s, 0);
    }
    function launch(s, aim) {
      const b = s.held && rt.entity(s.held.id); if (!b) return;
      const sp = speedOf(s), ang = clamp(aim, -0.9, 0.9);
      setVel(rt, api(), b, [tan[0] * Math.sin(ang) * sp + up[0] * Math.cos(ang) * sp, tan[1] * Math.sin(ang) * sp + up[1] * Math.cos(ang) * sp]);
      s.held = null;
      rt.emit('ball_launched', { ball: b.id, angle: ang });
    }
    function bounce(s, b) {
      const p = paddle(), a = api(), pc = centerOf(a, p), bc = centerOf(a, b);
      const off = clamp(dot([bc[0] - pc[0], bc[1] - pc[1]], tan) / (widthOf(p) / 2), -1, 1);
      if (config.catch || s.catchT > 0) { s.held = { id: b.id, off, t: 0 }; setVel(rt, a, b, [0, 0]); rt.emit('ball_caught', { ball: b.id, off }); return; }
      const ang = off * config.angle + dot(s.paddleVel || [0, 0], tan) * config.influence, sp = speedOf(s);
      setVel(rt, a, b, [tan[0] * Math.sin(ang) * sp + up[0] * Math.abs(Math.cos(ang)) * sp, tan[1] * Math.sin(ang) * sp + up[1] * Math.abs(Math.cos(ang)) * sp]);
      rt.emit('paddle_hit', { ball: b.id, off });
    }
    init();
    rt.action('launch', v => { const s = st(); if (s.held) launch(s, s.held.off * 0.9 + (Number(v) && v !== true ? Number(v) : 0) * 0.25); });
    rt.action('paddle_left', () => { st().steer = -1; });
    rt.action('paddle_right', () => { st().steer = 1; });
    for (const ev of config.rampEvents) rt.on(ev, () => { const s = st(); s.ramp = Math.min(config.rampMax, s.ramp + config.rampPerEvent); });
    rt.on('paddle_request', d => {
      const s = st();
      if (d.kind === 'catch') s.catchT = d.sec; else if (d.kind === 'wide') s.wide = d.sec; else if (d.kind === 'slow') s.slow = d.sec;
      else if (d.kind === 'multiball') {
        const a = api(), src = s.balls.map(id => rt.entity(id)).filter(b => b && b.id !== s.held?.id).slice(0, 3);
        if (s.held) { launch(s, 0.3); src.push(rt.entity(s.balls[s.balls.length - 1])); }
        for (const b of src.filter(Boolean)) for (const turn of [-0.42, 0.42]) {
          const v = velOf(a, b), c = Math.cos(turn), sn = Math.sin(turn);
          const nb = rt.spawn(config.ball, { space: b.space, at: (a.pos ? a.pos(b) : b.at).slice() });
          setVel(rt, a, nb, [c * v[0] - sn * v[1], sn * v[0] + c * v[1]]);
          s.balls.push(nb.id);
        }
        rt.emit('multiball', { balls: s.balls.length });
      }
    });
    if (config.motion === 'space') rt.on('contact', d => {
      const s = st();
      if (!d.begin) return;
      const ballId = s.balls.includes(d.a) && d.b === config.paddle ? d.a : s.balls.includes(d.b) && d.a === config.paddle ? d.b : null;
      if (ballId && s.held?.id !== ballId) bounce(s, rt.entity(ballId));
    });

    rt.system('movement', rt => {
      const s = st(); init();
      const p = paddle(); if (!p) return;
      const a = api(), dt = rt.dt;
      for (const k of ['wide', 'slow', 'catchT']) if (s[k] > 0) s[k] = Math.max(0, s[k] - dt);
      if (!s.balls.length && !s.out) serve(s);
      // Paddle steering along the tangent.
      const axis = rt.input?.axes?.move?.[0] ?? 0, steer = s.steer || axis; s.steer = 0;
      const c = centerOf(a, p);
      let along = dot(c, tan) + clamp(steer, -1, 1) * config.move * dt;
      if (config.bounds.length === 2) along = clamp(along, config.bounds[0] + widthOf(p) / 2, config.bounds[1] - widthOf(p) / 2);
      const delta = along - dot(c, tan), next = [c[0] + tan[0] * delta, c[1] + tan[1] * delta];
      s.paddleVel = [tan[0] * delta / dt, tan[1] * delta / dt];
      if (config.motion === 'space' && a.setVelocity) setVel(rt, a, p, s.paddleVel); else placeCenter(rt, a, p, next);
      // Held ball rides the paddle.
      if (s.held) {
        const b = rt.entity(s.held.id);
        if (!b) s.held = null;
        else {
          s.held.t += dt;
          const pc = config.motion === 'space' && a.setVelocity ? next : centerOf(a, p), ps = sizeOf(p), bs = sizeOf(b), w = widthOf(p) / 2;
          placeCenter(rt, a, b, [pc[0] + tan[0] * s.held.off * w + up[0] * (ps[1] / 2 + bs[1] / 2 + 0.02), pc[1] + tan[1] * s.held.off * w + up[1] * (ps[1] / 2 + bs[1] / 2 + 0.02)]);
          setVel(rt, a, b, [0, 0]);
          if ((config.catch || s.catchT > 0) && s.held.t > config.catchSec) launch(s, s.held.off * 0.9);
        }
      }
      // Free balls: own motion (self), paddle contact, speed normalization, losses.
      const sp = speedOf(s), pc = centerOf(a, p);
      for (const id of [...s.balls]) {
        const b = rt.entity(id);
        if (!b) { s.balls = s.balls.filter(x => x !== id); continue; }
        if (s.held?.id === id) continue;
        if (config.motion === 'self') {
          const hit = stepSelf(rt, a, b, { gravity: false, restitution: 1, contactMemo: s.memo, filter: o => o.id !== config.paddle && !s.balls.includes(o.id) });
          if (config.breakCells && a.setCell) for (const { cell } of hit.cells) {
            const at = a.pos(b).length > 2 ? [...cell, Math.floor(a.pos(b)[2])] : cell, t = a.getCell(at);
            if (t != null && !config.unbreakable.includes(t)) { a.setCell(at, null, rt, ID); rt.emitTyped('cell_broken', t, { at, by: id }); }
          }
          // Paddle contact by overlap when the space does not report contacts.
          const bc = centerOf(a, b), bs = sizeOf(b), ps = sizeOf(p), rel = [bc[0] - pc[0], bc[1] - pc[1]];
          if (Math.abs(dot(rel, tan)) <= widthOf(p) / 2 + bs[0] / 2 && Math.abs(dot(rel, up)) <= ps[1] / 2 + bs[1] / 2 && dot(velOf(a, b), up) < 0) bounce(s, b);
        }
        if (s.held?.id === id) continue;
        const v = velOf(a, b), l = Math.hypot(v[0], v[1]) || 1;
        let vu = dot(v, up) / l, vt = dot(v, tan) / l;
        if (Math.abs(vu) < config.minUp) { vu = vu < 0 ? -config.minUp : config.minUp; vt = Math.sign(vt || 1) * Math.sqrt(1 - vu * vu); }
        setVel(rt, a, b, [(tan[0] * vt + up[0] * vu) * sp, (tan[1] * vt + up[1] * vu) * sp]);
        const behind = dot([centerOf(a, b)[0] - pc[0], centerOf(a, b)[1] - pc[1]], up);
        if (behind < -config.loseLine) {
          rt.despawn(id); s.balls = s.balls.filter(x => x !== id);
          rt.emit('ball_lost', { ball: id });
          if (!s.balls.length) {
            rt.emit('balls_out', {});
            s.ramp = 0;
            rt.run(config.onOut, {});
            if (config.lives) { s.lives--; if (s.lives <= 0) { s.out = true; rt.run(config.onNoLives, {}); } }
          }
        }
      }
      s.ramp = Math.min(config.rampMax, s.ramp + dt * config.rampPerSec);
      rt.state.vars['paddle.balls'] = config.lives ? s.lives : s.balls.length;
      rt.state.vars['paddle.speed'] = +sp.toFixed(4);
    }, ID);
    rt.options(rt => {
      const s = st(); if (!s.held) return [];
      return [-0.8, -0.4, 0, 0.4, 0.8].map(off => ({ label: `launch ${off}`, actions: { launch: off || true } }));
    });
  },
};
