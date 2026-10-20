// Procedural tilesets. Every material is a periodic pattern in a T×T cell, so
// it tiles with no seams by construction. Cells in the atlas are padded, and
// the padding holds the pattern's own continuation (the cell is drawn 3×3 and
// clipped), so filtered sampling at cell edges never bleeds a neighbour's
// colors into a visible line. The record's `inset` excludes the padding.
import { defs as makeDefs, document, f, rng } from './svg.js';
import { hex, light, shade, mix, outlineOf } from './color.js';

export const MATERIALS = ['dirt', 'checker', 'stone', 'brick', 'sand', 'snow', 'ice', 'metal', 'wood', 'lava-rock', 'crystal', 'candy', 'jungle', 'tech'];
export const SURFACES = ['grass', 'snow', 'sand', 'moss', 'metal', 'stone', 'frosting', 'flowers', 'none'];
export const PLATFORMS = ['brick', 'wood', 'stone', 'metal', 'ice', 'crate', 'cloud', 'grass', 'crystal', 'tech'];
export const TILE_LAYOUT = { cols: 2, rows: 2, cells: { groundTop: [0, 0], groundFill: [1, 0], platform: [0, 1], wall: [1, 1] } };

const T = 32, PAD = 2, CELL = T + PAD * 2;

const rect = (x, y, w, h, fill, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${extra}/>`;

// ---------- fill materials: periodic in both directions ----------
const FILL = {
  dirt(c, r) {
    let s = rect(0, 0, T, T, c);
    for (let i = 0; i < 9; i++) { const x = r() * T, y = r() * T, w = 2 + r() * 3; s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(w)}" ry="${f(w * 0.7)}" fill="${shade(c, 0.22)}"/><ellipse cx="${f(x - 0.5)}" cy="${f(y - 0.6)}" rx="${f(w * 0.55)}" ry="${f(w * 0.35)}" fill="${light(c, 0.12)}"/>`; }
    for (let i = 0; i < 14; i++) s += rect(Math.floor(r() * T), Math.floor(r() * T), 1, 1, shade(c, 0.35));
    return s;
  },
  checker(c) { // Two-tone checks with a darker seam line, the classic loop-land soil.
    const a = c, b = shade(c, 0.22), line = shade(c, 0.45);
    return rect(0, 0, 16, 16, a) + rect(16, 0, 16, 16, b) + rect(0, 16, 16, 16, b) + rect(16, 16, 16, 16, a)
      + rect(0, 15, T, 1, line, ' opacity=".5"') + rect(15, 0, 1, T, line, ' opacity=".5"') + rect(0, 31, T, 1, line, ' opacity=".5"') + rect(31, 0, 1, T, line, ' opacity=".5"')
      + rect(1, 1, 14, 2, light(a, 0.12), ' opacity=".6"') + rect(17, 17, 14, 2, light(a, 0.12), ' opacity=".6"');
  },
  stone(c) {
    const m = shade(c, 0.35);
    const stones = [[0, 0, 13, 10], [13, 0, 19, 12], [0, 10, 9, 12], [9, 12, 14, 10], [23, 12, 9, 11], [0, 22, 16, 10], [16, 22, 16, 10]];
    return rect(0, 0, T, T, m) + stones.map(([x, y, w, h]) => `<rect x="${x + 0.7}" y="${y + 0.7}" width="${w - 1.4}" height="${h - 1.4}" rx="2.5" fill="${c}"/><rect x="${x + 1.5}" y="${y + 1.2}" width="${w - 3.5}" height="2" rx="1" fill="${light(c, 0.18)}"/><rect x="${x + 1.5}" y="${y + h - 2.6}" width="${w - 3}" height="1.6" rx=".8" fill="${shade(c, 0.15)}"/>`).join('');
  },
  brick(c) {
    const m = mix(c, '#d8cfc0', 0.55); let s = rect(0, 0, T, T, m);
    for (let row = 0; row < 4; row++) for (let i = -1; i < 3; i++) {
      const x = i * 16 + (row % 2) * 8, y = row * 8;
      s += rect(x + 0.6, y + 0.6, 14.8, 6.8, c) + rect(x + 1.2, y + 1, 13.2, 1.4, light(c, 0.15)) + rect(x + 1.2, y + 6, 13.6, 1.2, shade(c, 0.18));
    }
    return s;
  },
  sand(c, r) {
    let s = rect(0, 0, T, T, c);
    for (let y = 4; y < T; y += 8) s += `<path d="M0 ${y}Q8 ${y - 2} 16 ${y}T32 ${y}" fill="none" stroke="${shade(c, 0.12)}" stroke-width="1.2"/>`;
    for (let i = 0; i < 18; i++) s += rect(Math.floor(r() * T), Math.floor(r() * T), 1, 1, i % 2 ? light(c, 0.2) : shade(c, 0.2));
    return s;
  },
  snow(c, r) {
    let s = rect(0, 0, T, T, c);
    for (let i = 0; i < 6; i++) s += `<ellipse cx="${f(r() * T)}" cy="${f(r() * T)}" rx="${f(3 + r() * 3)}" ry="${f(1.5 + r())}" fill="${shade(c, 0.1)}" opacity=".7"/>`;
    for (let i = 0; i < 8; i++) s += rect(Math.floor(r() * T), Math.floor(r() * T), 1, 1, '#ffffff');
    return s;
  },
  ice(c) {
    return rect(0, 0, T, T, c) + `<path d="M-4 20L20 -4M8 36L36 8M20 36L36 20" stroke="${light(c, 0.35)}" stroke-width="2.5" opacity=".7"/><path d="M4 30L14 18L22 22L30 10" stroke="${shade(c, 0.2)}" stroke-width="1" fill="none" opacity=".6"/>`;
  },
  metal(c) {
    return rect(0, 0, T, T, c) + rect(0, 0, T, 1, light(c, 0.25)) + rect(0, 15, T, 1, shade(c, 0.35)) + rect(0, 16, T, 1, light(c, 0.2)) + rect(0, 31, T, 1, shade(c, 0.35))
      + [[4, 4], [28, 4], [4, 20], [28, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${shade(c, 0.3)}"/><circle cx="${x - 0.4}" cy="${y - 0.4}" r=".8" fill="${light(c, 0.35)}"/>`).join('');
  },
  wood(c) {
    let s = '';
    for (let i = 0; i < 4; i++) { const y = i * 8, k = i % 2 ? shade(c, 0.08) : c; s += rect(0, y, T, 8, k) + rect(0, y, T, 1, light(c, 0.15)) + rect(0, y + 7, T, 1, shade(c, 0.35)) + `<path d="M${4 + i * 7} ${y + 3}h8M${18 + i * 3} ${y + 5}h6" stroke="${shade(c, 0.18)}" stroke-width="1"/>`; }
    return s;
  },
  'lava-rock'(c) {
    return rect(0, 0, T, T, c) + `<path d="M0 10L7 13L12 8L20 12L26 7L32 10M0 25L6 22L14 27L22 22L28 26L32 25M12 8L14 18L22 22M26 7L27 16" fill="none" stroke="#ff6a1f" stroke-width="1.6"/><path d="M0 10L7 13L12 8L20 12L26 7L32 10M0 25L6 22L14 27L22 22L28 26L32 25" fill="none" stroke="#ffd23f" stroke-width=".6"/>`;
  },
  crystal(c) {
    return rect(0, 0, T, T, shade(c, 0.25)) + `<path d="M0 0L10 6L6 18L0 14ZM10 6L22 2L26 14L16 18L6 18ZM22 2L32 0L32 14L26 14ZM0 14L6 18L4 32L0 32ZM6 18L16 18L20 32L4 32ZM16 18L26 14L32 14L32 32L20 32Z" fill="${c}" stroke="${shade(c, 0.45)}" stroke-width=".8"/><path d="M10 6L22 2L16 9Z" fill="${light(c, 0.35)}"/><path d="M26 14L32 14L30 22Z" fill="${light(c, 0.25)}"/>`;
  },
  candy(c) {
    return rect(0, 0, T, T, c) + `<path d="M-8 8L8 -8M-8 24L24 -8M-8 40L40 -8M8 40L40 8M24 40L40 24" stroke="${light(c, 0.35)}" stroke-width="4"/>` + [[6, 10, '#ffffff'], [20, 6, '#7ad7ff'], [26, 22, '#ffe36a'], [10, 26, '#9cff8a']].map(([x, y, k]) => rect(x, y, 3, 1.4, k, ` rx=".7" transform="rotate(35 ${x} ${y})"`)).join('');
  },
  jungle(c, r) {
    let s = rect(0, 0, T, T, c);
    for (let i = 0; i < 5; i++) { const x = r() * T, y = r() * T; s += `<path d="M${f(x)} ${f(y)}q4 -6 8 0q-4 3 -8 0z" fill="${shade(c, 0.25)}"/>`; }
    s += `<path d="M0 6Q8 10 16 6T32 6M0 22Q8 26 16 22T32 22" fill="none" stroke="${shade(c, 0.3)}" stroke-width="1.5"/>`;
    return s;
  },
  tech(c) {
    return rect(0, 0, T, T, c) + rect(1, 1, 14, 14, shade(c, 0.12), ' rx="1.5"') + rect(17, 17, 14, 14, shade(c, 0.12), ' rx="1.5"') + rect(17, 1, 14, 14, light(c, 0.06), ' rx="1.5"') + rect(1, 17, 14, 14, light(c, 0.06), ' rx="1.5"')
      + `<path d="M4 8H11V12M21 24H28V20" stroke="#5ff0ff" stroke-width="1" fill="none" opacity=".8"/>`;
  },
};

// ---------- surfaces: the walkable top layer of a ground tile ----------
function surface(kind, c, fillColor) {
  const lip = (h, color, bumps = 8, bumpH = 2.5) => {
    let d = `M0 0H${T}V${h}`;
    for (let i = bumps; i > 0; i--) { const x1 = (i - 0.5) * T / bumps, x0 = (i - 1) * T / bumps; d += `Q${f(x1)} ${f(h + bumpH)} ${f(x0)} ${h}`; }
    return `<path d="${d}Z" fill="${color}"/>`;
  };
  switch (kind) {
    case 'none': return '';
    case 'grass': return lip(9, shade(c, 0.25), 8, 3) + lip(7.5, c, 8, 2.5) + rect(0, 0, T, 2, light(c, 0.25))
      + [3, 9, 15, 21, 27].map(x => `<path d="M${x} 6l1 -3l1 3" fill="${light(c, 0.3)}"/>`).join('') + rect(0, 0, T, 0.8, light(c, 0.45));
    case 'flowers': return surface('grass', c) + [[5, 4, '#ffffff'], [17, 3, '#ffd23f'], [26, 5, '#ff7ab8']].map(([x, y, k]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${k}"/><circle cx="${x}" cy="${y}" r=".6" fill="#ffb02a"/>`).join('');
    case 'moss': return lip(6, shade(c, 0.15), 5, 4) + lip(4.5, c, 6, 3) + rect(0, 0, T, 1.2, light(c, 0.2));
    case 'snow': return lip(8, '#dfe9f5', 4, 3.5) + lip(6.5, '#ffffff', 4, 2.5) + rect(0, 0, T, 1, '#ffffff') + rect(4, 2, 6, 1, '#cfe3ff');
    case 'sand': return lip(5, light(c, 0.1), 6, 1.5) + rect(0, 0, T, 1.2, light(c, 0.3));
    case 'frosting': return lip(8, shade(c, 0.12), 4, 5) + lip(6.5, c, 4, 4) + rect(0, 0, T, 1.5, light(c, 0.3));
    case 'metal': return rect(0, 0, T, 5, mix(c, '#c9d0da', 0.5)) + rect(0, 0, T, 1, '#ffffff', ' opacity=".6"') + rect(0, 5, T, 1, shade(fillColor, 0.45))
      + [[3, 2.5], [16, 2.5], [29, 2.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="${shade(c, 0.3)}"/>`).join('');
    case 'stone': return rect(0, 0, T, 5, light(fillColor, 0.18)) + rect(0, 0, T, 1, light(fillColor, 0.35)) + rect(0, 5, T, 1, shade(fillColor, 0.4)) + rect(10, 0, 1, 5, shade(fillColor, 0.25)) + rect(25, 0, 1, 5, shade(fillColor, 0.25));
    default: return '';
  }
}

// ---------- platforms: a full cell, framed so runs of platforms read as blocks ----------
function platform(kind, c, r) {
  const O = outlineOf(c);
  const bevel = (color) => rect(0, 0, T, T, color) + rect(0, 0, T, 2, light(color, 0.3)) + rect(0, 0, 2, T, light(color, 0.18)) + rect(0, T - 2, T, 2, shade(color, 0.3)) + rect(T - 2, 0, 2, T, shade(color, 0.22));
  switch (kind) {
    case 'brick': return FILL.brick(c) + rect(0, 0, T, 1, light(c, 0.35)) + rect(0, T - 1, T, 1, O);
    case 'wood': return FILL.wood(c) + rect(0, T - 1.5, T, 1.5, O) + [[3, 4], [29, 4], [3, 20], [29, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="${shade(c, 0.45)}"/>`).join('');
    case 'stone': return bevel(c) + `<path d="M16 2V30M2 16H30" stroke="${shade(c, 0.28)}" stroke-width="1.2"/>`;
    case 'metal': return bevel(c) + `<path d="M4 4L28 28M28 4L4 28" stroke="${shade(c, 0.2)}" stroke-width="2.5"/>` + [[4, 4], [28, 4], [4, 28], [28, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${light(c, 0.35)}"/>`).join('');
    case 'ice': return bevel(c) + `<path d="M4 22L22 4M12 28L28 12" stroke="#ffffff" stroke-width="2" opacity=".7"/>`;
    case 'crate': return bevel(c) + rect(4, 4, 24, 24, 'none', ` stroke="${shade(c, 0.35)}" stroke-width="2"`) + `<path d="M5 5L27 27M27 5L5 27" stroke="${shade(c, 0.3)}" stroke-width="2.5"/>`;
    case 'cloud': return rect(0, 0, T, T, '#ffffff') + rect(0, T - 6, T, 6, '#dfe9f5') + `<circle cx="8" cy="${T - 6}" r="4" fill="#ffffff"/><circle cx="24" cy="${T - 6}" r="4" fill="#ffffff"/>` + rect(0, 0, T, 2, '#ffffff');
    case 'grass': return FILL.dirt(mix(c, '#8a5a2b', 0.75), r) + surface('grass', c) + rect(0, T - 1.5, T, 1.5, outlineOf('#6b4325'));
    case 'crystal': return FILL.crystal(c) + rect(0, 0, T, 1.5, light(c, 0.45)) + rect(0, T - 1.5, T, 1.5, O);
    case 'tech': return FILL.tech(c) + rect(0, 0, T, 2, '#5ff0ff', ' opacity=".7"') + rect(0, T - 1.5, T, 1.5, O);
    default: return bevel(c);
  }
}

/**
 * Paint a 2×2 tileset atlas: groundTop, groundFill, platform, wall.
 * Returns { svg, layout } where layout matches the renderer's tileset record.
 */
export function paintTileset(input = {}, { pixel = false, seed = 'tiles' } = {}) {
  const material = MATERIALS.includes(input.material) ? input.material : 'dirt';
  const surf = SURFACES.includes(input.surface) ? input.surface : 'grass';
  const plat = PLATFORMS.includes(input.platform) ? input.platform : 'brick';
  const groundColor = hex(input.groundColor, '#8a5a2b'), surfaceColor = hex(input.surfaceColor, '#4fbf3a'), platformColor = hex(input.platformColor, '#c0603a');
  const r = rng(seed);
  const d = makeDefs('t');
  const fill = FILL[material](groundColor, r);
  const cells = {
    groundTop: fill + surface(surf, surfaceColor, groundColor),
    groundFill: fill,
    platform: platform(plat, platformColor, r),
    wall: fill + rect(0, 0, T, T, '#000000', ' opacity=".18"'),
  };
  // Each cell: content tiled 3×3 around the cell and clipped to the padded square.
  const body = Object.entries(TILE_LAYOUT.cells).map(([name, [cx, cy]]) => {
    const id = d.raw(`cell|${name}`, id => `<g id="${id}">${cells[name]}</g>`);
    // Above and below a surface tile is more soil, not more grass.
    const rowId = name === 'groundTop' ? d.raw('cell|groundFill', id => `<g id="${id}">${cells.groundFill}</g>`) : id;
    const ox = cx * CELL + PAD, oy = cy * CELL + PAD;
    const clip = d.clip(`${name}`, `<rect x="${ox - PAD}" y="${oy - PAD}" width="${CELL}" height="${CELL}"/>`);
    let uses = '';
    for (const dy of [-T, 0, T]) for (const dx of [-T, 0, T]) uses += `<use href="#${dy ? rowId : id}" x="${ox + dx}" y="${oy + dy}"/>`;
    return `<g clip-path="${clip}">${uses}</g>`;
  }).join('');
  const scale = pixel ? 1 : 4;
  const size = CELL * 2;
  const svg = document({ width: size * scale, height: size * scale, viewBox: `0 0 ${size} ${size}`, defs: d.toString(), body, crisp: pixel });
  return { svg, layout: { ...TILE_LAYOUT, inset: PAD / CELL } };
}
