import {ASSEMBLY_SCHEMA, parseAssembly} from './mechanic-assembly-model.js';
import {verifyLifecycleAdapter} from './game-system-lifecycle-adapters.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const adapter = message => Error(`Source phase adapter required: ${message}`);

function phaseName(value) {
  if (typeof value !== 'string' || !value.trim()) throw adapter('supply a stable phase ID.');
  return value;
}

function compatibleState(source, existing) {
  const a = source.semantic_type, b = existing.semantic_type;
  return source.storage_type === existing.storage_type
    && (source.count ?? 1) === (existing.count ?? 1)
    && object(a) && object(b)
    && a.quantity === b.quantity && a.frame === b.frame
    && JSON.stringify(a.signed_encoding ?? null) === JSON.stringify(b.signed_encoding ?? null)
    && a.unit?.numerator === b.unit?.numerator && a.unit?.denominator === b.unit?.denominator;
}

function allocateNames(prefix, sourceNames, occupied) {
  const names = {};
  for (const [index, sourceName] of sourceNames.entries()) {
    const base = `${prefix}_${index}_${sourceName}`.slice(0, 64);
    let name = base, suffix = 2;
    while (occupied.has(name)) name = `${base.slice(0, 60)}_${suffix++}`;
    occupied.add(name);
    names[sourceName] = name;
  }
  return names;
}

function sourcePhase(source, phaseId, phase) {
  if (phase && phase.id !== phaseId) throw adapter('phase descriptor ID differs from the selected phase ID.');
  if (phase?.invocations && (phase.invocations.length !== source.invocations.length
    || phase.invocations.some((id, index) => id !== source.invocations[index].component))) {
    throw adapter('phase descriptor invocation order differs from the recorded graph.');
  }
  if (phase && (!phase.trigger || !Array.isArray(phase.requiredServices))) {
    throw adapter('supply the source host trigger and required service boundary.');
  }
  return {
    id: phaseId,
    trigger: phase?.trigger || null,
    scheduleStatus: phase?.scheduleStatus || null,
    requiredServices: clone(phase?.requiredServices || []),
    sourceRefs: clone(phase?.sourceRefs || []),
  };
}

