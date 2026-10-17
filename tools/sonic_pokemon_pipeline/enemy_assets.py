"""Private, deterministic Pokemon-art adapter for Sonic Advance's native badniks.

Only proven, exclusively enemy-owned uncompressed 4bpp tile spans are changed.
Native animation commands, palettes, OAM, hitboxes, AI and level data stay intact.
"""
import hashlib
import json
import re
import struct
import subprocess
import time
import zlib
from pathlib import Path

SONIC_SHA1 = 'd842afa7dd1e84de08addb94a51506f1bcafd551'
LEAF_SHA1 = '7862c67bdecbe21d1d69ce082ce34327e1c6ed5e'
VERSION = 'sonic-pokemon-enemy-art/1'
ROLES = {
    'kiki': ('mankey', [401]), 'buzzer': ('beedrill', [403]),
    'gamigami': ('pidgey', [404]), 'rhinotank': ('rhyhorn', [405]),
    'kerokero': ('poliwag', [406]), 'senbon': ('shellder', [411]),
    'tentou': ('ledyba', [412]), 'fireball': ('voltorb', [413]),
    'hanabii': ('oddish', [415]), 'slot': ('magnemite', [417]),
    'pierrot': ('mr_mime', [418]), 'yukimaru': ('seel', [422, 423]),
    'drisame': ('horsea', [424]), 'kuraa': ('krabby', [425]),
    'pen': ('psyduck', [426]), 'leon': ('kecleon', [430]),
    'wamu': ('caterpie', [431]), 'mirror': ('abra', [432]),
    'oct': ('octillery', [433]), 'mole': ('diglett', [434]),
}
SHAPES = (((8,8),(16,16),(32,32),(64,64)),
          ((16,8),(32,8),(32,16),(64,32)),
          ((8,16),(8,32),(16,32),(32,64)))

def digest(data):
    return hashlib.sha256(data).hexdigest()

