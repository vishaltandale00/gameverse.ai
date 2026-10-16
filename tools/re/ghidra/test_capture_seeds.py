"""Offline capture/Ghidra seed contract checks; no ROM analysis or network.

Run: python3 -m unittest discover -s tools/re/ghidra -p 'test_*.py' -v
Java checks compile only the production parser methods using Ghidra's bundled
Gson (no new dependency). They skip when that optional local toolchain is absent.
"""
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("run_ghidra", HERE / "run_ghidra.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class SeedDiscoveryTests(unittest.TestCase):
    def test_no_auto_analysis_keeps_explicit_seed_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp)
            args = SimpleNamespace(export_only=False, no_decompile=False, decomp_threads=1, decomp_timeout=1,
                                   ghidra="unused", seed_file=None, ids=["game"], seed_oddptr="off", opt=[],
                                   no_discover=True, no_auto_analysis=True, capture_root=out_root / "captures",
                                   max_cpu=1, java_home="unused", xmx="1G", rom_timeout=1)
            commands = []
            def fake_wait(cmd, *unused):
                commands.append(cmd)
                (out_root / "game/summary.json").write_text('{"run_id": "test", "function_count": 1}')
                return 0
            with patch.object(runner, "find_seed_file", return_value=None) as seeds, patch.object(runner, "wait_headless", side_effect=fake_wait):
                result = runner.run_one({"id": "game", "file": "unused.gba"}, args, "test", "hash", out_root)
            self.assertEqual(result["mode"], "seeded-no-auto-analysis")
            self.assertIn("-noanalysis", commands[0])
            self.assertIn("decompile=1", commands[0])
            self.assertIn("auto_analysis=0", commands[0])
            self.assertIn("reuse_project=0", commands[0])
            self.assertNotIn("GbaDiscover.java", commands[0])
            self.assertEqual(seeds.call_args.args[3], args.capture_root)

    def test_export_only_marks_prior_analysis_as_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp)
            (out_root / "game/ghidra_project").mkdir(parents=True)
            args = SimpleNamespace(export_only=True, no_decompile=False, decomp_threads=1, decomp_timeout=1,
                                   ghidra="unused", max_cpu=1, java_home="unused", xmx="1G", rom_timeout=1)
            commands = []
            def fake_wait(cmd, *unused):
                commands.append(cmd)
                (out_root / "game/summary.json").write_text('{"run_id": "test", "function_count": 1}')
                return 0
            with patch.object(runner, "wait_headless", side_effect=fake_wait):
                runner.run_one({"id": "game", "file": "unused.gba"}, args, "test", "hash", out_root)
            self.assertIn("reuse_project=1", commands[0])
            self.assertIn("auto_analysis=0", commands[0])
            self.assertIn("-noanalysis", commands[0])
            self.assertIn("-readOnly", commands[0])

    def test_custom_capture_root_merges_isolated_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "isolated/game/gameplay/coverage.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"regions":{"rom":{"functions":[["0x08000021","T",4]]}}}')
            path = runner.find_seed_file("game", None, root / "out", root / "isolated")
            seeds = json.loads(Path(path).read_text())
            self.assertEqual(seeds["entries"], [{"addr": 0x08000020, "mode": "thumb"}])
            self.assertEqual(seeds["sources"][0]["path"], str(target))

    def test_capture_seed_cap_prioritizes_observed_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "captures/game/gameplay/coverage.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"regions":{"rom":{"functions":[["0x08000020","T",1],["0x08000040","T",9],["0x08000060","T",4]]}}}')
            path = runner.find_seed_file("game", None, root / "out", root / "captures", 2)
            seeds = json.loads(Path(path).read_text())
            self.assertEqual(seeds["available_call_targets"], 3)
            self.assertEqual(seeds["selected_call_targets"], 2)
            self.assertEqual([e["addr"] for e in seeds["entries"]], [0x08000040, 0x08000060])

    def test_export_cannot_mask_failed_seed_setup(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp)
            args = SimpleNamespace(export_only=False, no_decompile=True, decomp_threads=1, decomp_timeout=1,
                                   ghidra="unused", seed_file=None, ids=["game"], seed_oddptr="off", opt=[],
                                   no_discover=True, max_cpu=1, java_home="unused", xmx="1G", rom_timeout=1)
            rom = {"id": "game", "file": "unused.gba"}
            def fake_wait(*unused):
                (out_root / "game/summary.json").write_text('{"run_id": "test", "function_count": 1}')
                return 0
            with patch.object(runner, "find_seed_file", return_value="configured.json"), patch.object(runner, "wait_headless", side_effect=fake_wait):
                result = runner.run_one(rom, args, "test", "hash", out_root)
            self.assertEqual(result["status"], "failed")
            self.assertIn("confirming configured seeds", result["error"])

    def test_timeout_stops_launcher_process_group(self):
        # Use a real short-lived launcher that would otherwise leave its child
        # writing evidence after the configured timeout.
        import sys
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "orphan-output"
            child = "import time,pathlib;time.sleep(.8);pathlib.Path(" + repr(str(marker)) + ").write_text('orphan')"
            launcher = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c'," + repr(child) + "]);time.sleep(5)"
            with open(os.devnull, "w") as log, self.assertRaises(subprocess.TimeoutExpired):
                runner.wait_headless([sys.executable, "-c", launcher], log, dict(os.environ), .2)
            # A separate bounded process is sufficient to let any orphan write.
            subprocess.run([sys.executable, "-c", "import time; time.sleep(.9)"], check=True, timeout=2)
            self.assertFalse(marker.exists())

    def test_merges_phases_and_keeps_only_rom_call_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            cap = repo / "local/captures/game"
            for phase, functions in [("attract", [["0x08000000", "A", 1], ["0x08000021", "T", 9]]),
                                     ("frontend", [["0x08000020", "T", 5], ["0x08000040", "T", 4]])]:
                target = cap / phase / "coverage.json"
                target.parent.mkdir(parents=True)
                target.write_text(json.dumps({"regions": {
                    "rom": {"functions": functions, "blocks": [["0x08009998", "T", 3, 4, 5]]},
                    "iwram": {"functions": [["0x03000000", "A", 9]]}}}))
            with patch.object(runner, "REPO", repo):
                path = runner.find_seed_file("game", None, repo / "out")
            seeds = json.loads(Path(path).read_text())
            self.assertEqual(seeds["entries"], [{"addr": 0x08000000, "mode": "arm"},
                                               {"addr": 0x08000020, "mode": "thumb"},
                                               {"addr": 0x08000040, "mode": "thumb"}])
            self.assertEqual(len(seeds["sources"]), 2)
            self.assertTrue(all(len(s["sha256"]) == 64 for s in seeds["sources"]))

    def test_explicit_or_consolidated_file_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            cap = repo / "local/captures/game"
            cap.mkdir(parents=True)
            consolidated = cap / "seeds-reviewed.json"
            consolidated.write_text("[]")
            with patch.object(runner, "REPO", repo):
                self.assertEqual(runner.find_seed_file("game", str(consolidated), repo / "out"), str(consolidated))
                self.assertEqual(runner.find_seed_file("game", None, repo / "out"), str(consolidated))
                self.assertIsNone(runner.find_seed_file("missing", None, repo / "out"))
                with self.assertRaises(FileNotFoundError):
                    runner.find_seed_file("game", str(repo / "missing.json"), repo / "out")

    def test_malformed_capture_fails_instead_of_silently_dropping_seeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            target = repo / "local/captures/game/frontend/coverage.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"regions": {"rom": {}}}')
            with patch.object(runner, "REPO", repo), self.assertRaises(KeyError):
                runner.find_seed_file("game", None, repo / "out")

    def test_current_emerald_capture(self):
        cap = runner.REPO / "local/captures/pokemon-emerald-version"
        paths = sorted(cap.glob("*/coverage.json"))
        if not paths:
            self.skipTest("optional local Emerald captures unavailable")
        expected = set()
        for path in paths:
            for addr, mode, *_ in json.loads(path.read_text())["regions"]["rom"]["functions"]:
                value = int(addr, 0)
                thumb = mode.lower().startswith("t")
                expected.add((value & (~1 if thumb else ~3), "thumb" if thumb else "arm"))
        with tempfile.TemporaryDirectory() as tmp:
            generated = runner.find_seed_file("pokemon-emerald-version", None, tmp)
            actual = json.loads(Path(generated).read_text())
        self.assertEqual({(e["addr"], e["mode"]) for e in actual["entries"]}, expected)
        self.assertGreater(len(expected), 0)


class JavaSeedParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        java_home = Path(os.environ.get("JAVA_HOME", runner.DEFAULT_JAVA))
        javac, java = java_home / "bin/javac", java_home / "bin/java"
        ghidra_home = Path(os.environ.get("GHIDRA_HOME", runner.DEFAULT_GHIDRA))
        jars = list(ghidra_home.glob("Ghidra/Framework/Generic/lib/gson-*.jar"))
        if not javac.exists() or not java.exists() or not jars:
            raise unittest.SkipTest("optional JDK/Ghidra Gson unavailable")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        root = Path(cls.tmp.name)
        source = (HERE / "GbaSetup.java").read_text()
        # Compile the actual dependency-free production parser methods, rather
        # than a separate parser mirroring their behavior.
        methods = source[source.index("\tstatic long[] decodeSeed("):source.index("\n\t/** Seed file: maps")]
        exporter = (HERE / "GbaExport.java").read_text()
        methods += exporter[exporter.index("\tstatic void quarantineIoDirections("):exporter.index("\n\tint writeStrings(")]
        harness = """import java.util.*;
public class SeedParserCheck {
METHODS
public static void main(String[] args) throws Exception {
 if (args[0].equals("--io-check")) {
  Map<String,Object> record = new LinkedHashMap<>();
  record.put("io_read", Set.of("DISPCNT"));
  record.put("io_write", Set.of("BG0HOFS"));
  record.put("io_ref", Set.of("DMA3SAD"));
  quarantineIoDirections(record);
  if (!record.get("io_read").equals(Set.of()) || !record.get("io_write").equals(Set.of())) throw new AssertionError("directions leaked");
  if (!record.get("io_ref").equals(Set.of("DISPCNT", "BG0HOFS", "DMA3SAD"))) throw new AssertionError("register hints lost");
  if (!record.get("io_direction_verified").equals(false)) throw new AssertionError("verification overstated");
  Map<?,?> hints = (Map<?,?>) record.get("io_direction_hints");
  if (!hints.get("read").equals(Set.of("DISPCNT")) || !hints.get("write").equals(Set.of("BG0HOFS"))) throw new AssertionError("raw hints lost");
  System.out.print("ok"); return;
 }
 Object root = new com.google.gson.Gson().fromJson(java.nio.file.Files.readString(java.nio.file.Path.of(args[0])), Object.class);
 List<long[]> decoded = new ArrayList<>();
 for (Object row : seedRows(root)) { long[] seed = decodeSeed(row); if (seed != null) decoded.add(seed); }
 System.out.print(new com.google.gson.Gson().toJson(decoded));
}
}
""".replace("METHODS", methods)
        target = root / "SeedParserCheck.java"
        target.write_text(harness)
        subprocess.run([str(javac), "-cp", str(jars[0]), str(target)], check=True, capture_output=True, text=True, timeout=20)
        cls.command = [str(java), "-cp", str(root) + os.pathsep + str(jars[0]), "SeedParserCheck"]
        cls.input = root / "input.json"

    def decode(self, obj):
        self.input.write_text(json.dumps(obj))
        return subprocess.run(self.command + [str(self.input)], capture_output=True, text=True, timeout=10)

    def test_maps_arrays_bare_addresses_and_function_preference(self):
        result = self.decode({"functions": [["0x08000001", "T", 7], ["0x08000006", "A", 1],
                                             {"addr": "0x08000009", "mode": "thumb"}, "0x0800000d", 134217744],
                              "blocks": [["0x08009998", "T", 3, 4, 5]]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [[0x08000000, 1], [0x08000004, 0],
                                                     [0x08000008, 1], [0x0800000c, 1], [0x08000010, 0]])

    def test_current_native_capture_and_unknown_mode(self):
        capture = runner.REPO / "local/captures/pokemon-emerald-version/frontend/coverage.json"
        if capture.exists():
            raw = json.loads(capture.read_text())
            result = self.decode(raw)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads(result.stdout)), len(raw["regions"]["rom"]["functions"]))
        result = self.decode([["0x08000000", "unknown", 1]])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown seed instruction mode", result.stderr)

    def test_unverified_io_directions_are_quarantined(self):
        result = subprocess.run(self.command + ["--io-check"], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "ok")


if __name__ == "__main__":
    unittest.main()
