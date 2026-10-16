"""Pinned provider boundary for the recovered SID RPG navigator.

The game provider owns RAM layouts/passability. This module reuses Bot.plan and
Bot.passable unchanged; model confidence and resource policies stay in core.py.
No external source, ROM, save, compiler, or emulator binary is distributed here.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import uuid

from .core import digest, require

VERSION = 'sid-rpg-navigation/2'
EVENT_SOURCE_REFS = ('src/field_message_box.c', 'src/field_screen_effect.c', 'src/scrcmd.c', 'src/text.c', 'src/match_call.c')
SOURCE_POIS = 'source-live-pois/1'


class _NavigationBoundary(Exception):
    def __init__(self, reason): self.reason = reason
PROVIDER_SCHEMA = 'gameverse.sid-rpg-provider/1'


def pin(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def checked(ref, root=None):
    require(isinstance(ref, dict) and isinstance(ref.get('path'), str), 'invalid_rpg_provider_reference')
    path = Path(ref['path']).resolve()
    require(root is None or path.is_relative_to(root), 'rpg_provider_outside_declared_root')
    require(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == ref.get('sha256'),
            'rpg_provider_hash_mismatch')
    return path


def source_tree_identity(root):
    paths = []
    for relative in ('data/maps', 'data/layouts', 'data/tilesets', 'data/scripts/sid', 'data/text', 'include', 'src/data/region_map'):
        paths.extend(p for p in (root / relative).rglob('*') if p.is_file())
    hasher = hashlib.sha256()
    for path in sorted(paths):
        hasher.update(str(path.relative_to(root)).encode() + b'\0')
        hasher.update(hashlib.sha256(path.read_bytes()).digest())
    return {'sha256': hasher.hexdigest(), 'files': len(paths),
            'scope': 'data/maps,data/layouts,data/tilesets,data/scripts/sid,data/text,include,src/data/region_map'}


def provider_manifest(root, *, rom, elf, save=None):
    """Explicit local installation manifest; callers retain/pin this JSON."""
    root = Path(root).resolve()
    sid = root / 'dev_scripts/sid'
    result = {'schema': PROVIDER_SCHEMA, 'provider_root': str(root),
        'game_id': 'siddarth-emerald', 'rom': pin(rom), 'elf': pin(elf),
        'source_tree': source_tree_identity(root),
        'sources': {name: pin(sid / name) for name in ('sidbot.py', 'world.py', 'battler.py')},
        'source_inputs': {name: pin(root / name) for name in ('charmap.txt', 'dev_scripts/sid/objectives.json') + EVENT_SOURCE_REFS},
        'capability_scope': 'SID Emerald source ABI only; not an unqualified FireRed adapter'}
    # Recovered compiler and cached constant results remain an explicit local dependency.
    toolbin = root / '.toolchain/arm-gnu-toolchain-13.3.rel1-darwin-arm64-arm-none-eabi/bin'
    result['tools'] = {name: pin(toolbin / name) for name in ('arm-none-eabi-nm', 'arm-none-eabi-gcc')}
    if save:
        result['initial_save'] = pin(save)
    return result


def load_provider(manifest, cache):
    require(manifest.get('schema') == PROVIDER_SCHEMA, 'invalid_rpg_provider_schema')
    root = Path(manifest['provider_root']).resolve()
    require(manifest.get('source_tree') == source_tree_identity(root), 'rpg_provider_source_tree_mismatch')
    sources = {name: checked(ref, root) for name, ref in manifest['sources'].items()}
    require(set(sources) == {'sidbot.py', 'world.py', 'battler.py'}, 'invalid_rpg_provider_sources')
    require(set(EVENT_SOURCE_REFS) <= set(manifest.get('source_inputs', {})), 'missing_rpg_event_source_pins')
    for ref in manifest['source_inputs'].values(): checked(ref, root)
    require(set(manifest.get('tools', {})) == {'arm-none-eabi-nm', 'arm-none-eabi-gcc'}, 'missing_rpg_provider_tool_pins')
    for ref in manifest['tools'].values(): checked(ref, root)
    # SID imports these conventional module names. Refuse conflicting providers.
    for name in ('world', 'battler'):
        if name in sys.modules:
            require(Path(sys.modules[name].__file__).resolve() == sources[name + '.py'], 'rpg_provider_module_conflict')
    sid_dir = str(sources['sidbot.py'].parent)
    sys.path.insert(0, sid_dir)
    previous_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location('gameverse_pinned_sidbot', sources['sidbot.py'])
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        require(Path(module.world.__file__).resolve() == sources['world.py']
                and Path(module.battler.__file__).resolve() == sources['battler.py'], 'rpg_provider_import_pin_mismatch')
    finally:
        sys.dont_write_bytecode = previous_bytecode
        # sidbot also inserts HERE; remove only the known entries we inserted.
        while sid_dir in sys.path: sys.path.remove(sid_dir)
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    # Never trust external cached constants; rebuild from pinned source/compiler
    # once per run, entirely under the isolated output directory.
    module.world.CACHE = str(cache)
    return module


class NativeEmu:
    """SID's read/hold interface over the already checkpointable native session."""
    def __init__(self, session, rom):
        self.session, self.rom = session, Path(rom).read_bytes()

    @property
    def frames(self): return self.session.frame

    def peek(self, address, count):
        require(type(address) is int and type(count) is int and 0 < count <= 1024 * 1024,
                'invalid_rpg_memory_read')
        if 0x08000000 <= address and address + count <= 0x08000000 + len(self.rom):
            return self.rom[address - 0x08000000:address - 0x08000000 + count]
        # The provider cannot use this bridge to read IO or mutate game memory.
        return b''.join(self.session.read_memory(address + offset, min(256, count - offset))
                        for offset in range(0, count, 256))

    def hold(self, keys, count):
        self.session.act({'keys': keys.split('+') if keys else [], 'frames': count}, count)

    def close(self): self.session.close()


