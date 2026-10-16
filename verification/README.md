# Collision and camera verification

This work adds a Lean-proved geometric acceptance kernel to the actual V1 game.
The existing floating-point sweep and camera calculations propose results. The
game commits player motion and final camera coordinates through the generated
kernel and its exact-arithmetic JavaScript bridge.

## What the proofs establish

`Geometry.lean` proves a separating-plane certificate sound for a ball swept along
an affine segment against an axis-aligned box. It covers every rational segment
parameter and rational obstacle point using homogeneous integer coordinates,
not just the endpoints. In the player check, the height dimension is flattened to
give the existing circular XZ footprint. The camera uses a three-dimensional ball.

`Kernel.lean` defines the executable acceptance expressions, proves their
translation into a restricted JavaScript BigInt expression model preserves their
meaning, and connects acceptance to geometric separation and player bounds.
`Generate.lean` prints the JavaScript implementation from those same definitions.
The generated module is `src/neighborhood-certified.generated.js`.

The actual integration is:

1. `src/neighborhood-math.js`: `proposeMoveWithCollision` is the original numerical
   sweep. `moveWithCollision` passes its proposal through `certifyPlayerMove`.
2. `src/neighborhood-safety.js`: validates numeric inputs, decodes finite IEEE-754
   values into exact integers on a 1/65536 metre grid, rounds obstacle bounds and
   radii outward, and world bounds inward. A successful separating certificate is
   required for every static proxy. Returned grid coordinates convert back into
   JavaScript Numbers exactly within the supported coordinate range.
3. `src/neighborhood-controller.js`: checks the final camera position **after**
   trigonometry, distance smoothing and target-plus-boom arithmetic, then uses
   precisely the certified position and target in `position.set` and `lookAt`.
4. `src/neighborhood.js`: revalidates camera clearance when resizing and uses the
   existing visible failure/recovery state if no safe result can be produced.

Normal movement has a swept-path guarantee when the prior committed grid pose is
safe. Recovery from an already invalid pose is explicitly different: a recovery
may end at a certified safe pose, but has no non-intersection claim for the jump
from the invalid starting point. Camera failure stops rendering instead of
committing a rejected position.

## Assumptions and trusted boundary

The proof is an exact **rational-coordinate geometry** result. Every finite
IEEE-754 value and committed grid point has a rational representation. This
project does not contain a separate formal development of real-number density,
the JavaScript engine, Three.js, GPU rasterization, or the correspondence between
every visible mesh and its collision proxy.

The explicit trusted code boundary includes:

- Lean's kernel and its standard logical axioms (`propext`, `Classical.choice`,
  `Quot.sound`). The checker rejects other theorem axioms, including unfinished
  proofs and native-evaluation axioms.
- The small syntax printer for the proved JavaScript expression model, and the
  JavaScript engine's BigInt, comparison, array iteration and DataView semantics.
- The audited JavaScript numeric bridge: IEEE decoding, conservative rounding,
  proxy/argument correspondence, coverage of every proxy, and selection/fallback
  control flow. These are **not** secretly assumed to have been proved in Lean.
- The controller and renderer integration described above. Source fingerprints
  identify the precise checked/audited implementation; a fingerprint alone is
  not a proof of its semantics.

`Math.sin`, `Math.sqrt`, `Math.exp`, and the old sweep are outside the proof. Their
outputs can suggest a candidate or a separating normal, but cannot bypass the
exact acceptance check. A missing witness can reject safe motion; completeness,
animation quality, camera aesthetics and friction feel are not proved.

Static proxy caching is permitted only for frozen arrays of frozen descriptors.
Mutable adapter/test geometry is re-encoded. Supported inputs must be finite and
within ±32768 metres, proxies must have ordered bounds, and radii must be positive.
The grid spacing is about 0.0153 mm. The sweep adds a small proposal margin to
avoid visible sticking from conservative grid rounding.

## Run the checks

Use Lean **4.35.0**. This workspace has an official Apple Silicon toolchain at
`local-data/lean-verification/lean-4.35.0-darwin_aarch64/bin/lean`; it is ignored and
is not shipped with the browser game. The official release archive used here has
SHA-256 `c0c6f34f35ba1dcc5c4a5fd106fefab9eb5e8469712624dd2c868d51b63177c2`.
Other machines can install the pinned toolchain with their usual Lean setup or
download it from [the official release](https://github.com/leanprover/lean4/releases/tag/v4.35.0).

```sh
npm run verify:geometry
# With a different local Lean location:
node scripts/verify-geometry.mjs --lean /absolute/path/to/lean
```

The command compiles fresh proof modules under ignored `local-data`, rejects Lean
warnings and nonstandard axioms, regenerates the kernel, and byte-compares it with
the module imported by the game. It writes stage durations, diagnostics, source
hashes and outcome to `local-data/lean-verification/latest.json`. Each stage has a
finite timeout (default 60 seconds; configurable with `GEOMETRY_VERIFY_TIMEOUT_MS`,
at most 300000 ms).

After intentionally changing the verified definitions, review them, regenerate
with `--write`, then run the check again. `--runtime /path/to/temp-copy.js` supports
a negative source-drift check without editing the live game. `--report` selects a
separate report path for that experiment.

This is an on-demand qualification command. Routine Node test discovery is scoped
to `tests/*.test.js` so local toolchains and saved snapshots are not scanned.
There is no extra CI job, routine
build stage, npm dependency, Mathlib dependency, or browser-side Lean runtime.
The existing Node tests and browser route checks complement the proofs; they do
not enlarge the formal guarantee. Measured timing and acceptance evidence are
recorded in `research/slice2/lean-geometry-checks.json`.
