"""Focused regression for applying a source patch inside this Git workspace."""

import shutil
import subprocess
import tempfile
import unittest
import json
import hashlib
from pathlib import Path

from tools.whole_game.build_sources import OUTPUT_ROOT, apply_source_patch, compiler_errors, reuse_previous_build
from tools.whole_game.single_rom.build import patch_applies_to_baseline


class IsolatedPatchTest(unittest.TestCase):
    def test_incremental_cache_clones_and_verifies_changed_source(self):
        with tempfile.TemporaryDirectory(prefix="reuse-regression-") as temporary:
            root = Path(temporary)
            old = root / "old"
            (old / "source/build/emerald").mkdir(parents=True)
            (old / "source/src").mkdir()
            (old / "source/src/a.c").write_text("old\n")
            (old / "source/build/emerald/a.o").write_bytes(b"cached object")
            patch = old / "source.patch"
            patch.write_text("diff --git a/src/a.c b/src/a.c\n--- a/src/a.c\n+++ b/src/a.c\n@@ -1 +1 @@\n-old\n+new\n")
            pin = {"game": "emerald", "sourceCommit": "source-pin", "sourceTreeHash": "tree-pin",
                   "toolchain": "agbcc", "toolchainCommit": "compiler-pin",
                   "toolchainFilesSha256": {"agbcc": "binary-pin"},
                   "sourceBridgeSha256": None, "appliedSourceTreeHash": "old-patch-tree"}
            prior = dict(pin, status="failed", expectedTreeHash="old-patch-tree",
                         patchSha256=hashlib.sha256(patch.read_bytes()).hexdigest(),
                         build={"diagnosticKeepGoing": True})
            prior_receipt = old / "receipt.json"
            prior_receipt.write_text(json.dumps(prior))
            new = root / "new"
            (new / "source/src").mkdir(parents=True)
            (new / "source/src/a.c").write_text("new\n")
            current = dict(pin, appliedSourceTreeHash="new-patch-tree")
            result = reuse_previous_build(new / "source", prior_receipt, new, current, new / "build.log", 30)
            self.assertEqual(result["changedSourceInputs"], 1)
            self.assertEqual((new / "source/src/a.c").read_text(), "new\n")
            self.assertEqual((old / "source/src/a.c").read_text(), "old\n")
            self.assertEqual((new / "source/build/emerald/a.o").read_bytes(), b"cached object")
            self.assertNotEqual((new / "source/src/a.c").stat().st_ino,
                                (old / "source/src/a.c").stat().st_ino)
            removed = root / "removed"
            (removed / "source").mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "removed prior source"):
                reuse_previous_build(removed / "source", prior_receipt, removed, current,
                                     removed / "build.log", 30)

    def test_diagnostic_cap_reports_full_count(self):
        with tempfile.TemporaryDirectory(prefix="diagnostic-count-") as temporary:
            log = Path(temporary) / "build.log"
            log.write_text("".join(f"src/file.c:{index}: Error: issue {index}\n" for index in range(401)))
            errors, count = compiler_errors(log)
            self.assertEqual(len(errors), 400)
            self.assertEqual(count, 401)

    def test_existing_edit_and_new_file_are_applied_to_nested_archive(self):
        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="patch-regression-", dir=OUTPUT_ROOT) as temporary:
            root = Path(temporary)
            expected = root / "expected"
            work = root / "source"
            expected.mkdir()
            work.mkdir()
            (expected / "existing.txt").write_text("before\n")

            def git(*arguments):
                return subprocess.check_output(["git", "-C", str(expected), *arguments], text=True).strip()

            git("init", "-q")
            git("add", "-A")
            git("-c", "user.name=Patch Test", "-c", "user.email=test@localhost",
                "commit", "-q", "-m", "baseline")
            shutil.copy2(expected / "existing.txt", work / "existing.txt")
            (expected / "existing.txt").write_text("after\n")
            (expected / "new.txt").write_text("new\n")
            git("add", "-A")
            expected_tree = git("write-tree")
            patch = root / "source.patch"
            patch.write_bytes(subprocess.check_output(
                ["git", "-C", str(expected), "diff", "--cached", "--binary", "HEAD"]))
            self.assertTrue(patch_applies_to_baseline(expected, patch, root)[0])
            invalid = root / "invalid.patch"
            invalid.write_bytes(patch.read_bytes().replace(b"-before\n", b"-missing\n"))
            self.assertFalse(patch_applies_to_baseline(expected, invalid, root)[0])

            actual_tree, changed = apply_source_patch(work, patch, root / "apply.log", 30, expected_tree)
            self.assertEqual(actual_tree, expected_tree)
            self.assertEqual(changed, 2)
            self.assertEqual((work / "existing.txt").read_text(), "after\n")
            self.assertEqual((work / "new.txt").read_text(), "new\n")
            self.assertFalse((work / ".git").exists())


if __name__ == "__main__":
    unittest.main()
