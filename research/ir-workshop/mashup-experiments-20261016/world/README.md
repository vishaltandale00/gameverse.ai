# Two world mashups: source functions + explicit authored host bridges

Both experiments demonstrate combined subsystems on the host. Neither is a playable game. The inter-system numeric bridges are authored, not recovered source and not admitted Composer nodes. Independent component graphs validate; the desired direct cross-game edges correctly reject incompatible source encoding/storage. The emitted C uses unchanged automatically recovered L1 functions and actual Composer invocation handoffs, interleaved by the explicit host schedule. This qualification tier is narrower than an accepted connected Composer graph.

Run `python3 research/ir-workshop/mashup-experiments-20261016/world/run.py` from repository root. It performs two clean small C builds and two bounded executions (30 s build / 10 s execution hard limits), no dependency installation or native campaign. Current report retains package/L1/qualification evidence, source commit, tool hashes, compiler/environment, failures and exact timings. `attempt-history.json` retains the first run's measurements after a harness-only repair. No CI/build latency comparison exists for these new experiments.

## Checkpoint camera snap and incoherent respawn

SMA1 selected retry callback restores integer checkpoint x/y. Explicit positive-domain bridge drives SMA4 camera origin, so projection sees the restored location. Keeping actor at fixed8 (20,16) after checkpoint (100,60) gives screen (-80,-44), proving checkpoint-only is not coherent respawn. Three checkpoint scenarios check this. An explicitly authored multiply-by-256 rebuild then centers actor (0,0), but does not recover the missing original SMA1 scene initializer or fixed-point backing. The direct graph fails `signed encoding mismatch: project.field_4`; source declarations are preserved. This is a camera/recovery boundary probe, not a new checkpoint scene.

## Patrol, camera tracking, and relative side

SMA2 player integration and SMA4 actor integration drive separate actors in an authored positive bounded world. Camera follows player; actor projection and SMA2 player-minus-actor query consume the same exact bounded pixel view. Across three 12-tick scenarios, camera screen x equals the negative of source relative scratch. A faster player passes a stationary actor: screen x 4,2,0,-2 and source side return 1,1,0,0. Faster actor scenarios recede while camera tracks player. No collision/encounter eligibility or combat rule is invented.

Direct actor→side graph fails signed-encoding proof. A separate player-u16→project-u32 graph isolates Composer's unsupported width conversion, even with a bounded exact multiply-by-256 conversion. Neither error is bypassed by changing package metadata. The host bridge validates positive coordinate range before the conversion and states chosen floor rounding; negative worlds remain out of scope.

## Smallest useful next work

Composer needs explicit numeric adapter nodes with source/target semantic identities, domain guards, sign/rounding proof and schedule checks, complementing its current bit mappings. That unlocks these source subsystem compositions without weakening contracts. Full playable candidates additionally require recovered or explicitly authored actor lifetime, input, terrain/collision, graphics/assets, renderer/frame lifecycle and objectives. Recovery additionally needs original SMA1 scene/dispatcher closure (retained prior frontier identifies 080ac9c4, 080adaa4 and live indirect 080b6cc4). Those services were not replaced by allocators, generic game templates, or a host-C success exit.
