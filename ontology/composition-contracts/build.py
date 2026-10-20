#!/usr/bin/env python3
"""Derive binding interfaces and candidate relations from qualified packages.

No package/proof modification, behavior execution, ROM generation or guessed units.
"""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import platform
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent

def read(path):
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()

def semantic_known(meaning):
    unit = meaning.get('unit')
    return (meaning.get('quantity') not in (None, 'unknown')
            and meaning.get('frame') not in (None, 'unknown')
            and isinstance(unit, dict) and isinstance(unit.get('numerator'), int)
            and isinstance(unit.get('denominator'), int) and unit['denominator'] != 0)

def signature(port):
    s = port['semanticType']
    return json.dumps([port['storageType'], s['quantity'], s['unit'], s['frame'], s.get('signed_encoding')], sort_keys=True)

def source_refs(value, pointer=''):
    """Resolve only explicitly named source-contract references, not arbitrary files."""
    keys = {'path', 'ref', 'system', 'source_system', 'source_l2', 'source_l2_contract',
            'sourceL2', 'source_contract_ref', 'source_contract'}
    if isinstance(value, str) and value.startswith('research/') and value.endswith('.json'):
        yield value, None, pointer
    elif isinstance(value, dict):
        for key, child in value.items():
            ptr = pointer + '/' + key.replace('~', '~0').replace('/', '~1')
            if key in keys:
                for ref, expected, child_ptr in source_refs(child, ptr):
                    yield ref, expected or (value.get('sha256') if key in {'path', 'ref'} else None), child_ptr
            elif isinstance(child, (dict, list)):
                yield from source_refs(child, ptr)
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from source_refs(child, pointer + '/' + str(i))

def system_assemblies(components, registry_hash):
    """Link source-owned lifecycle descriptors without promoting their partial cores."""
    known = {c['id']: c for c in components}
    assemblies = []
    for area in ('traversal', 'closure', 'progression'):
        path = ROOT / 'research/ir-workshop/game-system-assembly-20261016' / area / 'system.json'
        if not path.is_file():
            continue
        facts, digest = read(path)
        package_ids = facts.get('packageIds', facts.get('packages', []))
        pins = [{'id': ident, 'status': 'published' if ident in known else 'not-in-current-catalog',
                 'packageSha256': known[ident]['packageSha256'] if ident in known else None,
                 'behaviorSha256': known[ident]['behaviorSha256'] if ident in known else None}
                for ident in package_ids]
        subset = facts.get('executableSubset', {})
        refs = {'assembly': facts.get('assembly') or subset.get('graph'),
                'bindingValidation': subset.get('validation') or ('learning.validation.json' if area == 'progression' else 'damage-reaction.validation.json'),
                'hostVerification': 'verification.json' if area != 'traversal' else 'module-contract-receipt.json'}
        artifacts = {}
        for kind, ref in refs.items():
            if not ref:
                continue
            target = ROOT / ref if ref.startswith('research/') else path.parent / ref
            artifact = {'ref': str(target.relative_to(ROOT)), 'status': 'missing'}
            if target.is_file():
                raw = target.read_bytes()
                artifact.update(status='present', sha256=hashlib.sha256(raw).hexdigest())
                if kind == 'bindingValidation':
                    receipt = json.loads(raw)
                    artifact.update(validationStatus=receipt.get('status'), valid=receipt.get('valid'),
                                    catalogSha256=receipt.get('catalog_sha256'),
                                    receiptCatalogMatchesCurrentCatalog=receipt.get('catalog_sha256') == registry_hash)
                if kind == 'assembly':
                    graph = json.loads(raw)
                    matches = []
                    for instance, node in graph.get('components', {}).items():
                        actual = known.get(node.get('package_id'))
                        matches.append({'instance': instance, 'packageId': node.get('package_id'),
                                        'matchesCurrentPackage': bool(actual and node.get('package_sha256') == actual['packageSha256']),
                                        'matchesCurrentBehavior': bool(actual and node.get('behavior_sha256') == actual['behaviorSha256'])})
                    artifact['componentPins'] = matches
                    artifact['allComponentPinsMatchCurrentCatalog'] = bool(matches) and all(m['matchesCurrentPackage'] and m['matchesCurrentBehavior'] for m in matches)
            artifacts[kind] = artifact
        assemblies.append({'id': facts['id'], 'descriptorRef': str(path.relative_to(ROOT)),
                           'descriptorSha256': digest, 'facts': facts, 'packages': pins, 'artifacts': artifacts,
                           'readiness': 'partial-source-system-with-bounded-executable-core',
                           'wholeSystemExecutable': False, 'runtimeQualified': False,
                           'identityPolicy': 'Expanded existing source lineage; this association does not add a recovered subsystem.',
                           'evidencePolicy': 'Source lifecycle, individual native receipts, binding admission and host assertions have separate scopes. Missing artifacts remain visible; no complete game or composed native parity inferred.'})
    return assemblies

