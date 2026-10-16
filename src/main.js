import * as storage from './storage.js';
import { digest, progressKey, validateCheckpoint, validateCartridge, KEY_BITS, padMask } from './identity.js';
import { GbaAdapter } from './adapter.js';
import { loadApplicationConfig, configuredGames, validateGameBinding } from './application.js';
import { sampleStandardGamepad } from './gamepad.js';

const $ = selector => document.querySelector(selector);
const avatars = ['🦊', '🐸', '🤖', '👾'];
let avatar = avatars[0], profile, profiles = [], games = [], runtime, session, application, busy = false;
let keyboard = new Set(), inputMask = -1, padArmed = false, padPrevious = [], lastPadAction = 0;
let neighborhoodOpen = false, neighborhoodPose, neighborhood, neighborhoodLaunch = 0, neighborhoodEntryPending = false;
let worldProfilePending = false, shellPadDevice = null, shellPadIndex = null;
const timings = [];
window.__gameverseTimings = timings;
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function notice(message) { $('#notice').textContent = message; }
async function timed(operation, context, work) {
  const start = performance.now(); let outcome = 'passed';
  try { return await work(); } catch (error) { outcome = 'failed'; throw error; }
  finally {
    const report = { runId: crypto.randomUUID(), operation, context, outcome, wallMs: performance.now() - start, timestamp: new Date().toISOString(), queueMs: null, loop: null };
    timings.push(report);
    // Reporting failure must not turn a confirmed checkpoint into a failed save.
    storage.put(`timing:${report.runId}`, report).catch(() => {});
  }
}
function setProfile(value) {
  profile = value;
  $('#profile-button').textContent = value ? `${value.avatar}  ${value.name}  ↗` : 'Create character ↗';
  $('#world-character').textContent = value ? `${value.avatar}  ${value.name} · change character` : 'Choose character';
}
async function refreshGames() {
  const response = await fetch('/games/catalog.json');
  if (!response.ok) throw Error('The local game catalog is unavailable. Start with npm run dev.');
  games = configuredGames(application, await response.json());
  await renderGames();
}
async function renderGames() {
  $('#games').replaceChildren();
  $('#collection-count').textContent = String(games.length).padStart(2, '0');
  $('#games').classList.toggle('single-game', games.length === 1);
  for (const game of games) {
    let head;
    if (profile && game.ready) head = await storage.get(progressKey(identityFor(game)));
    const card = document.createElement('article'); card.className = `game-card ${game.id}`;
    card.innerHTML = `<div class="game-art"><div class="art-label"><span>GAME BOY ADVANCE</span><span>${game.id === 'firered' ? '01' : '02'} / GBA</span></div>${game.id === 'firered'
      ? '<div class="pixel-sun"></div><div class="land land-back"></div><div class="land land-front"></div><div class="tree tree-one"></div><div class="tree tree-two"></div><div class="art-title">FIRE<span>RED</span></div><span class="art-caption">A whole world awaits.</span>'
      : game.id === 'mzm-emerald-wilds-v2' ? '<div class="wilds-moon"></div><div class="wilds-canopy canopy-back"></div><div class="wilds-canopy canopy-front"></div><div class="wilds-route"></div><div class="wilds-seed">✦</div><div class="art-title wilds-title">METROID<small>×</small><span>EMERALD</span><em>WILDS</em></div><span class="art-caption">Something familiar lives in the unknown.</span>'
      : game.id === 'mzm-emerald-encounters-v1' ? '<div class="encounter-planet"></div><div class="encounter-ridge ridge-back"></div><div class="encounter-ridge ridge-front"></div><div class="encounter-orbit"></div><div class="encounter-core">✳</div><div class="art-title encounter-title">METROID<small>×</small><span>EMERALD</span></div><span class="art-caption">A familiar world. A tactical encounter.</span>'
      : '<div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="coin coin-one"></div><div class="coin coin-two"></div><div class="pipe pipe-one"></div><div class="pipe pipe-two"></div><div class="art-title">SUPER<br>MARIO<span>ADVANCE 4</span></div><span class="art-caption">One more adventure.</span>'}</div><div class="card-info"><div class="card-top"><span class="eyebrow">${game.id === 'firered' ? 'EXPLORE · COLLECT · BATTLE' : game.id === 'mzm-emerald-wilds-v2' ? 'EXPLORE · DISCOVER · BATTLE' : game.id === 'mzm-emerald-encounters-v1' ? 'EXPLORE · ENCOUNTER · ADAPT' : 'RUN · JUMP · DISCOVER'}</span><span class="game-state ${game.ready ? 'ready' : ''}">${game.ready ? 'SOURCE BUILT' : 'BUILD PENDING'}</span></div><h3>${escapeHtml(game.name)}</h3><p class="game-subtitle">${game.subtitle ? escapeHtml(game.subtitle) : 'The Kanto adventure, from the beginning.'}</p><div class="card-bottom"><p>${head ? `Last saved ${new Date(head.savedAt).toLocaleString()}` : game.ready ? 'A fresh adventure is waiting.' : escapeHtml(game.reason)}</p><button data-game="${game.id}" ${game.ready ? '' : 'disabled'}>${head ? 'Continue' : 'Play'} <span>↗</span></button></div>${game.ready ? '<p class="qualification">Development build · campaign qualification pending</p>' : ''}${game.id === 'mzm-emerald-wilds-v2' ? '<p class="native-encounter-controls">Touch a wild Pokémon to encounter · D-pad + A: choose · B: party / moves · Select in battle: retreat</p><p class="qualification">Party persists in checkpoints; vanilla cartridge saves do not retain it.</p>' : game.id === 'mzm-emerald-encounters-v1' ? '<p class="native-encounter-controls">Select: encounter · D-pad + A: choose · B: party / moves · Select in battle: retreat</p>' : ''}</div>`;
    card.querySelector('[data-game]').onclick = () => startGame(game).catch(handleError);
    $('#games').append(card);
  }
}
function identityFor(game) {
  return { profileId: profile.id, gameId: game.id, cartridgeSha256: game.receipt.sha256, wasmSha256: runtime.wasmSha256, loaderSha256: runtime.loaderSha256, adapter: runtime.adapter, snapshotFormat: runtime.snapshotFormat };
}
function clearInput() { keyboard.clear(); inputMask = -1; padArmed = false; session?.adapter?.input(0); }
function showProfile() {
  $('#existing-profiles').replaceChildren();
  for (const existing of profiles) {
    const button = document.createElement('button'); button.className = 'existing-profile'; button.textContent = `${existing.avatar} ${existing.name} →`;
    button.onclick = async () => {
      if (busy) return;
      busy = true; let selected = false;
      try { await storage.put('selected-profile', existing.id); setProfile(existing); await renderGames(); selected = true; }
      catch (error) { handleError(error); }
      finally { busy = false; if (selected) $('#profile-dialog').close('selected'); }
    };
    $('#existing-profiles').append(button);
  }
  clearInput(); $('#profile-dialog').returnValue = ''; $('#profile-dialog').showModal();
}
async function startGame(game, mode = 'snapshot', origin = 'collection') {
  if (busy || session || neighborhoodOpen) return;
  if (!profile) { showProfile(); notice('Create or select your character, then choose a game.'); return; }
  busy = true; notice('Loading your adventure…');
  let current, release;
  try {
    validateGameBinding(application, game, runtime);
    release = await storage.acquireSessionLock(`session:${profile.id}:${game.id}`);
    const identity = identityFor(game), key = progressKey(identity);
    current = { game, identity, key, release, origin, state: 'loading', head: await storage.get(key) || { revision: 0 } };
    session = current;
    $('#profile-button').disabled = true;
    $('#save-return').textContent = origin === 'neighborhood' ? 'Save & return to Gameverse' : 'Save & return to collection';
    const romResponse = await fetch(game.artifactUrl);
    if (!romResponse.ok) throw Error('Built cartridge is unavailable. The confirmed progress is retained.');
    const rom = new Uint8Array(await romResponse.arrayBuffer());
    if (await digest(rom) !== identity.cartridgeSha256) throw Error('Cartridge digest does not match its source-build receipt.');
    validateCartridge(rom, game.gameCode);
    let state, battery, expectedFrame;
    if (current.head.snapshotId && mode === 'snapshot') {
      const checkpoint = await storage.get(`snapshot:${current.head.snapshotId}`);
      validateCheckpoint(checkpoint, identity);
      if (await digest(checkpoint.state) !== checkpoint.sha256) throw Error('Snapshot integrity check failed.');
      state = checkpoint.state;
      expectedFrame = checkpoint.frame;
      if (checkpoint.batteryId) {
        const paired = await storage.get(`battery:${checkpoint.batteryId}`);
        if (!paired || progressKey(paired.identity) !== key || await digest(paired.bytes) !== paired.sha256) throw Error('The snapshot’s paired cartridge save is missing or invalid.');
        battery = paired.bytes;
      }
    }
    if (mode === 'battery') {
      const record = await storage.get(`battery:${current.head.batteryId}`);
      if (!record || progressKey(record.identity) !== key || await digest(record.bytes) !== record.sha256) throw Error('Confirmed in-game save is unavailable or invalid.');
      battery = record.bytes;
    }
    $('#home').hidden = true; $('#player').hidden = false; document.body.classList.add('playing-subgame');
    $('#playing-title').textContent = game.subtitle ? `${game.name}: ${game.subtitle}` : game.name;
    $('#screen').innerHTML = '<canvas width="240" height="160" aria-label="Game Boy Advance game screen"></canvas>';
    current.adapter = new GbaAdapter($('#screen canvas'), error => failSession(current, error));
    const loadContext = { ...identity, buildRunId: game.receipt.runId, mode, origin, baseConfig: { id: application.id, version: application.version, kind: application.base.kind }, expectedFrame: expectedFrame ?? null };
    await timed('load-and-restore', loadContext, async () => {
      const loaded = await current.adapter.load(rom, state, battery);
      loadContext.restoredFrame = loaded.frame;
      if (state && loaded.frame !== expectedFrame) throw Error('Restored frame does not match the confirmed checkpoint.');
    });
    if (session !== current || current.state !== 'loading') throw Error('Session stopped during loading. Retry from the collection.');
    clearInput();
    await current.adapter.resume(); current.state = 'playing';
    $('#session-status').textContent = mode === 'battery' ? 'Using the last confirmed in-game save. Previous snapshots are retained.' : state ? 'Exact confirmed snapshot restored.' : `New session. Save & return to ${origin === 'neighborhood' ? 'Gameverse' : 'the collection'} to confirm a checkpoint.`;
    notice('');
  } catch (error) {
    if (current) { current.adapter?.dispose(); failSession(current, error); }
    else { await release?.(); restoreSessionOrigin(origin, error.message); handleError(error); }
  } finally { busy = false; }
}
function failSession(current, error) {
  if (session !== current) return;
  const canResume = current.state === 'saving' || current.state === 'paused';
  clearInput(); current.state = 'failed'; current.adapter?.silence();
  $('#resume-button').hidden = !canResume || !current.adapter || current.adapter.disposed;
  $('#save-return').hidden = !current.adapter || current.adapter.disposed;
  $('#battery-fallback').hidden = !current.head.batteryId;
  $('#session-title').textContent = 'Your game needs attention.';
  $('#session-message').textContent = `${error.message} Your last confirmed checkpoint is retained. ${current.origin === 'neighborhood' ? 'Leave to return to the arcade and try again.' : 'Leave and select Continue to retry.'}`;
  $('#force-return').textContent = 'Leave without saving…'; current.confirmForce = false;
  if (!$('#session-dialog').open) $('#session-dialog').showModal();
  ($('#resume-button').hidden ? $('#force-return') : $('#resume-button')).focus();
  notice(error.message);
}
async function openMenu() {
  const current = session;
  if (!current || busy || current.state !== 'playing') return;
  current.state = 'paused'; clearInput();
  try {
    await current.adapter.pause();
    $('#session-title').textContent = 'Game paused.';
    $('#session-message').textContent = `Save & return to ${current.origin === 'neighborhood' ? 'Gameverse' : 'the collection'} to keep this exact moment. Closing the browser recovers only the last confirmed checkpoint.`;
    $('#resume-button').hidden = false; $('#save-return').hidden = false; $('#battery-fallback').hidden = true;
    $('#force-return').textContent = 'Leave without saving…'; current.confirmForce = false;
    $('#session-dialog').showModal();
    $('#resume-button').focus();
  } catch (error) { failSession(current, error); }
}
function restoreSessionOrigin(origin, message = '') {
  clearInput();
  if (origin === 'neighborhood' && neighborhood) {
    neighborhoodOpen = true; $('#neighborhood').hidden = false; $('#home').hidden = true;
    $('#profile-button').disabled = true; document.body.classList.add('exploring-neighborhood');
    neighborhood.resume(message);
  } else {
    if (application?.base.kind === 'neighborhood') openWorldMenu(message || 'Reopen Gameverse to return to your world.');
    else { $('#home').hidden = false; $('#profile-button').disabled = false; }
  }
}
async function leaveSession({ restoreOrigin = true, message = '' } = {}) {
  const current = session;
  if (!current) return;
  const wasBusy = busy; busy = true;
  try {
    session = undefined; current.adapter?.dispose(); await current.release();
    clearInput(); $('#session-dialog').close(); $('#player').hidden = true; document.body.classList.remove('playing-subgame'); $('#screen').replaceChildren();
    if (restoreOrigin) restoreSessionOrigin(current.origin, message);
    renderGames().catch(handleError);
  } finally { busy = wasBusy; }
}
async function saveAndReturn() {
  const current = session;
  if (!current || busy) return;
  busy = true; $('#save-return').disabled = true; $('#force-return').disabled = true;
  current.state = 'saving'; clearInput();
  try {
    const captured = await timed('snapshot-capture', current.identity, () => current.adapter.checkpoint());
    const savedAt = new Date().toISOString();
    const battery = captured.battery ? { id: crypto.randomUUID(), identity: current.identity, bytes: captured.battery, sha256: await digest(captured.battery), savedAt } : null;
    const checkpoint = { id: crypto.randomUUID(), identity: current.identity, state: captured.state, sha256: await digest(captured.state), frame: captured.frame, savedAt, batteryId: battery?.id || null };
    await timed('checkpoint-commit', current.identity, () => storage.commitCheckpoint(current.key, current.head.revision, checkpoint, battery));
    await leaveSession({ message: 'Moment saved. Enter the arcade whenever you want to continue.' }); notice('Moment saved. Your adventure will be here when you return.');
  } catch (error) { failSession(current, error); }
  finally { busy = false; $('#save-return').disabled = false; $('#force-return').disabled = false; }
}
function handleError(error) { notice(error.message || String(error)); }
async function enterFireRedFromNeighborhood() {
  const sourceWorld = neighborhood;
  if (!sourceWorld || !neighborhoodOpen || busy || session || neighborhoodEntryPending) {
    sourceWorld?.resume('Finish the current action, then try the arcade again.'); return;
  }
  neighborhoodEntryPending = true;
  const stillHere = () => neighborhood === sourceWorld && neighborhoodOpen;
  try {
    if (!profile) {
      await new Promise(resolve => {
        $('#profile-dialog').addEventListener('close', resolve, { once: true });
        showProfile();
      });
      if (!stillHere()) return;
      if (!profile || $('#profile-dialog').returnValue !== 'selected') { sourceWorld.resume('Choose a character when you are ready to play FireRed.'); return; }
    }
    // Refresh readiness at the entrance so a missing or newly built cartridge is reported accurately.
    await refreshGames();
    if (!stillHere()) return;
    const game = games.find(item => item.id === 'firered');
    if (!game?.ready) throw Error(game?.reason || 'FireRed is not ready. Build the local cartridge, then try the arcade again.');
    if (!runtime) throw Error('The game runtime is unavailable. Reload Gameverse before trying again.');
    sourceWorld.suspend(); neighborhoodOpen = false; $('#neighborhood').hidden = true;
    document.body.classList.remove('exploring-neighborhood'); clearInput();
    await startGame(game, 'snapshot', 'neighborhood');
    if (!session && !neighborhoodOpen) restoreSessionOrigin('neighborhood', 'FireRed did not start. Try the arcade again.');
  } catch (error) {
    if (neighborhood === sourceWorld && !session) restoreSessionOrigin('neighborhood', error.message || 'FireRed could not open.');
  } finally { neighborhoodEntryPending = false; }
}
async function exploreNeighborhood() {
  if (busy || session || neighborhoodOpen) return;
  const launch = ++neighborhoodLaunch;
  neighborhoodOpen = true; clearInput(); notice('');
  $('#profile-button').disabled = true; $('#home').hidden = true; $('#neighborhood').hidden = false;
  document.body.classList.add('exploring-neighborhood');
  const showMenu = pose => {
    if (launch !== neighborhoodLaunch) return;
    neighborhoodPose = pose || neighborhoodPose; openWorldMenu();
  };
  try {
    const { openNeighborhood } = await import('./neighborhood.js');
    const opened = await openNeighborhood($('#neighborhood'), showMenu, neighborhoodPose, enterFireRedFromNeighborhood,
      { title: application.title, location: application.base.location, hasFireRed: application.subgames.some(game => game.id === 'firered') });
    if (launch === neighborhoodLaunch) {
      neighborhood = opened;
      if ($('#world-menu').open) { opened.suspend(); updateWorldMenu(); }
    }
    else opened.dispose();
  } catch (error) {
    neighborhood?.dispose(); neighborhood = undefined; neighborhoodOpen = false;
    $('#neighborhood').hidden = true; openWorldMenu(error.message || 'Gameverse could not open. Try reopening your world.');
  }
}
function updateWorldMenu() {
  const state = neighborhood?.observe().state;
  $('#world-resume').disabled = !neighborhood || state === 'failed' || state === 'disposed';
  $('#world-reload').hidden = !$('#world-resume').disabled;
  $('#world-menu-close').hidden = $('#world-resume').disabled;
  $('#world-menu-title').textContent = application?.title || 'Gameverse';
}
function openWorldMenu(message = '') {
  if (session || busy || worldProfilePending || $('#profile-dialog').open) return;
  clearInput(); neighborhood?.suspend(); updateWorldMenu();
  $('#world-menu-message').textContent = message || 'Your world is paused. FireRed is waiting at Alder Arcade.';
  if (!$('#world-menu').open) { $('#world-menu').returnValue = ''; $('#world-menu').showModal(); }
  ($('#world-resume').disabled ? $('#world-reload') : $('#world-resume')).focus();
}
$('#world-resume').onclick = () => $('#world-menu').close('resume');
$('#world-menu-close').onclick = () => $('#world-menu').close('resume');
$('#world-menu').addEventListener('cancel', event => { if ($('#world-resume').disabled) event.preventDefault(); });
$('#world-menu').addEventListener('close', () => {
  clearInput();
  if (['character', 'reload'].includes($('#world-menu').returnValue)) return;
  if (neighborhood && !session) neighborhood.resume();
});
$('#world-character').onclick = () => {
  if (busy || session) return;
  worldProfilePending = true; $('#world-menu').close('character'); showProfile();
};
$('#profile-dialog').addEventListener('close', () => {
  clearInput();
  if (worldProfilePending) { worldProfilePending = false; openWorldMenu(); }
});
$('#world-reload').onclick = async () => {
  if (busy || session) return;
  $('#world-menu').close('reload');
  neighborhood?.dispose(); neighborhood = undefined; neighborhoodOpen = false;
  await exploreNeighborhood();
};
$('#reload-application').onclick = () => location.reload();
$('#profile-button').onclick = showProfile;
$('#refresh-games').onclick = () => refreshGames().catch(handleError);
$('#avatars').innerHTML = avatars.map((value, index) => `<button type="button" aria-label="${['Fox', 'Frog', 'Robot', 'Alien'][index]} avatar" aria-pressed="${index === 0}">${value}</button>`).join('');
$('#avatars').onclick = event => { const button = event.target.closest('button'); if (!button) return; avatar = button.textContent; for (const choice of $('#avatars').children) choice.setAttribute('aria-pressed', String(choice === button)); };
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); const name = $('#character-name').value.trim(); if (!name || busy) return;
  busy = true;
  let release, selected = false;
  try {
    release = await storage.acquireSessionLock('profiles');
    const latest = await storage.get('profiles') || [];
    const created = { id: crypto.randomUUID(), name, avatar };
    await storage.put('profiles', [...latest, created]); await storage.put('selected-profile', created.id);
    profiles = [...latest, created]; setProfile(created); await renderGames(); selected = true; notice(`Welcome, ${name}. Pick your adventure.`);
  } catch (error) { handleError(error); } finally { await release?.(); busy = false; if (selected) $('#profile-dialog').close('selected'); }
};
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => { $(`#${button.dataset.close}`).close(); clearInput(); };
$('#show-letters').onclick = () => { $('#letters').hidden = !$('#letters').hidden; };
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890←') {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = letter === ' ' ? '␣' : letter;
  button.setAttribute('aria-label', letter === '←' ? 'Backspace' : letter === ' ' ? 'Space' : letter);
  button.onclick = () => { const field = $('#character-name'); field.value = letter === '←' ? field.value.slice(0, -1) : (field.value + letter).slice(0, 24); };
  $('#letters').append(button);
}
$('#menu-button').onclick = openMenu;
$('#resume-button').onclick = async () => {
  if (busy || !session) return;
  const current = session; busy = true;
  try { clearInput(); await current.adapter.resume(); clearInput(); current.state = 'playing'; $('#session-dialog').close(); }
  catch (error) { failSession(current, error); }
  finally { busy = false; }
};
$('#save-return').onclick = saveAndReturn;
$('#force-return').onclick = async () => {
  if (busy || !session) return;
  if (!session.confirmForce) { session.confirmForce = true; $('#force-return').textContent = 'Confirm leave — discard unconfirmed progress'; return; }
  await leaveSession({ message: 'Returned without a new checkpoint. Only previously confirmed progress is available.' }); notice('Returned without a new checkpoint. Only previously confirmed progress is available.');
};
$('#session-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!$('#resume-button').hidden) $('#resume-button').click(); });
$('#feedback-button').onclick = () => { $('#session-message').textContent = 'The improvement harness is not connected in this slice. No request was queued.'; };
$('#battery-fallback').onclick = async () => {
  if (busy || !session) return;
  const { game, origin } = session;
  await leaveSession({ restoreOrigin: false }); await startGame(game, 'battery', origin);
};
$('#download-save').onclick = async () => {
  try {
    const id = session?.head.batteryId;
    if (!id) throw Error('No confirmed in-game save yet. Save & return first.');
    const record = await storage.get(`battery:${id}`);
    const url = URL.createObjectURL(new Blob([record.bytes]));
    const link = document.createElement('a'); link.href = url; link.download = `${session.game.id}-${id}.sav`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { handleError(error); }
};
window.addEventListener('keydown', event => {
  if (event.repeat && (event.code === 'Enter' || event.code === 'Space')) event.preventDefault();
  if (event.code === 'Escape' && session?.state === 'playing') { event.preventDefault(); openMenu(); return; }
  if (session?.state !== 'playing' || !KEY_BITS[event.code]) return;
  event.preventDefault(); if (!event.repeat) keyboard.add(event.code);
});
window.addEventListener('keyup', event => keyboard.delete(event.code));
window.addEventListener('blur', () => { clearInput(); openMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); openMenu(); } });
window.addEventListener('gamepaddisconnected', () => { clearInput(); openMenu(); });
window.addEventListener('beforeunload', event => { if (session) { event.preventDefault(); event.returnValue = ''; } });
function focusDirection(direction) {
  const scope = $('dialog[open]') || $('#home');
  const candidates = [...scope.querySelectorAll('button:not(:disabled), input, a')].filter(el => el.getClientRects().length);
  const active = document.activeElement;
  if (!candidates.includes(active)) { candidates[0]?.focus(); return; }
  const a = active.getBoundingClientRect(), x = a.x + a.width / 2, y = a.y + a.height / 2;
  const ranked = candidates.filter(el => el !== active).map(el => {
    const b = el.getBoundingClientRect(), dx = b.x + b.width / 2 - x, dy = b.y + b.height / 2 - y;
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    return { el, score: along > 5 ? along + across * 3 : Infinity };
  }).sort((a, b) => a.score - b.score);
  if (Number.isFinite(ranked[0]?.score)) ranked[0].el.focus();
}
function pollInput(now) {
  // A controller must not activate a focused button in an inactive browser tab.
  // Saving/loading also suspend menu actions; held buttons must be released afterward.
  if (document.hidden || !document.hasFocus() || busy) {
    if (padArmed || keyboard.size || inputMask !== -1) clearInput();
    padArmed = false; padPrevious = []; requestAnimationFrame(pollInput); return;
  }
  // The world owns keyboard/mouse focus; do not navigate or activate hidden shell controls.
  if (neighborhoodOpen && !$('dialog[open]')) { padArmed = false; padPrevious = []; requestAnimationFrame(pollInput); return; }
  const pads = [...(navigator.getGamepads?.() || [])];
  const sampled = sampleStandardGamepad(pads, shellPadIndex);
  const pad = pads.find(p => p?.connected && p.index === sampled.index && p.mapping === 'standard');
  const device = pad ? `${pad.index}:${pad.id}` : null;
  if (device !== shellPadDevice) {
    const lostActiveDevice = shellPadDevice !== null;
    clearInput(); padPrevious = []; shellPadDevice = device; shellPadIndex = sampled.index;
    if (lostActiveDevice) openMenu();
  }
  const mask = padMask(pad);
  const buttons = pad ? pad.buttons.map(b => b.pressed) : [];
  const neutral = sampled.neutral;
  if (pad && neutral) padArmed = true;
  if (padArmed) {
    const pressed = i => buttons[i] && !padPrevious[i];
    if (session?.state === 'playing') {
      // Start/Back remain GBA Start/Select. Y is the Gameverse host menu.
      if (pressed(3) || pressed(16) || (buttons[6] && buttons[7])) { openMenu(); padArmed = false; }
    } else {
      const dialog = $('dialog[open]');
      if (dialog && (pressed(1) || (dialog.id === 'world-menu' && pressed(9)))) {
        if (dialog.id === 'session-dialog') {
          if (!$('#resume-button').hidden && !$('#resume-button').disabled) $('#resume-button').click();
        } else if (dialog.id === 'world-menu') {
          if (!$('#world-resume').disabled) $('#world-resume').click();
        } else dialog.close('cancel');
        clearInput(); lastPadAction = now;
      } else if (pressed(0)) { document.activeElement?.click(); lastPadAction = now; padArmed = false; }
      else if ((mask & 240) && now - lastPadAction > 180) { focusDirection(mask & 64 ? 'up' : mask & 128 ? 'down' : mask & 32 ? 'left' : 'right'); lastPadAction = now; }
    }
  }
  if (session?.state === 'playing') {
    const next = [...keyboard].reduce((mask, code) => mask | KEY_BITS[code], padArmed ? mask : 0);
    if (next !== inputMask) { inputMask = next; session.adapter.input(next); }
  }
  padPrevious = buttons;
  $('#controller-status').textContent = pad ? `${pad.id} · controller ready` : 'Keyboard ready · Connect a controller to play';
  $('#world-controller-status').textContent = pad ? 'Left stick / D-pad · choose · A · select · B · back' : 'Keyboard + mouse · press a controller button to connect';
  requestAnimationFrame(pollInput);
}
requestAnimationFrame(pollInput);
let healthPending = false;
setInterval(async () => {
  const current = session;
  if (!current || current.state !== 'playing' || document.hidden || healthPending) return;
  healthPending = true;
  try {
    const health = await current.adapter.request('health');
    if (session !== current || current.state !== 'playing') return;
    if (health.frame === current.lastFrame) throw Error('Game execution stopped advancing. Return or retry from the last checkpoint.');
    current.lastFrame = health.frame;
  } catch (error) { failSession(current, error); } finally { healthPending = false; }
}, 2000);
try {
  application = await loadApplicationConfig(location.pathname);
  window.__gameverseApplication = application;
  document.title = application.base.kind === 'neighborhood' ? application.title : `${application.title} · Your games, your world`;
  document.body.classList.toggle('world-application', application.base.kind === 'neighborhood');
  $('.brand').href = application.base.entryPath;
  profiles = await storage.get('profiles') || [];
  const selected = await storage.get('selected-profile');
  setProfile(profiles.find(p => p.id === selected));
  const response = await fetch('/runtime/identity.json'); if (!response.ok) throw Error('Runtime identity unavailable.'); runtime = await response.json();
  await refreshGames();
  $('#application-loading').hidden = true; document.body.classList.remove('application-loading');
  if (application.base.kind === 'neighborhood') await exploreNeighborhood();
  else {
    document.body.dataset.view = new URLSearchParams(location.search).get('view') || 'play';
    const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/workshop.css'; document.head.append(sheet);
    $('#home').hidden = false;
    import('./workshop.js').catch(handleError);
  }
} catch (error) {
  $('#application-loading').hidden = true; document.body.classList.remove('application-loading'); document.body.classList.add('application-failed');
  $('#application-error').hidden = false; $('#application-error-message').textContent = error.message || 'Gameverse could not open.';
}
