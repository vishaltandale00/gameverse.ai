"""Original FireRed encounter data in an isolated Emerald source tree.

Imports data losslessly, using Emerald's native party/battle engine. A successful
transform is not gameplay certification: source-specific runtime gates are listed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import time

TRAINER_OFFSET = 4096
PIC_OFFSET = 93
CLASS_OFFSET = 66
TOKEN = re.compile(r'\b[A-Za-z_]\w*\b')


def rewrite(text, symbols):
    parts = re.split(r'("(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/)', text)
    return ''.join(p if i % 2 else TOKEN.sub(lambda m: symbols.get(m[0], m[0]), p) for i, p in enumerate(parts))


def definitions(text, prefix):
    return {n: int(v, 0) for n, v in re.findall(r'^#define\s+(' + prefix + r'\w*)\s+(0x[\da-fA-F]+|\d+)\s*(?://.*)?$', text, re.M)}


def array_span(text, name):
    match = re.search(r'\b' + re.escape(name) + r'\s*\[[^;]*?=\s*\{', text)
    if not match:
        raise ValueError('missing array ' + name)
    start = match.end()
    depth = 1
    # Ignore strings/comments when counting initializer braces.
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/|[{}]', text[start:]):
        if token[0] == '{': depth += 1
        elif token[0] == '}': depth -= 1
        if depth == 0:
            return start, start + token.start()
    raise ValueError('unterminated array ' + name)


def body(text, name):
    a, b = array_span(text, name)
    return text[a:b]


def append_array(host, name, imported):
    a, b = array_span(host, name)
    return host[:b] + '\n/* Original FireRed records. */\n' + imported + host[b:]



def source_function(text, name):
    """Extract a complete source C function (not a forward declaration)."""
    match = re.search(r'(?m)^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b' + re.escape(name) + r'\([^;{}]*\)\n\{', text)
    if not match:
        raise ValueError('missing source function ' + name)
    start = match.start(); opening = match.end() - 1; depth = 0
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/|[{}]', text[opening:]):
        if token[0] == '{': depth += 1
        elif token[0] == '}': depth -= 1
        if depth == 0:
            return text[start:opening + token.end()]
    raise ValueError('unterminated source function ' + name)


def replace_function(text, name, replacement):
    return text.replace(source_function(text, name), replacement, 1)


def stage_encounters(emerald_source, firered_source, output_tree, report_dir=None):
    started = time.monotonic()
    emerald, donor, out = [Path(p).resolve() for p in (emerald_source, firered_source, output_tree)]
    for source in (emerald, donor):
        if source == out or source in out.parents or out in source.parents:
            raise ValueError('staged output must be isolated from canonical sources')
    if not (out / 'src/data/trainers.h').is_file():
        raise ValueError('output must already contain staged Emerald source')
    hashes, writes = {}, []
    def read(root, rel):
        data = (root / rel).read_bytes()
        hashes[('firered/' if root == donor else 'emerald/') + rel] = hashlib.sha256(data).hexdigest()
        return data.decode()
    def write(rel, text):
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        writes.append(rel)
    trainers = read(donor, 'include/constants/trainers.h')
    opponents = read(donor, 'include/constants/opponents.h')
    host_trainers = read(emerald, 'include/constants/trainers.h')
    ids = definitions(opponents, 'TRAINER_')
    pics = definitions(trainers, 'TRAINER_PIC_')
    classes = definitions(trainers, 'TRAINER_CLASS_')
    music = definitions(trainers, 'TRAINER_ENCOUNTER_MUSIC_')
    # Donor campaign IDs fit u16; native ten-bit Frontier records remain native.
    def trainer_id(value):
        return value + TRAINER_OFFSET if value else 0
    mapping = {n: 'FR_' + n for n in ids | pics | classes | music}
    lines = ['#ifndef GUARD_FR_ENCOUNTERS_H', '#define GUARD_FR_ENCOUNTERS_H']
    for family, offset in ((ids, None), (pics, PIC_OFFSET), (classes, CLASS_OFFSET), (music, 0)):
        for name, value in family.items():
            val = trainer_id(value) if offset is None else value + offset
            lines.append(f'#define FR_{name} {val}')
    # Shared gameplay item IDs are mapped by semantic symbol, never raw donor number.
    donor_items = read(donor, 'include/constants/items.h')
    host_items = read(emerald, 'include/constants/items.h')
    items = sorted(set(re.findall(r'\bITEM_[A-Z0-9_]+\b', donor_items)))
    host_names = set(re.findall(r'\bITEM_[A-Z0-9_]+\b', host_items))
    item_aliases = dict(re.findall(r'^#define\s+(ITEM_\w+)\s+(ITEM_\w+)\s*(?://.*)?$', donor_items, re.M))
    missing_items = []
    for name in items:
        target = name
        visited = set()
        while target not in host_names and target in item_aliases and target not in visited:
            visited.add(target)
            target = item_aliases[target]
        if target in host_names:
            lines.append(f'#define FR_{name} {target}')
            mapping[name] = 'FR_' + name
        else:
            missing_items.append(name)
    lines += ['#define FR_TRAINERS_COUNT 743', '#define FR_TRAINER_FIRST 4097', '#define FR_TRAINER_LAST 4838', '#endif', '']
    write('include/constants/whole_game_fr_encounters.h', '\n'.join(lines))
    # Preserve state/audio worker edits in this shared header.
    path = out / 'include/constants/trainers.h'
    current = path.read_text()
    include = '#include "constants/whole_game_fr_encounters.h"'
    if include not in current:
        current = current.replace('#include "constants/opponents.h"', '#include "constants/opponents.h"\n' + include)
    write('include/constants/trainers.h', current)
    parties = read(donor, 'src/data/trainer_parties.h')
    private = set(re.findall(r'\b(?:sParty_\w+|DUMMY_TRAINER_\w+)\b', parties))
    mapping.update({n: 'FR_' + n for n in private})
    write('src/data/trainer_parties.h', read(emerald, 'src/data/trainer_parties.h') + '\n' + rewrite(parties, mapping))
    donor_defs = read(donor, 'src/data/trainers.h')
    donor_body = re.sub(r'\[TRAINER_NONE\]\s*=\s*\{.*?\},', '', body(donor_defs, 'gTrainers'), count=1, flags=re.S)
    write('src/data/trainers.h', append_array(read(emerald, 'src/data/trainers.h'), 'gTrainers', rewrite(donor_body, mapping)))
    class_names = read(donor, 'src/data/text/trainer_class_names.h')
    write('src/data/text/trainer_class_names.h', append_array(read(emerald, 'src/data/text/trainer_class_names.h'), 'gTrainerClassNames', rewrite(body(class_names, 'gTrainerClassNames'), mapping)))
    # Original prize money factors, before the native catch-all sentinel.
    battle = (out / 'src/battle_main.c').read_text()
    donor_money = body(read(donor, 'src/battle_main.c'), 'gTrainerMoneyTable')
    donor_money = re.sub(r'\{\s*0xFF\s*,\s*\d+\s*\}\s*,?', '', donor_money)
    marker = '/* FR_MONEY_BEGIN */'
    battle = re.sub(r'/\* FR_MONEY_BEGIN \*/.*?/\* FR_MONEY_END \*/\n    ', '', battle, flags=re.S)
    a, b = array_span(battle, 'gTrainerMoneyTable')
    segment = battle[a:b]
    sentinel = re.search(r'\{\s*0xFF\s*,', segment)
    if sentinel is None: raise ValueError('missing money sentinel')
    pos = a + sentinel.start()
    battle = battle[:pos] + marker + rewrite(donor_money, mapping) + '/* FR_MONEY_END */\n    ' + battle[pos:]
    write('src/battle_main.c', battle)
    # Guard native apprentice-array indexing against ordinary donor trainer IDs.
    recorded_path = out / 'src/recorded_battle.c'
    recorded = recorded_path.read_text() if recorded_path.exists() else read(emerald, 'src/recorded_battle.c')
    for variable in ('gTrainerBattleOpponent_A', 'gTrainerBattleOpponent_B', 'gPartnerTrainerId'):
        old = variable + ' >= TRAINER_RECORD_MIXING_APPRENTICE)'
        new = variable + ' >= TRAINER_RECORD_MIXING_APPRENTICE && ' + variable + ' < TRAINER_RECORD_MIXING_APPRENTICE + ARRAY_COUNT(gSaveBlock2Ptr->apprentices))'
        recorded = recorded.replace(old, new)
    write('src/recorded_battle.c', recorded)
    # Exact donor trainer graphics, palettes and animation selection tables.
    gfx = read(donor, 'src/data/graphics/trainers.h')
    gfx = '\n'.join(line for line in gfx.splitlines() if 'BackPic' not in line and 'back_pics/' not in line)
    gfx_symbols = set(re.findall(r'\b(?:gTrainerFrontPic_\w+|gTrainerPalette_\w+)\b', gfx))
    mapping.update({n: 'FR_' + n for n in gfx_symbols})
    for directory in ('front_pics', 'palettes'):
        srcdir = donor / 'graphics/trainers' / directory
        target = out / 'graphics/firered/trainers' / directory
        target.mkdir(parents=True, exist_ok=True)
        for source in sorted(srcdir.iterdir()):
            if source.suffix in ('.png', '.pal'):
                shutil.copyfile(source, target / source.name)
                hashes['firered/' + str(source.relative_to(donor))] = hashlib.sha256(source.read_bytes()).hexdigest()
    gfx = rewrite(gfx, mapping).replace('graphics/trainers/', 'graphics/firered/trainers/')
    # Emerald gfx tooling uses INCGFX; compressed sources remain PNG/PAL inputs.
    gfx = re.sub(r'INCBIN_U32\("([^"\n]+)\.4bpp\.lz"\)', r'INCGFX_U32("\1.png", ".4bpp.lz")', gfx)
    gfx = re.sub(r'INCBIN_U32\("([^"\n]+)\.gbapal\.lz"\)', r'INCGFX_U32("\1.pal", ".gbapal.lz")', gfx)
    write('src/data/graphics/trainers.h', read(emerald, 'src/data/graphics/trainers.h') + '\n' + gfx + '\n')
    tables = read(donor, 'src/data/trainer_graphics/front_pic_tables.h')
    host_tables = read(emerald, 'src/data/trainer_graphics/front_pic_tables.h')
    coords = body(tables, 'gTrainerFrontPicCoords')
    index = iter(range(PIC_OFFSET, PIC_OFFSET + len(pics)))
    coords = re.sub(r'\{\.size', lambda m: f'[{next(index)}] = {{.size', coords)
    host_tables = append_array(host_tables, 'gTrainerFrontPicCoords', coords)
    sprites = body(tables, 'gTrainerFrontPicTable')
    sprites = re.sub(r'TRAINER_SPRITE\((\w+),\s*(\w+),\s*([^\)]+)\)', lambda m: f'[FR_TRAINER_PIC_{m[1]}] = {{{mapping[m[2]]}, {m[3]}, FR_TRAINER_PIC_{m[1]}}}', sprites)
    palettes = body(tables, 'gTrainerFrontPicPaletteTable')
    palettes = re.sub(r'TRAINER_PAL\((\w+),\s*(\w+)\)', lambda m: f'[FR_TRAINER_PIC_{m[1]}] = {{{mapping[m[2]]}, FR_TRAINER_PIC_{m[1]}}}', palettes)
    host_tables = append_array(host_tables, 'gTrainerFrontPicTable', sprites)
    host_tables = append_array(host_tables, 'gTrainerFrontPicPaletteTable', palettes)
    externs = '\n'.join(f'extern const u32 FR_{n}[];' for n in sorted(gfx_symbols)) + '\n'
    write('src/data/trainer_graphics/front_pic_tables.h', externs + host_tables)
    anims = read(donor, 'src/data/trainer_graphics/front_pic_anims.h')
    mapping.update({n: 'FR_' + n for n in set(re.findall(r'\bsAnims_\w+', anims))})
    prefix = anims[:anims.index('const union AnimCmd *const *const gTrainerFrontAnimsPtrTable')]
    host_anims = read(emerald, 'src/data/trainer_graphics/front_pic_anims.h')
    host_anims = append_array(host_anims, 'gTrainerFrontAnimsPtrTable', rewrite(body(anims, 'gTrainerFrontAnimsPtrTable'), mapping))
    write('src/data/trainer_graphics/front_pic_anims.h', rewrite(prefix, mapping) + '\n' + host_anims)
    # A single shared header array is required by native map lookup.
    wild = json.loads(read(donor, 'src/data/wild_encounters.json'))
    host_wild = json.loads(read(emerald, 'src/data/wild_encounters.json'))
    hg = host_wild['wild_encounter_groups'][0]
    wild_counts = {}
    for group in wild['wild_encounter_groups']:
        if group['fields'] != hg['fields']:
            raise ValueError('wild encounter slot/rate schema mismatch')
        for encounter in group['encounters']:
            if 'LeafGreen' in encounter['base_label']:
                continue
            clone = json.loads(json.dumps(encounter))
            clone['map'] = clone['map'].replace('MAP_', 'MAP_FR_', 1)
            clone['base_label'] = 'FR_' + clone['base_label']
            hg['encounters'].append(clone)
            for field in group['fields']:
                if field['type'] in clone: wild_counts[field['type']] = wild_counts.get(field['type'], 0) + 1
    write('src/data/wild_encounters.json', json.dumps(host_wild, indent=2) + '\n')
    fr_wild = read(donor, 'src/wild_encounter.c')
    wild_code = read(emerald, 'src/wild_encounter.c')
    wild_names = {n: 'MAP_FR_' + n[4:] for n in set(re.findall(r'\bMAP_[A-Z0-9_]+', fr_wild))}
    for name in ('MAP_UNDEFINED', 'MAP_GROUP', 'MAP_NUM'):
        wild_names[name] = name
    wild_names.update({n: 'FR_' + n for n in set(re.findall(r'\b(?:FLAG_|VAR_)[A-Z0-9_]+', fr_wild))})
    # Donor encounter music selection uses original donor category grouping.
    setup_path = out / 'src/battle_setup.c'
    setup = setup_path.read_text() if setup_path.exists() else read(emerald, 'src/battle_setup.c')
    function = source_function(setup, 'PlayTrainerEncounterMusic')
    if 'FR_MUS_ENCOUNTER_BOY' not in function:
        dispatch = """        if (trainerId >= FR_TRAINER_FIRST && trainerId <= FR_TRAINER_LAST)
        {
            switch (GetTrainerEncounterMusicId(trainerId))
            {
            case TRAINER_ENCOUNTER_MUSIC_FEMALE:
            case TRAINER_ENCOUNTER_MUSIC_GIRL:
            case TRAINER_ENCOUNTER_MUSIC_TWINS:
                music = FR_MUS_ENCOUNTER_GIRL;
                break;
            case TRAINER_ENCOUNTER_MUSIC_MALE:
            case TRAINER_ENCOUNTER_MUSIC_INTENSE:
            case TRAINER_ENCOUNTER_MUSIC_COOL:
            case TRAINER_ENCOUNTER_MUSIC_SWIMMER:
            case TRAINER_ENCOUNTER_MUSIC_ELITE_FOUR:
            case TRAINER_ENCOUNTER_MUSIC_HIKER:
            case TRAINER_ENCOUNTER_MUSIC_INTERVIEWER:
            case TRAINER_ENCOUNTER_MUSIC_RICH:
                music = FR_MUS_ENCOUNTER_BOY;
                break;
            default:
                music = FR_MUS_ENCOUNTER_ROCKET;
                break;
            }
        }
