// Generate an experiment (v2/kits/EXTENDING.md, tier 3) with a code model: the model sees the
// experiment API, the kit's world, real snapshots of this game and the request, and returns
// { label, button, code }. Each draft is checked headless (check.js); problems go back to the
// model for up to `repairs` rounds. Server-only.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composeGame } from '../kits/mods/compose.js';
import { EXPERIMENT_SCHEMA, experimentWorld, freeButtons, safeSnapshot as snapshot } from './sandbox.js';
import { checkExperiment } from './check.js';

// Chosen by v2/experiments/eval.mjs (pass rate first, then latency); see the experiments report.
export const DEFAULT_MODEL = 'gpt-6-luna';
export const experimentModel = (env = process.env) => env.V2_EXPERIMENT_MODEL || DEFAULT_MODEL;
/** Reasoning effort per model family (V2_EXPERIMENT_EFFORT overrides; 'none' disables). */
export function experimentEffort(model, env = process.env) {
  if (env.V2_EXPERIMENT_EFFORT) return env.V2_EXPERIMENT_EFFORT === 'none' ? undefined : env.V2_EXPERIMENT_EFFORT;
  return /^(o\d|gpt-5|gpt-6)/.test(model) && !/chat/.test(model) ? 'low' : undefined;
}

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['label', 'button', 'code'],
  properties: {
    label: { type: 'string', description: 'Short name for the mechanic, at most 24 characters, e.g. "Falling bricks".' },
    button: { type: 'boolean', description: 'true when the mechanic needs its own button (a free a or b).' },
    code: { type: 'string', description: 'The complete ES module source: one `export default { label, button, init, step, draw }`, no imports.' },
  },
};

// The API section of EXTENDING.md, so the prompt stays in step with the contract.
let apiDoc = null;
function extendingApi() {
  if (apiDoc) return apiDoc;
  const text = readFileSync(new URL('../kits/EXTENDING.md', import.meta.url), 'utf8');
  const start = text.indexOf('## World snapshot and operations'), end = text.indexOf('## Promotion');
  return (apiDoc = text.slice(start, end > start ? end : undefined).trim());
}

// What the snapshot units mean in each kit's world (the adapters' own comments, condensed).
const UNITS = {
  maze: 'Units are maze tiles; x grows right, y grows down. snapshot.size is the maze in tiles and snapshot.blocked has its walls.',
  physics: 'Units are the current level\'s world units (in breakout a brick is 1 wide and 0.5 tall, the field about 13 wide); x grows right, y grows DOWN (y=0 is the top wall, the paddle sits near the bottom). The paddle (or cannon, pouch, flippers) is the player; bricks, pegs, foes or drop targets are the enemies.',
  runner: 'Positions are relative to the hero: x is the lane/side offset in lanes or tiles, y is distance ahead (or height in side modes). The world scrolls under the hero.',
  fighting: 'Units are tiles of 40 fighter units; x grows right, y grows UP from the floor (y=0). The player is fighter 0; the rival is the one enemy.',
  shmup: 'This kit has no world adapter yet: snapshots carry no player or enemies and no operation except emit applies. Read events and draw.',
};

const SYSTEM = `You write small, self-contained game mechanics ("experiments") as JavaScript ES modules that run sandboxed on top of an existing game.

The game engine (a "kit") owns the rules. Your module only sees a plain-JSON snapshot of the world each frame, keeps its own plain-JSON state, returns operations the host applies through the kit, and returns a display list the host draws on top of the game. This is the contract:

<api>
__API__
</api>

Hard rules (the module is rejected otherwise):
- Exactly one \`export default { label, button, init, step, draw }\`. No imports, no other exports. Plain modern JavaScript, no TypeScript.
- The sandbox has no Math.random, Date, performance, timers, Promise, async/await, fetch, DOM, console, eval or Function. Use the rng passed to init for randomness: keep it in a module-level variable (\`let rand; ... init(snapshot, rng) { rand = rng; ... }\`).
- State is plain JSON (objects, arrays, finite numbers, strings, booleans). No functions, classes, Maps, Sets, NaN or Infinity in state. step returns { state, ops } synchronously; ops is an array (may be empty).
- Use only operations whose capability the kit declares (listed below); every other operation is dropped. If the kit cannot do something natively (e.g. spawn or terrain is missing), simulate it in your own state and draw it, and use the available operations (defeat, stun, emit, ...) where your mechanic touches the game. emit is always available and makes the game's sound and effects react with the shared event names (collect, hit, defeated, power, hurt, ...).
- Each step and draw must take well under 1 ms: no big loops over large grids every frame. At most 150 draws per frame. At most a few ops per frame.
- Draw in world units (the same units as the snapshot). rect uses x, y as the top-left corner in world units and w, h as size in world units; circle r, line width and text size are in world units too. Colors are CSS color strings like "#ff6a3d" or "rgba(255,255,255,0.5)".
- The snapshot can have active: false (intros, deaths, menus): then keep state and draw, but don't act on the game.
- Expect any field to be missing or null (player may be null, enemies may be empty); never throw.
- Make it feel like the requested mechanic within seconds of play, readable on top of the game, and fair. Keep the code under 200 lines.

Reply with JSON: { "label": ..., "button": ..., "code": ... }. The module's own label and button must match.`;

