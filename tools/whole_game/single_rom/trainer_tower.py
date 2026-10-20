"""Original retail FireRed Trainer Tower source in the shared Emerald engine."""
from __future__ import annotations
import ast
import hashlib
import json
from pathlib import Path
import re
import time
from .encounters import source_function, rewrite, body, definitions


def stage_trainer_tower(base, donor, out, report_dir=None):
    started=time.monotonic()
    base,donor,out=map(lambda p:Path(p).resolve(),(base,donor,out))
    if any(out==p or p in out.parents or out in p.parents for p in (base,donor)):
        raise ValueError('Trainer Tower requires isolated staged source')
    if (out/'src/firered_trainer_tower.c').exists():
        raise ValueError('Trainer Tower already staged; start from a fresh source merge')
    hashes={};changed=[]
    def read(root,rel):
        value=(root/rel).read_text();hashes[('firered/' if root==donor else 'emerald/')+rel]=hashlib.sha256(value.encode()).hexdigest();return value
    def write(rel,value):
        p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value);changed.append(rel)
    def current(rel):
        p=out/rel;return p.read_text() if p.exists() else read(base,rel)
    def patch(rel,old,new):
        text=current(rel)
        if new in text:return
        if text.count(old)!=1:raise ValueError(f'{rel}: expected one Tower anchor {old[:70]}')
        write(rel,text.replace(old,new,1))
    source=read(donor,'src/trainer_tower.c')
    sets=read(donor,'src/trainer_tower_sets.c')
    constants=read(donor,'include/constants/trainer_tower.h')
    classes=read(donor,'include/constants/trainers.h')
    types=read(donor,'include/cereader_tool.h')
    # Both engines use the exact same 44-byte BattleTowerPokemon layout.
    strip=lambda t:re.sub(r'\s+','',re.sub(r'/\*.*?\*/|//[^\n]*','',t,flags=re.S))
    struct=lambda t:re.search(r'struct BattleTowerPokemon\s*\{.*?\n};',t,re.S)[0]
    if strip(struct(read(base,'include/global.h')))!=strip(struct(read(donor,'include/pokemon.h'))):
        raise ValueError('BattleTowerPokemon source ABI differs')
    # Roster speech uses semantic EC_WORD symbols. Audit that every used word
    # exists and retains its packed group/index in the shared native dictionary.
    ec_used=sorted(set(re.findall(r'\bEC_WORD_\w+',sets)))
    def ec_values(root):
        text=read(root,'include/constants/easy_chat.h')
        defs=dict(re.findall(r'^#define\s+(\w+)\s+([^\n]+)',text,re.M))
        cache={}
        def resolve(name):
            if name in cache:return cache[name]
            def value(node):
                if isinstance(node,ast.Constant):return node.value
                if isinstance(node,ast.Name):return resolve(node.id)
                if isinstance(node,ast.BinOp):
                    a,b=value(node.left),value(node.right)
                    for op,fn in ((ast.LShift,lambda:a<<b),(ast.RShift,lambda:a>>b),(ast.BitOr,lambda:a|b),(ast.Add,lambda:a+b),(ast.Sub,lambda:a-b)):
                        if isinstance(node.op,op):return fn()
                raise ValueError('unsupported Easy Chat constant '+name)
            cache[name]=value(ast.parse(defs[name].split('//')[0].strip(),mode='eval').body)
            return cache[name]
        return {name:resolve(name) for name in ec_used}
    donor_ec,native_ec=ec_values(donor),ec_values(base)
    ec_differences={n:{'firered':donor_ec[n],'emerald':native_ec[n]} for n in ec_used if donor_ec[n]!=native_ec[n]}
    if ec_differences:raise ValueError('Tower Easy Chat dictionary packed-word ABI differs: '+str(ec_differences))
    original_strings=read(donor,'src/strings.c')
    for name,value in (('Single','SINGLE'),('Double','DOUBLE'),('Knockout','KNOCKOUT'),('Mixed','MIXED')):
        if f'const u8 gOtherText_{name}[] = _("{value}");' not in original_strings:
            raise ValueError('Tower challenge label changed: '+name)
    names={n:'FR_'+n for n in re.findall(r'^#define\s+(\w+)',constants,re.M) if not n.startswith('GUARD_')}
    facility=definitions(classes,'FACILITY_CLASS_')
    names.update({n:'FR_'+n for n in facility})
    for text in (source,sets,types):
        for n in re.findall(r'\b(?:VAR_\w+|TRAINER_CLASS_\w+|TRAINER_PIC_\w+|TRAINER_ENCOUNTER_MUSIC_\w+|MUS_\w+|ITEM_\w+)\b',text):names[n]='FR_'+n
        for n in re.findall(r'\bLAYOUT_\w+',text):names[n]='LAYOUT_FR_'+n[7:]
        for n in re.findall(r'\bOBJ_EVENT_GFX_\w+',text):names[n]='OBJ_EVENT_GFX_FR_'+n[14:]
    public=set(re.findall(r'(?m)^(?:void|u8) (\w+)\(',source))
    names.update({n:'FR_'+n for n in public})
    names.update({n:'FR_'+n for n in ('TrainerTowerTrainer','TrainerTowerFloor','EReaderTrainerTowerSetSubstruct','EReaderTrainerTowerSet','gTrainerTowerLocalHeader','gTrainerTowerFloors','gFacilityClassToTrainerClass','gFacilityClassToPicIndex','gTrainerTowerChallengeTypeTexts','gText_TimeBoard','gText_XMinYZSec','ReadTrainerTowerAndValidate','CEReaderTool_LoadTrainerTower')})
    names.update({'SetVBlankCounter1Ptr':'FR_SetTowerTimer','DisableVBlankCounter1':'FR_DisableTowerTimer','LoadStdWindowFrameGfx':'FR_LoadStdWindowFrameGfx','BattleSetup_GetBattleTowerBattleTransition':'FR_GetTowerBattleTransition'})
    constant_header='#ifndef GUARD_WHOLE_GAME_FR_TRAINER_TOWER_CONSTANTS_H\n#define GUARD_WHOLE_GAME_FR_TRAINER_TOWER_CONSTANTS_H\n'+rewrite(re.sub(r'^#(?:ifndef|define) GUARD_.*|^#endif.*','',constants,flags=re.M),names)+'\n#define FR_NUM_TOWER_CHALLENGE_TYPES 4\n'+''.join(f'#define FR_{n} {v}\n' for n,v in facility.items())+'#endif\n'
    write('include/constants/whole_game_fr_trainer_tower.h',constant_header)
    # Tower records are supplied once by world_services; only transient e-card
    # roster types live here. Retail FR's e-reader selector is source-disabled.
    tower_types=types[types.index('struct TrainerTowerTrainer'):types.index('bool32 ValidateTrainerTowerData')]
    tower_types=rewrite(tower_types,names)
    runtime_header='''#ifndef GUARD_WHOLE_GAME_FR_TRAINER_TOWER_H
#define GUARD_WHOLE_GAME_FR_TRAINER_TOWER_H
#include "global.h"
#include "pokemon.h"
#include "pokemon_storage_system.h"
#include "whole_game_world_services.h"
#include "constants/whole_game_fr_trainer_tower.h"
'''+tower_types+'\n'+rewrite(read(donor,'include/trainer_tower.h').split('#define GUARD_TRAINER_TOWER_H',1)[1].rsplit('#endif',1)[0],names)+'''
void FR_CallTrainerTowerFunc(void);
bool8 FR_IsTrainerTowerBattle(void);
void FR_TrainerTowerVBlank(void);
void FR_SetTowerTimer(u32 *counter);
void FR_DisableTowerTimer(void);
void FR_LoadStdWindowFrameGfx(void);
extern const u8 FR_BattleScript_TrainerTowerWon[];
extern const u8 FR_BattleScript_TrainerTowerLost[];
#endif
'''
    write('include/whole_game_fr_trainer_tower.h',runtime_header)
    source=re.sub(r'^#include[^\n]*\n','',source,flags=re.M)
    source=rewrite(source,names)
    source=source.replace('gSaveBlock1Ptr->trainerTower','WholeGameFR_GetTrainerTowerRecords()').replace('gSaveBlock1Ptr->towerChallengeId','(*WholeGameFR_GetTowerChallengeIdPtr())')
    source=source.replace('NUM_TOWER_CHALLENGE_TYPES','FR_NUM_TOWER_CHALLENGE_TYPES')
    # Object graphics are namespaced u16 IDs in the combined cartridge.
    source=source.replace('u8 objGfx;', 'u16 objGfx;').replace('u8 objGfx1;', 'u16 objGfx1;').replace('u8 objGfx2;', 'u16 objGfx2;').replace('u8 trainerGfx1, trainerGfx2, facilityClass;', 'u16 trainerGfx1, trainerGfx2;\n    u8 facilityClass;')
    source=source.replace('gBattleTypeFlags = BATTLE_TYPE_TRAINER | BATTLE_TYPE_TRAINER_TOWER;', 'sFRTowerBattle = TRUE;\n    gBattleTypeFlags = BATTLE_TYPE_TRAINER;')
    source=source.replace('sTrainerEncounterMusicLUT[i].facilityClass == FR_gFacilityClassToTrainerClass[facilityClass]', 'sTrainerEncounterMusicLUT[i].facilityClass == FR_gFacilityClassToTrainerClass[facilityClass] - 66')
    source=source.replace('    SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);','    sFRTowerBattle = FALSE;\n    SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);')
    # Original retail FR returns FALSE here; preserve that exact source stub.
    ce=read(donor,'src/cereader_tool.c')
    selector=source_function(ce,'ReadTrainerTowerAndValidate')
    if not re.search(r'\{\s*// Stubbed out\. Populated in Emerald\s*return FALSE;\s*}',selector):raise ValueError('retail e-reader policy changed')
    source=source.replace('        FR_CEReaderTool_LoadTrainerTower(&sTrainerTowerState->data);', '        FR_CEReaderTool_LoadTrainerTower(&sTrainerTowerState->data);')
    # Keep read/validation source closure. It performs no special-sector writes;
    # the source-disabled selector never requests external data in retail FR.
    ce_parts=[]
    for n in ('ValidateTrainerTowerTrainer','ValidateTrainerTowerData','CEReaderTool_LoadTrainerTower_r','CEReaderTool_LoadTrainerTower','ReadTrainerTowerAndValidate'):
        ce_parts.append(source_function(ce,n))
    ce_symbols=dict(names);ce_symbols.update({n:'FR_'+n for n in ('ValidateTrainerTowerTrainer','ValidateTrainerTowerData','CEReaderTool_LoadTrainerTower_r')})
    ce_code=rewrite('\n\n'.join(ce_parts),ce_symbols)
    ce_code=ce_code.replace('SECTOR_ID_TRAINER_TOWER_1','30').replace('SECTOR_ID_TRAINER_TOWER_2','31')
    prelude='''#include "global.h"
#include "bg.h"
#include "window.h"
#include "text.h"
#include "strings.h"
#include "string_util.h"
#include "malloc.h"
#include "task.h"
#include "sound.h"
#include "main.h"
#include "util.h"
#include "event_data.h"
#include "easy_chat.h"
#include "battle_setup.h"
#include "battle_transition.h"
#include "battle.h"
#include "battle_main.h"
#include "battle_util.h"
#include "overworld.h"
#include "item.h"
#include "menu.h"
#include "save.h"
#include "constants/items.h"
#include "constants/songs.h"
#include "constants/layouts.h"
#include "constants/trainers.h"
#include "constants/event_objects.h"
#include "constants/firered_event_objects.h"
#include "whole_game_state.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_fr_trainer_tower.h"
#define SEC30_SIZE (offsetof(struct FR_EReaderTrainerTowerSet, floors[4]))
#define SEC31_SIZE (sizeof(struct FR_EReaderTrainerTowerSet) - SEC30_SIZE)
static EWRAM_DATA bool8 sFRTowerBattle = FALSE;
static EWRAM_DATA u8 sFRTowerTimerIndex = 255;
static u8 FR_GetTowerBattleTransition(void);
'''
    # Lookups retain donor facility indices but point to imported source graphics
    # and trainer classes, rather than Emerald's distinct facility roster.
    lookup=read(donor,'src/data/pokemon/trainer_class_lookups.h')
    tables=''
    for n in ('gFacilityClassToPicIndex','gFacilityClassToTrainerClass'):
        table='const u8 '+n+'[] = {\n'+body(lookup,n)+'};\n'
        table_symbols=dict(names)
        for token in re.findall(r'\b(?:TRAINER_PIC_|TRAINER_CLASS_|FACILITY_CLASS_)\w+',table):table_symbols[token]='FR_'+token
        tables+=rewrite(table,table_symbols)
    # The exact donor text literals are retained; native font/window machinery
    # is a shared renderer, while donor frame graphics are a UI provider.
    texts='''const u8 FR_gText_TimeBoard[] = _("TIME BOARD");
const u8 FR_gText_XMinYZSec[] = _("{STR_VAR_1}MIN. {STR_VAR_2}.{STR_VAR_3}SEC.");
static const u8 sFRTowerSingle[] = _("SINGLE");
static const u8 sFRTowerDouble[] = _("DOUBLE");
static const u8 sFRTowerKnockout[] = _("KNOCKOUT");
static const u8 sFRTowerMixed[] = _("MIXED");
const u8 *const FR_gTrainerTowerChallengeTypeTexts[4] = {sFRTowerSingle,sFRTowerDouble,sFRTowerKnockout,sFRTowerMixed};
'''
    timer='''
bool8 FR_IsTrainerTowerBattle(void)
{
    return sFRTowerBattle;
}
void FR_SetTowerTimer(u32 *counter)
{
    u8 i;
    sFRTowerTimerIndex = 255;
    for (i=0; i<4; i++)
        if (counter == &WholeGameFR_GetTrainerTowerRecords()[i].timer)
            sFRTowerTimerIndex = i;
}
void FR_DisableTowerTimer(void)
{
    sFRTowerTimerIndex = 255;
}
void FR_TrainerTowerVBlank(void)
{
    if (sFRTowerTimerIndex < 4)
        WholeGameFR_GetTrainerTowerRecords()[sFRTowerTimerIndex].timer++;
}

'''
    transition_source=read(donor,'src/battle_setup.c')
    level_sum=source_function(transition_source,'GetSumOfPlayerPartyLevel').replace('GetSumOfPlayerPartyLevel','FR_GetSumOfPlayerPartyLevel')
    transition=source_function(transition_source,'BattleSetup_GetBattleTowerBattleTransition').replace('BattleSetup_GetBattleTowerBattleTransition','FR_GetTowerBattleTransition').replace('GetSumOfPlayerPartyLevel','FR_GetSumOfPlayerPartyLevel')
    timer+='\n'+level_sum+'\nstatic '+transition+'\n'
    write('src/firered_trainer_tower.c',prelude+tables+texts+ce_code+'\n'+source+timer)
    sets=re.sub(r'^#include[^\n]*\n','',sets,flags=re.M)
    sets=rewrite(sets,names).replace('NUM_TOWER_CHALLENGE_TYPES','FR_NUM_TOWER_CHALLENGE_TYPES')
    write('src/firered_trainer_tower_sets.c','#include "whole_game_fr_trainer_tower.h"\n#include "constants/easy_chat.h"\n#include "constants/moves.h"\n#include "constants/trainers.h"\n#include "constants/items.h"\n#include "text.h"\n'+sets)
    # Engine hooks preserve Tower's custom roster, identity and no-exp/reward
    # rules using a separate mode predicate; native Factory/Frontier bits stay
    # unchanged, and no Trainer Hill roster/record services are invoked.
    include='#include "whole_game_fr_trainer_tower.h"\n'
    engine_files=('src/battle_main.c','src/battle_util2.c','src/battle_controller_opponent.c','src/battle_message.c','src/battle_ai_script_commands.c','src/battle_script_commands.c','src/main.c')
    for rel in engine_files:
        text=current(rel)
        if include not in text:text=text.replace('#include "global.h"\n','#include "global.h"\n'+include,1)
        # Only grouped common-engine exclusions involving native Trainer Hill;
        # specific trainer identity/result providers below remain donor-native.
        if rel in ('src/battle_main.c','src/battle_ai_script_commands.c','src/battle_script_commands.c'):
            pattern=r'gBattleTypeFlags\s*&\s*\([^()]*BATTLE_TYPE_TRAINER_HILL[^()]*\)'
            text=re.sub(pattern,lambda m:'(FR_IsTrainerTowerBattle() || ('+m[0]+'))',text)
        if rel=='src/battle_util2.c':
            text=text.replace('void AllocateBattleResources(void)\n{','void AllocateBattleResources(void)\n{\n    if (FR_IsTrainerTowerBattle())\n        FR_InitTrainerTowerBattleStruct();',1)
            text=text.replace('void FreeBattleResources(void)\n{','void FreeBattleResources(void)\n{\n    if (FR_IsTrainerTowerBattle())\n        FR_FreeTrainerTowerBattleStruct();',1)
        elif rel=='src/battle_controller_opponent.c':
            old='    else if (gTrainerBattleOpponent_A == TRAINER_FRONTIER_BRAIN)'
            text=text.replace(old,'    else if (FR_IsTrainerTowerBattle())\n        trainerPicId = FR_GetTrainerTowerTrainerFrontSpriteId();\n'+old)
        elif rel=='src/battle_message.c':
            for index in (1,2):
                cases={f'B_TXT_TRAINER{index}_CLASS':f'toCpy = gTrainerClassNames[FR_GetTrainerTowerOpponentClass()];',f'B_TXT_TRAINER{index}_NAME':'FR_GetTrainerTowerOpponentName(text); toCpy = text;',f'B_TXT_TRAINER{index}_LOSE_TEXT':f'FR_GetTrainerTowerOpponentLoseText(gStringVar4, {index-1}); toCpy = gStringVar4;',f'B_TXT_TRAINER{index}_WIN_TEXT':f'FR_GetTrainerTowerOpponentWinText(gStringVar4, {index-1}); toCpy = gStringVar4;'}
                for case,action in cases.items():
                    pattern=r'(case '+case+r':[^\n]*\n)'
                    text,count=re.subn(pattern,lambda m:m[0]+'                if (FR_IsTrainerTowerBattle()) { '+action+' break; }\n',text,count=1)
                    if count!=1:raise ValueError('missing battle text Tower case '+case)
        elif rel=='src/battle_main.c':
            # Specialize donor win/loss scripts; no money/whiteout generic flow.
            win=source_function(text,'HandleEndTurn_BattleWon')
            pos=win.index('    if (gBattleTypeFlags &')
            win=win[:pos]+'''    if (FR_IsTrainerTowerBattle())
    {
        BattleStopLowHpSound();
        PlayBGM(FR_MUS_VICTORY_TRAINER);
        gBattlescriptCurrInstr = FR_BattleScript_TrainerTowerWon;
    }
    else '''+win[pos:].lstrip()
            text=text.replace(source_function(text,'HandleEndTurn_BattleWon'),win,1)
            lost=source_function(text,'HandleEndTurn_BattleLost')
            # A Tower loss recalls opponents and prints original win speeches.
            lost=lost.replace('\n{','\n{\n    if (FR_IsTrainerTowerBattle())\n    {\n        gCurrentActionFuncId = 0;\n        gBattlescriptCurrInstr = FR_BattleScript_TrainerTowerLost;\n        gBattleMainFunc = HandleEndTurn_FinishBattle;\n        return;\n    }',1)
            text=text.replace(source_function(text,'HandleEndTurn_BattleLost'),lost,1)
        elif rel=='src/battle_script_commands.c':
            # Native Emerald lacks retail FR's recall-mask Various operation.
            # Allocate a noncolliding Various subcommand; retain its exact body.
            fr_commands=read(donor,'src/battle_script_commands.c')
            recall=fr_commands[fr_commands.index('    case VARIOUS_GET_BATTLERS_FOR_RECALL:'):fr_commands.index('    case VARIOUS_RETURN_OPPONENT_MON1:')]
            recall=recall.replace('VARIOUS_GET_BATTLERS_FOR_RECALL','VARIOUS_FR_TOWER_GET_BATTLERS_FOR_RECALL')
            needle='    case VARIOUS_RETURN_OPPONENT_MON1:'
            if text.count(needle)!=1:raise ValueError('missing native Tower recall insertion')
            text=text.replace(needle,recall+needle,1)
            text=text.replace('if (gBattleTypeFlags & BATTLE_TYPE_TRAINER_HILL','if (FR_IsTrainerTowerBattle() || gBattleTypeFlags & BATTLE_TYPE_TRAINER_HILL')
        elif rel=='src/main.c':
            text=text.replace('    gMain.vblankCounter1++;','    gMain.vblankCounter1++;\n    FR_TrainerTowerVBlank();',1)
        write(rel,text)
    various_header=current('include/constants/battle_script_commands.h')
    if re.search(r'^#define\s+VARIOUS_\w+\s+27\s*$',various_header,re.M):
        raise ValueError('Various subcommand 27 already allocated')
    various_header=various_header.replace('#endif // GUARD_CONSTANTS_BATTLE_SCRIPT_COMMANDS_H','#define VARIOUS_FR_TOWER_GET_BATTLERS_FOR_RECALL 27\n\n#endif // GUARD_CONSTANTS_BATTLE_SCRIPT_COMMANDS_H')
    write('include/constants/battle_script_commands.h',various_header)
    scripts=read(donor,'data/battle_scripts_1.s')
    won=scripts[scripts.index('BattleScript_BattleTowerTrainerBattleWon::'):scripts.index('BattleScript_SmokeBallEscape::')]
    won=won.replace('\tjumpifnotbattletype BATTLE_TYPE_TRAINER_TOWER, BattleScript_BattleTowerEtcTrainerBattleWonSkipText\n','')
    lost=scripts[scripts.index('BattleScript_BattleTowerLost::'):scripts.index('BattleScript_LinkBattleWonOrLost::')]
    labels=set(re.findall(r'(?m)^(\w+):',won+lost))
    label_map={n:'FR_'+n for n in labels};label_map['BattleScript_BattleTowerTrainerBattleWon']='FR_BattleScript_TrainerTowerWon';label_map['BattleScript_BattleTowerLost']='FR_BattleScript_TrainerTowerLost'
    script=rewrite(won+lost,label_map)
    script=script.replace('\tgetbattlersforrecall','\tvarious BS_ATTACKER, VARIOUS_FR_TOWER_GET_BATTLERS_FOR_RECALL').replace('\treturnopponentmon1toball\n','\treturnopponentmon1toball BS_ATTACKER\n').replace('\treturnopponentmon2toball\n','\treturnopponentmon2toball BS_ATTACKER\n')
    write('data/whole_game_trainer_tower_battle.inc',script)
    root=current('data/battle_scripts_1.s')
    entry='\n.include "data/whole_game_trainer_tower_battle.inc"\n'
    if entry not in root:write('data/battle_scripts_1.s',root+entry)
    providers=[{'name':n,'target':'FR_'+n,'status':'ported-source-qualification-pending','source':'src/firered_trainer_tower.c'} for n in sorted(public)]
    report={'schema':'single-rom-trainer-tower/v1','build_ready':True,'status':'source-staged-qualification-pending','providers':providers,'source_hashes':hashes,'files':changed,'counts':{'dispatcher_functions':21,'audited_easy_chat_words':len(ec_used),'challenge_types':4,'floors_per_challenge':8,'source_floor_definitions':len(re.findall(r'static const struct TrainerTowerFloor',read(donor,'src/trainer_tower_sets.c')))},'saved_abi':'world_services FR_TrainerTower[4] (48 bytes) + saved u32 challenge ID; native encryption key rekeyed by world_services','mode_abi':'separate FR_IsTrainerTowerBattle predicate; no BATTLE_TYPE_FACTORY/TOWER bit reuse','original_disabled_feature':{'function':'ReadTrainerTowerAndValidate','source':'pokefirered/src/cereader_tool.c','verified_body':'source-original retail stub return FALSE; external e-reader set selection disabled by donor source'},'integration_requirements':['world_services saved records/accessors/rekey/newgame initialization','native_ui FR_LoadStdWindowFrameGfx original donor window frame graphics','shared native EasyChat renderer with audited source-identical packed word IDs','coordinator source compilation and ordinary-input Tower campaign qualification'],'blockers':[],'transform_wall_seconds':time.monotonic()-started,'rom_build_seconds':None,'gameplay_qualification':'not-run'}
    if report_dir:
        folder=Path(report_dir);folder.mkdir(parents=True,exist_ok=True);(folder/'trainer-tower-ledger.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
