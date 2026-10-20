# FFVI raw instruction pcode extraction

The existing HighFunction representation omitted real FFVI VM register writes: cached `08134884` exposed only r0/r1 outputs, and cached `081348bc` exposed only r0. Original instructions write r8/r9. The new raw export preserves those writes, CPU flags, memory effects and control instructions without adding hand-written behavior.

`ffvi-raw-export-index.json` is the stable source index. It pins twelve exact source artifacts, both run receipts, ROM/span/output/script hashes, register definitions, the installed ARM language source hashes, and the original-versus-raw register-output comparison. Raw files use `gameverse.l0.raw-pcode/0.1`, the format agreed with `vm_ir_lowering`:

```text
entry, end_exclusive, rom_sha256, source_span_sha256,
instructions: [{pc, bytes, length, TMode, mnemonic, disassembly,
               flow_type, fallthrough, flows,
               pcode: [{index, opcode, output, inputs, ...}]}]
```

Each inline varnode retains space, unsigned decimal offset, size, register name, constant flag and identity. Register identities persist across instructions. Unique temporaries are scoped by instruction PC. Ordered raw pcode includes complete register/flag writes; no HighFunction/SSA dead-store simplification is used. Register definitions include alias/base and bit-width information. User-op names are exported from the actual language; ID62 is `setISAMode`. The backend must handle proven effects explicitly and reject unknown/omitted effects.

EX047 exported six exact saved-instruction regions: HP `0807e7c0..0807e82e`, pending-KO `0807e838..0807e88e`, terminal KO `0807e9c2..0807ea20`, preparation `0807ea30..0807eb10`, pending-status OR `0807b830..0807b84e`, and call-prepare `08134b14..08134b1e` (half-open ends). Literal pools remain outside the regions. The originally requested combined arithmetic region stopped safely at `081348ea`, where no saved instruction existed. That partial-run receipt and exact failure remain retained; no incomplete arithmetic artifact was presented as a complete region.

EX048 exported only the six actual helper slices required by the source callgraph: `08134884..081348a0`, `081348a0..081348bc`, `081348bc..081348d0`, `08134918..0813492c`, `0813499c..081349ac`, and `081349ac..081349c2`. Compiler and VM owners explicitly agreed to in-memory `PseudoDisassembler` decoding only for the proven 20-byte AND and OR spans. Other helpers use existing instructions. This decoder uses a private pseudo context and never mutates Program listing/context/functions, guesses a boundary, or performs broad analysis. Exact bytes, span hashes and decoded coverage are validated before delivery.

Private output directories are `local/re/mashup-coverage-exports/ffvi-raw-ex047-20261016T142050Z/` and `ffvi-raw-ex048-20261016T142328Z/`. Original project file manifests remained unchanged. Ghidra opening the isolated copies changed only copied internal backup/journal inventory metadata; those differences are explicitly listed in the index rather than described as unchanged copies. The scripts contain no program mutation calls.

Actual invocation wall times were 3.460502 seconds for EX047 and 3.024722 seconds for EX048, totaling 6.485224 seconds. Exporter script times, 0.045526 and 0.028708 seconds, are nested inside process time. Queue duration is unavailable. Both coordinator permits/project leases were released immediately. Existing limits remained one ROM per invocation, 45 seconds per script, 75 seconds per process, 128 MiB output and 900 seconds total. No dependency or CI stage was added, and these different representations do not establish a before/after speedup.

VM lowering/native ABI owners received the exact files for automatic conversion and finite native verification. This exporter ran no native/build stage and grants no qualification, typed port, mechanic closure or publication. Raw sources must not be inserted into the existing HighFunction depth pool. No shared compiler, queue, catalog or prior cached export was modified.
