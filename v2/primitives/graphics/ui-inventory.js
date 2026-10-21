// graphics.ui.inventory: one sheet with panels for items (sorted grid with
// details and the primary action), equipment (a paper doll of slots),
// crafting (recipes with have/need), loadout (charm notches), skills
// (abilities and perks), and trade panels that open themselves when a shop
// or container opens. Every button maps to an action the item primitives
// register (equip, use_item, craft, buy, sell, take, store...), and is shown
// only when that action exists. Layout helpers are pure.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, titleCase, itemName, charName, docItem, docSystem, fmtInt, isNum } from './ui-lib.js';
import { icon, itemIcon } from './ui-icons.js';
import { createSheet } from './ui-sheet.js';
import * as S from './ui-sources.js';

export const PANELS = ['items', 'equipment', 'crafting', 'loadout', 'container', 'shop', 'skills'];
const LABEL = { items: 'Items', equipment: 'Equipment', crafting: 'Crafting', loadout: 'Charms', container: 'Container', shop: 'Shop', skills: 'Skills' };
const KIND_ORDER = ['weapon', 'tool', 'armor', 'charm', 'potion', 'food', 'key', 'quest', 'material', 'block', 'ammo', 'currency', 'prop', 'misc'];
const RARITY = { common: 'transparent', uncommon: '#6fd08c', rare: '#5aa8ff', epic: '#c06cff', legendary: '#ffb347' };

const blockColor = (doc, it) => it?.block ? doc.content?.blocks?.find(b => b.id === it.block)?.color : null;
/** Currency items are shown as money, not in the grid (when an economy defines them). */
const isCurrency = (doc, id) => docItem(doc, id)?.kind === 'currency';

/** Sorted inventory cells, padded to fill whole rows: [{ id, count, def } | null]. */
export function inventoryLayout(bag, doc, { sort = true, columns = 8, slots = 36, hideCurrency = true } = {}) {
  let list = Object.entries(bag).filter(([id, n]) => n > 0 && !(hideCurrency && isCurrency(doc, id))).map(([id, count]) => ({ id, count, def: docItem(doc, id) || { id, name: titleCase(id), kind: 'misc' } }));
  if (sort) list.sort((a, b) => (KIND_ORDER.indexOf(a.def.kind) + 1 || 99) - (KIND_ORDER.indexOf(b.def.kind) + 1 || 99) || String(a.def.name || a.id).localeCompare(String(b.def.name || b.id)));
  const total = Math.max(list.length, Math.min(slots, 60));
  const cells = [...list, ...Array(Math.max(0, total - list.length)).fill(null)];
  while (cells.length % columns) cells.push(null);
  return cells;
}

/** Paper-doll position (percent x, y) per slot id; unknown slots ring the figure. */
export function dollLayout(slots) {
  const KNOWN = { head: [50, 7], helmet: [50, 7], neck: [72, 14], chest: [50, 36], body: [50, 36], armor: [50, 36], back: [28, 14], legs: [50, 64], feet: [50, 92], boots: [50, 92],
    weapon: [13, 40], main: [13, 40], mainhand: [13, 40], gun: [13, 66], ranged: [13, 66], offhand: [87, 40], shield: [87, 40], hands: [87, 66], ring: [87, 66], charm: [87, 88], tool: [13, 90], accessory: [87, 88] };
  const used = new Set(), free = [[13, 14], [87, 14], [13, 90], [87, 90], [28, 92], [72, 92]];
  return slots.map(s => { let p = KNOWN[s.id] || KNOWN[s.accepts?.[0]?.split(':').pop()]; if (!p || used.has(p.join())) p = free.find(f => !used.has(f.join())) || [50, 50]; used.add(p.join()); return { id: s.id, x: p[0], y: p[1] }; });
}

