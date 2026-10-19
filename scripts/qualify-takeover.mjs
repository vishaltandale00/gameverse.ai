#!/usr/bin/env node
// Portable rendered qualification runner. It drives the real app in a real
// browser over CDP (using the existing `ws` dependency: no Playwright, no
// download), captures whole-DOM frames with timestamps, and hands the retained
// evidence to the separate verifier. It never injects a transcript, never calls
// a gameplay tool, and never reads or prints a credential: the browser talks
// only to the local server, which holds the key.
//
//   CHROME_PATH=/path/to/browser SOURCE_COMMIT=<sha> node scripts/qualify-takeover.mjs [options]
//
// Options
//   --prerequisites-only   renderer/audio/recorder capability probe, zero provider calls
//   --assume-profile       skip profile bootstrap: a character already exists in
//                          this browser profile (create one by hand in a headed run)
//   --bootstrap-only       also create the qualification player profile through the
//                          real UI and confirm the voice button is usable; still
//                          zero provider calls (it stops before the first command)
//   --headed               run with a visible window
//   --swiftshader          force software GL (headless Linux without a GPU)
//   --external-server      do not spawn scripts/serve.mjs; use --url
//   --url=<origin>         app origin (default http://127.0.0.1:4173)
//   --out=<dir>            evidence directory (default verification/qualification-<stamp>)
//   --no-recording         skip frame capture
//   --gameplay-seconds=N   gameplay budget (default 240, hard cap)
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { platform } from 'node:process';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = (name, fallback) => (args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')) ?? fallback;

// Every provider attempt counts, including failures. There are no retries.
export const CAPS = { decisions: 600, reflect: 6, plan: 4, speech: 4, transcription: 4, gameplaySeconds: Number(value('gameplay-seconds', 240)) };
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = value('out', `verification/qualification-${STAMP}`);
const PORT = Number(value('port', process.env.PORT || 4186));
const ORIGIN = value('url', `http://127.0.0.1:${PORT}`);
const COMMAND = value('command', 'Take over soccer and try to score');
const STOP_COMMAND = value('stop-command', 'Stop the soccer simulated user');
const OVERWORLD_COMMAND = value('overworld-command', 'Also take over my character in the overworld and walk around');

const browserCandidates = () => [
  process.env.CHROME_PATH,
  ...(platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : []),
  ...(platform === 'linux' ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'] : []),
  ...(platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe'] : []),
].filter(Boolean);

const log = (...parts) => console.log(`[qualify ${new Date().toISOString()}]`, ...parts);

// --- minimal CDP client over the existing ws dependency ----------------------
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); });
    this.socket.on('close', () => this.abortPending(Error('CDP disconnected')));
    this.socket.on('error', error => this.abortPending(error));
    this.socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id); clearTimeout(timer); this.pending.delete(message.id);
        message.error ? reject(Object.assign(Error(message.error.message), { data: message.error })) : resolve(message.result);
      } else if (message.method) for (const handler of this.handlers.get(message.method) || []) handler(message.params);
    });
    return this;
  }
  abortPending(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  on(method, handler) { this.handlers.set(method, [...(this.handlers.get(method) || []), handler]); }
  send(method, params = {}, sessionId) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('CDP disconnected'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(Error(`CDP timeout: ${method}`)); }, 15000); timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));

    });
  }
  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw Error(`page error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  }
  close() { this.abortPending(Error('CDP closed')); this.socket?.close(); }
}

const until = async (check, { timeoutMs = 30000, everyMs = 250, label = 'condition' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
};

// --- renderer / audio prerequisites (no provider call) -----------------------
const PREREQUISITES = `(async () => {
  const report = { userAgent: navigator.userAgent, webgl: null, webgl2: null, audio: null, mediaRecorder: null, mediaStreamDestination: null };
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2'), gl = gl2 || canvas.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      report.webgl = { ok: true, version: gl.getParameter(gl.VERSION),
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
      report.webgl2 = Boolean(gl2);
    } else report.webgl = { ok: false, reason: 'no webgl context' };
  } catch (error) { report.webgl = { ok: false, reason: error.message }; }
  try {
    // A real 8 kHz mono WAV, decoded by the browser's own audio pipeline.
    const samples = 800, header = new ArrayBuffer(44 + samples * 2), view = new DataView(header);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 12000), true);
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await context.decodeAudioData(header);
    const destination = context.createMediaStreamDestination();
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start();
    report.audio = { ok: true, seconds: buffer.duration, sampleRate: context.sampleRate, state: context.state };
    report.mediaStreamDestination = { ok: true, tracks: destination.stream.getTracks().length };
    report.mediaRecorder = { ok: typeof MediaRecorder === 'function',
      webm: typeof MediaRecorder === 'function' && MediaRecorder.isTypeSupported('audio/webm'),
      mp4: typeof MediaRecorder === 'function' && MediaRecorder.isTypeSupported('audio/mp4') };
  } catch (error) { report.audio = { ok: false, reason: error.message }; }
  return report;
})()`;

let userDataDirUsed = null;
async function launch() {
  const executable = browserCandidates().find(path => existsSync(path));
  if (!executable) throw Error(`No browser found. Set CHROME_PATH. Tried: ${browserCandidates().join(', ')}`);
  // Outside the repo and outside the evidence directory: a Chrome profile holds
  // absolute symlinks and caches that must never enter a source archive.
  const userDataDir = `${tmpdir()}/gameverse-qualify-${STAMP}`;
  await mkdir(userDataDir, { recursive: true });
  const browserArgs = [
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
    '--window-size=1280,800',
  ];
  if (!flag('headed')) browserArgs.push('--headless=new');
  // Software GL only when asked for: a real GPU is preferred for rendered proof.
  if (flag('swiftshader')) browserArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  // Linux root containers need this; it is never added on macOS/Windows.
  if (platform === 'linux' && (process.getuid?.() === 0 || process.env.ALLOW_NO_SANDBOX === '1')) browserArgs.push('--no-sandbox');
  userDataDirUsed = userDataDir;
  const child = spawn(executable, [...browserArgs, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString();
      const match = buffer.match(/ws:\/\/[^\s]+/);
      if (match) resolve(match[0]);
    };
    child.stderr.on('data', onData); child.stdout.on('data', onData);
    child.once('exit', code => reject(Error(`browser exited early (${code})`)));
    setTimeout(() => reject(Error('browser did not report a DevTools endpoint')), 30000);
  });
  log('browser', executable.split('/').pop(), 'devtools ready');
  return { child, wsUrl, executable };
}

async function attachPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = { send: (method, params) => browser.send(method, params, sessionId),
    evaluate: async (expression, options = {}) => {
      const result = await browser.send('Runtime.evaluate', { expression, awaitPromise: options.awaitPromise !== false, returnByValue: true, userGesture: true }, sessionId);
      if (result.exceptionDetails) throw Error(`page error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
      return result.result.value;
    }, sessionId, targetId };
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
  browser.on('Runtime.consoleAPICalled', params => { if (params.type === 'error') log('page console error:', params.args?.[0]?.value); });
  return page;
}

