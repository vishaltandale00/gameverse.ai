// graphics.ui.journal: the quest log (tracked, active, available, completed,
// failed with objective progress and rewards), lore codex, bestiary,
// characters met and notes, in one tabbed sheet. journalModel() is pure: it
// groups document data by what the state says is known.
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, fill, titleCase, charName, itemName, zoneName, isNum, fmtInt } from './ui-lib.js';
import { icon } from './ui-icons.js';
import { portrait, portraitColor } from './ui-portrait.js';
import { createSheet } from './ui-sheet.js';
import * as S from './ui-sources.js';

export const TABS = ['quests', 'clues', 'lore', 'bestiary', 'characters', 'notes'];
const LABEL = { quests: 'Quests', clues: 'Clues', lore: 'Lore', bestiary: 'Bestiary', characters: 'People', notes: 'Notes' };
const KIND = { main: 'Main quest', side: 'Side quest', contract: 'Contract', bounty: 'Bounty', challenge: 'Challenge' };
const CREATURES = new Set(['enemy', 'boss', 'creature', 'mount']);
const entryTab = e => (/bestiary|creature|enemy/.test(e.tag || '') ? 'bestiary' : /note/.test(e.tag || '') ? 'notes' : /character|person/.test(e.tag || '') ? 'characters' : 'lore');

function rewardsText(doc, r) {
  if (!r) return [];
  const out = [];
  if (r.xp) out.push(`${fmtInt(r.xp)} XP`);
  if (r.money) out.push(typeof r.money === 'object' ? Object.entries(r.money).map(([c, n]) => `${fmtInt(n)} ${titleCase(c)}`).join(', ') : `${fmtInt(r.money)} money`);
  for (const it of r.items || []) out.push(`${itemName(doc, it.item)}${it.count > 1 ? ` ×${it.count}` : ''}`);
  for (const rp of r.rep || []) out.push(`${rp.delta > 0 ? '+' : ''}${rp.delta} ${titleCase(rp.faction)}`);
  return out;
}

