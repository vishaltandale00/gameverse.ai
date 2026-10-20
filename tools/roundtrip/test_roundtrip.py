import json
from pathlib import Path
import tempfile
import unittest
from .extract import extract
from .reassemble import assemble, reassemble, sha


class RoundtripTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original.gba"
        self.raw = bytes(range(256)) * 4
        self.original.write_bytes(self.raw)
        self.directory = self.root / "extracted"
        self.manifest = extract(self.original, self.directory, "fixture", chunk_bytes=100)
        self.path = self.directory / "manifest.json"

    def change(self, mutation):
        mutation(self.manifest)
        self.path.write_text(json.dumps(self.manifest))

    def test_rebuild_without_original(self):
        self.original.unlink()
        data, layout = assemble(self.path)
        self.assertEqual(data, self.raw)
        self.assertEqual(layout["artifactSha256"], sha(self.raw))

    def test_reject_gap_overlap_bounds_and_relocation(self):
        for key, value in (("offset", 1), ("size", 1025), ("relocations", [{"kind": "unknown"}])):
            with self.subTest(key=key):
                old = self.manifest["components"][0][key]
                self.change(lambda m: m["components"][0].update({key: value}))
                with self.assertRaises(ValueError):
                    assemble(self.path)
                self.change(lambda m: m["components"][0].update({key: old}))

    def test_tampered_artifact_rejected(self):
        (self.directory / self.manifest["components"][0]["artifact"]["path"]).write_bytes(b"x" * 100)
        with self.assertRaises(ValueError):
            assemble(self.path)

    def test_escaping_artifact_rejected(self):
        self.change(lambda m: m["components"][0]["artifact"].update({"path": "../original.gba"}))
        with self.assertRaises(ValueError):
            assemble(self.path)

    def test_no_output_overwrite(self):
        target = self.root / "rebuilt.gba"
        reassemble(self.path, target)
        with self.assertRaises(FileExistsError):
            reassemble(self.path, target)
        with self.assertRaises(ValueError):
            reassemble(self.path, self.original)

    def test_generated_artifact_must_match_original(self):
        artifact = self.root / "compiled.bin"
        artifact.write_bytes(self.raw[64:96])
        profile = self.root / "profile.json"
        profile.write_text(json.dumps({"original_sha256": sha(self.raw), "components": [{"id": "recovered-function", "offset": 64, "size": 32,
            "provider": {"kind": "ir_generated", "generated_artifact": {"path": artifact.name, "sha256": sha(artifact.read_bytes())}, "recipe": "fixture-only"},
            "evidence": ["fixture-only-not-real-game"]}]}))
        directory = self.root / "generated"
        extract(self.original, directory, "fixture", profile)
        self.assertEqual(assemble(directory / "manifest.json")[0], self.raw)
        artifact.write_bytes(b"x" * 32)
        with self.assertRaises(ValueError):
            extract(self.original, self.root / "rejected", "fixture", profile)


if __name__ == "__main__":
    unittest.main()
