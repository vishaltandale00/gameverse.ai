// Genre router: picks the engine for an idea. The arcade engine (side-view
// platformer, top-down action) is one option; each genre kit is another.
// When nothing fits, the router says which kit the idea needs instead of
// forcing it into the wrong genre (the "Mortal Kombat became a top-down shooter" failure).
import { availableKits } from '../kits/registry.js';

export const ARCADE = { id: 'arcade', summary: 'Side-scrolling platformer or top-down action: run, jump, stomp, shoot, collect, reach the goal.', examples: ['Super Mario Bros', 'Sonic', 'Celeste', 'Mega Man', 'Zelda-like top-down action'] };
// Kits on the roadmap but not built yet, so the router can name the gap precisely.
export const PLANNED = {
  maze: 'Maze and grid arcade: move through a grid maze eating pellets while ghosts chase you, or drop bombs on a grid (Pac-Man, Ms. Pac-Man, Bomberman, Dig Dug, Frogger).',
  shmup: 'Shoot \'em up: pilot a ship and shoot waves of enemies and bullet patterns (Space Invaders, Galaga, Asteroids, Geometry Wars).',
  puzzle: 'Block and match puzzle: falling blocks, line clears, match-3 swaps, sliding tiles (Tetris, Bejeweled, Candy Crush, 2048).',
  physics: 'Physics toy: launch, bounce or fling things with real physics; slingshot projectiles into toppling structures, paddles and balls, pegs, pinball (Angry Birds, Breakout, Peggle, Pinball).',
  runner: 'Endless runner and one-touch: auto-running or flapping, dodge obstacles, chase distance and score (Temple Run, Subway Surfers, Flappy Bird, Doodle Jump).',
  fighting: 'Fighting: one-on-one duels with health bars, combos and special moves, rounds (Street Fighter, Mortal Kombat, Tekken, Smash Bros).',
  brawler: 'Beat \'em up and run-and-gun: walk through stages punching crowds of thugs or shooting soldiers (Streets of Rage, Final Fight, Metal Slug, Contra).',
  metroidvania: 'Metroidvania: one big connected map, new abilities open old areas, melee combat, bosses (Hollow Knight, Metroid, Castlevania).',
  creature: 'Creature collector RPG: catch creatures, train a party, turn-based typed battles, gyms (Pokémon).',
  rpg: 'Party RPG and JRPG: towns, dungeons, turn-based party battles, story (Final Fantasy, Dragon Quest, Undertale).',
  roguelike: 'Roguelike and action RPG: procedural floors, loot and item synergies, permadeath runs (Spelunky, Binding of Isaac, Hades, Diablo).',
  tactics: 'Tactics, tower defense and light strategy: grid turns with cover, towers against waves, gather-and-build (XCOM, Fire Emblem, Plants vs. Zombies, StarCraft-lite).',
  cards: 'Cards and deckbuilders: build a deck, play hands against enemies or opponents (Slay the Spire, Hearthstone, Solitaire).',
  sandbox: 'Sandbox and life sim: mine, build, craft, farm, befriend villagers on your own schedule (Terraria, Stardew Valley, Animal Crossing).',
  racing: 'Racing: drive or kart around tracks against rivals, drifting and items (Mario Kart, Out Run, F-Zero).',
  rhythm: 'Rhythm: hit notes in time with music (Guitar Hero, DDR, Osu!).',
  sports: 'Sports: ball games and matches (Wii Sports, NBA Jam, Rocket League, FIFA).',
  puzzleadventure: 'Puzzle adventure: rules-as-puzzles, time rewind, push blocks, point-and-click (Braid, Portal, Baba Is You, Monkey Island).',
  action3d: '3D action and open worlds: drive and fight across a 3D city or world, first- or third-person (GTA, Halo, Minecraft, Zelda: Breath of the Wild, Mario 64).',
};

export async function routeOptions() {
  const kits = await availableKits();
  return [ARCADE, ...kits.map(({ id, kit }) => ({ id, summary: kit.summary, examples: kit.examples || [] }))];
}

