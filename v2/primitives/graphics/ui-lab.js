// UI lab: mounts small documents through v2/web/player.js mountGame and
// offers buttons that change game state the way gameplay primitives would
// (vars, effects, teleports), so every UI primitive can be checked in a real
// browser. Battle and card demos attach a lab battle service to the running
// world, standing in for the turn/battle primitives while they land.
import { mountGame } from '/v2/web/player.js';
import { catalogue } from '/v2/primitives/index.js';
import { withDefaultGraphics } from '/v2/primitives/graphics/ui-defaults.js';
import { villageDoc } from '/v2/primitives/graphics/ui-lab-docs.js';

const stage = document.getElementById('stage'), controls = document.getElementById('controls'), log = document.getElementById('log'), pick = document.getElementById('demo');
let game = null;
const rt = () => game.rt;
const fx = effects => rt().run(effects);
const setVars = v => fx(Object.entries(v).map(([k, value]) => ({ do: 'set_var', var: k, value })));
const button = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); b.blur(); }; controls.append(b); return b; };
const heading = t => { const h = document.createElement('h2'); h.textContent = t; controls.append(h); };

async function load(name) {
  game?.dispose(); controls.replaceChildren(); log.textContent = '';
  const res = name === 'manor' ? await fetch('/v2/games/quiet-manor.json').then(r => r.json()) : null;
  const doc = name === 'village' ? villageDoc() : name === 'manor' ? res : battleDoc(name);
  if (name === 'manor') { doc.graphics = withDefaultGraphics(doc, catalogue().registry); const menu = doc.graphics.find(g => g.use === 'graphics.ui.menu'); if (menu) menu.with.autoPause = false; }
  game = mountGame(stage, { doc, version: 1 });
  window.__lab = { game, rt: game.rt };
  game.rt.on('*', e => { if (/^(dialogue_line|quest_|notify|item_gained|enter_zone$|battle_|choice_made|journal_added|boss_)/.test(e.name)) { log.textContent = `${game.rt.state.frame} ${e.name} ${JSON.stringify(e).slice(0, 90)}\n` + log.textContent.slice(0, 3000); } });
  if (name === 'village') villageControls();
  if (name === 'battle' || name === 'cards') attachBattle(name);
}

function villageControls() {
  setVars({ hp: 5, 'hp.max': 5, 'res.stamina': 100, 'res.stamina.max': 100, 'money.gold': 12, wanted: 0, 'time.hour': 8.5, 'time.day': 1 });
  heading('Player');
  button('Take 1 damage', () => { setVars({ hp: Math.max(0, rt().state.vars.hp - 1) }); rt().emit('damaged', { who: 'player', amount: 1 }); });
  button('Heal to full', () => setVars({ hp: rt().state.vars['hp.max'] }));
  button('Sprint (−35 stamina)', () => setVars({ 'res.stamina': Math.max(0, rt().state.vars['res.stamina'] - 35) }));
  button('Rest (+100 stamina)', () => setVars({ 'res.stamina': 100 }));
  button('Find 25 gold', () => setVars({ 'money.gold': rt().state.vars['money.gold'] + 25 }));
  button('Pick 2 frostleaf', () => fx([{ do: 'give_item', item: 'herb', count: 2 }]));
  button('Wanted +1', () => setVars({ wanted: Math.min(5, (rt().state.vars.wanted || 0) + 1) }));
  button('Advance clock 3h', () => { const h = (rt().state.vars['time.hour'] + 3) % 24; setVars({ 'time.hour': h, 'time.day': rt().state.vars['time.day'] + (h < 3 ? 1 : 0) }); });
  button('Burning status', () => { rt().player().components.status = { burning: 4 }; });
  heading('World');
  for (const z of ['village', 'woods', 'lake', 'shrine', 'ruins']) button(`Walk to ${z}`, () => fx([{ do: 'teleport', zone: z }]));
  button('Face east / north', () => { const b = (rt().player().components.body ??= {}); b.facing = b.facing === 1 ? -1 : 1; });
  heading('Story');
  button('Talk to Mara', () => game.rt.step({ actions: { talk: 'mara' } }));
  button('Bark on the radio', () => fx([{ do: 'bark', line: 'Storm front rolling in from the coast tonight.', channel: 'radio' }]));
  button('Notify', () => fx([{ do: 'notify', text: 'The bridge has been repaired', kind: 'info' }]));
  button('Boss appears', () => { setVars({ 'boss.id': 'warden', 'boss.hp': 300, 'boss.hp.max': 300, 'boss.phase': 0, danger: 1 }); rt().emit('boss_start', { boss: 'warden', title: 'The Ash Warden' }); });
  button('Hit boss (−60)', () => { const hp = Math.max(0, rt().state.vars['boss.hp'] - 60); setVars({ 'boss.hp': hp, 'boss.phase': hp < 150 ? 1 : 0 }); rt().emit('hit', { by: 'player', target: 'warden' }); if (!hp) setVars({ danger: 0 }); });
  button('Win the game', () => fx([{ do: 'end_game', outcome: 'won' }]));
}

