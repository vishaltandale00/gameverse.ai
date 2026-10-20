# Shaman automatic extraction continuation

Two own-ROM HighFunction subsets passed automatic L1 lowering and 256 native comparison vectors each:

- `0800064c`: held-input read, full u16 value.
- `08000e20`, source-observed `r0==1`: mask two scroll coordinates to nine bits and mark the shared BG1 record dirty. The domain comes from the camera caller's original `movs r0,#1` at `08021e68`.

[result.json](result.json) pins exact L1 and native receipts. [system.json](system.json) records the source-backed camera/pan subsystem, state references, call ordering, services and partial qualification. The full subsystem has not passed executable qualification.

Actual failures are retained under `local/ir/fleet-next/shaman-king-master-of-spirits/`: the general four-layer setter fails bounded collection classification; BIOS sqrt raises unsupported CALLOTHER; division reaches missing HighFunction `0805d81c`; magnitude, normalization and the camera root therefore remain blocked. The shared compiler owner has these reproducers. A targeted export permit/runner was requested for `0805d81c`; no JVM was launched by this worker.

Initial getter lift plus native stages took 0.209359 s. Source-observed layer1 lift plus native stages took 0.231153 s. These are measured private attempt wall times; receipt stages are nested and must not be added again. Other attempted lifts have separate measured failures in result.json. Full interactive time, queue time and a comparable before/after benchmark are unavailable. No manual behavior C, generated games, global catalog changes or whole-mechanic qualification claims.

Continue with the targeted division dependency and the compiler owner's proven generic BIOSsqrt service, then retry live-argument, return and caller-stack byref linkage before finite camera qualification.

EX036 follow-up exported exactly `0805d81c` in 3.418955334 s with the original project unchanged; the permit was released. The dependency is the own-ROM Thumb return leaf (`mov pc,lr`) and automatically lifted, with no semantic/native promotion. Division retry now reaches `loop CFG not yet structured`, replacing its previous missing-export blocker. Both failure stages are retained. BIOSsqrt service and camera ABI/byref/lifecycle closure remain open; no further export is currently identified for this bounded chain.
