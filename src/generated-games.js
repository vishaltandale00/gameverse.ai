// Pure helpers for hosting Gameverse v2 generated games inside the v1 shell:
// catalog entries, checkpoints, state carry-over between versions, input
// mapping and build-progress presentation. No DOM, network or engine imports.
export const GENERATED_KIND = 'generated';
export const GENERATED_ADAPTER = 'gameverse-generated/0.1.0';
export const GENERATED_SNAPSHOT_FORMAT = 'generated-json/1';
export const GENERATED_SPEC_SCHEMA = 'gameverse.v2.game-spec/0.1';
export const GENERATED_PREFIX = 'gen-';
export const GENERATED_ENTRY_URL = '/src/generated-adapter.js';

const V2_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const isGenerated = game => game?.kind === GENERATED_KIND;
/** Sports and generated games both run in-page with Start opening the shell menu. */
export const isHostedRuntime = game => game?.kind === 'custom-sports' || isGenerated(game);

/**
 * Turn GET /api/v2/games rows into v1 catalog entries. Only games with a
 * published arcade (2D spec) version are playable here. Oldest first, so venue
 * slots stay put as new games are added.
 */
export function generatedCatalogEntries(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row && V2_ID.test(String(row.id)) && Number.isInteger(row.latest) && row.latest >= 1 && (row.kind === 'arcade2d' || /^kit:[a-z0-9-]+$/.test(String(row.kind))))
    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')) || String(a.id).localeCompare(String(b.id)))
    .map(row => ({
      kind: GENERATED_KIND, id: GENERATED_PREFIX + row.id, v2Id: row.id,
      name: String(row.title || row.prompt || 'Untitled game').slice(0, 80),
      subtitle: 'Made in the Creator’s Lot', prompt: String(row.prompt || ''),
      version: row.latest, versions: row.versions ?? row.latest, status: row.status || 'ready',
      adapter: GENERATED_ADAPTER, snapshotFormat: GENERATED_SNAPSHOT_FORMAT,
      entryUrl: GENERATED_ENTRY_URL, created: row.created || null, ready: true,
    }));
}

export function encodeCheckpoint({ gameId, version, frame, state }) {
  return new TextEncoder().encode(JSON.stringify({ schema: 1, format: GENERATED_SNAPSHOT_FORMAT, gameId, version, frame, state }));
}

/** Decode a saved moment. Never throws for a version change; reports it instead. */
export function decodeCheckpoint(bytes, { gameId, version }) {
  let saved;
  try { saved = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Error('This saved moment is unreadable. Your earlier progress is retained.'); }
  if (saved?.schema !== 1 || saved.format !== GENERATED_SNAPSHOT_FORMAT || saved.gameId !== gameId) throw Error('This saved moment belongs to a different game.');
  if (!Number.isInteger(saved.frame) || saved.frame < 0 || !saved.state || typeof saved.state !== 'object') throw Error('This saved moment is incomplete.');
  if (saved.version !== version) return { restored: false, savedVersion: saved.version, reason: `Saved on v${saved.version}; this game is now v${version}, so it starts fresh.` };
  return { restored: true, savedVersion: saved.version, state: saved.state, frame: saved.frame };
}

const kindShape = def => JSON.stringify({ solid: !!def?.solid, tags: [...(def?.tags || [])].sort(), w: def?.w ?? 0.8, h: def?.h ?? 0.8 });

/**
 * Whether a running state from oldSpec stays meaningful under newSpec. The
 * level layout, entity kinds (solidity, tags, size) and the module list must
 * match; tunables, colours, glyphs, art, text and win/lose rules may change.
 */
export function canCarryState(oldSpec, newSpec) {
  if (!oldSpec || !newSpec) return false;
  const rows = spec => JSON.stringify(spec.level?.rows || []);
  const legend = spec => JSON.stringify(Object.entries(spec.level?.legend || {}).sort());
  if (rows(oldSpec) !== rows(newSpec) || legend(oldSpec) !== legend(newSpec)) return false;
  const kinds = spec => Object.keys(spec.entities || {}).sort();
  if (JSON.stringify(kinds(oldSpec)) !== JSON.stringify(kinds(newSpec))) return false;
  if (kinds(oldSpec).some(kind => kindShape(oldSpec.entities[kind]) !== kindShape(newSpec.entities[kind]))) return false;
  const uses = spec => JSON.stringify((spec.modules || []).map(m => m.use));
  return uses(oldSpec) === uses(newSpec);
}

const MOVE_KEYS = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'] };
export const GENERATED_KEYS = new Set([...Object.values(MOVE_KEYS).flat(), 'Space', 'KeyZ', 'KeyJ', 'KeyX', 'KeyK', 'KeyR', 'Enter']);
const clampAxis = v => Math.max(-1, Math.min(1, v));

/**
 * Map held keys and a sampled standard gamepad (see gamepad.js) to the v2
 * engine input {x, y, a, b}. A jumps/confirms (Space, Z, J, Enter, pad A);
 * B acts (X, K, pad X, or pad B unless the voice control owns it).
 */
export function generatedInput(keys, pad = null, { ownsB = false } = {}) {
  const held = list => list.some(code => keys.has(code));
  const button = i => Boolean(pad?.buttons?.[i]);
  const x = (held(MOVE_KEYS.right) || button(15) ? 1 : 0) - (held(MOVE_KEYS.left) || button(14) ? 1 : 0) + (pad?.move?.x || 0);
  const y = (held(MOVE_KEYS.down) || button(13) ? 1 : 0) - (held(MOVE_KEYS.up) || button(12) ? 1 : 0) + (pad?.move?.y || 0);
  return {
    x: clampAxis(x), y: clampAxis(y),
    a: held(['Space', 'KeyZ', 'KeyJ', 'Enter']) || button(0),
    b: held(['KeyX', 'KeyK']) || button(2) || (!ownsB && button(1)),
  };
}

const STAGES = { designing: 'Designing your game', revising: 'Revising the design', building: 'Building the level', playtesting: 'Playtesting', planning: 'Planning', art: 'Painting the art' };
/** One short human line for a /api/v2/events event, or null to skip it. */
export function progressLine(event) {
  if (!event) return null;
  switch (event.type) {
    case 'job_started': return 'Started';
    case 'queued': return `Queued (position ${event.position ?? '?'})`;
    case 'stage': {
      if (event.stage === 'playtested') return event.winnable ? 'Playtested: the test player can win' : 'Playtested';
      const label = STAGES[event.stage] || String(event.stage || 'Working').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
      return event.task ? `${label} · ${event.task}` : label;
    }
    case 'version': return `Version ${event.version} is playable`;
    case 'job_done': return 'Finished';
    case 'job_failed': return `Failed: ${event.error || 'unknown error'}`;
    default: return null;
  }
}

/**
 * Tiny level preview from a streamed partial spec ({rows, legend, entities}).
 * Returns {width, height, cells:[{x,y,color}]}; unknown characters are skipped.
 */
export function previewCells(partial) {
  const rows = Array.isArray(partial?.rows) ? partial.rows.filter(row => typeof row === 'string').slice(0, 64) : [];
  const width = Math.min(256, Math.max(0, ...rows.map(row => row.length)));
  const cells = [];
  rows.forEach((row, y) => [...row.slice(0, width)].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    const kind = partial.legend?.[ch], def = kind ? partial.entities?.[kind] : null;
    const color = typeof def?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(def.color) ? def.color : def?.solid ? '#7d8a96' : kind ? '#f2e3b3' : '#56606a';
    cells.push({ x, y, color });
  }));
  return { width, height: rows.length, cells };
}
