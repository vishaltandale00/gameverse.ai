# Read-only source observation profile

`profile.json` pins the final FireRed and Emerald ELF hashes and addresses for
source-owned field and UI state. `generate.py` extracts every named function
entry from those exact ELFs into the two `*-functions.json` indexes and checks
all listed data symbols. A callback or task pointer can be labeled only after
clearing its Thumb bit and finding an exact entry in its own ELF index. A
nearest-symbol guess is not evidence that the callback has entered that
function.

The most useful field observation is the live player object:

1. Read `gPlayerAvatar.objectEventId` at offset 5.
2. Require it to be below 16. Read that entry from `gObjectEvents`, stride
   `0x24`, and require both `active` and `isPlayer` bits.
3. Read signed little-endian tile `currentCoords` at entry offsets `0x10` and
   `0x12`; `previousCoords` at `0x14`/`0x16`, facing direction from the low
   nibble at `0x18`, and avatar transition state at offset 3.

`gSaveBlock1Ptr` holds a pointer to regional save state. Its `pos` at offsets
0/2 and `location` map group/number at 4/5 are source save coordinates and
map identity; `pos` must not stand in for moving object coordinates. The
`gMapHeader` copy supplies source map type and region map section once a field
map is loaded. `gObjectEvents` gives visible/active event locations and IDs;
this profile does not claim an externalized collision or walkability map.

`gTasks` has 16 entries of `0x28` bytes. An active task's function pointer and
its signed `data[16]` come from original source execution. These, together
with `gMain.callback2`, distinguish actual source phases more usefully than a
callback label alone: `CB2_MainMenu` can contain a long professor introduction.
The text-printer array has 32 entries of `0x24` bytes. Its active and render
state bytes distinguish printing from waiting, but an input-readiness claim
also needs relevant task and script context. `sLockFieldControls` and the
source script-context status are available as direct read-only symbols.

The source declarations and final ELF symbol sizes agree on the important
array strides: `gObjectEvents` is `0x240` bytes for 16 objects, `gTasks` is
`0x280` bytes for 16 tasks, and `sTextPrinters` is `0x480` bytes for 32
printers in each build. The offsets come from the pinned source structs in
`include/global.h`, `include/global.fieldmap.h`, `include/main.h`,
`include/task.h`, and `include/text.h`. The profile generation performs no
native gameplay, source patch, build, or controller action.

The native 100-byte Pokémon slots are encrypted. This profile exposes party
count and array address, but does not label species, HP, or experience from a
guessed raw decoder. A consumer should use the validated source bridge export
or prove a separate source-compatible decoder before showing those fields.
Before the first field map is loaded, map/player coordinates are unavailable;
consumers should report that condition explicitly.