/** Recipe rows: [{ id, name, output, count, inputs:[{label, need, have, ok}], known, craftable, station }] */
export function craftRows(rt, who = 'player') {
  const doc = rt.doc, bag = S.bag(rt, who), set = S.craftable(rt, who), here = S.station(rt, who);
  const tagged = tag => Object.entries(bag).filter(([id]) => docItem(doc, id)?.tags?.includes(tag) || docItem(doc, id)?.ingredient?.tags?.includes(tag)).reduce((n, [, c]) => n + c, 0);
  return (doc.content?.recipes || []).map(r => {
    const known = r.learned === false ? S.safeTest(rt, { knows: r.id }) : (S.hasPredicate(rt, 'knows') ? S.safeTest(rt, { knows: r.id }) || r.learned === undefined || r.learned === true : true);
    const inputs = (r.inputs || []).map(i => { const have = i.item ? bag[i.item] || 0 : tagged(i.tag); return { label: i.item ? itemName(doc, i.item) : `any ${titleCase(i.tag)}`, need: i.count ?? 1, have, ok: have >= (i.count ?? 1) }; });
    const atStation = !r.station || here?.id === r.station || Boolean(here?.tags?.includes?.(r.station));
    const craftable = set ? set.has(r.id) : inputs.every(i => i.ok) && atStation;
    return { id: r.id, name: itemName(doc, r.output?.item) || titleCase(r.id), output: r.output?.item, count: r.output?.count ?? 1, inputs, known, craftable: known && craftable, station: r.station || null, atStation };
  }).filter(r => r.known);
}

/** Shop rows with affordability: { buy:[{item,name,price,count,afford}], sell:[{item,name,price,count}] , currency, wallet } */
export function shopRows(rt, shop, who = 'player') {
  const doc = rt.doc, bag = S.bag(rt, who), money = S.money(rt), cur = money.find(m => m.id === shop.currency) || money[0] || { value: 0, name: '', id: '' };
  const sellRatio = docSystem(doc, 'gameplay.economy')?.with?.sellRatio ?? 0.4;
  const buy = (shop.stock || []).map(s => ({ item: s.item, name: itemName(doc, s.item), price: s.price ?? Math.ceil((docItem(doc, s.item)?.value ?? 1) * (shop.markup ?? 1)), count: s.count, afford: cur.value >= (s.price ?? 0) && (s.count ?? 1) > 0 }));
  const sell = Object.entries(bag).filter(([id, n]) => n > 0 && !isCurrency(doc, id) && docItem(doc, id)?.kind !== 'quest' && docItem(doc, id)?.kind !== 'key').map(([id, n]) => ({ item: id, name: itemName(doc, id), count: n, price: shop.sellPrices?.[id] ?? Math.max(1, Math.floor((docItem(doc, id)?.value ?? 1) * sellRatio)) }));
  return { buy, sell, currency: cur.id, wallet: cur.value, currencyName: cur.name };
}

/** The primary action for an item in the bag: unequip | equip | use_item | null. */
export function primaryAction(rt, def, equippedIds) {
  if (equippedIds.has(def.id) && S.canAct(rt, 'unequip')) return { verb: 'unequip', label: 'Unequip', value: def.id };
  if ((def.weapon || def.armor || def.charm || def.ranged || def.tool || def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'charm') && S.canAct(rt, 'equip')) return { verb: 'equip', label: 'Equip', value: def.id };
  if (def.use && S.canAct(rt, 'use_item')) return { verb: 'use_item', label: def.kind === 'food' ? 'Eat' : def.kind === 'potion' ? 'Drink' : 'Use', value: def.id };
  return null;
}

function statLines(doc, def) {
  const out = [];
  if (def.weapon) { const w = def.weapon; if (isNum(w.damage)) out.push(['Damage', `${w.damage}${w.type && w.type !== 'phys' ? ` ${w.type}` : ''}`]); if (isNum(w.reach)) out.push(['Reach', w.reach]); if (isNum(w.speed)) out.push(['Speed', w.speed]); }
  if (def.armor?.def) for (const [t, v] of Object.entries(def.armor.def)) out.push([`Defence (${t})`, v]);
  if (def.charm) { if (isNum(def.charm.cost)) out.push(['Notches', def.charm.cost]); for (const [k, v] of Object.entries(def.charm.mods || {})) out.push([titleCase(k), `${v > 0 ? '+' : ''}${v}`]); }
  for (const [k, v] of Object.entries(def.stats || {})) out.push([titleCase(k), `${v > 0 ? '+' : ''}${v}`]);
  if (def.tool) out.push(['Tool', `${titleCase(def.tool.kind)}${def.tool.tier ? ` (tier ${def.tool.tier})` : ''}`]);
  if (isNum(def.value)) out.push(['Value', fmtInt(def.value)]);
  return out;
}

