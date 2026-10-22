// @ts-check
// A failed build or change, said to a person (ARCHITECTURE.md §1: a build that fails says what is missing). The gate's
// and the builds' problems carry stable codes, paths and technical messages for the report; a person reads this: one or
// two sentences per distinct reason, in plain words, with the game's own declared goal where the reason is about it
// (ui-defaults.js objectiveOf: the loop ends' `says`). Every code the gate and the builds emit is said here or by the
// generic sentence; the technical detail stays in the report (tests/v2-explain.test.js).
import { objectiveOf } from '../primitives/graphics/ui-defaults.js';

/** @typedef {{ code?: unknown, path?: unknown, message?: unknown, severity?: unknown, use?: unknown, verb?: unknown, cause?: unknown }} ProblemLike */

/** A verb as a person reads it: its words, quoted. @param {unknown} verb */
const verbText = verb => `“${String(verb ?? '').replace(/[_.]+/g, ' ').trim()}”`;

/**
 * The reasons a not_playable message lists (verify-adapter viability: '<code>: <message>; <code>: <message>').
 * @param {string} message @returns {Array<{ code: string, message: string }>}
 */
function reasonsOf(message) {
  return message.split(/;\s+(?=[a-z][a-z0-9_]+:)/).map(part => { const m = /^([a-z][a-z0-9_]+):\s*([\s\S]*)$/.exec(part.trim()); return m ? { code: m[1], message: m[2] } : { code: '', message: part }; });
}

/** @param {string} code @param {ProblemLike & { message?: unknown }} p @param {{ goal: string }} ctx @returns {string} */
function sentence(code, p, { goal }) {
  const message = String(p.message ?? '');
  switch (code) {
    case 'no_progress': return `Playing it, nobody got any closer to the goal${goal ? ` (${goal})` : ''}: something in the game stops progress.`;
    case 'loop_absent': return "Playing it, the game's main action never happened.";
    case 'loop_undeclared': case 'not_played': return 'There is nothing to play in it yet.';
    case 'plot_uncompletable': return 'Its story cannot reach an ending.';
    case 'cannot_act': case 'stuck_state': case 'softlock': return 'The player gets stuck with nothing left to do.';
    case 'bot_failed': case 'runtime_error': case 'verify_threw': case 'install_threw': return 'The game crashed while it was being played.';
    case 'trivially_won': return 'It is won without doing anything.';
    case 'instant_loss': return 'It is lost before you can do anything.';
    case 'nondeterministic': return 'It plays differently each time with the same inputs.';
    case 'feature_inert': return `Pressing ${verbText(p.verb ?? /pressing '([^']+)'/.exec(message)?.[1])} does nothing in this game.`;
    case 'feature_uncontrolled': case 'controls_missing': return `There is no key or button for ${verbText(p.verb ?? /issues '([^' ]+)/.exec(message)?.[1])}.`;
    case 'feature_missing': case 'feature_content_empty': return 'A part of the game does not load.';
    case 'feature_participant_absent': return 'Someone the game needs (a rival, a team, a racer) is not in it.';
    case 'option_uncontrolled': return 'The game offers a choice there is no way to make.';
    case 'render_missing': case 'shows_undeclared': return 'Something you need to see is not drawn.';
    case 'extension_missing': { const m = /"([^"]+)"/.exec(message); return `This game cannot have ${m ? `“${m[1]}”` : 'that'} yet: nothing in the engine does it.`; }
    case 'extension_unusable': return 'What was added to the game has no control a person can use.';
    case 'extension_unengaged': return 'What was added to the game is not connected to it.';
    case 'feature_regressed': return 'After the change, something that worked before stopped working.';
    case 'bot_regressed': case 'bot_unproven': return 'After the change, the game can no longer be won the way it could before.';
    case 'tune_out_of_range': return 'That setting goes outside the range this kind of game stays playable in.';
    case 'preflight_failed': case 'revision_invalid': return 'The change made the game’s description invalid.';
    case 'composition_failed': case 'loop_problem': return 'The parts of the game do not fit together.';
    case 'budget_limited': return 'Checking it took longer than allowed.';
    case 'step_path_timeout': return 'Building it took longer than its time limit.';
    default: return '';
  }
}

/**
 * Plain sentences for a failure's problems, most important first, each reason once.
 * @param {readonly ProblemLike[]} problems @param {{ doc?: unknown, registry?: any }} [ctx]
 * @returns {string}
 */
export function explainProblems(problems, { doc = null, registry = null } = {}) {
  let goal = '';
  try { goal = doc && registry ? objectiveOf(doc, registry).win[0] ?? '' : ''; } catch { goal = ''; }
  /** @type {string[]} */
  const out = [];
  const add = (/** @type {string} */ s) => { if (s && !out.includes(s)) out.push(s); };
  for (const p of problems) {
    const code = String(p.code ?? '');
    if (code === 'not_playable') {
      const said = reasonsOf(String(p.message ?? '')).map(r => sentence(r.code, { ...p, message: r.message }, { goal })).filter(Boolean);
      for (const x of said.length ? said : ['Playing it, the checks could not play it through.']) add(x);
    }
    else add(sentence(code, p, { goal }) || sentence(String(p.cause ?? ''), p, { goal }));
  }
  return (out.length ? out.slice(0, 3) : ['It did not pass the checks.']).join(' ');
}
