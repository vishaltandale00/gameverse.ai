"""Write per-facet, name-free text profiles of each game with the local LLM (llm_knowledge evidence).

These are a stopgap view for games whose ontology decomposition doesn't exist yet, and a baseline to compare
against decomposition-derived views. Output: local/embeddings/profiles.jsonl (one line per game x facet).
Usage: LITELLM_API_KEY=... python3 tools/ontology/profile_games.py [--jobs 32] [--temperature 0.2] [--out PATH]
A second sample (e.g. --temperature 0.8 --out local/embeddings/profiles_b.jsonl) gives split-half reliability.
"""
import argparse
import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROMPT_VERSION = 1
MODEL = "ramblerun/Reasoning-AI"
BASE = os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000")
FACETS = {
    "mechanics": "core rules and verbs: combat, actions, interactions, win/lose conditions, rules of the main loop",
    "movement_physics": "how the player moves: locomotion, jumping, momentum, gravity, collision, vehicle handling, game feel",
    "ai": "how enemies, opponents, NPCs and allies behave and decide",
    "camera": "camera behaviour: scrolling, following, framing, transitions between screens/rooms",
    "projection": "viewpoint/projection: side view, top-down, isometric, behind-view pseudo-3D, 3D, and how depth is conveyed",
    "rendering": "graphics technique: sprites and tile layers, parallax, scaling/rotation, raster effects, pre-rendered or polygonal 3D, art style",
    "ui_hud": "on-screen HUD and in-game menus: what information is shown and how it is controlled",
    "progression": "progression and world structure: levels, hubs, overworld, open world, ability gating, unlocks, difficulty curve",
    "economy": "resources and economy: currencies, items, health/ammo, experience, collectibles, sources and sinks",
    "narrative_delivery": "how the story is delivered: cutscenes, dialogue boxes, environmental storytelling, amount and structure of plot",
    "setting": "fiction and setting: world, era, tone, themes, protagonist archetype, factions",
    "frontend": "boot sequence and meta flow: logos, intro, title screen, attract/demo mode, main menu, file select, saving, game over",
    "audio": "music and sound: musical style and instrumentation, adaptive or state-driven music, sound effects as feedback",
}


def profile(title: str, facet: str, desc: str, key: str, temperature: float) -> str:
    prompt = (f"Game: {title} (Game Boy Advance).\nDescribe its {facet.replace('_', ' ')} — {desc}.\n"
              "Write 80-140 words of concrete, factual description. Rules: do NOT mention the game's title, franchise, "
              "series, developer, or any proper names of characters, places, items or creatures; describe them "
              "generically (e.g. 'a bounty hunter in a power suit', 'collectible battle creatures'). If you are unsure "
              "about a detail, omit it. Plain prose, no lists, no preamble.")
    body = {"model": MODEL, "max_tokens": 400, "temperature": temperature, "chat_template_kwargs": {"enable_thinking": False},
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(f"{BASE}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))["choices"][0]["message"]["content"].strip()
        except Exception as e:
            err = repr(e)
            time.sleep(1 + attempt)
    raise RuntimeError(err)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=32)
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--out", default="local/embeddings/profiles.jsonl")
    args = ap.parse_args()
    key = os.environ["LITELLM_API_KEY"]
    roms = json.loads(Path("local/re/roms.json").read_text())
    titles = {r["id"]: re.sub(r"\s*\([^)]*\)", "", Path(r["file"]).stem) for r in roms}
    tasks = [(gid, f, d) for gid in titles for f, d in FACETS.items()]
    t0 = time.time()
    with ThreadPoolExecutor(args.jobs) as pool:
        outs = list(pool.map(lambda t: (t, profile(titles[t[0]], t[1], t[2], key, args.temperature)), tasks))
    Path("local/embeddings").mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        for (gid, facet, _), text in outs:
            f.write(json.dumps({"id": gid, "facet": facet, "text": text, "model": MODEL,
                                "prompt_version": PROMPT_VERSION, "temperature": args.temperature,
                                "evidence": "llm_knowledge"}) + "\n")
    print(f"{len(tasks)} profiles in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
