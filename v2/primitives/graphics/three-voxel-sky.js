// Sky exposure for voxel faces from column tops (pure; shared by the main
// thread and the meshing worker). tops: Int16Array over the padded full-
// resolution chunk footprint ((sx+2) x (sz+2), x fastest; sx, sz = chunk
// size in cells), each the y of the first open cell above the column's
// highest solid (world cells). oy = chunk origin y; scale = LOD cell size, so
// mesher-local (x, y, z) maps to world cells x*scale, oy + y*scale, z*scale.
export function skyFromTops({ tops, oy, scale = 1, sx, sz }) {
  const px = sx + 2;
  return (x, y, z) => {
    const ix = Math.min(sx + 1, Math.max(0, Math.floor(x * scale) + 1)), iz = Math.min(sz + 1, Math.max(0, Math.floor(z * scale) + 1));
    const depth = tops[ix + px * iz] - (oy + y * scale);
    return depth <= 0 ? 1 : depth <= 8 ? 1 - depth * 0.055 : Math.max(0, 0.5 - (depth - 8) * 0.06);
  };
}
