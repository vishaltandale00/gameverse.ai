// Battle mode: turns rules events into timed "beats" the renderer animates (text, HP drains,
// throws, shakes, faints, level-ups), and runs the Fight / Bag / Party / Run menus.
// The displayed state (`disp`) advances beat by beat, so HP bars and sprites match the text.
import { createCreature, summary, statsOf, moveOf, evolutionOf, lookup, speciesOf, movesAt, startBattle, chooseAction, resolveTurn, needsInput, battleResult, expBar } from '../rules/index.js';
import { rivalParty, speakerName, fill } from './story.js';

export const REVEAL = 1.5; // characters per frame
const HOLD = 42;           // frames a revealed battle message stays before advancing on its own
const ANIM = { move: 26, damage: 30, faint: 34, switch: 36, shake: 34, capture: 30, item: 28, exp: 34, heal: 26, appear: 30, trainerIntro: 0 };

/** Build the battle for a script op and enter the transition. */
export function beginBattle(game, state, op) {
  const { content } = game;
  let kind = 'wild', trainer = null, foe;
  const mk = list => list.map(m => createCreature(content, m.species, m.level, state));
  if (op.wild) foe = mk([op.wild]);
  else if (op.champion) {
    const c = content.champion;
    kind = 'champion'; foe = mk(c.party);
    trainer = { id: 'champion', name: c.name, short: c.name, look: c.look, prize: 0, defeat: c.defeat, sprite: 'champion' };
  } else if (op.trainer === 'rival') {
    const party = rivalParty(content, state.rivalStarter || content.starters[1], state.badges.length, state.rivalBattles);
    kind = 'trainer'; foe = mk(party);
    // The first rival battle is a warm-up, as in the classics: their partner only knows its first moves.
    if (state.rivalBattles === 0) for (const c of foe) { const first = movesAt(content, c.species, 1); if (first.some(m => moveOf(content, m.id).power)) c.moves = first; }
    const ace = Math.max(...party.map(m => m.level));
    trainer = { id: 'rival', name: content.rival?.name || 'Rival', short: content.rival?.name || 'Rival', look: content.rival?.look, prize: ace * 60, defeat: state.rivalBattles === 0 ? 'What? I picked the wrong partner!' : 'Hmph. I\'ll get stronger, just watch!', sprite: 'rival' };
  } else if (op.trainer) {
    const t = lookup(content).trainers.get(op.trainer);
    kind = t.isLeader ? 'leader' : 'trainer'; foe = mk(t.party);
    const ace = Math.max(...t.party.map(m => m.level));
    trainer = { id: t.id, name: speakerName(content, t.id), short: t.name, look: t.look, prize: t.prize ?? ace * 100, defeat: t.defeat, sprite: t.isLeader ? 'leader' : 'trainer', leader: !!t.isLeader, noHeal: !!t.noHeal, ai: t.ai || null };
  } else {
    kind = 'trainer'; foe = mk(op.party);
    trainer = { id: 'challenger', name: op.name || 'Challenger', short: op.name || 'Challenger', prize: 100, sprite: 'trainer' };
  }
  const rules = startBattle(content, { kind, player: state.party, foe, foeTrainer: trainer, rng: state });
  for (const c of foe) state.seen[c.species] = true;
  state.stats.battles++;
  const first = foe[rules.foe.active], mine = state.party[rules.player.active];
  const B = state.battle = {
    rules, kind, trainer, story: !!(op.trainer === 'rival' || op.party), phase: 'beats', cursor: 0, sub: 0, forced: false, item: null, outro: false,
    beats: [], beat: null, bt: 0, frame: 0,
    disp: { foe: kind === 'wild' ? summary(content, first) : null, player: null, exp: null, foeShown: kind === 'wild', trainerOut: !!trainer },
    fx: null,
  };
  if (kind === 'wild') B.beats.push({ kind: 'appear', text: `A wild ${first.name} appeared!` });
  else {
    B.beats.push({ kind: 'trainerIntro', text: `${trainer.name} wants to battle!` });
    B.beats.push({ kind: 'switch', side: 'foe', creature: { ...first }, text: `${trainer.short} sent out ${first.name}!` });
  }
  B.beats.push({ kind: 'switch', side: 'player', creature: { ...mine }, text: `Go! ${mine.name}!` });
  state.mode = 'transition';
  state.transition = { t: 0, dur: 54, kind: trainer ? 'trainer' : 'wild' };
  state.events.push({ name: 'battle_start', kind });
}

