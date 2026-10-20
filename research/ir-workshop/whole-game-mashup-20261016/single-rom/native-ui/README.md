# Single-ROM native UI source port

`tools/whole_game/single_rom/native_ui.py::stage_native_ui` stages real providers into an isolated Emerald source tree. Canonical `local/decomps` inputs remain read-only. It returns the provider override ledger consumed by `native_services`; source staging does not certify a playable campaign.

The current stage has **50 source-ported providers and 7 delegated providers**. The seven delegated requirements belong to the region-map and quest-log owners. The ledger lists their exact imports and contains no unassigned UI provider; the stage never generates empty functions, invented success returns or private text buffers that the real script interpreter would not read.

## Implemented responsibilities

- Donor nickname, gender text, move-deleter nickname/move and TM/HM move buffers; donor TM move lookup table; exact Seagallop number branches; field message invocation. The son/daughter branches preserve the donor source exactly. Source checks pin common StringCopy/StringGet_Nickname implementations and gender text. A compile-time item-domain check protects the donor TM/HM range.
- One actual shared Emerald PC, mailbox/item and Pokemon storage engine, following the architecture owner's shared-native-engine policy. `BedroomPC`, `PlayerPC`, storage entry and the capture-owned destination-box getter bind real host services. The ledger records host source identities, observable storage/context/lifecycle responsibilities and the limit that exact donor artwork, decoration choices and quest-log hooks are not asserted.
- Donor PC menu: native window creation, Oak/Bill labels, namespaced Kanto progression flags, player-name formatting including the donor's five-character branch, task input, select/cancel result, script resume and teardown. The generic multichoice callback is specialized to the PC caller's constant `MULTICHOICE_NONE`; unreachable cable-club description/delay branches are omitted. Exclusion against another owner's concurrently active generic multichoice task remains unqualified.
- Complete donor help-message window source with create, text drawing, tile upload and teardown. Original PNG/palette assets are staged. Native start-menu window identity is shared with the actual host start menu. Host window-system initialization resets donor help window ownership.
- Signpost mode has its real donor set/clear/get storage and an actual host field-message renderer consumer loading donor signpost tiles/palette. Donor menu/std frame graphics and standard palette loaders also support the Oak tutorial renderer. Quest-log recording/playback state persistence and signpost cancel-on-walk/NPC-facing policies remain separate owner obligations.
- Oak tutorial party: all eleven donor task callbacks, exact voiceover window/text, palette fades, text-printer waits, window teardown and return to ordinary party input. Host battle-party and in-battle-item entry route through this sequence only for the dedicated FireRed tutorial mode. `FR_FONT_MALE` is a required native donor font extension, not a normal-font alias. Controller flag state and font installation are separate providers.

- Regional {RIVAL} placeholder expansion now reads the actual named Kanto rival, preserving original donor GREEN/RED defaults and the original May/Brendan branch in Hoenn.
- NPC font/color selection: exact donor packed object-graphics color table and context selector use the real selected object and explicit text-color override. Dynamic donor graphic variables read the Kanto bank; live graphic IDs remain donor raw IDs according to the object-bank owner's contract. Actual field-input processing resets the text context/signpost mode before it selects a trainer or NPC. Donor-only callers must retain donor graphics identity.

- Original museum fossil UI: Kabutops/Aerodactyl sprite sheets and palettes, asynchronous wait/open/close tasks and source teardown. Original Seagallop menu preserves origin/page/other/exit/cancel and selected-destination branches. Both call the real quest-log display policy, which remains a separate required provider.
- Full original elevator/ListMenu subsystem: floor, scroll and cursor state is shared by initializer and actual list task; native select/cancel/suspend/resume/free/window teardown; original camera shake, sound symbols and elevator metatile animations. Unified dynamic-warp map constants derive from the actual donor map manifests plus the native group count. The donor ListMenuItem `label`/`index` fields adapt to typed native `name`/`id` fields; callback `struct ListMenu` remains its real native type.
- All remaining text buffers: source-identical consume-once union-room name; source-equivalent hobby/lifestyle choice after exact word-sequence checks; typed shared eReader records with the donor's original 18-character wrapping criterion, not Emerald's pixel-width substitution; original fan-club member/link-name/language formatting with the campaign-owned rival-name accessor.
- Original Hall-of-Fame PC fade/wait entry binds the actual shared native saved-record viewer. Kanto return opens the original donor PC choices. Championship/credits endings belong to the progression owner.
- Exact donor dialogue geometry and printer parameterization are exposed to donor screens. Kanto field messages consume original context male/female fonts, colors and one-pixel spacing; normal/signpost/quest-log frames use real donor resources and the real quest-log playback state.

## Emitted source and integration

- `src/firered_native/ui_services.c`
- `src/firered_native/ui_help.c`
- `src/firered_native/ui_pc_menu.c`
- `src/firered_native/ui_npc_text.c`
- `src/firered_native/ui_elevator.c`
- `src/firered_native/ui_text_buffers.c`
- `src/firered_native/ui_hof_pc.c`
- `include/firered_native_ui.h`
- donor help/signpost/menu/std frame assets and palettes below `graphics/firered_native_ui/`
- staged patches to `src/menu.c`, `src/field_message_box.c`, `src/party_menu.c`, `src/field_control_avatar.c`, `src/easy_chat.c`, `src/hof_pc.c`, `src/string_util.c`

The state, script, font and tutorial-controller stages own their respective constants/mode/font/state providers. Region-map owner now owns the original `ShowTownMap`/`InitRegionMapWithExitCB` closure; this ledger conservatively leaves its service unresolved until that provider ledger is consumed centrally.

## Verification and limits

Run `python3 research/ir-workshop/whole-game-mashup-20261016/single-rom/native-ui/verify.py` from the repository root. The bounded check stages sources, runs twelve focused source-contract checks and checks all seven emitted units plus all seven patched units with clang targeting ARM7TDMI against actual Emerald headers. The generated map header is reused from an existing pinned staged Emerald build.

The `verify.py` IDE `INCBIN`/`INCGFX` macros and external font-ID definitions are syntax-check placeholders only. A subsequent **actual agbcc/ARM assembler check passed all seven emitted units** using real charmap, font IDs and INCBIN assets from retained build `20261016T172517Z-f18dcc9a1daa`; see `agbcc-ui-providers.json`. That check took 0.415 seconds of preprocessing/compilation/assembly, 2.318 seconds including fresh source staging. `verify_agbcc.py` reproduces it without modifying the retained build. Patched native engine units remain separately ARM-syntax checked. **No integrated link, successful ROM build, emulator run or gameplay certification was performed by this UI track.** Runtime UI/input/teardown and all remaining campaign services remain unqualified. Quest-log capture/playback cannot bind wholesale donor flags/vars to Emerald's structures; Kanto banking and dedicated persistent scene storage remain blockers.

Latest measurements are in `verification.json`, with exact source hashes, command, source commit, toolchain, unavailable queue/build/baseline times and preserved descriptions of failed checks. The last run took 4.069 seconds: 1.857 seconds staging, 0.208 seconds ARM syntax checking and 1.973 seconds tests. No comparable pre-change baseline or turnaround improvement is claimed.
