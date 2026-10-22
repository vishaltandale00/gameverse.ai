// @ts-check
// Minimal PNG encoder (RGBA, no dependencies) for generated guide templates.
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (/** @type {Uint8Array} */ buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** pixel(x, y) -> [r, g, b, a]
 * @param {number} width @param {number} height @param {(x: number, y: number) => number[]} pixel @returns {Buffer} */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) { const o = y * (width * 4 + 1) + 1 + x * 4; const [r, g, b, a] = pixel(x, y); raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** 2x2 tileset guide: four flat squares separated by thin dark gutters. @param {number} [size] */
export function tilesetTemplate(size = 1024) {
  const half = size / 2, gutter = 6;
  const tints = [[150, 140, 120], [120, 110, 95], [150, 150, 160], [110, 110, 125]];
  return encodePng(size, size, (x, y) => {
    if (Math.abs(x - half) < gutter || Math.abs(y - half) < gutter || x < gutter || y < gutter || x >= size - gutter || y >= size - gutter) return [20, 20, 24, 255];
    const cell = (y < half ? 0 : 2) + (x < half ? 0 : 1), t = tints[cell];
    const cy = y % half, cx = x % half;
    if (cell === 0 && cy < half * 0.2) return [190, 210, 150, 255];        // surface band along the top edge
    if (cell === 2 && (cy % (half / 4) < 4 || (cx + (Math.floor(cy / (half / 4)) % 2) * half / 4) % (half / 2) < 4)) return [95, 95, 108, 255]; // plank/brick seams across the whole cell
    return [...t, 255];
  });
}
