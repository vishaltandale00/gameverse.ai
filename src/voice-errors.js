// Player-facing explanations. Protocol/debug codes stay out of the voice flow.
const messages={
  hosted_voice_key_required:'Add an OpenAI API key in Account before using voice.',
  api_key_grant_revoked:'Your API key changed or was disconnected. Check Account and try again.',
  hosted_voice_account_capacity:'Your current voice session is still finishing. Stop it and wait for cleanup before trying again.',
  hosted_voice_daily_limit:'You have reached your account’s voice allowance for today.',
  voice_audio_budget_exhausted:'This voice session has reached its audio allowance. Stop the simulated user before starting another request.',
  voice_budget_exhausted:'This voice session has reached its model allowance. Stop the simulated user before starting another request.',
  voice_release_mismatch:'The game version changed. Reopen the match before requesting a takeover.',
  voice_provider_failed:'Voice could not use the configured model services. Check your key’s service access in Account.',
};
export const voiceFailureMessage=code=>messages[code]||'Voice is unavailable. Check your account and try again.';
