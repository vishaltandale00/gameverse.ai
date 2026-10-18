// Alder Five: an original, deterministic 5v5 soccer simulation with rated
// fictional athletes, real rules (fouls, cards, offside, penalties), a utility
// based CPU and a controller-driven team select. World x is the goal-to-goal
// axis; world z (input y) is the touchline axis. Team 0 attacks +x.
import { certifySportsMove, stepSportsBall, certifySportsCollision, certifySportsPairCollision } from './sports-physics.js';
import { random, scale, has, teamProfile, validateProfile, createSetup, validateSetup, stepSetup, setupHud, athleteCard, validSeed, SPECIALTIES } from './sports-league.js';

const HALF_X = 28, HALF_Z = 17, GOAL = 4.3, MATCH_SECONDS = 600, BOX_X = 19, BOX_Z = 9, SPOT_X = 21.6, THIRD_X = HALF_X / 3;
const PHASES = ['setup', 'play', 'restart', 'goal', 'finished'];
const RESTARTS = ['Kickoff', 'Throw-in', 'Corner', 'Goal kick', 'Free kick', 'Penalty'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const direction = (x, z) => { const length = Math.hypot(x, z); return length > 0.001 ? { x: x / length, z: z / length } : { x: 1, z: 0 }; };
const attack = team => team === 0 ? 1 : -1;
const positions = [[-25, 0], [-12, -8], [-12, 8], [-5, -6], [-5, 6]];
// Team 0's controller record is the match state itself (the Decisions harness
// and saves read s.active / s.charge); team 1's record is s.away.
const ctrl = (s, team) => team === 0 ? s : s.away;
const pro = (s, p) => s.teams[p.team].players[p.id % 5];
const rate = (s, p, key, low, high) => scale(pro(s, p).ratings[key], low, high);
const spec = (s, p, id) => has(pro(s, p), id);
const onPitch = (s, team = null) => s.players.filter(p => !p.off && (team === null || p.team === team));
const outfield = (s, team) => onPitch(s, team).filter(p => !p.keeper);
const keeperOf = (s, team) => s.players[team * 5];
const inBox = (x, z, team) => x * attack(team) > BOX_X && Math.abs(z) < BOX_Z;
const CONTROL = { active: 3, charge: 0, charging: null, passReady: true, shootReady: true, pending: null, blockedActions: [], delivery: 'normal' };
const ATHLETE = { x: 0, z: 0, vx: 0, vz: 0, fx: 1, fz: 0, tackle: 0, cooldown: 0, think: 0, stamina: 1, fatigue: 0, shield: false, jockey: false,
  skillTime: 0, skillCooldown: 0, skillX: 0, skillZ: 0, skillType: 'none', skillDuration: .42, comboTime: 0, burst: 0, runTime: 0, kickTime: 0, saveTime: 0,
  headTime: 0, dive: 0, diveX: 0, diveZ: 0, diveDelay: 0, shoulder: 0, off: false, yellow: 0, plan: 'none' };
const ATHLETE_NUMBERS = ['tackle', 'cooldown', 'think', 'stamina', 'fatigue', 'skillTime', 'skillCooldown', 'skillX', 'skillZ', 'skillDuration', 'comboTime', 'burst', 'runTime', 'kickTime', 'saveTime', 'headTime', 'dive', 'diveX', 'diveZ', 'diveDelay', 'shoulder', 'x', 'z', 'vx', 'vz', 'fx', 'fz'];
const ATHLETE_STATS = ['goals', 'assists', 'shots', 'onTarget', 'passes', 'completed', 'tackles', 'interceptions', 'saves', 'fouls', 'cards'];
const TEAM_STATS = ['shots', 'onTarget', 'passes', 'completed', 'tackles', 'saves', 'fouls', 'yellows', 'reds', 'offsides', 'penalties', 'freeKicks', 'corners', 'possession'];
const zeroStats = keys => Object.fromEntries(keys.map(k => [k, 0]));

function resetPlayers(s) {
  s.players.forEach(p => {
    const side = attack(p.team), position = positions[p.id % 5];
    const { off, yellow, fatigue, stats } = p;
    Object.assign(p, structuredClone(ATHLETE), { off, yellow, fatigue, stats, x: position[0] * side, z: position[1], fx: side });
    if (off) { p.x = -side * 20; p.z = -HALF_Z - 1.6; }
  });
}
function createState({ teams = [0, 1], difficulty = 1, mode = 'play', seed = 0x5EED5, setup = true } = {}) {
  if (!validSeed(seed)) throw new RangeError('Soccer seed must be a uint32');
  const s = { version: 4, sport: 'soccer', frame: 0, phase: 'setup', clock: MATCH_SECONDS, score: [0, 0],
    setup: createSetup({ teams, difficulty, mode: mode === 'watch' ? 1 : 0 }), teams: teams.map(i => teamProfile('soccer', i)), difficulty, mode, seed,
    ...structuredClone(CONTROL), away: { ...structuredClone(CONTROL), active: 8 }, possessionAge: 0, feedback: { id: 0, kind: 'catch', strength: 0 },
    message: 'ALDER FIVE', messageTime: 0, restart: null, phaseTime: 0, setPiece: null,
    players: Array.from({ length: 10 }, (_, id) => ({ id, team: id < 5 ? 0 : 1, keeper: id % 5 === 0, ...structuredClone(ATHLETE), stats: zeroStats(ATHLETE_STATS) })),
    ball: { x: -4, z: -6, y: .32, vx: 0, vz: 0, vy: 0, owner: 3, lastTouch: 0, kicker: -1, lock: 0, spin: 0, touch: 0, shot: false, pass: false, style: 'normal', flight: 0, flagged: [], assist: -1 },
    stats: Object.fromEntries(TEAM_STATS.map(k => [k, [0, 0]])), events: [] };
  resetPlayers(s);
  if (!setup) beginMatch(s);
  return s;
}
// Kick-off straight into play: team 0's kickoff taker starts with the ball.
function beginMatch(s) {
  s.score = [0, 0]; s.clock = MATCH_SECONDS; s.stats = Object.fromEntries(TEAM_STATS.map(k => [k, [0, 0]])); s.events = []; s.restart = null; s.setPiece = null; s.phaseTime = 0;
  s.players.forEach(p => { p.off = false; p.yellow = 0; p.fatigue = 0; p.stats = zeroStats(ATHLETE_STATS); });
  resetPlayers(s);
  Object.assign(s, structuredClone(CONTROL)); s.away = { ...structuredClone(CONTROL), active: 8 };
  Object.assign(s.ball, { x: -4, z: -6, y: .32, vx: 0, vz: 0, vy: 0, owner: 3, lastTouch: 0, kicker: -1, lock: 0, spin: 0, touch: 0, shot: false, pass: false, style: 'normal', flight: 0, flagged: [], assist: -1 });
  s.possessionAge = 0; s.phase = 'play';
  say(s, `KICKOFF · ${s.teams[0].short} ATTACKS RIGHT`, 3);
}
function applySetup(s) {
  s.teams = s.setup.teams.map(i => teamProfile('soccer', i)); s.mode = s.setup.mode === 1 ? 'watch' : 'play'; s.difficulty = s.setup.difficulty;
  beginMatch(s);
}
const finite = n => typeof n === 'number' && Number.isFinite(n);
const counts = (o, keys) => !!o && keys.every(k => Number.isInteger(o[k]) && o[k] >= 0);
function validateControl(s, c, team) {
  if (!c || !Number.isInteger(c.active) || c.active < team * 5 || c.active > team * 5 + 4 || !finite(c.charge)
    || ![null, 'pass', 'shoot', 'through', 'lob'].includes(c.charging) || typeof c.passReady !== 'boolean' || typeof c.shootReady !== 'boolean'
    || !Array.isArray(c.blockedActions) || !c.blockedActions.every(k => ['shoot', 'lob'].includes(k))
    || !['normal', 'finesse', 'through', 'loft', 'driven'].includes(c.delivery)) throw new Error('Invalid soccer controller state');
  if (c.pending && (!['pass', 'shoot', 'through', 'lob'].includes(c.pending.kind) || !['time', 'x', 'z'].every(k => finite(c.pending[k])))) throw new Error('Invalid soccer buffered action');
}
function validateState(s) {
  if (!s || s.version !== 4 || s.sport !== 'soccer' || !PHASES.includes(s.phase)
    || !Number.isInteger(s.frame) || s.frame < 0 || !finite(s.clock) || s.clock < 0 || s.clock > MATCH_SECONDS
    || !Array.isArray(s.score) || s.score.length !== 2 || !s.score.every(n => Number.isInteger(n) && n >= 0)
    || !Array.isArray(s.players) || s.players.length !== 10 || !s.ball || !Array.isArray(s.events) || s.events.length > 40
    || !finite(s.possessionAge) || !finite(s.phaseTime) || !finite(s.messageTime) || typeof s.message !== 'string'
    || !validateSetup('soccer', s.setup) || !Array.isArray(s.teams) || s.teams.length !== 2 || !s.teams.every(t => validateProfile('soccer', t))
    || ![0, 1, 2].includes(s.difficulty) || !['play', 'watch'].includes(s.mode) || !validSeed(s.seed)
    || !s.feedback || !Number.isInteger(s.feedback.id) || !finite(s.feedback.strength)) throw new Error('Invalid Alder Five match');
  validateControl(s, s, 0); validateControl(s, s.away, 1);
  for (const [i, p] of s.players.entries()) {
    if (p.id !== i || p.team !== (i < 5 ? 0 : 1) || p.keeper !== (i % 5 === 0) || typeof p.shield !== 'boolean' || typeof p.jockey !== 'boolean' || typeof p.off !== 'boolean'
      || !Number.isInteger(p.yellow) || p.yellow < 0 || p.yellow > 2 || typeof p.skillType !== 'string' || typeof p.plan !== 'string' || !counts(p.stats, ATHLETE_STATS)
      || !ATHLETE_NUMBERS.every(k => finite(p[k])) || (p.off && p.keeper) || (p.skillTime > 0 && p.skillDuration <= 0)) throw new Error('Invalid soccer athlete');
  }
  const b = s.ball;
  if (!['x', 'z', 'y', 'vx', 'vz', 'vy', 'lock', 'spin', 'touch', 'flight'].every(k => finite(b[k])) || typeof b.shot !== 'boolean' || typeof b.pass !== 'boolean' || !['normal', 'finesse', 'through', 'loft', 'driven'].includes(b.style)
    || !Number.isInteger(b.owner) || b.owner < -1 || b.owner > 9 || ![0, 1].includes(b.lastTouch) || !Number.isInteger(b.kicker) || b.kicker < -1 || b.kicker > 9
    || !Number.isInteger(b.assist) || b.assist < -1 || b.assist > 9 || !Array.isArray(b.flagged) || !b.flagged.every(id => Number.isInteger(id) && id >= 0 && id <= 9)) throw new Error('Invalid soccer ball');
  if (!s.stats || !TEAM_STATS.every(k => Array.isArray(s.stats[k]) && s.stats[k].length === 2 && s.stats[k].every(n => finite(n) && n >= 0 && (k === 'possession' || Number.isInteger(n))))) throw new Error('Invalid soccer stats');
  if (!s.events.every(e => e && Number.isInteger(e.frame) && finite(e.clock) && typeof e.kind === 'string' && [0, 1, null].includes(e.team) && typeof e.text === 'string')) throw new Error('Invalid soccer events');
  if (s.phase === 'restart' && (!s.restart || ![0, 1].includes(s.restart.team) || !RESTARTS.includes(s.restart.type)
    || !['x', 'z', 'time'].every(k => finite(s.restart[k])) || (s.restart.confirmQueued !== undefined && typeof s.restart.confirmQueued !== 'boolean') || !Number.isInteger(s.restart.taker) || s.restart.taker < 0 || s.restart.taker > 9 || s.players[s.restart.taker].team !== s.restart.team
    || (s.restart.wall !== undefined && (!Array.isArray(s.restart.wall) || !s.restart.wall.every(id => Number.isInteger(id) && id >= 0 && id <= 9 && s.players[id].team === 1 - s.restart.team && !s.players[id].off))))) throw new Error('Invalid soccer restart');
  if (s.phase === 'goal' && (!s.restart || ![0, 1].includes(s.restart.team))) throw new Error('Invalid soccer goal restart');
  if (s.setPiece !== null && (!s.setPiece || !RESTARTS.includes(s.setPiece.kind) || s.setPiece.kind === 'Kickoff' || !Number.isInteger(s.setPiece.taker) || s.setPiece.taker < 0 || s.setPiece.taker > 9 || ![0, 1].includes(s.setPiece.team) || s.players[s.setPiece.taker].team !== s.setPiece.team)) throw new Error('Invalid soccer set piece');
  return true;
}
// ------------------------------------------------------------- presentation
function signal(s, kind, strength = 0.5) { s.feedback = { id: (s.feedback?.id || 0) + 1, kind, strength: clamp(strength, 0, 1) }; }
function say(s, message, seconds = 2.4) { s.message = message; s.messageTime = seconds; }
function event(s, kind, team, text) { s.events.unshift({ frame: s.frame, clock: s.clock, kind, team, text }); if (s.events.length > 40) s.events.pop(); }
const name = (s, p) => pro(s, p).short.toUpperCase();
const callout = (s, p, ids) => { const id = ids.find(id => spec(s, p, id)); return id ? ` · ${SPECIALTIES.soccer[id].name.toUpperCase()}` : ''; };
// A team without a controller plays at the chosen difficulty; teammates of a
// controller athlete always play at Pro.
let controlled = [true, false]; // Which teams have a controller this step (never saved).
const level = (s, team) => s.mode === 'watch' || !controlled[team] ? s.difficulty : 1;
const LEVELS = [{ react: .5, noise: .34, error: 1.35 }, { react: .32, noise: .16, error: 1 }, { react: .2, noise: .07, error: .8 }];
const cpu = (s, team) => LEVELS[level(s, team)];
// ------------------------------------------------------------------- ball
function takeBall(s, p) {
  const b = s.ball, assist = b.pass && b.lastTouch === p.team && b.kicker !== p.id && b.kicker >= 0 ? b.kicker : -1;
  if (b.pass && b.lastTouch === p.team && b.kicker !== p.id && b.kicker >= 0) { s.stats.completed[p.team]++; s.players[b.kicker].stats.completed++; }
  b.owner = p.id; b.lastTouch = p.team; b.vx = p.vx; b.vz = p.vz; b.vy = 0; b.spin = 0; b.touch = 0; b.shot = false; b.pass = false; b.flight = 0; b.assist = assist;
  s.possessionAge = 0; p.think = 0; signal(s, 'catch', 0.24);
  const c = ctrl(s, p.team); if (!p.keeper) c.active = p.id;
  c.charge = 0; c.charging = null;
}
// Rating-driven execution: Shooting narrows shot error and raises top power,
// Passing narrows pass direction/power error. Specialties apply here only.
function kick(s, p, type, power, aim, finesse = false, style = 'normal') {
  const b = s.ball, side = attack(p.team), shot = type === 'shoot', clear = type === 'clear', noise = (random(s) * 2 - 1);
  let d = direction(aim.x, aim.z), speed;
  if (shot || clear) {
    const box = inBox(p.x, p.z, p.team);
    const rushed = clamp(1 - nearestOpponent(s, p).d / 2.5, 0, 1), wide = Math.abs(Math.atan2(p.z, Math.abs(side * HALF_X - p.x)));
    let error = rate(s, p, 'sho', .13, .03) * (box && spec(s, p, 'finisher') ? .6 : 1) * (finesse ? .65 : 1) * (1 + Math.max(0, power - .8) * 3) * (1 + (1 - p.stamina) * .4) * (1 + rushed * 1.4) * (1 + wide * .6);
    if (p.headTime > 0) error *= spec(s, p, 'aerial') ? .6 : 1.4;
    const angle = noise * error, cos = Math.cos(angle), sin = Math.sin(angle);
    d = { x: d.x * cos - d.z * sin, z: d.x * sin + d.z * cos };
    speed = (18 + power * rate(s, p, 'sho', 15, 21)) * (finesse ? .93 : 1) * (power > .7 && spec(s, p, 'cannon') ? 1.2 : 1);
    if (p.headTime > 0) speed *= spec(s, p, 'aerial') ? .95 : .68;
    if (s.setPiece?.kind === 'Penalty' && s.setPiece.taker === p.id) speed = Math.min(speed, 26); // A placed penalty, not a cannon from six metres.
    if (shot) { s.stats.shots[p.team]++; p.stats.shots++; }
  } else {
    const driven = style === 'through' || style === 'driven';
    let error = rate(s, p, 'pas', .13, .03) * (driven && spec(s, p, 'playmaker') ? .6 : 1) * (style === 'loft' ? 1.3 : 1);
    const angle = noise * error, cos = Math.cos(angle), sin = Math.sin(angle);
    d = { x: d.x * cos - d.z * sin, z: d.x * sin + d.z * cos };
    speed = (10 + power * 16) * (driven ? 1.22 : style === 'loft' ? .84 : 1) * (1 + (random(s) * 2 - 1) * rate(s, p, 'pas', .14, .04) * (driven && spec(s, p, 'playmaker') ? .6 : 1));
    if (p.headTime > 0) speed *= .7;
    s.stats.passes[p.team]++; p.stats.passes++;
  }
  b.owner = -1; b.x = p.x + d.x * 1.05; b.z = p.z + d.z * 1.05; b.y = p.headTime > 0 ? Math.max(.35, b.y) : .35;
  b.vx = d.x * speed; b.vz = d.z * speed; b.vy = shot || clear ? 2.2 + power * 3.2 : 0.8 + power * 1.3;
  if (style === 'loft') b.vy = 5.2 + power * 4.2;
  if (style === 'through') b.vy = 0.35;
  if (p.headTime > 0) b.vy = shot ? -.6 + power * 1.5 : 1.2;
  p.kickTime = 0.28; signal(s, shot || clear ? 'kick' : 'pass', 0.35 + power * 0.6);
  if (style === 'through') say(s, 'THROUGH BALL · RUN INTO SPACE', 1.4);
  if (style === 'loft') say(s, Math.abs(p.z) > 7 && p.x * side > 8 ? 'CROSS INTO THE BOX' : 'LOFTED SERVICE', 1.4);
  b.spin = finesse ? -Math.sign(p.z || d.z || 1) * side * (0.5 + power * 0.25) : 0;
  if (finesse) say(s, 'FINESSE · CURLING SHOT', 1.5);
  p.skillTime = 0;
  const restartKick = s.setPiece?.taker === p.id && !['Free kick', 'Penalty'].includes(s.setPiece.kind);
  b.lastTouch = p.team; b.kicker = p.id; b.lock = 0.32; b.shot = shot; b.pass = !shot && !clear; b.style = finesse ? 'finesse' : style; b.flight = 0; b.flagged = shot || clear || restartKick ? [] : offsidePositions(s, p);
  if (s.setPiece?.taker === p.id) { if (s.setPiece.kind === 'Penalty') penaltyDive(s, keeperOf(s, 1 - p.team), d); s.setPiece = null; }
  s.possessionAge = 0; const c = ctrl(s, p.team); c.charge = 0; c.charging = null;
}
// Offside: only in the attacking third. Attackers ahead of the ball and beyond
// the second-last defender when a teammate passes are flagged; a flagged
// athlete touching the ball next concedes an indirect free kick.
function offsidePositions(s, passer) {
  const side = attack(passer.team), line = offsideLine(s, passer.team), ballX = s.ball.x * side;
  return outfield(s, passer.team).filter(q => q.id !== passer.id && q.x * side > THIRD_X && q.x * side > ballX + .1 && q.x * side > line + .15).map(q => q.id);
}
// Left-stick assistance chooses an intended receiver inside a forward cone.
// Power selects nearby versus distant teammates; the resulting kick still uses
// the same free ball physics and can be intercepted or overhit.
function humanKick(s, p, action, power, aim, modifier = false, style = 'normal') {
  const d = direction(aim.x, aim.z), isShot = action === 'shoot', side = attack(p.team);
  if (!isShot) {
    const desired = 7 + power * 27;
    const candidates = onPitch(s, p.team).filter(q => q.id !== p.id).map(q => {
      const distance = dist(q, p), alignment = ((q.x - p.x) * d.x + (q.z - p.z) * d.z) / Math.max(distance, .01);
      return { q, distance, alignment, rank: alignment * 9 - Math.abs(distance - desired) * .22 + (action === 'through' && q.runTime > 0 ? 1.2 : 0) };
    }).filter(c => c.alignment > .42 && c.distance > 1.6 && c.distance < 38).sort((a, b) => b.rank - a.rank || a.q.id - b.q.id);
    const target = candidates[0]?.q;
    if (target) {
      const time = clamp(dist(target, p) / (12 + power * 16), .15, 1.1);
      const lead = action === 'through' ? (2.3 + power * 4.5) * (1 + (random(s) * 2 - 1) * rate(s, p, 'pas', .45, .1) * (spec(s, p, 'playmaker') ? .6 : 1)) : 0;
      const x = clamp(target.x + target.vx * time * .65 + side * lead, -27, 27);
      const z = clamp(target.z + target.vz * time * .65, -16, 16);
      kick(s, p, 'pass', power, { x: x - p.x, z: z - p.z }, false, style);
    } else kick(s, p, 'pass', power, d, false, style);
    return;
  }
  const goalX = side * HALF_X, toward = direction(goalX - p.x, -p.z);
  // Deliberately facing away remains a clearance. Otherwise LS chooses the
  // side of goal, rather than requiring a precise world-space shooting ray.
  if (d.x * toward.x + d.z * toward.z < -.25) { kick(s, p, 'clear', power, d, modifier); say(s, 'CLEARED', 1); return; }
  const pressure = Math.max(0, 2.6 - Math.min(99, ...outfield(s, 1 - p.team).map(q => dist(p, q))));
  const error = Math.sin(s.frame * 1.73 + p.id * 2.1) * (pressure * .72 + (1 - p.stamina) * .38 + Math.max(0, power - .78) * 17);
  const placement = clamp(d.z * 4.6 + p.z * .1, -3.9, 3.9), risk = (Math.abs(placement) / 3.9) ** 2;
  const goalZ = placement + error + (random(s) * 2 - 1) * risk * rate(s, p, 'sho', 1.5, .6) * (modifier ? .7 : 1);
  let shot = direction(goalX - p.x, goalZ - p.z);
  if (modifier) shot = curl(s, p, shot, power);
  kick(s, p, 'shoot', power, shot, modifier);
}
// ---------------------------------------------------------------- restarts
const takerFor = (s, type, team, ball) => {
  const squad = onPitch(s, team).filter(p => type === 'Goal kick' ? p.keeper : !p.keeper);
  const key = type === 'Penalty' || type === 'Free kick' && Math.abs(ball.x - attack(team) * HALF_X) < 24 ? 'sho' : type === 'Corner' || type === 'Free kick' ? 'pas' : null;
  return squad.sort((a, b) => key ? pro(s, b).ratings[key] - pro(s, a).ratings[key] : dist(a, ball) - dist(b, ball))[0];
};
function restart(s, type, team, x, z) {
  s.phase = 'restart'; s.restart = { type, team, x, z, time: 0, confirmQueued: false }; s.setPiece = null;
  Object.assign(s.ball, { owner: -1, x, z, y: .32, vx: 0, vz: 0, vy: 0, spin: 0, shot: false, pass: false, flight: 0, flagged: [] });
  s.players.forEach(p => { p.vx = p.vz = 0; p.skillTime = 0; p.shield = false; p.dive = 0; p.tackle = 0; });
  for (const c of [s, s.away]) { c.charging = null; c.charge = 0; c.pending = null; }
  say(s, `${type.toUpperCase()} · ${s.teams[team].short}`, 5);
  if (type === 'Kickoff') resetPlayers(s);
  if (type === 'Corner') s.stats.corners[team]++;
  const taker = takerFor(s, type, team, s.ball), side = attack(team);
  taker.x = x; taker.z = z; taker.fx = side; taker.fz = z === 0 ? 0 : -Math.sign(z) * 0.5;
  if (type === 'Free kick' || type === 'Penalty') { const toGoal = direction(side * HALF_X - x, -z); taker.fx = toGoal.x; taker.fz = toGoal.z; }
  ctrl(s, team).active = taker.id;
  // Give the restart taker space; the rules never trap a ball outside the field.
  if (type === 'Penalty') {
    s.players.filter(p => !p.off && p.id !== taker.id && inBox(p.x, p.z, team)).forEach(p => { p.x = side * (BOX_X - 2 - (p.id % 5) * 1.3); p.z = clamp(p.z + (p.id % 2 ? 3 : -3), -15, 15); });
    const keeper = keeperOf(s, 1 - team); keeper.x = side * (HALF_X - .6); keeper.z = 0; keeper.fx = -side; keeper.fz = 0;
  } else if (type === 'Free kick') {
    const goal = { x: side * HALF_X, z: 0 }, toGoal = direction(goal.x - x, goal.z - z), range = dist(taker, goal);
    const defenders = outfield(s, 1 - team).sort((a, b) => dist(a, s.ball) - dist(b, s.ball));
    const wall = range < 24 ? defenders.slice(0, range < 15 ? 2 : 1) : [];
    wall.forEach((p, i) => { p.x = clamp(x + toGoal.x * 5.2 - toGoal.z * (i - (wall.length - 1) / 2) * 1.1, -27, 27); p.z = clamp(z + toGoal.z * 5.2 + toGoal.x * (i - (wall.length - 1) / 2) * 1.1, -16, 16); p.fx = -toGoal.x; p.fz = -toGoal.z; });
    s.restart.wall = wall.map(p => p.id);
    onPitch(s, 1 - team).filter(p => !wall.includes(p) && !p.keeper && dist(p, s.ball) < 5.5).forEach(p => { const away = direction(p.x - x, p.z - z); p.x = clamp(x + away.x * 5.5, -27, 27); p.z = clamp(z + away.z * 5.5, -16, 16); });
    s.players.filter(p => !p.off && p.team === team && p.id !== taker.id && dist(p, taker) < 3).forEach(p => { p.x = clamp(p.x - side * 3, -27, 27); });
  } else s.players.filter(p => !p.off && p.id !== taker.id && dist(p, taker) < 4).forEach(p => { p.x = clamp(p.x - side * 4, -27, 27); p.z = clamp(p.z + (p.id % 2 ? 4 : -4), -16, 16); });
  // Clamping a restart push at a touchline can put two athletes in the same
  // place. Place each athlete against already occupied restart spots.
  const placed = [taker];
  for (const athlete of s.players.filter(p => p.id !== taker.id && !p.off)) {
    const original = { x: athlete.x, z: athlete.z }; let found = false;
    for (let radius = 0; radius <= 6 && !found; radius += 1.2) for (let turn = 0; turn < 16 && !found; turn++) {
      const angle = (turn + athlete.id * .37) * Math.PI / 8, candidate = { x: clamp(original.x + Math.cos(angle) * radius, -27, 27), z: clamp(original.z + Math.sin(angle) * radius, -16, 16) };
      if (placed.every(other => dist(candidate, other) >= 1.1) && !(type === 'Penalty' && !athlete.keeper && inBox(candidate.x, candidate.z, team))) { athlete.x = candidate.x; athlete.z = candidate.z; found = true; }
    }
    placed.push(athlete);
  }
  s.restart.taker = taker.id;
}
function resumeRestart(s) {
  const r = s.restart, p = s.players[r.taker];
  s.phase = 'play'; takeBall(s, p); s.restart = null; say(s, r.type === 'Kickoff' ? 'PLAY ON' : `${r.type.toUpperCase()} · PLAY ON`, 1.3);
  if (r.type !== 'Kickoff') { s.setPiece = { kind: r.type, taker: p.id, team: r.team }; s.ball.x = r.x; s.ball.z = r.z; }
  if (r.type === 'Free kick' || r.type === 'Penalty') return;
  if ((!controlled[r.team] && r.type !== 'Kickoff') || p.keeper) {
    const teammate = onPitch(s, p.team).filter(q => !q.keeper && q.id !== p.id).sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (teammate) kick(s, p, 'pass', p.keeper ? rate(s, p, 'kic', .4, .55) : .48, direction(teammate.x - p.x, teammate.z - p.z));
    if (p.keeper && teammate) ctrl(s, p.team).active = teammate.id;
  }
}
// --------------------------------------------------------------- movement
// Pace sets run speed, sprint ceiling and acceleration; Dribbling sets turn
// response. Match fatigue trims everything. Ceilings stay under the 9.5 guard.
const fatigueFactor = p => 1 - p.fatigue * .08;
const runSpeed = (s, p) => rate(s, p, 'pac', 5.7, 6.6) * fatigueFactor(p);
const sprintSpeed = (s, p) => (runSpeed(s, p) + (rate(s, p, 'pac', 1.9, 2.4) + (p.burst > 0 ? .3 : 0)) * clamp(p.stamina / .18, 0, 1)) * (p.burst > 0 && spec(s, p, 'speedster') ? 1.02 : 1);
function move(s, p, targetX, targetZ, speed, dt) {
  if (p.off) return;
  const dx = targetX - p.x, dz = targetZ - p.z, distance = Math.hypot(dx, dz);
  speed = Math.min(speed, 9.3);
  const desiredSpeed = Math.min(speed, distance / dt), d = direction(dx, dz);
  // A failed tackle commits the athlete to a short lunge, then recovery.
  const recovering = p.cooldown > 0.35 && p.tackle <= 0;
  const targetVX = distance > 0.001 ? d.x * desiredSpeed * (recovering ? 0.35 : 1) : 0;
  const targetVZ = distance > 0.001 ? d.z * desiredSpeed * (recovering ? 0.35 : 1) : 0;
  const reversing = p.vx * targetVX + p.vz * targetVZ < 0;
  const sprinting = speed > runSpeed(s, p) + .05, base = rate(s, p, 'pac', 24, 30) * (sprinting && spec(s, p, 'speedster') ? 1.2 : 1), turn = rate(s, p, 'dri', 29, 36);
  const acceleration = distance < 0.001 ? 33 : p.dive > 0 ? (p.plan === 'penalty' ? 95 : 60) : p.burst > 0 ? base + 13 * (spec(s, p, 'speedster') ? 1.2 : 1) : p.shield || p.jockey ? 35 : reversing ? turn : base;
  const deltaX = targetVX - p.vx, deltaZ = targetVZ - p.vz, change = Math.hypot(deltaX, deltaZ);
  const amount = Math.min(1, acceleration * dt / Math.max(change, 0.00001));
  p.vx += deltaX * amount; p.vz += deltaZ * amount;
  if (p.skillType === 'dragback' && p.skillTime > 0.2) { p.vx *= Math.exp(-dt * 8); p.vz *= Math.exp(-dt * 8); }
  if (p.tackle > 0.1) { p.vx = p.fx * 7.4; p.vz = p.fz * 7.4; }
  const next = { x: p.x + p.vx * dt, z: p.z + p.vz * dt }; // The completed move, including separation, is certified below.
  p.x = clamp(next.x, -HALF_X + 0.4, HALF_X - 0.4); p.z = clamp(next.z, -HALF_Z + 0.4, HALF_Z - 0.4);
  if (p.x !== next.x) p.vx = 0; if (p.z !== next.z) p.vz = 0;
  if (Math.hypot(p.vx, p.vz) > 0.3 && !p.shield && !p.jockey && p.dive <= 0) { const facing = direction(p.vx, p.vz); p.fx = facing.x; p.fz = facing.z; }
}
// ------------------------------------------------------- contacts and flight
// Sweeps are collision proposals. Final rebounds pass the shared energy guard.
function sweepCircle(from, to, center, radius) {
  const dx = to.x - from.x, dz = to.z - from.z, ox = from.x - center.x, oz = from.z - center.z;
  const c = ox * ox + oz * oz - radius * radius, a = dx * dx + dz * dz;
  if (c <= 0) return { t: 0, normal: direction(ox, oz) };
  if (a < 1e-12) return null;
  const b = 2 * (ox * dx + oz * dz), disc = b * b - 4 * a * c; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > 1) return null;
  return { t, normal: direction(ox + dx * t, oz + dz * t) };
}
function rebound(ball, normal, restitution) {
  const dot = ball.vx * normal.x + ball.vz * normal.z;
  if (dot >= 0) return;
  const next = certifySportsCollision({ x: ball.vx, y: ball.vy, z: ball.vz }, { x: (ball.vx - 2 * dot * normal.x) * restitution, y: ball.vy * restitution, z: (ball.vz - 2 * dot * normal.z) * restitution });
  ball.vx = next.x; ball.vy = next.y; ball.vz = next.z; ball.spin *= 0.45;
}
// A parry sends the ball back into the field with less energy, scattered.
function parry(s, b, keeper) {
  const side = attack(keeper.team), speed = Math.hypot(b.vx, b.vz), angle = (random(s) * 2 - 1) * .9;
  const next = certifySportsCollision({ x: b.vx, y: b.vy, z: b.vz }, { x: side * Math.cos(angle) * speed * .3, y: 1.5 + random(s) * 1.5, z: Math.sin(angle) * speed * .3 });
  b.vx = next.x; b.vy = next.y; b.vz = next.z; b.spin = 0;
  b.kicker = keeper.id; b.lock = 0.22; b.lastTouch = keeper.team; b.shot = false; b.pass = false; b.flagged = [];
}
// A deflection (heavy touch, block) scatters the ball with less energy.
function deflect(s, b, normal, restitution, scatter, lift, player) {
  const angle = (random(s) * 2 - 1) * scatter, cos = Math.cos(angle), sin = Math.sin(angle);
  rebound(b, { x: normal.x * cos - normal.z * sin, z: normal.x * sin + normal.z * cos }, restitution);
  const next = certifySportsCollision({ x: b.vx, y: b.vy, z: b.vz }, { x: b.vx, y: Math.min(Math.abs(b.vy), lift), z: b.vz });
  b.vx = next.x; b.vy = next.y; b.vz = next.z;
  b.kicker = player.id; b.lock = 0.22; b.lastTouch = player.team; b.shot = false; b.pass = false; b.flagged = [];
}
const contactRadius = (s, p, b) => p.keeper ? 1.0 + (p.dive > 0 && p.diveDelay <= 0 ? .5 : 0) : (p.jockey ? 1.08 : .88) * (b.pass && b.lastTouch !== p.team && spec(s, p, 'interceptor') ? 1.25 : 1);
function header(s, p, b) {
  const side = attack(p.team), goal = { x: side * HALF_X, z: 0 }, c = ctrl(s, p.team), pending = controlled[p.team] && c.active === p.id ? c.pending : null;
  if ((controlled[p.team] && c.active === p.id && !pending) || p.headTime > 0 || Math.hypot(b.vx, b.vz) > 20) return false;
  p.headTime = .3; b.owner = p.id; b.y = Math.max(1.4, Math.min(b.y, 2.5)); b.x = p.x; b.z = p.z;
  const power = rate(s, p, 'sho', .4, .7) * (spec(s, p, 'aerial') ? 1.4 : 1);
  if (pending ? pending.kind === 'shoot' : dist(p, goal) < 20 && p.x * side > 8) {
    const keeper = keeperOf(s, 1 - p.team), target = { x: goal.x, z: -Math.sign(keeper.z || p.z || 1) * 2.6 };
    kick(s, p, 'shoot', clamp(power, .2, .95), direction(target.x - p.x, target.z - p.z));
    say(s, `HEADER · ${name(s, p)}${callout(s, p, ['aerial'])}`, 1.4); return true;
  }
  const mates = onPitch(s, p.team).filter(q => q.id !== p.id && !q.keeper).sort((a, b2) => dist(a, p) - dist(b2, p));
  const target = pending ? { x: p.x + pending.x * 10, z: p.z + pending.z * 10 } : mates[0] || { x: p.x + side * 10, z: p.z };
  kick(s, p, 'pass', clamp(power * .8, .2, .8), direction(target.x - p.x, target.z - p.z));
  say(s, `HEADED ${p.x * side < -8 ? 'CLEAR' : 'ON'} · ${name(s, p)}`, 1.2); return true;
}
function resolveFlight(s, previous) {
  const b = s.ball, end = { x: b.x, z: b.z }, impacts = [];
  for (const x of [-28.1, 28.1]) for (const z of [-GOAL, GOAL]) {
    const hit = sweepCircle(previous, end, { x, z }, 0.42);
    if (hit && previous.y + (b.y - previous.y) * hit.t < 3.3) impacts.push({ ...hit, post: true });
  }
  for (const x of [-28.1, 28.1]) {
    const hit = sweepCircle({ x: previous.x, z: previous.y }, { x: b.x, z: b.y }, { x, z: 3 }, 0.42);
    if (hit && Math.abs(previous.z + (b.z - previous.z) * hit.t) < GOAL + 0.1) impacts.push({ ...hit, crossbar: true });
  }
  for (const p of s.players) {
    if (p.off || (p.id === b.kicker && b.lock > 0)) continue;
    const hit = sweepCircle(previous, end, p, contactRadius(s, p, b));
    if (hit) { const y = previous.y + (b.y - previous.y) * hit.t; if (y < (p.keeper ? 2.8 : 2.6)) impacts.push({ ...hit, player: p, y }); }
  }
  impacts.sort((a, c) => a.t - c.t); const hit = impacts[0]; if (!hit) return;
  b.x = previous.x + (end.x - previous.x) * hit.t; b.z = previous.z + (end.z - previous.z) * hit.t;
  if (hit.crossbar) {
    const dot = b.vx * hit.normal.x + b.vy * hit.normal.z;
    const velocity = certifySportsCollision({ x: b.vx, y: b.vy, z: b.vz }, { x: (b.vx - 2 * dot * hit.normal.x) * 0.76, y: (b.vy - 2 * dot * hit.normal.z) * 0.76, z: b.vz * 0.76 });
    b.vx = velocity.x; b.vy = velocity.y; b.vz = velocity.z; b.y = previous.y + (b.y - previous.y) * hit.t + hit.normal.z * 0.03; b.x += hit.normal.x * 0.03; say(s, 'OFF THE CROSSBAR!', 1.5); return;
  }
  if (hit.post) { rebound(b, hit.normal, 0.76); b.x += hit.normal.x * 0.03; b.z += hit.normal.z * 0.03; say(s, 'OFF THE POST!', 1.5); return; }
  let receiver = hit.player; const speed = Math.hypot(b.vx, b.vz), opponentPass = b.lastTouch !== receiver.team;
  // 50-50: two opponents reach a slow loose ball in the same step. Physical wins.
  const rival = impacts.find(i => i.player && i.player.team !== receiver.team && i.t <= hit.t + .5);
  if (rival && !receiver.keeper && !rival.player.keeper) {
    const weight = q => rate(s, q, 'phy', .7, 1.3) * (spec(s, q, 'wall') ? 1.4 : 1);
    const a = weight(receiver), c = weight(rival.player), loser = random(s) * (a + c) < a ? rival.player : receiver;
    if (loser === receiver) receiver = rival.player;
    loser.cooldown = Math.max(loser.cooldown, .45); say(s, `50-50 · ${name(s, receiver)} WINS IT${callout(s, receiver, ['wall'])}`, 1.3);
  }
  if (receiver.keeper) {
    const saved = opponentPass && b.shot && speed > 12;
    // How central the ball passes through the keeper's reach: the last third is fingertips.
    const sweep = Math.hypot(end.x - previous.x, end.z - previous.z), closest = sweep > 1e-6 ? Math.abs((end.x - previous.x) * (previous.z - receiver.z) - (end.z - previous.z) * (previous.x - receiver.x)) / sweep : dist(previous, receiver);
    if (saved && closest > contactRadius(s, receiver, b) * .68 && random(s) > rate(s, receiver, 'div', .62, .9) * (spec(s, receiver, 'cat_reflexes') && dist(b, receiver) < 12 ? 1.1 : 1)) { b.x = end.x; b.z = end.z; say(s, `${name(s, receiver)} CAN'T REACH IT`, 1); return; }
    if (saved) {
      s.stats.saves[receiver.team]++; receiver.stats.saves++; s.stats.onTarget[1 - receiver.team]++; if (b.kicker >= 0) s.players[b.kicker].stats.onTarget++;
      receiver.saveTime = 0.48;
      const comfortable = speed < 26 && receiver.dive <= 0 && hit.y < 2;
      const catchChance = rate(s, receiver, 'han', .5, .9) * (speed > 24 ? .7 : 1) * (receiver.dive > 0 ? .75 : 1) * (hit.y > 2.2 ? .8 : 1);
      if (!comfortable && random(s) > catchChance) { parry(s, b, receiver); say(s, `PARRIED · ${name(s, receiver)} · LOOSE IN THE BOX`, 1.5); event(s, 'save', receiver.team, `SAVE · ${name(s, receiver)}`); signal(s, 'save', .8); return; }
      say(s, `KEEPER SAVE! ${name(s, receiver)}${callout(s, receiver, ['cat_reflexes'])}`, 1.6); event(s, 'save', receiver.team, `SAVE · ${name(s, receiver)}`);
    } else if (opponentPass && hit.y > 1.2) say(s, `${name(s, receiver)} CLAIMS IT${callout(s, receiver, ['sweeper_keeper'])}`, 1.3);
    if (offsideTouch(s, receiver)) return;
    takeBall(s, receiver); if (saved) signal(s, 'save', 0.8); return;
  }
  if (hit.y > 1.0) {
    if (opponentPass && b.shot && speed > 22) { deflect(s, b, hit.normal, .42, .4, 2, receiver); say(s, 'SHOT BLOCKED', 1.1); return; }
    if (offsideTouch(s, receiver)) return;
    if (header(s, receiver, b)) return;
    b.x = end.x; b.z = end.z; return; // The ball passes over an athlete who chose not to head it.
  }
  if (opponentPass && b.shot && speed > 20 && hit.y > 0.4) { deflect(s, b, hit.normal, .42, .4, 2, receiver); say(s, `BLOCKED · ${name(s, receiver)}`, 1.1); return; }
  if (offsideTouch(s, receiver)) return;
  // First touch: a hard pass to a poor dribbler can bounce off and go loose.
  const weighted = (b.style === 'driven' || b.style === 'through') && b.kicker >= 0 && spec(s, s.players[b.kicker], 'playmaker') ? .6 : 1;
  if (!opponentPass && b.pass && speed > rate(s, receiver, 'dri', 14, 26) && random(s) < clamp((speed - rate(s, receiver, 'dri', 14, 26)) / 12, 0, .75) * weighted) {
    deflect(s, b, hit.normal, .35, 1, 1.2, receiver); say(s, `HEAVY TOUCH · ${name(s, receiver)} · LOOSE BALL`, 1.3); return;
  }
  if (opponentPass && (b.pass || receiver.jockey)) { receiver.stats.interceptions++; say(s, `${receiver.jockey ? 'READ THE LANE · ' : ''}INTERCEPTED · ${name(s, receiver)}${callout(s, receiver, ['interceptor'])}`, 1.3); signal(s, 'tackle', 0.5); }
  takeBall(s, receiver);
}
// ------------------------------------------------------------------ skills
function skillMove(s, p, gesture = { x: 0, y: 0 }) {
  if (p.shield || s.ball.owner !== p.id || s.setPiece) return;
  const d = Math.hypot(gesture.x, gesture.y) > 0.3 ? direction(gesture.x, gesture.y) : { x: -p.fz, z: p.fx };
  const forward = d.x * p.fx + d.z * p.fz, side = d.x * (-p.fz) + d.z * p.fx;
  const opposite = p.comboTime > 0 && p.skillType === 'roll' && (d.x * p.skillX + d.z * p.skillZ) < -0.5;
  if (p.skillCooldown > 0 && !opposite) { signal(s, 'denied', 0.18); return; }
  if (p.stamina < 0.09) { say(s, 'RECOVER YOUR LEGS', 1); signal(s, 'denied', 0.2); return; }
  const trickster = spec(s, p, 'trickster');
  p.skillTime = 0.42; p.skillDuration = 0.42; p.skillCooldown = 0.72; p.comboTime = 0.62;
  p.stamina = clamp(p.stamina - (trickster ? 0.035 : 0.07), 0, 1); signal(s, 'skill', 0.46);
  // Dribbling decides whether the trick stays on the foot or spills loose.
  if (random(s) < rate(s, p, 'dri', .3, .03)) {
    Object.assign(s.ball, { owner: -1, vx: p.vx + d.x * 4.5, vz: p.vz + d.z * 4.5, vy: .5, y: .36, kicker: p.id, lock: .3, spin: 0, pass: false, shot: false, flagged: [] });
    p.skillType = 'none'; p.skillTime = 0; say(s, 'HEAVY TOUCH · SKILL SPILLS LOOSE', 1.3); signal(s, 'denied', .3); return;
  }
  if (opposite) {
    p.skillType = 'double'; p.skillX = d.x; p.skillZ = d.z; p.skillDuration = p.skillTime = 0.32; p.burst = 0.58; p.comboTime = 0;
    say(s, 'DOUBLE TOUCH · EXIT INTO SPACE', 1.3);
  } else if (forward > 0.7) {
    p.skillType = 'knockon'; p.burst = 0.72; p.skillTime = 0;
    Object.assign(s.ball, { owner: -1, vx: p.fx * (Math.hypot(p.vx, p.vz) + 7.4), vz: p.fz * (Math.hypot(p.vx, p.vz) + 7.4), vy: 0.65, y: 0.36, kicker: p.id, lock: 0.22, spin: 0, pass: false, shot: false, flagged: [] });
    say(s, 'KNOCK-ON · CHASE YOUR TOUCH', 1.3);
  } else if (forward < -.6) {
    p.skillType = 'dragback'; p.skillX = -p.fx; p.skillZ = -p.fz; p.skillDuration = p.skillTime = 0.5; p.comboTime = 0;
    say(s, 'DRAG BACK · CHANGE DIRECTION', 1.3);
  } else {
    p.skillType = 'roll'; p.skillX = -p.fz * Math.sign(side || 1); p.skillZ = p.fx * Math.sign(side || 1);
    say(s, 'BALL ROLL · FLICK BACK FOR DOUBLE TOUCH', 1.4);
  }
}
function requestRun(s, owner) {
  const candidates = outfield(s, owner.team).filter(p => p.id !== owner.id);
  candidates.sort((a, b) => (dist(a, owner) + Math.abs(a.z - owner.z) * 0.3) - (dist(b, owner) + Math.abs(b.z - owner.z) * 0.3));
  if (candidates[0]) { candidates[0].runTime = 3.1; say(s, `${name(s, candidates[0])} · MAKING THE RUN`, 1.4); signal(s, 'skill', 0.25); }
}
function laneClearance(s, from, to, team) {
  const dx = to.x - from.x, dz = to.z - from.z, length = dx * dx + dz * dz;
  return Math.min(8, ...onPitch(s, 1 - team).map(p => { const t = clamp(((p.x - from.x) * dx + (p.z - from.z) * dz) / Math.max(length, 0.1), 0, 1); return Math.hypot(p.x - from.x - dx * t, p.z - from.z - dz * t); }));
}
// ---------------------------------------------------------- tackles, rules
function tackle(s, p) {
  if (p.cooldown > 0 || p.off) return;
  p.tackle = .28; p.cooldown = .95; p.vx = p.fx * 7.4; p.vz = p.fz * 7.4;
}
function offsideTouch(s, p) {
  const b = s.ball;
  if (!b.flagged.includes(p.id)) return false;
  const team = p.team;
  s.stats.offsides[team]++; s.stats.freeKicks[1 - team]++; signal(s, 'whistle', .6);
  event(s, 'offside', team, `OFFSIDE · ${name(s, p)}`);
  restart(s, 'Free kick', 1 - team, clamp(p.x, -26, 26), clamp(p.z, -15.5, 15.5)); say(s, `OFFSIDE · ${name(s, p)}`, 2.5); return true;
}
function card(s, p, kind) {
  const team = p.team;
  if (kind === 'yellow') {
    p.yellow = Math.min(2, p.yellow + 1); s.stats.yellows[team]++; p.stats.cards++;
    if (p.yellow < 2) { say(s, `YELLOW CARD · ${name(s, p)}`, 2.6); event(s, 'card', team, `YELLOW CARD · ${name(s, p)}`); signal(s, 'card', .6); return; }
  }
  // Never reduce a team below two outfield athletes: the booking stands instead.
  if (outfield(s, team).length <= 2) {
    if (p.yellow === 0) { p.yellow = 1; s.stats.yellows[team]++; p.stats.cards++; }
    say(s, `YELLOW CARD · ${name(s, p)}`, 2.6); event(s, 'card', team, `YELLOW CARD · ${name(s, p)}`); signal(s, 'card', .6); return;
  }
  s.stats.reds[team]++; p.stats.cards++; p.off = true; p.yellow = 2; p.x = -attack(team) * 20; p.z = -HALF_Z - 1.6; p.vx = p.vz = 0; p.runTime = 0;
  if (ctrl(s, team).active === p.id) ctrl(s, team).active = outfield(s, team)[0].id;
  say(s, `${kind === 'yellow' ? 'SECOND YELLOW · ' : ''}RED CARD · ${name(s, p)}`, 3); event(s, 'card', team, `RED CARD · ${name(s, p)}`); signal(s, 'card', 1);
}
// Fouls: direct free kick at the spot, or a penalty inside the box. Cards for
// reckless or late challenges; denying an obvious chance is a straight red.
function foul(s, offender, victim, { reckless = false, late = false }) {
  const team = offender.team, other = 1 - team, side = attack(other);
  s.stats.fouls[team]++; offender.stats.fouls++; signal(s, 'whistle', .7);
  const clear = victim.x * side > 12 && Math.abs(victim.z) < 9 && !outfield(s, team).some(q => q.id !== offender.id && q.x * side > victim.x * side - .5 && Math.abs(q.z - victim.z) < 6);
  event(s, 'foul', team, `FOUL · ${name(s, offender)}`); say(s, `FOUL · ${name(s, offender)}`, 2.2);
  if (!offender.keeper) {
    if (clear || (late && reckless && random(s) < .15)) card(s, offender, 'red');
    else if ((reckless && random(s) < .3) || random(s) < .08) card(s, offender, 'yellow');
  }
  const { message, messageTime } = s;
  if (inBox(victim.x, victim.z, other)) {
    s.stats.penalties[other]++; event(s, 'penalty', other, `PENALTY · ${s.teams[other].short}`);
    restart(s, 'Penalty', other, side * SPOT_X, 0); say(s, /CARD/.test(message) ? `${message} · PENALTY!` : 'PENALTY!', 3); return;
  }
  s.stats.freeKicks[other]++;
  restart(s, 'Free kick', other, clamp(victim.x, -26, 26), clamp(victim.z, -15.5, 15.5)); say(s, message, messageTime);
}
function tackleContact(s, p) {
  // Contact is resolved during the lunge, after both athletes have moved.
  // There is no instant ownership transfer on the button press.
  if (p.tackle > .24 || p.tackle < .08 || p.off) return;
  const owner = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
  if (!owner || owner.team === p.team || dist(owner, p) > 1.95) return;
  const toBall = direction(s.ball.x - p.x, s.ball.z - p.z), reach = rate(s, p, 'def', 1.12, 1.4) * (spec(s, p, 'ball_winner') ? 1.15 : 1);
  const approach = direction(p.x - owner.x, p.z - owner.z), behind = approach.x * owner.fx + approach.z * owner.fz;
  if (p.fx * toBall.x + p.fz * toBall.z < .25 || dist(p, s.ball) > reach) {
    // Hit the athlete, not the ball, late in the lunge: a foul decided by angle,
    // speed and Defending. Earlier frames keep reaching for the ball.
    if (p.tackle > .14 || dist(owner, p) > 1.1) return;
    p.tackle = .07;
    const chance = rate(s, p, 'def', .5, .18) * (spec(s, p, 'ball_winner') ? .5 : 1) * (behind < -.3 ? 1.5 : 1) * (Math.hypot(owner.vx, owner.vz) > 5 ? 1.3 : 1);
    if (random(s) < chance) foul(s, p, owner, { reckless: behind < -.3 && Math.hypot(owner.vx, owner.vz) > 5.5, late: dist(p, s.ball) > reach + .7 });
    return;
  }
  const coverage = rate(s, owner, 'phy', .25, .55) * (spec(s, owner, 'wall') ? 1.4 : 1) * (owner.stamina < .1 ? .6 : 1);
  if (owner.shield && behind < coverage) {
    p.tackle = .07; say(s, `SHIELDED · ${name(s, owner)}${callout(s, owner, ['wall'])}`, 1.3); signal(s, 'denied', .2); return;
  }
  takeBall(s, p); p.tackle = .07; s.stats.tackles[p.team]++; p.stats.tackles++; say(s, `CLEAN TACKLE · ${name(s, p)}${callout(s, p, ['ball_winner'])}`, 1.2); signal(s, 'tackle', .65);
}
// Shoulder challenges: a defender running alongside the carrier contests the
// ball with Physical. Losing costs balance; the carrier never loses on a shield.
function shoulder(s, p, owner) {
  if (p.shoulder > 0 || !p.jockey || p.tackle > 0 || p.cooldown > 0 || dist(p, owner) > 1.15 || Math.hypot(owner.vx, owner.vz) < 3) return;
  const along = ((p.x - owner.x) * owner.fx + (p.z - owner.z) * owner.fz);
  if (Math.abs(along) > .8 || (p.vx * owner.vx + p.vz * owner.vz) < 4) return;
  p.shoulder = 2;
  const win = clamp(.42 + (pro(s, p).ratings.phy - pro(s, owner).ratings.phy) / 110 + (spec(s, p, 'wall') ? .12 : 0) - (spec(s, owner, 'wall') ? .12 : 0) - (owner.shield ? .15 : 0) + (owner.stamina < .1 ? .15 : 0), .08, .9);
  if (random(s) < win) { takeBall(s, p); s.stats.tackles[p.team]++; p.stats.tackles++; say(s, `SHOULDER CHARGE · ${name(s, p)}`, 1.3); signal(s, 'tackle', .5); }
  else { p.cooldown = Math.max(p.cooldown, .5); if (random(s) < .06) foul(s, p, owner, { reckless: false, late: false }); }
}
// -------------------------------------------------------------------- CPU
// Utility-based team play: the on-ball athlete scores shoot / pass / through /
// cross / dribble / skill / shield options with ratings, pressure, lanes, the
// offside line and the team's tactics; everyone else keeps shape, offers
// supporting angles, runs in behind, presses, covers and marks.
const goalOf = team => ({ x: attack(team) * HALF_X, z: 0 });
function nearestOpponent(s, p, point = p) { let q = null, d = 99; for (const o of outfield(s, 1 - p.team)) { const n = dist(o, point); if (n < d) { d = n; q = o; } } return { q, d }; }
// Side-relative x of the second-last defender facing `team`.
function offsideLine(s, team) { const side = attack(team), xs = onPitch(s, 1 - team).map(q => q.x * side).sort((a, b) => b - a); return xs.length > 1 ? xs[1] : xs[0] ?? HALF_X; }
const offsideNow = (s, q, team) => { const side = attack(team); return q.x * side > THIRD_X && q.x * side > s.ball.x * side && q.x * side > offsideLine(s, team) + .15; };
const isHuman = (s, p) => controlled[p.team] && ctrl(s, p.team).active === p.id;
// Curl compensation shared with the controller's finesse shot.
function curl(s, p, shot, power) {
  const side = attack(p.team), spin = -Math.sign(p.z || shot.z || 1) * side * (.5 + power * .25);
  const travel = Math.abs(side * HALF_X - p.x) / Math.max(8, (18 + power * 19) * .93 * Math.abs(shot.x));
  const angle = -spin * travel * .38, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: shot.x * cos - shot.z * sin, z: shot.x * sin + shot.z * cos };
}
function cpuShot(s, p, finesse) {
  const goal = goalOf(p.team), keeper = keeperOf(s, 1 - p.team), range = dist(p, goal);
  const z = -Math.sign(keeper.z || p.z || 1) * (1.8 + random(s) * 2.4), power = clamp(.4 + range / 40 + random(s) * .15 + (spec(s, p, 'cannon') ? .2 : 0), .35, .95);
  let aim = direction(goal.x - p.x, z - p.z); if (finesse) aim = curl(s, p, aim, power);
  kick(s, p, 'shoot', power, aim, finesse);
}
function cpuPass(s, p, q, style, power) {
  const side = attack(p.team), time = clamp(dist(q, p) / (12 + power * 16), .15, 1.1);
  const lead = style === 'through' ? (1.6 + power * 3) * (1 + (random(s) * 2 - 1) * rate(s, p, 'pas', .45, .1) * (spec(s, p, 'playmaker') ? .6 : 1)) : 0;
  const x = clamp(q.x + q.vx * time * .65 + side * lead, -27, 27), z = clamp(q.z + q.vz * time * .65, -16, 16);
  if (style === 'through') q.runTime = Math.max(q.runTime, 2.4);
  kick(s, p, 'pass', power, { x: x - p.x, z: z - p.z }, false, style);
}
function penaltyDive(s, keeper, d) {
  const correct = random(s) < rate(s, keeper, 'ref', .42, .68) * (spec(s, keeper, 'cat_reflexes') ? 1.15 : 1);
  const sign = (d.z < 0 ? -1 : 1) * (correct ? 1 : -1);
  keeper.dive = .6; keeper.plan = 'penalty'; keeper.diveDelay = rate(s, keeper, 'ref', .1, .03) * (spec(s, keeper, 'cat_reflexes') ? .8 : 1); keeper.diveX = keeper.x; keeper.diveZ = sign * rate(s, keeper, 'div', 2.6, 3.4);
}
function setPieceAi(s, p) {
  const sp = s.setPiece, goal = goalOf(p.team), side = attack(p.team);
  if (p.think < .9 + cpu(s, p.team).react) return;
  if (sp.kind === 'Penalty') { const z = (random(s) < .5 ? -1 : 1) * (2 + random(s) * 1.4); kick(s, p, 'shoot', .7 + random(s) * .22, direction(goal.x - p.x, z - p.z)); return; }
  const range = dist(p, goal);
  if (range < 15 || (range < 25 && Math.abs(p.z) < 11 && pro(s, p).ratings.sho > 62)) { cpuShot(s, p, range > 11); return; }
  const mates = outfield(s, p.team).filter(q => q.id !== p.id && !offsideNow(s, q, p.team)), boxMate = mates.find(q => q.x * side > 15 && Math.abs(q.z) < 9);
  if (range < 32 && boxMate) { cpuPass(s, p, boxMate, 'loft', clamp(dist(p, boxMate) / 24, .45, .85)); return; }
  const target = mates.sort((a, b) => laneClearance(s, p, b, p.team) - laneClearance(s, p, a, p.team))[0] || keeperOf(s, p.team);
  cpuPass(s, p, target, 'normal', clamp(dist(p, target) / 30 + .15, .25, .85));
}
function keeperAi(s, p, dt) {
  const b = s.ball, side = attack(p.team), own = goalOf(1 - p.team), owner = b.owner >= 0 ? s.players[b.owner] : null, L = cpu(s, p.team);
  if (b.owner === p.id) {
    if (s.possessionAge > .45 + L.react * .5) {
      const directness = s.teams[p.team].tactics.directness;
      const score = q => laneClearance(s, p, q, p.team) * 3 - dist(q, p) * .12 + (q.x - p.x) * side * directness * .2 - (nearestOpponent(s, q).d < 3 ? 4 : 0) - (laneClearance(s, p, q, p.team) < 3 ? 6 : 0);
      const target = outfield(s, p.team).sort((a, c) => score(c) - score(a))[0];
      if (target) { const far = dist(target, p); cpuPass(s, p, target, far > 24 ? 'loft' : 'normal', clamp(far / 32 + .1, .3, .9) * rate(s, p, 'kic', .85, 1.02)); }
    }
    return;
  }
  if (s.setPiece?.kind === 'Penalty') { move(s, p, own.x + side * .6, 0, 5, dt); p.fx = side; p.fz = 0; return; }
  if (p.dive > 0) { if (p.diveDelay > 0) move(s, p, p.x, p.z, 0, dt); else move(s, p, p.diveX, p.diveZ, p.plan === 'penalty' ? 9.2 : rate(s, p, 'div', 7.6, 9.2), dt); return; }
  p.plan = 'none';
  if (b.shot && b.owner < 0 && b.lastTouch !== p.team && b.vx * side < -1) {
    const reaction = rate(s, p, 'ref', .24, .1) * (spec(s, p, 'cat_reflexes') && dist(b, p) < 12 ? .6 : 1) * (1 + (L.react - .32));
    if (b.flight >= reaction) {
      const lineX = own.x + side * .7, t = (lineX - b.x) / b.vx;
      if (t > 0 && t < 1.5) {
        const zc = b.z + b.vz * t, yc = b.y + b.vy * t - 4.905 * t * t;
        if (Math.abs(zc) < GOAL + .6 && yc < 3.4) {
          const reach = rate(s, p, 'div', 2.6, 3.2);
          p.dive = clamp(t, .2, .6); p.diveX = lineX; p.diveZ = p.z + clamp(zc - p.z, -reach, reach); say(s, `${name(s, p)} DIVES`, .8); return;
        }
      }
    }
  }
  // Claim loose balls in the box when first to them; sweeper keepers go further.
  const sweeper = spec(s, p, 'sweeper_keeper');
  if (b.owner < 0 && !b.shot && b.x * side < (sweeper ? -11 : -17) && Math.abs(b.z) < (sweeper ? 13 : 10)) {
    const arrival = { x: b.x + b.vx * .35, z: b.z + b.vz * .35 }, mine = dist(p, arrival) / 7.5, theirs = Math.min(99, ...outfield(s, 1 - p.team).map(q => dist(q, arrival) / 7.8));
    if (mine < theirs + (sweeper ? .35 : .05)) { move(s, p, clamp(arrival.x, -27, 27), clamp(arrival.z, -16, 16), 7.5, dt); return; }
  }
  // Positioning: on the bisector toward the ball, off the line by Positioning.
  const toBall = direction(b.x - own.x, b.z - own.z), ballDist = dist(b, own);
  const out = clamp(rate(s, p, 'pos', 1.9, 3.3) * clamp(ballDist / 16, .5, 1.5), .6, 4.8) + (sweeper ? .8 : 0);
  const wobble = Math.sin(s.frame * .01 + p.id) * rate(s, p, 'pos', 1, .15), danger = b.x * side < -14;
  move(s, p, clamp(own.x + toBall.x * out, -HALF_X + .6, HALF_X - .6), clamp(own.z + toBall.z * out + wobble, -3.9, 3.9), danger ? 6.9 : 4.4, dt);
}
function onBallAi(s, p, dt) {
  const side = attack(p.team), goal = goalOf(p.team), b = s.ball, tactics = s.teams[p.team].tactics, L = cpu(s, p.team);
  const near = nearestOpponent(s, p), pressure = clamp(1 - near.d / 5, 0, 1);
  if (s.setPiece?.taker === p.id) { setPieceAi(s, p); return; }
  if (p.think >= L.react * (pressure > .5 ? 1 : 2)) {
    p.think = 0;
    const options = [], dGoal = dist(p, goal), angle = Math.abs(Math.atan2(p.z, Math.abs(goal.x - p.x))), line = offsideLine(s, p.team);
    if (dGoal < 27 && p.x * side > 2) {
      const lane = Math.min(8, ...outfield(s, 1 - p.team).map(q => { const t = clamp(((q.x - p.x) * (goal.x - p.x) + (q.z - p.z) * (goal.z - p.z)) / (dGoal * dGoal), 0, 1); return Math.hypot(q.x - p.x - (goal.x - p.x) * t, q.z - p.z - (goal.z - p.z) * t); }));
      let u = (1.08 - dGoal / 22) * (1 - angle * .55) + rate(s, p, 'sho', -.15, .25) + (lane < 1 ? -.6 : lane < 2 ? -.2 : lane > 3 ? .15 : .05) - pressure * .3 + tactics.directness * .2 - (dGoal > 17 ? .25 + (lane < 2.5 ? .3 : 0) : 0);
      if (inBox(p.x, p.z, p.team)) u += .35 + (spec(s, p, 'finisher') ? .18 : 0);
      if (dGoal > 12 && dGoal < 20 && spec(s, p, 'cannon')) u += .05;
      options.push({ type: 'shoot', u });
    }
    for (const q of onPitch(s, p.team)) {
      if (q.id === p.id) continue;
      const d = dist(q, p); if (d < 2.5 || d > 36) continue;
      const lane = laneClearance(s, p, q, p.team), progress = (q.x - p.x) * side, qSpace = nearestOpponent(s, q).d;
      // The CPU reads the offside line with level-dependent error, so tight calls happen.
      const offside = !q.keeper && q.x * side > THIRD_X && q.x * side > b.x * side && q.x * side > line + .15 + (random(s) - .35) * 1.6 * L.error;
      let u = .45 + (lane < 1.3 ? -.5 : Math.min(lane, 4) * .12) + progress * .022 * (.6 + tactics.directness) + Math.min(qSpace, 6) * .05 - Math.max(0, d - 22) * .03 + rate(s, p, 'pas', -.1, .15) + pressure * .3 - (q.keeper ? .6 : 0) + (q.x * side > 20 && Math.abs(q.z) < 9 ? .25 : 0) - (offside ? 1.5 : 0);
      options.push({ type: 'pass', q, u, d, lane });
      const ahead = { x: clamp(q.x + side * 7, -27, 27), z: q.z };
      if (!q.keeper && progress > 2 && q.x * side < line + .4 + (random(s) - .5) * L.error && laneClearance(s, p, ahead, p.team) > 1.6 && nearestOpponent(s, q, ahead).d > 2.5)
        options.push({ type: 'through', q, u: .35 + progress * .03 + tactics.directness * .3 + tactics.tempo * .15 + rate(s, p, 'pas', -.15, .2) + (spec(s, p, 'playmaker') ? .12 : 0) + (q.runTime > 0 ? .3 : 0), d, lane });
      if (!q.keeper && Math.abs(p.z) > 7 && p.x * side > 10 && q.x * side > 15 && Math.abs(q.z) < 9 && !offside && d > 8)
        options.push({ type: 'cross', q, u: .55 + (spec(s, q, 'aerial') ? .25 : 0) + rate(s, q, 'phy', -.1, .15) + pressure * .2 + (lane < 1.2 ? .15 : 0), d });
    }
    const space = laneClearance(s, p, { x: clamp(p.x + side * 6, -27, 27), z: p.z * .8 }, p.team);
    options.push({ type: 'dribble', u: .55 + Math.min(space, 5) * .1 + rate(s, p, 'dri', -.2, .25) - pressure * .45 - (p.x * side < 0 ? .1 : 0) - (p.x * side > 12 ? .15 : 0) - (p.x * side > 22 ? .3 : 0) + (1 - tactics.tempo) * .1 });
    if (near.q && near.d < 3.2 && p.skillCooldown <= 0 && p.stamina > .2) options.push({ type: 'skill', u: .3 + rate(s, p, 'dri', -.3, .45) + (spec(s, p, 'trickster') ? .2 : 0) });
    if (pressure > .5) options.push({ type: 'shield', u: .25 + rate(s, p, 'phy', -.1, .3) + (spec(s, p, 'wall') ? .15 : 0) });
    let best = null;
    for (const o of options) { o.u += (random(s) - .5) * L.noise * 2; if (!best || o.u > best.u) best = o; }
    p.plan = 'none';
    if (best.type === 'shoot') cpuShot(s, p, dGoal > 14 && pro(s, p).ratings.sho > 70 && random(s) < .45);
    else if (best.type === 'pass') { const playmaker = spec(s, p, 'playmaker'), driven = best.d > (playmaker ? 6 : 10) && (best.lane < 2.5 || playmaker) && random(s) < .75; cpuPass(s, p, best.q, driven ? 'driven' : 'normal', clamp((best.d * 1.35 - 10) / 16, .12, .8) * (driven ? (playmaker ? .92 : .85) : 1)); }
    else if (best.type === 'through') cpuPass(s, p, best.q, 'through', clamp((best.d * 1.35 - 10) / 16, .2, .7));
    else if (best.type === 'cross') cpuPass(s, p, best.q, 'loft', clamp(best.d / 24, .4, .85));
    else if (best.type === 'skill') {
      const lateral = Math.sign((near.q.x - p.x) * -p.fz + (near.q.z - p.z) * p.fx || 1);
      skillMove(s, p, space > 5 && random(s) < .3 ? { x: p.fx, y: p.fz } : { x: p.fz * lateral, y: -p.fx * lateral });
    } else p.plan = best.type;
  }
  p.stamina = clamp(p.stamina - dt * .05 * rate(s, p, 'phy', 1.2, .8) * (spec(s, p, 'engine') ? .65 : 1), 0, 1);
  if (p.plan === 'shield' && near.q) {
    p.shield = true; const away = direction(p.x - near.q.x, p.z - near.q.z); p.fx = away.x; p.fz = away.z;
    move(s, p, p.x + away.x * .4, p.z + away.z * .4, 2.6, dt); return;
  }
  const evading = near.q && near.d < 5;
  let tz = Math.abs(p.z) > 10 ? p.z * .7 : goal.z + (evading ? Math.sign(p.z - near.q.z || (p.id % 2) - .5) * 6 : p.z * .5);
  const speed = Math.min(sprintSpeed(s, p), runSpeed(s, p) + rate(s, p, 'dri', .2, 1.0));
  move(s, p, evading ? p.x + side * 8 : goal.x, clamp(tz, -13, 13), evading || p.x * side > 4 ? speed : runSpeed(s, p), dt);
}
function attackShape(s, p, owner, dt) {
  const side = attack(p.team), b = s.ball, tactics = s.teams[p.team].tactics, slot = p.id % 5, origin = owner || b, line = offsideLine(s, p.team);
  if (p.runTime > 0) {
    const targetX = owner ? Math.min(origin.x * side + 14, line - .6 + Math.max(0, 1.6 - p.runTime) * 1.6) : origin.x * side + 16;
    move(s, p, clamp(targetX * side, -25, 25), clamp(p.z + (p.z - origin.z) * dt, -14, 14), sprintSpeed(s, p), dt); return;
  }
  const width = 5 + tactics.width * 9, lane = slot === 1 ? -width * .5 : slot === 2 ? width * .5 : slot === 3 ? -width : width;
  const depth = slot <= 2 ? -8 : slot === 3 ? 5 : 9;
  let x = clamp(origin.x * side + depth, -24, 24), z = clamp(lane + b.z * .25, -14.5, 14.5);
  if (slot >= 3 && owner) {
    x = Math.min(x, line - .5);
    if (owner.x * side > -6 && x > line - 2.5 && (s.frame + p.id * 7) % 90 === 0 && random(s) < tactics.tempo * .7) p.runTime = 2.4;
  }
  if (owner) {
    if (laneClearance(s, owner, { x: x * side, z }, p.team) < 1.8) z = clamp(z + Math.sign(z - owner.z || lane) * 3, -14.5, 14.5);
    for (const mate of onPitch(s, p.team)) if (mate.id !== p.id && mate.id !== owner.id && Math.hypot(x * side - mate.x, z - mate.z) < 4) z = clamp(z + Math.sign(z - mate.z || p.id - mate.id) * 2.5, -14.5, 14.5);
  }
  move(s, p, x * side, z, runSpeed(s, p) * (owner ? .85 : 1), dt);
}
function defendShape(s, p, owner, dt) {
  const b = s.ball, tactics = s.teams[p.team].tactics, L = cpu(s, p.team), own = goalOf(1 - p.team);
  const mates = perFrame(s, p.team, 'ranked', () => outfield(s, p.team).filter(q => !isHuman(s, q)).sort((a, c) => dist(a, b) - dist(c, b)));
  const role = mates[0] === p ? 'press' : mates[1] === p ? 'cover' : 'mark';
  if (role === 'press') {
    if (!owner) { move(s, p, clamp(b.x + b.vx * .2, -27, 27), clamp(b.z + b.vz * .2, -16, 16), sprintSpeed(s, p), dt); return; }
    const target = { x: owner.x + owner.vx * .22, z: owner.z + owner.vz * .22 }, d = dist(p, target), pressRadius = 9 + tactics.press * 20;
    const deep = Math.max(0, dist(b, own) - pressRadius - 6), idle = s.possessionAge > 2.5 || (s.possessionAge > 1.2 && Math.hypot(owner.vx, owner.vz) < 1.5);
    if (deep > 0 && d > 5 && !idle) { const toGoal = direction(own.x - b.x, own.z - b.z), back = 6 + deep * .5; move(s, p, clamp(b.x + toGoal.x * back, -25, 25), clamp((b.z + toGoal.z * back) * .8, -13, 13), runSpeed(s, p), dt); return; }
    if (d < 2.4) {
      p.jockey = true; const facing = direction(b.x - p.x, b.z - p.z); p.fx = facing.x; p.fz = facing.z;
      // Jockey goal-side of a moving carrier; a carrier standing on the ball is confronted at the ball.
      const idleCarrier = s.possessionAge > 1.2 && Math.hypot(owner.vx, owner.vz) < 1.5;
      const goalSide = idleCarrier ? direction(b.x - owner.x, b.z - owner.z) : direction(own.x - owner.x, own.z - owner.z);
      move(s, p, owner.x + goalSide.x * 1.6, owner.z + goalSide.z * 1.6, clamp(Math.hypot(owner.vx, owner.vz) + .6, 4.8, sprintSpeed(s, p) * .95), dt);
      if (p.think > L.react * 3 && p.cooldown <= 0 && s.possessionAge > .5) {
        p.think = 0;
        const exposed = dist(owner, b) > .55 && dist(p, b) < 1.9 && (b.x - p.x) * p.fx + (b.z - p.z) * p.fz > 0, beaten = dist(owner, own) < dist(p, own) - .3;
        const still = Math.hypot(owner.vx, owner.vz) < 1;
        if (exposed && ((still && dist(p, b) < 1.5) || random(s) < (.4 + tactics.press * .2) * (spec(s, p, 'ball_winner') ? 1.3 : 1))) tackle(s, p);
        else if (owner.shield && dist(p, b) < 1.7 && random(s) < .45) tackle(s, p); // Physical and Wall decide this in tackleContact.
        else if (beaten && random(s) < .25 + tactics.press * .3) tackle(s, p);
        else if (random(s) < (owner.shield ? .5 : .3)) shoulder(s, p, owner);
      }
      return;
    }
    move(s, p, clamp(target.x, -27, 27), clamp(target.z, -16, 16), d > 6 ? sprintSpeed(s, p) : runSpeed(s, p), dt); return;
  }
  if (role === 'cover') {
    const toGoal = direction(own.x - b.x, own.z - b.z), back = (dist(b, own) < 22 ? 5 : 7) + Math.max(0, dist(b, own) - (9 + tactics.press * 20) - 6) * .6;
    move(s, p, clamp(b.x + toGoal.x * back, -25, 25), clamp((b.z + toGoal.z * back) * .7, -12, 12), runSpeed(s, p), dt); return;
  }
  const attackers = perFrame(s, p.team, 'attackers', () => outfield(s, 1 - p.team).filter(q => q.id !== owner?.id).sort((a, c) => dist(a, own) - dist(c, own)));
  const mark = attackers[mates.indexOf(p) - 2] || attackers[0];
  if (!mark) { move(s, p, (b.x + own.x) / 2, b.z * .5, runSpeed(s, p), dt); return; }
  const toBall = direction(b.x - mark.x, b.z - mark.z), toGoal = direction(own.x - mark.x, own.z - mark.z);
  move(s, p, clamp(mark.x + toGoal.x * 2.2 + toBall.x * .8, -27, 27), clamp(mark.z + toGoal.z * 2.2 + toBall.z * .8, -16, 16), runSpeed(s, p), dt);
}
// Team-level reads (who chases a loose ball, defensive roles) are decided once
// per frame per state object; every athlete of that team then shares them.
let frameCache = { state: null, frame: -1 };
function perFrame(s, team, key, compute) {
  if (frameCache.state !== s || frameCache.frame !== s.frame) frameCache = { state: s, frame: s.frame, values: [{}, {}] };
  const slot = frameCache.values[team];
  if (!(key in slot)) slot[key] = compute();
  return slot[key];
}
// Earliest moment an athlete can meet the free ball along its decaying path.
function interceptTime(s, q) {
  const b = s.ball, speed = sprintSpeed(s, q);
  let best = 2.4, at = { x: clamp(b.x + b.vx * .6, -27, 27), z: clamp(b.z + b.vz * .6, -16, 16) };
  for (let t = .1; t <= 2.4; t += .15) {
    const travel = b.y > .5 ? t : (1 - Math.exp(-.7 * t)) / .7, point = { x: clamp(b.x + b.vx * travel, -27, 27), z: clamp(b.z + b.vz * travel, -16, 16) };
    if (dist(q, point) / speed <= t + .05) return [t, point];
  }
  return [best + dist(q, at) / speed, at];
}
function ai(s, p, dt) {
  const b = s.ball, owner = b.owner >= 0 ? s.players[b.owner] : null;
  p.think += dt;
  if (p.keeper) { keeperAi(s, p, dt); return; }
  if (owner?.id === p.id) { onBallAi(s, p, dt); return; }
  if (s.setPiece) { move(s, p, p.x, p.z, 0, dt); return; }
  if (!owner) {
    // Whoever can reach the ball's path first chases it; everyone else keeps shape.
    const chase = perFrame(s, p.team, 'chase', () => {
      let best = null, bestTime = 99, point = null;
      for (const q of outfield(s, p.team)) { if (isHuman(s, q) || (q.id === b.kicker && b.lock > 0)) continue; const [t, at] = interceptTime(s, q); if (t < bestTime) { bestTime = t; best = q; point = at; } }
      return { id: best?.id ?? -1, point };
    });
    if (chase.id === p.id) { move(s, p, chase.point.x, chase.point.z, sprintSpeed(s, p), dt); return; }
  }
  const ownBall = owner ? owner.team === p.team : b.lastTouch === p.team && !b.shot;
  if (ownBall) attackShape(s, p, owner, dt); else defendShape(s, p, owner, dt);
}
// ------------------------------------------------------------------- step
// Cancellation wins even when an earlier render sample retained the press.
// Soccer B also aliases tackle; a voice-owned B must not commit that action.
function sanitize(input) {
  const pressed = { ...input.pressed }, held = { ...input.held }, released = { ...input.released };
  for (const [kind, cancelled] of Object.entries(input.cancelled || {})) if (cancelled) for (const key of kind === 'shoot' ? ['shoot', 'tackle'] : [kind]) { delete pressed[key]; delete held[key]; delete released[key]; }
  return { ...input, pressed, held, released };
}
// One controller drives team 0; { teams: [a, b] } drives each non-null team;
// watch mode drives nobody. Team 0's controller confirms shared screens.
function resolveInputs(s, input) {
  const teams = Array.isArray(input.teams) ? [input.teams[0] || null, input.teams[1] || null] : [input, null];
  const menuTeam = teams[0] ? 0 : 1, menu = sanitize(teams[menuTeam] || {});
  return { menu, menuTeam, teams: s.mode === 'watch' ? [null, null] : teams.map(t => t ? sanitize(t) : null) };
}
function finish(s) {
  s.phase = 'finished'; s.setPiece = null;
  for (const c of [s, s.away]) { c.charging = null; c.charge = 0; c.pending = null; }
  const [h, a] = s.score;
  say(s, h > a ? `${s.teams[0].short} WINS` : h < a ? `${s.teams[1].short} WINS` : 'HONORS EVEN', 1000); event(s, 'whistle', null, 'FULL TIME'); signal(s, 'whistle', .9);
}
function control(s, team, input, dt) {
  const c = ctrl(s, team), { pressed, held, released } = input, b = s.ball;
  if (s.players[c.active].off) c.active = outfield(s, team)[0].id;
  const defending = !(b.owner >= 0 && s.players[b.owner].team === team);
  if ((pressed.switch || input.gesture) && defending) {
    const from = s.players[c.active], flick = input.gesture;
    const candidates = outfield(s, team).filter(p => p.id !== c.active);
    const rank = q => { if (!flick) return dist(q, b); const d = direction(q.x - from.x, q.z - from.z); return -(d.x * flick.x + d.z * flick.y) * 20 + dist(q, from) * .15; };
    candidates.sort((a, d) => rank(a) - rank(d)); if (candidates[0]) { c.active = candidates[0].id; c.charging = null; c.charge = 0; }
  }
  const p = s.players[c.active], movement = input.move || { x: 0, y: 0 }, aim = input.aim || input.move || { x: 0, y: 0 };
  // A set-piece taker cannot dribble before kicking; defenders are held off.
  const locked = !!s.setPiece && (s.setPiece.taker === p.id || s.setPiece.team !== team);
  p.shield = !!held.shield && b.owner === p.id; p.jockey = !!held.shield && b.owner !== p.id;
  if (p.jockey) { const facing = direction(b.x - p.x, b.z - p.z); p.fx = facing.x; p.fz = facing.z; }
  if (c.pending) { c.pending.time -= dt; if (c.pending.time <= 0) c.pending = null; }
  const queuedAction = ['shoot', 'through', 'lob', 'pass'].find(kind => pressed[kind]);
  if (queuedAction && b.owner !== p.id && (b.owner >= 0 ? s.players[b.owner].team === team : b.lastTouch === team) && dist(p, b) < 7) { const d = Math.hypot(aim.x, aim.y) > .025 ? direction(aim.x, aim.y) : { x: p.fx, z: p.fz }; c.pending = { kind: queuedAction, time: 0.24, x: d.x, z: d.z }; }
  const length = Math.hypot(movement.x, movement.y), sprinting = !!held.sprint && !p.shield && !p.jockey;
  const speed = p.shield ? (p.stamina < .1 ? 2.4 : 3.4) : p.jockey ? 4.8 : sprinting ? sprintSpeed(s, p) : runSpeed(s, p);
  const drain = sprinting && length > 0.1 ? .16 : p.shield ? .09 : 0;
  p.stamina = clamp(p.stamina + dt * (drain ? -drain * rate(s, p, 'phy', 1.25, .8) * (spec(s, p, 'engine') ? .65 : 1) : 0.14 * (1 - p.fatigue * .3)), 0, 1);
  if (locked) move(s, p, p.x, p.z, 0, dt);
  else if (length > 0.12) move(s, p, p.x + movement.x / Math.max(1, length) * speed * dt, p.z + movement.y / Math.max(1, length) * speed * dt, speed, dt);
  else move(s, p, p.x, p.z, 0, dt);
  if (!p.jockey && Math.hypot(aim.x, aim.y) > 0.025 && (!(pressed.skill || input.gesture || p.skillTime > 0) || held.shoot)) { const d = direction(aim.x, aim.y); p.fx = d.x; p.fz = d.z; }
  if (pressed.tackle && b.owner !== p.id && !s.setPiece) { tackle(s, p); for (const kind of ['shoot', 'lob']) if (pressed[kind] && !c.blockedActions.includes(kind)) c.blockedActions.push(kind); }
  if ((pressed.skill || input.gesture) && !held.shoot && !held.pass && !held.through && !held.lob && !c.charging) skillMove(s, p, input.gesture || input.skillDirection || aim);
  if ((pressed.runRequest || pressed.switch) && b.owner === p.id) requestRun(s, p);
  let faked = false;
  if (c.charging === 'shoot' && pressed.pass && b.owner === p.id) { faked = true; c.charging = null; c.charge = 0; c.passReady = false; c.shootReady = false; p.burst = .45; p.skillType = 'fake'; p.skillTime = .3; p.skillDuration = .3; signal(s, 'skill', .4); say(s, 'SHOT FAKE · TAKE THE SPACE', 1.3); }
  // A used to enter play belongs to that transition, until it is released.
  if (!held.pass) c.passReady = true; if (!held.shoot) c.shootReady = true;
  if (b.owner === p.id && c.pending && !faked) { const pending = c.pending; c.pending = null; humanKick(s, p, pending.kind, 0.35, { x: pending.x, z: pending.z }, false, pending.kind === 'through' ? 'through' : pending.kind === 'lob' ? 'loft' : 'normal'); say(s, 'FIRST TIME', 1); }
  if (b.owner === p.id && !faked) {
    const type = (held.shoot || pressed.shoot) && c.shootReady && !c.blockedActions.includes('shoot') ? 'shoot' : (held.through || pressed.through) ? 'through' : (held.lob || pressed.lob) && !c.blockedActions.includes('lob') ? 'lob' : (held.pass || pressed.pass) && c.passReady ? 'pass' : null;
    if (type) {
      if (c.charging !== type) { c.charge = 0; c.delivery = 'normal'; } c.charging = type;
      if (type === 'through') c.delivery = held.switch ? 'loft' : 'through';
      else if (type === 'lob') c.delivery = 'loft';
      else if (type === 'pass' && (held.finesse || held.driven)) c.delivery = 'driven';
      else if (type === 'shoot' && held.finesse) c.delivery = 'finesse';
      c.charge = clamp(c.charge + dt / 0.9, 0, 1);
    }
    if (c.charging && (released[c.charging] || (!held[c.charging] && c.charge > 0))) {
      humanKick(s, p, c.charging, c.charge, { x: p.fx, z: p.fz }, c.charging === 'shoot' && (held.finesse || c.delivery === 'finesse'), c.delivery);
      if (held.switch) p.runTime = 2.8;
    }
  } else { c.charge = 0; c.charging = null; }
}
function step(s, dt, input = {}) {
  // The certified ball flight is defined at exactly 60 Hz; hosts accumulate and call this per fixed tick.
  if (!(dt > 0)) return;
  if (dt !== 1 / 60) throw new RangeError('Alder Five simulates at a fixed 1/60 s step');
  frameCache = { state: null, frame: -1 };
  const inputs = resolveInputs(s, input);
  controlled = inputs.teams.map(Boolean);
  for (const team of [0, 1]) {
    const inp = inputs.teams[team]; if (!inp) continue;
    const c = ctrl(s, team);
    c.blockedActions = c.blockedActions.filter(kind => inp.held[kind]);
    if (c.charging && inp.cancelled?.[c.charging]) { c.charging = null; c.charge = 0; c.shootReady = false; }
  }
  const { menu, menuTeam } = inputs;
  s.frame++; s.messageTime = Math.max(0, s.messageTime - dt);
  if (s.phase === 'setup') {
    if (stepSetup('soccer', s.setup, { ...menu.pressed, confirm: menu.pressed.confirm || menu.pressed.pass })) { applySetup(s); ctrl(s, menuTeam).passReady = !(menu.pressed.pass || menu.held.pass); }
    return;
  }
  if (s.phase === 'finished') {
    if (menu.pressed.back) { s.phase = 'setup'; say(s, 'ALDER FIVE', 0); return; }
    if (menu.pressed.confirm || menu.pressed.rematch) { beginMatch(s); ctrl(s, menuTeam).passReady = !(menu.pressed.pass || menu.held.pass); }
    return;
  }
  s.clock = Math.max(0, s.clock - dt);
  if (s.clock === 0) { finish(s); return; }
  if (s.phase === 'goal') {
    s.phaseTime -= dt;
    if (s.phaseTime <= 0) restart(s, 'Kickoff', s.restart.team, 0, 0);
    return;
  }
  if (s.phase === 'restart') {
    s.restart.time += dt;
    // Retain a new press through the brief presentation grace. A button already
    // held when the ball went out is not a restart request.
    const taker = inputs.teams[s.restart.team];
    if (taker && (taker.pressed.confirm || taker.pressed.pass)) s.restart.confirmQueued = true;
    if (s.restart.time > 0.45 && (s.restart.confirmQueued || s.restart.time > (taker ? 5 : 1.6))) {
      if (taker) ctrl(s, s.restart.team).passReady = !(taker.pressed.pass || taker.held.pass);
      resumeRestart(s);
    }
    return;
  }
  const b = s.ball;
  s.players.forEach(p => {
    p.cooldown = Math.max(0, p.cooldown - dt); p.tackle = Math.max(0, p.tackle - dt); p.skillTime = Math.max(0, p.skillTime - dt); p.skillCooldown = Math.max(0, p.skillCooldown - dt * (spec(s, p, 'trickster') ? 1.3 : 1));
    p.shield = false; p.jockey = false;
    if (!p.off && !isHuman(s, p) && b.owner !== p.id) p.stamina = clamp(p.stamina + dt * .14 * (1 - p.fatigue * .3), 0, 1);
    if (!p.off) p.fatigue = clamp(p.fatigue + dt * (.0006 + Math.hypot(p.vx, p.vz) / 9 * .0012) * rate(s, p, 'phy', 1.2, .85) * (spec(s, p, 'engine') ? .65 : 1), 0, 1);
    for (const key of ['comboTime', 'burst', 'runTime', 'kickTime', 'saveTime', 'headTime', 'shoulder']) p[key] = Math.max(0, p[key] - dt);
    if (p.diveDelay > 0) p.diveDelay = Math.max(0, p.diveDelay - dt); else p.dive = Math.max(0, p.dive - dt);
  });
  s.stats.possession[b.owner >= 0 ? s.players[b.owner].team : b.lastTouch] += dt;
  const previousPositions = s.players.map(p => ({ x: p.x, y: 0, z: p.z }));
  for (const team of [0, 1]) {
    if (inputs.teams[team]) control(s, team, inputs.teams[team], dt);
    else { const c = ctrl(s, team), p = s.players[c.active]; if (p.off || p.keeper) c.active = outfield(s, team)[0].id; }
  }
  if (s.setPiece && s.possessionAge > 6 && isHuman(s, s.players[s.setPiece.taker])) { const taker = s.players[s.setPiece.taker]; taker.think = 99; setPieceAi(s, taker); if (!s.setPiece) say(s, 'RESTART TAKEN', 1.2); }
  for (const q of s.players) if (!q.off && !isHuman(s, q)) ai(s, q, dt);
  // Soft separation makes crowded tackles readable without hard body pinning.
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const a = s.players[i], c = s.players[j]; if (a.off || c.off) continue;
    const d = dist(a, c);
    if (d > 0.001 && d < 0.9) {
      const push = (0.9 - d) * 0.22, dx = (a.x - c.x) / d * push, dz = (a.z - c.z) / d * push;
      a.x = clamp(a.x + dx, -27.6, 27.6); a.z = clamp(a.z + dz, -16.6, 16.6);
      c.x = clamp(c.x - dx, -27.6, 27.6); c.z = clamp(c.z - dz, -16.6, 16.6);
      const nx = (a.x - c.x) / Math.max(dist(a, c), 0.001), nz = (a.z - c.z) / Math.max(dist(a, c), 0.001);
      const approach = (a.vx - c.vx) * nx + (a.vz - c.vz) * nz;
      if (approach < 0) {
        const impulse = -approach * 0.5;
        const response = certifySportsPairCollision({ x: a.vx, y: 0, z: a.vz }, { x: c.vx, y: 0, z: c.vz }, { x: a.vx + nx * impulse, y: 0, z: a.vz + nz * impulse }, { x: c.vx - nx * impulse, y: 0, z: c.vz - nz * impulse });
        a.vx = response.a.x; a.vz = response.a.z; c.vx = response.b.x; c.vz = response.b.z;
      }
    }
  }
  s.players.forEach((p, i) => { if (p.off) return; const accepted = certifySportsMove(previousPositions[i], { x: p.x, y: 0, z: p.z }, 9.5 * dt); p.x = accepted.x; p.z = accepted.z; const v = Math.hypot(p.vx, p.vz); if (v > 9.3) { p.vx *= 9.3 / v; p.vz *= 9.3 / v; } });
  for (const athlete of s.players) { if (s.phase !== 'play') break; tackleContact(s, athlete); }
  if (s.phase === 'play' && b.owner >= 0 && !s.setPiece) { const owner = s.players[b.owner]; for (const q of outfield(s, 1 - owner.team)) { if (s.phase !== 'play' || b.owner !== owner.id) break; if (isHuman(s, q) && q.jockey) shoulder(s, q, owner); } }
  if (s.phase !== 'play') return;
  b.lock = Math.max(0, b.lock - dt);
  if (b.owner >= 0) {
    const owner = s.players[b.owner]; s.possessionAge += dt; b.touch += dt;
    if (s.setPiece) { b.vx = b.vz = 0; b.y = .32; return; }
    const speed = Math.hypot(owner.vx, owner.vz), stride = rate(s, owner, 'dri', .95, .66) + Math.sin(b.touch * (10 + speed)) * 0.12;
    const lead = owner.shield ? 0.43 : stride + speed * 0.065 * rate(s, owner, 'dri', 1.25, .8);
    const progress = 1 - owner.skillTime / owner.skillDuration;
    const roll = owner.skillTime > 0 ? Math.sin(progress * Math.PI) * (owner.skillType === 'double' ? 1.7 : owner.skillType === 'dragback' ? 1.35 : owner.skillType === 'fake' ? 0 : 1.35) : 0;
    const targetX = owner.x + owner.fx * lead + owner.skillX * roll, targetZ = owner.z + owner.fz * lead + owner.skillZ * roll;
    // Repeated feet-to-ball corrections leave visible travel between touches.
    const response = 1 - Math.exp(-dt * (owner.shield ? 25 : 16));
    b.vx = (targetX - b.x) * response / dt; b.vz = (targetZ - b.z) * response / dt;
    b.x += b.vx * dt; b.z += b.vz * dt; b.y = 0.32 + Math.abs(Math.sin(b.touch * 13)) * speed * 0.009;
  } else {
    b.flight += dt;
    const previous = { x: b.x, y: b.y, z: b.z };
    const turn = b.spin * dt, cos = Math.cos(turn), sin = Math.sin(turn), vx = b.vx;
    b.vx = vx * cos - b.vz * sin; b.vz = vx * sin + b.vz * cos; b.spin *= Math.exp(-dt * 0.6);
    Object.assign(b, stepSportsBall(b, dt, { gravity: 9.81, floor: 0.32, restitution: 0.35, friction: Math.exp(-(b.y < 0.4 ? 0.7 : 0.12) * dt) }));
    resolveFlight(s, previous);
    if (s.phase !== 'play') return;
  }
  // Resolve the line crossing before pickup so keepers cannot catch a scored ball.
  if (Math.abs(b.x) > HALF_X) {
    if (Math.abs(b.z) < GOAL && b.y < 3) {
      const team = b.x > 0 ? 0 : 1, kicker = b.kicker >= 0 ? s.players[b.kicker] : null, own = kicker && kicker.team !== team;
      s.score[team]++; s.phase = 'goal'; s.phaseTime = 2.6; s.restart = { team: 1 - team }; s.setPiece = null;
      for (const c of [s, s.away]) { c.charge = 0; c.charging = null; c.pending = null; }
      let text = `${s.teams[team].short} GOAL!`;
      if (kicker && !own) {
        kicker.stats.goals++; if (b.shot) { s.stats.onTarget[team]++; kicker.stats.onTarget++; }
        const assist = b.assist >= 0 && s.players[b.assist].team === team && b.assist !== kicker.id ? s.players[b.assist] : null;
        if (assist) assist.stats.assists++;
        text = `GOAL! ${name(s, kicker)}${assist ? ` · ASSIST ${name(s, assist)}` : ''}${callout(s, kicker, kicker.headTime > 0 ? ['aerial'] : ['finisher', 'cannon'])}`;
      } else if (kicker) text = `OWN GOAL · ${name(s, kicker)}`;
      say(s, text, 4); event(s, 'goal', team, text); signal(s, 'goal', 1); return;
    }
    const defending = b.x > 0 ? 1 : 0;
    if (b.lastTouch === defending) restart(s, 'Corner', 1 - defending, Math.sign(b.x) * 27.4, Math.sign(b.z || 1) * 16.4);
    else restart(s, 'Goal kick', defending, Math.sign(b.x) * 24, 0);
    return;
  }
  if (Math.abs(b.z) > HALF_Z) { restart(s, 'Throw-in', 1 - b.lastTouch, clamp(b.x, -26, 26), Math.sign(b.z) * 16.2); return; }
}
// ------------------------------------------------------------ presentation
const KEEPER_COLORS = [0x9bff5a, 0xff6ad5];
function buildScene({ THREE, scene, camera }) {
  scene.background = new THREE.Color(0x071a2b); scene.fog = new THREE.Fog(0x071a2b, 88, 165);
  camera.fov = 46; camera.near = 0.1; camera.far = 220; camera.position.set(0, 46, 43); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const materials = new Map();
  const mat = (color, extra = {}) => { const key = `${color}:${JSON.stringify(extra)}`; if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra })); return materials.get(key); };
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1), sphereGeometry = new THREE.SphereGeometry(1, 12, 10), torsoGeometry = new THREE.CapsuleGeometry(.34, .38, 5, 10), limbGeometry = new THREE.CapsuleGeometry(.1, .32, 4, 8);
  function mesh(geometry, material, x, y, z, sx, sy, sz, parent = scene) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.scale.set(sx, sy, sz); parent.add(object); return object;
  }
  const box = (color, x, y, z, w, h, d, parent = scene) => mesh(boxGeometry, mat(color), x, y, z, w, h, d, parent);
  const sphere = (color, x, y, z, r, parent = scene) => mesh(sphereGeometry, mat(color), x, y, z, r, r, r, parent);
  function line(points, color = 0xe6f3da, opacity = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })); scene.add(object); return object;
  }
  function label(text, color, x, y, z, width, height, ground = false) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
    const c = canvas.getContext('2d'); c.fillStyle = color; c.font = '900 74px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y, z); if (ground) m.rotation.x = -Math.PI / 2; scene.add(m); return m;
  }
  scene.add(new THREE.HemisphereLight(0xc7e6ff, 0x194e35, 2.1));
  const sun = new THREE.DirectionalLight(0xffecd5, 2.6); sun.position.set(-16, 32, 18); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x87caff, 1.8); fill.position.set(25, 25, -20); scene.add(fill);
  box(0x102935, 0, -0.7, 0, 90, 1, 64);
  box(0x184f3d, 0, -0.16, 0, 64, 0.3, 41);
  for (let i = 0; i < 14; i++) box(i % 2 ? 0x247447 : 0x2c8050, -26 + i * 4, 0, 0, 4, 0.08, 34);
  const y = 0.08;
  line([[-28, y, -17], [28, y, -17], [28, y, 17], [-28, y, 17], [-28, y, -17]]);
  line([[0, y, -17], [0, y, 17]]);
  line(Array.from({ length: 65 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2) * 5.4, y, Math.sin(i / 64 * Math.PI * 2) * 5.4]));
  sphere(0xe6f3da, 0, 0.08, 0, 0.13);
  for (const side of [-1, 1]) {
    line([[side * 28, y, -9], [side * 19, y, -9], [side * 19, y, 9], [side * 28, y, 9]]);
    line([[side * 28, y, -5.8], [side * 24.4, y, -5.8], [side * 24.4, y, 5.8], [side * 28, y, 5.8]]);
    sphere(0xe6f3da, side * 21.6, 0.08, 0, 0.13);
    for (const z of [-GOAL, GOAL]) { box(0xf4fff1, side * 28.1, 1.5, z, 0.16, 3, 0.16); box(0xb4d6d8, side * 30.5, 1.5, z, 0.12, 3, 0.12); }
    box(0xf4fff1, side * 28.1, 3, 0, 0.16, 0.16, GOAL * 2 + 0.16);
    for (let n = 0; n <= 16; n++) line([[side * 28.1, 3, -GOAL + n * GOAL / 8], [side * 30.5, 2.8, -GOAL + n * GOAL / 8], [side * 30.5, 0.1, -GOAL + n * GOAL / 8]], 0xd7efea, 0.32);
    for (let n = 0; n < 7; n++) line([[side * 28.1, n * 0.45, -GOAL], [side * 30.5, n * 0.45, -GOAL], [side * 30.5, n * 0.45, GOAL], [side * 28.1, n * 0.45, GOAL]], 0xd7efea, 0.32);
    for (const z of [-17, 17]) { box(0xdce9bd, side * 28, 0.9, z, 0.07, 1.8, 0.07); box(0xffb553, side * 28 + 0.3, 1.6, z, 0.6, 0.4, 0.04); }
  }
  // Low stands keep the broadcast camera's sightline clear.
  for (const side of [-1, 1]) {
    box(0x113b48, 0, 0.55, side * 19, 66, 1.1, 0.55);
    box(side === -1 ? 0x1ad5cb : 0xffa544, 0, 1.12, side * 19, 66, 0.09, 0.7);
    for (let row = 0; row < 4; row++) box(0x183344, 0, row * 0.6 + 0.4, side * (21 + row * 1.5), 66, 0.8, 1.3);
    label(side === -1 ? 'ALDER FIVE  /  NIGHT LEAGUE' : 'OWN THE PITCH', side === -1 ? '#75fff0' : '#ffcc84', 0, 1.3, side * 19.35, 27, 2.8, true);
  }
  const crowdGeometry = new THREE.BoxGeometry(0.45, 0.65, 0.42);
  const crowd = new THREE.InstancedMesh(crowdGeometry, mat(0xffffff), 240), matrix = new THREE.Object3D();
  for (let i = 0; i < 240; i++) {
    const side = i < 120 ? -1 : 1, row = Math.floor((i % 120) / 40), index = i % 40;
    matrix.position.set(-30 + index * 1.53, 1.25 + row * 0.6, side * (21 + row * 1.5)); matrix.rotation.y = Math.sin(i * 13) * 0.25; matrix.updateMatrix(); crowd.setMatrixAt(i, matrix.matrix);
    crowd.setColorAt(i, new THREE.Color([0x2edbcc, 0xf8bb76, 0x385269, 0xbad4db, 0xfc6e53][i % 5]));
  }
  scene.add(crowd);
  for (const x of [-33, 33]) for (const z of [-23, 23]) {
    box(0x455c70, x, 9, z, 0.4, 18, 0.4); box(0xd7eeff, x, 18, z, 4.2, 0.7, 0.7);
    mesh(boxGeometry, mat(0xe8faff, { emissive: 0xa9dfff, emissiveIntensity: 2 }), x, 17.8, z + 0.4, 3.8, 0.45, 0.1);
  }
  // Jerseys, shorts and numbers are painted from the match's team profiles in render().
  const athletes = Array.from({ length: 10 }, (_, i) => {
    const group = new THREE.Group(); scene.add(group);
    const skin = [0xc98d65, 0x8d543c, 0xeab491, 0x654330, 0xb87f58][i % 5];
    const jersey = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .72 }), shorts = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: .72 });
    mesh(torsoGeometry, jersey, 0, 1.33, 0, 1, 1, .73, group);
    box(0xeaf9f2, 0, 1.58, .255, .6, .07, .03, group); mesh(boxGeometry, shorts, 0, 0.84, 0, 0.66, 0.25, 0.42, group);
    sphere(skin, 0, 1.99, 0, 0.32, group); box(0x26313e, 0, 2.2, -0.04, 0.5, 0.18, 0.46, group);
    const numbers = [];
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const number = new THREE.Mesh(new THREE.PlaneGeometry(.38, .4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })); number.position.set(0, 1.32, .267); group.add(number);
      const back = number.clone(); back.position.z = -.267; back.rotation.y = Math.PI; group.add(back);
      numbers.push({ canvas, texture, value: null });
    }
    const limbs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * 0.21, 0.77, 0); group.add(leg);
      mesh(limbGeometry, mat(skin), 0, -.2, 0, 1, .85, 1, leg); mesh(boxGeometry, jersey, 0, -0.43, 0, 0.23, 0.2, 0.24, leg); box(0xe6f7ea, 0, -0.61, 0.1, 0.26, 0.17, 0.43, leg);
      const arm = new THREE.Group(); arm.position.set(side * 0.48, 1.62, 0); group.add(arm); mesh(limbGeometry, mat(skin), 0, -.25, 0, 1, 1, 1, arm);
      limbs.push(leg, arm);
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.65, 20), new THREE.MeshBasicMaterial({ color: 0x061c20, transparent: true, opacity: 0.3, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.1; scene.add(shadow);
    const marker = new THREE.Mesh(new THREE.ConeGeometry(.22, .45, 3), new THREE.MeshBasicMaterial({ color: 0x8affec })); marker.rotation.z = Math.PI; scene.add(marker);
    return { group, limbs, shadow, marker, jersey, shorts, numbers };
  });
  const ball = sphere(0xf5fff6, 0, 0.32, 0, 0.32);
  for (const a of [[0, 0.31, 0], [0, 0, 0.31], [0.31, 0, 0], [-0.31, 0, 0], [0, 0, -0.31]]) sphere(0x193547, ...a, 0.13, ball);
  // Child patches must not inherit the ball's unit-radius scale.
  ball.scale.set(1, 1, 1); ball.geometry = new THREE.SphereGeometry(0.32, 16, 12);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: 0x061c20, transparent: true, opacity: 0.4, depthWrite: false })); ballShadow.rotation.x = -Math.PI / 2; scene.add(ballShadow);
  const rings = [0, 1].map(() => { const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0x8cfff1, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; scene.add(ring); return ring; });
  const wall = [0, 1].map(() => { const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color: 0xffd36b, side: THREE.DoubleSide, transparent: true, opacity: .8 })); ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring); return ring; });
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.2, 0), 3, 0xd9ff7d, 0.65, 0.5); scene.add(arrow);
  const trail = Array.from({ length: 7 }, () => { const o = sphere(0xbfffea, 0, 0, 0, 0.15); o.material = new THREE.MeshBasicMaterial({ color: 0xbfffea, transparent: true, opacity: 0.22, depthWrite: false }); return o; });
  const aimDots = Array.from({ length: 6 }, () => { const dot = new THREE.Mesh(new THREE.RingGeometry(.1, .17, 12), new THREE.MeshBasicMaterial({ color: 0xe7ff9b, transparent: true, opacity: .65, side: THREE.DoubleSide })); dot.rotation.x = -Math.PI / 2; scene.add(dot); return dot; });
  return { athletes, ball, ballShadow, ring: rings[0], rings, wall, arrow, trail, aimDots, history: [], cameraX: 0, cameraZ: 0, cameraZoom: 1, teamKey: null };
}
function paintTeams(s, v) {
  const key = s.teams.map(t => t.id).join(':');
  if (v.teamKey === key) return;
  v.teamKey = key;
  for (const p of s.players) {
    const visual = v.athletes[p.id], team = s.teams[p.team], profile = pro(s, p);
    visual.jersey.color.set(p.keeper ? KEEPER_COLORS[p.team] : team.primary); visual.shorts.color.set(team.secondary);
    for (const number of visual.numbers) {
      if (number.value === profile.number) continue;
      number.value = profile.number; const ctx = number.canvas.getContext('2d'); ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = '#f5ffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 84px system-ui'; ctx.fillText(String(profile.number), 64, 67); number.texture.needsUpdate = true;
    }
  }
}
function render({ state: s, view: v, camera, dt = 1 / 60 }) {
  paintTeams(s, v);
  const b = s.ball, selected = [0, 1].map(team => s.mode === 'watch' ? null : ctrl(s, team).active);
  for (const p of s.players) {
    const visual = v.athletes[p.id], speed = Math.hypot(p.vx, p.vz), run = Math.sin(s.frame * 0.24 + p.id) * Math.min(0.7, speed * 0.08);
    visual.group.visible = visual.shadow.visible = !p.off;
    visual.group.position.set(p.x, Math.abs(run) * 0.07 + (p.headTime > 0 ? Math.sin(p.headTime / .3 * Math.PI) * .55 : 0), p.z); visual.group.rotation.y = Math.atan2(p.fx, p.fz);
    visual.group.rotation.x = p.tackle > 0 ? -0.6 : p.shield || p.jockey ? 0.16 : clamp(speed * .015, 0, .13);
    if (p.jockey) visual.group.position.y -= .12;
    visual.group.rotation.z = p.skillTime > 0 ? Math.sin(p.skillTime * 15) * 0.2 : 0;
    visual.limbs.forEach((limb, i) => { limb.rotation.x = run * (i < 2 ? 1 : -1) * (i % 2 === 0 ? 1 : -0.7); });
    if (p.kickTime > 0) visual.limbs[2].rotation.x = -Math.sin((1 - p.kickTime / .28) * Math.PI) * 1.4;
    if (p.skillTime > 0) { visual.limbs[0].rotation.z = Math.sin(s.frame * .2) * .35; visual.limbs[2].rotation.z = -visual.limbs[0].rotation.z; } else { visual.limbs[0].rotation.z = visual.limbs[2].rotation.z = 0; }
    if (p.shield || p.jockey) { visual.limbs[1].rotation.z = .55; visual.limbs[3].rotation.z = -.55; } else { visual.limbs[1].rotation.z = visual.limbs[3].rotation.z = 0; }
    if (p.saveTime > 0) { visual.group.rotation.z = Math.sin(p.saveTime / .48 * Math.PI) * .7; visual.limbs[1].rotation.x = visual.limbs[3].rotation.x = -1.2; }
    if (p.dive > 0) { visual.group.rotation.z = -Math.sign(p.diveZ - p.z || 1) * clamp(1.4 - p.dive, .6, 1.3); visual.group.position.y -= .5; visual.limbs[1].rotation.x = visual.limbs[3].rotation.x = -2.4; }
    if (p.headTime > 0) { visual.limbs[1].rotation.x = visual.limbs[3].rotation.x = 1.6; }
    const isSelected = selected.includes(p.id);
    visual.marker.position.set(p.x, 2.9 + Math.sin(s.frame * .08) * .07, p.z); visual.marker.visible = !p.off && (isSelected || p.runTime > 0); visual.marker.material.color.setHex(isSelected ? (p.team === 0 ? 0x8affec : 0xffa5f5) : 0xffde7a);
    if (s.phase === 'goal') { visual.limbs[1].rotation.x = 2.7; visual.limbs[3].rotation.x = 2.7; }
    visual.shadow.position.set(p.x, 0.1, p.z);
  }
  v.ball.position.set(b.x, b.y, b.z); v.ball.rotation.z -= b.vx * dt * 0.8; v.ball.rotation.x += b.vz * dt * 0.8;
  v.ballShadow.position.set(b.x, 0.11, b.z); v.ballShadow.scale.setScalar(1 + Math.max(0, b.y - 0.32) * 0.15);
  v.rings.forEach((ring, team) => {
    const id = selected[team]; ring.visible = id !== null && s.phase !== 'setup'; if (id === null) return;
    const p = s.players[id], c = ctrl(s, team); ring.position.set(p.x, 0.12, p.z); ring.material.color.setHex(c.charging ? 0xfaff78 : p.shield ? 0x82b4ff : p.skillTime > 0 ? 0xffa5f5 : team === 0 ? 0x8cfff1 : 0xffb0ec);
  });
  v.wall.forEach((ring, i) => { const id = s.phase === 'restart' ? s.restart.wall?.[i] : undefined; ring.visible = id !== undefined; if (id !== undefined) ring.position.set(s.players[id].x, 0.13, s.players[id].z); });
  const focusTeam = selected[0] !== null ? 0 : selected[1] !== null ? 1 : null, p = focusTeam === null ? null : s.players[selected[focusTeam]], c = focusTeam === null ? null : ctrl(s, focusTeam);
  v.arrow.visible = !!p && b.owner === p.id && s.phase === 'play';
  if (p) { v.arrow.position.set(p.x, 0.2, p.z); v.arrow.setDirection({ x: p.fx, y: 0, z: p.fz }); v.arrow.setLength(2.1 + c.charge * 3.3, 0.6, 0.45); }
  v.aimDots.forEach((dot, i) => { dot.visible = !!p && c.charging !== null && b.owner === p.id; if (!p) return; const distance = (i + 1) * (1.8 + c.charge * 1.5); dot.position.set(p.x + p.fx * distance, .13, p.z + p.fz * distance); dot.visible &&= Math.abs(dot.position.x) < 28 && Math.abs(dot.position.z) < 17; dot.material.color.setHex(c.delivery === 'loft' ? 0xffbd79 : 0xe7ff9b); });
  v.history.unshift({ x: b.x, y: b.y, z: b.z }); if (v.history.length > 21) v.history.pop();
  v.trail.forEach((o, i) => { const past = v.history[i * 3]; o.visible = !!past && b.owner < 0 && Math.hypot(b.vx, b.vz) > 8 && s.phase === 'play'; if (past) o.position.set(past.x, past.y, past.z); o.scale.setScalar(1 - i * 0.09); });
  const live = s.phase === 'play', follow = 1 - Math.exp(-dt * 5.5), focus = p || b;
  const targetX = live ? clamp(b.x * .62 + focus.x * .38, -23, 23) : 0, targetZ = live ? clamp(b.z * .55 + focus.z * .45, -11, 11) : 0;
  v.cameraX += (targetX - v.cameraX) * follow; v.cameraZ += (targetZ - v.cameraZ) * follow;
  v.cameraZoom += ((live ? .54 : .95) - v.cameraZoom) * (1 - Math.exp(-dt * 4));
  const aspect = camera.aspect || 1, distance = aspect < .85 ? .85 / aspect : 1;
  camera.position.set(v.cameraX, 46 * v.cameraZoom * distance, v.cameraZ + 43 * v.cameraZoom * distance); camera.lookAt(v.cameraX, 0, v.cameraZ);
}
const starScore = p => p.stats.goals * 3 + p.stats.assists * 1.5 + p.stats.saves * .8 + p.stats.tackles * .5 + p.stats.interceptions * .4 + p.stats.completed * .08 + p.stats.onTarget * .3 - p.stats.cards;
function summary(s) {
  const st = s.stats, pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '–', total = st.possession[0] + st.possession[1];
  const rows = [['GOALS', ...s.score], ['SHOTS', ...st.shots], ['ON TARGET', ...st.onTarget], ['POSSESSION', ...st.possession.map(n => pct(n, total))], ['PASS ACCURACY', pct(st.completed[0], st.passes[0]), pct(st.completed[1], st.passes[1])],
    ['TACKLES', ...st.tackles], ['SAVES', ...st.saves], ['FOULS', ...st.fouls], ['CARDS', `${st.yellows[0]}Y ${st.reds[0]}R`, `${st.yellows[1]}Y ${st.reds[1]}R`], ['OFFSIDES', ...st.offsides], ['CORNERS', ...st.corners]];
  const star = s.players.slice().sort((a, b) => starScore(b) - starScore(a) || a.id - b.id)[0], t = star.stats;
  const parts = [t.goals && `${t.goals} GOAL${t.goals > 1 ? 'S' : ''}`, t.assists && `${t.assists} ASSIST${t.assists > 1 ? 'S' : ''}`, t.saves && `${t.saves} SAVE${t.saves > 1 ? 'S' : ''}`, t.tackles && `${t.tackles} TACKLE${t.tackles > 1 ? 'S' : ''}`, t.completed && `${t.completed} PASSES`].filter(Boolean).slice(0, 3);
  return { rows, star: { name: pro(s, star).short, team: star.team, line: parts.join(' · ') || 'STEADY SHIFT' } };
}
const TICKER_KINDS = ['goal', 'card', 'penalty', 'offside', 'save'];
function hud(s, team = 0) {
  const c = ctrl(s, team), p = s.players[c.active], owner = s.ball.owner >= 0 ? s.players[s.ball.owner] : null, mine = s.teams[team].short, theirs = s.teams[1 - team].short;
  const setup = s.phase === 'setup', finished = s.phase === 'finished', watch = s.mode === 'watch', side = team === 0 ? '→' : '←';
  const possession = owner ? `${s.teams[owner.team].short} IN POSSESSION` : 'LOOSE BALL';
  const inPossession = owner?.team === team;
  return { phase: s.phase, teamNames: s.teams.map(t => t.short), teams: s.teams.map(t => ({ name: t.name, short: t.short, primary: t.primary, secondary: t.secondary, ovr: t.ovr })), score: [...s.score], clock: s.clock, label: 'ALDER FIVE · 5v5',
    message: setup ? 'NIGHT LEAGUE · TEAM SELECT' : finished ? s.message : s.messageTime > 0 ? s.message : possession,
    detail: setup ? 'D-pad / arrows choose · A / Enter kicks off' : s.phase === 'restart' ? `${s.restart.type} · ${s.restart.team === team && !watch ? 'A / Enter to restart' : `${s.teams[s.restart.team].short} restarting`}` : finished ? `Shots ${s.stats.shots[0]}–${s.stats.shots[1]} · Saves ${s.stats.saves[0]}–${s.stats.saves[1]} · A rematch · B team select`
      : watch ? `${s.teams[0].short} ${s.score[0]}–${s.score[1]} ${s.teams[1].short} · CPU vs CPU` : c.charging ? `${c.charging === 'shoot' ? 'SHOT · RB FINESSE' : c.charging === 'through' ? 'THROUGH BALL' : c.charging === 'lob' ? 'LOFTED PASS' : 'GROUND PASS'} · RELEASE TO STRIKE · ${Math.round(c.charge * 100)}%`
      : `${pro(s, p).short.toUpperCase()} #${pro(s, p).number} · ${p.shield ? 'SHIELDING' : p.skillCooldown > 0 ? 'SKILL RECOVERING' : inPossession ? 'RS SKILL · LT SHIELD' : 'LT JOCKEY · B TACKLE'} · STAMINA ${Math.round(p.stamina * 100)}% · ${mine} ATTACKS ${side}`,
    stamina: p.stamina, skillReady: p.skillCooldown <= 0 && p.stamina >= .09, status: p.jockey ? 'JOCKEY' : p.shield ? 'SHIELD' : p.burst > 0 ? 'BURST' : p.skillCooldown > 0 ? 'RECOVERING' : 'READY',
    skillHint: s.ball.owner === p.id ? (c.charging === 'shoot' ? 'LS place shot · RB/F finesse · A/J shot fake' : s.setPiece?.taker === p.id ? `${s.setPiece.kind.toUpperCase()} · LS aim · B shoot · A pass · X cross · RB curl` : 'LS direction · A/J pass · B/K shoot · Y/U through · X/I lob · RS/E skill · LB/Q run') : inPossession ? 'LB/Q request run · RS switch · B/K first-time shot or header' : 'LT/C jockey · B/L tackle · X/I tackle · LB/Q or RS switch',
    power: c.charge, charging: c.charging, finished, selected: [0, 1].map(t => watch || s.phase === 'setup' ? null : ctrl(s, t).active),
    athlete: watch || setup ? null : athleteCard('soccer', pro(s, p)), setup: setup ? setupHud('soccer', s.setup) : null, summary: finished ? summary(s) : null,
    ticker: s.events.filter(e => TICKER_KINDS.includes(e.kind)).slice(0, 4).map(e => ({ text: e.text, team: e.team })), period: null, timeouts: null, mode: s.mode, opponent: theirs };
}
function cancelInput(s) { for (const c of [s, s.away]) { c.charge = 0; c.charging = null; c.pending = null; } s.players.forEach(p => { p.shield = false; p.jockey = false; }); }
export const soccerDefinition = { id: 'soccer', title: 'Alder Five', createState, validateState, step, buildScene, render, hud, cancelInput };
