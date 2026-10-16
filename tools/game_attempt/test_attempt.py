"""Narrow offline candidate/provenance/control-loop checks. No model requests."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

from tools.decisions.client import WireResponse
from tools.playtester.core import Limits
from .run import (AttemptError, GAME_FIELDS, GeneratorConfig, ROOT, canonical,
                  pin_components, propose, run_attempt, sha, template, validate_request)


def request():
    return json.loads((Path(__file__).parent / "examples/key_gate.json").read_text())


def generated_reply(proposal):
    return WireResponse({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(proposal)}}],
                         "usage": {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300}})


class AttemptTests(unittest.TestCase):
    def test_selected_components_pin_exact_snapshots(self):
        req = request()
        validate_request(req)
        sources = pin_components(req)
        self.assertEqual(len(sources), 2)
        for source in sources:
            self.assertEqual(source["source_sha256"], sha(source["snapshot_text"].encode()))
            self.assertEqual(source["source_file_sha256"], sha((ROOT / source["source_ref"].split("#")[0]).read_bytes()))
            self.assertTrue(source["snapshot_text"].startswith("- id: " + source["component_id"]))
            self.assertTrue(source["source_reference_lines"])

    def test_invalid_and_missing_component_requests_fail(self):
        req = request()
        req["components"][0]["game_id"] = "../../escape"
        with self.assertRaisesRegex(AttemptError, "invalid_source_game"):
            validate_request(req)
        req = request()
        req["components"][0]["component_id"] = "nonexistent"
        with self.assertRaisesRegex(AttemptError, "component_anchor_missing"):
            pin_components(req)

    def test_template_generates_and_actually_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            result = run_attempt(request(), directory)
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["generator"]["requests"], 0)
            self.assertGreater(result["playthrough"]["steps"], 1)
            self.assertEqual(result["playthrough"]["status"], "success")
            attempt = Path(result["artifacts"]["directory"])
            candidate = json.loads((attempt / "candidate.json").read_text())
            self.assertEqual(result["candidate_sha256"], sha(canonical(candidate)))
            self.assertEqual(len(candidate["source_components"]), 2)
            events = [json.loads(line) for line in (attempt / "playthrough/events.jsonl").read_text().splitlines()]
            observations = [event["observation"] for event in events if event["event"] == "observation"]
            self.assertIn("field-key", observations[-1]["facts"]["inventory"])
            self.assertIn("ability-gate", observations[-1]["facts"]["opened_doors"])
            self.assertTrue(observations[-1]["success"])
            self.assertEqual(json.loads((Path(directory) / "attempts.jsonl").read_text())["attempt_id"], result["attempt_id"])

    def test_constraint_failure_is_retained_without_playing(self):
        req = request()
        req["constraints"]["max_width"] = 5
        evaluator = Mock()
        with tempfile.TemporaryDirectory() as directory:
            result = run_attempt(req, directory, evaluator=evaluator)
            self.assertEqual(result["error"]["code"], "candidate_exceeds_request_constraint")
            evaluator.assert_not_called()
            self.assertTrue(Path(result["artifacts"]["candidate"]).is_file())
            self.assertTrue((Path(result["artifacts"]["directory"]) / "attempt.json").is_file())

    def test_model_proposals_cannot_replace_provenance_or_add_code(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        proposal["code"] = "raise RuntimeError('untrusted')"
        transport = Mock(return_value=generated_reply(proposal))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LITELLM_API_KEY": "fixture-generation-key"}, clear=True):
            result = run_attempt(req, directory, generator=GeneratorConfig("local"), transport=transport)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["error"]["code"], "invalid_generation_fields")
            self.assertEqual(result["generator"]["requests"], 1)
            self.assertEqual(result["generator"]["usage"]["total_tokens"], 300)
            self.assertTrue((Path(result["artifacts"]["directory"]) / "proposal.json").is_file())
            self.assertEqual(transport.call_count, 1)
            self.assertNotIn("playthrough", result)

    def test_valid_but_impossible_model_candidate_fails_real_playthrough(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        proposal["walls"] += [[6, 2], [7, 1], [7, 3]]
        transport = Mock(return_value=generated_reply(proposal))
        limits = Limits(max_steps=12, max_frames=12, max_seconds=2, max_decisions=0, max_escalations=0)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LITELLM_API_KEY": "fixture-generation-key"}, clear=True):
            result = run_attempt(req, directory, generator=GeneratorConfig("local"), transport=transport, limits=limits)
            self.assertEqual(result["status"], "playthrough_failed")
            self.assertNotEqual(result["playthrough"]["status"], "success")
            self.assertLessEqual(result["playthrough"]["steps"], 12)
            self.assertTrue(Path(result["artifacts"]["playthrough"]).is_file())

    def test_bypassed_gate_is_objective_unmet_even_when_goal_is_reached(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        proposal["doors"][0]["position"] = [3, 1]  # Goal route through [4,2] is now open.
        transport = Mock(return_value=generated_reply(proposal))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LITELLM_API_KEY": "fixture-key"}, clear=True):
            result = run_attempt(req, directory, generator=GeneratorConfig("local"), transport=transport)
            self.assertEqual(result["status"], "objective_unmet")
            self.assertTrue(result["playthrough"]["objective_checks"]["goal_observed"])
            self.assertFalse(result["playthrough"]["objective_checks"]["gate_opened_before_goal"])
            play = json.loads(Path(result["artifacts"]["playthrough"]).read_text())
            self.assertEqual(play["adapter_objective_status"], "success")
            self.assertEqual(play["status"], "objective_unmet")

    def test_generator_cannot_remove_required_key_gate_mechanics(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        proposal.update(keys=[], doors=[])
        transport = Mock(return_value=generated_reply(proposal))
        evaluator = Mock()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LITELLM_API_KEY": "fixture-key"}, clear=True):
            result = run_attempt(req, directory, generator=GeneratorConfig("local"), transport=transport, evaluator=evaluator)
            self.assertEqual(result["error"]["code"], "key_gate_objects_required")
            evaluator.assert_not_called()

    def test_explicit_openai_generation_wire_and_missing_key_no_request(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        transport = Mock(return_value=generated_reply(proposal))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "fixture-openai-key"}, clear=True):
            candidate, meta = propose(req, base, GeneratorConfig("openai", "chosen-chat-model"), transport=transport)
            args = transport.call_args.args
            self.assertEqual(args[0], "https://api.openai.com/v1/chat/completions")
            self.assertEqual(args[2]["max_completion_tokens"], 1024)
            self.assertNotIn("max_tokens", args[2])
            self.assertEqual(candidate["source_components"], base["source_components"])
            self.assertEqual(meta["requests"], 1)
        transport.reset_mock()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            result = run_attempt(req, directory, generator=GeneratorConfig("openai", "chosen-chat-model"), transport=transport)
            self.assertEqual(result["error"]["code"], "missing_generation_api_key")
            self.assertEqual(result["generator"]["requests"], 0)
            transport.assert_not_called()

    def test_provider_errors_are_retained_without_messages_keys_or_retry(self):
        key = "fixture-generation-key"
        transport = Mock(side_effect=TimeoutError(key))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LITELLM_API_KEY": key}, clear=True):
            result = run_attempt(request(), directory, generator=GeneratorConfig("local"), transport=transport)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["generator"]["requests"], 1)
            self.assertEqual(transport.call_count, 1)
            self.assertEqual(result["generator"]["model"], "ramblerun/Multimodal-AI")
            self.assertEqual(result["playtest_limits"]["max_steps"], 80)
            for path in Path(directory).rglob("*.json*"):
                self.assertNotIn(key, path.read_text())

    def test_local_thinking_flag_is_explicit_and_never_sent_to_openai(self):
        req = request()
        base = template(req, pin_components(req))
        proposal = {name: base[name] for name in GAME_FIELDS}
        transport = Mock(return_value=generated_reply(proposal))
        env = {"LITELLM_API_KEY": "fixture-local-key", "OPENAI_API_KEY": "fixture-cloud-key"}
        for flag, expected in ((None, None), ("false", False), ("true", True)):
            with self.subTest(flag=flag), patch.dict(os.environ, env, clear=True):
                if flag is not None:
                    os.environ["LITELLM_GENERATION_ENABLE_THINKING"] = flag
                propose(req, base, GeneratorConfig("local"), transport=transport)
                body = transport.call_args.args[2]
                if expected is None:
                    self.assertNotIn("chat_template_kwargs", body)
                else:
                    self.assertEqual(body["chat_template_kwargs"], {"enable_thinking": expected})
        with patch.dict(os.environ, dict(env, LITELLM_GENERATION_ENABLE_THINKING="false"), clear=True):
            propose(req, base, GeneratorConfig("openai", "chosen-chat-model"), transport=transport)
            self.assertNotIn("chat_template_kwargs", transport.call_args.args[2])
        transport.reset_mock()
        with patch.dict(os.environ, dict(env, LITELLM_GENERATION_ENABLE_THINKING="invalid"), clear=True):
            with self.assertRaisesRegex(AttemptError, "invalid_generation_thinking_flag"):
                propose(req, base, GeneratorConfig("local"), transport=transport)
            transport.assert_not_called()


if __name__ == "__main__":
    unittest.main()
