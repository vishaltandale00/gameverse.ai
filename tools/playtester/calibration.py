"""Outcome calibration for S1 scores; no provider calls, action exemptions or fitting online.

Intervals assume independent, exchangeable scenario trials inside each fixed bin.
A distinct identifier cannot itself establish independence: the collection protocol
must justify it. Unknown outcomes are counted as failures for gate qualification,
so excluding hard-to-label trials cannot inflate the acceptance estimate.
"""
from __future__ import annotations

import hashlib
import json
import math

VERSION = "source-outcome-calibration/1"
REQUIRED_SCOPE = {"game_id", "game_version", "adapter_version", "profile_sha256",
                  "provider", "model", "endpoint", "policy_sha256"}


def _require(ok, code):
    if not ok:
        raise ValueError(code)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def _tail(n, k, p):
    """P[Binomial(n,p)>=k], evaluated in log space to avoid underflow."""
    if k <= 0:
        return 1.
    if p == 0:
        return 0.
    if p == 1:
        return 1.
    terms = [math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1)
             + i * math.log(p) + (n - i) * math.log1p(-p) for i in range(k, n + 1)]
    high = max(terms)
    return min(1., math.exp(high) * sum(math.exp(x - high) for x in terms))


def exact_interval(successes, trials, alpha=.05):
    """Two-sided Clopper-Pearson interval; [0,1] for no observations.

    https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
    """
    _require(type(trials) is int and 0 <= trials <= 10000 and
             type(successes) is int and 0 <= successes <= trials, "invalid_counts")
    _require(_number(alpha) and 0 < alpha < 1, "invalid_alpha")
    if not trials:
        return [0., 1.]

    def lower(k):
        if not k:
            return 0.
        lo, hi = 0., 1.
        for _ in range(55):
            mid = (lo + hi) / 2
            if _tail(trials, k, mid) < alpha / 2:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    return [lower(successes), 1. - lower(trials - successes)]


def _bin(score, edges):
    _require(_number(score) and 0 <= score <= 1, "invalid_raw_score")
    return next(i for i in range(len(edges) - 1)
                if edges[i] <= score < edges[i + 1] or (score == 1 and i == len(edges) - 2))


def build_artifact(*, scope, protocol, samples, edges, target_success, alpha=.05):
    """Build a fixed calibration artifact from prespecified independent trials.

    protocol pins the outcome definition, sampling/splitting rule and horizon
    before outcome inspection. One S1-proposed action per independent group is
    admitted. fit/heldout memberships must be fixed before collecting labels.
    heldout trials never expand the bins selected by fit.
    """
    _require(isinstance(scope, dict) and REQUIRED_SCOPE <= set(scope) and
             all(isinstance(v, str) and v for v in scope.values()), "invalid_scope")
    _require(isinstance(protocol, dict) and all(isinstance(protocol.get(k), str) and protocol[k]
             for k in ("label_definition", "label_version", "sampling_plan", "independence_basis",
                       "split_rule", "horizon", "source_evidence_basis")), "invalid_protocol")
    _require(protocol.get("prespecified") is True, "protocol_not_prespecified")
    _require(isinstance(edges, list) and 2 <= len(edges) <= 21 and
             all(_number(x) for x in edges) and edges[0] == 0 and edges[-1] == 1 and
             all(a < b for a, b in zip(edges, edges[1:])), "invalid_fixed_bins")
    _require(_number(target_success) and 0 < target_success < 1, "invalid_target_success")
    _require(_number(alpha) and 0 < alpha < 1, "invalid_alpha")
    _require(isinstance(samples, list) and len(samples) <= 10000, "invalid_samples")
    groups, evidence = set(), set()
    buckets = {part: [[] for _ in range(len(edges) - 1)] for part in ("fit", "heldout")}
    for row in samples:
        _require(isinstance(row, dict), "invalid_sample")
        _require(row.get("scope") == scope, "sample_scope_mismatch")
        group = row.get("independent_group")
        _require(isinstance(group, str) and bool(group) and group not in groups, "duplicate_or_missing_independent_group")
        groups.add(group)
        proof = row.get("evidence_sha256")
        _require(isinstance(proof, str) and len(proof) == 64 and
                 all(c in "0123456789abcdef" for c in proof) and proof not in evidence,
                 "duplicate_or_invalid_evidence_hash")
        evidence.add(proof)
        _require(row.get("label_basis") == "source_gameplay_outcome", "invalid_label_basis")
        _require(isinstance(row.get("proposed_action"), str) and row["proposed_action"] and
                 row.get("executed_action") == row["proposed_action"], "unexecuted_s1_proposal")
        _require(row.get("label") is None or type(row.get("label")) is bool, "invalid_label")
        _require("label" in row, "missing_label")
        part = row.get("split")
        _require(part in buckets, "invalid_split")
        buckets[part][_bin(row.get("raw_score"), edges)].append(row["label"])

    # Simultaneous intervals for every bin in both splits, including empty bins.
    per_interval_alpha = alpha / (2 * (len(edges) - 1))
    summaries = []
    for i in range(len(edges) - 1):
        summary = {"lo": edges[i], "hi": edges[i + 1]}
        for part in ("fit", "heldout"):
            labels = buckets[part][i]
            successes = sum(x is True for x in labels)
            summary[part] = {"trials": len(labels), "successes": successes,
                             "unknown": sum(x is None for x in labels),
                             "estimate": successes / len(labels) if labels else None,
                             "interval": exact_interval(successes, len(labels), per_interval_alpha)}
        summary["qualified"] = all(summary[part]["interval"][0] >= target_success
                                   for part in ("fit", "heldout"))
        summaries.append(summary)
    result = {"schema_version": 1, "method": VERSION, "scope": scope, "protocol": protocol,
              "edges": edges, "target_success": target_success, "alpha": alpha,
              "interval_alpha": per_interval_alpha, "bins": summaries,
              "sample_count": len(samples), "samples_sha256": fingerprint(samples),
              "status": "qualified_bins" if any(b["qualified"] for b in summaries) else "insufficient_evidence",
              "interpretation": "Bin-level source-outcome frequency; not certainty for an individual action. "
              "Unknown labels count against qualification. Validity assumes the pinned independent sampling protocol."}
    result["artifact_sha256"] = fingerprint(result)
    return result


class OutcomeCalibration:
    """Read-only evaluation against a validated evidence bundle, never learns in play."""
    def __init__(self, bundle):
        _require(isinstance(bundle, dict) and set(bundle) == {"spec", "samples", "artifact_sha256"},
                 "invalid_calibration_bundle")
        self.artifact = build_artifact(**bundle["spec"], samples=bundle["samples"])
        _require(self.artifact["artifact_sha256"] == bundle["artifact_sha256"], "calibration_digest_mismatch")

    def evaluate(self, raw_score, scope):
        result = {"accepted": False, "reason": "calibration_scope_mismatch",
                  "artifact_sha256": self.artifact["artifact_sha256"],
                  "raw_score": raw_score, "estimate": None, "interval": [0., 1.]}
        if scope != self.artifact["scope"]:
            return result
        row = self.artifact["bins"][_bin(raw_score, self.artifact["edges"])]
        result.update(accepted=row["qualified"],
                      reason="calibrated_outcome_confidence" if row["qualified"] else "calibration_insufficient_evidence",
                      estimate=row["fit"]["estimate"], interval=row["fit"]["interval"],
                      heldout=row["heldout"], target_success=self.artifact["target_success"],
                      bin=[row["lo"], row["hi"]])
        return result
