"""Preserve FireRed native services and audit their transitive source dependencies.

No same-name Emerald substitution, fabricated service, or success fallback is
permitted. Source staging and executable ABI qualification are distinct gates.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import time

from .scripts import analyze_scripts, rewrite_tokens

TOKEN = re.compile(r"\b[A-Za-z_]\w*\b")
FUNCTION = re.compile(r"(?m)^[ \t]*(?:(?:static|extern|inline|const|unsigned|signed|long|short|struct)\s+)*(?:[A-Za-z_]\w*\s*\**\s+|[A-Za-z_]\w*\s+\*\s*)([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{")


def masked(text: str) -> str:
    """Keep offsets/newlines while hiding comments, strings and characters."""
    return re.sub(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
                  lambda m: ''.join('\n' if c == '\n' else ' ' for c in m[0]), text)


@dataclass(frozen=True)
class Function:
    name: str
    path: str
    start: int
    end: int
    source: str
    static: bool

    @property
    def key(self):
        return f"{self.path}:{self.name}"


def functions(text: str, path: str) -> list[Function]:
    clean = masked(text)
    result = []
    until = 0
    for match in FUNCTION.finditer(clean):
        if match.start() < until:
            continue
        depth, end = 1, match.end()
        while end < len(clean) and depth:
            depth += (clean[end] == '{') - (clean[end] == '}')
            end += 1
        if depth:
            raise ValueError(f"unclosed function {path}:{match[1]}")
        name = match[1]
        if name in {'void', 'int', 'char', 'u8', 'u16', 'u32'}:
            pointer = re.search(r'\(\*\s*(\w+)\s*\(', clean[match.start():match.end()])
            if not pointer:
                continue
            name = pointer[1]
        result.append(Function(name, path, match.start(), end,
                               text[match.start():end], bool(re.search(r'\bstatic\b', clean[match.start():match.end()]))))
        until = end
    return result


def index_sources(root: Path):
    sources, by_name = {}, defaultdict(list)
    for path in sorted((root / 'src').rglob('*.c')):
        relative = path.relative_to(root).as_posix()
        sources[relative] = path.read_text()
        for function in functions(sources[relative], relative):
            by_name[function.name].append(function)
    return sources, by_name


def source_dependency_closure(root: Path, roots: list[str]) -> dict:
    sources, index = index_sources(root)
    pending = [(name, None) for name in roots]
    reached, missing, ambiguous = {}, set(), {}
    while pending:
        name, caller = pending.pop()
        candidates = index.get(name, [])
        local = [f for f in candidates if caller and f.path == caller.path]
        candidates = local or [f for f in candidates if not f.static]
        if not candidates:
            missing.add(name)
            continue
        if len(candidates) != 1:
            ambiguous[name] = [f.key for f in candidates]
            continue
        function = candidates[0]
        if function.key in reached:
            continue
        reached[function.key] = function
        # Both calls and function-pointer callbacks are dependencies.
        pending.extend((token, function) for token in set(TOKEN.findall(masked(function.source)))
                       if token in index and token != function.name)
    rows = []
    for key, function in sorted(reached.items()):
        rows.append({'key': key, 'name': function.name, 'path': function.path,
                     'line': sources[function.path].count('\n', 0, function.start) + 1,
                     'sha256': hashlib.sha256(function.source.encode()).hexdigest(),
                     'static': function.static})
    return {'functions': rows, 'missingRoots': sorted(missing), 'ambiguousSymbols': ambiguous,
            'translationUnits': sorted({f.path for f in reached.values()}),
            '_sources': sources, '_index': index}


# These are exact source extractions, deliberately using donor Kanto starter
# ordering instead of Emerald's Treecko/Torchic/Mudkip mapping.
DIRECT_SERVICES = ('GetStarterSpecies', 'IsStarterFirstStageInParty', 'GetLeadMonIndex',
                   'GetLeadMonFriendship', 'GetPartyMonSpecies', 'GetBattleOutcome',
                   'GetPlayerTrainerIdOnesDigit', 'GetPlayerXY', 'SetHiddenItemFlag',
                   'IsPokerusInParty', 'AreLeadMonEVsMaxedOut', 'LeadMonHasEffortRibbon',
                   'SetVermilionTrashCans', 'CheckAddCoins', 'GetPlayerTrainerId',
                   'IsMonOTIDNotPlayers', 'DoesPlayerPartyContainSpecies', 'IsBadEggInParty',
                   'IncrementResortGorgeousStepCounter', 'RunMassageCooldownStepCounter',
                   'CutMoveRuinValleyCheck', 'CutMoveOpenDottedHoleDoor')


RESIDUAL_SERVICES = ('BrailleCursorToggle', 'ChoosePartyMon', 'DaisyMassageServices',
    'ForcePlayerOntoBike', 'ForcePlayerToStartSurfing', 'GetMartClerkObjectId',
    'GetRandomSlotMachineId', 'IsMonOTNameNotPlayers', 'IsPlayerNotInTrainerTowerLobby',
    'IsThereRoomInAnyBoxForMorePokemon', 'PlayerPartyContainsSpeciesWithPlayerID',
    'SetSeenMon', 'SetUsedPkmnCenterQuestLogEvent', 'ShouldShowBoxWasFullMessage',
    'NullFieldSpecial')


def _declaration(text, name):
    """Retain a complete original static initializer, including nested braces."""
    match = re.search(r'(?m)^static[^\n]*\b' + re.escape(name) + r'\b[^;]*?=', text)
    if not match:
        raise ValueError('missing original native declaration: ' + name)
    cursor, depth = match.end(), 0
    while cursor < len(text):
        char = text[cursor]
        depth += (char == '{') - (char == '}')
        if char == ';' and depth == 0:
            return text[match.start():cursor + 1]
        cursor += 1
    raise ValueError('unterminated original native declaration: ' + name)


def _residual_services(donor, output, index, symbol_map):
    selected = (*RESIDUAL_SERVICES, 'Task_ChoosePartyMon', 'AdjustFriendship',
                'CreateTextCursorSprite', 'DestroyTextCursorSprite', 'SpriteCB_TextCursor')
    bodies = []
    for name in selected:
        candidates = index[name]
        if len(candidates) != 1:
            raise ValueError('ambiguous original service: ' + name)
        bodies.append(candidates[0].source)
    field = (donor / 'src/field_specials.c').read_text()
    pokemon = (donor / 'src/pokemon.c').read_text()
    text = (donor / 'src/text.c').read_text()
    data = '\n'.join(_declaration(field, name) for name in
                     ('sSlotMachineIndices', 'sMartMaps', 'sBrailleTextCursorSpriteID'))
    data += '\n' + _declaration(pokemon, 'sFriendshipEventDeltas')
    data += '\n' + '\n'.join(_declaration(text, name) for name in
        ('sDoubleArrowTiles1', 'sDoubleArrowTiles2', 'sSpriteSheets_TextCursor',
         'sSpritePalettes_TextCursor', 'sSpriteTemplate_TextCursor'))
    mapping = {name: 'FR_' + name for name in selected}
    mapping.update({name: value for name, value in (symbol_map or {}).items()
                    if name.startswith(('VAR_', 'FLAG_', 'MAP_', 'MUS_', 'SE_', 'TRAINER_CLASS_'))})
    mapping.update({'GetPlayerTrainerId': 'FR_GetPlayerTrainerId', 'Random': 'FR_Random',
        'gQuestLogState': 'FR_gQuestLogState', 'QL_STATE_PLAYBACK': 'FR_QL_STATE_PLAYBACK',
        'SetQuestLogEvent': 'FR_SetQuestLogEvent', 'QL_EVENT_USED_PKMN_CENTER': 'FR_QL_EVENT_USED_PKMN_CENTER',
        'SetHelpContext': 'FR_SetHelpContext', 'HELPCONTEXT_SURFING': 'FR_HELPCONTEXT_SURFING',
        'ChoosePartyMonByMenuType': 'FR_ChoosePartyMonByMenuType',
        'PARTY_MENU_TYPE_CHOOSE_SINGLE_MON': 'PARTY_MENU_TYPE_CHOOSE_MON',
        'ItemId_GetHoldEffect': 'GetItemHoldEffect', 'MAP': 'FR_NATIVE_MAP_PAIR'})
    for token in set(TOKEN.findall(masked(data + '\n'.join(bodies)))):
        if token.startswith(('VAR_', 'FLAG_', 'FRIENDSHIP_EVENT_', 'TRAINER_CLASS_')):
            mapping[token] = 'FR_' + token
        elif token.startswith('MAP_') and token not in ('MAP_GROUP', 'MAP_NUM'):
            mapping.setdefault(token, 'MAP_FR_' + token[4:])
        elif token.startswith(('MUS_', 'SE_')):
            mapping[token] = 'FR_' + token
        elif token.startswith('s') and token in ('sSlotMachineIndices', 'sMartMaps', 'sBrailleTextCursorSpriteID',
                'sFriendshipEventDeltas', 'sDoubleArrowTiles1', 'sDoubleArrowTiles2',
                'sSpriteSheets_TextCursor', 'sSpritePalettes_TextCursor', 'sSpriteTemplate_TextCursor'):
            mapping[token] = 'FR_' + token
    headers = ('global.h', 'pokemon.h', 'event_data.h', 'pokemon_storage_system.h',
        'string_util.h', 'pokedex.h', 'overworld.h', 'field_player_avatar.h', 'sound.h',
        'task.h', 'palette.h', 'sprite.h', 'graphics.h', 'item.h', 'item_menu.h', 'battle.h',
        'battle_setup.h', 'main.h', 'party_menu.h', 'script.h', 'data.h', 'constants/rgb.h', 'constants/hold_effects.h', 'constants/pokemon.h',
        'constants/party_menu.h', 'constants/songs.h', 'constants/whole_game_fr_state.h',
        'constants/whole_game_fr_encounters.h', 'constants/whole_game_fr_scripts.h', 'constants/firered_quest_log_map_ids.h',
        'whole_game_fr_quest_log.h', 'whole_game_fr_help_system.h', 'constants/whole_game_fr_help_system.h',
        'firered_native_services.h')
    preamble = '\n'.join('#include "' + name + '"' for name in headers)
    constants = '\n'.join(line for line in (donor / 'include/constants/pokemon.h').read_text().splitlines()
                          if re.match(r'#define\s+FRIENDSHIP_EVENT_', line))
    preamble += '\n' + rewrite_tokens(constants, mapping)
    preamble += '\n#define TAG_CURSOR 0x8000\n#define CURSOR_DELAY 8\n#define sDelay data[0]\n#define sState data[1]\n#define FR_NATIVE_MAP_PAIR(map) MAP_GROUP(map), MAP_NUM(map)\n'
    prototypes = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
    preamble += '\nextern const struct OamData gOamData_AffineOff_ObjNormal_16x16;\nvoid FR_ChoosePartyMonByMenuType(u8);\n'
    native = preamble + rewrite_tokens(prototypes + '\n' + data + '\n' + '\n\n'.join(bodies), mapping) + '\n'
    (output / 'src/firered_native/residual_services.c').write_text(native)
    for asset in ('down_arrow_3', 'down_arrow_4'):
        for source in sorted((donor / 'graphics/fonts').glob(asset + '.*')):
            target = output / source.relative_to(donor)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
    return [{'name': name, 'target': 'FR_' + name, 'status': 'source-ported-compilation-pending',
             'translationUnit': 'src/firered_native/residual_services.c', 'source': index[name][0].path}
            for name in RESIDUAL_SERVICES]


def direct_constant_evidence(donor: Path, base: Path, text: str) -> list[dict]:
    """Audit numeric field/species IDs consumed by the typed host Pokemon API."""
    def numeric_defines(root):
        result = {}
        for relative in ('include/constants/pokemon.h', 'include/constants/species.h', 'include/constants/global.h'):
            for name, value in re.findall(r'(?m)^#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|[0-9]+)\b', (root / relative).read_text()):
                result[name] = int(value, 0)
        enum = re.search(r'enum\s*\{([^}]*MON_DATA_SPECIES_OR_EGG[^}]*)\}', (root / 'include/pokemon.h').read_text(), re.S)
        if enum:
            value = 0
            for entry in masked(enum[1]).split(','):
                entry = entry.strip()
                if not entry:
                    continue
                match = re.fullmatch(r'(\w+)(?:\s*=\s*(\d+))?', entry)
                if not match:
                    raise ValueError('unsupported Pokemon field enum expression: ' + entry)
                if match[2]:
                    value = int(match[2])
                result[match[1]] = value
                value += 1
        return result
    left, right = numeric_defines(donor), numeric_defines(base)
    rows = []
    for name in sorted(set(TOKEN.findall(masked(text)))):
        if name.startswith(('SPECIES_', 'MON_DATA_')) or name in ('NUM_STATS', 'PARTY_SIZE'):
            rows.append({'name': name, 'donor': left.get(name), 'host': right.get(name),
                         'matches': name in left and name in right and left[name] == right[name]})
    if not all(row['matches'] for row in rows):
        raise ValueError('selected native services require a nonidentical Pokemon constant mapping')
    return rows

def stage_native_services(emerald_source: Path, firered_source: Path, output_tree: Path,
                          report_dir: Path | None = None, *, symbol_map: dict[str, str] | None = None,
                          provider_ledgers: list[dict] | None = None) -> dict:
    start = time.monotonic()
    donor, base, output = map(lambda p: Path(p).resolve(), (firered_source, emerald_source, output_tree))
    if any(output == source or output.is_relative_to(source) for source in (donor, base)):
        raise ValueError('output must be outside canonical source trees')
    inventory = analyze_scripts(donor, base)
    roots = [row['name'] for row in inventory['nativeDependencies']]
    closure = source_dependency_closure(donor, roots)
    sources, index = closure.pop('_sources'), closure.pop('_index')
    destination = output / 'src/firered_native'
    destination.mkdir(parents=True, exist_ok=True)
    # Archive complete donor translation units: their static data, preprocessor
    # branches and local macros remain intact rather than regex-reinvented.
    names = {name: 'FR_' + name for name in index}
    names.update(symbol_map or {})
    staged = []
    for relative in closure['translationUnits']:
        target = output / 'firered-native-source' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rewrite_tokens(sources[relative], names))
        staged.append({'source': relative, 'target': target.relative_to(output).as_posix(),
                       'sha256': hashlib.sha256(sources[relative].encode()).hexdigest()})
    # Headers retained verbatim as source/ABI evidence; never shadow Emerald's
    # global.h or reinterpret its SaveBlock structures as donor structures.
    for header in sorted((donor / 'include').rglob('*.h')):
        target = output / 'firered-native-source' / header.relative_to(donor)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(header.read_bytes())
    field = sources['src/field_specials.c']
    table = re.search(r'static const u16 sStarterSpecies\[\]\s*=\s*\{[^}]*\};', field)
    if not table:
        raise ValueError('donor starter species table missing')
    direct = ['GetStarterSpeciesById', 'GetMonEVCount', 'CheckPartyPokerus', 'Random', *DIRECT_SERVICES]
    bodies = []
    for name in direct:
        matches = index[name]
        if len(matches) != 1:
            raise ValueError(f'ambiguous direct native: {name}')
        bodies.append(matches[0].source)
    # Separate prototypes support donor helper ordering without implicit C calls.
    prototypes = [body[:body.index('{')].strip() + ';' for body in bodies]
    preamble = '\n'.join('#include "' + header + '"' for header in
                          ('global.h', 'pokemon.h', 'event_data.h', 'battle.h', 'random.h',
                           'constants/species.h', 'constants/vars.h', 'constants/whole_game_fr_state.h', 'whole_game_state.h',
                           'fieldmap.h', 'field_camera.h', 'field_player_avatar.h', 'script.h', 'sound.h',
                           'constants/songs.h', 'constants/firered_native_metatiles.h'))
    native = preamble + '\n\n' + '\n'.join(prototypes) + '\n\n' + table[0] + '\n\n' + '\n\n'.join(bodies) + '\n'
    # Compile the selected source against host typed state/API declarations;
    # broader donor translation units remain outside the build until ported.
    direct_names = {name: 'FR_' + name for name in direct}
    # Shared typed party/species fields use host constants; do not apply the
    # assembly compiler's blanket donor-constant namespace to C host APIs.
    direct_names.update({name: value for name, value in (symbol_map or {}).items()
                         if name.startswith(('VAR_', 'FLAG_', 'MAP_', 'MUS_', 'SE_'))})
    for token in set(TOKEN.findall(masked(native))):
        if token.startswith(('VAR_', 'FLAG_')):
            direct_names[token] = 'FR_' + token
    direct_names['VAR_STARTER_MON'] = 'FR_VAR_STARTER_MON'
    direct_names.pop('MAP_GROUP', None)
    direct_names.pop('MAP_NUM', None)
    direct_names.setdefault('MAP_SIX_ISLAND_RUIN_VALLEY', 'MAP_FR_SIX_ISLAND_RUIN_VALLEY')
    direct_names['SE_BANG'] = 'FR_SE_BANG'
    direct_names['METATILE_SeviiIslands67_DottedHoleDoor_Open'] = 'FR_METATILE_SeviiIslands67_DottedHoleDoor_Open'
    direct_names['sStarterSpecies'] = 'FR_sStarterSpecies'
    constant_evidence = direct_constant_evidence(donor, base, native)
    native = rewrite_tokens(native, direct_names)
    (destination / 'campaign_services.c').write_text(native)
    residual_providers = _residual_services(donor, output, index, symbol_map)
    include = output / 'include'
    include.mkdir(parents=True, exist_ok=True)
    metatiles = include / 'constants/firered_native_metatiles.h'
    metatiles.parent.mkdir(parents=True, exist_ok=True)
    metatile_match = re.search(r'(?m)^#define\s+METATILE_SeviiIslands67_DottedHoleDoor_Open\s+(0x[0-9A-Fa-f]+)', (donor / 'include/constants/metatile_labels.h').read_text())
    if not metatile_match:
        raise ValueError('Dotted Hole door metatile source constant missing')
    metatiles.write_text('#define FR_METATILE_SeviiIslands67_DottedHoleDoor_Open ' + metatile_match[1] + '\n')
    declarations = '\n'.join(rewrite_tokens(p, direct_names) for p in prototypes if not p.startswith('static '))
    (include / 'firered_native_services.h').write_text('#ifndef GUARD_FIRERED_NATIVE_SERVICES_H\n#define GUARD_FIRERED_NATIVE_SERVICES_H\n#include "global.h"\n' + declarations + '\n#endif\n')
    registry = re.findall(r'(?m)^\s*def_special\s+(\w+)', (donor / 'data/specials.inc').read_text())
    table_text = '.align 2\n.global gFRSpecials\ngFRSpecials:\n' + ''.join('\t.4byte FR_' + name + '\n' for name in registry)
    (output / 'firered-native-source/specials.inc').write_text(table_text)
    base_registry = re.findall(r'(?m)^\s*def_special\s+(\w+)', (base / 'data/specials.inc').read_text())
    special_constants = output / 'data/firered/native_special_ids.inc'
    special_constants.parent.mkdir(parents=True, exist_ok=True)
    last_ids = {name: len(base_registry) + offset for offset, name in enumerate(registry)}
    special_constants.write_text(''.join(f'.set FR_SPECIAL_{name}, {index}\n' for name, index in sorted(last_ids.items())))
    dispatch_path = output / 'data/specials.inc'
    if dispatch_path.exists():
        dispatch = dispatch_path.read_text().split('@ BEGIN FIRERED NATIVE SPECIALS')[0].rstrip() + '\n'
        dispatch += '@ BEGIN FIRERED NATIVE SPECIALS\n' + ''.join('\tdef_special FR_' + name + '\n' for name in registry)
        dispatch_path.write_text(dispatch)
    providers = {}
    for ledger in provider_ledgers or []:
        for provider in ledger.get('providers', []):
            providers[provider['name']] = provider
    native_rows = []
    for row in inventory['nativeDependencies']:
        provider = providers.get(row['name'])
        native_rows.append({**row, 'provider': provider, 'target': 'FR_' + row['name'],
                            'status': ('ported-source-host-abi-review-pending' if row['name'] in DIRECT_SERVICES else
                                       'ported-and-verified' if provider and provider.get('status') == 'ported-and-verified'
                                       else 'source-extracted-abi-pending' if row['name'] in DIRECT_SERVICES else 'dependency-source-staged-abi-pending'),
                            'sourceFunctions': [f.key for f in index.get(row['name'], [])]})
    _, base_index = index_sources(base)
    source_identical = []
    for row in closure['functions']:
        donor_function = next(f for f in index[row['name']] if f.key == row['key'])
        candidates = [f for f in base_index.get(row['name'], []) if f.static == donor_function.static]
        if any(re.sub(r'\s+', '', masked(f.source)) == re.sub(r'\s+', '', masked(donor_function.source)) for f in candidates):
            source_identical.append(row['key'])
    campaign_classes = {
        'oak-rival-party': ['GetStarterSpecies', 'IsStarterFirstStageInParty', 'DoesPlayerPartyContainSpecies'],
        'credits-league': [name for name in roots if re.search(r'League|HallOfFame|Credits|Diploma', name)],
        'sevii-travel': [name for name in roots if re.search(r'Seagallop|Ferry|Resort|Tanoby|Deoxys', name)],
        'field-effects-puzzles': [name for name in roots if re.search(r'Trash|Deoxys|Braille|Dotted|FieldEffect|Surf|Rock|Strength|Cut', name)],
        'quest-log': [name for name in roots if 'QuestLog' in name],
    }
    report = {'directConstantEvidence': constant_evidence, 'campaignClasses': campaign_classes, 'sourceIdenticalSharedCandidates': source_identical, 'schema': 'single-rom-native-services/1', 'status': 'blocked', 'buildEligible': False,
              'campaignComplete': False, 'nativeDependencies': native_rows, 'sourceClosure': closure,
              'stagedTranslationUnits': staged, 'directServices': list(DIRECT_SERVICES), 'providers': residual_providers,
              'specialTable': {'path': 'firered-native-source/specials.inc', 'slots': len(registry),
                               'linked': False, 'preservesDuplicateSlots': True, 'hostOffset': len(base_registry),
                               'constantPath': 'data/firered/native_special_ids.inc', 'dispatchAppended': dispatch_path.exists()},
              'symbolMap': names,
              'blockers': [
                  'Shared Pokemon and trainer SaveBlock field ABI requires explicit verification.',
                  'FR VarGet/FlagSet bindings require donor region bank; no host flag alias is assumed.',
                  'Transitive native globals, static resources, callbacks and donor headers require ABI/resource ports.',
                  'Oak/rival starter source extracted; credits/league, Sevii, field effects and quest puzzle source closure staged, not runtime qualified.',
                  'Original NullFieldSpecial implementations are donor unused registry slots, never replacements for a missing service.'],
              'timing': {'operation': 'native-source-import', 'wallSeconds': time.monotonic() - start,
                         'buildSeconds': None, 'queueSeconds': None, 'baselineSeconds': None,
                         'machine': 'local', 'outcome': 'source-staged-abi-blocked'}}
    target = output / 'firered-native-source/native-services-ledger.json'
    target.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    if report_dir:
        Path(report_dir).mkdir(parents=True, exist_ok=True)
        (Path(report_dir) / 'native-services-ledger.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report


import_native_services = stage_native_services


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emerald-source', type=Path, required=True)
    parser.add_argument('--firered-source', type=Path, required=True)
    parser.add_argument('--output-tree', type=Path, required=True)
    parser.add_argument('--report-dir', type=Path)
    args = parser.parse_args()
    report = stage_native_services(args.emerald_source, args.firered_source, args.output_tree, args.report_dir)
    print(json.dumps({'status': report['status'], 'directServices': len(report['directServices']),
                      'closureFunctions': len(report['sourceClosure']['functions']), 'timing': report['timing']}))


if __name__ == '__main__':
    main()
