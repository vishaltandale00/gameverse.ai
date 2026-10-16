# Game Space and executable Workshop

The application combines Vishal's neighborhood and browser GBA adapter with the 33-game research map and executable component builder. `npm run dev` serves the normal app on port 4173. `/` and `/v1` preserve Alder District and its FireRed arcade. `/v0?view=workshop`, `/v0?view=play` and `/v0?view=discover` open the collection's Mashup, Play and Explore views. Restart the Node server after server-module changes.

## Executable selection and generation

The Workshop reads the compiler's actual `generate.py --options` and executable ontology catalog. Movement, combat and progression selectors identify concrete packages and show their qualification, typed ports, units, dependency services, limitations and local availability. Changing a selector changes the submitted compiler request. Source-world chips follow the packages actually used; choosing an unsupported source world blocks generation with a reason.

The current qualified combinations include Sonic/Zero Mission, Aria/Zero Mission and Mario World/Sonic/Zero Mission movement; Zero Mission impact; and either Zero Mission equipment acquisition or Minish persistent inventory/skill derivation. This list evolves through compiler options, without frontend hardcoded presets. Storage-qualified records whose semantic adapters remain pending are not selectable merely because they appear in the catalog.

**Build & qualify GBA** persists a versioned request, context and server-resolved package hashes, then invokes the actual IR compiler and bounded native qualifier. The UI displays receipt phases, diagnostics, typed conversions, ROM identity, native final facts and actual PNG/MP4 artifacts. There is no simulated job status. **Add to Play** becomes available only after build and native qualification pass, verifies the ROM hash and explicitly registers the cartridge in normal collection Play. Existing cartridge/core/profile progress identity is retained. The v1 arcade remains FireRed-bound.

The clean-ROM world, input/jump policy, projectile/gate orchestration and graphics are explicitly authored IR around recovered executable mechanics. The current output is a bounded connected game slice, not an automatically reconstructed full campaign. Optional story/style choices remain collapsed creative notes; they are not executable packages or a natural-language planner. Similarity on the embedding map does not prove typed compatibility.

See [the operator runbook](OPERATIONS.md) for exact requests, CLI and HTTP interfaces, private package setup, time limits, native QA, bot/provider selection and model credentials. Deterministic IR generation and qualification need no model key. Static shell builds have no generation API or private cartridges.

## Explore and incremental research

Explore retains the library, graded component/portrait summaries and cached embedding views. Neighbor rankings use original per-view distances rather than positions on the 2D projection. Text axes may be unverified model recall; capture axes cover limited observations. Source-supported partial, observed and model-prior claims stay distinct. Raw pseudo-C counts and decompiler leads are not promoted into executable compatibility.

The development server watches canonical `ontology/games/*.yaml` and `ontology/portraits/*.json` metadata through the existing on-demand cache. `/research/status.json` reports freshness, counts and errors. The interface checks on focus/visibility and every 20 seconds while idle, preserving selections and notes, deferring while editing and skipping refresh during active GBA sessions. Failures retain the last successful snapshot. Embedding-map date is separate from source research date.

Source-only export uses existing PyYAML, retains embedding coordinates/rankings and makes no model call:

```sh
python3 scripts/export-research.py . --source-only
```

Set `RESEARCH_PYTHON` if the server's default Python lacks PyYAML. Static builds keep their last snapshot. Private ROMs, raw vectors, credentials, source checkouts, generated packages and recordings remain ignored local artifacts.

## Upstream alignment and focused evidence

The additive integration uses Vishal's `origin/main` at `b58ae3e`, including live/background voice feedback and arcade/geometry changes. It preserves collection navigation, source research refresh and current Play bindings. The pinned `ws` package is required by upstream's voice relay. Lean sources and its generated geometry kernel are retained; Lean was not rerun as part of this integration.

The actual application-to-compiler integration is recorded in [integration-qualification.json](research/ir-workshop/integration-qualification.json). A Sonic/Zero Mission/Minish request generated a new cartridge, passed traversal → 3 defeats → persistent learning → derived skill → gate → exit, then registered and verified as ready in the Play catalog. Compiler wall time was 0.591 s; application submission through qualification/registration/catalog verification took 0.861 s, including the compiler. Source pins in that receipt identify that run, before later small UI error-message/robustness changes. No browser gameplay test or paid model call was performed.

Focused selector/submission checks cover actual selection replacement, exact server package identities, unavailable source/adapter blocks, retained interrupted jobs and same-origin mutation enforcement. Upstream voice socket checks use mocked providers and require loopback access. Build and final contract measurements are recorded in the integration's verification receipt. No comparable pre-feature generation benchmark exists; queue time, CI time and visual/performance browser measurements for this integration are unavailable. Earlier browser and shell-copy observations apply only to their historical revisions and are not reused as present measurements.
