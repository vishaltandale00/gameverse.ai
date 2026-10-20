# Automatic motion extraction result

Three actual own-ROM HighFunction roots now have local automatic executable L1, generated C, native receipts, package manifests and emitted C/header ABIs:

- `local/ir/fleet-next/superstar/attempt02-directed/080401f0/`: initializer, 1,024 native comparisons including64 explicit override/default cases.
- `local/ir/fleet-next/superstar/attempt02-directed/080402c4/`: update including automatically linked reset body, 1,024 comparisons including216 explicit active/inactive, mode and zero/baseline boundary cases.
- `local/ir/fleet-next/superstar/attempt01/08047eb8/`: reset, 1,024 boundary/random comparisons.

Initial generic runs also passed initializer/update at1,024 each. This yields5,120 finite native comparisons across five retained receipts, not5,120 unique legal gameplay states. The second runs were justified by source branch/default coverage absent from generic random testing. No manual C supplied behavior input. Actual byte-derived L0 was lifted recursively through serialized L1 dependency linking, lowered, built to ARM, and compared against original ROM code with the existing mGBA oracle. No Ghidra export, dependency install or new CI stage was needed.

ROM SHA256: `af9066e7eacdab919e92987db8856d038e4b75d4ed011259c893702085a886be`. Source L0 hashes and compiler snapshot are recorded in `attempt01/summary.json`; each receipt retains exact L1, adapter, generated C, native image and oracle pins. `validation.json` checks stable package/receipt/behavior identities.

The initial three-root batch took0.624587541s including lifting and native checks. Directed initializer qualification took0.217382875s; directed update took0.191850792s. These qualification durations include build/tool stages and native parity; individual stage durations remain in receipts. Queue time is unavailable. No before/after latency comparison is claimed. The cost of the added verification is two focused1,024-case native runs covering the specific unestablished source branches, rather than another broad census.

`l2-contract.json` is a nonexecutable source-backed lifecycle contract. Each root is executable and finite-qualified; the assembled init-to-update sequence is not transaction-qualified. Shared actor fields have different scalar ABI numbers per root; `l0-bindings.json` and the contract require one canonical actor owner, preserving aliasing rather than independent copies. Operational field names describe source equations only: physical units, actor identity, tick cadence, input, terrain and outer scheduling remain unqualified. No complete RPG controller, bundled engine mechanics, game or generated game ROM is claimed or published.

Stable reproduction scripts in this directory: `extract.py`, `targeted.py`, `package.py`. They write exclusive fixed attempt directories and intentionally fail if those directories already exist, preserving prior receipts rather than overwriting them. A fresh assignment should select fresh output paths before a new run.
