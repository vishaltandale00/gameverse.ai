"""One bounded candidate attempt; python3 -m tools.game_attempt --help."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.playtester.core import Limits
from .run import GeneratorConfig, MAX_REQUEST_BYTES, ROOT, run_attempt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, default=ROOT / "tools/game_attempt/examples/key_gate.json")
    parser.add_argument("--output-root", type=Path, default=ROOT / "local/game-attempts")
    parser.add_argument("--generator", choices=("template", "local", "openai"), default="template")
    parser.add_argument("--model", help="Generation model; explicit model or OPENAI_GENERATION_MODEL required for OpenAI")
    parser.add_argument("--generation-timeout", type=float, default=30)
    parser.add_argument("--generation-tokens", type=int, default=1024)
    parser.add_argument("--policy", choices=("frontier", "d1", "openai"), default="frontier")
    parser.add_argument("--max-steps", type=int, default=80)
    parser.add_argument("--max-frames", type=int, default=4800)
    parser.add_argument("--max-seconds", type=float, default=10)
    parser.add_argument("--max-decisions", type=int, default=20)
    args = parser.parse_args(argv)
    try:
        with args.request.open("rb") as handle:
            raw = handle.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            parser.error("request_size_limit")
        request = json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        parser.error("request_read_or_json_error")
    try:
        generator = GeneratorConfig(args.generator, args.model, args.generation_timeout, args.generation_tokens)
        limits = Limits(max_steps=args.max_steps, max_frames=args.max_frames, max_seconds=args.max_seconds,
                        max_decisions=args.max_decisions, max_escalations=0)
    except ValueError:
        parser.error("invalid_resource_limit")
    report = run_attempt(request, args.output_root, generator=generator, limits=limits, policy=args.policy)
    print(json.dumps({"attempt_id": report["attempt_id"], "status": report["status"],
                      "artifacts": report["artifacts"], "timing": report["timing"],
                      "error": report.get("error")}, allow_nan=False))
    return 0 if report["status"] == "success" else 130 if report["status"] == "cancelled" else 1


if __name__ == "__main__":
    raise SystemExit(main())
