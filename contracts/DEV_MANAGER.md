# Developer manager protocol v1

Status: implemented for issue #21 packages 0–2, reference fixtures only. See [operation and limitations](../docs/development/SANDBOX_MANAGER.md). Existing engine/harness workstream contracts remain unchanged.

A fixture request has these fields only:

```json
{
  "id": "a stable request UUID",
  "manager_id": "the paired installation UUID",
  "role": "parent",
  "source_commit": "40 lowercase hexadecimal characters",
  "limits": {
    "wall_ms": 300000,
    "job_wall_ms": 60000,
    "max_jobs": 3,
    "max_sandboxes": 2,
    "model_calls": 0
  }
}
```

A child has `role: "improvement"` and `parent_id` naming its active parent. The name describes its reservation role, not an implemented construction algorithm. Same UUID plus same normalized input returns the original task; conflicting input rejects. Children retain the original owner, manager, parent allowance and deadline. Cancellation includes descendants. Unknown cleanup holds admission. Stop is a retained reservation, not deletion.

`wall_ms`: 1,000–900,000; `job_wall_ms`: 1,000–120,000, no larger than its enclosing wall allowance or parent's job allowance; `max_jobs`: 1–8; `max_sandboxes`: 1–4. All must be finite integers. Provider calls are exactly zero. The worker uses a fixed private 1 CPU / 1 GiB / 3 GiB image, fixed paths and commands; no arbitrary executable input is supported.

Hosted requests require verified developer phone identity and same-origin mutation, or the paired installation's signed possession proof. Device operations are `poll`, `view`, `submit`, `cancel`, `inventory`, `report`, `artifact`. Manager routing is not a provider capability. Cross-owner stop/delete requires owner/resource/revision confirmation and delegates cleanup to the confirmed manager. Signed reports have monotone sequence numbers and exact duplicate acknowledgments. Replayed signatures fail; a retry must be re-signed.

Retained artifacts have kind (`source` or `result`), SHA-256 and size. Private R2 bytes are uploaded before their metadata acknowledgment; success requires both and confirmed sandbox deletion. Available events/results survive device restart. Cloud storage holds no personal provider or Daytona credentials. Runtime version, adapter/fixture version, source commit, task ID, resource policy and machine context accompany the fixed result; elapsed operation intervals are reported where measured. Missing queue/build/retention/cleanup breakdowns are unavailable, not zero.

## Required-check manifest for this slice

The immutable fixture runtime and independent verifier live outside any user-supplied source tree in `scripts/dev-manager/fixture.mjs`. No editable candidate can redefine them. The artifact gate requires exact fixed source, matching request/source identity, SHA-256, zero model calls and four addition cases. The independent check and deletion execute through Daytona. No coding agent is admitted in this version.

Repository changes to this capability require `npm run test:manager`, affected `npm run test:hosting`, `npm run build`, `npm run infra:check`, and `git diff --check`. These are developer review gates, not an implemented publication service. The soccer/harness task manifest, provider connection references, steer/retain/publish grants and A/V session contract remain package 3–6 work. Until those references and adapters are qualified, they are rejected/unsupported rather than interpreted as arbitrary commands.
