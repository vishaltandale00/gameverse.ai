import { escapeHtml as esc, recipeAvailability, requestStarter, fixtureRequest, validateModRequest, renderRecipeDetails, renderRetainedRun } from './improvement-workbench-model.js';

function renderFixtures(fixtures = [], pending = false) {
  if (!fixtures.length) return '<p>No executable public demonstration is reported by this server.</p>';
  return `<section aria-label="Bundled public demonstrations">${fixtures.map(fixture => `<article class="ir-result"><h3>${esc(fixture.label || 'Public engine demonstration')}</h3><p>${esc(fixture.description || fixture.availability?.scope)}</p><p>Authored key-and-door grid: observe, act and action-log replay. No original ROM, source tree, provider or model key is required. This demonstrates the engine; it does not generate a GBA cartridge or a mashup.</p><p>${esc(recipeAvailability(fixture).label)}</p>${(fixture.availability?.prerequisites || []).map(row => `<p>${esc(row.label)} · ${esc(row.status)}${row.detail ? ` — ${esc(row.detail)}` : ''}</p>`).join('')}${(fixture.availability?.setup || []).map(step => `<p>${esc(step)}</p>`).join('')}<button data-improvement-fixture="${esc(fixture.id)}" ${recipeAvailability(fixture).executable && !pending ? '' : 'disabled'}>Run public engine demonstration ↗</button></article>`).join('')}</section>`;
}

function renderUnsupportedModes(modes = []) {
  if (!modes.length) return '';
  return `<details><summary>Other input and generation paths</summary>${modes.map(mode => `<p><strong>${esc(mode.label || (mode.id === 'private-bundle-reassembly' ? 'Imported original-material bundle' : mode.id))}</strong>: unavailable on this server. ${esc(mode.description || '')}${mode.id === 'private-bundle-reassembly' ? ' The research workflow reconstructs from captured components that retain original executable bytes and assets; it does not regenerate the game from IR or make an arbitrary modification. No bundle upload or execution is offered here.' : ''}</p>`).join('')}</details>`;
}

function renderProfiles(profiles = []) {
  if (!profiles.length) return '';
  return `<details><summary>Bounded improvement request starters</summary><p>These profiles use their declared limits and local provider setup. Download a starter for the API client after supplying exact target and environment context.</p>${profiles.map(profile => `<article class="ir-package"><strong>${esc(profile.label || profile.id)}</strong><p>${esc(recipeAvailability(profile).label)}</p>${profile.limits ? `<p>Limits: ${esc(profile.limits.model_calls ?? 'unreported')} model calls · ${esc(profile.limits.native_frames ?? 'unreported')} native frames · ${esc(profile.limits.wall_seconds ?? 'unreported')} seconds.</p>` : ''}${profile.request_template ? `<button data-improvement-profile="${esc(profile.id)}">Download improvement request ↓</button>` : '<p>No request template reported.</p>'}</article>`).join('')}</details>`;
}

