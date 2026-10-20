// graphics.ui.map: the full world map for any space: discovery fog, the
// player, quest pins, markers, region labels, a zone cursor driven by D-pad
// or pointer, zoom and pan, user pins, and fast travel to discovered travel
// points through view.act({ fast_travel: zone }) when that verb exists.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, titleCase, zoneName, docZone, clamp } from './ui-lib.js';
import { icon } from './ui-icons.js';
import { createSheet } from './ui-sheet.js';
import { mapModel, drawMap, fitTransform, TRAVEL_TAGS } from './ui-cartography.js';
import * as S from './ui-sources.js';

/** Nearest selectable zone from `from` in a direction (screen-up = +v). */
export function zoneInDirection(zones, fromId, dir) {
  const a = zones.find(z => z.id === fromId) || zones[0]; if (!a) return null;
  const [du, dv] = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[dir];
  let best = null, bestScore = Infinity;
  for (const z of zones) {
    if (z.id === a.id) continue;
    const u = z.center[0] - a.center[0], v = z.center[1] - a.center[1], along = u * du + v * dv;
    if (along <= 1e-9) continue;
    const side = Math.abs(u * dv - v * du), score = along + side * 2.2;
    if (score < bestScore) { bestScore = score; best = z; }
  }
  return best?.id ?? null;
}
/** Whether fast travel to a zone is offered. */
export function canTravel(rt, z, config, currentZone) {
  if (!config.fastTravel || !S.canAct(rt, 'fast_travel') || !z?.discovered || z.id === currentZone) return false;
  const tags = config.travelTags.length ? config.travelTags : TRAVEL_TAGS;
  return tags.some(t => z.tags.includes(t));
}

