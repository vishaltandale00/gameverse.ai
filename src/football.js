// Alder Gridiron: original seven-a-side arcade football with rated two-way
// athletes, special teams, a real game clock and a built-in CPU. The model is
// independent of browser and renderer; every random draw goes through random(s).
import { certifySportsMove, stepSportsBall, certifySportsPairCollision, certifySportsSeparation } from './sports-physics.js';
import { random, scale, has, teamProfile, validateProfile, createSetup, validateSetup, stepSetup, setupHud, validSeed, athleteCard } from './sports-league.js';
const FIELD = 50, QUARTER = 150, PLAY_CLOCK = 20, DEAD_TIME = 2.2, RING = 40, POST = 3.08, BAR = 3.33;
const RECEIVERS = ['receiverA', 'receiverB', 'receiverX'];
const RECEIVER_LABELS = ['A', 'B', 'X'];
const passType = charge => charge < .16 ? 'LOB' : charge < .42 ? 'TOUCH' : 'BULLET';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const direction = team => team === 0 ? 1 : -1;
const indexOf = (team, slot) => team * 7 + slot;
const norm = (x, y) => { const n = Math.hypot(x, y); return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 1 }; };
const blankInput = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, held: {}, pressed: {}, released: {} };
// Approximately normal placement noise (σ≈1) from the seeded match RNG.
const gauss = s => (random(s) + random(s) + random(s) - 1.5) * 2;
// ---------------------------------------------------------------- playbook
// Routes per eligible slot (1 RB, 2/3 WR): waypoints [x, yards past the line] in
// the attack frame (offense attacks +y). `reads` is the QB progression. The same
// data drives the route preview, the receivers and the CPU quarterback.
const OFFENSE = [
  { name: 'INSIDE RUN', run: true, lane: 2.25, routes: { 1: [[-2, -1], [1, 5], [3, 30]], 2: [[-15, 7]], 3: [[15, 7]] } },
  { name: 'SWEEP', run: true, lane: -12, routes: { 1: [[-14, 1], [-19, 5], [-17, 30]], 2: [[-17, 1.5]], 3: [[17, 6]] } },
  { name: 'SLANTS', quick: true, reads: [3, 2, 1], routes: { 1: [[-7, 1], [-12, 4], [-18, 5]], 2: [[-17, 3], [-7, 9], [-1, 17]], 3: [[17, 3], [7, 9], [1, 17]] } },
  { name: 'CURLS', reads: [2, 3, 1], routes: { 1: [[-7, 1], [-14, 3], [-21, 4]], 2: [[-17, 11], [-14, 8]], 3: [[17, 11], [14, 8]] } },
  { name: 'VERTICALS', deep: true, reads: [2, 3, 1], routes: { 1: [[-7, 2], [-4, 8], [-2, 18]], 2: [[-17, 10], [-15, 40]], 3: [[17, 10], [15, 40]] } },
  { name: 'PA CROSSERS', fake: true, reads: [3, 2, 1], routes: { 1: [[-3, -3], [-12, 2], [-20, 4]], 2: [[-17, 8], [-4, 14], [12, 19]], 3: [[17, 6], [3, 12], [-12, 16]] } },
  { name: 'SCREEN', screen: true, reads: [1], routes: { 1: [[-9, -2], [-14, -3], [-17, -2]], 2: [[-17, 3], [-13, 4]], 3: [[17, 3], [13, 4]] } },
];
const PUNT = { name: 'PUNT', kick: 'punt' }, FG = { name: 'FIELD GOAL', kick: 'fg' }, PAT = { name: 'KICK PAT', kick: 'pat' };
const KICKOFF = { name: 'KICKOFF', kick: 'kickoff' }, RETURN = { name: 'RETURN' };
// Zones [x, yards past the line] in the attack frame; `man` maps defender slot to
// the receiver slot it shadows; `blitz` slots rush the passer.
const DEFENSE = [
  { name: 'COVER 2', zones: { 0: [0, 17], 1: [0, 7], 2: [-14, 6], 3: [14, 6] } },
  { name: 'COVER 3', zones: { 0: [0, 18], 1: [0, 5], 2: [-13, 14], 3: [13, 14] } },
  { name: 'MAN', man: { 1: 1, 2: 2, 3: 3 }, zones: { 0: [0, 15] } },
  { name: 'BLITZ', man: { 1: 1, 2: 2, 3: 3 }, blitz: [0] },
  { name: 'PREVENT', prevent: true, zones: { 0: [0, 26], 1: [0, 12], 2: [-14, 20], 3: [14, 20] } },
];
const SCRIMMAGE = [...OFFENSE, PUNT, FG], CONVERSION = [PAT, ...OFFENSE];
function playbook(s, team) {
  if (s.special === 'kickoff' || s.special === 'free') return team === s.offense ? [KICKOFF] : [RETURN];
  if (team !== s.offense) return DEFENSE;
  return s.conversion ? CONVERSION : SCRIMMAGE;
}
const currentPlay = (s, team) => playbook(s, team)[s.calls[team]] || playbook(s, team)[0];
// ------------------------------------------------------------------ ratings
// Profiles live in s.teams so saves and specialty A/B edits are the source of truth.
const profile = (s, p) => s.teams[p.team].players[p.slot];
const rating = (s, p, key) => profile(s, p).ratings[key];
const spec = (s, p, id) => has(profile(s, p), id);
const who = (s, p) => profile(s, p).short.toUpperCase();
const short = (s, team) => s.teams[team].short;
const topSpeed = (s, p) => scale(rating(s, p, 'spd'), 7.4, 9.5);
const kickerOf = (s, team) => s.players[indexOf(team, s.teams[team].kicker ?? 5)];
const fgRange = (s, kicker) => scale(rating(s, kicker, 'kpw'), 36, 54) + (spec(s, kicker, 'big_leg') ? 10 : 0);
// Difficulty shapes the opponent CPU only; a human's CPU teammates play at Pro.
const level = (s, team) => s.human[team] ? 1 : s.difficulty;
const REACT = [.42, .25, .14], NOISE = [1.3, 1, .85];
const reaction = (s, p) => REACT[level(s, p.team)] * scale(rating(s, p, 'awr'), 1.4, .7) * (spec(s, p, 'lockdown') ? .6 : 1);
const TEAM_STATS = ['plays', 'passAtt', 'passComp', 'passYds', 'rushAtt', 'rushYds', 'ints', 'sacks', 'fumbles', 'fumblesLost', 'drops', 'breakups', 'fgAtt', 'fgMade', 'punts', 'tds', 'firstDowns'];
const ATHLETE_STATS = ['att', 'comp', 'passYds', 'passTd', 'picked', 'rushAtt', 'rushYds', 'rushTd', 'rec', 'recYds', 'recTd', 'drops', 'fumbles', 'tackles', 'sacks', 'ints', 'ffum', 'breakups', 'fgAtt', 'fgMade', 'punts', 'retYds'];
const athleteStats = () => Object.fromEntries(ATHLETE_STATS.map(k => [k, 0]));
const stat = (s, team, key, n = 1) => { s.stats[key][team] += n; };
const controller = controlled => ({ controlled, charge: 0, charging: false, passReady: false, receiverButton: null, receiverReady: [false, false, false], throwHold: 0, tackleWindow: 0, tackleCooldown: 0 });
// Team 0's controller keeps its historical top-level fields; team 1 mirrors them in s.away.
const ctrl = (s, team) => team === 0 ? s : s.away;
// -------------------------------------------------------------------- state
function createState({ teams = [0, 1], difficulty = 1, mode = 'play', seed = 20261017, setup = true } = {}) {
  const s = { schema: 6, seed, setup: createSetup({ teams, difficulty, mode: mode === 'watch' ? 1 : 0 }), human: [false, false], feedback: null,
    players: Array.from({ length: 14 }, (_, id) => ({ id, team: Math.floor(id / 7), slot: id % 7, x: 0, y: 0, vx: 0, vy: 0, wishX: 0, wishY: 0, prevX: 0, prevY: 0, stun: 0, stamina: 1, balance: 1, jukeCooldown: 0, jukeTime: 0, jukeX: 0, protect: false, hitCooldown: 0, spinTime: 0, stiffTime: 0, stiffCooldown: 0, diveTime: 0, diveCooldown: 0, diveX: 0, diveY: 0, diveHit: false, recover: 0, wrapTime: 0, strafe: false, facingX: 0, facingY: 1, moveWon: false, route: 0, engage: 0, burst: 0, stats: athleteStats() })) };
  startMatch(s);
  if (setup) s.phase = 'setup';
  return s;
}
function startMatch(s) {
  const { teams, difficulty, mode } = s.setup;
  Object.assign(s, { started: false, frame: 0, teams: teams.map(i => teamProfile('football', i)), difficulty, mode: mode === 1 ? 'watch' : 'play', human: [mode !== 1, false],
    quarter: 1, time: QUARTER, running: false, half: false, opening: 1, playClock: PLAY_CLOCK, snapAt: 0, timeouts: [2, 2], warned: [false, false], score: [0, 0],
    phase: 'select', phaseTime: 0, offense: 1, down: 1, line: 0, target: 0, conversion: false, special: null, calls: [0, 0], callNames: ['', ''], playNumber: 0,
    carrier: 7, ball: { x: 0, y: 0, z: 1, flight: null, carry: null }, aim: { x: 0, y: 1 },
    controlled: 0, charge: 0, charging: false, passReady: false, receiverButton: null, receiverReady: [false, false, false], throwHold: 0, tackleWindow: 0, tackleCooldown: 0, away: controller(7),
    thrown: false, intercepted: false, newPossession: false, kicked: false, handoffPending: false, handoffTime: 0, catchProtection: 0, snapTime: 0, deadTime: 0, next: null,
    playKind: null, passer: -1, receiver: -1, tackler: -1, read: 0, readTime: 0, runAt: -1, returnFrom: 0, pressureAt: -1,
    message: 'WELCOME TO ALDER GRIDIRON', lastResult: 'Kickoff. Own the field.', actionMessage: null,
    stats: Object.fromEntries(TEAM_STATS.map(k => [k, [0, 0]])), events: [] });
  for (const p of s.players) { p.stats = athleteStats(); p.stamina = 1; }
  for (let i = 0; i < 4; i++) random(s);
  kickoff(s, s.opening, 'kickoff');
}
function feedback(s, kind, strength = .5, text = null) {
  s.feedback = { id: (s.feedback?.id || 0) + 1, kind, strength: clamp(strength, 0, 1) };
  if (text) s.actionMessage = { text, until: s.frame + 70 };
}
function event(s, kind, team, text) {
  s.events.push({ frame: s.frame, clock: s.time, kind, team, text });
  if (s.events.length > RING) s.events.splice(0, s.events.length - RING);
}
function validateState(s) {
  const finite = value => typeof value === 'number' && Number.isFinite(value), bool = v => typeof v === 'boolean', count = v => Number.isInteger(v) && v >= 0;
  const fail = what => { throw new Error(`Invalid football ${what}`); };
  if (!s || s.schema !== 6) throw new Error('Unsupported football save');
  if (!['setup', 'select', 'live', 'dead', 'finished'].includes(s.phase)) fail('phase');
  if (!Array.isArray(s.teams) || s.teams.length !== 2 || !s.teams.every(t => validateProfile('football', t)) || s.teams[0].index === s.teams[1].index || !s.teams.every(t => Number.isInteger(t.kicker) && t.kicker >= 0 && t.kicker <= 6 && t.tactics && ['passRate', 'aggression', 'blitz'].every(k => finite(t.tactics[k]))) || ![0, 1, 2].includes(s.difficulty) || !['play', 'watch'].includes(s.mode) || !validSeed(s.seed) || !validateSetup('football', s.setup) || !Array.isArray(s.human) || s.human.length !== 2 || !s.human.every(bool)) fail('league setup');
  if (![1, 2, 3, 4].includes(s.quarter) || !finite(s.time) || s.time < 0 || s.time > QUARTER || !bool(s.running) || !bool(s.half) || ![0, 1].includes(s.opening) || !finite(s.playClock) || !finite(s.snapAt) || !Array.isArray(s.timeouts) || s.timeouts.length !== 2 || !s.timeouts.every(n => [0, 1, 2].includes(n)) || !Array.isArray(s.warned) || s.warned.length !== 2 || !s.warned.every(bool)) fail('clock');
  for (const key of ['frame', 'phaseTime', 'line', 'target', 'catchProtection', 'snapTime', 'deadTime', 'handoffTime', 'readTime', 'runAt', 'returnFrom', 'pressureAt']) if (!finite(s[key])) fail(key);
  if (!Array.isArray(s.score) || s.score.length !== 2 || !s.score.every(count) || ![0, 1].includes(s.offense) || ![1, 2, 3, 4].includes(s.down) || ![null, 'kickoff', 'free', 'punt', 'fg', 'pat'].includes(s.special) || !Array.isArray(s.calls) || s.calls.length !== 2 || !s.calls.every(c => count(c) && c < SCRIMMAGE.length) || !Array.isArray(s.callNames) || s.callNames.length !== 2 || !s.callNames.every(n => typeof n === 'string') || !count(s.playNumber) || !count(s.frame) || !count(s.read)) fail('match');
  if (!['started', 'conversion', 'thrown', 'intercepted', 'newPossession', 'kicked', 'handoffPending'].every(k => bool(s[k])) || ![null, 'pass', 'rush', 'kick'].includes(s.playKind) || ![s.passer, s.receiver, s.tackler].every(v => Number.isInteger(v) && v >= -1 && v <= 13) || (s.playKind === 'pass' && (s.passer < 0 || (s.carrier >= 0 && !s.newPossession && s.receiver < 0)))) fail('play');
  for (const team of [0, 1]) {
    const c = ctrl(s, team);
    if (!c || !Number.isInteger(c.controlled) || Math.floor(c.controlled / 7) !== team || !finite(c.charge) || c.charge < 0 || c.charge > 1 || ![null, ...RECEIVERS].includes(c.receiverButton) || !Array.isArray(c.receiverReady) || c.receiverReady.length !== 3 || !c.receiverReady.every(bool) || !finite(c.throwHold) || c.throwHold < 0 || c.charging !== (c.receiverButton !== null) || !bool(c.passReady) || !finite(c.tackleWindow) || !finite(c.tackleCooldown)) fail('receiver controls');
  }
  if (s.feedback && (!Number.isInteger(s.feedback.id) || s.feedback.id < 1 || !finite(s.feedback.strength) || s.feedback.strength < 0 || s.feedback.strength > 1)) fail('feedback');
  if (!Array.isArray(s.players) || s.players.length !== 14) fail('teams');
  s.players.forEach((p, i) => { if (p.id !== i || p.team !== Math.floor(i / 7) || p.slot !== i % 7 || !['x', 'y', 'vx', 'vy', 'wishX', 'wishY', 'prevX', 'prevY', 'stun', 'stamina', 'balance', 'jukeCooldown', 'jukeTime', 'jukeX', 'hitCooldown', 'spinTime', 'stiffTime', 'stiffCooldown', 'diveTime', 'diveCooldown', 'diveX', 'diveY', 'recover', 'wrapTime', 'facingX', 'facingY', 'engage', 'burst'].every(k => finite(p[k])) || Math.abs(p.x) > 30 || Math.abs(p.y) > 65 || p.stamina < 0 || p.stamina > 1 || p.balance < 0 || p.balance > 1 || !bool(p.protect) || !bool(p.strafe) || !count(p.route) || !p.stats || !ATHLETE_STATS.every(k => finite(p.stats[k]))) fail('athlete'); });
  if (!Number.isInteger(s.carrier) || s.carrier < -1 || s.carrier > 13 || !s.ball || !['x', 'y', 'z'].every(k => finite(s.ball[k])) || !s.aim || !finite(s.aim.x) || !finite(s.aim.y)) fail('ball');
  if (s.ball.carry && !['x', 'y', 'z'].every(k => finite(s.ball.carry[k]))) fail('catch');
  const f = s.ball.flight;
  if (f && (!['x', 'y', 'tx', 'ty', 'vx', 'vy', 'vz', 'elapsed', 'duration'].every(k => finite(f[k])) || f.duration <= 0 || !Number.isInteger(f.passer) || f.passer < 0 || f.passer > 13 || ![undefined, 'kickoff', 'free', 'punt', 'fg', 'pat'].includes(f.kick) || (f.receiver !== undefined && !Number.isInteger(f.receiver)) || (f.rest !== undefined && !finite(f.rest)))) fail('pass');
  if (s.phase === 'dead' && (!s.next || !(s.next.final || s.next.kickoff !== undefined || ([0, 1].includes(s.next.team) && finite(s.next.spot))))) fail('next play');
  if (!s.stats || !TEAM_STATS.every(k => Array.isArray(s.stats[k]) && s.stats[k].length === 2 && s.stats[k].every(Number.isInteger))) fail('stats');
  if (!Array.isArray(s.events) || s.events.length > RING || !s.events.every(e => count(e.frame) && finite(e.clock) && typeof e.kind === 'string' && [0, 1].includes(e.team) && typeof e.text === 'string')) fail('events');
  return true;
}
// --------------------------------------------------------------- formations
const OFFENSIVE = [[0, -4], [-7, -2], [-17, 0], [17, 0], [-4.5, 0], [0, 0], [4.5, 0]];
const DEFENSIVE = [[0, 7], [-9, 5], [-17, 6], [17, 6], [-4.5, 2], [0, 2], [4.5, 2]];
const KICK_SPOTS = [[-18, 0], [-12, 0], [-6, 0], [6, 0], [12, 0], [18, 0]];
const RECEIVE = [[0, 60], [-5, 44], [-14, 40], [14, 40], [-7, 32], [0, 30], [7, 32]];
const isKickoff = kick => kick === 'kickoff' || kick === 'free';
// Attack-frame alignments relative to the line for the current calls.
function alignment(s) {
  const play = currentPlay(s, s.offense), defense = currentPlay(s, 1 - s.offense), kick = s.special || play.kick, k = s.teams[s.offense].kicker ?? 5;
  if (isKickoff(kick)) { let n = 0; return [Array.from({ length: 7 }, (_, slot) => slot === k ? [0, -1] : KICK_SPOTS[n++]), RECEIVE]; }
  const off = OFFENSIVE.map(a => [...a]), def = DEFENSIVE.map(a => [...a]);
  if (play.run) off[1] = [-3.8, -4];
  if (kick) { off[1] = off[k]; off[k] = [0, -7]; off[0] = [-1.5, -1.5]; }
  if (kick === 'punt') def[0] = [0, 42];
  else if (defense.prevent || defense.zones?.[2]?.[1] >= 14) { def[2][1] = 8; def[3][1] = 8; }
  else if (defense.man) { def[2][1] = 4.5; def[3][1] = 4.5; }
  if (defense.blitz) def[0] = [6, 4];
  return [off, def];
}
function formation(s) {
  const d = direction(s.offense), play = currentPlay(s, s.offense), kick = s.special || play.kick;
  if (s.conversion) s.line = (play.kick === 'pat' ? 35 : 47) * d;
  const [off, def] = alignment(s);
  for (const p of s.players) {
    const xy = (p.team === s.offense ? off : def)[p.slot];
    p.x = xy[0] * d; p.y = clamp(s.line + xy[1] * d, -58, 58);
    p.vx = 0; p.vy = 0; p.wishX = 0; p.wishY = 0; p.prevX = p.x; p.prevY = p.y; p.stun = 0;
    p.stamina = Math.min(1, p.stamina + .35); p.balance = 1; p.jukeCooldown = 0; p.jukeTime = 0; p.jukeX = 0; p.protect = false; p.hitCooldown = 0; p.spinTime = 0; p.stiffTime = 0; p.stiffCooldown = 0; p.diveTime = 0; p.diveCooldown = 0; p.diveX = 0; p.diveY = 0; p.diveHit = false; p.recover = 0; p.wrapTime = 0; p.strafe = false; p.facingX = 0; p.facingY = p.team === s.offense ? d : -d; p.moveWon = false; p.route = 0; p.engage = 0; p.burst = 0;
  }
  s.handoffPending = false; s.handoffTime = 0; s.actionMessage = null;
  const kicker = kickerOf(s, s.offense);
  s.carrier = isKickoff(kick) ? kicker.id : indexOf(s.offense, 0);
  for (const team of [0, 1]) Object.assign(ctrl(s, team), controller(team === s.offense ? s.carrier : indexOf(team, isKickoff(kick) || kick === 'punt' ? 0 : 1)));
  s.ball = { x: s.players[s.carrier].x, y: s.players[s.carrier].y, z: 1, flight: null, carry: null };
  s.thrown = false; s.intercepted = false; s.newPossession = false; s.kicked = false; s.catchProtection = 0; s.aim = { x: 0, y: d };
  s.playKind = null; s.passer = -1; s.receiver = -1; s.tackler = -1; s.read = 0; s.readTime = 0; s.runAt = -1; s.pressureAt = -1;
}
// ------------------------------------------------------------- game control
function kickoff(s, team, type) { s.offense = team; s.special = type; s.line = (type === 'free' ? -30 : -15) * direction(team); s.target = s.line; s.down = 1; s.conversion = false; beginSelect(s); }
function series(s, team, spot, { down = 1, target, conversion = false } = {}) {
  s.offense = team; s.special = null; s.conversion = conversion; s.down = down; s.line = clamp(spot, -49, 49);
  s.target = conversion ? FIELD * direction(team) : target ?? clamp(s.line + direction(team) * 10, -FIELD, FIELD);
  beginSelect(s);
}
function beginSelect(s) {
  s.phase = 'select'; s.phaseTime = 0; s.playClock = PLAY_CLOCK; s.next = null;
  for (const team of [0, 1]) {
    const list = playbook(s, team), kept = list.findIndex(p => p.name === s.callNames[team] && !p.kick);
    s.calls[team] = s.human[team] ? (s.conversion || s.special ? 0 : kept >= 0 ? kept : team === s.offense ? 2 : 0) : cpuCall(s, team, list);
    s.callNames[team] = list[s.calls[team]].name;
  }
  s.snapAt = cpuSnapTime(s); formation(s);
}
function beginNext(s) {
  const next = s.next; s.next = null;
  if (next.final) { finish(s); return; }
  if (next.kickoff !== undefined) { s.half = false; kickoff(s, next.kickoff, next.free ? 'free' : 'kickoff'); return; }
  series(s, next.team, next.spot, next);
}
function cancelController(c) { c.charge = 0; c.charging = false; c.passReady = false; c.receiverButton = null; c.receiverReady = [false, false, false]; c.throwHold = 0; c.tackleWindow = 0; }
function dead(s, message, next, stop = true) {
  s.phase = 'dead'; s.phaseTime = 0; s.deadTime = DEAD_TIME; s.message = message; s.lastResult = message; s.next = next;
  cancelController(s); cancelController(s.away); s.ball.flight = null;
  if (stop) s.running = false;
  if (s.time <= 0 && !next.conversion) endQuarter(s); else warning(s);
}
// The two-minute warning stops a running clock once per half.
function warning(s) {
  const half = s.quarter <= 2 ? 0 : 1;
  if ((s.quarter === 2 || s.quarter === 4) && s.time <= 120 && !s.warned[half]) {
    s.warned[half] = true; s.running = false; feedback(s, 'whistle', .6); event(s, 'whistle', s.offense, 'TWO-MINUTE WARNING'); s.message = `TWO-MINUTE WARNING · ${s.message}`;
  }
}
function endQuarter(s) {
  s.running = false; feedback(s, 'whistle', .8);
  if (s.quarter === 4) { s.next = { final: true }; s.deadTime = 2.6; s.message = `END OF REGULATION · ${s.message}`; return; }
  if (s.quarter === 2) { s.half = true; s.timeouts = [2, 2]; s.next = { kickoff: 1 - s.opening }; s.deadTime = 3.4; s.message = `HALFTIME · ${s.message}`; event(s, 'whistle', s.offense, 'HALFTIME'); }
  else { s.message = `END OF Q${s.quarter} · ${s.message}`; event(s, 'whistle', s.offense, `END OF Q${s.quarter}`); }
  s.quarter += 1; s.time = QUARTER;
}
function finish(s) {
  const [a, b] = s.score; s.phase = 'finished';
  s.message = a === b ? `FINAL · DRAW ${a}–${b}` : `FINAL · ${short(s, a > b ? 0 : 1)} WINS ${Math.max(a, b)}–${Math.min(a, b)}`;
  event(s, 'final', a >= b ? 0 : 1, s.message);
}
function callTimeout(s, team) {
  if (s.timeouts[team] <= 0 || !s.running || (s.phase !== 'dead' && s.phase !== 'select')) return false;
  s.timeouts[team] -= 1; s.running = false; s.playClock = PLAY_CLOCK;
  feedback(s, 'whistle', .7, `TIMEOUT · ${short(s, team)}`); event(s, 'timeout', team, `TIMEOUT · ${short(s, team)}`);
  return true;
}
// ------------------------------------------------------------------ scoring
function scored(s, team, points, text, kind) { s.score[team] += points; feedback(s, 'goal', points >= 6 ? 1 : .7); event(s, kind, team, text); }
function recordYards(s, gain) {
  const team = s.offense;
  if (s.playKind === 'pass') { stat(s, team, 'passYds', gain); s.players[s.passer].stats.passYds += gain; s.players[s.receiver].stats.recYds += gain; }
  else if (s.playKind === 'rush') { stat(s, team, 'rushYds', gain); s.players[s.carrier].stats.rushYds += gain; }
}
function touchdown(s) {
  const carrier = s.players[s.carrier], team = carrier.team, d = direction(team);
  if (s.conversion) { scored(s, team, 2, `${s.newPossession ? 'DEFENSIVE TWO-POINT RETURN' : 'TWO-POINT CONVERSION'} · ${who(s, carrier)}`, '2pt'); dead(s, s.newPossession ? 'DEFENSIVE TWO-POINT RETURN!' : 'TWO-POINT CONVERSION!', { kickoff: s.newPossession ? 1 - team : team }); return; }
  const from = s.newPossession ? s.returnFrom : s.line, yards = Math.max(1, Math.round((FIELD * d - from) * d));
  let how;
  if (s.newPossession) { how = s.intercepted ? 'PICK SIX' : `${yards}-YD RETURN`; carrier.stats.retYds += yards; }
  else if (s.playKind === 'pass') { how = `${yards}-YD CATCH FROM ${who(s, s.players[s.passer])}`; carrier.stats.recTd++; s.players[s.passer].stats.passTd++; recordYards(s, yards); }
  else { how = `${yards}-YD RUN`; carrier.stats.rushTd++; recordYards(s, yards); }
  const text = `TOUCHDOWN! ${who(s, carrier)} · ${how}`;
  scored(s, team, 6, text, 'td'); stat(s, team, 'tds');
  dead(s, text, { team, spot: 47 * d, conversion: true });
}
function endPlay(s, incomplete = false, reason = 'TACKLED', at = null) {
  const d = direction(s.offense), carrier = s.players[s.carrier], other = 1 - s.offense, tackler = s.players[s.tackler];
  if (s.conversion) {
    if (!incomplete && carrier && carrier.team === s.offense && carrier.y * d >= FIELD) { touchdown(s); return; }
    dead(s, incomplete ? `CONVERSION FAILS · ${reason}` : 'CONVERSION STOPPED', { kickoff: s.newPossession ? 1 - s.offense : s.offense }); return;
  }
  const spot = incomplete ? s.line : clamp(at ?? carrier?.y ?? s.ball.y, -FIELD, FIELD);
  const sack = !incomplete && carrier?.slot === 0 && s.playKind !== 'pass' && !s.special && !s.newPossession && spot * d < s.line * d;
  if (sack) { stat(s, other, 'sacks'); if (tackler) tackler.stats.sacks++; feedback(s, 'tackle', .9); event(s, 'sack', other, `SACK · ${tackler ? who(s, tackler) : short(s, other)} · ${Math.round((spot - s.line) * d)} YDS`); }
  if (!incomplete && spot * d >= FIELD) { touchdown(s); return; }
  if (!incomplete && spot * d <= -FIELD) {
    if (s.newPossession && s.returnFrom * d <= -FIELD) { dead(s, 'TOUCHBACK', { team: s.offense, spot: (s.intercepted ? -30 : -25) * d }); return; }
    scored(s, other, 2, `SAFETY · ${tackler ? who(s, tackler) : short(s, other)}`, 'safety'); dead(s, 'SAFETY! +2', { kickoff: s.offense, free: true }); return;
  }
  if (tackler && !incomplete) tackler.stats.tackles++;
  if (s.newPossession) {
    const gain = Math.round((spot - s.returnFrom) * d); carrier.stats.retYds += Math.max(0, gain);
    dead(s, `${s.intercepted ? 'INTERCEPTION' : s.special ? 'RETURN' : 'RECOVERY'} · ${who(s, carrier)} · ${gain >= 0 ? '+' : ''}${gain} YDS`, { team: s.offense, spot }, !(s.special && reason !== 'OUT OF BOUNDS')); return;
  }
  const gain = Math.round((spot - s.line) * d);
  if (!incomplete && !sack && carrier?.slot === 0 && s.playKind === 'rush') { stat(s, s.offense, 'rushAtt'); carrier.stats.rushAtt++; }
  if (!incomplete && !sack) recordYards(s, gain);
  const continueClock = !incomplete && reason !== 'OUT OF BOUNDS', keep = { team: s.offense, spot };
  const text = sack ? `SACK! ${tackler ? who(s, tackler) : short(s, other)} · ${gain} YDS` : incomplete ? reason : `${reason} · ${who(s, carrier)} · ${gain > 0 ? '+' : ''}${gain} YDS`;
  if (!incomplete && (spot - s.target) * d >= -.05) { stat(s, s.offense, 'firstDowns'); dead(s, `FIRST DOWN! ${who(s, carrier)} · +${gain} YDS`, keep, !continueClock); return; }
  if (s.down === 4) { event(s, 'turnover', other, `TURNOVER ON DOWNS · ${short(s, other)} BALL`); dead(s, 'TURNOVER ON DOWNS', { team: other, spot }); return; }
  dead(s, text, { ...keep, down: s.down + 1, target: s.target }, !continueClock);
}
// Linemen hold rushers for a rating-driven time before the rusher sheds the block.
function engagement(s, blocker, rusher) {
  const hold = 1.25 * scale(rating(s, blocker, 'blk'), .65, 1.45) / scale(rating(s, rusher, 'rsh'), .65, 1.45) * scale(rating(s, blocker, 'str'), .9, 1.1) / scale(rating(s, rusher, 'str'), .9, 1.1)
    * (spec(s, blocker, 'brick_wall') ? 1.4 : 1) / (spec(s, rusher, 'edge_rusher') ? 1.4 : 1);
  return hold * (.75 + random(s) * .5);
}
function snap(s) {
  const play = currentPlay(s, s.offense), defense = currentPlay(s, 1 - s.offense), kick = s.special || play.kick || null, k = s.teams[s.offense].kicker ?? 5;
  formation(s); s.playNumber += 1; s.started = true; s.special = kick;
  s.phase = 'live'; s.phaseTime = 0; s.snapTime = 0;
  s.message = s.human[s.offense] ? 'FIND YOUR WINDOW' : s.human[1 - s.offense] ? 'DEFEND YOUR END ZONE' : `${short(s, s.offense)} · ${play.name}`;
  if (kick && !isKickoff(kick)) { const kicker = kickerOf(s, s.offense); s.carrier = kicker.id; ctrl(s, s.offense).controlled = kicker.id; s.ball.x = kicker.x; s.ball.y = kicker.y; s.playKind = 'kick'; }
  else if (!kick) { stat(s, s.offense, 'plays'); if (play.run) s.handoffPending = true; }
  s.running = kick ? kick === 'punt' || kick === 'fg' : !s.conversion;
  if (!isKickoff(kick)) for (let slot = 4; slot < 7; slot++) {
    const rusher = s.players[indexOf(1 - s.offense, slot)], blocker = s.players[indexOf(s.offense, kick && slot === k ? 1 : slot)];
    rusher.engage = engagement(s, blocker, rusher) * (play.run ? 1.3 : .9);
  }
  if (defense.blitz && !kick) for (const slot of defense.blitz) s.players[indexOf(1 - s.offense, slot)].engage = 0;
}
// -------------------------------------------------------------------- kicks
function kickBall(s, kicker, power, aimX) {
  const d = direction(s.offense), type = s.special, kpw = rating(s, kicker, 'kpw'), kac = rating(s, kicker, 'kac'), big = spec(s, kicker, 'big_leg');
  let tx, ty, tz, duration, text;
  if (type === 'fg' || type === 'pat') {
    const toLine = 60 - kicker.y * d, range = fgRange(s, kicker) * power;
    tz = Math.max(.3, BAR + (range - toLine) * .45);
    tx = kicker.x + aimX * 5 + gauss(s) * scale(kac, 3.2, 1.3) * (toLine / 35); ty = 60 * d; duration = .8 + toLine / 30;
    if (type === 'fg') { stat(s, kicker.team, 'fgAtt'); kicker.stats.fgAtt++; }
    text = type === 'fg' ? `${Math.round(toLine)}-YD FIELD GOAL ATTEMPT` : 'EXTRA POINT ATTEMPT';
  } else {
    const dist = (type === 'punt' ? scale(kpw, 36, 56) : scale(kpw, 48, 66)) * (big ? 1.12 : 1) * power + gauss(s) * scale(kac, 5, 1.5);
    tx = clamp(kicker.x + aimX * 10 + gauss(s) * scale(kac, 5, 1.5), -23, 23); ty = clamp(kicker.y + d * dist, -59, 59); tz = 1.5; duration = clamp(1.4 + dist / 24, 2, 4.4);
    if (type === 'punt') { stat(s, kicker.team, 'punts'); kicker.stats.punts++; }
    text = type === 'punt' ? `PUNT · ${who(s, kicker)}` : 'KICKOFF';
  }
  s.ball = { x: kicker.x, y: kicker.y, z: 1, carry: null, flight: { x: kicker.x, y: kicker.y, tx, ty, vx: (tx - kicker.x) / duration, vy: (ty - kicker.y) / duration, vz: (tz - 1) / duration + 13 * (duration + 1 / 60) / 2, elapsed: 0, duration, passer: kicker.id, kick: type, rest: 0 } };
  s.carrier = -1; s.kicked = true; s.thrown = true; s.playKind = 'kick'; s.message = text;
  feedback(s, 'kick', .5 + power * .5, text);
}
function fgResult(s, good) {
  const kicker = s.players[s.ball.flight.passer], team = kicker.team, pat = s.special === 'pat', yards = Math.round(60 - s.line * direction(team) + 7);
  if (good) {
    if (!pat) { stat(s, team, 'fgMade'); kicker.stats.fgMade++; }
    scored(s, team, pat ? 1 : 3, pat ? `EXTRA POINT · ${who(s, kicker)}` : `FIELD GOAL · ${who(s, kicker)} · ${yards} YDS`, pat ? 'pat' : 'fg');
    dead(s, pat ? 'EXTRA POINT IS GOOD' : `FIELD GOAL IS GOOD · ${yards} YDS`, { kickoff: team });
  } else {
    feedback(s, 'denied', .6); event(s, pat ? 'pat' : 'fg', team, `${pat ? 'EXTRA POINT' : `${yards}-YD FIELD GOAL`} NO GOOD`);
    dead(s, pat ? 'EXTRA POINT · NO GOOD' : `FIELD GOAL · NO GOOD · ${yards} YDS`, pat ? { kickoff: team } : { team: 1 - team, spot: Math.min((s.line - 7 * direction(team)) * direction(team), 30) * direction(team) });
  }
}
// ------------------------------------------------------------------- passing
function nearestOpponent(s, p, within = Infinity) {
  let best = null, bestDistance = within;
  for (const q of s.players) if (q.team !== p.team && q.stun <= 0) { const n = distance(p, q); if (n < bestDistance) { best = q; bestDistance = n; } }
  return best;
}
function release(s, qb) { s.carrier = -1; s.thrown = true; s.playKind = 'pass'; s.passer = qb.id; stat(s, qb.team, 'passAtt'); qb.stats.att++; }
// Receiver choice supplies intent, not a guaranteed catch. Throw Accuracy scatters
// the placement with distance, pressure and movement; Throw Power sets the velocity
// and the range beyond which a ball dies short. Everyone still has to meet the
// descending physical ball in advanceBall.
function throwTo(s, qb, receiver, lead, type) {
  const d = direction(s.offense), range = distance(qb, receiver), thp = rating(s, qb, 'thp'), gun = spec(s, qb, 'gunslinger');
  const duration = clamp(type === 'LOB' ? .85 + range / 35 : type === 'TOUCH' ? .46 + range / 47 : .23 + range / 65, .35, 1.9) * scale(thp, 1.12, .9) * (type === 'BULLET' && gun ? 1 / 1.12 : 1);
  const leadLength = Math.hypot(lead.x, lead.y), leadScale = leadLength > 1 ? 1 / leadLength : 1;
  let tx = receiver.x + receiver.vx * duration + lead.x * leadScale * d * 2.1, ty = receiver.y + receiver.vy * duration - lead.y * leadScale * d * 2.1;
  const sigma = scale(rating(s, qb, 'tha'), 2.4, .55) * (.55 + range / 40) * (nearestOpponent(s, qb, 3.2) ? 1.4 : 1) * (Math.hypot(qb.vx, qb.vy) > 3 ? 1.3 : 1) * (spec(s, qb, 'surgeon') && range <= 20 ? .6 : 1) * NOISE[level(s, qb.team)];
  tx += gauss(s) * sigma; ty += gauss(s) * sigma;
  const maxRange = scale(thp, 38, 62) + (gun ? 8 : 0), throwRange = Math.hypot(tx - qb.x, ty - qb.y);
  if (throwRange > maxRange) { const k = maxRange / throwRange; tx = qb.x + (tx - qb.x) * k; ty = qb.y + (ty - qb.y) * k; }
  tx = clamp(tx, -24, 24); ty = clamp(ty, -58, 58);
  s.ball = { x: qb.x, y: qb.y, z: 1.7, carry: null, flight: { x: qb.x, y: qb.y, tx, ty, vx: (tx - qb.x) / duration, vy: (ty - qb.y) / duration, vz: -.1 / duration + 13 * (duration + 1 / 60) / 2, elapsed: 0, duration, passer: qb.id, receiver: receiver.id, type } };
  release(s, qb);
  s.message = `${type} PASS · ${RECEIVER_LABELS[receiver.slot - 1]}`;
  feedback(s, 'pass', type === 'BULLET' ? .85 : type === 'TOUCH' ? .6 : .4, s.message);
}
function throwAway(s, qb) {
  const d = direction(s.offense), tx = (qb.x >= 0 ? 1 : -1) * 27, ty = clamp(qb.y + d * 12, -58, 58), duration = .9;
  s.ball = { x: qb.x, y: qb.y, z: 1.7, carry: null, flight: { x: qb.x, y: qb.y, tx, ty, vx: (tx - qb.x) / duration, vy: (ty - qb.y) / duration, vz: -.5 / duration + 13 * (duration + 1 / 60) / 2, elapsed: 0, duration, passer: qb.id, type: 'TOUCH' } };
  release(s, qb); s.message = 'THROWN AWAY'; feedback(s, 'pass', .3, s.message);
}
function switchPlayer(s, team) {
  const c = ctrl(s, team);
  // Keep direct control of the ball on offense; switching is useful on defense and in flight.
  if (s.offense === team && s.carrier >= 0 && s.players[s.carrier].team === team) { c.controlled = s.carrier; return; }
  const target = s.ball.flight ? { x: s.ball.flight.tx, y: s.ball.flight.ty } : s.carrier >= 0 ? s.players[s.carrier] : s.ball;
  let best = null, bestDistance = Infinity;
  for (const p of s.players) if (p.team === team && p.id !== c.controlled) { const n = distance(p, target); if (n < bestDistance) { best = p; bestDistance = n; } }
  if (best) c.controlled = best.id;
}
// Swept sphere contact tests the entire flight segment against a moving catch volume.
// This avoids both frame tunnelling and snapping a ball to a distant receiver.
function sweptCatch(ballBefore, ballAfter, player, reach) {
  const start = { x: ballBefore.x - player.prevX, y: ballBefore.y - player.prevY, z: ballBefore.z - (reach ? 2.05 : 1.65) };
  const delta = { x: ballAfter.x - player.x - start.x, y: ballAfter.y - player.y - start.y, z: ballAfter.z - (reach ? 2.05 : 1.65) - start.z };
  const radius = reach ? 1.15 : .9;
  if (certifySportsSeparation(
    { x: ballBefore.x, y: ballBefore.z, z: ballBefore.y }, { x: ballAfter.x, y: ballAfter.z, z: ballAfter.y },
    { x: player.prevX, y: reach ? 2.05 : 1.65, z: player.prevY }, { x: player.x, y: reach ? 2.05 : 1.65, z: player.y }, radius)) return null;
  const c = start.x ** 2 + start.y ** 2 + start.z ** 2 - radius ** 2;
  if (c <= 0) return 0;
  const a = delta.x ** 2 + delta.y ** 2 + delta.z ** 2;
  if (a < 1e-10) return null;
  const b = 2 * (start.x * delta.x + start.y * delta.y + start.z * delta.z);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
// Gives the ball to an athlete at the impact point: completion, interception,
// kick return or fumble recovery depending on who arrived.
function settle(s, p, impact) {
  const f = s.ball.flight, qb = s.players[s.passer];
  s.carrier = p.id; s.ball.flight = null; s.catchProtection = .18;
  s.ball.x = impact.x; s.ball.y = impact.y; s.ball.z = impact.z; s.ball.carry = { x: impact.x - p.x, y: impact.y - p.y, z: impact.z };
  if (p.team !== s.offense) {
    if (f.kick) { s.running ||= isKickoff(f.kick); s.message = `RETURN · ${who(s, p)}`; feedback(s, 'catch', .5); }
    else if (f.fumble) { stat(s, s.offense, 'fumblesLost'); s.message = `FUMBLE RECOVERED · ${who(s, p)}`; event(s, 'turnover', p.team, `FUMBLE RECOVERED · ${who(s, p)}`); feedback(s, 'save', .9); }
    else {
      s.intercepted = true; stat(s, p.team, 'ints'); p.stats.ints++; qb.stats.picked++;
      s.message = `INTERCEPTION! ${who(s, p)}`; event(s, 'int', p.team, `INTERCEPTION · ${who(s, p)}`); feedback(s, 'save', .9);
    }
    s.newPossession = true; s.offense = p.team; s.returnFrom = p.y;
  } else if (f.fumble) { s.message = `RECOVERED · ${who(s, p)}`; feedback(s, 'catch', .5); }
  else { stat(s, p.team, 'passComp'); qb.stats.comp++; p.stats.rec++; s.receiver = p.id; s.message = 'COMPLETE! TURN UPFIELD'; feedback(s, 'catch', .55); }
  for (const team of [0, 1]) if (p.team === team) ctrl(s, team).controlled = p.id; else if (s.newPossession || f.kick) switchPlayer(s, team);
  s.snapTime = Math.max(s.snapTime, 1.2);
}
function breakup(s, defender) {
  stat(s, defender.team, 'breakups'); defender.stats.breakups++; feedback(s, 'denied', .5);
  endPlay(s, true, `BROKEN UP · ${who(s, defender)}`);
}
// Contested catches: Catching (and Sure Hands) against the best Coverage at the
// ball; the defender's share of lost balls becomes an interception, twice as
// often for a Ballhawk. Open catches can still be dropped by poor hands.
function resolveCatch(s, catcher, impact, type) {
  let receiver = null, receiverDistance = 1.7, defender = null, coverage = 0;
  const reach = 1.1;
  for (const q of s.players) {
    if (q.stun > 0) continue;
    const n = q === catcher ? 0 : distance(q, impact);
    const lock = q.team !== s.offense && spec(s, q, 'lockdown');
    if (n > (q.team === s.offense ? 1.7 : lock ? reach + .5 : reach)) continue;
    if (q.team !== s.offense) { const cov = scale(rating(s, q, 'cov'), .35, .8) * clamp(1.5 - n, .4, 1) * (lock ? 1.8 : 1); if (cov > coverage) { defender = q; coverage = cov; } }
    else if (q.slot >= 1 && q.slot <= 3 && n < receiverDistance) { receiver = q; receiverDistance = n; }
  }
  if (!defender) {
    const drop = spec(s, receiver, 'sure_hands') ? 0 : scale(rating(s, receiver, 'cth'), .09, .01) * (type === 'BULLET' ? 1.4 : 1);
    if (random(s) < drop) { stat(s, receiver.team, 'drops'); receiver.stats.drops++; feedback(s, 'denied', .5); endPlay(s, true, `DROPPED · ${who(s, receiver)}`); }
    else settle(s, receiver, impact);
    return;
  }
  if (receiver) {
    const hands = scale(rating(s, receiver, 'cth'), .4, .9) * (spec(s, receiver, 'sure_hands') ? 1.25 : 1) * (catcher === receiver ? 1 : .7);
    if (random(s) < hands / (hands + coverage)) { settle(s, receiver, impact); feedback(s, 'catch', .75, `CONTESTED CATCH · ${who(s, receiver)}`); return; }
    if (random(s) < (spec(s, defender, 'ballhawk') ? .16 : .08)) settle(s, defender, impact); else breakup(s, defender);
    return;
  }
  if (random(s) < scale(rating(s, defender, 'cth'), .12, .4) * (spec(s, defender, 'ballhawk') ? 1.5 : 1)) settle(s, defender, impact); else breakup(s, defender);
}
function fumble(s, carrier, defender) {
  stat(s, carrier.team, 'fumbles'); carrier.stats.fumbles++; defender.stats.ffum++;
  const { x, y } = s.ball;
  s.ball = { x, y, z: 1, carry: null, flight: { x, y, tx: x, ty: y, vx: carrier.vx * .5 + gauss(s) * 2, vy: carrier.vy * .5 + gauss(s) * 2, vz: 3 + random(s) * 2, elapsed: 0, duration: 1, passer: carrier.id, fumble: true, rest: 0 } };
  s.carrier = -1; s.message = `FUMBLE! FORCED BY ${who(s, defender)}`;
  feedback(s, 'tackle', 1, 'FUMBLE!'); event(s, 'fumble', defender.team, `FUMBLE · ${who(s, carrier)} · FORCED BY ${who(s, defender)}`);
}
function looseBall(s, f, dt) {
  const fumbler = s.players[f.passer];
  if (Math.abs(s.ball.x) >= 24.7 || Math.abs(s.ball.y) >= 60) { s.carrier = fumbler.id; endPlay(s, false, 'FUMBLE OUT OF BOUNDS', clamp(s.ball.y, -49, 49)); return; }
  if (f.elapsed > .25) for (const p of s.players) if (p.stun <= 0 && s.ball.z < 1.3 && distance(p, s.ball) < .95 && (p !== fumbler || f.elapsed > .6)) { settle(s, p, { x: s.ball.x, y: s.ball.y, z: s.ball.z }); return; }
  if (s.ball.z <= .225 && Math.hypot(f.vx, f.vy) < .8) f.rest += dt;
  if (f.rest > 1 || f.elapsed > 8) { s.carrier = fumbler.id; endPlay(s, false, 'FUMBLE', clamp(s.ball.y, -49, 49)); }
}
function kickFlight(s, f, before, dt) {
  const kicking = s.offense, receiving = 1 - kicking, d = direction(kicking), spot = () => clamp(s.ball.y, -49, 49);
  const touchback = () => dead(s, 'TOUCHBACK', { team: receiving, spot: (f.kick === 'punt' ? -30 : -25) * direction(receiving) });
  if (Math.abs(s.ball.y) >= 60 || (s.ball.z <= .3 && s.ball.y * d >= FIELD)) { touchback(); return; }
  if (Math.abs(s.ball.x) >= 24.7) { dead(s, `${f.kick === 'punt' ? 'PUNT' : 'KICKOFF'} OUT OF BOUNDS`, { team: receiving, spot: isKickoff(f.kick) ? Math.max(spot() * d, 10) * d : spot() }); return; }
  for (const p of s.players) {
    if (p.stun > 0) continue;
    const t = s.ball.z < 1.2 && distance(p, s.ball) < .95 ? 0 : f.vz < 0 ? sweptCatch(before, s.ball, p, false) : null;
    if (t === null) continue;
    if (p.team === kicking) { dead(s, `${f.kick === 'punt' ? 'PUNT' : 'KICKOFF'} DOWNED · ${who(s, p)}`, { team: receiving, spot: spot() }); return; }
    settle(s, p, { x: before.x + (s.ball.x - before.x) * t, y: before.y + (s.ball.y - before.y) * t, z: before.z + (s.ball.z - before.z) * t });
    if (p.y * d >= FIELD) touchback();
    return;
  }
  if (s.ball.z <= .225 && Math.hypot(f.vx, f.vy) < .8) f.rest += dt;
  if (f.rest > .8 || f.elapsed > 12) dead(s, `${f.kick === 'punt' ? 'PUNT' : 'KICKOFF'} DOWNED`, { team: receiving, spot: spot() });
}
function advanceBall(s, dt) {
  const f = s.ball.flight;
  if (!f) {
    const p = s.players[s.carrier];
    if (p) {
      const carry = s.ball.carry || { x: 0, y: 0, z: 1.3 }, settleRate = Math.min(1, dt * 9);
      carry.x *= 1 - settleRate; carry.y *= 1 - settleRate; carry.z += (1.3 - carry.z) * settleRate;
      s.ball.carry = carry; s.ball.x = p.x + carry.x; s.ball.y = p.y + carry.y; s.ball.z = carry.z;
    }
    return;
  }
  const before = { x: s.ball.x, y: s.ball.y, z: s.ball.z }, bouncy = Boolean(f.kick || f.fumble);
  const physical = stepSportsBall({ x: s.ball.x, y: s.ball.z, z: s.ball.y, vx: f.vx, vy: f.vz, vz: f.vy }, dt, { gravity: 13, floor: .22, restitution: bouncy ? .45 : 0, friction: bouncy ? .92 : 1 });
  s.ball.x = physical.x; s.ball.y = physical.z; s.ball.z = physical.y;
  f.vx = physical.vx; f.vy = physical.vz; f.vz = physical.vy; f.elapsed += dt;
  if (f.kick === 'fg' || f.kick === 'pat') {
    const d = direction(s.offense);
    if (before.y * d < 60 && s.ball.y * d >= 60) {
      const t = (60 - before.y * d) / ((s.ball.y - before.y) * d), x = before.x + (s.ball.x - before.x) * t, z = before.z + (s.ball.z - before.z) * t;
      fgResult(s, Math.abs(x) <= POST && z >= BAR);
    } else if (s.ball.z <= .225 || Math.abs(s.ball.x) > 25 || f.elapsed > 6) fgResult(s, false);
    return;
  }
  if (f.fumble) { looseBall(s, f, dt); return; }
  if (f.kick) { kickFlight(s, f, before, dt); return; }
  if (f.vz < 0 && f.elapsed > .12) {
    let hit = null, hitT = 2;
    for (const p of s.players) {
      if (p.id === f.passer || p.stun > 0 || (p.team === s.offense && (p.slot < 1 || p.slot > 3))) continue;
      const c = ctrl(s, p.team), t = sweptCatch(before, s.ball, p, p.id === c.controlled && c.tackleWindow > 0);
      if (t !== null && (t < hitT || (t === hitT && p.id < hit.id))) { hit = p; hitT = t; }
    }
    if (hit) { resolveCatch(s, hit, { x: before.x + (s.ball.x - before.x) * hitT, y: before.y + (s.ball.y - before.y) * hitT, z: before.z + (s.ball.z - before.z) * hitT }, f.type); return; }
  }
  if (s.ball.z <= .225 || f.elapsed > 4 || Math.abs(s.ball.x) > 25 || Math.abs(s.ball.y) > 60) endPlay(s, true, f.receiver === undefined ? 'THROWN AWAY' : 'INCOMPLETE');
}
function handoff(s, dt) {
  if (!s.handoffPending) return;
  s.handoffTime += dt;
  const qb = s.players[indexOf(s.offense, 0)], rb = s.players[indexOf(s.offense, 1)];
  if (s.carrier !== qb.id || s.handoffTime > 2.2) { s.handoffPending = false; return; }
  if (distance(qb, rb) < 1.45) {
    const position = { x: s.ball.x, y: s.ball.y, z: s.ball.z };
    s.carrier = rb.id; s.thrown = true; s.handoffPending = false; s.catchProtection = .2; s.playKind = 'rush'; s.runAt = s.snapTime;
    stat(s, rb.team, 'rushAtt'); rb.stats.rushAtt++;
    s.ball.carry = { x: position.x - rb.x, y: position.y - rb.y, z: position.z };
    if (s.human[s.offense]) ctrl(s, s.offense).controlled = rb.id;
    feedback(s, 'pass', .4, 'HANDOFF · FOLLOW YOUR LEAD BLOCKER');
  }
}
// A quarterback who crosses the line or bails from the pocket becomes a runner.
function keeper(s, qb, text) { s.thrown = true; s.playKind = 'rush'; s.runAt = s.snapTime; s.message = text; }
// ----------------------------------------------------------------- movement
function beginDive(p, vector) {
  const n = norm(vector.x, vector.y); p.diveX = n.x; p.diveY = n.y; p.diveTime = .27; p.diveCooldown = 1.25; p.diveHit = false;
}
function moveToward(p, target, speed, dt) {
  const dx = target.x - p.x, dy = target.y - p.y, n = Math.hypot(dx, dy);
  const k = n > 0.05 ? Math.min(speed, n / dt) / n : 0;
  p.wishX = dx * k; p.wishY = dy * k;
}
// Jukes cost stamina and can freeze a squared-up defender; Agility (and Ankle
// Breaker) decide how often the cut wins.
function juke(s, p, side) {
  const ankle = spec(s, p, 'ankle_breaker'), win = scale(rating(s, p, 'agi'), .25, .6) * (ankle ? 1.35 : 1);
  p.jukeTime = .22; p.jukeCooldown = .9; p.jukeX = side * direction(s.offense); p.stamina = Math.max(0, p.stamina - (ankle ? .17 : .26)); p.moveWon = false;
  let broke = false;
  for (const q of s.players) if (q.team !== p.team && q.stun <= 0 && distance(p, q) < 3 && (q.x - p.x) * p.facingX + (q.y - p.y) * p.facingY > 0 && random(s) < win * scale(rating(s, q, 'awr'), 1.15, .8)) { q.stun = .32; q.recover = .2; broke = true; }
  feedback(s, 'skill', .55, broke ? (ankle ? 'ANKLE BREAKER!' : 'JUKED HIM!') : 'JUKE · CUT INTO SPACE');
}
function integrateAthletes(s, dt) {
  for (const p of s.players) {
    p.prevX = p.x; p.prevY = p.y;
    const desiredSpeed = Math.hypot(p.wishX, p.wishY), currentSpeed = Math.hypot(p.vx, p.vy), base = scale(rating(s, p, 'agi'), 24, 36);
    const reversing = p.vx * p.wishX + p.vy * p.wishY < 0;
    const acceleration = p.jukeTime > 0 ? 68 : p.diveTime > 0 ? 60 : reversing || desiredSpeed < currentSpeed ? base * 1.35 : base;
    const dvx = p.wishX - p.vx, dvy = p.wishY - p.vy, change = Math.hypot(dvx, dvy);
    const amount = change > 0 ? Math.min(1, acceleration * dt / change) : 0;
    p.vx += dvx * amount; p.vy += dvy * amount;
    if (p.stun > 0) { p.vx *= Math.max(0, 1 - dt * 8); p.vy *= Math.max(0, 1 - dt * 8); }
    const accepted = certifySportsMove({ x: p.x, y: 0, z: p.y }, { x: clamp(p.x + p.vx * dt, -26, 26), y: 0, z: clamp(p.y + p.vy * dt, -59, 59) }, 14 * dt);
    p.x = accepted.x; p.y = accepted.z;
  }
}
function collideAthletes(s, dt) {
  const touched = new Set();
  for (let i = 0; i < s.players.length; i++) for (let j = i + 1; j < s.players.length; j++) {
    const a = s.players[i], b = s.players[j];
    let dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const carrier = a.id === s.carrier ? a : b.id === s.carrier ? b : null;
    const defender = carrier === a ? b : carrier === b ? a : null;
    const committed = defender?.diveTime > 0;
    const spinRadius = carrier?.spinTime > 0.1 && carrier.spinTime < .43 ? 1.08 : 1.35;
    const radius = committed ? 1.65 : spinRadius;
    if (len > radius) continue;
    if (len < .001) { dx = (i % 2 ? 1 : -1) * .01; dy = .01; len = Math.hypot(dx, dy); }
    const nx = dx / len, ny = dy / len, closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    // Equal-mass impulse transfers momentum to the contacted athlete. The
    // generated guard checks pair momentum and nonincreasing kinetic energy.
    if (closing > 0) {
      const impulse = closing * .575;
      const accepted = certifySportsPairCollision(
        { x: a.vx, y: 0, z: a.vy }, { x: b.vx, y: 0, z: b.vy },
        { x: a.vx - impulse * nx, y: 0, z: a.vy - impulse * ny },
        { x: b.vx + impulse * nx, y: 0, z: b.vy + impulse * ny });
      a.vx = accepted.a.x; a.vy = accepted.a.z; b.vx = accepted.b.x; b.vy = accepted.b.z;
    }
    if (len < 1.35) {
      const correction = Math.min((1.35 - len) * .5, dt * 2);
      for (const [p, sign] of [[a, -1], [b, 1]]) {
        const accepted = certifySportsMove({ x: p.prevX, y: 0, z: p.prevY }, { x: p.x + nx * correction * sign, y: 0, z: p.y + ny * correction * sign }, 14 * dt);
        p.x = accepted.x; p.y = accepted.z;
      }
    }
    if (carrier && defender.team !== carrier.team && s.snapTime > .65 && s.catchProtection === 0 && defender.stun <= 0) {
      touched.add(carrier.id);
      const front = ((defender.x - carrier.x) * carrier.facingX + (defender.y - carrier.y) * carrier.facingY) / Math.max(.1, len);
      const armWin = carrier.stiffTime > 0 && !carrier.moveWon && front > .2 && closing < 8;
      const spinWin = carrier.spinTime > .1 && carrier.spinTime < .43 && !carrier.moveWon && Math.abs(front) < .75 && closing < 7;
      const shrug = () => { defender.stun = .45; defender.diveTime = 0; defender.wrapTime = 0; defender.recover = .3; carrier.balance = Math.min(1, carrier.balance + .25); };
      if (armWin || spinWin) {
        carrier.moveWon = true; shrug(); defender.stun = armWin ? .42 : .28;
        feedback(s, 'skill', .8, armWin ? 'STIFF ARM · KEEP YOUR FEET' : 'SPUN FREE');
        continue;
      }
      const wrapped = defender.wrapTime > 0, pocket = carrier.slot === 0 && !s.thrown && !s.special, attempt = committed || wrapped || (pocket && carrier.hitCooldown === 0);
      if (pocket && attempt) carrier.hitCooldown = .25;
      // A pocket passer can slip a rusher; a runner can break a real tackle attempt.
      const escapeArtist = spec(s, carrier, 'escape_artist');
      if (attempt && pocket && random(s) < scale(rating(s, carrier, 'agi'), .14, .38) * (escapeArtist ? 1.6 : 1)) {
        // An Escape Artist also buys a beat to throw before the next rusher can finish.
        shrug(); if (escapeArtist) carrier.hitCooldown = .6;
        feedback(s, 'skill', .7, `${who(s, carrier)} ESCAPES THE SACK`); continue;
      }
      if (attempt && !(carrier.slot === 0 && !s.thrown)) {
        const bull = spec(s, carrier, 'bulldozer') && front > .4;
        if (random(s) < scale(rating(s, carrier, 'btk'), .06, .34) * (bull ? 1.35 : 1) * scale(rating(s, defender, 'tak'), 1.25, .75)) {
          shrug(); feedback(s, 'skill', .8, bull ? 'BULLDOZER!' : `BROKEN TACKLE · ${who(s, carrier)}`); continue;
        }
        if (closing > 2.5 && !s.special) {
          const hit = scale(rating(s, defender, 'str'), .6, 1) * scale(rating(s, defender, 'tak'), .7, 1.1) * (spec(s, defender, 'enforcer') ? 2 : 1) * clamp(closing / 6, .5, 1.4);
          if (random(s) < .035 * hit * scale(rating(s, carrier, 'car'), 2.4, .45) * (carrier.protect ? .4 : 1)) { fumble(s, carrier, defender); return; }
        }
      }
      const resistance = (carrier.protect ? .43 : carrier.jukeTime > 0 ? .32 : carrier.spinTime > .1 ? .55 : 1)
        * scale(rating(s, defender, 'tak'), .8, 1.25) * scale(rating(s, defender, 'str'), .88, 1.12) * scale(rating(s, carrier, 'btk'), 1.15, .75) * scale(rating(s, carrier, 'str'), 1.1, .9);
      let damage = dt * (2.7 + Math.max(0, closing) * .4) * resistance * (defender.engage > 0 ? .3 : 1);
      if (carrier.hitCooldown === 0 && closing > 3) { damage += (closing - 3) * .09 * resistance; carrier.hitCooldown = .25; }
      if (wrapped) { damage += .75 * resistance; defender.wrapTime = 0; defender.diveHit = true; feedback(s, 'tackle', .45); }
      if (committed) { damage += 1.1 * resistance; ctrl(s, defender.team).tackleWindow = 0; defender.diveTime = 0; defender.diveHit = true; defender.recover = .2; feedback(s, 'tackle', .65); }
      if (!attempt && carrier.balance - damage <= 0 && !pocket && random(s) < scale(rating(s, carrier, 'btk'), .04, .2) * (spec(s, carrier, 'bulldozer') && front > .4 ? 1.35 : 1) * scale(rating(s, defender, 'tak'), 1.25, .75)) {
        shrug(); feedback(s, 'skill', .8, spec(s, carrier, 'bulldozer') && front > .4 ? 'BULLDOZER!' : `BROKEN TACKLE · ${who(s, carrier)}`); continue;
      }
      carrier.balance = Math.max(0, carrier.balance - damage); s.tackler = defender.id;
      if (carrier.balance <= 0) { feedback(s, 'tackle', .9); endPlay(s, false, carrier.protect ? 'WRAPPED UP' : 'TACKLED'); return; }
    }
  }
  for (const p of s.players) if (!touched.has(p.id)) p.balance = Math.min(1, p.balance + dt * .7);
}
// ---------------------------------------------------------------------- CPU
// Play-calling from down, distance, field position, score, clock and the team's
// tactics. Difficulty adds decision noise.
function cpuSnapTime(s) {
  if (s.human[s.offense]) return 99;
  if (isKickoff(s.special)) return 1.5;
  const diff = s.score[s.offense] - s.score[1 - s.offense], late = s.quarter === 4 && s.time < 180;
  if (diff < 0 && (late || (s.quarter === 2 && s.time < 60))) return 1.2;
  if (diff > 0 && late && s.running) return 16;
  return 2.4 + random(s) * 2 - level(s, s.offense) * .3;
}
function cpuCall(s, team, list) {
  if (list.length === 1) return 0;
  const lvl = level(s, team), tactics = s.teams[team].tactics, d = direction(s.offense), r = random(s);
  if (random(s) < [.18, .07, .02][lvl]) return Math.floor(random(s) * list.length);
  const pick = play => Math.max(0, list.indexOf(play));
  const toGo = Math.max(1, Math.round((s.target - s.line) * d)), toGoal = Math.round(FIELD - s.line * d), diff = s.score[team] - s.score[1 - team];
  const late = (s.quarter === 4 && s.time < 180) || (s.quarter === 2 && s.time < 45), hurry = diff < 0 && late, milk = diff > 0 && s.quarter === 4 && s.time < 180;
  if (team !== s.offense) {
    const [c2, c3, man, blitz, prevent] = DEFENSE, blitzy = tactics.blitz;
    if (diff > 0 && s.quarter === 4 && s.time < 120 && toGo > 6) return pick(prevent);
    if (toGo <= 2) return pick(r < .45 ? man : r < .45 + blitzy * .6 ? blitz : c2);
    if (toGo >= 7) return pick(r < .4 ? c3 : r < .65 ? c2 : r < .65 + blitzy * .5 ? blitz : man);
    return pick(r < .32 ? c2 : r < .58 ? man : r < .58 + blitzy * .55 ? blitz : c3);
  }
  const [inside, sweep, slants, curls, verts, pa, screen] = OFFENSE;
  if (s.conversion) return pick(diff === -2 || (diff === -5 && late) || (tactics.aggression > .6 && r < .2) ? (random(s) < .5 ? inside : slants) : PAT);
  if (s.down === 4) {
    const canKick = toGoal + 17 <= fgRange(s, kickerOf(s, team)) + 1, desperate = s.quarter === 4 && diff < 0 && (s.time < 240 || (s.time < 400 && diff < -8));
    const goFor = toGo <= 2 && (toGoal < 45 || desperate) && r < tactics.aggression + (desperate ? .5 : 0) - (toGoal > 60 ? .3 : 0);
    if (!goFor) {
      if (canKick && !(desperate && diff < -3 && s.time < 120)) return pick(FG);
      if (!(desperate && (s.time < 150 || toGoal < 50))) return pick(PUNT);
    }
  }
  const passP = tactics.passRate - .06 + (toGo >= 8 ? .25 : toGo <= 2 ? -.25 : 0) + (hurry ? .3 : 0) - (milk ? .3 : 0) + (s.down === 3 && toGo > 4 ? .2 : 0) + (s.down === 4 ? .15 : 0);
  if (random(s) < clamp(passP, .1, .95)) {
    const q = random(s);
    if (toGoal <= 12) return pick(q < .4 ? slants : q < .7 ? curls : q < .85 ? pa : screen);
    if (toGo <= 4) return pick(q < .4 ? slants : q < .65 ? screen : q < .85 ? curls : pa);
    const gun = spec(s, s.players[indexOf(team, 0)], 'gunslinger');
    if (toGo >= 10 || hurry || (gun && q < .3)) return pick(q < .35 ? verts : q < .6 ? pa : q < .85 ? curls : slants);
    return pick(q < .3 ? curls : q < .5 ? slants : q < .7 ? pa : q < .85 ? verts : screen);
  }
  return pick(random(s) < .75 ? inside : sweep);
}
// Trailing teams spend timeouts late in a half to stop a running clock.
function cpuClock(s) {
  for (const team of [0, 1]) {
    if (s.human[team] || !s.running || s.timeouts[team] === 0 || (s.quarter !== 4 && s.quarter !== 2) || s.time > 100) continue;
    const diff = s.score[team] - s.score[1 - team];
    if (diff <= 0 && (team !== s.offense || s.time < 40) && (s.quarter === 4 || s.time < 50)) callTimeout(s, team);
  }
}
function pursue(s, p, target, speed, dt) {
  const t = clamp(distance(p, target) / Math.max(speed, 1), .1, .9) * scale(rating(s, p, 'awr'), .45, 1);
  moveToward(p, { x: target.x + target.vx * t, y: target.y + target.vy * t }, speed, dt);
}
function blockNearest(s, p, speed, dt) {
  const carrier = s.players[s.carrier], d = direction(s.offense);
  let best = null, bestScore = Infinity;
  for (const q of s.players) if (q.team !== p.team && q.stun <= 0 && q.engage <= 0) { const score = distance(p, q) + (carrier ? distance(q, carrier) * .5 : 0); if (score < bestScore) { best = q; bestScore = score; } }
  if (best) moveToward(p, { x: best.x, y: best.y - d * .7 }, speed, dt); else moveToward(p, p, 0, dt);
}
// Receivers run the called route, then work upfield (verticals) or settle into space.
function runRoute(s, p, play, speed, dt) {
  const d = direction(s.offense), route = play.routes?.[p.slot];
  if (!route) { moveToward(p, { x: p.x, y: s.line + d * 6 }, speed * .8, dt); return; }
  if (p.route < route.length) {
    const wp = route[p.route], target = { x: wp[0] * d, y: clamp(s.line + wp[1] * d, -57, 57) };
    if (distance(p, target) < .8) { p.route++; p.burst = .45 * scale(rating(s, p, 'rte'), .3, 1); }
    const jam = nearestOpponent(s, p, 1.9);
    if (jam && (jam.x - p.x) * (target.x - p.x) + (jam.y - p.y) * (target.y - p.y) > 0) moveToward(p, { x: p.x + (p.x >= jam.x ? 1.4 : -1.4), y: p.y + d * 1.2 }, speed * .96, dt);
    else moveToward(p, target, speed * .96, dt);
    return;
  }
  if (play.deep) { moveToward(p, { x: p.x, y: p.y + d * 10 }, speed, dt); return; }
  const near = nearestOpponent(s, p, 4);
  moveToward(p, near ? { x: clamp(p.x + (p.x - near.x) * 2, -22, 22), y: p.y + (p.y - near.y) * .5 } : p, 3.5, dt);
}
function runCarrier(s, p, play, speed, dt) {
  const d = direction(s.offense), threat = nearestOpponent(s, p, 7);
  const designed = play?.lane !== undefined && s.playKind === 'rush' && !s.newPossession && (p.y - s.line) * d < 3;
  const x = designed ? play.lane * d : threat ? clamp(p.x + clamp((p.x - threat.x) * 2, -6, 6), -22, 22) : p.x * .94;
  const open = !threat || distance(p, threat) > 2.5, extra = spec(s, p, 'burner') && open && Math.abs(p.y - s.line) > 10 ? 1.08 : 1;
  moveToward(p, { x, y: p.y + d * 10 }, speed * extra * (designed ? 1.04 : .95), dt);
  if (threat && p.jukeCooldown === 0 && p.stamina > .3 && distance(p, threat) < 2.8 && (threat.y - p.y) * d > .3 && random(s) < scale(rating(s, p, 'agi'), .3, .75) * dt * 6 * (spec(s, p, 'ankle_breaker') ? 1.6 : 1)) juke(s, p, (threat.x > p.x ? -1 : 1) * d);
}
function blockAI(s, p, play, carrier, speed, dt) {
  const d = direction(s.offense);
  if (carrier && !s.thrown && !s.newPossession) {
    if (play.screen && s.snapTime > .9) { blockNearest(s, p, speed, dt); return; }
    const rusher = s.players[indexOf(1 - s.offense, p.slot)], runBlock = play.run || s.handoffPending;
    if (runBlock && p.slot === 4 && play.lane < 0) { moveToward(p, { x: carrier.x - 5 * d, y: carrier.y + 5 * d }, 7.5, dt); return; }
    if (runBlock && play.lane !== undefined) {
      // Run blocking: the backside lineman climbs to the linebacker; the others seal their man on the lane side.
      const lane = play.lane * d, backside = Math.abs(OFFENSIVE[p.slot][0] * d - lane) > 6;
      if (backside || rusher.engage <= 0) { blockNearest(s, p, speed, dt); return; }
      moveToward(p, { x: rusher.x + (lane > rusher.x ? .7 : -.7), y: s.line + d * 1.2 }, 7.5, dt); return;
    }
    moveToward(p, { x: rusher.x * .7 + carrier.x * .3, y: s.line + .5 * d }, runBlock ? 7.5 : 5.2, dt); return;
  }
  blockNearest(s, p, speed * .9, dt);
}
function offenseAI(s, p, play, carrier, speed, dt) {
  const d = direction(s.offense), f = s.ball.flight;
  if (s.handoffPending && p.slot === 1) { moveToward(p, s.players[indexOf(s.offense, 0)], 9, dt); return; }
  if (p.id === s.carrier) {
    if (s.handoffPending || (p.slot === 0 && !s.thrown && !s.special) || (s.special && !s.kicked)) moveToward(p, p, 0, dt);
    else runCarrier(s, p, play, speed, dt);
    return;
  }
  if (s.special && !s.kicked) { if (p.slot >= 4) blockAI(s, p, play, carrier, speed, dt); else moveToward(p, p, 0, dt); return; }
  if (p.slot >= 4 || (play.screen && p.slot > 1 && p.route >= play.routes[p.slot].length)) { blockAI(s, p, play, carrier, speed, dt); return; }
  if (f) { if (f.receiver === p.id) moveToward(p, { x: f.tx, y: f.ty }, speed, dt); else blockNearest(s, p, speed, dt); return; }
  if (carrier && (s.thrown || s.newPossession || (carrier.y - s.line) * d > 1)) { blockNearest(s, p, speed * .95, dt); return; }
  runRoute(s, p, play, speed, dt);
}
// Man coverage trails by Coverage (Lockdown tighter) and lags cuts; Route Running
// and Route Artist buy the receiver separation at every break.
function manCover(s, p, r, speed, dt) {
  const d = direction(s.offense), lock = spec(s, p, 'lockdown') ? .6 : 1, artist = spec(s, r, 'route_artist');
  const lag = scale(rating(s, p, 'cov'), .3, .1) * lock + (artist ? .08 : 0);
  const trail = scale(rating(s, p, 'cov'), 1.6, .7) * lock + (artist ? 1 : 0) + scale(rating(s, r, 'rte'), 0, .5);
  moveToward(p, { x: r.x - r.vx * lag + (r.x > 0 ? -.7 : .7), y: r.y + d * trail }, speed, dt);
}
function zoneCover(s, p, spot, speed, dt) {
  const d = direction(s.offense), deep = (spot.y - s.line) * d >= 14;
  let best = null, bestDistance = 6.5;
  for (const q of s.players) if (q.team === s.offense && q.slot >= 1 && q.slot <= 3) {
    const n = Math.hypot(q.x + q.vx * .4 - spot.x, q.y + q.vy * .4 - spot.y), vertical = deep && Math.abs(q.x - spot.x) < 13 && (q.y - spot.y) * d > -6 && q.vy * d > 3;
    if (n < bestDistance || (vertical && !best)) { best = q; bestDistance = vertical ? Math.min(n, 6.4) : n; }
  }
  // Pattern matching: with nobody in the zone, carry a receiver running through your area.
  if (!best) for (const q of s.players) if (q.team === s.offense && q.slot >= 1 && q.slot <= 3 && q.vy * d > 3 && distance(p, q) < 6 && (q.y - spot.y) * d > -8) { best = q; break; }
  if (best) {
    if (deep && best.vy * d > 3) moveToward(p, { x: best.x - best.vx * .15 + (best.x > 0 ? -.7 : .7), y: clamp(best.y + best.vy * .4 + d * 3, -57, 57) }, speed, dt);
    else manCover(s, p, best, speed, dt);
    return;
  }
  let incoming = null, incomingDistance = 13;
  if (deep) for (const q of s.players) if (q.team === s.offense && q.slot >= 1 && q.slot <= 3 && q.vy * d > 3 && Math.abs(q.x - spot.x) < 9 && (q.y - spot.y) * d < 2) { const n = distance(p, q); if (n < incomingDistance) { incoming = q; incomingDistance = n; } }
  if (incoming) { moveToward(p, { x: (spot.x + incoming.x) / 2, y: clamp(Math.max(spot.y * d, (incoming.y + incoming.vy * .5) * d + 4) * d, -57, 57) }, speed, dt); return; }
  let deepest = null;
  if (deep) for (const q of s.players) if (q.team === s.offense && q.slot >= 1 && q.slot <= 3 && (q.y - s.line) * d > 8 && (!deepest || (q.y - deepest.y) * d > 0)) deepest = q;
  if (deepest && (deepest.y + 3 * d - spot.y) * d > 0) { moveToward(p, { x: (spot.x + deepest.x) / 2, y: clamp(deepest.y + 3 * d, -57, 57) }, speed, dt); return; }
  moveToward(p, spot, speed * .9, dt);
}
function defenseAI(s, p, play, defense, carrier, speed, runRecognized, dt) {
  const d = direction(s.offense), f = s.ball.flight, pass = f && !f.kick && !f.fumble;
  const reacting = pass && f.elapsed <= reaction(s, p) * (p.slot >= 4 ? 2 : 1), preRelease = (carrier && !s.thrown && !s.newPossession) || reacting;
  if (p.engage > 0 && carrier && !f && !s.newPossession && (carrier.y - s.line) * d < 1) {
    const anchor = DEFENSIVE[p.slot][0] * d, shove = play.run && play.lane !== undefined ? (anchor * d >= play.lane ? 1 : -1) * d : 0;
    moveToward(p, { x: anchor + shove, y: s.line + d * 1.8 }, 2.5, dt); return;
  }
  if (preRelease) {
    if (p.slot >= 4 || defense.blitz?.includes(p.slot)) {
      pursue(s, p, carrier || s.players[s.passer], speed * (defense.prevent ? .75 : 1), dt);
      return;
    }
    if (play.fake && (p.slot === 0 || p.slot === 1) && s.snapTime < reaction(s, p) * 2 + .35) { pursue(s, p, s.players[indexOf(s.offense, 1)], speed * .9, dt); return; }
    const manSlot = defense.man?.[p.slot];
    if (manSlot !== undefined) { manCover(s, p, s.players[indexOf(s.offense, manSlot)], speed, dt); return; }
    const zone = defense.zones?.[p.slot];
    if (zone) { zoneCover(s, p, { x: zone[0] * d, y: s.line + zone[1] * d }, speed, dt); return; }
    pursue(s, p, carrier || s.players[s.passer], speed, dt); return;
  }
  if (f) { moveToward(p, { x: f.tx, y: f.ty }, speed, dt); return; }
  if (!carrier) { moveToward(p, p, 0, dt); return; }
  if (runRecognized >= 0 && runRecognized < reaction(s, p) * 2.2 && !s.newPossession) { moveToward(p, p, 0, dt); return; }
  const wide = Math.abs(carrier.x) > 9 && s.playKind === 'rush' && !s.newPossession && p.slot <= 3 && Math.sign(p.x || 1) === Math.sign(carrier.x) && (p.y - carrier.y) * d > 1.5;
  if (wide) moveToward(p, { x: clamp(carrier.x + Math.sign(carrier.x) * 2, -23.5, 23.5), y: carrier.y + d * 2.5 }, speed * 1.12, dt);
  else pursue(s, p, carrier, speed * 1.12, dt);
  const gap = distance(p, carrier);
  if (!s.handoffPending && s.snapTime > 1 && p.diveCooldown === 0 && gap < 3.2 && s.catchProtection === 0) {
    const away = ((carrier.x - p.x) * carrier.vx + (carrier.y - p.y) * carrier.vy) / Math.max(gap, .1);
    if (Math.hypot(carrier.vx, carrier.vy) < 5.5 && gap < 2 && !(carrier.slot === 0 && !s.thrown)) { p.wrapTime = .35; p.diveCooldown = .65; }
    else if (gap - Math.max(0, 11.5 - away) * .27 < 1.5) beginDive(p, { x: carrier.x + carrier.vx * .12 - p.x, y: carrier.y + carrier.vy * .12 - p.y });
  }
}
function kickCoverage(s, p, f, speed, dt) {
  const kicking = s.offense, d = direction(kicking), landing = f.elapsed > f.duration ? s.ball : { x: f.tx, y: f.ty };
  if (p.team !== kicking) {
    if (p.slot === 0) { moveToward(p, landing, speed, dt); return; }
    const enemy = nearestOpponent(s, p, 14);
    if (enemy) moveToward(p, { x: enemy.x, y: enemy.y - d * 1 }, speed * .9, dt); else moveToward(p, { x: p.x, y: landing.y - d * 12 }, speed * .8, dt);
    return;
  }
  moveToward(p, { x: landing.x + (p.slot - 3) * 2, y: landing.y }, speed * (f.passer === p.id ? .6 : .95), dt);
}
// Progression reads: the quarterback works the play's reads with Awareness-based
// timing, throws when the window is open, then checks down, scrambles or throws it away.
function cpuQuarterback(s, play, dt) {
  const qb = s.players[s.carrier];
  if (!qb || qb.slot !== 0 || qb.team !== s.offense || s.thrown || s.handoffPending || s.special || (s.human[qb.team] && ctrl(s, qb.team).controlled === qb.id)) return;
  const d = direction(s.offense), lvl = level(s, qb.team), tactics = s.teams[qb.team].tactics, awr = rating(s, qb, 'awr'), thp = rating(s, qb, 'thp'), gun = spec(s, qb, 'gunslinger');
  const rusher = nearestOpponent(s, qb, scale(awr, 2.2, 3.4));
  if (rusher && s.pressureAt < 0) s.pressureAt = s.snapTime;
  const pressured = rusher !== null && s.snapTime - s.pressureAt >= scale(awr, .55, .2) * [1.3, 1, .8][lvl];
  moveToward(qb, { x: qb.x * .5 + (rusher ? clamp((qb.x - rusher.x) * 1.5, -4, 4) : 0), y: s.line - d * (play.screen ? 8.5 : 6.5) }, 3.5, dt);
  if (s.snapTime < (play.quick ? .85 : play.screen ? 1.25 : play.fake ? 1.45 : 1.15) * [1.15, 1, .9][lvl] && !(pressured && s.snapTime > .5)) return;
  const reads = play.reads || [2, 3, 1], hurry = s.score[qb.team] < s.score[1 - qb.team] && ((s.quarter === 4 && s.time < 180) || (s.quarter === 2 && s.time < 45));
  const evaluate = slot => {
    const r = s.players[indexOf(s.offense, slot)], range = distance(qb, r);
    const type = play.screen || range < 9 ? 'TOUCH' : range < (gun ? 32 : 24) ? 'BULLET' : 'LOB';
    const duration = clamp(type === 'LOB' ? .85 + range / 35 : type === 'TOUCH' ? .46 + range / 47 : .23 + range / 65, .35, 1.9) * scale(thp, 1.12, .9) * (type === 'BULLET' && gun ? 1 / 1.12 : 1);
    const target = { x: r.x + r.vx * duration * .72, y: r.y + r.vy * duration * .72 };
    const lx = target.x - qb.x, ly = target.y - qb.y, length2 = lx * lx + ly * ly;
    let room = Infinity, margin = Infinity, nearest = null, blocked = false;
    for (const q of s.players) if (q.team !== s.offense) {
      const sep = Math.hypot(q.x + q.vx * duration * .55 - target.x, q.y + q.vy * duration * .55 - target.y);
      if (sep < room) { room = sep; nearest = q; }
      margin = Math.min(margin, reaction(s, q) + distance(q, target) / topSpeed(s, q) - duration);
      const t = ((q.x - qb.x) * lx + (q.y - qb.y) * ly) / Math.max(length2, 1);
      if (type !== 'LOB' && t > .2 && t < .9 && Math.hypot(qb.x + lx * t - q.x, qb.y + ly * t - q.y) < 1.4) blocked = true;
    }
    if (blocked) { room = Math.min(room, .5); margin = Math.min(margin, -.5); }
    const gain = (target.y - s.line) * d, lead = nearest ? norm(target.x - nearest.x, target.y - nearest.y) : { x: 0, y: 0 };
    return { r, type, room, margin, score: room * .6 + Math.min(margin, .8) * 3 + gain * (tactics.aggression * .06 + (gun ? .04 : 0)) + (hurry && Math.abs(target.x) > 14 ? 1.2 : 0) - (gain < -4 ? 2 : 0), lead: { x: lead.x * d * .4, y: -lead.y * d * .4 } };
  };
  const openRoom = (play.quick ? 1.4 : 1.7) - tactics.aggression * .4 + [-.3, 0, .2][lvl];
  // A Gunslinger's faster bullets already shorten `duration`, so more windows
  // read as open; trusting tighter windows on top of that double-counts.
  const isOpen = e => e.room > openRoom + (e.type === 'LOB' ? 1 : 0) && e.margin > (e.type === 'LOB' ? .25 : .05);
  if (s.read < reads.length) {
    const current = evaluate(reads[s.read]);
    if (isOpen(current) || (pressured && current.room > 1.4 && current.margin > -.1)) { throwTo(s, qb, current.r, current.lead, current.type); return; }
    s.readTime += dt;
    if (s.readTime > scale(awr, 1, .5) * [1.3, 1, .85][lvl]) { s.read++; s.readTime = 0; }
    const heat = nearestOpponent(s, qb, scale(awr, 2.6, 4.2)) !== null && s.snapTime > 2;
    if (!pressured && !heat && s.snapTime < 3.4) return;
  }
  let best = null;
  for (const slot of [1, 2, 3]) { const e = evaluate(slot); if (!best || e.score > best.score) best = e; }
  if (best.room > (pressured ? 1.4 : 1.5) && best.margin > (pressured ? -.05 : 0)) { throwTo(s, qb, best.r, best.lead, best.type); return; }
  if (!pressured && s.snapTime < 4.2 && !(nearestOpponent(s, qb, 3.5) && s.snapTime > 3)) return;
  if (pressured && s.snapTime - s.pressureAt < scale(awr, .95, .42) * [1.3, 1, .8][lvl]) return;
  if ((qb.y - s.line) * d > -9 && random(s) < scale(rating(s, qb, 'spd'), .15, .6)) { keeper(s, qb, `${who(s, qb)} SCRAMBLES`); feedback(s, 'skill', .4, s.message); return; }
  throwAway(s, qb);
}
function cpuKicker(s) {
  if (!s.special || s.kicked) return;
  const kicker = s.players[s.carrier];
  const human = s.human[s.offense] && ctrl(s, s.offense).controlled === kicker?.id;
  // A human kicker who never swings gets the ball kicked for him at the delay-of-game limit.
  if (!kicker || kicker.id !== kickerOf(s, s.offense).id || s.snapTime < (human ? 6 : isKickoff(s.special) ? 1 : 1.25)) return;
  if (human) dropCharge(ctrl(s, s.offense));
  let power = 1;
  if (s.special === 'punt') { const toGoal = FIELD - kicker.y * direction(s.offense), max = scale(rating(s, kicker, 'kpw'), 36, 56) * (spec(s, kicker, 'big_leg') ? 1.12 : 1); power = clamp((toGoal - 6) / max, .55, 1); }
  kickBall(s, kicker, power, 0);
}
function runAI(s, dt) {
  const carrier = s.players[s.carrier] || null, flight = s.ball.flight, play = currentPlay(s, s.offense), defense = currentPlay(s, 1 - s.offense);
  const loose = Boolean(flight?.fumble), holding = Boolean(s.special) && !s.kicked && isKickoff(s.special), runRecognized = s.runAt >= 0 ? s.snapTime - s.runAt : -1;
  for (const p of s.players) {
    if (s.human[p.team] && p.id === ctrl(s, p.team).controlled) continue;
    if (p.stun > 0 || p.recover > 0) { p.wishX = 0; p.wishY = 0; continue; }
    const speed = topSpeed(s, p) * (p.burst > 0 ? 1.1 : 1);
    if (loose) { if (distance(p, s.ball) < 16) moveToward(p, s.ball, speed, dt); else moveToward(p, p, 0, dt); continue; }
    if (holding) { moveToward(p, p, 0, dt); continue; }
    if (flight?.kick) { kickCoverage(s, p, flight, speed, dt); continue; }
    if (p.team === s.offense) offenseAI(s, p, play, carrier, speed, dt);
    else defenseAI(s, p, play, defense, carrier, speed, runRecognized, dt);
  }
  cpuQuarterback(s, play, dt); cpuKicker(s);
}
// --------------------------------------------------------------------- step
// Controllers: undefined or one input drives team 0; { teams: [a, b] } drives
// each non-null team; watch mode leaves both teams to the CPU. Team 0's
// controller (or the first present) operates shared screens.
function controllers(s, raw) {
  const pad = input => input ? { ...blankInput, ...input } : null;
  const pads = raw?.teams ? [pad(raw.teams[0]), pad(raw.teams[1])] : [pad(raw || blankInput), null];
  return { pads: s.mode === 'watch' ? [null, null] : pads, menu: pads[0] || pads[1] || { ...blankInput } };
}
// Legacy aliases support saved/replayed keyboard inputs; production input has
// the explicit receiver names, so contextual face buttons never overlap here.
const receiverInput = (edges, button) => Boolean(edges[button] ?? (button === 'receiverA' ? edges.pass : button === 'receiverX' ? edges.shoot : false));
const dropCharge = c => { c.charging = false; c.receiverButton = null; c.throwHold = 0; c.charge = 0; };
const continuation = s => isKickoff(s.special) ? { kickoff: s.offense, free: s.special === 'free' } : { team: s.offense, spot: s.line, down: s.down, target: s.target, conversion: s.conversion };
function tickClock(s, dt) {
  if (!s.running) return;
  s.time = Math.max(0, s.time - dt);
  if (s.time <= 0) { if (s.phase === 'dead') endQuarter(s); }
  else if (s.phase !== 'live') warning(s);
}
function controlActions(s, team, input, dt) {
  const c = ctrl(s, team), d = direction(s.offense), controlled = s.players[c.controlled], offense = s.offense === team;
  const kicking = offense && Boolean(s.special) && !s.kicked && s.carrier === controlled.id;
  const quarterback = offense && s.carrier === controlled.id && !s.thrown && !s.handoffPending && !s.special;
  if (input.pressed.switch && !quarterback && !kicking && (!offense || s.ball.flight)) switchPlayer(s, team);
  if (quarterback && (controlled.y - s.line) * d > .5) { keeper(s, controlled, 'QB KEEPER'); dropCharge(c); }
  for (let i = 0; i < 3; i++) if (!receiverInput(input.held, RECEIVERS[i]) && !input.cancelled?.[RECEIVERS[i]]) c.receiverReady[i] = true;
  c.passReady = c.receiverReady[0];
  if (quarterback && !s.thrown) {
    if (c.receiverButton && input.cancelled?.[c.receiverButton]) { c.receiverReady[RECEIVERS.indexOf(c.receiverButton)] = false; dropCharge(c); }
    if (!c.charging) {
      const button = RECEIVERS.find((key, i) => c.receiverReady[i] && !input.cancelled?.[key] && (receiverInput(input.pressed, key) || receiverInput(input.held, key)));
      if (button) { c.receiverButton = button; c.charging = true; c.throwHold = 0; }
    }
    if (c.charging) {
      c.throwHold += dt; c.charge = clamp(c.throwHold / .65, 0, 1);
      if (receiverInput(input.released, c.receiverButton) || !receiverInput(input.held, c.receiverButton)) {
        if (!s.thrown && (controlled.y - s.line) * d <= .5) throwTo(s, controlled, s.players[indexOf(team, RECEIVERS.indexOf(c.receiverButton) + 1)], input.aim || input.move, passType(c.throwHold));
        else s.message = 'PAST THE LINE — RUN IT IN';
        dropCharge(c);
      }
    }
  }
  // Kicks: hold A to fill the power meter, release to kick; the left stick aims.
  if (kicking) {
    if (!c.charging && c.receiverReady[0] && !input.cancelled?.receiverA && (receiverInput(input.pressed, 'receiverA') || receiverInput(input.held, 'receiverA'))) { c.receiverButton = 'receiverA'; c.charging = true; c.throwHold = 0; }
    if (c.charging) {
      c.throwHold += dt; c.charge = clamp(c.throwHold, 0, 1);
      if (receiverInput(input.released, 'receiverA') || !receiverInput(input.held, 'receiverA')) { kickBall(s, controlled, Math.max(.2, c.charge), input.move.x * d); dropCharge(c); }
    }
  }
  // In-flight A reaches without lunging. On defense A is a controlled wrap;
  // X commits momentum to a dive and can miss with a recovery cost.
  if (!quarterback && !kicking && s.carrier !== controlled.id && controlled.diveCooldown === 0) {
    if (input.pressed.conservativeTackle) {
      if (s.ball.flight) c.tackleWindow = .35;
      else { controlled.wrapTime = .35; controlled.diveCooldown = .65; feedback(s, 'skill', .2, 'BREAK DOWN · WRAP UP'); }
    }
    if (input.pressed.tackle && controlled.diveCooldown === 0) {
      const target = s.players[s.carrier] || s.ball, moving = Math.hypot(input.move.x, input.move.y) > .15;
      beginDive(controlled, moving ? { x: input.move.x * d, y: -input.move.y * d } : { x: target.x - controlled.x, y: target.y - controlled.y });
      c.tackleWindow = .27; c.tackleCooldown = 1.25; feedback(s, 'skill', .25, s.ball.flight ? 'REACH FOR THE BALL' : 'COMMIT TO THE TACKLE');
    }
  }
}
function controlMovement(s, team, input, dt) {
  const c = ctrl(s, team), d = direction(s.offense), controlled = s.players[c.controlled], carrying = s.carrier === controlled.id;
  controlled.protect = Boolean(input.held.shield && carrying);
  const sprinting = Boolean(input.held.sprint && !controlled.protect), moving = Math.hypot(input.move.x, input.move.y);
  if (sprinting && moving > .2) controlled.stamina = Math.max(0, controlled.stamina - dt * .26);
  const skillDirection = input.gesture || input.skillDirection || input.move;
  if ((input.pressed.skill || input.pressed.spin) && carrying && !c.charging) {
    if (controlled.jukeCooldown > 0 || controlled.stamina < .28) feedback(s, 'denied', .2, controlled.stamina < .28 ? 'LOW STAMINA' : 'LET YOUR FEET RESET');
    else {
      controlled.moveWon = false;
      if (!input.pressed.spin && Math.abs(skillDirection.x) > .25) juke(s, controlled, Math.sign(skillDirection.x));
      else if (input.pressed.spin && s.thrown && controlled.stamina >= .36) { controlled.spinTime = .5; controlled.jukeCooldown = 1.35; controlled.stamina -= .36; feedback(s, 'skill', .55, 'SPIN · BEAT THE GLANCING HIT'); }
      else if (input.pressed.spin && s.thrown) feedback(s, 'denied', .2, 'LOW STAMINA FOR SPIN');
    }
  }
  if (input.pressed.stiffArm && carrying && s.thrown && controlled.stiffCooldown === 0 && controlled.stamina >= .14) {
    controlled.stiffTime = .24; controlled.stiffCooldown = 1; controlled.moveWon = false; controlled.stamina -= .14;
    feedback(s, 'skill', .3, 'STIFF ARM · MEET THE DEFENDER');
  }
  controlled.strafe = Boolean(input.held.strafe && s.offense !== team);
  const unit = moving > 1 ? 1 / moving : 1, top = topSpeed(s, controlled);
  let speed = controlled.wrapTime > 0 ? 4.8 : controlled.strafe || controlled.protect ? top * .72 : sprinting ? top + 1.5 * Math.sqrt(controlled.stamina) : top;
  if (carrying && spec(s, controlled, 'burner') && Math.abs(controlled.y - s.line) > 10 && !nearestOpponent(s, controlled, 2.5)) speed *= 1.08;
  controlled.wishX = input.move.x * unit * d * speed; controlled.wishY = -input.move.y * unit * d * speed;
  if (moving > .2 && controlled.diveTime === 0) { const n = norm(controlled.wishX, controlled.wishY); controlled.facingX = n.x; controlled.facingY = n.y; }
  if (controlled.strafe) { const target = s.players[s.carrier] || s.ball, facing = norm(target.x - controlled.x, target.y - controlled.y); controlled.facingX = facing.x; controlled.facingY = facing.y; }
  if (controlled.jukeTime > 0) { controlled.wishX = controlled.jukeX * 12.8; controlled.wishY *= .88; const n = Math.hypot(controlled.wishX, controlled.wishY); if (n > 13.4) { controlled.wishX *= 13.4 / n; controlled.wishY *= 13.4 / n; } }
  if (controlled.spinTime > 0) { controlled.wishX *= .8; controlled.wishY *= .8; }
  if ((s.handoffPending && controlled.id === indexOf(s.offense, 0)) || (s.special && !s.kicked && carrying)) { controlled.wishX *= .25; controlled.wishY *= .25; }
}
function step(s, dt, raw = blankInput) {
  const { pads, menu } = controllers(s, raw);
  dt = clamp(dt, 0, .05); s.frame += 1; s.human = [pads[0] !== null, pads[1] !== null];
  if (s.phase === 'setup') { if (stepSetup('football', s.setup, menu.pressed)) startMatch(s); return; }
  if (s.phase === 'finished') { if (menu.pressed.rematch || menu.pressed.confirm) startMatch(s); else if (menu.pressed.back) { s.phase = 'setup'; s.message = 'TEAM SELECT'; } return; }
  s.phaseTime += dt;
  if (s.phase === 'dead') {
    tickClock(s, dt * 5); cpuClock(s);
    for (const team of [0, 1]) if (pads[team]?.pressed.timeout) callTimeout(s, team);
    if (menu.pressed.confirm && s.running && s.phaseTime < s.deadTime) tickClock(s, (s.deadTime - s.phaseTime) * 5);
    if (s.phaseTime >= s.deadTime || menu.pressed.confirm) beginNext(s);
    return;
  }
  if (s.phase === 'select') {
    tickClock(s, dt); cpuClock(s);
    if (s.time <= 0 && !s.conversion) { dead(s, s.lastResult, continuation(s)); return; }
    for (const team of [0, 1]) {
      const pad = pads[team];
      if (!pad) continue;
      const n = playbook(s, team).length;
      if (pad.pressed.left) s.calls[team] = (s.calls[team] + n - 1) % n;
      if (pad.pressed.right) s.calls[team] = (s.calls[team] + 1) % n;
      if (pad.pressed.left || pad.pressed.right) { s.callNames[team] = playbook(s, team)[s.calls[team]].name; formation(s); }
      if (pad.pressed.timeout) callTimeout(s, team);
      if ((pad.pressed.confirm || receiverInput(pad.pressed, 'receiverA')) && team === s.offense) { snap(s); return; }
    }
    s.playClock -= dt;
    if (s.playClock <= 0 || (!s.human[s.offense] && s.phaseTime >= s.snapAt)) snap(s);
    return;
  }
  s.snapTime += dt; s.catchProtection = Math.max(0, s.catchProtection - dt);
  for (const team of [0, 1]) { const c = ctrl(s, team); c.tackleCooldown = Math.max(0, c.tackleCooldown - dt); c.tackleWindow = Math.max(0, c.tackleWindow - dt); }
  tickClock(s, dt);
  for (const p of s.players) {
    p.stun = Math.max(0, p.stun - dt); p.jukeCooldown = Math.max(0, p.jukeCooldown - dt); p.jukeTime = Math.max(0, p.jukeTime - dt); p.hitCooldown = Math.max(0, p.hitCooldown - dt);
    for (const key of ['spinTime', 'stiffTime', 'stiffCooldown', 'diveCooldown', 'recover', 'wrapTime', 'engage', 'burst']) p[key] = Math.max(0, p[key] - dt);
    if (p.diveTime > 0) { p.diveTime = Math.max(0, p.diveTime - dt); if (p.diveTime === 0) { p.recover = .42; if (!p.diveHit && s.human[p.team] && p.id === ctrl(s, p.team).controlled) feedback(s, 'denied', .3, 'MISSED TACKLE · RECOVER'); } }
    p.protect = false; p.stamina = Math.min(1, p.stamina + dt * .13);
  }
  for (const team of [0, 1]) if (pads[team]) controlActions(s, team, pads[team], dt);
  if (s.phase !== 'live') return;
  runAI(s, dt);
  if (s.phase !== 'live') return;
  for (const team of [0, 1]) if (pads[team]) controlMovement(s, team, pads[team], dt);
  for (const p of s.players) {
    if (p.diveTime > 0) { p.wishX = p.diveX * 11.5; p.wishY = p.diveY * 11.5; }
    if (p.stun > 0 || p.recover > 0) { p.wishX = 0; p.wishY = 0; }
  }
  integrateAthletes(s, dt); collideAthletes(s, dt);
  if (s.phase !== 'live') return;
  handoff(s, dt); advanceBall(s, dt);
  if (s.phase !== 'live') return;
  if (s.carrier >= 0) {
    const carrier = s.players[s.carrier], attack = direction(s.offense);
    if (carrier.y * attack >= FIELD) { touchdown(s); return; }
    if (Math.abs(carrier.x) >= 24.7 || carrier.y * attack <= -(FIELD + 8.8)) { endPlay(s, false, 'OUT OF BOUNDS'); return; }
  }
  if (s.snapTime > 26) endPlay(s, s.carrier < 0, 'PLAY CLOCK');
}
function cancelInput(s) {
  cancelController(s); cancelController(s.away);
  for (const p of s.players) { p.protect = false; p.wishX = 0; p.wishY = 0; }
}
// ---------------------------------------------------------------------- HUD
function statLine(v) {
  const parts = [];
  if (v.att) parts.push(`${v.comp}/${v.att} · ${v.passYds} PASS YDS${v.passTd ? ` · ${v.passTd} TD` : ''}`);
  if (v.rushAtt) parts.push(`${v.rushYds} RUSH YDS${v.rushTd ? ` · ${v.rushTd} TD` : ''}`);
  if (v.rec) parts.push(`${v.rec} REC · ${v.recYds} YDS${v.recTd ? ` · ${v.recTd} TD` : ''}`);
  if (v.tackles) parts.push(`${v.tackles} TKL`); if (v.sacks) parts.push(`${v.sacks} SACK`); if (v.ints) parts.push(`${v.ints} INT`); if (v.ffum) parts.push(`${v.ffum} FF`);
  if (v.fgMade) parts.push(`${v.fgMade}/${v.fgAtt} FG`); if (v.retYds) parts.push(`${v.retYds} RET YDS`);
  return parts.join(' · ') || 'STEADY';
}
function summary(s) {
  const st = s.stats, row = (label, f) => [label, f(0), f(1)];
  const rows = [row('TOTAL YARDS', t => st.passYds[t] + st.rushYds[t]), row('PASSING', t => `${st.passComp[t]}/${st.passAtt[t]} · ${st.passYds[t]} YDS`), row('RUSHING', t => `${st.rushAtt[t]} · ${st.rushYds[t]} YDS`),
    row('FIRST DOWNS', t => st.firstDowns[t]), row('SACKS', t => st.sacks[t]), row('TURNOVERS', t => st.ints[1 - t] + st.fumblesLost[t]), row('FIELD GOALS', t => `${st.fgMade[t]}/${st.fgAtt[t]}`), row('PUNTS', t => st.punts[t])];
  let star = s.players[0], best = -Infinity;
  for (const p of s.players) {
    const v = p.stats, score = v.passYds * .04 + v.passTd * 4 - v.picked * 2 + v.rushYds * .1 + v.rushTd * 6 + v.recYds * .1 + v.rec * .5 + v.recTd * 6 + v.tackles + v.sacks * 3 + v.ints * 5 + v.ffum * 3 + v.breakups + v.fgMade * 2 + v.retYds * .05;
    if (score > best) { best = score; star = p; }
  }
  return { rows, star: { name: who(s, star), team: star.team, line: statLine(star.stats) } };
}
function hud(s, team = 0) {
  const c = ctrl(s, team), offense = s.offense === team, me = s.players[c.controlled], d = direction(s.offense), play = currentPlay(s, team), list = playbook(s, team);
  const yards = Math.max(1, Math.ceil((s.target - s.line) * d)), ordinal = ['', '1ST', '2ND', '3RD', '4TH'][s.down];
  const label = s.phase === 'finished' ? 'FINAL' : s.phase === 'setup' ? 'TEAM SELECT' : isKickoff(s.special) ? `${s.special === 'free' ? 'FREE KICK' : 'KICKOFF'} · ${short(s, s.offense)}` : s.conversion ? `CONVERSION · ${short(s, s.offense)}` : `${ordinal} & ${Math.abs(s.target) === FIELD ? 'GOAL' : yards} · ${short(s, s.offense)} BALL`;
  const kicking = offense && Boolean(s.special) && !s.kicked;
  const canThrow = offense && !s.thrown && !s.handoffPending && !s.special && !play.run && !play.kick && !s.newPossession && (s.phase === 'live' || s.phase === 'select');
  const kickName = s.special === 'punt' ? 'PUNT' : isKickoff(s.special) ? 'KICKOFF' : s.special === 'pat' ? 'EXTRA POINT' : 'FIELD GOAL';
  let detail, skillHint;
  if (s.phase === 'setup') { detail = 'D-pad / arrows: choose · A / Enter: kick off'; skillHint = 'Pick the mode, both teams and the difficulty'; }
  else if (s.phase === 'select') { detail = offense ? '← / → or D-pad: play • A / J / Enter: snap • View / T: timeout' : '← / → or D-pad: coverage • A / J / Enter: ready • View / T: timeout'; skillHint = `${play.name}${play.reads ? ` · reads ${play.reads.map(i => RECEIVER_LABELS[i - 1]).join(' → ')}` : ''}`; }
  else if (s.phase === 'dead') { detail = 'A new play is lining up • Enter: skip replay pause'; skillHint = s.lastResult; }
  else if (s.phase === 'finished') { detail = 'Enter: rematch • B / Backspace: change teams'; skillHint = s.message; }
  else if (kicking) { detail = 'Hold A / J: power • release: kick • LS: aim'; skillHint = `${kickName} · ${who(s, kickerOf(s, team))} · hold for power`; }
  else if (s.ball.flight) { detail = 'B / Q: switch • A / J: reach • X / K: dive • Left stick: move'; skillHint = 'B switch · A reach'; }
  else if (offense) {
    detail = s.handoffPending ? 'Automatic handoff · follow your lead blocker' : s.thrown ? 'RS sideways: juke · B / U: spin · A / J: stiff arm · RB / C: protect · RT: sprint' : 'A / J · B / U · X / K: receiver • Tap: lob · Brief hold: touch · Hold: bullet • LS: lead';
    skillHint = !s.thrown ? (play.run ? 'Run play · handoff happens automatically' : c.charging ? `${RECEIVER_LABELS[RECEIVERS.indexOf(c.receiverButton)]} · ${passType(c.throwHold)} · release to throw` : 'A/B/X receiver · LS lead · tap lob / hold bullet') : 'RS side: juke · B: spin · A: stiff arm · RB: protect';
  } else { detail = 'B / Q: switch · X / K / L: dive tackle · A / J: wrap tackle · LT / V: strafe · RT: sprint'; skillHint = 'A wraps under control · X dives with recovery'; }
  const flash = s.actionMessage && s.frame < s.actionMessage.until ? s.actionMessage.text : null;
  const message = s.phase === 'setup' ? 'IRON LEAGUE · 7v7' : s.phase === 'select' ? flash || (s.human[team] ? (offense ? 'CHOOSE YOUR PLAY' : 'SET YOUR DEFENSE') : `${short(s, s.offense)} · ${currentPlay(s, s.offense).name}`) : s.phase === 'live' && flash ? flash : s.message;
  return { score: [...s.score], teamNames: s.teams.map(t => t.short), teams: s.teams.map(t => ({ name: t.name, short: t.short, primary: t.primary, secondary: t.secondary, ovr: t.ovr })),
    clock: s.time, period: s.half ? 'HALF' : `Q${s.quarter}`, timeouts: [...s.timeouts], mode: s.mode, label, message, detail, skillHint,
    power: c.charge, charging: c.charging, stamina: me.stamina, skillReady: me.jukeCooldown === 0 && me.stamina >= .28,
    passType: c.charging && !kicking ? passType(c.throwHold) : null, selectedReceiver: c.receiverButton && !kicking ? RECEIVER_LABELS[RECEIVERS.indexOf(c.receiverButton)] : null,
    receiverIcons: canThrow ? [1, 2, 3].map((slot, i) => ({ button: RECEIVER_LABELS[i], player: indexOf(team, slot) })) : [],
    finished: s.phase === 'finished', plays: s.phase === 'select' ? list.map(p => p.name) : undefined, selectedPlay: s.calls[team],
    selected: [s.controlled, s.away.controlled], athlete: athleteCard('football', profile(s, me)), setup: s.phase === 'setup' ? setupHud('football', s.setup) : null,
    summary: s.phase === 'finished' ? summary(s) : null, ticker: s.events.slice(-4).reverse().map(({ text, team: t }) => ({ text, team: t })) };
}
// ---------------------------------------------------------------- rendering
function paintField(canvas, names) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#187851'; ctx.fillRect(0, 0, 1024, 2048);
  const sx = 1024 / 50, sy = 2048 / 120;
  for (let n = 0; n < 10; n++) { ctx.fillStyle = n % 2 ? '#1c8058' : '#18714e'; ctx.fillRect(0, (10 + n * 10) * sy, 1024, 10 * sy); }
  ctx.fillStyle = '#12b7ac'; ctx.fillRect(0, 0, 1024, 10 * sy);
  ctx.fillStyle = '#d8572b'; ctx.fillRect(0, 110 * sy, 1024, 10 * sy);
  ctx.strokeStyle = 'rgba(235,255,243,.8)'; ctx.lineWidth = 3;
  for (let n = 10; n <= 110; n += 5) { ctx.beginPath(); ctx.moveTo(0, n * sy); ctx.lineTo(1024, n * sy); ctx.stroke(); }
  ctx.lineWidth = 6; ctx.strokeRect(3, 10 * sy, 1018, 100 * sy);
  ctx.lineWidth = 2;
  for (let n = 11; n < 110; n++) for (const x of [2, 18, 32, 48]) { ctx.beginPath(); ctx.moveTo(x * sx, n * sy); ctx.lineTo((x + .8) * sx, n * sy); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 52px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.78)';
  for (let n = 20; n < 110; n += 10) { const label = String(Math.min(n - 10, 110 - n)); ctx.fillText(label, 8 * sx, n * sy); ctx.save(); ctx.translate(42 * sx, n * sy); ctx.rotate(Math.PI); ctx.fillText(label, 0, 0); ctx.restore(); }
  ctx.font = '900 83px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillText(names[1], 512, 5 * sy);
  ctx.save(); ctx.translate(512, 115 * sy); ctx.rotate(Math.PI); ctx.fillText(names[0], 0, 0); ctx.restore();
  ctx.fillStyle = 'rgba(240,255,248,.12)'; ctx.beginPath(); ctx.arc(512, 1024, 122, 0, Math.PI * 2); ctx.fill();
  ctx.font = '900 115px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.38)'; ctx.fillText('A', 512, 1024);
}
function paintNumber(canvas, number, color) {
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = color; ctx.font = '900 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(number), 32, 34);
}
function buildScene({ THREE, scene, camera }) {
  scene.background = new THREE.Color('#08192b');
  scene.fog = new THREE.Fog('#08192b', 125, 260);
  const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .75, ...options });
  const mesh = (geometry, material, x, y, z, parent = scene) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m; };
  scene.add(new THREE.HemisphereLight('#d9faff', '#153d32', 2.1));
  const key = new THREE.DirectionalLight('#e6f5ff', 2.5); key.position.set(-25, 65, 25); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffa76f', .9); rim.position.set(30, 25, -60); scene.add(rim);
  mesh(new THREE.BoxGeometry(260, 1, 270), mat('#102a32'), 0, -.7, 0);
  const fieldCanvas = document.createElement('canvas'); fieldCanvas.width = 1024; fieldCanvas.height = 2048; paintField(fieldCanvas, ['HOME', 'AWAY']);
  const fieldTexture = new THREE.CanvasTexture(fieldCanvas); fieldTexture.colorSpace = THREE.SRGBColorSpace; fieldTexture.anisotropy = 4;
  const turf = mesh(new THREE.PlaneGeometry(50, 120), new THREE.MeshStandardMaterial({ map: fieldTexture, roughness: 1 }), 0, .02, 0); turf.rotation.x = -Math.PI / 2;
  // A broad track and bright sidelines give the playing surface a crisp silhouette.
  const track = mesh(new THREE.PlaneGeometry(62, 132), mat('#203d48'), 0, 0, 0); track.rotation.x = -Math.PI / 2;
  for (const x of [-26, 26]) mesh(new THREE.BoxGeometry(.25, .12, 120), mat('#e1fff8'), x, .08, 0);
  const jerseys = [mat('#13d6c4', { emissive: '#0c5e59', emissiveIntensity: .4 }), mat('#ff753f', { emissive: '#6a2711', emissiveIntensity: .3 })];
  const helmets = [mat('#0c3f45'), mat('#4a1f12')];
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 6; tier++) mesh(new THREE.BoxGeometry(5, 1.5, 128), mat(tier % 2 ? '#18384e' : '#24485c'), side * (34 + tier * 4), tier * 1.7 + .7, 0);
    mesh(new THREE.BoxGeometry(.7, 1.5, 130), jerseys[side < 0 ? 0 : 1], side * 30, 1.5, 0);
    for (const z of [-66, 66]) mesh(new THREE.BoxGeometry(58, 3, 4), mat('#15364b'), 0, 1.5, z);
  }
  // Instancing keeps the crowd lively without hundreds of draw calls.
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(.65, 1.1, .65), mat('#83b9cc'), 456);
  const dummy = new THREE.Object3D(); const crowdColor = new THREE.Color(); let index = 0;
  for (const side of [-1, 1]) for (let tier = 0; tier < 6; tier++) for (let n = 0; n < 38; n++) {
    dummy.position.set(side * (34 + tier * 4), tier * 1.7 + 2, (n - 18.5) * 3.2); dummy.rotation.y = (n % 3) * .2; dummy.updateMatrix(); crowd.setMatrixAt(index, dummy.matrix);
    crowdColor.set([0x58b8c3, 0xf58956, 0xc5d6db, 0x214964, 0xe9c76d][(n + tier * 3) % 5]); crowd.setColorAt(index++, crowdColor);
  }
  scene.add(crowd);
  for (const x of [-29, 29]) for (const z of [-52, 52]) {
    mesh(new THREE.CylinderGeometry(.22, .4, 24, 8), mat('#b4c9d5'), x, 12, z);
    mesh(new THREE.BoxGeometry(6, 1.6, 1), mat('#efffff', { emissive: '#d6f8ff', emissiveIntensity: 2 }), x, 24, z);
  }
  // Goalposts on both end lines: a gooseneck, the crossbar at 10 ft and uprights.
  const gold = mat('#ffd84a', { emissive: '#7a5a00', emissiveIntensity: .5 });
  for (const z of [-60, 60]) {
    mesh(new THREE.CylinderGeometry(.16, .2, BAR, 8), gold, 0, BAR / 2, z + Math.sign(z) * 1.6);
    mesh(new THREE.BoxGeometry(POST * 2 + .3, .18, .18), gold, 0, BAR, z);
    for (const x of [-POST, POST]) mesh(new THREE.CylinderGeometry(.12, .12, 10, 8), gold, x, BAR + 5, z);
  }
  // Goal-line pylons, chain markers, benches, and coach boxes supply scale.
  for (const x of [-24.6, 24.6]) for (const z of [-50, 50]) mesh(new THREE.BoxGeometry(.55, 1.15, .55), jerseys[1], x, .6, z);
  for (const x of [-29, 29]) for (const z of [-15, 15]) {
    mesh(new THREE.BoxGeometry(1, .55, 7), mat('#b2ccd4'), x, .8, z);
    mesh(new THREE.BoxGeometry(1, .8, 7), mat('#335269'), x, 1.3, z);
  }
  const players = []; const skin = mat('#b77f5c'); const dark = mat('#18232d'); const white = mat('#f0f8f8');
  for (let i = 0; i < 14; i++) {
    const team = Math.floor(i / 7); const group = new THREE.Group(); scene.add(group);
    const jersey = jerseys[team];
    mesh(new THREE.BoxGeometry(1.1, .95, .65), jersey, 0, 1.32, 0, group);
    mesh(new THREE.BoxGeometry(1.65, .4, .75), jersey, 0, 1.66, 0, group);
    mesh(new THREE.SphereGeometry(.44, 12, 10), helmets[team], 0, 2.13, 0, group);
    mesh(new THREE.BoxGeometry(.59, .23, .12), dark, 0, 2.06, -.38, group);
    mesh(new THREE.BoxGeometry(.64, .07, .14), white, 0, 1.95, -.44, group);
    const legs = [], arms = [];
    for (const sign of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sign * .31, .94, 0); group.add(leg);
      mesh(new THREE.BoxGeometry(.38, .65, .43), team === 0 ? white : mat('#fee3d1'), 0, -.27, 0, leg);
      mesh(new THREE.BoxGeometry(.29, .35, .31), skin, 0, -.68, 0, leg);
      mesh(new THREE.BoxGeometry(.4, .21, .62), dark, 0, -.84, -.1, leg); legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(sign * .76, 1.62, 0); group.add(arm);
      mesh(new THREE.BoxGeometry(.32, .7, .35), skin, 0, -.26, 0, arm);
      mesh(new THREE.BoxGeometry(.35, .19, .4), white, 0, -.65, 0, arm); arms.push(arm);
    }
    // Jersey numbers front and back come from the team profile; no licensed uniforms.
    const numberCanvas = document.createElement('canvas'); numberCanvas.width = 64; numberCanvas.height = 64;
    const numberTexture = new THREE.CanvasTexture(numberCanvas); numberTexture.colorSpace = THREE.SRGBColorSpace;
    const numberMaterial = new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true });
    const back = mesh(new THREE.PlaneGeometry(.6, .6), numberMaterial, 0, 1.38, .34, group);
    const front = mesh(new THREE.PlaneGeometry(.6, .6), numberMaterial, 0, 1.38, -.34, group); front.rotation.y = Math.PI;
    const shadow = mesh(new THREE.CircleGeometry(.95, 16), new THREE.MeshBasicMaterial({ color: '#001e20', transparent: true, opacity: .35, depthWrite: false }), 0, .05, 0, group); shadow.rotation.x = -Math.PI / 2;
    const receiverRing = mesh(new THREE.RingGeometry(1.65, 1.82, 36), new THREE.MeshBasicMaterial({ color: '#5dffd0', side: THREE.DoubleSide, transparent: true, opacity: .75 }), 0, .15, 0); receiverRing.rotation.x = -Math.PI / 2; receiverRing.visible = false;
    let receiverLabel = null;
    if (i % 7 > 0 && i % 7 < 4) {
      const icon = document.createElement('canvas'); icon.width = 128; icon.height = 128; const ctx = icon.getContext('2d');
      ctx.fillStyle = ['#27ba65', '#e84d53', '#3898f0'][i % 7 - 1]; ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.stroke(); ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText(RECEIVER_LABELS[i % 7 - 1], 64, 68);
      const texture = new THREE.CanvasTexture(icon); texture.colorSpace = THREE.SRGBColorSpace;
      receiverLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); receiverLabel.scale.set(2.1, 2.1, 1); receiverLabel.renderOrder = 5; receiverLabel.visible = false; scene.add(receiverLabel);
    }
    players.push({ group, legs, arms, receiverRing, receiverLabel, number: { canvas: numberCanvas, texture: numberTexture, back, front } });
  }
  const ball = mesh(new THREE.SphereGeometry(.42, 16, 10), mat('#a45a2c'), 0, 2, 0); ball.scale.set(.7, .7, 1.25);
  const ballStripe = mesh(new THREE.TorusGeometry(.27, .045, 5, 16), white, 0, 0, .25, ball); ballStripe.rotation.x = Math.PI / 2;
  const ring = mesh(new THREE.RingGeometry(1.1, 1.4, 40), new THREE.MeshBasicMaterial({ color: '#ffe45e', side: THREE.DoubleSide }), 0, .13, 0); ring.rotation.x = -Math.PI / 2;
  const pointer = mesh(new THREE.ConeGeometry(.33, .6, 3), new THREE.MeshBasicMaterial({ color: '#ffe45e' }), 0, 3, 0); pointer.rotation.z = Math.PI;
  const scrimmage = mesh(new THREE.BoxGeometry(50, .07, .18), new THREE.MeshBasicMaterial({ color: '#53c9ff', transparent: true, opacity: .75 }), 0, .1, 30);
  const firstDown = mesh(new THREE.BoxGeometry(50, .07, .2), new THREE.MeshBasicMaterial({ color: '#ffda47', transparent: true, opacity: .9 }), 0, .1, 20);
  const target = mesh(new THREE.RingGeometry(1.65, 1.9, 40), new THREE.MeshBasicMaterial({ color: '#ffe673', side: THREE.DoubleSide, transparent: true, opacity: .9 }), 0, .17, 0); target.rotation.x = -Math.PI / 2;
  const trajectory = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 25 }, () => new THREE.Vector3())), new THREE.LineDashedMaterial({ color: '#ffe673', dashSize: 1, gapSize: .6, transparent: true, opacity: .85 })); trajectory.frustumCulled = false; scene.add(trajectory);
  const routes = [];
  for (let i = 0; i < 3; i++) {
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 5 }, () => new THREE.Vector3())), new THREE.LineDashedMaterial({ color: '#6effea', dashSize: 1, gapSize: .55, transparent: true, opacity: .7 })); route.frustumCulled = false; scene.add(route); routes.push(route);
  }
  camera.fov = 49; camera.near = .1; camera.far = 350; camera.updateProjectionMatrix(); camera.position.set(0, 48, 60); camera.lookAt(0, 0, 15);
  return { THREE, players, ball, ring, pointer, scrimmage, firstDown, target, trajectory, routes, focus: 30, cameraDirection: null, jerseys, helmets, field: { canvas: fieldCanvas, texture: fieldTexture }, teamKey: null };
}
// Team colors, end-zone names and jersey numbers follow the selected profiles.
function dressTeams(s, v) {
  const key = `${s.teams[0].id}/${s.teams[1].id}`;
  if (v.teamKey === key || !v.jerseys) return;
  v.teamKey = key;
  for (const team of [0, 1]) { v.jerseys[team].color.set(s.teams[team].primary); v.jerseys[team].emissive.set(s.teams[team].secondary); v.helmets[team].color.set(s.teams[team].secondary); }
  if (v.field) { paintField(v.field.canvas, s.teams.map(t => t.short)); v.field.texture.needsUpdate = true; }
  for (const p of s.players) { const n = v.players[p.id].number; if (n) { paintNumber(n.canvas, profile(s, p).number, s.teams[p.team].secondary); n.texture.needsUpdate = true; } }
}
function render({ state: s, view: v, camera, dt }) {
  const { THREE } = v;
  dressTeams(s, v);
  const d = direction(s.offense), selecting = s.phase === 'select', humanOffense = s.human[s.offense] && s.mode !== 'watch', play = currentPlay(s, s.offense);
  for (const p of s.players) {
    const model = v.players[p.id]; model.group.position.set(p.x, 0, -p.y);
    const running = s.phase === 'live' ? Math.hypot(p.vx, p.vy) : 0;
    const desired = p.strafe ? Math.atan2(-p.facingX, p.facingY) : running > .2 ? Math.atan2(-p.vx, p.vy) : (p.team === s.offense ? d : -d) === 1 ? 0 : Math.PI;
    model.group.rotation.y = desired + (p.spinTime > 0 ? (1 - p.spinTime / .5) * Math.PI * 2 : 0);
    model.group.rotation.z = p.jukeTime > 0 ? -p.jukeX * .28 : p.hitCooldown > 0 ? Math.sin(p.hitCooldown * 30) * .15 : 0;
    model.group.rotation.x = p.diveTime > 0 ? .9 : p.recover > 0 ? .5 : p.protect ? .22 : p.stun > 0 ? -.3 : 0;
    const gait = Math.sin(s.frame * .24 + p.id) * Math.min(running / 9, 1) * .65;
    model.legs[0].rotation.x = gait; model.legs[1].rotation.x = -gait;
    model.arms[0].rotation.x = -gait * .8; model.arms[1].rotation.x = gait * .8;
    if (p.id === s.carrier) { model.arms[1].rotation.x = p.protect ? -1.65 : -1; model.arms[1].rotation.z = -.3; if (p.protect) model.arms[0].rotation.x = -1.5; } else model.arms[1].rotation.z = 0;
    if (s.ball.flight && distance(p, s.ball) < 3 && s.ball.z < 4.2) { model.arms[0].rotation.x = -2.4; model.arms[1].rotation.x = -2.4; }
    const eligible = p.team === s.offense && p.slot > 0 && p.slot < 4 && humanOffense && !s.thrown && !s.handoffPending && !s.special && !play.run && !play.kick;
    model.receiverRing.visible = eligible && s.phase === 'live';
    if (model.receiverLabel) {
      model.receiverLabel.visible = eligible && (selecting || s.phase === 'live');
      model.receiverLabel.position.set(p.x, 4.2, -p.y);
      const c = ctrl(s, p.team), selected = c.receiverButton === RECEIVERS[p.slot - 1]; model.receiverLabel.scale.setScalar(selected ? 2.8 : 2.1);
      model.receiverLabel.material.opacity = c.charging && !selected ? .55 : 1;
    }
    if (model.receiverRing.visible) {
      const room = nearestOpponent(s, p) ? distance(nearestOpponent(s, p), p) : 99;
      model.receiverRing.material.color.set(room > 2.4 ? '#5dffd0' : '#9bc3db'); model.receiverRing.material.opacity = room > 2.4 ? .85 : .28;
      model.receiverRing.position.set(p.x, .15, -p.y);
    }
    model.arms[0].rotation.z = p.stiffTime > 0 ? -.8 : 0; if (p.stiffTime > 0) model.arms[0].rotation.x = -1.5;
    model.group.position.y = running > .5 ? Math.abs(Math.sin(s.frame * .24 + p.id)) * .08 : 0;
    if (s.phase === 'dead' && /TOUCHDOWN|CONVERSION!|IS GOOD/.test(s.message) && p.team === s.offense) { model.arms[0].rotation.x = -2.6; model.arms[1].rotation.x = -2.6; model.group.position.y = Math.max(0, Math.sin(s.phaseTime * 7 + p.id)) * .4; }
  }
  v.ball.position.set(s.ball.x, s.ball.z, -s.ball.y); v.ball.rotation.x = s.ball.flight ? s.frame * .35 : 0;
  const human = s.mode !== 'watch' && (s.human[0] || !s.human[1]) ? 0 : s.human[1] ? 1 : s.offense, active = s.players[ctrl(s, human).controlled];
  v.ring.position.set(active.x, .14, -active.y); v.pointer.position.set(active.x, 3.25 + Math.sin(s.frame * .08) * .12, -active.y);
  v.ring.material.color.set(active.jukeTime > 0 || active.spinTime > 0 ? '#64fff0' : active.protect ? '#79b8ff' : active.stamina < .28 ? '#ff935c' : '#ffe45e');
  v.ring.scale.setScalar(1 + Math.sin(s.frame * .08) * .06); v.ring.visible = s.phase !== 'finished' && s.phase !== 'setup' && s.mode !== 'watch'; v.pointer.visible = v.ring.visible;
  v.scrimmage.position.z = -s.line; v.firstDown.position.z = -s.target;
  v.scrimmage.visible = !s.newPossession && !isKickoff(s.special); v.firstDown.visible = !s.newPossession && !s.conversion && !isKickoff(s.special);
  const f = s.ball.flight; v.target.visible = Boolean(f) && !f.fumble; v.trajectory.visible = false;
  if (f) v.target.position.set(f.tx, .18, -f.ty);
  // Route preview for a human offense while the play is being chosen.
  for (let i = 0; i < 3; i++) {
    const route = v.routes[i], waypoints = play.routes?.[i + 1];
    route.visible = selecting && humanOffense && Boolean(waypoints) && !play.run;
    if (route.visible) {
      const p = s.players[indexOf(s.offense, i + 1)], attr = route.geometry.attributes.position;
      attr.setXYZ(0, p.x, .18, -p.y);
      for (let k = 1; k < 5; k++) { const wp = waypoints[Math.min(k - 1, waypoints.length - 1)]; attr.setXYZ(k, wp[0] * d, .18, -clamp(s.line + wp[1] * d, -56, 56)); }
      attr.needsUpdate = true; route.computeLineDistances();
    }
  }
  const focusY = selecting ? s.line : s.ball.y;
  const targetZ = -clamp(focusY, -39, 39);
  const follow = Math.min(1, (dt || 1 / 60) * 3);
  if (v.cameraDirection === null) v.focus = targetZ;
  else v.focus += (targetZ - v.focus) * follow;
  const desired = new THREE.Vector3(s.ball.x * .28, 37, v.focus + 35 * d);
  if (v.cameraDirection === null) camera.position.copy(desired);
  else if (v.cameraDirection !== d) {
    // Possession changes ends. Reflect only the orbit offset now, so
    // screen-relative controls agree immediately while field tracking stays smooth.
    camera.position.z = v.focus + Math.max(24, Math.abs(camera.position.z - v.focus)) * d;
  }
  v.cameraDirection = d;
  camera.position.lerp(desired, follow); camera.lookAt(s.ball.x * .2, 0, v.focus - 8 * d);
}
export const footballDefinition = { id: 'football', title: 'Alder Gridiron', createState, validateState, cancelInput, step, buildScene, render, hud };
