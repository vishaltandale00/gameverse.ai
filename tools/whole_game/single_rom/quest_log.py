"""Stage the original FireRed recording/playback subsystem for one Emerald engine.

This ports source and typed state bindings; every missing engine lifecycle or
external provider remains an explicit qualification blocker. It never replaces
recording/playback with a constant, a stub, or a second game engine.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

from .native_services import functions, masked, TOKEN, index_sources
from .scripts import rewrite_tokens

UNITS = ('quest_log', 'quest_log_events', 'quest_log_objects', 'quest_log_player', 'quest_log_battle', 'trainer_fan_club')
HISTORY_BYTES = 6560
REQUIRED = ('QuestLog_RecordEnteredMap', 'QuestLog_CutRecording', 'QuestLogEvents_HandleEndTrainerBattle',
            'QL_FinishRecordingScene', 'ResetDeferredLinkEvent', 'QuestLog_StartRecordingInputsAfterDeferredEvent')


def _struct(text: str, name: str) -> str:
    match = re.search(r'(?m)^struct ' + re.escape(name) + r'\s*\{', text)
    if not match:
        raise ValueError('missing donor structure ' + name)
    depth, end = 1, match.end()
    while end < len(text) and depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[match.start():text.index(';', end) + 1]


def _replace_function(text, name, transform):
    function = next((f for f in functions(text, '') if f.name == name), None)
    if function is None:
        raise ValueError('QuestLog lifecycle target missing: ' + name)
    return text[:function.start] + transform(function.source) + text[function.end:]


def _lifecycle(donor, output, mapping, write):
    """Run original field callbacks in the shared engine; preserve Hoenn paths."""
    patched = []
    path = output / 'src/overworld.c'
    if path.exists():
        text = path.read_text()
        original = (donor / 'src/overworld.c').read_text()
        donor_camera = (donor / 'src/field_camera.c').read_text()
        host_camera = (output / 'src/field_camera.c').read_text() if (output / 'src/field_camera.c').exists() else None
        if host_camera:
            renames = {'move_tilemap_camera_to_upper_left_corner': 'ResetFieldCamera', 'move_tilemap_camera_to_upper_left_corner_': 'ResetCameraOffset'}
            for donor_name, host_name in renames.items():
                a = next(f.source for f in functions(donor_camera, '') if f.name == donor_name)
                b = next(f.source for f in functions(host_camera, '') if f.name == host_name)
                normalize = lambda value: re.sub(r'\s+', '', masked(value))
                if normalize(rewrite_tokens(a, renames)) != normalize(b):
                    raise ValueError('QuestLog shared camera reset source equivalence changed')
        selected = ('DoCB1_Overworld_QuestLogPlayback', 'QL_LoadMapNormal',
                    'CB2_SetUpOverworldForQLPlaybackWithWarpExit', 'CB2_SetUpOverworldForQLPlayback',
                    'CB2_LoadMapForQLPlayback', 'DoLoadMap_QLPlayback', 'LoadMap_QLPlayback',
                    'CB2_EnterFieldFromQuestLog', 'ReloadObjectsAndRunReturnToFieldMapScript',
                    'Overworld_ResetStateOnContinue', 'Overworld_SetWarpDestinationFromWarp')
        extra = dict(mapping)
        extra.update({name: 'FR_' + name for name in selected})
        extra.update({'gExitStairsMovementDisabled': 'FR_gExitStairsMovementDisabled',
                      'DismissMapNamePopup': 'HideMapNamePopUpWindow',
                      'FieldInput_HandleCancelSignpost': 'FR_FieldInput_HandleCancelSignpost',
                      'UpdateLocationHistoryForRoamer': 'FR_UpdateLocationHistoryForRoamer',
                      'RoamerMoveToOtherLocationSet': 'FR_RoamerMoveToOtherLocationSet',
                      'move_tilemap_camera_to_upper_left_corner': 'ResetFieldCamera'})
        for token in set(TOKEN.findall(masked('\n'.join(f.source for f in functions(original, '') if f.name in selected)))):
            if token.startswith(('VAR_', 'FLAG_')):
                extra.setdefault(token, 'FR_' + token)
        bodies = [rewrite_tokens(next(f.source for f in functions(original, '') if f.name == name), extra) for name in selected]
        declarations = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
        text = ('#include "whole_game_fr_quest_log.h"\n#include "whole_game_world_services.h"\n'
                '#include "constants/firered_quest_log_map_ids.h"\n'
                'void FR_FieldInput_HandleCancelSignpost(struct FieldInput *);\n' + declarations + '\n' + text)
        def record(body):
            body = body.replace('    struct FieldInput inputStruct;', '    struct FieldInput inputStruct;\n    struct FieldInput questLogInput;')
            body = body.replace('    UpdatePlayerAvatarTransitionState();', '    if (WholeGame_IsKanto()) FR_QL_TryRunActions();\n    UpdatePlayerAvatarTransitionState();', 1)
            body = body.replace('    FieldGetPlayerInput(&inputStruct, newKeys, heldKeys);', '    FieldGetPlayerInput(&inputStruct, newKeys, heldKeys);\n    questLogInput = inputStruct;')
            body = body.replace('            LockPlayerFieldControls();', '            if (WholeGame_IsKanto() && FR_gQuestLogPlaybackState == FR_QL_PLAYBACK_STATE_RECORDING)\n                FR_QL_RecordFieldInput(&questLogInput);\n            LockPlayerFieldControls();', 1)
            return body[:-1] + '    if (WholeGame_IsKanto()) FR_RunQuestLogCB();\n}'
        text = _replace_function(text, 'DoCB1_Overworld', record)
        def route(body):
            return body.replace('        DoCB1_Overworld(gMain.newKeys, gMain.heldKeys);', '''        {
            if (WholeGame_IsKanto() && (FR_QL_GetPlaybackState() == FR_QL_PLAYBACK_STATE_RUNNING || FR_gQuestLogState == FR_QL_STATE_PLAYBACK))
                FR_DoCB1_Overworld_QuestLogPlayback();
            else
                DoCB1_Overworld(gMain.newKeys, gMain.heldKeys);
        }''')
        text = _replace_function(text, 'CB1_Overworld', route)
        text = _replace_function(text, 'OverworldBasic', lambda body: body.replace('    CameraUpdate();', '    CameraUpdate();\n    if (WholeGame_IsKanto()) FR_SetQuestLogEvent_Arrived();', 1))
        text = _replace_function(text, 'CB2_LoadMap2', lambda body: body.replace('    SetFieldVBlankCallback();', '    if (WholeGame_IsKanto() && FR_QuestLog_ShouldEndSceneOnMapChange())\n    {\n        FR_QuestLog_AdvancePlayhead_();\n        return;\n    }\n    SetFieldVBlankCallback();', 1))
        text += '\n// ORIGINAL FIRERED QUESTLOG OVERWORLD LIFECYCLE\n' + '\n\n'.join(bodies) + '\n'
        write('src/overworld.c', text)
        patched.append('src/overworld.c')
    path = output / 'src/main_menu.c'
    if path.exists():
        text = path.read_text()
        before = '                SetMainCallback2(CB2_ContinueSavedGame);\n                DestroyTask(taskId);'
        after = '''                if (WholeGame_IsKanto())
                    FR_TryStartQuestLogPlayback(taskId);
                else
                {
                    SetMainCallback2(CB2_ContinueSavedGame);
                    DestroyTask(taskId);
                }'''
        if before not in text:
            raise ValueError('QuestLog native continue entry not found')
        write('src/main_menu.c', '#include "whole_game_fr_quest_log.h"\n' + text.replace(before, after, 1))
        patched.append('src/main_menu.c')
    path = output / 'src/event_object_movement.c'
    if path.exists():
        text = path.read_text()
        original = (donor / 'src/event_object_movement.c').read_text()
        names = ('QL_UpdateObjectEventCurrentMovement', 'QuestLogObjectEventExecHeldMovementAction')
        extra = dict(mapping)
        extra.update({name: 'FR_' + name for name in names})
        extra.update({'HandleBoulderFallThroughHole': 'WGFR_HandleBoulderFallThroughHole',
                      'OBJ_EVENT_GFX_PUSHABLE_BOULDER': 'OBJ_EVENT_GFX_FR_PUSHABLE_BOULDER',
                      'sMovementActionFuncs': 'gMovementActionFuncs'})
        bodies = [rewrite_tokens(next(f.source for f in functions(original, '') if f.name == name), extra) for name in names]
        text = ('#include "whole_game_fr_quest_log.h"\n#include "constants/whole_game_fr_movement.h"\n#include "constants/firered_event_objects.h"\n#include "script.h"\n' +
                '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies) + '\n' + text)
        text = _replace_function(text, 'CopyObjectGraphicsInfoToSpriteTemplate', lambda body: body.replace('    spriteTemplate->callback = callback;', '''    if (WholeGame_IsKanto() && !ScriptContext_IsEnabled() && FR_QL_GetPlaybackState() == FR_QL_PLAYBACK_STATE_RUNNING)
        spriteTemplate->callback = FR_QL_UpdateObject;
    else
        spriteTemplate->callback = callback;'''))
        text = _replace_function(text, 'ObjectEventSetSingleMovement', lambda body: body[:-1] + '''    if (WholeGame_IsKanto() && FR_gQuestLogPlaybackState == FR_QL_PLAYBACK_STATE_RECORDING)
        FR_QuestLogRecordNPCStep(objectEvent->localId, objectEvent->mapNum, objectEvent->mapGroup, animId);
}''')
        text = _replace_function(text, 'ObjectEventSetHeldMovement', lambda body: body.replace('    if (ObjectEventIsMovementOverridden(objectEvent))', '    if (WholeGame_IsKanto() && FR_QL_GetPlaybackState() == FR_QL_PLAYBACK_STATE_RUNNING)\n        ObjectEventClearHeldMovementIfActive(objectEvent);\n    else if (ObjectEventIsMovementOverridden(objectEvent))', 1))
        text += '\n// Original donor questlog movement playback\n' + '\n\n'.join(bodies) + '\n'
        write('src/event_object_movement.c', text)
        patched.append('src/event_object_movement.c')
    path = output / 'src/field_player_avatar.c'
    if path.exists():
        text = '#include "whole_game_fr_quest_log.h"\n' + path.read_text()
        text = _replace_function(text, 'PlayerSetAnimId', lambda body: body.replace('        ObjectEventSetHeldMovement(&gObjectEvents[gPlayerAvatar.objectEventId], movementActionId);', '        if (!ObjectEventSetHeldMovement(&gObjectEvents[gPlayerAvatar.objectEventId], movementActionId) && WholeGame_IsKanto())\n            FR_QuestLogRecordPlayerStep(movementActionId);'))
        for name, state in (('PlayerAvatarTransition_Normal', 'NORMAL'), ('PlayerAvatarTransition_MachBike', 'BIKE'), ('PlayerAvatarTransition_Surfing', 'SURF')):
            text = _replace_function(text, name, lambda body, state=state: body.replace('{', '{\n    if (WholeGame_IsKanto()) FR_QuestLogTryRecordPlayerAvatarGfxTransition(FR_QL_PLAYER_GFX_' + state + ');\n    {', 1)[:-1] + '    }\n}')
        text = _replace_function(text, 'StartFishing', lambda body: body[:-1] + '''    if (WholeGame_IsKanto() && FR_QuestLogTryRecordPlayerAvatarGfxTransition(FR_QL_PLAYER_GFX_FISH))
        FR_QL_AfterRecordFishActionSuccessful();
}''')
        write('src/field_player_avatar.c', text)
        patched.append('src/field_player_avatar.c')
    path = output / 'src/battle_script_commands.c'
    if path.exists():
        text = '#include "whole_game_fr_quest_log.h"\n' + path.read_text()
        marker = 'gBattleResults.lastOpponentSpecies = GetMonData(&gEnemyParty[gBattlerPartyIndexes[gActiveBattler]], MON_DATA_SPECIES, NULL);'
        if marker not in text:
            raise ValueError('QuestLog battle victor observation point missing')
        text = text.replace(marker, marker + '\n                if (WholeGame_IsKanto()) FR_gQuestLogLastAttackerToFaintOpponent = gBattlerAttacker;', 1)
        write('src/battle_script_commands.c', text)
        patched.append('src/battle_script_commands.c')
    return patched


def _support(donor, output, mapping, write):
    """Original source helpers consumed by the recording/playback lifecycle."""
    units = {
        'event_data': ('ResetSpecialVars',),
        'item': ('ClearPCItemSlots', 'SetPcItemQuantity'),
        'palette': ('CopyPaletteInvertedTint',),
        'blend_palette': ('BlendPalettesAt',),
        'field_weather': ('SlightlyDarkenPalsInWeather',),
        'event_object_lock': ('ClearPlayerHeldMovementAndUnfreezeObjectEvents',),
        'field_player_avatar': ('AlignFishingAnimationFrames', 'CreateStopSurfingTask_NoMusicChange',
            'Task_StopSurfingInit', 'Task_WaitStopSurfing', 'QL_TryRecordPlayerStepWithDuration0',
            'HandleEnforcedLookDirectionOnPlayerStopMoving', 'PlayerForceSetHeldMovement'),
    }
    bodies, evidence = [], []
    extra = dict(mapping)
    for unit, names in units.items():
        original = (donor / f'src/{unit}.c').read_text()
        parsed = functions(original, f'src/{unit}.c')
        for name in names:
            body = next(f.source for f in parsed if f.name == name)
            bodies.append(body)
            extra[name] = 'FR_' + name
            evidence.append({'name': name, 'source': f'src/{unit}.c',
                             'sha256': hashlib.sha256(body.encode()).hexdigest()})
    extra.update({'gSpecialVar_0x8014': 'gSpecialVar_Unused_0x8014',
                  'PLAYER_AVATAR_GFX_NORMAL': 'PLAYER_AVATAR_STATE_NORMAL',
                  'BOB_MON_ONLY': 'BOB_JUST_MON', 'SetHelpContextForMap': 'FR_SetHelpContextForMap',
                  'GetJumpSpecialWithEffectMovementAction': 'FR_GetJumpSpecialWithEffectMovementAction'})
    declarations = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
    headers = ('global.h', 'event_data.h', 'item.h', 'item_menu.h', 'palette.h', 'field_weather.h',
        'constants/weather.h', 'constants/rgb.h', 'field_player_avatar.h', 'field_effect_helpers.h',
        'script.h', 'script_movement.h', 'event_object_movement.h', 'constants/event_objects.h', 'task.h', 'sprite.h', 'bike.h',
        'whole_game_fr_quest_log.h', 'whole_game_fr_help_system.h')
    preamble = '\n'.join('#include "' + name + '"' for name in headers) + '\nu8 FR_GetJumpSpecialWithEffectMovementAction(u32);\n'
    write('src/firered_quest_log/support.c', preamble + rewrite_tokens(declarations + '\n\n' + '\n\n'.join(bodies), extra) + '\n')
    return evidence


def _input_lifecycle(donor, output, mapping, write):
    """Run original message input/playback state in the native interpreter."""
    selected = {
        'script': ('SetQuestLogInputIsDpadFlag', 'ClearQuestLogInputIsDpadFlag', 'IsQuestLogInputDpad',
            'RegisterQuestLogInput', 'ClearQuestLogInput', 'GetRegisteredQuestLogInput',
            'DisableMsgBoxWalkaway', 'EnableMsgBoxWalkaway', 'IsMsgBoxWalkawayDisabled',
            'SetWalkingIntoSignVars', 'ClearMsgBoxCancelableState', 'CanWalkAwayToCancelMsgBox'),
        'field_control_avatar': ('QuestLogOverrideJoyVars', 'FieldInput_HandleCancelSignpost',
            'Task_QuestLogPlayback_OpenStartMenu'),
        'scrcmd': ('WaitForAorBPress', 'ScriptContext_NextCommandEndsScript',
            'ScriptContext_GetQuestLogInput', 'ScrCmd_waitbuttonpress'),
    }
    extra = dict(mapping)
    names = [name for group in selected.values() for name in group]
    extra.update({name: 'FR_' + name for name in names})
    state_names = ('sQuestLogInputIsDpad', 'sQuestLogInput', 'sMsgBoxWalkawayDisabled',
                   'sMsgBoxIsCancelable', 'gWalkAwayFromSignInhibitTimer',
                   'sQuestLogScriptContextPtr', 'sQuestLogWaitButtonPressTimer')
    extra.update({name: 'FR_' + name for name in state_names})
    extra.update({'EventScript_CancelMessageBox': 'FR_EventScript_CancelMessageBox',
                  'SE_WIN_OPEN': 'FR_SE_WIN_OPEN'})
    bodies = []
    for unit, group in selected.items():
        parsed = functions((donor / f'src/{unit}.c').read_text(), '')
        for name in group:
            body = next(f.source for f in parsed if f.name == name)
            if name == 'QuestLogOverrideJoyVars':
                body = body.removeprefix('static ')
            bodies.append(body)
    prototypes = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
    state = '\n'.join('static EWRAM_DATA u8 ' + name + ' = 0;' for name in state_names if name != 'sQuestLogScriptContextPtr')
    state += '\nstatic EWRAM_DATA struct ScriptContext *sQuestLogScriptContextPtr = NULL;\n'
    headers = ('global.h', 'script.h', 'event_data.h', 'main.h', 'field_control_avatar.h',
               'field_player_avatar.h', 'task.h', 'start_menu.h', 'sound.h', 'constants/songs.h',
               'whole_game_fr_quest_log.h')
    text = '\n'.join('#include "' + header + '"' for header in headers)
    text += '\nextern const u8 FR_EventScript_CancelMessageBox[];\n'
    write('src/firered_quest_log/input.c', text + rewrite_tokens('\n' + state + prototypes + '\n\n' + '\n\n'.join(bodies), extra))
    declarations = rewrite_tokens('\n'.join(body[:body.index('{')].strip() + ';' for body in bodies if not body.startswith('static ')), extra)
    header = output / 'include/whole_game_fr_quest_log.h'
    write(header.relative_to(output).as_posix(), header.read_text() + '\n' + declarations + '\n')
    changes = []
    path = output / 'src/script.c'
    if path.exists():
        text = path.read_text()
        text = _replace_function(text, 'ScriptContext_SetupScript', lambda body: body.replace('{', '{\n    if (WholeGame_IsKanto())\n    {\n        FR_ClearMsgBoxCancelableState();\n        FR_EnableMsgBoxWalkaway();\n        FR_ClearQuestLogInputIsDpadFlag();\n    }', 1))
        write('src/script.c', '#include "whole_game_fr_quest_log.h"\n' + text)
        changes.append('src/script.c')
    path = output / 'src/scrcmd.c'
    if path.exists():
        text = _replace_function(path.read_text(), 'ScrCmd_waitbuttonpress', lambda body: body.replace('{', '{\n    if (WholeGame_IsKanto())\n        return FR_ScrCmd_waitbuttonpress(ctx);', 1))
        write('src/scrcmd.c', '#include "whole_game_fr_quest_log.h"\n' + text)
        changes.append('src/scrcmd.c')
    path = output / 'src/field_control_avatar.c'
    if path.exists():
        text = path.read_text()
        marker = '    if ((tileTransitionState == T_TILE_CENTER'
        text = _replace_function(text, 'FieldGetPlayerInput', lambda body: body.replace(marker,
            '    if (WholeGame_IsKanto() && !ScriptContext_IsEnabled() && FR_IsQuestLogInputDpad())\n        FR_QuestLogOverrideJoyVars(input, &newKeys, &heldKeys);\n\n' + marker, 1))
        write('src/field_control_avatar.c', '#include "whole_game_fr_quest_log.h"\n' + text)
        changes.append('src/field_control_avatar.c')
    return changes


def stage_quest_log(emerald_source: Path, firered_source: Path, output_tree: Path,
                    report_dir: Path | None = None, *, symbol_map: dict[str, str] | None = None) -> dict:
    started = time.monotonic()
    base, donor, output = (Path(p).resolve() for p in (emerald_source, firered_source, output_tree))
    if any(output == source or output.is_relative_to(source) for source in (donor, base)):
        raise ValueError('output must be outside canonical source trees')
    source = {name: (donor / f'src/{name}.c').read_text() for name in UNITS}
    header_source = {name: (donor / f'include/{name}.h').read_text() for name in UNITS if (donor / f'include/{name}.h').exists()}
    all_functions = [function for name, text in source.items() for function in functions(text, f'src/{name}.c')]
    mapping = {function.name: 'FR_' + function.name for function in all_functions}
    combined = '\n'.join(source.values()) + '\n' + '\n'.join(header_source.values())
    # Each original subsystem public global has one real source definition.
    for name in set(TOKEN.findall(masked(combined))):
        if name.startswith('gQuestLog'):
            mapping[name] = 'FR_' + name
        elif name.startswith(('QL_', 'QUEST_LOG_', 'QuestLog')):
            mapping.setdefault(name, 'FR_' + name)
        elif name.startswith(('VAR_', 'FLAG_', 'MAPSEC_', 'TRAINER_CLASS_', 'FIELD_MOVE_')):
            mapping[name] = 'FR_' + name
    mapping.update({name: value for name, value in (symbol_map or {}).items()
                    if name.startswith(('MAP_', 'ITEM_', 'TRAINER_', 'MUS_', 'SE_'))
                    and name not in ('MAP_GROUP', 'MAP_NUM')})
    for name in set(TOKEN.findall(masked(combined))):
        if name.startswith('MAP_') and name not in ('MAP_GROUP', 'MAP_NUM', 'MAP_UNDEFINED', 'MAP_OFFSET'):
            mapping.setdefault(name, 'MAP_FR_' + name[4:])
        elif name.startswith('ITEM_'):
            mapping.setdefault(name, 'FR_' + name)
    for name in ('QuestLogObjectEventTemplate', 'QuestLogObjectEvent', 'QuestLogScene'):
        mapping[name] = 'FR_' + name
    constants = (donor / 'include/constants/quest_log.h').read_text()
    for name in re.findall(r'(?m)^#define\s+(\w+)', constants):
        mapping[name] = 'FR_' + name
    # Real original text resources retain their source names under FR namespace.
    text_source = (donor / 'src/data/text/quest_log.h').read_text()
    text_names = set(re.findall(r'(?m)^const u8 (\w+)\[\]', text_source))
    mapping.update({name: 'FR_' + name for name in text_names})
    shared_bindings = {
        'gSaveBlock1Ptr->questLog': 'gFRQuestLogScenes',
        'gSaveBlock1Ptr->flags': 'gPokemonStoragePtr->wholeGameKanto.flags',
        'gSaveBlock1Ptr->vars': 'gPokemonStoragePtr->wholeGameKanto.vars',
        'gSaveBlock1Ptr->rivalName': 'gPokemonStoragePtr->wholeGameKanto.rivalName',
        'gSaveBlock2Ptr->linkBattleRecords': 'gSaveBlock1Ptr->linkBattleRecords',
        'gBattleStruct->multiplayerId': 'gBattleScripting.multiplayerId',
        'gBattleStruct->lastAttackerToFaintOpponent': 'FR_gQuestLogLastAttackerToFaintOpponent',
        'gSaveBlock1Ptr->trainerRematches': '(*FR_QuestLog_GetTrainerRematchArray())',
        '.rangeX': '.range.rangeX', '.rangeY': '.range.rangeY',
        '.objUnion.normal.': '.',
    }
    mapping.update({'ItemId_GetPocket': 'GetItemPocket', 'ItemId_GetName': 'GetItemName',
                    'POCKET_TM_CASE': 'POCKET_TM_HM', 'POCKET_BERRY_POUCH': 'POCKET_BERRIES',
                    'LoadStdWindowFrameGfx': 'FR_LoadStdWindowFrameGfx', 'LoadQuestLogWindowTiles': 'FR_LoadQuestLogWindowTiles',
                    'ShowMapNamePopup': 'FR_ShowMapNamePopup', 'GetMapNameGeneric': 'FR_GetMapNameGeneric',
                    'DrawDialogueFrame': 'FR_DrawDialogueFrame', 'AddTextPrinterParameterized2': 'FR_AddTextPrinterParameterized2',
                    'FLDEFF_USE_VS_SEEKER': 'FR_FLDEFF_USE_VS_SEEKER'})
    donor_sources, donor_index = index_sources(donor)
    _, base_index = index_sources(base)
    external_functions = {}
    called = set(TOKEN.findall(masked(combined)))
    for name in sorted(called):
        definitions = [f for f in donor_index.get(name, []) if not f.static]
        host = [f for f in base_index.get(name, []) if not f.static]
        if len(definitions) == 1 and name not in {f.name for f in all_functions}:
            target = mapping.get(name, name)
            mapped_host = [f for f in base_index.get(target, []) if not f.static]
            if not mapped_host:
                mapping.setdefault(name, 'FR_' + name)
                external_functions[name] = definitions[0]
    changed = []
    def write(relative, text):
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        changed.append(relative)
    global_source = (donor / 'include/global.h').read_text()
    structures = '\n\n'.join(_struct(global_source, name) for name in
                               ('QuestLogObjectEventTemplate', 'QuestLogObjectEvent', 'QuestLogScene'))
    structures = structures.replace('[NUM_FLAG_BYTES]', '[0x900 / 8]').replace('[VARS_COUNT]', '[0x100]')
    structures = rewrite_tokens(structures, mapping)
    # agbcc/GCC APCS use a four-byte structure size boundary. Explicitly retain
    # the original20-byte object records on modern compilers too.
    structures = structures.replace('struct FR_QuestLogObjectEvent\n', 'struct __attribute__((aligned(4))) FR_QuestLogObjectEvent\n')
    storage_header = '''#ifndef GUARD_WHOLE_GAME_FR_QUEST_LOG_H
#define GUARD_WHOLE_GAME_FR_QUEST_LOG_H
#include "global.h"
#include "field_control_avatar.h"
#include "script.h"
#include "battle.h"
#include "constants/whole_game_fr_state.h"
#include "constants/whole_game_fr_encounters.h"
#include "whole_game_state.h"
#include "constants/firered_quest_log.h"
#define FR_QUEST_LOG_SCENE_COUNT 4
''' + structures + '''
extern struct FR_QuestLogScene gFRQuestLogScenes[FR_QUEST_LOG_SCENE_COUNT];
void FR_QuestLog_CaptureSceneAliases(struct FR_QuestLogScene *scene);
void FR_QuestLog_RestoreSceneAliases(const struct FR_QuestLogScene *scene);
void FR_QuestLog_BackUpSharedAliases(void);
void FR_QuestLog_RestoreSharedAliases(void);
void *FR_QuestLog_GetHistoryBuffer(void);
u32 FR_QuestLog_GetHistorySize(void);
u8 (*FR_QuestLog_GetTrainerRematchArray(void))[100];
'''
    # Donor headers contain the exact action/event records and all public APIs.
    for name, header in header_source.items():
        header = re.sub(r'(?m)^#include[^\n]*\n', '', header)
        header = rewrite_tokens(header, mapping)
        header = header.replace('void FR_QL_LoadObjects(struct FR_QuestLogScene *, struct ObjectEventTemplate *);', 'void FR_QL_LoadObjects(const struct FR_QuestLogScene *, const struct ObjectEventTemplate *);')
        storage_header += '\n' + header + '\n'
    for name, function in external_functions.items():
        storage_header += rewrite_tokens(function.source[:function.source.index('{')].strip() + ';', mapping) + '\n'
    storage_header += '''
extern bool8 FR_gExitStairsMovementDisabled;
void FR_QL_UpdateObjectEventCurrentMovement(struct ObjectEvent *, struct Sprite *);
extern u8 FR_gGlobalFieldTintMode;
extern bool8 FR_gHelpSystemEnabled;
extern u8 FR_gDisableMapMusicChangeOnMapLoad;
void FR_LoadStdWindowFrameGfx(void);
void FR_LoadQuestLogWindowTiles(u8 windowId, u16 tileStart);
#endif
'''
    mapping.update({name: 'FR_' + name for name in ('gGlobalFieldTintMode', 'gHelpSystemEnabled', 'gDisableMapMusicChangeOnMapLoad')})
    storage_header = storage_header.replace('extern u8 FR_gGlobalFieldTintMode;', 'extern u8 FR_gGlobalFieldTintMode;\nextern u8 FR_gQuestLogLastAttackerToFaintOpponent;')
    write('include/whole_game_fr_quest_log.h', storage_header)
    write('include/constants/firered_quest_log.h', rewrite_tokens(constants, mapping))
    fieldmoves = '\n'.join(line for line in (donor / 'include/constants/party_menu.h').read_text().splitlines() if re.match(r'#define\s+FIELD_MOVE_', line))
    write('include/constants/firered_quest_log_field_moves.h', rewrite_tokens(fieldmoves, mapping) + '\n')
    donor_groups = json.loads((donor / 'data/maps/map_groups.json').read_text())
    host_group_count = len(json.loads((base / 'data/maps/map_groups.json').read_text())['group_order'])
    map_defines = []
    for group_index, group in enumerate(donor_groups['group_order']):
        for map_index, map_name in enumerate(donor_groups[group]):
            identifier = json.loads((donor / 'data/maps' / map_name / 'map.json').read_text())['id']
            target = mapping.get(identifier, 'MAP_FR_' + identifier[4:])
            value = ((host_group_count + group_index) << 8) | map_index
            map_defines.append(f'#ifndef {target}\n#define {target} 0x{value:04X}\n#else\n#if {target} != 0x{value:04X}\n#error "FireRed questlog map ID disagrees with imported world"\n#endif\n#endif')
    write('include/constants/firered_quest_log_map_ids.h', '\n'.join(map_defines) + '\n')
    declarations = '\n'.join('extern const u8 FR_' + name + '[];' for name in sorted(text_names))
    write('include/firered_quest_log_text.h', declarations + '\n')
    write('src/firered_quest_log/text.c', '#include "global.h"\n' + rewrite_tokens(text_source, mapping))
    write('src/firered_quest_log/storage.c', '''#include "whole_game_fr_quest_log.h"
#include "event_data.h"
EWRAM_DATA u8 FR_gQuestLogLastAttackerToFaintOpponent = 0;
EWRAM_DATA u8 FR_gGlobalFieldTintMode = 0;
EWRAM_DATA u8 FR_gDisableMapMusicChangeOnMapLoad = 0;
EWRAM_DATA struct FR_QuestLogScene gFRQuestLogScenes[FR_QUEST_LOG_SCENE_COUNT] = {0};
typedef char FR_QuestLogSceneSizeCheck[sizeof(struct FR_QuestLogScene) == 1640 ? 1 : -1];
typedef char FR_QuestLogHistorySizeCheck[sizeof(gFRQuestLogScenes) == 6560 ? 1 : -1];
void *FR_QuestLog_GetHistoryBuffer(void) { return gFRQuestLogScenes; }
u32 FR_QuestLog_GetHistorySize(void) { return sizeof(gFRQuestLogScenes); }
static struct { u16 repel; bool8 whiteFlute, blackFlute, valid; } sSharedAliases;
static bool8 FR_QuestLog_ReadAliasFlag(u16 id) { return (gSaveBlock1Ptr->flags[id / 8] >> (id % 8)) & 1; }
static void FR_QuestLog_WriteAliasFlag(u16 id, bool8 value) { u8 *byte = &gSaveBlock1Ptr->flags[id / 8]; *byte = (*byte & ~(1 << (id % 8))) | (value << (id % 8)); }
void FR_QuestLog_CaptureSceneAliases(struct FR_QuestLogScene *scene)
{
    scene->vars[0x20] = gSaveBlock1Ptr->vars[VAR_REPEL_STEP_COUNT - VARS_START];
    scene->flags[0x803 / 8] = (scene->flags[0x803 / 8] & ~(1 << (0x803 % 8))) | (FR_QuestLog_ReadAliasFlag(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE) << (0x803 % 8));
    scene->flags[0x804 / 8] = (scene->flags[0x804 / 8] & ~(1 << (0x804 % 8))) | (FR_QuestLog_ReadAliasFlag(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE) << (0x804 % 8));
}
void FR_QuestLog_RestoreSceneAliases(const struct FR_QuestLogScene *scene)
{
    gSaveBlock1Ptr->vars[VAR_REPEL_STEP_COUNT - VARS_START] = scene->vars[0x20];
    FR_QuestLog_WriteAliasFlag(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE, (scene->flags[0x803 / 8] >> (0x803 % 8)) & 1);
    FR_QuestLog_WriteAliasFlag(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE, (scene->flags[0x804 / 8] >> (0x804 % 8)) & 1);
}
void FR_QuestLog_BackUpSharedAliases(void)
{
    sSharedAliases.repel = gSaveBlock1Ptr->vars[VAR_REPEL_STEP_COUNT - VARS_START];
    sSharedAliases.whiteFlute = FR_QuestLog_ReadAliasFlag(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE);
    sSharedAliases.blackFlute = FR_QuestLog_ReadAliasFlag(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE);
    sSharedAliases.valid = TRUE;
}
void FR_QuestLog_RestoreSharedAliases(void)
{
    if (!sSharedAliases.valid) return;
    gSaveBlock1Ptr->vars[VAR_REPEL_STEP_COUNT - VARS_START] = sSharedAliases.repel;
    FR_QuestLog_WriteAliasFlag(FR_FLAG_SYS_WHITE_FLUTE_ACTIVE, sSharedAliases.whiteFlute);
    FR_QuestLog_WriteAliasFlag(FR_FLAG_SYS_BLACK_FLUTE_ACTIVE, sSharedAliases.blackFlute);
    sSharedAliases.valid = FALSE;
}
''')
    write('include/firered_quest_log_gflib.h', (donor / 'gflib/gflib.h').read_text() if (donor / 'gflib/gflib.h').exists() else (donor / 'include/gflib.h').read_text())
    fan_constants = (donor / 'include/constants/trainer_fan_club.h').read_text()
    write('include/constants/firered_trainer_fan_club.h', fan_constants)
    missing_headers = set()
    for name, original in source.items():
        body = original
        if name == 'trainer_fan_club':
            for delegated in sorted((f for f in functions(original, 'src/trainer_fan_club.c') if f.name in ('Script_BufferFanClubTrainerName', 'BufferFanClubTrainerName')), key=lambda f: -f.start):
                body = body[:delegated.start] + body[delegated.end:]
            body = re.sub(r'(?m)^static void BufferFanClubTrainerName[^;]+;\n', '', body)
        if name == 'quest_log':
            snapshot = 'CpuCopy16(gSaveBlock1Ptr->vars, questLog->vars, sizeof(gSaveBlock1Ptr->vars));'
            body = body.replace(snapshot, snapshot + '\n    FR_QuestLog_CaptureSceneAliases(questLog);')
            restore = 'CpuCopy16(questLog->vars, gSaveBlock1Ptr->vars, sizeof(gSaveBlock1Ptr->vars));'
            body = body.replace(restore, restore + '\n    FR_QuestLog_RestoreSceneAliases(questLog);')
            body = body.replace('if (sNumScenes != 0)\n    {', 'if (sNumScenes != 0)\n    {\n        FR_QuestLog_BackUpSharedAliases();')
            body = body.replace('    LoadGameSave(SAVE_NORMAL);', '''    if (LoadGameSave(SAVE_NORMAL) != SAVE_STATUS_OK)
    {
        gQuestLogState = 0;
        gQuestLogPlaybackState = QL_PLAYBACK_STATE_STOPPED;
        sQuestLogCB = NULL;
        gFieldCallback2 = NULL;
        FreeAllWindowBuffers();
        SetMainCallback1(NULL);
        SetMainCallback2(CB2_InitTitleScreen);
        return;
    }
    FR_QuestLog_RestoreSharedAliases();''')
        for old, new in shared_bindings.items():
            body = body.replace(old, new)
        # History is a stable, separately allocated EWRAM object. It does not
        # move when the host relocates its SaveBlock pointers.
        body = body.replace('ptrdiff_t offset = (void *)gSaveBlock1Ptr - oldSaveBlockPtr;',
                            'ptrdiff_t offset = 0; // Stable dedicated quest-log scene storage; no SaveBlock relocation.')
        includes = re.findall(r'(?m)^#include "([^"]+)"', body)
        kept = []
        for include in includes:
            if include == 'constants/trainer_fan_club.h':
                kept.append('constants/firered_trainer_fan_club.h')
                continue
            if include == 'gflib.h':
                kept.append('firered_quest_log_gflib.h')
                continue
            if include.startswith('quest_log') or include == 'constants/quest_log.h':
                continue
            if include in ('new_menu_helpers.h', 'help_system.h'):
                missing_headers.add(include)
                continue
            if (base / 'include' / include).exists() or include == 'gflib.h':
                kept.append(include)
            else:
                missing_headers.add(include)
        body = re.sub(r'(?m)^#include[^\n]*\n', '', body)
        # Byte-equivalent copies avoid assuming alignment of typed u8 bank arrays.
        body = re.sub(r'CpuCopy16\(([^,\n]+), ([^,\n]+), (sizeof\([^;\n]+\))\);', lambda m: 'memcpy(' + m[2] + ', ' + m[1] + ', ' + m[3] + ');' if 'flags' in m[1] + m[2] else m[0], body)
        body = rewrite_tokens(body, mapping)
        # Host common_data linker section enumerates original objects only.
        # Preserve each real donor variable in the engine EWRAM allocation.
        body = body.replace('COMMON_DATA', 'EWRAM_DATA')
        body = body.replace('PLAYER_AVATAR_GFX_NORMAL', 'PLAYER_AVATAR_STATE_NORMAL').replace('PLAYER_AVATAR_GFX_BIKE', 'PLAYER_AVATAR_STATE_MACH_BIKE').replace('PLAYER_AVATAR_GFX_FISH', 'PLAYER_AVATAR_STATE_FISHING').replace('PLAYER_AVATAR_GFX_RIDE', 'PLAYER_AVATAR_STATE_SURFING')
        body = body.replace('FR_MetatileBehavior_IsSurfable(MapGridGetMetatileBehaviorAt(x, y))', '((WholeGameFireRedTerrainAt(x, y) & 2) != 0)')
        body = body.replace('MetatileBehavior_IsSurfable(MapGridGetMetatileBehaviorAt(x, y))', '((WholeGameFireRedTerrainAt(x, y) & 2) != 0)')
        preamble = '\n'.join('#include "' + include + '"' for include in dict.fromkeys(kept))
        preamble += '\n#include "whole_game_fr_quest_log.h"\n#include "firered_quest_log_text.h"\n#include "pokemon_storage_system.h"\n#include "whole_game_battle_modes.h"\n#include "whole_game_fr_semantics.h"\n#include "constants/field_effects.h"\n#include "constants/firered_region_map_sections.h"\n#include "constants/firered_quest_log_field_moves.h"\n#include "title_screen.h"\n#include "data.h"\n#include "battle_setup.h"\n#include "field_screen_effect.h"\n#include "constants/firered_quest_log_map_ids.h"\n'
        # Tutorial classification is source regional mode, never Emerald's
        # colliding FIRST_BATTLE/BATTLE_TYPE_POKEDUDE bit assignments.
        body = body.replace('!(gBattleTypeFlags & (BATTLE_TYPE_LINK | BATTLE_TYPE_OLD_MAN_TUTORIAL | BATTLE_TYPE_POKEDUDE))',
                            '!(gBattleTypeFlags & BATTLE_TYPE_LINK) && !WholeGame_IsFireRedTutorialBattle()')
        write(f'src/firered_quest_log/{name}.c', preamble + '\n' + body)
    asset = 'graphics/quest_log/description_window.4bpp'
    asset_input = donor / asset
    # The asset build system materializes 4bpp from the exact original PNG.
    for path in sorted((donor / 'graphics/quest_log').rglob('*')):
        if path.is_file():
            target = output / path.relative_to(donor)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())
            changed.append(path.relative_to(donor).as_posix())
    support = _support(donor, output, mapping, write)
    input_lifecycle = _input_lifecycle(donor, output, mapping, write)
    lifecycle = _lifecycle(donor, output, mapping, write)
    report = {'inputLifecyclePatches': input_lifecycle, 'supportSourceFunctions': support, 'lifecyclePatches': lifecycle, 'schema': 'single-rom-quest-log/1', 'status': 'blocked', 'buildEligible': False,
              'campaignComplete': False, 'providers': [{'name': name, 'target': 'FR_' + name,
                  'status': 'source-ported-compilation-pending', 'source': f'src/{next(f.path.split("/")[-1] for f in all_functions if f.name == name)}'}
                  for name in REQUIRED],
              'history': {'bytes': HISTORY_BYTES, 'sceneBytes': 1640, 'sceneCount': 4,
                          'bufferProvider': 'FR_QuestLog_GetHistoryBuffer', 'sizeProvider': 'FR_QuestLog_GetHistorySize',
                          'durableCodecOwner': 'single_rom_save_codec', 'durableQualified': False},
              'sharedStateBindings': shared_bindings, 'sourceFunctions': len(all_functions),
              'externalSourceProviders': [{'name': name, 'target': mapping[name], 'source': f.path, 'status': 'requires-source-provider'} for name, f in external_functions.items()],
              'missingHeaders': sorted(missing_headers), 'changedFiles': sorted(changed),
              'symbolMap': mapping, 'sources': [{'path': f'src/{name}.c', 'sha256': hashlib.sha256(text.encode()).hexdigest()}
                                              for name, text in source.items()],
              'unresolved': [
                  {'id': 'native-source-abi', 'reason': 'Full original source staged; host signature/field/resource adapters require compilation verification.'},
                  {'id': 'overworld-lifecycle', 'reason': 'Recording/playback field input, map loader, object, palette and save-resume callbacks must route actual source lifecycle.'},
                  {'id': 'rematch-state', 'reason': 'FR_QuestLog_GetTrainerRematchArray must bind the real donor VS Seeker state provider.'},
                  {'id': 'durable-history', 'reason': '6560-byte history uses dedicated unifiedsave history codec; EWRAM source buffer alone is not persistence.'}],
              'timing': {'wallSeconds': time.monotonic() - started, 'buildSeconds': None, 'queueSeconds': None, 'baselineSeconds': None}}
    if report_dir:
        Path(report_dir).mkdir(parents=True, exist_ok=True)
        (Path(report_dir) / 'quest-log-ledger.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ('emerald-source', 'firered-source', 'output-tree', 'report-dir'):
        p.add_argument('--' + arg, type=Path, required=True)
    args = p.parse_args()
    r = stage_quest_log(args.emerald_source, args.firered_source, args.output_tree, args.report_dir)
    print(json.dumps({'status': r['status'], 'sourceFunctions': r['sourceFunctions'], 'history': r['history'], 'timing': r['timing']}))
