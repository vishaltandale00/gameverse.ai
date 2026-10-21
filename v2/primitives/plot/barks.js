// Ambient lines, radio and narrator channels (plot.barks:
// { channel, when?, say, character?, cooldown?, once?, weight? }). Every
// `interval` seconds each channel that is not resting picks one eligible bark
// (when holds, off cooldown, not a spent once) by weight with rt.random() and
// emits `bark {channel, text, character}`. The `bark` effect speaks a line now.
import { err, checkKeys, checkPred, checkRef, ticks, weightedPick } from './story-lib.js';

const ID = 'plot.barks';
const st = rt => { const s = rt.store(ID); s.next ??= {}; s.spent ??= {}; s.chan ??= {}; s.tick ??= 0; return s; };

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: [], progress: ['bark'] },
    intent: 'Ambient barks, radio and narrator lines from plot.barks on named channels, chosen by predicate, cooldown, once-only and weight; the bark effect speaks a scripted line.',
    views: ['any'],
    params: {
      channels: { type: 'list', of: { type: 'string' }, default: ['ambient', 'character', 'narrator', 'radio', 'tutorial'], effect: 'channel names barks may use' },
      interval: { type: 'number', default: 1, min: 0.1, max: 60, unit: 's', effect: 'how often channels look for a bark' },
      channelGap: { type: 'number', default: 6, min: 0, max: 600, unit: 's', effect: 'quiet time on a channel after any bark' },
      defaultCooldown: { type: 'number', default: 60, min: 0, max: 36000, unit: 's', effect: 'cooldown for barks that set none' },
    },
    provides: { events: ['bark', 'bark:*'] },
    reads: ['plot.barks'],
  },
  logic(logic) {
    logic.effect('bark', {
      refs: e => (e.character ? [['character', e.character]] : []),
      check: (e, path, errors, ctx) => {
        if (typeof (e.line ?? e.text) !== 'string') errors.push(err('effect_invalid', `${path}.line`, 'bark needs a line'));
        const chans = (ctx.doc.systems || []).find(s => s.use === ID)?.with?.channels;
        if (e.channel !== undefined && chans && !chans.includes(e.channel)) errors.push(err('bark_channel_unknown', `${path}.channel`, `unknown channel '${e.channel}'`, `channels: ${chans.join(', ')}`));
      },
      run: (e, rt) => rt.emitTyped('bark', e.channel ?? 'narrator', { channel: e.channel ?? 'narrator', text: e.line ?? e.text, line: e.line ?? e.text, character: e.character ?? null }),
    });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.barks;
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [err('param_type', 'plot.barks', 'must be a list of barks')];
    list.forEach((b, i) => {
      const path = `plot.barks[${i}]`;
      checkKeys(b, ['id', 'channel', 'when', 'say', 'character', 'cooldown', 'once', 'weight'], path, errors);
      if (!config.channels.includes(b.channel)) errors.push(err('bark_channel_unknown', `${path}.channel`, `unknown channel '${b.channel}'`, `channels: ${config.channels.join(', ')}`));
      if (typeof b.say !== 'string' || !b.say) errors.push(err('bark_invalid', `${path}.say`, 'bark needs a say line'));
      if (b.character !== undefined) checkRef(ctx, 'character', b.character, `${path}.character`, errors);
      for (const k of ['cooldown', 'weight']) if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] >= 0)) errors.push(err('bark_invalid', `${path}.${k}`, `${k} must be a non-negative number`));
      checkPred(b.when, `${path}.when`, errors, ctx);
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    rt.system('plot', rt => {
      const s = st(rt);
      if (s.tick > 0) { s.tick--; return; }
      s.tick = ticks(rt, config.interval) - 1;
      const now = rt.state.frame, list = rt.doc.plot?.barks || [];
      for (const channel of config.channels) {
        if ((s.chan[channel] ?? -1) > now) continue;
        const eligible = list.map((b, i) => ({ b, i, key: b.id ?? String(i), weight: b.weight ?? 1 }))
          .filter(({ b, key }) => b.channel === channel && !(b.once && s.spent[key]) && (s.next[key] ?? -1) <= now && (!b.character || !rt.hasService('character') || rt.service('character').alive(b.character)) && (!b.when || rt.test(b.when, { self: b.character })));
        if (!eligible.length) continue;
        const { b, key } = weightedPick(rt, eligible);
        if (b.once) s.spent[key] = true;
        s.next[key] = now + ticks(rt, b.cooldown ?? config.defaultCooldown);
        s.chan[channel] = now + ticks(rt, config.channelGap);
        rt.emitTyped('bark', channel, { channel, text: b.say, line: b.say, character: b.character ?? null, bark: key });
      }
    }, ID);
  },
};

// Bark timing is presentation: it never distinguishes solver states.
export function solverKey(rt) { const s = rt.store(ID); return Object.keys(s.spent || {}).sort(); }