/** The journal view model: { tabs: [{ id, label, badge, sections: [{ id, title, entries: [{ key, title, sub, state, detail }] }] }] } */
export function journalModel(rt, config) {
  const doc = rt.doc, tabs = [];
  for (const id of config.tabs) {
    const sections = [];
    if (id === 'quests') {
      const list = S.quests(rt);
      const tracked = S.trackedQuest(list);
      const entry = q => {
        const objectives = (q.objectives || []).filter(o => !o.hidden || o.state === 'done').map(o => ({ id: o.id, text: o.text || '', state: q.state === 'failed' && o.state !== 'done' ? 'failed' : o.state, optional: Boolean(o.optional), progress: isNum(o.progress) && o.count > 1 ? Math.min(o.progress, o.count) / o.count : null, label: S.objectiveProgress(o).trim() }));
        const done = objectives.filter(o => o.state === 'done').length;
        return { key: `q:${q.id}`, id: q.id, title: q.title || '', sub: q.state === 'active' ? `${done}/${objectives.length}` : '', state: q.state, main: q.kind === 'main',
          detail: { kicker: KIND[q.kind] || 'Quest', title: q.title || '', text: q.summary || '', meta: [q.giver && `From ${charName(doc, q.giver)}`, q.zone && zoneName(doc, q.zone)].filter(Boolean), objectives, rewards: rewardsText(doc, q.rewards), tracked: q === tracked, trackable: q.state === 'active' } };
      };
      const by = s => list.filter(q => q.state === s).sort((a, b) => (b.kind === 'main') - (a.kind === 'main'));
      if (tracked) sections.push({ id: 'tracked', title: 'Tracking', entries: [entry(tracked)] });
      sections.push({ id: 'active', title: 'Active', entries: by('active').filter(q => q !== tracked).map(entry) });
      sections.push({ id: 'available', title: 'Available', entries: by('available').map(entry) });
      sections.push({ id: 'complete', title: 'Completed', entries: by('complete').map(entry) });
      sections.push({ id: 'failed', title: 'Failed', entries: by('failed').map(entry) });
    } else if (id === 'clues') {
      // The case so far (plot.investigation): the clues found and the conclusions drawn, read from its service and state.
      const found = new Set(S.svc(rt, 'investigation', 'clues') || []), deduced = rt.state.prim['plot.investigation']?.deduced || {};
      sections.push({ id: 'found', title: 'Found', entries: (doc.plot?.clues || []).filter(c => found.has(c.id)).map(c => ({ key: `k:${c.id}`, title: c.title || '', sub: '', detail: { kicker: 'Clue', title: c.title || '', text: c.text || '' } })) });
      sections.push({ id: 'concluded', title: 'Concluded', entries: (doc.plot?.deductions || []).filter(d => deduced[d.id]).map(d => ({ key: `d:${d.id}`, title: d.title || '', sub: d.wrong ? 'wrong' : '', state: d.wrong ? 'failed' : 'complete', detail: { kicker: d.wrong ? 'A wrong theory' : 'Conclusion', title: d.title || '', text: d.conclusion || '' } })) });
    } else if (id === 'lore' || id === 'notes') {
      const known = (doc.plot?.entries || []).filter(e => entryTab(e) === id && S.known(rt, e));
      const groups = new Map();
      for (const e of known) { const g = e.tag || id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ key: `e:${e.id}`, title: e.title || '', sub: '', detail: { kicker: titleCase(g), title: e.title || '', text: e.text || '' } }); }
      for (const [g, entries] of groups) sections.push({ id: g, title: titleCase(g), entries });
    } else if (id === 'bestiary') {
      const entries = [];
      for (const a of doc.content?.archetypes || []) {
        if (!CREATURES.has(a.kind)) continue;
        const defeated = S.count(rt, `defeated:${a.id}`), lore = (doc.plot?.entries || []).find(e => e.archetype === a.id || (entryTab(e) === 'bestiary' && e.id === a.id));
        const seen = defeated > 0 || (lore && S.known(rt, lore)) || S.count(rt, `seen:${a.id}`) > 0;
        if (!seen) continue;
        const hp = a.components?.health?.max;
        entries.push({ key: `b:${a.id}`, title: a.name || '', sub: defeated ? `×${defeated}` : '', state: a.kind, model: a.id,
          detail: { kicker: titleCase(a.kind), title: a.name || '', text: lore?.text || '', portrait: a.id, stats: [['Defeated', fmtInt(defeated)], ...(hp ? [['Health', fmtInt(hp)]] : []), ...(a.components?.melee?.damage || a.components?.touch?.damage ? [['Damage', fmtInt(a.components.melee?.damage ?? a.components.touch.damage)]] : [])] } });
      }
      sections.push({ id: 'creatures', title: 'Creatures', entries: entries.sort((x, y) => (x.state === 'boss') - (y.state === 'boss') || x.title.localeCompare(y.title)) });
    } else if (id === 'characters') {
      const entries = (doc.plot?.characters || []).filter(c => c.id !== doc.player?.archetype && c.archetype !== doc.player?.archetype && S.met(rt, c.id)).map(c => {
        const aff = rt.state.vars[`affinity.${c.id}`];
        return { key: `c:${c.id}`, title: c.name || '', sub: '', model: c.id,
          detail: { kicker: c.role ? titleCase(String(c.role).split(/[;,]/)[0]) : 'Character', title: c.name || '', text: c.bio || '', portrait: c.id, stats: [...(c.home ? [['Home', zoneName(doc, c.home)]] : []), ...(c.faction ? [['Faction', titleCase(c.faction)]] : []), ...(isNum(aff) ? [['Affinity', fmtInt(aff)]] : [])] } };
      });
      sections.push({ id: 'met', title: 'Met', entries });
    }
    const all = sections.flatMap(s => s.entries);
    tabs.push({ id, label: LABEL[id], badge: id === 'quests' ? all.filter(e => e.state === 'active').length || null : null, count: all.length, sections: sections.filter(s => s.entries.length) });
  }
  return { tabs };
}

