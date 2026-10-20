"""Small pinning regressions; fixtures do not qualify a whole game."""
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

from tools.whole_game.pipeline import compose, digest, verify_manifest, run_stage, resume_inputs


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.receipts = []
        for game in ("emerald", "firered"):
            artifacts = {}
            for kind in ("rom", "elf"):
                path = self.root / (game + "." + kind)
                path.write_bytes((game + kind).encode())
                artifacts[kind] = {"path": path.name, "sha256": digest(path)}
            receipt = self.root / (game + ".json")
            receipt.write_text(json.dumps({"schema": "whole-source-build/1", "game": game, "status": "passed", "sourceCommit": game + "commit",
                                          "sourceTreeHash": game + "tree", "sourceSnapshotSha256": game + "snapshot",
                                          "sourceBridgeSha256": "a" * 64,
                                          "build": {"outcome": "passed"},
                                          "artifacts": artifacts}))
            self.receipts.append(receipt)
        self.bridge = self.root / "bridge.json"
        self.bridge.write_text(json.dumps({"schemaVersion": 1, "mailboxSymbol": "gWholeGameBridge",
                                          "mailboxBytes": 648, "sharedStateSchema": 1, "transitionSchema": 1,
                                          "sourceBridgeSha256": "a" * 64}))

    def manifest(self):
        return compose(self.receipts, self.bridge, adapter_id="test-only", adapter_version="1",
                       capabilities={"checkpoint": False}, root=self.root)

    def test_exact_bundle_is_stable_and_artifact_tampering_fails(self):
        manifest = self.manifest()
        self.assertEqual(manifest["bundleSha256"], self.manifest()["bundleSha256"])
        (self.root / "emerald.rom").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "artifact_hash_mismatch"):
            verify_manifest(manifest, self.root)

    def test_receipt_and_bridge_are_pinned(self):
        manifest = self.manifest()
        snapshot = self.root / manifest["bridge"]["manifest"]["path"]
        for path in (self.receipts[0], snapshot):
            manifest = self.manifest()
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "artifact_hash_mismatch"):
                verify_manifest(manifest, self.root)
            path.write_bytes(original)

    def test_prior_bundle_survives_editable_bridge_revision(self):
        manifest = self.manifest()
        self.bridge.write_text('{"schemaVersion":2}')
        self.assertEqual(verify_manifest(manifest, self.root), manifest)

    def test_unrelated_bridge_cannot_form_composition(self):
        bridge = json.loads(self.bridge.read_text())
        bridge["sourceBridgeSha256"] = "b" * 64
        self.bridge.write_text(json.dumps(bridge))
        with self.assertRaisesRegex(ValueError, "source_bridge_build_mismatch"):
            self.manifest()

    def test_failed_build_and_duplicate_source_are_rejected(self):
        receipt = json.loads(self.receipts[0].read_text())
        receipt["status"] = "failed"
        self.receipts[0].write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "source_build_not_successful"):
            self.manifest()
        with self.assertRaisesRegex(ValueError, "composition_requires_both_full_source_engines"):
            compose([self.receipts[1], self.receipts[1]], self.bridge, adapter_id="test", adapter_version="1",
                    capabilities={}, root=self.root)

    def test_path_escape_and_bundle_mutation_are_rejected(self):
        manifest = self.manifest()
        manifest["capabilities"]["checkpoint"] = True
        with self.assertRaisesRegex(ValueError, "bundle_identity_mismatch"):
            verify_manifest(manifest, self.root)
        manifest = self.manifest()
        manifest["bridge"]["manifest"]["path"] = "../outside.json"
        with self.assertRaisesRegex(ValueError, "artifact_outside_workspace_or_missing"):
            verify_manifest(manifest, self.root)

    def test_failed_stage_retains_exit_and_wall_time(self):
        report = {"stages": []}
        receipt = self.root / "run.json"
        code = run_stage(report, receipt, "fixture", [sys.executable, "-c", "raise SystemExit(3)"],
                         self.root / "fixture.log", 1)
        self.assertEqual(code, 3)
        retained = json.loads(receipt.read_text())["stages"][0]
        self.assertEqual(retained["outcome"], "failed")
        self.assertGreater(retained["wallS"], 0)

    def test_timeout_stage_is_retained(self):
        report = {"stages": []}
        receipt = self.root / "run.json"
        with self.assertRaises(subprocess.TimeoutExpired):
            run_stage(report, receipt, "fixture", [sys.executable, "-c", "import time; time.sleep(5)"],
                      self.root / "fixture.log", .01)
        self.assertEqual(json.loads(receipt.read_text())["stages"][0]["outcome"], "timeout")

    def resume_fixture(self):
        from tools.playtester.core import digest as profile_digest
        manifest = self.manifest()
        profile = {"game_id": "pokemon-emerald-firered-whole-source", "game_version": manifest["bundleSha256"]}
        folder = self.root / "checkpoint"
        folder.mkdir()
        files = {}
        for region in ("emerald", "firered"):
            path = folder / (region + ".ss")
            path.write_bytes(region.encode())
            files[region] = {"sha256": digest(path), "bytes": path.stat().st_size}
        session = self.root / "tools/whole_game/session.py"
        binary = self.root / "tools/re/session/build/gba-session"
        for path in (session, binary):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture-runtime")
        runtime = {"adapterVersion": "whole-game-native-composition/1", "sessionSourceSha256": digest(session),
                   "engines": {region: {"nativeBinarySha256": digest(binary), "emulator": {"version": "fixture"}}
                               for region in ("emerald", "firered")}}
        state = {"format": "whole-game-session-state/1", "bundleSha256": manifest["bundleSha256"],
                 "files": files, "runtimeIdentity": runtime, "frame": 42}
        (folder / "state.json").write_text(json.dumps(state))
        learning = self.root / "learning.json"
        learning.write_text(json.dumps({"game_version": manifest["bundleSha256"], "profile_sha256": profile_digest(profile)}))
        return manifest, profile, folder, learning

    def test_resume_pins_both_states_and_learning(self):
        manifest, profile, folder, learning = self.resume_fixture()
        continuation = resume_inputs(manifest, profile, folder, learning, root=self.root)
        self.assertEqual(continuation["parentFrame"], 42)
        self.assertEqual(set(continuation["files"]), {"emerald", "firered"})
        (folder / "firered.ss").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "resume_native_state_corrupt"):
            resume_inputs(manifest, profile, folder, learning, root=self.root)

    def test_resume_rejects_bundle_or_learning_mismatch(self):
        manifest, profile, folder, learning = self.resume_fixture()
        changed = dict(manifest, bundleSha256="b" * 64)
        with self.assertRaisesRegex(ValueError, "resume_checkpoint_bundle_mismatch"):
            resume_inputs(changed, profile, folder, learning, root=self.root)
        learning.write_text('{"game_version":"wrong","profile_sha256":"wrong"}')
        with self.assertRaisesRegex(ValueError, "resume_learning_identity_mismatch"):
            resume_inputs(manifest, profile, folder, learning, root=self.root)

    def test_resume_rejects_runtime_revision_and_unpaired_input(self):
        manifest, profile, folder, learning = self.resume_fixture()
        (self.root / "tools/whole_game/session.py").write_bytes(b"new runtime")
        with self.assertRaisesRegex(ValueError, "resume_native_session_version_mismatch"):
            resume_inputs(manifest, profile, folder, learning, root=self.root)
        with self.assertRaisesRegex(ValueError, "resume_requires_checkpoint_and_learning"):
            resume_inputs(manifest, profile, folder, None, root=self.root)

    def test_resume_profile_migration_requires_exact_old_profile(self):
        manifest, profile, folder, learning = self.resume_fixture()
        old = self.root / "old-profile.json"
        old.write_text(json.dumps(profile))
        new = dict(profile, action_notes="longer native button press")
        with self.assertRaisesRegex(ValueError, "resume_learning_identity_mismatch"):
            resume_inputs(manifest, new, folder, learning, root=self.root)
        continuation = resume_inputs(manifest, new, folder, learning, from_profile=old, root=self.root)
        self.assertIsNotNone(continuation["profileMigration"])
        with self.assertRaisesRegex(ValueError, "resume_profile_migration_objective_changed"):
            resume_inputs(manifest, dict(new, objective="weakened goal"), folder, learning, from_profile=old, root=self.root)
        old.write_text(json.dumps(dict(profile, game_version="wrong")))
        with self.assertRaisesRegex(ValueError, "resume_profile_migration_game_mismatch"):
            resume_inputs(manifest, new, folder, learning, from_profile=old, root=self.root)


if __name__ == "__main__":
    unittest.main()