function battleDoc(kind) {
  const doc = villageDoc();
  doc.id = `ui-lab-${kind}`; doc.title = kind === 'cards' ? 'Deckbound' : 'Sprout Battles';
  doc.spaces = [{ id: 'arena', use: 'engine.space.none', zones: [{ id: 'field', name: 'Battle field' }] }];
  doc.player = { archetype: 'hero', space: 'arena', at: 'field' };
  doc.content.archetypes.push({ id: 'bat', kind: 'enemy', name: 'Cave Bat', components: { model: 'bat', health: { max: 12 } } });
  doc.content.models.bat = { kind: 'pixel', size: [16, 12], palette: { k: '#2a2238', w: '#6a5a8a', e: '#ff4d6d' }, parts: [{ name: 'body', rect: [6, 3, 4, 6], c: 'k' }, { name: 'wingL', rect: [0, 5, 6, 4], c: 'w' }, { name: 'wingR', rect: [10, 5, 6, 4], c: 'w' }, { name: 'head', rect: [6, 8, 4, 3], c: 'k' }, { name: 'eyes', rect: [7, 9, 2, 1], c: 'e' }] };
  doc.content.cards = [{ id: 'strike', name: 'Ember Strike', cost: 1, type: 'attack', text: 'Deal 6 damage.', target: 'enemy' }, { id: 'guard', name: 'Hearth Guard', cost: 1, type: 'skill', text: 'Gain 5 block.' }, { id: 'nova', name: 'Lantern Nova', cost: 3, type: 'power', text: 'Deal 4 damage to all enemies.' }, { id: 'tonic', name: 'Red Tonic', cost: 0, type: 'skill', text: 'Heal 3.' }];
  doc.systems = doc.systems.filter(s => s.use === 'gameplay.inventory');
  doc.plot = { characters: [] };
  doc.graphics = [{ use: kind === 'cards' ? 'graphics.ui.cards' : 'graphics.ui.battle', with: {} }, { use: 'graphics.ui.menu', with: { title: false, autoPause: false } }, { use: 'graphics.audio.synth', with: {} }];
  return doc;
}

