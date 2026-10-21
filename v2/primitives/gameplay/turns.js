// gameplay.turns: one turn manager for every turn-based game: tactics
// (XCOM: side turns, action points, overwatch, cover-aware hit chance,
// permadeath), initiative games (per-unit order by an initiative stat with a
// roll), and simultaneous-commit games (creature battles, card duels'
// declare/resolve: every unit commits an intent, then intents resolve by
// action priority, unit speed and a seeded tiebreak). Turn phases (upkeep /
// draw / main / end...) run their effects and auto-advance or wait.
//
// Units are entities with components.turns {side, ap?, initiative?, speed?,
// aim?, defense?, actions?: [ids]} or members (id/archetype/tag) of a side.
// Actions are data: cost, range, target kind, hit/crit rolls and effects.
// Effects address participants with who:'target' / 'actor' (bound to ids
// before running, so any vocabulary works, e.g. combat's damage{who}).
// Spatial rules (paths, occupancy, line of sight, cover) are used only when the
// unit's space offers them, so the same primitive runs on a grid, a mesh or
// engine.space.none.
import { compare } from '../../kernel/logic.js';
import { pushModal, popModal, withDefaults, alive, hpOf, matchesAny, sortedEntities, has, spaceOf, dist, clamp, err, runBound, cellKey, bindRoles } from './modes-lib-util.js';

