"""JSON CLI: python3 -m tools.decisions --provider d1 --request request.json."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid

from .client import DecisionClient, DecisionError, MAX_BYTES, ProviderConfig, image_data_url, redact, validate_request


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=("d1", "openai"), default="d1")
    parser.add_argument("--request", required=True, help="Portable JSON request file, or - for stdin")
    parser.add_argument("--image", action="append", default=[], type=Path, help="Append local PNG/JPEG/WebP/GIF evidence")
    parser.add_argument("--base", help="Explicit base URL for the selected provider (root or /v1)")
    parser.add_argument("--model", help="d1 recorded routing alias, or OpenAI gpt-6-luna")
    parser.add_argument("--timeout", type=float, default=75, help="Per-request socket timeout, 0 < seconds <= 300")
    parser.add_argument("--run-id", help="Optional parent run/request correlation ID")
    parser.add_argument("--records", type=Path, help="Append the same report to this JSONL file, including failures")
    parser.add_argument("--check-request", action="store_true", help="Validate only; no credentials or network calls")
    args = parser.parse_args(argv)
    started = time.perf_counter()
    result = {"schema_version": 1, "run_id": args.run_id or uuid.uuid4().hex,
              "provider": args.provider, "status": "failed", "answers": [], "attempts": 0, "retries": 0}
    try:
        try:
            if args.request == "-":
                raw = sys.stdin.buffer.read(MAX_BYTES * 2 + 1)
            else:
                with Path(args.request).open("rb") as handle:
                    raw = handle.read(MAX_BYTES * 2 + 1)
        except OSError:
            raise DecisionError("request_read_failed") from None
        if len(raw) > MAX_BYTES * 2:
            raise DecisionError("request_size_limit")
        try:
            request = json.loads(raw)
        except (ValueError, UnicodeError):
            raise DecisionError("invalid_request_json") from None
        if not isinstance(request, dict) or not isinstance(request.get("images", []), list):
            raise DecisionError("invalid_request")
        request["images"] = request.get("images", []) + [image_data_url(path) for path in args.image]
        validate_request(request)
        if args.check_request:
            result["status"] = "validated"
        else:
            config = ProviderConfig.from_env(args.provider, base_url=args.base, model=args.model, timeout_s=args.timeout)
            result = DecisionClient(config).decide(request, run_id=result["run_id"])
    except DecisionError as error:
        result["error"] = {"code": str(error)}
    except KeyboardInterrupt:
        result["status"] = "cancelled"
        result["error"] = {"code": "cancelled"}
    except Exception:
        result["error"] = {"code": "invalid_request_or_configuration"}
    result.setdefault("timing", {"total_wall_s": round(time.perf_counter() - started, 6),
                                 "request_wall_s": None, "queue_s": None})
    # Scrub both env credentials even if supplied input happens to contain either.
    for variable in ("LITELLM_API_KEY", "OPENAI_API_KEY"):
        if os.environ.get(variable):
            result = redact(result, os.environ[variable])
    line = json.dumps(result, allow_nan=False)
    if args.records:
        try:
            args.records.parent.mkdir(parents=True, exist_ok=True)
            with args.records.open("a") as handle:
                handle.write(line + "\n")
        except OSError:
            result["status"] = "failed"
            result["error"] = {"code": "record_write_failed"}
            line = json.dumps(result, allow_nan=False)
    print(line)
    if result["status"] == "cancelled":
        return 130
    return 0 if result["status"] in ("success", "validated") else 1


if __name__ == "__main__":
    raise SystemExit(main())
