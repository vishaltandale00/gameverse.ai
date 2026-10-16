"""JSONL v1 isolated playtester adapter over a private persistent libmgba core."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import select
import shutil
import struct
import subprocess
import sys
import time
import uuid
import zlib

KEYS = {key: 1 << i for i, key in enumerate(
    ('A', 'B', 'SELECT', 'START', 'RIGHT', 'LEFT', 'UP', 'DOWN', 'R', 'L'))}
VERSION = 'mgba-session/2'


def png(rgba):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + rgba[y * 960:(y + 1) * 960] for y in range(160))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 240, 160, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


class NativeSession:
    def __init__(self, rom, out, binary, *, max_frames=120, timeout=10, initial_state=None, initial_save=None, expected_initial_save_sha256=None, memory_profile=None, mailbox_profile=None, callback_profile=None):
        if initial_save is not None and initial_state is not None:
            raise ValueError('conflicting_initial_state_and_save')
        if expected_initial_save_sha256 is not None and initial_save is None:
            raise ValueError('initial_save_required_for_hash')
        save_bytes = None
        self.initial_save = None
        if initial_save is not None:
            source_save = Path(initial_save).resolve()
            if not source_save.is_file() or not 1 <= source_save.stat().st_size <= 1024 * 1024:
                raise ValueError('invalid_initial_save_size')
            save_bytes = source_save.read_bytes()
            save_sha256 = hashlib.sha256(save_bytes).hexdigest()
            if expected_initial_save_sha256 is not None and save_sha256 != expected_initial_save_sha256:
                raise ValueError('initial_save_sha256_mismatch')
            self.initial_save = {'path': str(source_save), 'sha256': save_sha256, 'bytes': len(save_bytes),
                                 'provenance': 'private battery-save copy loaded before native reset; source never opened by emulator'}
        self.out = Path(out).resolve()
        # Require a fresh output directory: never reuse another run's saves.
        self.out.mkdir(parents=True, exist_ok=False)
        self.rom = Path(rom).resolve()
        self.game_version = hashlib.sha256(self.rom.read_bytes()).hexdigest()
        self.session_id = uuid.uuid4().hex
        self.max_frames, self.timeout = max_frames, timeout
        self.frame, self.sequence, self.checkpoints = 0, 0, {}
        self.native_counter = 0
        self.watches = []
        self.metrics = {'command_count': {}, 'command_wall_s': {}, 'png_wall_s': 0., 'rgba_read_wall_s': 0.}
        self.memory_profile = None
        if memory_profile:
            profile = json.loads(Path(memory_profile).read_text())
            if profile.get('rom_sha256') != self.game_version:
                raise ValueError('memory_profile_rom_mismatch')
            self.memory_profile = profile
        if not Path(binary).is_file():
            raise ValueError('native_session_binary_unavailable: run make -C tools/re/session with MGBA_PREFIX for installed mGBA')
        self.binary_sha256 = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
        self.mailbox_profile = None
        native_args = [str(Path(binary).resolve()), str(self.rom), str(self.out)]
        if mailbox_profile:
            profile = json.loads(Path(mailbox_profile).read_text()) if isinstance(mailbox_profile, (str, Path)) else dict(mailbox_profile)
            if profile.get('rom_sha256') != self.game_version:
                raise ValueError('mailbox_profile_rom_mismatch')
            elf = Path(profile['elf']['path'])
            if hashlib.sha256(elf.read_bytes()).hexdigest() != profile['elf']['sha256']:
                raise ValueError('mailbox_profile_elf_mismatch')
            from tools.whole_game.elf_symbols import symbol
            address, size = symbol(elf, 'gWholeGameBridge')
            if profile['address'] != address or profile['bytes'] != size:
                raise ValueError('mailbox_profile_symbol_mismatch')
            self.mailbox_profile = profile
            main_address, main_size = symbol(elf, 'gMain')
            if main_size < 8 or not 0x03000000 <= main_address + 4 <= 0x03008000 - 4:
                raise ValueError('invalid_source_callback_address')
            native_args += [str(address), str(size), str(main_address + 4)]
        if callback_profile:
            if mailbox_profile:
                raise ValueError('conflicting_source_watch_profiles')
            profile = dict(callback_profile)
            elf = Path(profile['elf']['path'])
            if profile['rom_sha256'] != self.game_version or hashlib.sha256(elf.read_bytes()).hexdigest() != profile['elf']['sha256']:
                raise ValueError('callback_profile_artifact_mismatch')
            from tools.whole_game.elf_symbols import symbol
            address, size = symbol(elf, 'gMain')
            if size < 8 or not 0x03000000 <= address + 4 <= 0x03008000 - 4:
                raise ValueError('callback_profile_symbol_mismatch')
            native_args += ['--callback-watch', str(address + 4)]
        if save_bytes is not None:
            private_save = self.out / 'initial-battery.sav'
            private_save.write_bytes(save_bytes)
            native_args += ['--initial-save', str(private_save)]
        self.callback_profile = callback_profile
        self.recording = None
        self.process = subprocess.Popen(native_args,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                        bufsize=0)
        try:
            self._read()
            version, frequency, cycles = self._command('version').split()
            self.emulator = {'name': 'libmgba', 'version': version,
                             'frequency_hz': int(frequency), 'frame_cycles': int(cycles),
                             'bios': 'mGBA HLE; skipBios=true', 'rtc': 'fixed 2024-01-01 UTC'}
            if initial_state:
                source = Path(initial_state).resolve()
                shutil.copyfile(source, self.out / 'checkpoint-0.ss')
                self._command('load 0')
                loaded_counter = self.native_counter
                # A raw state contains no framebuffer. Render one real frame;
                # include it in relative frame accounting, rather than show blank pixels.
                self.native_counter = int(self._command('step 0 1'))
                self.frame = 1
                self.initial_state = {'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                                      'source_frame': None, 'loaded_session_native_counter': loaded_counter,
                                      'render_integration_frames': 1, 'provenance': 'exact caller state loaded before one explicit native framebuffer integration frame'}
            else:
                self.initial_state = None
        except BaseException:
            self.close()
            raise

    def _read(self):
        if not select.select([self.process.stdout], [], [], self.timeout)[0]:
            raise ValueError('native_timeout')
        line = self.process.stdout.readline(4096)
        if not line.startswith(b'OK '):
            raise ValueError('native_failed')
        return line[3:].decode().strip()

    def _command(self, text):
        started = time.monotonic()
        try:
            self.process.stdin.write((text + '\n').encode())
            self.process.stdin.flush()
            return self._read()
        finally:
            operation = text.split()[0]
            self.metrics['command_count'][operation] = self.metrics['command_count'].get(operation, 0) + 1
            self.metrics['command_wall_s'][operation] = self.metrics['command_wall_s'].get(operation, 0.) + time.monotonic() - started

    def observe(self):
        self._command('frame')
        started = time.monotonic()
        raw = (self.out / 'frame.rgba').read_bytes()
        self.metrics['rgba_read_wall_s'] += time.monotonic() - started
        if len(raw) != 240 * 160 * 4:
            raise ValueError('invalid_frame')
        self.sequence += 1
        target = self.out / ('observation-%06d.png' % self.sequence)
        started = time.monotonic()
        target.write_bytes(png(raw))
        self.metrics['png_wall_s'] += time.monotonic() - started
        # Quantized 30x20 screen sample. Animation can still cause false novelty.
        coarse = bytes((raw[(y * 240 + x) * 4 + c] // 32)
                       for y in range(4, 160, 8) for x in range(4, 240, 8) for c in range(3))
        facts, phase = {}, 'unknown'
        if self.memory_profile:
            facts = self.read_facts()
            for rule in self.memory_profile.get('phase_rules', []):
                if all(facts.get(k) == v for k, v in rule.get('equals', {}).items()):
                    phase = rule['phase']
                    break
        return {'frame': self.frame, 'state_key': hashlib.sha256(coarse).hexdigest(),
                'image': str(target), 'phase': phase, 'facts': facts, 'progress': {},
                'terminal': False, 'success': False,
                'evidence': {'image_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                             'state_key_basis': 'quantized_screen_only; animation is not objective progress',
                             'frame_basis': 'session-relative advanced frames', 'initial_state': self.initial_state,
                             'initial_save': self.initial_save,
                             'memory_profile': self.memory_profile}}

    def read_memory(self, address, length):
        if (type(address) is not int or type(length) is not int or not 1 <= length <= 256 or
                not any(base <= address and address + length <= end
                        for base, end in ((0x02000000, 0x02040000), (0x03000000, 0x03008000)))):
            raise ValueError('invalid_ram_range')
        raw = bytes.fromhex(self._command('read %d %d' % (address, length)))
        if len(raw) != length:
            raise ValueError('invalid_ram_response')
        return raw

    def write_mailbox(self, offset, data):
        """Source transport only; no public JSONL write operation is exposed."""
        profile = self.mailbox_profile
        if not profile or type(offset) is not int or not isinstance(data, bytes) or not data or not 0 <= offset <= profile['bytes'] - len(data):
            raise ValueError('invalid_mailbox_write')
        for start in range(0, len(data), 64):
            chunk = data[start:start + 64]
            self._command('write %d %d %s' % (profile['address'] + offset + start, len(chunk), chunk.hex()))
        self.restored_observation = None

    def read_facts(self):
        facts = {}
        for field in self.memory_profile.get('fields', []):
            size = field['bytes']
            if size not in (1, 2, 4) or type(field.get('name')) is not str:
                raise ValueError('invalid_memory_profile')
            address = int(field['address'], 0) if isinstance(field['address'], str) else field['address']
            raw = self.read_memory(address, size)
            facts[field['name']] = int.from_bytes(raw, 'little', signed=field.get('signed', False))
        array = self.memory_profile.get('native_sprite_array')
        if array:
            count, stride = array['count'], array['stride']
            if type(count) is not int or not 1 <= count <= 24 or type(stride) is not int or not 1 <= stride <= 256:
                raise ValueError('invalid_sprite_array_profile')
            base = int(array['address'], 0)
            sprites = []
            for slot in range(count):
                raw = self.read_memory(base + slot * stride, stride)
                sprite = {'ram_slot': slot}
                for field in array['fields']:
                    offset, size = field['offset'], field['bytes']
                    if type(offset) is not int or size not in (1, 2, 4) or not 0 <= offset <= stride - size:
                        raise ValueError('invalid_sprite_field_profile')
                    sprite[field['name']] = int.from_bytes(raw[offset:offset + size], 'little', signed=field.get('signed', False))
                sprites.append(sprite)
            facts['native_sprites'] = sprites
        ledger = self.memory_profile.get('defeated_identity_array')
        if ledger:
            count = ledger['count']
            if type(count) is not int or not 1 <= count <= 128:
                raise ValueError('invalid_ledger_profile')
            base = int(ledger['address'], 0)
            raw = b''.join(self.read_memory(base + offset, min(256, count * 4 - offset)) for offset in range(0, count * 4, 256))
            facts['gv_defeated_identities'] = [int.from_bytes(raw[i:i + 4], 'little') for i in range(0, len(raw), 4)]
        return facts

    def start_recording(self, stride=2):
        if self.recording or type(stride) is not int or not 1 <= stride <= 6:
            raise ValueError('invalid_recording')
        self._command('record 1 %d' % stride)
        self.recording = {'start_frame': self.frame, 'stride': stride, 'audio': False,
                          'description': 'Actual emulator frames, no synthetic interpolation; audio not recorded'}
        return dict(self.recording)

    def stop_recording(self):
        if not self.recording:
            raise ValueError('not_recording')
        recorded = int(self._command('record 0'))
        report = dict(self.recording, end_frame=self.frame, recorded_frames=recorded)
        self.recording = None
        raw = self.out / 'video.rgba'
        output = self.out / 'playthrough.mp4'
        fps = self.emulator['frequency_hz'] / self.emulator['frame_cycles'] / report['stride']
        started = time.monotonic()
        result = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
                                 '-video_size', '240x160', '-framerate', str(fps), '-i', str(raw), '-an',
                                 '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p',
                                 '-threads', '1', str(output)], capture_output=True, timeout=60)
        report.update(encode_wall_s=round(time.monotonic() - started, 6), fps=fps,
                      path=str(output), outcome='ok' if result.returncode == 0 else 'encode_failed')
        if result.returncode == 0:
            report['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
            report['bytes'] = output.stat().st_size
            raw.unlink()
        return report

    def configure_watches(self, watches):
        """Version-pinned adapter supplies named read-only source boundaries."""
        if not isinstance(watches, list) or len(watches) > 32:
            raise ValueError('invalid_source_watches')
        for watch in watches:
            address, width, mask = watch.get('address'), watch.get('bytes'), watch.get('mask')
            if (type(address) is not int or width not in (1, 2, 4) or type(mask) is not int or
                not 0 < mask < 1 << (width * 8) or not isinstance(watch.get('name'), str) or
                not any(base <= address <= end - width for base, end in
                        ((0x02000000, 0x02040000), (0x03000000, 0x03008000)))):
                raise ValueError('invalid_source_watch')
        self._command('unwatch')
        for watch in watches:
            self._command('watch %d %d %d' % (watch['address'], watch['bytes'], watch['mask']))
        self.watches = copy.deepcopy(watches)

    def _step(self, mask, frames):
        response = self._command('%s %d %d' % ('stepw' if self.watches else 'step', mask, frames)).split()
        hit = int(response[1]) if self.watches else -1
        return int(response[0]), (self.watches[hit]['name'] if hit >= 0 else None)

    def act(self, action, limit):
        frames, keys = action.get('frames'), action.get('keys', [])
        if (type(frames) is not int or not 1 <= frames <= min(limit, self.max_frames)
                or not isinstance(keys, list) or any(key not in KEYS for key in keys)):
            raise ValueError('invalid_action')
        mask = 0
        for key in keys:
            mask |= KEYS[key]
        # A source-game button probe ends with one sampled key-up frame so
        # consecutive model taps are distinct GBA newKeys events. The release
        # stays inside the requested frame budget. Export breakpoint wins.
        press_frames = frames - 1 if (self.mailbox_profile or self.callback_profile) and keys and frames > 1 else frames
        counter, boundary = self._step(mask, press_frames)
        if not boundary and press_frames < frames and counter - self.native_counter == press_frames:
            counter, boundary = self._step(0, 1)
        advanced = counter - self.native_counter
        if not 0 < advanced <= frames:
            raise ValueError('invalid_native_frame_receipt')
        self.native_counter = counter
        self.frame += advanced
        return {'frames': advanced, 'source_breakpoint': advanced < frames or boundary is not None,
                'decision_boundary': boundary}

    def close(self):
        process = getattr(self, 'process', None)
        if process is None:
            return
        try:
            if process.poll() is None:
                process.stdin.write(b'close\n'); process.stdin.flush()
                process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            process.kill(); process.wait(timeout=2)
        finally:
            process.stdin.close(); process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--game-id', help='Stable corpus ID, independent of ROM filename')
    parser.add_argument('--out', type=Path, required=True, help='Fresh private directory; must not already exist')
    parser.add_argument('--binary', type=Path, default=Path(__file__).parent / 'build/gba-session')
    parser.add_argument('--initial-state', type=Path)
    parser.add_argument('--initial-save', type=Path)
    parser.add_argument('--initial-save-sha256')
    parser.add_argument('--memory-profile', type=Path, help='ROM-hash-pinned, read-only RAM facts and source refs')
    parser.add_argument('--max-action-frames', type=int, default=120)
    parser.add_argument('--command-timeout', type=float, default=10)
    args = parser.parse_args()
    if not 1 <= args.max_action_frames <= 120 or not 0 < args.command_timeout <= 30:
        parser.error('invalid bounded session limits')
    session = None
    try:
        session = NativeSession(args.rom, args.out, args.binary, max_frames=args.max_action_frames,
                                timeout=args.command_timeout, initial_state=args.initial_state, initial_save=args.initial_save,
                                expected_initial_save_sha256=args.initial_save_sha256, memory_profile=args.memory_profile)
        while True:
            raw = sys.stdin.buffer.readline(65537)
            if not raw:
                break
            identity = None
            close = False
            try:
                if len(raw) > 65536:
                    raise ValueError('request_size_limit')
                request = json.loads(raw)
                identity = request.get('id')
                op = request.get('op')
                if op == 'hello':
                    result = {'schema_version': 1, 'adapter_version': VERSION, 'session_id': session.session_id,
                              'isolated': True, 'game_id': args.game_id or args.rom.stem, 'game_version': session.game_version,
                              'capabilities': ['observe', 'act', 'checkpoint', 'restore'], 'max_action_frames': session.max_frames,
                              'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                              'native_sha256': hashlib.sha256(args.binary.read_bytes()).hexdigest()}
                    result['emulator'] = session.emulator
                    result['capabilities'] += ['read_memory', 'record_start', 'record_stop']
                elif op == 'observe':
                    result = copy.deepcopy(session.restored_observation) if getattr(session, 'restored_observation', None) else session.observe()
                elif op == 'act':
                    limit = request.get('max_frames', session.max_frames)
                    if type(limit) is not int or limit < 1:
                        raise ValueError('invalid_action_limit')
                    result = session.act(request['action'], limit)
                    session.restored_observation = None
                elif op == 'checkpoint':
                    slot = len(session.checkpoints) + 1
                    if slot >= 32:
                        raise ValueError('checkpoint_limit')
                    session._command('save %d' % slot)
                    token = uuid.uuid4().hex
                    observation = session.observe()
                    session.checkpoints[token] = (slot, session.frame, observation)
                    result = {'checkpoint': token, 'frame': session.frame,
                              'state_path': str(session.out / ('checkpoint-%d.ss' % slot))}
                elif op == 'read_memory':
                    result = {'hex': session.read_memory(request['address'], request['length']).hex(), 'frame': session.frame}
                elif op == 'record_start':
                    result = session.start_recording(request.get('stride', 2))
                elif op == 'record_stop':
                    result = session.stop_recording()
                elif op == 'restore':
                    slot, frame, observation = session.checkpoints[request['checkpoint']]
                    session._command('load %d' % slot)
                    session.frame = frame
                    session.restored_observation = copy.deepcopy(observation)
                    result = {'frame': frame}
                elif op == 'close':
                    result, close = {}, True
                else:
                    raise ValueError('unsupported_operation')
                response = {'id': identity, 'ok': True, 'result': result}
            except Exception:
                response = {'id': identity, 'ok': False, 'error': 'invalid_request_or_session_failure'}
            print(json.dumps(response), flush=True)
            if close:
                break
    finally:
        if session:
            session.close()


if __name__ == '__main__':
    main()
