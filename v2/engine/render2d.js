// Minimal 2D canvas renderer for composed games. Pure function of
// (spec, state, canvas size); keeps no game state of its own.
const HUD_HIDDEN = new Set(['collected']);

export function createRenderer(game) {
  const { spec, width, height } = game;
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

    ctx.fillStyle = spec.background || '#101820'; ctx.fillRect(0, 0, w, h);
    const x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(width, Math.ceil(camX + viewW));
    const y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(height, Math.ceil(camY + viewH));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = tileColors[y][x];
      if (!color || !state.solid[y * width + x]) continue;
      ctx.fillStyle = color; ctx.fillRect(sx(x), sy(y), tile + 1, tile + 1);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(sx(x), sy(y), tile + 1, Math.max(1, tile / 8));
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const invuln = state.modules.health?.invuln > 0;
    for (const e of state.entities) {
      const def = spec.entities[e.kind] || {};
      const px = sx(e.x), py = sy(e.y), pw = e.w * tile, ph = e.h * tile;
      if (px + pw < 0 || py + ph < 0 || px > w || py > h) continue;
      if (e.tags.includes('player') && invuln && Math.floor(state.frame / 4) % 2) continue;
      if (def.glyph) {
        ctx.save();
        ctx.font = `${Math.round(Math.max(pw, ph) * 1.1)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
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
