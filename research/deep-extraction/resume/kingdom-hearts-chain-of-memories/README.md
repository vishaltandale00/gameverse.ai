# Kingdom Hearts: Chain of Memories — periodic resource recovery

Static dependency map only. This game remains partial, with zero retained native-qualified behaviors in its queue item. Mario remains the depth priority. No Ghidra process, compiler run, build, native scenario, catalog or shared queue change was performed for this packet.

[packet.json](packet.json) pins the own-ROM SHA256, 4,303-record function export, historical census, eleven exact function records and each available HighFunction export. Decompiler text hashes cover the exact UTF-8 `c` field; they are inspection provenance, never compiler input. Physical offsets below describe L0/validation mappings; future executable state must use symbolic ownership and references.

The selected causal branch is `0x0801e854`, HighFunction blocks 46–54, PCs `0x0801ed2a`–`0x0801ed90`. A linked effect kind of `0x17` enables recovery of a positive signed-halfword actor resource toward its maximum, gated by the remainder-like helper `0x0811d7cc(actor.phase, 120) == 0`. For an ordinary positive signed16 gap the amount is `max(1, gap / 8)`. Resource identity as health is plausible but unverified. Preserve original shifts, casts and wrapping stores beyond that ordinary domain.

The key coupling is that the linked effect's signed-halfword remaining count decreases on every eligible gated update, **including actor mode 2**, where the resource addition is skipped. There is no local guard that remaining is positive. An isolated “heal” helper that drops this consumption or invents expiration is incomplete.

Initialization at `0x0801e098` links the actor to a canonical primary or secondary world side, seeds current/maximum, resets the phase counter, and registers `actor + 0x40` in `side + 0x7c`. The combat view's `+0x2c` is therefore exactly the actor resource at `+0x6c`. These must share backing. Effect storage through `actor + 0x124` is the same world-side storage modified by installers `0x0807b45c` and `0x0807b478`, called by `0x08079600`. Literal `0x17` acquisition, remaining initialization and expiration are open edges. Cleanup at `0x08076f80` clears effect kind, but its causal link to exhausted remaining is not proven.

The root evaluates recovery before combat update `0x0801adac` and controller dispatch. The shared continuation `0x08026b48` increments the phase counter after controller work, using inherited r7/r8 and stack state. Cadence, pause behavior and exactly-once scheduling require recovery of the containing function. Do not replace this with a newly authored timer or assume that 120 updates equals two seconds.

The concrete blockers are:

- Historical root lift failed `unresolved pointer v7` in 0.005831958 s. This is a retained old result, not a rerun against the current dirty compiler.
- No retained HighFunction exists for the arithmetic helper, controller continuation, effect installers or cleanup. Their own-ROM decompiler records exist, with hashes in the packet.
- Fragmented continuations use live registers and inherited stack views. Unrecovered indirect returns/dispatch and inconsistent return inference for `0x0801adac` need boundary/ABI repair.
- Effect installation, resource consumption and expiration must close over the same world owner before composability can be claimed.

Next: the compiler owner should obtain bounded own-ROM HighFunction exports for `0x0811d7cc` and the containing controller continuation, resolve the canonical world/actor aliases, and automatically lift the selected branch. Then close activation/expiration and run finite original/host/emitted vectors covering mode 2 consumption, phase boundaries/wrap, signed resource limits and both side aliases. Native gameplay evidence is still unrun.

Current checks verified ROM SHA256 `6f6e7b61bb7b6ef7e2bea6e9dd01e70570a715835cc3713abe86186fd2c4e28d` and function-export SHA256 `d2010a7da0ead8cf5ccd218cc021c9f974e067b1f85d562d5dec480d9bce5e99` against the exact queue item. Packet construction and hashing measured 0.067181 s. Total interactive inspection time and queue time are unavailable; no build/simulation timings are claimed. The historical discovery process took 11.399552791 s (export 11.073124916 s, static census 0.313632541 s); these stage times are nested in its total and must not be added again. No turnaround-affecting implementation changed, so a before/after comparison is unavailable.

Packet JSON parsing, eleven function entries and retained HighFunction hashes passed a focused validation in 0.001743 s.