export default {
  id: 'graphics.ui.map',
  card: {
    intent: 'Full world map sheet: discovery fog, player position, quest pins, markers by tag, region labels, zone cursor, zoom/pan, user pins, and fast travel to discovered travel points (view.act fast_travel).',
    views: ['any'],
    params: {
      fog: { type: 'boolean', default: true, effect: 'hide undiscovered zones' },
      fastTravel: { type: 'boolean', default: false, effect: 'offer fast travel to discovered travel points' },
      travelTags: { type: 'list', default: [], of: { type: 'string' }, effect: `zone tags that are travel points (default ${TRAVEL_TAGS.join(', ')})` },
      layers: { type: 'list', default: [], of: { type: 'string' }, effect: 'legend layers: zone tags or marker tags shown in the legend and highlighted' },
      markers: { type: 'list', default: [], of: { type: 'object', fields: { tag: { type: 'string', required: true }, icon: { type: 'string', default: '' }, color: { type: 'string', default: '#ffffff' } } } },
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES] },
      pause: { type: 'boolean', default: true },
    },
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el;
    let selected = null, zoom = 1, pan = [0, 0], model = null, canvas = null, ctx = null, info = null, drag = null, pins = loadPins();
    const sheet = createSheet(host, {
      id: 'map', title: 'Map', theme: resolveTheme(rt.doc, config.style), hotkey: 'map', pause: config.pause,
      tabs: () => [{ id: 'map', label: 'Map' }],
      hints: () => [['confirm', config.fastTravel && S.canAct(rt, 'fast_travel') ? 'Travel / pin' : 'Pin'], ['prev', 'Zoom']],
      renderTab(tab, body, sh) {
        model = mapModel(rt, { markers: config.markers, fog: config.fog });
        sh.retitle(titleCase(rt.doc.spaces.find(s => s.id === model.space)?.name || model.space) || 'Map');
        canvas = el('canvas', { attrs: { 'aria-label': 'World map', role: 'img' } });
        const stage = el('div.gv-map-canvas', { on: { wheel: e => { e.preventDefault?.(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, pointerdown: e => { drag = { x: e.clientX, y: e.clientY, pan: [...pan], moved: false }; }, pointermove: e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true; pan = [drag.pan[0] + dx, drag.pan[1] + dy]; paint(); }, pointerup: e => { if (drag && !drag.moved) pickAt(e); drag = null; } } }, canvas);
        info = el('aside.gv-map-info');
        fill(body, el('div.gv-map-body', {}, stage, info));
        ctx = canvas.getContext?.('2d');
        selected = model.currentZone || model.zones.find(z => z.discovered)?.id || null;
        sh.setItems([stage], { onMove: dir => { const next = zoneInDirection(model.zones.filter(z => z.discovered || !config.fog), selected, dir); if (next) { selected = next; host.sound('move'); paintInfo(); paint(); } return true; }, onConfirm: () => activate(), onVerb: v => { if (v === 'prev' || v === 'next') zoomBy(v === 'next' ? 1.25 : 0.8); return true; } });
        paintInfo(); paint();
      },
      refresh() { const next = mapModel(rt, { markers: config.markers, fog: config.fog }); if (JSON.stringify(next.player) !== JSON.stringify(model?.player) || next.pins.length !== model?.pins.length) { model = next; paintInfo(); } else model = next; paint(); },
    });
    function zoomBy(k) { zoom = clamp(zoom * k, 0.5, 8); paint(); }
    function size() { const w = canvas.parentNode?.clientWidth || 800, h = canvas.parentNode?.clientHeight || 500; return [w, h]; }
    function transform() {
      const [w, h] = size(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const tf = fitTransform(model.bounds, w * dpr, h * dpr, 48 * dpr);
      return { ...tf, scale: tf.scale * zoom, cx: tf.cx + pan[0] * dpr, cy: tf.cy + pan[1] * dpr, dpr, w, h };
    }
    function paint() {
      if (!ctx || !model) return;
      const tf = transform();
      if (canvas.width !== Math.round(tf.w * tf.dpr)) { canvas.width = Math.round(tf.w * tf.dpr); canvas.height = Math.round(tf.h * tf.dpr); }
      ctx.setTransform?.(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawMap(ctx, model, tf, { dpr: tf.dpr, selected, time: host.now(), userPins: pins, showUnknown: false });
    }
    function pickAt(e) {
      const r = canvas.getBoundingClientRect(), tf = transform(), x = (e.clientX - r.left) * tf.dpr, y = (e.clientY - r.top) * tf.dpr;
      let best = null, d = Infinity;
      for (const z of model.zones) { if (config.fog && !z.discovered) continue; const zx = tf.cx + (z.center[0] - tf.ou) * tf.scale, zy = tf.cy - (z.center[1] - tf.ov) * tf.scale, dd = Math.hypot(zx - x, zy - y); if (dd < d) { d = dd; best = z; } }
      if (best) { selected = best.id; paintInfo(); paint(); }
    }
    function activate() {
      const z = model.zones.find(x => x.id === selected); if (!z) return;
      if (canTravel(rt, z, config, model.currentZone)) { rt.view.act({ fast_travel: z.id }); host.sound('confirm'); sheet.close(); return; }
      pins = pins.includes(z.id) ? pins.filter(p => p !== z.id) : [...pins, z.id]; savePins(); host.sound('confirm'); paintInfo(); paint();
    }
    function paintInfo() {
      if (!info) return;
      const z = model.zones.find(x => x.id === selected), dz = z && docZone(rt.doc, z.id);
      const here = model.pins.filter(p => p.zone === selected);
      const layers = config.layers.filter(l => model.zones.some(x => x.tags.includes(l)) || config.markers.some(m => m.tag === l));
      fill(info,
        z ? el('div.gv-kicker', { text: z.current ? 'You are here' : z.travel ? 'Travel point' : (z.tags[0] ? titleCase(z.tags[0]) : 'Region') }) : null,
        el('h3.gv-display', { text: z ? (z.discovered ? zoneName(rt.doc, z.id) : 'Unexplored') : 'Nothing explored yet' }),
        dz?.description && z.discovered ? el('p', { text: dz.description }) : null,
        z?.tags?.length && z.discovered ? el('div', {}, ...z.tags.map(t => el('span.gv-tag', { text: titleCase(t) }))) : null,
        here.length ? el('ul.gv-objectives', {}, ...here.map(p => el('li', {}, icon(p.kind === 'available' ? 'quest' : 'flag'), el('span', { text: p.label })))) : null,
        z && canTravel(rt, z, config, model.currentZone) ? el('p', {}, el('span.gv-kbd', { text: host.input.device === 'gamepad' ? 'A' : 'Enter' }), ' Travel here') : null,
        pins.includes(selected) ? el('p.gv-dim', { text: 'Pinned' }) : null,
        layers.length ? el('div.gv-legend', {}, ...layers.map(l => el('span', {}, el('i', { style: { background: config.markers.find(m => m.tag === l)?.color || '#9ab' } }), titleCase(l)))) : null,
        el('div.gv-legend', {}, el('span', {}, el('i', { style: { background: '#ffffff' } }), 'You'), el('span', {}, el('i', { style: { background: '#ffb347' } }), 'Objective'), model.zones.some(x => x.travel) ? el('span', {}, el('i', { style: { background: '#7ad8ff' } }), 'Travel') : null),
      );
    }
    function loadPins() { try { return JSON.parse(globalThis.localStorage?.getItem(`gv.pins.${rt.doc.id}`) || '[]'); } catch { return []; } }
    function savePins() { try { globalThis.localStorage?.setItem(`gv.pins.${rt.doc.id}`, JSON.stringify(pins)); } catch { /* unavailable */ } }
    host.on('open', ({ panel }) => { if (panel === 'map') sheet.open(); });
  },
};
