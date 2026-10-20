// Out-of-battle menus: the start menu (Party, Bag, Dex, Save), party summary and reorder, bag use,
// the mart (buy/sell), the PC box and the evolution scene. Each is a small state machine over
// `state.menu`, `state.shop`, `state.pc` or `state.evolution`, driven by edge inputs.
import { lookup, statsOf, summary, moveOf, speciesOf, evolutionOf, evolve, expBar } from '../rules/index.js';

export const START_ITEMS = ['Party', 'Bag', 'Dex', 'Save', 'Close'];
const POCKETS = [['Items', ['heal', 'status', 'revive', 'repel']], ['Balls', ['ball']], ['Key', ['key']]];

const list = (edges, cur, n) => (n ? (edges.up ? (cur + n - 1) % n : edges.down ? (cur + 1) % n : cur) : 0);
const top = state => state.menu.stack[state.menu.stack.length - 1];

export function openMenu(state) {
  state.menu = { stack: [{ kind: 'start', cursor: 0 }], message: null };
  state.mode = 'menu';
  state.events.push({ name: 'menu_confirm' });
}
function close(state) { state.menu = null; state.mode = 'overworld'; }

export function pocketItems(game, state, pocket) {
  const { items } = lookup(game.content);
  const kinds = POCKETS[pocket][1];
  return Object.entries(state.bag).filter(([id, n]) => n > 0 && kinds.includes(items.get(id)?.kind)).map(([id, n]) => ({ id, n, item: items.get(id) }));
}

export function menuFrame(game, state, edges) {
  const m = state.menu, f = top(state), { content } = game;
  const moved = (a, b) => { if (a !== b) state.events.push({ name: 'menu_move' }); return b; };
  if (m.message) { m.message.t++; if ((edges.a || edges.b) && m.message.t > 8) m.message = null; return; }
  const msg = text => { m.message = { text, t: 0 }; };
  switch (f.kind) {
    case 'start': {
      if (edges.b) return close(state);
      f.cursor = moved(f.cursor, list(edges, f.cursor, START_ITEMS.length));
      if (!edges.a) return;
      state.events.push({ name: 'menu_confirm' });
      const pick = START_ITEMS[f.cursor];
      if (pick === 'Party') m.stack.push({ kind: 'party', cursor: 0, swap: null });
      else if (pick === 'Bag') m.stack.push({ kind: 'bag', pocket: 0, cursor: 0 });
      else if (pick === 'Dex') m.stack.push({ kind: 'dex', cursor: 0 });
      else if (pick === 'Save') { state.saves++; state.events.push({ name: 'save' }); msg(`${content.player?.name || 'You'} saved the game.`); }
      else close(state);
      return;
    }
    case 'party': {
      if (edges.b) { if (f.swap != null) f.swap = null; else m.stack.pop(); return; }
      f.cursor = moved(f.cursor, list(edges, f.cursor, state.party.length));
      if (!edges.a) return;
      state.events.push({ name: 'menu_confirm' });
      if (f.swap != null) {
        const a = f.swap, b = f.cursor;
        [state.party[a], state.party[b]] = [state.party[b], state.party[a]];
        f.swap = null;
        return;
      }
      m.stack.push({ kind: 'partyAction', index: f.cursor, cursor: 0, options: ['Summary', 'Switch', 'Cancel'] });
      return;
    }
    case 'partyAction': {
      if (edges.b) { m.stack.pop(); return; }
      f.cursor = moved(f.cursor, list(edges, f.cursor, f.options.length));
      if (!edges.a) return;
      const pick = f.options[f.cursor];
      m.stack.pop();
      if (pick === 'Summary') m.stack.push({ kind: 'summary', index: f.index });
      else if (pick === 'Switch') top(state).swap = f.index;
      return;
    }
    case 'summary': {
      if (edges.b || edges.a) { m.stack.pop(); return; }
      if (edges.left || edges.up) f.index = moved(f.index, (f.index + state.party.length - 1) % state.party.length);
      if (edges.right || edges.down) f.index = moved(f.index, (f.index + 1) % state.party.length);
      return;
    }
    case 'bag': {
      if (edges.b) { m.stack.pop(); return; }
      if (edges.left) { f.pocket = moved(f.pocket, (f.pocket + POCKETS.length - 1) % POCKETS.length); f.cursor = 0; }
      if (edges.right) { f.pocket = moved(f.pocket, (f.pocket + 1) % POCKETS.length); f.cursor = 0; }
      const items = pocketItems(game, state, f.pocket);
      f.cursor = moved(f.cursor, list(edges, f.cursor, items.length));
      if (!edges.a || !items.length) return;
      state.events.push({ name: 'menu_confirm' });
      const it = items[f.cursor].item;
      if (it.kind === 'heal' || it.kind === 'status' || it.kind === 'revive') m.stack.push({ kind: 'useOn', item: it.id, cursor: 0 });
      else if (it.kind === 'repel') { state.bag[it.id]--; state.repel = it.value || 100; msg(`${content.player?.name || 'You'} used the ${it.name}. Weak wild creatures will keep away.`); }
      else if (it.kind === 'ball') msg('Use this in battle against a wild creature.');
      else msg(it.description || 'It\'s an important item.');
      return;
    }
    case 'useOn': {
      if (edges.b) { m.stack.pop(); return; }
      f.cursor = moved(f.cursor, list(edges, f.cursor, state.party.length));
      if (!edges.a) return;
      const it = lookup(content).items.get(f.item), c = state.party[f.cursor], max = statsOf(content, c).hp;
      const used = useItemOn(it, c, max);
      if (!used) { msg('It won\'t have any effect.'); return; }
      state.bag[it.id]--;
      state.events.push({ name: 'power' });
      msg(used);
      if (!state.bag[it.id]) m.stack.pop();
      return;
    }
    case 'dex': {
      if (edges.b) { m.stack.pop(); return; }
      f.cursor = moved(f.cursor, list(edges, f.cursor, content.species.length));
      return;
    }
    default: close(state);
  }
}

