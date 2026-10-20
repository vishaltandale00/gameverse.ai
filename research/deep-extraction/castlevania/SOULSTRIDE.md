# Soulstride: connected Aria prefab modification

Soulstride keeps Aria's original cartridge and campaign. The declarative
[request](../../../tools/prefab_pipeline/requests/aria-soulstride.json) lowers the
[strategy](soulstride-strategy.json) through the existing native prefab compiler.
The authored rules reuse recovered enemy rewards, Skeleton projectile lifecycle,
soul pickup/homing and native persistent inventory. They add no RAM or save data.

- Equip the **Winged Skeleton red soul**. Hold **Up + attack + Left/Right**. When a real
  Winged Skeleton bone and its collision partner are successfully allocated, Soma gets
  a directional lunge and small upward impulse. Original MP cost, input checks,
  capacity checks, collision and player integration remain native.
- The new bone inherits half Soma's horizontal velocity (bounded to 4 pixels per
  frame), connecting traversal to the actual ranged projectile and contact engine.
- Defeat an ordinary enemy while moving horizontally at least 1 pixel per frame:
  regain 4 MP, capped at the original character's actual maximum. A first unowned
  soul from the eleven source-reviewed early species becomes a real native soul
  pickup. Collection, notifications and persistent inventory remain original.
- Owning 3 and then 6 distinct active early souls increases the lunge from
  3 to 3.5 to 4 pixels per frame and the moving-defeat refund from 4 to 6 to 8 MP.
  Ownership is queried from the existing native inventory, with no new counter.

Moving is sampled at enemy defeat, rather than attributed to the last attack.
The guarantee requests a real pickup; allocation or failure to collect can still
prevent acquisition. Other species retain original reward RNG. The authored
first-soul match bypasses the later native drop rolls, as recorded in its policy.
The movement verb belongs specifically to the Winged Skeleton soul; other acquired
souls still serve their original abilities and also contribute to the finite
nine-active-soul tier set.

The previously recovered `0x08034624` casting transaction belongs to the alternate
player path. The actual ordinary Soma route is `0x0801B0D8 -> 0x08019478 ->
0x08026008`. An input-only native source-PC witness is retained at
`local/prefab-mods/soma-cast-pc-witness-003/report.json`; it observes MP 80→68,
real allocation and a two-entity Winged Skeleton cast. Soulstride therefore attaches
its lunge at successful **bone birth**, leaving Soma's original caster intact.
This source witness establishes the original route; candidate motion/collision,
resource and inventory-tier fixtures are separate evidence.

```sh
python3 -B -m tools.prefab_pipeline build-mod \
  --request tools/prefab_pipeline/requests/aria-soulstride.json \
  --output-dir local/prefab-mods/aria-soulstride-new-attempt \
  --output local/prefab-mods/aria-soulstride-new-attempt-result.json
```

This is a bounded game-specific strategy lowerer over explicit recovered native
ports. It is not a universal C compiler or whole-game IR reconstruction. The
original cartridge remains immutable; generated packages and candidate output
belong to a fresh attempt directory. Full-campaign qualification is separate
from cheap artifact integrity and bounded native/model observations.

The actual public iteration is retained at
`local/prefab-mods/aria-soulstride-iteration-002/iteration.json`. Its complete
original-game cartridge is `build-1/native/game.gba`, SHA-256
`6f52161e9826a16f2f063e452d6b63ef554d4efcce867eece0be418b401b86c8`.
The clean build took **0.405609 seconds**, including **0.028197 seconds** of
strategy lowering and **0.351796 seconds** in the shared native builder, with a
**5,800-byte** payload. Stages are nested, not additive to the total. The earlier
eleven-species reward-only candidate took 0.348052 seconds with a 4,936-byte
payload on the same recorded machine/toolchain family; these are different mod
requests, not a controlled compiler-only speed comparison. No CI or dependency
setup was added. Queue and billing measurements are unavailable.

The bounded real model traversal completed in 16.39632 seconds total, with
20 completed provider responses (12 System 1, 8 System 2), 12 native actions and
6,321 native frames including setup. It observed Winged Skeleton equipped,
MP 80→1 and an actual upward velocity of −98,304 Q16 (−1.5 pixels per frame).
It did not observe an enemy defeat or a newly collected soul: XP stayed 0 and
HP stayed 320. This partial diagnostic does not claim the whole resource and
progression cycle was played by the model. The strict existing S1 confidence
and margin gate remains in use. Failed first-attempt compilation is preserved
at `aria-soulstride-iteration-001`; its unused generated-header function was
repaired before the successful fresh attempt.

A separate **nine-case native reward-policy fixture** passed in 0.139933 seconds
at `local/prefab-mods/soulstride-reward-fixture-001/report.json`, against the exact
candidate SHA above. It executes the emitted enemy-defeat hook and original
inventory-count service from initialized RAM: moving unowned defeat gives MP
40→44 and one soul-spawn request without RNG; stationary defeat retains MP 40
and original RNG; duplicate, mode and character guards hold; MP 79 caps at 80;
negative MP and an unrepresentable signed maximum remain unchanged; owning all
nine active entries raises the refund to MP 40→48. RNG, tile, level and spawn
services are explicit deterministic boundaries in this fixture. It proves those
native policy decisions, rather than actual enemy combat or pickup collection.
Compilation completed once using existing cc/libmgba; its duration was not
recorded, and is not included in the native-execution measurement.

The core movement rule also passed an **input-only candidate gameplay witness**
at `local/prefab-mods/soulstride-input-motion-001/report.json` in 1.683036 seconds.
At frame 6068 Soma was stationary with MP 80 and no active effect. One frame of
Up + B + Right produced MP 68, two active entities, horizontal velocity +196,608
Q16 and vertical velocity −98,304 Q16. On the next original player tick, X
advanced exactly 196,608 and Y exactly −98,304; native horizontal deceleration
then continued. The report retains the source recipe and ten per-frame samples.
There were no RAM writes, service interceptions or model calls. Low-MP denial,
wall contact, tier-specific movement and the full campaign were not exercised by
this short gameplay witness.
