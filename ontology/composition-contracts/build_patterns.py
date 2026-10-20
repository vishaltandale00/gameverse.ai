#!/usr/bin/env python3
"""Source/receipt-backed reusable guidance; never generated game presets."""
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent

def read(ref):
    raw = (ROOT / ref).read_bytes()
    return json.loads(raw), {'ref': ref, 'sha256': hashlib.sha256(raw).hexdigest()}

def port_signature(port):
    meaning = port['semanticType']
    return (port['storageType'], meaning.get('quantity'), json.dumps(meaning.get('unit'), sort_keys=True),
            meaning.get('frame'), meaning.get('signed_encoding'))

def port_maps(required, available):
    """Return at most two injective exact mappings; ambiguity never guesses a port."""
    directions = {'in': {'in'}, 'out': {'out'}, 'inout': {'inout'}}
    choices = {p['id']: [q['id'] for q in available if port_signature(p) == port_signature(q)
                           and q['direction'] in directions[p['direction']]] for p in required}
    if any(not options for options in choices.values()):
        return []
    ordered, results = sorted(choices, key=lambda name: len(choices[name])), []
    def search(i, mapping):
        if len(results) >= 2:
            return
        if i == len(ordered):
            results.append(dict(mapping))
            return
        name = ordered[i]
        for target in choices[name]:
            if target not in mapping.values():
                mapping[name] = target
                search(i + 1, mapping)
                del mapping[name]
    search(0, {})
    return results

def collection_maps(required, available):
    mapping = {}
    for need in required:
        definition, meaning = need['definition'], need.get('semanticType')
        hits = [c['definition']['name'] for c in available
                if c['definition']['count'] == definition['count']
                and c['definition']['storage_type'] == definition['storage_type']
                and c.get('semanticType') == meaning and meaning is not None]
        if len(hits) != 1 or hits[0] in mapping.values():
            return None
        mapping[definition['name']] = hits[0]
    return mapping

