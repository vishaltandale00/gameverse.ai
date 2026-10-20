#!/usr/bin/env python3
"""Reextract one own-ROM sprite closure, never download or commit asset bytes.
Evidence: original sprite-engine0800DF84 loads gfx/palette through0875EBF8/
0875EEF0, species−0x10; original species16 initializer0801BD8C binds walk
animation082CC048. Output belongs in ignored local/ and is source-hash pinned.
"""
import argparse,hashlib,json,struct,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT))
from tools.re.session.bridge import png
ROM_SHA256='fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37'
def extract(rom,out):
 start=time.monotonic();r=rom.read_bytes();assert hashlib.sha256(r).hexdigest()==ROM_SHA256,'MZM ROM identity mismatch';out.mkdir(parents=True,exist_ok=False)
 def u16(a):return struct.unpack_from('<H',r,a-0x8000000)[0]
 def u32(a):return struct.unpack_from('<I',r,a-0x8000000)[0]
 gfx=u32(0x875ebf8+6*4);pal=u32(0x875eef0+6*4);p=gfx-0x8000000;assert r[p]==16;n=int.from_bytes(r[p+1:p+4],'little');assert n==2048;p+=4;data=bytearray()
 while len(data)<n:
  bits=r[p];p+=1
  for mask in [128,64,32,16,8,4,2,1]:
   if len(data)>=n:break
   if bits&mask:
    a,b=r[p:p+2];p+=2;count=(a>>4)+3;back=((a&15)<<8|b)+1;assert back<=len(data)
    for i in range(count):data.append(data[-back])
   else:data.append(r[p]);p+=1
 data=bytes(data[:n]);colors=[u16(pal+i*2) for i in range(16)];scripts=[];frames=[];addresses=[]
 for base in [0x82cc048,0x82cc070,0x82cc088]:
  script=[]
  for i in range(16):
   pointer=u32(base+i*8);duration=r[base+i*8+4-0x8000000]
   if not duration:break
   if pointer not in addresses:
    addresses.append(pointer);count=u16(pointer);assert count in [1,2]
    frame=[]
    for j in range(count):
     a0,a1,a2=[u16(pointer+2+j*6+k*2) for k in range(3)];tile=a2&1023;assert 0x200<=tile<0x240
     frame.append([a0,a1,tile-0x200])
    frames.append(frame)
   script.append([addresses.index(pointer),duration])
  assert script;scripts.append(script)
 # Native composition consumes tile bytes and OAM parts directly; no screenshot
 # cutout, invented pixels, palette approximation or engine ROM call required.
 header='''#pragma once
#include <stdint.h>
typedef struct {uint16_t a0,a1,tile;} GvMzmPart;
typedef struct {uint8_t count,reserved;GvMzmPart parts[2];} GvMzmFrame;
typedef struct {uint8_t frame,duration;} GvMzmCel;
extern const uint16_t gv_mzm_flyer_palette[16];
extern const uint32_t gv_mzm_flyer_tiles[512];
extern const GvMzmFrame gv_mzm_flyer_frames[5];
extern const GvMzmCel gv_mzm_flyer_scripts[3][5];
extern const uint8_t gv_mzm_flyer_durations[3][5];
'''
 lines=['/* Reextracted from identity-pinned user ROM; private generated asset. */','#include "assets.h"','const uint16_t gv_mzm_flyer_palette[16]={'+','.join(hex(x) for x in colors)+'};','const uint32_t gv_mzm_flyer_tiles[512]={']
 words=struct.unpack('<512I',data)
 for i in range(0,512,8):lines.append(','.join(hex(x)+'u' for x in words[i:i+8])+',')
 lines+=['};','const GvMzmFrame gv_mzm_flyer_frames[5]={']
 assert len(frames)==5
 for frame in frames:lines.append('{%d,0,{%s}},'%(len(frame),','.join('{%d,%d,%d}'%tuple(p) for p in frame)))
 lines+=['};','const GvMzmCel gv_mzm_flyer_scripts[3][5]={']
 for script in scripts:lines.append('{'+','.join('{%d,%d}'%tuple(x) for x in script)+',{0,0}},')
 lines+=['};','const uint8_t gv_mzm_flyer_durations[3][5]={']
 for script in scripts:lines.append('{'+','.join(str(c[1]) for c in script)+',0},')
 lines+=['};'];(out/'assets.h').write_text(header);(out/'assets.c').write_text('\n'.join(lines)+'\n')
 # Read-only contact sheet of actual 4bpp/OAM frames for extraction review.
 rgba=bytearray([22,25,37,255]*(240*160));sizes=[[(8,8),(16,16),(32,32),(64,64)],[(16,8),(32,8),(32,16),(64,32)],[(8,16),(8,32),(16,32),(32,64)]]
 for i,frame in enumerate(frames):
  for a0,a1,tile in frame:
   w,h=sizes[a0>>14][a1>>14];x=(a1&511);x=x-512 if x>=256 else x;y=a0&255;y=y-256 if y>=128 else y
   for yy in range(h):
    for xx in range(w):
     tx=(w-1-xx) if a1&0x1000 else xx;ty=(h-1-yy) if a1&0x2000 else yy
     t=tile+(ty//8)*(w//8)+tx//8;idx=data[t*32+(ty%8)*4+(tx%8)//2]>>((tx%2)*4)&15
     if not idx:continue
     c=colors[idx];rgb=[(c&31)*255//31,((c>>5)&31)*255//31,((c>>10)&31)*255//31,255]
     px=24+i*46+(x+16)+xx;py=64+y+yy
     # Native-size atlas centered in48px cells; no resampling in ROM assets.
     if 0<=px<240 and 0<=py<160:rgba[(py*240+px)*4:(py*240+px)*4+4]=bytes(rgb)
 (out/'frames.png').write_bytes(png(rgba))
 report={'schema':'gameverse.rom-sprite-extraction/1','rom_sha256':ROM_SHA256,'species':22,'function_dispatch':'0x0875e8c0+species*4','gfx':{'address':hex(gfx),'compressed_bytes':p-(gfx-0x8000000),'uncompressed_bytes':n,'sha256':hashlib.sha256(data).hexdigest()},'palette':{'address':hex(pal),'bytes':32,'sha256':hashlib.sha256(r[pal-0x8000000:pal-0x8000000+32]).hexdigest()},'frames':{'addresses':[hex(a) for a in addresses],'parts':frames,'scripts':scripts},'outputs':{f:{'sha256':hashlib.sha256((out/f).read_bytes()).hexdigest()} for f in ['assets.c','assets.h','frames.png']},'scope':'Raw original tile/OAM/palette extraction; no claim of AI qualification or gameplay installation','wall_s':time.monotonic()-start,'queue_s':None};(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'outcome':'extracted','frames':len(frames),'bytes':n,'wall_s':report['wall_s']}));return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--rom',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();extract(a.rom.resolve(),a.out.resolve())