const beatOf = ev => {
  const base = { kind: ev.type, side: ev.side, text: ev.text || null, ev };
  return base;
};

function pushEvents(B, events) { for (const ev of events) if (ev.type !== 'end') B.beats.push(beatOf(ev)); }

/** Apply a beat to the displayed state when it starts, and emit its sound event. */
function startBeat(game, state, b) {
  const B = state.battle, d = B.disp, ev = b.ev || {}, { content } = game;
  const sound = name => state.events.push({ name, battle: b.kind, side: b.side });
  switch (b.kind) {
    case 'switch': {
      const c = b.creature || ev.creature;
      d[b.side] = summary(content, c);
      if (b.side === 'foe') { d.foeShown = true; d.trainerOut = false; }
      if (b.side === 'player') d.exp = expBar(speciesOf(content, c.species).growth, c);
      sound('spawn'); break;
    }
    case 'damage': if (d[b.side]) { d[b.side].hp = ev.hp; d[b.side].maxHp = ev.maxHp; } sound(b.side === 'foe' ? 'hit' : 'hurt'); B.fx = { kind: 'hit', side: b.side, eff: ev.eff || 1, crit: !!ev.crit, moveType: ev.moveType, t: 0 }; break;
    case 'heal': if (ev.active !== false && d[b.side] && (b.side === 'foe' || ev.index == null || ev.index === B.rules.player.active)) { d[b.side].hp = ev.hp; d[b.side].maxHp = ev.maxHp; } sound('power'); break;
    case 'faint': if (d[b.side]) d[b.side].fainted = true; sound(b.side === 'foe' ? 'defeated' : 'fell'); break;
    case 'status': if (d[b.side] && !ev.volatile && (ev.active !== false)) d[b.side].status = ev.status; break;
    case 'exp': if (d.player?.uid === ev.uid) d.exp = ev.bar; break;
    case 'levelup':
      if (d.player?.uid === ev.uid) { d.player.level = ev.level; d.player.maxHp = ev.maxHp; d.player.hp = ev.hp; d.exp = ev.bar; }
      b.press = true; sound('level_up'); break;
    case 'move': B.fx = { kind: 'move', side: b.side, moveType: ev.moveType, category: ev.category, move: ev.move, t: 0 }; sound('shoot'); break;
    case 'item': if (lookup(content).items.get(ev.item)?.kind === 'ball') B.fx = { kind: 'throw', t: 0 }; break;
    case 'shake': sound('land'); break;
    case 'capture': if (ev.success) { sound('collect'); } else { d.foeShown = true; } break;
    case 'effective': if (ev.mult > 1) B.shake = 10; break;
    case 'run': if (ev.success) sound('menu_confirm'); break;
    default: break;
  }
  if (b.kind === 'item' && lookup(content).items.get(ev.item)?.kind === 'ball') d.foeShown = true;
  if (b.kind === 'shake' || (b.kind === 'item' && lookup(content).items.get(ev.item)?.kind === 'ball')) d.inBall = true;
  if (b.kind === 'capture') d.inBall = ev.success;
}

const textDone = (b, t) => !b.text || t * REVEAL >= b.text.length;

/** One battle frame. */
export function battleFrame(game, state, edges) {
  const B = state.battle;
  B.frame++;
  if (B.fx) { B.fx.t++; if (B.fx.t > 40) B.fx = null; }
  if (B.shake) B.shake--;
  if (B.phase === 'beats') return playBeats(game, state, edges);
  return menus(game, state, edges);
}

