"""Native same-engine interregion campaign source transform.

The source transform is deterministic; native campaign qualification is separate.
Canonical decompositions are never written. Requires world, state, script stages.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

MARKER = 0x4B414E31


def initial_world_state(donor: Path) -> dict:
    """Extract the complete source-owned FR map bootstrap, fail on new commands."""
    root = (donor / 'data/event_scripts.s').read_text()
    match = re.search(r'^EventScript_ResetAllMapFlags::\n(.*?^\tend\s*$)', root, re.M | re.S)
    if not match:
        raise ValueError('donor map initialization entry missing')
    operations = []
    ended = False
    for line in match[1].splitlines():
        line = line.split('@', 1)[0].strip()
        if not line:
            continue
        if line == 'end':
            ended = True
            continue
        flag = re.fullmatch(r'setflag (FLAG_\w+)', line)
        var = re.fullmatch(r'setvar (VAR_\w+), (\d+)', line)
        if ended or not (flag or var):
            raise ValueError(f'unsupported donor initialization instruction: {line}')
        operations.append(['flag', flag[1]] if flag else ['var', var[1], int(var[2])])
    if not ended:
        raise ValueError('unterminated donor map initialization')
    renewable = (donor / 'src/renewable_hidden_items.c').read_text()
    table = renewable.split('static const struct RenewableHiddenItemData sRenewableHiddenItems[] = {', 1)[1].split('\n};', 1)[0]
    flags = sorted(set(re.findall(r'HIDDEN_ID\((FLAG_\w+)\)', table)))
    if not flags:
        raise ValueError('donor renewable item initialization table empty')
    return {'operations': operations, 'renewableFlags': flags,
            'compatibilityOperations': [['var', 'VAR_0x403C', 0x0302], ['flag', 'FLAG_0x838']],
            'unusedRsePokedexByte': 'Donor pokedex.unused=0xDA is unused in FR; do not mutate shared Emerald Pokedex.'}


def _init_source(state: dict) -> str:
    setters = []
    for op in state['operations'] + state['compatibilityOperations']:
        setters.append(f'    FlagSet(FR_{op[1]});' if op[0] == 'flag' else f'    VarSet(FR_{op[1]}, {op[2]});')
    setters += [f'    FlagSet(FR_{flag});' for flag in state['renewableFlags']]
    return '''#include "global.h"
#include "event_data.h"
#include "pokemon_storage_system.h"
#include "constants/characters.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_fr_encounters.h"
#include "whole_game_world_services.h"
#include "firered_fame_checker.h"
#include "whole_game_campaign.h"
#include "random.h"

// This initializes donor WORLD state, never a second trainer/save/party.
bool8 WholeGame_InitializeKanto(void)
{
    if (gPokemonStoragePtr->wholeGameKanto.campaignInitialized == 0x4B414E31)
    {
        gSpecialVar_Result = gPokemonStoragePtr->wholeGameKanto.rivalName[0] == EOS;
        return FALSE;
    }
''' + '\n'.join(setters) + '''
    FR_ResetFameChecker();
    FR_ResetTrainerTowerState();
    FR_ResetEReaderTrainer();
    FR_SeedWildEncounterRng(Random());
    gPokemonStoragePtr->wholeGameKanto.rivalName[0] = EOS;
    gSpecialVar_Result = TRUE;
    gPokemonStoragePtr->wholeGameKanto.campaignInitialized = 0x4B414E31;
    return FALSE;
}

const u8 *WholeGame_GetRivalName(void)
{
    return gPokemonStoragePtr->wholeGameKanto.rivalName;
}
'''


TRAVEL = '''@ Both destinations are compiled into this engine's ordinary map tables.
WholeGame_EventScript_HoennGuide::
    lock
    faceplayer
    goto_if_unset FLAG_SYS_POKEDEX_GET, WholeGame_EventScript_NotReady
    msgbox WholeGame_Text_ToKanto, MSGBOX_YESNO
    goto_if_eq VAR_RESULT, NO, WholeGame_EventScript_Cancel
    callnative WholeGame_InitializeKanto
    goto_if_eq VAR_RESULT, FALSE, WholeGame_EventScript_WarpToKanto
    msgbox WholeGame_Text_RivalName, MSGBOX_DEFAULT
    closemessage
    fadescreen FADE_TO_BLACK
    callnative WholeGame_NameKantoRival
    waitstate
WholeGame_EventScript_WarpToKanto::
    warp MAP_FR_PALLET_TOWN, 8, 12
    waitstate
    releaseall
    end

WholeGame_EventScript_KantoGuide::
    lock
    faceplayer
    msgbox WholeGame_Text_ToHoenn, MSGBOX_YESNO
    goto_if_eq VAR_RESULT, NO, WholeGame_EventScript_Cancel
    warp MAP_LITTLEROOT_TOWN, 9, 14
    waitstate
    releaseall
    end

WholeGame_EventScript_NotReady::
    msgbox WholeGame_Text_NotReady, MSGBOX_DEFAULT
WholeGame_EventScript_Cancel::
    release
    end

WholeGame_Text_RivalName::
    .string "What is the name of PROF. OAK's\\n"
    .string "grandson, your rival in KANTO?$"
WholeGame_Text_NotReady::
    .string "I guide trainers between regions.\\n"
    .string "Visit PROF. BIRCH for your POKEDEX.$"
WholeGame_Text_ToKanto::
    .string "Travel to PALLET TOWN in KANTO?\\n"
    .string "Your POKEMON travel with you.\\p"
    .string "PROF. OAK studies POKEMON there.\\n"
    .string "I can bring you back anytime.$"
WholeGame_Text_ToHoenn::
    .string "Return to LITTLEROOT in HOENN?\\n"
    .string "Your progress here will remain.$"
WholeGame_Text_MakeRoomForOakGift::
    .string "Please leave a space in your party\\n"
    .string "for the POKEMON from PROF. OAK.\\p"
    .string "You can use a POKEMON CENTER PC\\n"
    .string "in either region.$"
'''


def adapt_oak_starter(text: str) -> str:
    """Keep source choice/rival scenes, remove single-empty-party assumptions."""
    anchor = 'FR_PalletTown_ProfessorOaksLab_EventScript_ChoseStarter::\n'
    if text.count(anchor) != 1:
        raise ValueError('missing unique imported Oak gift entry')
    # Before any removeobject/flag/story mutation. FR_TEMP_5 is unused by original lab.
    guard = '''    getpartysize
    goto_if_ge VAR_RESULT, PARTY_SIZE, WholeGame_EventScript_OakGiftPartyFull
    FR_copyvar FR_VAR_TEMP_5, FR_VAR_RESULT
'''
    text = text.replace(anchor, anchor + guard)
    anchor = 'FR_EventScript_GiveNicknameToStarter::\n\tFR_setvar FR_VAR_0x8004, 0'
    if text.count(anchor) != 1:
        raise ValueError('missing unique donor nickname party[0] assumption')
    text = text.replace(anchor, 'FR_EventScript_GiveNicknameToStarter::\n\tFR_copyvar FR_VAR_0x8004, FR_VAR_TEMP_5')
    return text + '''
WholeGame_EventScript_OakGiftPartyFull::
    hidemonpic
    msgbox WholeGame_Text_MakeRoomForOakGift, MSGBOX_DEFAULT
    releaseall
    end
'''



def rival_naming_sources(out: Path) -> dict[str, str]:
    """Dedicated native name entry, preserving trainer ID and blocking empty names.

    Emerald PLAYER naming has trainer ID side effects, so it is never reused.
    Rival icon uses the original imported Blue overworld graphic and engine API.
    """
    header = (out / 'include/naming_screen.h').read_text()
    header = header.replace('    NAMING_SCREEN_WALDA,', '    NAMING_SCREEN_WALDA,\n    NAMING_SCREEN_WHOLE_GAME_RIVAL,')
    naming = (out / 'src/naming_screen.c').read_text()
    replacements = [
        ('#include "global.h"', '#include "global.h"\n#include "constants/firered_event_objects.h"'),
        ('static void NamingScreen_CreateWaldaDadIcon(void);',
         'static void NamingScreen_CreateWaldaDadIcon(void);\nstatic void WholeGame_CreateRivalIcon(void);'),
        ('    NamingScreen_CreateWaldaDadIcon,',
         '    NamingScreen_CreateWaldaDadIcon,\n    WholeGame_CreateRivalIcon,'),
        ('    [NAMING_SCREEN_WALDA]      = DrawNormalTextEntryBox,',
         '    [NAMING_SCREEN_WALDA]      = DrawNormalTextEntryBox,\n    [NAMING_SCREEN_WHOLE_GAME_RIVAL] = DrawNormalTextEntryBox,'),
        ('static const struct NamingScreenTemplate *const sNamingScreenTemplates[] =\n{',
         'static const u8 sWholeGame_RivalsName[] = _("RIVAL\'s NAME?");\n'
         'static const struct NamingScreenTemplate sWholeGame_RivalNamingTemplate =\n{\n'
         '    .copyExistingString = FALSE,\n    .maxChars = PLAYER_NAME_LENGTH,\n'
         '    .iconFunction = 5,\n    .addGenderIcon = FALSE,\n'
         '    .initialPage = KBPAGE_LETTERS_UPPER,\n    .title = sWholeGame_RivalsName,\n};\n'
         'static const struct NamingScreenTemplate *const sNamingScreenTemplates[] =\n{'),
        ('    [NAMING_SCREEN_WALDA]      = &sWaldaWordsScreenTemplate,',
         '    [NAMING_SCREEN_WALDA]      = &sWaldaWordsScreenTemplate,\n'
         '    [NAMING_SCREEN_WHOLE_GAME_RIVAL] = &sWholeGame_RivalNamingTemplate,')]
    for old, new in replacements:
        if naming.count(old) != 1:
            raise ValueError(f'native naming source drift: {old}')
        naming = naming.replace(old, new)
    naming += """