/** Field use of a healing item. Returns the message, or null if it has no effect. */
export function useItemOn(it, c, max) {
  if (it.kind === 'heal' && c.hp > 0 && c.hp < max) { const amt = Math.min(max - c.hp, it.value <= 1 ? Math.floor(max * it.value) : it.value); c.hp += amt; return `${c.name} recovered ${amt} HP.`; }
  if (it.kind === 'status' && c.hp > 0 && c.status) { c.status = null; c.sleep = 0; return `${c.name} is cured.`; }
  if (it.kind === 'revive' && c.hp <= 0) { c.hp = Math.max(1, Math.floor(max * (it.value || 0.5))); return `${c.name} was revived!`; }
  return null;
}

export function menuView(game, state) {
  const m = state.menu, f = top(state), { content } = game;
  const party = state.party.map(c => ({ ...summary(content, c), exp: expBar(speciesOf(content, c.species).growth, c) }));
  const out = { kind: f.kind, cursor: f.cursor, stack: m.stack.map(x => x.kind), message: m.message?.text || null, items: START_ITEMS, money: state.money, badges: state.badges.length, party, startCursor: m.stack[0].cursor };
  if (f.kind === 'party' || f.kind === 'partyAction' || f.kind === 'useOn') { out.swap = m.stack.find(x => x.kind === 'party')?.swap ?? null; out.partyCursor = m.stack.find(x => x.kind === 'party')?.cursor ?? f.cursor; }
  if (f.kind === 'partyAction') out.options = f.options;
  if (f.kind === 'useOn') out.item = lookup(content).items.get(f.item)?.name;
  if (f.kind === 'summary') {
    const c = state.party[f.index], st = statsOf(content, c), sp = speciesOf(content, c.species);
    out.summary = { ...summary(content, c), index: f.index, stats: st, exp: c.exp, bar: expBar(sp.growth, c), dex: sp.dex, typeNames: sp.types.map(t => content.types.find(x => x.id === t)?.name || t), moves: c.moves.map(mm => { const mv = moveOf(content, mm.id); return { name: mv.name, type: mv.type, typeName: content.types.find(t => t.id === mv.type)?.name || '—', pp: mm.pp, max: mm.max, power: mv.power, category: mv.category }; }) };
  }
  if (f.kind === 'bag' || f.kind === 'useOn') {
    const bag = m.stack.find(x => x.kind === 'bag');
    out.pocket = bag.pocket; out.pockets = POCKETS.map(p => p[0]); out.bagCursor = bag.cursor;
    out.bag = pocketItems(game, state, bag.pocket).map(e => ({ id: e.id, name: e.item.name, n: e.n, description: e.item.description, kind: e.item.kind }));
  }
  if (f.kind === 'dex') out.dex = content.species.map((s, i) => ({ n: i + 1, id: s.id, name: state.seen[s.id] || state.caught[s.id] ? s.name : '-----', seen: !!state.seen[s.id], caught: !!state.caught[s.id], types: s.types, dex: state.caught[s.id] ? s.dex : '' }));
  return out;
}

