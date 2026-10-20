import json
from pathlib import Path
import struct
import tempfile
import unittest
from .elf_provider import capture_sections, input_sections, load_segments, prepare_elf_profile
from .extract import extract
from .reassemble import assemble, sha


def fixture_elf(data, virtual=0x08000000, physical=0x08000000):
    header = struct.pack("<16sHHIIIIIHHHHHH", b"\x7fELF\x01\x01" + bytes(10), 2, 40, 1, virtual, 52, 0, 0, 52, 32, 1, 0, 0, 0)
    segment = struct.pack("<IIIIIIII", 1, 84, virtual, physical, len(data), len(data), 5, 4)
    return header + segment + data


class ElfProviderTests(unittest.TestCase):
    def test_wrapped_archive_and_nonrom_sections(self):
        text = " .text.long_name\n                0x08000000 0x4 src/actor.o\n .rodata 0x08000004 0x4 lib.a(data.o)\n .bss 0x03000000 0x8 src/actor.o\n"
        self.assertEqual(len(input_sections(text)), 2)
        rows, skipped, mismatch = capture_sections(text, b"abcdefgh", fixture_elf(b"abcdefgh"), rom_base=0x08000000, game_id="fixture")
        self.assertEqual([r["size"] for r in rows], [4, 4])
        self.assertEqual(skipped + mismatch, [])

    def test_precise_postprocessing_does_not_hide_other_bytes(self):
        mapping = " .text 0x08000000 0x8 src/header.o\n"
        rows, _, diff = capture_sections(mapping, b"abXdefgh", fixture_elf(b"abcdefgh"), rom_base=0x08000000, game_id="fixture", exceptions=[{"offset": 2, "size": 1, "reason": "checksum"}])
        self.assertEqual([(r["offset"], r["size"], r["stratum"]) for r in rows], [(0, 2, "object-captured"), (2, 1, "opaque-preserved"), (3, 5, "object-captured")])
        self.assertEqual(diff[0]["different_bytes"], 1)
        with self.assertRaises(ValueError):
            capture_sections(mapping, b"abXdefgY", fixture_elf(b"abcdefgh"), rom_base=0x08000000, game_id="fixture", exceptions=[{"offset": 2, "size": 1, "reason": "checksum"}])

    def test_rom_ram_load_mapping(self):
        rows, _, _ = capture_sections(" .data 0x03000000 0x4 src/copy.o\n", b"data", fixture_elf(b"data", virtual=0x03000000), rom_base=0x08000000, game_id="fixture")
        self.assertEqual(rows[0]["offset"], 0)
        self.assertTrue(rows[0]["contract"]["rom_to_ram_copy"])

    def test_overlap_and_elf_bounds_fail(self):
        with self.assertRaises(ValueError):
            capture_sections(" .text 0x08000000 0x4 src/a.o\n .text 0x08000002 0x4 src/b.o\n", b"abcdefgh", fixture_elf(b"abcdefgh"), rom_base=0x08000000, game_id="fixture")
        with self.assertRaises(ValueError):
            load_segments(fixture_elf(b"data")[:-1])

    def test_pinned_profile_roundtrip_and_failure_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            inputs = {"original": ("original.gba", b"abcdefgh"), "elf": ("linked.elf", fixture_elf(b"abcdefgh")), "map": ("linked.map", b" .text 0x08000000 0x4 src/actor.o\n")}
            config = {"schema": "gameverse.elf-capture-profile/1", "game_id": "fixture", "rom_base": 0x08000000}
            for name, (path, data) in inputs.items():
                (root / path).write_bytes(data)
                config[name] = {"path": path, "sha256": sha(data)}
            path = root / "inputs.json"
            path.write_text(json.dumps(config))
            profile, receipt = prepare_elf_profile(path, root / "provider")
            self.assertEqual(receipt["source_regenerated_bytes"], 0)
            manifest = extract(root / "original.gba", root / "extracted", "fixture", profile)
            (root / "original.gba").unlink()
            self.assertEqual(assemble(root / "extracted/manifest.json")[0], b"abcdefgh")
            self.assertEqual(len(manifest["components"]), 2)
            with self.assertRaises(ValueError):
                prepare_elf_profile(path, root / "failed-provider")
            self.assertEqual(json.loads((root / "failed-provider/provider-receipt.json").read_text())["status"], "failed")


if __name__ == "__main__":
    unittest.main()