def blueprint(pattern, components):
    # Intrinsic source capabilities, not game-pair recipes. Matching ports alone
    # cannot turn a countdown decrementer into a minimum-setting behavior.
    capabilities = {
        'jump-onset': ['sma.motion.sma1_jump_onset'],
        'gravity-hover': ['sma.motion.sma1_gravity_hover'],
        'prepare-contact-bounds': ['sma2.player_contact_box', 'sma2.actor_contact_box'],
        'compare-contact-bounds': ['sma2.shared_contact_overlap'],
        'relative-side-query': ['sma2.actor_player_relative_side'],
        'initialize-wait': ['firered.text.wait_initialize'],
        'poll-timed-acknowledgement': ['firered.text.timed_acknowledgement'],
        'set-reaction-minimum': ['mzm.combat.minimum_reaction2', 'mzm.combat.minimum_reaction3'],
        'advance-reaction': ['mzm.combat.reaction_tick'],
        'secure-record-xor-transform': ['leafgreen.persistence.secure_record_decrypt', 'leafgreen.persistence.secure_record_encrypt'],
        'inventory-acquisition': ['aria.progress.category' + str(i) + '_acquire' for i in range(4)],
    }
    role_capabilities = {'jump': 'jump-onset', 'gravity': 'gravity-hover', 'player_box': 'prepare-contact-bounds',
                         'actor_box': 'prepare-contact-bounds', 'overlap': 'compare-contact-bounds',
                         'relative_side': 'relative-side-query', 'waitInit': 'initialize-wait',
                         'timedAck': 'poll-timed-acknowledgement', 'minimum': 'set-reaction-minimum',
                         'tick': 'advance-reaction', 'decode': 'secure-record-xor-transform',
                         'encode': 'secure-record-xor-transform', 'count': 'inventory-count', 'acquire': 'inventory-acquisition'}
    slots = []
    for role in pattern['roles']:
        required = role['id'] != 'relative_side'
        recommendations = []
        anchor = components.get(role.get('package_id'))
        capability = role_capabilities[role['id']]
        if anchor:
            for candidate in components.values():
                if candidate['id'] not in capabilities.get(capability, []):
                    continue
                matches = port_maps(role['requiredPorts'], candidate['publicPorts'])
                collection_mapping = collection_maps(role.get('requiredCollections', []), candidate['collections'])
                if not matches or collection_mapping is None:
                    continue
                if not role['requiredPorts'] and not role.get('requiredCollections') and candidate['id'] != anchor['id']:
                    continue  # An empty interface cannot establish another part's capability.
                exact_anchor = candidate['id'] == anchor['id']
                mapping = {p['id']: p['id'] for p in role['requiredPorts']} if exact_anchor else (matches[0] if len(matches) == 1 else None)
                recommendations.append({'package_id': candidate['id'], 'label': candidate['label'],
                                        'fit': 'exact-contract-candidate', 'portMapping': mapping,
                                        'collectionMapping': collection_mapping, 'needsExplicitMapping': mapping is None,
                                        'adapterNeeds': [], 'runtimeCompatible': False,
                                        'configurationNeeds': ['explicit typed state/owner bindings', 'all source parameter/domain conditions',
                                                               'source alias, enum/bit layout, clock/order and service obligations', 'actual Composer validation'],
                                        'why': [str(len(role['requiredPorts'])) + ' required scalar signatures match exactly.',
                                                'Source semantic annotations identify capability: ' + capability + '.',
                                                'This exact part appears in the retained example.' if exact_anchor else 'Contract fit only; no popularity or source co-occurrence claim for this replacement.'],
                                        'rankEvidence': {'retainedExampleRoleOccurrences': 1 if exact_anchor else 0,
                                                         'matchedRequiredPorts': len(role['requiredPorts']), 'popularity': 'not-measured'},
                                        'provenance': candidate['provenance'], 'parameters': candidate['parameters'],
                                        'capabilityEvidence': {'claim': candidate['label'], 'kind': 'source-semantic-annotation', **candidate['provenance']},
                                        'qualification': candidate['qualification']})
            recommendations.sort(key=lambda c: (-c['rankEvidence']['retainedExampleRoleOccurrences'], c['needsExplicitMapping'], c['package_id']))
        slots.append({'id': role['id'], 'label': role['label'], 'description': role['label'],
                      'required': required, 'minCount': 1 if required else 0, 'maxCount': 1,
                      'cardinalityScope': 'One role instance in this retained motif; deliberate graph extensions are separate roles.',
                      'capability': capability, 'anchor': {'package_id': role.get('package_id'),
                                                              'behaviorSha256': anchor['behaviorSha256'] if anchor else None},
                      'interface': {'ports': role['requiredPorts'], 'collections': role.get('requiredCollections', []),
                                    'parameters': role.get('parameters', [])},
                      'compatibleParts': recommendations,
                      'missingPartReason': None if recommendations else role.get('missingContract', 'No available published part has an evidenced exact interface for this role; adapters or new source contracts are required.'),
                      'ownerOrderServiceObligations': pattern['obligations'], 'chosenInstances': []})
    graph = pattern.get('graph', {})
    return {'goal': pattern['description'], 'startEmpty': True, 'autoFill': False, 'slots': slots,
            'instantiation': {'stateTemplate': graph.get('state', {}),
                              'roleBindings': {name: config.get('bindings', {}) for name, config in graph.get('components', {}).items()},
                              'collectionBindings': {name: config.get('collection_bindings', {}) for name, config in graph.get('components', {}).items()},
                              'sourceOrder': pattern['order'], 'runtimeServices': graph.get('services', []),
                              'referenceInitialization': graph.get('initialize', {}),
                              'policy': 'Templates are configuration references only. Never prepopulate a whole graph: choose parts, resolve exact mappings, rename role-owned state to explicit instances, configure values/domains and validate.'},
            'completionPolicy': {'required': ['required slot cardinalities filled', 'all port/collection mappings explicit',
                                               'all typed state/owners/parameters configured', 'source order/service/domain obligations acknowledged',
                                               'actual Composer response for current graph'],
                                 'bindingValidStatus': 'binding_valid_obligations_unproven',
                                 'runtimeComplete': False, 'sourceOnlyMissingRoleBlocksCompletion': True},
            'nextSteps': [{'kind': 'fill-slot', 'slot': s['id'], 'optional': not s['required']} for s in slots]
                         + [{'kind': 'configure-state-and-mappings'}, {'kind': 'review-order-domains-services'}, {'kind': 'validate-current-graph'}]}

