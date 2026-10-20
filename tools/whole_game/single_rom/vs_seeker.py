"""Port the entire original FireRed VS Seeker subsystem into staged Emerald.

Uses one native bag/party, a separate donor counter+rematch array and actual
source scan/tasks/animations. Rendering and quest-log providers remain explicit.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions, masked, TOKEN
from .scripts import rewrite_tokens
from .encounters import source_function

NEW_MOVEMENTS = ('MOVEMENT_TYPE_RAISE_HAND_AND_STOP', 'MOVEMENT_TYPE_RAISE_HAND_AND_JUMP',
                 'MOVEMENT_TYPE_RAISE_HAND_AND_SWIM', 'MOVEMENT_ACTION_EMOTE_X',
                 'MOVEMENT_ACTION_EMOTE_DOUBLE_EXCL_MARK')


def stage_vs_seeker(base, donor, out, report_dir=None):
    started = time.monotonic()
    base, donor, out = [Path(p).resolve() for p in (base, donor, out)]
    if any(root == out or root in out.parents or out in root.parents for root in (base, donor)):
        raise ValueError('VS Seeker output must be isolated from original sources')
    if 'trainerRematches[100]' not in (out/'include/pokemon_storage_system.h').read_text():
        raise ValueError('state stage must provide original donor rematch array first')
    if (out/'src/firered_vs_seeker.c').exists():
        raise ValueError('VS Seeker already staged; start from a fresh merge')
    source = (donor/'src/vs_seeker.c').read_text()
    source_functions = functions(source, 'src/vs_seeker.c')
    mapping = {f.name: 'FR_' + f.name for f in source_functions}
    mapping['sVsSeeker'] = 'sFRVsSeeker'
    mapping['MAP'] = 'FRVS_MAP'
    for token in set(TOKEN.findall(masked(source))):
        if token.startswith(('FLAG_', 'VAR_', 'SE_', 'MUS_', 'QL_', 'VSSeeker_Text_')):
            mapping[token] = 'FR_' + token
        elif token.startswith('TRAINER_') and not token.startswith('TRAINER_TYPE_'):
            mapping[token] = 'FR_' + token
        elif token.startswith('MAP_') and token not in ('MAP_GROUP', 'MAP_NUM') and not token.startswith('MAP_TYPE_'):
            mapping[token] = 'MAP_FR_' + token[4:]
        elif token.startswith('OBJ_EVENT_GFX_'):
            mapping[token] = 'FRVS_RAW_' + token
    for token in NEW_MOVEMENTS:
        mapping[token] = 'FR_' + token
    mapping.update({'DisplayItemMessageOnField': 'FR_VS_DisplayItemMessageOnField',
                    'ItemUse_SetQuestLogEvent': 'FR_VS_RecordItemUse',
                    'Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker': 'FR_VS_CloseMessage',
                    'OverrideMovementTypeForObjectEvent': 'FR_VS_OverrideMovementType',
                    'walkrun_is_standing_still': 'FR_VS_IsStandingStill',
                    'HandleEnforcedLookDirectionOnPlayerStopMoving': 'PlayerFreeze',
                    'ClearPlayerHeldMovementAndUnfreezeObjectEvents': 'ScriptUnfreezeObjectEvents',
                    'TV_PrintIntToStringVar': 'FR_VS_PrintIntToStringVar',
                    'SetBattledTrainerFlag': 'FR_VS_SetBattledTrainerFlag',
                    'FLDEFF_USE_VS_SEEKER': 'FR_FLDEFF_USE_VS_SEEKER',
                    'FONT_NORMAL': 'FR_FONT_NORMAL'})
    changed = []
    def write(relative, text):
        path = out/relative; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text); changed.append(relative)
    def patch(relative, old, new, expected=1):
        text = (out/relative).read_text()
        if text.count(old) != expected:
            raise ValueError(f'{relative}: expected {expected} anchors {old!r}, found {text.count(old)}')
        write(relative, text.replace(old, new))
    # Original IDs remain raw inside NPC scan records. The renderer uses the
    # map/object provenance bank, not these raw sprite classification values.
    gfx_defines = dict(re.findall(r'^#define\s+(OBJ_EVENT_GFX_\w+)\s+(0x[\da-fA-F]+|\d+)\b', (donor/'include/constants/event_objects.h').read_text(), re.M))
    raw_gfx = '\n'.join(f'#define {target} {gfx_defines[name]}' for name, target in sorted(mapping.items()) if name.startswith('OBJ_EVENT_GFX_'))
    # Allocate an actual new native field-effect entry after all existing ones.
    field_scripts = (out/'data/field_effect_scripts.s').read_text()
    table = re.search(r'(?m)^gFieldEffectScriptPointers::\n((?:[^\n]*\n)*?)(?=\w+::)', field_scripts)
    if not table: raise ValueError('missing native field-effect table')
    effect_id = len(re.findall(r'^\s*\.4byte ', table[1], re.M))
    if effect_id >= 255: raise ValueError('no native field-effect byte ID available')
    field_scripts = field_scripts[:table.end(1)] + '    .4byte FR_gFldEffScript_UseVsSeeker\n\n' + field_scripts[table.end(1):]
    field_scripts += '\nFR_gFldEffScript_UseVsSeeker::\n    field_eff_callnative FR_FldEff_UseVsSeeker\n    field_eff_end\n'
    write('data/field_effect_scripts.s', field_scripts)
    write('include/constants/whole_game_fr_vs_seeker.h', '#ifndef GUARD_WHOLE_GAME_FR_VS_CONSTANTS_H\n#define GUARD_WHOLE_GAME_FR_VS_CONSTANTS_H\n' + f'#define FR_FLDEFF_USE_VS_SEEKER {effect_id}\n' + raw_gfx + '\n#endif\n')
    patch('include/constants/field_effects.h', '#endif', '#include "constants/whole_game_fr_vs_seeker.h"\n#endif')
    public = [f for f in source_functions if not f.static]
    declarations = '\n'.join(rewrite_tokens(f.source[:f.source.index('{')].strip() + ';', mapping) for f in public)
    write('include/whole_game_fr_vs_seeker.h', '''#ifndef GUARD_WHOLE_GAME_FR_VS_SEEKER_H
#define GUARD_WHOLE_GAME_FR_VS_SEEKER_H
#include "global.h"
#include "constants/whole_game_fr_vs_seeker.h"
''' + declarations + '''
void FR_FieldUseFunc_VsSeeker(u8 taskId);
u32 FR_FldEff_UseVsSeeker(void);
u8 (*FR_QuestLog_GetTrainerRematchArray(void))[100];
#endif
''')
    # Retain every original function, data row, movement script and RNG call.
    body = re.sub(r'(?m)^#include[^\n]*\n', '', source)
    body = body.replace('gSaveBlock1Ptr->trainerRematchStepCounter', 'gPokemonStoragePtr->wholeGameKanto.trainerRematchStepCounter')
    body = body.replace('gSaveBlock1Ptr->trainerRematches', 'gPokemonStoragePtr->wholeGameKanto.trainerRematches')
    body = body.replace('.objUnion.normal.', '.').replace('->objUnion.normal.', '->')
    body = rewrite_tokens(body, mapping)
    # The original game reads an inactive object's coordinates before checking
    # its active state. Avoid dereferencing the failure sentinel on this ABI.
    body = body.replace('    struct ObjectEvent *objectEvent = &gObjectEvents[objectEventId];\n\n    if (objectEvent->active', '    struct ObjectEvent *objectEvent;\n    if (objectEventId >= OBJECT_EVENTS_COUNT) return FALSE;\n    objectEvent = &gObjectEvents[objectEventId];\n\n    if (objectEvent->active', 1)
    body = body.replace('gObjectEvents[objectEventId].currentCoords.x - 7', '(objectEventId < OBJECT_EVENTS_COUNT ? gObjectEvents[objectEventId].currentCoords.x - 7 : 0)')
    body = body.replace('gObjectEvents[objectEventId].currentCoords.y - 7', '(objectEventId < OBJECT_EVENTS_COUNT ? gObjectEvents[objectEventId].currentCoords.y - 7 : 0)')
    # Shared native helpers with explicit, typed engine bindings. PlayerFreeze
    # and ScriptUnfreezeObjectEvents match the donor source bodies exactly.
    prelude = '''#include "global.h"
#include "task.h"
#include "malloc.h"
#include "sprite.h"
#include "text.h"
#include "string_util.h"
#include "menu.h"
#include "menu_helpers.h"
#include "window.h"
#include "item.h"
#include "item_menu.h"
#include "item_use.h"
#include "overworld.h"
#include "script.h"
#include "event_scripts.h"
#include "event_data.h"
#include "event_object_lock.h"
#include "event_object_movement.h"
#include "field_player_avatar.h"
#include "field_effect.h"
#include "script_movement.h"
#include "battle_setup.h"
#include "random.h"
#include "sound.h"
#include "pokemon_storage_system.h"
#include "whole_game_state.h"
#include "whole_game_fr_vs_seeker.h"
#include "whole_game_fr_quest_log.h"
void FR_LoadStdWindowFrameGfx(void);
#include "constants/event_objects.h"
#include "constants/event_object_movement.h"
#include "constants/whole_game_fr_movement.h"
#include "constants/whole_game_fr_state.h"
#include "constants/whole_game_fr_encounters.h"
#include "constants/field_effects.h"
#include "constants/trainer_types.h"
#include "constants/maps.h"
#include "constants/items.h"
#include "constants/songs.h"
#define FRVS_MAP(map) MAP_GROUP(map), MAP_NUM(map)
#define DLG_WINDOW_BASE_TILE_NUM 0x200
#define DLG_WINDOW_PALETTE_NUM 15
struct ObjectEventTemplate *GetBaseTemplateForObjectEvent(const struct ObjectEvent *objectEvent);
static void FR_VS_DisplayItemMessageOnField(u8 taskId, u8 fontId, const u8 *string, TaskFunc callback);
static void FR_VS_RecordItemUse(u8 eventId, struct Pokemon *pokemon, u16 itemId, u16 param);
static void FR_VS_CloseMessage(u8 taskId);
static void FR_VS_OverrideMovementType(const struct ObjectEvent *objectEvent, u8 movementType);
static bool8 FR_VS_IsStandingStill(void);
static void FR_VS_PrintIntToStringVar(u8 varidx, s32 number);
static void FR_VS_SetBattledTrainerFlag(void);
extern const u8 FR_VSSeeker_Text_BatteryNotChargedNeedXSteps[];
extern const u8 FR_VSSeeker_Text_NoTrainersWithinRange[];
extern const u8 FR_VSSeeker_Text_TrainersNotReady[];
'''
    # Exact source item-log record and field-message renderer, with the original
    # native bag/UI implementation serving the shared inventory window.
    item_source = (donor/'src/item_use.c').read_text()
    log_fn = source_function(item_source, 'ItemUse_SetQuestLogEvent')
    log_fn = log_fn.replace('void ItemUse_SetQuestLogEvent', 'static void FR_VS_RecordItemUse').replace('struct QuestLogEvent_Item', 'struct FR_QuestLogEvent_Item').replace('SetQuestLogEvent(', 'FR_SetQuestLogEvent(')
    display_fn = source_function((donor/'src/new_menu_helpers.c').read_text(), 'DisplayItemMessageOnField')
    display_fn = display_fn.replace('void DisplayItemMessageOnField', 'static void FR_VS_DisplayItemMessageOnField').replace('LoadStdWindowFrameGfx()', 'FR_LoadStdWindowFrameGfx()').replace('GetTextSpeedSetting()', 'GetPlayerTextSpeedDelay()')
    close_fn = source_function(item_source, 'Task_ItemUse_CloseMessageBoxAndReturnToField')
    close_fn = close_fn.replace('Task_ItemUse_CloseMessageBoxAndReturnToField', 'FR_VS_CloseMessage').replace('ClearPlayerHeldMovementAndUnfreezeObjectEvents()', 'ScriptUnfreezeObjectEvents()')
    lock_fn = source_function((donor/'src/event_object_lock.c').read_text(), 'walkrun_is_standing_still').replace('bool8 walkrun_is_standing_still', 'static bool8 FR_VS_IsStandingStill')
    override_fn = source_function((donor/'src/event_object_movement.c').read_text(), 'OverrideMovementTypeForObjectEvent').replace('void OverrideMovementTypeForObjectEvent', 'static void FR_VS_OverrideMovementType').replace('->objUnion.normal.', '->')
    digit_fn = source_function((donor/'src/field_specials.c').read_text(), 'CountDigits').replace('s32 CountDigits', 'static s32 FR_VS_CountDigits')
    printer_fn = source_function((donor/'src/field_specials.c').read_text(), 'TV_PrintIntToStringVar').replace('void TV_PrintIntToStringVar', 'static void FR_VS_PrintIntToStringVar').replace('CountDigits(', 'FR_VS_CountDigits(').replace('sStringVarPtrs', 'sFRVSStringVarPtrs')
    extras = '''
static u8 *const sFRVSStringVarPtrs[] = {gStringVar1,gStringVar2,gStringVar3,gStringVar4};
static void FR_VS_SetBattledTrainerFlag(void) { SetTrainerFlag(gTrainerBattleOpponent_A); }
u8 (*FR_QuestLog_GetTrainerRematchArray(void))[100]
{ return &gPokemonStoragePtr->wholeGameKanto.trainerRematches; }
'''
    write('src/firered_vs_seeker.c', prelude + body + '\n' + '\n\n'.join([log_fn, display_fn, close_fn, lock_fn, override_fn, digit_fn]) + '\n' + extras + printer_fn + '\n')
    # Use the actual native bag field callback path for both menu and registered
    # key-item activation. Kanto map eligibility remains the original policy.
    item_fn = source_function(item_source, 'FieldUseFunc_VsSeeker')
    item_fn = item_fn.replace('FieldUseFunc_VsSeeker', 'FR_FieldUseFunc_VsSeeker', 1).replace('Task_VsSeeker_0', 'FR_Task_VsSeeker_0')
    item_fn = re.sub(r'\bMAP_(?!TYPE_|GROUP\b|NUM\b)(\w+)', r'MAP_FR_\1', item_fn)
    item_fn = item_fn.replace('if ((gMapHeader.mapType', 'if (!WholeGame_IsKanto() || (gMapHeader.mapType', 1)
    # Keep the original exact Oak message and male font in both UI contexts.
    item_fn = item_fn.replace('PrintNotTheTimeToUseThat(taskId, gTasks[taskId].data[3]);', 'FR_VS_PrintNotTheTimeToUseThat(taskId, gTasks[taskId].data[3]);')
    oak_text = re.search(r'^const u8 gText_OakForbidsUseOfItemHere\[\] = .*?;', (donor/'src/strings.c').read_text(), re.M)[0].replace('const u8 gText_', 'static const u8 sFRVS_')
    item_adapter = '''
static void FR_VS_PrintNotTheTimeToUseThat(u8 taskId, bool8 inField)
{
    StringExpandPlaceholders(gStringVar4, sFRVS_OakForbidsUseOfItemHere);
    if (!inField)
        DisplayItemMessage(taskId, FR_FONT_MALE, gStringVar4, CloseItemMessage);
    else
    {
        FR_LoadStdWindowFrameGfx();
        DisplayMessageAndContinueTask(taskId, 0, 0x200, 15, FR_FONT_MALE,
            GetPlayerTextSpeedDelay(), gStringVar4, Task_CloseCantUseKeyItemMessage);
        CopyWindowToVram(0, COPYWIN_FULL);
    }
}
'''
    item = (out/'src/item_use.c').read_text()
    write('src/item_use.c', '#include "constants/map_types.h"\n#include "whole_game_fr_vs_seeker.h"\n#include "whole_game_state.h"\n#include "firered_native_ui.h"\n' + item + '\n' + oak_text + '\n' + item_adapter + '\n' + item_fn + '\n')
    items = (out/'src/data/items.h').read_text()
    entry = re.search(r'\[ITEM_VS_SEEKER\]\s*=\s*\{.*?\n    \},', items, re.S)
    if not entry: raise ValueError('missing native VS Seeker item')
    if '.fieldUseFunc = ItemUseOutOfBattle_CannotUse' not in entry[0]:
        raise ValueError('VS Seeker field handler already changed')
    write('src/data/items.h', items[:entry.start()] + entry[0].replace('ItemUseOutOfBattle_CannotUse', 'FR_FieldUseFunc_VsSeeker') + items[entry.end():])
    patch('include/item_use.h', '#endif', 'void FR_FieldUseFunc_VsSeeker(u8 taskId);\n#endif')
    # Preserve the full original four-stage player animation task. A transient
    # renderer bank override selects actual FR sprite frames, then restores the
    # native player's original normal/bike/surf graphics before unfreezing.
    effects = (donor/'src/field_effect.c').read_text()
    names = ['FldEff_UseVsSeeker','Task_FldEffUseVsSeeker'] + [f'UseVsSeekerEffect_{i}' for i in range(1,5)]
    effect_map = {name: 'FR_' + name for name in names}
    effect_map.update({'sUseVsSeekerEffectFuncs': 'sFRUseVsSeekerEffectFuncs', 'gQuestLogState': 'FR_gQuestLogState',
                       'QL_STATE_RECORDING': 'FR_QL_STATE_RECORDING', 'QuestLogRecordPlayerAvatarGfxTransitionWithDuration': 'FR_QuestLogRecordPlayerAvatarGfxTransitionWithDuration',
                       'StartPlayerAvatarVsSeekerAnim': 'FR_StartPlayerAvatarVsSeekerAnim', 'FLDEFF_USE_VS_SEEKER': 'FR_FLDEFF_USE_VS_SEEKER'})
    effect_bodies = []
    for name in names:
        function = rewrite_tokens(source_function(effects,name), effect_map)
        if name == 'UseVsSeekerEffect_3':
            function = function.replace('        if (gPlayerAvatar.flags', '        WholeGameSetPlayerGraphicsBank(FALSE);\n        if (gPlayerAvatar.flags', 1)
            function = function.replace('PLAYER_AVATAR_GFX_BIKE', '(gPlayerAvatar.flags & PLAYER_AVATAR_FLAG_ACRO_BIKE ? PLAYER_AVATAR_STATE_ACRO_BIKE : PLAYER_AVATAR_STATE_MACH_BIKE)').replace('PLAYER_AVATAR_GFX_RIDE', 'PLAYER_AVATAR_STATE_SURFING').replace('PLAYER_AVATAR_GFX_NORMAL', 'PLAYER_AVATAR_STATE_NORMAL')
        effect_bodies.append(function)
    effect_decl = '\n'.join(fn[:fn.index('{')].strip()+';' for fn in effect_bodies)
    effect_table = re.search(r'static void \(\*const sUseVsSeekerEffectFuncs\[\]\)\(struct Task \*task\) = \{.*?\};', effects, re.S)[0]
    effect_table = rewrite_tokens(effect_table,effect_map)
    player_fn = '''
static void FR_StartPlayerAvatarVsSeekerAnim(void)
{
    // Original FR raw IDs: Red5/Green12 on foot; Red6/Green13 on bike.
    u8 gfx = (gPlayerAvatar.flags & (PLAYER_AVATAR_FLAG_ACRO_BIKE | PLAYER_AVATAR_FLAG_MACH_BIKE))
        ? (gPlayerAvatar.gender ? 13 : 6) : (gPlayerAvatar.gender ? 12 : 5);
    WholeGameSetPlayerGraphicsBank(TRUE);
    ObjectEventSetGraphicsId(&gObjectEvents[gPlayerAvatar.objectEventId], gfx);
    StartSpriteAnim(&gSprites[gPlayerAvatar.spriteId], 0); // Source ANIM_VS_SEEKER.
}
'''
    write('src/firered_vs_seeker_effect.c', prelude[:prelude.index('#define DLG_WINDOW_BASE_TILE_NUM')] + effect_decl + '\n' + effect_table + '\n' + player_fn + '\n' + '\n\n'.join(effect_bodies) + '\n')
    # Exact original per-step ordering: no forced movement charge; expire wanted
    # rematches before poison/hatch. Low-byte charge follows the portable item.
    field = (out/'src/field_control_avatar.c').read_text()
    step = source_function(field,'TryStartStepCountScript')
    step_new = step.replace('    IncrementRematchStepCounter();', '    if (!WholeGame_IsKanto()) IncrementRematchStepCounter();', 1)
    step_new = step_new.replace('{\n', '{\n    if (WholeGame_IsKanto() && FR_gQuestLogState == FR_QL_STATE_PLAYBACK) return FALSE;\n', 1)
    marker = '        if (UpdatePoisonStepCounter() == TRUE)'
    if marker not in step_new: raise ValueError('missing native poison step ordering')
    step_new = step_new.replace(marker, '''        if (FR_UpdateVsSeekerStepCounter() == TRUE)
        {
            ScriptContext_SetupScript(FR_EventScript_VsSeekerChargingDone);
            return TRUE;
        }
''' + marker, 1)
    write('src/field_control_avatar.c', '#include "global.h"\n#include "constants/firered_quest_log.h"\nextern u8 FR_gQuestLogState;\n#include "whole_game_fr_vs_seeker.h"\n#include "whole_game_state.h"\nextern const u8 FR_EventScript_VsSeekerChargingDone[];\n' + field.replace(step,step_new,1))
    overworld = (out/'src/overworld.c').read_text()
    for name in ['LoadMapFromCameraTransition','LoadMapFromWarp']:
        fn=source_function(overworld,name)
        marker='    RestartWildEncounterImmunitySteps();'
        if marker not in fn: raise ValueError('missing rematch reset map boundary '+name)
        modified=fn.replace(marker,marker+'\n    FR_MapResetTrainerRematches(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum);',1)
        overworld=overworld.replace(fn,modified,1)
    write('src/overworld.c','#include "whole_game_fr_vs_seeker.h"\n'+overworld)
    # Map policy and record bounds are source inputs, not invented scan limits.
    max_trainers = 0
    for path in (donor/'data/maps').glob('*/map.json'):
        events = json.loads(path.read_text()).get('object_events',[])
        count = sum(event.get('trainer_type') in ('TRAINER_TYPE_NORMAL','TRAINER_TYPE_BURIED') for event in events)
        max_trainers=max(max_trainers,count)
    requirements = {
        'include/constants/whole_game_fr_movement.h': ['FR_' + name for name in NEW_MOVEMENTS] + ['FR_MOVEMENT_ACTION_RAISE_HAND_AND_' + kind for kind in ('STOP','JUMP','SWIM')],
        'include/event_object_movement.h': ['WholeGameSetPlayerGraphicsBank'],
        'include/whole_game_fr_quest_log.h': ['FR_SetQuestLogEvent', 'FR_QuestLogRecordPlayerAvatarGfxTransitionWithDuration'],
        'include/firered_native_ui.h': ['FR_LoadStdWindowFrameGfx'],
        'include/text.h': ['FR_FONT_NORMAL', 'FR_FONT_MALE'],
    }
    missing = []
    for relative, symbols in requirements.items():
        text = (out/relative).read_text() if (out/relative).exists() else ''
        for symbol in symbols:
            if symbol not in text: missing.append({'id': 'provider-' + symbol, 'reason': relative + ' must declare the real source provider ' + symbol})
    if max_trainers >= 16:
        missing.append({'id': 'trainer-sentinel-capacity', 'reason': 'source map trainer records require a trailing sentinel inside16 entries'})
    ledger={'component':'vs_seeker','status':'complete' if not missing else 'partial','buildEligible':not missing,'changed_files':changed,
        'exportedSymbols':[mapping[f.name] for f in public]+['FR_FieldUseFunc_VsSeeker','FR_FldEff_UseVsSeeker','FR_QuestLog_GetTrainerRematchArray'],
        'coverage':{'sourceFunctions':len(source_functions),'sourceTranslationUnit':'all original vs_seeker.c functions/data retained','sourceMaxTrainerTemplates':max_trainers,'savedState':'wholeGameKanto.trainerRematchStepCounter(u16),trainerRematches[100]','itemUse':'native bag and registered-key-item callback; donor original Kanto map eligibility','fieldEffectId':effect_id,'effects':'all four original task stages; actual FR player sprite bank and native restoration','rematchScheduling':'original progression flags, SKIP rules, defeated-state, 70-percent RNG and duplicate trainer response','mapAndStepHooks':'source ordering before poison/hatch and original map-load resets'},
        'semanticBindings':{'HandleEnforcedLookDirectionOnPlayerStopMoving':'PlayerFreeze; identical source body','ClearPlayerHeldMovementAndUnfreezeObjectEvents':'ScriptUnfreezeObjectEvents; identical source body modulo local variable name','savedRematchArray':'separate original100byte FR bank; never Emerald MatchCall','ResetDeferredLinkEvent':'quest_log provider single original deferred-event state'},
        'unresolved':missing, 'requiredSourceProviders':requirements,
        'qualificationPending':['Final native provider link and actual item use/scan animation/rematch/save-reload campaign qualification remain unrun.'],
        'sourcePins':{rel:hashlib.sha256((donor/rel).read_bytes()).hexdigest() for rel in ['src/vs_seeker.c','src/item_use.c','src/field_effect.c','src/field_player_avatar.c','src/event_object_movement.c']},'durationSeconds':time.monotonic()-started}
    if report_dir:
        report_dir=Path(report_dir);report_dir.mkdir(parents=True,exist_ok=True)
        (report_dir/'vs-seeker-ledger.json').write_text(json.dumps(ledger,indent=2)+'\n')
    return ledger
