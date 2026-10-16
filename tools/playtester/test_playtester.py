"""Offline behavioral fixtures; no ROMs, networks, or model charges."""
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
import urllib.error

from tools.decisions import ProviderConfig
from .adapters import GridAdapter, SubprocessAdapter, validate_game
from .core import FrontierPolicy, Limits, PlaytestError, Playtester
from .models import ChatPolicy, DecisionPolicy


EXAMPLE = Path(__file__).parent / "examples/key-door.json"


def profile(game_id="fixture"):
    return {"schema_version": 1, "game_id": game_id, "objective": "Reach goal",
            "awareness": {"perspective": "top_down", "locomotion": "grid"}}


class StationaryAdapter:
    def __init__(self, *, animated=False, isolated=True, invalid_receipt=False):
        self.frame = 0
        self.animated, self.isolated, self.invalid_receipt = animated, isolated, invalid_receipt
        self.closed = False
    def hello(self):
        return {"schema_version": 1, "adapter_version": "fixture/1", "game_id": "fixture", "game_version": "abc",
                "capabilities": ["observe", "act"], "isolated": self.isolated, "max_action_frames": 2}
    def observe(self):
        return {"frame": self.frame, "state_key": str(self.frame) if self.animated else "static", "phase": "gameplay",
                "facts": {}, "progress": {"position": [1, 1]}, "terminal": False, "success": False,
                "options": [{"id": "walk", "description": "Try walking", "keys": ["RIGHT"], "frames": 2}]}
    def act(self, action, *, max_frames):
        self.frame += 2
        return {"frames": 5 if self.invalid_receipt else 2}
    def close(self):
        self.closed = True


class FixedPolicy:
    requires_model = True
    def __init__(self, result):
        self.result, self.calls = result, 0
    def choose(self, context, options, timeout_s):
        self.calls += 1
        return self.result


class ModelAdapter(StationaryAdapter):
    def observe(self):
        obs = super().observe()
        obs["options"].append({"id": "wait", "description": "Wait", "keys": [], "frames": 2})
        return obs


