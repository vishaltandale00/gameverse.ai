// Offline planner: no model calls. Picks the most relevant example game,
// gives it the request's title and a seed derived from the request so
// procedural generators vary, and returns it whole. Deterministic for a
// given (prompt, seed, library), so results are repeatable.
import { readFileSync, readdirSync } from 'node:fs';
import { seedFrom } from '../kernel/rng.js';

const STOP = new Set('a an the of in on with and or to for my me i want make game where that is are be it its like who which some about into as at by'.split(' '));
const words = text => (text.toLowerCase().match(/[a-z]+/g) || []).filter(w => !STOP.has(w));

export function loadLibrary(dir = new URL('../games/', import.meta.url)) {
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
}

function relevance(prompt, doc) {
  const hay = JSON.stringify([doc.title, doc.logline, doc.genre, doc.plot?.premise, doc.spaces?.map(s => s.use), doc.systems?.map(s => s.use)]).toLowerCase();
  return words(prompt).reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}

export function createOfflinePlanner({ library = loadLibrary(), usable = () => true } = {}) {
  return {
    version: 'offline/0.1', repairs: 0,
    async outline(job) {
      const candidates = library.filter(usable);
      if (!candidates.length) throw Error('no usable example games in the library');
      const base = [...candidates].sort((a, b) => relevance(job.prompt, b) - relevance(job.prompt, a) || a.id.localeCompare(b.id))[0];
      const doc = structuredClone(base);
      const title = words(job.prompt).slice(0, 4).join(' ');
      if (title) doc.title = title.replace(/\b[a-z]/g, c => c.toUpperCase());
      doc.seed = job.seed ?? seedFrom(job.prompt);
      return { doc, details: [], basedOn: base.id };
    },
    async repair(result) { return result; },
    async detail() { return {}; },
  };
}
