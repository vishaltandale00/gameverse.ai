#!/usr/bin/env python3
"""Trace binary-derived input dependencies, retaining candidates not inferred genres.

This is structural evidence discovery, not automatic gameplay identification.
Hardware-register directions, pseudo-C ABIs and semantic labels remain unverified.
The immutable export and exact C hashes are retained for subsequent review.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
RAM = re.compile(r"\b(?:[A-Za-z]+Ram)(0[23][0-9a-f]{6})\b")
FUNCTION = re.compile(r"FUN_([0-9a-f]{8})\s*\(")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def ram_ids(text):
    return {"0x" + m for m in RAM.findall(text)}


def call_ids(text):
    # Function signature is not a self-edge.
    return {"0x" + m for m in FUNCTION.findall(text[text.find("{"):])}


def mine(export, game, result, campaign):
    start = time.monotonic()
    records, malformed = [], 0
    for line in export.open():
        try:
            records.append(json.loads(line))
        except ValueError:
            malformed += 1  # A process cap can interrupt its partial journal.
    by_entry = {r["entry"]: r for r in records}
    roots = [r for r in records if "REG_KEYINPUT" in (r.get("c") or "")]
    input_ram = set()
    root_facts = []
    for r in roots:
        c = r.get("c") or ""
        assigned = set()
        for line in c.splitlines():
            if "=" in line and "==" not in line.split("=", 1)[0]:
                assigned |= ram_ids(line.split("=", 1)[0])
        input_ram |= assigned
        root_facts.append({"entry": r["entry"], "ram_assignment_candidates": sorted(assigned),
                           "c_sha256": hashlib.sha256(c.encode()).hexdigest(),
                           "direction_status": "C contains a KEYINPUT expression; instruction verification required"})
    # Getter wrappers are a common hardware→input-context seam. Restrict this
    # expansion to a short body returning a directly rooted native RAM location.
    getters = {r["entry"] for r in records if len(r.get("c") or "") < 600
               and "return " in (r.get("c") or "") and ram_ids(r.get("c") or "") & input_ram}
    candidates = []
    for r in records:
        c = r.get("c") or ""
        if r in roots or r["entry"] in getters:
            continue
        direct = sorted(ram_ids(c) & input_ram)
        getter_calls = sorted(call_ids(c) & getters)
        if not direct and not getter_calls:
            continue
        # Prioritize native state-changing branches, not RNG/memcpy/title recall.
        branches = c.count("if (") + c.count("case ")
        assignments = c.count(" = ")
        score = min(branches, 30) + min(assignments, 20) + 5 * bool(getter_calls)
        candidates.append((score, r, direct, getter_calls))
    candidates.sort(key=lambda row: (-row[0], row[1]["entry"]))
    out = ROOT / "research/corpus-mining" / campaign / "frontiers" / game
    out.mkdir(parents=True, exist_ok=True)
    leads = []
    for _, r, direct, getter_calls in candidates[:8]:
        c = r.get("c") or ""
        path = out / (r["entry"] + ".c")
        path.write_text(c)
        leads.append({"entry": r["entry"], "reported_mode": r.get("mode"),
                      "reported_body_bytes": r.get("size"), "reported_end": r.get("end"),
                      "status": "binary_input_state_consumer_candidate",
                      "name_status": "address_only", "boundary_status": "candidate",
                      "semantic_status": "unverified_lift", "direct_input_ram": direct,
                      "input_getter_calls": getter_calls, "callee_entries": r.get("callees", []),
                      "function_pointer_entries": r.get("function_pointers", []),
                      "native_ram_refs": r.get("ram_refs", []),
                      "native_rom_data_refs": r.get("rom_data", []),
                      "io_ref": r.get("io_ref", []), "io_directions_verified": False,
                      "pseudo_c_ref": str(path.relative_to(ROOT)), "pseudo_c_sha256": sha(path),
                      "warning_count": c.count("WARNING"),
                      "unknown_registers": "unaff_" in c or "extraout_" in c,
                      "unknowns": ["Actual gameplay actor, screen and reachability",
                                   "Function boundaries, calling convention and indirect calls",
                                   "State ownership, units, simulation tick and invariants",
                                   "Instruction-level and isolated/dynamic behavioral confirmation"]})
    evidence = {"schema_version": 1, "game_id": game, "campaign_id": campaign,
                "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "rom_sha1": result.get("sha1"), "export_ref": str(export.relative_to(ROOT)),
                "export_sha256": sha(export), "export_status": result["status"],
                "records_read": len(records), "truncated_or_malformed_lines": malformed,
                "roots": root_facts, "input_ram_candidates": sorted(input_ram),
                "getter_entries": sorted(getters), "consumer_candidates_total": len(candidates),
                "leads": leads, "wall_s": round(time.monotonic() - start, 6), "queue_s": None,
                "method": "Binary-export KEYINPUT expression -> assignment-native RAM -> direct consumers/getter callers; no title/genre keyword classification or community source",
                "not_claimed": ["Verified native hardware access directions", "Recovered complete gameplay rules",
                                "Full function coverage or correct boundaries", "Complete story/strategy/asset extraction"]}
    save(out / "evidence.json", evidence)
    portrait = ROOT / "ontology/portraits" / (game + ".json")
    if portrait.exists():
        p = json.loads(portrait.read_text())
        p["coverage"].setdefault("research_progress", {}).update(
            input_dependency_frontier_ref=str((out / "evidence.json").relative_to(ROOT)),
            input_root_count=len(roots), input_consumer_candidate_count=len(candidates),
            input_lead_status="unverified_binary_lifts_awaiting_semantic_review")
        save(portrait, p)
    return {"game_id": game, "root_count": len(roots), "consumer_candidates": len(candidates),
            "retained_leads": len(leads), "wall_s": evidence["wall_s"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaign-id", required=True)
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--poll-seconds", type=int, default=15)
    args = ap.parse_args()
    directory = ROOT / "research/corpus-mining" / args.campaign_id
    manifest_path = directory / "campaign.json"
    status_path = directory / "frontiers/status.json"
    status = json.loads(status_path.read_text()) if status_path.exists() else {
        "campaign_id": args.campaign_id, "processed": [], "source_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), "queue_s": None,
        "script_sha256": sha(Path(__file__)), "outcome": "running"}
    done = {r["game_id"] for r in status["processed"]}
    while True:
        manifest = json.loads(manifest_path.read_text())
        for result in manifest["results"]:
            game = result["id"]
            if game in done:
                continue
            export = ROOT / "local/re/experiments" / args.campaign_id / game / game / "functions.jsonl"
            if not export.exists() and result.get("partial_journal"):
                export = Path(result["partial_journal"]["path"])
            if export.exists():
                row = mine(export, game, result, args.campaign_id)
            else:
                row = {"game_id": game, "status": "no_completed_export_or_retained_journal",
                       "outcome": result["status"], "wall_s": None}
            status["processed"].append(row)
            done.add(game)
            save(status_path, status)
            print(json.dumps(row), flush=True)
        if not args.watch or manifest["status"] != "running":
            status["outcome"] = "snapshot_completed" if manifest["status"] == "running" else "completed_with_semantic_gaps"
            status["aggregate_scan_wall_s"] = round(sum(r.get("wall_s") or 0 for r in status["processed"]), 6)
            save(status_path, status)
            break
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()
