// Flat graphics lab: small documents on the real 2D spaces, mounted with the
// kernel player (mountGame), to look at every flat renderer in a browser. The
// lab fills cells and drives entities with throwaway controllers (it is a test
// harness, standing in for generators and movement primitives that have not
// landed); the renderers only read state.
import { mountGame } from '/v2/web/player.js';

const keys = new Set();
addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const k = (...names) => names.some(n => keys.has(n));
const doc = (id, title, spaces, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id, title, logline: extra.logline || '', spaces, content: extra.content || {}, systems: [], graphics: extra.graphics || [], player: extra.player, plot: extra.plot });
const rand = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
const fill = (rt, sid, x0, y0, x1, y1, block, layer) => { const api = rt.space(sid); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.setCell([x, y], block, rt, null, layer); };

// ---------- shared pixel models (from Hollow Lantern) ----------
const WICK = { kind: 'pixel', size: [16, 22], palette: { o: '#1b1626', b: '#e8dcc8', w: '#fff6d8', f: '#ffb347', k: '#2d2640' }, parts: [{ name: 'body', rect: [4, 3, 8, 12], c: 'b' }, { name: 'hood', rect: [3, 12, 10, 8], c: 'k' }, { name: 'eyes', rect: [5, 14, 6, 2], c: 'w' }, { name: 'lantern', rect: [12, 6, 3, 5], c: 'f' }, { name: 'legs', rect: [5, 0, 6, 4], c: 'o' }], anims: { idle: { frames: 4, fps: 6, loop: true }, run: { frames: 6, fps: 12, loop: true }, jump: { frames: 2, fps: 8, loop: false }, fall: { frames: 2, fps: 8, loop: false }, hurt: { frames: 2, fps: 10, loop: false }, die: { frames: 6, fps: 10, loop: false }, attack: { frames: 4, fps: 20, loop: false } }, pivot: [8, 0], glow: { color: '#ffb347', radius: 5 } };
const MOSSLING = { kind: 'pixel', size: [14, 10], palette: { g: '#4a8a3a', l: '#8ad06a', e: '#1a1a14' }, parts: [{ name: 'body', rect: [1, 0, 12, 8], c: 'g' }, { name: 'head', rect: [3, 6, 8, 4], c: 'l' }, { name: 'eyes', rect: [8, 6, 3, 2], c: 'e' }, { name: 'legs', rect: [2, 0, 10, 2], c: 'e' }], anims: { idle: { frames: 4, fps: 6, loop: true }, run: { frames: 4, fps: 10, loop: true } }, pivot: [7, 0] };

