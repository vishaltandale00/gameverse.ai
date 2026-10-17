const KIND_LABELS = { system: 'Systems', 'typed-ir': 'Typed systems', prefab: 'Prefabs', capability: 'Capability groups', asset: 'Assets', template: 'Templates', tool: 'Tools', source: 'Game sources' };
const readable = value => String(value || '').replaceAll('-', ' ');
export function requiredInputText(input) {
  return typeof input === 'string' ? input : `${readable(input.kind || 'input')}: ${input.id}${input.purpose ? ` — ${input.purpose}` : ''}`;
}
export function mountBuildRequirements(root, capabilities) {
  const host = root.querySelector('[id="creation-build-inputs"]');
  if (!host) return;
  const make = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  const notice = make('p', 'Library browsing needs no ROMs. Native builds still require the exact local originals, source assets and tools listed for each operation.'); notice.className = 'fine';
  const operations = capabilities.operations || (capabilities.backends || []).map(backend => ({ ...backend, backend: backend.id }));
  const rows = operations.map(operation => {
    const backend = capabilities.backends?.find(item => item.id === operation.backend) || operation;
    const missing = backend.missing_inputs || [];
    const status = missing.length ? `${missing.length} local inputs missing` : backend.available === true ? 'local inputs reported available · run checks required' : backend.available === false ? 'unavailable · check prerequisites' : 'local inputs not checked';
    const details = make('details', '');
    details.append(make('summary', `${readable(operation.id)} · ${status}`));
    if (operation.scope) details.append(make('p', operation.scope));
    const inputs = make('ul', '');
    for (const input of operation.required_inputs || backend.required_inputs || []) inputs.append(make('li', requiredInputText(input)));
    details.append(inputs);
    if (missing.length) details.append(make('p', `Missing locally: ${missing.map(requiredInputText).join('; ')}`));
    return details;
  });
  host.replaceChildren(notice, ...rows);
}
export function sourceWorldChoices(supported, games = []) {
  const canonical = id => id.replace(/^(pokemon-(?:firered|leafgreen|emerald|ruby|sapphire))-version$/, '$1');
  const sources = new Map();
  for (const source of [...supported, ...games]) {
    const id = canonical(typeof source === 'string' ? source : source.id);
    if (!sources.has(id)) sources.set(id, typeof source === 'string' ? id : { ...source, id });
  }
  return [...sources.values()];
}

