# FireRed map event source seam

`tools/whole_game/single_rom/map_events.py` stages native event support after
`world_assets` and `map_runtime`. It never edits the canonical decompositions.
The inventory in `map-events.json` is derived from all 425 registered FireRed
`map.json` files and rejects lost donor event rows or hidden-item metadata.

The nine FireRed clone entries are retained as `clone_event` records. Their
native consumer reads the original target local ID and target map from the
24-byte template, resolves the target normal template from the source map,
and uses its script, flag, movement, graphics, trainer metadata, and object
identity while retaining the clone's placement. Its border-obstacle rule uses
the original FireRed predicates for cut trees and smash rocks. Guide NPCs
added after donor rows by the campaign stage do not change that identity.

The 183 FireRed hidden items retain the donor's 16-bit item, 8-bit flag
offset, 7-bit quantity, and underfoot bit in their original 12-byte `BgEvent`
layout. The staged map generator emits a separate seven-argument macro for
FireRed maps; Emerald's five-argument macro and Hoenn maps are unchanged.
Native field interaction routes FireRed entries to the imported FireRed item
script, passing exact quantity and namespaced flag. Six underfoot events are
only dug up through the Itemfinder, which forces one item as FireRed does.

The donor's renewable-item table, step threshold, and sampling source are
ported into the same engine with namespaced maps, flags, and variables. It is
called on FireRed steps and native map-entry paths. The regional state stage
initializes all donor renewable flags to their original hidden state.

Validation: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest
tools.whole_game.single_rom.test_map_events -q` passed 3 focused tests in
4.45 seconds on this machine after the assembler macro rename. The imported
script's full map-event translation unit generated and assembled all 425
FireRed maps; all 183 compiled hidden rows matched donor JSON byte for byte
([source assembly evidence](../scripts/full-map-event-assembly.json)). On an
isolated copy of the 26-stage candidate, `data/event_scripts.o` assembled in
1.185 seconds with the unique `wg_bg_hidden_item_event` macro, and
`data/map_events.o` assembled in 0.62 seconds with all 183 calls renamed.
The staged
field handler, itemfinder, and renewable C units compiled in that candidate;
the object-event unit was blocked by an unrelated Quest Log header before its
body compiled. Full ROM linking, play, and campaign verification remain open.
