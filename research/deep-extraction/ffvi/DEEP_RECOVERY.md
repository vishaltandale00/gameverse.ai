# FFVI battle recovery

This packet follows actual gameplay from a Magitek attack into enemy defeat and persistent victory currency. It uses the original USA ROM independently; no community source supplies implementation. It is **not yet an assemblable FFVI battle prefab**. The automatic lifter must consume original ROM/p-code with the custom ABI described in `battle-recovery.json`. The C files here are independent semantic oracles, not lifter inputs.

The native witness publishes resolved damage 282, applies it to a 27-HP enemy, queues and settles defeat, shows EXP 12 and gil 30, then commits persistent money from 3000 to 3030 after acknowledgement. Each party member gains 12 persistent XP. A passive store trace identifies the damage publication, HP transaction and currency commit. A separate ordinary-input recording shows the whole transition: `local/re/experiments/ffvi-attack-victory-recording-01/playthrough.mp4`. Private ROMs, checkpoints, memory traces and video remain ignored under `local/`.

Recovered causal semantics include target damage/recovery sentinels, target exclusion masks, effect suppression, healing saturation, lethal HP clamping, pending KO status, and the acknowledged 24-bit currency grant/cap. The magic base calculation is independently verified too: power 60, selected stat 28 and selected level 1 produce base 292. The remaining target pipeline changes that to the observed 282; its complete defense/variance/status/element policy remains the next boundary to close.

FFVI's battle engine is not AAPCS. It keeps a downward continuation stack in r5, a virtual register bank in r6, a byte argument stack in r7, NZ state in r8 and carry history in r9. A call-preparation helper pushes LR+4 before a following BL; return pops an explicit Thumb continuation. Native multiply helpers also depend on a math-unit context pointer inside the scratch bank. Treating the decompiler's `unaff_r5` fields as unimportant globals would lose gameplay state and return behavior.

Run only the affected bounded oracle:

```sh
python3 research/deep-extraction/ffvi/qualify_battle_resources.py --out local/re/experiments/ffvi-resource-new
python3 research/deep-extraction/ffvi/qualify_battle_resources.py --oracle damage-base --out local/re/experiments/ffvi-base-new
python3 research/deep-extraction/ffvi/qualify_battle_resources.py --oracle progression --out local/re/experiments/ffvi-progression-new
python3 research/deep-extraction/ffvi/qualify_battle_resources.py --oracle level-magic --out local/re/experiments/ffvi-level-magic-new
```

The resource oracle passed 2,704 HP/KO cases and 100 currency cases against original CPU execution, 518,883 instructions, with a 10,000-instruction cap per call. Its clean build took 0.066 s; combined simulation/evaluation 0.112 s; complete runner 0.207 s on arm64 macOS/Homebrew libmgba. The magic-base oracle passed 1,000 cases, 515,246 instructions: clean build 0.062 s, combined simulation/evaluation 0.078 s, total 0.178 s. These are distinct scopes, not before/after performance comparisons. No earlier comparable baseline exists. Queue, separate simulation/evaluation costs, CI and emitted-ROM timings are unavailable. Receipts pin source commit, original ROM and exact oracle source hash.

The progression oracle adds 300 XP persistence cases and 297 threshold boundaries (0.210 s clean runner). The connected level/growth/magic oracle adds 588 cases over both naturally magical actor IDs, all current levels 1–98 and XP immediately below/on/above the next threshold (0.169 s clean runner). It compares complete spell banks, base HP/MP caps and packed flags, level changes and unchanged current resources. Equipment growth modifiers are disabled explicitly; other character techniques remain separate.

A controlled native gameplay fixture then calls the original XP API to deliver 564 XP, moving Terra from 96 to 660. The untouched opening battle supplies the remaining 12. Ordinary native victory progression takes her from level 3 to 6, base HP 63 to 114 and base MP 27 to 51; current HP/MP remain 63/27. The native screen says “learned Poisona!” and spell 50 changes from 0 to complete `0xff`. The fixture injects no level, stat or learned-spell state. Its 2,016-frame video is `local/re/experiments/ffvi-level-magic-gameplay-02/play/playthrough.mp4`; screenshot `play/observation-000001.png`. Emulation, observation and nested encoding together took 1.126 s; compile timing was not captured. `progression-gameplay-qualification.json` retains exact fixture/checkpoint hashes and the earlier compile failure.

Command selection, ATB and enemy decisions, full target damage transformation, status realization, reward eligibility/aggregation, other character techniques/equipment bonuses and the generated custom-ABI adapter still require closure. The currency oracle enters after message acknowledgement; it does not replace the native victory UI. XP-to-level-to-stat/natural-magic behavior is now qualified in its explicit domain, while a portable generated FFVI battle engine remains unclaimed.
