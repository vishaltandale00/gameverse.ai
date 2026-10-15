# A reusable sandbox first

Reviewed 13 October 2026.

The overworld can be a GTA-like sandbox whose purpose is to play other games. It does not need a story connecting those games. The earlier city-RPG recommendation added unnecessary requirements.

AI can build or modify a GTA-style recreation of the mechanics: walking, driving, traffic, city exploration and game entrances. The practical shortcut is to fork a small original sandbox with reusable code and assets, then add subgames. A full GTA-scale recreation is a much larger target, but not a prerequisite for this prototype.

## Candidates actually inspected

| Candidate | What is available | Fit and observed limits |
|---|---|---|
| [Night Drop / GTA-mini](https://github.com/alexbieber/GTA-mini) | MIT code; Godot city sandbox, plus a separate Unity track; documented CC0 art | First candidate I would try: compact source with walking/driving/city systems. Inspected Godot movement is keyboard/touch-based; controller support and persistent hub saves need work. Not runtime-verified. |
| [Open Theft Auto](https://github.com/mehulkapadia5/open-theft-auto) | MIT code; Godot sandbox with controller/remapping and JSON save implementations | Closer feature match. More systems and code to maintain. Asset notices are mixed, including CC0, CC-BY and Sketchfab Standard; do not treat the code’s MIT license as covering every asset. Not runtime-verified. |
| [OpenRW](https://github.com/rwengine/openrw) | Open-source recreation of GTA III’s executable | Its [own FAQ](https://github.com/rwengine/openrw/wiki/FAQ) says original GTA III assets are required. Not a self-contained freely supplied GTA game. Lower priority for our independently packaged host. |
| [OpenCity](https://github.com/Faizankhan17623/OpenCity) | Public browser-game source with city/driving claims | Inspected checkout has no root LICENSE. Public source is not by itself a clear reuse grant. Do not adopt as the base without resolving that. |

Recommendation: evaluate Night Drop first, Open Theft Auto second. Let the reusable project determine the initial engine rather than rewriting an available game merely to fit an earlier engine preference. This is a provisional source-based choice, not proof either candidate is stable or production-ready. Neither is a verified open-source equivalent of GTA V or Cyberpunk at their scale/fidelity.

## Evidence from the checkout review

Three shallow checkouts were downloaded to a temporary audit directory, with no changes to their upstream source:

- Night Drop: `f8187d327dbe327076ca23f5d8150d81f542c381`.
- Open Theft Auto: `b37e7f3070501dd90353c250e9ad90dffdf4c8b2`.
- OpenCity: `214bda3088b51b397b079a07acbdb7f9427cb5ed`.

Night Drop’s Godot `scripts/` contains 19 GDScript files, approximately 4,620 lines; Open Theft Auto’s contains 33, approximately 20,132 lines. These are checkout-specific counts, not quality scores. Both checked `project.godot` files target 4.7. Actual installed-version compatibility remains to be tested.

Inspected Night Drop’s LICENSE, asset credits/notices, project configuration, player/vehicle input and Unity-track README. Its Godot movement uses physical key polling and touch input. No persistent save implementation or joypad handling was located in the reviewed Godot scripts. The Unity track has its own implementation scope; it is not the same completed game in another engine.

Inspected Open Theft Auto’s LICENSE, project configuration, controller/input-remapping code, save code and asset license notices. Its JSON save implementation exists; that does not establish crash-safe writes, migration compatibility or complete portal-return state. Controller code exists; physical-pad play was not tested.

No Godot executable was on PATH. The browser tool could not connect to a running Chrome instance, so browser gameplay was not tested either. These are verification limits, not blockers to selecting candidates. No base was installed into the application, no candidate was compiled, and no subgame integration was built. The produced workspace artifact is this report.

## The order of work

1. Run the selected base and verify walking, driving, input and performance. Preserve its existing gameplay; do not build a new story.
2. Add one obvious entrance, such as an arcade cabinet or glowing door. Enter one small subgame and return to the same city position. Pause the city while inside it.
3. Add a second subgame of a different genre. Each keeps its own save. Initially use separate scenes in the same engine; a separate-process game is a different integration path, not a seamless embedded scene.
4. Add accomplishment carryover only after enter/play/return works. Start with one visible item and check that it survives quit/relaunch.
5. Add AI feedback and candidate changes to the overworld and subgames after the basic loop is stable. Work in separate candidate builds and keep the accepted version playable.

Only a small boundary is needed now: game ID, entry/return point, save location and a completion result. This does not require solving cross-world inventories, economies or narrative integration up front.

## Taking accomplishments home

First version: complete a race and display a trophy or unlock a car paint; finish a creature challenge and display an original creature statue; finish a building challenge and place a decorative build miniature.

Later: import a visual companion that follows you in the city; later still, let that companion or an unlocked vehicle affect gameplay. A reward can be represented by an ID, provenance and display asset even when the originating game uses different rules. Record the reward once per completion, so retries do not duplicate it.

Actual functional transfers are a larger decision: the overworld needs adapters for creature AI, physics, inventory and abilities. We can defer that and choose whether trophies, visual companions or useful objects are most satisfying after trying the basic host.

The first milestone is simply: walk/drive in an existing sandbox → enter a game → play → return → see one earned object. No shared story is required.
