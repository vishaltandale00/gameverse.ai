import * as THREE from '/runtime/three/three.module.js';
import { FIRE_RED_ENTRANCE } from './neighborhood-math.js';

// Everything in this scene is authored here: geometry, lettering and seeded textures.
// No remote assets, captured game content, or downloaded city models are used.
export const BLOCKS = [
  { x: -44, z: -33, width: 68, depth: 46, name: 'Foundry Row' },
  { x: 44, z: -33, width: 68, depth: 46, name: 'Juniper Court' },
  { x: 44, z: 33, width: 68, depth: 46, name: 'Market Quarter' },
  { x: -44, z: 33, width: 68, depth: 46, name: 'Alder Garden', park: true },
];

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function surface(kind, seed = 1) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d'), random = seeded(seed);
  const image = context.createImageData(512, 512);
  const base = kind === 'asphalt' ? [65, 68, 67] : kind === 'brick' ? [130, 93, 72] : kind === 'grass' ? [104, 114, 74] : [194, 184, 161];
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = (random() - 0.5) * (kind === 'asphalt' ? 34 : 23);
    image.data[i] = base[0] + grain; image.data[i + 1] = base[1] + grain; image.data[i + 2] = base[2] + grain; image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  if (kind === 'brick') {
    context.lineWidth = 3; context.strokeStyle = '#a99d86';
    for (let y = 0; y < 512; y += 32) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(512, y); context.stroke();
      for (let x = (y / 32 % 2) * -40; x < 512; x += 80) {
        context.strokeRect(x, y, 80, 32);
        context.fillStyle = `rgba(30,20,12,${random() * 0.12})`; context.fillRect(x + 3, y + 3, 74, 26);
      }
    }
  } else if (kind === 'paving') {
    context.strokeStyle = '#888477'; context.lineWidth = 1.6;
    for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
      context.strokeRect(x, y, 128, 128); context.fillStyle = `rgba(90,75,55,${random() * 0.08})`; context.fillRect(x + 1, y + 1, 126, 126);
    }
  } else if (kind === 'asphalt') {
    context.strokeStyle = '#272c29'; context.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      let x = random() * 512, y = random() * 512; context.beginPath(); context.moveTo(x, y);
      for (let j = 0; j < 7; j++) { x += random() * 32 - 16; y += random() * 22; context.lineTo(x, y); }
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  const repeat = kind === 'brick' ? 8 : kind === 'paving' ? 24 : 5;
  texture.repeat.set(repeat, repeat); texture.anisotropy = 8;
  return texture;
}

