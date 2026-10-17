import test from 'node:test';
import assert from 'node:assert/strict';
import { footballDefinition as game } from '../src/football.js';
import { SportsInput } from '../src/sports-input.js';
import { mergePendingInput } from '../src/sports-feedback.js';
import { sportsPhysicsObservations } from '../src/sports-physics.js';
import { has } from '../src/sports-league.js';
const idle = () => ({ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, held: {}, pressed: {}, released: {} });
function tick(s, seconds, input = idle()) { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.step(s, 1 / 60, input); }
function press(s, key, input = idle()) { input.pressed[key] = true; game.step(s, 1 / 60, input); }
function next(s) { press(s, 'confirm'); }
// A match where team 0 is the human and the opening kickoff has already been
// returned: team 0 lines up first-and-ten at `spot` with the play `call`.
function start(spot = -30, call = 2, options = {}) {
  const s = game.createState({ setup: false, seed: 7, ...options });
  s.phase = 'dead'; s.next = { team: 0, spot }; s.deadTime = 0; game.step(s, 1 / 60, idle());
  s.calls[0] = call; press(s, 'right'); press(s, 'left');
  assert.equal(s.phase, 'select'); assert.equal(s.offense, 0); assert.equal(s.line, spot);
  return s;
}
function finishRun(s, spot) { press(s, 'confirm'); s.players[s.carrier].x = 25; s.players[s.carrier].y = spot; game.step(s, 1 / 60, idle()); }
const playIndex = (s, name) => game.hud(s).plays.indexOf(name);
function kick(s, hold = 1.1, aim = 0) {
  game.step(s, 1 / 60, idle());
  const charge = idle(); charge.held.receiverA = true; charge.move.x = aim; tick(s, hold, charge);
  const release = idle(); release.released.receiverA = true; release.move.x = aim; game.step(s, 1 / 60, release);
}
function runUntil(s, predicate, seconds = 12, input = idle()) { for (let i = 0; i < seconds * 60 && !predicate(s); i++) game.step(s, 1 / 60, input); return predicate(s); }
const finished = s => { let n = 0; while (s.phase !== 'finished' && n++ < 200000) game.step(s, 1 / 60); return s; };

test('football starts a valid seven-a-side match and ignores the snap hold as a throw', () => {
  const s = start(); assert.equal(game.validateState(s), true); assert.equal(s.players.length, 14);
  const snap = idle(); snap.pressed.pass = true; snap.held.pass = true; game.step(s, 1 / 60, snap);
  const holding = idle(); holding.held.pass = true; tick(s, .3, holding);
  assert.equal(s.carrier, 0); assert.equal(s.charging, false);
  game.step(s, 1 / 60, idle()); tick(s, .3, holding); assert.ok(s.charge > .2);
  const release = idle(); release.released.pass = true; game.step(s, 1 / 60, release);
  assert.equal(s.carrier, -1); assert.ok(s.ball.flight); assert.ok(s.ball.flight.ty > s.ball.flight.y);
  assert.equal(s.stats.passAtt[0], 1); assert.equal(s.players[0].stats.att, 1);
});

test('the match opens with a kickoff by the away team and the human team select is the default entry', () => {
  const s = game.createState();
  assert.equal(s.phase, 'setup'); assert.equal(s.schema, 6); assert.equal(game.validateState(s), true);
  assert.equal(game.hud(s).setup.rows.length, 4); assert.equal(game.hud(s).mode, 'play');
  press(s, 'down'); press(s, 'right'); assert.deepEqual(s.setup.teams, [2, 1]);
  press(s, 'confirm');
  assert.equal(s.phase, 'select'); assert.equal(s.special, 'kickoff'); assert.equal(s.offense, 1); assert.equal(s.line, 15);
  assert.equal(s.teams[0].id, 'ironwood'); assert.equal(s.teams[1].id, 'canyon'); assert.equal(typeof s.teams[0].kicker, 'number');
  assert.deepEqual(game.hud(s).plays, ['RETURN']); assert.deepEqual(game.hud(s, 1).plays, ['KICKOFF']);
  assert.equal(game.hud(s).period, 'Q1'); assert.deepEqual(game.hud(s).timeouts, [2, 2]); assert.equal(game.hud(s).label, 'KICKOFF · CANYON');
});

test('a kickoff is caught and returned, the clock starts at the catch, and deep kicks are touchbacks', () => {
  const s = game.createState({ setup: false, mode: 'watch', seed: 3 });
  assert.ok(runUntil(s, x => x.ball.flight?.kick === 'kickoff', 4));
  assert.equal(s.stats.plays[1], 0, 'kickoffs are not offensive snaps'); assert.equal(s.running, false);
  assert.ok(runUntil(s, x => x.phase === 'dead', 12));
  assert.ok(/RETURN|TOUCHBACK|DOWNED/.test(s.message), s.message); assert.equal(s.next.team, 0);
  const deep = game.createState({ setup: false, mode: 'watch', seed: 3 });
  deep.teams[1].players[deep.teams[1].kicker].ratings.kpw = 99; deep.teams[1].players[deep.teams[1].kicker].specialties = ['big_leg'];
  assert.ok(runUntil(deep, x => x.phase === 'dead', 14)); assert.equal(deep.message, 'TOUCHBACK'); assert.equal(deep.next.spot, -25);
  next(deep); assert.equal(deep.line, -25); assert.equal(deep.offense, 0); assert.equal(deep.special, null);
});

test('first downs reset the series; four short plays turn the ball over at the spot', () => {
  const s = start(); finishRun(s, -18); assert.match(s.message, /FIRST DOWN/); assert.equal(s.stats.firstDowns[0], 1); next(s);
  assert.equal(s.down, 1); assert.equal(s.line, -18); assert.equal(s.target, -8);
  for (let down = 1; down <= 4; down++) { assert.equal(s.down, down); finishRun(s, -18); next(s); }
  assert.equal(s.offense, 1); assert.equal(s.down, 1); assert.equal(s.line, -18); assert.equal(s.target, -28); assert.ok(s.controlled < 7);
  assert.deepEqual(game.hud(s).plays, ['COVER 2', 'COVER 3', 'MAN', 'BLITZ', 'PREVENT']);
});

test('touchdowns offer a PAT kick or a two-point play, then the scoring team kicks off', () => {
  const s = start(); press(s, 'confirm'); s.players[0].y = 50.1; game.step(s, 1 / 60, idle());
  assert.deepEqual(s.score, [6, 0]); assert.match(s.message, /TOUCHDOWN! C\. HAVERFORD · \d+-YD RUN/); assert.equal(s.stats.tds[0], 1); next(s);
  assert.equal(s.conversion, true); assert.deepEqual(game.hud(s).plays.slice(0, 2), ['KICK PAT', 'INSIDE RUN']); assert.equal(s.line, 35);
  press(s, 'right'); assert.equal(s.line, 47, 'two-point tries snap from the 3');
  press(s, 'confirm'); s.players[s.carrier].y = 50.1; game.step(s, 1 / 60, idle());
  assert.deepEqual(s.score, [8, 0]); next(s); assert.equal(s.special, 'kickoff'); assert.equal(s.offense, 0); assert.equal(s.line, -15);
  const pat = start(); press(pat, 'confirm'); pat.players[0].y = 50.1; game.step(pat, 1 / 60, idle()); next(pat);
  press(pat, 'confirm'); assert.equal(pat.carrier, pat.teams[0].kicker, 'the kicker takes the snap');
  kick(pat); assert.equal(pat.ball.flight.kick, 'pat'); assert.ok(runUntil(pat, x => x.phase === 'dead', 5));
  assert.equal(pat.message, 'EXTRA POINT IS GOOD'); assert.deepEqual(pat.score, [7, 0]);
});

test('failed conversions do not grant points and the scoring team still kicks off', () => {
  const s = start(); press(s, 'confirm'); s.players[0].y = 51; game.step(s, 1 / 60, idle()); next(s); press(s, 'right');
  finishRun(s, 48); assert.equal(s.score[0], 6); assert.match(s.message, /CONVERSION STOPPED/); next(s); assert.equal(s.special, 'kickoff'); assert.equal(s.offense, 0);
});

