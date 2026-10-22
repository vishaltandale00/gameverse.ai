#!/usr/bin/env node
// Host-owned acceptance check for a promoted mod, run by the job in the job's worktree (never by the
// agent): node v2/improve/check-mod.mjs --root <worktree> --kit <kitId> --mod <modId>
// - the mod has the native mod shape (v2/kits/mods/weapon.js) and a strict schema fragment;
// - its source uses no wall clock, Math.random, timers, network or dynamic imports;
// - the target kit offers it by capability, and it composes with the kit's sample, steps 600 frames
//   deterministically and renders on a stub canvas;
// - every other kit whose capabilities allow it runs it the same way; every kit that doesn't, never enables it.
// Prints one JSON line and exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const root = resolve(arg('root') || '.'), kitId = arg('kit'), modId = arg('mod');
const problems = [], ran = [], skipped = [];
const fail = msg => problems.push(msg);
const load = rel => import(pathToFileURL(join(root, rel)).href);

const stubCanvas = () => new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 640, height: 480 } : k === 'measureText' ? () => ({ width: 40 }) : k === 'getTransform' ? () => ({ a: 1 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k in t ? t[k] : (typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const strict = (node, path) => {
  if (node?.type === 'object') {
    if (node.additionalProperties !== false) fail(`${path}: additionalProperties must be false`);
    const req = [...(node.required || [])].sort().join(), keys = Object.keys(node.properties || {}).sort().join();
    if (req !== keys) fail(`${path}: every property must be required`);
    for (const [k, v] of Object.entries(node.properties || {})) strict(v, `${path}.${k}`);
  }
  if (node?.items) strict(node.items, `${path}[]`);
  for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems']) if (node && bad in node) fail(`${path}: ${bad} is not allowed in strict mode`);
};

// An enabled config: the mod's own `sample` when it has one, else one synthesized from its schema.
function enabledConfig(mod) {
  if (mod.sample) return mod.normalize(mod.sample);
  const props = mod.schema?.properties || {};
  const pick = v => v.enum ? v.enum.find(x => x !== 'none' && x !== 'off') ?? v.enum[0] : v.type === 'boolean' ? true : v.type === 'integer' || v.type === 'number' ? 3 : v.type === 'string' ? '' : null;
  return mod.normalize(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, pick(v)])));
}

function play(kit, compose, mod, cfg, seed) {
  const content = kit.validate(kit.content.sample).content;
  const game = compose.composeGame(kit, content, { seed, mods: { [mod.id]: cfg } });
  if (!game.mods.some(a => a.mod.id === mod.id)) throw Error('the composer did not enable the mod with its sample config');
  const s = game.createState();
  if (!s.mods || !(mod.id in s.mods)) throw Error('state.mods has no entry for the mod');
  const render = compose.composeRenderer(kit, game, { art: {} }), ctx = stubCanvas();
  for (let i = 0; i < 600; i++) {
    game.step(s, { x: Math.sign(Math.sin(i / 17)), y: i % 90 < 10 ? 1 : i % 90 < 20 ? -1 : 0, a: i % 23 < 2, b: i % 41 < 2 });
    if (!['playing', 'won', 'lost'].includes(s.status)) throw Error(`bad status ${s.status} at frame ${i}`);
    if (i % 4 === 0) render(ctx, s, { cssWidth: 640, cssHeight: 480, dt: 1 / 60, events: s.events });
  }
  const json = JSON.stringify(s.mods[mod.id]);
  if (JSON.stringify(structuredClone(JSON.parse(json))) !== json) throw Error('mod state is not plain JSON');
  return JSON.stringify(s);
}

try {
  if (!kitId || !modId) throw Error('usage: check-mod.mjs --root <dir> --kit <kitId> --mod <modId>');
  const source = readFileSync(join(root, 'v2/kits/mods', `${modId}.js`), 'utf8');
  for (const [re, what] of [[/Math\.random/, 'Math.random'], [/Date\.now|new Date\b|performance\.now/, 'wall-clock time'], [/\bset(Timeout|Interval)\b|requestAnimationFrame/, 'timers'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, 'network'], [/\bimport\s*\(|\brequire\s*\(/, 'dynamic imports'], [/\beval\s*\(|new Function\b/, 'eval']]) if (re.test(source)) fail(`mod source uses ${what}; mods must be deterministic and self-contained`);
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) if (!m[1].startsWith('./') && !m[1].startsWith('../')) fail(`mod imports '${m[1]}'; only relative imports inside v2 are allowed`);

  const { availableKits } = await load('v2/kits/registry.js');
  const compose = await load('v2/kits/mods/compose.js');
  const { MODS } = await load('v2/kits/mods/index.js');
  const mod = MODS.find(m => m.id === modId);
  if (!mod) throw Error(`v2/kits/mods/index.js does not register a mod with id '${modId}' (registered: ${MODS.map(m => m.id).join(', ')})`);
  for (const k of ['normalize', 'enabled', 'label', 'init', 'step']) if (typeof mod[k] !== 'function') fail(`mod.${k} must be a function`);
  if (typeof mod.summary !== 'string' || !mod.summary.trim()) fail('mod.summary must be a non-empty string');
  if (!Array.isArray(mod.requires) || !mod.requires.length) fail('mod.requires must list the world capabilities it needs');
  if (mod.render != null && typeof mod.render !== 'function') fail('mod.render must be a function when present');
  strict(mod.schema, `${modId}.schema`);
  if (mod.normalize({}) == null || mod.enabled(mod.normalize({})) !== false) fail('normalize({}) must give a config that is switched off (mods are off unless content asks)');
  const cfg = enabledConfig(mod);
  if (!mod.enabled(cfg)) throw Error('could not get an enabled config: give the mod a `sample` config that enables it');
  if (problems.length) throw Error('shape');

  const kits = await availableKits();
  const target = kits.find(k => k.id === kitId);
  if (!target) throw Error(`unknown target kit '${kitId}'`);
  for (const { id, kit } of kits) {
    const offered = compose.modsFor(kit).some(m => m.id === modId);
    if (!offered) {
      if (id === kitId) fail(`the target kit '${kitId}' does not offer the mod: it requires [${mod.requires}] and the kit declares [${kit.world?.capabilities || []}]${mod.button ? ` with buttons [${kit.world?.buttons || []}]` : ''}`);
      else if (compose.activeMods(kit, { [modId]: cfg }).some(a => a.mod.id === modId)) fail(`${id}: the mod is enabled although the kit lacks its capabilities`);
      skipped.push(id);
      continue;
    }
    try {
      if (play(kit, compose, mod, cfg, 3) !== play(kit, compose, mod, cfg, 3)) fail(`${id}: same seed and inputs gave different states`);
      ran.push(id);
    } catch (error) { fail(`${id}: ${error.message}`); }
  }
} catch (error) { if (error.message !== 'shape') fail(error.message); }

console.log(JSON.stringify({ ok: !problems.length, kit: kitId, mod: modId, ran, skipped, problems: problems.slice(0, 20) }));
process.exitCode = problems.length ? 1 : 0;
