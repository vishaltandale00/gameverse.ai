"""Preserve FireRed map-event semantics in an isolated Emerald source tree.

The donor map JSON is the authority for this inventory.  This pass is deliberately
after world_assets and map_runtime; it only edits the staged source snapshot.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

SCHEMA = "whole-game-map-events/v1"


def _replace_once(value: str, old: str, new: str, path: str) -> str:
    if value.count(old) != 1:
        raise ValueError(f"{path}: expected exactly one source anchor {old[:70]!r}")
    return value.replace(old, new, 1)


def _inventory(donor: Path, out: Path) -> dict:
    groups = json.loads((donor / "data/maps/map_groups.json").read_text())
    names = [name for group in groups["group_order"] for name in groups[group]]
    maps = {name: json.loads((donor / "data/maps" / name / "map.json").read_text()) for name in names}
    map_names_by_id = {data["id"]: name for name, data in maps.items()}
    clones, hidden = [], []
    for name in names:
        staged = json.loads((out / "data/maps" / ("FR" + name) / "map.json").read_text())
        source = maps[name]
        for field in ("object_events", "bg_events", "warp_events", "coord_events"):
            staged_count = len(staged.get(field, []))
            source_count = len(source.get(field, []))
            # The campaign stage may append native guide NPCs after donor rows.
            if (staged_count < source_count if field == "object_events" else staged_count != source_count):
                raise ValueError(f"FR{name}: {field} count differs from source")
        for index, event in enumerate(source.get("object_events", []), 1):
            if event.get("type") != "clone":
                continue
            target_map = map_names_by_id.get(event["target_map"])
            if target_map is None:
                raise ValueError(f"{name}: unknown clone target map {event['target_map']}")
            targets = [(i, target) for i, target in enumerate(maps[target_map]["object_events"], 1)
                       if target.get("local_id") == event["target_local_id"]]
            if len(targets) != 1 or targets[0][1].get("type") == "clone":
                raise ValueError(f"{name}: clone target must resolve to one normal object")
            staged_event = staged["object_events"][index - 1]
            # World importer canonicalizes token spelling; verify the semantic target separately.
            if staged_event.get("type") != "clone" or staged_event.get("target_local_id") not in (event["target_local_id"], "FR_" + event["target_local_id"]):
                raise ValueError(f"FR{name}: clone target local ID lost")
            clones.append({"map": name, "index": index, "targetMap": target_map,
                           "targetIndex": targets[0][0], "targetLocalId": event["target_local_id"],
                           "targetFlag": targets[0][1]["flag"], "targetScript": targets[0][1]["script"],
                           "targetMovement": targets[0][1]["movement_type"]})
        for index, event in enumerate(source.get("bg_events", []), 1):
            if event.get("type") != "hidden_item":
                continue
            quantity = int(event["quantity"])
            underfoot = event["underfoot"] in ("TRUE", "true", True, 1)
            if not 1 <= quantity <= 127:
                raise ValueError(f"{name}: hidden quantity exceeds FireRed's seven bits")
            staged_event = staged["bg_events"][index - 1]
            if (staged_event.get("type") != "hidden_item" or
                    int(staged_event.get("quantity", -1)) != quantity or
                    staged_event.get("underfoot") != event["underfoot"]):
                raise ValueError(f"FR{name}: hidden quantity/underfoot lost")
            hidden.append({"map": name, "index": index, "flag": event["flag"],
                           "item": event["item"], "quantity": quantity, "underfoot": underfoot})
    return {"maps": len(names), "clones": clones, "hiddenItems": hidden}


def stage_map_events(base, donor, out, report_dir=None):
    """Patch only isolated staged source; fail closed on changed source anchors."""
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == p or p in out.parents or out in p.parents for p in (base, donor)):
        raise ValueError("stage output must be isolated from canonical sources")
    if not (out / "data/maps/map_groups.json").is_file():
        raise ValueError("world_assets must stage maps before map_events")
    inventory = _inventory(donor, out)
    if len(inventory["clones"]) != 9 or len(inventory["hiddenItems"]) != 183:
        raise ValueError("pinned FireRed map-event inventory changed")
    modified = []

    def patch(path, transform):
        target = out / path
        if target.is_symlink() or (base / path).exists() and target.samefile(base / path):
            raise ValueError(f"{path}: staged source shares canonical source")
        original = target.read_text()
        updated = transform(original)
        if updated == original:
            raise ValueError(f"{path}: source patch had no effect")
        target.write_text(updated)
        modified.append(path)

    def mapjson(text):
        text = _replace_once(text, 'text << "\\tbg_hidden_item_event "',
                             'text << "\\t" << (mapName.rfind("FR", 0) == 0 ? "wg_bg_hidden_item_event " : "bg_hidden_item_event ")',
                             "tools/mapjson/mapjson.cpp")
        return _replace_once(text, 'if (version == "firered") {\n                    text << ", "',
                             'if (version == "firered" || mapName.rfind("FR", 0) == 0) {\n                    text << ", "',
                             "tools/mapjson/mapjson.cpp")

    patch("tools/mapjson/mapjson.cpp", mapjson)
    macro = '''\n\t@ FireRed's 12-byte BG event stores an 8-bit hidden flag offset, 7-bit quantity,
\t@ and one underfoot bit.  Emerald's own five-argument event is unchanged.
\t.macro wg_bg_hidden_item_event x:req, y:req, elevation:req, item:req, flag:req, quantity:req, underfoot:req
\t.if (\\flag - FR_FLAG_HIDDEN_ITEMS_START) < 0 || (\\flag - FR_FLAG_HIDDEN_ITEMS_START) > 255
\t.error "FireRed hidden-item flag exceeds packed 8-bit offset"
\t.endif
\t.if \\quantity < 1 || \\quantity > 127
\t.error "FireRed hidden-item quantity exceeds packed 7-bit field"
\t.endif
\t.2byte \\x, \\y
\t.byte \\elevation, BG_EVENT_HIDDEN_ITEM
\t.space 2
\t.2byte \\item
\t.byte (\\flag - FR_FLAG_HIDDEN_ITEMS_START)
\t.byte (\\quantity | (\\underfoot << 7))
\tinc _num_signs
\t.endm
'''
    patch("asm/macros/map.inc", lambda s: _replace_once(s, '\t@ Defines a background secret base event', macro + '\n\t@ Defines a background secret base event', "asm/macros/map.inc"))
    patch("data/map_events.s", lambda s: _replace_once(s, '#include "constants/firered_map_sentinels.h"', '#include "constants/firered_map_sentinels.h"\n#include "constants/whole_game_fr_state.h"\n#include "constants/whole_game_fr_encounters.h"\n#include "constants/whole_game_fr_scripts.h"', "data/map_events.s"))

    # The remainder is native source handling, not synthetic map-data flattening.
    _stage_clone_runtime(out, patch)
    _stage_hidden_runtime(out, patch)
    _stage_renewable_runtime(donor, out, patch, modified)
    report = {"schema": SCHEMA, "sourcePins": {p: hashlib.sha256((donor / p).read_bytes()).hexdigest() for p in ("data/maps/map_groups.json", "src/event_object_movement.c", "src/field_control_avatar.c", "src/itemfinder.c")},
              "modifiedFiles": sorted(set(modified)), "inventory": inventory,
              "semantics": {"clone": "target template identity/script/flag/movement with clone placement", "hidden": "packed item/flag/quantity/underfoot; native regional pickup and itemfinder"},
              "qualification": "source-staged; full native campaign requires separate build and play evidence"}
    if report_dir is not None:
        path = Path(report_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / "map-events.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def _stage_clone_runtime(out: Path, patch):
    helper = '''// FireRed clone entries are a source-map reference, not a self-contained NPC.
// Bytes 8, 12 and 14 retain the donor target-local/map-number/map-group ABI.
u32 WholeGame_MapEventsSemanticsVersion(void)
{
    return 1;
}

static const struct ObjectEventTemplate *WholeGame_CloneTarget(const struct ObjectEventTemplate *template, u8 *mapNum, u8 *mapGroup)
{
    const struct MapHeader *header;
    const struct ObjectEventTemplate *target;
    u8 targetLocalId;
    if (template->kind != OBJ_KIND_CLONE)
        return template;
    targetLocalId = template->elevation;
    *mapNum = template->trainerType;
    *mapGroup = template->trainerRange_berryTreeId;
    header = Overworld_GetMapHeaderByGroupAndId(*mapGroup, *mapNum);
    if (header == NULL || header->events == NULL || targetLocalId == 0 || targetLocalId > header->events->objectEventCount)
        return NULL;
    target = &header->events->objectEvents[targetLocalId - 1];
    if (target->kind != OBJ_KIND_NORMAL || target->localId != targetLocalId)
        return NULL;
    return target;
}

static u16 WholeGame_TemplateFlag(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)
{
    const struct ObjectEventTemplate *target = WholeGame_CloneTarget(template, &mapNum, &mapGroup);
    return target == NULL ? 0 : target->flagId;
}

// FireRed suppresses border obstacles according to the inherited target.
static bool8 WholeGame_IsDonorObstacle(const struct ObjectEventTemplate *template)
{
    return template->graphicsId == OBJ_EVENT_GFX_FR_CUT_TREE || template->graphicsId == OBJ_EVENT_GFX_FR_ROCK_SMASH_ROCK;
}

static bool8 WholeGame_ShouldInitObject(const struct ObjectEventTemplate *template, bool8 isClone, s16 cloneX, s16 cloneY)
{
    s32 width;
    s32 height;
    if (isClone && WholeGame_IsDonorObstacle(template))
    {
        if (gSaveBlock1Ptr->pos.x < cloneX)
        {
            if (gSaveBlock1Ptr->pos.x + MAP_OFFSET + 1 >= cloneX
             && gSaveBlock1Ptr->pos.y - MAP_OFFSET + 1 <= cloneY
             && gSaveBlock1Ptr->pos.y + MAP_OFFSET - 1 >= cloneY)
                return FALSE;
        }
        else if (gSaveBlock1Ptr->pos.x - MAP_OFFSET - 1 <= cloneX
              && gSaveBlock1Ptr->pos.y - MAP_OFFSET + 1 <= cloneY
              && gSaveBlock1Ptr->pos.y + MAP_OFFSET - 1 >= cloneY)
            return FALSE;
    }
    if (!WholeGame_IsKanto() || !WholeGame_IsDonorObstacle(template) || !IsMapTypeOutdoors(GetCurrentMapType()))
        return TRUE;
    width = gBackupMapLayout.width - MAP_OFFSET_W - 1;
    height = gBackupMapLayout.height - MAP_OFFSET_H - 1;
    if ((gSaveBlock1Ptr->pos.x == 0 && template->x <= MAP_OFFSET + 1)
     || (gSaveBlock1Ptr->pos.x == width && template->x >= width - MAP_OFFSET - 1)
     || (gSaveBlock1Ptr->pos.y == 0 && template->y <= MAP_OFFSET - 1)
     || (gSaveBlock1Ptr->pos.y == height && template->y >= height - MAP_OFFSET + 1))
    {
        if (template->flagId >= FLAG_TEMP_11 && template->flagId <= FLAG_TEMP_1F)
            FlagSet(template->flagId);
        return FALSE;
    }
    return TRUE;
}

'''
    def runtime(text):
        text = _replace_once(text, '#include "event_object_movement.h"', '#include "event_object_movement.h"\n#include "whole_game_state.h"', 'src/event_object_movement.c')
        text = _replace_once(text, 'static u8 InitObjectEventStateFromTemplate(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)\n{',
                             helper + 'static u8 InitObjectEventStateFromTemplate(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup)\n{',
                             'src/event_object_movement.c')
        text = _replace_once(text, '    s16 y;\n\n    if (GetAvailableObjectEventId(template->localId, mapNum, mapGroup, &objectEventId))',
                             '''    s16 y;
    bool8 isClone = template->kind == OBJ_KIND_CLONE;
    s16 cloneX = template->x;
    s16 cloneY = template->y;

    template = WholeGame_CloneTarget(template, &mapNum, &mapGroup);
    if (template == NULL)
        return OBJECT_EVENTS_COUNT;
    if (GetAvailableObjectEventId(template->localId, mapNum, mapGroup, &objectEventId))''',
                             'src/event_object_movement.c')
        text = _replace_once(text, '''    if (GetAvailableObjectEventId(template->localId, mapNum, mapGroup, &objectEventId))
        return OBJECT_EVENTS_COUNT;
    objectEvent = &gObjectEvents[objectEventId];''',
                             '''    if (GetAvailableObjectEventId(template->localId, mapNum, mapGroup, &objectEventId))
        return OBJECT_EVENTS_COUNT;
    if (!WholeGame_ShouldInitObject(template, isClone, cloneX, cloneY))
        return OBJECT_EVENTS_COUNT;
    objectEvent = &gObjectEvents[objectEventId];''', 'src/event_object_movement.c')
        text = _replace_once(text, '    x = template->x + MAP_OFFSET;\n    y = template->y + MAP_OFFSET;',
                             '    x = (isClone ? cloneX : template->x) + MAP_OFFSET;\n    y = (isClone ? cloneY : template->y) + MAP_OFFSET;',
                             'src/event_object_movement.c')
        text = _replace_once(text, 'if (template->localId == localId && !FlagGet(template->flagId))',
                             'if (template->localId == localId && !FlagGet(WholeGame_TemplateFlag(template, gSaveBlock1Ptr->location.mapNum, gSaveBlock1Ptr->location.mapGroup)))',
                             'src/event_object_movement.c')
        text = _replace_once(text, '''    graphicsInfo = GetObjectEventGraphicsInfo(WholeGameObjectGraphicsToken(objectEventTemplate->graphicsId, mapGroup, objectEventTemplate->localId));
    MakeSpriteTemplateFromObjectEventTemplate(objectEventTemplate, mapGroup, &spriteTemplate, &subspriteTables);''',
                             '''    {
        u8 targetMapNum = mapNum;
        u8 targetMapGroup = mapGroup;
        const struct ObjectEventTemplate *source = WholeGame_CloneTarget(objectEventTemplate, &targetMapNum, &targetMapGroup);
        if (source == NULL)
            return OBJECT_EVENTS_COUNT;
        graphicsInfo = GetObjectEventGraphicsInfo(WholeGameObjectGraphicsToken(source->graphicsId, targetMapGroup, source->localId));
        MakeSpriteTemplateFromObjectEventTemplate(source, targetMapGroup, &spriteTemplate, &subspriteTables);
    }''',
                             'src/event_object_movement.c')
        text = _replace_once(text, '&& !FlagGet(template->flagId))\n                TrySpawnObjectEventTemplate',
                             '&& !FlagGet(WholeGame_TemplateFlag(template, gSaveBlock1Ptr->location.mapNum, gSaveBlock1Ptr->location.mapGroup)))\n                TrySpawnObjectEventTemplate',
                             'src/event_object_movement.c')
        return text
    patch('src/event_object_movement.c', runtime)


def _stage_hidden_runtime(out: Path, patch):
    header = '''#ifndef GUARD_WHOLE_GAME_MAP_EVENTS_H
#define GUARD_WHOLE_GAME_MAP_EVENTS_H
struct BgEvent;
u16 WholeGame_HiddenItemFlag(const struct BgEvent *event);
u16 WholeGame_HiddenItemQuantity(const struct BgEvent *event);
bool8 WholeGame_HiddenItemUnderfoot(const struct BgEvent *event);
bool8 WholeGame_PrepareUnderfootHiddenItem(void);
u32 WholeGame_MapEventsSemanticsVersion(void);
#endif
'''
    (out / 'include/whole_game_map_events.h').write_text(header)
    helper = '''// Both engines use the same 12-byte BgEvent, but different high-word packing.
u16 WholeGame_HiddenItemFlag(const struct BgEvent *event)
{
    u32 raw = (u32)event->bgUnion.script;
    if (WholeGame_IsKanto())
        return FR_FLAG_HIDDEN_ITEMS_START + ((raw >> 16) & 0xFF);
    return FLAG_HIDDEN_ITEMS_START + event->bgUnion.hiddenItem.hiddenItemId;
}

u16 WholeGame_HiddenItemQuantity(const struct BgEvent *event)
{
    return WholeGame_IsKanto() ? (((u32)event->bgUnion.script >> 24) & 0x7F) : 1;
}

bool8 WholeGame_HiddenItemUnderfoot(const struct BgEvent *event)
{
    return WholeGame_IsKanto() && ((u32)event->bgUnion.script >> 31);
}

bool8 WholeGame_PrepareUnderfootHiddenItem(void)
{
    s16 x, y;
    u8 i;
    const struct BgEvent *event;
    if (!WholeGame_IsKanto() || gMapHeader.events == NULL)
        return FALSE;
    PlayerGetDestCoords(&x, &y);
    for (i = 0; i < gMapHeader.events->bgEventCount; i++)
    {
        event = &gMapHeader.events->bgEvents[i];
        if (event->kind == BG_EVENT_HIDDEN_ITEM && WholeGame_HiddenItemUnderfoot(event)
         && event->x + MAP_OFFSET == x && event->y + MAP_OFFSET == y
         && !FlagGet(WholeGame_HiddenItemFlag(event)))
        {
            gSpecialVar_0x8004 = WholeGame_HiddenItemFlag(event);
            gSpecialVar_0x8005 = (u16)(u32)event->bgUnion.script;
            gSpecialVar_0x8006 = 1; // FireRed itemfinder forces one for underfoot items.
            return TRUE;
        }
    }
    return FALSE;
}

'''
    def field(text):
        text = _replace_once(text, '#include "field_control_avatar.h"', '#include "field_control_avatar.h"\n#include "whole_game_state.h"\n#include "whole_game_map_events.h"\n#include "constants/whole_game_fr_state.h"\nextern const u8 FR_EventScript_HiddenItemScript[];', 'src/field_control_avatar.c')
        text = _replace_once(text, 'static EWRAM_DATA u8 sWildEncounterImmunitySteps = 0;', helper + 'static EWRAM_DATA u8 sWildEncounterImmunitySteps = 0;', 'src/field_control_avatar.c')
        old = '''        gSpecialVar_0x8004 = ((u32)bgEvent->bgUnion.script >> 16) + FLAG_HIDDEN_ITEMS_START;
        gSpecialVar_0x8005 = (u32)bgEvent->bgUnion.script;
        if (FlagGet(gSpecialVar_0x8004) == TRUE)
            return NULL;
        return EventScript_HiddenItemScript;'''
        new = '''        if (WholeGame_HiddenItemUnderfoot(bgEvent))
            return NULL; // FireRed requires the itemfinder to dig these up.
        gSpecialVar_0x8004 = WholeGame_HiddenItemFlag(bgEvent);
        gSpecialVar_0x8005 = (u16)(u32)bgEvent->bgUnion.script;
        gSpecialVar_0x8006 = WholeGame_HiddenItemQuantity(bgEvent);
        if (FlagGet(gSpecialVar_0x8004) == TRUE)
            return NULL;
        return WholeGame_IsKanto() ? FR_EventScript_HiddenItemScript : EventScript_HiddenItemScript;'''
        return _replace_once(text, old, new, 'src/field_control_avatar.c')
    patch('src/field_control_avatar.c', field)
    def item_use(text):
        text = _replace_once(text, '#include "item_menu.h"\n#include "item_use.h"', '#include "item_menu.h"\n#include "item_use.h"\n#include "whole_game_map_events.h"\nextern const u8 FR_EventScript_ItemfinderDigUpUnderfootItem[];', 'src/item_use.c')
        text = _replace_once(text, 'events->bgEvents[i].bgUnion.hiddenItem.hiddenItemId + FLAG_HIDDEN_ITEMS_START', 'WholeGame_HiddenItemFlag(&events->bgEvents[i])', 'src/item_use.c')
        text = _replace_once(text, 'bgEvent[i].bgUnion.hiddenItem.hiddenItemId + FLAG_HIDDEN_ITEMS_START', 'WholeGame_HiddenItemFlag(&bgEvent[i])', 'src/item_use.c')
        text = _replace_once(text, '''        if (tCounter == 4)
            DisplayItemMessageOnField(taskId, gText_ItemFinderOnTop, Task_CloseItemfinderMessage);''',
                             '''        if (tCounter == 4)
        {
            if (WholeGame_PrepareUnderfootHiddenItem())
            {
                DestroyTask(taskId);
                ScriptContext_SetupScript(FR_EventScript_ItemfinderDigUpUnderfootItem);
                LockPlayerFieldControls();
            }
            else
                DisplayItemMessageOnField(taskId, gText_ItemFinderOnTop, Task_CloseItemfinderMessage);
        }''', 'src/item_use.c')
        return text
    patch('src/item_use.c', item_use)


def _stage_renewable_runtime(donor: Path, out: Path, patch, modified: list[str]):
    """Port the exact donor renewal table and sampling functions into the one engine."""
    source = (donor / 'src/renewable_hidden_items.c').read_text()
    for old, new in (
        ('SetAllRenewableItemFlags', 'FR_SetAllRenewableItemFlags'),
        ('IncrementRenewableHiddenItemStepCounter', 'FR_IncrementRenewableHiddenItemStepCounter'),
        ('TryRegenerateRenewableHiddenItems', 'FR_TryRegenerateRenewableHiddenItems'),
    ):
        source = re.sub(r'\b' + old + r'\b', new, source)
    source = re.sub(r'\bMAP_(?!GROUP\b|NUM\b)([A-Z0-9_]+)', r'MAP_FR_\1', source)
    source = re.sub(r'\bFLAG_([A-Z0-9_]+)', r'FR_FLAG_\1', source)
    source = re.sub(r'\bVAR_([A-Z0-9_]+)', r'FR_VAR_\1', source)
    source = source.replace('#include "constants/maps.h"', '#include "constants/maps.h"\n#include "constants/whole_game_fr_state.h"')
    relative = 'src/whole_game_fr_renewable_hidden_items.c'
    (out / relative).write_text(source)
    modified.append(relative)
    header = out / 'include/whole_game_map_events.h'
    contents = header.read_text().replace('u32 WholeGame_MapEventsSemanticsVersion(void);',
                                          'u32 WholeGame_MapEventsSemanticsVersion(void);\nvoid FR_IncrementRenewableHiddenItemStepCounter(void);\nvoid FR_TryRegenerateRenewableHiddenItems(void);\nvoid FR_SetAllRenewableItemFlags(void);')
    header.write_text(contents)
    def field(text):
        return _replace_once(text, '''        IncrementGameStat(GAME_STAT_STEPS);
        IncrementBirthIslandRockStepCount();''',
                             '''        IncrementGameStat(GAME_STAT_STEPS);
        if (WholeGame_IsKanto())
            FR_IncrementRenewableHiddenItemStepCounter();
        IncrementBirthIslandRockStepCount();''', 'src/field_control_avatar.c')
    patch('src/field_control_avatar.c', field)
    def overworld(text):
        text = _replace_once(text, '#include "event_data.h"', '#include "event_data.h"\n#include "whole_game_map_events.h"\n#include "whole_game_state.h"', 'src/overworld.c')
        anchor = '    RunOnTransitionMapScript();\n'
        if text.count(anchor) != 2:
            raise ValueError('src/overworld.c: expected both original map-entry sites')
        return text.replace(anchor, anchor + '    if (WholeGame_IsKanto())\n        FR_TryRegenerateRenewableHiddenItems();\n')
    patch('src/overworld.c', overworld)
