"""Narrow, source-only world importer checks (no ROM build/toolchain)."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.whole_game.single_rom.world_assets import stage_world_assets, verify_world_symbol_contracts

ROOT = Path(__file__).resolve().parents[3]
EMERALD = ROOT / 'local/decomps/pokeemerald'
FIRERED = ROOT / 'local/decomps/pokefirered'


@unittest.skipUnless((FIRERED / 'data/maps/map_groups.json').is_file(), 'pinned local donor source unavailable')
class WorldAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='world-assets-test-')
        cls.out = Path(cls.tmp.name) / 'merged'
        (cls.out / 'data/maps').mkdir(parents=True)
        shutil.copyfile(EMERALD / 'data/maps/map_groups.json', cls.out / 'data/maps/map_groups.json')
        cls.ledger = stage_world_assets(EMERALD, FIRERED, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_complete_map_topology_and_preserved_native_groups(self):
        groups = json.loads((self.out / 'data/maps/map_groups.json').read_text())
        original = json.loads((EMERALD / 'data/maps/map_groups.json').read_text())
        self.assertEqual(groups['group_order'][:34], original['group_order'])
        for name in original['group_order']:
            self.assertEqual(groups[name], original[name])
        self.assertEqual(len(self.ledger['maps']), 425)
        self.assertEqual(len({(m['group'], m['number']) for m in self.ledger['maps']}), 425)
        pallet = json.loads((self.out / 'data/maps/FRPalletTown/map.json').read_text())
        self.assertEqual(pallet['connections'][0]['map'], 'MAP_FR_ROUTE1')
        self.assertEqual(pallet['shared_scripts_map'], 'FR_PalletTown')
        self.assertEqual(pallet['warp_events'][0]['dest_map'], 'MAP_FR_PALLET_TOWN_PLAYERS_HOUSE_1F')
        self.assertEqual(pallet['object_events'][0]['script'], 'FR_PalletTown_EventScript_SignLady')
        self.assertEqual(pallet['object_events'][2]['script'], '0x0')
        sentinels = (self.out / 'include/constants/firered_map_sentinels.h').read_text()
        self.assertIn('#define MAP_FR_UNDEFINED MAP_UNDEFINED', sentinels)
        self.assertIn('#define FR_WARP_ID_DYNAMIC WARP_ID_DYNAMIC', sentinels)
        self.assertIn('#define FR_WARP_ID_NONE WARP_ID_NONE', sentinels)
        self.assertIn('constants/firered_map_sentinels.h', (self.out / 'data/map_events.s').read_text())

    def test_layout_attributes_and_all_raw_assets_are_lossless(self):
        self.assertEqual(self.ledger['coverage']['nonemptyLayouts'], 365)
        self.assertEqual(self.ledger['coverage']['borderDimensions'], {'2x2': 330, '0x0': 28, '3x2': 7})
        for record in self.ledger['files']:
            actual = hashlib.sha256((self.out / record['destination']).read_bytes()).hexdigest()
            self.assertEqual(actual, record['sha256'])
        header = (self.out / 'src/data/firered/tilesets/headers.h').read_text()
        self.assertIn('.metatileAttributes = NULL,', header)
        self.assertIn('.fireRedMetatileAttributes = FR_gMetatileAttributes_General', header)
        self.assertIn('.tiles = FR_gTilesetTiles_General', header)
        self.assertIn('.callback = FR_InitTilesetAnim_General', header)
        self.assertIn('FR_gObjectEventGraphicsInfoPointers', (self.out / 'src/data/firered/object_events/object_event_graphics_info_pointers.h').read_text())
        self.assertIn('FR_sObjectEventSpritePalettes', (self.out / 'src/data/firered/object_events/palette_tables.h').read_text())

    def test_actual_world_symbol_contracts_and_runtime_animation_hooks(self):
        result = verify_world_symbol_contracts(FIRERED, self.out)
        self.assertEqual(result['mapScriptRoots'], 425)
        self.assertEqual(result['donorTilesetDefinitions'], 68)
        self.assertEqual(result['actualGraphicsReferences'], 270)
        self.assertFalse(result['unboundSymbols'])
        data = (self.out / 'src/tileset_anims.c').read_text()
        self.assertIn('int i;\n    if (WholeGame_IsKanto()) { FR_TransferTilesetAnimsBuffer(); return; }', data)
        for name in ('InitTilesetAnimations', 'InitSecondaryTilesetAnimation', 'UpdateTilesetAnimations'):
            self.assertIn('if (WholeGame_IsKanto()) { FR_' + name + '(); return; }', data)
        layouts = json.loads((self.out / 'data/layouts/layouts.json').read_text())['layouts']
        self.assertFalse(any(layout.get('primary_tileset') == 'FR_NULL' or layout.get('secondary_tileset') == 'FR_NULL' for layout in layouts))

    def test_repeat_import_is_deterministic_and_never_claims_campaign(self):
        second = stage_world_assets(EMERALD, FIRERED, self.out)
        self.assertEqual(second, self.ledger)
        self.assertFalse(second['buildEligible'])
        self.assertFalse(second['campaignComplete'])
        self.assertTrue(second['unresolved'])

    def test_refuses_canonical_output(self):
        with self.assertRaisesRegex(ValueError, 'isolated'):
            stage_world_assets(EMERALD, FIRERED, EMERALD)


if __name__ == '__main__':
    unittest.main()