// Extend one physical source module with a distinct callable phase. Every state
// slot is classified by the caller's source adapter; names and types alone never
// authorize aliasing. The active invocation sequence is deliberately untouched.
export function extendRecoveredPrefab(graph, prefab, {
  existingModule, moduleId, phaseId, sharedStateBindings, phase, lifecycleAdapter, id = 'phase',
} = {}) {
  const source = parseAssembly(JSON.stringify(prefab));
  if (graph?.schema !== ASSEMBLY_SCHEMA) throw Error('Choose a versioned mechanic assembly.');
  if (!object(existingModule) || !moduleId || existingModule.moduleId !== moduleId) {
    throw adapter('provide the same canonical moduleId and its existing module instance.');
  }
  phaseName(phaseId);
  if (!existingModule.phaseId || !object(existingModule.stateMap)
    || !Array.isArray(existingModule.instances) || !existingModule.instances.length) {
    throw adapter('identify the installed phase, components and canonical state map.');
  }
  if (existingModule.phaseId === phaseId || existingModule.phaseTemplates?.[phaseId]) {
    throw adapter(`phase ${phaseId} is already installed.`);
  }
  if (!object(sharedStateBindings)
    || Object.keys(sharedStateBindings).length !== Object.keys(source.state).length
    || Object.keys(source.state).some(name => !Object.hasOwn(sharedStateBindings, name))) {
    throw adapter('classify every source state slot as an evidenced existing alias or an explicit new slot.');
  }
  const phaseInfo = sourcePhase(source, phaseId, phase);
  const lifecycle = verifyLifecycleAdapter(lifecycleAdapter, {graph, source, existingModule, moduleId, sharedStateBindings});
  for (const instance of existingModule.instances) {
    if (!graph.components?.[instance]) throw adapter(`installed component ${instance} is missing.`);
  }
  for (const canonical of Object.values(existingModule.stateMap)) {
    if (!lifecycle && graph.state?.[canonical]?.owner !== 'external') {
      throw adapter(`phase-owned state ${canonical} needs an explicit lifecycle adapter before changing phases.`);
    }
  }
  for (const [sourceSlot, state] of Object.entries(source.state)) {
    if (!lifecycle && state.owner !== 'external') {
      throw adapter(`phase-owned state ${sourceSlot} needs an explicit lifecycle adapter before changing phases.`);
    }
  }
  for (const service of source.services || []) {
    if (!graph.services?.some(existing => JSON.stringify(existing) === JSON.stringify(service))) {
      throw adapter(`source service ${typeof service === 'string' ? service : JSON.stringify(service)} must be explicitly supplied by the host.`);
    }
  }

  const next = clone(graph);
  const safeId = String(id).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^A-Za-z]/, 'p_').slice(0, 20) || 'phase';
  const componentMap = allocateNames(safeId, Object.keys(source.components), new Set([...Object.keys(next.components), ...existingModule.instances]));
  Object.assign(componentMap, lifecycle?.componentMap || {});
  const stateMap = {};
  const knownStateMaps = Object.values(existingModule.phaseStateMaps || {[existingModule.phaseId]: existingModule.stateMap});
  const knownSourceSlots = new Set(knownStateMaps.flatMap(mapping => Object.keys(mapping)));
  const occupiedState = new Set([...Object.keys(next.state), ...knownStateMaps.flatMap(mapping => Object.values(mapping))]);
  const newNames = allocateNames(safeId, Object.keys(source.state).filter(name => sharedStateBindings[name]?.new === true), occupiedState);
  const phaseState = {}, phaseInitialize = {};
  for (const [sourceSlot, state] of Object.entries(source.state)) {
    const binding = sharedStateBindings[sourceSlot];
    if (!object(binding) || (binding.new === true) === (typeof binding.existingSlot === 'string')) {
      throw adapter(`state ${sourceSlot} needs exactly one existingSlot or new declaration.`);
    }
    if (binding.new === true) {
      if (knownSourceSlots.has(sourceSlot)) {
        throw adapter(`state ${sourceSlot} already belongs to this module; provide an evidenced alias.`);
      }
      stateMap[sourceSlot] = newNames[sourceSlot];
      phaseState[stateMap[sourceSlot]] = {...clone(state), owner: componentMap[state.owner] || state.owner};
      if (lifecycle?.slots[sourceSlot]?.policy !== 'phase-local' && Object.hasOwn(source.initialize || {}, sourceSlot)) phaseInitialize[stateMap[sourceSlot]] = clone(source.initialize[sourceSlot]);
      continue;
    }
    const canonical = existingModule.stateMap[binding.existingSlot];
    const installed = next.state[canonical];
    if (!canonical || !installed) throw adapter(`state ${sourceSlot} references an unknown canonical slot.`);
    if (!Array.isArray(binding.evidence) || !binding.evidence.length || binding.evidence.some(ref => typeof ref !== 'string' || !ref.trim())) {
      throw adapter(`state ${sourceSlot} needs source evidence for its canonical alias.`);
    }
    if (!compatibleState(state, installed)) throw adapter(`state ${sourceSlot} has incompatible storage, semantic or count contracts.`);
    const ownedRule = lifecycle?.slots[sourceSlot];
    const expectedOwner = state.owner === 'external' ? 'external' : componentMap[state.owner];
    if (!expectedOwner || installed.owner !== expectedOwner || (!ownedRule && (state.shared !== true || installed.shared !== true))) {
      throw adapter(`state ${sourceSlot} has incompatible ownership or shared-backing contracts.`);
    }
    if (ownedRule?.policy === 'refresh-before-read') installed.shared = state.shared;
    stateMap[sourceSlot] = canonical;
    // Existing live initialization wins, including when source fixture defaults differ.
  }

  const remapSlots = value => {
    if (Array.isArray(value)) return value.map(remapSlots);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, key === 'slot' && typeof item === 'string' ? stateMap[item] || item : remapSlots(item),
    ]));
  };
  const phaseComponents = {};
  for (const [name, component] of Object.entries(source.components)) {
    const copy = remapSlots(component);
    for (const [port, binding] of Object.entries(copy.collection_bindings || {})) {
      if (typeof binding === 'string') copy.collection_bindings[port] = stateMap[binding] || binding;
    }
    phaseComponents[componentMap[name]] = copy;
  }
  const invocations = source.invocations.map(invocation => ({
    ...remapSlots(invocation), component: componentMap[invocation.component],
  }));
  const originalCalls = graph.invocations.filter(call => existingModule.instances.includes(call.component));
  const previousTemplates = existingModule.phaseTemplates || {
    [existingModule.phaseId]: {
      id: existingModule.phaseId,
      trigger: existingModule.phase?.trigger || null,
      scheduleStatus: existingModule.phase?.scheduleStatus || null,
      requiredServices: clone(existingModule.phase?.requiredServices || []),
      sourceRefs: clone(existingModule.phase?.sourceRefs || []),
      invocations: clone(originalCalls),
      components: Object.fromEntries(existingModule.instances.map(id => [id, clone(graph.components[id])])),
      state: Object.fromEntries(Object.values(existingModule.stateMap).map(id => [id, clone(graph.state[id])])),
      initialize: Object.fromEntries(Object.values(existingModule.stateMap).filter(id => Object.hasOwn(graph.initialize || {}, id)).map(id => [id, clone(graph.initialize[id])])),
    },
  };
  const phaseTemplates = {...clone(previousTemplates), [phaseId]: {...phaseInfo, invocations, components: phaseComponents, state: phaseState, initialize: phaseInitialize}};
  const module = {
    ...clone(existingModule),
    instances: [...new Set([...existingModule.instances, ...Object.values(componentMap)])],
    phaseTemplates,
    ephemeralOutputs: {...clone(existingModule.ephemeralOutputs || {}), ...Object.fromEntries(Object.entries(lifecycle?.slots || {}).filter(([, rule]) => rule.policy === 'phase-local').map(([name]) => [stateMap[name], {phaseId, owner: componentMap[source.state[name].owner], sourceSlot: name}]))},
    phaseStateMaps: {...clone(existingModule.phaseStateMaps || {[existingModule.phaseId]: existingModule.stateMap}), [phaseId]: stateMap},
    phaseComponentMaps: {...clone(existingModule.phaseComponentMaps || {[existingModule.phaseId]: existingModule.componentMap}), [phaseId]: componentMap},
  };
  return {graph: next, module, phaseTemplates, componentMap, stateMap, instances: Object.values(componentMap)};
}

