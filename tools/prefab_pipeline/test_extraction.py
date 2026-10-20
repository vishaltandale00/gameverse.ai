"""Small deterministic fixtures; no native execution or external tools."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools.prefab_pipeline.extraction import ExtractionLimitError, extract
from tools.prefab_pipeline.contract import validate_capsule


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cache = self.root / "cache"
        self.behavior_hash = self.write("pkg/l1.json", {"state": [{"name": "x", "storage_type": "u8", "owner": "actor"}]})
        self.write("pkg/receipt.json", {"outcome": "pass"})
        self.package_hash = self.write("pkg/package.json", {"behavior": "l1.json", "behavior_sha256": self.behavior_hash, "qualification": {"status": "pass", "receipt": "receipt.json"}, "effects": {"reads": ["x"], "writes": ["x"]}})
        self.write("ontology/executable-components/a.json", {"package_ref": "pkg/package.json", "package_sha256": self.package_hash, "behavior_sha256": self.behavior_hash})
        self.write("ontology/executable-components/index.json", {"entries": [{"id": "a", "record": "a.json", "behavior_sha256": self.behavior_hash}]})
        assembly_hash = self.write("a.json", {"components": {"c": {"package_id": "a", "behavior_sha256": self.behavior_hash}}})
        validation_hash = self.write("v.json", {"valid": True, "interfaces": {"c": {"behavior_sha256": self.behavior_hash, "package_sha256": self.package_hash}}})
        self.write("d.json", {"gameId": "game", "bundles": [{"moduleId": "same-owner", "id": "v1", "packageIds": ["a"], "gaps": ["variant domain unresolved"], "evidence": ["source/missing.c"]}, {"moduleId": "same-owner", "id": "v2", "packageIds": ["a"]}, {"moduleId": "separate-owner", "id": "v1", "packageIds": []}], "coreLoop": {"phases": [{"id": "p", "prefabIds": ["published"], "gaps": ["scheduler unknown"]}], "edges": [{"from": "p", "to": "later", "kind": "host-required"}]}})
        self.write("ontology/game-system-prefabs/manifest.json", {"prefabs": [{"gameId": "game", "id": "published", "moduleId": "same-owner", "descriptorRef": "d.json", "path": "a.json", "sha256": assembly_hash, "validation": "v.json", "validationSha256": validation_hash}]})

    def write(self, ref, data):
        p = self.root / ref
        p.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(data, sort_keys=True).encode()
        p.write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def run_extract(self, **kw):
        return extract(self.root, ["game"], self.cache, **kw)

    def test_capsules_follow_shared_contract(self):
        for candidate in self.run_extract()["candidates"]:
            self.assertEqual(validate_capsule(candidate, root=self.root), [])

    def test_grouping_and_no_false_whole_game_promotion(self):
        result = self.run_extract()
        self.assertEqual(len(result["candidates"]), 2)
        c = next(c for c in result["candidates"] if c["module_id"] == "same-owner")
        self.assertEqual(len(c["bundles"]), 2)
        self.assertEqual(c["package_ids"], ["a"])
        self.assertTrue(c["maturity"]["L1_qualified"])
        self.assertTrue(c["maturity"]["L2_binding_valid"])
        self.assertFalse(c["maturity"]["full_rom"])
        self.assertFalse(c["maturity"]["whole_game"])
        self.assertEqual(c["closure"]["status"], "open")
        self.assertTrue(c["source_edges"])
        self.assertEqual(c["packages"][0]["interface"]["writes"], ["x"])
        self.assertIn("variant_domain", result["semantic_requests"][0]["routing_hints"] if result["semantic_requests"][0]["candidate_id"] == "same-owner" else result["semantic_requests"][1]["routing_hints"])

    def test_cache_invalidation_and_missing_to_present(self):
        a = self.run_extract()["games"][0]
        self.assertFalse(a["cache_hit"])
        self.assertTrue(self.run_extract()["games"][0]["cache_hit"])
        self.write("source/missing.c", {"now": "present"})
        b = self.run_extract()["games"][0]
        self.assertNotEqual(a["cache_key"], b["cache_key"])
        self.assertFalse(b["cache_hit"])
        self.write("pkg/l1.json", {"changed": True})
        c = self.run_extract()
        self.assertNotEqual(b["cache_key"], c["games"][0]["cache_key"])
        candidate = next(x for x in c["candidates"] if x["module_id"] == "same-owner")
        self.assertFalse(candidate["maturity"]["L1_qualified"])
        self.assertFalse(candidate["maturity"]["L2_binding_valid"])

    def test_receipt_failure_cannot_qualify(self):
        self.write("pkg/receipt.json", {"outcome": "failed"})
        candidate = next(x for x in self.run_extract()["candidates"] if x["module_id"] == "same-owner")
        self.assertFalse(candidate["maturity"]["L1_qualified"])
        self.assertFalse(candidate["maturity"]["L2_binding_valid"])
        self.assertEqual(candidate["level"], "L0")

    def test_reject_paths_and_symlinks(self):
        d = json.loads((self.root / "d.json").read_text())
        d["bundles"][0]["evidence"] += ["../secret.json", "https://bad/file.json", "/tmp/secret.json", "escape/data.json"]
        (self.root / "escape").symlink_to("/tmp", target_is_directory=True)
        self.write("d.json", d)
        result = self.run_extract()
        self.assertTrue(any("unsafe" in g for g in result["games"][0]["gaps"]))
        self.assertTrue(any("external" in g for g in result["games"][0]["gaps"]))
        pins = result["games"][0]["input_pins"]
        self.assertFalse(any(p["path"].startswith("../") for p in pins))

    def test_budgets(self):
        with self.assertRaises(ExtractionLimitError):
            self.run_extract(limits={"max_files": 1})
        with self.assertRaises(ExtractionLimitError):
            self.run_extract(limits={"max_bytes": 1})
        self.assertEqual(self.run_extract(limits={"max_requests": 0})["semantic_requests"], [])

    def test_source_receipt_is_unverified_import(self):
        self.write("build/receipt.json", {"game": "game", "schema": "whole-source-build/1", "runId": "one", "status": "passed", "sourceCommit": "1234", "sourceBridgeSha256": "bridge", "baselineMatches": False, "artifacts": {"rom": {"relativePath": "source/game.gba", "sha256": "unverified"}}})
        result = self.run_extract(source_receipts=[Path("build/receipt.json")])
        candidate = next(c for c in result["candidates"] if c["backend"] == "source-engine-import" and "receipt" in c)
        self.assertFalse(candidate["dependencies"][0]["resolved"])
        self.assertEqual(candidate["source"]["commit"], "1234")
        self.assertEqual(candidate["level"], "L0")
        self.assertTrue(any("single-ROM" in g for g in candidate["gaps"]))


if __name__ == "__main__":
    unittest.main()
