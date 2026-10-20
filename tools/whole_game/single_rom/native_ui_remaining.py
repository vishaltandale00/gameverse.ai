"""Residual campaign UI providers, isolated from the frozen initial UI stage.

Original typed source is retained for donor-specific state/IDs. Shared complete
native menu engines are bound only with explicit state/callback responsibilities.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import json
import re
import shutil
import time
from .native_services import functions, index_sources, masked
from .scripts import rewrite_tokens

ROOTS = ('AnimatePcTurnOff', 'AnimatePcTurnOn', 'CapeBrinkGetMoveToTeachLeadPokemon',
         'ChangeBoxPokemonNickname', 'ChangePokemonNickname', 'ChooseMonForMoveRelearner',
         'ChooseMonForMoveTutor', 'DisplayBerryPowderVendorMenu', 'DoPicboxCancel',
         'GetNumMovesSelectedMonHas', 'HasLearnedAllMovesFromCapeBrinkTutor',
         'MoveDeleterForgetMove', 'NameRaterWasNicknameChanged', 'RemoveBerryPowderVendorMenu',
         'Script_ClearHeldMovement', 'SelectMoveDeleterMove', 'SetUpTrainerMovement',
         'ShowDiploma', 'TeachMoveRelearnerMove')


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def normalized(text):
    return re.sub(r'\s+', '', masked(text))


def _without_owned_block(text, begin, end):
    if begin not in text:
        return text
    if end not in text:
        raise ValueError('legacy unterminated staging block; use fresh source tree: ' + begin)
    start = text.index(begin)
    stop = text.index(end, start) + len(end)
    return text[:start] + text[stop:]


def stage_native_ui_remaining(base: Path, donor: Path, output: Path, report_dir: Path | None = None) -> dict:
    started = time.monotonic()
    base, donor, output = (Path(p).resolve() for p in (base, donor, output))
    if any(output == p or output.is_relative_to(p) for p in (base, donor)):
        raise ValueError('residual UI requires an isolated staged tree')
    sources, index = index_sources(donor)
    _, host_index = index_sources(base)
    def source(name):
        found = index.get(name, [])
        if len(found) != 1: raise ValueError('ambiguous donor source: ' + name)
        return found[0]
    def host(name):
        found = host_index.get(name, [])
        if len(found) != 1: raise ValueError('ambiguous host source: ' + name)
        return found[0]
    def write(relative, content):
        path = output / relative; path.parent.mkdir(parents=True, exist_ok=True);path.write_text(content)
    providers, patches, units, assets = [], [], [], []
    def row(name, relative, bindings, **extra):
        f=source(name)
        providers.append({'name':name,'target':'FR_'+name,'status':'source-ported','source':f.key,
                          'sourceSha256':digest(f.source),'translationUnit':relative,'bindings':bindings,
                          'blockers':['Integrated native link and cartridge input/save/UI lifecycle remain unqualified.'],**extra})
    selected = ('AnimatePcTurnOff','AnimatePcTurnOn','Task_AnimatePcTurnOn','PcTurnOnUpdateMetatileId',
                'CapeBrinkGetMoveToTeachLeadPokemon','HasLearnedAllMovesFromCapeBrinkTutor',
                'ChangeBoxPokemonNickname','ChangeBoxPokemonNickname_CB','ChangePokemonNickname',
                'ChangePokemonNickname_CB','NameRaterWasNicknameChanged','SetUpTrainerMovement')
    rename={name:('FR_'+name if name in ROOTS else 'FR_UIR_'+name) for name in selected}
    rename.update({'GetLeadMonIndex':'FR_GetLeadMonIndex','NELEMS':'ARRAY_COUNT',
                   'sCapeBrinkCompatibleSpecies':'FR_UIR_sCapeBrinkCompatibleSpecies'})
    names = set(re.findall(r'\b(?:FLAG_|MOVETUTOR_|METATILE_)\w+', '\n'.join(source(n).source for n in selected)))
    literals={}
    for filename in ('moves.h','metatile_labels.h'):
        literals.update(dict(re.findall(r'^#define (\w+)\s+(0x[\da-fA-F]+|\d+)\b',
                                       (donor/'include/constants'/filename).read_text(),re.M)))
    for name in names:
        if name.startswith('FLAG_'):rename[name]='FR_'+name
        elif name in literals:rename[name]=literals[name]
        else:raise ValueError('unresolved residual constant: '+name)
    # Keep original Kanto species ordering and all friendship/once-only gates.
    table=re.search(r'static const u8 sCapeBrinkCompatibleSpecies\[\]\s*=\s*\{[^}]+\};',sources['src/field_specials.c'])
    if not table:raise ValueError('CapeBrink species table missing')
    bodies=[rewrite_tokens(source(name).source,rename) for name in selected]
    includes=('global.h','fieldmap.h','field_camera.h','field_player_avatar.h','event_object_movement.h',
              'field_control_avatar.h','pokemon.h','pokemon_storage_system.h','naming_screen.h','overworld.h',
              'event_data.h','string_util.h','data.h','task.h','constants/moves.h','constants/whole_game_fr_state.h')
    preamble='\n'.join('#include "'+name+'"' for name in includes)
    definitions='\n#define tState data[0]\n#define tTimer data[1]\nextern u8 FR_GetLeadMonIndex(void);\n'
    prototypes='\n'.join(body.split('{',1)[0].strip()+';' for body in bodies)
    unit=preamble+definitions+rewrite_tokens(table[0],rename)+'\n'+prototypes+'\n\n'+'\n\n'.join(bodies)+'\n'
    relative='src/firered_native/ui_remaining.c';write(relative,unit);units.append({'path':relative,'sha256':digest(unit)})
    for name in selected:
        if name in ROOTS:row(name,relative,['original donor PC metatile/task and naming callback source',
                                          'native typed party/box/name storage and oldnickname gStringVar3',
                                          'Kanto CapeBrink tutor IDs/flags/species/friendship gates'])
    # Additional families append exact source into their actual native owners.
    context={'base':base,'donor':donor,'output':output,'sources':sources,'index':index,'host_index':host_index,
             'source':source,'host':host,'write':write,'row':row,'units':units,'patches':patches,'assets':assets}
    _stage_party(context)
    _stage_picbox(context)
    _stage_diploma(context)
    _stage_shared(context)
    _stage_popup(context)
    _rebind_ereader(context)
    owned={r['name'] for r in providers}
    unresolved=[{'name':name,'owner':'map_utilities','ownership':'delegated-provider', 'reason':'complete berry_powder.c owns shared vendor window/powder state'} for name in ROOTS if name not in owned]
    declarations=[]
    for entry in providers:
        declaration=source(entry['name']).source.split('{',1)[0].strip()
        declarations.append(rewrite_tokens(declaration,{entry['name']:entry['target']})+';')
    write('include/firered_native_ui_remaining.h','#ifndef GUARD_FR_UI_REMAINING_H\n#define GUARD_FR_UI_REMAINING_H\n#include "global.h"\n'+'\n'.join(declarations)+'\n#endif\n')
    report={'schema':'single-rom-native-ui-remaining/1','status':'source-staged-external-dependencies', 'ownedSourceProvidersComplete':True,
            'buildEligible':not unresolved,'providers':providers,'unresolved':unresolved,
            'translationUnits':units,'patchedSources':patches,'assets':assets,
            'qualification':{'sourceClosure':not unresolved,'objectCompile':None,'link':None,'runtime':None},
            'timing':{'operation':'native-ui-remaining-source','wallSeconds':time.monotonic()-started,
                      'queueSeconds':None,'buildSeconds':None,'baselineSeconds':None}}
    write('firered-native-source/native-ui-remaining-ledger.json',json.dumps(report,indent=2,sort_keys=True)+'\n')
    if report_dir:
        Path(report_dir).mkdir(parents=True,exist_ok=True)
        (Path(report_dir)/'native-ui-remaining-ledger.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    return report


def _stage_party(c):
    donor,output,base=c['donor'],c['output'],c['base']
    path=output/'src/party_menu.c'
    native=path.read_text() if path.exists() else (base/'src/party_menu.c').read_text()
    begin='/* BEGIN FR_UI_REMAINING_TUTOR */'
    native=_without_owned_block(native,begin,'/* END FR_UI_REMAINING_TUTOR */')
    rename={'ChooseMonForMoveTutor':'FR_ChooseMonForMoveTutor','GetTutorMove':'FR_UIR_GetTutorMove',
            'CanLearnTutorMove':'FR_UIR_CanLearnTutorMove','sTutorMoves':'FR_UIR_sTutorMoves',
            'sTutorLearnsets':'FR_UIR_sTutorLearnsets','TUTOR':'FR_UIR_TUTOR','TUTOR_':'FR_UIR_TUTOR_'}
    defines=[]
    for name,value in re.findall(r'^#define (TUTOR_MOVE_\w+)\s+(\d+)\b',(donor/'include/constants/party_menu.h').read_text(),re.M):
        rename[name]='FR_UIR_'+name;defines.append('#define FR_UIR_'+name+' '+value)
    data=rewrite_tokens((donor/'src/data/pokemon/tutor_learnsets.h').read_text(),rename)
    c['write']('src/data/firered_ui_remaining/tutor_learnsets.h',data)
    helpers=[rewrite_tokens(c['source'](name).source,rename) for name in ('GetTutorMove','CanLearnTutorMove')]
    # Route the actual shared party learning engine through donor move IDs and
    # eligibility only while this donor tutor operation owns the active menu.
    header='''
static bool8 FR_UIR_TutorActive = FALSE;
static u16 FR_UIR_GetTutorMove(u8 tutor);
static bool8 FR_UIR_CanLearnTutorMove(u16 species, u8 tutor);
'''
    if header not in native:native=native.replace('#include "global.h"','#include "global.h"\n'+header,1)
    for name,call in [('GetTutorMove','FR_UIR_GetTutorMove(tutor)'),('CanLearnTutorMove','FR_UIR_CanLearnTutorMove(species, tutor)')]:
        f=[f for f in functions(native,'src/party_menu.c') if f.name==name][0]
        hook='\n    if (FR_UIR_TutorActive)\n        return '+call+';\n'
        if call+';' not in f.source:
            at=f.start+f.source.index('{')+1;native=native[:at]+hook+native[at:]
    f=[f for f in functions(native,'src/party_menu.c') if f.name=='ChooseMonForMoveTutor'][0]
    if 'FR_UIR_TutorActive = FALSE;' not in f.source:
        at=f.start+f.source.index('{')+1;native=native[:at]+'\n    FR_UIR_TutorActive = FALSE;\n'+native[at:]
    choose=rewrite_tokens(c['source']('ChooseMonForMoveTutor').source,{'ChooseMonForMoveTutor':'FR_ChooseMonForMoveTutor',
        'TUTOR_MOVE_COUNT':'FR_UIR_TUTOR_MOVE_COUNT'})
    choose=choose.replace('{','{\n    FR_UIR_TutorActive = TRUE;',1)
    block='\n'+begin+'\n'+'\n'.join(defines)+'\n#include "data/firered_ui_remaining/tutor_learnsets.h"\n'+'\n\n'.join(helpers+[choose])+'\n/* END FR_UI_REMAINING_TUTOR */\n'
    native+=block;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(native)
    c['patches'].append({'path':'src/party_menu.c','sha256':digest(native)})
    c['row']('ChooseMonForMoveTutor','src/party_menu.c',['full native party selection/learning/replacement/cancel/return engine',
         'original 15 donor tutor indices plus three CapeBrink ultimate moves',
         'exact donor species learnsets and selected lead-slot branch; explicit operation ownership'],
         dataSource='src/data/pokemon/tutor_learnsets.h',dataSha256=digest(data))


def _stage_picbox(c):
    path=c['output']/'src/script_menu.c'
    native=path.read_text() if path.exists() else (c['base']/'src/script_menu.c').read_text()
    original=c['source']('PicboxCancel').source
    rename={'PicboxCancel':'FR_UIR_PicboxCancel','Task_ScriptShowMonPic':'Task_PokemonPicWindow',
            'tSpriteId':'data[2]','tState':'data[0]','tWindowId':'data[5]',
            'DestroyScriptMenuWindow':'ClearToTransparentAndRemoveWindow'}
    cleanup=rewrite_tokens(original,rename)
    wrapper=rewrite_tokens(c['source']('DoPicboxCancel').source,{'DoPicboxCancel':'FR_DoPicboxCancel',
                    'FONT_NORMAL':'FR_FONT_NORMAL','PicboxCancel':'FR_UIR_PicboxCancel'})
    begin='/* BEGIN FR_UI_REMAINING_PICBOX */'
    native=_without_owned_block(native,begin,'/* END FR_UI_REMAINING_PICBOX */')
    native+='\n'+begin+'\n'+cleanup+'\n'+wrapper+'\n/* END FR_UI_REMAINING_PICBOX */\n'
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(native)
    c['patches'].append({'path':'src/script_menu.c','sha256':digest(native)})
    c['row']('DoPicboxCancel','src/script_menu.c',['original immediate-cancel state branches target actual native Task_PokemonPicWindow',
         'typed native sprite slot data2/window data5/task state data0',
         'actual sprite resources/window/task destruction rather than asynchronous hide alias'])


def _stage_diploma(c):
    donor,base=c['donor'],c['base'];text=c['sources']['src/diploma.c']
    # Exact fade-from-black return callback, independently compared to native.
    donor_cb=c['source']('CB2_ReturnToFieldFromDiploma').source
    host_cb=c['host']('CB2_ReturnToFieldFadeFromBlack').source
    if normalized(rewrite_tokens(donor_cb,{'CB2_ReturnToFieldFromDiploma':'CB2_ReturnToFieldFadeFromBlack'}))!=normalized(host_cb):
        raise ValueError('diploma native field return callback equivalence changed')
    names={f.name:'FR_UIR_'+f.name for f in functions(text,'src/diploma.c')}
    names['CB2_ShowDiploma']='FR_UIR_CB2_ShowDiploma'
    names.update({name:'FR_UIR_'+name for name in set(re.findall(r'\bs[A-Z]\w+',masked(text)))})
    names.update({'FONT_NORMAL':'FR_FONT_NORMAL','CB2_ReturnToFieldFromDiploma':'CB2_ReturnToFieldFadeFromBlack'})
    text=re.sub(r'^#include[^\n]*\n','',text,flags=re.M)
    strings=(donor/'src/strings.c').read_text();declarations=[]
    for name in sorted(set(re.findall(r'\bgText_\w+',masked(text)))):
        match=re.search(r'const u8 '+name+r'\[\] = _\("[^"\n]*"\);',strings)
        if not match:raise ValueError('diploma donor string missing: '+name)
        names[name]='FR_UIR_'+name;declarations.append(rewrite_tokens(match[0],names))
    text=text.replace('graphics/diploma/','graphics/firered_ui_remaining/diploma/')
    includes=('global.h','malloc.h','bg.h','decompress.h','gpu_regs.h','main.h','menu.h','palette.h',
              'sprite.h','window.h','text.h','dma3.h','sound.h','overworld.h','pokedex.h',
              'scanline_effect.h','dynamic_placeholder_text_util.h','task.h','script.h','constants/rgb.h','constants/sound.h')
    preamble='\n'.join('#include "'+name+'"' for name in includes)+'\n'+'\n'.join(declarations)+'\n'
    unit=preamble+rewrite_tokens(text,names)+'\nextern void FR_QuestLog_CutRecording(void);\n'+rewrite_tokens(c['source']('ShowDiploma').source,names|{'ShowDiploma':'FR_ShowDiploma','QuestLog_CutRecording':'FR_QuestLog_CutRecording'})+'\n'
    relative='src/firered_native/ui_remaining_diploma.c';c['write'](relative,unit);c['units'].append({'path':relative,'sha256':digest(unit)})
    for source in sorted((donor/'graphics/diploma').iterdir()):
        if source.is_file():
            target=c['output']/'graphics/firered_ui_remaining/diploma'/source.name
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
            c['assets'].append({'source':source.relative_to(donor).as_posix(),'target':target.relative_to(c['output']).as_posix(),
                                'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
    c['row']('ShowDiploma',relative,['original donor Kanto/National diploma assets/text/render/input/fanfare/free lifecycle',
         'real shared Pokedex and player name; exact-source verified native fade-from-black field return',
         'actual quest-log CutRecording provider'])


def _stage_shared(c):
    """Explicit native engine adaptors with script-result/callback contracts."""
    output=c['output'];source=c['source'];host=c['host']
    names=('GetNumMovesSelectedMonHas','MoveDeleterForgetMove','ShiftMoveSlot',
           'Script_ClearHeldMovement','ObjectEventClearHeldMovementIfActive','ObjectEventClearHeldMovement')
    # ShiftMoveSlot occurs only in donor party_menu_specials.c. These tiny
    # command bodies keep donor PP bonus and immediate object-effect semantics;
    # all state is accessed through native typed fields/APIs, without casts.
    mapping={name:('FR_'+name if name in ROOTS else 'FR_UIR_'+name) for name in names}
    bodies=[rewrite_tokens(source(name).source,mapping) for name in names]
    summary=host('MoveDeleterChooseMoveToForget')
    bodies.append(rewrite_tokens(summary.source,{'MoveDeleterChooseMoveToForget':'FR_SelectMoveDeleterMove'}))
    teach=host('TeachMoveRelearnerMove')
    # Keep the full existing native relearner engine; it commits the learned
    # move, returns success/cancel in8004 and resumes through the same callback.
    bodies.append('extern void TeachMoveRelearnerMove(void);\nvoid FR_TeachMoveRelearnerMove(void)\n{\n    TeachMoveRelearnerMove();\n}')
    headers=('global.h','pokemon.h','data.h','event_data.h','event_object_movement.h','field_control_avatar.h',
             'pokemon_summary_screen.h','overworld.h','field_screen_effect.h','sprite.h','constants/moves.h','constants/event_object_movement.h')
    preamble='\n'.join('#include "'+name+'"' for name in headers)
    prototypes='\n'.join(b.split('{',1)[0].strip()+';' for b in bodies if not b.startswith('extern '))
    text=preamble+'\n'+prototypes+'\n\n'+'\n\n'.join(bodies)+'\n'
    relative='src/firered_native/ui_remaining_services.c';c['write'](relative,text);c['units'].append({'path':relative,'sha256':digest(text)})
    for name in ('GetNumMovesSelectedMonHas','MoveDeleterForgetMove','Script_ClearHeldMovement'):
        c['row'](name,relative,['original source command bodies and transitive tiny state mutators',
             'native typed party/move/PP bonus fields and selected object/sprite cells',
             'no quest-log behavior omitted from these original command bodies'])
    c['row']('SelectMoveDeleterMove',relative,['full native SUMMARY_MODE_SELECT_MOVE summary engine and field callback',
         'party pointer/selected index/count preserved; selected move8005 in0..3, cancel4',
         'native entry is the original Emerald move-deleter screen (HM deletion supported)'],
         hostSource=summary.key,hostSourceSha256=digest(summary.source))
    c['row']('TeachMoveRelearnerMove',relative,['full native relearner commit/cancel/replacement/return engine',
         'same8004 selected party input and boolean success/cancel output; caller owns mushroom payment',
         'both source wait tasks set FieldCB_ContinueScriptHandleMusic before screen callback'],
         hostSource=teach.key,hostSourceSha256=digest(teach.source),
         policy='shared-native-party-move-relearner-engine; native artwork is intentional')
    path=output/'src/party_menu.c';native=path.read_text()
    callbacks=[]
    for name in ('Task_ChooseMonForMoveRelearner','CB2_ChooseMonForMoveRelearner'):
        text=host(name).source
        text=rewrite_tokens(text,{'Task_ChooseMonForMoveRelearner':'FR_UIR_Task_ChooseMonForMoveRelearner',
                                  'CB2_ChooseMonForMoveRelearner':'FR_UIR_CB2_ChooseMonForMoveRelearner',
                                  'PARTY_NOTHING_CHOSEN':'(PARTY_SIZE + 1)'})
        callbacks.append(text)
    entry=source('ChooseMonForMoveRelearner').source
    entry=entry.replace('    gTasks[taskId].data[0] = PARTY_MENU_TYPE_MOVE_RELEARNER;\n','')
    entry=rewrite_tokens(entry,{'ChooseMonForMoveRelearner':'FR_ChooseMonForMoveRelearner',
                                'Task_ChoosePartyMon':'FR_UIR_Task_ChooseMonForMoveRelearner'})
    block='\n/* BEGIN FR_UI_REMAINING_RELEARNER */\n'+'\n'.join(b.split('{',1)[0].strip()+';' for b in callbacks)+'\n'+'\n\n'.join(callbacks+[entry])+'\n'
    native=_without_owned_block(native,'/* BEGIN FR_UI_REMAINING_RELEARNER */','/* END FR_UI_REMAINING_RELEARNER */')
    generic = '''
static void FR_UIR_BufferGenericMonSelection(void)
{
    gSpecialVar_0x8004 = GetCursorSelectionMonId();
    if (gSpecialVar_0x8004 >= PARTY_SIZE)
        gSpecialVar_0x8004 = PARTY_SIZE + 1;
    gFieldCallback2 = CB2_FadeFromPartyMenu;
    SetMainCallback2(CB2_ReturnToField);
}
void FR_ChoosePartyMonByMenuType(u8 menuType)
{
    gFieldCallback2 = CB2_FadeFromPartyMenu;
    InitPartyMenu(menuType, PARTY_LAYOUT_SINGLE, PARTY_ACTION_CHOOSE_AND_CLOSE, FALSE,
                  PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput,
                  menuType == PARTY_MENU_TYPE_MOVE_RELEARNER
                    ? FR_UIR_CB2_ChooseMonForMoveRelearner : FR_UIR_BufferGenericMonSelection);
}
'''
    native+=block+generic+'\n/* END FR_UI_REMAINING_RELEARNER */\n';path.write_text(native)
    c['patches'].append({'path':'src/party_menu.c','sha256':digest(native)})
    c['row']('ChoosePartyMonByMenuType','src/party_menu.c',['typed native party engine; source caller CHOOSE_SINGLE_MON3 maps native CHOOSE_MON3',
        'actual native selection callback writes donor8004 and normalizes donorcancel7 before fieldfade/resume',
        'MOVE_RELEARNER7 additionally computes8005'])
    c['row']('ChooseMonForMoveRelearner','src/party_menu.c',['source donor field lock/fade/task entry to full native chooser',
         'actual native selection/relearnable-count callback8004/8005 and field-fade/script resume',
         'cancel normalized from native255 to original donor SLOT_CANCEL7 before script resumes'])


def _rebind_ereader(c):
    path=c['output']/'src/firered_native/ui_text_buffers.c'
    if not path.exists():
        c['patches'].append({'path':'src/firered_native/ui_text_buffers.c', 'status':'requires-prior-native-ui-stage'})
        return
    text=path.read_text()
    old='gSaveBlock2Ptr->frontier.ereaderTrainer'
    count=text.count(old)
    if count:
        text=text.replace(old,'(*FR_GetEReaderTrainer())')
        text=text.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_fr_battle_services.h"',1)
        path.write_text(text)
    if 'FR_GetEReaderTrainer()' not in text:
        raise ValueError('eReader trainer UI source contract changed')
    c['patches'].append({'path':'src/firered_native/ui_text_buffers.c','sha256':digest(text),
          'responsibility':'dedicated exact188B FireRed source eReader saved bank for name/greeting',
          'replacedNativeFrontierReads':count, 'dependency':'battle_services.FR_GetEReaderTrainer'})


def _stage_popup(c):
    donor,base=c['donor'],c['base']
    text=(donor/'src/map_name_popup.c').read_text()
    text=re.sub(r'^#include[^\n]*\n','',text,flags=re.M)
    names={f.name:'FR_UIR_'+f.name for f in functions('src/map_name_popup.c',text)}
    for n in ('ShowMapNamePopup','DismissMapNamePopup','IsMapNamePopupTaskActive'):
        names[n]='FR_'+n
    for n in ('LoadStdWindowTiles','DrawTextBorderOuter','rbox_fill_rectangle'):
        names[n]='FR_UIR_'+n
    names.update({'GetTextWindowPalette':'FR_GetTextWindowPalette','GetMapName':'FR_GetMapName',
                  'FONT_NORMAL':'FR_FONT_NORMAL','FlagGet':'FR_FlagGet',
                  'FLAG_DONT_SHOW_MAP_NAME_POPUP':'FR_FLAG_DONT_SHOW_MAP_NAME_POPUP',
                  'gText_Rooftop2':'FR_UIR_gText_Rooftop2',
                  'QL_IS_PLAYBACK_STATE':'(FR_gQuestLogState == 2 || FR_gQuestLogState == 3)'})
    # Emerald MapHeader omits donor floorNum. Preserve every donor map's actual
    # floor/section metadata in typed per-map tables, indexed by merged group.
    groups=json.loads((donor/'data/maps/map_groups.json').read_text())
    base_groups=json.loads((base/'data/maps/map_groups.json').read_text())
    offset=len(base_groups['group_order']); tables=[]; ptrs=[]
    sections=json.loads((donor/'src/data/region_map/region_map_sections.json').read_text())['map_sections']
    section_ids={v['id']:i for i,v in enumerate(sections)}
    for i,group in enumerate(groups['group_order']):
        values=[]
        for mapname in groups[group]:
            data=json.loads((donor/'data/maps'/mapname/'map.json').read_text())
            values.append('{%d,%d}'%(data.get('floor_number',0),section_ids[data['region_map_section']]))
        tables.append('static const struct FR_UIR_MapMetadata FR_UIR_MapGroup%d[] = {%s};'%(i,','.join(values)))
        ptrs.append('FR_UIR_MapGroup%d'%i)
    metadata='struct FR_UIR_MapMetadata {s8 floor; u8 section;};\n'+'\n'.join(tables)+'\n'
    metadata+='static const struct FR_UIR_MapMetadata *const FR_UIR_MapMetadataGroups[] = {'+','.join(ptrs)+'};\n'
    metadata+='static const struct FR_UIR_MapMetadata *FR_UIR_GetMapMetadata(void) { return &FR_UIR_MapMetadataGroups[gSaveBlock1Ptr->location.mapGroup - %d][gSaveBlock1Ptr->location.mapNum]; }\n'%offset
    text=text.replace('gMapHeader.floorNum','FR_UIR_GetMapMetadata()->floor').replace('gMapHeader.regionMapSectionId','FR_UIR_GetMapMetadata()->section')
    helpers='\n'.join(rewrite_tokens(c['source'](n).source,names) for n in ('LoadStdWindowTiles','DrawTextBorderOuter','rbox_fill_rectangle'))
    helpers=helpers.replace('gStdTextWindow_Gfx','FR_gStdTextWindow_Gfx')
    headers=('global.h','bg.h','window.h','palette.h','gpu_regs.h','dma3.h','task.h','text.h','string_util.h',
             'event_data.h','firered_native_ui.h','firered_region_map.h','constants/whole_game_fr_state.h')
    preamble='\n'.join('#include "'+n+'"' for n in headers)+'\nextern const u16 FR_gStdTextWindow_Gfx[];\nextern bool8 FR_FlagGet(u16);\nstatic const u8 FR_UIR_gText_Rooftop2[] = _("ROOFTOP");\n'
    unit=preamble+metadata+helpers+'\n'+rewrite_tokens(text,names)
    relative='src/firered_native/ui_remaining_popup.c';c['write'](relative,unit)
    c['units'].append({'path':relative,'sha256':digest(unit)})
    for n in ('ShowMapNamePopup','DismissMapNamePopup','IsMapNamePopupTaskActive'):
        c['row'](n,relative,['original complete window/task/requeue/dismiss/DMA cleanup lifecycle',
            'source faded/unfaded palette parameter, FireRed flags and actual QuestLog playback suppression',
            'all source floor/map-section metadata indexed by actual merged map group and map number'])
