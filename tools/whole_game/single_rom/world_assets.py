"""Deterministic FireRed world-source import into a staged Emerald tree.

This is source composition, not campaign qualification. Lossy metatile or object
substitutions are forbidden: runtime responsibilities remain explicit in ledger.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from pathlib import Path

SCHEMA = "whole-game-world-assets/v1"
TOKEN = re.compile(r"\b[A-Za-z_]\w*\b")
PINS = {"emerald": "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881", "firered": "037335f4c725d7c9aecdac87066f2002b4bd7e14"}


def namespaced(token: str) -> str:
    if token == "MUS_NONE":
        return token
    if token.startswith(("MAP_TYPE_", "MAP_BATTLE_SCENE_", "MAP_SCRIPT_")):
        return "FR_" + token
    for prefix in ("OBJ_EVENT_GFX_", "LAYOUT_", "MAP_"):
        if token.startswith(prefix):
            return prefix + "FR_" + token[len(prefix):]
    return "FR_" + token


def _json(path: Path):
    return json.loads(path.read_text())


def _dump(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=False) + "\n")


def _constant_names(source: Path):
    names = set()
    for path in sorted((source / "include/constants").rglob("*.h")):
        content = re.sub(r"/\*.*?\*/|//[^\n]*", "", path.read_text(), flags=re.S)
        names.update(re.findall(r"^\s*#define\s+([A-Z_]\w*)", content, re.M))
        for enum in re.findall(r"enum\s*(?:\w+)?\s*\{(.*?)\}", content, re.S):
            names.update(re.findall(r"(?:^|,)\s*([A-Z_]\w*)", enum))
    return names


def stage_world_assets(emerald_source, firered_source, output_tree, report_dir=None):
    """Import every registered donor map/layout and every tileset/object asset.

    output_tree must already contain an isolated Emerald source snapshot. Source
    paths may never overlap it. Writes only importer-owned paths and two merged
    JSON indexes; script workers own scripts.inc/text.inc. Re-running an import
    replaces the same namespace from the original indexes, never appends twice.
    """
    emerald, donor, out = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    for source in (emerald, donor):
        if out == source or source in out.parents or out in source.parents:
            raise ValueError("output tree must be isolated from both immutable source trees")
    if not (out / "data/maps/map_groups.json").is_file():
        raise ValueError("output tree must contain an Emerald source snapshot")
    changed, files, mapping = set(), [], {}

    def write(relative, content):
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        changed.add(relative)

    def copy(source, relative):
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        files.append({"source": str(source.relative_to(donor)), "destination": relative, "sha256": digest, "bytes": source.stat().st_size})
        changed.add(relative)

    groups = _json(emerald / "data/maps/map_groups.json")
    donor_groups = _json(donor / "data/maps/map_groups.json")
    original_group_count = len(groups["group_order"])
    maps = []
    for index, group in enumerate(donor_groups["group_order"]):
        new_group = "gMapGroup_FR" + group.removeprefix("gMapGroup_")
        groups["group_order"].append(new_group)
        groups[new_group] = ["FR" + name for name in donor_groups[group]]
        for number, name in enumerate(donor_groups[group]):
            path = donor / "data/maps" / name / "map.json"
            data = _json(path)
            maps.append((name, data, original_group_count + index, number))
            mapping[data["id"]] = namespaced(data["id"])
    for name, _, _, _ in maps:
        mapping[name] = "FR" + name
    if len(groups["group_order"]) > 128 or any(len(groups[g]) > 128 for g in groups["group_order"]):
        raise ValueError("map group/map index exceeds signed WarpData storage")
    groups["connections_include_order"] = groups.get("connections_include_order", []) + ["FR" + n for n in donor_groups.get("connections_include_order", [])]
    layouts = _json(emerald / "data/layouts/layouts.json")
    donor_layouts = _json(donor / "data/layouts/layouts.json")["layouts"]
    layout_manifest = []
    for layout in donor_layouts:
        if not layout:
            layouts["layouts"].append({})
            continue
        new = dict(layout)
        for key in ("id", "name"):
            new[key] = namespaced(layout[key]) if key == "id" else "FR" + layout[key]
            mapping[layout[key]] = new[key]
        for key in ("primary_tileset", "secondary_tileset"):
            new[key] = layout[key] if layout[key] in ("NULL", "0", "0x0") else "FR_" + layout[key]
        for key in ("border_filepath", "blockdata_filepath"):
            relative = Path(layout[key])
            new[key] = str(relative.parent.parent / ("FR" + relative.parent.name) / relative.name)
            copy(donor / layout[key], new[key])
        block_size = (donor / layout["blockdata_filepath"]).stat().st_size
        if block_size != layout["width"] * layout["height"] * 2:
            raise ValueError(f"invalid block data size: {layout['id']}")
        border_size = (donor / layout["border_filepath"]).stat().st_size
        if layout["border_width"] * layout["border_height"] and border_size != layout["border_width"] * layout["border_height"] * 2:
            raise ValueError(f"invalid border data size: {layout['id']}")
        layouts["layouts"].append(new)
        layout_manifest.append({"source": layout["id"], "destination": new["id"], "layoutIndex": len(layouts["layouts"]), "border": [layout["border_width"], layout["border_height"]]})
    constants = _constant_names(donor)
    mapping.update({token: namespaced(token) for token in constants if token not in mapping})
    map_manifest, event_types, external_refs = [], Counter(), set()

    def transform_json(value, key=""):
        if isinstance(value, dict):
            return {k: transform_json(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [transform_json(v, key) for v in value]
        if not isinstance(value, str):
            return value
        if key == "script" and value not in ("0", "0x0", "NULL"):
            return "FR_" + value
        if value.startswith("LOCALID_"):
            return "FR_" + value
        return TOKEN.sub(lambda match: mapping.get(match[0], match[0]), value)

    map_ids = {data["id"] for _, data, _, _ in maps}
    for name, data, group_id, number in maps:
        for connection in data.get("connections") or []:
            if connection["map"] not in map_ids:
                external_refs.add(connection["map"])
        for warp in data.get("warp_events", []):
            if warp["dest_map"] not in map_ids and warp["dest_map"] not in ("MAP_NONE", "MAP_UNDEFINED", "MAP_DYNAMIC"):
                external_refs.add(warp["dest_map"])
        event_types.update(event.get("type", "object") for event in data.get("object_events", []))
        transformed = transform_json(data)
        # mapjson derives header labels from the map name; donor script labels
        # use the script importer's FR_ namespace, not the map directory prefix.
        transformed["shared_scripts_map"] = "FR_" + data.get("shared_scripts_map", name)
        # map/layout names are strings in the symbol map, so rewritten above.
        relative = f"data/maps/FR{name}/map.json"
        write(relative, json.dumps(transformed, indent=2) + "\n")
        map_manifest.append({"source": name, "destination": "FR" + name, "constant": transformed["id"], "group": group_id, "number": number, "sourceSha256": hashlib.sha256((donor / f"data/maps/{name}/map.json").read_bytes()).hexdigest()})
    if external_refs:
        raise ValueError(f"unresolved donor map topology: {sorted(external_refs)}")
    sentinels = "#ifndef GUARD_FIRERED_MAP_SENTINELS_H\n#define GUARD_FIRERED_MAP_SENTINELS_H\n#include \"constants/maps.h\"\n#define MAP_FR_DYNAMIC MAP_DYNAMIC\n#define MAP_FR_UNDEFINED MAP_UNDEFINED\n#define FR_WARP_ID_DYNAMIC WARP_ID_DYNAMIC\n#define FR_WARP_ID_NONE WARP_ID_NONE\n#endif\n"
    write("include/constants/firered_map_sentinels.h", sentinels)
    event_path = out / "data/map_events.s"
    event_source = (event_path if event_path.exists() else emerald / "data/map_events.s").read_text()
    if '#include "constants/firered_map_sentinels.h"' not in event_source:
        event_source = '#include "constants/firered_map_sentinels.h"\n' + event_source
    if '#include "constants/firered_event_objects.h"' not in event_source:
        event_source = '#include "constants/firered_event_objects.h"\n' + event_source
    write("data/map_events.s", event_source)
    maps_path = out / "data/maps.s"
    maps_source = (maps_path if maps_path.exists() else emerald / "data/maps.s").read_text()
    if '#include "constants/whole_game_fr_scripts.h"' not in maps_source:
        maps_source = '#include "constants/whole_game_fr_scripts.h"\n' + maps_source
    write("data/maps.s", maps_source)
    scripts_path = out / "data/event_scripts.s"
    scripts_source = (scripts_path if scripts_path.exists() else emerald / "data/event_scripts.s").read_text()
    if '#include "constants/firered_event_objects.h"' not in scripts_source:
        scripts_source = '#include "constants/firered_event_objects.h"\n' + scripts_source
    write("data/event_scripts.s", scripts_source)
    write("data/maps/map_groups.json", json.dumps(groups, indent=2) + "\n")
    write("data/layouts/layouts.json", json.dumps(layouts, indent=2) + "\n")
    for directory in ("data/tilesets", "graphics/object_events", "graphics/field_effects"):
        for source in sorted((donor / directory).rglob("*")):
            if source.is_file():
                copy(source, "data/firered/" + str(source.relative_to(donor)))
    header_paths = list(sorted((donor / "src/data/tilesets").glob("*.h"))) + list(sorted((donor / "src/data/object_events").glob("*.h")))
    header_paths += [donor / "src/tileset_anims.c"]
    extra_graphics_source = (donor / "src/graphics.c").read_text()
    extra_graphics = re.findall(r"const (?:u16|u32) gTileset\w+\[[^;=]*=\s*(?:\{.*?\n\}|INCBIN_\w+\([^;]*\));", extra_graphics_source, re.S)
    if len(extra_graphics) != 6:
        raise ValueError("missing donor General/GenericBuilding1/DepartmentStore tileset graphics definitions")
    definitions = set(re.findall(r"\b(gTileset\w+)\[", "\n".join(extra_graphics)))
    object_runtime = (donor / "src/event_object_movement.c").read_text()
    palette_defines = "\n".join(re.findall(r"^#define OBJ_EVENT_PAL_TAG_[^\n]+", object_runtime, re.M)) + "\n"
    mapping.update({token: "FR_" + token for token in re.findall(r"^#define ([A-Z_]\w*)", palette_defines, re.M)})
    palette_tables = []
    for match in re.finditer(r"static const (?:struct \w+|u16)\s+([gs]\w*Palette\w*)\s*\[.*?\]\s*=\s*\{.*?\n\};", object_runtime, re.S):
        palette_tables.append(match[0])
        definitions.add(match[1])
    for path in header_paths:
        definitions.update(re.findall(r"\b([gs][A-Z]\w*|s[A-Z]\w*)\s*(?=\[|=|;|\()", path.read_text()))
    definitions.update(re.findall(r"^(?:static\s+)?(?:void|bool8|u8|u16|u32)\s+(\w+)\s*\(", (donor / "src/tileset_anims.c").read_text(), re.M))
    mapping.update({symbol: "FR_" + symbol for symbol in definitions})
    for name, text in (("palette_tags.h", palette_defines), ("palette_tables.h", "\n\n".join(palette_tables))):
        write("src/data/firered/object_events/" + name, TOKEN.sub(lambda match: mapping.get(match[0], match[0]), text))
    copy(donor / "src/event_object_movement.c", "data/firered/source/event_object_movement.c")
    general_content = TOKEN.sub(lambda match: mapping.get(match[0], match[0]), "\n\n".join(extra_graphics))
    general_content = general_content.replace('"data/tilesets/', '"data/firered/data/tilesets/')
    write("src/data/firered/tilesets/general_graphics.h", general_content + "\n")
    for path in header_paths:
        content = path.read_text()
        content = TOKEN.sub(lambda match: mapping.get(match[0], match[0]), content)
        content = re.sub(r'"((?:data/tilesets|graphics/object_events|graphics/field_effects)/[^"\n]+)"', r'"data/firered/\1"', content)
        if path.parent.name == "tilesets" and path.name == "headers.h":
            content = re.sub(r"\.metatileAttributes = ([^,]+),", r".metatileAttributes = NULL,\n    .fireRedMetatileAttributes = \1,", content)
        relative = ("src/firered_tileset_anims.c" if path.name == "tileset_anims.c" else "src/data/firered/" + str(path.relative_to(donor / "src/data")))
        write(relative, content)
    object_includes = ["palette_tags.h", "object_event_graphics.h", "object_event_graphics_info_pointers.h", "object_event_pic_tables.h", "object_event_anims.h", "base_oam.h", "object_event_subsprites.h", "object_event_graphics_info.h", "palette_tables.h"]
    write("src/data/firered/object_events/all.h", '#include "constants/firered_event_objects.h"\n' + "".join('#include "data/firered/object_events/' + name + '"\n' for name in object_includes))
    tilesets_path = out / "src/tilesets.c"
    tilesets_source = (tilesets_path if tilesets_path.exists() else emerald / "src/tilesets.c").read_text()
    animation_source = (donor / "src/tileset_anims.c").read_text()
    callback_names = sorted(set(re.findall(r"\.callback = (\w+),", (donor / "src/data/tilesets/headers.h").read_text())) - {"NULL"})
    callbacks = "\n".join("void FR_" + name + "(void);" for name in callback_names)
    if '#include "data/firered/tilesets/headers.h"' not in tilesets_source:
        tilesets_source += "\n" + callbacks + '\n#include "data/firered/tilesets/general_graphics.h"\n#include "data/firered/tilesets/graphics.h"\n#include "data/firered/tilesets/metatiles.h"\n#include "data/firered/tilesets/headers.h"\n'
    write("src/tilesets.c", tilesets_source)
    animations_path = out / "src/tileset_anims.c"
    animations_source = (animations_path if animations_path.exists() else emerald / "src/tileset_anims.c").read_text()
    animation_entries = ("InitTilesetAnimations", "InitSecondaryTilesetAnimation", "UpdateTilesetAnimations", "TransferTilesetAnimsBuffer")
    if '#include "whole_game_state.h"' not in animations_source:
        animations_source = animations_source.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"', 1)
    for name in animation_entries:
        anchor = "void " + name + "(void)\n{"
        call = "    if (WholeGame_IsKanto()) { FR_" + name + "(); return; }"
        animations_source = animations_source.replace("\n" + call, "")
        if name == "TransferTilesetAnimsBuffer":
            anchor += "\n    int i;"
        if animations_source.count(anchor) != 1:
            raise ValueError("native tileset animation dispatcher anchor changed: " + name)
        animations_source = animations_source.replace(anchor, anchor + "\n" + call)
    declarations = "\n".join("void FR_" + name + "(void);" for name in animation_entries)
    if "void FR_InitTilesetAnimations(void);" not in animations_source:
        animations_source = declarations + "\n" + animations_source
    write("src/tileset_anims.c", animations_source)
    # Preserve the original table bytes and value constants for region dispatch;
    # never add the donor bank to Emerald's u8 object ID space.
    event_constants = (donor / "include/constants/event_objects.h").read_text()
    write("include/constants/firered_event_objects.h", TOKEN.sub(lambda match: mapping.get(match[0], match[0]), event_constants))
    unresolved = [
        {"id": "metatile-runtime", "owner": "map-runtime", "reason": "FR attributes are u32, behavior IDs/terrain/encounters differ; 640 primary tiles/metatiles versus Emerald 512. Preserve raw data and use region-aware readers/rendering.", "evidence": ["include/global.fieldmap.h", "src/fieldmap.c", "include/constants/fieldmap.h"]},
        {"id": "layout-border-runtime", "owner": "map-runtime", "reason": "FR border dimensions include 3x2 and 0x0; Emerald MapLayout/mapjson must preserve donor dimensions and region semantics.", "evidence": ["data/layouts/layouts.json", "tools/mapjson/mapjson.cpp"]},
        {"id": "object-graphics-runtime", "owner": "map-runtime", "reason": "Donor graphics/palette/OAM/animation closure requires separate u8 graphics bank and region-aware selection; raw source imported, not yet linked.", "evidence": ["src/data/object_events", "src/event_object_movement.c"]},
        {"id": "world-source-linkage", "owner": "composition", "reason": "Import donor tileset headers/animations, graphics bank and asset build rules; convert designated attribute pointers only after verified runtime mapping.", "evidence": ["src/data/firered/tilesets", "src/firered_tileset_anims.c"]},
        {"id": "event-semantics", "owner": "scripts-state", "reason": "FR hidden-item quantity/underfoot, clone objects, music/map sections and all namespaced map event constants require corresponding runtime/state/resource translation.", "evidence": ["data/maps/map_groups.json", "tools/mapjson/mapjson.cpp"]},
        {"id": "campaign-qualification", "owner": "qualification", "reason": "Map import does not prove story progression, battles, encounters, services, save/resume or full campaigns.", "evidence": []},
    ]
    source_paths = sorted(set(header_paths + [donor / "src/graphics.c", donor / "src/event_object_movement.c", donor / "data/maps/map_groups.json", donor / "data/layouts/layouts.json"] + list((donor / "include/constants").rglob("*.h"))))
    source_files = [{"path": str(path.relative_to(donor)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in source_paths]
    ledger = {"sourceFiles": source_files, "schema": SCHEMA, "status": "blocked", "buildEligible": False, "sourcePins": PINS, "changedFiles": sorted(changed), "coverage": {"maps": len(maps), "donorGroups": len(donor_groups["group_order"]), "emeraldGroupsPreserved": original_group_count, "layoutSlots": len(donor_layouts), "nonemptyLayouts": len(layout_manifest), "objectEvents": dict(event_types), "rawAssetFiles": len(files), "sourceHeaders": len(header_paths), "borderDimensions": {f"{a}x{b}": count for (a,b),count in Counter(tuple(l["border"]) for l in layout_manifest).items()}}, "maps": map_manifest, "layouts": layout_manifest, "symbols": dict(sorted(mapping.items())), "files": files, "unresolved": unresolved, "campaignComplete": False}
    if report_dir is not None:
        _dump(Path(report_dir) / "world-assets-ledger.json", ledger)
    return ledger


import_world_assets = stage_world_assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emerald-source", required=True, type=Path)
    parser.add_argument("--firered-source", required=True, type=Path)
    parser.add_argument("--output-tree", required=True, type=Path)
    parser.add_argument("--report-dir", required=True, type=Path)
    args = parser.parse_args()
    ledger = stage_world_assets(args.emerald_source, args.firered_source, args.output_tree, args.report_dir)
    print(json.dumps({"coverage": ledger["coverage"], "unresolved": len(ledger["unresolved"])}))


if __name__ == "__main__":
    main()


def verify_world_symbol_contracts(firered_source, output_tree, report_dir=None):
    """Exhaustively validate map/layout/script/tileset/graphics symbolic seams."""
    donor, out = Path(firered_source), Path(output_tree)
    donor_scripts = '\n'.join(path.read_text() for path in (donor / 'data/maps').glob('*/scripts.inc'))
    labels = {'FR_' + label for label in re.findall(r'(?m)^(\w+_MapScripts)::?', donor_scripts)}
    headers = (out / 'src/data/firered/tilesets/headers.h').read_text()
    tilesets = set(re.findall(r'const struct Tileset (\w+)\s*=', headers))
    graphics_source = '\n'.join((out / 'src/data/firered/tilesets' / name).read_text() for name in ('general_graphics.h', 'graphics.h', 'metatiles.h'))
    graphic_defs = set(re.findall(r'const \w+ (\w+)\[', graphics_source))
    graphic_refs = set(re.findall(r'\.(?:tiles|palettes|metatiles|fireRedMetatileAttributes) = (\w+)', headers))
    missing_graphics = graphic_refs - graphic_defs
    if missing_graphics:
        raise ValueError('unbound actual tileset graphics: ' + repr(sorted(missing_graphics)))
    events = (out / 'include/constants/firered_event_objects.h').read_text()
    object_defs = set(re.findall(r'(?m)^#define (OBJ_EVENT_GFX_FR_\w+)', events))
    layouts = _json(out / 'data/layouts/layouts.json')['layouts']
    missing_tilesets = {layout[key] for layout in layouts if layout for key in ('primary_tileset', 'secondary_tileset') if layout['id'].startswith('LAYOUT_FR_') and layout[key] not in ('NULL', '0', '0x0')} - tilesets
    if missing_tilesets:
        raise ValueError('unbound actual layout tilesets: ' + repr(sorted(missing_tilesets)))
    maps = list((out / 'data/maps').glob('FR*/map.json'))
    for path in maps:
        data = _json(path)
        label = data.get('shared_scripts_map', data['name']) + '_MapScripts'
        if label not in labels:
            raise ValueError('unbound actual map script root: ' + label)
        for event in data.get('object_events', []):
            graphics = event.get('graphics_id', '')
            if graphics.startswith('OBJ_EVENT_GFX_FR_') and graphics not in object_defs:
                raise ValueError('undefined actual donor object graphics constant: ' + graphics)
    compiled_tileset_source = (out / 'src/tilesets.c').read_text()
    if '#include "data/firered/tilesets/headers.h"' not in compiled_tileset_source:
        raise ValueError('donor tileset definitions are not included in compiled source')
    report = {'schema': 'whole-game-world-symbol-contracts/v1', 'outcome': 'passed', 'mapScriptRoots': len(maps), 'actualDonorScriptRootDefinitions': len(labels), 'donorTilesetDefinitions': len(tilesets), 'actualGraphicsDefinitions': len(graphic_defs), 'actualGraphicsReferences': len(graphic_refs), 'actualObjectGraphicsConstants': len(object_defs), 'unboundSymbols': [], 'linkQualification': 'source contracts verified; complete integrated linker remains a separate gate'}
    if report_dir is not None:
        _dump(Path(report_dir) / 'world-symbol-contracts.json', report)
    return report
