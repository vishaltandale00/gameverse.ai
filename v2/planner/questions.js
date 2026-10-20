// Before building, ask 2-4 quick multiple-choice questions that most change
// the result (art style, view, tone, pace, difficulty). Fast model, strict schema.
export const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question', 'options'], properties: {
    id: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } } } },
};
const SYSTEM = `A player described a game idea. Before a 2D action game is generated from it, ask 2-4 short multiple-choice questions whose answers most change the result and that the idea leaves open. Always include one about art style (offer 4 distinct, specific styles that fit the idea, e.g. "crisp 16-bit pixel art", "hand-painted storybook", "bold cel-shaded cartoon", "moody neon pixel art"). Other good topics: side-scrolling vs top-down (only if unclear; these are the only two views), tone, pace/feel, difficulty, the player character. Only offer options this engine can build: single-player 2D action games with running, jumping or top-down movement, enemies, pickups, hazards, shooting, health and timers. No isometric, multiplayer, permadeath or turn-based options. 3-4 options each, each under 6 words, first option = your best guess. Reply as JSON.`;

export async function askQuestions(client, model, prompt) {
  const reply = await client.complete({ model, system: SYSTEM, user: `Game idea: ${prompt}`, schema: { name: 'questions', schema: QUESTIONS_SCHEMA } });
  const { questions } = JSON.parse(reply.text);
  return { questions: questions.slice(0, 4).map((q, i) => ({ id: q.id || `q${i}`, question: q.question, options: q.options.slice(0, 4) })), ms: reply.ms };
}
