// Branching dialogue as data (plot.dialogue): id -> { speaker, start, nodes }.
// Entering a node tests its `if` (false: jump to `else`, or end), runs its `do`
// (once per game when `once`), records it as said, and emits `dialogue_line`
// with the choices currently open. A line with choices waits for
// `choose: {index} | <choice id> | <index >= 1>`; a line without waits for `choose: 'next'`
// (or advances itself with autoAdvance). Choices may be `once`, conditional
// (`if`), run effects (`do`) and carry a skill check
// `check: {stat|var, gte, roll?: 'none'|'d6'|'2d6'|'d20'|'d100', bonus?, fail?, failDo?}`.
// Every open choice is a solver option.
import { err, isObj, readSeconds, ticks, TEXT, LINE, plotExample } from './story-lib.js';

const ID = 'plot.dialogue';
const ROLLS = { none: [0, 0], d6: [1, 6], '2d6': [2, 6], d20: [1, 20], d100: [1, 100] };
const MAX_HOPS = 64; // node-to-node jumps per step (guards authoring loops of non-waiting nodes)

const st = rt => { const s = rt.store(ID); s.said ??= {}; s.chosen ??= {}; s.onceNodes ??= {}; s.queue ??= []; s.active ??= null; return s; };
const dialogues = rt => rt.doc.plot?.dialogue || {};
export const choiceKey = (node, i, c) => c?.id ?? `${node}.${i}`;

