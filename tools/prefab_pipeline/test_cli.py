"""Focused routing checks; no ROM builds or broad campaigns."""
import contextlib
import io
import json
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.prefab_pipeline.__main__ import main


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / "result.json"

    def run_cli(self, args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main([*args, "--output", str(self.output)])

    def test_execution_requires_explicit_flag_and_writes_error(self):
        code = self.run_cli(["execute", "--plan", "absent.json", "--output-dir", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("--allow-execute", json.loads(self.output.read_text())["error"])

    def test_blocked_plan_is_observable_and_does_not_execute(self):
        request = self.root / "request.json"
        request.write_text('{"target":"gba"}')
        calls = []
        module = types.ModuleType("tools.prefab_pipeline.composition")
        def planner(value, **kwargs):
            calls.append((value, kwargs))
            return {"status": "blocked", "diagnostics": [{"code": "unsupported_backend"}]}
        module.plan_composition = planner
        with patch.dict("sys.modules", {module.__name__: module}):
            code = self.run_cli(["plan", "--root", str(self.root), "--request", str(request)])
        self.assertEqual(code, 2)
        self.assertTrue(calls[0][1]["verify_files"])
        self.assertEqual(json.loads(self.output.read_text())["diagnostics"][0]["code"], "unsupported_backend")

    def test_mod_rom_dispatches_exact_request_and_output(self):
        request = self.root / "request.json"
        request.write_text('{"request_id":"actual-case","xp_multiplier":2}')
        module = types.ModuleType("tools.prefab_pipeline.mod_rom")
        calls = []
        def executor(value, output):
            calls.append((value, output))
            return {"status": "passed", "artifact": str(output / "modified.gba")}
        module.execute_mod_request = executor
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["mod-rom", "--request", str(request), "--output-dir", str(self.root / "attempt")]), 0)
        self.assertEqual(calls, [({"request_id": "actual-case", "xp_multiplier": 2}, self.root / "attempt")])

    def test_blocked_qualified_build_cannot_bypass_composition(self):
        plan = self.root / "plan.json"
        plan.write_text(json.dumps({"schema": "gameverse.prefab-composition-plan/1",
                                    "preparation_allowed": True, "executable_ready": False,
                                    "backend_plan": {"mode": "qualified-build"}}))
        self.assertEqual(self.run_cli(["execute", "--allow-execute", "--plan", str(plan),
                                       "--output-dir", str(self.root / "attempt")]), 2)
        self.assertIn("executable-ready", json.loads(self.output.read_text())["error"])

    def test_subprocess_failure_retains_public_error_evidence(self):
        request = self.root / "request.json"
        request.write_text('{}')
        module = types.ModuleType("tools.prefab_pipeline.mod_rom")
        def executor(value, output):
            raise subprocess.TimeoutExpired(["bounded-backend"], 30)
        module.execute_mod_request = executor
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["mod-rom", "--request", str(request),
                                           "--output-dir", str(self.root / "attempt")]), 2)
        report = json.loads(self.output.read_text())
        self.assertEqual(report["attempt_directory"], str(self.root / "attempt"))
        self.assertIn("timed out", report["error"])

    def test_build_mod_preserves_candidate_status(self):
        request = self.root / "request.json"
        request.write_text('{"schema":"native-prefab-mod-request/1"}')
        module = types.ModuleType("tools.prefab_pipeline.native_mod")
        calls = []
        def builder(value, output):
            calls.append((value, output))
            return {"status": "candidate-built", "qualification": {"model_pending": True}}
        module.build_native_mod_request = builder
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["build-mod", "--request", str(request),
                                           "--output-dir", str(self.root / "candidate")]), 0)
        self.assertTrue(json.loads(self.output.read_text())["qualification"]["model_pending"])
        self.assertEqual(calls[0][1], self.root / "candidate")

    def test_iteration_routes_config_resume_and_budget_outcome(self):
        request = self.root / "request.json"
        config = self.root / "config.json"
        request.write_text('{"request_id":"experiment"}')
        config.write_text('{"limits":{"model_calls":1}}')
        module = types.ModuleType("tools.prefab_pipeline.iteration")
        calls = []
        def runner(value, settings, output, *, resume):
            calls.append((value, settings, output, resume))
            return {"status": "budget", "model_calls": 1}
        module.run_iteration = runner
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["iterate", "--request", str(request), "--config", str(config),
                                           "--output-dir", str(self.root / "loop"), "--resume"]), 2)
        self.assertEqual(calls, [({"request_id": "experiment"}, {"limits": {"model_calls": 1}},
                                 self.root / "loop", True)])

    def test_phase_extension_routes_versioned_request(self):
        request = self.root / "request.json"
        request.write_text('{"schema":"gameverse.prefab-phase-extension-request/1","request_id":"minish"}')
        module = types.ModuleType("tools.prefab_pipeline.phase_extension")
        calls = []
        def extend(value, output):
            calls.append((value, output))
            return {"status": "passed", "graph": str(output / "extended-graph.json")}
        module.extend_phase_request = extend
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["phase-extend", "--request", str(request),
                                           "--output-dir", str(self.root / "phase")]), 0)
        self.assertEqual(calls[0][0]["request_id"], "minish")
        self.assertEqual(json.loads(self.output.read_text())["graph"], str(self.root / "phase" / "extended-graph.json"))

    def test_prepare_iteration_routes_inputs_without_mutating_template(self):
        request = self.root / "request.json"
        template = self.root / "template.json"
        request.write_text('{"request_id":"fresh-input"}')
        template.write_text('{"limits":{"model_calls":1}}')
        module = types.ModuleType("tools.prefab_pipeline.iteration")
        calls = []
        def prepare(value, settings, run_id):
            calls.append((value, settings, run_id))
            return {"schema": "prefab-iteration/1", "run_id": run_id, **settings}
        module.prepare_iteration_config = prepare
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["prepare-iteration", "--request", str(request),
                                           "--template", str(template), "--run-id", "fresh-001"]), 0)
            saved = self.output.read_text()
            self.assertEqual(self.run_cli(["prepare-iteration", "--request", str(request),
                                           "--template", str(template), "--run-id", "fresh-002"]), 2)
        self.assertEqual(calls, [({"request_id": "fresh-input"}, {"limits": {"model_calls": 1}}, "fresh-001")])
        self.assertEqual(self.output.read_text(), saved)
        self.assertEqual(json.loads(template.read_text()), {"limits": {"model_calls": 1}})

    def test_prepare_iteration_concurrent_output_preserved(self):
        request = self.root / "request.json"
        template = self.root / "template.json"
        request.write_text('{}')
        template.write_text('{}')
        module = types.ModuleType("tools.prefab_pipeline.iteration")
        def prepare(value, settings, run_id):
            self.output.write_text("concurrent agent output\n")
            return {"schema": "prefab-iteration/1", "run_id": run_id}
        module.prepare_iteration_config = prepare
        with patch.dict("sys.modules", {module.__name__: module}):
            self.assertEqual(self.run_cli(["prepare-iteration", "--request", str(request),
                                           "--template", str(template), "--run-id", "fresh-001"]), 2)
        self.assertEqual(self.output.read_text(), "concurrent agent output\n")


if __name__ == "__main__":
    unittest.main()
