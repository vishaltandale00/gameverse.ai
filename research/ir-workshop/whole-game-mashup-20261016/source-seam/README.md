# FireRed ↔ Emerald source seam

This seam is installed only in isolated build copies by
`tools/whole_game/source_bridge/install.py`. The canonical
`local/decomps/{pokefirered,pokeemerald}` trees are untouched. It adds one
versioned EWRAM mailbox at ELF symbol `gWholeGameBridge` and the same travel
conversation to the gentleman in Viridian City's or Oldale Town's Pokémon
Center. The original overworld, battle, map scripts, renderers, menus, party
storage, and region saves continue to run in their own ROMs.

The player confirms travel through the source field script. After that script
releases, the source field callback validates and exports the active party and
trainer identity, and then freezes at `EXPORT/READY`. The host may read the
648-byte mailbox and save the frozen source scene. A destination `IMPORT`
replaces its current active party after validation. Each region retains its
original map flags, story progression, badges, Pokédex, bag, PC collection,
and save. The active six traveling Pokémon are shared. The player can use the
original PC before travel to choose them; there is no host-created substitute
party or rewritten source battle logic.

On the first arrival in a new region, `BOOTSTRAP` validates a zero-party
identity payload against an empty native save and arms the original title
flow. The player then completes that ROM's native introduction, including
FireRed rival-name selection and its starter story. The hook after the
original `NewGameInitData` applies shared trainer ID, name, and gender before
map load. When the native starter is present at a safe field scene, the
mailbox reports `MERGE_READY`; `MERGE` can append the traveling party if the
combined count is at most six. This retains the new region's source starter.
If there are already six travelers, the crossing waits for the player to use
the original PC to choose at most five. Later arrivals use `IMPORT`.

The 100-byte party slot preserves personality, original trainer ID/name,
nickname, language, markings, encrypted species/item/experience/moves/PP,
EVs/IVs, friendship, Pokérus, met data, ribbons, ability, status, HP, level,
and battle stats. The bridge validates the native encrypted 48-byte checksum
before calling `GetMonData` on a private copy. It rejects bad eggs, unsupported
species/moves/items, reserved item IDs, Enigma Berry (whose payload is stored
in region-local save data), Deoxys (whose form/stats depend on game version),
and mail index ownership. It never
silently drops a field. `compatibility.json` records equal named IDs for all
413 species, 355 moves, and 259 common ordinary held-item positions, and
equal secure struct declarations after normalizing aliases/comments. Both
source games also use this layout for Gen III link trade: FireRed's
`src/trade.c` copies `sizeof(struct Pokemon)` chunks at its send/receive
boundary; Emerald's trade source accepts FireRed/LeafGreen game versions.
The source C asserts `sizeof(struct Pokemon)==100` and mailbox size 648.

The mailbox wire layout and commands are pinned in
`tools/whole_game/source_bridge/manifest.json`. Every import checks its FNV-1a
payload digest, identity, region, schema, and increasing sequence before
mutating the source party. `BOOTSTRAP` also checks the native save is empty
before the source new-game path can run. Host-side region checkpoints and
rollback must bracket export/import so a failed transfer leaves both scenes
unchanged. Source errors remain in mailbox status/error for the host to show.

The regional Pokédex remains source-owned and unchanged by party import or
merge. Imported species are usable/carryable as native Pokémon, while each
region's seen/caught records continue to reflect that region's own source
encounters, gifts, and trades. This policy does not grant badges, National
Dex eligibility, or field access in the destination.

This is the source seam, not a campaign completion claim. The source build
receipts, native session handoff, and the full original-game campaign checks
are separate qualification evidence. No recurring CI or broad matrix is
added; the paired source build is an explicitly triggered qualification run.
