# Native Sonic × Metroid IR campaign recipe

The new cartridge is
[`game.gba`](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/native/game.gba),
SHA-256 `50757987593917bddafe6b32c3355cb9af32d899468850af69115bad59f3d855`.
Its [request](request.json) builds through the reusable public pipeline:

```sh
python3 -B -m tools.prefab_pipeline build-mod \
  --request research/deep-extraction/sonic-metroid/request.json \
  --output-dir local/prefab-mods/sonic-metroid-native-ir-progress-next \
  --output local/prefab-mods/sonic-metroid-native-ir-progress-next-result.json
```

Use a fresh output directory. The original Sonic USA and Metroid Zero Mission
USA cartridges and local extracted assets are required; their hashes and data
ranges are checked by the retained native compiler.

This resumes the best found native work, historical Signal Descent candidate26,
through a registered source-variant recipe. Its complete original Sonic
campaign engine, geometry, graphics, sound and native boss services remain in
the cartridge. Twenty source-pinned component packages reuse the recovered
Sonic motion/contact controller, original MZM Ripper controller and sprite
assets, automatically emitted MZM impact, weapons, resources, gates, upgrade
caches, visited-stage relays and scene lifecycle. Authored placement, integration
and other creature patterns remain labeled as authored. The earlier website
and movement-only demonstration are not deliverables of this request.

The new implementation replaces authored upgrade ownership arithmetic with
the automatically emitted original MZM acquisition and persistent event
operations. Six original equipment cases control Bomb, High Jump, Ice, Varia,
Speed and Screw rewards. Morph and missiles use explicit private event meanings
through the original event operations. The same source-owned state drives
weapon access, gates and revisited caches. See the
[source mapping and host proof](progression/README.md).

The native TaskCreate owner now allocates and zeroes 1,600 bytes. The existing
1,536-byte observation layout is unchanged; a 36-byte equipment/event state
starts at offset 1,536, and its typed writes and allocation extent are declared
in the generated state package. The source variant starts a fresh campaign.
Emulator checkpoints belong to this exact cartridge; old candidate26 checkpoints
are not migrated. The recipe does not extend the original SRAM save format.

The [delivery receipt](delivery.json) retains exact provenance and timing.
The comparable clean baseline rebuilt candidate26 byte-for-byte in 0.856329 s
total, including 0.830387 s native build and 27,280 payload bytes. The new clean
build took 1.039475 s total, including 0.029064 s recipe lowering, 0.049216 s merge
and 0.930130 s native build, with 27,920 payload bytes. These are one sample
each on the same machine/toolchain; stages are nested, queue time and CI timing
are unavailable. Failed attempt001 is retained with its emitted unused-label
compiler diagnostic; scoped diagnostic wrappers preserve the emitted bodies.

Fresh source-guided native input replay on the new cartridge passes coastal
upgrades, the frozen-creature platform, High Jump/Speed, the original eight-hit
boss and capsule, Factory Varia/heat, wall kick/powergrip and both original
moving handles. The separate replay stages took 9.405903 s, 4.850263 s and
1.696884 s. This is scripted setup evidence, not model decisions. A read-only
[native observation](../../../local/prefab-mods/sonic-metroid-native-ir-progress-002/source-state-observation/source-state.json)
confirms the emitted equipment/event state actually contains seven acquired
upgrades at the resulting Factory Act 2 checkpoint.

The [Sonic adapter](../../../tools/playtester/sonic_adapter.py) provides exact
source facts and screenshots to the existing DecisionAI/System 2 experiment
interface. It locates bounded native task-owned state, preserves native input
and checkpoint semantics, and labels the source-guided setup. The first real public pipeline model experiment completed 12 System 1 and
12 System 2 responses, then executed 12 model-selected native actions totaling
288 frames plus the one initial render frame. It moved from x1933.59 to x1863.75
and then remained at native contact. The run ended at its step limit. Its
feedback exposed the partial-progress policy mixing animation with unchanged
source position. A corrected source-traversal scope then detected one repeated
LEFT barrier and let the model try right/left jumps and a wall-kick input. That
second public run completed 24 model responses and 12 actual actions totaling
284 frames plus one render frame, ending at x1864/y825.14/plane1 with unchanged
energy113. It took 19.134916 s including the experiment. All System 1 decisions
remained subject to the confidence gate and escalated to System 2; no action
class bypass was added. The route remains partial, with no new upgrade, gate or
kill in these model runs. Both histories are pinned in the delivery receipt.
Factory Act 2
beyond the upperwest route and later bosses/finale remain unqualified; neither
the entire Metroid world nor automatic whole-game L2 recovery is claimed.
