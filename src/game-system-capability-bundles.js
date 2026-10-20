// A module may contribute several responsibilities while retaining one actor,
// world backing and prefab instance. Facet availability is role-specific.
export const gameSystemModuleId = candidate => candidate.moduleId || candidate.sourceSystemId || candidate.recoveredAssembly?.id || candidate.id;
export const gameSystemRoleFacet = (candidate, roleId) => candidate.roleFacets?.find(facet => facet.roleId === roleId) || null;

export function attachCapabilityBundles(plans, bundles) {
  for (const plan of plans) for (const role of plan.roles) {
    for (const candidate of role.candidates) candidate.moduleId ||= gameSystemModuleId(candidate);
    for (const bundle of bundles) {
      if (Array.isArray(bundle.planIds) && !bundle.planIds.includes(plan.id)) continue;
      const facet = bundle.roleFacets?.find(item => item.roleId === role.id);
      const knownCandidates = [...(bundle.existingCandidateIds || []), ...(bundle.sourceOnlyCandidateIds || [])];
      const existing = role.candidates.filter(candidate => knownCandidates.includes(candidate.id) || (candidate.recordKind === 'source-blueprint-anchor' && facet && candidate.sourceSystemId && candidate.sourceSystemId === bundle.sourceSystemId));
      for (const candidate of existing) {
        if (candidate.recordKind === 'source-blueprint-anchor' && facet) {
          Object.assign(candidate, {recordKind: 'integrated-source-module', label: facet.label || bundle.label, availability: facet.status, scope: facet.scope, description: facet.scope, packageIds: facet.status === 'published-subset' ? bundle.packageIds || [] : [], gaps: [...new Set([...(bundle.gaps || []), ...(facet.gaps || [])])], evidence: [...new Set([...(bundle.evidence || []), ...(facet.evidence || [])])]});
        }
        Object.assign(candidate, {moduleId: bundle.moduleId || bundle.sourceSystemId, roleFacets: bundle.roleFacets, canonicalState: bundle.canonicalState, sourceOrder: bundle.sourceOrder, missingServices: bundle.missingServices});
        if (candidate.availability === 'published-subset' && bundle.recoveredAssembly) candidate.recoveredAssembly = {...bundle.recoveredAssembly, ...(candidate.recoveredAssembly || {})};
        if (bundle.assemblyVariants) candidate.assemblyVariants = bundle.assemblyVariants;
        if (bundle.settings) candidate.settings = bundle.settings;
        if (facet) candidate.roleAvailability = candidate.availability;
      }
      if (!facet || existing.length) continue;
      // Facets are intentionally listed in each fitting role; the UI reuses the
      // same moduleId/instance and never duplicates its shared backing.
      const id = `${bundle.id}__${role.id}`;
      if (role.candidates.some(candidate => candidate.id === id)) continue;
      const recoveredAssembly = bundle.recoveredAssembly ? {...bundle.recoveredAssembly, readyToAdd: facet.status === 'published-subset' && bundle.recoveredAssembly.readyToAdd === true} : undefined;
      role.candidates.push({...bundle, recoveredAssembly, id, moduleId: bundle.moduleId || bundle.sourceSystemId,
        label: facet.label || bundle.label,
        availability: facet.status, roleAvailability: facet.status,
        packageIds: facet.status === 'published-subset' ? bundle.packageIds || [] : [],
        scope: facet.scope, description: facet.scope,
        evidence: [...new Set([...(bundle.evidence || []), ...(facet.evidence || [])])],
        gaps: [...new Set([...(bundle.gaps || []), ...(facet.gaps || [])])],
        runtimeQualified: false,
      });
    }
  }
  return plans;
}