function statValue(rt, check) {
  const name = check.var ?? (String(check.stat).includes('.') ? check.stat : `stat.${check.stat}`);
  return rt.state.vars[name] ?? 0;
}

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: ['choose'], progress: ['choice_made', 'dialogue_end'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { choose: { type: 'choice', of: 'a dialogue choice', from: 'options', emits: ['choice_made', 'dialogue_line', 'dialogue_end'] } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "section", "at": "plot.dialogue", "min": 2, "why": "conversations are node graphs keyed by dialogue id; characters point at them with dialogue: [{id}]", "example": {"keeper_intro": {"speaker": "keeper", "start": "n1", "nodes": {"n1": {"who": "keeper", "say": "The lamp went dark at midnight.", "choices": [{"text": "Who was here?", "next": "n2"}, {"text": "Goodbye.", "next": "n3"}]}, "n2": {"who": "keeper", "say": "Only the cook, and she left early.", "end": true}, "n3": {"say": "Mind the stairs.", "end": true}}}}},
    ],
    intent: 'Branching conversations from plot.dialogue: node graphs of lines with conditions, effects, once-only nodes and choices (conditional, once-only, skill-checked). The player picks with `choose`; every open choice is a solver option.',
    views: ['any'],
    params: {
      lineSpeed: { type: 'number', default: 40, min: 0, max: 100, unit: 'chars/s', effect: 'reveal speed; a line is readable after len/lineSpeed seconds (0 = instant)' },
      interruptible: { type: 'boolean', default: true, effect: 'choose may skip a line before it is fully revealed' },
      repeatSeen: { type: 'boolean', default: false, effect: 'when false, replaying a dialogue skips linear lines already seen and jumps to the next choice or unseen line' },
      autoAdvance: { type: 'boolean', default: false, effect: 'lines without choices advance by themselves once read (cinematic/headless)' },
      queue: { type: 'boolean', default: true, effect: 'start_dialogue while another dialogue is open waits for it to end (false: replaces it)' },
    },
    provides: { events: ['dialogue_error', 'dialogue_start', 'dialogue_end', 'dialogue_line', 'choice_made', 'skill_check', 'said', 'said:*'], services: ['dialogue'], actions: ['choose'] },
    reads: ['plot.dialogue'],
    // Section shapes this primitive reads (planner: composition renames the references they hold, repair and forms use them).
    // Node ids are keys of their dialogue's nodes (start, next, else, a choice's next and a check's fail name one of them).
    data: { 'plot.dialogue': { type: 'object', values: { type: 'object', fields: {
      speaker: { type: 'string', selects: ['character'], effect: "a character id, or 'player'" }, title: TEXT({ effect: 'the conversation\'s title a person reads' }), start: { type: 'string', required: true, effect: 'a node id' },
      nodes: { type: 'object', required: true, values: { type: 'object', fields: {
        who: { type: 'string', selects: ['character'], effect: "a character id, or 'player'" }, say: TEXT({ required: true, effect: 'the line a person reads' }), if: { type: 'predicate' }, else: { type: 'string', effect: 'a node id' },
        do: { type: 'effects' }, next: { type: 'string', effect: 'a node id' }, end: { type: 'boolean' }, once: { type: 'boolean' }, sec: { type: 'number', min: 0, unit: 's' },
        choices: { type: 'list', of: { type: 'object', fields: {
          id: { type: 'string' }, text: LINE({ required: true, effect: 'what the player says, as they read it' }), if: { type: 'predicate' }, do: { type: 'effects' }, next: { type: 'string', effect: 'a node id' }, once: { type: 'boolean' }, end: { type: 'boolean' },
          check: { type: 'object', fields: { stat: { type: 'string' }, var: { type: 'string' }, gte: { type: 'number', required: true }, roll: { type: 'string', options: Object.keys(ROLLS) }, bonus: { type: 'number' }, fail: { type: 'string', effect: 'a node id' }, failDo: { type: 'effects' } } },
        } } },
      } } },
    } } } },
    rules: {
      dialogue_invalid: { fields: ['plot.dialogue.*.nodes', 'plot.dialogue.*.nodes.*.next', 'plot.dialogue.*.nodes.*.choices'], message: 'a dialogue has at least one node; a node has either next or choices, not both',
        example: plotExample({ dialogue: { d: { start: 'a', nodes: { a: { say: 'Hello.', next: 'b', choices: [{ text: 'Hi.' }] }, b: { say: 'Bye.' } } } } }, 'plot.dialogue.d.nodes.a') },
      dialogue_node_unknown: { fields: ['plot.dialogue.*.start', 'plot.dialogue.*.nodes.*.next', 'plot.dialogue.*.nodes.*.else', 'plot.dialogue.*.nodes.*.choices[].next', 'plot.dialogue.*.nodes.*.choices[].check.fail'], message: 'start, next, else, a choice\'s next and a check\'s fail name a node of the same dialogue',
        example: plotExample({ dialogue: { d: { start: 'a', nodes: { a: { say: 'Hello.', next: 'nowhere' } } } } }, 'plot.dialogue.d.nodes.a.next') },
      check_invalid: { fields: ['plot.dialogue.*.nodes.*.choices[].check.stat', 'plot.dialogue.*.nodes.*.choices[].check.var'], message: 'a skill check names a stat or a var',
        example: plotExample({ dialogue: { d: { start: 'a', nodes: { a: { say: 'Lift it?', choices: [{ text: 'Try.', check: { gte: 3 } }] } } } } }, 'plot.dialogue.d.nodes.a.choices[0].check') },
      speaker_unknown: { fields: ['plot.dialogue.*.speaker', 'plot.dialogue.*.nodes.*.who'], message: "a speaker is a plot.characters id, or 'player'",
        example: plotExample({ dialogue: { d: { speaker: 'nobody', start: 'a', nodes: { a: { say: 'Hello.' } } } } }, 'plot.dialogue.d.speaker') },
    },
  },
  logic(logic) {
    logic.predicate('said', { refs: p => [['dialogue', p.said]], test: (p, rt) => { const s = st(rt).said[p.said]; return Boolean(s && (p.node === undefined ? Object.keys(s).length : s[p.node])); } });
    logic.predicate('chose', { refs: p => [['dialogue', p.chose]], test: (p, rt) => Object.values(st(rt).chosen[p.chose] || {}).some(r => (p.node === undefined || r.node === p.node) && (p.choice === undefined || r.key === p.choice || r.next === p.choice || `${r.node}.${r.index}` === p.choice)) });
    logic.predicate('in_dialogue', { refs: p => (typeof p.in_dialogue === 'string' ? [['dialogue', p.in_dialogue]] : []), test: (p, rt) => { const a = st(rt).active; return typeof p.in_dialogue === 'string' ? a?.dialogue === p.in_dialogue : Boolean(a) === (p.in_dialogue !== false); } });
    logic.effect('start_dialogue', { refs: e => [['dialogue', e.dialogue], ...(e.with && e.with !== 'player' ? [['character', e.with]] : [])], run: (e, rt) => rt.service('dialogue').start(e.dialogue, { with: e.with }) });
    logic.effect('end_dialogue', { run: (e, rt) => rt.service('dialogue').end() });
  },
  // The shape of plot.dialogue is declared (card.data); what is left are the rules across fields: node names, speakers.
  validate(config, doc, ctx) {
    const errors = [], all = doc.plot?.dialogue;
    if (!isObj(all)) return errors;
    const speaker = (who, path) => { if (typeof who === 'string' && who !== 'player' && ctx.indexes.character && !ctx.indexes.character.has(who)) errors.push(err('speaker_unknown', path, `unknown speaker '${who}'`, `characters: ${[...ctx.indexes.character].slice(0, 20).join(', ') || 'none'}, or 'player'`)); };
    for (const [id, d] of Object.entries(all)) {
      if (!isObj(d)) continue;
      const path = `plot.dialogue.${id}`, nodes = isObj(d.nodes) ? d.nodes : null;
      speaker(d.speaker, `${path}.speaker`);
      if (!nodes) continue;
      if (!Object.keys(nodes).length) { errors.push(err('dialogue_invalid', `${path}.nodes`, 'dialogue needs at least one node')); continue; }
      const target = (to, at) => { if (typeof to === 'string' && !Object.hasOwn(nodes, to)) errors.push(err('dialogue_node_unknown', at, `unknown node '${to}'`, `nodes: ${Object.keys(nodes).join(', ')}`)); };
      target(d.start, `${path}.start`);
      for (const [nid, n] of Object.entries(nodes)) {
        if (!isObj(n)) continue;
        const np = `${path}.nodes.${nid}`, choices = Array.isArray(n.choices) ? n.choices : [];
        speaker(n.who, `${np}.who`);
        target(n.next, `${np}.next`); target(n.else, `${np}.else`);
        if (n.next !== undefined && choices.length) errors.push(err('dialogue_invalid', np, 'a node has either next or choices, not both'));
        choices.forEach((c, i) => {
          if (!isObj(c)) return;
          const cp = `${np}.choices[${i}]`;
          target(c.next, `${cp}.next`);
          if (!isObj(c.check)) return;
          if (typeof c.check.stat !== 'string' && typeof c.check.var !== 'string') errors.push(err('check_invalid', `${cp}.check`, 'skill check needs stat or var'));
          if (typeof c.check.var === 'string') ctx.noteRef('var', c.check.var, `${cp}.check.var`, 'read');
          target(c.check.fail, `${cp}.check.fail`);
        });
      }
    }
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    const node = (a = st(rt).active) => a && dialogues(rt)[a.dialogue]?.nodes?.[a.node];
    const openChoices = (a = st(rt).active) => {
      const n = node(a); if (!n?.choices) return [];
      const chosen = st(rt).chosen[a.dialogue] || {};
      return n.choices.map((c, index) => ({ c, index, key: choiceKey(a.node, index, c) }))
        .filter(({ c, key }) => !(c.once && chosen[key]) && (!c.if || rt.test(c.if, { self: a.with })));
    };
    const finish = () => {
      const s = st(rt), a = s.active; if (!a) return;
      s.active = null;
      rt.emit('dialogue_end', { dialogue: a.dialogue, with: a.with ?? null });
      if (s.queue.length && rt.state.status === 'playing') { const next = s.queue.shift(); begin(next.dialogue, next.with); }
    };
    // Enter node `id`, following non-waiting jumps (failed `if`, repeat-skips) up to MAX_HOPS.
    const enter = id => {
      const s = st(rt);
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        const a = s.active; if (!a) return;
        const n = dialogues(rt)[a.dialogue]?.nodes?.[id];
        if (!n) { finish(); return; }
        if (n.if && !rt.test(n.if, { self: a.with })) { if (n.else !== undefined) { id = n.else; continue; } finish(); return; }
        const seen = s.said[a.dialogue]?.[id];
        a.node = id; a.wait = 0;
        if (seen && !config.repeatSeen && !n.choices?.length && n.next !== undefined && !n.end) { id = n.next; continue; } // already-heard linear line
        (s.said[a.dialogue] ??= {})[id] = true;
        const onceKey = `${a.dialogue}.${id}`;
        if (n.do?.length && !(n.once && s.onceNodes[onceKey])) { if (n.once) s.onceNodes[onceKey] = true; rt.run(n.do, { self: a.with, dialogue: a.dialogue }); }
        if (rt.state.status !== 'playing' || s.active !== a) return; // the node ended the game or the dialogue
        a.wait = ticks(rt, n.sec ?? readSeconds(n.say, config.lineSpeed));
        rt.emitTyped('said', `${a.dialogue}.${id}`, { dialogue: a.dialogue, node: id });
        rt.emit('dialogue_line', { dialogue: a.dialogue, node: id, who: n.who ?? dialogues(rt)[a.dialogue].speaker ?? a.with ?? null, text: n.say, choices: openChoices(a).map(({ c, index, key }) => ({ index, id: key, text: c.text, enabled: true, check: c.check ? { stat: c.check.stat ?? c.check.var, gte: c.check.gte } : undefined })) });
        // A choice node whose every choice is closed would trap the player: end instead.
        if (n.choices?.length && !openChoices(a).length) { finish(); }
        return;
      }
      rt.emit('dialogue_error', { dialogue: s.active?.dialogue, node: id, reason: 'too many jumps' }); finish();
    };
    const begin = (id, withWho) => {
      const d = dialogues(rt)[id]; if (!d) return false;
      st(rt).active = { dialogue: id, with: withWho ?? (d.speaker !== 'player' ? d.speaker : null) ?? null, node: null, wait: 0 };
      rt.emit('dialogue_start', { dialogue: id, with: st(rt).active.with });
      enter(d.start);
      return true;
    };
    const advance = () => { // 'next' on a line without choices
      const a = st(rt).active, n = node(a); if (!a || !n || n.choices?.length) return false;
      if (a.wait > 0 && !config.interruptible) return false;
      if (n.end || n.next === undefined) finish(); else enter(n.next);
      return true;
    };
    const choose = value => {
      const s = st(rt), a = s.active, n = node(a); if (!a || !n?.choices?.length) return false;
      if (a.wait > 0 && !config.interruptible) return false;
      const open = openChoices(a);
      const pick = typeof value === 'number' ? open.find(o => o.index === value) : open.find(o => o.key === value);
      if (!pick) return false;
      const { c, index, key } = pick;
      (s.chosen[a.dialogue] ??= {})[key] = { node: a.node, index, key, next: c.next ?? null }; // a set: replays never grow state
      rt.emit('choice_made', { dialogue: a.dialogue, node: a.node, choice: key, index, next: c.next ?? null });
      let next = c.next, fx = c.do;
      if (c.check) {
        const [dice, sides] = ROLLS[c.check.roll || 'none'];
        let roll = 0; for (let i = 0; i < dice; i++) roll += 1 + Math.floor(rt.random() * sides);
        const total = statValue(rt, c.check) + roll + (c.check.bonus ?? 0), success = total >= c.check.gte;
        rt.emit('skill_check', { dialogue: a.dialogue, node: a.node, choice: key, stat: c.check.stat ?? c.check.var, roll, total, gte: c.check.gte, success });
        if (!success) { next = c.check.fail; fx = c.check.failDo; }
      }
      if (fx?.length) rt.run(fx, { self: a.with, dialogue: a.dialogue });
      if (rt.state.status !== 'playing' || s.active !== a) return true;
      if (c.end || next === undefined) finish(); else enter(next);
      return true;
    };
    const api = {
      start(id, { with: withWho } = {}) {
        const s = st(rt);
        if (s.active) { if (config.queue) { s.queue.push({ dialogue: id, with: withWho ?? null }); return 'queued'; } finish(); }
        return begin(id, withWho);
      },
      end: finish,
      active: () => Boolean(st(rt).active),
      choose, advance,
      /** UI read model: rebuildable after restore. */
      view() {
        const a = st(rt).active, n = node(a);
        if (!a || !n) return { active: false };
        return { active: true, dialogue: a.dialogue, node: a.node, with: a.with, who: n.who ?? dialogues(rt)[a.dialogue].speaker ?? null, text: n.say, ready: a.wait <= 0,
          choices: openChoices(a).map(({ c, index, key }) => ({ index, id: key, text: c.text, enabled: true })) };
      },
    };
    rt.provide('dialogue', api);
    // rt.step drops falsy action values, so index 0 arrives as {index: 0}; ids and numbers >= 1 also work.
    rt.action('choose', value => {
      if (value === 'next' || value === true || value?.next) { advance(); return; }
      if (value && typeof value === 'object') choose(value.index ?? value.id); else choose(value);
    });
    rt.system('plot', rt => {
      const a = st(rt).active; if (!a) return;
      if (a.wait > 0) a.wait--;
      if (a.wait <= 0 && config.autoAdvance && !node(a)?.choices?.length) advance();
    }, ID);
    rt.options(rt => {
      const a = st(rt).active, n = node(a); if (!a || !n) return [];
      const steps = !config.interruptible && a.wait > 0 ? a.wait + 1 : 1;
      if (!n.choices?.length) return config.autoAdvance ? [{ label: `listen ${a.dialogue}`, text: 'Listen', actions: {}, steps: Math.max(1, a.wait + 1) }] : [{ label: `continue ${a.dialogue}.${a.node}`, text: 'Continue', actions: { choose: 'next' }, steps }];
      return openChoices(a).map(({ c, key }) => ({ label: `choose ${a.dialogue}.${key}: ${c.text}`, text: c.text, actions: { choose: key }, steps }));
    });
  },
};

/** Solver key: what the player has said, chosen and where any open conversation stands (no line timers). */
export function solverKey(rt) {
  const s = rt.store(ID);
  return { active: s.active ? [s.active.dialogue, s.active.node] : null, said: Object.fromEntries(Object.entries(s.said || {}).map(([d, n]) => [d, Object.keys(n).sort()])), chosen: Object.fromEntries(Object.entries(s.chosen || {}).map(([d, m]) => [d, Object.keys(m).sort()])), queue: (s.queue || []).map(q => q.dialogue) };
}
