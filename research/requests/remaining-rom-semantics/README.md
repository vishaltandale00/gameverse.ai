# Remaining-ROM gameplay semantics — bounded static pass

New work identifies **10 gameplay-facing candidates across five source-poor games**, anchored to retained pseudo-C and exact ROM identities. This is deeper than cataloging generic copy/RNG helpers, but it is not a claim of recovered complete mechanics. One Dragon Ball input transformation has an instruction-checked local subset; the broader action, collision and AI meanings remain candidates.

No ROM sessions, new Ghidra runs, builds, tests or model calls were performed. Five bounded 192-byte Thumb prefixes (960 bytes total) were inspected against local ROMs. Prefix disassembly includes literal pools and may include neighboring code; it does not establish complete function boundaries. The 22-ROM cohort scan located leads; only the five named games received the deeper semantic pass.

## New candidates

| Game | Entry | Useful seam | Evidence / remaining gap |
|---|---|---|---|
| dragon-ball-advanced-adventure | [`0x080149dc`](pseudocode/dragon-ball-advanced-adventure--0x080149dc.c) | Actor-local held/pressed/released input and directional repetition | Local input operator checked in Thumb; actor/action identity open. |
| dragon-ball-advanced-adventure | [`0x08017244`](pseudocode/dragon-ball-advanced-adventure--0x08017244.c) | Capability-gated jump/direction action dispatch and horizontal decay | Retained C; full ABI and gameplay role unverified. |
| dragon-ball-advanced-adventure | [`0x08016c84`](pseudocode/dragon-ball-advanced-adventure--0x08016c84.c) | Context-sensitive action handler selection | Retained C; full ABI and gameplay role unverified. |
| kirby-and-the-amazing-mirror | [`0x0800385c`](pseudocode/kirby-and-the-amazing-mirror--0x0800385c.c) | Tile-sampled actor bounds and position correction | Retained C; initial field/probe prefix checked; full ABI and gameplay role unverified. |
| kirby-and-the-amazing-mirror | [`0x08038b34`](pseudocode/kirby-and-the-amazing-mirror--0x08038b34.c) | Pairwise actor interaction filtering | Retained C; full ABI and gameplay role unverified. |
| kirby-nightmare-in-dream-land | [`0x0801e178`](pseudocode/kirby-nightmare-in-dream-land--0x0801e178.c) | Surface-table probes and position correction | Retained C; initial field/probe prefix checked; full ABI and gameplay role unverified. |
| kirby-nightmare-in-dream-land | [`0x08036280`](pseudocode/kirby-nightmare-in-dream-land--0x08036280.c) | Actor-mode transitions driven by probes and input-like fields | Retained C; full ABI and gameplay role unverified. |
| grand-theft-auto | [`0x08045910`](pseudocode/grand-theft-auto--0x08045910.c) | Nearest-of-two position-record choice and reaction dispatch | Retained C; initial field/probe prefix checked; full ABI and gameplay role unverified. |
| grand-theft-auto | [`0x08051e78`](pseudocode/grand-theft-auto--0x08051e78.c) | Timer- and flag-gated actor action controller | Retained C; full ABI and gameplay role unverified. |
| final-fantasy-vi-advance | [`0x0815115c`](pseudocode/final-fantasy-vi-advance--0x0815115c.c) | Input-aware text/control-code stream driver | Retained C; initial field/probe prefix checked; full ABI and gameplay role unverified. |

The [machine-readable packet](packet.json) retains full ROM SHA-1/SHA-256, export-file and pseudo-C hashes, exact JSONL row numbers, reviewed C line spans and hashes, instruction-prefix byte hashes, source capture run/hash, input adapter anchors, reads/writes, confidence, exclusions and concrete next capture/disassembly targets.

## What is already concrete

- **Dragon Ball:** the input adapter reads GBA KEYINPUT; a fixed object at `0x020205a0` is passed to `0x080149dc`. Its instruction-checked transformation stores held/new/released bits at object offsets `+0xe2/+0xe4/+0xe6` and produces repeat input at `+0xe8`. Capability flags and these fields then select different handlers in `0x08017244` and `0x08016c84`. Named moves, actor identity, velocity units and full branch meanings still need evidence.
- **Kirby & the Amazing Mirror:** `0x0800385c` combines position-like words `+0x40/+0x44` with signed bounds `+0x3c..+0x3f`, samples map/tile properties, and writes corrected positions and contact flags. The prefix confirms the signed-byte scaling by 256. `0x08038b34` separately iterates `0x1a8`-byte records and filters pairwise interactions; it should not yet be labeled the whole companion AI.
- **Kirby: Nightmare in Dream Land:** `0x0801e178` calls terrain samplers that use 16×16-local coordinates and tile-shape tables, then adjusts coordinate-bearing global words. `0x08036280` has an actor-local state graph over states 0–6; which actor or ability owns it is unresolved. It appeared as a call target 401 times in the retained phase named gameplay and not in the other retained phases. Phase labels alone are not behavior validation.
- **GTA:** `0x08045910` compares two coordinate-bearing record references using an inexpensive distance surrogate and caches its selected reference. This is a concrete AI/spatial targeting lead; neither police behavior nor target actor identity is established. `0x08051e78` adds a timer/configuration-gated action-controller lead.
- **FFVI:** `0x0815115c` distinguishes glyph-like values from larger control values, handles layout offsets and delays, and checks input for text advance. The retained capture shows a snowy town dialogue. This is a narrative-presentation lead; it does not establish the event/quest VM or combat rules.

