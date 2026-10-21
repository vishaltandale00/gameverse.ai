// graphics.ui.feedback: presentation effects every document may use, with or
// without UI and audio installed. `notify` and `play_sound` only emit events;
// graphics.ui.hud shows notifications and graphics.audio.synth plays cues in
// the browser. The card is ambient (KERNEL_API vocabulary rules), so stories
// and quests can use them in headless verification and in documents that list
// no graphics at all.
export const NOTIFY_KINDS = ['info', 'quest', 'warn', 'item', 'level'];

export default {
  id: 'graphics.ui.feedback',
  card: {
    intent: 'Presentation effects for any document: notify {text, kind} shows a notification and play_sound {cue} plays a sound cue when UI/audio are present; both are plain events headless.',
    views: ['any'],
    ambient: true,
    params: {},
    provides: { events: ['notify', 'play_sound'] },
  },
  logic(logic) {
    logic.effect('notify', {
      codes: [
        { code: 'ui_notify_text', fields: ['text'], message: 'notify has the text to show', example: { do: 'notify' } },
        { code: 'ui_notify_kind', fields: ['kind'], message: `notify's kind is one of ${NOTIFY_KINDS.join(', ')}`, example: { do: 'notify', text: 'Hello', kind: 'shout' } },
      ],
      check: (e, path, errors) => {
        if (typeof e.text !== 'string' || !e.text) errors.push({ code: 'ui_notify_text', path, message: 'notify needs text' });
        if (e.kind && !NOTIFY_KINDS.includes(e.kind)) errors.push({ code: 'ui_notify_kind', path, message: `kind '${e.kind}' is not ${NOTIFY_KINDS.join('|')}` });
      },
      run: (e, rt) => rt.emit('notify', { text: e.text, kind: e.kind || 'info' }),
    });
    logic.effect('play_sound', {
      codes: [{ code: 'audio_cue_missing', fields: ['cue'], message: 'play_sound names the cue: an event or cue name', example: { do: 'play_sound' } }],
      check: (e, path, errors) => { if (typeof e.cue !== 'string' || !e.cue) errors.push({ code: 'audio_cue_missing', path, message: 'play_sound needs cue: <event or cue name>' }); },
      run: (e, rt) => rt.emit('play_sound', { cue: e.cue }),
    });
  },
};
