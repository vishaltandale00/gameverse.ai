# MegaMan Zero executable extraction: air subsystem

One own-ROM function now has **automatic executable L1 and finite native parity**: `0x08016d78`, conditional horizontal integration with indexed command storage and ordered facing writes. The private oracle passed **1,024 original-versus-emitted comparisons**, executing **52,544 instructions**. This is a usable verified subset of the air subsystem; full entry/contact/landing closure remains blocked.

[system.json](system.json) is the source-backed L2 contract: exact game identity, source paths/lines/symbols and hashes, inputs/state, alias ownership, transitions, call order, service effects, events and distinct qualification status. [manifest.json](manifest.json) pins the contract, private L1, adapter, qualification receipt, export report, successful/failing attempts and timings. No generated game, ROM, template, demonstration or catalog publication was created.

Private artifacts live in `local/ir/fleet-next/megaman-zero/`. Automatic lift consumed serialized HighFunction and the original ROM; no manual or decompiler C became compiler input. The lowerer generated the helper C from serialized L1. The private oracle clean-compiled that helper to an object image and compared it against original ROM execution; this is not a new game ROM.

## Exact dependency progress

Exporter permit **EX020** produced previously missing `0x080c8a98` and `0x080c8ad0` HighFunctions. It copied the project privately, preserved the original project, and released the permit after successful completion. The report and source hashes are retained under `missing-l0/ex020/`.

All full roots were actually attempted. Initial entry/air-step attempts failed on unbounded animation lookup indices. Applying source-observed call-site domains advanced those paths to the actor-owned nested references in `0x08015eec` and `0x08015f2c`. The real dispatcher `0x080c8a98` fails the incoming-LR return proof because it performs an indirect callback; no callback was erased. Generic division first reaches the missing zero-divide service; constraining its denominator to the source caller's literal 100 bypasses that branch and exposes the unsupported loop CFG. A further entry-phase state-domain experiment still required animation closure; the failed attempt is retained rather than represented as qualification.

Exact reproduction scripts and compiler blockers were sent to `/root/compiler_shared_state`. Next work is nested animation references, bounded dispatch and the signed-division loop, followed by terrain/contact closure. Animation and terrain effects were not replaced with authored services.

The helper's recovered native u8 index produces a 256-byte collection domain. The source command producer also shows a 64-entry ring, whose full integration is still open. Finite synthetic parity does not certify every live gameplay state, complete controller scheduling, units or lifecycle. The launch candidate's packed state remains different from this air mode; no launch→air link is claimed.

## Measured work

- Initial automatic root attempts: **0.222423750 s** total; successful helper native qualification **0.212573084 s**, nested inside that total.
- Helper compile/link/symbols/image stages: **0.022808750 / 0.004567250 / 0.003975500 / 0.003812583 s**; oracle compile **0.070141750 s**; native parity **0.074732084 s**. These are nested receipt stages.
- Two-function dependency export: **3.446930125 s** total, including **3.321430375 s** export process; original project unchanged.
- Follow-up domain closure attempts: **0.010616833 s**; denominator-100 attempt **0.003813875 s**; entry-phase attempt **0.002484000 s**.
- Source contract creation **0.028950000 s**; manifest consolidation **0.002096208 s**.

Queue time and total interactive analysis duration are unavailable. No CI or build-system implementation changed, so no before/after latency comparison is claimed. All failures and qualifications remain separate, and the game remains partial.
