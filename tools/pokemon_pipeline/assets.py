"""Palette-safe source-to-source overworld family importer.

The host owns object IDs, event behavior and fixed palette slots. Donor dependencies
are namespaced; shared host palettes are never overwritten. NPC colors are adapted
in index space, while imported players have isolated exact donor palettes.
"""
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
try:
    from .runtime import definitions
except ImportError:
    from runtime import definitions

TOKEN = re.compile(r'\b[A-Za-z_]\w*\b')
PREFIX = 'GVEm_'
INFO = 'gObjectEventGraphicsInfo_'
ALIASES = {'Boy':'Boy1', 'OldMan1':'OldMan', 'OldMan2':'OldMan',
           'Fisher':'Fisherman', 'GbaKid':'GameboyKid', 'Man':'Man1'}
STATES = {'Normal':'Normal', 'Bike':'MachBike', 'BikeAlt':'MachBike',
          'Surf':'Surfing', 'FieldMove':'FieldMove', 'Fish':'Fishing'}
# Field/palette semantics belong to the host engine. Geometry and complete render
# dependencies belong to the donor. In particular never copy numeric palette tags.
HOST_FIELDS = ('tileTag', 'paletteTag', 'reflectionPaletteTag', 'paletteSlot',
               'shadowSize', 'inanimate', 'disableReflectionPaletteLoad', 'tracks')

def fields(text):
    return dict(re.findall(r'\.(\w+)\s*=\s*([^,\n]+)', text))

def rgb555_palette(path):
    lines = path.read_text().splitlines()
    if lines[:2] != ['JASC-PAL', '0100'] or int(lines[2]) != 16:
        raise ValueError('expected_16_color_palette:' + str(path))
    return [tuple(int(x) >> 3 for x in line.split()) for line in lines[3:19]]

def palette_map(donor, host):
    """Keep transparent zero separate even if another color has the same RGB."""
    return [0] + [min(range(1,16), key=lambda j: sum((v-host[j][k])**2 for k,v in enumerate(color)))
                  for color in donor[1:]]

def remap_4bpp(data, mapping):
    if len(mapping) != 16 or mapping[0] != 0 or any(not 1 <= x < 16 for x in mapping[1:]):
        raise ValueError('invalid_palette_index_map')
    return bytes(mapping[b & 15] | (mapping[b >> 4] << 4) for b in data)

def palette_bindings(root, defs):
    movement = (root/'src/event_object_movement.c').read_text()
    result = {}
    for symbol, tag in re.findall(r'\{\s*(gObjectEventPal_\w+)\s*,\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}', movement):
        definition = defs.get(symbol, '')
        match = re.search(r'"(graphics/[^\"]+)"', definition)
        if match:
            path = Path(match[1]).with_suffix('.pal')
            if (root/path).exists(): result[tag] = root/path
    return result

def mapping(hostdefs, donordefs):
    pairs = {n:n for n in hostdefs.keys() & donordefs.keys() if n.startswith(INFO)}
    for h,d in ALIASES.items():
        if INFO+h in hostdefs and INFO+d in donordefs: pairs[INFO+h] = INFO+d
    for h,d in [('Red','Brendan'), ('Green','May')]:
        for hs,ds in STATES.items():
            if INFO+h+hs in hostdefs and INFO+d+ds in donordefs: pairs[INFO+h+hs] = INFO+d+ds
    return pairs

def closure(defs, roots):
    ordered, seen = [], set()
    def visit(name):
        if name in seen: return
        seen.add(name)
        for token in TOKEN.findall(defs[name]):
            if token != name and token in defs: visit(token)
        ordered.append(name)
    for root in roots: visit(root)
    return ordered

