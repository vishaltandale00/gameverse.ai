// Player-facing view of granted gameplay control. Requesters and diagnostics
// never become gameplay rows. Watching comes from the actual visible session.
export const playerLabel = gameId => ({ soccer: 'Soccer', football: 'Football', overworld: 'Overworld' }[gameId] || 'Game');
export function gameplayRows(view, displayedSessionId) {
  return (view.running || []).filter(run => run.role === 'gameplay' && run.state === 'running').map(run => ({
    run, watching: run.sessionId === displayedSessionId, title: playerLabel(run.gameId),
    status: run.sessionId === displayedSessionId
      ? (run.gameId === 'overworld' ? 'Controlling your character · You’re watching' : 'Playing · You’re watching')
      : (run.gameId === 'overworld' ? 'Controlling your character in background' : 'Playing in background'),
  }));
}
export function renderPlayerPanel({ panel, view, displayedSessionId, watchingPending = false, onWatch, onStop, onError, diagnostics }) {
  const rows = gameplayRows(view, displayedSessionId);
  panel.hidden = rows.length === 0;
  const list = panel.querySelector('#agent-runs');
  const key = rows.map(({ run, watching }) => `${run.runId}:${watching}`).join('|') + ':' + watchingPending;
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(...rows.map(({ run, watching, title, status }) => {
      const row = document.createElement('li'); row.dataset.runId = run.runId;
      const copy = document.createElement('div'); copy.className = 'agent-player-copy';
      const name = document.createElement('strong'); name.textContent = title;
      const state = document.createElement('span'); state.className = 'agent-player-state'; state.textContent = status;
      copy.append(name, state);
      const controls = document.createElement('div'); controls.className = 'agent-player-controls';
      if (!watching) {
        const watch = document.createElement('button'); watch.type = 'button'; watch.className = 'agent-watch'; watch.textContent = 'Watch';
        watch.disabled = watchingPending; watch.setAttribute('aria-label', `Watch the ${title} simulated player`);
        watch.onclick = () => { void Promise.resolve(onWatch(run)).catch(onError); };
        controls.append(watch);
      }
      const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'agent-stop'; stop.textContent = 'Stop';
      stop.setAttribute('aria-label', `Stop the ${title} simulated player`); stop.onclick = () => onStop(run);
      controls.append(stop); row.append(copy, controls); return row;
    }));
  }
  panel.querySelector('#agent-stop-all').hidden = rows.length < 2;
  const details = panel.querySelector('#agent-details');
  const refresh = () => {
    panel.querySelector('#agent-ack').textContent = view.acknowledgment || '';
    panel.querySelector('#agent-status').textContent = diagnostics();
  };
  details.ontoggle = () => { if (details.open) refresh(); };
  if (details.open) refresh();
}
