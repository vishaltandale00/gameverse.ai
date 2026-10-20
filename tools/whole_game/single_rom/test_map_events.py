"""Focused source-event staging checks; no ROM build or campaign run."""
import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from .map_events import _inventory, stage_map_events
from .map_runtime import stage_map_runtime
from .world_assets import stage_world_assets

ROOT = Path(__file__).resolve().parents[3]
EMERALD = ROOT / 'local/decomps/pokeemerald'
FIRERED = ROOT / 'local/decomps/pokefirered'


class MapEventsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='whole-game-map-events-')
        cls.out = Path(cls.scratch.name) / 'source'
        cls.source_hashes = {rel: hashlib.sha256((EMERALD / rel).read_bytes()).hexdigest()
                             for rel in ('asm/macros/map.inc', 'src/event_object_movement.c',
                                         'src/field_control_avatar.c', 'src/item_use.c',
                                         'src/overworld.c', 'tools/mapjson/mapjson.cpp')}
        shutil.copytree(EMERALD, cls.out, ignore=shutil.ignore_patterns('.git', '*.o', '*.gba', '*.elf'))
        stage_world_assets(EMERALD, FIRERED, cls.out)
        stage_map_runtime(EMERALD, FIRERED, cls.out)
        cls.report = stage_map_events(EMERALD, FIRERED, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_every_imported_event_retains_donor_fields(self):
        inventory = _inventory(FIRERED, self.out)
        self.assertEqual(inventory['maps'], 425)
        self.assertEqual(len(inventory['clones']), 9)
        self.assertEqual(len(inventory['hiddenItems']), 183)
        self.assertEqual(sum(x['underfoot'] for x in inventory['hiddenItems']), 6)
        self.assertEqual(sorted(x['quantity'] for x in inventory['hiddenItems'] if x['quantity'] > 1),
                         [10] * 8 + [20] * 2 + [40, 100])
        self.assertTrue(all(x['targetFlag'] and x['targetScript'] and x['targetMovement']
                            for x in inventory['clones']))

    def test_native_consumers_and_immutable_sources(self):
        macro = (self.out / 'asm/macros/map.inc').read_text()
        self.assertIn('wg_bg_hidden_item_event', macro)
        self.assertIn('FR_FLAG_HIDDEN_ITEMS_START', macro)
        generated = (self.out / 'tools/mapjson/mapjson.cpp').read_text()
        self.assertIn('mapName.rfind("FR", 0) == 0', generated)
        objects = (self.out / 'src/event_object_movement.c').read_text()
        self.assertIn('WholeGame_CloneTarget', objects)
        self.assertIn('WholeGame_ShouldInitObject', objects)
        self.assertIn('WholeGame_MapEventsSemanticsVersion', objects)
        field = (self.out / 'src/field_control_avatar.c').read_text()
        self.assertIn('WholeGame_HiddenItemQuantity(bgEvent)', field)
        self.assertIn('FR_EventScript_HiddenItemScript', field)
        self.assertIn('FR_IncrementRenewableHiddenItemStepCounter', field)
        self.assertIn('FR_TryRegenerateRenewableHiddenItems',
                      (self.out / 'src/overworld.c').read_text())
        for rel, expected in self.source_hashes.items():
            self.assertEqual(hashlib.sha256((EMERALD / rel).read_bytes()).hexdigest(), expected)

    def test_metadata_loss_fails_closed(self):
        path = self.out / 'data/maps/FRCeladonCity_GameCorner/map.json'
        original = path.read_text()
        try:
            import json
            data = json.loads(original)
            event = next(x for x in data['bg_events'] if x.get('type') == 'hidden_item')
            event.pop('quantity')
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'quantity/underfoot lost'):
                _inventory(FIRERED, self.out)
        finally:
            path.write_text(original)


if __name__ == '__main__':
    unittest.main()
