"""Native FR boat, field-animation and field-policy source closures.

Existing authoritative shared field services are resolved by shared_services;
this stage owns only source-specific closures and explicit regional consumers.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions
from .scripts import rewrite_tokens

ROOTS=('AnimateTeleporterCable','AnimateTeleporterHousing','DoSSAnneDepartureCutscene',
       'DoSeagallopFerryScene','IsPlayerLeftOfVermilionSailor',
       'SeafoamIslandsB4F_CurrentDumpsPlayerOnLand','SetIcefallCaveCrackedIceMetatiles','TryFieldPoisonWhiteOut',
       'DoCableClubWarp','DoFallWarp','ReturnFromLinkRoom','DrawWholeMapView','SetCableClubWarp','Script_FacePlayer')


def stage_field_services(base, donor, out, report_dir=None):
    start=time.monotonic();base,donor,out=(Path(p).resolve() for p in (base,donor,out))
    if any(out==p or p in out.parents or out in p.parents for p in (base,donor)):
        raise ValueError('field services output must be isolated from canonical sources')
    hashes,patched,providers,assets={},[],[],[]
    def read(root,rel):
        text=(root/rel).read_text();hashes[('donor/' if root==donor else 'staged/')+rel]=hashlib.sha256(text.encode()).hexdigest();return text
    def write(rel,text):
        path=out/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched.append(rel)
    def once(text,old,new):
        if text.count(old)!=1:raise ValueError('unsupported field service source anchor: '+old[:90])
        return text.replace(old,new,1)
    def extract(rel,names,mapping):
        index={f.name:f for f in functions(read(donor,rel),rel)};bodies=[]
        for name in names:
            f=index[name];body=rewrite_tokens(f.source,mapping);bodies.append(body)
            providers.append({'name':name,'target':mapping.get(name,name),'signature':body.split('{',1)[0].strip(),
                              'source':rel+':'+name,'sourceSha256':hashlib.sha256(f.source.encode()).hexdigest(),
                              'status':'source-ported','root':name in ROOTS})
        return '\n'.join(b.split('{',1)[0].strip()+';' for b in bodies)+'\n\n'+'\n\n'.join(bodies)
    common='''#include "global.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "field_camera.h"
#include "field_player_avatar.h"
#include "fieldmap.h"
#include "main.h"
#include "overworld.h"
#include "script.h"
#include "sound.h"
#include "sprite.h"
#include "task.h"
#include "constants/songs.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_state.h"
'''
    labels=read(donor,'include/constants/metatile_labels.h')
    metatiles=dict(re.findall(r'^#define\s+(METATILE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)',labels,re.M))
    # Source-native teleporter task closure, excluding unused escalator subsystem.
    rel='src/special_field_anim.c';names=['AnimateTeleporterCable','AnimateTeleporterHousing','Task_DrawTeleporterCable','Task_DrawTeleporterHousing']
    mapping={n:('FR_' if n in ROOTS else 'WGFS_')+n for n in names}
    mapping.update({'tTimer':'data[0]','tState':'data[1]','tX':'data[2]','tY':'data[3]'})
    used=set(re.findall(r'\bMETATILE_SeaCottage_\w+',read(donor,rel)))
    mapping.update({n:'WGFS_'+n for n in used})
    defines='\n'.join('#define WGFS_'+n+' '+metatiles[n] for n in sorted(used))
    write('src/firered_native/field_teleporter.c',common+defines+'\n'+extract(rel,names,mapping)+'\n')
    for row in providers:row['translationUnit']='src/firered_native/field_teleporter.c'
    # Copy complete small native boat systems: all callbacks, resources and
    # cleanup stay in their actual original ordering and task state machines.
    recipe=read(donor,'graphics_file_rules.mk')
    def boat(rel,target,public):
        text=read(donor,rel);fs=functions(text,rel)
        mapping={f.name:('FR_' if f.name in public else 'WGFS_')+f.name for f in fs}
        mapping.update({'MAP':'WGFS_MAP','GetTextWindowPalette':'FR_GetTextWindowPalette'})
        mapping.update({'HelpSystem_Disable':'FR_HelpSystem_Disable','HelpSystem_Enable':'FR_HelpSystem_Enable'})
        mapping.update({n:'FR_'+n for n in set(re.findall(r'\b(?:SE|MUS)_\w+',text))})
        mapping.update({n:'MAP_FR_'+n[4:] for n in set(re.findall(r'\bMAP_(?!GROUP\b|NUM\b|OFFSET\b)\w+',text))})
        # Preserve source records; only resource location/converter syntax changes.
        def resource(m):
            macro,source=m[1],m[2];original=source
            staged='graphics/firered_field_services/'+source.removeprefix('graphics/')
            flags=''
            if source.endswith('.4bpp'):
                source=source[:-5]+'.png';staged=staged[:-5]+'.png'
                rule=re.search(re.escape(original)+r':[^\n]*\n\t\$\(GFX\) \$< \$@([^\n]*)',recipe)
                flags=rule[1].strip() if rule else ''
                expression=f'{macro.replace("INCBIN", "INCGFX")}("{staged}", ".4bpp"'+(f', "{flags}"' if flags else '')+')'
            elif source.endswith('.gbapal'):
                source=source[:-7]+'.pal';staged=staged[:-7]+'.pal'
                if not (donor/source).exists():
                    source=source[:-4]+'.png';staged=staged[:-4]+'.png'
                expression=f'{macro.replace("INCBIN", "INCGFX")}("{staged}", ".gbapal")'
            else:expression=f'{macro}("{staged}")'
            data=(donor/source).read_bytes();path=out/staged;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);patched.append(staged)
            digest=hashlib.sha256(data).hexdigest();hashes['donor/'+source]=digest
            assets.append({'source':source,'staged':staged,'sourceSha256':digest,'conversionFlags':flags,'expression':expression})
            return expression
        text=re.sub(r'\b(INCBIN_U(?:8|16|32))\("([^"]+)"\)',resource,text)
        text=re.sub(r'^#include[^\n]*\n','',text,flags=re.M)
        text=rewrite_tokens(text,mapping)
        includes='''#define WGFS_MAP(map) MAP_GROUP(map), MAP_NUM(map)
#include "firered_native_ui.h"
#include "constants/rgb.h"
#include "bg.h"
#include "decompress.h"
#include "dma3.h"
#include "gpu_regs.h"
#include "malloc.h"
#include "palette.h"
#include "scanline_effect.h"
#include "trainer_pokemon_sprites.h"
#include "window.h"
#include "field_weather.h"
#include "field_screen_effect.h"
#include "constants/maps.h"
#include "constants/firered_seagallop.h"
#include "whole_game_fr_field_services.h"
'''
        write(target,common+includes+text+'\n')
        for f in fs:
            providers.append({'name':f.name if f.name in public else 'boat-internal:'+f.name,'target':mapping[f.name],'signature':rewrite_tokens(f.source.split('{',1)[0].strip(),mapping),
                              'source':rel+':'+f.name,'sourceSha256':hashlib.sha256(f.source.encode()).hexdigest(),
                              'translationUnit':target,'status':'source-ported','root':f.name in public})
    boat('src/ss_anne.c','src/firered_native/field_ss_anne.c',{'DoSSAnneDepartureCutscene'})
    boat('src/seagallop.c','src/firered_native/field_seagallop.c',{'DoSeagallopFerryScene','IsPlayerLeftOfVermilionSailor'})
    # Native Icefall policy: donor coordinates, original four-frame delay and
    # raw donor tile IDs. Dynamic temp flags are translated into the Kanto bank.
    rel='src/field_tasks.c';source=read(donor,rel)
    coords=re.search(r'static const u8 sIcefallCaveIceCoords\[\]\[2\]\s*=\s*\{.*?\};',source,re.S)[0]
    names=['SetIcefallCaveCrackedIceMetatiles','MarkIcePuzzleCoordVisited','IcefallCaveIcePerStepCallback']
    mapping={n:('FR_' if n in ROOTS else 'WGFS_')+n for n in names}
    mapping.update({'tState':'data[1]','tPrevX':'data[2]','tPrevY':'data[3]','tIceX':'data[4]','tIceY':'data[5]','tDelay':'data[6]',
                    'VAR_TEMP_1':'FR_VAR_TEMP_1','MetatileBehavior_IsThinIce':'WGFR_MetatileBehavior_IsThinIce','MetatileBehavior_IsCrackedIce':'WGFR_MetatileBehavior_IsCrackedIce',
                    'METATILE_SeafoamIslands_CrackedIce':'WGFS_METATILE_SeafoamIslands_CrackedIce','METATILE_SeafoamIslands_IceHole':'WGFS_METATILE_SeafoamIslands_IceHole',
                    'SE_ICE_CRACK':'FR_SE_ICE_CRACK','SE_ICE_BREAK':'FR_SE_ICE_BREAK'})
    # This callback is called by the regional per-step dispatch in host field_tasks.
    mapping['IcefallCaveIcePerStepCallback']='FR_IcefallCaveIcePerStepCallback'
    code=extract(rel,names,mapping).replace('static void FR_IcefallCaveIcePerStepCallback','void FR_IcefallCaveIcePerStepCallback')
    code=code.replace('FlagSet(i + 1)','FlagSet(0x1000 + i + 1)').replace('FlagGet(i + 1)','FlagGet(0x1000 + i + 1)')
    defines='\n'.join('#define WGFS_'+n+' '+metatiles[n] for n in ('METATILE_SeafoamIslands_CrackedIce','METATILE_SeafoamIslands_IceHole'))
    write('src/firered_native/field_icefall.c',common+'#include "whole_game_fr_semantics.h"\n'+defines+'\n'+coords+'\n'+code+'\n')
    for row in providers:
        if row['source'].startswith(rel+':'):row['translationUnit']='src/firered_native/field_icefall.c'
    text=read(out,rel);text=once(text,'    sPerStepCallbacks[idx](taskId);','    if (WholeGame_IsKanto() && idx == STEP_CB_SOOTOPOLIS_ICE)\n        FR_IcefallCaveIcePerStepCallback(taskId);\n    else\n        sPerStepCallbacks[idx](taskId);')
    write(rel,'#include "whole_game_fr_field_services.h"\n#include "whole_game_state.h"\n'+text)
    # Native field poison result policy retains FR TRUE/FALSE and never exposes
    # Emerald's battle-facility-specific whiteout code to Kanto scripts.
    rel='src/field_poison.c';names=['IsMonValidSpecies','AllMonsFainted','FaintFromFieldPoison','MonFaintedFromPoison','Task_TryFieldPoisonWhiteOut','TryFieldPoisonWhiteOut']
    mapping={n:('FR_' if n in ROOTS else 'WGFS_')+n for n in names}
    mapping.update({'tState':'data[0]','tPartyId':'data[1]','gText_PkmnFainted3':'FR_gText_PkmnFainted3','FRIENDSHIP_EVENT_FAINT_OUTSIDE_BATTLE':'FRIENDSHIP_EVENT_FAINT_FIELD_PSN'})
    write('src/firered_native/field_poison.c',common+'''#include "pokemon.h"
#include "party_menu.h"
#include "field_message_box.h"
#include "string_util.h"
#include "constants/battle.h"
#include "constants/party_menu.h"
extern const u8 FR_gText_PkmnFainted3[];
'''+extract(rel,names,mapping)+'\n')
    for row in providers:
        if row['source'].startswith(rel+':'):row['translationUnit']='src/firered_native/field_poison.c'
    # Native Seafoam stop-surf task closure. Original quest-log guards/duration,
    # object freeze/unfreeze and help context update remain real dependencies.
    rel='src/field_player_avatar.c';names=['SeafoamIslandsB4F_CurrentDumpsPlayerOnLand','CreateStopSurfingTask','Task_StopSurfingInit','Task_WaitStopSurfing','QL_TryRecordPlayerStepWithDuration0']
    mapping={n:('FR_' if n in ROOTS else 'WGFS_')+n for n in names}
    mapping.update({'gQuestLogPlaybackState':'FR_gQuestLogPlaybackState','QL_PLAYBACK_STATE_RUNNING':'FR_QL_PLAYBACK_STATE_RUNNING','QL_PLAYBACK_STATE_ACTION_END':'FR_QL_PLAYBACK_STATE_ACTION_END',
                    'QuestLogRecordPlayerAvatarGfxTransitionWithDuration':'FR_QuestLogRecordPlayerAvatarGfxTransitionWithDuration','QuestLogRecordPlayerStepWithDuration':'FR_QuestLogRecordPlayerStepWithDuration',
                    'SetHelpContextForMap':'FR_SetHelpContextForMap','BOB_MON_ONLY':'BOB_JUST_MON','PLAYER_AVATAR_GFX_NORMAL':'PLAYER_AVATAR_STATE_NORMAL',
                    'GetJumpSpecialWithEffectMovementAction':'FR_GetJumpSpecialWithEffectMovementAction'})
    # Extend the actual movement table with native with-effect jump handlers;
    # regular host special jumps clear landingJump and are not an equivalent.
    constants=read(out,'include/constants/whole_game_fr_movement.h')
    action_defs=re.findall(r'^#define FR_MOVEMENT_ACTION_\w+\s+(\d+)',constants,re.M)
    next_action=max(map(int,action_defs))+1;move_names=[];action_rows=[];new_constants=''
    for i,direction in enumerate(('DOWN','UP','LEFT','RIGHT')):
        new_constants+=f'#define FR_MOVEMENT_ACTION_JUMP_SPECIAL_WITH_EFFECT_{direction} {next_action+i}\n'
        callback=direction.title();move_names.extend('MovementAction_JumpSpecialWithEffect'+callback+'_Step'+str(j) for j in (0,1))
        action_rows.append((direction,callback))
    constants=once(constants,'\n#endif\n','\n'+new_constants+'\n#endif\n');write('include/constants/whole_game_fr_movement.h',constants)
    move_mapping={n:'WGFS_'+n for n in move_names}
    move_code=extract('src/event_object_movement.c',move_names,move_mapping)
    action_tables='\n'.join(f'static u8 (*const wgfsJumpEffect{cb}[])(struct ObjectEvent *, struct Sprite *) = {{WGFS_MovementAction_JumpSpecialWithEffect{cb}_Step0,WGFS_MovementAction_JumpSpecialWithEffect{cb}_Step1,MovementAction_PauseSpriteAnim}};' for _,cb in action_rows)
    action_protos='\n'.join('static bool8 WGFS_'+n+'(struct ObjectEvent *, struct Sprite *);' for n in move_names)
    text=read(out,'src/event_object_movement.c');text=once(text,'#include "data/object_events/movement_action_func_tables.h"',action_protos+'\n'+action_tables+'\n#include "data/object_events/movement_action_func_tables.h"')
    write('src/event_object_movement.c',text+'\n'+move_code+'\n')
    table=read(out,'src/data/object_events/movement_action_func_tables.h');a=table.index('gMovementActionFuncs[]');b=table.index('{',a)+1
    rows='\n'+'\n'.join(f'    [FR_MOVEMENT_ACTION_JUMP_SPECIAL_WITH_EFFECT_{d}] = wgfsJumpEffect{cb},' for d,cb in action_rows)
    write('src/data/object_events/movement_action_func_tables.h',table[:b]+rows+table[b:])
    # Preserve donor accessor table and getter macro instead of assuming host IDs.
    dsrc=read(donor,'src/event_object_movement.c')
    getter_table=re.search(r'static const u8 sJumpSpecialWithEffectMovementActions\[\]\s*=\s*\{.*?\};',dsrc,re.S)[0]
    getter_table=rewrite_tokens(getter_table,{n:'FR_'+n for n in re.findall(r'\bMOVEMENT_ACTION_\w+',getter_table)})
    getter_macro=dsrc[dsrc.index('#define dirn_to_anim('):dsrc.index('\ndirn_to_anim(GetFaceDirectionMovementAction')].replace('dirn_to_anim','wgfs_dirn_to_anim')
    source=read(donor,rel);ql_actions=re.search(r'static const u8 sQuestLogSurfDismountActionIds\[\]\s*=\s*\{.*?\};',source,re.S)[0]
    ql_actions=re.sub(r'\bQL_PLAYER_GFX_\w+',lambda m:'FR_'+m[0],ql_actions)
    sea=common+'''#include "field_effect_helpers.h"
#include "constants/event_object_movement.h"
#include "constants/whole_game_fr_movement.h"
#include "whole_game_fr_quest_log.h"
#include "whole_game_fr_field_services.h"
'''+ql_actions+'\n'+getter_table+'\n'+getter_macro+'\nwgfs_dirn_to_anim(FR_GetJumpSpecialWithEffectMovementAction,sJumpSpecialWithEffectMovementActions);\n'+extract(rel,names,mapping)+'\n'
    write('src/firered_native/field_seafoam.c',sea)
    for row in providers:
        if row['source'].startswith(rel+':'):row['translationUnit']='src/firered_native/field_seafoam.c'
        elif row['source'].startswith('src/event_object_movement.c:'):row['translationUnit']='src/event_object_movement.c'
    providers.append({'name':'GetJumpSpecialWithEffectMovementAction','target':'FR_GetJumpSpecialWithEffectMovementAction','signature':'u8 FR_GetJumpSpecialWithEffectMovementAction(u32 idx)','source':'src/event_object_movement.c:dirn_to_anim(GetJumpSpecialWithEffectMovementAction,sJumpSpecialWithEffectMovementActions)','sourceSha256':hashlib.sha256((getter_macro+getter_table).encode()).hexdigest(),'translationUnit':'src/firered_native/field_seafoam.c','status':'source-ported','root':False})
    # Native residual field entry points use the actual staged host primitive
    # systems. Preserve donor public policy where host wrapper behavior differs.
    for rel,name,target in [('src/field_camera.c','DrawWholeMapView','src/field_camera.c'),('src/field_control_avatar.c','SetCableClubWarp','src/field_control_avatar.c')]:
        code=extract(rel,[name],{name:'FR_'+name})
        write(target,read(out,target)+'\n'+code+'\n')
        providers[-1]['translationUnit']=target
    code=extract('src/event_object_lock.c',['Script_FacePlayer'],{'Script_FacePlayer':'FR_Script_FacePlayer'})
    write('src/firered_native/field_object_lock.c',common+code+'\n')
    providers[-1]['translationUnit']='src/firered_native/field_object_lock.c'
    # Native cable/link/fall transitions keep donor tasks and state ordering.
    rel='src/field_fadetransition.c'
    names=['DoCableClubWarp','Task_CableClubWarp','ReturnFromLinkRoom','Task_ReturnFromLinkRoomWarp','DoFallWarp','DoDiveWarp','Task_Teleport2Warp','WaitWarpFadeOutScreen']
    mapping={n:('FR_' if n in ROOTS else 'WGFS_')+n for n in names}
    mapping['FieldCB_FallWarpExit']='WGFS_FieldCB_FallWarpExit'
    mapping['SE_EXIT']='FR_SE_EXIT'
    write('src/firered_native/field_transitions.c',common+'''#include "palette.h"
#include "link.h"
#include "field_screen_effect.h"
#include "field_weather.h"
void WGFS_FieldCB_FallWarpExit(void);
'''+extract(rel,names,mapping)+'\n')
    for row in providers:
        if row['source'].startswith(rel+':'):row['translationUnit']='src/firered_native/field_transitions.c'
    rel='src/field_effect.c'
    names=['FieldCB_FallWarpExit','Task_FallWarpFieldEffect']+['FallWarpEffect_'+str(i) for i in range(1,8)]
    mapping={n:'WGFS_'+n for n in names}
    mapping.update({'CameraObjectReset1':'CameraObjectReset','CameraObjectReset2':'CameraObjectFreeze',
                    'QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode':'FR_QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode',
                    'MetatileBehavior_IsSurfableInSeafoamIslands':'FR_MetatileBehavior_IsSurfableInSeafoamIslands',
                    'SetHelpContext':'FR_SetHelpContext','HELPCONTEXT_SURFING':'22','VAR_TEMP_1':'FR_VAR_TEMP_1',
                    'SE_FALL':'FR_SE_FALL','SE_M_STRENGTH':'FR_SE_M_STRENGTH'})
    dsource=read(donor,rel)
    table=re.search(r'static bool8 \(\*const sFallWarpEffectCBPtrs\[\]\)\(struct Task \*task\) = \{.*?\};',dsource,re.S)[0]
    table=rewrite_tokens(table,{**mapping,'sFallWarpEffectCBPtrs':'wgfsFallWarpEffectCBPtrs'})
    mapping['sFallWarpEffectCBPtrs']='wgfsFallWarpEffectCBPtrs'
    extracted=extract(rel,names,mapping)
    split=extracted.index('\nvoid WGFS_FieldCB_FallWarpExit(void)\n{')
    extracted=extracted[:split]+'\n'+table+extracted[split:]
    write('src/firered_native/field_fall.c',common+'''#include "field_screen_effect.h"
#include "field_weather.h"
#include "whole_game_fr_semantics.h"
#include "whole_game_fr_field_services.h"
#include "whole_game_fr_quest_log.h"
'''+extracted+'\n')
    for row in providers:
        if row['source'].startswith(rel+':'):row['translationUnit']='src/firered_native/field_fall.c'
    # Preserve the native Seafoam spawn policy used before fall animation.
    seafoam_map={'MetatileBehavior_IsSurfableInSeafoamIslands':'FR_MetatileBehavior_IsSurfableInSeafoamIslands','MetatileBehavior_IsSurfable':'WGFR_MetatileBehavior_IsSurfable','MAP_SEAFOAM_ISLANDS_B3F':'MAP_FR_SEAFOAM_ISLANDS_B3F','MAP_SEAFOAM_ISLANDS_B4F':'MAP_FR_SEAFOAM_ISLANDS_B4F'}
    predicate=extract('src/overworld.c',['MetatileBehavior_IsSurfableInSeafoamIslands'],seafoam_map)
    write('src/firered_native/field_fall.c','#include \"constants/maps.h\"\n'+(out/'src/firered_native/field_fall.c').read_text()+'\n'+predicate+'\n')
    providers[-1]['translationUnit']='src/firered_native/field_fall.c'
    overworld=read(out,'src/overworld.c')
    overworld=once(overworld,'    else if (MetatileBehavior_IsSurfableWaterOrUnderwater(metatileBehavior) == TRUE)','    else if (WholeGame_IsKanto() && FR_MetatileBehavior_IsSurfableInSeafoamIslands(metatileBehavior) == TRUE)\n        return PLAYER_AVATAR_FLAG_ON_FOOT;\n    else if (MetatileBehavior_IsSurfableWaterOrUnderwater(metatileBehavior) == TRUE)')
    write('src/overworld.c','#include \"whole_game_fr_field_services.h\"\n#include \"whole_game_state.h\"\n'+overworld)
    declarations='\n'.join(row['signature'].replace('static ','',1)+';' for row in providers if row['root'])
    header='''#ifndef GUARD_WHOLE_GAME_FR_FIELD_SERVICES_H
#define GUARD_WHOLE_GAME_FR_FIELD_SERVICES_H
#include "global.h"
void FR_HelpSystem_Disable(void);
void FR_HelpSystem_Enable(void);
void FR_SetHelpContextForMap(void);
void FR_SetHelpContext(u8 context);
bool8 FR_MetatileBehavior_IsSurfableInSeafoamIslands(u16 behavior);
void FR_IcefallCaveIcePerStepCallback(u8 taskId);
u8 FR_GetJumpSpecialWithEffectMovementAction(u32 direction);
'''+declarations+'\n#endif\n'
    write('include/whole_game_fr_field_services.h',header)
    ledger={'schema_version':1,'buildEligible':False,'semantic_coverage_complete':False,'providers':providers,'assets':assets,'patched_files':patched,'source_hashes':hashes,
            'symbolMap':{row['name']:row['target'] for row in providers if row['root']},
            'nativeMovementActions':{f'MOVEMENT_ACTION_JUMP_SPECIAL_WITH_EFFECT_{d}':next_action+i for i,(d,_) in enumerate(action_rows)},
            'stateBindings':['shared actual player/object/task/sprite/script/music/warp systems','Kanto raw native tile IDs and9temporary ice flags mapped +0x1000','nativeUI FR_GetTextWindowPalette uses actual donor palette bank','original Seagallop11port positions and direction matrix; map groups namespaced MAP_FR_*','FR poison friendship event8 maps hostevent7 with identical {-5,-5,-10} source delta row','native questlog playback guards and16frame surf-dismount recording; native with-effect jumps retain landingJump'],
            'unresolved':[{'name':'Help runtime','reason':'FR_HelpSystem_Disable/Enable and FR_SetHelpContextForMap are supplied by complete native utility_services Help runtime; targeted compiler receipt and linked qualification pending'},
                          {'name':'ROM qualification','reason':'actual linked boat/field-cutscene/poison/current/ice traversal and cleanup remain unrun'}],
            'measurement':{'source_transform_duration_seconds':time.monotonic()-start,'build_duration_seconds':None,'queue_duration_seconds':None,'reason':'source stage only; scoped compiler evidence separate'}}
    if report_dir:
        p=Path(report_dir);p.mkdir(parents=True,exist_ok=True);(p/'field-services-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
