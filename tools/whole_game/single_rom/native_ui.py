"""Source-native UI providers; never replace an unported screen with success.

The host string buffers are intentionally shared with its script interpreter.
Donor private callbacks/save structures remain explicit unresolved obligations.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from functools import lru_cache
import re
import time

from .native_services import functions, masked, TOKEN
from .scripts import rewrite_tokens

UI_SYMBOLS = (
    'ShowFieldMessageStringVar4', 'ShowPokemonStorageSystemPC', 'BedroomPC', 'PlayerPC',
    'CreatePCMenu', 'HallOfFamePCBeginFade', 'ShowTownMap', 'BufferMonNickname',
    'BufferBigGuyOrBigGirlString', 'BufferSonOrDaughterString', 'BufferTMHMMoveName',
    'BufferRandomHobbyOrLifestyleString', 'BufferMoveDeleterNicknameAndMove',
    'BufferEReaderTrainerGreeting', 'BufferEReaderTrainerName', 'BufferUnionRoomPlayerName',
    'Script_BufferFanClubTrainerName', 'GetPCBoxToSendMon', 'OpenMuseumFossilPic',
    'CloseMuseumFossilPic', 'DrawSeagallopDestinationMenu', 'GetSelectedSeagallopDestination',
    'GetSeagallopNumber', 'GetElevatorFloor', 'InitElevatorFloorSelectMenuPos',
    'DrawElevatorCurrentFloorWindow', 'CloseElevatorCurrentFloorWindow', 'AnimateElevator',
    'GetQuestLogState', 'QuestLog_CutRecording',
    'QuestLog_StartRecordingInputsAfterDeferredEvent', 'SetUsedPkmnCenterQuestLogEvent',
)
EXTRACT = ('ShowFieldMessageStringVar4', 'BufferMonNickname',
           'BufferBigGuyOrBigGirlString', 'BufferSonOrDaughterString', 'GetSeagallopNumber',
           'BufferMoveDeleterNicknameAndMove', 'BufferTMHMMoveName')


@lru_cache(maxsize=2)
def _source_index(root):
    index = {}
    for path in sorted((root / 'src').glob('*.c')):
        for function in functions(path.read_text(), path.relative_to(root).as_posix()):
            if not function.static:
                index.setdefault(function.name, []).append(function)
    return index


def _function(root, name):
    found = _source_index(root).get(name, [])
    if len(found) != 1:
        raise ValueError(f'expected unique public source function: {name}')
    return found[0]


def _digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _normalized(text):
    return re.sub(r'\s+', '', masked(text))


def stage_native_ui(emerald_source: Path, firered_source: Path, output_tree: Path,
                    report_dir: Path | None = None, *, symbol_map: dict | None = None) -> dict:
    started = time.monotonic()
    base, donor, output = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    if any(output == source or output.is_relative_to(source) for source in (base, donor)):
        raise ValueError('native UI output must be outside immutable source trees')
    # Verify shared buffer capacity, rather than cloning private donor buffers
    # which the host message interpreter would never read.
    buffers = []
    for name in ('gStringVar1', 'gStringVar2', 'gStringVar3', 'gStringVar4'):
        sizes = []
        for source in (donor, base):
            match = re.search(r'\b' + name + r'\[(0x[\da-fA-F]+|\d+)\]',
                              (source / 'src/string_util.c').read_text())
            if not match:
                raise ValueError(f'missing string buffer allocation: {name}')
            sizes.append(int(match[1], 0))
        if sizes[1] < sizes[0]:
            raise ValueError(f'host buffer smaller than donor: {name}')
        buffers.append({'name': name, 'donorBytes': sizes[0], 'hostBytes': sizes[1],
                        'binding': 'shared-host-script-interpreter-storage'})
    # The nickname terminator helper is identical, including EOS and limit.
    for name in ('StringGet_Nickname', 'StringCopy'):
        if _normalized(_function(base, name).source) != _normalized(_function(donor, name).source):
            raise ValueError(f'{name}: source equivalence changed; explicit review required')
    # Preserve the donor's counterintuitive son/daughter branch exactly.
    for name in ('gText_BigGuy', 'gText_BigGirl', 'gText_Son', 'gText_Daughter'):
        pattern = r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);'
        values = [re.search(pattern, (r / 'src/strings.c').read_text()) for r in (base, donor)]
        if not all(values) or values[0][0] != values[1][0]:
            raise ValueError(f'shared text source mismatch: {name}')
    names = {name: 'FR_' + name for name in UI_SYMBOLS}
    names.update(symbol_map or {})
    bodies, providers, unresolved = [], [], []
    includes = ('global.h', 'pokemon.h', 'event_data.h', 'string_util.h', 'strings.h',
                'field_message_box.h', 'field_specials.h', 'party_menu.h', 'player_pc.h',
                'pokemon_storage_system.h', 'data.h', 'constants/items.h', 'constants/moves.h',
                'constants/firered_seagallop.h')
    tm_source = (donor / 'src/data/party_menu.h').read_text()
    tm_table = re.search(r'static const u16 sTMHMMoves\[\]\s*=\s*\{[^}]+\};', tm_source)
    if not tm_table:
        raise ValueError('donor TM/HM move table missing')
    bodies.append(rewrite_tokens(tm_table[0], {'sTMHMMoves': 'FR_UI_sTMHMMoves'}))
    bodies.append('typedef char FR_UI_TMItemDomain[(ITEM_TM01 == 289 && ITEM_HM08 == 346) ? 1 : -1];')
    bodies.append(rewrite_tokens(_function(donor, 'ItemIdToBattleMoveId').source,
                                 {'ItemIdToBattleMoveId': 'FR_UI_ItemIdToBattleMoveId', 'sTMHMMoves': 'FR_UI_sTMHMMoves', 'ITEM_TM01_FOCUS_PUNCH': 'ITEM_TM01'}))
    shared = {'BedroomPC', 'PlayerPC', 'ShowPokemonStorageSystemPC'}
    for name in UI_SYMBOLS:
        source = _function(donor, name)
        row = {'name': name, 'target': names[name], 'source': source.key,
               'sourceSha256': _digest(source.source), 'bindings': [],
               'dependencies': sorted(set(TOKEN.findall(masked(source.source))) - {name})}
        if name in EXTRACT:
            bodies.append(rewrite_tokens(source.source, {name: names[name], 'ItemIdToBattleMoveId': 'FR_UI_ItemIdToBattleMoveId'}))
            row.update(status='source-ported', translationUnit='src/firered_native/ui_services.c',
                       bindings=['host Pokemon API and player party', 'host special variables',
                                 'shared host script text buffers', 'source-identical string helpers/text'])
        elif name in shared:
            host = _function(base, name)
            bodies.append('void ' + names[name] + '(void)\n{\n    ' + name + '();\n}')
            row.update(status='source-ported', translationUnit='src/firered_native/ui_services.c',
                       hostSource=host.key, hostSourceSha256=_digest(host.source),
                       policy='shared-native-Emerald-party-PC-storage-engine',
                       bindings=['shared authoritative native player PC, mailbox/items and Pokemon storage',
                                 'real host task/input/lock/return lifecycle'],
                       observableEquivalence=['Operates the shared saved PC items/mailbox/PokemonStorage and party.',
                                              'PlayerPC/BedroomPC select their real host room/menu context.',
                                              'Storage entry creates its task, clears cursor/state and locks field controls.'],
                       limitations=['Host UI policy is explicit; exact donor artwork/decoration menu/quest-log hooks are not asserted.'])
        elif name == 'GetPCBoxToSendMon':
            # Host capture/storage code owns this value. A separate donor static
            # would stay zero while captures update the host's actual box.
            for helper in ('GetPCBoxToSendMon', 'SetPCBoxToSendMon'):
                if _normalized(_function(base, helper).source) != _normalized(_function(donor, helper).source):
                    raise ValueError(f'{helper}: PC backing equivalence changed')
            bodies.append('u16 ' + names[name] + '(void)\n{\n    return GetPCBoxToSendMon();\n}')
            row.update(status='source-ported', translationUnit='src/firered_native/ui_services.c',
                       bindings=['source-identical host getter/setter and capture-owned sPCBoxToSendMon'])
        else:
            reason = ('Donor quest log playback/recording and persistent scene state require a real port.'
                      if 'QuestLog' in name else
                      'Donor callback/static data closure and native UI ABI require a real port; no host-name substitution.')
            row.update(status='unresolved', blockers=[reason])
            unresolved.append({'name': name, 'reason': reason})
        providers.append(row)
    target = output / 'src/firered_native/ui_services.c'
    target.parent.mkdir(parents=True, exist_ok=True)
    host_prototypes = '\n'.join(_function(base, name).source.split('{', 1)[0].strip() + ';' for name in sorted(shared))
    text = '\n'.join('#include "' + name + '"' for name in includes) + '\n' + host_prototypes + '\n\n' + '\n\n'.join(bodies) + '\n'
    target.write_text(text)
    constants = output / 'include/constants/firered_seagallop.h'
    constants.parent.mkdir(parents=True, exist_ok=True)
    constants.write_text((donor / 'include/constants/seagallop.h').read_text())
    declarations = [body[:body.index('{')].strip() + ';' for body in bodies if '(' in body.split('{', 1)[0] and not body.startswith('typedef ')]
    header = output / 'include/firered_native_ui.h'
    header.parent.mkdir(parents=True, exist_ok=True)
    header.write_text('#ifndef GUARD_FIRERED_NATIVE_UI_H\n#define GUARD_FIRERED_NATIVE_UI_H\n#include "global.h"\n#include "text.h"\n' + '\n'.join(declarations) + '\n#endif\n')
    help_port = _stage_help_and_signpost(base, donor, output)
    providers.extend(help_port['providers'])
    pc_port = _stage_pc_menu(base, donor, output)
    story_menus = _extend_story_menus(donor, output)
    pc_port['sha256'] = story_menus['translationUnit']['sha256']
    elevator_port = _stage_elevator_and_lists(base, donor, output)
    buffers_port = _stage_text_buffers(base, donor, output)
    hof_port = _stage_hof_pc(base, donor, output)
    party_port = _stage_tutorial_party(base, donor, output)
    providers.extend(party_port['providers'])
    npc_port = _stage_npc_text_color(base, donor, output)
    providers.extend(npc_port['providers'])
    providers = [pc_port if row['name'] == 'CreatePCMenu' else row for row in providers]
    story_by_name = {row['name']: row for row in story_menus['providers'] + elevator_port['providers'] + buffers_port['providers'] + hof_port['providers']}
    providers.extend(row for row in elevator_port['providers'] + buffers_port['providers'] if row['name'] not in UI_SYMBOLS)
    providers = [story_by_name.get(row['name'], row) for row in providers]
    unresolved = [row for row in unresolved if row['name'] not in {'CreatePCMenu', *story_by_name}]
    for name in ('QuestLog_RecordEnteredMap', 'QuestLogEvents_HandleEndTrainerBattle'):
        function = _function(donor, name)
        reason = 'Real quest-log event producer, persistent scene storage and playback/recording consumer closure remain unported.'
        providers.append({'name': name, 'target': 'FR_' + name, 'status': 'unresolved',
                          'source': function.key, 'sourceSha256': _digest(function.source),
                          'bindings': [], 'blockers': [reason]})
        unresolved.append({'name': name, 'reason': reason})
    external_owners = {row['name']: ('region_map' if row['name'] == 'ShowTownMap' else 'quest_log')
                       for row in unresolved}
    for row in unresolved:
        row['owner'] = external_owners[row['name']]
        row['ownership'] = 'delegated-provider'
    for row in providers:
        if row['name'] in external_owners:
            row['owner'] = external_owners[row['name']]
            row['ownership'] = 'delegated-provider'
    imports = [{'name': row['name'], 'target': 'FR_' + row['name'], 'owner': row['owner']}
               for row in unresolved]
    imports.extend([{'name': 'QL_AvoidDisplay', 'target': 'FR_QL_AvoidDisplay', 'owner': 'quest_log'},
                    {'name': 'gQuestLogState', 'target': 'FR_gQuestLogState', 'owner': 'quest_log'},
                    {'name': 'WholeGame_GetRivalName', 'target': 'WholeGame_GetRivalName', 'owner': 'campaign'},
                    {'name': 'native donor font IDs and glyphs', 'target': 'FR_FONT_*', 'owner': 'fonts'},
                    {'name': 'tutorial controller state', 'target': 'FR_BtlCtrl_OakOldMan_*', 'owner': 'battle_tutorial'}])
    names.update({row['name']: row['target'] for row in providers})
    report = {'schema': 'single-rom-native-ui/1', 'status': 'blocked', 'buildEligible': False,
              'campaignComplete': False, 'providers': providers, 'unresolved': unresolved,
              'ownedSourceProvidersComplete': True, 'unresolvedOwnedProviders': [], 'providerImports': imports,
              'symbolMap': names, 'sharedBuffers': buffers, 'helpAndSignpost': help_port, 'pcMenu': pc_port, 'tutorialParty': party_port, 'npcTextColor': npc_port, 'storyMenus': story_menus, 'elevatorAndLists': elevator_port, 'textBuffers': buffers_port, 'hallOfFamePC': hof_port,
              'translationUnits': [{'path': target.relative_to(output).as_posix(), 'sha256': _digest(text)}, help_port['translationUnit'], npc_port['translationUnit'], elevator_port['translationUnit'], buffers_port['translationUnit'], hof_port['translationUnit'], {'path': pc_port['translationUnit'], 'sha256': pc_port['sha256']}],
              'qualification': {'sourceExtraction': True, 'objectCompile': None, 'runtime': None},
              'timing': {'operation': 'native-ui-source-port', 'wallSeconds': time.monotonic() - started,
                         'queueSeconds': None, 'buildSeconds': None, 'baselineSeconds': None,
                         'outcome': 'partial-source-port', 'machine': 'local'}}
    ledger = output / 'firered-native-source/native-ui-ledger.json'
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    if report_dir:
        Path(report_dir).mkdir(parents=True, exist_ok=True)
        (Path(report_dir) / 'native-ui-ledger.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report


def _stage_help_and_signpost(base: Path, donor: Path, output: Path) -> dict:
    """Port donor help window storage/rendering and signpost style consumer.

    Text, tile upload, allocation and window primitives use the shared engine.
    Donor frame tiles and palettes remain donor-owned, without replacing them
    with Emerald's normal message box art.
    """
    import shutil
    help_source = (donor / 'src/help_message.c').read_text()
    rename = {f.name: 'FR_' + f.name for f in functions(help_source, 'src/help_message.c')}
    rename.update({name: 'FR_' + name for name in (
        'sHelpMessageWindowId', 'gHelpMessageWindow_Gfx', 'sHelpMessageWindowTemplate',
        'sHelpMessageTextColors', 'MsgSetSignpost', 'MsgSetNotSignpost', 'IsMsgSignpost',
        'sMsgIsSignpost', 'DrawHelpMessageWindowWithText', 'DestroyHelpMessageWindow_',
        'LoadHelpMessageWindowGfx', 'LoadSignpostWindowGfx', 'GetTextWindowPalette',
        'gTextWindowPalettes', 'gSignpostWindow_Gfx', 'gMenuMessageWindow_Gfx', 'gStdTextWindow_Gfx', 'gStandardMenuPalette', 'LoadMenuMessageWindowGfx', 'LoadStdWindowGfx', 'Menu_LoadStdPalAt', 'LoadStdWindowFrameGfx', 'LoadQuestLogWindowTiles', 'gQuestLogWindow_Gfx', 'gQuestLogState', 'Menu_LoadStdPal', 'AddTextPrinterParameterized2', 'AddTextPrinterDiffStyle', 'ContextNpcGetTextColor', 'DrawDialogueFrame', 'WindowFunc_DrawDialogueFrame')})
    text = re.sub(r'^#include[^\n]*\n', '', help_source, flags=re.M)
    text = text.replace('graphics/help_system/msg_window.4bpp', 'graphics/firered_native_ui/help_system/msg_window.4bpp')
    rename['FONT_NORMAL'] = 'FR_FONT_NORMAL'
    rename['LoadUserWindowGfx'] = 'LoadUserWindowBorderGfx'
    rename.update({'FONT_MALE': 'FR_FONT_MALE', 'FONT_FEMALE': 'FR_FONT_FEMALE', 'GetTextSpeedSetting': 'GetPlayerTextSpeedDelay'})
    text = rewrite_tokens(text, rename)
    # Donor MapNamePopupWindowIdSetDummy is called on window-system init.
    # Recreate that call in the host rather than leaving ID=0 aliasing window0.
    constants = '''
#define DLG_WINDOW_BASE_TILE_NUM 0x200
#define DLG_WINDOW_PALETTE_NUM 15
#define STD_WINDOW_BASE_TILE_NUM 0x214
#define STD_WINDOW_PALETTE_NUM 14
#define QL_STATE_PLAYBACK 2
#define NPC_TEXT_COLOR_MALE 0
#define NPC_TEXT_COLOR_FEMALE 1
extern u8 FR_gQuestLogState;
const u16 FR_gQuestLogWindow_Gfx[] = INCBIN_U16("graphics/firered_native_ui/text_window/quest_log.4bpp");
const u16 FR_gSignpostWindow_Gfx[] = INCBIN_U16("graphics/firered_native_ui/text_window/signpost.4bpp");
const u16 FR_gTextWindowPalettes[][16] = {
    INCBIN_U16("graphics/firered_native_ui/text_window/stdpal_0.gbapal"),
    INCBIN_U16("graphics/firered_native_ui/text_window/stdpal_1.gbapal"),
    INCBIN_U16("graphics/firered_native_ui/text_window/stdpal_2.gbapal"),
    INCBIN_U16("graphics/firered_native_ui/text_window/stdpal_3.gbapal"),
    INCBIN_U16("graphics/firered_native_ui/text_window/stdpal_4.gbapal")
};
const u16 FR_gMenuMessageWindow_Gfx[] = INCBIN_U16("graphics/firered_native_ui/text_window/menu_message.4bpp");
const u16 FR_gStdTextWindow_Gfx[] = INCBIN_U16("graphics/firered_native_ui/text_window/std.4bpp");
const u16 FR_gStandardMenuPalette[] = INCBIN_U16("graphics/firered_native_ui/interface/std_menu.gbapal");
static EWRAM_DATA bool8 FR_sMsgIsSignpost = FALSE;
'''
    helper_index = {f.name: f for f in functions((donor / 'src/new_menu_helpers.c').read_text(), 'src/new_menu_helpers.c')}
    own = [rewrite_tokens(helper_index['WindowFunc_DrawDialogueFrame'].source, rename)]
    for name in ('GetTextWindowPalette', 'LoadHelpMessageWindowGfx', 'LoadSignpostWindowGfx', 'LoadMenuMessageWindowGfx', 'LoadStdWindowGfx', 'Menu_LoadStdPalAt', 'LoadStdWindowFrameGfx', 'LoadQuestLogWindowTiles', 'Menu_LoadStdPal', 'AddTextPrinterParameterized2', 'AddTextPrinterDiffStyle', 'DrawDialogueFrame'):
        own.append(rewrite_tokens(_function(donor, name).source, rename))
    for name in ('DrawHelpMessageWindowWithText', 'DestroyHelpMessageWindow_',
                 'MsgSetSignpost', 'MsgSetNotSignpost', 'IsMsgSignpost'):
        own.append(rewrite_tokens(_function(donor, name).source, rename))
    if _normalized(_function(base, 'GetStartMenuWindowId').source) != _normalized(_function(donor, 'GetStartMenuWindowId').source):
        raise ValueError('shared start menu getter source changed')
    own.extend(['u8 FR_GetStartMenuWindowId(void)\n{\n    return GetStartMenuWindowId();\n}',
                'void FR_ResetNativeUiWindows(void)\n{\n    FR_MapNamePopupWindowIdSetDummy();\n    FR_MsgSetNotSignpost();\n}'])
    preamble = '\n'.join('#include "' + name + '"' for name in
        ('global.h', 'malloc.h', 'menu.h', 'bg.h', 'window.h', 'text.h', 'palette.h',
         'constants/characters.h', 'text_window.h', 'string_util.h', 'firered_native_ui.h'))
    unit = preamble + '\n' + constants + '\n' + text + '\n' + '\n\n'.join(own) + '\n'
    target = output / 'src/firered_native/ui_help.c'
    target.write_text(unit)
    assets = []
    for relative in ('help_system/msg_window.png', 'text_window/signpost.png', 'text_window/menu_message.png', 'text_window/std.png', 'interface/std_menu.pal', 'text_window/quest_log.png',
                     *(f'text_window/stdpal_{i}.pal' for i in range(5))):
        source = donor / 'graphics' / relative
        target_asset = output / 'graphics/firered_native_ui' / relative
        target_asset.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target_asset)
        assets.append({'source': 'graphics/' + relative,
                       'target': target_asset.relative_to(output).as_posix(),
                       'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    declarations = ['void FR_DrawDialogueFrame(u8 windowId, bool8 copyToVram);', 'bool16 FR_AddTextPrinterParameterized2(u8 windowId, u8 fontId, const u8 *str, u8 speed, TextPrinterCallback callback, u8 fgColor, u8 bgColor, u8 shadowColor);', 'void FR_AddTextPrinterDiffStyle(bool8 allowSkippingDelayWithButtonPress);', 'extern u8 FR_gQuestLogState;', 'void FR_LoadStdWindowFrameGfx(void);', 'void FR_Menu_LoadStdPal(void);', 'void FR_LoadQuestLogWindowTiles(u8 windowId, u16 tileStart);',
                    'void FR_LoadMenuMessageWindowGfx(u8 windowId, u16 tileStart, u8 palette);',
                    'void FR_LoadStdWindowGfx(u8 windowId, u16 tileStart, u8 palette);',
                    'void FR_Menu_LoadStdPalAt(u16 offset);',
                    'void FR_DrawHelpMessageWindowWithText(const u8 *text);',
                    'void FR_DestroyHelpMessageWindow_(void);',
                    'u8 FR_GetStartMenuWindowId(void);',
                    'void FR_MsgSetSignpost(void);', 'void FR_MsgSetNotSignpost(void);',
                    'bool8 FR_IsMsgSignpost(void);', 'void FR_ResetNativeUiWindows(void);',
                    'void FR_LoadSignpostWindowGfx(u8 windowId, u16 destOffset, u8 palOffset);',
                    'const u16 *FR_GetTextWindowPalette(u8 id);']
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', '\n'.join(declarations) + '\n#endif'))
    patches = []
    for relative, old, new in (
        ('src/menu.c', '    sMapNamePopupWindowId = WINDOW_NONE;\n}',
         '    sMapNamePopupWindowId = WINDOW_NONE;\n    FR_ResetNativeUiWindows();\n}'),
        ('src/field_message_box.c', '            LoadMessageBoxAndBorderGfx();',
         '            if (WholeGame_IsKanto() || FR_gQuestLogState == 2)\n                FR_LoadStdWindowFrameGfx();\n            else\n                LoadMessageBoxAndBorderGfx();\n            if (FR_IsMsgSignpost() && FR_gQuestLogState != 2)\n                FR_LoadSignpostWindowGfx(0, 0x200, BG_PLTT_ID(15));')):
        path = output / relative
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text((base / relative).read_text())
        original = path.read_text()
        if new in original:
            patched = original
        elif original.count(old) == 1:
            patched = original.replace(old, new)
        else:
            raise ValueError(f'{relative}: native UI patch anchor changed')
        if '#include "firered_native_ui.h"' not in patched:
            patched = '#include "firered_native_ui.h"\n' + patched
        if relative == 'src/field_message_box.c' and '#include "palette.h"' not in patched:
            patched = patched.replace('#include "global.h"', '#include "global.h"\n#include "palette.h"', 1)
        path.write_text(patched)
        patches.append({'path': relative, 'sha256': _digest(patched)})
    field = output / 'src/field_message_box.c'
    native = field.read_text()
    if 'extern bool8 WholeGame_IsKanto(void);' not in native:
        native = native.replace('#include "firered_native_ui.h"', '#include "firered_native_ui.h"\nextern bool8 WholeGame_IsKanto(void);', 1)
    for argument in ('allowSkippingDelayWithButtonPress', 'TRUE'):
        old_printer = '    AddTextPrinterForMessage(' + argument + ');'
        new_printer = ('    if (WholeGame_IsKanto())\n        FR_AddTextPrinterDiffStyle(' + argument + ');\n    else\n        AddTextPrinterForMessage(' + argument + ');')
        if new_printer not in native:
            native = native.replace(old_printer, new_printer)
    old_frame = '            DrawDialogueFrame(0, TRUE);'
    new_frame = '            if (WholeGame_IsKanto())\n                FR_DrawDialogueFrame(0, TRUE);\n            else\n                DrawDialogueFrame(0, TRUE);'
    if new_frame not in native:
        native = native.replace(old_frame, new_frame)
    field.write_text(native)
    patches = [dict(row, sha256=_digest(native)) if row['path'] == 'src/field_message_box.c' else row for row in patches]
    providers = []
    for name in ('DrawHelpMessageWindowWithText' , 'DestroyHelpMessageWindow_',
                 'GetStartMenuWindowId', 'MsgSetSignpost', 'MsgSetNotSignpost', 'IsMsgSignpost',
                 'LoadMenuMessageWindowGfx', 'LoadStdWindowGfx', 'Menu_LoadStdPalAt', 'LoadStdWindowFrameGfx', 'LoadQuestLogWindowTiles', 'Menu_LoadStdPal', 'AddTextPrinterParameterized2', 'AddTextPrinterDiffStyle', 'DrawDialogueFrame'):
        providers.append({'name': name, 'target': 'FR_' + name, 'status': 'source-ported',
                          'translationUnit': 'src/firered_native/ui_help.c',
                          'source': _function(donor, name).key,
                          'sourceSha256': _digest(_function(donor, name).source),
                          'bindings': ['shared host window allocator/text renderer/tile uploads',
                                       'donor help/signpost tile and palette assets',
                                       'host field-message style consumer and window-system reset'],
                          'blockers': ['Cartridge render/input/teardown behavior remains unqualified.']})
    return {'providers': providers, 'assets': assets, 'patches': patches,
            'translationUnit': {'path': 'src/firered_native/ui_help.c', 'sha256': _digest(unit)},
            'limits': ['Quest-log playback frame selection remains a separate unresolved donor feature.',
                       'Signpost cancel-on-walk and NPC-facing input policies remain unqualified.']}


def _stage_pc_menu(base: Path, donor: Path, output: Path) -> dict:
    """Donor PC menu and its asynchronous select/cancel/teardown lifecycle.

    The generic donor multichoice task is specialized at its sole PC caller's
    constant MULTICHOICE_NONE; its cable-club description branches are unreachable.
    No quest-log avoidance or success-return path is substituted.
    """
    from .state import namespace_header
    source = (donor / 'src/script_menu.c').read_text()
    index = {f.name: f for f in functions(source, 'src/script_menu.c')}
    names = ('CreatePCMenu', 'CreatePCMenuWindow', 'GetStringTilesWide',
             'CreateMCMenuInputHandlerTask', 'Task_MultichoiceMenu_HandleInput',
             'CreateWindowFromRect', 'DestroyScriptMenuWindow')
    rename = {name: 'FR_UI_' + name for name in names}
    rename['CreatePCMenu'] = 'FR_CreatePCMenu'
    rename.update({'Menu_InitCursor': 'InitMenuNormal',
                   'Menu_PrintFormatIntlPlayerName': 'FR_UI_Menu_PrintFormatIntlPlayerName',
                   'SetStdWindowBorderStyle': 'SetStandardWindowBorderStyle',
                   'Menu_ProcessInputNoWrapAround': 'Menu_ProcessInputNoWrap',
                   'ClearStdWindowAndFrameToTransparent': 'ClearStdWindowAndFrameToTransparent',
                   'FONT_NORMAL_COPY_1': 'FR_FONT_NORMAL_COPY_1',
                   'FONT_NORMAL': 'FR_FONT_NORMAL',
                   'FLAG_SYS_POKEDEX_GET': 'FR_FLAG_SYS_POKEDEX_GET',
                   'FLAG_SYS_GAME_CLEAR': 'FR_FLAG_SYS_GAME_CLEAR',
                   'FLAG_SYS_NOT_SOMEONES_PC': 'FR_FLAG_SYS_NOT_SOMEONES_PC',
                   'sDelay': 'FR_UI_sPCMenuDelay'})
    body = []
    for name in names:
        text = index[name].source
        if name == 'CreateMCMenuInputHandlerTask':
            old = '''    if (mcId == MULTICHOICE_TRADE_CENTER_COLOSSEUM
     || mcId == MULTICHOICE_TRADE_COLOSSEUM_CRUSH
     || mcId == MULTICHOICE_TRADE_COLOSSEUM_2)
        sDelay = 12;
    else
        sDelay = 0;'''
            if old not in text:
                raise ValueError('PC menu constant specialization anchor changed')
            text = text.replace(old, '    sDelay = 0; // MULTICHOICE_NONE constant at PC caller')
            text = text.replace('    MultiChoicePrintHelpDescription(mcId);', '')
        if name == 'Task_MultichoiceMenu_HandleInput':
            text = text.replace('            if (JOY_NEW(DPAD_UP | DPAD_DOWN))\n                MultiChoicePrintHelpDescription(tMultichoiceId);', '')
        if name == 'CreateWindowFromRect':
            text = text.replace('struct WindowTemplate template = SetWindowTemplateFields(',
                                'struct WindowTemplate template;\n    u8 windowId;\n    SetWindowTemplateFields(&template, ')
            text = text.replace('    u8 windowId = AddWindow(&template);', '    windowId = AddWindow(&template);')
        body.append(rewrite_tokens(text, rename))
    body.append(rewrite_tokens(_function(donor, 'Menu_PrintFormatIntlPlayerName').source, rename))
    text_symbols = ('gText_SPc', 'gText_ProfOakSPc', 'gText_HallOfFame_2',
                    'gText_LogOff', 'gText_BillSPc', 'gText_SomeoneSPc')
    strings = (donor / 'src/strings.c').read_text()
    declarations = []
    for name in text_symbols:
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('donor PC string definition changed: ' + name)
        declarations.append(rewrite_tokens(match[0], {name: 'FR_UI_' + name}))
    body = [rewrite_tokens(text, {name: 'FR_UI_' + name for name in text_symbols}) for text in body]
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', 'bool8 FR_CreatePCMenu(void);\n#endif'))
    includes = ('global.h', 'menu.h', 'menu_helpers.h', 'text.h', 'window.h', 'bg.h',
                'palette.h', 'task.h', 'script.h', 'sound.h', 'event_data.h',
                'string_util.h', 'constants/characters.h', 'constants/songs.h',
                'constants/whole_game_fr_state.h')
    preamble = '\n'.join('#include "' + name + '"' for name in includes)
    defines = '''
#define tIgnoreBPress data[4]
#define tWrapAround data[5]
#define tWindowId data[6]
#define tMultichoiceId data[7]
#define SCR_MENU_UNSET 0xFF
#define SCR_MENU_CANCEL 0x7F
#define MULTICHOICE_NONE 0
static EWRAM_DATA u8 FR_UI_sPCMenuDelay = 0;
'''
    # Actual donor sentinel is part of the menu dispatch contract.
    constants = (donor / 'include/constants/menu.h').read_text()
    m = re.search(r'#define MULTICHOICE_NONE\s+([^\n]+)', constants)
    if not m:
        raise ValueError('donor PC multichoice sentinel missing')
    defines = defines.replace('#define MULTICHOICE_NONE 0', '#define MULTICHOICE_NONE ' + m[1])
    prototypes = '\n'.join(text[:text.index('{')].strip() + ';' for text in body)
    unit = preamble + '\n' + defines + '\n' + '\n'.join(declarations) + '\n' + prototypes + '\n\n' + '\n\n'.join(body) + '\n'
    target = output / 'src/firered_native/ui_pc_menu.c'
    target.write_text(unit)
    constant_header = output / 'include/constants/whole_game_fr_state.h'
    if not constant_header.exists():
        constant_header.write_text(namespace_header(donor))
    return {'name': 'CreatePCMenu', 'target': 'FR_CreatePCMenu', 'status': 'source-ported',
            'translationUnit': target.relative_to(output).as_posix(), 'sha256': _digest(unit),
            'source': index['CreatePCMenu'].key, 'sourceSha256': _digest(index['CreatePCMenu'].source),
            'bindings': ['shared host task/window/menu/input API', 'donor namespaced progression flags',
                         'donor PC text and asynchronous result/cancel/cleanup'],
            'specialization': 'MULTICHOICE_NONE caller; cable-club description/delay branches unreachable',
            'blockers': ['Cartridge menu/task/input behavior remains unqualified.',
                         'Cross-owner generic multichoice/PC task exclusion requires integration review.']}


def _stage_tutorial_party(base: Path, donor: Path, output: Path) -> dict:
    """Attach real donor Oak party tutorial tasks to host party storage/rendering.

    FR_FONT_MALE is supplied by the separate exact donor font extension. There
    is no normal-font alias and no fake tutorial completion callback.
    """
    donor_source = (donor / 'src/party_menu.c').read_text()
    donor_index = {f.name: f for f in functions(donor_source, 'src/party_menu.c')}
    task_names = [name for name in donor_index if name.startswith('Task_FirstBattleEnterParty_')]
    names = task_names + ['PartyMenu_Oak_PrintText', 'FirstBattleEnterParty_CreateWindowAndMsg1Printer',
                          'FirstBattleEnterParty_DestroyVoiceoverWindow', 'OpenPartyMenuInTutorialBattle']
    rename = {name: 'FR_' + name for name in names}
    rename.update({'BtlCtrl_OakOldMan_TestState2Flag': 'FR_BtlCtrl_OakOldMan_TestState2Flag',
                   'BtlCtrl_OakOldMan_SetState2Flag': 'FR_BtlCtrl_OakOldMan_SetState2Flag',
                   'FIRST_BATTLE_MSG_FLAG_PARTY_MENU': 'FR_FIRST_BATTLE_MSG_FLAG_PARTY_MENU',
                   'FONT_MALE': 'FR_FONT_MALE', 'GetTextSpeedSetting': 'GetPlayerTextSpeedDelay',
                   'LoadMenuMessageWindowGfx': 'FR_LoadMenuMessageWindowGfx',
                   'LoadStdWindowGfx': 'FR_LoadStdWindowGfx',
                   'LoadUserWindowGfx': 'LoadUserWindowBorderGfx',
                   'RunTextPrinters_CheckActive': 'RunTextPrintersRetIsActive',
                   'AddTextPrinterParameterized2': 'FR_AddTextPrinterParameterized2',
                   'SetCB2ToReshowScreenAfterMenu': 'CB2_SetUpReshowBattleScreenAfterMenu',
                   'sWindowTemplate_FirstBattleOakVoiceover': 'FR_sWindowTemplate_FirstBattleOakVoiceover',
                   'gText_OakImportantToGetToKnowPokemonThroughly': 'FR_UI_gText_OakImportantToGetToKnowPokemonThroughly',
                   'gText_OakThisIsListOfPokemon': 'FR_UI_gText_OakThisIsListOfPokemon'})
    bodies = []
    for name in names:
        text = donor_index[name].source
        # Tutorial identity is routed by the dedicated source trainer mode;
        # Emerald's BATTLE_TYPE_FIRST_BATTLE denotes the unrelated Birch fight.
        text = text.replace('(gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE)', 'WholeGame_IsFireRedTutorialBattle()')
        bodies.append(rewrite_tokens(text, rename))
    strings = (donor / 'src/strings.c').read_text()
    string_declarations = []
    for name in ('gText_OakImportantToGetToKnowPokemonThroughly', 'gText_OakThisIsListOfPokemon'):
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('Oak party text definition changed: ' + name)
        string_declarations.append(rewrite_tokens(match[0], rename))
    template_text = (donor / 'src/data/party_menu.h').read_text()
    template = re.search(r'static const struct WindowTemplate sWindowTemplate_FirstBattleOakVoiceover\s*=\s*\{[^}]+\};', template_text)
    if not template:
        raise ValueError('Oak party voiceover window template missing')
    prototypes = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
    # For in-battle items preserve the exact host's ordinary item path while
    # using the original donor first-entry tutorial branch for the first potion.
    item_tutorial = '''
void FR_EnterPartyFromItemMenuInBattle(void)
{
    if (!FR_BtlCtrl_OakOldMan_TestState2Flag(FR_FIRST_BATTLE_MSG_FLAG_PARTY_MENU)
        && WholeGame_IsFireRedTutorialBattle())
    {
        InitPartyMenu(PARTY_MENU_TYPE_IN_BATTLE,
                      GetPartyLayoutFromBattleType(),
                      PARTY_ACTION_USE_ITEM,
                      FALSE,
                      PARTY_MSG_NONE,
                      FR_Task_FirstBattleEnterParty_WaitFadeIn,
                      CB2_ReturnToBagMenu);
        FR_BtlCtrl_OakOldMan_SetState2Flag(FR_FIRST_BATTLE_MSG_FLAG_PARTY_MENU);
    }
    else
    {
        InitPartyMenu(PARTY_MENU_TYPE_IN_BATTLE,
                      GetPartyLayoutFromBattleType(),
                      PARTY_ACTION_USE_ITEM,
                      FALSE,
                      PARTY_MSG_USE_ON_WHICH_MON,
                      Task_HandleChooseMonInput,
                      CB2_ReturnToBagMenu);
    }
    ReshowBattleScreenDummy();
    UpdatePartyToBattleOrder();
}
'''
    declarations = '''
extern bool8 WholeGame_IsFireRedTutorialBattle(void);
extern bool8 FR_BtlCtrl_OakOldMan_TestState2Flag(u8 flag);
extern void FR_BtlCtrl_OakOldMan_SetState2Flag(u8 flag);
#define FR_FIRST_BATTLE_MSG_FLAG_PARTY_MENU 0x8
void FR_OpenPartyMenuInTutorialBattle(u8 partyAction);
void FR_EnterPartyFromItemMenuInBattle(void);
'''
    block = ('\n/* BEGIN FIRERED_NATIVE_OAK_PARTY */\n' + declarations +
             rewrite_tokens(template[0], rename) + '\n' + '\n'.join(string_declarations) + '\n' +
             prototypes + '\n' + '\n\n'.join(bodies) + '\n' + item_tutorial +
             '\n/* END FIRERED_NATIVE_OAK_PARTY */\n')
    path = output / 'src/party_menu.c'
    if not path.exists():
        path.write_text((base / 'src/party_menu.c').read_text())
    source = path.read_text()
    if '/* BEGIN FIRERED_NATIVE_OAK_PARTY */' in source:
        source = source[:source.index('/* BEGIN FIRERED_NATIVE_OAK_PARTY */')].rstrip() + '\n'
    if '#include "firered_native_ui.h"' not in source:
        source = '#include "firered_native_ui.h"\n' + source
    for name, call in (('OpenPartyMenuInBattle', 'FR_OpenPartyMenuInTutorialBattle(partyAction)'),
                       ('ChooseMonForInBattleItem', 'FR_EnterPartyFromItemMenuInBattle()')):
        function = [f for f in functions(source, 'src/party_menu.c') if f.name == name][0]
        hook = '\n    if (WholeGame_IsFireRedTutorialBattle())\n    {\n        ' + call + ';\n        return;\n    }\n'
        opening = function.start + function.source.index('{') + 1
        if call + ';' not in function.source:
            source = source[:opening] + hook + source[opening:]
    # The call sites precede the appended functions in the host translation unit.
    source = source.replace(declarations, '').replace('#include "firered_native_ui.h"\n', '').lstrip()
    source = '#include "firered_native_ui.h"\n' + declarations + source + block
    path.write_text(source)
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', 'void FR_OpenPartyMenuInTutorialBattle(u8 partyAction);\nvoid FR_EnterPartyFromItemMenuInBattle(void);\n#endif'))
    return {'providers': [
                {'name': name, 'target': target, 'status': 'source-ported',
                 'source': 'src/party_menu.c:' + donor_name,
                 'sourceSha256': _digest(donor_index[donor_name].source),
                 'translationUnit': 'src/party_menu.c',
                 'bindings': ['shared host party menu state/init/input', 'source donor Oak tutorial callbacks/text',
                              'FR_FONT_MALE native font extension', 'dedicated donor tutorial-controller state'],
                 'blockers': ['Depends on real FR_FONT_MALE extension and tutorial-controller state providers.',
                              'Cartridge tutorial message/task/input behavior remains unqualified.']}
                for name, target, donor_name in (
                    ('OpenPartyMenuInTutorialBattle', 'FR_OpenPartyMenuInTutorialBattle', 'OpenPartyMenuInTutorialBattle'),
                    ('EnterPartyFromItemMenuInBattle', 'FR_EnterPartyFromItemMenuInBattle', 'EnterPartyFromItemMenuInBattle'))],
            'patch': {'path': 'src/party_menu.c', 'sha256': _digest(source)},
            'taskCallbacks': ['FR_' + name for name in task_names],
            'externalDependencies': ['FR_FONT_MALE', 'WholeGame_IsFireRedTutorialBattle',
                                     'FR_BtlCtrl_OakOldMan_TestState2Flag', 'FR_BtlCtrl_OakOldMan_SetState2Flag']}


def _stage_npc_text_color(base: Path, donor: Path, output: Path) -> dict:
    original = (donor / 'src/dynamic_placeholder_text_util.c').read_text()
    table = re.search(r'static const u8 sTextColorTable\[\]\s*=\s*\{[^}]+\};', original)
    if not table:
        raise ValueError('donor NPC text color table missing')
    gfx_constants = dict(re.findall(r'^#define (OBJ_EVENT_GFX_\w+)\s+(\d+)\b',
                                   (donor / 'include/constants/event_objects.h').read_text(), re.M))
    identifiers = set(re.findall(r'OBJ_EVENT_GFX_\w+', masked(table[0])))
    if identifiers - gfx_constants.keys():
        raise ValueError('donor text color table has nonliteral object ids')
    rename = {'sTextColorTable': 'FR_sTextColorTable', 'GetColorFromTextColorTable': 'FR_GetColorFromTextColorTable',
              'ContextNpcGetTextColor': 'FR_ContextNpcGetTextColor',
              'ResetContextNpcTextColor': 'FR_ResetContextNpcTextColor', 'NELEMS': 'ARRAY_COUNT'}
    # Only the dynamic graphics variable bank changes. Live ObjectEvent graphics
    # ids remain the donor's raw u8 values, as verified by the object-bank owner.
    context = _function(donor, 'ContextNpcGetTextColor').source
    anchor = 'VarGetObjectEventGraphicsId(gfxId - OBJ_EVENT_GFX_VAR_0)'
    if anchor not in context:
        raise ValueError('donor context dynamic gfx anchor changed')
    context = context.replace(anchor, 'VarGet(FR_VAR_OBJ_GFX_ID_0 + gfxId - OBJ_EVENT_GFX_VAR_0)')
    context = rewrite_tokens(context, rename | {'OBJ_EVENT_GFX_VAR_0': '240'})
    body = '\n\n'.join((rewrite_tokens(table[0], rename | gfx_constants),
                          rewrite_tokens(_function(donor, 'GetColorFromTextColorTable').source, rename),
                          rewrite_tokens(_function(donor, 'ResetContextNpcTextColor').source, rename), context))
    defines = '''
extern u16 gSpecialVar_TextColor;
#define COLORS(a,b) ((a) | ((b) << 4))
#define NPC_TEXT_COLOR_MALE 0
#define NPC_TEXT_COLOR_FEMALE 1
#define NPC_TEXT_COLOR_MON 2
#define NPC_TEXT_COLOR_NEUTRAL 3
#define NPC_TEXT_COLOR_DEFAULT 255
'''
    source = '\n'.join('#include "' + name + '"' for name in
                       ('global.h', 'event_data.h', 'field_control_avatar.h', 'event_object_movement.h',
                        'constants/whole_game_fr_state.h')) + '\n' + defines + '\n' + body + '\n'
    target = output / 'src/firered_native/ui_npc_text.c'
    target.write_text(source)
    # Host clears selection before looking for a trainer/NPC. Preserve the
    # donor default-color reset at that actual causal boundary, before selection.
    path = output / 'src/field_control_avatar.c'
    if not path.exists():
        path.write_text((base / 'src/field_control_avatar.c').read_text())
    native = path.read_text()
    old = '    gSpecialVar_LastTalked = LOCALID_NONE;\n    gSelectedObjectEvent = 0;'
    new = old + '\n    FR_ResetContextNpcTextColor();\n    FR_MsgSetNotSignpost();'
    if new not in native:
        if native.count(old) != 1:
            raise ValueError('NPC context reset source anchor changed')
        native = native.replace(old, new)
    if '#include "firered_native_ui.h"' not in native:
        native = '#include "firered_native_ui.h"\n' + native
    path.write_text(native)
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', 'u8 FR_ContextNpcGetTextColor(void);\nvoid FR_ResetContextNpcTextColor(void);\nu8 FR_GetColorFromTextColorTable(u16 graphicsId);\n#endif'))
    return {'providers': [
                {'name': name, 'target': rename[name], 'source': _function(donor, name).key,
                 'sourceSha256': _digest(_function(donor, name).source),
                 'status': 'source-ported', 'translationUnit': target.relative_to(output).as_posix(),
                 'bindings': ['real selected object and shared text-color override variable',
                              'exact donor packed graphics/text-color table',
                              'Kanto dynamic graphics variable bank', 'actual field-input context reset'],
                 'blockers': ['Donor callers must use donor-object graphics identity; cartridge selection/rendering unqualified.']}
                for name in ('ContextNpcGetTextColor', 'ResetContextNpcTextColor', 'GetColorFromTextColorTable')],
            'translationUnit': {'path': target.relative_to(output).as_posix(), 'sha256': _digest(source)},
            'patch': {'path': 'src/field_control_avatar.c', 'sha256': _digest(native)}}


def _extend_story_menus(donor: Path, output: Path) -> dict:
    """Museum fossil assets/tasks and Seagallop selection on real menu engine."""
    import shutil
    source = (donor / 'src/script_menu.c').read_text()
    index = {f.name: f for f in functions(source, 'src/script_menu.c')}
    exported = ('OpenMuseumFossilPic', 'CloseMuseumFossilPic',
                'DrawSeagallopDestinationMenu', 'GetSelectedSeagallopDestination')
    private = ('Task_WaitMuseumFossilPic', 'QL_DestroyAbortedDisplay')
    rename = {name: 'FR_' + name for name in exported}
    rename.update({name: 'FR_UI_' + name for name in private})
    rename.update({name: 'FR_UI_' + name for name in (
        'sMuseumFossilAnim0', 'sMuseumFossilAnimCmdTable', 'sMuseumFossilOamData',
        'sMuseumFossilSprTemplate', 'sMuseumAerodactylSprTiles', 'sMuseumAerodactylSprPalette',
        'sMuseumKabutopsSprTiles', 'sMuseumKabutopsSprPalette', 'sMuseumKabutopsSprSheets',
        'sMuseumAerodactylSprSheets', 'sSeagallopDestStrings', 'CreateWindowFromRect',
        'DestroyScriptMenuWindow', 'CreateMCMenuInputHandlerTask')})
    rename.update({'QL_AvoidDisplay': 'FR_QL_AvoidDisplay', 'EventScript_ReleaseEnd': 'FR_EventScript_ReleaseEnd',
                   'SetStdWindowBorderStyle': 'SetStandardWindowBorderStyle', 'Menu_InitCursor': 'InitMenuNormal',
                   'FONT_NORMAL': 'FR_FONT_NORMAL'})
    globals_block = source[source.index('static const union AnimCmd sMuseumFossilAnim0[]'):
                           source.index('static u16 GetStringTilesWide(const u8 *str)\n{')]
    # Drop every unrelated script-menu table; this contiguous block contains
    # only museum fossil resources and the Seagallop destination string table.
    string_names = set(re.findall(r'\bg(?:Text|OtherText)_\w+\b', globals_block)) | {'gText_Other', 'gOtherText_Exit'}
    strings = (donor / 'src/strings.c').read_text()
    declarations = []
    for name in sorted(string_names):
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('story menu donor text missing: ' + name)
        rename[name] = 'FR_UI_' + name
        declarations.append(rewrite_tokens(match[0], rename))
    globals_block = globals_block.replace('graphics/script_menu/', 'graphics/firered_native_ui/script_menu/')
    bodies = []
    for name in (*private, *exported):
        text = index[name].source
        if name == 'QL_DestroyAbortedDisplay':
            # Scope the source cleanup callback to its namespaced owner. The
            # native shared mon-picture engine owns its own resource lifecycle.
            begin = text.index('    taskId = FindTaskIdByFunc(Task_ScriptShowMonPic);')
            end = text.index('    taskId = FindTaskIdByFunc(Task_WaitMuseumFossilPic);')
            text = text[:begin] + text[end:]
        bodies.append(rewrite_tokens(text, rename))
    prototypes = '\n'.join(text[:text.index('{')].strip() + ';' for text in bodies)
    defines = '''
#undef tWindowId
#define tWindowId data[5]
#define tState data[0]
#define tSpecies data[1]
#define tSpriteId data[2]
#define GFXTAG_FOSSIL 7000
#define FOSSIL_PIC_PAL_NUM 13
extern bool8 FR_QL_AvoidDisplay(void (*func)(void));
extern const u8 FR_EventScript_ReleaseEnd[];
'''
    target = output / 'src/firered_native/ui_pc_menu.c'
    unit = '#include "sprite.h"\n#include "constants/firered_seagallop.h"\n' + target.read_text()
    # sprite.h depends on global typedefs, so keep the base header first.
    unit = '#include "global.h"\n' + unit
    unit += '\n' + defines + '\n' + '\n'.join(declarations) + '\n' + rewrite_tokens(globals_block, rename) + '\n' + prototypes + '\n' + '\n\n'.join(bodies) + '\n'
    target.write_text(unit)
    assets = []
    for name in ('aerodactyl_fossil.png', 'kabutops_fossil.png'):
        src = donor / 'graphics/script_menu' / name
        dst = output / 'graphics/firered_native_ui/script_menu' / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        assets.append({'source': src.relative_to(donor).as_posix(), 'target': dst.relative_to(output).as_posix(),
                       'sha256': hashlib.sha256(src.read_bytes()).hexdigest()})
    header = output / 'include/firered_native_ui.h'
    public = [text[:text.index('{')].strip() + ';' for text in bodies if text.split('(',1)[0].split()[-1] in {'FR_' + name for name in exported}]
    header.write_text(header.read_text().replace('#endif', '\n'.join(public) + '\n#endif'))
    return {'providers': [{'name': name, 'target': 'FR_' + name, 'status': 'source-ported',
                           'source': index[name].key, 'sourceSha256': _digest(index[name].source),
                           'translationUnit': target.relative_to(output).as_posix(),
                           'bindings': ['original fossil graphics/palettes and async sprite/window teardown',
                                        'original Seagallop origin/page/cancel/destination branches',
                                        'shared native input/task/window engine', 'real quest-log avoid-display provider'],
                           'blockers': ['Depends on FR_QL_AvoidDisplay and donor release-script provider.',
                                        'Cartridge display/input/resource teardown remains unqualified.']}
                          for name in exported],
            'assets': assets, 'translationUnit': {'path': target.relative_to(output).as_posix(), 'sha256': _digest(unit)}}


def _stage_elevator_and_lists(base: Path, donor: Path, output: Path) -> dict:
    """Original elevator/list state machine, with typed native list-item fields."""
    source = (donor / 'src/field_specials.c').read_text()
    block = source[source.index('static const struct WindowTemplate sElevatorCurrentFloorWindowTemplate ='):
                   source.index('void ForcePlayerToStartSurfing(void)')]
    function_index = {f.name: f for f in functions(block, 'src/field_specials.c')}
    exported = ('GetElevatorFloor', 'InitElevatorFloorSelectMenuPos', 'AnimateElevator',
                'DrawElevatorCurrentFloorWindow', 'CloseElevatorCurrentFloorWindow',
                'ListMenu', 'ReturnToListMenu')
    names = {name: 'FR_' + name for name in function_index if name != 'ListMenu'}
    names.update({name: 'FR_UI_' + name for name in set(re.findall(r'\bs[A-Z]\w*', masked(block)))})
    names.update({'FONT_NORMAL': 'FR_FONT_NORMAL', 'NELEMS': 'ARRAY_COUNT',
                  'LoadStdWindowGfx': 'FR_LoadStdWindowGfx', 'SetStdWindowBorderStyle': 'SetStandardWindowBorderStyle',
                  'QL_AvoidDisplay': 'FR_QL_AvoidDisplay', 'QL_DestroyAbortedDisplay': 'FR_UI_QL_DestroyAbortedDisplay',
                  'VAR_ELEVATOR_FLOOR': 'FR_VAR_ELEVATOR_FLOOR'})
    # The donor's ListMenu function and host's struct ListMenu are distinct C
    # namespaces; replacing every token would corrupt the callback type.
    block = re.sub(r'\bListMenu(?=\s*\()', 'FR_ListMenu', block)
    block = block.replace('template = SetWindowTemplateFields(', 'SetWindowTemplateFields(&template, ')
    block = re.sub(r'(sListMenuItems\[[^\]]+\])\.label\b', r'\1.name', block)
    block = re.sub(r'(sListMenuItems\[[^\]]+\])\.index\b', r'\1.id', block)
    literal_constants = {}
    for filename in ('menu.h', 'metatile_labels.h'):
        literal_constants.update(dict(re.findall(r'^#define (\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b',
                                                (donor / 'include/constants' / filename).read_text(), re.M)))
    used = set(re.findall(r'\b(?:LISTMENU_|METATILE_)\w+', masked(block)))
    if used - literal_constants.keys():
        raise ValueError('elevator/list constants missing')
    names.update({name: literal_constants[name] for name in used})
    # DynamicWarp stores unified map groups, so map constants must carry the
    # same donor group offset as the world import; map-number cases stay exact.
    groups = json.loads((donor / 'data/maps/map_groups.json').read_text())
    base_groups = len(json.loads((base / 'data/maps/map_groups.json').read_text())['group_order'])
    donor_map_ids = {}
    for group_id, group in enumerate(groups['group_order']):
        for map_num, map_name in enumerate(groups[group]):
            ident = json.loads((donor / 'data/maps' / map_name / 'map.json').read_text())['id']
            donor_map_ids[ident] = f'({map_num} | ({base_groups + group_id} << 8))'
    used_maps = set(re.findall(r'\bMAP_(?!GROUP\b|NUM\b|OFFSET\b)\w+', masked(block)))
    if used_maps - donor_map_ids.keys():
        raise ValueError('elevator map constants missing: ' + str(sorted(used_maps - donor_map_ids.keys())))
    map_defines = []
    for name in sorted(used_maps):
        target_name = 'FR_UI_' + name
        names[name] = target_name
        map_defines.append('#define ' + target_name + ' ' + donor_map_ids[name])
    strings = (donor / 'src/strings.c').read_text()
    declarations = []
    for name in sorted(set(re.findall(r'\bg(?:Text|OtherText)_\w+', masked(block)))):
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('elevator/list string missing: ' + name)
        names[name] = 'FR_UI_' + name
        declarations.append(rewrite_tokens(match[0], names))
    block = rewrite_tokens(block, names)
    prototypes = []
    for function in functions(block, 'src/field_specials.c'):
        prototypes.append(function.source.split('{',1)[0].strip() + ';')
    preamble = '\n'.join('#include "' + name + '"' for name in
        ('global.h', 'malloc.h', 'menu.h', 'text.h', 'list_menu.h', 'task.h', 'bg.h',
         'palette.h', 'script.h', 'sound.h', 'event_data.h', 'fieldmap.h', 'field_camera.h',
         'constants/songs.h', 'constants/whole_game_fr_state.h', 'firered_native_ui.h'))
    state = '''
extern bool8 FR_QL_AvoidDisplay(void (*func)(void));
extern void FR_UI_QL_DestroyAbortedDisplay(void);
static EWRAM_DATA u8 FR_UI_sElevatorCurrentFloorWindowId = 0;
static EWRAM_DATA u16 FR_UI_sElevatorScroll = 0;
static EWRAM_DATA u16 FR_UI_sElevatorCursorPos = 0;
static EWRAM_DATA struct ListMenuItem *FR_UI_sListMenuItems = NULL;
static EWRAM_DATA u16 FR_UI_sListMenuLastScrollPosition = 0;
static EWRAM_DATA u16 FR_UI_sFieldSpecialsListMenuScrollBuffer = 0;
COMMON_DATA struct ListMenuTemplate FR_UI_sFieldSpecialsListMenuTemplate = {0};
'''
    unit = preamble + '\n' + state + '\n' + '\n'.join(map_defines + declarations + prototypes) + '\n\n' + block
    target = output / 'src/firered_native/ui_elevator.c'
    target.write_text(unit)
    return {'providers': [{'name': name, 'target': 'FR_' + name, 'status': 'source-ported',
                           'source': function_index[name].key, 'sourceSha256': _digest(function_index[name].source),
                           'translationUnit': target.relative_to(output).as_posix(),
                           'bindings': ['donor floor/cursor/scroll/list state shared by initializer and list input tasks',
                                        'unified dynamic warp map groups from actual map manifests',
                                        'original elevator metatile animation/panning/duration/sound symbols',
                                        'typed host ListMenuItem.name/id fields and list/window/input lifecycle'],
                           'blockers': ['Real quest-log avoid-display provider required.',
                                        'Cartridge elevator/list input/animation/cleanup remains unqualified.']}
                          for name in exported],
            'translationUnit': {'path': target.relative_to(output).as_posix(), 'sha256': _digest(unit)},
            'mapGroupOffset': base_groups, 'mapConstants': {name: donor_map_ids[name] for name in sorted(used_maps)},
            'listItemFieldAdaptation': {'donor.label': 'host.name', 'donor.index': 'host.id'}}


def _stage_text_buffers(base: Path, donor: Path, output: Path) -> dict:
    """Typed shared EasyChat/link/eReader records plus donor name formatting."""
    providers, bodies, declarations = [], [], []
    host_union, donor_union = _function(base, 'BufferUnionRoomPlayerName'), _function(donor, 'BufferUnionRoomPlayerName')
    if _normalized(host_union.source) != _normalized(donor_union.source):
        raise ValueError('shared union-room consume-once name buffer changed')
    bodies.append('bool16 FR_BufferUnionRoomPlayerName(void)\n{\n    return BufferUnionRoomPlayerName();\n}')
    donor_random = _function(donor, 'BufferRandomHobbyOrLifestyleString')
    host_random = _function(base, 'BufferDeepLinkPhrase')
    adapted_random = rewrite_tokens(donor_random.source, {'BufferRandomHobbyOrLifestyleString': 'BufferDeepLinkPhrase',
                                                         'GetRandomWordFromAnyGroup': 'GetRandomEasyChatWordFromUnlockedGroup'})
    if _normalized(adapted_random) != _normalized(host_random.source):
        raise ValueError('shared hobby/lifestyle random-choice semantics changed')
    for group in ('hobbies', 'lifestyle'):
        words = [re.findall(r'_\("((?:[^"\\]|\\.)*)"\)',
                            (root / f'src/data/easy_chat/easy_chat_group_{group}.h').read_text())
                 for root in (base, donor)]
        if words[0] != words[1]:
            raise ValueError('EasyChat word sequence changed: ' + group)
    bodies.append('void FR_BufferRandomHobbyOrLifestyleString(void)\n{\n    BufferDeepLinkPhrase();\n}')
    # Keep the exact donor character-count wrapping criterion. The host
    # FrontierSpeechToString uses pixel widths and is not a valid replacement.
    donor_easy = (donor / 'src/easy_chat.c').read_text()
    ec = {f.name: f for f in functions(donor_easy, 'src/easy_chat.c')}
    exact_fit = rewrite_tokens(ec['EC_DoesEasyChatStringFitOnLine'].source,
                               {'EC_DoesEasyChatStringFitOnLine': 'FR_EC_DoesEasyChatStringFitOnLine'})
    easy_path = output / 'src/easy_chat.c'
    if not easy_path.exists():
        easy_path.write_text((base / 'src/easy_chat.c').read_text())
    easy = easy_path.read_text()
    if '/* BEGIN FIRERED_EC_CHAR_WRAP */' in easy:
        easy = easy[:easy.index('/* BEGIN FIRERED_EC_CHAR_WRAP */')].rstrip() + '\n'
    easy += '\n/* BEGIN FIRERED_EC_CHAR_WRAP */\n' + exact_fit + '\n'
    easy_path.write_text(easy)
    tower = (donor / 'src/battle_tower.c').read_text()
    tower_index = {f.name: f for f in functions(tower, 'src/battle_tower.c')}
    rename = {'BufferBattleTowerTrainerMessage': 'FR_UI_BufferBattleTowerTrainerMessage',
              'EC_DoesEasyChatStringFitOnLine': 'FR_EC_DoesEasyChatStringFitOnLine',
              'CopyEReaderTrainerName5': 'FR_UI_CopyEReaderTrainerName5',
              'BufferEReaderTrainerGreeting': 'FR_BufferEReaderTrainerGreeting',
              'BufferEReaderTrainerName': 'FR_BufferEReaderTrainerName'}
    for name in ('BufferBattleTowerTrainerMessage', 'CopyEReaderTrainerName5', 'BufferEReaderTrainerGreeting'):
        text = rewrite_tokens(tower_index[name].source, rename)
        text = text.replace('gSaveBlock2Ptr->battleTower.ereaderTrainer', 'gSaveBlock2Ptr->frontier.ereaderTrainer')
        bodies.append(text)
    bodies.append(rewrite_tokens(_function(donor, 'BufferEReaderTrainerName').source, rename))
    fan_source = (donor / 'src/trainer_fan_club.c').read_text()
    fan = {f.name: f for f in functions(fan_source, 'src/trainer_fan_club.c')}
    fan_names = {'Script_BufferFanClubTrainerName': 'FR_Script_BufferFanClubTrainerName',
                 'BufferFanClubTrainerName': 'FR_UI_BufferFanClubTrainerName',
                 'gText_LtSurge': 'FR_UI_gText_LtSurge', 'gText_Koga': 'FR_UI_gText_Koga'}
    for i in range(1,9):
        fan_names['FANCLUB_MEMBER' + str(i)] = str(i - 1)
    for name in ('BufferFanClubTrainerName', 'Script_BufferFanClubTrainerName'):
        text = rewrite_tokens(fan[name].source, fan_names)
        text = text.replace('gSaveBlock2Ptr->linkBattleRecords', 'gSaveBlock1Ptr->linkBattleRecords')
        text = text.replace('gSaveBlock1Ptr->rivalName', 'WholeGame_GetRivalName()')
        bodies.append(text)
    strings = (donor / 'src/strings.c').read_text()
    for name in ('gText_LtSurge', 'gText_Koga'):
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('fan-club donor name text missing')
        declarations.append(rewrite_tokens(match[0], fan_names))
    donor_string_index = {f.name: f for f in functions((donor / 'src/string_util.c').read_text(), 'src/string_util.c')}
    rival_function = donor_string_index['ExpandPlaceholder_RivalName']
    rival_names = {'ExpandPlaceholder_RivalName': 'FR_ExpandPlaceholder_RivalName',
                   'gExpandedPlaceholder_Red': 'FR_UI_gExpandedPlaceholder_Red',
                   'gExpandedPlaceholder_Green': 'FR_UI_gExpandedPlaceholder_Green'}
    rival_body = rival_function.source.replace('static u8 *ExpandPlaceholder_RivalName', 'const u8 *ExpandPlaceholder_RivalName')
    rival_body = rival_body.replace('gSaveBlock1Ptr->rivalName', 'WholeGame_GetRivalName()')
    bodies.append(rewrite_tokens(rival_body, rival_names))
    for name in ('gExpandedPlaceholder_Red', 'gExpandedPlaceholder_Green'):
        match = re.search(r'const u8 ' + name + r'\[\] = _\("[^"\n]*"\);', strings)
        if not match:
            raise ValueError('donor rival placeholder fallback missing')
        declarations.append(rewrite_tokens(match[0], rival_names))
    string_path = output / 'src/string_util.c'
    if not string_path.exists():
        string_path.write_text((base / 'src/string_util.c').read_text())
    native_strings = string_path.read_text()
    if 'return FR_ExpandPlaceholder_RivalName();' not in native_strings:
        function = [f for f in functions(native_strings, 'src/string_util.c') if f.name == 'ExpandPlaceholder_RivalName'][0]
        opening = function.start + function.source.index('{') + 1
        native_strings = native_strings[:opening] + '\n    if (WholeGame_IsKanto())\n        return FR_ExpandPlaceholder_RivalName();\n' + native_strings[opening:]
    if '#include "firered_native_ui.h"' not in native_strings:
        native_strings = '#include "firered_native_ui.h"\nextern bool8 WholeGame_IsKanto(void);\n' + native_strings
    string_path.write_text(native_strings)
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', 'const u8 *FR_ExpandPlaceholder_RivalName(void);\n#endif'))
    preamble = '\n'.join('#include "' + name + '"' for name in
                        ('global.h', 'easy_chat.h', 'event_data.h', 'string_util.h', 'constants/characters.h'))
    externs = '''
extern bool16 BufferUnionRoomPlayerName(void);
extern void BufferDeepLinkPhrase(void);
extern bool8 FR_EC_DoesEasyChatStringFitOnLine(const u16 *words, u8 columns, u8 rows, u16 maximum);
extern const u8 *WholeGame_GetRivalName(void);
'''
    prototypes = '\n'.join(body.split('{',1)[0].strip() + ';' for body in bodies)
    unit = preamble + '\n' + externs + '\n' + '\n'.join(declarations) + '\n' + prototypes + '\n\n' + '\n\n'.join(bodies) + '\n'
    target = output / 'src/firered_native/ui_text_buffers.c'
    target.write_text(unit)
    exported = ('BufferUnionRoomPlayerName', 'BufferRandomHobbyOrLifestyleString',
                'BufferEReaderTrainerGreeting', 'BufferEReaderTrainerName', 'Script_BufferFanClubTrainerName')
    for name in exported:
        f = _function(donor, name)
        providers.append({'name': name, 'target': 'FR_' + name, 'status': 'source-ported',
                          'source': f.key, 'sourceSha256': _digest(f.source),
                          'translationUnit': target.relative_to(output).as_posix(),
                          'bindings': ['shared host consume-once union-room name and exact hobby/lifestyle word sequence',
                                       'shared typed native eReader/frontier and link-battle records',
                                       'original donor character-count greeting wrapping and fan-club choice/name formatting',
                                       'actual campaign-owned rival name accessor'],
                          'blockers': ['Cartridge records/text/wireless behavior remains unqualified.']})
    providers.append({'name': 'ExpandPlaceholder_RivalName', 'target': 'FR_ExpandPlaceholder_RivalName', 'status': 'source-ported', 'source': rival_function.key, 'sourceSha256': _digest(rival_function.source), 'translationUnit': target.relative_to(output).as_posix(), 'bindings': ['actual regional string placeholder dispatch', 'campaign rival backing with exact donor GREEN/RED fallback'], 'blockers': ['Cartridge name display remains unqualified.']})
    return {'providers': providers, 'translationUnit': {'path': target.relative_to(output).as_posix(), 'sha256': _digest(unit)},
            'rivalPlaceholderPatch': {'path': 'src/string_util.c', 'sha256': _digest(native_strings)},
            'patch': {'path': 'src/easy_chat.c', 'sha256': _digest(easy)},
            'externalDependencies': ['WholeGame_GetRivalName']}


def _stage_hof_pc(base: Path, donor: Path, output: Path) -> dict:
    donor_source = (donor / 'src/hof_pc.c').read_text()
    index = {f.name: f for f in functions(donor_source, 'src/hof_pc.c')}
    rename = {'HallOfFamePCBeginFade': 'FR_HallOfFamePCBeginFade',
              'Task_WaitFadeAndSetCallback': 'FR_UI_Task_WaitFadeAndSetCallback',
              'CB2_InitHofPC': 'CB2_DoHallOfFamePC'}
    bodies = [rewrite_tokens(index[name].source, rename)
              for name in ('Task_WaitFadeAndSetCallback', 'HallOfFamePCBeginFade')]
    includes = ('global.h', 'hall_of_fame.h', 'main.h', 'palette.h', 'overworld.h',
                'task.h', 'window.h', 'bg.h', 'script.h', 'constants/rgb.h')
    unit = '\n'.join('#include "' + name + '"' for name in includes) + '\n\n' + '\n\n'.join(bodies) + '\n'
    target = output / 'src/firered_native/ui_hof_pc.c'
    target.write_text(unit)
    path = output / 'src/hof_pc.c'
    if not path.exists():
        path.write_text((base / 'src/hof_pc.c').read_text())
    host = path.read_text()
    old = '    ScriptMenu_CreatePCMultichoice();'
    new = '    if (WholeGame_IsKanto())\n        FR_CreatePCMenu();\n    else\n        ScriptMenu_CreatePCMultichoice();'
    if new not in host:
        if host.count(old) != 1:
            raise ValueError('native Hall-of-Fame PC return source changed')
        host = host.replace(old, new)
    if '#include "firered_native_ui.h"' not in host:
        host = '#include "firered_native_ui.h"\nextern bool8 WholeGame_IsKanto(void);\n' + host
    path.write_text(host)
    header = output / 'include/firered_native_ui.h'
    header.write_text(header.read_text().replace('#endif', 'void FR_HallOfFamePCBeginFade(void);\n#endif'))
    return {'providers': [{'name': 'HallOfFamePCBeginFade', 'target': 'FR_HallOfFamePCBeginFade',
                           'status': 'source-ported', 'source': index['HallOfFamePCBeginFade'].key,
                           'sourceSha256': _digest(index['HallOfFamePCBeginFade'].source),
                           'translationUnit': target.relative_to(output).as_posix(),
                           'bindings': ['original donor fade/wait/window cleanup before viewer entry',
                                        'real shared native CB2_DoHallOfFamePC saved-record viewer',
                                        'Kanto return uses actual donor PC menu; Hoenn keeps native PC menu'],
                           'policy': 'one shared native Hall-of-Fame save/view engine',
                           'blockers': ['Cartridge viewer/save/return behavior remains unqualified.',
                                        'Original donor championship/credits ending is owned separately.']}],
            'translationUnit': {'path': target.relative_to(output).as_posix(), 'sha256': _digest(unit)},
            'patch': {'path': path.relative_to(output).as_posix(), 'sha256': _digest(host)}}