export function routeSchema(options) {
  return {
    type: 'object', additionalProperties: false, required: ['engine', 'needs', 'why'],
    properties: {
      engine: { type: 'string', enum: [...options.map(o => o.id), 'none'] },
      needs: { type: 'string', enum: ['none', ...Object.keys(PLANNED).filter(k => !options.some(o => o.id === k))] },
      why: { type: 'string' },
    },
  };
}

export function routePrompt(options) {
  return `Pick the game engine that can make the player's idea as a real game of its genre, with that genre's defining mechanics.
Engines:
${options.map(o => `- ${o.id}: ${o.summary} Reference games: ${o.examples.join(', ')}.`).join('\n')}

Rules:
- Choose by the core gameplay loop the idea asks for, not its theme. A mashup ("Pokémon with Mario") is the genre of the game whose mechanics it keeps (Pokémon: creature collector), themed with the other.
- If no engine plays that genre properly, answer engine "none" and set needs to the missing genre. Never pick an engine that would turn the idea into a different genre (a fighting game is not a platformer).
- If an engine fits, needs is "none".
- why: one short sentence.`;
}

/** Keyword fallback when no model is available. */
export function routeOffline(prompt, options) {
  const text = prompt.toLowerCase();
  for (const o of options) if (o.id !== 'arcade' && o.examples.some(e => text.includes(e.toLowerCase().split(/[ (]/)[0]))) return { engine: o.id, needs: 'none', why: 'matched a reference game' };
  return { engine: 'arcade', needs: 'none', why: 'default engine' };
}

/** The genres the decision model chooses between: every engine, built or planned, described by its mechanics. */
async function routeCriteria() {
  const options = await routeOptions();
  const built = Object.fromEntries(options.map(o => [o.id, o.id === 'arcade'
    ? 'Linear level-based action: a side-scrolling platformer (run, jump, stomp enemies, reach the flag) or simple top-down action, with no fighting-game duels, no turn-based battles, no creature catching and no open map exploration.'
    : `${o.summary} Reference games: ${o.examples.join(', ')}.`]));
  return { options, criteria: { ...PLANNED, ...built } };
}
const ROUTE_INSTRUCTIONS = "Which genre engine plays the core gameplay loop this idea asks for? Judge by the mechanics of the game being referenced, never by the characters named: characters from one franchise dropped into another game keep that other game's genre (Mario in Mortal Kombat is a fighting game; Mario in Pokémon is a creature collector).";
export const DECISION_CONFIDENT = 0.5;

/**
 * Route an idea. A decision model (d1 or OpenAI Decisions) decides in ~0.1 s; below DECISION_CONFIDENT
 * the generative model router decides (a cascade).
 * Returns { engine, needs, why, ms, source, probability? }.
 */
export async function routeIdea({ client, model, decisions = null, prompt, answers }) {
  const started = performance.now();
  if (decisions) {
    try {
      const { options, criteria } = await routeCriteria();
      const { answers: a, provider } = await decisions.decide({ state: `A player asked for this game: "${prompt}"${answers?.length ? ` (preferences: ${answers.map(x => `${x.question} ${x.answer}`).join('; ')})` : ''}`, questions: { engine: { type: 'choice', instructions: ROUTE_INSTRUCTIONS, criteria } } });
      const choice = a.engine.choice, probability = a.engine.probabilities?.[choice] ?? 0;
      if (probability >= DECISION_CONFIDENT) {
        const built = options.some(o => o.id === choice);
        const top = Object.entries(a.engine.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(', ');
        return { engine: built ? choice : 'none', needs: built ? 'none' : choice, why: `${provider}: ${top}`, probability, ms: Math.round(performance.now() - started), source: provider };
      }
    } catch { /* fall through to the model router */ }
  }
  const options = await routeOptions();
  if (!client) return { ...routeOffline(prompt, options), ms: Math.round(performance.now() - started), source: 'offline' };
  try {
    const user = `Idea: ${prompt}${answers?.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}`;
    const reply = await client.complete({ model, system: routePrompt(options), user, schema: { name: 'route', schema: routeSchema(options) } });
    return { ...JSON.parse(reply.text), ms: Math.round(performance.now() - started), source: reply.model };
  } catch (error) {
    return { ...routeOffline(prompt, options), ms: Math.round(performance.now() - started), source: 'offline', error: String(error.message).slice(0, 120) };
  }
}