test('A, B, X choose three distinct eligible receivers and right-stick aim cannot redirect a pass', () => {
  const throws = [];
  for (const button of ['receiverA', 'receiverB', 'receiverX']) {
    const s = start(-30, 3); press(s, 'confirm'); tick(s, 1);
    const original = structuredClone(s);
    for (const [state, rightStick] of [[s, 1], [original, -1]]) {
      const input = new SportsInput('football'), pad = { id: 'Test pad', index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      input.sample(new Set(), [pad]); const n = ['receiverA', 'receiverB', 'receiverX'].indexOf(button); pad.buttons[n] = { pressed: true, value: 1 }; pad.axes[2] = rightStick;
      for (let frame = 0; frame < 30; frame++) game.step(state, 1 / 60, input.sample(new Set(), [pad]));
      pad.buttons[n] = { pressed: false, value: 0 }; pad.axes[2] = 0; game.step(state, 1 / 60, input.sample(new Set(), [pad]));
    }
    assert.deepEqual(s.ball, original.ball, 'the real adapter right-stick input never changes the pass flight');
    assert.equal(s.controlled, 0, 'B receiver selection does not switch away from the QB');
    assert.ok(s.ball.flight); throws.push(s.ball.flight);
  }
  assert.deepEqual(throws.map(f => f.receiver), [1, 2, 3]);
  assert.ok(throws[1].tx < throws[2].tx); assert.ok(throws[2].tx > 8);
});

test('a defender can intercept a misplaced throw and return possession', () => {
  let s = null;
  for (let seed = 1; seed <= 12 && !s?.intercepted; seed++) {
    s = start(-30, 2, { seed }); press(s, 'confirm'); s.carrier = -1; s.thrown = true; s.playKind = 'pass'; s.passer = 0;
    for (const p of s.players) { p.x = 20; p.y = -40; }
    s.players[9].x = 0; s.players[9].y = 0; s.teams[1].players[2].ratings.cth = 99; s.teams[1].players[2].specialties = ['ballhawk'];
    s.ball = { x: 0, y: -.2, z: 1.7, carry: null, flight: { x: 0, y: -10, tx: 0, ty: 0, vx: 0, vy: 10, vz: -1, elapsed: .99, duration: 1, passer: 0, receiver: 2, type: 'BULLET' } };
    game.step(s, 1 / 60, idle()); assert.ok(s.intercepted || /BROKEN UP/.test(s.message), 'a defender alone at the ball picks it or knocks it down');
  }
  assert.equal(s.offense, 1); assert.equal(s.carrier, 9); assert.equal(s.intercepted, true); assert.match(s.message, /INTERCEPTION! K\. NAVARRO/);
  assert.equal(s.stats.ints[1], 1); assert.equal(s.players[9].stats.ints, 1); assert.equal(s.events.at(-1).kind, 'int');
  s.players[9].x = 25; game.step(s, 1 / 60, idle()); next(s); assert.equal(s.offense, 1); assert.equal(s.down, 1);
});

test('AI runs routes and pursues on defense, then chooses and executes its own plays', () => {
  const s = start(-30, 4); press(s, 'confirm'); const receiver = s.players[2].y, defender = s.players[11].y; tick(s, .6);
  assert.ok(s.players[2].y > receiver + 2); assert.notEqual(s.players[11].y, defender);
  const away = start(); for (let n = 0; n < 4; n++) { finishRun(away, -30); next(away); }
  assert.equal(away.offense, 1); assert.ok(runUntil(away, x => x.phase === 'live', 6)); assert.ok(away.calls[1] < 9);
  const positions = away.players.slice(7).map(p => p.y); tick(away, 2.5);
  assert.ok(away.players.slice(7).some((p, i) => Math.abs(p.y - positions[i]) > 3));
  assert.ok(away.ball.flight || away.thrown || away.phase === 'dead' || away.snapTime > 2);
});

test('JSON match snapshots continue exactly including in-flight passes and every new field', () => {
  const s = start(-30, 3); press(s, 'confirm'); game.step(s, 1 / 60, idle()); const i = idle(); i.held.pass = true; tick(s, .4, i); game.step(s, 1 / 60, idle());
  assert.ok(s.ball.flight); const restored = JSON.parse(JSON.stringify(s)); assert.equal(game.validateState(restored), true);
  for (let frame = 0; frame < 900; frame++) {
    const input = idle(); input.move = { x: Math.sin(frame * .1), y: -.7 }; input.pressed.switch = frame % 90 === 0; input.pressed.confirm = frame % 200 === 0; input.pressed.receiverB = frame % 130 === 0; input.released.receiverB = frame % 130 === 1;
    game.step(s, 1 / 60, input); game.step(restored, 1 / 60, input);
  }
  assert.deepEqual(restored, s); assert.ok(s.playNumber > 1);
});

test('the game ends after the fourth-quarter clock and the live play; rematch keeps teams and back returns to team select', () => {
  const s = game.createState({ setup: false, teams: [2, 3], seed: 11 }); s.quarter = 4; s.time = .01; s.running = true; s.phase = 'live'; s.snapTime = 27;
  game.step(s, 1 / 60, idle()); assert.equal(s.phase, 'dead'); assert.match(s.message, /END OF REGULATION/); tick(s, 3);
  assert.equal(s.phase, 'finished'); assert.equal(game.hud(s).finished, true); assert.match(game.hud(s).message, /FINAL/); assert.ok(game.hud(s).summary.rows.length >= 6); assert.equal(typeof game.hud(s).summary.star.name, 'string');
  press(s, 'confirm'); assert.equal(s.phase, 'select'); assert.equal(s.quarter, 1); assert.equal(s.time, 150); assert.equal(s.frame, 0); assert.deepEqual(s.score, [0, 0]); assert.equal(s.teams[0].id, 'ironwood');
  s.phase = 'finished'; press(s, 'back'); assert.equal(s.phase, 'setup'); assert.deepEqual(s.setup.teams, [2, 3]);
});

test('invalid or outdated snapshots are rejected', () => {
  const s = game.createState(); s.players[0].x = NaN; assert.throws(() => game.validateState(s));
  const b = game.createState(); b.ball.flight = { x: 0 }; assert.throws(() => game.validateState(b));
  const old = game.createState(); old.schema = 5; assert.throws(() => game.validateState(old), /Unsupported/);
  const t = game.createState(); t.timeouts = [3, 2]; assert.throws(() => game.validateState(t));
  const c = game.createState({ setup: false }); c.away.controlled = 2; assert.throws(() => game.validateState(c));
});

test('a human-timed downfield pass finds a receiver and earns a first down', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, 1);
  const charge = idle(); charge.held.receiverB = true; tick(s, .5, charge);
  const release = idle(); release.released.receiverB = true; game.step(s, 1 / 60, release);
  let completion = false;
  for (let frame = 0; frame < 240 && s.phase === 'live'; frame++) { game.step(s, 1 / 60, idle()); completion ||= s.message.startsWith('COMPLETE'); }
  assert.equal(completion, true); assert.ok(s.next.spot > s.line, s.message); assert.equal(s.stats.passComp[0], 1); assert.ok(s.stats.passYds[0] >= 1); assert.ok(s.players.slice(1, 4).some(p => p.stats.rec === 1));
});

test('pausing a charged pass cancels it so neutral input on resume never throws', () => {
  const s = start(); press(s, 'confirm'); game.step(s, 1 / 60, idle()); const charge = idle(); charge.held.pass = true; tick(s, .3, charge);
  assert.ok(s.charge > 0); game.cancelInput(s); game.step(s, 1 / 60, idle());
  assert.equal(s.charge, 0); assert.equal(s.charging, false); assert.equal(s.ball.flight, null); assert.equal(s.carrier, 0);
});

test('manual defense can select the nearest defender and reach a carrier with a committed tackle', () => {
  const s = start(); for (let n = 0; n < 4; n++) { finishRun(s, -30); next(s); } s.teams[1].players[0].ratings.agi = 0; s.teams[1].players[0].ratings.btk = 0; s.teams[1].players[0].specialties = []; assert.ok(runUntil(s, x => x.phase === 'live', 6)); s.snapTime = 1; s.thrown = true; s.playKind = 'rush';
  const runner = s.players[s.carrier];
  for (let n = 0; n < 7; n++) { s.players[n].x = 20; s.players[n].y = 20; }
  s.players[2].x = runner.x; s.players[2].y = runner.y + 2.5;
  press(s, 'switch'); assert.equal(s.controlled, 2); assert.equal(s.phase, 'live');
  const tackle = idle(); tackle.pressed.tackle = true; tackle.held.sprint = true; tackle.move = { x: 0, y: -1 }; game.step(s, 1 / 60, tackle);
  assert.equal(s.phase, 'live', 'a tackle cannot teleport across the gap');
  tackle.pressed = {}; for (let i = 0; i < 60 && s.phase === 'live'; i++) game.step(s, 1 / 60, tackle);
  assert.equal(s.phase, 'dead'); assert.match(s.message, /SACK|TACKLED/); assert.equal(s.players[2].stats.tackles, 1);
});

test('a complete built-in CPU-vs-CPU game finishes quickly with valid state, plausible stats and a star', () => {
  const s = game.createState({ setup: false, mode: 'watch', teams: [2, 3], seed: 42 }), before = sportsPhysicsObservations(), started = performance.now();
  finished(s); const elapsed = performance.now() - started;
  assert.ok(s.score[0] > s.score[1], `IRONWOOD beats MARSH HOLLOW (${s.score})`);
  assert.equal(s.phase, 'finished'); assert.equal(s.quarter, 4); assert.equal(game.validateState(s), true); assert.ok(elapsed < 2500, `full game simulated in ${elapsed} ms`);
  const total = s.score[0] + s.score[1], st = s.stats;
  assert.ok(total >= 0 && total <= 120, `plausible total ${total}`); assert.ok(st.passAtt[0] + st.passAtt[1] > 10); assert.ok(st.rushAtt[0] + st.rushAtt[1] > 5); assert.ok(st.plays[0] > 8 && st.plays[1] > 8);
  assert.ok(st.passComp[0] <= st.passAtt[0] && st.passComp[1] <= st.passAtt[1]); assert.ok(s.events.length > 10 && s.events.length <= 40);
  const kinds = new Set(s.events.map(e => e.kind)); assert.ok(kinds.has('whistle')); assert.ok(kinds.has('final')); assert.ok(kinds.has('timeout'), 'the CPU spends timeouts');
  const hud = game.hud(s); assert.equal(hud.summary.rows[0][0], 'TOTAL YARDS'); assert.ok(hud.summary.star.line.length > 0); assert.equal(hud.ticker.length, 4); assert.equal(hud.mode, 'watch');
  const after = sportsPhysicsObservations();
  for (const key of ['moveChecks', 'flightChecks', 'pairChecks', 'separationChecks']) assert.ok(after[key] > before[key], `live football exercises ${key}`);
});

test('an idle human never stalls the match: kicks are taken for them and the play clock snaps', () => {
  const s = game.createState({ setup: false, seed: 5 }); tick(s, 40);
  assert.ok(s.playNumber >= 2, 'the kickoff and at least one scrimmage snap happened'); assert.ok(s.time < 150); assert.equal(game.validateState(s), true);
});

test('athletes accelerate, preserve momentum through a cut, and brake instead of teleporting velocity', () => {
  const s = start(); press(s, 'confirm');
  for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
  const input = idle(); input.move = { x: 1, y: 0 }; input.held.sprint = true;
  game.step(s, 1 / 60, input); assert.ok(s.players[0].vx > 0 && s.players[0].vx < 1);
  tick(s, .3, input); const forward = s.players[0].vx; assert.ok(forward > 4);
  input.move.x = -1; game.step(s, 1 / 60, input); assert.ok(s.players[0].vx > 0, 'one opposite input frame cannot reverse momentum');
  tick(s, .35, input); assert.ok(s.players[0].vx < 0);
  const before = Math.hypot(s.players[0].vx, s.players[0].vy); game.step(s, 1 / 60, idle());
  assert.ok(Math.hypot(s.players[0].vx, s.players[0].vy) > 0); assert.ok(Math.hypot(s.players[0].vx, s.players[0].vy) < before);
  for (const p of s.players) assert.ok(Math.hypot(p.vx, p.vy) <= 13.5);
});

