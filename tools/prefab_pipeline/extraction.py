"""Bounded, read-only inventory extraction. No compilation, execution or promotion."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

from tools.prefab_pipeline.library_index import load_groups, registered_descriptors
from tools.prefab_pipeline.memory_index import load_memory, attach_memory, memory_candidates, resolve_memory_indexes

DEFAULT_LIMITS = {"max_files": 512, "max_bytes": 32 * 1024 * 1024, "max_requests": 16}
TAXONOMY = ("identity", "source_closure", "state_ownership", "scheduling", "lifecycle", "assets", "maps", "audio", "progression_save", "variant_domain", "native_checkpoint", "backend")


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _items(value):
    """Preserve a scalar/record as one item rather than iterating its characters/keys."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, (str, dict)):
        return [value]
    raise ValueError("Unsupported inventory field type: " + type(value).__name__)


def _gap_texts(value):
    """Keep structured missing-capability flags visible without interpreting truth."""
    if isinstance(value, dict):
        return [str(key) + ": " + _json(item) for key, item in sorted(value.items())]
    return [item if isinstance(item, str) else _json(item) for item in _items(value)]


class ExtractionLimitError(ValueError):
    pass


class Reader:
    def __init__(self, root, limits):
        self.root = root.resolve()
        self.limits = limits
        self.pins = {}
        self.data = {}
        self.bytes = 0
        self.gaps = []

    def read(self, ref, base="", optional=False):
        if not isinstance(ref, str) or not ref:
            return None, None
        p = PurePosixPath(ref)
        if p.is_absolute() or ".." in p.parts or ":" in ref or "\\" in ref:
            self.gaps.append("Refused unsafe reference: " + ref)
            return None, None
        key = str(PurePosixPath(base) / p)
        target = self.root / key
        if not target.resolve().is_relative_to(self.root):
            self.gaps.append("Refused external reference: " + key)
            return None, None
        if key in self.pins:
            return self.data.get(key), key
        if len(self.pins) >= self.limits["max_files"]:
            raise ExtractionLimitError("max_files exceeded")
        if not target.is_file():
            self.pins[key] = None
            if not optional:
                self.gaps.append("Missing file: " + key)
            return None, key
        size = target.stat().st_size
        if self.bytes + size > self.limits["max_bytes"]:
            raise ExtractionLimitError("max_bytes exceeded: " + key)
        raw = target.read_bytes()
        if self.bytes + len(raw) > self.limits["max_bytes"]:
            raise ExtractionLimitError("max_bytes exceeded: " + key)
        self.bytes += len(raw)
        self.pins[key] = _hash(raw)
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            data = None
        self.data[key] = data
        return data, key

    def refs(self, value):
        """Pin explicit repository file references, preserving absent dependencies."""
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ("path", "ref", "sourceContractRef", "assemblyRef", "validationRef", "descriptorRef", "machine_evidence_ref") and isinstance(item, str):
                    self.read(item)
                else:
                    self.refs(item)
        elif isinstance(value, list):
            for item in value:
                self.refs(item)
        elif isinstance(value, str) and re.search(r"\.(?:jsonl?|[ch]|hpp|cpp|md|png|pal|bin|wav|ogg|map|tmx|yaml|yml)$", value) and "/" in value:
            self.read(value)


