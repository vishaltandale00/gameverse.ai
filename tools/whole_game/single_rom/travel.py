"""Source-derived donor heal, blackout and warp lifecycle for one native engine."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from .native_services import functions
from .scripts import rewrite_tokens


def extract(root: Path, relative: str, name: str) -> str:
    matches = [f.source for f in functions((root / relative).read_text(), relative) if f.name == name]
    if len(matches) != 1:
        raise ValueError(f'expected unique source function {relative}:{name}')
    return matches[0]


def heal_records(base: Path, donor: Path):
    native = json.loads((base / 'src/data/heal_locations.json').read_text())['heal_locations']
    donor_records = json.loads((donor / 'src/data/heal_locations.json').read_text())['heal_locations']
    groups = json.loads((donor / 'data/maps/map_groups.json').read_text())
    maps = {json.loads((donor / 'data/maps' / name / 'map.json').read_text())['id']: name
            for group in groups['group_order'] for name in groups[group]}
    records = []
    for index, row in enumerate(donor_records):
        respawn = json.loads((donor / 'data/maps' / maps[row['respawn_map']] / 'map.json').read_text())
        ids = [i + 1 for i, obj in enumerate(respawn['object_events']) if obj.get('local_id') == row['respawn_npc']]
        if len(ids) != 1:
            raise ValueError(f'unknown original healer NPC {row}')
        records.append({**row, 'idValue': len(native) + index + 1, 'donorIndex': index + 1,
                        'npcValue': ids[0]})
    if len(native) + len(records) > 255:
        raise ValueError('native u8 heal destination capacity exceeded')
    return native, records


def namespace_source(text: str, extra=None):
    symbols = {}
    for token in set(re.findall(r'\b[A-Za-z_]\w*\b', text)):
        if token.startswith(('FLAG_', 'VAR_', 'HEAL_LOCATION_')):
            symbols[token] = 'FR_' + token
        if token.startswith('MAP_') and not token.startswith(('MAP_GROUP', 'MAP_NUM', 'MAP_OFFSET')):
            symbols[token] = 'MAP_FR_' + token[4:]
    symbols.update(extra or {})
    return rewrite_tokens(text, symbols)


def runtime_source(donor: Path, rows: list[dict], base: Path | None = None) -> str:
    names = ['GetHealLocationIndexFromMapGroupAndNum', 'SetWhiteoutRespawnWarpAndHealerNpc',
             'SetWhiteoutRespawnHealerNpcAsLastTalked', 'ComputeWhiteOutMoneyLoss',
             'OverworldWhiteOutGetMoneyLoss', 'CountBadgesForOverworldWhiteOutLossCalculation',
             'GetPlayerPartyHighestLevel', 'PrintWhiteOutRecoveryMessage',
             'Task_RushInjuredPokemonToCenter', 'FieldCB_RushInjuredPokemonToCenter', 'SetCB2WhiteOut']
    symbols = {name: 'FR_' + name for name in names}
    symbols.update({'sHealLocations': 'sFRHealLocations', 'sWhiteoutRespawnHealCenterMapIdxs': 'sFRRespawnMaps',
        'sWhiteoutRespawnHealerNpcIds': 'sFRRespawnNpcs', 'sWhiteOutMoneyLossMultipliers': 'sFRMoneyMultipliers',
        'sWhiteOutMoneyLossBadgeFlagIDs': 'sFRBadgeFlags', 'sWindowTemplate_WhiteoutText': 'sFRWhiteoutWindow',
        'sWhiteoutTextColors': 'sFRWhiteoutColors', 'gText_PlayerScurriedToCenter': 'sFRScurriedCenter',
        'gText_PlayerScurriedBackHome': 'sFRScurriedHome', 'EventScript_AfterWhiteOutHeal': 'FR_EventScript_AfterWhiteOutHeal',
        'EventScript_AfterWhiteOutMomHeal': 'FR_EventScript_AfterWhiteOutMomHeal',
        'palette_bg_faded_fill_black': 'FR_TravelPaletteBlack',
        'FieldFadeTransitionBackgroundEffectIsFinished': 'FR_TravelFadeFinished',
        'CountDigits': 'FR_TravelCountDigits', 'FONT_NORMAL': 'FR_FONT_NORMAL'})
    source = '''#include "global.h"
#include "whole_game_travel.h"
#include "whole_game_state.h"
#include "pokemon_storage_system.h"
#include "pokemon.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "field_player_avatar.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "heal_location.h"
#include "main.h"
#include "menu.h"
#include "money.h"
#include "overworld.h"
#include "palette.h"
#include "script.h"
#include "string_util.h"
#include "task.h"
#include "text.h"
#include "window.h"
#include "constants/whole_game_fr_state.h"
#include "constants/whole_game_fr_heal_locations.h"
#include "constants/maps.h"
#include "constants/rgb.h"
#include "constants/event_object_movement.h"

extern const u8 FR_EventScript_AfterWhiteOutHeal[];
extern const u8 FR_EventScript_AfterWhiteOutMomHeal[];
// This source-owned Trainer Tower state cannot be approximated by a scene flag.
extern bool8 FR_TrainerTowerSpokeToOwner(void);
extern bool32 FR_ForestMapPreviewScreenIsRunning(void);
static void FR_SetWhiteoutRespawnHealerNpcAsLastTalked(u32 index);
static u8 FR_CountBadgesForOverworldWhiteOutLossCalculation(void);
static u8 FR_GetPlayerPartyHighestLevel(void);
static bool32 FR_TravelFadeFinished(void)
{
    return IsWeatherNotFadingIn() == TRUE && FR_ForestMapPreviewScreenIsRunning();
}
static void FR_TravelPaletteBlack(void)
{
    CpuFastFill16(RGB_BLACK, gPlttBufferFaded, PLTT_SIZE);
}
'''
    source += 'static const struct HealLocation sFRHealLocations[] = {\n'
    source += '\n'.join(f'    {{MAP_GROUP(MAP_FR_{r["map"][4:]}), MAP_NUM(MAP_FR_{r["map"][4:]}), {r["x"]}, {r["y"]}}},' for r in rows) + '\n};\n'
    source += 'static const u16 sFRRespawnMaps[][2] = {\n'
    source += '\n'.join(f'    {{MAP_GROUP(MAP_FR_{r["respawn_map"][4:]}), MAP_NUM(MAP_FR_{r["respawn_map"][4:]})}},' for r in rows) + '\n};\n'
    source += 'static const u8 sFRRespawnNpcs[] = {' + ', '.join(str(r['npcValue']) for r in rows) + '};\n'
    for relative, pattern in [('src/overworld.c', r'static const u8 sWhiteOutMoneyLossMultipliers\[\].*?\n\};'),
                              ('src/overworld.c', r'static const u16 sWhiteOutMoneyLossBadgeFlagIDs\[\].*?\n\};'),
                              ('src/field_screen_effect.c', r'static const struct WindowTemplate sWindowTemplate_WhiteoutText.*?\n\};'),
                              ('src/field_screen_effect.c', r'static const u8 sWhiteoutTextColors\[\].*?;')]:
        found = re.search(pattern, (donor / relative).read_text(), re.S)
        if not found:
            raise ValueError(f'donor data source drift: {pattern}')
        source += namespace_source(found[0], symbols) + '\n'
    strings = (donor / 'src/strings.c').read_text()
    for name in ('gText_PlayerScurriedToCenter', 'gText_PlayerScurriedBackHome'):
        found = re.search(r'const u8 ' + name + r'\[\].*?;', strings)
        if not found:
            raise ValueError('donor whiteout source text missing')
        string_source = found[0]
        if '‥' in string_source:
            # Exact source encoding equivalence: both spellings encode byte B0.
            if not re.search(r"^'‥'\s*= B0\s*$", (donor / 'charmap.txt').read_text(), re.M):
                raise ValueError('donor double-dot ellipsis encoding changed')
            if base and not re.search(r"^'…'\s*= B0\s*$", (base / 'charmap.txt').read_text(), re.M):
                raise ValueError('host ellipsis encoding changed')
            string_source = string_source.replace('‥', '…')
        source += namespace_source('static ' + string_source, symbols) + '\n'
    source += 'static ' + namespace_source(extract(donor, 'src/field_specials.c', 'CountDigits'), symbols) + '\n'
    source += '#define tState data[0]\n#define tWindowId data[1]\n#define tPrintState data[2]\n'
    for name in names:
        relative = 'src/heal_location.c' if name in names[:3] else 'src/overworld.c'
        if name == 'GetPlayerPartyHighestLevel': relative = 'src/pokemon.c'
        if name in names[7:10]: relative = 'src/field_screen_effect.c'
        if name == 'SetCB2WhiteOut': relative = 'src/post_battle_event_funcs.c'
        text = extract(donor, relative, name)
        if name == 'SetWhiteoutRespawnWarpAndHealerNpc':
            text = text.replace('!gSaveBlock1Ptr->trainerTower[gSaveBlock1Ptr->towerChallengeId].spokeToOwner', '!FR_TrainerTowerSpokeToOwner()')
            # Original BUGFIX branch is mandatory: invalid last heal may never index -1.
            text = text.replace('#ifdef BUGFIX', '#if 1')
        if name == 'GetPlayerPartyHighestLevel': text = 'static ' + text
        source += namespace_source(text, symbols) + '\n\n'
    source += '#undef tState\n#undef tWindowId\n#undef tPrintState\n'
    return source


REGION_SWITCH = '''
// The only cached values are original native last-heal warps, one per region.
static void WholeGame_SwitchHealRegion(u8 destination)
{
    struct PokemonStorage *pc = gPokemonStoragePtr;
    const struct HealLocation *home;
    if (pc->wholeGameKanto.healSchema != 0x48454131)
    {
        pc->wholeGameKanto.lastHeal[0] = gSaveBlock1Ptr->lastHealLocation;
        home = GetHealLocation(FR_HEAL_LOCATION_PALLET_TOWN);
        pc->wholeGameKanto.lastHeal[1].mapGroup = home->mapGroup;
        pc->wholeGameKanto.lastHeal[1].mapNum = home->mapNum;
        pc->wholeGameKanto.lastHeal[1].warpId = WARP_ID_NONE;
        pc->wholeGameKanto.lastHeal[1].x = home->x;
        pc->wholeGameKanto.lastHeal[1].y = home->y;
        pc->wholeGameKanto.healSchema = 0x48454131;
    }
    pc->wholeGameKanto.lastHeal[WholeGame_IsKanto() ? 1 : 0] = gSaveBlock1Ptr->lastHealLocation;
    gSaveBlock1Ptr->lastHealLocation = pc->wholeGameKanto.lastHeal[destination];
}
void WholeGame_TravelHealToKanto(void) { WholeGame_SwitchHealRegion(1); }
void WholeGame_TravelHealToHoenn(void) { WholeGame_SwitchHealRegion(0); }
'''


def stage_travel(base, donor, output, report_dir=None):
    base, donor, out = (Path(p).resolve() for p in (base, donor, output))
    if any(out == p or p in out.parents or out in p.parents for p in (base, donor)):
        raise ValueError('travel requires isolated output')
    if (out / 'include/whole_game_travel.h').exists():
        raise ValueError('travel already applied')
    native, rows = heal_records(base, donor)
    changed = []
    def write(name, content):
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        changed.append(name)
    def patch(name, old, new):
        text = (out / name).read_text()
        if text.count(old) != 1:
            raise ValueError(f'travel patch source drift: {name}:{old}')
        write(name, text.replace(old, new))
    if 'lastHeal[2]' not in (out / 'include/pokemon_storage_system.h').read_text():
        raise ValueError('state must provide durable lastHeal[2]/healSchema')
    imported = [{key: ('MAP_FR_' + value[4:] if key == 'map' else value) for key, value in row.items() if key in ('map','x','y')} |
                {'id': 'WHOLE_GAME_' + row['id']} for row in rows]
    write('src/data/heal_locations.json', json.dumps({'heal_locations': native + imported}, indent=2) + '\n')
    header = ['#ifndef GUARD_WHOLE_GAME_FR_HEAL_LOCATIONS_H', '#define GUARD_WHOLE_GAME_FR_HEAL_LOCATIONS_H', '#define FR_HEAL_LOCATION_NONE 0']
    header += [f'#define FR_{r["id"]} {r["idValue"]}' for r in rows]
    write('include/constants/whole_game_fr_heal_locations.h', '\n'.join(header + ['#endif', '']))
    write('include/whole_game_travel.h', '''#ifndef GUARD_WHOLE_GAME_TRAVEL_H
#define GUARD_WHOLE_GAME_TRAVEL_H
void FR_SetWhiteoutRespawnWarpAndHealerNpc(struct WarpData *warp);
void FR_FieldCB_RushInjuredPokemonToCenter(void);
u32 FR_ComputeWhiteOutMoneyLoss(void);
void WholeGame_TravelHealToKanto(void);
void WholeGame_TravelHealToHoenn(void);
#endif
''')
    write('src/whole_game_travel.c', runtime_source(donor, rows, base) + REGION_SWITCH)
    root = (out / 'data/event_scripts.s').read_text()
    write('data/event_scripts.s', '#include "constants/whole_game_fr_heal_locations.h"\n' + root)
    travel = 'data/scripts/whole_game_campaign.inc'
    patch(travel, 'WholeGame_EventScript_WarpToKanto::\n', 'WholeGame_EventScript_WarpToKanto::\n    callnative WholeGame_TravelHealToKanto\n')
    patch(travel, '    warp MAP_LITTLEROOT_TOWN, 9, 14', '    callnative WholeGame_TravelHealToHoenn\n    warp MAP_LITTLEROOT_TOWN, 9, 14')
    over = 'src/overworld.c'
    patch(over, '#include "global.h"', '#include "global.h"\n#include "whole_game_travel.h"\n#include "whole_game_state.h"\n#include "constants/whole_game_fr_state.h"')
    patch(over, 'void DoWhiteOut(void)\n{', '''extern const u8 FR_EventScript_ResetEliteFourEnd[];
void DoWhiteOut(void)
{
    if (WholeGame_IsKanto())
    {
        RunScriptImmediately(FR_EventScript_ResetEliteFourEnd);
        RemoveMoney(&gSaveBlock1Ptr->money, FR_ComputeWhiteOutMoneyLoss());
        HealPlayerParty();
        Overworld_ResetStateAfterWhiteOut();
        FR_SetWhiteoutRespawnWarpAndHealerNpc(&sWarpDestination);
        WarpIntoMap();
        return;
    }''')
    # Callback is chosen after WarpIntoMap has installed the actual destination.
    patch(over, '        gFieldCallback = FieldCB_WarpExitFadeFromBlack;\n        state = 0;', '        gFieldCallback = WholeGame_IsKanto() ? FR_FieldCB_RushInjuredPokemonToCenter : FieldCB_WarpExitFadeFromBlack;\n        state = 0;')
    # The exact donor map-entry directional delta and Viridian Forest exception.
    patch(over, 'void UpdateEscapeWarp(s16 x, s16 y)\n{\n    u8 currMapType = GetCurrentMapType();\n    u8 destMapType = GetMapTypeByGroupAndId(sWarpDestination.mapGroup, sWarpDestination.mapNum);', '''void UpdateEscapeWarp(s16 x, s16 y)
{
    u8 currMapType = GetCurrentMapType();
    u8 destMapType = GetMapTypeByGroupAndId(sWarpDestination.mapGroup, sWarpDestination.mapNum);
    if (WholeGame_IsKanto())
    {
        if (IsMapTypeOutdoors(currMapType) && !IsMapTypeOutdoors(destMapType)
            && !(gSaveBlock1Ptr->location.mapGroup == MAP_GROUP(MAP_FR_VIRIDIAN_FOREST)
              && gSaveBlock1Ptr->location.mapNum == MAP_NUM(MAP_FR_VIRIDIAN_FOREST)))
            SetEscapeWarp(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum,
                WARP_ID_NONE, x - MAP_OFFSET, y - MAP_OFFSET + (GetPlayerFacingDirection() != DIR_SOUTH));
        return;
    }''')
    reset = '''    if (WholeGame_IsKanto())
    {
        FlagClear(FR_FLAG_SYS_ON_CYCLING_ROAD);
        VarSet(FR_VAR_MAP_SCENE_ROUTE16, 0);
        FlagClear(FR_FLAG_SYS_CRUISE_MODE);
        FlagClear(FR_FLAG_SYS_SAFARI_MODE);
        VarSet(FR_VAR_MAP_SCENE_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE, 0);
        FlagClear(FR_FLAG_SYS_USE_STRENGTH);
        FlagClear(FR_FLAG_SYS_FLASH_ACTIVE);
        FlagClear(FR_FLAG_SYS_QL_DEPARTED);
        VarSet(FR_VAR_QL_ENTRANCE, 0);
        // The shared native field engine owns these transient active effects.
        FlagClear(FLAG_SYS_CYCLING_ROAD);
        FlagClear(FLAG_SYS_CRUISE_MODE);
        FlagClear(FLAG_SYS_SAFARI_MODE);
        FlagClear(FLAG_SYS_USE_STRENGTH);
        FlagClear(FLAG_SYS_USE_FLASH);
        ResetInitialPlayerAvatarState();
        return;
    }
'''
    for signature in ('void Overworld_ResetStateAfterFly(void)', 'void Overworld_ResetStateAfterTeleport(void)',
                      'void Overworld_ResetStateAfterDigEscRope(void)', 'static void Overworld_ResetStateAfterWhiteOut(void)'):
        patch(over, signature + '\n{\n', signature + '\n{\n' + reset)
    ledger = {'component': 'travel', 'status': 'partial', 'buildEligible': False, 'semantic_coverage_complete': False,
        'providers': [{'name': name, 'target': 'FR_' + name, 'status': 'source-ported',
                       'translationUnit': 'src/whole_game_travel.c'}
                      for name in ('SetCB2WhiteOut', 'OverworldWhiteOutGetMoneyLoss')],
        'changed_files': sorted(set(changed)), 'nativeHealCount': len(native), 'donorHealCount': len(rows),
        'healDestinations': rows,
        'coverage': ['all source donor heal/fly records appended to native table with distinct IDs',
            'original donor blackout interior/nurse/coordinates and badge/level money formula',
            'original shared party heal and donor Elite Four reset script',
            'native donor whiteout message/task then original mother/nurse heal script',
            'per-region durable original lastheal warps switched by native guides',
            'original donor directional escape entrance and Viridian Forest exception',
            'original donor flag/var reset on fly/teleport/dig/rope/blackout',
            'native dynamic/escape/continue warp records retain imported signed map groups'],
        'source_dependencies': {'FR_TrainerTowerSpokeToOwner': {'stage': 'world_services', 'translationUnit': 'src/firered_world_trainer_tower.c', 'status': 'source-implemented'},
            'FR_ForestMapPreviewScreenIsRunning': {'stage': 'region_map', 'translationUnit': 'src/firered_map_preview_screen.c', 'status': 'source-implemented'}},
        'unresolved': [
            'Combined native whiteout/map-preview/Quest Log callback completion requires cartridge qualification (source provider in region_map stage).',
            'Native Kanto/Sevii fly selection/UI source consumes appended FR_HEAL_LOCATION IDs through region_map stage; combined execution remains unqualified.',
            'All original whiteout script special/movement/UI services remain independently gated.',
            'Native cartridge tests for all heal points, donor/host blackout, fly, teleport, dig/rope, save/reload and return remain unrun.'],
        'source_pins': {str(p.relative_to(donor)): hashlib.sha256(p.read_bytes()).hexdigest() for p in
            [donor / relative for relative in ['src/data/heal_locations.json', 'src/heal_location.c',
                'src/overworld.c', 'src/field_screen_effect.c', 'src/pokemon.c', 'src/field_specials.c',
                'src/post_battle_event_funcs.c', 'src/strings.c', 'data/maps/map_groups.json', 'charmap.txt']]},
        'base_source_pins': {relative: hashlib.sha256((base / relative).read_bytes()).hexdigest() for relative in
            ['src/data/heal_locations.json', 'src/overworld.c', 'charmap.txt']}}
    if report_dir:
        Path(report_dir).mkdir(parents=True, exist_ok=True)
        (Path(report_dir) / 'travel-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n')
    return ledger
