"""Classify capture keyframes with the local vision model (screen type, projection, caption).

Writes local/captures/<id>/frames.jsonl and appends a run record to local/captures/frame_runs.jsonl.
Usage: LITELLM_API_KEY=... python3 tools/re/classify_frames.py [--jobs 16] [--ids a,b]
"""
import argparse
import base64
import json
import os
import re
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROMPT_VERSION = 1
MODEL = "ramblerun/Multimodal-AI"
BASE = os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000")
SCREEN_TYPES = ["company_logo", "legal_or_warning", "title_screen", "main_menu", "file_select", "options_or_submenu",
                "name_entry", "cutscene_or_story", "dialogue_text", "gameplay", "map_or_world_map",
                "loading_or_transition", "black_or_blank", "other"]
PROJECTIONS = ["side_view", "top_down", "three_quarter_top_down", "isometric", "behind_view_pseudo3d", "first_person",
               "fixed_3d_camera", "static_screen", "none"]
PROMPT = f"""Classify this Game Boy Advance screenshot. Reply with JSON only:
{{"screen_type": one of {json.dumps(SCREEN_TYPES)},
 "projection": one of {json.dumps(PROJECTIONS)},
 "has_hud": true/false,
 "caption": "<=25 words, concrete visual description"}}"""


def classify(path: Path, key: str) -> dict:
    url = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
    body = {"model": MODEL, "max_tokens": 200, "temperature": 0, "chat_template_kwargs": {"enable_thinking": False},
            "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": url}},
                                                      {"type": "text", "text": PROMPT}]}]}
    req = urllib.request.Request(f"{BASE}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            text = json.load(urllib.request.urlopen(req, timeout=120))["choices"][0]["message"]["content"]
            out = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
            if out.get("screen_type") not in SCREEN_TYPES or out.get("projection") not in PROJECTIONS:
                out["invalid_label"] = True
            return out
        except Exception as e:  # retry transient failures, then record the error
            err = repr(e)
            time.sleep(1 + attempt)
    return {"error": err}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=16)
    ap.add_argument("--ids")
    args = ap.parse_args()
    key = os.environ["LITELLM_API_KEY"]
    root = Path("local/captures")
    ids = args.ids.split(",") if args.ids else sorted(p.name for p in root.iterdir() if (p / "summary.json").exists())
    run = {"run_id": time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6], "model": MODEL,
           "prompt_version": PROMPT_VERSION, "jobs": args.jobs, "start": time.time(), "games": {}}
    with ThreadPoolExecutor(args.jobs) as pool:
        for gid in ids:
            t0 = time.time()
            frames = sorted((root / gid).glob("*/keyframes/*.png"))
            results = list(pool.map(lambda p: classify(p, key), frames))
            with open(root / gid / "frames.jsonl", "w") as f:
                for p, r in zip(frames, results):
                    f.write(json.dumps({"phase": p.parts[-3], "frame": p.name, **r}) + "\n")
            errors = sum("error" in r for r in results)
            run["games"][gid] = {"frames": len(frames), "errors": errors, "wall_s": round(time.time() - t0, 2)}
            print(f"{gid}: {len(frames)} frames, {errors} errors, {time.time() - t0:.1f}s", flush=True)
    run["end"] = time.time()
    run["wall_s"] = round(run["end"] - run["start"], 2)
    with open(root / "frame_runs.jsonl", "a") as f:
        f.write(json.dumps(run) + "\n")
    print(f"total {run['wall_s']}s")


if __name__ == "__main__":
    main()