def _package(reader, package_id, entries):
    gaps = []
    entry = entries.get(package_id, {})
    record, record_path = reader.read(entry.get("record", package_id + ".json"), "ontology/executable-components")
    record = record or {}
    package, package_path = reader.read(record.get("package_ref"))
    package = package or {}
    behavior, behavior_path = reader.read(package.get("behavior"), str(PurePosixPath(package_path).parent) if package_path else "")
    qualification = package.get("qualification", {})
    receipt, receipt_path = reader.read(qualification.get("receipt"), str(PurePosixPath(package_path).parent) if package_path else "")
    actual = reader.pins.get(behavior_path)
    qualified = bool(package and behavior and receipt and actual and actual == package.get("behavior_sha256") == record.get("behavior_sha256") == entry.get("behavior_sha256") and entry.get("qualified", True) is True and qualification.get("status") == "pass" and receipt.get("outcome", receipt.get("status")) == "pass")
    if record.get("package_sha256") and reader.pins.get(package_path) != record["package_sha256"]:
        qualified = False
        gaps.append("Catalog package hash mismatch: " + package_id)
    receipt_pin = record.get("qualification", {}).get("receipt_sha256")
    if receipt_pin and reader.pins.get(receipt_path) != receipt_pin:
        qualified = False
        gaps.append("Qualification receipt hash mismatch: " + package_id)
    if not qualified:
        gaps.append("L1 qualification unavailable or mismatched: " + package_id)
    for obj in (record, package, behavior or {}):
        reader.refs(obj)
    effects = package.get("effects", {})
    contract = package.get("source_contract", record.get("source_contract", {}))
    if isinstance(contract, str):
        definition, contract_path = reader.read(contract)
        contract = {"reference": contract_path, "definition": definition,
                    "annotation_scope": "reference-only source contract; no inline field mapping or domain inferred"}
        gaps.append("Source contract is reference-only; inline field mapping and domain annotations unavailable: " + str(contract_path))
    elif not isinstance(contract, dict):
        raise ValueError("Unsupported source_contract type for " + package_id)
    return {"id": package_id, "manifest_ref": package_path, "manifest": package, "behavior_ref": behavior_path, "behavior_sha256": actual, "receipt_ref": receipt_path, "L1_qualified": qualified, "interface": {"reads": effects.get("reads", []), "writes": effects.get("writes", []), "collection_reads": effects.get("collection_reads", []), "collection_writes": effects.get("collection_writes", []), "field_mapping": contract.get("fieldMapping", []), "domains": contract.get("domains", {}), "state": (behavior or {}).get("state", []), "parameters": (behavior or {}).get("parameters", []), "return_type": (behavior or {}).get("return_type"), "return_meaning": package.get("return_meaning"), "collections": (behavior or {}).get("collections", []), "readonly_assets": (behavior or {}).get("assets", []), "lifecycle": package.get("lifecycle", {}), "source_contract": contract, "preconditions": (behavior or {}).get("preconditions", [])}, "gaps": gaps + package.get("gaps", []) + record.get("limitations", [])}


def _routing(gaps):
    text = " ".join(gaps).lower()
    rules = {"identity": ("identity", "unknown"), "source_closure": ("source", "missing", "unclosed"), "state_ownership": ("state", "alias", "owner", "backing"), "scheduling": ("schedule", "tick", "ordering", "invocation"), "lifecycle": ("lifecycle", "entry", "exit", "resume"), "assets": ("asset", "render", "palette", "image"), "maps": ("map", "room", "terrain"), "audio": ("audio", "sound"), "progression_save": ("progress", "save", "persistent"), "variant_domain": ("variant", "domain", "configuration", "default"), "native_checkpoint": ("native", "checkpoint", "parity"), "backend": ("backend", "unsupported", "compiler")}
    return [key for key in TAXONOMY if any(word in text for word in rules[key])]


