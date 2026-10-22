// Game spec preflight: validate a spec against the module registry in
// milliseconds, before anything runs. Errors carry stable codes and fix hints
// so a planner (human or model) can repair the spec without guessing.
export const SPEC_SCHEMA = 'gameverse.v2.game-spec/0.1';
export const LIMITS = { maxRows: 64, maxColumns: 256, maxEntities: 1500, maxModules: 24 };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COMPARATORS = ['gte', 'lte', 'eq'];

function predicateErrors(predicate, path, known) {
  const errors = [];
  if (!predicate || typeof predicate !== 'object') return [{ code: 'predicate_invalid', path, message: 'predicate must be an object' }];
  if (predicate.all || predicate.any) {
    const list = predicate.all || predicate.any;
    if (!Array.isArray(list) || !list.length) return [{ code: 'predicate_invalid', path, message: 'all/any needs a non-empty list' }];
    list.forEach((p, i) => errors.push(...predicateErrors(p, `${path}.${predicate.all ? 'all' : 'any'}[${i}]`, known)));
    return errors;
  }
  const subject = predicate.var !== undefined ? 'var' : predicate.count !== undefined ? 'count' : null;
  if (!subject) return [{ code: 'predicate_invalid', path, message: 'predicate needs var, count, all or any', hint: 'e.g. {"count":"reach_goal","gte":1}' }];
  const name = predicate[subject];
  const comparator = COMPARATORS.find(c => predicate[c] !== undefined);
  if (!comparator || !Number.isFinite(predicate[comparator])) errors.push({ code: 'predicate_invalid', path, message: `${subject} predicate needs a numeric gte, lte or eq` });
  const pool = subject === 'var' ? known.vars : known.events;
  if (!pool.has(name)) errors.push({ code: 'predicate_unknown_' + subject, path, message: `no module provides ${subject} '${name}'`, hint: `provided ${subject === 'var' ? 'vars' : 'events'}: ${[...pool].sort().join(', ') || 'none'}` });
  return errors;
}

