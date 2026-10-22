// @ts-check
// Pull whatever is already complete out of a partially streamed game spec, for
// live build previews: title, pitch, background, legend, entity looks and the
// level rows finished so far. Tolerant of truncation; never throws.
/** @param {string} text @param {string} key @returns {string | null} */
const str = (text, key) => { const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)); try { return m ? JSON.parse(`"${m[1]}"`) : null; } catch { return null; } };

/**
 * What a partially streamed spec already shows.
 * @typedef {{ title: string | null, pitch: string | null, background: string | null, rows: string[], legend: Record<string, string>,
 *   entities: Record<string, { solid: boolean, glyph: string | null, color: string | null }>, chars: number }} PartialSpec
 */

/** @param {string} text model output streamed so far @returns {PartialSpec} */
export function partialSpec(text) {
  /** @type {PartialSpec} */
  const out = { title: str(text, 'title'), pitch: str(text, 'pitch'), background: str(text, 'background'), rows: [], legend: {}, entities: {}, chars: text.length };
  const rowsAt = text.search(/"rows"\s*:\s*\[/);
  if (rowsAt >= 0) {
    const tail = text.slice(rowsAt).replace(/^"rows"\s*:\s*\[/, '');
    for (const m of tail.matchAll(/\s*"((?:[^"\\]|\\.)*)"\s*(,|\])/g)) { out.rows.push(m[1]); if (m[2] === ']') break; }
  }
  const legendAt = text.search(/"legend"\s*:\s*\{/);
  if (legendAt >= 0) for (const m of text.slice(legendAt).slice(0, 2000).matchAll(/"(.)"\s*:\s*"([a-z0-9-]+)"/g)) out.legend[m[1]] = m[2];
  const entitiesAt = text.search(/"entities"\s*:\s*\{/);
  if (entitiesAt >= 0) for (const m of text.slice(entitiesAt).matchAll(/"([a-z0-9-]+)"\s*:\s*\{([^{}]*)\}/g)) {
    const body = m[2];
    out.entities[m[1]] = { solid: /"solid"\s*:\s*true/.test(body), glyph: str(body, 'glyph'), color: str(body, 'color') };
  }
  return out;
}
