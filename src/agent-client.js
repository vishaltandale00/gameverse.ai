// Browser-side clients for the local server-only provider boundary
// (scripts/agent-api.mjs). No credential is ever present here; every call goes
// to this app's own origin. Prompts, question sets and freshness handling belong
// to the harness/agent version, not to the engine or the host.
export const AGENT_CLIENT_VERSION = 'agent-client-v1';

const post = async (fetchImpl, path, body, signal, timeoutMs = 25000) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  let result;
  try { result = await response.json(); } catch { throw Error('The local agent endpoint returned an invalid response.'); }
  if (!response.ok) throw Error(result.error || 'The agent request failed.');
  return result;
};
const choice = (answers, name) => answers.find(answer => answer.name === name && answer.type === 'choice')?.choice ?? null;
const probability = (answers, name) => answers.find(answer => answer.name === name && answer.type === 'predicate')?.probability ?? null;

// --- one-shot planner -------------------------------------------------------
// The Decisions API has no free-text question type, so the plan is assembled
// from structured choices plus the retained transcript; the goal text is the
// player's own words rather than invented prose.
export function createPlanner({ fetchImpl = (...args) => fetch(...args), path = '/api/agent/plan' } = {}) {
  return async function plan({ transcript, context, state, signal }) {
    // No fallback target: an empty catalog must surface as "nothing supported"
    // rather than being masked by a plausible-looking choice.
    const games = state.games;
    if (!games.length) return { toolCalls: [], model: null, provider: null, usage: null,
      say: 'No takeover target is registered yet, so nothing was started.' };
    // Decisions choice values must be unique; the catalog may already list the
    // overworld, so build the target list through a map keyed by value.
    const targets = [...new Map([...games.map(game => [game.gameId, { value: game.gameId, description: `${game.name} (${game.gameId})` }]),
      ['overworld', { value: 'overworld', description: 'The Gameverse overworld character' }]]).values()];
    const runs = state.runs.map(run => ({ value: run.runId, description: `${run.gameId} ${run.surface}: ${run.goal}` }));
    const questions = [
      { type: 'choice', name: 'intent', instructions: 'What does this one-shot spoken command ask the app to do?', choices: [
        { value: 'start', description: 'Have a simulated user take over and play something.' },
        { value: 'status', description: 'Report what the running simulated users are doing.' },
        { value: 'stop', description: 'Stop a running simulated user and give control back.' },
        { value: 'none', description: 'The command does not map to a takeover action.' }] },
      { type: 'choice', name: 'target', instructions: 'Which target should the simulated user control? Prefer the displayed target when the command says "this".', choices: targets },
      { type: 'choice', name: 'selection', instructions: 'Should it use a session that is already running, or open a new one? Choose reuse only when the command refers to an existing match.', choices: [
        { value: 'auto', description: 'Use a running session of that target if one exists, otherwise open one.' },
        { value: 'reuse', description: 'Only continue an already running session.' },
        { value: 'new', description: 'Open a separate new session even if one is running.' }] },
      ...(runs.length ? [{ type: 'choice', name: 'run', instructions: 'Which running simulated user does a status or stop command refer to?',
        choices: [...runs, { value: 'all', description: 'Every running simulated user.' }] }] : []),
      // Predicate questions carry only name/type/instructions: the provider
      // rejects criteria fields (unknown_parameter questions[n].true_description),
      // so the criteria live in the instructions text.
      { type: 'predicate', name: 'second_run',
        instructions: 'Does the command ask for more than one simulated user at once?'
          + '\ntrue: it asks for several takeovers, e.g. both teams, or soccer and the overworld.'
          + '\nfalse: one takeover.' },
    ];
    const displayed = state.displayed ? `Currently displayed: ${JSON.stringify(state.displayed)}. ` : '';
    const result = await post(fetchImpl, path, {
      state: `A player of a web game app spoke one command. Map it to app tool calls. ${displayed}`
        + `Live sessions: ${JSON.stringify(state.sessions)}. Running simulated users: ${JSON.stringify(state.runs)}. `
        + `Spoken command: "${transcript}"`,
      questions,
    }, signal);
    const answers = result.answers || [];
    const intent = choice(answers, 'intent'), target = choice(answers, 'target'), selection = choice(answers, 'selection') || 'auto';
    const run = choice(answers, 'run'), second = probability(answers, 'second_run');
    const toolCalls = [];
    if (intent === 'start' && target) {
      toolCalls.push({ name: 'open_session', args: { gameId: target, selection } });
      toolCalls.push({ name: 'start_simulated_user', args: { goal: transcript.trim(), fromPreviousSession: true } });
      if (second !== null && second >= 0.6 && target !== 'overworld') {
        toolCalls.push({ name: 'open_session', args: { gameId: 'overworld', selection: 'auto' } });
        toolCalls.push({ name: 'start_simulated_user', args: { goal: transcript.trim(), fromPreviousSession: true }, stopOnError: false });
      }
    } else if (intent === 'status') toolCalls.push({ name: 'run_status', args: run && run !== 'all' ? { runId: run } : {} });
    else if (intent === 'stop') {
      const targets = run === 'all' || !run ? state.runs.map(entry => entry.runId) : [run];
      for (const runId of targets) toolCalls.push({ name: 'stop_run', args: { runId, reason: 'voice stop command' }, stopOnError: false });
    }
    return { toolCalls, model: result.model, provider: result.provider, usage: result.usage,
      say: intent === 'none' ? 'That command did not map to a supported takeover action.' : '' };
  };
}