function playBeats(game, state, edges) {
  const B = state.battle;
  if (!B.beat) {
    if (!B.beats.length) { afterBeats(game, state); return; }
    B.beat = B.beats.shift(); B.bt = 0; startBeat(game, state, B.beat);
  }
  const b = B.beat;
  B.bt++;
  const anim = ANIM[b.kind] ?? 0;
  const revealed = textDone(b, B.bt);
  if (edges.a && b.text && !revealed) { B.bt = Math.ceil(b.text.length / REVEAL); return; }
  const minT = Math.max(anim, b.text ? Math.ceil(b.text.length / REVEAL) : 0);
  const ready = B.bt >= minT;
  const done = b.press ? ready && edges.a : (ready && (edges.a || B.bt >= minT + (b.text ? HOLD : 0)));
  if (done) { if (edges.a) state.events.push({ name: 'menu_move' }); B.beat = null; }
}

function afterBeats(game, state) {
  const B = state.battle, R = B.rules, { content } = game;
  const need = needsInput(R);
  if (need?.kind === 'learn') { B.phase = 'learn'; B.sub = 0; return; }
  if (R.over) {
    if (!B.outro) { B.outro = true; outro(game, state); return; }
    finishBattle(game, state); return;
  }
  if (need?.kind === 'switch') { B.phase = 'party'; B.forced = true; B.sub = Math.max(0, R.player.party.findIndex(c => c.hp > 0)); return; }
  void content;
  B.phase = 'menu';
}

function outro(game, state) {
  const B = state.battle, R = B.rules, res = battleResult(R), { content } = game;
  const player = content.player?.name || 'You';
  if (res.outcome === 'win' && B.trainer) {
    B.disp.trainerOut = true;
    B.beats.push({ kind: 'trainerOutro', text: `${player} defeated ${B.trainer.name}!` });
    if (B.trainer.defeat) B.beats.push({ kind: 'text', text: `${B.trainer.short}: "${fill(content, B.trainer.defeat)}"` });
    if (res.money > 0) B.beats.push({ kind: 'text', text: `${player} got ₽${res.money} for winning!` });
  } else if (res.outcome === 'capture') {
    const c = R.captured;
    if (!state.caught[c.species]) B.beats.push({ kind: 'text', text: `${c.name}'s data was added to the Dex.` });
    if (state.party.length >= 6) B.beats.push({ kind: 'text', text: `${c.name} was sent to the PC box.` });
  } else if (res.outcome === 'lose') {
    B.beats.push({ kind: 'text', text: `${player} is out of usable creatures!` }, { kind: 'text', text: `${player} blacked out!` });
  }
}

/** Write results back to the game state and return to the overworld. */
export function finishBattle(game, state) {
  const B = state.battle, R = B.rules, res = battleResult(R), { content } = game;
  state.party = R.player.party;
  const after = [];
  if (res.outcome === 'win') {
    state.stats.wins++;
    if (B.trainer) { state.money += res.money; if (B.trainer.id === 'rival') state.rivalBattles++; }
  }
  if (res.outcome === 'capture') {
    const c = structuredClone(R.captured);
    if (state.party.length < 6) state.party.push(c); else state.box.push(c);
    state.caught[c.species] = true; state.stats.caught++;
  }
  if (res.outcome === 'lose') {
    // Losing to a trainer in the world means a rematch later; story battles (rival, scripted) move on.
    state.script = B.story ? [{ op: 'blackout' }, ...state.script.slice(1).filter(o => o.op !== 'rival')] : [{ op: 'blackout' }];
  } else {
    for (const uid of R.leveled) { const c = state.party.find(x => x.uid === uid); if (c && c.hp > 0 && evolutionOf(content, c)) after.push({ op: 'evolve', uid }); }
    state.script.shift();
    state.script.unshift(...after);
  }
  state.battle = null;
  state.mode = 'overworld';
  state.events.push({ name: 'battle_end', outcome: res.outcome });
}