// References accompany the request as structured context, never as inferred game names.
export function mountCreationLibrary(root, summary, api, references = new Set(), backends = [], onReferencesChange = () => {}) {
  const host = root.querySelector('[id="creation-library"]');
  if (!host || !summary) return;
  const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  const library = make('details', '', 'creation-library');
  const discovery = summary.discovery_mode === 'snapshot' ? ' · metadata snapshot' : summary.discovery_mode === 'local-indexes' ? ' · local indexes' : '';
  const headingText = `Explore available library · ${summary.counts?.games ?? summary.games?.length ?? 0} worlds${discovery}`;
  const heading = make('summary', `${headingText}${references.size ? ` · ${references.size} referenced` : ''}`);
  const intro = make('p', 'Browse source worlds, reusable systems, prefabs, art and tools. Reference useful material as context for the builder; each combination still needs compatible adapters.', 'fine');
  const coverage = make('p', '', 'fine');
  const counts = summary.counts || {};
  coverage.textContent = `${counts.games ?? summary.games?.length ?? 0} games · ${counts.systems ?? counts.system ?? 0} systems · ${counts.prefabs ?? counts.prefab ?? 0} prefabs · ${counts.assets ?? counts.asset ?? 0} assets · ${counts.tools ?? counts.tool ?? 0} tools`;
  if (summary.discovery_mode === 'snapshot') coverage.textContent += ' · Metadata snapshot: local source files, ROMs and build tools have not been checked.';
  else if (summary.discovery_mode === 'local-indexes') coverage.textContent += ' · Local research indexes: catalog discovery does not check build inputs.';
  if (backends.length) intro.append(document.createTextNode(` Installed build operations: ${backends.map(backend => `${readable(backend.id)}${backend.available === false ? ' (unavailable)' : ''}: ${backend.scope || backend.description || 'scope reported during planning'}`).join(' · ')}`));
  const filters = make('div', '', 'library-filters');
  const searchLabel = make('label', 'Search library'); const search = make('input'); search.type = 'search'; search.placeholder = 'Movement, Mario, creatures, graphics…'; searchLabel.append(search);
  const gameLabel = make('label', 'World'); const game = make('select');
  const option = (value, label) => { const el = make('option', label); el.value = value; return el; };
  game.append(option('', 'All worlds'), ...(summary.games || []).map(item => option(item.id, item.name || item.title || item.id)));
  gameLabel.append(game);
  const categoryLabel = make('label', 'Category'); const category = make('select');
  category.append(option('', 'All useful material'), ...(summary.categories || []).map(item => option(item.id, `${item.label || KIND_LABELS[item.id] || readable(item.id)} (${item.count})`)));
  categoryLabel.append(category); filters.append(searchLabel, gameLabel, categoryLabel);
  const status = make('p', 'Open the library to browse available material.', 'fine'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = make('div', '', 'library-results');
  const pagination = make('div', '', 'library-pagination');
  const previous = make('button', 'Previous'); previous.type = 'button';
  const next = make('button', 'Next'); next.type = 'button'; pagination.append(previous, next); pagination.hidden = true;
  library.append(heading, intro, coverage, filters, status, results, pagination); host.replaceChildren(library);
  let loaded = false, offset = 0, sequence = 0, timer;
  const limit = 12;
  async function load() {
    const token = ++sequence;
    status.textContent = 'Reading the local library…';
    const params = new URLSearchParams({ q: search.value.trim(), game: game.value, kind: category.value, limit: String(limit), offset: String(offset) });
    try {
      const data = await api(`/api/mashup/library?${params}`);
      if (token !== sequence) return;
      const items = data.items || [];
      results.replaceChildren(...items.map(item => {
        const card = make('article', '', 'library-item');
        const top = make('div', '', 'library-item-top');
        const title = make('h4', item.label || item.id);
        const readiness = make('span', item.readiness === 'metadata-only' ? 'Metadata only · local inputs not checked' : item.executable === true ? 'Build adapter available' : 'Source available · integration needed', 'library-readiness');
        top.append(title, readiness);
        const gameNames = (item.game_ids || []).map(id => summary.games?.find(source => source.id === id)?.name || readable(id));
        const metadata = make('p', `${KIND_LABELS[item.kind] || readable(item.kind)}${gameNames.length ? ` · ${gameNames.join(', ')}` : ''}`, 'fine');
        card.append(top, metadata);
        if (item.scope) card.append(make('p', item.scope, 'library-scope'));
        const detail = make('details'); detail.append(make('summary', 'Details & provenance'));
        if (item.readiness) detail.append(make('p', `Availability: ${readable(item.readiness)}.`, 'fine'));
        for (const operation of item.operations || []) detail.append(make('p', `Related build operation: ${operation.scope || readable(operation.id)}. Runtime prerequisites are checked per request; this does not qualify the referenced component as integrated.`, 'fine'));
        for (const [key, label] of [['dependencies', 'Dependencies'], ['gaps', 'Integration gaps']]) {
          if (item[key]?.length) detail.append(make('p', `${label}: ${item[key].map(value => typeof value === 'string' ? value : value.label || value.ref || value.id || JSON.stringify(value)).join('; ')}`, 'fine'));
        }
        const refs = (item.provenance || []).map(ref => typeof ref === 'string' ? ref : `${ref.ref || ''}${ref.sha256 ? ` (sha256 ${ref.sha256})` : ''}`);
        if (refs.length) detail.append(make('p', `Source: ${refs.join(' · ')}`, 'library-provenance fine'));
        const use = make('button', references.has(item.id) ? 'Remove reference' : 'Reference for build'); use.type = 'button'; use.setAttribute('aria-pressed', String(references.has(item.id)));
        use.addEventListener('click', () => {
          if (references.has(item.id)) references.delete(item.id);
          else if (references.size >= 16) { status.textContent = 'Up to 16 library references can accompany one request. Remove a reference before adding another.'; return; }
          else references.add(item.id);
          onReferencesChange();
          use.textContent = references.has(item.id) ? 'Remove reference' : 'Reference for build'; use.setAttribute('aria-pressed', String(references.has(item.id)));
          heading.textContent = `${headingText}${references.size ? ` · ${references.size} referenced` : ''}`;
          status.textContent = `${item.label} ${references.has(item.id) ? 'will accompany your request as source context' : 'removed from request context'}. Source references do not select a build adapter.`;
        });
        card.append(detail, use); return card;
      }));
      const total = data.total ?? items.length;
      status.textContent = total ? `${offset + 1}–${offset + items.length} of ${total.toLocaleString()} matching items. Availability describes source material; each build still needs compatible adapters and checks.` : 'No matching material. Try another world, category or search.';
      previous.disabled = offset === 0; next.disabled = offset + items.length >= total; pagination.hidden = total <= limit;
    } catch (error) { if (token === sequence) { status.textContent = `The library could not load: ${error.message}`; results.replaceChildren(); pagination.hidden = true; loaded = false; } }
  }
  library.addEventListener('toggle', () => { if (library.open && !loaded) { loaded = true; load(); } });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; load(); }, 250); });
  for (const filter of [game, category]) filter.addEventListener('change', () => { clearTimeout(timer); offset = 0; load(); });
  previous.addEventListener('click', () => { offset = Math.max(0, offset - limit); load(); });
  next.addEventListener('click', () => { offset += limit; load(); });
  return () => { clearTimeout(timer); sequence++; };
}
