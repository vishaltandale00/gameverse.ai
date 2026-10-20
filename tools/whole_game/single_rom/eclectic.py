"""Optional source-backed Rally recipe, staged after the complete regional merge.

The six recovered algorithms are emitted by the registered eclectic lowerer.
Only scheduling, source-domain projections and the composition rules below are
authored. Canonical source trees and original ROMs are never modified.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RECIPE_ID = "pokemon-rally-mastery/1"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("eclectic source anchor changed: " + old[:100])
    return text.replace(old, new, 1)


def _function(text, name, transform):
    from .native_services import functions
    selected = [f for f in functions(text, "") if f.name == name]
    if len(selected) != 1:
        raise ValueError("eclectic function contract changed: " + name)
    f = selected[0]
    return text[:f.start] + transform(f.source) + text[f.end:]


def stage_eclectic(base, donor, output, report_dir, *, request_path=None, repo_root=None):
    """Apply only an explicitly supplied, pinned recipe; return source ledger."""
    from tools.prefab_pipeline.eclectic_strategy import generate_eclectic_source, PACKAGES
    start = time.perf_counter()
    repo_root = Path(repo_root).resolve() if repo_root is not None else ROOT
    base, donor, output = map(lambda p: Path(p).resolve(), (base, donor, output))
    if any(output == p or output in p.parents or p in output.parents for p in (base, donor)):
        raise ValueError("eclectic output must be isolated from original sources")
    if request_path is None:
        raise ValueError("eclectic stage requires an explicit recipe request")
    request_path = Path(request_path).resolve()
    request = json.loads(request_path.read_text())
    expected = {name: {"id": ident, "sha256": digest} for name, (ident, digest) in PACKAGES.items()}
    if (request.get("schema") != "gameverse.pokemon-eclectic-request/1"
            or request.get("recipe") != RECIPE_ID
            or request.get("packages") != expected
            or request.get("policy") != POLICY
            or request.get("stage_sha256") != sha(Path(__file__))):
        raise ValueError("unsupported or stale eclectic recipe contract")
    source, header, metadata = generate_eclectic_source(repo_root, native_types=True)
    changed, inputs = [], {}

    def read(rel):
        value = (output / rel).read_text()
        inputs[rel] = sha(output / rel)
        return value

    def write(rel, value):
        (output / rel).parent.mkdir(parents=True, exist_ok=True)
        (output / rel).write_text(value)
        changed.append(rel)

    # The original native collision result is the only movement admission.
    text = read("src/bike.c")
    text = '#include "whole_game_eclectic.h"\n' + text
    def mach(body):
        body = _once(body,
            "            sMachBikeSpeedCallbacks[gPlayerAvatar.bikeFrameCounter](direction);",
            "            gPlayerAvatar.bikeFrameCounter = WholeGameEclecticBikeStep(direction);\n"
            "            sMachBikeSpeedCallbacks[gPlayerAvatar.bikeFrameCounter](direction);")
        return _once(body,
            "            if (gPlayerAvatar.bikeFrameCounter < 2) // do not go faster than the last element in the mach bike array\n                gPlayerAvatar.bikeFrameCounter++;",
            "            WholeGameEclecticEarnTile();")
    text = _function(text, "MachBikeTransition_TrySpeedUp", mach)
    for name in ("Bike_SetBikeStill", "BikeClearState"):
        text = _function(text, name, lambda b: b.replace("{", "{\n    WholeGameEclecticResetMotion();\n    {", 1)[:-1] + "    }\n}")
    # Kanto normal cycling retains its original slope/stair/collision policy.
    # Only its ordinary admitted flat-ground water-current movement is remapped.
    if "WGFR_BikeTransition_MoveDirection" in text:
        text = _function(text, "WGFR_BikeTransition_MoveDirection", lambda b: _once(b,
            "            else\n                PlayerRideWaterCurrent(direction);",
            "            else\n            {\n                WholeGameEclecticKantoBikeStep(direction);\n                WholeGameEclecticEarnTile();\n            }"))
        for name in ("WGFR_BikeTransition_FaceDirection", "WGFR_BikeTransition_TurnDirection"):
            text = _function(text, name, lambda b: b.replace("{", "{\n    WholeGameEclecticResetMotion();\n    {", 1)[:-1] + "    }\n}")
    else:
        raise ValueError("eclectic combined recipe requires the Kanto bicycle provider")
    write("src/bike.c", text)

    # Resolve once before the controller update, so native HP/bar/Counter/Bide
    # consume the same damage. Original damage assignment and lifecycle survive.
    text = read("src/battle_script_commands.c")
    text = '#include "whole_game_eclectic.h"\n' + text
    text = _function(text, "Cmd_healthbarupdate", lambda b: _once(b,
        "            s32 currDmg = gBattleMoveDamage;",
        "            s32 currDmg;\n            gBattleMoveDamage = WholeGameEclecticDamage(gActiveBattler, gBattleMoveDamage);\n            currDmg = gBattleMoveDamage;"))
    # The original maxPossibleDmgValue declaration must remain before statements.
    text = _once(text,
        "            s32 currDmg;\n            gBattleMoveDamage = WholeGameEclecticDamage(gActiveBattler, gBattleMoveDamage);\n            currDmg = gBattleMoveDamage;\n            s32 maxPossibleDmgValue = 10000;",
        "            s32 currDmg;\n            s32 maxPossibleDmgValue = 10000;\n            gBattleMoveDamage = WholeGameEclecticDamage(gActiveBattler, gBattleMoveDamage);\n            currDmg = gBattleMoveDamage;")
    write("src/battle_script_commands.c", text)

    # First mount explains the rules using the native item-message task. Holding
    # L while using the bicycle explicitly reopens the current resource readout.
    text = read("src/item_use.c")
    text = '#include "whole_game_eclectic.h"\n' + text
    text = _function(text, "ItemUseOnFieldCB_Bike", lambda b: _once(b,
        "    ScriptUnfreezeObjectEvents();",
        "    if (WholeGameEclecticBikeHelp())\n    {\n        DisplayItemMessageOnField(taskId, gStringVar4, Task_CloseCantUseKeyItemMessage);\n        return;\n    }\n    ScriptUnfreezeObjectEvents();"))
    write("src/item_use.c", text)
    write("src/eclectic_mechanics.c", source)
    write("include/eclectic-mechanics.h", header)
    write("include/whole_game_eclectic.h", HEADER)
    write("src/whole_game_eclectic.c", HOST)
    report = {"schema": "whole-source-eclectic-stage/1", "recipe": RECIPE_ID,
              "request": {"path": str(request_path), "sha256": sha(request_path)},
              "sourcePackages": metadata, "sourceInputHashes": inputs,
              "changedFiles": changed, "outputHashes": {p: sha(output/p) for p in changed},
              "buildEligible": True, "unresolved": [],
              "nativeWitness": {"symbol": "WholeGameEclecticDamage", "file": "src/whole_game_eclectic.c"},
              "state": {"persistent_new_bytes": 0, "owner": "optional recipe session",
                        "ephemeral": "racer + rally + help flag; reset at cartridge boot; motion also resets on native bike clear/stop",
                        "mastery": "recomputed from original native saved badge flags in both regions",
                        "save_reload": "Rally is deliberately not serialized; native badge progression is serialized by the core"},
              "qualification": "source-stage only; linked ROM and gameplay qualification required",
              "timing": {"queue_s": None, "wall_s": time.perf_counter()-start,
                         "build_s": None, "simulation_s": None}}
    report_dir = Path(report_dir); report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir/"eclectic-stage.json").write_text(json.dumps(report, indent=2)+"\n")
    return report


POLICY = {"rally_capacity": 64, "tile_gain": 1, "beam_spend_cap": 8,
          "guard_spend_cap": 16, "beam_badge": 1, "guard_badge": 4,
          "hp_projection": "full only on equality; otherwise min(63,ceil(hp*64/maxHP)); low<=8",
          "persistence": "session-only rally; original native badges durable"}

HEADER = '''#ifndef GUARD_WHOLE_GAME_ECLECTIC_H
#define GUARD_WHOLE_GAME_ECLECTIC_H
#include "global.h"
void WholeGameEclecticResetMotion(void);
u8 WholeGameEclecticBikeStep(u8 direction);
void WholeGameEclecticKantoBikeStep(u8 direction);
void WholeGameEclecticEarnTile(void);
s32 WholeGameEclecticDamage(u8 active, s32 damage);
bool8 WholeGameEclecticBikeHelp(void);
#endif
'''

HOST = r'''#include "global.h"
#include "whole_game_eclectic.h"
#include "eclectic-mechanics.h"
#include "battle.h"
#include "battle_anim.h"
#include "battle_message.h"
#include "sound.h"
#include "bike.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "field_player_avatar.h"
#include "main.h"
#include "string_util.h"
#include "strings.h"
#include "constants/battle.h"
#include "constants/songs.h"
#include "constants/flags.h"
#include "constants/whole_game_fr_state.h"

EWRAM_DATA static GvEclecticRacer sRallyRacer = {0};
EWRAM_DATA static u16 sRally = 0;
EWRAM_DATA static u8 sLastRallyDirection = 0;
EWRAM_DATA static bool8 sRallyHelpShown = FALSE;
static const s16 sRallyAcceleration[16] = {128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,128};
static const s16 sRallyCornerBrake[16] = {-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512,-512};
static const u8 sRallyGuide[] = _("RALLY: Ride straight to charge!\nCorners scrub speed. Hold L when\lusing your BIKE to check charge.\pBadge 1: full HP spends charge\nfor RALLY STRIKE. Badge 4: very\llow HP spends it to guard hits.\pBoth share one charge reserve!\nCharge lasts this play session.\lYour badges save normally.");
static const u8 sRallyReadout[] = _("RALLY charge: {STR_VAR_1}/64\nFull HP: strike, up to 8 charge.\lHP below 1/8: guard, up to 16.");

void WholeGameEclecticResetMotion(void)
{
    memset(&sRallyRacer, 0, sizeof(sRallyRacer));
    sLastRallyDirection = 0;
}

u8 WholeGameEclecticBikeStep(u8 direction)
{
    u16 demand = 0;
    u8 result;
    /* Cardinal-to-source demands are authored. Native coordinates, collision,
       stairs, slopes, rails, ledges and map transitions remain native owned. */
    if (sLastRallyDirection && direction != sLastRallyDirection)
        demand = direction > sLastRallyDirection ? 0x100 : 0x200;
    GvEclecticKartStep(&sRallyRacer, demand, 0, demand ? sRallyCornerBrake : sRallyAcceleration);
    if ((s32)sRallyRacer.speed_q16 < 0)
        sRallyRacer.speed_q16 = 0;
    if (sRallyRacer.speed_q16 > 0x30000)
        sRallyRacer.speed_q16 = 0x30000;
    sLastRallyDirection = direction;
    result = sRallyRacer.speed_q16 >= 0x20000 ? 2 : sRallyRacer.speed_q16 >= 0x10000 ? 1 : 0;
    return result;
}

void WholeGameEclecticKantoBikeStep(u8 direction)
{
    u8 speed = WholeGameEclecticBikeStep(direction);
    if (speed == 0)
        PlayerWalkNormal(direction);
    else if (speed == 1)
        PlayerWalkFast(direction);
    else
        PlayerRideWaterCurrent(direction);
}

void WholeGameEclecticEarnTile(void)
{
    GvEclecticHpResult value;
    if (sRallyRacer.speed_q16 < 0x20000)
        return;
    value = GvEclecticHp(sRally, 64, 0xffff, 1, 0, 0, 0);
    sRally = value.hp;
}

static u16 RallySkills(void)
{
    u8 bank[64] = {0};
    /* Source inventory positions are mapped explicitly; this scratch bank is
       never a second saved progression writer. Native badges remain authority. */
    if (FlagGet(FLAG_BADGE01_GET) || FlagGet(FR_FLAG_BADGE01_GET))
        bank[19] |= 1;
    if (FlagGet(FLAG_BADGE04_GET) || FlagGet(FR_FLAG_BADGE04_GET))
        bank[19] |= 0x40;
    return GvEclecticSkills(bank);
}

static u32 RallyEligibility(u8 battler)
{
    u32 hp = gBattleMons[battler].hp;
    u32 maximum = gBattleMons[battler].maxHP;
    u8 projected;
    if (!hp || !maximum)
        return 0;
    projected = (hp * 64 + maximum - 1) / maximum;
    if (hp < maximum && projected >= 64)
        projected = 63;
    return GvEclecticBeam(projected, 64, RallySkills());
}

static void RallyFeedback(bool8 guard, u16 spent)
{
    static const u8 strikeText[] = _("RALLY +{STR_VAR_1}! ({STR_VAR_2}/64)");
    static const u8 guardText[] = _("GUARD {STR_VAR_1}! ({STR_VAR_2}/64)");
    ConvertIntToDecimalStringN(gStringVar1, spent, STR_CONV_MODE_LEFT_ALIGN, 2);
    ConvertIntToDecimalStringN(gStringVar2, sRally, STR_CONV_MODE_LEFT_ALIGN, 2);
    StringExpandPlaceholders(gStringVar4, guard ? guardText : strikeText);
    BattlePutTextOnWindow(gStringVar4, B_WIN_MSG);
    PlaySE(guard ? SE_USE_ITEM : SE_M_STAT_INCREASE);
}

s32 WholeGameEclecticDamage(u8 active, s32 damage)
{
    u16 spend;
    GvEclecticHpResult value;
    if (damage <= 0 || damage > 10000 || !sRally
        || active != gBattlerTarget || gBattlerAttacker == active
        || GetBattlerSide(active) == GetBattlerSide(gBattlerAttacker)
        || (gHitMarker & HITMARKER_PASSIVE_HP_UPDATE)
        || (gMoveResultFlags & (MOVE_RESULT_NO_EFFECT | MOVE_RESULT_ONE_HIT_KO | MOVE_RESULT_FOE_ENDURED | MOVE_RESULT_FOE_HUNG_ON))
        || (gBattleTypeFlags & (BATTLE_TYPE_LINK | BATTLE_TYPE_SAFARI | BATTLE_TYPE_FRONTIER | BATTLE_TYPE_WALLY_TUTORIAL | BATTLE_TYPE_FIRST_BATTLE | BATTLE_TYPE_EREADER_TRAINER | BATTLE_TYPE_RECORDED | BATTLE_TYPE_TRAINER_HILL))
        || gBattleMoves[gCurrentMove].power <= 1)
        return damage;
    if (GetBattlerSide(gBattlerAttacker) == B_SIDE_PLAYER && RallyEligibility(gBattlerAttacker) == 15)
    {
        spend = sRally > 8 ? 8 : sRally;
        value = GvEclecticHp(sRally, 64, spend, 0xffff, 0, 0, 0);
        spend = sRally - value.hp;
        sRally = value.hp;
        RallyFeedback(FALSE, spend);
        return damage + spend;
    }
    if (GetBattlerSide(active) == B_SIDE_PLAYER && RallyEligibility(active) == 22)
    {
        spend = sRally > 16 ? 16 : sRally;
        if (spend > damage)
            spend = damage;
        value = GvEclecticHp(sRally, 64, spend, 0xffff, 0, 0, 0);
        spend = sRally - value.hp;
        sRally = value.hp;
        RallyFeedback(TRUE, spend);
        return damage - spend;
    }
    return damage;
}

bool8 WholeGameEclecticBikeHelp(void)
{
    if (!sRallyHelpShown)
    {
        sRallyHelpShown = TRUE;
        StringCopy(gStringVar4, sRallyGuide);
        return TRUE;
    }
    if (gMain.heldKeys & L_BUTTON)
    {
        ConvertIntToDecimalStringN(gStringVar1, sRally, STR_CONV_MODE_LEFT_ALIGN, 2);
        StringExpandPlaceholders(gStringVar4, sRallyReadout);
        return TRUE;
    }
    return FALSE;
}
'''