def validate_frames(defs, info):
    """Validate every reachable frame, tile geometry and animation image index."""
    f = fields(defs[info]); frames = []
    for sym,w,h,index in re.findall(r'overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)', defs[f['images']]):
        w,h,index = int(w),int(h),int(index)
        if (w*8,h*8) != (int(f['width']),int(f['height'])):
            raise ValueError('frame_geometry_mismatch:'+info)
        frames.append((sym,w,h,index))
    if not frames: raise ValueError('unsupported_frame_table:'+info)
    animclosure = closure(defs, [f['anims']])
    for name in animclosure:
        for index in re.findall(r'ANIMCMD_FRAME\(\s*(\d+)', defs[name]):
            if int(index) >= len(frames): raise ValueError('animation_frame_out_of_range:'+info+':'+name)
    return frames

def enrich_report_metadata(work, report):
    """Derive metadata from already imported source without changing cartridge bytes."""
    work = Path(work); source = work/'source'
    header = (source/'src/data/object_events/gameverse_emerald_imports.h').read_text()
    pointers = (source/'src/data/object_events/object_event_graphics_info_pointers.h').read_text()
    for record in report['object_mappings']:
        symbol = record['animation_symbol']
        match = re.search(r'\b'+re.escape(symbol)+r'\[\]\s*=\s*\{(.*?)\n\};',header,re.S)
        if not match: raise ValueError('missing_imported_animation:'+symbol)
        record['animation_keys'] = sorted(set(re.findall(r'\[(\w+)\]\s*=',match[1])))
        record['native_object_ids'] = re.findall(r'\[(\w+)\]\s*=\s*&'+re.escape(record['host'])+r'\b',pointers)
        record['reachable_from_native_object_ids'] = bool(record['native_object_ids'])
    known = {r['path'] for r in report['imported_assets']}
    for path in sorted((source/'graphics/object_events/gameverse_emerald').glob('*.gbapal')):
        relative = str(path.relative_to(source))
        if relative not in known:
            report['imported_assets'].append({'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    report['mapped_definition_count'] = len(report['object_mappings'])
    report['mapped_native_object_count'] = sum(bool(r['native_object_ids']) for r in report['object_mappings'])
    report['unreachable_mapped_definitions'] = [r['host'] for r in report['object_mappings'] if not r['native_object_ids']]
    return report

def apply(work):
    work = Path(work); host = work/'source'; donor = work/'donor'
    recipe_path = work/'recipe.json'
    recipe = json.loads(recipe_path.read_text()) if recipe_path.exists() else {'schema':'gameverse.pokemon-overworld-recipe/1','base_game':'pokemon-leafgreen','base_revision':1,'donor_game':'pokemon-emerald','palette_policy':{'players':'exact-donor','npc':'adapt-to-host','unmatched':'preserve-native'},'mapping_policy':'same-identity-and-explicit-player-role','requested_scope':'overworld-object-sprites'}
    if recipe.get('base_game') != 'pokemon-leafgreen' or recipe.get('base_revision') != 1 or recipe.get('donor_game') != 'pokemon-emerald' or recipe.get('palette_policy') != {'players':'exact-donor','npc':'adapt-to-host','unmatched':'preserve-native'}:
        raise ValueError('unsupported_overworld_recipe')
    hdefs, ddefs = definitions(host), definitions(donor)
    hpals, dpals = palette_bindings(host,hdefs), palette_bindings(donor,ddefs)
    proposed = mapping(hdefs,ddefs); accepted, rejected = {}, []
    for h,d in sorted(proposed.items()):
        try:
            validate_frames(ddefs,d)
            hf,df = fields(hdefs[h]),fields(ddefs[d])
            player = bool(re.match(INFO+r'(Red|Green)(Normal|Bike|BikeAlt|Surf|FieldMove|Fish)$',h))
            if not player and (hf['paletteTag'] not in hpals or df['paletteTag'] not in dpals):
                raise ValueError('unresolved_palette_binding')
            # Nonplayer engine-specific geometry and animation contracts must agree.
            if not player:
                if any(hf[k] != df[k] for k in ('width','height','inanimate')):
                    raise ValueError('host_geometry_or_behavior_mismatch')
                hkeys = set(re.findall(r'\[(\w+)\]\s*=',hdefs[hf['anims']]))
                dkeys = set(re.findall(r'\[(\w+)\]\s*=',ddefs[df['anims']]))
                if hkeys - dkeys - {'ANIM_RAISE_HAND'}: raise ValueError('host_animation_action_missing')
            accepted[h] = d
        except ValueError as e: rejected.append({'host':h,'donor':d,'reason':str(e)})
    output = host/'graphics/object_events/gameverse_emerald'; output.mkdir(parents=True,exist_ok=True)
    tool = host/'tools/gbagfx/gbagfx'
    if not tool.is_file(): raise ValueError('host_gbagfx_not_built')
    alltext, records, imported = [], [], []
    # Each object gets its own dependency namespace because palette adaptation can
    # differ even when two donor objects share their source pixels.
    for ordinal,(h,d) in enumerate(sorted(accepted.items())):
        hf,df = fields(hdefs[h]),fields(ddefs[d]); player = h[len(INFO):].startswith(('Red','Green'))
        ns = PREFIX + str(ordinal) + '_'
        symbols = closure(ddefs,[d]); rename = {n:ns+n for n in symbols}
        idxmap = None if player else palette_map(rgb555_palette(dpals[df['paletteTag']]), rgb555_palette(hpals[hf['paletteTag']]))
        chunks = []
        inherited_gesture = False
        for sym in symbols:
            text = ddefs[sym]
            asset = re.search(r'INCGFX_U(16|32)\("([^\"]+)",\s*"([^\"]+)"(?:,\s*"([^\"]+)")?\)', text)
            if asset:
                srcpath = donor/asset[2]; suffix = asset[3]
                dst = output/(ns+sym+suffix)
                command = [str(tool),str(srcpath),str(dst)] + (asset[4].split() if asset[4] else [])
                subprocess.run(command,check=True,capture_output=True)
                if suffix == '.4bpp' and idxmap is not None: dst.write_bytes(remap_4bpp(dst.read_bytes(),idxmap))
                if suffix == '.4bpp':
                    for frame_sym,w,ht,i in validate_frames(ddefs,d):
                        if frame_sym == sym and (i+1)*w*ht*32 > dst.stat().st_size:
                            raise ValueError('source_image_too_short:'+sym)
                imported.append({'path':str(dst.relative_to(host)),'sha256':hashlib.sha256(dst.read_bytes()).hexdigest()})
                text = text[:asset.start()] + 'INCBIN_U'+asset[1]+'("'+str(dst.relative_to(host))+'")' + text[asset.end():]
            text = TOKEN.sub(lambda m:rename.get(m[0],m[0]), text)
            if not player and sym == df['images']:
                hostframes = re.findall(r'overworld_frame\([^\n]+', hdefs[hf['images']])
                if 'ANIM_RAISE_HAND' in hdefs[hf['anims']] and 'ANIM_RAISE_HAND' not in ddefs[df['anims']]:
                    if len(hostframes) > 9 and len(validate_frames(ddefs,d)) == 9:
                        text = text.replace('};', '    '+hostframes[9]+'\n};')
                        inherited_gesture = True
            if not player and sym == df['anims'] and 'ANIM_RAISE_HAND' in hdefs[hf['anims']] and 'ANIM_RAISE_HAND' not in ddefs[df['anims']]:
                # Native-only raised-hand pose uses the unchanged native palette.
                if len(re.findall(r'overworld_frame\(',hdefs[hf['images']])) > 9:
                    gesture = ns+'NativeRaiseHand'
                    text = 'static const union AnimCmd '+gesture+'[] = { ANIMCMD_FRAME(9, 0), ANIMCMD_END };\n' + text.replace('};', '    [ANIM_RAISE_HAND] = '+gesture+',\n};')
                else:
                    gesture = re.search(r'\[ANIM_STD_FACE_SOUTH\]\s*=\s*(\w+)',text)[1]
                    text = text.replace('};', '    [ANIM_RAISE_HAND] = '+gesture+',\n};')
            if sym == d:
                for field in HOST_FIELDS:
                    text = re.sub(r'(\.'+field+r'\s*=\s*)[^,\n]+',lambda m:m[1]+hf[field],text)
                if player:
                    sex = 'BRENDAN' if h[len(INFO):].startswith('Red') else 'MAY'
                    text = re.sub(r'(\.paletteTag\s*=\s*)[^,\n]+',lambda m:m[1]+'GV_EM_PAL_'+sex,text)
                text = text.replace(rename[d],h)
            chunks.append(text)
        # LeafGreen adds spin/shake actions absent in Emerald. Bind them to valid
        # corresponding Emerald facing/walking animations, keeping its frame ABI.
        if player and h.endswith('Normal'):
            root = rename[df['anims']]
            for i,text in enumerate(chunks):
                if re.search(r'\b'+root+r'\s*\[',text):
                    extras = []
                    for direction in ['SOUTH','NORTH','WEST','EAST']:
                        face = re.search(r'\[ANIM_STD_FACE_'+direction+r'\]\s*=\s*(\w+)',text)[1]
                        extras.append('    [ANIM_SPIN_'+direction+'] = '+face+',')
                    walk = re.search(r'\[ANIM_STD_GO_SOUTH\]\s*=\s*(\w+)',text)[1]
                    extras.append('    [ANIM_SHAKE_HEAD_OR_WALK_IN_PLACE] = '+walk+',')
                    chunks[i] = text.replace('};','\n'+'\n'.join(extras)+'\n};')
        # Keep existing object ID pointer targets: only replace its definition.
        render = chunks.pop(); assert re.search(r'\b'+h+r'\s*=',render)
        infofile = host/'src/data/object_events/object_event_graphics_info.h'
        infodata = infofile.read_text(); assert hdefs[h] in infodata
        infofile.write_text(infodata.replace(hdefs[h],render,1))
        alltext.extend(chunks)
        records.append({'host':h,'donor':d,'palette_policy':'exact-isolated-player' if player else 'adapt-to-native-shared-palette','palette_index_map':idxmap,'width':int(df['width']),'height':int(df['height']),'frame_count':len(validate_frames(ddefs,d)) + int(inherited_gesture), 'retained_native_raise_hand':inherited_gesture, 'palette_rgb555_squared_errors':None if player else [sum((v-rgb555_palette(hpals[hf['paletteTag']])[idxmap[i]][k])**2 for k,v in enumerate(color)) for i,color in enumerate(rgb555_palette(dpals[df['paletteTag']]))], 'collapsed_opaque_colors':0 if player else 15-len(set(idxmap[1:])), 'images_symbol':rename[df['images']], 'palette_tag':('GV_EM_PAL_BRENDAN' if h[len(INFO):].startswith('Red') else 'GV_EM_PAL_MAY') if player else hf['paletteTag'], 'palette_slot':hf['paletteSlot'], 'palette_symbol':('GVEm_Palette_Brendan' if h[len(INFO):].startswith('Red') else 'GVEm_Palette_May') if player else None, 'reflection_palette_symbol':('GVEm_Palette_Brendan_REFLECTION' if h[len(INFO):].startswith('Red') else 'GVEm_Palette_May_REFLECTION') if player else None, 'animation_keys':sorted(set(re.findall(r'\[(\w+)\]\s*=',ddefs[df['anims']])) | ({'ANIM_SPIN_SOUTH','ANIM_SPIN_NORTH','ANIM_SPIN_WEST','ANIM_SPIN_EAST','ANIM_SHAKE_HEAD_OR_WALK_IN_PLACE'} if player and h.endswith('Normal') else set()) | ({'ANIM_RAISE_HAND'} if not player and 'ANIM_RAISE_HAND' in hdefs[hf['anims']] else set())), 'animation_symbol':rename[df['anims']], 'dependencies':list(rename.values())})
    # Include dependency definitions before any object info and before StepAnimTable
    # so the engine's pointer-based alternating-step dispatch recognizes imports.
    header = host/'src/data/object_events/gameverse_emerald_imports.h'
    header.write_text('/* Generated source dependencies; see sprite-coverage.json. */\n'+'\n\n'.join(alltext)+'\n')
    movementpath = host/'src/event_object_movement.c'; movement = movementpath.read_text()
    movement = movement.replace('#include "data/object_events/object_event_anims.h"','#include "data/object_events/gameverse_emerald_imports.h"\n#include "data/object_events/object_event_anims.h"')
    palette_entries=[]; playerpairs=[]
    for n,sex in enumerate(['Brendan','May']):
        tag='GV_EM_PAL_'+sex.upper(); reflection=tag+'_REFLECTION'
        movement = movement.replace('#include "data/object_events/object_event_graphics_info_pointers.h"', '#define '+tag+' '+hex(0x1200+n*2)+'\n#define '+reflection+' '+hex(0x1201+n*2)+'\n#include "data/object_events/object_event_graphics_info_pointers.h"')
        for kind,symbol in [('', 'gObjectEventPal_'+sex),('_REFLECTION','gObjectEventPal_'+sex+'Reflection')]:
            path = dpals['OBJ_EVENT_PAL_TAG_'+sex.upper()+kind]
            dst = output/(sex+kind+'.gbapal'); subprocess.run([str(tool),str(path),str(dst)],check=True,capture_output=True)
            imported.append({'path':str(dst.relative_to(host)),'sha256':hashlib.sha256(dst.read_bytes()).hexdigest()})
            var='GVEm_Palette_'+sex+kind
            # Graphics declarations precede movement palette registration.
            with (host/'src/data/object_events/object_event_graphics.h').open('a') as stream:stream.write('\nconst u16 '+var+'[] = INCBIN_U16("'+str(dst.relative_to(host))+'");\n')
            palette_entries.append('    {'+var+', '+tag+kind+'},')
        array='GVEm_'+sex+'ReflectionTags'
        playerpairs.append('    {'+tag+', '+array+'},')
        movement=movement.replace('static const struct PairedPalettes gPlayerReflectionPaletteSets[] = {','static const u16 '+array+'[] = {'+(', '.join([reflection]*4))+'};\nstatic const struct PairedPalettes gPlayerReflectionPaletteSets[] = {')
    movement=movement.replace('static const struct SpritePalette sObjectEventSpritePalettes[] = {','static const struct SpritePalette sObjectEventSpritePalettes[] = {\n'+'\n'.join(palette_entries))
    for name in ['gPlayerReflectionPaletteSets','gSpecialObjectReflectionPaletteSets']:
        movement=movement.replace('static const struct PairedPalettes '+name+'[] = {','static const struct PairedPalettes '+name+'[] = {\n'+'\n'.join(playerpairs))
    movementpath.write_text(movement)
    animpath=host/'src/data/object_events/object_event_anims.h'; animtext=animpath.read_text()
    extra=['    { .anims = '+r['animation_symbol']+', .animPos = {1, 3, 0, 2} },' for r in records]
    animtext=animtext.replace('static const struct StepAnimTable sStepAnimTables[] = {','static const struct StepAnimTable sStepAnimTables[] = {\n'+'\n'.join(extra))
    animpath.write_text(animtext)
    report={'schema':'gameverse.pokemon-sprite-coverage/1','recipe':recipe,'source_commit':'037335f4c725d7c9aecdac87066f2002b4bd7e14','donor_commit':'731ad5bfd6e6f265508d0efcca0ba42f9dcf5881','status':'source-imported-native-qualification-pending','object_mappings':records,'rejected_mappings':rejected,'unmatched_host_objects':sorted(n for n in hdefs if n.startswith(INFO) and n not in accepted),'imported_assets':imported,'gaps':['NPC colors adapted to existing LeafGreen shared palette; not exact Emerald colors.','LeafGreen-only identities and VS Seeker poses retain native sprites/palettes.','Spin/shake actions use safe Emerald facing/walking approximations; NPC raised-hand pose retains native art when available, otherwise faces south.','Native engine visual qualification remains required.'],'palette_safety':'Native shared palettes and original player palette bindings unchanged.'}
    enrich_report_metadata(work,report)
    (work/'sprite-coverage.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
