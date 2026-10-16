# Basic native improvement handoff

This branch supplies the standalone local API, agent client, bounded native recipe dispatch, native compiler and focused synthetic checks. Run from the checkout with Node 22+ and Python 3; no npm install, model account or frontend build is required:

```sh
node scripts/serve-improvement.mjs
```

Inspect `http://127.0.0.1:4175/api/improvement/capabilities`. A fresh checkout intentionally reports unavailable native recipes: the original cartridge and the exact local recovery evidence are not distributed. The API is runnable independently; producing an actual candidate additionally requires the provider inputs and native toolchain below. Vishal owns environment integration, navigation, saves, acceptance and activation. This worker returns candidates only. See [the API contract](IMPROVEMENT_API.md).

## Install exact local provider inputs

An authorized existing working checkout can act as the provider source. The checked-in manifest lists each required path, size, hash and recipe membership; it contains no payload. Verify all source inputs first, then explicitly install missing matching files into this checkout:

```sh
node scripts/improvement-provider.mjs --manifest contracts/improvement-provider-pack.json --source /path/to/authorized/working-checkout --check
node scripts/improvement-provider.mjs --manifest contracts/improvement-provider-pack.json --source /path/to/authorized/working-checkout --install
```

The importer refuses traversal, symlink escapes, stale source pins and conflicting existing target files. It preserves matching existing files. The source must contain the exact user-provided USA Aria cartridge and matching reviewed provider files; a different ROM revision or an arbitrary internet download is insufficient. Local provider material must remain local. Recheck capabilities after installation and keep backend admission errors visible.

Native compilation uses `cc` with Clang's ARMv4T target support plus `arm-none-eabi-ld`, `arm-none-eabi-objcopy` and `arm-none-eabi-nm` on PATH. Double-XP qualification also requires mGBA development headers/library, ffmpeg and the built session bridge (`make -C tools/re/session`, with `MGBA_PREFIX` configured for your machine). The existing Double-XP oracle currently assumes the Homebrew `/opt/homebrew` mGBA prefix; using another installation needs a reviewed portability change. Soulstride candidate construction does not run that qualification stage.

## Public source and private evidence boundary

The public subset consists of project API/transport, validation, compilation, authored strategy-lowering and exact-host adapter generator source; synthetic tests use invented bytes and fixture plans. It contains no ROMs, game art/audio, save files, native binaries, model keys, generated game output or wholesale decompiled source trees. Hashes, native addresses and recipe metadata identify dependencies; they do not distribute those dependencies or certify permission to redistribute a provider pack.

Recovered game policy/source and assembly evidence stay in the external local provider read set. The generator and manifest retain their file identity and classification rather than relabeling them as redistributable assets. The host adapter generators use explicit versioned native addresses/offsets and fail when reviewed evidence pins differ. Neither recipe establishes full-game IR recovery, full-campaign equivalence or safe save migration. Soulstride is build-only here; Double-XP is a separately requested bounded qualification.

## Focused validation and timing

```sh
node --test tests/improvement-api.test.js tests/improvement-provider.test.js
python3 -B -m unittest tools.composition.test_native_build tools.prefab_pipeline.test_contract tools.prefab_pipeline.test_mod_rom tools.prefab_pipeline.test_native_mod.RegisteredStrategyTests
```

In the clean isolated checkout on 2026-10-16, nine Node checks passed with no skips (latest post-fix runner duration recorded in the portability receipt), and 35 Python synthetic contract checks passed (63 ms runner duration). These check source/admission/receipt integrity without ROMs, compilers, emulators or model calls. No CI job, dependency or test matrix was added. There is no prior API baseline or remote CI queue/job timing; those measurements are unavailable. Actual backend build timing remains separate from transport execution and nested stages must not be summed twice.

The isolated provider bootstrap was also exercised against the existing authorized working checkout: 60 declared files validated, missing inputs installed, and the narrow Soulstride CLI produced the same candidate SHA-256 as the original checkout. [The portability receipt](../verification/improvement-handoff-20261016.json) records 0.347796 s total backend time with 0.291864 s nested native build time on macOS arm64. This was one candidate construction check using the already installed toolchain; no independent gameplay qualification was added. Provider inventory generation only hashes/reads existing files; it does not run native or model checks.
