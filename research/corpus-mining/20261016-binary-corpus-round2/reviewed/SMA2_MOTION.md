# Super Mario World: recovered native movement system

Own USA/Australia SMA2 ROM SHA1 `5101ddf223d1d918928fe1f306b63a42ada14a5e`.
No downloaded source, source substitution, browser testing or accepted save used.

## Closed component and native assembly

`sma2_normalize_motion.py` reconstructs an explicit-context implementation from
eleven reviewed functions in our existing Ghidra export. The closure contains the
whole ordinary horizontal controller (including acceleration, skidding, charge,
normal/spin jump initiation and character differences), vertical/cape policy,
gravity/cape helpers, ground effect and two-axis integration. The eight indirect
tail warnings are saved-LR returns, instruction-reviewed in `sma2-motion-tails.asm.txt`.
All coefficient bytes are pinned to the own-ROM window `08109e00..0810a5ff`.

Original fixed state is a wire format, not a generic prefab actor. Positions use
signed16 integer pixels and unsigned8 subpixels. Signed16 velocity retains its
acceleration fraction, but its signed high byte is integrated in 1/16px units.
Original wrappers integrate, resolve terrain/contact, then control and gravity;
the extracted operators must retain that order and one writer per phase.

`sma2-host-motion.c` uses a small stack context borrowing the exact original
player/input/engine/map/profile/scene objects and immutable tables. It does not
allocate BSS or pretend the original noarg functions receive an r0 actor. Real
audio remains the pinned original service; pure qualification exposes ordered
sound/context events. Terrain/collision, enemies, form acquisition, projectiles,
riding implementation, campaign and story remain host dependencies.

The shared backend consumes:

- `tools/composition/packages/mario-sma2-motion-host.json`
- `tools/composition/native/sma2-usa-motion.host.json`
- `tools/composition/plans/sma2-motion-parity.json`

It emitted a full 8MiB native ROM preserving the original 4MiB except the three
declared movement-entry hooks; native payload 2,984 bytes. No backend edits were
needed here. Original/native movement parity is a reusable-system milestone,
not a new mashup game or complete decompilation.

## Evidence and actual timing

All below ran locally on the same macOS arm64 environment, using clang ARM7TDMI,
libmgba HLE and existing native session bridge. Direct queue time unavailable.
Per-stage durations are nested in total; video encoding is nested in sessions.

| Run | Result | Measured wall time |
| --- | --- | ---: |
| `sma2-motion-policy-01` | 6,144 original-ROM vs C local cases | retained raw receipt |
| `sma2-native-motion-01` | same 6,144 original/C/emitted-Thumb cases; 12,288 combined native calls, 1,723,692 instructions | 0.603313s clean compile/link/oracle/execution |
| `sma2-motion-rom-01` | shared IR full-ROM build, 2,984-byte payload | 0.118189s clean build |
| `sma2-motion-gameplay-01` | stock/candidate hashes and images equal, but message block froze subsequent mechanics; spin witness missing | 0.332935s, failed qualification retained |
| `sma2-motion-gameplay-02` | stock/candidate equal, but left stage before spin; witness missing | 0.345878s, failed qualification retained |
| `sma2-motion-gameplay-03` | 117 natural frames: run, normal ascent and spin ascent witnessed; full player state and images equal | 0.309181s including two actual native videos |

Actual clip:
`local/re/experiments/20261016-binary-corpus-round2/sma2-motion-gameplay-03/candidate/playthrough.mp4`.
No numeric turnaround target chosen; no comparable prior SMA2 native package
existed. Receipts pin source commit, ROM, source and adapter hashes and limits.

Natural cape/riding/Luigi behavior remains unqualified even though finite local
branch comparisons include those contexts. No full campaign completion claim.
Next depth work: close terrain response and actual enemy interactions, then form
acquisition/abilities and exit/map progression.


## Accepted spin impact and reward progression

`sma2_normalize_spin.py` closes ten additional own-ROM functions: accepted
spin response, contact effect, character/input/riding bounce, terminal state,
particle allocation, chain rewards and reward pool allocation/overwrite payout.
Instruction review corrects two lost Ghidra ABI facts: `fc0c` consumes r0 actor;
`d804` returns the reward slot in r0. `sma2-spin-native-review.txt` retains
the original generated C and return epilogues. No opaque score/audio calls are
left in this local closure. The original upstream contact query/dispatcher stays
an explicit dependency.

The 4,096 original/C/emitted-Thumb comparisons pass, including slot exhaustion,
chain wrapping, selected life counters and pending reward overwrite payout.
Clean compile/link/oracle qualification: 0.538178s. Independent shared-IR spin
ROM build: 980 bytes, 0.111259s. Actual first-stage enemy native type0xbd was
spin-hit naturally: state8->4, timer31, player vy high-8 and chain0->1.
All52 frames of player/enemy/scene/engine/profile hashes and all rendered
observations matched stock versus generated ROM, 0.711544s including two videos.

The combined `sma2-movement-spin-parity.json` plan assembles both recovered
packages into the same full cartridge. Its four entry hooks preserve native
interleaving rather than invent a new scheduler. Shared velocity/traversal/effect
state names and phase writers make the overlapping authorities explicit. Payload
3,964 bytes; clean build0.154504s. The combined ROM repeats the actual52-frame
spin interaction with all state/image hashes equal, 0.703686s. This additional
probe qualifies a new composed artifact, not a repeated unchanged broad suite.

Canonical ontology now has four reviewed components and the portrait exposes
movement and combat pieces with component links. This remains a partial game
recovery: terrain sampler, general enemy ecology, form acquisition/projectiles,
campaign exits/story and cross-game adapters remain outstanding.
