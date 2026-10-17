import { mountBuildRequirements, mountCreationLibrary, sourceWorldChoices } from './creation-library.js';
import { mountRomPreparation } from './rom-preparation.js';
import { ACTIVE_STATES, STAGES, STAGE_LABELS, playableUrl, stageState, runMessage, refinementIntent, safeLocalUrl, isGraphicsRun, isSourceAttempt } from './conversation-model.js';
export async function initializeConversation(root = document, { embedded = false } = {}) {
const $ = id => root.querySelector(`[id="${id}"]`);
const storageKey = 'gameverse.conversation.v1';
let auth = null, capabilities = null, run = null, busy = false, loginId = null, pollTimer = null;
const requestedPlayId = new URLSearchParams(location.search).get('play');
let playerMounted = false, resultPlayer = null, disposeLibrary = null;
const libraryReferences = new Set();
let libraryReferencesTouched = false;
function mountLibrary() { disposeLibrary?.(); disposeLibrary = mountCreationLibrary(root, capabilities?.library, api, libraryReferences, capabilities?.backends || [], () => { libraryReferencesTouched = true; }); }
let history = [];
try { history = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (!Array.isArray(history)) history = []; } catch { /* Local storage is optional. */ }
const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(history.slice(-20))); } catch { /* Keep session usable without persistence. */ } };
const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body; try { body = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Check that Gameverse is running.'); }
  if (!response.ok) throw new Error(body.error?.message || body.error || body.message || `Local request failed (${response.status}).`);
  return body;
}
function refinementContext() {
  if (run?.request_id && typeof run.intent === 'string') return run;
  return history.at(-1);
}
function updateButtons() {
  const active = ACTIVE_STATES.has(run?.status);
  $('new-idea').disabled = busy || active; $('cancel').disabled = busy; $('resume').disabled = busy;
  $('submit').disabled = busy || active || auth?.authenticated !== true || (capabilities === null || capabilities.available === false);
  $('submit').textContent = refinementContext() ? 'Build this refinement ↗' : 'Make my game ↗';
  $('intent-label').textContent = refinementContext() ? 'What should change in the next version?' : 'Tell Gameverse your idea';
  $('connect').disabled = busy || auth?.available === false || auth?.authenticated === true;
  $('connect').textContent = auth?.authenticated ? 'ChatGPT connected ✓' : 'Connect with ChatGPT ↗';
}
function renderHistory() {
  $('history').replaceChildren(...history.map(item => {
    const article = node('article', '', 'message'); article.append(node('small', item.parent_request_id ? 'Your refinement' : item.retry_of ? 'Your retry' : 'Your idea'), node('p', item.message)); const inspect = node('button', 'View this run', 'text-button'); inspect.type = 'button'; inspect.addEventListener('click', async () => { try { const result = await api(`/api/mashup/runs/${encodeURIComponent(item.request_id)}`); run = result.run || result; renderRun(); schedulePoll(); } catch (error) { $('form-status').textContent = error.message; } }); article.append(inspect); return article;
  }));
  $('starter').hidden = history.length > 0; $('new-idea').hidden = history.length === 0; $('new-idea').disabled = ACTIVE_STATES.has(run?.status); updateButtons();
}
function renderRun() {
  if (!run) return;
  if (!libraryReferencesTouched && Array.isArray(run.library_refs) && (libraryReferences.size !== run.library_refs.length || run.library_refs.some(id => !libraryReferences.has(id)))) {
    libraryReferences.clear(); run.library_refs.forEach(id => libraryReferences.add(id)); mountLibrary();
  }
  if (refinementContext()) { $('starter').hidden = true; $('new-idea').hidden = false; }
  const graphicsRun = isGraphicsRun(run), sourceAttempt = isSourceAttempt(run);
  $('run-panel').hidden = false; $('run-state').textContent = run.status === 'completed' && run.playable ? (graphicsRun ? (run.objective_validated === true ? 'Graphics verified' : 'Partial graphics result') : (sourceAttempt ? (run.objective_validated === true ? 'Request verified' : 'Requirements incomplete') : (run.objective_validated === true ? 'Bot objective verified' : 'Bot objective incomplete'))) : run.status;
  $('run-title').textContent = run.playable && run.status === 'completed' ? (run.artifact?.title || 'Your game is ready') : 'Your game, in progress';
  $('run-message').textContent = runMessage(run);
  const qualification = run.qualification; const bot = qualification?.bot;
  $('qualification-summary').hidden = !qualification;
  $('qualification-summary').textContent = qualification && graphicsRun ? `Native graphics: ${qualification.outcome || 'unreported'} (${qualification.scope || 'scope unreported'}). Requested coverage: ${run.objective_validated === true ? 'verified' : 'partial'}. Natural gameplay remains unqualified.` : qualification ? `Native check: ${qualification.outcome || 'unreported'}${qualification.scope ? ` (${qualification.scope})` : ''}.${bot ? ` Gameplay bot: ${bot.status || bot.outcome || 'unreported'}.` : ' No gameplay bot result reported.'} Campaign: ${qualification.campaign || 'qualification scope unavailable'}.` : '';
  renderRequestCoverage();
  $('stages').replaceChildren(...STAGES.map(stage => { const li = node('li', graphicsRun && stage === 'playtesting' ? 'Verify graphics' : sourceAttempt && stage === 'playtesting' && !bot ? 'Check candidate' : (graphicsRun || sourceAttempt) && stage === 'completed' && run.objective_validated !== true ? 'Partial result' : STAGE_LABELS[stage], stageState(run, stage)); if (li.className === 'current') li.setAttribute('aria-current', 'step'); return li; }));
  $('cancel').hidden = !ACTIVE_STATES.has(run.status); $('cancel').disabled = busy;
  $('resume').hidden = run.can_resume !== true && (ACTIVE_STATES.has(run.status) || run.playable === true); $('resume').disabled = busy; $('resume').textContent = run.can_resume === true ? (run.checkpoint?.kind === 'source-attempt' ? 'Continue source attempt' : run.playable ? (graphicsRun ? 'Continue graphics checks' : sourceAttempt && !bot ? 'Continue native checks' : 'Continue bot test') : 'Resume run') : 'Retry this request';
  const href = playableUrl(run); $('play').hidden = !href; $('play').textContent = (graphicsRun || sourceAttempt) && run.objective_validated !== true ? 'Play partial result ↗' : 'Play your game ↗'; if (href) $('play').href = embedded ? `/v1?create=1&play=${encodeURIComponent(run.request_id)}` : href; else $('play').removeAttribute('href');
  const download = run.status === 'completed' && run.playable === true ? safeLocalUrl(run.artifact?.rom_url) : null;
  $('download-rom').hidden = !download; if (download) $('download-rom').href = download;
  if (requestedPlayId === run.request_id && href && !playerMounted) {
    playerMounted = true; $('result-player-host').hidden = false;
    import('./result-player.js').then(({ mountResultPlayer }) => { if (run?.request_id === requestedPlayId) { resultPlayer = mountResultPlayer($('result-player-host'), { runId: requestedPlayId }); } }).catch(error => { $('result-player-host').textContent = `The player could not open: ${error.message}. You can download the game below.`; });
  }
  $('events').replaceChildren(...(run.events || []).map(event => { const li = node('li', ''); if (event.at) { const date = new Date(event.at); if (!Number.isNaN(date.getTime())) li.append(node('time', date.toLocaleTimeString())); } li.append(document.createTextNode(event.message || event.stage || 'Run event')); return li; }));
  $('evidence').textContent = run.qualification ? JSON.stringify({ qualification: run.qualification, evidence: run.evidence, timings: run.pipeline_timings }, null, 2) : 'No qualification result has been reported yet.';
  $('timing').textContent = `Run ${run.request_id || run.id || 'identity unavailable'} · elapsed ${Number.isFinite(run.timings?.total_s) ? `${run.timings.total_s.toFixed(1)} s` : 'unavailable'} · queue ${Number.isFinite(run.timings?.queue_s) ? `${run.timings.queue_s.toFixed(1)} s` : 'unavailable'}`;
  updateButtons();
}
function renderRequestCoverage() {
  const host = $('request-coverage'); if (!host) return;
  const evidence = run.evidence || {}, qualification = run.qualification || {};
  const ledger = qualification.requirement_ledger || evidence.requirement_ledger || run.requirement_ledger;
  const gaps = [...new Set([...(qualification.gaps || []), ...(evidence.gaps || []), ...(evidence.design?.gaps || [])])];
  const nodes = [];
  const roles = qualification.source_roles;
  if (roles) nodes.push(node('p', `Host: ${roles.host}. Donor: ${roles.donor || roles.donors?.join(', ') || 'unreported'}. Native consumers: ${(roles.roles || []).join(', ') || 'unreported'}.`, 'fine'));
  if (ledger?.requirements?.length) {
    nodes.push(node('h4', 'Your request, requirement by requirement'));
    const list = node('ul', '', 'requirement-ledger');
    for (const row of ledger.requirements) {
      const item = node('li', ''); item.append(node('strong', row.status || 'unverified'), node('p', row.text || row.id || 'Requirement'));
      if (row.scope) item.append(node('p', row.scope, 'fine'));
      if (row.evidence?.length) { const detail = node('details', ''); detail.append(node('summary', 'Requirement evidence'), node('pre', JSON.stringify(row.evidence, null, 2))); item.append(detail); }
      else item.append(node('p', 'No verified implementation evidence for this requirement.', 'fine'));
      list.append(item);
    }
    nodes.push(list);
  }
  if (gaps.length) { nodes.push(node('h4', 'Coverage & remaining gaps')); const list = node('ul', ''); for (const gap of gaps) list.append(node('li', gap)); nodes.push(list); }
  if (evidence.tool_execution) nodes.push(node('p', `Actual construction trace: ${evidence.tool_execution.records ?? 'unreported'} retained tool records${evidence.tool_execution.sha256 ? ` · sha256 ${evidence.tool_execution.sha256}` : ''}. Private command and output contents remain in local evidence.`, 'fine'));
  if (evidence.attempt?.steps?.length) {
    const attempt = node('details', ''); attempt.append(node('summary', 'Agent-reported attempt · independent proof is listed above'));
    const list = node('ol', ''); for (const step of evidence.attempt.steps) list.append(node('li', typeof step === 'string' ? step : step.summary || step.description || step.action || JSON.stringify(step))); attempt.append(list); nodes.push(attempt);
  }
  if (evidence.attempt?.changed_files?.length) {
    const outputs = node('details', ''); outputs.append(node('summary', 'Recorded isolated output files'));
    const list = node('ul', ''); for (const file of evidence.attempt.changed_files) list.append(node('li', typeof file === 'string' ? file : `${file.ref || 'Output'}${file.sha256 ? ` · sha256 ${file.sha256}` : ''}`)); outputs.append(list); nodes.push(outputs);
  }
  host.hidden = nodes.length === 0; host.replaceChildren(...nodes);
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (ACTIVE_STATES.has(run?.status)) pollTimer = setTimeout(refreshRun, 1800);
}
async function refreshRun() {
  const id = run?.request_id || requestedPlayId || history.at(-1)?.request_id; if (!id) return;
  try { const next = await api(`/api/mashup/runs/${encodeURIComponent(id)}`); run = next.run || next; renderRun(); schedulePoll(); }
  catch (error) { $('run-message').textContent = `Progress is temporarily unavailable: ${error.message} Your request is retained. Check progress to reconnect.`; }
}
async function checkAuth() {
  try { auth = await api('/api/chatgpt/status'); $('connection-message').textContent = auth.authenticated ? `Connected through local Codex${auth.planType ? ` · ${auth.planType}` : ''}.` : (auth.reason || 'Connect your ChatGPT account to start a local build.'); if (auth.authenticated) { loginId = null; $('login-link').hidden = true; } }
  catch (error) { auth = { available: false, authenticated: false }; $('connection-message').textContent = error.message; }
  updateButtons();
}
$('recheck').addEventListener('click', () => { checkAuth(); if (!capabilities) api('/api/mashup/capabilities').then(renderCapabilities).catch(error => { $('capability-note').textContent = error.message; }); });
$('new-idea').addEventListener('click', () => { if (ACTIVE_STATES.has(run?.status)) return; resultPlayer?.destroy(); resultPlayer = null; playerMounted = false; history = []; run = null; libraryReferences.clear(); libraryReferencesTouched = false; if (capabilities) renderCapabilities(capabilities); save(); renderHistory(); $('run-panel').hidden = true; $('intent').value = ''; $('intent').focus(); if (location.search) historyReplace(); });
function historyReplace() { const url = new URL(location.href); url.searchParams.delete('play'); window.history.replaceState(null, '', embedded ? `${url.pathname}?create=1` : '/create'); }
$('connect').addEventListener('click', async () => {
  busy = true; updateButtons();
  // Open during the user's click so browsers can permit the sign-in tab.
  const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
  try { const result = await api('/api/chatgpt/login', { method: 'POST', body: '{}' }); const url = new URL(result.authUrl); if (url.protocol !== 'https:') throw new Error('The local bridge returned an invalid sign-in address.'); loginId = result.loginId; $('login-link').href = url.href; $('login-link').hidden = false; if (popup) popup.location.href = url.href; $('connection-message').textContent = 'Finish ChatGPT sign-in in the opened tab. This page will reconnect automatically.'; }
  catch (error) { popup?.close(); $('connection-message').textContent = error.message; }
  finally { busy = false; updateButtons(); }
});
const authInterval = setInterval(() => { if (loginId) checkAuth(); }, 3000);
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); const message = $('intent').value.trim(); if (!message || busy || ACTIVE_STATES.has(run?.status)) return;
  busy = true; $('form-status').textContent = 'Sending your idea to the local build pipeline…'; updateButtons();
  const request_id = crypto.randomUUID(); const previous = refinementContext();
  const source_games = [...root.querySelectorAll('#source-options input:checked')].map(input => input.value);
  const intent = refinementIntent(previous?.intent, message);
  const library_refs = libraryReferences.size || libraryReferencesTouched ? [...libraryReferences] : undefined;
  if (intent.length > 12000) { busy = false; $('form-status').textContent = 'This conversation has reached the request limit. Shorten the next description or start a new idea.'; updateButtons(); return; }
  try { const result = await api('/api/mashup/runs', { method: 'POST', body: JSON.stringify({ request_id, intent, source_games, library_refs, ...(previous ? { [previous.playable === false ? 'retry_of' : 'parent_request_id']: previous.request_id } : {}) }) }); run = result.run || result; history.push({ request_id: run.request_id || request_id, message, intent, library_refs, ...(previous ? { [previous.playable === false ? 'retry_of' : 'parent_request_id']: previous.request_id } : {}) }); save(); renderHistory(); $('intent').value = ''; $('form-status').textContent = ''; renderRun(); schedulePoll(); }
  catch (error) { $('form-status').textContent = error.message; }
  finally { busy = false; updateButtons(); }
});
async function actOnRun(method, suffix = '') {
  if (!run || busy) return; busy = true; renderRun();
  try { const result = await api(`/api/mashup/runs/${encodeURIComponent(run.request_id)}${suffix}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) }); run = result.run || result; renderRun(); if (run.cancel_requested) $('run-message').textContent = 'Stopping this run. Waiting for the local worker to finish cleanup…'; schedulePoll(); }
  catch (error) { busy = false; renderRun(); $('run-message').textContent = error.message; return; }
  finally { busy = false; updateButtons(); }
}
$('play').addEventListener('click', async event => {
  if (!embedded || !playableUrl(run)) return;
  event.preventDefault();
  const id = run.request_id;
  window.history.replaceState(null, '', `/v1?create=1&play=${encodeURIComponent(id)}`);
  $('result-player-host').hidden = false;
  try {
    if (resultPlayer) await resultPlayer.load(id);
    else { const { mountResultPlayer } = await import('./result-player.js'); resultPlayer = mountResultPlayer($('result-player-host'), { runId: id }); }
    playerMounted = true;
  } catch (error) { $('result-player-host').textContent = `The player could not open: ${error.message}`; }
});
$('cancel').addEventListener('click', () => actOnRun('DELETE'));
$('resume').addEventListener('click', async () => {
  if(run?.can_resume === true)return actOnRun('POST','/resume');
  if(!run||busy||ACTIVE_STATES.has(run.status)||run.playable)return;
  const previous=run;busy=true;updateButtons();
  try{const result=await api('/api/mashup/runs',{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),intent:previous.intent,source_games:previous.source_games||[],library_refs:previous.library_refs||[],retry_of:previous.request_id})});run=result.run||result;history.push({request_id:run.request_id,message:previous.intent,intent:previous.intent,retry_of:previous.request_id});save();renderHistory();renderRun();schedulePoll();}
  catch(error){$('form-status').textContent=error.message;}
  finally{busy=false;updateButtons();}
});
$('refresh-run').addEventListener('click', refreshRun);
function renderCapabilities(data) {
  capabilities = data;
  $('capability-note').textContent = [data.available === false ? 'The local game sources or native testing tools are not ready.' : '', data.description || data.scope || 'Choose a supported starting point, or describe your own request. The pipeline will report unsupported combinations.'].filter(Boolean).join(' ');
  const presets = Array.isArray(data.presets) ? data.presets : [];
  $('presets').replaceChildren(...presets.map(preset => { const button = node('button', preset.title || preset.name || 'Try a supported mashup', 'preset'); button.type = 'button'; if (preset.description) button.append(node('span', preset.description)); button.addEventListener('click', () => { $('intent').value = preset.intent || preset.prompt || preset.description || preset.title || ''; const ids = (preset.source_games || []).map(source => typeof source === 'string' ? source : source.id); for (const input of root.querySelectorAll('#source-options input')) input.checked = ids.includes(input.value); $('intent').focus(); }); return button; }));
  const selectedSources = new Set([...root.querySelectorAll('#source-options input:checked')].map(input => input.value));
  const supported = data.source_games || data.sources || [];
  const sources = sourceWorldChoices(supported, data.library?.games);
  $('source-options').replaceChildren(...sources.map(source => { const label = node('label', ''); const input = document.createElement('input'); input.type = 'checkbox'; input.value = typeof source === 'string' ? source : source.id; input.checked = selectedSources.has(input.value); label.append(input, document.createTextNode(typeof source === 'string' ? source.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : source.title || source.name || source.id)); if (!supported.some(item => (typeof item === 'string' ? item : item.id) === input.value)) label.append(node('span', 'Source reference · adapter needed', 'fine')); return label; }));
  if (!sources.length) $('source-options').append(node('p', 'Source selection will be inferred from your request.', 'fine'));
  mountLibrary();
  mountBuildRequirements(root, data);
  updateButtons();
}
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, dictating = false;
if (Recognition) {
  $('dictate').disabled = false; $('voice-status').textContent = 'Browser dictation · review text before sending';
  $('dictate').addEventListener('click', () => {
    if (dictating) { recognition?.stop(); return; }
    recognition = new Recognition(); recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false;
    recognition.onstart = () => { dictating = true; $('dictate').textContent = 'Stop dictation'; $('voice-status').textContent = 'Listening through your browser…'; };
    recognition.onresult = event => { const transcript = [...event.results].filter(result => result.isFinal).map(result => result[0].transcript).join(' '); $('intent').value = `${$('intent').value}${$('intent').value ? ' ' : ''}${transcript}`.slice(0, 4000); };
    recognition.onerror = event => { $('voice-status').textContent = `Dictation unavailable (${event.error}). You can type your request.`; };
    recognition.onend = () => { dictating = false; $('dictate').textContent = 'Dictate'; if ($('voice-status').textContent.startsWith('Listening')) $('voice-status').textContent = 'Review your words, then send when ready.'; };
    try { recognition.start(); } catch { $('voice-status').textContent = 'Browser dictation could not start. Type your request instead.'; }
  });
} else $('voice-status').textContent = 'Dictation is unavailable in this browser. Type your idea.';
const disposeRomPreparation = mountRomPreparation(root, api, async () => {
  try { renderCapabilities(await api('/api/mashup/capabilities')); } catch (error) { $('form-status').textContent = `Files were processed, but build availability could not refresh: ${error.message}`; }
});
window.addEventListener('pagehide', () => { recognition?.abort(); resultPlayer?.destroy(); disposeLibrary?.(); disposeRomPreparation(); clearInterval(authInterval); clearTimeout(pollTimer); });
renderHistory();
await Promise.allSettled([checkAuth(), api('/api/mashup/capabilities').then(renderCapabilities).catch(error => { $('capability-note').textContent = `The local build pipeline is unavailable: ${error.message}`; }), refreshRun()]);

return { pause() { recognition?.abort(); return resultPlayer?.pause(); } };
}
if (document.getElementById('composer')) await initializeConversation();
