"""Bounded prefab/IR modification of a complete original cartridge.

This adapter supports the already recovered Aria reward subsystem. It is not a
whole-game decompiler or a heterogeneous composition backend.
"""
from __future__ import annotations
import copy
import hashlib
import json
import platform
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'research/deep-extraction/castlevania'
PREFAB = 'castlevania.aria.enemy_defeat_rewards'
LIMITS = {'subprocess_s': 30, 'cartridges': 3, 'frames_per_cartridge': 6400, 'vectors': 14720}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare_mod_request(request):
    """Resolve a pinned existing prefab and modify its typed native IR argument."""
    if request.get('schema') != 'prefab-mod-request/1' or request.get('prefab_id') != PREFAB:
        raise ValueError('unsupported modification request/prefab')
    if request.get('modification') != {'behavior': 'defeat_rewards', 'parameter': 'xp_scale', 'value': 2}:
        raise ValueError('only qualified reward xp_scale=2 is supported')
    if request.get('limits', LIMITS) != LIMITS:
        raise ValueError('unsupported qualification limits; exact bounded recipe required')
    for ref in ('package', 'plan', 'qualification', 'rom'):
        pin = request.get(ref, {})
        path = (ROOT / pin.get('path', '')).resolve()
        path.relative_to(ROOT)
        if not path.is_file() or digest(path) != pin.get('sha256'):
            raise ValueError(f'{ref}: pinned input differs or is missing')
    package = json.loads((ROOT / request['package']['path']).read_text())
    if package['id'] != PREFAB or package['native_implementation']['recovery']['rom_sha256'] != request['rom']['sha256']:
        raise ValueError('prefab/ROM identity mismatch')
    proof = json.loads((ROOT / request['qualification']['path']).read_text())
    if proof.get('rom_sha256') != request['rom']['sha256']:
        raise ValueError('qualification ROM identity mismatch')
    required = {str((HERE/name).relative_to(ROOT)) for name in ('defeat-policy.c', 'defeat-policy.h', 'defeat-host.c', 'defeat-differential.c', 'defeat-gameplay.json')}
    if not required.issubset(proof.get('source_pins', {})):
        raise ValueError('qualification missing required executable/recipe closure pins')
    if proof['outcome'] != 'passed' or proof['differential']['vectors'] != 14720:
        raise ValueError('missing bounded native qualification')
    for path, expected in proof['source_pins'].items():
        # Historical plans can acquire reviewed host/package metadata pins. The
        # request pins current plans independently; this run repeats all native
        # witnesses. Reuse only unchanged executable/recipe qualification inputs.
        if path.endswith('.plan.json'):
            continue
        if digest(ROOT / path) != expected:
            raise ValueError(f'qualification source changed: {path}')
    recipe = json.loads((HERE/'defeat-gameplay.json').read_text())
    if (recipe.get('boot_until_frame'), recipe.get('play_steps'), recipe.get('frames_per_step')) != (5800, 50, 12):
        raise ValueError('unsupported gameplay recipe limits')
    for event in recipe['boot_inputs'].split(','):
        frame, hold, keys = event.split(':')
        if not (0 <= int(frame) <= 8000 and 1 <= int(hold) <= 1200 and set(keys.split('+')) <= {'A', 'B', 'START', 'LEFT', 'RIGHT'}):
            raise ValueError('unsupported gameplay recipe event')
    plan = json.loads((ROOT / request['plan']['path']).read_text())
    if plan['native_build']['packages'][0]['package']['sha256'] != request['package']['sha256']:
        raise ValueError('plan/package identity mismatch')
    modified = copy.deepcopy(plan)
    hooks = modified['native_build']['hooks']
    if len(hooks) != 1 or hooks[0]['symbol'] != 'gv_aos_defeat_native' or hooks[0]['args'] != [{'arg': 0}, {'constant': 1}]:
        raise ValueError('unexpected baseline native ABI')
    hooks[0]['args'][1]['constant'] = request['modification']['value']
    modified['id'] = 'aria-defeat-double-xp'
    return plan, modified


