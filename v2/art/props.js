// Procedural props: pickups, hazards and goals, in the same outlined,
// cel-shaded style as the characters. Units: a 64×64 box.
import { defs as makeDefs, document, f, pt } from './svg.js';
import { hex, light, shade, outlineOf } from './color.js';

export const PROPS = {
  pickup: ['ring', 'coin', 'gem', 'star', 'heart', 'fruit', 'key', 'orb', 'mushroom', 'crystal', 'feather', 'battery', 'flower', 'scroll', 'candy', 'acorn', 'shell', 'note'],
  hazard: ['spikes', 'lava', 'saw', 'fire', 'thorns', 'electric', 'ice-spikes', 'cactus', 'acid', 'mine'],
  goal: ['flag', 'goalpost', 'door', 'portal', 'chest', 'trophy', 'castle', 'beacon', 'exit-sign', 'nest'],
};
const PROP_DEFAULT_COLOR = {
  ring: '#f5c542', coin: '#f5c542', gem: '#3ad0e8', star: '#ffd23f', heart: '#ff4d6d', fruit: '#e8402a', key: '#f5c542', orb: '#7a6cff', mushroom: '#e8402a', crystal: '#c06cff',
  feather: '#ff9a3a', battery: '#5fd36a', flower: '#ff7ab8', scroll: '#f1e2b8', candy: '#ff6fb1', acorn: '#b0763a', shell: '#ffb0a0', note: '#7a6cff',
  spikes: '#b9c3cf', lava: '#ff5a1f', saw: '#c9d0da', fire: '#ff7a1a', thorns: '#4f8a3a', electric: '#ffe23a', 'ice-spikes': '#a8e6ff', cactus: '#4fae4a', acid: '#9cff3a', mine: '#3a3f4b',
  flag: '#e8402a', goalpost: '#3a7bd5', door: '#9a6a3a', portal: '#9b5cff', chest: '#b0763a', trophy: '#f5c542', castle: '#b9c3cf', beacon: '#3ad0e8', 'exit-sign': '#3fbf5a', nest: '#9a6a3a',
};

function kit(color, soft) {
  const d = makeDefs('p'), O = outlineOf(color), W = 2;
  return {
    d, O, W,
    s: (path, c = color, extra = '') => `<path d="${path}" fill="${d.cel(c, { soft })}" stroke="${O}" stroke-width="${W}" stroke-linejoin="round"${extra}/>`,
    flat: (path, c, extra = '') => `<path d="${path}" fill="${c}"${extra}/>`,
    shine: (x, y, r = 3) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * 0.6)}" fill="#ffffff" opacity=".85" transform="rotate(-35 ${f(x)} ${f(y)})"/>`,
    glow: (x, y, r, c) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${d.radial([[0, c, 0.55], [1, c, 0]])}"/>`,
  };
}
const star = (cx, cy, R, r, n = 5, rot = -90) => Array.from({ length: n * 2 }, (_, i) => { const a = (rot + i * 180 / n) * Math.PI / 180, rr = i % 2 ? r : R; return `${i ? 'L' : 'M'}${pt(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)}`; }).join('') + 'Z';

