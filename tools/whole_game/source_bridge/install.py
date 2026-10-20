#!/usr/bin/env python3
"""Install the whole-game seam into an isolated pokeemerald/pokefirered source copy.

This script refuses to edit the canonical local/decomps trees. It is intentionally
small and deterministic so the existing source build remains the only build path.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from verify_compat import verify

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    value = path.read_text()
    if new in value:
        return
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, found {count}")
    path.write_text(value.replace(old, new, 1))


def append_once(path: Path, text: str) -> None:
    value = path.read_text()
    if text not in value:
        path.write_text(value.rstrip() + "\n\n" + text + "\n")


def install(root: Path, game: str) -> None:
    verify()
    root = root.resolve()
    if root in (REPO / "local/decomps/pokeemerald", REPO / "local/decomps/pokefirered"):
        raise RuntimeError("canonical source is read-only; pass an isolated build copy")
    if not (root / "src/overworld.c").exists():
        raise RuntimeError(f"missing source tree: {root}")
    is_fr = game == "pokefirered"
    header = root / "include/whole_game_bridge.h"
    if not header.exists():
        header.write_text((HERE / "whole_game_bridge.h").read_text())

    overworld = root / "src/overworld.c"
    replace_once(overworld, '#include "overworld.h"', '#include "overworld.h"\n#include "whole_game_bridge.h"')
    if is_fr:
        # In FRLG the symbol is static but the callback is the same safe scene boundary.
        old = "    OverworldBasic();\n    if (fading)\n        SetFieldVBlankCallback();\n}"
        new = "    OverworldBasic();\n    WholeGame_BridgeFieldTick();\n    if (fading)\n        SetFieldVBlankCallback();\n}"
    else:
        old = "    OverworldBasic();\n    if (fading)\n        SetFieldVBlankCallback();\n}"
        new = "    OverworldBasic();\n    WholeGame_BridgeFieldTick();\n    if (fading)\n        SetFieldVBlankCallback();\n}"
    replace_once(overworld, old, new)
    fade_decl = "    bool32 fading = !!gPaletteFade.active;" if is_fr else "    bool32 fading = (gPaletteFade.active != 0);"
    replace_once(overworld, fade_decl, fade_decl + "\n    if (gWholeGameBridge.status == WG_STATUS_READY && gWholeGameBridge.command == WG_CMD_EXPORT)\n        return;")
    replace_once(overworld, "    NewGameInitData();\n    ResetInitialPlayerAvatarState();", "    NewGameInitData();\n    WholeGame_BridgeAfterNewGame();\n    ResetInitialPlayerAvatarState();")
    bridge_body = (HERE / "whole_game_bridge.c.inc").read_text().replace(
        '#include "whole_game_bridge.h"',
        '#include "whole_game_bridge.h"\n#define WG_BUILD_FIRERED 1' if is_fr else '#include "whole_game_bridge.h"',
    )
    append_once(overworld, bridge_body)

    main = root / "src/main.c"
    replace_once(main, '#include "overworld.h"', '#include "overworld.h"\n#include "whole_game_bridge.h"')
    # Runs before source callback selection. BOOTSTRAP arms the original
    # title/intro flow; it does not skip source name/rival setup.
    if is_fr:
        replace_once(main, "static void CallCallbacks(void)\n{\n    if (!RunSaveFailedScreen()", "static void CallCallbacks(void)\n{\n    WholeGame_BridgePreCallbacks();\n    if (!RunSaveFailedScreen()")
    else:
        replace_once(main, "static void CallCallbacks(void)\n{\n    if (gMain.callback1)", "static void CallCallbacks(void)\n{\n    WholeGame_BridgePreCallbacks();\n    if (gMain.callback1)")

    specials = root / "data/specials.inc"
    if is_fr:
        replace_once(specials, "gSpecialsEnd::", "\tdef_special WholeGame_RequestTravel\ngSpecialsEnd::")
    else:
        append_once(specials, "\tdef_special WholeGame_RequestTravel")
    if is_fr:
        script = root / "data/maps/ViridianCity_PokemonCenter_1F/scripts.inc"
        anchor = "ViridianCity_PokemonCenter_1F_EventScript_Gentleman::\n\tmsgbox ViridianCity_PokemonCenter_1F_Text_FeelFreeToUsePC, MSGBOX_NPC\n\tend"
        replacement = """ViridianCity_PokemonCenter_1F_EventScript_Gentleman::
\tlock
\tfaceplayer
\tmsgbox ViridianCity_PokemonCenter_1F_Text_Travel, MSGBOX_YESNO
\tgoto_if_eq VAR_RESULT, YES, ViridianCity_PokemonCenter_1F_EventScript_Travel
\trelease
\tend

ViridianCity_PokemonCenter_1F_EventScript_Travel::
\tspecial WholeGame_RequestTravel
\trelease
\tend

ViridianCity_PokemonCenter_1F_Text_Travel::
\t.string "Travel to HOENN with your party?$"
"""
    else:
        script = root / "data/maps/OldaleTown_PokemonCenter_1F/scripts.inc"
        anchor = "OldaleTown_PokemonCenter_1F_EventScript_Gentleman::\n\tmsgbox OldaleTown_PokemonCenter_1F_Text_TrainersCanUsePC, MSGBOX_NPC\n\tend"
        replacement = """OldaleTown_PokemonCenter_1F_EventScript_Gentleman::
\tlock
\tfaceplayer
\tmsgbox OldaleTown_PokemonCenter_1F_Text_Travel, MSGBOX_YESNO
\tgoto_if_eq VAR_RESULT, YES, OldaleTown_PokemonCenter_1F_EventScript_Travel
\trelease
\tend

OldaleTown_PokemonCenter_1F_EventScript_Travel::
\tspecial WholeGame_RequestTravel
\trelease
\tend

OldaleTown_PokemonCenter_1F_Text_Travel::
\t.string "Travel to KANTO with your party?$"
"""
    replace_once(script, anchor, replacement)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("game", choices=("pokefirered", "pokeemerald"))
    parser.add_argument("source_copy", type=Path)
    args = parser.parse_args()
    install(args.source_copy, args.game)
