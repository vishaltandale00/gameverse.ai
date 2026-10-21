// graphics.render.dom — scene cards for graph and none spaces (adventure,
// narrative, management and card games). Above the story/choice UI it shows
// the current location as an illustrated card: painted scenery picked from the
// zone's name and tags, crossfading as the player travels, the location's name
// set large with the game title as a kicker, and everyone present standing on
// the ground line with idle motion, plus items lying there. The DOM part is a
// card element (heading text for screen readers) holding the canvas.
import { ensureJuice } from './flat-juice.js';
import { hubOf, bindSpace, ORDER } from './flat-stage.js';
import { drawEntity, lookOf, STATES, FLAT_MODEL_FIELDS } from './flat-models.js';
import { modelsData, MODEL_COMPONENT } from './model-lib.js';
import { bindingRules } from './flat-stage.js';
import { sceneryImage, themeFor } from './flat-art.js';
import { clamp01, label, rgba, FONTS } from './flat-util.js';

export default {
  id: 'graphics.render.dom',
  card: {
    intent: 'Illustrated scene cards for graph and none spaces: painted scenery per location with crossfades, large location typography, and the characters and items present drawn standing in the scene with idle motion.',
    views: ['ui', 'text'],
    params: {
      height: { type: 'number', default: 0.42, min: 0.15, max: 1, effect: 'card height as a fraction of the view' },
      font: { type: 'string', default: 'serif', options: Object.keys(FONTS), effect: 'title typography' },
      showPlayer: { type: 'boolean', default: true, effect: 'draw the player in the scene' },
      time: { type: 'string', default: 'auto', options: ['auto', 'day', 'sunset', 'night', 'dawn'], effect: 'scenery lighting (auto: from zone tags and the story)' },
    },
    reads: ['plot.characters', 'content.archetypes', 'content.models'],
    data: { 'content.models': modelsData(FLAT_MODEL_FIELDS, { states: STATES }) },
    components: { model: MODEL_COMPONENT },
    rules: { flat_no_space: bindingRules('graphics.render.dom', ['engine.space.graph', 'engine.space.none'], { id: 'other', use: 'engine.space.grid', with: { size: [4, 4] } }).flat_no_space },
  },
  validate(config, doc) {
    return (doc.spaces || []).some(s => s.use === 'engine.space.graph' || s.use === 'engine.space.none') ? [] : [{ code: 'flat_no_space', path: '', message: 'graphics.render.dom needs a graph or none space' }];
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindSpace(rt, instance, ['graph', 'none']), S = H.stage(space, 'dom');
    ensureJuice(rt);
    // A card at the top of the view instead of a full-view canvas.
    let card = null, heading = null;
    if (S.canvas && typeof document !== 'undefined') {
      card = document.createElement('figure'); card.className = 'gv-scene-card';
      Object.assign(card.style, { position: 'relative', margin: '0', width: '100%', height: `${Math.round(config.height * 100)}%`, minHeight: '180px', overflow: 'hidden' });
      heading = document.createElement('figcaption'); Object.assign(heading.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' });
      S.canvas.remove?.(); card.append(S.canvas, heading);
      rt.view.container.prepend ? rt.view.container.prepend(card) : rt.view.container.append(card);
    }
    const zoneOf = F => {
      const p = rt.player(), sp = F.doc.spaces.find(s => s.id === space);
      let z = null; try { z = rt.space(space).zones?.get?.(p?.at); } catch { /* */ }
      return z || sp?.zones?.find(x => x.id === p?.at || x.id === p?.zone) || null;
    };
    let shown = null, shownZone = null, prev = null, since = 0;
    S.renderer = { camera(F, cam) { cam.x = F.w / 2; cam.y = -F.h / 2; cam.zoom = 1; }, transform: () => ({ toScreen: p => p, toWorld: p => p, unit: 1 }) };
    H.layer(ORDER.world, F => {
      const g = F.ctx, zone = zoneOf(F), id = zone?.id ?? '_';
      if (id !== shown) { prev = shown == null ? null : { zone: shownZone, t0: F.t }; shown = id; shownZone = zone; since = F.t; if (heading) heading.textContent = zone?.name || F.doc.title; }
      const text = `${zone?.name || ''} ${(zone?.tags || []).join(' ')} ${zone?.description || ''}`.toLowerCase();
      const time = config.time !== 'auto' ? config.time : /night|dark|crypt|cellar|cave|haunt|moon/.test(text) ? 'night' : /dusk|sunset|evening/.test(text) ? 'sunset' : 'day';
      const paint = (z, a) => {
        const img = sceneryImage({ theme: themeFor(F.doc, z), time }, false, `${F.doc.id}|${z?.id || ''}`);
        if (!img) { g.fillStyle = '#1a1622'; g.fillRect(0, 0, F.w, F.h); return; }
        const s = Math.max(F.w / 384, F.h / 256), w = 384 * s, h = 256 * s, drift = Math.sin(F.t * 0.05) * 6;
        g.globalAlpha = a; g.drawImage(img.img, (F.w - w) / 2 + drift, (F.h - h) / 2, w, h); g.globalAlpha = 1;
      };
      paint(zone, 1);
      if (prev) { const k = clamp01((F.t - prev.t0) / 0.7); if (k < 1) paint(prev.zone, 1 - k); else prev = null; }
      // Legibility gradient and the ground line.
      if (g.createLinearGradient) { const gr = g.createLinearGradient(0, 0, 0, F.h); gr.addColorStop(0, 'rgba(8,6,14,.55)'); gr.addColorStop(0.35, 'rgba(8,6,14,0)'); gr.addColorStop(0.75, 'rgba(8,6,14,0)'); gr.addColorStop(1, 'rgba(8,6,14,.6)'); g.fillStyle = gr; g.fillRect(0, 0, F.w, F.h); }
      // Who and what is here.
      const here = F.entities.filter(x => !x.ghost && (x.id !== 'player' || config.showPlayer) && (zone ? (x.e.at === zone.id || x.e.zone === zone.id || x.id === 'player') : true));
      const people = here.filter(x => !['pickup', 'prop', 'goal'].includes(lookOf(H, x.e, 'side').role)), things = here.filter(x => !people.includes(x));
      const ground = F.h * 0.93, hh = F.h * 0.44, gap = Math.min(F.w / (people.length + 1), hh * 0.9);
      people.sort((a, b) => (a.id === 'player' ? -1 : b.id === 'player' ? 1 : 0)).forEach((it, i) => {
        const x = F.w / 2 + (i - (people.length - 1) / 2) * gap;
        const tr = H.tracker(it.id); if (it.id !== 'player') tr.facing = x > F.w / 2 ? -1 : 1;
        drawEntity(F, it, { x, y: ground, w: hh * 0.6, h: hh * (it.id === 'player' ? 1 : 0.94), view: 'side', unit: hh, shadow: true });
      });
      things.forEach((it, i) => drawEntity(F, it, { x: F.w * 0.12 + i * F.h * 0.16, y: ground + 2, w: F.h * 0.12, h: F.h * 0.12, view: 'side', unit: F.h * 0.12 }));
      // Title card: fades and rises in on arrival.
      const k = clamp01((F.t - since) / 0.6);
      label(g, (F.doc.title || '').toUpperCase(), 22, 24, { size: Math.max(10, F.h * 0.045), weight: 700, align: 'left', color: rgba('#f4e8d0', 0.8 * k), font: FONTS.rounded, stroke: null });
      label(g, zone?.name || F.doc.title || '', 20, 24 + F.h * 0.12 - (1 - k) * 10, { size: Math.max(18, F.h * 0.11), weight: 800, align: 'left', color: '#fff6e4', font: FONTS[config.font] || FONTS.serif, alpha: k, stroke: 'rgba(10,8,20,.55)' });
    }, { space, name: 'render.dom' });
  },
};