class EngineTests(unittest.TestCase):
    def test_target_continuation_avoids_repeated_decisions_for_known_progress(self):
        class SelectingPolicy(FrontierPolicy):
            requires_model = True
        game = json.loads(EXAMPLE.read_text())
        report = Playtester(GridAdapter(game), profile(game["game_id"]), SelectingPolicy()).run()
        self.assertEqual(report["status"], "success")
        self.assertEqual(report["steps"], 9)
        self.assertEqual(report["decision_calls"], 4)
        self.assertEqual(report["active_target"]["target"]["kind"], "goal")

    def test_visual_change_alone_does_not_enable_target_continuation(self):
        class VisualOnly(ModelAdapter):
            def observe(self):
                obs = super().observe()
                obs["progress"] = {}
                obs["state_key"] = str(self.frame)
                obs["options"][0]["continue_until_target"] = True
                obs["options"][0]["target"] = {"kind": "unknown passage"}
                return obs
        policy = FixedPolicy({"accepted": True, "action_id": "walk"})
        report = Playtester(VisualOnly(), profile(), policy, limits=Limits(max_steps=2)).run()
        self.assertEqual(report["decision_calls"], 2)

    def test_adapter_reaction_interrupts_target_continuation(self):
        class AlertGrid(GridAdapter):
            def observe(self):
                obs = super().observe()
                obs["requires_decision"] = True
                return obs
        class SelectingPolicy(FrontierPolicy):
            requires_model = True
        game = json.loads(EXAMPLE.read_text())
        report = Playtester(AlertGrid(game), profile(game["game_id"]), SelectingPolicy()).run()
        self.assertEqual(report["status"], "success")
        self.assertEqual(report["decision_calls"], 9)

    def test_generated_manifest_complete_key_door_goal(self):
        game = json.loads(EXAMPLE.read_text())
        adapter = GridAdapter(game)
        with tempfile.TemporaryDirectory() as tmp:
            report = Playtester(adapter, profile(game["game_id"]), FrontierPolicy(), output=Path(tmp) / "run").run()
            events = [json.loads(x) for x in (Path(tmp) / "run/events.jsonl").read_text().splitlines()]
            self.assertTrue(any(e.get("observation", {}).get("facts", {}).get("inventory") == ["brass-key"] for e in events))
            self.assertTrue(any(e.get("observation", {}).get("facts", {}).get("opened_doors") == ["east-door"] for e in events))
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["steps"], 9)
            self.assertEqual(report["decision_calls"], 0)
            self.assertIsNone(report["timing"]["queue_s"])
            self.assertTrue((Path(tmp) / "run/report.json").exists())
        self.assertTrue(adapter.closed)

    def test_stationary_barrier_is_provisional_and_escalates(self):
        adapter = StationaryAdapter()
        report = Playtester(adapter, profile(), FrontierPolicy()).run()
        self.assertEqual(report["reason"], "needs_system2:all_actions_stationary")
        self.assertEqual(report["steps"], 3)
        candidate = report["barrier_candidates"][0]
        self.assertEqual(candidate["status"], "candidate")
        self.assertEqual(len(candidate["evidence"]), 3)

    def test_animation_does_not_hide_structured_no_progress(self):
        report = Playtester(StationaryAdapter(animated=True), profile(), FrontierPolicy()).run()
        self.assertEqual(report["steps"], 3)
        self.assertEqual(report["barrier_candidates"][0]["basis"], "adapter_structured")

    def test_no_isolation_fails_before_action_and_closes(self):
        adapter = StationaryAdapter(isolated=False)
        report = Playtester(adapter, profile(), FrontierPolicy()).run()
        self.assertEqual(report["reason"], "adapter_must_be_isolated")
        self.assertTrue(adapter.closed)
        self.assertEqual(adapter.frame, 0)

    def test_invalid_receipt_is_failure(self):
        report = Playtester(StationaryAdapter(invalid_receipt=True), profile(), FrontierPolicy()).run()
        self.assertEqual(report["reason"], "invalid_action_receipt")

    def test_model_call_budget_never_implicit_fallback(self):
        policy = FixedPolicy({"accepted": True, "action_id": "walk"})
        report = Playtester(ModelAdapter(), profile(), policy, limits=Limits(max_decisions=1)).run()
        self.assertEqual(report["reason"], "decision_limit")
        self.assertEqual(policy.calls, 1)
        self.assertEqual(report["steps"], 1)

    def test_uncertain_decision_escalates_once_and_checks_valid_action(self):
        fast = FixedPolicy({"accepted": False, "reason": "ambiguous"})
        slow = FixedPolicy({"accepted": True, "action_id": "arbitrary_poke"})
        report = Playtester(ModelAdapter(), profile(), fast, system2=slow, limits=Limits(max_escalations=1)).run()
        self.assertEqual(report["reason"], "system2_unresolved")
        self.assertEqual(report["steps"], 0)
        self.assertEqual(slow.calls, 1)

    def test_resolved_escalation_acts_and_step_budget(self):
        fast = FixedPolicy({"accepted": False, "reason": "ambiguous"})
        slow = FixedPolicy({"accepted": True, "action_id": "walk"})
        report = Playtester(ModelAdapter(), profile(), fast, system2=slow, limits=Limits(max_steps=1)).run()
        self.assertEqual(report["reason"], "step_limit")
        self.assertEqual(report["steps"], 1)
        self.assertEqual(report["system2_calls"], 1)

    def test_frame_budget_does_not_overshoot(self):
        report = Playtester(StationaryAdapter(), profile(), FrontierPolicy(), limits=Limits(max_frames=3)).run()
        self.assertEqual(report["frames"], 2)
        self.assertEqual(report["reason"], "remaining_frame_budget_too_small")

    def test_pinned_game_version_enforced(self):
        p = dict(profile(), game_version="different")
        report = Playtester(StationaryAdapter(), p, FrontierPolicy()).run()
        self.assertEqual(report["reason"], "profile_game_version_mismatch")

    def test_negative_limits_rejected(self):
        with self.assertRaises(PlaytestError):
            Limits(max_steps=-1)

    def test_manifest_rejects_duplicate_occupancy_and_unknown_key(self):
        game = json.loads(EXAMPLE.read_text())
        game["doors"][0]["position"] = game["keys"][0]["position"]
        with self.assertRaises(PlaytestError):
            validate_game(game)
        game = json.loads(EXAMPLE.read_text())
        game["doors"][0]["requires"] = "missing"
        with self.assertRaises(PlaytestError):
            validate_game(game)

    def test_unreachable_map_does_not_claim_success(self):
        game = json.loads(EXAMPLE.read_text())
        game["walls"].append([7, 2])
        with self.assertRaises(PlaytestError):
            validate_game(game)
        game = json.loads(EXAMPLE.read_text())
        game["walls"] += [[6, 2], [7, 1], [7, 3], [8, 2]]
        report = Playtester(GridAdapter(game), profile(game["game_id"]), FrontierPolicy(), limits=Limits(max_steps=30)).run()
        self.assertNotEqual(report["status"], "success")


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.context = {"run_id": "r", "game_id": "g", "objective": "explore", "memory": {},
                        "awareness": {"perspective": "side_view", "locomotion": "platform"},
                        "observation": {"frame": 0, "state_key": "s", "facts": {}}}
        self.options = [{"id": "left", "description": "left", "keys": ["LEFT"], "frames": 1},
                        {"id": "right", "description": "right", "keys": ["RIGHT"], "frames": 1}]

    def test_decision_low_confidence_or_inconsistent_distribution_rejected(self):
        class Client:
            config = ProviderConfig(api_key="fake")
            def decide(self, request, **kwargs):
                return {"status": "success", "answers": [{"name": "action", "type": "choice", "choice": "left", "confidence": .99,
                    "probabilities": [{"value": "left", "probability": .1}, {"value": "right", "probability": .8}, {"value": "STOP", "probability": .1}]}]}
        result = DecisionPolicy(client=Client()).choose(self.context, self.options, .2)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "inconsistent_distribution_choice")

    def test_accepted_decision_reason_is_not_uncertainty(self):
        class Client:
            config = ProviderConfig(api_key="fake")
            def decide(self, request, **kwargs):
                return {"status": "success", "answers": [{"name": "action", "type": "choice", "choice": "left", "confidence": .99,
                    "probabilities": [{"value": "left", "probability": .9}, {"value": "right", "probability": .08}, {"value": "STOP", "probability": .02}]}]}
        result = DecisionPolicy(client=Client()).choose(self.context, self.options, .2)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["reason"], "decision_selected")

    def test_decision_stop_escalates(self):
        class Client:
            config = ProviderConfig(api_key="fake")
            def decide(self, request, **kwargs):
                return {"status": "success", "answers": [{"name": "action", "type": "choice", "choice": "STOP", "confidence": .99,
                    "probabilities": [{"value": "left", "probability": .01}, {"value": "right", "probability": .01}, {"value": "STOP", "probability": .98}]}]}
        result = DecisionPolicy(client=Client()).choose(self.context, self.options, .2)
        self.assertFalse(result["accepted"])
        self.assertIsNone(result["action_id"])

    def test_chat_only_accepts_listed_json_action_and_redacts_echo(self):
        seen = []
        def transport(url, key, payload, timeout):
            seen.append(payload)
            return {"choices": [{"message": {"content": json.dumps({"action_id": "left", "reason": "secret-key hypothesis"})}}]}
        policy = ChatPolicy(base_url="http://127.0.0.1:4000", model="explicit", api_key="secret-key", enable_thinking=False, transport=transport)
        result = policy.choose(self.context, self.options, .2)
        self.assertTrue(result["accepted"])
        self.assertNotIn("secret-key", json.dumps(result))
        self.assertEqual(seen[0]["chat_template_kwargs"], {"enable_thinking": False})

    def test_chat_rejects_prose_code_and_unknown_actions(self):
        for content in ("left because yes", '{"action_id":"shell","reason":"run arbitrary command"}',
                        '{"action_id":"left","reason":"x","code":"arbitrary"}'):
            policy = ChatPolicy(base_url="http://localhost", model="m", api_key="k",
                                transport=lambda *args: {"choices": [{"message": {"content": content}}]})
            result = policy.choose(self.context, self.options, .1)
            self.assertFalse(result["accepted"])
            self.assertEqual(result["record"]["attempts"], 1)

    def test_chat_single_fenced_json_and_long_reason_are_valid(self):
        content = "```json\n" + json.dumps({"action_id": "right", "reason": "x" * 400}) + "\n```"
        seen = []
        def transport(url, key, payload, timeout):
            seen.append(payload)
            return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 30, "private_echo": "secret"}}
        policy = ChatPolicy(base_url="http://localhost", model="m", api_key="secret", json_mode="json_object", transport=transport)
        result = policy.choose(self.context, self.options, .1)
        self.assertTrue(result["accepted"])
        self.assertEqual(len(result["reason"]), 240)
        self.assertTrue(result["record"]["single_json_fence"])
        self.assertTrue(result["record"]["reason_truncated"])
        self.assertEqual(result["record"]["finish_reason"], "stop")
        self.assertEqual(result["record"]["usage"], {"prompt_tokens": 10, "completion_tokens": 30})
        self.assertEqual(seen[0]["response_format"], {"type": "json_object"})

    def test_failed_parse_retains_safe_usage_and_finish_reason(self):
        policy = ChatPolicy(base_url="http://localhost", model="m", api_key="secret",
            transport=lambda *args: {"choices": [{"message": {"content": '{"action_id":"right","reason":"trunc'}, "finish_reason": "length"}],
                                    "usage": {"prompt_tokens": 100, "completion_tokens": 256}})
        result = policy.choose(self.context, self.options, .1)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["record"]["error"], "invalid_llm_choice_json")
        self.assertEqual(result["record"]["finish_reason"], "length")
        self.assertEqual(result["record"]["usage"]["completion_tokens"], 256)
        self.assertIn("parse_position", result["record"])
        self.assertNotIn("trunc", json.dumps(result))

    def test_chat_http_status_does_not_log_provider_body_or_key(self):
        def transport(*args):
            raise urllib.error.HTTPError("http://localhost", 429, "secret", {}, None)
        result = ChatPolicy(base_url="http://localhost", model="m", api_key="secret", transport=transport).choose(self.context, self.options, .1)
        self.assertEqual(result["record"]["error"], "llm_http_error")
        self.assertEqual(result["record"]["http_status"], 429)
        self.assertNotIn("secret", json.dumps(result))

    def test_unknown_awareness_gets_reexamined_instead_of_cached_forever(self):
        class Client:
            config = ProviderConfig(api_key="fake")
            requests = []
            def decide(self, request, **kwargs):
                self.requests.append(request)
                return {"status": "refused", "answers": []}
        client = Client()
        context = dict(self.context, awareness={"perspective": "unknown", "locomotion": "unknown"})
        policy = DecisionPolicy(client=client)
        policy.choose(context, self.options, .1)
        policy.choose(context, self.options, .1)
        self.assertEqual(len(client.requests[0]["questions"]), 3)
        self.assertEqual(len(client.requests[1]["questions"]), 3)


