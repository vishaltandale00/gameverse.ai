import { GbaAdapter } from './adapter.js';
import { digest, KEY_BITS, validateCartridge } from './identity.js';
const runPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const maxRomBytes = 32 * 1024 * 1024;

// Construct a same-origin artifact path; never follow an artifact-supplied URL.
export async function fetchResultRom(runId, { signal, fetcher = fetch } = {}) {
  if (typeof runId !== 'string' || !runPattern.test(runId)) throw Error('Invalid creation request ID.');
  const endpoint = `/api/mashup/runs/${runId}`;
  const options = { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' };
  const response = await fetcher(endpoint, options);
  if (!response.ok) throw Error('Could not load this creation request.');
  const record = await response.json();
  if (record.request_id !== runId || record.status !== 'completed' || record.playable !== true || record.qualification?.outcome !== 'pass') throw Error('This creation is not ready to play. A passing native qualification is required.');
  if (!/^[a-f0-9]{64}$/.test(record.artifact?.sha256 || '')) throw Error('The creation has no valid artifact receipt.');
  const cartridge = await fetcher(`${endpoint}/artifacts/rom`, options);
  if (!cartridge.ok) throw Error('The verified game artifact could not be loaded.');
  if (Number(cartridge.headers?.get('content-length')) > maxRomBytes) throw Error('Invalid GBA cartridge size.');
  const rom = new Uint8Array(await cartridge.arrayBuffer());
  if (rom.length < 192 || rom.length > maxRomBytes) throw Error('Invalid GBA cartridge size.');
  if (await digest(rom) !== record.artifact.sha256) throw Error('The game artifact does not match its creation receipt.');
  validateCartridge(rom, new TextDecoder().decode(rom.subarray(0xac, 0xb0)));
  return { rom, title: record.artifact.title || 'Your mashup', sha256: record.artifact.sha256 };
}

export function mountResultPlayer(host, { runId } = {}) {
  host.innerHTML = `<section class="result-player" aria-label="Created game player" tabindex="0">
    <h2 class="result-player-title">Your created game</h2>
    <p class="result-player-status" role="status" aria-live="polite">Loading creation receipt…</p>
    <div class="result-player-screen"></div>
    <div class="result-player-actions"><button type="button" data-action="play" disabled>Play</button><button type="button" data-action="reset" disabled>Reset game</button></div>
    <p class="result-player-help">Click Play, then use arrow keys to move, X for A, Z for B, Enter for Start, right Shift for Select, A / S for L / R. Escape pauses. Reset starts this game over. Progress is kept only while this player is open.</p>
    <div class="result-player-touch" aria-label="Game controls"></div>
  </section>`;
  const section = host.querySelector('.result-player');
  const status = section.querySelector('.result-player-status');
  const title = section.querySelector('.result-player-title');
  const screen = section.querySelector('.result-player-screen');
  const play = section.querySelector('[data-action="play"]');
  const reset = section.querySelector('[data-action="reset"]');
  const touch = section.querySelector('.result-player-touch');
  const listeners = new AbortController();
  let loading, adapter, artifact, disposed = false, playing = false, busy = false, epoch = 0, pauseVersion = 0;
  const keys = new Set(), pointers = new Map();
  const on = (target, event, fn) => target.addEventListener(event, fn, { signal: listeners.signal });
  function input() {
    const mask = [...keys].reduce((value, code) => value | KEY_BITS[code], 0) | [...pointers.values()].reduce((value, bit) => value | bit, 0);
    adapter?.input(playing ? mask : 0);
  }
  function clearInput() { keys.clear(); pointers.clear(); adapter?.input(0); }
  function fail(error) {
    if (disposed) return;
    playing = false; busy = false; clearInput(); adapter?.dispose(); adapter = null;
    status.textContent = `Could not play this game: ${error.message}`;
    play.disabled = true; reset.disabled = !artifact; play.textContent = 'Play';
  }
  async function pause() {
    ++pauseVersion;
    if (!playing || !adapter) return;
    const current = epoch;
    playing = false; clearInput(); play.disabled = true;
    try { await adapter.pause(); if (!disposed && current === epoch) { status.textContent = 'Paused. Press Play to continue.'; play.textContent = 'Play'; play.disabled = false; } }
    catch (error) { if (current === epoch) fail(error); }
  }
  async function initialize() {
    const current = ++epoch;
    playing = false; busy = true; clearInput(); adapter?.dispose(); adapter = null;
    play.disabled = true; reset.disabled = true; play.textContent = 'Play';
    status.textContent = 'Loading the verified game…';
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
    canvas.setAttribute('aria-label', 'Created game screen'); screen.replaceChildren(canvas);
    try {
      const next = new GbaAdapter(canvas, error => { if (current === epoch) fail(error); }); adapter = next;
      await next.load(artifact.rom);
      if (disposed || current !== epoch) return;
      busy = false; play.disabled = false; reset.disabled = false;
      status.textContent = 'Ready. Press Play to start your game.';
    } catch (error) { if (current === epoch) fail(error); }
  }
  async function load(id) {
    if (disposed) return;
    ++epoch; loading?.abort(); loading = new AbortController();
    adapter?.dispose(); adapter = null; artifact = null; playing = false; busy = true; clearInput();
    screen.replaceChildren(); play.disabled = true; reset.disabled = true; status.textContent = 'Loading creation receipt…';
    const current = epoch;
    try {
      const result = await fetchResultRom(id, { signal: loading.signal });
      if (disposed || current !== epoch) return;
      artifact = result; title.textContent = result.title; await initialize();
    } catch (error) { if (!disposed && current === epoch) fail(error); }
  }
  on(play, 'click', async () => {
    if (playing) { await pause(); return; }
    if (busy || !adapter) return;
    busy = true; play.disabled = true;
    const current = epoch, requestedPauseVersion = pauseVersion;
    try {
      await adapter.resume();
      if (disposed || current !== epoch) return;
      if (requestedPauseVersion !== pauseVersion) {
        await adapter.pause();
        if (disposed || current !== epoch) return;
        busy = false; play.disabled = false; status.textContent = 'Paused. Press Play to continue.'; return;
      }
      playing = true; busy = false; play.disabled = false; play.textContent = 'Pause'; status.textContent = 'Playing your created game.'; section.focus();
    } catch (error) { if (current === epoch) fail(error); }
  });
  on(reset, 'click', () => { if (artifact && !busy) void initialize(); });
  on(section, 'keydown', event => {
    if (!playing || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName) || event.target.isContentEditable) return;
    if (event.code === 'Escape') { event.preventDefault(); void pause(); return; }
    if (KEY_BITS[event.code]) { event.preventDefault(); keys.add(event.code); input(); }
  });
  on(window, 'keyup', event => { if (keys.delete(event.code)) input(); });
  on(section, 'focusout', event => { if (!section.contains(event.relatedTarget)) { clearInput(); void pause(); } });
  on(window, 'blur', () => { clearInput(); void pause(); });
  on(document, 'visibilitychange', () => { if (document.hidden) { clearInput(); void pause(); } });
  for (const [label, bit] of [['↑', 64], ['←', 32], ['↓', 128], ['→', 16], ['A', 1], ['B', 2], ['Start', 8], ['Select', 4], ['L', 512], ['R', 256]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', `Game ${label}`); touch.append(button);
    on(button, 'pointerdown', event => { if (!playing) return; event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.set(event.pointerId, bit); input(); });
    const release = event => { pointers.delete(event.pointerId); input(); };
    on(button, 'pointerup', release); on(button, 'pointercancel', release); on(button, 'lostpointercapture', release);
  }
  if (runId) void load(runId);
  return { load, pause, destroy() { disposed = true; ++epoch; loading?.abort(); clearInput(); listeners.abort(); adapter?.dispose(); adapter = null; host.replaceChildren(); } };
}
