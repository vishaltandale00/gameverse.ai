// graphics.ui.cards: card-game presentation for gameplay.cards: a fanned
// hand that lifts the focused card, cost gems and playable glow, procedural
// card art, energy orb, draw/discard piles, enemies with intents and health,
// a board row for duel formats, targeting, and End turn. Reads the cards
// service view; sends play_card {uid,target?}, attack_with {uid,target} and
// end_turn through view.act.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, setText, setStyle, setClass, pulse, titleCase, clamp, hashHue, fmtInt } from './ui-lib.js';
import { portrait, portraitColor } from './ui-portrait.js';
import { icon } from './ui-icons.js';
import { moveFocus } from './ui-input.js';
import * as S from './ui-sources.js';

const TYPE = { attack: { color: '#c8473a', icon: 'sword' }, skill: { color: '#3a7ac8', icon: 'shield' }, power: { color: '#c8a03a', icon: 'star' }, spell: { color: '#7a4ac8', icon: 'bolt' }, creature: { color: '#4a9a5a', icon: 'person' }, curse: { color: '#5a3a5a', icon: 'skull' }, status: { color: '#6a6a7a', icon: 'hourglass' } };

/** Fan layout for n cards: [{ x, y, rot }] in px around the hand origin (bottom centre). */
export function handLayout(n, { width = 900, cardWidth = 140, maxRot = 14, arc = 26 } = {}) {
  if (n <= 0) return [];
  const step = Math.min(cardWidth * 0.82, (width - cardWidth) / Math.max(1, n - 1));
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1
    return { x: +((i - (n - 1) / 2) * step).toFixed(2), y: +(Math.abs(t) ** 2 * arc).toFixed(2), rot: +(t * Math.min(maxRot, 3 + n * 1.4)).toFixed(2) };
  });
}
/** Targets a card needs: enemy ids for 'enemy'/'unit'/'any', none for self/none/all. */
export function cardTargets(view, card) {
  const t = card?.target;
  if (t === 'enemy' || t === 'unit' || t === 'any' || t === 'single') return (view.enemies || []).filter(e => !e.dead).map(e => e.id);
  return [];
}
const cardDef = (doc, id) => doc.content?.cards?.find(c => c.id === id) || null;
/** Procedural card art: a gradient and motif in the card's own hue. */
export const cardArt = (id, type) => { const h = hashHue(id), h2 = (h + 40) % 360; return `radial-gradient(circle at 30% 25%, hsl(${h} 70% 70% / .9), transparent 45%), radial-gradient(circle at 75% 80%, hsl(${h2} 60% 45% / .9), transparent 55%), linear-gradient(135deg, hsl(${h} 45% 28%), hsl(${h2} 50% 18%))${type === 'power' ? ', repeating-conic-gradient(from 0deg, #fff1 0 10deg, transparent 10deg 20deg)' : ''}`; };

