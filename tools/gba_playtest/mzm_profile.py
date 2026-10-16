"""Build a read-only, ROM-hash-pinned MZM observation profile from its linked ELF.

The game source declares fixed-width enum typedefs; SamusData fields use ARM
u8/u16 alignment. No addresses are guessed from screen images or another ROM.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def hashed(path):
    p = Path(path).resolve()
    return {'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}


def make_profile(rom, elf, source_root, source_commit):
    root = Path(source_root).resolve()
    result = subprocess.run(['arm-none-eabi-nm', '-n', str(Path(elf).resolve())],
                            capture_output=True, text=True, check=True, timeout=10)
    symbols = {}
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3:
            try: symbols[parts[2]] = int(parts[0], 16)
            except ValueError: pass
    fields = []
    def add(name, symbol, offset, size, signed=False, source=None):
        fields.append({'name': name, 'symbol': symbol, 'offset': offset,
                       'address': hex(symbols[symbol] + offset), 'bytes': size, 'signed': signed,
                       'source_ref': source})
    add('game_mode', 'gMainGameMode', 0, 2, True, 'include/constants/game_state.h:GameMode;src/globals1.c:gMainGameMode')
    add('sub_mode', 'gSubGameMode1', 0, 2, True, 'include/constants/game_state.h:SubGameMode;src/globals1.c:gSubGameMode1')
    add('area', 'gCurrentArea', 0, 1, source='src/globals1.c:gCurrentArea')
    add('room', 'gCurrentRoom', 0, 1, source='src/globals1.c:gCurrentRoom')
    for name, offset, size, signed in [('pose', 0, 1, False), ('standing_status', 1, 1, False),
            ('forced_movement', 4, 1, False), ('direction', 14, 2, False),
            ('x_native', 18, 2, False), ('y_native', 20, 2, False),
            ('vx_native', 22, 2, True), ('vy_native', 24, 2, True)]:
        add(name, 'gSamusData', offset, size, signed, 'include/structs/samus.h:SamusData')
    for name, offset, size in [('energy', 6, 2), ('missiles', 8, 2), ('beam_flags', 12, 1), ('suit_flags', 14, 1)]:
        add(name, 'gEquipment', offset, size, source='include/structs/samus.h:Equipment')
    add('movement_lock_timer', 'gPreventMovementTimer', 0, 2, source='include/structs/samus.h:gPreventMovementTimer')
    add('drawing_disabled', 'gDisableDrawingSamusAndScrolling', 0, 1, source='include/structs/samus.h:gDisableDrawingSamusAndScrolling')
    bridge_metadata = None
    if 'gGvBattle' in symbols:
        add('gv_magic', 'gGvBattle', 0, 4, source='tools/gba_mashup/native/emerald_bridge.h:GvBattle')
        for name, offset, size in [('active',4,1),('result',5,1),('turn',6,2),('weather',8,1),
                ('player_index',9,1),('enemy_index',10,1),('last_player_move',12,2),('last_enemy_move',14,2),('last_damage',16,2)]:
            add('gv_'+name,'gGvBattle',offset,size,source='tools/gba_mashup/native/emerald_bridge.h:GvBattle')
        # ARM EABI pointer=4, u32 alignment=4. Combatant stride44, arrays offset20/152.
        for side, base in [('player',20),('enemy',152)]:
            for i in range(3):
                for name, offset, size in [('species',4,2),('type0',6,1),('type1',7,1),('hp',10,2),('max_hp',12,2)]:
                    add('gv_%s_%d_%s'%(side,i,name),'gGvBattle',base+i*44+offset,size,source='tools/gba_mashup/native/emerald_bridge.h:GvCombatant')
                for j in range(4):
                    add('gv_%s_%d_move%d'%(side,i,j),'gGvBattle',base+i*44+32+j*2,2,source='tools/gba_mashup/native/emerald_bridge.h:GvCombatant.moves')
                    add('gv_%s_%d_pp%d'%(side,i,j),'gGvBattle',base+i*44+40+j,1,source='tools/gba_mashup/native/emerald_bridge.h:GvCombatant.pp')
        for name,symbol,size in [('selection','gGvNativeSelection',1),('party_menu','gGvNativePartyMenu',1),('pending','gGvEncounterPending',1),('battles_won','gGvNativeBattlesWon',2)]:
            add('gv_'+name,symbol,0,size,source='tools/gba_mashup/native/gv_native.c:'+symbol)
        native=Path('tools/gba_mashup/native')
        text=(native/'generated/emerald_constants.h').read_text()
        constants={k:int(v,0) for k,v in re.findall(r'^#define (\w+) (0x[0-9a-fA-F]+|\d+)$',text,re.M)}
        extracts=(native/'generated/emerald_extracts.inc').read_text()
        moves={}
        for name,body in re.findall(r'\[(MOVE_\w+)\]\s*=\s*\{(.*?)\}',extracts,re.S):
            data=dict(re.findall(r'\.(power|type|accuracy)\s*=\s*(\w+)',body))
            moves[str(constants[name])]={'name':name.removeprefix('MOVE_').replace('_',' '),**{k:int(v) if v.isdigit() else constants[v] for k,v in data.items()}}
        chart=[]
        match=re.search(r'gTypeEffectiveness\[336\]\s*=\s*\{(.*?)\};',extracts,re.S)
        if match:
            for a,b,c in re.findall(r'(TYPE_\w+),\s*(TYPE_\w+),\s*(TYPE_MUL_\w+)',match.group(1)):
                if a in constants and b in constants and c in constants:chart.append([constants[a],constants[b],constants[c]/10])
        bridge_metadata={'moves':moves,'type_chart':chart,'species_names':{str(constants['SPECIES_'+n]):n for n in ['BULBASAUR','CHARMANDER','SQUIRTLE']},
                         'source_files':[hashed(native/p) for p in ['emerald_bridge.h','gv_native.c','generated/emerald_extracts.inc','generated/emerald_constants.h']]}
    return {'schema_version': 1, 'reader': 'mzm-source-layout/1', 'rom_sha256': hashed(rom)['sha256'],
            'elf': hashed(elf), 'source_commit': source_commit,
            'source_files': [hashed(root / p) for p in ['include/structs/samus.h', 'include/constants/samus.h',
                'include/constants/game_state.h', 'include/types.h', 'src/globals1.c']],
            'units': {'x_native': 'quarter pixels, source SUB_PIXEL_RATIO=4', 'y_native': 'quarter pixels, positive down',
                      'vx_native': '1/32 pixel/frame, applied signed shift >>3 then quarter-pixel position',
                      'vy_native': '1/32 pixel/frame; positive is rising in Samus jump integrator'},
            'phase_rules': [{'equals': {'game_mode': 4, 'sub_mode': 2}, 'phase': 'gameplay'},
                            {'equals': {'game_mode': 4}, 'phase': 'game_transition'}],
            'fields': fields, 'battle_metadata':bridge_metadata, 'limitations': ['ARM fixed-width source struct layout; no unverified RAM writes.',
                'gameplay phase alone does not prove player control; compare action-conditioned source RAM changes.',
                'No objective completion or route traversability inferred merely from changed frames.']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('rom', 'elf', 'source-root', 'out'): p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--source-commit', required=True)
    a = p.parse_args(); profile = make_profile(a.rom, a.elf, a.source_root, a.source_commit)
    a.out.parent.mkdir(parents=True, exist_ok=True); a.out.write_text(json.dumps(profile, indent=2) + '\n')
    print(json.dumps({'profile': str(a.out), 'fields': len(profile['fields']), 'rom_sha256': profile['rom_sha256']}))

if __name__ == '__main__': main()
