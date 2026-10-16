const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function recipeAvailability(recipe) {
  const availability = recipe.availability;
  if (!availability) return { status: 'partial', executable: false, label: recipe.installed ? 'Inputs found · execution not checked' : 'Local inputs needed', scope: 'This server has not reported execution readiness.', missing_inputs: recipe.missing_inputs || [], setup: [], prerequisites: [] };
  const labels = { 'ready': availability.input_mode === 'authored-fixture' ? 'Runnable bundled example' : 'Ready with local inputs', 'original-required': 'Supply original inputs locally', 'missing-inputs': 'Local inputs missing', 'setup-required': 'Local setup needed', 'partial': 'Setup or verification needed', 'unsupported': 'Unsupported' };
  return { ...availability, label: labels[availability.status] || 'Setup or verification needed', executable: availability.status === 'ready' && availability.execution_ready === true && availability.executable === true, missing_inputs: availability.missing_inputs || recipe.missing_inputs || [], setup: availability.setup || [], prerequisites: availability.prerequisites || [] };
}

export function requestStarter(capabilities, recipe, requestId) {
  if (!recipe.request_template) return null;
  return { ...structuredClone(recipe.request_template), request_id: requestId };
}

export function fixtureRequest(fixture, requestId) {
  if (!recipeAvailability(fixture).executable) throw Error('The public demonstration is not executable on this server. Refresh availability after setup.');
  const request = structuredClone(fixture.request_template);
  if (request?.schema !== 'gameverse.improvement-request/1' || request.operation !== 'reference-fixture' || request.plan?.fixture_id !== fixture.id || !digest(request.plan.request_sha256) || !digest(request.plan.executor_sha256)) throw Error('The server has not published a complete pinned demonstration request.');
  return { ...request, request_id: requestId };
}

export function validateModRequest(capabilities, recipe, request) {
  if (!recipeAvailability(recipe).executable) throw Error('Complete the reported local setup and refresh availability before starting this recipe.');
  if (request.schema !== 'gameverse.improvement-request/1' || request.operation !== 'native-mod') throw Error('This starter submits a registered native modification. Use the API client for bounded improvement campaigns.');
  if (request.plan?.recipe_id !== recipe.id || request.plan?.request_sha256 !== recipe.request_sha256 || request.loop_version !== capabilities.loop_version) throw Error('Recipe pins changed. Refresh availability and create a new request starter.');
  if (request.target?.game_id !== recipe.game_id || request.target?.artifact_sha256 !== recipe.baseline_artifact_sha256 || request.target?.role !== 'subgame') throw Error('Retain the exact registered game and baseline artifact.');
  if (!request.target.game_version || !request.target.base_game_version || !digest(request.target.base_artifact_sha256) || !request.environment?.version || !digest(request.environment.config_sha256)) throw Error('Supply the exact game version, host version/artifact hash and environment version/config hash.');
  if (typeof request.intent !== 'string' || !request.intent.trim() || request.intent.length > 4000) throw Error('Provide reviewed intent text of 1–4,000 characters.');
  return request;
}

export function retainedArtifactLinks(run) {
  // Only local links matching this retained run can be shown as evidence.
  const prefix = `/api/improvement/runs/${run.request_id}/artifacts/`;
  return Object.entries(run.artifacts || {}).filter(([key, url]) => ['rom','result','iteration','campaign'].includes(key) && url === prefix + key);
}

export function renderRecipeDetails(recipe) {
  const esc = escapeHtml, availability = recipeAvailability(recipe);
  return `<article class="ir-result"><h3>${esc(availability.label)}</h3><p>${esc(recipe.description)}</p><p>${esc(availability.scope)}</p>${availability.input_mode === 'original-required' ? '<p>Generation type: registered native modification using original executable bytes, assets and local native tools. Whole-game regeneration from IR is not provided by this recipe.</p>' : ''}<p>Evidence scope: ${esc(recipe.quality || 'Not reported')}. Input availability alone does not certify gameplay.</p>${availability.prerequisites.length ? `<ul>${availability.prerequisites.map(row => `<li>${esc(row.label)} · ${esc(row.status)}${row.detail ? ` — ${esc(row.detail)}` : ''}</li>`).join('')}</ul>` : ''}${availability.missing_inputs.length ? `<details><summary>${availability.missing_inputs.length} missing or changed inputs</summary><ul>${availability.missing_inputs.map(path => `<li><code>${esc(path)}</code></li>`).join('')}</ul></details>` : ''}${availability.setup.length ? `<ol>${availability.setup.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}${recipe.required_context?.length ? `<p>Before submitting: ${recipe.required_context.map(esc).join(' · ')}</p>` : ''}</article>`;
}

export function renderRetainedRun(run) {
  const esc = escapeHtml;
  const fixture = run.input?.operation === 'reference-fixture';
  return `<section class="ir-result" aria-label="Retained provider result"><h3>${fixture ? 'Public engine demonstration · ' : ''}Run ${esc(run.request_id)}</h3><p>Worker: <strong>${esc(run.status)}</strong>${run.engine_status ? ` · Engine: ${esc(run.engine_status)}` : ''}</p>${fixture ? '<p>Authored key-and-door grid demonstration: bounded action-plan and replay evidence. This output is not a GBA cartridge, original-game modification or mashup.</p>' : `<p>Build artifact: ${run.artifact_sha256 ? `<code>${esc(run.artifact_sha256)}</code>` : 'No verified artifact reported'}</p>`}${fixture ? `<p>Engine demonstration result: ${esc(run.engine_status || 'Awaiting completed evidence')}.</p>` : `<p>Objective qualification: ${esc(run.qualification ? JSON.stringify(run.qualification) : run.quality?.scope || 'Not reported')}.</p>`}<p>Accepted version / activation: unavailable through this provider.</p>${run.error ? `<p class="ir-blockers">${esc(run.error.message || run.error.code)}</p>` : ''}${run.quality?.gaps?.length ? `<ul>${run.quality.gaps.map(gap => `<li>${esc(gap)}</li>`).join('')}</ul>` : ''}<div class="ir-artifact-links">${retainedArtifactLinks(run).filter(([key]) => !fixture || key !== 'rom').map(([key, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${key === 'rom' ? 'Candidate .gba' : `${esc(key)} receipt`} ↗</a>`).join('')}</div><details><summary>Exact result, timing and evidence</summary><pre>${esc(JSON.stringify(run, null, 2))}</pre></details></section>`;
}
