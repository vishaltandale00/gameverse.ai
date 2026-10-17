#!/usr/bin/env python3
"""Bounded original-ROM Sonic sprite consumer proof, never full gameplay proof."""
import argparse
import hashlib
import json
import platform
import subprocess
import time
import struct
import zlib
from pathlib import Path

VERSION = 'sonic-pokemon-native-consumer/1'
BASELINE_SHA1 = 'd842afa7dd1e84de08addb94a51506f1bcafd551'

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def verify_patch_scope(original, candidate, ranges):
    """Prove every byte outside declared artwork payloads is unchanged."""
    if len(original) != len(candidate):
        raise ValueError('rom_size_changed')
    mask = bytearray(len(original))
    for row in ranges:
        at, size = row['rom_offset'], row['length']
        if at < 0 or size <= 0 or at + size > len(original):
            raise ValueError('invalid_artwork_range')
        if any(mask[at:at+size]):
            raise ValueError('overlapping_artwork_ranges')
        mask[at:at+size] = b'\1' * size
        if hashlib.sha256(original[at:at+size]).hexdigest() != row['original_sha256']:
            raise ValueError('original_range_hash_mismatch')
        if hashlib.sha256(candidate[at:at+size]).hexdigest() != row['replacement_sha256']:
            raise ValueError('replacement_range_hash_mismatch')
    changed = sum(a != b for a, b in zip(original, candidate))
    if not changed:
        raise ValueError('no_artwork_changed')
    if any(a != b and not allowed for a, b, allowed in zip(original, candidate, mask)):
        raise ValueError('changes_outside_artwork_ranges')
    return {'changed_bytes': changed, 'declared_artwork_bytes': sum(mask),
            'all_other_rom_bytes_identical': True,
            'meaning': 'Native AI, collision code, hitboxes, animation scripts, OAM definitions and palettes outside artwork spans are byte-identical. This proves preservation, not complete gameplay behavior.'}

