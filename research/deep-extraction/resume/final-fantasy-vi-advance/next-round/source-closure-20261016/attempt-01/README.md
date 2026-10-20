# FFVI original status settlement: attempt 01

The published HP transaction and registered prefab remain immutable. This attempt targets the original next lifecycle responsibility: committing staged actor status and retiring pending requests. It has not yet produced a new executable or native claim.

The original caller `0808b4e4` is a ten-actor VM loop. Its retained source shows `0808bcf4` filtering pending requests, status-bit callback dispatch, `0808b9c0` applying current/request bits to staging, `0808bfdc` committing two canonical current-status banks, and `0808bca0` clearing four request banks. The callback tables and their actual VM control remain an unresolved dependency. The later `08078f74` current-status HP cleanup is distinct; its scheduler ordering is not proved here.

`0808bfdc` is the smallest meaningful closed source phase: original finalized staging bytes `020000fc..ff` become actor current-status bytes `02003ee4+offset` and `02003ef8+offset`. If staging bank one has KO bit 2, source instructions mask it with `0x4dfa` before commitment. The original commit preserves staging banks, mutates VM scratch/r8, and exits through r5. Directly connecting HP pending flags to this phase would skip original filtering/callback/application responsibilities.

`raw-span-request.json` pins seven exact source code spans and their ROM byte hashes. The split `0808bcf4` spans exclude its embedded literal pool. GNU Thumb disassembly is source boundary evidence only. Existing decompiler records are analysis oracles and never compiler input. Coordinator permit EX057 assigns the one saved-project raw export to discovery_path_repair; saved listing only, no function/context mutation or unapproved pseudo decoder fallback.

Private `build_commit.py` consumes actual raw p-code and calls existing `lower_vm_control`, then `lower`. Its generated behavior is never authored by this worker. A new raw lift and small original-versus-emitted native qualification are pending. Native ABI is explicit custom VM, fixed actor0, fresh continuation frame; full ten-actor scheduling and repeated battle execution are not claimed.

Timing: source inspection/disassembly wall time was not instrumented; queue/export/build/native values remain null until corresponding receipts exist. No build/native campaign or dependency installation has run in this attempt. Existing HP proof of 4096 vectors including 50 semantic fixtures is historical and is not counted as new status settlement evidence.