class RPGNavigationAdapter:
    def __init__(self, game, emu, planner, *, game_id, game_version, provider_identity,
                 targets=(), max_option_frames=600, session=None, navigation_policy=None):
        require(type(max_option_frames) is int and 1 <= max_option_frames <= 3600, 'invalid_rpg_option_limit')
        require(navigation_policy in (None, SOURCE_POIS), 'unsupported_rpg_navigation_policy')
        self.navigation_policy = navigation_policy
        self.game, self.emu, self.planner = game, emu, planner
        self.session = session
        self.game_id, self.game_version = game_id, game_version
        self.provider_identity = provider_identity
        self.targets = copy.deepcopy(list(targets))
        require(len(self.targets) <= 64, 'rpg_target_limit')
        seen = set()
        for target in self.targets:
            require(isinstance(target.get('id'), str) and 0 < len(target['id']) <= 110 and target['id'] not in seen
                    and isinstance(target.get('map'), str) and isinstance(target.get('position'), list)
                    and len(target['position']) == 2 and all(type(v) is int for v in target['position']), 'invalid_rpg_target')
            seen.add(target['id'])
        self.max_option_frames = max_option_frames
        self.session_id = getattr(session, 'session_id', uuid.uuid4().hex)
        self.boundary, self.tokens, self.closed = None, {}, False
        self.preparation = None
        self.route_steps = 0
        self.last_state = None
        self.restored_image = None
        self.field_free_settle_remaining = 0

    @classmethod
    def open(cls, manifest, output, *, binary, targets=(), initial_state=None, max_option_frames=600, navigation_policy=None):
        from tools.re.session.bridge import NativeSession
        output = Path(output)
        rom, elf = checked(manifest['rom']), checked(manifest['elf'])
        binary_path = checked(binary)
        resume_state = None
        if initial_state:
            require(isinstance(initial_state, dict) and initial_state.get('game_version') == manifest['rom']['sha256'],
                    'rpg_checkpoint_game_version_mismatch')
            resume_state = checked(initial_state)
        save = checked(manifest['initial_save']) if manifest.get('initial_save') and not initial_state else None
        provider = load_provider(manifest, output / 'provider-cache')
        kwargs = {'max_frames': max_option_frames, 'initial_state': resume_state}
        if save:
            kwargs['initial_save'] = save
            kwargs['expected_initial_save_sha256'] = manifest['initial_save']['sha256']
        session = NativeSession(rom, output / 'native', binary_path, **kwargs)
        try:
            emu = NativeEmu(session, rom)
            game = provider.Game(emu, str(elf))
            planner = provider.Bot.__new__(provider.Bot)
            planner.game, planner.emu, planner.blocked_edges = game, emu, set()
            planner.opts = {'run': 'on', 'interrupt': 'stop', 'exits': 'on'}
            planner.tracef = None
            planner.log = lambda message: None
            planner.tr = lambda *args, **kwargs: None
            result = cls(game, emu, planner, game_id=manifest['game_id'], game_version=manifest['rom']['sha256'],
                provider_identity=digest(manifest), targets=targets, max_option_frames=max_option_frames, session=session, navigation_policy=navigation_policy)
            result.provider_manifest = copy.deepcopy(manifest)
            result.provider = provider
            result.battle_data = None
            if initial_state and initial_state.get('navigation_state'):
                result.restore_navigation(initial_state['navigation_state'])
            return result
        except BaseException:
            session.close()
            raise

    def hello(self):
        capabilities = ['observe', 'act', 'navigation_grid', 'battle_state']
        if self.session is not None: capabilities += ['checkpoint', 'restore']
        return {'schema_version': 1, 'adapter_version': VERSION, 'session_id': self.session_id,
            'isolated': True, 'game_id': self.game_id, 'game_version': self.game_version,
            'capabilities': capabilities, 'max_action_frames': self.max_option_frames,
            'provider_manifest_sha256': self.provider_identity, 'navigation_policy': self.navigation_policy,
            'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'emulator': getattr(self.session, 'emulator', None),
            'knowledge': 'Recovered SID provider live RAM collision/elevation/objects/warps; no inferred tilemap',
            'preparation': self.preparation}

    def prepare(self, actions, *, max_frames):
        """Explicit bounded source-specific boot recipe, separate from measured play."""
        used = 0
        for action in actions:
            count = action['frames']
            require(type(count) is int and count > 0 and used + count <= max_frames, 'rpg_preparation_frame_limit')
            for offset in range(0, count, self.max_option_frames):
                self.emu.hold('+'.join(action.get('keys', [])), min(self.max_option_frames, count - offset))
            used += count
        self.preparation = {'frames': used, 'recipe_sha256': digest(actions), 'scope': 'isolated checkpoint setup; excluded from play frames'}
        return self.preparation

    def _state(self):
        state = self.game.state()
        # Reload even within a map: scripts can open doors or change collision.
        if state.get('free') and state.get('x') is not None:
            self.game.reload_grid()
            self.game.grid_key = state['map']
        return state

    def _live_poi_options(self, state):
        """The recovered provider owns discovery and dynamic NPC visibility."""
        pois = self.planner.live_pois(state)
        require(len(pois) <= 128, 'rpg_source_poi_limit')
        result = []
        for poi in pois:
            identity = {key: poi.get(key) for key in ('map', 'kind', 'label', 'local_id', 'script', 'dir')}
            result.append({'id': 'poi:' + digest(identity)[:24],
                'description': ('%s %s at (%d,%d). %s' % (poi['kind'], poi['label'], poi['x'], poi['y'], poi.get('says', '')))[:2000],
                'keys': [], 'frames': self.max_option_frames, 'target': copy.deepcopy(poi),
                'continue_until_target': True, 'semantic': 'source_poi_choice'})
        # Reading/interacting remains a semantic choice even when routes exist.
        # This also lets a model inspect or use a source object not classified as a POI.
        result.append({'id': 'interact:facing', 'description': 'Interact with the object currently faced using A',
            'keys': [], 'frames': min(120, self.max_option_frames), 'input_key': 'A', 'semantic': 'interaction'})
        return result

    def _execute_source_poi(self, poi, start, budget):
        """Run original place/path code, intercepting before any old policy.

        Every emulator frame is bounded and observed. Scene transitions unwind
        the recovered call stack immediately, before untilfree/ask/battle logic.
        """
        initial = self.game.state()
        initial_map = initial['map']
        position = [initial.get('x'), initial.get('y')]
        traveled = [0]
        def tick(keys=None, n=1):
            for _ in range(n):
                if self.emu.frames - start >= budget: raise _NavigationBoundary('option_budget')
                self.emu.hold(keys, 1)
                state = self.game.state()
                if state['map'] != initial_map: raise _NavigationBoundary('map_transition')
                if all(type(v) is int for v in position + [state.get('x'), state.get('y')]):
                    traveled[0] += abs(state['x'] - position[0]) + abs(state['y'] - position[1])
                position[:] = [state.get('x'), state.get('y')]
                if not state.get('free'):
                    raise _NavigationBoundary('battle' if state.get('in_battle') else 'menu' if state.get('menu') else 'script')
            return state
        def stop(*args, **kwargs): raise _NavigationBoundary('source_navigation_unresolved')
        self.planner.tick, self.planner.escalate, self.planner.untilfree = tick, stop, stop
        try:
            self.planner.use_poi(copy.deepcopy(poi))
            self.boundary = 'source_poi_completed'
        except _NavigationBoundary as boundary:
            self.boundary = boundary.reason
        # No old model client exists on the minimally initialized provider Bot.
        return traveled[0]

    def _event_mode(self, state):
        """Only positively source-defined, nonsemantic field operations.

        Menus and battles always return to their semantic options first. A field
        message merely existing does not mean its printer is ready for a key.
        """
        if (state.get('in_battle') or state.get('menu')
                or any(any(token in task for token in ('Menu', 'Choose', 'Choice', 'YesNo')) for task in state.get('tasks', []))):
            return None
        if state.get('free'):
            return ('wait', 'recovered_untilfree_eight_samples_two_frames_neutral_settle') if self.field_free_settle_remaining else None
        if state.get('printer_wait') or state.get('script_native') == 'WaitForAorBPress':
            return ('advance', 'source_text_printer_wait_or_scrcmd_waitbuttonpress')
        tasks = set(state.get('tasks', []))
        raw = getattr(self.game, 'task_raw', {}).get('ExecuteMatchCall')
        match_stage = struct.unpack_from('<h', raw, 8)[0] if raw and len(raw) >= 10 else None
        if ('ExecuteMatchCall' in tasks and match_stage == 5 and not state.get('printer_char')):
            return ('advance', 'source_match_call_printmessage_complete_requires_new_a_or_b')
        if (tasks & {'Task_WarpAndLoadMap', 'Task_ExitDoor', 'Task_AnimateDoor'}
                or state.get('cb2') in ('CB2_DoChangeMap', 'CB2_LoadMap', 'CB2_LoadMap2')):
            return ('wait', 'source_map_transition_task_has_no_input_choice')
        if (tasks & {'Task_DrawFieldMessage', 'Task_HidePokenavMessageWhenDone', 'ExecuteMatchCall'}):
            return ('wait', 'source_field_message_or_match_call_rendering_not_key_ready')
        return None

    def _event_progress(self, state):
        task_stages = {}
        for name in ('Task_WarpAndLoadMap', 'Task_ExitDoor', 'Task_AnimateDoor',
                     'Task_DrawFieldMessage', 'Task_HidePokenavMessageWhenDone', 'ExecuteMatchCall'):
            raw = getattr(self.game, 'task_raw', {}).get(name)
            if raw and len(raw) >= 10: task_stages[name] = struct.unpack_from('<h', raw, 8)[0]
        return {'field_free_settle_remaining': self.field_free_settle_remaining, 'printer_char': state.get('printer_char'), 'printer_wait': state.get('printer_wait'),
                'script_status': state.get('script_status'), 'script_native': state.get('script_native'),
                'script_ptr': state.get('script_ptr'), 'msgbox': state.get('msgbox'),
                'task_stages': task_stages, 'tasks': state.get('tasks', []),
                'cb1': state.get('cb1'), 'cb2': state.get('cb2')}

    def _event_boundary(self, state):
        """Printer character movement is progress, not a reason to stop a wait."""
        value = self._event_progress(state)
        value.pop('printer_char', None)
        return dict(value, map=state.get('map'), free=state.get('free'),
                    menu=state.get('menu'), in_battle=state.get('in_battle'), mode=self._event_mode(state))

    def _execute_event(self, state, mode, start, budget):
        previous = self._event_boundary(state)
        original_map = state.get('map')
        def changed_map(current):
            if current.get('map') != original_map:
                self.field_free_settle_remaining = 0
                self.boundary = 'map_transition'
                return True
            return False
        edges = 0
        if mode == 'advance':
            # Release before the press: both scrcmd and match_call test JOY_NEW.
            self.emu.hold(None, 1)
            current = self.game.state()
            if changed_map(current): return edges
            if self._event_mode(current) != previous['mode']:
                if current.get('free') and not current.get('menu') and not current.get('in_battle'):
                    self.field_free_settle_remaining = 15
                self.boundary = 'source_event_boundary'; return edges
            if self.emu.frames - start >= budget:
                self.boundary = 'option_budget'; return edges
            self.emu.hold('A', 1)
            edges = 1
            if changed_map(self.game.state()): return edges
        while self.emu.frames - start < budget:
            self.emu.hold(None, 1)
            current = self.game.state()
            if changed_map(current): return edges
            if current.get('free') and not current.get('menu') and not current.get('in_battle'):
                # Original Bot.untilfree requires eight free samples separated
                # by two neutral frames; preserve that post-event readiness.
                if not self.field_free_settle_remaining:
                    self.field_free_settle_remaining = 15
                else:
                    self.field_free_settle_remaining -= 1
                if self.field_free_settle_remaining:
                    continue
                self.boundary = 'source_event_boundary'; return edges
            self.field_free_settle_remaining = 0
            if self._event_boundary(current) != previous:
                self.boundary = 'source_event_boundary'; return edges
        self.boundary = 'option_budget'
        return edges

    def _options(self, state):
        def action(ident, text, **extra):
            frames = extra.pop('frames', min(120, self.max_option_frames))
            return dict(id=ident, description=text, keys=[], frames=frames, **extra)
        if state.get('in_battle'):
            info = self.game.battle_info()
            for battler in info:
                if battler['side'] != 0: continue
                if battler['func'] == 'HandleInputChooseMove':
                    return [action('battle:move:' + str(i), 'Use move slot %d, species move ID %s, PP %s' % (i, move, battler['pp'][i]),
                        cursor_address=self.game.addr('gMoveSelectionCursor') + battler['battler'], cursor=i, semantic='battle_move')
                        for i, move in enumerate(battler['moves']) if move and battler['pp'][i] > 0]
                if battler['func'] == 'HandleInputChooseAction':
                    return [action('battle:action:' + str(i), label, cursor_address=self.game.addr('gActionSelectionCursor') + battler['battler'],
                        cursor=i, semantic='battle_action') for i, label in enumerate(('FIGHT', 'BAG', 'POKEMON', 'RUN'))]
            # Unknown battle UI must remain a model decision; never select a smart fallback.
            return [action('input:' + key, 'Battle UI input ' + key, input_key=key, semantic='uncertain_battle') for key in ('A', 'B', 'UP', 'DOWN', 'LEFT', 'RIGHT')]
        if state.get('menu'):
            labels = self.planner.menu_options(state)
            if labels:
                return [action('menu:' + str(i), str(label), cursor_address=self.game.addr('sMenu', 12) + 2,
                        cursor=i, semantic='menu') for i, label in enumerate(labels)]
        event = self._event_mode(state)
        if event:
            mode, proof = event
            return [action('text:advance' if mode == 'advance' else 'wait',
                'Advance one source-ready text page' if mode == 'advance' else 'Wait for a source-proven noninteractive field event',
                frames=self.max_option_frames, semantic='source_event', event_mode=mode, source_proof=proof)]
        if state.get('free') and state.get('x') is not None:
            if self.navigation_policy == SOURCE_POIS:
                return self._live_poi_options(state)
            result = []
            for target in self.targets:
                if target['map'] != state['map'] or tuple(target['position']) == (state['x'], state['y']): continue
                route = self.planner.plan(state, {tuple(target['position'])})
                if route:
                    result.append(action('navigate:' + target['id'], target.get('description', target['id']),
                        target=target, continue_until_target=True, semantic='goal_choice', frames=self.max_option_frames))
            if result: return result
            # No trustworthy route: expose uncertainty, not a fabricated walkable map.
            return [action('input:' + key, 'Uncertain route: bounded observed input ' + key, input_key=key,
                           semantic='uncertain_route') for key in ('A', 'B', 'UP', 'DOWN', 'LEFT', 'RIGHT')]
        if state.get('msgbox'):
            return [action('input:' + key, 'Uncertain message readiness: inspect before input ' + key, input_key=key, semantic='uncertain_message') for key in ('A', 'B')]
        return [action('wait', 'Bounded observation of an unclassified script/frame', input_key=None, semantic='wait')]

    def observe(self):
        require(not self.closed, 'rpg_session_closed')
        state = self._state()
        self.last_state = copy.deepcopy(state)
        facts = copy.deepcopy(state)
        if hasattr(self.game, 'story_values'):
            facts['story'] = self.game.story_values()
        if self.navigation_policy == SOURCE_POIS:
            facts['source_objective'] = self.game.objective()
            if state.get('free'): facts['source_pois'] = self.planner.live_pois(state)
        facts['provider_manifest_sha256'] = self.provider_identity
        facts['navigation_boundary'] = self.boundary
        event = self._event_mode(state)
        facts['source_event_mode'] = event[0] if event else None
        facts['source_event_proof'] = event[1] if event else None
        facts['noninteractive_wait_safe'] = bool(event and event[0] == 'wait')
        facts['source_callback2'] = state.get('cb2')
        facts['source_event_progress'] = self._event_progress(state)
        facts['navigation_grid_available'] = bool(state.get('free') and state.get('x') is not None)
        if state['map'] in getattr(self.game, 'W', {}):
            facts['map_group'] = self.game.W[state['map']]['group']
            facts['map_number'] = self.game.W[state['map']]['num']
        if state.get('in_battle'):
            if hasattr(self, 'provider'):
                if self.battle_data is None:
                    self.battle_data = self.provider.battler.BattleData(self.game, self.provider.decode)
                facts['battle_source_knowledge'] = self.battle_data.battlers()
            facts['battlers'] = [{k: list(v) if isinstance(v, (bytes, tuple)) else v for k, v in b.items()}
                for b in self.game.battle_info()]
        options = self._options(state)
        cursor_addresses = sorted({a['cursor_address'] for a in options if 'cursor_address' in a})
        cursors = {str(address): self.emu.peek(address, 1)[0] for address in cursor_addresses}
        facts['semantic_cursors'] = cursors
        phase = 'battle' if state.get('in_battle') else 'menu' if state.get('menu') else 'overworld' if state.get('free') else 'script'
        progress = {key: state.get(key) for key in ('map', 'x', 'y', 'text', 'in_battle')}
        progress['semantic_cursors'] = cursors
        progress['source_event'] = self._event_progress(state)
        if 'story' in facts: progress['story'] = copy.deepcopy(facts['story'])
        obs = {'frame': self.emu.frames, 'state_key': digest(progress), 'phase': phase, 'facts': facts,
            'progress': progress, 'terminal': False, 'success': False, 'options': options,
            'requires_decision': self.boundary not in (None, 'option_budget') or phase != 'overworld',
            'evidence': {'provider_manifest_sha256': self.provider_identity, 'preparation': self.preparation,
                'scope': 'ScenarioAdapter owns substantive objective completion; no action-count success'}}
        if self.session is not None:
            obs['image'] = self.restored_image or self.session.observe()['image']
        return obs

    def act(self, action, *, max_frames):
        require(not self.closed, 'rpg_session_closed')
        state = self._state()
        available = {a['id']: a for a in self._options(state)}
        require(action.get('id') in available, 'stale_rpg_action')
        chosen = available[action['id']]
        budget = min(max_frames, chosen['frames'])
        require(type(budget) is int and budget > 0, 'invalid_rpg_frame_budget')
        start = self.emu.frames
        self.restored_image = None
        self.boundary = None
        steps = 0
        event_edges = 0
        if chosen.get('semantic') == 'source_event':
            event_edges = self._execute_event(state, chosen['event_mode'], start, budget)
        elif chosen.get('semantic') == 'source_poi_choice':
            steps = self._execute_source_poi(chosen['target'], start, budget)
        elif chosen['id'].startswith('navigate:'):
            target = tuple(chosen['target']['position'])
            while self.emu.frames - start < budget:
                state = self._state()
                if state['map'] != chosen['target']['map']:
                    self.boundary = 'map_transition'; break
                if not state.get('free'):
                    self.boundary = 'battle_or_script'; break
                if (state['x'], state['y']) == target:
                    self.boundary = 'target_reached'; break
                route = self.planner.plan(state, {target})
                if not route:
                    self.boundary = 'route_unavailable'; break
                direction = route[0]
                x, y = state['x'], state['y']
                dx, dy = {'UP': (0,-1), 'DOWN': (0,1), 'LEFT': (-1,0), 'RIGHT': (1,0)}[direction]
                tile = self.game.tile(x + dx, y + dy)
                jump = bool(tile and tile['behname'].startswith('MB_JUMP_'))
                expected = (x + dx * (2 if jump else 1), y + dy * (2 if jump else 1))
                step_start = self.emu.frames
                while self.emu.frames - start < budget and self.emu.frames - step_start < 48:
                    self.emu.hold(direction, 1)
                    after = self.game.state()
                    if after['map'] != state['map'] or not after.get('free'):
                        self.boundary = 'map_transition' if after['map'] != state['map'] else 'battle_or_script'; break
                    if (after['x'], after['y']) != (x, y):
                        if (after['x'], after['y']) != expected:
                            self.boundary = 'position_divergence'
                        else: steps += 1
                        break
                else:
                    if self.emu.frames - step_start >= 48:
                        self.planner.blocked_edges.add(((x, y), direction))
                        self.boundary = 'blocked_edge_replan'
                if self.boundary: break
        else:
            # Cursor movement is deterministic UI execution after D1/S2 selection.
            if 'cursor' in chosen:
                for _ in range(12):
                    if self.emu.frames - start + 8 >= budget: break
                    current = self.emu.peek(chosen['cursor_address'], 1)[0]
                    want = chosen['cursor']
                    if current == want: break
                    key = ('UP' if current > want else 'DOWN') if chosen['semantic'] == 'menu' else (
                        ('RIGHT' if want & 1 else 'LEFT') if (current & 1) != (want & 1) else ('DOWN' if want & 2 else 'UP'))
                    self.emu.hold(key, 2); self.emu.hold(None, 4)
                if self.emu.peek(chosen['cursor_address'], 1)[0] == chosen['cursor'] and self.emu.frames - start + 3 <= budget:
                    self.emu.hold('A', 2); self.emu.hold(None, 1)
                    self.boundary = 'semantic_action_executed'
                else: self.boundary = 'cursor_not_reached'
            else:
                count = min(12, budget)
                self.emu.hold(chosen.get('input_key'), max(1, count - 1))
                if count > 1: self.emu.hold(None, 1)
                self.boundary = 'semantic_input_executed'
        if self.emu.frames == start:
            # An environment event can invalidate a route between observe and act.
            self.emu.hold(None, 1)
        self.route_steps += steps
        self.boundary = self.boundary or 'option_budget'
        return {'frames': self.emu.frames - start, 'decision_boundary': self.boundary,
            'deterministic_tile_steps': steps, 'model_calls_inside_adapter': 0,
            'source_event_mode': chosen.get('event_mode'), 'source_event_proof': chosen.get('source_proof'),
            'source_event_a_edges': event_edges}

    def restore_navigation(self, state):
        require(state.get('provider_manifest_sha256') == self.provider_identity, 'rpg_checkpoint_provider_mismatch')
        require(state.get('navigation_policy') == self.navigation_policy, 'rpg_checkpoint_navigation_policy_mismatch')
        allowed = {None, 'option_budget', 'map_transition', 'battle_or_script', 'target_reached', 'route_unavailable',
            'position_divergence', 'blocked_edge_replan', 'semantic_action_executed', 'cursor_not_reached',
            'semantic_input_executed', 'source_event_boundary', 'source_poi_completed', 'source_navigation_unresolved', 'battle', 'menu', 'script'}
        require(state.get('boundary') in allowed, 'invalid_rpg_checkpoint_boundary')
        require(type(state.get('route_steps')) is int and state['route_steps'] >= 0, 'invalid_rpg_checkpoint_route_steps')
        edges = state.get('blocked_edges')
        require(isinstance(edges, list) and len(edges) <= 10000, 'invalid_rpg_checkpoint_edges')
        for edge in edges:
            require(isinstance(edge, list) and len(edge) == 2 and isinstance(edge[0], list) and len(edge[0]) == 2
                    and all(type(v) is int for v in edge[0]) and edge[1] in ('UP','DOWN','LEFT','RIGHT'), 'invalid_rpg_checkpoint_edge')
        self.planner.blocked_edges = {(tuple(position), direction) for position, direction in edges}
        settle = state.get('field_free_settle_remaining', 0)
        require(type(settle) is int and 0 <= settle <= 16, 'invalid_rpg_checkpoint_field_settle')
        self.field_free_settle_remaining = settle
        self.boundary, self.route_steps = state.get('boundary'), state['route_steps']

    def checkpoint(self):
        require(self.session is not None, 'rpg_checkpoint_unsupported')
        require(len(self.tokens) < 31, 'rpg_checkpoint_limit')
        slot = len(self.tokens) + 1
        self.session._command('save ' + str(slot))
        path = self.session.out / ('checkpoint-' + str(slot) + '.ss')
        token = 'rpg-checkpoint-' + str(slot)
        state = {'blocked_edges': [[list(p), d] for p, d in self.planner.blocked_edges],
                 'boundary': self.boundary, 'route_steps': self.route_steps,
                 'field_free_settle_remaining': self.field_free_settle_remaining,
                 'provider_manifest_sha256': self.provider_identity, 'navigation_policy': self.navigation_policy}
        image = self.session.observe()['image'] if hasattr(self.session, 'observe') else None
        self.tokens[token] = (slot, self.session.frame, self.session.native_counter, copy.deepcopy(state), image)
        return {'checkpoint': token, 'frame': self.session.frame, 'path': str(path), 'state_path': str(path),
            'sha256': pin(path)['sha256'], 'navigation_state': state, 'game_version': self.game_version}

    def restore(self, token):
        require(token in self.tokens, 'rpg_checkpoint_unknown')
        slot, frame, counter, state, image = self.tokens[token]
        self.restored_image = image
        self.session._command('load ' + str(slot))
        # Native command counter is process monotonic, outside mGBA snapshots.
        # Rewind the logical run frame, preserving the current native counter.
        self.session.frame = frame
        self.restore_navigation(state)
        self.game.grid_key = None
        return {'checkpoint': token, 'frame': frame}

    def close(self):
        if not self.closed:
            self.closed = True
            self.emu.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-root', type=Path, required=True)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--elf', type=Path, required=True)
    parser.add_argument('--save', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(provider_manifest(args.install_root, rom=args.rom, elf=args.elf, save=args.save), indent=2) + '\n')


if __name__ == '__main__': main()
