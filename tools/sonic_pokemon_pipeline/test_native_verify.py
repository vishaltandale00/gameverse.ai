"""Focused failure tests for the proof's preservation boundary."""
import hashlib
import unittest
from tools.sonic_pokemon_pipeline.native_verify import verify_patch_scope

class PatchScopeTests(unittest.TestCase):
    def row(self,original,replacement,offset=2):
        return {'rom_offset':offset,'length':len(original),
                'original_sha256':hashlib.sha256(original).hexdigest(),
                'replacement_sha256':hashlib.sha256(replacement).hexdigest()}

    def test_accepts_artwork_and_detects_unrelated_code_change(self):
        original=b'abcdefgh';candidate=b'abXYefgh';rows=[self.row(b'cd',b'XY')]
        self.assertTrue(verify_patch_scope(original,candidate,rows)['all_other_rom_bytes_identical'])
        with self.assertRaisesRegex(ValueError,'outside_artwork'):
            verify_patch_scope(original,b'ZbXYefgh',rows)

    def test_rejects_unverified_range_and_overlaps(self):
        with self.assertRaisesRegex(ValueError,'original_range_hash'):
            verify_patch_scope(b'abcdefgh',b'abXYefgh',[self.row(b'QQ',b'XY')])
        row=self.row(b'cd',b'XY')
        with self.assertRaisesRegex(ValueError,'overlapping'):
            verify_patch_scope(b'abcdefgh',b'abXYefgh',[row,row])

if __name__=='__main__':unittest.main()
