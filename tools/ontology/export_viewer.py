# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml>=6"]
# ///
"""Bundle game-space analysis, ontology decompositions and capture facts into one JSON for the viewer.

Usage: uv run tools/ontology/export_viewer.py > local/embeddings/viewer_data.json
Contains no ROM bytes, frames or decompiled code; only names, abstractions and measurements.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
EMB = ROOT / "local/embeddings"
CAP = ROOT / "local/captures"

VIEW_LABELS = {
    "visual_style": "Visual style (gameplay frames)", "audio": "Audio (captured sound)",
    "rendering_measured": "Rendering (hardware telemetry)", "projection_measured": "Projection (frame tags)",
    "frontend_measured": "Front-end flow (screen types)",
}


def view_label(v: str) -> str:
    return VIEW_LABELS.get(v) or v.split(":", 1)[1].replace("_", " ").capitalize() + " (model profile)"


NAMES = {
    "castlevania-aria-of-sorrow": "Aria of Sorrow", "crash-bandicoot-the-huge-adventure": "Crash: Huge Adventure",
    "dragon-ball-advanced-adventure": "DB Advanced Adventure", "driv3r": "Driv3r",
    "final-fantasy-i-and-ii-dawn-of-souls": "FF I & II", "final-fantasy-tactics-advance": "FF Tactics Advance",
    "final-fantasy-vi-advance": "FF VI Advance", "grand-theft-auto": "GTA Advance",
    "kingdom-hearts-chain-of-memories": "KH Chain of Memories", "kirby-and-the-amazing-mirror": "Kirby Amazing Mirror",
    "kirby-nightmare-in-dream-land": "Kirby Nightmare", "legend-of-zelda-the-a-link-to-the-past-and-four-swords":
    "Link to the Past", "legend-of-zelda-the-the-minish-cap": "Minish Cap", "mario-and-luigi-superstar-saga":
    "Superstar Saga", "mario-kart-super-circuit": "Mario Kart SC", "megaman-zero": "Mega Man Zero",
    "metal-slug-advance": "Metal Slug Advance", "metroid-fusion": "Metroid Fusion", "metroid-zero-mission":
    "Zero Mission", "need-for-speed-underground": "NFS Underground", "pokemon-emerald-version": "Pokémon Emerald",
    "pokemon-firered-version": "Pokémon FireRed", "pokemon-leafgreen-version": "Pokémon LeafGreen",
    "pokemon-mystery-dungeon-red-rescue-team": "PMD Red", "pokemon-ruby-version": "Pokémon Ruby",
    "prince-of-persia-the-sands-of-time": "Prince of Persia", "shaman-king-master-of-spirits": "Shaman King",
    "sonic-advance": "Sonic Advance", "super-mario-advance": "Super Mario Adv.", "super-mario-advance-2-super-mario-world":
    "Super Mario World", "super-mario-advance-4-super-mario-bros-3": "Super Mario Bros. 3", "tekken-advance":
    "Tekken Advance", "wario-land-4": "Wario Land 4",
}


def main():
    space = json.loads((EMB / "game_space.json").read_text())
    roms = {r["id"]: r for r in json.loads((ROOT / "local/re/roms.json").read_text())}
    games = []
    for gid in space["ids"]:
        title = re.sub(r"\s*\([^)]*\)", "", Path(roms[gid]["file"]).stem)
        summ = json.loads((CAP / gid / "summary.json").read_text())["derived"]
        gate = CAP / gid / "gameplay_d1.jsonl"
        play = sum((json.loads(l)["p_gameplay"] or 0) >= 0.6 for l in gate.open()) if gate.exists() else 0
        frames = CAP / gid / "frames.jsonl"
        screens = Counter(json.loads(l).get("screen_type") for l in frames.open()) if frames.exists() else {}
        games.append({
            "id": gid, "title": title, "name": NAMES.get(gid, title), "game_code": roms[gid]["game_code"],
            "gameplay_frames": play,
            "low_coverage": gid in space.get("low_coverage", {}).get("visual_style", {}),
            "video_modes": summ["video_modes_frames"], "max_sprites": summ["max_sprites_visible"],
            "flags": sorted(k for k, v in summ["flags"].items() if v),
            "hblank_dma": summ.get("hblank_dma_targets", []),
            "mix_rate_hz": max(summ["sound"].get("directsound_rates_hz", {"0": 1}).items(), key=lambda x: x[1])[0],
            "screens": dict(screens.most_common()),
        })

    onto, concept_games = {}, defaultdict(set)
    for p in sorted((ROOT / "ontology/games").glob("*.yaml")):
        try:
            doc = yaml.safe_load(p.read_text())
        except yaml.YAMLError:
            continue
        comps = []
        for c in doc["components"]:
            for i in c["instantiates"]:
                concept_games[i["concept"]].add(doc["id"])
            params = {k: f"{v['value']} {v.get('unit', '')}".strip() for k, v in list((c.get("params") or {}).items())[:6]}
            comps.append({"id": c["id"], "facet": c["facet"], "label": c["label"],
                          "summary": " ".join(c["summary"].split())[:520], "params": params,
                          "concepts": [i["concept"] for i in c["instantiates"]],
                          "relations": [f"{r['type']} {r['target']}" for r in (c.get("relations") or [])][:6],
                          "evidence": sorted({e["kind"] for e in c["evidence"]})})
        onto[doc["id"]] = {"components": comps, "facet_counts": dict(Counter(c["facet"] for c in comps)),
                           "proposed_concepts": len(doc.get("proposed_concepts", [])),
                           "open_questions": len(doc.get("open_questions", []))}
    shared = sorted(([c, sorted(g)] for c, g in concept_games.items() if len(g) >= 2), key=lambda x: (-len(x[1]), x[0]))

    out = {
        "generated": space.get("generated"), "games": games,
        "views": {v: {"label": view_label(v), "provenance": space["provenance"].get(v, ""), **d}
                  for v, d in space["views"].items()},
        "cross_view": space["cross_view"], "axis_groups": space["axis_groups"],
        "low_coverage": space.get("low_coverage", {}),
        "seeds": space["mashup_seeds"][:30],
        "ontology": onto, "shared_concepts": shared[:80], "concept_total": len(concept_games),
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
