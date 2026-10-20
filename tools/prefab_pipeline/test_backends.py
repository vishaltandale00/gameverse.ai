"""Fast registry and receipt rejection tests; no source builds or ROM fixtures."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools.prefab_pipeline import backends as backend


class BackendTests(unittest.TestCase):
    def capsules(self):
        return [{"prefab_id": role, "backend": "source-engine-import",
                 "source": {"role": role, "kind": backend.SOURCE_KIND, "abi": backend.ABI,
                            "engine": pin[0], "commit": pin[1], "path": pin[2], "scope": "complete-tree"}}
                for role, pin in backend.PINS.items()]

    def inventory(self, role, source):
        return {**source, "treeHash": "a" * 40, "files": [{"path": "main.c", "gitBlob": "b" * 40, "mode": "100644"}]}

    def plan(self, **request):
        with patch.object(backend, "_inventory", side_effect=self.inventory), patch.object(backend, "_modules", return_value=[]):
            return backend.select_backend(self.capsules(), {"target": "gba", **request})

    def test_explicit_registry_and_bounded_limits(self):
        plan = self.plan()
        self.assertEqual(plan["backend"], backend.BACKEND)
        self.assertEqual(plan["mode"], "qualified-build")
        self.assertTrue(plan["sources"][0]["files"])
        for limits in ({"jobs": True}, {"jobs": 5}, {"timeout_s": 0}, {"timeout_s": 3601}):
            with self.assertRaises(backend.BackendError):
                self.plan(limits=limits)

    def test_no_filename_inference_or_heterogeneous_fallback(self):
        for field, value in (("engine", "mario"), ("commit", "c" * 40), ("kind", "rom"), ("abi", "unknown")):
            capsules = self.capsules()
            capsules[1]["source"][field] = value
            with self.assertRaisesRegex(backend.BackendError, "unsupported donor"):
                backend.select_backend(capsules, {"target": "gba"})
        with self.assertRaises(backend.BackendError):
            self.plan(mode="development-build")

    def test_plan_tampering_rejected_before_execution(self):
        plan = self.plan()
        plan["limits"]["jobs"] = 3
        with patch.object(backend, "_run") as run, tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(backend.BackendError, "identity changed"):
                backend.execute_backend(plan, tmp)
            run.assert_not_called()

    def test_missing_declared_mechanism_is_explicit_blocker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = root / "tools/whole_game/single_rom/build.py"
            build.parent.mkdir(parents=True)
            build.write_text("STAGES = ('not_landed',)\n")
            with patch.object(backend, "ROOT", root):
                with self.assertRaisesRegex(backend.BackendError, "required backend mechanisms.*not_landed"):
                    backend._modules()

    def execute_receipt(self, merge, *, code=0, mutate=None, validator_error=None):
        plan = self.plan()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        receipt = root / "local/whole-game-mashup/emerald-firered/single-rom/run/merge-receipt.json"
        receipt.parent.mkdir(parents=True)
        receipt.write_text(json.dumps(merge))
        output = root / "result"

        def run(command, timeout, stdout, stderr):
            self.assertNotIn("build-development", command)
            self.assertIn("--timeout", command)
            stdout.write_text(str(receipt) + "\n")
            stderr.write_text("")
            if mutate:
                mutate()
            return code

        with patch.object(backend, "ROOT", root), patch.object(backend, "_validate_plan"), patch.object(backend, "_run", side_effect=run), patch("tools.whole_game.single_pipeline.verify_merge", side_effect=validator_error):
            with self.assertRaises(backend.BackendError):
                backend.execute_backend(plan, output)
        result = json.loads((output / "backend-result.json").read_text())
        self.assertFalse(result["publishable"])
        self.assertEqual(result["status"], "failed")
        self.assertGreaterEqual(result["totalWallMs"], 0)
        return result

    def merge(self, **fields):
        return {"status": "built", "buildEligible": True, "unresolved": [],
                "base": {"treeHash": "a" * 40}, "donor": {"treeHash": "a" * 40}, **fields}

    def test_development_and_blocked_receipts_fail_closed(self):
        for merge in (self.merge(status="built_development"), self.merge(buildEligible=False), self.merge(unresolved=["missing"])):
            self.assertIn("strict source build", self.execute_receipt(merge)["error"])

    def test_nonzero_return_code_rejected_even_with_built_receipt(self):
        self.assertIn("exited 2", self.execute_receipt(self.merge(), code=2)["error"])

    def test_missing_source_build_receipt_rejected(self):
        self.execute_receipt(self.merge())

    def test_changed_source_build_receipt_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            receipt = Path(tmp) / "receipt.json"
            receipt.write_text("{}")
            result = self.execute_receipt(self.merge(sourceBuildReceipt={"path": str(receipt), "sha256": "0" * 64}))
            self.assertIn("identity mismatch", result["error"])

    def test_existing_validator_failures_are_not_bypassed(self):
        self.assertIn("incomplete inventory", self.execute_receipt(self.merge(), validator_error=ValueError("incomplete inventory"))["error"])

    def test_original_edit_routing_is_explicit(self):
        with patch.object(backend, "_select_original_edit", return_value={"selected": True}) as select:
            self.assertEqual(backend.select_backend([], {"backend": "bounded-original-rom-edit"}), {"selected": True})
            self.assertEqual(backend.select_backend([{"backend": "native-rom-patch"}], {}), {"selected": True})
            self.assertEqual(select.call_count, 2)

    def test_unrelated_original_edit_capsule_rejected(self):
        capsule = {"backend": "native-rom-patch", "prefab_id": "unrelated", "source": {"sha256": "a" * 64},
                   "modification_scope": {"package_ref": {"path": "package.json", "sha256": "b" * 64}}}
        request = {"backend": "bounded-original-rom-edit", "prefab_id": "requested", "rom": {"sha256": "a" * 64},
                   "package": {"path": "package.json", "sha256": "b" * 64}}
        with self.assertRaisesRegex(backend.BackendError, "does not match"):
            backend.select_backend([capsule], request)

    def test_selective_source_capsules_cannot_invoke_full_importer(self):
        capsules = self.capsules()
        capsules[0]["source"].pop("scope")
        with self.assertRaisesRegex(backend.BackendError, "complete-tree"):
            backend.select_backend(capsules, {"target": "gba"})

    def test_original_edit_nonqualified_result_rejected(self):
        plan = {"backend": "bounded-original-rom-edit", "request": {}, "sha256": "a" * 64}
        with patch.object(backend, "_validate_plan"), patch("tools.prefab_pipeline.mod_rom.execute_mod_request", return_value={"status": "failed"}), tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(backend.BackendError, "qualified bounded"):
                backend.execute_backend(plan, tmp)

    def test_original_edit_success_label_does_not_replace_artifact_evidence(self):
        plan = {"backend": "bounded-original-rom-edit", "request": {}, "sha256": "a" * 64}
        result = {"status": "qualified-bounded-modification", "artifact": "/does/not/exist.gba"}
        with patch.object(backend, "_validate_plan"), patch("tools.prefab_pipeline.mod_rom.execute_mod_request", return_value=result), tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(backend.BackendError, "artifact or causal"):
                backend.execute_backend(plan, tmp)

    def test_process_timeout_kills_group(self):
        process = unittest.mock.Mock(pid=123)
        process.wait.side_effect = [subprocess.TimeoutExpired("build", 1), -9]
        with tempfile.TemporaryDirectory() as tmp, patch.object(backend.subprocess, "Popen", return_value=process), patch.object(backend.os, "killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                backend._run(["build"], 1, Path(tmp) / "out", Path(tmp) / "err")
            kill.assert_called_once_with(123, backend.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