// Selecting one source phase is an explicit caller action. Host services and
// source event scheduling remain obligations described by the selected template.
export function selectRecoveredPrefabPhase(graph, {module, phaseId} = {}) {
  if (graph?.schema !== ASSEMBLY_SCHEMA || !Array.isArray(graph.invocations)) throw Error('Choose a versioned mechanic assembly.');
  const template = module?.phaseTemplates?.[phaseId];
  if (!template) throw adapter(`phase ${phaseId || '(missing)'} is not installed for this module.`);
  const instances = new Set(module.instances || []);
  if (!instances.size || !Object.keys(template.components || {}).length) throw adapter('installed module components are missing.');
  const next = clone(graph);
  next.initialize ||= {};
  const index = next.invocations.findIndex(call => instances.has(call.component));
  next.invocations = next.invocations.filter(call => !instances.has(call.component));
  for (const instance of instances) delete next.components[instance];
  for (const [name, state] of Object.entries(template.state || {})) {
    if (!next.state[name]) next.state[name] = clone(state);
  }
  for (const [name, value] of Object.entries(template.initialize || {})) {
    if (!Object.hasOwn(next.initialize, name)) next.initialize[name] = clone(value);
  }
  Object.assign(next.components, clone(template.components));
  for (const [name, record] of Object.entries(module.ephemeralOutputs || {})) {
    if (record.phaseId !== phaseId && next.state[name]?.owner === record.owner) {
      const referenced = Object.values(next.components).some(component =>
        Object.values(component.bindings || {}).some(binding => binding.slot === name)
        || Object.values(component.collection_bindings || {}).includes(name));
      if (referenced) throw adapter(`phase-local output ${name} is still consumed; retirement needs a fresh source result.`);
      delete next.state[name];
      delete next.initialize[name];
    }
  }
  for (const [name, state] of Object.entries(next.state)) {
    if (state.owner !== 'external' && !next.components[state.owner]) {
      throw adapter(`phase ${phaseId} would orphan retained owned state ${name}; supply an explicit phase-local output retirement adapter.`);
    }
  }
  next.invocations.splice(index < 0 ? next.invocations.length : index, 0, ...clone(template.invocations));
  return next;
}