def _game(root, game_id, limits, source_receipts=None, memory_manifests=None, memory_indexes=None):
    reader = Reader(root, limits)
    manifest, _ = reader.read("ontology/game-system-prefabs/manifest.json")
    catalog, _ = reader.read("ontology/executable-components/index.json")
    entries = {e["id"]: e for e in (catalog or {}).get("entries", [])}
    selected = [r for r in (manifest or {}).get("prefabs", []) if r.get("gameId") == game_id]
    registered, registry_gaps = registered_descriptors(reader, game_id)
    reader.gaps.extend(registry_gaps)
    descriptors = sorted({*registered, *(r.get("descriptorRef") for r in selected if r.get("descriptorRef"))})
    groups = {}
    loops = []
    for ref in descriptors:
        descriptor, _ = reader.read(ref)
        if not descriptor:
            continue
        if descriptor.get("gameId") != game_id:
            reader.gaps.append("Descriptor game identity mismatch: " + ref)
            continue
        reader.refs(descriptor)
        loop = descriptor.get("coreLoop", {})
        loops.append(loop)
        for index, bundle in enumerate(descriptor.get("bundles", [])):
            module = bundle.get("moduleId")
            if not module:
                module = "unowned:" + _hash((ref + str(index)).encode())[:16]
            group = groups.setdefault(module, {"bundles": [], "descriptor_refs": [], "phases": [], "source_edges": []})
            group["bundles"].append(bundle)
            group["descriptor_refs"].append(ref)
            ids = {x.get("id") for x in selected if x.get("moduleId") == module}
            recovered = bundle.get("recoveredAssembly", {})
            if recovered.get("id"):
                ids.add(recovered["id"])
            phases = [p for p in loop.get("phases", []) if ids.intersection(p.get("prefabIds", [])) or set(bundle.get("phaseIds", [])).intersection([p.get("id")])]
            group["phases"].extend(phases)
            phase_ids = {p.get("id") for p in phases}
            group["source_edges"].extend(e for e in loop.get("edges", []) if e.get("from") in phase_ids or e.get("to") in phase_ids)
    library_groups, library_gaps = load_groups(reader, game_id)
    reader.gaps.extend(library_gaps)
    for library in library_groups:
        record = library["record"]
        group = groups.setdefault(record["module_id"], {"bundles": [], "descriptor_refs": [], "phases": [], "source_edges": []})
        group.setdefault("library_records", []).append(library)
        group["bundles"].append({"id": record["id"], "moduleId": record["module_id"],
            "packageIds": record["package_ids"], "gaps": _gap_texts(record.get("gaps")) + library["gaps"],
            "canonicalState": record.get("canonicalstate", {}),
            "evidence": [library["ref"], *library["evidence_refs"]]})
    covered = {p for group in groups.values() for bundle in group["bundles"] for p in bundle.get("packageIds", [])}
    for package_id, entry in sorted(entries.items()):
        if entry.get("source_game") != game_id or package_id in covered:
            continue
        # A catalog component is discoverable before any ready prefab exists.
        module = package_id
        group = groups.setdefault(module, {"bundles": [], "descriptor_refs": [], "phases": [], "source_edges": []})
        group["catalog_fallback"] = True
        group["bundles"].append({"id": package_id, "moduleId": module, "packageIds": [package_id],
            "gaps": ["Catalog component has no admitted source lifecycle assembly; analyze or reassemble with explicit dependencies."]})
    candidates = []
    for module, group in sorted(groups.items()):
        bundles = group["bundles"]
        package_ids = sorted({p for b in bundles for p in b.get("packageIds", [])})
        packages = [_package(reader, p, entries) for p in package_ids]
        for package in packages:
            if entries.get(package["id"], {}).get("source_game", game_id) != game_id:
                package["L1_qualified"] = False
                package["gaps"].append("Package source game differs from capability group: " + package["id"])
        bindings = []
        for row in selected:
            if row.get("moduleId") != module:
                continue
            assembly, ap = reader.read(row.get("path"))
            validation, vp = reader.read(row.get("validation"))
            reader.refs(assembly or {})
            reader.refs(validation or {})
            valid = bool(assembly and validation and row.get("sha256") == reader.pins.get(ap) and row.get("validationSha256") == reader.pins.get(vp) and validation.get("valid") is True)
            actual_packages = {p["id"]: p for p in packages}
            for component_id, component in (assembly or {}).get("components", {}).items():
                package = actual_packages.get(component.get("package_id"), {})
                interface = (validation or {}).get("interfaces", {}).get(component_id, {})
                actual_behavior = package.get("behavior_sha256")
                if not actual_behavior or component.get("behavior_sha256") != actual_behavior or interface.get("behavior_sha256") != actual_behavior:
                    valid = False
                package_ref = package.get("manifest_ref")
                if interface.get("package_sha256") != reader.pins.get(package_ref):
                    valid = False
            bindings.append({"id": row.get("id"), "assembly_ref": ap, "validation_ref": vp, "L2_binding_valid": valid, "assembly": assembly, "validation": validation})
        gaps = [str(g) for b in bundles for g in b.get("gaps", [])] + [str(g) for p in packages for g in p["gaps"]]
        services = [s for p in group["phases"] for s in p.get("requiredServices", [])]
        gaps.extend(str(g) for p in group["phases"] for g in p.get("gaps", []))
        gaps.extend("Unknown dependency closure: " + kind for kind in ("assets", "maps", "audio", "checkpoints") if not any(kind in b for b in bundles))
        l1 = bool(packages) and all(p["L1_qualified"] for p in packages)
        bound_packages = {component.get("package_id") for b in bindings for component in (b.get("assembly") or {}).get("components", {}).values()}
        l2 = l1 and bool(bindings) and all(b["L2_binding_valid"] for b in bindings) and set(package_ids) <= bound_packages
        level = "L2" if l2 else "L1" if l1 else "L0"
        state = []
        for package in packages:
            for field in package["interface"]["state"]:
                state.append({"name": package["id"] + ":" + field["name"], "type": field.get("storage_type", "unknown"), "owner": field.get("owner", "unknown"), "lifetime": "unknown"})
        candidates.append({"schema_version": 1, "prefab_id": module, "level": level, "backend": "portable-ir" if packages else "source-engine-import", "source": {"kind": "descriptor-inventory", "engine": None, "abi": None, "commit": None, "sha256": None, "refs": []}, "provides": [], "requires": [{"id": str(i), "type": "service", "semantic": str(s)} for i, s in enumerate(services)], "state": state, "lifecycle": {"entry": None, "exit": None, "tick": None, "save": None}, "dependencies": [{"id": p["id"], "ref": p["manifest_ref"], "resolved": bool(p["manifest"])} for p in packages], "assets": [], "resources": [], "domain": {p["id"]: p["interface"]["domains"] for p in packages}, "schedule": {}, "progression": {}, "closure": {"status": "open", "missing": sorted(set(gaps))}, "evidence": [e for b in bundles for e in b.get("evidence", [])], "gaps": sorted(set(gaps)), "id": module, "game_id": game_id, "module_id": module, "package_ids": package_ids, "packages": packages, "phases": group["phases"], "source_edges": group["source_edges"], "canonical_state": [b.get("canonicalState", {}) for b in bundles], "descriptor_refs": sorted(set(group["descriptor_refs"])), "bundles": bundles, "required_services": services, "bindings": bindings, "maturity": {"source_only": not l1 and not l2, "L1_qualified": l1, "L2_binding_valid": l2, "full_rom": False, "whole_game": False}})
        capsule = candidates[-1]
        libraries = group.get("library_records", [])
        capsule["discovery"] = {"descriptor_refs": group["descriptor_refs"],
            "catalog_fallback": group.get("catalog_fallback", False),
            "library_records": [item["ref"] for item in libraries]}
        capsule["library_capabilities"] = libraries
        capsule["source"]["kind"] = "catalog-and-library-inventory" if libraries or group.get("catalog_fallback") else "descriptor-inventory"
        capsule["source"]["refs"] += [item["ref"] for item in libraries]
        capsule["source"]["refs"] += [{"path": p["manifest_ref"], "sha256": reader.pins[p["manifest_ref"]]} for p in packages if p["manifest_ref"] and reader.pins.get(p["manifest_ref"])]
        capsule["provides"] = [{"id": p["id"], "type": "automatic-ir-component" if p["manifest"].get("origin") == "automatic_highfunction_lift" else "source-component",
            "semantic": p["manifest"].get("mechanics_role", "unknown"),
            "finite_native_qualified": p["L1_qualified"], "interface": p["interface"]} for p in packages]
        capsule["runtime_capability_declarations"] = [{"group_id": item["record"]["id"],
            "evidence_pins_valid": item["integrity_valid"],
            "claims": item["record"].get("runtime_capabilities", {}),
            "native_eligibility": item["record"].get("native_eligibility", {}),
            "scope": "Retained group declarations; no automatic execution or readiness promotion"} for item in libraries]
        capsule["host_prerequisites"] = [p for item in libraries for p in _items(item["record"].get("originalhostprerequisites"))]
        capsule["source_roots"] = sorted({str(r) for item in libraries for r in _items(item["record"].get("source_roots"))})
        capsule["event_order"] = [event for item in libraries for event in _items(item["record"].get("event_order"))]
        capsule["dependency_links"] = [dep for item in libraries for dep in _items(item["record"].get("dependency_links", item["record"].get("dependencylinks")))]
        capsule["schedule"]["source_event_order"] = capsule["event_order"]
        capsule["gaps"] = sorted(set(capsule["gaps"] + ["Unresolved host prerequisite: " + str(p) for p in capsule["host_prerequisites"]]))
    if not selected and not candidates:
        reader.gaps.append("No descriptor, capability group or catalog component for game: " + game_id)
    for ref in sorted({str(p) for p in (source_receipts or [])}):
        receipt, receipt_path = reader.read(ref)
        if not receipt:
            continue
        aliases = {"firered": "pokemon-firered-version", "emerald": "pokemon-emerald-version"}
        if receipt.get("schema") != "whole-source-build/1":
            reader.gaps.append("Unsupported source receipt schema: " + ref)
            continue
        if aliases.get(receipt.get("game"), receipt.get("game")) != game_id:
            continue
        gaps = ["Source build receipt is retained evidence; source tree and artifact content are unverified inventory dependencies.", "No native lifecycle closure, merged ROM or whole-game qualification follows from source build success."]
        if receipt.get("baselineMatches") is not True:
            gaps.append("Source build does not match original baseline.")
        if receipt.get("sourceBridgeSha256"):
            gaps.append("Transitional paired-runtime source bridge is present; no single-ROM merge evidence.")
        dependencies = []
        for kind, artifact in sorted(receipt.get("artifacts", {}).items()):
            relative = artifact.get("relativePath")
            safe = isinstance(relative, str) and not PurePosixPath(relative).is_absolute() and ".." not in PurePosixPath(relative).parts and ":" not in relative and "\\" not in relative
            artifact_ref = str(PurePosixPath(receipt_path).parent / relative) if safe else None
            dependencies.append({"id": kind, "ref": artifact_ref, "sha256": artifact.get("sha256"), "resolved": False, "verification": "unverified_receipt_claim"})
            gaps.append("Unverified source-build artifact: " + kind)
        source_game = receipt.get("game")
        source_path = {"emerald": "local/decomps/pokeemerald", "firered": "local/decomps/pokefirered"}.get(source_game)
        candidate_id = game_id + ".source-engine-import." + str(receipt.get("runId", _hash(ref.encode())[:12]))
        candidates.append({"schema_version": 1, "prefab_id": candidate_id, "id": candidate_id, "game_id": game_id, "module_id": candidate_id, "level": "L0", "backend": "source-engine-import", "source": {"kind": "decomp-source" if source_path else "whole-source-build-receipt", "engine": source_game if source_path else None, "abi": "gba-arm7tdmi" if source_path else None, "role": "base" if source_game == "emerald" else "donor" if source_game == "firered" else None, "path": str(Path(root).resolve() / source_path) if source_path else None, "scope": "complete-tree" if source_path else None, "verification": "receipt_claim_requires_source_tree_verification", "commit": receipt.get("sourceCommit"), "sha256": receipt.get("sourceSnapshotSha256"), "tree_hash": receipt.get("sourceTreeHash"), "refs": [{"path": receipt_path, "sha256": reader.pins[receipt_path]}]}, "provides": [], "requires": [], "state": [], "lifecycle": {"entry": None, "exit": None, "tick": None, "save": None}, "dependencies": dependencies, "assets": [], "resources": [], "domain": {}, "schedule": {}, "progression": {}, "closure": {"status": "open", "missing": gaps}, "gaps": gaps, "evidence": [{"kind": "source-build", "status": receipt.get("status"), "ref": {"path": receipt_path, "sha256": reader.pins[receipt_path]}}], "receipt": receipt, "descriptor_refs": [], "package_ids": [], "maturity": {"source_only": True, "L1_qualified": False, "L2_binding_valid": False, "full_rom": False, "whole_game": False}})
    indexed_manifests = resolve_memory_indexes(reader, memory_indexes)
    memory_graphs, memory_gaps = load_memory(reader, game_id, [*(memory_manifests or []), *indexed_manifests])
    reader.gaps.extend(memory_gaps)
    candidates.extend(memory_candidates(memory_graphs, candidates, game_id))
    for candidate in candidates:
        attach_memory(candidate, memory_graphs)
    pins = [{"path": p, "sha256": h} for p, h in sorted(reader.pins.items())]
    for candidate in candidates:
        candidate["source"]["refs"] += [p for p in pins if p["path"] in candidate["descriptor_refs"] and p["sha256"]]
        if candidate["backend"] != "source-engine-import" or not candidate["source"].get("sha256"):
            candidate["source"]["sha256"] = _hash(_json(candidate["source"]["refs"]).encode())
        candidate["gaps"] = sorted(set(candidate["gaps"] + reader.gaps))
        candidate["closure"]["missing"] = candidate["gaps"]
    requests = [{"candidate_id": c["id"], "routing_hints": _routing(c["gaps"]), "input_pins": pins, "gaps": c["gaps"], "required_outputs": ["ref-backed ownership and source closure evidence", "explicit unsupported dependencies and remaining gaps"], "prohibited_promotion": ["L1/L2 qualification from prose", "native parity", "whole-game readiness"], "execution_allowed": False} for c in candidates if c["gaps"]][:limits["max_requests"]]
    return {"game_id": game_id, "candidates": candidates, "memory_graphs": memory_graphs, "core_loops": loops, "input_pins": pins, "gaps": sorted(set(reader.gaps)), "semantic_requests": requests, "usage": {"files": len(pins), "bytes": reader.bytes}, "whole_game": False, "full_rom": False}