The six KEYINPUT adapter bodies are retained as supporting anchors. Three tempting functions were explicitly deprioritized: Amazing Mirror `0x08026698` is mainly transition/presentation state; FFVI `0x0811ab18` is unidentified initialization, and `0x080164b8` is packed-bit unpacking with unaffiliated-register artifacts. None is promoted to a gameplay ontology merely because it touches state.

## Cohort coverage

These are retained partial capture-target exports. “Canonical file” only means a YAML exists; some files contain a few numeric helpers rather than a complete player-facing ontology. Exported function counts do not measure whole-ROM recovery.

| Game | Exported records | Canonical file | New deeper pass |
|---|---:|---|---|
| crash-bandicoot-the-huge-adventure | 751 | yes | not this pass |
| dragon-ball-advanced-adventure | 716 | no | 10-candidate cohort |
| driv3r | 169 | no | not this pass |
| final-fantasy-i-and-ii-dawn-of-souls | 456 | no | not this pass |
| final-fantasy-vi-advance | 735 | no | 10-candidate cohort |
| grand-theft-auto | 864 | no | 10-candidate cohort |
| kirby-and-the-amazing-mirror | 838 | no | 10-candidate cohort |
| kirby-nightmare-in-dream-land | 711 | no | 10-candidate cohort |
| legend-of-zelda-the-a-link-to-the-past-and-four-swords | 889 | no | not this pass |
| megaman-zero | 876 | yes | not this pass |
| metal-slug-advance | 1148 | yes | not this pass |
| need-for-speed-underground | 423 | no | not this pass |
| prince-of-persia-the-sands-of-time | 594 | yes | not this pass |
| shaman-king-master-of-spirits | 323 | no | not this pass |
| super-mario-advance | 413 | no | not this pass |
| super-mario-advance-2-super-mario-world | 731 | no | not this pass |
| super-mario-advance-4-super-mario-bros-3 | 479 | no | not this pass |
| tekken-advance | 340 | no | not this pass |
| final-fantasy-tactics-advance | 1159 | yes | not this pass |
| mario-and-luigi-superstar-saga | 591 | yes | not this pass |
| mario-kart-super-circuit | 626 | yes | not this pass |
| sonic-advance | 383 | yes | not this pass |

## Next bounded investigations

**dragon-ball-advanced-adventure**

- Disassemble08014a6c..080153b4 and08017244..08017b8c, repair actual saved-LR epilogues before trusting callflow
- Decode handlers08018e68/0801b93c and table08a41822 against ROM bytes
- Checkpoint a normal stage and probe LEFT/RIGHT/A/B separately for12frames
- Watch fixed record020205a0 input+e2/e4/e6/e8 and position-like+1c/+20, velocity-like+2c/+2e; log selected callback+10

**kirby-and-the-amazing-mirror**

- Check0800385c body and callback table082d8da4; decode sampler080023e4 and overlap0803912c
- Map record02020ee0 stride1a8 actor identities before calling this partner AI
- Probe walking/jump into a known visible wall from an isolated checkpoint
- At0800385c log R0/R1 and record+40/+44/+50/+52/+57/+58/+62, plus tile samples and contact outcome

**kirby-nightmare-in-dream-land**

- Check08021634/080216d8/080219b0 and shape tables087328f0/08733ff0
- Trace writes to current object pointer03002490 and global work record03005560/03005570
- Probe a flat landing and one ledge with separate short inputs
- Log tile IDs03005578/03005588, local sample03005508 and correction before/after0801e178; trace state+73 object identity

**grand-theft-auto**

- Decode08045910 distance arithmetic and writers of02000f10/02001140
- Decode080544c0/08053d68 for eligibility before inferring combat, police or traffic rules
- Use an isolated street checkpoint; change only player proximity/vehicle state in short steps
- Log0202f3d8/0202f3dc cache and both candidate coordinate records alongside pixels; do not infer mission success

**final-fantasy-vi-advance**

- Disassemble0815115c stream branches and decode08150844/08150894 glyph helpers
- Find actual token stream pointer writers before treating text codes as plot/event opcodes
- From the retained Guard dialogue state, compare WAIT vs A vs B with same checkpoint
- Record03002518 state+18/+19/+1c/+30 and selected control030024b8; separate text advance from world movement

## Limits

The original exports commonly misidentify saved-LR epilogues as indirect jumps, and FFVI has additional unaffiliated/extra-output register artifacts. Neither `decomp_ok` nor a changed image proves game mechanics. New packets preserve those warnings and withhold named mechanics where actors, units, field meanings or caller contexts are missing. No canonical ontology, native candidate ROM, frontend, save or build receipt was changed.

`build_packet.py` regenerates this evidence packet from retained local inputs. Its measured generation time is recorded separately; interactive research wall time was not instrumented and remains unavailable. This work is evidence discovery, not a model-quality, performance or full-game qualification benchmark.
