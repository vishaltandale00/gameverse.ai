// Battle scene: backdrop and platforms, trainer and creature slide-ins, HP bars that drain and
// change color, the EXP bar, a typewriter text box, the Fight/Bag/Party/Run and move menus, move
// effects by type, catch throws and shakes, faints, the level-up panel and learn prompts.
// Everything animates from view(state).battle; local state only smooths bars and particles.
import { panel, text, typewriter, hpBar, expBar, typePill, statusTag, arrow, round, ease, wrap } from './draw.js';
import { light, shade, mix, hex } from '../../../art/color.js';

const STYLE = [
  ['fire', /fire|ember|flame|heat|lava|burn|blaze|magma/], ['water', /water|tide|aqua|sea|wave|rain|ocean|bubble/],
  ['grass', /leaf|grass|plant|vine|seed|flora|bloom|bug|insect/], ['electric', /spark|electric|volt|thunder|bolt|static|lightning/],
  ['rock', /stone|rock|earth|ground|boulder|metal|steel/], ['wind', /gust|wind|air|sky|feather|fly|storm/], ['ice', /ice|frost|snow|cold/],
  ['ghost', /ghost|spirit|psy|mind|dream|shadow|dark|void|cosmic/], ['poison', /poison|toxic|venom|acid|sludge/],
];

