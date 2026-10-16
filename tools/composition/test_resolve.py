"""Small semantic checks, no ROM, compiler, model calls or network."""
import copy
import json
from pathlib import Path
import unittest

from tools.composition.resolve import resolve

EXAMPLES = Path(__file__).with_name("examples")


def example(name):
    return json.loads((EXAMPLES / (name + ".json")).read_text())


class CompositionChecks(unittest.TestCase):
    def test_direct_motion_graft_reports_real_classes_of_conflict(self):
        result = resolve(example("sonic-mzm-unadapted"))
        codes = {e["code"] for e in result["errors"]}
        self.assertTrue({"WRITE_CONFLICT", "TYPE_MISMATCH", "ROUTE_CAPABILITY_MISSING"} <= codes)

    def test_hybrid_resolves_declared_types_and_authority_but_not_routes(self):
        result = resolve(example("sonic-mzm-hybrid-proposal"))
        self.assertEqual([], result["errors"])
        self.assertEqual("unresolved", result["status"])
        self.assertFalse(result["ready_for_lowering"])
        codes = {e["code"] for e in result["obligations"]}
        self.assertTrue({"TRANSFORM_PROOF_REQUIRED", "TRANSITION_WITNESS_REQUIRED",
                         "ROUTE_WITNESS_REQUIRED", "RECOVERY_EVIDENCE_REQUIRED"} <= codes)

    def test_surface_mode_cannot_lose_its_authority(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["components"][2]["accesses"] = []
        self.assertIn("AUTHORITY_COVERAGE", {e["code"] for e in resolve(plan)["errors"]})

    def test_claimed_transform_cannot_hide_coordinate_frame_mismatch(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["transforms"][0]["output_type"]["frame"] = "world_y_up"
        self.assertIn("TRANSFORM_TYPE_MISMATCH", {e["code"] for e in resolve(plan)["errors"]})

    def test_party_snapshot_does_not_imply_cartridge_save(self):
        result = resolve(example("mzm-pokemon-wild-lifecycle-audit"))
        self.assertIn("SAVE_CAPABILITY_MISSING", {e["code"] for e in result["errors"]})

    def test_unknown_peak_budget_is_not_recorded_as_zero(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["budgets"] = [{"resource": "obj_tiles_bytes", "limit": 32768,
                            "aggregation": "conservative_sum_of_selected_peaks"}]
        result = resolve(plan)
        self.assertIn("BUDGET_UNKNOWN", {e["code"] for e in result["obligations"]})
        plan["components"][0]["resources"] = {"obj_tiles_bytes": 32769}
        self.assertIn("BUDGET_EXCEEDED", {e["code"] for e in resolve(plan)["errors"]})

    def test_dependency_closure_is_required(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["components"][0]["requires_components"] = ["missing.contact_adapter"]
        self.assertIn("DEPENDENCY_MISSING", {e["code"] for e in resolve(plan)["errors"]})

    def test_multiple_providers_need_explicit_arbitration(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["bindings"].append(copy.deepcopy(plan["bindings"][0]))
        self.assertIn("INPUT_MULTIPLE_BINDINGS", {e["code"] for e in resolve(plan)["errors"]})

    def test_unknown_contract_is_not_silently_accepted(self):
        plan = example("sonic-mzm-hybrid-proposal")
        plan["new_semantic_contract"] = {"claim": "all routes proven"}
        self.assertIn("UNSUPPORTED_FIELD", {e["code"] for e in resolve(plan)["obligations"]})


if __name__ == "__main__":
    unittest.main()
