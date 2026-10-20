"""Actual FireRed credits, scene assets and overworld-scroll lifecycle.

Emerald's Hall of Fame presentation/history remains shared. Its Kanto exit
executes the original Indigo Plateau map script before entering these credits.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import time

from .native_services import functions, masked
from .scripts import rewrite_tokens
from .opcodes import _unpatch

TARGET = 'src/whole_game_fr_credits.c'
HEADER = 'include/whole_game_credits.h'
ASSET_PREFIX = 'graphics/firered_credits/'
OVERWORLD_FUNCTIONS = ('Overworld_CreditsMainCB', 'FieldCB2_Credits_WaitFade',
    'Overworld_DoScrollSceneForCredits', 'SetUpScrollSceneForCredits', 'MapLdr_Credits',
    'CameraCB_CreditsPan', 'Task_OvwldCredits_FadeOut', 'Task_OvwldCredits_WaitFade',
    'InitOverworldBgs_NoResetHeap')
PIC_FUNCTIONS = ('LoadMonPicInWindow', 'CreateTrainerCardSprite', 'DecompressPic_HandleDeoxys',
                 'DecompressPic', 'LoadPicPaletteBySlot')
MONS = ('Charizard', 'Venusaur', 'Blastoise', 'Pikachu')


def _sha(data):
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def _definition(text, name):
    match = re.search(r'(?m)^(?:ALIGNED\(4\) )?(?:static )?const [^;\n]*\b' + re.escape(name) + r'\s*\[[^;]*?=', text)
    if not match:
        raise ValueError('missing exact credits data: ' + name)
    return text[match.start():text.index(';', match.end()) + 1]


def stage_credits(emerald_source: Path, firered_source: Path, output_tree: Path,
                  report_dir: Path | None = None) -> dict:
    started = time.monotonic()
    base, donor, out = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    if any(out == p or out.is_relative_to(p) for p in (base, donor)) or out.name in ('pokeemerald', 'pokefirered'):
        raise ValueError('credits staging requires an isolated output tree')
    changes, provenance = {}, []
    def read(name):
        path = out / name
        return changes.get(name, path.read_text() if path.exists() else (base / name).read_text())
    def write(name, value):
        changes[name] = value
    def append(name, value):
        begin, end = '// BEGIN WHOLE_GAME_FR_CREDITS\n', '// END WHOLE_GAME_FR_CREDITS\n'
        write(name, _unpatch(read(name), begin, end) + begin + value + '\n' + end)
    def patch(name, old, new):
        text = read(name)
        if new in text:
            return
        if text.count(old) != 1:
            raise ValueError(f'{name}: expected unique credits patch anchor {old[:100]!r}')
        write(name, text.replace(old, new, 1))
    def get_functions(relative):
        source = (donor / relative).read_text()
        return {f.name: f for f in functions(source, relative)}
    source = (donor / 'src/credits.c').read_text()
    names = {f.name: 'FR_Credits_' + f.name for f in functions(source, 'src/credits.c')}
    names['DoCredits'] = 'FR_DoCredits'
    names.update({name: 'FR_Credits_' + name for name in OVERWORLD_FUNCTIONS})
    names.update({name: 'FR_Credits_' + name for name in PIC_FUNCTIONS})
    names.update({name: 'FR_Credits_' + name for name in (
        'CameraUpdateNoObjectRefresh', 'FadeSelectedPals', 'GetMonSpritePalFromSpeciesAndPersonality')})
    names['SetWarpsToRollCredits'] = 'FR_SetWarpsToRollCredits'
    names.update({'gGlobalFieldTintMode': 'FR_gGlobalFieldTintMode',
                  'gDisableMapMusicChangeOnMapLoad': 'FR_gDisableMapMusicChangeOnMapLoad',
                  'Menu_LoadStdPalAt': 'FR_Menu_LoadStdPalAt',
                  'FONT_NORMAL': 'FR_FONT_NORMAL', 'FONT_NORMAL_COPY_1': 'FR_FONT_NORMAL_COPY_1',
                  'QL_TINT_NONE': 'FR_CREDITS_TINT_NONE',
                  'MUSIC_DISABLE_OFF': 'FR_CREDITS_MUSIC_DISABLE_OFF',
                  'MUSIC_DISABLE_STOP': 'FR_CREDITS_MUSIC_DISABLE_STOP',
                  'MUSIC_DISABLE_KEEP': 'FR_CREDITS_MUSIC_DISABLE_KEEP',
                  'tilemap_move_something': 'AddCameraTileOffset', 'coords8_add': 'AddCameraPixelOffset',
                  'move_tilemap_camera_to_upper_left_corner': 'ResetFieldCamera',
                  'gBGTilemapBuffers2': 'gOverworldTilemapBuffer_Bg1',
                  'gBGTilemapBuffers1': 'gOverworldTilemapBuffer_Bg2',
                  'gBGTilemapBuffers3': 'gOverworldTilemapBuffer_Bg3',
                  'sCreditsOverworld_Script': 'sFR_CreditsOverworld_Script',
                  'sCreditsOverworld_CmdLength': 'sFR_CreditsOverworld_CmdLength',
                  'sCreditsOverworld_CmdIndex': 'sFR_CreditsOverworld_CmdIndex',
                  'fadeInActive': 'fadeInFirstFrame', 'fadeInCounter': 'fadeInTimer'})
    for token in re.findall(r'\b(?:MAP_[A-Z0-9_]+|FLAG_[A-Z0-9_]+|VAR_[A-Z0-9_]+)\b', source):
        if token.startswith('MAP_') and token not in ('MAP_GROUP', 'MAP_NUM'):
            names[token] = 'MAP_FR_' + token[4:]
        elif token.startswith(('FLAG_', 'VAR_')):
            names[token] = 'FR_' + token
    hof_function = get_functions('src/hall_of_fame.c')['SetWarpsToRollCredits']
    for token in re.findall(r'\b(?:MAP_|FLAG_|VAR_)[A-Z0-9_]+\b', hof_function.source):
        if token.startswith('MAP_') and token not in ('MAP_GROUP', 'MAP_NUM'):
            names[token] = 'MAP_FR_' + token[4:]
        elif token.startswith(('FLAG_', 'VAR_')):
            names[token] = 'FR_' + token
    # Original credits strings are preserved, including staff ordering and text
    # controls. The build's normal character-map preprocessor encodes them.
    text_symbols = sorted(set(re.findall(r'\bgCreditsString_\w+\b', source)) | {'gString_PokemonFireRed_Staff', 'gString_Dummy'})
    strings = (donor / 'src/strings.c').read_text()
    text_data = []
    for name in text_symbols:
        body = _definition(strings, name)
        names[name] = 'FR_' + name
        text_data.append(body)
        provenance.append({'source': 'src/strings.c:' + name, 'sha256': _sha(body)})
    graphics = (donor / 'src/graphics.c').read_text()
    graphic_names = sorted(set(re.findall(r'\bgCredits(?:Copyright|MonPokeball)_\w+\b', source)))
    graphic_data = []
    for name in graphic_names:
        body = _definition(graphics, name)
        names[name] = 'FR_' + name
        graphic_data.append(body)
        provenance.append({'source': 'src/graphics.c:' + name, 'sha256': _sha(body)})
    # Preserve the actual four species' original front art and palettes rather
    # than silently using Emerald's different sprite artwork in the composites.
    pokemon_graphics = (donor / 'src/data/graphics/pokemon.h').read_text()
    mon_data, mon_tables = [], []
    for mon in MONS:
        for prefix in ('gMonFrontPic_', 'gMonPalette_', 'gMonShinyPalette_'):
            name = prefix + mon
            names[name] = 'FR_Credits_' + name
            body = _definition(pokemon_graphics, name)
            mon_data.append(body)
            provenance.append({'source': 'src/data/graphics/pokemon.h:' + name, 'sha256': _sha(body)})
    for original, ctype, field in (
        ('gMonFrontPicTable', 'CompressedSpriteSheet', 'gMonFrontPic_'),
        ('gMonPaletteTable', 'CompressedSpritePalette', 'gMonPalette_'),
        ('gMonShinyPaletteTable', 'CompressedSpritePalette', 'gMonShinyPalette_')):
        names[original] = 'sFR_Credits_' + original
        entries = []
        for mon in MONS:
            values = names[field + mon] + (', 0x800, SPECIES_' if ctype == 'CompressedSpriteSheet' else ', SPECIES_') + mon.upper()
            entries.append('    [SPECIES_' + mon.upper() + '] = {' + values + '},')
        mon_tables.append('static const struct ' + ctype + ' ' + names[original] + '[SPECIES_EGG + 1] = {\n' + '\n'.join(entries) + '\n};')
    # The private picture pipeline is the actual donor source; its reachable
    # domain is exactly the four source-script species, front side, OT=8/PID=0.
    pic_index = get_functions('src/trainer_pokemon_sprites.c')
    pic_helpers = [pic_index[name].source for name in PIC_FUNCTIONS]
    pic_helpers.append(get_functions('src/pokemon.c')['GetMonSpritePalFromSpeciesAndPersonality'].source)
    headers = '''#include "global.h"
#include "bg.h"
#include "palette.h"
#include "data.h"
#include "gpu_regs.h"
#include "dma3.h"
#include "malloc.h"
#include "sound.h"
#include "text.h"
#include "sprite.h"
#include "window.h"
#include "blit.h"
#include "string_util.h"
#include "main.h"
#include "task.h"
#include "overworld.h"
#include "event_data.h"
#include "decompress.h"
#include "graphics.h"
#include "strings.h"
#include "trainer_pokemon_sprites.h"
#include "menu.h"
#include "field_weather.h"
#include "pokemon.h"
#include "constants/maps.h"
#include "constants/field_weather.h"
#include "constants/sound.h"
#include "constants/rgb.h"
#include "whole_game_credits.h"
'''
    adapted = re.sub(r'^#include[^\n]*\n', '', source, flags=re.M)
    adapted = re.sub(r'#if defined\(FIRERED\)[\s\S]*?#endif', '#define TITLE_TEXT gString_PokemonFireRed_Staff', adapted, count=1)
    adapted = adapted.replace('EWRAM_DATA bool8 gHasHallOfFameRecords = FALSE;', '// Hall of Fame history and its records-present flag are shared with Emerald.')
    # Global animation constants in this file also receive unique symbols.
    for name in re.findall(r'(?m)^const [^\n=]+\b(sAnim\w+)\s*\[', adapted):
        names[name] = 'FR_Credits_' + name
    pic_prototypes = '\n'.join(rewrite_tokens(body[:body.index('{')].strip().replace('static ', '') + ';', names) for body in pic_helpers)
    all_data = '\n'.join(text_data + graphic_data + mon_data)
    all_data = rewrite_tokens(all_data, names)
    # Asset paths are source data, so token rewriting intentionally does not
    # touch them; explicitly redirect only the imported graphics directories.
    def asset_paths(value):
        value = value.replace('graphics/credits/', ASSET_PREFIX)
        for mon in MONS:
            value = value.replace('graphics/pokemon/' + mon.lower() + '/', ASSET_PREFIX + 'pokemon/' + mon.lower() + '/')
        return value
    write(TARGET, headers + '\n' + asset_paths(all_data) + '\n' + '\n'.join(mon_tables) + '\n' + pic_prototypes + '\n' + asset_paths(rewrite_tokens(adapted, names)) + '\n' + '\n\n'.join(rewrite_tokens(body, names).replace('static ', '', 1) if body.startswith('static ') else rewrite_tokens(body, names) for body in pic_helpers))
    credits_header = (donor / 'include/credits.h').read_text().replace('GUARD_CREDITS_H', 'GUARD_WHOLE_GAME_CREDITS_H')
    credits_header = credits_header.replace('extern bool8 gHasHallOfFameRecords;', '''#include "whole_game_state.h"
#include "field_screen_effect.h"
#include "constants/rgb.h"
#include "constants/whole_game_fr_state.h"
#include "whole_game_fr_quest_log.h"
extern bool8 gHasHallOfFameRecords;
struct CreditsOverworldCmd { s16 unk_0; s16 unk_2; s16 unk_4; };
#define FR_CREDITS_MUSIC_DISABLE_OFF 0
#define FR_CREDITS_MUSIC_DISABLE_STOP 1
#define FR_CREDITS_MUSIC_DISABLE_KEEP 2
#define FR_CREDITS_TINT_NONE 0
void FR_DoCredits(void);
void FR_SetWarpsToRollCredits(void);
void FR_Menu_LoadStdPalAt(u16 offset);
void FR_Credits_Overworld_CreditsMainCB(void);
bool32 FR_Credits_Overworld_DoScrollSceneForCredits(u8 *state, const struct CreditsOverworldCmd *script, u8 tintMode);
void FR_Credits_FadeSelectedPals(u8 mode, s8 delay, u32 selectedPalettes);
void FR_Credits_CameraUpdateNoObjectRefresh(void);''')
    write(HEADER, credits_header)
    # Keep the original map-load and camera state machines adjacent to their
    # shared engine's private variables/helpers, without exposing new globals.
    overworld = get_functions('src/overworld.c')
    bodies = [rewrite_tokens(overworld[name].source, names) for name in OVERWORLD_FUNCTIONS]
    declarations = '\n'.join(body[:body.index('{')].strip() + ';' for body in bodies)
    state = '''static EWRAM_DATA const struct CreditsOverworldCmd *sFR_CreditsOverworld_Script = NULL;
static EWRAM_DATA s16 sFR_CreditsOverworld_CmdLength = 0;
static EWRAM_DATA s16 sFR_CreditsOverworld_CmdIndex = 0;
'''
    append('src/overworld.c', state + '\n' + declarations + '\n\n' + '\n\n'.join(bodies))
    camera = get_functions('src/field_camera.c')['CameraUpdateNoObjectRefresh']
    append('src/field_camera.c', rewrite_tokens(camera.source, names))
    weather = get_functions('src/field_weather.c')['FadeSelectedPals']
    append('src/field_weather.c', rewrite_tokens(weather.source, names))
    # The original transition drives the imported Indigo map script, whose
    # source timings and MUS_CREDITS command lead to FR_DoCredits naturally.
    transition = rewrite_tokens(hof_function.source, names).replace('static void', 'void', 1)
    append('src/hall_of_fame.c', transition)
    for file in ('src/overworld.c', 'src/field_camera.c', 'src/field_weather.c', 'src/hall_of_fame.c'):
        text = read(file)
        include = '#include "whole_game_credits.h"\n'
        if include not in text:
            write(file, text.replace('#include "global.h"\n', '#include "global.h"\n' + include, 1))
    patch('src/hall_of_fame.c', 'static void StartCredits(void)\n{\n    SetMainCallback2(CB2_StartCreditsSequence);\n}', '''static void StartCredits(void)
{
    if (WholeGame_IsKanto())
        FR_SetWarpsToRollCredits();
    else
        SetMainCallback2(CB2_StartCreditsSequence);
}''')
    # Match the donor's KEEP/STOP semantics for map music and ambient cries;
    # OFF leaves the original Emerald path unchanged in either region.
    guard = '''    if (FR_gDisableMapMusicChangeOnMapLoad == FR_CREDITS_MUSIC_DISABLE_STOP)
    {
        StopMapMusic();
        return;
    }
    if (FR_gDisableMapMusicChangeOnMapLoad == FR_CREDITS_MUSIC_DISABLE_KEEP)
        return;

'''
    patch('src/overworld.c', '    if (music != MUS_ABNORMAL_WEATHER && music != MUS_NONE)', guard + '    if (music != MUS_ABNORMAL_WEATHER && music != MUS_NONE)')
    text = read('src/overworld.c')
    function = next(f for f in functions(text, 'src/overworld.c') if f.name == 'TransitionMapMusic')
    if guard not in function.source:
        value = function.source.replace('{\n', '{\n' + guard, 1)
        write('src/overworld.c', text[:function.start] + value + text[function.end:])
    patch('src/overworld.c', '    PlayCry_NormalNoDucking(sAmbientCrySpecies, pan, volume, CRY_PRIORITY_AMBIENT);', guard + '    PlayCry_NormalNoDucking(sAmbientCrySpecies, pan, volume, CRY_PRIORITY_AMBIENT);')
    # Copy editable original asset sources. Standard native graphics rules
    # retain PNG/palette/tilemap conversion rather than embedding a screenshot.
    assets = []
    originals = list((donor / 'graphics/credits').rglob('*'))
    for mon in MONS:
        originals += [donor / 'graphics/pokemon' / mon.lower() / file for file in ('front.png', 'normal.pal', 'shiny.pal')]
    for path in sorted(set(originals)):
        if not path.is_file():
            continue
        relative = path.relative_to(donor).as_posix()
        target = asset_paths(relative)
        data = path.read_bytes()
        assets.append({'source': relative, 'target': target, 'sha256': _sha(data), 'bytes': len(data)})
    # Discover dependencies from source definitions, never treating declarations
    # or a successful process exit as implemented providers.
    available = set()
    for path in (out / 'src').rglob('*.c'):
        available.update(f.name for f in functions(path.read_text(), str(path)) if not f.static)
    for name, value in changes.items():
        if name.endswith('.c'):
            available.update(f.name for f in functions(value, name) if not f.static)
    unresolved = []
    for name in ('FR_Menu_LoadStdPalAt',):
        if name not in available:
            unresolved.append({'kind': 'missing-credits-native-provider', 'symbol': name})
    for font in ('FR_FONT_NORMAL', 'FR_FONT_NORMAL_COPY_1'):
        if font not in read('include/text.h'):
            unresolved.append({'kind': 'missing-exact-credits-font', 'symbol': font})
    ql_header = out / 'include/whole_game_fr_quest_log.h'
    if not ql_header.exists():
        unresolved.append({'kind': 'missing-shared-questlog-state', 'symbol': 'whole_game_fr_quest_log.h'})
    indigo = out / 'data/maps/FRIndigoPlateau_Exterior/scripts.inc'
    indigo_text = indigo.read_text() if indigo.exists() else ''
    if not (re.search(r'(?m)^\s*FR_special\s+DoCredits\s*$', indigo_text) and all(token in indigo_text for token in ('FR_MUS_CREDITS', 'FR_VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR'))):
        unresolved.append({'kind': 'missing-original-indigo-credits-script', 'symbol': 'FRIndigoPlateau_Exterior'})
    for name, value in changes.items():
        path = out / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(value)
    for asset in assets:
        path = out / asset['target']; path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(donor / asset['source'], path)
    report = {'schemaVersion': 1, 'status': 'blocked' if unresolved else 'source-staged',
        'ready': not unresolved, 'buildEligible': not unresolved, 'unresolved': unresolved,
        'files': sorted(changes), 'source': {'path': 'src/credits.c', 'sha256': _sha(source),
            'functions': len(functions(source, 'src/credits.c'))},
        'assets': assets, 'dataProvenance': provenance,
        'providers': [{'name': 'DoCredits', 'target': 'FR_DoCredits', 'status': 'source-ported-native-compiled',
            'source': 'src/credits.c:DoCredits', 'files': [TARGET, 'src/overworld.c', 'src/field_camera.c', 'src/field_weather.c', 'src/hall_of_fame.c'],
            'qualification': 'original source plus actual agbcc/assembler verification; cartridge ending/continue unrun'}],
        'sourceClosure': {'overworld': list(OVERWORLD_FUNCTIONS), 'camera': 'CameraUpdateNoObjectRefresh',
            'weather': 'FadeSelectedPals', 'picture': list(PIC_FUNCTIONS) + ['GetMonSpritePalFromSpeciesAndPersonality']},
        'sceneMaps': sorted({v for k, v in names.items() if k.startswith('MAP_') and k not in ('MAP_GROUP', 'MAP_NUM')}),
        'callbackChain': ['shared native Hall of Fame StartCredits', 'Kanto FR_SetWarpsToRollCredits',
            'original IndigoPlateau_Exterior on-frame script', 'FR_DoCredits', 'original roll/map/mon/end callbacks',
            'original SoftReset(RESET_ALL)', 'shared native continue/load, retaining Kanto clear/respawn state'],
        'sharedNative': ['Emerald Hall of Fame screen/save history and gHasHallOfFameRecords',
            'party/player identity', 'map engine and camera state', 'weather processing',
            'QuestLog field tint and music-disable state'],
        'qualification': 'source staging only; targeted compiler/assets verification and cartridge ending/continue remain required',
        'measurements': {'transformSeconds': time.monotonic() - started, 'queueSeconds': None, 'buildSeconds': None, 'nativeExecutionSeconds': None},
        'canonicalSourcesModified': False}
    if report_dir is not None:
        path = Path(report_dir); path.mkdir(parents=True, exist_ok=True)
        (path / 'credits-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
