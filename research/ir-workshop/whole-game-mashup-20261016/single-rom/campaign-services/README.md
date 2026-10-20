# Campaign native services

`campaign_services.stage_campaign_services(base, donor, output, report_dir=None)` supplies **25** exact requested roots. `CalculatePlayerPartyCount` remains supplied by the accepted shared_services binding; this stage does not duplicate it or native Load/SavePlayerParty.

Seven helper translation units and five targeted native party-menu predicates implement:

- Original donor party healing, doubles eligibility, Enigma Berry checking, non-egg/alive counts, selected-egg query, event-mon creation/fateful flag and Jump eligibility through the actual native mon/party accessors. There are no donor byte-offset casts or replacement party banks.
- Original three-selected-mon reducer and selector return callback. The native selector has a private temporary cable-club mode preserving donor alive/non-egg eligibility, minimum one and maximum three choices. It clears that mode in the actual return callback and never changes Hoenn's saved Frontier variable. Native selection otherwise retains its own rules.
- All four size-record roots with original donor table, hash/arithmetic, integer imperial conversion and separate donor vars. The Magikarp/Heracross height inputs are checked against both original species tables before using native Pokedex data.
- Original Oak count/rating/Mew rules and imported rating text labels. Kanto and national seen/owned counts use the actual shared Pokedex.
- Separate Kanto National Dex flag/6258 gate on the native DA/0302 shared Pokedex format. Enabling through Oak calls the real native enable service and sets donor progress; unlocking through Hoenn alone does not auto-complete Oak's gate. Writing donor B9 into the native format would disable the native Pokedex and is explicitly avoided.
- Exact donor GCN link/save bit updates through typed native fields, with the shared champion warp flag's source bit identity preserved.
- Typed full native ownership for EggHatch, ChooseMonForWirelessMinigame and ShowPokemonJumpRecords. These call real original systems, including their callbacks, UI and state commits. The wireless and Jump display entry bodies are compared against source. Jump's complete ordered species/type table is compared; its actual shared 16-byte record/member offsets are compiled assertions. Native Jump record-window width adjustment is an explicit shared UI adaptation. Native hatching uses the established Hoenn/Four Island shared breeding facility and complete native hatch/mon-commit flow.

The ledger pins donor/native/staged source files and every public donor function body, supplies a typed public header, and identifies each provider's translation unit and binding. It refuses canonical roots and repeated application. No unresolved service is filled with a success return.

Four focused tests passed in **0.818s**. Actual emitted C verifies shared-versus-regional Dex gating, three-slot selection/reduction, alive/egg checks, callback policy and unchanged saved Frontier control state. ARM syntax checks of all **eight** affected C units passed in **0.207s**. Seven new helper units also compiled to ARM objects in **0.223s**.

The compile fixture uses actual native headers and existing generated map headers. IDE text/graphics declarations are used for code generation; this is not a ROM, link, graphics or cartridge qualification. Three pre-existing signed-pointer UI warnings remain visible. Initial decimal-text/operation-enum and fixture graphic-macro/empty-loop failures are recorded separately. No before/after build comparison exists for this new stage.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tools.whole_game.single_rom.test_campaign_services
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 research/ir-workshop/whole-game-mashup-20261016/single-rom/campaign-services/check_native_compile.py
```

Rendered party/hatch/rating operations, native callback lifecycles, shared Jump gameplay and durable cartridge save/reload remain unqualified. `buildEligible` remains false pending that integrated evidence.