test('Speed and Agility ratings set top speed and acceleration', () => {
  const run = (spd, agi) => {
    const s = start(); s.teams[0].players[0].ratings.spd = spd; s.teams[0].players[0].ratings.agi = agi; press(s, 'confirm');
    for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
    const input = idle(); input.move = { x: 0, y: -1 }; game.step(s, 1 / 60, input); const first = s.players[0].vy; tick(s, 2, input); return [first, s.players[0].vy];
  };
  const [slowStart, slowTop] = run(45, 45), [fastStart, fastTop] = run(95, 95);
  assert.ok(fastStart > slowStart); assert.ok(fastTop > slowTop + 1.5); assert.ok(fastTop <= 9.6);
});

test('directional jukes consume stamina and cannot be spammed or used when exhausted', () => {
  const s = start(); press(s, 'confirm'); for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
  const input = idle(); input.pressed.skill = true; input.move = { x: 1, y: -.3 }; game.step(s, 1 / 60, input);
  assert.ok(s.players[0].jukeTime > 0); assert.ok(s.players[0].jukeCooldown > .8); assert.ok(s.players[0].stamina < .75);
  const spent = s.players[0].stamina; game.step(s, 1 / 60, input); assert.ok(s.players[0].stamina >= spent, 'held repeats do not spend another juke');
  s.players[0].jukeCooldown = 0; s.players[0].jukeTime = 0; s.players[0].stamina = .1; game.step(s, 1 / 60, input); assert.equal(s.players[0].jukeTime, 0);
});

test('protecting the ball trades running speed for contact resistance', () => {
  const open = start(); press(open, 'confirm'); for (const p of open.players.slice(1)) { p.x = 20; p.y = 30; }
  const protectedRun = structuredClone(open); const fast = idle(); fast.move = { x: 0, y: -1 }; fast.held.sprint = true;
  const shield = structuredClone(fast); shield.held.shield = true;
  tick(open, .4, fast); tick(protectedRun, .4, shield);
  assert.ok(open.players[0].vy > protectedRun.players[0].vy); assert.equal(protectedRun.players[0].protect, true);
  const contact = protectedBall => {
    const s = start(); press(s, 'confirm'); s.snapTime = 1;
    for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
    s.players[7].x = .8; s.players[7].y = s.players[0].y;
    const input = idle(); input.held.shield = protectedBall; game.step(s, 1 / 60, input); return s.players[0].balance;
  };
  assert.ok(contact(true) > contact(false), 'shield reduces the damage of the same contact');
});

test('ballistic flight changes vertical velocity under gravity and catches only by physical contact', () => {
  const s = start(); press(s, 'confirm'); game.step(s, 1 / 60, idle());
  const input = idle(); input.held.pass = true; input.aim = { x: .6, y: -.8 }; tick(s, .7, input); game.step(s, 1 / 60, idle());
  assert.ok(s.ball.flight); const before = structuredClone(s.ball); game.step(s, 1 / 60, idle());
  assert.ok(s.ball.flight.vz < before.flight.vz); assert.ok(Math.hypot(s.ball.x - before.x, s.ball.y - before.y) < 1);
  const near = start(); press(near, 'confirm'); near.carrier = -1; near.thrown = true;
  for (const p of near.players) { p.x = 20; p.y = 30; }
  near.players[1].x = 1.8; near.players[1].y = 0;
  near.ball = { x: 0, y: 0, z: 1.7, carry: null, flight: { x: 0, y: -10, tx: 0, ty: 0, vx: 0, vy: 0, vz: -1, elapsed: 1, duration: 1, passer: 0 } };
  game.step(near, 1 / 60, idle()); assert.equal(near.carrier, -1, 'a receiver 1.8 yards away cannot magnetically catch');
});

test('collision response transfers momentum and player displacement stays bounded', () => {
  const s = start(); press(s, 'confirm'); s.snapTime = .2;
  for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
  s.players[0].vx = 8; s.players[4].x = .9; s.players[4].y = s.players[0].y; s.players[4].vx = 0;
  const prior = s.players.map(p => ({ x: p.x, y: p.y })); game.step(s, 1 / 60, idle());
  assert.ok(s.players[4].vx > 0, 'a contacted stationary teammate receives momentum'); assert.ok(s.players[0].vx < 8);
  for (const [i, p] of s.players.entries()) assert.ok(Math.hypot(p.x - prior[i].x, p.y - prior[i].y) <= 14 / 60 + .001);
});

function openDuel() {
  const s = start(); press(s, 'confirm'); s.thrown = true; s.playKind = 'rush'; s.snapTime = 2; s.line = -10; s.target = 10;
  for (const p of s.players) { p.x = 20; p.y = -30; p.vx = 0; p.vy = 0; }
  Object.assign(s.players[0], { x: 0, y: 0, vy: 8 });
  Object.assign(s.players[7], { x: .5, y: 3, vy: -8, diveX: 0, diveY: -1, diveTime: .27, diveCooldown: 1.25 });
  s.teams[0].players[0].ratings.btk = 20; s.teams[0].players[0].ratings.car = 99;
  return s;
}

test('a timed lateral juke beats the same committed tackle that stops a straight run', () => {
  const straight = openDuel(), cut = structuredClone(straight);
  for (let frame = 0; frame < 45; frame++) {
    const run = idle(); run.move = { x: 0, y: -1 };
    if (straight.phase === 'live') game.step(straight, 1 / 60, run);
    const juke = idle(); juke.move = { x: frame < 15 ? -1 : 0, y: -1 }; juke.pressed.skill = frame === 0;
    if (cut.phase === 'live') game.step(cut, 1 / 60, juke);
  }
  assert.equal(straight.phase, 'dead'); assert.equal(cut.phase, 'live');
  assert.ok(cut.players[0].y > straight.players[0].y + 3); assert.ok(cut.players[0].stamina < straight.players[0].stamina);
});

test('a spin beats a glancing contact but cannot erase a head-on dive', () => {
  const headOn = openDuel(), flank = openDuel(); flank.players[0].vy = 0;
  Object.assign(flank.players[7], { x: 1.5, y: .1, vx: -2, vy: 0, diveTime: 0, diveCooldown: 1 });
  for (const s of [headOn, flank]) { press(s, 'spin'); for (let n = 0; n < 25 && s.phase === 'live'; n++) game.step(s, 1 / 60, idle()); }
  assert.equal(flank.players[0].moveWon, true); assert.equal(flank.phase, 'live');
  assert.equal(headOn.phase, 'dead'); assert.equal(headOn.players[0].moveWon, false);
});

test('the stiff arm rewards facing the contact and fails against a hit from behind', () => {
  const contact = y => {
    const s = openDuel(); s.players[0].vy = 0; Object.assign(s.players[7], { x: 0, y, vy: y > 0 ? -2 : 2, diveTime: 0 });
    const input = idle(); input.held.shield = true; input.pressed.stiffArm = true; game.step(s, 1 / 60, input); return s;
  };
  const front = contact(1.2), rear = contact(-1.2);
  assert.equal(front.players[0].moveWon, true); assert.ok(front.players[7].stun > 0); assert.equal(front.feedback.kind, 'skill');
  assert.equal(rear.players[0].moveWon, false); assert.equal(rear.players[7].stun, 0);
});

test('a missed defensive lunge locks direction then requires recovery instead of homing', () => {
  const s = openDuel(); s.offense = 1; s.carrier = 7;
  Object.assign(s.players[0], { x: 0, y: 0, vy: 0 }); Object.assign(s.players[7], { x: 0, y: -8, vy: 0, diveTime: 0 });
  const dive = idle(); dive.move = { x: 0, y: -1 }; dive.pressed.tackle = true; game.step(s, 1 / 60, dive);
  const reverse = idle(); reverse.move = { x: 1, y: 1 }; game.step(s, 1 / 60, reverse);
  assert.ok(s.players[0].wishY < 0); assert.ok(Math.abs(s.players[0].wishX) < .001);
  tick(s, .3, reverse); assert.ok(s.players[0].recover > 0); assert.ok(Math.abs(s.players[0].wishX) < .001);
});

test('run plays hand the ball off on real contact and give control to the running back', () => {
  for (const call of [0, 1]) {
    const s = start(-30, call); press(s, 'confirm');
    assert.equal(s.carrier, 0); assert.equal(s.handoffPending, true); assert.deepEqual(game.hud(s).receiverIcons, []);
    let frames = 0;
    while (s.carrier === 0 && frames++ < 90) game.step(s, 1 / 60, idle());
    assert.equal(s.carrier, 1); assert.equal(s.controlled, 1); assert.ok(frames > 10 && frames < 45);
    assert.ok(Math.hypot(s.players[0].x - s.players[1].x, s.players[0].y - s.players[1].y) < 1.45);
    assert.equal(s.ball.flight, null); assert.ok(s.ball.carry); assert.equal(s.feedback.kind, 'pass'); assert.equal(s.playKind, 'rush'); assert.equal(s.stats.rushAtt[0], 1);
  }
});

test('a quick receiver tap captured between simulation ticks launches a lob', () => {
  const s = start(-30, 3); press(s, 'confirm'); game.step(s, 1 / 60, idle());
  const tap = idle(); tap.pressed.receiverA = true; tap.released.receiverA = true; game.step(s, 1 / 60, tap);
  assert.equal(s.carrier, -1); assert.ok(s.ball.flight); assert.equal(s.ball.flight.type, 'LOB'); assert.equal(s.ball.flight.receiver, 1);
});

