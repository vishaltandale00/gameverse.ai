import { packagesForSelections, sourceGamesForSelections, selectionBlockers, createIrSubmission } from './ir-workshop-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roles = { movement: ['01', 'Movement', 'Steering, gravity and integration'], combat: ['02', 'Combat', 'Damage and lethal actor state'], progression: ['03', 'Progression', 'Persistent acquisition and the gate'] };
const unit = semantic => semantic ? `${semantic.quantity} · ${semantic.unit?.numerator ?? 1}/${semantic.unit?.denominator ?? 1} · ${semantic.frame}` : 'Semantic units pending';
async function api(path, options) {
  const response = await fetch(path, options);
  let result;
  try { result = await response.json(); } catch { throw Error('The local IR API is unavailable. Restart npm run dev to load the compiler integration.'); }
  if (!response.ok) throw Error(result.error || 'The local IR service is unavailable.');
  return result;
}

export async function createIrWorkshop({ element, games, getParents, setParents, getIntent }) {
  let catalog, selections = {}, title = 'ASTERION IR', busy = false, lastRun = null, timer = null;
  const name = id => games[id]?.shortName || games[id]?.name || id;
  const message = text => { element.querySelector('[data-ir-message]').textContent = text; };
  element.innerHTML = '<div class="ir-loading" role="status">Loading qualified executable components…</div>';
  try { catalog = await api('/api/ir/catalog'); }
  catch (error) { element.innerHTML = `<div class="ir-blockers" role="status">${esc(error.message)} Start the local server with npm run dev; static exports cannot compile cartridges.</div>`; return { updateParents() {} }; }
  for (const [role, options] of Object.entries(catalog.roles)) selections[role] = options.find(item => item.status === 'available')?.id || '';

  function packageDetails(component) {
    const rows = (component.ports || []).map(port => `<tr><td>${esc(port.id)}</td><td>${esc(port.direction)}</td><td>${esc(port.storage_type)}</td><td>${esc(unit(port.semantic_type))}</td></tr>`).join('');
    return `<article class="ir-package"><div><strong>${esc(component.label || component.id)}</strong><span>${esc(name(component.source_game))}</span></div><code>${esc(component.id)}</code><p>${esc(component.qualification?.status === 'pass' ? `${Number(component.qualification.vectors || 0).toLocaleString()} original/native oracle cases · ${String(component.assembly_status || 'qualification_scope_unspecified').replaceAll('_', ' ')}` : 'Qualification incomplete')}</p>${rows ? `<div class="ir-port-scroll"><table><caption>Typed ports and coordinate units</caption><thead><tr><th>Port</th><th>Flow</th><th>Storage</th><th>Meaning · units · frame</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}${(component.collection_ports || []).length ? `<p>Shared collections: ${esc(JSON.stringify(component.collection_ports))}</p>` : ''}<p>Dependencies: ${esc(component.dependencies?.length ? JSON.stringify(component.dependencies) : 'Closed within this executable package')}</p><p class="ir-limit">${esc((component.limitations || []).join(' · '))}</p></article>`;
  }

  function render() {
    const blockers = selectionBlockers(catalog, selections, getParents());
    element.innerHTML = `<section class="ir-composer" aria-labelledby="ir-heading"><div class="ir-section-heading"><div><p class="eyebrow">EXECUTABLE COMPONENTS / NATIVE GBA</p><h2 id="ir-heading">Assemble the rules.</h2></div><span class="ir-live-label"><span class="tiny-dot green"></span> Local compiler</span></div><p class="ir-intro">These choices select recovered executable behavior. Changing a component changes the generated IR and cartridge.</p><div class="ir-roles">${Object.entries(roles).map(([role, [number, label, description]]) => {
      const option = catalog.roles[role]?.find(item => item.id === selections[role]);
      const components = (option?.packages || []).map(id => catalog.components.find(item => item.id === id)).filter(Boolean);
      return `<article class="ir-role"><div class="ir-role-heading"><span>${number}</span><h3>${label}</h3></div><p>${description}</p><label class="ir-select-label" for="ir-${role}">Choose ${label.toLowerCase()}<select id="ir-${role}" data-ir-role="${role}" ${busy ? 'disabled' : ''}>${(catalog.roles[role] || []).map(item => `<option value="${esc(item.id)}" ${item.id === selections[role] ? 'selected' : ''} ${item.status !== 'available' ? 'disabled' : ''}>${esc(item.label)}${item.status !== 'available' ? ' — adapter pending' : ''}</option>`).join('')}</select></label><div class="ir-source-tags">${[...new Set(components.map(item => item.source_game))].map(id => `<span>${esc(name(id))}</span>`).join('')}</div><details><summary>${components.length} concrete package${components.length === 1 ? '' : 's'} · ports & evidence</summary>${components.map(packageDetails).join('')}</details></article>`;
    }).join('')}</div><div class="ir-contract"><span>One explicit frame graph</span><p>The preset binds state, units and lifecycle order. The compiler checks those bindings and emits the required conversions; the completed receipt shows what was used.</p></div>${blockers.length ? `<div class="ir-blockers" role="status"><strong>This mix needs an adapter.</strong><ul>${blockers.map(text => `<li>${esc(text.replace(/^([a-z0-9-]+):/, (_, id) => name(id) + ':'))}</li>`).join('')}</ul><p>Use the component selectors to assemble a supported mix, or remove the unsupported source game.</p></div>` : ''}<div class="ir-build-controls"><label for="ir-title">Cartridge title<input id="ir-title" maxlength="12" pattern="[A-Za-z0-9 _-]+" value="${esc(title)}" ${busy ? 'disabled' : ''}></label><button class="primary" data-ir-build ${busy || blockers.length ? 'disabled' : ''}>${busy ? 'Compiler running…' : 'Build & qualify GBA'} <span>↗</span></button><button data-ir-download ${blockers.length ? 'disabled' : ''}>Save IR request ↓</button></div><p class="ir-authorship">${esc(catalog.generation.authored_boundary)} No model key is needed for this deterministic build.</p><p class="ir-message" data-ir-message role="status" aria-live="polite"></p><div data-ir-run></div></section>`;
    for (const select of element.querySelectorAll('[data-ir-role]')) select.onchange = () => {
      selections[select.dataset.irRole] = select.value;
      setParents(sourceGamesForSelections(catalog, selections));
      render();
    };
    element.querySelector('#ir-title').oninput = event => { title = event.target.value; updateBuildButton(); };
    element.querySelector('[data-ir-build]').onclick = submit;
    element.querySelector('[data-ir-download]').onclick = () => {
      try { const submission = request(); const url = URL.createObjectURL(new Blob([JSON.stringify(submission, null, 2) + '\n'], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'gameverse-ir-request.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('Exact component selections saved. The server pins package versions when this request is submitted.'); }
      catch (error) { message(error.message); }
    };
    if (lastRun) renderRun();
  }
  function updateBuildButton() { element.querySelector('[data-ir-build]').disabled = busy || !/^[A-Za-z0-9 _-]{1,12}$/.test(title) || selectionBlockers(catalog, selections, getParents()).length > 0; }
  function request() { return createIrSubmission(catalog, selections, getParents(), title, getIntent(), crypto.randomUUID()); }
  async function submit() {
    if (busy) return;
    try {
      const submission = request(); busy = true; render(); message('Submitting the pinned executable component request…');
      lastRun = await api('/api/ir/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission) });
      localStorage.setItem('gameverse-ir-last-run', lastRun.id); renderRun(); poll();
    } catch (error) { busy = false; render(); message(error.message); }
  }
  function renderRun() {
    const result = lastRun, compiler = result.compiler, done = result.state === 'completed', failed = ['failed', 'interrupted'].includes(result.state);
    const phase = compiler?.phase || (result.active ? 'Starting worker' : result.state);
    const stages = compiler?.stages || [];
    const parent = element.querySelector('[data-ir-run]');
    parent.innerHTML = `<section class="ir-result ${done ? 'ir-result-complete' : failed ? 'ir-result-failed' : ''}" aria-labelledby="ir-result-title"><div class="ir-result-heading"><div><p class="eyebrow">ACTUAL BUILD & NATIVE QA</p><h3 id="ir-result-title">${esc(result.title)} <span>${done ? 'Ready' : failed ? 'Needs attention' : esc(phase)}</span></h3></div>${Number.isFinite(compiler?.wall_s) ? `<strong>${compiler.wall_s.toFixed(2)} s</strong>` : ''}</div><ol class="ir-stages">${['resolve', 'build', 'qualify'].map(key => { const stage = stages.find(item => item.phase === key); return `<li data-outcome="${esc(stage?.outcome || (key === phase ? 'running' : 'waiting'))}"><span>${({ resolve: 'Bind components', build: 'Compile cartridge', qualify: 'Native route QA' })[key]}</span><b>${stage ? `${esc(stage.outcome)} · ${stage.wall_s.toFixed(3)} s` : key === phase ? 'Running' : 'Waiting'}</b></li>`; }).join('')}</ol>${failed ? `<p class="ir-blockers">${esc(compiler?.diagnostic || result.diagnostic || 'The worker returned no successful receipt. Previous artifacts remain available.')}</p>` : ''}${compiler?.artifacts?.rom_sha256 ? `<p class="ir-rom-hash">ROM SHA-256 <code>${esc(compiler.artifacts.rom_sha256)}</code></p>` : ''}${compiler?.qualification ? `<p>Native QA: <strong>${esc(compiler.qualification.outcome)}</strong>${compiler.qualification.final ? ` · ${esc(JSON.stringify(compiler.qualification.final))}` : ''}</p>` : ''}<div class="ir-artifact-links">${[['request', 'IR request'], ['submission', 'Pinned packages'], ['composition', 'Resolved IR'], ['build_receipt', 'Build receipt'], ['qualification', 'Native QA receipt'], ['rom', 'Download .gba']].filter(([key]) => result.artifacts?.[key]).map(([key, text]) => `<a href="${esc(result.artifacts[key])}" ${key === 'rom' ? 'download' : 'target="_blank" rel="noopener"'}>${text} ↗</a>`).join('')}</div>${compiler?.build?.conversions?.length ? `<details><summary>${compiler.build.conversions.length} generated unit conversions</summary><pre>${esc(JSON.stringify(compiler.build.conversions, null, 2))}</pre></details>` : ''}${result.artifacts?.screenshots?.length ? `<div class="ir-proof-frames">${result.artifacts.screenshots.map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Actual native QA checkpoint ${i + 1}" width="240" height="160" loading="lazy"></a>`).join('')}</div>` : ''}${result.artifacts?.video ? `<details class="ir-proof-video"><summary>Watch the actual native QA recording</summary><video controls preload="none" src="${esc(result.artifacts.video)}" aria-label="Actual native emulator QA recording"></video></details>` : ''}${result.eligible_for_play ? '<div class="ir-play-actions"><button class="primary" data-ir-activate>Add to Play ↗</button><span>Registered versions keep progress by their exact ROM hash.</span></div>' : ''}<p class="ir-run-id">Run ${esc(result.id)} · <span>${esc(compiler?.authorship_notice || 'Compiler output and QA receipts are retained for this exact request.')}</span></p></section>`;
    parent.querySelector('[data-ir-activate]')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try { const accepted = await api(`/api/ir/runs/${result.id}/activate`, { method: 'POST' }); parent.querySelector('.ir-play-actions').innerHTML = `<a class="ir-play-link" href="${esc(accepted.play_url)}">Open in Play ↗</a><span>This exact cartridge has been registered.</span>`; window.dispatchEvent(new Event('gameverse-build-registered')); }
      catch (error) { button.disabled = false; message(error.message); }
    });
  }
  async function poll() {
    clearTimeout(timer);
    if (!lastRun) return;
    try {
      lastRun = await api(`/api/ir/runs/${lastRun.id}`); renderRun();
      if (['completed', 'failed', 'interrupted'].includes(lastRun.state)) { busy = false; render(); return; }
      timer = setTimeout(poll, 750);
    } catch (error) { busy = false; render(); message(error.message); }
  }
  render();
  const remembered = localStorage.getItem('gameverse-ir-last-run');
  if (remembered) { try { lastRun = await api(`/api/ir/runs/${remembered}`); busy = !['completed', 'failed', 'interrupted'].includes(lastRun.state); render(); if (busy) poll(); } catch { /* no retained run on this server */ } }
  return { updateParents: render };
}