const ID = 'gameplay.turns';
const DEFAULT_SIDES = [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai', members: [] }];
const ACTION_FIELDS = {
  id: { type: 'string', required: true, reserved: ['move', 'overwatch', 'pass'] }, label: { type: 'string' }, cost: { type: 'integer', default: 1, min: 0, max: 99 },
  range: { type: 'number', default: 1, min: 0, max: 1e6 }, minRange: { type: 'number', default: 0, min: 0, max: 1e6 },
  target: { type: 'string', options: ['unit', 'cell', 'self', 'none'], default: 'unit' }, hostile: { type: 'boolean', default: true },
  los: { type: 'boolean', default: true, effect: 'unit targets must be in line of sight when the space has los' },
  endsTurn: { type: 'boolean', default: false }, priority: { type: 'integer', default: 0, min: -10, max: 10 },
  cooldown: { type: 'integer', default: 0, min: 0, max: 99, unit: 'turns' }, uses: { type: 'integer', default: 0, min: 0, max: 999, effect: '0 = unlimited' },
  phase: { type: 'string', effect: 'only legal in this phase' }, when: { type: 'predicate', effect: 'legal when (self = actor)' },
  hit: { type: 'object', fields: { base: { type: 'number', default: 65 }, cover: { type: 'list', of: { type: 'number' }, default: [0, 20, 40] }, optimal: { type: 'number' }, falloff: { type: 'number', default: 0 }, min: { type: 'number', default: 5 }, max: { type: 'number', default: 95 }, flank: { type: 'number', default: 0, effect: 'bonus vs a target with no cover' } } },
  crit: { type: 'object', fields: { chance: { type: 'number', default: 0, min: 0, max: 100 }, flankBonus: { type: 'number', default: 0 } } },
  do: { type: 'effects', default: [], effect: 'always run' }, onHit: { type: 'effects', default: [] }, onCrit: { type: 'effects', default: [], effect: 'run on a crit (in addition to onHit)' }, onMiss: { type: 'effects', default: [] },
  ai: { type: 'number', default: 1, min: 0, max: 100, effect: 'AI preference weight (0 = AI never uses it)' },
};

const SIDE_FIELDS = { id: { type: 'string', required: true }, control: { type: 'string', options: ['player', 'ai', 'external'], default: 'ai' }, members: { type: 'list', of: { type: 'string' }, default: [] }, ai: { type: 'string', options: ['aggressive', 'random', 'pass'], default: 'aggressive' }, ap: { type: 'integer', min: 0, max: 99 } };
const TURN_VERBS = ['turn_act', 'turn_move', 'end_turn', 'next_phase', 'select_unit'];
/** Verbs other modes (cards...) add to the turn modal: registered at their install, read when a battle opens. */
export const modalExtra = rt => [...(rt.caches['gameplay.turns:modal'] ??= new Set())];
export const allowInTurnModal = (rt, verbs) => { const set = (rt.caches['gameplay.turns:modal'] ??= new Set()); for (const v of verbs) set.add(v); };
const PHASE_FIELDS = { id: { type: 'string', required: true }, auto: { type: 'boolean', default: true }, do: { type: 'effects', default: [] } };

export default {
  id: ID,
  card: {
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { turn_act: { type: 'choice', of: 'a unit, its action and the action target', pick: 'unit' }, turn_move: { type: 'choice', of: 'a unit and a cell its move reaches', pick: 'unit' }, select_unit: { type: 'choice', of: 'a unit of the side whose turn it is', selects: 'unit' } },
    loop: { verbs: ['turn_act', 'turn_move', 'end_turn', 'select_unit'], progress: ['unit_moved', 'turn_action', 'attack_hit', 'unit_fallen'],
      // The participants an event names (role -> data field): a hit names the acting unit and the unit it hit.
      involves: { attack_hit: { attacker: 'who', defender: 'target' } },
      // As an encounter: the player-controlled sides win (onVictory) or the last of them is defeated (onDefeat).
      outcome: { sides: ['player', 'opponent'], results: { won: { param: 'onVictory', player: 'keeps', opponent: 'defeated' }, lost: { param: 'onDefeat', player: 'defeated', opponent: 'keeps' } } } },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { turns: { type: 'object', fields: { side: { type: 'string', required: true, effect: 'the sides[] id this unit fights for' }, ap: { type: 'integer', min: 0, max: 20 }, initiative: { type: 'number' }, speed: { type: 'number' }, aim: { type: 'number' }, defense: { type: 'number' }, actions: { type: 'list', of: { type: 'string' }, effect: 'action ids this unit may use (default: all)' } }, effect: 'a unit in turn-based play' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "param", "param": "sides", "min": 2, "why": "turns alternate between at least two sides"},
      {"need": "archetypes", "component": "turns", "min": 2, "placed": 4, "why": "turns are taken by units (pieces): archetypes with a turns component {side}, placed on the board by spawns (at cells when there are no zones), for every side", "example": {"id": "knight", "kind": "npc", "components": {"turns": {"side": "white", "ap": 2}, "health": {"max": 3}}}},
    ],
    // The player's units take turns: the player joins the player-controlled side when no side lists it.
    // As an encounter's inner loop: it waits (autoStart off) and the encounter starts it.
    engage: { join: { param: 'sides', field: 'members', where: { control: 'player' } }, encounter: { start: [{ do: 'start_turns' }], config: { autoStart: false } } },
    // Its AI-controlled sides play themselves (aiStep): their units take the same data-defined actions and moves.
    drives: { control: 'ai', actions: ['turn_act', 'turn_move'], events: ['turn_action', 'attack_hit', 'unit_moved'], movement: true },
    // Tactics mode: the player's side against AI sides, won when one side remains.
    mode: { loop: 'tactics', interaction: 'pieces-turns', opponent: 'ai-side', space: ['engine.space.grid', 'engine.space.none', ['position']], needs: { content: ['content.archetypes'], participants: 'sides' }, win: { param: 'onVictory', reads: { component: 'health', of: 'opponents', by: { actions: ['turn_act'], effects: ['damage'] } } }, lose: { param: 'onDefeat', reads: { component: 'health', of: 'player', by: { effects: ['damage'] } } }, bot: 'turn-board' },
    intent: 'Turn order for any turn-based mode: alternate side or unit turns, initiative order, or simultaneous commit-then-resolve; action points, phases, data-defined actions with range, line of sight, cover-aware hit and crit chance, cooldowns, overwatch reactions, AI sides, downed/bleed-out or permadeath, victory when one side remains. Works on grids, continuous spaces and engine.space.none.',
    views: ['board', 'td', 'iso', 'ui', '3p'],
    params: {
      order: { type: 'string', options: ['alternate', 'initiative', 'simultaneous'], default: 'alternate', effect: 'turn structure' },
      grain: { type: 'string', options: ['side', 'unit'], default: 'side', effect: 'alternate: a whole side acts per turn (XCOM) or one unit per side turn (chess)' },
      sides: { type: 'list', min: 1, default: DEFAULT_SIDES, of: { type: 'object', fields: SIDE_FIELDS }, effect: 'teams; units join by components.turns.side or members (id/archetype/tag)' },
      ap: { type: 'integer', default: 2, min: 0, max: 99, effect: 'action points per unit per turn' },
      actionsPerTurn: { type: 'integer', default: 0, min: 0, max: 99, effect: 'alternate order: actions (moves included) a side or unit takes per turn before the turn passes (chess: 1, any one piece); 0 = until its units spend their AP' },
      movePerAp: { type: 'integer', default: 4, min: 0, max: 64, effect: 'cells (or path cost) moved per action point; 0 disables moving' },
      actions: { type: 'list', default: [{ id: 'attack', range: 6, target: 'unit', hostile: true, hit: { base: 65 }, onHit: [] }], of: { type: 'object', fields: ACTION_FIELDS }, effect: 'data-defined unit actions',
        // An action that wears an opposing unit down (the effect is gameplay.combat.health's): what the win reads changes in play.
        example: [{ id: 'strike', range: 1, target: 'unit', hostile: true, onHit: [{ do: 'damage', who: 'target', amount: 1 }] }] },
      overwatch: { type: 'boolean', default: true, effect: 'units may spend remaining AP to react to enemy movement in sight' },
      overwatchAction: { type: 'string', effect: 'action fired on overwatch (default: first hostile unit action)' },
      overwatchPenalty: { type: 'number', default: 15, min: 0, max: 100, effect: 'aim penalty for reaction shots' },
      hitChance: { type: 'boolean', default: true, effect: 'roll hit/crit; false = actions always hit' },
      phases: { type: 'list', default: [], of: { type: 'object', fields: PHASE_FIELDS }, effect: 'per-turn phases; auto phases run and advance, others wait for next_phase' },
      initiativeRoll: { type: 'integer', default: 0, min: 0, max: 100, effect: 'random 0..n added to initiative each round' },
      permadeath: { type: 'boolean', default: true, effect: 'defeated units are gone for good (else downed and revivable)' },
      bleedout: { type: 'integer', default: 0, min: 0, max: 99, unit: 'rounds', effect: 'downed units die after this many rounds (0 = never) when permadeath is off' },
      despawnFallen: { type: 'boolean', default: false, effect: 'remove fallen units from the world' },
      maxRounds: { type: 'integer', default: 0, min: 0, max: 9999, effect: 'end after this many rounds (0 = no limit)' },
      autoStart: { type: 'boolean', default: true, effect: 'start at game start (otherwise start_turns)' },
      modal: { type: 'boolean', default: true, effect: 'while a battle runs, only turn verbs (and verbs other modes register, e.g. play_card) are accepted' },
      aiDelay: { type: 'integer', default: 0, min: 0, max: 600, unit: 'frames', effect: 'frames between AI decisions (for presentation)' },
      onVictory: { type: 'effects', default: [], effect: 'when a player-controlled side wins' },
      onDefeat: { type: 'effects', default: [], effect: 'when the last player-controlled side is defeated' },
      onRoundLimit: { type: 'effects', default: [], effect: 'when maxRounds is reached' },
    },
    provides: {
      events: ['turns_start', 'turns_over', 'unit_selected', 'round_start', 'round_end', 'turn_start', 'turn_start:*', 'turn_end', 'phase_start', 'phase_start:*', 'unit_moved', 'turn_action', 'turn_action:*', 'attack_hit', 'attack_miss', 'attack_crit', 'overwatch_set', 'overwatch_shot', 'unit_downed', 'unit_revived', 'unit_fallen', 'unit_fallen:*', 'side_defeated', 'side_defeated:*', 'turn_invalid', 'intent_submitted'],
      vars: ['turns.round', 'turns.ap', 'turns.active'],
      services: ['turns'],
      actions: ['turn_act', 'turn_move', 'end_turn', 'next_phase', 'select_unit'],
    },
    requires: {},
    defines: [{ kind: 'turn_action', in: 'actions' }],
    reads: [],
  },
  logic(logic) {
    logic.predicate('turn', {
      check: (p, path, errors) => { if (p.state !== undefined && !['active', 'over'].includes(p.state)) errors.push(err('turn_state', `${path}.state`, 'state must be active|over')); },
      test: (p, rt) => {
        const s = rt.state.prim[ID];
        if (p.state === 'over') return Boolean(s) && !s.active && (s.round ?? 0) > 0 && (p.winner === undefined || s.winner === p.winner);
        if (p.state === 'active') return Boolean(s?.active);
        if (!s?.active) return false;
        if (p.round !== undefined) return compare(s.round, p.round);
        const who = p.turn === true ? 'player' : p.turn;
        const side = s.units[who]?.side;
        if (s.order === 'simultaneous') return s.sides.some(x => x.id === who) || Boolean(side);
        return s.current?.side === who || s.current?.unit === who || (s.grain === 'side' && side && s.current?.side === side);
      },
    });
    const svc = rt => rt.service('turns');
    logic.effect('start_turns', { run: (e, rt) => svc(rt).start() });
    logic.effect('end_turns', { run: (e, rt) => svc(rt).stop(e.winner ?? null) });
    logic.effect('end_turn', { run: (e, rt) => svc(rt).endTurn() });
    logic.effect('grant_ap', { run: (e, rt, c) => { const u = rt.store(ID).units?.[rt.resolve(e.who, c)?.id]; if (u) u.ap = Math.max(0, u.ap + (e.amount ?? 1)); } });
    logic.effect('set_overwatch', { run: (e, rt, c) => { const u = rt.store(ID).units?.[rt.resolve(e.who, c)?.id]; if (u) u.ow = e.on ?? true; } });
  },
  validate(config) {
    const errors = [], sides = new Set(), acts = new Set(), phases = new Set();
    config.sides.forEach((s, i) => { if (sides.has(s.id)) errors.push(err('turns_sides', `with.sides[${i}].id`, `duplicate side '${s.id}'`)); sides.add(s.id); });
    if (config.order !== 'simultaneous' && config.sides.length < 1) errors.push(err('turns_sides', 'with.sides', 'needs at least one side'));
    config.actions.forEach((a, i) => {
      if (acts.has(a.id) || a.id === 'move' || a.id === 'overwatch' || a.id === 'pass') errors.push(err('turns_action', `with.actions[${i}].id`, `action id '${a.id}' is duplicate or reserved (move, overwatch, pass)`));
      acts.add(a.id);
      if (a.minRange > a.range) errors.push(err('turns_action', `with.actions[${i}].minRange`, 'minRange exceeds range'));
      if (a.target !== 'unit' && (a.hit || a.onHit?.length || a.onMiss?.length) && a.target !== 'cell') errors.push(err('turns_action', `with.actions[${i}].hit`, `hit rolls need a unit or cell target, not '${a.target}'`));
    });
    config.phases.forEach((p, i) => { if (phases.has(p.id)) errors.push(err('turns_phase', `with.phases[${i}].id`, `duplicate phase '${p.id}'`)); phases.add(p.id); });
    config.actions.forEach((a, i) => { if (a.phase && !phases.has(a.phase)) errors.push(err('turns_phase', `with.actions[${i}].phase`, `unknown phase '${a.phase}'`)); });
    if (config.overwatchAction && !config.actions.some(a => a.id === config.overwatchAction && a.target === 'unit')) errors.push(err('turns_overwatch', 'with.overwatchAction', `overwatchAction '${config.overwatchAction}' must be a unit-target action`));
    return errors;
  },
  /**
   * Solver progress: units of non-player sides worn down or fallen, minus half the player's own losses
   * (each unit counts 1 when fallen, its lost hp fraction while standing); +100 when a player side won.
   */
  progress(rt, config) {
    const s = rt.state.prim[ID]; if (!s?.units) return 0;
    const ctrl = new Map((config.sides || []).map(x => [x.id, x.control ?? 'ai']));
    let v = 0;
    for (const [id, u] of Object.entries(s.units)) {
      const e = rt.entity(id), h = hpOf(e), lost = u.fallen || !e ? 1 : u.downed ? 0.9 : h.max > 0 ? 1 - h.frac : 0;
      v += ctrl.get(u.side) === 'player' ? -0.5 * lost : lost;
    }
    if (s.winner && ctrl.get(s.winner) === 'player') v += 100;
    return v;
  },
  install(rt, config) {
    config = { ...config, actions: config.actions.map(a => withDefaults(ACTION_FIELDS, a)), sides: config.sides.map(x => withDefaults(SIDE_FIELDS, x)), phases: config.phases.map(x => withDefaults(PHASE_FIELDS, x)) };
    const ACT = new Map(config.actions.map(a => [a.id, a]));
    const SIDE = new Map(config.sides.map(s => [s.id, s]));
    const owAction = ACT.get(config.overwatchAction) || config.actions.find(a => a.target === 'unit' && a.hostile);
    const st = () => { const s = rt.store(ID); s.units ??= {}; s.fallen ??= []; s.order = config.order; s.grain = config.grain; s.sides = config.sides.map(x => ({ id: x.id, control: x.control })); return s; };
    const control = side => SIDE.get(side)?.control ?? 'ai';
    const sideOfEntity = e => e.components.turns?.side ?? config.sides.find(s => matchesAny(e, s.members))?.id ?? null;
    const unitsOf = (s, side) => Object.keys(s.units).sort().filter(id => s.units[id].side === side && live(s, id));
    const live = (s, id) => { const u = s.units[id]; return Boolean(u) && !u.fallen && !u.downed && Boolean(rt.entity(id)); };
    const apMax = (id, side) => rt.entity(id)?.components.turns?.ap ?? SIDE.get(side)?.ap ?? config.ap;
    const allowedFor = (id, a) => { const list = rt.entity(id)?.components.turns?.actions; return !list || list.includes(a.id); };

    // ----- roster -----
    function gather(s) {
      for (const e of sortedEntities(rt)) {
        if (s.units[e.id] || e.components.ghost) continue;
        const side = sideOfEntity(e); if (!side || !SIDE.has(side)) continue;
        s.units[e.id] = { side, ap: 0, apMax: apMax(e.id, side), ow: false, downed: false, fallen: false, bleed: 0, cd: {}, used: {} };
      }
      for (const [id, u] of Object.entries(s.units)) {
        if (u.fallen) continue;
        const e = rt.entity(id);
        if (!e || !alive(e)) {
          if (u.downed) continue;
          if (config.permadeath || !e) fall(s, id, u);
          else { u.downed = true; u.bleed = config.bleedout; u.ap = 0; u.ow = false; rt.emit('unit_downed', { who: id, side: u.side }); }
        } else if (u.downed) { u.downed = false; rt.emit('unit_revived', { who: id, side: u.side }); }
      }
    }
    function fall(s, id, u) {
      u.fallen = true; u.downed = false; u.ap = 0; u.ow = false; s.fallen.push(id);
      rt.state.flags[`fallen.${id}`] = true;
      rt.emitTyped('unit_fallen', rt.entity(id)?.archetype ?? id, { who: id, side: u.side });
      if (config.despawnFallen && rt.entity(id)) rt.despawn(id);
    }
    function checkOver(s) {
      if (!s.active) return true;
      const standing = config.sides.filter(x => unitsOf(s, x.id).length);
      for (const x of config.sides) if (!standing.includes(x) && !s.defeated?.[x.id] && Object.values(s.units).some(u => u.side === x.id)) { (s.defeated ??= {})[x.id] = true; rt.emitTyped('side_defeated', x.id, { side: x.id }); }
      // A battle needs two sides that have fielded units: a side whose units have not arrived yet (spawned after the start) is not beaten.
      const fielded = config.sides.filter(x => Object.values(s.units).some(u => u.side === x.id)).length;
      if (config.sides.length > 1 && standing.length <= 1 && fielded >= 2) { stop(s, standing[0]?.id ?? null); return true; }
      if (config.sides.length === 1 && !standing.length && Object.keys(s.units).length) { stop(s, null); return true; }
      return false;
    }
    function stop(s, winner) {
      if (!s.active) return;
      s.active = false; s.winner = winner; s.current = null;
      if (config.modal) popModal(rt, s, ID);
      rt.emit('turns_over', { winner });
      const playerSides = config.sides.filter(x => x.control === 'player').map(x => x.id);
      if (winner && playerSides.includes(winner)) rt.run(config.onVictory);
      else if (playerSides.length) rt.run(config.onDefeat);
    }

    // ----- turn flow -----
    function start(s) {
      if (s.active) return;
      s.active = true; s.round = 0; s.defeated = {}; s.winner = null; s.ptr = {}; s.decisions = 0;
      if (config.modal) pushModal(rt, s, ID, [...TURN_VERBS, ...modalExtra(rt)], 'battle');
      gather(s);
      rt.emit('turns_start', { sides: config.sides.map(x => x.id), order: config.order });
      roundStart(s);
    }
    function roundStart(s) {
      s.round++;
      rt.emit('round_start', { round: s.round });
      if (config.maxRounds && s.round > config.maxRounds) { rt.run(config.onRoundLimit); stop(s, null); return; }
      if (config.order === 'initiative') {
        const roll = {}; for (const id of Object.keys(s.units).sort()) roll[id] = (rt.entity(id)?.components.turns?.initiative ?? 0) + (config.initiativeRoll ? Math.floor(rt.random() * (config.initiativeRoll + 1)) : 0);
        s.queue = Object.keys(s.units).filter(id => live(s, id)).sort((a, b) => roll[b] - roll[a] || (a < b ? -1 : 1));
        s.qi = 0; beginTurn(s, s.units[s.queue[0]]?.side, s.queue[0]);
      } else if (config.order === 'simultaneous') {
        s.intents = {}; s.current = { side: null, unit: null };
        for (const id of Object.keys(s.units)) if (live(s, id)) refresh(s, id);
        s.phase = 0; enterPhase(s);
        rt.emit('turn_start', { side: null, who: null, round: s.round });
        for (const x of config.sides) if (x.control === 'ai') for (const id of unitsOf(s, x.id)) submit(s, id, aiIntent(s, id));
        // Resolution happens on the next tick (one round per step at most).
      } else { s.si = 0; nextSideTurn(s, true); }
    }
    function nextSideTurn(s, first = false) {
      const n = config.sides.length;
      for (let k = 0; k < n; k++) {
        if (!first || k > 0) s.si++;
        if (s.si >= n) { roundEnd(s); return; }
        const side = config.sides[s.si].id, units = unitsOf(s, side);
        if (!units.length) continue;
        if (config.grain === 'unit') { const p = (s.ptr[side] ?? -1) + 1, unit = units[p % units.length]; s.ptr[side] = p % units.length; beginTurn(s, side, unit); }
        else beginTurn(s, side, null);
        return;
      }
      roundEnd(s);
    }
    function refresh(s, id) {
      const u = s.units[id]; u.apMax = apMax(id, u.side); u.ap = u.apMax; u.ow = false;
      for (const k of Object.keys(u.cd)) if (--u.cd[k] <= 0) delete u.cd[k];
    }
    function beginTurn(s, side, unit) {
      if (!side) { roundEnd(s); return; }
      s.current = { side, unit }; s.decisions = 0; s.acted = 0; s.aiWait = rt.state.frame + 1 + config.aiDelay; s.selected = unit ?? unitsOf(s, side)[0] ?? null;
      for (const id of unit ? [unit] : unitsOf(s, side)) refresh(s, id);
      rt.emitTyped('turn_start', side, { side, who: unit ?? side, round: s.round });
      s.phase = 0; s.autoEnd = false; enterPhase(s);
    }
    function enterPhase(s) {
      for (let guard = 0; guard < config.phases.length + 1; guard++) {
        const ph = config.phases[s.phase]; if (!ph) return;
        rt.emitTyped('phase_start', ph.id, { phase: ph.id, side: s.current?.side ?? null });
        runBound(rt, ph.do, { actor: s.current?.unit ?? s.selected ?? 'player' });
        if (!ph.auto || !s.active) return;
        if (s.phase >= config.phases.length - 1) { if (config.order !== 'simultaneous') s.autoEnd = true; return; }
        s.phase++;
      }
    }
    function nextPhase(s) {
      if (s.phase >= config.phases.length - 1) { endTurn(s); return; }
      s.phase++; enterPhase(s);
    }
    function endTurn(s) {
      if (!s.active || !s.current) return;
      if (config.order === 'simultaneous') { for (const id of Object.keys(s.units)) if (live(s, id) && control(s.units[id].side) === 'player' && !s.intents[id]) submit(s, id, { action: 'pass' }); maybeResolve(s); return; }
      const { side, unit } = s.current;
      for (const id of unit ? [unit] : unitsOf(s, side)) if (s.units[id]) s.units[id].ap = 0;
      rt.emit('turn_end', { side, who: unit ?? side, round: s.round });
      s.current = null;
      if (checkOver(s)) return;
      if (config.order === 'initiative') {
        do s.qi++; while (s.qi < s.queue.length && !live(s, s.queue[s.qi]));
        if (s.qi >= s.queue.length) roundEnd(s); else beginTurn(s, s.units[s.queue[s.qi]].side, s.queue[s.qi]);
      } else nextSideTurn(s);
    }
    function roundEnd(s) {
      rt.emit('round_end', { round: s.round });
      for (const [id, u] of Object.entries(s.units)) if (u.downed && config.bleedout > 0 && --u.bleed <= 0) fall(s, id, u);
      if (checkOver(s)) return;
      roundStart(s);
    }

    // ----- actions -----
    function hitChance(actor, target, a, penalty = 0) {
      if (!a.hit || !config.hitChance) return 100;
      const h = a.hit, A = rt.entity(actor), T = rt.entity(target);
      let c = h.base + (A?.components.turns?.aim ?? 0) - (T?.components.turns?.defense ?? 0) - penalty;
      const cover = coverBetween(A, T);
      c -= h.cover[cover] ?? h.cover[h.cover.length - 1] ?? 0;
      if (cover === 0) c += h.flank;
      if (h.optimal !== undefined) c -= Math.max(0, dist(rt, A, T) - h.optimal) * h.falloff;
      return Math.round(clamp(c, h.min, h.max));
    }
    function coverBetween(A, T) {
      const api = spaceOf(rt, A); if (!A || !T || A.space !== T.space || !Array.isArray(A.at)) return 0;
      if (has(api, 'los')) return api.los(A.at, T.at).cover ?? 0;
      return 0;
    }
    function inSight(A, T) {
      if (!A || !T) return false;
      if (A.space !== T.space) return false;
      const api = spaceOf(rt, A);
      return !has(api, 'los') || !Array.isArray(A.at) || api.los(A.at, T.at).clear;
    }
    const inRange = (A, T, a) => { if (!A || !T) return false; if (!A.space && !T.space) return true; const api = spaceOf(rt, A); if (!has(api, 'distance')) return true; const d = dist(rt, A, T); return d >= a.minRange && d <= a.range; };
    function targetsFor(s, id, a) {
      const A = rt.entity(id), side = s.units[id].side;
      if (a.target === 'unit') return Object.keys(s.units).sort().filter(t => live(s, t) && (a.hostile ? s.units[t].side !== side : s.units[t].side === side) && inRange(A, rt.entity(t), a) && (!a.los || inSight(A, rt.entity(t))));
      if (a.target === 'cell') { const api = spaceOf(rt, A); return has(api, 'cellsInRange') && Array.isArray(A.at) ? api.cellsInRange(A.at, Math.floor(a.range)) : []; }
      return [];
    }
    function legal(s, id) {
      const u = s.units[id]; if (!u || !live(s, id) || !s.active) return [];
      const out = [], ph = config.phases[s.phase]?.id;
      for (const a of config.actions) {
        if (!allowedFor(id, a) || u.ap < a.cost || u.cd[a.id] || (a.uses && (u.used[a.id] ?? 0) >= a.uses) || (a.phase && a.phase !== ph)) continue;
        if (a.when && !rt.test(bindRoles(a.when, { actor: id }), { self: id })) continue;
        const targets = targetsFor(s, id, a);
        if ((a.target === 'unit' || a.target === 'cell') && !targets.length) continue;
        out.push({ id: a.id, label: a.label ?? a.id, cost: a.cost, target: a.target, targets, hit: a.target === 'unit' && a.hit ? Object.fromEntries(targets.map(t => [t, hitChance(id, t, a)])) : undefined });
      }
      if (config.movePerAp > 0 && u.ap > 0 && config.order !== 'simultaneous' && Array.isArray(rt.entity(id)?.at)) out.push({ id: 'move', label: 'move', cost: 1, target: 'cell', targets: [] });
      if (config.overwatch && owAction && u.ap > 0 && !u.ow && config.order !== 'simultaneous') out.push({ id: 'overwatch', label: 'overwatch', cost: u.ap, target: 'none', targets: [] });
      return out;
    }
    const canAct = (s, id) => {
      if (!s.active || !s.units[id]) return false;
      if (config.order === 'simultaneous') return true;
      const c = s.current; return Boolean(c) && (c.unit ? c.unit === id : s.units[id].side === c.side);
    };
    const invalid = (who, action, reason) => { rt.emit('turn_invalid', { who, action, reason }); return false; };
    /** Perform an action now. opts.reaction skips AP/turn checks (overwatch). */
    function act(s, id, intent, opts = {}) {
      const u = s.units[id]; if (!u || !live(s, id)) return invalid(id, intent?.action, 'no_unit');
      if (!opts.reaction && !canAct(s, id)) return invalid(id, intent.action, 'not_your_turn');
      if (intent.action === 'move') return move(s, id, intent.target ?? intent.to);
      if (intent.action === 'overwatch') { if (!config.overwatch || !owAction || u.ap <= 0) return invalid(id, 'overwatch', 'unavailable'); u.ow = true; u.ap = 0; rt.emit('overwatch_set', { who: id }); afterAct(s, id); return true; }
      if (intent.action === 'pass') { u.ap = 0; afterAct(s, id); return true; }
      const a = ACT.get(intent.action); if (!a) return invalid(id, intent.action, 'unknown_action');
      if (!opts.reaction) {
        const l = legal(s, id).find(x => x.id === a.id); if (!l) return invalid(id, a.id, 'not_legal');
        if ((a.target === 'unit' || a.target === 'cell') && !l.targets.some(t => (a.target === 'cell' ? cellKey(t) === cellKey(intent.target ?? []) : t === intent.target))) return invalid(id, a.id, 'bad_target');
        u.ap -= a.cost; if (a.endsTurn) u.ap = 0;
        if (a.cooldown) u.cd[a.id] = a.cooldown + 1;
        if (a.uses) u.used[a.id] = (u.used[a.id] ?? 0) + 1;
      }
      const target = a.target === 'unit' ? intent.target : a.target === 'self' ? id : null;
      const roles = { actor: id, target: target ?? id, owner: id };
      const ctx = a.target === 'cell' ? { cell: intent.target } : {};
      let hit = true, crit = false, chance = 100;
      runBound(rt, a.do, roles, ctx);
      if (a.target === 'unit' || a.target === 'cell') {
        if (a.target === 'unit' && a.hit && config.hitChance) {
          chance = hitChance(id, target, a, opts.penalty ?? 0);
          hit = rt.random() * 100 < chance;
          const critChance = (a.crit?.chance ?? 0) + (coverBetween(rt.entity(id), rt.entity(target)) === 0 ? a.crit?.flankBonus ?? 0 : 0);
          crit = hit && critChance > 0 && rt.random() * 100 < critChance;
        }
        rt.emit(hit ? 'attack_hit' : 'attack_miss', { who: id, target, action: a.id, chance });
        if (crit) rt.emit('attack_crit', { who: id, target, action: a.id });
        if (hit) runBound(rt, a.onHit, roles, ctx); else runBound(rt, a.onMiss, roles, ctx);
        if (crit) runBound(rt, a.onCrit, roles, ctx);
      }
      rt.emitTyped('turn_action', a.id, { who: id, action: a.id, target, hit, crit, chance, reaction: Boolean(opts.reaction) });
      gather(s);
      if (!opts.reaction) afterAct(s, id);
      return true;
    }
    function afterAct(s, id) {
      if (checkOver(s)) return;
      if (config.order === 'simultaneous') return;
      const c = s.current; if (!c) return;
      if (config.actionsPerTurn && ++s.acted >= config.actionsPerTurn) { endTurn(s); return; }
      const acting = c.unit ? [c.unit] : unitsOf(s, c.side);
      if (acting.every(x => (s.units[x]?.ap ?? 0) <= 0)) endTurn(s);
      else if (s.units[s.selected]?.ap <= 0) s.selected = acting.find(x => s.units[x].ap > 0);
    }
    /** The move of unit `id` to `to` this turn: { path, apCost }, or { reason } when it is not legal. The one rule for moving and for the move options. */
    function planMove(s, id, to) {
      const u = s.units[id], e = rt.entity(id), api = spaceOf(rt, e);
      if (!config.movePerAp || u.ap <= 0) return { reason: 'unavailable' };
      if (!Array.isArray(e?.at) || !Array.isArray(to)) return { reason: 'bad_target' };
      let path = has(api, 'path') ? api.path(e.at, to) : [e.at, to];
      if (!path || path.length < 2) return { reason: 'no_path' };
      if (cellKey(path[0]) !== cellKey(e.at)) path = [e.at, ...path];
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        cost += has(api, 'moveCost') ? api.moveCost(path[i - 1], path[i], e) : 1;
        const occ = has(api, 'entitiesAt') ? api.entitiesAt(path[i]).filter(o => o !== id && s.units[o] && live(s, o)) : [];
        if (occ.length) return { reason: 'blocked' };
      }
      const apCost = Math.ceil(cost / config.movePerAp);
      if (apCost > u.ap) return { reason: 'too_far' };
      return { path, apCost };
    }
    function move(s, id, to) {
      const u = s.units[id], e = rt.entity(id), api = spaceOf(rt, e);
      const plan = planMove(s, id, to);
      if (plan.reason) return invalid(id, 'move', plan.reason);
      const { path, apCost } = plan;
      u.ap -= apCost;
      for (let i = 1; i < path.length; i++) {
        api.setPos(e, path[i], rt);
        reactions(s, id);
        if (!live(s, id)) break;
      }
      rt.emit('unit_moved', { who: id, to: e.at, cost: apCost });
      afterAct(s, id);
      return true;
    }
    function reactions(s, mover) {
      if (!config.overwatch || !owAction) return;
      const M = rt.entity(mover);
      for (const id of Object.keys(s.units).sort()) {
        const u = s.units[id];
        if (!u.ow || !live(s, id) || u.side === s.units[mover].side) continue;
        const W = rt.entity(id);
        if (!inRange(W, M, owAction) || (owAction.los && !inSight(W, M))) continue;
        u.ow = false; rt.emit('overwatch_shot', { who: id, target: mover });
        act(s, id, { action: owAction.id, target: mover }, { reaction: true, penalty: config.overwatchPenalty });
        if (!live(s, mover)) return;
      }
    }

    // ----- simultaneous commit/resolve -----
    function submit(s, id, intent) {
      if (!s.units[id] || !live(s, id)) return false;
      s.intents[id] = intent; rt.emit('intent_submitted', { who: id, action: intent.action });
      return true;
    }
    function maybeResolve(s) {
      if (!s.active || config.order !== 'simultaneous') return;
      const waiting = Object.keys(s.units).filter(id => live(s, id) && !s.intents[id]);
      if (waiting.length) return;
      const tiebreak = {}; for (const id of Object.keys(s.intents).sort()) tiebreak[id] = rt.random();
      const order = Object.keys(s.intents).sort((a, b) => (ACT.get(s.intents[b].action)?.priority ?? 0) - (ACT.get(s.intents[a].action)?.priority ?? 0)
        || (rt.entity(b)?.components.turns?.speed ?? 0) - (rt.entity(a)?.components.turns?.speed ?? 0) || tiebreak[a] - tiebreak[b]);
      for (const id of order) {
        if (!s.active) return;
        if (!live(s, id)) continue;
        const intent = s.intents[id];
        if (intent.action !== 'pass' && ACT.get(intent.action)?.target === 'unit' && !live(s, intent.target)) { rt.emit('turn_invalid', { who: id, action: intent.action, reason: 'target_gone' }); continue; }
        act(s, id, intent);
      }
      s.intents = {};
      rt.emit('turn_end', { side: null, who: null, round: s.round });
      if (!checkOver(s)) roundEnd(s);
    }

    // ----- AI -----
    function bestAttack(s, id) { return scoredAttack(s, id)?.intent ?? null; }
    function scoredAttack(s, id) {
      let best = null;
      for (const l of legal(s, id)) {
        const a = ACT.get(l.id); if (!a || !a.ai || a.target !== 'unit') continue;
        for (const t of l.targets) {
          const score = (l.hit?.[t] ?? 100) * a.ai - hpOf(rt.entity(t)).frac * 10 + a.priority;
          if (!best || score > best.score) best = { score, intent: { action: a.id, target: t } };
        }
      }
      return best;
    }
    function aiIntent(s, id) {
      const pol = SIDE.get(s.units[id].side)?.ai ?? 'aggressive';
      if (pol === 'pass') return { action: 'pass' };
      if (pol === 'random') {
        const opts = legal(s, id).filter(l => l.id !== 'move' && (l.target === 'self' || l.target === 'none' || l.targets.length));
        if (!opts.length) return { action: 'pass' };
        const l = opts[Math.floor(rt.random() * opts.length)];
        return { action: l.id, target: l.targets.length ? l.targets[Math.floor(rt.random() * l.targets.length)] : undefined };
      }
      return bestAttack(s, id) ?? { action: 'pass' };
    }
    function aiStep(s) {
      const c = s.current; if (!c || control(c.side) !== 'ai' || rt.state.frame < (s.aiWait ?? 0)) return;
      s.aiWait = rt.state.frame + config.aiDelay;
      if (++s.decisions > 40) { endTurn(s); return; }
      const acting = (c.unit ? [c.unit] : unitsOf(s, c.side)).filter(id => s.units[id].ap > 0);
      const id = acting[0]; if (!id) { endTurn(s); return; }
      const pol = SIDE.get(c.side)?.ai ?? 'aggressive';
      if (pol !== 'aggressive') { const i = aiIntent(s, id); if (!act(s, id, i)) act(s, id, { action: 'pass' }); return; }
      if (config.actionsPerTurn && acting.length > 1) {
        // A side with a few actions per turn chooses which unit takes them: its best attack, else the unit nearest an
        // opponent closes in.
        let best = null;
        for (const u of acting) { const a = scoredAttack(s, u); if (a && (!best || a.score > best.score)) best = { ...a, unit: u }; }
        if (best) { act(s, best.unit, best.intent); return; }
        for (const u of [...acting].sort((a, b) => nearestFoe(s, a) - nearestFoe(s, b) || (a < b ? -1 : 1))) if (approachEnemy(s, u)) return;
        act(s, id, { action: 'pass' }); return;
      }
      const attack = bestAttack(s, id);
      if (attack) { act(s, id, attack); return; }
      if (approachEnemy(s, id)) return;
      if (config.overwatch && owAction && !s.units[id].ow) { act(s, id, { action: 'overwatch' }); return; }
      act(s, id, { action: 'pass' });
    }
    const nearestFoe = (s, id) => Math.min(1e9, ...Object.keys(s.units).filter(t => live(s, t) && s.units[t].side !== s.units[id].side).map(t => dist(rt, rt.entity(id), rt.entity(t))));
    function approachEnemy(s, id) {
      const u = s.units[id], e = rt.entity(id), api = spaceOf(rt, e);
      if (!config.movePerAp || !has(api, 'path') || !Array.isArray(e?.at)) return false;
      const foes = Object.keys(s.units).sort().filter(t => live(s, t) && s.units[t].side !== u.side).map(t => rt.entity(t));
      let best = null;
      for (const f of foes) { const p = api.path(e.at, f.at); if (p && (!best || p.length < best.length)) best = p; }
      if (!best || best.length <= 2) return false;
      const minCost = Math.min(...config.actions.filter(a => a.target === 'unit' && a.hostile).map(a => a.cost), u.ap);
      const budget = (u.ap - minCost >= 1 ? u.ap - minCost : u.ap) * config.movePerAp;
      let idx = 0, cost = 0;
      for (let i = 1; i < best.length - 1; i++) {
        const c = has(api, 'moveCost') ? api.moveCost(best[i - 1], best[i], e) : 1;
        if (cost + c > budget) break;
        if (has(api, 'entitiesAt') && api.entitiesAt(best[i]).some(o => o !== id && live(s, o))) break;
        cost += c; idx = i;
      }
      if (!idx) return false;
      return move(s, id, best[idx]);
    }

    // ----- wiring -----
    const service = {
      start: () => start(st()), stop: winner => stop(st(), winner), endTurn: () => endTurn(st()),
      current: () => st().current, units: side => Object.keys(st().units).filter(id => !side || st().units[id].side === side),
      legal: id => legal(st(), id), act: (id, intent) => act(st(), id, intent), submit: (id, intent) => { const s = st(); const ok = submit(s, id, intent); maybeResolve(s); return ok; },
      hitChance: (a, t, action) => hitChance(a, t, ACT.get(action) ?? config.actions[0]),
      isActive: () => Boolean(st().active),
      view() {
        const s = st(); if (!s.active && !s.round) return null;
        const unit = s.current?.unit ?? s.selected ?? null;
        return { active: Boolean(s.active), mode: config.order, round: s.round, side: s.current?.side ?? null, unit, phase: config.phases[s.phase]?.id ?? null,
          ap: s.units[unit]?.ap ?? 0, apMax: s.units[unit]?.apMax ?? 0, winner: s.winner ?? null,
          sides: config.sides.map(x => ({ id: x.id, control: x.control, units: Object.keys(s.units).sort().filter(id => s.units[id].side === x.id).map(id => ({ id, name: rt.entity(id)?.components.name ?? id, ap: s.units[id].ap, apMax: s.units[id].apMax, overwatch: s.units[id].ow, downed: s.units[id].downed, fallen: s.units[id].fallen })) })),
          legal: unit && control(s.units[unit]?.side) === 'player' ? legal(s, unit) : [] };
      },
    };
    rt.provide('turns', service);
    const playerUnit = (s, v) => {
      if (v?.unit && s.units[v.unit] && control(s.units[v.unit].side) === 'player') return v.unit;
      if (config.order === 'simultaneous') return Object.keys(s.units).sort().find(id => live(s, id) && control(s.units[id].side) === 'player' && !s.intents[id]) ?? null;
      if (!s.current || control(s.current.side) !== 'player') return null;
      return s.current.unit ?? (s.units[s.selected]?.ap > 0 ? s.selected : unitsOf(s, s.current.side).find(id => s.units[id].ap > 0)) ?? null;
    };
    rt.action('turn_act', (v, rt) => {
      const s = st(), id = playerUnit(s, v); if (!id) return;
      const intent = typeof v === 'string' ? { action: v } : { action: v.action, target: v.target };
      if (config.order === 'simultaneous') { if (submit(s, id, intent)) maybeResolve(s); } else act(s, id, intent);
    });
    rt.action('turn_move', (v, rt) => { const s = st(), id = playerUnit(s, v); if (id) act(s, id, { action: 'move', target: Array.isArray(v) ? v : v.to }); });
    rt.action('end_turn', (v, rt) => { const s = st(); if (s.current && (config.order === 'simultaneous' || control(s.current.side) === 'player')) endTurn(s); });
    rt.action('next_phase', (v, rt) => { const s = st(); if (s.current && control(s.current.side ?? 'player') === 'player') nextPhase(s); });
    rt.action('select_unit', (v, rt) => { const s = st(); if (s.units[v] && s.current && s.units[v].side === s.current.side && control(s.current.side) === 'player') { s.selected = v; rt.emit('unit_selected', { unit: v, side: s.current.side }); } });

    rt.system('rules', rt => {
      const s = st();
      if (!s.active && !s.started && config.autoStart) { s.started = true; start(s); }
      if (!s.active) { rt.state.vars['turns.active'] = 0; return; }
      gather(s);
      if (checkOver(s)) return;
      if (s.current && config.order !== 'simultaneous' && s.current.unit && !live(s, s.current.unit)) endTurn(s);
      if (s.current && config.order !== 'simultaneous' && !s.current.unit && !unitsOf(s, s.current.side).length) endTurn(s);
      if (s.autoEnd) { s.autoEnd = false; endTurn(s); }
      else if (config.order !== 'simultaneous') aiStep(s);
      else maybeResolve(s);
      const v = rt.state.vars; v['turns.active'] = s.active ? 1 : 0; v['turns.round'] = s.round;
      const pu = playerUnit(s, null); v['turns.ap'] = pu ? s.units[pu].ap : 0;
    }, ID);

    // Options: what the player may do now. On a side turn every unit of the side with AP left can act (a person selects
    // any of them), so each one's choices are offered: actions on targets first, then the turn's end, then moves taken
    // in turn from each unit (eight cells each, nearest to an opponent first).
    rt.options(rt => {
      const s = st(), id = playerUnit(s, null); if (!id) return [];
      const c = s.current, sideTurn = config.order !== 'simultaneous' && c && !c.unit;
      const acting = sideTurn ? unitsOf(s, c.side).filter(u => s.units[u].ap > 0) : [id];
      const acts = [], moves = acting.map(() => []);
      acting.forEach((uid, k) => {
        for (const l of legal(s, uid)) {
          if (l.id === 'move') {
            const e = rt.entity(uid), api = spaceOf(rt, e); if (!has(api, 'cellsInRange')) continue;
            const reach = s.units[uid].ap * config.movePerAp, foes = Object.keys(s.units).filter(t => live(s, t) && s.units[t].side !== s.units[uid].side).map(t => rt.entity(t));
            const near = api.cellsInRange(e.at, reach).filter(q => cellKey(q) !== cellKey(e.at) && !(has(api, 'entitiesAt') && api.entitiesAt(q).length))
              .map(q => ({ q, d: Math.min(...foes.map(f => dist(rt, { ...e, at: q }, f)), 1e9) })).sort((a, b) => a.d - b.d || cellKey(a.q).localeCompare(cellKey(b.q)));
            const cells = [];
            for (const x of near) { if (cells.length >= 8) break; if (!planMove(s, uid, x.q).reason) cells.push(x); }
            for (const { q } of cells) moves[k].push({ label: `${uid} move ${cellKey(q)}`, actions: { turn_move: { unit: uid, to: q } } });
          } else if (l.targets.length) for (const t of l.targets.slice(0, 8)) acts.push({ label: `${uid} ${l.id} ${Array.isArray(t) ? cellKey(t) : t}`, actions: { turn_act: { unit: uid, action: l.id, target: t } } });
          else acts.push({ label: `${uid} ${l.id}`, actions: { turn_act: { unit: uid, action: l.id } } });
        }
      });
      const out = [...acts, { label: 'end turn', actions: { end_turn: true } }];
      for (let i = 0; moves.some(m => i < m.length); i++) for (const m of moves) if (m[i]) out.push(m[i]);
      return out;
    });
  },
};
