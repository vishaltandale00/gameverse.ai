import copy
import json
from pathlib import Path
import tempfile
import unittest

from tools.prefab_pipeline.contract import file_ref
from tools.prefab_pipeline.stage_closure import resolve_stage_obligations


class StageClosureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("input", "implementation", "evidence"):
            (self.root / name).write_text(name)
        self.need = {"id": "world.metatile-loader", "capability": "metatile-loader", "type": "TilesetHeader-v2",
                     "semantic": {"tiles": 640, "attributes": "u32"}, "scope": "firered-map-import",
                     "input_pins": [file_ref("input", self.root)],
                     "implementation_ref": file_ref("implementation", self.root),
                     "evidence_ref": file_ref("evidence", self.root)}
        self.provider = {**copy.deepcopy(self.need), "id": "map-runtime.metatile-loader"}

    def resolve(self, needs=None, providers=None, verifier=None):
        return resolve_stage_obligations(needs if needs is not None else [self.need],
                                         providers if providers is not None else [self.provider],
                                         root=self.root, verifier=verifier)

    def test_pinned_metadata_is_not_semantic_proof(self):
        result = self.resolve()
        self.assertFalse(result["closed"])
        self.assertEqual(result["unresolved"][0]["reason"], "semantic-verifier-required")

    def test_resolution_retains_raw_obligation(self):
        result = self.resolve(verifier=lambda need, provider, root: True)
        self.assertTrue(result["closed"])
        self.assertEqual(result["raw_needs"], [self.need])
        self.assertEqual(result["resolved"][0]["provider_id"], self.provider["id"])

    def test_semantic_namespace_mismatch_stays_open(self):
        self.provider["semantic"]["attributes"] = "u16"
        self.assertEqual(self.resolve(verifier=lambda *args: True)["unresolved"][0]["reason"], "no-exact-provider")

    def test_stale_file_and_untyped_legacy_blocker_stay_open(self):
        (self.root / "input").write_text("changed")
        self.assertFalse(self.resolve(verifier=lambda *args: True)["closed"])
        self.assertFalse(self.resolve(needs=[{"id": "legacy", "reason": "ready flag false"}], verifier=lambda *args: True)["closed"])

    def test_verifier_failure_or_ambiguity_stays_open(self):
        def fail(*args):
            raise ValueError("coverage incomplete")
        self.assertFalse(self.resolve(verifier=fail)["closed"])
        self.assertFalse(self.resolve(providers=[self.provider, {**self.provider, "id": "other"}], verifier=lambda *args: True)["closed"])


if __name__ == "__main__":
    unittest.main()
