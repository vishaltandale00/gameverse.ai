"""Port FireRed's field-world services into the staged Emerald source tree.

The donor and base inputs are immutable snapshots. This stage owns the Kanto
Safari and roamer implementations plus narrow shared-bag adapters; qualification
of the complete campaign remains a separate gate.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _replace_once(path: Path, old: str, new: str, changed: list[str], root: Path) -> None:
    text = path.read_text()
    if text.count(old) != 1:
        raise ValueError(f"{path}: expected one anchor {old!r}, got {text.count(old)}")
    path.write_text(text.replace(old, new))
    changed.append(path.relative_to(root).as_posix())


def _alias_state_symbol(path: Path, name: str, native: str,
                        allowed_values: set[int], changed: list[str], root: Path) -> None:
    text = path.read_text()
    pattern = rf'(?m)^#define {name} (\S+)$'
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError(f'{path}: expected one {name} definition')
    value = matches[0][1]
    if value != native:
        if not value.startswith('0x') or int(value, 16) not in allowed_values:
            raise ValueError(f'{path}: unrecognized {name} value {value}')
        path.write_text(text[:matches[0].start(1)] + native + text[matches[0].end(1):])
        changed.append(path.relative_to(root).as_posix())


def _fr_roamer(donor: Path) -> str:
    source = (donor / "src/roamer.c").read_text()
    # Keep FireRed's complete route table, movement algorithm and battle-mon
    # reconstruction; replace only storage, map namespace, and public symbols.
    names = ("ClearRoamerData", "CreateInitialRoamerMon", "InitRoamer",
             "UpdateLocationHistoryForRoamer", "RoamerMoveToOtherLocationSet",
             "RoamerMove", "IsRoamerAt", "CreateRoamerMonInstance",
             "TryStartRoamerEncounter", "UpdateRoamerHPStatus",
             "SetRoamerInactive", "GetRoamerLocation",
             "GetRoamerLocationMapSectionId")
    for name in names:
        source = re.sub(rf"\b{name}\b", "FR_" + name, source)
    source = re.sub(r"\bMAP_(ROUTE\d+(?:_NORTH)?)\b", r"MAP_FR_\1", source)
    source = source.replace("#define ROAMER_MAP_GROUP 3", "#define ROAMER_MAP_GROUP MAP_GROUP(MAP_FR_ROUTE1)")
    source = source.replace("#define ROAMER (&gSaveBlock1Ptr->roamer)",
                            "#define ROAMER WholeGameFR_GetRoamer()")
    source = source.replace("EWRAM_DATA u8 sLocationHistory[3][2] = {};\nEWRAM_DATA u8 sRoamerLocation[2] = {};",
                            "#define sLocationHistory (gPokemonStoragePtr->wholeGameKanto.frRoamerHistory)\n"
                            "#define sRoamerLocation (gPokemonStoragePtr->wholeGameKanto.frRoamerLocation)")
    source = source.replace("GetStarterSpecies()", "FR_GetStarterSpecies()")
    source = source.replace("#include \"field_specials.h\"", "#include \"field_specials.h\"\n"
                            "#include \"pokemon_storage_system.h\"\n"
                            "#include \"firered_native_services.h\"\n"
                            "#include \"whole_game_world_services.h\"")
    source += "\nstruct Roamer *WholeGameFR_GetRoamer(void)\n{\n    return &gPokemonStoragePtr->wholeGameKanto.frRoamer;\n}\n"
    source += "\nbool8 WholeGameFR_TryStartRoamerEncounter(void)\n{\n    return FR_TryStartRoamerEncounter();\n}\n"
    for name in names:
        if not re.search(rf"\bFR_{name}\s*\(", source):
            raise ValueError(f"missing ported roamer function {name}")
    return source


SAFARI = r'''#include "global.h"
#include "battle.h"
#include "event_data.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "main.h"
#include "overworld.h"
#include "pokemon_storage_system.h"
#include "safari_zone.h"
#include "script.h"
#include "whole_game_state.h"
#include "whole_game_world_services.h"
#include "constants/game_stat.h"
#include "constants/whole_game_fr_state.h"
#include "constants/field_weather.h"

extern const u8 FR_SafariZone_EventScript_TimesUp[];
extern const u8 FR_SafariZone_EventScript_RetirePrompt[];
extern const u8 FR_SafariZone_EventScript_OutOfBallsMidBattle[];
extern const u8 FR_SafariZone_EventScript_OutOfBalls[];

bool32 FR_GetSafariZoneFlag(void)
{
    return FlagGet(FR_FLAG_SYS_SAFARI_MODE);
}

void FR_EnterSafariMode(void)
{
    IncrementGameStat(GAME_STAT_ENTERED_SAFARI_ZONE);
    FlagSet(FR_FLAG_SYS_SAFARI_MODE);
    gNumSafariBalls = 30;
    gPokemonStoragePtr->wholeGameKanto.frSafariBalls = 30;
    gPokemonStoragePtr->wholeGameKanto.frSafariSteps = 600;
}

void FR_ExitSafariMode(void)
{
    FlagClear(FR_FLAG_SYS_SAFARI_MODE);
    gNumSafariBalls = 0;
    gPokemonStoragePtr->wholeGameKanto.frSafariBalls = 0;
    gPokemonStoragePtr->wholeGameKanto.frSafariSteps = 0;
}

bool8 FR_SafariZoneTakeStep(void)
{
    if (!FR_GetSafariZoneFlag())
        return FALSE;
    if (gPokemonStoragePtr->wholeGameKanto.frSafariSteps == 0)
        return TRUE;
    if (--gPokemonStoragePtr->wholeGameKanto.frSafariSteps == 0)
    {
        ScriptContext_SetupScript(FR_SafariZone_EventScript_TimesUp);
        return TRUE;
    }
    return FALSE;
}

void FR_SafariZoneRetirePrompt(void)
{
    ScriptContext_SetupScript(FR_SafariZone_EventScript_RetirePrompt);
}

void FR_CB2_EndSafariBattle(void)
{
    gPokemonStoragePtr->wholeGameKanto.frSafariBalls = gNumSafariBalls;
    if (gNumSafariBalls != 0)
        SetMainCallback2(CB2_ReturnToField);
    else if (gBattleOutcome == B_OUTCOME_NO_SAFARI_BALLS)
    {
        RunScriptImmediately(FR_SafariZone_EventScript_OutOfBallsMidBattle);
        WarpIntoMap();
        // Emerald's native callback performs the same music/fade/unlock
        // sequence as FireRed's FieldCB_SafariZoneRanOutOfBalls.
        gFieldCallback = FieldCB_ReturnToFieldNoScriptCheckMusic;
        SetMainCallback2(CB2_LoadMap);
    }
    else if (gBattleOutcome == B_OUTCOME_CAUGHT)
    {
        ScriptContext_SetupScript(FR_SafariZone_EventScript_OutOfBalls);
        ScriptContext_Stop();
        SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
    }
}

void WholeGameFR_RestoreSafariBalls(void)
{
    if (WholeGame_IsKanto() && FR_GetSafariZoneFlag())
        gNumSafariBalls = gPokemonStoragePtr->wholeGameKanto.frSafariBalls;
}
'''

BAG = r'''#include "global.h"
#include "event_data.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "item.h"
#include "item_menu.h"
#include "item_use.h"
#include "menu_helpers.h"
#include "overworld.h"
#include "palette.h"
#include "task.h"
#include "whole_game_world_services.h"
#include "constants/item.h"
#include "constants/items.h"
#include "constants/whole_game_fr_state.h"
#include "constants/field_weather.h"

static bool8 sFRNativeBagCall;

bool8 WholeGameFR_NativeBagCall(void)
{
    return sFRNativeBagCall;
}

static bool8 FR_AddNativeBagItem(u16 itemId, u16 count)
{
    bool8 result;
    sFRNativeBagCall = TRUE;
    result = AddBagItem(itemId, count);
    sFRNativeBagCall = FALSE;
    return result;
}

// Item constants in the merged source are symbol-mapped to host item IDs.
// These adapters preserve FireRed's acquisition rule while all contents live
// in the one native Emerald bag. A failed container or item insertion rolls
// back the newly granted container.
bool8 FR_AddBagItem(u16 itemId, u16 count)
{
    u16 container = ITEM_NONE;
    bool8 granted = FALSE;
    u8 pocket = GetItemPocket(itemId);
    if (itemId == ITEM_NONE || count == 0 || pocket == POCKET_NONE)
        return FALSE;
    if (pocket == POCKET_TM_HM)
        container = ITEM_TM_CASE;
    else if (pocket == POCKET_BERRIES)
        container = ITEM_BERRY_POUCH;
    if (container != ITEM_NONE && !CheckBagHasItem(container, 1))
    {
        if (!CheckBagHasSpace(container, 1) || !CheckBagHasSpace(itemId, count))
            return FALSE;
        if (!FR_AddNativeBagItem(container, 1))
            return FALSE;
        granted = TRUE;
    }
    if (!FR_AddNativeBagItem(itemId, count))
    {
        if (granted)
            RemoveBagItem(container, 1);
        return FALSE;
    }
    if (itemId == ITEM_BERRY_POUCH || container == ITEM_BERRY_POUCH)
        FlagSet(FR_FLAG_SYS_GOT_BERRY_POUCH);
    return TRUE;
}

bool8 FR_CheckBagHasItem(u16 itemId, u16 count)
{
    if (itemId == ITEM_NONE || count == 0 || GetItemPocket(itemId) == POCKET_NONE)
        return FALSE;
    return CheckBagHasItem(itemId, count);
}

bool8 FR_CheckBagHasSpace(u16 itemId, u16 count)
{
    if (itemId == ITEM_NONE || count == 0 || GetItemPocket(itemId) == POCKET_NONE)
        return FALSE;
    if (GetItemPocket(itemId) == POCKET_TM_HM && !CheckBagHasItem(ITEM_TM_CASE, 1)
     && !CheckBagHasSpace(ITEM_TM_CASE, 1))
        return FALSE;
    if (GetItemPocket(itemId) == POCKET_BERRIES && !CheckBagHasItem(ITEM_BERRY_POUCH, 1)
     && !CheckBagHasSpace(ITEM_BERRY_POUCH, 1))
        return FALSE;
    return CheckBagHasSpace(itemId, count);
}

bool8 FR_RemoveBagItem(u16 itemId, u16 count)
{
    if (itemId == ITEM_NONE || count == 0 || GetItemPocket(itemId) == POCKET_NONE)
        return FALSE;
    return RemoveBagItem(itemId, count);
}

bool8 FR_HasAtLeastOneBerry(void)
{
    u16 itemId;
    if (!CheckBagHasItem(ITEM_BERRY_POUCH, 1))
    {
        gSpecialVar_Result = FALSE;
        return FALSE;
    }
    for (itemId = FIRST_BERRY_INDEX; itemId <= LAST_BERRY_INDEX; itemId++)
    {
        if (CheckBagHasItem(itemId, 1))
        {
            gSpecialVar_Result = TRUE;
            return TRUE;
        }
    }
    gSpecialVar_Result = FALSE;
    return FALSE;
}

static void FR_OpenTMCaseFromBag(void)
{
    GoToBagMenu(ITEMMENULOCATION_LAST, TMHM_POCKET, NULL);
}

static void FR_OpenBerryPouchFromBag(void)
{
    GoToBagMenu(ITEMMENULOCATION_LAST, BERRIES_POCKET, NULL);
}

static void FR_Task_OpenRegisteredPocket(u8 taskId)
{
    if (!gPaletteFade.active)
    {
        u8 pocket = gTasks[taskId].data[4];
        CleanupOverworldWindowsAndTilemaps();
        GoToBagMenu(ITEMMENULOCATION_FIELD, pocket, CB2_ReturnToField);
        DestroyTask(taskId);
    }
}

static void FR_UseContainerOnField(u8 taskId, u8 pocket, MainCallback callback)
{
    // Matches the native registered-item branch used by Pokeblock Case.
    // From the open bag, close it before opening the selected native pocket.
    if (MenuHelpers_IsLinkActive())
    {
        ItemUseOutOfBattle_CannotUse(taskId);
        return;
    }
    if (gTasks[taskId].data[3])
    {
        gFieldCallback = FieldCB_ReturnToFieldNoScript;
        gTasks[taskId].data[4] = pocket;
        FadeScreen(FADE_TO_BLACK, 0);
        gTasks[taskId].func = FR_Task_OpenRegisteredPocket;
    }
    else
    {
        gBagMenu->newScreenCallback = callback;
        Task_FadeAndCloseBagMenu(taskId);
    }
}

void FR_ItemUseOutOfBattle_TMCase(u8 taskId)
{
    FR_UseContainerOnField(taskId, TMHM_POCKET, FR_OpenTMCaseFromBag);
}

void FR_ItemUseOutOfBattle_BerryPouch(u8 taskId)
{
    FR_UseContainerOnField(taskId, BERRIES_POCKET, FR_OpenBerryPouchFromBag);
}
'''

TRAINER_TOWER = r'''#include "global.h"
#include "load_save.h"
#include "pokemon_storage_system.h"
#include "whole_game_world_services.h"

// Provided by the later Trainer Tower source stage; reset never leaves a
// VBlank timer pointing at a previous challenge's saved record.
void FR_DisableTowerTimer(void);

struct FR_TrainerTower *WholeGameFR_GetTrainerTowerRecords(void)
{
    return gPokemonStoragePtr->wholeGameKanto.frTrainerTower;
}

u32 *WholeGameFR_GetTowerChallengeIdPtr(void)
{
    return &gPokemonStoragePtr->wholeGameKanto.frTowerChallengeId;
}

bool8 FR_TrainerTowerSpokeToOwner(void)
{
    u32 challenge = gPokemonStoragePtr->wholeGameKanto.frTowerChallengeId;
    if (challenge >= 4)
        return FALSE;
    return gPokemonStoragePtr->wholeGameKanto.frTrainerTower[challenge].spokeToOwner;
}

void FR_ResetTrainerTowerState(void)
{
    u32 i;
    FR_DisableTowerTimer();
    memset(gPokemonStoragePtr->wholeGameKanto.frTrainerTower, 0,
           sizeof(gPokemonStoragePtr->wholeGameKanto.frTrainerTower));
    gPokemonStoragePtr->wholeGameKanto.frTowerChallengeId = 0;
    for (i = 0; i < 4; i++)
        gPokemonStoragePtr->wholeGameKanto.frTrainerTower[i].bestTime = 215999 ^ gSaveBlock2Ptr->encryptionKey;
}

void FR_ApplyNewEncryptionKeyToTrainerTower(u32 newKey)
{
    u32 i;
    for (i = 0; i < 4; i++)
        ApplyNewEncryptionKeyToWord(&gPokemonStoragePtr->wholeGameKanto.frTrainerTower[i].bestTime, newKey);
}

void FR_SelectTrainerTowerChallenge(u32 challenge)
{
    if (challenge >= 4)
        challenge = 0;
    gPokemonStoragePtr->wholeGameKanto.frTowerChallengeId = challenge;
}

void FR_RecordTrainerTowerOwnerConversation(void)
{
    u32 challenge = gPokemonStoragePtr->wholeGameKanto.frTowerChallengeId;
    if (challenge < 4)
        gPokemonStoragePtr->wholeGameKanto.frTrainerTower[challenge].spokeToOwner = TRUE;
}

void *WholeGameFR_GetEReaderTrainer(void)
{
    return gPokemonStoragePtr->wholeGameKanto.frEReaderTrainer;
}

void FR_ResetEReaderTrainer(void)
{
    memset(gPokemonStoragePtr->wholeGameKanto.frEReaderTrainer, 0,
           sizeof(gPokemonStoragePtr->wholeGameKanto.frEReaderTrainer));
}
'''


def _patch_world(output: Path, changed: list[str]) -> None:
    # Native engine entry points remain the sole callers. FireRed's source
    # scripts call FR_* specials, while walking and battle callbacks dispatch
    # by the actual current map group.
    safari = output / "src/safari_zone.c"
    _replace_once(safari, '#include "safari_zone.h"', '#include "safari_zone.h"\n#include "whole_game_state.h"\n#include "whole_game_world_services.h"', changed, output)
    for old, new in (
        ('    return FlagGet(FLAG_SYS_SAFARI_MODE);', '    if (WholeGame_IsKanto()) return FR_GetSafariZoneFlag();\n    return FlagGet(FLAG_SYS_SAFARI_MODE);'),
        ('    IncrementGameStat(GAME_STAT_ENTERED_SAFARI_ZONE);', '    if (WholeGame_IsKanto()) { FR_EnterSafariMode(); return; }\n    IncrementGameStat(GAME_STAT_ENTERED_SAFARI_ZONE);'),
        ('    TryPutSafariFanClubOnAir(sSafariZoneCaughtMons, sSafariZonePkblkUses);', '    if (WholeGame_IsKanto()) { FR_ExitSafariMode(); return; }\n    TryPutSafariFanClubOnAir(sSafariZoneCaughtMons, sSafariZonePkblkUses);'),
        ('    if (GetSafariZoneFlag() == FALSE)', '    if (WholeGame_IsKanto()) return FR_SafariZoneTakeStep();\n    if (GetSafariZoneFlag() == FALSE)'),
        ('    ScriptContext_SetupScript(SafariZone_EventScript_RetirePrompt);', '    if (WholeGame_IsKanto()) { FR_SafariZoneRetirePrompt(); return; }\n    ScriptContext_SetupScript(SafariZone_EventScript_RetirePrompt);'),
        ('    sSafariZonePkblkUses += gBattleResults.pokeblockThrows;', '    if (WholeGame_IsKanto()) { FR_CB2_EndSafariBattle(); return; }\n    sSafariZonePkblkUses += gBattleResults.pokeblockThrows;'),
    ):
        _replace_once(safari, old, new, changed, output)
    # Roamer movement and capture/defeat lifetime are retained by the native
    # engine; only the state owner is selected by the active world.
    overworld = output / "src/overworld.c"
    _replace_once(overworld, '#include "roamer.h"', '#include "roamer.h"\n#include "whole_game_state.h"\n#include "whole_game_world_services.h"', changed, output)
    text = overworld.read_text()
    for name in ("UpdateLocationHistoryForRoamer", "RoamerMoveToOtherLocationSet", "RoamerMove"):
        old = f"    {name}();"
        if old not in text:
            raise ValueError(f"overworld missing {name} call")
        text = text.replace(old, f"    if (WholeGame_IsKanto()) FR_{name}(); else {name}();")
    overworld.write_text(text)
    _replace_once(overworld, 'static void UpdateMiscOverworldStates(void)\n{\n    FlagClear(FLAG_SYS_SAFARI_MODE);',
                  'static void UpdateMiscOverworldStates(void)\n{\n    FlagClear(FLAG_SYS_SAFARI_MODE);\n    WholeGameFR_RestoreSafariBalls();',
                  changed, output)
    battle = output / "src/battle_main.c"
    _replace_once(battle, '#include "roamer.h"', '#include "roamer.h"\n#include "whole_game_state.h"\n#include "whole_game_world_services.h"', changed, output)
    _replace_once(battle, '        UpdateRoamerHPStatus(&gEnemyParty[0]);', '        if (WholeGame_IsKanto()) FR_UpdateRoamerHPStatus(&gEnemyParty[0]);\n        else UpdateRoamerHPStatus(&gEnemyParty[0]);', changed, output)
    _replace_once(battle, '            SetRoamerInactive();',
                  '        {\n            if (WholeGame_IsKanto())\n                FR_SetRoamerInactive();\n            else\n                SetRoamerInactive();\n        }',
                  changed, output)


def stage_world_services(base_archive: Path, donor_archive: Path,
                         merged_emerald_output: Path, report_dir: Path) -> dict:
    started = time.monotonic()
    base, donor, output = map(lambda p: Path(p).resolve(),
                              (base_archive, donor_archive, merged_emerald_output))
    if (output in (base, donor) or output.is_relative_to(base)
            or output.is_relative_to(donor)
            or output.name in ("pokeemerald", "pokefirered")):
        raise ValueError("world services require an isolated output tree")
    report_dir = Path(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    if not (output / 'include/pokemon_storage_system.h').exists():
        raise ValueError('state stage must populate isolated Emerald output before world services')
    donor_global = (donor / 'include/global.h').read_text()
    donor_constants = (donor / 'include/constants/global.h').read_text()
    if '#define NUM_TOWER_CHALLENGE_TYPES 4' not in donor_constants:
        raise ValueError('FireRed Trainer Tower challenge count changed')
    if not re.search(r'struct TrainerTower\s*\{[^}]*bool8 spokeToOwner:1;[^}]*\};', donor_global, re.S):
        raise ValueError('FireRed Trainer Tower ABI changed')
    ereader = re.search(r'struct BattleTowerEReaderTrainer\s*\{([^}]+)\};', donor_global, re.S)
    if ereader is None or not all(re.search(pattern, ereader[1]) for pattern in (
            r'\bu8 unk0;', r'\bu8 trainerClass;', r'\bu16 winStreak;',
            r'\bu8 name\[8\];', r'\bu8 trainerId\[4\];',
            r'\bu16 greeting\[6\];', r'\bu16 farewellPlayerLost\[6\];',
            r'\bu16 farewellPlayerWon\[6\];',
            r'\bstruct BattleTowerPokemon party\[3\];',
            r'\bu32 checksum;')):
        raise ValueError('FireRed EReader trainer bank ABI changed')
    changed: list[str] = []
    storage = output / 'include/pokemon_storage_system.h'
    _replace_once(storage, 'struct PokemonStorage\n{', '''// Exact FireRed SaveBlock1 TrainerTower ABI (four 12-byte records).
struct FR_TrainerTower
{
    u32 timer;
    u32 bestTime;
    u8 floorsCleared;
    u8 unk9;
    bool8 receivedPrize:1;
    bool8 checkedFinalTime:1;
    bool8 spokeToOwner:1;
    bool8 hasLost:1;
    bool8 unkA_4:1;
    bool8 validated:1;
};
typedef char WholeGameFRTrainerTowerSize[(sizeof(struct FR_TrainerTower) == 12) ? 1 : -1];

struct PokemonStorage
{''', changed, output)
    _replace_once(storage, '        u8 rivalName[8];', '''        u8 rivalName[8];
        struct Roamer frRoamer;
        u8 frRoamerLocation[2];
        u8 frRoamerHistory[3][2];
        u16 frSafariSteps;
        u8 frSafariBalls;
        u8 frSafariPad;
        u32 frTowerChallengeId;
        struct FR_TrainerTower frTrainerTower[4];
        // Exact 0xBC-byte FireRed EReaderTrainer bank, naturally 4-byte aligned.
        u32 frEReaderTrainer[47];''', changed, output)
    # The extension grows by 280 bytes. Other stages own additional fields;
    # the existing C compile assertions enforce the aggregate sector limit.
    header = output / 'include/whole_game_world_services.h'
    header.write_text('''#ifndef GUARD_WHOLE_GAME_WORLD_SERVICES_H
#define GUARD_WHOLE_GAME_WORLD_SERVICES_H
#include "global.h"
struct Roamer *WholeGameFR_GetRoamer(void);
bool8 WholeGameFR_TryStartRoamerEncounter(void);
void FR_ClearRoamerData(void);
void FR_InitRoamer(void);
void FR_UpdateLocationHistoryForRoamer(void);
void FR_RoamerMoveToOtherLocationSet(void);
void FR_RoamerMove(void);
void FR_UpdateRoamerHPStatus(struct Pokemon *mon);
void FR_SetRoamerInactive(void);
bool32 FR_GetSafariZoneFlag(void);
void FR_EnterSafariMode(void);
void FR_ExitSafariMode(void);
bool8 FR_SafariZoneTakeStep(void);
void FR_SafariZoneRetirePrompt(void);
void FR_CB2_EndSafariBattle(void);
void WholeGameFR_RestoreSafariBalls(void);
bool8 FR_AddBagItem(u16 itemId, u16 count);
bool8 WholeGameFR_NativeBagCall(void);
bool8 FR_CheckBagHasItem(u16 itemId, u16 count);
bool8 FR_CheckBagHasSpace(u16 itemId, u16 count);
bool8 FR_RemoveBagItem(u16 itemId, u16 count);
bool8 FR_HasAtLeastOneBerry(void);
void FR_ItemUseOutOfBattle_TMCase(u8 taskId);
void FR_ItemUseOutOfBattle_BerryPouch(u8 taskId);
bool8 FR_TrainerTowerSpokeToOwner(void);
struct FR_TrainerTower *WholeGameFR_GetTrainerTowerRecords(void);
u32 *WholeGameFR_GetTowerChallengeIdPtr(void);
void FR_ResetTrainerTowerState(void);
void FR_ApplyNewEncryptionKeyToTrainerTower(u32 newKey);
void FR_SelectTrainerTowerChallenge(u32 challenge);
void FR_RecordTrainerTowerOwnerConversation(void);
void *WholeGameFR_GetEReaderTrainer(void);
void FR_ResetEReaderTrainer(void);
#endif
''')
    changed.append(header.relative_to(output).as_posix())
    # Both engines use one physical bag. Repel/flute effects are also one
    # field effect, so donor references must resolve to the native live state
    # rather than an unused copy in Kanto's flag/var extension.
    state_constants = output / 'include/constants/whole_game_fr_state.h'
    _alias_state_symbol(state_constants, 'FR_VAR_REPEL_STEP_COUNT',
                        'VAR_REPEL_STEP_COUNT', {0x5020, 0x4021}, changed, output)
    _alias_state_symbol(state_constants, 'FR_FLAG_SYS_WHITE_FLUTE_ACTIVE',
                        'FLAG_SYS_ENC_UP_ITEM', {0x1803, 0x8AD}, changed, output)
    _alias_state_symbol(state_constants, 'FR_FLAG_SYS_BLACK_FLUTE_ACTIVE',
                        'FLAG_SYS_ENC_DOWN_ITEM', {0x1804, 0x8AE}, changed, output)
    roamer = output / 'src/firered_world_roamer.c'
    roamer.write_text(_fr_roamer(donor))
    changed.append(roamer.relative_to(output).as_posix())
    safari = output / 'src/firered_world_safari.c'
    safari.write_text(SAFARI)
    changed.append(safari.relative_to(output).as_posix())
    bag = output / 'src/firered_world_bag.c'
    bag.write_text(BAG)
    changed.append(bag.relative_to(output).as_posix())
    tower = output / 'src/firered_world_trainer_tower.c'
    tower.write_text(TRAINER_TOWER)
    changed.append(tower.relative_to(output).as_posix())
    items = output / 'src/data/items.h'
    item_text = items.read_text()
    for item, callback in (('ITEM_TM_CASE', 'FR_ItemUseOutOfBattle_TMCase'),
                           ('ITEM_BERRY_POUCH', 'FR_ItemUseOutOfBattle_BerryPouch')):
        pattern = rf'(\[{item}\]\s*=\s*\{{[^}}]*?\.fieldUseFunc\s*=\s*)ItemUseOutOfBattle_CannotUse'
        item_text, count = re.subn(pattern, rf'\g<1>{callback}', item_text, count=1, flags=re.S)
        if count != 1:
            raise ValueError(f'{items}: missing source item-use entry {item}')
    items.write_text(item_text)
    changed.append(items.relative_to(output).as_posix())
    item_owner = output / 'src/item.c'
    _replace_once(item_owner, '#include "item.h"',
                  '#include "item.h"\n#include "whole_game_state.h"\n#include "whole_game_world_services.h"', changed, output)
    _replace_once(item_owner, '''bool8 AddBagItem(u16 itemId, u16 count)
{
    u8 i;''', '''bool8 AddBagItem(u16 itemId, u16 count)
{
    u8 i;

    if (gSaveBlock1Ptr != NULL && WholeGame_IsKanto() && !WholeGameFR_NativeBagCall())
        return FR_AddBagItem(itemId, count);''', changed, output)
    load_save = output / 'src/load_save.c'
    _replace_once(load_save, '#include "load_save.h"',
                  '#include "load_save.h"\n#include "whole_game_world_services.h"', changed, output)
    _replace_once(load_save, '''static void ApplyNewEncryptionKeyToAllEncryptedData(u32 encryptionKey)
{
    ApplyNewEncryptionKeyToGameStats(encryptionKey);''', '''static void ApplyNewEncryptionKeyToAllEncryptedData(u32 encryptionKey)
{
    FR_ApplyNewEncryptionKeyToTrainerTower(encryptionKey);
    ApplyNewEncryptionKeyToGameStats(encryptionKey);''', changed, output)
    new_game = output / 'src/new_game.c'
    _replace_once(new_game, '#include "new_game.h"',
                  '#include "new_game.h"\n#include "whole_game_world_services.h"', changed, output)
    _replace_once(new_game, '    ResetPokemonStorageSystem();',
                  '    ResetPokemonStorageSystem();\n    FR_ResetTrainerTowerState();\n    FR_ResetEReaderTrainer();', changed, output)
    _patch_world(output, changed)
    ledger = {
        'component': 'world_services', 'status': 'partial', 'buildEligible': False,
        'changed_files': sorted(set(changed)),
        'coverage': ['FireRed Safari 600-step lifecycle and source scripts',
                     'FireRed roamer route table, movement, encounter, battle HP/status and defeat persistence',
                     'separate saved Kanto roamer and Safari state with existing storage-sector size guard',
                     'FireRed shared-bag TM Case/Berry Pouch auto-grant with rollback and berry eligibility',
                     'TM Case and Berry Pouch active-use callbacks open native TM/Berry pockets',
                     'four exact donor Trainer Tower records, encrypted best times and source-backed owner flag',
                     '188-byte 4-byte-aligned FireRed EReader trainer save bank with typed accessor and reset'],
        'unresolved': ['Exact registered-key-item and nested-bag UI exit behavior requires live gameplay qualification.',
                       'Donor scripts must bind all FR_* specials and field callbacks in final link.',
                       'Complete source compile and live Safari/roamer gameplay qualification remain unrun.'],
        'saveLayout': {'addedBytes': 280, 'maximumExtensionBytes': 1968,
                       'aggregateBytes': 'compile-time check pending',
                       'assertedBy': 'src/event_data.c'},
        'source_pins': {f'src/{name}.c': _sha(donor / f'src/{name}.c')
                        for name in ('safari_zone', 'roamer', 'item', 'item_use', 'trainer_tower')},
        'durationMs': round((time.monotonic() - started) * 1000),
    }
    ledger['source_pins'].update({f'include/{name}': _sha(donor / f'include/{name}')
                                  for name in ('global.h', 'constants/global.h')})
    (report_dir / 'world-services-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n')
    return ledger
