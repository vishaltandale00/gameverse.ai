"""Narrow retained-fixture checks; no toolchain or emulator invocation."""
import copy
import json
from pathlib import Path
import unittest

from tools.roundtrip.memory_ontology import canonical, compile_edit, sha
from tools.memory_ontology.mzm import expansion_plan


class MzmAnimationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = Path("local/memory-ontology-20261016/mzm")
        if not (cls.folder / "manifest.json").exists():
            raise unittest.SkipTest("Private MZM extraction fixture unavailable")
        cls.manifest = json.loads((cls.folder / "manifest.json").read_text())
        cls.snapshot = json.loads((cls.folder / "snapshot.json").read_text())
        cls.rom = Path("local/game-builds/mzm-us-baseline/mzm_us.gba").read_bytes()

    def request(self, manifest, operation):
        return {"manifest_sha256": sha(canonical(manifest)), "operations": [operation]}

    def test_identity_and_expansion_preserve_retained_host(self):
        table = self.manifest["tables"][0]
        unchanged = compile_edit(self.manifest, self.rom, self.request(self.manifest, {
            "op": "set", "table": table["id"], "index": 0, "field": "word0", "value": table["rows"][0]["word0"]}))
        self.assertEqual(unchanged["rom"], self.rom)
        result = compile_edit(self.manifest, self.rom, self.request(self.manifest, {
            "op": "append", "table": table["id"], "row": table["rows"][0]}))
        descriptor = next(a for a in self.manifest["allocations"] if a["id"] == "sAnimatedGraphicsEntries")["rom_offset"] + 18 * 8
        allowed = {descriptor + 2, *range(descriptor + 4, descriptor + 8)}
        differences = {i for i, (a, b) in enumerate(zip(self.rom, result["rom"])) if a != b}
        self.assertTrue(differences <= allowed)
        self.assertEqual(len(result["rom"]) - len(self.rom), 640)
        self.assertEqual(result["rom"][-640:-128], bytes.fromhex(table["snapshot_hex"]))
        self.assertEqual(result["rom"][-128:], bytes.fromhex(table["snapshot_hex"])[:128])

    def test_stale_data_binding_rejected(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["tables"][0]["bindings"][0]["expected"] = 5
        with self.assertRaisesRegex(ValueError, "stale dependent binding"):
            compile_edit(manifest, self.rom, self.request(manifest, {
                "op": "append", "table": manifest["tables"][0]["id"], "row": manifest["tables"][0]["rows"][0]}))

    def test_open_native_closure_never_promoted(self):
        self.assertEqual(self.snapshot["native_consumer_closure"], "unresolved")
        self.assertEqual(self.snapshot["new_behavior_ir_bytes"], 0)
        with self.assertRaises(ValueError):
            expansion_plan(self.snapshot, new_count=128)
        with self.assertRaises(ValueError):
            expansion_plan(self.snapshot, entry=1, new_count=5)


if __name__ == "__main__":
    unittest.main()