test('the first playbook waits for the player without using match time; the play clock snaps for them', () => {
  const s = start(); tick(s, 8); assert.equal(s.time, 150); assert.equal(s.phase, 'select'); assert.ok(s.playClock < 13);
  tick(s, 13); assert.equal(s.phase, 'live', 'a 20 s play clock auto-snaps the highlighted play'); assert.ok(s.started);
  tick(s, 1); assert.ok(s.time < 150);
});

test('receiver B bullet passes complete across a readable route-development window', () => {
  let caught = 0;
  for (const delay of [.8, 1, 1.2, 1.4, 1.6, 1.8, 2]) {
    const s = start(-30, 3); press(s, 'confirm'); tick(s, delay);
    const charge = idle(); charge.held.receiverB = true; tick(s, .5, charge); game.step(s, 1 / 60, idle());
    for (let frame = 0; frame < 300 && s.phase === 'live'; frame++) { game.step(s, 1 / 60, idle()); if (s.message.startsWith('COMPLETE')) { caught++; break; } }
  }
  assert.ok(caught >= 3, `${caught} of 7 charge windows should find the receiver before the edge pressure arrives`);
});

test('interception camera immediately faces the new attacking end while field tracking remains smooth', async () => {
  const THREE = await import('three');
  const body = () => new THREE.Object3D();
  const ring = () => new THREE.Mesh(new THREE.RingGeometry(1, 1.2, 8), new THREE.MeshBasicMaterial());
  const s = game.createState({ setup: false }); s.phase = 'dead'; s.line = 0; s.ball.y = 0; s.ball.x = 0; s.offense = 0; s.special = null;
  const view = { THREE, players: s.players.map(() => ({ group: body(), legs: [body(), body()], arms: [body(), body()], receiverRing: ring() })), ball: body(), ring: ring(), pointer: body(), scrimmage: body(), firstDown: body(), target: body(), trajectory: body(), routes: [body(), body(), body()], focus: 0, cameraDirection: 1 };
  const camera = new THREE.PerspectiveCamera(49, 16 / 9, .1, 350); camera.position.set(0, 37, 35);
  game.render({ state: s, view, camera, dt: 1 / 120 });
  const screenDirection = attackingDirection => { camera.updateMatrixWorld(); const center = new THREE.Vector3(0, 0, view.focus).project(camera); const forward = new THREE.Vector3(0, 0, view.focus - attackingDirection * 3).project(camera); return forward.y - center.y; };
  assert.ok(camera.position.z > view.focus); assert.ok(screenDirection(1) > 0);
  s.offense = 1; s.ball.y = 6;
  game.render({ state: s, view, camera, dt: 1 / 120 });
  assert.ok(camera.position.z < view.focus); assert.ok(screenDirection(-1) > 0, 'up maps up immediately after interception');
  assert.ok(view.focus > -.2 && view.focus < 0, 'tracking still eases toward the ball');
  const previousZ = camera.position.z; s.ball.y = 10;
  game.render({ state: s, view, camera, dt: 1 / 120 });
  assert.ok(Math.abs(camera.position.z - previousZ) < 1, 'same-possession follow is still smooth');
  s.offense = 0; game.render({ state: s, view, camera, dt: 1 / 120 });
  assert.ok(camera.position.z > view.focus); assert.ok(screenDirection(1) > 0);
  for (const p of view.players) { p.receiverRing.geometry.dispose(); p.receiverRing.material.dispose(); }
  view.ring.geometry.dispose(); view.ring.material.dispose();
});

test('receiver hold duration chooses a real lob, touch, or bullet trajectory', () => {
  const flights = [];
  for (const hold of [.05, .27, .5]) {
    const s = start(-30, 3); press(s, 'confirm'); tick(s, .8);
    const input = idle(); input.held.receiverB = true; tick(s, hold, input);
    assert.equal(game.hud(s).selectedReceiver, 'B'); assert.equal(game.hud(s).charging, true);
    game.step(s, 1 / 60, idle()); flights.push(s.ball.flight);
  }
  assert.deepEqual(flights.map(f => f.type), ['LOB', 'TOUCH', 'BULLET']);
  assert.ok(flights[0].duration > flights[1].duration && flights[1].duration > flights[2].duration);
  assert.ok(flights[0].vz > flights[1].vz && flights[1].vz > flights[2].vz);
  assert.ok(Math.hypot(flights[2].vx, flights[2].vy) > Math.hypot(flights[0].vx, flights[0].vy));
});

test('LS lead is bounded around the chosen receiver prediction, not free aiming', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, 1);
  const charge = idle(); charge.held.receiverX = true; tick(s, .5, charge);
  const left = structuredClone(s), right = structuredClone(s), neutral = structuredClone(s);
  const release = idle(); release.move = { x: 1, y: 0 }; release.aim = { ...release.move }; game.step(right, 1 / 60, release);
  release.move.x = -1; release.aim = { ...release.move }; game.step(left, 1 / 60, release); game.step(neutral, 1 / 60, idle());
  assert.ok(Math.abs(right.ball.flight.tx - neutral.ball.flight.tx - 2.1) < 1e-9);
  assert.ok(Math.abs(neutral.ball.flight.tx - left.ball.flight.tx - 2.1) < 1e-9);
  assert.equal(right.ball.flight.ty, left.ball.flight.ty);
  assert.equal(right.ball.flight.receiver, 3);
});

test('voice capture cancels a held receiver B pass without a fallback release throw', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, .8);
  const charge = idle(); charge.held.receiverB = true; charge.held.spin = true; tick(s, .25, charge);
  assert.equal(s.receiverButton, 'receiverB');
  const cancel = idle(); cancel.cancelled = { receiverB: true }; game.step(s, 1 / 60, cancel);
  assert.equal(s.ball.flight, null); assert.equal(s.charging, false); assert.equal(s.receiverButton, null);
  tick(s, .1); assert.equal(s.ball.flight, null); assert.equal(s.carrier, 0);
});

test('resume requires the held receiver button to return neutral before it can charge again', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, .8);
  const charge = idle(); charge.held.receiverX = true; tick(s, .2, charge); game.cancelInput(s);
  tick(s, .2, charge); assert.equal(s.charging, false); assert.equal(s.receiverButton, null);
  game.step(s, 1 / 60, idle()); tick(s, .2, charge); assert.equal(s.receiverButton, 'receiverX');
  game.step(s, 1 / 60, idle()); assert.equal(s.ball.flight.type, 'TOUCH');
});

test('B spins after a catch without switching, and A stiff-arms without starting another throw', () => {
  const s = openDuel(); s.carrier = 2; s.controlled = 2; Object.assign(s.players[2], { x: -10, y: 0 });
  const spin = idle(); spin.pressed = { receiverB: true, spin: true, switch: true }; spin.held = { receiverB: true, spin: true };
  game.step(s, 1 / 60, spin); assert.equal(s.controlled, 2); assert.ok(s.players[2].spinTime > 0); assert.equal(s.charging, false);
  const arm = idle(); arm.pressed = { receiverA: true, pass: true, stiffArm: true, conservativeTackle: true }; arm.held = { receiverA: true };
  game.step(s, 1 / 60, arm); assert.ok(s.players[2].stiffTime > 0); assert.equal(s.ball.flight, null); assert.equal(s.receiverButton, null);
});

test('A on defense wraps without a lunge; X dives, and LT strafe keeps facing the carrier', () => {
  const s = openDuel(); s.offense = 1; s.carrier = 7;
  Object.assign(s.players[0], { x: 0, y: 0, vx: 0, vy: 0 }); Object.assign(s.players[7], { x: 0, y: -7, vy: 0, diveTime: 0 });
  const dive = structuredClone(s), wrap = idle(); wrap.pressed = { receiverA: true, pass: true, conservativeTackle: true }; wrap.held.strafe = true; wrap.move = { x: 1, y: 0 };
  game.step(s, 1 / 60, wrap); assert.ok(s.players[0].wrapTime > 0); assert.equal(s.players[0].diveTime, 0); assert.equal(s.players[0].strafe, true); assert.ok(s.players[0].facingY < 0);
  const lunge = idle(); lunge.pressed = { receiverX: true, shoot: true, tackle: true }; game.step(dive, 1 / 60, lunge); assert.ok(dive.players[0].diveTime > 0); assert.equal(dive.charging, false);
});

test('selected receiver and hold duration resume deterministically from a saved charged pass', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, 1); const charge = idle(); charge.held.receiverX = true; tick(s, .2, charge);
  const restored = JSON.parse(JSON.stringify(s)); game.validateState(restored);
  tick(s, .3, charge); tick(restored, .3, charge); game.step(s, 1 / 60, idle()); game.step(restored, 1 / 60, idle());
  assert.deepEqual(restored, s); assert.equal(s.ball.flight.type, 'BULLET'); assert.equal(s.ball.flight.receiver, 3);
});

test('a receiver tap between 120Hz render frames preserves its LS lead at the fixed tick', () => {
  const s = start(-30, 3); press(s, 'confirm'); tick(s, .8); const neutral = structuredClone(s);
  const down = idle(); down.pressed.receiverX = true; down.held.receiverX = true; down.aim = { x: 1, y: 0 }; down.move = { x: 1, y: 0 };
  const up = idle(); up.released.receiverX = true;
  game.step(s, 1 / 60, mergePendingInput(up, down));
  const tap = idle(); tap.pressed.receiverX = true; tap.released.receiverX = true; game.step(neutral, 1 / 60, tap);
  assert.equal(s.ball.flight.type, 'LOB'); assert.ok(Math.abs(s.ball.flight.tx - neutral.ball.flight.tx - 2.1) < 1e-9);
  assert.equal(s.players[0].vx, 0, 'buffered lead does not keep moving the QB after the stick returned neutral');
});

