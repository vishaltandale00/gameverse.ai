"""Original FireRed Old Man tutorial events on the composed game's native bag.

The host owns bag rendering, list/window/sprite resources, pocket transitions and
battle return. Donor source owns tutorial order, semantic pockets, demo items,
input suppression, clock barriers, backup/restoration and selected result.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path


def source_function(text, name):
    match = re.search(r'\b' + re.escape(name) + r'\([^;{}]*\)\s*\{', text)
    if not match:
        raise ValueError('missing donor function ' + name)
    start = match.end(); depth = 1
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/|[{}]',text[start:]):
        if token[0] == '{': depth += 1
        elif token[0] == '}': depth -= 1
        if depth == 0:
            return text[start:start+token.start()]
    raise ValueError('unterminated donor function ' + name)


def old_man_timing_oracle(donor_source):
    text = Path(donor_source).read_text()
    body = source_function(text,'Task_Bag_OldManTutorial')
    times = [int(n) for n in re.findall(r'case (\d+):',body)]
    if times != [102,204,306,408] or 'if (!gPaletteFade.active)' not in body:
        raise ValueError('unsupported donor Old Man tutorial timeline')
    required = ['SwitchPockets(taskId, 1, FALSE)', 'gSpecialVar_ItemId = ITEM_POKE_BALL',
                'OpenContextMenu(taskId)', 'DestroyListMenuTask(data[0], NULL, NULL)',
                'RestorePlayerBag()', 'data[8]++']
    if any(value not in body for value in required):
        raise ValueError('unsupported donor Old Man event ownership')
    return {'102':'key_items_pocket', '204':'poke_balls_pocket',
            '306':'poke_ball_use_cancel_context', '408':'restore_player_bag_then_close',
            'clock':'active tutorial task ticks; paused during palette fade and delegated pocket-switch task',
            'source_body_sha256':hashlib.sha256(body.encode()).hexdigest()}


RUNTIME = r'''
// Source-owned Old Man demo state; native bag list/render resources stay native.
struct WholeGameOldManBagBackup
{
    struct ItemSlot items[BAG_ITEMS_COUNT];
    struct ItemSlot keys[BAG_KEYITEMS_COUNT];
    struct ItemSlot balls[BAG_POKEBALLS_COUNT];
    struct BagPosition position;
    u16 registeredItem;
};
static EWRAM_DATA struct WholeGameOldManBagBackup *sWholeGameOldManBag = NULL;

static bool8 WholeGameIsOldManBag(void)
{
    return gBagPosition.location == ITEMMENULOCATION_OLD_MAN;
}

static void WholeGameRestoreOldManBag(void)
{
    memcpy(gSaveBlock1Ptr->bagPocket_Items, sWholeGameOldManBag->items, sizeof(sWholeGameOldManBag->items));
    memcpy(gSaveBlock1Ptr->bagPocket_KeyItems, sWholeGameOldManBag->keys, sizeof(sWholeGameOldManBag->keys));
    memcpy(gSaveBlock1Ptr->bagPocket_PokeBalls, sWholeGameOldManBag->balls, sizeof(sWholeGameOldManBag->balls));
    gSaveBlock1Ptr->registeredItem = sWholeGameOldManBag->registeredItem;
    gBagPosition = sWholeGameOldManBag->position;
    Free(sWholeGameOldManBag);
    sWholeGameOldManBag = NULL;
}

// Public controller entry: separate from Wally and from normal interactive bag.
void FR_InitOldManBag(void)
{
    sWholeGameOldManBag = AllocZeroed(sizeof(*sWholeGameOldManBag));
    if (sWholeGameOldManBag == NULL)
    {
        // Allocation failure is visible and leaves the persistent bag untouched.
        gSpecialVar_ItemId = ITEM_NONE;
        SetMainCallback2(CB2_SetUpReshowBattleScreenAfterMenu2);
        return;
    }
    memcpy(sWholeGameOldManBag->items, gSaveBlock1Ptr->bagPocket_Items, sizeof(sWholeGameOldManBag->items));
    memcpy(sWholeGameOldManBag->keys, gSaveBlock1Ptr->bagPocket_KeyItems, sizeof(sWholeGameOldManBag->keys));
    memcpy(sWholeGameOldManBag->balls, gSaveBlock1Ptr->bagPocket_PokeBalls, sizeof(sWholeGameOldManBag->balls));
    sWholeGameOldManBag->position = gBagPosition;
    sWholeGameOldManBag->registeredItem = gSaveBlock1Ptr->registeredItem;
    ClearItemSlots(gSaveBlock1Ptr->bagPocket_Items, BAG_ITEMS_COUNT);
    ClearItemSlots(gSaveBlock1Ptr->bagPocket_KeyItems, BAG_KEYITEMS_COUNT);
    ClearItemSlots(gSaveBlock1Ptr->bagPocket_PokeBalls, BAG_POKEBALLS_COUNT);
    gSaveBlock1Ptr->registeredItem = ITEM_NONE;
    ResetBagScrollPositions();
    AddBagItem(ITEM_POTION, 1);
    AddBagItem(ITEM_POKE_BALL, 1);
    GoToBagMenu(ITEMMENULOCATION_OLD_MAN, ITEMS_POCKET, CB2_SetUpReshowBattleScreenAfterMenu2);
    if (gBagMenu == NULL)
    {
        WholeGameRestoreOldManBag();
        gSpecialVar_ItemId = ITEM_NONE;
    }
}

static void WholeGameOldManWaitFadeAndExit(u8 taskId)
{
    if (!gPaletteFade.active)
    {
        SetMainCallback2(CB2_SetUpReshowBattleScreenAfterMenu2);
        BagDestroyPocketScrollArrowPair();
        ResetSpriteData();
        FreeAllSpritePalettes();
        FreeBagMenu();
        DestroyTask(taskId);
    }
}

static void Task_WholeGameOldManBag(u8 taskId)
{
    s16 *data = gTasks[taskId].data;
    if (!gPaletteFade.active)
    {
        switch (data[8])
        {
        case 102:
        case 204:
            PlaySE(FR_SE_BAG_POCKET);
            SwitchBagPocket(taskId, MENU_CURSOR_DELTA_RIGHT, FALSE);
            break;
        case 306:
            PlaySE(FR_SE_SELECT);
            BagMenu_PrintCursor(tListTaskId, COLORID_GRAY_CURSOR);
            gSpecialVar_ItemId = ITEM_POKE_BALL;
            OpenContextMenu(taskId);
            break;
        case 408:
            PlaySE(FR_SE_SELECT);
            RemoveContextWindow();
            DestroyListMenuTask(tListTaskId, NULL, NULL);
            WholeGameRestoreOldManBag();
            BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_BLACK);
            gTasks[taskId].func = WholeGameOldManWaitFadeAndExit;
            return;
        }
        data[8]++;
    }
}
'''


def stage_old_man_bag(emerald_source, firered_source, output_tree, report_dir=None):
    host, donor, stage = [Path(p).resolve() for p in (emerald_source,firered_source,output_tree)]
    if any(stage == source or source in stage.parents or stage in source.parents for source in (host,donor)):
        raise ValueError('output must be isolated from canonical sources')
    hashes, files = {}, []
    def read(root, rel):
        data=(root/rel).read_text()
        hashes[('firered/' if root==donor else 'staged/')+rel]=hashlib.sha256(data.encode()).hexdigest()
        return data
    def write(rel,data):
        path=stage/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(data);files.append(rel)
    def once(text,old,new):
        if text.count(old)!=1: raise ValueError('unsupported source revision: '+old[:90])
        return text.replace(old,new,1)
    oracle=old_man_timing_oracle(donor/'src/item_menu.c')
    read(donor,'src/item_menu.c')
    header=read(stage,'include/item_menu.h')
    header=once(header,'    ITEMMENULOCATION_LAST,','    ITEMMENULOCATION_OLD_MAN,\n    ITEMMENULOCATION_LAST,')
    write('include/item_menu.h',header)
    write('include/whole_game_old_man_bag.h','#ifndef GUARD_WHOLE_GAME_OLD_MAN_BAG_H\n#define GUARD_WHOLE_GAME_OLD_MAN_BAG_H\nvoid FR_InitOldManBag(void);\n#endif\n')
    text=read(stage,'src/item_menu.c')
    # Declarations precede task selection; implementation follows native private
    # helpers and task-data macros so no cross-TU private ABI is invented.
    text='#include "whole_game_old_man_bag.h"\n#include "constants/fr_audio.h"\n'+text
    text=once(text,'static bool8 IsWallysBag(void);','static bool8 IsWallysBag(void);\nstatic bool8 WholeGameIsOldManBag(void);\nstatic void Task_WholeGameOldManBag(u8 taskId);')
    text=once(text,'    [ITEMMENULOCATION_PCBOX] =                  Task_ItemContext_GiveToPC','    [ITEMMENULOCATION_OLD_MAN] =                NULL,\n    [ITEMMENULOCATION_PCBOX] =                  Task_ItemContext_GiveToPC')
    text=once(text,'    if (location == ITEMMENULOCATION_WALLY)\n        taskId = CreateTask(Task_WallyTutorialBagMenu, 0);','    if (location == ITEMMENULOCATION_OLD_MAN)\n        taskId = CreateTask(Task_WholeGameOldManBag, 0);\n    else if (location == ITEMMENULOCATION_WALLY)\n        taskId = CreateTask(Task_WallyTutorialBagMenu, 0);')
    text=once(text,'    if (gBagPosition.location == ITEMMENULOCATION_WALLY)\n        return TRUE;', '    if (gBagPosition.location == ITEMMENULOCATION_WALLY || WholeGameIsOldManBag())\n        return TRUE;')
    text=once(text,'    case ITEMMENULOCATION_WALLY:\n        if (GetItemBattleUsage', '    case ITEMMENULOCATION_WALLY:\n    case ITEMMENULOCATION_OLD_MAN:\n        if (GetItemBattleUsage')
    # Both the transition preview and transition commit use this native helper.
    # Native pocket IDs are never relabeled globally or fed donor numeric values.
    needle='static void ChangeBagPocketId(u8 *bagPocketId, s8 deltaBagPocketId)\n{'
    native_order=r'''
    if (WholeGameIsOldManBag())
    {
        if (deltaBagPocketId == MENU_CURSOR_DELTA_RIGHT)
            *bagPocketId = *bagPocketId == ITEMS_POCKET ? KEYITEMS_POCKET : *bagPocketId == KEYITEMS_POCKET ? BALLS_POCKET : ITEMS_POCKET;
        else
            *bagPocketId = *bagPocketId == ITEMS_POCKET ? BALLS_POCKET : *bagPocketId == BALLS_POCKET ? KEYITEMS_POCKET : ITEMS_POCKET;
        return;
    }
'''
    text=once(text,needle,needle+native_order)
    # Tutorial only exposes its three semantic pocket indicators in source order.
    needle='static void DrawPocketIndicatorSquare(u8 x, bool8 isCurrentPocket)\n{'
    text=once(text,needle,needle+'\n    if (WholeGameIsOldManBag())\n        x = x == ITEMS_POCKET ? 0 : x == KEYITEMS_POCKET ? 1 : 2;')
    # Native close destroys the list again, so the source-owned 408 transition
    # uses its own native teardown callback after exactly one list destruction.
    text += '\n'+RUNTIME
    write('src/item_menu.c',text)
    ledger={'schema_version':1,'semantic_coverage_complete':True,'unsupported':[],
            'patched_files':files,'source_hashes':hashes,'timing_oracle':oracle,
            'api':{'header':'include/whole_game_old_man_bag.h','function':'void FR_InitOldManBag(void)'},
            'ownership_policy':{'tutorial':'original FireRed Old Man source event semantics',
                                'presentation':'Emerald native shared bag renderer, artwork, window layout, item labels/icons and pocket animation lifecycle',
                                'deliberate_differences':['native bag graphics/layout instead of a duplicate FireRed menu','native pocket-transition animation duration; original tutorial-active tick barriers retained','native resource teardown; original -2 fade speed and restore-before-exit order retained']},
            'bag_state':['items','key items','balls','registered item','all pocket cursors/scroll positions','prior native bag position'],
            'resource_lifecycle':['native bag setup/list/window/sprite allocation','native pocket transition followup tasks','one list destroy before restore','palette fade completion','native sprite/palette/window/list buffer cleanup','native battle reshow callback'],
            'input_policy':'source-owned task ignores user keys; native pocket-switch input suppressed by tutorial predicate',
            'outcome':'ITEM_POKE_BALL selected at306 and retained across restoration/exit',
            'dependencies':['audio:FR_SE_BAG_POCKET','native bag item and battle reshow services'],
            'measurements':{'rom_build_seconds':None,'reason':'source stage only; scoped native compilation evidence recorded separately'}}
    ledger['providers'] = [{'name':'InitOldManBag','target':'FR_InitOldManBag',
                            'status':'source-ported','source':'src/item_menu.c:InitOldManBag + Task_Bag_OldManTutorial',
                            'sourceSha256':hashes['firered/src/item_menu.c'],
                            'translationUnit':'src/item_menu.c',
                            'bindings':['source timing/pockets/selection/restore','shared native bag rendering and resource lifecycle','native battle reshow callback'],
                            'blockers':[],
                            'qualification':'native source task oracle and scoped toolchain compilation; cartridge scene remains unqualified'}]
    if report_dir:
        output=Path(report_dir);output.mkdir(parents=True,exist_ok=True)
        (output/'old-man-bag-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
