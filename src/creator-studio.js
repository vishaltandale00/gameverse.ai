// Creator's Lot UI: the "Make a game" kiosk dialog and the in-game
// "Change this game…" form. Both talk to the v2 game service and show its
// live progress from /api/v2/events.
import { progressLine, previewCells, GENERATED_PREFIX } from './generated-games.js';

const $ = selector => document.querySelector(selector);
const EVENT_TYPES = ['job_started', 'queued', 'stage', 'draft', 'version', 'job_done', 'job_failed'];

async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `The game service answered ${response.status}.`);
  return data;
}

function appendStep(list, line) {
  if (!line || list.lastElementChild?.textContent === line) return;
  const item = document.createElement('li'); item.textContent = line; list.append(item);
  while (list.children.length > 8) list.firstElementChild.remove();
}

function drawPreview(canvas, partial) {
  const { width, height, cells } = previewCells(partial);
  if (!width || !height) return;
  const context = canvas.getContext('2d'), size = Math.max(1, Math.min(canvas.width / width, canvas.height / height));
  context.fillStyle = /^#[0-9a-f]{3,8}$/i.test(partial.background || '') ? partial.background : '#101820';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const ox = (canvas.width - width * size) / 2, oy = (canvas.height - height * size) / 2;
  for (const cell of cells) { context.fillStyle = cell.color; context.fillRect(ox + cell.x * size, oy + cell.y * size, Math.ceil(size), Math.ceil(size)); }
  canvas.hidden = false;
}

/** The kiosk dialog. onReady(catalogId) when the first version publishes. */
export function createMakeGameDialog({ onReady, onPlay, onClose }) {
  const dialog = $('#create-dialog'), form = $('#create-form'), prompt = $('#create-prompt');
  const progress = $('#create-progress'), status = $('#create-status'), steps = $('#create-steps'), preview = $('#create-preview');
  let job = null;
  function reset() {
    job?.events?.close(); job = null;
    form.hidden = false; progress.hidden = true; steps.replaceChildren(); preview.hidden = true; status.textContent = '';
    $('#create-play').hidden = true; $('#create-another').hidden = true; $('#create-submit').disabled = false;
  }
  function handle(event) {
    appendStep(steps, progressLine(event));
    if (event.type === 'draft' && event.partial) drawPreview(preview, event.partial);
    if (event.type === 'version' && !job.ready) {
      job.ready = true;
      status.textContent = 'Your game is playable. Opening its venue in the Creator’s Lot…';
      void (async () => {
        let title = 'Your game';
        try { title = (await api(`/api/v2/games/${encodeURIComponent(job.gameId)}`)).meta?.title || title; } catch {}
        await onReady?.(GENERATED_PREFIX + job.gameId);
        if (!job) return;
        status.textContent = `“${title}” is ready to play. Its venue just opened in the Creator’s Lot.`;
        $('#create-play').hidden = false; $('#create-another').hidden = false;
        if (dialog.open) $('#create-play').focus();
      })();
    }
    if (event.type === 'job_done' || event.type === 'job_failed') {
      job.events.close();
      if (event.type === 'job_failed' && !job.ready) { status.textContent = `This one didn’t build: ${event.error || 'unknown error'}. Try rewording the idea.`; $('#create-another').hidden = false; }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = prompt.value.trim(); if (!text || job) return;
    $('#create-submit').disabled = true;
    // Subscribe before submitting so the first stages are never missed.
    const current = job = { gameId: null, ready: false, buffer: [], events: new EventSource('/api/v2/events') };
    for (const type of EVENT_TYPES) current.events.addEventListener(type, message => {
      let data; try { data = { type, ...JSON.parse(message.data) }; } catch { return; }
      if (job !== current) return;
      if (!current.gameId) current.buffer.push(data); else if (data.gameId === current.gameId) handle(data);
    });
    form.hidden = true; progress.hidden = false; status.textContent = 'Sending your idea…';
    // The server greets each stream with 'hello'; wait briefly so the
    // job's first stages arrive on this connection.
    await new Promise(resolve => { current.events.addEventListener('hello', resolve, { once: true }); current.events.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 2000); });
    try {
      const { gameId } = await api('/api/v2/games', { prompt: text });
      if (job !== current) return;
      current.gameId = gameId; status.textContent = 'Building your game. You can leave; it keeps going.';
      for (const data of current.buffer.splice(0)) if (data.gameId === gameId) handle(data);
      prompt.value = '';
    } catch (error) {
      if (job !== current) return;
      current.events.close(); job = null;
      form.hidden = false; $('#create-submit').disabled = false; status.textContent = '';
      progress.hidden = false; status.textContent = error.message;
    }
  });
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  $('#create-play').onclick = () => { const id = GENERATED_PREFIX + job.gameId; reset(); dialog.close('play'); onPlay?.(id); };
  $('#create-another').onclick = () => { reset(); prompt.focus(); };
  $('#create-back').onclick = () => dialog.close('back');
  $('#create-close').onclick = () => dialog.close('back');
  dialog.addEventListener('close', () => onClose?.(dialog.returnValue));
  return {
    open() {
      if (dialog.open) return;
      if (!job) reset();
      dialog.returnValue = ''; dialog.showModal();
      (job ? ($('#create-play').hidden ? $('#create-back') : $('#create-play')) : prompt).focus();
    },
  };
}

/** The session menu's "Change this game…" form for generated games. */
export function createChangeForm({ getGame, onFocusResume }) {
  const form = $('#change-form'), text = $('#change-text'), status = $('#change-status'), steps = $('#change-steps');
  let pending = null;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const game = getGame(), change = text.value.trim();
    if (!game?.v2Id || !change || pending) return;
    $('#change-submit').disabled = true; steps.replaceChildren(); status.textContent = 'Sending your change…';
    // Pending before the request: the job's first stage is broadcast while it is accepted.
    const request = pending = { gameId: game.id, from: game.version };
    try {
      await api(`/api/v2/games/${encodeURIComponent(game.v2Id)}/revise`, { change });
      text.value = '';
      if (pending === request) status.textContent = `Building v${game.version + 1}. It loads here as soon as it’s ready.`;
    } catch (error) { if (pending === request) pending = null; status.textContent = error.message; $('#change-submit').disabled = false; }
  });
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  return {
    /** Show or hide the form for the current session (keeps an in-flight change). */
    reset(game) {
      if (pending && pending.gameId !== game?.id) pending = null;
      if (!pending) { status.textContent = ''; steps.replaceChildren(); $('#change-submit').disabled = false; }
      form.hidden = !pending;
    },
    show() { form.hidden = false; text.focus(); form.scrollIntoView({ block: 'nearest' }); },
    event(event) {
      if (!pending || event.type === 'draft') return;
      appendStep(steps, progressLine(event)); status.scrollIntoView({ block: 'nearest' });
      if (event.type === 'job_failed') { status.textContent = `The change didn’t build: ${event.error || 'unknown error'}. Your current version keeps running.`; pending = null; $('#change-submit').disabled = false; }
    },
    updated(info) {
      if (!pending) return;
      if (info.error) { status.textContent = `v${info.version} could not load: ${info.error}`; }
      else status.textContent = `v${info.version} is loaded. ${info.carried ? 'Your progress carried over.' : 'The level changed, so it restarted.'} Keep playing to try it.`;
      pending = null; $('#change-submit').disabled = false; form.hidden = false;
      onFocusResume?.();
    },
  };
}