test('a same-tick face-button pass cannot fall through into its defensive action alias', () => {
  for (const n of [0, 1, 2]) {
    const input = new SportsInput('football'), pad = { id: 'Test pad', index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    input.sample(new Set(), [pad]); const s = start(-30, 3); press(s, 'confirm'); tick(s, .8);
    pad.buttons[n] = { pressed: true, value: 1 }; const down = input.sample(new Set(), [pad]);
    pad.buttons[n] = { pressed: false, value: 0 }; const up = input.sample(new Set(), [pad]); game.step(s, 1 / 60, mergePendingInput(up, down));
    assert.equal(s.ball.flight.receiver, n + 1); assert.equal(s.controlled, 0); assert.equal(s.players[0].diveTime, 0); assert.equal(s.players[0].wrapTime, 0); assert.equal(s.tackleWindow, 0);
  }
});

// ------------------------------------------------------------ special teams
test('a punt flips the field: the human holds A for power, the ball flies, and the opponent takes over', () => {
  const s = start(-30); s.down = 4; s.calls[0] = playIndex(s, 'PUNT'); press(s, 'right'); press(s, 'left');
  assert.equal(game.hud(s).plays[s.calls[0]], 'PUNT'); press(s, 'confirm');
  assert.equal(s.special, 'punt'); assert.equal(s.carrier, s.teams[0].kicker); assert.equal(game.hud(s).detail, 'Hold A / J: power • release: kick • LS: aim');
  kick(s, 1.2); assert.equal(s.ball.flight.kick, 'punt'); assert.equal(s.stats.punts[0], 1); assert.ok(game.hud(s).power === 0);
  assert.ok(runUntil(s, x => x.phase === 'dead', 12)); assert.ok(/PUNT|RETURN|TOUCHBACK/.test(s.message), s.message);
  assert.equal(s.next.team, 1); assert.ok(s.next.spot * -1 > -50); assert.equal(s.running, /RETURN/.test(s.message), 'an in-bounds return keeps the clock running; dead kicks stop it');
});

test('field goals score three by distance and kicker rating; misses give the opponent the ball at the line', () => {
  const attempt = (spot, kpw, kac, seed = 7, aim = 0) => {
    const s = start(spot, 2, { seed }); s.teams[0].players[s.teams[0].kicker].ratings.kpw = kpw; s.teams[0].players[s.teams[0].kicker].ratings.kac = kac;
    s.calls[0] = playIndex(s, 'FIELD GOAL'); press(s, 'right'); press(s, 'left'); press(s, 'confirm'); kick(s, 1.2, aim);
    assert.equal(s.ball.flight.kick, 'fg'); runUntil(s, x => x.phase === 'dead', 6); return s;
  };
  const chip = attempt(30, 70, 90); assert.match(chip.message, /FIELD GOAL IS GOOD · 37 YDS/); assert.deepEqual(chip.score, [3, 0]); assert.equal(chip.stats.fgMade[0], 1); assert.equal(chip.next.kickoff, 0);
  const bomb = attempt(-10, 45, 90); assert.match(bomb.message, /NO GOOD/); assert.equal(bomb.score[0], 0); assert.equal(bomb.stats.fgAtt[0], 1); assert.deepEqual([bomb.next.team, bomb.next.spot], [1, -17], 'the opponent takes over at the spot of the kick');
  const yanked = attempt(30, 90, 90, 7, 1); assert.match(yanked.message, /NO GOOD/, 'a full stick pulls the kick wide');
  let strong = 0, weak = 0;
  for (let seed = 1; seed <= 8; seed++) { if (attempt(20, 92, 88, seed).score[0] === 3) strong++; if (attempt(20, 50, 45, seed).score[0] === 3) weak++; }
  assert.ok(strong > weak, `rated kickers make more 47-yarders (${strong} vs ${weak})`); assert.ok(strong >= 6);
});

test('a safety scores two for the defense and the conceding team free-kicks from its 20', () => {
  const s = start(-40); press(s, 'confirm'); s.players[0].y = -59.6; game.step(s, 1 / 60, idle());
  assert.deepEqual(s.score, [0, 2]); assert.match(s.message, /SAFETY/); assert.deepEqual([s.next.kickoff, s.next.free], [0, true]);
  next(s); assert.equal(s.special, 'free'); assert.equal(s.offense, 0); assert.equal(s.line, -30); assert.equal(game.hud(s).label, 'FREE KICK · ALDER');
});

// ------------------------------------------------------------------- clock
test('the clock runs in live play, stops on incompletions and keeps running through the huddle after in-bounds tackles', () => {
  const s = start(-30, 3); press(s, 'confirm'); assert.equal(s.running, true); tick(s, .5); assert.ok(s.time < 150 && s.time > 149);
  const tap = idle(); tap.pressed.receiverX = true; tap.released.receiverX = true; game.step(s, 1 / 60, tap); s.ball.z = .1; s.ball.flight.vz = -1; game.step(s, 1 / 60, idle());
  assert.equal(s.phase, 'dead'); assert.match(s.message, /INCOMPLETE/); assert.equal(s.running, false); const stopped = s.time; tick(s, 1); assert.equal(s.time, stopped);
  next(s); finishRun(s, -22); assert.equal(s.running, false, 'out of bounds stops the clock'); next(s);
  press(s, 'confirm'); s.snapTime = 1; s.players[7].x = s.players[0].x; s.players[7].y = s.players[0].y + .5; s.players[7].wrapTime = .35; s.teams[0].players[0].ratings.btk = 0;
  runUntil(s, x => x.phase === 'dead', 2); assert.match(s.message, /SACK|TACKLED|WRAPPED/); assert.equal(s.running, true, 'an in-bounds tackle keeps the clock running');
  const before = s.time; tick(s, 1); assert.ok(s.time < before - 2, 'the huddle burns clock faster than real time');
});

test('the two-minute warning stops a running clock once per half and timeouts stop it on demand', () => {
  const s = start(); s.quarter = 2; s.time = 121; press(s, 'confirm'); s.snapTime = 1; s.players[7].x = s.players[0].x; s.players[7].y = s.players[0].y + .5; s.players[7].wrapTime = .35; s.teams[0].players[0].ratings.btk = 0;
  runUntil(s, x => x.phase === 'dead', 2); assert.equal(s.running, true); tick(s, .3);
  assert.equal(s.running, false); assert.equal(s.warned[0], true); assert.match(s.message, /TWO-MINUTE WARNING/); assert.equal(s.feedback.kind, 'whistle'); assert.equal(s.events.at(-1).text, 'TWO-MINUTE WARNING');
  s.running = true; tick(s, .2); assert.equal(s.running, true, 'the warning is given once per half');
  press(s, 'timeout'); assert.deepEqual(s.timeouts, [1, 2]); assert.equal(s.running, false); assert.equal(s.events.at(-1).kind, 'timeout');
  press(s, 'timeout'); assert.deepEqual(s.timeouts, [1, 2], 'a stopped clock cannot be stopped again');
  const two = { teams: [idle(), idle()] }; two.teams[1].pressed.timeout = true; s.running = true; game.step(s, 1 / 60, two); assert.deepEqual(s.timeouts, [1, 1]);
});

test('quarters roll over, halftime hands the kickoff to the opening receiver and resets timeouts', () => {
  const s = start(); s.warned = [true, true]; s.time = .5; s.running = true; s.timeouts = [0, 0]; tick(s, 1);
  assert.equal(s.phase, 'dead'); assert.match(s.message, /END OF Q1/); assert.equal(s.quarter, 2); assert.equal(s.time, 150); next(s); assert.equal(s.offense, 0); assert.equal(s.line, -30, 'the drive continues into the second quarter');
  s.time = .5; s.running = true; tick(s, 1); assert.match(s.message, /HALFTIME/); assert.equal(game.hud(s).period, 'HALF'); assert.equal(s.quarter, 3); assert.deepEqual(s.timeouts, [2, 2]);
  tick(s, 4); assert.equal(s.phase, 'select'); assert.equal(s.special, 'kickoff'); assert.equal(s.offense, 0, 'the team that received the opening kick kicks off the second half'); assert.equal(game.hud(s).period, 'Q3');
});

test('a draw is a valid final result', () => {
  const s = game.createState({ setup: false, seed: 2 }); s.quarter = 4; s.time = .01; s.running = true; s.phase = 'dead'; s.next = { team: 0, spot: 0 }; s.deadTime = .1; s.score = [10, 10];
  tick(s, 3); assert.equal(s.phase, 'finished'); assert.match(s.message, /DRAW 10–10/);
});

// --------------------------------------------------------------- mechanics
test('a quarterback tackled behind the line is a sack credited to the defense, not a rush', () => {
  const s = start(); press(s, 'confirm'); s.snapTime = 1; s.teams[0].players[0].ratings.btk = 0; s.teams[0].players[0].ratings.agi = 0;
  const qb = s.players[0]; s.players[11].x = qb.x; s.players[11].y = qb.y - .5; s.players[11].wrapTime = .35;
  runUntil(s, x => x.phase === 'dead', 2);
  assert.match(s.message, /^SACK! M\. AKANDE · -\d+ YDS/); assert.equal(s.stats.sacks[1], 1); assert.equal(s.stats.rushAtt[0], 0); assert.equal(s.players[11].stats.sacks, 1); assert.equal(s.events.at(-1).kind, 'sack');
});

test('linemen hold rushers for a Blocking-versus-Pass-Rush engagement that Brick Wall lengthens and Edge Rusher shortens', () => {
  const engage = (blocker, rusher) => {
    const s = start(-30, 3); s.teams[0].players[4].specialties = blocker; s.teams[1].players[4].specialties = rusher; press(s, 'confirm'); return s.players[11].engage;
  };
  const base = engage([], []); assert.ok(base > .8 && base < 3);
  assert.ok(engage(['brick_wall'], []) > base * 1.3); assert.ok(engage([], ['edge_rusher']) < base * .8);
  const weak = start(-30, 3); weak.teams[0].players[4].ratings.blk = 30; weak.teams[1].players[4].ratings.rsh = 99; press(weak, 'confirm'); assert.ok(weak.players[11].engage < base);
  const held = start(-30, 3); press(held, 'confirm'); const rusher = held.players[11], y = rusher.y; tick(held, .6); assert.ok(Math.abs(rusher.y - y) < 3, 'an engaged rusher stays at the line');
});

test('big hits can force fumbles that bounce live; Carrying resists them and Enforcer doubles them', () => {
  const hits = (car, specialty) => {
    let fumbles = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = openDuel(); s.seed = seed; s.teams[0].players[0].ratings.car = car; s.teams[0].players[0].ratings.btk = 0; s.teams[1].players[0].specialties = specialty; s.teams[1].players[0].ratings.str = 90; s.teams[1].players[0].ratings.tak = 90;
      for (let n = 0; n < 20 && s.phase === 'live' && s.carrier === 0; n++) game.step(s, 1 / 60, idle());
      if (s.ball.flight?.fumble) { fumbles++; runUntil(s, x => x.phase === 'dead' || (x.carrier >= 0 && !x.ball.flight), 4); assert.ok(s.carrier >= 0 || s.phase === 'dead', 'a loose ball is recovered or declared dead'); }
    }
    return fumbles;
  };
  const butterfingers = hits(20, []), secure = hits(99, []), enforced = hits(20, ['enforcer']);
  assert.ok(butterfingers > secure, `poor carrying fumbles more (${butterfingers} vs ${secure})`); assert.ok(enforced > butterfingers, `Enforcer forces more (${enforced} vs ${butterfingers})`);
  const s = openDuel(); s.seed = 1; s.teams[0].players[0].ratings.car = 0; s.teams[1].players[0].specialties = ['enforcer']; s.teams[1].players[0].ratings.str = 99;
  runUntil(s, x => Boolean(x.ball.flight?.fumble), 1); assert.ok(s.ball.flight?.fumble); assert.equal(s.stats.fumbles[0], 1); assert.equal(s.carrier, -1);
  assert.ok(runUntil(s, x => x.phase === 'dead' || x.carrier >= 0, 4)); assert.equal(game.validateState(s), true);
});

