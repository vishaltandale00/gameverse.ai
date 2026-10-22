// Shared content repair for kits: models often write ids as "lava_pit" or "Lava Pit".
// slugifyIds turns the ids of the given collections into lowercase slugs and rewrites
// every exact reference to them anywhere in the content, so a game never fails on punctuation.
export const slug = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export function slugifyIds(content, collections) {
  const map = new Map();
  for (const key of collections) for (const item of Array.isArray(content?.[key]) ? content[key] : []) {
    if (typeof item?.id !== 'string') continue;
    const next = slug(item.id);
    if (next && next !== item.id) map.set(item.id, next);
  }
  if (!map.size) return content;
  const walk = v => typeof v === 'string' ? (map.get(v) ?? v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  return walk(content);
}