const round = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const compact = snap => ({
  ...snap,
  player: snap.player && { x: round(snap.player.x), y: round(snap.player.y), facing: snap.player.facing },
  enemies: snap.enemies.slice(0, 10).map(e => ({ ...e, x: round(e.x), y: round(e.y), radius: round(e.radius) })),
  ...(snap.enemies.length > 10 ? { enemiesOmitted: snap.enemies.length - 10 } : {}),
  blocked: snap.blocked ? { w: snap.blocked.w, h: snap.blocked.h, bits: snap.blocked.bits.length > 1600 ? `${snap.blocked.bits.length} chars (omitted)` : snap.blocked.bits } : null,
  events: snap.events.slice(0, 6),
});

/** Where blocked() first turns true walking from the player in four directions (worlds without a grid). */
function probeWalls(world, state, player) {
  if (!player || !world.blocked) return null;
  const out = {};
  for (const [name, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]]) {
    let hit = null;
    for (let d = 0.25; d <= 80; d += 0.25) { try { if (world.blocked(state, player.x + dx * d, player.y + dy * d)) { hit = round(dx ? player.x + dx * d : player.y + dy * d); break; } } catch { break; } }
    out[name] = hit ?? 'open';
  }
  return out;
}

/** Real snapshots of this game at a few frames, under scripted play. */
export function sampleSnapshots(kit, content, { seed = 1, mods = {}, frames = [30, 200, 420] } = {}) {
  const game = composeGame(kit, content, { seed, mods });
  const world = experimentWorld(kit, game);
  const state = game.createState();
  const out = [];
  let walls = null;
  for (let i = 0, k = 0; i <= frames[frames.length - 1] && k < frames.length; i++) {
    game.step(state, { x: Math.floor(i / 50) % 2 ? 1 : -1, y: 0, a: i % 40 < 2, b: false });
    if (state.status !== 'playing') break;
    if (i === frames[k]) { const s = snapshot(kit, world, state, state.events || []); out.push(compact(s)); walls ??= s.blocked ? null : probeWalls(world, state, s.player); k++; }
  }
  return { snapshots: out, walls, freeButtons: freeButtons(kit, game) };
}

function contentSummary(kit, content) {
  const goal = kit.goal?.(content);
  let json = '';
  try { json = JSON.stringify(content); } catch {}
  return `${goal ? `Goal: ${goal}\n` : ''}Content (JSON${json.length > 2500 ? ', truncated' : ''}): ${json.slice(0, 2500)}`;
}

