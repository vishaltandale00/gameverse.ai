"""Offline transport/acceptance regression checks; no provider requests."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import evidence_pilot as pilot


class PilotAcceptanceTests(unittest.TestCase):
    def packet(self):
        return {"game_id": "fixture", "question": "Extract the evidenced behavior", "sources": [
            {"id": "S1", "path": "fixture:rule.c", "start_line": 10, "end_line": 10,
             "text": "rule\n", "sha256": pilot.digest("rule\n")}]}

    def response(self):
        return {"claims": [{"id": "c", "kind": "mechanic", "description": "A rule", "status": "supported",
                            "citations": [{"source_id": "S1", "line_range": "10-10"}]}]}

    def test_tampered_packet_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            packet = self.packet()
            packet["sources"][0]["text"] = "different evidence\n"
            path = Path(directory) / "packet.json"
            path.write_text(json.dumps(packet))
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                pilot.load_packet(path)

    def test_citation_must_refer_to_frozen_source_span(self):
        output = self.response()
        output["claims"][0]["citations"][0]["line_range"] = "10-11"
        self.assertTrue(pilot.validate_claims(output, self.packet()))
        output["claims"][0]["citations"][0] = {"source_id": "invented", "line_range": "10-10"}
        self.assertTrue(pilot.validate_claims(output, self.packet()))

    def run_fixture(self, content, finish_reason):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet_path = root / "packet.json"
            packet_path.write_text(json.dumps(self.packet()))
            response = {"model": "fixture", "choices": [{"message": {"content": content},
                                                          "finish_reason": finish_reason}]}
            raw = json.dumps(response).encode()
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value = io.BytesIO(raw)
            with patch.dict(os.environ, {"LITELLM_API_KEY": "test-credential-never-persist"}), \
                    patch.object(sys, "argv", ["pilot", str(packet_path), "--out-root", str(root / "out")]), \
                    patch.object(pilot.urllib.request, "build_opener", return_value=opener), \
                    contextlib.redirect_stdout(io.StringIO()):
                code = pilot.main()
            saved = list((root / "out").glob("*/run.json"))
            self.assertEqual(len(saved), 1)
            for path in (root / "out").glob("*/*"):
                self.assertNotIn("test-credential-never-persist", path.read_text())
            self.assertEqual(opener.open.call_count, 1)
            return code, json.loads(saved[0].read_text())

    def test_http_success_cannot_mask_invalid_or_truncated_extraction(self):
        code, report = self.run_fixture("not json", "stop")
        self.assertEqual(code, 1)
        self.assertEqual(report["outcome"], "invalid_output")
        code, report = self.run_fixture(json.dumps(self.response()), "length")
        self.assertEqual(code, 1)
        self.assertEqual(report["outcome"], "truncated")

    def test_complete_valid_response_is_accepted(self):
        code, report = self.run_fixture(json.dumps(self.response()), "stop")
        self.assertEqual(code, 0)
        self.assertEqual(report["outcome"], "ok")


if __name__ == "__main__":
    unittest.main()
