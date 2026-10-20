"""Source integration and exact scripted input oracle; no full ROM build."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from tools.whole_game.single_rom.battle_tutorial import stage_battle_tutorial, TARGET
from tools.whole_game.single_rom.old_man_tutorial import stage_old_man_tutorial, ASSET_C
from tools.whole_game.single_rom.native_services import functions
ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT/'local/decomps/pokeemerald'
DONOR = ROOT/'local/decomps/pokefirered'

@unittest.skipUnless(BASE.is_dir() and DONOR.is_dir(), 'local canonical sources unavailable')
class OldManTutorialTests(unittest.TestCase):
    def test_source_art_outcome_and_repeatability(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory)
            stage_battle_tutorial(BASE,DONOR,out)
            report=stage_old_man_tutorial(BASE,DONOR,out)
            self.assertFalse(report['ready']) # isolated fixture lacks real entry and bag providers
            self.assertEqual({x['symbol'] for x in report['unresolved']}, {'WholeGame_IsFireRedOldManTutorialBattle','FR_InitOldManBag','FR_MUS_CAUGHT'})
            self.assertEqual(report['nativeBackPicId'],8)
            for row in report['assets']:
                self.assertEqual((out/row['target']).read_bytes(),(DONOR/row['source']).read_bytes())
            self.assertIn('ANIMCMD_FRAME(1, 24)',(out/ASSET_C).read_text())
            commands=(out/'src/battle_script_commands.c').read_text()
            catch=next(f.source for f in functions(commands,'x') if f.name=='Cmd_handleballthrow')
            self.assertLess(catch.index('WholeGame_IsFireRedOldManTutorialBattle'),catch.index('BATTLE_TYPE_WALLY_TUTORIAL'))
            self.assertIn('BALL_3_SHAKES_SUCCESS',catch)
            script=report['outcomeScript']
            self.assertIn('B_OUTCOME_CAUGHT',script)
            self.assertIn('endlinkbattle',script)
            self.assertNotIn('givecaughtmon',script)
            self.assertNotIn('setcaught',script)
            for name in ('BattleIntroDrawTrainersOrMonsSprites','BattleIntroRecordMonsToDex'):
                f=next(f.source for f in functions((out/'src/battle_main.c').read_text(),'x') if f.name==name)
                self.assertIn('!WholeGame_IsFireRedOldManTutorialBattle()',f)
            throw=next(f.source for f in functions((out/'src/battle_anim_throw.c').read_text(),'x') if f.name=='AnimTask_ThrowBall_StandingTrainer')
            self.assertIn('x = 28;',throw)
            self.assertIn('? (x | 32) : (x + 32)',throw)
            first={str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()}
            stage_old_man_tutorial(BASE,DONOR,out)
            self.assertEqual(first,{str(p.relative_to(out)):p.read_bytes() for p in out.rglob('*') if p.is_file()})

    @unittest.skipUnless(shutil.which('cc'),'native compiler unavailable')
    def test_original_scripted_cursor_input_native_oracle(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory)
            stage_battle_tutorial(BASE,DONOR,out)
            original=next(f.source for f in functions((DONOR/'src/battle_controller_oak_old_man.c').read_text(),'x') if f.name=='SimulateInputChooseAction')
            emitted=next(f.source for f in functions((out/TARGET).read_text(),'x') if f.name=='FR_SimulateInputChooseAction')
            original=original.replace('SimulateInputChooseAction','OracleInput').replace('gBattleStruct->simulatedInputState','oracleState')
            # Test doubles only record renderer/controller calls in the oracle.
            harness='''#include <assert.h>
#include <string.h>
typedef unsigned char u8;
static u8 oracleState[4], FR_sOakSimulatedInputState[4];
static int events[2][16], counts[2], side;
#define SE_SELECT 5
#define B_ACTION_USE_ITEM 1
static void record(int x){events[side][counts[side]++]=x;}
static void PlaySE(int x){record(100+x);}
static void ActionSelectionDestroyCursorAt(int x){record(200+x);}
static void ActionSelectionCreateCursorAt(int x,int y){record(300+x*10+y);}
static void BtlController_EmitTwoReturnValues(int a,int b,int c){record(400+a*100+b*10+c);}
static void OakOldManBufferExecCompleted(void){record(900);}
static void FR_OakOldManBufferExecCompleted(void){record(900);}
'''+original+'\n'+emitted+'''
int main(void){int tick;for(tick=1;tick<=128;tick++){
side=0;OracleInput();side=1;FR_SimulateInputChooseAction();
assert(memcmp(oracleState,FR_sOakSimulatedInputState,4)==0);
assert(counts[0]==counts[1]);assert(memcmp(events[0],events[1],sizeof(events[0]))==0);
if(tick<64)assert(counts[0]==0);
if(tick==64){assert(counts[0]==3);assert(events[0][1]==200);assert(events[0][2]==310);}
if(tick==128){assert(counts[0]==6);assert(events[0][4]==510);assert(events[0][5]==900);}
}return 0;}
'''
            src=out/'oracle.c';src.write_text(harness);exe=out/'oracle'
            result=subprocess.run(['cc','-std=c99','-Wall','-Werror',str(src),'-o',str(exe)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(subprocess.run([str(exe)]).returncode,0)

if __name__=='__main__':unittest.main()
