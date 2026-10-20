"""Native FireRed Route 5 daycare in a private unified-save state bank.

Hoenn and Four Island intentionally use the actual shared host breeding facility,
as an explicit unified-system policy. Route 5 has its own donor-native single-mon
record and never aliases that two-parent state. No emulator/ROM admission implied.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions, rewrite_tokens

ROUTE5 = ('PutMonInRoute5Daycare','GetCostToWithdrawRoute5DaycareMon','IsThereMonInRoute5Daycare',
          'GetNumLevelsGainedForRoute5DaycareMon','TakePokemonFromRoute5Daycare')
HELPERS = ('DayCare_GetMonNickname','DayCare_GetBoxMonNickname','StorePokemonInDaycare',
           'ApplyDaycareExperience','TakeSelectedPokemonFromDaycare','GetLevelAfterDaycareSteps',
           'GetNumLevelsGainedFromSteps','GetNumLevelsGainedForDaycareMon','GetDaycareCostForSelectedMon',
           'ClearDaycareMonMail')
# Exact public signatures bind to one actual native breeding/party UI source
# system. This policy deliberately shares the Hoenn/Four Island deposit facility.
SHARED = {'GetDaycareMonNicknames':'GetDaycareMonNicknames','GetDaycareState':'GetDaycareState',
          'RejectEggFromDayCare':'RejectEggFromDayCare','GiveEggFromDaycare':'GiveEggFromDaycare',
          'SetDaycareCompatibilityString':'SetDaycareCompatibilityString',
          'StoreSelectedPokemonInDaycare':'StoreSelectedPokemonInDaycare',
          'ShowDaycareLevelMenu':'ShowDaycareLevelMenu','GetNumLevelsGainedFromDaycare':'GetNumLevelsGainedFromDaycare',
          'GetDaycareCost':'GetDaycareCostAndPrepareString','TakePokemonFromDaycare':'TakePokemonFromDaycare'}


def stage_daycare(base, donor, out, report_dir=None):
    start=time.monotonic()
    base,donor,out=(Path(p).resolve() for p in (base,donor,out))
    if any(out == p or p in out.parents or out in p.parents for p in (base,donor)):
        raise ValueError('daycare output must be isolated from canonical sources')
    hashes,patched,providers={ },[],[]
    def read(root,rel):
        text=(root/rel).read_text(); hashes[('donor/' if root==donor else 'base/' if root==base else 'staged/')+rel]=hashlib.sha256(text.encode()).hexdigest(); return text
    def write(rel,text):
        p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);patched.append(rel)
    def once(text,old,new):
        if text.count(old)!=1: raise ValueError('unsupported daycare source anchor: '+old[:100])
        return text.replace(old,new,1)
    source=read(donor,'src/daycare.c'); index={f.name:f for f in functions(source,'src/daycare.c')}
    host=read(base,'src/daycare.c'); host_index={f.name:f for f in functions(host,'src/daycare.c')}
    global_source=read(donor,'include/global.h')
    structs=[]
    for name in ('DayCareMail','DaycareMon'):
        match=re.search(r'struct '+name+r'\n\{.*?\n\};',global_source,re.S)
        if not match: raise ValueError('missing native daycare type '+name)
        structs.append(match[0])
    type_map={'DayCareMail':'FR_Route5DaycareMail','DaycareMon':'FR_Route5DaycareMon'}
    types='\n'.join(rewrite_tokens(s,type_map) for s in structs)
    types_header='''#ifndef GUARD_WHOLE_GAME_FR_DAYCARE_TYPES_H
#define GUARD_WHOLE_GAME_FR_DAYCARE_TYPES_H
#include "global.h"
'''+types+'''
// Source-ABI proof: no pointer reinterpretation of native Pokemon records.
typedef char FR_DaycareBoxIs80[(sizeof(struct BoxPokemon)==80)?1:-1];
typedef char FR_DaycarePartyIs100[(sizeof(struct Pokemon)==100)?1:-1];
typedef char FR_DaycareMailMessageIs36[(sizeof(struct Mail)==36)?1:-1];
typedef char FR_DaycareMailIs56[(sizeof(struct FR_Route5DaycareMail)==56)?1:-1];
typedef char FR_DaycareStepsAt136[(offsetof(struct FR_Route5DaycareMon,steps)==136)?1:-1];
typedef char FR_DaycareMonIs140[(sizeof(struct FR_Route5DaycareMon)==140)?1:-1];
#endif
'''
    write('include/whole_game_fr_daycare_types.h',types_header)
    storage=read(out,'include/pokemon_storage_system.h')
    storage=once(storage,'    } wholeGameKanto;', '        struct FR_Route5DaycareMon route5Daycare;\n    } wholeGameKanto;')
    storage='#include "whole_game_fr_daycare_types.h"\n'+storage
    write('include/pokemon_storage_system.h',storage)
    names={name:'FR_'+name for name in ROUTE5+HELPERS+('ChooseSendDaycareMon','GetSelectedMonNicknameAndSpecies')}
    names.update(type_map)
    names.update({'GiveMailToMon2':'GiveMailToMon','ClearMailStruct':'ClearMail'})
    bodies=[]
    for name in ROUTE5+HELPERS+('ChooseSendDaycareMon','GetSelectedMonNicknameAndSpecies'):
        function=index[name]
        text=rewrite_tokens(function.source,names)
        text=text.replace('gSaveBlock1Ptr->route5DayCareMon','gPokemonStoragePtr->wholeGameKanto.route5Daycare')
        bodies.append(text)
        providers.append({'name':name,'target':'FR_'+name,'signature':text.split('{',1)[0].strip(),
                          'status':'source-ported','source':'src/daycare.c','sourceSha256':hashlib.sha256(function.source.encode()).hexdigest(),
                          'translationUnit':'src/firered_native/daycare.c','state':'Route5 private bank' if name in ROUTE5 else 'shared party/UI or private Route5 helpers'})
    # Preserve the exact donor Route5 step clause; leave native host breeding
    # production/hatching code untouched. This clause advances across regions.
    step=index['ShouldEggHatch'].source
    step_body=step[step.index('{')+1:step.rindex('}')]
    step_body=once(step_body,'    return TryProduceOrHatchEgg(&gSaveBlock1Ptr->daycare);','')
    step_body=step_body.replace('gSaveBlock1Ptr->route5DayCareMon','gPokemonStoragePtr->wholeGameKanto.route5Daycare')
    bodies.append('void FR_AdvanceRoute5DaycareStep(void)\n{'+step_body+'}\n')
    providers.append({'name':'ShouldEggHatch Route5 step clause','target':'FR_AdvanceRoute5DaycareStep','signature':'void FR_AdvanceRoute5DaycareStep(void)',
                      'status':'source-ported','source':'src/daycare.c','sourceSha256':hashlib.sha256(step.encode()).hexdigest(),'translationUnit':'src/firered_native/daycare.c','state':'Route5 private bank; advances during shared native ShouldEggHatch on every eligible player step, regardless of region'})
    for name,target in SHARED.items():
        donor_function=index[name]; host_function=host_index[target]
        signature=donor_function.source.split('{',1)[0].strip().replace(name,'FR_'+name,1)
        # All admitted script services here take void; refuse silent signature drift.
        if not signature.endswith('(void)') or not host_function.source.split('{',1)[0].strip().endswith('(void)'):
            raise ValueError('unsupported breeding service signature '+name)
        ret=signature.split()[0]
        host_ret=host_function.source.split()[0]
        if ret!=host_ret: raise ValueError('breeding service return ABI mismatch '+name)
        bodies.append(signature+'\n{\n    '+('return ' if ret!='void' else '')+target+'();\n}\n')
        providers.append({'name':name,'target':'FR_'+name,'signature':signature,'status':'unified-native-system-binding',
                          'source':'src/daycare.c','sourceSha256':hashlib.sha256(donor_function.source.encode()).hexdigest(),
                          'hostSource':'src/daycare.c','hostSha256':hashlib.sha256(host_function.source.encode()).hexdigest(),
                          'hostTarget':target,'translationUnit':'src/firered_native/daycare.c','state':'one shared Hoenn/Four Island native two-parent breeding facility; explicit owner policy'})
    # Donor count and mail-reporting consumers retain FR semantics on the shared
    # breeding state; do not cast the different offspringPersonality layouts.
    for name in ('GetDaycarePokemonCount','BufferDayCareMonReceivedMail','DaycareMonReceivedMail'):
        text=index[name].source
        text=rewrite_tokens(text,{'GetDaycarePokemonCount':'FR_GetDaycarePokemonCount','BufferDayCareMonReceivedMail':'FR_BufferDayCareMonReceivedMail','DaycareMonReceivedMail':'FR_DaycareMonReceivedMail','DayCare_GetBoxMonNickname':'FR_DayCare_GetBoxMonNickname','OT_name':'otName'})
        bodies.append(text)
        providers.append({'name':name,'target':'FR_'+name,'signature':text.split('{',1)[0].strip(),'status':'source-ported',
                          'source':'src/daycare.c','sourceSha256':hashlib.sha256(index[name].source.encode()).hexdigest(),
                          'translationUnit':'src/firered_native/daycare.c','state':'shared Hoenn/Four Island breeding state; native host types with otName field rename only'})
    declarations='\n'.join(body[:body.index('{')].strip()+';' for body in bodies)
    includes=('global.h','battle.h','pokemon.h','pokemon_storage_system.h','whole_game_fr_daycare_types.h','mail.h','daycare.h','string_util.h','event_data.h','party_menu.h','main.h','overworld.h','constants/items.h','constants/species.h')
    unit='\n'.join('#include "'+name+'"' for name in includes)+'\n'+declarations+'\n\n'+'\n\n'.join(bodies)+'\n'
    write('src/firered_native/daycare.c',unit)
    public='\n'.join(body[:body.index('{')].strip()+';' for body in bodies if not body.startswith('static '))
    write('include/whole_game_fr_daycare.h','#ifndef GUARD_WHOLE_GAME_FR_DAYCARE_H\n#define GUARD_WHOLE_GAME_FR_DAYCARE_H\n#include "global.h"\n'+public+'\n#endif\n')
    staged_daycare=read(out,'src/daycare.c')
    staged_daycare=once(staged_daycare,'bool8 ShouldEggHatch(void)\n{\n','bool8 ShouldEggHatch(void)\n{\n    FR_AdvanceRoute5DaycareStep();\n')
    write('src/daycare.c','#include "whole_game_fr_daycare.h"\n'+staged_daycare)
    ledger={'schema_version':1,'buildEligible':False,'semantic_coverage_complete':False,'providers':providers,
            'symbolMap':{row['name']:row['target'] for row in providers if ' ' not in row['name']},'patched_files':patched,'source_hashes':hashes,
            'statePolicy':{'route5':'separate exact donor DaycareMon140 byte PC-extension record, no region gating of step EXP','hoenn_four_island':'one actual host native two-parent breeding service and state, explicitly approved unified-system policy; never swapped with Route5','save':'existing sizeof(PokemonStorage) snapshot and sizeof(wholeGameKanto) new-game clear include appended record'},
            'abi':{'boxPokemon':80,'pokemon':100,'mail':36,'route5DaycareMail':56,'route5DaycareMon':140,'route5StepsOffset':136,'verification':'generated compile-time type assertions, actual compiler qualification reported separately'},
            'dependencyBindings':{'GiveMailToMon2':'host GiveMailToMon: same typed mail restore body and item/slot semantics','ClearMailStruct':'host ClearMail: same source field resets and constants','ChooseMonForDaycare':'actual host party UI; selection via BufferMonSelection and gSpecialVar8004, callback returns to field','party, learnset, species, EXP':'one actual host Pokemon source system and shared party, explicit unified owner policy'},
            'unresolved':[{'scope':'qualification','reason':'full ROM script/UI/save-load and cross-region daycare qualification not run'}],
            'measurement':{'source_transform_duration_seconds':time.monotonic()-start,'build_duration_seconds':None,'queue_duration_seconds':None,'reason':'source stage only; targeted compilation evidence separate'}}
    if report_dir:
        p=Path(report_dir);p.mkdir(parents=True,exist_ok=True);(p/'daycare-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
