The exact USA ROM matches the source target SHA1 at tmc commit
`6fb6dfb4a7efbe24d0fd1dda5097af6131faacde`. This proves target selection;
a complete matching source build and ELF/map are still unavailable.

The fresh generic reconstruction executes automatic machine-SSA lifting of
`GetInventoryValue` and `SetInventoryValue`, compiler lowering, storage binding,
ARM compilation/linking and original-entry native parity. Both entries pass
256 original-ROM and 256 rebuilt-ROM vectors. The provider took 1.489038 s;
the separate exact captured baseline took 0.084621 s. These are warm local
bounded runs, not clean full-game builds or comparable optimization measurements.

The output appends 168 bytes: 54 behavior, 112 storage binding and 2 alignment.
Sixteen original bytes become mechanical entry veneers. The remaining
16,777,200 bytes remain preserved native/unknown host bytes. No captured bytes
receive executable IR credit, and emitted function lengths do not measure
recovered source-function byte coverage. The original and reconstructed
cartridges intentionally differ; whole-game equivalence remains unqualified.

Input domains are item ID 0..255 and write value 0..3. Retained L0 incoming
register varnodes are read `r0` and write `r0,r1`; neither requires incoming
`r3`, which the entry veneer clobbers. The only recovered mutable region is
the 64-byte packed inventory bank. Original callers, persistence and scheduling
remain native and unqualified.

`assets.json` identifies five uncompressed palettes (160 bytes) using the
source extraction offsets, assembly labels, BGR555 converter and palette-group
DMA consumer. All 80 decoded words reserialize exactly, including bit15. These
remain unchanged host bytes; this lane claims zero asset-regenerated output
bytes. Source-address evidence is not a matching full ELF proof.

`result.json` pins the private execution evidence and exact counts. The private
bundle rebuild succeeds from local artifacts without the original/source, but
its replay regenerates zero IR. `bundle-repro.json` records the existing
MZM-specific semantic admission rejection; the shared bundle owner received
the executable repro. No compiler helpers, source tree, ROM or global inventory
were modified.

For a fresh bounded execution (requires the existing compiler's stable window):

```sh
python3 -B research/ir-workshop/coverage-wave-next/minish-cap/reproduce.py --prefix local/roundtrip/coverage-next-minish-fresh-UNIQUE
```
