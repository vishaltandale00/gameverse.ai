// Development viewer for recorded Decisions matches. It re-simulates the exact
// recorded controller decisions through the shared harness core, renders with
// each sport's own scene/camera, and checks every tick's state hash.
import * as THREE from '/runtime/three/three.module.js';
import { CONTROL_PROFILE, TICKS, createSession, prepareDecisions, stepDecisionFrame, recordDecisions } from './sports-decisions-core.js';

const $ = selector => document.querySelector(selector);
const clock = seconds => { const total = Math.ceil(Math.max(0, seconds)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const stateHash = async state => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state))));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
$('#stage').append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(46, 1, .1, 600);
let replay = null;
// Size only on real changes; setSize(…, false) never restyles the canvas, so it
// cannot feed back into the observed stage size.
let size = '';
const resize = () => {
  const { width, height } = $('#stage').getBoundingClientRect(), next = `${Math.round(width)}x${Math.round(height)}`;
  if (!width || !height || next === size) return;
  size = next; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe($('#stage'));

async function load(file) {
  const report = JSON.parse(await file.text());
  if (report.schema !== 3 || report.controlProfile !== CONTROL_PROFILE || !Array.isArray(report.ticks)) throw new Error(`Expected a ${CONTROL_PROFILE} schema-3 Decisions match report.`);
  dispose(replay?.scene);
  const session = createSession(report.game, report.session), scene = new THREE.Scene();
  const view = session.game.buildScene({ THREE, scene, camera, renderer });
  // A failed run's last tick never executed; replay only ticks that recorded a state.
  const playable = report.ticks.findIndex(tick => !tick.stateHash);
  replay = { report, session, scene, view, tick: 0, frame: 0, mapped: null, events: [], accumulator: 0, verified: 0, diverged: null, paused: false, length: playable < 0 ? report.ticks.length : playable };
  $('#status').textContent = `${report.game} · ${replay.length} recorded ticks · run ${report.runId.slice(0, 8)} · ${report.status}`;
  resize();
}

function dispose(scene) {
  scene?.traverse(object => { object.geometry?.dispose(); for (const m of [object.material].flat().filter(Boolean)) { for (const value of Object.values(m)) if (value?.isTexture) value.dispose(); m.dispose(); } });
}
async function verifyTick(target, index) {
  const expected = target.report.ticks[index]?.stateHash;
  if (!expected || target.diverged !== null) return;
  // The digest input is serialized synchronously, before any later frame runs.
  const actual = await stateHash(target.session.state);
  if (actual === expected) target.verified++; else target.diverged = index;
}

function advance() {
  const { session, report } = replay;
  if (replay.tick >= replay.length || session.state.phase === 'finished') return false;
  if (replay.frame === 0) {
    const actions = [null, null];
    for (const decision of report.ticks[replay.tick].decisions) actions[decision.team] = decision.action;
    replay.actions = actions; replay.mapped = prepareDecisions(session, actions); replay.events = [];
  }
  const event = stepDecisionFrame(session, replay.mapped, replay.frame);
  if (event) replay.events.push(event);
  replay.frame++;
  if (replay.frame === TICKS || session.state.phase === 'finished') {
    recordDecisions(session, replay.actions, replay.events);
    verifyTick(replay, replay.tick); replay.tick++; replay.frame = 0;
  }
  return true;
}

let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const elapsed = Math.min(.1, (now - last) / 1000); last = now;
  if (!replay) return;
  if (!replay.paused) {
    replay.accumulator += elapsed * Number($('#speed').value);
    while (replay.accumulator >= 1 / 60) { replay.accumulator -= 1 / 60; if (!advance()) { replay.accumulator = 0; break; } }
  }
  const { session, view, scene } = replay, hud = session.game.hud(session.state);
  session.game.render({ state: session.state, view, camera, dt: elapsed });
  renderer.render(scene, camera);
  $('#home').textContent = hud.teams?.[0]?.short || hud.teamNames?.[0] || 'HOME'; $('#away').textContent = hud.teams?.[1]?.short || hud.teamNames?.[1] || 'AWAY';
  $('#home').style.borderColor = hud.teams?.[0]?.primary || ''; $('#away').style.borderColor = hud.teams?.[1]?.primary || '';
  $('#score').textContent = `${hud.score[0]} : ${hud.score[1]}`; $('#clock').textContent = `${hud.period ? hud.period + ' ' : ''}${clock(hud.clock)}`;
  $('#message').textContent = hud.message || '';
  $('#ticker').replaceChildren(...(hud.ticker || []).map(item => Object.assign(document.createElement('li'), { textContent: item.text })));
  $('#progress').textContent = `Tick ${replay.tick} / ${replay.length} · ${replay.diverged === null ? `${replay.verified} ticks match the recording` : `DIVERGED at tick ${replay.diverged}`}`;
  $('#progress').classList.toggle('bad', replay.diverged !== null);
}
requestAnimationFrame(animate);

$('#file').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) load(file).catch(error => { $('#status').textContent = error.message; }); });
$('#pause').addEventListener('click', () => { if (replay) { replay.paused = !replay.paused; $('#pause').textContent = replay.paused ? 'Play' : 'Pause'; } });
