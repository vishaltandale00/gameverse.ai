# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2", "scipy>=1.14", "scikit-learn>=1.5", "pyyaml>=6"]
# ///
"""Embed each game per view (facet), cluster each view, and compare views to find independent axes.

  uv run tools/ontology/game_space.py embed     # needs LITELLM_API_KEY; caches vectors in local/embeddings/
  uv run tools/ontology/game_space.py analyze   # writes local/embeddings/game_space.json

Views:
  text:<facet>          name-free LLM profile per ontology facet (llm_knowledge), local/embeddings/profiles.jsonl
  visual_style          mean EmbeddingGemma image embedding of gameplay keyframes (capture_frame)
  audio                 mean EmbeddingGemma audio embedding of the loudest capture clips (capture audio)
  rendering_measured    standardized capture telemetry features (capture_telemetry)
  projection_measured   distribution of vision-model projection tags over gameplay frames
  frontend_measured     distribution of vision-model screen types over the attract/front-end phases

EmbeddingGemma quirk: media must be sent as {"image": dataURI} / {"audio": dataURI}. OpenAI-style
image_url/input_audio parts return 200 but are ignored, so we refuse batches that come back identical.
"""
import base64
import hashlib
import io
import json
import math
import os
import sys
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CAP = ROOT / "local/captures"
OUT = ROOT / "local/embeddings"
BASE = os.environ.get("LITELLM_BASE", "http://rrh-llm-1:4000")
MODEL = "ramblerun/TextEmbedding-AI"
TEXT_PREFIX = "task: clustering | query: "
MAX_FRAMES, CLIP_S, MAX_CLIPS = 16, 8, 4
GAMEPLAY_P, MIN_GAMEPLAY_FRAMES = 0.6, 8  # d1 gate threshold (34/34 on a hand-labelled sample) and coverage floor
NON_CONTENT = {"company_logo", "legal_or_warning", "black_or_blank", "loading_or_transition"}
SCREEN_TYPES = ["company_logo", "legal_or_warning", "title_screen", "main_menu", "file_select", "options_or_submenu",
                "name_entry", "cutscene_or_story", "dialogue_text", "gameplay", "map_or_world_map",
                "loading_or_transition", "black_or_blank", "other"]
PROJECTIONS = ["side_view", "top_down", "three_quarter_top_down", "isometric", "behind_view_pseudo3d", "first_person",
               "fixed_3d_camera", "static_screen", "none"]


# ---------------------------------------------------------------- embedding