// A lab stand-in for a battle/card primitive: a service view and the verbs the UI sends.
function attachBattle(kind) {
  const r = rt(), s = { on: false, mine: 20, foes: { bat_a: 12, bat_b: 12 }, energy: 3, hand: ['strike', 'guard', 'nova', 'tonic', 'strike'], turn: 1 };
  for (const id of ['bat_a', 'bat_b']) r.spawn('bat', { id, space: 'arena', at: 'field' });
  const say = text => r.emit('battle_message', { text });
  const hit = (id, n) => { s.foes[id] = Math.max(0, s.foes[id] - n); r.entity(id).components.health.hp = s.foes[id]; r.emit('damaged', { who: id, amount: n }); };
  r.provide('battle', { view: () => s.on && kind === 'battle' ? { active: true, turn: 'player', sides: [{ id: 'me', player: true, units: [{ id: 'player', name: 'Wick', model: 'hero', hp: s.mine, hpMax: 20, level: 7, active: true }] }, { id: 'wild', units: ['bat_a', 'bat_b'].map(id => ({ id, name: 'Cave Bat', model: 'bat', hp: s.foes[id], hpMax: 12, level: 4, down: s.foes[id] <= 0 })) }],
    menu: [{ id: 'flare', label: 'Flare', kind: 'move', target: 'enemy', type: 'fire', pp: 15, ppMax: 15 }, { id: 'gust', label: 'Ash Gust', kind: 'move', target: 'all', type: 'ghost', pp: 5, ppMax: 10 }, { id: 'tonic', label: 'Red Tonic', kind: 'item', target: 'ally', count: 2 }, { id: 'run', label: 'Run', kind: 'run' }] } : null });
  r.provide('cards', { view: () => s.on && kind === 'cards' ? { hand: s.hand.map((c, i) => ({ uid: `c${i}`, card: c, cost: { strike: 1, guard: 1, nova: 3, tonic: 0 }[c], playable: { strike: 1, guard: 1, nova: 3, tonic: 0 }[c] <= s.energy, target: c === 'strike' ? 'enemy' : 'self' })), piles: { draw: 9, discard: 5 - s.hand.length + 2 }, energy: s.energy, energyMax: 3, enemies: ['bat_a', 'bat_b'].map(id => ({ id, name: 'Cave Bat', dead: s.foes[id] <= 0, intent: id === 'bat_a' ? { kind: 'attack', value: 6 } : { kind: 'block', value: 5 } })) } : null });
  r.action('battle', a => {
    if (a.kind === 'run') { say('Got away safely!'); s.on = false; r.emit('battle_end', { outcome: 'fled' }); return; }
    if (a.id === 'flare') { hit(a.target, 7); say(`Wick used Flare! It's super effective.`); }
    if (a.id === 'gust') { hit('bat_a', 3); hit('bat_b', 3); say('Ash Gust swept the field!'); }
    if (a.id === 'tonic') { s.mine = Math.min(20, s.mine + 6); say('Wick drank a Red Tonic.'); }
    s.mine = Math.max(1, s.mine - 3); say('The bats strike back!'); r.emit('damaged', { who: 'player', amount: 3 });
    if (Object.values(s.foes).every(v => v <= 0)) { say('The wild bats fainted!'); r.emit('battle_end', { outcome: 'won' }); }
  });
  r.action('play_card', ({ uid, target }) => { const i = Number(uid.slice(1)), c = s.hand[i]; s.energy -= { strike: 1, guard: 1, nova: 3, tonic: 0 }[c]; if (c === 'strike') hit(target, 6); if (c === 'nova') { hit('bat_a', 4); hit('bat_b', 4); } s.hand.splice(i, 1); r.emit('card_played', { card: c }); });
  r.action('end_turn', () => { s.energy = 3; s.hand = ['strike', 'guard', 'strike', 'tonic', 'nova']; r.emit('turn_start', { side: 'me' }); });
  heading('Battle');
  button('Start the battle', () => { s.on = true; s.mine = 20; s.foes = { bat_a: 12, bat_b: 12 }; for (const id of ['bat_a', 'bat_b']) r.entity(id).components.health.hp = 12; game.rt.step({ actions: {} }); say('Two wild Cave Bats appeared!'); });
}

pick.onchange = () => load(pick.value);
load(new URLSearchParams(location.search).get('demo') || 'village');
pick.value = new URLSearchParams(location.search).get('demo') || 'village';