/** The user message for one request. */
export function experimentPrompt({ kit, record, request }) {
  const doc = record.doc || record;
  const checked = kit.validate ? kit.validate(doc.content) : { ok: true, content: doc.content };
  const content = checked.ok ? checked.content : doc.content;
  const { snapshots, walls, freeButtons: free } = sampleSnapshots(kit, content, { seed: doc.seed ?? 1, mods: doc.mods || {} });
  const caps = kit.world?.capabilities || [];
  const ops = ['emit', ...['spawn', 'setBlocked', 'score', 'hurt', 'defeat', 'stun'].filter(op => caps.includes({ setBlocked: 'terrain', score: 'score', hurt: 'hurt', spawn: 'spawn', defeat: 'defeat', stun: 'stun' }[op]))];
  return [
    `Kit: ${kit.name} (${kit.id} ${kit.version}). ${kit.summary}`,
    `World capabilities: ${caps.join(', ') || 'none'}. Operations that will apply here: ${ops.join(', ')}. Every other operation is dropped.`,
    UNITS[kit.id] ? `Units: ${UNITS[kit.id]}` : 'Units: infer them from the snapshots.',
    `Buttons: ${free.length ? `${free.join(' and ')} ${free.length > 1 ? 'are' : 'is'} free, so button: true gives your mechanic its own button (input.held / input.pressed).` : 'none free; set button: false and drive the mechanic from movement input (input.x, input.y) and the game.'}`,
    `Game: "${doc.title || 'Untitled'}"${doc.logline ? ` — ${doc.logline}` : ''}`,
    contentSummary(kit, content),
    `Mods on: ${JSON.stringify(doc.mods || {})}`,
    walls ? `Terrain probe from the player (blocked() first true at): ${JSON.stringify(walls)}` : '',
    `Snapshots of this game during play:\n${snapshots.map(s => JSON.stringify(s)).join('\n')}`,
    `Request: ${request}`,
  ].filter(Boolean).join('\n\n');
}

function parseReply(text) {
  let out;
  try { out = JSON.parse(text); } catch { const m = /\{[\s\S]*\}/.exec(text); out = m ? JSON.parse(m[0]) : null; }
  if (!out || typeof out.code !== 'string') throw Object.assign(Error('the code model returned no module'), { status: 502 });
  // Models sometimes fence the module even inside JSON.
  const code = out.code.replace(/^\s*```(?:js|javascript)?\s*\n/, '').replace(/\n```\s*$/, '');
  return { label: String(out.label || 'Experiment').slice(0, 40), button: out.button === true, code };
}

const describe = problems => problems.map(p => `- ${p.message}${p.hint ? ` (hint: ${p.hint})` : ''}`).join('\n');

/**
 * generateExperiment({ client, model, kit, record, request }) -> { experiment, report }
 * experiment: { schema, id, label, button, request, code, check } (check is the last check's { ok, problems, report }).
 */
export async function generateExperiment({ client, model = experimentModel(), effort = experimentEffort(model), kit, record, request, repairs = 2, check = checkExperiment, isolate = true }) {
  const started = performance.now();
  const doc = record.doc || record;
  const system = SYSTEM.replace('__API__', () => extendingApi());
  const user = experimentPrompt({ kit, record, request });
  const attempts = [];
  let conversation = user, draft = null, result = null;
  for (let attempt = 0; attempt <= repairs; attempt++) {
    const reply = await client.complete({ model, effort, system, user: conversation, schema: { name: 'experiment', schema: OUTPUT_SCHEMA } });
    let problems;
    try {
      draft = parseReply(reply.text);
      result = await check(draft, { kit, content: doc.content, seed: doc.seed ?? 1, mods: doc.mods || {}, isolate });
      problems = result.problems;
    } catch (error) {
      if (error.status) throw error;
      result = { ok: false, problems: [{ code: 'reply', message: String(error.message || error) }], warnings: [], report: {} };
      problems = result.problems;
    }
    attempts.push({ attempt, modelMs: reply.ms, served: reply.model, usage: reply.usage ? { input: reply.usage.input_tokens, output: reply.usage.output_tokens } : null, ok: result.ok, problems: problems.map(p => p.message).slice(0, 6), checkMs: result.report?.timings?.totalMs ?? null });
    if (result.ok || attempt === repairs || !draft) break;
    conversation = `${user}\n\nYour previous module:\n\`\`\`js\n${draft.code}\n\`\`\`\n\nIt failed the headless check (600 frames of real play):\n${describe(problems)}\n\nReturn the complete corrected module.`;
  }
  const label = result?.report?.label || draft?.label || 'Experiment';
  const button = result?.report?.button ?? draft?.button ?? false;
  const code = draft?.code ?? '';
  const experiment = {
    schema: EXPERIMENT_SCHEMA, id: `exp-${createHash('sha256').update(code).digest('hex').slice(0, 12)}`, label, button, request, code,
    check: { ok: !!result?.ok, problems: result?.problems || [], warnings: result?.warnings || [], report: result?.report || {} },
    provenance: { model, effort: effort || null, kit: kit.id, kitVersion: kit.version, attempts: attempts.length, created: new Date().toISOString() },
  };
  return { experiment, report: { ok: !!result?.ok, model, effort: effort || null, attempts, totalMs: Math.round(performance.now() - started) } };
}
