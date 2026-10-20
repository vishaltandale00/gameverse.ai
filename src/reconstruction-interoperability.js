// Discovery is deliberately separate from Composer admission and runtime proof.
// Explicit capability identifiers narrow the search; genre never establishes fit.
const list = value => Array.isArray(value) ? value : [];
const present = value => value !== undefined && value !== null && value !== '';
const normalize = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))
  : Array.isArray(value) ? value.map(normalize) : value;
const canonical = value => JSON.stringify(normalize(value));
const contractOf = value => value?.interoperabilityContract || value?.interoperability?.contract;
const dimensions = ['direction', 'type', 'unit', 'frame', 'ownership'];
const contractFields = ['eventOrder', 'services', 'domain'];

export function reconstructionContractDifferences(required, offered) {
  const reasons = [];
  for (const [label, contract] of [['Required', required], ['Candidate', offered]]) {
    if (!contract) { reasons.push(`${label} interoperability contract is missing.`); continue; }
    if (!present(contract.id)) reasons.push(`${label} immutable contract identity is missing.`);
    if (!present(contract.capability)) reasons.push(`${label} exact capability identifier is missing.`);
    if (!list(contract.evidence).length) reasons.push(`${label} source contract evidence is missing.`);
    if (!Array.isArray(contract.ports)) reasons.push(`${label} explicit port list is missing.`);
    for (const field of contractFields) if (!Object.hasOwn(contract, field)) reasons.push(`${label} ${field} contract is missing.`);
    for (const field of ['eventOrder', 'services']) if (Object.hasOwn(contract, field) && !Array.isArray(contract[field])) reasons.push(`${label} ${field} must be an explicit list.`);
    if (Object.hasOwn(contract, 'domain') && (!contract.domain || typeof contract.domain !== 'object' || Array.isArray(contract.domain))) reasons.push(`${label} domain must be an explicit constraint record.`);
    const names = list(contract.ports).map(port => port.name);
    if (new Set(names).size !== names.length) reasons.push(`${label} port identities must be unique.`);
    for (const port of list(contract.ports)) {
      if (!present(port.name)) reasons.push(`${label} port identity is missing.`);
      for (const dimension of dimensions) if (!present(port[dimension])) reasons.push(`${label} port ${port.name || '?'} ${dimension} is missing.`);
    }
  }
  if (!required || !offered) return reasons;
  if (required.capability !== offered.capability) reasons.push(`Capability differs: ${offered.capability} → ${required.capability}.`);
  for (const port of list(required.ports)) {
    const other = list(offered.ports).find(item => item.name === port.name);
    if (!other) { reasons.push(`Required port ${port.name} is absent from candidate.`); continue; }
    for (const dimension of dimensions) if (canonical(port[dimension]) !== canonical(other[dimension])) reasons.push(`Port ${port.name} ${dimension} differs: ${canonical(other[dimension])} → ${canonical(port[dimension])}.`);
  }
  // Extra ports can introduce unsatisfied services/state ownership; explicit adapters
  // may bind them but a matching subset alone cannot certify this interface.
  for (const port of list(offered.ports)) if (!list(required.ports).some(item => item.name === port.name)) reasons.push(`Candidate extra port ${port.name} requires an explicit binding.`);
  for (const field of contractFields) if (Object.hasOwn(required, field) && Object.hasOwn(offered, field) && canonical(required[field]) !== canonical(offered[field])) reasons.push(`${field} differs; an explicit mapping is required.`);
  return [...new Set(reasons)];
}

function capabilityIds(value) {
  return new Set([contractOf(value)?.capability, value?.capability, ...list(value?.roleFacets).map(facet => facet.capability)].filter(present));
}