function downloadRequest(request) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'gameverse-improvement-request.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createImprovementWorkbench({ element, fetchImpl = fetch }) {
  element.classList.add('improvement-workbench');
  let capabilities, recipeId, draft = '', run, pending = false;
  const api = async (path, options) => {
    const response = await fetchImpl(path, options);
    let body;
    try { body = await response.json(); } catch { throw Error('Start the local improvement API to inspect recipes and retained results.'); }
    if (!response.ok) throw Error(body.error?.message || body.error || 'The local improvement API is unavailable.');
    return body;
  };
  const notice = text => { element.querySelector('[data-improvement-message]').textContent = text; };
  const selected = () => capabilities?.recipes?.find(recipe => recipe.id === recipeId);
  function starter() {
    const request = requestStarter(capabilities, selected(), crypto.randomUUID());
    draft = request ? JSON.stringify(request, null, 2) : '';
  }
  function render() {
    const recipe = selected(), ready = recipe && recipeAvailability(recipe).executable;
    element.innerHTML = `<section class="ir-composer" aria-labelledby="improvement-heading"><div class="ir-section-heading"><div><p class="eyebrow">LOCAL PROVIDER / REPRODUCIBLE INPUTS</p><h2 id="improvement-heading">Start from an available recipe.</h2></div><button type="button" data-improvement-refresh ${pending ? 'disabled' : ''}>Refresh availability ↻</button></div><p class="ir-intro">Inspect exactly what can run on this server. Original ROMs, source trees and extracted assets are supplied locally; this panel does not upload them.</p>${capabilities ? `${renderFixtures(capabilities.fixtures, pending)}${renderUnsupportedModes(capabilities.unsupported_modes)}${renderProfiles(capabilities.iteration_profiles)}<p class="ir-authorship">${esc(capabilities.boundary)}</p><p>Free-text game generation and arbitrary game composition are ${capabilities.supports?.free_text_planning === true ? 'reported by the provider; use its documented API' : 'unsupported by this provider'}. The existing mashup graph remains a separate workflow.</p><label class="ir-select-label">Registered recipe<select data-improvement-recipe ${pending ? 'disabled' : ''}>${(capabilities.recipes || []).map(row => `<option value="${esc(row.id)}" ${row.id === recipeId ? 'selected' : ''}>${esc(row.id)} · ${esc(recipeAvailability(row).label)}</option>`).join('')}</select></label>${recipe ? renderRecipeDetails(recipe) : '<p>No registered recipes reported.</p>'}${recipe ? `<details ${draft ? '' : 'open'}><summary>Exact modification request starter</summary><p>Fill the required host and environment context using your actual versions and hashes. Text describes the selected recipe; it does not create a new executable plan.</p>${draft ? `<label class="ir-select-label">Versioned request JSON<textarea data-improvement-request rows="16" spellcheck="false" ${pending ? 'disabled' : ''}>${esc(draft)}</textarea></label><div class="ir-build-controls"><button data-improvement-download>Download request ↓</button><button data-improvement-submit ${!ready || pending ? 'disabled' : ''}>Submit registered mod ↗</button></div>` : '<p>This server has not published a request template. Refresh after updating the improvement API; inspect its capabilities for supported client calls.</p>'}</details>` : ''}` : '<p>Availability is not loaded. Refresh after starting the local improvement API.</p>'}<p class="ir-message" data-improvement-message role="status" aria-live="polite"></p><form data-improvement-lookup><label class="ir-select-label">Existing run ID<input data-improvement-run-id required pattern="[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}" value="${esc(run?.request_id || '')}" placeholder="Retained request UUID"></label><button ${pending ? 'disabled' : ''}>Load / refresh result</button></form><div data-improvement-result>${run ? renderRetainedRun(run) : ''}</div></section>`;
    element.querySelector('[data-improvement-refresh]').onclick = refresh;
    for (const button of element.querySelectorAll('[data-improvement-profile]')) button.onclick = () => {
      const profile = capabilities.iteration_profiles.find(row => row.id === button.dataset.improvementProfile);
      downloadRequest(requestStarter(capabilities, profile, crypto.randomUUID()));
      notice('Improvement starter saved with exact profile pins. Supply its missing context before using the API client; the pinned profile owns resource limits.');
    };
    for (const button of element.querySelectorAll('[data-improvement-fixture]')) button.onclick = async () => {
      if (pending) return;
      try {
        const fixture = capabilities.fixtures.find(row => row.id === button.dataset.improvementFixture);
        const request = fixtureRequest(fixture, crypto.randomUUID());
        pending = true; render();
        run = await api('/api/improvement/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        pending = false; render(); notice('Public demonstration request retained. Load / refresh the result for its action trace and replay evidence.');
      } catch (error) { pending = false; render(); notice(error.message); }
    };
    element.querySelector('[data-improvement-recipe]')?.addEventListener('change', event => { recipeId = event.target.value; starter(); render(); });
    element.querySelector('[data-improvement-request]')?.addEventListener('input', event => { draft = event.target.value; });
    element.querySelector('[data-improvement-download]')?.addEventListener('click', () => {
      try {
        downloadRequest(JSON.parse(draft)); notice('Request saved. Review required context before submitting.');
      } catch { notice('The request must be valid JSON before it can be saved.'); }
    });
    element.querySelector('[data-improvement-submit]')?.addEventListener('click', submit);
    element.querySelector('[data-improvement-lookup]').onsubmit = async event => {
      event.preventDefault();
      const id = element.querySelector('[data-improvement-run-id]').value.trim();
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) { notice('Enter the retained request UUID.'); return; }
      try { run = await api(`/api/improvement/runs/${id}`); render(); notice('Retained result loaded. Refresh here for progress.'); } catch (error) { notice(error.message); }
    };
  }
  async function refresh() {
    if (pending) return;
    pending = true; render();
    try {
      const next = await api('/api/improvement/capabilities');
      if (next.schema !== 'gameverse.improvement-capabilities/1') throw Error('Unsupported capabilities response.');
      capabilities = next;
      if (!selected()) recipeId = next.recipes?.[0]?.id;
      if (selected()) starter();
      pending = false; render(); notice('Availability refreshed. Exact request pins were updated.');
    } catch (error) { pending = false; render(); notice(error.message); }
  }
  async function submit() {
    if (pending) return;
    try {
      const request = validateModRequest(capabilities, selected(), JSON.parse(draft));
      pending = true; render();
      run = await api('/api/improvement/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      pending = false; render(); notice('Request retained. Load / refresh the result to inspect progress and actual evidence.');
    } catch (error) { pending = false; render(); notice(error.message); }
  }
  render();
  void refresh();
  return { refresh };
}