export default {
  id: 'graphics.ui.cards',
  card: {
    // The quantities it shows a person (graphics/ui-defaults.js: a loop's goal it displays needs no HUD widget).
    displays: [{ component: 'health', of: 'opponents' }, { component: 'health', of: 'player' }],
    intent: 'Card game UI for any deck game: fanned hand with focus lift, costs and playable glow, procedural card art, energy, draw/discard piles, enemies with intents and health, duel board row, targeting and End turn.',
    views: ['ui', 'any'],
    // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
    interactions: ['menu'],
    controls: { verbs: ['play_card', 'end_turn'] },
    params: {
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES] },
      maxHand: { type: 'integer', default: 12, min: 1, max: 20, effect: 'cards laid out before the fan compresses' },
    },
    reads: ['content.cards', 'content.models'],
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el, theme = resolveTheme(rt.doc, config.style);
    const enemies = el('div.gv-enemies'), board = el('div.gv-enemies', { style: { top: 'auto', bottom: '40%' } }), hand = el('div.gv-hand');
    const energy = el('div.gv-energy', { aria: { label: 'Energy' } });
    const draw = el('div.gv-pile.is-draw', {}, el('div.gv-pile-stack'), el('span', { text: 'Draw' }));
    const discard = el('div.gv-pile.is-discard', {}, el('div.gv-pile-stack'), el('span', { text: 'Discard' }));
    const endBtn = el('button.gv-btn.gv-endturn', { attrs: { type: 'button' }, text: 'End turn' });
    const screen = el('section.gv-screen.gv-cards.gv-hide', { attrs: { 'data-theme': theme }, aria: { label: 'Card battle' } }, enemies, board, energy, draw, discard, endBtn, hand);
    host.layer('screen').append(screen);
    let view = null, focus = 0, targeting = null, handSig = '', foeSig = '', boardSig = '';
    const cardNodes = [], foeNodes = new Map();
    const layer = { id: 'cards', modal: true, onVerb: verb => press(verb) };
    const focusables = () => [...cardNodes, endBtn];

    function press(verb) {
      if (!view) return false;
      if (targeting) {
        if (verb === 'left' || verb === 'right') { targeting.i = (targeting.i + (verb === 'left' ? -1 : 1) + targeting.ids.length) % targeting.ids.length; paintTargets(); host.sound('move'); }
        else if (verb === 'confirm') play(targeting.card, targeting.ids[targeting.i]);
        else if (verb === 'back') { targeting = null; paintTargets(); host.sound('back'); }
        return true;
      }
      if (verb === 'left' || verb === 'right' || verb === 'up' || verb === 'down') { const list = focusables(); const i = moveFocus(focus, verb === 'up' ? 'left' : verb === 'down' ? 'right' : verb, list.length, 1); if (i !== focus) { focus = i; paintFocus(); host.sound('move'); } return true; }
      if (verb === 'confirm') { focusables()[focus]?._run?.(); return true; }
      if (verb === 'next') { endTurn(); return true; }
      return true;
    }
    function choose(c) {
      if (!c.playable) { host.sound('error'); pulse(cardNodes[view.hand.indexOf(c)] || hand, 'is-shake'); return; }
      const def = cardDef(rt.doc, c.card) || {};
      const ids = cardTargets(view, { target: c.target ?? def.target });
      if (ids.length > 1) { targeting = { card: c, ids, i: 0 }; paintTargets(); host.sound('confirm'); return; }
      play(c, ids[0]);
    }
    function play(c, target) { rt.view.act({ play_card: target ? { uid: c.uid, target } : { uid: c.uid } }); host.sound('confirm'); const n = cardNodes[view.hand.indexOf(c)]; n?.classList.add('is-played'); targeting = null; paintTargets(); }
    function endTurn() { if (S.canAct(rt, 'end_turn')) { rt.view.act({ end_turn: true }); host.sound('confirm'); } }
    endBtn._run = endTurn; endBtn.addEventListener('click', endTurn);
    function paintFocus() { focusables().forEach((n, k) => setClass(n, 'is-focus', k === focus)); }
    function paintTargets() { for (const [id, n] of foeNodes) setClass(n, 'is-target', Boolean(targeting) && targeting.ids[targeting.i] === id); }

    function paintHand() {
      const sig = JSON.stringify(view.hand.map(c => [c.uid, c.playable, c.cost]));
      if (sig === handSig) return; handSig = sig;
      const n = view.hand.length, width = Math.min(1100, (host.root.clientWidth || 1000) * 0.8);
      const lay = handLayout(n, { width: Math.min(width, 140 * Math.min(n, config.maxHand)) });
      cardNodes.length = 0;
      fill(hand, ...view.hand.map((c, i) => {
        const def = cardDef(rt.doc, c.card) || {}, type = c.type || def.type || 'skill', t = TYPE[type] || TYPE.skill;
        const node = el(`div.gv-card${c.playable ? '.is-playable' : '.is-unplayable'}`, { role: 'button', aria: { label: `${c.name || def.name || titleCase(c.card)}, cost ${c.cost ?? def.cost ?? 0}` }, style: { '--x': `${lay[i].x}px`, '--y': `${lay[i].y}px`, '--rot': `${lay[i].rot}deg`, '--ct': t.color, '--art': cardArt(c.card, type), 'animation-delay': `${i * 35}ms`, 'z-index': i } },
          el('div.gv-card-cost', { text: c.cost ?? def.cost ?? 0 }), el('div.gv-card-name', { text: c.name || def.name || titleCase(c.card) }),
          el('div.gv-card-art', { style: { display: 'grid', 'place-items': 'center' } }, icon(t.icon, { color: '#ffffff' })),
          el('div.gv-card-type', { text: titleCase(type) }), el('div.gv-card-text', { text: c.text || def.text || '' }));
        node._run = () => choose(c);
        node.addEventListener('click', () => { focus = i; paintFocus(); choose(c); });
        node.addEventListener('pointerenter', () => { focus = i; paintFocus(); });
        cardNodes.push(node); return node;
      }));
      focus = clamp(focus, 0, focusables().length - 1); paintFocus();
    }
    function paintFoes() {
      const list = view.enemies || [];
      const sig = JSON.stringify(list.map(e => e.id));
      if (sig !== foeSig) {
        foeSig = sig; foeNodes.clear();
        fill(enemies, ...list.map(e => {
          const ent = rt.entity(e.id), model = ent?.components?.model || ent?.archetype || e.id;
          const n = el('div.gv-foe', { data: { foe: e.id }, style: { '--who': portraitColor(rt.doc, model) } }, el('span.gv-intent'), el('div.gv-bsprite', {}, portrait(rt.doc, model, { mode: 'full' })), el('b', { text: S.entityName(rt, e.id, e.name) }),
            el('div.gv-meter', { style: { width: '150px', 'min-width': '0' } }, el('div.gv-meter-track', {}, el('div.gv-meter-chip'), el('div.gv-meter-fill', { style: { '--fill': '#ff5d5d' } })), el('span.gv-meter-value')));
          n.addEventListener('click', () => { if (targeting) { const i = targeting.ids.indexOf(e.id); if (i >= 0) play(targeting.card, e.id); } });
          foeNodes.set(e.id, n); return n;
        }));
      }
      for (const e of list) {
        const n = foeNodes.get(e.id); if (!n) continue;
        const hp = S.health(rt.entity(e.id)) || { hp: e.hp ?? 0, max: e.hpMax ?? 1 }, frac = clamp(hp.hp / (hp.max || 1), 0, 1);
        setStyle(n.querySelector('.gv-meter-fill'), 'transform', `scaleX(${frac.toFixed(4)})`); setStyle(n.querySelector('.gv-meter-chip'), 'transform', `scaleX(${frac.toFixed(4)})`);
        setText(n.querySelector('.gv-meter-value'), `${fmtInt(hp.hp)}/${fmtInt(hp.max)}${e.block ? ` · ${e.block} block` : ''}`);
        const it = e.intent, intent = n.querySelector('.gv-intent');
        const key = JSON.stringify(it);
        if (intent.getAttribute('data-sig') !== key) { intent.setAttribute('data-sig', key); intent.setAttribute('data-kind', it?.kind || ''); fill(intent, ...(it ? [icon(it.kind === 'attack' ? 'sword' : it.kind === 'block' || it.kind === 'defend' ? 'shield' : it.kind === 'buff' ? 'star' : 'eye'), it.label || (it.value ? `${it.value}${it.times > 1 ? `×${it.times}` : ''}` : titleCase(it.kind))] : [])); }
        setClass(n, 'is-down', hp.dead || hp.hp <= 0);
      }
    }
    function paintBoard() {
      const list = view.board || [];
      const sig = JSON.stringify(list);
      if (sig === boardSig) return; boardSig = sig;
      fill(board, ...list.map(b => { const def = cardDef(rt.doc, b.card) || {}; const n = el(`div.gv-card${b.canAttack ? '.is-playable' : ''}`, { style: { position: 'relative', '--x': '0px', '--y': '0px', '--rot': '0deg', '--art': cardArt(b.card, def.type || 'creature'), 'margin-left': '0', '--ct': (TYPE[def.type] || TYPE.creature).color } }, el('div.gv-card-name', { text: def.name || titleCase(b.card) }), el('div.gv-card-art'), el('div.gv-card-text', { text: `${b.power ?? def.power ?? 0} / ${b.health ?? def.health ?? 0}` })); n.addEventListener('click', () => { if (b.canAttack && S.canAct(rt, 'attack_with')) { const t = (view.enemies || [])[0]?.id; rt.view.act({ attack_with: t ? { uid: b.uid, target: t } : { uid: b.uid } }); } }); return n; }));
    }

    rt.view.onFrame(() => {
      const next = S.cardsView(rt);
      if (!next) { if (view) { view = null; screen.classList.add('gv-hide'); host.input.pop(layer); handSig = foeSig = boardSig = ''; targeting = null; } return; }
      if (!view) { screen.classList.remove('gv-hide'); pulse(screen, 'is-in'); host.input.push(layer); }
      view = next;
      setText(energy, `${view.energy ?? 0}/${view.energyMax ?? view.energy ?? 0}`); setClass(energy, 'is-empty', !view.energy);
      setText(draw.firstChild, view.piles?.draw ?? 0); setText(discard.firstChild, view.piles?.discard ?? 0);
      setStyle(endBtn, 'display', S.canAct(rt, 'end_turn') ? null : 'none');
      paintFoes(); paintBoard(); paintHand();
    });
  },
};
