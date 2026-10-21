// graphics.ui.dialogue: conversation box with portraits painted from the
// speaker's model, a typewriter with punctuation pacing, choices with focus
// (keyboard, gamepad, pointer, number keys), and a subtitle mode for barks and
// storyboard `say` lines. Lines come from plot.dialogue's service view() (so a
// restore rebuilds the box) or its dialogue_line / dialogue_end events.
// Player input goes out as view.act({ choose: { index } }) or view.act({ choose: 'next' }).
import { THEMES, resolveTheme } from './ui-theme.js';
import { uiHost, setText, setStyle, setClass, setHidden, fill, clamp, charName, docSystem } from './ui-lib.js';
import { portrait, portraitColor } from './ui-portrait.js';
import { glyph } from './ui-input.js';
import { dialogueView, canAct } from './ui-sources.js';

const PAUSE = { '.': 0.28, '!': 0.28, '?': 0.28, '…': 0.36, ',': 0.1, ';': 0.12, ':': 0.12, '—': 0.14 };

/**
 * Pure dialogue box state machine. Phases: hidden → typing → (waiting | choosing) → closing → hidden.
 * Returns command objects for the host to act on: { kind: 'advance' } | { kind: 'choose', index } | { kind: 'skip' }.
 */
export function createDialogueMachine({ cps = 40, speed = 1 } = {}) {
  const m = { phase: 'hidden', line: null, shown: 0, hold: 0, focus: -1, closeT: 0, speed };
  const len = () => (m.line?.text || '').length;
  const enabled = i => m.line?.choices?.[i] && m.line.choices[i].enabled !== false;
  const firstEnabled = () => (m.line?.choices || []).findIndex((_, i) => enabled(i));
  const settle = () => { m.shown = len(); m.phase = m.line?.choices?.length ? 'choosing' : 'waiting'; if (m.phase === 'choosing' && !enabled(m.focus)) m.focus = firstEnabled(); };
  return Object.assign(m, {
    /** Show a line { key, who, text, choices:[{index,text,enabled}] }. The same key again is ignored. */
    show(line) {
      if (m.line?.key === line.key && m.phase !== 'hidden' && m.phase !== 'closing') { m.line = { ...line }; if (m.phase === 'choosing' && !enabled(m.focus)) m.focus = firstEnabled(); return false; }
      m.line = { ...line, choices: line.choices || [] }; m.shown = 0; m.hold = 0; m.focus = firstEnabled();
      m.phase = 'typing'; if (cps <= 0) settle(); return true;
    },
    /** Advance time; returns how many characters were revealed (for typing sounds). */
    tick(dt) {
      if (m.phase === 'closing') { m.closeT -= dt; if (m.closeT <= 0) { m.phase = 'hidden'; m.line = null; } return 0; }
      if (m.phase !== 'typing') return 0;
      let budget = dt, before = Math.floor(m.shown);
      while (budget > 0 && m.phase === 'typing') {
        if (m.hold > 0) { const d = Math.min(m.hold, budget); m.hold -= d; budget -= d; continue; }
        const next = Math.floor(m.shown) + 1, step = Math.min(budget, (next - m.shown) / (cps * m.speed));
        m.shown += step * cps * m.speed; budget -= step;
        if (m.shown >= next - 1e-9) { m.shown = next; const ch = m.line.text[next - 1]; if (PAUSE[ch] && next < len()) m.hold = PAUSE[ch] / m.speed; }
        if (m.shown >= len()) settle();
      }
      return Math.floor(m.shown) - before;
    },
    confirm() {
      if (m.phase === 'typing') { settle(); return { kind: 'skip' }; }
      if (m.phase === 'waiting') return { kind: 'advance' };
      if (m.phase === 'choosing' && enabled(m.focus)) return { kind: 'choose', index: m.line.choices[m.focus].index ?? m.focus };
      return null;
    },
    move(dir) {
      if (m.phase !== 'choosing') return false;
      const n = m.line.choices.length, d = dir === 'up' || dir === 'left' ? -1 : 1;
      for (let k = 1; k <= n; k++) { const i = (((m.focus + d * k) % n) + n) % n; if (enabled(i)) { const moved = i !== m.focus; m.focus = i; return moved; } }
      return false;
    },
    /** Digit shortcut: choose the n-th visible choice (1-based) if enabled. */
    pick(n) { if (m.phase === 'typing') settle(); if (m.phase !== 'choosing' || !enabled(n - 1)) return null; m.focus = n - 1; return m.confirm(); },
    end(anim = 0.25) { if (m.phase === 'hidden') return; m.phase = 'closing'; m.closeT = anim; },
  }) && Object.defineProperties(m, {
    visible: { get: () => (m.line?.text || '').slice(0, Math.floor(m.shown)) },
    open: { get: () => m.phase === 'typing' || m.phase === 'waiting' || m.phase === 'choosing' },
  });
}