// ---------- side-view platformer: tilemap + tileset + pixel sprites + parallax + lighting ----------
function platformer() {
  const W = 90, Hh = 26;
  return {
    hint: '←/→ move · ↑ or space jump · x attack. Walk right into the dark cave.',
    record: doc('lab-platformer', 'Hollow Lantern lab', [{ id: 'cave', use: 'engine.space.tilemap', with: { tile: 16, size: [W, Hh], mode: 'side', gravity: -60 }, zones: [{ id: 'grove', name: 'Ember Grove', rect: [0, 0, 50, Hh] }, { id: 'deep', name: 'Mossgrave', rect: [50, 0, W, Hh] }] }], {
      logline: 'a lantern-bearer descends into a mossy cave',
      content: {
        blocks: [{ id: 'stone', color: '#4a4658', solid: true, tile: 'rock' }, { id: 'moss_stone', color: '#3f6a44', solid: true, tile: 'moss' }, { id: 'brick', color: '#3a5a7a', solid: true, tile: 'brick' }, { id: 'plank', color: '#8a6a3a', solid: false, tags: ['one_way'], tile: 'wood' }, { id: 'water', color: '#2a5a9a', solid: false, tags: ['liquid'], transparent: true }, { id: 'spikes', color: '#b0b4b8', solid: false, tags: ['hazard'] }, { id: 'back', color: '#4a4458', solid: true, tile: 'brick' }],
        models: { wick: WICK, mossling: MOSSLING },
        archetypes: [{ id: 'wick', kind: 'player', components: { model: 'wick', light: { radius: 6, color: '#ffb347' } } }, { id: 'mossling', kind: 'enemy', components: { model: 'mossling', health: { hp: 2, max: 2 } } }, { id: 'ember_coin', kind: 'pickup', components: {} }, { id: 'bench', kind: 'prop', components: {} }, { id: 'great_lantern', kind: 'prop', tags: ['beacon'], components: {} }],
      },
      graphics: [
        { use: 'graphics.render.tilemap', with: { pixelSnap: true, scale: 3, layerOrder: ['bg', 'solid', 'fg'] } },
        { use: 'graphics.tileset.pixel', with: { tileSize: 16, themes: [{ id: 'ember', palette: { a: '#4a3a30', b: '#ffb347', c: '#2a2018' }, pattern: 'brick', edge: 'warm' }, { id: 'moss', palette: { a: '#2c4a30', b: '#6aaa5a', c: '#1a2a1c' }, pattern: 'moss', edge: 'soft' }], zoneThemes: { grove: 'ember', deep: 'moss' } } },
        { use: 'graphics.sprite.pixel', with: { outline: '#0e0a14', shadow: false } },
        { use: 'graphics.anim.sprite', with: { squash: true, trail: ['dash'] } },
        { use: 'graphics.background.parallax', with: { layers: [{ zone: 'grove', depth: 0.1, pattern: 'scenery', color: '#000000', theme: 'forest', features: [{ kind: 'falling-leaves', density: 0.4, depth: 'near' }, { kind: 'leafy-forest', density: 0.7, depth: 'far' }] }, { zone: 'grove', depth: 0.35, pattern: 'forest', color: '#1c2a1c' }, { zone: 'deep', depth: 0.2, pattern: 'cave', color: '#141a18' }, { zone: 'deep', depth: 0.45, pattern: 'roots', color: '#162418' }, { zone: 'deep', depth: 0.6, pattern: 'spores', color: '#2c5a34' }] } },
        { use: 'graphics.camera.side', with: { zoom: 1, lookAhead: 2.5, smoothing: 0.12, roomLock: false, deadzone: [1, 2] } },
        { use: 'graphics.lighting.2d', with: { ambient: 0.12, lights: [{ follow: 'wick', radius: 6, color: '#ffb347', flicker: 0.06, shadow: true }, { follow: 'great_lantern', radius: 9, color: '#fff0c0', flicker: 0.02, shadow: true }], darkZones: ['deep'] } },
        { use: 'graphics.particles', with: { ambient: [{ preset: 'spores', rate: 6, zone: 'deep', area: 'view' }], presets: [{ id: 'spores', shape: 'glow', color: '#c8f0a0', count: 1, life: 3, speed: 0.4, gravity: -0.1 }] } },
        { use: 'graphics.post', with: { bloom: 0.6, tonemap: 'filmic', vignette: 0.35, grain: 0.04 } },
        { use: 'graphics.fx.feedback', with: { hitStop: 70, shake: 0.5, damageFlash: true } },
      ],
      player: { archetype: 'wick', space: 'cave', at: [6, 9] },
    }),
    setup(rt) {
      const s = 'cave';
      fill(rt, s, 0, 0, W - 1, 2, 'stone');
      for (let x = 0; x < W; x++) { const h = 3 + Math.round(Math.sin(x / 7) * 1.5 + Math.sin(x / 3.1) * 0.6); fill(rt, s, x, 3, x, h, x > 50 ? 'moss_stone' : 'stone'); }
      fill(rt, s, 20, 3, 26, 5, null); fill(rt, s, 20, 3, 26, 4, 'water');
      fill(rt, s, 12, 8, 17, 8, 'plank'); fill(rt, s, 28, 9, 33, 9, 'stone'); fill(rt, s, 36, 6, 38, 6, 'stone'); fill(rt, s, 40, 5, 43, 5, 'spikes');
      fill(rt, s, 50, 17, W - 1, Hh - 1, 'moss_stone'); fill(rt, s, 58, 13, 63, 16, 'moss_stone'); fill(rt, s, 70, 6, 72, 10, 'moss_stone'); fill(rt, s, 76, 9, 80, 9, 'plank'); fill(rt, s, 84, 6, 89, 16, 'moss_stone');
      fill(rt, s, 2, 6, 10, 12, 'back', 'bg'); fill(rt, s, 44, 6, 49, 14, 'back', 'bg'); fill(rt, s, 52, 5, 83, 16, 'back', 'bg');
      fill(rt, s, 30, 3, 30, 12, 'stone', 'fg');
      for (const [x, y] of [[9, 9], [15, 9.8], [30, 10.8], [56, 9], [74, 11]]) rt.spawn('mossling', { space: s, at: [x, y], components: { body: { size: [0.85, 0.6], vel: [1.2, 0], facing: 1 } } });
      for (let i = 0; i < 12; i++) rt.spawn('ember_coin', { space: s, at: [13 + i * 5, 9 + Math.sin(i) * 2], components: { body: { size: [0.6, 0.6] } } });
      rt.spawn('bench', { space: s, at: [3, 9], components: { body: { size: [1.6, 0.8] } } });
      rt.spawn('great_lantern', { space: s, at: [66, 6.8], components: { body: { size: [1.4, 1.6] } } });
      platformerControl(rt, s);
    },
  };
}
function platformerControl(rt, s) {
  const api = rt.space(s);
  rt.system('movement', r => {
    const p = r.player(); if (!p) return;
    const b = p.components.body ??= { size: [0.8, 1.3], vel: [0, 0] };
    b.size = [0.8, 1.3];
    const want = (k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0);
    b.vel[0] += (want * 7 - b.vel[0]) * (b.grounded ? 0.3 : 0.12);
    if (want) b.facing = want;
    if (b.grounded && k('arrowup', 'w', ' ')) { b.vel[1] = 17; r.emit('jump', { who: 'player' }); }
    b.vel[1] = Math.max(-24, b.vel[1] - 60 / 60);
    const was = b.grounded, res = api.slide(p, [b.vel[0] / 60, b.vel[1] / 60], r);
    if (res.blocked?.y) b.vel[1] = 0;
    b.grounded = res.grounded;
    if (!was && b.grounded) r.emit('land', { who: 'player' });
    if (k('x') && !p._atk) { p._atk = 20; r.emit('attack', { who: 'player', move: 'jab' }); for (const e of Object.values(r.state.entities)) if (e.archetype === 'mossling' && Math.hypot(e.at[0] - p.at[0], e.at[1] - p.at[1]) < 1.8) { e.components.health.hp--; r.emit('hit', { who: 'player', target: e.id, amount: 1 }); if (e.components.health.hp <= 0) { r.emit('defeated', { who: 'player', target: e.id }); r.despawn(e.id); } } }
    if (p._atk) p._atk--;
    for (const e of Object.values(r.state.entities)) {
      if (e.archetype === 'mossling') { const eb = e.components.body; eb.vel[1] = Math.max(-20, (eb.vel[1] || 0) - 1); const rr = api.slide(e, [eb.vel[0] / 60, eb.vel[1] / 60], r); if (rr.blocked?.x) { eb.vel[0] *= -1; eb.facing = Math.sign(eb.vel[0]); } if (rr.blocked?.y) eb.vel[1] = 0; eb.grounded = rr.grounded;
        if (Math.abs(e.at[0] - p.at[0]) < 0.8 && Math.abs(e.at[1] - p.at[1]) < 1) { if (b.vel[1] < -2) { r.emit('stomp', { who: 'player', target: e.id }); r.emit('defeated', { who: 'player', target: e.id }); r.despawn(e.id); b.vel[1] = 12; } else if (!p._inv) { p._inv = 60; r.emit('hurt', { who: 'player', target: 'player', amount: 1 }); b.vel = [-Math.sign(e.at[0] - p.at[0]) * 8, 9]; } } }
      if (e.archetype === 'ember_coin' && Math.hypot(e.at[0] - p.at[0], e.at[1] - p.at[1]) < 0.9) { r.emit('collect', { who: 'player', source: e.id }); r.despawn(e.id); }
    }
    if (p._inv) p._inv--;
    p.components.health = { hp: 5, max: 5, invulnerable: (p._inv || 0) / 60 };
  });
}

