# Corpus coverage and parallel extraction queue

All 33 indexed ROM entries now have a design portrait. This is coverage of the
catalogue, not completion of extraction. Nineteen have canonical granular records;
fifteen currently have source-linked player-facing design pieces. Helper-only
records remain useful engineering evidence but do not establish gameplay rules.

Portraits preserve three evidence classes: inherited source-backed mechanics,
visible retained scenes, and clearly labeled unverified model priors. No new ROM
campaign, paid LLM batch or decompilation campaign was run for this pass. Source
and capture links use repository-relative paths; hashes identify local bytes.

| Game | Depth | Canonical components | Source-linked pieces |
|---|---|---:|---:|
| Castlevania: Aria of Sorrow | source partial | 39 | 5 |
| Crash Bandicoot: The Huge Adventure | helper only | 1 | 0 |
| Dragon Ball: Advanced Adventure | scene and prior only | 0 | 0 |
| Driv3r | scene and prior only | 0 | 0 |
| Final Fantasy I & II: Dawn of Souls | scene and prior only | 0 | 0 |
| Final Fantasy Tactics Advance | source partial | 23 | 5 |
| Final Fantasy VI Advance | scene and prior only | 0 | 0 |
| Grand Theft Auto Advance | scene and prior only | 0 | 0 |
| Kingdom Hearts: Chain of Memories | source partial | 60 | 6 |
| Kirby & the Amazing Mirror | scene and prior only | 0 | 0 |
| Kirby: Nightmare in Dream Land | scene and prior only | 0 | 0 |
| The Legend of Zelda: A Link to the Past & Four Swords | scene and prior only | 0 | 0 |
| The Legend of Zelda: The Minish Cap | source partial | 59 | 6 |
| Mario & Luigi: Superstar Saga | source partial | 33 | 3 |
| Mario Kart: Super Circuit | source partial | 23 | 3 |
| Mega Man Zero | helper only | 6 | 0 |
| Metal Slug Advance | helper only | 7 | 0 |
| Metroid Fusion | source partial | 69 | 6 |
| Metroid: Zero Mission | deep partial | 55 | 7 |
| Need for Speed: Underground | scene and prior only | 0 | 0 |
| Pokémon Emerald Version | deep partial | 62 | 7 |
| Pokémon FireRed Version | source partial | 28 | 6 |
| Pokémon LeafGreen Version | source partial | 28 | 6 |
| Pokémon Mystery Dungeon: Red Rescue Team | source partial | 57 | 6 |
| Pokémon Ruby Version | source partial | 26 | 6 |
| Prince of Persia: The Sands of Time | helper only | 7 | 0 |
| Shaman King: Master of Spirits | scene and prior only | 0 | 0 |
| Sonic Advance | source partial | 51 | 6 |
| Super Mario Advance | scene and prior only | 0 | 0 |
| Super Mario Advance 2: Super Mario World | scene and prior only | 0 | 0 |
| Super Mario Advance 4: Super Mario Bros.3 | scene and prior only | 0 | 0 |
| Tekken Advance | scene and prior only | 0 | 0 |
| Wario Land 4 | source partial | 42 | 6 |

The depth labels are qualitative. “Deep partial” means the portrait groups a
substantial source-backed ruleset and adds directly inspected local story edges;
it does not mean every facet or campaign branch is extracted. “Source partial”
includes frontend-heavy games whose main movement/combat is still a gap.

## Parallel queues

1. **Sparse player rules:** the helper-only and scene/prior-only games need actual
   player controller, collision, action/encounter and unlock routines with caller
   context. Prior proposals are search targets, never evidence of recovered code.
2. **Uneven depth:** deepen the existing source games by missing facet. Priority
   examples are Superstar Saga's traversal/timed combat, Mario Kart's handling and
   items, and Tactics Advance's tactical action resolution. Existing source counts
   must not obscure these gaps.
3. **Story graphs across every game:** connect script entry conditions, actor and
   camera staging, dialogue, resulting flags/vars and endings. New Zero Mission
   and Emerald anchors establish selected local causal beats, not whole plots.
4. **Composition contracts:** convert selected high-level pieces into actual source
   lookup/build recipes, including state lifetime, tick semantics, memory/render
   budgets and bounded qualification. Conceptual requires/exposes and proposed
   bridges are insufficient proof of working integration.

The JSON companion records each game's next actions, source candidates, retained
ROM export reference and portrait path. Full-coverage claims, calibrated gameplay
strategies and a complete reusable asset catalogue remain unsupported.

## Reference resolution at this snapshot

The narrow static pass resolved all 33 portrait IDs, 222 pieces, 84 source-linked
pieces and 305 granular component references. All 66 retained frame hashes and 8
new source-span hashes matched their local inputs. No absolute workspace paths
remain in the JSON records. There were no reference errors. This establishes
reference integrity, not semantic completeness or game behavior; no ROM or
simulation campaign was run for the portraits.
