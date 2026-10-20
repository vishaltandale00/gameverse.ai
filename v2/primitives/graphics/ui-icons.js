// Procedural icon set for HUD counters, item slots, status effects and map
// markers: outlined, two-tone glyphs in a 24×24 box, coloured per use. No
// assets. Unknown names get a lettered medallion, so every icon id renders.
import { hex, light, shade, outlineOf } from '../../art/color.js';
import { h, hueColor } from './ui-lib.js';

// Each icon: default colour plus layers [d, tone] where tone is base|dark|lite|ink|white.
const P = {
  heart: ['#ff4d6d', [['M12 21s-7.5-4.6-9.4-9.6C1.3 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.5 0 5.5 3.5 4.2 6.9C19.5 16.4 12 21 12 21z', 'base'], ['M6.6 7.2c-1.4.2-2.2 1.6-1.9 3', 'lite-stroke']]],
  mask: ['#e8e4d8', [['M12 3c4.8 0 8 3 8 7.6 0 5-3.6 10.4-8 10.4S4 15.6 4 10.6C4 6 7.2 3 12 3z', 'base'], ['M8.2 9.8c.9-.9 2.4-.9 3 .3-.9 1.3-2.4 1.4-3-.3zM15.8 9.8c-.9-.9-2.4-.9-3 .3.9 1.3 2.4 1.4 3-.3z', 'ink'], ['M10 15.5c1.3.8 2.7.8 4 0', 'ink-stroke']]],
  coin: ['#f5c542', [['M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4z', 'base'], ['M12 5.6a6.4 6.4 0 1 1 0 12.8 6.4 6.4 0 0 1 0-12.8z', 'dark-stroke'], ['M12 8v8M10 10.2h3.4a1.4 1.4 0 0 1 0 2.8h-2.8a1.4 1.4 0 0 0 0 2.8H14', 'dark-stroke']]],
  gem: ['#3ad0e8', [['M7 4h10l4 5-9 11L3 9z', 'base'], ['M3 9h18M9 4l3 5 3-5M12 9v11', 'dark-stroke'], ['M7 4l-4 5h6z', 'lite']]],
  star: ['#ffd23f', [['M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5L2.6 9.4l6.5-.8z', 'base'], ['M12 5.8l1.7 3.6', 'lite-stroke']]],
  key: ['#f5c542', [['M8 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z', 'base'], ['M11.5 11.5L20 20M16 16l2-2M18 18l2-2', 'base-stroke-thick'], ['M8 7.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z', 'dark']]],
  sword: ['#c8d0dc', [['M19.5 3l1.5 1.5-10 10-2-2z', 'base'], ['M5 14l5 5-1.5 1.5-1.4-1.4L5 21l-2-2 1.9-2.1-1.4-1.4z', 'dark'], ['M19.5 3L10 12.5', 'lite-stroke']]],
  shield: ['#5a8ad8', [['M12 2.8l8 3v6c0 5-3.4 8.4-8 9.6-4.6-1.2-8-4.6-8-9.6v-6z', 'base'], ['M12 2.8v18.6', 'dark-stroke'], ['M12 5.6l5.4 2v4.2', 'lite-stroke']]],
  bow: ['#a0683a', [['M6 3c8 3 11 9 11 18', 'base-stroke-thick'], ['M6 3v18M4 12h14l-3-2.5M18 12l-3 2.5', 'ink-stroke']]],
  potion: ['#e84a8a', [['M9.5 2.8h5v2h-.8v3.4l4.6 6.6a5.4 5.4 0 0 1-4.6 8.4h-3.4a5.4 5.4 0 0 1-4.6-8.4l4.6-6.6V4.8h-.8z', 'white-glass'], ['M6.4 14.4h11.2l.4.8a4.6 4.6 0 0 1-4.1 6.8h-3.8A4.6 4.6 0 0 1 6 15.2z', 'base'], ['M9 16.5a1 1 0 1 1 0 .1', 'lite']]],
  food: ['#d88a3a', [['M3.5 13.5h17a8.5 6.5 0 0 1-17 0z', 'base'], ['M5 12.5c.5-4 3.5-7 7-7s6.5 3 7 7', 'lite'], ['M8 9.5h.1M12 8h.1M15.5 9.5h.1', 'ink-stroke']]],
  bag: ['#a0683a', [['M5 9h14l-1.2 11.2H6.2z', 'base'], ['M8.5 9V7a3.5 3.5 0 0 1 7 0v2', 'dark-stroke'], ['M5 9h14v2.4H5z', 'dark']]],
  scroll: ['#efe0b8', [['M6 4h11a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2z', 'base'], ['M4 18a2 2 0 0 0 4 0V6a2 2 0 0 0-4 0z', 'dark'], ['M10 8h6M10 11h6M10 14h4', 'ink-stroke']]],
  book: ['#8a3a3a', [['M5 3.5h11.5a2 2 0 0 1 2 2V20.5H7a2 2 0 0 1-2-2z', 'base'], ['M5 18.5a2 2 0 0 1 2-2h11.5', 'lite-stroke'], ['M9 7.5h6', 'lite-stroke']]],
  map: ['#d8c088', [['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'base'], ['M9 4v14M15 6v14', 'dark-stroke'], ['M5.5 11l2 1 2.5-2 3 2', 'ink-stroke']]],
  quest: ['#f2b84b', [['M12 2.6a9.4 9.4 0 1 1 0 18.8 9.4 9.4 0 0 1 0-18.8z', 'base'], ['M12 6.8v7M12 16.8v.4', 'ink-stroke-thick']]],
  skull: ['#e8e4d8', [['M12 3a8 8 0 0 1 8 8c0 2.6-1.3 4.4-3 5.4V20h-2v-1.6h-2V20h-2v-1.6H9V20H7v-3.6C5.3 15.4 4 13.6 4 11a8 8 0 0 1 8-8z', 'base'], ['M8.6 10.4a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM15.4 10.4a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z', 'ink']]],
  flame: ['#ff8a2a', [['M12 2.5c1 4 6 5.5 6 11a6 6 0 0 1-12 0c0-3 1.6-4.6 3-6 0 2 .8 3 2 3.2-.8-3 0-5.8 1-8.2z', 'base'], ['M12 12c1.6 1.4 3 2.4 3 4.5a3 3 0 0 1-6 0c0-1.6 1.4-2.8 3-4.5z', 'lite-solid']]],
  bolt: ['#ffd23f', [['M13.5 2L4.5 13.5H11L9.5 22l9.5-12h-6.6z', 'base'], ['M12.6 3.8L7 11', 'lite-stroke']]],
  snow: ['#9ad8ff', [['M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2', 'base-stroke-thick']]],
  poison: ['#7ad04a', [['M12 2.8c3.2 4.6 6 7.8 6 11.2a6 6 0 0 1-12 0c0-3.4 2.8-6.6 6-11.2z', 'base'], ['M9.5 13.5a1 1 0 1 1 0 .1M14 16a1.4 1.4 0 1 1 0 .1', 'dark']]],
  drop: ['#4aa8ff', [['M12 2.8c3.2 4.6 6 7.8 6 11.2a6 6 0 0 1-12 0c0-3.4 2.8-6.6 6-11.2z', 'base'], ['M9 14.5a3 3 0 0 0 2.5 3', 'lite-stroke']]],
  clock: ['#e8e4d8', [['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'base'], ['M12 7v5l3.5 2', 'ink-stroke']]],
  sun: ['#ffcf4a', [['M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z', 'base'], ['M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8', 'base-stroke']]],
  moon: ['#dfe6ff', [['M15.5 3.2A9 9 0 1 0 20.8 15 7.2 7.2 0 0 1 15.5 3.2z', 'base'], ['M10 9.5a1 1 0 1 1 0 .1M8 15a1.3 1.3 0 1 1 0 .1', 'dark']]],
  gear: ['#b8c0cc', [['M10.4 2.5h3.2l.5 2.4 1.9.8 2-1.4 2.3 2.3-1.4 2 .8 1.9 2.4.5v3.2l-2.4.5-.8 1.9 1.4 2-2.3 2.3-2-1.4-1.9.8-.5 2.4h-3.2l-.5-2.4-1.9-.8-2 1.4-2.3-2.3 1.4-2-.8-1.9-2.4-.5v-3.2l2.4-.5.8-1.9-1.4-2 2.3-2.3 2 1.4 1.9-.8z', 'base'], ['M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z', 'dark']]],
  lock: ['#c8a040', [['M5 10.5h14v10H5z', 'base'], ['M8 10.5V7.5a4 4 0 0 1 8 0v3', 'dark-stroke-thick'], ['M12 14v3', 'ink-stroke']]],
  cube: ['#8a8a8a', [['M12 2.8l8.4 4.6v9.2L12 21.2l-8.4-4.6V7.4z', 'base'], ['M12 12l8.4-4.6V16.6L12 21.2z', 'dark'], ['M3.6 7.4L12 2.8l8.4 4.6L12 12z', 'lite-solid']]],
  ring: ['#f5c542', [['M12 8.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'base-stroke-thick'], ['M9 3h6l1.6 2.6L12 9 7.4 5.6z', 'gem']]],
  charm: ['#c06cff', [['M12 2.5l3 4.5-3 14.5L9 7z', 'base'], ['M12 2.5l3 4.5-3 1.5-3-1.5z', 'lite-solid']]],
  hammer: ['#b8c0cc', [['M4 5.5h10v5H4z', 'base'], ['M10.5 10.5l9.5 9.5-1.8 1.8-9.5-9.5', 'wood']]],
  pick: ['#b8c0cc', [['M3.5 8C7 3.5 15 3 20.5 7.5 15 6.2 9.5 6.6 3.5 8z', 'base'], ['M12 6l-1 1L19 21l1.8-1.2z', 'wood']]],
  axe: ['#b8c0cc', [['M10 3.5c3.8-.6 7.4 1.4 8.6 5L12.5 11 9.5 8z', 'base'], ['M11 7l-7.5 13 1.8 1 7.4-12.6z', 'wood']]],
  gun: ['#606878', [['M3 7h16v4H9l-.8 7H4.6l.6-7H3z', 'base'], ['M19 8h2v2h-2z', 'dark']]],
  leaf: ['#5ac05a', [['M20 3.5C11 3.5 4 8 4 15c0 2 .6 3.6 1.4 5C9 13 13 10 17 8c-4 3-7.6 7-9.6 12.4 1.2.4 2.4.6 3.6.6 6.4 0 9-6.4 9-17.5z', 'base']]],
  feather: ['#e8e4d8', [['M19.5 3.5c-6 0-12 5-12 12v4l3-3h4c4.2-2.8 5-8 5-13z', 'base'], ['M4.5 20.5l11-11', 'dark-stroke']]],
  bell: ['#f5c542', [['M12 3a6 6 0 0 1 6 6v5l2 3H4l2-3V9a6 6 0 0 1 6-6z', 'base'], ['M10 19.5a2 2 0 0 0 4 0', 'dark-stroke']]],
  lantern: ['#ffb347', [['M8 7h8l1 10.5H7z', 'base'], ['M7 5.5h10v2H7zM7 17h10v2.5H7zM10 2.5h4v3h-4z', 'dark'], ['M12 10c1.2 1.2 1.8 2.2 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-1.2.6-2.2 1.8-3.4z', 'white']]],
  person: ['#e8e4d8', [['M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'base'], ['M4.5 21c.6-4.6 3.6-7.5 7.5-7.5s6.9 2.9 7.5 7.5z', 'base']]],
  eye: ['#e8e4d8', [['M2.5 12c2.4-4.2 5.6-6.5 9.5-6.5s7.1 2.3 9.5 6.5c-2.4 4.2-5.6 6.5-9.5 6.5S4.9 16.2 2.5 12z', 'base'], ['M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z', 'ink']]],
  arrow: ['#f2b84b', [['M12 3l7 9h-4.5v9h-5v-9H5z', 'base']]],
  check: ['#6fd08c', [['M4 12.5l5 5L20 6.5', 'base-stroke-thick']]],
  wrench: ['#b8c0cc', [['M20 6.5a4.5 4.5 0 0 1-6.2 4.2L6 18.5 4 16.5l7.8-7.8A4.5 4.5 0 0 1 17.5 4l-3 3 2.5 2.5z', 'base']]],
  car: ['#e04a3a', [['M4 12l2-5h12l2 5v5H4z', 'base'], ['M7 8.5h10l1.2 3H5.8z', 'lite-solid'], ['M7.5 15.5a1.6 1.6 0 1 1 0 .1M16.5 15.5a1.6 1.6 0 1 1 0 .1', 'ink'], ['M4 17h3v2.5H4zM17 17h3v2.5h-3z', 'ink']]],
  shop: ['#6ac860', [['M3.5 9l1.5-5h14l1.5 5z', 'base'], ['M5 9h14v11H5z', 'white'], ['M10 13.5h4v6.5h-4z', 'dark']]],
  home: ['#d8a060', [['M3 11.5L12 4l9 7.5V20H3z', 'base'], ['M9.5 14h5v6h-5z', 'dark']]],
  flag: ['#ff4d6d', [['M5 3v18', 'ink-stroke-thick'], ['M6 4h12l-3 4.5 3 4.5H6z', 'base']]],
  hourglass: ['#d8c088', [['M6 3h12v2c0 3-3 5-4.5 7 1.5 2 4.5 4 4.5 7v2H6v-2c0-3 3-5 4.5-7C9 10 6 8 6 5z', 'base'], ['M9 19.5h6c0-1.4-1.4-2.6-3-3.8-1.6 1.2-3 2.4-3 3.8z', 'dark']]],
  crown: ['#f5c542', [['M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z', 'base'], ['M5 16.5h14', 'dark-stroke'], ['M12 5v.1M3 8v.1M21 8v.1', 'gem']]],
};
const ALIAS = {
  buck: 'coin', bucks: 'coin', money: 'coin', gold: 'coin', crowns: 'crown', ash: 'flame', soul: 'flame', flame_pool: 'flame', hp: 'heart', life: 'heart', lives: 'heart', health: 'heart',
  stamina: 'bolt', energy: 'bolt', mana: 'drop', focus: 'eye', hunger: 'food', water: 'drop', oxygen: 'drop', fuel: 'drop', burning: 'flame', burn: 'flame', fire: 'flame',
  frozen: 'snow', ice: 'snow', chill: 'snow', slow: 'hourglass', stun: 'star', stunned: 'star', poisoned: 'poison', bleed: 'drop', shock: 'bolt', regen: 'heart', armor: 'shield',
  weapon: 'sword', tool: 'pick', material: 'cube', block: 'cube', potion: 'potion', key: 'key', quest: 'scroll', currency: 'coin', ammo: 'arrow', prop: 'cube', misc: 'bag', charm: 'charm',
  food: 'food', gem: 'gem', shrine: 'star', enemy: 'skull', police: 'shield', garage: 'car', npc: 'person', player: 'arrow', bench: 'home', checkpoint: 'flag', boss: 'skull',
  wanted: 'star', time: 'clock', day: 'sun', night: 'moon', score: 'star', settings: 'gear', save: 'book', journal: 'book', inventory: 'bag', map: 'map',
};
/** Icon for an item: explicit icon, tool/weapon kind, item kind, else a lettered medallion. */
export function itemIcon(item, blockColor) {
  if (!item) return { name: 'bag' };
  if (item.icon) return { name: item.icon, color: item.color };
  if (item.kind === 'block' || item.block) return { name: 'cube', color: blockColor || item.color || hueColor(item.id, 20, 52) };
  if (item.tool?.kind) return { name: { pickaxe: 'pick', pick: 'pick', axe: 'axe', hammer: 'hammer', wrench: 'wrench' }[item.tool.kind] || 'pick', color: item.color };
  if (item.ranged) return { name: /gun|pistol|rifle/.test(item.id) ? 'gun' : 'bow', color: item.color };
  if (item.weapon) return { name: /bow/.test(item.id) ? 'bow' : /hammer|maul/.test(item.id) ? 'hammer' : /axe/.test(item.id) ? 'axe' : /gun|pistol|rifle/.test(item.id) ? 'gun' : 'sword', color: item.color };
  if (item.armor) return { name: 'shield', color: item.color };
  if (item.charm) return { name: 'charm', color: item.color || hueColor(item.id, 60, 62) };
  const byName = Object.keys(P).find(k => new RegExp(`\\b${k}`).test(`${item.id} ${item.name || ''}`.toLowerCase()));
  return { name: ALIAS[item.kind] || byName || item.kind || item.id, color: item.color };
}
export const iconNames = () => Object.keys(P);
export const resolveIcon = name => (P[name] ? name : P[ALIAS[name]] ? ALIAS[name] : null);

/** <span class="gv-icon"><svg/></span> for an icon name (unknown names get a lettered medallion). */
export function icon(name, { color, doc, title, label } = {}) {
  const id = resolveIcon(String(name || '').toLowerCase());
  const base = hex(color, id ? P[id][0] : null) || (id ? P[id][0] : hslHex(name));
  const tones = { base, dark: shade(base, 0.3), lite: light(base, 0.45), ink: outlineOf(base), white: '#fbf8f0', wood: '#8a5a32', gem: '#3ad0e8' };
  const svg = h('svg', { doc, attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none' } });
  const layers = id ? P[id][1] : [['M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4z', 'base']];
  for (const [d, tone] of layers) {
    const [t, mode, thick] = tone.split('-');
    const colorOf = tones[t] || base;
    const attrs = mode === 'stroke' ? { d, stroke: colorOf, 'stroke-width': thick ? 2.6 : 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
      : mode === 'glass' ? { d, fill: 'rgba(255,255,255,.35)', stroke: tones.ink, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }
      : mode === 'solid' ? { d, fill: colorOf }
      : { d, fill: colorOf, stroke: tones.ink, 'stroke-width': 1.4, 'stroke-linejoin': 'round' };
    svg.append(h('path', { doc, svg: true, attrs }));
  }
  if (!id) svg.append(h('text', { doc, svg: true, attrs: { x: 12, y: 16.2, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: outlineOf(base), 'font-family': 'system-ui,sans-serif' }, text: String(label || name || '?').replace(/^[^a-z0-9]*/i, '').slice(0, 1).toUpperCase() || '?' }));
  const span = h('span.gv-icon', { doc, data: { icon: id || String(name) } }, svg);
  if (title) span.setAttribute('title', title);
  return span;
}
const hslHex = s => hueColor(s, 55, 60);