// ---------- top-down adventure: tilemap topdown with generated art ----------
function topdown() {
  return {
    hint: 'Arrows / WASD move. No art data: every character, pickup and tile here is generated.',
    record: doc('lab-topdown', 'Meadow Quest lab', [{ id: 'field', use: 'engine.space.tilemap', with: { tile: 16, size: [40, 30], mode: 'topdown', layers: ['ground', 'solid'], collisionLayers: ['solid'] } }], {
      logline: 'a meadow village adventure',
      content: { blocks: [{ id: 'grass', color: '#5aa040', solid: false, tile: 'grass' }, { id: 'sand', color: '#d8c080', solid: false, tile: 'sand' }, { id: 'wall', color: '#8a7a6a', solid: true, tile: 'brick' }, { id: 'tree', color: '#2f7a3a', solid: true }, { id: 'water', color: '#3a7ac8', solid: false, tags: ['liquid'] }],
        archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'villager', kind: 'npc', components: { interact: { id: 'talk' } } }, { id: 'wizard', kind: 'npc', components: {} }, { id: 'slime', kind: 'enemy', components: { health: { hp: 1, max: 1 } } }, { id: 'bat', kind: 'enemy', components: {} }, { id: 'wolf', kind: 'enemy', components: {} }, { id: 'gem', kind: 'pickup', components: {} }, { id: 'heart', kind: 'pickup', components: {} }, { id: 'treasure_chest', kind: 'goal', components: {} }] },
      graphics: [{ use: 'graphics.render.tilemap', with: { scale: 3 } }, { use: 'graphics.camera.top-down', with: { tilt: 90 } }],
      player: { archetype: 'hero', space: 'field', at: [8, 8] },
    }),
    setup(rt) {
      const s = 'field';
      fill(rt, s, 0, 0, 39, 29, 'grass', 'ground'); fill(rt, s, 14, 4, 26, 10, 'sand', 'ground');
      fill(rt, s, 0, 0, 39, 0, 'wall'); fill(rt, s, 0, 29, 39, 29, 'wall'); fill(rt, s, 0, 0, 0, 29, 'wall'); fill(rt, s, 39, 0, 39, 29, 'wall');
      fill(rt, s, 18, 14, 24, 18, 'wall'); fill(rt, s, 20, 14, 22, 14, null);
      fill(rt, s, 28, 18, 34, 24, 'water', 'ground');
      for (let i = 0; i < 30; i++) { const x = 2 + Math.floor(rand() * 36), y = 2 + Math.floor(rand() * 26); if (Math.abs(x - 8) + Math.abs(y - 8) > 4) fill(rt, s, x, y, x, y, 'tree'); }
      const at = { villager: [11, 9], wizard: [16, 12], slime: [25, 22], bat: [30, 10], wolf: [10, 20], gem: [13, 7], heart: [6, 12], treasure_chest: [21, 16] };
      for (const [a, p] of Object.entries(at)) rt.spawn(a, { space: s, at: [p[0] + 0.5, p[1] + 0.5], components: { body: { size: [0.8, 0.8], vel: [0, 0] } } });
      const api = rt.space(s);
      rt.system('movement', r => {
        const p = r.player(); const b = p.components.body ??= { size: [0.8, 0.8], vel: [0, 0] }; b.size = [0.8, 0.8];
        const v = [(k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0), (k('arrowup', 'w') ? 1 : 0) - (k('arrowdown', 's') ? 1 : 0)];
        b.vel = v.map(c => c * 5); if (v[0]) b.facing = v[0];
        api.slide(p, [b.vel[0] / 60, b.vel[1] / 60], r);
        for (const e of Object.values(r.state.entities)) if (e.id !== 'player' && /slime|bat|wolf/.test(e.archetype)) { const t = r.state.frame / 60 + e.id.length; const eb = e.components.body; eb.vel = [Math.cos(t * 0.7) * 1.5, Math.sin(t * 0.9) * 1.5]; api.slide(e, [eb.vel[0] / 60, eb.vel[1] / 60], r); }
      });
    },
  };
}

