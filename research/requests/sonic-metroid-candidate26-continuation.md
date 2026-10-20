# Candidate26 bounded continuation — 2026-10-16

Stable candidate25 is untouched. Candidate26 is a separate authored-habitat
extension, with current proof in [mzm-ripper-habitat-proof.json](mzm-ripper-habitat-proof.json).
The cartridge is `local/composition-builds/sonic-metroid-signal-descent-26/game.gba`,
SHA256 `ef7d653159328e9ab4ac0d67eb63dd212e9c6c8f7382eaf7b683627cb0396605`.
All 41 retained build source snapshots match the current source. No rebuild was
necessary on resume; its existing clean build receipt records 0.827131s.

The native habitat witness passes real Ice pause/thaw, original recovered
poses 9→10→11→12→8→9 and reversed patrol with HP 20. It took 0.378829s; actual
screenshots and 375 frames of native playback are retained, video stride 2,
without audio. It begins at the candidate26 fresh-play high-speed checkpoint.
To reproduce in a new output directory:

```sh
python3 research/requests/mzm-ripper-habitat-witness.py \
  --rom local/composition-builds/sonic-metroid-signal-descent-26/game.gba \
  --state local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-qualified-prefix/high-speed/checkpoint-16.ss \
  --out local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-habitat-next
```

The prefix's old fixed input route failed before Speed. A diagonal Ice shot and
real passage repair it; the135-frame input route replay passes in 0.175720s. The
reusable `qualify_signal_descent.py` now includes this observed fallback. Its
coast/ice/first-act receipts are reused, with nine byte-identical checkpoint
links recorded; older missing source-commit metadata remains unavailable in
those original reports. Candidate26 then passes original first boss/capsule,
Factory Varia/heat and wall/grip/two-handle upperwest route in 10.737751s total.
Substage durations are nested, not additional runner work.

The later 2,400-frame native forward probe takes 1.286598s and stalls near x2390.
Twelve bounded wall-kick cycles raise the observed kick counter 4→15 but remain
near y902..915 beneath the overhang; a followup real observation confirms
native collision plane 1. Stage3's authored prefabs end at x1250 and contain no
new lock at x2390. This is a retained native-route problem, not evidence that
the automatic compiler lacks a required mechanic. A read-only own-ROM terrain
profile survey suggests the overhang lower edge at863px and solid face near
x2400; that simple survey omits packed suppression details and does not prove
all routes fail. No justified small authored geometry correction was found.

Next bounded test: from the exact natural upperwest landing below, inspect the
original upperwest route and actual 0x080238CC rectangle plane-trigger tasks.
Observe position, plane, angle, momentum and task state. Bound any checkpoint
input branching to 300 transitions / 20 seconds and replay a found route before acceptance.
Do not force a plane or bypass native geometry. The current right-input macro
is only an exploration probe, and repeating it unchanged is not useful.

- Resume state: `local/re/experiments/20261016-sonic-self-decompile/signal-descent-26-continuation-01/factory-upper/native-handle-transfer/checkpoint-25.ss`.
- Forward failure: `signal-descent-26-factory2-later-01/report.json` under the same experiment root.
- Wall-kick failure: `signal-descent-26-factory2-wallchain-01/report.json`.
- Plane observation: `signal-descent-26-wall-observation-01/report.json`.

No candidate27 was made. Later Factory bosses/finale remain unqualified. The
all-eight return remains candidate25 evidence; it is not attributed to candidate26.
