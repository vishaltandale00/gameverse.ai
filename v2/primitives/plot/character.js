// Named characters. Each plot.characters entry becomes an entity whose id is
// the character id (KERNEL_API §2), bound to its archetype, model, home zone,
// schedule (components.schedule, consumed by gameplay.ai.schedule) and faction.
// The player talks to characters in range with the `talk` verb: that marks
// them met, opens their first dialogue whose `when` holds (plot.dialogue) and
// emits `talked` + `talked:<id>`. Liveness is tracked here (`alive`, `set_alive`)
// and by the entity's health component.
import { cached, zoneIndex, err, checkPred, checkRef, checkKeys, entityAlive, entityDistance, service } from './story-lib.js';

const ID = 'plot.character';
const FIELDS = ['id', 'name', 'role', 'archetype', 'model', 'home', 'faction', 'bio', 'dialogue', 'schedule', 'shop', 'tags', 'at', 'space', 'spawn', 'player', 'components'];

/** The character that is the player: `player: true`, a role starting with "player", or the player's archetype. */
export const isPlayerCharacter = (c, doc) => c.player === true || /^player\b/i.test(c.role || '') || (c.archetype && c.archetype === doc.player?.archetype && c.player !== false);
const characters = rt => cached(rt, 'plot.character.index', doc => new Map((doc.plot?.characters || []).map(c => [c.id, c])));
const st = rt => { const s = rt.store(ID); s.met ??= {}; s.dead ??= {}; s.spawned ??= {}; return s; };

function alive(rt, id) {
  const c = characters(rt).get(id);
  if (!c) return entityAlive(rt.entity(id));
  if (isPlayerCharacter(c, rt.doc)) return entityAlive(rt.player());
  const s = st(rt);
  if (s.dead[id]) return false;
  const e = rt.entity(id);
  return e ? entityAlive(e) : !s.spawned[id]; // never spawned (spawn:false) counts as alive until killed
}

function spawnCharacter(rt, c, config) {
  if (isPlayerCharacter(c, rt.doc) || c.spawn === false) return null;
  // Another primitive (a room generator placing an NPC, a spawner, a boss) may already have created the
  // entity under the character's id: adopt it, so spawn order between primitives never matters.
  const existing = rt.entity(c.id);
  if (existing) {
    existing.components.character ??= { id: c.id, name: c.name, role: c.role ?? null, faction: c.faction ?? null, home: c.home ?? null };
    if (c.model && !existing.components.model) existing.components.model = c.model;
    if (c.schedule && !existing.components.schedule) existing.components.schedule = structuredClone(c.schedule);
    for (const [k, v] of Object.entries(c.components || {})) existing.components[k] ??= structuredClone(v);
    st(rt).spawned[c.id] = true;
    return existing;
  }
  const archetype = c.archetype || config.defaultArchetype;
  if (!archetype) return null;
  const zi = zoneIndex(rt.doc);
  const space = c.space ?? (c.home && zi.get(c.home)?.space) ?? rt.doc.player?.space ?? rt.doc.spaces?.[0]?.id;
  const components = { ...(c.components || {}), character: { id: c.id, name: c.name, role: c.role ?? null, faction: c.faction ?? null, home: c.home ?? null } };
  if (c.model) components.model = c.model;
  if (c.schedule) components.schedule = structuredClone(c.schedule);
  const e = rt.spawn(archetype, { id: c.id, space, at: c.at ?? null, components });
  if (c.at == null && c.home && zi.get(c.home)?.space === e.space) { try { rt.space(e.space).teleport(e, { zone: c.home }, rt); } catch { /* space without teleport */ } }
  st(rt).spawned[c.id] = true;
  return e;
}

