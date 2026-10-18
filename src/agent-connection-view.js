export const terminalPhases = new Set(['succeeded', 'failed', 'cancelled', 'cleanup_failed']);

// Provider connection progress stays distinct from a coding job's progress.
export function connectionView(connection, login, local) {
  if (local?.step === 'starting') return { step: 'preparing', label: 'Opening Claude…', detail: 'Sign-in opens in a new tab.', busy: true };
  if (local?.step === 'cancelling' || login?.cancellation_requested) return { step: 'cancelling', label: 'Cancelling…', detail: 'Closing the connection request.', busy: true };
  if (connection?.status === 'connected') return { step: 'connected', label: 'Connected', detail: 'Ready when you want to create or improve.', busy: false };
  if (local?.step === 'verifying' || login?.connection_step === 'verifying') return { step: 'verifying', label: 'Verifying connection…', detail: 'Code received. Keep this page open while Claude confirms.', busy: true };
  if (login && !terminalPhases.has(login.phase)) {
    if (login.auth_url) return { step: 'authorize', label: 'Finish in Claude', detail: 'Authorize in the Claude tab, then paste its code here.', busy: false };
    return { step: 'preparing', label: 'Opening Claude…', detail: 'Preparing your secure sign-in.', busy: true };
  }
  if (local?.error) return { step: 'failed', label: 'Couldn’t connect', detail: local.error, busy: false };
  if (login && ['failed', 'cleanup_failed'].includes(login.phase)) return { step: 'failed', label: 'Connection interrupted', detail: login.reason === 'deadline_or_access_expired' ? 'Sign-in expired. Start again when you’re ready.' : 'Claude couldn’t finish this connection. Please try again.', busy: false };
  if (connection?.status === 'reconnect_required') return { step: 'reconnect', label: 'Reconnect', detail: 'Sign in again to continue using this agent.', busy: false };
  return { step: 'idle', label: 'Not connected', detail: 'Use your own agent account.', busy: false };
}
