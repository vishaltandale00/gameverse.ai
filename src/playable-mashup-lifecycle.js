/** Authored candidate-runtime policies. None of these schedulers is extracted IR.
 * Source functions remain caller-owned callbacks over canonical candidate state.
 * Tick units are candidate simulation invocations, never inferred source frames.
 */
export const LIFECYCLE_POLICY_VERSION = 'authored-lifecycle-v1';

const copy = value => structuredClone(value);
const identity = value => {
  if (typeof value !== 'string' || !value.length) throw new TypeError('A nonempty command/action identity is required');
  return value;
};
const ticks = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Ticks must be a nonnegative safe integer');
  return value;
};

/** Press actions fire once per physical edge; hold actions deliberately repeat.
 * Callers can use the emitted actionId for an attack's complete active lifetime.
 * Disabled input consumes the physical edge, so reenabling a held key cannot fire.
 */
export function createInputLifecycle({ actions = {} } = {}) {
  for (const mode of Object.values(actions)) if (!['press', 'hold', 'release'].includes(mode)) throw new TypeError('Unknown input mode');
  let previous = {}, sequence = 0;
  return {
    sample(raw = {}, { disabled = false } = {}) {
      const held = {}, pressed = {}, released = {}, admitted = {};
      for (const [name, mode] of Object.entries(actions)) {
        const down = Boolean(raw[name]);
        held[name] = !disabled && down;
        pressed[name] = !disabled && down && !previous[name];
        released[name] = !disabled && !down && Boolean(previous[name]);
        if ((mode === 'press' && pressed[name]) || (mode === 'hold' && held[name]) || (mode === 'release' && released[name])) admitted[name] = `${name}:${++sequence}`;
        previous[name] = down;
      }
      return { held, pressed, released, actions: admitted };
    },
    reset() { previous = {}; sequence = 0; },
  };
}

/** Explicit command delivery identity, used only for confirmed discrete commands.
 * A new ID intentionally invokes exchange again; the exchange stays an exchange.
 * Denied commands are also settled: a retry cannot become a newly acquired action.
 */
export function createProgressionLifecycle({ mutate, refresh, canUse, consume }) {
  if (![mutate, refresh, canUse, consume].every(fn => typeof fn === 'function')) throw new TypeError('Progression source callbacks required');
  let delivered = new Set(), events = [];
  return {
    change(command) {
      mutate(command);
      const capability = refresh();
      events.push({ type: 'capability-refreshed', reason: 'change' });
      return capability;
    },
    use(command) {
      const id = identity(command.commandId);
      if (delivered.has(id)) return { accepted: false, reason: 'duplicate-command' };
      const capability = refresh();
      delivered.add(id);
      if (!canUse(capability, command)) {
        events.push({ type: 'command-denied', commandId: id });
        return { accepted: false, reason: 'unavailable' };
      }
      const result = consume(command, capability);
      events.push({ type: 'command-consumed', commandId: id });
      return { accepted: true, result };
    },
    drainEvents() { const result = events; events = []; return copy(result); },
    reset() { delivered = new Set(); events = []; },
  };
}

/** Live target admission, authored protection cadence and once-only settlement.
 * getHp reads canonical source state. applyHit must execute the actual source hit.
 * Each action can hit each target once; distinct actions and targets remain legal.
 * Protection excludes N subsequent beginStep invocations: age at the END of those
 * steps with endStep(). Source reaction is a separate caller-owned eligible phase.
 */
export function createCombatLifecycle({ protectionTicks = 0, onDeath = () => {}, onCleanup = () => {}, onReward = () => {} } = {}) {
  ticks(protectionTicks);
  let actors = new Map(), contacts = new Map(), events = [], tick = 0, open = false;
  const actor = id => {
    const value = actors.get(id);
    if (!value) throw new Error(`Unknown actor ${id}`);
    return value;
  };
  const settle = (id, record) => {
    if (record.phase !== 'alive' || record.getHp() > 0) return;
    record.phase = 'dead'; // Exclude reentrant contacts before any continuation.
    events.push({ type: 'death', actorId: id, tick });
    onDeath(id);
    onCleanup(id);
    record.phase = 'removed';
    events.push({ type: 'cleanup', actorId: id, tick });
    onReward(id);
    events.push({ type: 'reward', actorId: id, tick });
  };
  return {
    addActor(id, { getHp }) {
      identity(id);
      if (actors.has(id) || typeof getHp !== 'function') throw new TypeError('Unique actor and canonical HP reader required');
      actors.set(id, { getHp, phase: 'alive', protection: 0, protectedAt: -1, applyingHit: false });
    },
    beginStep() {
      if (open) throw new Error('Previous combat step is still open');
      open = true; tick += 1;
      for (const [id, record] of actors) settle(id, record);
    },
    contact({ actorId, actionId, applyHit }) {
      if (!open) throw new Error('beginStep is required');
      const record = actor(actorId);
      identity(actionId);
      if (record.applyingHit) return { accepted: false, reason: 'hit-in-progress' };
      settle(actorId, record);
      if (record.phase !== 'alive') return { accepted: false, reason: 'terminal' };
      if (record.protection > 0) return { accepted: false, reason: 'protected' };
      if (contacts.get(actionId)?.has(actorId)) return { accepted: false, reason: 'duplicate-contact' };
      if (typeof applyHit !== 'function') throw new TypeError('Source hit callback required');
      if (!contacts.has(actionId)) contacts.set(actionId, new Set());
      contacts.get(actionId).add(actorId);
      let result;
      record.applyingHit = true;
      try { result = applyHit(); } finally { record.applyingHit = false; }
      record.protection = protectionTicks; record.protectedAt = tick;
      events.push({ type: 'accepted-hit', actorId, actionId, tick, hp: record.getHp() });
      settle(actorId, record);
      return { accepted: true, result };
    },
    endStep() {
      if (!open) throw new Error('No combat step is open');
      for (const record of actors.values()) if (record.protectedAt !== tick && record.protection > 0) record.protection -= 1;
      open = false;
    },
    // Retire action identities only once their collision lifetime has ended.
    retireAction(actionId) { contacts.delete(identity(actionId)); },
    observe(id) { const r = actor(id); return { hp: r.getHp(), phase: r.phase, protection: r.protection, tick }; },
    drainEvents() { const result = events; events = []; return copy(result); },
    // Canonical source state is reset by candidate owner before registration again.
    reset() { actors = new Map(); contacts = new Map(); events = []; tick = 0; open = false; },
  };
}
