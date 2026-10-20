// createRenderer(game, { art }) → render(ctx, state, frame) (KIT_CONTRACT.md "Renderer").
// Draws from game.view(state) only: the overworld (pre-rendered tile layers, people, props, tall
// grass over feet, emotes, banners, cave darkness), the battle scene, menus and transitions.
// The world is drawn in a virtual pixel space about 240×160, widened to the canvas aspect.
import { TS, paletteFor, renderMapLayers, drawDynamicTile } from './tiles.js';
import { createSpriteBank } from './sprites.js';
import { createBattleScene } from './battle-scene.js';
import { createScreens } from './screens.js';
import { makeTheme, text } from './draw.js';
import { T } from '../world/tiles.js';
import { mix } from '../../../art/color.js';

const PERSON_KIND = { npc: 'npc', guard: 'npc', nurse: 'nurse', clerk: 'npc', mentor: 'mentor', trainer: 'npc', leader: 'npc', champion: 'champion', rival: 'rival' };

export function createRenderer(game, { art = {} } = {}) {
  const { content } = game;
  const theme = makeTheme(art);
  const bank = createSpriteBank(game, art);
  const battle = createBattleScene(game, bank, theme, art);
  const screens = createScreens(game, bank, theme);
  const layers = new Map();
  const particles = [];
  let lastTile = null, clock = 0;

  const gymColor = map => {
    const area = content.areas.find(a => a.id === map.area);
    const t = map.kind === 'gym' && area?.leader ? content.types.find(x => x.id === area.leader.type) : null;
    return t?.color || null;
  };
  function layersFor(map) {
    if (!layers.has(map.id)) layers.set(map.id, renderMapLayers(map, paletteFor(map, art.direction, { gymColor: gymColor(map) })));
    return layers.get(map.id);
  }
  const palettes = new Map();
  const paletteOf = map => { if (!palettes.has(map.id)) palettes.set(map.id, paletteFor(map, art.direction, { gymColor: gymColor(map) })); return palettes.get(map.id); };

  // Warm the sprite cache with the cast seen early.
  bank.prewarm([...content.starters.flatMap(s => [[bank.creature, s, 'idle'], [bank.creature, s, 'idleB']]), [bank.person, 'player', 'hero', '', 'idle'], [bank.person, 'rival', 'rival', '', 'idle'], [bank.person, 'mentor', 'mentor', '', 'idle']]);

  function spawn(x, y, n, color, { up = 0.6, spread = 0.8, life = 0.5, size = 1.4 } = {}) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 40 * spread, vy: -Math.random() * 40 * up - 10, life, t: 0, color, size });
    if (particles.length > 200) particles.splice(0, particles.length - 200);
  }

  function drawBall(g, x, y, r) {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y + r * 0.9, r, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2a38'; g.beginPath(); g.arc(x, y, r + 0.7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, r, 0, Math.PI); g.fill();
    g.fillStyle = mix(theme.accent, '#e04a4a', 0.5); g.beginPath(); g.arc(x, y, r, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2a38'; g.fillRect(x - r, y - 0.5, r * 2, 1);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
  }

  function overworld(g, v, VW, VH, dt, reduced, attract) {
    const map = game.maps[v.map.id];
    const [A, B] = layersFor(map);
    const layer = Math.floor(clock * 1.6) % 2 ? B : A;
    const mw = map.w * TS, mh = map.h * TS;
    const cam = (c, size, view) => (size <= view ? (size - view) / 2 : Math.max(0, Math.min(size - view, c - view / 2)));
    const camX = Math.round(cam(v.camera.x * TS, mw, VW) * 4) / 4, camY = Math.round(cam(v.camera.y * TS, mh, VH) * 4) / 4;
    g.fillStyle = map.kind === 'cave' ? '#1a1418' : map.kind === 'town' || map.kind === 'route' ? '#2a5a2a' : '#141418';
    g.fillRect(0, 0, VW, VH);
    // Visible part of the pre-rendered layer.
    const sx = Math.max(0, camX), sy = Math.max(0, camY);
    const sw = Math.min(mw - sx, VW - (sx - camX)), sh = Math.min(mh - sy, VH - (sy - camY));
    g.imageSmoothingEnabled = false;
    if (sw > 0 && sh > 0) g.drawImage(layer, sx, sy, sw, sh, sx - camX, sy - camY, sw, sh);
    // State-dependent tiles.
    const x0 = Math.max(0, Math.floor(camX / TS)), y0 = Math.max(0, Math.floor(camY / TS));
    const x1 = Math.min(map.w - 1, Math.ceil((camX + VW) / TS)), y1 = Math.min(map.h - 1, Math.ceil((camY + VH) / TS));
    if (map.puzzle) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ch = map.tiles[y][x];
      if (ch === T.barrier || ch === T.switch) drawDynamicTile(g, paletteOf(map), ch, x * TS - camX, y * TS - camY, { open: v.map.barrierOpen, pressed: v.map.barrierOpen, t: v.frame });
    }
    g.imageSmoothingEnabled = true;
    // People and props, back to front.
    const drawables = v.entities.map(e => ({ y: e.y, e }));
    drawables.push({ y: v.player.y, player: true });
    drawables.sort((a, b) => a.y - b.y || (a.player ? 1 : -1));
    for (const d of drawables) {
      if (d.player) {
        const p = v.player;
        const cx = p.x * TS + 8 - camX, foot = p.y * TS + 15 - camY - p.jump * TS;
        if (p.jump) { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(cx, p.y * TS + 14 - camY, 5, 2, 0, 0, Math.PI * 2); g.fill(); }
        bank.drawPerson(g, { kind: 'player', id: 'hero', facing: p.facing, walking: p.walking, phase: p.phase, frame: v.frame }, cx, foot);
        overGrass(g, map, layer, Math.round(p.x), Math.round(p.y), camX, camY, p.walking);
        continue;
      }
      const e = d.e, cx = e.x * TS + 8 - camX, foot = e.y * TS + 15 - camY;
      if (cx < -24 || cx > VW + 24 || foot < -8 || foot > VH + 40) continue;
      if (e.kind === 'item') { drawBall(g, cx, foot - 5, 3.6); continue; }
      if (e.kind === 'starter') { drawBall(g, cx, foot - 9, 3.6); continue; }
      bank.drawPerson(g, { kind: PERSON_KIND[e.kind] || 'npc', id: e.id, desc: e.look, facing: e.facing, walking: e.walking, phase: e.phase, frame: v.frame }, cx, foot);
      if (e.emote) {
        const k = Math.min(1, e.emote.t / 6), bx = cx, by = foot - 34;
        g.fillStyle = '#ffffff'; g.strokeStyle = '#2a2a38'; g.lineWidth = 1;
        g.beginPath(); g.ellipse(bx, by, 6 * k, 7 * k, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        text(g, theme, '!', bx, by + 3.5 * k, { size: 10 * k, align: 'center', color: '#e8402a', weight: 900 });
      }
    }
    // Particles (grass rustle, dust).
    for (const p of particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
      g.globalAlpha = Math.max(0, 1 - p.t / p.life); g.fillStyle = p.color;
      g.fillRect(p.x - camX, p.y - camY, p.size, p.size);
    }
    g.globalAlpha = 1;
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].t > particles[i].life) particles.splice(i, 1);
    // Rustle and dust when the player reaches a new tile.
    const tile = `${v.map.id}:${v.player.tx},${v.player.ty}`;
    if (tile !== lastTile) {
      if (lastTile && !reduced) {
        const ch = map.tiles[v.player.ty]?.[v.player.tx];
        const pal = paletteOf(map);
        if (ch === T.grass) spawn(v.player.tx * TS + 8, v.player.ty * TS + 10, 6, pal.tallLight, { life: 0.45 });
        else if (v.player.running) spawn(v.player.tx * TS + 8, v.player.ty * TS + 15, 3, 'rgba(230,220,200,.8)', { up: 0.2, life: 0.3 });
      }
      lastTile = tile;
    }
    if (map.dark) {
      const px = v.player.x * TS + 8 - camX, py = v.player.y * TS + 8 - camY;
      const grad = g.createRadialGradient(px, py, 20, px, py, Math.max(VW, VH) * 0.75);
      grad.addColorStop(0, 'rgba(10,6,20,0)'); grad.addColorStop(1, 'rgba(10,6,20,.5)');
      g.fillStyle = grad; g.fillRect(0, 0, VW, VH);
    }
    if (v.fx === 'heal') { g.fillStyle = `rgba(255,240,250,${0.25 + 0.25 * Math.sin(v.frame * 0.4)})`; g.fillRect(0, 0, VW, VH); }
    if (v.banner && !attract) screens.banner(g, v.banner, VW);
  }

  /** Tall grass drawn again over the lower half of whoever stands in it. */
  function overGrass(g, map, layer, x, y, camX, camY, walking) {
    if (map.tiles[y]?.[x] !== T.grass) return;
    g.imageSmoothingEnabled = false;
    const cut = walking ? 9 : 7;
    g.drawImage(layer, x * TS, y * TS + (16 - cut), TS, cut, x * TS - camX, y * TS + (16 - cut) - camY, TS, cut);
    g.imageSmoothingEnabled = true;
  }

  return function render(ctx, state, frame) {
    const dt = Math.min(0.05, frame.dt || 1 / 60);
    clock += dt;
    const v = game.view(state);
    const W = frame.cssWidth, H = frame.cssHeight;
    const S = Math.min(W / 240, H / 160);
    const VW = W / S, VH = H / S;
    ctx.save();
    ctx.scale(S, S);
    ctx.imageSmoothingEnabled = true;
    try {
      if (v.mode === 'battle' && v.battle) battle.render(ctx, v.battle, VW, VH, dt, frame.reducedMotion, v.map);
      else if (v.mode === 'evolution' && v.evolution) screens.evolution(ctx, v.evolution, VW, VH, v.frame);
      else if (v.mode === 'ending' && v.ending) screens.ending(ctx, v.ending, VW, VH, v.frame);
      else {
        overworld(ctx, v, VW, VH, dt, frame.reducedMotion, frame.attract);
        if (v.transition) screens.transition(ctx, v.transition, VW, VH, frame.reducedMotion);
        if (v.dialogue && !frame.attract) screens.dialogue(ctx, v.dialogue, VW, VH, v.frame);
        if (v.menu) screens.menu(ctx, v.menu, VW, VH, v.frame);
        if (v.shop) screens.shop(ctx, v.shop, VW, VH);
        if (v.pc) screens.pc(ctx, v.pc, VW, VH);
      }
      if (v.warp) { ctx.fillStyle = `rgba(8,8,12,${Math.max(0, Math.min(1, v.warp.fade))})`; ctx.fillRect(0, 0, VW, VH); }
    } finally { ctx.restore(); }
  };
}
