# Candidate26 native plane-trigger milestone — next bounded round

The source-guided experiment passes one original collision-plane milestone.
It does **not** establish passage beyond the later x2390 obstruction, a later
boss or the finale. Candidate25 and candidate26 cartridges and prior proofs
remain unchanged; no build or new candidate was made.

Proof: `research/requests/sonic-metroid-candidate26-trigger-proof.json`, SHA256
`9ac85090ab28ecacb6de5b9cc22f8a71abbf45ad3b280dd3f06b4585daa06ca6`.
Candidate26 SHA256 remains
`ef7d653159328e9ab4ac0d67eb63dd212e9c6c8f7382eaf7b683627cb0396605`.

From the proof-pinned natural upperwest landing, replay these actual inputs:

1. Left 28 frames; Left+A 30 frames.
2. L+Left 1 frame; L+Left+A 20 frames; Left+A 40 frames.
3. Left 60 frames.

The source-guided search uses 33 actual input transitions across 17 branches,
advancing 581 frames across those branches. Native task inspection takes
0.035286709 seconds, search takes 0.301618042 seconds; their combined cost is
0.336904751 seconds under the 300-transition / 20-second budget. Discontinuous
branch states have genuine PNGs, without presenting them as continuous video.

A separate deterministic replay uses 65 input transitions and 179 advanced
frames in 0.259580125 seconds, within its own 300-transition / 20-second cap.
The last 60 input frames are stepped individually for causal observation.
Actual original callback task `0x080238CD` exposes a species `0x11` rectangle
x1440–1464, y784–976. Before relative frame 161 the player is at
(1458.921875, 920.2734375), inside that rectangle on plane 1; frame 162 observes
plane 0. All 12 final observed state fields match the selected search branch.
This is source-consistent causal observation, not an instruction-PC trace or
new automatic lifting qualification.

Continuous native video (all 179 frames, stride 1, no audio), PNGs and final
checkpoint are retained in
`local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-trigger-replay-02/`.
Video SHA256:
`ab0b908ddb51d71f96a8becaa8d59a1f1fd62650412ca0ec0c9506767bd4e7fa`.
Encoding 0.055324 seconds is nested inside replay time. No CI/build measurement
or before/after speedup is claimed. Queue and analysis/implementation durations
are unavailable.

To reproduce the observed milestone using a fresh output directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/requests/sonic_metroid_trigger_replay.py \
  --rom local/composition-builds/sonic-metroid-signal-descent-26/game.gba \
  --search-report local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-trigger-search-02/report.json \
  --out local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-trigger-replay-next
```

Next unrun route test begins at
`local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-trigger-replay-02/checkpoint-25.ss`,
SHA256 `00fa6b0f04f8e63e57926c28cfb0a29f49166eb270eb421997fb6f982e41ecdb`.
The real player is at (1284.55859375, 890.54296875), native stage index 3
(Factory Act 2), plane 0, angle 52, momentum 1, tangent speed -2771 Q8,
velocity (-1180, -2501) Q8. Native loop motion is active. Continue source-guided
terrain/area-trigger observations toward a replayable eastward route, capped
at 300 native input transitions / 20 seconds. Do not force plane, teleport,
edit retained terrain or infer a whole route from this intermediate milestone.
A successful further route requires its own replay and evidence.

Earlier overhang/forward and wall-kick failures remain retained under their
original candidate26 paths. Candidate25's all-eight return proof remains
separate; candidate26 all-eight return, later bosses and finale are unqualified.
