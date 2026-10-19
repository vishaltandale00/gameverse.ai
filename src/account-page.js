import {createDevManagerPanel} from './dev-manager-page.js';
import '/runtime/phone/libphonenumber-min.js';
import { defaultPhoneCountry, normalizePhoneInput } from './phone-input.js';
import { connectionView, terminalPhases } from './agent-connection-view.js';
const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = globalThis.libphonenumber;
const $ = id => document.getElementById(id);
let account, config, settings, jobs = [], polling = false, lastConnections = '', lastJobs = '';
const localConnections = new Map();
const messages = {
  phone_setup_required: 'Phone sign-in is being configured. Try again shortly.',
  pilot_invitation_required: 'This number hasn’t been invited yet.',
  international_phone_required: 'Check your number and selected country.',
  invalid_code: 'That code didn’t match. Check the message and try again.',
  start_sign_in_again: 'Please request a new verification code.',
  try_again_later: 'Too many attempts. Please wait before trying again.',
  phone_provider_unavailable: 'Text verification is unavailable. Please try again shortly.',
  sign_in_required: 'Please sign in to Gameverse.',
  connection_in_use: 'This agent is finishing an active task. Try again shortly.',
  pilot_daily_limit: 'You’ve reached the pilot’s daily test limit.',
  provider_authentication_failed: 'The provider couldn’t verify this API key.',
  invalid_api_key: 'Enter a valid provider API key.',
  developer_invitation_required: 'Developer tools require an invitation.',
  login_not_ready: 'This sign-in is no longer active. Please connect again.',
};
const notice = message => { $('account-status').textContent = message; };
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Error(messages[result.error?.code] || 'We couldn’t complete that. Please try again.');
  return result;
}
async function action(callback) { try { await callback(); } catch (error) { notice(error.message); } }
function text(tag, value, className) {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
}
function button(label, callback, className) {
  const element = text('button', label, className); element.type = 'button';
  element.addEventListener('click', () => action(callback)); return element;
}
function initializePhoneCountry() {
  const countries = getCountries(), names = new Intl.DisplayNames(navigator.languages, { type: 'region' });
  const options = countries.map(country => ({ country, label: `${names.of(country)} (+${getCountryCallingCode(country)})` })).sort((a, b) => a.label.localeCompare(b.label));
  $('phone-country').replaceChildren(...options.map(({ country, label }) => new Option(label, country)));
  $('phone-country').value = defaultPhoneCountry(countries, config.sign_in.default_country, navigator.languages);
  $('phone-country').addEventListener('change', () => { $('phone-number').placeholder = $('phone-country').value === 'US' ? '(201) 555-0123' : 'Your phone number'; });
  $('phone-country').dispatchEvent(new Event('change'));
}
function latestLogin(provider) { return jobs.find(job => job.type === 'connect' && job.provider === provider); }
function activeLogin(provider) { return jobs.find(job => job.type === 'connect' && job.provider === provider && !terminalPhases.has(job.phase)); }

async function startConnection(provider) {
  const requestId = crypto.randomUUID();
  // Open from the user's click before any await. The helper prepares authorization
  // in that tab; polling the account page never creates or reopens a tab.
  window.open(`/agent-auth.html?request=${requestId}`, '_blank', 'noopener');
  localConnections.set(provider, { step: 'starting' }); renderConnections(); notice('');
  try {
    await api(`/api/agent-connections/${provider}/browser`, 'POST', { request_id: requestId });
    localConnections.delete(provider); await refresh();
  } catch (error) {
    localConnections.set(provider, { error: error.message }); renderConnections();
  }
}
function authorizationPanel(provider, login, view, draft) {
  const panel = text('div', '', 'connection-panel'); panel.setAttribute('aria-live', 'polite');
  if (view.step !== 'authorize') {
    panel.append(text('p', view.detail, 'progress-copy')); return panel;
  }
  panel.append(text('p', '1 · Authorize', 'step-label'));
  panel.append(text('p', 'Finish sign-in in the Claude tab. If it didn’t open, use the button below.'));
  const link = text('a', 'Open Claude ↗', 'button-link'); link.href = login.auth_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; panel.append(link);
  const form = text('form', '', 'login-code-form'), input = document.createElement('input');
  input.type = 'password'; input.autocomplete = 'off'; input.required = true; input.maxLength = 4096; input.dataset.run = login.id; input.value = draft || '';
  input.id = `authorization-${login.id}`; const label = text('label', '2 · Paste the code from Claude'); label.htmlFor = input.id;
  const submit = text('button', 'Connect Claude', 'primary'); submit.type = 'submit';
  form.append(label, input, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const code = input.value.trim(); if (!code) return;
    // Switch immediately, before the request, and remove the secret from the DOM.
    input.value = ''; localConnections.set(provider, { step: 'verifying', id: login.id }); renderConnections(); notice('');
    action(async () => {
      try {
        await api(`/api/jobs/${login.id}/code`, 'POST', { code });
        await refresh(); renderConnections();
      } catch (error) {
        // An uncertain response may still have delivered the code. Read durable
        // progress before offering another action; the host deduplicates delivery.
        try { await refresh(); } catch { /* Keep the local verification state. */ }
        renderConnections(); notice('Still checking your connection. We’ll update it when Claude responds.');
      }
    });
  });
  panel.append(form); return panel;
}
function renderConnections() {
  if (!settings) return;
  const fingerprint = JSON.stringify({ settings, logins: ['claude', 'codex'].map(provider => latestLogin(provider)), local: [...localConnections] });
  if (fingerprint === lastConnections) return; lastConnections = fingerprint;
  const drafts = new Map([...document.querySelectorAll('.login-code-form input')].map(input => [input.dataset.run, input.value]));
  $('agent-connections').replaceChildren();
  for (const provider of ['claude', 'codex']) {
    const connection = settings.connections.find(row => row.provider === provider), login = latestLogin(provider);
    const view = connectionView(connection, login, localConnections.get(provider)), name = provider === 'claude' ? 'Claude' : 'Codex';
    const card = text('article', '', 'agent-card'), row = text('div', '', 'agent-row'); card.dataset.provider = provider;
    const copy = text('div', '', 'agent-copy'), title = text('div', '', 'agent-title'); title.append(text('h3', name));
    if (view.step === 'connected' && settings.default_provider === provider) title.append(text('span', 'Default', 'default-badge'));
    copy.append(title, text('p', provider === 'codex' && view.step === 'idle' ? 'Browser sign-in isn’t available yet.' : ['preparing', 'authorize', 'verifying', 'cancelling'].includes(view.step) ? 'Your personal agent account' : view.detail));
    row.append(text('span', provider === 'claude' ? 'C' : '⌘', `agent-symbol ${provider}`), copy);
    const controls = text('div', '', 'agent-control');
    if (['idle', 'reconnect', 'failed'].includes(view.step) && !activeLogin(provider)) {
      const connect = button(view.step === 'reconnect' ? 'Reconnect' : view.step === 'failed' ? 'Try again' : 'Connect', () => startConnection(provider), 'primary');
      connect.disabled = !config.providers[provider].browser || !account.developer; controls.append(connect);
    } else {
      controls.append(text('span', view.label, `connection-state ${view.step} ${view.busy ? 'busy' : ''}`));
    }
    row.append(controls); card.append(row);
    if (['preparing', 'authorize', 'verifying', 'cancelling'].includes(view.step)) {
      card.setAttribute('aria-busy', String(view.busy));
      card.append(authorizationPanel(provider, login, view, drafts.get(login?.id)));
      if (activeLogin(provider) && view.step !== 'cancelling') card.append(button('Cancel connection', async () => {
        localConnections.set(provider, { step: 'cancelling' }); renderConnections();
        try { await api(`/api/jobs/${login.id}/cancel`, 'POST'); await refresh(); }
        finally { localConnections.delete(provider); renderConnections(); }
      }, 'text-button agent-options'));
    } else {
      const options = text('details', '', 'agent-options'); options.append(text('summary', view.step === 'connected' ? 'Manage connection' : 'Use an API key'));
      if (view.step === 'connected') {
        if (settings.default_provider !== provider) options.append(button('Use by default', async () => { await api(`/api/agent-connections/${provider}/default`, 'POST'); await refresh(); }));
        options.append(button('Disconnect', async () => { await api(`/api/agent-connections/${provider}/disconnect`, 'POST'); notice(`${name} disconnected. Active work is being cancelled.`); await refresh(); }));
      } else {
        const form = document.createElement('form'), input = document.createElement('input');
        input.type = 'password'; input.autocomplete = 'off'; input.required = true; input.maxLength = 2048; input.setAttribute('aria-label', `${name} API key`); input.placeholder = `${name} API key`;
        const submit = text('button', 'Verify & connect'); submit.type = 'submit'; form.append(input, text('p', 'Stored encrypted. API usage is billed separately.', 'small'), submit);
        form.addEventListener('submit', event => { event.preventDefault(); action(async () => {
          submit.disabled = true; submit.textContent = 'Verifying…';
          try { await api(`/api/agent-connections/${provider}/api-key`, 'POST', { key: input.value }); input.value = ''; await refresh(); }
          finally { submit.disabled = false; submit.textContent = 'Verify & connect'; }
        }); }); options.append(form);
      }
      card.append(options);
    }
    $('agent-connections').append(card);
  }
}
const duration = ms => ms == null ? '' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
async function showResult(id) {
  const result = await api(`/api/jobs/${id}/result`);
  $('result-content').textContent = JSON.stringify(result, null, 2);
  $('result-summary').replaceChildren(text('p', result.success ? '✓ Source updated · 4 verification cases passed' : 'The coding check didn’t pass.'), text('p', result.hosting_receipt.cleanup_confirmed ? 'Work saved. Sandbox deleted.' : 'Work saved. Finishing cleanup.'));
  $('result-dialog').showModal();
}
function renderJobs() {
  const runs = jobs.filter(job => job.type === 'job'), fingerprint = JSON.stringify(runs);
  if (fingerprint === lastJobs) return; lastJobs = fingerprint; $('job-list').replaceChildren(); $('empty-jobs').hidden = runs.length > 0;
  const labels = { succeeded: 'Coding check passed', failed: 'Coding check failed', cancelled: 'Coding check cancelled', cleanup_failed: 'Cleanup needs attention', awaiting_connection: 'Waiting for Claude', queued: 'Coding check queued', running: 'Claude is working…', cleaning: 'Saving work & finishing…' };
  for (const job of runs) {
    const card = text('article', '', 'run-card'), heading = text('div', '', 'run-heading'), actions = text('div', '', 'run-actions');
    heading.append(text('h3', labels[job.phase] || 'Preparing coding check…'));
    if (job.result_available) actions.append(button('View result', () => showResult(job.id), 'text-button'));
    if (!terminalPhases.has(job.phase)) actions.append(button(job.cancellation_requested ? 'Cancelling…' : 'Cancel', async () => { await api(`/api/jobs/${job.id}/cancel`, 'POST'); await refresh(); }, 'text-button'));
    heading.append(actions); card.append(heading);
    const time = new Date(job.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    card.append(text('p', `${time}${job.total_ms != null ? ' · ' + duration(job.total_ms) : ''}${job.cleanup_confirmed ? ' · Saved & cleaned up' : ''}`));
    if (job.phase === 'awaiting_connection') card.append(text('p', 'Connect Claude above. This request will continue automatically.'));
    const details = document.createElement('details'); details.append(text('summary', 'Run details'), text('p', job.intent), text('code', job.id));
    if (job.reason) details.append(text('p', job.reason.replaceAll('_', ' '))); card.append(details); $('job-list').append(card);
  }
}
const devManagers=createDevManagerPanel({root:document.getElementById('dev-manager-panel'),api});
async function refresh() {
  if (polling) return; polling = true;
  try {
    account = (await api('/api/me')).account;
    $('sign-in-panel').hidden = !!account; $('signed-in-panel').hidden = !account; $('account-summary').hidden = !account;
    await devManagers.refresh(account);
    if (!account) { $('send-code').disabled = !config.sign_in.configured; return; }
    $('account-name').textContent = account.name; $('developer-panel').hidden = !account.developer;
    const [connections, runs] = await Promise.all([api('/api/agent-connections'), api('/api/jobs')]); settings = connections; jobs = runs.jobs;
    for (const [provider, local] of localConnections) {
      const login = jobs.find(job => job.id === local.id);
      if (local.step === 'verifying' && (settings.connections.some(row => row.provider === provider && row.status === 'connected') ||
        login && (['verifying', 'connected'].includes(login.connection_step) || terminalPhases.has(login.phase)))) localConnections.delete(provider);
    }
    renderConnections(); renderJobs();
  } finally { polling = false; }
}
$('phone-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  $('send-code').disabled = true; $('send-code').textContent = 'Sending…';
  try {
    const normalized = normalizePhoneInput($('phone-number').value, $('phone-country').value, parsePhoneNumberFromString); $('phone-country').value = normalized.country;
    const result = await api('/api/auth/phone/start', 'POST', { phone: normalized.number }); $('phone-form').hidden = true; $('code-form').hidden = false;
    notice(`Code sent to ${result.masked_phone}.`); $('phone-code').focus();
  } finally { $('send-code').disabled = false; $('send-code').textContent = 'Send code'; }
}); });
$('code-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  $('verify-phone').disabled = true; $('verify-phone').textContent = 'Verifying…';
  try { await api('/api/auth/phone/check', 'POST', { code: $('phone-code').value }); $('phone-code').value = ''; notice(''); await refresh(); }
  finally { $('verify-phone').disabled = false; $('verify-phone').textContent = 'Verify & continue'; }
}); });
$('different-phone').addEventListener('click', () => { $('code-form').hidden = true; $('phone-form').hidden = false; $('phone-code').value = ''; notice(''); });
$('sign-out').addEventListener('click', () => action(async () => {
  await api('/api/auth/logout', 'POST'); lastJobs = ''; lastConnections = ''; settings = null; jobs = []; localConnections.clear();
  $('job-list').replaceChildren(); $('agent-connections').replaceChildren(); $('code-form').hidden = true; $('phone-form').hidden = false; notice(''); await refresh();
}));
$('job-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const key = `gameverse.pending-reference:${account.id}`;
  let request = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (!request) { request = { request_id: crypto.randomUUID(), intent: $('test-note').value, provider: 'claude' }; sessionStorage.setItem(key, JSON.stringify(request)); }
  $('run-check').disabled = true; $('run-check').textContent = 'Submitting…';
  try { await api('/api/jobs', 'POST', request); sessionStorage.removeItem(key); notice(''); await refresh(); }
  finally { $('run-check').disabled = false; $('run-check').textContent = 'Run coding check'; }
}); });
$('close-result').addEventListener('click', () => $('result-dialog').close());
await action(async () => { config = await api('/api/auth/config'); initializePhoneCountry(); await refresh(); notice(config.sign_in.configured ? '' : 'Phone sign-in is being configured.'); });
setInterval(() => { if (account && !document.hidden) action(refresh); }, 5000);
window.addEventListener('focus', () => { if (config) action(refresh); });
document.addEventListener('visibilitychange', () => { if (config && !document.hidden) action(refresh); });