function levelKinds(spec) {
  const counts = {};
  for (const row of spec.level?.rows || []) for (const ch of row) {
    const kind = spec.level.legend?.[ch];
    if (kind) counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

/** Validate and normalize a spec. Returns { ok, errors, warnings, spec }. */
export function preflight(spec, registry) {
  const errors = [], warnings = [];
  const fail = (code, path, message, hint) => errors.push({ code, path, message, ...(hint ? { hint } : {}) });
  if (!spec || typeof spec !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'spec must be an object' }], warnings, spec: null };
  if (spec.schema !== SPEC_SCHEMA) fail('schema', 'schema', `schema must be '${SPEC_SCHEMA}'`);
  if (!SLUG.test(spec.id || '')) fail('schema', 'id', 'id must be a lowercase slug');
  if (typeof spec.title !== 'string' || !spec.title.trim()) fail('schema', 'title', 'title is required');

  // Level: rectangular ASCII rows; every non-space character must be in the legend.
  const rows = spec.level?.rows, legend = spec.level?.legend || {};
  if (!Array.isArray(rows) || !rows.length || !rows.every(r => typeof r === 'string')) fail('level_shape', 'level.rows', 'level.rows must be a non-empty list of strings');
  else {
    const width = Math.max(...rows.map(r => r.length));
    if (rows.length > LIMITS.maxRows || width > LIMITS.maxColumns) fail('level_size', 'level.rows', `level is ${width}x${rows.length}; limit ${LIMITS.maxColumns}x${LIMITS.maxRows}`);
    if (rows.some(r => r.length !== width)) warnings.push({ code: 'level_ragged', path: 'level.rows', message: 'rows have different lengths; short rows are padded with empty space' });
    const missing = new Set();
    rows.forEach(r => { for (const ch of r) if (ch !== '.' && ch !== ' ' && !legend[ch]) missing.add(ch); });
    if (missing.size) fail('legend_missing', 'level.legend', `characters without legend entries: ${[...missing].join(' ')}`, "use '.' for empty space");
  }
  const kinds = spec.entities || {};
  for (const [ch, kind] of Object.entries(legend)) {
    if (ch.length !== 1) fail('legend_key', `level.legend.${ch}`, 'legend keys must be single characters');
    if (!kinds[kind]) fail('kind_missing', `level.legend.${ch}`, `legend maps '${ch}' to undefined entity kind '${kind}'`, `define entities.${kind}`);
  }
  for (const [name, def] of Object.entries(kinds)) {
    if (!SLUG.test(name)) fail('schema', `entities.${name}`, 'entity kind names must be lowercase slugs');
    if (def.w !== undefined && !(def.w > 0 && def.w <= 8)) fail('entity_size', `entities.${name}.w`, 'w must be in (0, 8] tiles');
    if (def.h !== undefined && !(def.h > 0 && def.h <= 8)) fail('entity_size', `entities.${name}.h`, 'h must be in (0, 8] tiles');
    if (def.tags !== undefined && (!Array.isArray(def.tags) || !def.tags.every(t => typeof t === 'string'))) fail('schema', `entities.${name}.tags`, 'tags must be a list of strings');
  }
  const counts = levelKinds(spec);
  const tagCount = tag => Object.entries(counts).reduce((n, [kind, c]) => n + ((kinds[kind]?.tags || []).includes(tag) ? c : 0), 0);
  const entityTotal = Object.entries(counts).reduce((n, [kind, c]) => n + (kinds[kind]?.solid ? 0 : c), 0);
  if (entityTotal > LIMITS.maxEntities) fail('budget', 'level.rows', `${entityTotal} entities exceed ${LIMITS.maxEntities}`);
  if (tagCount('player') !== 1) fail('player_count', 'level.rows', `exactly one player is required (found ${tagCount('player')})`, "tag one entity kind 'player' and place it once");

  // Modules: known ids, tunables in declared ranges, requirements met.
  const known = { vars: new Set(), events: new Set(['fell']) }; // engine-emitted events
  const modules = [];
  if (!Array.isArray(spec.modules) || !spec.modules.length) fail('schema', 'modules', 'at least one module is required');
  else if (spec.modules.length > LIMITS.maxModules) fail('budget', 'modules', `more than ${LIMITS.maxModules} modules`);
  (spec.modules || []).forEach((m, i) => {
    const path = `modules[${i}]`, mod = registry.get(m?.use);
    if (!mod) { fail('unknown_module', `${path}.use`, `unknown module '${m?.use}'`, `available: ${registry.ids().join(', ')}`); return; }
    const config = {};
    for (const [key, t] of Object.entries(mod.card.tunables || {})) {
      const value = m.with?.[key] ?? t.default;
      if (t.type === 'string') {
        if (typeof value !== 'string' || (t.options && !t.options.includes(value))) fail('tunable_range', `${path}.with.${key}`, `${key} must be ${t.options ? 'one of ' + t.options.join('|') : 'a string'}`);
      } else if (t.type === 'boolean') {
        if (typeof value !== 'boolean') fail('tunable_range', `${path}.with.${key}`, `${key} must be true or false`);
      } else if (!Number.isFinite(value) || value < t.min || value > t.max) {
        fail('tunable_range', `${path}.with.${key}`, `${key}=${value} outside [${t.min}, ${t.max}] ${t.unit || ''}`.trim(), `default ${t.default}`);
      }
      config[key] = value;
    }
    for (const key of Object.keys(m.with || {})) if (!(key in (mod.card.tunables || {}))) fail('unknown_tunable', `${path}.with.${key}`, `module '${mod.id}' has no tunable '${key}'`, `tunables: ${Object.keys(mod.card.tunables || {}).join(', ')}`);
    for (const tag of mod.requiresTags?.(config) || []) if (!tagCount(tag)) fail('requires_unmet', path, `module '${mod.id}' needs at least one entity tagged '${tag}'`, `add '${tag}' to an entity kind's tags and place it in the level`);
    for (const v of mod.providesVars?.(config) || []) known.vars.add(v);
    for (const e of mod.providesEvents?.(config) || []) known.events.add(e);
    modules.push({ use: mod.id, with: config });
  });
  const used = new Set(modules.map(m => m.use));
  for (const m of modules) for (const other of registry.get(m.use).card.conflicts || []) if (used.has(other)) fail('module_conflict', 'modules', `'${m.use}' cannot be combined with '${other}'`);

  if (!spec.win) fail('schema', 'win', 'a win predicate is required', '{"count":"reach_goal","gte":1}');
  else errors.push(...predicateErrors(spec.win, 'win', known));
  if (spec.lose) errors.push(...predicateErrors(spec.lose, 'lose', known));

  const normalized = errors.length ? null : {
    ...spec, seed: spec.seed ?? 1, background: spec.background || '#101820', tile: spec.tile || 16,
    level: { ...spec.level, rows: rows.map(r => r.padEnd(Math.max(...rows.map(x => x.length)), '.')) },
    modules,
  };
  return { ok: !errors.length, errors, warnings, spec: normalized, provides: { vars: [...known.vars].sort(), events: [...known.events].sort() } };
}
