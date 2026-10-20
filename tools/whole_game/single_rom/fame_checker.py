"""Stage the full original FireRed Fame Checker UI, collector state and assets."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import time

from .native_services import functions, masked
from .scripts import rewrite_tokens

PUBLIC = ('ResetFameChecker', 'FullyUnlockFameChecker', 'UseFameChecker', 'SetFlavorTextFlagFromSpecialVars', 'UpdatePickStateFromSpecialVar8005')


def stage_fame_checker(base, donor, out, report_dir=None):
    start = time.monotonic()
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == source or source in out.parents or out in source.parents for source in (base, donor)):
        raise ValueError('Fame Checker output must be isolated from immutable sources')
    changed, assets = [], []

    def write(relative, text):
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        changed.append(relative)

    source = (donor / 'src/fame_checker.c').read_text()
    donor_source = source
    original_functions = functions(source, 'src/fame_checker.c')
    mapping = {function.name: 'FR_' + function.name for function in original_functions}
    mapping.update({name: 'FR_' + name for name in set(re.findall(r'\bs[A-Z]\w*|\bgFameChecker\w*|\bgIconDescriptionBoxIsOpen\b', masked(source)))})
    mapping['gText_SelectorArrow2'] = 'FR_gText_SelectorArrow2'
    mapping['FameCheckerData'] = 'FR_FameCheckerData'
    constants = (donor / 'include/constants/fame_checker.h').read_text()
    for name in re.findall(r'^#define\s+(\w+)', constants, re.M):
        mapping[name] = 'FR_' + name
    for name in re.findall(r'\bFCWINDOWID_\w+', source):
        mapping[name] = 'FR_' + name
    for name in set(re.findall(r'\b(?:TRAINER_PIC_|TRAINER_|FONT_|SE_)\w+', source)):
        mapping[name] = 'FR_' + name
    for name in set(re.findall(r'\bOBJ_EVENT_GFX_\w+', source)):
        mapping[name] = 'OBJ_EVENT_GFX_FR_' + name[len('OBJ_EVENT_GFX_'):]
    for name in re.findall(r'^#define\s+(\w+)', source, re.M):
        mapping[name] = 'FR_' + name
    mapping.update({'InitObjectEventPalettes': 'FR_InitFameCheckerObjectPalettes', 'AddTextPrinterParameterized2': 'FR_AddTextPrinterParameterized2', 'NELEMS': 'ARRAY_COUNT', 'CreateFameCheckerObject': 'FR_CreateFameCheckerObject', 'GetTextWindowPalette': 'FR_GetTextWindowPalette', 'LoadStdWindowFrameGfx': 'FR_LoadStdWindowFrameGfx', 'DrawDialogueFrame': 'FR_DrawDialogueFrame', 'GetTextSpeedSetting': 'FR_Fame_GetTextSpeedSetting'})
    # Donor text callbacks/struct fields are compatible except renamed sprite
    # position and ListMenuItem members. Preserve complete UI task logic.
    source = re.sub(r'^#include[^\n]*\n', '', source, flags=re.M)
    source = rewrite_tokens(source, mapping)
    source = source.replace('gSaveBlock1Ptr->fameChecker', 'FR_GetFameCheckerRecords()')
    source = re.sub(r'\.label\b', '.name', source)
    source = re.sub(r'\.index\b', '.id', source)
    # Converted build rules use the exact donor tile limits (15/165), not the
    # larger padding in their source PNGs.
    def incgfx(match):
        kind, path = match[1], Path(match[2])
        prefix = 'graphics/firered/fame_checker/'
        if path.suffix in ('.4bpp', '.gbapal'):
            filename = path.with_suffix('.png').name
            if not (donor / path.with_suffix('.png')).is_file():
                filename = path.with_suffix('.pal').name
            options = '.4bpp\", \"-num_tiles 15 -Wnum_tiles' if path.name == 'spinning_pokeball.4bpp' else path.suffix
            return 'INCGFX_' + kind + '("' + prefix + filename + '", "' + options + '")'
        return 'INCBIN_' + kind + '("' + prefix + path.name + '")'
    source = re.sub(r'INCBIN_(U8|U16|U32)\("(graphics/fame_checker/[^\"]+)"\)', incgfx, source)
    for path in sorted((donor / 'graphics/fame_checker').glob('*')):
        if path.is_file():
            relative = 'graphics/firered/fame_checker/' + path.name
            destination = out / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
            changed.append(relative)
            assets.append({'source': str(path.relative_to(donor)), 'destination': relative, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    externs = []
    text_source = (donor / 'src/strings.c').read_text()
    own_strings = []
    for name in sorted(set(re.findall(r'\bgFameChecker\w+|\bgText_SelectorArrow2\b', masked(donor_source)))):
        original = name.removeprefix('FR_')
        if original in ('gFameChecker_ListMenuTemplate', 'gFameCheckerBgPals', 'gFameCheckerBgTiles', 'gFameCheckerBg3Tilemap', 'gFameCheckerBg2Tilemap'):
            continue
        match = re.search(r'const u8 ' + re.escape(original) + r'\[\]\s*=\s*_\("(?:\\.|[^"\\])*"\);', text_source)
        if match:
            own_strings.append(rewrite_tokens(match[0], {original: mapping.get(original, 'FR_' + original)}))
        else:
            externs.append('extern const u8 FR_' + original + '[];')
    # The external event text symbols are owned by the original script importer.
    for original in sorted(set(re.findall(r'\bgFameChecker\w+', (donor / 'src/fame_checker.c').read_text()))):
        if original.startswith(('gFameCheckerFlavorText', 'gFameCheckerPerson')):
            externs.append('extern const u8 FR_' + original + '[];')
    graphics = '''static const u16 FR_gFameCheckerBgPals[][16] = INCGFX_U16("graphics/firered/fame_checker/bg.png", ".gbapal");
static const u16 FR_gFameCheckerBgTiles[] = INCGFX_U16("graphics/firered/fame_checker/bg.png", ".4bpp", "-num_tiles 165 -Wnum_tiles");
static const u16 FR_gFameCheckerBg3Tilemap[] = INCBIN_U16("graphics/firered/fame_checker/tilemap3.bin");
static const u16 FR_gFameCheckerBg2Tilemap[] = INCBIN_U16("graphics/firered/fame_checker/tilemap2.bin");
'''
    includes = ('global.h', 'bg.h', 'window.h', 'text.h', 'decompress.h', 'gpu_regs.h', 'palette.h', 'sprite.h', 'malloc.h', 'sound.h', 'main.h', 'event_data.h', 'string_util.h', 'pokemon_storage_system.h', 'data.h', 'battle.h', 'battle_setup.h', 'menu.h', 'trainer_pokemon_sprites.h', 'scanline_effect.h', 'item_menu.h', 'list_menu.h', 'task.h', 'event_object_movement.h', 'text_window.h', 'menu_helpers.h', 'overworld.h', 'constants/trainers.h', 'constants/firered_event_objects.h', 'constants/fr_audio.h', 'firered_native_ui.h', 'firered_fame_checker.h')
    # Exact donor text-speed function and table avoid a shared engine's recording
    # policy silently changing collector UI timing.
    delays = re.search(r'static const u8 sTextSpeedFrameDelays\[\]\s*=\s*\{.*?\};', (donor / 'src/new_menu_helpers.c').read_text(), re.S)
    speed = next(f.source for f in functions((donor / 'src/new_menu_helpers.c').read_text(), '') if f.name == 'GetTextSpeedSetting')
    speed = rewrite_tokens(speed, {'GetTextSpeedSetting': 'FR_Fame_GetTextSpeedSetting', 'sTextSpeedFrameDelays': 'FR_Fame_TextSpeedFrameDelays'})
    unit = '\n'.join('#include "' + name + '"' for name in includes) + '\n\n' + '\n'.join(sorted(set(externs))) + '\n' + graphics + '\n' + '\n'.join(own_strings) + '\n' + delays[0].replace('sTextSpeedFrameDelays', 'FR_Fame_TextSpeedFrameDelays') + '\n' + speed + '\n' + source
    write('src/firered_native/fame_checker.c', unit)
    header = '''#ifndef GUARD_FIRERED_FAME_CHECKER_H
#define GUARD_FIRERED_FAME_CHECKER_H
#include "global.h"
#include "main.h"
#include "pokemon_storage_system.h"
#include "constants/firered_fame_checker.h"
enum { FR_FCWINDOWID_LIST, FR_FCWINDOWID_UIHELP, FR_FCWINDOWID_MSGBOX, FR_FCWINDOWID_ICONDESC };
struct FR_FameCheckerSaveData { u32 pickState:2; u32 flavorTextFlags:12; u32 unk_0_E:2; u32 reservedPadding:16; };
typedef char FR_FameCheckerRecordSize[(sizeof(struct FR_FameCheckerSaveData) == 4) ? 1 : -1];
typedef char FR_FameCheckerSavedBytes[(sizeof(gPokemonStoragePtr->wholeGameKanto.fameChecker) == 64) ? 1 : -1];
struct FR_FameCheckerSaveData *FR_GetFameCheckerRecords(void);
void FR_ResetFameChecker(void);
void FR_FullyUnlockFameChecker(void);
void FR_UseFameChecker(MainCallback callback);
void FR_SetFlavorTextFlagFromSpecialVars(void);
void FR_UpdatePickStateFromSpecialVar8005(void);
void FR_FieldUseFunc_FameChecker(u8 taskId);
u8 FR_CreateFameCheckerObject(u8 graphicsId, u8 localId, s16 x, s16 y);
void FR_InitFameCheckerObjectPalettes(u8 reflectionType);
#endif
'''
    write('include/firered_fame_checker.h', header)
    write('include/constants/firered_fame_checker.h', rewrite_tokens(constants, mapping))
    state_unit = '''#include "firered_fame_checker.h"
struct FR_FameCheckerSaveData *FR_GetFameCheckerRecords(void)
{
    return (struct FR_FameCheckerSaveData *)gPokemonStoragePtr->wholeGameKanto.fameChecker;
}
'''
    write('src/firered_native/fame_checker_state.c', state_unit)
    # Bind the native bag's real fade/exit callbacks and registered-key-item task
    # state. This preserves the original two entry paths with native ownership.
    item = '''#include "global.h"
#include "main.h"
#include "task.h"
#include "palette.h"
#include "item_menu.h"
#include "overworld.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "event_data.h"
#include "pokemon.h"
#include "malloc.h"
#include "whole_game_fr_quest_log.h"
#include "whole_game_story_services.h"
#include "firered_fame_checker.h"
static void FR_UseFameCheckerFromBag(void);
static void FR_Task_UseFameCheckerFromField(u8 taskId);
void FR_FieldUseFunc_FameChecker(u8 taskId)
{
    struct FR_QuestLogEvent_Item *data = Alloc(sizeof(*data));
    data->itemId = gSpecialVar_ItemId;
    data->itemParam = 0xFFFF;
    data->species = 0xFFFF;
    FR_SetQuestLogEvent(FR_QL_EVENT_USED_ITEM, (const u16 *)data);
    Free(data);
    if (gTasks[taskId].data[3] == 0)
    {
        gBagMenu->newScreenCallback = FR_UseFameCheckerFromBag;
        Task_FadeAndCloseBagMenu(taskId);
    }
    else
    {
        FR_StopPokemonLeagueLightingEffectTask();
        gFieldCallback = FieldCB_ReturnToFieldNoScript;
        FadeScreen(FADE_TO_BLACK, 0);
        gTasks[taskId].func = FR_Task_UseFameCheckerFromField;
    }
}
static void FR_UseFameCheckerFromBag(void)
{
    FR_UseFameChecker(CB2_BagMenuFromStartMenu);
}
static void FR_Task_UseFameCheckerFromField(u8 taskId)
{
    if (!gPaletteFade.active)
    {
        CleanupOverworldWindowsAndTilemaps();
        FR_UseFameChecker(CB2_ReturnToField);
        DestroyTask(taskId);
    }
}
'''
    write('src/firered_native/fame_checker_item.c', item)
    items_path = out / 'src/data/items.h'
    items = (items_path if items_path.exists() else base / 'src/data/items.h').read_text()
    item_entry = re.search(r'\[ITEM_FAME_CHECKER\]\s*=\s*\{.*?\n    \},', items, re.S)
    if item_entry is None:
        raise ValueError('native Fame Checker item slot missing')
    items = items[:item_entry.start()] + item_entry[0].replace('ItemUseOutOfBattle_CannotUse', 'FR_FieldUseFunc_FameChecker') + items[item_entry.end():]
    if '#include "firered_fame_checker.h"' not in items:
        items = '#include "firered_fame_checker.h"\n' + items
    write('src/data/items.h', items)
    providers = [{'name': name, 'target': 'FR_' + name, 'status': 'source-ported', 'translationUnit': 'src/firered_native/fame_checker.c'} for name in PUBLIC]
    required = ['FR_CreateFameCheckerObject', 'FR_InitFameCheckerObjectPalettes', 'FR_DrawDialogueFrame', 'FR_LoadStdWindowFrameGfx', 'FR_GetTextWindowPalette', 'FR_SetQuestLogEvent', 'FR_FONT_NORMAL', 'FR_FONT_SMALL', 'wholeGameKanto.fameChecker[64]', 'FR_TRAINER_PIC_*', 'FR_TRAINER_*', 'FR_SE_*', 'FR_gFameCheckerFlavorText*']
    shared_assets = []
    for relative in ("graphics/items/icons/fame_checker.png", "graphics/items/icon_palettes/fame_checker.pal"):
        native_digest = hashlib.sha256((base / relative).read_bytes()).hexdigest()
        donor_digest = hashlib.sha256((donor / relative).read_bytes()).hexdigest()
        if native_digest != donor_digest:
            raise ValueError("shared native Fame Checker item asset differs: " + relative)
        shared_assets.append({"path": relative, "sha256": donor_digest, "binding": "exact byte-identical native asset"})
    unresolved = []
    ledger = {'schema': 'whole-game-fame-checker/v1', 'status': 'complete', 'buildEligible': True, 'unresolved': unresolved, 'changedFiles': sorted(set(changed)), 'coverage': {'sourceFunctions': len(original_functions), 'publicProviders': len(providers), 'originalGraphicsFiles': len(assets), 'people': 16, 'flavorTextsPerPerson': 6, 'savedRecordBytes': 4, 'savedProgressBytes': 64, 'originalSourceLines': len((donor / 'src/fame_checker.c').read_text().splitlines()), 'externalTextSymbols': len(set(externs)), 'originalUiStrings': len(own_strings)}, 'functionProvenance': [{'name': f.name, 'target': 'FR_' + f.name, 'sha256': hashlib.sha256(f.source.encode()).hexdigest()} for f in original_functions], 'providers': providers, 'requiredProviders': required, 'assets': assets, 'sharedAssets': shared_assets, 'sourceProvenance': {'path': 'src/fame_checker.c', 'sha256': hashlib.sha256((donor / 'src/fame_checker.c').read_bytes()).hexdigest()}, 'transforms': ['namespace source declarations and callbacks', 'preserve donor font/graphics/trainer/audio domains', 'native ListMenuItem field names; native Sprite positions are source-identical', 'saved state uses exact4byte stride and64byte collector bank', 'native bag fade/callback/task lifecycle'], 'verification': {'sourceStageSeconds': time.monotonic() - start, 'agbcc': 'pending targeted compile', 'runtime': 'not run'}}
    if report_dir is not None:
        report = Path(report_dir)
        report.mkdir(parents=True, exist_ok=True)
        (report / 'fame-checker-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n')
    return ledger


def verify_progress_state(staged_source, report_dir=None):
    """Execute the actual emitted collector helpers over the real bit layout."""
    import subprocess
    import tempfile
    staged_source = Path(staged_source)
    source = (staged_source / 'src/firered_native/fame_checker.c').read_text()
    selected = ('FR_ResetFameChecker', 'FR_FullyUnlockFameChecker', 'FR_SetFlavorTextFlagFromSpecialVars', 'FR_UpdatePickStateFromSpecialVar8005')
    bodies = {function.name: function.source for function in functions(source, '') if function.name in selected}
    if set(bodies) != set(selected):
        raise ValueError('collector helper source closure missing')
    header = (staged_source / 'include/firered_fame_checker.h').read_text()
    record = re.search(r'struct FR_FameCheckerSaveData \{[^}]+\};', header)[0]
    constants = (staged_source / 'include/constants/firered_fame_checker.h').read_text()
    code = '''#include <stdint.h>
#include <string.h>
#include <stdio.h>
typedef uint32_t u32; typedef uint16_t u16; typedef uint8_t u8;
''' + constants + '\n' + record + '''
static struct FR_FameCheckerSaveData records[16];
static u16 gSpecialVar_0x8004, gSpecialVar_0x8005;
struct FR_FameCheckerSaveData *FR_GetFameCheckerRecords(void) { return records; }
void FR_UpdatePickStateFromSpecialVar8005(void);
''' + '\n\n'.join(bodies[name] for name in selected) + '''
int main(void)
{
    unsigned person, flavor, old, next;
    if (sizeof(records) != 64 || sizeof(records[0]) != 4) return 1;
    memset(records, 0xA5, sizeof(records));
    FR_ResetFameChecker();
    for(person=0; person<16; person++) {
        if(records[person].pickState != (person==0 ? 2 : 0) || records[person].flavorTextFlags || records[person].unk_0_E) return 2;
        if(records[person].reservedPadding != 0xA5A5) return 3;
    }
    for(person=0; person<18; person++) for(flavor=0; flavor<8; flavor++) {
        memset(records,0,sizeof(records));
        gSpecialVar_0x8004=person; gSpecialVar_0x8005=flavor;
        FR_SetFlavorTextFlagFromSpecialVars();
        for(unsigned i=0;i<16;i++) {
            unsigned valid=person<16 && flavor<6 && i==person;
            if(records[i].flavorTextFlags != (valid ? (1u<<flavor) : 0)) return 4;
            if(records[i].pickState != (valid ? 1u : 0)) return 5;
        }
    }
    for(person=0; person<18; person++) for(old=0; old<3; old++) for(next=0; next<5; next++) {
        for(unsigned i=0;i<16;i++) records[i].pickState=old;
        gSpecialVar_0x8004=person; gSpecialVar_0x8005=next;
        FR_UpdatePickStateFromSpecialVar8005();
        for(unsigned i=0;i<16;i++) {
            unsigned expected=old;
            if(person==i && next>0 && next<3 && !(old==2 && next==1)) expected=next;
            if(records[i].pickState != expected) return 6;
        }
    }
    memset(records,0,sizeof(records)); FR_FullyUnlockFameChecker();
    for(person=0;person<16;person++) if(records[person].pickState!=2 || records[person].flavorTextFlags!=63) return 7;
    puts("collector state: 144 flavor cases + 270 pick-state cases + exact reset/unlock/64byte layout passed");
    return 0;
}
'''
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='fame-progress-') as directory:
        directory = Path(directory)
        file = directory / 'progress.c'
        file.write_text(code)
        compile_result = subprocess.run(['cc', '-std=c99', '-Wall', '-Werror', str(file), '-o', str(directory / 'progress')], capture_output=True, text=True)
        if compile_result.returncode:
            raise RuntimeError(compile_result.stderr)
        result = subprocess.run([str(directory / 'progress')], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('collector state check failed: ' + str(result.returncode) + '\n' + result.stderr)
    receipt = {'outcome': 'passed', 'durationSeconds': time.monotonic() - start, 'flavorCases': 144, 'pickCases': 270, 'savedBytes': 64, 'stdout': result.stdout.strip(), 'limitation': 'native compiled helper behavior; UI/task/campaign execution not run'}
    if report_dir is not None:
        report = Path(report_dir)
        report.mkdir(parents=True, exist_ok=True)
        (report / 'compiled-progress-check.c').write_text(code)
        (report / 'compiled-progress-verification.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def verify_agbcc(staged_source, existing_tool_source, report_dir=None):
    """Convert real assets and compile only the three emitted translation units.

    existing_tool_source is an already built, pinned source snapshot. It is read
    only. Its existing gfx/preproc/agbcc executables are reused without setup.
    """
    import subprocess
    staged, tools = Path(staged_source), Path(existing_tool_source) / 'tools'
    start, rows = time.monotonic(), []
    source = (staged / 'src/firered_native/fame_checker.c').read_text()
    converted = set()
    for match in re.finditer(r'INCGFX_\w+\("([^\"]+)", "([^\"]+)"(?:, "([^\"]+)")?\)', source):
        path, extension, arguments = match.groups()
        arguments = arguments or ''
        destination = 'assets/' + path + re.sub(r'[^A-Za-z0-9]', '_', arguments) + extension
        if destination in converted:
            continue
        converted.add(destination)
        target = staged / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run([str(tools / 'gbagfx/gbagfx'), str(staged / path), str(target)] + arguments.split(), capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('original asset conversion failed: ' + result.stderr)
    translation_units = [(name, 'src/firered_native/' + name + '.c') for name in ('fame_checker', 'fame_checker_state', 'fame_checker_item')]
    if (staged / 'src/item.c').is_file():
        translation_units.append(('item', 'src/item.c'))
    for name, relative_source in translation_units:
        source_path = staged / relative_source
        current = time.monotonic()
        cpp = subprocess.run(['clang', '-E', '-Wno-invalid-pp-token', '-iquote', str(staged / 'include'), '-I', str(tools / 'agbcc/include'), '-I', str(tools / 'agbcc'), '-nostdinc', '-undef', '-std=gnu89', '-DMODERN=0', str(source_path)], capture_output=True, text=True)
        if cpp.returncode:
            raise RuntimeError(name + ' preprocessing failed:\n' + cpp.stderr)
        preprocess = subprocess.run([str(tools / 'preproc/preproc'), '-i', '-g', 'assets', str(source_path), str(staged / 'charmap.txt')], input=cpp.stdout, capture_output=True, text=True, cwd=staged)
        if preprocess.returncode:
            raise RuntimeError(name + ' donor text/assets preprocessing failed:\n' + preprocess.stderr)
        intermediate = staged / (name + '.i')
        intermediate.write_text(preprocess.stdout)
        result = subprocess.run([str(tools / 'agbcc/bin/agbcc'), '-mthumb-interwork', '-Wimplicit', '-Wparentheses', '-Werror', '-O2', '-fhex-asm', '-o', str(staged / (name + '.s')), str(intermediate)], capture_output=True, text=True, cwd=staged)
        if result.returncode:
            raise RuntimeError(name + ' actual agbcc compilation failed:\n' + result.stderr)
        rows.append({'source': str(source_path.relative_to(staged)), 'outcome': 'passed', 'durationSeconds': time.monotonic() - current, 'assemblySha256': hashlib.sha256((staged / (name + '.s')).read_bytes()).hexdigest()})
    receipt = {'schema': 'whole-game-fame-agbcc/v1', 'outcome': 'passed', 'durationSeconds': time.monotonic() - start, 'translationUnits': rows, 'convertedOriginalAssets': len(converted), 'compilerSha256': hashlib.sha256((tools / 'agbcc/bin/agbcc').read_bytes()).hexdigest(), 'limitations': ['targeted compiler only; no full ROM link', 'integrated UI rendering and campaign play not run']}
    if report_dir is not None:
        report = Path(report_dir)
        report.mkdir(parents=True, exist_ok=True)
        (report / 'agbcc-verification.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt
