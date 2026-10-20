"""Port the ten FireRed-only script handlers into a staged Emerald engine.

Handler extraction preserves donor operands and return/yield semantics. External
UI/quest-log providers remain explicit build gates until their source exists;
appending an opcode does not qualify its transitive native dependencies.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import time

from .native_services import functions, masked
from .scripts import rewrite_tokens

COMMANDS = (
    'comparestat', 'setworldmapflag', 'textcolor', 'loadhelp', 'unloadhelp',
    'getbraillestringwidth', 'signmsg', 'normalmsg',
    'setmonmodernfatefulencounter', 'checkmonmodernfatefulencounter',
)
PROVIDERS = {
    'GetGameStat': 'u32 {name}(u8 statId);',
    'QuestLog_RecordEnteredMap': 'void {name}(u16 worldMapFlag);',
    'MapPreview_SetFlag': 'void {name}(u16 flagId);',
    'DrawHelpMessageWindowWithText': 'void {name}(const u8 *text);',
    'GetStartMenuWindowId': 'u8 {name}(void);',
    'DestroyHelpMessageWindow_': 'void {name}(void);',
    'MsgSetSignpost': 'void {name}(void);',
    'MsgSetNotSignpost': 'void {name}(void);',
}
BEGIN = '// BEGIN WHOLE_GAME_FIRERED_OPCODES\n'
END = '// END WHOLE_GAME_FIRERED_OPCODES\n'
TABLE_BEGIN = '\t@ BEGIN WHOLE_GAME_FIRERED_OPCODES\n'
TABLE_END = '\t@ END WHOLE_GAME_FIRERED_OPCODES\n'
ENTRY = re.compile(r'(?m)^\s*script_cmd_table_entry\s+(\w+)\s+(\w+)\b')


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _unpatch(text, begin, end):
    if begin not in text and end not in text:
        return text
    if text.count(begin) != 1 or text.count(end) != 1:
        raise ValueError('malformed or repeated opcode staging marker')
    start, stop = text.index(begin), text.index(end)
    if stop < start:
        raise ValueError('opcode staging markers out of order')
    return text[:start] + text[stop + len(end):]


def stage_native_opcodes(emerald_source: Path, firered_source: Path, output_tree: Path,
                         report_dir: Path | None = None, *, symbol_map: dict | None = None) -> dict:
    """Append real source handlers and return compiler mappings plus build gates.

    This cheap source transform performs no ROM build. Input trees are read only.
    Run after state/native service staging and before script macro compilation.
    """
    started = time.monotonic()
    base, donor, output = map(lambda p: Path(p).resolve(),
                              (emerald_source, firered_source, output_tree))
    if any(output == source or output.is_relative_to(source) for source in (base, donor)):
        raise ValueError('opcode output must be outside immutable source trees')
    if output.name in ('pokeemerald', 'pokefirered'):
        raise ValueError('refusing canonical source destination')
    source_name, table_name = 'src/scrcmd.c', 'data/script_cmd_table.inc'
    def staged_or_base(name):
        path = output / name
        return path.read_text() if path.exists() else (base / name).read_text()
    source = _unpatch(staged_or_base(source_name), BEGIN, END)
    table = _unpatch(staged_or_base(table_name), TABLE_BEGIN, TABLE_END)
    entries = ENTRY.findall(table)
    if not entries or len({constant for constant, _ in entries}) != len(entries):
        raise ValueError('missing or ambiguous Emerald command table')
    if len(entries) + len(COMMANDS) > 256:
        raise ValueError('FireRed opcode extensions exceed one-byte dispatch range')
    anchor = '\t.if ALLOCATE_SCRIPT_CMD_TABLE\ngScriptCmdTableEnd::'
    if table.count(anchor) != 1:
        raise ValueError('missing unique command-table end anchor')
    original = (donor / source_name).read_text()
    index = {function.name: function for function in functions(original, source_name)}
    names = {name: 'FR_' + name for name in PROVIDERS}
    # A caller can select a qualified, explicitly named provider, never silently
    # fall back to a same-named Emerald service with different private state.
    names.update({name: target for name, target in (symbol_map or {}).items() if name in PROVIDERS})
    names.update({'ScrCmd_' + name: 'FR_ScrCmd_' + name for name in COMMANDS})
    for target in names.values():
        if not re.fullmatch(r'[A-Za-z_]\w*', target):
            raise ValueError('invalid opcode/provider C identifier')
    headers = ['#include "whole_game_state.h"']
    headers.extend(template.format(name=names[name]) for name, template in PROVIDERS.items())
    bodies, handlers, opcode_map, handler_map = [], [], {}, {}
    rows = []
    for offset, name in enumerate(COMMANDS):
        handler = 'ScrCmd_' + name
        if handler not in index:
            raise ValueError(f'missing donor handler: {handler}')
        function = index[handler]
        if not re.match(r'\s*bool8\s+' + handler + r'\s*\(struct ScriptContext \*\s*ctx\)', function.source):
            raise ValueError(f'donor handler signature drift: {handler}')
        if re.search(r'\b' + names[handler] + r'\s*\(', masked(source)):
            raise ValueError(f'handler already exists outside managed block: {names[handler]}')
        opcode = len(entries) + offset
        body = rewrite_tokens(function.source, names)
        bodies.append(body)
        opcode_map[name], handler_map[handler] = opcode, opcode
        dependencies = sorted(set(re.findall(r'\b([A-Za-z_]\w*)\s*\(', masked(function.source))) - {handler, 'if'})
        handlers.append({'name': name, 'handler': names[handler], 'opcode': opcode,
                         'source': function.key, 'sourceSha256': _sha(function.source),
                         'emittedSha256': _sha(body), 'dependencies': dependencies,
                         'status': 'donor-source-extracted'})
        rows.append(f'\tscript_cmd_table_entry FR_SCR_OP_{name.upper()} {names[handler]} @ 0x{opcode:02x}\n')
    # Keep the existing C file includes/private interpreter context, so macros
    # ScriptReadByte and host party/string state retain their actual ABI.
    emitted_source = source + BEGIN + '\n'.join(headers) + '\n\n' + '\n\n'.join(bodies) + '\n' + END
    emitted_table = table.replace(anchor, TABLE_BEGIN + ''.join(rows) + TABLE_END + anchor)
    unresolved = []
    available = set()
    for path in (output / 'src').rglob('*.c'):
        if path.name != 'scrcmd.c':
            available.update(function.name for function in functions(path.read_text(), str(path)) if not function.static)
    provider_rows = []
    for name, target in ((name, names[name]) for name in PROVIDERS):
        present = target in available
        provider_rows.append({'source': name, 'target': target, 'sourceDefinitionPresent': present})
        if not present:
            unresolved.append({'kind': 'missing-native-opcode-provider', 'symbol': target,
                               'donorSymbol': name})
    state_header = output / 'include/whole_game_state.h'
    if not state_header.exists() or any(name not in state_header.read_text() for name in
                                      ('gSpecialVar_TextColor', 'gSpecialVar_PrevTextColor')):
        unresolved.append({'kind': 'missing-dedicated-textcolor-state', 'symbol': 'whole_game_state.h'})
    # Definition presence is necessary, but downstream provider ledgers own their
    # transitive closure/qualification. Do not assert this stage qualifies them.
    for name, contents in ((source_name, emitted_source), (table_name, emitted_table)):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
    report = {
        'schemaVersion': 1, 'status': 'blocked' if unresolved else 'source-staged',
        'ready': not unresolved, 'buildEligible': not unresolved,
        'opcodeMap': opcode_map, 'handlerOpcodeMap': handler_map,
        'handlers': handlers, 'providers': provider_rows, 'unresolved': unresolved,
        'unresolvedSymbols': [row['symbol'] for row in unresolved],
        'files': [source_name, table_name], 'originalOpcodeCount': len(entries),
        'appendedOpcodeCount': len(COMMANDS), 'maximumOpcode': max(opcode_map.values()),
        'canonicalSourcesModified': False,
        'qualification': 'source-transform-only; native-provider ledgers and ROM build remain required',
        'stateBindings': {'textColor': 'dedicated shared script variables 0x8016/0x8017',
                          'party': 'host party, native MON_DATA_MODERN_FATEFUL_ENCOUNTER',
                          'gameStats': 'FR_GetGameStat provider required; donor/base slots 12, 32 and 51 differ in meaning'},
        'measurements': {'transformSeconds': time.monotonic() - started,
                         'buildSeconds': None, 'nativeExecutionSeconds': None,
                         'queueSeconds': None},
    }
    if report_dir is not None:
        report_path = Path(report_dir)
        report_path.mkdir(parents=True, exist_ok=True)
        (report_path / 'opcodes-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
