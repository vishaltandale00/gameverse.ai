// Overworld tiles drawn in code: 16×16 pixel-art cells with neighbor-aware edges (paths, water
// shores, fences, ledges, carpets) and whole buildings drawn over their footprint. Each map is
// pre-rendered once into two animation frames (water and grass sway), cached by map id.
import { T } from '../world/tiles.js';
import { mix, light, shade, hex, hueShift } from '../../../art/color.js';
import { seedFrom } from '../../../kernel/rng.js';

export const TS = 16;

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

const THEMES = [
  [/volcan|lava|ember|cinder|hot.?spring|ash|steam|magma/, { grass: '#9aa84a', path: '#c89a6a', tree: '#5a7a3a', water: '#4aa0c8', floor: '#5a3a30', rock: '#6a4a40' }],
  [/snow|ice|frost|winter|glacier/, { grass: '#dfe9f2', path: '#b8c8d8', tree: '#3a7a6a', water: '#6ab8e8', floor: '#9ab0c8', rock: '#8aa0b8' }],
  [/desert|sand|dune|canyon/, { grass: '#e2c27a', path: '#d0a868', tree: '#7aa04a', water: '#4ab0c8', floor: '#b08a5a', rock: '#a07a50' }],
  [/crystal|gem|amethyst/, { grass: '#7ac06a', path: '#c8b08a', tree: '#3a8a4a', water: '#5ab0e8', floor: '#4a3a5a', rock: '#5a4a78' }],
  [/haunt|spook|ghost|grave|night/, { grass: '#5a8a5a', path: '#9a8a7a', tree: '#2a4a3a', water: '#3a6a9a', floor: '#3a3448', rock: '#4a4460' }],
  [/mist|mountain|summit|cliff|hill|windy|peak/, { grass: '#78b860', path: '#c8b088', tree: '#3a7a52', water: '#4a98d8', floor: '#5a5048', rock: '#7a7068' }],
  [/forest|grove|wood|jungle/, { grass: '#5aa848', path: '#b89a6a', tree: '#2a6a32', water: '#3a90c8', floor: '#5a4a38', rock: '#6a6050' }],
  [/river|brook|lake|sea|coast|beach|harbor|bridge/, { grass: '#6cc04a', path: '#d8bc88', tree: '#3a8a3a', water: '#3a9ae0', floor: '#5a4a40', rock: '#706458' }],
];

/** Colors for a map from its theme text and the locked art direction. */
export function paletteFor(map, direction, extra = {}) {
  const text = `${map.theme || ''} ${map.name || ''}`.toLowerCase();
  const theme = THEMES.find(([re]) => re.test(text))?.[1] || {};
  const dirGrass = direction?.tiles?.surface === 'grass' ? hex(direction.tiles.surfaceColor) : null;
  const grass = theme.grass || (dirGrass ? mix(dirGrass, '#6cc04a', 0.5) : '#6cc04a');
  const path = theme.path || mix(hex(direction?.tiles?.groundColor, '#c8a070'), '#d8bc88', 0.6);
  const tree = theme.tree || shade(grass, 0.35);
  const accent = hex(direction?.player?.colors?.accent, '#d8403a');
  const gymType = extra.gymColor ? hex(extra.gymColor, '#a8a878') : null;
  return {
    grass, grassDark: shade(grass, 0.22), grassLight: light(grass, 0.18),
    tall: shade(grass, 0.12), tallDark: shade(grass, 0.42), tallLight: light(grass, 0.3),
    path, pathDark: shade(path, 0.25), pathLight: light(path, 0.2),
    tree, treeDark: shade(tree, 0.35), treeLight: light(tree, 0.25), trunk: '#6a4426',
    water: theme.water || '#3a9ae0', waterLight: light(theme.water || '#3a9ae0', 0.4), waterDark: shade(theme.water || '#3a9ae0', 0.3),
    flowers: ['#f05a6a', '#f8d84a', '#ffffff', '#f08ac8'],
    floor: map.kind === 'cave' ? (theme.floor || '#5a4a40') : gymType ? mix(gymType, '#d8d4c8', 0.7) : map.kind === 'league' ? '#e4dccb' : '#e8d8b8',
    floorAlt: map.kind === 'cave' ? shade(theme.floor || '#5a4a40', 0.15) : gymType ? mix(gymType, '#c8c4b8', 0.55) : map.kind === 'league' ? '#d0c4ac' : '#d8c4a0',
    rock: theme.rock || '#6a6050', wall: gymType ? mix(gymType, '#6a6a78', 0.6) : map.kind === 'league' ? '#8a7a9a' : '#c8b8a0',
    wallpaper: gymType ? mix(gymType, '#e8e4d8', 0.55) : map.room === 'center' ? '#f4d8d8' : map.room === 'mart' ? '#d8e4f4' : map.room === 'lab' ? '#e0e8e8' : '#f0e0c0',
    carpet: map.kind === 'league' ? '#c83a4a' : gymType ? shade(gymType, 0.15) : '#c83a4a',
    wood: '#b07a48', woodDark: '#7a4e2a', accent,
    roofs: { center: '#e05a5a', mart: '#4a7ad8', lab: '#7a8a9a', gym: gymType || hueShift(accent, 180), house: ['#e0904a', '#4aa0a0', '#9a6ac8', '#5aa05a', '#c86a8a'] },
  };
}

