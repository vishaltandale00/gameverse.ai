"""Version-specific Pokémon source builds and honest linked-object profiles."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_COMMIT = '037335f4c725d7c9aecdac87066f2002b4bd7e14'
TOOLCHAIN_COMMIT = '57a5b3e21157ffa5490deebfa4d6dcf0b3052d28'
REVISIONS = {0: '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc', 1: 'dd5945db9b930750cb39d00c84da8571feebf417'}


def digest(path, algorithm='sha256'):
    return hashlib.new(algorithm, Path(path).read_bytes()).hexdigest()


def pin(path):
    return {'path': str(Path(path).resolve()), 'sha256': digest(path)}


def identify_firered(path):
    data = Path(path).read_bytes()
    if len(data) != 16*1024*1024 or data[0xac:0xb0] != b'BPRE':
        raise ValueError('Expected 16 MiB English FireRed cartridge')
    revision = data[0xbc]
    sha1 = hashlib.sha1(data).hexdigest()
    if revision not in REVISIONS or sha1 != REVISIONS[revision]:
        raise ValueError('FireRed source recipe/header/hash revision mismatch')
    return {'revision': revision, 'sha1': sha1, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}


def build_firered_rev1(output_dir, original_path):
    """One isolated clean revision-1 build using existing local source/tools."""
    from tools.whole_game.build_sources import git, run
    original = identify_firered(original_path)
    if original['revision'] != 1:
        raise ValueError('This build explicitly targets FireRed revision 1')
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    source, toolchain = ROOT/'local/decomps/pokefirered', ROOT/'local/game-builds/toolchains/agbcc-sonic'
    receipt = {'schema': 'gameverse.pokemon-version-build/1', 'game': 'firered', 'revision': 1,
               'status': 'failed', 'queue_s': None, 'original': pin(original_path), 'expected_sha1': REVISIONS[1],
               'sourceCommit': SOURCE_COMMIT, 'toolchainCommit': TOOLCHAIN_COMMIT,
               'environment': platform.platform(), 'build': {'mode': 'clean', 'cache': 'miss; fresh git archive',
                  'jobs': 2, 'timeout_s': 180, 'wall_s': None}, 'artifacts': {},
               'timing_note': 'Build excludes source snapshot/toolchain copy; setup and build nested in total; queue unavailable'}
    log, work = output/'build.log', output/'source'
    env = os.environ.copy()
    env.setdefault('CPATH', '/opt/homebrew/include')
    env.setdefault('LIBRARY_PATH', '/opt/homebrew/lib')
    try:
        if git(source, 'rev-parse', 'HEAD') != SOURCE_COMMIT or git(source, 'status', '--porcelain'):
            raise ValueError('Canonical FireRed source is dirty or differs from pinned commit')
        if git(toolchain, 'rev-parse', 'HEAD') != TOOLCHAIN_COMMIT:
            raise ValueError('Existing matching toolchain commit differs')
        receipt['sourceTreeHash'] = git(source, 'rev-parse', 'HEAD^{tree}')
        receipt['toolchainFiles'] = {name: pin(toolchain/name) for name in ('agbcc', 'old_agbcc', 'agbcc_arm', 'libgcc.a', 'libc.a')}
        setup_started = time.monotonic()
        archive = output/'source.tar'
        subprocess.run(['git', '-C', str(source), 'archive', '--format=tar', '--output='+str(archive), SOURCE_COMMIT], check=True, timeout=20)
        receipt['sourceArchive'] = pin(archive)
        work.mkdir()
        with tarfile.open(archive) as stream:
            for member in stream.getmembers():
                target = (work/member.name).resolve()
                if not target.is_relative_to(work) or member.issym() or member.islnk():
                    raise ValueError('Unexpected escaping/link source archive member')
            stream.extractall(work)
        install = work/'tools/agbcc'
        for name in ('bin', 'include', 'lib'):
            (install/name).mkdir(parents=True, exist_ok=True)
        for name in ('agbcc', 'old_agbcc', 'agbcc_arm'):
            shutil.copy2(toolchain/name, install/'bin'/name)
        shutil.copytree(toolchain/'libc/include', install/'include', dirs_exist_ok=True)
        shutil.copytree(toolchain/'ginclude', install/'include', dirs_exist_ok=True)
        for name in ('libgcc.a', 'libc.a'):
            shutil.copy2(toolchain/name, install/'lib'/name)
        receipt['setup_wall_s'] = round(time.monotonic()-setup_started, 6)
        command = ['make', '-j2', 'CPP=clang -E -Wno-invalid-pp-token', 'compare_firered_rev1']
        receipt['build']['command'] = command
        build_started = time.monotonic()
        try:
            run(command, work, env, log, 180)
        finally:
            receipt['build']['wall_s'] = round(time.monotonic()-build_started, 6)
        for kind, suffix in (('rom', 'gba'), ('elf', 'elf'), ('map', 'map')):
            artifact = work/('pokefirered_rev1.'+suffix)
            receipt['artifacts'][kind] = {**pin(artifact), 'size': artifact.stat().st_size}
        built = identify_firered(work/'pokefirered_rev1.gba')
        if built != original or (work/'pokefirered_rev1.gba').read_bytes() != Path(original_path).read_bytes():
            raise ValueError('Source-built revision 1 differs from exact original')
        receipt.update(status='passed', baselineMatches=True, raw_exact=True)
    except BaseException as error:
        receipt.update(error=str(error), error_type=type(error).__name__)
        raise
    finally:
        receipt['total_wall_s'] = round(time.monotonic()-started, 6)
        (output/'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n')
    return receipt


def write_firered_elf_profile(original_path, receipt_path, output_path):
    """Bind a real version-matched build to the shared ELF capture provider."""
    receipt_path = Path(receipt_path).resolve()
    receipt = json.loads(receipt_path.read_text())
    original = identify_firered(original_path)
    if receipt.get('status') != 'passed' or receipt.get('revision') != original['revision'] or not receipt.get('raw_exact'):
        raise ValueError('Source receipt must prove the same exact FireRed revision')
    artifacts = receipt['artifacts']
    for value in artifacts.values():
        if digest(value['path']) != value['sha256']:
            raise ValueError('Stale source build artifact')
    if Path(artifacts['rom']['path']).read_bytes() != Path(original_path).read_bytes():
        raise ValueError('Source-built cartridge differs from original')
    profile = {'schema': 'gameverse.elf-capture-profile/1', 'game_id': 'pokemon-firered-version-rev'+str(original['revision']),
               'original': pin(original_path), 'elf': artifacts['elf'], 'map': artifacts['map'],
               'source_root': str(receipt_path.parent/'source'), 'rom_base': 0x08000000,
               'header_postprocessing': {'ranges': []}, 'evidence': [pin(receipt_path)],
               'scope': 'Version-matched source build and linked ELF/object capture; no IR regeneration claim'}
    output = Path(output_path)
    with output.open('x') as stream:
        json.dump(profile, stream, indent=2, sort_keys=True)
        stream.write('\n')
    return profile