// ---------------------------------------------------------------- mart

export function openShop(game, state, areaId) {
  const area = lookup(game.content).areas.get(areaId);
  const stock = (area?.mart?.length ? area.mart : game.content.items.filter(i => i.kind !== 'key' && i.price > 0).slice(0, 4).map(i => i.id));
  state.shop = { stock, tab: 0, cursor: 0, message: null };
  state.mode = 'shop';
}

export function shopFrame(game, state, edges) {
  const s = state.shop, { items } = lookup(game.content);
  if (s.message) { s.message.t++; if ((edges.a || edges.b) && s.message.t > 6) s.message = null; return; }
  if (edges.b) { state.shop = null; state.mode = 'overworld'; state.script.shift(); state.script.unshift({ op: 'say', who: 'clerk', name: 'Clerk', text: 'Please come again!' }); return; }
  if (edges.left || edges.right) { s.tab = 1 - s.tab; s.cursor = 0; state.events.push({ name: 'menu_move' }); }
  const rows = shopRows(game, state);
  const n = rows.length;
  if (edges.up && n) { s.cursor = (s.cursor + n - 1) % n; state.events.push({ name: 'menu_move' }); }
  if (edges.down && n) { s.cursor = (s.cursor + 1) % n; state.events.push({ name: 'menu_move' }); }
  if (!edges.a || !n) return;
  const row = rows[s.cursor], it = items.get(row.id);
  if (s.tab === 0) {
    if (state.money < it.price) { s.message = { text: 'You don\'t have enough money.', t: 0 }; return; }
    state.money -= it.price; state.bag[it.id] = (state.bag[it.id] || 0) + 1;
    state.events.push({ name: 'collect' });
    s.message = { text: `Bought a ${it.name} for ₽${it.price}.`, t: 0 };
  } else {
    const price = Math.floor(it.price / 2);
    state.bag[it.id]--; state.money += price;
    state.events.push({ name: 'collect' });
    s.message = { text: `Sold a ${it.name} for ₽${price}.`, t: 0 };
    if (s.cursor >= shopRows(game, state).length) s.cursor = Math.max(0, s.cursor - 1);
  }
}

export function shopRows(game, state) {
  const { items } = lookup(game.content), s = state.shop;
  if (s.tab === 0) return s.stock.map(id => items.get(id)).filter(Boolean).map(it => ({ id: it.id, name: it.name, price: it.price, have: state.bag[it.id] || 0, description: it.description }));
  return Object.entries(state.bag).filter(([id, n]) => n > 0 && items.get(id) && items.get(id).kind !== 'key' && items.get(id).price > 0).map(([id, n]) => ({ id, name: items.get(id).name, price: Math.floor(items.get(id).price / 2), have: n, description: items.get(id).description }));
}

export const shopView = (game, state) => ({ tab: state.shop.tab, cursor: state.shop.cursor, rows: shopRows(game, state), money: state.money, message: state.shop.message?.text || null });

