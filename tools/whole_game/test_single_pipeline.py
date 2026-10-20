"""Standalone provenance guards. Fixture compilation/playability is not asserted."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch as mock_patch

from tools.whole_game.single_pipeline import COMMITS, compose, digest, verify_manifest, resume_inputs


class SinglePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        source = self.root / "merged"
        source.mkdir()
        (source / "donor-map.json").write_bytes(b"fixture-map")
        patch = self.root / "merge.patch"
        patch.write_bytes(b"fixture-source-diff")
        artifacts = {}
        for kind in ("rom", "elf"):
            file = source / ("merged." + kind)
            file.write_bytes(("fixture-" + kind).encode())
            artifacts[kind] = {"path": str(file), "sha256": digest(file)}
        base = {"id": "emerald", "commit": COMMITS["emerald"], "treeHash": "a" * 40}
        donor = {"id": "firered", "commit": COMMITS["firered"], "treeHash": "b" * 40}
        self.merge = {"schema": "single-rom-merge/1", "base": base, "donor": donor,
                      "outputPatchSha256": digest(patch), "outputPatchPath": str(patch), "outputTreeHash": "d" * 40,
                      "changedFiles": [{"path": "donor-map.json", "sha256": digest(source / "donor-map.json"),
                                        "bytes": (source / "donor-map.json").stat().st_size, "change": "added"}],
                      "outputSourceDirectory": str(source), "coverage": {"maps": {"status": "fixture"}},
                      "unresolved": [], "buildEligible": True}
        self.build = {"schema": "whole-source-build/1", "game": "emerald", "sourceCommit": base["commit"],
                      "sourceTreeHash": base["treeHash"], "sourceSnapshotSha256": "e" * 64,
                      "status": "passed", "build": {"outcome": "passed"}, "artifacts": artifacts,
                      "patchSha256": self.merge["outputPatchSha256"], "sourceBridgeSha256": None}
        self.build.update(appliedSourceTreeHash=self.merge["outputTreeHash"], expectedTreeHash=self.merge["outputTreeHash"],
                          appliedChangedFiles=len(self.merge["changedFiles"]))
        lanes = {"world_assets": {"maps": ["fixture"], "layouts": ["fixture"], "files": ["fixture"]},
                 "scripts": {"sourceFiles": ["fixture"], "nativeDependencies": [{"status": "ported-and-verified"}]},
                 "state": {"coverage": ["fixture"], "source_pins": {"fixture": "a" * 64}},
                 "map_runtime": {"coverage": ["fixture"], "source_hashes": {"fixture": "a" * 64}}}
        lanes.update({"audio": {"songs": ["fixture"], "resources": ["fixture"]},
                      "encounters": {"trainer_ids": ["fixture"], "source_hashes": ["fixture"], "files": ["fixture"]},
                      "map_semantics": {"supported": ["fixture"], "source_hashes": ["fixture"], "predicate_dispatch": ["fixture"]},
                      "opcodes": {"handlers": ["fixture"], "providers": ["fixture"]},
                      "native_ui": {"providers": ["fixture"], "translationUnits": ["fixture"]},
                      "native_services": {"nativeDependencies": ["fixture"], "sourceClosure": ["fixture"], "specialTable": ["fixture"]},
                      "campaign": {"initialization": ["fixture"], "policy": ["fixture"], "source_pins": ["fixture"]},
                      "battle_modes": {"coverage": ["fixture"], "source_hashes": {"fixture": "a" * 64}},
                      "field_movement": {"coverage": ["fixture"], "source_hashes": {"fixture": "a" * 64}},
                      "world_services": {"coverage": ["fixture"], "source_hashes": {"fixture": "a" * 64}}})
        self.merge["requiredStageNames"] = list(lanes)
        self.merge["stages"] = [{"name": name, "moduleSha256": "f" * 64, "status": "passed", "ledger": ledger}
                                for name, ledger in lanes.items()]
        for stage in self.merge["stages"]:
            module = self.root / (stage["name"] + ".py")
            module.write_bytes(b"fixture-transform")
            stage.update(moduleSha256=digest(module), retainedModulePath=str(module))
        self.merge["coverage"] = {name: {"scope": "test-fixture"} for name in lanes}
        self.merge["linkedPostconditions"] = [{"kind": "elf-symbol", "symbol": "fixture_" + name,
                                                 "category": name, "sourcePath": "donor-map.json",
                                                 "sourceSha256": self.merge["changedFiles"][0]["sha256"], "minBytes": 1}
                                                for name in lanes]
        self.symbol_index = {"fixture_" + name: [{"address": 0x08000000, "size": 1, "type": 1,
                                                  "section": 1, "sectionAddress": 0x08000000,
                                                  "sectionSize": 11, "sectionFlags": 2, "sectionType": 1}]
                             for name in lanes}
        parser = mock_patch("tools.whole_game.elf_symbols.symbols", return_value=self.symbol_index)
        parser.start()
        self.addCleanup(parser.stop)
        self.merge_path, self.build_path = self.root / "merge.json", self.root / "build.json"

    def candidate(self):
        self.merge_path.write_text(json.dumps(self.merge))
        self.build_path.write_text(json.dumps(self.build))
        return compose(self.merge_path, self.build_path, root=self.root)

    def test_one_rom_and_elf_have_independent_identity(self):
        candidate = self.candidate()
        self.assertEqual(set(candidate["artifacts"]), {"rom", "elf"})
        self.assertEqual(candidate["runtimeDependencies"], [])
        self.assertEqual(verify_manifest(candidate, self.root), candidate)

    def test_partial_source_merge_cannot_publish_manifest(self):
        self.merge["buildEligible"] = False
        self.merge["unresolved"] = [{"id": "missing-donor-script", "owner": "fixture", "reason": "missing"}]
        with self.assertRaisesRegex(ValueError, "single_rom_source_merge_incomplete"):
            self.candidate()
        self.merge_path.write_text(json.dumps(self.merge))
        self.build_path.write_text(json.dumps(self.build))
        candidate = compose(self.merge_path, self.build_path, development=True, root=self.root)
        self.assertEqual(candidate["integrationStatus"], "development")
        with self.assertRaisesRegex(ValueError, "development_artifact_cannot_close_source_integration"):
            verify_manifest(candidate, self.root, require_source_closed=True)

    def test_complete_boolean_cannot_hide_skipped_source_categories(self):
        removed = self.merge["stages"].pop(3)
        with self.assertRaisesRegex(ValueError, "single_rom_required_source_categories_missing"):
            self.candidate()
        removed["ledger"] = {"semantic_coverage_complete": True}
        self.merge["stages"].append(removed)
        with self.assertRaisesRegex(ValueError, "single_rom_source_stage_evidence_missing"):
            self.candidate()

    def test_explicit_source_ready_still_requires_inventory(self):
        audio = next(stage for stage in self.merge["stages"] if stage["name"] == "audio")
        audio["status"] = "unknown"
        audio["ledger"]["ready"] = True
        self.candidate()
        audio["ledger"] = {"ready": True}
        with self.assertRaisesRegex(ValueError, "single_rom_source_stage_evidence_missing"):
            self.candidate()

    def test_failed_or_wrong_patch_build_is_rejected(self):
        self.build["status"] = "failed"
        with self.assertRaisesRegex(ValueError, "standalone_source_build_not_successful"):
            self.candidate()
        self.build["status"] = "passed"
        self.build["patchSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "standalone_build_merge_patch_mismatch"):
            self.candidate()

    def test_patch_hash_alone_cannot_admit_skipped_source_patch(self):
        self.build.pop("appliedSourceTreeHash")
        with self.assertRaisesRegex(ValueError, "standalone_build_source_application_unproven"):
            self.candidate()
        self.build["appliedSourceTreeHash"] = self.merge["outputTreeHash"]
        compiled = self.root / "compiled"
        compiled.mkdir()
        for kind in ("rom", "elf"):
            target = compiled / ("candidate." + kind)
            target.write_bytes(kind.encode())
            self.build["artifacts"][kind] = {"path": str(target), "sha256": digest(target)}
        with self.assertRaisesRegex(ValueError, "artifact_outside_workspace_or_missing"):
            self.candidate()
        (compiled / "donor-map.json").write_bytes(b"old-unpatched-content")
        with self.assertRaisesRegex(ValueError, "standalone_compiled_source_file_mismatch"):
            self.candidate()

    def test_paired_artifacts_and_external_payloads_are_rejected(self):
        self.build["sourceBridgeSha256"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "paired_engine_bridge_is_not_standalone"):
            self.candidate()
        self.build["sourceBridgeSha256"] = None
        candidate = self.candidate()
        candidate["runtimeDependencies"] = ["firered.gba"]
        with self.assertRaisesRegex(ValueError, "standalone_rom_cannot_require_external_game_payloads"):
            verify_manifest(candidate, self.root)
        with self.assertRaisesRegex(ValueError, "unsupported_standalone_composition"):
            verify_manifest({"format": "whole-source-composition/1"}, self.root)

    def test_donor_or_merged_source_tampering_fails(self):
        self.merge["donor"]["commit"] = "0" * 40
        with self.assertRaisesRegex(ValueError, "single_rom_source_lineage_mismatch"):
            self.candidate()
        self.merge["donor"]["commit"] = COMMITS["firered"]
        (self.root / "merged/donor-map.json").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "merged_source_file_changed"):
            self.candidate()

    def test_artifact_tampering_fails(self):
        candidate = self.candidate()
        Path(self.build["artifacts"]["rom"]["path"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "artifact_hash_mismatch"):
            verify_manifest(candidate, self.root)

    def test_link_discarded_import_cannot_be_declared_source_closed(self):
        self.symbol_index.pop("fixture_world_assets")
        with self.assertRaisesRegex(ValueError, "standalone_link_postconditions_failed"):
            self.candidate()
        self.merge_path.write_text(json.dumps(self.merge))
        self.build_path.write_text(json.dumps(self.build))
        candidate = compose(self.merge_path, self.build_path, development=True, root=self.root)
        self.assertEqual(candidate["linkedArtifactEvidence"]["status"], "failed")
        candidate["linkedArtifactEvidence"]["status"] = "verified"
        with self.assertRaisesRegex(ValueError, "standalone_link_evidence_mismatch"):
            verify_manifest(candidate, self.root)

    def test_linked_asset_bytes_checked_against_rom(self):
        witness = self.merge["linkedPostconditions"][0]
        expected = self.root / "merged/expected.bin"
        expected.write_bytes(b"fixture")
        witness.update(kind="rom-bytes", artifactPath="expected.bin", artifactSha256=digest(expected))
        self.candidate()
        expected.write_bytes(b"missing")
        witness["artifactSha256"] = digest(expected)
        with self.assertRaisesRegex(ValueError, "standalone_link_postconditions_failed"):
            self.candidate()

    def test_single_checkpoint_exact_rom_and_learning_are_required(self):
        from tools.playtester.core import digest as profile_digest
        candidate = self.candidate()
        profile = {"game_id": candidate["gameId"], "game_version": candidate["artifacts"]["rom"]["sha256"]}
        folder = self.root / "checkpoint"
        folder.mkdir()
        (folder / "state.ss").write_bytes(b"single-state")
        (folder / "observation.png").write_bytes(b"single-image")
        runtime = {"emulator": {"version": "fixture"}}
        for key, name in (("native_sha256", "tools/re/session/build/gba-session"),
                          ("adapter_sha256", "tools/whole_game/single_adapter.py"),
                          ("bridge_sha256", "tools/re/session/bridge.py")):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"fixture-runtime")
            runtime[key] = digest(file)
        state = {"format": "whole-game-single-rom-state/1", "gameId": candidate["gameId"],
                 "gameVersion": profile["game_version"], "manifestSha256": candidate["manifestSha256"],
                 "runtimeIdentity": runtime, "frame": 17,
                 "state": {"sha256": digest(folder / "state.ss"), "bytes": (folder / "state.ss").stat().st_size},
                 "imageSha256": digest(folder / "observation.png")}
        (folder / "state.json").write_text(json.dumps(state))
        learning = self.root / "learning.json"
        learning.write_text(json.dumps({"game_version": profile["game_version"], "profile_sha256": profile_digest(profile)}))
        result = resume_inputs(candidate, profile, folder, learning, root=self.root)
        self.assertEqual(result["parentFrame"], 17)
        state["format"] = "whole-game-session-state/1"
        (folder / "state.json").write_text(json.dumps(state))
        with self.assertRaisesRegex(ValueError, "single_resume_artifact_identity_mismatch"):
            resume_inputs(candidate, profile, folder, learning, root=self.root)


if __name__ == "__main__":
    unittest.main()
