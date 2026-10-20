"""Exact FireRed story puzzle, presentation and collector service closures."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import time

from .native_services import functions, masked
from .scripts import rewrite_tokens
from .fonts import _array

ROOTS = ('DoDeoxysTriangleInteraction', 'SetDeoxysTrianglePalette', 'DoPokemonLeagueLightingEffect', 'SpawnCameraObject', 'RemoveCameraObject', 'ShakeScreen', 'LoopWingFlapSound', 'UpdateLoreleiDollCollection', 'SampleResortGorgeousMonAndReward', 'StickerManGetBragFlags', 'UpdateTrainerCardPhotoIcons')


def stage_story_services(base, donor, out, report_dir=None):
    start = time.monotonic()
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == source or source in out.parents or out in source.parents for source in (base, donor)):
        raise ValueError('story services output must be outside immutable sources')
    source = (donor / 'src/field_specials.c').read_text()
    index = {f.name: f for f in functions(source, 'src/field_specials.c')}
    pending = list(ROOTS) + ['IncrementBirthIslandRockStepCount', 'StopPokemonLeagueLightingEffectTask']
    selected = {}
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        if name not in index:
            raise ValueError('missing exact story source ' + name)
        selected[name] = index[name]
        pending.extend((set(re.findall(r'\b\w+\b', masked(index[name].source))) & index.keys()) - selected.keys())
    extra = {}
    for filename, names in (('src/field_effect.c', ('ApplyGlobalFieldPaletteTint', 'FldEff_MoveDeoxysRock', 'Task_MoveDeoxysRock_Step')), ('src/fieldmap.c', ('ApplyGlobalTintToPaletteSlot',)), ('src/mail_data.c', ('SpeciesToMailSpecies',))):
        idx = {f.name: f for f in functions((donor / filename).read_text(), filename)}
        for name in names:
            extra[name] = idx[name]
    selected.update(extra)
    body = '\n\n'.join(selected[name].source for name in sorted(selected))
    array_names = sorted(set(re.findall(r'\bs[A-Z]\w+', masked(body))))
    arrays = '\n\n'.join(_array(source, name) for name in array_names)
    mapping = {name: 'FR_' + name for name in selected}
    # Supporting helpers are private to this closure to avoid colliding with
    # other imported field/effect service owners.
    for name in ('ApplyGlobalFieldPaletteTint', 'ApplyGlobalTintToPaletteSlot', 'SpeciesToMailSpecies'):
        mapping[name] = 'FR_Story_' + name
    mapping.update({name: 'FR_Story_' + name for name in array_names})
    tokens = set(re.findall(r'\b\w+\b', masked(body + arrays)))
    for token in tokens:
        if token.startswith(('FLAG_', 'VAR_', 'SE_', 'ITEM_', 'QL_TINT_')):
            mapping[token] = 'FR_' + token
    mapping.update({'GetPlayerAvatarObjectId': 'GetPlayerAvatarSpriteId', 'CameraObjectSetFollowedObjectId': 'CameraObjectSetFollowedSpriteId', 'GetGameStat': 'FR_GetGameStat', 'Random': 'FR_Random', 'gGlobalFieldTintMode': 'FR_gGlobalFieldTintMode', 'QuestLog_BackUpPalette': 'FR_QuestLog_BackUpPalette', 'NELEMS': 'ARRAY_COUNT', 'OBJ_EVENT_GFX_YOUNGSTER': 'OBJ_EVENT_GFX_FR_YOUNGSTER'})
    groups = json.loads((donor / 'data/maps/map_groups.json').read_text())
    base_group_count = len(json.loads((base / 'data/maps/map_groups.json').read_text())['group_order'])
    map_values = {}
    map_provenance = []
    for group_num, group in enumerate(groups['group_order']):
        for number, name in enumerate(groups[group]):
            data = json.loads((donor / f'data/maps/{name}/map.json').read_text())
            if data['id'] in tokens:
                target = 'FR_STORY_' + data['id']
                mapping[data['id']] = target
                map_values[target] = number | ((base_group_count + group_num) << 8)
                map_provenance.append({'id': data['id'], 'target': target, 'group': base_group_count + group_num, 'number': number})
    missing_maps = {name for name in tokens if name.startswith('MAP_') and name not in ('MAP_GROUP', 'MAP_NUM', 'MAP_OFFSET')} - mapping.keys()
    if missing_maps:
        raise ValueError('unknown story map identity: ' + repr(sorted(missing_maps)))
    rock = json.loads((donor / 'data/maps/BirthIsland_Exterior/map.json').read_text())
    local_id = next(i + 1 for i, event in enumerate(rock['object_events']) if event.get('local_id') == 'LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK')
    mapping['LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK'] = 'FR_STORY_LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK'
    custom_defines = ['#define FR_STORY_LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK ' + str(local_id)]
    custom_defines += ['#define ' + key + ' ' + str(value) for key, value in sorted(map_values.items())]
    for filename, family in (('include/constants/game_stat.h', 'GAME_STAT_'), ('src/mail_data.c', 'UNOWN_OFFSET')):
        text = (donor / filename).read_text() if (donor / filename).exists() else ''
        for token in sorted(tokens):
            if token.startswith(family):
                match = re.search(r'^#define ' + re.escape(token) + r'\s+([^\n/]+)', text, re.M)
                if match:
                    mapping[token] = 'FR_STORY_' + token
                    custom_defines.append('#define ' + mapping[token] + ' ' + match[1].strip())
    # Shake task macros occur outside the extracted function spans.
    macros = []
    for token in sorted(tokens):
        if token.startswith('t') and len(token) > 1 and token[1].isupper():
            match = re.search(r'^#define ' + re.escape(token) + r'\s+([^\n]+)', source, re.M)
            if match:
                macros.append('#define ' + token + ' ' + match[1])
    changed, assets = [], []
    def write(relative, text):
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        changed.append(relative)
    def read_target(relative):
        path = out / relative
        return (path if path.exists() else base / relative).read_text()
    references = sorted(set(re.findall(r'INCBIN_U16\("(graphics/field_specials/[^\"]+)"\)', arrays)))
    for path in references:
        original = Path(path).with_suffix('.pal')
        destination = 'graphics/firered/story_services/' + original.name
        target = out / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(donor / original, target)
        changed.append(destination)
        assets.append({'source': str(original), 'destination': destination, 'sha256': hashlib.sha256((donor / original).read_bytes()).hexdigest()})
        arrays = arrays.replace('INCBIN_U16("' + path + '")', 'INCGFX_U16("' + destination + '", ".gbapal")')
    preamble = ('global.h', 'palette.h', 'task.h', 'script.h', 'field_camera.h', 'field_effect.h', 'field_player_avatar.h', 'event_object_movement.h', 'event_data.h', 'fieldmap.h', 'overworld.h', 'pokemon.h', 'pokedex.h', 'pokemon_icon.h', 'data.h', 'string_util.h', 'mail.h', 'random.h', 'sound.h', 'whole_game_state.h', 'whole_game_fr_quest_log.h', 'firered_native_services.h', 'constants/whole_game_fr_state.h', 'constants/whole_game_fr_encounters.h', 'constants/fr_audio.h', 'constants/firered_event_objects.h', 'constants/field_effects.h', 'constants/items.h', 'constants/event_objects.h', 'constants/rgb.h', 'whole_game_story_services.h')
    prototypes = []
    for name in sorted(selected):
        declaration = selected[name].source.split('{', 1)[0].strip() + ';'
        prototypes.append(rewrite_tokens(declaration, mapping))
    unit = '\n'.join('#include "' + header + '"' for header in preamble) + '\n\n' + '\n'.join(custom_defines + macros) + '\n' + '\n'.join(prototypes) + '\n\n' + rewrite_tokens(arrays + '\n\n' + body, mapping) + '\n'
    # UNOWN_OFFSET belongs to the same shared species domain and is preserved
    # through the imported original conversion helper, not an icon substitute.
    write('src/firered_native/story_services.c', unit)
    public = [name for name in sorted(selected) if not selected[name].static and name not in ('ApplyGlobalFieldPaletteTint', 'ApplyGlobalTintToPaletteSlot', 'SpeciesToMailSpecies')]
    declarations = '\n'.join(rewrite_tokens(selected[name].source.split('{', 1)[0].strip() + ';', mapping) for name in public)
    write('include/whole_game_story_services.h', '#ifndef GUARD_WHOLE_GAME_STORY_SERVICES_H\n#define GUARD_WHOLE_GAME_STORY_SERVICES_H\n#include "global.h"\n' + declarations + '\n#endif\n')
    # Preserve the native field-effect ID domain (Emerald66 vs FireRed67) while
    # dispatching the original donor action/task for Kanto's story rock.
    effect = read_target('src/field_effect.c')
    anchor = 'bool8 FldEff_MoveDeoxysRock(struct Sprite *sprite)\n{\n    u8 objectEventId;'
    replacement = anchor + '\n    if (WholeGame_IsKanto())\n        return FR_FldEff_MoveDeoxysRock();'
    if 'return FR_FldEff_MoveDeoxysRock();' not in effect:
        if effect.count(anchor) != 1:
            raise ValueError('native Deoxys effect dispatcher anchor changed')
        effect = effect.replace(anchor, replacement)
        effect = '#include "whole_game_story_services.h"\n#include "whole_game_state.h"\n' + effect
    write('src/field_effect.c', effect)
    field = read_target('src/field_control_avatar.c')
    anchor = '        IncrementBirthIslandRockStepCount();'
    replacement = '''        if (WholeGame_IsKanto())
        {
            FR_IncrementBirthIslandRockStepCount();
            FR_IncrementResortGorgeousStepCounter();
        }
        else
            IncrementBirthIslandRockStepCount();'''
    if 'FR_IncrementBirthIslandRockStepCount();' not in field:
        if field.count(anchor) != 1:
            raise ValueError('native per-step story counter anchor changed')
        field = field.replace(anchor, replacement)
        field = '#include "whole_game_story_services.h"\n#include "whole_game_state.h"\n#include "firered_native_services.h"\n' + field
    write('src/field_control_avatar.c', field)
    providers = [{'name': name, 'target': mapping[name], 'status': 'source-ported', 'translationUnit': 'src/firered_native/story_services.c'} for name in ROOTS]
    ledger = {'schema': 'whole-game-story-services/v1', 'status': 'complete', 'buildEligible': True, 'unresolved': [], 'providers': providers, 'changedFiles': sorted(set(changed)), 'coverage': {'rootProviders': len(ROOTS), 'originalFunctions': len(selected), 'originalPaletteAssets': len(assets), 'sourceArrays': len(array_names)}, 'functionProvenance': [{'name': name, 'sourcePath': f.path, 'target': mapping[name], 'sha256': hashlib.sha256(f.source.encode()).hexdigest()} for name, f in sorted(selected.items())], 'assets': assets, 'mapBindings': map_provenance, 'nativeBindings': ['shared authoritative player party/species/dex/vars/flags/task/sprite/map APIs', 'source-native random and donor game-stat bank', 'native effect ID66 explicitly dispatches original donor effect ID67 action/task', 'per-step Kanto Deoxys/Resort counters; native Hoenn rock counter preserved'], 'sourceStageSeconds': time.monotonic() - start, 'qualification': {'agbcc': 'separate targeted compile required', 'runtime': 'not run', 'campaignComplete': False}}
    if report_dir is not None:
        report = Path(report_dir)
        report.mkdir(parents=True, exist_ok=True)
        (report / 'story-services-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n')
    return ledger
