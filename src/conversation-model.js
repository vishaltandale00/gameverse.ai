export const ACTIVE_STATES = new Set(['queued', 'planning', 'building', 'playtesting', 'repairing']);
export const STAGES = ['planning', 'building', 'playtesting', 'completed'];
export const STAGE_LABELS = { planning: 'Plan', building: 'Build', playtesting: 'Bot-test', completed: 'Ready to play' };
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
  const messages = { queued: 'Your request is queued locally.', planning: 'Working out how your source worlds fit together.', building: 'Creating your game from the selected source systems.', playtesting: 'The gameplay bot is checking the built game in an isolated session.', repairing: 'Inspecting native observations for a supported repair.', completed: run?.playable === true ? (run?.objective_validated === true ? 'The native build is available and the bot objective was verified. Review the qualification scope below.' : 'Bot objective incomplete — native build available. You can play this candidate; the requested gameplay has not been fully verified.') : 'The run finished, but a verified playable result is not available.', cancelled: 'This run was stopped. Its recorded evidence is retained.', interrupted: 'The local runner stopped before finishing. Its evidence is retained; submit a new request to retry.', blocked: 'This request needs a supported source combination or a working local connection.', failed: 'This run could not produce a verified playable game.' };
  return run?.error?.message || messages[run?.status] || 'Checking the local run…';
}
export function refinementIntent(previous, next) {
  return previous ? `${previous}\n\nRefinement: ${next}` : next;
}
