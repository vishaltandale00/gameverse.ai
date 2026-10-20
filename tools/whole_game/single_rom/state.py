"""Deterministic single-engine campaign namespace patch (canonical inputs read-only).

This module prepares source; it does not certify a complete donor campaign.
"""
from __future__ import annotations
import ast
import hashlib
import json
import re
from pathlib import Path

FLAG_OFFSET = 0x1000
VAR_OFFSET = 0x1000
TRAINER_OFFSET = 4096
DONOR_FLAGS_COUNT = 0x900
DONOR_VARS_COUNT = 0x100
STORAGE_BASE_SIZE = 0x83D0
STORAGE_CAPACITY = 9 * 3968
CAMPAIGN_SIZE = 1260
SHARED_STATE_ALIASES = {
    'FLAG_SYS_WHITE_FLUTE_ACTIVE': {'nativeSymbol': 'FLAG_SYS_ENC_UP_ITEM', 'donorValue': 0x803, 'nativeValue': 0x8AD, 'lifetime': 'current map; both source engines clear on map load'},
    'FLAG_SYS_BLACK_FLUTE_ACTIVE': {'nativeSymbol': 'FLAG_SYS_ENC_DOWN_ITEM', 'donorValue': 0x804, 'nativeValue': 0x8AE, 'lifetime': 'current map; both source engines clear on map load'},
    'VAR_REPEL_STEP_COUNT': {'nativeSymbol': 'VAR_REPEL_STEP_COUNT', 'donorValue': 0x4020, 'nativeValue': 0x4021, 'lifetime': 'shared remaining steps persist across map loads'},
}


def donor_flag(value: int) -> int:
    if value in (0x803, 0x804):
        return {0x803: 0x8AD, 0x804: 0x8AE}[value]
    if value == 0 or 0x4000 <= value <= 0x407F:
        return value
    if 0 < value < DONOR_FLAGS_COUNT:
        return value + FLAG_OFFSET
    raise ValueError(f"unsupported donor flag {value:#x}")


def donor_var(value: int) -> int:
    if value == 0x4020:
        return 0x4021
    if 0x4000 <= value <= 0x40FF:
        return value + VAR_OFFSET
    if 0x8000 <= value <= 0x8014:
        return {0x8010: 0x8012, 0x8011: 0x8013, 0x8012: 0x8016, 0x8013: 0x8017}.get(value, value)
    raise ValueError(f"unsupported donor var {value:#x}")


def trainer_flag(value: int) -> int:
    if 0 <= value < 864:
        return 0x500 + value
    if value == TRAINER_OFFSET:
        return 0  # Donor dummy record is omitted; this sparse index is never a trainer.
    if TRAINER_OFFSET < value < TRAINER_OFFSET + 768:
        return donor_flag(0x500 + value - TRAINER_OFFSET)
    raise ValueError(f"unsupported trainer {value}")


def _constants(donor: Path) -> dict[str, int]:
    definitions = {}
    for filename in ('flags', 'vars', 'opponents', 'trainers'):
        for line in (donor / f'include/constants/{filename}.h').read_text().splitlines():
            match = re.match(r'#define\s+(\w+)\s+(.+)', line)
            if match:
                definitions[match[1]] = match[2].split('//')[0].strip()
    values = {}
    def resolve(name):
        if name in values:
            return values[name]
        def evaluate(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, int): return node.value
            if isinstance(node, ast.Name): return resolve(node.id)
            if isinstance(node, ast.BinOp):
                a, b = evaluate(node.left), evaluate(node.right)
                if isinstance(node.op, ast.Add): return a + b
                if isinstance(node.op, ast.Sub): return a - b
                if isinstance(node.op, ast.Mult): return a * b
                if isinstance(node.op, ast.LShift): return a << b
                if isinstance(node.op, ast.BitOr): return a | b
            raise ValueError(f'unsupported constant expression {name}')
        values[name] = evaluate(ast.parse(definitions[name], mode='eval').body)
        return values[name]
    for name in definitions:
        if name.startswith(('FLAG_', 'VAR_', 'TRAINER_')):
            resolve(name)
    return values


