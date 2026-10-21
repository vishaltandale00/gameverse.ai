// Paint every asset a 2D game needs from its art direction: character frames,
// props, the tileset, the background and title key art. Pure and
// deterministic (no I/O): the same direction and spec give byte-identical SVGs,
// so content-hashed asset names make unchanged art keep its URL across versions.
import { paintCharacter, POSE_NAMES } from './characters.js';
import { paintProp } from './props.js';
import { paintTileset } from './tiles.js';
import { paintScenery } from './scenery.js';
import { resolveLook, paintOptions, castColors, styleAssets, nearestIn, recolorSvg, snapOpacity } from './look.js';

export const ART_PAINTER_VERSION = 'v2-art-procedural/0.2';
const ROLE_OF_TAG = { player: 'player', enemy: 'enemy', collectible: 'pickup', hazard: 'hazard', goal: 'goal' };

/** Which entity kinds play which cast role. */
export function castKinds(spec) {
  const out = {};
  for (const [kind, def] of Object.entries(spec.entities || {})) {
    if (def.solid) continue;
    const role = ROLE_OF_TAG[(def.tags || []).find(t => ROLE_OF_TAG[t])];
    if (role) (out[role] ??= []).push(kind);
  }
  return out;
}

// Make defs ids unique when several documents are nested into one.
const scope = (svg, prefix) => svg.replace(/(id="|url\(#|href="#)([a-z])(\d+)/g, `$1${prefix}$2$3`);
const inner = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const nest = (svg, x, y, w, h, viewBox, prefix, extra = '') => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox}" overflow="visible"${extra}>${inner(scope(svg, prefix))}</svg>`;

function titleArt(direction, pixel) {
  const scene = paintScenery(direction.scenery, { pixel: false, seed: 'title' });
  const hero = paintCharacter(direction.player, 'jump');
  const foe = paintCharacter(direction.enemy, 'idle');
  const prize = paintProp(direction.pickup.kind, { color: direction.pickup.color });
  // Hero bottom-left mid-leap, foe lower right facing in, pickups arcing between; upper third stays calm for the logo.
  const body = nest(scene, 0, 0, 384, 256, '0 0 384 256', 'sc')
    + `<ellipse cx="120" cy="246" rx="70" ry="10" fill="#000" opacity=".25"/><ellipse cx="292" cy="248" rx="46" ry="8" fill="#000" opacity=".22"/>`
    + `<g transform="translate(584 0) scale(-1 1)">${nest(foe, 236, 140, 112, 112, '0 0 100 100', 'fo')}</g>`
    + [[178, 150, 26], [208, 128, 22], [236, 116, 18]].map(([x, y, s], i) => nest(prize, x, y, s, s, '0 0 64 64', `pr${i}`)).join('')
    + nest(hero, 40, 96, 170, 170, '0 0 100 100', 'he');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 384 256">${body}</svg>`;
}

/** Title key art from finished pieces: the background, the hero mid-leap, the foe and an arc of pickups. */
function titleFrom({ scene, hero, foe, prize, sceneBox = '0 0 384 256' }) {
  const body = nest(scene, 0, 0, 384, 256, sceneBox, 'sc')
    + `<ellipse cx="120" cy="246" rx="70" ry="10" fill="#000000" opacity=".25"/><ellipse cx="292" cy="248" rx="46" ry="8" fill="#000000" opacity=".22"/>`
    + `<g transform="translate(584 0) scale(-1 1)">${nest(foe, 236, 140, 112, 112, '0 0 100 100', 'fo')}</g>`
    + [[178, 150, 26], [208, 128, 22], [236, 116, 18]].map(([x, y, s], i) => nest(prize, x, y, s, s, '0 0 64 64', `pr${i}`)).join('')
    + nest(hero, 40, 96, 170, 170, '0 0 100 100', 'he');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 384 256">${body}</svg>`;
}

/**
 * Returns { assets: [{ key, svg, targets, cls, role }], assemble(urlOf) → art record, look, palette, separation }.
 * assemble receives a function mapping an asset key to its stored URL.
 * A direction with a `look` (art/look.js) paints every asset in it: one palette, outline width and pixel scale,
 * banded shading, hazed depth and the declared player separation. A stored direction without one paints as before.
 */
export function paintGameArt(direction, spec) {
  const look = direction.look ? resolveLook(direction.look, { style: direction.style }) : null;
  const pixel = look ? Boolean(look.pixel) : direction.style === 'pixel';
  const cast = look ? castColors(direction, look) : direction;
  const opt = cls => (look ? paintOptions(look, cls) : { pixel });
  const kinds = castKinds(spec);
  const assets = [];
  const add = (key, svg, targets, cls, role = null) => { assets.push({ key, svg, targets, cls, role }); return key; };
  const sprites = {}, frames = {};
  for (const role of ['player', 'enemy']) for (const kind of kinds[role] || []) {
    frames[kind] = {};
    for (const pose of POSE_NAMES) frames[kind][pose] = add(`frame-${kind}-${pose}`, paintCharacter(cast[role], pose, opt('character')), [role, 'style'], 'character', role);
    sprites[kind] = frames[kind].idle;
  }
  for (const role of ['pickup', 'hazard', 'goal']) for (const kind of kinds[role] || []) sprites[kind] = add(`sprite-${kind}`, paintProp(cast[role].kind, { color: cast[role].color, ...opt(role === 'goal' ? 'goal' : 'prop') }), [role, 'style'], role === 'goal' ? 'goal' : 'prop', role);
  // Projectiles and other tagged kinds without a role reuse the pickup look tinted by the accent.
  const tiles = paintTileset(cast.tiles, { ...opt('tileset'), seed: spec.id || spec.title });
  const tileset = add('tileset', tiles.svg, ['tiles', 'style'], 'tileset');
  const background = add('background', paintScenery(cast.scenery, { ...opt('background'), seed: spec.id || spec.title }), ['scenery', 'style'], 'background');
  const titleTargets = ['scenery', 'player', 'enemy', 'pickup', 'style'];
  let styled = null;
  if (look) {
    // The title is composed from the styled pieces, so it shares their palette and separation.
    styled = styleAssets(assets, look);
    assets.splice(0, assets.length, ...styled.assets);
    const svgOf = key => assets.find(a => a.key === key)?.svg;
    const heroKind = kinds.player?.[0], foeKind = kinds.enemy?.[0];
    const piece = (svg, fallback) => svg || fallback();
    const near = nearestIn(styled.palette);
    const title = titleFrom({
      scene: svgOf('background'),
      hero: piece(heroKind && svgOf(frames[heroKind].jump), () => paintCharacter(cast.player, 'jump', opt('character'))),
      foe: piece(foeKind && svgOf(frames[foeKind].idle), () => paintCharacter(cast.enemy, 'idle', opt('character'))),
      prize: piece(kinds.pickup?.[0] && svgOf(`sprite-${kinds.pickup[0]}`), () => paintProp(cast.pickup.kind, { color: cast.pickup.color, ...opt('prop') })),
    });
    add('title', recolorSvg(look.forbid.includes('translucency') ? snapOpacity(title) : title, near), titleTargets, 'title');
  } else add('title', titleArt(direction, pixel), titleTargets, 'title');
  const title = 'title';
  const style = pixel ? (/pixel/i.test(direction.styleLabel) ? direction.styleLabel : `${direction.styleLabel} (pixel art)`) : direction.styleLabel.replace(/pixel/gi, '').trim() || 'clean cartoon vector art';
  // The realized palette is stored with the direction, so a revision paints new assets in the same colors.
  const stored = look && styled ? { ...direction, look: { ...direction.look, palette: { ...direction.look.palette, colors: styled.palette } } } : direction;
  return {
    assets, look, palette: styled?.palette ?? null, separation: styled?.separation ?? null,
    assemble: url => ({
      procedural: true, painter: ART_PAINTER_VERSION, style, font: direction.font, direction: stored,
      sprites: Object.fromEntries(Object.entries(sprites).map(([k, v]) => [k, url(v)])),
      frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, Object.fromEntries(Object.entries(f).map(([p, v]) => [p, url(v)]))])),
      tiles: {}, tileset: { url: url(tileset), ...tiles.layout }, background: url(background), title: url(title),
    }),
  };
}