MOTIFS = [
    ('jump-next-gravity', 'Jump, then next gravity phase',
     'Pass a jump onset into the next eligible gravity/hover update through the same velocity and hover state.',
     'research/deep-extraction/mario/parallel-sma1/mashup-coverage/jump-next-gravity.graph.json',
     'local/ir/mashup-coverage/sma1/jump-next-gravity.receipt.json',
     'research/deep-extraction/mario/parallel-sma1/mashup-coverage/coverage.json',
     {'jump': 'Start jump', 'gravity': 'Apply next gravity phase'},
     ['This is a cross-phase sequence. Same-frame source order is gravity before controller/jump.',
      'Grounded/fresh-input admission, intervening terrain/integration and next eligible scheduling remain unproven.']),
    ('prepare-bounds-compare', 'Prepare two bounds, then compare',
     'Prepare two source rectangle views and pass their shared bounds into an overlap query.',
     'local/ir/mashup-coverage/sma2/contact-graph.json',
     'local/ir/mashup-coverage/sma2/admission-result.json',
     'research/deep-extraction/mario/parallel-sma2/mashup-coverage/receipt.json',
     {'player_box': 'Prepare first bounds', 'actor_box': 'Prepare second bounds', 'overlap': 'Compare bounds', 'relative_side': 'Read relative side (diagnostic)'},
     ['Source scene scratch, actor identity and lifetime must remain canonical.',
      'Unknown player form/shape/mode fields remain private default state.',
      'Overlap/relative-side result capture is not supplied by this recorded graph; no hurt/reward lifecycle is implied.']),
    ('initialize-poll-wait', 'Initialize a wait, then poll',
     'Share one source wait counter between initialization and a later acknowledgement poll.',
     'local/ir/mashup-coverage/pokemon-firered-version/graph.json',
     'local/ir/mashup-coverage/pokemon-firered-version/receipt.json',
     'research/deep-extraction/resume/pokemon-firered-version/coverage-pass/result.json',
     {'waitInit': 'Initialize wait state', 'timedAck': 'Poll acknowledgement'},
     ['Initialization belongs to the source token transition; polling is a later state invocation.',
      'The recorded graph does not capture the acknowledgement return or supply input/window/render/audio services.',
      'Private selector default and wait policy are explicit example assumptions.']),
    ('minimum-next-reaction', 'Set a reaction floor, then tick',
     'Carry the same packed marker/countdown byte from a hit guard into the next eligible reaction update.',
     'ontology/composition-contracts/examples/mzm-reaction-transfer.json',
     'ontology/composition-contracts/examples/mzm-reaction-transfer.validation.json',
     'research/deep-extraction/resume/metroid-zero-mission/next-extraction/system.json',
     {'minimum': 'Set reaction minimum', 'tick': 'Advance eligible reaction'},
     ['Low seven countdown bits and the high marker remain one canonical byte.',
      'The next eligible source scheduler phase is an obligation, not a recovered wall-time/frame schedule.',
      'HP/freeze/palette inputs are explicit graph choices; enemy AI, effects, audio and retirement are outside this example.']),
    ('decode-encode-record', 'Decode, inspect, then encode',
     'Share the same record keys and payload words across source decoding and re-encoding; an inspection/edit stage may be added only with a matching contract.',
     'ontology/composition-contracts/examples/secure-record-roundtrip.json',
     'ontology/composition-contracts/examples/secure-record-roundtrip.validation.json',
     'research/deep-extraction/resume/pokemon-leafgreen-version/next-extraction/system.json',
     {'decode': 'Decode record words', 'encode': 'Encode record words'},
     ['Both roles borrow the same record owner and exact key/payload roles.',
      'No inspection/edit component is fabricated; adding one requires explicit compatible bindings.',
      'Checksum, record accessor/permutation, persistence and gameplay reachability are outside this utility graph.']),
]

