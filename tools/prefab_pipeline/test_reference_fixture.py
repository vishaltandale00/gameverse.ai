"""Offline authored fixture integration; no native emulator or provider."""
import json
import tempfile
import unittest
from pathlib import Path

from .reference_fixture import run_reference_fixture


REQUEST = {"schema": "gameverse.reference-fixture-request/1", "request_id": "fixture-test",
           "fixture_id": "reference-key-door", "operation": "engine-demonstration"}


class ReferenceFixtureTests(unittest.TestCase):
    def test_existing_engine_and_independent_action_log_checkpoint(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "fresh"
            result = run_reference_fixture(REQUEST, output)
            self.assertEqual(result["status"], "passed", result)
            self.assertTrue(all(result["tests"].values()))
            self.assertEqual(result["action_count"], 18)
            self.assertEqual(result["repairs"], 0)
            self.assertFalse(result["gba_generation"])
            self.assertFalse(result["game_material_required"])
            self.assertEqual(json.loads((output / "engine/report.json").read_text())["decision_calls"], 0)
            with self.assertRaises(FileExistsError):
                run_reference_fixture(REQUEST, output)

    def test_unknown_fixture_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "unsupported"
            with self.assertRaises(ValueError):
                run_reference_fixture({**REQUEST, "fixture_id": "arbitrary"}, output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