class BridgeTests(unittest.TestCase):
    def test_jsonl_protocol_and_cleanup(self):
        script = 'import sys,json\nfor l in sys.stdin:\n r=json.loads(l);print(json.dumps({"id":r["id"],"ok":True,"result":{"seen":r["op"]}}),flush=True)\n if r["op"]=="close":break\n'
        adapter = SubprocessAdapter([sys.executable, "-u", "-c", script], timeout_s=1)
        self.assertEqual(adapter.hello(), {"seen": "hello"})
        adapter.close()
        self.assertIsNotNone(adapter.process.poll())

    def test_timeout_cleans_up_worker(self):
        adapter = SubprocessAdapter([sys.executable, "-u", "-c", "import time;time.sleep(10)"], timeout_s=.02)
        with self.assertRaises(PlaytestError):
            adapter.hello()
        try:
            adapter.close()
        except PlaytestError:
            pass
        self.assertIsNotNone(adapter.process.poll())

    def test_response_id_must_match(self):
        script = 'import sys,json\nfor l in sys.stdin:print(json.dumps({"id":"wrong","ok":True,"result":{}}),flush=True)'
        adapter = SubprocessAdapter([sys.executable, "-u", "-c", script], timeout_s=1)
        with self.assertRaises(PlaytestError):
            adapter.hello()
        try:
            adapter.close()
        except PlaytestError:
            pass
        self.assertIsNotNone(adapter.process.poll())


if __name__ == "__main__":
    unittest.main()
