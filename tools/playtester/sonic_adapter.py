"""Read-only Sonic/MZM native state decoding over the existing mGBA session.

Addresses and widths follow the independently recovered Sonic USA actor ABI and
the pinned composition's task-owned state. Actions are actual GBA buttons.
"""
from __future__ import annotations
import hashlib
import copy
from pathlib import Path
from tools.re.session.bridge import NativeSession

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'sonic-native-traversal/1'


class SonicTraversalAdapter:
    def __init__(self, rom, out, initial_state, *, expected_rom_sha256=None):
        rom = Path(rom).resolve()
        actual = hashlib.sha256(rom.read_bytes()).hexdigest()
        if expected_rom_sha256 is not None and actual != expected_rom_sha256:
            raise ValueError('sonic_candidate_rom_mismatch')
        self.inner = NativeSession(rom, out, ROOT / 'tools/re/session/build/gba-session', initial_state=initial_state)
        self.tokens = {}

    def hello(self):
        return {'schema_version': 1, 'adapter_version': VERSION,
            'session_id': self.inner.session_id, 'isolated': True,
            'game_id': 'sonic-metroid-signal-descent', 'game_version': self.inner.game_version,
            'capabilities': ['observe', 'act', 'checkpoint', 'restore'], 'max_action_frames': 120,
            'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'native_sha256': self.inner.binary_sha256, 'emulator': self.inner.emulator,
            'scenario': 'Bounded original native campaign traversal; explicit scripted checkpoint setup; no full campaign completion claim'}

    def _read(self, address, count=4, signed=False):
        return int.from_bytes(self.inner.read_memory(address, count), 'little', signed=signed)

    def observe(self):
        if getattr(self, "restored_observation", None) is not None:
            return copy.deepcopy(self.restored_observation)
        observation = self.inner.observe()
        actor = self.inner.read_memory(0x03005a20, 112)
        def field(offset, count=2, signed=False):
            return int.from_bytes(actor[offset:offset+count], 'little', signed=signed)
        facts = {'player_position_q8': {'x': field(0, 4, True), 'y': field(4, 4, True)},
            'x': field(0, 4, True)/256, 'y': field(4, 4, True)/256,
            'vx': field(8, 2, True), 'vy': field(10, 2, True), 'speed': field(12, 2, True),
            'flags': field(16, 4), 'angle': field(20, 1), 'plane': field(39, 1),
            'pose': field(64, 1), 'character': field(89, 1), 'player_task': field(96, 4),
            'stage': self._read(0x0300514c, 1), 'held_keys': self._read(0x03001b50, 2)}
        facts['grounded'] = not bool(facts['flags'] & 2)
        facts['attached_to_native_object'] = facts['flags'] & 0x400008 == 0x400008
        state = None
        task = self._read(0x03001220)
        handles = []
        visited = set()
        for _ in range(128):
            if task in visited or task & 3 or not 0x03000000 <= task <= 0x03008000-20:
                break
            visited.add(task)
            record = self.inner.read_memory(task, 20)
            value = lambda offset, width: int.from_bytes(record[offset:offset+width], 'little')
            offset, callback = value(6, 2), value(8, 4)
            data = 0x03000000 + offset
            if value(18, 2) & 2 and value(16, 2) == 0xff00 and 0 < offset <= 0x8000-1600 and self._read(data) == 0x324d5647:
                state = data
            if callback == 0x08087641 and 0 < offset <= 0x8000-184:
                handles.append({'task': task, 'screen_x': self._read(data+162, 2),
                    'screen_y': self._read(data+164, 2), 'attached_mask': self._read(data+180, 1)})
            task = 0x03000000 + value(4, 2)
        facts['native_moving_handles'] = handles
        if state is not None:
            raw = b''.join(self.inner.read_memory(state+offset, min(256, 1600-offset)) for offset in range(0,1600,256))
            def owned(offset, width=2):
                return int.from_bytes(raw[offset:offset+width], 'little')
            facts['campaign_state_pointer'] = state
            for name, offset, width in [('native_frame',4,4),('upgrades',8,4),('visited',12,4),
                ('energy',24,2),('max_energy',26,2),('missiles',28,2),('max_missiles',30,2),
                ('shots_fired',44,2),('shots_hit',46,2),('native_kills',48,2),('alien_kills',50,2),
                ('gates_opened',52,2),('relics_collected',54,2),('damage_taken',56,2),('deaths',58,2),
                ('morph',177,1),('ledge',178,1),('momentum',180,1),('wall_kicks',182,1),('ledge_grabs',183,1),
                ('active',185,1),('relay_trips',1000,2),('mzm_impact_calls',1246,2),('mzm_impact_deaths',1248,2)]:
                facts[name] = owned(offset, width)
            facts['picked'] = [owned(60+i*2) for i in range(18)]
            facts['opened'] = [owned(96+i*2) for i in range(18)]
            facts['source_equipment'] = {'beam_bits': owned(1536,1), 'ability_bits': owned(1537,1),
                'event_words': [owned(1540+i*4,4) for i in range(8)]}
        else:
            facts['campaign_state_unavailable'] = 'No bounded matching task-owned state found; no guessed fallback address'
        facts['source_refs'] = ['tools/composition/components/sonic_metroid/game.h',
            'research/requests/sonic-native-traversal-contract.json',
            'research/deep-extraction/sonic-metroid/strategy.json']
        observation['facts'] = facts
        observation['progress'] = {name: facts[name] for name in ['x','y','stage','plane','upgrades','energy','missiles','gates_opened','relics_collected','deaths'] if name in facts}
        observation['phase'] = 'native_factory2_traversal' if facts['stage'] == 3 else 'native_campaign_traversal'
        observation['evidence']['decoder'] = VERSION
        self.last_observation = copy.deepcopy(observation)
        return observation

    def act(self, action, max_frames):
        # Profile jump actions mean a fresh A press, followed by held jump.
        # Sample its release within the selected frame budget; retain direction
        # and aim. B remains held so the source charge/release lifecycle works.
        frames, keys = action.get('frames'), action.get('keys', [])
        if 'A' in keys and type(frames) is int and 1 < frames <= min(max_frames, 120):
            first = self.inner.act(dict(action, keys=[key for key in keys if key != 'A'], frames=1), max_frames)
            second = self.inner.act(dict(action, frames=frames-1), max_frames-first['frames'])
            result = {'frames': first['frames']+second['frames'], 'sampled_A_release_frames': 1}
        else:
            result = self.inner.act(action, max_frames)
        self.restored_observation = None
        return result

    def checkpoint(self):
        if len(self.tokens) >= 64:
            raise ValueError('checkpoint_limit')
        observation = self.observe()
        index = len(self.tokens) + 1
        token = 'sonic-checkpoint-' + str(index)
        self.inner._command('save ' + str(index))
        self.tokens[token] = (index, self.inner.frame, self.inner.native_counter, copy.deepcopy(observation))
        path = self.inner.out / ('checkpoint-' + str(index) + '.ss')
        return {'checkpoint': token, 'frame': self.inner.frame,
            'path': str(path), 'state_path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    def restore(self, token):
        index, frame, counter, observation = self.tokens[token]
        self.inner._command('load ' + str(index))
        self.inner.frame, self.inner.native_counter = frame, counter
        self.restored_observation = copy.deepcopy(observation)
        return {'checkpoint': token, 'frame': frame}

    def close(self):
        self.inner.close()
