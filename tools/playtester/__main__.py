"""Run bounded exploration against a reference game or private adapter worker."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from tools.decisions import ProviderConfig

from .adapters import GridAdapter, SubprocessAdapter
from .core import FrontierPolicy, Limits, Playtester
from .models import ChatPolicy, DecisionPolicy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--game", "--reference-manifest", type=Path)
    source.add_argument("--adapter-command", nargs=argparse.REMAINDER,
                        help="Private JSONL worker argv; this option must come last")
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--sid-env-file", type=Path, help="Explicit sidbot SID_LLM_URL/SID_LLM_KEY credential reference; never logged")
    parser.add_argument("--output", type=Path, required=True, help="New output directory; never overwrites a run")
    parser.add_argument("--policy", choices=("frontier", "d1", "openai"), default="frontier")
    parser.add_argument("--system2", choices=("none", "chat"), default="none")
    parser.add_argument("--max-steps", type=int, default=80)
    parser.add_argument("--max-frames", type=int, default=9600)
    parser.add_argument("--max-seconds", type=float, default=120)
    parser.add_argument("--max-decisions", type=int, default=20)
    parser.add_argument("--max-escalations", type=int, default=3)
    parser.add_argument("--max-action-frames", type=int, default=120)
    parser.add_argument("--model-timeout", type=float, default=20)
    parser.add_argument("--adapter-timeout", type=float, default=10)
    parser.add_argument("--stationary-threshold", type=int, default=3)
    parser.add_argument("--confidence", type=float, default=.65)
    parser.add_argument("--margin", type=float, default=.20)
    args = parser.parse_args()
    adapter = None
    try:
        if args.sid_env_file:
            from tools.whole_game.model_config import load_sid_reference
            load_sid_reference(args.sid_env_file)
        profile = json.loads(args.profile.read_text()) if args.profile else None
        game = json.loads(args.game.read_text()) if args.game else None
        if game is not None and profile is None:
            profile = {"schema_version": 1, "game_id": game["game_id"],
                       "objective": "Reach the goal; collect required keys and open doors as needed",
                       "awareness": {"perspective": "top_down", "locomotion": "grid", "basis": "reference manifest mechanics"}}
        if profile is None:
            raise ValueError("external_adapter_requires_profile")
        limits = Limits(max_steps=args.max_steps, max_frames=args.max_frames, max_seconds=args.max_seconds,
                        max_decisions=args.max_decisions, max_escalations=args.max_escalations,
                        max_action_frames=args.max_action_frames, model_timeout_s=args.model_timeout,
                        stationary_threshold=args.stationary_threshold,
                        confidence_threshold=args.confidence, margin_threshold=args.margin)
        policy = FrontierPolicy() if args.policy == "frontier" else DecisionPolicy(
            ProviderConfig.from_env(args.policy, timeout_s=min(300., args.model_timeout)),
            confidence=args.confidence, margin=args.margin)
        system2 = ChatPolicy.from_env() if args.system2 == "chat" else None
        adapter = GridAdapter(game) if game is not None else SubprocessAdapter(args.adapter_command, timeout_s=args.adapter_timeout)
        report = Playtester(adapter, profile, policy, system2=system2, limits=limits, output=args.output).run()
        # Full evidence lives in report.json; stdout stays compact for callers.
        print(json.dumps({k: report[k] for k in ("run_id", "status", "reason", "steps", "frames",
                                                 "decision_calls", "system2_calls", "states_observed", "timing")}))
        return 0 if report["status"] == "success" else 3 if report["status"] == "stopped" else 2
    except KeyboardInterrupt:
        return 130
    except Exception:
        if adapter is not None:
            try:
                adapter.close()
            except Exception:
                pass
        print(json.dumps({"status": "failed", "reason": "invalid_config_or_initialization"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