def extract(root: Path, game_ids: list[str], cache_dir: Path, limits: dict | None = None, source_receipts: list[str] | None = None, memory_manifests: list[str] | None = None, memory_indexes: list[str] | None = None) -> dict:
    root = Path(root).resolve()
    limits = {**DEFAULT_LIMITS, **(limits or {})}
    if set(limits) != set(DEFAULT_LIMITS) or any(type(v) is not int or v < 0 for v in limits.values()):
        raise ValueError("limits require nonnegative integers: " + ", ".join(DEFAULT_LIMITS))
    tool_hash = _hash(Path(__file__).read_bytes() + Path(__file__).with_name("library_index.py").read_bytes() + Path(__file__).with_name("memory_index.py").read_bytes() + Path(__file__).parents[1].joinpath("roundtrip/memory_ontology.py").read_bytes())
    games = []
    for game_id in sorted(set(game_ids)):
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", game_id) or game_id in (".", ".."):
            raise ValueError("unsafe game identity")
        # Re-read under the same budget on every invocation; missing->present also changes identity.
        game = _game(root, game_id, limits, source_receipts, memory_manifests, memory_indexes)
        key = _hash(_json({"game": game_id, "tool": tool_hash, "limits": limits, "pins": game["input_pins"]}).encode())
        destination = Path(cache_dir) / game_id / (key + ".json")
        game["cache_key"] = key
        serialized = _json(game) + "\n"
        hit = destination.is_file() and destination.stat().st_size == len(serialized.encode()) and destination.read_text() == serialized
        if not hit:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(serialized)
        games.append({**game, "cache_hit": hit})
    return {"schema": "gameverse.prefab-extraction/1", "schema_version": 1, "kind": "prefab-extraction-inventory", "tool_sha256": tool_hash, "limits": limits, "limits_scope": "per-game files/bytes; global semantic requests", "games": games, "candidates": [c for g in games for c in g["candidates"]], "semantic_requests": [r for g in games for r in g["semantic_requests"]][:limits["max_requests"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-receipt", action="append", default=[])
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--game", action="append", required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-files", type=int, default=DEFAULT_LIMITS["max_files"])
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_LIMITS["max_bytes"])
    parser.add_argument("--max-requests", type=int, default=DEFAULT_LIMITS["max_requests"])
    args = parser.parse_args()
    result = extract(args.root, args.game, args.cache_dir, {"max_files": args.max_files, "max_bytes": args.max_bytes, "max_requests": args.max_requests}, args.source_receipt)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")


if __name__ == "__main__":
    main()