def _gameplay(cart, out):
    from tools.re.session.bridge import NativeSession
    recipe = json.loads((HERE / 'defeat-gameplay.json').read_text())
    session = NativeSession(cart, out, ROOT / 'tools/re/session/build/gba-session')
    trace = []
    try:
        until = recipe['boot_until_frame']
        masks = [set() for _ in range(until)]
        for event in recipe['boot_inputs'].split(','):
            frame, hold, keys = event.split(':')
            for index in range(int(frame), min(int(frame) + int(hold), until)):
                masks[index].update(keys.split('+'))
        frame = 0
        while frame < until:
            end = frame + 1
            while end < min(frame + 120, until) and masks[end] == masks[frame]:
                end += 1
            session.act({'frames': end - frame, 'keys': sorted(masks[frame])}, 120)
            frame = end
        if int.from_bytes(Path(cart).read_bytes()[0x4f0b14:0x4f0b18], 'little') != 0x02000000:
            raise ValueError('native state root differs from exact-ROM observation profile')
        session.start_recording(3)
        for index in range(recipe['play_steps']):
            keys = ['RIGHT'] if index < 120 else ['LEFT']
            if index % 3 == 0:
                keys.append('B')
            if index % 17 == 0:
                keys.append('A')
            session.act({'frames': recipe['frames_per_step'], 'keys': keys}, 120)
            data = session.read_memory(0x0201325c, 56)
            actor = int.from_bytes(session.read_memory(0x02013110, 4), 'little')
            trace.append({'frame': session.frame, 'XP': int.from_bytes(data[0x30:0x34], 'little'),
                          'level': data[0x1d], 'HP': int.from_bytes(data[0x1e:0x20], 'little'),
                          'position_hex': session.read_memory(actor + 0x40, 8).hex(),
                          'defeated_hex': session.read_memory(0x020133a0, 16).hex(), 'action_keys': keys})
        result = {'rom_sha256': digest(cart), 'trace': trace, 'video': session.stop_recording(), 'emulator': session.emulator}
        (out / 'gameplay.json').write_text(json.dumps(result, indent=2) + '\n')
        return result
    finally:
        session.close()


def observation_provenance():
    return {'kind': 'exact-ROM recovered adapter and retained qualification harness',
            'rom_sha256': '910f88d3701e6c9f99c0d63660c14c61d8b79b0c17bfd7b35a15185be36430a5',
            'state_root': {'rom_pointer': '0x084f0b14', 'resolved_ram': '0x02000000'},
            'qualified_fields': {'XP': {'address': '0x0201328c', 'width': 32, 'source': 'defeat-host.c:12,25,33'},
                                 'defeated_species': {'address': '0x020133a0', 'bytes': 16, 'source': 'defeat-host.c:27,36'}},
            'diagnostic_fields': 'HP,level,player_position follow retained qualify_defeat.py gameplay harness; they are not independent recovered contracts or proof of whole-game progress',
            'references': {str((HERE/name).relative_to(ROOT)): digest(HERE/name) for name in ('defeat-host.c','defeat-differential.c','qualify_defeat.py')},
            'authority': 'Original instruction differential plus exact-ROM ABI adapter; no community decompilation or Pokemon observer used'}


