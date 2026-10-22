// Shared level-flow helpers the modes call. Everything lives in the plain-JSON
// game state S, so modes stay pure functions of (state, input).

export function emit(S, name, data = {}) { S.events.push({ ...data, name }); }

/** Add points; with a position the renderer pops a floating score there. */
export function addScore(S, n, x, y, quiet = false) {
  S.score += n; S.levelScore += n;
  if (x != null && !quiet) emit(S, 'points', { value: n, x, y });
}

/** Lose a life. Returns false when the game is over. retry restarts the level after a pause. */
export function loseLife(S, reason, { retry = false } = {}) {
  S.lives = Math.max(0, S.lives - 1);
  emit(S, 'hurt', { reason });
  if (S.lives <= 0) {
    S.status = 'lost'; S.reason = reason; S.phase = 'over';
    emit(S, 'lost', { reason });
    return false;
  }
  if (retry) { S.phase = 'fail'; S.phaseT = 0; S.note = reason; }
  return true;
}

export function clearLevel(S, data = {}) {
  if (S.phase !== 'play') return;
  S.phase = 'clear'; S.phaseT = 0;
  emit(S, 'level_up', { level: S.level, ...data });
}

/** A short banner for the renderer ("MULTIBALL!"). */
export function banner(S, text, kind = 'info') { S.banner = { text, kind, t: 0 }; }