export function createBattleScene(game, bank, theme, art) {
  const { content } = game;
  const types = new Map(content.types.map(t => [t.id, t]));
  const styleOf = id => { const t = types.get(id); const s = `${id || ''} ${t?.name || ''} ${t?.look || ''}`.toLowerCase(); return (STYLE.find(([, re]) => re.test(s)) || ['normal'])[0]; };
  const colorOf = id => hex(types.get(id)?.color, '#c8c0a8');
  let bg = null;
  if (art?.background && typeof Image !== 'undefined') { bg = new Image(); bg.src = art.background; }
  const anim = { hp: {}, exp: null, beatKey: null, beatStart: 0 };

  function smooth(side, c, dt) {
    if (!c) return 0;
    let a = anim.hp[side];
    if (!a || a.uid !== c.uid) a = anim.hp[side] = { uid: c.uid, v: c.hp };
    const rate = Math.max(1, c.maxHp) * 1.1 * dt;
    a.v = a.v > c.hp ? Math.max(c.hp, a.v - rate) : Math.min(c.hp, a.v + rate);
    return a.v;
  }
  function smoothExp(bv, dt) {
    const e = bv.exp, c = bv.player;
    if (!e || !c) return 0;
    const target = Math.max(0, Math.min(1, (e.now - e.from) / Math.max(1, e.to - e.from)));
    let a = anim.exp;
    if (!a || a.uid !== c.uid) a = anim.exp = { uid: c.uid, v: target, level: c.level };
    if (a.level !== c.level) { a.level = c.level; a.v = 0; }
    a.v = Math.min(target, a.v + dt * 0.9);
    if (a.v > target) a.v = target;
    return a.v;
  }

  function drawBall(g, x, y, r, rot = 0, closed = 1) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = '#2a2a38'; g.beginPath(); g.arc(0, 0, r + 0.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.fill();
    g.fillStyle = mix(theme.accent, '#e04a4a', 0.5); g.beginPath(); g.arc(0, 0, r, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2a38'; g.fillRect(-r, -0.6, r * 2, 1.2);
    g.fillStyle = closed ? '#ffffff' : '#f8e070'; g.beginPath(); g.arc(0, 0, r * 0.32, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2a38'; g.lineWidth = 0.6; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(-r * 0.4, -r * 0.45, r * 0.22, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function sparkle(g, x, y, s, color = '#fff8c0') {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.25, y - s * 0.25); g.lineTo(x + s, y); g.lineTo(x + s * 0.25, y + s * 0.25);
    g.lineTo(x, y + s); g.lineTo(x - s * 0.25, y + s * 0.25); g.lineTo(x - s, y); g.lineTo(x - s * 0.25, y - s * 0.25); g.closePath(); g.fill();
  }

  /** Move effects drawn procedurally from the move's type style and time. */
  function moveFx(g, fx, from, to, reduced) {
    const t = fx.t, style = styleOf(fx.moveType), c = colorOf(fx.moveType), cl = light(c, 0.35);
    if (fx.category === 'status') {
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + t * 0.15, rr = 14 + Math.sin(t * 0.3 + i) * 3; sparkle(g, from.x + Math.cos(a) * rr, from.y - 18 + Math.sin(a) * rr * 0.6, 2.4, i % 2 ? cl : '#ffffff'); }
      return;
    }
    const k = Math.max(0, Math.min(1, (t - 6) / 16));
    const px = from.x + (to.x - from.x) * k, py = from.y - 16 + (to.y - from.y) * k - Math.sin(k * Math.PI) * 12;
    if (t < 6 || t > 30) return;
    g.save();
    switch (style) {
      case 'fire': for (let i = 0; i < 5; i++) { const q = Math.max(0, k - i * 0.06); const x = from.x + (to.x - from.x) * q, y = from.y - 16 + (to.y - from.y) * q - Math.sin(q * Math.PI) * 12; g.fillStyle = i % 2 ? '#ffd040' : '#ff6a20'; g.globalAlpha = 1 - i * 0.15; g.beginPath(); g.arc(x, y, 5 - i * 0.7, 0, Math.PI * 2); g.fill(); } break;
      case 'water': case 'poison': for (let i = 0; i < 6; i++) { const q = Math.max(0, k - i * 0.07); const x = from.x + (to.x - from.x) * q + Math.sin(i * 2 + t * 0.4) * 3, y = from.y - 16 + (to.y - from.y) * q; g.strokeStyle = style === 'water' ? '#e8f8ff' : '#e0b0ff'; g.fillStyle = style === 'water' ? 'rgba(90,180,255,.55)' : 'rgba(160,70,200,.55)'; g.beginPath(); g.arc(x, y, 3 + (i % 3), 0, Math.PI * 2); g.fill(); g.lineWidth = 0.8; g.stroke(); } break;
      case 'grass': for (let i = 0; i < 5; i++) { const q = Math.max(0, k - i * 0.08); const x = from.x + (to.x - from.x) * q, y = from.y - 16 + (to.y - from.y) * q + Math.sin(i + t * 0.5) * 5; g.save(); g.translate(x, y); g.rotate(t * 0.4 + i); g.fillStyle = i % 2 ? '#5ac85a' : '#9ae86a'; g.beginPath(); g.ellipse(0, 0, 4, 1.8, 0, 0, Math.PI * 2); g.fill(); g.restore(); } break;
      case 'electric': { if (Math.floor(t / 2) % 2 && !reduced) break; g.strokeStyle = '#fff070'; g.lineWidth = 2; g.beginPath(); g.moveTo(from.x, from.y - 16); for (let i = 1; i <= 6; i++) { const q = i / 6; g.lineTo(from.x + (to.x - from.x) * q + (i % 2 ? 4 : -4), from.y - 16 + (to.y - from.y) * q + (i % 2 ? -5 : 5)); } g.stroke(); g.strokeStyle = '#ffffff'; g.lineWidth = 0.8; g.stroke(); break; }
      case 'rock': for (let i = 0; i < 4; i++) { const fall = Math.min(1, Math.max(0, (t - 8 - i * 3) / 10)); g.fillStyle = i % 2 ? '#a08858' : '#7a6a48'; g.beginPath(); g.arc(to.x - 12 + i * 8, to.y - 50 + fall * 40, 3.5 + (i % 2), 0, Math.PI * 2); g.fill(); } break;
      case 'wind': for (let i = 0; i < 3; i++) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.4; g.beginPath(); g.arc(to.x, to.y - 18, 8 + i * 5, t * 0.3 + i, t * 0.3 + i + 2.2); g.stroke(); } break;
      case 'ice': for (let i = 0; i < 5; i++) { const q = Math.max(0, k - i * 0.06); const x = from.x + (to.x - from.x) * q, y = from.y - 16 + (to.y - from.y) * q; g.fillStyle = i % 2 ? '#d8f4ff' : '#8ad8f8'; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 2, y); g.lineTo(x, y + 4); g.lineTo(x - 2, y); g.closePath(); g.fill(); } break;
      case 'ghost': for (let i = 0; i < 4; i++) { const q = Math.max(0, k - i * 0.09); g.fillStyle = `rgba(90,50,140,${0.8 - i * 0.15})`; g.beginPath(); g.arc(from.x + (to.x - from.x) * q, from.y - 16 + (to.y - from.y) * q, 5 - i * 0.6, 0, Math.PI * 2); g.fill(); } break;
      default:
        if (fx.category === 'physical') { if (t > 10 && t < 22) { const s = 6 + (t - 10); sparkle(g, to.x, to.y - 20, s, '#fff8c0'); sparkle(g, to.x, to.y - 20, s * 0.55, '#ffffff'); } }
        else { g.fillStyle = cl; g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 2, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  function backdrop(g, VW, boxY, mapView) {
    const kind = mapView?.kind;
    if (bg?.complete && bg.naturalWidth) {
      const s = Math.max(VW / bg.naturalWidth, boxY / bg.naturalHeight);
      const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
      g.drawImage(bg, (VW - w) / 2, boxY - h, w, h);
    } else {
      const grad = g.createLinearGradient(0, 0, 0, boxY);
      grad.addColorStop(0, '#8ad0f8'); grad.addColorStop(0.6, '#d8f0ff'); grad.addColorStop(1, '#a8d890');
      g.fillStyle = grad; g.fillRect(0, 0, VW, boxY);
    }
    if (kind === 'cave') { g.fillStyle = 'rgba(30,20,40,.55)'; g.fillRect(0, 0, VW, boxY); }
    else if (kind === 'gym' || kind === 'league' || kind === 'interior') { g.fillStyle = 'rgba(240,230,210,.45)'; g.fillRect(0, 0, VW, boxY); g.fillStyle = 'rgba(60,40,30,.12)'; for (let x = 0; x < VW; x += 24) g.fillRect(x, 0, 1, boxY); }
    // Ground band.
    const ground = kind === 'cave' ? '#5a4a40' : kind === 'gym' || kind === 'league' || kind === 'interior' ? '#c8b898' : '#78c060';
    const grad = g.createLinearGradient(0, boxY * 0.45, 0, boxY);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.35, mix(ground, '#ffffff', 0.15)); grad.addColorStop(1, ground);
    g.fillStyle = grad; g.fillRect(0, boxY * 0.45, VW, boxY * 0.55);
    return ground;
  }

  function platform(g, x, y, rx, ry, ground) {
    g.fillStyle = shade(ground, 0.3); g.beginPath(); g.ellipse(x, y + 1.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = light(ground, 0.12); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = light(ground, 0.3); g.beginPath(); g.ellipse(x - rx * 0.15, y - ry * 0.25, rx * 0.6, ry * 0.45, 0, 0, Math.PI * 2); g.fill();
  }

  function infoBox(g, c, x, y, w, hp, isPlayer, expFrac) {
    const h = isPlayer ? 34 : 26;
    panel(g, theme, x, y, w, h, { r: 5 });
    text(g, theme, c.name, x + 7, y + 11, { size: 8 });
    text(g, theme, `Lv${c.level}`, x + w - 7, y + 11, { size: 7, align: 'right' });
    if (c.status) statusTag(g, theme, x + 7, y + 15, c.status);
    hpBar(g, theme, x + w - 62, y + 16.5, 54, hp / Math.max(1, c.maxHp));
    if (isPlayer) {
      text(g, theme, `${Math.ceil(hp)}/${c.maxHp}`, x + w - 8, y + 28, { size: 6.5, align: 'right' });
      text(g, theme, 'EXP', x + 7, y + 30, { size: 4.5, color: '#4ab0f0', weight: 800 });
      expBar(g, x + 19, y + 28.6, w * 0.38, expFrac);
    }
  }

  function render(g, bv, VW, VH, dt, reduced, mapView) {
    if (bv.frame < (anim.lastFrame ?? Infinity)) { anim.heroGone = false; anim.hp = {}; anim.exp = null; }
    anim.lastFrame = bv.frame;
    const boxH = 46, boxY = VH - boxH;
    const shake = !reduced && bv.shake ? Math.sin(bv.frame * 2.3) * bv.shake * 0.35 : 0;
    g.fillStyle = '#141822'; g.fillRect(0, 0, VW, VH);
    g.save(); g.translate(shake, 0);
    const ground = backdrop(g, VW, boxY, mapView);
    const foeX = VW * 0.71, foeY = boxY * 0.6, plX = VW * 0.27, plY = boxY + 6;
    const foeSize = Math.min(64, boxY * 0.56), plSize = foeSize * 1.12;
    platform(g, foeX, foeY, VW * 0.17, 8, ground);
    platform(g, plX, boxY - 2, VW * 0.22, 10, ground);
    const b = bv.beat, bt = b?.t || 0;
    const intro = ease(bv.frame / 34);
    const fx = bv.fx;

    // Foe side: trainer, creature, ball.
    const foeIn = foeX - (1 - intro) * VW * 0.9;
    if (bv.trainer && (bv.trainerOut || (b?.kind === 'switch' && b.side === 'foe' && bt < 20))) {
      const leave = b?.kind === 'switch' && b.side === 'foe' ? ease(bt / 18) * VW * 0.45 : 0;
      const kindOf = bv.trainer.sprite === 'rival' ? 'rival' : bv.trainer.sprite === 'champion' ? 'champion' : 'trainer';
      bank.drawPerson(g, { kind: kindOf, id: `battle:${bv.trainer.name}`, desc: bv.trainer.look, facing: 'left', walking: false, frame: bv.frame, scale: 2.4 }, foeIn + leave, foeY + 2);
    }
    if (bv.foe && bv.foeShown && !(bv.foe.fainted && !(b?.kind === 'faint' && b.side === 'foe'))) {
      let alpha = 1, dy = 0, white = 0, scale = 1;
      if (b?.kind === 'switch' && b.side === 'foe') { scale = ease(bt / 14); white = 1 - bt / 14; }
      if (b?.kind === 'faint' && b.side === 'foe') { dy = ease(bt / 24) * 26; alpha = 1 - ease(bt / 28); }
      if (b?.kind === 'damage' && b.side === 'foe' && bt < 24 && Math.floor(bt / 3) % 2) alpha = 0.15;
      if (fx?.kind === 'throw' && fx.t > 24) { white = Math.min(1, (fx.t - 24) / 6); scale = Math.max(0.05, 1 - (fx.t - 24) / 10); }
      const lunge = fx?.kind === 'move' && fx.side === 'foe' && fx.category === 'physical' && fx.t < 14 ? Math.sin(fx.t / 14 * Math.PI) * -10 : 0;
      const pose = b?.kind === 'damage' && b.side === 'foe' && bt < 20 ? 'hurt' : fx?.kind === 'move' && fx.side === 'foe' && fx.t < 14 ? 'jump' : (Math.floor(bv.frame / 30) % 2 ? 'idleB' : 'idle');
      if (!bv.inBall || (fx?.kind === 'throw' && fx.t <= 34)) {
        g.save(); g.beginPath(); g.rect(0, 0, VW, foeY + 2); g.clip();
        bank.drawCreature(g, bv.foe.species, pose, foeIn + lunge, foeY + dy, foeSize * scale, { flip: true, alpha, white });
        g.restore();
      }
    }
    if (bv.inBall && !(fx?.kind === 'throw' && fx.t <= 30)) {
      const wob = b?.kind === 'shake' ? Math.sin(bt / 34 * Math.PI * 2) * 0.45 : 0;
      drawBall(g, foeX, foeY - 4, 5, wob, b?.kind !== 'capture' || b.ev?.success);
      if (b?.kind === 'capture' && b.ev?.success) for (let i = 0; i < 3; i++) sparkle(g, foeX - 10 + i * 10, foeY - 16 - Math.sin(bt / 8 + i) * 4, 3, '#fff8a0');
    }
    if (b?.kind === 'capture' && !b.ev?.success && bt < 14) { g.fillStyle = `rgba(255,255,255,${1 - bt / 14})`; g.beginPath(); g.arc(foeX, foeY - 12, 8 + bt * 2, 0, Math.PI * 2); g.fill(); }
    if (fx?.kind === 'throw' && fx.t <= 30) {
      const k = Math.min(1, fx.t / 24);
      drawBall(g, plX + (foeX - plX) * k, plY - 50 + (foeY - 4 - (plY - 50)) * k - Math.sin(k * Math.PI) * 34, 4.5, fx.t * 0.5, 1);
    }

    // Player side: hero back, then the creature.
    const plIn = plX + (1 - intro) * VW * 0.9;
    // The hero stands in until the first send-out, then steps aside.
    const heroLeaving = b?.kind === 'switch' && b.side === 'player' && !anim.heroGone;
    if (heroLeaving && bt >= 16) anim.heroGone = true;
    if (!anim.heroGone && (!bv.player || heroLeaving)) {
      const leave = heroLeaving ? -ease(bt / 16) * VW * 0.5 : 0;
      bank.drawPerson(g, { kind: 'player', id: 'battle:hero', facing: 'up', walking: false, frame: bv.frame, scale: 3.2 }, plIn + leave, plY + 12);
    }
    if (bv.player && !(bv.player.fainted && !(b?.kind === 'faint' && b.side === 'player'))) {
      let alpha = 1, dy = 0, white = 0, scale = 1;
      if (b?.kind === 'switch' && b.side === 'player') { scale = ease(Math.max(0, bt - 8) / 12); white = 1 - Math.max(0, bt - 8) / 12; }
      if (b?.kind === 'faint' && b.side === 'player') { dy = ease(bt / 24) * 34; alpha = 1 - ease(bt / 28); }
      if (b?.kind === 'damage' && b.side === 'player' && bt < 24 && Math.floor(bt / 3) % 2) alpha = 0.15;
      const lunge = fx?.kind === 'move' && fx.side === 'player' && fx.category === 'physical' && fx.t < 14 ? Math.sin(fx.t / 14 * Math.PI) * 12 : 0;
      const pose = b?.kind === 'damage' && b.side === 'player' && bt < 20 ? 'hurt' : fx?.kind === 'move' && fx.side === 'player' && fx.t < 14 ? 'jump' : (Math.floor(bv.frame / 34) % 2 ? 'idleB' : 'idle');
      g.save(); g.beginPath(); g.rect(0, 0, VW, boxY); g.clip();
      bank.drawCreature(g, bv.player.species, pose, plIn + lunge, plY + dy + 2, plSize * scale, { back: true, alpha, white });
      g.restore();
    }
    // Move and hit effects.
    if (fx?.kind === 'move') {
      const from = fx.side === 'player' ? { x: plX + 10, y: plY - 14 } : { x: foeX, y: foeY };
      const to = fx.side === 'player' ? { x: foeX, y: foeY } : { x: plX + 10, y: plY - 14 };
      moveFx(g, fx, from, to, reduced);
    }
    if (fx?.kind === 'hit' && fx.t < 12) {
      const at = fx.side === 'foe' ? { x: foeX, y: foeY - foeSize * 0.4 } : { x: plX + 10, y: plY - plSize * 0.35 };
      const s = 4 + fx.t * (fx.eff > 1 ? 1.4 : 0.9);
      sparkle(g, at.x, at.y, s, fx.crit ? '#ffe060' : '#ffffff');
    }
    if (b?.kind === 'heal' || (b?.kind === 'stat' && b.ev?.stages)) {
      const at = b.side === 'foe' ? { x: foeX, y: foeY } : { x: plX + 10, y: plY - 10 };
      const up = b.kind === 'heal' || b.ev.stages > 0;
      for (let i = 0; i < 6; i++) {
        const yy = at.y - ((bt * 1.2 + i * 9) % 44) * (up ? 1 : -1) - (up ? 0 : 44);
        if (b.kind === 'heal') sparkle(g, at.x - 15 + i * 6, yy, 2.2, '#a8ffb0');
        else { g.fillStyle = up ? 'rgba(255,120,80,.75)' : 'rgba(90,140,255,.75)'; g.beginPath(); const x = at.x - 15 + i * 6; g.moveTo(x, yy + (up ? -4 : 4)); g.lineTo(x + 3, yy); g.lineTo(x - 3, yy); g.closePath(); g.fill(); }
      }
    }
    if (b?.kind === 'status' && b.ev?.status && bt < 30 && !b.ev.blocked) {
      const at = b.side === 'foe' ? { x: foeX, y: foeY - 20 } : { x: plX + 10, y: plY - 30 };
      const col = { burn: '#ff7030', poison: '#b05ad8', paralysis: '#f8e040', sleep: '#c8d0f0', freeze: '#a8e8ff', confusion: '#ff90c0' }[b.ev.status] || '#ffffff';
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + bt * 0.12; g.fillStyle = col; g.globalAlpha = 1 - bt / 30; g.beginPath(); g.arc(at.x + Math.cos(a) * (8 + bt * 0.5), at.y + Math.sin(a) * (5 + bt * 0.3), 2.2, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }

    // Info boxes slide in with their creatures.
    if (bv.foe && bv.foeShown && !bv.foe.fainted) infoBox(g, bv.foe, 6 - (1 - intro) * 140, 8, Math.min(122, VW * 0.44), smooth('foe', bv.foe, dt), false);
    if (bv.player && !bv.player.fainted) infoBox(g, bv.player, VW - Math.min(128, VW * 0.46) - 6 + (1 - intro) * 140, boxY - 40, Math.min(128, VW * 0.46), smooth('player', bv.player, dt), true, smoothExp(bv, dt));
    g.restore();

    // Text box and menus.
    const dark = { fill: '#283246', inner: theme.inner, border: '#141822' };
    if (bv.phase === 'beats') {
      panel(g, theme, 2, boxY + 1, VW - 4, boxH - 3, { ...dark, r: 5 });
      if (b?.text) {
        typewriter(g, theme, b.text, b.shown, 12, boxY + 17, VW - 30, { size: 8.5, lineH: 12, color: '#ffffff', maxLines: 3 });
        if (b.shown >= b.text.length && (b.press || Math.floor(bv.frame / 16) % 2)) { g.fillStyle = '#f0c040'; g.beginPath(); const ax = VW - 16, ay = boxY + boxH - 13; g.moveTo(ax - 3, ay - 2); g.lineTo(ax + 3, ay - 2); g.lineTo(ax, ay + 2); g.closePath(); g.fill(); }
      }
    } else if (bv.phase === 'menu') {
      panel(g, theme, 2, boxY + 1, VW - 4, boxH - 3, { ...dark, r: 5 });
      typewriter(g, theme, `What will ${bv.player?.name || 'you'} do?`, 99, 12, boxY + 19, VW * 0.5 - 16, { size: 8.5, lineH: 12, color: '#ffffff' });
      const mw = Math.min(124, VW * 0.48), mx = VW - mw - 3;
      panel(g, theme, mx, boxY + 1, mw, boxH - 3, { r: 5 });
      bv.menu.forEach((m, i) => {
        const x = mx + 14 + (i % 2) * (mw / 2 - 4), y = boxY + 18 + Math.floor(i / 2) * 15;
        text(g, theme, m, x, y, { size: 8.5 });
        if (i === bv.cursor) arrow(g, x - 8, y - 3);
      });
    } else if (bv.phase === 'moves') {
      const iw = Math.min(84, VW * 0.3);
      panel(g, theme, 2, boxY + 1, VW - iw - 6, boxH - 3, { r: 5 });
      panel(g, theme, VW - iw - 2, boxY + 1, iw, boxH - 3, { r: 5 });
      const cw = (VW - iw - 14) / 2;
      bv.moves.forEach((m, i) => {
        const x = 16 + (i % 2) * cw, y = boxY + 18 + Math.floor(i / 2) * 15;
        g.fillStyle = m.color; g.beginPath(); g.arc(x - 2, y - 3, 1.8, 0, Math.PI * 2); g.fill();
        text(g, theme, m.name, x + 2, y, { size: 7.5, color: m.pp > 0 ? theme.ink : theme.muted, max: cw - 12 });
        if (i === bv.sub) arrow(g, x - 10, y - 3);
      });
      const m = bv.moves[bv.sub];
      if (m) {
        text(g, theme, 'PP', VW - iw + 8, boxY + 17, { size: 7 });
        text(g, theme, `${m.pp}/${m.max}`, VW - 10, boxY + 17, { size: 7.5, align: 'right', color: m.pp === 0 ? '#e84a3a' : m.pp <= m.max / 4 ? '#e8902a' : theme.ink });
        typePill(g, theme, VW - iw + 8, boxY + 23, m.typeName, m.color, { w: iw - 18 });
        text(g, theme, m.power ? `${m.category === 'physical' ? 'PHY' : 'SPC'} ${m.power}` : 'STATUS', VW - iw + 8, boxY + 39, { size: 6, color: theme.muted });
      }
    } else {
      panel(g, theme, 2, boxY + 1, VW - 4, boxH - 3, { ...dark, r: 5 });
      const prompt = bv.phase === 'bag' ? (bv.bag[bv.sub]?.description || 'Your bag is empty.') : bv.phase === 'learn' ? `Forget a move so ${bv.learn?.name} can learn ${bv.learn?.move}? B: don't learn.` : bv.phase === 'target' ? `Use the ${bv.item} on which creature?` : bv.forced ? 'Choose who to send out next.' : 'Choose a creature.';
      typewriter(g, theme, prompt, 999, 12, boxY + 17, VW - 30, { size: 8, lineH: 11.5, color: '#ffffff' });
    }
    if (bv.phase === 'bag') listPanel(g, VW - Math.min(150, VW * 0.56) - 4, 4, Math.min(150, VW * 0.56), boxY - 8, bv.bag.length ? bv.bag.map(e => [e.name, `×${e.n}`]) : [['(nothing usable)', '']], bv.sub, 'BAG');
    if (bv.phase === 'learn' && bv.learn) listPanel(g, VW - Math.min(150, VW * 0.56) - 4, 4, Math.min(150, VW * 0.56), boxY - 8, [...bv.learn.moves.map(n => [n, '']), [`Don't learn ${bv.learn.move}`, '']], bv.sub, 'FORGET');
    if (bv.phase === 'party' || bv.phase === 'target') partyPanel(g, 6, 4, VW - 12, boxY - 8, bv.party, bv.sub, bv.frame);
    if (b?.levelup) levelPanel(g, VW, b.levelup);
  }

  function listPanel(g, x, y, w, h, rows, cursor, title) {
    panel(g, theme, x, y, w, h, { r: 5 });
    text(g, theme, title, x + 10, y + 12, { size: 6.5, color: theme.muted });
    const lineH = 12, max = Math.floor((h - 22) / lineH), start = Math.max(0, Math.min(cursor - max + 1, rows.length - max));
    rows.slice(start, start + max).forEach(([l, r], i) => {
      const yy = y + 24 + i * lineH;
      text(g, theme, l, x + 16, yy, { size: 7.5, max: w - 50 });
      if (r) text(g, theme, r, x + w - 10, yy, { size: 7, align: 'right' });
      if (start + i === cursor) arrow(g, x + 8, yy - 3);
    });
  }

  function partyPanel(g, x, y, w, h, party, cursor, frame = 0) {
    panel(g, theme, x, y, w, h, { r: 5 });
    const rowH = Math.min(17, (h - 8) / Math.max(1, party.length));
    party.forEach((c, i) => {
      const yy = y + 5 + i * rowH;
      if (i === cursor) { round(g, x + 4, yy, w - 8, rowH - 1.5, 3); g.fillStyle = theme.accentLight; g.fill(); }
      bank.drawCreature(g, c.species, Math.floor(frame / 18) % 2 && i === cursor ? 'idleB' : 'idle', x + 16, yy + rowH - 1, rowH * 1.25, {});
      text(g, theme, c.name, x + 30, yy + rowH * 0.62, { size: 7.5, color: c.hp <= 0 ? theme.muted : theme.ink });
      text(g, theme, `Lv${c.level}`, x + 30 + Math.min(70, w * 0.3), yy + rowH * 0.62, { size: 6.5 });
      if (c.status) statusTag(g, theme, x + 30 + Math.min(96, w * 0.38), yy + rowH * 0.3, c.status);
      hpBar(g, theme, x + w - 74, yy + rowH * 0.32, 44, c.hp / Math.max(1, c.maxHp), { h: 3 });
      text(g, theme, `${c.hp}/${c.maxHp}`, x + w - 8, yy + rowH * 0.66, { size: 6, align: 'right' });
      if (c.active) text(g, theme, '★', x + 8, yy + rowH * 0.66, { size: 6, color: '#e8a020' });
    });
  }

  function levelPanel(g, VW, lv) {
    const w = 92, x = VW - w - 6, y = 6;
    panel(g, theme, x, y, w, 76, { r: 5 });
    text(g, theme, `Lv ${lv.level}`, x + 8, y + 12, { size: 7.5 });
    const names = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
    Object.keys(names).forEach((k, i) => {
      const yy = y + 23 + i * 9;
      text(g, theme, names[k], x + 8, yy, { size: 6.5 });
      text(g, theme, String(lv.after[k]), x + w - 26, yy, { size: 6.5, align: 'right' });
      text(g, theme, `+${lv.after[k] - lv.before[k]}`, x + w - 8, yy, { size: 6.5, align: 'right', color: '#3a9a4a' });
    });
  }

  return { render, reset() { anim.hp = {}; anim.exp = null; }, wrap: (g, s, w) => wrap(g, theme, s, w) };
}