def execute_mod_request(request, output_dir):
    """Build through the shared compiler and prove real native reward behavior."""
    from tools.composition.native_build import build
    baseline, modified = prepare_mod_request(request)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    start = time.monotonic()
    report = {'schema': 'prefab-mod-result/1', 'request_id': request['request_id'], 'status': 'failed',
              'prefab_id': PREFAB, 'request': request, 'queue_s': None, 'environment': platform.platform(),
              'frontend_sha256': digest(Path(__file__)),
              'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'observation_provenance': observation_provenance(),
              'native_command_timeout_s': 10, 'video_encoder_timeout_s': 60,
              'build_limits': modified['native_build'],
              'stages': [], 'coverage': 'Recovered defeat reward transaction; retained native services; 6400-frame early corridor',
              'gaps': ['Full campaign/routes untested', 'Not whole-game IR recovery', 'No FireRed/Emerald mashup',
                       'Level growth, pickups and RNG retain original native services'],
              'limits': LIMITS,
              'timing_accounting': 'Build/check/gameplay stages nested in total_wall_s; stage children in shared build receipts overlap parent build stages; queue unavailable'}
    def stage(name, action):
        began = time.monotonic()
        try:
            value = action()
        except BaseException:
            report['stages'].append({'name': name, 'wall_s': round(time.monotonic()-began, 6), 'outcome': 'failed'})
            raise
        report['stages'].append({'name': name, 'wall_s': round(time.monotonic()-began, 6), 'outcome': 'passed'})
        return value
    def command(args):
        result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=30)
        (output / (Path(args[0]).name + '.stdout')).write_text(result.stdout)
        (output / (Path(args[0]).name + '.stderr')).write_text(result.stderr)
        result.check_returncode()
        return result.stdout
    try:
        (output / 'request.json').write_text(json.dumps(request, indent=2)+'\n')
        (output / 'modified.plan.json').write_text(json.dumps(modified, indent=2)+'\n')
        report['derived_plan'] = {'path': str(output/'modified.plan.json'), 'sha256': digest(output/'modified.plan.json'),
                                  'change': {'hook': 'enemy_defeat', 'argument': 1, 'before': 1, 'after': 2}}
        historical = json.loads((ROOT/request['qualification']['path']).read_text())
        report['historical_plan_pin_mismatches'] = [path for path, expected in historical['source_pins'].items()
                                                    if path.endswith('.plan.json') and digest(ROOT/path) != expected]
        report['historical_evidence_policy'] = 'Executable source/recipe identity retained; historical plan metadata mismatch explicitly recorded; all instruction and gameplay witnesses freshly executed against current derived cartridge'
        rom = ROOT / request['rom']['path']
        report['builds'] = {}
        for name, plan in [('parity', baseline), ('modified', modified)]:
            report['builds'][name] = stage('build-'+name, lambda name=name, plan=plan: build(plan, rom, output / name))
        stage('compile-native-oracle', lambda: command(['cc', '-O2', '-Wall', '-I/opt/homebrew/include', str(HERE/'defeat-differential.c'), '-L/opt/homebrew/lib', '-Wl,-rpath,/opt/homebrew/lib', '-lmgba', '-o', str(output/'oracle')]))
        raw = stage('instruction-differential', lambda: command([str(output/'oracle'), str(rom), str(output/'parity/game.gba')]))
        report['differential'] = json.loads(raw.strip().splitlines()[-1])
        plays = {}
        for name, cart in [('original', rom), ('parity', output/'parity/game.gba'), ('modified', output/'modified/game.gba')]:
            plays[name] = stage('native-play-'+name, lambda name=name, cart=cart: _gameplay(cart, output/('play-'+name)))
        report['witnesses'] = {'original_parity_trace_equal': plays['original']['trace'] == plays['parity']['trace'],
                               'original_parity_video_equal': plays['original']['video']['sha256'] == plays['parity']['video']['sha256'],
                               'original_xp': plays['original']['trace'][-1]['XP'], 'parity_xp': plays['parity']['trace'][-1]['XP'],
                               'modified_xp': plays['modified']['trace'][-1]['XP']}
        witness = report['witnesses']
        if not (witness['original_parity_trace_equal'] and witness['original_parity_video_equal'] and witness['original_xp'] > 0 and witness['modified_xp'] == 2*witness['original_xp'] and report['differential']['outcome'] == 'passed'):
            raise ValueError('native causal qualification failed')
        lock = json.loads((output/'modified/composition.lock.json').read_text())
        original = rom.read_bytes()
        candidate = (output/'modified/game.gba').read_bytes()
        restored = bytearray(candidate[:len(original)])
        for row in lock['hook_lowering']:
            offset = int(row['hook']['address'], 16)-0x08000000
            restored[offset:offset+len(bytes.fromhex(row['hook']['preimage']))] = bytes.fromhex(row['hook']['preimage'])
        if restored != original or digest(rom) != request['rom']['sha256']:
            raise ValueError('original cartridge preservation invariant failed')
        shutil.copyfile(output/'modified/game.gba', output/'final.gba')
        report.update(status='qualified-bounded-modification', artifact=str(output/'final.gba'), artifact_sha256=digest(output/'final.gba'),
                      original_bytes_preserved_outside_hooks=True, hook_lowering=lock['hook_lowering'], payload_bytes=lock['payload_bytes'],
                      retained_original_sha256=lock['retained_foundation_sha256'], build_mode='clean native payload, no dependency setup/cache',
                      gameplay={name: {'report': str(output/('play-'+name)/'gameplay.json'), 'video': play['video']} for name, play in plays.items()})
    except BaseException as error:
        report['error'] = str(error)
        raise
    finally:
        report['total_wall_s'] = round(time.monotonic()-start, 6)
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
