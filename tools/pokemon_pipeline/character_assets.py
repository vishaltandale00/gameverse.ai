"""Original-ROM-proven Sonic Advance art bound to native LeafGreen player roles.

Only presentation changes: host object IDs, movement and collisions remain native.
The donor is side-view; north/south and special-action artwork are explicit aliases.
"""
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
try:
    from .runtime import definitions
    from .assets import fields
except ImportError:
    from runtime import definitions
    from assets import fields

ROM_SHA1 = 'd842afa7dd1e84de08addb94a51506f1bcafd551'
INFO = 'gObjectEventGraphicsInfo_'
SHAPES = (((8,8),(16,16),(32,32),(64,64)),
          ((16,8),(32,8),(32,16),(64,32)),
          ((8,16),(8,32),(16,32),(32,64)))

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def tile_pixels(data, width, height):
    if len(data) != width * height // 2:
        raise ValueError('tile_geometry_mismatch')
    pixels = [[0] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            index = ((y//8)*(width//8)+x//8)*32+(y%8)*4+x%8//2
            pixels[y][x] = (data[index] >> (4*(x%2))) & 15
    return pixels

def encode_tiles(pixels):
    height, width = len(pixels), len(pixels[0])
    if width % 8 or height % 8:
        raise ValueError('unaligned_tile_geometry')
    result = bytearray(width*height//2)
    for y,row in enumerate(pixels):
        for x,value in enumerate(row):
            index=((y//8)*(width//8)+x//8)*32+(y%8)*4+x%8//2
            result[index] |= value << (4*(x%2))
    return bytes(result)

def fit_frame(pixels):
    opaque=[(x,y) for y,row in enumerate(pixels) for x,value in enumerate(row) if value]
    if not opaque:
        raise ValueError('empty_donor_frame')
    x0,y0=min(x for x,y in opaque),min(y for x,y in opaque)
    x1,y1=max(x for x,y in opaque)+1,max(y for x,y in opaque)+1
    width,height=x1-x0,y1-y0
    scale=min(1,32/width,32/height)
    w,h=max(1,int(width*scale)),max(1,int(height*scale))
    canvas=[[0]*32 for _ in range(32)]
    for y in range(h):
        for x in range(w):
            canvas[32-h+y][(32-w)//2+x]=pixels[y0+y*height//h][x0+x*width//w]
    return encode_tiles(canvas), {'opaque_bounds':[x0,y0,x1,y1], 'output_opaque_size':[w,h],
                                  'transform':'transparent-trim, nearest-neighbor fit, bottom-center',
                                  'resampled':(width,height)!=(w,h)}

def parse_objects(text):
    return [{k:int(v,0) for k,v in re.findall(r'\.(\w+)\s*=\s*(0x[0-9A-Fa-f]+|-?\d+)',part)}
            for part in re.findall(r'\{([^{}]+)\}',text,re.S)]

def source_frames(donor, rom, tool, output):
    """Decode original tile payloads using original OAM; prove every payload in ROM."""
    dependencies={}
    def read(relative):
        path=donor/relative; dependencies[relative]=sha(path);return path.read_text()
    animations=read('src/data/sa1/animations/animations.c')
    dimensions=read('src/data/sa1/sprite_dimensions.c')
    oamtext=read('src/data/sa1/oam_data.c')
    read('include/constants/sa1/animations.h')
    read('graphics/sa1/obj_tiles_4bpp.inc')
    oams=parse_objects(oamtext[:oamtext.index('const OamDataShort *const gSpriteOamData')])
    # Prove the contiguous original Sonic OAM range, rather than isolated attributes.
    oam_bytes=b''.join(struct.pack('<HHH', q['y']|q['affineMode']<<8|q['objMode']<<10|q['mosaic']<<12|q['bpp']<<13|q['shape']<<14, q['x']|q['matrixNum']<<9|q['size']<<14, q['tileNum']|q['priority']<<10|q['paletteNum']<<12) for q in oams[:118])
    original_oam_base=rom.find(oam_bytes)
    if original_oam_base<0:raise ValueError('original_sonic_oam_range_proof_failed')
    records=[]; encoded=[]; base=None
    # Idle plus complete walking/running cycles, all Sonic's original animation IDs.
    for animation,selected in [(0,[0]),(4,list(range(8))),(5,list(range(4)))]:
        block=re.search(r'const s32 anim_%04d__v0_l0\[\]\s*=\s*\{(.*?)\n\};'%animation,animations,re.S)[1]
        commands=re.findall(r'TILES\(\s*(0x[0-9A-Fa-f]+|\d+),\s*(\d+)\).*?SHOW_FRAME\(\s*(\d+),\s*(\d+)\)',block,re.S)
        tiles={int(f):(int(t,0),int(c),int(d)) for t,c,d,f in reversed(commands)}
        dimname=re.search(r'/\*\s*%03d\s*\*/\s*(\w+)'%animation,dimensions)[1]
        dimblock=re.search(r'const SpriteOffset '+dimname+r'\[\d+\]\s*=\s*\{(.*?)\n\};',dimensions,re.S)[1]
        dims=parse_objects(dimblock)
        oambase=int(re.search(r'/\*\s*%d\s*\*/\s*&spriteOamData_Data\[(\d+)\]'%animation,oamtext)[1])
        for frame in selected:
            relative='graphics/sa1/obj_tiles/4bpp/a%04d_f%03d.png'%(animation,frame)
            dependencies[relative]=sha(donor/relative)
            rawpath=output/('original-a%04d-f%03d.4bpp'%(animation,frame))
            subprocess.run([str(tool),str(donor/relative),str(rawpath)],check=True,capture_output=True)
            data=rawpath.read_bytes(); offset=rom.find(data)
            tileindex,count,duration=tiles[frame]
            if offset<0 or len(data)!=count*32:
                raise ValueError('original_rom_tile_proof_failed:'+relative)
            if base is None:base=offset-tileindex*32
            if rom[base+tileindex*32:base+(tileindex+count)*32] != data:
                raise ValueError('original_animation_tile_offset_mismatch:'+relative)
            dim=dims[frame]
            if dim['flip']:
                raise ValueError('unsupported_donor_frame_flip')
            # Validate the 12-byte source dimension record against its original ROM address.
            dimraw=struct.pack('<BBHHHhh',*(dim[k] for k in ['flip','oamIndex','numSubframes','width','height','offsetX','offsetY']))
            dimblockraw=b''.join(struct.pack('<BBHHHhh',*(d[k] for k in ['flip','oamIndex','numSubframes','width','height','offsetX','offsetY'])) for d in dims)
            dimaddr=rom.find(dimblockraw)
            if dimaddr<0:raise ValueError('original_dimension_proof_failed')
            canvas=[[0]*dim['width'] for _ in range(dim['height'])]
            used=[]
            for i in range(dim['numSubframes']):
                oi=oambase+dim['oamIndex']+i; oam=oams[oi]
                attr0=oam['y']|(oam['affineMode']<<8)|(oam['objMode']<<10)|(oam['mosaic']<<12)|(oam['bpp']<<13)|(oam['shape']<<14)
                attr1=oam['x']|(oam['matrixNum']<<9)|(oam['size']<<14)
                attr2=oam['tileNum']|(oam['priority']<<10)|(oam['paletteNum']<<12)
                if rom[original_oam_base+oi*6:original_oam_base+oi*6+6]!=struct.pack('<HHH',attr0,attr1,attr2):
                    raise ValueError('original_oam_proof_failed')
                if oam['affineMode'] not in (0,1) or oam['bpp'] or oam['paletteNum'] or oam['matrixNum']:
                    raise ValueError('unsupported_donor_oam')
                w,h=SHAPES[oam['shape']][oam['size']]
                sub=tile_pixels(data[oam['tileNum']*32:oam['tileNum']*32+w*h//2],w,h)
                for y in range(h):
                    for x in range(w):
                        xx,yy=oam['x']+x,oam['y']+y
                        if 0<=xx<dim['width'] and 0<=yy<dim['height'] and sub[y][x]:canvas[yy][xx]=sub[y][x]
                used.append(oam)
            result,transform=fit_frame(canvas); encoded.append(result)
            records.append({'animation_id':animation,'frame_id':frame,'source_path':relative,
                'source_sha256':dependencies[relative],'original_tiles_sha256':sha(rawpath),
                'original_rom_offset':base+tileindex*32,'tile_index':tileindex,'tile_count':count,
                'source_duration':duration,'dimensions':dim,'dimensions_original_rom_offset':dimaddr+frame*12,'oam_original_rom_base':original_oam_base,'oam':used,'transform':transform,
                'output_frame_index':len(encoded)-1,'output_frame_sha256':hashlib.sha256(result).hexdigest()})
    pal='graphics/sa1/obj_palettes/pal_000.pal'; dependencies[pal]=sha(donor/pal)
    palette=output/'sonic.gbapal'
    subprocess.run([str(tool),str(donor/pal),str(palette)],check=True,capture_output=True)
    if len(palette.read_bytes())!=32 or rom.find(palette.read_bytes())<0:
        raise ValueError('original_palette_proof_failed')
    return encoded,records,dependencies,palette


def apply(work, donor_root=None, donor_rom=None):
    work=Path(work); host=work/'source'; donor=Path(donor_root) if donor_root else work/'donor'
    if (host/'src/data/object_events/gameverse_sonic_imports.h').exists():
        raise ValueError('sonic_import_requires_pristine_host_source')
    original=Path(donor_rom) if donor_rom else work/'donor-original.gba'; rom=original.read_bytes()
    if hashlib.sha1(rom).hexdigest()!=ROM_SHA1 or rom[0xac:0xb0]!=b'ASOE':
        raise ValueError('sonic_advance_original_identity_mismatch')
    output=host/'graphics/object_events/gameverse_sonic';output.mkdir(parents=True,exist_ok=True)
    encoded,frames,dependencies,palette=source_frames(donor,rom,host/'tools/gbagfx/gbagfx',output)
    sheet=output/'sonic.4bpp'; sheet.write_bytes(b''.join(encoded))
    defs=definitions(host); infofile=host/'src/data/object_events/object_event_graphics_info.h'; infodata=infofile.read_text()
    chunks=['/* Original Sonic Advance art; explicit side-view aliases. See sprite-coverage.json. */',
            'const u32 GVSonic_Tiles[] = INCBIN_U32("'+str(sheet.relative_to(host))+'");',
            'static const struct SpriteFrameImage GVSonic_Images[] = {\n'+''.join('    overworld_frame(GVSonic_Tiles, 4, 4, %d),\n'%i for i in range(len(frames)))+'};']
    records=[]
    for name in sorted(defs):
        role=re.fullmatch(INFO+r'(Red|Green)(Normal|Bike|BikeAlt|Surf|FieldMove|Fish|VSSeeker|VSSeekerBike)',name)
        if not role:continue
        fields_host=fields(defs[name]);ns='GVSonic_'+role[1]+role[2]
        table=defs[fields_host['anims']]
        entries=re.findall(r'(?:\[(\w+)\]\s*=\s*)?(s\w+)\s*,',table)
        if not entries:raise ValueError('unsupported_host_animation_table:'+name)
        animation_defs=[]; table_entries=[];bindings=[]
        for ordinal,(key,target) in enumerate(entries):
            label=key or str(ordinal); source=defs[target]
            moving=any(t in label for t in ('GO_','RUN','WALK','SPIN','SHAKE')) or ('Bike' in role[2])
            cycle=list(range(9,13)) if ('FAST' in label or 'RUN' in label or 'Bike' in role[2]) else list(range(1,9))
            if not moving:cycle=[0]
            count=[0]; flipped='EAST' in label
            def frame_replace(match):
                index=cycle[count[0]%len(cycle)];count[0]+=1
                return 'ANIMCMD_FRAME(%d, %s%s)'%(index,match[2],', .hFlip = TRUE' if flipped else '')
            source=re.sub(r'ANIMCMD_FRAME\(\s*(\d+)\s*,\s*(\d+)(?:\s*,[^)]*)?\)',frame_replace,source)
            symbol=ns+'_Anim'+str(ordinal)
            source=re.sub(r'\b'+re.escape(target)+r'\b',symbol,source)
            animation_defs.append(source)
            table_entries.append('    '+('['+key+'] = ' if key else '')+symbol+',')
            bindings.append({'host_animation':label,'host_source_symbol':target,'source_cycle':cycle,
                             'mirror_horizontal':flipped,'side_view_alias':not any(t in label for t in ('WEST','EAST')),
                             'native_command_timing_and_control_flow_retained':True})
        chunks.extend(animation_defs); chunks.append('static const union AnimCmd *const '+ns+'_Anims[] = {\n'+'\n'.join(table_entries)+'\n};')
        render=defs[name]
        changes={'paletteTag':'GV_SONIC_PAL','size':'512','width':'32','height':'32',
                 'oam':'&gObjectEventBaseOam_32x32','subspriteTables':'gObjectEventSpriteOamTables_32x32',
                 'anims':ns+'_Anims','images':'GVSonic_Images'}
        for field,value in changes.items():render=re.sub(r'(\.'+field+r'\s*=\s*)[^,\n]+',lambda m:m[1]+value,render)
        infodata=infodata.replace(defs[name],render,1)
        records.append({'host':name,'donor':'SA1_SONIC','width':32,'height':32,'frame_count':len(frames),
            'palette_policy':'exact-isolated-player','palette_tag':'GV_SONIC_PAL','palette_slot':fields_host['paletteSlot'],
            'palette_symbol':'GVSonic_Palette','reflection_palette_symbol':'GVSonic_Palette',
            'images_symbol':'GVSonic_Images','animation_symbol':ns+'_Anims','animation_keys':[key or str(i) for i,(key,_) in enumerate(entries)],
            'animation_bindings':bindings,'dependencies':['GVSonic_Tiles','GVSonic_Palette','GVSonic_Images',ns+'_Anims']+[ns+'_Anim'+str(i) for i in range(len(entries))],
            'native_object_ids':[]})
    if not records:raise ValueError('no_host_player_roles')
    with (host/'src/data/object_events/object_event_graphics.h').open('a') as stream:
        stream.write('\nconst u16 GVSonic_Palette[] = INCBIN_U16("'+str(palette.relative_to(host))+'");\n')
    header=host/'src/data/object_events/gameverse_sonic_imports.h'; header.write_text('\n\n'.join(chunks)+'\n')
    infofile.write_text(infodata)
    movementfile=host/'src/event_object_movement.c'; movement=movementfile.read_text()
    movement=movement.replace('#include "data/object_events/object_event_graphics_info_pointers.h"','#define GV_SONIC_PAL 0x1220\n#define GV_SONIC_REFLECTION_PAL 0x1221\n#include "data/object_events/object_event_graphics_info_pointers.h"')
    # StepAnimTable references imported tables; include them before its definition.
    movement=movement.replace('#include "data/object_events/object_event_anims.h"','#include "data/object_events/gameverse_sonic_imports.h"\n#include "data/object_events/object_event_anims.h"')
    movement=movement.replace('static const struct SpritePalette sObjectEventSpritePalettes[] = {','static const struct SpritePalette sObjectEventSpritePalettes[] = {\n    {GVSonic_Palette, GV_SONIC_PAL},\n    {GVSonic_Palette, GV_SONIC_REFLECTION_PAL},')
    for array in ['gPlayerReflectionPaletteSets','gSpecialObjectReflectionPaletteSets']:
        marker='static const struct PairedPalettes '+array+'[] = {'
        movement=movement.replace(marker,marker+'\n    {GV_SONIC_PAL, GVSonic_ReflectionTags},')
    marker='static const struct PairedPalettes gPlayerReflectionPaletteSets[] = {'
    movement=movement.replace(marker,'static const u16 GVSonic_ReflectionTags[] = {GV_SONIC_REFLECTION_PAL, GV_SONIC_REFLECTION_PAL, GV_SONIC_REFLECTION_PAL, GV_SONIC_REFLECTION_PAL};\n'+marker)
    movementfile.write_text(movement)
    # Host step alternation recognizes animation pointer tables by identity.
    animfile=host/'src/data/object_events/object_event_anims.h'; animtext=animfile.read_text()
    animtext=animtext.replace('static const struct StepAnimTable sStepAnimTables[] = {','static const struct StepAnimTable sStepAnimTables[] = {\n'+''.join('    { .anims = '+r['animation_symbol']+', .animPos = {1, 3, 0, 2} },\n' for r in records))
    animfile.write_text(animtext)
    pointers=(host/'src/data/object_events/object_event_graphics_info_pointers.h').read_text()
    for record in records:
        record['native_object_ids']=re.findall(r'\[(\w+)\]\s*=\s*&'+record['host']+r'\b',pointers)
        record['reachable_from_native_object_ids']=bool(record['native_object_ids'])
    baseline=json.loads((work/'baseline.json').read_text())
    receipt={'schema':'gameverse.character-source-transfer/1','donor_game':'sonic-advance','character':'sonic',
             'original_rom_sha1':ROM_SHA1,'original_rom_sha256':sha(original),'source_proof':'Contiguous original Sonic OAM range, complete dimension arrays, common animation tile-pool base, exact original palette','source_commit':baseline['donor']['source_commit'],
             'source_dependencies_sha256':dependencies,'source_frames':frames,'palette_original_rom_offset':rom.find(palette.read_bytes()),
             'frame_policy':'Original indexed pixels, transparent trim and nearest-neighbor fit into 32x32; no authored character art.',
             'mapping_policy':'Native LeafGreen animation keys/control flow, explicitly authored side-view Sonic pose bindings.'}
    (work/'character-transfer.json').write_text(json.dumps(receipt,indent=2)+'\n')
    report={'schema':'gameverse.pokemon-sprite-coverage/1','status':'source-imported-native-qualification-pending',
            'source_commit':baseline['base']['source_commit'],'donor_commit':baseline['donor']['source_commit'],
            'object_mappings':records,'mapped_definition_count':len(records),
            'mapped_native_object_count':sum(bool(r['native_object_ids']) for r in records),
            'unreachable_mapped_definitions':[r['host'] for r in records if not r['native_object_ids']],
            'unmatched_host_objects':sorted(n for n in defs if n.startswith(INFO) and n not in {r['host'] for r in records}),
            'imported_assets':[{'path':str(p.relative_to(host)),'sha256':sha(p)} for p in sorted(output.iterdir())],
            'source_transfer_receipt_sha256':sha(work/'character-transfer.json'),'source_frames':frames,
            'gaps':['Original side-view Sonic frames alias north/south; no original top-down Sonic art is claimed. Donor slope/rotation affine transforms are not imported.',
                    'Bike, surf, fishing, field-move and VS Seeker actions use Sonic idle/run pose aliases with native timing and gameplay; no Sonic vehicle/tool art is claimed.',
                    'Trainer battle portraits, intro/name-selection artwork and title screen retain original Pokemon art.',
                    'Natural field navigation/playability qualification remains required.'],
            'palette_safety':'Exact original Sonic palette isolated under new normal/reflection tags; native shared palettes unchanged.',
            'request_satisfied':False}
    (work/'sprite-coverage.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