async function main() {
  const started = Date.now();
  await mkdir(`${OUT}/frames`, { recursive: true });
  const timings = [], note = (stage, extra = {}) => { timings.push({ stage, atMs: Date.now() - started, ...extra }); log(stage, JSON.stringify(extra)); };
  const sourceCommit = process.env.SOURCE_COMMIT || null;
  if (!sourceCommit) log('WARNING: SOURCE_COMMIT is not set; the evidence bundle will record a null source identity.');

  let recorderHandle = null;
  const report = { runner: 'qualify-takeover-v1', startedAt: new Date(started).toISOString(), sourceCommit, caps: CAPS,
    browser: null, timings };
  let server = null, serverExit = null;
  if (!flag('external-server')) {
    // The spawned server owns the configured port. A silent EADDRINUSE used to
    // let the runner probe somebody else's server on the default port, so an
    // early exit or a port clash is now a hard, reported failure.
    server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(PORT) } });
    let serverLog = '';
    server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
    server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
    server.once('exit', code => { serverExit = { code, log: serverLog.slice(-2000) }; });
    const ready = await Promise.race([
      (async () => { for (let attempt = 0; attempt < 40; attempt++) {
        if (serverExit) return false;
        if (serverLog.includes(`:${PORT}`)) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      } return false; })(),
      new Promise(resolve => setTimeout(() => resolve(false), 12000)),
    ]);
    report.server = { port: PORT, origin: ORIGIN, ready, exit: serverExit, log: serverLog.slice(-1200) };
    if (!ready || serverExit) {
      report.outcome = 'blocked';
      report.blocker = serverExit
        ? `The qualification server exited (code ${serverExit.code}). Port ${PORT} may already be in use; pass --port=<free port>.`
        : `The qualification server never reported port ${PORT}.`;
      await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
      throw Error(report.blocker);
    }
    note('server-started', { port: PORT });
  }
  const { child, wsUrl, executable } = await launch();
  const browser = await new CDP(wsUrl).connect();
  const page = await attachPage(browser);
  report.browser = { executable, headless: !flag('headed'), swiftshader: flag('swiftshader'), platform };

  try {
    // Prerequisites run against the real renderer and audio pipeline.
    await page.send('Page.navigate', { url: `${ORIGIN}/` });
    await until(() => page.evaluate('document.readyState === "complete"'), { label: 'page load' });
    report.prerequisites = await page.evaluate(PREREQUISITES);
    note('prerequisites', { webgl: report.prerequisites.webgl?.ok, renderer: report.prerequisites.webgl?.renderer, audio: report.prerequisites.audio?.ok });
    // Probe with explicit status/content-type handling: a routing miss or a
    // different server on this port must never be parsed as a provider answer.
    const probe = async route => page.evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(route)}, { cache: 'no-store' });
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { route: ${JSON.stringify(route)}, status: response.status, origin: location.origin,
        contentType: response.headers.get('content-type'), json, body: json ? null : text.slice(0, 200) };
    })()`);
    report.probes = { agent: await probe('/api/agent/config'), voice: await probe('/api/voice/config'),
      ledger: await probe('/api/agent/ledger'), identity: await probe('/runtime/identity.json') };
    const badProbe = Object.entries(report.probes).find(([, result]) => result.status !== 200 || !result.json);
    if (badProbe) {
      report.outcome = 'blocked';
      report.blocker = `Route ${badProbe[1].route} answered HTTP ${badProbe[1].status} (${badProbe[1].contentType}) at ${badProbe[1].origin}: `
        + `this is not the qualification server. Use --port=<free port> and a matching --url, or --external-server with the right origin.`;
      return report;
    }
    report.agentConfig = report.probes.agent.json;
    report.voiceConfig = report.probes.voice.json;
    // Source identity must match what the coordinator intends to qualify.
    report.serverIdentity = { sourceCommit: report.agentConfig.sourceCommit ?? null, runtime: report.probes.identity.json };
    if (sourceCommit && report.agentConfig.sourceCommit && report.agentConfig.sourceCommit !== sourceCommit) {
      report.outcome = 'blocked';
      report.blocker = `The server reports source ${report.agentConfig.sourceCommit}, not the requested ${sourceCommit}.`;
      return report;
    }
    if (report.voiceConfig.mode !== 'realtime') note('voice-mode-warning', { mode: report.voiceConfig.mode });
    note('backend', { agentAvailable: report.agentConfig?.available, voiceAvailable: report.voiceConfig?.available, voiceMode: report.voiceConfig?.mode });

    if (flag('prerequisites-only')) {
      report.outcome = 'prerequisites-only';
      report.note = 'No provider call was made. This is a capability probe, not the rendered acceptance journey.';
      return report;
    }
    if (!flag('bootstrap-only') && (!report.agentConfig?.available || !report.voiceConfig?.available)) {
      report.outcome = 'blocked';
      report.blocker = 'The local server reports no provider access (server-side key missing), so no paid call was attempted.';
      return report;
    }

    // --- rendered journey ---------------------------------------------------
    if (flag('bootstrap-only')) report.note = 'Bootstrap probe only: the player profile and voice readiness were exercised, no provider call was made.';
    const frames = [];
    const capture = async label => {
      if (flag('no-recording')) return null;
      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const index = String(frames.length).padStart(4, '0');
      const file = `${OUT}/frames/frame-${index}-${label}.png`;
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      frames.push({ index: frames.length, label, file, atMs: Date.now() - started, wallClock: new Date().toISOString() });
      return file;
    };
    let capturePending = false;
    recorderHandle = setInterval(() => { if (capturePending) return; capturePending = true; void capture('journey').catch(error => { report.recordingError = error.message; }).finally(() => { capturePending = false; }); }, 1000);
    const ledger = () => page.evaluate('fetch("/api/agent/ledger").then(r => r.json())');
    const capsBlown = async () => { const current = await ledger(); return current?.ledger?.aborted || null; };

    await page.send('Page.navigate', { url: `${ORIGIN}/?qualify=1` });
    await until(() => page.evaluate('Boolean(window.__gameverseQualification)'), { label: 'qualification harness' });
    await page.send('Page.bringToFront').catch(() => {});
    // Player profile bootstrap through the app's own character UI. This is an
    // isolated qualification profile in this run's temporary browser profile; no
    // existing player save is touched.
    report.profileBootstrap = flag('assume-profile')
      ? { created: false, skipped: 'the operator created the qualification character manually (--assume-profile)' }
      : await page.evaluate(`(async () => {
      const $ = selector => document.querySelector(selector);
      const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
      if (!$('#profile-button')?.textContent.includes('Create character')) {
        return { created: false, reason: 'a player profile already exists in this browser profile', label: $('#profile-button')?.textContent?.trim() || null };
      }
      // Two real entry points exist: the collection header button, and the world
      // menu's character item while the overworld is displayed. Use whichever the
      // app currently offers, exactly as a player would.
      const open = async () => { for (let attempt = 0; attempt < 40 && !$('#profile-dialog').open; attempt++) await settle(250); return $('#profile-dialog').open; };
      const route = { collection: false, worldMenu: false, pausedWorld: false };
      if (!$('#profile-button').disabled) { route.collection = true; $('#profile-button').click(); }
      else {
        if (!$('#world-menu').open) {
          // The overworld pauses to its own menu on blur, which is the ordinary
          // way a player reaches the character item.
          route.pausedWorld = true;
          window.dispatchEvent(new Event('blur'));
          for (let attempt = 0; attempt < 40 && !$('#world-menu').open; attempt++) await settle(250);
        }
        if (!$('#world-menu').open) {
          route.escape = true;
          for (const target of [document, window]) target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
          for (let attempt = 0; attempt < 12 && !$('#world-menu').open; attempt++) await settle(250);
        }
        if (!$('#world-menu').open && $('#menu-button')) { route.menuButton = true; $('#menu-button').click(); await settle(500); }
        if ($('#world-menu').open) { route.worldMenu = true; $('#world-character').click(); }
      }
      if (!await open()) return { created: false, error: 'the character dialog did not open', route,
        buttonDisabled: $('#profile-button').disabled, worldMenuOpen: Boolean($('#world-menu')?.open),
        dialogsOpen: [...document.querySelectorAll('dialog[open]')].map(node => node.id),
        bodyClasses: document.body.className, notice: $('#notice')?.textContent || null,
        visibleButtons: [...document.querySelectorAll('button')].filter(node => node.offsetParent !== null)
          .map(node => node.id || node.textContent.trim().slice(0, 24)).slice(0, 14),
        worldOpen: !document.querySelector('#neighborhood')?.hidden, homeHidden: Boolean(document.querySelector('#home')?.hidden) };
      const name = $('#character-name');
      name.focus();
      name.value = ${JSON.stringify(value('profile-name', 'Qualification'))};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      // The character UI is deliberately two-step: the first submit shows a
      // review, and only the explicit confirm stores the character.
      const submit = () => $('#profile-form').requestSubmit
        ? $('#profile-form').requestSubmit() : $('#profile-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      submit();
      for (let attempt = 0; attempt < 20 && $('#profile-review')?.hidden !== false; attempt++) await settle(250);
      route.reviewShown = $('#profile-review')?.hidden === false;
      if (route.reviewShown) { $('#profile-confirm')?.click(); }
      for (let attempt = 0; attempt < 40 && $('#profile-dialog').open; attempt++) await settle(250);
      if ($('#profile-dialog').open) { submit(); for (let attempt = 0; attempt < 20 && $('#profile-dialog').open; attempt++) await settle(250); }
      // After the character is created the app returns to its previous view.
      for (let attempt = 0; attempt < 20 && $('#world-menu').open; attempt++) { $('#world-resume')?.click(); await settle(250); }
      return { created: !$('#profile-dialog').open, route, label: $('#profile-button')?.textContent?.trim() || null,
        worldCharacter: $('#world-character')?.textContent?.trim() || null,
        dialogsOpen: [...document.querySelectorAll('dialog[open]')].map(node => node.id),
        error: $('#profile-dialog').open ? 'the character dialog stayed open' : null };
    })()`);
    note('profile-bootstrap', report.profileBootstrap);
    if (report.profileBootstrap.error) { report.outcome = 'blocked'; report.blocker = `Player profile bootstrap failed: ${report.profileBootstrap.error}`; return report; }
    // The voice button must actually be usable before the requester speaks.
    const ready = await until(async () => {
      const status = await page.evaluate('window.__gameverseQualification.status()');
      const ui = await page.evaluate('({ dialogOpen: Boolean(document.querySelector("dialog[open]")), focused: document.hasFocus(), hidden: document.hidden })');
      return !ui.dialogOpen && ui.focused && !ui.hidden ? { status, ui } : null;
    }, { timeoutMs: 30000, everyMs: 500, label: 'the app to be focused with no dialog open' }).catch(error => ({ error: error.message }));
    report.uiReady = ready;
    note('ui-ready', ready.ui || { error: ready.error });
    if (flag('bootstrap-only')) {
      report.voiceButton = await page.evaluate(`(() => { const button = document.querySelector('#voice-button');
        return { present: Boolean(button), label: button?.textContent?.trim() || null, disabled: Boolean(button?.disabled),
          canRecord: window.__gameverseQualification.status().voice, panelPresent: Boolean(document.querySelector('#agent-panel')) }; })()`);
      report.outcome = ready.error ? 'blocked' : 'bootstrap-only';
      if (ready.error) report.blocker = ready.error;
      await capture('bootstrap');
      report.frames = frames;
      clearInterval(recorderHandle); recorderHandle = null;
      return report;
    }
    await page.evaluate(`document.documentElement.dataset.sourceCommit = ${JSON.stringify(sourceCommit || '')}`);
    note('qualification-ready');
    await capture('ready');

    // 1. The requester's decision circuits choose speech; the audio goes through
    //    the ordinary capture path, transcription, then the one-shot planner.
    const requester = await page.evaluate(`window.__gameverseQualification.speakCommand(${JSON.stringify(COMMAND)})`);
    note('requester-started', { runId: requester?.runId });
    const gameplay = await until(async () => {
      const status = await page.evaluate('window.__gameverseQualification.status()');
      const run = status.runs.find(entry => entry.role === 'gameplay');
      if (run) return { run, status };
      if (await capsBlown()) throw Error('Provider cap reached before a gameplay run started; aborting without retry.');
      return null;
    }, { timeoutMs: 120000, everyMs: 500, label: 'a gameplay run started by the voice agent' });
    note('gameplay-started', { runId: gameplay.run.runId, ack: gameplay.status.ack });
    await capture('takeover');

    // 2. Play, sampling actual engine truth (not an actor claim). The gameplay
    //    budget is GLOBAL from the first gameplay run through every later stage.
    const gameplayStartedAt = Date.now();
    const globalDeadline = gameplayStartedAt + Math.min(CAPS.gameplaySeconds, 240) * 1000;
    const budgetLeftMs = () => globalDeadline - Date.now();
    report.gameplayBudget = { startedAt: new Date(gameplayStartedAt).toISOString(), seconds: Math.min(CAPS.gameplaySeconds, 240) };
    // Bounded initial play; the rest of the global budget is reserved for the
    // concurrent takeover, the reopen and both Stop stages.
    const playStageMs = Number(value('play-seconds', 45)) * 1000;
    const playDeadline = Math.min(gameplayStartedAt + playStageMs, globalDeadline - 120000);
    const engineSamples = [];
    while (Date.now() < playDeadline) {
      const truth = await page.evaluate('window.__gameverseQualification.engineTruth()');
      if (truth) engineSamples.push({ atMs: Date.now() - started, ...truth });
      const abort = await capsBlown();
      if (abort) { note('cap-abort', abort); break; }
      const shots = engineSamples.at(-1)?.stats?.shots?.[0] ?? 0;
      if (shots > 0 && engineSamples.length > 20) { note('shot-attempt-observed', { shots }); break; }
      if (budgetLeftMs() <= 120000) { note('play-stage-budget-reached', { leftMs: budgetLeftMs() }); break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    report.engineSamples = engineSamples;
    await capture('played');

    // 3. Leave to the overworld while the match keeps running, then reopen it.
    const left = await page.evaluate('window.__gameverseQualification.leaveSubgame()');
    note('left-subgame', { frame: left?.frameAtLeave, sessionId: left?.sessionId });
    await capture('overworld');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 4. Concurrent overworld takeover with independent spectator camera.
    const second = await page.evaluate(`window.__gameverseQualification.speakCommand(${JSON.stringify(OVERWORLD_COMMAND)})`);
    note('second-requester-started', { runId: second?.runId });
    // A requester start is not a gameplay start: wait for the second running
    // gameplay run before exercising spectator, reopen and Stop.
    const concurrent = await until(async () => {
      const status = await page.evaluate('window.__gameverseQualification.status()');
      const running = status.runs.filter(run => run.role === 'gameplay' && run.state === 'running');
      if (running.length >= 2) return { running, status };
      if (await capsBlown()) throw Error('Provider cap reached before the second gameplay run started; aborting without retry.');
      if (budgetLeftMs() <= 45000) return { running, status, incomplete: 'second gameplay run did not start inside the gameplay budget' };
      return null;
    }, { timeoutMs: Math.max(5000, Math.min(90000, budgetLeftMs())), everyMs: 500, label: 'a second running gameplay run' })
      .catch(error => ({ running: [], incomplete: error.message }));
    report.concurrent = { count: concurrent.running?.length ?? 0, incomplete: concurrent.incomplete || null,
      targets: (concurrent.running || []).map(run => ({ runId: run.runId, gameId: run.gameId, surface: run.surface })) };
    note('concurrent-runs', report.concurrent);
    const spectator = await page.evaluate('window.__gameverseQualification.spectatorCamera(1.5)').catch(error => ({ error: error.message }));
    report.spectator = spectator;
    note('spectator-camera', spectator);
    await capture('spectator');

    const reopened = await page.evaluate('window.__gameverseQualification.reopenSubgame("soccer")');
    note('reopened', { frame: reopened?.frameAtReopen, leftAtFrame: reopened?.frameAtLeave, sessionId: reopened?.reopenedSessionId });
    await capture('reopened');

    // 5. Speech Stop for one run, visible Stop for the other.
    const soccerRun = (report.concurrent.targets || []).find(run => run.gameId === 'soccer')?.runId || gameplay.run.runId;
    const otherRun = (report.concurrent.targets || []).find(run => run.runId !== soccerRun)?.runId || null;
    report.stopState = { before: await page.evaluate(`window.__gameverseQualification.stopPreconditions(${JSON.stringify(soccerRun)})`).catch(error => ({ error: error.message })) };
    const spokenStop = await page.evaluate(`window.__gameverseQualification.speakCommand(${JSON.stringify(STOP_COMMAND)})`);
    note('speech-stop-requested', { requesterRun: spokenStop?.runId, target: soccerRun });
    const afterSpeechStop = await until(async () => {
      const status = await page.evaluate('window.__gameverseQualification.status()');
      const stopped = !status.runs.some(run => run.runId === soccerRun && run.state === 'running');
      const command = (status.commands || []).find(c => c.receipt?.requestId === c.requestId && c.receipt?.processing === 'agent' && c.receipt?.transcription?.mode === 'realtime' && (c.toolCalls || []).some(call => call.name === 'stop_run' && call.ok && call.targetRunId === soccerRun && call.resultOutcome === 'stopped' && Number.isFinite(call.startedAt) && call.startedAt >= report.stopState.before.at && Number.isFinite(call.releasedAt) && call.releasedAt >= call.startedAt));
      return stopped && command ? { ...status, stopCommand: command } : null;
    }, { timeoutMs: Math.max(5000, Math.min(60000, budgetLeftMs())), everyMs: 500, label: 'the spoken stop to release the soccer run' })
      .catch(error => ({ error: error.message }));
    report.afterSpeechStop = { requestId: afterSpeechStop.stopCommand?.requestId || null, targetStopped: Boolean(afterSpeechStop.stopCommand) && !afterSpeechStop.error && !(afterSpeechStop.runs || []).some(run => run.runId === soccerRun && run.state === 'running'),
      otherStillRunning: otherRun ? (afterSpeechStop.runs || []).some(run => run.runId === otherRun && run.state === 'running') : null,
      error: afterSpeechStop.error || null };
    note('speech-stop-result', report.afterSpeechStop);
    report.stopState.after = await page.evaluate(`window.__gameverseQualification.stopAftermath(${JSON.stringify(soccerRun)})`).catch(error => ({ error: error.message }));
    // Real human control after the neutral handback.
    report.humanControl = await page.evaluate('window.__gameverseQualification.humanControlProbe()').catch(error => ({ inputDispatched: false, engineResponded: false, detail: error.message }));
    note('human-control', report.humanControl);
    if (otherRun) {
      // Press the visible Stop while policy work is NATURALLY outstanding, then
      // wait a bounded provider latency for the real discard evidence. Nothing
      // is injected or delayed artificially.
      const pendingBefore = await until(async () => {
        const snapshot = await page.evaluate(`window.__gameverseQualification.stopPreconditions(${JSON.stringify(otherRun)})`);
        return snapshot?.pendingDecision || snapshot?.reflecting ? snapshot : null;
      }, { timeoutMs: Math.max(5000, Math.min(20000, budgetLeftMs())), everyMs: 300, label: 'a naturally outstanding decision or reflection on the second run' })
        .catch(error => ({ error: error.message }));
      report.visibleStopPending = pendingBefore;
      note('visible-stop-pending', { pendingDecision: pendingBefore?.pendingDecision ?? null, reflecting: pendingBefore?.reflecting ?? null, heldAction: pendingBefore?.heldAction ?? null });
      const stillRunning = await page.evaluate(`window.__gameverseQualification.pressVisibleStop(${JSON.stringify(otherRun)})`).catch(error => ({ error: error.message }));
      // The outstanding answer arrives after real provider latency.
      const aftermath = await until(async () => {
        const state = await page.evaluate(`window.__gameverseQualification.stopAftermath(${JSON.stringify(otherRun)})`);
        return state?.lateResultsRejected > 0 ? state : null;
      }, { timeoutMs: 8000, everyMs: 400, label: 'the late policy answer to be discarded after release' })
        .catch(async () => page.evaluate(`window.__gameverseQualification.stopAftermath(${JSON.stringify(otherRun)})`).catch(() => null));
      report.visibleStop = { target: otherRun, stillRunning, pendingBefore, aftermath };
      note('visible-stop', { target: otherRun, outstandingAtStop: aftermath?.outstandingAtStop ?? null,
        lateResultsRejected: aftermath?.lateResultsRejected ?? null, heldInput: aftermath?.heldInput ?? null });
      // Prefer whichever stop actually had outstanding work for the bundle's
      // late-answer criterion; the spoken stop is still verified independently.
      if (aftermath?.outstandingAtStop === true && report.stopState?.after?.outstandingAtStop !== true) {
        report.stopState.chosen = 'visible'; report.stopState.after = aftermath;
      } else report.stopState.chosen = report.stopState?.after?.outstandingAtStop === true ? 'spoken' : 'neither-had-outstanding-work';
    } else { report.visibleStop = { skipped: 'no second gameplay run existed to stop with the visible button' }; note('visible-stop-skipped', report.visibleStop); }
    await capture('stopped');
    clearInterval(recorderHandle); recorderHandle = null;

    // 6. Retained evidence -> separate verifier.
    report.frames = frames;
    report.audioOffsets = await page.evaluate('window.__gameverseQualification.qualification.captureEvidence()');
    // Real speech audio, written next to the frames with its offsets so the host
    // can mux a reviewable video with sound. Frames alone are not the recording.
    report.audioFiles = [];
    // The metadata view intentionally has no bytes; take them from the export.
    const exported = await page.evaluate('window.__gameverseQualification.exportAudio()').catch(() => []);
    for (const [index, utterance] of exported.entries()) {
      if (!utterance.audioBase64) { report.audioFiles.push({ error: 'no audio bytes exported', text: utterance.text, runId: utterance.runId }); continue; }
      const file = `${OUT}/frames/speech-${String(index).padStart(2, '0')}.wav`;
      await writeFile(file, Buffer.from(utterance.audioBase64, 'base64'));
      report.audioFiles.push({ file, text: utterance.text, bytes: utterance.bytes, retainedBytes: utterance.retainedBytes,
        truncated: utterance.truncated, mime: utterance.mime, atMs: utterance.at - started, runId: utterance.runId });
    }
    report.audioExport = { utterances: (report.audioOffsets?.utterances || []).length, files: report.audioFiles.filter(entry => entry.file).length,
      complete: report.audioFiles.length > 0 && report.audioFiles.every(entry => entry.file && entry.bytes > 0 && entry.truncated === false)
        && report.audioFiles.length === (report.audioOffsets?.utterances || []).length };
    note('audio-export', report.audioExport);
    const bundle = await page.evaluate('window.__gameverseQualification.evidence()');
    bundle.identity = { ...bundle.identity, sourceCommit };
    // A frames-only folder is not a complete recording: audio must be exported too.
    bundle.recording = flag('no-recording') ? null : { path: `${OUT}/frames`, frames: frames.length,
      timestamps: frames.map(frame => frame.atMs), audioFiles: report.audioFiles,
      complete: frames.length > 0 && Boolean(report.audioExport?.complete),
      note: report.audioExport?.complete ? 'frames plus every real utterance; mux with ffmpeg'
        : 'incomplete: frames without the full real audio export' };
    const firstShots = report.engineSamples[0]?.stats?.shots?.[0] ?? 0;
    const lastShots = report.engineSamples.at(-1)?.stats?.shots?.[0] ?? 0;
    const shotAttempts = Math.max(0, lastShots - firstShots);
    bundle.quality = {
      shots: shotAttempts, shotCounter: { first: firstShots, last: lastShots },
      possessionSeconds: report.engineSamples.filter(sample => sample.possessionTeam === 0).length,
      attemptsTowardGoal: report.engineSamples.filter((sample, index) => index > 0 && (sample.stats?.shots?.[0] ?? 0) > (report.engineSamples[index - 1].stats?.shots?.[0] ?? 0)).length,
      // Score is reported separately: the agreed goal is a genuine attempt.
      score: report.engineSamples.at(-1)?.score ?? null,
    };
    // The actor claim is read from the harness's own outcome, never asserted here.
    bundle.goal = { claimedByActor: bundle.runs.some(run => run.outcome === 'goal-reached'),
      engineObserved: shotAttempts > 0, definition: 'engine shot-counter delta > 0 (a genuine attempt, not a guaranteed score)',
      scoreObserved: report.engineSamples.at(-1)?.score ?? null };
    bundle.requester = { role: 'requester', runIds: [requester?.runId, second?.runId, spokenStop?.runId].filter(Boolean),
      utterances: (report.audioOffsets?.utterances || []).length };
    // Journey stages recorded from observed results, never from a description.
    bundle.journey = {
      requesterSpeech: (report.audioOffsets?.audioBytes ?? 0) > 0
        ? { ok: true, bytes: report.audioOffsets.audioBytes, utterances: bundle.requester.utterances }
        : { ok: false, reason: 'no requester audio reached the capture path' },
      agentTookOver: gameplay?.run?.runId ? { ok: true, runId: gameplay.run.runId, ack: gameplay.status?.ack || null }
        : { ok: false, reason: 'no gameplay run was started by the voice agent' },
      leftSubgame: left?.frameAtLeave != null ? { ok: true, frame: left.frameAtLeave, sessionId: left.sessionId }
        : { ok: false, reason: 'the human never left the subgame' },
      reopenedSession: reopened?.frameAtReopen > (reopened?.frameAtLeave ?? -1)
        ? { ok: true, frames: reopened.frameAtReopen - reopened.frameAtLeave,
            sameSession: reopened.reopenedSessionId === reopened.sessionId, sessionId: reopened.reopenedSessionId }
        : { ok: false, reason: 'the reopened session showed no background progress' },
      concurrentRun: report.concurrent.count >= 2 ? { ok: true, count: report.concurrent.count }
        : { ok: false, reason: report.concurrent.incomplete || 'a second gameplay run never ran' },
      spokenStop: report.afterSpeechStop?.targetStopped
        ? { ok: true, requestId: report.afterSpeechStop.requestId, target: soccerRun, otherStillRunning: report.afterSpeechStop.otherStillRunning }
        : { ok: false, reason: report.afterSpeechStop?.error || 'the spoken stop did not release its target' },
      visibleStop: report.visibleStop?.skipped ? { ok: false, reason: report.visibleStop.skipped }
        : { ok: true, target: report.visibleStop?.target, stillRunning: report.visibleStop?.stillRunning },
    };
    bundle.stop = { runId: report.stopState?.chosen === 'visible' ? otherRun : soccerRun, stopKind: report.stopState?.chosen || null,
      spokenStop: { target: soccerRun, ...(report.afterSpeechStop || {}) },
      ...(report.stopState?.after || {}), preconditions: report.stopState?.before || null,
      humanControl: report.humanControl || null,
      otherRunsAffected: report.afterSpeechStop?.otherStillRunning === false && Boolean(otherRun) };
    bundle.providerLedger = await ledger();
    await writeFile(`${OUT}/evidence.json`, JSON.stringify(bundle, null, 2));
    const { verifyEvidence } = await import('./verify-takeover-evidence.mjs');
    report.verification = verifyEvidence(bundle);
    report.outcome = report.verification.verdict;
    note('verified', { verdict: report.verification.verdict, protocol: report.verification.protocol, goal: report.verification.goalOutcome });
    return report;
  } catch (error) {
    report.outcome = report.outcome || 'error';
    report.error = { stage: timings.at(-1)?.stage || 'unknown', message: error.message };
    report.note = 'Partial evidence only. A partial bundle is never full acceptance.';
    try {
      const partial = await page.evaluate('window.__gameverseQualification.evidence({ lifecycle: { leftSubgame: true } })');
      await writeFile(`${OUT}/evidence-partial.json`, JSON.stringify(partial, null, 2));
    } catch { /* the page may be gone */ }
    throw error;
  } finally {
    if (typeof recorderHandle === 'number' || recorderHandle) clearInterval(recorderHandle);
    report.finishedAt = new Date().toISOString();
    report.wallMs = Date.now() - started;
    try { report.providerLedgerFinal = await page.evaluate('fetch("/api/agent/ledger").then(r => r.json())'); } catch { /* server may be gone */ }
    await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
    const digest = createHash('sha256').update(JSON.stringify(report)).digest('hex');
    await writeFile(`${OUT}/report.sha256`, `${digest}  report.json\n`).catch(() => {});
    report.browserProfileDir = userDataDirUsed;
    browser.close(); child.kill(); server?.kill();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(report => {
    console.log(JSON.stringify({ outcome: report.outcome, out: OUT, prerequisites: report.prerequisites, verification: report.verification?.verdict,
      protocol: report.verification?.protocol, goal: report.verification?.goalOutcome, quality: report.verification?.quality?.verdict,
      ledger: report.providerLedgerFinal?.ledger, blocker: report.blocker || null }, null, 2));
    process.exit(['evidence-consistent', 'prerequisites-only', 'bootstrap-only'].includes(report.outcome) ? 0 : 1);
  }).catch(error => { console.error('qualification failed:', error.message); process.exit(2); });
}
export { main, CDP, PREREQUISITES };
