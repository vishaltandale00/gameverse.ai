# Actual prefab pipeline demonstrations

The public modification route has produced a full original Aria cartridge with
the qualified enemy-defeat XP multiplier changed from 1 to 2:

```sh
python3 -m tools.prefab_pipeline mod-rom --request tools/prefab_pipeline/requests/aria-double-xp.json --output-dir local/prefab-mods/aria-double-xp-next --output local/prefab-mods/aria-double-xp-next-result.json
```

The retained successful run is
[`final.gba`](../../../../local/prefab-mods/aria-double-xp-20261016-01/final.gba)
and [`report.json`](../../../../local/prefab-mods/aria-double-xp-20261016-01/report.json).
It took 6.525905 s total, including 0.182968/0.166117 s clean parity/modified
payload builds and 5.770364 s total native play for original/parity/modified.
These stages are nested in total time. Fresh 14,720-vector instruction checks
passed; native XP witnesses were 1/1/2 in the bounded 6,400-frame scenario.
The current route supports this module and parameter only. It reuses a legacy
manually reconstructed/self-decompiled component package; it does not recover
the full game automatically or qualify the full campaign. Historical plan-pin
mismatches remain recorded alongside fresh current proofs.

Extraction and composition demonstration, without invoking any native build:

```sh
python3 research/ir-workshop/reusable-pipeline-20261016/demo/run.py
```

[`evidence/timing.json`](evidence/timing.json) pins the exact configuration,
source receipts, implementation files, source commit and machine. Cold/reuse
extraction took 39.95/38.36 ms; source-pair planning 298.53/255.22 ms;
heterogeneous planning 78.59/78.31 ms. These are one local pair of comparable
observations, not a numeric SLA or a manual-work baseline. Every extraction
re-reads and recomputes its input inventory before comparing the cached artifact;
the cache demonstrates validated artifact deduplication, not skipped semantic
discovery or faster ROM compilation. The key includes game, implementation,
limits and all discovered input hashes; missing→present files change identity.

The source-pair plan selects Emerald/FireRed's registered source importer for
preparation but blocks runnable qualification. The heterogeneous plan includes
the recovered Minish capsule and rejects backend admission. Both preserve
missing lifecycle/dependency/closure evidence. The demo references the existing
source preparation receipt `20261016T170203Z-c477f16f269b`, which reports 101
blockers, without rerunning preparation. Reuse observations reference the exact
backend identity in the cold full plan to avoid retaining duplicate source
inventories. They are observations, not executable plan documents.

No queue, preimplementation manual baseline, or cache-related ROM-build timing
exists for this demonstration; these measurements are explicitly unavailable.

An unsupported scale-3 request is retained at
[`unsupported-scale3/request.json`](evidence/unsupported-scale3/request.json).
The public command rejected it before any build. Its
[`structured result`](evidence/unsupported-scale3/result.json) and
[`bounded repair request`](evidence/unsupported-scale3/repair-request.json) retain
the exact package/plan/host/qualification/oracle/ROM input pins and required new
versioned outputs. The task permits at most one attempt, 120 seconds and $1;
it cannot promote. No repair agent, model call, compilation or simulation was
run. Reproduce this boundary without a build:

```sh
python3 research/ir-workshop/reusable-pipeline-20261016/demo/repair_request.py
```