"""
        function = function.replace('        PlayNewMapMusic(music);', dispatch + '        PlayNewMapMusic(music);')
        setup = replace_function(setup, 'PlayTrainerEncounterMusic', function)
    write('src/battle_setup.c', setup)
    # Compile the full original donor encounter dispatcher, including its LCG,
    # cooldown, rate buff, ability/cleanse-tag/flute modifiers and generators.
    # Shared ABI names map to native Emerald services; terrain consumes the raw
    # donor 32-bit attributes preserved by the map importer.
    fr_runtime = fr_wild
    fr_runtime = fr_runtime.replace(source_function(fr_runtime, 'UpdateRepelCounter'), '')
    fr_runtime = re.sub(r'^#include[^\n]*\n', '', fr_runtime, flags=re.M)
    public_names = re.findall(r'(?m)^(?:void|bool8|u8|u16) (\w+)\(', fr_runtime)
    runtime_symbols = dict(wild_names)
    runtime_symbols.update({n: 'FR_' + n for n in public_names})
    runtime_symbols.update({'StartWildBattle': 'BattleSetup_StartWildBattle', 'StartRoamerBattle': 'BattleSetup_StartRoamerBattle',
                            'GAME_STAT_FISHING_CAPTURES': 'FR_GAME_STAT_FISHING_CAPTURES', 'IncrementGameStat': 'FR_IncrementGameStat',
                            'MapGridGetMetatileAttributeAt': 'FR_MapGridGetMetatileAttributeAt',
                            'ExtractMetatileAttribute': 'FR_ExtractMetatileAttribute',
                            'TryStartRoamerEncounter': 'WholeGameFR_TryStartRoamerEncounter'})
    runtime_symbols.update({n: 'WGFR_' + n for n in set(re.findall(r'\bMetatileBehavior_\w+', fr_runtime))})
    runtime_symbols.update({n: 'FR_' + n for n in set(re.findall(r'\b(?:METATILE_ATTRIBUTE_\w+|METATILE_ATTRIBUTES_ALL|TILE_ENCOUNTER_\w+)\b', fr_runtime))})
    for suffix in ('BEHAVIOR', 'TERRAIN', '2', '3', 'ENCOUNTER_TYPE', '5', 'LAYER_TYPE', '7', 'COUNT'):
        runtime_symbols['METATILE_ATTRIBUTE_' + suffix] = 'FR_METATILE_ATTRIBUTE_' + suffix
    # Item effects consumed by both regions have one canonical active counter.
    runtime_symbols['VAR_REPEL_STEP_COUNT'] = 'VAR_REPEL_STEP_COUNT'
    runtime_symbols['FLAG_SYS_WHITE_FLUTE_ACTIVE'] = 'FR_FLAG_SYS_WHITE_FLUTE_ACTIVE'
    runtime_symbols['FLAG_SYS_BLACK_FLUTE_ACTIVE'] = 'FR_FLAG_SYS_BLACK_FLUTE_ACTIVE'
    fr_runtime = rewrite(fr_runtime, runtime_symbols)
    fr_runtime = fr_runtime.replace('&gSaveBlock1Ptr->roamer', 'WholeGameFR_GetRoamer()')
    attr_source = read(donor, 'src/fieldmap.c')
    attrs = ''
    for table in ('sMetatileAttrMasks', 'sMetatileAttrShifts'):
        match = re.search(r'static const u(?:8|32) ' + table + r'.*?\n};', attr_source, re.S)
        attrs += rewrite(match[0], runtime_symbols) + '\n'
    attrs += 'static ' + rewrite(source_function(attr_source, 'ExtractMetatileAttribute'), runtime_symbols) + '\n'
    attrs += """static u32 FR_MapGridGetMetatileAttributeAt(s16 x, s16 y, u8 kind)
{
    return WholeGameFireRedAttribute(gMapHeader.mapLayout, MapGridGetMetatileIdAt(x, y), kind);
}
"""
    runtime_header = """#ifndef GUARD_WHOLE_GAME_FR_ENCOUNTERS_RUNTIME_H
