# ROM-first corpus mining

`20261016-binary-corpus-round2/campaign.json` is the retained queue and live
per-ROM result ledger. It schedules **all 32 indexed games except Sonic Advance**;
Sonic has a separately owned direct-ROM investigation. Neither existing community
source availability nor the existence of an ontology YAML gates the campaign.
No source repositories or ROMs are downloaded by these tools.

The first pass uses one Ghidra JVM, 2 GiB heap, two analysis CPUs, one decompiler
worker, three seconds per function and a 90-second hard process cap per ROM.
The total configurable process-stage budget is 3,600 seconds. The original
campaign is not restarted when an agent turn is interrupted. Each completed or
failed ROM updates its portrait's `coverage.research_progress`; canonical mechanic
records require a separate semantic review. `campaign.json` contains measured
stage/run context. Queue time is unavailable for direct local invocations.

The separate `20261016-binary-corpus-repair-retry` local experiment retries the
early capped Driv3r/GTA runs with the saved-LR heuristic and incremental journal.
The original failed runs remain intact. A heuristic CFG repair is not semantic
verification or a recovered ABI. The retry reserves at most the second global
JVM slot, with the same heap/function/process caps.

`frontiers/` follows actual decompiler KEYINPUT expressions through assigned
native RAM locations and getter calls to candidate state consumers. Exact native
addresses, export/C hashes, caller/data references and unresolved dependencies
are retained. Labels remain address based. A promising branch or field does not
become a named player mechanic merely because of a game title. The frontier
watcher scans each newly completed export once; it makes no provider calls and
does not rerun emulation. Its per-ROM scan durations are retained in
`frontiers/status.json`.

`reviewed/` contains instruction-reviewed local operators, independently recovered
C, exact native differential drivers and timing receipts. Native qualification
executes the indexed ROM's actual Thumb instructions against isolated synthetic
state, then compares the complete affected records with the recovered C. These
finite vectors establish a local operator result, not valid gameplay reachability,
whole-game equivalence, a completed campaign, or successful game composition.
The current new canonical seams are Dragon Ball input edges/repeat, FF I/II list
selection, Shaman King background scrolling and Tekken pair-box separation.

There are deliberately separate grades for generated pseudo-C, reviewed native
instructions, local isolated dynamic equivalence, and gameplay-confirmed semantics.
Recovered C can still need ABI, field/actor identity, numeric-domain, clock,
resource ownership, data/asset closure, relocation and compiler-lowering work.
Full movement/combat/progression systems, story/event graphs and strategy/skill
coverage remain open for much of the corpus. Function counts do not measure
whole-ROM or whole-game completeness.

If an existing process has actually ended before reaching the remaining queue,
the explicit resume command is:

```sh
python3 tools/re/ghidra/corpus_campaign.py \
  --campaign-id 20261016-binary-corpus-round2 --jobs 1 \
  --rom-timeout 90 --total-budget 3600 --resume
```

This retains attempted outcomes and continues unattempted games. Do not run it
alongside the original live campaign. The independently restartable frontier
watcher is:

```sh
python3 tools/re/ghidra/mine_input_frontiers.py \
  --campaign-id 20261016-binary-corpus-round2 --watch
```
