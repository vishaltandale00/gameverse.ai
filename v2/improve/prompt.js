// Prompts for the promotion agent. The first attempt gets the whole brief; a repair round gets the
// job's own verification output (never the agent's claims) and the unchanged acceptance criteria.

export const modPaths = modId => ({ mod: `v2/kits/mods/${modId}.js`, test: `tests/v2-mods-${modId}.test.js`, index: 'v2/kits/mods/index.js' });

export function acceptanceCriteria({ modId, kitId, scope }) {
  const p = modPaths(modId);
  return [
    `Create ${p.mod}: a native mod with id '${modId}', shaped like v2/kits/mods/weapon.js (id, summary, requires, button, schema, normalize, enabled, label, init, step, render?).`,
    `Also give the mod object a \`sample\` property: a config object that, after normalize(), switches the mod on. normalize({}) must give a config that is switched off.`,
    `Register it in ${p.index} (import it and add it to MODS). Do not change the weapon mod.`,
    `Add tests in ${p.test} (node:test, like tests/v2-mods.test.js): the mod is offered on '${kitId}' by capability, its behavior matches the experiment, it is deterministic (same seed and inputs give the same state), and it is never offered to a kit without its capabilities.`,
    `Follow the experiment's behavior, but as native code: deterministic (no Math.random, Date, performance.now or timers; derive any randomness from state, e.g. a small LCG seeded in init), plain-JSON mod state, and only world-adapter calls the mod's \`requires\` capabilities guarantee. Optional adapter methods (spawn, setBlocked, addScore, hurtPlayer, stun, size, wrap) must be listed in \`requires\` under their capability or guarded.`,
    `\`requires\` must be the smallest capability set the mechanic needs, so the mod runs on every kit whose world allows it, not just '${kitId}'. Use only relative imports.`,
    `Only add or edit files under ${scope.allowedPrefixes.join(' and ')}. The only existing file you may modify is ${scope.modifiable.join(', ')}; never edit existing tests or kit code.`,
    `The schema fragment must be OpenAI strict-mode: every object has additionalProperties: false and lists every property in required; no oneOf/anyOf/minimum/maximum/minItems/maxItems.`,
    `Run the tests yourself with \`node --test ${p.test}\` and \`node --test tests/v2-mods.test.js tests/v2-kits-contract.test.js\`. The job re-runs these plus tests/v2-kit-${kitId}.test.js and a composition check after you finish; it decides success, not you.`,
  ];
}

export function buildPrompt({ experiment, kitId, kit, kits, modId, extending, weaponSource, composeSource, scope }) {
  const caps = k => `${k.id} (v${k.version}): capabilities [${(k.world?.capabilities || []).join(', ')}], kit buttons [${(k.world?.buttons || []).join(', ')}]`;
  const criteria = acceptanceCriteria({ modId, kitId, scope });
  return `You are promoting a sandboxed experiment into a native, tested Gameverse mod. You are working in a disposable git worktree of the repository; edit files directly. Do not run git.

# Task
The experiment below was written for one game of the '${kitId}' kit and runs sandboxed. Turn it into the native mod '${modId}' that any compatible kit can use.

Player's request that produced the experiment:
${experiment.request || '(none recorded)'}

Experiment label: ${experiment.label || '(none)'}

Experiment code (sandbox module; it returns operations as data, a native mod calls the world adapter directly):
\`\`\`js
${experiment.code}
\`\`\`

# Target kit and the other kits
Target: ${caps(kit)}
All kits:
${kits.map(k => `- ${caps(k)}`).join('\n')}
Each kit's world adapter is in v2/kits/<id>/index.js under \`world\`; read the target's before writing code.

# Acceptance criteria
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

# Reference: v2/kits/EXTENDING.md
${extending}

# Reference: the native mod pattern, v2/kits/mods/weapon.js
\`\`\`js
${weaponSource}
\`\`\`

# Reference: how mods are composed, v2/kits/mods/compose.js
\`\`\`js
${composeSource}
\`\`\`

When everything passes, reply with a short summary of the files you wrote.`;
}

export function repairPrompt({ attempt, maxRepairs, failures, modId, kitId, scope, fresh }) {
  const intro = fresh ? `You are fixing a Gameverse mod promotion in this git worktree. The previous attempt's files are already present.\n\n# Acceptance criteria\n${acceptanceCriteria({ modId, kitId, scope }).map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n` : '';
  return `${intro}The job's own verification failed (repair round ${attempt} of ${maxRepairs}). Fix the cause in the mod or its new test; do not weaken or edit existing tests, and stay inside the allowed files.

${failures}

Re-run the failing commands yourself before you finish.`;
}