// --- gameplay decisions -----------------------------------------------------
// One Decisions call answers one bounded action; the harness decides when to ask
// and whether the answer is still fresh enough to use.
export function createDecisionsPolicy({ fetchImpl = (...args) => fetch(...args), path = '/api/agent/decisions' } = {}) {
  return async function decide({ observation, goal, intent, memory, capabilities, seq, signal }) {
    const directions = capabilities.directions || ['stop'];
    const actions = Object.keys(capabilities.actions || {}).filter(name => name !== 'idle');
    const questions = [
      { type: 'choice', name: 'move', instructions: 'Choose the movement/aim direction for the next fraction of a second. stop brakes and keeps the current facing.',
        choices: directions.map(value => ({ value, description: value.replaceAll('_', ' ') })) },
      { type: 'choice', name: 'action', instructions: observation.menu
        ? `The visible screen is '${observation.phase}', which only accepts confirm. Choose confirm to continue, or release to drop a held button.`
        : 'Choose one controller action. A charged action keeps charging while you keep choosing it; release strikes it. Respect possession, phase and the current charge.',
        choices: actions.map(value => ({ value, description: describe(capabilities, value) })) },
    ];
    // Facts the policy needs stated plainly; the engine supplied every value.
    const possession = observation.possession === 'us'
      ? (observation.ballOwnerIsSelected
        ? `YOUR SELECTED PLAYER HAS THE BALL (${observation.selected?.distanceToGoal} units from the goal at ${JSON.stringify(observation.attackingGoal)}).`
        : 'Your team has the ball but another teammate is carrying it.')
      : observation.possession === 'them' ? 'The opponent has the ball; your selected player does not.'
        : 'The ball is loose.';
    const result = await post(fetchImpl, path, {
      state: `You are playing an original arcade game through its real controls as team ${observation.team}. `
        + 'Game time keeps running while you think, so pick an action that is still sensible a moment later. '
        + `${possession} `
        + (observation.charging ? `You are already charging '${observation.charging}' at ${observation.charge}. ` : '')
        + 'A charged action is released automatically inside its own short hold window, so choosing shot once is enough to strike. '
        + `Your goal: ${goal || 'play well'}. Current intent: ${intent || 'play'}. `
        + `Recent reflections: ${JSON.stringify((memory?.reflections || []).map(entry => entry.note))}. `
        + `Recently executed actions: ${JSON.stringify((memory?.recentActions || []).map(entry => entry.type))}. `
        + `Visible observation:\n${JSON.stringify(observation)}`,
      questions, runId: memory?.runId || null,
    }, signal);
    const answers = result.answers || [];
    const move = choice(answers, 'move'), action = choice(answers, 'action');
    if (!action || !directions.includes(move)) throw Error('The decision response did not choose a valid action.');
    return { action: { type: action, direction: move, move }, provider: result.provider, model: result.model,
      usage: { tokens: result.usage?.total_tokens ?? null }, seq };
  };
}
const describe = (capabilities, name) => capabilities.describe?.[name] || `${name.replaceAll('_', ' ')} (${capabilities.actions[name].kind})`;

// --- asynchronous reflections ----------------------------------------------
export function createReflector({ fetchImpl = (...args) => fetch(...args), path = '/api/agent/reflect' } = {}) {
  return async function reflect({ observation, memory, goal, usage, seq, signal }) {
    const result = await post(fetchImpl, path, {
      input: `You are reviewing a simulated user playing an original arcade game in real time.\nGoal: ${goal}\n`
        + `Observation: ${JSON.stringify(observation)}\nRecent actions: ${JSON.stringify((memory?.recentActions || []).map(entry => entry.type))}\n`
        + `Usage so far: ${JSON.stringify({ decisions: usage?.decisions, stale: usage?.stale, rejected: usage?.rejectedActions })}\n`
        + 'Reply with one short sentence of play advice. If the stated goal is already achieved, begin the sentence with GOAL REACHED.',
      runId: memory?.runId || null,
    }, signal, 30000);
    const note = (result.text || '').trim();
    return { note, goalReached: /^goal reached/i.test(note), model: result.model, usage: { tokens: result.usage?.total_tokens ?? null } };
  };
}

// --- requester speech -------------------------------------------------------
// Real audio bytes for the ordinary voice-capture path. The requester harness
// never calls a gameplay tool directly.
export function createSpeechAdapter({ fetchImpl = (...args) => fetch(...args), path = '/api/agent/speech' } = {}) {
  return async function speak({ text, voice, runId, signal }) {
    const timeout = AbortSignal.timeout(30000);
    const response = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, runId }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) {
      let message = 'Speech synthesis failed.';
      try { message = (await response.json()).error || message; } catch { /* keep the generic message */ }
      throw Error(message);
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    return { audio, mime: response.headers.get('Content-Type') || 'audio/wav', bytes: audio.byteLength };
  };
}

export async function agentCapabilities({ fetchImpl = (...args) => fetch(...args), path = '/api/agent/config' } = {}) {
  const response = await fetchImpl(path, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('The local agent backend is unavailable. Start npm run dev.');
  return response.json();
}
