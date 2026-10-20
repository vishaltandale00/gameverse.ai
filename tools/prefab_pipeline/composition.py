"""Deterministic prefab admission and backend planning, without executing builds.

This layer validates declared interfaces. It does not infer source semantics or
promote a behavior proof into full-engine closure. Source importers and existing
IR validators remain responsible for lowering their own supported contracts.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import hashlib
import json
import platform
import time

ROOT = Path(__file__).resolve().parents[2]
GBA_CAPACITY = {"rom": 32 * 1024 * 1024, "ewram": 256 * 1024,
                "iwram": 32 * 1024, "vram": 96 * 1024,
                "palette": 1024, "oam": 1024}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def _signature(port):
    return {key: port.get(key) for key in ("type", "semantic")}


def plan_composition(request, root=ROOT, verify_files=True):
    """Return a JSON plan and explicit gaps; no subprocess or source mutation.

    A dependency order is a preparation order, not an inferred runtime schedule.
    Runtime conditions/phase policies require a backend that can lower them.
    """
    from tools.prefab_pipeline.contract import validate_capsule, capsule_closed
    from tools.prefab_pipeline.backends import select_backend, BackendError

    started = time.perf_counter()
    diagnostics = []

    def gap(code, detail, prefab_id=None, repair=None):
        diagnostics.append({"code": code, "prefab_id": prefab_id, "detail": detail,
                            "repair": repair or "Supply pinned implementation and evidence covering this obligation."})

    if not isinstance(request, dict):
        request = {}
        gap("request.invalid", "Composition request must be an object.")
    capsules = request.get("prefabs", [])
    if not isinstance(capsules, list) or not 1 <= len(capsules) <= 128:
        gap("request.prefabs", "prefabs must contain 1..128 resolved capsules.")
        capsules = []
    if request.get("target") != "gba":
        gap("target.unsupported", "Only the explicit gba target is supported.")
    by_id = {}
    closed = {}
    bounded_edit = (request.get("backend") == "bounded-original-rom-edit"
                    or request.get("mode") == "bounded-original-rom-edit"
                    or bool(capsules) and all(isinstance(c, dict) and c.get("backend") == "native-rom-patch"
                                              for c in capsules))
    for index, capsule in enumerate(capsules):
        if not isinstance(capsule, dict):
            gap("capsule.invalid", f"Prefab at index {index} must be an object.")
            continue
        identity = capsule.get("prefab_id")
        if not isinstance(identity, str) or not identity:
            gap("capsule.identity", f"Prefab at index {index} has no identity.")
            continue
        if identity in by_id:
            gap("capsule.duplicate", "Prefab identities must be unique.", identity)
            continue
        by_id[identity] = capsule
        errors = validate_capsule(capsule, root=root, verify_files=verify_files)
        for error in errors:
            gap("capsule.contract", str(error), identity)
        if errors:
            del by_id[identity]
            continue
        closed[identity] = capsule_closed(capsule, root=root, verify_files=verify_files)
        if not closed[identity] and not bounded_edit:
            gap("closure.incomplete", "Full declared prefab closure is not established; slice evidence is insufficient.", identity)
        for missing in ([] if bounded_edit else capsule.get("closure", {}).get("missing", [])):
            gap("closure.obligation", str(missing), identity)

    # Stable Kahn traversal: no input-array ordering can choose a winner.
    deps = {identity: set() for identity in by_id}
    inherited_obligations = []
    for identity, capsule in by_id.items():
        for dependency in capsule.get("dependencies", []):
            if (bounded_edit and capsule.get("backend") == "native-rom-patch"
                    and isinstance(dependency, dict)
                    and dependency.get("resolution_scope") == "retained-exact-rom-service"):
                inherited_obligations.append({"prefab_id": identity, "dependency": dependency,
                                              "validation": "required from native patch backend"})
                continue
            dependency = dependency.get("prefab_id") if isinstance(dependency, dict) else dependency
            if not isinstance(dependency, str) or dependency not in by_id:
                gap("dependency.missing", f"Unresolved dependency: {dependency!r}.", identity)
            else:
                deps[identity].add(dependency)
    remaining = {key: set(value) for key, value in deps.items()}
    order = []
    while remaining:
        ready = sorted(key for key, value in remaining.items() if not value)
        if not ready:
            gap("dependency.cycle", "Dependency cycle among: " + ", ".join(sorted(remaining)))
            break
        for key in ready:
            order.append(key)
            del remaining[key]
        for value in remaining.values():
            value.difference_update(ready)

    # Exact signatures include units, frame, domain and namespace when declared.
    providers = defaultdict(list)
    for identity, capsule in by_id.items():
        for port in capsule.get("provides", []):
            if isinstance(port, dict) and isinstance(port.get("id"), str):
                providers[port["id"]].append((identity, port))
    bindings = []
    for identity, capsule in by_id.items():
        for requirement in capsule.get("requires", []):
            if not isinstance(requirement, dict):
                continue
            retained_services = {item["dependency"].get("id") for item in inherited_obligations
                                 if item["prefab_id"] == identity}
            if requirement.get("id") in retained_services:
                continue
            if not isinstance(requirement.get("id"), str):
                gap("capability.invalid", "Required capability needs a string identity.", identity)
                continue
            candidates = providers.get(requirement["id"], [])
            if requirement.get("provider"):
                candidates = [item for item in candidates if item[0] == requirement["provider"]]
            exact = [(owner, port) for owner, port in candidates
                     if _signature(port) == _signature(requirement)
                     and port.get("type") is not None and port.get("semantic") is not None]
            if len(exact) == 1:
                bindings.append({"consumer": identity, "provider": exact[0][0],
                                 "capability": requirement["id"], "signature": _signature(requirement)})
            else:
                gap("capability.ambiguous" if len(exact) > 1 else "capability.unsatisfied",
                    f"Capability {requirement.get('id')!r} has {len(exact)} exact typed/semantic providers; "
                    "same-name source functions are not semantic equality.", identity,
                    "Bind one exact provider or implement and qualify an explicit adapter as a prefab.")
    if request.get("adapters"):
        gap("adapter.unlowered", "Inline adapters are not executable contracts for this planner.",
            repair="Publish each adapter as a pinned prefab with typed input/output capabilities and qualification evidence.")

    slots = {}
    writers = defaultdict(set)
    for identity, capsule in by_id.items():
        for slot in capsule.get("state", []):
            if not isinstance(slot, dict) or not isinstance(slot.get("name"), str):
                continue
            name = slot["name"]
            signature = {key: slot.get(key) for key in ("type", "semantic", "owner", "lifetime", "count")}
            if name in slots and slots[name] != signature:
                gap("state.incompatible", f"Shared slot {name!r} differs in type, semantics, ownership or lifetime.", identity)
            else:
                slots[name] = signature
            if slot.get("access") in ("write", "read-write"):
                writers[name].add(identity)
                if slot.get("owner") != identity:
                    gap("state.write_ownership", f"Prefab writes {name!r} owned by {slot.get('owner')!r}.", identity)
    for name, owners in writers.items():
        if len(owners) > 1:
            gap("state.multiple_writers", f"Shared slot {name!r} has multiple writers: {sorted(owners)}.")

    schedule = request.get("schedule", {})
    if schedule:
        # Source import runtime call placement cannot be inferred from a DAG.
        gap("schedule.lowering_required", "Authored runtime schedule/conditions require backend-specific lowering and lifecycle evidence.",
            repair="Use the existing mechanic assembly schedule validator for portable IR, or provide a source-engine schedule transform with evidence.")
    save_policy = request.get("save_policy", {"mode": "fresh"})
    if not isinstance(save_policy, dict) or save_policy.get("mode") not in ("fresh", "preserve"):
        gap("save.policy", "Save policy must explicitly select fresh or preserve.")
    elif save_policy["mode"] == "preserve":
        schema = save_policy.get("schema")
        if not schema:
            gap("save.schema", "Preserving progress requires an exact save schema identity.")
        for identity, capsule in by_id.items():
            progression = capsule.get("progression", {})
            if progression.get("save_schema") != schema or not progression.get("preserve_supported"):
                gap("save.incompatible", "Prefab does not establish preservation of the requested save schema.", identity,
                    "Supply a tested schema-compatible save adapter/migration or request explicit fresh progress.")

    usage = defaultdict(int)
    resource_unknown = []
    for identity, capsule in by_id.items():
        for resource in capsule.get("resources", []):
            if not isinstance(resource, dict):
                continue
            kind = resource.get("kind")
            if kind not in GBA_CAPACITY:
                continue
            size = resource.get("bytes")
            if size is None:
                resource_unknown.append({"prefab_id": identity, "kind": kind})
            elif type(size) is not int or size < 0:
                gap("resource.invalid", f"Invalid {kind} byte usage: {size!r}.", identity)
            else:
                usage[kind] += size
    for kind, size in usage.items():
        if size > GBA_CAPACITY[kind]:
            gap("resource.capacity", f"Declared {kind} use {size} exceeds physical capacity {GBA_CAPACITY[kind]}.")

    backend_plan = None
    try:
        backend_plan = select_backend([by_id[key] for key in sorted(by_id)], request)
    except BackendError as error:
        gap("backend.unsupported", str(error), repair="Implement a backend plugin for these exact engine/ABI contracts, with link, services, assets and save closure tests.")
    diagnostics.sort(key=lambda item: (item["prefab_id"] or "", item["code"], item["detail"]))
    # Bounded repair contracts are work descriptions, never automatic approval.
    repair_jobs = []
    repair_limits = request.get("repair_limits", {})
    max_jobs = repair_limits.get("max_jobs", 16) if isinstance(repair_limits, dict) else 16
    max_jobs = max_jobs if type(max_jobs) is int and 0 <= max_jobs <= 128 else 16
    for diagnostic in diagnostics[:max_jobs]:
        repair_jobs.append({"job_id": digest(diagnostic)[:20], "prefab_id": diagnostic["prefab_id"],
                            "kind": "diagnostic-work-description", "dispatchable": False,
                            "obligation": diagnostic["code"], "task": diagnostic["repair"],
                            "acceptance": "Pinned implementation, scope-specific passing evidence, and a clean rerun of admission.",
                            "limits": {"max_attempts": 1, "wall_timeout_s": 300},
                            "status": "proposed"})
    plan = {"schema": "gameverse.prefab-composition-plan/1", "target": request.get("target"),
            "status": "blocked" if diagnostics else "ready", "executable_ready": not diagnostics,
            "preparation_allowed": backend_plan is not None,
            "capsule_hashes": {key: digest(by_id[key]) for key in sorted(by_id)},
            "dependency_order": order, "runtime_schedule_inferred": False,
            "inherited_engine_obligations": inherited_obligations,
            "capability_bindings": sorted(bindings, key=lambda item: (item["consumer"], item["capability"])),
            "state": dict(sorted(slots.items())), "save_policy": save_policy,
            "resources": {"declared_usage": dict(sorted(usage.items())), "unknown": resource_unknown,
                          "final_linker_layout_required": True, "estimates_are_link_proof": False},
            "backend_plan": backend_plan, "diagnostics": diagnostics,
            "repair_jobs": repair_jobs, "repair_jobs_omitted": max(0, len(diagnostics) - len(repair_jobs)),
            "validation_scope": "Declared prefab admission and supported backend selection; runtime lifecycle semantics and final GBA linker closure require backend evidence.",
            "closure_policy": "bounded edit inherits original engine; backend must prove host identity, ABI and native equivalence/modification" if bounded_edit else "full selected prefab closure required"}
    plan["plan_sha256"] = digest(plan)
    plan["timing"] = {"wall_s": time.perf_counter() - started, "queue_s": None,
                      "stage": "admission", "build_s": None, "simulation_s": None,
                      "outcome": plan["status"], "environment": platform.platform(),
                      "cache": "existing file evidence verified; no build", "build_mode": None,
                      "compiler_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return plan
