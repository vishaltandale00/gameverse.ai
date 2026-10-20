"""Bounded actual FireRed native caller/consumer proof for MorphBall adaptation.

This deliberately initializes source-valid function contexts, not a saved game
or an asserted natural route. Native GBA instructions run in existing libmGBA.
"""
import argparse
import hashlib
import json
import platform
import subprocess
import struct
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = Path(__file__).with_suffix('.c.in')
NAMES = '''gPlayerAvatar gObjectEvents gMapHeader gSprites gSaveBlock1 gSaveBlock2 gSaveBlock1Ptr
gSaveBlock2Ptr VMap gQuestLogState gQuestLogPlaybackState PlayerNotOnBikeMoving
FlagSet FlagGet RunScriptCommand gScriptCmdTable gScriptCmdTableEnd'''.split()


def pin(path):
    path = path.resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bytes': path.stat().st_size}


def verify_elf_rom(elf, rom):
    """Check each nonempty file-backed ROM section against the actual oracle."""
    image, data = elf.read_bytes(), rom.read_bytes()
    if image[:6] != b'\x7fELF\x01\x01':
        raise ValueError('expected ELF32 little endian source image')
    offset = struct.unpack_from('<I', image, 32)[0]
    stride, count = struct.unpack_from('<HH', image, 46)
    rows = []
    for index in range(count):
        _, kind, _, address, file_offset, size = struct.unpack_from('<IIIIII', image, offset + stride * index)
        if kind != 8 and size and 0x08000000 <= address < 0x0a000000:
            block = image[file_offset:file_offset + size]
            actual = data[address - 0x08000000:address - 0x08000000 + size]
            # GBA post-link header fixing fills logo/title/checksum bytes.
            # Preserve the actual startup branch; no function code excluded.
            header = address == 0x08000000 and size >= 0xc0
            matches = (block[:4] == actual[:4] and block[0xc0:] == actual[0xc0:]) if header else block == actual
            if not matches:
                raise ValueError('source ELF ROM section differs at ' + hex(address))
            rows.append({'address': address, 'bytes': size, 'elf_sha256': hashlib.sha256(block).hexdigest(),
                         'rom_sha256': hashlib.sha256(actual).hexdigest(),
                         'excluded_header_span': [0x08000004, 0x080000c0] if header else None})
    if not rows:
        raise ValueError('source ELF has no ROM sections')
    return rows