function labelTexture(text, background, foreground, subtitle = '') {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const c = canvas.getContext('2d'); c.fillStyle = background; c.fillRect(0, 0, 1024, 256);
  c.strokeStyle = foreground; c.lineWidth = 3; c.strokeRect(16, 16, 992, 224);
  c.fillStyle = foreground; c.textAlign = 'center'; c.font = '600 78px Georgia'; c.fillText(text, 512, subtitle ? 128 : 154);
  if (subtitle) { c.font = '25px sans-serif'; c.fillText(subtitle, 512, 192); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; return texture;
}

export function createNeighborhoodWorld(renderer, { hasFireRed = true } = {}) {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xbcc7c5, 0.0035);
  const resources = new Set(), colliders = [], batches = new Map(), random = seeded(7139);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1), sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10), coneGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 8);
  [boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry].forEach(r => resources.add(r));
  const asphalt = surface('asphalt'), paving = surface('paving'), brick = surface('brick'), stucco = surface('stucco'), grass = surface('grass');
  [asphalt, paving, brick, stucco, grass].forEach(r => resources.add(r));
  const material = (color, options = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...options }); resources.add(m); return m; };
  const materials = {
    road: material(0xc5c7c5, { map: asphalt, bumpMap: asphalt, bumpScale: 0.035 }),
    paving: material(0xe7e5da, { map: paving, bumpMap: paving, bumpScale: 0.018 }),
    curb: material(0xc2bfb3), stripe: material(0xd7c991), white: material(0xe1dfcd),
    dark: material(0x343c3c, { roughness: 0.5, metalness: 0.45 }), metal: material(0x67706a, { roughness: 0.44, metalness: 0.65 }),
    wood: material(0x72543b, { map: stucco }), glass: material(0x5c7c83, { roughness: 0.15, metalness: 0.65 }),
    shadowGlass: material(0x253d46, { roughness: 0.23, metalness: 0.46 }), curtain: material(0xb2a38b),
    grass: material(0xc7cb9f, { map: grass }), soil: material(0x685747, { map: asphalt }),
    trim: material(0xc7bca5), red: material(0x894c3e), roof: material(0x646360, { map: asphalt }),
    hedge: material(0x4f6240), leaves: [0x657747, 0x7c854d, 0x4d6544, 0x8c9253].map(c => material(c, { roughness: 0.92 })),
  };
  const dummy = new THREE.Object3D();
  function primitive(geometry, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const key = `${geometry.id}:${mat.id}`;
    if (!batches.has(key)) batches.set(key, { geometry, material: mat, matrices: [] });
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    batches.get(key).matrices.push(dummy.matrix.clone());
  }
  const box = (mat, x, y, z, w, h, d, ry = 0) => primitive(boxGeometry, mat, x, y, z, w, h, d, 0, ry);
  const ball = (mat, x, y, z, rx, ry = rx, rz = rx) => primitive(sphereGeometry, mat, x, y, z, rx, ry, rz);
  const pole = (mat, x, y, z, radius, height, rz = 0) => primitive(cylinderGeometry, mat, x, y, z, radius, height, radius, 0, 0, rz);
  function obstacle(x, z, w, d, height = 2, minY = 0) { colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY, maxY: minY + height }); }
  function sign(text, x, y, z, width, height, facing, bg = '#29423c', fg = '#e7ddbf', subtitle = '') {
    const texture = labelTexture(text, bg, fg, subtitle); resources.add(texture);
    const mat = material(0xffffff, { map: texture, roughness: 0.7 });
    const geometry = new THREE.PlaneGeometry(width, height); resources.add(geometry);
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.rotation.y = facing; scene.add(mesh);
  }

  // A procedural sky also supplies reflected light for glass and painted metal.
  const skyMaterial = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { sunDirection: { value: new THREE.Vector3(-0.65, 0.72, 0.38).normalize() } },
    vertexShader: 'varying vec3 vDirection; void main(){ vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDirection; uniform vec3 sunDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
      void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);vec3 sky=mix(vec3(.70,.78,.80),vec3(.16,.39,.64),pow(h,.52));
        float sun=max(dot(d,sunDirection),0.);sky+=vec3(1.,.69,.36)*pow(sun,18.)*.18;sky+=vec3(5.,3.8,2.5)*smoothstep(.9993,.9998,sun);
        vec2 p=d.xz/max(.12,d.y)*1.5;float n=noise(p)+.5*noise(p*2.7)+.2*noise(p*6.);float cloud=smoothstep(.93,1.28,n)*smoothstep(.04,.28,h)*.38;
        sky=mix(sky,vec3(.91,.91,.85),cloud);gl_FragColor=vec4(sky,1.);}` });
  resources.add(skyMaterial);
  const skyGeometry = new THREE.SphereGeometry(450, 24, 12); resources.add(skyGeometry);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial); scene.add(sky);
  const environmentScene = new THREE.Scene(); environmentScene.add(new THREE.Mesh(skyGeometry, skyMaterial));
  const pmrem = new THREE.PMREMGenerator(renderer), environment = pmrem.fromScene(environmentScene, 0.035);
  scene.environment = environment.texture; scene.environmentIntensity = 0.65; resources.add(environment); pmrem.dispose();
  const hemi = new THREE.HemisphereLight(0xc8dded, 0x8a775c, 1.3); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b2, 3.2); sun.position.set(-65, 72, 38);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.left = -100; sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80; sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.00015; sun.shadow.radius = 2; scene.add(sun);

  box(material(0xb5b3a1, { map: stucco }), 0, -0.22, 0, 500, 0.35, 500);
  box(materials.road, 0, -0.025, 0, 188, 0.05, 16);
  box(materials.road, 0, -0.026, 0, 16, 0.05, 144);
  for (let x = -90; x <= 90; x += 9) if (Math.abs(x) > 13) {
    box(materials.stripe, x, 0.015, -0.11, 4.6, 0.014, 0.1); box(materials.stripe, x, 0.015, 0.11, 4.6, 0.014, 0.1);
  }
  for (let z = -65; z <= 65; z += 9) if (Math.abs(z) > 12) box(materials.stripe, 0, 0.014, z, 0.13, 0.012, 4.2);
  for (const side of [-1, 1]) for (let n = -5; n <= 5; n++) {
    box(materials.white, side * 11.1, 0.02, n * 1.1, 2.4, 0.015, 0.52);
    box(materials.white, n * 1.1, 0.021, side * 11.1, 0.52, 0.015, 2.4);
  }
  for (let x = -74; x <= 74; x += 11) if (Math.abs(x) > 14) for (const side of [-1, 1]) {
    box(materials.white, x, 0.018, side * 6.2, 0.09, 0.01, 2.4);
    box(materials.dark, x - 4, 0.025, side * 7.4, 0.8, 0.04, 0.35);
    for (let n = 0; n < 6; n++) box(materials.metal, x - 4.3 + n * 0.12, 0.05, side * 7.4, 0.025, 0.02, 0.3);
  }
  for (const block of BLOCKS) {
    box(materials.paving, block.x, 0.1, block.z, block.width, 0.22, block.depth);
    box(materials.curb, block.x, 0.1, block.z - block.depth / 2, block.width, 0.26, 0.24);
    box(materials.curb, block.x, 0.1, block.z + block.depth / 2, block.width, 0.26, 0.24);
    box(materials.curb, block.x - block.width / 2, 0.1, block.z, 0.24, 0.26, block.depth);
    box(materials.curb, block.x + block.width / 2, 0.1, block.z, 0.24, 0.26, block.depth);
  }

  function building({ x, z, w, d, h, color, name, facing = 1, brickwork = false, balconies = false }) {
    const wall = material(color, { map: brickwork ? brick : stucco, bumpMap: brickwork ? brick : stucco, bumpScale: brickwork ? 0.06 : 0.025 });
    box(wall, x, h / 2 + 0.22, z, w, h, d); obstacle(x, z, w + 0.15, d + 0.15, h + 1);
    box(materials.trim, x, 0.5, z, w + 0.12, 0.55, d + 0.12);
    box(materials.roof, x, h + 0.23, z, w, 0.12, d);
    for (const edge of [-1, 1]) {
      box(wall, x, h + 0.55, z + edge * (d / 2 - 0.15), w, 0.7, 0.3);
      box(wall, x + edge * (w / 2 - 0.15), h + 0.55, z, 0.3, 0.7, d);
      box(materials.trim, x, h + 0.15, z + edge * d / 2, w + 0.35, 0.25, 0.35);
    }
    // Roof equipment and ducts remain visible from street-level gaps between buildings.
    box(materials.metal, x + w * 0.23, h + 0.65, z - 2, 2.5, 0.9, 1.5);
    for (let n = 0; n < 6; n++) box(materials.dark, x + w * 0.23 - 1 + n * 0.4, h + 1.12, z - 2, 0.16, 0.06, 1.3);
    pole(materials.trim, x - w * 0.24, h + 1, z + 2, 0.35, 1.6);
    for (let y = 4.7; y < h - 0.8; y += 3.15) {
      box(materials.trim, x, y - 1.18, z, w + 0.16, 0.12, d + 0.16);
      for (const side of [-1, 1]) for (let xx = -w / 2 + 2.15; xx < w / 2 - 1; xx += 3.25) {
        const zz = z + side * (d / 2 + 0.06), ww = 1.45;
        box(materials.dark, x + xx, y, zz, ww + 0.18, 1.95, 0.12);
        box(random() > 0.3 ? materials.glass : materials.shadowGlass, x + xx, y, zz + side * 0.07, ww, 1.78, 0.06);
        box(materials.trim, x + xx, y - 1.02, zz, ww + 0.35, 0.12, 0.3);
        box(materials.metal, x + xx, y, zz + side * 0.12, 0.045, 1.8, 0.04);
        if (random() > 0.5) box(materials.curtain, x + xx + 0.4, y, zz + side * 0.11, 0.33, 1.65, 0.02);
        if (balconies && side === facing) {
          box(materials.trim, x + xx, y - 1.05, zz + side * 0.6, 2.3, 0.13, 1.3);
          box(materials.dark, x + xx, y - 0.25, zz + side * 1.2, 2.3, 0.06, 0.05);
          for (let i = -3; i <= 3; i++) box(materials.dark, x + xx + i * 0.33, y - 0.64, zz + side * 1.2, 0.035, 0.8, 0.035);
        }
      }
      for (const side of [-1, 1]) for (let zz = -d / 2 + 2.4; zz < d / 2 - 1.2; zz += 3.8) {
        box(materials.dark, x + side * (w / 2 + 0.04), y, z + zz, 0.1, 1.95, 1.6);
        box(materials.glass, x + side * (w / 2 + 0.1), y, z + zz, 0.04, 1.72, 1.4);
        box(materials.trim, x + side * (w / 2 + 0.12), y - 1, z + zz, 0.3, 0.1, 1.8);
      }
    }
    const front = z + facing * (d / 2 + 0.08);
    for (let xx = -w / 2 + 2; xx < w / 2 - 1; xx += 3.2) {
      box(materials.dark, x + xx, 1.62, front, 2.6, 2.65, 0.16);
      box(materials.glass, x + xx, 1.62, front + facing * 0.1, 2.38, 2.43, 0.06);
      box(materials.metal, x + xx, 1.62, front + facing * 0.15, 0.05, 2.45, 0.03);
      box(materials.wood, x + xx, 0.5, front + facing * 0.13, 2.42, 0.16, 0.04);
    }
    const awning = material(brickwork ? 0x4e685f : 0x9a7152);
    box(awning, x, 3.27, front + facing * 0.65, w - 0.65, 0.15, 1.55);
    box(awning, x, 3.12, front + facing * 1.37, w - 0.65, 0.3, 0.06);
    sign(name, x, 3.78, front + facing * 0.14, Math.min(w - 1, 9.5), 0.8, facing === 1 ? 0 : Math.PI,
      brickwork ? '#35463d' : '#5c4e40', '#f3e6c9');
    // Downpipes, utility cabinets and some faded exterior plaster ground the facade.
    for (const side of [-1, 1]) pole(materials.metal, x + side * (w / 2 - 0.2), h / 2, front + facing * 0.12, 0.055, h);
    box(materials.metal, x + w / 2 + 0.25, 1.1, z + 2, 0.38, 1.2, 0.8);
  }
  [
    { x: -66, z: -34, w: 18, d: 36, h: 10.2, color: 0xe5d7ba, name: 'ALDER & CO.', brickwork: true },
    { x: -43, z: -37, w: 23, d: 30, h: 16.5, color: 0xe8dcc2, name: 'ALDER ARCADE', balconies: true },
    { x: -20, z: -35, w: 16, d: 36, h: 12.8, color: 0xd4c6b4, name: 'NORTHLINE BOOKS' },
    { x: 22, z: -35, w: 20, d: 36, h: 13.2, color: 0xe5cdb6, name: 'JUNIPER', balconies: true },
    { x: 45, z: -38, w: 20, d: 30, h: 19.4, color: 0xd9d8c9, name: 'COURT No. 08' },
    { x: 67, z: -34, w: 18, d: 38, h: 10.1, color: 0xe0c8a6, name: 'WEST END SUPPLY', brickwork: true },
    { x: 22, z: 35, w: 20, d: 36, h: 10.2, color: 0xe8d9bc, name: 'CORNER MARKET', facing: -1, brickwork: true },
    { x: 45, z: 39, w: 20, d: 28, h: 16.3, color: 0xc6cbbb, name: 'THE TERRACE', facing: -1, balconies: true },
    { x: 67, z: 35, w: 18, d: 36, h: 9.8, color: 0xe1d2b4, name: 'SUNDAY STUDIO', facing: -1 },
  ].forEach(building);

  // A real subgame entrance on the open pavement, outside the solid facade.
  if (hasFireRed) {
  sign('POKÉMON FIRE RED', FIRE_RED_ENTRANCE.x, 2.15, -21.68, 6.2, 1.2, 0, '#793e30', '#fff0c3', 'PLAY HERE · ALDER ARCADE');
  const entranceMaterial = material(0xefb976, { emissive: 0xd57732, emissiveIntensity: 0.35, roughness: 0.6 });
  const entranceRing = new THREE.RingGeometry(1.05, 1.15, 48); resources.add(entranceRing);
  const marker = new THREE.Mesh(entranceRing, entranceMaterial); marker.rotation.x = -Math.PI / 2;
  marker.position.set(FIRE_RED_ENTRANCE.x, 0.245, FIRE_RED_ENTRANCE.z); scene.add(marker);
  for (const side of [-1, 1]) box(entranceMaterial, FIRE_RED_ENTRANCE.x + side * 3.2, 2.15, -21.65, 0.06, 1.4, 0.07);
  }

  function tree(x, z, height = 7, spread = 2.5) {
    const y = 0.22; pole(materials.wood, x, y + height * 0.35, z, 0.16, height * 0.7);
    obstacle(x, z, 0.4, 0.4, height * 0.65);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + random();
      pole(materials.wood, x + Math.cos(angle) * 0.35, height * 0.6, z + Math.sin(angle) * 0.35, 0.07, 1.9, Math.cos(angle) * 0.6);
    }
    for (let i = 0; i < 19; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * spread;
      const size = 0.6 + random() * 0.8;
      ball(materials.leaves[i % 4], x + Math.cos(angle) * radius, height * 0.74 + random() * spread * 0.85, z + Math.sin(angle) * radius,
        size, size * 0.72, size);
    }
  }
  function planter(x, z) {
    box(materials.curb, x, 0.32, z, 1.8, 0.3, 1.8); box(materials.soil, x, 0.49, z, 1.6, 0.06, 1.6);
    obstacle(x, z, 1.8, 1.8, 0.5); tree(x, z, 5.7 + random() * 1.2, 1.65);
  }
  for (const side of [-1, 1]) for (const x of [-71, -53, -30, -15, 15, 36, 57, 73]) planter(x, side * 12.7);
  for (const z of [-49, -30, 30, 49]) for (const side of [-1, 1]) if (!(side < 0 && z > 0)) planter(side * 10.8, z);

  function bench(x, z, facing = 0) {
    const group = new THREE.Group();
    // Transform local bench pieces through the same instance batches.
    const part = (mat, xx, yy, zz, w, h, d) => box(mat, x + Math.cos(facing) * xx + Math.sin(facing) * zz, yy,
      z - Math.sin(facing) * xx + Math.cos(facing) * zz, w, h, d, facing);
    for (let i = 0; i < 4; i++) part(materials.wood, 0, 0.68, i * 0.14 - 0.21, 1.9, 0.07, 0.11);
    for (let i = 0; i < 3; i++) part(materials.wood, 0, 0.93 + i * 0.14, 0.25, 1.9, 0.1, 0.07);
    for (const side of [-1, 1]) { part(materials.dark, side * 0.65, 0.46, 0, 0.07, 0.45, 0.48); part(materials.dark, side * 0.65, 1, 0.26, 0.055, 0.6, 0.05); }
    obstacle(x, z, facing === 0 ? 2 : 0.7, facing === 0 ? 0.7 : 2, 1.4);
    return group;
  }
  // The fourth corner is an open pocket garden, leaving three built city blocks.
  box(materials.grass, -44, 0.225, 35, 60, 0.04, 34);
  box(materials.paving, -44, 0.255, 32, 61, 0.06, 4);
  box(materials.paving, -43, 0.256, 35, 4, 0.06, 34);
  const pondMaterial = material(0x658a82, { roughness: 0.15, metalness: 0.4 });
  box(materials.curb, -43, 0.45, 32, 10, 0.42, 8); box(pondMaterial, -43, 0.68, 32, 9.3, 0.05, 7.3); obstacle(-43, 32, 10, 8, 0.72);
  pole(materials.trim, -43, 1.15, 32, 0.6, 1.4); ball(materials.trim, -43, 1.9, 32, 0.8, 0.25, 0.8);
  for (const p of [[-68, 24], [-61, 44], [-27, 44], [-18, 28], [-72, 48], [-52, 49], [-21, 49]]) tree(p[0], p[1], 7.5 + random() * 2.5, 3.1);
  for (const x of [-64, -25]) { bench(x, 28); bench(x, 36, Math.PI); }
  sign('ALDER GARDEN', -56, 1.1, 17, 3.4, 0.8, Math.PI, '#4e5d48', '#e8dec1', 'TAKE THE LONG WAY HOME');
  box(materials.wood, -56, 1.05, 17.06, 3.6, 0.95, 0.16); obstacle(-56, 17, 3.6, 0.3, 1.65);
  for (const x of [-57.4, -54.6]) pole(materials.dark, x, 0.6, 17, 0.055, 1.2);

  function lamp(x, z, side) {
    pole(materials.dark, x, 2.9, z, 0.075, 5.8); pole(materials.dark, x, 0.5, z, 0.15, 0.65);
    box(materials.dark, x, 5.65, z + side * 0.6, 0.07, 0.07, 1.2);
    box(materials.dark, x, 5.58, z + side * 1.05, 0.34, 0.12, 0.75);
    box(materials.white, x, 5.5, z + side * 1.05, 0.27, 0.025, 0.62); obstacle(x, z, 0.24, 0.24, 5.8);
  }
  for (const side of [-1, 1]) for (const x of [-61, -25, 25, 61]) lamp(x, side * 9.4, -side);
  for (const side of [-1, 1]) {
    pole(materials.dark, side * 9.1, 2.3, -side * 9.1, 0.07, 4.6);
    box(materials.dark, side * 9.1, 3.6, -side * 9.1, 0.32, 0.85, 0.3);
    for (let i = 0; i < 3; i++) ball(material(i === 0 ? 0x98554c : i === 1 ? 0xb7a25a : 0x43664a), side * 9.1, 3.85 - i * 0.24, -side * 9.1 + side * 0.17, 0.085);
    sign('ALDER ST', side * 9.1, 4.45, -side * 9.1 + 0.16, 1.7, 0.3, 0, '#304c42', '#eee9d7');
    obstacle(side * 9.1, -side * 9.1, 0.3, 0.3, 4.6);
  }
  for (const [x, z] of [[-33, -11], [33, 12], [70, 11], [-72, 11]]) {
    pole(materials.dark, x, 0.69, z, 0.28, 0.9); pole(materials.metal, x, 1.16, z, 0.31, 0.07); obstacle(x, z, 0.62, 0.62, 1.2);
    for (let n = 0; n < 10; n++) { const a = n * Math.PI / 5; box(materials.metal, x + Math.sin(a) * 0.285, 0.7, z + Math.cos(a) * 0.285, 0.03, 0.75, 0.03); }
  }
  for (const [x, z] of [[-18, -10], [57, 10]]) {
    pole(materials.red, x, 0.6, z, 0.15, 0.8); ball(materials.red, x, 1.02, z, 0.17, 0.1, 0.17);
    box(materials.red, x, 0.75, z, 0.5, 0.14, 0.16); obstacle(x, z, 0.52, 0.4, 1.15);
  }
  bench(-39, -12); bench(48, 13, Math.PI);
  // Distant, non-traversable architecture closes the horizon without pretending to be a full city.
  const distant = [material(0xa7b1af), material(0xb8bcb5), material(0x9aa7aa)];
  for (let i = 0; i < 45; i++) {
    const side = i % 4, along = (random() - 0.5) * 360, offset = 115 + random() * 90;
    const x = side < 2 ? along : (side === 2 ? -offset : offset), z = side < 2 ? (side === 0 ? -offset : offset) : along;
    const h = 9 + random() * 36; box(distant[i % 3], x, h / 2, z, 12 + random() * 20, h, 12 + random() * 20);
  }
  // Low perimeter planting gives the finite walking area a visible edge.
  for (const side of [-1, 1]) {
    box(materials.hedge, side * 82.7, 1, 0, 1, 2, 119);
    box(materials.hedge, 0, 1, side * 58.7, 166, 2, 1);
    obstacle(side * 82.7, 0, 1, 119, 2); obstacle(0, side * 58.7, 166, 1, 2);
  }
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); scene.add(mesh);
  }

  const avatar = createAvatar(material, resources); scene.add(avatar.root);
  const heightAt = (x, z) => BLOCKS.some(b => Math.abs(x - b.x) <= b.width / 2 && Math.abs(z - b.z) <= b.depth / 2) ? 0.23 : 0.02;
  return { scene, avatar, colliders, blocks: BLOCKS, heightAt,
    dispose() {
      sun.shadow.map?.dispose();
      scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      for (const resource of resources) resource.dispose();
      scene.clear();
    },
  };
}

function createAvatar(material, resources) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = material(0xad785a, { roughness: 0.8 }), jacket = material(0x354c51), jeans = material(0x303d48), shoes = material(0x25272b), hair = material(0x302820), tee = material(0xb5ae98);
  const capsule = new THREE.CapsuleGeometry(1, 1, 5, 10), sphere = new THREE.SphereGeometry(1, 16, 12), cube = new THREE.BoxGeometry(1, 1, 1);
  [capsule, sphere, cube].forEach(r => resources.add(r));
  const mesh = (parent, geometry, mat, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  mesh(body, sphere, jacket, 0, 1.18, 0, 0.235, 0.33, 0.14);
  mesh(body, sphere, jacket, 0, 1.43, 0, 0.28, 0.12, 0.15);
  mesh(body, cube, tee, 0, 1.28, 0.133, 0.09, 0.32, 0.025);
  mesh(body, cube, shoes, 0, 0.95, 0, 0.39, 0.045, 0.22);
  mesh(body, sphere, jeans, 0, 0.9, 0, 0.2, 0.14, 0.135);
  mesh(body, capsule, skin, 0, 1.51, 0, 0.06, 0.045, 0.06);
  mesh(body, sphere, skin, 0, 1.66, 0.01, 0.108, 0.145, 0.105);
  mesh(body, sphere, hair, 0, 1.735, -0.012, 0.111, 0.09, 0.105);
  mesh(body, sphere, skin, 0, 1.65, 0.111, 0.026, 0.032, 0.032);
  for (const side of [-1, 1]) {
    mesh(body, sphere, skin, side * 0.105, 1.66, 0, 0.02, 0.037, 0.024);
    mesh(body, sphere, hair, side * 0.041, 1.69, 0.105, 0.018, 0.007, 0.006);
  }
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.115, 0.89, 0); body.add(hip);
    mesh(hip, capsule, jeans, 0, -0.2, 0, 0.089, 0.145, 0.09);
    const knee = new THREE.Group(); knee.position.y = -0.39; hip.add(knee);
    mesh(knee, capsule, jeans, 0, -0.18, 0, 0.066, 0.13, 0.071);
    mesh(knee, sphere, shoes, 0, -0.39, 0.07, 0.085, 0.065, 0.16); legs.push({ hip, knee });
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.27, 1.4, 0); shoulder.rotation.z = side * 0.09; body.add(shoulder);
    mesh(shoulder, capsule, jacket, 0, -0.145, 0, 0.075, 0.1, 0.075);
    const elbow = new THREE.Group(); elbow.position.y = -0.29; shoulder.add(elbow);
    mesh(elbow, capsule, jacket, 0, -0.12, 0, 0.058, 0.082, 0.06);
    mesh(elbow, sphere, skin, 0, -0.28, 0.015, 0.047, 0.075, 0.042); arms.push({ shoulder, elbow });
  }
  let phase = 0;
  return { root,
    animate(dt, speed, running) {
      const amount = Math.min(1, speed / 2.2), stride = running ? 0.8 : 0.46;
      phase += dt * speed * (running ? 2.4 : 3.8);
      body.position.y = Math.abs(Math.sin(phase)) * (running ? 0.05 : 0.022) * amount;
      body.rotation.x = running ? 0.08 * amount : 0;
      for (let i = 0; i < 2; i++) {
        const wave = Math.sin(phase + i * Math.PI);
        legs[i].hip.rotation.x = wave * stride * amount;
        legs[i].knee.rotation.x = Math.max(0, -wave) * (running ? 1.15 : 0.62) * amount;
        arms[i].shoulder.rotation.x = -wave * stride * 0.8 * amount;
        arms[i].elbow.rotation.x = -0.15 - (running ? 0.8 : 0.2) * amount;
      }
    },
  };
}
