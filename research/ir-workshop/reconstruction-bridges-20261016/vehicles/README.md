# Vehicle interchange case

No qualified full vehicle controller can currently replace Mario Kart's vehicle phase. The smaller Kart steering-recovery prefab remains useful within its documented boundary. NFS scene requests, Driv3r proximity allocators and GTA actor-list membership cannot satisfy the vehicle contract.

`bridges.json` supplies four source-specific rows to the full cross-game interoperability audit. All are explicitly missing implementation. The target's physical units, controller action decoding, complete canonical state and schedule are unresolved; no numerical/frame adapter can be justified from integer widths or genre alone. Camera and checkpoints remain host/source obligations beyond motion.

The bounded investigation did find actual NFS vehicle-support code beyond its previously documented menu/scene subsystem: caller `08020344` supplies four sample points to `08022ffc`, which transforms them, queries terrain and height, then updates nested per-point suspension state. These exact source records are retained here as analysis oracles. Only existing own-ROM L0 is compiler input. This is a contact/suspension phase, not a recovered throttle or steering controller.

The two actual automatic lift attempts both failed closed: caller `08020344` on unresolved callee `080247e8`, and `08022ffc` on cyclic SSA without an exact terminating induction proof. The receipt records 0.039541333 s total static wall time, including both nested attempts (0.0105055 s and 0.009088584 s). Queue, build and native times are unavailable/not run. No representative prior baseline exists, so no speed improvement is claimed. No dependencies, CI stages, games, ROMs or native campaigns were added.

Driv3r's source sampler `08004d08` genuinely computes ten-bit held/new-press state before `08004dd4`, but the shared compiler owner confirmed that a source-pinned explicit KEYINPUT/MMIO service boundary is not implemented. It must not be replaced by hand-written IR or presented as driving dynamics. GTA's on-foot/vehicle producer and mode boundary are not identified by its actor-list prefab.

The bounded two-root limit is exhausted. Next implementation work is a finite caller-specialized NFS contact closure with unchanged source loops, nested backing and terrain services, or repaired Driv3r controller source boundaries. Publication, semantic ports, Composer admission and original/native checks remain subsequent gates.
