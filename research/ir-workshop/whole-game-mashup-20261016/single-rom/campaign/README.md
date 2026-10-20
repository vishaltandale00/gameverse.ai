# Single engine native campaign source integration

`tools/whole_game/single_rom/campaign.py` exposes `stage_campaign(base, donor, output, report_dir=None)` as the final isolated source stage. It refuses canonical paths and repeated application. The coordinator retains its explicit build gate.

Original Emerald remains the beginning: truck/house/Birch starter/Route 103 rival/Pokedex. A native guide at Littleroot (9,15) opens travel after the original Emerald Pokedex flag. Travel is an ordinary engine `warp MAP_FR_PALLET_TOWN, 8, 12`; the reciprocal Pallet guide at (8,13) warps to Littleroot (9,14). There is no second emulator, profile bootstrap, second bag, or parallel party.

First arrival extracts every original `EventScript_ResetAllMapFlags` instruction (49 flag sets and the massage cooldown var=500), all renewable hidden-item initial flags from the actual source table, and donor-only unused RSE compatibility var/flag. It seeds the donor encounter RNG once through its actual owner's helper. A durable marker in the appended PC storage distinguishes first arrival from revisits. The original full `NewGameInitData` is never called because its party/PC/bag/trainer resets would destroy shared progress. The unused donor Pokedex compatibility byte is explicitly excluded from the shared Emerald Pokedex. Unsupported donor non-flag structures remain blockers.

The first travel also asks for Oak's grandson's name using a dedicated native naming template. It preserves FireRed's seven-character name, native keyboard, title, and a source imported Blue sprite. It never invokes Emerald's PLAYER naming template, whose exit reseeds the trainer ID. Blank confirmation/allocation failure cannot advance the script. The native return callback resumes the waiting travel script. This is a concrete native UI adaptation; rendered/native confirmation remains unqualified.

Kanto starts through the original Pallet Route 1 Oak trigger, lab choice, rival and parcel sequence. Oak's gift retains the original chosen species and donor starter variable. Before any gift-related object/flag mutation, it requires a free party slot and remembers the existing party count. The normal native `givemon` appends to that slot; the original nickname call now targets that slot rather than party[0]. The original rival choice/roster branches and postbattle heal/scene updates remain. Imported starter helpers read the donor starter variable. The early-rival battle dispatcher is an explicit runtime obligation owned outside this stage; no tutorial skip/NOP or fabricated win is substituted.

In the middle, either campaign's party, PC and bag can support the other. Badges, defeated trainers and story vars remain regional. Guides stay available throughout both stories and after either regional league ending. No badge, money, story completion or item is granted by travel. Completing a league must leave the other story's flags untouched; actual ending/save/reload/blackout/fly qualification is still required.

Six focused checks passed in **0.197 seconds**, including actual generated initializer C compiled and executed on the host. They cover source drift rejection, all sourced flag writes, once-only RNG/init behavior, unchanged native sentinel, preserved rival name on return, source Oak gift/rival preservation, real map NPC insertion and canonical/repeat rejection. This is source/host proof, not a game walkthrough.

ARM syntax checks of the changed naming-screen source and both helpers passed in **0.0748 seconds**; the RNG addition's initializer syntax check passed in **0.0197 seconds**. These use actual Emerald headers plus existing generated baseline map headers and IDE graphics placeholders. Two original keyboard UTF-8 width warnings are retained in the receipt. No graphics assets, linker, ROM, renderer, emulator, browser or model-driven campaign was exercised. Initial missing generated-header/macro failures are retained in the receipts. No before/after build-latency comparison exists because no full build ran here.

Reproduce focused checks from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tools.whole_game.single_rom.test_campaign
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 research/ir-workshop/whole-game-mashup-20261016/single-rom/campaign/check_native_syntax.py
```

The syntax reproducer currently checks the final initializer only; the earlier three-unit receipt is `native-syntax.json`, and final RNG-aware initializer receipt is `native-rng-syntax.json`. The generated stage ledger carries immutable source hashes and all remaining campaign obligations. No full-campaign or playable `.gba` claim is made.

First-arrival integration now calls the exact Fame Checker reset (including Oak's initial colored record) and source Trainer Tower reset (including encryption-aware maximum best times) once before the durable marker. Repeat travel preserves both banks. `WholeGame_GetRivalName` exposes the saved name through a typed native accessor for fan-club text and regional rival-placeholder dispatch. The emitted nickname assignment uses the donor `FR_copyvar` macro. The host fixture proves provider calls occur before the marker and occur exactly once; it also checks the accessor returns the actual saved buffer.