#define GUARD_WHOLE_GAME_FR_ENCOUNTERS_RUNTIME_H
#include "global.h"
#include "wild_encounter.h"
void FR_DisableWildEncounters(bool8 disabled);
bool8 FR_StandardWildEncounter(u32 attrs, u16 previousBehavior);
bool8 FR_TryStandardWildEncounter(u32 attrs);
bool8 FR_TryStandardWildEncounterAtPlayer(void);
bool8 FR_SweetScentWildEncounter(void);
bool8 FR_DoesCurrentMapHaveFishingMons(void);
void FR_FishingWildEncounter(u8 rod);
void FR_RockSmashWildEncounter(void);
u16 FR_GetLocalWildMon(bool8 *isWaterMon);
u16 FR_GetLocalWaterMon(void);
void FR_SeedWildEncounterRng(u16 seed);
void FR_ResetEncounterRateModifiers(void);
u8 FR_GetUnownLetterByPersonalityLoByte(u32 personality);
#endif
"""
    write('include/whole_game_fr_encounters.h', runtime_header)
    raw_enums = """enum {
 FR_METATILE_ATTRIBUTE_BEHAVIOR, FR_METATILE_ATTRIBUTE_TERRAIN,
 FR_METATILE_ATTRIBUTE_2, FR_METATILE_ATTRIBUTE_3,
 FR_METATILE_ATTRIBUTE_ENCOUNTER_TYPE, FR_METATILE_ATTRIBUTE_5,
 FR_METATILE_ATTRIBUTE_LAYER_TYPE, FR_METATILE_ATTRIBUTE_7,
 FR_METATILE_ATTRIBUTE_COUNT, FR_METATILE_ATTRIBUTES_ALL = 255
};
enum {FR_TILE_ENCOUNTER_NONE, FR_TILE_ENCOUNTER_LAND, FR_TILE_ENCOUNTER_WATER};
#define LAND_WILD_COUNT 12
"""
    prelude = """#include "global.h"
