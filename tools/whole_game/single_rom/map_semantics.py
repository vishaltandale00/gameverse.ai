"""Source-derived FireRed metatile consumers in an isolated Emerald tree.

This stage preserves donor behavior IDs and dispatches donor predicates; it does
not equate matching enum names. Outstanding engine consumers remain hard gates.
"""
from __future__ import annotations
import hashlib
import json
import re
import struct
from collections import Counter
from pathlib import Path

FUNC = re.compile(r'\b(bool8|bool32|u8|u16|u32)\s+(MetatileBehavior_\w+|TestMetatileAttributeBit)\(([^{};]*)\)\s*\{')
ALIASES = {
    'IsSandOrDeepSand':'IsSandOrShallowFlowingWater',
    'IsSurfableWaterOrUnderwater':'IsSurfable',
    'IsDeepOrOceanWater':'IsDeepWaterTerrain', 'IsDoor':'IsWarpDoor_2',
    'IsBookShelf':'IsBookshelf', 'IsShopShelf':'IsPokeMartShelf',
    'IsBlueprint':'IsBlueprints', 'IsTrashCan':'IsTrashBin',
    'IsBridgeOverWater':'IsBridge', 'IsBridgeOverWaterNoEdge':'IsBridge',
    'IsLongGrass_Duplicate':'IsLongGrass',
}


