"""Regional source progression policy for the staged single-ROM engine.

This stage deliberately does not substitute Hoenn's ending for FireRed's
credits.  Its ledger remains blocked until the original Kanto Hall of Fame
and credits callback chain is linked and qualified.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path


HEADER = '''#ifndef GUARD_WHOLE_GAME_PROGRESSION_H
#define GUARD_WHOLE_GAME_PROGRESSION_H
#include "global.h"
enum WholeGameBadge
{
    WHOLE_GAME_BADGE_1,
    WHOLE_GAME_BADGE_2,
    WHOLE_GAME_BADGE_3,
    WHOLE_GAME_BADGE_4,
    WHOLE_GAME_BADGE_5,
    WHOLE_GAME_BADGE_6,
    WHOLE_GAME_BADGE_7,
    WHOLE_GAME_BADGE_8,
    WHOLE_GAME_BADGE_COUNT
};
bool8 WholeGame_HasRegionalBadge(enum WholeGameBadge badge);
bool8 WholeGame_HasRegionalBadgeFlag(u16 hoennBadgeFlag);
bool8 FR_EnterHallOfFame(void);
#endif
'''

SOURCE = '''#include "global.h"
#include "event_data.h"
#include "whole_game_state.h"
#include "whole_game_progression.h"
#include "constants/flags.h"
#include "constants/whole_game_fr_state.h"
#include "constants/whole_game_fr_heal_locations.h"
#include "constants/game_stat.h"
#include "credits.h"
#include "hall_of_fame.h"
#include "load_save.h"
#include "main.h"
#include "overworld.h"
#include "script_pokemon_util.h"

static const u16 sHoennBadgeFlags[WHOLE_GAME_BADGE_COUNT] =
{
    FLAG_BADGE01_GET, FLAG_BADGE02_GET, FLAG_BADGE03_GET, FLAG_BADGE04_GET,
    FLAG_BADGE05_GET, FLAG_BADGE06_GET, FLAG_BADGE07_GET, FLAG_BADGE08_GET,
};

static const u16 sKantoBadgeFlags[WHOLE_GAME_BADGE_COUNT] =
{
    FR_FLAG_BADGE01_GET, FR_FLAG_BADGE02_GET, FR_FLAG_BADGE03_GET, FR_FLAG_BADGE04_GET,
    FR_FLAG_BADGE05_GET, FR_FLAG_BADGE06_GET, FR_FLAG_BADGE07_GET, FR_FLAG_BADGE08_GET,
};

bool8 WholeGame_HasRegionalBadge(enum WholeGameBadge badge)
{
    if ((u32)badge >= WHOLE_GAME_BADGE_COUNT)
        return FALSE;
    if (WholeGame_IsKanto())
        return FlagGet(sKantoBadgeFlags[badge]);
    return FlagGet(sHoennBadgeFlags[badge]);
}

bool8 WholeGame_HasRegionalBadgeFlag(u16 hoennBadgeFlag)
{
    u32 i;
    for (i = 0; i < WHOLE_GAME_BADGE_COUNT; i++)
        if (hoennBadgeFlag == sHoennBadgeFlags[i])
            return WholeGame_HasRegionalBadge(i);
    return FALSE;
}

// FireRed's EnterHallOfFame special, adapted only at the shared save/UI ABI.
// Its original script already performs the Elite Four reset and Pallet respawn.
bool8 FR_EnterHallOfFame(void)
{
    u32 i;
    bool8 gaveRibbon = FALSE;
    u8 ribbonState = TRUE;

    HealPlayerParty();
    // The Hall of Fame team array is intentionally shared by both campaigns.
    // A first championship in one region must not erase the other's history.
    gHasHallOfFameRecords = FlagGet(FLAG_SYS_GAME_CLEAR) || FlagGet(FR_FLAG_SYS_GAME_CLEAR);
    if (!FlagGet(FR_FLAG_SYS_GAME_CLEAR))
        FlagSet(FR_FLAG_SYS_GAME_CLEAR);

    if (FR_GetGameStat(GAME_STAT_FIRST_HOF_PLAY_TIME) == 0)
        FR_SetGameStat(GAME_STAT_FIRST_HOF_PLAY_TIME,
            (gSaveBlock2Ptr->playTimeHours << 16) |
            (gSaveBlock2Ptr->playTimeMinutes << 8) |
            gSaveBlock2Ptr->playTimeSeconds);

    SetContinueGameWarpStatus();
    SetContinueGameWarpToHealLocation(FR_HEAL_LOCATION_PALLET_TOWN);
    for (i = 0; i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];
        if (GetMonData(mon, MON_DATA_SANITY_HAS_SPECIES)
            && !GetMonData(mon, MON_DATA_SANITY_IS_EGG)
            && !GetMonData(mon, MON_DATA_CHAMPION_RIBBON))
        {
            SetMonData(mon, MON_DATA_CHAMPION_RIBBON, &ribbonState);
            gaveRibbon = TRUE;
        }
    }
    if (gaveRibbon)
    {
        FR_IncrementGameStat(GAME_STAT_RECEIVED_RIBBONS);
        FlagSet(FR_FLAG_SYS_RIBBON_GET);
    }
    SetMainCallback2(CB2_DoHallOfFameScreen);
    return FALSE;
}
'''


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _patch(path: Path, old: str, new: str, changed: set[str], root: Path) -> None:
    source = path.read_text()
    if source.count(old) != 1:
        raise ValueError(f"progression source drift: {path}: {old!r} matched {source.count(old)}")
    path.write_text(source.replace(old, new))
    changed.add(path.relative_to(root).as_posix())


def _include(path: Path, changed: set[str], root: Path) -> None:
    source = path.read_text()
    if '#include "whole_game_progression.h"' in source:
        raise ValueError(f"progression already staged: {path}")
    path.write_text('#include "whole_game_progression.h"\n' + source)
    changed.add(path.relative_to(root).as_posix())


def stage_progression(base: Path, donor: Path, output: Path, report_dir: Path) -> dict:
    start = time.monotonic()
    base, donor, output, report_dir = map(Path, (base, donor, output, report_dir))
    if output.resolve() in (base.resolve(), donor.resolve()) or base.resolve() in output.resolve().parents or donor.resolve() in output.resolve().parents:
        raise ValueError('progression output must be an isolated merged source')
    for source in ('include/whole_game_state.h', 'include/constants/whole_game_fr_state.h'):
        if not (output / source).is_file():
            raise ValueError(f'prior state stage is required: {source}')
    for source, token in (('src/battle_util.c', 'u8 IsMonDisobedient(void)'),
                          ('src/pokemon.c', 'static bool8 ShouldGetStatBadgeBoost'),
                          ('src/battle_main.c', '// badge boost'),
                          ('src/battle_setup.c', 'static const u16 sBadgeFlags'),
                          ('src/post_battle_event_funcs.c', 'int GameClear(void)')):
        if token not in (base / source).read_text() or token not in (output / source).read_text():
            raise ValueError(f'base or staged progression source drift: {source}')
    for symbol in ('FR_FLAG_BADGE01_GET', 'FR_FLAG_BADGE08_GET',
                   'FR_FLAG_SYS_GAME_CLEAR', 'FR_FLAG_SYS_RIBBON_GET'):
        if symbol not in (output / 'include/constants/whole_game_fr_state.h').read_text():
            raise ValueError(f'missing region-owned state symbol {symbol}')
    changed: set[str] = set()
    header = output / 'include/whole_game_progression.h'
    header.write_text(HEADER)
    changed.add(header.relative_to(output).as_posix())
    runtime = output / 'src/whole_game_progression.c'
    runtime.write_text(SOURCE)
    changed.add(runtime.relative_to(output).as_posix())

    battle_util = output / 'src/battle_util.c'
    _include(battle_util, changed, output)
    for number in (8, 2, 4, 6):
        _patch(battle_util, f'FlagGet(FLAG_BADGE0{number}_GET)',
               f'WholeGame_HasRegionalBadge(WHOLE_GAME_BADGE_{number})', changed, output)
    battle_main = output / 'src/battle_main.c'
    _include(battle_main, changed, output)
    source = battle_main.read_text()
    if source.count('FlagGet(FLAG_BADGE03_GET)') != 2:
        raise ValueError('expected two native speed badge boosts')
    battle_main.write_text(source.replace('FlagGet(FLAG_BADGE03_GET)',
                                          'WholeGame_HasRegionalBadge(WHOLE_GAME_BADGE_3)'))
    changed.add(battle_main.relative_to(output).as_posix())
    pokemon = output / 'src/pokemon.c'
    _include(pokemon, changed, output)
    for number in (1, 5):
        _patch(pokemon, f'ShouldGetStatBadgeBoost(FLAG_BADGE0{number}_GET,',
               f'ShouldGetStatBadgeBoost(WHOLE_GAME_BADGE_{number},', changed, output)
    source = pokemon.read_text()
    if source.count('ShouldGetStatBadgeBoost(FLAG_BADGE07_GET,') != 2:
        raise ValueError('expected two native special badge boosts')
    pokemon.write_text(source.replace('ShouldGetStatBadgeBoost(FLAG_BADGE07_GET,',
                                      'ShouldGetStatBadgeBoost(WHOLE_GAME_BADGE_7,'))
    _patch(pokemon, 'static bool8 ShouldGetStatBadgeBoost(u16 flagId, u8 battler);',
           'static bool8 ShouldGetStatBadgeBoost(enum WholeGameBadge badge, u8 battler);', changed, output)
    _patch(pokemon, 'static bool8 ShouldGetStatBadgeBoost(u16 badgeFlag, u8 battler)',
           'static bool8 ShouldGetStatBadgeBoost(enum WholeGameBadge badge, u8 battler)', changed, output)
    _patch(pokemon, 'else if (FlagGet(badgeFlag))',
           'else if (WholeGame_HasRegionalBadge(badge))', changed, output)
    battle_setup = output / 'src/battle_setup.c'
    _include(battle_setup, changed, output)
    _patch(battle_setup, 'if (FlagGet(sBadgeFlags[i]) == TRUE)',
           'if (WholeGame_HasRegionalBadgeFlag(sBadgeFlags[i]) == TRUE)', changed, output)
    # These native displays are shared by both regions.  Their badge rows
    # reflect the active region, while each region's story flags stay private.
    for name, old, new in (
        ('main_menu.c', 'if (FlagGet(i))',
         'if (WholeGame_HasRegionalBadgeFlag(i))'),
        ('menu.c', 'if (FlagGet(curFlag))',
         'if (WholeGame_HasRegionalBadgeFlag(curFlag))'),
        ('trainer_card.c', 'if (FlagGet(badgeFlag))',
         'if (WholeGame_HasRegionalBadgeFlag(badgeFlag))'),
    ):
        path = output / 'src' / name
        _include(path, changed, output)
        _patch(path, old, new, changed, output)

    # Shared HOF history must survive the second region's first championship.
    # Story completion itself remains separately flagged per region.
    post_battle = output / 'src/post_battle_event_funcs.c'
    _include(post_battle, changed, output)
    _patch(post_battle, '#include "whole_game_progression.h"',
           '#include "whole_game_progression.h"\n#include "constants/whole_game_fr_state.h"', changed, output)
    _patch(post_battle, '''    if (FlagGet(FLAG_SYS_GAME_CLEAR) == TRUE)
    {
        gHasHallOfFameRecords = TRUE;
    }
    else
    {
        gHasHallOfFameRecords = FALSE;
        FlagSet(FLAG_SYS_GAME_CLEAR);
    }''', '''    gHasHallOfFameRecords = FlagGet(FLAG_SYS_GAME_CLEAR) || FlagGet(FR_FLAG_SYS_GAME_CLEAR);
    if (!FlagGet(FLAG_SYS_GAME_CLEAR))
        FlagSet(FLAG_SYS_GAME_CLEAR);''', changed, output)

    # Enumerate every native translation unit, including additional staged
    # ones, so postgame consumers are visible rather than implicitly cleared.
    audit = {}
    native_units = sorted((output / 'src').glob('*.c'))
    for path in native_units:
        text = path.read_text()
        counts = {'remainingHoennBadgeReads': text.count('FlagGet(FLAG_BADGE'),
                  'hoennGameClearReads': text.count('FlagGet(FLAG_SYS_GAME_CLEAR)'),
                  'hoennGameClearWrites': text.count('FlagSet(FLAG_SYS_GAME_CLEAR)')}
        if any(counts.values()):
            audit[path.name] = counts
    ledger = {
        'component': 'progression', 'status': 'blocked', 'buildEligible': False,
        'changed_files': sorted(changed),
        'providers': [{'name': 'EnterHallOfFame', 'target': 'FR_EnterHallOfFame',
                       'source': 'src/post_battle_event_funcs.c',
                       'status': 'source-ported-compilation-pending',
                       'bindings': ['FR_FLAG_SYS_GAME_CLEAR', 'FR_GetGameStat',
                                    'FR_HEAL_LOCATION_PALLET_TOWN', 'CB2_DoHallOfFameScreen']}],
        'coverage': ['Region-selected native combat badge boosts and traded-mon obedience',
                     'Region-selected native battle transition, save menu, and trainer card badge counts'],
        'auditedTranslationUnits': len(native_units),
        'audit': audit,
        'blockers': [
            'FireRed EnterHallOfFame special is staged, but its original credits/Hall of Fame exit callback chain is not yet linked.',
            'Other native game-clear consumers outside the donor scripts need regional review before postgame qualification.',
            'Full link and original ending gameplay are unverified.',
        ],
        'sourcePins': {name: _sha(donor / name) for name in
                       ('src/battle_util.c', 'src/battle_main.c', 'src/pokemon.c',
                        'src/post_battle_event_funcs.c', 'src/hall_of_fame.c', 'src/credits.c')},
        'timing': {'wallSeconds': time.monotonic() - start, 'buildSeconds': None,
                   'outcome': 'source-staged-qualification-blocked'},
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / 'progression-ledger.json').write_text(json.dumps(ledger, indent=2, sort_keys=True) + '\n')
    return ledger
