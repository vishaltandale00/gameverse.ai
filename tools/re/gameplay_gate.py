"""Score capture keyframes with d1 (default) or native OpenAI Decisions.

Writes local/captures/<id>/gameplay_d1.jsonl ({phase, frame, p_gameplay}) and appends a run record to
local/captures/gameplay_runs.jsonl. OpenAI writes gameplay_openai.jsonl separately.
Usage: python3 tools/re/gameplay_gate.py [--ids a,b] [--jobs 4] [--provider d1|openai]
Keys stay external: LITELLM_API_KEY for d1; OPENAI_API_KEY for OpenAI.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.decisions import DecisionClient, DecisionError, ProviderConfig, image_data_url

QUESTION_VERSION = 1
BASE = os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000")
QUESTIONS = {"gameplay": {
    "type": "noul",
    "instructions": "Is this Game Boy Advance screenshot showing active gameplay, where the player controls a "
                    "character or vehicle in the game world?",
    "criteria": {"true": "active gameplay in the game world (a HUD or small pause overlay is fine)",
                 "false": "a menu, title screen, file/name select, logo, legal notice, story cutscene, "
                          "narration text, or blank/transition screen"}}}


def score_report(path: Path, client: DecisionClient, run_id: str | None = None) -> dict:
    question = QUESTIONS["gameplay"]
    request = {"schema_version": 1, "state": None,
               "questions": [{"name": "gameplay", "type": "predicate", "instructions": question["instructions"],
                              "true_description": question["criteria"]["true"],
                              "false_description": question["criteria"]["false"]}],
               "context": {"game_id": path.parts[-4], "game_version": None,
                           "environment_harness_version": None, "adapter_version": None,
                           "loop_config_ref": f"gameplay_gate:question-v{QUESTION_VERSION}",
                           "evidence_ref": str(path)}}
    try:
        request["images"] = [image_data_url(path)]
    except DecisionError as error:
        report = client.decide(request, run_id=run_id)  # Retain normal run metadata without a network call.
        report["error"] = {"code": str(error)}
        return report
    return client.decide(request, run_id=run_id)


def probability_from_report(report: dict) -> float | None:
    if report["status"] == "success" and report["answers"][0]["type"] == "predicate":
        return report["answers"][0]["probability"]
    return None


def score(path: Path, key: str) -> float | None:
    """Preserve the existing d1 helper signature; one request, no hidden retries."""
    client = DecisionClient(ProviderConfig("d1", key, base_url=BASE))
    return probability_from_report(score_report(path, client))


def bounded_reports(pool, frames, client, run_id, window):
    """Submit only a worker-sized window; cancel queued requests on interruption."""
    pending = deque()
    source = iter(frames)
    def submit():
        path = next(source, None)
        if path is not None:
            pending.append(pool.submit(score_report, path, client, run_id + ':' + str(path)))
    try:
        for _ in range(window):
            submit()
        while pending:
            yield pending.popleft().result()
            submit()
    finally:
        for future in pending:
            future.cancel()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--provider", choices=("d1", "openai"), default="d1")
    ap.add_argument("--timeout", type=float, default=75)
    ap.add_argument("--max-frames", type=int, help="Cap total requests across the selected games")
    args = ap.parse_args()
    if not 1 <= args.jobs <= 16:
        ap.error("--jobs must be between 1 and 16")
    if args.max_frames is not None and args.max_frames < 1:
        ap.error("--max-frames must be positive")
    try:
        client = DecisionClient(ProviderConfig.from_env(args.provider, timeout_s=args.timeout))
    except DecisionError as error:
        ap.error(str(error))
    root = Path("local/captures")
    ids = args.ids.split(",") if args.ids else sorted(p.name for p in root.iterdir() if (p / "summary.json").exists())
    run = {"run_id": time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6], "model": client.config.model,
           "provider": args.provider, "client": client.source, "jobs": args.jobs,
           "timeout_s": args.timeout, "max_frames": args.max_frames, "retries": 0,
           "question_version": QUESTION_VERSION, "start": time.time(), "games": {}, "outcome": "running"}
    remaining = args.max_frames
    try:
        with ThreadPoolExecutor(args.jobs) as pool:
            for gid in ids:
                if remaining == 0:
                    break
                t0 = time.time()
                frames = sorted((root / gid).glob("*/keyframes/*.png"))
                if remaining is not None:
                    frames = frames[:remaining]
                    remaining -= len(frames)
                ps = []
                # Keep legacy d1 frame rows/file intact; request records add provenance and failure reasons.
                # Bounded pilots must never truncate a previous full classification.
                suffix = '.sample-' + run['run_id'] if args.max_frames is not None else ''
                output = root / gid / f"gameplay_{args.provider}{suffix}.jsonl"
                with open(output, "w") as f, \
                     open(root / gid / f"gameplay_{args.provider}_requests.jsonl", "a") as records:
                    reports = bounded_reports(pool, frames, client, run['run_id'], args.jobs)
                    for p, report in zip(frames, reports):
                        s = probability_from_report(report)
                        ps.append(s)
                        f.write(json.dumps({"phase": p.parts[-3], "frame": p.name, "p_gameplay": s}) + "\n")
                        records.write(json.dumps(report, allow_nan=False) + "\n")
                        records.flush()
                n_play = sum(s is not None and s >= 0.6 for s in ps)
                run["games"][gid] = {"frames": len(frames), "gameplay_frames": n_play,
                                     "errors": sum(s is None for s in ps), "wall_s": round(time.time() - t0, 2),
                                     "output": str(output)}
                print(f"{gid}: {n_play}/{len(frames)} gameplay, {time.time() - t0:.1f}s", flush=True)
        run["outcome"] = "failed" if any(game["errors"] for game in run["games"].values()) else "success"
    except KeyboardInterrupt:
        run["outcome"] = "cancelled"
    except Exception:
        run['outcome'] = 'failed'
        run['error'] = 'capture_scoring_or_output_failed'
    finally:
        run["wall_s"] = round(time.time() - run["start"], 2)
        with open(root / "gameplay_runs.jsonl", "a") as f:
            f.write(json.dumps(run) + "\n")
    print(f"total {run['wall_s']}s")
    return 0 if run["outcome"] == "success" else (130 if run["outcome"] == "cancelled" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