// Source adaptation: original imported Blue sprite, native naming-screen slot.
static void WholeGame_CreateRivalIcon(void)
{
    u8 spriteId = CreateObjectGraphicsSprite(OBJ_EVENT_GFX_FR_BLUE, SpriteCallbackDummy, 56, 37, 0);
    gSprites[spriteId].oam.priority = 3;
    StartSpriteAnim(&gSprites[spriteId], ANIM_STD_GO_SOUTH);
}
"""
    if 'NAMING_SCREEN_WHOLE_GAME_RIVAL' not in header:
        raise ValueError('native naming enum patch failed')
    helper = """#include "global.h"
#include "naming_screen.h"
#include "overworld.h"
#include "pokemon_storage_system.h"
#include "constants/characters.h"

static void WholeGame_RivalNameDone(void);
void WholeGame_NameKantoRival(void)
{
    DoNamingScreen(NAMING_SCREEN_WHOLE_GAME_RIVAL,
        gPokemonStoragePtr->wholeGameKanto.rivalName, 0, 0, 0, WholeGame_RivalNameDone);
}
static void WholeGame_RivalNameDone(void)
{
    // The native keyboard leaves destination unchanged for blank/all-space OK.
    // Do not let an unnamed rival or allocation failure advance the campaign.
    if (gPokemonStoragePtr->wholeGameKanto.rivalName[0] == EOS)
        WholeGame_NameKantoRival();
    else
        CB2_ReturnToFieldContinueScriptPlayMapMusic();
}
"""
    return {'include/naming_screen.h': header, 'src/naming_screen.c': naming,
            'src/whole_game_rival_naming.c': helper}

def stage_campaign(base, donor, output, report_dir=None):
    base, donor, out = (Path(path).resolve() for path in (base, donor, output))
    for canonical in (base, donor):
        if out == canonical or canonical in out.parents or out in canonical.parents:
            raise ValueError('campaign output must be isolated from immutable sources')
    state = initial_world_state(donor)
    include = '\t.include "data/scripts/whole_game_campaign.inc"\n'
    if include in (out / 'data/event_scripts.s').read_text():
        raise ValueError('campaign transform already applied')
    changed = []
    def write(relative, content):
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        changed.append(relative)
    if not (out / 'include/constants/whole_game_fr_state.h').is_file():
        raise ValueError('campaign requires state namespace stage')
    storage = (out / 'include/pokemon_storage_system.h').read_text()
    if 'campaignInitialized' not in storage or 'rivalName' not in storage:
        raise ValueError('campaign requires durable first-arrival marker/rival name')
    lab = 'data/maps/FRPalletTown_ProfessorOaksLab/scripts.inc'
    adapted = adapt_oak_starter((out / lab).read_text())
    # Never synthesize an alternate intro or touch donor scene vars on return.
    write(lab, adapted)
    write('include/whole_game_campaign.h', '''#ifndef GUARD_WHOLE_GAME_CAMPAIGN_H
#define GUARD_WHOLE_GAME_CAMPAIGN_H
#include "global.h"
const u8 *WholeGame_GetRivalName(void);
bool8 WholeGame_InitializeKanto(void);
#endif
''')
    write('src/whole_game_campaign.c', _init_source(state))
    for relative, content in rival_naming_sources(out).items():
        write(relative, content)
    write('data/scripts/whole_game_campaign.inc', TRAVEL)
    entry = 'data/event_scripts.s'
    root = (out / entry).read_text()
    include = '\t.include "data/scripts/whole_game_campaign.inc"\n'
    if include in root:
        raise ValueError('campaign transform already applied')
    write(entry, root + '\n' + include)
    for name, x, y, script in [('LittlerootTown', 9, 15, 'HoennGuide'), ('FRPalletTown', 8, 13, 'KantoGuide')]:
        relative = f'data/maps/{name}/map.json'
        data = json.loads((out / relative).read_text())
        if len(data['object_events']) >= 16:
            raise ValueError(f'{name}: native object capacity exceeded')
        local_id = 'LOCALID_WHOLE_GAME_' + script.upper()
        if any(obj.get('local_id') == local_id for obj in data['object_events']):
            raise ValueError('duplicate travel NPC local ID')
        data['object_events'].append({'local_id': str(local_id), 'graphics_id': 'OBJ_EVENT_GFX_SAILOR',
            'x': x, 'y': y, 'elevation': 3, 'movement_type': 'MOVEMENT_TYPE_FACE_UP',
            'movement_range_x': 0, 'movement_range_y': 0, 'trainer_type': 'TRAINER_TYPE_NONE',
            'trainer_sight_or_berry_tree_id': '0', 'script': f'WholeGame_EventScript_{script}', 'flag': '0'})
        write(relative, json.dumps(data, indent=2) + '\n')
    report = {'component': 'campaign', 'status': 'partial', 'buildEligible': False,
        'semantic_coverage_complete': False, 'changed_files': sorted(changed),
        'initialization': state, 'marker': hex(MARKER),
        'native_state_preserved': ['trainer name/id/gender/options', 'money/playtime/game stats',
            'party/enemy-party ownership and PC', 'bag/registered item/mail/PC items',
            'shared Pokedex seen/owned/National status', 'Emerald campaign flags/vars'],
        'source_init_audit': {'InitEventData': 'state stage zeros donor bank at unified new game; no repeat zero on travel',
            'ResetAllMapFlags': 'every source instruction extracted, unknown additions fail closed',
            'SetAllRenewableItemFlags': 'all source HIDDEN_ID flags extracted, no item sampling or free items',
            'EnableNationalPokedex_RSE': 'donor-only compatibility var/flag set; documented unused Pokedex byte excluded',
            'ResetTrainerFanClub': 'two zero-initialized donor vars retain original fresh values',
            'ResetPokemonStorageSystem_ClearSav1_ClearBag_ZeroPlayerPartyMons': 'never invoked at interregion entry',
            'WarpToPlayersRoom': 'adapted native guide destination Pallet; original Oak Route1 scene preserved',
            'ResetFameChecker': 'exact donor provider FR_ResetFameChecker called once before firstarrival marker',
            'ResetTrainerTowerResults': 'exact donor provider FR_ResetTrainerTowerState called once with current save encryption key',
            'ClearRoamerData': 'donor native state extension initialized by world_services; runtime ownership remains there'},
        'policy': {'start': 'Original Emerald intro/Birch starter/Route103 rival/Pokedex; guide then opens Kanto.',
            'middle': 'Native Littleroot-Pallet NPC warps. Original Pallet Route1 Oak trigger, chosen gift, rival, parcel, Kanto badges/Team Rocket/Sevii. Existing party/PC/bag shared; regional flags/vars distinct.',
            'ending': 'Each regional league sets its own story completion; either ending leaves other campaign progress intact and return guide available.',
            'gift': 'Oak demands party slot before mutations; givemon appends; nickname targets appended slot; donor starter choice drives original rival roster.'},
        'source_pins': {relative: hashlib.sha256((donor / relative).read_bytes()).hexdigest() for relative in ['src/new_game.c', 'data/event_scripts.s', 'src/renewable_hidden_items.c', 'data/maps/PalletTown_ProfessorOaksLab/scripts.inc']},
        'unresolved': ['Native walkthrough: both intros, Oak gift/nickname full/partial party, rival win/loss and regional story/league endings unrun.',
            'Native collision/accessibility of added guide positions requires rendered map qualification.',
            'First-arrival Fame Checker/Tower providers are source implemented; quest log/roamer/renewal lifecycle ownership and cartridge qualification remain independently gated; no blanket donor NewGameInitData call is permitted.',
            'First-rival tutorial/loss continuation must retain native battle compatibility with an existing shared party.',
            'Dedicated rival naming native UI, source callback return, and naming-before-travel resume require native qualification.',
            'Cartridge save/reload/reset during either campaign and interregion blackout/escape/fly/heal destination semantics require qualification.']}
    if report_dir:
        path = Path(report_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / 'campaign-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