def capability_packets(components):
    """Retain role facets as views over canonical modules, never new instances."""
    known = {c['id']: c for c in components}
    base = ROOT / 'research/ir-workshop/game-system-assembly-20261016'
    paths = list((base / 'mario-capability-bundles').glob('*-bundle.json'))
    paths += [base / area / 'bundles.json' for area in ('movement-capability-bundles', 'combat-progression-bundles')]
    packets = []
    for path in sorted(paths):
        if not path.is_file():
            continue
        facts, digest = read(path)
        bundles = facts.get('bundles', [facts])
        associations = []
        for bundle in bundles:
            assert bundle.get('runtimeQualified') is not True, bundle.get('id')
            associations.append({'id': bundle['id'], 'moduleId': bundle['moduleId'],
                                 'sourceSystemId': bundle.get('sourceSystemId'),
                                 'roleFacets': bundle.get('roleFacets', []),
                                 'packages': [{'id': ident, 'status': 'published' if ident in known else 'not-in-current-catalog',
                                               'packageSha256': known[ident]['packageSha256'] if ident in known else None,
                                               'behaviorSha256': known[ident]['behaviorSha256'] if ident in known else None}
                                              for ident in bundle.get('packageIds', [])]})
        packets.append({'descriptorRef': str(path.relative_to(ROOT)), 'descriptorSha256': digest,
                        'facts': facts, 'associations': associations,
                        'identityPolicy': 'Roles are views of moduleId on the same canonical state; selecting another facet does not allocate another module or actor.',
                        'qualificationPolicy': 'Published constituents and retained graph evidence do not qualify the full bundled lifecycle. Source-only support and missing services remain explicit.'})
    return packets

