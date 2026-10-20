// Default UI and audio for any document. defaultGraphics(doc, registry)
// returns the graphics instances to add so a game that lists no UI still gets
// a sensible HUD, menu/pause, dialogue, journal, map, inventory, battle/card
// screens and sound, chosen from the systems the document actually uses
// (combat.health -> hp, plot.quest -> journal, gameplay.economy -> money...).
// Nothing game-specific: every rule keys off primitive ids, cards and data.

const has = (registry, id) => (registry ? registry.has(id) : true);
const sysOf = (doc, id) => (doc.systems || []).find(s => s.use === id || s.use.startsWith(id + '.'));
const uses = (doc, id) => Boolean(sysOf(doc, id));
const actionsProvided = (doc, registry) => new Set((doc.systems || []).flatMap(s => registry?.get(s.use)?.card?.provides?.actions || []));

/** True when the document is a text/menu game (graph or none spaces and no world renderer). */
export function isTextual(doc) {
  const spatial = (doc.spaces || []).some(s => !/space\.(graph|none)$/.test(s.use || ''));
  const renderer = (doc.graphics || []).some(g => /graphics\.(render|camera)\./.test(g.use));
  return !spatial && !renderer;
}

/** HUD configuration derived from the document's systems and player archetype. */
export function defaultHud(doc) {
  const player = doc.content?.archetypes?.find(a => a.id === doc.player?.archetype)?.components || {};
  const meters = [], counters = [];
  const hpMax = player.health?.max;
  if (uses(doc, 'gameplay.combat.health') || player.health) {
    if (typeof hpMax === 'number' && hpMax <= 12) counters.push({ var: 'hp', icon: 'heart', pos: 'top-left' });
    else meters.push({ pool: 'hp', pos: 'top-left' });
  }
  const pools = sysOf(doc, 'gameplay.resource')?.with?.pools?.map(p => p.id) || Object.keys(player.resources || {});
  for (const id of pools) meters.push({ pool: id, pos: 'top-left' });
  for (const c of sysOf(doc, 'gameplay.economy')?.with?.currencies || []) counters.push({ var: c.var || `money.${c.id}`, icon: c.icon || c.id, label: c.name, pos: 'top-right' });
  for (const c of sysOf(doc, 'gameplay.collectible')?.with?.counters || []) if (c.var) counters.push({ var: c.var, icon: c.icon || c.id, label: c.name || c.id, pos: 'top-right' });
  const v = doc.views?.primary;
  return {
    meters, counters,
    ...(uses(doc, 'gameplay.score') ? { score: { var: 'score', label: 'Score', pos: 'top-center' } } : {}),
    ...(uses(doc, 'gameplay.wanted') ? { stars: { var: 'wanted', max: sysOf(doc, 'gameplay.wanted')?.with?.levels ?? 5, icon: 'star', pos: 'top-right' } } : {}),
    prompt: uses(doc, 'gameplay.interact') || uses(doc, 'plot.character'),
    clock: uses(doc, 'engine.time'),
    compass: (v === '3p' || v === '1p') && uses(doc, 'plot.quest'),
    status: uses(doc, 'gameplay.combat.status') || uses(doc, 'gameplay.combat.health'),
    bossBar: uses(doc, 'gameplay.combat.boss'),
    crosshair: v === '1p' ? 'dot' : 'none',
  };
}

/** Graphics instances to add for a document (empty when it already lists UI and audio). */
export function defaultGraphics(doc, registry) {
  const listed = new Set((doc.graphics || []).map(g => g.use));
  const out = [];
  const add = (use, w) => { if (has(registry, use) && !listed.has(use)) out.push({ use, with: w }); };
  const anyUi = [...listed].some(u => u.startsWith('graphics.ui.'));
  if (!anyUi) {
    const textual = isTextual(doc), acts = actionsProvided(doc, registry);
    const zones = (doc.spaces || []).flatMap(s => s.zones || []);
    const players = (doc.content?.archetypes || []).filter(a => a.kind === 'player');
    if (textual) add('graphics.ui.story', { style: 'auto' });
    add('graphics.ui.menu', { select: players.length > 1 && acts.has('select_character') ? [{ id: 'character', kind: 'character', action: 'select_character' }] : [] });
    if (!textual) add('graphics.ui.hud', defaultHud(doc));
    if (!textual && ['plot.dialogue', 'plot.barks', 'plot.storyboard', 'plot.cutscene', 'plot.events.random'].some(id => uses(doc, id))) add('graphics.ui.dialogue', {});
    if (uses(doc, 'plot.quest') || uses(doc, 'plot.journal')) {
      const tags = new Set((doc.plot?.entries || []).map(e => e.tag || 'lore'));
      const tabs = [uses(doc, 'plot.quest') && 'quests', [...tags].some(t => !/note|bestiary/.test(t)) && 'lore', tags.has('bestiary') || (uses(doc, 'gameplay.combat') && (doc.content?.archetypes || []).some(a => a.kind === 'enemy' || a.kind === 'boss')) ? 'bestiary' : null, uses(doc, 'plot.character') && 'characters', [...tags].some(t => /note/.test(t)) && 'notes'].filter(Boolean);
      add('graphics.ui.journal', { tabs: tabs.length ? tabs : ['quests'] });
    }
    if (!textual && zones.length >= 3) add('graphics.ui.map', { fog: uses(doc, 'engine.zones') || zones.length > 6, fastTravel: acts.has('fast_travel') });
    const v = doc.views?.primary;
    if (!textual && zones.length >= 2 && ['3p', '1p', 'td', 'iso'].includes(v)) add('graphics.ui.minimap', { rotate: v === '3p' || v === '1p' });
    if (!textual && uses(doc, 'gameplay.inventory')) {
      const eq = sysOf(doc, 'gameplay.equipment')?.with;
      const panels = ['items',
        eq?.slots?.some(s => !(s.accepts || []).includes('charm')) && 'equipment',
        (eq?.budget || eq?.slots?.some(s => (s.accepts || []).includes('charm'))) && 'loadout',
        uses(doc, 'gameplay.crafting') && 'crafting',
        uses(doc, 'gameplay.container') && 'container',
        uses(doc, 'gameplay.economy') && 'shop',
        (uses(doc, 'gameplay.progression.abilities') || uses(doc, 'gameplay.progression.tree')) && 'skills'].filter(Boolean);
      add('graphics.ui.inventory', { panels });
    }
    if (uses(doc, 'gameplay.creature.battle') || uses(doc, 'gameplay.turns')) add('graphics.ui.battle', {});
    if (uses(doc, 'gameplay.cards')) add('graphics.ui.cards', {});
  }
  if (![...listed].some(u => u.startsWith('graphics.audio.'))) add('graphics.audio.synth', {});
  return out;
}

/** The document's graphics plus the defaults it is missing (what a host should mount). */
export function withDefaultGraphics(doc, registry) { return [...(doc.graphics || []), ...defaultGraphics(doc, registry)]; }
