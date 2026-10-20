"""Source-native FireRed trainer battle mode integration into staged Emerald.

The original FireRed early-rival mode9 is allocated13, beyond native0..12.
The Oak tutorial controller is a separate mandatory provider, never Birch's flag.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .encounters import source_function, array_span

EARLY_RIVAL_MODE = 13
REQUIRED_SERVICES = ('FR_QuestLogEvents_HandleEndTrainerBattle', 'FR_QL_FinishRecordingScene',
                     'FR_GetRematchTrainerId', 'FR_ClearRematchStateOfLastTalked',
                     'FR_ResetDeferredLinkEvent', 'FR_ComputeWhiteOutMoneyLoss')


def stage_battle_modes(base, donor, out, report_dir=None):
    started = time.monotonic()
    base, donor, out = map(lambda p: Path(p).resolve(), (base, donor, out))
    for original in (base, donor):
        if original == out or original in out.parents or out in original.parents:
            raise ValueError('battle mode output must be isolated from original sources')
    native = (out / 'src/battle_setup.c').read_text()
    source = (donor / 'src/battle_setup.c').read_text()
    if 'WholeGame_TrainerFlag' not in native:
        raise ValueError('state stage with namespaced trainer flags must run first')
    if 'sWholeGameRivalBattleFlags' in native:
        raise ValueError('battle modes already staged; start from a fresh merge')
    changed = []
    def write(relative, text):
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        changed.append(relative)
    def replace(text, old, new, count=1):
        if text.count(old) != count:
            raise ValueError(f'expected {count} battle anchor {old!r}, got {text.count(old)}')
        return text.replace(old, new)
    donor_constants = (donor / 'include/constants/battle_setup.h').read_text()
    host_constants = (base / 'include/constants/battle_setup.h').read_text()
    parse = lambda text: {n: int(v) for n, v in re.findall(r'^#define\s+(TRAINER_BATTLE_\w+)\s+(\d+)', text, re.M)}
    donor_modes, host_modes = parse(donor_constants), parse(host_constants)
    if set(donor_modes.values()) != set(range(10)):
        raise ValueError('unexpected donor trainer modes')
    for name, value in donor_modes.items():
        if name != 'TRAINER_BATTLE_EARLY_RIVAL' and host_modes.get(name) != value:
            raise ValueError('non-early donor mode differs: ' + name)
    # Ensure descriptor byte layout is the original common ABI for modes0..8.
    layouts = ('sOrdinaryBattleParams', 'sContinueScriptBattleParams', 'sDoubleBattleParams',
               'sOrdinaryNoIntroBattleParams', 'sContinueScriptDoubleBattleParams')
    descriptor_audit = {}
    original_host = (base / 'src/battle_setup.c').read_text()
    for name in layouts:
        a, b = array_span(source, name); donor_body = source[a:b]
        a, b = array_span(original_host, name); host_body = original_host[a:b]
        if re.sub(r'\s+', '', donor_body) != re.sub(r'\s+', '', host_body):
            raise ValueError('trainer descriptor ABI differs: ' + name)
        descriptor_audit[name] = 'identical source descriptor fields/types/order'
    constants = ['#ifndef GUARD_WHOLE_GAME_FR_BATTLE_MODES_H', '#define GUARD_WHOLE_GAME_FR_BATTLE_MODES_H']
    for name, value in sorted(donor_modes.items()):
        constants.append(f'#define FR_{name} {EARLY_RIVAL_MODE if value == 9 else value}')
    constants += ['#define FR_RIVAL_BATTLE_HEAL_AFTER 1', '#define FR_RIVAL_BATTLE_TUTORIAL 3', '#endif', '']
    write('include/constants/whole_game_fr_battle_modes.h', '\n'.join(constants))
    write('include/whole_game_battle_modes.h', '''#ifndef GUARD_WHOLE_GAME_BATTLE_MODES_H
#define GUARD_WHOLE_GAME_BATTLE_MODES_H
#include "constants/whole_game_fr_battle_modes.h"
u16 GetRivalBattleFlags(void);
bool8 WholeGame_IsFireRedTutorialBattle(void);
bool8 WholeGame_IsFireRedTrainerBattle(void);
extern const u8 FR_BattleScript_RivalBattleLost[];
extern const u8 FR_BattleScript_LocalBattleLostPrintWhiteOut[];
void FR_QuestLogEvents_HandleEndTrainerBattle(void);
void FR_QL_FinishRecordingScene(void);
int FR_GetRematchTrainerId(u16 trainerId);
void FR_ClearRematchStateOfLastTalked(void);
void FR_ResetDeferredLinkEvent(void);
#endif
''')
    battle_constants = (out / 'include/constants/battle_setup.h').read_text()
    write('include/constants/battle_setup.h', battle_constants.replace('#endif', '#include "constants/whole_game_fr_battle_modes.h"\n\n#endif', 1))
    native = replace(native, '#include "global.h"', '#include "global.h"\n#include "whole_game_battle_modes.h"')
    native = replace(native, 'EWRAM_DATA static u16 sTrainerBattleMode = 0;', 'EWRAM_DATA static u16 sTrainerBattleMode = 0;\nEWRAM_DATA static u16 sWholeGameRivalBattleFlags = 0;')
    a, b = array_span(source, 'sEarlyRivalBattleParams')
    descriptor = 'static const struct TrainerBattleParameter sWholeGameEarlyRivalBattleParams[] =\n{' + source[a:b].replace('sRivalBattleFlags', 'sWholeGameRivalBattleFlags') + '};\n\n'
    native = replace(native, 'static const struct TrainerBattleParameter sOrdinaryBattleParams[] =', descriptor + 'static const struct TrainerBattleParameter sOrdinaryBattleParams[] =')
    init = source_function(native, 'InitTrainerBattleVariables')
    native = native.replace(init, init.replace('    sTrainerBattleMode = 0;', '    sTrainerBattleMode = 0;\n    sWholeGameRivalBattleFlags = 0;'), 1)
    configure = source_function(native, 'BattleSetup_ConfigureTrainerBattle')
    configure_new = configure.replace('    case TRAINER_BATTLE_SINGLE_NO_INTRO_TEXT:', '''    case FR_TRAINER_BATTLE_EARLY_RIVAL:
        // Original FireRed layout: rival flags occupy the local-id u16 slot,
        // followed by defeat AND victory text pointers, then return address.
        gApproachingTrainerId = 0;
        gNoOfApproachingTrainers = 0;
        gTrainerBattleOpponent_B = 0;
        TrainerBattleLoadArgs(sWholeGameEarlyRivalBattleParams, data);
        return EventScript_DoNoIntroTrainerBattle;
    case TRAINER_BATTLE_SINGLE_NO_INTRO_TEXT:''', 1)
    # FireRed rematches must use VS Seeker, never the Hoenn Match Call table.
    for mode in ('TRAINER_BATTLE_REMATCH_DOUBLE', 'TRAINER_BATTLE_REMATCH'):
        configure_new = configure_new.replace('    case ' + mode + ':', '    case ' + mode + ':\n        if (WholeGame_IsKanto()) FR_QL_FinishRecordingScene();', 1)
    configure_new = configure_new.replace('gTrainerBattleOpponent_A = GetRematchTrainerId(gTrainerBattleOpponent_A);', 'gTrainerBattleOpponent_A = WholeGame_IsKanto()\n            ? FR_GetRematchTrainerId(gTrainerBattleOpponent_A)\n            : GetRematchTrainerId(gTrainerBattleOpponent_A);')
    native = native.replace(configure, configure_new, 1)
    donor_callback = source_function(source, 'CB2_EndTrainerBattle')
    first_branch = donor_callback[donor_callback.index('    if (sTrainerBattleMode'):donor_callback.index('\n    else\n    {\n        if (gTrainerBattleOpponent_A')]
    first_branch = first_branch.replace('TRAINER_BATTLE_EARLY_RIVAL', 'FR_TRAINER_BATTLE_EARLY_RIVAL').replace('sRivalBattleFlags', 'sWholeGameRivalBattleFlags').replace('RIVAL_BATTLE_HEAL_AFTER', 'FR_RIVAL_BATTLE_HEAL_AFTER').replace('SetBattledTrainerFlag();', 'SetTrainerFlag(gTrainerBattleOpponent_A);').replace('QuestLogEvents_HandleEndTrainerBattle();', 'FR_QuestLogEvents_HandleEndTrainerBattle();')
    # Return after the complete donor branch so native loss handling cannot
    # overwrite healed-loss continuation or its VAR_RESULT story outcome.
    first_branch = first_branch[:-1] + '    return;\n    }'
    callback = source_function(native, 'CB2_EndTrainerBattle')
    ordinary_branch = '''
    if (WholeGame_IsFireRedTrainerBattle())
    {
        if (IsPlayerDefeated(gBattleOutcome))
            SetMainCallback2(CB2_WhiteOut);
        else
        {
            SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
            SetBattledTrainersFlags();
            FR_QuestLogEvents_HandleEndTrainerBattle();
        }
        return;
    }
'''
    native = native.replace(callback, callback.replace('{\n', '{\n' + first_branch + '\n' + ordinary_branch, 1), 1)
    rematch = source_function(native, 'CB2_EndRematchBattle')
    branch = '''
    if (WholeGame_IsFireRedTrainerBattle())
    {
        if (IsPlayerDefeated(gBattleOutcome))
            SetMainCallback2(CB2_WhiteOut);
        else
        {
            SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
            SetTrainerFlag(gTrainerBattleOpponent_A);
            FR_ClearRematchStateOfLastTalked();
            FR_ResetDeferredLinkEvent();
        }
        return;
    }
'''
    native = native.replace(rematch, rematch.replace('{\n', '{\n' + branch, 1), 1)
    native += '''
// FireRed tutorial identity is separate from Emerald's Birch FIRST_BATTLE bit.
u16 GetRivalBattleFlags(void)
{
    return sWholeGameRivalBattleFlags;
}
bool8 WholeGame_IsFireRedTutorialBattle(void)
{
    return (gBattleTypeFlags & BATTLE_TYPE_TRAINER)
        && WholeGame_IsFireRedTrainerBattle()
        && sTrainerBattleMode == FR_TRAINER_BATTLE_EARLY_RIVAL
        && (sWholeGameRivalBattleFlags & FR_RIVAL_BATTLE_TUTORIAL);
}
bool8 WholeGame_IsFireRedTrainerBattle(void)
{
    return gTrainerBattleOpponent_A > 4096 && gTrainerBattleOpponent_A < 4864;
}
'''
    write('src/battle_setup.c', native)
    main = (out / 'src/battle_main.c').read_text()
    main = replace(main, '#include "global.h"', '#include "global.h"\n#include "whole_game_battle_modes.h"')
    loss = source_function(main, 'HandleEndTurn_BattleLost')
    prefix = '''
    if ((gBattleTypeFlags & BATTLE_TYPE_TRAINER)
     && GetTrainerBattleMode() == FR_TRAINER_BATTLE_EARLY_RIVAL)
    {
        gBattleCommunication[MULTISTRING_CHOOSER] =
            (GetRivalBattleFlags() & FR_RIVAL_BATTLE_HEAL_AFTER) ? 1 : 2;
        gBattlerAttacker = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
        gBattlescriptCurrInstr = FR_BattleScript_RivalBattleLost;
        gBattleMainFunc = HandleEndTurn_FinishBattle;
        return;
    }
'''
    prefix += '''
    if ((gBattleTypeFlags & BATTLE_TYPE_TRAINER) && WholeGame_IsFireRedTrainerBattle())
    {
        gBattleCommunication[MULTISTRING_CHOOSER] = 0;
        gBattlescriptCurrInstr = FR_BattleScript_LocalBattleLostPrintWhiteOut;
        gBattleMainFunc = HandleEndTurn_FinishBattle;
        return;
    }
'''
    main = main.replace(loss, loss.replace('    gCurrentActionFuncId = 0;', '    gCurrentActionFuncId = 0;\n' + prefix, 1), 1)
    write('src/battle_main.c', main)
    donor_script = (donor / 'data/battle_scripts_1.s').read_text()
    rival_script = donor_script[donor_script.index('BattleScript_LocalBattleLostPrintWhiteOut::'):donor_script.index('BattleScript_BattleTowerLost::')]
    local_labels = set(re.findall(r'^(\w+)::', rival_script, re.M))
    rival_script = re.sub(r'\b[A-Za-z_]\w*\b', lambda m: 'FR_' + m[0] if m[0] in local_labels else m[0], rival_script)
    rival_script = rival_script.replace('getmoneyreward ', 'wholegame_fr_getmoneyreward ')
    # Import the five original loss strings with fresh IDs. Their source IDs
    # collide with unrelated Emerald strings; no numeric passthrough is used.
    donor_message = (donor / 'src/battle_message.c').read_text()
    native_message = (out / 'src/battle_message.c').read_text()
    strings_header = (out / 'include/constants/battle_string_ids.h').read_text()
    count_match = re.search(r'(#define BATTLESTRINGS_COUNT\s+)(\d+)', strings_header)
    if not count_match: raise ValueError('missing native battle string count')
    first_string_id = int(count_match[2])
    string_map = {
        'STRINGID_PLAYERWHITEOUT': 'sText_PlayerWhiteout',
        'STRINGID_PLAYERWHITEOUT2': 'sText_PlayerPanicked',
        'STRINGID_PLAYERLOSTAGAINSTENEMYTRAINER': 'sText_PlayerWhiteoutAgainstTrainer',
        'STRINGID_PLAYERPAIDPRIZEMONEY': 'sText_PlayerPaidAsPrizeMoney',
        'STRINGID_PLAYERWHITEDOUT': 'sText_PlayerWhiteout2',
    }
    string_definitions, string_entries, extra_constants = [], [], []
    for offset, (constant, symbol) in enumerate(string_map.items()):
        definition = re.search(r'^static const u8 ' + symbol + r'\[\] = _\("(?:\\.|[^"\\])*"\);', donor_message, re.M)
        if not definition: raise ValueError('missing source loss text ' + symbol)
        string_definitions.append(definition[0].replace(symbol, 'FR_' + symbol, 1))
        string_entries.append(f'    [FR_{constant} - BATTLESTRINGS_TABLE_START] = FR_{symbol},')
        extra_constants.append(f'#define FR_{constant} {first_string_id + offset}')
    rival_script = re.sub(r'\bSTRINGID_\w+\b', lambda m: 'FR_' + m[0] if m[0] in string_map else m[0], rival_script)
    strings_header = strings_header[:count_match.start(2)] + str(first_string_id + len(string_map)) + strings_header[count_match.end(2):]
    strings_header = strings_header.replace('#endif', '\n'.join(extra_constants) + '\n#endif', 1)
    write('include/constants/battle_string_ids.h', strings_header)
    a, b = array_span(native_message, 'gBattleStringsTable')
    native_message = native_message[:b] + '\n' + '\n'.join(string_entries) + '\n' + native_message[b:]
    native_message = native_message.replace('const u8 *const gBattleStringsTable[', '\n'.join(string_definitions) + '\n\nconst u8 *const gBattleStringsTable[', 1)
    write('src/battle_message.c', native_message)
    script_macro = '.macro wholegame_fr_getmoneyreward target:req\n    .byte 0xF9\n    .4byte \\target\n.endm\n'
    write('data/battle_scripts_1.s', (out / 'data/battle_scripts_1.s').read_text() + '\n@ Original FireRed trainer loss: distinct money-command ABI.\n' + script_macro + rival_script)
    # Native getmoneyreward is one byte; FR has a 32-bit jump operand. Give the
    # exact donor handler its own opcode, retaining both original interpreters.
    commands = (out / 'src/battle_script_commands.c').read_text()
    if '[0xF9]' in commands or '[0xf9]' in commands:
        raise ValueError('battle opcode0xF9 already allocated')
    source_money = source_function((donor / 'src/battle_script_commands.c').read_text(), 'Cmd_getmoneyreward')
    source_money = source_money.replace('Cmd_getmoneyreward', 'Cmd_FR_GetMoneyReward', 1).replace('ComputeWhiteOutMoneyLoss()', 'FR_ComputeWhiteOutMoneyLoss()')
    commands = commands.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_travel.h"\nstatic void Cmd_FR_GetMoneyReward(void);', 1)
    a, b = array_span(commands, 'gBattleScriptingCommandsTable')
    commands = commands[:b] + '\n    , [0xF9] = Cmd_FR_GetMoneyReward\n' + commands[b:]
    write('src/battle_script_commands.c', commands + '\n\n' + source_money + '\n')
    ledger = {'component': 'battle_modes', 'status': 'partial', 'buildEligible': False,
        'changed_files': changed, 'earlyRivalMode': EARLY_RIVAL_MODE,
        'modeMap': {n: (13 if v == 9 else v) for n, v in donor_modes.items()},
        'descriptorAudit': descriptor_audit,
        'coverage': ['all ten donor mode IDs audited', 'mode13 original early-rival argument descriptor', 'loss/win/draw story result and optional heal/whiteout source branch', 'defeat and victory speech pointers retained', 'donor regular/rematch callback separation from Hoenn Match Call', 'original rival-loss battle script and opponent-side display', 'native modes9..12 retained', 'no donor Birch first-battle flag', 'source FR loss money handler with distinct opcodeF9 and32bit branch operand', 'five original loss messages assigned fresh native string IDs'],
        'requiredNativeSymbols': list(REQUIRED_SERVICES),
        'unresolved': ['Oak tutorial controller and initial accuracy/crit/AI behavior require battle_tutorial provider.', 'Required quest-log and VS Seeker helper providers must resolve original FR source dependencies.', 'Native cartridge early-rival outcomes, return script continuation and complete campaign qualification remain unrun.', 'Safari battle core is owned by world_services and remains separate from trainer-mode import.'],
        'sourcePins': {relative: hashlib.sha256((donor / relative).read_bytes()).hexdigest() for relative in ('src/battle_setup.c', 'src/battle_main.c', 'data/battle_scripts_1.s', 'include/constants/battle_setup.h', 'src/battle_script_commands.c', 'src/battle_message.c')},
        'durationSeconds': time.monotonic() - started}
    if report_dir:
        report_dir = Path(report_dir); report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / 'battle-modes-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n')
    return ledger
