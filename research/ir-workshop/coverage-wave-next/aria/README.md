Aria now has a bounded installed executable-IR reconstruction of its complete
paired horizontal/vertical motion helpers at `0806d430` and `0806d460`.
The retained automatically recovered L1 was freshly lowered, bound and compiled;
the exact prior original-ROM proofs were reused. Each generated installed entry
passed 16,384 fresh native cases. The provider took 0.873254 s.

The output appends 200 bytes: 112 behavior bytes and 88 storage-binding bytes.
Sixteen original bytes become entry veneers. The remaining 8,388,592 bytes stay
preserved native/unknown host bytes, including 512 separately identified palette
bytes. Original source-function byte coverage is not inferred from emitted
symbol lengths. These are two newly installed entries, zero newly discovered
automatic roots; the existing qualified library already contained both roots.

Both helpers accept an unrestricted scalar speed cap in `r1` and aligned actor
RAM in `r0`. Incoming `r3` is unused. Original assembly shows paired callers
using the same actor and cap. Position, velocity and acceleration are recovered
state views, but actor allocation/lifetime, frame scheduling, collision and
whole-game equivalence remain unqualified.

The source target SHA1 matches the exact USA cartridge. A separate bounded
source oracle assembled the unchanged two-function source slice and reproduced
all 96 original envelope bytes exactly in 0.030835 s. This independently verifies
the source-to-ROM location; it does not establish a full source build or earn
installed IR credit. The installed bodies come only from automatic IR.

The 512-byte palette bank has a source declaration, exact USA extraction offset
and whole-bank DMA consumers targeting palette RAM. All 256 BGR555 words decode
and reencode exactly, including bit15. Its source declaration is an INCBIN;
these are identified raw assets, with zero regenerated asset output bytes.

The reviewed defeat-reward native replacement remains native C, with no retained
machine-SSA input found. It receives zero IR credit. Category3 soul IR cannot
safely replace its shared dispatcher while callers use other categories, so it
was excluded from this installation. No previous mashup was resumed.

The exact private bundle rebuild succeeds without the original/source, but that
capture replay regenerates zero IR. The shared bundle owner received this
packet for generic semantic recipe admission. See `result.json`, `assets.json`
and `bundle-replay.json`; original and rebuilt byte identities are explicit.

For a fresh run with the existing compiler stable:

```sh
python3 -B research/ir-workshop/coverage-wave-next/aria/reproduce.py --prefix local/roundtrip/coverage-next-aria-fresh-UNIQUE
```

No comparable before/after optimization measurement, full build timing, queue
timing or whole-game code/asset denominator is available. Per-stage native and
compile durations are nested in the provider total and must not be added twice.
