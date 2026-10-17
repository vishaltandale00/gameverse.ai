export const ACTIVE_STATES = new Set(['queued', 'planning', 'building', 'playtesting', 'repairing']);
export const STAGES = ['planning', 'building', 'playtesting', 'completed'];
export const STAGE_LABELS = { planning: 'Plan', building: 'Build', playtesting: 'Bot-test', completed: 'Ready to play' };
export function isGraphicsRun(run) {
  return ['native-graphics-consumer', 'native-enemy-graphics-consumer'].includes(run?.qualification?.scope) || ['pokemon-overworld', 'pokemon-character', 'sonic-pokemon-enemies'].includes(run?.routing?.backend);
}
export function isSourceAttempt(run) { return Boolean(run?.checkpoint?.kind === 'source-attempt' || run?.evidence?.request_plan || run?.evidence?.attempt || run?.events?.some(event => event.stage === 'planning' && /^Codex is investigating/.test(event.message || ''))); }
export function safeLocalUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try { const url = new URL(value, 'http://gameverse.local'); return url.origin === 'http://gameverse.local' ? `${url.pathname}${url.search}${url.hash}` : null; } catch { return null; }
}
export function playableUrl(run) {
  if (run?.status !== 'completed' || run?.playable !== true) return null;
  return safeLocalUrl(run.play_url ?? run.artifact?.play_url ?? run.artifact?.url);
}
export function stageState(run, stage) {
  if (run?.status === 'completed' && run?.playable !== true) return '';
  const current = run?.status === 'repairing' ? 'building' : run?.status;
  if (current === stage) return 'current';
  if (STAGES.indexOf(current) > STAGES.indexOf(stage)) return 'done';
  return (run?.events ?? []).some(event => event.stage === stage) ? 'done' : '';
}
export function runMessage(run) {
  const investigation = run?.status === 'planning' && run.events?.findLast(event => event.stage === 'planning' && /^Codex is investigating/.test(event.message || ''));
  if (investigation?.message) return investigation.message;
  if(isGraphicsRun(run)){
    if(run?.error?.message)return run.error.message;
    if(run?.status==='playtesting')return 'Checking mapped sprite frames, animations and palettes in native graphics consumers.';
    if(run?.status==='completed'&&run?.playable===true)return run?.objective_validated===true?'The requested graphics change passed native checks. Review the coverage and qualification scope below.':'The native graphics checks passed for the mapped sprites. The full request remains incomplete; review each requirement and the coverage gaps below.';
  }
  if (isSourceAttempt(run) && run?.status === 'playtesting' && !run.qualification?.bot) return 'Checking the constructed candidate. Native qualification and requirement coverage will be reported when checks finish.';
  if (isSourceAttempt(run) && run?.status === 'completed' && run?.playable === true && !run.qualification?.bot) return 'A native candidate is available. Review each requirement and the independent qualification scope below.';
  const messages = { queued: 'Your request is queued locally.', planning: 'Working out how your source worlds fit together.', building: 'Creating your game from the selected source systems.', playtesting: 'The gameplay bot is checking the built game in an isolated session.', repairing: 'Inspecting native observations for a supported repair.', completed: run?.playable === true ? (run?.objective_validated === true ? 'The native build is available and the bot objective was verified. Review the qualification scope below.' : 'Bot objective incomplete — native build available. You can play this candidate; the requested gameplay has not been fully verified.') : 'The run finished, but a verified playable result is not available.', cancelled: 'This run was stopped. Its recorded evidence is retained.', interrupted: 'The local runner stopped before finishing. Its evidence is retained; submit a new request to retry.', blocked: 'This request needs a supported source combination or a working local connection.', failed: 'This run could not produce a verified playable game.' };
  return run?.error?.message || messages[run?.status] || 'Checking the local run…';
}
export function refinementIntent(previous, next) {
  return previous ? `${previous}\n\nRefinement: ${next}` : next;
}