// ---------- maze: grid with neon walls, pellets, vector ghosts and the chomper ----------
function maze() {
  const W = 21, Hh = 15;
  return {
    hint: 'Arrows steer the chomper; pellets pop when eaten.',
    record: doc('lab-maze', 'Neon Maze lab', [{ id: 'maze', use: 'engine.space.grid', with: { size: [W, Hh], yAxis: 'down', wrap: 'x', rules: { wall: { pass: false } } } }], {
      content: { blocks: [{ id: 'wall', color: '#2a3cff', solid: true }, { id: 'pellet', color: '#ffd8a0', solid: false, tile: 'pellet' }, { id: 'power_pellet', color: '#ffe0c0', solid: false, tile: 'power' }], models: { chomper: { kind: 'vector', preset: 'chomp', color: '#ffd23f' }, red: { kind: 'vector', preset: 'ghost', color: '#ff3b3b' }, pink: { kind: 'vector', preset: 'ghost', color: '#ff9ad8' }, cyan: { kind: 'vector', preset: 'ghost', color: '#3ae0ff' }, orange: { kind: 'vector', preset: 'ghost', color: '#ffa53a' } },
        archetypes: [{ id: 'chomper', kind: 'player', components: { model: 'chomper' } }, ...['red', 'pink', 'cyan', 'orange'].map(c => ({ id: `ghost_${c}`, kind: 'enemy', components: { model: c } }))] },
      graphics: [{ use: 'graphics.render.grid', with: { style: 'neon', wallColor: '#2a48ff', highlights: [] } }, { use: 'graphics.post', with: { bloom: 0.9, vignette: 0.4, scanlines: true } }],
      player: { archetype: 'chomper', space: 'maze', at: [1, 1] },
    }),
    setup(rt) {
      const s = 'maze', api = rt.space(s);
      // A carved maze (DFS on odd cells) with loops, then pellets everywhere open.
      const open = new Set(['1,1']); const stack = [[1, 1]];
      while (stack.length) { const [x, y] = stack[stack.length - 1]; const n = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a > 0 && b > 0 && a < W - 1 && b < Hh - 1 && !open.has(`${a},${b}`)); if (!n.length) { stack.pop(); continue; } const [a, b] = n[Math.floor(rand() * n.length)]; open.add(`${a},${b}`); open.add(`${(a + x) / 2},${(b + y) / 2}`); stack.push([a, b]); }
      for (let i = 0; i < 30; i++) { const x = 1 + Math.floor(rand() * (W - 2)), y = 1 + Math.floor(rand() * (Hh - 2)); if ((x + y) % 2) open.add(`${x},${y}`); }
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) api.setCell([x, y], open.has(`${x},${y}`) ? ([`1,1`, `${W - 2},1`, `1,${Hh - 2}`, `${W - 2},${Hh - 2}`].includes(`${x},${y}`) ? 'power_pellet' : 'pellet') : 'wall', rt);
      api.setCell([1, 1], null, rt);
      const cells = [...open].map(c => c.split(',').map(Number));
      ['red', 'pink', 'cyan', 'orange'].forEach((c, i) => rt.spawn(`ghost_${c}`, { space: s, at: cells[Math.floor(cells.length / 2) + i * 3] }));
      let dir = [1, 0];
      rt.system('movement', r => {
        const p = r.player(), f = r.state.frame;
        if (k('arrowright')) dir = [1, 0]; if (k('arrowleft')) dir = [-1, 0]; if (k('arrowup')) dir = [0, -1]; if (k('arrowdown')) dir = [0, 1];
        const b = p.components.body ??= { size: [1, 1], vel: [0, 0] }; b.vel = [dir[0] * 6, -dir[1] * 6];
        if (f % 9 === 0) { const nx = (p.at[0] + dir[0] + W) % W, ny = p.at[1] + dir[1]; if (api.getCell([nx, ny]) !== 'wall') { p.at = [nx, ny]; const c = api.getCell([nx, ny]); if (c === 'pellet' || c === 'power_pellet') { api.setCell([nx, ny], null, r); r.emit(c === 'pellet' ? 'score' : 'collect', { who: 'player', amount: c === 'pellet' ? 10 : 50 }); } } }
        if (f % 14 === 0) for (const e of Object.values(r.state.entities)) if (e.id !== 'player') { const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => api.getCell([e.at[0] + dx, e.at[1] + dy]) !== 'wall'); const [dx, dy] = opts[Math.floor(rand() * opts.length)] || [0, 0]; e.at = [e.at[0] + dx, e.at[1] + dy]; (e.components.body ??= { size: [1, 1], vel: [0, 0] }).vel = [dx * 4, -dy * 4]; }
      });
    },
  };
}

