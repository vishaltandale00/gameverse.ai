import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

from tools.playtester.rpg_adapter import RPGNavigationAdapter, NativeEmu, checked
from tools.playtester.core import Playtester, Limits, digest


class Game:
    def __init__(self):
        self.s = dict(map='room', x=0, y=0, elev=0, avatar_flags=0, free=True, in_battle=False,
            menu=False, msgbox=0, printer_wait=False, text='', objects=[], tasks=[])
        self.W = {'room': {'group': 1, 'num': 2}}
        self.g = {'warps': []}
        self.blocked = set()
        self.reloads = 0
    def state(self): return dict(self.s)
    def reload_grid(self): self.reloads += 1
    def tile(self, x, y):
        if not 0 <= x <= 20 or y != 0: return None
        return dict(coll=(x,y) in self.blocked, id=0, behname='MB_NORMAL', elev=0)
    def battle_info(self): return self.battlers
    def addr(self, name): return 0x02000000


class Emu:
    def __init__(self, game): self.game, self.frames, self.interrupt = game, 0, None
    def hold(self, key, frames):
        self.frames += frames
        if key == 'RIGHT': self.game.s['x'] += 1
        if self.interrupt and self.game.s['x'] >= self.interrupt:
            self.game.s.update(free=False, in_battle=True)
    def peek(self, address, count): return b'\0' * count
    def close(self): pass


def recovered_planner(game):
    # Parse and execute the exact original methods, without importing provider or needing ROM/toolchain.
    import ast
    provider_root = os.environ.get('GAMEVERSE_RPG_PROVIDER_ROOT')
    if not provider_root: raise unittest.SkipTest('GAMEVERSE_RPG_PROVIDER_ROOT not configured')
    path = Path(provider_root) / 'dev_scripts/sid/sidbot.py'
    if not path.is_file(): raise unittest.SkipTest('optional recovered SID provider is not installed')
    tree = ast.parse(path.read_text())
    bot = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Bot')
    methods = [n for n in bot.body if isinstance(n, ast.FunctionDef) and n.name in ('plan', 'passable')]
    from collections import deque
    scope = {'deque': deque, 'DIRS': {'DOWN': (0,1), 'UP': (0,-1), 'LEFT':(-1,0), 'RIGHT':(1,0)}}
    cls = ast.ClassDef(name='RecoveredPlanner', bases=[], keywords=[], body=methods, decorator_list=[])
    exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), str(path), 'exec'), scope)
    planner = scope['RecoveredPlanner']()
    planner.game, planner.blocked_edges = game, set()
    return planner


class Model:
    requires_model = True
    def __init__(self): self.calls = 0
    def choose(self, context, options, timeout_s):
        self.calls += 1
        return {'accepted': False, 'reason': 'low_confidence_or_margin'}


