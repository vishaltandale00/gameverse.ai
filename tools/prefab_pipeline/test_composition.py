"""Cheap planner regressions; no toolchain invocation or native simulation."""
import copy
import unittest
from unittest.mock import patch

from tools.prefab_pipeline.composition import plan_composition
from tools.prefab_pipeline.backends import BackendError


def capsule(identity):
    return {"prefab_id": identity, "level": "L1", "backend": "portable-ir",
            "source": {"kind": "behavior-ir", "engine": "fixture", "abi": "symbolic"},
            "closure": {"status": "open", "missing": []}, "provides": [], "requires": [],
            "state": [], "dependencies": [], "resources": []}


class CompositionTests(unittest.TestCase):
    def plan(self, capsules, **fields):
        with patch("tools.prefab_pipeline.backends.select_backend", return_value={"backend": "test"}), \
             patch("tools.prefab_pipeline.contract.capsule_closed", return_value=True):
            return plan_composition({"target": "gba", "prefabs": capsules, **fields}, verify_files=False)

    def codes(self, plan):
        return {entry["code"] for entry in plan["diagnostics"]}

    def test_stable_dependency_order_and_identity(self):
        a, b = capsule("a"), capsule("b")
        b["dependencies"] = ["a"]
        first, second = self.plan([b, a]), self.plan([a, b])
        self.assertEqual(first["dependency_order"], ["a", "b"])
        self.assertEqual(first["plan_sha256"], second["plan_sha256"])
        self.assertFalse(first["runtime_schedule_inferred"])

    def test_cycle_and_missing_dependency(self):
        a, b = capsule("a"), capsule("b")
        a["dependencies"], b["dependencies"] = ["b", "absent"], ["a"]
        self.assertTrue({"dependency.cycle", "dependency.missing"} <= self.codes(self.plan([a, b])))

    def test_same_name_different_semantics_rejected(self):
        a, b = capsule("a"), capsule("b")
        a["provides"] = [{"id": "progress", "type": "u16", "semantic": {"namespace": "soul"}}]
        b["requires"] = [{"id": "progress", "type": "u16", "semantic": {"namespace": "badge"}}]
        self.assertIn("capability.unsatisfied", self.codes(self.plan([a, b])))
        b["requires"][0]["semantic"] = {"namespace": "soul"}
        self.assertTrue(self.plan([a, b])["executable_ready"])

    def test_ambiguous_provider_needs_explicit_binding(self):
        a, b, c = capsule("a"), capsule("b"), capsule("c")
        port = {"id": "input", "type": "u16", "semantic": "gba-keys"}
        a["provides"], b["provides"], c["requires"] = [port], [port], [copy.deepcopy(port)]
        self.assertIn("capability.ambiguous", self.codes(self.plan([a, b, c])))
        c["requires"][0]["provider"] = "a"
        self.assertTrue(self.plan([a, b, c])["executable_ready"])

    def test_state_type_owner_and_memory_capacity(self):
        a, b = capsule("a"), capsule("b")
        a["state"] = [{"name": "x", "type": "u16", "owner": "a", "lifetime": "session", "access": "write"}]
        b["state"] = [{"name": "x", "type": "u32", "owner": "a", "lifetime": "session", "access": "write"}]
        b["resources"] = [{"kind": "ewram", "bytes": 300000}]
        self.assertTrue({"state.incompatible", "state.write_ownership", "state.multiple_writers", "resource.capacity"} <= self.codes(self.plan([a, b])))

    def test_save_preservation_is_explicit(self):
        a = capsule("a")
        plan = self.plan([a], save_policy={"mode": "preserve", "schema": "save-v1"})
        self.assertIn("save.incompatible", self.codes(plan))

    def test_conditions_are_not_silently_ignored(self):
        plan = self.plan([capsule("a")], schedule={"phases": ["tick"]})
        self.assertIn("schedule.lowering_required", self.codes(plan))

    def test_open_capsule_can_prepare_but_not_reconstruct(self):
        with patch("tools.prefab_pipeline.backends.select_backend", return_value={"backend": "test"}):
            plan = plan_composition({"target": "gba", "prefabs": [capsule("a")]}, verify_files=False)
        self.assertTrue(plan["preparation_allowed"])
        self.assertFalse(plan["executable_ready"])
        self.assertIn("closure.incomplete", self.codes(plan))

    def test_scoped_original_edit_defers_qualification_to_backend(self):
        with patch("tools.prefab_pipeline.backends.select_backend", return_value={"backend": "native-edit"}):
            plan = plan_composition({"target": "gba", "backend": "bounded-original-rom-edit", "prefabs": [capsule("a")]}, verify_files=False)
        self.assertTrue(plan["executable_ready"])
        self.assertIn("inherits original engine", plan["closure_policy"])

    def test_unsupported_heterogeneous_input_produces_bounded_jobs(self):
        with patch("tools.prefab_pipeline.backends.select_backend", side_effect=BackendError("no ABI bridge")):
            plan = plan_composition({"target": "gba", "prefabs": [capsule("a")], "repair_limits": {"max_jobs": 1}}, verify_files=False)
        self.assertIn("backend.unsupported", self.codes(plan))
        self.assertEqual(len(plan["repair_jobs"]), 1)
        self.assertGreater(plan["repair_jobs_omitted"], 0)

    def test_malformed_capsule_is_diagnostic(self):
        self.assertIn("capsule.contract", self.codes(self.plan([{**capsule("a"), "requires": 17}])))


if __name__ == "__main__":
    unittest.main()