// ---------- tactics: iso grid board with highlights ----------
function tactics() {
  return {
    hint: 'Isometric board: hover cells, click units to select (move range shows for the player).',
    record: doc('lab-tactics', 'Tactics lab', [{ id: 'board', use: 'engine.space.grid', with: { size: [10, 10], rules: { rock: { pass: false } } } }], {
      content: { blocks: [{ id: 'grass', color: '#6aa848', solid: false }, { id: 'water', color: '#3a7ac8', solid: false }, { id: 'rock', color: '#8a8478', solid: true }],
        archetypes: [{ id: 'knight', kind: 'player', components: { move: { range: 3 } } }, { id: 'archer', kind: 'npc', components: {} }, { id: 'orc_brute', kind: 'enemy', components: {} }, { id: 'goblin', kind: 'enemy', components: {} }] },
      graphics: [{ use: 'graphics.render.grid', with: { style: 'board', highlights: [{ source: 'hover', range: 'cell' }, { source: 'player', range: 'move' }, { source: 'selected', range: 'cell', color: '#ffd23f' }] } }, { use: 'graphics.camera.isometric', with: { angle: 30, rotatable: true } }],
      player: { archetype: 'knight', space: 'board', at: [2, 2] },
    }),
    setup(rt) {
      const s = 'board', api = rt.space(s);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) api.setCell([x, y], (x - 6) ** 2 + (y - 6) ** 2 < 3 ? 'water' : 'grass', rt);
      for (const [x, y] of [[4, 4], [4, 5], [7, 2], [1, 7]]) api.setCell([x, y], 'rock', rt);
      rt.spawn('archer', { space: s, at: [1, 3] }); rt.spawn('orc_brute', { space: s, at: [7, 7] }); rt.spawn('goblin', { space: s, at: [8, 5] });
    },
  };
}

// ---------- match-3: gems that pop and drop ----------
function match3() {
  const C = ['#ff4a5a', '#3a8aff', '#4ad06a', '#ffd23a', '#b05aff', '#ff8a2a'];
  return {
    hint: 'Gems in six silhouettes; cleared cells pop, new gems drop in.',
    record: doc('lab-match', 'Gem Swap lab', [{ id: 'board', use: 'engine.space.grid', with: { size: [8, 8], yAxis: 'down' } }], {
      content: { blocks: C.map((c, i) => ({ id: `gem_${i}`, color: c, solid: false, tile: 'gem' })), archetypes: [{ id: 'cursor', kind: 'player', components: { model: { kind: 'vector', preset: 'star', color: '#ffffff' } } }] },
      graphics: [{ use: 'graphics.render.grid', with: { style: 'flat', floorColor: '#2a2440', highlights: [{ source: 'hover', range: 'cell' }] } }, { use: 'graphics.post', with: { vignette: 0.3 } }],
      player: { archetype: 'cursor', space: 'board', at: [-3, -3] },
    }),
    setup(rt) {
      const api = rt.space('board');
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) api.setCell([x, y], `gem_${Math.floor(rand() * 6)}`, rt);
      rt.system('rules', r => { const f = r.state.frame; if (f % 40 === 0) { const x = Math.floor(rand() * 6), y = Math.floor(rand() * 8); for (let i = 0; i < 3; i++) api.setCell([x + i, y], null, r); } if (f % 40 === 20) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (api.getCell([x, y]) == null) api.setCell([x, y], `gem_${Math.floor(rand() * 6)}`, r); });
    },
  };
}

