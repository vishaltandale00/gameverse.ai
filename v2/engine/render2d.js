// Minimal 2D canvas renderer for composed games. Pure function of
// (spec, state, canvas size); keeps no game state of its own.
const HUD_HIDDEN = new Set(['collected']);

// Generated art (spec.art) loads asynchronously; until an image is ready the
// renderer draws the placeholder glyph or color, so games are playable at once.
const images = new Map();
function image(url) {
  if (!url || typeof Image === 'undefined') return null;
  let entry = images.get(url);
  if (!entry) { const img = new Image(); entry = { img, ready: false }; img.onload = () => { entry.ready = true; }; img.src = url; images.set(url, entry); }
  return entry.ready ? entry.img : null;
}

export function createRenderer(game) {
  const { spec, width, height } = game;
  const art = spec.art || {};
  const tileArt = { [Object.keys(spec.entities).find(k => k === 'ground')]: art.tiles?.ground, [Object.keys(spec.entities).find(k => k === 'platform')]: art.tiles?.platform };
  const tileKinds = spec.level.rows.map(row => [...row].map(ch => spec.level.legend[ch]));
  const rows = spec.level.rows;
  const tileColors = rows.map(row => [...row].map(ch => {
    const kind = spec.level.legend[ch];
    return kind && spec.entities[kind]?.solid ? spec.entities[kind].color || '#556' : null;
  }));

  return function render(ctx, state, { cssWidth, cssHeight, label = '' } = {}) {
    const w = cssWidth ?? ctx.canvas.width, h = cssHeight ?? ctx.canvas.height;
    // Fit the level's height (up to 14 tiles visible) and follow the player.
    const tile = Math.max(8, Math.floor(Math.min(h / Math.min(height, 14), w / Math.min(width, 24))));
    const player = state.entities.find(e => e.tags.includes('player'));
    const viewW = w / tile, viewH = h / tile;
    const clampView = (center, view, size) => size <= view ? (size - view) / 2 : Math.max(0, Math.min(size - view, center - view / 2));
    const camX = clampView(player ? player.x + player.w / 2 : width / 2, viewW, width);
    const camY = clampView(player ? player.y + player.h / 2 : height / 2, viewH, height);
    const sx = x => Math.round((x - camX) * tile), sy = y => Math.round((y - camY) * tile);

    ctx.imageSmoothingEnabled = !/pixel/i.test(art.style || '');
    ctx.fillStyle = spec.background || '#101820'; ctx.fillRect(0, 0, w, h);
    const bg = image(art.background);
    if (bg) { // cover the view, scrolling slowly for parallax
      const scale = Math.max(w / bg.width, h / bg.height) * 1.15;
      const bw = bg.width * scale, bh = bg.height * scale;
      const px = -((camX / Math.max(1, width - viewW)) || 0) * (bw - w), py = -((camY / Math.max(1, height - viewH)) || 0) * (bh - h);
      ctx.drawImage(bg, px, py, bw, bh);
    }
    const x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(width, Math.ceil(camX + viewW));
    const y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(height, Math.ceil(camY + viewH));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = tileColors[y][x];
      if (!color || !state.solid[y * width + x]) continue;
      const tex = image(tileArt[tileKinds[y][x]]);
      if (tex) ctx.drawImage(tex, sx(x), sy(y), tile + 1, tile + 1);
      else { ctx.fillStyle = color; ctx.fillRect(sx(x), sy(y), tile + 1, tile + 1); }
      if (!state.solid[(y - 1) * width + x]) { ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(sx(x), sy(y), tile + 1, Math.max(1, tile / 10)); }
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const invuln = state.modules.health?.invuln > 0;
    for (const e of state.entities) {
      const def = spec.entities[e.kind] || {};
      const px = sx(e.x), py = sy(e.y), pw = e.w * tile, ph = e.h * tile;
      if (px + pw < 0 || py + ph < 0 || px > w || py > h) continue;
      if (e.tags.includes('player') && invuln && Math.floor(state.frame / 4) % 2) continue;
      const sprite = image(art.sprites?.[e.kind]);
      if (sprite) {
        ctx.save();
        const size = Math.max(pw, ph) * 1.35; // sprites have padding; draw a little larger than the hitbox
        ctx.translate(px + pw / 2, py + ph - size / 2 + size * 0.06);
        if (e.face < 0 && (e.tags.includes('player') || e.tags.includes('enemy'))) ctx.scale(-1, 1);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else if (def.glyph) {
        ctx.save();
        ctx.font = `${Math.round(Math.max(pw, ph) * 1.1)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillStyle = '#fff'; // emoji glyphs inherit fill alpha
        ctx.translate(px + pw / 2, py + ph / 2);
        if (e.face < 0 && e.tags.includes('player')) ctx.scale(-1, 1);
        ctx.fillText(def.glyph, 0, ph * 0.05);
        ctx.restore();
      } else {
        ctx.fillStyle = def.color || (e.tags.includes('projectile') ? '#fff6a0' : '#ccc');
        const r = Math.min(pw, ph) / 4;
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, r); ctx.fill();
      }
    }

    // HUD: game variables, then status banner.
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '600 14px system-ui, sans-serif';
    const hud = Object.entries(state.vars).filter(([k]) => !HUD_HIDDEN.has(k))
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${k === 'time_left' ? Math.ceil(v) : Math.round(v)}`).join('   ');
    if (label || hud) {
      const text = [label, hud].filter(Boolean).join('   ·   ');
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(8, 8, ctx.measureText(text).width + 16, 24);
      ctx.fillStyle = '#fff'; ctx.fillText(text, 16, 13);
    }
    if (state.status !== 'playing') {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h / 2 - 40, w, 80);
      ctx.fillStyle = state.status === 'won' ? '#9cf6a4' : '#ff9c8a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(state.status === 'won' ? 'You win!' : 'Game over', w / 2, h / 2 - 8);
      ctx.font = '500 14px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText('Press A / Space to play again', w / 2, h / 2 + 20);
    }
  };
}
