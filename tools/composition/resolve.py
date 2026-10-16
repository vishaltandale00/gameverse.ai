#!/usr/bin/env python3
"""Check the bounded static subset of Gameverse composition IR; never build a ROM.

No solver, network, model, compiler or emulator dependency. Unsupported contracts
remain obligations. A coherent declaration is not proof of a correct implementation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

VERSION = "composition-static/0.1"
TYPE_FIELDS = ("scalar", "unit", "frame", "quantity")


def resolve(doc):
    errors, obligations, checked = [], [], []

    def issue(code, subject, detail, unresolved=False):
        (obligations if unresolved else errors).append(
            {"code": code, "subject": subject, "detail": detail})

    if doc.get("ir_version") != "0.1" or doc.get("kind") != "composition_plan":
        issue("UNSUPPORTED_DOCUMENT", "document", "Expected composition_plan IR0.1")
        return report(doc, errors, obligations, checked)
    supported = {"ir_version", "kind", "id", "target", "intent", "evidence", "execution",
                 "states", "components", "bindings", "transforms", "budgets",
                 "route_obligations", "obligations", "native_build"}
    for key in sorted(set(doc) - supported):
        issue("UNSUPPORTED_FIELD", key, "No static semantics registered for this field", True)
    try:
        modes = set(doc["execution"]["modes"])
        phases = doc["execution"]["phases"]
        if not modes or len(phases) != len(set(phases)):
            raise ValueError("Modes must be nonempty and phases unique")
        components = index(doc["components"])
        states = index(doc["states"])
        transforms = index(doc.get("transforms", []))
    except (KeyError, TypeError, ValueError) as exc:
        issue("MALFORMED_CORE", "document", str(exc))
        return report(doc, errors, obligations, checked)
    ports = {}
    providers = {}
    writers = {}
    for cid, component in components.items():
        for port in component.get("ports", []):
            key = cid + "." + port["id"]
            if key in ports:
                issue("DUPLICATE_PORT", key, "Port ID must be unique within component")
            ports[key] = port
            typ = port.get("type", {})
            if any(not isinstance(typ.get(field), str) for field in TYPE_FIELDS):
                issue("INCOMPLETE_TYPE", key, "scalar, quantity, unit and frame are required")
        for capability in component.get("provides", []):
            providers.setdefault(capability, []).append(cid)
        for dependency in component.get("requires_components", []):
            if dependency not in components:
                issue("DEPENDENCY_MISSING", cid, dependency)
        for access in component.get("accesses", []):
            sid, phase = access["state"], access["phase"]
            active_modes = set(access["modes"])
            if sid not in states or phase not in phases or not active_modes or not active_modes <= modes:
                issue("ACCESS_SCOPE", cid, "Unknown state/phase/mode or empty active modes")
                continue
            if access["op"] == "write":
                for mode in active_modes:
                    writers.setdefault((sid, phase, mode), []).append(cid)
            elif access["op"] != "read":
                issue("ACCESS_OPERATION", cid, "Only read/write supported")
        if component.get("implementation", {}).get("status") != "qualified":
            issue("IMPLEMENTATION_UNQUALIFIED", cid,
                  "Declared contract still needs extracted/lowered code and exact-ROM witnesses", True)
        elif not component["implementation"].get("evidence_refs"):
            issue("QUALIFICATION_EVIDENCE_REQUIRED", cid, "Qualified label has no evidence references", True)
        if component.get("entity"):
            issue("PREFAB_CONTRACT_REQUIRED", cid, "Entity lifecycle/render contracts require native validation", True)
        if doc.get("target", {}).get("authoritative_origin") == "self_decompilation":
            recovery = component.get("implementation", {}).get("recovery_evidence_ref")
            if not recovery:
                issue("RECOVERY_EVIDENCE_REQUIRED", cid,
                      "Own ROM recovery address/instruction/data closure and dynamic witnesses required; imported symbols do not establish authority", True)
            else:
                issue("RECOVERY_VALIDATION_REQUIRED", cid,
                      "Reference present; this checker does not verify raw ROM recovery or closure evidence", True)
    for cid, component in components.items():
        for capability in component.get("requires", []):
            if capability not in providers:
                issue("CAPABILITY_MISSING", cid, capability)
    checked.append("component dependency closure and exact versioned capability names")
    for (sid, phase, mode), owners in sorted(writers.items()):
        if len(owners) > 1:
            issue("WRITE_CONFLICT", sid, "%s/%s has writers %s" % (phase, mode, ", ".join(owners)))
    for sid, state in states.items():
        if state.get("invariants"):
            issue("STATE_INVARIANT_WITNESS_REQUIRED", sid, "Prose invariants require a registered executable validator", True)
        for claim in state.get("required_writers", []):
            for mode in claim["modes"]:
                owners = writers.get((sid, claim["phase"], mode), [])
                if len(owners) != 1:
                    issue("AUTHORITY_COVERAGE", sid,
                          "%s/%s requires exactly one writer, found%d" % (claim["phase"], mode, len(owners)))
        save = state.get("persistence")
        if save and save.get("required"):
            if not save.get("owner") or save["owner"] not in components:
                issue("SAVE_OWNER_MISSING", sid, "Persistent state needs selected serialization owner")
            for mechanism in save.get("mechanisms", []):
                if mechanism not in providers:
                    issue("SAVE_CAPABILITY_MISSING", sid, mechanism)
    checked.append("single writer per declared phase/mode, required authority coverage and persistence owner")
    bound = set()
    for edge in doc.get("bindings", []):
        source, target = edge["from"], edge["to"]
        if source not in ports or target not in ports:
            issue("PORT_MISSING", source + " -> " + target, "Endpoint not selected")
            continue
        a, b = ports[source], ports[target]
        if a["direction"] != "out" or b["direction"] != "in":
            issue("PORT_DIRECTION", target, "Bindings must connect output to input")
        if target in bound:
            issue("INPUT_MULTIPLE_BINDINGS", target, "Use explicit merge/arbitration component")
        bound.add(target)
        transform = transforms.get(edge.get("transform"))
        if edge.get("transform") and transform is None:
            issue("TRANSFORM_MISSING", target, edge["transform"])
            continue
        if transform:
            if not same_type(a["type"], transform["input_type"]) or not same_type(b["type"], transform["output_type"]):
                issue("TRANSFORM_TYPE_MISMATCH", target, "Transform endpoint signature differs")
            if not transform.get("preserves") or not transform.get("operations"):
                issue("TRANSFORM_CONTRACT_MISSING", transform["id"], "Need ordered operations and preservation obligations")
            issue("TRANSFORM_PROOF_REQUIRED", transform["id"],
                  "Ordered arithmetic is declared, not evaluated or proven by this checker", True)
        elif not same_type(a["type"], b["type"]):
            issue("TYPE_MISMATCH", source + " -> " + target,
                  "Direct edge differs in scalar/quantity/unit/frame; explicit transform required")
    for key, port in ports.items():
        if port["direction"] == "in" and port.get("required", True) and key not in bound:
            issue("INPUT_UNBOUND", key, "Required input has no provider")
    checked.append("port direction, input cardinality and quantity/unit/frame/storage signatures")
    for budget in doc.get("budgets", []):
        if budget.get("aggregation") != "conservative_sum_of_selected_peaks":
            issue("BUDGET_AGGREGATION_UNSUPPORTED", budget["resource"], "Only conservative sum of selected peaks is checked")
            continue
        total = 0
        for cid in components:
            value = components[cid].get("resources", {}).get(budget["resource"])
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                issue("BUDGET_UNKNOWN", cid, budget["resource"] + " peak unknown", True)
            else:
                total += value
        if total > budget["limit"]:
            issue("BUDGET_EXCEEDED", budget["resource"], "%d > %d" % (total, budget["limit"]))
    for route in doc.get("route_obligations", []):
        for capability in route.get("requires", []):
            if capability not in providers:
                issue("ROUTE_CAPABILITY_MISSING", route["id"], capability)
        issue("ROUTE_WITNESS_REQUIRED", route["id"],
              "Retained/edited route needs reachability, exit, gate-order and recovery witnesses against candidate ROM", True)
    for transition in doc["execution"].get("transitions", []):
        if transition["from"] not in modes or transition["to"] not in modes:
            issue("TRANSITION_MODE", transition["id"], "Unknown endpoint mode")
        issue("TRANSITION_WITNESS_REQUIRED", transition["id"],
              "Guard coverage, transfer invariants, hysteresis and entry/exit restoration are not statically proven", True)
    for obligation in doc.get("obligations", []):
        issue("DECLARED_OBLIGATION", obligation["id"], obligation["detail"], True)
    checked.append("declared additive peak budgets and route capability prerequisites")
    return report(doc, errors, obligations, checked)


def index(rows):
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate ID in collection")
    return result


def same_type(a, b):
    return all(a.get(key) == b.get(key) for key in TYPE_FIELDS)


def report(doc, errors, obligations, checked):
    return {"resolver_version": VERSION, "plan_id": doc.get("id"),
            "status": "rejected" if errors else "unresolved" if obligations else "statically_consistent",
            "ready_for_lowering": False, "errors": errors,
            "obligations": obligations, "checked": checked,
            "limits": "Declarations only; no source closure, arithmetic proof, route proof, lowering or ROM qualification"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    data = args.plan.read_bytes()
    start = time.perf_counter()
    try:
        result = resolve(json.loads(data))
    except (ValueError, KeyError, TypeError) as exc:
        result = report({}, [{"code": "MALFORMED_CORE", "subject": "document", "detail": str(exc)}], [], [])
    result["input_sha256"] = hashlib.sha256(data).hexdigest()
    result["wall_s"] = round(time.perf_counter() - start, 6)
    output = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.write_text(output)
    else:
        print(output, end="")
    return 2 if result["errors"] else 3 if result["obligations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