export function assessReconstructionCompatibility({phase, candidate, sourceGame, adapters = []} = {}) {
  const required = contractOf(phase), offered = contractOf(candidate);
  const reasons = reconstructionContractDifferences(required, offered);
  const crossGame = Boolean(sourceGame && candidate?.sourceGame && sourceGame !== candidate.sourceGame);
  const requestedCapability = required?.capability || phase?.capability;
  const facet = list(candidate?.roleFacets).find(item => item.capability === requestedCapability);
  const ready = candidate?.recoveredAssembly?.readyToAdd === true && candidate?.availability === 'published-subset' && candidate?.roleAvailability !== 'source-only'
    && (!facet || facet.status === 'published-subset');
  // A bridge must identify both immutable contracts and carry a checked output
  // interface. A prose "movement adapter" or status flag is insufficient.
  const adapter = reasons.length ? adapters.find(item => item.fromCandidateId === candidate?.id && item.toPhaseId === phase?.id
    && item.fromContractId === offered?.id && item.toContractId === required?.id
    && item.status === 'implemented' && present(item.validationRef) && list(item.evidence).length
    && list(item.mappings).length && !reconstructionContractDifferences(required, item.outputContract).length) : undefined;
  const missingBridge = adapter ? [] : reasons;
  const state = reasons.length ? 'adapter-required' : ready ? 'directly-compatible' : 'source-only';
  // The frontend imports only the selected prefab graph. Until it imports a
  // bridge-inclusive graph, implemented adapter metadata must remain diagnostic.
  return {state, crossGame, sourceFaithful: false, selectable: ready && !reasons.length,
    runtimeQualified: false, originalCandidateId: candidate?.id, originalSourceGame: candidate?.sourceGame,
    requiredContractId: required?.id, offeredContractId: offered?.id, adapterId: adapter?.id,
    reasons: adapter ? [`Explicit adapter ${adapter.id} supplies the required interface; composition and runtime qualification remain separate.`] : reasons.length ? reasons : [ready ? 'Explicit capability, ports, units, frames, ownership, event order, services and domain agree.' : 'Interface agrees, but the useful source responsibility is not a ready published prefab.'],
    missingBridge};
}

export function discoverReconstructionAlternatives({phase, candidates = [], sourceGame, adapters = [], pairings = []} = {}) {
  const wanted = capabilityIds(phase), seen = new Set(), alternatives = [];
  if (phase?.internalConsumed || phase?.status === 'internal-consumed') return alternatives;
  for (const candidate of candidates) {
    // Reviewed source pairs may identify an opportunity before both interfaces
    // have portable contracts. Evidence and exact target/source/role pins are
    // mandatory; such a row can explain a missing bridge, never admit one.
    const identities = new Set([candidate.id, candidate.moduleId, candidate.sourceSystemId, candidate.recoveredAssembly?.id, ...list(candidate.packageIds)]);
    const pairing = pairings.find(row => row.targetGame === sourceGame && row.sourceGame === candidate.sourceGame && row.roleId === phase?.id
      && ['adapter-required', 'source-evidence-not-portable'].includes(row.state) && list(row.evidence).length
      && list(row.candidateIds).some(id => identities.has(id)) && list(row.missingBridge).length);
    if (!pairing && ![...capabilityIds(candidate)].some(id => wanted.has(id))) continue;
    const key = `${candidate.sourceGame}:${candidate.moduleId || candidate.id}:${candidate.recoveredAssembly?.id || candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const compatibility = assessReconstructionCompatibility({phase, candidate, sourceGame, adapters});
    if (pairing) Object.assign(compatibility, {state:pairing.state === 'source-evidence-not-portable' ? 'source-only' : 'adapter-required',selectable:false,
      reasons:[...list(pairing.reasons), ...compatibility.reasons],missingBridge:[...list(pairing.missingBridge), ...compatibility.missingBridge],reviewEvidence:list(pairing.evidence)});
    alternatives.push({...candidate, id: `${phase.id}__alternative__${candidate.id}`, originalCandidateId: candidate.id,
      reconstructionAlternative: true, compatibility,
      ...(pairing ? {label:pairing.label || candidate.label,scope:pairing.scope || candidate.scope,originalCandidateScope:candidate.scope,contributionScope:pairing.scope,reviewStatus:pairing.reviewStatus} : {}),
      // Preserve the original source and evidence; selecting another implementation
      // intentionally constructs a novel game instead of claiming source parity.
      sourceFaithful: false, runtimeQualified: false,
      recoveredAssembly: candidate.recoveredAssembly ? {...candidate.recoveredAssembly, readyToAdd: compatibility.selectable} : undefined,
      gaps: [...new Set([...list(candidate.gaps), ...compatibility.missingBridge])]});
  }
  return alternatives;
}
