"""FireRed entry policies and trades using the original shared Emerald engines.

Imports source functions by parsed definition, retaining their private closure
where required. Multiplayer protocol/version and animation remain Emerald's;
regional flags, trade records and quest-playback gates remain FireRed's.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import time
from .native_services import functions, masked
from .scripts import rewrite_tokens


def _get(root, relative, name):
    rows = [f for f in functions((root / relative).read_text(), relative) if f.name == name]
    if len(rows) != 1:
        raise ValueError(f'expected one source definition: {relative}:{name}')
    return rows[0]


def stage_link_services(base, donor, out, report_dir=None):
    start = time.monotonic()
    base, donor, out = map(lambda p: Path(p).resolve(), (base, donor, out))
    if any(p == out or p in out.parents or out in p.parents for p in (base, donor)):
        raise ValueError('link-services output must be isolated')
    if (out/'include/whole_game_link_services.h').exists():
        raise ValueError('link services already staged')
    changed, evidence, providers = [], [], []
    def write(path, text):
        target=out/path; target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
        if path not in changed: changed.append(path)
    def append(path, body, prelude=''):
        text=(out/path).read_text()
        write(path, prelude + text + '\n' + body + '\n')
    def port(relative, names, mapping=None):
        mapping=dict(mapping or {});mapping.update({name:'FR_'+name for name in names})
        rows=[]
        for name in names:
            f=_get(donor,relative,name)
            rows.append(rewrite_tokens(f.source,mapping))
            evidence.append({'name':name,'source':relative,'sha256':hashlib.sha256(f.source.encode()).hexdigest(),'bindings':mapping})
            if not f.static: providers.append({'name':name,'target':'FR_'+name,'status':'source-ported-compilation-pending','source':relative,'translationUnit':relative.replace('trade_scene.c','trade.c')})
        return '\n\n'.join(rows)
    # Explicit shared-system contracts: native multiplayer owns its complete
    # callback graph, saved facilities, RFU state, link version and room maps.
    # These are capability bindings, not an assertion of identical internals.
    bindings = {
        'TryContestLinkup':'TryContestGModeLinkup',
        'CloseLink':'CloseLink', 'ExitLinkRoom':'ExitLinkRoom',
        'IsDodrioInParty':'IsDodrioInParty', 'RunUnionRoom':'RunUnionRoom',
        'Script_ResetUnionRoomTrade':'Script_ResetUnionRoomTrade',
        'Script_ShowLinkTrainerCard':'Script_ShowLinkTrainerCard',
        'ShowDodrioBerryPickingRecords':'ShowDodrioBerryPickingRecords',
        'ShowWirelessCommunicationScreen':'ShowWirelessCommunicationScreen',
        'TryBecomeLinkLeader':'TryBecomeLinkLeader', 'TryJoinLinkGroup':'TryJoinLinkGroup',
        'TryRecordMixLinkup':'TryRecordMixLinkup', 'TryTradeLinkup':'TryTradeLinkup',
        'EnterTradeSeat':'PlayerEnteredTradeSeat',
        'EnterColosseumPlayerSpot':'ColosseumPlayerSpotTriggered',
        'ShowBerryCrushRankings':'ShowBerryCrushRankings',
        'ValidateSavedWonderCard':'ValidateSavedWonderCard',
    }
    # Discover both definitions generically; renamed roots retain exact parsed
    # signatures and argument types, no hand-written return-value defaults.
    roots = set(bindings) | set(bindings.values())
    root_pattern=re.compile(r'\b(?:'+'|'.join(map(re.escape,sorted(roots)))+r')\s*\(')
    indexes=[]
    for tree in (donor,base):
        index={}
        for path in sorted((tree/'src').glob('*.c')):
            text=path.read_text()
            if not root_pattern.search(text): continue
            for function in functions(text,path.relative_to(tree).as_posix()):
                if function.name in roots and not function.static: index[function.name]=function
        indexes.append(index)
    wrappers=[]
    for name,target in bindings.items():
        df=indexes[0].get(name);hf=indexes[1].get(target)
        if df is None or hf is None: raise ValueError('missing shared native definition '+name+'/'+target)
        ds=df.source.split('{',1)[0].strip();hs=hf.source.split('{',1)[0].strip()
        match=re.fullmatch(r'(void|bool8|bool32|u8|u16|u32)\s+'+name+r'\s*\(void\)',ds)
        if not match or re.sub(r'\b'+target+r'\b',name,hs)!=ds: raise ValueError('shared ABI differs '+name)
        result=match[1];statement=target+'();' if result=='void' else 'return '+target+'();'
        wrappers.append('extern '+hs+';\n'+ds.replace(name,'FR_'+name)+'\n{\n    '+statement+'\n}\n')
        evidence.append({'name':name,'source':df.path,'nativeTarget':target,'nativeSource':hf.path,
            'donorSha256':hashlib.sha256(df.source.encode()).hexdigest(),
            'nativeSha256':hashlib.sha256(hf.source.encode()).hexdigest(),
            'nativeTranslationUnitSha256':hashlib.sha256((base/hf.path).read_bytes()).hexdigest(),
            'nativeDirectCalls':sorted(set(re.findall(r'\b([A-Za-z_]\w*)\s*\(',masked(hf.source.split('{',1)[1])))-{'if','for','while','switch','sizeof'}),
            'nativeStateReferences':sorted(set(re.findall(r'\b[gs][A-Z]\w*\b',masked(hf.source)))),
            'contract':'native Emerald multiplayer/version/facilities and saved records; donor lobby returns through saved dynamic warp',
            'sourceBodyIdentical':re.sub(r'\s+','',masked(df.source))==re.sub(r'\s+','',masked(hf.source))})
        providers.append({'name':name,'target':'FR_'+name,'source':df.path,'translationUnit':'src/whole_game_link_bindings.c','status':'shared-native-capability-bound'})
    write('src/whole_game_link_bindings.c','#include "global.h"\n'+'\n'.join(wrappers))
    constant_evidence=[]
    for relative,names in [('include/constants/cable_club.h',['USING_SINGLE_BATTLE','USING_DOUBLE_BATTLE','USING_MULTI_BATTLE']),('include/constants/maps.h',['WARP_ID_DYNAMIC'])]:
        for name in names:
            values=[]
            for tree in (donor,base):
                match=re.search(r'^#define\s+'+name+r'\s+(0x[\da-fA-F]+|\d+)\b',(tree/relative).read_text(),re.M)
                if not match: raise ValueError('missing native ABI constant '+name)
                values.append(int(match[1],0))
            if values[0]!=values[1]: raise ValueError('link source ABI differs '+name)
            constant_evidence.append({'name':name,'value':values[0],'source':relative})
    evidence.append({'name':'native-entry-constant-ABI','constants':constant_evidence})
    # Real private native link task graph, reached by exact donor entry policy.
    cable_names=['TryBattleLinkup','CleanupLinkRoomState','StartWiredCableClubTrade','CableClub_AskSaveTheGame']
    append('src/cable_club.c','extern void FR_Field_AskSaveTheGame(void);\n'+port('src/cable_club.c',cable_names,{'Field_AskSaveTheGame':'FR_Field_AskSaveTheGame'}))
    # Preserve actual RFU detection/cleanup and original quest-log guard.
    ql='#include "global.h"\n#include "constants/firered_quest_log.h"\nextern u8 FR_gQuestLogState;\n'
    mapping={'QL_IS_PLAYBACK_STATE':'(FR_gQuestLogState == FR_QL_STATE_PLAYBACK || FR_gQuestLogState == FR_QL_STATE_PLAYBACK_LAST)'}
    append('src/link.c',port('src/link.c',['IsWirelessAdapterConnected'],mapping),ql)
    # Native Union Room tasks/state are authoritative; FR source only adds a
    # playback gate and clears the player-name buffer before that gate.
    f=_get(donor,'src/union_room.c','InitUnionRoom')
    if 'sUnionRoomPlayerName[0] = EOS;' not in f.source or 'QL_IS_PLAYBACK_STATE' not in f.source:
        raise ValueError('Union Room source policy changed')
    append('src/union_room.c','''void FR_InitUnionRoom(void)
{
    sUnionRoomPlayerName[0] = EOS;
    if (FR_gQuestLogState == FR_QL_STATE_PLAYBACK || FR_gQuestLogState == FR_QL_STATE_PLAYBACK_LAST)
        return;
    InitUnionRoom();
}
''',ql)
    evidence.append({'name':'InitUnionRoom','source':f.path,'sha256':hashlib.sha256(f.source.encode()).hexdigest(),'policy':'source revision0/1 playback guard, native actual allocation/task graph; Switch revision10 stub excluded'})
    providers.append({'name':'InitUnionRoom','target':'FR_InitUnionRoom','source':'src/union_room.c','translationUnit':'src/union_room.c','status':'source-ported-compilation-pending'})
    # Full original nine-entry donor trade table, including all conditional
    # FireRed records and mail words; no Emerald trade table substitution.
    data=(donor/'src/data/ingame_trades.h').read_text()
    ids=dict(re.findall(r'^#define\s+(INGAME_TRADE_\w+)\s+(\d+)',(donor/'include/constants/trade.h').read_text(),re.M))
    data=rewrite_tokens(data,{**ids,'sInGameTrades':'sFRInGameTrades','sInGameTradeMailMessages':'sFRInGameTradeMailMessages'})
    # The donor is specifically FireRed. Select its source version branches
    # locally, without altering the shared engine's game identity/config.
    write('src/data/whole_game_fr_ingame_trades.h','#define FIRERED\n'+data+'\n#undef FIRERED\n')
    trade=(out/'src/trade.c').read_text()
    anchor='#include "data/trade.h"'
    if trade.count(anchor)!=1: raise ValueError('native trade data anchor changed')
    trade=trade.replace(anchor,anchor+'\n#include "data/whole_game_fr_ingame_trades.h"')
    # Native display and post-evolution text use the same regional records as
    # the donor creation service. Link trades keep their existing player data.
    trade=re.sub(r'&sIngameTrades\[([^\]]+)\]',r'(WholeGame_IsKanto() ? &sFRInGameTrades[\1] : &sIngameTrades[\1])',trade)
    write('src/trade.c','#include "global.h"\n#include "whole_game_state.h"\n'+trade)
    trade_names=['GetInGameTradeSpeciesInfo','BufferInGameTradeMonName','CreateInGameTradePokemonInternal','GetInGameTradeMail','GetTradeSpecies','CreateInGameTradePokemon','DoInGameTradeScene']
    declarations='''static void FR_GetInGameTradeMail(struct Mail *, const struct InGameTrade *);
static void FR_CreateInGameTradePokemonInternal(u8, u8);
extern void FR_HelpSystem_Disable(void);
'''
    body=port('src/trade_scene.c',trade_names,{'sInGameTrades':'sFRInGameTrades','sInGameTradeMailMessages':'sFRInGameTradeMailMessages','gLinkPartnerMail':'gTradeMail','HelpSystem_Disable':'FR_HelpSystem_Disable'})
    append('src/trade.c',declarations+body)
    # Mystery Gift metadata and native networking are shared. Source reward
    # eligibility reads the donor's actual enable flag, not Emerald's distinct
    # Mystery Event flag. Reward selection/counters remain exact source calls.
    wonder=port('src/wonder_news.c',['WonderNews_GetRewardInfo'],{'IsMysteryGiftEnabled':'FR_Link_IsMysteryGiftEnabled'})
    append('src/wonder_news.c','''static bool32 FR_Link_IsMysteryGiftEnabled(void)
{
    return FlagGet(FR_FLAG_SYS_MYSTERY_GIFT_ENABLED);
}
'''+wonder,'#include "constants/whole_game_fr_state.h"\n')
    # Restore the actual original per-step cooldown service. Shared Mystery
    # Gift owns one metadata bank and its matching native cooldown var.
    field=(out/'src/field_control_avatar.c').read_text()
    marker='        IncrementGameStat(GAME_STAT_STEPS);'
    if field.count(marker)!=1: raise ValueError('native field step anchor changed')
    field=field.replace(marker,marker+'\n        if (WholeGame_IsKanto()) WonderNews_IncrementStepCounter();')
    write('src/field_control_avatar.c','#include "global.h"\n#include "whole_game_state.h"\nextern void WonderNews_IncrementStepCounter(void);\n'+field)
    header='''#ifndef GUARD_WHOLE_GAME_LINK_SERVICES_H
#define GUARD_WHOLE_GAME_LINK_SERVICES_H
#include "global.h"
void FR_TryBattleLinkup(void);
void FR_CleanupLinkRoomState(void);
void FR_StartWiredCableClubTrade(void);
bool8 FR_IsWirelessAdapterConnected(void);
void FR_InitUnionRoom(void);
u16 FR_GetInGameTradeSpeciesInfo(void);
u16 FR_GetTradeSpecies(void);
void FR_CreateInGameTradePokemon(void);
void FR_DoInGameTradeScene(void);
u16 FR_WonderNews_GetRewardInfo(void);
#endif
'''
    write('include/whole_game_link_services.h',header)
    blockers=[]
    help_found=any(re.search(r'\bvoid\s+FR_HelpSystem_Disable\s*\([^;]*\)\s*\{',p.read_text()) for p in (out/'src').rglob('*.c'))
    save_found=any(re.search(r'\bvoid\s+FR_Field_AskSaveTheGame\s*\([^;]*\)\s*\{',p.read_text()) for p in (out/'src').rglob('*.c'))
    if not save_found: blockers.append('FR_Field_AskSaveTheGame requires utility_services native save and source Help context adapter.')
    if not help_found: blockers.append('FR_HelpSystem_Disable requires the original help-overlay provider; source call preserved.')
    qualification=[
              'Native wireless/colosseum room dynamic-return warp and external cartridge interoperability require linked/runtime qualification.',
              'Original external script receiver uses native Emerald raw special indexes; unsupported FireRed external bytecode is not translated.']
    protocol_sources={relative:hashlib.sha256((base/relative).read_bytes()).hexdigest() for relative in ('src/main.c','src/link.c','src/mystery_event_script.c','src/mystery_gift.c','src/mystery_gift_client.c','src/script.c')}
    evidence.append({'name':'external-native-ABI','sourceSha256':protocol_sources,
        'advertisement':'main.c gGameVersion=GAME_VERSION; link.c localLinkPlayer.version=gGameVersion+0x4000; Mystery Gift emits native RomHeaderGameCode',
        'mysteryEventCompatibility':'native VERSION_MASK=1<<9 and initially false mValid; properly tagged FireRed-only version1 is rejected',
        'opaquePayloadLimitation':'CLI_SAVE_RAM_SCRIPT receives an untyped script buffer; arbitrary raw FireRed bytecode cannot be distinguished from native bytecode without extra provenance. Unsupported, no translation claimed.',
        'registry':'native Emerald prefix raw special indexes retained; appended FireRed extension internal static source only'})
    ledger={'schema':'single-rom-link-services/1','component':'link_services','status':'complete' if not blockers else 'partial','buildEligible':not blockers,
            'changed_files':changed,'providers':providers,'evidence':evidence,'unresolved':blockers,'qualificationPending':qualification,
            'coverage':{'tradeRecords':len(ids),'tradeMail':'full donor source table','protocol':'authoritative native Emerald GAME_VERSION and RFU/link task graph','multiplayerRooms':'native Emerald facilities, dynamic saved return warp','sourceVariant':'FireRed revision0/1; Switch revision10 stubs excluded'},
            'timing':{'wallSeconds':time.monotonic()-start,'buildSeconds':None,'outcome':'source-staged'}}
    if report_dir:
        report_dir=Path(report_dir);report_dir.mkdir(parents=True,exist_ok=True)
        (report_dir/'link-services-ledger.json').write_text(json.dumps(ledger,indent=2,sort_keys=True)+'\n')
    return ledger
