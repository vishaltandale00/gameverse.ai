// The model library on the stage: resolves a model spec for any entity
// (content.models by components.model or archetype id, else a generated one),
// builds and caches a template per spec (merged skinned geometry + rig), and
// instantiates actors (per-entity skeleton, attachments, spin nodes).
import { synthesizeSpec, itemSpec } from './three-model-gen.js';
import { rigForSpec, lowpolyParts } from './model-lowpoly.js';
import { humanoidRig, fitHumanoidToParts } from './rig-humanoid.js';
import { voxelBoxes, meshVoxelGroups, voxelizeParts, PRIMARY } from './model-voxel.js';
import { buildBones, boneIndex, addSecondaryChains } from './three-rig.js';
import { GeoBuilder, appendParts, appendVoxelMesh } from './three-geometry.js';
import { paletteFor } from './material-palette.js';

export function createModelLibrary(stage) {
  const { THREE, rt } = stage;
  const configs = { lowpoly: { segments: 12, flatShade: true, outline: 0 }, voxel: { voxelSize: 0.0625, bake: true, fitBody: true, ao: true, voxelizeOthers: true } };
  const templates = new Map();
  const lib = {
    configs, templates,
    configure(kind, config) { Object.assign(configs[kind], config); templates.clear(); },
    /** World style: 'voxel' when a voxel renderer drew the active space, else 'lowpoly'. */
    style: () => stage.worldStyle || 'lowpoly',
    /** Spec for an entity, archetype id, item or model id. */
    specFor(entity) {
      const doc = rt.doc, models = doc.content?.models || {};
      const arch = typeof entity === 'string' ? rt.archetype(entity) : rt.archetype(entity.archetype);
      const id = (typeof entity === 'object' && entity.components?.model) || arch?.components?.model || arch?.id;
      if (typeof id === 'string' && models[id]) return { id, spec: models[id] };
      if (id && typeof id === 'object') return { id: `inline:${entity.id}`, spec: id };
      const a = arch || { id: typeof entity === 'string' ? entity : entity.archetype, kind: entity?.components?.kind };
      return { id: `gen:${a.id}`, spec: synthesizeSpec(a) };
    },
    itemSpecFor(itemOrName) {
      const models = rt.doc.content?.models || {};
      if (typeof itemOrName === 'string' && models[itemOrName]) return { id: itemOrName, spec: models[itemOrName] };
      const item = typeof itemOrName === 'string' ? (rt.doc.content?.items || []).find(i => i.id === itemOrName) || { id: itemOrName } : itemOrName;
      if (item.model && models[item.model]) return { id: item.model, spec: models[item.model] };
      return { id: `item:${item.id}`, spec: itemSpec(item) };
    },
    /** Build (cached) the template for a spec. */
    template(id, spec, { height = null } = {}) {
      const style = lib.style();
      const key = `${id}|${style}|${height ?? ''}`;
      if (templates.has(key)) return templates.get(key);
      const t = buildTemplate(id, spec, style, height);
      templates.set(key, t);
      return t;
    },
    /** A new actor for an entity. */
    actor(entity) {
      const { id, spec } = lib.specFor(entity);
      const h = entity.components?.body?.size?.[1];
      const t = lib.template(id, spec, { height: configs.voxel.fitBody && (spec.kind === 'voxel' || lib.style() === 'voxel') && h ? h : null });
      return instantiate(t, entity);
    },
    /** A static object (item in hand, prop instance): returns { object, template }. */
    staticObject(id, spec) { const t = lib.template(id, spec); return instantiate(t, null); },
    dispose() { for (const t of templates.values()) t.geometry?.dispose(); templates.clear(); },
  };

  function buildTemplate(id, spec, style, fitHeight) {
    const palette = paletteFor(stage);
    const emissiveKeys = new Set([...palette.emissiveKeys, ...Object.keys(spec.palette || {}).filter(k => /glow|ember|light|lamp|neon|fire|flame/.test(k))]);
    const builder = new GeoBuilder();
    let rig = null, spin = [], offset = [0, 0, 0], height = spec.height || 1, chains = [];
    const asVoxel = spec.kind === 'voxel' || (style === 'voxel' && configs.voxel.voxelizeOthers && spec.kind !== 'mesh');
    if (asVoxel) {
      const vs = configs.voxel.voxelSize;
      let vspec = spec;
      let lowRig = null;
      if (spec.kind !== 'voxel') {
        lowRig = rigForSpec(spec, stage.rigs);
        vspec = voxelizeParts(lowpolyParts(spec, lowRig, { saddle: stage.rigs.quadruped?.saddle && /mount|horse/.test(id) }), spec.palette || {}, Math.max(0.04, Math.min(0.12, (spec.height || spec.length || 1) / 24)));
      }
      const res = spec.kind === 'voxel' ? vs : (Math.max(0.04, Math.min(0.12, (spec.height || spec.length || 1) / 24)));
      const rigged = spec.kind === 'voxel' ? (spec.rig === 'humanoid' || spec.parts?.some(p => p.name === 'head') && spec.parts?.some(p => p.name === 'legL')) : !!lowRig;
      const boxes = voxelBoxes(vspec, res);
      if (spec.kind === 'voxel' && rigged) rig = fitHumanoidToParts(humanoidRig({ height: (vspec.size[1] * res) }), boxes.filter(b => PRIMARY[b.name]));
      else if (lowRig) rig = lowRig;
      const { meshes, size } = meshVoxelGroups(vspec, { rigged: spec.kind === 'voxel' ? rigged : false, ao: configs.voxel.ao, emissiveKeys, palette: spec.palette });
      const [w, , d] = size;
      // Voxel space (front z=0) -> model space (front +z): flip x and z around the centre.
      const ox = vspec.offset ? vspec.offset[0] + w * res / 2 : 0, oy = vspec.offset ? vspec.offset[1] : 0, oz = vspec.offset ? vspec.offset[2] + d * res / 2 : 0;
      const bi = rig ? boneIndex(rig) : null;
      for (const [group, mesh] of meshes) {
        const flip = m => { const P = m.positions, N = m.normals; for (let i = 0; i < P.length; i += 3) { P[i] = -(P[i] * res - w * res / 2) + ox; P[i + 1] = P[i + 1] * res + oy; P[i + 2] = -(P[i + 2] * res - d * res / 2) + oz; N[i] = -N[i]; N[i + 2] = -N[i + 2]; } return m; };
        const isSpin = group.startsWith('spin:');
        let boneName = isSpin ? null : group;
        if (!rig && !isSpin) boneName = null;
        if (!rig && lowRig) boneName = null;
        const skin = bi && boneName && bi.has(boneName) ? [bi.get(boneName), 0, 1, 0] : [0, 0, 1, 0];
        if (isSpin) { const sb = new GeoBuilder(); appendVoxelMesh(sb, flip(mesh.opaque), 'matte', [0, 0, 1, 0]); spin.push({ name: group.slice(5), builder: sb }); continue; }
        // Winding flips with the mirror (two axes flipped = rotation, so winding is kept).
        appendVoxelMesh(builder, flip(mesh.opaque), 'matte', skin);
        appendVoxelMesh(builder, flip(mesh.transparent), 'transparent', skin);
      }
      // Voxelized lowpoly parts lost their bone tags; re-skin by nearest joint for rigged lowpoly.
      if (lowRig && rig) reskinNearest(builder, rig);
      height = vspec.size[1] * res + oy;
    } else {
      rig = rigForSpec(spec, stage.rigs);
      let parts = lowpolyParts(spec, rig, { saddle: stage.rigs.quadruped?.saddle && (spec.saddle || /mount/.test(id)) });
      if (rig && parts.some(p => p.secondary && !p.from)) {
        // Capes, long hair and banners hang from spring chains (graphics.anim.secondary drives them).
        const added = addSecondaryChains(rig, parts);
        rig = added.rig; chains = added.chains;
        parts = parts.map(p => { const c = chains.find(ch => ch.part === p); return c ? { ...p, chain: c } : p; });
      }
      const bi = rig ? boneIndex(rig) : null;
      const still = parts.filter(p => !/wheel|rotor|propeller/.test(p.name || ''));
      const spinners = parts.filter(p => /wheel|rotor|propeller/.test(p.name || ''));
      appendParts(THREE, builder, still.map(p => rig ? { ...p, bone: p.bone || nearestBone(rig, p) } : p), { palette: spec.palette, boneIndex: bi, segments: configs.lowpoly.segments, flatShade: configs.lowpoly.flatShade, emissiveKeys, alpha: spec.alpha });
      for (const p of spinners) {
        const sb = new GeoBuilder(), c = p.at || [0, 0, 0];
        appendParts(THREE, sb, [{ ...p, at: [0, 0, 0] }], { palette: spec.palette, segments: configs.lowpoly.segments, flatShade: true, emissiveKeys });
        spin.push({ name: p.name, builder: sb, at: c });
      }
      const b = builder.bounds(); height = Math.max(b.max[1], spec.height || 0);
    }
    if (rig && fitHeight && height > 0) {
      // Scale (fitBody) applied at instance level through root scale.
    }
    const geometry = builder.toGeometry(THREE, { skinned: !!rig });
    geometry.userData.template = true; // shared: owners of instances must not dispose it
    const spinParts = spin.map(s => {
      const g = s.builder.toGeometry(THREE, { skinned: false });
      let center = s.at;
      if (!center) { g.computeBoundingBox(); const c = new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z); center = [c.x, c.y, c.z]; }
      return { name: s.name, geometry: g, at: center, axis: /rotor/.test(s.name) ? 'y' : /propeller/.test(s.name) ? 'z' : 'x' };
    });
    const bounds = builder.bounds();
    return { id, spec, rig, chains, geometry, spin: spinParts, height, bounds, scale: fitHeight && height > 0 ? fitHeight / height : 1, kind: spec.rig || (rig ? rig.kind : spec.generated || spec.prop || spec.vehicle || 'static'), offset };
  }

  function nearestBone(rig, p) {
    const at = p.at || (p.from && p.to ? p.from.map((v, i) => (v + p.to[i]) / 2) : [0, 0, 0]);
    let best = rig.bones[0].name, bd = Infinity;
    for (const b of rig.bones) { const d = Math.hypot(b.head[0] - at[0], (b.head[1] - at[1]) * 1.3, b.head[2] - at[2]); if (d < bd) { bd = d; best = b.name; } }
    return best;
  }
  function reskinNearest(builder, rig) {
    const bi = boneIndex(rig);
    const segs = rig.bones.filter(b => b.parent).map(b => ({ name: b.parent, a: rig.bones.find(x => x.name === b.parent).head, b: b.head }));
    for (const g of Object.values(builder.groups)) for (let v = 0; v < g.pos.length / 3; v++) {
      const p = [g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]];
      let best = 0, bd = Infinity;
      for (const s of segs) {
        const d = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * d[0] + (p[1] - s.a[1]) * d[1] + (p[2] - s.a[2]) * d[2]) / dd));
        const q = [s.a[0] + d[0] * t - p[0], s.a[1] + d[1] * t - p[1], s.a[2] + d[2] * t - p[2]], dist = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
        if (dist < bd) { bd = dist; best = bi.get(s.name); }
      }
      g.si[v * 4] = best; g.sw[v * 4] = 1; g.si[v * 4 + 1] = 0; g.sw[v * 4 + 1] = 0;
    }
  }

  function instantiate(t, entity) {
    const pal = paletteFor(stage);
    const root = new THREE.Group(); root.name = entity ? `actor:${entity.id}` : `object:${t.id}`;
    const body = new THREE.Group(); root.add(body);
    body.scale.setScalar(t.scale || 1);
    let mesh, bones = null, skeleton = null;
    const mats = pal.actorMaterials({ skinned: !!t.rig });
    if (t.rig) {
      const built = buildBones(THREE, t.rig);
      bones = built.bones;
      skeleton = new THREE.Skeleton(built.list);
      mesh = new THREE.SkinnedMesh(t.geometry, mats);
      mesh.add(built.root); mesh.bind(skeleton);
    } else mesh = new THREE.Mesh(t.geometry, mats);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = !t.rig;
    body.add(mesh);
    const spin = t.spin.map(s => { const m = new THREE.Mesh(s.geometry, pal.actorMaterials({ skinned: false })); m.position.set(...s.at); m.castShadow = true; body.add(m); return { ...s, mesh: m }; });
    return { id: entity?.id, template: t, root, body, mesh, bones, skeleton, spin, rig: t.rig, kind: t.kind, spec: t.spec, anim: {}, attachments: new Map(), height: t.height * (t.scale || 1) };
  }
  return lib;
}

