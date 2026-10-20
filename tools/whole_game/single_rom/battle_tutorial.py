"""Stage the original Oak and Old Man controller on the native battle core.

Distinct regional modes come from battle_modes.py and battle_services.py. No
donor battle flag bit is aliased onto an Emerald tutorial bit. The original
Oak and Old Man branches, including simulated inputs, are retained.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time

from .native_services import functions, masked
from .scripts import rewrite_tokens

CONTROLLER = 'src/battle_controller_oak_old_man.c'
TARGET = 'src/whole_game_battle_tutorial.c'
HEADER = 'include/whole_game_battle_tutorial.h'
MARK = '// WHOLE_GAME_OAK_TUTORIAL'
FONTS = {'FONT_MALE': 'FR_FONT_MALE', 'FONT_FEMALE': 'FR_FONT_FEMALE',
         'FONT_NORMAL': 'FR_FONT_NORMAL', 'FONT_NORMAL_COPY_1': 'FR_FONT_NORMAL_COPY_1',
         'FONT_SMALL': 'FR_FONT_SMALL'}
EXTERNAL = {
    'InitOldManBag': 'void {name}(void);',
    'OpenPartyMenuInTutorialBattle': 'void {name}(u8 partyAction);',
    'ContextNpcGetTextColor': 'u8 {name}(void);',
    'Menu_LoadStdPalAt': 'void {name}(u16 offset);',
    'LoadMenuMessageWindowGfx': 'void {name}(u8 windowId, u16 tileStart, u8 palette);',
}
TEXTS = ('gText_ForPetesSake', 'gText_TheTrainerThat', 'gText_TryBattling',
         'gText_InflictingDamageIsKey', 'gText_LoweringStats', 'gText_KeepAnEyeOnHP',
         'gText_OakNoRunningFromATrainer', 'gText_WinEarnsPrizeMoney', 'gText_HowDissapointing', 'gText_WhatWillOldManDo')


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _end_balanced(text, start, opening='{', closing='}'):
    clean = masked(text)
    if clean[start] != opening:
        raise ValueError('expected balanced source start')
    depth = 1
    end = start + 1
    while end < len(clean) and depth:
        depth += (clean[end] == opening) - (clean[end] == closing)
        end += 1
    if depth:
        raise ValueError('unbalanced source closure')
    return end


def _declaration(text, symbol):
    match = re.search(r'(?m)^(?:static\s+)?const\s+[^;\n]*\b' + re.escape(symbol) + r'\s*\[.*?=\s*\{', text)
    if not match:
        raise ValueError(f'missing declaration: {symbol}')
    stop = _end_balanced(text, text.index('{', match.start()))
    return text[match.start():text.index(';', stop) + 1]


def stage_battle_tutorial(emerald_source: Path, firered_source: Path, output_tree: Path,
                          report_dir: Path | None = None) -> dict:
    started = time.monotonic()
    base, donor, output = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    if any(output == source or output.is_relative_to(source) for source in (base, donor)) or output.name in ('pokeemerald', 'pokefirered'):
        raise ValueError('battle tutorial output must be outside canonical source trees')
    changes = {}
    def read(name):
        path = output / name
        return changes.get(name, path.read_text() if path.exists() else (base / name).read_text())
    def patch(name, old, new):
        text = read(name)
        if new in text:
            return
        if text.count(old) != 1:
            raise ValueError(f'{name}: expected unique Oak tutorial patch anchor {old!r}')
        changes[name] = text.replace(old, new)
    donor_controller = (donor / CONTROLLER).read_text()
    donor_message = (donor / 'src/battle_message.c').read_text()
    donor_functions = functions(donor_controller, CONTROLLER)
    names = {f.name: 'FR_' + f.name for f in donor_functions}
    names.update({name: 'FR_' + name for name in EXTERNAL})
    names.update({name: 'FR_' + name for name in TEXTS})
    names.update(FONTS)
    names.update({'CONTROLLER_UNKNOWNYESNOBOX': 'CONTROLLER_YESNOBOX',
                  'CONTROLLER_PLAYFANFARE': 'CONTROLLER_PLAYFANFAREORBGM',
                  'MovePpInfo': 'MovePPInfo', 'BUFFER_B': 'B_COMM_TO_ENGINE',
                  'HandleInputChooseMove': 'FR_HostHandleInputChooseMove',
                  'OpponentBufferExecCompleted': 'FR_HostOpponentBufferExecCompleted',
                  'DecompressTrainerBackPalette': 'FR_DecompressTrainerBackPalette',
                  'DoLoadHealthboxPalsForLevelUp': 'FR_DoLoadHealthboxPalsForLevelUp',
                  'DoFreeHealthboxPalsForLevelUp': 'FR_DoFreeHealthboxPalsForLevelUp',
                  'BattleStringShouldBeColored': 'FR_BattleStringShouldBeColored',
                  'BattlePutTextOnWindow': 'FR_BattlePutTextOnWindow',
                  'GetTextSpeedSetting': 'FR_GetTextSpeedSetting',
                  'TRAINER_BACK_PIC_OLD_MAN': 'FR_TRAINER_BACK_PIC_OLD_MAN'})
    controller = re.sub(r'^#include .+\n', '', donor_controller, flags=re.M)
    controller = controller.replace('gBattleStruct->simulatedInputState', 'FR_sOakSimulatedInputState')
    controller = controller.replace('gBattleStruct->playerPartyIdx', 'gBattleStruct->prevSelectedPartySlot')
    controller = controller.replace('gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE', 'WholeGame_IsFireRedTutorialBattle()')
    controller = controller.replace('gBattleTypeFlags & BATTLE_TYPE_OLD_MAN_TUTORIAL', 'WholeGame_IsFireRedOldManTutorialBattle()')
    controller = rewrite_tokens(controller, names)
    controller = controller.replace('        BufferStringBattle(*stringId);', '        if (*stringId == STRINGID_DONTLEAVEBIRCH)\n            gDisplayedStringBattle[0] = EOS;\n        else\n            BufferStringBattle(*stringId);')
    includes = re.findall(r'^#include .+$', (base / 'src/battle_controller_wally.c').read_text(), re.M)
    includes.extend(['#include "strings.h"', '#include "menu.h"', '#include "constants/battle_string_ids.h"',
                     '#include "whole_game_battle_tutorial.h"', '#include "event_data.h"'])
    # Donor's helper data/functions are copied exactly, with only namespaced
    # symbols and explicit host ABI mappings above.
    helper_sources = {
        'src/battle_anim_special.c': ('DoLoadHealthboxPalsForLevelUp', 'DoFreeHealthboxPalsForLevelUp'),
        'src/battle_gfx_sfx_util.c': ('DecompressTrainerBackPalette',),
        'src/battle_message.c': ('BattleStringShouldBeColored', 'BattlePutTextOnWindow'),
        'src/new_menu_helpers.c': ('GetTextSpeedSetting',),
    }
    helpers, provenance = [], []
    for relative, selected in helper_sources.items():
        original = (donor / relative).read_text()
        index = {f.name: f for f in functions(original, relative)}
        for name in selected:
            function = index[name]
            value = rewrite_tokens(function.source, names)
            # This renderer is only installed for Oak/OldMan, never Pokedude/link.
            if name == 'BattlePutTextOnWindow':
                value = value.replace('((gBattleTypeFlags & BATTLE_TYPE_POKEDUDE) && windowId != B_WIN_OAK_OLD_MAN)', 'FALSE')
            helpers.append(value)
            provenance.append({'source': function.key, 'sourceSha256': _sha(function.source), 'emittedSha256': _sha(value)})
    text_data = []
    for name in TEXTS:
        match = re.search(r'(?m)^const u8 ' + name + r'\[\] = _\("(?:[^"\\]|\\.)*"\);', donor_message)
        if not match:
            raise ValueError(f'missing exact Oak text: {name}')
        text_data.append(rewrite_tokens(match[0], names))
    struct_start = donor_message.index('struct BattleWindowText\n')
    struct_end = donor_message.index(';', _end_balanced(donor_message, donor_message.index('{', struct_start))) + 1
    table = rewrite_tokens(_declaration(donor_message, 'sTextOnWindowsInfo_Normal'), names)
    color_table = rewrite_tokens(_declaration(donor_message, 'sNpcTextColorToFont'), names)
    speed_table = _declaration((donor / 'src/new_menu_helpers.c').read_text(), 'sTextSpeedFrameDelays')
    # These enum values are donor-only, with their meanings retained explicitly.
    constants = '''#define B_WIN_OAK_OLD_MAN 24
#define B_TEXT_FLAG_NPC_CONTEXT_FONT (1 << 6)
#define FIRST_BATTLE_MSG_FLAG_STAT_CHG 2
#define FIRST_BATTLE_MSG_FLAG_HP_RESTORE 4
#define FIRST_BATTLE_MSG_FLAG_PARTY_MENU 8
#define NPC_TEXT_COLOR_MALE 0
#define NPC_TEXT_COLOR_FEMALE 1
#define NPC_TEXT_COLOR_MON 2
#define NPC_TEXT_COLOR_NEUTRAL 3
#define NPC_TEXT_COLOR_DEFAULT 255
'''
    # The header gives real declarations even when a separate provider is not
    # staged yet; the ledger below then blocks source build eligibility.
    header = '''#ifndef GUARD_WHOLE_GAME_BATTLE_TUTORIAL_H
#define GUARD_WHOLE_GAME_BATTLE_TUTORIAL_H
#include "whole_game_battle_modes.h"
#include "constants/battle_string_ids.h"
#define FR_FIRST_BATTLE_MSG_FLAG_PARTY_MENU 8
#define FR_TRAINER_BACK_PIC_OLD_MAN 8
bool8 WholeGame_IsFireRedOldManTutorialBattle(void);
extern u8 FR_sOakSimulatedInputState[4];
void FR_SetControllerToOakOrOldMan(void);
bool8 FR_BtlCtrl_OakOldMan_TestState2Flag(u8 mask);
void FR_BtlCtrl_OakOldMan_SetState2Flag(u8 mask);
void FR_BtlCtrl_DrawVoiceoverMessageFrame(void);
void FR_BtlCtrl_RemoveVoiceoverMessageFrame(void);
void FR_PrintOakText_InflictingDamageIsKey(void);
void FR_PrintOakText_HowDisappointing(void);
void FR_PrintOakText_OakNoRunningFromATrainer(void);
void FR_HostHandleInputChooseMove(void);
void FR_HostOpponentBufferExecCompleted(void);
void FR_BattlePutTextOnWindow(const u8 *text, u8 windowId);
bool8 FR_BattleStringShouldBeColored(u16 stringId);
void FR_DoLoadHealthboxPalsForLevelUp(u8 *paletteId1, u8 *paletteId2, u8 battler);
void FR_DoFreeHealthboxPalsForLevelUp(u8 battler);
void FR_DecompressTrainerBackPalette(u16 index, u8 palette);
u8 FR_GetTextSpeedSetting(void);
void FR_LoadOakVoiceoverGfx(void);
'''
    header += '\n'.join(template.format(name='FR_' + name) for name, template in EXTERNAL.items()) + '\n#endif\n'
    changes[HEADER] = header
    gfx = '''void FR_LoadOakVoiceoverGfx(void)
{
    if (WholeGame_IsFireRedTutorialBattle())
    {
        FR_Menu_LoadStdPalAt(BG_PLTT_ID(7));
        FR_LoadMenuMessageWindowGfx(0, 0x030, BG_PLTT_ID(7));
        gPlttBufferUnfaded[BG_PLTT_ID(7) + 6] = RGB(0, 0, 0);
        CpuCopy16(&gPlttBufferUnfaded[BG_PLTT_ID(7) + 6], &gPlttBufferFaded[BG_PLTT_ID(7) + 6], PLTT_SIZEOF(1));
    }
}
'''
    changes[TARGET] = '\n'.join(includes) + '\n' + constants + '\nEWRAM_DATA u8 FR_sOakSimulatedInputState[4] = {0};\n' + donor_message[struct_start:struct_end] + '\n' + table + '\n' + color_table + '\n' + speed_table + '\n' + '\n'.join(text_data) + '\n' + controller + '\n' + '\n\n'.join(helpers) + '\n' + gfx
    # Bridge existing native callbacks, which remain static/private otherwise.
    for file, body in (
        ('src/battle_controller_player.c', 'void FR_HostHandleInputChooseMove(void)\n{\n    HandleInputChooseMove();\n}\n'),
        ('src/battle_controller_opponent.c', 'void FR_HostOpponentBufferExecCompleted(void)\n{\n    OpponentBufferExecCompleted();\n}\n'),
    ):
        value = read(file)
        if body not in value:
            changes[file] = value + '\n' + body
    include = '#include "whole_game_battle_tutorial.h"\n'
    for file in ('src/battle_controllers.c', 'src/battle_script_commands.c', 'src/battle_controller_opponent.c', 'src/battle_bg.c', 'src/battle_main.c'):
        value = read(file)
        if include not in value:
            changes[file] = value.replace('#include "global.h"\n', '#include "global.h"\n' + include, 1)
    native_route = '        else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)\n            gBattlerControllerFuncs[B_BATTLER_0] = SetControllerToWally;'
    oak_route = native_route + '\n        else if (WholeGame_IsFireRedTutorialBattle())\n            gBattlerControllerFuncs[B_BATTLER_0] = FR_SetControllerToOakOrOldMan;'
    both_route = native_route + '\n        else if (WholeGame_IsFireRedTutorialBattle() || WholeGame_IsFireRedOldManTutorialBattle())\n            gBattlerControllerFuncs[B_BATTLER_0] = FR_SetControllerToOakOrOldMan;'
    patch('src/battle_controllers.c', oak_route if oak_route in read('src/battle_controllers.c') else native_route, both_route)
    # Exact donor early accuracy gate, placed before existing Emerald accuracy
    # logic. Preserve RNG order in the critical-hit gate by testing after RNG.
    donor_commands = (donor / 'src/battle_script_commands.c').read_text()
    accuracy_start = donor_commands.index('    if ((gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE', donor_commands.index('static void Cmd_accuracycheck(void)\n{'))
    accuracy_stop = donor_commands.index('    if (move == NO_ACC_CALC', accuracy_start)
    accuracy = donor_commands[accuracy_start:accuracy_stop]
    accuracy = accuracy[:accuracy.index('     || (gBattleTypeFlags & BATTLE_TYPE_POKEDUDE))')] + ')\n' + accuracy[accuracy.index('    {'):]
    accuracy = accuracy.replace('gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE', 'WholeGame_IsFireRedTutorialBattle()')
    accuracy = rewrite_tokens(accuracy, names)
    anchor = 'static void Cmd_accuracycheck(void)\n{\n    u16 move = T2_READ_16(gBattlescriptCurrInstr + 5);\n\n'
    patch('src/battle_script_commands.c', anchor, anchor + accuracy)
    legacy_critical = '     && !(Random() % sCriticalHitChance[critChance])\n     && (!WholeGame_IsFireRedTutorialBattle() || FR_BtlCtrl_OakOldMan_TestState2Flag(1)))'
    new_critical = '     && !WholeGame_IsFireRedOldManTutorialBattle()\n' + legacy_critical
    patch('src/battle_script_commands.c',
          legacy_critical if legacy_critical in read('src/battle_script_commands.c') else '     && !(Random() % sCriticalHitChance[critChance]))', new_critical)
    # Opponent native controller remains host-owned; insert only donor tutorial
    # callbacks at the same original completion and string dispatch boundaries.
    patch('src/battle_controller_opponent.c',
          '    else\n        OpponentBufferExecCompleted();\n}\n\nstatic void HideHealthboxAfterMonFaint',
          '    else if (WholeGame_IsFireRedTutorialBattle() && !FR_BtlCtrl_OakOldMan_TestState2Flag(1))\n    {\n        FR_BtlCtrl_OakOldMan_SetState2Flag(1);\n        gBattlerControllerFuncs[gActiveBattler] = FR_PrintOakText_InflictingDamageIsKey;\n    }\n    else\n        OpponentBufferExecCompleted();\n}\n\nstatic void HideHealthboxAfterMonFaint')
    opponent_anchor = '    BattlePutTextOnWindow(gDisplayedStringBattle, B_WIN_MSG);\n    gBattlerControllerFuncs[gActiveBattler] = CompleteOnInactiveTextPrinter;\n    BattleArena_DeductSkillPoints(gActiveBattler, *stringId);'
    opponent_new = '''    if (WholeGame_IsFireRedTutorialBattle())
    {
        if (*stringId == STRINGID_DONTLEAVEBIRCH)
            gDisplayedStringBattle[0] = EOS;
        FR_BattlePutTextOnWindow(gDisplayedStringBattle, B_WIN_MSG | (FR_BattleStringShouldBeColored(*stringId) ? B_TEXT_FLAG_NPC_CONTEXT_FONT : 0));
        if (*stringId == STRINGID_TRAINER1WINTEXT)
        {
            gBattlerControllerFuncs[gActiveBattler] = FR_PrintOakText_HowDisappointing;
            return;
        }
        if (*stringId == STRINGID_DONTLEAVEBIRCH)
        {
            gBattlerControllerFuncs[gActiveBattler] = FR_PrintOakText_OakNoRunningFromATrainer;
            return;
        }
    }
    else
        BattlePutTextOnWindow(gDisplayedStringBattle, B_WIN_MSG);
    gBattlerControllerFuncs[gActiveBattler] = CompleteOnInactiveTextPrinter;
    BattleArena_DeductSkillPoints(gActiveBattler, *stringId);'''.replace('B_TEXT_FLAG_NPC_CONTEXT_FONT', '(1 << 6)')
    patch('src/battle_controller_opponent.c', opponent_anchor, opponent_new)
    patch('src/battle_main.c',
          '    if (gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE)\n    {\n        gBattleCommunication[MULTISTRING_CHOOSER] = B_MSG_DONT_LEAVE_BIRCH;',
          '    if ((gBattleTypeFlags & BATTLE_TYPE_FIRST_BATTLE) || WholeGame_IsFireRedTutorialBattle())\n    {\n        gBattleCommunication[MULTISTRING_CHOOSER] = B_MSG_DONT_LEAVE_BIRCH;')
    main_source = read('src/battle_main.c')
    finish = next(f for f in functions(main_source, 'src/battle_main.c') if f.name == 'HandleEndTurn_FinishBattle')
    if 'WholeGame_IsFireRedTutorialBattle()' not in finish.source:
        old = '| BATTLE_TYPE_FRONTIER)))'
        if finish.source.count(old) != 1:
            raise ValueError('ambiguous battle results tutorial exclusion')
        updated = finish.source.replace(old, '| BATTLE_TYPE_FRONTIER))\n         && !WholeGame_IsFireRedTutorialBattle())', 1)
        changes['src/battle_main.c'] = main_source[:finish.start] + updated + main_source[finish.end:]
    # In the donor the Birch battle string is deliberately empty. Ensure the
    # source Oak no-running message is the only text in this regional branch.
    # Add a region-specific template list so native Emerald allocates precisely
    # its original windows; tutorial window 24 shares donor base block 0x90.
    bg = read('src/battle_bg.c')
    if 'sWholeGameOakWindowTemplates' not in bg:
        template = _declaration((donor / 'src/battle_bg.c').read_text(), 'sStandardBattleWindowTemplates')
        template = template.replace('sStandardBattleWindowTemplates', 'sWholeGameOakWindowTemplates').replace('[B_WIN_OAK_OLD_MAN]', '[24]')
        original = _declaration(bg, 'sStandardBattleWindowTemplates')
        changes['src/battle_bg.c'] = bg.replace(original, original + '\n\n' + template)
    legacy_windows = '    InitWindows(WholeGame_IsFireRedTutorialBattle() ? sWholeGameOakWindowTemplates : gBattleWindowTemplates[gBattleScripting.windowsType]);'
    patch('src/battle_bg.c', legacy_windows if legacy_windows in read('src/battle_bg.c') else '    InitWindows(gBattleWindowTemplates[gBattleScripting.windowsType]);',
          '    InitWindows((WholeGame_IsFireRedTutorialBattle() || WholeGame_IsFireRedOldManTutorialBattle()) ? sWholeGameOakWindowTemplates : gBattleWindowTemplates[gBattleScripting.windowsType]);')
    # All battle graphics loading and menu-return paths share this entry point.
    bg = read('src/battle_bg.c')
    function = next(f for f in functions(bg, 'src/battle_bg.c') if f.name == 'LoadBattleMenuWindowGfx')
    if 'FR_LoadOakVoiceoverGfx();' not in function.source:
        patched = function.source[:-1] + '    FR_LoadOakVoiceoverGfx();\n}'
        changes['src/battle_bg.c'] = bg[:function.start] + patched + bg[function.end:]
    available = set()
    for path in (output / 'src').rglob('*.c'):
        available.update(f.name for f in functions(path.read_text(), str(path)) if not f.static)
    missing = []
    for name in EXTERNAL:
        if 'FR_' + name not in available:
            missing.append({'kind': 'missing-tutorial-provider', 'symbol': 'FR_' + name})
    for font in FONTS.values():
        if not re.search(r'\b' + font + r'\b', read('include/text.h')):
            missing.append({'kind': 'missing-exact-donor-font', 'symbol': font})
    if not (output / 'include/whole_game_battle_modes.h').exists() or 'WholeGame_IsFireRedTutorialBattle' not in available:
        missing.append({'kind': 'missing-regional-battle-mode', 'symbol': 'WholeGame_IsFireRedTutorialBattle'})
    if 'WholeGame_IsFireRedOldManTutorialBattle' not in available:
        missing.append({'kind': 'missing-regional-old-man-mode', 'symbol': 'WholeGame_IsFireRedOldManTutorialBattle'})
    if not (output / 'src/whole_game_old_man_tutorial_assets.c').exists():
        missing.append({'kind': 'missing-original-old-man-art', 'symbol': 'FR_OldManBackPixels'})
    for name, value in changes.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    report = {'schemaVersion': 1, 'status': 'blocked' if missing else 'source-staged',
              'ready': not missing, 'buildEligible': not missing, 'unresolved': missing,
              'files': sorted(changes), 'controller': {'source': CONTROLLER, 'sourceSha256': _sha(donor_controller),
                  'functionCount': len(donor_functions), 'specialization': 'original Oak and Old Man arms retained; separate regional predicates',
                  'state': 'dedicated four-byte FR_sOakSimulatedInputState; no host BattleStruct offset assumptions'},
              'helpers': provenance,
              'hooks': ['native single-player controller routing', 'guaranteed initial damage/status move accuracy',
                        'tutorial state-gated critical hits after native RNG', 'opponent first-damage voiceover',
                        'trainer loss/no-running voiceovers', 'run prohibition', 'source tutorial exclusion from battle result/TV recording', 'region-only Oak window and graphics'],
              'qualification': 'source staging only; target compilation/provider closure and cartridge play remain required',
              'measurements': {'transformSeconds': time.monotonic() - started, 'buildSeconds': None, 'queueSeconds': None, 'nativeExecutionSeconds': None},
              'canonicalSourcesModified': False}
    if report_dir is not None:
        directory = Path(report_dir); directory.mkdir(parents=True, exist_ok=True)
        (directory / 'battle-tutorial-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
