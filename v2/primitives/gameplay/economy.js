// Economy: currencies held in vars (money.<id>), currency items that convert
// on pickup (coin pouches, cash), shops with stock, prices, a buy/sell spread,
// accepted goods, restocking by day and haggling. A shop opens through
// open_shop, an entity with a `shop` component (shop id), or talking to its owner.
import { give, take, count, room, bag } from './inventory.js';
import { item as itemDef, matches, whoKey } from './items-lib.js';

const KEY = 'gameplay.economy';
const parse = v => (typeof v === 'string' ? { item: v, count: 1 } : { item: v?.item, count: Math.max(1, v?.count ?? 1) });

export default {
  id: 'gameplay.economy',
  card: {
    loop: { verbs: ['buy', 'sell', 'haggle'], progress: ['bought', 'sold'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { buy: { type: 'choice', of: 'an item the open shop sells', from: 'options', emits: ['bought'] }, sell: { type: 'choice', of: 'an item in the bag', from: 'options', emits: ['sold'] } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "shops", "min": 1, "why": "an economy needs somewhere to spend", "example": [{"id": "general_store", "stock": [{"item": "potion", "price": 20}]}]},
      {"need": "items", "min": 3, "why": "shops sell items"},
    ],
    intent: 'Currencies (vars money.<id>, with currency items that convert on pickup), shops with stock, markup, a sell ratio, accepted goods, daily/weekly restock and haggling; give_money/take_money/pay effects and buy/sell actions.',
    views: ['any'],
    params: {
      currencies: { type: 'list', default: [{ id: 'gold', name: 'Gold' }], min: 1, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, name: { type: 'string' },
        var: { type: 'string', effect: "var holding the balance (default 'money.<id>')" },
        start: { type: 'number', default: 0, min: 0, effect: 'starting balance' },
        items: { type: 'list', default: [], of: { type: 'ref', to: 'item' }, effect: 'items that convert into this currency when gained (an item with the currency id converts too)' },
        perItem: { type: 'string', default: 'one', options: ['one', 'value'], effect: 'each converted item is worth 1, or its item value' },
      } }, effect: 'currencies; the first is the default' },
      shops: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true },
        owner: { type: 'ref', to: 'character', effect: 'talking to this character opens the shop' },
        currency: { type: 'string', effect: 'currency id (default the first)' },
        stock: { type: 'list', default: [], of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', default: 1, min: 0 }, price: { type: 'number', min: 0 } } } },
        restock: { type: 'string', default: 'never', options: ['daily', 'weekly', 'never'], effect: 'stock refills when var time.day advances past a day/week boundary' },
        buys: { type: 'list', default: [], of: { type: 'string' }, effect: "item tokens the shop buys (kind, tag, id, '*'); [] buys nothing" },
        markup: { type: 'number', default: 1, min: 0.1, max: 10, effect: 'price multiplier on item value or listed price' },
        buyback: { type: 'boolean', default: true, effect: 'items sold to the shop join its stock' },
      } }, effect: 'shops' },
      sellRatio: { type: 'number', default: 0.4, min: 0, max: 1, effect: 'fraction of item value paid when selling' },
      haggle: { type: 'boolean', default: false, effect: 'action haggle: once per visit, a chance at a discount (fails raise prices)' },
      haggleChance: { type: 'number', default: 0.5, min: 0, max: 1, effect: 'base success chance; var stat.charisma adds 5% per point' },
      haggleDiscount: { type: 'number', default: 0.15, min: 0, max: 0.9, effect: 'discount on success; the same rise on failure' },
      ownerOpens: { type: 'boolean', default: true, effect: 'talking to a shop owner (gameplay.interact) opens the shop' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['trade_denied', 'insufficient_funds'],
    provides: { events: ['bought', 'bought:*', 'sold', 'sold:*', 'paid', 'shop_opened', 'shop_closed', 'insufficient_funds', 'trade_denied', 'haggled', 'restocked'], vars: ['money.*'], actions: ['buy', 'sell', 'close_shop', 'haggle'], services: ['shop', 'economy'] },
    requires: { primitives: ['gameplay.inventory'] },
    reads: ['content.items'],
    defines: [{ kind: 'shop', in: 'shops' }, { kind: 'currency', in: 'currencies' }],
  },
  logic(logic) {
    const money = (rt, e) => rt.caches.economy?.(e) ?? null;
    const amountCheck = (e, path, errors) => { if (!Number.isFinite(e.amount) || e.amount < 0) errors.push({ code: 'effect_invalid', path: `${path}.amount`, message: 'amount must be a non-negative number' }); };
    logic.effect('give_money', { refs: e => (e.currency ? [['currency', e.currency]] : []), check: amountCheck, run: (e, rt) => money(rt, e)?.add(e.amount, e.currency) });
    logic.effect('take_money', { refs: e => (e.currency ? [['currency', e.currency]] : []), check: amountCheck, run: (e, rt) => money(rt, e)?.spend(e.amount, e.currency, { clamp: e.clamp }) });
    logic.effect('pay', { refs: e => (e.currency ? [['currency', e.currency]] : []), check: amountCheck, run: (e, rt) => { if (money(rt, e)?.spend(e.amount, e.currency)) rt.emit('paid', { to: e.to ?? null, amount: e.amount, currency: e.currency ?? null }); } });
    logic.effect('open_shop', { refs: e => [['shop', e.shop]], run: (e, rt, c) => rt.caches.shopOpen?.(whoKey(e.who, c), e.shop) });
    logic.effect('close_shop', { run: (e, rt, c) => rt.caches.shopClose?.(whoKey(e.who, c)) });
  },
  validate(config, doc, ctx, inst = {}) {
    const P = inst.path ? `${inst.path}.with` : undefined; // errors about this instance point at its `with`
    const errors = [], cur = new Set(config.currencies.map(c => c.id));
    const seen = new Set();
    for (const c of config.currencies) { if (seen.has(c.id)) errors.push({ code: 'id_duplicate', path: P, message: `duplicate currency '${c.id}'` }); seen.add(c.id); }
    for (const s of config.shops) if (s.currency && !cur.has(s.currency)) errors.push({ code: 'shop_invalid', path: P, message: `shop '${s.id}' uses unknown currency '${s.currency}'`, hint: [...cur].join(', ') });
    return errors;
  },
  install(rt, config) {
    const curs = new Map(config.currencies.map(c => [c.id, c])), shops = new Map(config.shops.map(s => [s.id, s]));
    const def0 = config.currencies[0].id;
    const varOf = id => curs.get(id ?? def0)?.var || `money.${id ?? def0}`;
    const st = () => { const s = rt.store(KEY); s.stock ??= Object.fromEntries(config.shops.map(sh => [sh.id, Object.fromEntries(sh.stock.map(x => [x.item, x.count]))])); s.open ??= {}; s.deal ??= {}; s.haggled ??= {}; s.period ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const balance = id => rt.state.vars[varOf(id)] ?? 0;
    const add = (n, id) => { rt.state.vars[varOf(id)] = +(balance(id) + n).toFixed(4); };
    function spend(n, id, { clamp = false } = {}) {
      if (balance(id) < n) { if (!clamp) { rt.emit('insufficient_funds', { amount: n, currency: id ?? def0, balance: balance(id) }); return false; } n = balance(id); }
      add(-n, id); return true;
    }
    rt.caches.economy = () => ({ add, spend });
    if (!rt.state.frame) for (const c of config.currencies) if (c.start && rt.state.vars[varOf(c.id)] == null) rt.state.vars[varOf(c.id)] = c.start;
    // Currency items convert into balance as they arrive (and any already held at start).
    const conv = new Map();
    for (const c of config.currencies) { for (const i of c.items) conv.set(i, c); if (!conv.has(c.id)) conv.set(c.id, c); }
    const convert = (who, itemId) => {
      const c = conv.get(itemId); if (!c || who !== 'player' || !itemDef(rt, itemId)) return;
      const n = take(rt, who, itemId, count(rt, who, itemId), { silent: true }); if (!n) return;
      add(n * (c.perItem === 'value' ? itemDef(rt, itemId)?.value ?? 1 : 1), c.id);
    };
    for (const id of conv.keys()) convert('player', id);
    rt.on('item_gained', d => convert(d.who, d.item));

    const shopOf = who => { const id = st().open[who]; return id ? shops.get(id) : null; };
    const price = (shop, itemId) => {
      const listed = shop.stock.find(x => x.item === itemId)?.price, base = listed ?? itemDef(rt, itemId)?.value ?? 1;
      return Math.max(0, Math.round(base * shop.markup * (st().deal[shop.id] ?? 1)));
    };
    const sellPrice = (shop, itemId) => (matches(itemDef(rt, itemId), shop.buys) ? Math.floor((itemDef(rt, itemId)?.value ?? 0) * config.sellRatio) : 0);
    function restock(shop) {
      if (shop.restock === 'never') return;
      const day = rt.state.vars['time.day'] ?? 0, period = shop.restock === 'daily' ? day : Math.floor(day / 7), s = st();
      if (s.period[shop.id] == null) { s.period[shop.id] = period; return; }
      if (period > s.period[shop.id]) { s.period[shop.id] = period; s.stock[shop.id] = Object.fromEntries(shop.stock.map(x => [x.item, x.count])); rt.emit('restocked', { shop: shop.id }); }
    }
    function open(who, id) {
      const shop = shops.get(id); if (!shop) return;
      restock(shop); st().open[who] = id; delete st().deal[id]; delete st().haggled[id];
      rt.emit('shop_opened', { shop: id, who });
    }
    function close(who) { const id = st().open[who]; if (!id) return; delete st().open[who]; delete st().deal[id]; rt.emit('shop_closed', { shop: id, who }); }
    rt.caches.shopOpen = open; rt.caches.shopClose = close;
    const deny = (reason, d) => { rt.emit('trade_denied', { reason, ...d }); return false; };
    function buy(who, itemId, n) {
      const shop = shopOf(who); if (!shop) return deny('closed', { item: itemId });
      const have = st().stock[shop.id][itemId] ?? 0; if (have < n) return deny('stock', { item: itemId, shop: shop.id });
      const cost = price(shop, itemId) * n;
      if (room(rt, who, itemId) < n) return deny('full', { item: itemId, shop: shop.id });
      if (!spend(cost, shop.currency)) return deny('funds', { item: itemId, shop: shop.id });
      st().stock[shop.id][itemId] = have - n;
      give(rt, who, itemId, n);
      rt.emitTyped('bought', itemId, { who, item: itemId, count: n, price: cost, shop: shop.id });
      return true;
    }
    function sell(who, itemId, n) {
      const shop = shopOf(who); if (!shop) return deny('closed', { item: itemId });
      const unit = sellPrice(shop, itemId); if (unit <= 0) return deny('refused', { item: itemId, shop: shop.id });
      const k = take(rt, who, itemId, n); if (!k) return deny('missing', { item: itemId, shop: shop.id });
      add(unit * k, shop.currency);
      if (shop.buyback) st().stock[shop.id][itemId] = (st().stock[shop.id][itemId] ?? 0) + k;
      rt.emitTyped('sold', itemId, { who, item: itemId, count: k, price: unit * k, shop: shop.id });
      return true;
    }
    rt.action('buy', (v, rt) => { const { item, count: n } = parse(v); buy('player', item, n); });
    rt.action('sell', (v, rt) => { const { item, count: n } = parse(v); sell('player', item, n); });
    rt.action('close_shop', () => close('player'));
    if (config.haggle) rt.action('haggle', () => {
      const shop = shopOf('player'); if (!shop || st().haggled[shop.id]) return;
      st().haggled[shop.id] = true;
      const ok = rt.random() < Math.min(1, config.haggleChance + 0.05 * (rt.state.vars['stat.charisma'] ?? 0));
      st().deal[shop.id] = ok ? 1 - config.haggleDiscount : 1 + config.haggleDiscount;
      rt.emit('haggled', { shop: shop.id, success: ok });
    });
    rt.on('interacted', d => {
      const t = rt.entity(d.target); if (!t) return;
      if (typeof t.components.shop === 'string' && shops.has(t.components.shop)) open(d.who, t.components.shop);
      else if (config.ownerOpens && d.kind === 'talk' && !t.components.interact?.dialogue) { const s = config.shops.find(x => x.owner === t.id); if (s) open(d.who, s.id); }
    });
    rt.options(rt => {
      const shop = shopOf('player'); if (!shop) return [];
      const out = [];
      for (const [itemId, n] of Object.entries(st().stock[shop.id]).sort()) if (n > 0 && balance(shop.currency) >= price(shop, itemId)) out.push({ label: `buy ${itemId}`, actions: { buy: itemId } });
      for (const itemId of Object.keys(bag(rt, 'player')).sort()) if (sellPrice(shop, itemId) > 0) out.push({ label: `sell ${itemId}`, actions: { sell: itemId } });
      return [...out.slice(0, 16), { label: `leave ${shop.id}`, actions: { close_shop: true } }];
    });
    const view = who => { const shop = shopOf(who); if (!shop) return null; const stock = Object.entries(st().stock[shop.id]).map(([item, n]) => ({ item, count: n, price: price(shop, item) })); const sellPrices = {}; for (const item of Object.keys(bag(rt, who))) { const p = sellPrice(shop, item); if (p > 0) sellPrices[item] = p; } return { shop: shop.id, owner: shop.owner ?? null, currency: shop.currency ?? def0, stock, sellPrices }; };
    rt.provide('shop', { open: (who = 'player') => view(who), price: (shop, item) => price(shops.get(shop), item) });
    rt.provide('economy', { balance: id => balance(id), add, spend, currencies: () => [...curs.keys()] });
  },
};
