"""Batch semantic asset identification; private captured bytes are never IR credit."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import struct
import time
from pathlib import Path
from .elf_provider import load_segments
from .reassemble import assemble
from tools.whole_game.elf_symbols import symbols


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pinned(ref):
    path = Path(ref['path']).resolve()
    data = path.read_bytes()
    if sha(data) != ref['sha256']:
        raise ValueError('stale input pin: '+str(path))
    return data


def body(text, name):
    match = re.search(r'\b'+re.escape(name)+r'\s*\([^;{}]*\)\s*\{', text)
    if not match:
        raise ValueError('missing consumer function '+name)
    depth, cursor = 1, match.end()
    for end in range(cursor, len(text)):
        depth += (text[end] == '{') - (text[end] == '}')
        if depth == 0:
            return text[cursor:end]
    raise ValueError('unclosed consumer function')


def validate_icon_consumer(text, contract):
    """One supported semantic path: indexed u8 pointer -> icon image -> OBJ copy."""
    text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
    names = ('table', 'selector', 'selector_result', 'creator', 'frame_updater', 'sprite_creator')
    if any(not re.fullmatch(r'[A-Za-z_]\w*', contract.get(k, '')) for k in names):
        raise ValueError('explicit consumer identifiers required')
    if contract.get('kind') != 'indexed-4bpp-icon-sprite/1':
        raise ValueError('unsupported consumer category')
    table = re.escape(contract['table'])
    declaration = re.search(r'const\s+u8\s*\*\s*const\s+'+table+r'\s*\[\s*\]\s*=\s*\{(.*?)\};', text, re.S)
    selected = body(text, contract['selector'])
    result = re.escape(contract['selector_result'])
    if (not declaration or not re.search(r'const\s+u8\s*\*\s*'+result+r'\s*=\s*'+table+r'\[\w+\]', selected)
            or not re.search(r'return\s+'+result+r'\s*;', selected)):
        raise ValueError('unproven typed table selection')
    creator = body(text, contract['creator'])
    if not re.search(r'iconTemplate\.image\s*=\s*'+re.escape(contract['selector'])+r'\(', creator):
        raise ValueError('selector does not populate sprite image')
    if not re.search(re.escape(contract['sprite_creator'])+r'\(\s*&iconTemplate\s*,', creator):
        raise ValueError('image does not reach sprite creator')
    sprite = body(text, contract['sprite_creator'])
    if not re.search(r'gSprites\[\w+\]\.images\s*=\s*\(const struct SpriteFrameImage\s*\*\)\s*iconTemplate->image', sprite):
        raise ValueError('image transfer missing')
    update = body(text, contract['frame_updater'])
    if not re.search(r'RequestSpriteCopy\(\s*\(u8\s*\*\)sprite->images\s*\+', update) or 'OBJ_VRAM0' not in update or 'TILE_SIZE_4BPP' not in update:
        raise ValueError('no typed OBJ 4bpp copy sink')
    if '.bpp = ST_OAM_4BPP' not in text or 'SPRITE_SIZE(32x32)' not in text:
        raise ValueError('4bpp sprite dimensions missing')
    return set(re.findall(r'\[\w+\]\s*=\s*(\w+)\s*,', declaration[1]))


def elf_bytes(elf, segments, address, size):
    for segment in segments:
        start = address-segment['virtual']
        if 0 <= start and start+size <= segment['size']:
            return elf[segment['file_offset']+start:segment['file_offset']+start+size]
    raise ValueError('symbol not contained in file-backed ELF segment')


def identify_icons(profile):
    root = Path(profile['source_root']).resolve()
    build = json.loads(pinned(profile['build_receipt']))
    if (build.get('baselineMatches') is not True
            or build['artifacts']['rom']['sha256'] != profile['original_sha256']
            or build['artifacts']['elf']['sha256'] != profile['elf']['sha256']):
        raise ValueError('source build/version evidence does not match profile')
    consumer = pinned(profile['consumer']).decode()
    members = validate_icon_consumer(consumer, profile['contract'])
    declarations = pinned(profile['declarations']).decode()
    elf = pinned(profile['elf']); pinned(profile['map'])
    index = symbols(Path(profile['elf']['path']), detailed=True)
    segments = load_segments(elf)
    def unique(name):
        rows = index.get(name, [])
        if len(rows) != 1 or rows[0]['type'] != 1 or rows[0]['sectionFlags'] & 5 or not rows[0]['sectionFlags'] & 2:
            raise ValueError('not a unique readonly data symbol '+name)
        return rows[0]
    table = unique(profile['contract']['table'])
    table_data = elf_bytes(elf, segments, table['address'], table['size'])
    if len(table_data) % 4:
        raise ValueError('unaligned pointer table')
    pointers = set(struct.unpack('<'+'I'*(len(table_data)//4), table_data))
    pattern = r'const\s+u8\s+(\w+)\[\]\s*=\s*(INCBIN_U8|INCGFX_U8)\("([^"\n]+)"(?:,\s*"([^"\n]+)")?\);'
    assets = []
    for match in re.finditer(pattern, declarations):
        name, macro, filename, extension = match.groups()
        if name not in members:
            continue
        row = unique(name)
        if row['address'] not in pointers:
            raise ValueError('source table member absent from linked pointer lanes')
        data = elf_bytes(elf, segments, row['address'], row['size'])
        if len(data) not in (1024, 2048) or row['address'] % 4:
            raise ValueError('unsupported 32x32 icon frame extent')
        source = (root/filename).resolve()
        if not source.is_relative_to(root):
            raise ValueError('source asset path escape')
        raw = source.read_bytes()
        if macro == 'INCBIN_U8':
            if raw != data:
                continue  # Inactive conditional source variant; never counted as an asset.
        else:
            if extension != '.4bpp' or raw[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('not declared indexed graphics conversion')
            width, height, depth, color = struct.unpack('>IIBB', raw[16:26])
            if width != 32 or height not in (64,128) or depth not in (4,8) or color != 3 or width*height//2 != len(data):
                raise ValueError('indexed PNG/frame dimensions disagree')
        if any(a['id'] == name for a in assets):
            continue
        assets.append({'id':name, 'offset':row['address']-0x08000000, 'size':len(data), 'sha256':sha(data),
                       'category':'graphics-4bpp-icon', 'source':{'path':str(source),'sha256':sha(raw)},
                       'dependency':{'table':profile['contract']['table'],'table_sha256':sha(table_data)}, '_data':data})
    if not assets:
        raise ValueError('no semantically supported assets')
    assets.sort(key=lambda a:a['offset'])
    for first, second in zip(assets,assets[1:]):
        if first['offset']+first['size'] > second['offset']:
            raise ValueError('asset overlap/alias requires explicit resolution')
    return assets


def separate(profile_path, packet_dir, output_dir):
    """Use only admitted packet artifacts for reconstruction; source serves typing."""
    started = time.perf_counter()
    profile_path, packet, output = Path(profile_path), Path(packet_dir).resolve(), Path(output_dir).resolve()
    profile = json.loads(profile_path.read_text())
    assets = identify_icons(profile)
    original_manifest = packet/'manifest.json'
    raw, _ = assemble(original_manifest)
    manifest = json.loads(original_manifest.read_text())
    if sha(raw) != profile['original_sha256'] or sha(raw) != manifest['original']['sha256']:
        raise ValueError('packet/source version mismatch')
    for asset in assets:
        if raw[asset['offset']:asset['offset']+asset['size']] != asset['_data']:
            raise ValueError('typed asset differs from exact cartridge span')
    output.mkdir(parents=True, exist_ok=False)
    (output/'assets').mkdir(); (output/'mixed').mkdir()
    pieces, cursor = [], 0
    def piece(start,end,asset=None):
        data = raw[start:end]; ident = asset['id'] if asset else f'mixed-{start:08x}'
        path = ('assets/' if asset else 'mixed/')+ident+'.bin'
        (output/path).write_bytes(data)
        pieces.append({'id':ident,'version':'sha256:'+sha(data),'offset':start,'size':len(data),'sha256':sha(data),
            'artifact':{'path':path,'sha256':sha(data)},'provider':{'kind':'opaque_bytes'},'relocations':[],
            'stratum':'raw-captured','dependencies':[], 'closure':{'status':'unknown'},'contract':{},
            'content_type':'asset_data' if asset else 'mixed_unknown', 'evidence':[]})
    for asset in assets:
        if cursor < asset['offset']: piece(cursor,asset['offset'])
        piece(asset['offset'],asset['offset']+asset['size'],asset); cursor=asset['offset']+asset['size']
    if cursor<len(raw):piece(cursor,len(raw))
    derived = {**manifest,'original':{**manifest['original'],'path':'unavailable-original.gba'},'components':pieces,'prefabs':[]}
    (output/'manifest.json').write_text(json.dumps(derived,indent=2)+'\n')
    rebuilt, layout = assemble(output/'manifest.json')
    if rebuilt != raw:raise ValueError('separated replay changed output')
    (output/'rebuilt.gba').write_bytes(rebuilt)
    for asset in assets: asset.pop('_data')
    receipt={'schema':'gameverse.semantic-asset-batch/1','status':'passed','profile':{'path':str(profile_path.resolve()),'sha256':sha(profile_path.read_bytes())},
       'validator':{'path':str(Path(__file__).resolve()),'sha256':sha(Path(__file__).read_bytes())},
       'classification_inputs':profile, 'historical_prefab_claims_inherited':False,
       'assets':assets,'asset_count':len(assets),'asset_bytes':sum(a['size'] for a in assets),
       'mixed_unknown_bytes':len(raw)-sum(a['size'] for a in assets),'artifact_sha256':sha(rebuilt),'size':len(rebuilt),
       'consumed_separate_assets':True,'capability':'rebuild_only','regenerated_ir_bytes':0,
       'semantic_consumer_reexecuted':False,'original_rom_read':False,'source_used_for_classification':True,
       'whole_game_semantic_closure':False,'wall_s':round(time.perf_counter()-started,6),'queue_s':None}
    (output/'asset-pack.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',required=True);parser.add_argument('--packet',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args(); result=separate(args.profile,args.packet,args.output)
    print(json.dumps({k:v for k,v in result.items() if k!='assets'},indent=2))