// ---------------------------------------------------------------- menus inside battle

const MENU = ['Fight', 'Bag', 'Party', 'Run'];
export const battleMenuItems = () => MENU;

/** Items usable in battle with counts, balls first. */
export function battleBag(game, state) {
  const { items } = lookup(game.content);
  const order = { ball: 0, heal: 1, status: 2, revive: 3 };
  return Object.entries(state.bag).filter(([id, n]) => n > 0 && items.get(id) && order[items.get(id).kind] !== undefined)
    .map(([id, n]) => ({ id, n, item: items.get(id) })).sort((a, b) => order[a.item.kind] - order[b.item.kind] || a.item.price - b.item.price);
}

function grid2(edges, cur, n) {
  let c = cur;
  if (edges.left || edges.right) c = c % 2 ? c - 1 : c + 1;
  if (edges.up || edges.down) c = c >= 2 ? c - 2 : c + 2;
  return c < n ? c : cur;
}
const list = (edges, cur, n) => (n ? (edges.up ? (cur + n - 1) % n : edges.down ? (cur + 1) % n : cur) : 0);

function resolve(game, state) {
  const B = state.battle;
  const { events } = resolveTurn(game.content, B.rules, state);
  pushEvents(B, events);
  B.phase = 'beats';
}

function say(B, text, back) { B.beats.push({ kind: 'text', text }); B.phase = 'beats'; B.back = back; }

function menus(game, state, edges) {
  const B = state.battle, R = B.rules, { content } = game;
  const me = R.player.party[R.player.active];
  const moved = (from, to) => { if (from !== to) state.events.push({ name: 'menu_move' }); return to; };
  const confirm = () => state.events.push({ name: 'menu_confirm' });
  switch (B.phase) {
    case 'menu': {
      B.cursor = moved(B.cursor, grid2(edges, B.cursor, 4));
      if (!edges.a) return;
      confirm();
      const pick = MENU[B.cursor];
      if (pick === 'Fight') { B.phase = 'moves'; B.sub = Math.min(B.sub, me.moves.length - 1); }
      else if (pick === 'Bag') { B.phase = 'bag'; B.sub = 0; }
      else if (pick === 'Party') { B.phase = 'party'; B.forced = false; B.sub = R.player.active; }
      else {
        const r = chooseAction(R, { kind: 'run' });
        if (!r.ok) { pushEvents(B, r.events); B.phase = 'beats'; } else resolve(game, state);
      }
      return;
    }
    case 'moves': {
      if (edges.b) { B.phase = 'menu'; return; }
      B.sub = moved(B.sub, grid2(edges, B.sub, me.moves.length));
      if (!edges.a) return;
      confirm();
      const r = chooseAction(R, { kind: 'move', index: B.sub });
      if (!r.ok) { pushEvents(B, r.events); B.phase = 'beats'; return; }
      resolve(game, state);
      return;
    }
    case 'bag': {
      const bag = battleBag(game, state);
      if (edges.b) { B.phase = 'menu'; return; }
      B.sub = moved(B.sub, list(edges, B.sub, bag.length));
      if (!edges.a || !bag.length) return;
      confirm();
      const entry = bag[B.sub];
      if (entry.item.kind === 'ball') {
        if (B.kind !== 'wild') { say(B, 'You can\'t catch another trainer\'s creature!'); return; }
        state.bag[entry.id]--;
        chooseAction(R, { kind: 'item', item: entry.id });
        resolve(game, state);
      } else { B.item = entry.id; B.phase = 'target'; B.sub = R.player.active; }
      return;
    }
    case 'target': {
      if (edges.b) { B.phase = 'bag'; B.sub = 0; return; }
      B.sub = moved(B.sub, list(edges, B.sub, R.player.party.length));
      if (!edges.a) return;
      confirm();
      const c = R.player.party[B.sub], item = lookup(content).items.get(B.item);
      const max = statsOf(content, c).hp;
      const ok = item.kind === 'heal' ? c.hp > 0 && c.hp < max : item.kind === 'status' ? c.hp > 0 && !!c.status : item.kind === 'revive' ? c.hp <= 0 : false;
      if (!ok) { say(B, 'It won\'t have any effect.'); B.phase = 'beats'; return; }
      state.bag[B.item]--;
      chooseAction(R, { kind: 'item', item: B.item, target: B.sub });
      resolve(game, state);
      return;
    }
    case 'party': {
      if (edges.b && !B.forced) { B.phase = 'menu'; return; }
      B.sub = moved(B.sub, list(edges, B.sub, R.player.party.length));
      if (!edges.a) return;
      confirm();
      const c = R.player.party[B.sub];
      if (c.hp <= 0) { say(B, `${c.name} has no energy left to battle!`); return; }
      if (B.sub === R.player.active && !B.forced) { say(B, `${c.name} is already in battle!`); return; }
      const r = chooseAction(R, { kind: 'switch', index: B.sub });
      if (!r.ok) { pushEvents(B, r.events); B.phase = 'beats'; return; }
      if (B.forced) { pushEvents(B, r.events); B.phase = 'beats'; B.forced = false; }
      else resolve(game, state);
      return;
    }
    case 'learn': {
      const q = needsInput(R);
      if (!q) { B.phase = 'beats'; return; }
      const c = R.player.party.find(x => x.uid === q.uid);
      const n = c.moves.length + 1;
      B.sub = moved(B.sub, list(edges, B.sub, n));
      if (edges.b || edges.a) {
        confirm();
        const forget = edges.b || B.sub >= c.moves.length ? null : B.sub;
        pushEvents(B, chooseAction(R, { kind: 'learn', forget }).events);
        B.phase = 'beats';
      }
      return;
    }
    default: B.phase = 'beats';
  }
}