#include "random.h"
#include "pokemon.h"
#include "wild_encounter.h"
#include "event_data.h"
#include "fieldmap.h"
#include "roamer.h"
#include "field_player_avatar.h"
#include "battle_setup.h"
#include "overworld.h"
#include "script.h"
#include "link.h"
#include "constants/abilities.h"
#include "constants/items.h"
#include "constants/game_stat.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_state.h"
#include "whole_game_fr_semantics.h"
#include "whole_game_fr_encounters.h"
#include "whole_game_world_services.h"
"""
    wrapper = """
bool8 FR_TryStandardWildEncounterAtPlayer(void)
{
    s16 x, y;
    PlayerGetDestCoords(&x, &y);
    return FR_TryStandardWildEncounter(FR_MapGridGetMetatileAttributeAt(x, y, FR_METATILE_ATTRIBUTES_ALL));
}
"""
    write('src/firered_wild_encounter.c', prelude + raw_enums + attrs + fr_runtime + wrapper)
    # Route each public native entry using the same shared ABI; Step admission is
    # called directly by the field movement adapter before native immunity steps.
    include = '#include "global.h"\n#include "whole_game_fr_encounters.h"\n#include "whole_game_state.h"\n'
    if include not in wild_code:
        wild_code = include + wild_code
    routes = {'StandardWildEncounter': 'return FR_TryStandardWildEncounterAtPlayer();',
              'SweetScentWildEncounter': 'return FR_SweetScentWildEncounter();',
              'DoesCurrentMapHaveFishingMons': 'return FR_DoesCurrentMapHaveFishingMons();',
              'FishingWildEncounter': 'FR_FishingWildEncounter(rod); return;',
              'RockSmashWildEncounter': 'FR_RockSmashWildEncounter(); return;',
              'GetLocalWildMon': 'return FR_GetLocalWildMon(isWaterMon);',
              'GetLocalWaterMon': 'return FR_GetLocalWaterMon();'}
    for native_name, statement in routes.items():
        fn = source_function(wild_code, native_name)
        # Insert a scoped block immediately at function entry. Native declarations
        # remain inside their own block, avoiding mixed declarations under C89.
        marker = '/* FR_ENTRY_' + native_name + ' */'
        if marker not in fn:
            fn = fn.replace('\n{', '\n{\n    ' + marker + '\n    if (WholeGame_IsKanto()) { ' + statement + ' }\n    {', 1) + '\n}'
            wild_code = replace_function(wild_code, native_name, fn)
    fn = source_function(wild_code, 'DisableWildEncounters')
    if 'FR_DisableWildEncounters(' not in fn:
        fn = fn.replace('\n{', '\n{\n    FR_DisableWildEncounters(disabled);', 1)
        wild_code = replace_function(wild_code, 'DisableWildEncounters', fn)
    write('src/wild_encounter.c', wild_code)
    # Origin version disambiguates overlapping Hoenn/Kanto 8-bit met locations.
    pokemon_path = out / 'src/pokemon.c'
    pokemon_code = pokemon_path.read_text() if pokemon_path.exists() else read(emerald, 'src/pokemon.c')
    if '#include "whole_game_state.h"' not in pokemon_code:
        pokemon_code = pokemon_code.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"', 1)
    original = '    SetBoxMonData(boxMon, MON_DATA_MET_GAME, &gGameVersion);'
    replacement = '    value = WholeGame_IsKanto() ? VERSION_FIRE_RED : gGameVersion;\n    SetBoxMonData(boxMon, MON_DATA_MET_GAME, &value);'
    if original in pokemon_code:
        if pokemon_code.count(original) != 1: raise ValueError('unexpected mon origin initializer')
        pokemon_code = pokemon_code.replace(original, replacement, 1)
    write('src/pokemon.c', pokemon_code)
    item_rows = json.loads(read(donor, 'src/data/items.json'))['items']
    unique_prices = {}
    for row in item_rows:
        name, price = row['itemId'], row['price']
        if name in unique_prices and unique_prices[name] != price:
            raise ValueError('conflicting donor price aliases: ' + name)
        unique_prices[name] = price
    prices = 'static const u16 sFireRedItemPrices[ITEMS_COUNT] = {\n' + ''.join(f'    [FR_{name}] = {price},\n' for name, price in unique_prices.items()) + '};\n'
    write('src/data/firered/item_prices.h', prices)
    item_path = out / 'src/item.c'
    item_code = item_path.read_text() if item_path.exists() else read(emerald, 'src/item.c')
    if '#include "data/firered/item_prices.h"' not in item_code:
        item_code = item_code.replace('#include "item.h"', '#include "item.h"\n#include "whole_game_state.h"\n#include "constants/whole_game_fr_encounters.h"\n#include "data/firered/item_prices.h"', 1)
    fn = source_function(item_code, 'GetItemPrice')
    if 'sFireRedItemPrices' not in fn:
        fn = fn.replace('\n{', '\n{\n    if (WholeGame_IsKanto() && itemId < 375)\n        return sFireRedItemPrices[SanitizeItemId(itemId)];', 1)
        item_code = replace_function(item_code, 'GetItemPrice', fn)
    write('src/item.c', item_code)
    # Keep exact donor item metadata for source service and economic audits.
    write('src/data/firered/item_metadata.json', read(donor, 'src/data/items.json'))
    requirements = [
        'Audio stage must supply donor battle/victory music routing and FR_MUS constants consumed by the encounter dispatcher.',
        'FireRed and Emerald both use one saved roamer, but FireRed starter-dependent beast and Emerald Lati policy need independent state and source-specific dispatch.',
        'FireRed Safari uses bait/rock/run state; Emerald Safari uses Pokeblocks/go-near: cannot substitute Emerald Safari behavior.',
        'FireRed GameCorner prize/shop/gift scripts depend on script/special import and source currency/selection services.',
        'FireRed PokeFlute, VSSeeker, FameChecker, TMCase, BerryPouch, TeachyTV, TownMap, PowderJar and Bicycle bag-use callbacks require donor services; shared IDs alone are insufficient.',
        'Donor wild translation unit is emitted and routed; field movement must call FR admission before Emerald immunity-step prefilters, campaign must seed FR wild RNG, and world_services must supply donor roamer APIs.',
        'Native ten-bit Frontier tournament records accept only native facility trainers; donor campaign IDs must not be admitted by future cross-mode entry policies.',
    ]
    blockers = ['Unmapped donor item constants: ' + ', '.join(missing_items)] if missing_items else []
    report = {'schema': 'whole-game-encounters/v1', 'status': 'source-staged-qualification-pending', 'build_ready': not blockers,
              'counts': {'trainers': len(ids), 'trainer_pictures': len(pics), 'trainer_classes': len(classes), 'wild_headers': len(hg['encounters']) - len(json.loads((emerald / 'src/data/wild_encounters.json').read_text())['wild_encounter_groups'][0]['encounters']), 'wild_maps': len(set(x['map'] for x in hg['encounters'] if x['map'].startswith('MAP_FR_'))), 'wild_tables': wild_counts, 'item_aliases': len(items) - len(missing_items)},
              'trainer_ids': {n: trainer_id(v) for n, v in ids.items()}, 'reserved_native_trainer_ids': [1022, 1023, 1024],
              'composition_policy': {'battle_party_capture_evolution_ai_owner': 'native Emerald', 'donor_ai_flags': 'semantic symbols retained; native bit positions authoritative (VIABILITY/TRY_TO_FAINT differ)', 'repel_and_flute_effect_state': 'shared native counter and flags', 'repel_counter': 'native Emerald (donor quest-log playback suppression excluded; quest-log playback not active)', 'wild_admission_and_generation_owner': 'original FireRed source for Kanto, native Emerald source for Hoenn', 'inactive_leafgreen_rows': 132},
              'integration_requirements': requirements, 'blockers': blockers, 'source_hashes': hashes, 'files': writes, 'transform_wall_seconds': time.monotonic() - started,
              'build_duration_seconds': None, 'gameplay_qualification': 'not-run'}
    if report_dir:
        directory = Path(report_dir); directory.mkdir(parents=True, exist_ok=True)
        (directory / 'encounters-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    p = argparse.ArgumentParser(); p.add_argument('--emerald', required=True); p.add_argument('--firered', required=True); p.add_argument('--output-tree', required=True); p.add_argument('--report-dir', required=True)
    a = p.parse_args(); print(json.dumps(stage_encounters(a.emerald, a.firered, a.output_tree, a.report_dir), indent=2))

if __name__ == '__main__': main()
