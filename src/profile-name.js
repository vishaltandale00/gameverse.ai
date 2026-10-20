import { VoiceInput } from './voice-input.js';

// Dictation and manual input share a draft. Only a second, explicit form submit
// returns a confirmed name to the profile storage owner.
export function createProfileNameEntry({ root = document, canStart, onTransition = () => {}, Voice = VoiceInput }) {
  const $ = selector => root.querySelector(selector);
  const field = $('#character-name'), dialog = $('#profile-dialog');
  let reviewed = null, previousState, lowerCase = false;
  const validate = () => {
    const name = field.value.trim();
    field.setCustomValidity(!name ? 'Enter or say your name.' : name.length > 24 ? 'Use 24 characters or fewer. Edit the name below.' : '');
    return name;
  };
  const edit = (focus = true) => {
    reviewed = null; $('#profile-edit').hidden = false; $('#profile-review').hidden = true;
    if (focus) { onTransition(); $('#name-record').focus(); }
  };
  const voice = new Voice({
    transcriptOnly: true, captureContext: () => ({ purpose: 'profile-name' }), pause: async () => () => {},
    canStart: () => dialog.open && !reviewed && canStart(),
    changed: view => {
      if (view.state !== previousState) { previousState = view.state; onTransition(); }
      const capturing = ['opening', 'recording', 'transcribing', 'cancelling'].includes(view.state);
      field.readOnly = capturing;
      $('#name-review-button').disabled = capturing;
      $('#name-record').disabled = ['opening', 'transcribing', 'cancelling'].includes(view.state);
      $('#name-record').textContent = view.state === 'recording' ? 'Finish name · R3' : 'Say your name · R3';
      $('#name-cancel').hidden = !capturing;
      $('#name-live').hidden = !capturing;
      if (view.state === 'opening' || view.state === 'idle') $('#name-live').textContent = '';
      if (view.text !== undefined && view.state === 'recording') $('#name-live').textContent = view.text;
      const messages = {
        opening: 'Opening microphone… Allow access if your browser asks.',
        recording: 'Say only your name. Press R3 again when finished.',
        transcribing: 'Finishing your name… B cancels.',
        cancelling: 'Cancelling…',
        idle: 'Voice cancelled. Your previous name is unchanged. You can enter it manually.',
        received: 'Check the spelling, then review your character. Nothing is saved yet.',
      };
      $('#name-status').textContent = view.state === 'error'
        ? `${view.message} You can use the controller keyboard below.` : messages[view.state] || '';
      if (view.state === 'error') $('#letters button')?.focus();
      if (view.state === 'received') {
        field.value = view.text.trim(); validate();
        if (field.value.length > 24) $('#name-status').textContent = 'That name is longer than 24 characters. Edit it below before continuing.';
        $('#name-review-button').focus();
      }
    },
  });
  // Names use the documented R3 binding, independently of feedback configuration.
  const configure = voice.configure.bind(voice);
  voice.configure = async () => { const config = await configure(); config.recordButton = 11; config.maxSeconds = Math.min(config.maxSeconds, 15); return config; };
  $('#name-record').onclick = () => voice.toggle();
  $('#name-cancel').onclick = () => void voice.cancel();
  const manual = action => {
    if (voice.active) void voice.cancel();
    edit(false); action(); validate(); $('#name-status').textContent = 'Review your character when the spelling looks right.';
  };
  field.addEventListener('input', () => { edit(false); validate(); });
  const letters = [];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'-") {
    const button = root.createElement('button'); button.type = 'button'; button.textContent = letter;
    button.onclick = () => manual(() => { if (field.value.length < 24) field.value += button.textContent; });
    letters.push(button); $('#letters').append(button);
  }
  $('#name-case').onclick = () => {
    lowerCase = !lowerCase; $('#name-case').setAttribute('aria-pressed', String(lowerCase));
    for (const button of letters) button.textContent = lowerCase ? button.textContent.toLowerCase() : button.textContent.toUpperCase();
  };
  $('#name-space').onclick = () => manual(() => { if (field.value.length < 24) field.value += ' '; });
  $('#name-backspace').onclick = () => manual(() => { field.value = [...field.value].slice(0, -1).join(''); });
  $('#name-clear').onclick = () => manual(() => { field.value = ''; });
  $('#name-edit').onclick = () => edit();
  const back = () => {
    if (voice.active) { void voice.cancel(); return true; }
    if (reviewed) { edit(); return true; }
    return false;
  };
  dialog.addEventListener('cancel', event => { if (back()) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (voice.active) void voice.cancel(); voice.pad.reset(); });
  return {
    voice, back,
    reset() {
      edit(false); field.value = ''; field.setCustomValidity(''); previousState = undefined;
      $('#name-live').textContent = ''; $('#name-status').textContent = 'Say your name, or enter it with the controller keyboard.';
      voice.pad.reset(); $('#name-record').focus();
    },
    confirm(avatar) {
      if (voice.active) return null;
      const name = validate();
      if (!field.reportValidity()) return null;
      if (reviewed?.name === name && reviewed.avatar === avatar) return name;
      reviewed = { name, avatar };
      $('#profile-edit').hidden = true; $('#profile-review').hidden = false;
      $('#profile-review-name').textContent = name; $('#profile-review-avatar').textContent = avatar;
      onTransition(); $('#profile-confirm').focus();
      return null;
    },
  };
}
