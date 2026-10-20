"""Stage the complete FireRed map screen and preview lifecycle without fallbacks."""
from __future__ import annotations
import hashlib
import json
import re
import shutil
import time
from pathlib import Path
from .native_services import functions, masked
from .scripts import rewrite_tokens
from .world_assets import namespaced

TOKEN = re.compile(r'\b[A-Za-z_]\w*\b')


def _clean_string(value):
    # jsonproc loops over UTF-8 bytes; a non-ASCII character can yield two '_'.
    return ''.join(chr(c) if (65<=c<=90 or 97<=c<=122 or (48<=c<=57 and i!=0)) else '_'
                   for i,c in enumerate(value.encode('utf-8')))


def section_tables(donor):
    sections = json.loads((donor/'src/data/region_map/region_map_sections.json').read_text())['map_sections']
    definitions = ['enum {'] + [f'    FR_{s["id"]} = {i},' for i,s in enumerate(sections)]
    definitions += ['    FR_MAPSEC_NONE, FR_MAPSEC_COUNT', '};',
                    '#define FR_KANTO_MAPSEC_START FR_MAPSEC_PALLET_TOWN',
                    '#define FR_SEVII_MAPSEC_START FR_MAPSEC_ONE_ISLAND']
    seen, declarations, names, corners, dimensions = set(), [], [], [], []
    for section in sections:
        section_id = 'FR_' + section['id']
        if 'name' in section:
            label = 'FR_sMapsecName_' + _clean_string(section['name']) + ('_Clone' if 'name_clone' in section else '')
            if label not in seen:
                declarations.append(f'static const u8 {label}[] = _({json.dumps(section["name"], ensure_ascii=False)});')
                seen.add(label)
            names.append(f'    [{section_id} - FR_KANTO_MAPSEC_START] = {label},')
        if 'x' in section and 'y' in section:
            corners.append(f'    [{section_id} - FR_KANTO_MAPSEC_START] = {{{section["x"]}, {section["y"]}}},')
        if 'width' in section and 'height' in section:
            dimensions.append(f'    [{section_id} - FR_KANTO_MAPSEC_START] = {{{section["width"]}, {section["height"]}}},')
    tables = ('static const u8 *const FR_sMapNames[] = {\n'+'\n'.join(names)+'\n};\n' +
              'static const u16 FR_sMapSectionTopLeftCorners[FR_MAPSEC_COUNT][2] = {\n'+'\n'.join(corners)+'\n};\n' +
              'static const u16 FR_sMapSectionDimensions[FR_MAPSEC_COUNT][2] = {\n'+'\n'.join(dimensions)+'\n};\n')
    return sections, '\n'.join(definitions)+'\n', '\n'.join(declarations)+'\n', tables


