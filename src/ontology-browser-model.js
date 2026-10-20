const list = value => Array.isArray(value) ? value : [];
export function ontologyEntries(catalog) {
  const mechanics = list(catalog.games).flatMap(game => list(game.components).filter(component => list(component.evidence).some(e => ['decomp_source','ghidra_function','static_signature'].includes(e.kind))).map(component => ({
    ...component, key: `source:${game.id}:${component.id}`, gameId: game.id, name: component.label || component.id,
    level: 'L1', readiness: 'source-record', executable: false, capabilities: [component.facet].filter(Boolean),
    inputs: component.reads, outputs: component.writes, provenance: component.evidence,
    coverage: { gaps: ['Static source record; no executable qualification is attached to this record.'] }
  })));
  const eligibility = new Map(list(catalog.recoveredSystems?.games).flatMap(game => list(game.automaticComponents)).map(item => [item.contract?.id || item.indexEntry?.id, item.builderEligibility]));
  const qualified = list(catalog.executableComponents).map(component => ({
    ...component, builderEligibility: eligibility.get(component.id) || component.builderEligibility, key: `package:${component.id}`, gameId: component.source_game, name: component.label || component.id,
    level: 'L1', readiness: component.qualification?.status === 'pass' ? 'finite-qualified-subset' : 'qualification-incomplete',
    executable: false, capabilities: [component.role, component.assembly_status].filter(Boolean),
    inputs: list(component.ports).filter(p => ['in','inout'].includes(p.direction)), outputs: list(component.ports).filter(p => ['out','inout'].includes(p.direction)), state: component.owned_state, callOrder: component.phase_constraints, units: list(component.ports).map(p => ({ port: p.id, semantic_type: p.semantic_type })),
    coverage: { gaps: [...list(component.limitations), 'Package availability is not checked. No execution surface is supplied here. Finite qualification does not establish gameplay or whole-system closure.'] }
  }));
  const systems = list(catalog.recoveredSystems?.systems).map(system => ({ ...system, key: `system:${system.id}`, level: 'L2', sourceReadiness: system.readiness, readiness: system.recordKind === 'prior-source-analysis' ? 'prior-source-analysis' : system.readiness, executable: false }));
  return [...systems, ...qualified, ...mechanics];
}
export function filterOntology(entries, { game = '', level = '', capability = '', readiness = '', query = '', taggedOnly = false } = {}, annotations = {}) {
  const needle = query.trim().toLowerCase();
  return entries.filter(e => (!game || e.gameId === game) && (!level || e.level === level) && (!capability || list(e.capabilities).includes(capability)) && (!readiness || e.readiness === readiness) && (!taggedOnly || list(annotations[e.key]?.tags).length) && (!needle || JSON.stringify([e,annotations[e.key]]).toLowerCase().includes(needle)));
}
export function researchSelection(entries, annotations, selectedKeys) {
  return { schema: 'gameverse.ontology-research-selection/1', purpose: 'Source research and local annotations for later assembly; no game creation request.', records: entries.filter(e => selectedKeys.includes(e.key)).map(e => ({ ...e, annotation: annotations[e.key] || { tags: [], notes: '' } })) };
}
export function normalizeAnnotation(tags, notes) {
  return { tags: [...new Set(String(tags).split(',').map(t => t.trim().slice(0,60)).filter(Boolean))].slice(0,20), notes: String(notes).slice(0,4000) };
}

export function assemblySelection(entries, annotations, selectedKeys) {
  const selection = researchSelection(entries, annotations, selectedKeys);
  return { schema: 'gameverse.ontology-assembly-selection/1', status: 'unbound-selection', executable: false,
    purpose: 'Selected source contracts for downstream assembly; bindings and compatibility remain unresolved.',
    members: selection.records,
    compatibility: { status: 'not-validated', required: ['Resolve state ownership and aliases', 'Bind inputs, outputs and collection ports', 'Validate parameter domains and unit conversions', 'Establish invocation order, clock and lifecycle', 'Resolve dependencies and retained runtime services', 'Check exact package availability and qualification identity'] },
    presetGeneratorSupport: 'not-evaluated', buildRequest: null };
}
export function compareContractPorts(source, target) {
  const outputs = list(source?.ports).filter(p => ['out','inout'].includes(p.direction));
  const inputs = list(target?.ports).filter(p => ['in','inout'].includes(p.direction));
  return outputs.flatMap(output => inputs.map(input => {
    const a=output.semantic_type, b=input.semantic_type;
    let status='unknown', reason='Semantic quantity, unit or frame is missing or unknown.';
    if(a?.quantity&&b?.quantity&&a?.frame&&b?.frame&&a?.unit&&b?.unit&&[a.unit.numerator,a.unit.denominator,b.unit.numerator,b.unit.denominator].every(Number.isFinite)&&a.unit.denominator>0&&b.unit.denominator>0&&![a.quantity,b.quantity,a.frame,b.frame].some(v=>v==='unknown')) {
      if(JSON.stringify(a.signed_encoding)!==JSON.stringify(b.signed_encoding)){status='incompatible';reason='Declared signed encoding differs or is missing on one side; no evidenced signed representation conversion is supplied.';}
      else if(a.quantity!==b.quantity||a.frame!==b.frame){status='incompatible';reason='Declared quantity or coordinate frame differs.';}
      else if(output.storage_type!==input.storage_type||a.unit.numerator*b.unit.denominator!==b.unit.numerator*a.unit.denominator){status='adapter-required';reason='Declared quantity/frame matches; storage or unit scale differs. An evidenced domain/conversion is required.';}
      else {status='candidate';reason='Declared storage, quantity, unit scale and frame match. Ownership, domain, timing and behavior compatibility are unvalidated.';}
    }
    return {output:output.id,input:input.id,status,reason};
  }));
}
