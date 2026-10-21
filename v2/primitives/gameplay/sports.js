// gameplay.sports: ball games on any continuous space (football, hockey,
// basketball-like goals, car football). A ball entity, teams with kickoff
// spots, goal zones, a match clock with periods, overtime (golden goal or an
// extra period), mercy rule, kickoffs after goals, kicks, touches (last touch
// credits the scorer) and possession. With a physics space (dynamics
// capability: physics2d...) the space moves the ball and kicks are velocity
// changes; otherwise the ball is integrated here (drag, gravity, bounces off
// what slide() reports, momentum from players and vehicles that hit it).
import { ENTITY_KINDS } from '../../kernel/params.js';
import { err, has, spaceOf, r6, r6v, v3, add, sub, mul, dot, len, norm, matchesAny, sortedEntities, runBound } from './modes-lib-util.js';

const ID = 'gameplay.sports';
const STATES = ['kickoff', 'play', 'goal', 'break', 'over', 'won', 'lost', 'draw'];

export default {
  id: ID,
  card: {
    // The archetype its `ball` param names reads as a ball on screen (graphics/flat-art.js; never its name).
    presents: { ball: { role: 'prop', vector: 'orb' } },
    // Whose side its entities are on, as a person sees it (graphics/allegiance.js).
    sides: { param: 'teams', members: 'members' },
    loop: { shows: ['entities', 'zones'], verbs: ['kick'], progress: ['goal', 'ball_touched', 'kick'] },
    // The player plays: it joins the first team when no team lists it.
    engage: { join: { param: 'teams', field: 'members' } },
    // Ball-sport mode: the player's team scores into goal zones against the other team before the clock runs out.
    // Its target service (mode.targets): every team member but the player goes for the ball while play is live.
    mode: { loop: 'ball-sport', interaction: 'avatar-realtime', opponent: 'ai-side', space: ['engine.space.physics2d', 'engine.space.arena2d', ['position']], needs: { content: ['content.archetypes', 'spaces.zones'], participants: 'teams' }, targets: 'sports.targets', win: { param: 'onWin', end: 'endGame', shown: { var: 'score.*' }, reads: { event: 'goal', by: { actions: ['kick'], movement: true } } }, lose: { param: 'onLose', end: 'endGame', shown: { var: 'score.*' }, reads: { event: 'goal', by: { actions: ['kick'], movement: true } } }, bot: 'striker' },
    intent: 'Ball sports: ball, teams, goal zones, kickoffs, match clock with periods and overtime (golden goal or extra time), mercy rule, kicks, touches and last-touch scoring, possession; the ball rides the physics space when it has dynamics, else it is simulated here with drag, gravity, bounces and hits from players and cars.',
    views: ['td', 'side', '3p'],
    params: {
      ball: { type: 'ref', to: 'archetype', required: true, effect: 'the ball archetype' },
      ballId: { type: 'string', default: 'ball' },
      ballAt: { type: 'json', required: true, effect: 'kickoff spot of the ball' },
      teams: { type: 'list', min: 2, required: true, of: { type: 'object', fields: { id: { type: 'string', required: true }, members: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [] }, kickoff: { type: 'list', of: { type: 'json' }, default: [] } } } },
      goals: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, scores: { type: 'string', required: true, effect: 'team awarded when the ball enters' } } } },
      periodSec: { type: 'number', default: 180, min: 1, max: 7200, unit: 's' },
      periods: { type: 'integer', default: 2, min: 1, max: 9 },
      breakSec: { type: 'number', default: 2, min: 0, max: 600, unit: 's' },
      overtime: { type: 'string', options: ['none', 'golden', 'extra'], default: 'golden' },
      overtimeSec: { type: 'number', default: 60, min: 1, max: 3600, unit: 's' },
      mercy: { type: 'integer', default: 0, min: 0, max: 99, effect: 'end when a team leads by this many (0 = off)' },
      kickoffSec: { type: 'number', default: 1, min: 0, max: 30, unit: 's', effect: 'frozen countdown before play' },
      resetSec: { type: 'number', default: 2, min: 0, max: 30, unit: 's', effect: 'celebration time after a goal' },
      physics: { type: 'string', options: ['auto', 'own', 'space'], default: 'auto', effect: 'who moves the ball' },
      drag: { type: 'number', default: 0.4, min: 0, max: 20, unit: '/s' },
      bounce: { type: 'number', default: 0.7, min: 0, max: 1.5 },
      gravity: { type: 'boolean', default: true, effect: 'own physics: apply the space gravity' },
      kickRange: { type: 'number', default: 1.6, min: 0.1, max: 50 },
      kickPower: { type: 'number', default: 12, min: 0, max: 500, unit: 'm/s' },
      touchRange: { type: 'number', default: 1.1, min: 0.1, max: 50, effect: 'own physics: bodies this close push the ball' },
      touchTransfer: { type: 'number', default: 1.4, min: 0, max: 10, effect: 'ball speed relative to the hitter after a touch' },
      onGoal: { type: 'effects', default: [], effect: 'actor = scorer (last touch) when known' },
      onWin: { type: 'effects', default: [] }, onLose: { type: 'effects', default: [] }, onDraw: { type: 'effects', default: [] },
      endGame: { type: 'boolean', default: true },
    },
    provides: { events: ['kickoff', 'goal', 'goal:*', 'period_start', 'period_end', 'overtime', 'match_end', 'ball_touched', 'kick'], vars: ['score.*', 'match.clock', 'match.period', 'match.live'], actions: ['kick'], services: ['sports.targets'] },
    actionSpace: { kick: { kind: 'impulse', params: { power: { min: 0, max: 30 } } } },
    requires: { capabilities: ['position'] },
    reads: [],
  },
  logic(logic) {
    logic.predicate('sports', {
      check: (p, path, errors) => { if (!STATES.includes(p.sports)) errors.push(err('sports_state', path, `sports must be ${STATES.join('|')}`)); },
      test: (p, rt) => { const s = rt.state.prim[ID]; if (!s) return false; return ['won', 'lost', 'draw'].includes(p.sports) ? s.result === p.sports : s.phase === p.sports; },
    });
  },
  validate(config) {
    const errors = [], teams = new Set(config.teams.map(t => t.id));
    if (teams.size !== config.teams.length) errors.push(err('sports_teams', 'with.teams', 'team ids must be unique'));
    config.goals.forEach((g, i) => { if (!teams.has(g.scores)) errors.push(err('sports_teams', `with.goals[${i}].scores`, `unknown team '${g.scores}'`, [...teams].join(', '))); });
    if (!Array.isArray(config.ballAt)) errors.push(err('sports_ball', 'with.ballAt', 'ballAt must be a position'));
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.space ?? rt.doc.spaces[0].id, F = s => Math.round(s * 60);
    const st = () => { const s = rt.store(ID); s.phase ??= 'init'; s.score ??= Object.fromEntries(config.teams.map(t => [t.id, 0])); return s; };
    const api = () => rt.space(sid);
    const ball = () => rt.entity(config.ballId);
    const members = t => sortedEntities(rt).filter(e => e.id !== config.ballId && matchesAny(e, t.members));
    const teamOf = id => config.teams.find(t => matchesAny(rt.entity(id), t.members))?.id ?? null;
    const playerTeam = () => config.teams.find(t => matchesAny(rt.player(), t.members))?.id ?? null;
    const usesSpace = () => config.physics === 'space' || (config.physics === 'auto' && has(api(), 'setVelocity'));
    const velOf = e => (has(spaceOf(rt, e), 'velocity') ? v3(spaceOf(rt, e).velocity(e)) : v3(e?.components.body?.vel || [0, 0, 0]));
    const setVel = (e, v) => { const a = spaceOf(rt, e); const out = r6v(v).slice(0, Math.max(2, e.at.length)); if (usesSpace() && has(a, 'setVelocity')) a.setVelocity(e, out, rt); else (e.components.body ??= {}).vel = out; };
    const centre = (e, a) => { const sz = v3(e.components.body?.size || [1, 1, 1]); return a.anchor === 'min' ? add(v3(e.at), mul(sz, 0.5)) : v3(e.at); };
    const dims = () => (Array.isArray(config.ballAt) ? config.ballAt.length : 3);

    function place() {
      let b = ball();
      if (!b) b = rt.spawn(config.ball, { id: config.ballId, space: sid, at: structuredClone(config.ballAt) });
      else api().setPos(b, structuredClone(config.ballAt), rt);
      setVel(b, [0, 0, 0]);
      for (const t of config.teams) members(t).forEach((m, i) => { if (t.kickoff[i] !== undefined && m.space === sid && !m.components.seat) { api().setPos(m, structuredClone(t.kickoff[i]), rt); if (m.components.body?.vel) setVel(m, [0, 0, 0]); } });
    }
    function kickoff(s) { place(); s.phase = 'kickoff'; s.t = F(config.kickoffSec); s.lastTouch = null; rt.emit('kickoff', { period: s.period }); }
    function startPeriod(s, n, sec) { s.period = n; s.clock = F(sec); rt.emit('period_start', { period: n, overtime: n > config.periods }); kickoff(s); }
    function end(s) {
      const top = config.teams.map(t => t.id).sort((x, y) => s.score[y] - s.score[x]);
      const winner = s.score[top[0]] === s.score[top[1]] ? null : top[0];
      const mine = playerTeam();
      s.phase = 'over'; s.winner = winner; s.result = winner === null ? 'draw' : !mine ? 'over' : winner === mine ? 'won' : 'lost';
      rt.emit('match_end', { winner, score: { ...s.score } });
      runBound(rt, s.result === 'won' ? config.onWin : s.result === 'lost' ? config.onLose : s.result === 'draw' ? config.onDraw : [], { actor: 'player' });
      if (config.endGame && rt.state.status === 'playing') rt.run([{ do: 'end_game', outcome: s.result === 'won' ? 'won' : s.result === 'lost' ? 'lost' : 'neutral' }]);
    }
    const tied = s => { const v = Object.values(s.score); return v.every(x => x === v[0]); };
    function periodOver(s) {
      rt.emit('period_end', { period: s.period });
      if (s.period < config.periods) { s.phase = 'break'; s.t = F(config.breakSec); return; }
      if (tied(s) && config.overtime !== 'none' && !s.ot) { s.ot = true; rt.emit('overtime', { kind: config.overtime }); startPeriod(s, s.period + 1, config.overtime === 'golden' ? 36000 : config.overtimeSec); return; }
      end(s);
    }
    function touch(s, id) { if (s.lastTouch !== id) { s.lastTouch = id; rt.emit('ball_touched', { who: id, team: teamOf(id) }); } }

    rt.action('kick', v => {
      const s = st(), p = rt.player(), b = ball(); if (!p || !b || s.phase !== 'play' || p.space !== b.space) return;
      const a = api(), from = centre(p, a), to = centre(b, a), d = sub(to, from);
      if (len(d) > config.kickRange) return;
      const dir = norm(v && Array.isArray(v.dir) ? v3(v.dir) : d), power = typeof v === 'object' && v.power !== undefined ? v.power : config.kickPower;
      setVel(b, mul(dir, power)); touch(s, p.id);
      rt.emit('kick', { who: p.id, power });
    });

    // The target service (card.mode.targets): the AI-controlled team members and the ball they go for in play.
    rt.provide('sports.targets', {
      participants: () => config.teams.flatMap(t => members(t)).filter(e => e.id !== 'player').map(e => e.id),
      target: () => (rt.state.prim[ID]?.phase === 'play' && ball() ? { entity: config.ballId } : null),
    });

    rt.system('physics', rt => {
      const s = st(), b = ball();
      if (s.phase !== 'play' || !b || usesSpace()) return;
      const a = api(), dt = rt.dt;
      let vel = velOf(b);
      // Hits from bodies that run into the ball: momentum along the contact normal.
      for (const t of config.teams) for (const m of members(t)) {
        if (m.space !== b.space) continue;
        const mc = centre(m.components.seat ? rt.entity(m.components.seat.vehicle) ?? m : m, a), bc = centre(b, a), d = sub(bc, mc), l = len(d);
        if (l > config.touchRange || l === 0) continue;
        const hitter = m.components.seat ? rt.entity(m.components.seat.vehicle) ?? m : m, n = mul(d, 1 / l), mv = velOf(hitter), closing = dot(sub(mv, vel), n);
        if (closing > 0) { vel = add(vel, mul(n, closing * config.touchTransfer)); touch(s, m.id); }
      }
      if (config.gravity && has(a, 'gravityAt')) vel = add(vel, mul(v3(a.gravityAt(b.at)), dt));
      vel = mul(vel, Math.exp(-config.drag * dt));
      const delta = mul(vel, dt).slice(0, b.at.length);
      if (has(a, 'slide')) {
        const res = a.slide(b, delta, rt), bl = res.blocked || {};
        if (bl.x) vel[0] = -vel[0] * config.bounce;
        if (bl.y) vel[1] = -vel[1] * config.bounce;
        if (bl.z) vel[2] = -vel[2] * config.bounce;
      } else a.setPos(b, r6v(add(v3(b.at), v3(delta))).slice(0, b.at.length), rt);
      setVel(b, vel.slice(0, Math.max(2, dims())));
    }, ID);

    rt.system('rules', rt => {
      const s = st();
      if (s.phase === 'init') { s.period = 0; startPeriod(s, 1, config.periodSec); }
      if (s.phase === 'over') return;
      if (s.phase === 'kickoff') { if (--s.t <= 0) s.phase = 'play'; else { const b = ball(); if (b) { api().setPos(b, structuredClone(config.ballAt), rt); setVel(b, [0, 0, 0]); } } }
      else if (s.phase === 'goal') { if (--s.t <= 0) { if (s.endAfterGoal) end(s); else kickoff(s); } }
      else if (s.phase === 'break') { if (--s.t <= 0) startPeriod(s, s.period + 1, config.periodSec); }
      else if (s.phase === 'play') {
        const b = ball();
        if (usesSpace()) for (const e of rt.state.events) if (e.name === 'contact' && (e.a === config.ballId || e.b === config.ballId)) { const o = e.a === config.ballId ? e.b : e.a; if (teamOf(o)) touch(s, o); }
        const g = b && config.goals.find(x => api().inZone(b, x.zone, rt));
        if (g) {
          s.score[g.scores]++; s.phase = 'goal'; s.t = F(config.resetSec);
          const scorer = s.lastTouch;
          rt.emitTyped('goal', g.scores, { team: g.scores, by: scorer, own: Boolean(scorer && teamOf(scorer) !== g.scores), score: { ...s.score } });
          runBound(rt, config.onGoal, { actor: scorer ?? 'player' });
          const vals = Object.values(s.score).sort((x, y) => y - x);
          if ((s.ot && config.overtime === 'golden') || (config.mercy && vals[0] - vals[1] >= config.mercy)) s.endAfterGoal = true;
        } else if (--s.clock <= 0) periodOver(s);
      }
      const v = rt.state.vars;
      for (const [t, n] of Object.entries(s.score)) v[`score.${t}`] = n;
      v['match.clock'] = Math.max(0, Math.ceil((s.clock ?? 0) / 60)); v['match.period'] = s.period ?? 0; v['match.live'] = s.phase === 'play' ? 1 : 0;
    }, ID);
  },
};
