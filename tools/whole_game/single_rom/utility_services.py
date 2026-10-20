"""Source-owned FireRed utility services on the unified native save/party engine."""
from __future__ import annotations
import hashlib
import json
import re
import shutil
import time
from pathlib import Path
from .native_services import functions, masked
from .scripts import rewrite_tokens
from .world_assets import namespaced

SHARED = ('LoadPlayerBag','LoadPlayerParty','SavePlayerParty','IsEnoughForCostInVar0x8005','SubtractMoneyFromVar0x8005')
ROOTS = ('BackupHelpContext','RestoreHelpContext','Script_SetHelpContext','SetHelpContextForMap','HelpSystem_Disable','HelpSystem_Enable','DisableMsgBoxWalkaway','SetWalkingIntoSignVars','Field_AskSaveTheGame','Script_HasEnoughBerryPowder','Script_TakeBerryPowder','PrintPlayerBerryPowderAmount','ShowBattleRecords','ShowEasyChatMessage','ShowEasyChatScreen')


def stage_utility_services(base, donor, out, report_dir=None):
    started=time.perf_counter()
    base,donor,out=map(lambda p:Path(p).resolve(),(base,donor,out))
    if any(out==p or p in out.parents for p in (base,donor)):
        raise ValueError('utility output must be isolated from canonical source')
    changed,pins,providers=[],{},[]
    def read(root,rel):
        data=(root/rel).read_text();pins[('donor/' if root==donor else 'staged/')+rel]=hashlib.sha256(data.encode()).hexdigest();return data
    def write(rel,text):
        target=out/rel
        for root in (base,donor):
            if root in target.resolve().parents or (target.exists() and (root/rel).exists() and target.samefile(root/rel)):
                raise ValueError('utility output aliases canonical source')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text);changed.append(rel)
    def once(text,old,new):
        if text.count(old)!=1:raise ValueError('unsupported utility source anchor '+old[:90])
        return text.replace(old,new,1)
    def extract(rel,names):
        text=read(donor,rel);index={f.name:f for f in functions(text,rel)}
        return '\n\n'.join(index[n].source for n in names)
    # Explicit parent policy: unified native items capacity 42, remaining native
    # pockets retain their larger capacities. The save runtime owns final sizeof.
    rel='include/constants/global.h';text=read(out,rel)
    match=re.search(r'(#define BAG_ITEMS_COUNT\s+)(\d+)',text)
    if not match or int(match[2]) not in (30,42):raise ValueError('unsupported native item capacity')
    write(rel,text[:match.start(2)]+'42'+text[match.end(2):])
    sources={name:read(donor,'src/'+name+'.c') for name in ('help_system','help_system_util','berry_powder','battle_records','easy_chat','easy_chat_2','easy_chat_3')}
    mapping={}
    for text in sources.values():
        mapping.update({f.name:'FR_'+f.name for f in functions(text,'')})
        mapping.update({n:'FR_'+n for n in re.findall(r'\b(?:s[A-Z]\w*|gHelp\w*|gDisableHelp\w*|HelpSystem\w*|gEasyChat\w*|EasyChat\w*)\b',masked(text))})
        for enum in re.findall(r'enum\s*(?:\w+)?\s*\{(.*?)\}',masked(text),re.S):
            mapping.update({n:'FR_'+n for n in re.findall(r'(?:^|,)\s*([A-Z_]\w*)',enum)})
        mapping.update({n:'FR_'+n for n in re.findall(r'^#define ([A-Z_]\w*)',text,re.M)})
        for token in set(re.findall(r'\b[A-Za-z_]\w*',masked(text))):
            if token.startswith(('FLAG_','VAR_','MAP_','SE_','MUS_','ITEM_')) and token not in ('MAP_GROUP','MAP_NUM','MAP_UNDEFINED') and not token.startswith('MAP_TYPE_'):
                mapping[token]=namespaced(token)
    easy_constants=read(donor,'include/constants/easy_chat.h')
    easy_header=read(donor,'include/easy_chat.h')
    mapping.update({n:'FR_'+n for n in re.findall(r'^#define\s+(\w+)',easy_constants,re.M)})
    mapping.update({n:'FR_'+n for n in re.findall(r'\bEasyChat\w*',easy_header)})
    write('include/constants/whole_game_fr_easy_chat.h',rewrite_tokens(easy_constants,mapping))
    easy_header=easy_header.replace('"constants/easy_chat.h"','"constants/whole_game_fr_easy_chat.h"')
    write('include/whole_game_fr_easy_chat.h',rewrite_tokens(easy_header,mapping).replace('GUARD_EASY_CHAT_H','GUARD_WHOLE_GAME_FR_EASY_CHAT_H'))
    for path in sorted((donor/'src/data/easy_chat').glob('*.h')):
        text=read(donor,str(path.relative_to(donor)))
        mapping.update({n:'FR_'+n for n in re.findall(r'\b(?:gEasyChat\w*|s[A-Z]\w*)',masked(text))})
    for path in sorted((donor/'src/data/easy_chat').glob('*.h')):
        text=rewrite_tokens(read(donor,str(path.relative_to(donor))),mapping)
        text=text.replace('"easy_chat.h"','"whole_game_fr_easy_chat.h"')
        write('src/data/firered_util/easy_chat/'+path.name,text)
    context=read(donor,'include/constants/help_system.h')
    mapping.update({n:'FR_'+n for n in re.findall(r'^#define\s+(\w+)',context,re.M)})
    mapping.update({'MAP_UNDEFINED':'MAP_UNDEFINED','gHelpContextIdBackup':'FR_gHelpContextIdBackup','gHelpSystemEnabled':'FR_gHelpSystemEnabled','gHelpSystemToggleWithRButtonDisabled':'FR_gHelpSystemToggleWithRButtonDisabled','QL_IS_PLAYBACK_STATE':'FR_QL_IS_PLAYBACK_STATE','GetLastTextColor':'WholeGameGetLastTextColor','gGlyphInfo':'FR_gGlyphInfo','DecompressGlyph_Small':'FR_DecompressGlyph_Small','DecompressGlyph_Normal':'FR_DecompressGlyph_Normal','DecompressGlyph_Female':'FR_DecompressGlyph_Female','JOY_REPT':'JOY_REPEAT','FONT_SMALL':'FR_FONT_SMALL','FONT_NORMAL':'FR_FONT_NORMAL','FONT_FEMALE':'FR_FONT_FEMALE','OPTIONS_BUTTON_MODE_HELP':'OPTIONS_BUTTON_MODE_NORMAL','IsCurMapPokeCenter':'FR_IsCurMapPokeCenter','LoadStdWindowGfx':'FR_LoadStdWindowGfx','GetTextWindowPalette':'FR_GetTextWindowPalette','QL_AvoidDisplay':'FR_QL_AvoidDisplay','QL_DestroyAbortedDisplay':'FR_QL_DestroyAbortedDisplay','PrintTrainerTowerRecords':'FR_PrintTrainerTowerRecords','GetQuestionnaireWordsPtr':'FR_GetQuestionnaireWordsPtr','DMA3_16BIT':'0','EXT_CTRL_CODE_SKIP':'EXT_CTRL_CODE_SKIP_TO','SAVE_STATUS_INVALID':'SAVE_STATUS_CORRUPT','FLAG_GET_SEEN':'FLAG_GET_SEEN','FONT_NORMAL_COPY_1':'FR_FONT_NORMAL_COPY_1','GetKantoPokedexCount':'GetKantoPokedexCount','IsUpdateLinkStateCBActive':'IsOverworldLinkActive','LoadUserWindowGfx':'LoadUserWindowBorderGfx','malloc':'Alloc','gKeypadIconTiles':'FR_gKeypadIconTiles'})
    write('include/constants/whole_game_fr_help_system.h',rewrite_tokens(context,mapping))
    header=read(donor,'include/help_system.h').replace('#include "constants/help_system.h"','#include "constants/whole_game_fr_help_system.h"')
    header=rewrite_tokens(header,mapping).replace('GUARD_HELP_SYSTEM_H','GUARD_WHOLE_GAME_FR_HELP_SYSTEM_H')
    header+='\nvoid FR_Script_SetHelpContext(void);\nvoid FR_BackupHelpContext(void);\nvoid FR_RestoreHelpContext(void);\n'
    write('include/whole_game_fr_help_system.h',header)
    common='\n'.join('#include "'+h+'"' for h in ('global.h','bg.h','palette.h','gpu_regs.h','dma3.h','malloc.h','sound.h','text.h','sprite.h','window.h','blit.h','string_util.h','main.h','menu.h','menu_helpers.h','decompress.h','constants/rgb.h','whole_game_fr_help_system.h','constants/whole_game_fr_state.h','constants/firered_quest_log.h'))+'\n'
    # Shared host text color state and exact donor glyph planes/width tables.
    text_source=read(donor,'src/text.c')
    glyph_names=('DecompressGlyph_Small','DecompressGlyph_Normal','DecompressGlyph_Female')
    glyph_functions=extract('src/text.c',glyph_names)
    font_rows=re.findall(r'static const (?:u8|u16) sFont\w+\[\]\s*=\s*(?:INCBIN[^;]*;|\{.*?\};)',text_source,re.S)
    font_map={n:'FR_'+n for n in re.findall(r'\bsFont\w+', '\n'.join(font_rows))}
    glyph_map={**mapping,**font_map}
    glyph='struct FR_GlyphInfo {u8 pixels[0x80]; u8 width; u8 height;};\nextern struct FR_GlyphInfo FR_gGlyphInfo;\nextern const u8 FR_gKeypadIconTiles[];\nu8 WholeGameGetLastTextColor(u8);\nvoid FR_DecompressGlyph_Small(u16,bool32);\nvoid FR_DecompressGlyph_Normal(u16,bool32);\nvoid FR_DecompressGlyph_Female(u16,bool32);\n'
    write('include/whole_game_fr_help_glyphs.h','#ifndef WG_FR_HELP_GLYPHS\n#define WG_FR_HELP_GLYPHS\n#include "global.h"\n'+glyph+'\n#endif\n')
    glyph_text=common+'#include "whole_game_fr_help_glyphs.h"\nstruct FR_GlyphInfo FR_gGlyphInfo;\nconst u8 FR_gKeypadIconTiles[] = INCBIN_U8("graphics/firered_util/fonts/keypad_icons.4bpp");\n'+rewrite_tokens('\n'.join(font_rows)+'\n'+glyph_functions,glyph_map)
    glyph_text=glyph_text.replace('"graphics/fonts/','"graphics/firered_util/fonts/')
    write('src/firered_native/utility_help_glyphs.c',glyph_text)
    # String constants remain private to the provider units; script Help_Text
    # labels are supplied once by the full scripts import.
    needed=set(re.findall(r'\b(?:gText_\w+|gString_\w+|gOtherText_\w+|gEasyChatGroupName_\w+)','\n'.join(sources.values())))
    string_source=read(donor,'src/strings.c')+'\n'+read(donor,'src/keyboard_text.c');string_rows=[]
    for name in sorted(needed):
        match=re.search(r'const u8 '+name+r'\[\]\s*=\s*_\("(?:\\.|[^"\\])*"\);',string_source)
        if match:
            mapping[name]='FR_'+name;string_rows.append('static '+rewrite_tokens(match[0],mapping))
    graphics_source=read(donor,'src/graphics.c')
    gfx_rows=[]
    for row in re.findall(r'const (?:u8|u16|u32) gEasyChat\w+\[\] = INCBIN[^;]+;',graphics_source):
        row='static '+rewrite_tokens(row,mapping)
        gfx_rows.append(row.replace('\"graphics/easy_chat/','\"graphics/firered_util/easy_chat/'))
    string_rows += gfx_rows
    help_texts=sorted(set(re.findall(r'\bHelp_Text_\w+',sources['help_system'])))
    mapping.update({n:'FR_'+n for n in help_texts})
    write('src/firered_native/utility_text.h','\n'.join(string_rows)+'\n'+'\n'.join('extern const u8 FR_'+n+'[];' for n in help_texts)+'\n')
    # For battle-record UI, retain the complete root's source closure, not the
    # unrelated donor link mutation routines that target a different trainer card.
    record_index={f.name:f for f in functions(sources['battle_records'],'src/battle_records.c')}
    selected={'ShowBattleRecords'}
    while True:
        # A callback passed by pointer is part of the root's executable closure.
        more={n for f in selected for n in re.findall(r'\b(\w+)\b',masked(record_index[f].source)) if n in record_index}
        if more<=selected:break
        selected|=more
    record=sources['battle_records']
    for f in sorted(record_index.values(),key=lambda f:f.start,reverse=True):
        if f.name not in selected:record=record[:f.start]+record[f.end:]
    sources['battle_records']=record
    for name,text in sources.items():
        if name == 'easy_chat':
            # Both games use the same 33 trendy words and bit indices. Keep the
            # existing host save field and bound its initialization to 5 bytes.
            text=text.replace('gSaveBlock1Ptr->additionalPhrases','gSaveBlock1Ptr->unlockedTrendySayings')
            text,count=re.subn(r'#ifndef UBFIX\n    // BUG: This is supposed to clear 64 bits,.*?\n#endif',
                               '    for (i = 0; i < ARRAY_COUNT(gSaveBlock1Ptr->unlockedTrendySayings); i++)\n        gSaveBlock1Ptr->unlockedTrendySayings[i] = 0;',text,flags=re.S)
            if count != 1:raise ValueError('unsupported trendy-saying initialization')
        if name == 'battle_records':
            # The record layout is identical; Emerald persists it in SaveBlock1.
            text=text.replace('gSaveBlock2Ptr->linkBattleRecords','gSaveBlock1Ptr->linkBattleRecords')
        text=re.sub(r'^#include "(?:gflib|help_system|quest_log|save_location|trainer_tower)\.h"\n','',text,flags=re.M)
        text=text.replace('#include "event_scripts.h"','').replace('#include "strings.h"','').replace('#include "keyboard_text.h"','')
        text=rewrite_tokens(text,mapping)
        text=text.replace('.label','.name')
        if name in ('help_system','help_system_util'):
            text=text.replace('.index','.id')
        if name == 'help_system_util':
            # These three call sites use donor font IDs as numeric literals.
            for old,new in (('FR_HelpSystemRenderText(5,','FR_HelpSystemRenderText(FR_FONT_FEMALE,'),
                            ('FR_HelpSystemRenderText(0,','FR_HelpSystemRenderText(FR_FONT_SMALL,'),
                            ('FR_HelpSystemRenderText(2,','FR_HelpSystemRenderText(FR_FONT_NORMAL,')):
                text=text.replace(old,new)
        text=text.replace('#include \"easy_chat.h\"','#include \"whole_game_fr_easy_chat.h\"')
        text=text.replace('#include \"constants/easy_chat.h\"','#include \"constants/whole_game_fr_easy_chat.h\"')
        text=text.replace('\"data/easy_chat/','\"../data/firered_util/easy_chat/')
        text=text.replace('#include \"new_menu_helpers.h\"','#include \"menu_helpers.h\"')
        text=text.replace('"graphics/help_system/','"graphics/firered_util/help_system/').replace('"graphics/battle_records/','"graphics/firered_util/battle_records/')
        text=text.replace('template = SetWindowTemplateFields(0, 1, 1, 8, 3, 15, 32);','SetWindowTemplateFields(&template, 0, 1, 1, 8, 3, 15, 32);')
        if name == 'easy_chat_3':
            # Reuse Emerald's seven-argument menu helper, which owns the same
            # yes/no window/input lifecycle and preserves donor font/position.
            text=once(text,'CreateYesNoMenu(&FR_sEasyChatYesNoWindowTemplate, FR_FONT_NORMAL_COPY_1, 0, 2, 0x001, 14, initialCursorPos);',
                      'WholeGameCreateYesNoMenuAtPos(&FR_sEasyChatYesNoWindowTemplate, FR_FONT_NORMAL_COPY_1, 0, 2, 0x001, 14, initialCursorPos);')
        preamble=common+'#include "whole_game_fr_help_glyphs.h"\n#include "whole_game_fr_quest_log.h"\n#include "constants/whole_game_fr_encounters.h"\n#include "constants/whole_game_fr_scripts.h"\n#include "constants/characters.h"\n#include "overworld.h"\n#include "pokedex.h"\n#include "save.h"\n#include "text_window.h"\n#include "utility_text.h"\n'
        preamble+='bool8 FR_QL_AvoidDisplay(void (*)(void));\nvoid FR_QL_DestroyAbortedDisplay(void);\nu16 *FR_GetQuestionnaireWordsPtr(void);\nbool8 FR_IsCurMapPokeCenter(void);\nconst u16 *FR_GetTextWindowPalette(u8);\nvoid FR_LoadStdWindowGfx(u8,u16,u16);\nvoid FR_PrintTrainerTowerRecords(void);\n'
        if name == 'help_system':
            preamble+='u16 GetKantoPokedexCount(u8);\n'
        if name == 'easy_chat_3':
            preamble+='void WholeGameCreateYesNoMenuAtPos(const struct WindowTemplate *,u8,u8,u8,u16,u8,u8);\n'
        write('src/firered_native/utility_'+name+'.c',preamble+text)
    # Expose the host helper within its owning menu translation unit so its
    # static yes/no window state remains shared with the input/cleanup path.
    rel='src/menu.c';text=read(out,rel)
    text=text.replace('CreateYesNoMenuAtPos(', 'WholeGameCreateYesNoMenuAtPos(')
    text=once(text,'static void WholeGameCreateYesNoMenuAtPos(', 'void WholeGameCreateYesNoMenuAtPos(')
    write(rel,text)
    # Native text helper exposes its existing exact color backing to donor glyphs.
    rel='src/text.c';text=read(out,rel)
    text+='\nu8 WholeGameGetLastTextColor(u8 type)\n{\n    return GetLastTextColor(type);\n}\n';write(rel,text)
    # Help takes ownership of the actual callback suspension/resume lifecycle.
    rel='src/main.c';text=read(out,rel)
    text=text.replace('#include "global.h"','#include "global.h"\n#include "whole_game_state.h"\n#include "whole_game_fr_help_system.h"',1)
    text=once(text,'static void CallCallbacks(void)\n{','static void CallCallbacks(void)\n{\n    if (WholeGame_IsKanto() && FR_RunHelpSystemCallback())\n        return;')
    write(rel,text)
    assets=[]
    for folder in ('help_system','fonts','battle_records','easy_chat'):
        for path in sorted((donor/'graphics'/folder).rglob('*')):
            if path.is_file():
                rel='graphics/firered_util/'+str(path.relative_to(donor/'graphics'));target=out/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target);changed.append(rel);assets.append(rel)
    # Preserve source font conversion formats rather than substituting host glyphs.
    for path in sorted((donor/'tools/gbagfx').iterdir()):
        if path.is_file() and (path.suffix in ('.c','.h') or path.name=='Makefile'):
            write('tools/firered_gbagfx/'+path.name,read(donor,str(path.relative_to(donor))))
    rules=[]
    for font,extension in re.findall(r'\$\(FONTGFXDIR\)/(\w+)\.(hwlatfont|fwlatfont|fwjpnfont):',read(donor,'graphics_file_rules.mk')):
        path='graphics/firered_util/fonts/'+font
        rules.append(path+'.'+extension+': '+path+'.png tools/firered_gbagfx/gbagfx\n\ttools/firered_gbagfx/gbagfx $< $@\n')
    write('firered_utility_assets.mk','tools/firered_gbagfx/gbagfx: $(wildcard tools/firered_gbagfx/*.[ch])\n\t$(MAKE) -C tools/firered_gbagfx\n\n'+'\n'.join(rules))
    rel='Makefile';text=read(out,rel);write(rel,text+'\ninclude firered_utility_assets.mk\n')
    # Original script message cancellation state; consumer is wired below.
    script_names=('DisableMsgBoxWalkaway','EnableMsgBoxWalkaway','IsMsgBoxWalkawayDisabled','SetWalkingIntoSignVars','ClearMsgBoxCancelableState','CanWalkAwayToCancelMsgBox')
    script_map={n:'FR_'+n for n in script_names};script_map.update({n:'FR_'+n for n in ('sMsgBoxWalkawayDisabled','sMsgBoxIsCancelable','gWalkAwayFromSignInhibitTimer')})
    script=extract('src/script.c',script_names)
    script_header='\n'.join(re.sub(r'\{.*',';',rewrite_tokens(f.source[:f.source.index('{')].strip(),script_map),flags=re.S) for f in functions(script,'') )
    declarations='\n'.join(rewrite_tokens(f.source[:f.source.index('{')].strip(),script_map)+';' for f in functions(script,''))
    write('include/whole_game_fr_utility.h','#ifndef WG_FR_UTILITY\n#define WG_FR_UTILITY\n#include "global.h"\n'+declarations+'\nextern u8 FR_gWalkAwayFromSignInhibitTimer;\nvoid FR_Field_AskSaveTheGame(void);\nvoid WholeGameRestoreUtilitySaveHelp(void);\n#endif\n')
    write('src/firered_native/utility_script.c','#include "global.h"\nEWRAM_DATA static bool8 FR_sMsgBoxWalkawayDisabled=FALSE;\nEWRAM_DATA static bool8 FR_sMsgBoxIsCancelable=FALSE;\nEWRAM_DATA u8 FR_gWalkAwayFromSignInhibitTimer=0;\n'+rewrite_tokens(script,script_map)+'\n')
    # Save uses the complete native unified-save engine and its exact terminal
    # result/cancel/error task. Restore Help on that same terminal callback.
    save=common+'#include "start_menu.h"\n#include "whole_game_fr_utility.h"\nstatic bool8 sRestoreHelpAfterSave=FALSE;\nvoid FR_Field_AskSaveTheGame(void)\n{\n FR_BackupHelpContext();\n FR_SetHelpContext(FR_HELPCONTEXT_SAVE);\n sRestoreHelpAfterSave=TRUE;\n SaveGame();\n}\nvoid WholeGameRestoreUtilitySaveHelp(void)\n{\n if(sRestoreHelpAfterSave) {sRestoreHelpAfterSave=FALSE;FR_RestoreHelpContext();}\n}\n'
    write('src/firered_native/utility_save.c',save)
    rel='src/start_menu.c';text=read(out,rel);index={f.name:f for f in functions(text,rel)};f=index['SaveGameTask'];part=f.source
    part=once(part,'    ScriptContext_Enable();','    ScriptContext_Enable();\n    WholeGameRestoreUtilitySaveHelp();')
    text=text[:f.start]+part+text[f.end:];write(rel,'#include "whole_game_fr_utility.h"\n'+text)
    for name in ROOTS:
        owner='utility_services'
        providers.append({'name':name,'target':'FR_'+name,'status':'source-ported','stage':owner,'translationUnit':'src/firered_native/utility_*','bindings':['donor source state and callbacks; native unified save/party backing where explicitly adapted']})
    report={'schema':'whole-game-utility-services-v1','status':'blocked','buildEligible':False,'semantic_coverage_complete':False,'providers':providers,'sharedResolverRoots':list(SHARED),'changedFiles':sorted(set(changed)),'source_sha256':pins,'coverage':{'fullHelpFunctions':sum(len(functions(t,'')) for n,t in sources.items() if n.startswith('help_system')),'helpTextLabels':len(help_texts),'assets':len(assets),'bagItemCapacity':42,'bagSaveBlockGrowthBytes':48},'unresolved':[{'id':'utility-consumers-pending','reason':'Help enable/map-context, exact sign walkaway consumer and Easy Chat source adapters must be connected before source admission.'},{'id':'utility-save-capacity','reason':'Actual final sizeof/streamed-save capacity guard required after 48byte bag growth; no fit claim.'},{'id':'utility-native-qualification','reason':'Affected translation units, font conversion and real screen/save lifecycle require qualification.'}],'stage_wall_seconds':time.perf_counter()-started}
    if report_dir:
        path=Path(report_dir);path.mkdir(parents=True,exist_ok=True);(path/'utility-services.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    return report
