import {ASSEMBLY_SCHEMA, parseAssembly} from './mechanic-assembly-model.js';

// Import a recorded assembly as one independently owned prefab instance. Keep
// actual source pins, repeated invocations, shared backing and result bindings.
// No port matching, unit conversion or cross-prefab state merging is inferred.
export function addRecoveredPrefab(graph, prefab, {id = 'prefab'} = {}) {
  const source = parseAssembly(JSON.stringify(prefab));
  if (graph.schema !== ASSEMBLY_SCHEMA) throw Error('Choose a versioned mechanic assembly.');
  const next = structuredClone(graph);
  next.initialize ||= {}; next.services ||= [];
  let safeId = String(id).replace(/[^a-zA-Z0-9_]/g, '_') || 'prefab';
  if (!/^[A-Za-z]/.test(safeId)) safeId = `p_${safeId}`;
  safeId = safeId.slice(0, 20);
  const names = (prefix, entries) => Object.fromEntries(entries.map((name, index) => [name, `${prefix}_${index}_${name}`.slice(0, 64)]));
  let prefix = safeId, suffix = 1, componentMap, stateMap, adapterMap;
  do {
    if (suffix > 1) prefix = `${safeId}_${suffix}`;
    componentMap = names(prefix, Object.keys(source.components));
    stateMap = names(prefix, Object.keys(source.state));
    adapterMap = names(`${prefix}_adapter`, Object.keys(source.adapters || {}));
    suffix++;
  } while (Object.values(componentMap).some(name => next.components[name] || next.adapters?.[name]) || Object.values(stateMap).some(name => next.state[name]) || Object.values(adapterMap).some(name => next.adapters?.[name] || next.components[name]));
  const remapSlots = value => {
    if (Array.isArray(value)) return value.map(remapSlots);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'slot' && typeof item === 'string' ? stateMap[item] || item : remapSlots(item)]));
  };
  for (const [name, state] of Object.entries(source.state)) next.state[stateMap[name]] = {...structuredClone(state), owner: componentMap[state.owner] || adapterMap[state.owner] || state.owner};
  for (const [name, initial] of Object.entries(source.initialize || {})) next.initialize[stateMap[name]] = structuredClone(initial);
  for (const [name, component] of Object.entries(source.components)) {
    const copy = remapSlots(component);
    for (const [port, binding] of Object.entries(copy.collection_bindings || {})) if (typeof binding === 'string') copy.collection_bindings[port] = stateMap[binding] || binding;
    next.components[componentMap[name]] = copy;
  }
  if (Object.keys(adapterMap).length) next.adapters ||= {};
  for (const [name, adapter] of Object.entries(source.adapters || {})) next.adapters[adapterMap[name]] = {
    ...structuredClone(adapter), source_slot: stateMap[adapter.source_slot], target_slot: stateMap[adapter.target_slot],
  };
  for (const invocation of source.invocations) next.invocations.push(invocation.adapter
    ? {...remapSlots(invocation), adapter: adapterMap[invocation.adapter]}
    : {...remapSlots(invocation), component: componentMap[invocation.component]});
  next.services.push(...structuredClone(source.services || []));
  return {graph: next, instances: Object.values(componentMap), componentMap, stateMap, adapterMap};
}

// Configure only evidenced entry inputs. This does not patch source behavior or
// turn source constants (for example Minish charge durations) into free knobs.
export function configureRecoveredPrefab(prefab, id, configuration = {}, {componentMap = {}, stateMap = {}} = {}) {
  const next = structuredClone(prefab);
  const members = new Set(Object.values(componentMap));
  const inInstance = call => !members.size || members.has(call.component);
  if (id === 'mzm.enemy.accepted-damage-and-reaction') {
    for (const key of ['damage', 'hp']) if (configuration[key] != null && (!Number.isInteger(configuration[key]) || configuration[key] < 0 || configuration[key] > 65535)) throw Error(`${key} must be a source u16 integer.`);
    if (configuration.hp != null) {
      if (!Object.hasOwn(next.initialize || {}, stateMap.enemy_hp || 'enemy_hp')) throw Error('Prefab has no recorded enemy HP input.');
      next.initialize[stateMap.enemy_hp || 'enemy_hp'] = configuration.hp;
    }
    if (configuration.damage != null) {
      const call = next.invocations.find(item => inInstance(item) && next.components[item.component]?.package_id === 'mzm.combat.impact');
      if (call?.arguments?.param_0?.op !== 'const') throw Error('Prefab has no recorded constant damage input.');
      call.arguments.param_0.value = configuration.damage;
    }
  } else if (id === 'tmc.learned_sword_charge_release') {
    for (const [key, technique] of [['baseLearned', 72], ['fastLearned', 115]]) if (configuration[key] != null) {
      if (typeof configuration[key] !== 'boolean') throw Error(`${key} must be true or false.`);
      const calls = next.invocations.filter(item => inInstance(item) && next.components[item.component]?.package_id === 'tmc.progress.inventory_write' && item.arguments?.param_0?.op === 'const' && item.arguments.param_0.value === technique);
      if (!calls.length || calls.some(item => item.arguments?.param_1?.op !== 'const')) throw Error('Prefab has no recorded technique transaction input.');
      for (const call of calls) call.arguments.param_1.value = configuration[key] ? 1 : 0;
    }
  } else if (Object.keys(configuration).length) throw Error('This source module has no supported prefab configuration.');
  return next;
}
