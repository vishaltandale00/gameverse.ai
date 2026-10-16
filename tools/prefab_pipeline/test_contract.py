import copy
import tempfile
import unittest
from pathlib import Path

from tools.prefab_pipeline.contract import (
    build_repair_request, cache_key, canonical_hash, capsule_closed, closure_errors,
    file_ref, make_cache_record, validate_capsule, validate_repair_request,
    verify_cache_record, verify_file_ref,
)


class ContractTests(unittest.TestCase):
    @staticmethod
    def backend_verifier(evidence, capsule, root):
        # Stub only for testing contract dispatch. Native receipt semantics are
        # deliberately owned by the backend and cannot be proved by this stub.
        return True

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "evidence.json"
        self.path.write_text('{"outcome":"success"}')
        self.ref = file_ref(self.path)
        self.capsule = {
            "prefab_id": "combat", "level": "L2", "backend": "source-engine-import",
            "source": {"engine": "unknown", "refs": [self.ref]},
            "closure": {"status": "closed", "missing": []}, "gaps": [],
            "lifecycle": {"entry": "start", "exit": "return"},
            "obligations": ["combat-roundtrip"],
            "evidence": [{"kind": k, "status": "passed", "ref": self.ref}
                         for k in ("combat-roundtrip", "lifecycle-entry", "lifecycle-exit")],
        }

    def test_canonical_hash_and_integrity(self):
        self.assertEqual(canonical_hash({"a": 1, "b": 2}), canonical_hash({"b": 2, "a": 1}))
        with self.assertRaises(ValueError):
            canonical_hash(float("nan"))
        self.assertTrue(verify_file_ref(self.ref))
        self.path.write_text("changed")
        self.assertFalse(verify_file_ref(self.ref))
        self.assertTrue(validate_capsule(self.capsule))

    def test_levels_and_metadata_cannot_claim_closure(self):
        self.assertFalse(capsule_closed(self.capsule))
        self.assertTrue(capsule_closed(self.capsule, evidence_verifier=self.backend_verifier))
        self.assertFalse(capsule_closed(self.capsule, evidence_verifier=lambda *args: False))
        for level in ("L0", "L1"):
            capsule = copy.deepcopy(self.capsule)
            capsule["level"] = level
            self.assertEqual(validate_capsule(capsule), [])
            self.assertFalse(capsule_closed(capsule))
        capsule = copy.deepcopy(self.capsule)
        capsule["evidence"] = [{"kind": "combat-roundtrip", "status": "passed", "verified": True}]
        self.assertFalse(capsule_closed(capsule))
        capsule["lifecycle"] = {"entry": True, "exit": True}
        self.assertFalse(capsule_closed(capsule))

    def test_unresolved_gaps_and_missing_lifecycle_prevent_closure(self):
        for changes in ({"gaps": [{"id": "unknown-state"}]},
                        {"dependencies": [{"id": "rng", "resolved": False}]},
                        {"obligations": []}, {"lifecycle": {"entry": None, "exit": None}}):
            capsule = {**self.capsule, **changes}
            self.assertTrue(closure_errors(capsule))
        capsule = copy.deepcopy(self.capsule)
        capsule["lifecycle"]["exit"] = {"status": "not-applicable", "reason": "resident service",
                                           "evidence": self.ref}
        self.assertTrue(capsule_closed(capsule, evidence_verifier=self.backend_verifier))
        del capsule["lifecycle"]["exit"]["reason"]
        self.assertFalse(capsule_closed(capsule))

    def test_cache_checks_versions_configuration_and_artifact_bytes(self):
        key = cache_key("extract", {"extractor": "sha256:abc"}, {"mode": "strict"}, [self.ref])
        other = cache_key("extract", {"extractor": "sha256:def"}, {"mode": "strict"}, [self.ref])
        self.assertNotEqual(key, other)
        self.assertNotEqual(key, cache_key("extract", {"extractor": "sha256:abc"},
                                           {"mode": "partial"}, [self.ref]))
        record = make_cache_record(key, [self.ref], [self.ref], outcome="success",
                                   timing={"total_s": None, "run_id": "run-1"})
        self.assertTrue(verify_cache_record(record, key))
        self.assertFalse(verify_cache_record(record, other))
        failed = {**record, "outcome": "failed"}
        self.assertFalse(verify_cache_record(failed, key))
        self.assertEqual(failed["timing"]["run_id"], "run-1")
        self.path.write_text("stale")
        self.assertFalse(verify_cache_record(record, key))

    def test_semantic_repair_pins_inputs_outputs_limits_and_authority(self):
        request = build_repair_request("repair-1", [self.ref], ["candidate.json"],
                                       {"max_attempts": 2, "max_time_s": 30, "max_cost_usd": 1})
        self.assertEqual(validate_repair_request(request), [])
        promoted = {**request, "can_promote": True}
        self.assertTrue(validate_repair_request(promoted))
        changed = {**request, "inputs": []}
        self.assertTrue(validate_repair_request(changed))
        for field, value in (("max_attempts", True), ("max_time_s", float("inf")),
                             ("max_cost_usd", -1)):
            bad = copy.deepcopy(request)
            bad["limits"][field] = value
            self.assertTrue(validate_repair_request(bad))
        self.path.write_text("changed")
        self.assertTrue(validate_repair_request(request))


if __name__ == "__main__":
    unittest.main()
