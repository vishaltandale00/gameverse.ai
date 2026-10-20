// Sprite bank: every character and creature is painted by the shared character rig
// (v2/art/characters.js) and turned into an image once, then cached. The hero and rival prefer
// the game's painted art frames (art.frames.player / art.frames.rival); people and creatures
// without art get rig looks derived from their content text (looks.js).
import { paintCharacter } from '../../../art/characters.js';
import { creatureLook, personLook } from './looks.js';
import { makeCanvas } from './tiles.js';

const RUN = ['runA', 'runB', 'runC', 'runD'];

export function createSpriteBank(game, art = {}) {
  const { content } = game;
  const images = new Map();
  const canBlob = typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof Image !== 'undefined';

  function fromUrl(key, url) {
    let e = images.get(key);
    if (e) return e;
    e = { img: null, ready: false };
    images.set(key, e);
    if (!url || typeof Image === 'undefined') return e;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { e.ready = true; };
    img.onerror = () => { e.failed = true; };
    img.src = url;
    e.img = img;
    return e;
  }
  function fromSvg(key, make) {
    if (images.has(key)) return images.get(key);
    if (!canBlob) { const e = { img: null, ready: false }; images.set(key, e); return e; }
    return fromUrl(key, URL.createObjectURL(new Blob([make()], { type: 'image/svg+xml' })));
  }

  const looks = new Map();
  const lookOf = (key, make) => { if (!looks.has(key)) looks.set(key, make()); return looks.get(key); };

  /** Look for an overworld person: hero and rival from the art direction, others from their text. */
  function personLookFor(kind, id, desc) {
    if (kind === 'player' && art.direction?.player) return art.direction.player;
    if (kind === 'rival' && art.direction?.enemy) return { ...art.direction.enemy, eyes: 'cartoon' };
    const role = kind === 'nurse' ? 'nurse' : null;
    const text = kind === 'player' ? content.player?.look : kind === 'rival' ? content.rival?.look : kind === 'mentor' ? content.mentor?.look : kind === 'champion' ? content.champion?.look : desc;
    return lookOf(`person:${kind}:${id}`, () => personLook(text || 'a person', `${kind}:${id}`, { role }));
  }

  /** The image for a person pose, preferring painted art frames for the hero and rival. */
  function person(kind, id, desc, pose) {
    const artKind = kind === 'player' ? 'player' : kind === 'rival' ? 'rival' : null;
    const url = artKind && art.frames?.[artKind]?.[pose];
    if (url) return fromUrl(`art:${artKind}:${pose}`, url);
    const look = personLookFor(kind, id, desc);
    return fromSvg(`person:${kind}:${id}:${pose}`, () => paintCharacter(look, pose, { size: 128 }));
  }

  /** A creature pose image (idle, idleB, hurt, jump, runA…). */
  function creature(speciesId, pose = 'idle') {
    return fromSvg(`creature:${speciesId}:${pose}`, () => paintCharacter(lookOf(`creature:${speciesId}`, () => creatureLook(content, speciesId)), pose, { size: 192 }));
  }

  // Tinted copies (back views, silhouettes) as canvases, made once the source image has loaded.
  const tinted = new Map();
  function tint(entry, key, color, alpha) {
    if (!entry.ready) return null;
    const k = `${key}:${color}:${alpha}`;
    if (tinted.has(k)) return tinted.get(k);
    const w = entry.img.naturalWidth || 128, h = entry.img.naturalHeight || 128;
    const cv = makeCanvas(w, h), g = cv.getContext('2d');
    g.drawImage(entry.img, 0, 0, w, h);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = alpha; g.fillStyle = color; g.fillRect(0, 0, w, h);
    tinted.set(k, cv);
    return cv;
  }

  const lastH = new Map();
  /**
   * Draw an overworld character with its feet at (cx, footY). The rig faces right: left flips; up and
   * down reuse the last horizontal facing, and up gets a darker back-view tint.
   */
  function drawPerson(g, { kind, id, desc, facing, walking, phase, frame, scale = 1 }, cx, footY) {
    if (facing === 'left' || facing === 'right') lastH.set(id, facing);
    const h = lastH.get(id) || (facing === 'left' ? 'left' : 'right');
    const pose = walking ? RUN[Math.floor((phase || 0) * 2) % 4] : (Math.floor((frame + (id.length * 13)) / 40) % 2 ? 'idleB' : 'idle');
    const e = person(kind, id, desc, pose);
    const size = 25 * scale;
    // Shadow.
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath(); g.ellipse(cx, footY - 1, 6 * scale, 2.2 * scale, 0, 0, Math.PI * 2); g.fill();
    if (!e.ready) { fallbackPerson(g, cx, footY, facing, kind, scale); return; }
    const src = facing === 'up' ? tint(e, `p:${kind}:${id}:${pose}`, '#1a1a3a', 0.32) || e.img : e.img;
    g.save();
    g.translate(cx, footY - size * 0.97);
    if (h === 'left') g.scale(-1, 1);
    g.drawImage(src, -size / 2, 0, size, size);
    g.restore();
  }

  function fallbackPerson(g, cx, footY, facing, kind, s) {
    g.fillStyle = kind === 'player' ? '#3a6ad8' : kind === 'rival' ? '#d8403a' : '#8a9098';
    g.fillRect(cx - 4 * s, footY - 12 * s, 8 * s, 10 * s);
    g.fillStyle = '#f5d0a8'; g.beginPath(); g.arc(cx, footY - 15 * s, 4.5 * s, 0, Math.PI * 2); g.fill();
    if (facing !== 'up') { g.fillStyle = '#222'; g.fillRect(cx - 2 * s, footY - 16 * s, 1 * s, 1.5 * s); g.fillRect(cx + 1 * s, footY - 16 * s, 1 * s, 1.5 * s); }
  }

  /**
   * Draw a creature in battle. `side` 'foe' faces left (flipped), 'player' faces right with a back tint.
   * Options: alpha, flash (white), silhouette (color), squash.
   */
  function drawCreature(g, speciesId, pose, x, footY, size, { flip = false, back = false, alpha = 1, white = 0, silhouette = null, sx = 1, sy = 1 } = {}) {
    const e = creature(speciesId, pose);
    const base = e.ready ? e : creature(speciesId, 'idle');
    if (!base.ready) {
      g.save(); g.globalAlpha = alpha * 0.8; g.fillStyle = '#c8c8d0';
      g.beginPath(); g.ellipse(x, footY - size * 0.3, size * 0.3, size * 0.28, 0, 0, Math.PI * 2); g.fill(); g.restore();
      return;
    }
    let src = base.img;
    const key = `c:${speciesId}:${base === e ? pose : 'idle'}`;
    if (silhouette) src = tint(base, key, silhouette, 1) || src;
    else if (white > 0) src = tint(base, key, '#ffffff', Math.min(1, white)) || src;
    else if (back) src = tint(base, key, '#101830', 0.18) || src;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, footY);
    g.scale((flip ? -1 : 1) * sx, sy);
    g.drawImage(src, -size / 2, -size * 0.97, size, size);
    g.restore();
  }

  /** Warm the cache for the cast likely to appear soon. */
  function prewarm(list) { for (const [fn, ...args] of list) fn(...args); }

  return { person, creature, drawPerson, drawCreature, prewarm, images };
}
