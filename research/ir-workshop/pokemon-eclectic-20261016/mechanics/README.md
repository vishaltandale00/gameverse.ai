# Recovered foreign mechanics lowerer

`tools.prefab_pipeline.eclectic_strategy.generate_eclectic_source(root, native_types=True)`
returns `(C_source, C_header, metadata)`. `lower_eclectic_strategy(output_dir,
root, native_types=True)` writes `eclectic-mechanics.c`, `.h` and
`source-admission.json`. Compile exactly one C unit; the header is for consumers.
No dependency or CI job was added. Generation reuses the existing L1 validator
and lowerer, checks six exact package hashes, six exact finite qualification
receipt hashes and each receipt's behavior hash. It preserves original generated
arithmetic and immutable assets with mechanical symbol namespacing; one helper's
local declaration is hoisted to satisfy GNU89. Native types include `global.h` only and reuse its transitive `stdint.h`
definitions; duplicate aliases are forbidden by the actual agbcc compiler. Source emission defaults to `stdint.h` for host
checks. The consumer selects its own native compiler and lifecycle hooks.

The final host check passed seven checks in 0.209186 seconds process wall time
(0.170 seconds unittest time, nested). This included a fresh host C compilation,
a second native-header compatibility compile, all 50 retained independent FFVI
expected-field fixtures, packed mastery ownership distinctions, beam thresholds,
recovery/sentinel/exclusion/lethal cases, and chained kart steering/release/cap.
See `host-check.json`. No comparable predecessor timing exists. These are host
checks, not proof of a linked cartridge, native controller integration or campaign.
The first strict ISO C89 compile probe failed on required long-long constants
and a declaration-after-code; the final GNU89 compile checks the repaired
structural declaration. Long-long arithmetic is an original lowerer requirement.

## Calls and exact binding boundaries

- `GvEclecticKartStep(racer, demands, flags, bands[16])`: caller owns one ephemeral
  racer. Source demand `0x100` increases signed steering; `0x200` decreases it.
  This is an explicit adapter encoding, not a claim those bits name physical
  buttons. The original character-zero lane-zero profile is 2453/155/115/124
  (limit/reversal/increase/recenter). Original turn-drag coefficients and 1024
  signed trigonometric entries remain emitted assets. Source phases share one
  Q16 speed word via exact low/high splitting. The acceleration bands are a
  required explicit consumer input; no copied source character profile is
  fabricated. The source caps speed above `0x7e00000`, leaving other source
  arithmetic intact. The bridge's steering→drag→heading→speed schedule is an
  authored integration; the original whole racer scheduler is not recovered.
  Native Pokémon collision/movement still needs the consuming stage's adapter.
- `GvEclecticSkills(inventory[64])`: exact original two-bit ownership bank refresh.
  Inventory entries 72..79 map to bits 0..7 respectively; only ownership value1
  contributes. Item76 (`bank[19]` bits0..1) gives bit0x10; item79 (`bank[19]`
  bits6..7) gives bit0x80. Mapping Pokémon badge flags into these entries is an
  authored policy and allocates no persistent bytes here.
- `GvEclecticBeam(hp_u8, max_u8, learned_u16)`: returns15 when learned bit0x10
  and current equals max, else22 when learned bit0x80 and hp<=8, else0. Native
  Pokémon HP may exceed255; a documented projection must occur in the consumer.
  There is no source-derived Pokémon attack formula in this function.
- `GvEclecticHp(hp,max,damage,recovery,current_status,pending_status,excluded)`:
  exact FFVI resolved HP transaction runs in fresh actor-zero VM context and
  returns HP, resolved damage, pending status and lethal latch. `0xffff` is the
  original absent damage/recovery sentinel. Excluded suppresses eligible damage
  through original membership/exclusion gating. Recovery clamps to supplied
  maximum. Lethal transactions queue pending0x80 unless current status bit2 is
  set. These pending bits are not Pokémon status IDs or native faint commits.
  For a Rally reserve, pass current/pending status0 and consume only HP result.
  Examples verified: `(50,64,0xffff,1,0,0,0)`→51 and
  `(64,64,0xffff,1,0,0,0)`→64. Fresh scratch resets continuation on every call.

The lowerer emits no global mutable state or persistent storage. Allocations,
resource policy, badge mapping, source health projections, native battle effect
commit, input scaling and lifecycle resets are consumer responsibilities. The
separate stage must report its own actual source edits, build and play outcomes.

## Follow-up semantic review

`semantic-review.json` and `semantic-review-tests.txt` retain nine focused host
checks after adding packed fraction carry and signed braking coverage. The
original seven-check receipt above is retained as its own run. No recovered
algorithm changed. Source acceleration is an explicitly supplied signed band
shifted left8; bands128 add0.5Q16 and bands-512 subtract2Q16. Source flags bit0
forces positive0xc000 acceleration and is not a brake. The source has no lower
speed clamp: consumers must interpret signed speed before an unsigned upper
clamp. Steering demand alone changes turn/heading without lowering forward speed;
any corner braking profile is authored consumer policy. A consumer HP projection
must preserve native full-health equality: for maxHP>255, rounding non-full HP
up to255 must not activate the source full-health predicate.


## Actual agbcc alias repair

The first actual ARM compile at
`local/prefab-pipeline/pokemon-eclectic-stage-003/compile.json` rejected repeated
integer typedefs: its `global.h` already includes agbcc's `stdint.h`, and agbcc
does not allow the repeated declarations tolerated by the host compiler. Native
emission now includes `global.h` only, reusing its type/macro authority. The fake
header host check now models that transitive include. `native-header-repair.json`
retains the failure identity, new mechanism identity and passing nine-check host
run; actual native recompile remains with the stage owner.


## Actual agbcc constant repair and passing assembly

The next actual compiler run, stage004, exposed missing `UINT64_C` in agbcc's
otherwise usable stdint header. Native emission now supplies guarded `UINT64_C`
and `UINT64_MAX` fallbacks. Native wrapped constants are rendered as equivalent
unsigned64 hexadecimal tokens to avoid old-compiler decimal-unsigned warnings.
No recovered algorithm or asset changed. `agbcc-repair/compile.json` records a
passing actual preprocess→charmap→agbcc `-Werror -O2`→ARM7TDMI assembly sequence
with zero warnings, 0.136304 seconds total (stages nested). The exact object and
assembly are retained there, alongside the native source and reproduction script.
This is one translation unit, not a full ROM link or gameplay witness. Host
checks additionally exercise a stdint header missing both constant macros.
