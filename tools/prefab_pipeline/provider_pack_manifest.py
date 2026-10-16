"""Inventory two registered provider recipes without copying payloads or running builds.

This is a bounded file-closure inventory, not a provenance/license certificate or
qualification runner. Existing reference hashes are checked, never rewritten.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "research/deep-extraction/castlevania/"
RECIPES = {
    "aria-double-xp": {
        "request": "tools/prefab_pipeline/requests/aria-double-xp.json",
        "modules": ["tools/prefab_pipeline/mod_rom.py"],
        "hardcoded": [BASE + n for n in ("defeat-policy.c", "defeat-policy.h", "defeat-host.c",
            "defeat-differential.c", "defeat-gameplay.json", "qualify_defeat.py")],
        "build": "tools.prefab_pipeline.mod_rom.prepare_mod_request + tools.composition.native_build.build",
        "bounded_qc": "tools.prefab_pipeline.mod_rom.execute_mod_request (currently includes fresh builds and bounded QC)",
    },
    "aria-soulstride": {
        "request": "tools/prefab_pipeline/requests/aria-soulstride.json",
        "modules": ["tools/prefab_pipeline/native_mod.py", "tools/prefab_pipeline/momentum_strategy.py"],
        "hardcoded": [BASE + n for n in ("ability.package.json", "acquisition.package.json", "defeat.package.json",
            "cast-host.c", "cast-policy.c", "cast-policy.h", "bone-policy.c", "acquisition-qualification.json",
            "defeat-policy.c", "defeat-policy.h", "defeat-host.c", "enemy-reward-descriptors.json",
            "soul-inventory.c", "movement-contact/source-evidence.json", "soul-eligibility/source-evidence.json")],
        "build": "python3 -B -m tools.prefab_pipeline.native_cli build-mod --request tools/prefab_pipeline/requests/aria-soulstride.json --output-dir NEW --output RESULT",
        "bounded_qc": "No single portable bounded-QC command registered in this inventory; requires separately pinned experiment configuration and local emulator setup",
    },
}
SHA = re.compile(r"[0-9a-f]{64}\Z")
PREFIXES = ("tools/", "research/", "ontology/", "contracts/", "src/", "scripts/", "local/")
SUFFIXES = (".json", ".py", ".mjs", ".js", ".c", ".h", ".s", ".asm.txt", ".gba", ".md")


class Inventory:
    def __init__(self, root, max_files=1024, max_metadata_bytes=64 * 1024 * 1024):
        self.root = Path(root).resolve()
        self.max_files, self.max_metadata_bytes = max_files, max_metadata_bytes
        self.rows, self.contents, self.visited, self.queue = {}, {}, set(), deque()
        self.gaps, self.warnings, self.claims, self.static_reports = [], [], [], []
        self.metadata_bytes = 0

    def relative(self, value):
        if not isinstance(value, str) or "\n" in value:
            return None
        path = Path(value)
        try:
            return str((self.root / path).resolve().relative_to(self.root))
        except ValueError:
            # Do not retain an absolute host path in the exported manifest.
            return None

    def add(self, value, recipe, stage, origin, expected=None):
        relative = self.relative(value)
        if relative is None:
            self.gaps.append({"recipe": recipe, "code": "nonportable-reference", "origin": origin,
                              "detail": "reference outside repository omitted; user must supply it separately"})
            return
        path = self.root / relative
        if not path.is_file():
            self.gaps.append({"recipe": recipe, "code": "missing-file", "path": relative, "origin": origin})
            return
        if relative not in self.rows:
            if len(self.rows) >= self.max_files:
                raise ValueError("provider manifest file limit exceeded")
            size = path.stat().st_size
            raw_rom = path.suffix.lower() in (".gba", ".gb", ".nds")
            if not raw_rom and self.metadata_bytes + size > self.max_metadata_bytes:
                raise ValueError("provider manifest metadata byte limit exceeded")
            digest = hashlib.sha256()
            chunks = []
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    if not raw_rom:
                        chunks.append(chunk)
            content = b"".join(chunks)
            kind = "local-rom" if raw_rom else self.classify(relative, content)
            self.rows[relative] = {"path": relative, "sha256": digest.hexdigest(), "bytes": size,
                "kind": kind, "recipes": [], "stages": [], "origins": [],
                "payload_policy": "metadata-only-user-provided" if kind in ("local-rom", "external-evidence") else
                    "provider-only-pending-provenance-review" if kind == "reconstructed-code" else "authored-or-metadata-review-required"}
            if not raw_rom:
                self.contents[relative] = content
                self.metadata_bytes += size
        row = self.rows[relative]
        for field, item in (("recipes", recipe), ("stages", stage), ("origins", origin)):
            if item not in row[field]:
                row[field].append(item)
        if expected is not None:
            matched = isinstance(expected, str) and SHA.fullmatch(expected) and expected == row["sha256"]
            self.claims.append({"path": relative, "recipe": recipe, "origin": origin,
                                "claimed_sha256": expected, "actual_sha256": row["sha256"], "matches": bool(matched)})
            if not matched:
                self.gaps.append({"code": "stale-reference-pin", "recipe": recipe, "path": relative,
                                  "origin": origin, "claimed_sha256": expected, "actual_sha256": row["sha256"]})
        key = (relative, recipe, stage)
        if key not in self.visited:
            self.visited.add(key)
            self.queue.append(key)

    @staticmethod
    def classify(path, raw):
        if path.startswith("local/decomps/") or path.endswith((".s", ".asm.txt")):
            return "external-evidence"
        if path.endswith(".json"):
            # Some source-evidence certificates embed original assembly text.
            if b'"assembly":' in raw and (b"push {" in raw or b"\n\\t" in raw or b"\\tpush" in raw):
                return "external-evidence"
            return "recipe" if "/requests/" in path else "source-evidence"
        if path.startswith(BASE) and path.endswith((".c", ".h")):
            return "reconstructed-code"
        return "authored-code"

    def walk_json(self, value, recipe, stage, origin):
        if isinstance(value, dict):
            if origin.endswith("-qualification.json"):
                selected = value.get("source_pins", {})
                if recipe != "aria-double-xp":
                    selected = {k: v for k, v in selected.items() if k.endswith("/soul-inventory.c")}
                if selected:
                    self.walk_json({"source_pins": selected}, recipe, stage, origin + ":runtime-source-pins")
                return
            ref = value.get("path", value.get("ref"))
            if isinstance(ref, str) and isinstance(value.get("sha256"), str):
                self.add(ref, recipe, stage, origin, value["sha256"])
            for key, child in value.items():
                if key == "source_pins" and isinstance(child, dict):
                    for path, pin in child.items():
                        if path.endswith('.plan.json'):
                            # Runtime's retained historical-proof policy explicitly skips these claims.
                            self.warnings.append({"code": "historical-plan-claim-not-runtime-input", "recipe": recipe,
                                                  "origin": origin, "path": self.relative(path), "claimed_sha256": pin,
                                                  "detail": "Retained claim is not repinned or imported as current qualification; fresh runtime proof remains mandatory."})
                        else:
                            self.add(path, recipe, stage, origin, pin)
                elif key == "assembly" and isinstance(child, str) and child.startswith(PREFIXES):
                    # Movement source verifier reads these range files; embedded assembly text is not a path.
                    self.add(child, recipe, stage, origin, value.get("assembly_sha256"))
                elif isinstance(child, (dict, list)):
                    self.walk_json(child, recipe, stage, origin)
        elif isinstance(value, list):
            for child in value:
                self.walk_json(child, recipe, stage, origin)

    def imports(self, relative, recipe, stage):
        if relative == "tools/prefab_pipeline/__main__.py" or Path(relative).name.startswith("qualify_"):
            return  # Dispatcher contains unrelated registered backends; selected modules are explicit seeds.
        tree = ast.parse(self.contents[relative], filename=relative)
        package = Path(relative).parent.parts
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name.split(".") for alias in node.names if alias.name.startswith("tools.")]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    names = [list(package[:len(package) - node.level + 1]) + (node.module or "").split(".")]
                elif (node.module or "").startswith("tools."):
                    names = [node.module.split(".")]
            for name in names:
                path = "/".join(part for part in name if part) + ".py"
                if (self.root / path).is_file():
                    self.add(path, recipe, stage, relative + ":python-import")

    def drain(self):
        while self.queue:
            relative, recipe, stage = self.queue.popleft()
            raw = self.contents.get(relative)
            if raw is None:
                continue
            if relative.startswith("local/") or relative.endswith("/soma-cast/evidence.json"):
                continue  # Native compiler/lowerer hash these certificates, not their optional historical artifacts.
            if relative.endswith(".json"):
                try:
                    doc = json.loads(raw)
                except (ValueError, UnicodeError):
                    self.gaps.append({"code": "unreadable-json", "path": relative, "recipe": recipe})
                    continue
                self.walk_json(doc, recipe, stage, relative)
                if isinstance(doc, dict) and doc.get("kind") == "composition_plan":
                    from tools.composition.resolve import resolve
                    result = resolve(doc)
                    self.static_reports.append({"path": relative, "recipe": recipe, "resolver": "composition-static/0.1",
                                                "errors": result.get("errors", []), "qualification": "read-only static resolution only"})
            elif relative.endswith(".py"):
                self.imports(relative, recipe, stage)
            elif relative.endswith((".c", ".h")):
                for name in re.findall(rb'^\s*#include\s+"([^"\n]+)"', raw, re.MULTILINE):
                    text = name.decode()
                    candidate = str(Path(relative).parent / text)
                    if (self.root / candidate).is_file():
                        self.add(candidate, recipe, stage, relative + ":include")
                    elif text != "state-layout.h":
                        self.gaps.append({"code": "unresolved-c-include", "path": relative,
                                          "include": text, "recipe": recipe})


def generate_manifest(root=ROOT):
    inventory = Inventory(root)
    recipes = []
    for recipe, spec in RECIPES.items():
        seeds = [spec["request"], "tools/prefab_pipeline/__init__.py", "tools/prefab_pipeline/native_cli.py",
                 "tools/composition/native_build.py", "tools/composition/resolve.py", *spec["modules"]]
        for path in seeds:
            inventory.add(path, recipe, "build", "registered-recipe-entry")
        for path in spec["hardcoded"]:
            inventory.add(path, recipe, "build-and-evidence", "reviewed-hardcoded-lowerer-or-validator-input")
        for path in ("tools/re/session/bridge.py", "tools/re/session/session.c", "tools/re/session/Makefile"):
            inventory.add(path, recipe, "bounded-qc", "native-session-build-prerequisite")
        inventory.drain()
        row = inventory.rows[spec["request"]]
        recipes.append({"id": recipe, "request_path": spec["request"], "request_sha256": row["sha256"],
                        "build": spec["build"], "bounded_qc": spec["bounded_qc"]})
    recipe_ids = sorted(RECIPES)
    files = sorted(inventory.rows.values(), key=lambda row: row["path"])
    for row in files:
        for field in ("recipes", "stages", "origins"):
            row[field].sort()
    return {"schema": "gameverse.improvement-provider-pack/1", "source_commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=inventory.root, text=True).strip(),
        "working_tree": "shared dirty working tree; exact file hashes are authoritative",
        "status": "runtime-file-inventory-ready" if not inventory.gaps else "runtime-closure-blocked", "files": files, "recipes": recipes,
        "tools": [{"name": name, "requirement": requirement, "recipes": recipe_ids, "stage": stage}
                  for name, requirement, stage in (("python3", ">=3.10 (existing Path.is_relative_to usage)", "build"),
                    ("cc", "Clang with armv4t-none-eabi/arm7tdmi/Thumb support", "build"),
                    ("arm-none-eabi-ld", "GNU ARM linker compatible with generated native linker script", "build"),
                    ("arm-none-eabi-objcopy", "GNU ARM binary extraction", "build"),
                    ("arm-none-eabi-nm", "GNU ARM symbol inspection", "build"),
                    ("libmgba", "0.10.5-compatible headers/library and separately built tools/re/session/build/gba-session", "bounded-qc"),
                    ("ffmpeg", "video encoding when bounded QC records a clip", "bounded-qc"))],
        "closure": {"method": "recursive JSON pins/source_pins, selected Python imports, quoted C includes, explicit reviewed hardcoded lowerer inputs; shared composition.resolve reused",
                    "complete": not inventory.gaps, "gaps": inventory.gaps,
                    "provenance_warnings": inventory.warnings,
                    "unverified": ["No compiler/native/model run was performed", "Dynamic Python file accesses are not generally statically provable",
                        "Soulstride bounded QC needs an explicit portable experiment recipe", "Recovered C/header redistribution provenance requires review",
                        "External assembly and ROM are metadata-only user-supplied inputs; never provider payload",
                        "Generated state-layout.h and lowered packages/IR outputs are build outputs, not provider inputs"]},
        "reference_claim_checks": inventory.claims, "static_resolution": inventory.static_reports,
        "privacy": "File paths are normalized relative to repository root; external host paths are omitted. File contents are not copied by this generator.",
        "limits": {"max_files": inventory.max_files, "max_metadata_bytes": inventory.max_metadata_bytes},
        "measurement": {"build_s": None, "simulation_s": None, "model_calls": 0,
                        "note": "read/hash inventory only; each distinct file including ROM hashed once per generator invocation"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = generate_manifest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(args.output), "files": len(result["files"]),
                      "gaps": len(result["closure"]["gaps"]), "status": result["status"]}))


if __name__ == "__main__":
    main()
