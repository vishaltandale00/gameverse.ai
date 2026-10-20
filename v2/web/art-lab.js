// Art lab: renders the procedural painters' output for visual review.
import { paintCharacter, POSE_NAMES } from '../art/characters.js';

export const PRESETS = {
  hedgehog: { body: 'biped', colors: { primary: '#1f5fd6', secondary: '#f2c79a', accent: '#e0302f', eye: '#1f9a4c' }, ears: 'pointed', top: 'quills', snout: 'muzzle', tail: 'spiky', feet: 'shoes', hands: 'gloves' },
  plumber: { body: 'biped', build: 'stocky', colors: { primary: '#e0302a', secondary: '#f5c99b', accent: '#e0302a', outfit: '#2a52be', hair: '#3a2418', eye: '#3a6fd8' }, headwear: 'cap', snout: 'big-nose', facial: 'mustache', outfit: 'overalls', feet: 'boots', hands: 'gloves' },
  hedgehogHero: { body: 'biped', colors: { primary: '#1f5fd6', secondary: '#f2c79a', accent: '#e0302f', eye: '#1f9a4c' }, ears: 'pointed', top: 'quills', snout: 'muzzle', arms: 'skin', tail: 'spiky', feet: 'shoes', hands: 'gloves' },
  martialArtist: { body: 'biped', build: 'normal', colors: { primary: '#f07a1a', secondary: '#f5c99b', accent: '#2a52be', outfit: '#2a52be', hair: '#1a1a22', eye: '#1a1a22' }, top: 'spikes', outfit: 'gi', feet: 'boots', hands: 'none' },
  knight: { body: 'biped', build: 'stocky', colors: { primary: '#8d99ae', secondary: '#f0c8a0', accent: '#b8323a', eye: '#3060c0' }, headwear: 'helmet', feet: 'boots', hands: 'gloves', held: 'sword', accessory: 'cape' },
  wizard: { body: 'biped', build: 'normal', colors: { primary: '#5b3fa8', secondary: '#f1d0b0', accent: '#3a2a80', eye: '#7a40d0' }, headwear: 'wizard-hat', top: 'long-hair', feet: 'boots', hands: 'gloves', held: 'staff' },
  fox: { body: 'quadruped', colors: { primary: '#e8742a', secondary: '#fff1df', accent: '#2a2a2a', eye: '#3a2a10' }, ears: 'pointed', snout: 'muzzle', tail: 'fluffy' },
  slime: { body: 'blob', colors: { primary: '#5fd36a', secondary: '#c8ffd0', accent: '#2f8a3a', eye: '#1a1a1a' }, eyes: 'cartoon' },
  bird: { body: 'flyer', colors: { primary: '#f0b429', secondary: '#fff4d0', accent: '#f07a1a', eye: '#202020' }, top: 'tuft' },
  badnik: { body: 'robot', colors: { primary: '#d8352a', secondary: '#202430', accent: '#f5c542', eye: '#ff3b3b' }, eyes: 'visor', accessory: 'spots' },
  ghost: { body: 'ghost', colors: { primary: '#e8ecff', secondary: '#ffffff', accent: '#7a80ff', eye: '#30306a' }, eyes: 'dots' },
};

const out = document.getElementById('out'), select = document.getElementById('preset'), pixelBox = document.getElementById('pixel');
select.innerHTML = ['all', 'props', 'tiles', 'scenery', ...Object.keys(PRESETS)].map(k => `<option>${k}</option>`).join('');
const url = svg => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
function render() {
  const pixel = pixelBox.checked, names = select.value === 'all' ? Object.keys(PRESETS) : PRESETS[select.value] ? [select.value] : [];
  out.innerHTML = names.map(name => `<h2>${name}</h2><div class="row ${pixel ? 'pixel' : ''}">${POSE_NAMES.map(p => `<figure><img src="${url(paintCharacter(PRESETS[name], p, { pixel }))}"><figcaption>${p}</figcaption></figure>`).join('')}</div>`).join('');
}
const [hashPreset, hashMode, hashSize] = location.hash.slice(1).split(',');
if (hashSize) document.documentElement.style.setProperty('--s', hashSize + 'px');
if (hashPreset) select.value = hashPreset;
if (hashMode === 'pixel') pixelBox.checked = true;
select.onchange = pixelBox.onchange = render;
addEventListener('hashchange', () => location.reload());
render();

// Props, tiles and scenery.
import('../art/props.js').then(async ({ paintProp, PROPS }) => {
  const { paintTileset, MATERIALS, SURFACES, PLATFORMS } = await import('../art/tiles.js');
  const { paintScenery, THEMES } = await import('../art/scenery.js');
  const pixel = pixelBox.checked, cls = pixel ? 'pixel' : '';
  const section = (title, html) => out.insertAdjacentHTML('beforeend', `<h2>${title}</h2><div class="row ${cls}">${html}</div>`);
  if (select.value !== 'all' && !['props', 'tiles', 'scenery'].includes(select.value)) return;
  for (const role of Object.keys(PROPS)) section(role, PROPS[role].map(k => `<figure><img src="${url(paintProp(k, { pixel }))}"><figcaption>${k}</figcaption></figure>`).join(''));
  const combos = [['dirt', 'grass', 'brick', '#8a5a2b', '#4fbf3a', '#c0603a'], ['checker', 'grass', 'grass', '#b8642a', '#3fbf3a', '#3fbf3a'], ['stone', 'moss', 'stone', '#7a8090', '#6aa84a', '#9aa0b0'],
    ['snow', 'snow', 'ice', '#c8dcf0', '#ffffff', '#9ad8f5'], ['sand', 'sand', 'wood', '#e0b070', '#f0d090', '#a0683a'], ['metal', 'metal', 'metal', '#5a6478', '#9aa3b0', '#7a8498'],
    ['lava-rock', 'stone', 'stone', '#3a2a2a', '#5a4040', '#6a4a40'], ['crystal', 'none', 'crystal', '#8a5ad0', '#c09aff', '#b07aff'], ['candy', 'frosting', 'cloud', '#ff8ac0', '#ffffff', '#ffffff'], ['tech', 'metal', 'tech', '#2a3a5a', '#7a8aa8', '#3a4a6a']];
  section('tilesets', combos.map(([material, surface, platform, groundColor, surfaceColor, platformColor]) => `<figure class="tiles"><img src="${url(paintTileset({ material, surface, platform, groundColor, surfaceColor, platformColor }, { pixel }).svg)}"><figcaption>${material} / ${surface} / ${platform}</figcaption></figure>`).join(''));
  section('scenery', THEMES.flatMap(t => [['day'], ['sunset'], ['night']].map(([time]) => `<figure class="wide"><img src="${url(paintScenery({ theme: t, time }, { pixel }))}"><figcaption>${t} · ${time}</figcaption></figure>`)).join(''));
});
