import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from .vs_seeker import stage_vs_seeker
from .native_services import functions
from .encounters import array_span
from .state import namespace_header

ROOT=Path(__file__).resolve().parents[3]
BASE,DONOR=[ROOT/'local/decomps'/name for name in ('pokeemerald','pokefirered')]
FILES=['include/pokemon_storage_system.h','include/constants/field_effects.h','include/item_use.h','src/item_use.c','src/data/items.h','src/field_control_avatar.c','src/overworld.c','data/field_effect_scripts.s']

class VsSeekerTests(unittest.TestCase):
    def stage(self,path):
        out=path/'merged'
        for name in FILES:
            (out/name).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(BASE/name,out/name)
        storage=out/'include/pokemon_storage_system.h'
        storage.write_text(storage.read_text().replace('    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];','    /*0x83C2*/ u8 boxWallpapers[TOTAL_BOXES_COUNT];\n    struct {u16 trainerRematchStepCounter;u8 trainerRematches[100];} wholeGameKanto;'))
        return out,stage_vs_seeker(BASE,DONOR,out)

    def test_source_and_native_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            out,receipt=self.stage(Path(tmp))
            self.assertEqual(receipt['coverage']['sourceFunctions'],41)
            self.assertEqual(receipt['coverage']['sourceMaxTrainerTemplates'],13)
            self.assertEqual(receipt['coverage']['fieldEffectId'],67)
            source=(out/'src/firered_vs_seeker.c').read_text()
            self.assertIn('gPokemonStoragePtr->wholeGameKanto.trainerRematches',source)
            self.assertNotIn('gSaveBlock1Ptr->trainerRematches',source)
            self.assertIn('FR_GetRematchTrainerId',receipt['exportedSymbols'])
            self.assertIn('FR_QuestLog_GetTrainerRematchArray',receipt['exportedSymbols'])
            original_names={f.name for f in functions((DONOR/'src/vs_seeker.c').read_text(),'donor')}
            emitted_names={f.name for f in functions(source,'out')}
            self.assertTrue({'FR_'+name for name in original_names} <= emitted_names)
            field=(out/'src/field_control_avatar.c').read_text()
            self.assertLess(field.index('if (FR_UpdateVsSeekerStepCounter()'),field.index('if (UpdatePoisonStepCounter()'))
            self.assertIn('.fieldUseFunc = FR_FieldUseFunc_VsSeeker',(out/'src/data/items.h').read_text())
            effect=(out/'src/firered_vs_seeker_effect.c').read_text()
            self.assertIn('WholeGameSetPlayerGraphicsBank(TRUE)',effect)
            self.assertIn('WholeGameSetPlayerGraphicsBank(FALSE)',effect)
            self.assertIn('PLAYER_AVATAR_STATE_ACRO_BIKE',effect)
            self.assertIn('PLAYER_AVATAR_STATE_MACH_BIKE',effect)
            with self.assertRaises(ValueError):stage_vs_seeker(BASE,DONOR,out)

    def test_canonical_refused(self):
        with self.assertRaises(ValueError):stage_vs_seeker(BASE,DONOR,BASE)

    def test_compiled_charge_rematch_and_duplicate_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            out,_=self.stage(Path(tmp));source=(out/'src/firered_vs_seeker.c').read_text()
            indexed={f.name:f.source for f in functions(source,'out')}
            # Compile actual source data and gameplay functions against observable
            # engine primitives. The GBA compile is a separate retained witness.
            definitions='''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
#include <string.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;typedef int16_t s16;typedef int32_t s32;typedef uint8_t bool8;typedef int bool32;
#define TRUE 1
#define FALSE 0
#define OBJECT_EVENTS_COUNT 16
#define LOCALID_PLAYER 255
#define ARRAY_COUNT(a) (sizeof(a)/sizeof(*(a)))
#define NELEMS ARRAY_COUNT
#define ITEM_VS_SEEKER 367
#define MAP_GROUP(n) ((n)>>8)
#define MAP_NUM(n) ((n)&255)
#define FRVS_MAP(n) MAP_GROUP(n),MAP_NUM(n)
'''
            definitions+=namespace_header(DONOR)
            for name,value in re.findall(r'^#define\s+(TRAINER_\w+)\s+(0x[\da-fA-F]+|\d+)\b',(DONOR/'include/constants/opponents.h').read_text(),re.M):
                definitions+=f'#define FR_{name} {int(value,0)+4096 if int(value,0) else 0}\n'
            groups=json.loads((DONOR/'data/maps/map_groups.json').read_text())
            for group_index,group in enumerate(groups['group_order']):
                for index,name in enumerate(groups[group]):
                    data=json.loads((DONOR/f'data/maps/{name}/map.json').read_text());identifier=data['id']
                    definitions+=f'#define MAP_FR_{identifier[4:]} {((group_index+34)<<8)|index}\n'
            for name,value in re.findall(r'^#define\s+((?:MOVEMENT_ACTION|MOVEMENT_TYPE)_\w+)\s+(0x[\da-fA-F]+|\d+)\b',(BASE/'include/constants/event_object_movement.h').read_text(),re.M):definitions+=f'#define {name} {value}\n'
            definitions+='''#define FR_MOVEMENT_TYPE_RAISE_HAND_AND_STOP 81
#define FR_MOVEMENT_TYPE_RAISE_HAND_AND_JUMP 82
#define FR_MOVEMENT_TYPE_RAISE_HAND_AND_SWIM 83
#define FR_MOVEMENT_ACTION_EMOTE_X 177
#define FR_MOVEMENT_ACTION_EMOTE_DOUBLE_EXCL_MARK 178
'''
            for name,value in re.findall(r'^#define\s+(OBJ_EVENT_GFX_\w+)\s+(0x[\da-fA-F]+|\d+)\b',(DONOR/'include/constants/event_objects.h').read_text(),re.M):definitions+=f'#define FRVS_RAW_{name} {value}\n'
            definitions+='''struct {struct {u16 trainerRematchStepCounter;u8 trainerRematches[100];} wholeGameKanto;} pc;
#define gPokemonStoragePtr (&pc)
u16 nativeCounter=1234;u8 nativeRematches[100];
struct ObjectEvent {u8 active,localId,spriteId;};struct ObjectEvent gObjectEvents[16];
struct Sprite {s16 data[8];};struct Sprite gSprites[16];
struct {u8 objectEventCount;} events;
struct {typeof(events)*events;} gMapHeader={&events};
u16 gSpecialVar_LastTalked,gTrainerBattleOpponent_A;
u8 flags[0x2000],fought[0x2000];int haveItem,rngCalls,movementCount;u16 rngValues[16];
const u8 *lastMovement[16];
bool8 FlagGet(u16 id){return flags[id];}
void FlagSet(u16 id){flags[id]=1;}
void FlagClear(u16 id){flags[id]=0;}
bool8 HasTrainerBeenFought(u16 id){assert(id<0x2000);return fought[id];}
bool8 CheckBagHasItem(u16 item,u16 count){return haveItem;}
void PlayerGetDestCoords(s16*x,s16*y){*x=*y=7;}
u16 Random(void){return rngValues[rngCalls++];}
void ShiftStillObjectEventCoords(struct ObjectEvent*o){}
void PlaySE(u16 se){}
#define FR_SE_PIN 1
#define FR_SE_CONTEST_MONS_TURN 2
#define FR_FLDEFF_USE_VS_SEEKER 69
static void FR_VS_SetBattledTrainerFlag(void){fought[gTrainerBattleOpponent_A]=1;}
'''
            a=source.index('// Each trainer can have');b=source.index('// static declarations',a)
            declarations=source[a:b]
            a,b=array_span(source,'sRematches');declarations+='static const struct RematchData sRematches[]={'+source[a:b]+'};\n'
            for name in ['sMovementScript_TrainerUnfought','sMovementScript_TrainerNoRematch','sMovementScript_TrainerRematch']:
                a,b=array_span(source,name);declarations+='static const u8 '+name+'[]={'+source[a:b]+'};\n'
            declarations+='static struct VsSeekerStruct storage,*sFRVsSeeker=&storage;\n'
            declarations+='static void FR_StartTrainerObjectMovementScript(struct VsSeekerTrainerInfo *trainer,const u8*script){lastMovement[trainer->localId]=script;movementCount++;}\n'
            selected=['FR_VsSeekerResetInBagStepCounter','FR_VsSeekerResetChargingStepCounter','FR_ClearAllTrainerRematchStates','FR_UpdateVsSeekerStepCounter','FR_GetRematchTrainerIdGivenGameState','FR_TryGetRematchTrainerIdGivenGameState','FR_GetNextAvailableRematchTrainer','FR_GetRematchTrainerId','FR_IsThisTrainerRematchable','FR_GetRematchIdx','FR_ShouldTryRematchBattleInternal','FR_HasRematchTrainerAlreadyBeenFought','FR_ShouldTryRematchBattle','FR_LookupVsSeekerOpponentInArray','FR_IsTrainerReadyForRematchInternal','FR_IsTrainerReadyForRematch','FR_ClearRematchStateOfLastTalked','FR_ObjectEventIdIsSane','FR_IsTrainerVisibleOnScreen','FR_GetCurVsSeekerResponse','FR_GetRunningBehaviorFromGraphicsId','FR_GetVsSeekerResponseInArea']
            prototypes='\n'.join(indexed[n][:indexed[n].index('{')].strip()+';' for n in selected)
            body='\n'.join(indexed[n] for n in selected)
            main='''int main(void){
 memset(nativeRematches,7,sizeof(nativeRematches));
 assert(!FR_UpdateVsSeekerStepCounter());assert(pc.wholeGameKanto.trainerRematchStepCounter==0);
 haveItem=1;for(int i=0;i<105;i++)assert(!FR_UpdateVsSeekerStepCounter());assert(pc.wholeGameKanto.trainerRematchStepCounter==100);
 pc.wholeGameKanto.trainerRematchStepCounter|=99<<8;pc.wholeGameKanto.trainerRematches[5]=4;FlagSet(FR_FLAG_SYS_VS_SEEKER_CHARGING);
 assert(FR_UpdateVsSeekerStepCounter());assert(pc.wholeGameKanto.trainerRematchStepCounter==100);assert(!pc.wholeGameKanto.trainerRematches[5]);assert(!FlagGet(FR_FLAG_SYS_VS_SEEKER_CHARGING));
 assert(nativeCounter==1234&&nativeRematches[5]==7);
 u16 first=sRematches[0].trainerIdxs[0],second=sRematches[0].trainerIdxs[1],third=sRematches[0].trainerIdxs[3];
 assert(first>4096&&second>4096&&third>4096);assert(FR_GetRematchTrainerId(first)==first);
 FlagSet(FR_FLAG_GOT_VS_SEEKER);assert(FR_GetRematchTrainerId(first)==second);fought[second]=1;assert(FR_GetRematchTrainerId(first)==second);
 FlagSet(FR_FLAG_WORLD_MAP_FUCHSIA_CITY);assert(FR_GetRematchTrainerId(first)==third);assert(FR_GetRematchTrainerId(60000)==0);
 gSpecialVar_LastTalked=5;gTrainerBattleOpponent_A=first;pc.wholeGameKanto.trainerRematches[5]=1;assert(FR_IsTrainerReadyForRematch());FR_ClearRematchStateOfLastTalked();assert(!pc.wholeGameKanto.trainerRematches[5]&&fought[first]);
 assert(!FR_ObjectEventIdIsSane(16));
 memset(&storage,0,sizeof(storage));memset(fought,0,sizeof(fought));events.objectEventCount=2;
 for(int i=0;i<2;i++){gObjectEvents[i].active=1;gObjectEvents[i].localId=i+1;gObjectEvents[i].spriteId=i;gSprites[i].data[0]=i;storage.trainerInfo[i].localId=i+1;storage.trainerInfo[i].objectEventId=i;storage.trainerInfo[i].trainerIdx=first;}
 storage.trainerInfo[2].localId=255;
 assert(FR_GetVsSeekerResponseInArea(sRematches)==VSSEEKER_RESPONSE_UNFOUGHT_TRAINERS);assert(rngCalls==0);assert(lastMovement[1]==sMovementScript_TrainerUnfought);
 memset(&storage,0,sizeof(storage));
 for(int i=0;i<2;i++){storage.trainerInfo[i].localId=i+1;storage.trainerInfo[i].objectEventId=i;storage.trainerInfo[i].trainerIdx=first;}
 storage.trainerInfo[2].localId=255;fought[first]=1;rngValues[0]=30;rngValues[1]=0;rngCalls=0;
 assert(FR_GetVsSeekerResponseInArea(sRematches)==VSSEEKER_RESPONSE_FOUND_REMATCHES);assert(rngCalls==2);assert(storage.numRematchableTrainers==2);assert(pc.wholeGameKanto.trainerRematches[1]>0&&pc.wholeGameKanto.trainerRematches[2]>0);assert(FlagGet(FR_FLAG_SYS_VS_SEEKER_CHARGING));assert(lastMovement[1]==sMovementScript_TrainerRematch&&lastMovement[2]==sMovementScript_TrainerRematch);
 memset(&storage,0,sizeof(storage));storage.trainerInfo[0].localId=1;storage.trainerInfo[0].objectEventId=0;storage.trainerInfo[0].trainerIdx=first;storage.trainerInfo[1].localId=255;rngCalls=0;rngValues[0]=29;
 assert(FR_GetVsSeekerResponseInArea(sRematches)==VSSEEKER_RESPONSE_NO_RESPONSE);assert(lastMovement[1]==sMovementScript_TrainerNoRematch);assert(storage.trainerDoesNotWantRematch);
 return 0;}
'''
            path=out/'check.c';path.write_text(definitions+declarations+prototypes+body+main)
            result=subprocess.run(['cc','-std=gnu99','-Werror',str(path),'-o',str(out/'check')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            subprocess.run([str(out/'check')],check=True,capture_output=True)

if __name__=='__main__':unittest.main()
