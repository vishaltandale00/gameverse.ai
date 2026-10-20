"""Independent byte checks for a captured FireRed palette expansion, no source reads."""
from __future__ import annotations
import argparse
import json
import struct
import time
from pathlib import Path
from unittest.mock import patch
from .memory_ontology import canonical, compile_edit, sha


def verify(directory):
    started = time.perf_counter(); root = Path(directory)
    manifest = json.loads((root/'manifest.json').read_text())
    original = (root/'identity/candidate.gba').read_bytes()
    expanded = (root/'expanded/candidate.gba').read_bytes()
    followup = (root/'followup/candidate.gba').read_bytes()
    output_manifest = json.loads((root/'expanded/manifest.json').read_text())
    assert sha(original) == manifest['rom']['sha256']
    assert len(expanded) == len(original)+192
    assert sha(expanded) == output_manifest['rom']['sha256']
    palette = next(t for t in manifest['tables'] if t['id']=='gMonIconPalettes')
    index = next(t for t in manifest['tables'] if t['id']=='gMonIconPaletteIndices')
    assert len(next(t for t in output_manifest['tables'] if t['id']=='gMonIconPalettes')['rows']) == 6
    old_base = palette['rom_offset']; new_base = len(original)
    assert expanded[old_base:old_base+96] == original[old_base:old_base+96]
    assert expanded[new_base:new_base+96] == original[old_base:old_base+96]
    expected = bytearray(original)
    for binding in palette['bindings']:
        at = binding['rom_offset']
        struct.pack_into('<I', expected, at, 0x08000000+new_base+binding['target_addend'])
    expected[index['rom_offset']+1] = 3
    assert expanded[:len(original)] == expected, 'unexpected original-image delta'
    for at in [0x138, 0x97064]:
        assert expanded[at:at+4] == original[at:at+4]
    for at, raw in palette['expansion']['closure_evidence']['instruction_witnesses'].items():
        at = int(at)
        assert expanded[at:at+2].hex() == raw
    assert all(value < 32768 for value in struct.unpack_from('<96H', expanded, new_base))
    changed_followup = [i for i,(a,b) in enumerate(zip(expanded, followup)) if a != b]
    assert changed_followup == [new_base+3*32+2*2]
    request = json.loads((root/'followup-request.json').read_text())
    # Explicit deny proves repeat compiler work cannot touch the pristine source or original ROM.
    def forbidden(*args, **kwargs):
        raise AssertionError('compiler attempted filesystem access')
    with patch.object(Path, 'read_bytes', forbidden), patch.object(Path, 'read_text', forbidden):
        repeated = compile_edit(output_manifest, expanded, request)
    assert repeated['rom'] == followup
    negative = []
    for name, operations in [
        ('palette-index-before-backing', [{'op':'set','table':'gMonIconPaletteIndices','index':1,'field':'palette','value':3}]),
        ('palette-over-six-consumers', [{'op':'append','table':'gMonIconPalettes','row':palette['rows'][0]}]*4),
        ('non-RGB555-color', [{'op':'set','table':'gMonIconPalettes','index':0,'field':'color1','value':32768}]),
    ]:
        try:
            compile_edit(manifest, original, {'manifest_sha256':sha(canonical(manifest)), 'operations':operations})
        except ValueError as error:
            negative.append({'case':name,'outcome':'rejected','reason':str(error)})
        else:
            raise AssertionError('unsafe edit admitted '+name)
    # Existing clang ARM data-object build is a data serialization oracle, not a game build.
    obj = (root/'expanded/generated-data.o').read_bytes()
    shoff = struct.unpack_from('<I',obj,32)[0]; stride,count,names_index = struct.unpack_from('<HHH',obj,46)
    sections = [struct.unpack_from('<10I',obj,shoff+i*stride) for i in range(count)]
    strings = sections[names_index]; names = obj[strings[4]:strings[4]+strings[5]]
    contents = {names[s[0]:names.find(b'\0',s[0])].decode():obj[s[4]:s[4]+s[5]] for s in sections}
    ir = json.loads((root/'expanded/ir.json').read_text())
    for table in ir['tables']:
        assert contents['.rodata.'+table['symbol']] == bytes.fromhex(table['bytes_hex'])
    for i, write in enumerate(ir['writes']):
        assert contents['.rodata.gameverse_write_'+str(i)] == bytes.fromhex(write['after_hex'])
    receipt = {'schema':'gameverse.firered-memory-verification/1', 'outcome':'passed',
        'source_revision':manifest['source_revision'], 'source_tree_read':False,
        'original_sha256':sha(original), 'expanded_sha256':sha(expanded), 'followup_sha256':sha(followup),
        'identity_exact':True, 'original_image_changed_bytes':sum(a!=b for a,b in zip(original,expanded)),
        'extension_bytes':192, 'relocated_references':7, 'numeric_aliases_preserved':2,
        'generated_ARM_data_object_tables_verified':len(ir['tables']),
        'generated_ARM_data_object_writes_verified':len(ir['writes']),
        'repeat_edit_with_all_filesystem_reads_denied':True, 'repeat_changed_bytes':len(changed_followup),
        'negative_controls':negative, 'elapsed_seconds':time.perf_counter()-started,
        'data_object_compile_seconds':None, 'game_build_seconds':None, 'native_execution':False,
        'scope':'typed data serialization, exact byte delta and dependency rewrite; gameplay and save compatibility unqualified'}
    (root/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--directory',required=True)
    args=parser.parse_args(); print(json.dumps(verify(args.directory)))


if __name__=='__main__':
    main()
