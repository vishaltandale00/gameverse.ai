"""Bounded guarded switch return checks, including exact source MZM cases."""
import copy
import json
from pathlib import Path
import time
from returnproof import prove,Unproven

BASE=0x08000000


def fixture():
    rom=bytearray(64)
    for pc,word in {0:0xb500,2:0x2801,4:0xd900,6:0xe00f,8:0x0080,10:0x4903,12:0x1840,14:0x6800,16:0x4687,28:0x2000,30:0xe003,32:0x2001,34:0xe001,40:0xbc02,42:0x4708}.items():rom[pc:pc+2]=word.to_bytes(2,'little')
    rom[24:28]=(BASE+48).to_bytes(4,'little');rom[48:52]=(BASE+28).to_bytes(4,'little');rom[52:56]=(BASE+32).to_bytes(4,'little')
    return {'entry':f'{BASE:08x}','jump_tables':[{'pc':f'{BASE+16:08x}','cases':[{'label':0,'target':f'{BASE+28:08x}'},{'label':1,'target':f'{BASE+32:08x}'}]}]},rom


def run():
    started=time.perf_counter();l0,rom=fixture();proof=prove(l0,rom,BASE+42);names=['all_source_cases_and_default_return']
    assert proof['internal_switches'][0]['case_count']==2
    def rejects(name,mutate):
        source,image=fixture();mutate(source,image)
        try:prove(source,image,BASE+42)
        except Unproven:names.append(name)
        else:raise AssertionError('unproved switch accepted: '+name)
    def word(pc,value):return lambda x,r:r.__setitem__(slice(pc,pc+2),value.to_bytes(2,'little'))
    rejects('unknown_MOVpc',lambda x,r:x.update(jump_tables=[]))
    rejects('wrong_source_word',word(16,0x468f))
    rejects('wrong_cmp_register',word(2,0x2901))
    rejects('wrong_guard_condition',word(4,0xd800))
    rejects('wrong_index_scale',word(8,0x0040))
    rejects('literal_clobbers_index',word(10,0x4803))
    rejects('wrong_address_add',word(12,0x1880))
    rejects('wrong_entry_width_or_offset',word(14,0x6840))
    rejects('missing_source_case',lambda x,r:x['jump_tables'][0]['cases'].pop())
    rejects('duplicate_source_label',lambda x,r:x['jump_tables'][0]['cases'][1].update(label=0))
    rejects('raw_target_mismatch',lambda x,r:r.__setitem__(slice(48,52),(BASE+32).to_bytes(4,'little')))
    rejects('mutable_table',lambda x,r:r.__setitem__(slice(24,28),(0x02000000).to_bytes(4,'little')))
    rejects('unaligned_table',lambda x,r:r.__setitem__(slice(24,28),(BASE+49).to_bytes(4,'little')))
    rejects('direct_dispatch_guard_bypass',word(0,0xe006))
    rejects('direct_guard_cmp_bypass',word(0,0xe000))
    rejects('direct_prefix_guard_bypass',word(0,0xe002))
    rejects('one_case_stack_unbalanced',word(28,0xbc04))
    rejects('one_case_callee_saved_clobber',word(28,0x2400))
    def odd_target(x,r):
        r[48:52]=(BASE+29).to_bytes(4,'little');x['jump_tables'][0]['cases'][0]['target']=f'{BASE+29:08x}'
    rejects('odd_source_target',odd_target)
    root=Path(__file__).resolve().parents[2];actual_rom=(root/'local/roms/Metroid - Zero Mission (USA).gba').read_bytes()
    for relative,return_pc,count in [('local/ir/packages/mzm.progress.acquire/l0.json','08013bdc',115),('local/ir/fleet-next/metroid-zero-mission/death-drop-v2/export-pickup-options01/l0/08012d14.json','08012e8a',28)]:
        source=json.loads((root/relative).read_text());before=copy.deepcopy(source);p=prove(source,actual_rom,return_pc)
        assert source==before and p['internal_switches'][0]['case_count']==count;names.append('actual_MZM_'+source['entry'])
    print(json.dumps({'outcome':'pass','checks':len(names),'names':names,'wall_s':time.perf_counter()-started,'native_calls':0}))


if __name__=='__main__':run()