def run(original, elf, output, candidate=None, candidate_tests=None, donor=False, instruction_limit=2048, boot_frames=0, candidate_helpers=None, metadata=None):
    if not 1 <= instruction_limit <= 16384:
        raise ValueError('use established native ABI instruction bound1..16384')
    if boot_frames not in (0, 120):
        raise ValueError('reuse established retained-service boot0/120-frame initialization')
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'gameverse.behavior-swap-native-proof/1',
              'scope': 'Source-valid isolated native function contexts; no natural route or whole-game/save compatibility claim',
              'outcome': 'failed', 'original': pin(original), 'source_elf': pin(elf),
              'harness': pin(TEMPLATE), 'runner': pin(Path(__file__)),
              'environment': platform.platform(), 'queue_s': None,
              'limits': {'instructions_per_call': instruction_limit, 'boot_frames': boot_frames, 'stage_timeout_s': 30},
              'native_call_hle': [], 'stages': [], 'attempt': 1,
              'bios_boundary': 'libmGBA built-in BIOS HLE; original BIOS ROM disabled; native game functions are not substituted',
              'interrupt_context': 'Masked synchronous native calls; interrupt-visible intermediate writes are outside proof',
              'guard_terminal': 'Stops at exact Thumb UDF254 emitted for compiler guards; cartridge exception dispatch/recovery unqualified',
              'abi_checks': ['r4-r11 preserved', 'SP balanced', '16-byte stack canaries at 03007b00 and 03007e10'],
              'unavailable': ['CI queue and job durations', 'natural route coverage', 'save roundtrip'],
              'build_mode': 'clean native proof harness', 'cache': 'none'}
    report['proof_kind'] = 'original-donor-native-lifecycle' if donor else 'host-native-consumer'
    report['context'] = metadata
    if candidate:
        report['candidate'] = pin(candidate)

    def stage(label, cmd, retain_output=True):
        t = time.monotonic()
        result = subprocess.run([str(v) for v in cmd], capture_output=True, text=True,
                                timeout=30, cwd=ROOT)
        report['stages'].append({'label': label, 'wall_s': time.monotonic() - t,
                                 'outcome': 'pass' if result.returncode == 0 else 'failed',
                                 'exit_code': result.returncode, 'stdout': result.stdout if retain_output else None,
                                 'stderr': result.stderr})
        if retain_output:
            (output / (label + '.stdout')).write_text(result.stdout)
        (output / (label + '.stderr')).write_text(result.stderr)
        if result.returncode:
            raise RuntimeError(label + ': ' + result.stderr)
        return result.stdout

    try:
        report['elf_rom_matching_sections'] = verify_elf_rom(elf, original)
        symbols = {}
        for line in stage('symbols', ['arm-none-eabi-nm', '-n', elf], False).splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[-1] in ([] if donor else NAMES):
                symbols[parts[-1]] = int(parts[0], 16)
        if not donor and set(symbols) != set(NAMES):
            raise ValueError('missing required exact native ELF symbols')
        report['symbols'] = symbols
        source_names = (['src/sprites_ai/morph_ball.c', 'src/sprites_ai/message_banner.c',
                         'src/sprite.c', 'src/sprite_util.c', 'include/structs/sprite.h',
                         'include/constants/game_state.h'] if donor else
                        ['src/field_player_avatar.c', 'src/event_data.c', 'src/event_object_movement.c',
                         'src/fieldmap.c', 'src/script.c', 'src/scrcmd.c',
                         'include/global.fieldmap.h', 'include/script.h'])
        report['source_pins'] = [pin(elf.parent / name) for name in source_names]
        source = TEMPLATE.read_text().replace('@SYMBOLS@', '\n'.join(
            '#define ' + k + ' ' + hex(v) for k, v in symbols.items()))
        source = source.replace('@CANDIDATE_TESTS@', candidate_tests or '')
        source = source.replace('@CANDIDATE_HELPERS@', candidate_helpers or '')
        source = source.replace('instruction_cap=2048', 'instruction_cap=' + str(instruction_limit))
        source = source.replace('boot_frames=0', 'boot_frames=' + str(boot_frames))
        if donor:
            template = TEMPLATE.with_name('morphball_donor_native.c.in')
            report['donor_harness'] = pin(template)
            source = template.read_text().replace('@COMMON@', source.split('/* Source-valid', 1)[0])
            report['scope'] += '; banner graphics/text setup excluded; banner begins at source-valid static phase; donor activation pause UI remains outside transferred system'
        (output / 'native.c').write_text(source)
        stage('compile', ['cc', '-std=c11', '-O1', '-I/opt/homebrew/include',
                          output / 'native.c', '-L/opt/homebrew/lib',
                          '-Wl,-rpath,/opt/homebrew/lib', '-lmgba', '-o', output / 'native'])
        args = [output / 'native', original]
        if candidate:
            args.append(candidate)
        report['native'] = json.loads(stage('native', args))
        report['outcome'] = report['native']['outcome']
    except Exception as exc:
        report['error'] = str(exc)
    finally:
        report['total_s'] = time.monotonic() - started
        report['stage_timing_relationship'] = 'Sequential nonoverlapping stages; total includes source preparation and reports; native boot_wall_s is nested inside native stage and must not be added again'
        report['artifacts'] = [pin(output / name) for name in ('native.c', 'native.stdout', 'native.stderr') if (output / name).is_file()]
        if candidate and pin(candidate)['sha256'] != report['candidate']['sha256']:
            report.update(outcome='failed', error='candidate ROM changed during native proof')
        (output / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def run_candidate(original, elf, build_path, recipe_path, request_path, output):
    """Consume the build owner's immutable candidate; never rebuild it here."""
    build, recipe, request = (json.loads(p.read_text()) for p in (build_path, recipe_path, request_path))
    candidate = build_path.parent / 'candidate.gba'
    if build['outcome'] != 'pass' or pin(candidate)['sha256'] != build['candidate_sha256']:
        raise ValueError('exact successful installed candidate required')
    if pin(original)['sha256'] != build['host_sha256'] or pin(recipe_path)['sha256'] != build['recipe_sha256']:
        raise ValueError('candidate host/recipe identity differs')
    callback = build['symbols'][recipe['callback']['symbol']] & ~1
    script_objects = [o['label'] for o in recipe['installation']['objects']
                      if o['pieces'][0].get('hex') == '24']
    if len(script_objects) != 1:
        raise ValueError('one captured source-gotonative script required')
    script = build['objects'][script_objects[0]]
    original_data, candidate_data = original.read_bytes(), candidate.read_bytes()
    allowed = set()
    for offset in (0x166336, 0x166343, 0x166350):
        if candidate_data[offset:offset + 4] != struct.pack('<I', script):
            raise ValueError('actual native caller hook differs from generated script')
        allowed.update(range(offset, offset + 4))
    if any(a != b and index not in allowed for index, (a, b) in enumerate(zip(original_data, candidate_data))):
        raise ValueError('candidate alters original code/storage outside three source call operands')
    helpers = TEMPLATE.with_name('morphball_host_context.c.in').read_text().replace('@CALLBACK@', hex(callback)).replace('@SCRIPT@', hex(script))
    callback_word = struct.unpack_from('<I', candidate_data, callback - 0x08000000)[0]
    helpers = '#define SWAP_CALLBACK_WORD ' + hex(callback_word) + '\n' + helpers
    tests = TEMPLATE.with_name('morphball_candidate_tests.c.in').read_text()
    canonical = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    metadata = {'build': pin(build_path), 'recipe': pin(recipe_path), 'request': pin(request_path),
                'request_sha256': canonical(request), 'host_sha256': request['host_sha256'],
                'donor_sha256': request['donor_sha256'], 'callback': callback, 'script': script,
                'state_initialization': '120 event-aware original boot frames; same serialized core context cloned into candidate before source-valid function fixtures',
                'original_prefix_only_three_call_operands_changed': True,
                'callback_code_sha256': hashlib.sha256(candidate_data[callback - 0x08000000:callback - 0x08000000 + 16]).hexdigest(),
                'notification_tick_limit': 600,
                'notification_budget_basis': 'Measured native text/fanfare task baseline completed within this finite source-configured bound; no model or route campaign',
                'checks': ['actual source coordinate wrappers and native script scheduler', 'intentional ownership-before-ack delta',
                           'real native text and fanfare task completion', 'real native input acknowledgement and yielded continuation',
                           'native NPC removal, scene commit and release', 'canonical native held-B running consumer',
                           'four source admission negatives', 'owned duplicate suppression', 'native-context reset and reentry',
                           'busy native notification failure before persistent grant', 'borrowed scratch and caller stack guards',
                           'source-supported in-memory SaveBlock1 relocation'],
                'limits': ['synthetic source-valid function contexts; no natural trigger reachability claim',
                           'no visual/audio quality or physical hardware claim', 'no serialized save or cartridge trap-recovery claim',
                           'original full aide conversation not traversed; source ordering and bounded original caller/tail witness only']}
    result = run(original, elf, output, candidate=candidate, candidate_helpers=helpers,
                 candidate_tests=tests, instruction_limit=16384, boot_frames=120, metadata=metadata)
    for key in ('request_sha256', 'host_sha256', 'donor_sha256'):
        result[key] = metadata[key]
    result['native_consumer_verified'] = result['outcome'] == 'pass'
    result['global_closure'] = 'OPEN'
    (output / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('original', type=Path)
    parser.add_argument('elf', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--donor', action='store_true')
    parser.add_argument('--candidate-build', type=Path)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--donor-candidate', type=Path)
    args = parser.parse_args()
    if args.candidate_build:
        if not args.recipe or not args.request or args.donor:
            parser.error('candidate build requires --recipe and --request, without --donor')
        report = run_candidate(args.original.resolve(), args.elf.resolve(), args.candidate_build.resolve(),
                               args.recipe.resolve(), args.request.resolve(), args.output.resolve())
    else:
        report = run(args.original.resolve(), args.elf.resolve(), args.output.resolve(), donor=args.donor,
                     candidate=args.donor_candidate.resolve() if args.donor_candidate else None,
                     metadata={'paired_scope': 'Every EWRAM/IWRAM byte after each call except dynamically stored bytes in actual returned frames below entrySP03007e00 and at/above actual minimumSP; store8/16/32/Multiple instrumentation forwards unchanged; all bytes at/above entrySP compared; same complete canonical input copied before each actual native step; void return registers ignored'} if args.donor_candidate else None)
    print(json.dumps({'outcome': report['outcome'], 'total_s': report['total_s']}))
    raise SystemExit(report['outcome'] != 'pass')
