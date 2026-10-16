"""Focused opt-in CFG repair checks: no ROM campaigns or new dependencies."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("return_repair_runner", HERE / "run_ghidra.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ReturnRepairTests(unittest.TestCase):
    def invoke(self, root, requested=False, repair_record=True):
        (root / "game/ghidra_project").mkdir(parents=True)
        args = SimpleNamespace(export_only=True, no_decompile=False, decomp_threads=1,
                               decomp_timeout=1, ghidra="unused", no_discover=True,
                               max_cpu=1, java_home="unused", xmx="1G", rom_timeout=1,
                               repair_returns=requested)
        commands = []
        def fake_wait(command, *unused):
            commands.append(command)
            (root / "game/summary.json").write_text(json.dumps({"run_id": "test", "function_count": 1}))
            if requested and repair_record:
                (root / "game/returns.json").write_text(json.dumps({"run_id": "test", "heuristic": True, "flow_overrides": 0}))
            return 0
        with patch.object(runner, "wait_headless", side_effect=fake_wait):
            result = runner.run_one({"id": "game", "file": "unused.gba"}, args, "test", "hash", root)
        return result, commands[0]

    def test_default_off_does_not_schedule_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, command = self.invoke(Path(tmp))
            self.assertEqual(result["status"], "ok")
            self.assertNotIn("GbaReturns.java", command)
            self.assertIn("repair_returns=0", command)

    def test_opt_in_runs_before_export_readonly(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, command = self.invoke(Path(tmp), True)
            self.assertEqual(result["status"], "ok")
            self.assertLess(command.index("GbaReturns.java"), command.index("GbaExport.java"))
            self.assertIn("-readOnly", command)
            self.assertIn("-noanalysis", command)

    def test_export_cannot_mask_missing_repair_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, _ = self.invoke(Path(tmp), True, False)
            self.assertEqual(result["status"], "failed")
            self.assertIn("returns.json", result["error"])

    def test_opt_in_preserves_previous_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "game").mkdir()
            (root / "game/functions.jsonl").write_text('previous pseudo-C export\n')
            result, _ = self.invoke(root, True)
            backup = Path(result["prior_export_backup"]["path"])
            self.assertEqual((backup / "functions.jsonl").read_text(), 'previous pseudo-C export\n')

    def test_java_exact_opcode_controls_and_export_compile(self):
        home = Path("/opt/homebrew/opt/ghidra/libexec")
        java = Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin")
        if not home.exists() or not (java / "javac").exists():
            self.skipTest("installed Ghidra/JDK unavailable")
        classpath = ":".join(str(p) for p in home.rglob("*.jar"))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture = root / "ReturnOpcodeControl.java"
            fixture.write_text('''public class ReturnOpcodeControl {
              static void check(boolean v) { if(!v) throw new AssertionError(); }
              public static void main(String[] args) {
                check(GbaReturns.pushesEntryLr(0xb530));
                check(!GbaReturns.pushesEntryLr(0xb430));
                check(GbaReturns.singletonPopBxRegister(0xbc01,0x4700)==0);
                check(GbaReturns.singletonPopBxRegister(0xbc02,0x4708)==1);
                check(GbaReturns.singletonPopBxRegister(0xbc03,0x4700)==-1);
                check(GbaReturns.singletonPopBxRegister(0xbd01,0x4700)==-1);
                check(GbaReturns.singletonPopBxRegister(0xbc01,0x4708)==-1);
                check(GbaReturns.singletonPopBxRegister(0xbc01,0x4780)==-1);
                check(GbaReturns.singletonPopBxRegister(0xbc01,0x4687)==-1);
                check(GbaReturns.singletonPopBxRegister(0xbc01,0x4740)==-1);
              }
            }''')
            subprocess.run([str(java / "javac"), "-proc:none", "-cp", classpath, "-d", tmp,
                            str(HERE / "GbaReturns.java"), str(HERE / "GbaExport.java"), str(fixture)],
                           check=True, capture_output=True, text=True, timeout=20)
            subprocess.run([str(java / "java"), "-cp", tmp + ":" + classpath, "ReturnOpcodeControl"],
                           check=True, capture_output=True, text=True, timeout=10)


if __name__ == "__main__":
    unittest.main()
