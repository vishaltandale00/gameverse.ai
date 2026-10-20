// Child processes for runners: a process group per command so cancel and timeout kill everything it
// started, bounded output capture and secret redaction before anything is logged or stored.
import { spawn, execFile } from 'node:child_process';

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                       // Anthropic API / OAuth tokens
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,   // authorization headers
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g,   // GitHub tokens
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,                   // AWS access keys
  /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)"?\s*[:=]\s*)"?[^\s",}]{8,}"?/gi,
];
/** Replace anything that looks like a credential. Applied to every log line and stored output. */
export const redact = text => SECRET_PATTERNS.reduce((t, re) => t.replace(re, (m, keep) => (typeof keep === 'string' && m.startsWith(keep) ? keep : '') + '[redacted]'), String(text));

// Only these variables reach verification commands; agent sessions get the user's environment so the
// CLI can find its own login, but nothing from it is ever logged.
const SAFE_ENV = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'USER', 'SHELL'];
export const minimalEnv = (extra = {}) => ({ ...Object.fromEntries(SAFE_ENV.filter(k => process.env[k] != null).map(k => [k, process.env[k]])), NO_COLOR: '1', ...extra });

const killGroup = (child, sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };

/**
 * Run argv in cwd. Resolves { code, signal, timedOut, aborted, stdout, stderr, ms } (never rejects for a
 * non-zero exit). stdout/stderr keep the last `tailBytes`; onLine(stream, line) sees every line.
 */
export function run(argv, { cwd, env = minimalEnv(), timeoutMs, signal, input = null, onLine = null, tailBytes = 65536 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('run: a finite timeout is required');
  return new Promise(resolve => {
    const started = performance.now();
    let stdout = '', stderr = '', timedOut = false, aborted = false, done = false;
    let child;
    try { child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ code: null, signal: null, timedOut: false, aborted: false, stdout: '', stderr: String(error.message), ms: 0, spawnError: error.code || error.message }); return; }
    const partial = { stdout: '', stderr: '' };
    const feed = (name, chunk) => {
      const text = chunk.toString();
      if (name === 'stdout') stdout = (stdout + text).slice(-tailBytes); else stderr = (stderr + text).slice(-tailBytes);
      if (!onLine) return;
      const lines = (partial[name] + text).split('\n');
      partial[name] = lines.pop();
      for (const line of lines) if (line) { try { onLine(name, line); } catch {} }
    };
    child.stdout.on('data', c => feed('stdout', c));
    child.stderr.on('data', c => feed('stderr', c));
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    let hard = null;
    const stop = () => { killGroup(child, 'SIGTERM'); hard = setTimeout(() => killGroup(child, 'SIGKILL'), 3000); hard.unref?.(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const finish = (code, sig, spawnError) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (onLine) for (const name of ['stdout', 'stderr']) if (partial[name]) { try { onLine(name, partial[name]); } catch {} }
      // Make sure nothing in the group survives the leader.
      if (timedOut || aborted) killGroup(child, 'SIGKILL');
      if (hard) clearTimeout(hard);
      resolve({ code, signal: sig, timedOut, aborted, stdout, stderr, ms: Math.round(performance.now() - started), ...(spawnError ? { spawnError } : {}) });
    };
    child.on('error', error => finish(null, null, error.code || error.message));
    child.on('close', (code, sig) => finish(code, sig));
  });
}

/** A short git or tool command; rejects with stderr on failure. */
export const sh = (file, args, { cwd, timeoutMs = 30000, env } = {}) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(Error(`${file} ${args.join(' ')}: ${(stderr || error.message).trim().slice(0, 2000)}`), { code: error.code, stderr }));
    else resolve(stdout);
  });
  child.stdin?.end(); // nothing reads from us; a tool waiting on stdin must see EOF, not hang
});
