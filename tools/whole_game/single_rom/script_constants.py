"""Audit and emit actual donor operand constants; do not guess resource IDs."""
from __future__ import annotations
import ast
import operator
import json
from pathlib import Path
import re

TOKEN = re.compile(r"\b[A-Za-z_]\w*\b")
OWNED_PREFIXES = ('TRAINER_PIC_', 'TRAINER_CLASS_', 'TRAINER_ENCOUNTER_MUSIC_', 'OBJ_EVENT_GFX_')


def owner_provided(name: str, path: str) -> bool:
    header = Path(path).name
    if header == 'flags.h': return name.startswith('FLAG_')
    if header == 'vars.h': return name.startswith('VAR_')
    if header in ('songs.h', 'sound.h'): return name.startswith(('MUS_', 'SE_'))
    if header == 'items.h': return name.startswith('ITEM_')
    if header == 'opponents.h': return name.startswith('TRAINER_')
    if header in ('maps.h', 'layouts.h'): return True
    return name.startswith(OWNED_PREFIXES)


def definitions(root: Path, *, exclude: set[str] | None = None) -> dict:
    result = {}
    for path in sorted((root / 'include/constants').glob('*.h')):
        if path.name in (exclude or set()):
            continue
        text = re.sub(r'\\\n', ' ', path.read_text())
        text = re.sub(r'/\*[\s\S]*?\*/', '', text)
        for number, line in enumerate(text.splitlines(), 1):
            match = re.match(r'\s*#define\s+([A-Za-z_]\w*)(\s+.*)$', line)
            if not match:
                continue
            expression = match[2].split('//', 1)[0].strip()
            if not expression:
                continue
            record = {'expression': expression, 'path': str(path.relative_to(root)), 'line': number}
            if match[1] in result and result[match[1]]['expression'] != expression:
                result[match[1]].setdefault('alternatives', []).append(record)
            else:
                result[match[1]] = record
    # Generated constants are absent in clean canonical trees. Reproduce the
    # checked-in generators' exact index rules from their original JSON inputs.
    for path in sorted((root / 'data/maps').glob('*/map.json')):
        for index, event in enumerate(json.loads(path.read_text()).get('object_events', []), 1):
            if isinstance(event.get('local_id'), str):
                result[event['local_id']] = {'expression': str(index), 'path': str(path.relative_to(root)), 'line': 0,
                                             'generator': 'tools/mapjson/mapjson.cpp:process_event_constants index+1'}
    for relative, key in [('src/data/heal_locations.json', 'heal_locations'), ('data/layouts/layouts.json', 'layouts')]:
        path = root / relative
        if path.exists():
            for index, entry in enumerate(json.loads(path.read_text())[key], 1):
                if 'id' not in entry:
                    continue
                result[entry['id']] = {'expression': str(index), 'path': relative, 'line': 0,
                                       'generator': 'JSON source record index+1'}
    return result


def evaluator(defs: dict):
    values, active = {}, set()
    binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
              ast.Div: operator.floordiv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
              ast.LShift: operator.lshift, ast.RShift: operator.rshift,
              ast.BitOr: operator.or_, ast.BitAnd: operator.and_, ast.BitXor: operator.xor}
    def resolve(name):
        if name in values: return values[name]
        if name in active: raise ValueError('cyclic constant ' + name)
        if name not in defs: raise ValueError('undefined constant ' + name)
        definition = defs[name]
        if definition.get('alternatives'): raise ValueError('conditional/duplicate constant ' + name)
        active.add(name)
        try:
            expression = re.sub(r'\b(0[xX][\da-fA-F]+|\d+)[uUlL]+\b', r'\1', definition['expression'])
            def visit(node):
                if isinstance(node, ast.Constant) and isinstance(node.value, int): return node.value
                if isinstance(node, ast.Name): return resolve(node.id)
                if isinstance(node, ast.BinOp) and type(node.op) in binary: return binary[type(node.op)](visit(node.left), visit(node.right))
                if isinstance(node, ast.UnaryOp):
                    value = visit(node.operand)
                    if isinstance(node.op, ast.USub): return -value
                    if isinstance(node.op, ast.UAdd): return value
                    if isinstance(node.op, ast.Invert): return ~value
                raise ValueError('unsupported source expression ' + name)
            value = visit(ast.parse(expression, mode='eval').body)
            values[name] = value
            return value
        finally:
            active.remove(name)
    return resolve