def stage_map_semantics(emerald_source, firered_source, output_tree, report_dir=None):
    emerald, donor, stage = [Path(p).resolve() for p in (emerald_source, firered_source, output_tree)]
    if any(stage == p or p in stage.parents or stage in p.parents for p in (emerald, donor)):
        raise ValueError('output_tree must be isolated from canonical sources')
    hashes, patched = {}, []
    def read(root, rel):
        data = (root / rel).read_text()
        hashes[('firered/' if root == donor else 'staged/') + rel] = hashlib.sha256(data.encode()).hexdigest()
        return data
    def write(rel, data):
        path = stage / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)
        patched.append(rel)
    def once(data, old, new):
        if data.count(old) != 1:
            raise ValueError('unsupported source revision: ' + old[:90])
        return data.replace(old, new, 1)
    d = read(donor, 'src/metatile_behavior.c')
    constants = read(donor, 'include/constants/metatile_behaviors.h')
    # Keep the original values, tables and predicate bodies, including donor FALSE
    # stubs. Namespacing avoids host enum collisions in this translation unit.
    defs = re.findall(r'^#define\s+((?:MB_\w+|NUM_METATILE_BEHAVIORS))\s+(0x[0-9A-Fa-f]+|\d+)\s*$', constants, re.M)
    symbols = {name:'WGFR_' + name for name, _ in defs}
    donor_funcs = {m[2]:m for m in FUNC.finditer(d)}
    symbols.update({name:'WGFR_' + name for name in donor_funcs})
    symbols.update({'sBehaviorSurfable':'wgfrBehaviorSurfable', 'sTileBitAttributes':'wgfrTileBitAttributes'})
    d = re.sub(r'^#include[^\n]*\n', '', d, flags=re.M)
    d = re.sub(r'\b[A-Za-z_]\w*\b', lambda m:symbols.get(m[0],m[0]), d)
    # Original table only has entries through 0xef. Guard external unknown bytes.
    d = d.replace('wgfrBehaviorSurfable[metatileBehavior]', '(metatileBehavior < WGFR_NUM_METATILE_BEHAVIORS ? wgfrBehaviorSurfable[metatileBehavior] : FALSE)')
    declarations = '\n'.join(f'{m[1]} WGFR_{name}({m[3]});' for name,m in donor_funcs.items())
    namespaced_constants = '\n'.join(f'#define WGFR_{name} {value}' for name,value in defs)
    write('include/whole_game_fr_semantics.h', '''#ifndef GUARD_WHOLE_GAME_FR_SEMANTICS_H
#define GUARD_WHOLE_GAME_FR_SEMANTICS_H
#include "global.h"
#include "fieldmap.h"
#include "metatile_behavior.h"
bool8 WholeGameIsFireRedMap(void);
u16 WholeGameFireRedBehavior(u16 behavior);
u8 WholeGameFireRedTerrainAt(s16 x, s16 y);
u8 WholeGameFireRedEncounterAt(s16 x, s16 y);
''' + declarations + '\n#endif\n')
    helpers = '''
bool8 WholeGameIsFireRedMap(void)
{
    return gMapHeader.mapLayout->primaryTileset->fireRedMetatileAttributes != NULL;
}
u16 WholeGameFireRedBehavior(u16 behavior)
{
    return behavior;
}
u8 WholeGameFireRedTerrainAt(s16 x, s16 y)
{
    static const u8 bits[32] = {0, 1, 2, 4, 8};
    return bits[WholeGameFireRedAttribute(gMapHeader.mapLayout, MapGridGetMetatileIdAt(x, y), 1)];
}
u8 WholeGameFireRedEncounterAt(s16 x, s16 y)
{
    return WholeGameFireRedAttribute(gMapHeader.mapLayout, MapGridGetMetatileIdAt(x, y), 4);
}
'''
    host = read(stage, 'src/metatile_behavior.c')
    dispatched, blocked_predicates = {}, []
    def dispatch(m):
        name, args = m[2], m[3]
        target = name if name in donor_funcs else 'MetatileBehavior_' + ALIASES.get(name.removeprefix('MetatileBehavior_'), '')
        if target not in donor_funcs:
            # Explicitly reject donor-domain semantics without a source equivalent.
            # This is visible in the admission ledger, never counted as supported.
            blocked_predicates.append(name)
            branch = 'FALSE'
        else:
            params = [a.strip().split()[-1] for a in args.split(',')]
            branch = f'WGFR_{target}(' + ', '.join(params) + ')'
            dispatched[name] = target
        return m[0] + '\n    if (WholeGameIsFireRedMap())\n        return ' + branch + ';\n'
    host = FUNC.sub(dispatch, host)
    write('src/metatile_behavior.c', '#include "whole_game_fr_semantics.h"\n' + namespaced_constants + '\n' + declarations + '\n' + d + '\n' + helpers + '\n' + host)
    # Battle terrain policy is donor source, including no host weather override.
    rel = 'src/battle_setup.c'
    text = read(stage, rel)
    donor_battle = read(donor, rel)
    a = donor_battle.index('u8 BattleSetup_GetTerrainId(void)')
    b = donor_battle.index('\nstatic u8 GetBattleTransitionTypeByMap', a)
    battle = donor_battle[a:b].replace('BattleSetup_GetTerrainId','WholeGameFireRedBattleEnvironment')
    battle = battle.replace('BATTLE_TERRAIN_', 'BATTLE_ENVIRONMENT_')
    battle = re.sub(r'\bMetatileBehavior_\w+', lambda m:'WGFR_' + m[0], battle)
    needle = 'u8 BattleSetup_GetEnvironmentId(void)\n{'
    text = once(text, needle, battle + '\n' + needle)
    text = once(text, needle + '\n    u16 tileBehavior;\n    s16 x, y;', needle + '\n    u16 tileBehavior;\n    s16 x, y;\n\n    if (WholeGameIsFireRedMap())\n        return WholeGameFireRedBattleEnvironment();')
    write(rel, '#include "whole_game_fr_semantics.h"\n' + text)
    # Preserve source-native FR surf dismount elevation (3 vs Emerald default).
    rel = 'src/field_player_avatar.c'
    text = read(stage, rel)
    a = text.index('static bool8 CanStopSurfing(s16 x, s16 y, u8 direction)\n{')
    b = text.index('\nstatic bool8 ShouldJumpLedge',a)
    snippet = text[a:b].replace('ELEVATION_DEFAULT', '(WholeGameIsFireRedMap() ? 3 : ELEVATION_DEFAULT)')
    text = text[:a] + snippet + text[b:]
    a = text.index('bool8 IsPlayerFacingSurfableFishableWater(void)\n{')
    b = text.index('\nvoid ClearPlayerAvatarInfo', a)
    facing = text[a:b].replace('PlayerGetElevation() == ELEVATION_DEFAULT', 'PlayerGetElevation() == (WholeGameIsFireRedMap() ? 3 : ELEVATION_DEFAULT)')
    facing = facing.replace('MetatileBehavior_IsSurfableFishableWater(MapGridGetMetatileBehaviorAt(x, y))', '(WholeGameIsFireRedMap() ? (WholeGameFireRedTerrainAt(x, y) & 2) != 0 : MetatileBehavior_IsSurfableFishableWater(MapGridGetMetatileBehaviorAt(x, y)))')
    text = text[:a] + facing + text[b:]
    write(rel, '#include "whole_game_fr_semantics.h"\n' + text)
    # Original FR Cut replacement map uses donor metatile IDs, never host IDs.
    rel = 'src/fldeff_cut.c'
    text = read(stage, rel)
    donor_cut = read(donor, rel)
    labels = read(donor, 'include/constants/metatile_labels.h')
    label_values = dict(re.findall(r'^#define\s+(METATILE_\w+)\s+(0x[0-9A-Fa-f]+)', labels, re.M))
    a = donor_cut.index('static const u16 sCutGrassMetatileMapping')
    b = donor_cut.index('\nstatic const struct OamData',a)
    mapping = donor_cut[a:b].replace('sCutGrassMetatileMapping','wgfrCutMapping')
    mapping = re.sub(r'METATILE_ID\((\w+),\s*(\w+)\)', lambda m:label_values['METATILE_' + m[1] + '_' + m[2]], mapping)
    cut_helper = mapping + '''
static void WholeGameFireRedCutAt(s16 x, s16 y)
{
    u16 i, tile = MapGridGetMetatileIdAt(x, y);
    for (i = 0; wgfrCutMapping[i][0] != 0xffff; i++)
        if (wgfrCutMapping[i][0] == tile)
        {
            MapGridSetMetatileIdAt(x, y, wgfrCutMapping[i][1]);
            return;
        }
}
'''
    text = once(text, 'static void SetCutGrassMetatile(s16 x, s16 y)\n{', cut_helper + '\nstatic void SetCutGrassMetatile(s16 x, s16 y)\n{\n    if (WholeGameIsFireRedMap())\n    {\n        WholeGameFireRedCutAt(x, y);\n        return;\n    }')
    text = once(text, '    s16 lowerY = y + sCutSquareSide;\n', '    s16 lowerY = y + sCutSquareSide;\n\n    if (WholeGameIsFireRedMap())\n        return;\n')
    # Donor normal Cut always scans a 3x3 elevation-matched square. Hyper Cutter
    # expansion and Emerald collision flags must not alter donor eligibility.
    setup = """
static bool8 wgfrScheduleOpenDottedHole;
extern bool8 FR_CutMoveRuinValleyCheck(void);
extern void FR_CutMoveOpenDottedHoleDoor(void);
static bool8 WholeGameFireRedSetUpCut(void)
{
    s16 x, y;
    u8 i, j;
    wgfrScheduleOpenDottedHole = FALSE;
    if (FR_CutMoveRuinValleyCheck())
    {
        wgfrScheduleOpenDottedHole = TRUE;
        gFieldCallback2 = FieldCallback_PrepareFadeInFromMenu;
        gPostMenuFieldCallback = FieldCallback_CutGrass;
        return TRUE;
    }
    if (CheckObjectGraphicsInFrontOfPlayer(OBJ_EVENT_GFX_CUTTABLE_TREE))
    {
        gFieldCallback2 = FieldCallback_PrepareFadeInFromMenu;
        gPostMenuFieldCallback = FieldCallback_CutTree;
        return TRUE;
    }
    PlayerGetDestCoords(&gPlayerFacingPosition.x, &gPlayerFacingPosition.y);
    for (i = 0; i < 3; i++)
        for (j = 0; j < 3; j++)
        {
            x = gPlayerFacingPosition.x - 1 + j;
            y = gPlayerFacingPosition.y - 1 + i;
            if (MapGridGetElevationAt(x, y) == gPlayerFacingPosition.elevation
             && (WholeGameFireRedTerrainAt(x, y) & 1))
            {
                gFieldCallback2 = FieldCallback_PrepareFadeInFromMenu;
                gPostMenuFieldCallback = FieldCallback_CutGrass;
                return TRUE;
            }
        }
    return FALSE;
}
"""
    text = once(text, 'bool8 SetUpFieldMove_Cut(void)\n{', setup + '\nbool8 SetUpFieldMove_Cut(void)\n{')
    text = once(text, '    bool8 ret;\n', '    bool8 ret;\n\n    if (WholeGameIsFireRedMap())\n        return WholeGameFireRedSetUpCut();\n')
    loop = """    if (WholeGameIsFireRedMap())
    {
        u8 row, col;
        for (row = 0; row < 3; row++)
            for (col = 0; col < 3; col++)
            {
                x = gPlayerFacingPosition.x - 1 + col;
                y = gPlayerFacingPosition.y - 1 + row;
                if (MapGridGetElevationAt(x, y) == gPlayerFacingPosition.elevation
                 && (WholeGameFireRedTerrainAt(x, y) & 1))
                {
                    SetCutGrassMetatile(x, y);
                    AllowObjectAtPosTriggerGroundEffects(x, y);
                }
            }
    }
    else
"""
    start = text.index('bool8 FldEff_CutGrass(void)\n{')
    pos = text.index('    for (i = 0; i < CUT_HYPER_AREA; i++)',start)
    text = text[:pos] + loop + text[pos:]

    text = text.replace('MetatileBehavior_IsPokeGrass(tileBehavior)', '(WholeGameIsFireRedMap() ? (WholeGameFireRedTerrainAt(x, y) & 1) != 0 : MetatileBehavior_IsPokeGrass(tileBehavior))')
    text = text.replace('MetatileBehavior_IsCuttableGrass(tileBehavior)', '(WholeGameIsFireRedMap() ? (WholeGameFireRedTerrainAt(x, y) & 1) != 0 : MetatileBehavior_IsCuttableGrass(tileBehavior))')
    # Dotted Hole is a donor field native supplied by campaign_services.c.
    # The post-show-mon callback must open the door instead of cutting grass.
    text = once(text, '    FieldEffectActiveListRemove(FLDEFF_USE_CUT_ON_GRASS);\n    FieldEffectStart(FLDEFF_CUT_GRASS);', '    FieldEffectActiveListRemove(FLDEFF_USE_CUT_ON_GRASS);\n    if (WholeGameIsFireRedMap() && wgfrScheduleOpenDottedHole)\n        FR_CutMoveOpenDottedHoleDoor();\n    else\n        FieldEffectStart(FLDEFF_CUT_GRASS);')
    write(rel, '#include "whole_game_fr_semantics.h"\n' + text)
    # Audit every original attribute record, including unused metatiles. This
    # establishes whether the engine's byte-sized movement storage is lossless
    # for the pinned donor assets rather than masking a nine-bit source ID.
    behavior_counts = Counter()
    attribute_files = sorted((donor/'data/tilesets').rglob('metatile_attributes.bin'))
    for path in attribute_files:
        blob = path.read_bytes()
        hashes['firered/' + str(path.relative_to(donor))] = hashlib.sha256(blob).hexdigest()
        behavior_counts.update(value[0] & 0x1ff for value in struct.iter_unpack('<I', blob))
    unsupported = [
        {'consumer':'field_player_avatar.c','reason':'FR spin tiles, directional stair warps and cycling-road pull-down movement executors are not ported'},
        {'consumer':'tv.c/secret_base.c/fldeff_misc.c/field_effect.c','reason':'Direct host MB constant consumers require source-domain audit; field_control_avatar/player_avatar/event_object_movement contain no literal MB constants'},
        {'consumer':'metatile_behavior.c','reason':'Host-only predicates have no admitted donor equivalent','predicates':sorted(blocked_predicates)},
    ]
    wide = sorted(value for value in behavior_counts if value >= 256)
    if wide:
        unsupported.append({'consumer':'behavior storage','reason':'Donor nine-bit behavior cannot fit native object movement storage','values':wide})
    ledger = {'schema_version':1,'semantic_coverage_complete':False,'unsupported':unsupported,
              'attribute_audit':{'tileset_files':len(attribute_files),'attribute_records':sum(behavior_counts.values()),'behavior_counts':dict(sorted(behavior_counts.items())),'unrepresentable_behavior_ids':wide},
              'patched_files':patched,'source_hashes':hashes,'predicate_dispatch':dict(sorted(dispatched.items())),
              'dependencies':['exact donor wild runtime from stage_encounters','FR_CutMoveRuinValleyCheck and FR_CutMoveOpenDottedHoleDoor from native services'],
              'supported':['raw donor behavior identity','donor predicate bodies and surfability table','terrain field1 bit lookup','encounter field4 land/water selection','FR source battle terrain policy','FR surf dismount and surf-facing elevation/terrain policy','FR Cut terrain eligibility and 3x3 elevation-matched replacement policy','Dotted Hole Cut dispatch to donor field natives'],
              'measurement':{'build_duration_seconds':None,'reason':'source transform; no ROM build performed'}}
    if report_dir:
        report = Path(report_dir); report.mkdir(parents=True, exist_ok=True)
        (report/'map-semantics-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