def qualify(original, artifact, transfer_report, directory, timeout=60):
    started = time.monotonic()
    directory.mkdir(parents=True, exist_ok=True)
    result = {'schema': 'gameverse.sonic-enemy-native-verification/1',
              'adapter_version': VERSION, 'outcome': 'fail',
              'scope': 'native-enemy-graphics-consumer', 'request_satisfied': False,
              'natural_gameplay_route': False, 'full_game_completion': False,
              'queue_s': None, 'wall_s': None, 'timings': {},
              'limits': {'timeout_s': timeout, 'cold_boot_frames': 600, 'ticks_per_variant': 64,
                         'instructions_per_call': 2000000},
              'environment': {'machine': platform.platform(), 'library': '/opt/homebrew/lib/libmgba.dylib'},
              'gaps': ['Direct-entry sprite fixtures do not prove natural enemy encounters or full game completion.',
                       'The fixture uploads graphics, palettes and engine-generated OAM to hardware. Native animation and DisplaySprite execute unchanged original ROM code.']}
    try:
        raw, patched = original.read_bytes(), artifact.read_bytes()
        if hashlib.sha1(raw).hexdigest() != BASELINE_SHA1:
            raise ValueError('unsupported_original_sonic_rom')
        result['original_sha256'] = sha(original)
        result['original'] = {'path': str(original), 'sha256': sha(original)}
        result['candidate_sha256'] = sha(artifact)
        result['artifact'] = {'path': str(artifact), 'sha256': sha(artifact)}
        result['transfer_report_sha256'] = sha(transfer_report)
        result['transfer_manifest_sha256'] = sha(transfer_report)
        transfer = json.loads(transfer_report.read_text())
        result['patch_scope'] = verify_patch_scope(raw, patched, transfer['modified_ranges'])
        pairs = sorted({(v['animation_id'], v['variant']) for f in transfer['families'] for v in f['variants']})
        if not pairs or any(not 401 <= anim <= 434 or not 0 <= variant <= 255 for anim, variant in pairs):
            raise ValueError('invalid_enemy_native_cases')
        # Pinned original USA ABI, established from source structs and native disassembly.
        guards = {0x34cc: 'f0b5041c', 0x4158: 'f0b55746', 0x4894: 'f0b55746',
                  0x35d8: '34200003', 0x4ae8: '20190003'}
        for offset, expected in guards.items():
            if raw[offset:offset+len(bytes.fromhex(expected))] != bytes.fromhex(expected):
                raise ValueError('native_abi_guard_mismatch:'+hex(offset))
        result['native_abi'] = {
            'basis': 'Pinned original Sonic USA ROM disassembly; source core.h Sprite struct and sprite.c consumers.',
            'UpdateSpriteAnimation': '0x080034cc', 'DisplaySprite': '0x08004158',
            'ProcessOamBuffers': '0x08004894', 'gRefSpriteTables': '0x03002034',
            'gObjPalette': '0x03001920', 'gOamMallocBuffer': '0x03001b80',
            'gOamBuffer': '0x03004630', 'instruction_guards': {hex(k):v for k,v in guards.items()}}
        header = 'struct Case { unsigned anim,variant; };\nstatic const struct Case cases[]={'+','.join('{%d,%d}' % p for p in pairs)+'};\n'
        (directory/'native-cases.h').write_text(header)
        template = Path(__file__).with_name('native_verify.c.in')
        result['harness_sha256'] = sha(template)
        result['verifier_sha256'] = sha(__file__)
        result['case_manifest_sha256'] = sha(directory/'native-cases.h')
        result['environment']['library_sha256'] = sha('/opt/homebrew/lib/libmgba.dylib')
        source = directory/'native-verify.c'
        source.write_bytes(template.read_bytes())
        exe = directory/'native-verify'
        stage = time.monotonic()
        with (directory/'compile.log').open('w') as log:
            subprocess.run(['cc','-O1','-std=c11','-I/opt/homebrew/include',str(source),'-L/opt/homebrew/lib','-Wl,-rpath,/opt/homebrew/lib','-lmgba','-o',str(exe)],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=min(20,timeout))
        result['timings']['compile_s'] = time.monotonic()-stage
        for label, path in [('baseline',original),('candidate',artifact)]:
            out = directory/label
            out.mkdir(exist_ok=True)
            stage = time.monotonic()
            with (out/'stdout.log').open('w') as stdout, (out/'stderr.log').open('w') as stderr:
                subprocess.run([str(exe),str(path),str(out)],stdout=stdout,stderr=stderr,check=True,timeout=max(1,timeout-(time.monotonic()-started)))
            result['timings'][label+'_native_s'] = time.monotonic()-stage
            result[label] = json.loads(next(l for l in reversed((out/'stdout.log').read_text().splitlines()) if l.startswith('{')))
        if (directory/'baseline/consumer-trace.bin').read_bytes() != (directory/'candidate/consumer-trace.bin').read_bytes():
            raise ValueError('native_animation_hitbox_oam_parity_failed')
        result['native_animation_hitbox_oam_parity'] = True
        result['native_trace_sha256'] = {label: sha(directory/label/'consumer-trace.bin') for label in ('baseline','candidate')}
        frames = sorted((directory/'candidate').glob('enemy-*.rgba'))
        changed = [p for p in frames if p.read_bytes() != (directory/'baseline'/p.name).read_bytes()]
        if not changed:
            raise ValueError('no_native_rendered_enemy_artwork_difference')
        result['rendered_changed_frames'] = len(changed)
        result['rendered_frames'] = len(frames)
        # Standard library PNG encoder keeps this proof free of new dependencies.
        def chunk(kind, data):
            return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        for path in directory.glob('*/*.rgba'):
            rgba = path.read_bytes()
            rows = b''.join(b'\0'+rgba[y*960:(y+1)*960] for y in range(160))
            png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',240,160,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
            path.with_suffix('.png').write_bytes(png)
        result['evidence'] = [str(p.with_suffix('.png')) for p in changed if p.with_suffix('.png').exists()]
        result['evidence_sha256'] = {p: sha(p) for p in result['evidence']}
        result['outcome'] = 'pass'
    except Exception as error:
        result['error'] = str(error)
        result['error_type'] = type(error).__name__
    finally:
        result['wall_s'] = round(time.monotonic()-started,6)
        result['stage_accounting'] = 'Compile and baseline/candidate native stages are disjoint and nested in wall time; queue unavailable. PNG encoding and validation are wall-time overhead.'
        (directory/'native-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--original',type=Path,required=True)
    parser.add_argument('--artifact',type=Path,required=True)
    parser.add_argument('--transfer-report',type=Path,required=True)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--timeout',type=float,default=60)
    args = parser.parse_args()
    report = qualify(args.original.resolve(),args.artifact.resolve(),args.transfer_report.resolve(),args.directory.resolve(),args.timeout)
    print(json.dumps({'outcome':report['outcome'],'error':report.get('error'),'wall_s':report['wall_s']}))
    raise SystemExit(0 if report['outcome']=='pass' else 1)