test('broken tackles follow Break Tackle and Bulldozer; a Lockdown corner trails tighter than a Route Artist allows', () => {
  const broke = (btk, specialties) => {
    let count = 0;
    for (let seed = 1; seed <= 25; seed++) { const s = openDuel(); s.seed = seed; s.teams[0].players[0].ratings.btk = btk; s.teams[0].players[0].ratings.car = 99; s.teams[0].players[0].specialties = specialties; for (let n = 0; n < 20 && s.phase === 'live'; n++) game.step(s, 1 / 60, idle()); if (s.phase === 'live') count++; }
    return count;
  };
  const soft = broke(20, []), strong = broke(99, []), bull = broke(60, ['bulldozer']), plain = broke(60, []);
  assert.ok(strong > soft); assert.ok(bull >= plain);
  const trail = (corner, receiver) => {
    const s = start(-30, 4); s.teams[1].players[2].specialties = corner; s.teams[0].players[2].specialties = receiver; s.teams[0].players[2].ratings.spd = 40; s.calls[1] = 2; press(s, 'right'); press(s, 'left'); press(s, 'confirm'); tick(s, 1.5);
    return Math.hypot(s.players[9].x - s.players[2].x, s.players[9].y - s.players[2].y);
  };
  assert.ok(trail(['lockdown'], []) < trail([], [])); assert.ok(trail([], ['route_artist']) > trail([], []));
});

test('throw placement error shrinks with Throw Accuracy and Surgeon; Gunslinger adds velocity and range', () => {
  const error = (tha, specialties, hold = .5) => {
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = start(-30, 2, { seed }); s.teams[0].players[0].ratings.tha = tha; s.teams[0].players[0].specialties = specialties; press(s, 'confirm'); tick(s, .6);
      const r = s.players[2], charge = idle(); charge.held.receiverB = true; tick(s, hold, charge); const expected = { x: r.x + r.vx * .5, y: r.y + r.vy * .5 }; game.step(s, 1 / 60, idle());
      total += Math.hypot(s.ball.flight.tx - expected.x, s.ball.flight.ty - expected.y);
    }
    return total / 12;
  };
  const wild = error(40, []), precise = error(99, []), surgeon = error(60, ['surgeon']), plain = error(60, []);
  assert.ok(wild > precise * 1.8, `accuracy spreads placement (${wild.toFixed(2)} vs ${precise.toFixed(2)})`); assert.ok(surgeon < plain);
  const flight = specialties => { const s = start(-30, 3); s.teams[0].players[0].specialties = specialties; press(s, 'confirm'); tick(s, 1); const charge = idle(); charge.held.receiverB = true; tick(s, .5, charge); game.step(s, 1 / 60, idle()); return s.ball.flight; };
  assert.ok(flight(['gunslinger']).duration < flight([]).duration * .9);
});

test('catching decides drops and contested catches; Sure Hands never drops an open ball and Ballhawk turns breakups into picks', () => {
  const arrive = (cth, receiverSpecialties, defenderAt, defenderSpecialties = [], seed = 1) => {
    const s = start(-30, 3, { seed }); press(s, 'confirm'); s.carrier = -1; s.thrown = true; s.playKind = 'pass'; s.passer = 0;
    for (const p of s.players) { p.x = 20; p.y = -40; p.prevX = p.x; p.prevY = p.y; }
    s.teams[0].players[2].ratings.cth = cth; s.teams[0].players[2].specialties = receiverSpecialties; s.teams[1].players[2].specialties = defenderSpecialties; s.teams[1].players[2].ratings.cov = 80;
    Object.assign(s.players[2], { x: 0, y: 0, prevX: 0, prevY: 0 }); if (defenderAt !== null) Object.assign(s.players[9], defenderAt < 0 ? { x: 0, y: defenderAt, prevX: 0, prevY: defenderAt } : { x: defenderAt, y: 0, prevX: defenderAt, prevY: 0 });
    if (defenderAt !== null && defenderAt < 0) Object.assign(s.players[2], { y: 3, prevY: 3 });
    s.ball = { x: 0, y: -.2, z: 1.7, carry: null, flight: { x: 0, y: -10, tx: 0, ty: 0, vx: 0, vy: 10, vz: -1, elapsed: .99, duration: 1, passer: 0, receiver: 2, type: 'BULLET' } };
    game.step(s, 1 / 60, idle()); return s.carrier === 2 ? 'catch' : s.carrier === 9 ? 'int' : /DROPPED/.test(s.message) ? 'drop' : /BROKEN/.test(s.message) ? 'breakup' : s.message;
  };
  const tally = (...args) => { const out = {}; for (let seed = 1; seed <= 40; seed++) { const o = arrive(...args, seed); out[o] = (out[o] || 0) + 1; } return out; };
  const stone = tally(20, [], null, []), glue = tally(20, ['sure_hands'], null, []), good = tally(95, [], null, []);
  assert.ok(stone.drop > 2 && stone.catch > 10); assert.equal(glue.drop ?? 0, 0); assert.ok((good.drop ?? 0) < stone.drop);
  const contested = tally(70, [], 1, []), hawk = tally(70, [], 1, ['ballhawk']);
  assert.ok(contested.catch > 5 && (contested.breakup ?? 0) + (contested.int ?? 0) > 5, JSON.stringify(contested));
  assert.ok((hawk.int ?? 0) >= (contested.int ?? 0), `Ballhawk picks more (${JSON.stringify(hawk)} vs ${JSON.stringify(contested)})`);
  const first = tally(70, [], -.6, []), hawkFirst = tally(70, [], -.6, ['ballhawk']);
  assert.ok((first.int ?? 0) >= 4 && (first.breakup ?? 0) > 3, JSON.stringify(first)); assert.ok((hawkFirst.int ?? 0) > (first.int ?? 0), `${JSON.stringify(hawkFirst)} vs ${JSON.stringify(first)}`);
});

test('Escape Artist and Agility shrug off sacks; Ankle Breaker jukes cost less stamina and freeze defenders more often', () => {
  const escapes = (agi, specialties) => {
    let live = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = start(); s.seed = seed; s.teams[0].players[0].ratings.agi = agi; s.teams[0].players[0].specialties = specialties; s.teams[0].players[0].ratings.btk = 0; press(s, 'confirm'); s.snapTime = 1;
      const qb = s.players[0]; Object.assign(s.players[11], { x: qb.x, y: qb.y - .6, wrapTime: .35 }); game.step(s, 1 / 60, idle()); if (s.phase === 'live') live++;
    }
    return live;
  };
  const slippery = escapes(99, ['escape_artist']), statue = escapes(10, []); assert.ok(slippery > statue, `${slippery} vs ${statue}`);
  // Same agility: the specialty alone escapes clearly more often.
  const artist = escapes(70, ['escape_artist']), plain = escapes(70, []); assert.ok(artist > plain * 1.3, `${artist} vs ${plain}`);
  const juke = (agi, specialties) => {
    let frozen = 0, stamina = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const s = openDuel(); s.seed = seed; s.teams[0].players[0].ratings.agi = agi; s.teams[0].players[0].specialties = specialties; Object.assign(s.players[7], { x: 0, y: 2.5, diveTime: 0, vy: 0 }); s.players[0].facingY = 1;
      const input = idle(); input.pressed.skill = true; input.move = { x: 1, y: 0 }; game.step(s, 1 / 60, input); if (s.players[7].stun > 0) frozen++; stamina += s.players[0].stamina;
    }
    return [frozen, stamina / 25];
  };
  const [plainFrozen, plainStamina] = juke(70, []), [ankleFrozen, ankleStamina] = juke(70, ['ankle_breaker']), [stiffFrozen] = juke(20, []);
  assert.ok(ankleStamina > plainStamina + .05); assert.ok(ankleFrozen >= plainFrozen); assert.ok(plainFrozen >= stiffFrozen);
});

