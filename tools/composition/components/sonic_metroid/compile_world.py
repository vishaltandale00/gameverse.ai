#!/usr/bin/env python3
"""Lower the versioned campaign-prefab IR and original tiny OBJ art to readonly C.
No ROM bytes or downloaded game assets are emitted. Numeric entity kinds and
Q8 adapters are checked against the native component contract, not C templates
edited per cartridge variant.
"""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
KINDS={'relic':1,'gate':2,'alien':3,'recharge':4,'heat':5,'freeze_gateway':6}
UPGRADES=['morph','missile','bomb','high_jump','ice','varia','speed','screw']
GATES=['beam','missile','bomb','high_jump','ice_platform','speed','screw']
ALIENS=['crawler','flyer','pirate','guardian']
FONT={
'A':['01110','10001','10001','11111','10001','10001','10001'],
'B':['11110','10001','10001','11110','10001','10001','11110'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'D':['11110','10001','10001','10001','10001','10001','11110'],
'E':['11111','10000','10000','11110','10000','10000','11111'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'G':['01111','10000','10000','10111','10001','10001','01111'],
'H':['10001','10001','10001','11111','10001','10001','10001'],
'I':['11111','00100','00100','00100','00100','00100','11111'],
'J':['00111','00010','00010','00010','10010','10010','01100'],
'K':['10001','10010','10100','11000','10100','10010','10001'],
'L':['10000','10000','10000','10000','10000','10000','11111'],
'M':['10001','11011','10101','10101','10001','10001','10001'],
'N':['10001','11001','10101','10011','10001','10001','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'P':['11110','10001','10001','11110','10000','10000','10000'],
'Q':['01110','10001','10001','10001','10101','10010','01101'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'S':['01111','10000','10000','01110','00001','00001','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['10001','10001','10001','10001','10001','10001','01110'],
'V':['10001','10001','10001','10001','10001','01010','00100'],
'W':['10001','10001','10001','10101','10101','10101','01010'],
'X':['10001','10001','01010','00100','01010','10001','10001'],
'Y':['10001','10001','01010','00100','00100','00100','00100'],
'Z':['11111','00001','00010','00100','01000','10000','11111'],
'0':['01110','10001','10011','10101','11001','10001','01110'],
'1':['00100','01100','00100','00100','00100','00100','01110'],
'2':['01110','10001','00001','00010','00100','01000','11111'],
'3':['11110','00001','00001','01110','00001','00001','11110'],
'4':['00010','00110','01010','10010','11111','00010','00010'],
'5':['11111','10000','10000','11110','00001','00001','11110'],
'6':['01110','10000','10000','11110','10001','10001','01110'],
'7':['11111','00001','00010','00100','01000','01000','01000'],
'8':['01110','10001','10001','01110','10001','10001','01110'],
'9':['01110','10001','10001','01111','00001','00001','01110'],
'+':['00000','00100','00100','11111','00100','00100','00000'],
'-':['00000','00000','00000','11111','00000','00000','00000'],
'/':['00001','00001','00010','00100','01000','10000','10000'],
':':['00000','00100','00100','00000','00100','00100','00000'],
'.':['00000','00000','00000','00000','00000','00100','00100']}
def art():
 tiles=[[0]*64 for _ in range(96)]
 for c,rows in FONT.items():
  a=tiles[ord(c)-32]
  for y,row in enumerate(rows):
   for x,p in enumerate(row):
    if p=='1':
     if x+2<8 and y+1<8:a[(y+1)*8+x+2]=1
  for y,row in enumerate(rows):
   for x,p in enumerate(row):
    if p=='1':a[y*8+x+1]=2
 def image(index,rows):
  h=len(rows);w=len(rows[0]);assert (w,h) in [(8,8),(16,16)]
  for y,row in enumerate(rows):
   for x,p in enumerate(row):tiles[index+(y//8)*(w//8)+x//8][(y%8)*8+x%8]=int(p,16)
 image(64,['00000000','00000000','00333300','03222230','00333300','00000000','00000000','00000000'])
 image(65,['00000000','00000400','04444440','42222224','04444440','00000400','00000000','00000000'])
 image(66,['00000000','00011000','00144100','01422410','01422410','00144100','00011000','00000000'])
 image(67,['00011000','00166100','01622610','16222261','16222261','01622610','00166100','00011000'])
 image(68,['00011000','00144100','01422410','01422410','01422410','01422410','00144100','00011000'])
 image(69,['30033003','03322330','03222230','32222223','32222223','03222230','03322330','30033003'])
 image(70,['00011000','00144100','01400410','14422441','14222241','14222241','01444410','00111100'])
 image(71,['00033000','00322300','03222230','32222223','03222230','00322300','00033000','00000000'])
 # Original authored silhouettes. Palette/shape deliberately distinguish enemy
 # roles and teach their telegraph; they are not claimed as extracted MZM art.
 def creature(kind):
  a=[['0']*16 for _ in range(16)]
  for y in range(3,13):
   for x in range(2,14):
    if (x-8)**2+(y-8)**2<44:a[y][x]=str(5 if kind==3 else 4 if kind==4 else 6)
  for x in range(3,13):a[3][x]='1';a[12][x]='1'
  for y in range(5,11):a[y][2]=a[y][13]='1'
  a[6][5]=a[6][10]='2';a[7][5]=a[7][10]='7'
  if kind==1:
   for x in range(2,14,3):a[13][x]=a[14][x]='1'
  elif kind==2:
   for y in range(2,8):a[y][y//2]=a[y][15-y//2]='5'
  elif kind==3:
   for y in range(11,16):a[y][5]=a[y][10]='1'
   for x in range(11,16):a[8][x]='4'
  else:
   for x in range(3,13):a[1][x]='4';a[2][x]='7'
  return [''.join(r) for r in a]
 for k in range(1,5):image(72+(k-1)*4,creature(k))
 image(88,['0000011111100000','0000133333310000','0001322222231000','0013223333223100','0132236666322310','1322362222632231','1323623333263221','1323623333263221','1323623333263221','1322362222632231','0132236666322310','0013223333223100','0001322222231000','0000133333310000','0001111111111000','0013333333333100'])
 image(92,['1144444444444411','1422222222222241','1433333333333341','1431111111111341','1431444444441341','1431442222441341','1431442222441341','1431442222441341','1431442222441341','1431442222441341','1431444444441341','1431111111111341','1433333333333341','1422222222222241','1144444444444411','0000000000000000'])
 return [sum(tile[y*8+x]<<(x*4) for x in range(8)) for tile in tiles for y in range(8)]
def compile_world(doc):
 assert doc['version']=='sonic-metroid-campaign/1' and len(doc['stages'])==18
 lines=['/* Generated from campaign IR; edit the IR, never this output. */','#include "game.h"','const GvStageSpec gv_stages[18]={']
 for i,s in enumerate(doc['stages']):
  assert s['native_stage']==i and len(s['prefabs'])<=8
  pf=[];seen=set()
  for p in s['prefabs']:
   k=p['kind'];v=p.get('component','');ident=p['id'];assert ident not in seen and 0<=ident<16;seen.add(ident)
   n=UPGRADES.index(v) if k=='relic' else GATES.index(v)+1 if k=='gate' else ALIENS.index(v)+1 if k=='alien' else 0
   assert 32<=p['x']<s['native_extent_px'][0] and -256<=p.get('floor_offset',0)<=128
   if k=='freeze_gateway':
    rule=p['requires'];assert rule['support_must_respawn'] and set(rule['abilities'])=={'ice'}
    assert rule['support_offset_x']==-60 and rule['support_height_px']==32 and rule['normal_jump_height_requirement_px']<=57 and rule['barrier_height_px']==86
   if k=='gate' and v=='ice_platform':
    rule=p['requires'];support=next(e for e in s['prefabs'] if e['id']==rule['support_actor_id'])
    assert rule['support_must_respawn'] and support.get('renewable') and support['kind']=='alien'
    assert abs(support['x']-p['x'])<=rule['max_horizontal_separation_px']<=80
    assert set(rule['abilities'])=={'ice','high_jump'}
   pf.append('{%d,%d,%d,%d,%d,%d}'%(KINDS[k],n,ident,1 if p.get('renewable') else 0,p['x'],p.get('floor_offset',0)))
  lines.append('{%s,%s,%d,%d,%d,0,{%s}},'%(json.dumps(s['region']),json.dumps(s['entry']),len(pf),s.get('heat',False),s.get('guardian',False),','.join(pf)))
 lines+=['};','const char *const gv_messages[]={']
 for pair in doc['messages']:
  assert len(pair)==2 and all(len(t)<=28 and all(32<=ord(c)<96 for c in t) for t in pair)
  lines.append(','.join(json.dumps(t) for t in pair)+',')
 lines+=['};','const uint16_t gv_palette[16]={0,0x0421,0x7fff,0x7fe0,0x02ff,0x7c9f,0x03e8,0x001f,0,0,0,0,0,0,0,0};','const uint32_t gv_tile_pixels[96*8]={']
 words=art()
 for n in range(0,len(words),8):lines.append(','.join('0x%08xu'%v for v in words[n:n+8])+',')
 lines+=['};'];return '\n'.join(lines)+'\n'
def compile_schedule(doc):
 graph=doc['runtime_graph'];assert graph['version']=='typed-native-frame-graph/1'
 signatures={'gv_resources_step':['state','player'],'gv_weapons_step':['state','player','keys','edges'],'gv_progression_step':['state','player','keys','edges'],'gv_ecology_step':['state','player'],'gv_draw_game':['state','player']}
 lines=['/* Generated executable typed frame graph from campaign IR. */','#include "game.h"','void gv_tick_components(GvState *state,GvPlayer *player,uint16_t keys,uint16_t edges){']
 seen=set()
 for row in graph['systems']:
  assert row['id'] not in seen and set(row['after'])<=seen and signatures[row['symbol']]==row['args']
  assert row['when'] in ('always','alive')
  call=row['symbol']+'('+','.join(row['args'])+');'
  lines.append(('if(!(player->flags&0x80))' if row['when']=='alive' else '')+call);seen.add(row['id'])
 assert set(signatures)=={r['symbol'] for r in graph['systems']}
 lines.append('}');return '\n'.join(lines)+'\n'

def main():
 a=argparse.ArgumentParser();a.add_argument('--ir',type=Path,required=True);a.add_argument('--out',type=Path,required=True);p=a.parse_args()
 d=json.loads(p.ir.read_text());p.out.write_text(compile_world(d));print(json.dumps({'ir_sha256':hashlib.sha256(p.ir.read_bytes()).hexdigest(),'output_sha256':hashlib.sha256(p.out.read_bytes()).hexdigest(),'stages':18,'prefabs':sum(len(s['prefabs']) for s in d['stages'])}))
if __name__=='__main__':main()
