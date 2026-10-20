// Module worker for graphics.render.voxel: greedy-meshes chunk volumes off the
// main thread with the same pure mesher. Messages:
//   in:  { id, volume:Uint16Array, size, materials, opts:{ao, faceShade, scale}, sky?:{tops:Int16Array, oy, scale, sx, sz} }
//   out: { id, opaque, transparent, ms }   (typed arrays transferred)
import { meshVolume } from './three-voxel-mesh.js';
import { skyFromTops } from './three-voxel-sky.js';

self.onmessage = e => {
  const { id, volume, size, materials, opts, sky } = e.data;
  const t0 = performance.now();
  const m = meshVolume(volume, size, materials, { ...opts, skylight: sky ? skyFromTops(sky) : null });
  const list = [];
  for (const part of [m.opaque, m.transparent]) for (const k of ['positions', 'normals', 'colors', 'alphas', 'emissive', 'indices']) list.push(part[k].buffer);
  self.postMessage({ id, opaque: m.opaque, transparent: m.transparent, ms: performance.now() - t0 }, list);
};
