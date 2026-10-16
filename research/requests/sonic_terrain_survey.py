#!/usr/bin/env python3
"""Own-ROM terrain survey using the independently instruction-qualified profile.
Read-only ROM asset analysis; candidate floor lists are geometry, not reachability.
"""
import json,struct
from pathlib import Path
ROM=Path(__file__).resolve().parents[2]/'local/roms/Sonic Advance (USA) (En,Ja).gba'
r=ROM.read_bytes();u16=lambda a:struct.unpack_from('<H',r,a-0x8000000)[0];u32=lambda a:struct.unpack_from('<I',r,a-0x8000000)[0]
def profile(stage,x,y,layer):
 h=u32(0x084a6da4+stage*4);cols=u16(h+24);rows=u16(h+26)
 x=max(0,min(x,cols*96-1));y=max(0,min(y,rows*96-1))
 tilex=x//8;tiley=y//8;rx=tilex//12;ry=tiley//12
 meta=r[u32(h+12+layer*4)-0x8000000+ry*cols+rx]
 d=u16(u32(h+8)+meta*288+((tiley%12)*12+tilex%12)*2);idx=d&1023
 sample=x&7
 if d&0x400:sample=7-sample
 packed=r[u32(h)-0x8000000+idx*8+sample];height=packed//16
 if height&8:height-=16
 if height==-8:height=8
 if d&0x800 and height not in (0,8):height+=-8 if height>0 else 8
 angle=r[u32(h+4)-0x8000000+idx];angle=angle-256 if angle>127 else angle
 if d&0x400:angle=-angle
 if d&0x800 and height:angle=-128-angle
 return height,angle&255

def solid(stage,x,y,layer):
 h,a=profile(stage,x,y,layer);sample=y&7
 return h==8 or h>0 and sample>=h-1 or h<0 and sample<=-h

def floors(stage,x,layer):
 h=u32(0x084a6da4+stage*4);out=[]
 for y in range(u16(h+26)*96):
  height,angle=profile(stage,x,y,layer)
  if ((angle+32)&0xc0)==0 and solid(stage,x,y,layer) and not solid(stage,x,y-1,layer):out.append(y)
 return out
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--stage',type=int,required=True);p.add_argument('--x',type=int,nargs='+',required=True);a=p.parse_args()
 print(json.dumps({x:{layer:floors(a.stage,x,layer) for layer in [0,1]} for x in a.x}))
