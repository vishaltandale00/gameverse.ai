"""Focused source-contract checks; no ROM build or gameplay simulation."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from .shared_services import _bag_capacity_proof, stage_shared_services


REPO = Path(__file__).resolve().parents[3]
EMERALD = REPO / 'local/decomps/pokeemerald'
FIRERED = REPO / 'local/decomps/pokefirered'


class SharedServicesTest(unittest.TestCase):
    def test_bag_capacity_fails_closed_then_proves_full_pockets(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name)
            header = output / 'include/constants/global.h'
            header.parent.mkdir(parents=True)
            original = (EMERALD / 'include/constants/global.h').read_text()
            header.write_text(original)
            self.assertIsNone(_bag_capacity_proof(FIRERED, output))
            header.write_text(original.replace('#define BAG_ITEMS_COUNT 30',
                                               '#define BAG_ITEMS_COUNT 42'))
            proof = _bag_capacity_proof(FIRERED, output)
            self.assertIsNotNone(proof)
            self.assertEqual(proof['staged']['BAG_ITEMS_COUNT'], 42)
            self.assertEqual(proof['donor']['MAIL_COUNT'], 16)

    def test_stage_emits_only_audited_wrappers(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name)
            (output / 'src').mkdir()
            for relative in ('src/battle_setup.c', 'src/field_player_avatar.c',
                             'src/field_screen_effect.c', 'src/load_save.c',
                             'src/money.c', 'src/pokemon.c'):
                shutil.copy2(EMERALD / relative, output / relative)
            header = output / 'include/constants/global.h'
            header.parent.mkdir(parents=True)
            header.write_text((EMERALD / 'include/constants/global.h').read_text().replace(
                '#define BAG_ITEMS_COUNT 30', '#define BAG_ITEMS_COUNT 42'))
            ledger = stage_shared_services(EMERALD, FIRERED, output, output / 'report')
            accepted = {row['name'] for row in ledger['accepted']}
            self.assertEqual(accepted, {
                'CalculatePlayerPartyCount', 'GetPlayerFacingDirection',
                'GetTrainerBattleMode', 'IsEnoughForCostInVar0x8005',
                'LoadPlayerBag', 'LoadPlayerParty', 'SavePlayerParty',
                'Script_FadeOutMapMusic', 'SubtractMoneyFromVar0x8005',
            })
            self.assertNotIn('CreateInGameTradePokemon', accepted)
            self.assertNotIn('HealPlayerParty', accepted)
            self.assertEqual(ledger['compatibleExternalCount'], 1)
            healing = ledger['compatibleExternal'][0]
            self.assertEqual(healing['name'], 'HealPlayerParty')
            self.assertEqual(healing['selectedProvider'], 'campaign_services')
            self.assertEqual(len(healing['fieldCases']), 6)
            source = (output / 'src/whole_game_shared_services.c').read_text()
            for root in accepted:
                self.assertIn('FR_' + root + '(void)', source)
            self.assertEqual(json.loads((output / 'report/shared-services-ledger.json').read_text())['acceptedCount'], 9)
            host = output / 'src/field_player_avatar.c'
            host.write_text(host.read_text().replace(
                'return gObjectEvents[gPlayerAvatar.objectEventId].facingDirection;',
                'return 0;', 1))
            drifted = stage_shared_services(EMERALD, FIRERED, output, output / 'report')
            self.assertNotIn('GetPlayerFacingDirection',
                             {row['name'] for row in drifted['accepted']})
            row = next(row for row in drifted['frontier']
                       if row['name'] == 'GetPlayerFacingDirection')
            self.assertEqual(row['reason'], 'staged-host-body-drift-or-missing')


if __name__ == '__main__':
    unittest.main()