def build():
    start = time.perf_counter()
    registry_path = ROOT / 'ontology/executable-components/index.json'
    registry, registry_hash = read(registry_path)
    recovered, recovered_hash = read(ROOT / 'ontology/recovered-systems/index.json')
    components, sources, input_groups, output_groups = [], {}, defaultdict(list), defaultdict(list)
    for entry in registry['entries']:
        record_ref = 'ontology/executable-components/' + entry['record']
        record, record_hash = read(ROOT / record_ref)
        manifest_path = ROOT / record['package_ref']
        manifest, manifest_hash = read(manifest_path)
        assert manifest_hash == record['package_sha256'], entry['id']
        behavior_path = manifest_path.parent / manifest['behavior']
        behavior, behavior_hash = read(behavior_path)
        assert behavior_hash == manifest['behavior_sha256'] == record['behavior_sha256']
        receipt, receipt_hash = read(manifest_path.parent / manifest['qualification']['receipt'])
        assert receipt['outcome'] == 'pass' and receipt['artifacts']['l1.json']['sha256'] == behavior_hash
        assert record['qualification']['status'] == 'pass'
        admission = record.get('graph_admission')
        if admission:
            for proof in admission.get('admissions', []):
                assert proof['package_sha256'] == manifest_hash
                assert proof['behavior_sha256'] == behavior_hash
                assert proof['native_receipt_sha256'] == receipt_hash
        fields = {f['name']: f for f in behavior['state']}
        effects = manifest['effects']
        ports, private = [], []
        source_contract = record.get('source_contract', manifest.get('source_contract'))
        source_domains = source_contract.get('domain', {}) if isinstance(source_contract, dict) else {}
        source_ref, resolutions = None, []
        references = list(source_refs(source_contract, '/source_contract')) + list(source_refs(record.get('lifecycle'), '/lifecycle'))
        for ref, expected_hash, pointer in references:
            if ref not in sources and (ROOT / ref).is_file():
                source_facts, source_hash = read(ROOT / ref)
                sources[ref] = {'ref': ref, 'sha256': source_hash, 'facts': source_facts}
            current = sources.get(ref)
            status = ('missing' if not current else ('hash-mismatch-current-source' if expected_hash and expected_hash != current['sha256'] else ('pinned-match' if expected_hash else 'current-source-unpinned-by-package')))
            resolutions.append({'ref': ref, 'expectedSha256': expected_hash, 'actualSha256': current['sha256'] if current else None,
                                'status': status, 'metadataPointer': pointer})
            if current and source_ref is None:
                source_ref = ref
        for declared in record['ports']:
            name = declared['id']
            assert name in fields and declared['storage_type'] == fields[name]['storage_type']
            meaning = manifest.get('field_meanings', {}).get(name, {})
            assert meaning == declared['semantic_type'], (entry['id'], name, 'semantic mismatch')
            reads, writes = name in effects['reads'], name in effects['writes']
            direction = 'inout' if reads and writes else ('out' if writes else 'in')
            assert direction == declared['direction'], (entry['id'], name, 'effect mismatch')
            if not semantic_known(meaning):
                continue
            port = {
                'id': name, 'l1Binding': {'kind': 'field', 'name': name},
                'direction': direction, 'storageType': fields[name]['storage_type'],
                'semanticType': meaning, 'l1Domain': fields[name].get('domain'),
                'sourceDomain': source_domains.get(name) if isinstance(source_domains, dict) else None,
                'sourceOwner': fields[name].get('owner'), 'bindingStatus': 'explicit-binding-required',
                'transferObligation': 'Seed bound mutable state from its canonical slot before invocation so source branches without writes preserve prior values; synchronize declared writes afterward.',
                'directionScope': 'Manifest explicit-effect direction is not proof of unconditional overwrite.',
                'evidence': {'recordRef': record_ref, 'recordPointer': '/ports/' + str(record['ports'].index(declared)),
                             'behaviorRef': str(behavior_path.relative_to(ROOT)), 'behaviorPointer': '/state/' + str(behavior['state'].index(fields[name]))},
            }
            ports.append(port)
            ref = {'component': entry['id'], 'port': name}
            if reads: input_groups[signature(port)].append(ref)
            if writes: output_groups[signature(port)].append(ref)
        public_names = {p['id'] for p in ports}
        for name, definition in fields.items():
            if name not in public_names:
                private.append({'name': name, 'storageType': definition['storage_type'],
                                'sourceOwner': definition.get('owner'), 'semanticType': manifest.get('field_meanings', {}).get(name),
                                'bindingPolicy': 'private-per-instance; never automatically unified'})
        owners = defaultdict(list)
        for name, definition in fields.items():
            owners[definition.get('owner', 'unspecified')].append(name)
        component = {
            'id': entry['id'], 'label': record['label'], 'sourceGame': record['source_game'], 'role': record['role'],
            'packageRef': record['package_ref'], 'packageSha256': manifest_hash, 'behaviorSha256': behavior_hash,
            'readiness': 'native-qualified-subset', 'assemblyStatus': record['assembly_status'],
            'publicPorts': ports, 'privateState': private,
            'stateOwners': [{'sourceOwner': k, 'fields': v, 'scope': 'one explicit component instance; cross-instance identity not inferred'} for k, v in owners.items()],
            'aliasGroups': record.get('state_owners', []),
            'aliasPolicy': 'Source owner labels do not establish alias groups. Opaque fields cannot be auto-unified; public slots require an explicit shared-state decision.',
            'parameters': behavior.get('parameters', []), 'configurations': manifest.get('configurations', []),
            'collections': [{'definition': d, 'semanticType': manifest.get('collection_meanings', {}).get(d['name']),
                             'direction': 'inout' if d['name'] in effects.get('collection_reads', []) and d['name'] in effects.get('collection_writes', []) else ('out' if d['name'] in effects.get('collection_writes', []) else 'in'),
                             'bindingPolicy': 'explicit-whole-collection-binding; exact count/storage/semantic contract required'} for d in behavior.get('collections', [])],
            'returnType': behavior.get('return_type'), 'returnSemantics': manifest.get('return_semantics'),
            'returnMeaning': manifest.get('return_meaning'),
            'returnBindingStatus': 'source-return-meaning-declared' if manifest.get('return_meaning') else 'not-supported-without-return-meaning',
            'lifecycle': record.get('lifecycle'), 'phaseConstraints': record.get('phase_constraints'),
            'dependencies': record.get('dependencies', []), 'l1Preconditions': behavior.get('preconditions', []),
            'limitations': record.get('limitations', []), 'sourceContractRef': source_ref,
            'sourceContractRefs': resolutions,
            'sourceContract': source_contract if not isinstance(source_contract, str) else None,
            'qualification': record['qualification'],
            'graphAdmission': admission,
            'sourceRootIdentity': record.get('source_root_identity'),
            'domainContractFingerprint': record.get('domain_contract_fingerprint'),
            'specializationSubset': record.get('specialization_subset', False),
            'provenance': {'recordRef': record_ref, 'recordSha256': record_hash,
                           'packageSha256': manifest_hash, 'behaviorRef': str(behavior_path.relative_to(ROOT)),
                           'receiptSha256': receipt_hash},
        }
        components.append(component)
    relations = []
    for sig, outputs in output_groups.items():
        for source in outputs:
            for target in input_groups.get(sig, []):
                relations.append({'from': source, 'to': target, 'kind': 'exact-signature-candidate',
                                  'validationStatus': 'not-validated', 'automaticBinding': False,
                                  'instanceConstraint': 'distinct-instances',
                                  'evidence': 'Equal storage, quantity, unit, frame and declared signed encoding; no conversion inferred.',
                                  'requires': ['explicit instance and canonical slot identity', 'all parameter/field domains',
                                               'source alias and packed-view obligations', 'enum and bit-layout identity', 'invocation clock/order/lifecycle',
                                               'service capabilities and side effects', 'actual Composer validation']})
    payload = {
        'schema': 'gameverse.composition-contracts/1',
        'edition': {'kind': 'generic-binding-contract-view', 'historicalRegistryRef': str(registry_path.relative_to(ROOT)),
                    'historicalRegistrySha256': registry_hash, 'historicalRecoveredIndexSha256': recovered_hash,
                    'builderSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        'components': components, 'relations': relations, 'sourceContracts': sources,
        'relationSemantics': {'candidate': 'Matching port signatures are suggestions only; no source-game pair whitelist and no global compatibility claim.',
                              'validated': 'Only an exact submitted graph checked by actual Composer can carry structural validation; lifecycle/domain/service closure must be reported separately.',
                              'opaque': 'Unknown units/frames/quantities remain per-instance private state, never candidate edges.',
                              'order': 'Invocation order is an explicit assembly design; retained source lifecycle constraints do not become a guessed schedule.'},
        'assemblyCapabilities': {'supported': ['ordered component invocations', 'typed owned/shared state slots', 'literal source parameters', 'extracted configurations', 'explicit scalar bindings', 'explicit collection bindings'],
                                 'runtimeServices': [], 'servicePolicy': 'Current symbolic graph validator rejects external runtime services; source service obligations remain explicit and unproven.'},
        'coverageAudit': {'ref': 'research/automatic-ir/mashup-coverage-20261016/coverage-matrix.json',
                          'pinStatus': 'external-admission-wave-updating',
                          'scope': 'Per-package retained graph admission is separate evidence; untested is not rejection, and admission is not runtime L2 qualification.'},
        'counts': {'publishedPackages': len(components), 'publicPorts': sum(len(c['publicPorts']) for c in components),
                   'privateFields': sum(len(c['privateState']) for c in components), 'candidateRelations': len(relations),
                   'validatedGraphs': 0, 'wholeRecoveredExecutableL2': 0},
    }
    examples = []
    for request_path in sorted((OUT / 'examples').glob('*.json')):
        if request_path.name.endswith('.validation.json'):
            continue
        receipt_path = request_path.with_name(request_path.stem + '.validation.json')
        if not receipt_path.is_file():
            continue
        request, request_hash = read(request_path)
        result, result_hash = read(receipt_path)
        if result.get('valid') and result.get('normalized_graph') == request and result.get('catalog_sha256') == registry_hash:
            examples.append({'requestRef': str(request_path.relative_to(ROOT)), 'requestSha256': request_hash,
                             'validationRef': str(receipt_path.relative_to(ROOT)), 'validationSha256': result_hash,
                             'status': result['status'], 'scope': result['validation_scope'],
                             'warnings': result['warnings'], 'statementSha256': result.get('statement_sha256'),
                             'validatorSha256': result.get('validator_sha256'),
                             'nativeComposedQualification': False, 'sourceSchedulerClosure': False})
    payload['examples'] = examples
    payload['gameSystemAssemblies'] = system_assemblies(components, registry_hash)
    payload['capabilityBundlePackets'] = capability_packets(components)
    payload['counts']['validatedGraphs'] = len(examples)
    staging = OUT / '.index.json.tmp'
    staging.write_text(json.dumps(payload, indent=2) + '\n')
    staging.replace(OUT / 'index.json')
    report = {'outcome': 'pass', **payload['counts'], 'wallSeconds': time.perf_counter() - start,
              'scope': 'Pinned package/behavior/receipt/interface checks and candidate metadata only; no behavior, native or ROM execution',
              'indexSha256': hashlib.sha256((OUT / 'index.json').read_bytes()).hexdigest(),
              'builderSha256': payload['edition']['builderSha256'], 'registrySha256': registry_hash,
              'runId': 'composition-contracts-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'),
              'python': sys.version.split()[0], 'machine': platform.platform(),
              'queueSeconds': None, 'nativeExecutionSeconds': None, 'buildSeconds': None,
              'timingScope': 'Local contract read/check/index write only; report context/serialization excluded. No comparable earlier edition baseline exists.'}
    (OUT / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    build()
