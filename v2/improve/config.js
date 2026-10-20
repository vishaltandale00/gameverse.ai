// Loop configuration for tier-4 promotion (v2/kits/EXTENDING.md): an experiment becomes a native,
// tested mod. This file owns the loop's algorithm knobs and resource policy (AGENTS.md: they belong
// to the loop configuration, not to the host). Every limit is finite and configurable; resolveConfig
// rejects a missing, zero, negative or infinite limit instead of treating it as "unlimited".

export const LOOP_CONFIG = Object.freeze({
  id: 'gameverse.v2.promote-mod',
  version: '0.1.0',
  runner: 'local-claude', // 'local-claude' | 'daytona' | 'fake'

  limits: {
    prepareTimeoutMs: 120_000,       // worktree / sandbox creation and source hydration
    codingTimeoutMs: 15 * 60_000,    // one agent attempt (first try or one repair round)
    verifyCommandTimeoutMs: 120_000, // each verification command
    jobTimeoutMs: 45 * 60_000,       // whole job after it leaves the queue
    maxAgentTurns: 60,               // per attempt (claude --max-turns)
    maxBudgetUsd: 5,                 // per attempt (claude --max-budget-usd); provider-reported, not a bill
    maxRepairAttempts: 2,            // repair rounds after the first attempt
    maxActiveJobs: 1,                // global admission on this machine
    maxActivePerUser: 1,             // HOSTING.md initial limit: one active improvement per user
    maxActivePerGame: 1,
    maxQueuedJobs: 20,
    maxLogBytes: 4 * 1024 * 1024,    // per attempt agent log retained in the job dir
    maxFeedbackChars: 6000,          // failure output fed back to the agent in a repair round
    maxExperimentCodeChars: 64_000,
  },

  agent: {
    cli: 'claude',
    model: null,                      // null: the CLI's configured default
    permissionMode: 'dontAsk',        // anything not allowed below is denied, never prompted
    restricted: true,                 // --restricted: ignore user/project settings, confine file tools to the worktree
    resumeForRepairs: true,           // a repair round continues the attempt's session (--resume) instead of starting cold
    // Tools that exist in the session, then the subset allowed without asking.
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(node --test *)', 'Bash(node --check *)'],
  },

  // Files the result may touch. Anything else refuses the result (recorded with the reason).
  scope: {
    allowedPrefixes: ['v2/kits/mods/', 'tests/'],
    // Existing files the agent may modify. Everything else in scope may only be added, so the agent
    // cannot weaken an existing test (contracts/IMPROVEMENT_LOOP.md: repairs cannot weaken assertions).
    modifiable: ['v2/kits/mods/index.js'],
    allowOutside: false,
  },

  // Repair policy: stop early when a repair round leaves the diff unchanged (the agent found nothing it may
  // change, e.g. the failure is outside its allowed files), instead of spending the remaining rounds.
  repair: { stopWhenUnchanged: true },

  // The target kit's own test file ({kitTest}); kits whose file doesn't follow the pattern are listed.
  kitTests: { pattern: 'tests/v2-kit-{kitId}.test.js', creature: 'tests/v2-creature-kit.test.js' },

  // Run by the job itself in the worktree after every attempt; never trusted from the agent.
  // Placeholders: {modTest} {kitTest} {kitId} {modId} {checker} {workdir}.
  verification: [
    { id: 'mod-tests', argv: ['node', '--test', '{modTest}'] },
    { id: 'mods', argv: ['node', '--test', 'tests/v2-mods.test.js'] },
    { id: 'kits-contract', argv: ['node', '--test', 'tests/v2-kits-contract.test.js'] },
    { id: 'kit-tests', argv: ['node', '--test', '{kitTest}'] },
    { id: 'compose', argv: ['node', '{checker}', '--root', '{workdir}', '--kit', '{kitId}', '--mod', '{modId}'] },
  ],
});

const POSITIVE = ['prepareTimeoutMs', 'codingTimeoutMs', 'verifyCommandTimeoutMs', 'jobTimeoutMs', 'maxAgentTurns', 'maxBudgetUsd',
  'maxActiveJobs', 'maxActivePerUser', 'maxActivePerGame', 'maxQueuedJobs', 'maxLogBytes', 'maxFeedbackChars', 'maxExperimentCodeChars'];

/** The base config with overrides merged one level deep (limits, agent, scope); throws on an unbounded or malformed limit. */
export function resolveConfig(overrides = {}) {
  const base = LOOP_CONFIG;
  const cfg = {
    ...base, ...overrides,
    limits: { ...base.limits, ...overrides.limits },
    agent: { ...base.agent, ...overrides.agent },
    scope: { ...base.scope, ...overrides.scope },
    kitTests: { ...base.kitTests, ...overrides.kitTests },
    repair: { ...base.repair, ...overrides.repair },
    verification: overrides.verification || base.verification,
  };
  for (const k of POSITIVE) {
    const v = cfg.limits[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw Error(`loop config: limits.${k} must be a finite positive number (got ${v})`);
  }
  const r = cfg.limits.maxRepairAttempts;
  if (!Number.isInteger(r) || r < 0 || r > 10) throw Error('loop config: limits.maxRepairAttempts must be an integer 0..10');
  if (typeof cfg.id !== 'string' || !/^\d+\.\d+\.\d+$/.test(cfg.version)) throw Error('loop config: id and semver version are required');
  if (!Array.isArray(cfg.verification) || !cfg.verification.length) throw Error('loop config: verification commands are required');
  for (const c of cfg.verification) if (!c?.id || !Array.isArray(c.argv) || !c.argv.length) throw Error(`loop config: bad verification command ${JSON.stringify(c)}`);
  if (!cfg.agent.allowedTools.every(t => typeof t === 'string')) throw Error('loop config: agent.allowedTools must be strings');
  return Object.freeze(cfg);
}

/** A config reference recorded with every job (AGENTS.md: loop version/config reference). */
export const configRef = cfg => ({ id: cfg.id, version: cfg.version, runner: cfg.runner, limits: { ...cfg.limits } });