export default {
  id: ID,
  card: {
    intent: 'Named people and creatures from plot.characters: spawned as entities (id = character id) with their archetype, model, home zone and schedule; the player talks to one in range with `talk`, which marks them met, emits talked:<id> and opens their first matching dialogue.',
    views: ['any'],
    params: {
      spawnAtStart: { type: 'boolean', default: true, effect: 'spawn every character (except the player character and spawn:false entries) when the game starts' },
      nameplates: { type: 'boolean', default: true, effect: 'renderers draw names over characters (presentation only)' },
      talkRange: { type: 'number', default: 3, min: 0, max: 1000, unit: 'space units', effect: 'how close the player must be to talk (graph spaces count hops: 0 = same location)' },
      defaultArchetype: { type: 'string', default: '', effect: 'archetype for characters that name none; empty means such characters exist only as dialogue speakers' },
    },
    provides: { events: ['talked', 'talked:*', 'met', 'met:*', 'character_alive', 'character_alive:*'], services: ['character'], actions: ['talk'] },
    reads: ['plot.characters'],
  },
  logic(logic) {
    logic.predicate('met', { refs: p => [['character', p.met]], test: (p, rt) => Boolean(st(rt).met[p.met]) });
    // Also serves gameplay.combat.health's `{alive: who}` form: any entity id resolves through the entity.
    logic.predicate('alive', { test: (p, rt, c) => {
      const who = typeof p.alive === 'string' ? p.alive : p.who;
      if (who === undefined || who === 'player' || who === 'self') return entityAlive(rt.resolve(who, c)) === (p.eq ?? true);
      return alive(rt, who) === (p.eq ?? true);
    }, check: (p, path, errors, ctx) => {
      const who = typeof p.alive === 'string' ? p.alive : p.who;
      if (p.alive !== true && typeof p.alive !== 'string') errors.push(err('predicate_invalid', path, 'alive takes a character/entity id, or true with who'));
      else if (who && who !== 'player' && who !== 'self' && ctx.indexes?.character && !ctx.indexes.character.has(who) && !ctx.indexes.archetype?.has(who)) errors.push(err('ref_unknown', path, `unknown character '${who}'`));
    } });
    logic.effect('set_alive', { refs: e => [['character', e.character]], check: (e, path, errors) => { if (typeof e.alive !== 'boolean') errors.push(err('effect_invalid', `${path}.alive`, 'alive must be true or false')); }, run: (e, rt) => {
      const s = st(rt), c = characters(rt).get(e.character);
      if (!e.alive) { s.dead[e.character] = true; if (rt.entity(e.character) && e.character !== 'player') rt.despawn(e.character); }
      else { delete s.dead[e.character]; if (c && !rt.entity(e.character)) spawnCharacter(rt, { ...c, spawn: true }, rt.caches[`${ID}.config`] || {}); }
      rt.emitTyped('character_alive', e.character, { character: e.character, alive: e.alive });
    } });
  },
  validate(config, doc, ctx) {
    const errors = [], list = doc.plot?.characters;
    if (list === undefined) return errors;
    if (!Array.isArray(list)) return [err('param_type', 'plot.characters', 'must be a list of characters')];
    list.forEach((c, i) => {
      const path = `plot.characters[${i}]`;
      checkKeys(c, FIELDS, path, errors);
      if (typeof c.name !== 'string' || !c.name) errors.push(err('character_invalid', `${path}.name`, 'character needs a name'));
      if (c.archetype !== undefined) checkRef(ctx, 'archetype', c.archetype, `${path}.archetype`, errors);
      if (c.model !== undefined) checkRef(ctx, 'model', c.model, `${path}.model`, errors);
      if (c.home !== undefined) checkRef(ctx, 'zone', c.home, `${path}.home`, errors);
      if (c.space !== undefined) checkRef(ctx, 'space', c.space, `${path}.space`, errors);
      if (c.faction !== undefined) checkRef(ctx, 'faction', c.faction, `${path}.faction`, errors);
      if (c.shop !== undefined) checkRef(ctx, 'shop', c.shop, `${path}.shop`, errors);
      if (c.dialogue !== undefined) {
        if (!Array.isArray(c.dialogue)) errors.push(err('param_type', `${path}.dialogue`, 'must be a list of {when?, id}'));
        else c.dialogue.forEach((d, j) => { checkRef(ctx, 'dialogue', d?.id, `${path}.dialogue[${j}].id`, errors); checkPred(d?.when, `${path}.dialogue[${j}].when`, errors, ctx); });
      }
      if (c.schedule !== undefined) {
        if (!Array.isArray(c.schedule)) errors.push(err('param_type', `${path}.schedule`, 'must be a list of {from, to, zone|at, doing}'));
        else c.schedule.forEach((s, j) => {
          const sp = `${path}.schedule[${j}]`;
          for (const k of ['from', 'to']) if (!(typeof s?.[k] === 'number' && s[k] >= 0 && s[k] <= 24)) errors.push(err('schedule_invalid', `${sp}.${k}`, `${k} must be an hour in [0, 24]`));
          if (s?.zone === undefined && s?.at === undefined) errors.push(err('schedule_invalid', sp, 'schedule entry needs zone or at'));
          if (s?.zone !== undefined) checkRef(ctx, 'zone', s.zone, `${sp}.zone`, errors);
        });
      }
      if (!isPlayerCharacter(c, doc) && c.spawn !== false && config.spawnAtStart && !c.archetype && !config.defaultArchetype) errors.push(err('character_unspawnable', path, `character '${c.id}' has no archetype and no defaultArchetype is set`, 'give it an archetype, set spawn:false, or set defaultArchetype'));
    });
    return errors;
  },
  install(rt, config) {
    st(rt); // create the store at install: UI reads (view/list/known) must never write state
    rt.caches[`${ID}.config`] = config;
    const talk = (id, who = 'player') => {
      const c = characters(rt).get(id), p = rt.resolve(who);
      if (!c || !p || !alive(rt, id)) return false;
      if (!isPlayerCharacter(c, rt.doc)) {
        const e = rt.entity(id);
        if (e) { const d = entityDistance(rt, p, e); if (d === null || d > config.talkRange) return false; }
      }
      const s = st(rt);
      if (!s.met[id]) { s.met[id] = true; rt.emitTyped('met', id, { character: id }); }
      // Dialogue first, so its node conditions see the world as the player walked up to it; then talked:<id>.
      const dlg = api.dialogueFor(id), dialogue = service(rt, 'dialogue');
      if (dlg && dialogue) dialogue.start(dlg, { with: id });
      rt.emitTyped('talked', id, { who: p.id, character: id, dialogue: dlg ?? null });
      return true;
    };
    const api = {
      get: id => characters(rt).get(id) || null,
      ids: () => [...characters(rt).keys()],
      entity: id => rt.entity(id) || null,
      alive: id => alive(rt, id),
      met: id => Boolean(st(rt).met[id]),
      isPlayer: id => { const c = characters(rt).get(id); return Boolean(c && isPlayerCharacter(c, rt.doc)); },
      /** First dialogue entry whose `when` holds. */
      dialogueFor: id => (characters(rt).get(id)?.dialogue || []).find(d => !d.when || rt.test(d.when, { self: id }))?.id ?? null,
      /** Characters the player can talk to right now. */
      inRange(who = 'player') {
        const p = rt.resolve(who); if (!p) return [];
        return [...characters(rt).values()].filter(c => !isPlayerCharacter(c, rt.doc) && rt.entity(c.id) && alive(rt, c.id)).filter(c => { const d = entityDistance(rt, p, rt.entity(c.id)); return d !== null && d <= config.talkRange; }).map(c => c.id);
      },
      talk,
      spawn: id => { const c = characters(rt).get(id); return c ? spawnCharacter(rt, c, config) : null; },
    };
    rt.provide('character', api);
    rt.action('talk', (value, rt) => { if (typeof value === 'string' && !service(rt, 'dialogue')?.active() && !service(rt, 'cutscene')?.playing()) talk(value); });
    rt.options(rt => (service(rt, 'dialogue')?.active() || service(rt, 'cutscene')?.playing() ? [] : api.inRange().map(id => ({ label: `talk ${id}`, actions: { talk: id } }))));
    // Killed in combat: health primitives report deaths by entity id.
    const dead = data => { const id = data?.id ?? data?.who; if (id && characters(rt).has(id) && !isPlayerCharacter(characters(rt).get(id), rt.doc)) st(rt).dead[id] = true; };
    rt.on('died', dead);
    if (config.spawnAtStart && !rt.state.frame) for (const c of characters(rt).values()) if (!st(rt).dead[c.id]) spawnCharacter(rt, c, config);
  },
  extend(rt, config, added) {
    if (!config.spawnAtStart || !added.keys.includes('plot.characters')) return;
    for (const c of characters(rt).values()) if (!st(rt).spawned[c.id] && !st(rt).dead[c.id]) spawnCharacter(rt, c, config);
  },
};