export default {
  id: 'graphics.ui.journal',
  card: {
    intent: 'Journal sheet: quest log grouped by tracked, active, available, completed and failed with objective progress and rewards; lore codex; bestiary of creatures met or defeated; characters met; notes. Keyboard, gamepad and pointer navigable.',
    views: ['any'],
    // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
    interactions: ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'],
    controls: { verbs: ['track_quest'] },
    params: {
      tabs: { type: 'list', default: ['quests', 'lore', 'characters'], min: 1, of: { type: 'string', options: TABS }, effect: 'which pages the journal has, in order' },
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES], effect: 'visual theme' },
      pause: { type: 'boolean', default: true, effect: 'hold the simulation while the journal is open' },
      key: { type: 'string', default: 'journal', options: ['journal', 'map', 'inventory', 'none'], effect: 'which UI hotkey opens it' },
    },
    reads: ['plot.quests', 'plot.entries', 'plot.characters', 'content.models'],
  },
  validate(config) {
    const seen = new Set(), errors = [];
    config.tabs?.forEach((t, i) => { if (seen.has(t)) errors.push({ code: 'ui_tab_duplicate', path: `with.tabs[${i}]`, message: `tab '${t}' is listed twice` }); seen.add(t); });
    return errors;
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el;
    let model = null, lastSig = '';
    const sheet = createSheet(host, {
      id: 'journal', title: 'Journal', theme: resolveTheme(rt.doc, config.style), hotkey: config.key === 'none' ? null : config.key, pause: config.pause,
      tabs: () => (model = journalModel(rt, config)).tabs.map(t => ({ id: t.id, label: t.label, badge: t.badge })),
      hints: tab => tab === 'quests' && S.canAct(rt, 'track_quest') ? [['confirm', 'Track']] : [['confirm', 'Read']],
      renderTab(tabId, body, sh) {
        const tab = model.tabs.find(t => t.id === tabId);
        const list = el('div.gv-list', { role: 'listbox' }), detail = el('article.gv-detail');
        fill(body, el('div.gv-sheet-body', {}, list, detail));
        const buttons = [], entries = [];
        if (!tab || !tab.sections.length) { list.append(el('p.gv-empty', { text: tabId === 'quests' ? 'No quests yet.' : 'Nothing recorded yet.' })); detail.append(el('p.gv-empty', { text: 'Explore, talk and fight to fill these pages.' })); return; }
        for (const s of tab.sections) {
          list.append(el('div.gv-list-section', {}, el('span', { text: s.title }), el('span', { text: s.entries.length })));
          for (const e of s.entries) {
            const b = el(`button.gv-btn${e.state === 'complete' ? '.is-done' : ''}${e.state === 'failed' ? '.is-locked' : ''}`, { attrs: { type: 'button', role: 'option' }, data: { key: e.key } },
              e.model ? el('span.gv-icon', { style: { '--who': portraitColor(rt.doc, e.model) } }, portrait(rt.doc, e.model, { mode: 'bust' })) : e.main ? icon('star') : e.state ? icon(e.state === 'complete' ? 'check' : e.state === 'failed' ? 'skull' : 'quest') : icon('book'),
              el('span.gv-row-title', { text: e.title }), e.sub ? el('small', { text: e.sub }) : null);
            list.append(b); buttons.push(b); entries.push(e);
          }
        }
        sh.setItems(buttons, {
          onFocus: i => paintDetail(detail, entries[i]),
          onConfirm: i => { const e = entries[i]; if (e.detail.trackable && S.canAct(rt, 'track_quest')) { rt.view.act({ track_quest: e.id }); host.sound('confirm'); } },
        });
      },
      refresh(tabId) {
        const sig = JSON.stringify(journalModel(rt, config).tabs.find(t => t.id === tabId));
        if (sig !== lastSig) { if (lastSig) sheet.rerender(); lastSig = sig; }
      },
      onOpen() { lastSig = ''; },
    });
    function paintDetail(detail, e) {
      const d = e.detail;
      fill(detail,
        d.portrait ? el('div.gv-art', { style: { '--who': portraitColor(rt.doc, d.portrait) } }, portrait(rt.doc, d.portrait, { mode: 'full' })) : null,
        el('div.gv-kicker', { text: d.kicker }),
        el('h3', { text: d.title }),
        d.meta?.length ? el('div.gv-dim', {}, ...d.meta.map(m => el('span.gv-tag', { text: m }))) : null,
        d.tracked ? el('span.gv-tag.is-main', { text: 'Tracking' }) : null,
        d.text ? el('p', { text: d.text }) : null,
        d.objectives?.length ? el('ul.gv-objectives', {}, ...d.objectives.map(o => el(`li.is-${o.state}`, {}, el('span.gv-check'), el('div', {}, el('span', { text: o.text }), o.optional ? el('span.gv-faint', { text: ' (optional)' }) : null, o.label ? el('span.gv-dim', { text: ` ${o.label}` }) : null,
          o.progress !== null && o.state !== 'done' ? el('div.gv-progress', {}, el('i', { style: { width: `${Math.round(o.progress * 100)}%` } })) : null)))) : null,
        d.rewards?.length ? el('div', {}, el('div.gv-kicker', { text: 'Rewards' }), el('p', { text: d.rewards.join(' · ') })) : null,
        d.stats?.length ? el('dl.gv-stats', {}, ...d.stats.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])) : null,
      );
    }
    host.on('open', ({ panel, tab }) => { if (panel === 'journal') sheet.open(tab); });
  },
};
