"""Conservative, source-proven FireRed special bindings to shared Emerald systems.

Every binding needs an exact public signature/body match plus an explicit
capability contract for touched state, constants, and transitive helpers.
Unproven services remain on the frontier; there are no success fallbacks.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

from .native_services import (direct_constant_evidence, functions, index_sources, masked)
from .scripts import analyze_scripts


# Audited capability boundaries.  These are the deliberately shared native
# subsystems in this cartridge, not an assumption that same names are equal.
# The matcher still rejects a contract when source bodies/signatures drift.
CONTRACTS = {
    'CalculatePlayerPartyCount': ('shared-party', {'gPlayerParty', 'gPlayerPartyCount'}, {'GetMonData'}, ()),
    'LoadPlayerParty': ('shared-party-save', {'gPlayerParty', 'gPlayerPartyCount', 'gSaveBlock1Ptr'}, set(), ()),
    'SavePlayerParty': ('shared-party-save', {'gPlayerParty', 'gPlayerPartyCount', 'gSaveBlock1Ptr'}, set(), ()),
    'LoadPlayerBag': ('shared-bag-save', {'gLoadedSaveData', 'gSaveBlock1Ptr', 'gSaveBlock2Ptr', 'gLastEncryptionKey'}, set(), ()),
    'GetPlayerFacingDirection': ('shared-object-events', {'gObjectEvents', 'gPlayerAvatar'}, set(), ()),
    'GetTrainerBattleMode': ('shared-battle-mode', {'sTrainerBattleMode'}, set(), ()),
    'IsEnoughForCostInVar0x8005': ('shared-money', {'gSaveBlock1Ptr', 'gSpecialVar_0x8005'}, {'IsEnoughMoney'}, ('IsEnoughMoney', 'GetMoney')),
    'SubtractMoneyFromVar0x8005': ('shared-money', {'gSaveBlock1Ptr', 'gSpecialVar_0x8005'}, {'RemoveMoney'}, ('RemoveMoney', 'GetMoney', 'SetMoney')),
    'Script_FadeOutMapMusic': ('shared-field-audio', set(), {'Overworld_FadeOutMapMusic', 'CreateTask'}, ('Overworld_FadeOutMapMusic', 'CreateTask', 'Task_EnableScriptAfterMusicFade')),
}

PRIMITIVE_BOUNDARIES = {
    'GetMonData': 'shared native Pokemon data API; MON_DATA numeric IDs verified',
}

SIGNATURE = re.compile(r'^\s*(void|bool8|u8|u16|u32|s8|s16|s32)\s+([A-Za-z_]\w*)\s*\(\s*void\s*\)\s*$', re.S)
CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
GLOBAL = re.compile(r'\b[gs][A-Z]\w*\b')
EXCLUDED_CALLS = {'if', 'while', 'for', 'switch', 'sizeof', 'return'}
BAG_COUNTS = ('BAG_ITEMS_COUNT', 'BAG_KEYITEMS_COUNT', 'BAG_POKEBALLS_COUNT',
              'BAG_TMHM_COUNT', 'BAG_BERRIES_COUNT', 'MAIL_COUNT')


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _normal(text: str) -> str:
    return re.sub(r'\s+', '', masked(text))


def _public(index: dict, name: str):
    candidates = [function for function in index.get(name, ()) if not function.static]
    return candidates[0] if len(candidates) == 1 else None


def _signature(function):
    match = SIGNATURE.fullmatch(function.source.split('{', 1)[0])
    return (match[1], match[2]) if match else None


def _effect_tokens(function):
    body = masked(function.source.split('{', 1)[1])
    calls = set(CALL.findall(body)) - EXCLUDED_CALLS
    globals_ = set(GLOBAL.findall(body))
    # Function-pointer callbacks are not call tokens; track source references.
    tokens = set(re.findall(r'\b[A-Za-z_]\w*\b', body))
    return calls, globals_, tokens


def _helper_proof(name, donor_index, base_index):
    donor = _public(donor_index, name)
    base = _public(base_index, name)
    if donor is None or base is None:
        # Some exact task callbacks are static in both original units.
        dc, bc = donor_index.get(name, ()), base_index.get(name, ())
        if len(dc) != 1 or len(bc) != 1 or not dc[0].static or not bc[0].static:
            return None
        donor, base = dc[0], bc[0]
    if _normal(donor.source) != _normal(base.source):
        return None
    return {'name': name, 'donor': donor.key, 'host': base.key,
            'donorSha256': _sha(donor.source), 'hostSha256': _sha(base.source)}


def _bag_capacity_proof(donor: Path, output: Path):
    donor_header = donor / 'include/constants/global.h'
    staged_header = output / 'include/constants/global.h'
    if not staged_header.is_file():
        return None
    def counts(path):
        source = path.read_text()
        result = {}
        party = re.search(r'^#define\s+PARTY_SIZE\s+(\d+)\b', source, re.M)
        if party is None:
            return None
        for name in BAG_COUNTS:
            match = re.search(r'^#define\s+' + name + r'\s+([^\n]+)', source, re.M)
            if match is None:
                return None
            expression = re.sub(r'\bPARTY_SIZE\b', party[1], match[1].strip())
            if re.search(r'[^\d\s+()]', expression):
                return None
            # Count macros are source-owned integer additions, not arbitrary code.
            result[name] = sum(int(part) for part in re.findall(r'\d+', expression))
        return result
    donor_counts, staged_counts = counts(donor_header), counts(staged_header)
    if donor_counts is None or staged_counts is None:
        return None
    if any(staged_counts[name] < donor_counts[name] for name in BAG_COUNTS):
        return None
    return {'donor': donor_counts, 'staged': staged_counts,
            'donorHeaderSha256': hashlib.sha256(donor_header.read_bytes()).hexdigest(),
            'stagedHeaderSha256': hashlib.sha256(staged_header.read_bytes()).hexdigest()}


def _heal_party_compatibility(base: Path, donor: Path, base_index: dict, donor_index: dict):
    """Prove only the field domain reached by HealPlayerParty, not all Pokemon APIs.

    The campaign stage currently supplies the executable donor body.  This
    proof records that the shared native party API has identical behavior for
    precisely the getter/setter cases used by that body, under the selected
    native Pokemon layout and storage policy.
    """
    name = 'HealPlayerParty'
    donor_fn, host_fn = _public(donor_index, name), _public(base_index, name)
    if donor_fn is None or host_fn is None or _normal(donor_fn.source) != _normal(host_fn.source):
        return None
    domains = {
        'GetMonData3': ('MAX_HP',),
        'GetBoxMonData3': ('PP_BONUSES', 'MOVE1'),
        'SetMonData': ('HP', 'STATUS'),
        'SetBoxMonData': ('PP1',),
    }
    cases = []
    for function_name, fields in domains.items():
        donor_service, host_service = _public(donor_index, function_name), _public(base_index, function_name)
        if donor_service is None or host_service is None:
            return None
        for field in fields:
            pattern = r'case\s+MON_DATA_' + field + r'\s*:[\s\S]*?break;'
            left = re.search(pattern, donor_service.source)
            right = re.search(pattern, host_service.source)
            if left is None or right is None or _normal(left[0]) != _normal(right[0]):
                return None
            cases.append({'service': function_name, 'field': 'MON_DATA_' + field,
                          'donorSha256': _sha(left[0]), 'hostSha256': _sha(right[0])})
    pp = _helper_proof('CalculatePPWithBonus', donor_index, base_index)
    if pp is None:
        return None
    constant_names = ('MON_DATA_MAX_HP', 'MON_DATA_PP_BONUSES', 'MON_DATA_MOVE1',
                      'MON_DATA_PP1', 'MON_DATA_HP', 'MON_DATA_STATUS')
    constants = {}
    for source_root, label in ((donor, 'donor'), (base, 'host')):
        source = (source_root / ('include/constants/pokemon.h' if label == 'donor'
                                  else 'include/pokemon.h')).read_text()
        constants[label] = {}
        enum_values = {}
        if label == 'host':
            enum_body = re.search(r'// Property labels for Get\(Box\)MonData / Set\(Box\)MonData\s*enum\s*\{([^}]+)\}', source, re.S)
            if enum_body is None:
                return None
            for index, token in enumerate(enum_body[1].split(',')):
                token = token.strip()
                if re.fullmatch(r'MON_DATA_[A-Z0-9_]+', token):
                    enum_values[token] = index
        for constant in constant_names:
            if label == 'host':
                if constant not in enum_values:
                    return None
                constants[label][constant] = enum_values[constant]
            else:
                match = re.search(r'^#define\s+' + constant + r'\s+(\d+)\b', source, re.M)
                if match is None:
                    return None
                constants[label][constant] = int(match[1])
        global_source = (source_root / 'include/constants/global.h').read_text()
        move_count = re.search(r'^#define\s+MAX_MON_MOVES\s+(\d+)\b', global_source, re.M)
        if move_count is None:
            return None
        constants[label]['MAX_MON_MOVES'] = int(move_count[1])
    if constants['donor'] != constants['host'] or constants['host']['MAX_MON_MOVES'] != 4:
        return None
    return {'name': name, 'target': 'FR_' + name, 'status': 'compatible-supplied-elsewhere',
            'selectedProvider': 'campaign_services', 'capability': 'shared-native-party-bounded-field-domain',
            'donor': donor_fn.key, 'host': host_fn.key,
            'donorSha256': _sha(donor_fn.source), 'hostSha256': _sha(host_fn.source),
            'fieldCases': cases, 'numericIds': constants, 'ppHelper': pp,
            'policy': 'Emerald Pokemon layout/storage is authoritative; donor healing body is supplied by campaign_services.'}


def _check(name, base, donor, output, base_index, donor_index):
    contract = CONTRACTS.get(name)
    if contract is None:
        return None, 'no-audited-capability-contract'
    capability, allowed_globals, allowed_calls, helper_names = contract
    donor_fn, host_fn = _public(donor_index, name), _public(base_index, name)
    if donor_fn is None or host_fn is None:
        return None, 'missing-or-ambiguous-public-source-definition'
    donor_sig, host_sig = _signature(donor_fn), _signature(host_fn)
    if donor_sig is None or donor_sig != host_sig or donor_sig[1] != name:
        return None, 'signature-mismatch-or-unsupported-parameters'
    if _normal(donor_fn.source) != _normal(host_fn.source):
        return None, 'source-body-differs'
    bag_capacity = None
    if name == 'LoadPlayerBag':
        bag_capacity = _bag_capacity_proof(donor, output)
        if bag_capacity is None:
            return None, 'staged-shared-bag-capacity-below-donor-or-unproved'
    calls, globals_, tokens = _effect_tokens(donor_fn)
    if calls - allowed_calls or globals_ - allowed_globals:
        return None, 'effect-outside-contract:' + ','.join(sorted((calls - allowed_calls) | (globals_ - allowed_globals)))
    if any(token.startswith(('FLAG_', 'VAR_', 'MAP_', 'FR_')) for token in tokens):
        return None, 'regional-flag-var-map-reference'
    helpers = []
    for helper in helper_names:
        proof = _helper_proof(helper, donor_index, base_index)
        if proof is None:
            return None, 'transitive-helper-differs:' + helper
        helpers.append(proof)
    for primitive in calls & PRIMITIVE_BOUNDARIES.keys():
        helpers.append({'name': primitive, 'contract': PRIMITIVE_BOUNDARIES[primitive]})
    if 'Task_EnableScriptAfterMusicFade' in tokens and 'Task_EnableScriptAfterMusicFade' not in helper_names:
        return None, 'unproved-function-pointer-callback'
    try:
        constants = direct_constant_evidence(donor, base, donor_fn.source)
    except ValueError:
        return None, 'numeric-pokemon-id-differs'
    return {'name': name, 'target': 'FR_' + name, 'capability': capability,
            'signature': donor_sig[0] + ' ' + name + '(void)',
            'donor': donor_fn.key, 'host': host_fn.key,
            'donorSha256': _sha(donor_fn.source), 'hostSha256': _sha(host_fn.source),
            'globals': sorted(globals_), 'calls': sorted(calls),
            'helpers': helpers, 'numericIds': constants,
            **({'bagCapacity': bag_capacity} if bag_capacity is not None else {})}, None


def _wrapper(proof):
    return_type, name = proof['signature'].split(' ', 1)
    name = name[:-6]  # remove '(void)'
    statement = f'{name}();' if return_type == 'void' else f'return {name}();'
    return f'extern {return_type} {name}(void);\n{return_type} FR_{name}(void)\n{{\n    {statement}\n}}\n'


def _staged_host_proof(proof: dict, output: Path, base_index: dict):
    path, name = proof['host'].split(':', 1)
    staged = output / path
    if not staged.is_file():
        return None
    candidates = [function for function in functions(staged.read_text(), path)
                  if function.name == name and not function.static]
    original = _public(base_index, name)
    if len(candidates) != 1 or original is None or _normal(candidates[0].source) != _normal(original.source):
        return None
    return {'path': path, 'sha256': _sha(candidates[0].source)}


def stage_shared_services(base: Path, donor: Path, output: Path, report_dir: Path) -> dict:
    started = time.monotonic()
    base, donor, output, report_dir = map(Path, (base, donor, output, report_dir))
    if output.resolve() in (base.resolve(), donor.resolve()) or base.resolve() in output.resolve().parents or donor.resolve() in output.resolve().parents:
        raise ValueError('shared services output must be isolated')
    if not (output / 'src').is_dir():
        raise ValueError('staged native source is required')
    inventory = analyze_scripts(donor, base)
    _, donor_index = index_sources(donor)
    _, base_index = index_sources(base)
    rows, accepted = [], []
    external_compatibility = _heal_party_compatibility(base, donor, base_index, donor_index)
    for dependency in sorted(inventory['nativeDependencies'], key=lambda row: row['name']):
        name = dependency['name']
        if name == 'HealPlayerParty' and external_compatibility:
            rows.append({'name': name, **external_compatibility})
            continue
        proof, reason = _check(name, base, donor, output, base_index, donor_index)
        if proof:
            staged_host = _staged_host_proof(proof, output, base_index)
            if staged_host is None:
                proof, reason = None, 'staged-host-body-drift-or-missing'
            else:
                proof['stagedHost'] = staged_host
        if proof:
            accepted.append(proof)
            rows.append({'name': name, 'status': 'accepted-source-proven', **proof})
        else:
            rows.append({'name': name, 'target': 'FR_' + name,
                         'status': 'rejected-unproven', 'reason': reason})
    target = output / 'src/whole_game_shared_services.c'
    names = {proof['target'] for proof in accepted}
    if names:
        definitions = re.compile(r'\b(' + '|'.join(re.escape(name) for name in sorted(names))
                                 + r')\s*\([^;{}]*\)\s*\{')
        for source in sorted((output / 'src').rglob('*.c')):
            if source == target:
                continue
            conflict = definitions.search(masked(source.read_text()))
            if conflict:
                raise ValueError(f'existing staged provider conflicts with {conflict[1]} in {source}')
    target.write_text('#include "global.h"\n'
                      + '\n'.join(_wrapper(proof) for proof in accepted))
    providers = [{'name': proof['name'], 'target': proof['target'],
                  'status': 'source-ported-compilation-pending',
                  'source': proof['donor'], 'translationUnit': 'src/whole_game_shared_services.c',
                  'bindings': [proof['capability'], 'exact signature/body', 'audited shared state/helpers/IDs']}
                 for proof in accepted]
    ledger = {'schema': 'single-rom-shared-services/1', 'component': 'shared_services',
              'status': 'partial', 'buildEligible': False,
              'acceptedCount': len(accepted),
              'rejectedCount': sum(row['status'] == 'rejected-unproven' for row in rows),
              'compatibleExternalCount': int(external_compatibility is not None),
              'accepted': accepted, 'compatibleExternal': [external_compatibility] if external_compatibility else [],
              'frontier': rows, 'providers': providers,
              'changed_files': [target.relative_to(output).as_posix()],
              'blockers': ['Accepted C wrappers require actual GBA compile/link and gameplay qualification.',
                           'Every rejected reachable native service retains a missing provider until source ported.'],
              'timing': {'wallSeconds': time.monotonic() - started, 'buildSeconds': None,
                         'outcome': 'source-proof-and-binding-staged'}}
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / 'shared-services-ledger.json').write_text(json.dumps(ledger, indent=2, sort_keys=True) + '\n')
    return ledger