def emit_constants(donor: Path, base: Path, output: Path, source_texts: list[str],
                   symbols: dict[str, str], *, value_overrides: dict[str, int] | None = None) -> dict:
    original, host = definitions(donor), definitions(base)
    donor_value, host_value = evaluator(original), evaluator(host)
    staged = definitions(output, exclude={'whole_game_fr_scripts.h'})
    staged_value = evaluator(staged)
    # Assembly source and macro bodies only; quote/comment tokens are not operands.
    text = '\n'.join(source_texts)
    text = re.sub(r'"(?:\\.|[^"\\])*"|@[^\n]*|//[^\n]*|/\*[\s\S]*?\*/', '', text)
    used = set(TOKEN.findall(text)) & set(original)
    aliases, unresolved, owned = [], [], []
    lines = ['#ifndef GUARD_WHOLE_GAME_FR_SCRIPT_CONSTANTS_H', '#define GUARD_WHOLE_GAME_FR_SCRIPT_CONSTANTS_H']
    # Rewritten maps retain Emerald's group-high-byte/number-low-byte ABI.
    lines += ['#define MAP_FR_NUM(map) MAP_NUM(map)', '#define MAP_FR_GROUP(map) MAP_GROUP(map)']
    for name in sorted(used):
        record = original[name]
        target = symbols.get(name, 'FR_' + name)
        direct_value = None
        if re.fullmatch(r'(?:0x[0-9a-fA-F]+|[0-9]+)', target):
            direct_value = int(target, 0)
            target = 'FR_' + name
        boundaries = {'VARS_START', 'VARS_END', 'SPECIAL_VARS_START', 'SPECIAL_VARS_END'}
        if owner_provided(name, record['path']) or name.startswith(('MAP_', 'LAYOUT_')) and not name.startswith(('MAP_SCRIPT_', 'MAP_TYPE_', 'MAP_BATTLE_')):
            owned.append({'name': name, 'target': target, 'provider': record['path']})
            continue
        if name == 'MUS_NONE' or name.startswith('GUARD_'):
            continue
        entry = dict(name=name, target=target, **record)
        try:
            value = donor_value(name)
            entry['donorValue'] = value
            shared = host_value(name) if name in host else None
            entry['hostValue'] = shared
            if direct_value is not None:
                value = direct_value
                entry['resolution'] = 'runtime-provider-source-substitution'
            elif name in (value_overrides or {}):
                value = value_overrides[name]
                entry['resolution'] = 'runtime-provider-value'
            elif target in staged and not staged[target]['path'].endswith('/whole_game_fr_scripts.h'):
                value = staged_value(target)
                entry['resolution'] = 'staged-runtime-provider-value'
                entry['provider'] = staged[target]['path']
            elif name in boundaries:
                from .state import donor_var
                if name.startswith('SPECIAL_'):
                    domain = [donor_var(v) for v in range(donor_value('SPECIAL_VARS_START'), donor_value('SPECIAL_VARS_END') + 1)]
                else:
                    domain = [donor_var(donor_value('VARS_START')), donor_var(donor_value('VARS_END'))]
                value = min(domain) if name.endswith('_START') else max(domain)
                entry['resolution'] = 'state-provider-mapped-variable-domain-boundary'
            elif name.startswith(('MOVEMENT_ACTION_', 'MOVEMENT_TYPE_')):
                if shared is None:
                    raise ValueError('donor-only movement action/type requires native runtime provider')
                value = shared
                entry['resolution'] = 'host-action-symbol-reencoded'
                entry['semanticStatus'] = 'native action implementation audit required'
            elif name.startswith(('FLDEFF_', 'POCKET_')) and shared is not None:
                value = shared
                entry['resolution'] = 'shared-host-service-symbol-reencoded'
                entry['semanticStatus'] = 'host field-effect/item-pocket API domain'
            elif name == 'TRAINER_BATTLE_EARLY_RIVAL':
                raise ValueError('early-rival mode requires distinct native battle provider value')
            elif name.startswith('HEAL_LOCATION_'):
                raise ValueError('heal location requires campaign runtime provider index')
            else:
                entry['resolution'] = 'same-source-value' if value == shared else 'donor-source-value'
                entry['semanticStatus'] = 'same named source constant' if value == shared else 'donor domain consumed by donor service; runtime audit required'
            entry['emittedValue'] = value
            lines += [f"/* {record['path']}:{record['line']} : {record['expression']} */", f'#ifndef {target}', f'#define {target} {value}', '#endif']
            aliases.append(entry)
        except (ValueError, KeyError, SyntaxError, ZeroDivisionError) as error:
            entry['reason'] = str(error)
            unresolved.append(entry)
            lines += [f'#ifndef {target}', f'#error "unresolved FireRed operand {target}: {str(error)}"', '#endif']
    lines += ['#endif', '']
    relative = 'include/constants/whole_game_fr_scripts.h'
    path = output / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines))
    report = {'schema': 'single-rom-script-constants/1', 'header': relative,
            'aliases': aliases, 'unresolved': unresolved, 'ownerProvided': owned,
            'status': 'passed' if not unresolved else 'blocked'}
    ledger = output / 'data/firered/script-constants.json'
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report
