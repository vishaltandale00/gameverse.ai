import unittest
from decode_loaded import decode_lz77


class Lz77Tests(unittest.TestCase):
    def test_literals_and_back_reference(self):
        raw = bytes.fromhex("10 06 00 00 10 41 42 43 00 02")
        self.assertEqual(decode_lz77(raw, 0, 16, 32), (b"ABCABC", 10))

    def test_overlapping_back_reference(self):
        raw = bytes.fromhex("10 06 00 00 40 41 20 00")
        self.assertEqual(decode_lz77(raw, 0, 16, 32), (b"AAAAAA", 8))

    def test_invalid_and_bounded_streams(self):
        for raw, output_limit, input_limit in [
            (bytes.fromhex("10 03 00 00 80 00 00"), 16, 32),
            (bytes.fromhex("10 02 00 00 40 41 00 00"), 16, 32),
            (bytes.fromhex("10 06 00 00 10 41 42 43 00 02"), 5, 32),
            (bytes.fromhex("10 06 00 00 10 41 42 43 00 02"), 16, 8),
            (bytes.fromhex("10 01 00 00 00"), 16, 32),
            (bytes.fromhex("20 01 00 00 00 41"), 16, 32),
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                decode_lz77(raw, 0, output_limit, input_limit)


if __name__ == "__main__":
    unittest.main()
