const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'blocked', 'interrupted']);
const describe = value => typeof value === 'string' ? value : value?.label || value?.title || value?.id || value?.kind || '';

export function mountRomPreparation(root, api, onPrepared = () => {}) {
  const host = root.querySelector('[id="rom-preparation"]');
  if (!host) return () => {};
  const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  const panel = make('section', '', 'rom-preparation');
  const title = make('h3', 'Prepare local game files');
  const privacy = make('p', 'Upload an original .gba to identify it and prepare supported fixtures locally. This step uses no AI and starts no game build or gameplay. File bytes and filenames stay out of your idea and model context.', 'fine');
  const drop = make('div', '', 'rom-drop');
  const label = make('label', 'Choose or drop an original .gba file');
  const input = make('input'); input.type = 'file'; input.accept = '.gba'; label.append(input);
  const upload = make('button', 'Upload & prepare'); upload.type = 'button'; upload.disabled = true;
  const cancel = make('button', 'Stop preparation'); cancel.type = 'button'; cancel.hidden = true;
  drop.append(label, upload, cancel);
  const status = make('p', 'Checking local preparation support…', 'fine'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const output = make('div', '', 'rom-preparation-output');
  const saved = make('details'); saved.append(make('summary', 'Previously supplied originals')); const originals = make('div'); saved.append(originals);
  panel.append(title, privacy, drop, status, output, saved); host.replaceChildren(panel);
  let catalog = null, file = null, busy = false, timer = null, disposed = false, generation = 0, activeJob = null;
  const maxBytes = () => catalog?.limits?.max_upload_bytes || 32 * 1024 * 1024;
  const buttons = () => { upload.disabled = busy || !file || !catalog; input.disabled = busy; };
  function selectFile(value) {
    if (busy || !value) return;
    if (!/\.gba$/i.test(value.name || '')) { file = null; status.textContent = 'Choose an uncompressed .gba original. Archives and other file types are not supported.'; }
    else if (!value.size || value.size > maxBytes()) { file = null; status.textContent = `Choose a nonempty .gba up to ${Math.floor(maxBytes() / 1024 / 1024)} MiB.`; }
    else { file = value; status.textContent = `Ready to identify and prepare a ${(value.size / 1024 / 1024).toFixed(1)} MiB original locally.`; }
    buttons();
  }
  function renderJob(job, receipt) {
    const identity = catalog?.originals?.find(item => item.id === (job.game_id || receipt?.game_id));
    const recognized = make('p', `Recognized: ${job.title || identity?.title || job.game_id || receipt?.game_id || 'original'}${identity?.game_code ? ` · ${identity.game_code}` : ''}${identity?.revision !== undefined ? ` · revision ${identity.revision}` : ''}.`);
    const summary = make('p', job.message || job.error?.message || `Preparation: ${job.status || 'pending'}.`, 'fine');
    const nodes = [recognized, summary];
    if (job.stage) nodes.push(make('p', `Stage: ${job.stage}`, 'fine'));
    if (TERMINAL.has(job.status)) nodes.push(make('p', 'Preparation records local fixture evidence. Game build and native gameplay qualification are separate steps.', 'fine'));
    const outputs = job.artifacts || job.outputs || job.fixtures || job.preparation?.outputs || [];
    if (outputs.length) {
      const list = make('ul');
      for (const item of outputs) list.append(make('li', typeof item === 'string' ? item : `${describe(item)}${item.kind ? ` · ${item.kind.replaceAll('-', ' ')}` : ''}${item.status ? ` · ${item.status}` : ''}${item.scope ? ` · ${item.scope}` : ''}${item.sha256 ? ` · sha256 ${item.sha256}` : ''}`));
      nodes.push(make('p', 'Prepared outputs', 'fine'), list);
    }
    const remaining = job.remaining_inputs || job.missing_inputs || job.preparation?.remaining_inputs || [];
    if (remaining.length) nodes.push(make('p', `Still required: ${remaining.map(describe).join('; ')}`, 'fine'));
    const gaps = job.gaps || job.preparation?.gaps || [];
    if (gaps.length) nodes.push(make('p', `Preparation limits: ${gaps.map(describe).join('; ')}`, 'fine'));
    const evidence = make('details'); evidence.append(make('summary', 'Identity & preparation provenance'));
    for (const [label, value] of [['Original SHA-256', job.sha256 || receipt?.sha256], ['Original SHA-1', job.sha1 || receipt?.sha1 || identity?.sha1], ['Preparation job', job.job_id], ['Recipe', job.recipe_id || (job.recipe ? `${describe(job.recipe)}${job.recipe.version !== undefined ? ` · version ${job.recipe.version}` : ''}` : '')], ['Outcome', job.outcome || job.classification], ['Preparation time', Number.isFinite(job.timings?.total_ms) ? `${job.timings.total_ms} ms` : 'unavailable']]) if (value) evidence.append(make('p', `${label}: ${describe(value)}`, 'fine'));
    nodes.push(evidence); output.replaceChildren(...nodes);
  }
  async function refreshOriginals(quiet = false) {
    try {
      const data = await api('/api/mashup/roms'); if (disposed) return; catalog = data;
      const available = (data.originals || []).filter(item => item.status === 'available');
      originals.replaceChildren(...available.map(item => {
        const row = make('div', '', 'rom-original'); row.append(make('span', `${item.title || item.id}${item.revision !== undefined ? ` · rev ${item.revision}` : ''}`));
        const view = item.preparation?.job_id && ['running', 'completed'].includes(item.preparation.status);
        const prepare = make('button', view ? 'View preparation' : 'Prepare fixtures'); prepare.type = 'button'; prepare.disabled = busy;
        prepare.addEventListener('click', () => {
          if (busy) return;
          const receipt = { sha256: item.sha256, game_id: item.id };
          if (!view) return prepareOriginal(receipt);
          busy = true; buttons(); activeJob = item.preparation.job_id; cancel.hidden = item.preparation.status === 'completed'; poll(activeJob, receipt, ++generation);
        }); row.append(prepare); return row;
      }));
      if (!available.length) originals.append(make('p', 'No originals supplied to this local preparation store yet.', 'fine'));
      if (!quiet && !busy) status.textContent = `Deterministic local preparation available · upload limit ${Math.floor(maxBytes() / 1024 / 1024)} MiB. Exact original revisions are checked by hash.`;
    } catch (error) { if (!disposed && !quiet) status.textContent = `Local preparation is unavailable: ${error.message}`; }
    buttons();
  }
  async function poll(jobId, receipt, token) {
    try {
      const job = await api(`/api/mashup/rom-jobs/${encodeURIComponent(jobId)}`);
      if (disposed || token !== generation) return;
      renderJob(job, receipt); status.textContent = `Local fixture preparation: ${job.status}.`;
      if (TERMINAL.has(job.status)) { activeJob = null; cancel.hidden = true; busy = false; buttons(); await refreshOriginals(true); if (!disposed) await onPrepared(); }
      else timer = setTimeout(() => poll(jobId, receipt, token), 1000);
    } catch (error) { if (!disposed && token === generation) { busy = false; buttons(); status.textContent = `Preparation status unavailable: ${error.message} Reload this panel to check supplied originals.`; } }
  }
  async function prepareOriginal(receipt) {
    if (disposed) return;
    busy = true; buttons(); const token = ++generation;
    status.textContent = 'Original identified. Preparing supported fixtures locally…'; renderJob({ status: 'queued', game_id: receipt.game_id }, receipt);
    try {
      const job = await api(`/api/mashup/roms/${encodeURIComponent(receipt.sha256)}/prepare`, { method: 'POST', body: '{}' });
      if (disposed || token !== generation) return;
      renderJob(job, receipt);
      if (job.job_id) { activeJob = job.job_id; cancel.hidden = TERMINAL.has(job.status); await poll(job.job_id, receipt, token); }
      else { busy = false; buttons(); status.textContent = `Local fixture preparation: ${job.status || 'receipt retained'}.`; await refreshOriginals(true); if (!disposed) await onPrepared(); }
    } catch (error) { if (!disposed && token === generation) { busy = false; buttons(); status.textContent = `Preparation could not finish: ${error.message}`; await refreshOriginals(true); } }
  }
  input.addEventListener('change', () => selectFile(input.files?.[0]));
  cancel.addEventListener('click', async () => {
    if (!activeJob || disposed) return;
    cancel.disabled = true;
    try { await api(`/api/mashup/rom-jobs/${encodeURIComponent(activeJob)}`, { method: 'DELETE' }); if (!disposed) status.textContent = 'Stopping local preparation. Waiting for its cleanup and recorded result…'; }
    catch (error) { if (!disposed) status.textContent = `Could not stop preparation: ${error.message}`; }
    finally { cancel.disabled = false; }
  });
  drop.addEventListener('dragover', event => { event.preventDefault(); });
  drop.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files?.length !== 1) { status.textContent = 'Supply one .gba original at a time.'; return; } selectFile(event.dataTransfer.files[0]); });
  upload.addEventListener('click', async () => {
    if (busy || !file || !catalog) return;
    busy = true; buttons(); status.textContent = 'Identifying the original locally by its bytes…';
    try {
      const receipt = await api('/api/mashup/roms', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      file = null; input.value = ''; await prepareOriginal(receipt);
    } catch (error) { if (!disposed) { busy = false; buttons(); status.textContent = `Original could not be prepared: ${error.message}`; } }
  });
  refreshOriginals();
  return () => { disposed = true; generation++; clearTimeout(timer); };
}
