"""Stage source-native FireRed field movement consumers in an isolated host tree.

This is a source transform, not ROM or graphical qualification. Donor functions
are retained with explicit symbol/ABI mappings; canonical checkouts are read-only.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions


def stage_field_movement(base, donor, out, report_dir=None):
    start = time.monotonic()
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == p or p in out.parents or out in p.parents for p in (base, donor)):
        raise ValueError('output must be isolated from canonical sources')
    hashes, providers, patched = {}, [], []
    def read(root, rel):
        text = (root / rel).read_text()
        hashes[('donor/' if root == donor else 'staged/') + rel] = hashlib.sha256(text.encode()).hexdigest()
        return text
    def write(rel, text):
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_text(text)
        patched.append(rel)
    def once(text, old, new):
        if text.count(old) != 1:
            raise ValueError('unsupported field movement source: ' + old[:100])
        return text.replace(old, new, 1)
    def extract(rel, names, mapping=None):
        text = read(donor, rel)
        index = {f.name:f for f in functions(text, rel)}
        result = []
        for name in names:
            f = index[name]
            providers.append({'source':rel,'function':name,'sha256':hashlib.sha256(f.source.encode()).hexdigest(),
                              'symbol_mapping':mapping or {}})
            result.append(rewrite(f.source, mapping or {}))
        # Forward declare each extracted function, including local callbacks.
        declarations = '\n'.join(s[:s.index('{')].strip() + ';' for s in result)
        return declarations + '\n' + '\n\n'.join(result)
    def rewrite(text, mapping):
        return re.sub(r'\b[A-Za-z_]\w*\b', lambda m:mapping.get(m[0],m[0]), text)
    def branch_function(text, name, body):
        f = next(f for f in functions(text, '') if f.name == name)
        insertion = f.source.index('{') + 1
        # agbcc is C89: retain original declarations at the beginning of a
        # nested block, after the regional dispatch. This also preserves local
        # initializer timing on the host path.
        wrapped = f.source[:insertion] + '\n' + body + '\n    {' + f.source[insertion:-1] + '    }\n}'
        return text[:f.start] + wrapped + text[f.end:]
    header = '''#ifndef GUARD_WHOLE_GAME_FR_MOVEMENT_H
#define GUARD_WHOLE_GAME_FR_MOVEMENT_H
#include "global.h"
#include "whole_game_fr_semantics.h"
bool8 WGFR_IsDirectionalStairWarpMetatileBehavior(u16 behavior, u8 direction);
void WGFR_DoStairWarp(u16 behavior, u16 delay);
bool32 WGFR_PlayerIsMovingOnRockStairs(u8 direction);
void WGFR_HandleBoulderFallThroughHole(struct ObjectEvent *object);
void WGFR_HandleBoulderActivateVictoryRoadSwitch(u16 x, u16 y);
u16 WGFR_GetBoulderRevealFlagByLocalIdAndMap(u8 localId, u8 mapNum, u8 mapGroup);
#define WGFR_COLLISION_DIRECTIONAL_STAIR_WARP 14
'''
    # Allocate beyond all host actions, retaining STEP_END/NONE sentinels.
    constants = read(out, 'include/constants/event_object_movement.h')
    used = [int(v,0) for n,v in re.findall(r'^#define (MOVEMENT_ACTION_\w+)\s+(0x[0-9A-Fa-f]+|\d+)', constants,re.M)
            if n not in ('MOVEMENT_ACTION_STEP_END','MOVEMENT_ACTION_NONE')]
    next_id = max(used) + 1
    donor_constants = read(donor, 'include/constants/event_object_movement.h')
    donor_values = {n:int(v,0) for n,v in re.findall(r'^#define (MOVEMENT_ACTION_\w+)\s+(0x[0-9A-Fa-f]+|\d+)', donor_constants,re.M)}
    action_map, action_symbols = {}, {}
    action_specs = [(f'{kind}_{d.upper()}', callback+d) for kind,callback in [('WALK_SLOWER','WalkSlower'),('SPIN','Spin')] for d in ('Down','Up','Left','Right')]
    action_specs += [(f'PLAYER_RUN_{d.upper()}_SLOW', 'Run'+d+'Slow') for d in ('Down','Up','Left','Right')]
    action_specs += [(f'WALK_SLOW_{d.upper()}', 'WalkSlow'+d) for d in ('Down','Up','Left','Right')]
    action_names = [name for name, _ in action_specs]
    for i, name in enumerate(action_names):
        symbol = 'MOVEMENT_ACTION_' + name
        action_map[str(donor_values[symbol])] = next_id + i
        action_symbols[symbol] = 'FR_' + symbol
        header += f'#define FR_{symbol} {next_id+i}\n'
    header += '\n#endif\n'
    write('include/constants/whole_game_fr_movement.h', header)
    common = '#include "constants/whole_game_fr_movement.h"\n'
    # Exact donor object movement handlers. Host coordinate/step/animation APIs
    # have matching signatures and native frame 0/1/2 cardinal standing layouts.
    rel = 'src/event_object_movement.c'
    names = ['InitNpcForWalkSlower','InitWalkSlower','UpdateWalkSlower','SetWalkSlowerSpriteData','UpdateWalkSlowerAnim','InitSpin','GetSpinDirectionAnimNum','InitNpcForRunSlow','InitRunSlow','UpdateRunSlow','SetRunSlowSpriteData','UpdateRunSlowAnim','InitNpcForWalkSlow','InitWalkSlow','UpdateWalkSlow','SetWalkSlowSpriteData','UpdateWalkSlowAnim']
    names += [f'MovementAction_{callback}_Step{step}' for _,callback in action_specs for step in (0,1)]
    mapping = {name:'WGFR_' + name for name in names}
    mapping.update({'sSpinDirectionAnimNums':'wgfrSpinDirectionAnimNums'})
    # Donor local sprite aliases are expanded rather than leaking macros.
    mapping.update({'tDirection':'data[3]','tStepNo':'data[5]','tDelay':'data[4]'})
    for i, direction in enumerate(('SOUTH','NORTH','WEST','EAST')):
        mapping['ANIM_SPIN_' + direction] = str(24+i)
    source = read(donor, rel)
    array = re.search(r'static const u8 sSpinDirectionAnimNums\[\]\s*=\s*\{.*?\};',source,re.S)[0]
    extra = rewrite(array,mapping) + '\n' + extract(rel,names,mapping)
    extra += '\n' + extract(rel,['GetBoulderRevealFlagByLocalIdAndMap'], {'GetBoulderRevealFlagByLocalIdAndMap':'WGFR_GetBoulderRevealFlagByLocalIdAndMap'}).replace('->objUnion.normal.trainerType','->trainerType')
    tables = ''
    for _, name in action_specs:
            tables += f'static u8 (*const wgfrAction{name}[])(struct ObjectEvent *, struct Sprite *) = {{WGFR_MovementAction_{name}_Step0, WGFR_MovementAction_{name}_Step1, MovementAction_PauseSpriteAnim}};\n'
    # Put providers before the dispatch table include, after movement primitives
    # are forward declared in that header. Bodies follow the whole original TU.
    text = read(out,rel)
    prototypes = 'u8 MovementAction_PauseSpriteAnim(struct ObjectEvent *, struct Sprite *);\n' + '\n'.join('static u8 WGFR_MovementAction_' + callback+'_Step'+str(step)+'(struct ObjectEvent *, struct Sprite *);' for _,callback in action_specs for step in (0,1))
    text = once(text, '#include "data/object_events/movement_action_func_tables.h"', prototypes+'\n'+tables+'\n#include "data/object_events/movement_action_func_tables.h"')
    write(rel,common+text+'\n'+extra+'\n')
    rel = 'src/data/object_events/movement_action_func_tables.h'
    text = read(out,rel)
    a = text.index('gMovementActionFuncs[]')
    b = text.index('{',a)+1
    rows = '\n' + '\n'.join(f'    [FR_MOVEMENT_ACTION_{name}] = wgfrAction{callback},' for name,callback in action_specs)
    # title() yields WalkSlower for the generated callback name.
    text = text[:b]+rows+text[b:]
    write(rel,text)
    # Spin frames use the same cardinal standing frame indices in both engines.
    rel = 'src/data/object_events/object_event_anims.h'
    donor_anims = read(donor,rel)
    spin_anims = '\n'.join(re.search(r'static const union AnimCmd sAnim_Spin'+d+r'\[\]\s*=\s*\{.*?\};',donor_anims,re.S)[0].replace('sAnim_Spin','wgfrAnimSpin') for d in ('South','North','West','East'))
    text = read(out,rel)
    needle = 'static const union AnimCmd *const sAnimTable_BrendanMayNormal[] = {'
    text = once(text,needle,spin_anims+'\n'+needle+'\n'+ '\n'.join(f'    [{24+i}] = wgfrAnimSpin{d},' for i,d in enumerate(('South','North','West','East'))))
    write(rel,text)
    # Native forced-movement dispatcher and persistent last-spin state.
    rel = 'src/field_player_avatar.c'
    names = ['TryUpdatePlayerSpinDirection','TryDoMetatileBehaviorForcedMovement','PlayerApplyTileForcedMovement','ForcedMovement_SpinRight','ForcedMovement_SpinLeft','ForcedMovement_SpinUp','ForcedMovement_SpinDown','PlaySpinSound','PlayerGoSpin','PlayerIsMovingOnRockStairs']
    mapping = {n:'WGFR_'+n for n in names}
    mapping.update({'PLAYER_AVATAR_FLAG_FORCED':'PLAYER_AVATAR_FLAG_FORCED_MOVE','PLAYER_AVATAR_FLAG_CONTROLLABLE':'PLAYER_AVATAR_FLAG_CONTROLLABLE','lastSpinTile':'wholeGameLastSpinTile','sPlayerObjectPtr':'wgfrPlayerObjectPtr','sForcedMovementFuncs':'wgfrForcedMovementFuncs','GetSpinMovementAction':'WGFR_GetSpinMovementAction'})
    # A field is appended to the actual host avatar, preserving per-avatar reset.
    avatar_header = read(out,'include/global.fieldmap.h')
    a = avatar_header.index('struct PlayerAvatar\n{')
    b = avatar_header.index('};', a)
    avatar_header = avatar_header[:b] + '    u8 wholeGameLastSpinTile;\n' + avatar_header[b:]
    write('include/global.fieldmap.h',avatar_header)
    d = read(donor,rel)
    a = d.index('static const struct {', d.index('static bool8 TryUpdatePlayerSpinDirection(void)\n{'))
    b = d.index('\nstatic bool8 TryDoMetatileBehaviorForcedMovement(void)\n{',a)
    table = rewrite(d[a:b],mapping)
    table = re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],table)
    extra = extract(rel,names,mapping)
    extra = re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],extra)
    # Forward declarations precede table, while function bodies follow it.
    split = extra.index('\nstatic bool8 WGFR_TryUpdatePlayerSpinDirection(void)\n{')
    extra = extra[:split]+'\n'+table+extra[split:]
    extra = 'static struct ObjectEvent *wgfrPlayerObjectPtr;\nstatic u8 WGFR_GetSpinMovementAction(u8 direction)\n{\n    static const u8 actions[] = {FR_MOVEMENT_ACTION_SPIN_DOWN, FR_MOVEMENT_ACTION_SPIN_DOWN, FR_MOVEMENT_ACTION_SPIN_UP, FR_MOVEMENT_ACTION_SPIN_LEFT, FR_MOVEMENT_ACTION_SPIN_RIGHT};\n    return actions[direction];\n}\n'+extra
    text = read(out,rel)
    # Need shared host static forced-movement functions visible before donor table.
    text = once(text,'if (gPlayerAvatar.preventStep == FALSE)','if (gPlayerAvatar.preventStep == FALSE && (!WholeGameIsFireRedMap() || !WGFR_TryUpdatePlayerSpinDirection()))')
    text = branch_function(text,'TryDoMetatileBehaviorForcedMovement','    if (WholeGameIsFireRedMap())\n        return WGFR_TryDoMetatileBehaviorForcedMovement();\n')
    text = branch_function(text,'CheckForPlayerAvatarCollision','    if (WholeGameIsFireRedMap() && WGFR_IsDirectionalStairWarpMetatileBehavior(gObjectEvents[gPlayerAvatar.objectEventId].currentMetatileBehavior, direction))\n        return WGFR_COLLISION_DIRECTIONAL_STAIR_WARP;\n')
    text = branch_function(text,'PlayCollisionSoundIfNotFacingWarp','    if (WholeGameIsFireRedMap() && WGFR_IsDirectionalStairWarpMetatileBehavior(gObjectEvents[gPlayerAvatar.objectEventId].currentMetatileBehavior, direction))\n        return;\n')
    text = once(text, '        ObjectEventClearHeldMovementIfFinished(boulder);\n        gPlayerAvatar.preventStep = FALSE;', '        ObjectEventClearHeldMovementIfFinished(boulder);\n        if (WholeGameIsFireRedMap())\n        {\n            WGFR_HandleBoulderFallThroughHole(boulder);\n            WGFR_HandleBoulderActivateVictoryRoadSwitch(boulder->currentCoords.x, boulder->currentCoords.y);\n        }\n        gPlayerAvatar.preventStep = FALSE;')
    # Native Kanto Strength movement uses 32-frame walk-slower, unlike host slow.
    text = once(text, 'ObjectEventSetHeldMovement(boulder, GetWalkSlowMovementAction((u8)task->tDirection));', 'ObjectEventSetHeldMovement(boulder, WholeGameIsFireRedMap() ? (FR_MOVEMENT_ACTION_WALK_SLOWER_DOWN + (u8)task->tDirection - 1) : GetWalkSlowMovementAction((u8)task->tDirection));')
    # Donor suppresses wall collisions for the stair consumer; host collision 14
    # is outside the existing collision range, so the branch returns silently.
    text = text.replace('PlayerRun(direction);','if (WholeGameIsFireRedMap() && WGFR_PlayerIsMovingOnRockStairs(direction))\n            WGFR_PlayerRunSlow(direction);\n        else\n            PlayerRun(direction);')
    text = once(text, '        PlayerWalkNormal(direction);\n    }\n}\n\nstatic u8 CheckForPlayerAvatarCollision', '        if (WholeGameIsFireRedMap() && WGFR_PlayerIsMovingOnRockStairs(direction))\n            PlayerSetAnimId(FR_MOVEMENT_ACTION_WALK_SLOW_DOWN + direction - 1, COPY_MOVE_WALK);\n        else\n            PlayerWalkNormal(direction);\n    }\n}\n\nstatic u8 CheckForPlayerAvatarCollision')
    extra = 'static void WGFR_PlayerRunSlow(u8 direction)\n{\n    static const u8 actions[] = {FR_MOVEMENT_ACTION_PLAYER_RUN_DOWN_SLOW, FR_MOVEMENT_ACTION_PLAYER_RUN_DOWN_SLOW, FR_MOVEMENT_ACTION_PLAYER_RUN_UP_SLOW, FR_MOVEMENT_ACTION_PLAYER_RUN_LEFT_SLOW, FR_MOVEMENT_ACTION_PLAYER_RUN_RIGHT_SLOW};\n    PlayerSetAnimId(actions[direction], COPY_MOVE_WALK);\n}\n' + extra
    text = branch_function(text, 'PlayerNotOnBikeMoving', '    if (WholeGameIsFireRedMap() && CheckForPlayerAvatarCollision(direction) == WGFR_COLLISION_DIRECTIONAL_STAIR_WARP)\n        return;\n')
    write(rel,common+'static void WGFR_PlayerRunSlow(u8 direction);\nstatic bool8 WGFR_TryUpdatePlayerSpinDirection(void);\nstatic bool8 WGFR_TryDoMetatileBehaviorForcedMovement(void);\n'+text+'\n'+extra+'\n')
    # Native bicycle state/transition tables, independent of Hoenn acro logic.
    rel = 'src/bike.c'
    names = ['MovePlayerOnBike','GetBikeTransitionId','BikeInputHandler_Normal','BikeInputHandler_Turning','BikeInputHandler_Slope','BikeTransition_FaceDirection','BikeTransition_TurnDirection','BikeTransition_MoveDirection','BikeTransition_Downhill','BikeTransition_Uphill','GetBikeCollision','GetBikeCollisionAt','CanBikeFaceDirectionOnRail','MetatileBehaviorForbidsBiking','Bike_SetBikeStill']
    mapping = {n:'WGFR_'+n for n in names}
    mapping.update({'sBikeTransitions':'wgfrBikeTransitions','sBikeInputHandlers':'wgfrBikeInputHandlers','COLLISION_DIRECTIONAL_STAIR_WARP':'WGFR_COLLISION_DIRECTIONAL_STAIR_WARP','COLLISION_COUNT':'15','PlayerIsMovingOnRockStairs':'WGFR_PlayerIsMovingOnRockStairs'})
    d = read(donor,rel)
    a=d.index('static void (*const sBikeTransitions'); b=d.index('\nvoid MovePlayerOnBike',a)
    table = rewrite(d[a:b],mapping)
    extra = extract(rel,names,mapping)
    extra = re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],extra)
    split = extra.index('\nvoid WGFR_MovePlayerOnBike(')
    extra=extra[:split]+'\n'+table+extra[split:]
    enum = 'enum {BIKE_TRANS_FACE_DIRECTION, BIKE_TRANS_TURNING, BIKE_TRANS_MOVE, BIKE_TRANS_DOWNHILL, BIKE_TRANS_UPHILL};\nenum {BIKE_STATE_NORMAL, BIKE_STATE_TURNING, BIKE_STATE_SLOPE};\n'
    text=read(out,rel)
    text=branch_function(text,'MovePlayerOnBike','    if (WholeGameIsFireRedMap())\n    {\n        WGFR_MovePlayerOnBike(direction, newKeys, heldKeys);\n        return;\n    }\n')
    text=branch_function(text,'BikeClearState','    gPlayerAvatar.wholeGameLastSpinTile = 0;\n')
    write(rel,common+'void WGFR_MovePlayerOnBike(u8 direction, u16 newKeys, u16 heldKeys);\n'+text+'\n'+enum+extra+'\n')
    # Native directional stair predicates, warp setup, and animation tasks.
    rel='src/field_control_avatar.c'
    mapping={'HandleBoulderFallThroughHole':'WGFR_HandleBoulderFallThroughHole','HandleBoulderActivateVictoryRoadSwitch':'WGFR_HandleBoulderActivateVictoryRoadSwitch','GetBoulderRevealFlagByLocalIdAndMap':'WGFR_GetBoulderRevealFlagByLocalIdAndMap','QuestLog_CutRecording':'FR_QuestLog_CutRecording','MB_FALL_WARP':'WGFR_MB_FALL_WARP','MB_STRENGTH_BUTTON':'WGFR_MB_STRENGTH_BUTTON','IsDirectionalStairWarpMetatileBehavior':'WGFR_IsDirectionalStairWarpMetatileBehavior','TryArrowWarp':'WGFR_TryArrowWarp','DoStairWarp':'WGFR_DoStairWarp'}
    extra=extract(rel,['IsDirectionalStairWarpMetatileBehavior','TryArrowWarp','HandleBoulderFallThroughHole','HandleBoulderActivateVictoryRoadSwitch'],mapping)
    extra=re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],extra)
    text=read(out,rel)
    text=branch_function(text,'TryStartWarpEventScript','    if (WholeGameIsFireRedMap() && WGFR_MetatileBehavior_IsFallWarp(metatileBehavior))\n    {\n        s8 id = GetWarpEventAtMapPosition(&gMapHeader, position);\n        if (id != WARP_ID_NONE)\n        {\n            StoreInitialPlayerAvatarState();\n            SetupWarp(&gMapHeader, id, position);\n            ResetInitialPlayerAvatarState();\n            ScriptContext_SetupScript(FR_EventScript_DoFallWarp);\n            return TRUE;\n        }\n    }\n')
    text=branch_function(text,'CheckStandardWildEncounter','    if (WholeGameIsFireRedMap())\n        return FR_TryStandardWildEncounterAtPlayer();\n')
    text=branch_function(text,'RestartWildEncounterImmunitySteps','    if (WholeGameIsFireRedMap())\n        FR_ResetEncounterRateModifiers();\n')
    text=branch_function(text,'TryArrowWarp','    if (WholeGameIsFireRedMap())\n        return WGFR_TryArrowWarp(position, metatileBehavior, direction);\n')
    write(rel,common+'#include "whole_game_fr_encounters.h"\n#include "event_data.h"\n#define WGFR_MB_FALL_WARP 0x66\n#define WGFR_MB_STRENGTH_BUTTON 0x20\nextern const u8 FR_EventScript_DoFallWarp[];\nvoid FR_QuestLog_CutRecording(void);\nstatic bool8 WGFR_TryArrowWarp(struct MapPosition *, u16, u8);\n'+text+'\n'+extra+'\n')
    rel='src/field_fadetransition.c'
    names=['DoStairWarp','Task_StairWarp','UpdateStairsMovement','ForceStairsMovement','GetStairsMovementDirection','Task_ExitStairs','ExitStairsMovement','WaitStairExitMovementFinished','WaitWarpFadeOutScreen','FieldFadeTransitionBackgroundEffectIsFinished']
    mapping={n:'WGFR_'+n for n in names}
    # Retain the native preview predicate as an unresolved external until the
    # preview owner provides its actual task state; never fake readiness.
    mapping['ForestMapPreviewScreenIsRunning']='FR_ForestMapPreviewScreenIsRunning'
    # Audited camera operations: donor state0 reset/callback and state2 freeze
    # are identical to the host's named camera operations.
    mapping.update({'CameraObjectReset1':'CameraObjectReset','CameraObjectReset2':'CameraObjectFreeze'})
    extra=extract(rel,names,mapping)
    extra=re.sub(r'\bMetatileBehavior_\w+',lambda m:'WGFR_'+m[0],extra)
    text=read(out,'src/field_screen_effect.c')
    text=once(text,'    else if (MetatileBehavior_IsNonAnimDoor(behavior) == TRUE)','    else if (WholeGameIsFireRedMap() && WGFR_MetatileBehavior_IsDirectionalStairWarp(behavior))\n        func = FR_gExitStairsMovementDisabled ? Task_ExitNonDoor : WGFR_Task_ExitStairs;\n    else if (MetatileBehavior_IsNonAnimDoor(behavior) == TRUE)')
    f = next(f for f in functions(text, '') if f.name == 'SetUpWarpExitTask')
    body = once(f.source, '    CreateTask(func, 10);', '    FR_gExitStairsMovementDisabled = FALSE;\n    CreateTask(func, 10);')
    text = text[:f.start] + body + text[f.end:]
    write('src/field_screen_effect.c',common+'#include "firered_region_map.h"\nbool32 FR_ForestMapPreviewScreenIsRunning(void);\nstatic void WGFR_Task_ExitStairs(u8 taskId);\n'+text+'\n'+extra+'\n')
    # Native VS Seeker trainer responses: source movement state machines and
    # original emote graphics/effects, with fresh host dispatch IDs.
    vs_actions = [('RAISE_HAND_AND_STOP','RaiseHandAndStop'),('RAISE_HAND_AND_JUMP','RaiseHandAndJump'),('RAISE_HAND_AND_SWIM','RaiseHandAndSwim'),('EMOTE_X','EmoteX'),('EMOTE_DOUBLE_EXCL_MARK','EmoteDoubleExclamationMark')]
    vs_constants = ''
    for i,(constant,_) in enumerate(vs_actions):
        symbol='MOVEMENT_ACTION_'+constant
        action_map[str(donor_values[symbol])] = next_id+len(action_specs)+i
        action_symbols[symbol]='FR_'+symbol
        vs_constants += f'#define FR_{symbol} {action_map[str(donor_values[symbol])]}\n'
    host_constants=read(out,'include/constants/event_object_movement.h')
    type_count=int(re.search(r'#define NUM_MOVEMENT_TYPES\s+(0x[0-9A-Fa-f]+|\d+)',host_constants)[1],0)
    type_symbols={}
    for i,(constant,_) in enumerate(vs_actions[:3]):
        symbol='MOVEMENT_TYPE_'+constant
        type_symbols[symbol]=str(type_count+i)
        vs_constants+=f'#define FR_{symbol} {type_count+i}\n'
    type_symbols['MOVEMENT_TYPE_WANDER_AROUND_SLOWER']=str(type_count+3)
    vs_constants+=f'#define FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER {type_count+3}\n'
    host_constants=re.sub(r'(#define NUM_MOVEMENT_TYPES\s+)(0x[0-9A-Fa-f]+|\d+)',lambda m:m[1]+str(type_count+4),host_constants)
    write('include/constants/event_object_movement.h',host_constants)
    fx_scripts=read(out,'data/field_effect_scripts.s')
    pointer_start=fx_scripts.index('gFieldEffectScriptPointers::')
    pointer_end=fx_scripts.index('\ngFieldEffectScript_',pointer_start+len('gFieldEffectScriptPointers::'))
    fx_count=len(re.findall(r'^\s*\.4byte ',fx_scripts[pointer_start:pointer_end],re.M))
    vs_constants+=f'#define FR_FLDEFF_X_ICON {fx_count}\n#define FR_FLDEFF_DOUBLE_EXCL_MARK_ICON {fx_count+1}\n'
    header=once(read(out,'include/constants/whole_game_fr_movement.h'),'\n#endif\n','\n'+vs_constants+'\n#endif\n')
    write('include/constants/whole_game_fr_movement.h',header)
    type_names=['MovementType_RaiseHandAnd'+kind for kind in ('Stop','Jump','Swim')]
    names=type_names+[n+'_Callback' for n in type_names]
    names += ['MovementType_RaiseHandAndStop_Step0','MovementType_RaiseHandAndStop_Step1','MovementType_RaiseHandAndStop_Step2','MovementType_RaiseHandAndJump_Step0','MovementType_RaiseHandAndSwim_Step0','MovementType_RaiseHandAndMove_Step1']
    names += ['MovementAction_RaiseHand_Step0','MovementAction_RaiseHandAndStop_Step1','MovementAction_RaiseHandAndJump_Step1','MovementAction_RaiseHandAndSwim_Step1','MovementAction_EmoteX_Step0','MovementAction_EmoteDoubleExclamationMark_Step0']
    names += ['MovementType_WanderAround_Step'+str(i) for i in (0,1,2,3,4,6)] + ['MovementType_WanderAround_Step5Slower']
    mapping={n:'WGFR_'+n for n in names}
    mapping.update({'gMovementDelaysMedium':'wgfrMovementDelaysMedium','GetWalkSlowerMovementAction':'WGFR_GetWalkSlowerMovementAction'})
    mapping.update({n:'FR_'+n for n in action_symbols})
    mapping.update({n:'FR_'+n for n in type_symbols})
    mapping.update({'ANIM_RAISE_HAND':'20','FLDEFF_X_ICON':'FR_FLDEFF_X_ICON','FLDEFF_DOUBLE_EXCL_MARK_ICON':'FR_FLDEFF_DOUBLE_EXCL_MARK_ICON'})
    for kind in ('Stop','Jump','Swim'):
        mapping['gMovementTypeFuncs_RaiseHandAnd'+kind]='wgfrMovementTypeFuncs_RaiseHandAnd'+kind
    donor_tables=read(donor,'src/data/object_events/movement_type_func_tables.h')
    tables='\n'.join(rewrite(re.search(r'u8 \(\*const gMovementTypeFuncs_RaiseHandAnd'+kind+r'\[\]\)\(struct ObjectEvent \*, struct Sprite \*\) = \{.*?\};',donor_tables,re.S)[0],mapping) for kind in ('Stop','Jump','Swim'))
    donor_obj=read(donor,'src/event_object_movement.c')
    wander_table=re.search(r'u8 \(\*const gMovementTypeFuncs_WanderAroundSlower\[\]\)\(struct ObjectEvent \*, struct Sprite \*\) = \{.*?\};',donor_tables,re.S)[0]
    tables+='\n'+rewrite(wander_table,{**mapping,'gMovementTypeFuncs_WanderAroundSlower':'wgfrMovementTypeFuncs_WanderAroundSlower'})
    delays=re.search(r'static const s16 gMovementDelaysMedium\[\] = \{[^}]*\};',donor_obj)[0]
    tables+='\n'+rewrite(delays,mapping)
    getter_macro=donor_obj[donor_obj.index('#define dirn_to_anim('):donor_obj.index('\ndirn_to_anim(GetFaceDirectionMovementAction')]
    getter_macro=getter_macro.replace('dirn_to_anim','wgfr_dirn_to_anim')
    walk_actions=re.search(r'static const u8 sWalkSlowerMovementActions\[\] = \{.*?\};',donor_obj,re.S)[0]
    tables+='\n'+rewrite(walk_actions,{**mapping,'sWalkSlowerMovementActions':'wgfrWalkSlowerActions'})+'\n'+getter_macro+'\nwgfr_dirn_to_anim(WGFR_GetWalkSlowerMovementAction,wgfrWalkSlowerActions);\n'
    extracted=extract('src/event_object_movement.c',names,mapping)
    split=extracted.index('\nvoid WGFR_MovementType_RaiseHandAndStop(')
    extracted=extracted[:split]+'\n'+tables+extracted[split:]
    extracted+='\nmovement_type_def(WGFR_MovementType_WanderAroundSlower,wgfrMovementTypeFuncs_WanderAroundSlower)\n'
    prelude='void WGFR_MovementType_WanderAroundSlower(struct Sprite *);\n'+'\n'.join('void WGFR_'+n+'(struct Sprite *);' for n in type_names)
    obj=read(out,'src/event_object_movement.c')
    obj=once(obj,'static void (*const sMovementTypeCallbacks[])(struct Sprite *) =',prelude+'\nstatic void (*const sMovementTypeCallbacks[])(struct Sprite *) =')
    for array in ('sMovementTypeCallbacks','gInitialMovementTypeFacingDirections'):
        a=obj.index(array+'[]');b=obj.index('{',a)+1
        entries='\n'+'\n'.join(f'    [FR_MOVEMENT_TYPE_{constant}] = '+('WGFR_MovementType_'+callback if array=='sMovementTypeCallbacks' else 'DIR_SOUTH')+',' for constant,callback in vs_actions[:3])
        entries+='\n    [FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER] = '+('WGFR_MovementType_WanderAroundSlower' if array=='sMovementTypeCallbacks' else 'DIR_SOUTH')+','
        obj=obj[:b]+entries+obj[b:]
    a=obj.index('sMovementTypeHasRange[NUM_MOVEMENT_TYPES]');b=obj.index('{',a)+1
    obj=obj[:b]+'\n    [FR_MOVEMENT_TYPE_WANDER_AROUND_SLOWER] = TRUE,'+obj[b:]
    action_prelude='\n'.join('static bool8 WGFR_'+n+'(struct ObjectEvent *, struct Sprite *);' for n in names if n.startswith('MovementAction_'))
    for constant,callback in vs_actions:
        first='RaiseHand' if constant.startswith('RAISE_HAND') else callback
        second='WGFR_MovementAction_'+callback+'_Step1' if constant.startswith('RAISE_HAND') else 'MovementAction_PauseSpriteAnim'
        action_prelude+=f'\nstatic u8 (*const wgfrVsAction{callback}[])(struct ObjectEvent *, struct Sprite *) = {{WGFR_MovementAction_{first}_Step0,{second}}};\n'
    obj=once(obj,'#include "data/object_events/movement_action_func_tables.h"',action_prelude+'\n#include "data/object_events/movement_action_func_tables.h"')
    write('src/event_object_movement.c','#include "global.h"\n#include "trig.h"\n'+obj+'\n'+extracted+'\n')
    table=read(out,'src/data/object_events/movement_action_func_tables.h');a=table.index('gMovementActionFuncs[]');b=table.index('{',a)+1
    entries='\n'+'\n'.join(f'    [FR_MOVEMENT_ACTION_{constant}] = wgfrVsAction{callback},' for constant,callback in vs_actions)
    write('src/data/object_events/movement_action_func_tables.h',table[:b]+entries+table[b:])
    # Preserve the original emoticon image table, animation commands and callback.
    donor_icons=read(donor,'src/trainer_see.c')
    a=donor_icons.index('static const struct OamData sOamData_Emoticons')
    b=donor_icons.index('\nu8 FldEff_ExclamationMarkIcon1',a)
    icon_data=donor_icons[a:b]
    icon_names=['FldEff_XIcon','FldEff_DoubleExclMarkIcon','SetIconSpriteData','SpriteCB_TrainerIcons']
    icon_map={n:'WGFR_'+n for n in icon_names}
    data_names=set(re.findall(r'\b(?:sOamData_|sSpriteImages_|sAnimCmd_|sSpriteAnimTable_|sSpriteTemplate_)\w+',icon_data))
    icon_map.update({n:'wgfr_'+n for n in data_names})
    icon_map.update({'sGfx_Emoticons':'wgfrGfxEmoticons','FLDEFF_X_ICON':'FR_FLDEFF_X_ICON','FLDEFF_DOUBLE_EXCL_MARK_ICON':'FR_FLDEFF_DOUBLE_EXCL_MARK_ICON',
                     'sLocalId':'data[0]','sMapNum':'data[1]','sMapGroup':'data[2]','sData3':'data[3]','sData4':'data[4]','sFldEffId':'data[7]'})
    icon_data=rewrite(icon_data,icon_map)
    icon_preamble='''#include "global.h"
#include "event_object_movement.h"
#include "field_effect.h"
#include "sprite.h"
#include "constants/whole_game_fr_movement.h"
static void WGFR_SpriteCB_TrainerIcons(struct Sprite *sprite);
static const u16 wgfrGfxEmoticons[] = INCGFX_U16("graphics/firered_native_movement/emoticons.png", ".4bpp", "-mwidth 2 -mheight 2");
'''
    write('src/firered_native/movement_icons.c',icon_preamble+icon_data+'\n'+extract('src/trainer_see.c',icon_names,icon_map)+'\n')
    rule_source=read(donor,'graphics_file_rules.mk')
    if 'graphics/misc/emoticons.4bpp: %.4bpp: %.png\n\t$(GFX) $< $@ -mwidth 2 -mheight 2' not in rule_source:
        raise ValueError('unsupported native emoticon asset conversion recipe')
    asset_rel='graphics/firered_native_movement/emoticons.png'
    (out/asset_rel).parent.mkdir(parents=True,exist_ok=True)
    asset=(donor/'graphics/misc/emoticons.png').read_bytes();(out/asset_rel).write_bytes(asset)
    hashes['donor/graphics/misc/emoticons.png']=hashlib.sha256(asset).hexdigest();patched.append(asset_rel)
    pointer_rows='\n\t.4byte WGFR_gFieldEffectScript_XIcon\n\t.4byte WGFR_gFieldEffectScript_DoubleExclMarkIcon\n'
    fx_scripts=fx_scripts[:pointer_end]+pointer_rows+fx_scripts[pointer_end:]
    donor_fx=read(donor,'data/field_effect_scripts.s')
    for donor_label,host_label in [('gFldEffScript_XIcon','WGFR_gFieldEffectScript_XIcon'),('gFldEffScript_DoubleExclMarkIcon','WGFR_gFieldEffectScript_DoubleExclMarkIcon')]:
        script=re.search(r'^'+donor_label+r'::\n(?:\t[^\n]*\n)+',donor_fx,re.M)[0]
        script=script.replace(donor_label,host_label).replace('\tcallnative ','\tfield_eff_callnative ').replace('\tend\n','\tfield_eff_end\n')
        script=re.sub(r'(?m)^\tend[ \t]*$', '\tfield_eff_end', script)
        script=rewrite(script,icon_map)
        fx_scripts+='\n'+script
    write('data/field_effect_scripts.s',fx_scripts)
    ledger={'schema_version':1,'semantic_coverage_complete':False,
            'supported':['native FR spin tile direction retention, stop tiles and collision','native FR bicycle pull-down state machine and transitions','native FR directional stair warp dispatch and entry/exit movement','native FR walk-slower object actions','native FR boulder fall/reveal and Victory Road switch callbacks','native FR fallwarp script dispatch','native FR VS Seeker raise-hand stop/jump/swim movement types/actions','native FR X and double-exclamation emote effects and original graphics','native FR slower-wandering NPC state machine'],
            'unsupported':[{'consumer':'field_screen_effect.c','reason':'FR_ForestMapPreviewScreenIsRunning native preview-task state provider is unresolved; exact donor conjunction retained'},
                           {'consumer':'ROM qualification','reason':'full compiled ROM and rendered spinner/stair qualification not run by this source stage'}],
            'patched_files':patched,'source_hashes':hashes,'providers':providers,'dependencies':{'FR_QuestLog_CutRecording':'native UI provider (must be admitted separately)','FR_EventScript_DoFallWarp':'namespaced donor script bank','FR_TryStandardWildEncounterAtPlayer':'encounters provider','FR_ResetEncounterRateModifiers':'encounters provider','FR_ForestMapPreviewScreenIsRunning':'unresolved native preview-task state provider (no readiness fallback)','FR_gExitStairsMovementDisabled':'native region-map provider, exit-stair suppression consumed and cleared','boulder flags':'template trainerType FLAG already namespaced by world-assets JSON conversion; consumed directly, zero sentinel preserved'},'action_id_map':action_map,'movement_type_map':type_symbols,'asset_providers':[{'source':'graphics/misc/emoticons.png','staged':asset_rel,'conversion':'original donor recipe -mwidth 2 -mheight 2; host INCGFX_U16 build integration','consumer':'src/firered_native/movement_icons.c'}],'field_effect_ids':{'X':fx_count,'double_exclamation':fx_count+1},
            'symbolMap':{k:str(action_map[str(donor_values[k])]) for k in action_symbols} | type_symbols,
            'measurement':{'source_transform_duration_seconds':time.monotonic()-start,'build_duration_seconds':None,'queue_duration_seconds':None,'reason':'source stage only; no ROM build'}}
    if report_dir:
        report=Path(report_dir); report.mkdir(parents=True,exist_ok=True)
        (report/'field-movement-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
