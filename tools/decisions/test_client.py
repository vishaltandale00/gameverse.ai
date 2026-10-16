"""Offline native-protocol fixtures. No provider requests, credentials or SDKs."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.error

from tools.decisions import DecisionClient, DecisionError, ProviderConfig, image_data_url
from tools.decisions.client import MAX_BYTES, NoRedirect, WireResponse, endpoint, from_wire, http_post, to_wire, validate_request
from tools.decisions.__main__ import main


EXAMPLES = Path(__file__).parent / "examples"
FAKE_KEY = "fixture-only-not-a-credential"


def request():
    return json.loads((EXAMPLES / "text.json").read_text())


def native(provider):
    if provider == "d1":
        return {"answers": {
            "runtime_observed": {"type": "noul", "noul": 0.1},
            "evidence_kind": {"type": "choice", "choice": "source", "confidence": 0.8,
                              "probabilities": {"source": 0.8, "runtime": 0.1, "uncertain": 0.1}},
            "execution_evidence": {"type": "score", "score": 0.3, "confidence": 0.8,
                                   "probabilities": {"0": 0.8, "1": 0.1, "2": 0.1},
                                   "legend": {"0": "Static only", "1": "Visual", "2": "Traced"}},
        }, "usage": {"input_tokens": 100, "output_tokens": 0}}
    return {"model": "gpt-6-luna", "answers": [
        {"name": "runtime_observed", "type": "predicate", "probability": 0.1},
        {"name": "evidence_kind", "type": "choice", "choice": "source", "confidence": 0.8,
         "probabilities": [{"value": value, "probability": p} for value, p in (("source", .8), ("runtime", .1), ("uncertain", .1))]},
        {"name": "execution_evidence", "type": "score", "score": 0.3, "confidence": 0.8,
         "probabilities": [{"value": i, "label": label, "probability": p} for i, label, p
                           in ((0, "static_only", .8), (1, "visual", .1), (2, "traced", .1))]},
    ], "usage": {"input_tokens": 100, "output_tokens": 0, "total_tokens": 100,
                 "input_tokens_details": {"cached_tokens": 20}}}


class ProviderTests(unittest.TestCase):
    def config(self, provider="d1", **kwargs):
        return ProviderConfig(provider, FAKE_KEY, **kwargs)

    def run_client(self, provider, response, req=None):
        transport = Mock(return_value=WireResponse(response, "req-fixture"))
        client = DecisionClient(self.config(provider), transport=transport)
        result = client.decide(req or request(), run_id="test-run")
        return result, transport

    def test_default_and_explicit_credentials(self):
        with patch.dict(os.environ, {"LITELLM_API_KEY": FAKE_KEY, "OPENAI_API_KEY": "other-fixture"}, clear=True):
            local = ProviderConfig.from_env()
            cloud = ProviderConfig.from_env("openai")
            self.assertEqual(local.provider, "d1")
            self.assertEqual(local.api_key, FAKE_KEY)
            self.assertEqual(cloud.api_key, "other-fixture")
            self.assertEqual(cloud.model, "gpt-6-luna")
            self.assertNotIn(FAKE_KEY, repr(local))
        with patch.dict(os.environ, {"LITELLM_API_KEY": FAKE_KEY}, clear=True):
            with self.assertRaisesRegex(DecisionError, "missing_or_invalid_api_key"):
                ProviderConfig.from_env("openai")
        with patch.dict(os.environ, {"OPENAI_API_KEY": FAKE_KEY}, clear=True):
            with self.assertRaisesRegex(DecisionError, "missing_or_invalid_api_key"):
                ProviderConfig.from_env()

    def test_invalid_configuration(self):
        cases = [dict(provider="other"), dict(api_key=""), dict(api_key="has whitespace"),
                 dict(timeout_s=0), dict(timeout_s=301), dict(timeout_s=float("nan")),
                 dict(base_url="http://user:secret@localhost"), dict(base_url="http://localhost/?key=secret"),
                 dict(base_url="file:///tmp/file"), dict(provider="openai", model="gpt-other"),
                 dict(provider="openai", base_url="http://localhost")]
        for changed in cases:
            with self.subTest(changed=changed), self.assertRaises(DecisionError):
                ProviderConfig(**(dict(provider="d1", api_key=FAKE_KEY) | changed))
        self.assertEqual(endpoint("http://localhost:4000/v1/"), "http://localhost:4000/v1/decisions")

    def test_native_wire_text_and_image(self):
        req = request()
        local = to_wire(req, self.config())
        cloud = to_wire(req, self.config("openai"))
        self.assertNotIn("model", local)
        self.assertEqual(local["questions"]["runtime_observed"]["type"], "noul")
        self.assertIsInstance(local["questions"]["execution_evidence"]["criteria"], list)
        self.assertEqual(cloud["model"], "gpt-6-luna")
        self.assertEqual(cloud["input"], req["state"])
        self.assertIsInstance(cloud["questions"], list)
        req["images"] = ["data:image/png;base64,aW1hZ2U="]
        req["questions"][0]["true_description"] = "Runtime trace"
        local = to_wire(req, self.config())
        cloud = to_wire(req, self.config("openai"))
        self.assertEqual(local["images"], req["images"])
        self.assertEqual(local["questions"]["runtime_observed"]["criteria"], {"true": "Runtime trace"})
        self.assertEqual(cloud["input"][0]["content"][1], {"type": "input_image", "image_url": req["images"][0]})
        self.assertIn("true: Runtime trace", cloud["questions"][0]["instructions"])

    def test_both_native_protocols_normalize_identically(self):
        results = []
        for provider in ("d1", "openai"):
            result, transport = self.run_client(provider, native(provider))
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["provider_request_id"], "req-fixture")
            self.assertEqual(result["run_id"], "test-run")
            self.assertEqual(result["attempts"], 1)
            self.assertIsNone(result["timing"]["queue_s"])
            self.assertIsNone(result["cost_usd"])
            self.assertGreaterEqual(result["timing"]["total_wall_s"], result["timing"]["request_wall_s"])
            self.assertEqual(transport.call_count, 1)
            self.assertEqual(transport.call_args.args[3], 75)
            results.append(result["answers"])
        self.assertEqual(*results)

    def test_typed_boolean_choice_does_not_collapse_string(self):
        req = request()
        req["questions"] = [{"name": "typed", "type": "choice", "instructions": "Pick the boolean",
                              "choices": [{"value": True}, {"value": "true"}, {"value": False}]}]
        local_wire = to_wire(req, self.config())
        self.assertEqual(list(local_wire["questions"]["typed"]["criteria"]), ["option_0", "option_1", "option_2"])
        local = {"answers": {"typed": {"choice": "option_0", "confidence": .8,
                                       "probabilities": {"option_0": .8, "option_1": .1, "option_2": .1}}}}
        cloud = {"answers": [{"name": "typed", "type": "choice", "choice": True, "confidence": .8,
                              "probabilities": [{"value": value, "probability": p}
                                                for value, p in ((True, .8), ("true", .1), (False, .1))]}]}
        left = from_wire(local, req, "d1")
        right = from_wire(cloud, req, "openai")
        self.assertEqual(left, right)
        self.assertIs(left[0]["choice"], True)
        cloud["answers"][0]["choice"] = 1
        with self.assertRaises(DecisionError):
            from_wire(cloud, req, "openai")

    def test_partial_and_full_refusal_are_not_false_predicates(self):
        for count, status in ((1, "partial_refusal"), (3, "refused")):
            response = native("openai")
            for row in response["answers"][:count]:
                row.clear()
            for index in range(count):
                response["answers"][index] = {"type": "refusal", "name": request()["questions"][index]["name"]}
            result, _ = self.run_client("openai", response)
            self.assertEqual(result["status"], status)
            self.assertEqual(result["answers"][0], {"name": "runtime_observed", "type": "refusal"})

    def test_missing_extra_duplicate_and_reordered_answers_fail(self):
        original = native("openai")
        variants = []
        for rows in (original["answers"][:2], original["answers"] + original["answers"][:1],
                     original["answers"][::-1], [original["answers"][0]] * 3):
            variants.append({"answers": rows})
        variants += [{"answers": {}}, {"answers": [None] * 3}, []]
        for response in variants:
            with self.subTest(response=response):
                result, _ = self.run_client("openai", response)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["answers"], [])
        local = native("d1")
        local["answers"]["extra"] = {}
        self.assertEqual(self.run_client("d1", local)[0]["status"], "failed")

    def test_nonfinite_out_of_range_and_boolean_probabilities_fail(self):
        for provider in ("d1", "openai"):
            for value in (float("nan"), float("inf"), -.1, 1.1, True, None, "0.5"):
                response = native(provider)
                if provider == "d1":
                    response["answers"]["runtime_observed"]["noul"] = value
                else:
                    response["answers"][0]["probability"] = value
                with self.subTest(provider=provider, value=value):
                    result, _ = self.run_client(provider, response)
                    self.assertEqual(result["error"]["code"], "invalid_probability")

    def test_malformed_distributions_scores_and_types_fail(self):
        for change in ("duplicate", "wrong_choice", "wrong_sum", "bad_confidence", "index", "label", "score", "score_mean", "type"):
            response = native("openai")
            choice, score = response["answers"][1:]
            if change == "duplicate": choice["probabilities"][1]["value"] = "source"
            if change == "wrong_choice": choice["choice"] = "invented"
            if change == "wrong_sum": choice["probabilities"][0]["probability"] = .2
            if change == "bad_confidence": choice["confidence"] = float("nan")
            if change == "index": score["probabilities"][0]["value"] = -1
            if change == "label": score["probabilities"][0]["label"] = "wrong"
            if change == "score": score["score"] = 3
            if change == "score_mean": score["score"] = 1.4
            if change == "type": response["answers"][0]["type"] = "choice"
            with self.subTest(change=change):
                self.assertEqual(self.run_client("openai", response)[0]["status"], "failed")
        local = native("d1")
        local["answers"]["execution_evidence"]["probabilities"] = {"1": .8, "2": .1, "3": .1}
        self.assertEqual(self.run_client("d1", local)[0]["error"]["code"], "invalid_distribution")

    def test_request_limits_and_unknown_fields_fail_before_transport(self):
        mutations = [lambda r: r.update(schema_version=2), lambda r: r.update(questions=[]),
                     lambda r: r.update(questions=r["questions"] * 68),
                     lambda r: r.update(images=["https://example.org/frame.png"]),
                     lambda r: r.update(images=["data:image/png;base64,@@@"]),
                     lambda r: r.update(state=None), lambda r: r.update(api_key="forbidden"),
                     lambda r: r["questions"][0].update(name=r["questions"][1]["name"]),
                     lambda r: r["questions"][1].update(choices=[{"value": True}, {"value": 1}]),
                     lambda r: r["questions"][2].update(levels=[{"label": "x"}] * 11)]
        for mutate in mutations:
            req = request()
            mutate(req)
            result, transport = self.run_client("d1", native("d1"), req)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["attempts"], 0)
            transport.assert_not_called()

    def test_transport_timeout_http_cancel_and_no_retries_or_fallback(self):
        failures = [(TimeoutError(FAKE_KEY), "timeout", "failed"),
                    (urllib.error.URLError(TimeoutError(FAKE_KEY)), "timeout", "failed"),
                    (urllib.error.URLError(FAKE_KEY), "transport_error", "failed"),
                    (urllib.error.HTTPError("url", 429, FAKE_KEY, {}, None), "http_error", "failed"),
                    (ValueError(FAKE_KEY), "invalid_json_response", "failed"),
                    (RuntimeError(FAKE_KEY), "transport_or_response_error", "failed"),
                    (KeyboardInterrupt(), "cancelled", "cancelled")]
        for error, code, status in failures:
            transport = Mock(side_effect=error)
            result = DecisionClient(self.config(), transport=transport).decide(request())
            self.assertEqual(result["status"], status)
            self.assertEqual(result["error"]["code"], code)
            self.assertNotIn(FAKE_KEY, json.dumps(result))
            self.assertEqual(transport.call_count, 1)
            self.assertEqual(result["provider"], "d1")
            self.assertEqual(result["retries"], 0)

    def test_server_echoes_and_usage_are_sanitized(self):
        response = native("openai")
        response["model"] = FAKE_KEY
        response["usage"][FAKE_KEY] = FAKE_KEY
        response["usage"]["total_tokens"] = float("nan")
        response["usage"]["input_tokens"] = -1
        transport = Mock(return_value=WireResponse(response, FAKE_KEY))
        req = request()
        req["context"] = {FAKE_KEY: FAKE_KEY}
        result = DecisionClient(self.config("openai"), transport=transport).decide(req)
        serialized = json.dumps(result, allow_nan=False)
        self.assertNotIn(FAKE_KEY, serialized)
        self.assertNotIn("input_tokens", result["usage"])
        self.assertEqual(result["reported_model"], "[REDACTED]")

    def test_http_diagnostics_only_keep_allowlisted_codes(self):
        for code in ("insufficient_quota", "rate_limit_exceeded", FAKE_KEY):
            raw = json.dumps({"error": {"code": code, "type": code, "message": FAKE_KEY}}).encode()
            error = urllib.error.HTTPError("url", 429, FAKE_KEY, {}, io.BytesIO(raw))
            transport = Mock(side_effect=error)
            result = DecisionClient(self.config(), transport=transport).decide(request())
            self.assertNotIn(FAKE_KEY, json.dumps(result))
            if code == FAKE_KEY:
                self.assertEqual(set(result["error"]), {"code", "http_status"})
            else:
                self.assertEqual(result["error"]["provider_error_code"], code)
                self.assertEqual(result["error"]["provider_error_type"], code)
        error = urllib.error.HTTPError("url", 429, "", {}, io.BytesIO(b"x" * 9000))
        transport = Mock(side_effect=error)
        self.assertEqual(DecisionClient(self.config(), transport=transport).decide(request())["error"],
                         {"code": "http_error", "http_status": 429})

    def test_bounded_image_helper_and_redirect_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            frame = Path(directory) / "frame.png"
            frame.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
            self.assertTrue(image_data_url(frame).startswith("data:image/png;base64,"))
            frame.write_text("not an image")
            with self.assertRaises(DecisionError): image_data_url(frame)
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example"))
        reply = Mock()
        reply.read.return_value = b'{"answers":{}}'
        reply.headers = {"x-request-id": "native-request"}
        reply.__enter__ = Mock(return_value=reply)
        reply.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = reply
        with patch("urllib.request.build_opener", return_value=opener):
            result = http_post("http://localhost/v1/decisions", FAKE_KEY, {}, 7)
        self.assertEqual(result.request_id, "native-request")
        outgoing = opener.open.call_args.args[0]
        self.assertEqual(outgoing.get_header("Authorization"), "Bearer " + FAKE_KEY)
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 7)
        reply.read.return_value = b"x" * (MAX_BYTES + 1)
        with patch("urllib.request.build_opener", return_value=opener), self.assertRaisesRegex(DecisionError, "response_size_limit"):
            http_post("http://localhost/v1/decisions", FAKE_KEY, {}, 7)
        self.assertEqual(reply.read.call_args.args, (MAX_BYTES + 1,))

    def test_cli_validation_and_failure_records(self):
        with tempfile.TemporaryDirectory() as directory:
            records = Path(directory) / "records.jsonl"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout), patch.dict(os.environ, {}, clear=True):
                status = main(["--request", str(EXAMPLES / "text.json"), "--check-request"])
            self.assertEqual(status, 0)
            self.assertEqual(json.loads(stdout.getvalue())["attempts"], 0)
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout), patch.dict(os.environ, {}, clear=True):
                status = main(["--provider", "openai", "--request", str(EXAMPLES / "text.json"), "--records", str(records)])
            self.assertEqual(status, 1)
            output = json.loads(stdout.getvalue())
            self.assertEqual(output["error"]["code"], "missing_or_invalid_api_key")
            self.assertEqual(json.loads(records.read_text()), output)

    def test_image_only_cli_request_is_validated_after_image_append(self):
        with tempfile.TemporaryDirectory() as directory:
            frame = Path(directory) / "frame.png"
            frame.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
            req = request()
            req["state"] = None
            source = Path(directory) / "request.json"
            source.write_text(json.dumps(req))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--request", str(source), "--image", str(frame), "--check-request"]), 0)

    def test_gameplay_gate_preserves_d1_rows_and_separates_cloud_outputs(self):
        from tools.re import gameplay_gate
        with tempfile.TemporaryDirectory() as directory:
            original_cwd = Path.cwd()
            try:
                os.chdir(directory)
                keyframes = Path("local/captures/test/boot/keyframes")
                keyframes.mkdir(parents=True)
                for name in ("frame1.png", "frame2.png"):
                    (keyframes / name).write_bytes(b"\x89PNG\r\n\x1a\nfixture")
                for provider in ("d1", "openai"):
                    canonical = Path(f"local/captures/test/gameplay_{provider}.jsonl")
                    canonical.write_text('{"prior":"full-run"}\n')
                    native_answer = ({"answers": {"gameplay": {"type": "noul", "noul": .9}}} if provider == "d1"
                                     else {"answers": [{"name": "gameplay", "type": "predicate", "probability": .9}]})
                    transport = Mock(return_value=WireResponse(native_answer))
                    client = DecisionClient(self.config(provider), transport=transport)
                    argv = ["gameplay_gate.py", "--provider", provider, "--ids", "test", "--max-frames", "1"]
                    with patch("sys.argv", argv), patch.object(gameplay_gate, "DecisionClient", return_value=client), \
                         patch.object(gameplay_gate.ProviderConfig, "from_env", return_value=self.config(provider)), \
                         contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(gameplay_gate.main(), 0)
                    self.assertEqual(transport.call_count, 1)
                    self.assertEqual(canonical.read_text(), '{"prior":"full-run"}\n')
                    samples = list(canonical.parent.glob(f"gameplay_{provider}.sample-*.jsonl"))
                    self.assertEqual(len(samples), 1)
                    output = samples[0]
                    self.assertEqual(json.loads(output.read_text()), {"phase": "boot", "frame": "frame1.png", "p_gameplay": .9})
                    records = Path(f"local/captures/test/gameplay_{provider}_requests.jsonl")
                    self.assertEqual(json.loads(records.read_text())["provider"], provider)
                self.assertTrue(Path("local/captures/test/gameplay_d1.jsonl").is_file())
                self.assertTrue(Path("local/captures/test/gameplay_openai.jsonl").is_file())
            finally:
                os.chdir(original_cwd)

    def test_gameplay_gate_only_schedules_worker_window(self):
        from tools.re import gameplay_gate
        pool = Mock()
        pool.submit.side_effect = lambda *args: Mock(result=Mock(return_value={"status": "success"}))
        reports = gameplay_gate.bounded_reports(pool, [Path(str(i)) for i in range(100)], None, 'run', 2)
        next(reports)
        self.assertEqual(pool.submit.call_count, 2)
        reports.close()
        self.assertEqual(pool.submit.call_count, 2)


if __name__ == "__main__":
    unittest.main()