def namespace_header(donor: Path) -> str:
    lines = ['#ifndef GUARD_WHOLE_GAME_FR_STATE_CONSTANTS_H', '#define GUARD_WHOLE_GAME_FR_STATE_CONSTANTS_H']
    for name, value in sorted(_constants(donor).items()):
        if name.startswith('FLAG_'): value = donor_flag(value)
        elif name.startswith('VAR_'): value = donor_var(value)
        else: continue
        lines.append(f'#define FR_{name} 0x{value:X}')
    lines.extend(['#endif', ''])
    return '\n'.join(lines)


def apply(base: Path, donor: Path, *, base_group_count: int = 34) -> dict:
    """Patch an already staged Emerald source tree, refusing canonical source roots."""
    base, donor = Path(base).resolve(), Path(donor).resolve()
    canonical_roots = [Path(__file__).resolve().parents[3] / 'local/decomps' / name for name in ('pokeemerald', 'pokefirered')]
    if base == donor or base.name in ('pokeemerald', 'pokefirered') or any(root == base or root in base.parents for root in canonical_roots):
        raise ValueError('refusing canonical source tree; pass an isolated staged base')
    changed = []
    def write(name, value):
        path = base / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        changed.append(name)
    def patch(name, old, new):
        text = (base / name).read_text()
        if text.count(old) != 1:
            raise ValueError(f'{name}: expected exactly one patch anchor {old!r}')
        write(name, text.replace(old, new))
    # World worker appends donor groups to the original Emerald group list.
    groups = json.loads((base / 'data/maps/map_groups.json').read_text())['group_order']
    # Original Emerald has 34 groups. Caller can explicitly supply another verified boundary.
    if len(groups) < base_group_count:
        raise ValueError('map group count smaller than native region boundary')
    header = namespace_header(donor)  # validate all donor constant expressions before editing
    write('include/constants/whole_game_fr_state.h', header)
    write('include/whole_game_state.h', '''#ifndef GUARD_WHOLE_GAME_STATE_H
#define GUARD_WHOLE_GAME_STATE_H
extern u16 gSpecialVar_TextColor;
extern u16 gSpecialVar_PrevTextColor;
u32 FR_GetGameStat(u8 statId);
void FR_SetGameStat(u8 statId, u32 value);
void FR_IncrementGameStat(u8 statId);
void FR_ResetGameStats(void);
bool8 WholeGame_IsKanto(void);
u16 WholeGame_TrainerFlag(u16 trainer);
bool8 WholeGame_CanUseFieldMove(u8 fieldMove);
#endif
''')
    patch('include/pokemon_storage_system.h', '    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];', '''    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];
    // Unified-save v1: native PC data retains its exact original offsets.
    struct {
        u8 flags[0x900 / 8];
        u16 vars[0x100];
        u32 schema;
        u32 campaignInitialized;
        u8 rivalName[8];
        u32 gameStats[64];
        struct WarpData lastHeal[2];
        u32 healSchema;
        u16 trainerRematchStepCounter;
        u8 trainerRematches[100];
        u16 vsSeekerPadding;
        u8 fameChecker[64];
    } wholeGameKanto;''')
    # Original chunk serializer and ASLR/backup structs all use sizeof, so the
    # extension is saved in the existing ninth PC sector without new sectors.
    event = 'src/event_data.c'
    patch(event, '#include "pokedex.h"', '#include "pokedex.h"\n#include "pokemon_storage_system.h"\n#include "whole_game_state.h"')
    patch(event, 'EWRAM_DATA u16 gSpecialVar_0x8000 = 0;', 'EWRAM_DATA u16 gSpecialVar_TextColor = 0;\nEWRAM_DATA u16 gSpecialVar_PrevTextColor = 0;\nEWRAM_DATA u16 gSpecialVar_0x8000 = 0;')
    patch(event, '    memset(sSpecialFlags, 0, sizeof(sSpecialFlags));', '''    memset(sSpecialFlags, 0, sizeof(sSpecialFlags));
    memset(&gPokemonStoragePtr->wholeGameKanto, 0, sizeof(gPokemonStoragePtr->wholeGameKanto));
    gPokemonStoragePtr->wholeGameKanto.schema = 0x57470101;
    FR_ResetGameStats();''')
    patch(event, '    FlagClear(FLAG_SYS_ENC_UP_ITEM);', '''    // Both regions' temporary state expires on the same map-load boundary.
    memset(gPokemonStoragePtr->wholeGameKanto.flags, 0, TEMP_FLAGS_SIZE);
    memset(gPokemonStoragePtr->wholeGameKanto.vars, 0, TEMP_VARS_SIZE);
    FlagClear(FLAG_SYS_ENC_UP_ITEM);''')
    patch(event, '''    if (id < VARS_START)
        return NULL;
    else if (id < SPECIAL_VARS_START)
        return &gSaveBlock1Ptr->vars[id - VARS_START];
    else
        return gSpecialVars[id - SPECIAL_VARS_START];''', '''    if (id == 0x8016) return &gSpecialVar_TextColor;
    if (id == 0x8017) return &gSpecialVar_PrevTextColor;
    if (id >= 0x5000 && id <= 0x50FF)
        return &gPokemonStoragePtr->wholeGameKanto.vars[id - 0x5000];
    if (id >= VARS_START && id <= VARS_END)
        return &gSaveBlock1Ptr->vars[id - VARS_START];
    if (id >= SPECIAL_VARS_START && id <= SPECIAL_VARS_END)
        return gSpecialVars[id - SPECIAL_VARS_START];
    return NULL;''')
    patch(event, '''    if (id == 0)
        return NULL;
    else if (id < SPECIAL_FLAGS_START)
        return &gSaveBlock1Ptr->flags[id / 8];
    else
        return &sSpecialFlags[(id - SPECIAL_FLAGS_START) / 8];''', '''    if (id >= 0x1001 && id <= 0x18FF)
        return &gPokemonStoragePtr->wholeGameKanto.flags[(id - 0x1000) / 8];
    if (id > 0 && id < FLAGS_COUNT)
        return &gSaveBlock1Ptr->flags[id / 8];
    if (id >= SPECIAL_FLAGS_START && id <= SPECIAL_FLAGS_END)
        return &sSpecialFlags[(id - SPECIAL_FLAGS_START) / 8];
    return NULL;''')
    extra = f'''
// Fail compilation if the ninth saved PC sector cannot contain the extension.
typedef char WholeGameStorageFits[(sizeof(struct PokemonStorage) <= 9 * 3968) ? 1 : -1];
typedef char WholeGameStorageAligned[(sizeof(struct PokemonStorage) % 4 == 0) ? 1 : -1];

bool8 WholeGame_IsKanto(void)
{{
    return gSaveBlock1Ptr->location.mapGroup >= {base_group_count};
}}

u16 WholeGame_TrainerFlag(u16 trainer)
{{
    if (trainer > 4096 && trainer < 4864)
        return 0x1500 + trainer - 4096;
    if (trainer < 864)
        return TRAINER_FLAGS_START + trainer;
    return 0; // Sparse holes and special trainer sentinels have no defeated flag.
}}

bool8 WholeGame_CanUseFieldMove(u8 fieldMove)
{{
    // Indexed by Emerald FIELD_MOVE_* order. Kanto has no Dive HM.
    static const u16 kantoBadges[] = {{0x1821, 0x1820, 0x1825, 0x1823,
                                      0x1824, 0x1822, 0, 0x1826}};
    if (fieldMove > 7)
        return FALSE;
    if (WholeGame_IsKanto())
        return kantoBadges[fieldMove] != 0 && FlagGet(kantoBadges[fieldMove]);
    return FlagGet(FLAG_BADGE01_GET + fieldMove);
}}
'''
    write(event, (base / event).read_text() + extra)
    battle = 'src/battle_setup.c'
    patch(battle, '#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"')
    value = (base / battle).read_text()
    value, count = re.subn(r'TRAINER_FLAGS_START \+ (gTrainerBattleOpponent_[AB]|flag|trainerId)', r'WholeGame_TrainerFlag(\1)', value)
    if count != 6: raise ValueError(f'expected six trainer flag accessors, found {count}')
    write(battle, value)
    party = 'src/party_menu.c'
    patch(party, '#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"')
    patch(party, 'FlagGet(FLAG_BADGE01_GET + fieldMove) != TRUE', 'WholeGame_CanUseFieldMove(fieldMove) != TRUE')
    field = 'src/field_control_avatar.c'
    patch(field, '#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"')
    value = (base / field).read_text()
    for badge, move in [('FLAG_BADGE05_GET', 4), ('FLAG_BADGE08_GET', 7), ('FLAG_BADGE07_GET', 6)]:
        value = value.replace(f'FlagGet({badge})', f'WholeGame_CanUseFieldMove({move})')
    write(field, value)
    # Partial link/Frontier saves normally omit PC. The entire donor extension
    # resides in the existing finalPCsector, so add just that sector to both
    # original replacement and signature passes instead of a full14sector save.
    patch('src/save.c', '        // Write only SaveBlocks 1 and 2 (skips the PC)', '        // SaveBlocks1/2 plus the final PC sector containing unified campaign state.')
    patch('src/save.c', '            HandleReplaceSector(i, gRamSaveSectorLocations);', '            HandleReplaceSector(i, gRamSaveSectorLocations);\n        HandleReplaceSector(SECTOR_ID_PKMN_STORAGE_END, gRamSaveSectorLocations);')
    patch('src/save.c', '            WriteSectorSignatureByte_NoOffset(i, gRamSaveSectorLocations);', '            WriteSectorSignatureByte_NoOffset(i, gRamSaveSectorLocations);\n        WriteSectorSignatureByte_NoOffset(SECTOR_ID_PKMN_STORAGE_END, gRamSaveSectorLocations);')
    # Import the original encrypted FR game-stat bank, preserving all64slots.
    # Shared engine event IDs are routed by semantic constant name, never by
    # donor numeric coincidence (12,32,51 intentionally have different names).
    from .encounters import source_function
    source_overworld = (donor / 'src/overworld.c').read_text()
    stats_source = []
    for function in ('GetGameStat', 'SetGameStat', 'IncrementGameStat'):
        function_text = source_function(source_overworld, function)
        function_text = re.sub(r'\b(GetGameStat|SetGameStat|IncrementGameStat)\b', lambda m: 'FR_' + m[0], function_text)
        function_text = function_text.replace('gSaveBlock1Ptr->gameStats', 'gPokemonStoragePtr->wholeGameKanto.gameStats')
        stats_source.append(function_text)
    stats_source.append("""void FR_ResetGameStats(void)
{
    u8 i;
    // Reset may be used after key rotation: encoded zero must use current key.
    for (i = 0; i < 64; i++)
        gPokemonStoragePtr->wholeGameKanto.gameStats[i] = gSaveBlock2Ptr->encryptionKey;
}
""")
    overworld = 'src/overworld.c'
    patch(overworld, '#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"\n#include "pokemon_storage_system.h"')
    native_overworld = (base / overworld).read_text()
    for function, dispatch in [('GetGameStat', 'return FR_GetGameStat(index);'), ('SetGameStat', 'FR_SetGameStat(index, value); return;')]:
        old = source_function(native_overworld, function)
        new = old.replace('{\n', '{\n    if (WholeGame_IsKanto() && index < NUM_USED_GAME_STATS && index != 12 && index != 32 && index != 51)\n    {\n        ' + dispatch + '\n    }\n', 1)
        native_overworld = native_overworld.replace(old, new, 1)
    old = source_function(native_overworld, 'ApplyNewEncryptionKeyToGameStats')
    new = old[:-1] + '    for (i = 0; i < 64; i++)\n        ApplyNewEncryptionKeyToWord(&gPokemonStoragePtr->wholeGameKanto.gameStats[i], newKey);\n}'
    native_overworld = native_overworld.replace(old, new, 1)
    write(overworld, native_overworld + '\n\n' + '\n\n'.join(stats_source) + '\n')
    donor_stat_constants = (donor / 'include/constants/game_stat.h').read_text()
    stat_defines = re.findall(r'^#define\s+(GAME_STAT_\w+)\s+(\d+)', donor_stat_constants, re.M)
    if len(stat_defines) != 52:
        raise ValueError('unexpected FireRed game-stat constant count')
    native_stat_defines = re.findall(r'^#define\s+(GAME_STAT_\w+)\s+(\d+)', (base / 'include/constants/game_stat.h').read_text(), re.M)
    donor_by_id = {int(number): name for name, number in stat_defines}
    host_by_id = {int(number): name for name, number in native_stat_defines}
    if {number for number in range(52) if donor_by_id[number] != host_by_id[number]} != {12, 32, 51}:
        raise ValueError('unreviewed game-stat semantic difference')
    stat_header = '#ifndef GUARD_WHOLE_GAME_FR_STATS_H\n#define GUARD_WHOLE_GAME_FR_STATS_H\n' + '\n'.join(f'#define FR_{name} {number}' for name, number in stat_defines) + '\n#endif\n'
    write('include/constants/whole_game_fr_game_stat.h', stat_header)
    native_stat_header = (base / 'include/constants/game_stat.h').read_text()
    write('include/constants/game_stat.h', native_stat_header.replace('#endif', '#include "constants/whole_game_fr_game_stat.h"\n#endif', 1))
    return {
        'component': 'state', 'status': 'partial', 'buildEligible': False,
        'changed_files': sorted(set(changed)),
        'sharedStateAliases': SHARED_STATE_ALIASES,
        'namespace': {'flagsOffset': FLAG_OFFSET, 'varsOffset': VAR_OFFSET, 'trainerOffset': TRAINER_OFFSET, 'flagZeroPreserved': True, 'baseGroupCount': base_group_count},
        'save_layout': {'originalStorageBytes': STORAGE_BASE_SIZE, 'extensionBytes': CAMPAIGN_SIZE, 'newStorageBytes': STORAGE_BASE_SIZE + CAMPAIGN_SIZE, 'capacityBytes': STORAGE_CAPACITY, 'legacySaveCompatible': False, 'saveCompatibility': 'fresh-only', 'newSaveSchema': '0x57470101'},
        'coverage': ['all donor persistent flag/var symbols', 'separate trainer defeated flags', 'native Emerald party/PC/bag/identity retained', 'new-game clear', 'existing save chunk serialization', 'region-specific badge HM gates', 'semantic donor special-var box and text-color mapping', 'separate encrypted64slot donor stat bank and source bounds/saturation', 'common-name native event stat routing excluding12/32/51', 'stat encryption rekey across both banks', 'partial SAVE_LINK/EREADER includes finalPCsector in both commit passes'],
        'unresolved': ['Actual cartridge save/load and reset/restart qualification remains unrun.', 'Donor non-flag/var campaign structures (roamer, Fame Checker, quest log, VS Seeker, help system) require explicit owner implementations.', 'Donor key-item active-use handlers must be imported; Emerald defines FR key items but several use CannotUse handlers.', 'First Kanto entry must run FR_EventScript_ResetAllMapFlags exactly once; entry owner integration pending.', 'Native regional campaign readers (badge stat bonuses, obedience, Fly destinations, dynamic object graphics) require service routing audit.', 'Complete campaign script/special compatibility and traversal source integration are owned by scripts/world workers and remain unqualified.'],
        'partialSaveCost': {'previousSectorWrites': 5, 'newSectorWrites': 6, 'extraSignatures': 1, 'nativeFlashDuration': 'unavailable; source protocol fixture only'},
        'gameStatSemantics': {'slots': 64, 'usedSlots': 52, 'encrypted': True, 'semanticCollisions': [12, 32, 51], 'sharedEventRouting': 'same-named host events route by region; donor-only IDs use FR accessors'},
        'source_pins': {str(path.relative_to(donor)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [donor / 'include/constants/flags.h', donor / 'include/constants/vars.h', donor / 'include/constants/game_stat.h', donor / 'src/overworld.c']},
    }

apply_state = apply
