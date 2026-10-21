// Ambient lines, radio and narrator channels (plot.barks:
// { channel, when?, say, character?, cooldown?, once?, weight? }). Every
// `interval` seconds each channel that is not resting picks one eligible bark
// (when holds, off cooldown, not a spent once) by weight with rt.random() and
// emits `bark {channel, text, character}`. The `bark` effect speaks a line now.
import { err, ticks, weightedPick, isObj, LINE } from './story-lib.js';
import { ID_PATTERN } from '../../kernel/sections.js';

const ID = 'plot.barks';
const CHANNELS = ['ambient', 'character', 'narrator', 'radio', 'tutorial'];
/** The channels of the document's plot.barks instance (its `with`, else the card's default). */
const channelsOf = doc => (doc.systems || []).find(s => s.use === ID)?.with?.channels ?? CHANNELS;
const st = rt => { const s = rt.store(ID); s.next ??= {}; s.spent ??= {}; s.chan ??= {}; s.tick ??= 0; return s; };

export default {
  id: ID,
  solverKey,
  card: {
    loop: { verbs: [], progress: ['bark'] },
    intent: 'Ambient barks, radio and narrator lines from plot.barks on named channels, chosen by predicate, cooldown, once-only and weight; the bark effect speaks a scripted line.',
    views: ['any'],
    params: {
      channels: { type: 'list', of: { type: 'string' }, default: CHANNELS, effect: 'channel names barks may use' },
      interval: { type: 'number', default: 1, min: 0.1, max: 60, unit: 's', effect: 'how often channels look for a bark' },
      channelGap: { type: 'number', default: 6, min: 0, max: 600, unit: 's', effect: 'quiet time on a channel after any bark' },
      defaultCooldown: { type: 'number', default: 60, min: 0, max: 36000, unit: 's', effect: 'cooldown for barks that set none' },
    },
    provides: { events: ['bark', 'bark:*'] },
    reads: ['plot.barks'],
    // Section shapes this primitive reads (the kernel checks entries against them; forms and repair derive from them).
    data: { 'plot.barks': { type: 'list', of: { type: 'object', fields: {
      id: { type: 'string', pattern: ID_PATTERN, effect: 'names the bark for once and cooldown (else its place in the list)' },
      channel: { type: 'string', required: true, effect: 'one of the channels param' },
      say: LINE({ required: true, effect: 'the line spoken' }), character: { type: 'ref', to: 'character', effect: 'who says it (silent while dead)' },
      when: { type: 'predicate' }, cooldown: { type: 'number', min: 0, unit: 's' }, once: { type: 'boolean' }, weight: { type: 'number', min: 0 },
    } } } },
    rules: {
      bark_channel_unknown: { fields: ['plot.barks[].channel', 'channels'], message: 'a bark\'s channel is one of the channels param' },
    },
  },
  logic(logic) {
    logic.effect('bark', {
      codes: [{ code: 'bark_channel_unknown', fields: ['channel'], message: 'channel is one of the plot.barks channels param', example: { do: 'bark', line: 'Over here!', channel: 'no_such_channel' } }],
      refs: e => (e.character ? [['character', e.character]] : []),
      check: (e, path, errors, ctx) => {
        if (typeof e.line !== 'string') errors.push(err('effect_invalid', `${path}.line`, 'bark needs a line'));
        const chans = channelsOf(ctx.doc);
        if (e.channel !== undefined && !chans.includes(e.channel)) errors.push(err('bark_channel_unknown', `${path}.channel`, `unknown channel '${e.channel}'`, `channels: ${chans.join(', ')}`));
      },
      run: (e, rt) => rt.emitTyped('bark', e.channel ?? 'narrator', { channel: e.channel ?? 'narrator', text: e.line, line: e.line, character: e.character ?? null }),
    });
  },
  // The shape of plot.barks is declared (card.data); the channel names one of the channels param.
  validate(config, doc) {
    const list = doc.plot?.barks;
    if (!Array.isArray(list) || !Array.isArray(config.channels)) return [];
    return list.flatMap((b, i) => (isObj(b) && typeof b.channel === 'string' && !config.channels.includes(b.channel) ? [err('bark_channel_unknown', `plot.barks[${i}].channel`, `unknown channel '${b.channel}'`, `channels: ${config.channels.join(', ')}`)] : []));
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
