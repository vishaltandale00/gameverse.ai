"""Source-real divergent party/Pokedex campaign services on shared native state.

Simple compatible roots belong to shared_services; this stage imports actual
regional differences and selected typed bindings with explicit ownership policy.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions, masked
from .scripts import rewrite_tokens

DIVERGENT = {
    'ChooseHalfPartyForBattle': 'src/script_pokemon_util.c',
    'ReducePlayerPartyToThree': 'src/script_pokemon_util.c',
    'GetHeracrossSizeRecordInfo': 'src/pokemon_size_record.c',
    'CompareHeracrossSize': 'src/pokemon_size_record.c',
    'GetMagikarpSizeRecordInfo': 'src/pokemon_size_record.c',
    'CompareMagikarpSize': 'src/pokemon_size_record.c',
    'GetPokedexCount': 'src/prof_pc.c',
    'GetProfOaksRatingMessage': 'src/prof_pc.c',
    'HasAllKantoMons': 'src/pokedex.c',
    'EnableNationalPokedex': 'src/event_data.c',
    'IsNationalPokedexEnabled': 'src/event_data.c',
    'SetUnlockedPokedexFlags': 'src/save_location.c',
    'SetPostgameFlags': 'src/save_location.c',
    'EggHatch': 'src/daycare.c',
}


PARTY_ROOTS = {
    'HealPlayerParty': 'src/script_pokemon_util.c',
    'HasEnoughMonsForDoubleBattle': 'src/script_pokemon_util.c',
    'DoesPartyHaveEnigmaBerry': 'src/script_pokemon_util.c',
    'CountPartyNonEggMons': 'src/pokemon_storage_system_menu.c',
    'CountPartyAliveNonEggMons_IgnoreVar0x8004Slot': 'src/pokemon_storage_system_menu.c',
    'CreateEnemyEventMon': 'src/pokemon.c',
    'IsSelectedMonEgg': 'src/party_menu_specials.c',
    'IsPokemonJumpSpeciesInParty': 'src/pokemon_jump.c',
    'HasAllMons': 'src/pokedex.c',
}


def stage_campaign_services(base, donor, output, report_dir=None):
    start=time.monotonic()
    base,donor,out=(Path(p).resolve() for p in (base,donor,output))
    if any(out==p or p in out.parents or out in p.parents for p in (base,donor)):
        raise ValueError('campaign-services requires isolated output')
    if (out/'src/firered_native/campaign_party.c').exists():
        raise ValueError('campaign-services already applied')
    changed,providers,pins=[],[],{}
    cache={}
    def read(root,relative):
        key=(root,relative)
        if key not in cache:
            text=(root/relative).read_text();cache[key]=text
            pins[('donor/' if root==donor else 'native/' if root==base else 'staged/')+relative]=hashlib.sha256(text.encode()).hexdigest()
        return cache[key]
    def func(root,relative,name):
        rows=[f for f in functions(read(root,relative),relative) if f.name==name]
        if len(rows)!=1:raise ValueError('missing unique campaign source '+relative+':'+name)
        return rows[0]
    def write(relative,text):
        path=out/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);changed.append(relative)
    def adapt(text,own_names):
        symbols={name:'FR_Campaign_'+name for name in own_names}
        symbols.update({name:'FR_'+name for name in {**DIVERGENT, **PARTY_ROOTS}})
        for name in set(re.findall(r'\b(?:FLAG|VAR)_\w+\b',text)):
            if name not in {'FLAG_GET_SEEN','FLAG_GET_CAUGHT','FLAG_SET_SEEN','FLAG_SET_CAUGHT'}:
                symbols[name]='FR_'+name
        for name in set(re.findall(r'\bPokedexRating_Text_\w+\b',text)):symbols[name]='FR_'+name
        return rewrite_tokens(text,symbols)
    common='''#include "global.h"
#include "event_data.h"
#include "pokemon.h"
#include "pokemon_storage_system.h"
#include "party_menu.h"
#include "pokedex.h"
#include "script_pokemon_util.h"
#include "string_util.h"
#include "malloc.h"
#include "main.h"
#include "overworld.h"
#include "field_message_box.h"
#include "data.h"
#include "text.h"
#include "strings.h"
#include "save_location.h"
#include "constants/whole_game_fr_state.h"
#include "constants/pokedex.h"
#include "whole_game_campaign_services.h"
typedef char FR_CampaignPartyAbi[(sizeof(struct Pokemon)==100 && sizeof(struct BoxPokemon)==80)?1:-1];
'''
    # True donor divergence: three selected slots; no Hoenn Frontier scene writes.
    names=['CB2_ReturnFromChooseHalfParty','ChooseHalfPartyForBattle','ReducePlayerPartyToThree']
    party=common+'static void FR_Campaign_CB2_ReturnFromChooseHalfParty(void);\n'
    for name in names:
        source=func(donor,'src/script_pokemon_util.c',name).source
        if name=='ChooseHalfPartyForBattle':
            source=source.replace('InitChooseMonsForBattle(CHOOSE_MONS_FOR_CABLE_CLUB_BATTLE)', 'InitChooseHalfPartyForBattle(0)')
        if name=='ChooseHalfPartyForBattle':
            source=source.replace('    gMain.savedCallback', '    WholeGame_SetFRPartySelection(TRUE);\n    gMain.savedCallback',1)
        if name=='CB2_ReturnFromChooseHalfParty':
            source=source.replace('    switch', '    WholeGame_SetFRPartySelection(FALSE);\n    switch',1)
        party+=adapt(source,names)+'\n'
    write('src/firered_native/campaign_party.c',party)
    # Native private selector mode carries UI policy, never a persisted story var.
    relative='src/party_menu.c'
    selection_source=read(out,relative) if (out/relative).exists() else read(base,relative)
    selection_source=selection_source.replace('#include "global.h"', '#include "global.h"\n#include "whole_game_campaign_services.h"\nstatic bool8 sFR_CableSelection;\nvoid WholeGame_SetFRPartySelection(bool8 active) { sFR_CableSelection = active; }',1)
    adapters={
        'static bool8 GetBattleEntryEligibility(struct Pokemon *mon)\n{': '    if (sFR_CableSelection)\n        return !GetMonData(mon, MON_DATA_IS_EGG) && GetMonData(mon, MON_DATA_HP) != 0;\n',
        'static u8 CheckBattleEntriesAndGetMessage(void)\n{': '    if (sFR_CableSelection)\n        return gSelectedOrderFromParty[0] ? 0xFF : PARTY_MSG_NO_MON_FOR_BATTLE;\n',
        'static u8 GetMaxBattleEntries(void)\n{': '    if (sFR_CableSelection)\n        return 3;\n',
        'static u8 GetMinBattleEntries(void)\n{': '    if (sFR_CableSelection)\n        return 1;\n',
        'static u8 GetBattleEntryLevelCap(void)\n{': '    if (sFR_CableSelection)\n        return MAX_LEVEL;\n'}
    for anchor,body in adapters.items():
        if anchor.startswith('static bool8 GetBattleEntryEligibility'):
            anchor+='\n    u16 i = 0;\n    u16 species;'
        elif anchor.startswith('static u8 CheckBattleEntriesAndGetMessage'):
            anchor+='\n    u8 maxBattlers;\n    u8 i, j;\n    u8 facility;\n    struct Pokemon *party = gPlayerParty;\n    u8 minBattlers = GetMinBattleEntries();\n    u8 *order = gSelectedOrderFromParty;'
        if selection_source.count(anchor)!=1:raise ValueError('native party selection source drift '+anchor)
        selection_source=selection_source.replace(anchor,anchor+'\n'+body,1)
    write(relative,selection_source)

    for name in names[1:]:providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_party.c','status':'source-ported','binding':'native gPlayerParty and selector with private donor cable-club validation mode; original min1/max3/alive-non-egg rules, no persisted Frontier var write; callback clears mode'})
    # Exact donor size arithmetic/table and private regional record vars.
    original=read(donor,'src/pokemon_size_record.c')
    before_gift=original[:original.index('void GiveGiftRibbonToParty')]
    before_gift=re.sub(r'^#include[^\n]*\n','',before_gift,flags=re.M)
    size_names=[f.name for f in functions(before_gift,'size.c')]
    size_symbols={name:'FR_Campaign_'+name for name in re.findall(r'\b(?:s[A-Z]\w*|UnknownStruct)\b',before_gift)}
    size_symbols['gText_DecimalPoint']='FR_Campaign_DecimalPoint'
    decimal = re.search(r'const u8 gText_DecimalPoint\[\].*?;',read(donor,'src/strings.c'))
    if not decimal:raise ValueError('missing exact decimal text')
    size='static '+rewrite_tokens(decimal[0],size_symbols)+'\n'+adapt(rewrite_tokens(before_gift,size_symbols),size_names)
    # Default record and integer centimeter/inch conversion remain exact donor.
    write('src/firered_native/campaign_size_records.c',common+size)
    for name in list(DIVERGENT)[2:6]:providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_size_records.c','status':'source-ported','binding':'FR_VAR_* size records; actual native decrypted mon API and species height table'})
    # Verify height inputs used by original size routines before selecting host data.
    for species in ('MAGIKARP','HERACROSS'):
        heights=[]
        for root in (donor,base):
            content=read(root,'src/data/pokemon/pokedex_entries.h')
            match=re.search(r'\[NATIONAL_DEX_'+species+r'\]\s*=\s*\{.*?\.height\s*=\s*(\d+)',content,re.S)
            if not match:raise ValueError('missing size species dex height '+species)
            heights.append(int(match[1]))
        if heights[0]!=heights[1]:raise ValueError('source species size data mismatch '+species)
    # Regional gates use donor vars/flags but one actual native Pokedex format.
    dex=common
    dex+='''void FR_EnableNationalPokedex(void)
{
    EnableNationalPokedex();
    VarSet(FR_VAR_NATIONAL_DEX, 0x6258);
    FlagSet(FR_FLAG_SYS_NATIONAL_DEX);
}
bool32 FR_IsNationalPokedexEnabled(void)
{
    return IsNationalPokedexEnabled()
        && VarGet(FR_VAR_NATIONAL_DEX) == 0x6258
        && FlagGet(FR_FLAG_SYS_NATIONAL_DEX);
}
'''
    for name in ('EnableNationalPokedex','IsNationalPokedexEnabled'):
        func(donor,'src/event_data.c',name);func(base,'src/event_data.c',name)
        providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_pokedex.c','status':'source-adapted','binding':'one native DA/0302 Pokedex magic; original donor 6258/flag gate separate; no B9 overwrite of shared format'})
    for name in ('GetKantoPokedexCount','HasAllKantoMons'):
        dex+=adapt(func(donor,'src/pokedex.c',name).source,['GetKantoPokedexCount'])+'\n'
    source=read(donor,'src/prof_pc.c')
    source=re.sub(r'^#include[^\n]*\n','',source,flags=re.M)
    dex+=adapt(source,['GetProfOaksRatingMessageByCount','GetKantoPokedexCount'])
    write('src/firered_native/campaign_pokedex.c',dex)
    for name in ('GetPokedexCount','GetProfOaksRatingMessage','HasAllKantoMons'):
        providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_pokedex.c','status':'source-ported','binding':'original Kanto/Mew rating boundaries and exact imported script text; actual shared seen/owned data'})
    save=common
    for name in ('SetUnlockedPokedexFlags','SetPostgameFlags'):
        save+=func(donor,'src/save_location.c',name).source.replace(name,'FR_'+name,1)+'\n'
        providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_save_flags.c','status':'source-ported','binding':'typed native gcnLinkFlags bitset; CHAMPION_SAVEWARP bit7 source equal'})
    write('src/firered_native/campaign_save_flags.c',save)
    # Deliberate single breeding/hatching ownership: actual full native animation,
    # mon commit, nickname, save, scripts and callbacks. Not a success stub.
    func(donor,'src/daycare.c','EggHatch');func(base,'src/egg_hatch.c','EggHatch')
    func(donor,'src/daycare.c','ScriptHatchMon');func(base,'src/egg_hatch.c','ScriptHatchMon')
    hatch=common+'#include "egg_hatch.h"\nvoid FR_EggHatch(void)\n{\n    EggHatch();\n}\n'
    write('src/firered_native/campaign_hatch.c',hatch)
    providers.append({'name':'EggHatch','target':'FR_EggHatch','translationUnit':'src/firered_native/campaign_hatch.c','status':'typed-native-owner-binding','binding':'same native party and shared Hoenn/Four Island breeding facility; entire real native hatch UI and commit lifecycle owns operation'})
    # Remaining algorithm roots operate on the actual owner's typed records.
    # Their symbolic MON_DATA/API fields select host semantics, never donor offsets.
    extra=common+'#include "berry.h"\n#include "pokemon_jump.h"\n#include "constants/items.h"\n'
    helpers={'CheckPartyMonHasHeldItem':'src/script_pokemon_util.c',
             'CountPartyAliveNonEggMonsExcept':'src/pokemon_storage_system_menu.c',
             'CreateEventMon':'src/pokemon.c'}
    for name,relative in helpers.items():
        extra+=adapt(func(donor,relative,name).source,list(helpers))+'\n'
    for name,relative in PARTY_ROOTS.items():
        extra+=adapt(func(donor,relative,name).source,list(helpers))+'\n'
        providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_party_algorithms.c',
            'status':'source-ported','binding':'original donor algorithm with typed actual native party/PC/Pokedex field APIs; no raw offset or donor struct cast'})
    # Exact Jump species/type inputs are shared with the complete native Jump game.
    jump_tables=[]
    for root in (donor,base):
        content=read(root,'src/pokemon_jump.c')
        table=content.split('sPokeJumpMons[] =',1)[1].split('\n};',1)[0]
        jump_tables.append(re.findall(r'\.species\s*=\s*(SPECIES_\w+).*?\.jumpType\s*=\s*(JUMP_TYPE_\w+)',table))
    if not jump_tables[0] or jump_tables[0]!=jump_tables[1]:
        raise ValueError('actual Jump species/type source tables differ')
    write('src/firered_native/campaign_party_algorithms.c',extra)
    # These public UI entries intentionally retain their entire actual owner,
    # including private callbacks/window state. Root source and backing are proved.
    bindings=common+'#include "pokemon_jump.h"\n'
    for name,relative,policy in [
        ('ChooseMonForWirelessMinigame','src/party_menu.c','same exact InitPartyMenu arguments and callback; one native party selection/UI owner'),
        ('ShowPokemonJumpRecords','src/pokemon_jump.c','same root+same typed16byte record fields; native Jump game/UI owns records and responsive window sizing')]:
        original=func(donor,relative,name).source;host=func(base,relative,name).source
        normalize=lambda text:re.sub(r'\s+','',masked(text))
        if normalize(original)!=normalize(host):raise ValueError('native UI root source drift '+name)
        bindings+='void FR_'+name+'(void)\n{\n    '+name+'();\n}\n'
        providers.append({'name':name,'target':'FR_'+name,'translationUnit':'src/firered_native/campaign_shared_ui.c',
            'status':'typed-native-owner-binding','binding':policy,
            'rootBodyEqual':True,'donorSourceSha256':hashlib.sha256(original.encode()).hexdigest(),
            'nativeSourceSha256':hashlib.sha256(host.encode()).hexdigest()})
    bindings+='#include <stddef.h>\ntypedef char FR_JumpRecordAbi[(sizeof(struct PokemonJumpRecords)==16 && offsetof(struct PokemonJumpRecords,jumpsInRow)==0 && offsetof(struct PokemonJumpRecords,excellentsInRow)==4 && offsetof(struct PokemonJumpRecords,gamesWithMaxPlayers)==6 && offsetof(struct PokemonJumpRecords,bestJumpScore)==12)?1:-1];\n'
    write('src/firered_native/campaign_shared_ui.c',bindings)
    prototypes=[]
    for provider in providers:
        name=provider['name']
        relative=DIVERGENT.get(name) or PARTY_ROOTS.get(name) or ('src/party_menu.c' if name=='ChooseMonForWirelessMinigame' else 'src/pokemon_jump.c')
        signature=func(donor,relative,name).source.split('{',1)[0].strip()
        prototypes.append(rewrite_tokens(signature,{name:'FR_'+name})+';')
    write('include/whole_game_campaign_services.h', '#ifndef GUARD_WHOLE_GAME_CAMPAIGN_SERVICES_H\n#define GUARD_WHOLE_GAME_CAMPAIGN_SERVICES_H\n#include "global.h"\n'+'\n'.join(prototypes)+'\nvoid WholeGame_SetFRPartySelection(bool8 active);\n#endif\n')
    for provider in providers:
        name=provider['name']
        relative=DIVERGENT.get(name) or PARTY_ROOTS.get(name) or ('src/party_menu.c' if name=='ChooseMonForWirelessMinigame' else 'src/pokemon_jump.c')
        original=func(donor,relative,name)
        provider['source']=relative+':'+name
        provider['sourceSha256']=hashlib.sha256(original.source.encode()).hexdigest()
    ledger={'component':'campaign_services','status':'partial','buildEligible':False,'providers':providers,
        'changed_files':changed,'source_pins':pins,'durationSeconds':time.monotonic()-start,
        'coverage':['donor three-slot reduction and selector return without Hoenn Frontier scene mutation','donor size arithmetic and separate records with verified source height inputs','original Kanto dex/rating/Mew boundaries','region unlock gates on shared native Pokedex format','original donor GCN link/save flags','actual native full hatch lifecycle through shared breeding owner'],
        'unresolved':['CalculatePlayerPartyCount/LoadPlayerParty/SavePlayerParty are owned by accepted shared_services resolver bindings and not duplicated here.','Native UI/party/hatch/rating and durable cartridge save execution remains unqualified.'],
        'verification':{'nativeCompile':None,'runtime':None}}
    if report_dir:
        Path(report_dir).mkdir(parents=True,exist_ok=True);(Path(report_dir)/'campaign-services-ledger.json').write_text(json.dumps(ledger,indent=2)+'\n')
    return ledger