// ---------------------------------------------------------------- PC box

export function openPc(state) { state.pc = { col: 0, cursor: 0, message: null }; state.mode = 'pc'; }

export function pcFrame(game, state, edges) {
  const s = state.pc;
  if (s.message) { s.message.t++; if ((edges.a || edges.b) && s.message.t > 6) s.message = null; return; }
  if (edges.b) { state.pc = null; state.mode = 'overworld'; state.script.shift(); return; }
  if (edges.left || edges.right) { s.col = 1 - s.col; s.cursor = 0; state.events.push({ name: 'menu_move' }); }
  const from = s.col === 0 ? state.party : state.box;
  const n = from.length;
  if (edges.up && n) { s.cursor = (s.cursor + n - 1) % n; state.events.push({ name: 'menu_move' }); }
  if (edges.down && n) { s.cursor = (s.cursor + 1) % n; state.events.push({ name: 'menu_move' }); }
  if (!edges.a || !n) return;
  const c = from[s.cursor];
  if (s.col === 0) {
    if (state.party.filter(x => x.hp > 0 && x !== c).length < 1) { s.message = { text: 'You need at least one healthy creature with you!', t: 0 }; return; }
    state.party.splice(s.cursor, 1); state.box.push(c);
    s.message = { text: `${c.name} was stored in the box.`, t: 0 };
  } else {
    if (state.party.length >= 6) { s.message = { text: 'Your party is full!', t: 0 }; return; }
    state.box.splice(s.cursor, 1); state.party.push(c);
    s.message = { text: `${c.name} joined your party.`, t: 0 };
  }
  s.cursor = Math.max(0, Math.min(s.cursor, (s.col === 0 ? state.party : state.box).length - 1));
  state.events.push({ name: 'menu_confirm' });
}

export const pcView = (game, state) => ({ col: state.pc.col, cursor: state.pc.cursor, message: state.pc.message?.text || null, party: state.party.map(c => summary(game.content, c)), box: state.box.map(c => summary(game.content, c)) });

// ---------------------------------------------------------------- evolution

export const EVOLVE_FRAMES = 200;

export function startEvolution(game, state, uid) {
  const c = state.party.find(x => x.uid === uid);
  const to = c && evolutionOf(game.content, c);
  if (!to) return false;
  state.evolution = { uid, from: c.species, to, t: 0, phase: 'intro', name: c.name, toName: speciesOf(game.content, to).name };
  state.mode = 'evolution';
  return true;
}

export function evolutionFrame(game, state, edges) {
  const e = state.evolution;
  e.t++;
  if (e.phase === 'intro') { if (e.t > 70 || (edges.a && e.t > 20)) { e.phase = 'morph'; e.t = 0; state.events.push({ name: 'evolve_start' }); } return; }
  if (e.phase === 'morph') {
    if (edges.b) { e.phase = 'stopped'; e.t = 0; return; }
    if (e.t >= EVOLVE_FRAMES) {
      const c = state.party.find(x => x.uid === e.uid);
      evolve(game.content, c, e.to);
      state.caught[e.to] = true; state.seen[e.to] = true;
      e.phase = 'done'; e.t = 0;
      state.events.push({ name: 'level_up', evolve: true }, { name: 'evolve', species: e.to });
    }
    return;
  }
  if ((e.phase === 'done' || e.phase === 'stopped') && e.t > 30 && (edges.a || e.t > 150)) {
    state.evolution = null; state.mode = 'overworld'; state.script.shift();
  }
}

export function evolutionView(game, state) {
  const e = state.evolution;
  const text = e.phase === 'intro' ? `What? ${e.name} is evolving!` : e.phase === 'morph' ? `What? ${e.name} is evolving!` : e.phase === 'stopped' ? `Huh? ${e.name} stopped evolving!` : `Congratulations! Your ${e.name} evolved into ${e.toName}!`;
  return { from: e.from, to: e.to, phase: e.phase, t: e.t, dur: EVOLVE_FRAMES, text };
}
