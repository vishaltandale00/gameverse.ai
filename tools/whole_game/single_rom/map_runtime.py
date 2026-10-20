"""Deterministic staged Emerald map ABI patches; never edits canonical source trees.

Preparation is deliberately distinct from semantic admission. Same-name metatile
behaviors are candidates, not a proof that their consumers are equivalent.
"""
from __future__ import annotations
import hashlib
import json
import re
import struct
from pathlib import Path

FIRST_FR_GROUP = 34
ATTRIBUTE_FIELDS = ((0, 9), (9, 5), (14, 4), (18, 6), (24, 3), (27, 2), (29, 2), (31, 1))


def extract_attribute(raw: int, field: int) -> int:
    if field == 255:
        return raw
    shift, width = ATTRIBUTE_FIELDS[field]
    return (raw >> shift) & ((1 << width) - 1)


def border_index(x: int, y: int, width: int, height: int) -> int:
    return ((x - 7) % width) + ((y - 7) % height) * width


def behavior_names(path: Path) -> dict[int, str]:
    text = path.read_text()
    defines = re.findall(r'^#define (MB_\w+) (0x[0-9a-fA-F]+|\d+)\s*$', text, re.M)
    if defines:
        return {int(value, 0): name for name, value in defines}
    body = text.split('enum {', 1)[1].split('};', 1)[0]
    return {i: name for i, name in enumerate(re.findall(r'\bMB_\w+', re.sub(r'//[^\n]*', '', body)))}


def fame_checker_palettes_source(native_objects):
    match = re.search(r'void InitObjectEventPalettes\(u8 reflectionType\).*?\n\}',native_objects,re.S)
    if not match:
        raise ValueError('missing native object palette initialization')
    source = match[0].replace('InitObjectEventPalettes(', 'FR_InitFameCheckerObjectPalettes(', 1)
    source = source.replace('WholeGameObjectPaletteTags(sCurrentReflectionType)',
                            'sWholeGameKantoObjectPaletteTagSets[sCurrentReflectionType]')
    source = source.replace('sObjectPaletteTagSets[sCurrentReflectionType]',
                            'sWholeGameKantoObjectPaletteTagSets[sCurrentReflectionType]')
    return source


def fame_checker_object_source(donor_objects):
    fame = re.search(r'u8 CreateFameCheckerObject\(.*?\n\}', donor_objects, re.S)
    if not fame:
        raise ValueError('missing source Fame Checker object provider')
    fame_source = fame[0].replace('CreateFameCheckerObject(', 'FR_CreateFameCheckerObject(', 1)
    fame_source = fame_source.replace('GetObjectEventGraphicsInfo(graphicsId)', 'GetObjectEventGraphicsInfo(0x100 | graphicsId)')
    fame_source = fame_source.replace('CopyObjectGraphicsInfoToSpriteTemplate(graphicsId,', 'CopyObjectGraphicsInfoToSpriteTemplate(0x100 | graphicsId,')
    return fame_source


def object_graphics_bank_source():
    return """
EWRAM_DATA static bool8 sWholeGamePlayerGraphicsBank = FALSE;
void WholeGameSetPlayerGraphicsBank(bool8 enabled)
{
    sWholeGamePlayerGraphicsBank = enabled;
}
static u16 WholeGameObjectGraphicsToken(u8 graphicsId, u8 mapGroup, u8 localId)
{
    bool8 donor = localId == LOCALID_PLAYER ? sWholeGamePlayerGraphicsBank : mapGroup >= 34;
    return graphicsId | (donor ? 0x100 : 0);
}
const struct ObjectEventGraphicsInfo *WholeGameObjectGraphicsInfo(const struct ObjectEvent *object)
{
    return GetObjectEventGraphicsInfo(WholeGameObjectGraphicsToken(object->graphicsId, object->mapGroup, object->localId));
}
"""


def object_graphics_include_text(text):
    text = text.replace('\"data/firered/object_events/', '\"')
    include = '#include "constants/firered_object_anims.h"'
    return text if include in text else include + '\n' + text


