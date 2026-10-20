"""Import original FireRed audio data into a staged Emerald source tree.

No ROMs or canonical source are modified. No song substitutions are made. The
ledger certifies source dependency closure, not a build or audible playback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

SONG = re.compile(r'^\s*song\s+(\w+),\s*([^,\n]+),\s*([^@\n]+)', re.M)
DEFINE = re.compile(r'^#define\s+((?:MUS|SE)_\w+)\s+(0x[\da-fA-F]+|\d+)\b', re.M)
DEFINITION = re.compile(r'^\s*(\w+)::?|^\s*\.(?:set|equ|equiv)\s+(\w+),', re.M)
INCLUDE = re.compile(r'\.(include|incbin)\s+"([^"]+)"')
TOKEN = re.compile(r'\b[A-Za-z_]\w*\b')
DATA = ('voice_groups.inc', 'keysplit_tables.inc', 'programmable_wave_data.inc',
        'direct_sound_data.inc', 'cry_tables.inc')
BEGIN, END = '@ BEGIN FR AUDIO', '@ END FR AUDIO'


def _clean(text: str) -> str:
    return re.sub(r'\s+', '', re.sub(r'@[^\n]*|//[^\n]*|/\*[\s\S]*?\*/', '', text))


def _block(text: str, content: str) -> str:
    text = re.sub(re.escape(BEGIN) + r'[\s\S]*?' + re.escape(END) + r'\n?', '', text)
    return text.rstrip() + '\n\n' + BEGIN + '\n' + content.rstrip() + '\n' + END + '\n'


def _safe(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f'audio path escapes source root: {relative}')
    return path


def _symbols(texts: dict[str, str]) -> dict[str, str]:
    names = {a or b for text in texts.values() for a, b in DEFINITION.findall(text)}
    return {name: ('voicegroupFR_' + name[10:] if re.fullmatch(r'voicegroup\d+', name)
                   else 'FR_' + name) for name in sorted(names)}


def _rewrite(text: str, symbols: dict[str, str]) -> str:
    # Assembly comments are excluded to keep provenance readable.
    return '\n'.join(TOKEN.sub(lambda m: symbols.get(m[0], m[0]), line.split('@', 1)[0])
                     + ('@' + line.split('@', 1)[1] if '@' in line else '')
                     for line in text.split('\n'))


def analyze_audio(donor: Path, base: Path) -> dict:
    donor, base = Path(donor).resolve(), Path(base).resolve()
    texts = {name: (donor / 'sound' / name).read_text() for name in DATA}
    symbols = _symbols(texts)
    songs = SONG.findall((donor / 'sound/song_table.inc').read_text())
    base_count = len(SONG.findall((base / 'sound/song_table.inc').read_text().split(BEGIN)[0]))
    constants = dict(DEFINE.findall((donor / 'include/constants/songs.h').read_text()))
    unresolved = []
    def issue(kind: str, **details):
        unresolved.append({'kind': kind, **details})
    cfg = {}
    for line in (donor / 'sound/songs/midi/midi.cfg').read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name, flags = line.split(':', 1)
        cfg[name.strip()] = flags.strip().split()
    for index, (song, player, unknown) in enumerate(songs):
        filename = song + '.mid'
        if filename not in cfg or not (donor / 'sound/songs/midi' / filename).is_file():
            issue('missing-song-source', song=song)
        if not player.strip().isdigit() or int(player) >= 4:
            issue('unsupported-player', song=song, player=player)
        flags = cfg.get(filename, [])
        group = next((int(f[2:]) for f in flags if re.fullmatch(r'-G\d+', f)), 0)
        if f'voicegroup{group:03}' not in symbols:
            issue('missing-bank', song=song, bank=group)
        if any(flag.startswith('-L') for flag in flags):
            issue('custom-midi-label', song=song)
        symbols[song] = 'FR_' + song
    for name, value in constants.items():
        number = int(value, 0)
        if number != 0xFFFF and number >= len(songs):
            issue('constant-out-of-range', constant=name, value=number)
    resources = {}
    for name, text in texts.items():
        for kind, relative in INCLUDE.findall(text):
            path = _safe(donor, relative)
            if kind == 'include':
                if not relative.startswith('sound/') or relative[6:] not in texts:
                    issue('unknown-audio-include', source=name, path=relative)
                continue
            source = path
            conversion = 'copy'
            if relative.endswith('.bin'):
                source = path.with_suffix('.wav')
                conversion = 'compressed-cry' if '/cries/' in relative else 'wav2agb'
            if not source.is_file():
                issue('missing-sample-source', source=name, path=relative)
            resources[relative] = {'source': str(source.relative_to(donor)), 'conversion': conversion}
    # Every instrument pointer and cry pointer must resolve to the imported data.
    for name, text in texts.items():
        for token in sorted(set(TOKEN.findall(re.sub(r'@[^\n]*|"[^"\n]*"', '', text)))):
            if token.startswith(('voicegroup', 'DirectSoundWaveData_', 'ProgrammableWaveData_', 'KeySplitTable', 'Cry_')) and token not in symbols:
                issue('undefined-audio-symbol', source=name, symbol=token)
    service = {}
    for relative in ('asm/macros/music_voice.inc', 'sound/music_player_table.inc'):
        left, right = (donor / relative).read_text(), (base / relative).read_text()
        if relative.endswith('music_player_table.inc'):
            # Emerald adds BSS alignment before the track arrays; field layout is identical.
            right = right.replace('.bss\n    .align 2', '.bss')
        equal = _clean(left) == _clean(right)
        service[relative] = equal
        if not equal:
            issue('audio-service-mismatch', source=relative)
    # These are the only header differences in the local M4A data ABI: an
    # already naturally aligned buffer, field/parameter names, and a bank extern.
    abi = (donor / 'include/gba/m4a_internal.h').read_text()
    for old, new in [('s8 pcmBuffer[', 's8 ALIGNED(4) pcmBuffer['),
                     ('u8 unk_8;', 'u8 numTracks;'),
                     ('extern const struct ToneData voicegroup000;', 'extern const struct ToneData voicegroup_dummy;'),
                     ('struct MusicPlayerTrack *track, u8 a3);', 'struct MusicPlayerTrack *tracks, u8 trackCount);')]:
        abi = abi.replace(old, new)
    service['m4a-data-abi'] = abi == (base / 'include/gba/m4a_internal.h').read_text()
    if not service['m4a-data-abi']:
        issue('audio-data-abi-mismatch', source='include/gba/m4a_internal.h')
    # Converter differences are restricted to the documented integer->label bank ABI.
    substitutions = {
        'agb.cpp': [('voicegroup%03u', 'voicegroup%s'), ('g_voiceGroup);', 'g_voiceGroup.c_str());')],
        'main.cpp': [('int g_voiceGroup = 0;', 'std::string g_voiceGroup = "_dummy";'),
                     ('voice group number (default:0)', 'voice group label (default:_dummy)'),
                     ('g_voiceGroup = std::stoi(arg);', 'g_voiceGroup = arg;')],
        'main.h': [('extern int g_voiceGroup;', 'extern std::string g_voiceGroup;')],
    }
    for path in sorted((donor / 'tools/mid2agb').glob('*')):
        if path.suffix not in ('.cpp', '.h'):
            continue
        text = path.read_text()
        for old, new in substitutions.get(path.name, []):
            text = text.replace(old, new)
        target = base / 'tools/mid2agb' / path.name
        equal = target.is_file() and text == target.read_text()
        service['mid2agb/' + path.name] = equal
        if not equal:
            issue('converter-semantics-mismatch', source=path.name)
    mapping = {name: name if int(value, 0) == 0xFFFF else 'FR_' + name for name, value in constants.items()}
    return {'schema': 'whole-game.single-rom.audio.v1', 'ready': not unresolved,
            'qualification': 'source-closure-only', 'unresolved': unresolved,
            'constants': mapping, 'symbols': symbols, 'base_song_count': base_count,
            'songs': [{'id': base_count + i, 'source_id': i, 'source': song, 'target': 'FR_' + song,
                       'player': int(player), 'unknown': unknown.strip(), 'flags': cfg.get(song + '.mid', [])}
                      for i, (song, player, unknown) in enumerate(songs)],
            'resources': resources, 'service_compatibility': service,
            'counts': {'songs': len(songs), 'base_songs_preserved': base_count,
                       'resources': len(resources), 'symbols': len(symbols)},
            'measurements': {'build_seconds': None, 'playback_seconds': None}}



def install_audio_charmap(donor: Path, stage: Path, base_song_count: int) -> dict:
    """Encode audio text-control operands as exact little-endian song IDs."""
    path = stage / 'charmap.txt'
    if not path.is_file():
        return {'ready': False, 'unresolved': [{'kind': 'missing-charmap', 'path': 'charmap.txt'}]}
    constants = DEFINE.findall((donor / 'include/constants/songs.h').read_text())
    aliases = {}
    for name, value in constants:
        if int(value, 0) == 0xFFFF:
            continue
        song_id = base_song_count + int(value, 0)
        if song_id > 0xFFFF:
            raise ValueError(f'audio text-control ID overflows u16: {name}')
        aliases['FR_' + name] = f'{song_id & 0xFF:02X} {song_id >> 8:02X}'
    text = path.read_text()
    # Replace old generated aliases as well as earlier hand-added donor IDs.
    text = re.sub(r'^FR_(?:MUS|SE)_\w+\s*=.*\n?', '', text, flags=re.M)
    path.write_text(_block(text, '\n'.join(f'{name} = {value}' for name, value in aliases.items())))
    return {'ready': True, 'unresolved': [], 'encoding': 'u16-little-endian', 'aliases': aliases}


def install_audio_runtime(donor: Path, stage: Path, constants: dict[str, str]) -> dict:
    """Route native audio consumers and preserve original fanfare wait durations."""
    required = ['src/m4a.c', 'src/sound.c', 'src/pokemon.c']
    absent = [name for name in required if not (stage / name).is_file()]
    if absent:
        return {'ready': False, 'unresolved': [{'kind': 'missing-runtime-source', 'path': p} for p in absent]}
    def write(name, text):
        (stage / name).write_text(text)
    header = '#ifndef GUARD_WHOLE_GAME_AUDIO_H\n#define GUARD_WHOLE_GAME_AUDIO_H\nu16 WholeGame_RemapAudio(u16 song);\nu16 WholeGame_FireRedBattleBGM(void);\n#endif\n'
    write('include/whole_game_audio.h', header)
    donor_bgm = (donor / 'src/pokemon.c').read_text().split('static u16 GetBattleBGM(void)\n{', 1)[1].split('\n}\n', 1)[0]
    replacements = dict(constants)
    replacements.update({name: 'FR_' + name for name in set(re.findall(r'\bTRAINER_CLASS_\w+', donor_bgm))})
    donor_bgm = TOKEN.sub(lambda m: replacements.get(m[0], m[0]), donor_bgm)
    base_constants = dict(DEFINE.findall((stage / 'include/constants/songs.h').read_text()))
    runtime_mapping = {name: constants[name] for name in set(base_constants) & set(constants) - {'MUS_NONE'}}
    # Emerald already has explicitly named FireRed soundtrack aliases.
    for name in base_constants:
        donor_name = re.sub(r'^(MUS|SE)_RG_', r'\1_', name)
        if donor_name != name and donor_name in constants:
            runtime_mapping[name] = constants[donor_name]
    common = sorted(runtime_mapping)
    source = ['#include "global.h"', '#include "whole_game_state.h"', '#include "whole_game_audio.h"',
              '#include "battle.h"', '#include "battle_setup.h"', '#include "data.h"',
              '#include "pokemon.h"', '#include "constants/trainers.h"',
              '#include "constants/songs.h"', '', 'u16 WholeGame_FireRedBattleBGM(void)', '{' + donor_bgm + '\n}',
              '', 'u16 WholeGame_RemapAudio(u16 song)', '{',
              '    if (!WholeGame_IsKanto())', '        return song;', '    switch (song)', '    {']
    for name in common:
        source.append('    case ' + name + ':')
        if name == 'MUS_VICTORY_TRAINER':
            source.extend(['        if ((gBattleTypeFlags & BATTLE_TYPE_TRAINER)',
                           '         && gTrainerBattleOpponent_A >= FR_TRAINER_FIRST',
                           '         && gTrainerBattleOpponent_A <= FR_TRAINER_LAST',
                           '         && (gTrainers[gTrainerBattleOpponent_A].trainerClass == FR_TRAINER_CLASS_LEADER',
                           '          || gTrainers[gTrainerBattleOpponent_A].trainerClass == FR_TRAINER_CLASS_CHAMPION))',
                           '            return FR_MUS_VICTORY_GYM_LEADER;'])
        source.append('        return ' + runtime_mapping[name] + ';')
    source.extend(['    default:', '        return song;', '    }', '}', ''])
    write('src/whole_game_audio.c', '\n'.join(source))
    for name in required:
        text = (stage / name).read_text()
        if '#include "whole_game_audio.h"' not in text:
            text = text.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_audio.h"')
        if name == 'src/m4a.c':
            # Both start and stop/continue must select the identical namespaced header.
            text = text.replace('&songTable[n]', '&songTable[WholeGame_RemapAudio(n)]')
        elif name == 'src/pokemon.c':
            if '#include "whole_game_state.h"' not in text:
                text = text.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_state.h"')
            marker = 'u16 GetBattleBGM(void)\n{'
            injection = '\n    if (WholeGame_IsKanto())\n        return WholeGame_FireRedBattleBGM();'
            if injection not in text:
                if marker not in text:
                    raise ValueError('GetBattleBGM source anchor missing')
                text = text.replace(marker, marker + injection)
        else:
            donor_fanfares = re.search(r'static const struct Fanfare sFanfares\[\] = \{([\s\S]*?)\n\};', (donor / 'src/sound.c').read_text())[1]
            fanfares = re.findall(r'\{\s*(MUS_\w+),\s*(\d+)\s*\}', donor_fanfares)
            table = re.search(r'(static const struct Fanfare sFanfares\[\] = \{)([\s\S]*?)(\n\};)', text)
            if 'FR_MUS_LEVEL_UP' not in table[2]:
                entries = '\n'.join('    { ' + constants[song] + ', ' + duration + ' },' for song, duration in fanfares)
                text = text[:table.end(2)] + '\n    // Original FireRed fanfares retain source wait durations.\n' + entries + text[table.end(2):]
            marker = 'void PlayFanfare(u16 songNum)\n{\n    s32 i;'
            injection = '\n    songNum = WholeGame_RemapAudio(songNum);'
            if marker + injection not in text:
                if marker not in text:
                    raise ValueError('PlayFanfare source anchor missing')
                text = text.replace(marker, marker + injection)
            marker = 'void PlayFanfareByFanfareNum(u8 fanfareNum)\n{\n    u16 songNum;'
            injection = ('\n    u32 frIndex;\n    songNum = WholeGame_RemapAudio(sFanfares[fanfareNum].songNum);'
                         '\n    for (frIndex = 0; frIndex < ARRAY_COUNT(sFanfares); frIndex++)'
                         '\n    {\n        if (sFanfares[frIndex].songNum == songNum)'
                         '\n        {\n            fanfareNum = frIndex;\n            break;\n        }\n    }')
            if marker + injection not in text:
                if marker not in text:
                    raise ValueError('PlayFanfareByFanfareNum source anchor missing')
                text = text.replace(marker, marker + injection)
        write(name, text)
    return {'ready': True, 'unresolved': [], 'mapped_common_constants': runtime_mapping,
            'fanfares': [{'song': constants[song], 'duration_frames': int(frames)} for song, frames in fanfares],
            'dependencies': ['whole_game_state.h:WholeGame_IsKanto', 'constants/trainers.h:FR_TRAINER_*'],
            'qualification': 'source-only; build and audible playback not run'}


def import_audio(donor: Path, stage: Path, output_dir: Path | None = None) -> dict:
    donor, stage = Path(donor).resolve(), Path(stage).resolve()
    if stage == donor or 'local/decomps' in str(stage):
        raise ValueError('audio destination must be an isolated staged source tree')
    report = analyze_audio(donor, stage)
    if not report['ready']:
        if output_dir:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            (Path(output_dir) / 'audio-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
        return report
    def write(relative, text):
        path = _safe(stage, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    symbols = report['symbols']
    for name in DATA:
        text = _rewrite((donor / 'sound' / name).read_text(), symbols)
        text = text.replace('"sound/', '"sound/fr/')
        write('sound/fr/' + name, text)
    shutil.copyfile(donor / 'sound/MPlayDef.s', stage / 'sound/fr/MPlayDef.s')
    for relative, resource in report['resources'].items():
        source = _safe(donor, resource['source'])
        target = _safe(stage, 'sound/fr/' + resource['source'][6:])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    rows, rules, linker = [], [], []
    for song in report['songs']:
        name = song['target']
        source = donor / 'sound/songs/midi' / (song['source'] + '.mid')
        target = stage / 'sound/songs/midi' / (name + '.mid')
        shutil.copyfile(source, target)
        flags = [f for f in song['flags'] if not f.startswith(('-G', '-L'))]
        group = next((int(f[2:]) for f in song['flags'] if f.startswith('-G')), 0)
        flags.extend([f'-GFR_{group:03}', '-L' + name])
        rules.extend([f'$(MID_ASM_DIR)/{name}.s: $(MID_SUBDIR)/{name}.mid sound/fr/MPlayDef.s',
                      '\t$(MID) $< $@ ' + ' '.join(flags),
                      '\tsed -i.bak \'s@"MPlayDef.s"@"fr/MPlayDef.s"@g\' $@',
                      '\t$(RM) $@.bak', ''])
        rows.append(f'\tsong {name}, {song["player"]}, {song["unknown"]}')
        linker.append(f'        sound/songs/midi/{name}.o(.rodata);')
    # Include within gSongTable, before trailing dummy header rather than after it.
    table_path = stage / 'sound/song_table.inc'
    text = re.sub(re.escape(BEGIN) + r'[\s\S]*?' + re.escape(END) + r'\n?', '', table_path.read_text())
    last = list(SONG.finditer(text))[-1]
    newline = text.find('\n', last.end())
    text = text[:newline + 1] + BEGIN + '\n' + '\n'.join(rows) + '\n' + END + '\n' + text[newline + 1:]
    write('sound/song_table.inc', text)
    includes = '\n'.join(f'\t.include "sound/fr/{name}"' for name in DATA if name != 'cry_tables.inc')
    sound_path = stage / 'data/sound_data.s'
    write('data/sound_data.s', _block(sound_path.read_text(), includes))
    header = ['#ifndef GUARD_CONSTANTS_FR_AUDIO_H', '#define GUARD_CONSTANTS_FR_AUDIO_H']
    for name, value in DEFINE.findall((donor / 'include/constants/songs.h').read_text()):
        if int(value, 0) != 0xFFFF:
            header.append(f'#define FR_{name} {report["base_song_count"] + int(value, 0)}')
    header.append('#endif')
    write('include/constants/fr_audio.h', '\n'.join(header) + '\n')
    header_path = stage / 'include/constants/songs.h'
    if '#include "constants/fr_audio.h"' not in header_path.read_text():
        write('include/constants/songs.h', header_path.read_text() + '\n#include "constants/fr_audio.h"\n')
    rules.extend(['sound/fr/direct_sound_samples/cries/%.bin: sound/fr/direct_sound_samples/cries/%.wav',
                  '\t$(WAV2AGB) -b -c -l 1 --no-pad $< $@'])
    write('sound/fr/audio_rules.mk', '\n'.join(rules) + '\n')
    makefile = stage / 'Makefile'
    if 'include sound/fr/audio_rules.mk' not in makefile.read_text():
        write('Makefile', makefile.read_text() + '\ninclude sound/fr/audio_rules.mk\n')
    ld = stage / 'ld_script.ld'
    if ld.exists():
        text = ld.read_text()
        marker = '        data/sound_data.o(.rodata);'
        if 'FR_mus_dummy.o' not in text:
            if marker not in text:
                raise ValueError('explicit audio linker insertion point missing')
            write('ld_script.ld', text.replace(marker, marker + '\n' + '\n'.join(linker)))
    source_paths = {donor / 'sound' / name for name in DATA}
    source_paths.update(donor / resource['source'] for resource in report['resources'].values())
    source_paths.update(donor / 'sound/songs/midi' / (song['source'] + '.mid') for song in report['songs'])
    source_paths.update((donor / 'sound/songs/midi/midi.cfg', donor / 'sound/MPlayDef.s',
                         donor / 'include/constants/songs.h', donor / 'sound/song_table.inc'))
    report['charmap'] = install_audio_charmap(donor, stage, report['base_song_count'])
    if not report['charmap']['ready']:
        report['ready'] = False
        report['unresolved'].extend(report['charmap']['unresolved'])
    report['runtime'] = install_audio_runtime(donor, stage, report['constants'])
    if not report['runtime']['ready']:
        report['ready'] = False
        report['unresolved'].extend(report['runtime']['unresolved'])
    report['source_hashes'] = {str(path.relative_to(donor)): hashlib.sha256(path.read_bytes()).hexdigest()
                               for path in sorted(source_paths)}
    if output_dir:
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        (Path(output_dir) / 'audio-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--donor', type=Path, required=True)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    result = import_audio(args.donor, args.stage, args.output_dir)
    print(json.dumps({'ready': result['ready'], 'counts': result['counts'], 'unresolved': result['unresolved']}, indent=2))
    raise SystemExit(0 if result['ready'] else 1)
