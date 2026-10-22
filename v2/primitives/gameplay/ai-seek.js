// gameplay.ai.seek: drives the AI-controlled participants of every loop of the document that declares a target
// service (card.loop.targets / card.mode.targets; kernel/types.d.ts TargetService): each step it asks the service
// for its participants and where each should go now (a position, a zone or an entity: a race's next checkpoint, the
// ball) and writes a movement intent toward it (moveTo, by 'ai'), executed by the movement primitive that owns the
// entity or the shared AI locomotion (ai-lib.js). Nothing here knows a loop: what to go for is the loop's declaration.
// A participant with no target (a countdown, a kickoff, finished), or no longer a participant, gets its intent cleared.
import { r6, ensureLocomotion, dead } from './ai-lib.js';

const ID = 'gameplay.ai.seek';

/** The target services the document's loops declare (card.loop.targets / card.mode.targets), in document order. */
const servicesOf = rt => [...new Set((rt.doc.systems || []).map(s => {
  const card = rt.registry?.get(s.use)?.card;
  return card?.loop?.targets ?? card?.mode?.targets;
}).filter(n => typeof n === 'string'))];

export default {
  id: ID,
  card: {
    // It moves the AI participants of loops that declare a target service toward the target each is given.
    drives: { control: 'ai', targets: true, movement: true },
    intent: "Steers the AI-controlled participants of every loop that declares a target service (a race's rivals to their next checkpoint, a sports team to the ball) toward the target the loop gives each, through movement intents.",
    views: ['any'],
    params: {
      speed: { type: 'number', default: 4, min: 0, max: 500, unit: 'space units/s', effect: 'how fast driven participants move toward their target' },
    },
    provides: { events: [] },
    requires: { capabilities: ['position'] },
    reads: [],
  },
  install(rt, config) {
    ensureLocomotion(rt);
    const names = servicesOf(rt);
    rt.system('ai', rt => {
      const s = rt.store(ID), last = s.driven || [];
      /** @type {string[]} */
      const now = [];
      for (const name of names) {
        if (!rt.hasService(name)) continue;
        const svc = rt.service(name);
        for (const id of svc.participants()) {
          const e = rt.entity(id);
          if (!e || id === 'player' || now.includes(id) || dead(e)) continue;
          now.push(id);
          const t = svc.target(id);
          const at = t?.at ?? (t?.entity ? rt.entity(t.entity)?.at : undefined);
          if (!t || (at == null && !t.zone)) { if (e.components.moveTo?.by === 'ai') delete e.components.moveTo; continue; }
          delete e.components.steer;
          e.components.moveTo = { at: Array.isArray(at) ? r6(at) : at ?? null, zone: at == null ? t.zone : null, run: false, speed: config.speed, by: 'ai' };
        }
      }
      // Participants it drove that left every service (finished, removed) stop.
      for (const id of last) if (!now.includes(id)) { const e = rt.entity(id); if (e?.components.moveTo?.by === 'ai') delete e.components.moveTo; }
      s.driven = now;
    }, ID);
  },
};