/** Normalise a dialogue_line event or service view into a machine line. */
export function lineFrom(v) {
  if (!v) return null;
  const choices = (v.choices || []).map((c, i) => (typeof c === 'string' ? { index: i, text: c } : { index: c.index ?? i, text: c.text ?? c.label ?? '', enabled: c.enabled !== false, seen: Boolean(c.seen) }));
  return { key: `${v.dialogue ?? ''}:${v.node ?? ''}:${v.text ?? ''}`, dialogue: v.dialogue, node: v.node, who: v.who ?? v.speaker ?? v.character ?? null, text: String(v.text ?? v.say ?? ''), choices };
}
/** How long a subtitle stays: reading time with bounds. */
export const subtitleSeconds = text => clamp(1.4 + String(text || '').split(/\s+/).filter(Boolean).length * 0.3, 2.2, 7);

export default {
  id: 'graphics.ui.dialogue',
  card: {
    intent: 'Dialogue box for any conversation: portraits of the speaker from its model, typewriter text with pacing, choices navigable by keyboard, gamepad, pointer and number keys, and subtitles for barks and narration.',
    views: ['any'],
    // The interactions it gives a person controls for, and the verbs it sends through view.act (ARCHITECTURE §6.3).
    interactions: ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'],
    controls: { verbs: ['choose', 'skip_cutscene'] },
    params: {
      style: { type: 'string', default: 'auto', options: ['auto', ...THEMES], effect: 'visual theme' },
      portrait: { type: 'boolean', default: true, effect: 'show speaker portraits painted from their models' },
      cps: { type: 'number', default: 0, min: 0, max: 400, unit: 'chars/s', effect: 'typewriter speed; 0 uses plot.dialogue lineSpeed (else 40)' },
      instant: { type: 'boolean', default: false, effect: 'show whole lines at once' },
      subtitles: { type: 'boolean', default: true, effect: 'show barks and say lines as subtitles' },
      position: { type: 'string', default: 'bottom', options: ['bottom', 'top'], effect: 'where the box sits' },
      maxSubtitles: { type: 'integer', default: 3, min: 1, max: 6, effect: 'subtitle lines visible at once' },
    },
    reads: ['plot.characters', 'plot.dialogue', 'content.models'],
  },
  install(rt, config) {
    const host = uiHost(rt); if (!host) return;
    const el = host.el;
    const cps = config.instant ? 0 : (config.cps || docSystem(rt.doc, 'plot.dialogue')?.with?.lineSpeed || 40);
    const machine = createDialogueMachine({ cps, speed: host.settings.textSpeed || 1 });
    host.on('settings', s => { machine.speed = s.textSpeed || 1; });
    const theme = resolveTheme(rt.doc, config.style);
    const left = el('div.gv-dlg-portrait.is-empty'), right = el('div.gv-dlg-portrait.is-empty');
    const name = el('div.gv-dlg-name');
    const text = el('div.gv-dlg-text', { aria: { live: 'polite' } }, el('span'), el('span.gv-ghost'));
    const next = el('div.gv-dlg-next', { text: '▼' });
    const choices = el('ol.gv-choices', { role: 'listbox', aria: { label: 'Choices' } });
    const box = el('div.gv-dlg-box.gv-panel', { on: { click: () => press('confirm') } }, name, text, choices, next);
    const root = el('div.gv-dialogue.gv-hide', { attrs: { 'data-theme': theme }, role: 'dialog', aria: { label: 'Conversation' }, style: config.position === 'top' ? { top: 'clamp(14px,4vh,40px)', bottom: 'auto' } : {} }, left, box, right);
    const subs = el('div.gv-subtitles', { attrs: { 'data-theme': theme }, aria: { live: 'polite' } });
    host.layer('dialogue').append(root);
    host.layer('subtitles').append(subs);

    const layer = { id: 'dialogue', modal: true, onVerb: (v, info) => press(v, info) };
    let viaService = false, lastT = host.now(), typedSince = 0;

    function press(verb) {
      if (!machine.open) return false;
      if (verb === 'confirm') return run(machine.confirm());
      if (['up', 'down', 'left', 'right'].includes(verb)) { if (machine.move(verb)) host.sound('move'); return true; }
      const d = /^digit(\d)$/.exec(verb); if (d) return run(machine.pick(Number(d[1])));
      return verb === 'back' ? true : false;
    }
    function run(cmd) {
      if (!cmd) return true;
      const verb = machine.line?.verb || 'choose';
      if (cmd.kind === 'advance') {
        host.sound('confirm');
        if (verb === 'choose' && canAct(rt, 'choose')) rt.view.act({ choose: 'next' }); else machine.end();
      } else if (cmd.kind === 'choose' && verb === 'options') {
        host.sound('confirm'); const o = machine.line.options?.[cmd.index]; if (o) rt.view.act(o.actions); machine.end();
      } else if (cmd.kind === 'choose') {
        host.sound('confirm');
        rt.view.act({ [verb]: { index: cmd.index } }); // objects: rt.step drops falsy values such as 0
        if (verb !== 'choose') machine.end();
      }
      return true;
    }
    const show = v => { const line = lineFrom(v); if (!line) return; if (machine.show(line)) paintLine(line); else paintChoices(); };
    const end = () => { machine.end(); };

    rt.on('dialogue_line', e => { if (!viaService) show(e); });
    // Random events (plot.events.random) use the same box; their choices go to event_choice.
    rt.on('random_event', e => { const line = lineFrom({ ...e, dialogue: `event:${e.event}`, node: rt.state.frame }); line.verb = 'event_choice'; line.title = e.title; if (machine.show(line)) paintLine(line); });
    // Cutscenes: letterbox bars, gameplay input held, back/menu skips when allowed.
    const bars = el('div.gv-letterbox', {}, el('i'), el('i'), el('span.gv-skip'));
    host.layer('screen').append(bars);
    const cine = { id: 'cutscene', modal: true, onVerb: v => { if ((v === 'back' || v === 'menu') && canAct(rt, 'skip_cutscene')) rt.view.act({ skip_cutscene: true }); return true; } };
    rt.on('cutscene_start', e => { if (e.letterbox !== false) bars.classList.add('is-on'); setText(bars.lastChild, canAct(rt, 'skip_cutscene') ? `${glyph(host, 'back')} Skip` : ''); host.input.push(cine); });
    rt.on('cutscene_end', () => { bars.classList.remove('is-on'); host.input.pop(cine); });
    rt.on('dialogue_end', () => { if (!viaService) end(); });

    // Subtitles: barks, storyboard say lines (when no dialogue box line is open).
    const subLive = [];
    function subtitle({ who, text: t, channel }) {
      if (!config.subtitles || !host.settings.subtitles || !t) return;
      const color = who ? portraitColor(rt.doc, who) : null;
      const node = el('div.gv-sub', { data: { channel: channel || 'say' }, style: color ? { '--who': color } : {} }, who ? el('b', { text: charName(rt.doc, who) }) : null, el('span', { text: t }));
      subs.append(node); subLive.push(node);
      while (subLive.length > config.maxSubtitles) retire(subLive[0]);
      host.later(() => retire(node), subtitleSeconds(t) * 1000);
    }
    const retire = node => { const i = subLive.indexOf(node); if (i < 0) return; subLive.splice(i, 1); node.classList.add('is-out'); host.later(() => node.remove(), 380); };
    rt.on('bark', e => subtitle({ who: e.character, text: e.text ?? e.line, channel: e.channel }));
    rt.on('say', e => { if (!machine.open) subtitle({ who: e.character, text: e.text }); });

    function paintLine(line) {
      const who = line.who, isPlayer = who === 'player' || who === rt.doc.player?.archetype;
      const color = who ? portraitColor(rt.doc, who) : null;
      setStyle(root, '--who', color);
      setText(name, who ? charName(rt.doc, who) : (line.title || '')); setHidden(name, !who && !line.title);
      for (const [slot, mine] of [[left, !isPlayer], [right, isPlayer]]) {
        const show = config.portrait && who && mine;
        if (show && slot.getAttribute('data-who') !== who) { fill(slot, portrait(rt.doc, who, { mode: 'bust', flip: slot === right })); slot.setAttribute('data-who', who); }
        setClass(slot, 'is-empty', !config.portrait || !slot.getAttribute('data-who'));
        setClass(slot, 'is-idle', !show && Boolean(slot.getAttribute('data-who')));
      }
      fill(choices);
      root.classList.remove('gv-hide', 'is-out'); root.classList.add('is-in');
      if (!host.input.isOpen(layer)) { host.input.push(layer); host.sound('open'); }
    }
    function paintChoices() {
      const line = machine.line; if (!line) return;
      if (machine.phase !== 'choosing') { if (choices.children.length) fill(choices); return; }
      if (choices.children.length !== line.choices.length) fill(choices, ...line.choices.map((c, i) => el('li.gv-choice', { role: 'option', style: { 'animation-delay': `${i * 45}ms` } },
        el(`button.gv-btn${c.enabled === false ? '.is-disabled' : ''}${c.seen ? '.is-seen' : ''}`, { attrs: { type: 'button', disabled: c.enabled === false }, on: { click: ev => { ev.stopPropagation?.(); machine.focus = i; run(machine.confirm()); }, pointerenter: () => { if (c.enabled !== false && machine.focus !== i) { machine.focus = i; host.sound('move'); } } } }, el('span.gv-num', { text: i + 1 }), el('span', { text: c.text })))));
      [...choices.children].forEach((li, i) => { const b = li.firstChild; setClass(b, 'is-focus', i === machine.focus); li.setAttribute('aria-selected', String(i === machine.focus)); });
    }

    // Fallback for any simulation modal (rt.openModal) that no UI panel presents: offer its options here.
    let orphan = 0;
    function modalPrompt() {
      const m = rt.modal;
      const presented = machine.open || (host.input.modal && host.input.top !== 'dialogue') || dialogueView(rt);
      if (!m || presented) { orphan = 0; return; }
      if (++orphan < 3) return;
      const options = rt.availableOptions().filter(o => o.actions && Object.keys(o.actions).length);
      if (!options.length) return;
      const line = { key: `modal:${m.owner}:${rt.state.frame}`, who: null, title: m.kind ? m.kind.replace(/[._-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Choose', text: '', verb: 'options', options, choices: options.map((o, i) => ({ index: i, text: o.label })) };
      if (machine.show(line)) paintLine(line);
    }
    rt.view.onFrame(() => {
      const now = host.now(), dt = Math.min(0.1, now - lastT); lastT = now;
      modalPrompt();
      const v = dialogueView(rt);
      if (v !== undefined) { viaService = true; if (v) show(v); else if (machine.open) end(); }
      const typed = machine.tick(dt);
      typedSince += typed; if (typedSince >= 2) { host.sound('type', { who: machine.line?.who }); typedSince = 0; }
      if (machine.phase === 'hidden') {
        if (!root.classList.contains('gv-hide')) { root.classList.add('gv-hide'); root.classList.remove('is-in', 'is-out'); left.removeAttribute('data-who'); right.removeAttribute('data-who'); }
        if (host.input.isOpen(layer)) { host.input.pop(layer); host.sound('close'); }
        return;
      }
      if (machine.phase === 'closing') { root.classList.add('is-out'); if (host.input.isOpen(layer)) host.input.pop(layer); return; }
      const line = machine.line, shown = machine.visible;
      setText(text.firstChild, shown); setText(text.lastChild, line.text.slice(shown.length));
      const speaking = machine.phase === 'typing';
      for (const slot of [left, right]) setClass(slot, 'is-talking', speaking && !slot.classList.contains('is-idle') && !slot.classList.contains('is-empty'));
      setClass(next, 'is-on', machine.phase === 'waiting');
      setText(next, machine.phase === 'waiting' ? `${glyph(host, 'confirm')} ▼` : '▼');
      paintChoices();
    });
  },
};
