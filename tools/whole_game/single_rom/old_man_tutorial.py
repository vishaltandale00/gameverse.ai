"""Original FireRed Old Man controller integration, art and catch outcome.

battle_tutorial.py retains the complete shared Oak/Old Man controller. This
stage supplies the distinct Old Man back picture and native engine consumers;
battle_services.py and old_man_bag.py own entry/return and bag state respectively.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import time

from .native_services import functions
from .scripts import rewrite_tokens
from .battle_tutorial import _end_balanced, _declaration
from .credits import _definition

ASSET_C = 'src/whole_game_old_man_tutorial_assets.c'
HEADER = 'include/whole_game_old_man_tutorial.h'
BACK_ID = 8


def _sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def _insert_array(text, name, entry):
    if entry in text:
        return text
    declaration = _definition(text, name)
    start = declaration.index('{')
    end = _end_balanced(declaration, start) - 1
    prefix = declaration[:end].rstrip()
    if not prefix.endswith(('{', ',')):
        prefix += ','
    changed = prefix + '\n' + entry + '\n' + declaration[end:]
    return text.replace(declaration, changed, 1)


def stage_old_man_tutorial(emerald_source, firered_source, output_tree, report_dir=None):
    started = time.monotonic()
    base, donor, out = map(lambda p: Path(p).resolve(), (emerald_source, firered_source, output_tree))
    if any(out == p or out.is_relative_to(p) for p in (base, donor)) or out.name in ('pokeemerald', 'pokefirered'):
        raise ValueError('Old Man tutorial requires an isolated staged tree')
    changed = {}
    def read(name):
        p = out / name
        return changed.get(name, p.read_text() if p.exists() else (base / name).read_text())
    def write(name, text): changed[name] = text
    def patch(name, old, new):
        text = read(name)
        if new in text: return
        if text.count(old) != 1: raise ValueError(name + ': ambiguous Old Man source anchor: ' + old[:90])
        write(name, text.replace(old, new, 1))
    def include(name):
        value = read(name)
        anchor = '#include "whole_game_old_man_tutorial.h"\n'
        if anchor not in value: write(name, value.replace('#include "global.h"\n', '#include "global.h"\n' + anchor, 1))
    def function(root, relative, name):
        return next(f for f in functions((root / relative).read_text(), relative) if f.name == name)
    # All host back IDs0..7 remain unchanged. FireRed Old Man source ID5 is a
    # distinct native slot8, never Emerald's native RS May (slot5) or Wally6.
    header = '''#ifndef GUARD_WHOLE_GAME_OLD_MAN_TUTORIAL_H
#define GUARD_WHOLE_GAME_OLD_MAN_TUTORIAL_H
#include "global.h"
#include "sprite.h"
#include "whole_game_fr_battle_services.h"
#include "whole_game_battle_tutorial.h"
#define FR_TRAINER_BACK_PIC_OLD_MAN 8
extern const u8 FR_OldManBackPixels[];
extern const u32 FR_OldManBackPalette[];
extern const struct SpriteFrameImage FR_OldManBackFrames[4];
extern const union AnimCmd *const FR_OldManBackAnims[];
extern const u8 FR_OldManCaughtText[];
extern const u8 FR_BattleScript_OldManCaughtMessage[];
#endif
'''
    write(HEADER, header)
    names = {'gTrainerBackPic_OldMan': 'FR_OldManBackPixels',
             'gTrainerPalette_OldManBackPic': 'FR_OldManBackPalette',
             'gTrainerBackPicTable_OldMan': 'FR_OldManBackFrames',
             'sAnim_GeneralFrame0': 'FR_OldManIdleAnim',
             'sAnimCmd_OldMan_1': 'FR_OldManThrowAnim',
             'sBackAnims_OldMan': 'FR_OldManBackAnims'}
    graphics = (donor / 'src/data/graphics/trainers.h').read_text()
    data = (donor / 'src/data.c').read_text()
    anims = (donor / 'src/data/trainer_graphics/back_pic_anims.h').read_text()
    originals = [_definition(graphics, key) for key in ('gTrainerBackPic_OldMan', 'gTrainerPalette_OldManBackPic')]
    originals += [_definition(data, key) for key in ('gTrainerBackPicTable_OldMan', 'sAnim_GeneralFrame0')]
    originals += [_definition(anims, key) for key in ('sAnimCmd_OldMan_1', 'sBackAnims_OldMan')]
    emitted = rewrite_tokens('\n\n'.join(originals), names)
    emitted = emitted.replace('graphics/trainers/back_pics/old_man_back_pic', 'graphics/firered_old_man/old_man_back_pic')
    emitted = emitted.replace('graphics/trainers/palettes/old_man_back_pic', 'graphics/firered_old_man/old_man_back_pic')
    write(ASSET_C, '#include "global.h"\n#include "whole_game_old_man_tutorial.h"\n\n' + emitted + '\n')
    # Extend all native lookups used both on initial draw and bag return.
    table_file = 'src/data/trainer_graphics/back_pic_tables.h'
    table = read(table_file)
    table = _insert_array(table, 'gTrainerBackPicCoords', '    [FR_TRAINER_BACK_PIC_OLD_MAN] = {.size = 8, .y_offset = 4},')
    table = _insert_array(table, 'gTrainerBackPicTable', '    [FR_TRAINER_BACK_PIC_OLD_MAN] = {(const u32 *)FR_OldManBackPixels, 0x2000, FR_TRAINER_BACK_PIC_OLD_MAN},')
    table = _insert_array(table, 'gTrainerBackPicPaletteTable', '    [FR_TRAINER_BACK_PIC_OLD_MAN] = {FR_OldManBackPalette, FR_TRAINER_BACK_PIC_OLD_MAN},')
    write(table_file, table)
    anim_file = 'src/data/trainer_graphics/back_pic_anims.h'
    write(anim_file, _insert_array(read(anim_file), 'gTrainerBackAnimsPtrTable', '    [FR_TRAINER_BACK_PIC_OLD_MAN] = FR_OldManBackAnims,'))
    pokemon = read('src/pokemon.c')
    row = '''    [FR_TRAINER_BACK_PIC_OLD_MAN] = {
        .tileTag = TAG_NONE, .paletteTag = 0,
        .oam = &gOamData_BattleSpritePlayerSide, .anims = NULL,
        .images = FR_OldManBackFrames,
        .affineAnims = gAffineAnims_BattleSpritePlayerSide,
        .callback = SpriteCB_BattleSpriteStartSlideLeft,
    },'''
    write('src/pokemon.c', _insert_array(pokemon, 'sTrainerBackSpriteTemplates', row))
    for rel in ('src/data.c', 'src/pokemon.c', 'src/battle_main.c', 'src/battle_message.c',
                'src/battle_script_commands.c', 'src/battle_interface.c',
                'src/reshow_battle_screen.c', 'src/battle_anim_throw.c'):
        include(rel)
    # Original capture text gets a fresh ID; it retains donor music operands.
    # This is not an alias to Emerald's Wally story or sound resource.
    ids = read('include/constants/battle_string_ids.h')
    id_name = 'FR_STRINGID_OLD_MAN_CAUGHT'
    id_match = re.search(r'#define\s+' + id_name + r'\s+(\d+)', ids)
    if id_match:
        string_id = int(id_match[1])
    else:
        count = re.search(r'(#define\s+BATTLESTRINGS_COUNT\s+)(\d+)', ids)
        if not count: raise ValueError('missing battle string table count')
        string_id = int(count[2])
        ids = ids[:count.start()] + f'#define {id_name} {string_id}\n' + count[1] + str(string_id + 1) + ids[count.end():]
        write('include/constants/battle_string_ids.h', ids)
    message = read('src/battle_message.c')
    original_text = _definition((donor / 'src/battle_message.c').read_text(), 'sText_GotchaPkmnCaught2')
    text = original_text.replace('static const', 'const', 1).replace('sText_GotchaPkmnCaught2', 'FR_OldManCaughtText').replace('PLAY_BGM MUS_CAUGHT', 'PLAY_BGM FR_MUS_CAUGHT')
    if 'const u8 FR_OldManCaughtText[] =' not in message:
        message += '\n' + text + '\n'
    message = _insert_array(message, 'gBattleStringsTable', '    [FR_STRINGID_OLD_MAN_CAUGHT - BATTLESTRINGS_TABLE_START] = FR_OldManCaughtText,')
    # Source intro delay string is identical in both games, so the existing
    # renderer storage is reused with a distinct predicate, preserving Wally.
    message = message.replace('else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)\n                stringPtr = sText_WildPkmnAppearedPause;', 'else if ((gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL) || WholeGame_IsFireRedOldManTutorialBattle())\n                stringPtr = sText_WildPkmnAppearedPause;')
    write('src/battle_message.c', message)
    script = (donor / 'data/battle_scripts_2.s').read_text()
    start = script.index('BattleScript_OldMan_Pokedude_CaughtMessage::')
    stop = script.index('\nBattleScript_ShakeBallThrow::', start)
    script = script[start:stop].replace('BattleScript_OldMan_Pokedude_CaughtMessage', 'FR_BattleScript_OldManCaughtMessage').replace('STRINGID_GOTCHAPKMNCAUGHT2', id_name)
    native_scripts = read('data/battle_scripts_2.s')
    if 'FR_BattleScript_OldManCaughtMessage::' not in native_scripts:
        write('data/battle_scripts_2.s', native_scripts + '\n' + script + '\n')
    # The exact donor three-shake success path exits without givecaughtmon,
    # Pokédex writes, a nickname prompt, or accepted-party mutation.
    commands = read('src/battle_script_commands.c')
    old = '    else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)\n'
    capture = '''    else if (WholeGame_IsFireRedOldManTutorialBattle())
    {
        BtlController_EmitBallThrowAnim(B_COMM_TO_CONTROLLER, BALL_3_SHAKES_SUCCESS);
        MarkBattlerForControllerExec(gActiveBattler);
        gBattlescriptCurrInstr = FR_BattleScript_OldManCaughtMessage;
    }
'''
    if capture not in commands:
        # Find within this specific native command, not an unrelated Wally arm.
        f = next(f for f in functions(commands, 'x') if f.name == 'Cmd_handleballthrow')
        if f.source.count(old) != 1: raise ValueError('missing native catch tutorial anchor')
        new = f.source.replace(old, capture + old, 1)
        commands = commands[:f.start] + new + commands[f.end:]
    # Three original Dex-seen admission sites plus the switch-in script site
    # exclude the Old Man demonstration independently of its zero native flags.
    f = next(f for f in functions(commands, 'x') if f.name == 'Cmd_switchinanim')
    if 'WholeGame_IsFireRedOldManTutorialBattle()' not in f.source:
        new = f.source.replace('if (GetBattlerSide(gActiveBattler) == B_SIDE_OPPONENT', 'if (!WholeGame_IsFireRedOldManTutorialBattle()\n        && GetBattlerSide(gActiveBattler) == B_SIDE_OPPONENT', 1)
        commands = commands[:f.start] + new + commands[f.end:]
    write('src/battle_script_commands.c', commands)
    main = read('src/battle_main.c')
    for name in ('BattleIntroDrawTrainersOrMonsSprites', 'BattleIntroRecordMonsToDex'):
        f = next(f for f in functions(main, 'x') if f.name == name)
        if 'WholeGame_IsFireRedOldManTutorialBattle()' not in f.source:
            new = re.sub(r'(?m)^(\s*)HandleSetPokedexFlag([^;]+);', r'\1if (!WholeGame_IsFireRedOldManTutorialBattle())\n\1    HandleSetPokedexFlag\2;', f.source)
            main = main[:f.start] + new + main[f.end:]
    f = next(f for f in functions(main, 'x') if f.name == 'HandleEndTurn_FinishBattle')
    if 'WholeGame_IsFireRedOldManTutorialBattle()' not in f.source:
        new = f.source.replace('&& !WholeGame_IsFireRedTutorialBattle()', '&& !WholeGame_IsFireRedTutorialBattle()\n         && !WholeGame_IsFireRedOldManTutorialBattle()')
        new = new.replace('&& gBattleResults.shinyWildMon)', '&& !WholeGame_IsFireRedOldManTutorialBattle()\n            && gBattleResults.shinyWildMon)')
        main = main[:f.start] + new + main[f.end:]
    write('src/battle_main.c', main)
    # Native catch icon and reload paths must not display the accepted player's
    # Pokémon in the Old Man slot or replace the source back art with Wally.
    patch('src/battle_interface.c', '    if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)\n        return;', '    if ((gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL) || WholeGame_IsFireRedOldManTutorialBattle() || WholeGame_IsFireRedTutorialBattle())\n        return;')
    reshow = read('src/reshow_battle_screen.c')
    old = '        else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL && battler == B_POSITION_PLAYER_LEFT) // Should be checking position, not battler.\n            DecompressTrainerBackPic(TRAINER_BACK_PIC_WALLY, battler);'
    new = old + '\n        else if (WholeGame_IsFireRedOldManTutorialBattle() && battler == B_POSITION_PLAYER_LEFT)\n            FR_DecompressTrainerBackPalette(FR_TRAINER_BACK_PIC_OLD_MAN, battler);'
    if new not in reshow:
        if old not in reshow: raise ValueError('missing trainer palette reload anchor')
        reshow = reshow.replace(old, new, 1)
    # Reuse the actual native sprite reload code with the distinct source slot.
    f = next(f for f in functions(reshow, 'x') if f.name == 'CreateBattlerSprite')
    if 'FR_TRAINER_BACK_PIC_OLD_MAN' not in f.source:
        match = re.search(r'        else if \(gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL && battler == B_POSITION_PLAYER_LEFT\)\n        \{', f.source)
        if not match: raise ValueError('missing back sprite reload branch')
        end = _end_balanced(f.source, f.source.index('{', match.start()))
        branch = f.source[match.start():end].replace('gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL', 'WholeGame_IsFireRedOldManTutorialBattle()').replace('TRAINER_BACK_PIC_WALLY', 'FR_TRAINER_BACK_PIC_OLD_MAN')
        new = f.source[:end] + '\n' + branch + f.source[end:]
        reshow = reshow[:f.start] + new + reshow[f.end:]
    reshow = reshow.replace('else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL && battler == B_POSITION_PLAYER_LEFT)\n            return;', 'else if (((gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL) || WholeGame_IsFireRedOldManTutorialBattle()) && battler == B_POSITION_PLAYER_LEFT)\n            return;')
    write('src/reshow_battle_screen.c', reshow)
    # Source Old Man hand position is x28 |32 =60, distinct from Wally's x64.
    # The native callback chain and translation table have identical behavior.
    throw = read('src/battle_anim_throw.c')
    f = next(f for f in functions(throw, 'x') if f.name == 'AnimTask_ThrowBall_StandingTrainer')
    if 'WholeGame_IsFireRedOldManTutorialBattle()' not in f.source:
        new = f.source.replace('    if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)', '    if (WholeGame_IsFireRedOldManTutorialBattle())\n    {\n        x = 28;\n        y = 11;\n    }\n    else if (gBattleTypeFlags & BATTLE_TYPE_WALLY_TUTORIAL)', 1)
        new = new.replace('gBallSpriteTemplates[ballId], x + 32,', 'gBallSpriteTemplates[ballId], WholeGame_IsFireRedOldManTutorialBattle() ? (x | 32) : (x + 32),')
        throw = throw[:f.start] + new + throw[f.end:]
    write('src/battle_anim_throw.c', throw)
    assets = []
    for src in ('graphics/trainers/back_pics/old_man_back_pic.png', 'graphics/trainers/palettes/old_man_back_pic.pal'):
        p = donor / src; target = 'graphics/firered_old_man/' + p.name
        assets.append({'source': src, 'target': target, 'sha256': _sha(p.read_bytes()), 'bytes': p.stat().st_size})
    unresolved = []
    available = set()
    for path in (out / 'src').rglob('*.c'):
        available.update(f.name for f in functions(path.read_text(), str(path)) if not f.static)
    for symbol in ('WholeGame_IsFireRedOldManTutorialBattle', 'FR_InitOldManBag'):
        if symbol not in available:
            unresolved.append({'kind': 'missing-old-man-provider', 'symbol': symbol})
    if not re.search(r'(?m)^FR_MUS_CAUGHT\s*=\s*[0-9A-Fa-f]{2}\s+[0-9A-Fa-f]{2}\s*$', read('charmap.txt')):
        unresolved.append({'kind': 'missing-original-caught-music', 'symbol': 'FR_MUS_CAUGHT'})
    if not (out / 'src/whole_game_battle_tutorial.c').exists() or 'FR_InitOldManBag();' not in (out / 'src/whole_game_battle_tutorial.c').read_text():
        unresolved.append({'kind': 'missing-original-complete-controller', 'symbol': 'FR_SetControllerToOakOrOldMan'})
    for name, value in changed.items():
        p = out / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(value)
    for asset in assets:
        p = out / asset['target']; p.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(donor / asset['source'], p)
    report = {'schemaVersion': 1, 'status': 'blocked' if unresolved else 'source-staged', 'ready': not unresolved,
        'buildEligible': not unresolved, 'unresolved': unresolved, 'files': sorted(changed), 'assets': assets,
        'nativeBackPicId': BACK_ID, 'donorBackPicId': 5, 'nativeOriginalBackPicIdsPreserved': list(range(8)),
        'caughtMessageStringId': string_id, 'outcomeScript': script,
        'sourceDataSha256': [_sha(value) for value in originals],
        'scope': ['original full shared Oak/OldMan controller', 'source back picture/animation and bag-return reload',
                  'distinct native mode predicate; no Wally bit alias', 'guaranteed3shake source catch script with endlinkbattle',
                  'no accepted party/box/Pokedex catch writes', 'native result/TV and seen-record suppression', 'source hand coordinate60'],
        'qualification': 'source staging only; original-source oracle, actual compiler and cartridge playback remain separate',
        'measurements': {'transformSeconds': time.monotonic() - started, 'queueSeconds': None, 'buildSeconds': None, 'nativePlaySeconds': None},
        'canonicalSourcesModified': False}
    if report_dir:
        p = Path(report_dir); p.mkdir(parents=True, exist_ok=True); (p / 'old-man-tutorial-ledger.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
