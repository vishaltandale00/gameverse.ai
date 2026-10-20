// Source adapters are explicit, pinned declarations. This verifier checks the
// executable structure; evidence references remain the caller's source proof.
// Trust boundary: the loader/intake must SHA-256 the actual sourceGraphRef and
// targetGraphRef file bytes and compare their parsed graphs to these snapshots
// before invoking this browser-safe verifier. Ref/version equality here is not
// independent file-byte verification or a signature/authentication claim.
const fail = message => { throw Error(`Source phase adapter required: ${message}`); };
const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const evidence = refs => Array.isArray(refs) && refs.length && refs.every(ref => typeof ref === 'string' && ref.trim());
const pins = component => ['package_id', 'package_sha256', 'behavior_sha256'].every(key => typeof component?.[key] === 'string' && component[key]);
const slots = component => [...Object.values(component.bindings || {}).map(binding => binding.slot), ...Object.values(component.collection_bindings || {})];

export function createVerifiedLifecycleAdapter({moduleId, sourceGraph, targetGraph, sourceVersion, targetVersion, sourceGraphRef, targetGraphRef, components = {}, slots: rules = {}}) {
  if (!moduleId || ![sourceVersion, targetVersion].every(version => /^[a-f0-9]{64}$/.test(version || ''))) fail('lifecycle adapter needs canonical module and immutable source version references.');
  for (const [ref, version] of [[sourceGraphRef, sourceVersion], [targetGraphRef, targetVersion]]) {
    if (!ref || typeof ref.path !== 'string' || !ref.path.trim() || ref.sha256 !== version) fail('lifecycle source graph references must identify exact paths and match declared version digests.');
  }
  if (!sourceGraph?.state || !targetGraph?.state) fail('lifecycle adapter needs both recorded source graphs.');
  for (const [name, rule] of Object.entries(components)) {
    const previous = sourceGraph.components[rule.existingComponent], next = targetGraph.components[name];
    if (!evidence(rule.evidence) || !pins(previous) || !pins(next)
      || ['package_id', 'package_sha256', 'behavior_sha256'].some(key => previous[key] !== next[key])) fail(`component ${name} lacks identical pinned canonical owner evidence.`);
  }
  for (const [name, state] of Object.entries(targetGraph.state)) {
    if (state.owner === 'external') continue;
    const rule = rules[name];
    if (!rule || !evidence(rule.evidence) || rule.ownerComponent !== state.owner) fail(`owned state ${name} needs an evidenced lifecycle rule.`);
    if (rule.policy === 'phase-local') {
      if (rule.existingSlot || !Object.hasOwn(targetGraph.initialize || {}, name)) fail(`phase-local state ${name} needs explicit initialization and no alias.`);
      const writer = targetGraph.invocations.findIndex(call => call.component === state.owner && call.result?.slot === name);
      if (writer < 0 || targetGraph.invocations.some((call, index) => index <= writer && slots(targetGraph.components[call.component]).includes(name))) fail(`phase-local output ${name} needs a captured result before consumption.`);
      continue;
    }
    if (rule.policy !== 'refresh-before-read' || !sourceGraph.state[rule.existingSlot]
      || components[state.owner]?.existingComponent !== sourceGraph.state[rule.existingSlot].owner) fail(`state ${name} needs a verified canonical owner and refresh policy.`);
    const refresh = rule.refreshInvocationIndexes;
    if (!Array.isArray(refresh) || !refresh.length || new Set(refresh).size !== refresh.length
      || refresh.some(index => !Number.isInteger(index) || targetGraph.invocations[index]?.component !== state.owner)) fail(`state ${name} has invalid declared refresh invocations.`);
    const consumers = targetGraph.invocations.flatMap((call, index) => call.component !== state.owner && slots(targetGraph.components[call.component]).includes(name) ? [index] : []);
    if (stable(consumers) !== stable(rule.consumerInvocationIndexes)) fail(`state ${name} must declare every cache consumer.`);
    // A refresh directly before each consumer forbids intervening input writes,
    // without guessing opaque package read/write effects from field names.
    if (consumers.some(index => !refresh.includes(index - 1))) fail(`state ${name} must refresh immediately before every consumer.`);
  }
  return clone({schema: 'gameverse.source-phase-lifecycle/0.1', moduleId, sourceVersion, targetVersion, sourceGraphRef, targetGraphRef, sourceGraph, targetGraph, components, slots: rules});
}

export function verifyLifecycleAdapter(adapter, {graph, source, existingModule, moduleId, sharedStateBindings}) {
  if (!adapter) return null;
  const checked = createVerifiedLifecycleAdapter(adapter);
  if (checked.moduleId !== moduleId || stable(checked.targetGraph) !== stable(source)) fail('lifecycle adapter module or target source version differs.');
  const remap = (value, stateMap) => {
    if (Array.isArray(value)) return value.map(item => remap(item, stateMap));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'slot' ? stateMap[item] || item : remap(item, stateMap)]));
  };
  const mapComponent = (component, stateMap) => {
    const result = remap(component, stateMap);
    for (const [port, name] of Object.entries(result.collection_bindings || {})) result.collection_bindings[port] = stateMap[name] || name;
    return result;
  };
  for (const [name, state] of Object.entries(checked.sourceGraph.state)) {
    const installed = graph.state[existingModule.stateMap[name]];
    const expected = {...state, owner: existingModule.componentMap[state.owner] || state.owner};
    if (stable(installed) !== stable(expected)) fail(`installed state ${name} differs from pinned lifecycle source.`);
  }
  for (const [name, component] of Object.entries(checked.sourceGraph.components)) {
    if (stable(graph.components[existingModule.componentMap[name]]) !== stable(mapComponent(component, existingModule.stateMap))) fail(`installed component ${name} differs from pinned lifecycle source.`);
  }
  const aliases = Object.fromEntries(Object.entries(sharedStateBindings).filter(([, binding]) => binding.existingSlot).map(([name, binding]) => [name, existingModule.stateMap[binding.existingSlot]]));
  for (const [name, rule] of Object.entries(checked.slots)) {
    const binding = sharedStateBindings[name];
    if (rule.policy === 'phase-local' ? binding?.new !== true : binding?.existingSlot !== rule.existingSlot) fail(`state ${name} binding differs from lifecycle rule.`);
  }
  const componentMap = {};
  for (const [name, rule] of Object.entries(checked.components)) {
    const canonical = existingModule.componentMap[rule.existingComponent];
    if (stable(mapComponent(source.components[name], aliases)) !== stable(graph.components[canonical])) fail(`component ${name} has incompatible canonical field layout or bindings.`);
    componentMap[name] = canonical;
  }
  return {...checked, componentMap};
}