def indexed_png(path):
    """Read indexed PNGs without quantization or external graphics dependencies."""
    raw=Path(path).read_bytes()
    if raw[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('expected_png')
    offset=8;payload=bytearray();header=None
    while offset<len(raw):
        size=struct.unpack_from('>I',raw,offset)[0];kind=raw[offset+4:offset+8];body=raw[offset+8:offset+8+size]
        crc=struct.unpack_from('>I',raw,offset+8+size)[0]
        if zlib.crc32(kind+body)&0xffffffff!=crc:raise ValueError('png_crc_mismatch')
        if kind==b'IHDR':header=struct.unpack('>IIBBBBB',body)
        if kind==b'IDAT':payload.extend(body)
        offset+=12+size
    if header is None:raise ValueError('png_header_missing')
    width,height,bits,color,compression,filtering,interlace=header
    if color!=3 or bits not in (4,8) or compression or filtering or interlace:
        raise ValueError('unsupported_indexed_png')
    stride=(width*bits+7)//8;data=zlib.decompress(payload)
    if len(data)!=height*(stride+1):raise ValueError('png_scanline_size')
    previous=bytearray(stride);pixels=[]
    for y in range(height):
        start=y*(stride+1);filter_type=data[start];row=bytearray(data[start+1:start+1+stride])
        for x in range(stride):
            left=row[x-1] if x else 0;up=previous[x];upper_left=previous[x-1] if x else 0
            if filter_type==1:predict=left
            elif filter_type==2:predict=up
            elif filter_type==3:predict=(left+up)//2
            elif filter_type==4:
                p=left+up-upper_left;dist=[abs(p-v) for v in (left,up,upper_left)]
                predict=(left,up,upper_left)[dist.index(min(dist))]
            elif filter_type==0:predict=0
            else:raise ValueError('unsupported_png_filter')
            row[x]=(row[x]+predict)&255
        values=list(row) if bits==8 else [v for byte in row for v in (byte>>4,byte&15)]
        values=values[:width]
        if any(v>15 for v in values):raise ValueError('not_4bpp_indices')
        pixels.append(values);previous=row
    return pixels

def encode_tiles(pixels):
    height,width=len(pixels),len(pixels[0])
    if width%8 or height%8:raise ValueError('unaligned_tile_geometry')
    result=bytearray(width*height//2)
    for y,row in enumerate(pixels):
        if len(row)!=width:raise ValueError('ragged_pixels')
        for x,value in enumerate(row):
            if not 0<=value<=15:raise ValueError('not_4bpp_indices')
            index=((y//8)*(width//8)+x//8)*32+(y%8)*4+x%8//2
            result[index]|=value<<(4*(x%2))
    return bytes(result)

def decode_tiles(data,width,height):
    if len(data)!=width*height//2:raise ValueError('tile_geometry_mismatch')
    return [[(data[((y//8)*(width//8)+x//8)*32+(y%8)*4+x%8//2]>>(4*(x%2)))&15 for x in range(width)] for y in range(height)]

def palette(path):
    lines=Path(path).read_text().splitlines()
    if lines[:3]!=['JASC-PAL','0100','16']:raise ValueError('expected_16_color_palette')
    colors=[tuple(int(v)>>3 for v in line.split()) for line in lines[3:19]]
    if len(colors)!=16 or any(len(c)!=3 for c in colors):raise ValueError('invalid_palette')
    return colors,struct.pack('<16H',*(r|(g<<5)|(b<<10) for r,g,b in colors))

def remap_palette(source,target):
    return [0]+[min(range(1,16),key=lambda j:sum((v-target[j][k])**2 for k,v in enumerate(color))) for color in source[1:]]

def parse_objects(text):
    return [{k:int(v,0) for k,v in re.findall(r'\.(\w+)\s*=\s*(0x[0-9a-fA-F]+|-?\d+)',part)} for part in re.findall(r'\{([^{}]+)\}',text,re.S)]

def fit_into_union(source,oams,dimensions):
    """Fit source silhouette into the OAM rectangle union, never an enemy mask."""
    rectangles=[]
    for oam in oams:
        w,h=SHAPES[oam['shape']][oam['size']]
        x=oam['x'] if oam['x']<256 else oam['x']-512
        y=oam['y'] if oam['y']<128 else oam['y']-256
        rectangles.append((x,y,w,h))
    # Source dimension coordinates are the original engine's frame canvas.
    x0=min(x for x,y,w,h in rectangles);y0=min(y for x,y,w,h in rectangles)
    x1=max(x+w for x,y,w,h in rectangles);y1=max(y+h for x,y,w,h in rectangles)
    opaque=[(x,y) for y,row in enumerate(source) for x,v in enumerate(row) if v]
    if not opaque:raise ValueError('empty_pokemon_frame')
    sx0=min(x for x,y in opaque);sy0=min(y for x,y in opaque)
    sw=max(x for x,y in opaque)+1-sx0;sh=max(y for x,y in opaque)+1-sy0
    # Largest centered rectangular canvas entirely inside the union. This avoids
    # silently clipping a recognizable Pokemon across sparse native OAM layouts.
    def covered(x,y):return any(rx<=x<rx+w and ry<=y<ry+h for rx,ry,w,h in rectangles)
    best=None
    for h in range(1,min(64,y1-y0)+1):
        w=max(1,round(sw*h/sh))
        if w>x1-x0:continue
        left=(x0+x1-w)//2;top=y1-h
        if all(covered(x,y) for y in range(top,top+h) for x in range(left,left+w)):
            if best is None or w*h>best[0]:best=(w*h,left,top,w,h)
    if best is None:raise ValueError('no_opaque_safe_oam_canvas')
    _,left,top,w,h=best
    canvas={}
    for y in range(h):
        for x in range(w):canvas[left+x,top+y]=source[sy0+y*sh//h][sx0+x*sw//w]
    return canvas,{'source_opaque_bounds':[sx0,sy0,sx0+sw,sy0+sh],
        'target_bounds':[left,top,left+w,top+h],'oam_union_bounds':[x0,y0,x1,y1],
        'policy':'source-transparent-trim, nearest-neighbor proportional fit into complete native OAM rectangle union; bottom-centered',
        'native_enemy_opacity_mask_used':False,'resampled':(w,h)!=(sw,sh)}

def pack_oam(canvas,oams,length,indexmap):
    output=bytearray(length);assigned={}
    for oam in oams:
        if oam['bpp'] or oam['affineMode'] or oam['objMode']:
            raise ValueError('unsupported_enemy_oam_mode')
        w,h=SHAPES[oam['shape']][oam['size']]
        ox=oam['x'] if oam['x']<256 else oam['x']-512
        oy=oam['y'] if oam['y']<128 else oam['y']-256
        pixels=[]
        for y in range(h):
            row=[]
            for x in range(w):
                xx=w-1-x if oam['matrixNum']&8 else x
                yy=h-1-y if oam['matrixNum']&16 else y
                row.append(indexmap[canvas.get((ox+xx,oy+yy),0)])
            pixels.append(row)
        raw=encode_tiles(pixels);start=oam['tileNum']*32
        if start+len(raw)>length:raise ValueError('oam_beyond_native_tile_allocation')
        for i,value in enumerate(raw,start):
            if i in assigned and assigned[i]!=value:raise ValueError('conflicting_oam_tile_alias')
            assigned[i]=value;output[i]=value
    return bytes(output)


def native_stream(rom, address):
    """Decode one bounded reachable native animation stream, without source offsets."""
    start=address-0x08000000;at=start;commands=[];tile=None;pal=None;frames=[]
    sizes={-1:3,-2:3,-3:2,-4:1,-5:2,-6:3,-7:2,-8:3,-9:2,-10:4,-11:2,-12:2}
    for _ in range(2048):
        if at<0 or at+4>len(rom):raise ValueError('native_animation_pointer_out_of_rom')
        command=struct.unpack_from('<i',rom,at)[0];size=2 if command>=0 else sizes.get(command)
        if size is None or at+size*4>len(rom):raise ValueError('unknown_native_animation_command')
        words=list(struct.unpack_from('<'+'i'*size,rom,at));commands.append(words)
        if command==-1:tile=words[1:]
        if command==-2:pal=[words[1],words[2]&65535,(words[2]>>16)&65535]
        if command>=0:
            if tile is not None:frames.append({'duration':words[0],'frame':words[1],'tiles':tile[:],'palette':pal[:] if pal else None})
        at+=size*4
        if command in (-3,-4,-9):return {'rom_offset':start,'length':at-start,'sha256':digest(rom[start:at]),'commands':commands,'frames':frames}
    raise ValueError('unbounded_native_animation_stream')

def apply(original_sonic,original_leaf,source_sonic,source_pokemon,out,recipe=None):
    started=time.monotonic();original_sonic=Path(original_sonic);original_leaf=Path(original_leaf)
    host=Path(source_sonic);donor=Path(source_pokemon);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    sonic=original_sonic.read_bytes();leaf=original_leaf.read_bytes()
    if hashlib.sha1(sonic).hexdigest()!=SONIC_SHA1:raise ValueError('sonic_original_identity_mismatch')
    if hashlib.sha1(leaf).hexdigest()!=LEAF_SHA1:raise ValueError('leafgreen_rev1_original_identity_mismatch')
    roles=ROLES
    if recipe is not None and recipe.get('mapping_policy') not in (None,'semantic-native-enemy-roles'):
        raise ValueError('unsupported_enemy_mapping_policy')
    dependencies={}
    def read(root,relative):
        raw=(root/relative).read_bytes();dependencies[('sonic/' if root==host else 'pokemon/')+relative]=digest(raw);return raw.decode()
    def pixels(root,relative):
        dependencies[('sonic/' if root==host else 'pokemon/')+relative]=digest((root/relative).read_bytes());return indexed_png(root/relative)
    animations=read(host,'src/data/sa1/animations/animations.c')
    read(host,'src/data/sa1/sprite_dimensions.c');read(host,'src/data/sa1/oam_data.c')
    read(host,'include/constants/sa1/animations.h');read(host,'src/sprite.c');read(host,'graphics/sa1/obj_tiles_4bpp.inc')
    iconcode=read(donor,'src/pokemon_icon.c')
    read(host,'src/data/sa1/animations/animation_table.c')
    original_zero=encode_tiles(pixels(host,'graphics/sa1/obj_tiles/4bpp/a0000_f000.png'))
    candidates=[];at=0
    while True:
        at=sonic.find(original_zero,at)
        if at<0:break
        pointer=struct.pack('<I',0x08000000+at);reference=sonic.find(pointer)
        if reference>=16 and reference+8<=len(sonic):
            table=struct.unpack_from('<6I',sonic,reference-16)
            if all(0x08000000<=v<0x08000000+len(sonic) for v in table):candidates.append((at,reference-16,table))
        at+=1
    if len(candidates)!=1:raise ValueError('ambiguous_active_original_tile_pool_base')
    tilebase,sprite_table_offset,sprite_table=candidates[0]
    def pointer(address):
        offset=address-0x08000000
        if offset<0 or offset+4>len(sonic):raise ValueError('native_graph_pointer_out_of_rom')
        return struct.unpack_from('<I',sonic,offset)[0]
    variant_counts={int(aid):int(count) for aid,count in re.findall(r'const s32 \*const anim_(\d{4})\[(\d+)\]',animations)}
    source_variant_counts=variant_counts;variant_counts={};variant_count_differences=[]
    streams={};references=[]
    native_animation_count=(pointer(sprite_table[1])-sprite_table[0])//4
    if not 400<native_animation_count<=1024:raise ValueError('unbounded_native_animation_table')
    for aid in range(native_animation_count):
        table_pointer=pointer(sprite_table[0]+aid*4)
        if not table_pointer:continue
        if not 0x08000000<=table_pointer<0x08000000+len(sonic):raise ValueError('native_animation_table_pointer:'+str(aid)+':'+hex(table_pointer))
        count=0
        while count<256:
            entry=pointer(table_pointer+count*4)
            if not 0x08000000<=entry<sprite_table[0]:break
            count+=1
        if count==0 or count==256:raise ValueError('unbounded_native_variant_pointer_table')
        variant_counts[aid]=count
        if source_variant_counts.get(aid)!=count:variant_count_differences.append({'animation_id':aid,'source_variant_count':source_variant_counts.get(aid),'native_variant_count':count})
        for variant in range(count):
            stream=native_stream(sonic,pointer(table_pointer+variant*4));streams[aid,variant]=stream
            for words in stream['commands']:
                if words[0]==-1 and words[1]>=0:references.append({'animation_id':aid,'variant':variant,'tile_index':words[1],'tile_count':words[2]})
    selected={aid for species,ids in roles.values() for aid in ids}
    result=bytearray(sonic);ranges={};families=[];skipped=[];all_variants=[];host_png_mismatches=[]
    for role,(species,ids) in roles.items():
        read(host,'src/game/sa1/stage/enemies/'+('pen_mk1' if role=='pen' else role)+'.c')
        iconpath='graphics/pokemon/'+species+'/icon.png';icon=pixels(donor,iconpath)
        if len(icon)!=64 or len(icon[0])!=32:raise ValueError('expected_two_frame_pokemon_icon:'+species)
        iconraw=encode_tiles(icon);iconoffset=leaf.find(iconraw)
        if iconoffset<0:raise ValueError('pokemon_original_icon_proof_failed:'+species)
        palette_id=int(re.search(r'\[SPECIES_'+species.upper()+r'\]\s*=\s*(\d+)\s*,',iconcode[iconcode.index('const u8 gMonIconPaletteIndices'):])[1])
        palpath='graphics/pokemon/icon_palettes/icon_palette_'+str(palette_id)+'.pal';read(donor,palpath)
        donorcolors,donorpal=palette(donor/palpath);donorpaloffset=leaf.find(donorpal)
        if donorpaloffset<0:raise ValueError('pokemon_original_palette_proof_failed')
        family={'role':role,'species':species,'animation_ids':ids,'variants':[],'frames':[],
                'donor_icon_original_rom_offset':iconoffset,'donor_icon_original_sha256':digest(iconraw),
                'donor_palette_original_rom_offset':donorpaloffset,'donor_palette_id':palette_id,
                'donor_icon_source_path':iconpath}
        for aid in ids:
            dimpointer=pointer(sprite_table[1]+aid*4);oampointer=pointer(sprite_table[2]+aid*4)
            unique={}
            for variant in range(variant_counts[aid]):
                stream=streams[aid,variant]
                family['variants'].append({'animation_id':aid,'variant':variant,'stream_rom_offset':stream['rom_offset'],'stream_length':stream['length'],'stream_sha256':stream['sha256']})
                all_variants.append({'animation_id':aid,'variant':variant})
                for nativeframe in stream['frames']:
                    duration,frame=nativeframe['duration'],nativeframe['frame'];tile,count=nativeframe['tiles']
                    key=(tile,count)
                    if key in unique:continue
                    unique[key]=True
                    pal=nativeframe['palette']
                    if pal is None or pal[1]!=16:raise ValueError('unsupported_native_palette_load')
                    nativepalid,slot=pal[0],pal[2]//16
                    targetpaloffset=sprite_table[3]-0x08000000+nativepalid*32
                    targetpal=sonic[targetpaloffset:targetpaloffset+32]
                    targetcolors=[(v&31,(v>>5)&31,(v>>10)&31) for v in struct.unpack('<16H',targetpal)]
                    indexmap=remap_palette(donorcolors,targetcolors)
                    dimoffset=dimpointer-0x08000000+frame*12
                    values=struct.unpack_from('<BBHHHhh',sonic,dimoffset)
                    dim=dict(zip(('flip','oamIndex','numSubframes','width','height','offsetX','offsetY'),values))
                    oamoffset=oampointer-0x08000000+dim['oamIndex']*6
                    sub=[]
                    for i in range(dim['numSubframes']):
                        a,b,c=struct.unpack_from('<HHH',sonic,oamoffset+i*6)
                        sub.append({'y':a&255,'affineMode':(a>>8)&3,'objMode':(a>>10)&3,'mosaic':(a>>12)&1,'bpp':(a>>13)&1,'shape':a>>14,
                                    'x':b&511,'matrixNum':(b>>9)&31,'size':b>>14,'tileNum':c&1023,'priority':(c>>10)&3,'paletteNum':c>>12})
                    if any(o['paletteNum']!=slot for o in sub):raise ValueError('native_palette_slot_oam_mismatch')
                    original=encode_tiles(pixels(host,'graphics/sa1/obj_tiles/4bpp/a%04d_f%03d.png'%(aid,frame)))
                    offset=tilebase+tile*32;length=count*32
                    actual=sonic[offset:offset+length]
                    if len(actual)!=length:raise ValueError('native_tile_range_out_of_rom')
                    host_png_matches=(len(original)==length and actual==original)
                    if not host_png_matches:host_png_mismatches.append({'animation_id':aid,'frame_id':frame,'source_png_sha256':digest(original),'native_tiles_sha256':digest(actual)})
                    original=actual
                    owners=sorted({r['animation_id'] for r in references if tile<r['tile_index']+r['tile_count'] and r['tile_index']<tile+count})
                    if any(owner not in selected for owner in owners):
                        skipped.append({'role':role,'animation_id':aid,'frame_id':frame,'reason':'tile range referenced by unrelated animation','owners':owners});continue
                    if any(owner not in ids for owner in owners):raise ValueError('cross_family_native_tile_alias')
                    iconframe=frame%2;canvas,transform=fit_into_union(icon[iconframe*32:(iconframe+1)*32],sub,dim)
                    replacement=pack_oam(canvas,sub,length,indexmap)
                    item={'rom_offset':offset,'length':length,'tile_index':tile,'tile_count':count,
                          'original_sha256':digest(original),'replacement_sha256':digest(replacement),
                          'animation_ids':owners,'frame_ids':[frame],'animation_id':aid,'variant':variant,'frame_id':frame,
                          'role':role,'species':species,'donor_icon_frame':iconframe,'palette_id':nativepalid,'palette_slot':slot,
                          'palette_index_map':indexmap,'palette_original_rom_offset':targetpaloffset,'palette_rgb555':list(struct.unpack('<16H',targetpal)),
                          'palette_rgb555_squared_errors':[sum((v-targetcolors[indexmap[i]][k])**2 for k,v in enumerate(color)) for i,color in enumerate(donorcolors)],
                          'dimensions':dim,'dimensions_original_rom_offset':dimoffset,
                          'oam':sub,'oam_original_rom_offset':oamoffset,'transform':transform,
                          'native_tile_owners':owners,'native_commands_unchanged':True,'native_stream_rom_offset':stream['rom_offset'],'native_stream_length':stream['length'],'native_stream_sha256':stream['sha256'],'host_source_png_matches_original_rom':host_png_matches}
                    for (otheroffset,otherlength),other in ranges.items():
                        if offset<otheroffset+otherlength and otheroffset<offset+length:
                            if offset!=otheroffset or length!=otherlength or item['replacement_sha256']!=other['replacement_sha256']:
                                raise ValueError('conflicting_enemy_range_replacement')
                    ranges[offset,length]=item;result[offset:offset+length]=replacement;family['frames'].append(item)
        families.append(family)
    changed=[i for i,(before,after) in enumerate(zip(sonic,result)) if before!=after]
    spans=list(ranges.values())
    if not spans or not changed:raise ValueError('no_enemy_art_changed')
    if any(not any(r['rom_offset']<=i<r['rom_offset']+r['length'] for r in spans) for i in changed):raise ValueError('unexpected_nonart_mutation')
    candidate=out/'candidate.gba';candidate.write_bytes(result)
    report={'schema':'gameverse.sonic-pokemon-enemy-transfer/1','adapter_version':VERSION,'status':'native-consumer-qualification-pending',
            'original_sonic_sha1':SONIC_SHA1,'original_sonic_sha256':digest(sonic),'original_leaf_sha1':LEAF_SHA1,'original_leaf_sha256':digest(leaf),
            'candidate':{'path':str(candidate.resolve()),'sha256':digest(result)},'families':families,'modified_ranges':spans,
            'native_sprite_table':{'rom_offset':sprite_table_offset,'pointers':list(sprite_table),'tile_pool_rom_offset':tilebase},
            'animation_variants':all_variants,'source_dependencies_sha256':dependencies,'skipped_frames':skipped,'host_source_png_mismatches':host_png_mismatches,'host_source_variant_count_differences':variant_count_differences,
            'source_commits':{'sonic':subprocess.check_output(['git','-C',str(host),'rev-parse','HEAD'],text=True).strip(),'pokemon':subprocess.check_output(['git','-C',str(donor),'rev-parse','HEAD'],text=True).strip()},
            'coverage':{'ordinary_enemy_families':len(families),'native_animation_ids':len(selected),'native_variants':len(all_variants),'unique_modified_ranges':len(spans),'changed_bytes':len(changed),'all_native_tile_load_references_audited':len(references),'all_native_animation_ids_audited':native_animation_count},
            'preservation':'Every byte outside exclusively ordinary-enemy-owned tile spans is identical to original Sonic ROM; native code, AI, collision, hitboxes, OAM, palettes, animation commands, Sonic, levels and music unchanged.',
            'gaps':['Pokemon party-icon artwork is proportionally resized and its opaque colors adapted to unchanged native enemy palettes; exact Pokemon colors are not claimed.',
                    'Native enemy animation frames alternate the two original Pokemon icon poses; Pokemon-specific AI is not introduced.',
                    'Bosses, enemy projectiles, defeated-animal releases and effects retain Sonic artwork.',
                    'Native-render-consumer and natural-gameplay qualification remain required.',
                    'Reference Sonic source PNGs differ from installed USA original art in reported frames; active original-ROM pointer tables and command streams are authoritative.'],
            'timings':{'apply_wall_s':round(time.monotonic()-started,6),'queue_s':None,'build_s':None,'build_context':'No build: bounded original-ROM tile replacement.'}}
    (out/'enemy-transfer.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
