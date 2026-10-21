// The zones a document's loops name (graphics/presentation.js shownZones: race checkpoints, goal areas) in the three.js
// renderers: a translucent column over each zone's footprint (worlds3d-lib-world.js zoneBox and its height range),
// outlined, with its name on a label above it. Built once per document for the space; presentation only.
import { zonesShown } from './flat-zones.js';
import { zoneBox, zoneYRange } from '../engine/worlds3d-lib-world.js';

const COLORS = [0xffd23f, 0x4fd8ff, 0xff6a8a, 0x7adf8a, 0xc084ff, 0xff9a3a];
const titleCase = s => String(s).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

/** A sprite carrying text (null where no canvas can be made). */
function labelSprite(THREE, text) {
  const c = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null, g = c?.getContext?.('2d');
  if (!g) return null;
  c.width = 256; c.height = 64;
  g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(10,8,20,.8)'; g.strokeText(text, 128, 32); g.fillStyle = '#ffffff'; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1); s.userData.text = text;
  return s;
}

/**
 * Keep a group of zone markers under `root` for the space: call every frame; it rebuilds when the document changes.
 * groundAt(x, z) gives the floor height under a point (null: 0). Returns the group.
 */
export function syncZones(rt, THREE, root, spaceId, groundAt = () => 0, state = {}) {
  if (state.doc === rt.doc && state.group) return state.group;
  if (state.group) { root.remove(state.group); state.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  state.doc = rt.doc;
  const group = new THREE.Group(); group.name = 'zones';
  const ids = zonesShown(rt.doc, rt.registry), space = (rt.doc.spaces || []).find(s => s.id === spaceId);
  let i = 0;
  for (const z of space?.zones || []) {
    if (!ids.has(z.id)) continue;
    const box = zoneBox(z); if (!box) continue;
    const [x0, z0, x1, z1] = box, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, [ya, yb] = zoneYRange(z);
    const floor = Number.isFinite(ya) ? ya : Number(groundAt(cx, cz)) || 0, h = Number.isFinite(yb) && Number.isFinite(ya) ? Math.max(0.5, yb - ya) : 3;
    const color = COLORS[i++ % COLORS.length], geo = new THREE.BoxGeometry(Math.max(0.2, x1 - x0), h, Math.max(0.2, z1 - z0));
    const col = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
    col.position.set(cx, floor + h / 2, cz); col.name = `zone:${z.id}`; col.userData.zone = z.id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    col.add(edges);
    const label = labelSprite(THREE, z.name || titleCase(z.id));
    if (label) { label.position.set(0, h / 2 + 0.8, 0); col.add(label); }
    group.add(col);
  }
  root.add(group);
  state.group = group;
  return group;
}
