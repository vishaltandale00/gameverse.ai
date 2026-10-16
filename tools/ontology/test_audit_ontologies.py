"""Focused offline tests: python3 -m unittest discover -s tools/ontology -p 'test_audit_*.py'."""
from pathlib import Path
import tempfile
import unittest

from audit_ontologies import audit_document, source_path_status


class EvidenceAuditTests(unittest.TestCase):
    def test_paths_globs_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "repo/src").mkdir(parents=True)
            (root / "repo/src/player.c").write_text("void Jump(void) {}")
            self.assertEqual(source_path_status("repo:src/player.c:Jump (note)", root), "file_exists")
            self.assertEqual(source_path_status("repo:src/*.c", root), "glob_matches")
            self.assertEqual(source_path_status("repo:src/ (directory listing)", root), "directory_only")
            self.assertEqual(source_path_status("repo:src/absent.c", root), "missing_file")
            self.assertEqual(source_path_status("repo:../../secret", root), "outside_decomp_root")
            self.assertEqual(source_path_status("freeform prose", root), "unparsed")

    def test_evidence_is_counted_at_param_and_table_level(self):
        evidence = {"kind": "derived", "ref": "gravity integration", "confidence": 0.8, "inputs": ["gravity", "impulse"]}
        doc = {"id": "a", "components": [{"id": "jump", "facet": "movement_physics", "reads": ["input.a"],
               "params": {"height": {"value": 4, "evidence": [evidence]}},
               "tables": {"heights": {"evidence": [evidence]}}}]}
        report = audit_document(doc, {"a": doc}, Path("/nonexistent"))
        self.assertEqual(report["evidence_records"], {"derived": 2})
        self.assertEqual(report["params_with_evidence"], 1)
        self.assertEqual(report["operational_field_coverage"]["reads"], 1)
        self.assertEqual(report["operational_field_coverage"]["invariants"], 0)
        self.assertEqual(report["findings"], [])

    def test_flags_derived_inputs_and_overconfident_recall(self):
        doc = {"id": "a", "components": [{"id": "jump", "facet": "mechanics", "evidence": [
            {"kind": "derived", "ref": "x/y", "confidence": 0.9},
            {"kind": "llm_knowledge", "ref": "recall", "confidence": 0.7}]}]}
        report = audit_document(doc, {"a": doc}, Path("/nonexistent"))
        self.assertEqual({f["code"] for f in report["findings"]},
                         {"derived_inputs_missing", "recall_confidence_above_brief_limit"})

    def test_cross_game_reference_distinguishes_missing_data(self):
        doc = {"id": "a", "components": [{"id": "jump", "facet": "movement_physics", "relations": [
            {"type": "variant_of", "target": "b/missing"},
            {"type": "variant_of", "target": "c/jump"},
            {"type": "variant_of", "target": "b/jump"}]}]}
        report = audit_document(doc, {"a": doc, "b": {"components": [{"id": "jump"}]}}, Path("/nonexistent"))
        self.assertEqual([f["code"] for f in report["findings"]],
                         ["relation_component_missing", "relation_game_unavailable"])


if __name__ == "__main__":
    unittest.main()
