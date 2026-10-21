// gameplay.rewind: hold a verb to run time backwards (Braid, Prince of
// Persia, racing rewinds). A bounded history of the world is sampled into
// state: entities (with spawn/despawn undone), chosen vars and flags, and
// optionally cell edits. Per-entity time rules: entities tagged immune
// (components.time.rule = 'immune', or listed) keep their own timeline; an
// optional echo replays the player's undone movement forward after the rewind
// (Braid's shadow). Charges and a cooldown limit use.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { err, runBound, matchesAny, sortedEntities, has } from './modes-lib-util.js';

const ID = 'gameplay.rewind';

export default {
  id: ID,
  card: {
    loop: { verbs: ['rewind'], progress: ['rewind_start'] },
    intent: 'Time rewind: hold rewind to step the world back through a bounded history (positions, components, spawns, vars, flags, cell edits), with per-entity immunity, a shadow echo that replays undone movement, charges and cooldowns.',
    views: ['any'],
    params: {
      maxSec: { type: 'number', default: 10, min: 0.5, max: 120, unit: 's', effect: 'history length' },
      sampleEvery: { type: 'integer', default: 2, min: 1, max: 60, unit: 'frames' },
      speed: { type: 'integer', default: 1, min: 1, max: 16, effect: 'samples undone per step while rewinding (1 = sampleEvery x real time)' },
      vars: { type: 'list', of: { type: 'string' }, default: ['*'], effect: "vars restored on rewind ('*' = all)" },
      flags: { type: 'boolean', default: true },
      cells: { type: 'boolean', default: false, effect: 'undo cell edits (editCells spaces)' },
      immune: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [], effect: 'ids/archetypes/tags that ignore rewinds (also components.time.rule = immune)' },
      echo: { type: 'ref', to: 'archetype', effect: 'after a rewind, spawn this to replay the undone player movement' },
      charges: { type: 'integer', default: 0, min: 0, max: 999, effect: 'rewinds allowed (0 = unlimited)' },
      cooldownSec: { type: 'number', default: 0, min: 0, max: 600, unit: 's' },
      onStart: { type: 'effects', default: [] }, onEnd: { type: 'effects', default: [] },
    },
    provides: { events: ['rewind_start', 'rewind_end', 'rewind_empty', 'echo_spawned', 'echo_done'], vars: ['rewind.sec', 'rewind.charges', 'rewind.active'], actions: ['rewind'] },
    requires: {},
    reads: [],
    components: { time: { type: 'object', effect: 'how this entity takes a rewind', fields: { rule: { type: 'string', options: ['immune'], effect: 'immune: keeps its own timeline through rewinds' } } } },
    rules: {
      rewind_speed: { fields: ['speed', 'maxSec', 'sampleEvery'], message: 'speed is at most the history length in samples, maxSec × 60 / sampleEvery', example: { maxSec: 0.5, sampleEvery: 60 } },
      rewind_vars: { fields: ['vars'], message: "vars is ['*'] (every var) or a list of var names without '*'", example: { vars: ['*', 'score'] } },
    },
  },
  validate(config) {
    const errors = [];
    if (config.speed > config.maxSec * 60 / config.sampleEvery) errors.push(err('rewind_speed', 'with.speed', 'speed would empty the whole history in one step'));
    if (config.vars.includes('*') && config.vars.length > 1) errors.push(err('rewind_vars', 'with.vars', "'*' already restores every var"));
    return errors;
  },
  install(rt, config) {
    const cap = Math.ceil(config.maxSec * 60 / config.sampleEvery), CD = Math.round(config.cooldownSec * 60);
    const st = () => { const s = rt.store(ID); s.hist ??= []; s.cd ??= 0; s.used ??= 0; return s; };
    const immune = e => e.components.time?.rule === 'immune' || e.components.echo || matchesAny(e, config.immune);
    const pickVars = () => config.vars.includes('*') ? structuredClone(rt.state.vars) : Object.fromEntries(config.vars.filter(v => v in rt.state.vars).map(v => [v, rt.state.vars[v]]));
    const logOf = () => { try { const api = rt.space(); return has(api, 'editLog') ? api.editLog() : null; } catch { return null; } };
    rt.action('rewind', () => {}); // input is read in the late system (held or pressed)

    function record(s) {
      const ents = {};
      for (const e of sortedEntities(rt)) if (!immune(e)) ents[e.id] = structuredClone(e);
      const sample = { f: rt.state.frame, ents, vars: pickVars(), flags: config.flags ? structuredClone(rt.state.flags) : null };
      if (config.cells) { const log = logOf(); if (log) { sample.edits = log.slice(s.logAt ?? 0).map(x => ({ at: x.at, from: x.from })); s.logAt = log.length; } }
      s.hist.push(sample); if (s.hist.length > cap) s.hist.shift();
    }
    function apply(s, sample) {
      for (const e of sortedEntities(rt)) if (!immune(e) && !sample.ents[e.id]) rt.despawn(e.id);
      for (const [id, snap] of Object.entries(sample.ents)) {
        const cur = rt.state.entities[id];
        if (!cur) { rt.state.entities[id] = structuredClone(snap); continue; }
        cur.components = structuredClone(snap.components);
        if (cur.space !== snap.space) rt.moveToSpace(cur, snap.space, structuredClone(snap.at));
        else if (JSON.stringify(cur.at) !== JSON.stringify(snap.at)) { try { rt.space(cur.space).setPos(cur, structuredClone(snap.at), rt); } catch { cur.at = structuredClone(snap.at); } }
      }
      if (config.vars.includes('*')) { for (const k of Object.keys(rt.state.vars)) if (!k.startsWith('rewind.')) delete rt.state.vars[k]; Object.assign(rt.state.vars, structuredClone(sample.vars)); }
      else Object.assign(rt.state.vars, structuredClone(sample.vars));
      if (sample.flags) { for (const k of Object.keys(rt.state.flags)) delete rt.state.flags[k]; Object.assign(rt.state.flags, structuredClone(sample.flags)); }
    }
    function undoEdits(s, sample) {
      if (!config.cells || !sample.edits?.length) return;
      const api = rt.space();
      for (const x of sample.edits.slice().reverse()) api.setCell(x.at, x.from, rt, 'rewind');
      s.logAt = logOf()?.length ?? s.logAt; // our own undo edits are not history
    }

    rt.system('late', rt => {
      const s = st(), input = rt.input || {}, want = Boolean(input.held?.rewind || input.actions?.rewind);
      if (s.cd > 0) s.cd--;
      // Echo: replay the undone path forward.
      if (s.echo) {
        const e = rt.entity(s.echo.id);
        if (!e || s.echo.i >= s.echo.path.length) { if (e) rt.despawn(e.id); rt.emit('echo_done', {}); s.echo = null; }
        else { if (rt.state.frame % config.sampleEvery === 0) { const p = s.echo.path[s.echo.i++]; try { rt.space(e.space).setPos(e, structuredClone(p), rt); } catch { e.at = p; } } }
      }
      const can = s.active || ((!config.charges || s.used < config.charges) && s.cd === 0);
      if (want && can && s.hist.length) {
        if (!s.active) { s.active = true; s.undone = []; s.used++; rt.emit('rewind_start', { charges: config.charges ? config.charges - s.used : null }); runBound(rt, config.onStart, { actor: 'player' }); }
        let sample = null;
        for (let k = 0; k < config.speed && s.hist.length; k++) {
          sample = s.hist.pop();
          const p = rt.player(); if (p && Array.isArray(p.at)) s.undone.push(structuredClone(p.at));
          undoEdits(s, sample);
        }
        if (sample) apply(s, sample);
        if (!s.hist.length) rt.emit('rewind_empty', {});
      } else {
        if (want && !s.hist.length && !s.active) rt.emit('rewind_empty', {});
        if (s.active) {
          s.active = false; s.cd = CD;
          rt.emit('rewind_end', { sec: +(s.undone.length * config.sampleEvery / 60).toFixed(3) });
          runBound(rt, config.onEnd, { actor: 'player' });
          if (config.echo && s.undone.length > 1) {
            if (s.echo && rt.entity(s.echo.id)) rt.despawn(s.echo.id);
            const p = rt.player(), path = s.undone.slice().reverse();
            const e = rt.spawn(config.echo, { space: p?.space, at: structuredClone(path[0]), components: { echo: { of: 'player' } } });
            s.echo = { id: e.id, path, i: 0 }; rt.emit('echo_spawned', { id: e.id, steps: path.length });
          }
          s.undone = [];
        }
        if (rt.state.frame % config.sampleEvery === 0) record(s);
      }
      rt.state.vars['rewind.sec'] = +(s.hist.length * config.sampleEvery / 60).toFixed(3);
      rt.state.vars['rewind.active'] = s.active ? 1 : 0;
      rt.state.vars['rewind.charges'] = config.charges ? config.charges - s.used : 0;
    }, ID);
  },
};
