from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from .link_services import stage_link_services
from .native_services import functions

ROOT=Path(__file__).resolve().parents[3]
BASE,DONOR=[ROOT/'local/decomps'/n for n in ['pokeemerald','pokefirered']]
FILES=['src/cable_club.c','src/link.c','src/union_room.c','src/trade.c','src/wonder_news.c','src/field_control_avatar.c']

class LinkServicesTests(unittest.TestCase):
    def stage(self,tmp):
        out=Path(tmp)/'merged'
        for name in FILES:
            (out/name).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(BASE/name,out/name)
        return out,stage_link_services(BASE,DONOR,out)

    def test_source_data_and_native_scene(self):
        with tempfile.TemporaryDirectory() as tmp:
            out,receipt=self.stage(tmp)
            self.assertEqual(receipt['coverage']['tradeRecords'],9)
            trade=(out/'src/trade.c').read_text()
            self.assertIn('WholeGame_IsKanto() ? &sFRInGameTrades[gSpecialVar_0x8004]',trade)
            self.assertIn('gTradeMail[0] = mail;',trade)
            self.assertIn('FR_HelpSystem_Disable();',trade)
            self.assertIn('MON_DATA_MET_LOCATION',trade)
            data=(out/'src/data/whole_game_fr_ingame_trades.h').read_text()
            for original in ['MIMIEN','ZYNX','REYLEY','DONTAE','0x498a2e1d','ITEM_FAB_MAIL']:
                self.assertIn(original,data)
            link=(out/'src/link.c').read_text()
            self.assertIn('RfuSetIgnoreError(TRUE);',link)
            self.assertIn('FR_QL_STATE_PLAYBACK_LAST',link)
            self.assertIn('if (WholeGame_IsKanto()) WonderNews_IncrementStepCounter();',(out/'src/field_control_avatar.c').read_text())
            with self.assertRaises(ValueError):stage_link_services(BASE,DONOR,out)

    def test_canonical_refused(self):
        with self.assertRaises(ValueError):stage_link_services(BASE,DONOR,BASE)

    def test_actual_reward_cooldown_source(self):
        # Compile original native metadata/cooldown + actual imported donor
        # reward policy against observable flag, RNG and save primitives.
        with tempfile.TemporaryDirectory() as tmp:
            out,_=self.stage(tmp)
            donor_defs={f.name:f.source for f in functions((out/'src/wonder_news.c').read_text(),'wonder_news.c')}
            names=['GetRewardItem','GetRewardType','IncrementRewardCounter','IncrementSentRewardCounter','ResetSentRewardCounter','WonderNews_IncrementStepCounter','FR_Link_IsMysteryGiftEnabled','FR_WonderNews_GetRewardInfo']
            pre='''#include <assert.h>
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;typedef int bool32;
#define TRUE 1
#define FALSE 0
#define MAX_REWARD 5
#define MAX_SENT_REWARD 4
#define FIRST_BERRY_INDEX 133
#define VAR_WONDER_NEWS_STEP_COUNTER 1
#define FR_FLAG_SYS_MYSTERY_GIFT_ENABLED 0x1839
#define ABSPATH(x) x
#define AGB_ASSERT_EX(a,b,c) assert(a)
#define AGB_ASSERT(a) assert(a)
enum {WONDER_NEWS_NONE,WONDER_NEWS_RECV_FRIEND,WONDER_NEWS_RECV_WIRELESS,WONDER_NEWS_SENT};
enum {NEWS_REWARD_NONE,NEWS_REWARD_RECV_SMALL,NEWS_REWARD_RECV_BIG,NEWS_REWARD_SENT_SMALL,NEWS_REWARD_SENT_BIG,NEWS_REWARD_WAITING,NEWS_REWARD_AT_MAX};
struct WonderNewsMetadata {u32 newsType, sentRewardCounter, rewardCounter, berry;};
static struct WonderNewsMetadata metadata;
static u16 steps,gSpecialVar_Result;static int enabled=1,valid=1;
struct WonderNewsMetadata *GetSavedWonderNewsMetadata(void){return &metadata;}
u16 *GetVarPointer(u16 id){assert(id==VAR_WONDER_NEWS_STEP_COUNTER);return &steps;}
int FlagGet(u16 id){assert(id==FR_FLAG_SYS_MYSTERY_GIFT_ENABLED);return enabled;}
int ValidateSavedWonderNews(void){return valid;}
'''
            declarations='\n'.join(donor_defs[n].split('{',1)[0].strip()+';' for n in names)
            main='''
int main(void){int i; metadata.newsType=WONDER_NEWS_SENT;metadata.berry=7;
 enabled=0;assert(FR_WonderNews_GetRewardInfo()==NEWS_REWARD_NONE);assert(metadata.berry==7);
 enabled=1;valid=0;assert(FR_WonderNews_GetRewardInfo()==NEWS_REWARD_NONE);valid=1;
 for(i=0;i<4;i++){metadata.newsType=WONDER_NEWS_SENT;metadata.berry=7;
 assert(FR_WonderNews_GetRewardInfo()==(i==3?NEWS_REWARD_SENT_BIG:NEWS_REWARD_SENT_SMALL));assert(gSpecialVar_Result==139);}
 metadata.newsType=WONDER_NEWS_RECV_WIRELESS;metadata.berry=9;assert(FR_WonderNews_GetRewardInfo()==NEWS_REWARD_RECV_BIG);
 metadata.newsType=WONDER_NEWS_SENT;metadata.berry=7;assert(FR_WonderNews_GetRewardInfo()==NEWS_REWARD_AT_MAX);assert(metadata.berry==7);
 for(i=0;i<499;i++)WonderNews_IncrementStepCounter();assert(metadata.rewardCounter==5);assert(steps==499);
 WonderNews_IncrementStepCounter();assert(metadata.rewardCounter==0);assert(steps==0);assert(FR_WonderNews_GetRewardInfo()==NEWS_REWARD_SENT_SMALL);return 0;}
'''
            c=Path(tmp)/'reward.c';c.write_text(pre+declarations+'\n'+'\n'.join(donor_defs[n] for n in names)+main)
            compiled=subprocess.run(['clang','-std=c99','-Werror',str(c),'-o',str(Path(tmp)/'reward')],capture_output=True,text=True)
            self.assertEqual(compiled.returncode,0,compiled.stderr)
            subprocess.run([str(Path(tmp)/'reward')],check=True,capture_output=True)

if __name__=='__main__':unittest.main()
