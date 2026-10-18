const message = document.getElementById('auth-message');
const progress = document.getElementById('auth-progress');
const request = new URL(location.href).searchParams.get('request');
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Error('Couldn’t prepare sign-in. Return to Gameverse to try again.');
  return response.json();
}
try {
  if (!/^[0-9a-f-]{36}$/.test(request || '')) throw Error('Open this page using Connect in Gameverse.');
  // Same id as the account page: retries and racing requests allocate once.
  let job = await api('/api/agent-connections/claude/browser', 'POST', { request_id: request });
  const deadline = Date.now() + 90000;
  while (!job.auth_url) {
    if (['failed', 'cancelled', 'cleanup_failed'].includes(job.phase) || job.cancellation_requested) throw Error('This connection ended. Return to Gameverse to try again.');
    if (job.connection_step === 'connected' || job.connection_step === 'verifying') throw Error('Return to Gameverse to finish this connection.');
    if (Date.now() >= deadline) throw Error('Sign-in is taking longer than expected. Return to Gameverse to continue.');
    await new Promise(resolve => setTimeout(resolve, 2500));
    job = await api(`/api/jobs/${job.id}`);
  }
  const url = new URL(job.auth_url);
  if (url.protocol !== 'https:' || !['claude.ai', 'claude.com', 'platform.claude.com', 'console.anthropic.com'].includes(url.hostname)) throw Error('Unable to open provider sign-in. Return to Gameverse.');
  location.replace(url.href);
} catch (error) {
  progress.className = 'connection-state failed'; progress.textContent = 'Sign-in paused'; message.textContent = error.message;
}
