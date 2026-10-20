"""Stage FireRed's Pokemon Tower ghost rules in the native Emerald battle engine.

This pass consumes the typed special-battle state exported by battle_services.  It
never reuses FireRed's bit 15, which denotes TWO_OPPONENTS in Emerald.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path


SCHEMA = "whole-game-firered-ghost-battle/v1"


def _once(value: str, before: str, after: str, path: str) -> str:
    count = value.count(before)
    if count != 1:
        raise ValueError(f"{path}: expected one anchor, found {count}: {before[:90]!r}")
    return value.replace(before, after, 1)


def stage_ghost_battle(base, donor, out, report_dir=None):
    """Patch an isolated staged source tree; keep both decomp checkouts pristine."""
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == p or p in out.parents or out in p.parents for p in (base, donor)):
        raise ValueError("ghost stage requires an isolated output source tree")
    if not (out / "include/whole_game_fr_battle_services.h").is_file():
        raise ValueError("battle_services typed ghost state must be staged first")
    modified = []

    def patch(rel, fn):
        target = out / rel
        if target.is_symlink() or ((base / rel).exists() and target.samefile(base / rel)):
            raise ValueError(f"{rel}: staged file shares a canonical source")
        src = target.read_text()
        dst = fn(src)
        if src == dst:
            raise ValueError(f"{rel}: no ghost patch applied")
        target.write_text(dst)
        modified.append(rel)

    def setup(s):
        s = _once(s, '#include "battle_setup.h"', '#include "battle_setup.h"\n#include "item.h"\n#include "whole_game_fr_battle_services.h"\n#include "whole_game_state.h"\n#include "constants/firered_quest_log_map_ids.h"', 'battle_setup.c')
        s = _once(s, 'static void DoStandardWildBattle(void);',
                  'static void DoStandardWildBattle(void);\nstatic void DoFireRedGhostBattle(void);', 'battle_setup.c')
        s = _once(s, '''    if (GetSafariZoneFlag())
        DoSafariBattle();
    else
        DoStandardWildBattle();
}''', '''    u16 mapId = (gSaveBlock1Ptr->location.mapGroup << 8) | gSaveBlock1Ptr->location.mapNum;

    FR_SetGhostBattleMode(0);
    if (GetSafariZoneFlag())
        DoSafariBattle();
    else if (WholeGame_IsKanto()
          && mapId >= MAP_FR_POKEMON_TOWER_1F
          && mapId <= MAP_FR_POKEMON_TOWER_7F
          && !CheckBagHasItem(ITEM_SILPH_SCOPE, 1))
        DoFireRedGhostBattle();
    else
        DoStandardWildBattle();
}''', 'battle_setup.c')
        s = _once(s, '''static void DoStandardWildBattle(void)
{''', '''// FireRed DoGhostBattle, preserving its battle-stat and field-control behavior.
static void DoFireRedGhostBattle(void)
{
    LockPlayerFieldControls();
    FreezeObjectEvents();
    StopPlayerAvatar();
    gMain.savedCallback = CB2_EndWildBattle;
    gBattleTypeFlags = 0;
    FR_SetGhostBattleMode(1);
    CreateBattleStartTask(GetWildBattleTransition(), 0);
    SetMonData(&gEnemyParty[0], MON_DATA_NICKNAME, gText_FR_Ghost);
    IncrementGameStat(GAME_STAT_TOTAL_BATTLES);
    IncrementGameStat(GAME_STAT_WILD_BATTLES);
}

static void DoStandardWildBattle(void)
{''', 'battle_setup.c')
        s = _once(s, '''static void CB2_EndWildBattle(void)
{
    CpuFill16''', '''static void CB2_EndWildBattle(void)
{
    FR_SetGhostBattleMode(0);
    CpuFill16''', 'battle_setup.c')
        return s
    patch('src/battle_setup.c', setup)

    def util(s):
        s = _once(s, '#include "battle_scripts.h"', '#include "battle_scripts.h"\n#include "whole_game_fr_battle_services.h"', 'battle_util.c')
        s = _once(s, '''    CANCELER_PARALYZED,
    CANCELER_IN_LOVE,''', '''    CANCELER_PARALYZED,
    CANCELER_GHOST,
    CANCELER_IN_LOVE,''', 'battle_util.c')
        s = _once(s, '''        case CANCELER_IN_LOVE: // infatuation''', '''        case CANCELER_GHOST: // FireRed Pokemon Tower unidentified ghost
            if (WholeGame_IsFireRedGhostWithoutScope())
            {
                if (GetBattlerSide(gBattlerAttacker) == B_SIDE_PLAYER)
                    gBattlescriptCurrInstr = BattleScript_FR_TooScaredToMove;
                else
                    gBattlescriptCurrInstr = BattleScript_FR_GhostGetOutGetOut;
                gBattleCommunication[MULTISTRING_CHOOSER] = 0;
                effect = 1;
            }
            gBattleStruct->atkCancelerTracker++;
            break;
        case CANCELER_IN_LOVE: // infatuation''', 'battle_util.c')
        s = _once(s, '''    else if (gBattleTypeFlags & (BATTLE_TYPE_FRONTIER | BATTLE_TYPE_TRAINER_HILL) && gBattleTypeFlags & BATTLE_TYPE_TRAINER)
    {
        effect++;
    }
    else''', '''    else if (gBattleTypeFlags & (BATTLE_TYPE_FRONTIER | BATTLE_TYPE_TRAINER_HILL) && gBattleTypeFlags & BATTLE_TYPE_TRAINER)
    {
        effect++;
    }
    else if (WholeGame_IsFireRedGhostWithoutScope() && GetBattlerSide(battler) == B_SIDE_PLAYER)
    {
        effect++;
    }
    else''', 'battle_util.c')
        s = _once(s, '''        GET_MOVE_TYPE(move, moveType);

        switch (caseID)''', '''        GET_MOVE_TYPE(move, moveType);

        if (WholeGame_IsFireRedGhostWithoutScope()
         && (gLastUsedAbility == ABILITY_INTIMIDATE || gLastUsedAbility == ABILITY_TRACE))
            return effect;

        switch (caseID)''', 'battle_util.c')
        return s
    patch('src/battle_util.c', util)

    def commands(s):
        s = _once(s, '#include "battle_scripts.h"', '#include "battle_scripts.h"\n#include "whole_game_fr_battle_services.h"', 'battle_script_commands.c')
        s = _once(s, '''    if (WEATHER_HAS_EFFECT)
    {
        if (gBattleWeather & B_WEATHER_SANDSTORM)''', '''    if (WholeGame_IsFireRedGhostWithoutScope() && GetBattlerSide(gBattlerAttacker) == B_SIDE_OPPONENT)
    {
        gBattleMoveDamage = 0;
        gBattlescriptCurrInstr++;
        return;
    }
    if (WEATHER_HAS_EFFECT)
    {
        if (gBattleWeather & B_WEATHER_SANDSTORM)''', 'battle_script_commands.c')
        s = _once(s, '''    else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)
    {
        BtlController_EmitBallThrowAnim(B_COMM_TO_CONTROLLER, BALL_3_SHAKES_SUCCESS);
        MarkBattlerForControllerExec(gActiveBattler);
        gBattlescriptCurrInstr = BattleScript_WallyBallThrow;
    }
    else''', '''    else if (WholeGame_IsFireRedGhostBattle())
    {
        BtlController_EmitBallThrowAnim(B_COMM_TO_CONTROLLER, BALL_FR_GHOST_DODGE);
        MarkBattlerForControllerExec(gActiveBattler);
        gBattlescriptCurrInstr = BattleScript_FR_GhostBallDodge;
    }
    else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)
    {
        BtlController_EmitBallThrowAnim(B_COMM_TO_CONTROLLER, BALL_3_SHAKES_SUCCESS);
        MarkBattlerForControllerExec(gActiveBattler);
        gBattlescriptCurrInstr = BattleScript_WallyBallThrow;
    }
    else''', 'battle_script_commands.c')
        return s
    patch('src/battle_script_commands.c', commands)

    def battle_main(s):
        s = _once(s, '#include "battle_setup.h"', '#include "battle_setup.h"\n#include "whole_game_fr_battle_services.h"', 'battle_main.c')
        source = '''                HandleSetPokedexFlag(SpeciesToNationalPokedexNum(gBattleMons[gActiveBattler].species), FLAG_SET_SEEN, gBattleMons[gActiveBattler].personality);'''
        # Native Emerald records seen both at controller setup and the later intro pass.
        # Both source sites require the same FireRed unidentified-ghost exclusion.
        s = s.replace(source, '''                if (!WholeGame_IsFireRedGhostWithoutScope())
                    HandleSetPokedexFlag(SpeciesToNationalPokedexNum(gBattleMons[gActiveBattler].species), FLAG_SET_SEEN, gBattleMons[gActiveBattler].personality);''')
        s = _once(s, '''        PrepareStringBattle(STRINGID_INTROMSG, 0);
    }
}''', '''        PrepareStringBattle(STRINGID_INTROMSG, 0);
        if (WholeGame_IsFireRedGhostWithScope())
        {
            gBattleScripting.battler = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
            BattleScriptExecute(BattleScript_FR_SilphScopeUnveiled);
        }
    }
}''', 'battle_main.c')
        return s
    patch('src/battle_main.c', battle_main)

    def interface(s):
        s = _once(s, '#include "battle_interface.h"',
            '#include "battle_interface.h"\n#include "whole_game_fr_battle_services.h"', 'battle_interface.c')
        s = _once(s, '''    if ((species == SPECIES_NIDORAN_F || species == SPECIES_NIDORAN_M) && StringCompare(nickname, gSpeciesNames[species]) == 0)
        gender = 100;''',
            '''    if ((species == SPECIES_NIDORAN_F || species == SPECIES_NIDORAN_M) && StringCompare(nickname, gSpeciesNames[species]) == 0)
        gender = 100;
    if (WholeGame_IsFireRedGhostBattle() && GetBattlerSide(gSprites[healthboxSpriteId].hMain_Battler) == B_SIDE_OPPONENT)
        gender = 100;''', 'battle_interface.c')
        s = _once(s, '''    if (GetBattlerSide(battler) == B_SIDE_PLAYER)
        return;
    if (!GetSetPokedexFlag''',
            '''    if (GetBattlerSide(battler) == B_SIDE_PLAYER)
        return;
    if (WholeGame_IsFireRedGhostBattle())
        return;
    if (!GetSetPokedexFlag''', 'battle_interface.c')
        return s
    patch('src/battle_interface.c', interface)

    _stage_scripts_and_text(out, patch)
    _stage_sprite_and_animation(donor, out, patch, modified)
    result = {'schema': SCHEMA, 'sourcePins': {
        p: hashlib.sha256((donor / p).read_bytes()).hexdigest() for p in (
            'src/battle_setup.c', 'src/battle_util.c', 'src/battle_script_commands.c',
            'src/battle_controller_opponent.c', 'graphics/pokemon/ghost/front.png')},
        'modifiedFiles': sorted(set(modified)), 'witnessSymbol': 'WholeGame_FireRedGhostBattleVersion',
        'modeOwner': 'battle_services', 'emulatedFlagBit15': False}
    if report_dir is not None:
        target = Path(report_dir)
        target.mkdir(parents=True, exist_ok=True)
        (target / 'ghost-battle.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    return result


def _stage_scripts_and_text(out, patch):
    patch('include/strings.h', lambda s: _once(s, '#endif // GUARD_STRINGS_H',
        'extern const u8 gText_FR_Ghost[];\n#endif // GUARD_STRINGS_H', 'strings.h'))
    patch('src/strings.c', lambda s: s + '\n// FireRed Pokemon Tower unidentified opponent name.\nconst u8 gText_FR_Ghost[] = _("GHOST");\n')
    def ids(s):
        match = re.search(r'(?m)^#define BATTLESTRINGS_COUNT\s+(\d+)$', s)
        if match is None:
            raise ValueError('battle_string_ids.h: missing string count')
        count = int(match.group(1))
        if count < 381 or count > 512:
            raise ValueError('battle_string_ids.h: unexpected string-count range')
        labels = ('MONTOOSCAREDTOMOVE', 'GHOSTGETOUTGETOUT', 'SILPHSCOPEUNVEILED', 'GHOSTWASMAROWAK')
        replacement = '\n'.join(f'#define STRINGID_FR_{label} {count + i}' for i, label in enumerate(labels))
        replacement += f'\n#define BATTLESTRINGS_COUNT {count + 4}'
        return s[:match.start()] + replacement + s[match.end():]
    patch('include/constants/battle_string_ids.h', ids)
    patch('include/constants/battle_anim.h', lambda s: _once(s,
        '#define B_ANIM_WISH_HEAL                22',
        '''#define B_ANIM_WISH_HEAL                22
#define B_ANIM_FR_MON_SCARED            23
#define B_ANIM_FR_GHOST_GET_OUT         24
#define B_ANIM_FR_SILPH_SCOPED          25''', 'battle_anim.h'))
    patch('include/battle_anim.h', lambda s: _once(s,
        'bool8 TranslateAnimHorizontalArc(struct Sprite *sprite);',
        'bool8 TranslateAnimHorizontalArc(struct Sprite *sprite);\nbool8 TranslateAnimVerticalArc(struct Sprite *sprite);',
        'battle_anim.h'))
    patch('include/battle_scripts.h', lambda s: _once(s,
        'extern const u8 BattleScript_TrainerBallBlock[];',
        '''extern const u8 BattleScript_TrainerBallBlock[];
extern const u8 BattleScript_FR_TooScaredToMove[];
extern const u8 BattleScript_FR_GhostGetOutGetOut[];
extern const u8 BattleScript_FR_SilphScopeUnveiled[];
extern const u8 BattleScript_FR_GhostBallDodge[];''', 'battle_scripts.h'))
    patch('include/battle_controllers.h', lambda s: _once(s,
        '    BALL_TRAINER_BLOCK,', '    BALL_TRAINER_BLOCK,\n    BALL_FR_GHOST_DODGE,', 'battle_controllers.h'))

    def scripts1(s):
        return s + '''
// Original FireRed Pokemon Tower battle-script states.
BattleScript_FR_TooScaredToMove::
    printstring STRINGID_FR_MONTOOSCAREDTOMOVE
    waitmessage B_WAIT_TIME_LONG
    playanimation BS_ATTACKER, B_ANIM_FR_MON_SCARED
    goto BattleScript_MoveEnd

BattleScript_FR_GhostGetOutGetOut::
    printstring STRINGID_FR_GHOSTGETOUTGETOUT
    playanimation BS_ATTACKER, B_ANIM_FR_GHOST_GET_OUT
    goto BattleScript_MoveEnd

BattleScript_FR_SilphScopeUnveiled::
    pause B_WAIT_TIME_SHORT
    printstring STRINGID_FR_SILPHSCOPEUNVEILED
    waitstate
    playanimation BS_OPPONENT1, B_ANIM_FR_SILPH_SCOPED
    pause B_WAIT_TIME_SHORT
    printstring STRINGID_FR_GHOSTWASMAROWAK
    waitmessage B_WAIT_TIME_LONG
    end2
'''
    patch('data/battle_scripts_1.s', scripts1)
    patch('data/battle_scripts_2.s', lambda s: s + '''
BattleScript_FR_GhostBallDodge::
    waitmessage B_WAIT_TIME_LONG
    printstring STRINGID_ITDODGEDBALL
    waitmessage B_WAIT_TIME_LONG
    finishaction
''')

    def messages(s):
        s = _once(s, 'static const u8 sText_ItDodgedBall[]',
            '''static const u8 sText_FR_TooScaredToMove[] = _("{B_ATK_NAME_WITH_PREFIX} is too scared to move!");
static const u8 sText_FR_GhostGetOut[] = _("GHOST: Get out…… Get out……");
static const u8 sText_FR_SilphScopeUnveil[] = _("SILPH SCOPE unveiled the GHOST's\\nidentity!");
static const u8 sText_FR_GhostWasMarowak[] = _("The GHOST was MAROWAK!\\p\\n");
static const u8 sText_FR_GhostAppearedCantId[] = _("The GHOST appeared!\\pDarn!\\nThe GHOST can't be ID'd!\\p");
static const u8 sText_FR_GhostAppeared[] = _("The GHOST appeared!\\p");
static const u8 sText_ItDodgedBall[]''', 'battle_message.c')
        s = _once(s, '#include "battle_setup.h"',
            '#include "battle_setup.h"\n#include "whole_game_fr_battle_services.h"', 'battle_message.c')
        s = _once(s, '    [STRINGID_ITDODGEDBALL - BATTLESTRINGS_TABLE_START] = sText_ItDodgedBall,',
            '''    [STRINGID_ITDODGEDBALL - BATTLESTRINGS_TABLE_START] = sText_ItDodgedBall,
    [STRINGID_FR_MONTOOSCAREDTOMOVE - BATTLESTRINGS_TABLE_START] = sText_FR_TooScaredToMove,
    [STRINGID_FR_GHOSTGETOUTGETOUT - BATTLESTRINGS_TABLE_START] = sText_FR_GhostGetOut,
    [STRINGID_FR_SILPHSCOPEUNVEILED - BATTLESTRINGS_TABLE_START] = sText_FR_SilphScopeUnveil,
    [STRINGID_FR_GHOSTWASMAROWAK - BATTLESTRINGS_TABLE_START] = sText_FR_GhostWasMarowak,''', 'battle_message.c')
        s = _once(s, '''            if (gBattleTypeFlags & BATTLE_TYPE_LEGENDARY)
                stringPtr = sText_LegendaryPkmnAppeared;''',
            '''            if (WholeGame_IsFireRedGhostBattle())
            {
                if (WholeGame_IsFireRedGhostWithScope())
                    stringPtr = sText_FR_GhostAppeared;
                else
                    stringPtr = sText_FR_GhostAppearedCantId;
            }
            else if (gBattleTypeFlags & BATTLE_TYPE_LEGENDARY)
                stringPtr = sText_LegendaryPkmnAppeared;''', 'battle_message.c')
        return s
    patch('src/battle_message.c', messages)

    patch('src/battle_script_commands.c', lambda s: _once(s,
        '     || gBattlescriptCurrInstr[2] == B_ANIM_SUBSTITUTE_FADE)',
        '     || gBattlescriptCurrInstr[2] == B_ANIM_SUBSTITUTE_FADE\n     || gBattlescriptCurrInstr[2] == B_ANIM_FR_SILPH_SCOPED)',
        'battle_script_commands.c'))


def _stage_sprite_and_animation(donor, out, patch, modified):
    asset = 'graphics/pokemon/ghost/front.png'
    target = out / asset
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(donor / asset, target)
    modified.append(asset)
    patch('include/graphics.h', lambda s: _once(s, '#endif //GUARD_GRAPHICS_H',
        'extern const u32 gWholeGameFireRedGhostPic[];\nextern const u32 gWholeGameFireRedGhostPalette[];\n#endif //GUARD_GRAPHICS_H', 'graphics.h'))
    patch('src/graphics.c', lambda s: s + '''
// FireRed graphics/pokemon/ghost/front.png, source asset copied byte-for-byte.
const u32 gWholeGameFireRedGhostPalette[] = INCGFX_U32("graphics/pokemon/ghost/front.png", ".gbapal.lz");
const u32 gWholeGameFireRedGhostPic[] = INCGFX_U32("graphics/pokemon/ghost/front.png", ".4bpp.lz");
''')
    patch('include/battle_gfx_sfx_util.h', lambda s: _once(s, '#endif // GUARD_BATTLE_GFX_SFX_UTIL_H',
        'void WholeGame_LoadFireRedGhostPic(u8 battler);\n#endif // GUARD_BATTLE_GFX_SFX_UTIL_H', 'battle_gfx_sfx_util.h'))

    def gfx(s):
        s = _once(s, '#include "graphics.h"', '#include "graphics.h"\n#include "whole_game_fr_battle_services.h"', 'battle_gfx_sfx_util.c')
        s = _once(s, '''    if (castform)
    {
        StartSpriteAnim''', '''    if (castform == 255 && WholeGame_IsFireRedGhostWithScope())
    {
        u16 targetSpecies = GetMonData(&gEnemyParty[gBattlerPartyIndexes[battlerAtk]], MON_DATA_SPECIES);
        position = GetBattlerPosition(battlerAtk);
        personalityValue = GetMonData(&gEnemyParty[gBattlerPartyIndexes[battlerAtk]], MON_DATA_PERSONALITY);
        otId = GetMonData(&gEnemyParty[gBattlerPartyIndexes[battlerAtk]], MON_DATA_OT_ID);
        HandleLoadSpecialPokePic_DontHandleDeoxys(&gMonFrontPicTable[targetSpecies],
                                                  gMonSpritesGfxPtr->sprites.ptr[position],
                                                  targetSpecies, personalityValue);
        DmaCopy32Defvars(3, gMonSpritesGfxPtr->sprites.ptr[position],
                         (void *)(OBJ_VRAM0 + gSprites[gBattlerSpriteIds[battlerAtk]].oam.tileNum * 32), MON_PIC_SIZE);
        paletteOffset = OBJ_PLTT_ID(battlerAtk);
        lzPaletteData = GetMonSpritePalFromSpeciesAndPersonality(targetSpecies, otId, personalityValue);
        LZDecompressWram(lzPaletteData, gDecompressionBuffer);
        LoadPalette(gDecompressionBuffer, paletteOffset, PLTT_SIZE_4BPP);
        gSprites[gBattlerSpriteIds[battlerAtk]].y = GetBattlerSpriteDefault_Y(battlerAtk);
        StartSpriteAnim(&gSprites[gBattlerSpriteIds[battlerAtk]], gBattleMonForms[battlerAtk]);
    }
    else if (castform)
    {
        StartSpriteAnim''', 'battle_gfx_sfx_util.c')
        s += '''
// Original FireRed DecompressGhostFrontPic, adapted to Emerald sprite storage.
void WholeGame_LoadFireRedGhostPic(u8 battler)
{
    u8 position = GetBattlerPosition(battler);
    LZDecompressWram(gWholeGameFireRedGhostPic, gMonSpritesGfxPtr->sprites.ptr[position]);
    LZDecompressWram(gWholeGameFireRedGhostPalette, gDecompressionBuffer);
    LoadPalette(gDecompressionBuffer, OBJ_PLTT_ID(battler), PLTT_SIZE_4BPP);
    LoadPalette(gDecompressionBuffer, BG_PLTT_ID(8) + BG_PLTT_ID(battler), PLTT_SIZE_4BPP);
}
const u32 WholeGame_FireRedGhostBattleVersion = 1;
'''
        return s
    patch('src/battle_gfx_sfx_util.c', gfx)

    def opponent(s):
        s = _once(s, '#include "battle_setup.h"', '#include "battle_setup.h"\n#include "whole_game_fr_battle_services.h"\n#include "battle_gfx_sfx_util.h"', 'battle_controller_opponent.c')
        s = _once(s, '''    BattleLoadOpponentMonSpriteGfx(&gEnemyParty[gBattlerPartyIndexes[gActiveBattler]], gActiveBattler);
    SetMultiuseSpriteTemplateToPokemon(species, GetBattlerPosition(gActiveBattler));''',
            '''    if (WholeGame_IsFireRedGhostBattle())
    {
        WholeGame_LoadFireRedGhostPic(gActiveBattler);
        gBattleSpritesDataPtr->healthBoxesData[gActiveBattler].triedShinyMonAnim = TRUE;
        gBattleSpritesDataPtr->healthBoxesData[gActiveBattler].finishedShinyMonAnim = TRUE;
    }
    else
        BattleLoadOpponentMonSpriteGfx(&gEnemyParty[gBattlerPartyIndexes[gActiveBattler]], gActiveBattler);
    SetMultiuseSpriteTemplateToPokemon(species, GetBattlerPosition(gActiveBattler));''', 'battle_controller_opponent.c')
        s = _once(s, '''                                               GetBattlerSpriteDefault_Y(gActiveBattler),''',
            '''                                               WholeGame_IsFireRedGhostBattle()
                                                   ? GetBattlerSpriteCoord(gActiveBattler, BATTLER_COORD_Y)
                                                   : GetBattlerSpriteDefault_Y(gActiveBattler),''', 'battle_controller_opponent.c')
        s = _once(s, '''    SetBattlerShadowSpriteCallback(gActiveBattler, GetMonData(&gEnemyParty[gBattlerPartyIndexes[gActiveBattler]], MON_DATA_SPECIES));

    gBattlerControllerFuncs[gActiveBattler] = TryShinyAnimAfterMonAnim;''',
            '''    if (!WholeGame_IsFireRedGhostBattle())
        SetBattlerShadowSpriteCallback(gActiveBattler, GetMonData(&gEnemyParty[gBattlerPartyIndexes[gActiveBattler]], MON_DATA_SPECIES));

    gBattlerControllerFuncs[gActiveBattler] = TryShinyAnimAfterMonAnim;''', 'battle_controller_opponent.c')
        return s
    patch('src/battle_controller_opponent.c', opponent)

    def reshow(s):
        s = _once(s, '#include "battle.h"', '#include "battle.h"\n#include "whole_game_fr_battle_services.h"\n#include "battle_gfx_sfx_util.h"', 'reshow_battle_screen.c')
        s = _once(s, '''            if (!gBattleSpritesDataPtr->battlerData[battler].behindSubstitute)
                BattleLoadOpponentMonSpriteGfx(&gEnemyParty[gBattlerPartyIndexes[battler]], battler);''',
            '''            if (WholeGame_IsFireRedGhostWithoutScope())
                WholeGame_LoadFireRedGhostPic(battler);
            else if (!gBattleSpritesDataPtr->battlerData[battler].behindSubstitute)
                BattleLoadOpponentMonSpriteGfx(&gEnemyParty[gBattlerPartyIndexes[battler]], battler);''', 'reshow_battle_screen.c')
        s = _once(s, '''        if (gBattleSpritesDataPtr->battlerData[battler].behindSubstitute)
            posY = GetSubstituteSpriteDefault_Y(battler);''',
            '''        if (WholeGame_IsFireRedGhostWithoutScope() && GetBattlerSide(battler) == B_SIDE_OPPONENT)
            posY = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y);
        else if (gBattleSpritesDataPtr->battlerData[battler].behindSubstitute)
            posY = GetSubstituteSpriteDefault_Y(battler);''', 'reshow_battle_screen.c')
        return s
    patch('src/reshow_battle_screen.c', reshow)

    def throwing(s):
        s = _once(s, 'static void SpriteCB_Ball_Block(struct Sprite *);',
            'static void SpriteCB_Ball_Block(struct Sprite *);\nstatic void SpriteCB_FR_GhostBallDodge(struct Sprite *);\nstatic void SpriteCB_FR_GhostBallDodgeStep(struct Sprite *);', 'battle_anim_throw.c')
        s = _once(s, '''        if (gBattleSpritesDataPtr->animationData->ballThrowCaseId == BALL_TRAINER_BLOCK)
        {
            sprite->callback = SpriteCB_Ball_Block;
        }''',
            '''        if (gBattleSpritesDataPtr->animationData->ballThrowCaseId == BALL_TRAINER_BLOCK)
        {
            sprite->callback = SpriteCB_Ball_Block;
        }
        else if (gBattleSpritesDataPtr->animationData->ballThrowCaseId == BALL_FR_GHOST_DODGE)
        {
            sprite->callback = SpriteCB_FR_GhostBallDodge;
        }''', 'battle_anim_throw.c')
        s += '''
// FireRed GhostBallDodge / GhostBallDodge2 translated to native Emerald throw callbacks.
static void SpriteCB_FR_GhostBallDodge(struct Sprite *sprite)
{
    sprite->x += sprite->x2;
    sprite->y += sprite->y2;
    sprite->x2 = sprite->y2 = 0;
    sprite->data[0] = 0x22;
    sprite->data[1] = sprite->x;
    sprite->data[2] = sprite->x - 8;
    sprite->data[3] = sprite->y;
    sprite->data[4] = 0x90;
    sprite->data[5] = 0x20;
    InitAnimArcTranslation(sprite);
    TranslateAnimVerticalArc(sprite);
    sprite->callback = SpriteCB_FR_GhostBallDodgeStep;
}
static void SpriteCB_FR_GhostBallDodgeStep(struct Sprite *sprite)
{
    if (!TranslateAnimVerticalArc(sprite) && sprite->y + sprite->y2 < 65)
        return;
    sprite->data[0] = 0;
    sprite->callback = DestroySpriteAfterOneFrame;
    gDoingBattleAnim = FALSE;
    UpdateOamPriorityInAllHealthboxes(1);
}
'''
        return s
    patch('src/battle_anim_throw.c', throwing)

    _stage_general_animations(donor, out, patch)


def _stage_general_animations(donor, out, patch):
    donor_script = (donor / 'data/battle_anim_scripts.s').read_text()
    start = donor_script.index('General_MonScared:')
    end = donor_script.index('General_SafariRockThrow:', start)
    script = donor_script[start:end]
    for before, after in (
        ('General_MonScared:', 'General_FR_MonScared:'),
        ('General_GhostGetOut:', 'General_FR_GhostGetOut:'),
        ('General_SilphScoped:', 'General_FR_SilphScoped:'),
        ('AnimTask_SafariOrGhost_DecideAnimSides', 'AnimTask_FR_DecideAnimSides'),
        ('AnimTask_GhostGetOut', 'AnimTask_FR_GhostGetOut'),
    ):
        script = script.replace(before, after)
    patch('data/battle_anim_scripts.s', lambda s: _once(s,
        '''\t.4byte General_WishHeal                 @ B_ANIM_WISH_HEAL''',
        '''\t.4byte General_WishHeal                 @ B_ANIM_WISH_HEAL
\t.4byte General_FR_MonScared             @ B_ANIM_FR_MON_SCARED
\t.4byte General_FR_GhostGetOut           @ B_ANIM_FR_GHOST_GET_OUT
\t.4byte General_FR_SilphScoped           @ B_ANIM_FR_SILPH_SCOPED''',
        'battle_anim_scripts.s') + '\n' + script)

    donor_c = (donor / 'src/battle_anim_ghost.c').read_text()
    start = donor_c.index('void AnimTask_GhostGetOut(u8 taskId)')
    end = donor_c.index('static void AnimMonMoveCircular', start)
    # The three donor task states are copied intact, with only native Emerald API
    # names and the scanline register enum translated.
    task = donor_c[start:end]
    task = task.replace('AnimTask_GhostGetOut', 'AnimTask_FR_GhostGetOut')
    task = task.replace('gMonSpritesGfxPtr->multiUseBuffer', 'gMonSpritesGfxPtr->buffer')
    task = task.replace('gBattleAnim_ScaryFaceGfx', 'gBattleAnimBgImage_ScaryFace')
    task = task.replace('gBattleAnim_ScaryFacePal', 'gBattleAnimBgPalette_ScaryFace')
    task = task.replace('ScanlineEffect_InitWave(y, y + 0x40, 4, 8, 0, 4, 1)',
                        'ScanlineEffect_InitWave(y, y + 0x40, 4, 8, 0, SCANLINE_EFFECT_REG_BG1HOFS, TRUE)')
    task = task.replace('ScanlineEffect_InitWave(y, y + 0x40, 4, 8, 0, 8, 1)',
                        'ScanlineEffect_InitWave(y, y + 0x40, 4, 8, 0, SCANLINE_EFFECT_REG_BG2HOFS, TRUE)')
    task = task.replace('InitBattleAnimBg(2)', 'ClearBattleAnimBg(2)')
    task = task.replace('LZDecompressWram(gBattleAnimBgTilemap_ScaryFacePlayer, gMonSpritesGfxPtr->buffer);',
                        'LZDecompressWram(gBattleAnimBgTilemap_ScaryFacePlayer, gMonSpritesGfxPtr->buffer);')
    def ghost_c(s):
        s = _once(s, '#include "global.h"', '#include "global.h"\n#include "graphics.h"\n#include "bg.h"\n#include "malloc.h"\n#include "decompress.h"', 'battle_anim_ghost.c')
        prologue = '''static void AnimTask_FR_GhostGetOut_Step1(u8 taskId);
static void AnimTask_FR_GhostGetOut_Step2(u8 taskId);
static void AnimTask_FR_GhostGetOut_Step3(u8 taskId);
'''
        sides = '''
void AnimTask_FR_DecideAnimSides(u8 taskId)
{
    if (gBattleAnimArgs[0] == 1)
    {
        gBattleAnimAttacker = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
        gBattleAnimTarget = GetBattlerAtPosition(B_POSITION_PLAYER_LEFT);
    }
    else
    {
        gBattleAnimAttacker = GetBattlerAtPosition(B_POSITION_PLAYER_LEFT);
        gBattleAnimTarget = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT);
    }
    DestroyAnimVisualTask(taskId);
}
'''
        return s + '\n// FireRed Pokemon Tower ghost animation state machine.\n' + prologue + task + sides
    patch('src/battle_anim_ghost.c', ghost_c)
