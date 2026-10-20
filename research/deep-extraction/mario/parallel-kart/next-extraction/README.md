# Kart executable extraction continuation

`qualification-packet.json` pins three automatically compiled own-ROM HighFunction L1 subsets. `l2-contract.json` records their source-backed larger subsystem and remains `executable:false`; it does not promote partial helpers into full steering/contact/race mechanics.

- `0803ba98` steering recovery: 16,384 differential vectors passed (0.218792083 s qualification). A separate strengthened run passed 4,096 vectors including 672 independently expected threshold cases, 164 completion and 508 continuing cases (0.205971416 s qualification, 0.003201542 s L0 lift). Expected calculations are verification only; unchanged original HighFunction is compiler input.
- `08032c50` track coordinate bounds: 4,096 original/generated/native return comparisons passed (0.197144166 s qualification).
- `0803daec` turn recovery acceleration/phase finish: 4,096 original/generated/native comparisons passed (0.192384292 s qualification).

Actual native receipts include ABI, stack/register checks, source/harness identity, clean compile/link and nested native durations. Broad gameplay traces, complete caller legality and complete mechanic closure were not qualified. No generated games, compositions, GBA ROMs or new CI steps were made. Existing native oracle emits an ARM code blob solely for differential execution against the original ROM.

Outputs remain under `local/ir/fleet-next/kart/`. The reproducible strengthened script is `qualify_steering_recovery.py`; original failure records are `initial-attempts.json` and `closure-attempts.json`. `validation.json` validates 16 pinned artifact/contract hashes in 0.002961542 s.

Current compiler proves terminal pop/bx incoming-LR returns from original bytes; no re-export was necessary. Coordinator permit EX012 was released unused. Earlier span-versus-PC-envelope observations remain valid and do not establish complete function boundaries. Full steering is blocked by nested racer+174 ROM profile-pointer binding in `0803bb48`; the source producer `0803c1bc` stores `080ec300 + class*0x148`. Route and surface are blocked by nested track metadata references; larger acceleration policy still has unbounded ROM index. Compiler owner received exact failure traces.

Next work: bind profile pointer through the evidenced producer without substituting C or patching HighFunction, link `0803bc00` with `0803ba98` and `0803bb48`, then qualify actual full steering order and threshold cases. Resolve canonical track pointer tree before connecting contact. All existing resource caps remain. Queue time and representative before/after build comparison are unavailable; no performance-changing build system was introduced.