test('Burner finds an extra gear in the open and Big Leg stretches field-goal range', () => {
  const gear = specialties => {
    const s = start(-20); s.teams[0].players[0].specialties = specialties; s.teams[0].players[0].ratings.spd = 80; press(s, 'confirm'); s.thrown = true; s.playKind = 'rush';
    for (const p of s.players.slice(1)) { p.x = 20; p.y = -45; }
    const input = idle(); input.move = { x: 0, y: -1 }; tick(s, 4, input); return s.players[0].y;
  };
  assert.ok(gear(['burner']) > gear([]) + 1);
  const range = specialties => { const s = start(12, 2); s.teams[0].players[s.teams[0].kicker].ratings.kpw = 85; s.teams[0].players[s.teams[0].kicker].ratings.kac = 99; s.teams[0].players[s.teams[0].kicker].specialties = specialties; s.calls[0] = playIndex(s, 'FIELD GOAL'); press(s, 'right'); press(s, 'left'); press(s, 'confirm'); kick(s, 1.2); runUntil(s, x => x.phase === 'dead', 6); return s.score[0]; };
  assert.equal(range(['big_leg']), 3); assert.equal(range([]), 0);
});

test('the CPU calls situational football: punts on fourth and long, kicks field goals in range and uses late timeouts', () => {
  const call = (down, spot, time = 150, quarter = 1, score = [0, 0], seed = 1) => {
    const s = game.createState({ setup: false, mode: 'watch', teams: [0, 1], seed }); s.quarter = quarter; s.time = time; s.score = score;
    s.phase = 'dead'; s.next = { team: 0, spot, down, target: spot + 10 }; s.deadTime = 0; game.step(s, 1 / 60); tick(s, 1); return game.hud(s).plays[s.calls[0]];
  };
  const fourthLong = Array.from({ length: 6 }, (_, i) => call(4, -30, 150, 1, [0, 0], i + 1)), fourthClose = Array.from({ length: 6 }, (_, i) => call(4, 25, 150, 1, [0, 0], i + 1));
  assert.ok(fourthLong.filter(p => p === 'PUNT').length >= 5, fourthLong.join()); assert.ok(fourthClose.filter(p => p === 'FIELD GOAL').length >= 4, fourthClose.join());
});

test('difficulty changes the opponent CPU reaction and decision noise, and a +20 overall team wins the gap pairing', () => {
  const a = game.createState({ setup: false, mode: 'watch', teams: [0, 1], difficulty: 0, seed: 4 }), b = game.createState({ setup: false, mode: 'watch', teams: [0, 1], difficulty: 2, seed: 4 });
  tick(a, 16); tick(b, 16); assert.notDeepEqual(a.players.map(p => [p.x, p.y]), b.players.map(p => [p.x, p.y]), 'difficulty changes the opponent behaviour');
  assert.equal(a.difficulty, 0); assert.equal(b.difficulty, 2);
});

// ------------------------------------------------------- controllers & HUD
test('two controllers drive both teams: team 1 picks its coverage, moves its athlete and snaps when on offense', () => {
  const s = start(), before = s.calls[1]; const two = { teams: [idle(), idle()] }; two.teams[1].pressed.right = true; game.step(s, 1 / 60, two);
  assert.deepEqual(s.human, [true, true]); assert.equal(s.calls[1], (before + 1) % 5); assert.equal(game.hud(s, 1).selectedPlay, s.calls[1]); assert.equal(game.hud(s, 1).message, 'SET YOUR DEFENSE'); assert.deepEqual(game.hud(s, 1).receiverIcons, []);
  two.teams[1].pressed = {}; two.teams[1].pressed.confirm = true; game.step(s, 1 / 60, two); assert.equal(s.phase, 'select', 'the defense cannot snap for a human offense');
  two.teams[1].pressed = {}; two.teams[0].pressed.confirm = true; game.step(s, 1 / 60, two); assert.equal(s.phase, 'live');
  two.teams[0].pressed = {}; two.teams[1].move = { x: 0, y: -1 }; const startY = s.players[s.away.controlled].y; tick(s, .5, two);
  assert.ok(Math.abs(s.players[s.away.controlled].y - startY) > 1, 'team 1 moves its own athlete'); assert.equal(s.players[s.away.controlled].team, 1);
  const cpuOnly = { teams: [null, idle()] }; const t = start(); tick(t, 1, cpuOnly); assert.deepEqual(t.human, [false, true]); assert.ok(t.calls[0] < 9);
  for (let n = 0; n < 4; n++) { finishRun(s, -30); next(s); }
  two.teams[0].pressed = {}; two.teams[1].pressed = {}; two.teams[1].move = { x: 0, y: 0 }; game.step(s, 1 / 60, two);
  assert.equal(s.offense, 1); const h = game.hud(s, 1); assert.equal(h.message, 'CHOOSE YOUR PLAY'); assert.equal(h.plays.length, 9); assert.equal(game.hud(s, 0).message, 'SET YOUR DEFENSE');
  s.calls[1] = 2; two.teams[1].pressed = { right: true }; game.step(s, 1 / 60, two); two.teams[1].pressed = { left: true }; game.step(s, 1 / 60, two); assert.equal(h.plays[s.calls[1]], 'SLANTS');
  two.teams[1].pressed = { confirm: true }; game.step(s, 1 / 60, two); assert.equal(s.phase, 'live'); assert.equal(s.carrier, 7); assert.equal(s.away.controlled, 7);
  two.teams[1].pressed = {}; game.step(s, 1 / 60, two); two.teams[1].held.receiverB = true; tick(s, .3, two); assert.equal(s.away.receiverButton, 'receiverB'); assert.equal(game.hud(s, 1).selectedReceiver, 'B'); assert.ok(game.hud(s, 1).power > 0); assert.equal(game.hud(s, 0).power, 0);
  assert.deepEqual(game.hud(s, 1).receiverIcons.map(i => i.player), [8, 9, 10]);
  two.teams[1].held = {}; two.teams[1].released.receiverB = true; game.step(s, 1 / 60, two); assert.equal(s.ball.flight.passer, 7); assert.equal(s.stats.passAtt[1], 1);
});

test('watch mode leaves both teams to the CPU and only confirm, rematch and back operate', () => {
  const s = game.createState({ setup: false, mode: 'watch', seed: 8 }); assert.equal(game.hud(s).mode, 'watch');
  const input = idle(); input.move = { x: 1, y: 0 }; input.held.receiverB = true; tick(s, 6, input);
  assert.deepEqual(s.human, [false, false]); assert.equal(s.charging, false); assert.ok(s.playNumber >= 1);
  s.phase = 'finished'; press(s, 'back'); assert.equal(s.phase, 'setup'); press(s, 'confirm'); assert.equal(s.phase, 'select'); assert.equal(s.mode, 'watch');
});

test('hud renders each controller perspective and keeps the shared contract keys', () => {
  const s = start(); const h = game.hud(s);
  for (const key of ['teams', 'selected', 'athlete', 'setup', 'summary', 'ticker', 'period', 'timeouts', 'mode', 'phase', 'message', 'detail', 'skillHint', 'skillReady', 'power', 'charging', 'stamina', 'plays', 'selectedPlay', 'passType', 'selectedReceiver', 'receiverIcons', 'score', 'clock', 'label', 'finished', 'teamNames']) assert.ok(key in { ...h, phase: s.phase }, `hud exposes ${key}`);
  assert.deepEqual(h.teamNames, ['ALDER', 'CANYON']); assert.equal(h.teams[1].primary, '#ff753f'); assert.equal(h.teams[0].ovr, s.teams[0].ovr); assert.deepEqual(h.selected, [0, 8]);
  assert.equal(h.athlete.name, 'C. Haverford'); assert.equal(h.athlete.number, 7); assert.deepEqual(h.athlete.specialties, ['Surgeon']); assert.equal(h.athlete.ratings[0].code, 'THA');
  assert.equal(h.label, '1ST & 10 · ALDER BALL'); assert.equal(h.setup, null); assert.equal(h.summary, null); assert.deepEqual(h.receiverIcons, [{ button: 'A', player: 1 }, { button: 'B', player: 2 }, { button: 'X', player: 3 }]);
  const away = game.hud(s, 1); assert.equal(away.athlete.name, 'T. Booker'); assert.deepEqual(away.plays, ['COVER 2', 'COVER 3', 'MAN', 'BLITZ', 'PREVENT']); assert.deepEqual(away.receiverIcons, []); assert.equal(away.message, 'CANYON · SLANTS'.replace('CANYON · SLANTS', away.message));
  assert.deepEqual(away.selected, h.selected); assert.deepEqual(away.score, h.score); assert.equal(away.stamina, s.players[8].stamina);
  press(s, 'confirm'); const live = game.hud(s, 1); assert.match(live.detail, /dive tackle/); assert.match(game.hud(s).detail, /receiver/);
});

test('rating sensitivity: a team of 99s beats a team of 40s and Awareness speeds up quarterback reads', () => {
  const lopsided = game.createState({ setup: false, mode: 'watch', teams: [0, 1], seed: 21 });
  for (const p of lopsided.teams[0].players) for (const key of Object.keys(p.ratings)) p.ratings[key] = 99;
  for (const p of lopsided.teams[1].players) for (const key of Object.keys(p.ratings)) p.ratings[key] = 40;
  lopsided.quarter = 4; finished(lopsided); assert.ok(lopsided.score[0] > lopsided.score[1], `${lopsided.score}`);
  // Awareness: a linebacker reads the handoff sooner.
  const recognised = awr => { const s = start(-30, 0, { mode: 'watch' }); s.teams[1].players[1].ratings.awr = awr; s.calls[0] = 0; s.phase = 'dead'; s.next = { team: 0, spot: -30 }; s.deadTime = 0; game.step(s, 1 / 60); s.calls[0] = 0; runUntil(s, x => x.phase === 'live', 6); runUntil(s, x => x.carrier === 1, 3); tick(s, .85); return Math.hypot(s.players[8].vx, s.players[8].vy); };
  assert.ok(recognised(99) > recognised(40) + 1, `sharp linebackers move first (${recognised(99).toFixed(1)} vs ${recognised(40).toFixed(1)})`);
});

