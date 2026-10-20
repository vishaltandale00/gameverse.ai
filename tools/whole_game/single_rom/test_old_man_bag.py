"""Source event oracle and compiled native state/task ownership checks."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from .old_man_bag import stage_old_man_bag, old_man_timing_oracle, source_function, RUNTIME

ROOT=Path(__file__).resolve().parents[3]
HOST=ROOT/'local/decomps/pokeemerald'
DONOR=ROOT/'local/decomps/pokefirered'


class OldManBagTests(unittest.TestCase):
    def test_source_oracle_and_native_task_lifecycle(self):
        oracle=old_man_timing_oracle(DONOR/'src/item_menu.c')
        self.assertEqual([key for key in oracle if key.isdigit()],['102','204','306','408'])
        canonical={(root/rel):(root/rel).read_bytes() for root in (HOST,DONOR) for rel in ['src/item_menu.c','include/item_menu.h']}
        with tempfile.TemporaryDirectory(prefix='whole-game-old-man-bag-') as directory:
            stage=Path(directory)
            for rel in ['src/item_menu.c','include/item_menu.h']:
                dest=stage/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy(HOST/rel,dest)
            ledger=stage_old_man_bag(HOST,DONOR,stage)
            self.assertTrue(ledger['semantic_coverage_complete'])
            text=(stage/'src/item_menu.c').read_text()
            self.assertIn('CreateTask(Task_WholeGameOldManBag, 0)',text)
            self.assertIn('location == ITEMMENULOCATION_WALLY || WholeGameIsOldManBag()',text)
            self.assertIn('case ITEMMENULOCATION_OLD_MAN:',text)
            change=source_function(text,'ChangeBagPocketId')
            fixture=r'''
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
typedef uint8_t u8; typedef int8_t s8; typedef uint16_t u16; typedef int16_t s16;
typedef u8 bool8;
#define TRUE 1
#define FALSE 0
#define EWRAM_DATA
#define BAG_ITEMS_COUNT 3
#define BAG_KEYITEMS_COUNT 4
#define BAG_POKEBALLS_COUNT 5
#define POCKETS_COUNT 5
#define ITEMS_POCKET 0
#define BALLS_POCKET 1
#define KEYITEMS_POCKET 4
#define ITEMMENULOCATION_OLD_MAN 12
#define ITEM_NONE 0
#define ITEM_POTION 13
#define ITEM_POKE_BALL 4
#define MENU_CURSOR_DELTA_RIGHT 1
#define MENU_CURSOR_DELTA_LEFT -1
#define FR_SE_BAG_POCKET 111
#define FR_SE_SELECT 5
#define COLORID_GRAY_CURSOR 2
#define PALETTES_ALL 0xffffffff
#define RGB_BLACK 0
#define tListTaskId data[0]
struct ItemSlot {u16 itemId, quantity;};
struct BagPosition {void (*exitCallback)(void);u8 location,pocket;u16 pocketSwitchArrowPos,cursorPosition[5],scrollPosition[5];};
struct Save {struct ItemSlot bagPocket_Items[3],bagPocket_KeyItems[4],bagPocket_PokeBalls[5];u16 registeredItem;};
static struct Save save; static struct Save *gSaveBlock1Ptr=&save;
static struct BagPosition gBagPosition;
static struct {int active;} gPaletteFade;
static struct BagMenu {int x;} menu; static struct BagMenu *gBagMenu;
static struct Task {void (*func)(u8);s16 data[16];} gTasks[1];
static u16 gSpecialVar_ItemId;
static int allocFail,events[8],eventCount,destroyListCount,resourceCloseCount,returnCount,fadeDelay;
static void Task_WholeGameOldManBag(u8 id);
static void ChangeBagPocketId(u8 *pocket,s8 delta);
static void transition(u8 id) {(void)id;}
static void CB2_SetUpReshowBattleScreenAfterMenu2(void) {returnCount++;}
static void *AllocZeroed(size_t n) {return allocFail?NULL:calloc(1,n);}
static void Free(void *p) {free(p);}
static void SetMainCallback2(void (*callback)(void)) {callback();}
static void ClearItemSlots(struct ItemSlot *slots,u16 n) {memset(slots,0,n*sizeof(*slots));}
static void ResetBagScrollPositions(void) {gBagPosition.pocket=0;memset(gBagPosition.cursorPosition,0,sizeof(gBagPosition.cursorPosition));memset(gBagPosition.scrollPosition,0,sizeof(gBagPosition.scrollPosition));}
static void AddBagItem(u16 item,u16 count) {struct ItemSlot *p=item==ITEM_POTION?save.bagPocket_Items:save.bagPocket_PokeBalls;p[0].itemId=item;p[0].quantity=count;}
static void GoToBagMenu(u8 location,u8 pocket,void (*callback)(void)) {gBagMenu=&menu;gBagPosition.location=location;gBagPosition.pocket=pocket;gBagPosition.exitCallback=callback;gTasks[0].func=Task_WholeGameOldManBag;}
static void PlaySE(u16 id) {(void)id;}
static void SwitchBagPocket(u8 id,s16 delta,bool8 erase) {u8 preview=gBagPosition.pocket;(void)erase;ChangeBagPocketId(&preview,delta);ChangeBagPocketId(&gBagPosition.pocket,delta);assert(preview==gBagPosition.pocket);events[eventCount++]=gTasks[id].data[8];gTasks[id].func=transition;}
static void BagMenu_PrintCursor(u8 task,u8 color) {(void)task;(void)color;assert(gBagPosition.pocket==BALLS_POCKET);}
static void OpenContextMenu(u8 task) {assert(gSpecialVar_ItemId==ITEM_POKE_BALL);events[eventCount++]=gTasks[task].data[8];}
static void RemoveContextWindow(void) {assert(eventCount==3);}
static void DestroyListMenuTask(u8 id,void *a,void *b) {(void)id;(void)a;(void)b;destroyListCount++;}
static void BeginNormalPaletteFade(unsigned mask,int delay,int start,int end,int color) {(void)mask;(void)start;(void)end;(void)color;fadeDelay=delay;gPaletteFade.active=1;events[eventCount++]=gTasks[0].data[8];}
static void BagDestroyPocketScrollArrowPair(void) {resourceCloseCount++;}
static void ResetSpriteData(void) {resourceCloseCount++;}
static void FreeAllSpritePalettes(void) {resourceCloseCount++;}
static void FreeBagMenu(void) {resourceCloseCount++;}
static void DestroyTask(u8 id) {gTasks[id].func=NULL;resourceCloseCount++;}
'''
            fixture += RUNTIME + '\nstatic void ChangeBagPocketId(u8 *bagPocketId,s8 deltaBagPocketId) {'+change+'}\n'
            fixture += r'''
int main(void) {
 struct Save before; struct BagPosition beforePosition;unsigned i;int count;
 memset(&save,0x5a,sizeof(save));memset(&gBagPosition,0x12,sizeof(gBagPosition));
 gBagPosition.exitCallback=NULL;before=save;beforePosition=gBagPosition;
 FR_InitOldManBag();
 assert(save.bagPocket_Items[0].itemId==ITEM_POTION);
 assert(save.bagPocket_PokeBalls[0].itemId==ITEM_POKE_BALL);
 assert(save.bagPocket_KeyItems[0].itemId==ITEM_NONE);
 assert(save.registeredItem==ITEM_NONE);
 gPaletteFade.active=1;for(i=0;i<30;i++)gTasks[0].func(0);assert(gTasks[0].data[8]==0);
 gPaletteFade.active=0;
 while(gTasks[0].data[8]<=408 && eventCount<4) {
  gTasks[0].func(0);
  if(gTasks[0].func==transition) {
   count=gTasks[0].data[8];for(i=0;i<17;i++)gTasks[0].func(0);assert(gTasks[0].data[8]==count);
   if(count==103)assert(gBagPosition.pocket==KEYITEMS_POCKET);
   if(count==205)assert(gBagPosition.pocket==BALLS_POCKET);
   gTasks[0].func=Task_WholeGameOldManBag;
  }
 }
 assert(eventCount==4);assert(events[0]==102&&events[1]==204&&events[2]==306&&events[3]==408);
 assert(!memcmp(&save,&before,sizeof(save)));assert(!memcmp(&gBagPosition,&beforePosition,sizeof(gBagPosition)));
 assert(gSpecialVar_ItemId==ITEM_POKE_BALL);assert(destroyListCount==1);assert(resourceCloseCount==0);assert(fadeDelay==-2);
 gTasks[0].func(0);assert(returnCount==0);gPaletteFade.active=0;gTasks[0].func(0);
 assert(returnCount==1&&resourceCloseCount==5);assert(sWholeGameOldManBag==NULL);
 allocFail=1;FR_InitOldManBag();assert(returnCount==2);assert(gSpecialVar_ItemId==ITEM_NONE);assert(!memcmp(&save,&before,sizeof(save)));
 return 0;
}
'''
            probe=stage/'probe.c';probe.write_text(fixture)
            result=subprocess.run(['cc','-std=gnu89','-Wall','-Werror','-Wdeclaration-after-statement',str(probe),'-o',str(stage/'probe')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(stage/'probe')],check=True,capture_output=True)
        for path,data in canonical.items():self.assertEqual(path.read_bytes(),data)


if __name__=='__main__':unittest.main()