class RPGTests(unittest.TestCase):
    def adapter(self, **kwargs):
        game = Game(); emu = Emu(game)
        adapter = RPGNavigationAdapter(game, emu, recovered_planner(game), game_id='test-rpg',
            game_version='pinned', provider_identity='provider',
            targets=[{'id':'door', 'map':'room', 'position':[10,0]}], **kwargs)
        return adapter, game, emu

    def test_exact_recovered_planner_avoids_live_occupancy_and_unintended_warps(self):
        adapter, game, _ = self.adapter()
        state = game.state()
        state['objects'] = [dict(x=2,y=0,px=1,py=0,local=1,gfx=2)]
        self.assertIsNone(adapter.planner.plan(state, {(10,0)}))
        game.g['warps'] = [dict(x=5,y=0)]
        self.assertIsNone(adapter.planner.plan(game.state(), {(10,0)}))
        self.assertEqual(adapter.planner.plan(game.state(), {(5,0)}), ['RIGHT'] * 5)

    def test_long_route_executes_without_per_tile_model_and_counts_actual_frames(self):
        adapter, game, emu = self.adapter()
        action = adapter.observe()['options'][0]
        result = adapter.act(action, max_frames=600)
        self.assertEqual(result['deterministic_tile_steps'], 10)
        self.assertEqual(result['frames'], 10)
        self.assertEqual(result['model_calls_inside_adapter'], 0)
        self.assertEqual(result['decision_boundary'], 'target_reached')
        self.assertEqual(game.s['x'], 10)
        self.assertGreater(game.reloads, 10)

    def test_interrupt_reaches_existing_confidence_gate_and_system2(self):
        adapter, game, emu = self.adapter()
        emu.interrupt = 3
        game.battlers = [dict(side=0, battler=0, func='HandleInputChooseAction')]
        model, slow = Model(), Model()
        report = Playtester(adapter, {'schema_version':1, 'game_id':'test-rpg'}, model, system2=slow,
            limits=Limits(max_steps=2, max_frames=600, max_action_frames=600, max_escalations=1)).run()
        self.assertEqual(game.s['x'], 3)
        self.assertEqual(model.calls, 1)
        self.assertEqual(slow.calls, 1)
        self.assertEqual(report['frames'], 3)
        self.assertEqual(report['reason'], 'system2_unresolved')

    def test_unknown_route_offers_uncertainty_without_inventing_grid(self):
        adapter, game, _ = self.adapter()
        game.blocked.add((1,0))
        obs = adapter.observe()
        self.assertTrue(all(a['semantic'] == 'uncertain_route' for a in obs['options']))

    def test_frame_budget_preserved_mid_route(self):
        adapter, game, emu = self.adapter()
        receipt = adapter.act(adapter.observe()['options'][0], max_frames=4)
        self.assertEqual(receipt['frames'], 4)
        self.assertEqual(receipt['decision_boundary'], 'option_budget')
        self.assertEqual(game.s['x'], 4)

    def test_rom_bridge_bounded_and_pinned_file_only(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'rom'; path.write_bytes(b'abcdef')
            emu = NativeEmu(None, path)
            self.assertEqual(emu.peek(0x08000001, 3), b'bcd')
            with self.assertRaises(Exception): emu.peek(0x08000005, 3)

    def test_restore_keeps_process_monotonic_counter_and_restores_navigation_state(self):
        adapter, game, emu = self.adapter()
        class Session:
            def __init__(self, root):
                self.out, self.frame, self.native_counter = root, 10, 100
            def _command(self, text):
                if text.startswith('save '):
                    (self.out / ('checkpoint-' + text.split()[1] + '.ss')).write_bytes(b'state')
        with tempfile.TemporaryDirectory() as temp:
            session = Session(Path(temp)); adapter.session = session
            adapter.planner.blocked_edges = {((1,0), 'RIGHT')}
            checkpoint = adapter.checkpoint()
            session.frame, session.native_counter = 20, 110
            adapter.planner.blocked_edges.clear()
            adapter.restore(checkpoint['checkpoint'])
            self.assertEqual(session.frame, 10)
            self.assertEqual(session.native_counter, 110)
            self.assertEqual(adapter.planner.blocked_edges, {((1,0), 'RIGHT')})

    def test_menu_cursor_progress_is_source_observed_and_option_can_complete_large_menu(self):
        adapter, game, emu = self.adapter()
        game.s.update(menu=True, free=False)
        adapter.planner.menu_options = lambda state: ['choice ' + str(i) for i in range(10)]
        game.addr = lambda name, *args: 0x02000000
        emu.cursor = 0
        emu.peek = lambda address, count: bytes([emu.cursor])
        original_hold = emu.hold
        def hold(key, frames):
            if key == 'DOWN': emu.cursor += 1
            elif key == 'UP': emu.cursor -= 1
            original_hold(key, frames)
        emu.hold = hold
        first = adapter.observe()
        chosen = first['options'][8]
        self.assertEqual(chosen['frames'], 120)
        result = adapter.act(chosen, max_frames=120)
        after = adapter.observe()
        self.assertEqual(result['decision_boundary'], 'semantic_action_executed')
        self.assertEqual(after['facts']['semantic_cursors']['33554434'], 8)
        self.assertNotEqual(first['state_key'], after['state_key'])

    def test_story_milestones_are_observed_from_provider_ram_not_inferred(self):
        adapter, game, emu = self.adapter()
        game.story_values = lambda: {'VAR_WEEKEND': 0, 'FLAG_BOSS': 0}
        before = adapter.observe()
        self.assertEqual(before['facts']['story']['VAR_WEEKEND'], 0)
        game.story_values = lambda: {'VAR_WEEKEND': 1, 'FLAG_BOSS': 0}
        after = adapter.observe()
        self.assertEqual(after['progress']['story']['VAR_WEEKEND'], 1)
        self.assertNotEqual(before['state_key'], after['state_key'])
        self.assertFalse(after['success'])

    def test_source_poi_is_named_semantic_choice_and_stops_before_old_policy(self):
        adapter, game, emu = self.adapter(navigation_policy='source-live-pois/1')
        poi = {'map':'room','kind':'person','label':'Trainer','x':5,'y':0,'local_id':1}
        adapter.planner.live_pois = lambda state: [dict(poi)]
        game.objective = lambda: {'objective':'Talk to the trainer'}
        def old_use_poi(target):
            for _ in range(10): adapter.planner.tick('RIGHT', 1)
            self.fail('Should stop on script/battle before entering old dialogue/battle policy')
        adapter.planner.use_poi = old_use_poi
        emu.interrupt = 3
        game.battlers = [dict(side=0,battler=0,func='HandleInputChooseAction')]
        observation = adapter.observe()
        self.assertEqual(observation['options'][0]['semantic'], 'source_poi_choice')
        self.assertIn('interact:facing', [a['id'] for a in observation['options']])
        result = adapter.act(observation['options'][0], max_frames=600)
        self.assertEqual(result['frames'], 3)
        self.assertEqual(result['decision_boundary'], 'battle')
        self.assertEqual(result['deterministic_tile_steps'], 3)
        self.assertEqual(result['model_calls_inside_adapter'], 0)

    def test_source_poi_execution_respects_partial_option_budget(self):
        adapter, game, emu = self.adapter(navigation_policy='source-live-pois/1')
        poi = {'map':'room','kind':'door','label':'Exit','x':10,'y':0}
        adapter.planner.live_pois = lambda state: [dict(poi)]
        game.objective = lambda: {'objective':'Leave room'}
        def old_use_poi(target): adapter.planner.tick('RIGHT', 100)
        adapter.planner.use_poi = old_use_poi
        action = adapter.observe()['options'][0]
        result = adapter.act(action, max_frames=5)
        self.assertEqual(result['frames'], 5)
        self.assertEqual(result['decision_boundary'], 'option_budget')

    def test_cross_process_navigation_restore_keeps_decision_boundary(self):
        adapter, game, emu = self.adapter(navigation_policy='source-live-pois/1')
        state = {'provider_manifest_sha256':'provider','navigation_policy':'source-live-pois/1',
                 'boundary':'map_transition','route_steps':8,'blocked_edges':[[[2,0],'RIGHT']]}
        adapter.restore_navigation(state)
        self.assertEqual(adapter.boundary, 'map_transition')
        self.assertEqual(adapter.route_steps, 8)
        self.assertEqual(adapter.planner.blocked_edges, {((2,0),'RIGHT')})
        with self.assertRaisesRegex(ValueError, 'checkpoint_boundary'):
            adapter.restore_navigation(dict(state,boundary='invented boundary'))

    def test_hash_and_authorized_root_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'source'; path.write_text('source')
            with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
                checked({'path':str(path), 'sha256':'changed'})
            with self.assertRaisesRegex(ValueError, 'outside_declared_root'):
                checked({'path':str(path), 'sha256':'changed'}, Path(temp) / 'other')


if __name__ == '__main__': unittest.main()