/** Sync attachments (equipment slots / fixed models) on an actor's bones. */
export function syncAttachments(stage, actor, entity) {
  const list = stage.rigs.humanoid?.attach || [];
  if (!actor.bones || actor.rig?.kind !== 'humanoid') return;
  for (const a of list) {
    const key = `${a.bone}:${a.slot || ''}:${a.model || ''}`;
    let want = a.model || null;
    if (a.slot) {
      const eq = entity.components?.equipment;
      want = eq?.equipped?.[a.slot] ?? eq?.[a.slot] ?? (a.slot === 'weapon' ? entity.components?.melee?.weapon ?? entity.components?.ranged?.weapon : null) ?? want;
      if (want && typeof want === 'object') want = want.item || want.id;
    }
    const cur = actor.attachments.get(key);
    if (cur?.item === want) continue;
    if (cur) { cur.object.removeFromParent(); actor.attachments.delete(key); }
    if (!want) continue;
    const bone = actor.bones.get(a.bone); if (!bone) continue;
    const { id, spec } = stage.models.itemSpecFor(want);
    const obj = stage.models.staticObject(id, spec);
    const g = obj.root;
    if (a.bone.startsWith('hand')) { g.rotation.set(Math.PI / 2, 0, 0); g.position.set(0, -0.06, 0.02); }
    else if (a.bone === 'back') { g.rotation.set(0, 0, Math.PI * 0.8); g.position.set(0, 0, -0.06); }
    else if (a.bone === 'hip') { g.rotation.set(Math.PI, 0, 0.2); }
    bone.add(g);
    actor.attachments.set(key, { item: want, object: g });
  }
}
