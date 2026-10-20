// Versioned game storage. Every published version is an immutable JSON file
// with the document, its verification report and provenance (content hash,
// seed, planner and catalogue versions), so any game can be replayed exactly.
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const canonical = value => JSON.stringify(value, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const hashOf = value => createHash('sha256').update(canonical(value)).digest('hex');

export function createStore(root) {
  const gameDir = id => join(root, 'games', id);
  async function writeJson(path, value) {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 1)); await rename(temporary, path);
  }
  async function readJson(path, fallback = null) {
    try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  return {
    root,
    async createGame({ id, prompt, title, parent = null }) {
      await mkdir(gameDir(id), { recursive: true });
      const meta = { id, prompt, title: title || prompt.slice(0, 60), parent, created: new Date().toISOString(), versions: 0, status: 'generating', latest: null };
      await writeJson(join(gameDir(id), 'meta.json'), meta); return meta;
    },
    async updateMeta(id, patch) {
      const meta = { ...(await readJson(join(gameDir(id), 'meta.json'))), ...patch };
      await writeJson(join(gameDir(id), 'meta.json'), meta); return meta;
    },
    /** Publish an immutable version; returns its record (without the document body). */
    async publish(id, { doc, report, provenance, stage }) {
      const meta = await readJson(join(gameDir(id), 'meta.json'));
      const version = meta.versions + 1;
      const record = { gameId: id, version, stage, created: new Date().toISOString(), docHash: hashOf(doc), provenance, report };
      await writeJson(join(gameDir(id), `v${version}.json`), { ...record, doc });
      await this.updateMeta(id, { versions: version, latest: version, title: doc.title || meta.title, logline: doc.logline || meta.logline || '' });
      return record;
    },
    async version(id, version) { return readJson(join(gameDir(id), `v${version}.json`)); },
    async latest(id) { const meta = await readJson(join(gameDir(id), 'meta.json')); return meta?.latest ? this.version(id, meta.latest) : null; },
    async meta(id) { return readJson(join(gameDir(id), 'meta.json')); },
    async list() {
      let ids = [];
      try { ids = await readdir(join(root, 'games')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const metas = (await Promise.all(ids.map(id => readJson(join(gameDir(id), 'meta.json'))))).filter(Boolean);
      return metas.sort((a, b) => b.created.localeCompare(a.created));
    },
  };
}
