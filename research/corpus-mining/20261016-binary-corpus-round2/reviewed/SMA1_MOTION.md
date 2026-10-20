# SMA1: SMB2 character motion recovered from our ROM

Own USA/Europe ROM SHA1 `f071d45d8f5cb05b48d7d2b804c6cb6a79ad96fb`.
This package targets the main Super Mario Bros.2 engine. The bundled Mario Bros
minigame has different objects/input paths and is deliberately not conflated.

Six complete local operators are recovered through `sma1_normalize_motion.py`:
character-configured jump onset, gravity/finite hover, grounded friction,
charged-jump phase decay and horizontal/vertical carrier integration. The pure
operator context owns explicit player/profile/entity/character-coefficient/input
state. Native adapters borrow the original objects, use four noarg entry ABIs and
two original r0 actor integration ABIs, and allocate no mutable globals.

These components are intentionally parts of a controller. The original game
still produces jump permission/crouch charge, acceleration, ground contacts,
carry/throw state and stage progression. Calling the jump operator is not proof
that a takeoff is allowed in an arbitrary target engine.

## Native qualification

All runs used existing clang ARM7TDMI/binutils, libmgba HLE and isolated native
session bridge on the same macOS arm64 machine. No browser or accepted player
save was touched. Queue measurement unavailable; clean builds, no cache. No
earlier comparable SMA1 component build existed for a before/after comparison.

| Run | Result | Measured wall |
| --- | --- | ---: |
| `sma1-native-motion-01` | 6,144 original-ROM/C/emitted-Thumb finite cases | 0.293756s including clean compile/link/oracle |
| `sma1-motion-rom-01` | shared IR built full native ROM, six hooks,1,220-byte payload | 0.110136s clean build |
| `sma1-motion-gameplay-01` | four natural Mario/Peach episodes, all390 frames per implementation and rendered observations match | 1.067503s including eight native videos |

The six saved-LR returns are retained in `sma1-motion-tails.asm.txt`. Instruction,
table, source and adapter pins live in lift/qualification/build receipts. Pure
finite context combinations are not a proof of universal reachable states.

Actual character selection confirms Mario native selector0 uses parameters
`08368838`, Peach selector1 uses `08368880`; do not infer the character ordering
from adjacent ROM record order. Mario hover duration is0; Peach duration48.
Both records use ordinary gravity increments7/4, so the distinctive observed
Peach behavior comes from the finite held-jump hover branch.

From the same private native cloud platform at y272px, Mario's ordinary held
jump reaches y219.5px. Holding DOWN60 frames then jumping reaches y184.25px.
Peach's held jump decrements the hover counter48->0 and is still y221.75px on
sample45; tapped jump has landed at y272px. Stock and component-built ROM have
identical full player state and rendered observations in each episode.

Actual clips are in
`local/re/experiments/20261016-binary-corpus-round2/sma1-motion-gameplay-01/`,
including `mario_charged-candidate/playthrough.mp4` and
`peach_held-candidate/playthrough.mp4`.

## Composition meaning and remaining depth

`tools/composition/packages/mario-sma1-motion-host.json` plus the exact native
host and plan are schema-valid and source-pinned. The native velocity scale is
not interchangeable with SMA2/SMA4: position is signed32 16.16pixel and each
integration adds arithmetic-shift-right4(velocity+carrier). Original profile
wrap and selected carried-object boundary conditions remain explicit inputs.

Canonical ontology now has two gameplay components and a human movement piece.
Input acceleration/charge production, carry pickup/throw, terrain sampling,
enemy combat, health, stage progression/story and natural Luigi/Toad/wrap/carrier
witnesses remain required depth work. No complete decompilation or mashup claim.