// ---------- physics: materials, joints, shards ----------
function physics() {
  return {
    hint: 'Space launches a ball at the tower; glass shatters, wood and stone crack.',
    record: doc('lab-physics', 'Tower Topple lab', [{ id: 'world', use: 'engine.space.physics2d', with: { bounds: [24, 13], walls: [{ id: 'ground', kind: 'box', at: [12, 0.5], size: [24, 1] }, { id: 'ramp', kind: 'poly', at: [3, 1.5], points: [[-2, -0.5], [2, -0.5], [2, 0.5]] }, { id: 'rail', kind: 'seg', points: [[19, 6], [23, 7]] }] } }], {
      logline: 'a slingshot puzzle on a sunny meadow',
      content: { archetypes: [{ id: 'ball', kind: 'player', components: {} }, { id: 'wood_plank', kind: 'prop', components: {} }, { id: 'glass_pane', kind: 'prop', components: {} }, { id: 'stone_block', kind: 'prop', components: {} }, { id: 'tnt_crate', kind: 'prop', components: {} }, { id: 'pig', kind: 'enemy', components: {} }] },
      graphics: [{ use: 'graphics.render.physics2d' }],
      player: { archetype: 'ball', space: 'world', at: [2, 3], components: { body: { shape: { kind: 'circle', r: 0.35 }, density: 4 } } },
    }),
    setup(rt) {
      const s = 'world', box = (a, x, y, w, h, extra = {}) => rt.spawn(a, { space: s, at: [x, y], components: { body: { shape: { kind: 'box', w, h }, ...extra }, health: { hp: 3, max: 3 } } });
      for (let i = 0; i < 3; i++) { box('wood_plank', 14 + i * 2, 1.9, 0.3, 1.8); box('wood_plank', 14 + i * 2, 1.9, 0.3, 1.8); }
      box('glass_pane', 15, 3, 2.4, 0.25); box('glass_pane', 17, 3, 2.4, 0.25); box('stone_block', 16, 3.6, 1, 1); box('tnt_crate', 18, 1.5, 0.9, 0.9);
      rt.spawn('pig', { space: s, at: [16, 4.6], components: { body: { shape: { kind: 'circle', r: 0.45 } } } });
      rt.system('input', r => { if (k(' ') && !r.state.vars.shot) { r.state.vars.shot = 1; const p = r.player(); r.space(s).setVelocity?.(p, [16, 6], r); } });
      rt.on('impact', (ev, r) => { if (ev.impulse > 2) for (const id of [ev.a, ev.b]) { const e = r.entity(id); if (e?.archetype === 'glass_pane') r.despawn(id); else if (e?.components?.health) e.components.health.hp = Math.max(0, e.components.health.hp - 1); } });
    },
  };
}

// ---------- fighters: arena2d with fighter rigs ----------
function fighter() {
  return {
    hint: '←/→ move · ↑ jump · z punch · x kick. The CPU fights back; the camera frames both.',
    record: doc('lab-fighter', 'Dojo Duel lab', [{ id: 'stage', use: 'engine.space.arena2d', with: { size: [20, 10], gravity: -40, solids: [[0, 0, 20, 1]] } }], {
      logline: 'martial artists duel at sunset in a castle courtyard',
      content: { models: { ryo: { kind: 'rig', rig: 'fighter', look: { outfit: 'gi', hair: 'spiky', headwear: 'headband', primary: '#f4f4f0', accent: '#d8322a', skin: '#e8b48c', secondary: '#f4f4f0', hairColor: '#1a1418', build: 'average' } }, kaz: { kind: 'rig', rig: 'fighter', look: { outfit: 'vest', hair: 'mohawk', headwear: 'none', primary: '#2a5ad8', accent: '#f5c542', skin: '#c08a64', secondary: '#2a2a34', hairColor: '#c84a2a', build: 'heavy' } } },
        archetypes: [{ id: 'ryo', kind: 'player', components: { model: 'ryo', health: { hp: 100, max: 100 } } }, { id: 'kaz', kind: 'enemy', components: { model: 'kaz', health: { hp: 100, max: 100 } } }] },
      graphics: [{ use: 'graphics.render.arena2d', with: { view: 'side' } }, { use: 'graphics.fx.feedback', with: { hitStop: 80, shake: 0.6, zoomOn: ['ko'], slowmoOn: ['ko'] } }, { use: 'graphics.post', with: { vignette: 0.3, tonemap: 'filmic' } }],
      player: { archetype: 'ryo', space: 'stage', at: [7, 1.9] },
    }),
    setup(rt) {
      const s = 'stage', api = rt.space(s);
      rt.spawn('kaz', { space: s, at: [13, 1.9], components: { body: { size: [1, 1.8], vel: [0, 0], facing: -1 } } });
      rt.system('movement', r => {
        const p = r.player(), cpu = Object.values(r.state.entities).find(e => e.archetype === 'kaz'), f = r.state.frame;
        for (const [e, ctl] of [[p, { l: k('arrowleft'), r: k('arrowright'), j: k('arrowup'), a: k('z') ? 'jab' : k('x') ? 'kick' : null }], [cpu, { l: cpu && p.at[0] < cpu.at[0] - 1.6 && f % 90 < 50, r: cpu && p.at[0] > cpu.at[0] + 1.6 && f % 90 < 50, j: f % 240 === 100, a: f % 70 === 30 ? (f % 140 === 30 ? 'kick' : 'jab') : null }]]) {
          if (!e) continue; const b = e.components.body ??= { size: [1, 1.8], vel: [0, 0] }; b.size = [1, 1.8];
          const other = e === p ? cpu : p; if (other) b.facing = Math.sign(other.at[0] - e.at[0]) || 1;
          b.vel[0] = ((ctl.r ? 1 : 0) - (ctl.l ? 1 : 0)) * 4.5;
          if (ctl.j && b.grounded) b.vel[1] = 15; b.vel[1] -= 40 / 60;
          const res = api.slide(e, [b.vel[0] / 60, b.vel[1] / 60], r); if (res.blocked?.y) b.vel[1] = 0; b.grounded = res.grounded;
          if (ctl.a && !e._cd) { e._cd = 22; r.emit('attack', { who: e.id, move: ctl.a }); if (other && Math.abs(other.at[0] - e.at[0]) < 1.9 && Math.abs(other.at[1] - e.at[1]) < 1.2) { const dmg = ctl.a === 'kick' ? 9 : 5; other.components.health.hp = Math.max(0, other.components.health.hp - dmg); r.emit('hit', { who: e.id, target: other.id, amount: dmg }); if (other.components.health.hp === 0) { r.emit('ko', { who: e.id, target: other.id }); other.components.health.hp = 100; } } }
          if (e._cd) e._cd--;
        }
      });
    },
  };
}