// ------------------------------------------------------- review fixes
test('only the offense snaps and a confirm cannot skip a running huddle clock for free', () => {
  const s = start(); for (let n = 0; n < 4; n++) { finishRun(s, -30); next(s); }
  assert.equal(s.offense, 1); press(s, 'confirm'); assert.equal(s.phase, 'select', 'a defensive confirm does not snap the CPU offense');
  const two = { teams: [idle(), idle()] }; two.teams[0].pressed.confirm = true; game.step(s, 1 / 60, two); assert.equal(s.phase, 'select');
  assert.ok(runUntil(s, x => x.phase === 'live', 6)); runUntil(s, x => x.phase === 'dead', 12); assert.equal(s.phase, 'dead');
  s.running = true; s.time = 100; s.phaseTime = .2; const before = s.time; next(s);
  assert.equal(s.phase, 'select'); assert.ok(before - s.time > 9 && before - s.time < 11, `skipping the huddle still burns its clock (${(before - s.time).toFixed(1)} s)`);
});

test('a touchdown on the final play of a quarter still gets its conversion before the quarter ends', () => {
  const s = start(); s.quarter = 4; s.time = .2; s.warned = [true, true]; press(s, 'confirm'); tick(s, .3); assert.equal(s.time, 0); s.players[0].y = 50.1; game.step(s, 1 / 60, idle());
  assert.match(s.message, /^TOUCHDOWN/); assert.equal(s.next.conversion, true); next(s); assert.equal(s.phase, 'select'); assert.equal(s.conversion, true); assert.equal(s.quarter, 4);
  press(s, 'confirm'); assert.equal(s.phase, 'live'); kick(s); assert.ok(runUntil(s, x => x.phase === 'dead', 6)); assert.deepEqual(s.score, [7, 0]); assert.match(s.message, /END OF REGULATION/); assert.ok(s.next.final);
  tick(s, 3); assert.equal(s.phase, 'finished'); assert.match(s.message, /ALDER WINS 7–0/);
  const half = start(); half.quarter = 2; half.time = .2; half.warned = [true, true]; press(half, 'confirm'); tick(half, .3); half.players[0].y = 50.1; game.step(half, 1 / 60, idle()); next(half); assert.equal(half.conversion, true); assert.equal(half.quarter, 2);
});

test('the two-minute warning is called at a dead ball even when that play already stopped the clock', () => {
  const s = start(-30, 3); s.quarter = 4; s.time = 121; press(s, 'confirm'); tick(s, 1.5);
  const tap = idle(); tap.pressed.receiverX = true; tap.released.receiverX = true; game.step(s, 1 / 60, tap); s.ball.z = .1; s.ball.flight.vz = -1; game.step(s, 1 / 60, idle());
  assert.equal(s.phase, 'dead'); assert.ok(s.time < 120); assert.equal(s.warned[1], true); assert.match(s.message, /TWO-MINUTE WARNING/);
});

test('conversion turnovers: the touchdown team kicks off either way and a two-point pick counts as an interception', () => {
  const s = start(); press(s, 'confirm'); s.players[0].y = 50.1; game.step(s, 1 / 60, idle()); next(s); press(s, 'right'); press(s, 'confirm');
  s.carrier = -1; s.thrown = true; s.playKind = 'pass'; s.passer = 0;
  for (const p of s.players) { p.x = 20; p.y = 20; p.prevX = p.x; p.prevY = p.y; }
  Object.assign(s.players[9], { x: 0, y: 48, prevX: 0, prevY: 48 }); s.teams[1].players[2].ratings.cth = 99; s.teams[1].players[2].specialties = ['ballhawk'];
  s.ball = { x: 0, y: 47.8, z: 1.7, carry: null, flight: { x: 0, y: 40, tx: 0, ty: 48, vx: 0, vy: 10, vz: -1, elapsed: .9, duration: 1, passer: 0, receiver: 2, type: 'BULLET' } };
  for (let seed = 1; !s.intercepted && seed < 20; seed++) { const copy = structuredClone(s); copy.seed = seed; game.step(copy, 1 / 60, idle()); if (copy.intercepted) Object.assign(s, copy); }
  assert.equal(s.intercepted, true); assert.equal(s.stats.ints[1], 1); assert.equal(s.offense, 1);
  s.players[9].x = 25; game.step(s, 1 / 60, idle()); assert.equal(s.phase, 'dead'); assert.equal(s.next.kickoff, 0, 'the touchdown team kicks off after a failed try');
  const r = start(); press(r, 'confirm'); r.players[0].y = 50.1; game.step(r, 1 / 60, idle()); next(r); press(r, 'right'); press(r, 'confirm'); r.snapTime = 1;
  r.offense = 1; r.newPossession = true; r.carrier = 9; r.players[9].y = -50.5; r.players[9].x = 0; game.step(r, 1 / 60, idle());
  assert.match(r.message, /DEFENSIVE TWO-POINT RETURN/); assert.deepEqual(r.score, [6, 2]); assert.equal(r.next.kickoff, 0);
});

test('saves that would crash the simulation are rejected', () => {
  const kicker = game.createState({ setup: false }); kicker.teams[0].kicker = 9; assert.throws(() => game.validateState(kicker));
  const tactics = game.createState({ setup: false }); tactics.teams[1].tactics.passRate = NaN; assert.throws(() => game.validateState(tactics));
  const timeouts = game.createState({ setup: false }); timeouts.timeouts = [2]; assert.throws(() => game.validateState(timeouts));
  const pass = start(-30, 3); press(pass, 'confirm'); pass.playKind = 'pass'; pass.passer = -1; assert.throws(() => game.validateState(pass));
  const names = game.createState({ setup: false }); names.callNames = ['x']; assert.throws(() => game.validateState(names));
});

test('a sprinting juke stays inside the 13.5 yd/s athlete bound', () => {
  const s = start(); press(s, 'confirm'); for (const p of s.players.slice(1)) { p.x = 20; p.y = 30; }
  const run = idle(); run.move = { x: 0, y: -1 }; run.held.sprint = true; tick(s, 1.2, run);
  const juke = idle(); juke.move = { x: 1, y: -1 }; juke.held.sprint = true; juke.pressed.skill = true; let top = 0;
  for (let n = 0; n < 20; n++) { game.step(s, 1 / 60, juke); juke.pressed = {}; top = Math.max(top, Math.hypot(s.players[0].vx, s.players[0].vy)); }
  assert.ok(s.players[0].jukeCooldown > 0); assert.ok(top <= 13.5, `juke peak ${top.toFixed(2)} yd/s`); assert.ok(top > 11);
});

test('a returner who catches in the field and retreats into his own end zone concedes a safety, not a touchback', () => {
  const s = start(); press(s, 'confirm'); s.carrier = -1; s.thrown = true; s.playKind = 'pass'; s.passer = 0;
  for (const p of s.players) { p.x = 20; p.y = -40; }
  s.players[9].x = 0; s.players[9].y = 0; s.teams[1].players[2].ratings.cth = 99; s.teams[1].players[2].specialties = ['ballhawk'];
  s.ball = { x: 0, y: -.2, z: 1.7, carry: null, flight: { x: 0, y: -10, tx: 0, ty: 0, vx: 0, vy: 10, vz: -1, elapsed: .99, duration: 1, passer: 0, receiver: 2, type: 'BULLET' } };
  for (let seed = 1; !s.intercepted && seed < 20; seed++) { const copy = structuredClone(s); copy.seed = seed; game.step(copy, 1 / 60, idle()); if (copy.intercepted) Object.assign(s, copy); }
  assert.equal(s.intercepted, true); s.players[9].y = 58.9; game.step(s, 1 / 60, idle());
  assert.match(s.message, /SAFETY/); assert.deepEqual(s.score, [2, 0]); assert.deepEqual([s.next.kickoff, s.next.free], [1, true]);
});

test('a missed field goal is spotted at the kick, in-bounds kick returns keep the clock running, and a sack-safety counts as a sack', () => {
  const s = start(-10, 2); s.teams[0].players[s.teams[0].kicker].ratings.kpw = 40; s.calls[0] = playIndex(s, 'FIELD GOAL'); press(s, 'right'); press(s, 'left'); press(s, 'confirm'); kick(s, .3);
  assert.ok(runUntil(s, x => x.phase === 'dead', 6)); assert.match(s.message, /NO GOOD/); assert.deepEqual([s.next.team, s.next.spot], [1, -17]);
  const deep = start(40, 2); deep.calls[0] = playIndex(deep, 'FIELD GOAL'); press(deep, 'right'); press(deep, 'left'); press(deep, 'confirm'); kick(deep, .25, 1);
  assert.ok(runUntil(deep, x => x.phase === 'dead', 6)); assert.match(deep.message, /NO GOOD/); assert.equal(deep.next.spot, 30, 'inside the 20 the ball comes out to the 20');
  const k = game.createState({ setup: false, mode: 'watch', seed: 3 }); assert.ok(runUntil(k, x => x.phase === 'dead', 14)); if (/RETURN/.test(k.message)) assert.equal(k.running, true, 'an in-bounds return keeps the clock running');
  const z = start(-45); press(z, 'confirm'); z.snapTime = 1; z.teams[0].players[0].ratings.agi = 0; z.teams[0].players[0].ratings.btk = 0; z.players[0].y = -51.2; Object.assign(z.players[11], { x: 0, y: -51.8, wrapTime: .35 });
  runUntil(z, x => x.phase === 'dead', 2); assert.match(z.message, /SAFETY/); assert.equal(z.stats.sacks[1], 1);
});

test('a human play call carries over only while it exists in the new playbook', () => {
  const s = start(); s.down = 4; s.calls[0] = playIndex(s, 'PUNT'); press(s, 'right'); press(s, 'left'); press(s, 'confirm'); kick(s, 1);
  assert.ok(runUntil(s, x => x.phase === 'dead', 12)); next(s); assert.equal(s.offense, 1); assert.equal(game.hud(s).plays[s.calls[0]], 'COVER 2');
  for (let n = 0; n < 4 && s.offense === 1; n++) { runUntil(s, x => x.phase === 'live', 6); finishRun === null; s.players[s.carrier].x = 25; game.step(s, 1 / 60, idle()); next(s); }
  if (s.offense === 0) assert.equal(game.hud(s).plays[s.calls[0]], 'SLANTS', 'a defensive index never becomes a punt or a run by accident');
});