def object_animation_constants(donor):
    source = (Path(donor)/'include/constants/event_object_movement.h').read_text()
    rows = re.findall(r'^#define ANIM_\w+[^\n]*',source,re.M)
    text = '\n'.join(rows)
    text = re.sub(r'\bANIM_\w+',lambda m:'FR_'+m[0],text)
    return '#ifndef GUARD_FR_OBJECT_ANIMS_H\n#define GUARD_FR_OBJECT_ANIMS_H\n'+text+'\n#endif\n'



def stage_map_runtime(emerald_source, firered_source, output_tree, report_dir=None):
    emerald, donor, stage = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    if stage == emerald or stage == donor or emerald in stage.parents or donor in stage.parents:
        raise ValueError('output_tree must be an isolated staged tree outside canonical sources')
    patched = []
    pins = {}

    def read(rel):
        p = stage / rel
        data = p.read_text()
        pins.setdefault(rel, hashlib.sha256(data.encode()).hexdigest())
        return data

    def write(rel, data):
        destination = stage / rel
        resolved = destination.resolve()
        for canonical in (emerald, donor):
            if resolved == canonical or canonical in resolved.parents:
                raise ValueError(f'staged path resolves into canonical source: {rel}')
            original = canonical / rel
            if destination.exists() and original.exists() and destination.samefile(original):
                raise ValueError(f'staged path shares canonical source inode: {rel}')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(data)
        patched.append(rel)

    def replace_once(data, old, new):
        if data.count(old) != 1:
            raise ValueError(f'unsupported source revision: expected one {old[:70]!r}')
        return data.replace(old, new, 1)

    rel = 'include/global.fieldmap.h'
    data = read(rel)
    data = replace_once(data, '/*0x14*/ TilesetCB callback;', '/*0x14*/ TilesetCB callback;\n    const u32 *fireRedMetatileAttributes;')
    data = replace_once(data, '/*0x14*/ const struct Tileset *secondaryTileset;', '/*0x14*/ const struct Tileset *secondaryTileset;\n    u8 borderWidth;\n    u8 borderHeight;')
    write(rel, data)

    rel = 'include/fieldmap.h'
    data = read(rel)
    data += '''\n// Single-ROM source-domain ABI; donor identity follows the layout, not mutable warp state.
u16 WholeGamePrimaryMetatileCount(const struct MapLayout *layout);
u16 WholeGamePrimaryTileCount(const struct MapLayout *layout);
u8 WholeGamePrimaryPaletteCount(const struct MapLayout *layout);
u32 WholeGameFireRedAttribute(const struct MapLayout *layout, u16 metatile, u8 attribute);
u16 WholeGameFireRedBehavior(u16 behavior);
'''
    write(rel, data)

    rel = 'src/fieldmap.c'
    data = read(rel)
    old = '#define GetBorderBlockAt(x, y) (gMapHeader.mapLayout->border[((x + 1) & 1) + (((y + 1) & 1) << 1)] | MAPGRID_IMPASSABLE)'
    border = '''static u16 WholeGameBorderBlockAt(s32 x, s32 y)
{
    const struct MapLayout *layout = gMapHeader.mapLayout;
    s32 width = layout->borderWidth;
    s32 height = layout->borderHeight;
    if (layout->primaryTileset->fireRedMetatileAttributes && (!width || !height))
        return MAPGRID_UNDEFINED | MAPGRID_IMPASSABLE; // Unreachable unused donor layouts are not given invented borders.
    if (!width) width = 2;
    if (!height) height = 2;
    x = (x - MAP_OFFSET) % width;
    y = (y - MAP_OFFSET) % height;
    if (x < 0) x += width;
    if (y < 0) y += height;
    return layout->border[x + y * width] | MAPGRID_IMPASSABLE;
}
#define GetBorderBlockAt(x, y) WholeGameBorderBlockAt(x, y)'''
    data = replace_once(data, old, border)
    # All routines in this file that use these tokens operate on their local mapLayout,
    # except GetMetatileAttributesById, which uses gMapHeader.mapLayout.
    start = data.index('u16 GetMetatileAttributesById(u16 metatile)')
    end = data.index('\nvoid SaveMapView', start)
    data = data[:start] + '''u16 GetMetatileAttributesById(u16 metatile)
{
    const struct MapLayout *layout = gMapHeader.mapLayout;
    u16 primaryCount = WholeGamePrimaryMetatileCount(layout);
    if (layout->primaryTileset->fireRedMetatileAttributes)
    {
        u32 raw = WholeGameFireRedAttribute(layout, metatile, 255);
        return WholeGameFireRedBehavior(raw & 0x1ff) | (((raw >> 29) & 3) << 12);
    }
    if (metatile < primaryCount)
        return layout->primaryTileset->metatileAttributes[metatile];
    if (metatile < NUM_METATILES_TOTAL)
        return layout->secondaryTileset->metatileAttributes[metatile - primaryCount];
    return MB_INVALID;
}
''' + data[end:]
    native_names = set(behavior_names(emerald / 'include/constants/metatile_behaviors.h').values())
    fr_names = behavior_names(donor / 'include/constants/metatile_behaviors.h')
    mapping = {i: name for i, name in fr_names.items() if name in native_names}
    helpers = '''
u16 WholeGamePrimaryMetatileCount(const struct MapLayout *layout)
{ return layout->primaryTileset->fireRedMetatileAttributes ? 640 : 512; }
u16 WholeGamePrimaryTileCount(const struct MapLayout *layout)
{ return WholeGamePrimaryMetatileCount(layout); }
u8 WholeGamePrimaryPaletteCount(const struct MapLayout *layout)
{ return layout->primaryTileset->fireRedMetatileAttributes ? 7 : 6; }
u32 WholeGameFireRedAttribute(const struct MapLayout *layout, u16 metatile, u8 attribute)
{
    static const u8 shifts[8] = {0,9,14,18,24,27,29,31};
    static const u32 masks[8] = {0x1ff,0x1f,0xf,0x3f,7,3,3,1};
    const u32 *attributes;
    if (metatile >= 1024) return 0xffffffff;
    if (metatile < 640) attributes = layout->primaryTileset->fireRedMetatileAttributes;
    else { attributes = layout->secondaryTileset->fireRedMetatileAttributes; metatile -= 640; }
    if (!attributes) return 0xffffffff;
    if (attribute >= 8) return attributes[metatile];
    return (attributes[metatile] >> shifts[attribute]) & masks[attribute];
}
'''
    pos = data.index('struct ConnectionFlags')
    data = data[:pos] + helpers + '\n' + data[pos:]
    data = data.replace('NUM_TILES_IN_PRIMARY', 'WholeGamePrimaryTileCount(mapLayout)')
    # LoadTilesetPalette receives the tileset itself, so choose its donor discriminator.
    data = data.replace('tileset->palettes[NUM_PALS_IN_PRIMARY]', 'tileset->palettes[tileset->fireRedMetatileAttributes ? 7 : 6]')
    data = data.replace('NUM_PALS_IN_PRIMARY', 'WholeGamePrimaryPaletteCount(mapLayout)')
    write(rel, data)
    for rel in ('src/field_camera.c', 'src/shop.c'):
        data = read(rel).replace('NUM_METATILES_IN_PRIMARY', 'WholeGamePrimaryMetatileCount(mapLayout)')
        write(rel, data)

    rel = 'tools/mapjson/mapjson.cpp'
    data = read(rel)
    old = '''        if (version == "firered") {
            text << "\\t.byte " << json_to_string(layout, "border_width") << "\\n"
                 << "\\t.byte " << json_to_string(layout, "border_height") << "\\n"
                 << "\\t.2byte 0\\n";
        }'''
    new = '''        text << "\\t.byte " << (layout["border_width"].is_number() ? json_to_string(layout, "border_width") : "2") << "\\n"
             << "\\t.byte " << (layout["border_height"].is_number() ? json_to_string(layout, "border_height") : "2") << "\\n"
             << "\\t.2byte 0\\n";'''
    # json11 API uses is_number (same parser as the rest of mapjson).
    data = replace_once(data, old, new)
    write(rel, data)

    # Donor palette tags occupy a disjoint registry range. Their graphics info,
    # paired reflection tables and palette entries all reference these macros.
    donor_objects = (donor / 'src/event_object_movement.c').read_text()
    palette_tags = []
    for name, value in re.findall(r'^#define (OBJ_EVENT_PAL_TAG_\w+)\s+(0x[0-9A-Fa-f]+)', donor_objects, re.M):
        palette_tags.append(f'#define FR_{name} 0x{int(value,16) + 0x2000:04X}')
    rel = 'src/data/firered/object_events/palette_tags.h'
    (stage / rel).parent.mkdir(parents=True, exist_ok=True)
    write(rel, '\n'.join(palette_tags) + '\n')

    def donor_palette_entries(symbol):
        match = re.search(r'\b' + re.escape(symbol) + r'\[\] = \{(.*?)\n\};', donor_objects, re.S)
        if not match:
            raise ValueError(f'unsupported donor palette registry {symbol}')
        body = match[1]
        # Each registry has a trailing sentinel, excluded when merging registries.
        body = re.sub(r'^\s*\{OBJ_EVENT_PAL_TAG_NONE, NULL\},?\s*$', '', body, flags=re.M)
        body = re.sub(r'^\s*\{\},?\s*$', '', body, flags=re.M)
        return re.sub(r'\b(?:[gs][A-Z]\w*|OBJ_EVENT_PAL_TAG_\w*)\b', lambda m: 'FR_' + m[0], body)

    write('include/constants/firered_object_anims.h', object_animation_constants(donor))

    # Nested includes resolve relative to all.h, not the translation unit in src/.
    rel = 'src/data/firered/object_events/all.h'
    if (stage / rel).exists():
        write(rel, object_graphics_include_text(read(rel)))

    # Bank identity is carried transiently in bit 8; native object save ABI stays u8.
    rel = 'include/event_object_movement.h'
    data = read(rel).replace('GetObjectEventGraphicsInfo(u8 graphicsId)', 'GetObjectEventGraphicsInfo(u16 graphicsId)')
    data = data.replace('CreateVirtualObject(u8 graphicsId,', 'CreateVirtualObject(u16 graphicsId,')
    data += '\nconst struct ObjectEventGraphicsInfo *WholeGameObjectGraphicsInfo(const struct ObjectEvent *object);\nvoid WholeGameSetPlayerGraphicsBank(bool8 enabled);\nu8 FR_CreateFameCheckerObject(u8 graphicsId, u8 localId, s16 x, s16 y);\nvoid FR_InitFameCheckerObjectPalettes(u8 reflectionType);\n'
    write(rel, data)
    rel = 'src/event_object_movement.c'
    data = read(rel)
    data = '#include \"constants/whole_game_fr_state.h\"\n' + data
    data = replace_once(data, '#include "data/object_events/object_event_graphics_info.h"',
        '#include "data/object_events/object_event_graphics_info.h"\n#include "data/firered/object_events/all.h"')
    # ObjectEvent map identity survives incoming connections and save reload. Player
    # local ID selects the original Emerald bank even while standing in Kanto.
    helpers = object_graphics_bank_source()
    pos = data.index('static const struct SpritePalette sObjectEventSpritePalettes[]')
    data = data[:pos] + helpers + '\n' + data[pos:]
    data = data.replace('GetObjectEventGraphicsInfo(objectEvent->graphicsId)', 'WholeGameObjectGraphicsInfo(objectEvent)')
    data = data.replace('GetObjectEventGraphicsInfo(objEvent->graphicsId)', 'WholeGameObjectGraphicsInfo(objEvent)')
    data = data.replace('GetObjectEventGraphicsInfo(objectEventTemplate->graphicsId)',
        'GetObjectEventGraphicsInfo(WholeGameObjectGraphicsToken(objectEventTemplate->graphicsId, mapGroup, objectEventTemplate->localId))')
    # The template helper is called during map spawning and carries localId; native
    # standalone APIs keep bank zero unless their u16 caller supplies a donor token.
    data = data.replace('CopyObjectGraphicsInfoToSpriteTemplate_WithMovementType(objectEventTemplate->graphicsId,',
        'CopyObjectGraphicsInfoToSpriteTemplate_WithMovementType(WholeGameObjectGraphicsToken(objectEventTemplate->graphicsId, gSaveBlock1Ptr->location.mapGroup, objectEventTemplate->localId),')
    signature = 'const struct ObjectEventGraphicsInfo *GetObjectEventGraphicsInfo(u8 graphicsId)\n{\n    u8 bard;'
    replacement = """const struct ObjectEventGraphicsInfo *GetObjectEventGraphicsInfo(u16 graphicsId)
{
    u8 bard;
    if (graphicsId & 0x100)
    {
        graphicsId &= 0xff;
        if (graphicsId >= 240)
            graphicsId = (u8)VarGet(FR_VAR_OBJ_GFX_ID_0 + graphicsId - 240);
        if (graphicsId >= ARRAY_COUNT(FR_gObjectEventGraphicsInfoPointers))
            graphicsId = OBJ_EVENT_GFX_FR_LITTLE_BOY; // Exact source-native invalid-ID fallback.
        return FR_gObjectEventGraphicsInfoPointers[graphicsId];
    }
"""
    data = replace_once(data, signature, replacement)
    data = data.replace('CopyObjectGraphicsInfoToSpriteTemplate_WithMovementType(objectEvent->graphicsId,',
        'CopyObjectGraphicsInfoToSpriteTemplate_WithMovementType(WholeGameObjectGraphicsToken(objectEvent->graphicsId, objectEvent->mapGroup, objectEvent->localId),')
    old = """    if (objectEvent->graphicsId >= OBJ_EVENT_GFX_VARS)
        objectEvent->graphicsId = VarGetObjectEventGraphicsId(objectEvent->graphicsId - OBJ_EVENT_GFX_VARS);"""
    new = """    if (objectEvent->graphicsId >= OBJ_EVENT_GFX_VARS)
    {
        if (objectEvent->mapGroup >= 34 && objectEvent->localId != LOCALID_PLAYER)
            objectEvent->graphicsId = VarGet(FR_VAR_OBJ_GFX_ID_0 + objectEvent->graphicsId - 240);
        else
            objectEvent->graphicsId = VarGetObjectEventGraphicsId(objectEvent->graphicsId - OBJ_EVENT_GFX_VARS);
    }"""
    data = replace_once(data, old, new)
    data = data.replace('CreateVirtualObject(u8 graphicsId,', 'CreateVirtualObject(u16 graphicsId,')
    data = replace_once(data, '#define sVirtualObjElev data[1]', '#define sVirtualObjElev data[1]\n#define sVirtualObjGraphicsBank data[7]')
    data = replace_once(data, 'sprite->sVirtualObjElev = elevation;', 'sprite->sVirtualObjElev = elevation;\n        sprite->sVirtualObjGraphicsBank = graphicsId & 0x100;')
    start = data.index('void SetVirtualObjectGraphics(')
    end = data.index('\n}', start)
    section = data[start:end].replace('GetObjectEventGraphicsInfo(graphicsId)', 'GetObjectEventGraphicsInfo(graphicsId | sprite->sVirtualObjGraphicsBank)')
    data = data[:start] + section + data[end:]
    data = data.replace('MakeSpriteTemplateFromObjectEventTemplate(const struct ObjectEventTemplate *, struct SpriteTemplate *, const struct SubspriteTable **);',
        'MakeSpriteTemplateFromObjectEventTemplate(const struct ObjectEventTemplate *, u8, struct SpriteTemplate *, const struct SubspriteTable **);')
    data = data.replace('MakeSpriteTemplateFromObjectEventTemplate(objectEventTemplate, &spriteTemplate,',
        'MakeSpriteTemplateFromObjectEventTemplate(objectEventTemplate, mapGroup, &spriteTemplate,')
    data = data.replace('MakeSpriteTemplateFromObjectEventTemplate(const struct ObjectEventTemplate *objectEventTemplate, struct SpriteTemplate *',
        'MakeSpriteTemplateFromObjectEventTemplate(const struct ObjectEventTemplate *objectEventTemplate, u8 mapGroup, struct SpriteTemplate *')
    data = data.replace('WholeGameObjectGraphicsToken(objectEventTemplate->graphicsId, gSaveBlock1Ptr->location.mapGroup,',
        'WholeGameObjectGraphicsToken(objectEventTemplate->graphicsId, mapGroup,')
    data = replace_once(data, 'void ResetObjectEvents(void)\n{', 'void ResetObjectEvents(void)\n{\n    WholeGameSetPlayerGraphicsBank(FALSE);')
    data += '\n' + fame_checker_object_source(donor_objects) + '\n'
    # ObjectEventSetGraphicsId uses the incoming ID, before it commits the new value.
    start = data.index('void ObjectEventSetGraphicsId(')
    end = data.index('\n}', start)
    section = data[start:end].replace('GetObjectEventGraphicsInfo(graphicsId)',
        'GetObjectEventGraphicsInfo(WholeGameObjectGraphicsToken(graphicsId, objectEvent->mapGroup, objectEvent->localId))')
    data = data[:start] + section + data[end:]
    # Prepend donor registry rows before native rows; lookup remains shared and
    # native player palettes remain available in donor maps and transitions.
    for native, donor_symbol in (
        ('sObjectEventSpritePalettes', 'sObjectEventSpritePalettes'),
        ('sPlayerReflectionPaletteSets', 'gPlayerReflectionPaletteSets'),
        ('sSpecialObjectReflectionPaletteSets', 'gSpecialObjectReflectionPaletteSets')):
        marker = native + '[] = {'
        data = replace_once(data, marker, marker + donor_palette_entries(donor_symbol))
    # Default NPC slots load before any NPC is spawned. A graphics-bank switch
    # alone would leave all ordinary donor NPCs wearing Emerald's palettes.
    npc_names = {'1': 'BLUE', '2': 'PINK', '3': 'GREEN', '4': 'WHITE'}
    region_arrays = []
    for index in range(4):
        match = re.search(r'static const u16 sObjectPaletteTags' + str(index) + r'\[\] = \{.*?\n\};', data, re.S)
        if not match:
            raise ValueError('unsupported native default palette table')
        array = match[0].replace('sObjectPaletteTags', 'sWholeGameKantoObjectPaletteTags')
        array = re.sub(r'OBJ_EVENT_PAL_TAG_NPC_([1-4])(_REFLECTION)?',
            lambda m: 'FR_OBJ_EVENT_PAL_TAG_NPC_' + npc_names[m[1]] + (m[2] or ''), array)
        region_arrays.append(array)
    helper = '\n'.join(region_arrays) + """
static const u16 *const sWholeGameKantoObjectPaletteTagSets[] = {
    sWholeGameKantoObjectPaletteTags0, sWholeGameKantoObjectPaletteTags1,
    sWholeGameKantoObjectPaletteTags2, sWholeGameKantoObjectPaletteTags3,
};
static const u16 *WholeGameObjectPaletteTags(u8 reflectionType)
{
    if (gMapHeader.mapLayout->primaryTileset->fireRedMetatileAttributes)
        return sWholeGameKantoObjectPaletteTagSets[reflectionType];
    return sObjectPaletteTagSets[reflectionType];
}
"""
    marker = '#include "data/object_events/berry_tree_graphics_tables.h"'
    data = replace_once(data, marker, helper + '\n' + marker)
    data = data.replace('sObjectPaletteTagSets[sCurrentReflectionType]', 'WholeGameObjectPaletteTags(sCurrentReflectionType)')
    # Fix the source's documented missing-tag sentinel bug while extending lookup.
    data = replace_once(data, """#ifdef BUGFIX
    {NULL,                                  OBJ_EVENT_PAL_TAG_NONE},
#else
    {}, // BUG: FindObjectEventPaletteIndexByTag looks for OBJ_EVENT_PAL_TAG_NONE and not 0x0.
        // If it's looking for a tag that isn't in this table, the game locks in an infinite loop.
#endif""", '    {NULL, OBJ_EVENT_PAL_TAG_NONE},')
    data += '\n' + fame_checker_palettes_source(data) + '\n'
    write(rel, data)

    for rel in ('src/shop.c', 'src/field_effect_helpers.c'):
        data = read(rel)
        data = data.replace('GetObjectEventGraphicsInfo(objectEvent->graphicsId)', 'WholeGameObjectGraphicsInfo(objectEvent)')
        data = data.replace('GetObjectEventGraphicsInfo(gObjectEvents[objectEventId].graphicsId)', 'WholeGameObjectGraphicsInfo(&gObjectEvents[objectEventId])')
        data = data.replace('GetObjectEventGraphicsInfo(gObjectEvents[sShopData->viewportObjects[i][OBJ_EVENT_ID]].graphicsId)', 'WholeGameObjectGraphicsInfo(&gObjectEvents[sShopData->viewportObjects[i][OBJ_EVENT_ID]])')
        write(rel, data)

    used = set()
    for path in sorted((donor / 'data/tilesets').rglob('metatile_attributes.bin')):
        raw = path.read_bytes()
        if len(raw) % 4:
            raise ValueError(f'misaligned donor attributes: {path}')
        used.update(value[0] & 0x1ff for value in struct.iter_unpack('<I', raw))
    unsupported = [
        {'domain': 'metatile_behavior_consumers', 'reason': 'Raw behavior dispatch is provided by the separately gated map_semantics stage; same-name candidates below are audit information only.', 'unmapped_used': sorted(used - mapping.keys())},
        {'domain': 'terrain_encounter', 'reason': 'Raw terrain/encounter and auxiliary attributes are preserved and queryable; Emerald battle/encounter/field-effect consumers have not been ported.'},
        {'domain': 'tileset_animation', 'reason': 'FireRed callback implementations and VRAM animation destinations require source-specific port and qualification.'},
        {'domain': 'object_graphics', 'reason': 'Object and virtual bank provenance, unique palette tags and reflection pairs are patched; native compile and render qualification remain required for standalone graphics and imported closure.'},
    ]
    report = {'schema': 'whole-game-single-rom-map-runtime-v1', 'semantic_coverage_complete': False,
              'coverage': ['raw_32bit_attributes', 'layout_variable_border', 'dynamic_tile_metatile_palette_split', 'raw_behavior_dispatch_seam', 'object_context_graphics_banking', 'disjoint_object_palette_registry', 'donor_reflection_palette_pairs', 'regional_default_npc_palettes', 'explicit_player_graphics_bank_override', 'source_fame_checker_object_provider', 'explicit_fame_checker_palette_bank'],
              'unsupported': unsupported, 'patched_files': sorted(set(patched)), 'source_sha256': pins,
              'output_sha256': {rel: hashlib.sha256((stage / rel).read_bytes()).hexdigest() for rel in sorted(set(patched))},
              'donor_source_sha256': {rel: hashlib.sha256((donor / rel).read_bytes()).hexdigest() for rel in ('src/fieldmap.c', 'src/event_object_movement.c', 'src/metatile_behavior.c', 'include/global.fieldmap.h', 'include/constants/metatile_behaviors.h')},
              'status': 'blocked', 'buildEligible': False,
              'behavior_candidates': {str(i): name for i, name in sorted(mapping.items())},
              'used_donor_behavior_ids': sorted(used)}
    if report_dir is not None:
        destination = Path(report_dir)
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'map-runtime.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    return report
