"""Statistical and integration regressions; synthetic fixtures are not gameplay evidence."""
import copy
import unittest

from tools.decisions import ProviderConfig
from .calibration import OutcomeCalibration, build_artifact, exact_interval, fingerprint
from .models import DecisionPolicy


def spec():
    return dict(scope={k: k for k in ("game_id", "game_version", "adapter_version", "profile_sha256",
                                     "provider", "model", "endpoint", "policy_sha256")},
                protocol={**{k: "synthetic unit test only" for k in
                             ("label_definition", "label_version", "sampling_plan", "independence_basis",
                              "split_rule", "horizon", "source_evidence_basis")}, "prespecified": True},
                edges=[0., .5, 1.], target_success=.65, alpha=.05)


def samples(config, n=30):
    return [{"scope": config["scope"], "independent_group": str(i), "evidence_sha256": fingerprint(i),
             "label_basis": "source_gameplay_outcome", "proposed_action": "left", "executed_action": "left",
             "label": True, "raw_score": .3, "split": "fit" if i < n else "heldout"} for i in range(2 * n)]


def calibrator(config, rows):
    artifact = build_artifact(**config, samples=rows)
    return OutcomeCalibration({"spec": config, "samples": rows, "artifact_sha256": artifact["artifact_sha256"]})


class CalibrationTests(unittest.TestCase):
    def test_exact_limits(self):
        self.assertEqual(exact_interval(0, 0), [0., 1.])
        self.assertAlmostEqual(exact_interval(10, 10)[0], .025 ** .1)
        self.assertAlmostEqual(exact_interval(0, 10)[1], 1 - .025 ** .1)
        lo, hi = exact_interval(5, 10)
        self.assertAlmostEqual(lo, .1870860284473985)
        self.assertAlmostEqual(hi, .8129139715526015)

    def test_sparse_and_unseen_bins_escalate(self):
        config = spec()
        gate = calibrator(config, samples(config, 2))
        self.assertFalse(gate.evaluate(.3, config["scope"])["accepted"])
        self.assertEqual(gate.evaluate(.9, config["scope"])["interval"], [0., 1.])

    def test_heldout_failure_blocks_even_perfect_fit(self):
        config = spec()
        rows = samples(config)
        for row in rows[30:]:
            row["label"] = False
        gate = calibrator(config, rows)
        self.assertFalse(gate.evaluate(.3, config["scope"])["accepted"])

    def test_unknowns_count_against_gate(self):
        config = spec()
        rows = samples(config)
        for row in rows[30:]:
            row["label"] = None
        gate = calibrator(config, rows)
        self.assertFalse(gate.evaluate(.3, config["scope"])["accepted"])
        self.assertEqual(gate.artifact["bins"][0]["heldout"]["trials"], 30)

    def test_validated_lower_score_and_scope_shift(self):
        config = spec()
        gate = calibrator(config, samples(config))
        result = gate.evaluate(.3, config["scope"])
        self.assertTrue(result["accepted"])
        self.assertEqual(result["estimate"], 1.)
        self.assertGreater(result["interval"][0], .65)
        self.assertFalse(gate.evaluate(.3, dict(config["scope"], game_version="other"))["accepted"])

    def test_rejects_leakage_and_invalid_labels(self):
        config = spec()
        for change in ("group", "evidence", "s2_agreement", "unexecuted", "wrong_scope"):
            rows = samples(config)
            if change == "group": rows[-1]["independent_group"] = rows[0]["independent_group"]
            if change == "evidence": rows[-1]["evidence_sha256"] = rows[0]["evidence_sha256"]
            if change == "s2_agreement": rows[-1]["label_basis"] = "system2_agreement"
            if change == "unexecuted": rows[-1]["executed_action"] = "right"
            if change == "wrong_scope": rows[-1]["scope"] = dict(config["scope"], game_id="other")
            with self.subTest(change=change), self.assertRaises(ValueError):
                calibrator(config, rows)

    def test_model_uses_calibrated_gate_but_still_rejects_stop_and_inconsistency(self):
        class Client:
            config = ProviderConfig(api_key="fake")
            choice = "left"
            def decide(self, request, **kwargs):
                return {"status": "success", "answers": [{"name": "action", "type": "choice",
                    "choice": self.choice, "confidence": .3, "probabilities": [
                        {"value": "left", "probability": .4}, {"value": "right", "probability": .3},
                        {"value": "STOP", "probability": .3}]}]}
        context = {"run_id": "r", "game_id": "g", "game_version": "rom", "adapter_version": "a",
                   "profile_sha256": "p", "awareness": {"perspective": "side_view", "locomotion": "platform"},
                   "memory": {}, "observation": {"frame": 0, "state_key": "s", "facts": {}}}
        options = [{"id": "left", "description": "left"}, {"id": "right", "description": "right"}]
        client = Client()
        policy = DecisionPolicy(client=client)
        first = policy.choose(context, options, 1)
        self.assertFalse(first["accepted"])
        config = spec()
        config["scope"] = first["calibration_scope"]
        policy.calibration = calibrator(config, samples(config))
        self.assertTrue(policy.choose(context, options, 1)["accepted"])
        client.choice = "STOP"
        self.assertFalse(policy.choose(context, options, 1)["accepted"])
        client.choice = "right"
        self.assertEqual(policy.choose(context, options, 1)["reason"], "inconsistent_distribution_choice")
        context["game_version"] = "changed"
        client.choice = "left"
        self.assertFalse(policy.choose(context, options, 1)["accepted"])


if __name__ == "__main__":
    unittest.main()
