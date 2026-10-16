#!/usr/bin/env python3
"""Recover versioned Sonic USA stage geometry assets from own ROM evidence.

No community game source or foreign ROM offsets. The header-table address comes
from own lift0x0803E0B0 and its first live pointer was independently observed.
Array bounds derive from dimensions, tile IDs and the reviewed native lookup.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import time

ROOT=Path(__file__).resolve().parents[2]
BASE=0x08000000
TABLE=0x084A6DA4

def extract(out):
    start=time.monotonic()
    rom=(ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba').read_bytes()
    if hashlib.sha1(rom).hexdigest()!='d842afa7dd1e84de08addb94a51506f1bcafd551':
        raise ValueError('USA ROM hash mismatch')
    out.mkdir(parents=True,exist_ok=False)
    stages=[]
    def asset(folder,label,address,size):
        if not BASE<=address or address+size>BASE+len(rom) or size<1:
            raise ValueError('Unmapped asset range')
        data=rom[address-BASE:address-BASE+size]
        path=folder/(label+'.bin');path.write_bytes(data)
        return {'address':hex(address),'bytes':size,'sha256':hashlib.sha256(data).hexdigest(),
                'path':str(path),'label':label}
    for index in range(32):
        pointer=struct.unpack_from('<I',rom,TABLE-BASE+index*4)[0]
        if not BASE<=pointer<=BASE+len(rom)-32:
            stop={'index':index,'value':hex(pointer),'reason':'first non-ROM pointer; stop rather than interpret following data'}
            break
        header=rom[pointer-BASE:pointer-BASE+32]
        heights,angles,descriptors,front,back,flags,cols,rows,width,height=struct.unpack('<6I4H',header)
        if not cols or not rows or width!=cols*96 or height!=rows*96:
            raise ValueError('Header geometry invariant fails')
        if any(not BASE<=p<BASE+len(rom) for p in [heights,angles,descriptors,front,back,flags]):
            raise ValueError('Invalid header data pointer')
        folder=out/('stage-%02d'%index);folder.mkdir()
        front_bytes=rom[front-BASE:front-BASE+cols*rows]
        back_bytes=rom[back-BASE:back-BASE+cols*rows]
        count=max(max(front_bytes),max(back_bytes))+1
        words=struct.unpack_from('<%dH'%(count*144),rom,descriptors-BASE)
        tile_count=max(w&0x3ff for w in words)+1
        assets=[asset(folder,'header',pointer,32),asset(folder,'front_map',front,cols*rows),
          asset(folder,'back_map',back,cols*rows),asset(folder,'metatile_descriptors',descriptors,count*288),
          asset(folder,'height_profiles',heights,tile_count*8),asset(folder,'surface_angles',angles,tile_count),
          asset(folder,'packed_flags',flags,((tile_count+7)//8)*2)]
        stages.append({'stage_index':index,'header_address':hex(pointer),'columns':cols,'rows':rows,
          'width_pixels':width,'height_pixels':height,'metatile_count_referenced':count,
          'tile_profile_count_referenced':tile_count,'assets':assets,
          'semantics':'96px metatiles,12x12 8px descriptor cells; byte map IDs; low10bits select tile profile; flag/height response not yet recovered'})
    else:raise ValueError('No table terminator within bounded32-header scan')
    report={'schema_version':1,'kind':'self_decompiled_stage_geometry','game_id':'sonic-advance',
      'rom_sha1':hashlib.sha1(rom).hexdigest(),'rom_sha256':hashlib.sha256(rom).hexdigest(),
      'extractor_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'authority':'Exact USA ROM, own instructions0x0803E0B0/0x08040080, first live header pointer0x084BF1F8',
      'header_table_address':hex(TABLE),'stage_count':len(stages),'stop':stop,'stages':stages,
      'queue_s':None,'wall_s':round(time.monotonic()-start,6),
      'limits':['Geometry assets only; no full world scene/graphics/entity build',
                'All18 table entries recovered; not proof each campaign transition or named stage mapping',
                'Height/material response requires separate recovered code and native tests']}
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,required=True)
    args=p.parse_args();r=extract(args.out.resolve())
    print(json.dumps({'out':str(args.out),'stages':r['stage_count'],'wall_s':r['wall_s']}))