// ---------- shmup: arena2d top view with vector ships ----------
function shmup() {
  return {
    hint: 'Arrows fly; hold space to fire. Bugs, moths, saucers and rocks are vector presets.',
    record: doc('lab-shmup', 'Star Swarm lab', [{ id: 'sky', use: 'engine.space.arena2d', with: { size: [10, 16], gravity: 0 } }], {
      content: { archetypes: [{ id: 'ship', kind: 'player', components: {} }, { id: 'bug', kind: 'enemy', components: { health: { hp: 1, max: 1 } } }, { id: 'moth', kind: 'enemy', components: { health: { hp: 1, max: 1 } } }, { id: 'saucer', kind: 'enemy', components: { health: { hp: 2, max: 2 } } }, { id: 'asteroid', kind: 'enemy', components: { health: { hp: 3, max: 3 } } }, { id: 'laser_shot', kind: 'projectile', components: {} }] },
      graphics: [{ use: 'graphics.render.arena2d', with: { view: 'top' } }, { use: 'graphics.post', with: { bloom: 1, vignette: 0.3 } }],
      player: { archetype: 'ship', space: 'sky', at: [5, 2] },
    }),
    setup(rt) {
      const s = 'sky';
      const kinds = ['bug', 'moth', 'saucer', 'asteroid'];
      rt.system('movement', r => {
        const p = r.player(), f = r.state.frame, b = p.components.body ??= { size: [0.9, 0.9], vel: [0, 0] };
        b.vel = [((k('arrowright') ? 1 : 0) - (k('arrowleft') ? 1 : 0)) * 6, ((k('arrowup') ? 1 : 0) - (k('arrowdown') ? 1 : 0)) * 6 + 0.01];
        p.at = [Math.min(9.5, Math.max(0.5, p.at[0] + b.vel[0] / 60)), Math.min(15, Math.max(0.5, p.at[1] + b.vel[1] / 60))];
        if (k(' ') && f % 8 === 0) { r.spawn('laser_shot', { space: s, at: [p.at[0], p.at[1] + 0.6], components: { body: { size: [0.18, 0.5], vel: [0, 18] } } }); r.emit('shoot', { who: 'player' }); }
        if (f % 50 === 0) { const a = kinds[Math.floor(rand() * 4)]; r.spawn(a, { space: s, at: [1 + rand() * 8, 16.5], components: { body: { size: a === 'asteroid' ? [1.2, 1.2] : [0.9, 0.9], vel: [Math.sin(f) * 1.5, -2 - rand() * 2] } } }); }
        for (const e of Object.values(r.state.entities)) {
          if (e.id === 'player') continue; const v = e.components.body.vel; e.at = [e.at[0] + v[0] / 60 + (e.archetype === 'moth' ? Math.sin(f / 15) * 0.03 : 0), e.at[1] + v[1] / 60];
          if (e.at[1] > 17 || e.at[1] < -1) { r.despawn(e.id); continue; }
          if (e.archetype === 'laser_shot') for (const o of Object.values(r.state.entities)) if (kinds.includes(o.archetype) && Math.hypot(o.at[0] - e.at[0], o.at[1] - e.at[1]) < 0.7) { r.despawn(e.id); o.components.health.hp--; r.emit('hit', { who: 'player', target: o.id }); if (o.components.health.hp <= 0) { r.emit('defeated', { who: 'player', target: o.id }); r.emit('score', { who: 'player', amount: 100 }); r.despawn(o.id); } break; }
        }
      });
    },
  };
}

