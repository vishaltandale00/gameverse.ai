// Template discovery (ARCHITECTURE.md §5): every template module in v2/templates/ (each default-exports one
// `{ id, concept, doc, tune }`) plus every promoted template in v2/templates/promoted/<id>.json (written by the
// improvement loop, target 'template': `{ schema, template, provenance }`; an absent directory is no promoted
// templates, as catalog.js promotedPrimitives). No hand list: adding a file adds the template.
//
// Admission at load runs the contract's format stage only (contract.js formatProblems: cheap, no catalogue); a template
// failing it throws, naming the file and every problem. The full contract (checkTemplate) is enforced where it is
// affordable: by tests/v2-template-contract.test.js over every discovered template, and by promotion before a promoted
// file is written. Ids are de-duplicated: two modules with one id are a defect (throws); a promoted template whose id a
// module already has (the integrator folded it into a module) is the module's.
//
// Same API as index.js (TEMPLATES, templateById), so callers switch by import path.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { formatProblems } from './contract.js';

export const TEMPLATES_DIR = fileURLToPath(new URL('.', import.meta.url));
export const PROMOTED_DIR = join(TEMPLATES_DIR, 'promoted');
export const PROMOTED_SCHEMA = 'gameverse.v2.template/0.1';
/** The modules of v2/templates/ that are not templates: discovery, the contract and the hand-listed index. */
export const INFRASTRUCTURE = Object.freeze(['index.js', 'registry.js', 'contract.js']);

const admit = (template, from) => {
  const problems = formatProblems(template);
  if (problems.length) throw Object.assign(Error(`template ${from}: ${problems.map(p => `${p.code}: ${p.message}`).join('; ')}`), { code: 'template_invalid', problems });
  return template;
};

/** The promoted templates in `dir` (none when it does not exist), each read from its `{ schema, template, provenance }` file. */
export function promotedTemplates(dir = PROMOTED_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const file = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (file?.schema !== PROMOTED_SCHEMA) throw Object.assign(Error(`promoted template ${f}: schema is not ${PROMOTED_SCHEMA}`), { code: 'template_invalid' });
    const t = admit(file.template, `promoted/${f}`);
    if (`${t.id}.json` !== f) throw Object.assign(Error(`promoted template ${f}: its id is '${t.id}'`), { code: 'template_invalid' });
    return t;
  });
}

/**
 * Discover templates: the modules in `dir` (sorted by file name), then the promoted ones in `promotedDir`.
 * @param {{ dir?: string, promotedDir?: string }} [options]
 */
export async function loadTemplates({ dir = TEMPLATES_DIR, promotedDir = join(dir, 'promoted') } = {}) {
  const files = readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.js') && !INFRASTRUCTURE.includes(d.name)).map(d => d.name).sort();
  const modules = await Promise.all(files.map(f => import(pathToFileURL(join(dir, f)).href).then(m => admit(m.default, f))));
  const byId = new Map();
  modules.forEach((t, i) => {
    if (byId.has(t.id)) throw Object.assign(Error(`templates ${byId.get(t.id).file} and ${files[i]} both have id '${t.id}'`), { code: 'template_duplicate' });
    byId.set(t.id, { t, file: files[i] });
  });
  for (const t of promotedTemplates(promotedDir)) if (!byId.has(t.id)) byId.set(t.id, { t, file: `promoted/${t.id}.json` });
  return Object.freeze([...byId.values()].map(x => x.t));
}

export const TEMPLATES = await loadTemplates();
export const templateById = id => TEMPLATES.find(t => t.id === id) ?? null;
