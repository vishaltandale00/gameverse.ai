import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.roundtrip import pokemon_profile as pokemon


class PokemonProfiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        data = bytearray(16*1024*1024)
        data[0xac:0xb0], data[0xbc] = b'BPRE', 1
        self.original = self.root/'rev1.gba'
        self.original.write_bytes(data)
        patcher = patch.dict(pokemon.REVISIONS, {1: hashlib.sha1(data).hexdigest()})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.elf, self.map = self.root/'source.elf', self.root/'source.map'
        self.elf.write_bytes(b'ELF')
        self.map.write_bytes(b'MAP')
        self.receipt = {'status': 'passed', 'revision': 1, 'raw_exact': True,
                        'artifacts': {'rom': pokemon.pin(self.original), 'elf': pokemon.pin(self.elf), 'map': pokemon.pin(self.map)}}
        self.receipt_path = self.root/'receipt.json'

    def save(self):
        self.receipt_path.write_text(json.dumps(self.receipt))

    def test_profile_binds_actual_version_and_linked_artifacts(self):
        self.save()
        profile = pokemon.write_firered_elf_profile(self.original, self.receipt_path, self.root/'profile.json')
        self.assertEqual(profile['game_id'], 'pokemon-firered-version-rev1')
        self.assertEqual(profile['elf']['sha256'], pokemon.digest(self.elf))
        self.assertEqual(profile['header_postprocessing']['ranges'], [])

    def test_rev0_receipt_cannot_be_renamed_as_rev1(self):
        self.receipt['revision'] = 0
        self.save()
        with self.assertRaisesRegex(ValueError, 'same exact FireRed revision'):
            pokemon.write_firered_elf_profile(self.original, self.receipt_path, self.root/'bad.json')
        self.assertFalse((self.root/'bad.json').exists())

    def test_changed_elf_rejected_before_profile_write(self):
        self.save()
        self.elf.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Stale source build artifact'):
            pokemon.write_firered_elf_profile(self.original, self.receipt_path, self.root/'bad.json')


if __name__ == '__main__':
    unittest.main()
