"""Prepare pinned, metadata-only publication batches; never mutate the registry.

Input records use the compiler-owner packet contract. All paths resolve from the
repository root. Native proof is inherited only when generated C is unchanged.
"""
import argparse
import copy
import hashlib
from functools import lru_cache
import json
import re
import platform
import subprocess
import shutil
import time
from pathlib import Path
from lower import lower
from contract import validate, BANNED_KEYS
from publish import effects
from domain import accepts

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'local/ir/fleet-next/publication-intake'
COVERAGE_PRIVATE = ROOT / 'local/ir/mashup-coverage/publication-intake'
REQUIRED = ('l0.json', 'l1.json', 'validation-adapter.json', 'generated.c', 'receipt.json')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def pinned(record):
    path = (ROOT / record['path']).resolve()
    path.relative_to(ROOT)
    if sha(path) != record['sha256']:
        raise ValueError('pin mismatch: ' + record['path'])
    return path


def canonical(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()


def capability_classification(value):
    """Retain source-pinned partial-runtime scope without granting readiness."""
    flags = {'actual_source_entry_install', 'outside_cartridge_qualified',
             'closed_portable_prefab', 'current_or_general_ROM_replacement_eligible',
             'profile_selector_runtime_guard_present'}
    allowed = flags | {'install_scope', 'actual_source_entry_install_evidence'}
    if not isinstance(value, dict) or not value or set(value) - allowed:
        raise ValueError('unsupported capability classification fields')
    if any(type(value[key]) is not bool for key in flags & set(value)):
        raise ValueError('capability classification flags must be booleans')
    if value.get('closed_portable_prefab') or value.get('current_or_general_ROM_replacement_eligible'):
        raise ValueError('partial intake cannot grant closed prefab or general ROM eligibility')
    scope = value.get('install_scope')
    if not isinstance(scope, str) or not scope.strip():
        raise ValueError('capability classification requires explicit scope')
    evidence = value.get('actual_source_entry_install_evidence')
    if value.get('actual_source_entry_install') and not isinstance(evidence, dict):
        raise ValueError('actual source-entry installation requires pinned evidence')
    if evidence is not None:
        pinned(evidence)
    return copy.deepcopy(value)


def semantic(annotation, evidence):
    def check(value):
        if isinstance(value, dict):
            if set(value) & BANNED_KEYS:
                raise ValueError('machine layout key in semantic annotation')
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
    check(annotation)
    if annotation.get('quantity') in (None, '', 'unknown'):
        raise ValueError('annotation must have a sourced quantity')
    unit = annotation.get('unit')
    if not isinstance(unit, dict) or not all(isinstance(unit.get(k), int) and not isinstance(unit[k], bool) and unit[k] > 0 for k in ('numerator', 'denominator')):
        raise ValueError('annotation needs positive rational units')
    if not annotation.get('frame') or annotation['frame'] == 'unknown':
        raise ValueError('annotation needs a sourced frame')
    if not 0 < annotation.get('confidence', 0) <= 1 or not annotation.get('evidence') or not evidence:
        raise ValueError('annotation needs confidence, evidence and pinned source evidence')
    if annotation.get('signed_encoding') not in (None, 'twos_complement'):
        raise ValueError('unsupported signed encoding')
    # Machine locations stay in private source evidence, never semantic ports.
    if re.search(r'\b(?:0x)?0[2389][0-9a-fA-F]{6}\b', json.dumps({k:v for k,v in annotation.items() if k != 'evidence'})):
        raise ValueError('machine address in semantic annotation')
    return copy.deepcopy(annotation)


@lru_cache(maxsize=None)
def source_rom(game):
    index = ROOT / "local/re/roms.json"
    rows = [r for r in json.loads(index.read_text()) if r["id"] == game]
    if len(rows) != 1:
        raise ValueError("source game missing or ambiguous in own-ROM index")
    rom = ROOT / "local/roms" / rows[0]["file"]
    raw = rom.read_bytes()
    if hashlib.sha1(raw).hexdigest() != rows[0]["sha1"]:
        raise ValueError("own-ROM index SHA1 mismatch")
    return hashlib.sha256(raw).hexdigest()


def entry_key(value):
    text = value.lower().removeprefix("0x")
    if not re.fullmatch("[0-9a-f]{8}", text):
        raise ValueError("invalid original entry identity")
    return text


def restricted_state_domains(adapter):
    restricted = []
    for field in adapter.get('fields', []):
        domain = field.get('domain') or {}
        if not domain:
            continue
        bits = field['width']
        if 'signed_min' in domain:
            limited = domain['signed_max'] - domain['signed_min'] + 1 < 1 << bits
        else:
            limited = domain.get('unsigned_min', 0) != 0 or domain.get('unsigned_max', (1 << bits) - 1) != (1 << bits) - 1
        if limited:
            restricted.append({key: field.get(key) for key in ('owner', 'argument', 'register', 'address', 'offset', 'width', 'reference', 'domain')})
    return restricted


def domain_fingerprint(adapter, control_contract=None):
    if adapter.get('normalized_l0_sha256') or adapter.get('return_projection'):
        contract = {'kind': 'source_state_and_abi_domain/1', 'parameters': [{k: p.get(k) for k in ('register', 'type', 'domain')} for p in adapter.get('parameters', [])], 'fields': [{k: field.get(k) for k in ('owner', 'argument', 'register', 'address', 'offset', 'width', 'domain', 'reference')} for field in adapter.get('fields', [])], 'native_abi': adapter.get('native_abi'), 'return_projection': adapter.get('return_projection')}
        if control_contract is not None:
            contract['kind'] = 'source_state_abi_control_domain/1'
            contract['control_contract'] = control_contract
        return canonical(contract)
    if restricted_state_domains(adapter):
        return canonical({'kind': 'source_state_and_parameter_domains/1', 'parameters': [{k: p.get(k) for k in ('register', 'type', 'domain')} for p in adapter.get('parameters', [])], 'restricted_fields': restricted_state_domains(adapter)})
    return canonical([{k: p.get(k) for k in ('name', 'type', 'domain')} for p in adapter.get('parameters', [])])


def existing_roots():
    identities = set()
    fingerprints = set()
    ids = set()
    for path in (ROOT / 'local/ir/packages').glob('*/package.json'):
        package = json.loads(path.read_text())
        ids.add(package['id'])
        l0 = path.parent / 'l0.json'
        if l0.exists() and package.get('origin') != 'automatic_highfunction_linked_sequence':
            l0_document = json.loads(l0.read_text())
            entry = l0_document.get('entry')
            if entry:
                identity = (package['source_game'], entry_key(entry))
                identities.add(identity)
                adapter = path.parent / 'validation-adapter.json'
                if adapter.exists():
                    fingerprints.add(identity + (domain_fingerprint(json.loads(adapter.read_text()), l0_document.get('control_contract')),))
    return identities, ids, fingerprints


def prepare_record(record, destination):
    paths = {name: pinned(record['artifacts'][name]) for name in REQUIRED}
    evidence = [dict(item, path=str(pinned(item).relative_to(ROOT))) for item in record.get('source_evidence', [])]
    l0, l1, adapter, receipt = [json.loads(paths[name].read_text()) for name in ('l0.json', 'l1.json', 'validation-adapter.json', 'receipt.json')]
    entry = entry_key(record['entry'])
    if entry_key(l0.get('entry', '')) != entry or entry_key(adapter.get('entry', '')) != entry:
        raise ValueError('source entry mismatch')
    origin = record.get('origin', 'automatic_highfunction_lift')
    if adapter.get('native_sequence') or l0.get('derivation') or origin not in ('automatic_highfunction_lift', 'automatic_own_ROM_HighFunction_lift', 'automatic_own_ROM_raw_pcode_control_lift', 'automatic_highfunction_state_effects_projection', 'automatic_highfunction_source_dispatch_effects_lift'):
        raise ValueError('declared sequence requires its separate publisher')
    if adapter.get('l0_sha256') != canonical(l0):
        raise ValueError('adapter L0 canonical identity mismatch')
    if receipt.get('proof_inheritance') or receipt.get('native_proof_parent') or receipt.get('reuse') or receipt.get('build_mode') == 'reused-qualified-executable':
        raise ValueError('nested inherited proof requires separate reviewed chain intake')
    if receipt.get('outcome') != 'pass' or receipt.get('parity', {}).get('outcome') != 'pass':
        raise ValueError('native qualification did not pass')
    vectors = receipt['parity'].get('vectors')
    if not isinstance(vectors, int) or vectors <= 0 or not receipt.get('fixture_scope'):
        raise ValueError('missing finite qualification scope')
    if not re.fullmatch('[0-9a-f]{64}', receipt.get('rom_sha256', '')):
        raise ValueError('missing source ROM identity')
    if origin == 'automatic_own_ROM_raw_pcode_control_lift':
        if l0.get('format') != 'gameverse.l0.raw-pcode-bundle/0.1' or l0.get('rom_sha256') != receipt['rom_sha256'] or not isinstance(l0.get('regions'), list) or not l0['regions'] or not isinstance(l0.get('control_contract'), dict) or not l0['control_contract']:
            raise ValueError('raw-pcode source bundle/provenance contract missing')
        if not re.fullmatch('[0-9a-f]{64}', adapter.get('normalized_l0_sha256', '')):
            raise ValueError('raw-pcode adapter needs distinct normalized SSA identity')
        provenance = record['raw_pcode_provenance']
        provenance_paths = {key: pinned(provenance[key]) for key in ('normalized_l0', 'runtime', 'control_contract', 'regeneration_identity')}
        normalized = json.loads(provenance_paths['normalized_l0'].read_text())
        control = json.loads(provenance_paths['control_contract'].read_text())
        regeneration = json.loads(provenance_paths['regeneration_identity'].read_text())
        if canonical(normalized) != adapter['normalized_l0_sha256'] or control != l0['control_contract']:
            raise ValueError('raw-pcode normalized SSA/control identity mismatch')
        if regeneration.get('outcome') != 'pass' or regeneration.get('original_qualified_l1_sha256') != sha(paths['l1.json']) or regeneration.get('original_qualified_generated_c_sha256') != sha(paths['generated.c']):
            raise ValueError('raw-pcode regeneration output identity mismatch')
        if regeneration.get('raw_bundle_canonical_sha256') != canonical(l0) or regeneration.get('normalized_l0_canonical_sha256') != canonical(normalized):
            raise ValueError('raw-pcode regeneration input identity mismatch')
        if pinned(regeneration['raw_source_bundle']) != paths['l0.json']:
            raise ValueError('raw-pcode regeneration bundle mismatch')
        for key in ('normalized_l0', 'runtime', 'control_contract'):
            if pinned(regeneration[key]) != provenance_paths[key]:
                raise ValueError('raw-pcode regeneration provenance mismatch: ' + key)
        for dependency in regeneration['runtime_dependencies']:
            pinned(dependency)
    dispatch_scope = record.get('source_dispatch_effects_scope')
    if origin == 'automatic_highfunction_source_dispatch_effects_lift':
        if adapter.get('return_projection') or l1.get('return_type') != 'void' or adapter.get('return_type') != 'void' or record.get('return_meaning') is not None:
            raise ValueError('source-dispatch effects cannot expose residual return or ARM projection')
        if not isinstance(dispatch_scope, dict) or dispatch_scope.get('kind') != 'thumb_dispatch_r0_overwritten_before_use':
            raise ValueError('source-dispatch effects needs exact reviewed caller witness')
        witness = json.loads(pinned(dispatch_scope['source_routes']).read_text())
        dispatch = witness['scriptDispatch']
        if witness['sourceGame'] != record['source_game'] or witness['rom']['sha256'] != receipt['rom_sha256']:
            raise ValueError('source-dispatch witness source identity mismatch')
        if entry_key(dispatch_scope['handler_entry']) != entry or int(dispatch['thumbTarget'], 16) != int(entry, 16) | 1:
            raise ValueError('source-dispatch handler identity mismatch')
        if dispatch_scope['parser'] != dispatch['parser'] or int(dispatch_scope['handler_table_index']) != int(dispatch['opcode'], 16):
            raise ValueError('source-dispatch parser/table identity mismatch')
        # The reviewed Thumb witness ends with LDR r0, [r5] before any use of the
        # handler residual r0. This bounded metadata view does not qualify r0.
        if dispatch_scope['dispatch_call'] != '0x0807dfca' or dispatch_scope['first_r0_overwrite'] != '0x0807dfd2' or dispatch_scope['witness_bytes'] != '82f794ffb17949002868' or dispatch['returnUse']['romBytesHex'] != dispatch_scope['witness_bytes']:
            raise ValueError('unsupported source-dispatch return-use witness')
        if dispatch['returnUse']['instructionRange'] != '0x0807dfca..0x0807dfd2':
            raise ValueError('source-dispatch return-use range mismatch')
        rows = [r for r in json.loads((ROOT / 'local/re/roms.json').read_text()) if r['id'] == record['source_game']]
        if len(rows) != 1:
            raise ValueError('source-dispatch own-ROM identity missing')
        rom = (ROOT / 'local/roms' / rows[0]['file']).read_bytes()
        start = int(dispatch_scope['dispatch_call'], 16) - 0x08000000
        if rom[start:start + 10].hex() != dispatch_scope['witness_bytes']:
            raise ValueError('source-dispatch ROM instruction witness mismatch')
        first = int.from_bytes(rom[start:start + 2], 'little')
        second = int.from_bytes(rom[start + 2:start + 4], 'little')
        displacement = ((first & 0x7ff) << 12) | ((second & 0x7ff) << 1)
        if displacement & (1 << 22):
            displacement -= 1 << 23
        callee = int(dispatch_scope['dispatch_call'], 16) + 4 + displacement
        if first & 0xf800 != 0xf000 or second & 0xf800 != 0xf800 or callee != 0x08000ef6 or rom[callee - 0x08000000:callee - 0x08000000 + 2].hex() != '1047':
            raise ValueError('source-dispatch Thumb BL/BX r2 target mismatch')
        table = int(dispatch['tableBase'], 16) + int(dispatch_scope['handler_table_index']) * 4
        if table != int(dispatch['romAddress'], 16) or int.from_bytes(rom[table - 0x08000000:table - 0x08000000 + 4], 'little') != int(entry, 16) | 1:
            raise ValueError('source-dispatch ROM table target mismatch')
    elif dispatch_scope:
        raise ValueError('source-dispatch scope requires truthful distinct origin')
    projection = adapter.get('return_projection')
    if origin == 'automatic_highfunction_state_effects_projection':
        if not isinstance(projection, dict) or projection.get('kind') != 'caller_scoped_state_effects_projection' or not projection.get('spans') or not projection.get('basis'):
            raise ValueError('state-effects projection requires original caller proof')
        if l1.get('return_type') != 'void' or adapter.get('return_type') != 'void' or record.get('return_meaning') is not None:
            raise ValueError('state-effects projection cannot expose original return semantics')
        index = json.loads((ROOT / 'local/re/roms.json').read_text())
        rows = [row for row in index if row['id'] == record['source_game']]
        if len(rows) != 1:
            raise ValueError('projection source game identity missing')
        with (ROOT / 'local/roms' / rows[0]['file']).open('rb') as rom:
            for span in projection['spans']:
                address = int(span['address'], 16)
                if not 0x08000000 <= address < 0x0A000000 or type(span['size']) is not int or not 0 < span['size'] <= 4096:
                    raise ValueError('invalid caller proof ROM span')
                rom.seek(address - 0x08000000)
                if hashlib.sha256(rom.read(span['size'])).hexdigest() != span['sha256']:
                    raise ValueError('caller proof ROM span identity mismatch')
    elif projection:
        raise ValueError('caller-scoped projection requires truthful distinct origin')
    if receipt['rom_sha256'] != source_rom(record['source_game']):
        raise ValueError('source game ROM identity mismatch')
    for name in ('l1.json', 'validation-adapter.json', 'generated.c'):
        if receipt.get('artifacts', {}).get(name, {}).get('sha256') != sha(paths[name]):
            raise ValueError('receipt artifact mismatch: ' + name)
    qualification_scope = receipt['fixture_scope']
    scope_evidence = None
    if record.get('qualification_scope'):
        fixture_spec = record['artifacts']['fixtures.json']
        fixture = pinned(fixture_spec)
        capture = receipt.get('capture_fixtures') or {}
        fixture_data = json.loads(fixture.read_text())
        expected_complete = (receipt.get('expected_state_cases') == vectors and receipt.get('expected_collection_cases') == vectors and all(isinstance(fixture_data.get(key), list) and len(fixture_data[key]) == vectors for key in ('states', 'expected_states', 'expected_collections')))
        if sha(fixture) != receipt.get('fixture_input_sha256') or (capture.get('source_case_count') != vectors and not expected_complete):
            raise ValueError('qualification scope clarification requires exact complete native fixture capture or full expected-state/collection matrix')
        qualification_scope = record['qualification_scope']
        if not isinstance(qualification_scope, str):
            raise ValueError('qualification scope must be explicit text')
        scope_evidence = {'fixture_input': fixture_spec, 'capture_context': capture, 'original_harness_scope': receipt['fixture_scope'], 'complete_expected_state_collection_matrix': expected_complete}
    generated = paths['generated.c'].read_text()
    if lower(l1) != generated:
        raise ValueError('qualified C differs from current lowering')
    original = copy.deepcopy(l1)
    fields = {field['name']: field for field in l1['state']}
    for name in record.get('clear_field_annotations', []):
        if name not in fields or name in record.get('field_annotations', {}):
            raise ValueError('unknown or contradictory semantic field clearance')
        fields[name]['semantic_type'] = {'quantity': 'unknown', 'unit': 'unknown', 'frame': 'unknown', 'confidence': 0.0, 'evidence': []}
    for name, annotation in record.get('field_annotations', {}).items():
        if name not in fields:
            raise ValueError('unknown semantic field: ' + name)
        fields[name]['semantic_type'] = semantic(annotation, evidence)
    collections = {collection['name'] for collection in l1.get('collections', [])}
    meanings = {}
    for name, annotation in record.get('collection_meanings', {}).items():
        if name not in collections:
            raise ValueError('unknown semantic collection: ' + name)
        meanings[name] = semantic(annotation, evidence)
    parameter_meanings = {}
    parameters = {p['name']: p for p in l1.get('parameters', [])}
    for name, annotation in record.get('parameter_meanings', {}).items():
        if name not in parameters:
            raise ValueError('unknown semantic parameter: ' + name)
        if annotation.get('storage_type', parameters[name]['storage_type']) != parameters[name]['storage_type']:
            raise ValueError('parameter semantic storage width mismatch: ' + name)
        parameter_meanings[name] = semantic(annotation, evidence)
    return_meaning = None
    if record.get('return_meaning') is not None:
        if l1.get('return_type', 'void') == 'void':
            raise ValueError('void behavior cannot have semantic return port')
        annotation = record['return_meaning']
        if annotation.get('storage_type', l1['return_type']) != l1['return_type'] or annotation.get('type', l1['return_type']) != l1['return_type']:
            raise ValueError('return semantic storage width mismatch')
        return_meaning = semantic(annotation, evidence)
    configurations = copy.deepcopy(record.get('configurations', []))
    configuration_ids = set()
    for configuration in configurations:
        identity = configuration['id']
        if identity in configuration_ids or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*', identity) or not configuration.get('label'):
            raise ValueError('invalid or duplicate source configuration identity')
        configuration_ids.add(identity)
        if configuration.get('source_rom_sha256') != receipt['rom_sha256'] or not configuration.get('provenance') or not evidence:
            raise ValueError('configuration needs exact source ROM/provenance evidence')
        for name, value in configuration['fields'].items():
            if name not in fields or type(value) is not int or not 0 <= value < 1 << int(fields[name]['storage_type'][1:]):
                raise ValueError('invalid fixed source configuration field: ' + name)
            if not accepts(fields[name].get('domain', {}), value, int(fields[name]['storage_type'][1:])):
                raise ValueError('source configuration violates qualified entry domain: ' + name)
        if configuration.get('source_data_ref') is not None:
            data = pinned(configuration['source_data_ref'])
            data_hash = sha(data)
        else:
            data_hash = canonical(configuration['fields'])
        if configuration.get('source_data_sha256') != data_hash:
            raise ValueError('configuration source data identity mismatch')
    validate(l1)
    if lower(l1) != generated:
        raise ValueError('annotations changed executable C')
    # Beyond these metadata slots no mutation is permitted.
    stripped = copy.deepcopy(l1)
    for field, old in zip(stripped['state'], original['state']):
        field['semantic_type'] = old['semantic_type']
    if stripped != original:
        raise ValueError('nonmetadata mutation')
    extras = {}
    for name, spec in record['artifacts'].items():
        if name in REQUIRED:
            continue
        if name in ('native-proof-parent.json', 'package.json', '.', '..') or Path(name).name != name:
            raise ValueError('reserved or unsafe extra artifact name: ' + name)
        extras[name] = pinned(spec)
    destination.mkdir()
    for name, path in paths.items():
        shutil.copy2(path, destination / ('native-proof-parent.json' if name == 'receipt.json' else name))
    save(destination / 'l1.json', l1)
    child = copy.deepcopy(receipt)
    child['schema'] = 'gameverse.ir.qualification/0.2'
    child['proof_inheritance'] = {'kind': 'metadata_only_identical_generated_c', 'parent': 'native-proof-parent.json', 'parent_sha256': sha(paths['receipt.json']), 'parent_l1_sha256': sha(paths['l1.json']), 'generated_c_unchanged': True, 'new_native_calls': 0}
    child['artifacts']['l1.json'] = {'sha256': sha(destination / 'l1.json'), 'bytes': (destination / 'l1.json').stat().st_size}
    save(destination / 'receipt.json', child)
    for name, source in extras.items():
        shutil.copy2(source, destination / name)
    lifecycle = record.get('lifecycle', {'storage': 'component_or_entity_instance', 'clock': 'explicit_invocation', 'phase': 'unknown_requires_source_contract', 'ordering': 'unknown_requires_source_contract'})
    gaps = list(dict.fromkeys(l1.get('limitations', []) + record.get('limitations', []) + ['Finite synthetic native qualification is not gameplay or full-game coverage', 'Source-derived L2 completeness is not claimed']))
    package = {'schema': 'gameverse.executable-component/0.2', 'id': record['id'], 'version': '0.1.0', 'title': record['title'], 'source_game': record['source_game'], 'origin': ('automatic_highfunction_lift' if origin == 'automatic_own_ROM_HighFunction_lift' else origin), 'behavior': 'l1.json', 'behavior_sha256': sha(destination / 'l1.json'), 'qualification': {'status': 'pass', 'receipt': 'receipt.json', 'vectors': vectors, 'scope': qualification_scope, 'kind': ('finite_original_raw_control_subset' if origin == 'automatic_own_ROM_raw_pcode_control_lift' else 'caller_scoped_state_effects_subset' if origin == 'automatic_highfunction_state_effects_projection' else 'caller_dispatch_state_effects_subset' if origin == 'automatic_highfunction_source_dispatch_effects_lift' else 'finite_original_function_subset')}, 'effects': effects(l1), 'field_meanings': {f['name']: f['semantic_type'] for f in l1['state']}, 'collection_meanings': meanings, 'owned_collections': l1.get('collections', []), 'lifecycle': lifecycle, 'gaps': gaps, 'mechanics_role': record['mechanics_role'], 'source_evidence': evidence, 'ports_ready': any(f['semantic_type']['quantity'] != 'unknown' for f in l1['state']) or bool(meanings), 'closure_ready': False, 'dependency_closure': 'finite_function_subset_only_service_and_system_contracts_separate'}
    if scope_evidence is not None:
        package['qualification']['scope_evidence'] = scope_evidence
    if configurations:
        package['configurations'] = configurations
    if origin == 'automatic_own_ROM_raw_pcode_control_lift':
        package['raw_pcode_provenance'] = record['raw_pcode_provenance']
    if return_meaning is not None:
        package['return_meaning'] = return_meaning
        package['ports_ready'] = True
    if parameter_meanings:
        package['parameter_meanings'] = parameter_meanings
        package['ports_ready'] = True
    package['source_root_identity'] = {'source_game': record['source_game'], 'entry': entry}
    package['domain_contract_fingerprint'] = domain_fingerprint(adapter, l0.get('control_contract'))
    package['specialization_subset'] = bool(record.get('allow_domain_specialization')) or bool(restricted_state_domains(adapter)) or origin in ('automatic_own_ROM_raw_pcode_control_lift', 'automatic_highfunction_state_effects_projection')
    package['domain_contract_fingerprint_version'] = ('source_state_abi_control_domain/1' if adapter.get('normalized_l0_sha256') else 'source_state_and_abi_domain/1' if adapter.get('return_projection') else 'source_state_and_parameter_domains/1' if restricted_state_domains(adapter) else 'parameter_domains/1')
    if dispatch_scope:
        package['source_dispatch_effects_scope'] = dispatch_scope
        package['specialization_subset'] = True
        package['domain_contract_fingerprint'] = canonical({'source_dispatch_effects_scope': dispatch_scope, 'parameters': adapter.get('parameters', []), 'fields': adapter.get('fields', []), 'entity_references': adapter.get('entity_references', [])})
        package['domain_contract_fingerprint_version'] = 'source_dispatch_state_and_abi_domain/1'
    if projection:
        package['return_projection'] = projection
    if record.get('capability_classification') is not None:
        package['capability_classification'] = capability_classification(record['capability_classification'])
    if record.get('source_contract'):
        source_contract = record['source_contract']
        if isinstance(source_contract, str) and source_contract.startswith('/'):
            raise ValueError('source contract reference must be repository relative')
        def verify_refs(value):
            if isinstance(value, dict):
                if 'path' in value and 'sha256' in value:
                    pinned(value)
                for child in value.values():
                    verify_refs(child)
            elif isinstance(value, list):
                for child in value:
                    verify_refs(child)
        verify_refs(source_contract)
        package['source_contract'] = source_contract
    if destination.is_relative_to(COVERAGE_PRIVATE):
        package['graph_admission'] = {'required': True, 'status': 'pending_exact_hash_graph_validation_after_publication', 'availability': 'not_yet_graph_admitted'}
    save(destination / 'package.json', package)
    return {'id': record['id'], 'status': ('prepared' if package['ports_ready'] else 'private_semantics_pending'), 'source_game': record['source_game'], 'entry': entry, 'directory': str(destination.relative_to(ROOT)), 'prospective_destination': ('local/ir/packages/' + record['id'] if package['ports_ready'] else None), 'files': {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(destination.iterdir())}, 'new_native_calls': 0}


def prepare(packet_path, out_private_dir):
    start = time.perf_counter()
    packet_path = Path(packet_path).resolve()
    output = Path(out_private_dir).resolve()
    if not any(output.is_relative_to(root) for root in (PRIVATE, COVERAGE_PRIVATE)):
        raise ValueError('output must be an owned private intake directory')
    output.mkdir(parents=True, exist_ok=False)
    packet = json.loads(packet_path.read_text())
    shutil.copy2(packet_path, output / 'input-packet.json')
    identities, ids, fingerprints = existing_roots()
    reports = []
    for record in packet['records']:
        identity = (record['source_game'], entry_key(record['entry']))
        name = record['id']
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', name):
            reports.append({'id': name, 'status': 'rejected', 'error': 'unsafe package id'})
            continue
        specialization = bool(record.get('allow_domain_specialization'))
        fingerprint = None
        if specialization:
            adapter_path = pinned(record['artifacts']['validation-adapter.json'])
            source_l0 = json.loads(pinned(record['artifacts']['l0.json']).read_text())
            fingerprint = domain_fingerprint(json.loads(adapter_path.read_text()), source_l0.get('control_contract'))
        if name in ids or (identity in identities and not specialization) or (specialization and identity + (fingerprint,) in fingerprints):
            reports.append({'id': name, 'status': 'duplicate_skipped', 'source_game': identity[0], 'entry': identity[1]})
            continue
        try:
            reports.append(prepare_record(record, output / name))
            identities.add(identity)
            ids.add(name)
            if fingerprint is not None:
                fingerprints.add(identity + (fingerprint,))
        except (ValueError, KeyError, OSError, TypeError) as error:
            reports.append({'id': name, 'status': 'rejected', 'error': str(error)})
    report = {'schema': 'gameverse.publication-intake/0.1', 'run_id': output.name, 'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'machine': platform.platform(), 'tool_sha256': sha(Path(__file__)), 'packet': {'path': str((output / 'input-packet.json').relative_to(ROOT)), 'sha256': sha(output / 'input-packet.json')}, 'source_packet': {'path': str(packet_path.relative_to(ROOT)), 'sha256': sha(packet_path)}, 'records': reports, 'wall_s': time.perf_counter() - start, 'new_native_calls': 0, 'queue_s': None, 'build_s': None, 'timing_scope': 'artifact validation and private preparation only; no builds or native qualification; no comparable prior baseline', 'shared_registry_writes': 0, 'source_identity_index': {'path': 'local/re/roms.json', 'sha256': sha(ROOT / 'local/re/roms.json')}}
    if output.is_relative_to(COVERAGE_PRIVATE):
        report['graph_admission'] = {'required': True, 'status': 'pending_publication_and_exact_hash_graph_validation', 'availability': 'not_yet_graph_admitted', 'validation_tool': 'tools/behavior_ir/assembly.py', 'required_receipt_status': 'binding_valid_obligations_unproven', 'limitations': 'Binding validation is not native composed lifecycle or whole-system closure'}
    save(output / 'prepared-manifest.json', report)
    return output / 'prepared-manifest.json'


def prepare_projection(packet_path, out_private_dir):
    """Prepare source-contract metadata projections for existing published packages."""
    started = time.perf_counter()
    packet_path = Path(packet_path).resolve()
    output = Path(out_private_dir).resolve()
    output.relative_to(COVERAGE_PRIVATE)
    output.mkdir(parents=True, exist_ok=False)
    packet = json.loads(packet_path.read_text())
    records = []
    for request in packet['records']:
        identity = request['id']
        try:
            source = pinned(request['package'])
            expected = ROOT / 'local/ir/packages' / identity / 'package.json'
            if source != expected.resolve():
                raise ValueError('projection must bind exact published package identity')
            original = json.loads(source.read_text())
            if original['id'] != identity:
                raise ValueError('projection package ID mismatch')
            behavior_path = source.parent / original['behavior']
            behavior = json.loads(behavior_path.read_text())
            receipt_path = source.parent / original['qualification']['receipt']
            receipt = json.loads(receipt_path.read_text())
            if sha(behavior_path) != original['behavior_sha256'] or receipt.get('outcome') != 'pass' or original['qualification']['status'] != 'pass':
                raise ValueError('projection base qualification identity mismatch')
            for name in ('l1.json', 'generated.c', 'validation-adapter.json'):
                if sha(source.parent / name) != receipt['artifacts'][name]['sha256']:
                    raise ValueError('projection base receipt artifact mismatch: ' + name)
            if lower(behavior) != (source.parent / 'generated.c').read_text():
                raise ValueError('projection base lowering mismatch')
            evidence = original.get('source_evidence', [])
            for item in evidence:
                pinned(item)
            candidate = copy.deepcopy(original)
            changes = []
            for key in request['project']:
                if key not in ('return_meaning', 'parameter_meanings'):
                    raise ValueError('unsupported source-contract projection')
                value = original.get('source_contract', {}).get(key)
                if value is None:
                    raise ValueError('source contract lacks explicit ' + key)
                if key == 'return_meaning':
                    if behavior.get('return_type', 'void') == 'void':
                        raise ValueError('void source cannot supply return semantic port')
                    semantic(value, evidence)
                    if value.get('storage_type', behavior['return_type']) != behavior['return_type']:
                        raise ValueError('return projection width mismatch')
                else:
                    parameters = {p['name']: p for p in behavior.get('parameters', [])}
                    for name, meaning in value.items():
                        if name not in parameters:
                            raise ValueError('unknown projected parameter')
                        semantic(meaning, evidence)
                        if meaning.get('storage_type', parameters[name]['storage_type']) != parameters[name]['storage_type']:
                            raise ValueError('parameter projection width mismatch')
                if candidate.get(key) is not None and candidate[key] != value:
                    raise ValueError('projection would replace a different existing semantic contract')
                if candidate.get(key) != value:
                    candidate[key] = copy.deepcopy(value)
                    changes.append(key)
            if not changes:
                records.append({'id': identity, 'status': 'already_projected'})
                continue
            destination = output / identity
            destination.mkdir()
            save(destination / 'package.json', candidate)
            records.append({'id': identity, 'status': 'prepared_metadata_projection', 'changed_keys': changes, 'old_package': {'path': str(source.relative_to(ROOT)), 'sha256': sha(source)}, 'new_package': {'path': str((destination / 'package.json').relative_to(ROOT)), 'sha256': sha(destination / 'package.json')}, 'unchanged_behavior_sha256': sha(behavior_path), 'unchanged_receipt_sha256': sha(receipt_path), 'graph_admission': 'required_after_projection_before_graph_available'})
        except (KeyError, ValueError, TypeError, OSError) as error:
            records.append({'id': identity, 'status': 'rejected', 'error': str(error)})
    report = {'schema': 'gameverse.publication-metadata-projection/0.1', 'packet': {'path': str(packet_path.relative_to(ROOT)), 'sha256': sha(packet_path)}, 'records': records, 'wall_s': time.perf_counter() - started, 'new_native_calls': 0, 'shared_registry_writes': 0, 'timing_scope': 'existing qualification identity checks and metadata copying only; no native or build execution'}
    save(output / 'prepared-projection.json', report)
    return output / 'prepared-projection.json'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--packet', type=Path)
    inputs.add_argument('--metadata-projection', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = prepare_projection(args.metadata_projection, args.out) if args.metadata_projection else prepare(args.packet, args.out)
    print(result)