def stage_region_map(base, donor, out, report_dir=None):
    started = time.perf_counter()
    base, donor, out = map(lambda p:Path(p).resolve(), (base, donor, out))
    if any(out == src or src in out.parents for src in (base,donor)):
        raise ValueError('region map output must be isolated from canonical source')
    changed, pins = [], {}
    def checked_target(rel):
        target = out/rel
        for source in (base,donor):
            if source in target.resolve().parents or (target.exists() and (source/rel).exists() and target.samefile(source/rel)):
                raise ValueError('output aliases canonical source')
        target.parent.mkdir(parents=True,exist_ok=True)
        return target
    def write(rel, content):
        target = checked_target(rel)
        target.write_text(content)
        changed.append(rel)
    def donor_read(rel):
        data = (donor/rel).read_text()
        pins[rel] = hashlib.sha256(data.encode()).hexdigest()
        return data
    donor_read('src/data/region_map/region_map_sections.json')
    donor_read('tools/jsonproc/jsonproc.cpp')
    for template in ('constants','entries','strings'):
        donor_read('src/data/region_map/region_map_sections.'+template+'.json.txt')
    sections, constants, strings, entries = section_tables(donor)
    write('include/constants/firered_region_map_sections.h', '#ifndef GUARD_FR_REGION_MAP_SECTIONS_H\n#define GUARD_FR_REGION_MAP_SECTIONS_H\n'+constants+'\n#endif\n')
    write('src/data/firered/region_map/region_map_entry_strings.h',strings)
    write('src/data/firered/region_map/region_map_entries.h',entries)
    source_paths = ('src/region_map.c','src/map_preview_screen.c')
    sources = {p:donor_read(p) for p in source_paths}
    mapping = {}
    for text in sources.values():
        mapping.update({f.name:'FR_'+f.name for f in functions(text,'')})
        mapping.update({n:'FR_'+n for n in re.findall(r'\b(?:s[A-Z]\w*|RegionMap\w*|SwitchMapMenu\w*|DungeonMap\w*|MapOpenCloseAnim|MapCursor|PlayerIcon|MapIcons?|MapEdge|FlyMap|GpuWindowParams)\b',masked(text))})
        mapping.update({n:'FR_'+n for n in re.findall(r'^#define ([A-Z_]\w*)',text,re.M)})
        for enum in re.findall(r'enum\s*(?:\w+)?\s*\{(.*?)\}',masked(text),re.S):
            mapping.update({n:'FR_'+n for n in re.findall(r'(?:^|,)\s*([A-Z_]\w*)',enum)})
    for section in sections: mapping[section['id']]='FR_'+section['id']
    mapping.update({n:'FR_'+n for n in ('MAPSEC_NONE','MAPSEC_COUNT','KANTO_MAPSEC_START','SEVII_MAPSEC_START','MapPreviewScreen','gExitStairsMovementDisabled','gQuestLogState')})
    for text in sources.values():
        mapping.update({n:namespaced(n) for n in set(TOKEN.findall(masked(text))) if n.startswith(('MAP_', 'HEAL_LOCATION_', 'FLAG_', 'VAR_', 'SE_', 'MUS_')) and n not in mapping})
    # UI enum constants and map types use source-specific definitions only where
    # defined by these providers. Shared map type values are ABI checked below.
    for name in list(mapping):
        if name.startswith('MAP_TYPE_') or name in ('MAP_GROUP','MAP_NUM'): mapping.pop(name)
    header = donor_read('include/region_map.h')
    mapping.update({n:'FR_'+n for n in re.findall(r'\bREGIONMAP_TYPE_\w*',header)})
    header = rewrite_tokens(header,mapping).replace('GUARD_REGION_MAP_H','GUARD_FIRERED_REGION_MAP_H')
    header = header.replace('#endif // GUARD_FIRERED_REGION_MAP_H', 'void FR_ShowTownMap(void);\nextern bool8 FR_gExitStairsMovementDisabled;\n#endif // GUARD_FIRERED_REGION_MAP_H')
    write('include/firered_region_map.h',header)
    preview_header = donor_read('include/map_preview_screen.h')
    mapping.update({n:'FR_'+n for n in re.findall(r'\bMPS_\w*',preview_header)})
    write('include/firered_map_preview_screen.h',rewrite_tokens(preview_header,mapping).replace('GUARD_MAP_PREVIEW_SCREEN_H','GUARD_FIRERED_MAP_PREVIEW_SCREEN_H'))
    text_source = donor_read('src/strings.c')
    text_names = sorted(set(re.findall(r'\bgText_RegionMap_\w+',sources['src/region_map.c'])))
    text_definitions=[]
    for name in text_names:
        match = re.search(r'const u8 '+name+r'\[\]\s*=\s*_\("(?:\\.|[^"\\])*"\);',text_source)
        if not match: raise ValueError('missing donor region map text '+name)
        mapping[name]='FR_'+name
        text_definitions.append(rewrite_tokens(match[0],mapping))
    write('src/data/firered/region_map/text.h','\n'.join(text_definitions)+'\n')
    # Keep donor text control bytes exactly. The host charmap calls F8 0C
    # DPAD_NONE, while FireRed calls the same byte sequence DPAD_ANY.
    charmap = (out/'charmap.txt').read_text() if (out/'charmap.txt').exists() else (base/'charmap.txt').read_text()
    donor_charmap = donor_read('charmap.txt')
    control_tags = set(re.findall(r'\{([A-Z][A-Z0-9_]*)\}', '\n'.join(text_definitions)))
    for tag in sorted(control_tags):
        if re.search(r'^'+re.escape(tag)+r'\s*=',charmap,re.M):
            continue
        row = re.search(r'^'+re.escape(tag)+r'\s*=.*$',donor_charmap,re.M)
        if not row:
            raise ValueError('unresolved source text control tag '+tag)
        charmap += '\n' + row[0] + '\n'
    write('charmap.txt',charmap)

    # Preview QL gate is the real donor global, never an assumed idle state.
    quest_constants = donor_read('include/constants/quest_log.h')
    # Full QuestLog owns its complete event/action/state constants, including
    # IS_LINK_QL_EVENT and the real namespaced playback global.
    if not (out/'include/constants/firered_quest_log.h').exists():
        ql_mapping = {n:'FR_'+n for n in re.findall(r'^#define\s+(\w+)',quest_constants,re.M)}
        ql_mapping['gQuestLogState'] = 'FR_gQuestLogState'
        write('include/constants/firered_quest_log.h',rewrite_tokens(quest_constants,ql_mapping))
    mapping.update({n:'FR_'+n for n in re.findall(r'\bQL_\w+',quest_constants)})
    mapping.update({'MAP':'FR_MAP_PAIR', 'JOY_REPT':'JOY_REPEAT'})
    external = {'SetUsedFlyQuestLogEvent','QuestLog_CutRecording'}
    mapping.update({n:'FR_'+n for n in external})
    # gflib is donor's aggregation of these existing native GPU/window APIs.
    common_includes = '#define FR_MAP_PAIR(map) MAP_GROUP(map), MAP_NUM(map)\n' + '\n'.join('#include "'+h+'"' for h in ('bg.h','palette.h','gpu_regs.h','dma3.h','malloc.h','sound.h','text.h','sprite.h','window.h','blit.h','string_util.h','main.h','menu.h','menu_helpers.h','decompress.h','constants/rgb.h','constants/map_types.h','constants/whole_game_fr_state.h','constants/whole_game_fr_heal_locations.h','constants/firered_region_map_sections.h'))
    function_counts={}
    all_calls=set()
    for rel,text in sources.items():
        text=text.replace('#include "gflib.h"',common_includes)
        text=text.replace('#include "new_menu_helpers.h"','#include "menu_helpers.h"')
        text=text.replace('#include "field_fadetransition.h"','#include "field_screen_effect.h"')
        text=text.replace('#include "region_map.h"','#include "firered_region_map.h"')
        text=text.replace('#include "map_preview_screen.h"','#include "firered_map_preview_screen.h"')
        text=text.replace('#include "constants/region_map_sections.h"','')
        text=text.replace('#include "constants/heal_locations.h"','')
        text=text.replace('#include "quest_log.h"','#include "constants/firered_quest_log.h"\nextern u8 FR_gQuestLogState;')
        text=rewrite_tokens(text,mapping)
        text=text.replace('"data/region_map/','"data/firered/region_map/')
        text=text.replace('"graphics/region_map/','"graphics/firered/region_map/').replace('"graphics/map_preview/','"graphics/firered/map_preview/')
        if rel=='src/region_map.c':
            text=text.replace('#include "data/firered/region_map/region_map_entry_strings.h"','#include "data/firered/region_map/region_map_entry_strings.h"\n#include "data/firered/region_map/text.h"\nEWRAM_DATA bool8 FR_gExitStairsMovementDisabled = FALSE;\nvoid FR_SetUsedFlyQuestLogEvent(const u8 *);')
        function_counts[rel]=len(functions(sources[rel],rel))
        all_calls.update(re.findall(r'\b([A-Za-z_]\w*)\s*\(',masked(text)))
        write('src/firered_'+Path(rel).name,text)
    # Exact donor ShowTownMap remains a real script-pausing provider. QL recording
    # cut is deliberately an external requirement, not a no-op callback.
    show = next(f for f in functions(donor_read('src/field_specials.c'),'src/field_specials.c') if f.name=='ShowTownMap')
    show_text = '#include "global.h"\n#include "overworld.h"\n#include "firered_region_map.h"\nvoid FR_QuestLog_CutRecording(void);\n'+rewrite_tokens(show.source,{**mapping,'ShowTownMap':'FR_ShowTownMap'})+'\n'
    write('src/firered_town_map.c',show_text)
    assets=[]
    for folder in ('graphics/region_map','graphics/map_preview'):
        for path in sorted((donor/folder).rglob('*')):
            if not path.is_file(): continue
            rel='graphics/firered/'+str(path.relative_to(donor/'graphics'))
            target=checked_target(rel);shutil.copyfile(path,target)
            assets.append({'path':rel,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            changed.append(rel)
    for path in sorted((donor/'src/data/region_map').glob('region_map_layout_*.h')):
        write('src/data/firered/region_map/'+path.name,rewrite_tokens(donor_read(str(path.relative_to(donor))),mapping))
    # Entry dispatch leaves the native Emerald screen body intact.
    for rel,signature,call in (
        ('src/region_map.c','void CB2_OpenFlyMap(void)','FR_CB2_OpenFlyMap();'),
        ('src/field_region_map.c','void FieldInitRegionMap(MainCallback callback)','FR_InitRegionMapWithExitCB(FR_REGIONMAP_TYPE_WALL, callback);')):
        text=(out/rel).read_text()
        anchor=signature+'\n{'
        if text.count(anchor)!=1: raise ValueError('unsupported region map dispatch '+rel)
        text=text.replace('#include "global.h"','#include "global.h"\n#include "whole_game_state.h"\n#include "firered_region_map.h"',1)
        text=text.replace(anchor,anchor+'\n    if (WholeGame_IsKanto())\n    {\n        '+call+'\n        return;\n    }',1)
        write(rel,text)
    unsupported=[{'id':'quest-log','reason':'Real FR_gQuestLogState, FR_QuestLog_CutRecording and FR_SetUsedFlyQuestLogEvent providers are required; none is replaced by idle/success.'},
                 {'id':'native-ui-abi','reason':'Complete donor screens staged; shared GPU/text/window/party return APIs and donor graphics conversions require diagnostic compile and native screen lifecycle qualification.'},
                 {'id':'mapsection-provenance','reason':'FR_GetMapName uses raw donor IDs; caught location callers must select provider by Pokemon originGame, not current player region.'}]
    report={'schema':'whole-game-fr-region-map-v1','status':'blocked','buildEligible':False,'semantic_coverage_complete':False,'coverage':{'sourceFunctions':function_counts,'regionLayers':4,'previewRecords':28,'texts':len(text_names),'assets':len(assets),'nativeFlyDispatch':True,'nativeWallDispatch':True,'showTownMapSource':show.key},'source_sha256':pins,'output_sha256':{rel:hashlib.sha256((out/rel).read_bytes()).hexdigest() for rel in sorted(set(changed))},'changedFiles':sorted(set(changed)),'assets':assets,'unsupported':unsupported,'externalServices':sorted(external),'stage_wall_seconds':time.perf_counter()-started,'canonicalSourcesMutated':False}
    if report_dir:
        target=Path(report_dir);target.mkdir(parents=True,exist_ok=True);(target/'region-map.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    return report