def build():
    started = time.perf_counter()
    contracts, contracts_pin = read('ontology/composition-contracts/index.json')
    components = {c['id']: c for c in contracts['components']}
    patterns = []
    for ident, label, description, graph_ref, result_ref, source_ref, labels, obligations in MOTIFS:
        graph, graph_pin = read(graph_ref)
        result, result_pin = read(result_ref)
        _, source_pin = read(source_ref)
        assert result.get('valid') and result.get('status') == 'binding_valid_obligations_unproven', ident
        assert result.get('normalized_graph') == graph, (ident, 'receipt does not cover exact graph')
        canonical_hash = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        assert not result.get('request_sha256') or result['request_sha256'] == canonical_hash, (ident, 'stale request pin')
        roles, fields = [], {}
        for role, config in graph['components'].items():
            component = components[config['package_id']]
            assert config['behavior_sha256'] == component['behaviorSha256'], (ident, role, 'stale behavior')
            ports = {p['id']: p for p in component['publicPorts']}
            assert all(name in ports for name in config.get('bindings', {})), (ident, role, 'private binding')
            fields[role] = ports
            roles.append({'id': role, 'label': labels.get(role, component['label']), 'package_id': component['id'],
                          'requiredPorts': [ports[name] for name in config.get('bindings', {})],
                          'requiredCollections': component['collections'], 'parameters': component['parameters'],
                          'parameterArguments': [call.get('arguments', {}) for call in graph['invocations'] if call['component'] == role],
                          'replacementPolicy': 'Exact role/port signature is a candidate only; explicit state, domains, aliases, clock/order, enum/bit layout and services must pass actual Composer validation.',
                          'sourceGame': component['sourceGame']})
        order = [call['component'] for call in graph['invocations']]
        links = []
        for earlier, source in enumerate(order):
            for target in order[earlier + 1:]:
                for output, a in graph['components'][source].get('bindings', {}).items():
                    if fields[source][output]['direction'] not in ('out', 'inout'):
                        continue
                    for input_port, b in graph['components'][target].get('bindings', {}).items():
                        if a['slot'] == b['slot'] and fields[target][input_port]['direction'] in ('in', 'inout'):
                            links.append({'source_role': source, 'output': output, 'target_role': target,
                                          'input': input_port, 'slot': a['slot'], 'status': 'recorded-binding-only'})
        patterns.append({'id': ident, 'label': label, 'description': description,
                         'status': 'validated-binding-example', 'roles': roles, 'links': links,
                         'order': order, 'state': graph['state'], 'obligations': obligations + result.get('warnings', []),
                         'graph': graph, 'evidence': [graph_pin, result_pin, source_pin],
                         'validationStatus': result['status'], 'validationScope': result.get('validation_scope'),
                         'requestCanonicalSha256': canonical_hash,
                         'receiptRequestPinStatus': 'canonical-pin-match' if result.get('request_sha256') else 'exact-normalized-graph-match-legacy-no-request-hash',
                         'validatorSha256': result.get('validator_sha256'), 'recordedCatalogSha256': result.get('catalog_sha256'),
                         'currentValidation': 'revalidation-required', 'runtimeQualified': False,
                         'rankingEvidence': {'retainedGraphObservations': 1, 'retainedSourceDocuments': 1,
                                             'popularity': 'not-measured', 'corpusScope': 'This explicitly retained evidence set, not a corpus-wide frequency estimate.'}})
    aria_ref = 'research/deep-extraction/resume/castlevania-aria-of-sorrow/next-extraction/l2-subsystem.json'
    aria, aria_pin = read(aria_ref)
    pickup_index, pickup = next((i, t) for i, t in enumerate(aria['transitions']) if t['id'] == 'pickup_to_equip')
    assert '080326b8' in pickup['order'][0] and any('0803278c' in s for s in pickup['order'])
    acquire = components['aria.progress.category3_acquire']
    patterns.append({'id': 'count-before-acquire', 'label': 'Check ownership before acquisition',
                     'description': 'The source pickup consumer queries ownership before acquisition and later notifications/equipment effects. The standalone count part is not published in this catalog.',
                     'status': 'source-pattern',
                     'roles': [{'id': 'count', 'label': 'Count owned items (source-only)', 'package_id': None,
                                'sourceFunction': '080326b8', 'availability': 'source-only-not-published',
                                'requiredPorts': [], 'missingContract': 'No published standalone count package/return binding; do not fabricate an output port.'},
                               {'id': 'acquire', 'label': 'Acquire selected inventory category', 'package_id': acquire['id'],
                                'requiredPorts': acquire['publicPorts'], 'requiredCollections': acquire['collections'],
                                'parameters': acquire['parameters'], 'replacementPolicy': 'Same inventory category/index domains and canonical bank aliases required; Composer validation remains mandatory.'}],
                     'links': [], 'order': ['count', 'acquire'],
                     'sourceOrderEvidence': {'ref': aria_ref, 'pointer': '/transitions/' + str(pickup_index), 'value': pickup},
                     'obligations': ['Count role cannot be instantiated from the published library yet.',
                                     'Default acquisition is category3; matching count/category/index and packed-bank alias domains are required.',
                                     'Pickup eligibility, rollback, persistence, equipment/notifications and scheduling remain open.'],
                     'evidence': [aria_pin], 'currentValidation': 'source-only-not-an-executable-graph', 'runtimeQualified': False,
                     'rankingEvidence': {'retainedGraphObservations': 0, 'retainedSourceDocuments': 1, 'popularity': 'not-measured'}})
    for pattern in patterns:
        pattern['presentation'] = 'advanced-internal-only'
        pattern['primaryGameBlueprint'] = False
        pattern['goal'] = pattern['description']
        pattern['blueprint'] = blueprint(pattern, components)
        pattern['blueprint']['isGameSystemPlan'] = False
    payload = {'schema': 'gameverse.assembly-patterns/1', 'compositionContracts': contracts_pin,
               'presentation': 'advanced-internal-only',
               'purpose': 'Reusable internal binding motifs. These are not player-intent plans, complete game systems or primary game blueprints.',
               'patterns': patterns,
               'labels': {'source-pattern': 'SOURCE PATTERN: observed source relation; executable binding may be unavailable.',
                          'validated-binding-example': 'VALIDATED BINDING EXAMPLE: actual Composer receipt; runtime/lifecycle obligations remain.',
                          'candidate-next-piece': 'CANDIDATE NEXT PIECE: exact contract fit or source role suggestion; validate an explicit graph.'},
               'suggestionRules': [
                   {'id': 'complete-observed-role', 'when': 'Selected package matches a retained pattern role.',
                    'suggest': 'Missing roles from that pattern, with exact evidence and all obligations visible.', 'scoreOrder': 1},
                   {'id': 'connect-public-output', 'when': 'Selected node exposes a public output/inout port.',
                    'suggest': 'Exact-signature candidate input roles from compositionContracts.relations; never automatically bind.', 'scoreOrder': 2},
                   {'id': 'required-state', 'when': 'A selected component has unbound public inputs or shared owner obligations.',
                    'suggest': 'Configure an explicit owned/shared typed state slot or choose an evidenced producer.', 'scoreOrder': 3},
                   {'id': 'unmet-order-service', 'when': 'Source order, lifecycle, enum/packed alias or service obligations remain.',
                    'suggest': 'Show the unmet obligation; do not synthesize service adapters, units, clocks or private aliases.', 'scoreOrder': 4}],
               'rankingPolicy': 'Rank retained source-role co-occurrence and exact contract fit; explain the retained evidence count and why. No popularity or usually claim is supported.',
               'counts': {'patterns': len(patterns), 'validatedBindingExamples': len(MOTIFS), 'sourceOnlyPatterns': 1, 'runtimeQualifiedPatterns': 0}}
    staging = OUT / '.patterns.json.tmp'
    staging.write_text(json.dumps(payload, indent=2) + '\n')
    staging.replace(OUT / 'patterns.json')
    report = {'outcome': 'pass', **payload['counts'], 'wallSeconds': time.perf_counter() - started,
              'patternsSha256': hashlib.sha256((OUT / 'patterns.json').read_bytes()).hexdigest(),
              'builderSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'scope': 'Read existing source/graph/receipt pins and exact interface mappings; no native run, model call or ROM generation.'}
    (OUT / 'patterns-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    build()