export default {
  id: 'graphics.ui.inventory',
  card: {
    intent: 'Inventory sheet for any game: sorted item grid with details and use/equip, equipment paper doll, crafting recipes with have/need, charm loadout with notch budget, skills, and shop/container trade panels that open when the game opens a shop or container.',
    views: ['any'],
    // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
    interactions: ['avatar-realtime', 'avatar-grid', 'menu'],
    controls: { verbs: ['equip', 'unequip', 'use_item', 'craft', 'buy', 'sell', 'take', 'store', 'close_shop', 'close_container'] },
    params: {
      panels: { type: 'list', default: ['items'], min: 1, of: { type: 'string', options: PANELS }, effect: 'which panels the sheet has' },
      sort: { type: 'boolean', default: true, effect: 'sort items by kind then name' },
      columns: { type: 'integer', default: 8, min: 3, max: 14, effect: 'grid columns' },
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES], effect: 'visual theme' },
      pause: { type: 'boolean', default: true, effect: 'hold the simulation while open' },
    },
    reads: ['content.items', 'content.recipes', 'content.blocks'],
  },
  validate(config) {
    const seen = new Set(), errors = [];
    config.panels?.forEach((t, i) => { if (seen.has(t)) errors.push({ code: 'ui_tab_duplicate', path: `with.panels[${i}]`, message: `panel '${t}' is listed twice` }); seen.add(t); });
    return errors;
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, doc = () => rt.doc;
    const slotsMax = docSystem(rt.doc, 'gameplay.inventory')?.with?.slots ?? 36;
    let trade = null, lastSig = '';
    const visiblePanels = () => config.panels.filter(p => (p === 'shop' ? trade?.kind === 'shop' : p === 'container' ? trade?.kind === 'container' : true));
    const wallet = el('span.gv-wallet');
    const sheet = createSheet(host, {
      id: 'inventory', title: 'Inventory', theme: resolveTheme(rt.doc, config.style), hotkey: 'inventory', pause: config.pause,
      tabs: () => visiblePanels().map(p => ({ id: p, label: p === 'shop' && trade?.owner ? charName(doc(), trade.owner) : p === 'container' ? titleCase(trade?.id || 'Container') : LABEL[p] })),
      hints: tab => ({ items: [['confirm', 'Use / equip']], equipment: [['confirm', 'Unequip']], crafting: [['confirm', 'Craft']], loadout: [['confirm', 'Equip / remove']], shop: [['confirm', 'Buy / sell']], container: [['confirm', 'Take / store']], skills: [['confirm', 'Unlock']] }[tab] || []),
      renderTab: (tab, body, sh) => PAINT[tab]?.(body, sh),
      refresh(tab) { const sig = signature(tab); if (sig !== lastSig) { if (lastSig) sheet.rerender(); lastSig = sig; } paintWallet(); },
      onOpen() { lastSig = ''; paintWallet(); },
      onClose() { if (trade?.kind === 'shop' && S.canAct(rt, 'close_shop')) rt.view.act({ close_shop: true }); if (trade?.kind === 'container' && S.canAct(rt, 'close_container')) rt.view.act({ close_container: true }); },
    });
    sheet.extra.append(wallet);
    function paintWallet() { const m = S.money(rt); fill(wallet, ...m.map(c => el('span.gv-price', {}, icon(c.id), fmtInt(c.value)))); }
    function signature(tab) { return JSON.stringify([tab, S.bag(rt), trade && (trade.kind === 'shop' ? S.shop(rt) : S.container(rt)), tab === 'equipment' || tab === 'loadout' || tab === 'items' ? S.equipment(rt) : null, tab === 'crafting' ? craftRows(rt).map(r => r.craftable) : null, S.money(rt).map(m => m.value)]); }
    const act = (verb, value) => { if (!S.canAct(rt, verb)) { host.sound('error'); return false; } rt.view.act({ [verb]: value }); host.sound('confirm'); return true; };
    const equippedIds = () => new Set((S.equipment(rt)?.slots || []).flatMap(s => s.items));
    const slotCell = (cell, { equipped, label } = {}) => {
      if (!cell) return el('div.gv-slot.is-empty', { aria: { hidden: 'true' } });
      const ic = itemIcon(cell.def, blockColor(doc(), cell.def));
      return el(`button.gv-slot${equipped ? '.is-equipped' : ''}`, { attrs: { type: 'button', 'aria-label': `${cell.def.name || cell.id}${cell.count > 1 ? `, ${cell.count}` : ''}` }, style: { '--rar': RARITY[cell.def.rarity] || 'transparent' } },
        icon(ic.name, { color: ic.color, label: cell.def.name }), cell.count > 1 ? el('span.gv-slot-count', { text: fmtInt(cell.count) }) : null, label ? el('span.gv-slot-label', { text: label }) : null);
    };
    const detailFor = (detail, def, extra = []) => {
      const ic = itemIcon(def, blockColor(doc(), def));
      fill(detail, el('div.gv-art', { style: { display: 'grid', 'place-items': 'center' } }, icon(ic.name, { color: ic.color })),
        el('div.gv-kicker', { text: titleCase(def.kind || 'item') }), el('h3', { text: def.name || titleCase(def.id) }),
        def.desc ? el('p', { text: def.desc }) : null,
        el('dl.gv-stats', {}, ...statLines(doc(), def).flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })])), ...extra);
    };

    const PAINT = {
      items(body, sh) {
        const cells = inventoryLayout(S.bag(rt), doc(), { sort: config.sort, columns: config.columns, slots: slotsMax });
        const grid = el('div.gv-grid', { style: { '--cols': config.columns } }), detail = el('article.gv-detail');
        fill(body, el('div.gv-inv-body', {}, grid, detail));
        const eq = equippedIds(), focusables = [], map = [];
        for (const cell of cells) { const n = slotCell(cell, { equipped: cell && eq.has(cell.id) }); grid.append(n); if (cell) { focusables.push(n); map.push(cell); } }
        if (!map.length) { fill(detail, el('p.gv-empty', { text: 'Your bag is empty.' })); return; }
        sh.setItems(focusables, { columns: config.columns,
          onFocus: i => { const a = primaryAction(rt, map[i].def, eq); detailFor(detail, map[i].def, [map[i].count > 1 ? el('p.gv-dim', { text: `Carrying ${fmtInt(map[i].count)}` }) : null, a ? el('div.gv-actions', {}, el('button.gv-btn', { attrs: { type: 'button' }, on: { click: () => act(a.verb, a.value) } }, a.label)) : null]); },
          onConfirm: i => { const a = primaryAction(rt, map[i].def, eq); if (a) act(a.verb, a.value); } });
      },
      equipment(body, sh) {
        const eq = S.equipment(rt), slots = eq?.slots?.filter(s => !(s.max > 1 && s.accepts?.includes('charm'))) || [];
        const doll = el('div.gv-doll'), detail = el('article.gv-detail');
        doll.append(el('div.gv-doll-figure', {}, silhouette()));
        fill(body, el('div.gv-inv-body', {}, doll, detail));
        if (!slots.length) { fill(detail, el('p.gv-empty', { text: 'Nothing can be equipped.' })); return; }
        const pos = dollLayout(slots), nodes = slots.map((s, i) => { const id = s.items[0], def = id && (docItem(doc(), id) || { id, name: titleCase(id) }); const n = slotCell(def ? { id, count: 1, def } : null, { label: titleCase(s.id) }); if (!def) { n.classList.remove('is-empty'); n.append(el('span.gv-slot-label', { text: titleCase(s.id) })); n.setAttribute('tabindex', '0'); } n.style.setProperty('left', `${pos[i].x}%`); n.style.setProperty('top', `${pos[i].y}%`); doll.append(n); return n; });
        // Doll navigation: nearest slot in the pressed direction.
        sh.setItems(nodes, {
          onMove: dir => { const cur = pos[sh.index], cand = pos.map((p, i) => ({ i, dx: p.x - cur.x, dy: p.y - cur.y })).filter(c => c.i !== sh.index && (dir === 'left' ? c.dx < -1 : dir === 'right' ? c.dx > 1 : dir === 'up' ? c.dy < -1 : c.dy > 1)); if (cand.length) { const best = cand.sort((a, b) => Math.hypot(a.dx, a.dy * 1.3) - Math.hypot(b.dx, b.dy * 1.3))[0]; sh.focus(best.i); host.sound('move'); } return true; },
          onFocus: i => { const s = slots[i], id = s.items[0]; if (id) detailFor(detail, docItem(doc(), id) || { id, name: titleCase(id) }, [el('p.gv-dim', { text: `Slot: ${titleCase(s.id)}` })]); else fill(detail, el('div.gv-kicker', { text: 'Empty slot' }), el('h3', { text: titleCase(s.id) }), el('p.gv-dim', { text: `Accepts ${s.accepts.map(a => titleCase(a.replace(':', ' '))).join(', ') || 'anything'}.` })); },
          onConfirm: i => { const s = slots[i]; if (s.items[0]) act('unequip', s.id); else sheet.open('items'); } });
      },
      loadout(body, sh) {
        const eq = S.equipment(rt), slot = eq?.slots?.find(s => s.accepts?.includes('charm')) || null, budget = eq?.budget;
        const owned = Object.keys(S.bag(rt)).filter(id => docItem(doc(), id)?.charm || docItem(doc(), id)?.kind === 'charm');
        const on = new Set(slot?.items || []);
        const top = el('div');
        if (budget) { const used = budget.used ?? 0, total = budget.total ?? 0; top.append(el(`div.gv-notches${used > total ? '.is-over' : ''}`, { aria: { label: `${used} of ${total} notches used` } }, el('span.gv-dim', { text: 'Notches' }), ...Array.from({ length: Math.max(total, used) }, (_, i) => el(`i.gv-notch${i < used ? '.is-used' : ''}`)))); }
        const grid = el('div.gv-grid', { style: { '--cols': Math.min(config.columns, 6) } }), detail = el('article.gv-detail');
        fill(body, el('div.gv-inv-body', {}, el('div', {}, top, grid), detail));
        if (!owned.length) { fill(detail, el('p.gv-empty', { text: 'No charms yet.' })); return; }
        const cells = owned.map(id => ({ id, count: 1, def: docItem(doc(), id) }));
        const nodes = cells.map(c => { const n = slotCell(c, { equipped: on.has(c.id) }); grid.append(n); return n; });
        sh.setItems(nodes, { columns: Math.min(config.columns, 6),
          onFocus: i => detailFor(detail, cells[i].def, [el('p.gv-dim', { text: on.has(cells[i].id) ? 'Equipped' : 'Not equipped' })]),
          onConfirm: i => (on.has(cells[i].id) ? act('unequip', cells[i].id) : act('equip', slot ? { item: cells[i].id, slot: slot.id } : cells[i].id)) });
      },
      crafting(body, sh) {
        const rows = craftRows(rt), list = el('div.gv-rows'), detail = el('article.gv-detail');
        fill(body, el('div.gv-inv-body', {}, list, detail));
        const st = S.station(rt);
        if (!rows.length) { fill(detail, el('p.gv-empty', { text: 'You know no recipes yet.' })); return; }
        const nodes = rows.map(r => { const ic = itemIcon(docItem(doc(), r.output), blockColor(doc(), docItem(doc(), r.output))); const n = el(`button.gv-btn${r.craftable ? '' : '.is-locked'}`, { attrs: { type: 'button' } }, icon(ic.name, { color: ic.color }), el('span.gv-row-main', {}, el('span', { text: `${r.name}${r.count > 1 ? ` ×${r.count}` : ''}` }), el('span.gv-row-sub', { text: r.inputs.map(i => `${i.have}/${i.need} ${i.label}`).join(' · ') })), r.craftable ? el('small', { text: 'Ready' }) : null); list.append(n); return n; });
        sh.setItems(nodes, {
          onFocus: i => { const r = rows[i], def = docItem(doc(), r.output) || { id: r.output, name: r.name }; detailFor(detail, def, [el('div.gv-kicker', { text: 'Needs' }), el('ul.gv-objectives', {}, ...r.inputs.map(x => el(`li.${x.ok ? 'is-done' : 'is-pending'}`, {}, el('span.gv-check'), el('span', {}, `${x.label} `, el(`span.gv-need${x.ok ? '' : '.is-short'}`, { text: `${x.have}/${x.need}` }))))), r.station ? el('p.gv-dim', { text: r.atStation ? `At ${titleCase(r.station)}` : `Needs a ${titleCase(r.station)}${st ? ` (here: ${st.name || titleCase(st.id)})` : ''}` }) : null]); },
          onConfirm: i => { const r = rows[i]; if (r.craftable) act('craft', r.id); else host.sound('error'); } });
      },
      shop(body, sh) {
        const shop = S.shop(rt); if (!shop) return;
        const rows = shopRows(rt, shop), list = el('div.gv-rows'), detail = el('article.gv-detail');
        fill(body, el('div.gv-inv-body', {}, list, detail));
        const entries = [];
        const section = t => list.append(el('div.gv-list-section', {}, el('span', { text: t })));
        const row = (r, kind) => { const def = docItem(doc(), r.item) || { id: r.item, name: r.name }, ic = itemIcon(def, blockColor(doc(), def)); const short = kind === 'buy' && !r.afford; const n = el(`button.gv-btn${short ? '.is-locked' : ''}`, { attrs: { type: 'button' } }, icon(ic.name, { color: ic.color }), el('span.gv-row-main', {}, el('span', { text: r.name }), el('span.gv-row-sub', { text: kind === 'buy' ? (isNum(r.count) ? `${r.count} in stock` : '') : `You have ${r.count}` })), el(`span.gv-price${short ? '.is-short' : ''}`, {}, icon(rows.currency || 'coin'), fmtInt(r.price))); list.append(n); entries.push({ n, r, kind, def }); };
        if (rows.buy.length && S.canAct(rt, 'buy')) { section('Buy'); rows.buy.forEach(r => row(r, 'buy')); }
        if (rows.sell.length && S.canAct(rt, 'sell')) { section('Sell'); rows.sell.forEach(r => row(r, 'sell')); }
        if (!entries.length) { fill(detail, el('p.gv-empty', { text: 'Nothing to trade.' })); return; }
        sh.setItems(entries.map(e => e.n), {
          onFocus: i => detailFor(detail, entries[i].def, [el('p', {}, el('b', { text: `${entries[i].kind === 'buy' ? 'Buy' : 'Sell'} for ${fmtInt(entries[i].r.price)} ${rows.currencyName}` }))]),
          onConfirm: i => { const e = entries[i]; if (e.kind === 'buy' && !e.r.afford) { host.sound('error'); return; } act(e.kind, { item: e.r.item, count: 1 }); } });
      },
      container(body, sh) {
        const c = S.container(rt); if (!c) return;
        const theirs = inventoryLayout(c.items || {}, doc(), { sort: config.sort, columns: 5, slots: 10, hideCurrency: false }), mine = inventoryLayout(S.bag(rt), doc(), { sort: config.sort, columns: 5, slots: 10 });
        const left = el('div.gv-grid', { style: { '--cols': 5 } }), right = el('div.gv-grid', { style: { '--cols': 5 } });
        fill(body, el('div.gv-inv-body', { style: { 'grid-template-columns': '1fr 1fr' } }, el('div', {}, el('div.gv-list-section', {}, el('span', { text: titleCase(c.id) }), S.canAct(rt, 'take_all') ? el('button.gv-tab', { attrs: { type: 'button' }, on: { click: () => act('take_all', true) }, text: 'Take all' }) : null), left), el('div', {}, el('div.gv-list-section', {}, el('span', { text: 'You' })), right)));
        const nodes = [], refs = [];
        // Interleave rows of both grids so the D-pad moves naturally across.
        const rowsL = chunk(theirs, 5), rowsR = chunk(mine, 5);
        for (let r = 0; r < Math.max(rowsL.length, rowsR.length); r++) {
          for (const [cells, grid, side] of [[rowsL[r] || Array(5).fill(null), left, 'take'], [rowsR[r] || Array(5).fill(null), right, 'store']]) for (const cell of cells) { const n = slotCell(cell); grid.append(n); nodes.push(n); refs.push(cell && { cell, side }); }
        }
        sh.setItems(nodes, { columns: 10, index: Math.max(0, refs.findIndex(Boolean)), onConfirm: i => { const r = refs[i]; if (r) act(r.side, { item: r.cell.id, count: r.cell.count }); } });
      },
      skills(body, sh) {
        const abil = docSystem(doc(), 'gameplay.progression.abilities')?.with?.abilities || [], tree = docSystem(doc(), 'gameplay.progression.tree')?.with?.nodes || [];
        const list = el('div.gv-rows'), detail = el('article.gv-detail'), entries = [];
        const lvl = rt.state.vars.level, xp = rt.state.vars.xp, next = rt.state.vars['xp.next'];
        fill(body, el('div.gv-inv-body', {}, el('div', {}, isNum(lvl) ? el('div.gv-list-section', {}, el('span', { text: `Level ${lvl}` }), el('span', { text: isNum(xp) ? `${fmtInt(xp)}${isNum(next) ? ` / ${fmtInt(next)}` : ''} XP` : '' })) : null, list), detail));
        for (const a of abil) { const has = S.safeTest(rt, { ability: a.id }); entries.push({ id: a.id, name: a.name || titleCase(a.id), desc: a.desc, has, kind: 'ability' }); }
        for (const n of tree) { const has = S.safeTest(rt, { perk: n.id }); entries.push({ id: n.id, name: n.name || titleCase(n.id), desc: n.desc || Object.entries(n.mods || {}).map(([k, v]) => `${titleCase(k)} ${v > 0 ? '+' : ''}${v}`).join(', '), has, kind: 'perk', cost: n.cost, requires: n.requires }); }
        if (!entries.length) { fill(detail, el('p.gv-empty', { text: 'No skills to show.' })); return; }
        const nodes = entries.map(e => { const n = el(`button.gv-btn${e.has ? '' : '.is-locked'}`, { attrs: { type: 'button' } }, icon(e.has ? 'check' : 'lock'), el('span.gv-row-main', {}, el('span', { text: e.name }), e.desc ? el('span.gv-row-sub', { text: e.desc }) : null), e.cost ? el('small', { text: `${e.cost} pt` }) : null); list.append(n); return n; });
        sh.setItems(nodes, { onFocus: i => { const e = entries[i]; fill(detail, el('div.gv-kicker', { text: e.kind === 'perk' ? 'Perk' : 'Ability' }), el('h3', { text: e.name }), e.desc ? el('p', { text: e.desc }) : null, el('p.gv-dim', { text: e.has ? 'Unlocked' : e.requires?.length ? `Requires ${e.requires.map(titleCase).join(', ')}` : 'Locked' })); },
          onConfirm: i => { const e = entries[i]; if (!e.has && e.kind === 'perk') act('unlock_perk', e.id); } });
      },
    };
    const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    function silhouette() {
      const svg = el('svg', { attrs: { viewBox: '0 0 100 150', fill: 'none' } });
      svg.append(el('path', { svg: true, attrs: { d: 'M50 8a14 14 0 1 1 0 28 14 14 0 0 1 0-28zM28 44h44l10 40-10 2-4-22v30l4 50H58l-8-42-8 42H30l4-50V64l-4 22-10-2z', fill: 'currentColor', opacity: 0.12, stroke: 'currentColor', 'stroke-opacity': 0.3 } }));
      return svg;
    }
    // Trade panels open themselves when the game opens a shop or container.
    rt.view.onFrame(() => {
      const shop = config.panels.includes('shop') ? S.shop(rt) : null, box = config.panels.includes('container') ? S.container(rt) : null;
      const now = shop ? { kind: 'shop', id: shop.shop, owner: shop.owner } : box ? { kind: 'container', id: box.id } : null;
      const was = trade; trade = now;
      if (now && (!was || was.id !== now.id)) sheet.open(now.kind);
      else if (!now && was && sheet.isOpen && (sheet.tab === 'shop' || sheet.tab === 'container')) sheet.close();
    });
    host.on('open', ({ panel, tab }) => { if (panel === 'inventory') sheet.open(tab); });
  },
};
