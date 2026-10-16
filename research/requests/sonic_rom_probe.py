#!/usr/bin/env python3
"""Bounded read-only USA Sonic instruction/RAM witness; no source checkout.

Coldboots the real indexed cart, takes a private emulator checkpoint, and
compares held jump with early release plus a bounded traversal. All facts are
hypotheses anchored in this cart's disassembly, not imported game symbols.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import NativeSession

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(out,rom=None,expected_sha256=None,composition_receipt=None):
    start=time.monotonic()
    rom=(rom or ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba').resolve()
    base=hashlib.sha1(rom.read_bytes()).hexdigest()=='d842afa7dd1e84de08addb94a51506f1bcafd551'
    lineage=None
    if not base:
        if not expected_sha256 or not composition_receipt:
            raise ValueError('Candidate requires expected ROM hash and composition receipt')
        if sha(rom)!=expected_sha256:raise ValueError('Candidate ROM hash mismatch')
        lineage={'path':str(composition_receipt.resolve()),'sha256':sha(composition_receipt),
                 'receipt':json.loads(composition_receipt.read_text())}
        # A receipt that never mentions this artifact cannot establish lineage.
        if expected_sha256 not in json.dumps(lineage['receipt']):
            raise ValueError('Candidate hash absent from composition receipt')
    session=NativeSession(rom,out,ROOT/'tools/re/session/build/gba-session')
    records=[]
    report={'kind':'sonic_rom_motion_probe','rom_sha256':sha(rom),
        'rom_sha1':hashlib.sha1(rom.read_bytes()).hexdigest(),
        'runner_sha256':sha(__file__),'adapter_sha256':sha(ROOT/'tools/re/session/bridge.py'),
        'emulator':session.emulator,'queue_s':None,'outcome':'running',
        'qualification_scope':('Unmodified USA ROM input and motion only; not a mashup' if base else
            'Generated native movement candidate only; bounded early-stage evidence, not whole-campaign qualification'),
        'composition':lineage,
        'limits':{'setup_frames':2460,'branch_frames':72,'traversal_frames':720},
        'records':records,'observations':[]}
    def step(keys,frames):
        while frames:
            n=min(120,frames);session.act({'keys':keys,'frames':n},120);frames-=n
    def sample(branch,keys):
        b=session.read_memory(0x03005a20,144)
        def v(offset,size=2,signed=False):
            return int.from_bytes(b[offset:offset+size],'little',signed=signed)
        f={'frame':session.frame,'branch':branch,'keys':keys,
            'x':v(0,4,True),'y':v(4,4,True),'vx':v(8,2,True),'vy':v(10,2,True),
            'ground_speed':v(12,2,True),'flags':v(16,4),'angle':v(20,1),
            'held_player':v(56),'pressed_player':v(58),'character_selector':v(89,1),
            'character_state':v(64,1),'slope_lock':v(26,2,True),
            'max_speed':v(44,4,True),'acceleration':v(48,4,True),
            'deceleration':v(52,4,True)}
        for name,address in [('held',0x03001b50),('pressed_edges',0x0300237c),
            ('pressed_repeat',0x03001b78),('released',0x03001fac),
            ('camera_x',0x030059d0),('camera_y',0x030059d2),
            ('stage_flags',0x03005004),('prior_stage_flags',0x0300502c)]:
            f[name]=int.from_bytes(session.read_memory(address,2),'little',signed=name.startswith('camera'))
        f['hybrid_guard']=(not f['stage_flags']&0x80 and bool(f['flags']&0x100) and
            f['flags']&6==6 and f['character_state']==5 and f['character_selector']==0 and
            f['angle']==0 and -768<=f['vx']<=768)
        records.append(f)
    try:
        step([],180)
        for i in range(38):
            step(['START'] if i%2==0 else ['A'],6);step([],54)
        session._command('save 1')
        report['checkpoint_sha256']=sha(out/'checkpoint-1.ss')
        session.start_recording(2)
        for branch in ('held_jump','early_release'):
            session._command('load 1');step([],1)
            sample(branch,[])
            for i in range(36):
                keys=['A'] if branch=='held_jump' or i<3 else []
                step(keys,1);sample(branch,keys)
            report['observations'].append({'branch':branch,**session.observe()})
        session._command('load 1');step([],1)
        for i in range(720):
            keys=['RIGHT']+(['A'] if i%180<12 else [])
            step(keys,1);sample('traversal',keys)
            if i%120==119:report['observations'].append({'branch':'traversal',**session.observe()})
        report['video']=session.stop_recording()
        report['outcome']='observed'
    except Exception as exc:
        report.update(outcome='failed',error=str(exc))
        raise
    finally:
        session.close();report['wall_s']=round(time.monotonic()-start,6)
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--rom',type=Path)
    parser.add_argument('--expected-rom-sha256')
    parser.add_argument('--composition-receipt',type=Path)
    args=parser.parse_args();result=run(args.out.resolve(),args.rom,args.expected_rom_sha256,args.composition_receipt)
    print(json.dumps({'outcome':result['outcome'],'wall_s':result['wall_s'],
                      'sampled_frames':len(result['records']),'output':str(args.out)}))