// ---------- runner: pseudo-3D track ----------
function runner() {
  return {
    hint: '←/→ switch lanes · ↑ jump. Barriers, gates and trains are 3D boxes; coins are billboards.',
    record: doc('lab-runner', 'Rail Rush lab', [{ id: 'rails', use: 'engine.space.track', with: { lanes: 3, laneWidth: 1.7 } }], {
      logline: 'a city subway runner at night with neon',
      content: { archetypes: [{ id: 'runner', kind: 'player', components: {} }, { id: 'coin', kind: 'pickup', components: {} }, { id: 'barrier', kind: 'hazard', tags: ['obstacle'], components: {} }, { id: 'train', kind: 'hazard', tags: ['obstacle'], components: {} }, { id: 'gate', kind: 'hazard', tags: ['obstacle'], components: {} }] },
      graphics: [{ use: 'graphics.render.track', with: { scenery: 'city' } }, { use: 'graphics.post', with: { bloom: 0.5, vignette: 0.3 } }],
      player: { archetype: 'runner', space: 'rails', at: [0, 1, 0.9], components: { body: { size: [0.6, 0.6, 1.8], vel: [14, 0, 0] } } },
    }),
    setup(rt) {
      const s = 'rails';
      for (let i = 0; i < 60; i++) { const z = 25 + i * 9, lane = Math.floor(rand() * 3), t = ['barrier', 'train', 'gate', 'coin', 'coin'][Math.floor(rand() * 5)]; const size = t === 'train' ? [8, 0.9, 2.7] : t === 'gate' ? [0.3, 0.9, 0.75] : t === 'barrier' ? [0.3, 0.9, 0.7] : [0.5, 0.5, 0.5]; rt.spawn(t, { space: s, at: [t === 'train' ? z + 4 : z, lane, t === 'gate' ? 1.5 : t === 'coin' ? 0.8 : size[2] / 2], components: { body: { size, vel: [0, 0, 0] } } }); }
      let lane = 1, cd = 0, vy = 0;
      rt.system('movement', r => {
        const p = r.player(), b = p.components.body; b.vel[0] = 14;
        if (!cd && k('arrowleft')) { lane = Math.max(0, lane - 1); cd = 10; } if (!cd && k('arrowright')) { lane = Math.min(2, lane + 1); cd = 10; } if (cd) cd--;
        if (p.at[2] <= 0.91 && k('arrowup')) { vy = 9; r.emit('jump', { who: 'player' }); }
        vy -= 30 / 60; const h = Math.max(0.9, p.at[2] + vy / 60); if (h === 0.9) vy = 0;
        p.at = [p.at[0] + 14 / 60, p.at[1] + (lane - p.at[1]) * 0.25, h];
        for (const e of Object.values(r.state.entities)) if (e.archetype === 'coin' && Math.abs(e.at[0] - p.at[0]) < 0.6 && Math.abs(e.at[1] - p.at[1]) < 0.5) { r.emit('collect', { who: 'player', source: e.id }); r.despawn(e.id); }
      });
    },
  };
}

// ---------- story: graph space scene cards ----------
async function story() {
  const d = await (await fetch('/v2/games/quiet-manor.json')).json();
  d.graphics = [{ use: 'graphics.render.dom' }, { use: 'graphics.ui.story' }];
  return { hint: 'Scene cards for graph spaces: choose exits below; the card crossfades.', record: d, setup() {} };
}

const SCENES = { platformer, topdown, maze, tactics, match3, physics, fighter, shmup, runner, story };
let game = null;
async function open(name) {
  game?.dispose();
  const view = document.getElementById('view');
  const scene = await SCENES[name]();
  document.getElementById('hint').textContent = scene.hint;
  for (const b of document.querySelectorAll('#scenes button')) b.setAttribute('aria-pressed', String(b.dataset.scene === name));
  try {
    game = mountGame(view, { version: 1, doc: scene.record });
    scene.setup(game.rt);
    window.labRt = game.rt;
    // Drive the game by hand (the display loop pauses while the pane is hidden).
    window.labShot = async name => { const c = [...document.querySelectorAll('#view canvas')].find(x => x.style.display !== 'none'); const b = await new Promise(r => c.toBlob(r)); await fetch(`/__save?name=${name}`, { method: 'POST', body: b }); return name; };
    window.labRun = (n = 60, input = {}) => { for (let i = 0; i < n; i++) { game.rt.step(input); game.rt.caches.flat?.frame(1, 1 / 60); } return game.rt.state.frame; };
  } catch (err) { view.textContent = `${err.message} ${JSON.stringify(err.errors || []).slice(0, 2000)}`; console.error(err); }
  history.replaceState(null, '', `#${name}`);
}
const nav = document.getElementById('scenes');
for (const name of Object.keys(SCENES)) { const b = document.createElement('button'); b.textContent = name; b.dataset.scene = name; b.onclick = () => open(name); nav.append(b); }
open(location.hash.slice(1) in SCENES ? location.hash.slice(1) : 'platformer');
