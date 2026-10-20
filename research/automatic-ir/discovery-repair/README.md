# Saved-project discovery repair, 2026-10-16

Both retained discovery failures were infrastructure failures: the queue selected empty round2 projects, rather than unavailable mechanics or incorrect program filenames. Their `idata/~index.dat` files contain `NEXT-ID:0`. The original round2 import/export processes timed out after 90 seconds before saving programs. Those receipts and the later 20261016T091004 lookup failures remain intact.

Read-only inventory found previously completed, saved programs in `local/re/experiments/20261016-corpus-decompile/shard-a/{driv3r,grand-theft-auto}/ghidra_project`. Original program names are correct. Their source-run ROM SHA1 receipts match the present ROMs. The parent granted an exclusive lease for these games; validation copied saved projects and opened only isolated copies, sequentially, with `-process`, `-noanalysis`, and `-readOnly`. No import or fresh analysis occurred.

The successful run is `discovery-repair-20261016T103136Z`, source commit `85e2139614e26e198b87bb92dadbd22de49da871`, macOS 27.0.1 arm64, Ghidra 12.1.4, Java 21.0.12.1. Compiler source hashes, ROM SHA256, retained receipt identity, commands, limits, stage timings and output references are in `latest-report.json`. Compiler sources were dirty and are therefore identified by content hashes as well as HEAD.

| Game | L0 exported | Static L1 candidates | Export process | Static census |
| --- | ---: | ---: | ---: | ---: |
| Driv3r | 167 / 169 saved | 16 | 12.070 s | 0.166 s |
| GTA | 547 / 800 selected, 864 saved | 64 | 11.318 s | 0.401 s |

Successful invocation total was 24.002 seconds. These stages are sequential. Exporter script time (8.257 / 8.552 seconds) is nested inside export process time and must not be added again. Copy time was 0.004 / 0.008 seconds. Queue time, build time and simulation time are unavailable or inapplicable; none is recorded as zero. Limits stayed at two ROMs, 900 seconds total, 45 seconds export script, 75 seconds export process, 45 seconds static census and 800 selected candidates. The existing exporter 128 MiB output cap also remained intact.

Driv3r retains two per-function decompile timeout failures. GTA reached the exporter output-byte cap at 547 serialized functions, so this is explicitly bounded partial discovery. Static candidates grant no native qualification, composable ports, or mechanics closure. All existing game incompleteness remains.

The initial isolated startup attempt `discovery-repair-20261016T103131Z` failed because the private Java home directory did not exist (0.373 seconds total); its reports and logs are retained. The validator creates that directory before launching after the fix.

Retained original failed lookup process times were 1.817 / 1.755 seconds. They ended before any exports; the successful repair does useful extra work on different saved inputs. These figures are diagnostic timings, not a comparable before/after performance improvement measurement. No same-input performance baseline was established, and no new CI/build stages or dependencies were added.

`queue-patch-packet.json` contains exact keyed item updates and append-only attempt/run records for `/root/compiler_shared_state`, the sole global queue/status writer. It preserves old failure attempts, pins the copied project/function inventory, and moves both games to `depth_pending` with zero qualifications. Apply only if preconditions still match, merge the bounded run policy from the live queue, and recompute aggregate status using existing tooling. No catalog promotion is justified by this packet.

The saved-project lease is released after successful validation and packet delivery. Original projects and retained failures were never opened by Ghidra or modified.
