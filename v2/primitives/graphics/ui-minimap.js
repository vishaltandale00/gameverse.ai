// graphics.ui.minimap: a radar centred on the player for any space with
// geometry (rect, bounds, polygon zones) or a node map around the current
// location for graph spaces: zone shapes, markers by tag, quest pins clamped
// to the rim, optional heading-up rotation, and the current zone's name.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, setText, setStyle, zoneName } from './ui-lib.js';
import { POSITIONS } from './ui-hud.js';
import { mapModel, drawMap } from './ui-cartography.js';

/**
 * Minimap view: the map model plus the transform centred on the player, and
 * pins outside the radius clamped to the rim ({ ..., rim: true }).
 */
export function minimapView(rt, config, px = 168) {
  const model = mapModel(rt, { markers: config.markers, quests: config.quests, fog: false });
  if (!model.player) return { model, tf: null, pins: [] };
  const radius = model.graph ? 14 : config.radius;
  const scale = (px / 2) / radius, [ou, ov] = model.player.pos;
  const rot = config.rotate && model.player.heading !== null && model.player.heading !== undefined ? model.player.heading : 0;
  const pins = model.pins.map(p => {
    const du = p.pos[0] - ou, dv = p.pos[1] - ov, d = Math.hypot(du, dv);
    return d > radius * 0.92 ? { ...p, pos: [ou + (du / d) * radius * 0.88, ov + (dv / d) * radius * 0.88], rim: true } : { ...p, rim: false };
  });
  return { model: { ...model, pins }, tf: { scale, cx: px / 2, cy: px / 2, ou, ov, rot }, radius, pins };
}

export default {
  id: 'graphics.ui.minimap',
  card: {
    intent: 'Minimap / radar centred on the player: zone shapes, markers by tag (shops, enemies, police...), quest pins clamped to the rim, heading-up rotation, and a node map for graph spaces.',
    views: ['any'],
    params: {
      radius: { type: 'number', default: 60, min: 4, max: 5000, unit: 'space units', effect: 'world distance from centre to rim' },
      rotate: { type: 'boolean', default: false, effect: 'heading-up instead of north-up' },
      shape: { type: 'string', default: 'circle', options: ['circle', 'square'] },
      size: { type: 'integer', default: 168, min: 80, max: 360, unit: 'px' },
      pos: { type: 'string', default: 'bottom-right', options: POSITIONS },
      markers: { type: 'list', default: [], of: { type: 'object', fields: { tag: { type: 'string', required: true }, icon: { type: 'string', default: '' }, color: { type: 'string', default: '#ffffff' } } }, effect: 'entity markers by tag, kind or component' },
      quests: { type: 'boolean', default: true, effect: 'quest objective pins' },
      label: { type: 'boolean', default: true, effect: 'current zone name under the map' },
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES] },
    },
  },
  validate(config) {
    const seen = new Set(), errors = [];
    config.markers?.forEach((m, i) => { if (seen.has(m.tag)) errors.push({ code: 'ui_marker_duplicate', path: `with.markers[${i}].tag`, message: `marker tag '${m.tag}' is listed twice` }); seen.add(m.tag); });
    return errors;
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el;
    const canvas = el('canvas', { attrs: { width: config.size * 2, height: config.size * 2, 'aria-hidden': 'true' } });
    const label = el('div.gv-minimap-label');
    const map = el('div.gv-minimap', { data: { shape: config.shape }, style: { '--size': `${config.size}px` }, role: 'img', aria: { label: 'Minimap' } }, canvas);
    const wrap = el('div.gv-minimap-wrap', { attrs: { 'data-theme': resolveTheme(rt.doc, config.style) } }, map, config.label ? label : null);
    // Sits in the HUD's anchor when present, else its own corner.
    const hudAnchor = host.root.querySelector?.(`.gv-anchor[data-pos=${config.pos}]`);
    if (hudAnchor) hudAnchor.append(wrap); else host.layer('hud').append(el('div.gv-hud', {}, el('div.gv-anchor', { data: { pos: config.pos } }, wrap)));
    const ctx = canvas.getContext?.('2d');
    let lastZone = null;
    rt.view.onFrame(() => {
      const v = minimapView(rt, config, config.size);
      const zone = v.model.currentZone;
      if (zone !== lastZone) { setText(label, zone ? zoneName(rt.doc, zone) : ''); lastZone = zone; }
      setStyle(wrap, 'display', v.tf ? null : 'none');
      if (!ctx || !v.tf) return;
      const dpr = 2, s = config.size * dpr;
      ctx.setTransform?.(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, s, s);
      ctx.save?.();
      if (config.shape === 'circle') { ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.clip?.(); }
      const g = ctx.createRadialGradient?.(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      if (g) { g.addColorStop(0, 'rgba(30,36,52,0.9)'); g.addColorStop(1, 'rgba(8,10,16,0.95)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }
      drawMap(ctx, v.model, { ...v.tf, scale: v.tf.scale * dpr, cx: v.tf.cx * dpr, cy: v.tf.cy * dpr }, { dpr, labels: v.model.graph, time: host.now() });
      // North tick when rotating.
      if (config.rotate && v.tf.rot) { ctx.fillStyle = '#ff6a6a'; ctx.font = `900 ${18}px system-ui`; ctx.textAlign = 'center'; const a = -v.tf.rot; ctx.fillText('N', s / 2 + Math.sin(a) * (s / 2 - 16), s / 2 - Math.cos(a) * (s / 2 - 16)); }
      ctx.restore?.();
    });
  },
};
