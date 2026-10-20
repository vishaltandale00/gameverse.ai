// Out-of-battle screens drawn from view(state): dialogue with choices, the start menu, party,
// summary, bag, dex, the mart, the PC box, the evolution scene, the ending and transitions.
import { panel, text, typewriter, hpBar, expBar, typePill, statusTag, arrow, round, ease } from './draw.js';
import { light, shade } from '../../../art/color.js';

export function createScreens(game, bank, theme) {
  const { content } = game;
  const types = new Map(content.types.map(t => [t.id, t]));
  const typeName = id => types.get(id)?.name || id;
  const typeColor = id => types.get(id)?.color || '#a8a878';

  function dialogue(g, d, VW, VH, frame) {
    const h = 46, y = VH - h - 2;
    panel(g, theme, 3, y, VW - 6, h, { r: 5 });
    if (d.name) {
      g.font = `700 7px ${theme.family}`;
      const w = Math.max(40, g.measureText(d.name).width + 16);
      panel(g, theme, 8, y - 12, w, 15, { fill: theme.accentLight, r: 4 });
      text(g, theme, d.name, 16, y - 2, { size: 7, color: theme.accentDark });
    }
    typewriter(g, theme, d.text, d.shown, 14, y + 17, VW - 34, { size: 8.5, lineH: 12, maxLines: 3 });
    if (d.done && !d.choices && Math.floor(frame / 16) % 2) { g.fillStyle = theme.accent; g.beginPath(); const ax = VW - 16, ay = y + h - 10; g.moveTo(ax - 3.5, ay - 2.5); g.lineTo(ax + 3.5, ay - 2.5); g.lineTo(ax, ay + 2); g.closePath(); g.fill(); }
    if (d.choices) {
      g.font = `700 8px ${theme.family}`;
      const w = Math.min(VW - 20, Math.max(...d.choices.map(c => g.measureText(c).width)) + 26), ch = d.choices.length * 12 + 10;
      const x = VW - w - 6, cy = y - ch - 3;
      panel(g, theme, x, cy, w, ch, { r: 5 });
      d.choices.forEach((c, i) => { text(g, theme, c, x + 15, cy + 16 + i * 12, { size: 8 }); if (i === d.cursor) arrow(g, x + 7, cy + 13 + i * 12); });
    }
  }

  function banner(g, b, VW) {
    const t = b.t, k = t < 16 ? ease(t / 16) : t > 120 ? 1 - ease((t - 120) / 24) : 1;
    g.font = `800 8px ${theme.family}`;
    const w = g.measureText(b.text).width + 22;
    const y = -20 + k * 26;
    panel(g, theme, 6, y, w, 17, { r: 4 });
    text(g, theme, b.text, 17, y + 11.5, { size: 8, weight: 800 });
  }

  function listRows(g, x, y, w, rows, cursor, { lineH = 13, size = 8, max = 12 } = {}) {
    const start = Math.max(0, Math.min(cursor - max + 1, rows.length - max));
    rows.slice(start, start + max).forEach((r, i) => {
      const yy = y + i * lineH;
      text(g, theme, r[0], x + 12, yy, { size, max: r[1] ? w - 56 : w - 16, color: r[2] || theme.ink });
      if (r[1]) text(g, theme, r[1], x + w - 6, yy, { size: size - 0.5, align: 'right' });
      if (start + i === cursor) arrow(g, x + 3, yy - 3);
    });
  }

  function partyList(g, m, VW, VH, frame, title) {
    panel(g, theme, 4, 4, VW - 8, VH - 8, { fill: light(theme.accent, 0.82), r: 6 });
    text(g, theme, title, 14, 17, { size: 8.5, color: theme.accentDark });
    const rowH = Math.min(22, (VH - 34) / 6);
    m.party.forEach((c, i) => {
      const y = 24 + i * rowH, sel = i === (m.partyCursor ?? m.cursor), swap = i === m.swap;
      panel(g, theme, 10, y, VW - 20, rowH - 2, { fill: swap ? '#ffe8a8' : sel ? '#ffffff' : '#f0f0ea', inner: sel ? theme.accent : '#b8b8c0', r: 4 });
      bank.drawCreature(g, c.species, sel && Math.floor(frame / 15) % 2 ? 'idleB' : 'idle', 26, y + rowH - 3, rowH * 1.25, {});
      text(g, theme, c.name, 42, y + rowH * 0.42, { size: 8 });
      text(g, theme, `Lv${c.level}`, 42, y + rowH * 0.78, { size: 6.5, color: theme.muted });
      if (c.status) statusTag(g, theme, 72, y + rowH * 0.58, c.status);
      hpBar(g, theme, VW - 86, y + rowH * 0.3, 56, c.hp / Math.max(1, c.maxHp), { h: 3.2 });
      text(g, theme, `${c.hp}/${c.maxHp}`, VW - 30, y + rowH * 0.82, { size: 6.5, align: 'right' });
    });
  }

  function menu(g, m, VW, VH, frame) {
    const top = m.kind;
    if (top === 'start') {
      const w = 76, h = m.items.length * 13 + 12, x = VW - w - 4;
      panel(g, theme, x, 4, w, h, { r: 5 });
      listRows(g, x + 4, 18, w - 8, m.items.map(i => [i]), m.cursor);
      panel(g, theme, 4, 4, 86, 30, { r: 5 });
      text(g, theme, `₽ ${m.money}`, 12, 16, { size: 7.5 });
      text(g, theme, `Badges ${m.badges}`, 12, 27, { size: 7, color: theme.muted });
    } else if (top === 'party' || top === 'partyAction' || top === 'useOn') {
      partyList(g, m, VW, VH, frame, top === 'useOn' ? `Use the ${m.item} on…` : m.swap != null ? 'Move to where?' : 'Party');
      if (top === 'partyAction') { const w = 64, h = m.options.length * 12 + 10; panel(g, theme, VW - w - 10, VH - h - 10, w, h, { r: 5 }); listRows(g, VW - w - 6, VH - h + 5, w - 8, m.options.map(o => [o]), m.cursor, { lineH: 12, size: 7.5 }); }
    } else if (top === 'summary') summary(g, m.summary, VW, VH, frame);
    else if (top === 'bag') {
      panel(g, theme, 4, 4, VW - 8, VH - 8, { fill: '#f4ecd8', r: 6 });
      m.pockets.forEach((p, i) => { const x = 10 + i * 46; round(g, x, 9, 42, 12, 3); g.fillStyle = i === m.pocket ? theme.accent : '#d8ccb0'; g.fill(); text(g, theme, p, x + 21, 18, { size: 7, align: 'center', color: i === m.pocket ? '#ffffff' : theme.ink }); });
      text(g, theme, '◀ ▶', VW - 14, 18, { size: 6.5, align: 'right', color: theme.muted });
      panel(g, theme, 10, 25, VW - 20, VH - 74, { r: 4 });
      listRows(g, 14, 39, VW - 28, m.bag.length ? m.bag.map(b => [b.name, `×${b.n}`]) : [['Empty pocket', '']], m.bagCursor ?? m.cursor, { max: Math.floor((VH - 82) / 13) });
      panel(g, theme, 10, VH - 46, VW - 20, 38, { fill: '#283246', inner: theme.inner, border: '#141822', r: 4 });
      const cur = m.bag[m.bagCursor ?? m.cursor];
      if (cur) typewriter(g, theme, cur.description || '', 999, 18, VH - 31, VW - 40, { size: 7.5, lineH: 10.5, color: '#ffffff' });
    } else if (top === 'dex') {
      panel(g, theme, 4, 4, VW - 8, VH - 8, { fill: '#e8443a', inner: '#ffffff', border: '#8a1a1a', r: 6 });
      text(g, theme, 'DEX', 14, 17, { size: 9, color: '#ffffff' });
      const seen = m.dex.filter(e => e.seen).length, caught = m.dex.filter(e => e.caught).length;
      text(g, theme, `Seen ${seen}  Caught ${caught}`, VW - 14, 17, { size: 7, align: 'right', color: '#ffffff' });
      const lw = VW * 0.52;
      panel(g, theme, 10, 23, lw, VH - 33, { r: 4 });
      listRows(g, 14, 37, lw - 8, m.dex.map(e => [`${String(e.n).padStart(3, '0')} ${e.name}`, e.caught ? '●' : e.seen ? '○' : '', e.seen ? theme.ink : theme.muted]), m.cursor, { lineH: 11, size: 7, max: Math.floor((VH - 44) / 11) });
      const e = m.dex[m.cursor];
      panel(g, theme, lw + 14, 23, VW - lw - 24, VH - 33, { fill: '#f0f4f8', r: 4 });
      if (e?.seen) {
        bank.drawCreature(g, e.id, Math.floor(frame / 30) % 2 ? 'idleB' : 'idle', lw + 14 + (VW - lw - 24) / 2, 23 + (VH - 33) * 0.55, Math.min(64, VH * 0.4), { silhouette: e.caught ? null : '#3a3a48' });
        e.types.forEach((t, i) => typePill(g, theme, lw + 20 + i * 34, VH - 40, typeName(t), typeColor(t), { w: 32 }));
        if (e.dex) typewriter(g, theme, e.dex, 999, lw + 20, VH - 24, VW - lw - 36, { size: 6.5, lineH: 8.5, maxLines: 2 });
      } else text(g, theme, '???', lw + 14 + (VW - lw - 24) / 2, VH / 2, { size: 12, align: 'center', color: theme.muted });
    }
    if (m.message) {
      const h = 40, y = VH - h - 4;
      panel(g, theme, 4, y, VW - 8, h, { r: 5 });
      typewriter(g, theme, m.message, 999, 14, y + 16, VW - 30, { size: 8, lineH: 11.5 });
    }
  }

  function summary(g, s, VW, VH, frame) {
    panel(g, theme, 4, 4, VW - 8, VH - 8, { fill: light(typeColor(s.types[0]), 0.7), r: 6 });
    const lw = Math.min(110, VW * 0.4);
    panel(g, theme, 10, 10, lw, VH - 20, { fill: '#ffffff', r: 5 });
    bank.drawCreature(g, s.species, Math.floor(frame / 30) % 2 ? 'idleB' : 'idle', 10 + lw / 2, 10 + (VH - 20) * 0.62, Math.min(78, lw * 0.75), {});
    text(g, theme, s.name, 18, 24, { size: 9 });
    text(g, theme, `Lv${s.level}`, 8 + lw, 24, { size: 7.5, align: 'right' });
    s.typeNames.forEach((n, i) => typePill(g, theme, 18 + i * 34, 30, n, typeColor(s.types[i]), { w: 32 }));
    if (s.status) statusTag(g, theme, 18, VH - 34, s.status);
    hpBar(g, theme, 30, VH - 24, lw - 30, s.hp / Math.max(1, s.maxHp), { h: 3 });
    text(g, theme, `${s.hp}/${s.maxHp}`, 8 + lw, VH - 15, { size: 6.5, align: 'right' });
    const rx = 18 + lw, rw = VW - rx - 10;
    panel(g, theme, rx, 10, rw, 66, { r: 5 });
    const names = [['atk', 'Attack'], ['def', 'Defense'], ['spa', 'Sp. Atk'], ['spd', 'Sp. Def'], ['spe', 'Speed']];
    names.forEach(([k, n], i) => { text(g, theme, n, rx + 8, 22 + i * 10, { size: 7 }); text(g, theme, String(s.stats[k]), rx + rw - 8, 22 + i * 10, { size: 7, align: 'right' }); });
    text(g, theme, 'EXP', rx + 8, 72, { size: 5.5, color: '#4ab0f0', weight: 800 });
    expBar(g, rx + 22, 70.4, rw - 32, (s.bar.now - s.bar.from) / Math.max(1, s.bar.to - s.bar.from));
    panel(g, theme, rx, 79, rw, VH - 89, { r: 5 });
    s.moves.forEach((mv, i) => {
      const y = 91 + i * 12;
      g.fillStyle = typeColor(mv.type); g.beginPath(); g.arc(rx + 9, y - 2.5, 2, 0, Math.PI * 2); g.fill();
      text(g, theme, mv.name, rx + 14, y, { size: 7, max: rw - 50 });
      text(g, theme, `${mv.pp}/${mv.max}`, rx + rw - 8, y, { size: 6.5, align: 'right', color: theme.muted });
    });
    text(g, theme, '◀ ▶', VW - 14, VH - 10, { size: 6, align: 'right', color: theme.muted });
  }

  function shop(g, s, VW, VH) {
    panel(g, theme, 4, 4, 92, 30, { r: 5 });
    text(g, theme, `₽ ${s.money}`, 12, 16, { size: 7.5 });
    text(g, theme, s.tab ? 'SELL  ◀▶' : 'BUY  ◀▶', 12, 27, { size: 6.5, color: theme.muted });
    const w = Math.min(170, VW * 0.62), x = VW - w - 4, h = VH - 56;
    panel(g, theme, x, 4, w, h, { r: 5 });
    listRows(g, x + 4, 19, w - 8, s.rows.length ? s.rows.map(r => [r.name, `₽${r.price}`]) : [['Nothing to sell', '']], s.cursor, { max: Math.floor((h - 18) / 13) });
    panel(g, theme, 4, VH - 48, VW - 8, 44, { fill: '#283246', inner: theme.inner, border: '#141822', r: 5 });
    const cur = s.rows[s.cursor];
    const msg = s.message || (cur ? `${cur.description || ''} (You have ${cur.have}.)` : '');
    typewriter(g, theme, msg, 999, 14, VH - 31, VW - 30, { size: 7.5, lineH: 11, color: '#ffffff' });
  }

  function pc(g, s, VW, VH) {
    panel(g, theme, 4, 4, VW - 8, VH - 8, { fill: '#d8e4f0', r: 6 });
    const cw = (VW - 24) / 2;
    [['PARTY', s.party], ['BOX', s.box]].forEach(([title, list], col) => {
      const x = 10 + col * (cw + 4);
      panel(g, theme, x, 10, cw, VH - 62, { r: 4, inner: col === s.col ? theme.accent : '#a8b0c0' });
      text(g, theme, `${title} (${list.length})`, x + 8, 22, { size: 7, color: theme.muted });
      listRows(g, x + 2, 35, cw - 4, list.map(c => [c.name, `Lv${c.level}`]), col === s.col ? s.cursor : -1, { lineH: 11, size: 7, max: Math.floor((VH - 84) / 11) });
    });
    panel(g, theme, 4, VH - 48, VW - 8, 44, { fill: '#283246', inner: theme.inner, border: '#141822', r: 5 });
    typewriter(g, theme, s.message || (s.col === 0 ? 'A: store in the box. ◀▶ switch columns. B: log off.' : 'A: take into your party. ◀▶ switch columns. B: log off.'), 999, 14, VH - 31, VW - 30, { size: 7.5, lineH: 11, color: '#ffffff' });
  }

  function evolution(g, e, VW, VH, frame) {
    const grad = g.createRadialGradient(VW / 2, VH * 0.42, 4, VW / 2, VH * 0.42, VW * 0.6);
    grad.addColorStop(0, '#3a3a68'); grad.addColorStop(1, '#0a0a18');
    g.fillStyle = grad; g.fillRect(0, 0, VW, VH);
    const cx = VW / 2, foot = VH * 0.62, size = Math.min(90, VH * 0.5);
    if (e.phase === 'morph') {
      // Alternate silhouettes, faster as it goes, then a white flash.
      const p = e.t / e.dur, period = Math.max(2, 22 - p * 20);
      const showNew = Math.floor(e.t / period) % 2 === 1;
      const pulse = 1 + Math.sin(e.t * 0.3) * 0.04;
      bank.drawCreature(g, showNew ? e.to : e.from, 'idle', cx, foot, size * pulse, { silhouette: '#e8f0ff' });
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + e.t * 0.05, r = 30 + ((e.t * 1.5 + i * 13) % 60); g.fillStyle = `rgba(200,220,255,${0.8 - r / 100})`; g.beginPath(); g.arc(cx + Math.cos(a) * r, foot - size * 0.4 + Math.sin(a) * r * 0.7, 1.6, 0, Math.PI * 2); g.fill(); }
      if (p > 0.9) { g.fillStyle = `rgba(255,255,255,${(p - 0.9) * 10})`; g.fillRect(0, 0, VW, VH); }
    } else {
      const sp = e.phase === 'done' ? e.to : e.from;
      bank.drawCreature(g, sp, Math.floor(frame / 30) % 2 ? 'idleB' : 'idle', cx, foot, size, {});
      if (e.phase === 'done' && e.t < 20) { g.fillStyle = `rgba(255,255,255,${1 - e.t / 20})`; g.fillRect(0, 0, VW, VH); }
    }
    panel(g, theme, 3, VH - 46, VW - 6, 43, { fill: '#283246', inner: theme.inner, border: '#141822', r: 5 });
    typewriter(g, theme, e.text, 999, 14, VH - 29, VW - 30, { size: 8.5, lineH: 12, color: '#ffffff' });
    if (e.phase === 'morph') text(g, theme, 'B: stop', VW - 12, VH - 9, { size: 6, align: 'right', color: '#a8b0c8' });
  }

  function ending(g, e, VW, VH, frame) {
    const grad = g.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#1a1438'); grad.addColorStop(1, '#4a2a68');
    g.fillStyle = grad; g.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 40; i++) { const x = (i * 53 + frame * 0.2 * (1 + i % 3)) % VW, y = (i * 37) % (VH * 0.7); g.fillStyle = `rgba(255,255,220,${0.3 + (i % 5) * 0.12})`; g.fillRect(x, y, 1, 1); }
    text(g, theme, 'HALL OF FAME', VW / 2, 22, { size: 12, align: 'center', color: '#f8d860', weight: 800, shadow: 'rgba(0,0,0,.5)' });
    text(g, theme, `${e.player} — Champion of ${e.title}`, VW / 2, 34, { size: 7.5, align: 'center', color: '#ffffff' });
    const n = e.party.length, gap = Math.min(52, (VW - 20) / Math.max(1, n));
    e.party.forEach((c, i) => {
      const k = ease((e.t - i * 12) / 30);
      if (k <= 0) return;
      const x = VW / 2 - (n - 1) * gap / 2 + i * gap;
      bank.drawCreature(g, c.species, Math.floor((frame + i * 9) / 24) % 2 ? 'idleB' : 'idle', x, VH * 0.66 + (1 - k) * 30, Math.min(48, gap * 1.1), { alpha: k });
      text(g, theme, c.name, x, VH * 0.66 + 10, { size: 6, align: 'center', color: '#ffffff' });
      text(g, theme, `Lv${c.level}`, x, VH * 0.66 + 18, { size: 5.5, align: 'center', color: '#c8c0e8' });
    });
    if (e.t > 60) text(g, theme, `Badges ${e.badges} · Creatures caught ${e.caught}`, VW / 2, VH - 22, { size: 7, align: 'center', color: '#e8e0ff' });
    if (e.t > 150 && Math.floor(frame / 20) % 2) text(g, theme, 'Press A', VW / 2, VH - 9, { size: 7, align: 'center', color: '#f8d860' });
  }

  /** Battle intro wipes: a flash, then bars (trainers) or a spiral (wild). */
  function transition(g, tr, VW, VH, reduced) {
    const t = tr.t / tr.dur;
    if (t < 0.35) {
      const flash = Math.floor(tr.t / 4) % 2 && !reduced;
      if (flash) { g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(0, 0, VW, VH); }
      return;
    }
    const k = ease((t - 0.35) / 0.6);
    g.fillStyle = '#101018';
    if (tr.kind === 'trainer') {
      const n = 8;
      for (let i = 0; i < n; i++) { const h = VH / n; const w = VW * k; g.fillRect(i % 2 ? VW - w : 0, i * h, w, h + 0.5); }
    } else {
      g.beginPath(); g.moveTo(VW / 2, VH / 2);
      g.arc(VW / 2, VH / 2, VW, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.closePath(); g.fill();
    }
  }

  return { dialogue, banner, menu, shop, pc, evolution, ending, transition };
}
