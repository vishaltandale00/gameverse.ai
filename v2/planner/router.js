// Genre router: picks the engine for an idea. The arcade engine (side-view
// platformer, top-down action) is one option; each genre kit is another.
// When nothing fits, the router says which kit the idea needs instead of
// forcing it into the wrong genre (the "Mortal Kombat became a top-down shooter" failure).
import { availableKits } from '../kits/registry.js';

export const ARCADE = { id: 'arcade', summary: 'Side-scrolling platformer or top-down action: run, jump, stomp, shoot, collect, reach the goal.', examples: ['Super Mario Bros', 'Sonic', 'Celeste', 'Mega Man', 'Zelda-like top-down action'] };
// Kits on the roadmap but not built yet, so the router can name the gap precisely.
export const PLANNED = {
  shmup: 'Shoot \'em up (Space Invaders, Galaga, Geometry Wars)', puzzle: 'Block and match puzzle (Tetris, Bejeweled, Candy Crush)', physics: 'Physics toy (Breakout, Peggle, Angry Birds, Pinball)',
  runner: 'Endless runner (Temple Run, Flappy Bird, Doodle Jump)', fighting: 'Fighting (Street Fighter, Mortal Kombat, Smash Bros)', brawler: 'Beat \'em up and run-and-gun (Streets of Rage, Metal Slug)',
  metroidvania: 'Metroidvania (Hollow Knight, Metroid, Castlevania)', creature: 'Creature collector RPG (Pokémon)', rpg: 'Party RPG and JRPG (Final Fantasy, Undertale)',
  roguelike: 'Roguelike and action RPG (Spelunky, Isaac, Hades, Diablo)', tactics: 'Tactics, tower defense, light strategy (XCOM, Plants vs. Zombies, StarCraft-lite)', cards: 'Cards and deckbuilders (Slay the Spire, Hearthstone)',
  sandbox: 'Sandbox and life sim (Terraria, Stardew Valley, Animal Crossing)', racing: 'Racing (Mario Kart, Out Run)', rhythm: 'Rhythm (Guitar Hero, DDR)', sports: 'Sports (Wii Sports, NBA Jam, Rocket League 2D)',
  puzzleadventure: 'Puzzle adventure (Braid, Portal 2D, Baba Is You)', action3d: '3D action (Halo, GTA, Minecraft, Mario 64)',
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

export async function routeIdea({ client, model, prompt, answers }) {
  const started = performance.now();
  const options = await routeOptions();
  if (!client) return { ...routeOffline(prompt, options), ms: 0, source: 'offline' };
  try {
    const user = `Idea: ${prompt}${answers?.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}`;
    const reply = await client.complete({ model, system: routePrompt(options), user, schema: { name: 'route', schema: routeSchema(options) } });
    return { ...JSON.parse(reply.text), ms: Math.round(performance.now() - started), source: reply.model };
  } catch (error) {
    return { ...routeOffline(prompt, options), ms: Math.round(performance.now() - started), source: 'offline', error: String(error.message).slice(0, 120) };
  }
}