/** What the renderer needs about the battle. */
export function battleView(game, state) {
  const B = state.battle, R = B.rules, { content } = game;
  const me = R.player.party[R.player.active];
  const b = B.beat;
  const q = B.phase === 'learn' ? needsInput(R) : null;
  const learnFor = q ? R.player.party.find(x => x.uid === q.uid) : null;
  return {
    kind: B.kind, phase: B.phase, cursor: B.cursor, sub: B.sub, forced: B.forced, frame: B.frame,
    trainer: B.trainer ? { name: B.trainer.name, short: B.trainer.short, look: B.trainer.look, sprite: B.trainer.sprite } : null,
    foe: B.disp.foe, player: B.disp.player, exp: B.disp.exp, foeShown: B.disp.foeShown, trainerOut: B.disp.trainerOut, inBall: !!B.disp.inBall,
    beat: b ? { kind: b.kind, side: b.side, text: b.text, shown: b.text ? Math.min(b.text.length, Math.floor(B.bt * REVEAL)) : 0, t: B.bt, press: !!b.press, ev: b.ev ? { ...b.ev, creature: undefined } : null, levelup: b.kind === 'levelup' ? { before: b.ev.before, after: b.ev.after, level: b.ev.level } : null } : null,
    fx: B.fx, shake: B.shake || 0,
    menu: MENU,
    moves: me.moves.map(m => { const mv = moveOf(content, m.id); return { id: m.id, name: mv.name, type: mv.type, typeName: content.types.find(t => t.id === mv.type)?.name || '—', color: content.types.find(t => t.id === mv.type)?.color || '#999', pp: m.pp, max: m.max, power: mv.power, category: mv.category, accuracy: mv.accuracy }; }),
    bag: battleBag(game, state).map(e => ({ id: e.id, name: e.item.name, n: e.n, kind: e.item.kind, description: e.item.description })),
    party: R.player.party.map(c => ({ ...summary(content, c), active: c === me })),
    item: B.item ? lookup(content).items.get(B.item)?.name : null,
    learn: learnFor ? { name: learnFor.name, move: moveOf(content, q.move).name, moves: learnFor.moves.map(m => moveOf(content, m.id).name) } : null,
  };
}
