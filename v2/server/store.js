// @ts-check
// Versioned game storage. Every published version is an immutable JSON file
// with the document, its verification report and provenance (content hash,
// seed, planner and catalogue versions), so any game can be replayed exactly.
import { mkdir, readFile, readdir, writeFile, rename, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isObj, num, prop, str } from '../kernel/guards.js';

/**
 * A JSON object read back from disk (meta.json, v<n>.json, failed-<n>.json, a runs.jsonl line). Its fields are
 * `unknown` and narrowed where they are used; a stored document becomes a `Doc` only through preflight.
 * @typedef {Record<string, unknown>} Stored
 */
/**
 * What a published version keeps besides the document (the body of v<n>.json without `doc`).
 * @typedef {{ gameId: string, version: number, stage: string, created: string, docHash: string, provenance: Record<string, unknown>, report: Record<string, unknown> }} VersionRecord
 */
/** @typedef {{ doc: unknown, report: Record<string, unknown>, provenance: Record<string, unknown>, stage: string }} PublishPayload */
/** @typedef {ReturnType<typeof createStore>} Store */

/** A thrown error's `code` (ENOENT, ...). @param {unknown} error */
const codeOf = error => prop(error, 'code');

/** @param {unknown} value */
const canonical = value => JSON.stringify(value, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
/** @param {unknown} value @returns {string} */
export const hashOf = value => createHash('sha256').update(canonical(value)).digest('hex');

/** @param {string} root */
export function createStore(root) {
  /** @param {string} id */
  const gameDir = id => join(root, 'games', id);
  /** @param {string} path @param {unknown} value */
  async function writeJson(path, value) {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 1)); await rename(temporary, path);
  }
  /** A stored JSON object, or null when the file is missing (or holds something other than an object). @param {string} path @returns {Promise<Stored | null>} */
  async function readJson(path) {
    /** @type {unknown} */
    let value;
    try { value = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (codeOf(error) === 'ENOENT') return null; throw error; }
    return isObj(value) ? value : null;
  }
  return {
    root,
    /** @param {{ id: string, prompt: string, title?: string, parent?: string | null }} game */
    async createGame({ id, prompt, title, parent = null }) {
      await mkdir(gameDir(id), { recursive: true });
      const meta = { id, prompt, title: title || prompt.slice(0, 60), parent, created: new Date().toISOString(), versions: 0, status: 'generating', latest: null };
      await writeJson(join(gameDir(id), 'meta.json'), meta); return meta;
    },
    /** @param {string} id @param {Record<string, unknown>} patch @returns {Promise<Stored>} */
    async updateMeta(id, patch) {
      const meta = { ...(await readJson(join(gameDir(id), 'meta.json'))), ...patch };
      await writeJson(join(gameDir(id), 'meta.json'), meta); return meta;
    },
    /** Publish an immutable version; returns its record (without the document body). @param {string} id @param {PublishPayload} payload @returns {Promise<VersionRecord>} */
    async publish(id, { doc, report, provenance, stage }) {
      const meta = await readJson(join(gameDir(id), 'meta.json'));
      if (!meta) throw Error(`no game ${id} to publish to`);
      const version = num(meta.versions) + 1;
      /** @type {VersionRecord} */
      const record = { gameId: id, version, stage, created: new Date().toISOString(), docHash: hashOf(doc), provenance, report };
      await writeJson(join(gameDir(id), `v${version}.json`), { ...record, doc });
      await this.updateMeta(id, { versions: version, latest: version, title: meta.sample ? meta.title : (prop(doc, 'title') || meta.title), logline: prop(doc, 'logline') || meta.logline || '' });
      return record;
    },
    /** Keep a failed job's record (error, stage reached, intermediate results) as failed-<n>.json; returns n. */
    /** @param {string} id @param {Record<string, unknown>} record @returns {Promise<number | null>} */
    async recordFailure(id, record) {
      const meta = await readJson(join(gameDir(id), 'meta.json'));
      if (!meta) return null;
      const n = num(meta.failures) + 1;
      await writeJson(join(gameDir(id), `failed-${n}.json`), { failure: n, ...record });
      await this.updateMeta(id, { failures: n });
      return n;
    },
    /** @param {string} id @param {number} n */
    async failure(id, n) { return Number.isInteger(n) && n > 0 ? readJson(join(gameDir(id), `failed-${n}.json`)) : null; },
    /** One line per finished job (done or failed) with its outcome and timings. */
    /** @param {string} id @param {Record<string, unknown>} record */
    async appendRun(id, record) { await appendFile(join(gameDir(id), 'runs.jsonl'), `${JSON.stringify(record)}\n`); },
    /** @param {string} id @returns {Promise<unknown[]>} */
    async runs(id) {
      try { return (await readFile(join(gameDir(id), 'runs.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => /** @type {unknown} */ (JSON.parse(line))); }
      catch (error) { if (codeOf(error) === 'ENOENT') return []; throw error; }
    },
    /** Save a binary asset for a game; returns its URL path. */
    /** @param {string} id @param {string} name @param {string | Uint8Array} bytes @returns {Promise<string>} */
    async saveAsset(id, name, bytes) {
      if (!/^[a-z0-9-]+\.(webp|svg)$/i.test(name)) throw Error('invalid asset name');
      await mkdir(join(gameDir(id), 'assets'), { recursive: true });
      await writeFile(join(gameDir(id), 'assets', name), bytes);
      return `/api/v2/games/${id}/assets/${name}`;
    },
    /** @param {string} id @param {string} name @returns {Promise<Buffer | null>} */
    async asset(id, name) {
      if (!/^[a-z0-9-]+$/.test(id) || !/^[a-z0-9-]+\.(webp|svg)$/i.test(name)) return null;
      try { return await readFile(join(gameDir(id), 'assets', name)); } catch (error) { if (codeOf(error) === 'ENOENT') return null; throw error; }
    },
    /** @param {string} id */
    async versions(id) {
      const meta = await readJson(join(gameDir(id), 'meta.json'));
      if (!meta) return [];
      const out = [];
      for (let v = 1; v <= num(meta.versions); v++) { const r = await readJson(join(gameDir(id), `v${v}.json`)); if (r) out.push({ version: v, stage: r.stage, created: r.created, docHash: r.docHash }); }
      return out;
    },
    /** @param {string} id */
    async remove(id) {
      if (!/^[a-z0-9-]+$/.test(id)) throw Error('invalid game id');
      const { rm } = await import('node:fs/promises');
      await rm(gameDir(id), { recursive: true, force: true });
    },
    /** @param {string} id @param {number} version */
    async version(id, version) { return readJson(join(gameDir(id), `v${version}.json`)); },
    /** @param {string} id @returns {Promise<Stored | null>} */
    async latest(id) { const meta = await readJson(join(gameDir(id), 'meta.json')); return meta?.latest ? this.version(id, num(meta.latest)) : null; },
    /** @param {string} id */
    async meta(id) { return readJson(join(gameDir(id), 'meta.json')); },
    async list() {
      /** @type {string[]} */
      let ids = [];
      try { ids = await readdir(join(root, 'games')); } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
      const metas = (await Promise.all(ids.map(id => readJson(join(gameDir(id), 'meta.json'))))).filter(meta => meta !== null);
      return metas.sort((a, b) => str(b.created).localeCompare(str(a.created)));
    },
  };
}