class Embedder:
    def __init__(self):
        self.key = os.environ["LITELLM_API_KEY"]
        self.cache_path = OUT / "cache.npz"
        self.cache = dict(np.load(self.cache_path)) if self.cache_path.exists() else {}
        self.calls = 0

    def __call__(self, items: list) -> np.ndarray:
        keys = [hashlib.sha1(json.dumps(i, sort_keys=True).encode()).hexdigest() for i in items]
        todo = [(k, i) for k, i in zip(keys, items) if k not in self.cache]
        for s in range(0, len(todo), 32):
            batch = todo[s:s + 32]
            body = json.dumps({"model": MODEL, "input": [i for _, i in batch]}).encode()
            req = urllib.request.Request(f"{BASE}/v1/embeddings", data=body, headers={
                "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
            vecs = np.array([d["embedding"] for d in json.load(urllib.request.urlopen(req, timeout=600))["data"]])
            self.calls += 1
            if len(batch) > 1 and np.allclose(vecs, vecs[0]) and len({k for k, _ in batch}) > 1:
                raise RuntimeError("identical embeddings for distinct inputs: media likely ignored by the server")
            for (k, _), v in zip(batch, vecs):
                self.cache[k] = v / np.linalg.norm(v)
        return np.stack([self.cache[k] for k in keys])

    def save(self):
        np.savez(self.cache_path, **self.cache)


def data_uri(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def frames_for(gid: str) -> list[dict]:
    p = CAP / gid / "frames.jsonl"
    return [json.loads(line) for line in p.open()] if p.exists() else []


def pick_visual_frames(gid: str) -> tuple[list[Path], np.ndarray, int]:
    """Gameplay keyframes gated by d1 P(gameplay) >= GAMEPLAY_P, weighted by that probability.

    Returns (paths, weights, gameplay_frame_count). Games with fewer than MIN_GAMEPLAY_FRAMES are flagged
    low-coverage by the caller and excluded from visual-view comparisons."""
    p = CAP / gid / "gameplay_d1.jsonl"
    scored = [json.loads(line) for line in p.open()] if p.exists() else []
    chosen = [f for f in scored if (f["p_gameplay"] or 0) >= GAMEPLAY_P]
    n_play = len(chosen)
    if not chosen:  # fall back to the most gameplay-like frames so the vector exists, but stays flagged
        chosen = sorted(scored, key=lambda f: -(f["p_gameplay"] or 0))[:MAX_FRAMES]
    idx = sorted(set(np.linspace(0, len(chosen) - 1, min(MAX_FRAMES, len(chosen))).round().astype(int))) if chosen else []
    paths = [CAP / gid / chosen[i]["phase"] / "keyframes" / chosen[i]["frame"] for i in idx]
    return paths, np.array([chosen[i]["p_gameplay"] or 0 for i in idx]), n_play


def loud_clips(gid: str) -> list[bytes]:
    cands = []
    for ph in ("frontend", "attract"):
        p = CAP / gid / f"{ph}.wav"
        if not p.exists():
            continue
        w = wave.open(str(p))
        s = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        n = 16000 * CLIP_S
        for k in range(0, len(s) - n, n):
            seg = s[k:k + n]
            cands.append((float(np.sqrt(np.mean(seg[::8].astype(float) ** 2))), seg))
    cands = sorted([c for c in cands if c[0] > 500], key=lambda c: -c[0])[:MAX_CLIPS]
    out = []
    for _, seg in cands:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as o:
            o.setnchannels(1), o.setsampwidth(2), o.setframerate(16000), o.writeframes(seg.tobytes())
        out.append(buf.getvalue())
    return out


def telemetry_features(gid: str) -> dict[str, float]:
    d = json.loads((CAP / gid / "summary.json").read_text())["derived"]
    total = sum(d["video_modes_frames"].values()) or 1
    f = {f"mode{m}_share": d["video_modes_frames"].get(str(m), 0) / total for m in range(6)}
    f |= {k: float(v) for k, v in d["flags"].items()}
    f["max_sprites"] = d["max_sprites_visible"] / 128
    f["max_affine_sprites"] = d["max_affine_sprites"] / 32
    snd = d["sound"]
    ds = sum(snd.get("directsound_frames", {}).values())
    f["directsound_channels"] = sum(v > 0 for v in snd.get("directsound_frames", {}).values()) / 2
    f["psg_activity"] = sum(snd.get("psg_playing_frames", [])) / (4 * max(ds, 1))
    rates = snd.get("directsound_rates_hz", {})
    f["mix_rate_khz"] = (max(rates, key=rates.get) and int(max(rates, key=rates.get)) / 1000) if rates else 0.0
    return f


def unit(v):
    return v / (np.linalg.norm(v) + 1e-12)


def concept_definitions() -> dict[str, str]:
    """Game-independent concept definitions from every decomposition's proposed_concepts (name-free by brief)."""
    import yaml
    defs = {}
    for p in sorted((ROOT / "ontology/games").glob("*.yaml")):
        try:
            doc = yaml.safe_load(p.read_text())
        except yaml.YAMLError:
            continue
        for c in doc.get("proposed_concepts", []):
            defs.setdefault(c["id"], f"{c['label']}: {c['definition']}")
    return defs


def onto_texts() -> dict[str, dict[str, str]]:
    """Per decomposed game and facet: the definitions of the concepts its components instantiate."""
    import yaml
    defs, out = concept_definitions(), {}
    for p in sorted((ROOT / "ontology/games").glob("*.yaml")):
        try:
            doc = yaml.safe_load(p.read_text())
        except yaml.YAMLError:
            continue
        by_facet: dict[str, list[str]] = {}
        for c in doc["components"]:
            for i in c["instantiates"]:
                if i["concept"] in defs:
                    by_facet.setdefault(c["facet"], []).append(defs[i["concept"]])
        out[doc["id"]] = {f: "\n".join(sorted(set(v))) for f, v in by_facet.items()}
    return out


def embed():
    """Write views (full) plus independent halves 'view#a' / 'view#b' for split-half reliability."""
    OUT.mkdir(parents=True, exist_ok=True)
    emb = Embedder()
    ids = sorted(p.name for p in CAP.iterdir() if (p / "summary.json").exists())
    V: dict[str, dict[str, np.ndarray]] = {}
    provenance: dict[str, str] = {}
    t0 = time.time()

    def put(view, gid, full, a=None, b=None):
        V.setdefault(view, {})[gid] = full
        if a is not None and b is not None:
            V.setdefault(view + "#a", {})[gid] = a
            V.setdefault(view + "#b", {})[gid] = b

    # text profiles: sample A (and B when present) -> halves; full view = mean of both samples
    samples = [OUT / "profiles.jsonl", OUT / "profiles_b.jsonl"]
    samples = [[json.loads(line) for line in p.open()] for p in samples if p.exists()]
    for facet in sorted({r["facet"] for r in samples[0]}):
        vecs = []
        for rows in samples:
            rows = {r["id"]: r for r in rows if r["facet"] == facet}
            E = emb([TEXT_PREFIX + rows[g]["text"] for g in ids])
            vecs.append(dict(zip(ids, E)))
        for g in ids:
            if len(vecs) == 2:
                put(f"text:{facet}", g, unit(vecs[0][g] + vecs[1][g]), vecs[0][g], vecs[1][g])
            else:
                put(f"text:{facet}", g, vecs[0][g])
        provenance[f"text:{facet}"] = (f"llm_knowledge profile ({samples[0][0]['model']}, prompt v"
                                       f"{samples[0][0]['prompt_version']}, {len(samples)} independent samples)")

    # decomposition-grounded text (decomposed games only; compared separately, not mixed into axes)
    for gid, facets in onto_texts().items():
        for facet, text in facets.items():
            if gid in ids and text:
                put(f"onto:{facet}", gid, emb([TEXT_PREFIX + text])[0])
    for v in [v for v in V if v.startswith("onto:")]:
        provenance[v] = "ontology decomposition: definitions of instantiated concepts"

    low_coverage = {}
    for gid in ids:
        paths, weights, n_play = pick_visual_frames(gid)
        if n_play < MIN_GAMEPLAY_FRAMES:
            low_coverage[gid] = n_play
        if paths:
            E = emb([{"image": data_uri(p.read_bytes(), "image/png")} for p in paths]) * (weights[:, None] + 1e-6)
            halves = (unit(E[0::2].sum(0)), unit(E[1::2].sum(0))) if len(paths) >= 4 else (None, None)
            put("visual_style", gid, unit(E.sum(0)), *halves)
    provenance["visual_style"] = (f"capture_frame: P(gameplay)-weighted mean of <= {MAX_FRAMES} keyframes "
                                  f"with d1 P(gameplay) >= {GAMEPLAY_P}")

    for gid in ids:
        clips = loud_clips(gid)
        if clips:
            E = emb([{"audio": data_uri(c, "audio/wav")} for c in clips])
            halves = (unit(E[0::2].mean(0)), unit(E[1::2].mean(0))) if len(clips) >= 2 else (None, None)
            put("audio", gid, unit(E.mean(0)), *halves)
    provenance["audio"] = f"capture audio: mean of <= {MAX_CLIPS} loudest {CLIP_S}s clips"

    feats = {gid: telemetry_features(gid) for gid in ids}
    names = sorted(next(iter(feats.values())))
    X = np.array([[feats[g][n] for n in names] for g in ids])
    X = (X - X.mean(0)) / (X.std(0) + 1e-9)
    for g, x in zip(ids, X):
        put("rendering_measured", g, x)
    provenance["rendering_measured"] = "capture_telemetry: standardized video/sound register features (deterministic)"

    def hist(frames, field, labels):
        h = np.array([sum(f.get(field) == lab for f in frames) for lab in labels], float)
        return np.sqrt(h / h.sum()) if h.sum() else None  # Hellinger embedding of the distribution

    for name, field, labels in [("projection_measured", "projection", PROJECTIONS),
                                ("frontend_measured", "screen_type", SCREEN_TYPES)]:
        for gid in ids:
            fr = [f for f in frames_for(gid) if "error" not in f]
            if name == "projection_measured":
                gate = CAP / gid / "gameplay_d1.jsonl"
                play = {(g["phase"], g["frame"]) for g in map(json.loads, gate.open())
                        if (g["p_gameplay"] or 0) >= GAMEPLAY_P} if gate.exists() else set()
                fr = [f for f in fr if (f["phase"], f["frame"]) in play] or fr
            if fr:
                full, a, b = hist(fr, field, labels), hist(fr[0::2], field, labels), hist(fr[1::2], field, labels)
                put(name, gid, full, *((a, b) if a is not None and b is not None else (None, None)))
        provenance[name] = f"vision-model {field} distribution over keyframes"

    emb.save()
    np.savez(OUT / "views.npz", **{f"{v}|{g}": vec for v, d in V.items() for g, vec in d.items()})
    (OUT / "views_meta.json").write_text(json.dumps({"provenance": provenance, "ids": ids,
                                                     "low_coverage": {"visual_style": low_coverage},
                                                     "telemetry_features": names, "embed_calls": emb.calls,
                                                     "wall_s": round(time.time() - t0, 1)}, indent=2))
    print(f"{len([v for v in V if '#' not in v])} views, {emb.calls} embedding calls, {time.time() - t0:.1f}s")


# ---------------------------------------------------------------- analysis

def analyze():
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import squareform
    from scipy.stats import spearmanr
    from sklearn.metrics import adjusted_rand_score, silhouette_score

    meta = json.loads((OUT / "views_meta.json").read_text())
    raw = np.load(OUT / "views.npz")
    allv: dict[str, dict[str, np.ndarray]] = {}
    for k in raw.files:
        v, g = k.split("|")
        allv.setdefault(v, {})[g] = raw[k]
    views = {v: d for v, d in allv.items() if "#" not in v and not v.startswith("onto:")}
    onto = {v: d for v, d in allv.items() if v.startswith("onto:")}
    ids = [g for g in meta["ids"] if all(g in d for d in views.values())]
    n = len(ids)

    def coords(vecs, gids, name):
        """Per-view coordinates in which Euclidean distance is meaningful.

        Embedding views share a large common component (pairwise cosine 0.8-0.9 within one domain), so we
        subtract the view mean and re-normalize before comparing. Telemetry is already standardized."""
        X = np.stack([vecs[g] for g in gids]).astype(float)
        if name.startswith("rendering_measured"):
            return X
        X = X - X.mean(0)
        return X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)

    def distances(vecs, gids, name):
        X = coords(vecs, gids, name)
        Dm = np.linalg.norm(X[:, None] - X[None], axis=-1)
        return Dm / Dm.max()

    Xv = {v: coords(views[v], ids, v) for v in sorted(views)}
    D = {v: distances(views[v], ids, v) for v in sorted(views)}
    iu = np.triu_indices(n, 1)
    result = {"ids": ids, "provenance": meta["provenance"], "views": {}}

    # Split-half reliability per view, Spearman-Brown corrected to the full view.
    reliability = {}
    for v in D:
        a, b = allv.get(v + "#a", {}), allv.get(v + "#b", {})
        if all(g in a and g in b for g in ids):
            r = spearmanr(distances(a, ids, v)[iu], distances(b, ids, v)[iu])[0]
            reliability[v] = round(float(max(r, 0) * 2 / (1 + max(r, 0))), 3)
        else:
            reliability[v] = 1.0 if v == "rendering_measured" else None  # telemetry is deterministic
    result["reliability"] = reliability

    # Grounding: does the LLM-profile view agree with the decomposition-derived view on decomposed games?
    grounding = {}
    for ov, vecs in onto.items():
        tv = "text:" + ov.split(":", 1)[1]
        gids = [g for g in ids if g in vecs]
        if tv in views and len(gids) >= 5:
            ju = np.triu_indices(len(gids), 1)
            rho = spearmanr(distances(vecs, gids, ov)[ju], distances(views[tv], gids, tv)[ju])[0]
            grounding[tv] = {"games": len(gids), "rho": round(float(rho), 3)}
    result["grounding"] = grounding

    def choose_k(Z, Dv):
        # Ward clusters; best silhouette among cuts whose clusters all have >= 2 games (no singleton "clusters").
        scored = []
        for k in range(3, 9):
            lab = fcluster(Z, k, "maxclust")
            if len(set(lab)) > 1 and np.bincount(lab)[1:].min() >= 2:
                scored.append((silhouette_score(Dv, lab, metric="precomputed"), k))
        return max(scored)[1] if scored else 3

    for v, Dv in D.items():
        np.fill_diagonal(Dv, 0)
        Z = linkage(Xv[v], "ward")
        best = choose_k(Z, Dv)
        labels = fcluster(Z, best, "maxclust")
        # classical MDS to 2D
        J = np.eye(n) - 1 / n
        B = -0.5 * J @ (Dv ** 2) @ J
        w, U = np.linalg.eigh(B)
        xy = U[:, -2:][:, ::-1] * np.sqrt(np.maximum(w[-2:][::-1], 0))
        nn = {ids[i]: [ids[j] for j in np.argsort(Dv[i])[1:4]] for i in range(n)}
        result["views"][v] = {
            "k": best, "silhouette": round(float(silhouette_score(Dv, labels, metric="precomputed")), 3),
            "clusters": {ids[i]: int(labels[i]) for i in range(n)},
            "xy": {ids[i]: [round(float(a), 4) for a in xy[i]] for i in range(n)},
            "neighbors": nn,
            "mean_distance": round(float(Dv[iu].mean()), 4),
        }

    names = list(D)
    low = meta.get("low_coverage", {})
    low["projection_measured"] = low.get("visual_style", {})  # same gameplay-frame shortage applies
    valid = {v: np.array([g not in low.get(v, {}) for g in ids]) for v in names}

    def view_corr(a, b):
        ok = valid[a] & valid[b]
        m = ok[iu[0]] & ok[iu[1]]
        return spearmanr(D[a][iu][m], D[b][iu][m])[0]

    C_raw = np.array([[view_corr(a, b) for b in names] for a in names])
    # Correct for measurement noise (disattenuation): rho_true = rho_obs / sqrt(rel_a * rel_b).
    rel = np.array([reliability[v] if reliability[v] else 1.0 for v in names])
    C = np.clip(C_raw / np.sqrt(np.outer(np.maximum(rel, 0.05), np.maximum(rel, 0.05))), -1, 1)
    np.fill_diagonal(C, 1)
    result["low_coverage"] = low
    ARI = np.array([[adjusted_rand_score(list(result["views"][a]["clusters"].values()),
                                         list(result["views"][b]["clusters"].values())) for b in names] for a in names])
    ev_raw = np.clip(np.linalg.eigvalsh(C_raw), 0, None)
    participation_raw = float(ev_raw.sum() ** 2 / (ev_raw ** 2).sum())
    ev = np.clip(np.linalg.eigvalsh(C), 0, None)
    participation = float(ev.sum() ** 2 / (ev ** 2).sum())
    Zv = linkage(squareform(1 - C, checks=False), "average")
    axis_groups = {}
    for name, lab in zip(names, fcluster(Zv, 0.6, "distance")):  # views with mean rank-corr > 0.4 merge
        axis_groups.setdefault(int(lab), []).append(name)
    result["cross_view"] = {"views": names, "spearman": np.round(C, 3).tolist(), "ari": np.round(ARI, 3).tolist(),
                            "spearman_raw": np.round(C_raw, 3).tolist(),
                            "effective_axes_participation_ratio": round(participation, 2),
                            "effective_axes_raw": round(participation_raw, 2),
                            "axis_groups": list(axis_groups.values())}

    # Mashup seeds: pairs close on some axis groups and far on others (z-scored per view).
    Zs = {}
    for v in names:
        z = (D[v] - D[v][iu].mean()) / (D[v][iu].std() + 1e-9)
        z[~valid[v], :] = np.nan  # low-coverage games don't vote on this view
        z[:, ~valid[v]] = np.nan
        Zs[v] = z
    groups = list(axis_groups.values())
    def group_z(grp):  # reliability-weighted mean of member views' z, ignoring views a game can't vote on
        Zg = np.stack([Zs[v] for v in grp])
        w = np.array([reliability[v] or 0.5 for v in grp])[:, None, None] * ~np.isnan(Zg)
        with np.errstate(all="ignore"):
            return np.nansum(Zg * w, axis=0) / w.sum(0)
    G = np.stack([group_z(grp) for grp in groups])  # (groups, n, n)
    seeds = []
    for i, j in zip(*iu):
        z = G[:, i, j]
        zs = np.sort(z[~np.isnan(z)])
        if len(zs) < 4:
            continue
        # Complementarity: close on >= 2 axis groups AND far on >= 2. Near-duplicates (same engine/series)
        # are close nearly everywhere and score low; unrelated games are far nearly everywhere and score low.
        score = min(-zs[0], -zs[1], zs[-1], zs[-2])
        seeds.append({"a": ids[i], "b": ids[j], "score": round(float(score), 3),
                      "spread": round(float(zs[-1] - zs[0]), 3),
                      "closest_axis": groups[int(np.nanargmin(z))], "farthest_axis": groups[int(np.nanargmax(z))],
                      "z_by_axis": [None if np.isnan(x) else round(float(x), 2) for x in z]})
    seeds.sort(key=lambda s: -s["score"])
    result["axis_groups"] = groups
    result["mashup_seeds"] = seeds[:40]
    (OUT / "game_space.json").write_text(json.dumps(result, indent=1))

    print(f"{n} games, {len(names)} views; effective axes {participation_raw:.2f} raw -> {participation:.2f} noise-corrected")
    print("  reliability:", ", ".join(f"{v}={r}" for v, r in reliability.items()))
    print("  grounding (LLM profile vs decomposition):", ", ".join(f"{v}={g['rho']} (n={g['games']})" for v, g in grounding.items()))
    for grp in groups:
        print("  axis group:", ", ".join(grp))
    for v in names:
        r = result["views"][v]
        print(f"  {v:28} k={r['k']} silhouette={r['silhouette']}")
    for s in seeds[:12]:
        close = [groups[k][0] for k in np.argsort([x if x is not None else np.inf for x in s["z_by_axis"]])[:2]]
        far = [groups[k][0] for k in np.argsort([-x if x is not None else np.inf for x in s["z_by_axis"]])[:2]]
        print(f"  seed {s['score']:.2f} {s['a']} x {s['b']}: close on {close}, far on {far}")


if __name__ == "__main__":
    {"embed": embed, "analyze": analyze}[sys.argv[1]]()
