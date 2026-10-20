# Continuation token source review

Scoped source-semantic clearance for `native_tokens.py`, the current `qualify.py` hook, and the frozen FFVI `hp-candidate-v1` continuation spill mapping. This clearance allows the owner to proceed with bounded native qualification, subject to their other ABI/VM review gates. It does not establish native parity or HP-system completeness. Exact implementation and candidate hashes are in `review.json`.

The source mapping is concrete: the first call at `0807e7c0` sets Thumb LR to `0807e7c5`. Helper `08134b14` copies LR to r1, adds four, decrements r5 by four, and stores r1 at `08134b1a` (`op106` in normalized L0). Entry r5 is `03007000`, so the store writes `0807e7c9` to `03006ffc`. The portable L1 writes token 1 to `field_22`; its adapter maps token 1 bijectively to that original source value. The entry spill domain is exactly null/zero. No other scalar adapter field overlaps this spill.

The VM normalizer only tokenizes constant stores naming pinned Thumb source instructions in its bounded continuation frame. It rejects data reads from the spill and nonconstant/unresolved token values; numeric code addresses remain adapter-side. The source and normalized artifacts retain the op106 provenance. Full raw-control/alias soundness remains the VM owner/reviewer scope.

The native codec requires an explicit native ABI, a global 32-bit field, exact null input domain, source evidence, bounded tables, unique nonzero portable IDs and unique odd ROM destinations. Zero maps to zero. Unknown input or observed output values fail; ordinary fields retain identity conversion. Source addresses never become callable host addresses.

Qualifier setup leaves portable fixture tokens in generated state and encodes values before original-memory writes. After original execution it decodes observed native global values before comparing them to generated state. This preserves comparison of every token output rather than ignoring the spill. All three splice markers occur exactly once in the current oracle template. These replacements depend on exact template spelling; future template edits must preserve or check those matches.

The concrete frozen candidate includes native ABI metadata; the earlier `local/ir/mashup-coverage/vm-ir/hp-root` adapter does not and would fail the codec admission guard. This review neither changes nor certifies native ABI exit/preservation semantics.

Read-only source/artifact inspection only: no tests, builds, native runs, ROM rehashing or broad campaign. Review elapsed and queue timing are unavailable.
