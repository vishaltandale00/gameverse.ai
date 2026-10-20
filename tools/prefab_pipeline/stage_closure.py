"""Resolve typed importer obligations without deleting the original ledger.

Only the caller's source-specific verifier can attest semantic coverage. Hashes
and matching names alone never discharge a requirement. Untyped legacy blockers
remain unresolved until their producer supplies a concrete contract.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from tools.prefab_pipeline.contract import canonical_hash, verify_file_ref

ROOT = Path(__file__).resolve().parents[2]
SIGNATURE = ("capability", "type", "semantic", "scope")


def resolve_stage_obligations(needs, providers, *, root=ROOT, verifier=None):
    """Return immutable raw needs plus separate, evidenced resolution records.

    Both sides must declare exact SIGNATURE fields, input_pins, implementation_ref
    and evidence_ref. Provider inputs must cover all required inputs. verifier is
    a trusted implementation callable (never loaded from JSON); it receives
    (need, provider, root) and must return True after source-specific checks.
    """
    if not isinstance(needs, list) or not isinstance(providers, list):
        raise ValueError("needs and providers must be arrays")
    if len(needs) > 4096 or len(providers) > 4096:
        raise ValueError("stage closure exceeds 4096-record bound")
    raw = deepcopy(needs)
    resolved, unresolved = [], []

    def valid(record):
        if not isinstance(record, dict) or any(record.get(key) in (None, "", {}) for key in SIGNATURE):
            return False
        pins = record.get("input_pins")
        return (isinstance(pins, list) and bool(pins)
                and all(verify_file_ref(ref, root) for ref in pins)
                and verify_file_ref(record.get("implementation_ref"), root)
                and verify_file_ref(record.get("evidence_ref"), root))

    # Only structurally valid provider contracts enter the bounded index.
    index = {}
    for provider in providers:
        if valid(provider):
            key = canonical_hash({field: provider[field] for field in SIGNATURE})
            index.setdefault(key, []).append(provider)
    for need in needs:
        identity = need.get("id") if isinstance(need, dict) else None
        reason = "untyped-or-unpinned-obligation"
        matches = []
        if valid(need):
            key = canonical_hash({field: need[field] for field in SIGNATURE})
            candidates = index.get(key, [])
            required_pins = {canonical_hash(pin) for pin in need["input_pins"]}
            candidates = [p for p in candidates if required_pins <= {canonical_hash(pin) for pin in p["input_pins"]}]
            if need.get("provider_id"):
                candidates = [p for p in candidates if p.get("id") == need["provider_id"]]
            reason = "no-exact-provider"
            if candidates:
                reason = "semantic-verifier-required" if verifier is None else "semantic-verification-failed"
                for provider in candidates:
                    try:
                        verified = verifier(deepcopy(need), deepcopy(provider), Path(root)) if verifier else False
                    except Exception:
                        verified = False
                    if verified is True:
                        matches.append(provider)
            if len(matches) > 1:
                reason = "ambiguous-verified-providers"
            elif len(matches) == 1:
                provider = matches[0]
                resolved.append({"id": identity, "obligation_sha256": canonical_hash(need),
                                 "provider_id": provider.get("id"), "provider_sha256": canonical_hash(provider),
                                 "capability": need["capability"], "evidence_ref": deepcopy(provider["evidence_ref"]),
                                 "implementation_ref": deepcopy(provider["implementation_ref"]),
                                 "status": "resolved-by-verified-provider"})
                continue
        unresolved.append({"id": identity, "obligation": deepcopy(need), "reason": reason})
    return {"schema": "gameverse.stage-closure/1", "raw_needs": raw,
            "raw_needs_sha256": canonical_hash(raw), "resolved": resolved,
            "unresolved": unresolved, "closed": not unresolved,
            "scope": "Only typed listed obligations; this does not certify whole-game semantic coverage."}
