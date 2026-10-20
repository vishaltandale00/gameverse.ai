// Drawing helpers shared by the overworld, battle and menu screens. Everything is drawn in a
// virtual pixel space (about 240×160, widened to the canvas aspect) scaled to the canvas.
import { hex, light, shade, luminance } from '../../../art/color.js';

export function makeTheme(art = {}) {
  const d = art.direction || {};
  const family = d.font === 'pixel' || /pixel/i.test(art.style || '') ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    : d.font === 'serif' ? 'Georgia, "Times New Roman", serif' : 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';
  const accent = hex(d.player?.colors?.primary, '#3a6ad8');
  return {
    family, accent, accentDark: shade(accent, 0.35), accentLight: light(accent, 0.55),
    ink: '#2a2a38', paper: '#fbfaf6', border: '#3a3a4a', inner: luminance(accent) > 0.6 ? shade(accent, 0.4) : accent, muted: '#7a7a8a',
  };
}

export const font = (theme, size, weight = 700) => `${weight} ${size}px ${theme.family}`;

/** A rounded panel with a double border (the classic handheld text box). */
export function panel(g, theme, x, y, w, h, { fill = theme.paper, border = theme.border, inner = theme.inner, r = 4 } = {}) {
  round(g, x, y, w, h, r); g.fillStyle = border; g.fill();
  round(g, x + 1.2, y + 1.2, w - 2.4, h - 2.4, r - 1); g.fillStyle = inner; g.fill();
  round(g, x + 2.4, y + 2.4, w - 4.8, h - 4.8, Math.max(1, r - 2)); g.fillStyle = fill; g.fill();
}

export function round(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

export function text(g, theme, str, x, y, { size = 8, color = theme.ink, align = 'left', weight = 700, shadow = null, baseline = 'alphabetic', max } = {}) {
  g.font = font(theme, size, weight);
  g.textAlign = align; g.textBaseline = baseline;
  if (shadow) { g.fillStyle = shadow; g.fillText(str, x + 0.6, y + 0.6, max); }
  g.fillStyle = color; g.fillText(str, x, y, max);
}

const wrapCache = new Map();
/** Greedy word wrap at a pixel width (cached by font, width and text). */
export function wrap(g, theme, str, width, size = 8) {
  const key = `${size}|${width}|${str}`;
  if (wrapCache.has(key)) return wrapCache.get(key);
  g.font = font(theme, size);
  const lines = [];
  let cur = '';
  for (const word of String(str).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (g.measureText(next).width > width && cur) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (wrapCache.size > 400) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

/** Wrapped text revealed up to `shown` characters (the typewriter). */
export function typewriter(g, theme, str, shown, x, y, width, { size = 8, lineH = 11, color = theme.ink, maxLines = 3 } = {}) {
  const lines = wrap(g, theme, str, width, size);
  let left = shown;
  for (let i = 0; i < Math.min(maxLines, lines.length) && left > 0; i++) {
    const part = lines[i].slice(0, left);
    text(g, theme, part, x, y + i * lineH, { size, color, shadow: 'rgba(0,0,0,.08)' });
    left -= lines[i].length + 1;
  }
  return lines.length;
}

export const hpColor = f => (f > 0.5 ? '#3ec85a' : f > 0.2 ? '#f0c030' : '#e84a3a');

export function hpBar(g, theme, x, y, w, frac, { h = 3.4, label = true } = {}) {
  if (label) text(g, theme, 'HP', x - 11, y + h + 0.2, { size: 5.5, color: '#f0a020', weight: 800 });
  round(g, x - 1, y - 1, w + 2, h + 2, 1.5); g.fillStyle = '#3a3a48'; g.fill();
  g.fillStyle = '#5a5a68'; g.fillRect(x, y, w, h);
  const f = Math.max(0, Math.min(1, frac));
  g.fillStyle = hpColor(f); g.fillRect(x, y, w * f, h);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, w * f, h * 0.35);
}

export function expBar(g, x, y, w, frac) {
  g.fillStyle = '#3a3a48'; g.fillRect(x - 0.6, y - 0.6, w + 1.2, 2.8);
  g.fillStyle = '#5a6070'; g.fillRect(x, y, w, 1.6);
  g.fillStyle = '#4ab0f0'; g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 1.6);
}

/** A small colored type label. */
export function typePill(g, theme, x, y, name, color, { w = 30, size = 5.5 } = {}) {
  round(g, x, y, w, 8, 3); g.fillStyle = shade(color, 0.25); g.fill();
  round(g, x + 0.6, y + 0.6, w - 1.2, 6.8, 2.6); g.fillStyle = color; g.fill();
  text(g, theme, String(name).toUpperCase(), x + w / 2, y + 5.9, { size, color: luminance(color) > 0.62 ? '#2a2a38' : '#ffffff', align: 'center', weight: 800 });
}

const STATUS_TAG = { burn: ['BRN', '#e86030'], poison: ['PSN', '#a04ac8'], paralysis: ['PAR', '#e8c020'], sleep: ['SLP', '#8a90a0'], freeze: ['FRZ', '#5ac8e8'], confusion: ['CNF', '#e870a8'] };
export function statusTag(g, theme, x, y, status) {
  const s = STATUS_TAG[status];
  if (!s) return;
  round(g, x, y, 17, 7, 2); g.fillStyle = s[1]; g.fill();
  text(g, theme, s[0], x + 8.5, y + 5.4, { size: 5, color: '#ffffff', align: 'center', weight: 800 });
}

/** Cursor arrow pointing right. */
export function arrow(g, x, y, color = '#2a2a38') {
  g.fillStyle = color; g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + 4, y); g.lineTo(x, y + 3); g.closePath(); g.fill();
}

export const ease = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
