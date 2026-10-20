"""Lossless FireRed script source import and fail-closed portability inventory.

This stages source, not a certified playable campaign. The dependency gate is
deliberately separate: matching command names do not prove native semantics.
Canonical decompositions are never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

IDENT = re.compile(r"\b[A-Za-z_][A-Za-z_0-9]*\b")
LABEL = re.compile(r"^\s*([A-Za-z_][A-Za-z_0-9]*):{1,2}", re.M)
INCLUDE = re.compile(r'(?m)^\s*\.include\s+"([^"]+)"')
MACRO = re.compile(r"(?ms)^\s*\.macro\s+(\w+)([^\n]*)\n(.*?)^\s*\.endm\b")
CPP_INCLUDE = re.compile(r'(#include\s+")([^"]+)(")')
FONT_CONTROLS = {'FONT_MALE', 'FONT_FEMALE', 'FONT_NORMAL', 'FONT_NORMAL_COPY_1', 'FONT_SMALL'}


def rewrite_font_controls(text: str) -> str:
    def replace(control):
        def token(match):
            name = match[0]
            if name in FONT_CONTROLS or name.startswith(('MUS_', 'SE_')):
                return 'FR_' + name
            if name in ('LEFT_PAREN', 'RIGHT_PAREN'):
                return 'ROUND_' + name
            return name
        return '{' + IDENT.sub(token, control[1]) + '}'
    return re.sub(r'"(?:\\.|[^"\\])*"', lambda quoted: re.sub(r'\{([^}]+)\}', replace, quoted[0]), text)


def namespace(name: str) -> str:
    if name.startswith(("MAP_TYPE_", "MAP_BATTLE_SCENE_", "MAP_SCRIPT_")):
        return "FR_" + name
    for prefix in ("MAP_", "LAYOUT_", "OBJ_EVENT_GFX_"):
        if name.startswith(prefix):
            return prefix + "FR_" + name[len(prefix):]
    return "FR_" + name


def rewrite_tokens(text: str, symbols: dict[str, str]) -> str:
    """Rewrite source identifiers, never quoted text, comments or escape strings."""
    pieces = re.split(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|@[^\n]*|//[^\n]*|/\*[\s\S]*?\*/)', text)
    return "".join(part if i % 2 else IDENT.sub(lambda m: m[0] if m.start() and part[m.start() - 1] == '\\' else symbols.get(m[0], m[0]), part)
                   for i, part in enumerate(pieces))


def _read(root: Path, relative: str) -> str:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"include escapes source root: {relative}")
    return path.read_text()


def source_closure(root: Path, entry: str = "data/event_scripts.s") -> dict[str, str]:
    pending = [entry]
    result = {}
    excluded = {"data/script_cmd_table.inc", "data/specials.inc"}
    while pending:
        relative = pending.pop()
        if relative in result or relative in excluded or relative.startswith("asm/"):
            continue
        text = _read(root, relative)
        result[relative] = text
        pending.extend(INCLUDE.findall(text))
    return dict(sorted(result.items()))


def macro_definitions(root: Path) -> dict[str, dict]:
    result = {}
    relative_paths = set()
    pending = ["asm/macros.inc", "asm/macros/event.inc"]
    while pending:
        relative = pending.pop()
        if relative in relative_paths or not (root / relative).exists():
            continue
        relative_paths.add(relative)
        pending.extend(p for p in INCLUDE.findall((root / relative).read_text()) if p.startswith("asm/"))
    paths = [root / relative for relative in relative_paths]
    paths += list((root / "data/maps").glob("*/scripts.inc"))
    paths += list((root / "data/scripts").glob("*.inc"))
    for path in sorted(paths):
        for match in MACRO.finditer(path.read_text()):
            result[match[1]] = {"parameters": match[2].strip(), "body": match[3],
                                "source": str(path.relative_to(root))}
        for name, value in re.findall(r"(?m)^\s*create_movement_action\s+(\w+),\s*(\w+)", path.read_text()):
            result[name] = {"parameters": "", "body": ".byte " + value,
                            "source": str(path.relative_to(root))}
    return result


def command_table(root: Path) -> list[str]:
    text = _read(root, "data/script_cmd_table.inc")
    generated = re.findall(r"(?m)^\s*script_cmd_table_entry\s+\w+\s+(ScrCmd_\w+)", text)
    return generated or re.findall(r"\.4byte\s+(ScrCmd_\w+)", text)


def charmap_inventory(donor: Path, base: Path) -> dict:
    def entries(root):
        result = {}
        for line in (root / "charmap.txt").read_text().splitlines():
            match = re.match(r"\s*(.*?)\s*=\s*((?:[0-9A-Fa-f]{2}(?:\s+|$))+)", line)
            if match:
                result[match[1]] = " ".join(match[2].upper().split())
        return result
    original, target = entries(donor), entries(base)
    missing = {name: value for name, value in original.items() if name not in target}
    different = {name: {"donor": value, "base": target[name]} for name, value in original.items()
                 if name in target and target[name] != value}
    return {"charmapIdentical": (donor / "charmap.txt").read_bytes() == (base / "charmap.txt").read_bytes(),
            "missingDonorTokens": missing, "differentEncodings": different,
            "status": "shared-encodings" if not missing and not different else "requires-token-and-control-code-port"}


def _normalized(body: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"@[^\n]*", "", body)).strip()


def _constant_symbols(root: Path) -> set[str]:
    result = set()
    for path in (root / "include/constants").glob("*.h"):
        text = path.read_text()
        result.update(re.findall(r"(?m)^\s*#define\s+([A-Za-z_]\w*)", text))
        result.update(re.findall(r"(?m)^\s*([A-Z][A-Z_0-9]*)\s*(?:=|,)", text))
    for path in (root / 'data/maps').glob('*/map.json'):
        data = json.loads(path.read_text())
        if 'id' in data:
            result.add(data['id'])
        result.update(event['local_id'] for event in data.get('object_events', []) if isinstance(event.get('local_id'), str))
    for relative, key in [('src/data/heal_locations.json', 'heal_locations'), ('data/layouts/layouts.json', 'layouts')]:
        path = root / relative
        if path.exists():
            result.update(record['id'] for record in json.loads(path.read_text())[key] if 'id' in record)
    event = root / 'asm/macros/event.inc'
    if event.exists():
        result.update(re.findall(r'(?m)^\s*([A-Z][A-Z_0-9]*)\s*=', event.read_text()))
    return result


def donor_build_constants(root: Path) -> dict[str, str]:
    path = root / 'config.mk'
    if not path.exists():
        return {}
    defaults = dict(re.findall(r'(?m)^\s*(GAME_VERSION|GAME_REVISION|GAME_LANGUAGE)\s*\?=\s*(\w+)', path.read_text()))
    if set(defaults) != {'GAME_VERSION', 'GAME_REVISION', 'GAME_LANGUAGE'}:
        raise ValueError('donor source build defaults missing; explicit source configuration required')
    return defaults


def constant_operand_sources(donor: Path, sources: dict[str, str], macros: dict, reached: set[str]) -> list[str]:
    texts = list(sources.values()) + [macros[name]['body'] for name in reached]
    def values(value):
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, dict):
            for child in value.values(): values(child)
        elif isinstance(value, list):
            for child in value: values(child)
    for path in sorted((donor / 'data/maps').glob('*/map.json')):
        values(json.loads(path.read_text()))
    return texts


def _native_definitions(root: Path, names: set[str]) -> dict[str, list[str]]:
    """Locate native definitions; deliberately do not infer dependency equivalence."""
    found = {name: [] for name in sorted(names)}
    pattern = re.compile(r"(?m)^\s*(?:static\s+)?(?:[A-Za-z_]\w*\s+|\*\s*)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{")
    for path in sorted((root / "src").rglob("*.c")):
        text = path.read_text()
        for match in pattern.finditer(text):
            if match[1] in names:
                line = text.count("\n", 0, match.start()) + 1
                found[match[1]].append(f"{path.relative_to(root)}:{line}")
    return found


def analyze_scripts(donor: Path, base: Path) -> dict:
    donor, base = Path(donor).resolve(), Path(base).resolve()
    sources = source_closure(donor)
    macros, base_macros = macro_definitions(donor), macro_definitions(base)
    base_opcodes = re.findall(r"(?m)^\s*script_cmd_table_entry\s+(\w+)\s+ScrCmd_\w+", _read(base, "data/script_cmd_table.inc"))
    base_opcode_values = {name: str(index) for index, name in enumerate(base_opcodes)}
    def encoding_body(text):
        text = IDENT.sub(lambda m: base_opcode_values.get(m[0], m[0]), text)
        return _normalized(re.sub(r"\b0x([0-9a-fA-F]+)\b", lambda m: str(int(m[1], 16)), text))
    usage: dict[str, list[dict]] = {}
    native_usage: dict[str, list[dict]] = {}
    unknown = {}
    for relative, text in sources.items():
        for line_number, raw in enumerate(text.splitlines(), 1):
            line = raw.split("@", 1)[0].strip()
            if not line or line.startswith((".", "#")) or LABEL.match(line):
                continue
            match = re.match(r"(\w+)\b(.*)", line)
            if not match:
                continue
            command, arguments = match.groups()
            reference = {"path": relative, "line": line_number}
            if command not in macros:
                unknown.setdefault(command, []).append(reference)
                continue
            usage.setdefault(command, []).append(reference)
            args = [a.strip() for a in arguments.split(",")]
            if command in ("special", "callnative", "gotonative") and args:
                native_usage.setdefault(args[0], []).append(reference)
            elif command == "specialvar" and len(args) > 1:
                native_usage.setdefault(args[1], []).append(reference)
    # Include native dependencies used inside convenience macros as well.
    reached = set(usage)
    pending = list(reached)
    while pending:
        name = pending.pop()
        for line in macros[name]["body"].splitlines():
            tokens = line.split("@", 1)[0].strip().split(None, 1)
            if tokens and tokens[0] in macros and tokens[0] not in reached:
                reached.add(tokens[0])
                pending.append(tokens[0])
            if tokens and tokens[0] in ("special", "callnative", "gotonative", "specialvar") and len(tokens) > 1:
                args = [arg.strip() for arg in tokens[1].split(",")]
                native = args[1] if tokens[0] == "specialvar" and len(args) > 1 else args[0]
                if re.fullmatch(r"[A-Za-z_]\w*", native):
                    native_usage.setdefault(native, []).append({"path": macros[name]["source"], "macro": name})
    commands = []
    for name in sorted(reached):
        macro = macros[name]
        target = base_macros.get(name)
        identical = target is not None and encoding_body(macro["body"]) == encoding_body(target["body"]) and macro["parameters"] == target["parameters"]
        commands.append({"name": name, "source": macro["source"],
                         "encoding": "identical-source" if identical else "requires-port",
                         "references": usage.get(name, []),
                         "macroDependencyOnly": name not in usage})
    specials = re.findall(r"(?m)^\s*def_special\s+(\w+)", _read(donor, "data/specials.inc"))
    natives = set(native_usage) | set(specials)
    definitions = _native_definitions(donor, natives)
    donor_table, base_table = command_table(donor), command_table(base)
    opcode_rows = [{"opcode": index, "donorHandler": handler,
                    "baseHandler": base_table[index] if index < len(base_table) else None,
                    "sameHandlerName": index < len(base_table) and base_table[index] == handler}
                   for index, handler in enumerate(donor_table)]
    text_inventory = charmap_inventory(donor, base)
    labels = sorted({label for text in sources.values() for label in LABEL.findall(text)})
    return {"schema": "single-rom-script-port/1", "status": "blocked",
            "sourceFiles": [{"path": p, "sha256": hashlib.sha256(t.encode()).hexdigest()} for p, t in sources.items()],
            "labelCount": len(labels), "commands": commands, "unknownCommands": unknown,
            "opcodeTable": opcode_rows,
            "nativeDependencies": [{"name": name, "specialIndices": [i for i, value in enumerate(specials) if value == name],
                                     "definitions": definitions[name], "references": native_usage.get(name, []),
                                     "reachable": name in native_usage,
                                     "status": "unresolved-native-source-closure"} for name in sorted(natives)],
            "text": text_inventory,
            "blockers": ["native special/callnative implementations require dependency and ABI port",
                         "standard-script dispatch must use donor table in donor script context",
                         "flags/vars/trainers/resources require verified runtime remapping",
                         "macro encoding matches do not establish runtime semantic equivalence"] +
                         ([] if text_inventory["status"] == "shared-encodings" else ["donor text token/control-code compatibility unresolved"])}


def validate_report(report: dict) -> None:
    if report.get("status") != "passed" or report.get("blockers"):
        raise ValueError("FireRed campaign scripts are not executable-port qualified: " + "; ".join(report.get("blockers", ["missing qualification"])))
    if report.get("unknownCommands") or any(d.get("status") != "ported-and-verified" for d in report.get("nativeDependencies", [])):
        raise ValueError("unresolved script/native dependency")


def compile_macros(donor: Path, base: Path, symbols: dict[str, str], *, opcode_overrides: dict[str, int] | None = None) -> tuple[str, list[dict]]:
    """Re-encode donor source commands for Emerald's actual handler positions.

    Source wrappers retain donor operand order and macro behavior. A missing
    native command is a deliberate assembler error in that command, never a nop.
    Standard scripts lower to direct donor labels, avoiding Emerald's table.
    """
    definitions = macro_definitions(donor)
    donor_handlers, base_handlers = command_table(donor), command_table(base)
    event_text = _read(donor, "data/event_scripts.s")
    standard = re.search(r"gStdScripts::(.*?)gStdScriptsEnd::", event_text, re.S)
    standard_labels = re.findall(r"\.4byte\s+(\w+)", standard[1]) if standard else []
    output = ["@ Generated from FireRed source; Emerald handler opcode mapping.\n"]
    config = donor_build_constants(donor)
    if config:
        output += [f".set FR_{config['GAME_VERSION']}, 1\n", f".set FR_{config['GAME_LANGUAGE']}, 1\n", f".set FR_REVISION, {config['GAME_REVISION']}\n"]
    assignments = re.findall(r'(?m)^\s*([A-Z][A-Z_0-9]*)\s*=\s*([^\n@]+)', _read(donor, 'asm/macros/event.inc'))
    output.extend(rewrite_tokens(f'{name} = {expression.strip()}\n', symbols) for name, expression in assignments)
    ports = []
    for name, definition in sorted(definitions.items()):
        if not definition["source"].startswith("asm/"):
            continue  # Map-local definitions remain at their original sites.
        if definition["source"] not in ("asm/macros/event.inc", "asm/macros/movement.inc", "asm/macros/map.inc", "asm/macros/trainer_tower.inc") or name == "create_movement_action":
            continue
        body = definition["body"]
        state = "source-wrapper"
        if name in ("gotostd", "callstd", "gotostd_if", "callstd_if"):
            conditional = name.endswith("_if")
            call = "call" if name.startswith("call") else "goto"
            command = symbols.get(call + ("_if" if conditional else ""), "FR_" + call)
            branches = []
            for index, label in enumerate(standard_labels):
                branches.append((".if" if index == 0 else ".elseif") + f" \\function == {index}\n")
                args = ("\\condition, " if conditional else "") + symbols.get(label, namespace(label))
                branches.append(f" {command} {args}\n")
            branches.append('.else\n .error "unsupported FireRed standard script index"\n.endif\n')
            body = "".join(branches)
            state = "donor-standard-script-direct-dispatch"
        else:
            if name == 'compare':
                body = re.sub(r'(?m)^(\s*\.if\s+)([^\n]+)', lambda m: m[1] + '(' + m[2] + ') || (\\arg == VAR_REPEL_STEP_COUNT)', body, count=1)
            if definition["source"] == "asm/macros/event.inc":
                match = re.search(r"(?m)^(\s*\.byte\s+)0x([0-9a-fA-F]+)\b", body)
                if match:
                    index = int(match[2], 16)
                    handler = donor_handlers[index] if index < len(donor_handlers) else None
                    override = (opcode_overrides or {}).get(handler)
                    if override is not None or handler in base_handlers:
                        opcode = override if override is not None else base_handlers.index(handler)
                        if not isinstance(opcode, int) or not 0 <= opcode <= 255:
                            raise ValueError(f"command opcode outside byte range: {handler}={opcode}")
                        body = body[:match.start()] + match[1] + str(opcode) + body[match.end():]
                        state = "emerald-handler-reencoded"
                    else:
                        body = f'.error "unported FireRed command {name}: {handler}"\n' + body
                        state = "unresolved-command-handler"
            body = rewrite_tokens(body, symbols)
            body = body.replace("SPECIAL_\\function", "FR_SPECIAL_\\function")
        parameters = re.sub(r'=([^,]+)', lambda m: '=' + rewrite_tokens(m[1], symbols), definition['parameters'])
        output.append(f".macro {symbols.get(name, namespace(name))} {parameters}\n{body.rstrip()}\n.endm\n")
        ports.append({"name": name, "status": state, "source": definition["source"]})
    return "\n".join(output), ports


def refresh_constants(donor: Path, base: Path, output: Path, *, symbol_map: dict[str, str] | None = None,
                      constant_overrides: dict[str, int] | None = None) -> dict:
    """Refresh only generic aliases after runtime providers, preserving campaign edits."""
    from .script_constants import emit_constants
    donor, base, output = Path(donor).resolve(), Path(base).resolve(), Path(output).resolve()
    if output.is_relative_to(donor) or output.is_relative_to(base):
        raise ValueError('output must be outside canonical source trees')
    report_path = output / 'data/firered/scripts-port.json'
    report = json.loads(report_path.read_text())
    symbols = report['symbolMap'] | (symbol_map or {})
    macros = macro_definitions(donor)
    reached = {command['name'] for command in report['commands']}
    constants = emit_constants(donor, base, output,
        constant_operand_sources(donor, source_closure(donor), macros, reached), symbols,
        value_overrides=constant_overrides)
    report['constantPorts'] = constants
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return constants


def import_scripts(donor: Path, base: Path, output: Path, *, symbol_map: dict[str, str] | None = None, opcode_overrides: dict[str, int] | None = None, constant_overrides: dict[str, int] | None = None) -> dict:
    """Stage full source closure and reproducible inventory, with explicit build gate.

    Caller owns output checkout. No writes are permitted inside either canonical
    input tree. Nothing from donor is silently replaced by an Emerald namesake.
    """
    donor, base, output = Path(donor).resolve(), Path(base).resolve(), Path(output).resolve()
    if output.is_relative_to(donor) or output.is_relative_to(base):
        raise ValueError("output must be outside canonical source trees")
    sources = source_closure(donor)
    labels = {label for text in sources.values() for label in LABEL.findall(text)}
    labels.update(name for text in sources.values() for name in re.findall(r'(?m)^\s*\.(?:equ|set)\s+([A-Za-z_]\w*)\s*,', text))
    constants = _constant_symbols(donor)
    macros = macro_definitions(donor)
    symbols = {name: namespace(name) for name in labels | constants | set(macros)}
    symbols["MUS_NONE"] = "MUS_NONE"
    symbols.update(TRUE="TRUE", FALSE="FALSE")
    symbols.update({name: 'FR_' + name for name in ('FIRERED', 'LEAFGREEN', 'ENGLISH', 'REVISION', 'BUGFIX')})
    symbols.update(MAP_NUM='MAP_FR_NUM', MAP_GROUP='MAP_FR_GROUP')
    symbols.update(symbol_map or {})
    # Runtime registries remain owned by Emerald. The imported root contains
    # campaign source only; native and command tables are retained as evidence.
    paths = {}
    for relative in sources:
        if relative.startswith("data/maps/"):
            parts = Path(relative).parts
            target = str(Path("data/maps") / ("FR" + parts[2]) / Path(*parts[3:]))
        else:
            target = "data/firered/" + relative
        paths[relative] = target
    for relative, text in sources.items():
        if relative == "data/event_scripts.s":
            end = re.search(r"(?m)^gStdScriptsEnd::\s*$", text)
            if not end:
                raise ValueError("donor standard-script table boundary missing")
            text = text[end.end():]
            text = '#include "data/firered/PORTABILITY_GATE.h"\n#include "constants/whole_game_fr_state.h"\n#include "constants/whole_game_fr_encounters.h"\n#include "constants/firered_map_sentinels.h"\n#include "constants/whole_game_fr_scripts.h"\n\t.include "data/firered/native_special_ids.inc"\n\t.include "asm/macros/fr_event.inc"\n' + text
        text = rewrite_tokens(text, symbols)
        text = rewrite_font_controls(text)
        text = re.sub(r"(?m)^(\s*FR_(?:callnative|gotonative)\s+)([A-Za-z_]\w*)", lambda m: m[1] + (m[2] if m[2].startswith("FR_") else "FR_" + m[2]), text)
        text = INCLUDE.sub(lambda m: '\t.include "' + paths.get(m[1], m[1]) + '"', text)
        path = output / paths[relative]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    # Preserve donor macro/constant/native registry inputs for concrete porting.
    evidence = output / "data/firered/port-inputs"
    for relative in ["data/event_scripts.s", "asm/macros/event.inc", "asm/macros/movement.inc", "data/specials.inc", "data/script_cmd_table.inc", "charmap.txt"]:
        path = evidence / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((donor / relative).read_bytes())
    report = analyze_scripts(donor, base)
    report['donorBuildConfig'] = donor_build_constants(donor)
    from .script_constants import emit_constants
    reached = {command['name'] for command in report['commands']}
    report['constantPorts'] = emit_constants(donor, base, output,
        constant_operand_sources(donor, sources, macros, reached), symbols,
        value_overrides=constant_overrides)
    macro_text, macro_ports = compile_macros(donor, base, symbols, opcode_overrides=opcode_overrides)
    macro_path = output / "asm/macros/fr_event.inc"
    macro_path.parent.mkdir(parents=True, exist_ok=True)
    macro_path.write_text(macro_text)
    report["macroPorts"] = macro_ports
    report["rootInclude"] = paths["data/event_scripts.s"]
    script_runtime = output / "src/scrcmd.c"
    if script_runtime.exists():
        runtime = script_runtime.read_text()
        old = "CreateVirtualObject(graphicsId, virtualObjId, x, y, elevation, direction);"
        new = "CreateVirtualObject(graphicsId | (gSaveBlock1Ptr->location.mapGroup >= 34 ? 0x100 : 0), virtualObjId, x, y, elevation, direction);"
        if old in runtime:
            if runtime.count(old) != 1:
                raise ValueError("ambiguous CreateVirtualObject script runtime call")
            script_runtime.write_text(runtime.replace(old, new))
            report["virtualObjectGraphicsBank"] = "map-region-token-0x100"
        elif new in runtime:
            report["virtualObjectGraphicsBank"] = "map-region-token-0x100"
        else:
            raise ValueError("CreateVirtualObject script runtime call drift")
    report["blockers"] = [b for b in report["blockers"] if not b.startswith("standard-script dispatch")]
    report["blockers"].append("donor macro wrappers need namespaced constant/resource definitions and semantic command validation")
    # Make this campaign a concrete part of the staged engine's script object.
    engine_root = output / "data/event_scripts.s"
    include_line = '\t.include "' + paths["data/event_scripts.s"] + '"\n'
    if engine_root.exists() and include_line.strip() not in engine_root.read_text():
        with engine_root.open("a") as stream:
            stream.write("\n" + include_line)
    report["stagedFiles"] = [{"source": p, "target": target} for p, target in sorted(paths.items())]
    report["symbolMap"] = dict(sorted(symbols.items()))
    destination = output / "data/firered"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "PORTABILITY_GATE.h").write_text('/* Source assembly is permitted; scripts-port.json retains unresolved qualification.\n * Concrete missing commands and operands fail at their individual use sites. */\n#define WHOLE_GAME_FR_SCRIPT_SOURCE_IMPORTED 1\n')
    (destination / "scripts-port.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--donor", required=True, type=Path)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = import_scripts(args.donor, args.base, args.output)
    print(json.dumps({"status": report["status"], "sourceFiles": len(report["sourceFiles"]),
                      "nativeDependencies": len(report["nativeDependencies"]), "blockers": report["blockers"]}, indent=2))


if __name__ == "__main__":
    main()