// ---------------------------------------------------------------- per-tile art

function drawTile(g, p, ch, x, y, nb, r, frame, map) {
  const X = x * TS, Y = y * TS;
  const R = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(X + px, Y + py, w, h); };
  const same = (dx, dy, set) => set.includes(nb(dx, dy));
  const groundBase = () => {
    R(0, 0, 16, 16, p.grass);
    for (let i = 0; i < 3; i++) { const sx = (r(i) * 14) | 0, sy = (r(i + 7) * 14) | 0; R(sx, sy, 1, 1, p.grassDark); R(sx + 1, sy, 1, 1, p.grassLight); }
  };
  const floorBase = () => {
    if (map.kind === 'cave') { R(0, 0, 16, 16, p.floor); for (let i = 0; i < 4; i++) R((r(i) * 15) | 0, (r(i + 3) * 15) | 0, 2, 1, p.floorAlt); R((r(9) * 13) | 0, (r(11) * 13) | 0, 2, 2, shade(p.floor, 0.3)); return; }
    const alt = (x + y) % 2 === 0;
    R(0, 0, 16, 16, alt ? p.floor : p.floorAlt);
    R(0, 15, 16, 1, shade(p.floorAlt, 0.08)); R(15, 0, 1, 16, shade(p.floorAlt, 0.08));
  };
  switch (ch) {
    case T.ground: groundBase(); break;
    case T.path: {
      R(0, 0, 16, 16, p.path);
      for (let i = 0; i < 4; i++) R((r(i) * 15) | 0, (r(i + 5) * 15) | 0, 1, 1, i % 2 ? p.pathDark : p.pathLight);
      const edge = [T.path, T.door, T.mat, T.sign];
      if (!same(0, -1, edge)) { R(0, 0, 16, 1, p.grassDark); R(0, 1, 16, 1, p.pathDark); }
      if (!same(0, 1, edge)) { R(0, 15, 16, 1, p.pathLight); }
      if (!same(-1, 0, edge)) { R(0, 0, 1, 16, p.pathDark); }
      if (!same(1, 0, edge)) { R(15, 0, 1, 16, p.pathDark); }
      if (!same(-1, 0, edge) && !same(0, -1, edge)) R(0, 0, 2, 2, p.grass);
      if (!same(1, 0, edge) && !same(0, -1, edge)) R(14, 0, 2, 2, p.grass);
      if (!same(-1, 0, edge) && !same(0, 1, edge)) R(0, 14, 2, 2, p.grass);
      if (!same(1, 0, edge) && !same(0, 1, edge)) R(14, 14, 2, 2, p.grass);
      break;
    }
    case T.grass: {
      R(0, 0, 16, 16, p.tall);
      const sway = frame ? 1 : 0;
      for (const [bx, by] of [[1, 3], [8, 1], [4, 9], [11, 8]]) {
        R(bx, by + 5, 5, 2, p.tallDark);
        R(bx + sway, by, 1, 5, p.tallDark); R(bx + 2, by + 1, 1, 4, p.tallDark); R(bx + 4 - sway, by, 1, 5, p.tallDark);
        R(bx + 1 + sway, by + 1, 1, 3, p.tallLight); R(bx + 3, by + 2, 1, 3, p.tallLight);
      }
      break;
    }
    case T.flower: {
      groundBase();
      const c1 = p.flowers[(r(2) * 4) | 0], c2 = p.flowers[(r(3) * 4) | 0], s = frame ? 1 : 0;
      for (const [fx, fy, c] of [[3 + s, 3, c1], [10 - s, 9, c2]]) { R(fx, fy - 1, 2, 1, c); R(fx - 1, fy, 4, 2, c); R(fx, fy + 2, 2, 1, c); R(fx + 0.5, fy + 0.5, 1, 1, '#f8e070'); R(fx + 1, fy + 3, 1, 2, p.grassDark); }
      break;
    }
    case T.tree: {
      groundBase();
      const below = nb(0, 1) === T.tree, above = nb(0, -1) === T.tree;
      if (!below) { R(6, 11, 4, 5, p.trunk); R(7, 11, 1, 5, light(p.trunk, 0.2)); R(4, 15, 8, 1, shade(p.grass, 0.4)); }
      const cy = below ? 8 : 6;
      g.fillStyle = p.treeDark; g.beginPath(); g.arc(X + 8, Y + cy + 1, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = p.tree; g.beginPath(); g.arc(X + 8, Y + cy, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = p.treeLight; g.beginPath(); g.arc(X + 6, Y + cy - 2, 3.5, 0, Math.PI * 2); g.fill();
      R(9, cy + 2, 2, 1, p.treeDark); R(4, cy + 1, 1, 1, p.treeDark);
      if (above) { g.fillStyle = p.tree; g.fillRect(X + 3, Y, 10, 3); }
      break;
    }
    case T.water: {
      R(0, 0, 16, 16, p.water);
      const o = frame ? 3 : 0;
      R((2 + o) % 14, 4, 4, 1, p.waterLight); R((9 + o) % 14, 10, 5, 1, p.waterLight); R((5 + o) % 14, 13, 3, 1, p.waterDark);
      const w = c => c === T.water;
      if (!w(nb(0, -1))) { R(0, 0, 16, 2, p.waterLight); R(0, 2, 16, 1, '#ffffff'); }
      if (!w(nb(0, 1))) R(0, 14, 16, 2, p.waterDark);
      if (!w(nb(-1, 0))) R(0, 0, 2, 16, p.waterLight);
      if (!w(nb(1, 0))) R(14, 0, 2, 16, p.waterDark);
      break;
    }
    case T.ledge: {
      groundBase();
      R(0, 9, 16, 4, shade(p.grass, 0.38)); R(0, 8, 16, 1, p.grassLight); R(0, 13, 16, 2, shade(p.grass, 0.55));
      for (let i = 1; i < 16; i += 4) R(i, 10, 2, 1, shade(p.grass, 0.25));
      if (nb(-1, 0) !== T.ledge) R(0, 8, 2, 7, p.grass);
      if (nb(1, 0) !== T.ledge) R(14, 8, 2, 7, p.grass);
      break;
    }
    case T.fence: {
      groundBase();
      const l = nb(-1, 0) === T.fence, rr = nb(1, 0) === T.fence;
      R(l ? 0 : 3, 5, (rr ? 16 : 13) - (l ? 0 : 3), 2, p.wood); R(l ? 0 : 3, 10, (rr ? 16 : 13) - (l ? 0 : 3), 2, p.wood);
      R(3, 3, 3, 11, p.wood); R(3, 3, 3, 1, light(p.wood, 0.3)); R(5, 4, 1, 10, p.woodDark);
      R(10, 3, 3, 11, p.wood); R(10, 3, 3, 1, light(p.wood, 0.3)); R(12, 4, 1, 10, p.woodDark);
      break;
    }
    case T.sign: {
      if (map.kind === 'town' || map.kind === 'route') groundBase(); else floorBase();
      R(7, 9, 2, 6, p.woodDark); R(2, 3, 12, 7, p.woodDark); R(3, 4, 10, 5, p.wood);
      R(4, 5, 8, 1, shade(p.wood, 0.3)); R(4, 7, 6, 1, shade(p.wood, 0.3)); R(3, 4, 10, 1, light(p.wood, 0.25));
      break;
    }
    case T.floor: case T.mat: case T.switch: case T.carpet: case T.barrier: {
      floorBase();
      if (ch === T.mat) { R(2, 4, 12, 9, '#a83a3a'); R(3, 5, 10, 7, '#c85a4a'); for (let i = 4; i < 12; i += 2) R(i, 6, 1, 5, '#e88a6a'); }
      if (ch === T.carpet) {
        R(0, 0, 16, 16, p.carpet);
        const c = cc => cc === T.carpet;
        if (!c(nb(-1, 0))) R(0, 0, 2, 16, '#e8c04a');
        if (!c(nb(1, 0))) R(14, 0, 2, 16, '#e8c04a');
        if (!c(nb(0, -1))) R(0, 0, 16, 2, '#e8c04a');
        R(7, 0, 2, 16, light(p.carpet, 0.12));
      }
      break;
    }
    case T.wall: {
      if (map.kind === 'town') { R(0, 0, 16, 16, p.grass); break; } // buildings paint over their footprint
      if (y < 2 && x > 0 && x < map.w - 1) {
        // Back wall: wallpaper above a baseboard.
        R(0, 0, 16, 16, p.wallpaper);
        for (let i = 2; i < 16; i += 6) R(i, 0, 1, 16, shade(p.wallpaper, 0.06));
        if (y === 1) { R(0, 12, 16, 4, shade(p.wallpaper, 0.35)); R(0, 12, 16, 1, light(p.wallpaper, 0.2)); }
        if (y === 0) R(0, 0, 16, 3, shade(p.wall, 0.4));
      } else { R(0, 0, 16, 16, shade(p.wall, 0.45)); R(0, 0, 16, 1, shade(p.wall, 0.25)); }
      break;
    }
    case T.window: R(0, 0, 16, 16, p.grass); break;
    case T.roof: case T.door: R(0, 0, 16, 16, p.grass); break;
    case T.rock: {
      R(0, 0, 16, 16, shade(p.rock, 0.3));
      const front = nb(0, 1) !== T.rock && nb(0, 1) !== null;
      if (front) { R(0, 4, 16, 12, p.rock); R(0, 4, 16, 2, light(p.rock, 0.25)); for (let i = 2; i < 16; i += 5) R(i, 7 + ((i * 3) % 4), 2, 5, shade(p.rock, 0.18)); R(0, 15, 16, 1, shade(p.rock, 0.5)); }
      else { R((r(1) * 10) | 0, (r(2) * 10) | 0, 4, 3, shade(p.rock, 0.2)); R(((r(3) * 10) | 0) + 2, ((r(4) * 10) | 0) + 3, 3, 2, shade(p.rock, 0.42)); }
      break;
    }
    case T.boulder: {
      floorBase();
      g.fillStyle = shade(p.rock, 0.45); g.beginPath(); g.ellipse(X + 8, Y + 13, 7, 3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = p.rock; g.beginPath(); g.arc(X + 8, Y + 8, 6.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = light(p.rock, 0.3); g.beginPath(); g.arc(X + 6, Y + 6, 2.5, 0, Math.PI * 2); g.fill();
      break;
    }
    case T.counter: {
      floorBase();
      R(0, 2, 16, 12, p.wood); R(0, 2, 16, 3, light(p.wood, 0.35)); R(0, 12, 16, 2, p.woodDark);
      if (nb(-1, 0) !== T.counter) R(0, 2, 1, 12, p.woodDark);
      if (nb(1, 0) !== T.counter) R(15, 2, 1, 12, p.woodDark);
      break;
    }
    case T.shelf: {
      floorBase();
      R(1, 0, 14, 15, p.woodDark); R(2, 1, 12, 13, shade(p.woodDark, 0.25));
      const books = ['#d8403a', '#3a6ad8', '#3fa84a', '#e8b830', '#8a4ac8'];
      for (const sy of [2, 8]) for (let i = 0; i < 5; i++) R(2 + i * 2 + (i > 2 ? 1 : 0), sy, 2, 5, books[(i + x + sy) % 5]);
      R(1, 7, 14, 1, p.wood); R(1, 13, 14, 2, p.wood);
      break;
    }
    case T.table: {
      floorBase();
      R(1, 4, 14, 8, p.wood); R(1, 4, 14, 2, light(p.wood, 0.3)); R(2, 12, 2, 3, p.woodDark); R(12, 12, 2, 3, p.woodDark);
      break;
    }
    case T.pc: {
      floorBase();
      R(2, 1, 12, 13, '#9aa0b0'); R(3, 2, 10, 7, '#2a3a5a'); R(4, 3, 4, 2, '#7ad8f0'); R(3, 10, 10, 2, '#6a7080'); R(5, 14, 6, 2, '#5a606a');
      break;
    }
    case T.heal: {
      floorBase();
      R(1, 3, 14, 11, '#c8ccd8'); R(1, 3, 14, 2, '#f0f2f8'); R(1, 13, 14, 1, '#8a90a0');
      for (let i = 0; i < 3; i++) { g.fillStyle = '#e04a4a'; g.beginPath(); g.arc(X + 4 + i * 4, Y + 8, 1.7, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case T.statue: {
      floorBase();
      R(3, 11, 10, 4, '#8a8a98'); R(3, 11, 10, 1, '#b8b8c8');
      g.fillStyle = '#a8a8b8'; g.beginPath(); g.arc(X + 8, Y + 5, 4, 0, Math.PI * 2); g.fill(); R(5, 7, 6, 5, '#a8a8b8'); R(6, 3, 2, 2, '#d8d8e8');
      break;
    }
    default: R(0, 0, 16, 16, '#ff00ff');
  }
}

// ---------------------------------------------------------------- buildings

function drawBuilding(g, p, b) {
  const X = b.x * TS, Y = b.y * TS, W = b.w * TS;
  const roof = b.kind === 'house' ? p.roofs.house[seedFrom(`${b.x},${b.y}`) % p.roofs.house.length] : p.roofs[b.roof] || p.roofs.house[0];
  const big = b.kind === 'gym' || b.kind === 'league';
  // Shadow, walls.
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(X + 3, Y + 4 * TS - 2, W, 4);
  g.fillStyle = big ? '#d8d0c8' : '#f0e4cc'; g.fillRect(X, Y + 2 * TS - 2, W, 2 * TS + 2);
  g.fillStyle = big ? '#b8b0a8' : '#d8c8a8'; g.fillRect(X, Y + 4 * TS - 4, W, 4);
  for (let i = 0; i < b.w * 2; i++) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(X + i * 8, Y + 2 * TS, 1, 2 * TS - 4); }
  // Roof: overhang, shingles, ridge.
  g.fillStyle = shade(roof, 0.45); g.fillRect(X - 2, Y + 2 * TS - 4, W + 4, 4);
  g.fillStyle = roof; g.fillRect(X - 2, Y + 1, W + 4, 2 * TS - 4);
  g.fillStyle = light(roof, 0.25); g.fillRect(X - 2, Y + 1, W + 4, 3);
  for (let row = 0; row < 3; row++) { g.fillStyle = shade(roof, 0.18); g.fillRect(X - 2, Y + 8 + row * 7, W + 4, 1); for (let i = (row % 2) * 4; i < W + 4; i += 8) g.fillRect(X - 2 + i, Y + 8 + row * 7 - 6, 1, 6); }
  g.fillStyle = shade(roof, 0.3); g.fillRect(X - 2, Y, W + 4, 1);
  // Windows.
  for (const wx of [b.x + 1, b.x + b.w - 2]) {
    if (wx === b.door.x) continue;
    const x0 = wx * TS + 3, y0 = Y + 2 * TS + 3;
    g.fillStyle = '#6a5a4a'; g.fillRect(x0 - 1, y0 - 1, 12, 10);
    g.fillStyle = '#8ad0f0'; g.fillRect(x0, y0, 10, 8);
    g.fillStyle = '#c8f0ff'; g.fillRect(x0 + 1, y0 + 1, 3, 3);
    g.fillStyle = '#6a5a4a'; g.fillRect(x0 + 4, y0, 1, 8); g.fillRect(x0, y0 + 4, 10, 1);
  }
  // Door.
  const dx = b.door.x * TS, dy = b.door.y * TS;
  g.fillStyle = '#4a3020'; g.fillRect(dx + 2, dy - 2, 12, 18);
  g.fillStyle = b.kind === 'center' || b.kind === 'mart' ? '#a8d8f0' : '#8a5a32'; g.fillRect(dx + 3, dy - 1, 10, 17);
  if (b.kind === 'center' || b.kind === 'mart') { g.fillStyle = '#e8f8ff'; g.fillRect(dx + 7, dy - 1, 2, 17); }
  else { g.fillStyle = '#f0c040'; g.fillRect(dx + 10, dy + 7, 2, 2); }
  // Emblem over the door.
  const ex = dx + 8, ey = Y + 2 * TS - 6;
  if (b.kind === 'center') { g.fillStyle = '#ffffff'; g.fillRect(ex - 6, ey - 5, 12, 10); g.fillStyle = '#e04a4a'; g.fillRect(ex - 1, ey - 4, 2, 8); g.fillRect(ex - 4, ey - 1, 8, 2); }
  if (b.kind === 'mart') { g.fillStyle = '#ffffff'; g.fillRect(ex - 6, ey - 5, 12, 10); g.fillStyle = '#3a6ad8'; g.fillRect(ex - 4, ey - 3, 2, 6); g.fillRect(ex + 2, ey - 3, 2, 6); g.fillRect(ex - 2, ey - 3, 4, 2); }
  if (big) { g.fillStyle = '#f0c040'; g.beginPath(); g.moveTo(ex, ey - 7); g.lineTo(ex + 6, ey); g.lineTo(ex, ey + 6); g.lineTo(ex - 6, ey); g.closePath(); g.fill(); g.fillStyle = shade('#f0c040', 0.3); g.fillRect(ex - 1, ey - 3, 2, 6); }
}

/** Pre-render a map's static layers: [frameA, frameB]. */
export function renderMapLayers(map, palette) {
  const out = [];
  for (let frame = 0; frame < 2; frame++) {
    const cv = makeCanvas(map.w * TS, map.h * TS), g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const ch = map.tiles[y][x];
      const nb = (dx, dy) => { const yy = y + dy, xx = x + dx; return yy < 0 || xx < 0 || yy >= map.h || xx >= map.w ? null : map.tiles[yy][xx]; };
      const h = seedFrom(`${map.id}:${x},${y}`);
      const r = i => ((h * (i + 1) * 2654435761) >>> 0) / 4294967296;
      drawTile(g, palette, ch, x, y, nb, r, frame, map);
    }
    for (const b of map.buildings || []) drawBuilding(g, palette, b);
    out.push(cv);
  }
  return out;
}

/** Tiles that change with game state (gym barrier, switch), drawn per frame. */
export function drawDynamicTile(g, palette, ch, X, Y, { open = false, pressed = false, t = 0 } = {}) {
  if (ch === T.barrier && !open) {
    g.fillStyle = 'rgba(80,200,255,.25)'; g.fillRect(X, Y + 2, TS, 12);
    for (let i = 1; i < 16; i += 5) { g.fillStyle = (Math.floor(t / 6) + i) % 2 ? '#a8f0ff' : '#5ad0ff'; g.fillRect(X + i, Y + 1, 2, 14); }
    g.fillStyle = '#5a6070'; g.fillRect(X, Y + 13, TS, 3);
  }
  if (ch === T.switch) {
    g.fillStyle = '#5a6070'; g.fillRect(X + 3, Y + 3, 10, 10);
    g.fillStyle = pressed ? '#3fa84a' : '#e04a4a'; g.fillRect(X + 5, Y + (pressed ? 6 : 5), 6, pressed ? 5 : 6);
    if (!pressed) { g.fillStyle = '#ff9a9a'; g.fillRect(X + 6, Y + 6, 2, 2); }
  }
}
