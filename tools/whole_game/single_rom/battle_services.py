"""Retail FireRed special battle services on the shared Emerald battle engine."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .encounters import source_function,rewrite

HEADER='''#ifndef GUARD_WHOLE_GAME_FR_BATTLE_SERVICES_H
#define GUARD_WHOLE_GAME_FR_BATTLE_SERVICES_H
#include "global.h"
#include "pokemon.h"
struct FR_BattleTowerEReaderTrainer
{
    u8 unk0, trainerClass;
    u16 winStreak;
    u8 name[8], trainerId[4];
    u16 greeting[6], farewellPlayerLost[6], farewellPlayerWon[6];
    struct BattleTowerPokemon party[3];
    u32 checksum;
};
typedef char FR_EReaderRecordSize[(sizeof(struct FR_BattleTowerEReaderTrainer)==188)?1:-1];
struct FR_BattleTowerEReaderTrainer *FR_GetEReaderTrainer(void);
bool8 WholeGame_IsFireRedOldManTutorialBattle(void);
bool8 WholeGame_IsFireRedGhostBattle(void);
bool8 WholeGame_IsFireRedGhostWithoutScope(void);
bool8 WholeGame_IsFireRedGhostWithScope(void);
bool8 WholeGame_IsFireRedLegendaryBattle(void);
bool8 FR_IsEReaderTrainerBattle(void);
void FR_SetGhostBattleMode(u8 mode);
void FR_ClearSpecialBattleModes(void);
void FR_StartOldManTutorialBattle(void);
void FR_StartMarowakBattle(void);
void FR_StartLegendaryBattle(void);
void FR_StartSpecialBattle(void);
void FR_EndTrainerApproach(void);
void FR_PlayTrainerEncounterMusic(void);
void FR_ShowTrainerIntroSpeech(void);
void FR_ShowTrainerCantBattleSpeech(void);
void FR_StartRematchBattle(void);
u16 FR_Script_HasTrainerBeenFought(void);
void FR_SetBattledTrainerFlag(void);
void FR_SetEReaderTrainerGfxId(void);
void FR_ValidateEReaderTrainer(void);
void FR_BufferEReaderTrainerGreeting(void);
u8 FR_GetEreaderTrainerClassId(void);
u8 FR_GetEreaderTrainerFrontSpriteId(void);
void FR_CopyEReaderTrainerName5(u8 *dest);
extern const u8 FR_gText_Ghost[];
extern const u8 FR_BattleScript_EReaderWon[];
extern const u8 FR_BattleScript_EReaderLost[];
void *WholeGameFR_GetEReaderTrainer(void);
#endif
'''


def stage_battle_services(base,donor,out,report_dir=None):
    start=time.monotonic();base,donor,out=map(lambda p:Path(p).resolve(),(base,donor,out))
    if any(out==p or p in out.parents or out in p.parents for p in (base,donor)):raise ValueError('isolated staged tree required')
    if (out/'src/firered_battle_services.c').exists():raise ValueError('battle services already staged')
    hashes={};files=[]
    def read(root,rel):
        text=(root/rel).read_text();hashes[('firered/' if root==donor else 'emerald/')+rel]=hashlib.sha256(text.encode()).hexdigest();return text
    def current(rel):return (out/rel).read_text() if (out/rel).exists() else read(base,rel)
    def write(rel,value):
        p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value);files.append(rel)
    setup=current('src/battle_setup.c');fr_setup=read(donor,'src/battle_setup.c');tower=read(donor,'src/battle_tower.c')
    write('include/whole_game_fr_battle_services.h',HEADER)
    common_include='#include "whole_game_fr_battle_services.h"\n'
    setup=setup.replace('#include "global.h"\n','#include "global.h"\n'+common_include,1)
    mapping={'StartOldManTutorialBattle':'FR_StartOldManTutorialBattle','StartMarowakBattle':'FR_StartMarowakBattle','StartLegendaryBattle':'FR_StartLegendaryBattle','CB2_EndMarowakBattle':'FR_CB2_EndMarowakBattle','CreateMaleMon':'CreateMaleMon','gText_Ghost':'FR_gText_Ghost','IncrementGameStat':'FR_IncrementGameStat','GAME_STAT_TOTAL_BATTLES':'FR_GAME_STAT_TOTAL_BATTLES','GAME_STAT_WILD_BATTLES':'FR_GAME_STAT_WILD_BATTLES'}
    for n in set(re.findall(r'\bMUS_\w+',fr_setup)):mapping[n]='FR_'+n
    old_man=source_function(fr_setup,'StartOldManTutorialBattle')
    old_man=old_man.replace('gMain.savedCallback = CB2_ReturnToFieldContinueScriptPlayMapMusic;','gMain.savedCallback = FR_CB2_EndOldManTutorialBattle;').replace('gBattleTypeFlags = BATTLE_TYPE_OLD_MAN_TUTORIAL;','gBattleTypeFlags = 0;\n    sFROldManBattle = TRUE;')
    ghost=source_function(fr_setup,'StartMarowakBattle')
    ghost=ghost.replace('gBattleTypeFlags = BATTLE_TYPE_GHOST | BATTLE_TYPE_GHOST_UNVEILED;','gBattleTypeFlags = BATTLE_TYPE_LEGENDARY;\n        FR_SetGhostBattleMode(2);').replace('gBattleTypeFlags = BATTLE_TYPE_GHOST;','gBattleTypeFlags = 0;\n        FR_SetGhostBattleMode(1);')
    legendary=source_function(fr_setup,'StartLegendaryBattle')
    legendary=legendary.replace('gBattleTypeFlags = BATTLE_TYPE_LEGENDARY | BATTLE_TYPE_LEGENDARY_FRLG;','gBattleTypeFlags = BATTLE_TYPE_LEGENDARY;\n    sFRLegendaryBattle = TRUE;').replace('gMain.savedCallback = CB2_EndScriptedWildBattle;','gMain.savedCallback = FR_CB2_EndLegendaryBattle;')
    for name,text in (('StartOldManTutorialBattle',old_man),('StartMarowakBattle',ghost),('StartLegendaryBattle',legendary)):
        # Enter through original declaration-safe boundary, before first action.
        needle='    CreateMaleMon' if name=='StartOldManTutorialBattle' else '    LockPlayerFieldControls();'
        text=text.replace(needle,'    FR_ClearSpecialBattleModes();\n'+needle,1)
        if name=='StartOldManTutorialBattle':old_man=text
        elif name=='StartMarowakBattle':ghost=text
        else:legendary=text
    callbacks=source_function(fr_setup,'CB2_EndMarowakBattle')
    callbacks=callbacks.replace('    CpuFill16','    FR_SetGhostBattleMode(0);\n    CpuFill16',1)
    prefix='''
static EWRAM_DATA bool8 sFROldManBattle = FALSE;
static EWRAM_DATA bool8 sFRLegendaryBattle = FALSE;
static EWRAM_DATA u8 sFRGhostMode = 0;
static void FR_CB2_EndMarowakBattle(void);
static void FR_CB2_EndOldManTutorialBattle(void)
{
    sFROldManBattle = FALSE;
    SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
}
static void FR_CB2_EndLegendaryBattle(void)
{
    sFRLegendaryBattle = FALSE;
    CB2_EndScriptedWildBattle();
}
bool8 WholeGame_IsFireRedOldManTutorialBattle(void) {return sFROldManBattle;}
bool8 WholeGame_IsFireRedLegendaryBattle(void) {return sFRLegendaryBattle;}
bool8 WholeGame_IsFireRedGhostBattle(void) {return sFRGhostMode != 0;}
bool8 WholeGame_IsFireRedGhostWithoutScope(void) {return sFRGhostMode == 1;}
bool8 WholeGame_IsFireRedGhostWithScope(void) {return sFRGhostMode == 2;}
void FR_SetGhostBattleMode(u8 mode) {sFRGhostMode = mode;}
void FR_ClearSpecialBattleModes(void)
{
    sFROldManBattle = FALSE;
    sFRLegendaryBattle = FALSE;
    sFRGhostMode = 0;
}
u16 FR_Script_HasTrainerBeenFought(void)
{
    return FlagGet(WholeGame_TrainerFlag(gTrainerBattleOpponent_A));
}
void FR_SetBattledTrainerFlag(void)
{
    FlagSet(WholeGame_TrainerFlag(gTrainerBattleOpponent_A));
}
'''
    # Prefix is appended after native private helpers, preserving their real ABI.
    retail_functions='\n'.join(source_function(fr_setup,n) for n in ('ShowTrainerIntroSpeech','ShowTrainerCantBattleSpeech','StartRematchBattle'))
    mapping.update({n:'FR_'+n for n in ('ShowTrainerIntroSpeech','ShowTrainerCantBattleSpeech','StartRematchBattle')})
    retail_functions=rewrite(retail_functions,mapping)
    retail_functions+='\nvoid FR_PlayTrainerEncounterMusic(void)\n{\n    PlayTrainerEncounterMusic();\n}\n'
    setup+='\n'+prefix+'\n'+retail_functions+'\n'+rewrite(old_man+'\n'+ghost+'\n'+legendary+'\n'+callbacks,mapping)+'\n'
    for inc in ('whole_game_state.h','constants/game_stat.h','item.h'):
        if f'#include "{inc}"' not in setup:setup=setup.replace('#include "global.h"\n',f'#include "global.h"\n#include "{inc}"\n',1)
    write('src/battle_setup.c',setup)
    approach=current('src/trainer_see.c')
    approach+='\nvoid FR_EndTrainerApproach(void)\n{\n    DoTrainerApproach();\n}\n'
    write('src/trainer_see.c',approach)
    # Assert all original executable mentions, including macro arguments. Numeric
    # special slots are also rejected so unnamed calls cannot evade this proof.
    mentions=[];numeric=[];unknown_special=[];census={}
    registry=set(re.findall(r'def_special\s+(\w+)',read(donor,'data/specials.inc')))
    for directory in ('data','asm'):
        for p in sorted((donor/directory).rglob('*')):
            if p.suffix not in ('.s','.inc'):continue
            text=p.read_text();census[str(p.relative_to(donor))]=hashlib.sha256(text.encode()).hexdigest()
            for line_no,line in enumerate(text.splitlines(),1):
                if re.search(r'\bStartSpecialBattle\b',line):mentions.append({'path':str(p.relative_to(donor)),'line':line_no,'source':line})
                special_target=re.match(r'\s*special\s+([^\s@]+)',line) or re.match(r'\s*specialvar\s+[^,]+,\s*([^\s@]+)',line)
                if special_target and special_target[1] not in registry and not special_target[1].startswith('\\'):
                    unknown_special.append({'path':str(p.relative_to(donor)),'line':line_no,'source':line})
                if special_target and re.fullmatch(r'0x[0-9A-Fa-f]+|\d+',special_target[1]):numeric.append({'path':str(p.relative_to(donor)),'line':line_no,'source':line})
    c_mentions=[]
    for p in sorted((donor/'src').rglob('*.c')):
        text=p.read_text();census[str(p.relative_to(donor))]=hashlib.sha256(text.encode()).hexdigest()
        for line_no,line in enumerate(text.splitlines(),1):
            if re.search(r'\bStartSpecialBattle\b',line):c_mentions.append({'path':str(p.relative_to(donor)),'line':line_no,'source':line})
    if c_mentions != [{'path':'src/battle_tower.c','line':895,'source':'void StartSpecialBattle(void)'}]:
        raise ValueError('StartSpecialBattle C callsite proof changed')
    expected='data/maps/SevenIsland_House_Room2/scripts.inc'
    calls=[m for m in mentions if m['path']!='data/specials.inc']
    if len(calls)!=1 or calls[0]['path']!=expected or numeric or unknown_special:raise ValueError('StartSpecialBattle callsite proof changed')
    script=read(donor,expected)
    lineage='\tsetvar VAR_0x8004, 2\n\tsetvar VAR_0x8005, 0\n\tspecial StartSpecialBattle'
    if lineage not in script:raise ValueError('retail e-reader selector lineage changed')
    names={n:'FR_'+n for n in ('BattleTowerEReaderTrainer','ValidateEReaderTrainer','ClearEReaderTrainer','BufferEReaderTrainerGreeting','BufferBattleTowerTrainerMessage','PrintEReaderTrainerFarewellMessage','GetEreaderTrainerClassId','GetEreaderTrainerFrontSpriteId','CopyEReaderTrainerName5','Task_WaitBT','CB2_FinishEReaderBattle','EC_DoesEasyChatStringFitOnLine','gFacilityClassToPicIndex','gFacilityClassToTrainerClass')}
    parts=[]
    for n in ('ClearEReaderTrainer','ValidateEReaderTrainer','GetEreaderTrainerFrontSpriteId','GetEreaderTrainerClassId','CopyEReaderTrainerName5','BufferBattleTowerTrainerMessage','PrintEReaderTrainerFarewellMessage','Task_WaitBT'):
        parts.append(source_function(tower,n))
    # The original actual retail branch, selected by every donor callsite.
    special=source_function(tower,'StartSpecialBattle')
    case2=special[special.index('    case 2: // e-reader trainer battle'):special.rindex('    }')]
    case2=case2[case2.index('\n')+1:case2.rindex('        break;')]
    special='''void FR_StartSpecialBattle(void)
{
    s32 i;
    u8 transition;
    if (gSpecialVar_0x8004 != 2)
    {
        gSpecialVar_Result = 0xFFFF; // typed input-domain failure, never a battle outcome
        return;
    }
    sFREReaderBattle = TRUE;
'''+case2+'}\n'
    trans=source_function(fr_setup,'BattleSetup_GetBattleTowerBattleTransition').replace('BattleSetup_GetBattleTowerBattleTransition','FR_BS_GetTransition').replace('GetSumOfPlayerPartyLevel','FR_BS_GetPlayerLevels')
    levels=source_function(fr_setup,'GetSumOfPlayerPartyLevel').replace('GetSumOfPlayerPartyLevel','FR_BS_GetPlayerLevels')
    special=special.replace('BattleSetup_GetBattleTowerBattleTransition','FR_BS_GetTransition').replace('Task_WaitBT','FR_Task_WaitBT')
    finish='''static void FR_CB2_FinishEReaderBattle(void)
{
    FR_PrintEReaderTrainerFarewellMessage();
    gSpecialVar_Result = gBattleOutcome;
    sFREReaderBattle = FALSE;
    SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
}
'''
    core=rewrite('\n\n'.join(parts),names)+'\n'+special
    core=core.replace('gSaveBlock2Ptr->battleTower.ereaderTrainer','(*FR_GetEReaderTrainer())')
    prelude='''#include "global.h"
#include "malloc.h"
#include "task.h"
#include "string_util.h"
#include "text.h"
#include "event_data.h"
#include "battle.h"
#include "battle_main.h"
#include "battle_setup.h"
#include "battle_transition.h"
#include "overworld.h"
#include "main.h"
#include "field_player_avatar.h"
#include "easy_chat.h"
#include "constants/firered_event_objects.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_fr_battle_services.h"
#include "whole_game_world_services.h"
static EWRAM_DATA bool8 sFREReaderBattle = FALSE;
extern const u8 FR_gFacilityClassToPicIndex[];
extern const u8 FR_gFacilityClassToTrainerClass[];
bool8 FR_EC_DoesEasyChatStringFitOnLine(const u16 *, u8, u8, u16);
static void FR_PrintEReaderTrainerFarewellMessage(void);
static void FR_CB2_FinishEReaderBattle(void);
ALIGNED(4) const u8 FR_gText_Ghost[] = _("GHOST");
struct FR_BattleTowerEReaderTrainer *FR_GetEReaderTrainer(void)
{
    return WholeGameFR_GetEReaderTrainer();
}
bool8 FR_IsEReaderTrainerBattle(void) {return sFREReaderBattle;}
void FR_SetEReaderTrainerGfxId(void)
{
    VarSet(FR_VAR_OBJ_GFX_ID_0, OBJ_EVENT_GFX_FR_YOUNGSTER);
}
'''
    write('src/firered_battle_services.c',prelude+levels+'\nstatic '+trans+'\n'+core+finish)
    # Reuse native_ui's exact donor character-count wrapper when already
    # emitted. A standalone stage can emit the same original source closure.
    easy=current('src/easy_chat.c')
    name='FR_EC_DoesEasyChatStringFitOnLine'
    expected=source_function(read(donor,'src/easy_chat.c'),'EC_DoesEasyChatStringFitOnLine').replace('EC_DoesEasyChatStringFitOnLine',name,1)
    norm=lambda value:re.sub(r'\s+','',re.sub(r'//[^\n]*|/\*.*?\*/','',value,flags=re.S))
    if re.search(r'\bbool8 '+name+r'\(',easy):
        if norm(source_function(easy,name))!=norm(expected):raise ValueError('EasyChat original donor wrap provider differs')
    else:
        write('src/easy_chat.c',easy+'\n/* BEGIN FIRERED_EC_CHAR_WRAP */\n'+expected+'\n')
    # E-reader graphics/name/class resolve the separate FR bank, never the
    # distinct native Frontier card's raw facility-class numbering.
    native_tower=current('src/battle_tower.c')
    native_tower=native_tower.replace('#include "global.h"\n','#include "global.h"\n'+common_include,1)
    for n,call in (('GetEreaderTrainerFrontSpriteId','return FR_GetEreaderTrainerFrontSpriteId();'),('GetEreaderTrainerClassId','return FR_GetEreaderTrainerClassId();'),('GetEreaderTrainerName','FR_CopyEReaderTrainerName5(dst); return;')):
        fn=source_function(native_tower,n)
        fn=fn.replace('\n{','\n{\n    if (FR_IsEReaderTrainerBattle()) { '+call+' }\n    {',1)+'\n}'
        native_tower=native_tower.replace(source_function(native_tower,n),fn,1)
    write('src/battle_tower.c',native_tower)
    # Retail e-reader results differ from Emerald Frontier speech/money flow.
    # Source FR's Tower victory branch skips both Tower-only speeches when its
    # Tower bit is absent; e-reader defeat branches straight to end2.
    battle_scripts=read(donor,'data/battle_scripts_1.s')
    won=battle_scripts[battle_scripts.index('BattleScript_BattleTowerTrainerBattleWon::'):battle_scripts.index('BattleScript_SmokeBallEscape::')]
    head=won[:won.index('\tjumpifnotbattletype BATTLE_TYPE_TRAINER_TOWER')]
    tail=won[won.index('BattleScript_BattleTowerEtcTrainerBattleWonSkipText::'):]
    won=head.replace('BattleScript_BattleTowerTrainerBattleWon','FR_BattleScript_EReaderWon')+'\tpickup\n\tend2\n'
    loss=battle_scripts[battle_scripts.index('BattleScript_EReaderOrSecretBaseTrainerEnd::'):battle_scripts.index('BattleScript_LocalBattleLostPrintTrainersWinText::')]
    loss=loss.replace('BattleScript_EReaderOrSecretBaseTrainerEnd','FR_BattleScript_EReaderLost')
    write('data/whole_game_fr_battle_services.inc',won+loss)
    root_scripts=current('data/battle_scripts_1.s')
    write('data/battle_scripts_1.s',root_scripts+'\n.include "data/whole_game_fr_battle_services.inc"\n')
    main=current('src/battle_main.c')
    main=main.replace('#include "global.h"\n','#include "global.h"\n'+common_include,1)
    for name,script_name in (('HandleEndTurn_BattleWon','FR_BattleScript_EReaderWon'),('HandleEndTurn_BattleLost','FR_BattleScript_EReaderLost')):
        fn=source_function(main,name)
        prefix='\n    if (FR_IsEReaderTrainerBattle())\n    {\n        gCurrentActionFuncId = 0;\n'
        if name=='HandleEndTurn_BattleWon':prefix+='        BattleStopLowHpSound();\n        PlayBGM(FR_MUS_VICTORY_TRAINER);\n'
        prefix+='        gBattlescriptCurrInstr = '+script_name+';\n        gBattleMainFunc = HandleEndTurn_FinishBattle;\n        return;\n    }\n'
        main=main.replace(fn,fn.replace('\n{','\n{'+prefix,1),1)
    write('src/battle_main.c',main)
    ai=current('src/battle_ai_script_commands.c')
    ai=ai.replace('#include "global.h"\n','#include "global.h"\n'+common_include,1)
    needle='    // Choose proper trainer ai scripts.'
    if needle not in ai:raise ValueError('missing AI policy anchor')
    ai=ai.replace(needle,needle+'\n    if (WholeGame_IsFireRedLegendaryBattle())\n    {\n        AI_THINKING_STRUCT->aiFlags = AI_SCRIPT_CHECK_BAD_MOVE | AI_SCRIPT_TRY_TO_FAINT | AI_SCRIPT_CHECK_VIABILITY;\n        return;\n    }',1)
    write('src/battle_ai_script_commands.c',ai)
    write('firered-native-source/battle-services/StartSpecialBattle.original.c',source_function(tower,'StartSpecialBattle'))
    write('firered-native-source/battle-services/selector2-script.inc',script)
    providers=[{'name':n,'target':'FR_'+n,'status':'ported-source-native-check-pending','source':'src/battle_setup.c' if n in ('Script_HasTrainerBeenFought','SetBattledTrainerFlag','StartOldManTutorialBattle','StartMarowakBattle','StartLegendaryBattle','ShowTrainerIntroSpeech','ShowTrainerCantBattleSpeech','StartRematchBattle','PlayTrainerEncounterMusic') else 'src/trainer_see.c' if n=='EndTrainerApproach' else 'src/firered_battle_services.c'} for n in ('Script_HasTrainerBeenFought','SetBattledTrainerFlag','StartOldManTutorialBattle','StartMarowakBattle','StartLegendaryBattle','StartSpecialBattle','SetEReaderTrainerGfxId','ValidateEReaderTrainer','ShowTrainerIntroSpeech','ShowTrainerCantBattleSpeech','StartRematchBattle','PlayTrainerEncounterMusic','EndTrainerApproach')]
    for p in providers:
        if p['name']=='StartSpecialBattle':p['inputDomain']={'gSpecialVar_0x8004':[2],'invalidInputResult':65535,'proof':'all symbolic references + numeric special-slot rejection + uninterrupted setvar lineage','callsites':mentions}
    report={'schema':'single-rom-battle-services/v1','status':'source-staged-qualification-pending','build_ready':True,'providers':providers,'source_hashes':hashes,'files':files,'specialBattleCallsiteProof':{'symbolicMentions':mentions,'cSymbolMentions':c_mentions,'numericSpecialCalls':numeric,'unknownSpecialTargets':unknown_special,'lineage':lineage,'scannedSourceFiles':len(census),'sourceCensusSha256':hashlib.sha256(json.dumps(census,sort_keys=True).encode()).hexdigest(),'inactiveLegacySelectors':[0,1]},'modeABI':{'OldMan':'separate bool; native Wally bit not reused','ghost':'separate 0/1/2 state; native TWO_OPPONENTS bit not reused','legendary':'native LEGENDARY plus separate bool for original FR AI7 policy','eReader':'native EREADER_TRAINER flag plus separate bool; independent saved188-byte donor bank'},'sharedBindingsOwner':'shared_services resolver: GetTrainerBattleMode; native_ui: BufferEReaderTrainerGreeting/Name with independent donor bank','integration_requirements':['world_services separate188-byte saved EReader record and exact storage guard','battle_tutorial original OldMan controller provider','ghost_battle original ghost admission/presentation/capture/attack provider','shared_services source-identical FR_GetTrainerBattleMode provider; native_ui donor-bank greeting/name','coordinator source compile/link and native gameplay'], 'blockers':[],'transform_wall_seconds':time.monotonic()-start,'build_seconds':None,'gameplay':'not-run'}
    if report_dir:
        p=Path(report_dir);p.mkdir(parents=True,exist_ok=True);(p/'battle-services-ledger.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