const DRAW = {
  ring: (k, c) => `<circle cx="32" cy="32" r="21" fill="none" stroke="${k.O}" stroke-width="13"/><circle cx="32" cy="32" r="21" fill="none" stroke="${shade(c, 0.2)}" stroke-width="9"/><path d="M14 26A19 19 0 0 1 40 13" fill="none" stroke="${light(c, 0.35)}" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="32" r="21" fill="none" stroke="${c}" stroke-width="5"/>` + k.shine(20, 18, 3),
  coin: (k, c) => k.s('M32 8A20 24 0 1 1 31.9 8Z') + `<ellipse cx="32" cy="32" rx="12" ry="16" fill="none" stroke="${shade(c, 0.3)}" stroke-width="2.5"/><path d="M32 22V42" stroke="${shade(c, 0.3)}" stroke-width="4" stroke-linecap="round"/>` + k.shine(24, 18, 4),
  gem: (k, c) => k.s('M18 22L26 12H38L46 22L32 54Z') + k.flat('M18 22H46L32 54Z', shade(c, 0.18)) + k.flat('M26 12L32 22L38 12Z', light(c, 0.35)) + `<path d="M18 22H46M26 12L32 22L38 12M32 22V54" stroke="${k.O}" stroke-width="1.2" opacity=".5" fill="none"/>` + k.shine(25, 17, 3),
  star: (k, c) => k.s(star(32, 34, 24, 11)) + k.flat(star(32, 34, 14, 6.5), light(c, 0.3)) + `<circle cx="27" cy="31" r="2.2" fill="${k.O}"/><circle cx="37" cy="31" r="2.2" fill="${k.O}"/>`,
  heart: (k, c) => k.s('M32 54C10 38 8 24 16 16C23 10 30 14 32 20C34 14 41 10 48 16C56 24 54 38 32 54Z') + k.shine(21, 21, 4),
  fruit: (k, c) => k.s('M32 18C20 10 8 20 12 36C15 50 26 56 32 52C38 56 49 50 52 36C56 20 44 10 32 18Z') + `<path d="M32 18Q31 10 36 6" stroke="#6b4325" stroke-width="3" fill="none" stroke-linecap="round"/>` + k.s('M34 11Q44 4 50 10Q42 16 34 11Z', '#5fbf4a') + k.shine(21, 26, 4),
  key: (k, c) => k.s('M16 22A10 10 0 1 1 16.1 42A10 10 0 1 1 16 22ZM16 28A4 4 0 1 0 16.1 36A4 4 0 1 0 16 28Z', c, ' fill-rule="evenodd"') + k.s('M25 29H54V35H50V42H45V35H41V40H36V35H25Z'),
  orb: (k, c) => k.glow(32, 32, 30, c) + k.s('M32 10A22 22 0 1 1 31.9 10Z', c) + `<path d="M20 30Q32 18 44 30" fill="none" stroke="${light(c, 0.4)}" stroke-width="2.5" opacity=".7"/>` + k.shine(24, 21, 5),
  mushroom: (k, c) => k.s('M24 36H40V52Q32 56 24 52Z', '#f4e6cf') + k.s('M8 36C8 14 56 14 56 36Z') + `<circle cx="22" cy="27" r="5" fill="#fff"/><circle cx="38" cy="23" r="6" fill="#fff"/><circle cx="48" cy="32" r="3.5" fill="#fff"/>`,
  crystal: (k, c) => k.glow(32, 34, 28, c) + k.s('M32 6L44 24L38 58H26L20 24Z') + k.flat('M32 6L38 24L32 58Z', light(c, 0.25)) + k.s('M14 34L22 28L26 48L18 54Z', shade(c, 0.1)) + k.shine(28, 18, 3),
  feather: (k, c) => k.s('M14 54C16 30 30 12 50 8C50 28 36 46 14 54Z') + `<path d="M14 54Q32 32 46 14" stroke="${k.O}" stroke-width="2" fill="none"/>`,
  battery: (k, c) => k.s('M20 14H44V56H20Z', '#3a3f4b') + k.s('M27 8H37V14H27Z', '#9aa3b0') + k.flat('M24 30H40V52H24Z', c) + `<path d="M34 18L27 32H33L29 44L38 28H32Z" fill="#fff"/>`,
  flower: (k, c) => [0, 72, 144, 216, 288].map(a => k.s(`M32 32m${f(Math.cos(a * Math.PI / 180) * 12)} ${f(Math.sin(a * Math.PI / 180) * 12)}a9 9 0 1 0 0.1 0Z`)).join('') + k.s('M32 25A7 7 0 1 1 31.9 25Z', '#ffd23f'),
  scroll: (k, c) => k.s('M14 16H48V50H14Z') + k.s('M10 12H20V22H10Z', shade(c, 0.15)) + k.s('M44 44H54V54H44Z', shade(c, 0.15)) + `<path d="M20 26H42M20 32H42M20 38H36" stroke="${shade(c, 0.5)}" stroke-width="2"/>`,
  candy: (k, c) => k.s('M8 24L18 32L8 40Z', light(c, 0.1)) + k.s('M56 24L46 32L56 40Z', light(c, 0.1)) + k.s('M32 18A14 14 0 1 1 31.9 18Z') + `<path d="M24 22Q32 32 26 44M34 19Q40 32 34 45" stroke="#fff" stroke-width="3" fill="none"/>`,
  acorn: (k, c) => k.s('M18 28H46Q46 52 32 56Q18 52 18 28Z') + k.s('M14 28Q14 14 32 14Q50 14 50 28Z', '#6b4325') + `<path d="M32 14V8" stroke="#6b4325" stroke-width="3" stroke-linecap="round"/>` + k.shine(24, 36, 3),
  shell: (k, c) => k.s('M32 10L54 46Q32 56 10 46Z') + `<path d="M32 12L20 50M32 12L32 54M32 12L44 50" stroke="${shade(c, 0.35)}" stroke-width="2"/>`,
  note: (k, c) => k.s('M24 14L50 8V40A7 6 0 1 1 46 35V18L28 22V46A7 6 0 1 1 24 41Z'),
  // Hazards: drawn to fill the tile and sit on the ground line.
  spikes: (k, c) => k.s('M2 62V54H62V62Z', shade(c, 0.35)) + [6, 22, 38, 54].map(x => k.s(`M${x - 8} 55L${x} 22L${x + 8} 55Z`) + k.flat(`M${x - 1} 30L${x} 24L${x + 3} 50Z`, light(c, 0.4))).join(''),
  'ice-spikes': (k, c) => [8, 24, 40, 56].map((x, i) => k.s(`M${x - 8} 62L${x + (i % 2 ? 2 : -2)} ${18 + (i % 2) * 8}L${x + 8} 62Z`) + k.flat(`M${x - 2} 56L${x} ${26 + (i % 2) * 8}L${x + 2} 56Z`, '#ffffff', ' opacity=".7"')).join(''),
  lava: (k, c) => `<rect x="0" y="22" width="64" height="42" fill="${k.d.linear([[0, '#ffd23f'], [0.25, c], [1, shade(c, 0.5)]])}"/>` + k.s('M0 26Q8 16 16 26T32 26T48 26T64 26V30H0Z', '#ffb02a') + `<circle cx="18" cy="40" r="3" fill="#ffd23f"/><circle cx="44" cy="48" r="2.5" fill="#ffd23f"/><circle cx="34" cy="16" r="2" fill="#ffb02a"/>`,
  acid: (k, c) => `<rect x="0" y="24" width="64" height="40" fill="${k.d.linear([[0, light(c, 0.3)], [1, shade(c, 0.5)]])}"/>` + k.s('M0 28Q8 18 16 28T32 28T48 28T64 28V32H0Z', light(c, 0.2)) + `<circle cx="20" cy="42" r="3.5" fill="none" stroke="${light(c, 0.5)}" stroke-width="1.5"/><circle cx="44" cy="50" r="2.5" fill="none" stroke="${light(c, 0.5)}" stroke-width="1.5"/>`,
  saw: (k, c) => k.s(star(32, 34, 28, 21, 12, 0), c) + k.s('M32 22A12 12 0 1 1 31.9 22Z', shade(c, 0.2)) + `<circle cx="32" cy="34" r="4" fill="${k.O}"/>`,
  fire: (k, c) => k.glow(32, 40, 30, c) + k.s('M32 62C14 62 10 46 18 34C20 42 24 44 26 40C24 28 30 16 38 8C38 20 50 26 50 42C50 54 44 62 32 62Z') + k.flat('M32 60C24 60 22 52 26 44C28 50 32 50 33 46C33 38 36 32 40 28C40 38 46 42 44 50C43 56 38 60 32 60Z', '#ffd23f'),
  thorns: (k, c) => k.s('M0 62Q12 40 22 52Q30 34 42 50Q52 38 64 62Z') + [10, 24, 36, 50].map(x => k.s(`M${x} 48L${x - 4} 38L${x + 3} 45Z`, '#d6c08a')).join(''),
  electric: (k, c) => k.s('M4 50H60V62H4Z', '#3a3f4b') + k.glow(32, 30, 30, c) + `<path d="M8 50L18 30L24 40L34 16L40 34L48 24L56 50" fill="none" stroke="${k.O}" stroke-width="7" stroke-linejoin="round"/><path d="M8 50L18 30L24 40L34 16L40 34L48 24L56 50" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`,
  cactus: (k, c) => k.s('M26 62V18Q26 8 32 8Q38 8 38 18V62Z') + k.s('M26 40H16Q12 40 12 34V24Q12 20 16 20Q20 20 20 24V32H26Z') + k.s('M38 34H46V22Q46 18 50 18Q54 18 54 22V36Q54 42 48 42H38Z') + `<path d="M32 14V58M18 26V34M50 24V36" stroke="${shade(c, 0.3)}" stroke-width="1.5"/>`,
  mine: (k, c) => [0, 45, 90, 135].map(a => `<path d="M32 36l${f(Math.cos(a * Math.PI / 180) * 24)} ${f(Math.sin(a * Math.PI / 180) * 24)}M32 36l${f(-Math.cos(a * Math.PI / 180) * 24)} ${f(-Math.sin(a * Math.PI / 180) * 24)}" stroke="${k.O}" stroke-width="5" stroke-linecap="round"/>`).join('') + k.s('M32 18A18 18 0 1 1 31.9 18Z') + `<circle cx="32" cy="36" r="5" fill="#ff3b3b"/>` + k.shine(25, 28, 4),
  // Goals.
  flag: (k, c) => k.s('M14 6H20V62H14Z', '#c9d0da') + k.s('M20 8Q34 4 40 12Q48 18 58 12V36Q48 42 40 36Q32 30 20 34Z') + `<circle cx="17" cy="6" r="4" fill="#f5c542" stroke="${k.O}" stroke-width="2"/>`,
  goalpost: (k, c) => k.s('M29 30H35V62H29Z', '#9aa3b0') + k.s('M32 4A18 18 0 1 1 31.9 4Z', '#f5c542') + k.s('M32 10A12 12 0 1 1 31.9 10Z') + k.flat(star(32, 22, 8, 3.5), '#fff') + k.s('M20 58H44V62H20Z', '#5c6370'),
  door: (k, c) => k.s('M12 62V20Q12 4 32 4Q52 4 52 20V62Z', '#5c6370') + k.s('M17 62V22Q17 10 32 10Q47 10 47 22V62Z') + `<path d="M32 10V62M17 30H47M17 46H47" stroke="${shade(c, 0.35)}" stroke-width="2"/><circle cx="40" cy="38" r="3" fill="#f5c542" stroke="${k.O}" stroke-width="1.5"/>`,
  portal: (k, c) => k.glow(32, 32, 32, c) + `<ellipse cx="32" cy="32" rx="20" ry="27" fill="${k.d.radial([[0, '#ffffff'], [0.35, light(c, 0.4)], [1, shade(c, 0.4)]])}" stroke="${k.O}" stroke-width="2"/><path d="M32 12Q46 22 34 32T32 52" fill="none" stroke="#fff" stroke-width="2.5" opacity=".7"/><ellipse cx="32" cy="32" rx="24" ry="31" fill="none" stroke="${light(c, 0.2)}" stroke-width="3" stroke-dasharray="6 6"/>`,
  chest: (k, c) => k.s('M8 30H56V58H8Z') + k.s('M8 30Q8 12 32 12Q56 12 56 30Z', light(c, 0.1)) + k.s('M8 28H56V34H8Z', '#f5c542') + k.s('M27 30H37V42H27Z', '#f5c542') + `<circle cx="32" cy="36" r="2" fill="${k.O}"/>`,
  trophy: (k, c) => k.s('M18 6H46V20Q46 36 32 38Q18 36 18 20Z') + `<path d="M18 12H10Q8 24 18 26M46 12H54Q56 24 46 26" fill="none" stroke="${k.O}" stroke-width="5"/><path d="M18 12H10Q8 24 18 26M46 12H54Q56 24 46 26" fill="none" stroke="${c}" stroke-width="2.5"/>` + k.s('M28 38H36V48H28Z') + k.s('M18 48H46V58H18Z', '#6b4325') + k.shine(25, 13, 3.5),
  castle: (k, c) => k.s('M8 62V24H16V30H22V24H30V30H34V24H42V30H48V24H56V62Z') + k.s('M24 62V46Q32 38 40 46V62Z', '#3a2a20') + k.s('M28 6H36V24H28Z', shade(c, 0.1)) + k.s('M36 6L48 10L36 14Z', '#e8402a'),
  beacon: (k, c) => k.glow(32, 22, 30, c) + k.s('M24 62L28 26H36L40 62Z', '#9aa3b0') + k.s('M32 6A14 14 0 1 1 31.9 6Z') + k.shine(27, 13, 3.5),
  'exit-sign': (k, c) => k.s('M28 40H36V62H28Z', '#6b4325') + k.s('M6 14H50L60 27L50 40H6Z') + `<path d="M16 27H44M36 19L44 27L36 35" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  nest: (k, c) => k.s('M6 40Q32 66 58 40Q50 50 32 50Q14 50 6 40Z') + k.s('M24 26A9 12 0 1 1 23.9 26Z', '#fff4e0') + k.s('M38 28A8 11 0 1 1 37.9 28Z', '#e8f4ff'),
};

/** Paint a prop. kind is one of PROPS[role]; color overrides the default. */
export function paintProp(kind, { color, pixel = false, size } = {}) {
  const draw = DRAW[kind] || DRAW.gem;
  const c = hex(color, PROP_DEFAULT_COLOR[kind] || '#f5c542');
  const k = kit(c, false);
  const body = draw(k, c);
  const px = size || (pixel ? 32 : 128);
  return document({ width: px, height: px, viewBox: '0 0 64 64', defs: k.d.toString(), body, crisp: pixel });
}
