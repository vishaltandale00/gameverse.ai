// @ts-check
// Before building, ask 2-4 quick multiple-choice questions that most change
// the result (art style, view, tone, pace, difficulty). Fast model, strict schema.
import { objects, str, strings, prop } from '../kernel/guards.js';

/** @typedef {import('./types.js').WriterRequest} WriterRequest */
/** @typedef {import('./types.js').WriterReply} WriterReply */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** A writer, or an OpenAI-style client that also takes a model per request. @typedef {{ complete(request: WriterRequest & { model?: string }): Promise<WriterReply> }} QuestionClient */
/** @typedef {{ id: string, question: string, options: string[] }} Question */
export const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question', 'options'], properties: {
    id: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } } } },
};
const SYSTEM = `A player described a game idea. Before the game is generated from it, ask 2-4 short multiple-choice questions whose answers most change the result and that the idea leaves open. Always include one about art style (offer 4 distinct, specific styles that fit the idea, e.g. "crisp 16-bit pixel art", "hand-painted storybook", "bold cel-shaded cartoon", "moody neon pixel art"). No multiplayer options. 3-4 options each, each under 6 words, first option = your best guess. Reply as JSON.`;

// Questions follow the idea's decomposition (references, mechanics, spaces), never a genre engine.
/** @param {Decomposition | null} decomposition */
const HINT = decomposition => decomposition
  ? `The idea decomposes into: references ${decomposition.references.map(r => r.name).join(', ') || 'none'}; mechanics ${decomposition.mechanics.map(m => m.description).join('; ')}. Ask about choices those mechanics leave open (pace, difficulty, which game's loop leads, the hero, tone), not about engines.`
  : 'Ask about pace, difficulty, tone and the hero.';

/**
 * Questions for an idea, shaped by its decomposition. `client` is a writer or an OpenAI-style client.
 * @param {QuestionClient} client @param {string | undefined} model @param {string} prompt @param {Decomposition | null} [decomposition]
 * @returns {Promise<{ questions: Question[], ms: number }>}
 */
export async function askQuestions(client, model, prompt, decomposition = null) {
  const reply = await client.complete({ model, system: `${SYSTEM}\n${HINT(decomposition)}`, user: `Game idea: ${prompt}`, schema: { name: 'questions', schema: QUESTIONS_SCHEMA } });
  // Model output: narrowed field by field (malformed questions are dropped, never crash the caller).
  /** @type {unknown} */
  const parsed = JSON.parse(reply.text);
  const questions = objects(prop(parsed, 'questions'));
  return { questions: questions.slice(0, 4).map((q, i) => ({ id: str(q.id) || `q${i}`, question: str(q.question), options: strings(q.options).slice(0, 4) })), ms: reply.ms };
}
