"""Bounded discovery command contract; no Ghidra process or ROM access."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("static_discovery_runner", HERE / "run_ghidra.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class StaticDiscoveryTests(unittest.TestCase):
    def test_calls_only_skips_auto_analysis_and_preserves_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = SimpleNamespace(export_only=False, no_decompile=True, decomp_threads=1,
                decomp_timeout=3, ghidra="unused", seed_file=None, ids=["game"],
                seed_oddptr="push", opt=[], no_discover=False, no_auto_analysis=True,
                discover_no_analysis=True, discover_mode="calls", discover_rounds=2,
                discover_candidate_limit=8000, discover_scan_timeout=30, gap_arm=True,
                max_cpu=2, java_home="unused", xmx="2G", rom_timeout=120)
            commands = []
            def fake_wait(cmd, *unused):
                commands.append(cmd)
                (root / "game/summary.json").write_text(json.dumps({"run_id": "test", "function_count": 1}))
                return 0
            with patch.object(runner, "find_seed_file", return_value=None), patch.object(runner, "wait_headless", side_effect=fake_wait):
                runner.run_one({"id": "game", "file": "unused.gba"}, args, "test", "hash", root)
            command = commands[0]
            for arg in ["-noanalysis", "GbaDiscover.java", "call_targets=1", "gap_thumb=0",
                        "gap_arm=0", "analyze_changes=0", "candidate_limit=8000", "budget_ms=30000", "max_rounds=2"]:
                self.assertIn(arg, command)
            self.assertNotIn("GbaReturns.java", command)

    def test_invalid_scan_budget_rejected_before_running(self):
        for value in ["0", "-1", "nan", "inf"]:
            result = subprocess.run([sys.executable, str(HERE / "run_ghidra.py"), "pokemon-emerald-version",
                                     "--discover-scan-timeout", value], capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("limits must be positive", result.stderr)


if __name__ == "__main__":
    unittest.main()
